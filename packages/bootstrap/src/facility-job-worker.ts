import type { FacilityJob, FacilityJobStore } from '@openldr/db';

export interface FacilityJobWorkerDeps {
  jobs: FacilityJobStore;
  runRebuild(): Promise<{ written: number }>;
  runProjection(registryId: string): Promise<void>;
  /** Attempt budget a job may spend before it stays `failed` for good. Default 5. */
  maxAttempts?: number;
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
  let running = false;

  async function processJob(job: FacilityJob): Promise<void> {
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
    }
  }

  async function tickOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const job = await deps.jobs.claimNext();
      if (job) await processJob(job);
    } catch (err) {
      deps.logger.error({ err }, 'facility job tick failed');
    } finally {
      running = false;
    }
  }

  // Crash recovery: a job still 'running' at startup was orphaned by a killed process. Best-effort
  // and non-blocking — a failure here must never stop the worker starting. The handle is retained so
  // stop() can await it, preventing a stray recovery log after shutdown.
  const crashRecovery = deps.jobs
    .failStaleRunning('interrupted — the server restarted before the rebuild finished')
    .then((n) => { if (n > 0) deps.logger.info({ count: n }, 'reset orphaned facility jobs at startup'); })
    .catch((err) => deps.logger.error({ err }, 'facility job crash-recovery failed'));

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);

  return {
    tickOnce,
    async stop() { stopped = true; clearInterval(timer); await crashRecovery; },
  };
}
