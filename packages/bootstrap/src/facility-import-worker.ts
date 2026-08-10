import { constants as bufferConstants } from 'node:buffer';
import { redact } from '@openldr/core';
import type { AuditStore } from '@openldr/audit';
import type { BlobStoragePort } from '@openldr/ports';
import {
  VALIDATE_PHASE, APPLY_PHASE, type FacilityImportRun, type FacilityImportRunStore,
} from '@openldr/db';
import {
  importFacilities,
  type FacilityImportDeps, type FacilityImportOptions, type FacilityImportResult,
} from './facility-import';

export interface FacilityImportWorkerDeps {
  runs: FacilityImportRunStore;
  blob: Pick<BlobStoragePort, 'getStream' | 'delete'>;
  /** Exactly the deps the INLINE route builds for `importFacilities` (`db`/`capture`/`admin`/
   *  `facilityJobs`/`logger` — see apps/server/src/facilities-routes.ts). Passed straight through:
   *  this worker adds no import behaviour of its own. */
  importDeps: FacilityImportDeps;
  /** Where an APPLIED import records its `facility.import` audit entry — the same action the inline
   *  route and the CLI write, because it is the same event: a national register was rewritten.
   *
   *  Optional so a caller that has no audit store (the worker's own unit tests aside, none in this
   *  repo) still works, mirroring `FacilityImportDeps`' optional `admin`/`facilityJobs`. When it is
   *  omitted the apply still happens and the omission is logged — an unaudited write is a gap worth
   *  seeing, never a reason to refuse the operator's confirmed import. */
  audit?: Pick<AuditStore, 'record'>;
  /** Poll interval, mirroring `createFacilityJobWorker`/`createTerminologyIngestWorker`. */
  intervalMs?: number;
  /** Ceiling on the file this worker will hold in memory — see `readBlob`. Wire it to
   *  `FACILITY_IMPORT_MAX_UPLOAD_BYTES` so the transfer ceiling and the buffer ceiling are the SAME
   *  number and an accepted upload is always one this worker can actually read. */
  maxBufferBytes?: number;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}

export interface FacilityImportWorker {
  tickOnce(): Promise<void>;
  stop(): Promise<void>;
}

/** What a cancelled run records as its `error` — the reason it ended, not a failure. */
const CANCELLED_BY_OPERATOR = 'cancelled by the operator';

/**
 * A2b Tasks 4 and 5: the background half of the facility import — validate, then apply.
 *
 * `POST /api/facilities/import/upload` streams a national register into blob storage and mints a
 * `queued` run for it (nothing is parsed there). This worker claims that run, reads the file back,
 * and reports what is in it — then parks the run at `awaiting_confirmation` for the operator.
 *
 * ⛔ AND THERE IT STOPS. The apply is a SECOND claim, and its source state is `APPLY_PHASE.from`
 * (`confirmed`) — a state only `POST /api/facilities/import/runs/:id/confirm` ever writes. This
 * worker never claims `awaiting_confirmation`, which is precisely what makes an unconfirmed run
 * unwritable: `claimNext` selects on status alone, so if the apply claimed the parked state it would
 * rewrite a national register the instant a validate finished, with no operator decision in the
 * path at all. The two phases are otherwise the same shape — read the blob, call `importFacilities`,
 * write the outcome onto the run.
 *
 * ⛔ IT CALLS `importFacilities`, THE SAME FUNCTION THE INLINE ROUTE CALLS, and reimplements no part
 * of it: parsing, classification, validation, controlled-field mapping and retirement all live there
 * and are reached with the same `deps` shape the route passes. That shared call is the only reason
 * the two entry paths cannot drift on what a file MEANS — an upload and a paste of the same register
 * must not report different things.
 *
 * ⚠ The file is read into a STRING, because that is what `importFacilities` takes. The upload route
 * streams precisely to avoid holding a national register in memory, and this undoes that at the far
 * end — buffering here is the deliberate price of not forking the importer into a streaming twin
 * that could disagree with it. What makes that price bounded is `readBlob`'s ceiling; see its
 * comment for the two limits involved and why they are not the same number as the inline route's.
 *
 * ⛔ NO ATTEMPT BUDGET, unlike `createFacilityJobWorker`. That worker re-queues a failed job because
 * `facility_jobs` carries `attempts` and the store has `retryPreservingAttempts`; `facility_import_runs`
 * has neither column nor method (migration 080), and a failed run has already RELEASED its register
 * by definition — re-queueing one would need it to take the register back, which nothing supports. A
 * `maxAttempts` knob here would therefore be a setting that does nothing, so there isn't one: a failed
 * validation stays failed, visible with its message, and the operator uploads again.
 */
