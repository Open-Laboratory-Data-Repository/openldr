import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { TestCatalogError, type AppContext, type CatalogOptions, type CatalogTest } from '@openldr/bootstrap';
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

type Impl = (...args: any[]) => Promise<unknown>;

function fakeCtx(over: Partial<Record<'list' | 'get' | 'create' | 'update' | 'setLabSettings' | 'options' | 'setEnabled' | 'setActive', Impl>> = {}) {
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
});
