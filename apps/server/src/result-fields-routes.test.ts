import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { TestCatalogError, type AppContext } from '@openldr/bootstrap';
import { registerResultFieldsRoutes } from './result-fields-routes';
import './auth-plugin';

const LIST = { rows: [{ code: 'VLC', display: 'HIV VL copies', role: 'result', units: null, loinc: '20447-9' }], total: 1, ownedHere: true, loaded: true };
const REPORT = { counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [] };

type Impl = (...args: any[]) => Promise<unknown>;

function fakeCtx(over: Record<string, Impl> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const spy = (method: string, impl: Impl): Impl => async (...args) => { calls.push({ method, args }); return impl(...args); };
  const resultFields = {
    list: spy('list', over.list ?? (async () => LIST)),
    link: spy('link', over.link ?? (async () => ({ code: 'VLC', before: null, after: '20447-9' }))),
    unlink: spy('unlink', over.unlink ?? (async () => ({ code: 'VLC', before: '20447-9', after: null }))),
    exportCsv: spy('exportCsv', over.exportCsv ?? (async () => 'code,display,role,units,loinc\n')),
    importPreview: spy('importPreview', over.importPreview ?? (async () => REPORT)),
    importApply: spy('importApply', over.importApply ?? (async () => REPORT)),
  };
  const ctx = {
    resultFields,
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
  registerResultFieldsRoutes(app, ctx);
  return app;
}

describe('result fields routes', () => {
  it('GET passes the parsed filters and returns the list', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/result-fields?loinc=linked&role=result&q=vl' });
    expect([res.statusCode, res.json()]).toEqual([200, LIST]);
    expect(calls).toEqual([{ method: 'list', args: [{ q: 'vl', loinc: 'linked', role: 'result', limit: 25, offset: 0 }] }]);
  });

  it('GET refuses a bad filter before the service', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/result-fields?loinc=some' });
    expect([res.statusCode, res.json()]).toEqual([400, { error: 'loinc must be linked, none or all' }]);
    expect(calls).toEqual([]);
  });

  it('PUT links and audits; DELETE unlinks and audits', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const app = appWith(ctx);
    const put = await app.inject({ method: 'PUT', url: '/api/test-catalog/result-fields/VLC/loinc', payload: { loinc: '20447-9' } });
    const del = await app.inject({ method: 'DELETE', url: '/api/test-catalog/result-fields/VLC/loinc' });
    expect([put.statusCode, del.statusCode]).toEqual([200, 200]);
    expect(calls.map((c) => [c.method, ...c.args])).toEqual([['link', 'VLC', '20447-9'], ['unlink', 'VLC']]);
    expect(audit.map((a) => [a.action, a.entityId])).toEqual([['result_field.link', 'VLC'], ['result_field.unlink', 'VLC']]);
  });

  it('maps refusals to 400, 404 and 409 with their kind', async () => {
    const refusing = (kind: 'invalid' | 'not-found' | 'central-managed') => fakeCtx({ link: async () => { throw new TestCatalogError('no', kind); } });
    const statuses = [];
    for (const kind of ['invalid', 'not-found', 'central-managed'] as const) {
      const res = await appWith(refusing(kind).ctx).inject({ method: 'PUT', url: '/api/test-catalog/result-fields/VLC/loinc', payload: { loinc: '1-1' } });
      statuses.push([res.statusCode, res.json().kind]);
    }
    expect(statuses).toEqual([[400, 'invalid'], [404, 'not-found'], [409, 'central-managed']]);
  });

  it('refuses a viewer\'s link with 403', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['terminology.view']).inject({ method: 'PUT', url: '/api/test-catalog/result-fields/VLC/loinc', payload: { loinc: '20447-9' } });
    expect(res.statusCode).toBe(403);
  });

  it('exports, previews and applies a CSV, auditing the apply', async () => {
    const { ctx, audit } = fakeCtx();
    const app = appWith(ctx);
    const exp = await app.inject({ method: 'GET', url: '/api/test-catalog/result-fields/export' });
    expect(exp.headers['content-disposition']).toBe('attachment; filename="result-fields.csv"');
    const upload = { headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('code,loinc\nVLC,20447-9\n') };
    expect((await app.inject({ method: 'POST', url: '/api/test-catalog/result-fields/import/preview', ...upload })).json()).toEqual(REPORT);
    expect((await app.inject({ method: 'POST', url: '/api/test-catalog/result-fields/import/apply', ...upload })).json()).toEqual(REPORT);
    expect(audit.map((a) => a.action)).toEqual(['result_field.import']);
  });
});
