import { sql, type Kysely } from 'kysely';
import type { ExternalSchema, TargetEngine } from '@openldr/db';
import { ageInYears, birthYear, createRefCodec, maskName, maskValue } from './patient-mask';
import { PatientIndexError, type PatientIdentifierSystems } from './patient-identifier-systems';

// The patient index reads (docs/superpowers/specs/2026-10-12-patient-index-design.md, sections 2-4).
// Read-only: the HIMS owns the records. Every response is built here, masked unless the caller holds
// patients.view_identifiers, and carries an opaque ref instead of the resource id.
//
// pg-mem has no correlated subqueries (AGENTS.md section 7), so per-row facts (identifiers, request
// stats, facility names) are separate queries over the page's ids, joined in code.

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const STATUSES = ['active', 'merged', 'all'] as const;

export type PatientStatus = typeof STATUSES[number];
export interface PatientListQuery { q: string; status: PatientStatus; limit: number; offset: number }
export interface PatientIdentifierView { system: string | null; label: string | null; value: string }
export interface PatientRow {
  ref: string; id: string | null; name: string | null; sex: string | null; birthDate: string | null;
  ageYears: number | null; identifiers: PatientIdentifierView[];
  managingFacility: { reference: string; name: string | null } | null;
  active: boolean; replacedByRef: string | null; lastRequestAt: string | null; requestCount: number;
}
export interface PatientList { rows: PatientRow[]; total: number; masked: boolean }
export interface PatientDetail extends PatientRow { patientGuid: string | null; phone: string | null; email: string | null; masked: boolean }
export interface PatientRequestRow { authoredAt: string | null; panel: string | null; requester: string | null; status: string | null; resultCount: number }
export interface PatientRequestList { rows: PatientRequestRow[]; total: number }

export interface PatientIndex {
  list(q: PatientListQuery, opts: { unmask: boolean }): Promise<PatientList>;
  get(ref: string, opts: { unmask: boolean }): Promise<PatientDetail>;
  getById(id: string, opts: { unmask: boolean }): Promise<PatientDetail>;
  idForRef(ref: string): string | null;
  requests(ref: string, q: { limit: number; offset: number }): Promise<PatientRequestList>;
  requestsById(id: string, q: { limit: number; offset: number }): Promise<PatientRequestList>;
}

export function parsePageQuery(raw: Record<string, unknown>): { ok: true; query: { limit: number; offset: number } } | { ok: false; error: string } {
  const limitRaw = raw.limit === undefined || raw.limit === '' ? String(DEFAULT_LIMIT) : String(raw.limit);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? '0' : String(raw.offset);
  if (!/^\d+$/.test(offsetRaw)) return { ok: false, error: 'offset must be a whole number from 0' };
  return { ok: true, query: { limit, offset: Number(offsetRaw) } };
}

export function parsePatientListQuery(raw: Record<string, unknown>): { ok: true; query: PatientListQuery } | { ok: false; error: string } {
  const status = raw.status === undefined || raw.status === '' ? 'active' : String(raw.status);
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'status must be active, merged or all' };
  const page = parsePageQuery(raw);
  if (!page.ok) return page;
  const q = typeof raw.search === 'string' ? raw.search.trim() : '';
  return { ok: true, query: { q, status: status as PatientStatus, ...page.query } };
}

type PatientRecord = {
  id: string; patient_guid: string | null; surname: string | null; firstname: string | null;
  date_of_birth: string | null; sex: string | null; phone: string | null; email: string | null;
  managing_organization: string | null; active: boolean; replaced_by_id: string | null;
};

const PATIENT_COLUMNS = ['id', 'patient_guid', 'surname', 'firstname', 'date_of_birth', 'sex', 'phone', 'email',
  'managing_organization', 'active', 'replaced_by_id'] as const;

const fullName = (r: { firstname: string | null; surname: string | null }) =>
  [r.firstname, r.surname].filter((s) => s && s.trim()).join(' ') || null;
const maskedName = (r: { firstname: string | null; surname: string | null }) =>
  [maskName(r.firstname), maskName(r.surname)].filter(Boolean).join(' ') || null;

/** The masked list's sort key: an MD5 hash of the patient id. A patient id can carry PID-3
 *  (`Patient/hl7-{id}`), so ordering by id would line rows up in the order of the full identifier
 *  beside their last four characters. The hash is stable, so paging holds, and says nothing about
 *  the id's value. Each dialect names the function differently. */
export function neutralOrder(engine: TargetEngine) {
  return engine === 'mssql'
    ? sql`convert(varchar(32), hashbytes('MD5', ${sql.ref('id')}), 2)`
    : sql`md5(${sql.ref('id')})`;
}

