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

export type DuplicateRule = 'identifier' | 'details';
export type DuplicateStatus = typeof STATUSES[number];
export interface DuplicateGroup {
  rule: DuplicateRule;
  evidence: { system: string | null; label: string | null; text: string };
  members: PatientRow[];
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
  const reason = typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : null;
  return { ok: true, refs, reason };
}

type RawGroup = { rule: DuplicateRule; system: string | null; value: string; ids: string[]; pairs: [string, string][] };

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
const sorted = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
// The list order is a hash of the group key, so it hints at neither names nor identifier values, the
// same reason the masked patient list orders by md5(id).
const orderKey = (g: RawGroup) => createHash('md5').update(`${g.rule}|${g.system ?? ''}|${g.value}`).digest('hex');

function allPairs(ids: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) out.push(sorted(ids[i], ids[j]));
  return out;
}

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

export function createPatientDuplicates(deps: {
  internalDb: Kysely<InternalSchema>; externalDb: Kysely<ExternalSchema>; index: PatientIndex; systems: PatientIdentifierSystems;
}): PatientDuplicates {
  const { internalDb, externalDb: db, index, systems } = deps;

  async function identifierGroups(): Promise<RawGroup[]> {
    const unsearchable = await systems.unsearchableSystems();
    let keys = db.selectFrom('patient_identifiers as i')
      .innerJoin('patients as p', 'p.id', 'i.patient_id')
      .select(['i.system', 'i.value', 'i.patient_id'])
      .where('i.system', 'is not', null)
      .where('p.active', '=', true).where('p.replaced_by_id', 'is', null);
    if (unsearchable.length) keys = keys.where('i.system', 'not in', unsearchable);
    // pg-mem rejects count(distinct) in having, so the rows come back plain and are counted here.
    const rows = await keys.execute();
    const members = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = `${r.system}\u0000${r.value}`;
      members.set(k, (members.get(k) ?? new Set()).add(r.patient_id));
    }
    for (const [k, set] of members) if (set.size < 2) members.delete(k);
    return [...members].map(([k, set]) => {
      const [system, value] = k.split('\u0000');
      const ids = [...set].sort();
      return { rule: 'identifier' as const, system, value, ids, pairs: allPairs(ids) };
    });
  }

  async function detailGroups(): Promise<RawGroup[]> {
    // Plain select, grouped here, for the same pg-mem reason as identifierGroups.
    const rows = await db.selectFrom('patients').select(['id', 'sex', 'match_key'])
      .where('match_key', 'is not', null).where('active', '=', true).where('replaced_by_id', 'is', null).execute();
    const byKey = new Map<string, { id: string; sex: string | null }[]>();
    for (const r of rows) byKey.set(r.match_key as string, [...(byKey.get(r.match_key as string) ?? []), { id: r.id, sex: r.sex }]);
    const out: RawGroup[] = [];
    for (const [value, list] of byKey) {
      const people = [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
      // Sexes are compatible when equal or when either is missing (spec section 1).
      const pairs: [string, string][] = [];
      for (let i = 0; i < people.length; i += 1) {
        for (let j = i + 1; j < people.length; j += 1) {
          const a = people[i]; const b = people[j];
          if (!a.sex || !b.sex || a.sex === b.sex) pairs.push(sorted(a.id, b.id));
        }
      }
      if (!pairs.length) continue;
      const ids = [...new Set(pairs.flat())].sort();
      out.push({ rule: 'details', system: null, value, ids, pairs });
    }
    return out;
  }

  async function dismissedAmong(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const part of chunks([...new Set(ids)])) {
      const rows = await internalDb.selectFrom('patient_duplicate_dismissals').select(['patient_a', 'patient_b'])
        .where('patient_a', 'in', part).execute();
      for (const r of rows) out.add(pairKey(r.patient_a, r.patient_b));
    }
    return out;
  }

  async function groupsWithStatus(): Promise<Array<RawGroup & { dismissedPairs: number }>> {
    const groups = [...await identifierGroups(), ...await detailGroups()];
    const dismissed = await dismissedAmong(groups.flatMap((g) => g.ids));
    return groups
      .map((g) => ({ ...g, dismissedPairs: g.pairs.filter(([a, b]) => dismissed.has(pairKey(a, b))).length }))
      .sort((x, y) => (orderKey(x) < orderKey(y) ? -1 : orderKey(x) > orderKey(y) ? 1 : 0));
  }

  async function list(q: { status: DuplicateStatus; limit: number; offset: number }, opts: { unmask: boolean }): Promise<DuplicateList> {
    const all = await groupsWithStatus();
    const matched = all.filter((g) => q.status === 'all'
      || (q.status === 'open' ? g.dismissedPairs < g.pairs.length : g.dismissedPairs === g.pairs.length));
    const page = matched.slice(q.offset, q.offset + q.limit);
    const systemsOnPage = [...new Set(page.map((g) => g.system).filter((s): s is string => s !== null))];
    const labels = await systems.settingsFor(systemsOnPage);
    const rows: DuplicateGroup[] = [];
    for (const g of page) {
      const members = await index.rowsByIds(g.ids, opts);
      // Details evidence comes from the first member's row, which rowsByIds has already masked.
      const text = g.rule === 'identifier'
        ? (opts.unmask ? g.value : (maskValue(g.value) as string))
        : [members[0]?.name, members[0]?.birthDate].filter(Boolean).join(', ');
      rows.push({
        rule: g.rule,
        evidence: { system: g.system, label: g.system ? labels.get(g.system)?.label ?? null : null, text },
        members,
        pairs: g.pairs.length,
        dismissedPairs: g.dismissedPairs,
      });
    }
    return { rows, total: matched.length, masked: !opts.unmask };
  }

  async function requireKnown(ids: string[]): Promise<void> {
    if (new Set(ids).size < 2 || ids.length !== new Set(ids).size) {
      throw new PatientIndexError('list at least two different patients', 'invalid');
    }
    const found = await db.selectFrom('patients').select('id').where('id', 'in', ids).execute();
    if (found.length !== ids.length) throw new PatientIndexError('patient not found', 'not-found');
  }

  async function dismiss(input: { ids: string[]; reason: string | null; by: string }): Promise<{ changed: number }> {
    await requireKnown(input.ids);
    const pairs = allPairs([...input.ids].sort());
    const existing = await dismissedAmong(input.ids);
    const fresh = pairs.filter(([a, b]) => !existing.has(pairKey(a, b)));
    if (fresh.length) {
      await internalDb.insertInto('patient_duplicate_dismissals')
        .values(fresh.map(([a, b]) => ({ patient_a: a, patient_b: b, reason: input.reason, dismissed_by: input.by })))
        .execute();
    }
    return { changed: fresh.length };
  }

  async function restore(input: { ids: string[] }): Promise<{ changed: number }> {
    await requireKnown(input.ids);
    let changed = 0;
    for (const [a, b] of allPairs([...input.ids].sort())) {
      const res = await internalDb.deleteFrom('patient_duplicate_dismissals')
        .where('patient_a', '=', a).where('patient_b', '=', b).executeTakeFirst();
      changed += Number(res.numDeletedRows ?? 0);
    }
    return { changed };
  }

  async function exportCsv(): Promise<{ csv: string; groups: number }> {
    const open = (await groupsWithStatus()).filter((g) => g.dismissedPairs < g.pairs.length);
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
          evidence: g.rule === 'identifier' ? g.value : [p.surname, p.firstname, p.date_of_birth].filter(Boolean).join(' '),
          patient_id: id, patient_guid: p.patient_guid, surname: p.surname, firstname: p.firstname,
          date_of_birth: p.date_of_birth, sex: p.sex, managing_facility: org ? facilities.get(org) ?? p.managing_organization : '',
        });
      }
    });
    return { csv: toCsv(columns, rows), groups: open.length };
  }

  return { list, dismiss, restore, exportCsv };
}
