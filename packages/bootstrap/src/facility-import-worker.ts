import { redact } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { FacilityImportRun, FacilityImportRunStore } from '@openldr/db';
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
 * end; it is bounded by `FACILITY_IMPORT_MAX_UPLOAD_BYTES` (8 MB by default), and buffering here is
 * the deliberate price of not forking the importer into a streaming twin that could disagree with it.
 *
 * ⛔ NO ATTEMPT BUDGET, unlike `createFacilityJobWorker`. That worker re-queues a failed job because
 * `facility_jobs` carries `attempts` and the store has `retryPreservingAttempts`; `facility_import_runs`
 * has neither column nor method (migration 080), and a failed run has already RELEASED its register
 * by definition — re-queueing one would need it to take the register back, which nothing supports. A
 * `maxAttempts` knob here would therefore be a setting that does nothing, so there isn't one: a failed
 * validation stays failed, visible with its message, and the operator uploads again.
 */
export function createFacilityImportWorker(deps: FacilityImportWorkerDeps): FacilityImportWorker {
  const intervalMs = deps.intervalMs ?? 3000;
  let stopped = false;
  let running = false;

  async function readBlob(key: string): Promise<string> {
    const stream = await deps.blob.getStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
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
      const run = await deps.runs.claimNext('queued', 'validating');
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
