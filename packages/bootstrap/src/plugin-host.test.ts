import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { appError } from '@openldr/core';
import { PluginRequestError, type PluginCaller } from '@openldr/db';
import type { Capability } from '@openldr/marketplace';
import type { HostPlugin } from '@openldr/plugins';
import { createPluginHost, CE_READ_OPS, type PluginHostDeps } from './plugin-host';
import { createPatientIndex } from './patient-index';
import { buildPatientIndexFixture, seedPatient } from './test-support/patient-index-fixture';

const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;

const EVERYONE: PluginCaller = { userId: 'u-admin', displayName: 'Admin', capabilities: ['patients.view_identifiers'], facilities: '*' };
const SITE: PluginCaller = { userId: 'u-site', displayName: 'Site User', capabilities: [], facilities: ['fac-1'] };

function plugin(capabilities: Capability[], tables: HostPlugin['tables'] = []): HostPlugin {
  return { id: 'lab', version: '0.2.0', capabilities, tables };
}

function fakeDeps(over: Partial<PluginHostDeps> = {}): PluginHostDeps {
  return {
    requests: { select: vi.fn(async () => ({ rows: [] })), write: vi.fn(async () => ({ results: [] })) },
    patients: { list: vi.fn(async () => ({ rows: [], total: 0, masked: true })), get: vi.fn() } as any,
    testCatalog: { list: vi.fn(async () => ({ rows: [], total: 0 })), get: vi.fn(async () => null) } as any,
    terminology: { expand: vi.fn(async () => ({ resourceType: 'ValueSet' })), lookup: vi.fn(async () => ({ found: true, display: 'X' })) } as any,
    facilityRegistry: { list: vi.fn(async () => ({ rows: [], total: 0 })), get: vi.fn(), idsMatching: vi.fn(async () => []) } as any,
    fhirGet: vi.fn(async () => null),
    persist: vi.fn(async () => []),
    audit: vi.fn(async () => {}),
    logger,
    ...over,
  };
}

describe('plugin host: which functions a plugin gets', () => {
  it('gives each function only with its capability', () => {
    const host = createPluginHost(fakeDeps());
    expect(Object.keys(host.forCall(plugin([]), EVERYONE))).toEqual([]);
    expect(Object.keys(host.forCall(plugin([{ kind: 'host:db' }]), EVERYONE)).sort()).toEqual(['db_select', 'db_write']);
    expect(Object.keys(host.forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE))).toEqual(['ce_read']);
    expect(Object.keys(host.forCall(plugin([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]), EVERYONE))).toEqual(['fhir_emit']);
    expect(Object.keys(host.forCall(plugin([{ kind: 'net-egress', allowedHosts: [] }, { kind: 'host:fhir' }]), EVERYONE))).toEqual([]);
  });
});

describe('plugin host: db_select and db_write', () => {
  const tables = [{ name: 'orders', columns: [{ name: 'id', type: 'uuid' as const }], primaryKey: ['id'] }];

  it('passes the trusted plugin id, the stored tables and the CE caller, and only the request', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:db' }], tables), SITE);
    const req = { table: 'orders' };
    expect(await fns.db_select(req)).toEqual({ ok: true, result: { rows: [] } });
    expect(deps.requests.select).toHaveBeenCalledWith('lab', tables, SITE, req);
    await fns.db_write({ steps: [] });
    expect(deps.requests.write).toHaveBeenCalledWith('lab', tables, SITE, { steps: [] });
  });

  it('cannot be pointed at another plugin, schema or caller by its input', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:db' }], tables), SITE);
    await fns.db_select({ table: 'orders', pluginId: 'other', caller: EVERYONE, facilities: '*' });
    const [pluginId, shapes, caller] = (deps.requests.select as any).mock.calls[0];
    expect(pluginId).toBe('lab');
    expect(shapes).toBe(tables);
    expect(caller).toBe(SITE);
  });

  it('answers a refused request with its reason, not a throw', async () => {
    const deps = fakeDeps({
      requests: {
        select: vi.fn(async () => { throw new PluginRequestError('table', "table 'users' is not declared"); }),
        write: vi.fn(async () => { throw new Error('connection to 10.0.0.5:5432 refused'); }),
      },
    });
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:db' }], tables), SITE);
    expect(await fns.db_select({ table: 'users' })).toEqual({ ok: false, error: { code: 'REQUEST_TABLE', message: "table 'users' is not declared" } });
    // An unexpected error's text can name hosts, so the plugin gets a fixed message.
    const w = await fns.db_write({ steps: [] }) as any;
    expect(w).toEqual({ ok: false, error: { code: 'HOST_ERROR', message: 'db_write failed inside CE' } });
    expect(JSON.stringify(w)).not.toMatch(/10\.0\.0\.5/);
  });
});

