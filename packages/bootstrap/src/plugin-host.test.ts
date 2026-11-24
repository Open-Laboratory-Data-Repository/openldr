import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { appError } from '@openldr/core';
import { PluginRequestError, type PluginCaller } from '@openldr/db';
import type { Capability } from '@openldr/marketplace';
import type { HostPlugin } from '@openldr/plugins';
import { createPluginHost, CE_READ_OPS, type PluginHostDeps } from './plugin-host';
import { createPatientIndex } from './patient-index';
import { pluginPatientRefs } from './plugin-patient-ref';
import { bandFit, matchBand, SEX_OPTIONS, type BandPatient, type ResultBand } from './result-params';
import { capabilitiesUnderScope } from '@openldr/rbac';
import { buildPatientIndexFixture, seedIdentifier, seedPatient } from './test-support/patient-index-fixture';
import { createLabIdentity, labTimeZone } from './lab-identity';
/** A settings store held in memory, for the real lab identity service. */
function memorySettings() {
  const rows = new Map<string, string>();
  return {
    get: async (key: string) => (rows.has(key) ? { key, value: rows.get(key)!, updatedAt: new Date(0), updatedBy: null } : null),
    getAll: async () => [...rows].map(([key, value]) => ({ key, value, updatedAt: new Date(0), updatedBy: null })),
    set: async (key: string, value: string) => { rows.set(key, value); },
  };
}


/** The lasting pluginRef key, fixed so a test can stand in for a restart. */
const KEY = Buffer.alloc(32, 9);

const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;

const EVERYONE: PluginCaller = { userId: 'u-admin', displayName: 'Admin', capabilities: ['patients.view', 'patients.view_identifiers'], facilities: '*' };
const SITE: PluginCaller = { userId: 'u-site', displayName: 'Site User', capabilities: ['patients.view'], facilities: ['fac-1'] };

function plugin(capabilities: Capability[], tables: HostPlugin['tables'] = []): HostPlugin {
  return { id: 'lab', version: '0.2.0', capabilities, tables };
}

/** A plugin that may register patients: host:ce-read, and Patient in its emit-fhir list. */
const REGISTERS: Capability[] = [{ kind: 'host:ce-read' }, { kind: 'emit-fhir', resourceTypes: ['Patient'] }];
const stored = (resource: unknown, pluginId?: string) => ({ resource, provenance: pluginId ? { pluginId } : { sourceSystem: 'disa' } });

