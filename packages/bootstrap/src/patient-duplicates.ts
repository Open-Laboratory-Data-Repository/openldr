import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { ExternalSchema, InternalSchema } from '@openldr/db';
import { toCsv } from '@openldr/reporting';
import { maskValue } from './patient-mask';
import { PatientIndexError, type PatientIdentifierSystems } from './patient-identifier-systems';
import type { PatientIndex, PatientRow } from './patient-index';

// Likely duplicate patients (docs/superpowers/specs/2026-10-12-patient-duplicates-design.md). CE lists
// them with the evidence; the source system's team fixes them there. CE does not merge.
//
// Two exact rules: a shared identifier value in one searchable system, and a shared match_key with
// compatible sexes. Dismissals live in the internal db and patients in the warehouse, so groups are
// filtered and paged in code. That holds for thousands of groups, not hundreds of thousands.

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const STATUSES = ['open', 'dismissed', 'all'] as const;
const CHUNK = 500;
const MEMBER_CAP = 50;
const MAX_REFS = 50;
const INSERT_CHUNK = 200;
const DELETE_CHUNK = 100;
const PAIR_LIMIT_ERROR = 'refs must list at most 50 patients';

export type DuplicateRule = 'identifier' | 'details';
export type DuplicateStatus = typeof STATUSES[number];
export interface DuplicateGroup {
  rule: DuplicateRule;
  evidence: { system: string | null; label: string | null; text: string };
  /** At most 50 members; memberCount is the full size of the group. */
  members: PatientRow[];
  memberCount: number;
  pairs: number;
  dismissedPairs: number;
}
export interface DuplicateList { rows: DuplicateGroup[]; total: number; masked: boolean }
export interface PatientDuplicates {
  list(q: { status: DuplicateStatus; limit: number; offset: number }, opts: { unmask: boolean }): Promise<DuplicateList>;
  dismiss(input: { ids: string[]; reason: string | null; by: string }): Promise<{ changed: number }>;
  restore(input: { ids: string[] }): Promise<{ changed: number }>;
  exportCsv(): Promise<{ csv: string; groups: number }>;
}

export function parseDuplicateListQuery(raw: Record<string, unknown>): { ok: true; query: { status: DuplicateStatus; limit: number; offset: number } } | { ok: false; error: string } {
  const status = raw.status === undefined || raw.status === '' ? 'open' : String(raw.status);
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'status must be open, dismissed or all' };
  const limitRaw = raw.limit === undefined || raw.limit === '' ? String(DEFAULT_LIMIT) : String(raw.limit);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? '0' : String(raw.offset);
  if (!/^\d+$/.test(offsetRaw)) return { ok: false, error: 'offset must be a whole number from 0' };
  return { ok: true, query: { status: status as DuplicateStatus, limit, offset: Number(offsetRaw) } };
}

export function parsePairInput(raw: unknown): { ok: true; refs: string[]; reason: string | null } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const refs = Array.isArray(r.refs) ? r.refs.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  if (new Set(refs).size < 2 || refs.length !== new Set(refs).size) return { ok: false, error: 'refs must list at least two different patients' };
  if (refs.length > MAX_REFS) return { ok: false, error: PAIR_LIMIT_ERROR };
  const reason = typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : null;
  return { ok: true, refs, reason };
}

export type RawGroup = {
  rule: DuplicateRule; system: string | null; value: string;
  ids: string[];               // every member, sorted by id
  pairs: number;               // compatible pairs, counted arithmetically
  sexes?: Map<string, string | null>; // details groups only
};

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
const sorted = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
// The list order is a hash of the group key, so it hints at neither names nor identifier values, the
// same reason the masked patient list orders by md5(id).
const orderKey = (g: RawGroup) => md5(`${g.rule}|${g.system ?? ''}|${g.value}`);

function allPairs(ids: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) out.push(sorted(ids[i], ids[j]));
  return out;
}

