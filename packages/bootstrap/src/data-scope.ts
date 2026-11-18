import type { DataScope, UserDataScopeStore } from '@openldr/db';

// A user's data limit (design 2026-11-18-roles-scope, part 3). The route and the CLI both set it
// here, then audit the save's own before and after.

/** A refused change of a data limit: the user is unknown, or a place is not in the register. */
export class DataScopeError extends Error {
  constructor(message: string, readonly reason: 'no-user' | 'not-in-register') { super(message); }
}

export interface DataScopeDeps {
  scopes: UserDataScopeStore;
  users: { get(id: string): Promise<unknown | undefined>; getBySubject(subject: string): Promise<unknown | undefined> };
  roles: { rolesForUser(subject: string): Promise<unknown[]> };
  facilityRegistry: {
    get(id: string): Promise<unknown | undefined>;
    list(opts: { region?: string; district?: string; limit?: number }): Promise<{ total: number }>;
  };
}

/** Set a user's data limit. The subject is the role subject (a user's subject, or its id when it has
 *  none). Every facility, district and region must be in the register, so nothing is typed in. */
export async function setUserDataScope(
  deps: DataScopeDeps,
  subject: string,
  scope: DataScope,
): Promise<{ before: DataScope; after: DataScope }> {
  // A user is known by a local row, a signed-in subject, or roles given before they first signed in.
  const known = (await deps.users.getBySubject(subject)) ?? (await deps.users.get(subject))
    ?? ((await deps.roles.rolesForUser(subject)).length > 0 ? subject : undefined);
  if (!known) throw new DataScopeError(`no user ${subject}`, 'no-user');
  if (scope.limited) {
    for (const id of scope.facilities) {
      if (!(await deps.facilityRegistry.get(id))) throw new DataScopeError(`no facility ${id} in the register`, 'not-in-register');
    }
    for (const region of scope.regions) {
      if ((await deps.facilityRegistry.list({ region, limit: 1 })).total === 0) {
        throw new DataScopeError(`no region ${region} in the register`, 'not-in-register');
      }
    }
    for (const d of scope.districts) {
      if ((await deps.facilityRegistry.list({ region: d.region, district: d.district, limit: 1 })).total === 0) {
        throw new DataScopeError(`no district ${d.district} in region ${d.region} in the register`, 'not-in-register');
      }
    }
  }
  return deps.scopes.set(subject, scope);
}
