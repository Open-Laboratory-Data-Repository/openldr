import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  TestCatalogError, createLabIdentity, type AppContext, type CatalogImportReport, type CatalogOptions, type CatalogTest, type LoincHints, SEX_OPTIONS,
} from '@openldr/bootstrap';
import { registerTestCatalogRoutes } from './test-catalog-routes';
import './auth-plugin';
/** A settings store held in memory, for the real lab identity service. */
function memorySettings() {
  const rows = new Map<string, string>();
  return {
    get: async (key: string) => (rows.has(key) ? { key, value: rows.get(key)!, updatedAt: new Date(0), updatedBy: null } : null),
    getAll: async () => [...rows].map(([key, value]) => ({ key, value, updatedAt: new Date(0), updatedBy: null })),
    set: async (key: string, value: string) => { rows.set(key, value); },
  };
}


const TEST: CatalogTest = {
  code: 'HIVVL', testCode: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
  specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD' }], resultParams: [], loinc: '25836-8', active: true,
  expectedTatHours: 48, criticalTatHours: 72, requiresVerification: true, codings: [],
  lab: { enabled: false, specimenTypes: null, localDisplay: null },
};

const OPTIONS: CatalogOptions = {
  categories: [{ code: 'MOL', display: 'Molecular' }],
  specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }],
  resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', display: 'Haemoglobin', units: 'g/dL' }],
  loinc: null,
  ucum: { systemId: 'cs-ucum-seed', system: 'http://unitsofmeasure.org' },
  sexes: [{ code: 'female', labels: { en: 'Female', fr: 'Femme', pt: 'Feminino' } }],
};

const REPORT: CatalogImportReport = {
  counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [], notes: [],
  unmatched: { categories: [], specimens: [] }, categoriesToAdd: [{ code: 'VIRO', display: 'Virology' }], loincChecked: false,
};

type Impl = (...args: any[]) => Promise<unknown>;

type Method = 'list' | 'get' | 'create' | 'update' | 'setLabSettings' | 'options' | 'setEnabled' | 'setActive'
  | 'importPreview' | 'importApply' | 'exportCsv' | 'specimensFor' | 'resultParamsFor';

function fakeCtx(over: Partial<Record<Method, Impl>> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const spy = (method: string, impl: Impl): Impl => async (...args) => {
    calls.push({ method, args });
    return impl(...args);
  };
  const testCatalog = {
    list: spy('list', over.list ?? (async () => ({ rows: [TEST], total: 1, ownedHere: true }))),
    get: spy('get', over.get ?? (async (code: string) => (code === 'HIVVL' ? TEST : null))),
    create: spy('create', over.create ?? (async () => TEST)),
    update: spy('update', over.update ?? (async () => TEST)),
    setLabSettings: spy('setLabSettings', over.setLabSettings ?? (async () => TEST)),
    options: spy('options', over.options ?? (async () => OPTIONS)),
    setEnabled: spy('setEnabled', over.setEnabled ?? (async () => TEST)),
    setActive: spy('setActive', over.setActive ?? (async () => TEST)),
    importPreview: spy('importPreview', over.importPreview ?? (async () => REPORT)),
    importApply: spy('importApply', over.importApply ?? (async () => REPORT)),
    exportCsv: spy('exportCsv', over.exportCsv ?? (async () => 'code,name\nHIVVL,HIV viral load\n')),
    specimensFor: spy('specimensFor', over.specimensFor ?? (async () => [{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }])),
    resultParamsFor: spy('resultParamsFor', over.resultParamsFor ?? (async () => [
      { test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' },
        params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [], unit: 'g/dL', display: 'Haemoglobin', band: null }] },
    ])),
  };
  const ctx = {
    testCatalog,
    audit: { record: async (e: Record<string, unknown>) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    fhirStore: { get: async () => ({ resourceType: 'Patient', id: 'p1', gender: 'female', birthDate: '1990-01-01' }) },
    terminology: {
      ops: {
        expand: async (url: string) => ({
          expansion: {
            contains: url.includes('order')
              ? [{ system: 'urn:openldr:cs:reject-order', code: 'WRONGPT', display: 'Wrong patient' }]
              : [{ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }],
          },
        }),
      },
    },
  } as unknown as AppContext;
  return { ctx, calls, audit };
}

function appWith(ctx: AppContext, capabilities: string[] = ['terminology.view', 'terminology.manage']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'], capabilities };
  });
  registerTestCatalogRoutes(app, ctx);
  return app;
}