export function createPatientIndex(deps: {
  externalDb: Kysely<ExternalSchema>; systems: PatientIdentifierSystems; engine: TargetEngine;
  now?: () => Date; refKey?: Buffer;
}): PatientIndex {
  const { externalDb: db, systems } = deps;
  const now = deps.now ?? (() => new Date());
  const refs = createRefCodec(deps.refKey);

  /** Patient ids whose searchable identifier, or patient_guid, equals q exactly. */
  async function exactMatches(q: string): Promise<string[]> {
    const unsearchable = await systems.unsearchableSystems();
    let byIdentifier = db.selectFrom('patient_identifiers').select('patient_id').where('value', '=', q);
    if (unsearchable.length) {
      byIdentifier = byIdentifier.where((eb) => eb.or([eb('system', 'is', null), eb('system', 'not in', unsearchable)]));
    }
    const [a, b] = await Promise.all([
      byIdentifier.execute(),
      db.selectFrom('patients').select('id').where('patient_guid', '=', q).execute(),
    ]);
    return [...new Set([...a.map((r) => r.patient_id), ...b.map((r) => r.id)])];
  }

  async function identifiersFor(ids: string[]) {
    if (!ids.length) return new Map<string, { system: string | null; value: string }[]>();
    const rows = await db.selectFrom('patient_identifiers').select(['patient_id', 'system', 'value'])
      .where('patient_id', 'in', ids).orderBy('system').orderBy('value').execute();
    const out = new Map<string, { system: string | null; value: string }[]>();
    for (const r of rows) out.set(r.patient_id, [...(out.get(r.patient_id) ?? []), { system: r.system, value: r.value }]);
    return out;
  }

  async function requestStatsFor(ids: string[]) {
    if (!ids.length) return new Map<string, { n: number; last: string | null }>();
    const rows = await db.selectFrom('lab_requests')
      .select(['patient_id', (eb) => eb.fn.countAll<string | number>().as('n'), (eb) => eb.fn.max('authored_at').as('last')])
      .where('patient_id', 'in', ids).groupBy('patient_id').execute();
    return new Map(rows.map((r) => [String(r.patient_id), { n: Number(r.n), last: (r.last as string | null) ?? null }]));
  }

  async function facilityNamesFor(refsIn: (string | null)[]) {
    const ids = [...new Set(refsIn.filter((r): r is string => !!r).map((r) => r.replace(/^Organization\//, '')))];
    if (!ids.length) return new Map<string, string | null>();
    const rows = await db.selectFrom('facilities').select(['id', 'facility_name']).where('id', 'in', ids).execute();
    return new Map(rows.map((r) => [r.id, r.facility_name]));
  }

  async function build(records: PatientRecord[], unmask: boolean, allIdentifiers: boolean): Promise<Array<PatientRow & { record: PatientRecord }>> {
    const ids = records.map((r) => r.id);
    const [idents, stats, facilities] = await Promise.all([
      identifiersFor(ids), requestStatsFor(ids), facilityNamesFor(records.map((r) => r.managing_organization)),
    ]);
    const pageSystems = [...new Set([...idents.values()].flat().map((i) => i.system).filter((x): x is string => x !== null))];
    const settings = await systems.settingsFor(pageSystems);
    const today = now();
    return records.map((r) => {
      const identifiers = (idents.get(r.id) ?? [])
        .filter((i) => allIdentifiers || (i.system !== null && settings.get(i.system)?.listColumn === true))
        .map((i) => ({
          system: i.system,
          label: i.system === null ? null : settings.get(i.system)?.label ?? null,
          value: unmask ? i.value : (maskValue(i.value) as string),
        }));
      const org = r.managing_organization;
      const s = stats.get(r.id);
      return {
        record: r,
        ref: refs.encode(r.id),
        id: unmask ? r.id : null,
        name: unmask ? fullName(r) : maskedName(r),
        sex: r.sex,
        birthDate: unmask ? r.date_of_birth : birthYear(r.date_of_birth),
        ageYears: ageInYears(r.date_of_birth, today),
        identifiers,
        managingFacility: org ? { reference: org, name: facilities.get(org.replace(/^Organization\//, '')) ?? null } : null,
        active: Boolean(r.active),
        replacedByRef: r.replaced_by_id ? refs.encode(r.replaced_by_id) : null,
        lastRequestAt: s?.last ?? null,
        requestCount: s?.n ?? 0,
      };
    });
  }

  async function list(q: PatientListQuery, opts: { unmask: boolean }): Promise<PatientList> {
    let base = db.selectFrom('patients');
    if (q.status === 'active') base = base.where('active', '=', true).where('replaced_by_id', 'is', null);
    if (q.status === 'merged') base = base.where((eb) => eb.or([eb('active', '=', false), eb('replaced_by_id', 'is not', null)]));
    if (q.q) {
      const exact = await exactMatches(q.q);
      if (opts.unmask) {
        // lower(col) LIKE lower(?) holds on Postgres, MySQL and MSSQL, as reference-search.ts notes.
        const needle = `%${q.q.toLowerCase()}%`;
        base = base.where((eb) => eb.or([
          ...(['surname', 'firstname', 'patient_guid'] as const).map((c) => sql<boolean>`lower(${sql.ref(c)}) like ${needle}`),
          ...(exact.length ? [eb('id', 'in', exact)] : []),
        ]));
      } else {
        if (!exact.length) return { rows: [], total: 0, masked: true };
        base = base.where('id', 'in', exact);
      }
    }
    // A masked list sorts by a hash of the id (neutralOrder), so the order hints at neither the name
    // nor the identifier. The unique id ends both orders.
    let ordered = base.select([...PATIENT_COLUMNS]);
    ordered = opts.unmask
      ? ordered.orderBy('surname').orderBy('firstname').orderBy('id')
      : ordered.orderBy(neutralOrder(deps.engine)).orderBy('id');
    const [records, counted] = await Promise.all([
      ordered.limit(q.limit).offset(q.offset).execute(),
      base.select((eb) => eb.fn.countAll<string | number>().as('n')).executeTakeFirst(),
    ]);
    const rows = (await build(records as PatientRecord[], opts.unmask, false)).map(({ record: _r, ...row }) => row);
    return { rows, total: Number(counted?.n ?? 0), masked: !opts.unmask };
  }

  async function getById(id: string, opts: { unmask: boolean }): Promise<PatientDetail> {
    const record = await db.selectFrom('patients').select([...PATIENT_COLUMNS]).where('id', '=', id).executeTakeFirst();
    if (!record) throw new PatientIndexError('patient not found', 'not-found');
    const [{ record: r, ...row }] = await build([record as PatientRecord], opts.unmask, true);
    return {
      ...row,
      patientGuid: opts.unmask ? r.patient_guid : maskValue(r.patient_guid),
      phone: opts.unmask ? r.phone : null,
      email: opts.unmask ? r.email : null,
      masked: !opts.unmask,
    };
  }

  function idForRef(ref: string): string | null {
    return refs.decode(ref);
  }

  function requireId(ref: string): string {
    const id = refs.decode(ref);
    if (!id) throw new PatientIndexError('patient not found', 'not-found');
    return id;
  }

  async function requestsById(id: string, q: { limit: number; offset: number }): Promise<PatientRequestList> {
    const base = db.selectFrom('lab_requests').where('patient_id', '=', id);
    // Nulls last on every dialect: Postgres sorts nulls first in a descending order. id breaks ties.
    const [rows, counted] = await Promise.all([
      base.select(['id', 'authored_at', 'panel_code', 'panel_desc', 'requester_display', 'requester_code', 'status'])
        .orderBy(sql`case when authored_at is null then 1 else 0 end`).orderBy('authored_at', 'desc').orderBy('id')
        .limit(q.limit).offset(q.offset).execute(),
      base.select((eb) => eb.fn.countAll<string | number>().as('n')).executeTakeFirst(),
    ]);
    const ids = rows.map((r) => r.id);
    // A cancelled result is a rejected test with no value (024_lab_result_status), so it is not counted.
    const results = ids.length
      ? await db.selectFrom('lab_results').select(['request_id', (eb) => eb.fn.countAll<string | number>().as('n')])
        .where('request_id', 'in', ids)
        .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'cancelled')]))
        .groupBy('request_id').execute()
      : [];
    const counts = new Map(results.map((r) => [String(r.request_id), Number(r.n)]));
    return {
      rows: rows.map((r) => ({
        authoredAt: r.authored_at,
        panel: r.panel_desc ?? r.panel_code,
        requester: r.requester_display ?? r.requester_code,
        status: r.status,
        resultCount: counts.get(r.id) ?? 0,
      })),
      total: Number(counted?.n ?? 0),
    };
  }

  return {
    list,
    get: async (ref, opts) => getById(requireId(ref), opts),
    getById,
    idForRef,
    requests: async (ref, q) => requestsById(requireId(ref), q),
    requestsById,
  };
}
