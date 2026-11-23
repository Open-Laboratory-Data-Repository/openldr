import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql, type KyselyPlugin } from 'kysely';
import {
  createMigrator, internalMigrations, createFhirStore, persistResources, createPluginSchemas,
  createPluginRequests, createFacilityRegistryStore, type PluginCaller, type Provenance,
} from '@openldr/db';
import { createFsBucket } from '@openldr/adapter-fs-bucket';
import {
  createExtismRunner, createPluginRuntime, createPluginStore, hostFnsNeedAWorkerMessage, type PluginRuntime,
} from '@openldr/plugins';
import { createPluginHost } from './plugin-host';
import { createPluginRemoval } from './plugin-removal';
import type { AuditActor, AuditDetails } from './record-audit';

// Layer: the real test-sink-host wasm (wasm/test-sink built with feature `host`), the real Extism
// runner on the worker path, the real runtime (install, loadSink) and plugin store, and the real
// host functions (createPluginHost) over CE's own stores, on a disposable PostgreSQL database with
// every internal migration. Not proven here: the broker and the HTTP route in front of the sink
// (plugin-broker.test.ts proves the caller it passes), and the patient index, test catalog and
// terminology ops of ce_read, which get stand-ins that fail if called.
//
// Run `pnpm build:test-sink` first, and set HOST_FNS_TEST_DATABASE_URL to a server's maintenance
// database (for example postgres://u:p@127.0.0.1:55471/postgres) as a login that may create
// databases. The test makes a fresh database there and drops it afterwards.
const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, '..', '..', '..', 'reference-plugins', 'test-sink-host');
const plainWasmPath = join(here, '..', '..', '..', 'reference-plugins', 'test-sink', 'plugin.wasm');
const wasmPath = join(pluginDir, 'plugin.wasm');
const url = process.env.HOST_FNS_TEST_DATABASE_URL;
const ready = Boolean(url) && existsSync(wasmPath) && existsSync(plainWasmPath);

const F1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const F2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const everyone: PluginCaller = { userId: 'admin-1', displayName: 'Admin', capabilities: ['patients.view'], facilities: '*' };
const site1: PluginCaller = { userId: 'site-1', displayName: 'Site one', capabilities: [], facilities: [F1] };
const silent = { info() {}, error() {}, warn() {}, debug() {}, child() { return silent; } } as never;
const notUsed = (what: string) => async () => { throw new Error(`${what} is not part of this test`); };

type Answer = { ok: true; result: any } | { ok: false; error: { code: string; message: string } };

/** Counts the statements a Kysely instance runs, so a test can show none ran. */
function statementCounter(): KyselyPlugin & { count: number } {
  const p = {
    count: 0,
    transformQuery(args: { node: any }) { p.count += 1; return args.node; },
    async transformResult(args: { result: any }) { return args.result; },
  };
  return p;
}

