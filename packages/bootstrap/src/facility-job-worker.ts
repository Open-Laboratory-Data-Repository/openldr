import type { FacilityJob, FacilityJobStore } from '@openldr/db';
import { startHeartbeat, sweepStale, type InterruptionDeps } from './job-interruptions';

export interface FacilityJobWorkerDeps {
  jobs: FacilityJobStore;
  runRebuild(): Promise<{ written: number }>;
  runProjection(registryId: string): Promise<void>;
  /** Attempt budget a job may spend before it stays `failed` for good. Default 5. */
  maxAttempts?: number;
  /** Where the worker records the jobs it takes back after an interruption. Absent (some unit
   *  tests), the worker takes nothing back. */
  interruptions?: InterruptionDeps;
  /** When this server process started: a job silent since before it was cut by a restart. */
  processStartedAt?: Date;
  intervalMs?: number;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}

export interface FacilityJobWorker {
  tickOnce(): Promise<void>;
  stop(): Promise<void>;
}

export function createFacilityJobWorker(deps: FacilityJobWorkerDeps): FacilityJobWorker {
  const intervalMs = deps.intervalMs ?? 3000;
  const maxAttempts = deps.maxAttempts ?? 5;
  let stopped = false;
  /** The tick in progress, if any. stop() awaits it: closing the DB under a claimed job makes its
   *  `finish()` throw, and the row then stays `running` with nothing left to finish it. */
  let inFlight: Promise<void> | null = null;
  const processStartedAt = deps.processStartedAt ?? new Date();

  async function processJob(job: FacilityJob): Promise<void> {
    const stopBeat = startHeartbeat(() => deps.jobs.beat(job.id));
    try {
      if (job.kind === 'facility-map-rebuild') {
        const { written } = await deps.runRebuild();
        await deps.jobs.finish(job.id, 'done', { resultCount: written });
      } else {
        if (job.registryId) await deps.runProjection(job.registryId);
        await deps.jobs.finish(job.id, 'done', {});
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.jobs.finish(job.id, 'failed', { error: message });
      // Re-queue until the attempt budget is spent. `claimNext` increments `attempts`, so the job
      // that has just run already carries its own attempt count — compare against it, not against
      // a separate counter. Past the bound the row STAYS failed with its last_error rather than
      // disappearing, so the health chip can still show it and an operator can Retry.
      if (job.attempts < maxAttempts) await deps.jobs.retryPreservingAttempts(job.id);
      deps.logger.error({ err, jobId: job.id, kind: job.kind, attempts: job.attempts }, 'facility job failed');
    } finally {
      stopBeat();
    }
  }

  async function runTick(): Promise<void> {
    try {
      // A job a dead process was running goes back in the queue (or waits for Continue after
      // MAX_SELF_RESUMES cuts), with the cut recorded. Its heartbeat tells it from a live one.
      if (deps.interruptions) await sweepStale(deps.interruptions, {
        kind: 'facility-job', processStartedAt, selfResume: true,
        listStale: (olderThan) => deps.jobs.listStaleRunning(olderThan),
        resume: async (id) => { await deps.jobs.requeueStale(id); },
        wait: (id) => deps.jobs.markInterrupted(id, 'interrupted too many times in a row; use Continue to run it again'),
      });
      const job = await deps.jobs.claimNext();
      if (job) await processJob(job);
    } catch (err) {
      deps.logger.error({ err }, 'facility job tick failed');
    } finally {
      inFlight = null;
    }
  }

  function tickOnce(): Promise<void> {
    // A stopped worker claims nothing, so shutdown cannot start a job it will not see through.
    if (stopped || inFlight) return Promise.resolve();
    inFlight = runTick();
    return inFlight;
  }

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);

  return {
    tickOnce,
    async stop() {
      stopped = true;
      clearInterval(timer);
      // No timeout. A rebuild cut short by a hard kill stops beating, and the next server's sweep
      // takes it back and runs it again.
      await inFlight;
    },
  };
}

/** Build the worker only in a process that drains the queue.
 *
 *  Every `openldr` CLI command builds an `AppContext`. Building this worker there would let a
 *  short-lived CLI process claim a rebuild it will close the DB under. Jobs a
 *  CLI command enqueues wait in `facility_jobs` for the server to run them. */
export function createFacilityJobWorkerIfEnabled(
  enabled: boolean, deps: FacilityJobWorkerDeps,
): FacilityJobWorker | null {
  return enabled ? createFacilityJobWorker(deps) : null;
}
