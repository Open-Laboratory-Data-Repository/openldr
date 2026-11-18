import type { DashboardAccessStore } from '@openldr/db';
import type { FormUser } from './form-access';

// Who may see a dashboard (design 2026-11-18-roles-scope, part 2). The dashboard routes, the CLI
// and the dashboard list all ask here, so they agree.
//
// An empty list keeps the old rule: dashboards.view alone. A list narrows it to people who also hold
// one of the listed roles. The owner always passes, and so does a holder of roles.manage. A
// dashboard with no owner (every one made before this) has only admins as its owner.

/** The person asking: their user id, role ids and capabilities. */
export interface DashboardUser extends FormUser { id: string }
/** What the check needs of a dashboard. */
export interface DashboardRef { id: string; ownerId: string | null }

const ADMIN = 'roles.manage';

export function dashboardAccess(deps: { access: DashboardAccessStore }) {
  const isAdmin = (u: DashboardUser) => u.capabilities.includes(ADMIN);
  const owns = (u: DashboardUser, d: DashboardRef) => d.ownerId !== null && d.ownerId === u.id;
  const sees = (u: DashboardUser, d: DashboardRef, list: string[]): boolean => {
    if (isAdmin(u)) return true;
    if (!u.capabilities.includes('dashboards.view')) return false;
    return owns(u, d) || list.length === 0 || list.some((r) => u.roleIds.includes(r));
  };
  return {
    async maySee(u: DashboardUser, d: DashboardRef): Promise<boolean> {
      return sees(u, d, await deps.access.get(d.id));
    },
    /** Only the owner or an admin may change who a dashboard is shared with. */
    mayShare(u: DashboardUser, d: DashboardRef): boolean {
      return isAdmin(u) || (owns(u, d) && u.capabilities.includes('dashboards.view'));
    },
    /** The dashboards of `ds` the person may see, in the same order. */
    async visible<T extends DashboardRef>(u: DashboardUser, ds: T[]): Promise<T[]> {
      const lists = await deps.access.forDashboards(ds.map((d) => d.id));
      return ds.filter((d) => sees(u, d, lists.get(d.id) ?? []));
    },
  };
}
export type DashboardAccessCheck = ReturnType<typeof dashboardAccess>;

/** A refused change of a dashboard's share list: the dashboard or a role does not exist. */
export class DashboardShareError extends Error {
  constructor(message: string, readonly reason: 'no-dashboard' | 'no-role') { super(message); }
}

/** Set who a dashboard is shared with. A role is named by its id or slug and stored by id, each
 *  once. The route and the CLI both call this, then audit the save's own before and after. Whether
 *  the caller may share is the caller's check (mayShare), made before this. */
export async function setDashboardShare(
  deps: {
    access: DashboardAccessStore;
    dashboards: { get(id: string): Promise<unknown | null | undefined> };
    roles: { list(): Promise<Array<{ id: string; slug: string }>> };
  },
  dashboardId: string,
  names: string[],
): Promise<{ before: string[]; after: string[] }> {
  if (!(await deps.dashboards.get(dashboardId))) throw new DashboardShareError(`no dashboard ${dashboardId}`, 'no-dashboard');
  const roles = await deps.roles.list();
  const ids = names.map((name) => {
    const role = roles.find((r) => r.id === name) ?? roles.find((r) => r.slug === name);
    if (!role) throw new DashboardShareError(`no role ${name}`, 'no-role');
    return role.id;
  });
  return deps.access.set(dashboardId, [...new Set(ids)]);
}