describe('plugin host: ce_read', () => {
  it('refuses an unknown op', async () => {
    const fns = createPluginHost(fakeDeps()).forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE);
    const out = await fns.ce_read({ op: 'users.list', input: {} }) as any;
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('UNKNOWN_OP');
    expect(out.error.message).toMatch(/unknown op 'users.list'/);
  });

  it('knows the first set of ops', () => {
    expect([...CE_READ_OPS]).toEqual([
      'patients.search', 'patients.get', 'patients.register', 'valueset.expand', 'valueset.lookup',
      'testCatalog.list', 'testCatalog.get', 'facilities.search',
    ]);
  });

  it('refuses an input field that is not part of the request', async () => {
    const fns = createPluginHost(fakeDeps()).forCall(plugin([{ kind: 'host:ce-read' }]), SITE);
    const out = await fns.ce_read({ op: 'patients.search', input: { search: 'x', facilities: '*' } }) as any;
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('INVALID_REQUEST');
  });

  async function patientsFixture() {
    const f = await buildPatientIndexFixture();
    const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', refKey: randomBytes(32) });
    await seedPatient(f.externalDb, { id: 'p-1', surname: 'Mwanza', firstname: 'John', org: 'Organization/FAC-1' });
    await seedPatient(f.externalDb, { id: 'p-2', surname: 'Mwale', firstname: 'Ruth', org: 'Organization/fac-2' });
    await seedPatient(f.externalDb, { id: 'p-3', surname: 'Mwamba', firstname: 'Old', org: null });
    return index;
  }

  it('patients.search honours the caller data limit', async () => {
    const index = await patientsFixture();
    const deps = fakeDeps({ patients: index });
    const host = createPluginHost(deps);

    const all = await host.forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE).ce_read({ op: 'patients.search', input: { search: 'mwa' } }) as any;
    expect(all.ok).toBe(true);
    expect(all.result.rows.map((r: any) => r.id).sort()).toEqual(['p-1', 'p-2', 'p-3']);

    // The site user sees only fac-1's patient. Its list is masked (no patients.view_identifiers),
    // so it finds no one by a part of a name, and every patient from an empty search.
    const site = await host.forCall(plugin([{ kind: 'host:ce-read' }]), SITE).ce_read({ op: 'patients.search', input: {} }) as any;
    expect(site.ok).toBe(true);
    expect(site.result.total).toBe(1);
    expect(site.result.rows.map((r: any) => r.managingFacility?.reference)).toEqual(['Organization/FAC-1']);

    const none = await host.forCall(plugin([{ kind: 'host:ce-read' }]), { ...SITE, facilities: [] }).ce_read({ op: 'patients.search', input: {} }) as any;
    expect(none.result).toMatchObject({ rows: [], total: 0 });

    // The unmasked list is audited with the caller as actor, as the studio route does.
    expect(deps.audit).toHaveBeenCalledWith(
      { actorType: 'user', actorId: 'u-admin', actorName: 'Admin' },
      expect.objectContaining({ action: 'patients.list', metadata: expect.objectContaining({ pluginId: 'lab', count: 3 }) }),
    );
  });

  it('patients.get answers a patient outside the data limit as not found', async () => {
    const index = await patientsFixture();
    const host = createPluginHost(fakeDeps({ patients: index }));
    const admin = await host.forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE).ce_read({ op: 'patients.search', input: { search: 'Ruth' } }) as any;
    const ref = admin.result.rows[0].ref;
    const asAdmin = await host.forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE).ce_read({ op: 'patients.get', input: { ref } }) as any;
    expect(asAdmin.ok).toBe(true);
    const asSite = await host.forCall(plugin([{ kind: 'host:ce-read' }]), SITE).ce_read({ op: 'patients.get', input: { ref } }) as any;
    expect(asSite).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'patient not found' } });
  });

  it('patients.register saves a Patient through the FHIR save path and audits the caller', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:ce-read' }]), SITE);
    const patient = { resourceType: 'Patient', id: 'lab-p-1', managingOrganization: { reference: 'Organization/fac-1' } };
    expect(await fns.ce_read({ op: 'patients.register', input: { patient } })).toEqual({ ok: true, result: { id: 'lab-p-1' } });
    expect(deps.persist).toHaveBeenCalledWith([patient], { pluginId: 'lab', pluginVersion: '0.2.0', sourceSystem: 'plugin:lab' });
    expect(deps.audit).toHaveBeenCalledWith(
      { actorType: 'user', actorId: 'u-site', actorName: 'Site User' },
      { action: 'patients.register', entityType: 'patient', entityId: 'lab-p-1', metadata: { pluginId: 'lab', pluginVersion: '0.2.0' } },
    );
  });

  it('patients.register refuses another facility, another resource type, and an overwrite outside the limit', async () => {
    const deps = fakeDeps({ fhirGet: vi.fn(async () => ({ resourceType: 'Patient', id: 'p-2', managingOrganization: { reference: 'Organization/fac-2' } })) });
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:ce-read' }]), SITE);
    const other = await fns.ce_read({ op: 'patients.register', input: { patient: { resourceType: 'Patient', id: 'x', managingOrganization: { reference: 'Organization/fac-2' } } } }) as any;
    expect(other.error.code).toBe('OUTSIDE_DATA_LIMIT');
    const obs = await fns.ce_read({ op: 'patients.register', input: { patient: { resourceType: 'Observation', id: 'x' } } }) as any;
    expect(obs.error.code).toBe('INVALID_REQUEST');
    const over = await fns.ce_read({ op: 'patients.register', input: { patient: { resourceType: 'Patient', id: 'p-2', managingOrganization: { reference: 'Organization/fac-1' } } } }) as any;
    expect(over.error.code).toBe('OUTSIDE_DATA_LIMIT');
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it('patients.register answers a validation failure with its issues', async () => {
    const issue = { severity: 'error', code: 'required', diagnostics: 'Patient.name is required' };
    const deps = fakeDeps({ persist: vi.fn(async () => { throw appError('VA0002', { details: { outcome: { issue: [issue] } } }); }) });
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE);
    const out = await fns.ce_read({ op: 'patients.register', input: { patient: { resourceType: 'Patient', id: 'x' } } }) as any;
    expect(out).toEqual({ ok: false, error: { code: 'VALIDATION_FAILED', message: expect.stringMatching(/nothing was saved/), issues: [issue] } });
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it('facilities.search gives a limited caller only its own facilities', async () => {
    const rec = (id: string) => ({ id, name: `Clinic ${id}`, facilityCode: id.toUpperCase(), region: 'R', district: 'D' });
    const deps = fakeDeps({
      facilityRegistry: {
        list: vi.fn(async () => ({ rows: [rec('fac-1'), rec('fac-2')], total: 2 })),
        idsMatching: vi.fn(async () => [{ id: 'fac-2', facilityCode: 'FAC-2' }, { id: 'FAC-1', facilityCode: 'FAC-1' }]),
        get: vi.fn(async (id: string) => rec(id)),
      } as any,
    });
    const host = createPluginHost(deps);
    const all = await host.forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE).ce_read({ op: 'facilities.search', input: { q: 'clinic' } }) as any;
    expect(all.result.total).toBe(2);
    const site = await host.forCall(plugin([{ kind: 'host:ce-read' }]), SITE).ce_read({ op: 'facilities.search', input: { q: 'clinic' } }) as any;
    expect(site.result).toEqual({ rows: [expect.objectContaining({ id: 'FAC-1' })], total: 1 });
  });

  it('valueset and test catalog ops call the same services the studio routes call', async () => {
    const deps = fakeDeps({ testCatalog: { list: vi.fn(async () => ({ rows: [], total: 0 })), get: vi.fn(async (c: string) => (c === 'HB' ? { code: 'HB', lab: {} } : null)) } as any });
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:ce-read' }]), SITE);
    await fns.ce_read({ op: 'valueset.expand', input: { url: 'urn:vs', count: 10, filter: 'a' } });
    expect(deps.terminology.expand).toHaveBeenCalledWith('urn:vs', { count: 10, offset: undefined, filter: 'a' });
    await fns.ce_read({ op: 'valueset.lookup', input: { system: 'urn:cs', code: 'A' } });
    expect(deps.terminology.lookup).toHaveBeenCalledWith('urn:cs', 'A');
    await fns.ce_read({ op: 'testCatalog.list', input: { q: 'hb' } });
    expect(deps.testCatalog.list).toHaveBeenCalled();
    expect(await fns.ce_read({ op: 'testCatalog.get', input: { code: 'HB' } })).toEqual({ ok: true, result: { code: 'HB', lab: {} } });
    expect((await fns.ce_read({ op: 'testCatalog.get', input: { code: 'NOPE' } }) as any).error.code).toBe('NOT_FOUND');
  });
});

