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

/** What a retry request actually did.
 *
 *  - `requeued` — the row is back in the queue and will run.
 *  - `not-found` — no such job id.
 *  - `running` — the job is mid-flight, so it was NOT re-queued. Re-queueing a running row would
 *    re-arm its `active_key` while the in-flight run is still going; that run's own `finish()` then
 *    clears the key and marks the row terminal, discarding the retry. Callers must surface this
 *    (the HTTP route answers 409, the CLI exits non-zero) rather than report success. */
export type FacilityJobRetryOutcome = 'requeued' | 'not-found' | 'running';

export interface FacilityJobStore {
  /** `coalesced: true` means a request of the same identity was ALREADY queued and this one was
   *  absorbed — not that it failed. `job` is null in that case. */
  enqueue(input: { kind: FacilityJobKind; registryId?: string | null; requestedBy?: string | null }): Promise<{ job: FacilityJob | null; coalesced: boolean }>;
  claimNext(): Promise<FacilityJob | null>;
  finish(id: string, status: 'done' | 'failed', opts: { error?: string | null; resultCount?: number | null }): Promise<void>;
  retry(id: string): Promise<FacilityJobRetryOutcome>;
  retryPreservingAttempts(id: string): Promise<void>;
  failStaleRunning(error: string): Promise<number>;
  latest(kind: FacilityJobKind): Promise<FacilityJob | null>;
  listUnresolved(): Promise<FacilityJob[]>;
  /** Failed jobs of this kind that NOTHING has superseded — see the implementation's doc comment for
   *  exactly what "superseded" means and what it deliberately cannot see. */
  listFailed(kind: FacilityJobKind): Promise<FacilityJob[]>;
}

type Row = {
  id: string; kind: string; status: string; attempts: number; last_error: string | null;
  registry_id: string | null; result_count: number | null; requested_by: string | null;
  requested_at: Date; started_at: Date | null; finished_at: Date | null; active_key: string | null;
};

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

/** The IDENTITY of a job — two requests share an identity exactly when running one of them makes the
 *  other redundant, which is precisely when it is safe to coalesce them.
 *
 *  - `facility-map-rebuild` rebuilds the WHOLE report-facing dimension, so every rebuild request is
 *    interchangeable and the identity is the kind alone. That is what makes a 14 000-row CSV import
 *    enqueue one rebuild rather than 14 000.
 *  - `registry-projection` repairs ONE named facility, so its identity includes that facility. Keying
 *    it on the kind alone would let the first failing facility's repair absorb every other facility's,
 *    leaving them unmapped with nothing recording why.
 *
 *  A `registry-projection` with no `registryId` names no facility to repair; such (malformed) requests
 *  all share the key `registry-projection:` rather than getting a silent per-request identity. */
function activeKeyFor(kind: FacilityJobKind, registryId: string | null): string {
  return kind === 'registry-projection' ? `${kind}:${registryId ?? ''}` : kind;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === '23505' || /unique|duplicate/i.test(e?.message ?? '');
}

function toJob(r: Row): FacilityJob {
  return {
    id: r.id, kind: r.kind as FacilityJobKind, status: r.status as FacilityJobStatus,
    attempts: Number(r.attempts), lastError: r.last_error, registryId: r.registry_id,
    resultCount: r.result_count == null ? null : Number(r.result_count),
    requestedBy: r.requested_by, requestedAt: new Date(r.requested_at).toISOString(),
    startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
  };
}

/** How many queued rows `claimNext` will try before giving up for this tick. Only reached when a
 *  concurrent claimer wins the guarded UPDATE, so a bound this small just means "another worker took
 *  the whole head of the queue in the time it took us to read it" — idling one tick is correct then. */
const CLAIM_CANDIDATES = 10;

