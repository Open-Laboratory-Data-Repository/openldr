import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { dashboardAccess } from '@openldr/bootstrap';
import type { DashboardAccessStore } from '@openldr/db';
import { registerDashboardRoutes } from './dashboards-routes';
import './auth-plugin';

// Design 2026-11-18-roles-scope, part 2: dashboards shared with roles, and their data locked to
// the dashboards a person may see (operator, 2026-11-18: "Also lock the data").
function memStore(lists: Record<string, string[]>): DashboardAccessStore {
  return {
    async get(id) { return lists[id] ?? []; },
    async set(id, roles) { const before = lists[id] ?? []; lists[id] = [...new Set(roles)].sort(); return { before, after: lists[id]! }; },
    async forDashboards(ids) { return new Map(ids.filter((id) => lists[id]).map((id) => [id, lists[id]!])); },
    async removeRole() {},
  };
}

const widget = {
  id: 'w1', type: 'kpi', title: 'Requests', refreshIntervalSec: 0, visual: {},
  query: { mode: 'builder', model: 'requests', filters: [], variableBindings: { site: 'f-site' } },
};
const filter = { id: 'f-site', label: 'Site', type: 'text', optionsSql: 'select distinct site from lab_requests' };
const dash = (id: string, ownerId: string | null) => ({ id, name: id, layout: [], widgets: [widget], filters: [filter], refreshIntervalSec: 0, isDefault: false, ownerId });