describe.skipIf(!ready)('CE host functions through the real test plugin, on PostgreSQL', () => {
  const dbName = `host_fns_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: Kysely<any>;
  let requestsDb: Kysely<any>;
  let counter: ReturnType<typeof statementCounter>;
  let blobDir: string;
  let runtime: PluginRuntime;
  let wasm: Uint8Array;
  let manifest: any;
  const audits: Array<{ actor: AuditActor; details: AuditDetails }> = [];
  let host: ReturnType<typeof createPluginHost>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: target.toString(), max: 6 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    const migrated = await createMigrator(db, internalMigrations).migrateToLatest();
    if (migrated.error) throw migrated.error;
    counter = statementCounter();
    requestsDb = new Kysely<any>({ dialect: new PostgresDialect({ pool }), plugins: [counter] });

    const registry = createFacilityRegistryStore(db);
    await registry.upsert({ id: F1, facilityCode: 'F1', name: 'Alpha Clinic', source: 'manual', facilitySystem: 'urn:test:mfl' });
    await registry.upsert({ id: F2, facilityCode: 'F2', name: 'Beta Hospital', source: 'manual', facilitySystem: 'urn:test:mfl' });

    const fhirStore = createFhirStore(db);
    host = createPluginHost({
      requests: createPluginRequests(requestsDb),
      patients: { list: notUsed('patients.list'), get: notUsed('patients.get') } as never,
      testCatalog: { list: notUsed('testCatalog.list'), get: notUsed('testCatalog.get') } as never,
      terminology: { expand: notUsed('expand'), lookup: notUsed('lookup') } as never,
      facilityRegistry: registry,
      fhirGetWithProvenance: (type, id) => fhirStore.getWithProvenance(type, id),
      persist: (resources: unknown[], prov: Provenance) => persistResources({ fhirStore, logger: silent }, resources, prov, {
        level: 'low', resolveServiceRequest: (id: string) => fhirStore.exists('ServiceRequest', id),
      }),
      audit: async (actor, details) => { audits.push({ actor, details }); },
      logger: silent,
    });

    blobDir = mkdtempSync(join(tmpdir(), 'host-fns-blob-'));
    runtime = createPluginRuntime({
      blob: createFsBucket({ dir: blobDir }),
      store: createPluginStore(db),
      runner: createExtismRunner(),
      logger: silent,
      trustStore: { get: async () => undefined, pin: async () => {} },
      ceVersion: '0.1.0',
      verifyConfig: { devAllowUnsigned: false },
      schemas: createPluginSchemas(db),
    });
    wasm = new Uint8Array(readFileSync(wasmPath));
    manifest = JSON.parse(readFileSync(join(pluginDir, 'manifest.json'), 'utf8'));
    await runtime.install(wasm, manifest);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
    await requestsDb?.destroy().catch(() => {});
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
    if (blobDir) rmSync(blobDir, { recursive: true, force: true });
  });

  async function call(entrypoint: string, input: unknown, caller: PluginCaller = everyone): Promise<any> {
    const sink = await runtime.loadSink('test-sink-host');
    if (!sink) throw new Error('test-sink-host is not installed');
    return sink.invoke(entrypoint, input, { caller, host });
  }

  async function rowsInTable(): Promise<Array<{ id: number; facility: string; code: string }>> {
    const r = await sql<{ id: number; facility: string; code: string }>`select id, facility, code from plugin_test_sink_host.samples order by id`.execute(db);
    return r.rows;
  }

  it('install built the declared facility table, with row-level security forced', async () => {
    const r = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>`
      select c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'plugin_test_sink_host' and c.relname = 'samples'`.execute(db);
    expect(r.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it('a write and a read in one wasm call go through db_write and db_select', async () => {
    const out = await call('host_db_roundtrip', {
      table: 'samples', values: { id: 1, facility: F1, code: 'a1' },
      select: { table: 'samples', where: [{ column: 'id', op: 'eq', value: 1 }], columns: ['id', 'facility', 'code'] },
    });
    expect(out.write).toEqual({ ok: true, result: { results: [{ rowCount: 1 }] } });
    expect(out.select).toEqual({ ok: true, result: { rows: [{ id: 1, facility: F1, code: 'a1' }] } });
    const more: Answer = await call('host_db_write', { steps: [
      { op: 'insert', table: 'samples', values: { id: 2, facility: F1, code: 'a2' } },
      { op: 'insert', table: 'samples', values: { id: 3, facility: F2, code: 'b1' } },
    ] });
    expect(more.ok).toBe(true);
  });

  // Review focus 1.
  it.each([
    ['a quoted table', { table: 'samples"; drop table x; --' }],
    ['a dotted table', { table: 'plugin_test_sink_host.samples' }],
    ['pg_catalog.x', { table: 'pg_catalog.pg_roles' }],
    ['public.users', { table: 'public.users' }],
    ['a table not declared', { table: 'users' }],
    ['a column with a quote', { table: 'samples', columns: ['code"'] }],
    ['a column not declared', { table: 'samples', columns: ['password'] }],
    ['a filter on a column not declared', { table: 'samples', where: [{ column: 'secret', op: 'eq', value: 1 }] }],
    ['a limit of 10 million', { table: 'samples', limit: 10_000_000 }],
  ])('a hostile select is refused before any SQL runs: %s', async (_name, request) => {
    const before = counter.count;
    const out: Answer = await call('host_db_select', request);
    expect(out.ok).toBe(false);
    expect((out as { error: { code: string } }).error.code).toMatch(/^REQUEST_(INVALID|TABLE|COLUMN)$/);
    expect(counter.count).toBe(before);
  });

  it('a hostile write is refused before any SQL runs', async () => {
    const before = counter.count;
    const out: Answer = await call('host_db_write', { steps: [{ op: 'insert', table: 'public.users', values: { id: 9 } }] });
    expect(out).toMatchObject({ ok: false, error: { code: 'REQUEST_INVALID' } });
    const managed: Answer = await call('host_db_write', { steps: [{ op: 'insert', table: 'samples', values: { id: 9, facility: F1, code: 'x', created_at: '2020-01-01T00:00:00Z' } }] });
    expect(managed).toMatchObject({ ok: false, error: { code: 'REQUEST_COLUMN' } });
    expect(counter.count).toBe(before);
  });

  // Review focus 2.
  it('a site caller with no facility filter reads only its own facility', async () => {
    const all: Answer = await call('host_db_select', { table: 'samples', orderBy: [{ column: 'id' }], count: true });
    expect(all).toMatchObject({ ok: true, result: { count: 3 } });
    const mine: Answer = await call('host_db_select', { table: 'samples', orderBy: [{ column: 'id' }], count: true }, site1);
    expect(mine.ok).toBe(true);
    const result = (mine as { result: { rows: Array<{ facility: string }>; count: number } }).result;
    expect(result.count).toBe(2);
    expect(result.rows.map((r) => r.facility)).toEqual([F1, F1]);
  });

  it('a site caller cannot insert, update or delete for another facility', async () => {
    const insert: Answer = await call('host_db_write', { steps: [{ op: 'insert', table: 'samples', values: { id: 4, facility: F2, code: 'x' } }] }, site1);
    expect(insert).toMatchObject({ ok: false, error: { code: 'REQUEST_FACILITY' } });
    const move: Answer = await call('host_db_write', { steps: [{ op: 'update', table: 'samples', key: { id: 1 }, set: { facility: F2 } }] }, site1);
    expect(move).toMatchObject({ ok: false, error: { code: 'REQUEST_FACILITY' } });
    // A row of another facility is outside the caller's rows, so a delete of it changes nothing.
    const del: Answer = await call('host_db_write', { steps: [{ op: 'delete', table: 'samples', key: { id: 3 } }] }, site1);
    expect(del).toEqual({ ok: true, result: { results: [{ rowCount: 0 }] } });
    expect(await rowsInTable()).toEqual([
      { id: 1, facility: F1, code: 'a1' }, { id: 2, facility: F1, code: 'a2' }, { id: 3, facility: F2, code: 'b1' },
    ]);
  });

  it('ce_read: a site caller finds only its own facilities, and an unknown op is refused', async () => {
    const mine: Answer = await call('host_ce_read', { op: 'facilities.search', input: {} }, site1);
    expect(mine).toMatchObject({ ok: true, result: { total: 1, rows: [{ id: F1, name: 'Alpha Clinic' }] } });
    const all: Answer = await call('host_ce_read', { op: 'facilities.search', input: {} });
    expect(all).toMatchObject({ ok: true, result: { total: 2 } });
    const unknown: Answer = await call('host_ce_read', { op: 'users.list', input: {} });
    expect(unknown).toMatchObject({ ok: false, error: { code: 'UNKNOWN_OP' } });
    const noView: Answer = await call('host_ce_read', { op: 'patients.get', input: { ref: 'p1' } }, site1);
    expect(noView).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  // Review focus 4.
  it('fhir_emit of a type the plugin did not declare is refused, and nothing is saved', async () => {
    const before = await sql<{ n: string }>`select count(*)::text as n from fhir.fhir_resources`.execute(db);
    const obs = { resourceType: 'Observation', id: 'obs-host-1', status: 'final', code: { text: 'Test' } };
    const patient = { resourceType: 'Patient', id: 'pat-host-1' };
    const out: Answer = await call('host_fhir_emit', { resources: [obs, patient] });
    expect(out).toMatchObject({ ok: false, error: { code: 'RESOURCE_TYPE_NOT_ALLOWED' } });
    const after = await sql<{ n: string }>`select count(*)::text as n from fhir.fhir_resources`.execute(db);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(await createFhirStore(db).getWithProvenance('Observation', 'obs-host-1')).toBeNull();
    expect(audits.filter((a) => a.details.action === 'fhir.emit')).toEqual([]);
  });

  it('fhir_emit of a declared type saves it with the plugin as its source, and audits it', async () => {
    const obs = { resourceType: 'Observation', id: 'obs-host-2', status: 'final', code: { text: 'Test' } };
    const out: Answer = await call('host_fhir_emit', { resources: [obs] });
    expect(out).toEqual({ ok: true, result: { saved: 1 } });
    const stored = await createFhirStore(db).getWithProvenance('Observation', 'obs-host-2');
    expect(stored?.provenance).toMatchObject({ pluginId: 'test-sink-host', sourceSystem: 'plugin:test-sink-host' });
    expect(audits.filter((a) => a.details.action === 'fhir.emit')).toHaveLength(1);
    // A limited caller cannot send records at all.
    const limited: Answer = await call('host_fhir_emit', { resources: [{ ...obs, id: 'obs-host-3' }] }, site1);
    expect(limited).toMatchObject({ ok: false, error: { code: 'OUTSIDE_DATA_LIMIT' } });
    expect(await createFhirStore(db).getWithProvenance('Observation', 'obs-host-3')).toBeNull();
  });

  // Review focus 3.
  it.each([
    ['a dropped column', (cols: any[]) => cols.filter((c) => c.name !== 'note')],
    ['a renamed column', (cols: any[]) => cols.map((c) => c.name === 'note' ? { ...c, name: 'remark' } : c)],
    ['a changed type', (cols: any[]) => cols.map((c) => c.name === 'code' ? { ...c, type: 'integer' } : c)],
  ])('an upgrade with %s is refused, and the old version stays active and working', async (_name, change) => {
    const next = structuredClone(manifest);
    next.version = '0.2.0';
    next.payload.tables[0].columns = change(next.payload.tables[0].columns);
    await expect(runtime.install(wasm, next)).rejects.toThrow(/test-sink-host@0\.2\.0 was not installed, and test-sink-host@0\.1\.0 stays active/);
    const rows = (await runtime.list()).filter((r) => r.id === 'test-sink-host').map((r) => [r.version, r.active]);
    expect(rows).toEqual([['0.1.0', true]]);
    const out: Answer = await call('host_db_select', { table: 'samples', count: true });
    expect(out).toMatchObject({ ok: true, result: { count: 3 } });
  });

  // Review focus 5.
  it('where no worker can start, a call with host functions fails with a plain message', async () => {
    const devRuntime = createPluginRuntime({
      blob: createFsBucket({ dir: blobDir }), store: createPluginStore(db),
      runner: createExtismRunner({ execArgv: ['--import', 'tsx'] }), logger: silent,
      trustStore: { get: async () => undefined, pin: async () => {} }, ceVersion: '0.1.0',
      verifyConfig: { devAllowUnsigned: false }, schemas: createPluginSchemas(db),
    });
    const sink = await devRuntime.loadSink('test-sink-host');
    await expect(sink!.invoke('host_db_select', { table: 'samples' }, { caller: everyone, host }))
      .rejects.toThrow(hostFnsNeedAWorkerMessage(['db_select', 'db_write', 'ce_read', 'fhir_emit']));
    // Without a caller the call is refused before it runs, also plainly.
    await expect(sink!.invoke('health_check', {})).rejects.toThrow(/need a signed-in caller/);
  });

  it('the plain test-sink still loads and runs with no host functions', async () => {
    const plain = new Uint8Array(readFileSync(plainWasmPath));
    const { createWasmSink, parseManifest, sha256Hex } = await import('@openldr/plugins');
    const sink = createWasmSink(parseManifest({
      id: 'test-sink', version: '0.1.0', kind: 'sink', entrypoints: ['health_check'], wasmSha256: sha256Hex(plain), wasi: true,
    }), plain, createExtismRunner(), silent);
    expect(await sink.invoke('health_check', {})).toMatchObject({ ok: true });
  });

  // Install level: removal with keep 'nothing' drops the schema on a real database (Task 4 proved
  // it with a fake schema manager). Runs last: it removes the plugin.
  it('remove with keep nothing drops the plugin schema and its rows', async () => {
    const schemaExists = async () => (await sql<{ n: string }>`select count(*)::text as n from pg_namespace where nspname = 'plugin_test_sink_host'`.execute(db)).rows[0]!.n;
    expect(await schemaExists()).toBe('1');
    const none = { list: async () => [], get: async () => null, stop: async () => { throw new Error('nothing runs'); }, remove: async () => { throw new Error('nothing to delete'); } };
    const removal = createPluginRemoval({
      plugins: runtime, importCopies: none as never, importChecks: none as never, imports: none as never,
      pluginData: { purgeExcept: async () => {} }, pluginSchemas: createPluginSchemas(db), logger: silent,
      audit: async () => {},
    });
    await removal.remove('test-sink-host', { keep: 'nothing', actor: { type: 'user', id: 'admin-1', name: 'Admin' }, waitMs: 1 });
    expect(await schemaExists()).toBe('0');
    expect((await runtime.list()).filter((r) => r.id === 'test-sink-host')).toEqual([]);
  });
});
