import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `openldr dashboards share` (design 2026-11-18-roles-scope, part 2). The checks are the real
// bootstrap functions the routes use, against in-memory stores.
const mocks = vi.hoisted(() => ({
  lists: {} as Record<string, string[]>,
  caller: { capabilities: ['dashboards.view'], roleIds: [] as string[] },
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/bootstrap', async () => {
  const dash = await vi.importActual<typeof import('../../bootstrap/src/dashboard-access')>('../../bootstrap/src/dashboard-access');
  const forms = await vi.importActual<typeof import('../../bootstrap/src/form-access')>('../../bootstrap/src/form-access');
  const store = {
    async get(id: string) { return mocks.lists[id] ?? []; },
    async set(id: string, roles: string[]) { const before = mocks.lists[id] ?? []; mocks.lists[id] = [...roles].sort(); return { before, after: mocks.lists[id]! }; },
    async forDashboards(ids: string[]) { return new Map(ids.filter((id) => mocks.lists[id]).map((id) => [id, mocks.lists[id]!])); },
    async removeRole() {},
  };
  const dashboards = [{ id: 'd1', ownerId: 'u-owner', name: 'District' }];
  return {
    setDashboardShare: dash.setDashboardShare,
    DashboardShareError: dash.DashboardShareError,
    formUserOf: forms.formUserOf,
    recordAuditEvent: mocks.recordAuditEvent,
    createAppContext: async () => ({
      dashboards: { store: { async get(id: string) { return dashboards.find((d) => d.id === id); } } },
      dashboardAccessStore: store,
      dashboardAccess: dash.dashboardAccess({ access: store }),
      users: { async get(id: string) { return { id, subject: null }; } },
      roles: {
        async list() { return [{ id: 'r-district', slug: 'district', name: 'District' }, { id: 'r-region', slug: 'region', name: 'Region' }]; },
        async resolveCapabilities() { return mocks.caller.capabilities; },
        async rolesForUser() { return mocks.caller.roleIds.map((id) => ({ id })); },
      },
      close: async () => {},
    }),
  };
});
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runDashboardsShare } from './dashboards';
import { resetServedHandoffForTests, setServedHandoff } from './served';

const out = () => vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');
const serveAs = (id: string) => setServedHandoff({ path: 'dashboards share', argv: [], caller: { id, username: id, displayName: null, keyName: null }, runDir: '/tmp/x', keptDirs: [] });

describe('runDashboardsShare', () => {
  beforeEach(() => {
    mocks.lists = { d1: ['r-district'] };
    mocks.caller = { capabilities: ['dashboards.view'], roleIds: [] };
    mocks.recordAuditEvent.mockReset();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => resetServedHandoffForTests());

  it('shows the list by role name, and an empty one as everyone with the permission', async () => {
    expect(await runDashboardsShare('d1', { json: false, clear: false })).toBe(0);
    expect(out()).toContain('District (district)');
    mocks.lists = {};
    expect(await runDashboardsShare('d1', { json: false, clear: false })).toBe(0);
    expect(out()).toContain('everyone with the permission');
  });

  it('sets the list from role slugs, run locally, and audits it', async () => {
    expect(await runDashboardsShare('d1', { json: false, clear: false, roles: 'region,district' })).toBe(0);
    expect(mocks.lists.d1).toEqual(['r-district', 'r-region']);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      action: 'dashboard.share.set', entityId: 'd1', before: ['r-district'], after: ['r-district', 'r-region'],
    }));
  });

  it('empties the list with --clear, and refuses --clear with --roles', async () => {
    expect(await runDashboardsShare('d1', { json: false, clear: true, roles: 'region' })).toBe(1);
    expect(await runDashboardsShare('d1', { json: false, clear: true })).toBe(0);
    expect(mocks.lists.d1).toEqual([]);
  });

  it('lets a served caller share only a dashboard they own, and hides one they may not see', async () => {
    serveAs('u-owner');
    expect(await runDashboardsShare('d1', { json: false, clear: false, roles: 'region' })).toBe(0);
    resetServedHandoffForTests();
    mocks.lists = { d1: ['r-district'] };
    mocks.caller = { capabilities: ['dashboards.view'], roleIds: ['r-district'] };
    serveAs('u-district');
    expect(await runDashboardsShare('d1', { json: false, clear: false })).toBe(0);
    expect(await runDashboardsShare('d1', { json: false, clear: false, roles: 'region' })).toBe(1);
    resetServedHandoffForTests();
    mocks.caller = { capabilities: ['dashboards.view'], roleIds: [] };
    serveAs('u-viewer');
    expect(await runDashboardsShare('d1', { json: false, clear: false })).toBe(1);
    expect(mocks.lists.d1).toEqual(['r-district']);
  });

  it('refuses an unknown dashboard or role, changing nothing', async () => {
    expect(await runDashboardsShare('nope', { json: false, clear: false })).toBe(1);
    expect(await runDashboardsShare('d1', { json: false, clear: false, roles: 'ghost' })).toBe(1);
    expect(mocks.lists.d1).toEqual(['r-district']);
  });
});
