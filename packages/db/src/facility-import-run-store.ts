import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';
import {
  ALL_RUN_STATES, RUNNING_RUN_STATES, TERMINAL_RUN_STATES, VALIDATE_PHASE, APPLY_PHASE,
  isWorkerObserved,
  type FacilityImportRunStatus,
} from './facility-import-run-states';

// ⛔ ONE definition of the lifecycle, in `facility-import-run-states.ts`. This used to declare its
// own three-value union, which is what let two route guards be written as `status !== 'previewed'`
// — see that module's header for why widening the union without widening those guards locks a
// register out of every future import.
export type { FacilityImportRunStatus };

export interface FacilityImportRun {
  id: string; nationalSystem: string; sourceFormat: 'csv' | 'jsonl';
  /** Where the uploaded file lives. NULL for an A2a inline preview/apply, which carries the CSV in
   *  the request body and never stores it. */
  blobKey: string | null;
  fileHash: string; byteSize: number;
  releaseVersion: string | null; releasePublishedAt: string | null;
  declaredRowCount: number | null; declaredDeletionCount: number | null;
  status: FacilityImportRunStatus;
  /** Worker progress. `phase` is free text the worker chooses; `processed`/`total` are counts, and
   *  `total` stays null until the worker knows one. */
  phase: string | null; processed: number; total: number | null;
  previewedAt: string | null;
  summary: unknown; options: unknown; error: string | null;
  /** The operator asked for a cancel. By itself this stops NOTHING — the worker observes it. */
  cancelRequested: boolean;
  requestedBy: string | null; createdAt: string;
  startedAt: string | null; finishedAt: string | null;
}

export interface FacilityImportRunStore {
  startPreview(input: {
    nationalSystem: string; sourceFormat: 'csv' | 'jsonl'; fileHash: string; byteSize: number;
    releaseVersion?: string | null; releasePublishedAt?: string | null;
    declaredRowCount?: number | null; declaredDeletionCount?: number | null;
    options: unknown; requestedBy?: string | null;
  }): Promise<FacilityImportRun>;
  /** Stamps `previewed_at` and stores the summary. The timestamp is the DB's `now()`, never the
   *  application clock — apply compares it against `facility_registry.updated_at`, also DB-set. */
  completePreview(id: string, summary: unknown): Promise<FacilityImportRun>;
  /** ⛔ The INLINE path's terminal write, kept exactly as A2a shipped it — the HTTP apply route and
   *  the CLI both call it with this signature. `finish` below is its generalisation (one more
   *  status), and NEITHER delegates to the other: both call the one private `finishRun` in the
   *  implementation, so the two can never drift on what a terminal write must do — in particular on
   *  clearing `active_key`. */
  finishApply(id: string, status: 'applied' | 'failed', opts: { summary?: unknown; error?: string | null }): Promise<void>;