describe('plugin host: fhir_emit', () => {
  const emit = (types: string[]) => plugin([{ kind: 'emit-fhir', resourceTypes: types }]);

  it('refuses a resource type the plugin did not declare, and saves nothing', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(emit(['Observation', 'ServiceRequest']), SITE);
    const out = await fns.fhir_emit({
      resources: [{ resourceType: 'Observation', id: 'o1' }, { resourceType: 'Patient', id: 'p1' }],
    }) as any;
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('RESOURCE_TYPE_NOT_ALLOWED');
    expect(out.error.message).toMatch(/nothing was saved/);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('refuses a record with no resourceType and an empty list', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(emit(['Observation']), SITE);
    expect((await fns.fhir_emit({ resources: [{ id: 'x' }] }) as any).error.code).toBe('INVALID_RESOURCE');
    expect((await fns.fhir_emit({ resources: [] }) as any).error.code).toBe('NO_RESOURCES');
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('saves declared types with the plugin provenance, which the input cannot change', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(emit(['Observation']), SITE);
    const resources = [{ resourceType: 'Observation', id: 'o1' }];
    expect(await fns.fhir_emit({ resources })).toEqual({ ok: true, result: { saved: 1 } });
    expect(deps.persist).toHaveBeenCalledWith(resources, { pluginId: 'lab', pluginVersion: '0.2.0', sourceSystem: 'plugin:lab' });
    const forged = await fns.fhir_emit({ resources, provenance: { pluginId: 'cdr-source' } }) as any;
    expect(forged.error.code).toBe('INVALID_REQUEST');
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it('answers an unexpected save failure plainly, without its text', async () => {
    const deps = fakeDeps({ persist: vi.fn(async () => { throw new Error('duplicate key value violates unique constraint "fhir_resources_pkey" at /srv/app'); }) });
    const out = await createPluginHost(deps).forCall(emit(['Observation']), SITE).fhir_emit({ resources: [{ resourceType: 'Observation', id: 'o1' }] });
    expect(out).toEqual({ ok: false, error: { code: 'HOST_ERROR', message: 'fhir_emit failed inside CE' } });
  });
});
