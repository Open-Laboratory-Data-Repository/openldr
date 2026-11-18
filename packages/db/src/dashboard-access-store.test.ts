import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import type { InternalSchema } from './schema/internal';
import { createDashboardAccessStore, type DashboardAccessStore } from './dashboard-access-store';
import { createRoleStore } from './role-store';

// Layer: the store's SQL against pg-mem, every internal migration applied (design
// 2026-11-18-roles-scope, part 2). Not covered: real Postgres locking, see the live test.
describe('dashboard access store', () => {
  let db: Kysely<InternalSchema>;
  let store: DashboardAccessStore;
  beforeEach(async () => {
    db = await makeMigratedDb();
    store = createDashboardAccessStore(db);
  });

  it('answers an empty list for a dashboard nobody limited', async () => {
    expect(await store.get('d1')).toEqual([]);
  });

  it('sets the list, a second set replaces it, and each returns its before and after', async () => {
    expect(await store.set('d1', ['r2', 'r1', 'r1'])).toEqual({ before: [], after: ['r1', 'r2'] });
    expect(await store.set('d1', ['r3'])).toEqual({ before: ['r1', 'r2'], after: ['r3'] });
    expect(await store.get('d1')).toEqual(['r3']);
  });

  it('reads many dashboards at once, leaving out dashboards with no list', async () => {
    await store.set('d1', ['r1']);
    await store.set('d2', ['r2']);
    const got = await store.forDashboards(['d1', 'd2', 'd3']);
    expect([...got.keys()].sort()).toEqual(['d1', 'd2']);
    expect(got.get('d2')).toEqual(['r2']);
  });

  it('a deleted role leaves every dashboard it was on', async () => {
    const roles = createRoleStore(db);
    const viewer = await roles.create({ name: 'District viewer', capabilities: ['dashboards.view'] });
    await store.set('d1', [viewer.id, 'other']);
    await roles.remove(viewer.id);
    expect(await store.get('d1')).toEqual(['other']);
  });
});