  /** Mint a run for an uploaded file. Sets blob_key and status 'queued'. Throws when another run
   *  holds this national_system; the route supersedes a supersedable one before calling. */
  startUpload(input: {
    nationalSystem: string; sourceFormat: 'csv' | 'jsonl'; blobKey: string;
    fileHash: string; byteSize: number; releaseVersion?: string | null;
    options: unknown; requestedBy?: string | null;
  }): Promise<FacilityImportRun>;
  /** Guarded UPDATE claim, exactly like facility-job-store's: a second claimer updates 0 rows.
   *
   *  ⛔ The source type is exactly the two phase heads — `awaiting_confirmation` is deliberately NOT
   *  assignable. A worker claiming the state a run PARKS in would apply a register the operator has
   *  not decided about, so the restriction is a compile error rather than a convention. */
  claimNext(status: typeof VALIDATE_PHASE.from | typeof APPLY_PHASE.from, to: 'validating' | 'applying'): Promise<FacilityImportRun | null>;
  updateProgress(id: string, p: { phase: string; processed?: number | null; total?: number | null }): Promise<void>;
  /** The validate phase's commit point: stamp the watermark and the summary AND park the run for the
   *  operator, in ONE guarded UPDATE.
   *
   *  ⛔ NOT `completePreview` + a separate status write. `completePreview` is the INLINE path's, where
   *  the run must STAY `previewed`; and splitting the two here would leave a window in which a run is
   *  stamped but unparked. `false` means the run was no longer `validating` — another process's boot
   *  sweep (`failStaleRunning`) had already failed it and RELEASED its `active_key`, and moving it to
   *  `awaiting_confirmation` anyway would leave a confirmable run owning no register, which the apply
   *  phase would then claim while a second upload holds the same one.
   *
   *  ⚠ `active_key` is deliberately KEPT: the operator has not decided yet, and until they do this
   *  run still owns the register. It is released by the terminal write that ends the run. */
  completeValidation(id: string, summary: unknown): Promise<boolean>;
  /** The operator's decision: record the options they chose and hand the run to the APPLY queue, in
   *  ONE guarded UPDATE.
   *
   *  ⛔ It writes `APPLY_PHASE.from`, never a literal, and that state is what authorises the write —
   *  `claimNext` selects on status alone, so this transition is the only thing standing between a
   *  parked run and a national register being rewritten. Nothing else in the codebase writes it.
   *
   *  ⛔ COMPARE-AND-SWAP on the status the caller observed, for exactly the reason `supersede` below
   *  documents: the route READ the run in an earlier statement, and between that read and this write
   *  a newer upload's supersede can fail it and release its `active_key`. `false` means that
   *  happened — the caller must NOT report the run as queued for apply.
   *
   *  ⚠ `active_key` is deliberately KEPT: the apply has not run, and until it does this run still
   *  owns the register. The terminal write that ends the apply releases it. */
  confirm(id: string, expectedStatus: FacilityImportRunStatus, options: unknown): Promise<boolean>;
  /** Ask for a run to stop.
   *
   *  `'requested'` — the flag is set and a worker will observe it at its next phase boundary. This is
   *  the only honest answer for a run a worker holds: the flag cannot interrupt a running
   *  transaction, so the run may still finish `applied`.
   *
   *  `'cancelled'` — the run was in a state NO worker will ever claim (see `isWorkerObserved`), so
   *  the cancel was CARRIED OUT here instead of recorded: the run is terminal and its register is
   *  free. Reporting `'requested'` for that case (as this used to) promised an observer that does not
   *  exist and left the run holding `active_key` with an inert flag. */
  requestCancel(id: string): Promise<'requested' | 'cancelled' | 'not-found' | 'already-terminal'>;
  finish(id: string, status: 'applied' | 'failed' | 'cancelled', opts: { summary?: unknown; error?: string | null }): Promise<void>;
  /** Fail a run ONLY while it is still in the status the caller observed, releasing its `active_key`.
   *  `false` means the run moved on between the caller's read and this write — the caller must NOT
   *  proceed as though it had superseded anything.
   *
   *  ⛔ Separate from `finish` rather than a precondition parameter on it, for two reasons. (1) The
   *  worker's `finish` is unconditional BY RIGHT — it owns the run it claimed — so an optional guard
   *  argument there would be one every worker call site is free to forget, which is precisely the
   *  "narrow guard, wider condition" shape this method exists to remove. (2) The answer has to be
   *  reported: `finish` returns `void`, and widening its return type would silently change the
   *  contract for the inline route and the CLI, which the brief forbids. */
  supersede(id: string, expectedStatus: FacilityImportRunStatus, error: string): Promise<boolean>;
  /** Crash recovery: fail every run left in a RUNNING state, releasing its `active_key`. Returns how
   *  many.
   *
   *  ⛔ `minAgeMs` IS WHAT STOPS THIS SWEEPING A LIVE RUN OUT FROM UNDER ANOTHER PROCESS. A run is
   *  RUNNING for exactly as long as some worker is inside `importFacilities` for it, and this
   *  statement is not scoped to any one process — so without an age bound, ANY process that runs this
   *  nulls the `active_key` of an apply another process is mid-write on, and a second upload can then
   *  mint a run and start a second apply over the same national register. The bound is expressed
   *  against `started_at`, which `claimNext` stamps in the same UPDATE that writes the RUNNING status
   *  (nothing else in this module writes either), so "how long has this run been RUNNING" is exactly
   *  what it measures.
   *
   *  ⚠ `started_at IS NULL` is swept regardless of `minAgeMs`. `claimNext` is the only writer of a
   *  RUNNING status and it always stamps the timestamp, so a RUNNING row without one did not come
   *  from this store and its age cannot be established — and a run whose age is unknown is exactly
   *  the one nothing else will ever release.
   *
   *  ⚠ DEFAULTS TO 0 — "sweep every RUNNING run" — because the lease is a POLICY the sweeping worker
   *  owns (see `FACILITY_IMPORT_STALE_LEASE_MS` in @openldr/bootstrap's facility-import-worker.ts),
   *  not a property of this statement. The default preserves the behaviour of a caller that names no
   *  lease; it is not a safe value for a caller that shares this table with a live worker. */
  failStaleRunning(error: string, minAgeMs?: number): Promise<number>;

