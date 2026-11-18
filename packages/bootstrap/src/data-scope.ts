import type { DataScope, UserDataScopeStore } from '@openldr/db';
import { registryConceptCodeById } from './facility-reconcile';

// A user's data limit (design 2026-11-18-roles-scope, part 3). The route and the CLI both set it
// here, then audit the save's own before and after.

/** A refused change of a data limit: the user is unknown, or a place is not in the register. */
export class DataScopeError extends Error {
  constructor(message: string, readonly reason: 'no-user' | 'not-in-register') { super(message); }
}

export interface DataScopeDeps {
  dataScopes: UserDataScopeStore;
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
  return deps.dataScopes.set(subject, scope);
}

/** A register row, as resolving a data limit needs it. */
export interface ScopeRegistryRow { id: string; name: string; facility_code: string | null; region: string | null; district: string | null }

/** A data limit turned into what the warehouse can match (`ResolvedScope` in @openldr/dashboards).
 *  Undefined for Everything. Facilities, regions and districts are matched in facility_map. Studio
 *  orders are not in facility_map: they carry the register code the picker emitted, so the codes of
 *  every in-scope register row are added, worked out as the projection does (a code two registers
 *  share becomes each row's own id). */
export async function resolveDataScope(
  deps: { registryRows(): Promise<ScopeRegistryRow[]> },
  scope: DataScope,
): Promise<{ registryIds: string[]; regions: string[]; districts: Array<{ region: string; district: string }>; registryCodes: string[] } | undefined> {
  if (!scope.limited) return undefined;
  const base = { registryIds: [...scope.facilities], regions: [...scope.regions], districts: scope.districts.map((d) => ({ ...d })) };
  if (!scope.facilities.length && !scope.regions.length && !scope.districts.length) return { ...base, registryCodes: [] };
  const rows = await deps.registryRows();
  const codeById = registryConceptCodeById(rows);
  const inScope = (r: ScopeRegistryRow) => scope.facilities.includes(r.id)
    || (r.region !== null && scope.regions.includes(r.region))
    || scope.districts.some((d) => d.region === r.region && d.district === r.district);
  const registryCodes = [...new Set(rows.filter(inScope).map((r) => codeById.get(r.id)!))].sort();
  return { ...base, registryCodes };
}