function fakeDeps(over: Partial<PluginHostDeps> = {}): PluginHostDeps {
  return {
    requests: { select: vi.fn(async () => ({ rows: [] })), write: vi.fn(async () => ({ results: [] })) },
    patients: { list: vi.fn(async () => ({ rows: [], total: 0, masked: true })), get: vi.fn(), getById: vi.fn(), idForRef: vi.fn(() => null) } as any,
    testCatalog: { list: vi.fn(async () => ({ rows: [], total: 0 })), get: vi.fn(async () => null) } as any,
    terminology: { expand: vi.fn(async () => ({ resourceType: 'ValueSet' })), lookup: vi.fn(async () => ({ found: true, display: 'X' })) } as any,
    facilityRegistry: { list: vi.fn(async () => ({ rows: [], total: 0 })), get: vi.fn(), idsMatching: vi.fn(async () => []) } as any,
    pluginRefKey: async () => KEY,
    fhirGetWithProvenance: vi.fn(async () => null),
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
    // emit-fhir alone gives nothing (cdr-source keeps today's behaviour); with host:db it gives fhir_emit.
    expect(Object.keys(host.forCall(plugin([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]), EVERYONE))).toEqual([]);
    expect(Object.keys(host.forCall(plugin([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }, { kind: 'host:db' }]), EVERYONE)).sort())
      .toEqual(['db_select', 'db_write', 'fhir_emit']);
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
      'patients.search', 'patients.get', 'patients.getMany', 'patients.register', 'valueset.expand', 'valueset.lookup',
      'testCatalog.list', 'testCatalog.get', 'testCatalog.resultParams', 'facilities.search', 'facilities.get', 'caller.get',
    ]);
  });

  it('caller.get gives a limited caller its facility list, and no capabilities', async () => {
    const fns = createPluginHost(fakeDeps()).forCall(plugin([{ kind: 'host:ce-read' }]), SITE);
    expect(await fns.ce_read({ op: 'caller.get', input: {} }))
      .toEqual({ ok: true, result: { userId: 'u-site', displayName: 'Site User', facilities: ['fac-1'] } });
  });

  it("caller.get gives an unlimited caller '*', with or without an input", async () => {
    const fns = createPluginHost(fakeDeps()).forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE);
    const want = { ok: true, result: { userId: 'u-admin', displayName: 'Admin', facilities: '*' } };
    expect(await fns.ce_read({ op: 'caller.get' })).toEqual(want);
    expect(await fns.ce_read({ op: 'caller.get', input: {} })).toEqual(want);
  });

  it('caller.get takes the name from the session and refuses an input carrying one', async () => {
    const fns = createPluginHost(fakeDeps()).forCall(plugin([{ kind: 'host:ce-read' }]), SITE);
    const out = await fns.ce_read({ op: 'caller.get', input: { displayName: 'Someone Else' } }) as any;
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('INVALID_REQUEST');
    expect((await fns.ce_read({ op: 'caller.get', input: {} }) as any).result.displayName).toBe('Site User');
  });

  it('caller.get is not there for a plugin without host:ce-read', () => {
    const fns = createPluginHost(fakeDeps()).forCall(plugin([{ kind: 'host:db' }]), SITE);
    expect(fns.ce_read).toBeUndefined();
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

  it('patients ops need patients.view or patients.find; other ops do not', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:ce-read' }]), { ...EVERYONE, capabilities: [] });
    for (const [op, input] of [
      ['patients.search', {}], ['patients.get', { ref: 'r' }], ['patients.getMany', { pluginRefs: ['r'] }],
      ['patients.register', { patient: { resourceType: 'Patient', id: 'x' } }],
    ] as const) {
      expect(await fns.ce_read({ op, input })).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: `${op}: the caller holds neither patients.view nor patients.find` } });
    }
    expect(deps.patients.list).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
    expect((await fns.ce_read({ op: 'valueset.lookup', input: { system: 'urn:cs', code: 'A' } }) as any).ok).toBe(true);
  });

  it('a limited caller never sees a patient whose Organization id is not one of its register ids', async () => {
    const f = await buildPatientIndexFixture();
    const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', refKey: randomBytes(32) });
    // The same clinic, but under a warehouse Organization id that is not the register id fac-1.
    await seedPatient(f.externalDb, { id: 'p-w', surname: 'Zulu', firstname: 'Ann', org: 'Organization/hl7-site-FAC1' });
    await seedPatient(f.externalDb, { id: 'p-x', surname: 'Zulu', firstname: 'Bo', org: 'Organization/fac-10' });
    const host = createPluginHost(fakeDeps({ patients: index }));
    const site = await host.forCall(plugin([{ kind: 'host:ce-read' }]), SITE).ce_read({ op: 'patients.search', input: {} }) as any;
    expect(site.result).toMatchObject({ rows: [], total: 0 });
    const admin = await host.forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE).ce_read({ op: 'patients.search', input: { search: 'zulu' } }) as any;
    for (const row of admin.result.rows) {
      const got = await host.forCall(plugin([{ kind: 'host:ce-read' }]), SITE).ce_read({ op: 'patients.get', input: { ref: row.ref } }) as any;
      expect(got.error.code).toBe('NOT_FOUND');
    }
    expect(admin.result.rows).toHaveLength(2);
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
    const fns = createPluginHost(deps).forCall(plugin(REGISTERS), SITE);
    const patient = { resourceType: 'Patient', id: 'lab-p-1', managingOrganization: { reference: 'Organization/fac-1' } };
    expect(await fns.ce_read({ op: 'patients.register', input: { patient } })).toEqual({ ok: true, result: { id: 'lab-p-1', pluginRef: pluginPatientRefs(KEY, 'lab').encode('lab-p-1') } });
    expect(deps.persist).toHaveBeenCalledWith([patient], { pluginId: 'lab', pluginVersion: '0.2.0', sourceSystem: 'plugin:lab' });
    expect(deps.audit).toHaveBeenCalledWith(
      { actorType: 'user', actorId: 'u-site', actorName: 'Site User' },
      { action: 'patients.register', entityType: 'patient', entityId: 'lab-p-1', metadata: { pluginId: 'lab', pluginVersion: '0.2.0' } },
    );
  });

  it('patients.register needs Patient in the emit-fhir list granted at install', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:ce-read' }, { kind: 'emit-fhir', resourceTypes: ['Observation'] }]), EVERYONE);
    const out = await fns.ce_read({ op: 'patients.register', input: { patient: { resourceType: 'Patient', id: 'x' } } }) as any;
    expect(out.error.code).toBe('FORBIDDEN');
    expect(out.error.message).toMatch(/emit-fhir for Patient/);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('patients.register refuses to update a patient another plugin or an ingest wrote, for any caller', async () => {
    for (const pluginId of [undefined, 'cdr-source']) {
      const deps = fakeDeps({ fhirGetWithProvenance: vi.fn(async () => stored({ resourceType: 'Patient', id: 'p-2' }, pluginId)) });
      const fns = createPluginHost(deps).forCall(plugin(REGISTERS), EVERYONE);
      const out = await fns.ce_read({ op: 'patients.register', input: { patient: { resourceType: 'Patient', id: 'p-2' } } }) as any;
      expect(out.error.code).toBe('FORBIDDEN');
      expect(out.error.message).toMatch(/not written by this plugin/);
      expect(deps.persist).not.toHaveBeenCalled();
      expect(deps.audit).not.toHaveBeenCalled();
    }
  });

  it('patients.register updates a patient this plugin wrote', async () => {
    const deps = fakeDeps({ fhirGetWithProvenance: vi.fn(async () => stored({ resourceType: 'Patient', id: 'p-9', managingOrganization: { reference: 'Organization/fac-1' } }, 'lab')) });
    const fns = createPluginHost(deps).forCall(plugin(REGISTERS), SITE);
    const patient = { resourceType: 'Patient', id: 'p-9', managingOrganization: { reference: 'Organization/fac-1' } };
    expect(await fns.ce_read({ op: 'patients.register', input: { patient } })).toEqual({ ok: true, result: { id: 'p-9', pluginRef: expect.any(String) } });
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it('patients.register refuses another facility, another resource type, and an own patient held outside the limit', async () => {
    const deps = fakeDeps({ fhirGetWithProvenance: vi.fn(async () => stored({ resourceType: 'Patient', id: 'p-2', managingOrganization: { reference: 'Organization/fac-2' } }, 'lab')) });
    const fns = createPluginHost(deps).forCall(plugin(REGISTERS), SITE);
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
    const fns = createPluginHost(deps).forCall(plugin(REGISTERS), EVERYONE);
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

  it('testCatalog.get and list answer the turnaround times and the verification switch as the catalog gives them', async () => {
    const test = { code: 'HB', expectedTatHours: 0.5, criticalTatHours: null, requiresVerification: false, lab: {} };
    const deps = fakeDeps({ testCatalog: { list: vi.fn(async () => ({ rows: [test], total: 1 })), get: vi.fn(async () => test) } as any });
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:ce-read' }]), SITE);
    const fields = { expectedTatHours: 0.5, criticalTatHours: null, requiresVerification: false };
    expect(((await fns.ce_read({ op: 'testCatalog.get', input: { code: 'HB' } })) as any).result).toMatchObject(fields);
    expect(((await fns.ce_read({ op: 'testCatalog.list', input: {} })) as any).result.rows[0]).toMatchObject(fields);
  });

  it('testCatalog.get answers the additional codings as the catalog gives them (plan B, Task 5)', async () => {
    const codings = [{ system: 'urn:test:cs:extra', code: 'X1', display: 'Extra one', purpose: 'INDICATION', note: null }];
    const test = { code: 'HB', codings, lab: {} };
    const deps = fakeDeps({ testCatalog: { list: vi.fn(async () => ({ rows: [test], total: 1 })), get: vi.fn(async () => test) } as any });
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:ce-read' }]), SITE);
    expect(((await fns.ce_read({ op: 'testCatalog.get', input: { code: 'HB' } })) as any).result.codings).toEqual(codings);
  });

  it('testCatalog.get finds a test by its id, and get and list answer its Test code beside it', async () => {
    const test = { code: 'tst-0123456789abcdef', testCode: 'HB', display: 'Haemoglobin', lab: {} };
    const get = vi.fn(async (c: string) => (c === test.code ? test : null));
    const deps = fakeDeps({ testCatalog: { list: vi.fn(async () => ({ rows: [test], total: 1 })), get } as any });
    const fns = createPluginHost(deps).forCall(plugin([{ kind: 'host:ce-read' }]), SITE);
    // `code` keeps meaning the id, so a plugin order saved before Test codes still finds its test.
    expect(((await fns.ce_read({ op: 'testCatalog.get', input: { code: test.code } })) as any).result)
      .toMatchObject({ code: test.code, testCode: 'HB' });
    expect(get).toHaveBeenCalledWith(test.code);
    expect(((await fns.ce_read({ op: 'testCatalog.list', input: {} })) as any).result.rows[0])
      .toMatchObject({ code: test.code, testCode: 'HB' });
  });
});

describe('plugin host: fhir_emit', () => {
  const emit = (types: string[]) => plugin([{ kind: 'emit-fhir', resourceTypes: types }, { kind: 'host:db' }]);

  it('is refused for a caller with a data limit, and saves nothing', async () => {
    const deps = fakeDeps();
    const out = await createPluginHost(deps).forCall(emit(['Observation']), SITE).fhir_emit({ resources: [{ resourceType: 'Observation', id: 'o1' }] }) as any;
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('OUTSIDE_DATA_LIMIT');
    expect(out.error.message).toMatch(/nothing was saved/);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('refuses a resource type the plugin did not declare, and saves nothing', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(emit(['Observation', 'ServiceRequest']), EVERYONE);
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
    const fns = createPluginHost(deps).forCall(emit(['Observation']), EVERYONE);
    expect((await fns.fhir_emit({ resources: [{ id: 'x' }] }) as any).error.code).toBe('INVALID_RESOURCE');
    expect((await fns.fhir_emit({ resources: [] }) as any).error.code).toBe('NO_RESOURCES');
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('saves declared types with the plugin provenance, which the input cannot change', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(emit(['Observation']), EVERYONE);
    const resources = [{ resourceType: 'Observation', id: 'o1' }];
    expect(await fns.fhir_emit({ resources })).toEqual({ ok: true, result: { saved: 1 } });
    expect(deps.persist).toHaveBeenCalledWith(resources, { pluginId: 'lab', pluginVersion: '0.2.0', sourceSystem: 'plugin:lab' });
    const forged = await fns.fhir_emit({ resources, provenance: { pluginId: 'cdr-source' } }) as any;
    expect(forged.error.code).toBe('INVALID_REQUEST');
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it('refuses to overwrite a record another plugin or an ingest wrote, and saves nothing', async () => {
    for (const pluginId of [undefined, 'cdr-source']) {
      const deps = fakeDeps({ fhirGetWithProvenance: vi.fn(async (t: string, id: string) => (id === 'o2' ? stored({ resourceType: t, id }, pluginId) : null)) });
      const out = await createPluginHost(deps).forCall(emit(['Observation']), EVERYONE).fhir_emit({
        resources: [{ resourceType: 'Observation', id: 'o1' }, { resourceType: 'Observation', id: 'o2' }],
      }) as any;
      expect(out.error.code).toBe('FORBIDDEN');
      expect(out.error.message).toMatch(/Observation\/o2 was not written by this plugin/);
      expect(deps.persist).not.toHaveBeenCalled();
      expect(deps.audit).not.toHaveBeenCalled();
    }
  });

  it('updates a record this plugin wrote', async () => {
    const deps = fakeDeps({ fhirGetWithProvenance: vi.fn(async (t: string, id: string) => stored({ resourceType: t, id }, 'lab')) });
    const out = await createPluginHost(deps).forCall(emit(['Observation']), EVERYONE).fhir_emit({ resources: [{ resourceType: 'Observation', id: 'o1' }] });
    expect(out).toEqual({ ok: true, result: { saved: 1 } });
  });

  it('refuses a Bundle and a record with contained records, and saves nothing', async () => {
    const deps = fakeDeps();
    const fns = createPluginHost(deps).forCall(emit(['Observation', 'Bundle']), EVERYONE);
    const bundle = await fns.fhir_emit({ resources: [{ resourceType: 'Bundle', id: 'b', entry: [] }] }) as any;
    expect(bundle.error.code).toBe('RESOURCE_TYPE_NOT_ALLOWED');
    const contained = await fns.fhir_emit({ resources: [{ resourceType: 'Observation', id: 'o', contained: [{ resourceType: 'Patient', id: 'p' }] }] }) as any;
    expect(contained.error.code).toBe('INVALID_RESOURCE');
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('writes one audit row per call, with the caller, types, count and ids', async () => {
    const deps = fakeDeps();
    await createPluginHost(deps).forCall(emit(['Observation', 'ServiceRequest']), EVERYONE).fhir_emit({
      resources: [{ resourceType: 'ServiceRequest', id: 's1' }, { resourceType: 'Observation', id: 'o1' }, { resourceType: 'Observation', id: 'o2' }],
    });
    expect(deps.audit).toHaveBeenCalledTimes(1);
    expect(deps.audit).toHaveBeenCalledWith(
      { actorType: 'user', actorId: 'u-admin', actorName: 'Admin' },
      {
        action: 'fhir.emit', entityType: 'fhir', entityId: 'ServiceRequest/s1',
        metadata: {
          pluginId: 'lab', pluginVersion: '0.2.0', count: 3, types: ['Observation', 'ServiceRequest'],
          ids: ['ServiceRequest/s1', 'Observation/o1', 'Observation/o2'], idsTruncated: false,
        },
      },
    );
  });

  it('answers an unexpected save failure plainly, without its text', async () => {
    const deps = fakeDeps({ persist: vi.fn(async () => { throw new Error('duplicate key value violates unique constraint "fhir_resources_pkey" at /srv/app'); }) });
    const out = await createPluginHost(deps).forCall(emit(['Observation']), EVERYONE).fhir_emit({ resources: [{ resourceType: 'Observation', id: 'o1' }] });
    expect(out).toEqual({ ok: false, error: { code: 'HOST_ERROR', message: 'fhir_emit failed inside CE' } });
  });
});

// Ruling 5 of plan 2026-11-23-plugin-host-2b: patients.find, a strong-match lookup a limited user keeps.
describe('plugin host: patients.find', () => {
  const MPI = 'urn:zm:mpi';
  const LIMITED = { limited: true as const, facilities: ['fac-1'], districts: [], regions: [] };
  // A site user whose role holds view, view_identifiers and find: the data limit leaves only find.
  const FINDER: PluginCaller = {
    userId: 'u-find', displayName: 'Finder', facilities: ['fac-1'],
    capabilities: capabilitiesUnderScope(['patients.view', 'patients.view_identifiers', 'patients.find'], LIMITED),
  };
  const ADMIN_FINDER: PluginCaller = { ...FINDER, userId: 'u-af', facilities: '*', capabilities: ['patients.find'] };

  async function fixture() {
    const f = await buildPatientIndexFixture();
    const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', refKey: randomBytes(32) });
    await seedPatient(f.externalDb, { id: 'p-1', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05', guid: 'G-1', org: 'Organization/FAC-1' });
    await seedPatient(f.externalDb, { id: 'p-2', surname: 'Mwale', firstname: 'Ruth', dob: '1985-03-04', guid: 'G-2', org: 'Organization/fac-2' });
    await seedIdentifier(f.externalDb, 'p-1', MPI, 'MPI-0001');
    await seedIdentifier(f.externalDb, 'p-2', MPI, 'MPI-0002');
    const deps = fakeDeps({ patients: index });
    const host = createPluginHost(deps);
    const call = (caller: PluginCaller, op: string, input: unknown) =>
      host.forCall(plugin(REGISTERS), caller).ce_read({ op, input }) as Promise<any>;
    return { deps, call };
  }

  it('a limited user keeps patients.find after the data-limit drop', () => {
    expect(FINDER.capabilities).toEqual(['patients.find']);
  });

  it('finds a patient at their facility by exact identifier, masked, and not one at another facility', async () => {
    const { call, deps } = await fixture();
    const own = await call(FINDER, 'patients.search', { identifier: { value: 'MPI-0001' } });
    expect(own.ok).toBe(true);
    expect(own.result.total).toBe(1);
    expect(own.result.masked).toBe(true);
    expect(own.result.rows[0]).toMatchObject({ id: null, name: 'J*** M***', birthDate: '1990', managingFacility: { reference: 'Organization/FAC-1' } });
    expect(JSON.stringify(own.result)).not.toMatch(/Mwanza|MPI-0001|1990-01-05|G-1|p-1/);
    expect((await call(FINDER, 'patients.search', { identifier: { system: MPI, value: 'MPI-0001' } })).result.total).toBe(1);
    expect((await call(FINDER, 'patients.search', { identifier: { system: 'urn:other', value: 'MPI-0001' } })).result.total).toBe(0);
    expect((await call(FINDER, 'patients.search', { identifier: { value: 'G-1' } })).result.total).toBe(1);
    // The patient at fac-2 exists, but the limited user does not find it.
    expect((await call(FINDER, 'patients.search', { identifier: { value: 'MPI-0002' } })).result).toMatchObject({ rows: [], total: 0 });
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it('cannot browse: no partial identifier, no free-text search, no empty search', async () => {
    const { call } = await fixture();
    expect((await call(FINDER, 'patients.search', { identifier: { value: 'MPI-000' } })).result.total).toBe(0);
    expect((await call(FINDER, 'patients.search', { identifier: { value: 'MPI' } })).result.total).toBe(0);
    const text = await call(FINDER, 'patients.search', { search: 'Mwan' });
    expect(text.error.code).toBe('FORBIDDEN');
    expect(text.error.message).toMatch(/exact identifier/);
    expect((await call(FINDER, 'patients.search', {})).error.code).toBe('INVALID_REQUEST');
    expect((await call(FINDER, 'patients.search', { identifier: { value: '  ' } })).error.code).toBe('INVALID_REQUEST');
  });

  it('finds by given and family name with a full birth date only', async () => {
    const { call } = await fixture();
    const hit = await call(FINDER, 'patients.search', { given: 'john', family: 'MWANZA', birthDate: '1990-01-05' });
    expect(hit.result.total).toBe(1);
    expect(hit.result.rows[0].name).toBe('J*** M***');
    // A part of a name, or a wrong day, matches no one.
    expect((await call(FINDER, 'patients.search', { given: 'Jo', family: 'Mwanza', birthDate: '1990-01-05' })).result.total).toBe(0);
    expect((await call(FINDER, 'patients.search', { given: 'J%', family: 'Mwanza', birthDate: '1990-01-05' })).result.total).toBe(0);
    expect((await call(FINDER, 'patients.search', { given: 'John', family: 'Mwanza', birthDate: '1990-01-06' })).result.total).toBe(0);
    // Year-only, year-month, impossible dates and a missing part are refused.
    for (const input of [
      { given: 'John', family: 'Mwanza', birthDate: '1990' },
      { given: 'John', family: 'Mwanza', birthDate: '1990-01' },
      { given: 'John', family: 'Mwanza', birthDate: '1990-02-30' },
      { given: 'John', family: 'Mwanza' },
      { family: 'Mwanza', birthDate: '1990-01-05' },
      { identifier: { value: 'MPI-0001' }, given: 'John', family: 'Mwanza', birthDate: '1990-01-05' },
    ]) {
      const out = await call(FINDER, 'patients.search', input);
      expect(out.error?.code, JSON.stringify(input)).toBe('INVALID_REQUEST');
    }
    // Ruth is at fac-2, outside the limit.
    expect((await call(FINDER, 'patients.search', { given: 'Ruth', family: 'Mwale', birthDate: '1985-03-04' })).result.total).toBe(0);
  });

  it('patients.get gives a patient at the caller facilities, and answers another as not found', async () => {
    const { call } = await fixture();
    const own = await call(FINDER, 'patients.search', { identifier: { value: 'MPI-0001' } });
    const got = await call(FINDER, 'patients.get', { ref: own.result.rows[0].ref });
    expect(got.ok).toBe(true);
    expect(got.result).toMatchObject({ masked: true, id: null, phone: null });
    const other = await call(ADMIN_FINDER, 'patients.search', { identifier: { value: 'MPI-0002' } });
    expect(other.result.total).toBe(1);
    const ref = other.result.rows[0].ref;
    // A caller with no limit may open it; the limited user gets the same answer as for no patient.
    expect((await call(ADMIN_FINDER, 'patients.get', { ref })).ok).toBe(true);
    expect(await call(FINDER, 'patients.get', { ref })).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'patient not found' } });
    expect(await call(FINDER, 'patients.get', { ref: 'no-such-ref' })).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'patient not found' } });
  });

  it('patients.register works with patients.find alone', async () => {
    const { call, deps } = await fixture();
    const patient = { resourceType: 'Patient', id: 'lab-p-7', managingOrganization: { reference: 'Organization/fac-1' } };
    expect(await call(FINDER, 'patients.register', { patient })).toEqual({ ok: true, result: { id: 'lab-p-7', pluginRef: expect.stringMatching(/^p1\./) } });
    expect(deps.persist).toHaveBeenCalledTimes(1);
    const away = await call(FINDER, 'patients.register', { patient: { ...patient, managingOrganization: { reference: 'Organization/fac-2' } } });
    expect(away.error.code).toBe('OUTSIDE_DATA_LIMIT');
  });

  it('a patients.view caller keeps the free-text search, and may also use the strong fields', async () => {
    const { call } = await fixture();
    const viewer: PluginCaller = { userId: 'u-v', displayName: 'V', capabilities: ['patients.view', 'patients.view_identifiers'], facilities: '*' };
    const text = await call(viewer, 'patients.search', { search: 'mwa' });
    expect(text.result.rows.map((r: any) => r.id).sort()).toEqual(['p-1', 'p-2']);
    expect((await call(viewer, 'patients.search', {})).result.total).toBe(2);
    const strong = await call(viewer, 'patients.search', { identifier: { value: 'MPI-0002' } });
    expect(strong.result.rows.map((r: any) => r.id)).toEqual(['p-2']);
    expect((await call(viewer, 'patients.search', { search: 'x', identifier: { value: 'MPI-0002' } })).error.code).toBe('INVALID_REQUEST');
  });
});

describe('plugin host: pluginRef, a lasting patient link', () => {
  const MPI = 'urn:zm:mpi';
  const LIMITED = { limited: true as const, facilities: ['fac-1'], districts: [], regions: [] };
  const FINDER: PluginCaller = {
    userId: 'u-find', displayName: 'Finder', facilities: ['fac-1'],
    capabilities: capabilitiesUnderScope(['patients.view', 'patients.view_identifiers', 'patients.find'], LIMITED),
  };

  /** A fresh patient index each time, so its boot-time `ref` key differs: what a restart does. */
  async function boot(f: Awaited<ReturnType<typeof buildPatientIndexFixture>>, pluginId = 'lab') {
    const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', refKey: randomBytes(32) });
    const host = createPluginHost(fakeDeps({ patients: index }));
    return (caller: PluginCaller, op: string, input: unknown) =>
      host.forCall({ ...plugin(REGISTERS), id: pluginId }, caller).ce_read({ op, input }) as Promise<any>;
  }

  async function seeded() {
    const f = await buildPatientIndexFixture();
    await seedPatient(f.externalDb, { id: 'p-1', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05', org: 'Organization/FAC-1' });
    await seedPatient(f.externalDb, { id: 'p-2', surname: 'Mwale', firstname: 'Ruth', dob: '1985-03-04', org: 'Organization/fac-2' });
    await seedIdentifier(f.externalDb, 'p-1', MPI, 'MPI-0001');
    await seedIdentifier(f.externalDb, 'p-2', MPI, 'MPI-0002');
    return f;
  }

  it('a masked search row carries a pluginRef that hides the id and survives a restart', async () => {
    const f = await seeded();
    const first = await (await boot(f))(FINDER, 'patients.search', { identifier: { value: 'MPI-0001' } });
    const row = first.result.rows[0];
    expect(row.id).toBeNull();
    expect(row.pluginRef).toMatch(/^p1\.[A-Za-z0-9_-]+$/);
    expect(row.pluginRef).not.toContain('p-1');
    expect(JSON.stringify(first.result)).not.toMatch(/p-1|MPI-0001/);

    // After a restart the old ref is dead, and the pluginRef still opens the patient.
    const again = await boot(f);
    expect(await again(FINDER, 'patients.get', { ref: row.ref })).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'patient not found' } });
    const got = await again(FINDER, 'patients.get', { pluginRef: row.pluginRef });
    expect(got.ok).toBe(true);
    expect(got.result).toMatchObject({ masked: true, id: null, name: 'J*** M***', pluginRef: row.pluginRef });
    // The same patient gives the same string on a later search.
    expect((await again(FINDER, 'patients.search', { identifier: { value: 'MPI-0001' } })).result.rows[0].pluginRef).toBe(row.pluginRef);
  });

  it('a pluginRef opens only for the plugin it was made for', async () => {
    const f = await seeded();
    const lab = await boot(f, 'lab');
    const other = await boot(f, 'other');
    const mine = (await lab(EVERYONE, 'patients.search', { search: 'Mwanza' })).result.rows[0].pluginRef;
    const theirs = (await other(EVERYONE, 'patients.search', { search: 'Mwanza' })).result.rows[0].pluginRef;
    expect(mine).not.toBe(theirs);
    expect((await lab(EVERYONE, 'patients.get', { pluginRef: mine })).result.id).toBe('p-1');
    expect(await other(EVERYONE, 'patients.get', { pluginRef: mine })).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'patient not found' } });
  });

  it('patients.get by pluginRef keeps the data limit, and refuses an altered ref', async () => {
    const f = await seeded();
    const call = await boot(f);
    const ruth = (await call(EVERYONE, 'patients.search', { search: 'Ruth' })).result.rows[0].pluginRef;
    expect((await call(EVERYONE, 'patients.get', { pluginRef: ruth })).ok).toBe(true);
    expect(await call(FINDER, 'patients.get', { pluginRef: ruth })).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'patient not found' } });
    const flipped = ruth.slice(0, -2) + (ruth.endsWith('AA') ? 'BB' : 'AA');
    for (const bad of [flipped, 'p1.', 'p1.!!', 'nope', ruth.slice(3)]) {
      expect((await call(EVERYONE, 'patients.get', { pluginRef: bad })).error?.code, bad).toBe('NOT_FOUND');
    }
  });

  it('patients.get takes ref or pluginRef, one of them', async () => {
    const call = await boot(await seeded());
    expect((await call(EVERYONE, 'patients.get', {})).error.code).toBe('INVALID_REQUEST');
    expect((await call(EVERYONE, 'patients.get', { ref: 'a', pluginRef: 'b' })).error.code).toBe('INVALID_REQUEST');
  });

  it('a merged patient carries replacedByPluginRef, which opens the surviving record', async () => {
    const f = await seeded();
    await seedPatient(f.externalDb, { id: 'p-old', surname: 'Mwanza', firstname: 'Jon', org: 'Organization/fac-1', active: false, replacedBy: 'p-1' });
    const call = await boot(f);
    const rows = (await call(EVERYONE, 'patients.search', { search: 'Mwanza', status: 'all' })).result.rows;
    const old = rows.find((r: any) => r.id === 'p-old');
    const live = rows.find((r: any) => r.id === 'p-1');
    expect(live.replacedByPluginRef).toBeNull();
    expect(old.replacedByPluginRef).toBe(live.pluginRef);
    const oldDetail = await call(EVERYONE, 'patients.get', { pluginRef: old.pluginRef });
    expect(oldDetail.result.replacedByPluginRef).toBe(live.pluginRef);
    // After a restart the survivor still opens from it.
    expect((await (await boot(f))(EVERYONE, 'patients.get', { pluginRef: oldDetail.result.replacedByPluginRef })).result.id).toBe('p-1');
  });

  it('names a survivor to a limited caller only when it is inside the caller limit', async () => {
    const f = await seeded();
    // p-in was merged into p-1 (fac-1, inside); p-out into p-2 (fac-2, outside). Both old rows sit at fac-1.
    await seedPatient(f.externalDb, { id: 'p-in', surname: 'Banda', firstname: 'Ann', dob: '1970-02-02', org: 'Organization/fac-1', active: false, replacedBy: 'p-1' });
    await seedPatient(f.externalDb, { id: 'p-out', surname: 'Banda', firstname: 'Bo', dob: '1971-03-03', org: 'Organization/fac-1', active: false, replacedBy: 'p-2' });
    const call = await boot(f);
    const viewer: PluginCaller = { ...SITE, capabilities: ['patients.view'] };
    const rows = (await call(viewer, 'patients.search', { status: 'merged' })).result.rows;
    expect(rows).toHaveLength(2);
    const admin = (await call(EVERYONE, 'patients.search', { search: 'Banda', status: 'merged' })).result.rows;
    const adminIn = admin.find((r: any) => r.id === 'p-in');
    const adminOut = admin.find((r: any) => r.id === 'p-out');
    // An unlimited caller sees both survivors.
    expect(adminIn.replacedByRef).not.toBeNull();
    expect(adminOut.replacedByRef).not.toBeNull();
    expect(adminOut.replacedByPluginRef).not.toBeNull();
    const inRow = rows.find((r: any) => r.pluginRef === adminIn.pluginRef);
    const outRow = rows.find((r: any) => r.pluginRef === adminOut.pluginRef);
    expect(inRow.replacedByRef).not.toBeNull();
    expect(inRow.replacedByPluginRef).toBe(adminIn.replacedByPluginRef);
    expect(outRow).toMatchObject({ replacedByRef: null, replacedByPluginRef: null });
    // patients.get follows the same rule.
    expect((await call(viewer, 'patients.get', { pluginRef: outRow.pluginRef })).result).toMatchObject({ replacedByRef: null, replacedByPluginRef: null });
    const inGet = (await call(viewer, 'patients.get', { pluginRef: inRow.pluginRef })).result;
    expect(inGet.replacedByPluginRef).toBe(adminIn.replacedByPluginRef);
    expect(inGet.replacedByRef).not.toBeNull();
    expect((await call(EVERYONE, 'patients.get', { pluginRef: adminOut.pluginRef })).result.replacedByPluginRef).toBe(adminOut.replacedByPluginRef);
  });

  it('patients.register answers the pluginRef patients.get opens', async () => {
    const f = await seeded();
    const call = await boot(f);
    const reg = await call(FINDER, 'patients.register', { patient: { resourceType: 'Patient', id: 'p-1', managingOrganization: { reference: 'Organization/fac-1' } } });
    const found = await call(FINDER, 'patients.search', { identifier: { value: 'MPI-0001' } });
    expect(reg.result.pluginRef).toBe(found.result.rows[0].pluginRef);
  });
});