  get(id: string): Promise<FacilityImportRun | null>;
  list(nationalSystem?: string, limit?: number): Promise<FacilityImportRun[]>;
}

// ⛔ `timestamptz` columns come back as `Date` from node-postgres even where a sibling schema type
// declares `string` (FacilityRegistryTable does exactly that). `new Date(x)` accepts both, so this
// is the only safe normalisation — the same idiom `facility-job-store.ts` uses on every read.
const iso = (d: unknown): string | null => (d == null ? null : new Date(d as string | Date).toISOString());

function toRun(r: Record<string, unknown>): FacilityImportRun {
  return {
    id: r.id as string,
    nationalSystem: r.national_system as string,
    sourceFormat: r.source_format as 'csv' | 'jsonl',
    blobKey: (r.blob_key as string | null) ?? null,
    fileHash: r.file_hash as string,
    byteSize: Number(r.byte_size),
    releaseVersion: (r.release_version as string | null) ?? null,
    releasePublishedAt: iso(r.release_published_at),
    declaredRowCount: r.declared_row_count == null ? null : Number(r.declared_row_count),
    declaredDeletionCount: r.declared_deletion_count == null ? null : Number(r.declared_deletion_count),
    status: r.status as FacilityImportRunStatus,
    phase: (r.phase as string | null) ?? null,
    // `processed` is `notNull default 0` (migration 080), so a row always has a number here.
    processed: Number(r.processed ?? 0),
    total: r.total == null ? null : Number(r.total),
    previewedAt: iso(r.previewed_at),
    summary: r.summary ?? null,
    options: r.options ?? {},
    error: (r.error as string | null) ?? null,
    cancelRequested: r.cancel_requested === true,
    requestedBy: (r.requested_by as string | null) ?? null,
    createdAt: iso(r.created_at) as string,
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
  };
}

/** How many queued rows `claimNext` will try before giving up for this tick — the same bound and the
 *  same reasoning as `facility-job-store.ts`'s: it is only reached when a concurrent claimer wins the
 *  guarded UPDATE, so exhausting it means another worker took the head of the queue while we read it,
 *  and idling one tick is the right answer. */
const CLAIM_CANDIDATES = 10;

/** Every state that is not terminal, derived rather than re-spelled — `requestCancel`'s guard needs
 *  the complement of `TERMINAL_RUN_STATES`, and writing it out is how the literal lists this module's
 *  sibling exists to delete would creep back in. */
const NON_TERMINAL_RUN_STATES = ALL_RUN_STATES.filter((s) => !TERMINAL_RUN_STATES.has(s));