export function createFacilityJobStore(db: Kysely<InternalSchema>): FacilityJobStore {
  /** The id of an ACTIVE (queued) job with this identity, if one exists. `excludeId` skips the row
   *  being re-queued, which still carries its own history. */
  const findActiveId = async (activeKey: string, excludeId?: string): Promise<string | undefined> => {
    let q = db.selectFrom('facility_jobs').select('id').where('active_key', '=', activeKey);
    if (excludeId !== undefined) q = q.where('id', '!=', excludeId);
    return (await q.executeTakeFirst())?.id;
  };

  /** Re-queue a finished job, re-arming its `active_key` only when that identity is free.
   *
   *  Re-arming matters: without it a later request would not coalesce onto the re-queued job. But the
   *  design deliberately allows a second job of the same identity to be QUEUED while the first RUNS,
   *  so a run that then fails is re-queued into a state where the key is already held. Setting it
   *  unconditionally raises a 23505 out of the worker's retry loop and out of the operator's Retry
   *  button. We yield the key instead: the row goes back to `queued` and really will run, while the
   *  job already holding the key does the same work — so the retry is honoured either way. */
  const requeue = async (
    job: { id: string; kind: string; registry_id: string | null },
    apply: (activeKey: string | null) => Promise<unknown>,
  ): Promise<void> => {
    const key = activeKeyFor(job.kind as FacilityJobKind, job.registry_id);
    if (await findActiveId(key, job.id)) {
      await apply(null);
      return;
    }
    try {
      await apply(key);
    } catch (err) {
      // Lost a race to a concurrent enqueue between the check and the update: same conclusion.
      if (!isUniqueViolation(err) || !(await findActiveId(key, job.id))) throw err;
      await apply(null);
    }
  };

  return {
    async enqueue(input) {
      // The invariant is "at most one ACTIVE job per identity", and it lives in `active_key`:
      // non-null only while a row is 'queued', cleared by claimNext in the same statement that sets
      // 'running' -- though a queued row may also carry a NULL key after a retry finds its identity
      // still held; see `requeue`. So a request arriving while one is QUEUED is absorbed, while one
      // arriving during a RUNNING build is not — that build may already have read the data. The
      // pre-check below is what enforces this; the unique index on `active_key` (migration 079) is
      // the race backstop.
      //
      // The pre-check is not a stylistic choice: the brief's detection -- inspect
      // `numInsertedOrUpdatedRows` after `.onConflict(...).doNothing()` -- was measured NOT to work
      // here. Against pg-mem a skipped (conflicting) insert still reports
      // `numInsertedOrUpdatedRows: "1"`, and `.returningAll()` on that same skipped insert returns the
      // OTHER (pre-existing) row rather than an empty set. Both would misreport a coalesce as a fresh
      // enqueue. A SELECT is deterministic on both pg-mem and real Postgres.
      const activeKey = activeKeyFor(input.kind, input.registryId ?? null);
      if (await findActiveId(activeKey)) return { job: null, coalesced: true };

      const id = `fj_${randomUUID()}`;
      try {
        await db.insertInto('facility_jobs')
          .values({
            id, kind: input.kind, status: 'queued', attempts: 0,
            registry_id: input.registryId ?? null, requested_by: input.requestedBy ?? null,
            active_key: activeKey,
          })
          .execute();
      } catch (err) {
        // Only an `active_key` collision means "already queued". Reporting `coalesced` for any unique
        // violation would silently DROP the request on, say, a primary-key collision -- the caller
        // would be told the work is pending when nothing is. Re-check before concluding.
        if (isUniqueViolation(err) && (await findActiveId(activeKey))) return { job: null, coalesced: true };
        throw err;
      }
      const row = await db.selectFrom('facility_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return { job: toJob(row), coalesced: false };
    },

    async claimNext() {
      // `requested_at` defaults to now(), which is TRANSACTION time in Postgres -- rows enqueued in one
      // transaction tie. The `id` tiebreaker makes the order total instead of engine-dependent.
      const candidates = await db.selectFrom('facility_jobs').select('id')
        .where('status', '=', 'queued')
        .orderBy('requested_at', 'asc').orderBy('id', 'asc')
        .limit(CLAIM_CANDIDATES).execute();

      // Guarded UPDATE rather than SELECT ... FOR UPDATE SKIP LOCKED: pg-mem cannot do the latter in
      // a correlated subquery, and the `and status = 'queued'` guard is race-safe in real Postgres
      // anyway (a second claimer updates 0 rows instead of double-claiming). Losing that guard means
      // another worker took this row, NOT that the queue is empty -- so advance to the next candidate
      // rather than reporting idle while work is still queued.
      // ⛔ `active_key = null` here, NOT in finish(): that is what lets a change arriving mid-build
      // enqueue a fresh job instead of being swallowed.
      for (const candidate of candidates) {
        const rows = await sql<Row>`
          update facility_jobs
          set status = 'running', started_at = now(), attempts = attempts + 1, active_key = null
          where id = ${candidate.id} and status = 'queued'
          returning *
        `.execute(db);
        const r = rows.rows[0];
        if (r) return toJob(r);
      }
      return null;
    },

    async finish(id, status, opts) {
      await db.updateTable('facility_jobs')
        .set({
          status, last_error: opts.error ?? null,
          result_count: opts.resultCount ?? null,
          finished_at: sql<Date>`now()`,
          // ⛔ `active_key = null` here as well as in `claimNext`, and the two are NOT redundant.
          // claimNext's clear is what creates the asymmetry (a request arriving mid-RUN is not
          // absorbed); this one is what stops a TERMINAL row from holding its identity for good.
          // A row can reach `finish` still holding the key: `retry` re-arms it, and if the in-flight
          // run then completes, the row goes done/failed with the key still set. `enqueue`'s
          // pre-check only asks whether the key exists, so every later request of that identity
          // would coalesce onto a job that will never run again — every facility mutation reporting
          // success while the dimension is never rebuilt. Clearing here is also what
          // `terminology-ingest-job-store.ts` does, for the same reason.
          active_key: null,
        })
        .where('id', '=', id)
        .execute();
    },

    async retry(id) {
      const job = await db.selectFrom('facility_jobs').selectAll().where('id', '=', id).executeTakeFirst();
      if (!job) return 'not-found';
      // ⛔ A RUNNING job is not re-queued, and the caller is TOLD rather than left to assume it was.
      // Re-queueing here re-arms `active_key` under a live run whose own `finish()` then clears it
      // and writes a terminal status — silently throwing the retry away. Refusing is also the honest
      // answer: the work the operator is asking for is already in flight.
      if (job.status === 'running') return 'running';
      // attempts reset to 0 deliberately: this is the OPERATOR's explicit action, and someone who
      // has fixed the underlying cause must not be locked out by a previously exhausted budget.
      await requeue(job, (activeKey) => db.updateTable('facility_jobs')
        .set({ status: 'queued', attempts: 0, last_error: null, started_at: null, finished_at: null, active_key: activeKey })
        .where('id', '=', id)
        .execute());
      return 'requeued';
    },

    async retryPreservingAttempts(id) {
      const job = await db.selectFrom('facility_jobs').selectAll().where('id', '=', id).executeTakeFirst();
      if (!job) return;
      // Same refusal as `retry` above, for the same reason. The worker itself cannot reach this with
      // a running row — `processJob` always `finish`es a job before re-queueing it — so this guard is
      // not covering a live worker path; it keeps the two retry entry points' contract identical so
      // that a future caller cannot re-arm the key under a live run through this one instead.
      if (job.status === 'running') return;
      // The WORKER's automatic retry. Deliberately does NOT touch `attempts` — that counter is what
      // bounds the retry loop, so resetting it here would spin forever on a permanently failing job.
      // The distinction from `retry` above is the whole reason both exist.
      await requeue(job, (activeKey) => db.updateTable('facility_jobs')
        .set({ status: 'queued', started_at: null, finished_at: null, active_key: activeKey })
        .where('id', '=', id)
        .execute());
    },

    async failStaleRunning(error) {
      const res = await db.updateTable('facility_jobs')
        .set({ status: 'failed', last_error: error, finished_at: sql<Date>`now()`, active_key: null })
        .where('status', '=', 'running')
        .executeTakeFirst();
      return Number(res?.numUpdatedRows ?? 0);
    },

    async latest(kind) {
      // `id` tiebreaker for the same reason `claimNext` has one: `requested_at` defaults to
      // TRANSACTION time, so rows enqueued in one transaction tie and the winner would otherwise be
      // engine-dependent. DESC here (claimNext takes the oldest, this takes the newest), so the two
      // agree on which end of a tie they are naming.
      const row = await db.selectFrom('facility_jobs').selectAll()
        .where('kind', '=', kind).orderBy('requested_at', 'desc').orderBy('id', 'desc')
        .limit(1).executeTakeFirst();
      return row ? toJob(row) : null;
    },

    /** Can return MORE THAN ONE row for the same identity -- e.g. one 'running' plus one 'queued'
     *  from the enqueue-during-RUNNING asymmetry, or two 'queued' rows when `retry`/
     *  `retryPreservingAttempts` re-queues under contention and yields the `active_key` (see
     *  `requeue`). This is safe to consume as-is: both kinds are idempotent, the redundant row
     *  genuinely runs, and a caller counting or displaying unresolved work should not assume
     *  at-most-one-per-identity here. */
    async listUnresolved() {
      const rows = await db.selectFrom('facility_jobs').selectAll()
        .where('status', 'in', ['queued', 'running']).orderBy('requested_at', 'asc').execute();
      return rows.map((r) => toJob(r));
    },

    /**
     * Failed jobs of this kind that are still the LAST WORD on their identity — i.e. no job sharing
     * their `activeKeyFor` identity was requested after them.
     *
     * This replaces a bare `count(*) where status = 'failed'`, which counted every failed row that
     * had ever existed: a facility whose projection failed once stayed on the Facilities page's
     * warning forever, even after a LATER projection job for that same facility succeeded.
     * Suppressing a failed row that a strictly newer job of the same identity has overtaken makes the
     * surface self-clearing — a later `done` job clears it, and a repair that is merely queued or
     * running does not nag while it is in flight. It is the same rule the report dimension already
     * uses (`latest(kind)?.status === 'failed'`), applied per identity instead of per kind.
     *
     * ⚠ Supersession is decided on `requested_at` STRICTLY GREATER, with no `id` tiebreak — unlike
     * `claimNext`/`latest`, which do tiebreak. `id` is a random UUID, so on a `requested_at` tie
     * (rows enqueued in one transaction share it) an id comparison would pick a winner at random and
     * could hide a genuine failure. A tie therefore leaves the failed row REPORTED: showing a warning
     * a moment longer than strictly necessary is the safe direction, hiding one is not.
     *
     * ⚠ What it deliberately CANNOT see: an INLINE projection success. Inline projections
     * (`projectRegistryRows` on POST/PUT `/api/facilities/:id`) write no `facility_jobs` row at all
     * when they succeed, so nothing here observes them and a facility repaired that way keeps its
     * failed row until someone retries it explicitly. The operator's clearing path is the Retry
     * action on that job.
     *
     * The scan is bounded by the identities that have actually failed, not by the whole table: the
     * second query only reads rows sharing a `registry_id` with a failed one.
     */
    async listFailed(kind) {
      const failedRows = await db.selectFrom('facility_jobs').selectAll()
        .where('kind', '=', kind).where('status', '=', 'failed').execute();
      if (failedRows.length === 0) return [];

      const registryIds = [...new Set(failedRows.map((r) => r.registry_id))];
      const named = registryIds.filter((v): v is string => v !== null);
      const hasUnnamed = registryIds.includes(null);
      const siblings = await db.selectFrom('facility_jobs').select(['registry_id', 'requested_at'])
        .where('kind', '=', kind)
        .where((eb) => eb.or([
          ...(named.length > 0 ? [eb('registry_id', 'in', named)] : []),
          ...(hasUnnamed ? [eb('registry_id', 'is', null)] : []),
        ]))
        .execute();

      const newestAt = new Map<string, number>();
      for (const row of siblings) {
        const key = activeKeyFor(kind, row.registry_id);
        const t = new Date(row.requested_at).getTime();
        if (t > (newestAt.get(key) ?? -Infinity)) newestAt.set(key, t);
      }

      return failedRows
        .filter((r) => new Date(r.requested_at).getTime() >= (newestAt.get(activeKeyFor(kind, r.registry_id)) ?? -Infinity))
        .map((r) => toJob(r));
    },
  };
}
