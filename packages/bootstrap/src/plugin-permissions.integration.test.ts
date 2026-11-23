import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import {
  createMigrator, internalMigrations, externalMigrations, createFhirStore, persistResources, createPluginSchemas,
  createPluginRequests, createFacilityRegistryStore, createRoleStore, createTerminologyStore, createTerminologyAdminStore,
  type ExternalSchema, type Provenance, type RoleStore, type ValueSetProjection,
} from '@openldr/db';
import { createFsBucket } from '@openldr/adapter-fs-bucket';
import { createExtismRunner, createPluginRuntime, createPluginStore, type PluginRuntime } from '@openldr/plugins';
import { capabilitiesUnderScope, type DataScope } from '@openldr/rbac';
import { createPluginHost } from './plugin-host';
import { createPluginBroker, type BrokerPrincipal, type BrokerResult } from './plugin-broker';
import { createCapabilityCatalog, createPluginPermissionSync, type CapabilityCatalog } from './capability-catalog';
import { createPatientIndex } from './patient-index';
import { createPatientIdentifierSystems } from './patient-identifier-systems';
import { seedIdentifier, seedPatient } from './test-support/patient-index-fixture';

// Plan 2026-11-23-plugin-host-2b, Review focus 1 to 4, end to end through the broker.
//
// Layer: the real test-sink-host wasm with its manifest's `permissions` and `actionPermissions`
// (scripts/build-test-sink.mjs), the real runtime and plugin store (group claims, migration 142),
// the real capability catalog and Administrator sync, the real role store, the real broker, the
// real host functions over CE's stores, and the real patient index over a migrated warehouse. All
// on a disposable PostgreSQL server: one internal database and one warehouse database.
// Not proven here: the HTTP routes in front of the broker and the role editor (route tests and
// studio tests cover those), how a session's capabilities are resolved from roles (this test
// builds the principal, using capabilitiesUnderScope for the limited one), and the sidebar gate
// (Review focus 5, studio tests).
//
// Run `pnpm build:test-sink` first, and set HOST_FNS_TEST_DATABASE_URL to a server's maintenance
// database as a login that may create databases, as for host-fns.integration.test.ts. The test
// makes two fresh databases there and drops them afterwards.
const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, '..', '..', '..', 'reference-plugins', 'test-sink-host');
const wasmPath = join(pluginDir, 'plugin.wasm');
const manifestPath = join(pluginDir, 'manifest.json');
const url = process.env.HOST_FNS_TEST_DATABASE_URL;
const ready = Boolean(url) && existsSync(wasmPath) && existsSync(manifestPath)
  && readFileSync(manifestPath, 'utf8').includes('actionPermissions');

const ID = 'test-sink-host';
const F1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const F2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const MPI = 'urn:test:mpi';
const EVERYTHING: DataScope = { limited: false };
const SITE1: DataScope = { limited: true, facilities: [F1], districts: [], regions: [] };
const silent = { info() {}, error() {}, warn() {}, debug() {}, child() { return silent; } } as never;

function principal(id: string, capabilities: string[], dataScope: DataScope = EVERYTHING): BrokerPrincipal {
  return { id, roles: [], displayName: id, capabilities, dataScope };
}