/** Fallback ceiling when no `maxBufferBytes` is wired, and the default of the config key that
 *  SHOULD be wired (`FACILITY_IMPORT_MAX_UPLOAD_BYTES`) — the two are deliberately the same number.
 *  64 MiB against a measured workload: the 13 000-row Tanzanian MFL release is ~3.1 MB as JSONL and
 *  ~1 MB as CSV, so this clears a national register by a factor of ~20 and still bounds the heap of
 *  the API process this worker runs inside. */
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** Below this many rows an apply publishes its PHASE only; at or above it the run also carries a
 *  row count an operator can watch against.
 *
 *  ⛔ MEASURED, NOT CHOSEN. Real Postgres 16 in Docker on the dev machine (Windows 11, loopback,
 *  2026-08-10), the real 13 000-row Tanzanian MFL release
 *  (`../corlix/fixtures/mfl-TZ-2026-Q3-large.jsonl`) sliced to each row count, `apply: true` against
 *  an empty registry — the cold create, which is the expensive case — with `admin` wired so
 *  controlled-field resolution AND the registry→concept projection both run, exactly as the worker
 *  passes them. Three runs each, median reported:
 *
 *  | rows   | runs (ms)          | median |
 *  |--------|--------------------|--------|
 *  |  1 000 | 289, 292, 280      |  289ms |
 *  |  2 500 | 517, 508, 513      |  513ms |
 *  |  5 000 | 944, 892, 969      |  944ms |
 *  | 10 000 | 1708, 1759, 1745   | 1745ms |
 *  | 13 000 | 2188, 2287, 2404   | 2287ms |
 *
 *  Near-linear at ~0.176 ms/row, which puts one second of work at ≈5 300 rows — so 5 000 is the
 *  measured point closest to the threshold the spec asks for (944 ms, within 6% of 1 s), and the
 *  next point down is genuinely too fast to read (2 500 rows = 0.5 s). A whole national register
 *  (13 000 rows) is ~2.3 s, which is why this is a floor and not a formality.
 *
 *  ⚠ CAVEATS, because a threshold measured on one machine is not a law. Loopback Postgres, no TLS,
 *  no concurrent load, warm page cache, and a single-tenant server. A remote or busy database is
 *  slower — so real deployments cross one second at FEWER rows than this, and the constant errs
 *  toward silence rather than toward noise.
 *
 *  ⚠ WHAT THIS GATE CAN AND CANNOT DO. `importFacilities` exposes no per-row callback — it batches
 *  the write internally (`insertBatchPg`, ~2 600-row chunks) and returns once — so the finest
 *  granularity available here is the PHASE BOUNDARY, and this gate therefore switches on the
 *  DENOMINATOR (`total`), not a live per-row counter. Real per-row ticks would mean adding a progress
 *  callback to the shared importer, which both entry paths depend on; that is deliberately not done
 *  for a 2.3-second operation. */
const PER_ROW_PROGRESS_MIN_ROWS = 5000;