describe('test catalog routes', () => {
  it('GET /api/test-catalog hands the parsed filters to the store and returns its answer as is', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog?q=viral&loinc=linked&enabled=on&limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rows: [TEST], total: 1, ownedHere: true });
    expect(calls).toEqual([
      { method: 'list', args: [{ q: 'viral', loinc: 'linked', enabled: true, status: 'active', limit: 10, offset: 0 }] },
    ]);
  });

  it('GET /api/test-catalog refuses a bad filter in the parser\'s words, before the store', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog?status=gone' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'status must be "active", "retired" or "all"' });
    expect(calls).toEqual([]);
  });

  it('reads need terminology.view and writes need terminology.manage', async () => {
    const { ctx } = fakeCtx();
    expect((await appWith(ctx, []).inject({ method: 'GET', url: '/api/test-catalog' })).statusCode).toBe(403);
    const viewer = appWith(ctx, ['terminology.view']);
    expect((await viewer.inject({ method: 'GET', url: '/api/test-catalog' })).statusCode).toBe(200);
    expect((await viewer.inject({ method: 'POST', url: '/api/test-catalog', payload: { testCode: 'X', display: 'X' } })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL', payload: { display: 'X' } })).statusCode).toBe(403);
    expect((await viewer.inject({
      method: 'PUT', url: '/api/test-catalog/HIVVL/lab', payload: { enabled: true, specimenTypes: null, localDisplay: null },
    })).statusCode).toBe(403);
  });

  it('POST creates a test, answers 201 with it, and audits the create', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const body = { testCode: 'HIVVL', display: 'HIV viral load', loinc: '25836-8', specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD' }] };
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(TEST);
    expect(calls).toEqual([{ method: 'create', args: [body] }]);
    expect(audit).toMatchObject([{ action: 'test_catalog.create', entityType: 'test_catalog', entityId: 'HIVVL', before: null, after: TEST }]);
  });

  it('POST hands the store the Test code, audits under the new id and answers both', async () => {
    const made = { ...TEST, code: 'tst-0123456789abcdef', testCode: 'HB', display: 'Haemoglobin' };
    const { ctx, calls, audit } = fakeCtx({ create: async () => made });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: { testCode: 'HB', display: 'Haemoglobin' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ code: 'tst-0123456789abcdef', testCode: 'HB' });
    expect(calls).toEqual([{ method: 'create', args: [{ testCode: 'HB', display: 'Haemoglobin' }] }]);
    expect(audit).toMatchObject([{ entityId: 'tst-0123456789abcdef', metadata: { testCode: 'HB' } }]);
  });

  it('PUT /:code changes the Test code of the test the id names, and the audit names old and new', async () => {
    const after = { ...TEST, testCode: 'VL' };
    const { ctx, calls, audit } = fakeCtx({ update: async () => after });
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL', payload: { testCode: 'VL', display: 'HIV viral load' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ code: 'HIVVL', testCode: 'VL' });
    expect(calls.find((c) => c.method === 'update')?.args).toEqual(['HIVVL', { testCode: 'VL', display: 'HIV viral load' }]);
    expect(audit).toMatchObject([{
      action: 'test_catalog.update', entityId: 'HIVVL', before: TEST, after, metadata: { testCode: { from: 'HIVVL', to: 'VL' } },
    }]);
  });

  it('POST refuses a body with no name before the store', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: { testCode: 'X' } });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('maps each catalog error to its status and keeps its words', async () => {
    const cases: Array<[TestCatalogError['kind'], number]> = [
      ['invalid', 400], ['not-found', 404], ['conflict', 409], ['central-managed', 409],
    ];
    for (const [kind, status] of cases) {
      const { ctx, audit } = fakeCtx({ create: async () => { throw new TestCatalogError(`refused: ${kind}`, kind); } });
      const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: { testCode: 'X', display: 'X' } });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ error: `refused: ${kind}`, kind });
      expect(audit).toEqual([]);
    }
  });

  it('PUT /:code updates the test the path names and audits before and after', async () => {
    const after = { ...TEST, display: 'HIV-1 viral load' };
    const { ctx, calls, audit } = fakeCtx({ update: async () => after });
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL', payload: { display: 'HIV-1 viral load' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(after);
    expect(calls).toEqual([
      { method: 'get', args: ['HIVVL'] },
      { method: 'update', args: ['HIVVL', { display: 'HIV-1 viral load' }] },
    ]);
    expect(audit).toMatchObject([{ action: 'test_catalog.update', entityType: 'test_catalog', entityId: 'HIVVL', before: TEST, after }]);
  });

  it('PUT /:code hands the store a decoded code', async () => {
    const { ctx, calls } = fakeCtx();
    await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIV%20VL', payload: { display: 'X' } });
    expect(calls.find((c) => c.method === 'update')?.args[0]).toBe('HIV VL');
  });

  it('PUT /:code/lab saves this lab\'s settings and audits them', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const body = { enabled: true, specimenTypes: null, localDisplay: 'Viral load' };
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/lab', payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(TEST);
    expect(calls).toEqual([
      { method: 'get', args: ['HIVVL'] },
      { method: 'setLabSettings', args: ['HIVVL', body] },
    ]);
    expect(audit).toMatchObject([{ action: 'test_catalog.lab_settings', entityType: 'test_catalog', entityId: 'HIVVL', before: TEST.lab, after: TEST.lab }]);
  });

  it('GET /api/test-catalog/options returns the picker choices and needs terminology.view', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/options' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(OPTIONS);
    expect(calls).toEqual([{ method: 'options', args: [] }]);
    expect((await appWith(ctx, []).inject({ method: 'GET', url: '/api/test-catalog/options' })).statusCode).toBe(403);
  });

  it('PUT /:code/enabled switches a test and audits it as test_catalog.enable', async () => {
    const after = { ...TEST, lab: { ...TEST.lab, enabled: true } };
    const { ctx, calls, audit } = fakeCtx({ setEnabled: async () => after });
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/enabled', payload: { enabled: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(after);
    expect(calls).toEqual([
      { method: 'get', args: ['HIVVL'] },
      { method: 'setEnabled', args: ['HIVVL', true] },
    ]);
    expect(audit).toMatchObject([{
      action: 'test_catalog.enable', entityType: 'test_catalog', entityId: 'HIVVL', before: { enabled: false }, after: { enabled: true },
    }]);
  });

  it('PUT /:code/active retires a test and audits it as test_catalog.retire', async () => {
    const after = { ...TEST, active: false };
    const { ctx, calls, audit } = fakeCtx({ setActive: async () => after });
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/active', payload: { active: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(after);
    expect(calls).toEqual([
      { method: 'get', args: ['HIVVL'] },
      { method: 'setActive', args: ['HIVVL', false] },
    ]);
    expect(audit).toMatchObject([{
      action: 'test_catalog.retire', entityType: 'test_catalog', entityId: 'HIVVL', before: { active: true }, after: { active: false },
    }]);
  });

  it('the row-change routes need terminology.manage and a boolean body', async () => {
    const { ctx, calls } = fakeCtx();
    const viewer = appWith(ctx, ['terminology.view']);
    expect((await viewer.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/enabled', payload: { enabled: true } })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/active', payload: { active: false } })).statusCode).toBe(403);
    const admin = appWith(ctx);
    expect((await admin.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/enabled', payload: { enabled: 'yes' } })).statusCode).toBe(400);
    expect((await admin.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/active', payload: {} })).statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('maps a row-change refusal to its status, keeps its words and audits nothing', async () => {
    const { ctx, audit } = fakeCtx({ setActive: async () => { throw new TestCatalogError('central only', 'central-managed'); } });
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/active', payload: { active: false } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'central only', kind: 'central-managed' });
    expect(audit).toEqual([]);
  });

  it('POST /import/read reads the raw file and answers its table and suggested columns', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({
      method: 'POST', url: '/api/test-catalog/import/read?format=csv',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('Test code,Test name\nHIVVL,HIV viral load\n'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      headers: ['Test code', 'Test name'], rows: [['HIVVL', 'HIV viral load']], sheetName: null, sheetCount: 1,
      suggested: { code: 'Test code', name: 'Test name' },
    });
    // Reading a file touches no data, so no service call.
    expect(calls).toEqual([]);
  });

  it('POST /import/read refuses a bad format, a body that is not a file, and a file over 5 MB, in words', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx);
    const badFormat = await app.inject({
      method: 'POST', url: '/api/test-catalog/import/read?format=pdf',
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x'),
    });
    expect(badFormat.statusCode).toBe(400);
    expect(badFormat.json()).toEqual({ error: 'format must be "csv" or "xlsx"' });

    const json = await app.inject({ method: 'POST', url: '/api/test-catalog/import/read?format=csv', payload: { a: 1 } });
    expect(json.statusCode).toBe(400);
    expect(json.json()).toEqual({ error: 'Send the file itself as the request body, as application/octet-stream.' });

    const big = await app.inject({
      method: 'POST', url: '/api/test-catalog/import/read?format=csv',
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(5 * 1024 * 1024 + 1, 0x61),
    });
    expect(big.statusCode).toBe(400);
    expect(big.json()).toEqual({ error: 'The file is larger than 5 MB, the limit.', kind: 'invalid' });
  });

  it('import needs terminology.manage, and export needs terminology.view', async () => {
    const { ctx } = fakeCtx();
    const viewer = appWith(ctx, ['terminology.view']);
    const body = { table: { headers: ['name'], rows: [] }, columnMap: { name: 'name' } };
    expect((await viewer.inject({
      method: 'POST', url: '/api/test-catalog/import/read?format=csv',
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('name\nA\n'),
    })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'POST', url: '/api/test-catalog/import/preview', payload: body })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'POST', url: '/api/test-catalog/import/apply', payload: body })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'GET', url: '/api/test-catalog/export' })).statusCode).toBe(200);
  });

  it('POST /import/preview hands the checked body to the service, and refuses a bad one before it', async () => {
    const { ctx, calls } = fakeCtx();
    const app = appWith(ctx);
    const body = { table: { headers: ['code', 'name'], rows: [['A', 'Alpha']] }, columnMap: { code: 'code', name: 'name' } };
    const res = await app.inject({ method: 'POST', url: '/api/test-catalog/import/preview', payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(REPORT);
    expect(calls).toEqual([{ method: 'importPreview', args: [body] }]);

    const bad = await app.inject({
      method: 'POST', url: '/api/test-catalog/import/preview',
      payload: { ...body, columnMap: { name: 'name', notes: 'notes' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('takes an import step body over 1 MB, the Fastify default', async () => {
    const { ctx } = fakeCtx();
    const rows = Array.from({ length: 5000 }, (_, i) => [`T${i}`, 'x'.repeat(300)]);
    const res = await appWith(ctx).inject({
      method: 'POST', url: '/api/test-catalog/import/preview',
      payload: { table: { headers: ['code', 'name'], rows }, columnMap: { code: 'code', name: 'name' } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /import/apply applies, audits the counts and the categories added, and answers the report', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const body = { table: { headers: ['code', 'name'], rows: [['A', 'Alpha']] }, columnMap: { code: 'code', name: 'name' } };
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog/import/apply', payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(REPORT);
    expect(calls).toEqual([{ method: 'importApply', args: [body] }]);
    expect(audit).toMatchObject([{
      action: 'test_catalog.import', entityType: 'test_catalog', entityId: 'urn:openldr:codesystem:test-catalog',
      metadata: { counts: REPORT.counts, categoriesAdded: ['VIRO'] },
    }]);
  });

  it('POST /import/apply keeps a refusal words and audits nothing', async () => {
    const { ctx, audit } = fakeCtx({
      importApply: async () => { throw new TestCatalogError('This catalog comes from central.', 'central-managed'); },
    });
    const res = await appWith(ctx).inject({
      method: 'POST', url: '/api/test-catalog/import/apply',
      payload: { table: { headers: ['name'], rows: [] }, columnMap: { name: 'name' } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'This catalog comes from central.', kind: 'central-managed' });
    expect(audit).toEqual([]);
  });

  it('GET /export answers the CSV as a download', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="test-catalog.csv"');
    expect(res.body).toBe('code,name\nHIVVL,HIV viral load\n');
  });

  it('POST /specimens answers the specimens for the chosen tests, to anyone who can use forms', async () => {
    const { ctx, calls } = fakeCtx();
    const tests = [{ system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL' }];
    const res = await appWith(ctx, ['forms.view']).inject({ method: 'POST', url: '/api/test-catalog/specimens', payload: { tests } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ specimens: [{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }] });
    expect(calls).toEqual([{ method: 'specimensFor', args: [tests] }]);
  });

  // Found live 2026-09-16: zod strips a key the schema does not declare, so the whole parameter list
  // vanished between the sheet and the service, silently.
  it('carries a test result parameters through a create and an update', async () => {
    const params = [{
      system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null,
      bands: [{ name: 'Highland women', low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }],
    }];
    const { ctx, calls } = fakeCtx();
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/test-catalog', payload: { testCode: 'FBC', display: 'FBC', resultParams: params } });
    const created = calls.find((c) => c.method === 'create');
    expect((created?.args[0] as { resultParams?: unknown }).resultParams).toEqual(params);
    await app.inject({ method: 'PUT', url: '/api/test-catalog/FBC', payload: { display: 'FBC', resultParams: [] } });
    const updated = calls.find((c) => c.method === 'update');
    expect((updated?.args[1] as { resultParams?: unknown }).resultParams).toEqual([]);
  });

  it('keeps a range with no name as a null name, not a missing key', async () => {
    const { ctx, calls } = fakeCtx();
    await appWith(ctx).inject({
      method: 'POST', url: '/api/test-catalog',
      payload: { testCode: 'FBC', display: 'FBC', resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [{ low: 12, high: 15 }] }] },
    });
    const created = calls.find((c) => c.method === 'create');
    expect((created?.args[0] as { resultParams: Array<{ bands: unknown[] }> }).resultParams[0].bands[0]).toEqual({
      name: null, low: 12, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null,
    });
  });

  it('carries critical limits through a create, and adds no key for a limit not given', async () => {
    const { ctx, calls } = fakeCtx();
    await appWith(ctx).inject({
      method: 'POST', url: '/api/test-catalog',
      payload: { testCode: 'FBC', display: 'FBC', resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [
        { low: 12, high: 15, criticalLow: 7, criticalHigh: 20 }, { low: 12, high: 15, criticalLow: null },
      ] }] },
    });
    const created = calls.find((c) => c.method === 'create');
    const bands = (created?.args[0] as { resultParams: Array<{ bands: unknown[] }> }).resultParams[0].bands;
    expect(bands[0]).toEqual({ name: null, low: 12, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null, criticalLow: 7, criticalHigh: 20 });
    expect(bands[1]).toEqual({ name: null, low: 12, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null });
    expect(Object.keys(bands[1] as object)).not.toContain('criticalLow');
  });

  it('carries the age unit of a range through a create, refuses one it does not know, and adds no key when left out', async () => {
    const { ctx, calls } = fakeCtx();
    const app = appWith(ctx);
    await app.inject({
      method: 'POST', url: '/api/test-catalog',
      payload: { testCode: 'FBC', display: 'FBC', resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [
        { low: 12, high: 15, ageLow: 0, ageHigh: 28, ageUnit: 'd' }, { low: 12, high: 15, ageLow: 1, ageHigh: 12, ageUnit: 'mo' }, { low: 12, high: 15, ageLow: 18 },
      ] }] },
    });
    const created = calls.find((c) => c.method === 'create');
    const bands = (created?.args[0] as { resultParams: Array<{ bands: Array<Record<string, unknown>> }> }).resultParams[0].bands;
    expect(bands.map((b) => b.ageUnit)).toEqual(['d', 'mo', undefined]);
    expect(Object.keys(bands[2])).not.toContain('ageUnit');
    const bad = await app.inject({
      method: 'POST', url: '/api/test-catalog',
      payload: { testCode: 'FBC', display: 'FBC', resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [{ low: 1, ageUnit: 'w' }] }] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('carries the field settings, the new types and the range fields through a create (plan B wire shape)', async () => {
    const S = 'urn:openldr:default_result';
    const params = [
      { system: S, code: 'HGB', resultType: 'numeric', valueSetUrl: null, required: false, min: 0, max: 30, decimals: 1, bands: [{
        name: null, low: 11, high: 14, unit: null, sex: null, ageLow: null, ageHigh: null,
        pregnancy: 'pregnant', country: 'TZA', validFrom: '2026-01-01', validTo: '2026-12-31', source: 'WHO', scope: 'national',
      }] },
      { system: S, code: 'NOTE', resultType: 'text', valueSetUrl: null, bands: [], required: true, minLength: 2, maxLength: 200 },
      { system: S, code: 'SEEN', resultType: 'date', valueSetUrl: null, bands: [], dateLimit: 'past' },
      { system: S, code: 'POS', resultType: 'boolean', valueSetUrl: null, bands: [] },
      { system: S, code: 'SYM', resultType: 'multicoded', valueSetUrl: 'urn:x:vs:symptoms', bands: [] },
    ];
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: { testCode: 'FBC', display: 'FBC', resultParams: params } });
    expect(res.statusCode).toBe(201);
    const created = calls.find((c) => c.method === 'create');
    expect((created?.args[0] as { resultParams?: unknown }).resultParams).toEqual(params);
  });

  it('adds no key for a field setting or range field not given, and drops pregnancy any and a null setting', async () => {
    const { ctx, calls } = fakeCtx();
    await appWith(ctx).inject({
      method: 'POST', url: '/api/test-catalog',
      payload: { testCode: 'FBC', display: 'FBC', resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', min: null, bands: [
        { low: 12, high: 15, pregnancy: 'any', country: null, validFrom: null, source: null, scope: null },
      ] }] },
    });
    const created = calls.find((c) => c.method === 'create');
    const [param] = (created?.args[0] as { resultParams: Array<Record<string, unknown> & { bands: object[] }> }).resultParams;
    expect(Object.keys(param).sort()).toEqual(['bands', 'code', 'resultType', 'system', 'valueSetUrl']);
    expect(param.bands[0]).toEqual({ name: null, low: 12, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null });
  });

  it('refuses a setting of another type, an unknown type, source, scope or pregnancy, and a bad date, before the store', async () => {
    const S = 'urn:openldr:default_result';
    const { ctx, calls } = fakeCtx();
    const app = appWith(ctx);
    for (const param of [
      { system: S, code: 'NOTE', resultType: 'text', min: 1 },
      { system: S, code: 'HGB', resultType: 'numeric', maxLength: 4 },
      { system: S, code: 'SEEN', resultType: 'date', decimals: 2 },
      { system: S, code: 'POS', resultType: 'boolean', dateLimit: 'past' },
      { system: S, code: 'SEEN', resultType: 'date', dateLimit: 'yesterday' },
      { system: S, code: 'ORG', resultType: 'organism' },
      { system: S, code: 'HGB', resultType: 'numeric', bands: [{ source: 'Mayo' }] },
      { system: S, code: 'HGB', resultType: 'numeric', bands: [{ scope: 'world' }] },
      { system: S, code: 'HGB', resultType: 'numeric', bands: [{ pregnancy: 'yes' }] },
      { system: S, code: 'HGB', resultType: 'numeric', bands: [{ validFrom: '1 Jan 2026' }] },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/test-catalog', payload: { testCode: 'FBC', display: 'FBC', resultParams: [param] } });
      expect(res.statusCode, JSON.stringify(param)).toBe(400);
    }
    expect(calls.filter((c) => c.method === 'create')).toEqual([]);
  });

  it('POST /result-params answers the field settings and the range fields as the catalog gives them', async () => {
    const param = {
      system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, required: false, min: 0, max: 30, decimals: 1,
      bands: [{ name: null, low: 1, high: 2, unit: null, sex: null, ageLow: null, ageHigh: null, country: 'TZA', validFrom: '2026-01-01', source: 'WHO', scope: 'global', pregnancy: 'pregnant' }],
      unit: 'g/dL', display: 'Haemoglobin', band: null, fits: ['unknown'],
    };
    const { ctx } = fakeCtx({ resultParamsFor: async () => [{ test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }, params: [param] }] });
    const res = await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params', payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tests[0].params[0]).toEqual(param);
  });

  it('carries the turnaround times and the verification switch through a create and an update', async () => {
    const { ctx, calls } = fakeCtx();
    const app = appWith(ctx);
    const body = { testCode: 'HIVVL', display: 'HIV viral load', expectedTatHours: 0.5, criticalTatHours: null, requiresVerification: false };
    expect((await app.inject({ method: 'POST', url: '/api/test-catalog', payload: body })).statusCode).toBe(201);
    expect((await app.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL', payload: body })).statusCode).toBe(200);
    expect(calls.filter((c) => c.method !== 'get').map((c) => c.args.at(-1))).toEqual([body, body]);
  });

  it('carries the additional codings through a create and an update, and keeps them out when not sent', async () => {
    const { ctx, calls } = fakeCtx();
    const app = appWith(ctx);
    const codings = [
      { system: 'urn:test:cs:extra', code: 'X1', display: 'Extra one', purpose: 'INDICATION', note: 'why' },
      { system: 'urn:test:cs:extra', code: 'X2' },
    ];
    const body = { testCode: 'HIVVL', display: 'HIV viral load', codings };
    expect((await app.inject({ method: 'POST', url: '/api/test-catalog', payload: body })).statusCode).toBe(201);
    expect((await app.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL', payload: body })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL', payload: { display: 'HIV viral load' } })).statusCode).toBe(200);
    const sent = calls.filter((c) => c.method !== 'get').map((c) => c.args.at(-1) as { codings?: unknown });
    expect(sent.map((s) => s.codings)).toEqual([codings, codings, undefined]);
  });

  it('refuses codings that are not a list of objects before the store', async () => {
    const { ctx, calls } = fakeCtx();
    const app = appWith(ctx);
    for (const codings of ['X1', [{ code: 'X1' }], [{ system: 'urn:test:cs:extra', code: 5 }]]) {
      const res = await app.inject({ method: 'POST', url: '/api/test-catalog', payload: { display: 'X', codings } });
      expect(res.statusCode).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('refuses a turnaround time that is not a number, and a verification switch that is not a boolean, before the store', async () => {
    const { ctx, calls } = fakeCtx();
    const app = appWith(ctx);
    for (const bad of [{ expectedTatHours: '48' }, { criticalTatHours: 'soon' }, { requiresVerification: 'yes' }]) {
      const res = await app.inject({ method: 'POST', url: '/api/test-catalog', payload: { display: 'X', ...bad } });
      expect(res.statusCode).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('POST /result-params answers the sex choices with their labels, so the studio names no code', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }] },
    });
    expect(res.json().sexes).toEqual(SEX_OPTIONS);
  });

  it('POST /result-params answers each test its parameters, to anyone who can use forms', async () => {
    const { ctx, calls } = fakeCtx();
    const tests = [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }];
    const res = await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests, patient: { reference: 'Patient/p1' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tests[0].params[0]).toMatchObject({ code: 'HGB', unit: 'g/dL' });
    expect(calls[0].method).toBe('resultParamsFor');
    expect(calls[0].args[0]).toEqual(tests);
  });

  it('resolves the patient itself, and passes sex and birth date to the catalog', async () => {
    const { ctx, calls } = fakeCtx();
    await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }], patient: { reference: 'Patient/p1' } },
    });
    const patient = calls[0].args[1] as { sex: string | null; birthDate: string | null; at: number };
    expect(patient.sex).toBe('female');
    // The birth date, not whole years, so each range reads the age in its own unit.
    expect(patient.birthDate).toBe('1990-01-01');
    expect(typeof patient.at).toBe('number');
  });

  it('passes the lab time zone, so a patient age counts from the lab date', async () => {
    const { ctx, calls } = fakeCtx();
    // The real lab identity service, so the zone is read under the key the service answers it by.
    const labIdentity = createLabIdentity(memorySettings());
    expect(await labIdentity.set({ 'lab.timezone': 'Africa/Nairobi' }, 'test')).toEqual([]);
    (ctx as any).labIdentity = labIdentity;
    await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }], patient: { reference: 'Patient/p1' } },
    });
    expect(calls[0].args[1]).toMatchObject({ birthDate: '1990-01-01', timeZone: 'Africa/Nairobi' });
    // A lab with no zone, or one whose settings cannot be read, counts in UTC.
    (ctx as any).labIdentity = { tokens: async () => { throw new Error('down'); } };
    await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }], patient: { reference: 'Patient/p1' } },
    });
    expect(calls[1].args[1]).toMatchObject({ timeZone: null });
  });

  it('asks with no patient when the order names none, rather than refusing', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0].args[1]).toMatchObject({ sex: null, birthDate: null });
  });

  it('answers the rejection reasons for both levels, so the studio names no value set', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }] },
    });
    expect(res.json().rejectReasons).toEqual({
      order: [{ system: 'urn:openldr:cs:reject-order', code: 'WRONGPT', display: 'Wrong patient' }],
      test: [{ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }],
    });
  });

  it('POST /result-params needs forms.view, and refuses a body that is not a list of codings', async () => {
    const { ctx, calls } = fakeCtx();
    const terminologyOnly = await appWith(ctx, ['terminology.view', 'terminology.manage'])
      .inject({ method: 'POST', url: '/api/test-catalog/result-params', payload: { tests: [] } });
    expect(terminologyOnly.statusCode).toBe(403);
    const bad = await appWith(ctx, ['forms.view'])
      .inject({ method: 'POST', url: '/api/test-catalog/result-params', payload: { tests: 'FBC' } });
    expect(bad.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('POST /specimens needs forms.view, and refuses a body that is not a list of codings', async () => {
    const { ctx, calls } = fakeCtx();
    const terminologyOnly = await appWith(ctx, ['terminology.view', 'terminology.manage'])
      .inject({ method: 'POST', url: '/api/test-catalog/specimens', payload: { tests: [] } });
    expect(terminologyOnly.statusCode).toBe(403);
    const bad = await appWith(ctx, ['forms.view']).inject({ method: 'POST', url: '/api/test-catalog/specimens', payload: { tests: 'HIVVL' } });
    expect(bad.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('GET /browse lists the catalog for anyone who can use forms, marking what this lab runs', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({ method: 'GET', url: '/api/test-catalog/browse?q=viral&limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      rows: [{ code: 'HIVVL', testCode: 'HIVVL', display: 'HIV viral load', category: 'MOL', enabled: false }],
      total: 1,
      system: 'urn:openldr:codesystem:test-catalog',
    });
    expect(calls).toEqual([
      { method: 'list', args: [{ q: 'viral', status: 'active', limit: 10, offset: 0 }] },
    ]);
  });

  it('GET /browse answers nothing a data-entry surface has no business seeing', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({ method: 'GET', url: '/api/test-catalog/browse' });
    const body = res.json() as Record<string, unknown>;
    expect(body.ownedHere).toBeUndefined();
    expect(Object.keys(body.rows as object[]).length).toBe(1);
    expect(Object.keys((body.rows as Record<string, unknown>[])[0])).toEqual(['code', 'testCode', 'display', 'category', 'enabled']);
  });

  it('GET /browse needs forms.view, and refuses a bad filter before the store', async () => {
    const { ctx, calls } = fakeCtx();
    expect((await appWith(ctx, ['terminology.manage']).inject({ method: 'GET', url: '/api/test-catalog/browse' })).statusCode).toBe(403);
    const bad = await appWith(ctx, ['forms.view']).inject({ method: 'GET', url: '/api/test-catalog/browse?status=gone' });
    expect(bad.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('GET /browse/categories answers every category in the catalog, to anyone who can use forms', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({ method: 'GET', url: '/api/test-catalog/browse/categories' });
    expect(res.statusCode).toBe(200);
    // Only the categories: the specimen types, result parameters and LOINC link options() also reads stay out.
    expect(res.json()).toEqual({ categories: [{ code: 'MOL', display: 'Molecular' }] });
    expect(calls).toEqual([{ method: 'options', args: [] }]);
  });

  it('GET /browse/categories needs forms.view', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ['terminology.view', 'terminology.manage']).inject({ method: 'GET', url: '/api/test-catalog/browse/categories' });
    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe('GET /api/test-catalog/loinc-hints/:code', () => {
  const HINTS: LoincHints = {
    code: '6429-5', display: 'HIV culture of Blood', shortName: 'HIV Bld Cult', component: 'Human immunodeficiency virus', systemPart: 'Bld',
    class: 'MICRO', categorySuggestion: { code: 'MICRO', display: 'Microbiology' },
    unit: null, resultType: 'text',
    specimens: [
      { snomed: '119297000', display: null, equivalence: 'equivalent', specimenType: { system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }, tick: true, via: 'snomed' },
      { snomed: null, display: null, equivalence: null, specimenType: { system: 'urn:openldr:cs:local', code: 'UR', display: 'Urine' }, tick: false, via: 'system-name' },
    ],
    answers: [],
    panelMembers: [{
      code: '2093-3', display: 'Cholesterol', required: true,
      field: { loinc: '2093-3', code: 'CHOL', display: 'Cholesterol', resultType: 'numeric', unit: 'mg/dL', valueSetUrl: null, exists: true },
      fieldProblem: null,
    }],
    field: { loinc: '6429-5', code: '6429-5', display: 'Human immunodeficiency virus', resultType: 'text', unit: null, valueSetUrl: null, exists: false },
    fieldProblem: null,
  };
  function hintsApp(impl: (code: string) => Promise<LoincHints | null>, capabilities?: string[]) {
    const { ctx } = fakeCtx();
    const asked: string[] = [];
    (ctx as unknown as { loincHints: unknown }).loincHints = { hints: async (code: string) => { asked.push(code); return impl(code); } };
    return { app: appWith(ctx, capabilities), asked };
  }

  it('answers the hints as the service gives them', async () => {
    const { app, asked } = hintsApp(async () => HINTS, ['terminology.view']);
    const res = await app.inject({ method: 'GET', url: '/api/test-catalog/loinc-hints/6429-5' });
    expect([res.statusCode, res.json()]).toEqual([200, HINTS]);
    expect(asked).toEqual(['6429-5']);
  });

  it('carries the short name, component, SYSTEM part, field plans and how each specimen matched', async () => {
    const res = await hintsApp(async () => HINTS, ['terminology.view']).app.inject({ method: 'GET', url: '/api/test-catalog/loinc-hints/6429-5' });
    const body = res.json() as LoincHints;
    expect([body.shortName, body.component, body.systemPart, body.fieldProblem]).toEqual(['HIV Bld Cult', 'Human immunodeficiency virus', 'Bld', null]);
    expect(body.field).toEqual(HINTS.field);
    expect(body.specimens.map((s) => s.via)).toEqual(['snomed', 'system-name']);
    expect(body.panelMembers[0]).toMatchObject({ field: { code: 'CHOL', exists: true }, fieldProblem: null });
  });

  it('answers JSON null when LOINC is not loaded', async () => {
    const res = await hintsApp(async () => null).app.inject({ method: 'GET', url: '/api/test-catalog/loinc-hints/6429-5' });
    expect([res.statusCode, res.headers['content-type'], res.body]).toEqual([200, 'application/json; charset=utf-8', 'null']);
  });

  it('maps a refusal to its status, and needs terminology.view', async () => {
    const bad = await hintsApp(async () => { throw new TestCatalogError('no', 'invalid'); }).app.inject({ method: 'GET', url: '/api/test-catalog/loinc-hints/x' });
    const missing = await hintsApp(async () => { throw new TestCatalogError('no', 'not-found'); }).app.inject({ method: 'GET', url: '/api/test-catalog/loinc-hints/1-1' });
    expect([bad.statusCode, missing.statusCode]).toEqual([400, 404]);
    expect((await hintsApp(async () => HINTS, []).app.inject({ method: 'GET', url: '/api/test-catalog/loinc-hints/6429-5' })).statusCode).toBe(403);
  });
});