function chunks<T>(xs: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export type ExactRow = { system: string | null; value: string; patient_id: string };

/** Regroup identifier rows on the exact (system, value) they carry. A case-insensitive collation
 *  (MySQL, MSSQL) makes the SQL grouping fold 'AB12' and 'ab12' together; the rule is an exact
 *  match, so a group needs two or more distinct patients under one exact pair. */
export function groupExact(rows: ExactRow[]): RawGroup[] {
  const bySystem = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    if (r.system === null) continue;
    const byValue = bySystem.get(r.system) ?? new Map<string, Set<string>>();
    byValue.set(r.value, (byValue.get(r.value) ?? new Set()).add(r.patient_id));
    bySystem.set(r.system, byValue);
  }
  const out: RawGroup[] = [];
  for (const [system, byValue] of bySystem) {
    for (const [value, set] of byValue) {
      if (set.size < 2) continue;
      const ids = [...set].sort();
      out.push({ rule: 'identifier', system, value, ids, pairs: (ids.length * (ids.length - 1)) / 2 });
    }
  }
  return out;
}

const compatible = (a: string | null | undefined, b: string | null | undefined) => !a || !b || a === b;

export function createPatientDuplicates(deps: {
  internalDb: Kysely<InternalSchema>; externalDb: Kysely<ExternalSchema>; index: PatientIndex; systems: PatientIdentifierSystems;
}): PatientDuplicates {
  const { internalDb, externalDb: db, index, systems } = deps;

  async function identifierGroups(): Promise<RawGroup[]> {
    const unsearchable = await systems.unsearchableSystems();
    let inner = db.selectFrom('patient_identifiers as i')
      .innerJoin('patients as p', 'p.id', 'i.patient_id')
      .select(['i.system', 'i.value', (eb) => eb.fn.count('i.patient_id').distinct().as('n')])
      .where('i.system', 'is not', null)
      .where('p.active', '=', true).where('p.replaced_by_id', 'is', null);
    if (unsearchable.length) inner = inner.where('i.system', 'not in', unsearchable);
    // Duplicate keys are found in SQL. The count is filtered in an outer WHERE because pg-mem rejects
    // HAVING with an aggregate; Postgres and MySQL plan the two forms the same way.
    const found = await db.selectFrom(inner.groupBy(['i.system', 'i.value']).as('g'))
      .select(['g.system', 'g.value']).where('g.n', '>', 1).execute();
    // Load the members per system, so the (system, value) index serves each query.
    const valuesBySystem = new Map<string, Set<string>>();
    for (const k of found) {
      if (k.system === null) continue;
      valuesBySystem.set(k.system, (valuesBySystem.get(k.system) ?? new Set()).add(k.value));
    }
    const loaded: ExactRow[] = [];
    for (const [system, values] of valuesBySystem) {
      for (const part of chunks([...values])) {
        const rows = await db.selectFrom('patient_identifiers as i')
          .innerJoin('patients as p', 'p.id', 'i.patient_id')
          .select(['i.system', 'i.value', 'i.patient_id'])
          .where('i.system', '=', system).where('i.value', 'in', part)
          .where('p.active', '=', true).where('p.replaced_by_id', 'is', null).execute();
        loaded.push(...rows);
      }
    }
    return groupExact(loaded);
  }

  async function detailGroups(): Promise<RawGroup[]> {
    const inner = db.selectFrom('patients')
      .select(['match_key', (eb) => eb.fn.countAll().as('n')])
      .where('match_key', 'is not', null).where('active', '=', true).where('replaced_by_id', 'is', null)
      .groupBy('match_key').as('g');
    const found = await db.selectFrom(inner).select('g.match_key').where('g.n', '>', 1).execute();
    const byKey = new Map<string, { id: string; sex: string | null }[]>();
    for (const keys of chunks(found.map((f) => f.match_key as string))) {
      const rows = await db.selectFrom('patients').select(['id', 'sex', 'match_key'])
        .where('match_key', 'in', keys).where('active', '=', true).where('replaced_by_id', 'is', null).execute();
      for (const r of rows) {
        const key = r.match_key as string;
        const list = byKey.get(key) ?? [];
        list.push({ id: r.id, sex: r.sex });
        byKey.set(key, list);
      }
    }
    const out: RawGroup[] = [];
    for (const [value, people] of byKey) {
      // Sexes are compatible when equal or when either is missing (spec section 1). Count the pairs
      // arithmetically: all pairs, minus pairs whose two sexes are both set and different.
      const n = people.length;
      const bySex = new Map<string, number>();
      let nulls = 0;
      for (const p of people) { if (p.sex) bySex.set(p.sex, (bySex.get(p.sex) ?? 0) + 1); else nulls += 1; }
      const set = n - nulls;
      let squares = 0;
      for (const c of bySex.values()) squares += c * c;
      const pairs = (n * (n - 1)) / 2 - (set * set - squares) / 2;
      if (pairs === 0) continue;
      // A member belongs to the group only if some other member is compatible with it.
      const kept = people.filter((p) => (p.sex ? nulls > 0 || (bySex.get(p.sex) ?? 0) > 1 : n > 1));
      const ids = kept.map((p) => p.id).sort();
      out.push({ rule: 'details', system: null, value, ids, pairs, sexes: new Map(kept.map((p) => [p.id, p.sex])) });
    }
    return out;
  }

  async function dismissedRows(ids: string[]): Promise<[string, string][]> {
    const out: [string, string][] = [];
    for (const part of chunks([...new Set(ids)])) {
      const rows = await internalDb.selectFrom('patient_duplicate_dismissals').select(['patient_a', 'patient_b'])
        .where('patient_a', 'in', part).execute();
      for (const r of rows) out.push([r.patient_a, r.patient_b]);
    }
    return out;
  }

  async function groupsWithStatus(): Promise<Array<RawGroup & { dismissedPairs: number }>> {
    const groups = [...await identifierGroups(), ...await detailGroups()];
    const groupsOf = new Map<string, number[]>();
    groups.forEach((g, gi) => g.ids.forEach((id) => groupsOf.set(id, [...(groupsOf.get(id) ?? []), gi])));
    const counts = groups.map(() => 0);
    for (const [a, b] of await dismissedRows([...groupsOf.keys()])) {
      const inB = groupsOf.get(b);
      if (!inB) continue;
      for (const gi of groupsOf.get(a) ?? []) {
        if (!inB.includes(gi)) continue;
        const sexes = groups[gi].sexes;
        if (sexes && !compatible(sexes.get(a), sexes.get(b))) continue;
        counts[gi] += 1;
      }
    }
    return groups
      .map((g, gi) => ({ ...g, dismissedPairs: counts[gi] }))
      .sort((x, y) => (orderKey(x) < orderKey(y) ? -1 : orderKey(x) > orderKey(y) ? 1 : 0));
  }

  async function list(q: { status: DuplicateStatus; limit: number; offset: number }, opts: { unmask: boolean }): Promise<DuplicateList> {
    const all = await groupsWithStatus();
    const matched = all.filter((g) => q.status === 'all'
      || (q.status === 'open' ? g.dismissedPairs < g.pairs : g.dismissedPairs === g.pairs));
    const page = matched.slice(q.offset, q.offset + q.limit);
    const systemsOnPage = [...new Set(page.map((g) => g.system).filter((s): s is string => s !== null))];
    const labels = await systems.settingsFor(systemsOnPage);
    // Masked, the members show in md5(id) order: ids can carry PID-3, so id order would line members up
    // beside the full identifier. Unmasked, they stay in id order.
    const shown = page.map((g) => (opts.unmask ? g.ids : [...g.ids].sort((a, b) => (md5(a) < md5(b) ? -1 : 1))).slice(0, MEMBER_CAP));
    const built = await index.rowsByIds([...new Set(shown.flat())], opts);
    const byId = new Map<string, PatientRow>();
    for (const row of built) { const id = index.idForRef(row.ref); if (id) byId.set(id, row); }
    const rows: DuplicateGroup[] = [];
    page.forEach((g, i) => {
      const members = shown[i].map((id) => byId.get(id)).filter((r): r is PatientRow => r !== undefined);
      // Details evidence comes from the first member's row, which rowsByIds has already masked.
      const text = g.rule === 'identifier'
        ? (opts.unmask ? g.value : (maskValue(g.value) as string))
        : [members[0]?.name, members[0]?.birthDate].filter(Boolean).join(', ');
      rows.push({
        rule: g.rule,
        evidence: { system: g.system, label: g.system ? labels.get(g.system)?.label ?? null : null, text },
        members,
        memberCount: g.ids.length,
        pairs: g.pairs,
        dismissedPairs: g.dismissedPairs,
      });
    });
    return { rows, total: matched.length, masked: !opts.unmask };
  }

  async function requireKnown(ids: string[]): Promise<void> {
    if (new Set(ids).size < 2 || ids.length !== new Set(ids).size) {
      throw new PatientIndexError('list at least two different patients', 'invalid');
    }
    if (ids.length > MAX_REFS) throw new PatientIndexError(PAIR_LIMIT_ERROR, 'invalid');
    let found = 0;
    for (const part of chunks(ids)) {
      found += (await db.selectFrom('patients').select('id').where('id', 'in', part).execute()).length;
    }
    if (found !== ids.length) throw new PatientIndexError('patient not found', 'not-found');
  }

  async function dismiss(input: { ids: string[]; reason: string | null; by: string }): Promise<{ changed: number }> {
    await requireKnown(input.ids);
    const pairs = allPairs([...input.ids].sort());
    const existing = new Set((await dismissedRows(input.ids)).map(([a, b]) => pairKey(a, b)));
    const fresh = pairs.filter(([a, b]) => !existing.has(pairKey(a, b)));
    for (const part of chunks(fresh, INSERT_CHUNK)) {
      await internalDb.insertInto('patient_duplicate_dismissals')
        .values(part.map(([a, b]) => ({ patient_a: a, patient_b: b, reason: input.reason, dismissed_by: input.by })))
        .onConflict((oc) => oc.columns(['patient_a', 'patient_b']).doNothing())
        .execute();
    }
    return { changed: fresh.length };
  }

  async function restore(input: { ids: string[] }): Promise<{ changed: number }> {
    await requireKnown(input.ids);
    let changed = 0;
    for (const part of chunks(allPairs([...input.ids].sort()), DELETE_CHUNK)) {
      const res = await internalDb.deleteFrom('patient_duplicate_dismissals')
        .where((eb) => eb.or(part.map(([a, b]) => eb.and([eb('patient_a', '=', a), eb('patient_b', '=', b)]))))
        .executeTakeFirst();
      changed += Number(res.numDeletedRows ?? 0);
    }
    return { changed };
  }

  async function exportCsv(): Promise<{ csv: string; groups: number }> {
    const open = (await groupsWithStatus()).filter((g) => g.dismissedPairs < g.pairs);
    const ids = [...new Set(open.flatMap((g) => g.ids))];
    const people = new Map<string, Record<string, string | null>>();
    for (const part of chunks(ids)) {
      const rows = await db.selectFrom('patients')
        .select(['id', 'patient_guid', 'surname', 'firstname', 'date_of_birth', 'sex', 'managing_organization'])
        .where('id', 'in', part).execute();
      for (const r of rows) people.set(r.id, r as unknown as Record<string, string | null>);
    }
    const facilityIds = [...new Set([...people.values()].map((p) => p.managing_organization).filter((x): x is string => !!x)
      .map((x) => x.replace(/^Organization\//, '')))];
    const facilities = new Map<string, string | null>();
    for (const part of chunks(facilityIds)) {
      for (const f of await db.selectFrom('facilities').select(['id', 'facility_name']).where('id', 'in', part).execute()) {
        facilities.set(f.id, f.facility_name);
      }
    }
    const labels = await systems.settingsFor([...new Set(open.map((g) => g.system).filter((s): s is string => s !== null))]);
    const columns = ['group', 'rule', 'system_label', 'evidence', 'patient_id', 'patient_guid', 'surname', 'firstname',
      'date_of_birth', 'sex', 'managing_facility'].map((k) => ({ key: k, label: k }));
    const rows: Record<string, unknown>[] = [];
    open.forEach((g, i) => {
      for (const id of g.ids) {
        const p = people.get(id);
        if (!p) continue;
        const org = p.managing_organization?.replace(/^Organization\//, '') ?? null;
        rows.push({
          group: i + 1, rule: g.rule,
          system_label: g.system ? labels.get(g.system)?.label ?? g.system : '',
          evidence: g.rule === 'identifier' ? g.value
            : [[p.firstname, p.surname].filter(Boolean).join(' '), p.date_of_birth].filter(Boolean).join(', '),
          patient_id: id, patient_guid: p.patient_guid, surname: p.surname, firstname: p.firstname,
          date_of_birth: p.date_of_birth, sex: p.sex, managing_facility: org ? facilities.get(org) ?? p.managing_organization : '',
        });
      }
    });
    return { csv: toCsv(columns, rows), groups: open.length };
  }

  return { list, dismiss, restore, exportCsv };
}