/** The row count the VALIDATE phase already counted for this run, or `null` when it cannot be read.
 *
 *  Free: the validate stored its `importFacilities` result on the run, and `parsed` is that count.
 *  The apply would otherwise have to parse the file twice to learn its own size before starting. */
function validatedRowCount(run: FacilityImportRun): number | null {
  const parsed = (run.summary as { parsed?: unknown } | null)?.parsed;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

/** Did this run publish a `total` when its apply started? Asked in the ONE place the closing
 *  `processed` is written, so the two halves cannot disagree about whether counts are in play. */
function reportedTotal(run: FacilityImportRun): boolean {
  const n = validatedRowCount(run);
  return n !== null && n >= PER_ROW_PROGRESS_MIN_ROWS;
}

export function createFacilityImportWorker(deps: FacilityImportWorkerDeps): FacilityImportWorker {
  const intervalMs = deps.intervalMs ?? 3000;
  // ⛔ Clamped, not merely defaulted. `MAX_STRING_LENGTH` (measured 536 870 888 on node 24 — just
  // under 512 MiB) is the hard limit on the `.toString('utf8')` below, so an operator who raises the
  // config above it would otherwise get a raw "Cannot create a string longer than…" out of the
  // decode. A byte count is a sound proxy for the character count that limit is expressed in: UTF-8
  // never decodes N bytes into more than N characters.
  const maxBufferBytes = Math.min(
    deps.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    bufferConstants.MAX_STRING_LENGTH,
  );
  let stopped = false;
  let running = false;

  /** Read the uploaded register back as a string, refusing one this process cannot hold.
   *
   *  ⛔ THE CEILING IS LOAD-BEARING, not defensive dressing. `importFacilities` takes a string, so
   *  the whole file lands on the heap of the API process the worker runs in (it is constructed
   *  inside `createAppContext`). Without a limit here, one authenticated `facilities.manage` client
   *  could OOM the server, and any file over `MAX_STRING_LENGTH` would fail with an unreadable
   *  decode error instead of a run the operator can understand.
   *
   *  ⚠ THREE limits exist in this area and they are NOT interchangeable — conflating two of them is
   *  what this comment replaced:
   *   - `MAX_IMPORT_CSV_BYTES` (8 MiB, `apps/server/src/facilities-routes.ts`) bounds the JSON body
   *     of the INLINE route. Nothing to do with this path.
   *   - `FACILITY_IMPORT_MAX_UPLOAD_BYTES` bounds the upload route's TRANSFER, cut off mid-stream.
   *   - this ceiling bounds what the worker will BUFFER. Wire it to the same config value (see
   *     `packages/bootstrap/src/index.ts`) so an accepted upload is always readable; the check
   *     survives anyway as defence in depth, because a blob can predate a config change.
   *
   *  The throw lands on the calling phase's ordinary catch, so an oversized register is a `failed`
   *  run carrying this message — the same shape as any other failure. `phaseVerb` is what that phase
   *  would have done ("validated"/"applied"): the apply reads the file a SECOND time, and telling an
   *  operator their confirmed import "was not validated" would name the wrong step. Reachable on the
   *  apply path only when the ceiling moved between the two reads, which is exactly the case where a
   *  precise message earns its keep. */
  async function readBlob(key: string, phaseVerb: 'validated' | 'applied'): Promise<string> {
    const stream = await deps.blob.getStream(key);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      total += buf.length;
      // Checked as the bytes arrive, so an oversized file is abandoned mid-read rather than after
      // the process has already paid for all of it.
      if (total > maxBufferBytes) {
        throw new Error(
          `the uploaded register exceeds the ${maxBufferBytes}-byte ceiling this worker will hold in `
          + `memory; it was not ${phaseVerb}`,
        );
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /** The options this phase runs `importFacilities` with.
   *
   *  ⛔ SPREAD FIRST, fixed fields after — the order is the point. Everything below the spread is
   *  read off the RUN ROW rather than off operator-supplied `options` JSON and must win over it:
   *  `nationalSystem` is the identity `active_key` locks on (a different one in the JSON would import
   *  under a register this run does not own), `format` is what the upload actually stored, and
   *  `apply: false` is what makes this the VALIDATE phase at all. */
  function validateOptions(run: FacilityImportRun): FacilityImportOptions {
    const stored = (run.options ?? {}) as Partial<FacilityImportOptions>;
    return {
      ...stored,
      nationalSystem: run.nationalSystem,
      format: run.sourceFormat,
      releaseVersion: run.releaseVersion,
      runId: run.id,
      // ⛔ Nothing is written by a validate. The operator's confirm (Task 5) is what authorises the
      // write, and `previewedAt` is deliberately absent here: no preview has run yet, so conflicts
      // are NOT EVALUATED (`conflict: null`) rather than reported as 0.
      apply: false,
    };
  }

  /** The options the APPLY phase runs `importFacilities` with — `validateOptions`' twin, and
   *  deliberately its own function rather than a flag on it, because the two differ on the two
   *  fields that decide whether anything is written and whether conflicts mean anything.
   *
   *  ⛔ SPREAD FIRST, fixed fields after, for the reason `validateOptions` states — with one more
   *  member below the spread than it has. `stored` here is no longer just the upload's
   *  `{ nationalSystem }`: the confirm route merged the OPERATOR's choices into it
   *  (`onConflict`/`onAbsent`/`allowMalformedRows`/…), which is the whole point of the round trip,
   *  and those must reach `importFacilities` unaltered. What must still win over them is the run
   *  row's own identity fields, so a hand-edited `options` JSON cannot import under a register this
   *  run does not hold.
   *
   *  ⛔ `previewedAt` IS THE WATERMARK, and passing it is the entire reason this flow has two phases.
   *  `completeValidation` stamped it (the DATABASE clock) at the moment the summary the operator read
   *  was computed; `classifyFacilityRows` compares `facility_registry.updated_at` against it and
   *  classifies anything newer as `conflict` — a row somebody else moved while the operator was
   *  deciding. Drop it and `importFacilities` reports `conflict: null`, NOT EVALUATED, and every such
   *  row is silently written as an ordinary update.
   *
   *  ⚠ `run.previewedAt` CAN be null and is passed through as null rather than defaulted to
   *  anything. `null` means NOT EVALUATED and `0` would be a measurement nobody took — the exact
   *  defect FAC-P1-03 named. A `new Date(null)` would be worse still: epoch 0, against which every
   *  row in the register is "newer", turning the whole file into conflicts. */
  function applyOptions(run: FacilityImportRun): FacilityImportOptions {
    const stored = (run.options ?? {}) as Partial<FacilityImportOptions>;
    return {
      ...stored,
      nationalSystem: run.nationalSystem,
      format: run.sourceFormat,
      releaseVersion: run.releaseVersion,
      runId: run.id,
      apply: true,
      previewedAt: run.previewedAt === null ? null : new Date(run.previewedAt),
    };
  }

  /** `facility.import`, matching the record the inline route writes for the same event (see
   *  `recordAudit` in apps/server/src/facilities-routes.ts's import handler) — same action, same
   *  entity type, same `entityId` (the national system), same `result` under metadata, so an
   *  operator reading the audit log cannot tell which door an import came through except by the
   *  fields that genuinely differ.
   *
   *  ⛔ CONTAINED, and called only after the run is already terminal. An audit failure must never
   *  reach the apply's catch — that catch writes `finish('failed')`, which over an import that has
   *  already COMMITTED would tell the operator their register was not written when it was.
   *
   *  ⚠ `actorType: 'system'` with the run's `requestedBy` as `actorId`. The actor who authorised
   *  this write is whoever confirmed, and the run row has no column for them (`requested_by` is set
   *  by the UPLOAD). The confirm route audits `facility.import.confirmed` with the real operator; this
   *  entry names the worker that carried it out, on behalf of the requester it does know. */
  async function auditApplied(run: FacilityImportRun, result: FacilityImportResult): Promise<void> {
    const opts = (run.options ?? {}) as Partial<FacilityImportOptions>;
    if (!deps.audit) {
      deps.logger.error({ runId: run.id, nationalSystem: run.nationalSystem }, 'applied a facility import with no audit store wired; the write is unaudited');
      return;
    }
    try {
      await deps.audit.record({
        actorType: 'system',
        actorId: run.requestedBy,
        actorName: 'facility-import-worker',
        action: 'facility.import',
        entityType: 'facility',
        entityId: run.nationalSystem,
        before: null,
        after: null,
        metadata: {
          runId: run.id, nationalSystem: run.nationalSystem,
          allowUnknownColumns: !!opts.allowUnknownColumns, allowMalformedRows: !!opts.allowMalformedRows,
          result,
        },
      });
    } catch (err) {
      deps.logger.error({ err, runId: run.id }, 'failed to audit an applied facility import');
    }
  }

  /** @param when Which boundary observed the cancel, for the log line only. */
  async function cancel(run: FacilityImportRun, when: string): Promise<void> {
    // `finish` nulls `active_key` in the same update — without that a cancelled run would hold its
    // national register for good, which is the lock-out this whole surface exists to prevent.
    //
    // ⚠ UNGUARDED ON PURPOSE, unlike `completeValidation`'s compare-and-swap below, and the
    // asymmetry is the point rather than an oversight. Both writes can race the same boot sweep, but
    // they lose differently. `finish` writes a TERMINAL status and nulls the key; if a sweep already
    // failed this run, the run is terminal with the key null either way, so the race can only change
    // the recorded REASON (`failed` → `cancelled`) and strands nothing. `completeValidation` writes
    // a NON-terminal status, so losing that race would resurrect a confirmable run whose register
    // has already been released — a real defect, which is why only that one is guarded.
    await deps.runs.finish(run.id, 'cancelled', { error: CANCELLED_BY_OPERATOR });
    // The stored object will never be applied now. Best-effort and logged, never fatal: the run is
    // already decided, and a failed delete must not change that answer (the same contained-cleanup
    // shape as the upload route's `discardBlob`). Deliberately NOT done on a failure, where the
    // uploaded file is the only evidence of what the operator actually sent.
    if (run.blobKey) {
      await deps.blob.delete(run.blobKey)
        .catch((err) => deps.logger.error({ err, runId: run.id, blobKey: run.blobKey }, 'failed to delete the cancelled import file'));
    }
    deps.logger.info({ runId: run.id, nationalSystem: run.nationalSystem }, `facility import cancelled ${when}`);
  }

  async function validate(run: FacilityImportRun): Promise<void> {
    // Cancel boundary 1 — at the claim. A run cancelled while it sat `queued` must not have its file
    // read at all.
    if (run.cancelRequested) {
      await cancel(run, 'before validation completed');
      return;
    }

    try {
      await deps.runs.updateProgress(run.id, { phase: 'reading the uploaded file' });
      // Not reachable via `startUpload`, which always writes one — but `blob_key` is nullable
      // (migration 080: an inline A2a run has none), so this answers rather than dereferencing null.
      // Thrown, not returned, so it lands on the same `failed` path as any other validation failure.
      if (!run.blobKey) throw new Error('the run has no blob key — nothing was stored to validate');
      const body = await readBlob(run.blobKey, 'validated');

      await deps.runs.updateProgress(run.id, { phase: 'validating' });
      const summary = await importFacilities(deps.importDeps, body, validateOptions(run));

      // Cancel boundary 2 — before the summary is written. The flag cannot interrupt the call above,
      // so this is the first moment after it that a cancel can be honoured; observing it here is what
      // keeps a cancelled run from being parked for a confirmation the operator no longer wants.
      const current = await deps.runs.get(run.id);
      if (current?.cancelRequested) {
        await cancel(run, 'before validation completed');
        return;
      }

      if (!(await deps.runs.completeValidation(run.id, summary))) {
        // The run left `validating` under us (another process's boot sweep failed it and released
        // its register). Reported, not retried: it is no longer this worker's run to finish.
        deps.logger.error({ runId: run.id, nationalSystem: run.nationalSystem }, 'facility import run was taken over before its validation could be parked');
        return;
      }
      // AFTER the status flip, deliberately: `completeValidation` is this phase's commit point, and a
      // phase saying `validated` over a run still `validating` (had the process died between the two)
      // would be the one lie this column can tell. The other order is safe only in the direction that
      // leaves the phase STALE, which is what a progress field is allowed to be.
      await deps.runs.updateProgress(run.id, { phase: 'validated' });
      deps.logger.info({ runId: run.id, nationalSystem: run.nationalSystem }, 'facility import validated; awaiting operator confirmation');
    } catch (err) {
      // `redact` for the same reason `runIngestJob` uses it: this message is stored and shown to an
      // operator, and a failure deep in the import can carry connection detail with it.
      const message = redact(err instanceof Error ? err.message : String(err));
      await deps.runs.finish(run.id, 'failed', { error: message });
      deps.logger.error({ err, runId: run.id, nationalSystem: run.nationalSystem }, 'facility import validation failed');
    }
  }

  /**
   * A2b Task 5: the second phase. The operator read the validate's summary and confirmed, which is
   * the ONLY thing that puts a run into `APPLY_PHASE.from` — see that constant and `ALL_RUN_STATES`.
   *
   * ⛔ ONE CANCEL BOUNDARY, at the claim, unlike `validate`'s two — and the missing second one is
   * deliberate rather than an omission. A cancel observed after `importFacilities` returns would be
   * observed after the write has COMMITTED: marking that run `cancelled` (with no summary, deleting
   * the uploaded file) would tell the operator nothing happened to a register that has just been
   * rewritten. `requestCancel`'s own contract already says exactly this — `'requested'` means a
   * worker will observe the flag at its next phase boundary, and "the run may still finish
   * `applied`" (facility-import-run-store.ts). The apply's only honest boundary is before it starts.
   */
  async function apply(run: FacilityImportRun): Promise<void> {
    if (run.cancelRequested) {
      await cancel(run, 'before the apply started');
      return;
    }

    let summary: FacilityImportResult;
    try {
      await deps.runs.updateProgress(run.id, { phase: 'reading the uploaded file' });
      // Same nullable column as the validate path, answered rather than dereferenced. The confirm
      // route refuses a run with no stored file, so this is the defence behind that one, not the
      // only one.
      if (!run.blobKey) throw new Error('the run has no blob key — nothing was stored to apply');
      const body = await readBlob(run.blobKey, 'applied');

      // ⛔ The gate `PER_ROW_PROGRESS_MIN_ROWS` documents. A small register finishes faster than the
      // numbers could be read, so publishing them would be motion rather than information; a large
      // one gets a denominator the operator can size the wait against. `processed: 0` is published
      // WITH the total so the pair is never half-written — a `total` beside a stale `processed` from
      // some earlier tick would read as progress that had already happened.
      await deps.runs.updateProgress(run.id, {
        phase: 'applying',
        ...(reportedTotal(run) ? { processed: 0, total: validatedRowCount(run) } : {}),
      });
      // ⛔ THE SAME `importFacilities` the validate phase, the inline route and the CLI all call.
      // The write, the projection through `deps.admin`, and the ONE `facility-map-rebuild` enqueue
      // all happen INSIDE it — none of them is repeated here, or an applied upload would rebuild the
      // dimension twice and could disagree with a pasted register about what the same file means.
      summary = await importFacilities(deps.importDeps, body, applyOptions(run));
      // The commit point. Terminal, so it releases `active_key` in the same update — the register is
      // free the moment the import that owned it is done with it.
      await deps.runs.finish(run.id, 'applied', { summary });
    } catch (err) {
      const message = redact(err instanceof Error ? err.message : String(err));
      await deps.runs.finish(run.id, 'failed', { error: message });
      deps.logger.error({ err, runId: run.id, nationalSystem: run.nationalSystem }, 'facility import apply failed');
      return;
    }

    // ⛔ EVERYTHING BELOW IS OUTSIDE THE TRY, and contained on its own. The register has been written
    // and the run is terminal; a failure in a progress update or an audit write must not reach the
    // catch above, which would mark an import that succeeded as `failed` and tell the operator their
    // national register was not written when it was.
    // `written` counts what the statement actually wrote; `parsed` is what it was asked to write.
    // The denominator published above was `parsed`, so the numerator that closes it must be too —
    // an apply where some rows were `unchanged` still PROCESSED all of them.
    const finalProcessed = reportedTotal(run) ? summary.parsed : null;
    await deps.runs.updateProgress(run.id, { phase: 'applied', processed: finalProcessed })
      .catch((err) => deps.logger.error({ err, runId: run.id }, 'failed to record the final phase of an applied facility import'));
    await auditApplied(run, summary);
    deps.logger.info({ runId: run.id, nationalSystem: run.nationalSystem, written: summary.written }, 'facility import applied');
  }

  async function tickOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      // ⛔ THE APPLY IS TRIED FIRST, and the order is a choice rather than an accident: an operator
      // is already waiting on a confirmed apply, and finishing one RELEASES its national register,
      // whereas a validate takes one and holds it for a decision. Starvation is not a risk — a
      // confirmed run exists only because someone confirmed it, and there is nothing to re-queue it.
      //
      // ⛔ `APPLY_PHASE.from`, never `'awaiting_confirmation'`. That is the state a run WAITS in;
      // claiming it would apply a national register with no operator decision anywhere in the path.
      // The confirm route is the only writer of `APPLY_PHASE.from`, so this claim cannot fire
      // without a confirm. See `APPLY_PHASE` (packages/db/src/facility-import-run-states.ts).
      const confirmed = await deps.runs.claimNext(APPLY_PHASE.from, APPLY_PHASE.to);
      if (confirmed) {
        await apply(confirmed);
        return;
      }

      // ⛔ `VALIDATE_PHASE`, never the two literals. `completeValidation`'s compare-and-swap guards
      // on `VALIDATE_PHASE.to` — the state this claim moves the run INTO — and spelled separately in
      // the two packages they can drift silently: the CAS would match 0 rows and this worker would
      // log a take-over that never happened. Sharing the value makes the drift unexpressible.
      const run = await deps.runs.claimNext(VALIDATE_PHASE.from, VALIDATE_PHASE.to);
      if (run) await validate(run);
    } catch (err) {
      deps.logger.error({ err }, 'facility import tick failed');
    } finally {
      running = false;
    }
  }

  // Crash recovery: a run still in a RUNNING state at startup was orphaned by a killed process, and
  // it is still holding its national register — `failStaleRunning` fails it and releases the key.
  // Best-effort and non-blocking, exactly like `createFacilityJobWorker`'s: a failure here must never
  // stop the worker starting. The handle is retained so stop() can await it, preventing a stray
  // recovery log after shutdown.
  const crashRecovery = deps.runs
    .failStaleRunning('interrupted — the server restarted before the import finished')
    .then((n) => { if (n > 0) deps.logger.info({ count: n }, 'failed orphaned facility import runs at startup'); })
    .catch((err) => deps.logger.error({ err }, 'facility import crash-recovery failed'));

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);

  return {
    tickOnce,
    async stop() { stopped = true; clearInterval(timer); await crashRecovery; },
  };
}