describe.skipIf(!ready)('plugin permissions through the broker, on PostgreSQL', () => {
  const internalName = `perm_int_${randomUUID().replaceAll('-', '')}`;
  const warehouseName = `perm_wh_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Client;
  let db: Kysely<any>;
  let wh: Kysely<ExternalSchema>;
  let blobDir: string;
  let runtime: PluginRuntime;
  let catalog: CapabilityCatalog;
  let roles: RoleStore;
  let broker: ReturnType<typeof createPluginBroker>;
  let wasm: Uint8Array;
  let manifest: any;
  const denied: Array<{ op: string; reason?: string }> = [];

  const dbAt = (name: string) => {
    const target = new URL(url!);
    target.pathname = `/${name}`;
    return new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString(), max: 6 }) }) });
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database ${internalName}`);
    await admin.query(`create database ${warehouseName}`);
    db = dbAt(internalName);
    wh = dbAt(warehouseName) as unknown as Kysely<ExternalSchema>;
    const a = await createMigrator(db, internalMigrations).migrateToLatest();
    if (a.error) throw a.error;
    const b = await createMigrator(wh as never, externalMigrations('postgres')).migrateToLatest();
    if (b.error) throw b.error;

    const registry = createFacilityRegistryStore(db);
    await registry.upsert({ id: F1, facilityCode: 'F1', name: 'Alpha Clinic', source: 'manual', facilitySystem: 'urn:test:mfl' });
    await registry.upsert({ id: F2, facilityCode: 'F2', name: 'Beta Hospital', source: 'manual', facilitySystem: 'urn:test:mfl' });

    // The patient index over the warehouse, as patient-index-fixture.ts builds it on pg-mem.
    const fhirStore = createFhirStore(db);
    const termStore = createTerminologyStore(db, fhirStore);
    const projection: ValueSetProjection = {
      async saveValueSetResource(resource) {
        const saved = await fhirStore.save(resource as never);
        return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
      },
      async registerSystem(u, version, kind, resourceId) { await termStore.saveSystem(u, version, kind, resourceId); },
      async deleteValueSetResource(u, id) {
        await fhirStore.delete('ValueSet', id);
        await db.deleteFrom('terminology_systems').where('url', '=', u).execute();
      },
    };
    const systems = createPatientIdentifierSystems({ internalDb: db, externalDb: wh, admin: createTerminologyAdminStore(db, projection) });
    const patients = createPatientIndex({ externalDb: wh, systems, engine: 'postgres', refKey: randomBytes(32) });
    await seedPatient(wh, { id: 'p-one', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05', sex: 'M', org: `Organization/${F1}` });
    await seedPatient(wh, { id: 'p-two', surname: 'Banda', firstname: 'Ruth', dob: '1985-03-02', sex: 'F', org: `Organization/${F2}` });
    await seedIdentifier(wh, 'p-one', MPI, 'MPI-1');
    await seedIdentifier(wh, 'p-two', MPI, 'MPI-2');
    await systems.set({ system: MPI, label: 'MPI', listColumn: true, searchable: true });

    const host = createPluginHost({
      requests: createPluginRequests(db),
      patients,
      testCatalog: { list: async () => { throw new Error('not part of this test'); }, get: async () => { throw new Error('not part of this test'); } } as never,
      terminology: { expand: async () => { throw new Error('not part of this test'); }, lookup: async () => { throw new Error('not part of this test'); } } as never,
      facilityRegistry: registry,
      fhirGetWithProvenance: (type, id) => fhirStore.getWithProvenance(type, id),
      persist: (resources: unknown[], prov: Provenance) => persistResources({ fhirStore, logger: silent }, resources, prov, {
        level: 'low', resolveServiceRequest: (id: string) => fhirStore.exists('ServiceRequest', id),
      }),
      audit: async () => {},
      logger: silent,
    });

    // As index.ts wires them: the catalog reads the plugin store, role saves validate against the
    // catalog, and the runtime tells the sync of every change.
    const store = createPluginStore(db);
    catalog = createCapabilityCatalog({ plugins: store, logger: silent });
    roles = createRoleStore(db, { catalogKeys: () => catalog.keys() });
    await roles.seedSystemRoles();
    const sync = createPluginPermissionSync({ catalog, roles });

    blobDir = mkdtempSync(join(tmpdir(), 'plugin-perm-blob-'));
    runtime = createPluginRuntime({
      blob: createFsBucket({ dir: blobDir }),
      store,
      runner: createExtismRunner(),
      logger: silent,
      trustStore: { get: async () => undefined, pin: async () => {} },
      ceVersion: '0.1.0',
      verifyConfig: { devAllowUnsigned: false },
      schemas: createPluginSchemas(db),
      onChange: sync.onChange,
    });

    broker = createPluginBroker({
      plugins: runtime,
      pluginData: {} as never,
      host,
      resolveFacilities: async (scope) => (scope.limited ? scope.facilities : '*'),
      reporting: { list: async () => [], columns: async () => [], run: async () => ({}), eventSources: () => [] },
      connectors: { list: async () => [], get: async () => null },
      policy: () => ({ uiEnabled: true, egressEnabled: true }),
      audit: async (e) => { if (e.outcome === 'denied') denied.push({ op: e.op, reason: e.reason }); },
    });

    wasm = new Uint8Array(readFileSync(wasmPath));
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
    await wh?.destroy();
    if (admin) {
      await admin.query(`drop database if exists ${internalName} with (force)`);
      await admin.query(`drop database if exists ${warehouseName} with (force)`);
      await admin.end();
    }
    if (blobDir) rmSync(blobDir, { recursive: true, force: true });
  });

  const invoke = (who: BrokerPrincipal, entrypoint: string, input: unknown = {}): Promise<BrokerResult> =>
    broker.handle(ID, who, { kind: 'invoke', entrypoint, input });
  const ceRead = async (who: BrokerPrincipal, op: string, input: unknown): Promise<any> => {
    const r = await invoke(who, 'host_ce_read', { op, input });
    expect(r.ok).toBe(true);
    return (r as { data: unknown }).data;
  };
  const adminRole = async () => (await roles.getBySlug('lab_admin'))!;

  it('before install, a role cannot be given the plugin key', async () => {
    await expect(roles.create({ name: 'Too early', capabilities: ['sinkhost.run'] })).rejects.toThrow(/sinkhost\.run/);
  });

  // Review focus 2.
  it.each([
    ['its own key equal to a CE capability', 'forms.edit', /'forms\.edit' is a CE capability/],
    ['a key in a CE group', 'forms.extra', /group 'forms', which CE keeps/],
  ])('a plugin declaring %s is refused at install', async (_name, key, message) => {
    const grab = structuredClone(manifest);
    grab.id = 'grab-sink';
    grab.payload.permissions = [{ key, label: 'Grab', description: 'Grab a CE permission.' }];
    grab.payload.actionPermissions = { health_check: [key] };
    await expect(runtime.install(wasm, grab)).rejects.toThrow(message);
    expect((await runtime.list()).filter((r) => r.id === 'grab-sink')).toEqual([]);
  });

  it('install claims the group, adds the key to the catalog and grants it to the Administrator only', async () => {
    const bench = await roles.create({ name: 'Bench', capabilities: ['forms.view'] });
    await runtime.install(wasm, manifest);
    expect(await catalog.pluginKeys()).toEqual(['sinkhost.run']);
    const groups = await db.selectFrom('plugin_permission_groups').select(['group', 'plugin_id', 'publisher']).execute();
    expect(groups).toEqual([{ group: 'sinkhost', plugin_id: ID, publisher: null }]);
    expect((await adminRole()).capabilities).toContain('sinkhost.run');
    // Listing forms.edit in actionPermissions gives nobody forms.edit.
    expect((await roles.get(bench.id))!.capabilities).toEqual(['forms.view']);
    const pluginGroup = (await catalog.groups()).find((g) => g.plugin === ID);
    expect(pluginGroup?.capabilities.map((c) => c.key)).toEqual(['sinkhost.run']);
    await roles.update(bench.id, { capabilities: ['forms.view', 'sinkhost.run'] });
  });

  // Review focus 1.
  it('a caller with the action permission runs the action', async () => {
    const r = await invoke(principal('runner', ['sinkhost.run']), 'health_check');
    expect(r).toMatchObject({ ok: true, data: { ok: true } });
  });

  it('a caller without the action permission is refused before the wasm runs', async () => {
    denied.length = 0;
    const r = await invoke(principal('viewer', ['patients.view', 'forms.view']), 'host_db_select', { table: 'samples' });
    expect(r).toEqual({ ok: false, error: 'the action host_db_select of plugin test-sink-host needs one of these permissions: Run the test sink' });
    expect(denied).toEqual([{ op: 'invoke:host_db_select', reason: (r as { error: string }).error }]);
  });

  it.each([
    ['an exported entrypoint the plugin does not list', 'host_db_roundtrip'],
    ['an entrypoint the plugin does not export', 'drop_everything'],
    ['an entrypoint named like a permission', 'sinkhost.run'],
  ])('a crafted op naming %s is refused, even for a holder of every permission', async (_name, entrypoint) => {
    const everything = principal('root', ['sinkhost.run', 'forms.edit', 'patients.view', 'patients.find']);
    const r = await invoke(everything, entrypoint, { table: 'samples', values: { id: 1, facility: F1, code: 'x' }, select: { table: 'samples' } });
    expect(r).toEqual({ ok: false, error: `the action ${entrypoint} of plugin test-sink-host is closed: the plugin names no permission for it` });
    const rows = await sql<{ n: string }>`select count(*)::text as n from plugin_test_sink_host.samples`.execute(db);
    expect(rows.rows[0]!.n).toBe('0');
  });

  // Review focus 2, the other half: a CE capability in actionPermissions is only asked of callers.
  it('an action that needs a CE capability runs only for a holder of it', async () => {
    const obs = { resourceType: 'Observation', id: 'obs-perm-1', status: 'final', code: { text: 'Test' } };
    const without = await invoke(principal('runner', ['sinkhost.run']), 'host_fhir_emit', { resources: [obs] });
    expect(without).toEqual({ ok: false, error: 'the action host_fhir_emit of plugin test-sink-host needs one of these permissions: Edit forms' });
    const holder = await invoke(principal('editor', ['forms.edit']), 'host_fhir_emit', { resources: [obs] });
    expect(holder).toEqual({ ok: true, data: { ok: true, result: { saved: 1 } } });
    // Ruling 6: the action gate lets a limited holder in, and fhir_emit still refuses it.
    const limited = await invoke(principal('site-editor', ['forms.edit'], SITE1), 'host_fhir_emit', { resources: [{ ...obs, id: 'obs-perm-2' }] });
    expect(limited).toMatchObject({ ok: true, data: { ok: false, error: { code: 'OUTSIDE_DATA_LIMIT' } } });
  });

  // Review focus 4.
  describe('a facility-limited user with patients.find', () => {
    // As a session resolves it: the limit drops patients.view and keeps patients.find.
    const caps = capabilitiesUnderScope(['patients.view', 'patients.find'], SITE1);
    const site = () => principal('site-1', caps, SITE1);
    const everyone = () => principal('admin', ['sinkhost.run', 'patients.view']);

    it('keeps patients.find and loses patients.view under the limit', () => {
      expect(caps).toEqual(['patients.find']);
    });

    it('finds a patient at their facility by exact identifier, masked', async () => {
      const out = await ceRead(site(), 'patients.search', { identifier: { value: 'MPI-1' } });
      expect(out).toMatchObject({ ok: true, result: { total: 1, masked: true } });
      expect(out.result.rows[0]).toMatchObject({ id: null, name: 'J*** M***', birthDate: '1990' });
      const withSystem = await ceRead(site(), 'patients.search', { identifier: { system: MPI, value: 'MPI-1' } });
      expect(withSystem.result.total).toBe(1);
    });

    it('finds a patient at their facility by given and family name with full birth date', async () => {
      const out = await ceRead(site(), 'patients.search', { given: 'john', family: 'MWANZA', birthDate: '1990-01-05' });
      expect(out).toMatchObject({ ok: true, result: { total: 1 } });
    });

    it('does not find a patient at another facility, by identifier or by name', async () => {
      expect(await ceRead(site(), 'patients.search', { identifier: { value: 'MPI-2' } })).toMatchObject({ ok: true, result: { total: 0, rows: [] } });
      expect(await ceRead(site(), 'patients.search', { given: 'Ruth', family: 'Banda', birthDate: '1985-03-02' })).toMatchObject({ ok: true, result: { total: 0 } });
      // The caller without a limit finds the same patient, so the cut is the facility, not the data.
      expect(await ceRead(everyone(), 'patients.search', { identifier: { value: 'MPI-2' } })).toMatchObject({ ok: true, result: { total: 1 } });
    });

    it('cannot get a patient at another facility by its ref', async () => {
      const other = await ceRead(everyone(), 'patients.search', { identifier: { value: 'MPI-2' } });
      const ref = other.result.rows[0].ref as string;
      const got = await ceRead(site(), 'patients.get', { ref });
      expect(got).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      const mine = await ceRead(everyone(), 'patients.search', { identifier: { value: 'MPI-1' } });
      expect(await ceRead(site(), 'patients.get', { ref: mine.result.rows[0].ref })).toMatchObject({ ok: true });
    });

    it.each([
      ['a free-text search', { search: 'Mwan' }],
      ['a free-text search of a whole name', { search: 'John Mwanza' }],
    ])('cannot browse with %s', async (_name, input) => {
      expect(await ceRead(site(), 'patients.search', input)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    });

    it.each([
      ['an empty search', {}],
      ['a name without birth date', { given: 'John', family: 'Mwanza' }],
      ['a birth year only', { given: 'John', family: 'Mwanza', birthDate: '1990' }],
      ['a year and month', { given: 'John', family: 'Mwanza', birthDate: '1990-01' }],
    ])('is refused for %s', async (_name, input) => {
      expect(await ceRead(site(), 'patients.search', input)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    });

    it.each([
      ['a partial given name', { given: 'Jo', family: 'Mwanza', birthDate: '1990-01-05' }],
      ['a partial identifier', { identifier: { value: 'MPI-' } }],
    ])('gets nothing for %s', async (_name, input) => {
      expect(await ceRead(site(), 'patients.search', input)).toMatchObject({ ok: true, result: { total: 0, rows: [] } });
    });

    // Carried from the Task 4 review: SQL wildcards are matched as plain text.
    it.each([
      ['% as identifier', { identifier: { value: '%' } }],
      ['_ as identifier', { identifier: { value: '_' } }],
      ['MPI-_ as identifier', { identifier: { value: 'MPI-_' } }],
      ['MPI-% as identifier, with system', { identifier: { system: MPI, value: 'MPI-%' } }],
      ['% as given and family name', { given: '%', family: '%', birthDate: '1990-01-05' }],
      ['_ inside a name', { given: 'J_hn', family: 'Mw_nza', birthDate: '1990-01-05' }],
    ])('gets nothing extra for %s', async (_name, input) => {
      // Run without a limit too, so a wildcard that matched would show patients of both facilities.
      for (const who of [site(), principal('finder', ['patients.find'])]) {
        expect(await ceRead(who, 'patients.search', input)).toMatchObject({ ok: true, result: { total: 0, rows: [] } });
      }
    });
  });

  // Review focus 3. Runs after the others: it removes the plugin and installs it again.
  it('removal keeps the grants, roles holding them stay editable, and reinstall makes them known again', async () => {
    const bench = (await roles.list()).find((r) => r.name === 'Bench')!;
    expect(bench.capabilities).toContain('sinkhost.run');
    await runtime.remove(ID);
    expect(await catalog.pluginKeys()).toEqual([]);

    // Kept: still stored on both roles, listed as kept, and no longer able to open the action.
    expect((await adminRole()).capabilities).toContain('sinkhost.run');
    expect((await roles.get(bench.id))!.capabilities).toContain('sinkhost.run');
    const whileRemoved = await roles.diagnoseCapabilities();
    expect(whileRemoved.kept).toContain('sinkhost.run');
    expect(whileRemoved.plugin).not.toContain('sinkhost.run');
    expect(await invoke(principal('runner', ['sinkhost.run']), 'health_check')).toMatchObject({ ok: false, error: /not installed or disabled/ });

    // Editable: a save that adds and drops CE capabilities works and keeps the plugin key.
    const saved = await roles.update(bench.id, { capabilities: ['reports.view'] });
    expect([...saved.capabilities].sort()).toEqual(['reports.view', 'sinkhost.run']);

    // The group stays owned: another plugin cannot take it, so it cannot inherit the kept grants.
    const squatter = structuredClone(manifest);
    squatter.id = 'squat-sink';
    await expect(runtime.install(wasm, squatter)).rejects.toThrow(/sinkhost/);
    expect(await db.selectFrom('plugin_permission_groups').select(['group', 'plugin_id']).execute()).toEqual([{ group: 'sinkhost', plugin_id: ID }]);

    // Reinstall: the stored grants are known again, and the role's holders run the action.
    await runtime.install(wasm, manifest);
    const back = await roles.diagnoseCapabilities();
    expect(back.plugin).toContain('sinkhost.run');
    expect(back.kept).not.toContain('sinkhost.run');
    expect((await roles.get(bench.id))!.capabilities).toContain('sinkhost.run');
    expect(await invoke(principal('runner', (await roles.get(bench.id))!.capabilities), 'health_check')).toMatchObject({ ok: true, data: { ok: true } });
    // A save can now revoke it like any CE capability.
    const revoked = await roles.update(bench.id, { capabilities: ['reports.view'] });
    expect(revoked.capabilities).toEqual(['reports.view']);
  });
});
