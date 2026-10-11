import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { TestCatalogError, type AppContext } from '@openldr/bootstrap';
import { registerTestMappingRoutes } from './test-mapping-routes';
import './auth-plugin';

const DISA = 'urn:openldr:disa';
const OBSERVED = {
  rows: [{ system: DISA, code: 'HIVVL', description: 'HIV VL', requests: 2, lastSeen: '2026-05-03T08:00:00.000Z', status: 'mapped', catalog: { code: 'VL', name: 'HIV viral load', loinc: '25836-8' }, centralManaged: false }],
  total: 1,
  warehouse: { stale: false, error: null },
};
const CHANGE = { system: DISA, code: 'HIVVL', before: null, after: 'VL', rebuild: { ok: true, result: { mapped: 1, ambiguous: [], targetMissing: [], written: 1 } } };
const REPORT = { counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [], rebuild: null };

type Impl = (...args: any[]) => Promise<unknown>;

function fakeCtx(over: Record<string, Impl> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const spy = (method: string, impl: Impl): Impl => async (...args) => { calls.push({ method, args }); return impl(...args); };
  const testMapping = {
    observed: spy('observed', over.observed ?? (async () => OBSERVED)),
    targets: spy('targets', over.targets ?? (async () => [{ code: 'VL', name: 'HIV viral load', loinc: '25836-8', retired: false }])),
    set: spy('set', over.set ?? (async () => CHANGE)),
    clear: spy('clear', over.clear ?? (async () => ({ ...CHANGE, before: 'VL', after: null }))),
    exportCsv: spy('exportCsv', over.exportCsv ?? (async () => 'system,code\n')),
    importPreview: spy('importPreview', over.importPreview ?? (async () => REPORT)),
    importApply: spy('importApply', over.importApply ?? (async () => ({ ...REPORT, rebuild: CHANGE.rebuild }))),
    rebuildNow: spy('rebuildNow', over.rebuildNow ?? (async () => CHANGE.rebuild)),
  };
  const ctx = {
    testMapping,
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
  registerTestMappingRoutes(app, ctx);
  return app;
}

describe('test mapping routes', () => {
  it('GET observed passes the parsed filters and returns the answer as is', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/mappings/observed?status=mapped&q=viral&limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(OBSERVED);
    expect(calls).toEqual([{ method: 'observed', args: [{ status: 'mapped', q: 'viral', limit: 10, offset: 0 }] }]);
  });

  it('GET observed refuses a bad filter with 400 before the service', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/mappings/observed?status=gone' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'status must be unmapped, mapped, ambiguous or all' });
    expect(calls).toEqual([]);
  });

  it('GET targets wraps the list', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/mappings/targets' });
    expect(res.json()).toEqual({ targets: [{ code: 'VL', name: 'HIV viral load', loinc: '25836-8', retired: false }] });
  });

  it('PUT sets a mapping and audits before and after', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/mappings', payload: { system: DISA, code: 'HIVVL', catalogCode: 'VL' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(CHANGE);
    expect(calls).toEqual([{ method: 'set', args: [DISA, 'HIVVL', 'VL'] }]);
    expect(audit).toMatchObject([{ action: 'test_mapping.set', entityType: 'test_mapping', entityId: `${DISA}|HIVVL`, before: { catalogCode: null }, after: { catalogCode: 'VL' } }]);
  });

  it('PUT refuses a missing field with 400', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/mappings', payload: { system: DISA, code: 'HIVVL' } });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('maps service refusals to 400, 404 and 409 with their kind', async () => {
    for (const [kind, status] of [['invalid', 400], ['not-found', 404], ['central-managed', 409]] as const) {
      const { ctx, audit } = fakeCtx({ set: async () => { throw new TestCatalogError('no', kind); } });
      const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/mappings', payload: { system: DISA, code: 'HIVVL', catalogCode: 'VL' } });
      expect([res.statusCode, res.json()]).toEqual([status, { error: 'no', kind }]);
      expect(audit).toEqual([]);
    }
  });

  it('POST clear clears and audits', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog/mappings/clear', payload: { system: DISA, code: 'HIVVL' } });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([{ method: 'clear', args: [DISA, 'HIVVL'] }]);
    expect(audit).toMatchObject([{ action: 'test_mapping.clear', before: { catalogCode: 'VL' }, after: { catalogCode: null } }]);
  });

  it('GET export returns CSV with a download name', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/mappings/export' });
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="test-mappings.csv"');
    expect(res.body).toBe('system,code\n');
  });

  it('import preview reads raw bytes and writes no audit; apply audits the counts', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const app = appWith(ctx);
    const body = Buffer.from('system,code,catalog_code\nx,A,VL\n');
    const pre = await app.inject({ method: 'POST', url: '/api/test-catalog/mappings/import/preview', headers: { 'content-type': 'application/octet-stream' }, payload: body });
    expect(pre.statusCode).toBe(200);
    expect(Buffer.from(calls[0].args[0] as Uint8Array).toString()).toBe(body.toString());
    expect(audit).toEqual([]);
    const apply = await app.inject({ method: 'POST', url: '/api/test-catalog/mappings/import/apply', headers: { 'content-type': 'application/octet-stream' }, payload: body });
    expect(apply.statusCode).toBe(200);
    expect(audit).toMatchObject([{ action: 'test_mapping.import', metadata: { counts: REPORT.counts } }]);
  });

  it('POST rebuild returns the outcome', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog/mappings/rebuild' });
    expect(res.json()).toEqual(CHANGE.rebuild);
  });

  it('a viewer can read but not change', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx, ['terminology.view']);
    expect((await app.inject({ method: 'GET', url: '/api/test-catalog/mappings/observed' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/test-catalog/mappings', payload: { system: DISA, code: 'HIVVL', catalogCode: 'VL' } })).statusCode).toBe(403);
  });
});
