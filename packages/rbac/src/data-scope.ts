// A user's data limit (design 2026-11-18-roles-scope, part 3). Everything is today's behaviour. A
// limited user sees dashboard numbers only from the listed facilities, districts and regions of the
// facility register. Limited with nothing listed sees nothing.

/** A district, with its region, because district names repeat across regions. */
export interface ScopeDistrict { region: string; district: string }

export type DataScope =
  | { limited: false }
  | { limited: true; facilities: string[]; districts: ScopeDistrict[]; regions: string[] };

export const EVERYTHING: DataScope = { limited: false };

/** What a limited user loses, wherever capabilities are resolved, so every route refuses alike.
 *  Each reads data the limit does not cover (reports, patients, SQL, exports, workflows, sync
 *  bodies, audit), or would let the user write SQL (dashboards.create and edit). The Users sheet
 *  shows this list. Forms, dashboards.view and admin settings stay. A limited user is a site
 *  clerk, and reception (lab.receive, lab.reject) is the lab's own desk, which finds patients and
 *  orders from every facility, so those two go as well. The other lab keys stay. */
export const LIMITED_SCOPE_DROPS: readonly string[] = [
  'reports.view', 'reports.run', 'reports.export', 'reports.edit_templates',
  'patients.view', 'patients.manage', 'patients.view_identifiers',
  'query.run', 'query.manage', 'data.export',
  'dashboards.create', 'dashboards.edit',
  'workflows.view', 'workflows.edit', 'workflows.run',
  'connectors.manage', 'audit.view', 'activity.view', 'imports.correct_held',
  'facilities.view', 'sync.view', 'sync.manage',
  'lab.receive', 'lab.reject',
];

/** The capabilities a person keeps under their data limit. */
export function capabilitiesUnderScope(capabilities: string[], scope: DataScope): string[] {
  if (!scope.limited) return capabilities;
  return capabilities.filter((c) => !LIMITED_SCOPE_DROPS.includes(c));
}