export function createFacilityImportRunStore(db: Kysely<InternalSchema>): FacilityImportRunStore {
  const byId = async (id: string) =>
    db.selectFrom('facility_import_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  /** Explicit pre-check so a concurrent second import fails with a readable message; the unique index
   *  on `active_key` (migration 080) is the race-safe backstop. Same two-layer shape as
   *  `terminology-ingest-job-store.ts`'s `hasActive` + index.
   *
   *  Deliberately asks whether ANY row holds the key, not whether a RUNNING one does: the key is held
   *  for a run's whole life and released only by a terminal write, so "held" already means "some run
   *  owns this register". A caller that wants to take a SUPERSEDABLE run over calls `supersede`
   *  first, which releases the key — see the import route's gate. */
  const assertRegisterFree = async (nationalSystem: string): Promise<void> => {
    const active = await db.selectFrom('facility_import_runs').select('id')
      .where('active_key', '=', nationalSystem).executeTakeFirst();
    if (active) throw new Error(`an import is already in progress for "${nationalSystem}"`);
  };

  /** The one terminal write. `finishApply` and `finish` are both this, so the rule that a terminal run
   *  must not keep `active_key` cannot be met by one and missed by the other. */
  const finishRun = async (
    id: string,
    status: 'applied' | 'failed' | 'cancelled',
    opts: { summary?: unknown; error?: string | null },
  ): Promise<void> => {
    await db.updateTable('facility_import_runs')
      .set({
        status,
        error: opts.error ?? null,
        finished_at: sql`now()` as never,
        ...(opts.summary === undefined ? {} : { summary: JSON.stringify(opts.summary) as never }),
        // Clearing the key is what stops a terminal row holding its national system for good.
        // ⛔ It applies to EVERY terminal status, `cancelled` included: `TERMINAL_RUN_STATES` states
        // that rule and enforces none of it, so this line is the only thing that keeps it true.
        active_key: null,
      } as never)
      .where('id', '=', id).execute();
  };

  return {
    async startPreview(input) {
      await assertRegisterFree(input.nationalSystem);

      const id = `fir_${randomUUID()}`;
      await db.insertInto('facility_import_runs').values({
        id,
        national_system: input.nationalSystem,
        source_format: input.sourceFormat,
        file_hash: input.fileHash,
        byte_size: input.byteSize,
        release_version: input.releaseVersion ?? null,
        release_published_at: (input.releasePublishedAt ? new Date(input.releasePublishedAt) : null) as never,
        declared_row_count: input.declaredRowCount ?? null,
        declared_deletion_count: input.declaredDeletionCount ?? null,
        status: 'previewed',
        options: JSON.stringify(input.options) as never,
        requested_by: input.requestedBy ?? null,
        active_key: input.nationalSystem,
      } as never).execute();
      return toRun(await byId(id) as never);
    },

    async completePreview(id, summary) {
      // ⛔ `now()` — the DATABASE clock, deliberately, not the application's. This timestamp is
      // compared against `facility_registry.updated_at`, which is also written by `now()`. Mixing an
      // application clock in would make the comparison depend on host clock skew, and skew in one
      // direction silently hides real conflicts.
      await db.updateTable('facility_import_runs')
        .set({ previewed_at: sql`now()` as never, summary: JSON.stringify(summary) as never })
        .where('id', '=', id).execute();
      return toRun(await byId(id) as never);
    },

    async completeValidation(id, summary) {
      // ⛔ `now()` — the DATABASE clock, for the same reason `completePreview` above documents: this
      // watermark is compared against `facility_registry.updated_at`, which `now()` also writes.
      //
      // ⛔ COMPARE-AND-SWAP on `validating`, not an unconditional write on the id. The worker owns
      // the run it claimed, but another process's boot sweep (`failStaleRunning`) can fail it — and
      // release its `active_key` — while this one is mid-validate. Parking it anyway would produce a
      // confirmable run that owns no register.
      //
      // ⛔ `VALIDATE_PHASE.to`, NEVER the literal. The worker in `@openldr/bootstrap` claims with
      // `claimNext(VALIDATE_PHASE.from, VALIDATE_PHASE.to)`, and the state this guard names is the
      // state that claim moved the run INTO. Spelled separately in the two packages they can drift,
      // and the drift is silent: this matches 0 rows, returns `false`, and the worker reports a
      // take-over that never happened. See `VALIDATE_PHASE`'s note in `facility-import-run-states.ts`.
      const res = await db.updateTable('facility_import_runs')
        .set({
          status: 'awaiting_confirmation',
          previewed_at: sql`now()` as never,
          summary: JSON.stringify(summary) as never,
        } as never)
        .where('id', '=', id)
        .where('status', '=', VALIDATE_PHASE.to)
        .executeTakeFirst();
      return Number(res?.numUpdatedRows ?? 0) > 0;
    },

    async confirm(id, expectedStatus, options) {
      // ⛔ `APPLY_PHASE.from`, NEVER the literal. The worker in `@openldr/bootstrap` claims with
      // `claimNext(APPLY_PHASE.from, APPLY_PHASE.to)`; spelled separately in the two packages the
      // two can drift, and the drift is silent — this route would answer 202 while no worker ever
      // claimed the run, which would then hold its register until a sweep or a supersede freed it.
      //
      // ⛔ `previewed_at` is deliberately NOT re-stamped. It is the watermark the VALIDATE took, and
      // the apply's conflict detection is only meaningful against the moment the operator's summary
      // was computed — moving it forward to the confirm would silently hide every edit made while
      // they were reading it.
      const res = await db.updateTable('facility_import_runs')
        .set({ status: APPLY_PHASE.from, options: JSON.stringify(options) as never } as never)
        .where('id', '=', id)
        .where('status', '=', expectedStatus)
        .executeTakeFirst();
      return Number(res?.numUpdatedRows ?? 0) > 0;
    },

    async finishApply(id, status, opts) {
      await finishRun(id, status, opts);
    },

    async finish(id, status, opts) {
      await finishRun(id, status, opts);
    },

    async startUpload(input) {
      await assertRegisterFree(input.nationalSystem);

      const id = `fir_${randomUUID()}`;
      await db.insertInto('facility_import_runs').values({
        id,
        national_system: input.nationalSystem,
        source_format: input.sourceFormat,
        blob_key: input.blobKey,
        file_hash: input.fileHash,
        byte_size: input.byteSize,
        release_version: input.releaseVersion ?? null,
        // ⛔ No `declared_row_count`/`declared_deletion_count` and no `release_published_at` here:
        // unlike `startPreview`, nothing has READ the file yet, so the only honest value is the
        // column default (null). The worker fills them in once it has parsed the release header.
        status: 'queued',
        options: JSON.stringify(input.options) as never,
        requested_by: input.requestedBy ?? null,
        active_key: input.nationalSystem,
      } as never).execute();
      return toRun(await byId(id) as never);
    },

    async claimNext(status, to) {
      // `created_at` defaults to now(), which is TRANSACTION time in Postgres — rows created in one
      // transaction tie. The `id` tiebreaker makes the order total instead of engine-dependent.
      const candidates = await db.selectFrom('facility_import_runs').select('id')
        .where('status', '=', status)
        .orderBy('created_at', 'asc').orderBy('id', 'asc')
        .limit(CLAIM_CANDIDATES).execute();

      // Guarded UPDATE rather than SELECT ... FOR UPDATE SKIP LOCKED, for the reason
      // `facility-job-store.claimNext` documents: pg-mem cannot do the latter in a correlated
      // subquery, and `and status = <observed>` is race-safe on real Postgres anyway — a second
      // claimer updates 0 rows instead of double-claiming. Losing the guard means another worker took
      // THIS row, NOT that the queue is empty, so advance to the next candidate rather than report idle.
      //
      // ⛔ `active_key` is deliberately LEFT SET here, which is the one place this diverges from
      // `facility-job-store.claimNext` (which nulls it in this same statement). There the key means
      // "a request of this identity is queued", and clearing it on claim is what lets a change
      // arriving mid-build enqueue a fresh job. Here it means "this run owns this register", and a
      // RUNNING run is exactly when a second upload must be refused — clearing it would let one
      // arrive and race the live worker.
      for (const candidate of candidates) {
        const rows = await sql<Record<string, unknown>>`
          update facility_import_runs
          set status = ${to}, started_at = now()
          where id = ${candidate.id} and status = ${status}
          returning *
        `.execute(db);
        const r = rows.rows[0];
        if (r) return toRun(r);
      }
      return null;
    },

    async updateProgress(id, p) {
      // ⛔ `processed`/`total` are written ONLY when a value was supplied. A progress tick that
      // reports a phase and no counts must not zero the counts the last tick published.
      // `null` is treated as "not reported", the same as omitted: `processed` is `notNull` in
      // migration 080 so it has no null to write, and `total` follows the same rule so a caller does
      // not have to remember which of the two columns is nullable.
      await db.updateTable('facility_import_runs')
        .set({
          phase: p.phase,
          ...(p.processed == null ? {} : { processed: p.processed }),
          ...(p.total == null ? {} : { total: p.total }),
        } as never)
        .where('id', '=', id).execute();
    },

    async requestCancel(id) {
      const run = await db.selectFrom('facility_import_runs').select('status')
        .where('id', '=', id).executeTakeFirst();
      if (!run) return 'not-found';
      const observed = run.status as FacilityImportRunStatus;
      if (TERMINAL_RUN_STATES.has(observed)) return 'already-terminal';

      // ⛔ A cancel nobody will ever READ is carried out here instead of merely recorded. See
      // `isWorkerObserved`: `previewed` (the inline A2a path's state) is neither terminal nor one any
      // `claimNext` names, so flagging it set a bit no worker would ever look at while the run went
      // on holding `active_key` — and the operator was told 'requested', as though something live had
      // been asked to stop.
      //
      // Its own guarded terminal write rather than `finishRun`, for the reason `supersede` below
      // documents and is otherwise shaped exactly like: the status was read in an EARLIER statement,
      // and an unconditional write keyed on the id alone could terminate a run that moved on in
      // between. 0 rows means it did — fall through to the flag path, which re-answers from whatever
      // the row says now (`already-terminal` if it finished; the flag if it somehow became live).
      if (!isWorkerObserved(observed)) {
        const cancelled = await db.updateTable('facility_import_runs')
          .set({
            status: 'cancelled', error: 'cancelled by the operator', finished_at: sql`now()` as never,
            // Same rule as every other terminal writer here: a terminal run must not keep the key.
            active_key: null,
          } as never)
          .where('id', '=', id)
          .where('status', '=', observed)
          .executeTakeFirst();
        if (Number(cancelled?.numUpdatedRows ?? 0) > 0) return 'cancelled';
      }

      // Guarded on the status too, not just the id: the run can finish between the read above and
      // this write, and flagging a finished run would leave `cancel_requested` set on a terminal row
      // that nothing will ever observe — reported to the operator as though a live run had been
      // asked to stop. 0 rows means exactly that happened.
      const res = await db.updateTable('facility_import_runs')
        .set({ cancel_requested: true })
        .where('id', '=', id)
        .where('status', 'in', NON_TERMINAL_RUN_STATES)
        .executeTakeFirst();
      return Number(res?.numUpdatedRows ?? 0) > 0 ? 'requested' : 'already-terminal';
    },

    async supersede(id, expectedStatus, error) {
      // Compare-and-swap, NOT an unconditional write keyed on the id alone. The caller (the import
      // route's supersede gate) READ this run's status in an earlier statement, and between that read
      // and this write a worker can claim the run — `queued` is both supersedable and claimable. An
      // unconditional write would then mark a LIVE run failed and null the `active_key` out from
      // under it, letting a third request start against a register a worker is still writing.
      const res = await db.updateTable('facility_import_runs')
        .set({
          status: 'failed', error, finished_at: sql`now()` as never,
          active_key: null,
        } as never)
        .where('id', '=', id)
        .where('status', '=', expectedStatus)
        .executeTakeFirst();
      return Number(res?.numUpdatedRows ?? 0) > 0;
    },

    async failStaleRunning(error, minAgeMs = 0) {
      // ⛔ `sql.raw` and NOT a bound parameter, because `interval` takes a typed LITERAL in Postgres
      // (`interval $1` does not parse). The value interpolated is the result of `Math.floor` over a
      // number, so it is a run of digits and nothing else can reach the statement.
      const ms = Math.max(0, Math.floor(minAgeMs));
      const olderThanLease = sql.raw(`interval '${ms} milliseconds'`);
      // ⛔ Expressed against `RUNNING_RUN_STATES`, never a hand-written list of literals: a state
      // added to the RUNNING half of the partition must be recovered by this sweep automatically, or
      // a crash leaves runs in it holding their registers with nothing to release them.
      //
      // ⛔ AND age-scoped — see this method's contract. `now()` is the DATABASE clock on both sides
      // of the comparison (`started_at` is written by `claimNext`'s `now()`), so the lease does not
      // depend on the host clock of whichever process happens to run the sweep.
      const res = await db.updateTable('facility_import_runs')
        .set({ status: 'failed', error, finished_at: sql`now()` as never, active_key: null } as never)
        .where('status', 'in', [...RUNNING_RUN_STATES])
        .where((eb) => eb.or([
          eb('started_at', 'is', null),
          eb('started_at', '<=', sql`now() - ${olderThanLease}` as never),
        ]))
        .executeTakeFirst();
      return Number(res?.numUpdatedRows ?? 0);
    },

    async get(id) {
      const r = await db.selectFrom('facility_import_runs').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? toRun(r as never) : null;
    },

    async list(nationalSystem, limit = 50) {
      let q = db.selectFrom('facility_import_runs').selectAll();
      if (nationalSystem) q = q.where('national_system', '=', nationalSystem);
      // ⛔ `id` tiebreaker is REQUIRED, not cosmetic: `created_at` defaults to now(), which is
      // TRANSACTION time in Postgres, so rows created in one transaction tie and the winner would
      // otherwise be engine-dependent. pg-mem's scan order is stable and will never show this.
      return (await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).execute())
        .map((r) => toRun(r as never));
    },
  };
}
