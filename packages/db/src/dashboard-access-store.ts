import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

/** The roles that may see one dashboard, by id. Empty: every role with dashboards.view. */
export interface DashboardAccessStore {
  get(dashboardId: string): Promise<string[]>;
  /** Replaces the list, and returns it as it was and as it is now, both read under the lock the
   *  save holds, so another save cannot slip between them (roles part 1 review FR5, FR10). */
  set(dashboardId: string, roleIds: string[]): Promise<{ before: string[]; after: string[] }>;
  /** The lists of the given dashboards. A dashboard with no row is absent. */
  forDashboards(dashboardIds: string[]): Promise<Map<string, string[]>>;
  /** Takes a deleted role off every dashboard. */
  removeRole(roleId: string): Promise<void>;
}

const CHUNK = 1000;

export function createDashboardAccessStore(db: Kysely<InternalSchema>): DashboardAccessStore {
  const collect = (rows: Array<{ dashboard_id: string; role_id: string }>): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.dashboard_id, [...(out.get(r.dashboard_id) ?? []), r.role_id]);
    for (const list of out.values()) list.sort();
    return out;
  };
  return {
    async get(dashboardId) {
      const rows = await db.selectFrom('dashboard_access').select(['dashboard_id', 'role_id']).where('dashboard_id', '=', dashboardId).execute();
      return collect(rows).get(dashboardId) ?? [];
    },
    async set(dashboardId, roleIds) {
      return db.transaction().execute(async (trx) => {
        // Saves of one dashboard take turns on its row, so two at once never merge.
        await trx.selectFrom('dashboards').select('id').where('id', '=', dashboardId).forUpdate().execute();
        const read = async () => collect(await trx.selectFrom('dashboard_access').select(['dashboard_id', 'role_id'])
          .where('dashboard_id', '=', dashboardId).execute()).get(dashboardId) ?? [];
        const before = await read();
        await trx.deleteFrom('dashboard_access').where('dashboard_id', '=', dashboardId).execute();
        const rows = [...new Set(roleIds)].map((role_id) => ({ dashboard_id: dashboardId, role_id }));
        if (rows.length > 0) await trx.insertInto('dashboard_access').values(rows).execute();
        return { before, after: await read() };
      });
    },
    async forDashboards(dashboardIds) {
      const out = new Map<string, string[]>();
      const unique = [...new Set(dashboardIds)];
      for (let i = 0; i < unique.length; i += CHUNK) {
        const rows = await db.selectFrom('dashboard_access').select(['dashboard_id', 'role_id'])
          .where('dashboard_id', 'in', unique.slice(i, i + CHUNK)).execute();
        for (const [k, v] of collect(rows)) out.set(k, v);
      }
      return out;
    },
    async removeRole(roleId) {
      await db.deleteFrom('dashboard_access').where('role_id', '=', roleId).execute();
    },
  };
}