describe('plugin host: patients.getMany', () => {
  const MPI = 'urn:zm:mpi';
  const LIMITED = { limited: true as const, facilities: ['fac-1'], districts: [], regions: [] };
  const FINDER: PluginCaller = {
    userId: 'u-find', displayName: 'Finder', facilities: ['fac-1'],
    capabilities: capabilitiesUnderScope(['patients.view', 'patients.view_identifiers', 'patients.find'], LIMITED),
  };

  async function fixture() {
    const f = await buildPatientIndexFixture();
    await seedPatient(f.externalDb, { id: 'p-1', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05', org: 'Organization/FAC-1' });
    await seedPatient(f.externalDb, { id: 'p-2', surname: 'Mwale', firstname: 'Ruth', dob: '1985-03-04', org: 'Organization/fac-2' });
    await seedPatient(f.externalDb, { id: 'p-old', surname: 'Mwanza', firstname: 'Jon', org: 'Organization/fac-1', active: false, replacedBy: 'p-2' });
    await seedIdentifier(f.externalDb, 'p-1', MPI, 'MPI-0001');
    const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', refKey: randomBytes(32) });
    const deps = fakeDeps({ patients: index });
    const host = createPluginHost(deps);
    const call = (caller: PluginCaller, op: string, input: unknown) =>
      host.forCall(plugin(REGISTERS), caller).ce_read({ op, input }) as Promise<any>;
    const refs = pluginPatientRefs(KEY, 'lab');
    return { deps, call, john: refs.encode('p-1'), ruth: refs.encode('p-2'), old: refs.encode('p-old') };
  }

  it('answers each ref as patients.get does, in input order, with null where patients.get finds nothing', async () => {
    const { call, john, ruth } = await fixture();
    const missing = pluginPatientRefs(KEY, 'lab').encode('p-none');
    const otherPlugin = pluginPatientRefs(KEY, 'other').encode('p-1');
    const out = await call(EVERYONE, 'patients.getMany', { pluginRefs: [ruth, 'nope', john, missing, otherPlugin, john] });
    expect(out.ok).toBe(true);
    const rows = out.result.rows;
    expect(rows).toHaveLength(6);
    // `ref` is CE's boot-time ref, written fresh on every answer; the rest is patients.get's answer.
    const same = (r: any) => ({ ...r, ref: expect.any(String) });
    expect(rows[0]).toEqual(same((await call(EVERYONE, 'patients.get', { pluginRef: ruth })).result));
    expect(rows[2]).toEqual(same((await call(EVERYONE, 'patients.get', { pluginRef: john })).result));
    expect(rows[5]).toEqual(same(rows[2]));
    expect([rows[1], rows[3], rows[4]]).toEqual([null, null, null]);
  });

  it('masks unless the caller holds view_identifiers, and leaves out a patient outside the data limit', async () => {
    const { call, deps, john, ruth } = await fixture();
    const out = await call(FINDER, 'patients.getMany', { pluginRefs: [john, ruth] });
    expect(out.result.rows[0]).toMatchObject({ masked: true, id: null, name: 'J*** M***', pluginRef: john });
    expect(out.result.rows[1]).toBeNull();
    expect(JSON.stringify(out.result)).not.toMatch(/Mwanza|Mwale|p-1|p-2/);
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it('does not name a merged patient survivor outside the caller limit', async () => {
    const { call, old } = await fixture();
    const site: PluginCaller = { ...SITE, capabilities: ['patients.view'] };
    expect((await call(site, 'patients.getMany', { pluginRefs: [old] })).result.rows[0]).toMatchObject({ replacedByRef: null, replacedByPluginRef: null });
    expect((await call(EVERYONE, 'patients.getMany', { pluginRefs: [old] })).result.rows[0].replacedByPluginRef).not.toBeNull();
  });

  it('audits an unmasked read once per call, with the count', async () => {
    const { call, deps, john, ruth } = await fixture();
    await call(EVERYONE, 'patients.getMany', { pluginRefs: [john, ruth, john, 'nope'] });
    expect(deps.audit).toHaveBeenCalledTimes(1);
    expect(deps.audit).toHaveBeenCalledWith(
      { actorType: 'user', actorId: 'u-admin', actorName: 'Admin' },
      { action: 'patients.view', entityType: 'patient', entityId: 'many', metadata: { pluginId: 'lab', pluginVersion: '0.2.0', count: 2, ids: ['p-1', 'p-2'] } },
    );
    vi.mocked(deps.audit).mockClear();
    await call(EVERYONE, 'patients.getMany', { pluginRefs: ['nope'] });
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it('takes 1 to 100 refs and nothing else', async () => {
    const { call, john } = await fixture();
    for (const input of [{}, { pluginRefs: [] }, { pluginRefs: Array(101).fill(john) }, { pluginRefs: [''] }, { pluginRefs: [john], extra: 1 }, { pluginRefs: john }]) {
      expect((await call(EVERYONE, 'patients.getMany', input)).error?.code, JSON.stringify(input).slice(0, 60)).toBe('INVALID_REQUEST');
    }
    expect((await call(EVERYONE, 'patients.getMany', { pluginRefs: Array(100).fill(john) })).result.rows).toHaveLength(100);
  });
});

describe('plugin host: facilities.get', () => {
  const row = { id: 'fac-1', name: 'Alpha Clinic', facilityCode: 'A1', level: 'clinic', status: 'active', region: 'R', district: 'D', source: 'manual' };
  const registry = () => ({ list: vi.fn(), idsMatching: vi.fn(), get: vi.fn(async (id: string) => (id === 'fac-1' || id === 'fac-2' ? { ...row, id } : undefined)) });

  it('gives one facility in the shape of a facilities.search row', async () => {
    const fns = createPluginHost(fakeDeps({ facilityRegistry: registry() as any })).forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE);
    expect(await fns.ce_read({ op: 'facilities.get', input: { id: 'fac-1' } })).toEqual({ ok: true, result: {
      id: 'fac-1', name: 'Alpha Clinic', facilityCode: 'A1', level: 'clinic', status: 'active', region: 'R', district: 'D',
    } });
  });

  it('answers a missing facility, and one outside the data limit, as not found', async () => {
    const reg = registry();
    const fns = createPluginHost(fakeDeps({ facilityRegistry: reg as any })).forCall(plugin([{ kind: 'host:ce-read' }]), SITE);
    const notFound = { ok: false, error: { code: 'NOT_FOUND', message: 'facilities.get: facility not found' } };
    expect(await fns.ce_read({ op: 'facilities.get', input: { id: 'fac-2' } })).toEqual(notFound);
    expect(reg.get).not.toHaveBeenCalled();
    expect((await fns.ce_read({ op: 'facilities.get', input: { id: 'fac-1' } }) as any).result.id).toBe('fac-1');
    // Compared without case, for the limit and for the lookup alike.
    expect((await fns.ce_read({ op: 'facilities.get', input: { id: 'FAC-1' } }) as any).result.id).toBe('fac-1');
    expect(reg.get).toHaveBeenLastCalledWith('fac-1');
    const admin = createPluginHost(fakeDeps({ facilityRegistry: reg as any })).forCall(plugin([{ kind: 'host:ce-read' }]), EVERYONE);
    expect(await admin.ce_read({ op: 'facilities.get', input: { id: 'fac-9' } })).toEqual(notFound);
    expect((await admin.ce_read({ op: 'facilities.get', input: {} }) as any).error.code).toBe('INVALID_REQUEST');
  });
});

describe('plugin host: testCatalog.resultParams', () => {
  const T = (code: string) => ({ system: 'urn:openldr:cs:test-catalog', code });
  const BANDS: ResultBand[] = [
    { name: 'Adult men', low: 13, high: 17, unit: 'g/dL', sex: 'male', ageLow: 18, ageHigh: null },
    { name: 'Adult women', low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null },
  ];
  /** resultParamsFor with the catalog's own band rules, so the bands answered are what CE picks. */
  const resultParamsFor = vi.fn(async (tests: Array<{ system: string; code: string }>, patient: BandPatient) =>
    tests.map((test) => ({
      test,
      params: [{
        system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null, bands: BANDS,
        unit: 'g/dL', display: 'HGB', band: matchBand(BANDS, patient), fits: BANDS.map((b) => bandFit(b, patient)),
      }],
    })));

  async function fixture() {
    const f = await buildPatientIndexFixture();
    await seedPatient(f.externalDb, { id: 'p-1', surname: 'Mwanza', firstname: 'Ruth', dob: '1990-01-05', sex: 'F', org: 'Organization/fac-1' });
    await seedPatient(f.externalDb, { id: 'p-2', surname: 'Mwale', firstname: 'John', dob: '1985-03-04', sex: 'M', org: 'Organization/fac-2' });
    const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', refKey: randomBytes(32) });
    const fhir: Record<string, unknown> = {
      'Patient/p-1': { resourceType: 'Patient', id: 'p-1', gender: 'female', birthDate: '1990-01-05' },
      'Patient/p-2': { resourceType: 'Patient', id: 'p-2', gender: 'male', birthDate: '1985-03-04' },
    };
    resultParamsFor.mockClear();
    const deps = fakeDeps({
      patients: index,
      testCatalog: { list: vi.fn(), get: vi.fn(), resultParamsFor } as any,
      fhirGetWithProvenance: vi.fn(async (t: string, id: string) => (fhir[`${t}/${id}`] ? stored(fhir[`${t}/${id}`], 'ingest') : null)),
    });
    const host = createPluginHost(deps);
    const call = (caller: PluginCaller, input: unknown) =>
      host.forCall(plugin([{ kind: 'host:ce-read' }]), caller).ce_read({ op: 'testCatalog.resultParams', input }) as Promise<any>;
    const refs = pluginPatientRefs(KEY, 'lab');
    return { deps, call, ruth: refs.encode('p-1'), john: refs.encode('p-2') };
  }

  it('answers each test with the band that fits a known patient, its name and fits, and the sex labels', async () => {
    const { call, ruth } = await fixture();
    const out = await call(SITE, { tests: [T('FBC')], patientRef: ruth });
    expect(out.ok).toBe(true);
    expect(out.result.sexes).toEqual(SEX_OPTIONS);
    expect(out.result.sexes.find((s: any) => s.code === 'female').labels).toEqual({ en: 'Female', fr: 'Femme', pt: 'Feminino' });
    const param = out.result.tests[0].params[0];
    expect(out.result.tests[0].test).toEqual(T('FBC'));
    expect(param.band.name).toBe('Adult women');
    expect(param.fits).toEqual(['no', 'yes']);
    // CE read sex and the birth date from the stored Patient (born 1990-01-05).
    const key = resultParamsFor.mock.calls[0][1];
    expect(key.sex).toBe('female');
    expect(key.birthDate).toBe('1990-01-05');
  });

  it('answers the age unit of each range, and fits a newborn by days', async () => {
    const { call, deps, ruth } = await fixture();
    vi.mocked(deps.fhirGetWithProvenance).mockResolvedValue(stored({ resourceType: 'Patient', id: 'p-1', gender: 'female', birthDate: new Date().toISOString().slice(0, 10) }, 'ingest'));
    const NEWBORN: ResultBand[] = [
      { name: null, low: 14, high: 22, unit: 'g/dL', sex: null, ageLow: 0, ageHigh: 28, ageUnit: 'd' },
      { name: 'Adult women', low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null },
    ];
    resultParamsFor.mockImplementationOnce(async (tests, patient) => tests.map((test) => ({
      test,
      params: [{
        system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null, bands: NEWBORN,
        unit: 'g/dL', display: 'HGB', band: matchBand(NEWBORN, patient), fits: NEWBORN.map((b) => bandFit(b, patient)),
      }],
    })));
    const param = (await call(SITE, { tests: [T('FBC')], patientRef: ruth })).result.tests[0].params[0];
    expect(param.bands[0].ageUnit).toBe('d');
    expect(param.band).toEqual(NEWBORN[0]);
    expect(param.fits).toEqual(['yes', 'no']);
  });

  it('reads the estimated birth date mark from the stored Patient', async () => {
    const { call, deps, ruth } = await fixture();
    vi.mocked(deps.fhirGetWithProvenance).mockResolvedValue(stored({
      resourceType: 'Patient', id: 'p-1', gender: 'female', birthDate: '2026-01-01',
      extension: [{ url: 'urn:openldr:ext:birthdate-estimated', valueBoolean: true }],
    }, 'ingest'));
    await call(SITE, { tests: [T('FBC')], patientRef: ruth });
    expect(resultParamsFor.mock.calls[0][1]).toMatchObject({ birthDate: '2026-01-01', birthDateEstimated: true });
  });

  it('reads the patient age in the lab time zone', async () => {
    const { call, deps, ruth } = await fixture();
    // Wired as index.ts wires it: the real lab identity service over a settings store.
    const labIdentity = createLabIdentity(memorySettings());
    expect(await labIdentity.set({ 'lab.timezone': 'Africa/Nairobi' }, 'test')).toEqual([]);
    deps.labTimeZone = () => labTimeZone(labIdentity);
    await call(SITE, { tests: [T('FBC')], patientRef: ruth });
    expect(resultParamsFor.mock.calls[0][1]).toMatchObject({ birthDate: '1990-01-05', timeZone: 'Africa/Nairobi' });
  });

  it('does not return the patient sex, age, birth date or id', async () => {
    const { call, ruth } = await fixture();
    const out = await call(SITE, { tests: [T('FBC')], patientRef: ruth });
    const text = JSON.stringify(out.result);
    expect(text).not.toMatch(/1990|p-1|Mwanza|ageYears|birthDate|"gender"/);
    expect(Object.keys(out.result).sort()).toEqual(['sexes', 'tests']);
  });

  it('answers not found for a patient outside the caller limit, a ref of another plugin, or a bad ref', async () => {
    const { call, deps, john } = await fixture();
    const notFound = { ok: false, error: { code: 'NOT_FOUND', message: 'patient not found' } };
    expect(await call(SITE, { tests: [T('FBC')], patientRef: john })).toEqual(notFound);
    expect(await call(SITE, { tests: [T('FBC')], patientRef: pluginPatientRefs(KEY, 'other').encode('p-1') })).toEqual(notFound);
    expect(await call(SITE, { tests: [T('FBC')], patientRef: 'p1.nope' })).toEqual(notFound);
    expect(resultParamsFor).not.toHaveBeenCalled();
    expect(deps.fhirGetWithProvenance).not.toHaveBeenCalled();
    // The same patient opens for an unlimited caller.
    expect((await call(EVERYONE, { tests: [T('FBC')], patientRef: john })).result.tests[0].params[0].band.name).toBe('Adult men');
  });

  it('needs patients.view or patients.find, and 1 to 20 tests', async () => {
    const { call, ruth } = await fixture();
    const none: PluginCaller = { ...SITE, capabilities: [] };
    expect((await call(none, { tests: [T('FBC')], patientRef: ruth })).error.code).toBe('FORBIDDEN');
    const finder: PluginCaller = { ...SITE, capabilities: ['patients.find'] };
    expect((await call(finder, { tests: [T('FBC')], patientRef: ruth })).ok).toBe(true);
    expect((await call(SITE, { tests: [], patientRef: ruth })).error.code).toBe('INVALID_REQUEST');
    expect((await call(SITE, { tests: Array.from({ length: 21 }, (_, n) => T(`T${n}`)), patientRef: ruth })).error.code).toBe('INVALID_REQUEST');
    expect((await call(SITE, { tests: [T('FBC')] })).error.code).toBe('INVALID_REQUEST');
    expect((await call(SITE, { tests: [T('FBC')], patientRef: ruth, sex: 'male' })).error.code).toBe('INVALID_REQUEST');
  });

  it('answers catch-all fits when the stored Patient is missing', async () => {
    const { call, deps, ruth } = await fixture();
    vi.mocked(deps.fhirGetWithProvenance).mockResolvedValue(null);
    const out = await call(SITE, { tests: [T('FBC')], patientRef: ruth });
    expect(resultParamsFor.mock.calls[0][1]).toMatchObject({ sex: null, birthDate: null });
    expect(out.result.tests[0].params[0]).toMatchObject({ band: null, fits: ['unknown', 'unknown'] });
  });
});

describe('plugin host: fhir_emit with a patient pluginRef', () => {
  const emit = plugin([{ kind: 'emit-fhir', resourceTypes: ['Observation', 'Specimen', 'Provenance', 'ServiceRequest'] }, { kind: 'host:db' }]);

  async function fixture() {
    const f = await buildPatientIndexFixture();
    await seedPatient(f.externalDb, { id: 'p-1', surname: 'Mwanza', firstname: 'Ruth', dob: '1990-01-05', org: 'Organization/fac-1' });
    const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', refKey: randomBytes(32) });
    const deps = fakeDeps({ patients: index });
    const fns = createPluginHost(deps).forCall(emit, EVERYONE);
    return { deps, fns, ruth: pluginPatientRefs(KEY, 'lab').encode('p-1') };
  }

  it('writes the real id into subject and nested references before it saves', async () => {
    const { deps, fns, ruth } = await fixture();
    const sent = [
      { resourceType: 'ServiceRequest', id: 'sr-1', subject: { reference: `Patient/${ruth}` } },
      { resourceType: 'Specimen', id: 'sp-1', subject: { reference: `Patient/${ruth}`, display: 'kept' } },
      { resourceType: 'Observation', id: 'o-1', subject: { reference: `Patient/${ruth}` }, specimen: { reference: 'Specimen/sp-1' },
        hasMember: [{ reference: 'Observation/o-2' }], extension: [{ url: 'x', valueReference: { reference: `Patient/${ruth}` } }] },
      { resourceType: 'Provenance', id: 'pv-1', target: [{ reference: 'Observation/o-1' }, { reference: `Patient/${ruth}` }],
        agent: [{ who: { reference: 'Practitioner/pr-1' }, onBehalfOf: { reference: `Patient/${ruth}` } }] },
    ];
    const before = JSON.stringify(sent);
    expect(await fns.fhir_emit({ resources: sent })).toEqual({ ok: true, result: { saved: 4 } });
    const saved = vi.mocked(deps.persist).mock.calls[0][0] as any[];
    expect(saved[0].subject).toEqual({ reference: 'Patient/p-1' });
    expect(saved[1].subject).toEqual({ reference: 'Patient/p-1', display: 'kept' });
    expect(saved[2]).toMatchObject({
      subject: { reference: 'Patient/p-1' }, specimen: { reference: 'Specimen/sp-1' },
      hasMember: [{ reference: 'Observation/o-2' }], extension: [{ url: 'x', valueReference: { reference: 'Patient/p-1' } }],
    });
    expect(saved[3].target).toEqual([{ reference: 'Observation/o-1' }, { reference: 'Patient/p-1' }]);
    expect(saved[3].agent[0]).toEqual({ who: { reference: 'Practitioner/pr-1' }, onBehalfOf: { reference: 'Patient/p-1' } });
    expect(JSON.stringify(saved)).not.toContain('p1.');
    // The plugin's own records are not changed in place.
    expect(JSON.stringify(sent)).toBe(before);
  });

  it('refuses the whole send when a pluginRef does not resolve, and saves nothing', async () => {
    const { deps, fns, ruth } = await fixture();
    const missing = pluginPatientRefs(KEY, 'lab').encode('p-none');
    const otherPlugin = pluginPatientRefs(KEY, 'other').encode('p-1');
    for (const bad of [missing, otherPlugin, 'p1.nope']) {
      const out = await fns.fhir_emit({ resources: [
        { resourceType: 'Observation', id: 'o-1', subject: { reference: `Patient/${ruth}` } },
        { resourceType: 'Specimen', id: 'sp-1', subject: { reference: `Patient/${bad}` } },
      ] }) as any;
      expect(out.ok, bad).toBe(false);
      expect(out.error.code).toBe('NOT_FOUND');
      expect(out.error.message).toMatch(/nothing was saved/);
    }
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it('leaves a plain Patient/<id> and other references as the plugin wrote them', async () => {
    const { deps, fns } = await fixture();
    const sent = [{ resourceType: 'Observation', id: 'o-1', subject: { reference: 'Patient/p-1' }, performer: [{ reference: 'Organization/fac-1' }], note: [{ text: 'Patient/p1.x in text' }] }];
    expect((await fns.fhir_emit({ resources: sent }) as any).ok).toBe(true);
    expect(vi.mocked(deps.persist).mock.calls[0][0]).toEqual(sent);
  });

  it('needs patients.view or patients.find when a send carries a pluginRef, and saves nothing without it', async () => {
    const { deps, ruth } = await fixture();
    const noPatients: PluginCaller = { ...EVERYONE, capabilities: [] };
    const fns = createPluginHost(deps).forCall(emit, noPatients);
    const out = await fns.fhir_emit({ resources: [{ resourceType: 'Observation', id: 'o-1', subject: { reference: `Patient/${ruth}` } }] }) as any;
    expect(out.error.code).toBe('FORBIDDEN');
    expect(deps.persist).not.toHaveBeenCalled();
    // Without a pluginRef the send does not need patient access.
    expect((await fns.fhir_emit({ resources: [{ resourceType: 'Observation', id: 'o-2', subject: { reference: 'Patient/p-1' } }] }) as any).ok).toBe(true);
    // patients.find alone is enough.
    const finder = createPluginHost(deps).forCall(emit, { ...EVERYONE, capabilities: ['patients.find'] });
    expect((await finder.fhir_emit({ resources: [{ resourceType: 'Observation', id: 'o-3', subject: { reference: `Patient/${ruth}` } }] }) as any).ok).toBe(true);
  });

  it('refuses more than 200 distinct pluginRefs in one send, and saves nothing', async () => {
    const { deps, fns, ruth } = await fixture();
    const refs = pluginPatientRefs(KEY, 'lab');
    const many = Array.from({ length: 201 }, (_, n) => ({ resourceType: 'Observation', id: `o-${n}`, subject: { reference: `Patient/${refs.encode(`p-${n}`)}` } }));
    const out = await fns.fhir_emit({ resources: many }) as any;
    expect(out.error.code).toBe('INVALID_REQUEST');
    expect(out.error.message).toMatch(/200.*nothing was saved/);
    // The same ref many times counts once.
    const same = Array.from({ length: 250 }, (_, n) => ({ resourceType: 'Observation', id: `o-${n}`, subject: { reference: `Patient/${ruth}` } }));
    expect((await fns.fhir_emit({ resources: same }) as any).ok).toBe(true);
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it('refuses a patient link in any form other than Patient/ and a pluginRef, and saves nothing', async () => {
    const { deps, fns, ruth } = await fixture();
    for (const bad of [`patient/${ruth}`, `https://ce.example/fhir/Patient/${ruth}`, `Patient/${ruth}/_history/1`, `Patient/${ruth}?x=1`, `Group/${ruth}`]) {
      const out = await fns.fhir_emit({ resources: [{ resourceType: 'Observation', id: 'o-1', focus: [{ reference: bad }] }] }) as any;
      expect(out.error?.code, bad).toBe('INVALID_REQUEST');
      expect(out.error.message).toMatch(/exactly Patient\/ followed by a pluginRef/);
    }
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('checks ownership against the rewritten records', async () => {
    const { deps, fns, ruth } = await fixture();
    vi.mocked(deps.fhirGetWithProvenance).mockResolvedValue(stored({ resourceType: 'Observation', id: 'o-1' }, 'disa-ingest') as any);
    const out = await fns.fhir_emit({ resources: [{ resourceType: 'Observation', id: 'o-1', subject: { reference: `Patient/${ruth}` } }] }) as any;
    expect(out.error.code).toBe('FORBIDDEN');
    expect(deps.persist).not.toHaveBeenCalled();
  });
});
