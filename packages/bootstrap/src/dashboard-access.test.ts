import { describe, it, expect } from 'vitest';
import type { DashboardAccessStore } from '@openldr/db';
import { dashboardAccess, DashboardShareError, setDashboardShare } from './dashboard-access';

// Design 2026-11-18-roles-scope, part 2: the one check the dashboard routes, the CLI and the list use.
function memStore(lists: Record<string, string[]>): DashboardAccessStore {
  return {
    async get(id) { return lists[id] ?? []; },
    async set(id, roles) { const before = lists[id] ?? []; lists[id] = [...new Set(roles)].sort(); return { before, after: lists[id]! }; },
    async forDashboards(ids) { return new Map(ids.filter((id) => lists[id]).map((id) => [id, lists[id]!])); },
    async removeRole() {},
  };
}
const viewer = { id: 'u-viewer', roleIds: ['r-viewer'], capabilities: ['dashboards.view'] };
const district = { id: 'u-district', roleIds: ['r-other', 'r-district'], capabilities: ['dashboards.view'] };
const owner = { id: 'u-owner', roleIds: ['r-owner'], capabilities: ['dashboards.view', 'dashboards.edit'] };
const admin = { id: 'u-admin', roleIds: ['r-admin'], capabilities: ['roles.manage'] };
const nobody = { id: 'u-none', roleIds: ['r-district'], capabilities: [] };

describe('dashboardAccess', () => {
  const access = dashboardAccess({ access: memStore({ shared: ['r-district'] }) });
  const open = { id: 'open', ownerId: null };
  const shared = { id: 'shared', ownerId: 'u-owner' };
  const sharedNoOwner = { id: 'shared', ownerId: null };

  it('keeps today\'s rule for a dashboard with an empty list: dashboards.view alone', async () => {
    expect(await access.maySee(viewer, open)).toBe(true);
    expect(await access.maySee(nobody, open)).toBe(false);
  });

  it('lets a listed role see it, also when only one of two roles is listed', async () => {
    expect(await access.maySee(district, shared)).toBe(true);
    expect(await access.maySee(viewer, shared)).toBe(false);
  });

  it('always lets the owner and an admin see it, and no one owns a dashboard with no owner', async () => {
    expect(await access.maySee(owner, shared)).toBe(true);
    expect(await access.maySee(owner, sharedNoOwner)).toBe(false);
    expect(await access.maySee(admin, sharedNoOwner)).toBe(true);
    expect(await access.maySee({ ...nobody, id: 'u-owner' }, shared)).toBe(false);
  });

  it('lets only the owner or an admin change the share list', () => {
    expect(access.mayShare(owner, shared)).toBe(true);
    expect(access.mayShare(admin, sharedNoOwner)).toBe(true);
    expect(access.mayShare(district, shared)).toBe(false);
    expect(access.mayShare(owner, sharedNoOwner)).toBe(false);
  });

  it('keeps the dashboards a person may see, in order', async () => {
    expect((await access.visible(viewer, [shared, open])).map((d) => d.id)).toEqual(['open']);
    expect((await access.visible(district, [shared, open])).map((d) => d.id)).toEqual(['shared', 'open']);
  });
});

describe('setDashboardShare', () => {
  const roles = [{ id: 'r-district', slug: 'district' }, { id: 'r-region', slug: 'region' }];
  const deps = (lists: Record<string, string[]> = {}) => ({
    access: memStore(lists),
    dashboards: { async get(id: string) { return id === 'd1' ? { id } : null; } },
    roles: { async list() { return roles; } },
  });

  it('saves the list by role id or slug, each once, and returns before and after', async () => {
    const lists = { d1: ['r-region'] };
    expect(await setDashboardShare(deps(lists), 'd1', ['district', 'r-district', 'region']))
      .toEqual({ before: ['r-region'], after: ['r-district', 'r-region'] });
  });

  it('refuses an unknown dashboard or role, saving nothing', async () => {
    const lists: Record<string, string[]> = { d1: [] };
    await expect(setDashboardShare(deps(lists), 'nope', [])).rejects.toThrow(DashboardShareError);
    await expect(setDashboardShare(deps(lists), 'd1', ['ghost'])).rejects.toThrow(/no role ghost/);
    expect(lists.d1).toEqual([]);
  });
});
