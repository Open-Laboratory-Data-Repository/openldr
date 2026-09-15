import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  TestCatalogError, type AppContext, type CatalogImportReport, type CatalogOptions, type CatalogTest,
} from '@openldr/bootstrap';
import { registerTestCatalogRoutes } from './test-catalog-routes';
import './auth-plugin';

const TEST: CatalogTest = {
  code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
  specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD' }], loinc: '25836-8', active: true,
  lab: { enabled: false, specimenTypes: null, localDisplay: null },
};

const OPTIONS: CatalogOptions = {
  categories: [{ code: 'MOL', display: 'Molecular' }],
  specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }],
  loinc: null,
};

const REPORT: CatalogImportReport = {
  counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [],
  unmatched: { categories: [], specimens: [] }, categoriesToAdd: [{ code: 'VIRO', display: 'Virology' }], loincChecked: false,
};

type Impl = (...args: any[]) => Promise<unknown>;

type Method = 'list' | 'get' | 'create' | 'update' | 'setLabSettings' | 'options' | 'setEnabled' | 'setActive'
  | 'importPreview' | 'importApply' | 'exportCsv' | 'specimensFor';

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
  };
  const ctx = {
    testCatalog,
    audit: { record: async (e: Record<string, unknown>) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
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
    expect((await viewer.inject({ method: 'POST', url: '/api/test-catalog', payload: { code: 'X', display: 'X' } })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL', payload: { display: 'X' } })).statusCode).toBe(403);
    expect((await viewer.inject({
      method: 'PUT', url: '/api/test-catalog/HIVVL/lab', payload: { enabled: true, specimenTypes: null, localDisplay: null },
    })).statusCode).toBe(403);
  });

  it('POST creates a test, answers 201 with it, and audits the create', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const body = { code: 'HIVVL', display: 'HIV viral load', loinc: '25836-8', specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD' }] };
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(TEST);
    expect(calls).toEqual([{ method: 'create', args: [body] }]);
    expect(audit).toMatchObject([{ action: 'test_catalog.create', entityType: 'test_catalog', entityId: 'HIVVL', before: null, after: TEST }]);
  });

  it('POST refuses a body with no name before the store', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: { code: 'X' } });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('maps each catalog error to its status and keeps its words', async () => {
    const cases: Array<[TestCatalogError['kind'], number]> = [
      ['invalid', 400], ['not-found', 404], ['conflict', 409], ['central-managed', 409],
    ];
    for (const [kind, status] of cases) {
      const { ctx, audit } = fakeCtx({ create: async () => { throw new TestCatalogError(`refused: ${kind}`, kind); } });
      const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: { code: 'X', display: 'X' } });
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

  it('POST /specimens needs forms.view, and refuses a body that is not a list of codings', async () => {
    const { ctx, calls } = fakeCtx();
    const terminologyOnly = await appWith(ctx, ['terminology.view', 'terminology.manage'])
      .inject({ method: 'POST', url: '/api/test-catalog/specimens', payload: { tests: [] } });
    expect(terminologyOnly.statusCode).toBe(403);
    const bad = await appWith(ctx, ['forms.view']).inject({ method: 'POST', url: '/api/test-catalog/specimens', payload: { tests: 'HIVVL' } });
    expect(bad.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
});
