import { constants as bufferConstants } from 'node:buffer';
import { redact } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import { VALIDATE_PHASE, type FacilityImportRun, type FacilityImportRunStore } from '@openldr/db';
import { importFacilities, type FacilityImportDeps, type FacilityImportOptions } from './facility-import';

export interface FacilityImportWorkerDeps {
  runs: FacilityImportRunStore;
  blob: Pick<BlobStoragePort, 'getStream' | 'delete'>;
  /** Exactly the deps the INLINE route builds for `importFacilities` (`db`/`capture`/`admin`/
   *  `facilityJobs`/`logger` — see apps/server/src/facilities-routes.ts). Passed straight through:
   *  this worker adds no import behaviour of its own. */
  importDeps: FacilityImportDeps;
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
 * A2b Task 4: the background half of the facility import, validate phase.
 *
 * `POST /api/facilities/import/upload` streams a national register into blob storage and mints a
 * `queued` run for it (nothing is parsed there). This worker claims that run, reads the file back,
 * and reports what is in it — then parks the run at `awaiting_confirmation` for the operator. The
 * apply phase (Task 5) is a second claim, from `awaiting_confirmation`.
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
   *  The throw lands on `validate`'s ordinary catch, so an oversized register is a `failed` run
   *  carrying this message — the same shape as any other validation failure. */
  async function readBlob(key: string): Promise<string> {
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
          + 'memory; it was not validated',
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

  async function cancel(run: FacilityImportRun): Promise<void> {
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
    deps.logger.info({ runId: run.id, nationalSystem: run.nationalSystem }, 'facility import cancelled before validation completed');
  }

  async function validate(run: FacilityImportRun): Promise<void> {
    // Cancel boundary 1 — at the claim. A run cancelled while it sat `queued` must not have its file
    // read at all.
    if (run.cancelRequested) {
      await cancel(run);
      return;
    }

    try {
      await deps.runs.updateProgress(run.id, { phase: 'reading the uploaded file' });
      // Not reachable via `startUpload`, which always writes one — but `blob_key` is nullable
      // (migration 080: an inline A2a run has none), so this answers rather than dereferencing null.
      // Thrown, not returned, so it lands on the same `failed` path as any other validation failure.
      if (!run.blobKey) throw new Error('the run has no blob key — nothing was stored to validate');
      const body = await readBlob(run.blobKey);

      await deps.runs.updateProgress(run.id, { phase: 'validating' });
      const summary = await importFacilities(deps.importDeps, body, validateOptions(run));

      // Cancel boundary 2 — before the summary is written. The flag cannot interrupt the call above,
      // so this is the first moment after it that a cancel can be honoured; observing it here is what
      // keeps a cancelled run from being parked for a confirmation the operator no longer wants.
      const current = await deps.runs.get(run.id);
      if (current?.cancelRequested) {
        await cancel(run);
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

  async function tickOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
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
