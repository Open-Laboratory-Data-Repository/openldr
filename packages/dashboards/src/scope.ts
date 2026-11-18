import { sql, type RawBuilder } from 'kysely';
import { FACILITY_REGISTRY_SYSTEM } from '@openldr/db';

// The data limit as SQL (design 2026-11-18-roles-scope, part 3). A row counts for a limited user when
// its requesting facility or its testing lab is in their scope. A row with neither known does not
// count. Every value is bound, never inlined. The testing lab is reached with EXISTS, never a join,
// so counts do not fan out.

/** A data limit turned into what the warehouse can match. Built in bootstrap, which reads the
 *  register: `registryCodes` are the codes studio-entered orders carry for the in-scope register
 *  facilities, because those orders are not in facility_map. */
export interface ResolvedScope {
  registryIds: string[];
  regions: string[];
  districts: Array<{ region: string; district: string }>;
  registryCodes: string[];
}

/** How a model's rows reach a facility: a request, a report, or a result through its request. */
export type ScopeLink = 'request' | 'report' | 'result';

/** The text a limited user sees where a widget cannot be limited. */
export const NO_SCOPE_LINK = 'Not available with your data limit';

const ref = (alias: string, column: string) => sql.ref(`${alias}.${column}`);
const list = (values: readonly string[]) => sql.join(values.map((v) => sql`${v}`));
const NONE = sql<boolean>`1 = 0`;

function any(parts: RawBuilder<boolean>[]): RawBuilder<boolean> {
  return parts.length === 0 ? NONE : sql<boolean>`(${sql.join(parts, sql` or `)})`;
}

/** A facility_map row in scope: its register facility, region, or region and district. */
function mapRowInScope(fm: string, s: ResolvedScope): RawBuilder<boolean> {
  const parts: RawBuilder<boolean>[] = [];
  if (s.registryIds.length) parts.push(sql<boolean>`${ref(fm, 'registry_id')} in (${list(s.registryIds)})`);
  if (s.regions.length) parts.push(sql<boolean>`${ref(fm, 'region')} in (${list(s.regions)})`);
  for (const d of s.districts) parts.push(sql<boolean>`(${ref(fm, 'region')} = ${d.region} and ${ref(fm, 'district')} = ${d.district})`);
  return any(parts);
}

/** A facility code in scope, as facility_map knows it, or as a register code a studio order carries. */
function codeInScope(sourceSystem: RawBuilder<unknown>, codeSystem: RawBuilder<unknown>, code: RawBuilder<unknown>, s: ResolvedScope, n: string): RawBuilder<boolean> {
  const fm = `scope_fm_${n}`;
  const parts: RawBuilder<boolean>[] = [];
  const mapped = mapRowInScope(fm, s);
  if (mapped !== NONE) {
    parts.push(sql<boolean>`exists (select 1 from facility_map ${sql.id(fm)} where ${ref(fm, 'source_system')} = coalesce(${sourceSystem}, '') and ${ref(fm, 'performer_system')} = coalesce(${codeSystem}, '') and ${ref(fm, 'source_code')} = ${code} and ${mapped})`);
  }
  if (s.registryCodes.length) {
    parts.push(sql<boolean>`(${codeSystem} = ${FACILITY_REGISTRY_SYSTEM} and ${code} in (${list(s.registryCodes)}))`);
  }
  return any(parts);
}

const requesterInScope = (q: string, s: ResolvedScope, n: string) =>
  codeInScope(ref(q, 'source_system'), ref(q, 'requester_system'), ref(q, 'requester_code'), s, n);
const labInScope = (d: string, s: ResolvedScope, n: string) =>
  codeInScope(ref(d, 'source_system'), ref(d, 'performer_system'), ref(d, 'performer'), s, n);

/** A request in scope: its requester, or the lab of any report on it. */
function requestInScope(q: string, s: ResolvedScope, n: string): RawBuilder<boolean> {
  const dr = `scope_dr_${n}`;
  const lab = labInScope(dr, s, `${n}l`);
  const parts = [requesterInScope(q, s, `${n}r`)];
  if (lab !== NONE) parts.push(sql<boolean>`exists (select 1 from diagnostic_reports ${sql.id(dr)} where ${ref(dr, 'based_on_id')} = ${ref(q, 'id')} and ${lab})`);
  return any(parts.filter((p) => p !== NONE));
}

/** The scope as a condition on `alias`, a row of the kind named. */
export function scopeCondition(kind: ScopeLink, alias: string, s: ResolvedScope): RawBuilder<boolean> {
  if (kind === 'request') return requestInScope(alias, s, '1');
  const q = 'scope_q';
  if (kind === 'report') {
    const viaRequest = requesterInScope(q, s, '2');
    const parts = [labInScope(alias, s, '1')];
    if (viaRequest !== NONE) parts.push(sql<boolean>`exists (select 1 from lab_requests ${sql.id(q)} where ${ref(q, 'id')} = ${ref(alias, 'based_on_id')} and ${viaRequest})`);
    return any(parts.filter((p) => p !== NONE));
  }
  const inner = requestInScope(q, s, '2');
  if (inner === NONE) return NONE;
  return sql<boolean>`exists (select 1 from lab_requests ${sql.id(q)} where ${ref(q, 'id')} = ${ref(alias, 'request_id')} and ${inner})`;
}
