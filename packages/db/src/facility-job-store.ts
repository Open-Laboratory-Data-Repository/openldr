import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type FacilityJobKind = 'facility-map-rebuild' | 'registry-projection';
export type FacilityJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface FacilityJob {
  id: string; kind: FacilityJobKind; status: FacilityJobStatus; attempts: number;
  lastError: string | null; registryId: string | null; resultCount: number | null;
  requestedBy: string | null; requestedAt: string;
  startedAt: string | null; finishedAt: string | null;
}

export interface FacilityJobStore {
  /** `coalesced: true` means an identical request was ALREADY queued and this one was absorbed —
   *  not that it failed. `job` is null in that case. */
  enqueue(input: { kind: FacilityJobKind; registryId?: string | null; requestedBy?: string | null }): Promise<{ job: FacilityJob | null; coalesced: boolean }>;
  claimNext(): Promise<FacilityJob | null>;
  finish(id: string, status: 'done' | 'failed', opts: { error?: string | null; resultCount?: number | null }): Promise<void>;
  retry(id: string): Promise<void>;
  retryPreservingAttempts(id: string): Promise<void>;
  failStaleRunning(error: string): Promise<number>;
  latest(kind: FacilityJobKind): Promise<FacilityJob | null>;
  listUnresolved(): Promise<FacilityJob[]>;
  countFailed(kind: FacilityJobKind): Promise<number>;
}

type Row = {
  id: string; kind: string; status: string; attempts: number; last_error: string | null;
  registry_id: string | null; result_count: number | null; requested_by: string | null;
  requested_at: Date; started_at: Date | null; finished_at: Date | null; active_key: string | null;
};

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

function toJob(r: Row): FacilityJob {
  return {
    id: r.id, kind: r.kind as FacilityJobKind, status: r.status as FacilityJobStatus,
    attempts: Number(r.attempts), lastError: r.last_error, registryId: r.registry_id,
    resultCount: r.result_count == null ? null : Number(r.result_count),
    requestedBy: r.requested_by, requestedAt: new Date(r.requested_at).toISOString(),
    startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
  };
}

export function createFacilityJobStore(db: Kysely<InternalSchema>): FacilityJobStore {
  return {
    async enqueue(input) {
      // The unique index on `active_key` (migration 079) IS the coalescing mechanism: a row is only
      // "active" while queued, so a second insert with the same active_key collides with a pending
      // request (absorbed) but never with a RUNNING one (whose active_key claimNext already cleared).
      //
      // Detection: the brief's approach -- inspect `numInsertedOrUpdatedRows` after
      // `.onConflict(...).doNothing()` -- was verified NOT to work here. Measured against pg-mem, a
      // skipped (conflicting) insert still reports `numInsertedOrUpdatedRows: "1"`, and a
      // `.returningAll()` on the same skipped insert returns the OTHER (pre-existing) row rather than
      // an empty set -- pg-mem does not model DO NOTHING's "no row returned on conflict" semantics.
      // Both would misreport a coalesce as a fresh enqueue.
      //
      // Instead we pre-check for an existing active row (deterministic on both pg-mem and Postgres),
      // and keep the unique index only as a race backstop for real concurrent Postgres callers -- a
      // window this single-threaded test suite never exercises.
      const existing = await db.selectFrom('facility_jobs').select('id')
        .where('active_key', '=', input.kind).executeTakeFirst();
      if (existing) return { job: null, coalesced: true };

      const id = `fj_${randomUUID().slice(0, 8)}`;
      try {
        await db.insertInto('facility_jobs')
          .values({
            id, kind: input.kind, status: 'queued', attempts: 0,
            registry_id: input.registryId ?? null, requested_by: input.requestedBy ?? null,
            active_key: input.kind,
          } as never)
          .execute();
      } catch (err) {
        const e = err as { code?: string; message?: string };
        const isUnique = e.code === '23505' || /unique|duplicate/i.test(e.message ?? '');
        if (isUnique) return { job: null, coalesced: true };
        throw err;
      }
      const row = await db.selectFrom('facility_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return { job: toJob(row as never), coalesced: false };
    },

    async claimNext() {
      const next = await db.selectFrom('facility_jobs').select('id')
        .where('status', '=', 'queued').orderBy('requested_at', 'asc').limit(1).executeTakeFirst();
      if (!next) return null;
      // Guarded UPDATE rather than SELECT ... FOR UPDATE SKIP LOCKED: pg-mem cannot do the latter in
      // a correlated subquery, and the `and status = 'queued'` guard is race-safe in real Postgres
      // anyway (a second claimer updates 0 rows instead of double-claiming).
      // ⛔ `active_key = null` here, NOT in finish(): that is what lets a change arriving mid-build
      // enqueue a fresh job instead of being swallowed.
      const rows = await sql<Row>`
        update facility_jobs
        set status = 'running', started_at = now(), attempts = attempts + 1, active_key = null
        where id = ${next.id} and status = 'queued'
        returning *
      `.execute(db);
      const r = rows.rows[0];
      return r ? toJob(r) : null;
    },

    async finish(id, status, opts) {
      await db.updateTable('facility_jobs')
        .set({
          status, last_error: opts.error ?? null,
          result_count: opts.resultCount ?? null,
          finished_at: sql`now()` as never,
        })
        .where('id', '=', id)
        .execute();
    },

    async retry(id) {
      const job = await db.selectFrom('facility_jobs').selectAll().where('id', '=', id).executeTakeFirst();
      if (!job) return;
      // attempts reset to 0 deliberately: this is the OPERATOR's explicit action, and someone who
      // has fixed the underlying cause must not be locked out by a previously exhausted budget.
      await db.updateTable('facility_jobs')
        .set({ status: 'queued', attempts: 0, last_error: null, started_at: null, finished_at: null, active_key: job.kind })
        .where('id', '=', id)
        .execute();
    },

    async retryPreservingAttempts(id) {
      const job = await db.selectFrom('facility_jobs').selectAll().where('id', '=', id).executeTakeFirst();
      if (!job) return;
      // The WORKER's automatic retry. Deliberately does NOT touch `attempts` — that counter is what
      // bounds the retry loop, so resetting it here would spin forever on a permanently failing job.
      // The distinction from `retry` above is the whole reason both exist.
      await db.updateTable('facility_jobs')
        .set({ status: 'queued', started_at: null, finished_at: null, active_key: job.kind })
        .where('id', '=', id)
        .execute();
    },

    async failStaleRunning(error) {
      const res = await db.updateTable('facility_jobs')
        .set({ status: 'failed', last_error: error, finished_at: sql`now()` as never, active_key: null })
        .where('status', '=', 'running')
        .executeTakeFirst();
      return Number(res?.numUpdatedRows ?? 0);
    },

    async latest(kind) {
      const row = await db.selectFrom('facility_jobs').selectAll()
        .where('kind', '=', kind).orderBy('requested_at', 'desc').limit(1).executeTakeFirst();
      return row ? toJob(row as never) : null;
    },

    async listUnresolved() {
      const rows = await db.selectFrom('facility_jobs').selectAll()
        .where('status', 'in', ['queued', 'running']).orderBy('requested_at', 'asc').execute();
      return rows.map((r) => toJob(r as never));
    },

    async countFailed(kind) {
      const rows = await db.selectFrom('facility_jobs').select('id')
        .where('kind', '=', kind).where('status', '=', 'failed').execute();
      return rows.length;
    },
  };
}
