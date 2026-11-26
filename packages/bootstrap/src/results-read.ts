import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { scopeCondition, type ResolvedScope, type SqlDialect } from '@openldr/dashboards';

// Released lab results for a plugin (design 2026-11-26-plugin-connector-approval-and-results).
// Released means final, amended or corrected. A limited caller reads only results whose request's
// requesting facility or testing lab is in their limit: the dashboards' own rule (scope.ts).

/** The statuses a plugin may read. Preliminary, registered, cancelled and entered-in-error are not. */
export const RELEASED_STATUSES = ['final', 'amended', 'corrected'] as const;
/** The most results one page holds. */
export const RESULTS_PAGE_MAX = 200;

/** One released result as CE stores it. The patient is the warehouse id; plugin-host.ts turns it into
 *  the plugin's own lasting reference before a plugin sees it. */
export interface StoredResult {
  id: string;
  requestId: string | null;
  patientId: string | null;
  observation: { code: string | null; system: string | null; display: string | null };
  value: { type: string | null; number: number | null; units: string | null; comparator: string | null; code: string | null; text: string | null };
  abnormalFlag: string | null;
  status: string;
  resultTime: string | null;
  specimenId: string | null;
  requester: { code: string | null; system: string | null };
  storedAt: string;
}

export interface ResultsQuery {
  /** Result time from, inclusive (ISO). A result with no result time is left out when given. */
  since?: string;
  /** Result time until, exclusive (ISO). */
  until?: string;
  /** Warehouse patient id. */
  patientId?: string;
  /** Observation code. */
  observation?: string;
  /** The `next` of the page before, or null or absent for the first page. */
  after?: string | null;
  limit: number;
}

export interface ResultsRead {
  /** A page in the order CE stored them, then by id, so a page never shifts while results are added. */
  list(q: ResultsQuery, scope: ResolvedScope | undefined): Promise<{ results: StoredResult[]; next: string | null }>;
  /** One released result, or null when there is none or it is outside the scope. */
  get(id: string, scope: ResolvedScope | undefined): Promise<StoredResult | null>;
}

/** A page key: when the last row was stored, and its id. Opaque to a plugin. */
export function encodeResultsKey(storedAt: string, id: string): string {
  return Buffer.from(JSON.stringify([storedAt, id]), 'utf8').toString('base64url');
}

export function decodeResultsKey(key: string): { storedAt: string; id: string } | null {
  try {
    const v = JSON.parse(Buffer.from(key, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'string' || typeof v[1] !== 'string') return null;
    if (Number.isNaN(Date.parse(v[0]))) return null;
    return { storedAt: v[0], id: v[1] };
  } catch {
    return null;
  }
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

export function createResultsRead(db: Kysely<ExternalSchema>, engine: SqlDialect = 'postgres'): ResultsRead {
  function base(scope: ResolvedScope | undefined) {
    let qb = db.selectFrom('lab_results as lr')
      .leftJoin('lab_requests as rq', 'rq.id', 'lr.request_id')
      .select([
        'lr.id', 'lr.request_id', 'lr.patient_id', 'lr.observation_code', 'lr.observation_system', 'lr.observation_desc',
        'lr.result_type', 'lr.numeric_value', 'lr.numeric_units', 'lr.numeric_comparator', 'lr.coded_value', 'lr.text_value',
        'lr.abnormal_flag', 'lr.status', 'lr.result_timestamp', 'lr.specimen_id', 'lr.created_at',
        'rq.requester_code', 'rq.requester_system',
      ])
      .where('lr.status', 'in', [...RELEASED_STATUSES]);
    if (scope) qb = qb.where(scopeCondition('result', 'lr', scope, engine) as never);
    return qb;
  }

  type Row = Awaited<ReturnType<ReturnType<typeof base>['execute']>>[number];
  const view = (r: Row): StoredResult => ({
    id: r.id,
    requestId: r.request_id,
    patientId: r.patient_id,
    observation: { code: r.observation_code, system: r.observation_system, display: r.observation_desc },
    value: { type: r.result_type, number: r.numeric_value === null ? null : Number(r.numeric_value), units: r.numeric_units, comparator: r.numeric_comparator, code: r.coded_value, text: r.text_value },
    abnormalFlag: r.abnormal_flag,
    status: r.status ?? '',
    resultTime: iso(r.result_timestamp),
    specimenId: r.specimen_id,
    requester: { code: r.requester_code, system: r.requester_system },
    storedAt: iso(r.created_at)!,
  });

  return {
    async list(q, scope) {
      const limit = Math.max(1, Math.min(RESULTS_PAGE_MAX, Math.floor(q.limit)));
      let qb = base(scope);
      if (q.since !== undefined) qb = qb.where('lr.result_timestamp', '>=', q.since);
      if (q.until !== undefined) qb = qb.where('lr.result_timestamp', '<', q.until);
      if (q.patientId !== undefined) qb = qb.where('lr.patient_id', '=', q.patientId);
      if (q.observation !== undefined) qb = qb.where('lr.observation_code', '=', q.observation);
      if (q.after) {
        const k = decodeResultsKey(q.after);
        if (!k) throw new ResultsKeyError();
        const at = new Date(k.storedAt);
        qb = qb.where((eb) => eb.or([eb('lr.created_at', '>', at), eb.and([eb('lr.created_at', '=', at), eb('lr.id', '>', k.id)])]));
      }
      const rows = await qb.orderBy('lr.created_at').orderBy('lr.id').limit(limit + 1).execute();
      const page = rows.slice(0, limit).map(view);
      const last = page[page.length - 1];
      return { results: page, next: rows.length > limit && last ? encodeResultsKey(last.storedAt, last.id) : null };
    },

    async get(id, scope) {
      const row = await base(scope).where('lr.id', '=', id).executeTakeFirst();
      return row ? view(row) : null;
    },
  };
}

/** `after` is not a key a results list gave. */
export class ResultsKeyError extends Error {
  constructor() { super('after is not a key a results list gave'); }
}