function setup(user: { id: string; roleIds: string[]; capabilities: string[] }) {
  const data = [dash('open', null), dash('district', 'u-owner')];
  const lists: Record<string, string[]> = { district: ['r-district'] };
  const store = memStore(lists);
  const ran: unknown[] = [];
  const audit: any[] = [];
  const ctx = {
    dashboards: {
      store: {
        list: async () => data,
        get: async (id: string) => data.find((d) => d.id === id),
        create: async (d: any) => { data.push(d); return d; },
        update: async (_id: string, d: any) => d,
        remove: vi.fn(async () => {}),
      },
      query: async (q: unknown) => { ran.push(q); return { columns: [], rows: [], meta: { rowCount: 0 } }; },
      compileSql: async () => 'select 1',
    },
    dashboardAccessStore: store,
    dashboardAccess: dashboardAccess({ access: store }),
    roles: { list: async () => [{ id: 'r-district', slug: 'district', name: 'District' }, { id: 'r-region', slug: 'region', name: 'Region' }] },
    audit: { record: async (e: any) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    featureFlags: { get: async () => false },
    cfg: {},
  } as any;
  const app = Fastify();
  app.addHook('onRequest', async (req: any) => { req.user = { username: 'u', displayName: null, roles: [], ...user }; });
  registerDashboardRoutes(app, ctx);
  return { app, data, lists, ran, audit };
}

const VIEW = ['dashboards.view'];
const EDIT = ['dashboards.view', 'dashboards.create', 'dashboards.edit', 'dashboards.delete'];
const viewer = { id: 'u-viewer', roleIds: ['r-viewer'], capabilities: VIEW };
const districtUser = { id: 'u-district', roleIds: ['r-district'], capabilities: VIEW };
const owner = { id: 'u-owner', roleIds: [], capabilities: EDIT };
const editor = { id: 'u-editor', roleIds: [], capabilities: EDIT };
const admin = { id: 'u-admin', roleIds: [], capabilities: [...EDIT, 'roles.manage'] };

describe('dashboard sharing', () => {
  it('lists only the dashboards a person may see', async () => {
    const ids = async (u: typeof viewer) => (await setup(u).app.inject({ url: '/api/dashboards' })).json().map((d: any) => d.id);
    expect(await ids(viewer)).toEqual(['open']);
    expect(await ids(districtUser)).toEqual(['open', 'district']);
    expect(await ids(owner)).toEqual(['open', 'district']);
    expect(await ids(editor)).toEqual(['open']);
  });

  it('answers 404 to read, change or delete a dashboard a person may not see, changing nothing', async () => {
    const { app, data } = setup(editor);
    expect((await app.inject({ url: '/api/dashboards/district' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: '/api/dashboards/district', payload: dash('district', 'u-owner') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/dashboards/district' })).statusCode).toBe(404);
    expect(data.map((d) => d.id)).toEqual(['open', 'district']);
  });

  it('refuses to create a dashboard with an id that exists, returning nothing of it (review DS1)', async () => {
    const { app, data } = setup(editor);
    const res = await app.inject({ method: 'POST', url: '/api/dashboards', payload: { ...dash('district', null), name: 'mine', widgets: [] } });
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).not.toContain('Requests');
    expect(data.filter((d) => d.id === 'district')).toHaveLength(1);
  });

  it('sets the owner to the caller on create and keeps the stored owner on update, whatever the body says', async () => {
    const { app } = setup(editor);
    const made = await app.inject({ method: 'POST', url: '/api/dashboards', payload: { ...dash('mine', 'someone-else'), id: 'mine' } });
    expect(made.json().ownerId).toBe('u-editor');
    const changed = await app.inject({ method: 'PUT', url: '/api/dashboards/open', payload: { ...dash('open', 'u-editor') } });
    expect(changed.json().ownerId).toBeNull();
  });

  it('shows the share list with role names to someone who may see it, and lets only the owner or an admin change it', async () => {
    const { app: asDistrict } = setup(districtUser);
    const share = (await asDistrict.inject({ url: '/api/dashboards/district/share' })).json();
    expect(share.roles).toEqual(['r-district']);
    expect(share.choices).toContainEqual({ id: 'r-region', slug: 'region', name: 'Region' });
    expect((await asDistrict.inject({ method: 'PUT', url: '/api/dashboards/district/share', payload: { roles: [] } })).statusCode).toBe(403);
    expect((await setup(editor).app.inject({ method: 'PUT', url: '/api/dashboards/open/share', payload: { roles: [] } })).statusCode).toBe(403);

    const { app: asOwner, lists, audit } = setup(owner);
    const put = await asOwner.inject({ method: 'PUT', url: '/api/dashboards/district/share', payload: { roles: ['region', 'r-district'] } });
    expect(put.statusCode).toBe(200);
    expect(lists.district).toEqual(['r-district', 'r-region']);
    // Objects, not bare arrays: node-pg sends an array as a Postgres array literal, which the jsonb
    // audit columns refuse (found on the scratch-server screen check).
    expect(audit).toContainEqual(expect.objectContaining({ action: 'dashboard.share.set', entityId: 'district', before: { roles: ['r-district'] }, after: { roles: ['r-district', 'r-region'] } }));
    expect((await asOwner.inject({ method: 'PUT', url: '/api/dashboards/district/share', payload: { roles: ['ghost'] } })).statusCode).toBe(400);
    expect((await setup(admin).app.inject({ method: 'PUT', url: '/api/dashboards/open/share', payload: { roles: ['district'] } })).statusCode).toBe(200);
  });

  it('runs a saved widget with the dashboard filter values bound in, for someone who may see it', async () => {
    const { app, ran } = setup(districtUser);
    const res = await app.inject({ method: 'POST', url: '/api/dashboards/district/widgets/w1/query', payload: { filterValues: { 'f-site': 'HCNAM' } } });
    expect(res.statusCode).toBe(200);
    expect(ran).toEqual([expect.objectContaining({ mode: 'builder', model: 'requests', filters: [{ dimension: 'site', op: 'eq', value: 'HCNAM' }] })]);
  });

  it('runs nothing for a dashboard a person may not see, an unknown widget, or an unknown filter', async () => {
    const { app, ran } = setup(viewer);
    expect((await app.inject({ method: 'POST', url: '/api/dashboards/district/widgets/w1/query', payload: { filterValues: {} } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/dashboards/open/widgets/nope/query', payload: { filterValues: {} } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/dashboards/open/widgets/w1/query', payload: { filterValues: { 'f-other': 'x' } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/dashboards/district/filters/f-site/options', payload: {} })).statusCode).toBe(404);
    expect(ran).toEqual([]);
  });

  it('runs a filter\'s stored option query for someone who may see the dashboard', async () => {
    const { app, ran } = setup(viewer);
    const res = await app.inject({ method: 'POST', url: '/api/dashboards/open/filters/f-site/options', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(ran).toEqual([{ mode: 'sql', sql: 'select distinct site from lab_requests' }]);
  });

  it('lets only an editor run a free-form query or compile one', async () => {
    const q = { mode: 'builder', model: 'requests', filters: [] };
    const { app: asViewer, ran } = setup(viewer);
    expect((await asViewer.inject({ method: 'POST', url: '/api/dashboards/query', payload: q })).statusCode).toBe(403);
    expect((await asViewer.inject({ method: 'POST', url: '/api/dashboards/compile-sql', payload: q })).statusCode).toBe(403);
    expect(ran).toEqual([]);
    expect((await setup(editor).app.inject({ method: 'POST', url: '/api/dashboards/query', payload: q })).statusCode).toBe(200);
  });
});
