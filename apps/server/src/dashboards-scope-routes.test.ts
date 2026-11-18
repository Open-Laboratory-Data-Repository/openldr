import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { dashboardAccess } from '@openldr/bootstrap';
import { NO_SCOPE_LINK } from '@openldr/dashboards';
import { registerDashboardRoutes } from './dashboards-routes';
import './auth-plugin';

// Roles part 3: every dashboard route hands the caller's data limit to the query, and a refusal
// reads "Not available with your data limit".
const limit = { limited: true as const, facilities: ['f1'], districts: [], regions: [] };
const sqlWidget = { id: 'w-sql', type: 'kpi', title: 'SQL', refreshIntervalSec: 0, visual: {}, query: { mode: 'sql', sql: 'select 1' } };
const builderWidget = { id: 'w-b', type: 'kpi', title: 'Requests', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'service_requests', filters: [] } };
const dash = { id: 'd1', name: 'd1', layout: [], widgets: [sqlWidget, builderWidget], filters: [{ id: 'f', label: 'F', type: 'text', optionsSql: 'select 1' }], refreshIntervalSec: 0, isDefault: false, ownerId: null };

function setup(dataScope: unknown, capabilities = ['dashboards.view', 'dashboards.edit']) {
  const seen: Array<{ q: any; scope: unknown }> = [];
  const store = { async get() { return []; }, async set() { return { before: [], after: [] }; }, async forDashboards() { return new Map(); }, async removeRole() {} };
  const ctx = {
    dashboards: {
      store: { list: async () => [dash], get: async (id: string) => (id === 'd1' ? dash : undefined) },
      models: (scope: any) => (scope?.limited ? [{ id: 'service_requests' }] : [{ id: 'service_requests' }, { id: 'patients' }]),
      query: async (q: any, scope: any) => {
        seen.push({ q, scope });
        if (scope?.limited && q.mode === 'sql') throw Object.assign(new Error(NO_SCOPE_LINK), { name: 'DashboardQueryError' });
        return { columns: [], rows: [], meta: { rowCount: 0 } };
      },
    },
    dashboardAccess: dashboardAccess({ access: store as never }),
    logger: { error() {}, warn() {}, info() {} },
    featureFlags: { get: async () => true },
    cfg: {},
  } as any;
  const app = Fastify();
  app.addHook('onRequest', async (req: any) => { req.user = { id: 'u1', username: 'u', displayName: null, roles: [], roleIds: [], capabilities, dataScope }; });
  registerDashboardRoutes(app, ctx);
  return { app, seen };
}

describe('dashboard routes under a data limit', () => {
  it('passes the limit to a saved widget, a filter\'s options and a free-form query', async () => {
    const { app, seen } = setup(limit);
    expect((await app.inject({ method: 'POST', url: '/api/dashboards/d1/widgets/w-b/query', payload: {} })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/dashboards/d1/filters/f/options', payload: {} });
    await app.inject({ method: 'POST', url: '/api/dashboards/query', payload: builderWidget.query });
    expect(seen.map((s) => s.scope)).toEqual([limit, limit, limit]);
  });

  it('answers 403 "Not available with your data limit" for a SQL widget and a filter\'s options SQL', async () => {
    const { app } = setup(limit);
    for (const url of ['/api/dashboards/d1/widgets/w-sql/query', '/api/dashboards/d1/filters/f/options']) {
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode, url).toBe(403);
      expect(res.json(), url).toEqual({ error: NO_SCOPE_LINK, code: 'data_limit' });
    }
  });

  it('offers a limited user only linked models, and an unlimited user all of them', async () => {
    expect((await setup(limit).app.inject({ url: '/api/dashboards/models' })).json().map((m: any) => m.id)).toEqual(['service_requests']);
    expect((await setup({ limited: false }).app.inject({ url: '/api/dashboards/models' })).json()).toHaveLength(2);
  });

  it('runs an unlimited user\'s SQL widget as before', async () => {
    const { app, seen } = setup({ limited: false });
    expect((await app.inject({ method: 'POST', url: '/api/dashboards/d1/widgets/w-sql/query', payload: {} })).statusCode).toBe(200);
    expect(seen[0]!.scope).toEqual({ limited: false });
  });
});
