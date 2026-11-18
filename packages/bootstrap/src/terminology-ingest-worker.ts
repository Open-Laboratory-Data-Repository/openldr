import type { BlobStoragePort } from '@openldr/ports';
import type { TerminologyIngestJob, TerminologyIngestJobStore } from '@openldr/db';
import type { AuditStore } from '@openldr/audit';
import type { IngestProgress } from '@openldr/terminology';
import { runIngestJob } from './terminology-ingest-shared';
import { sweepStale, type InterruptionDeps } from './job-interruptions';

export interface TerminologyIngestWorkerDeps {
  jobs: TerminologyIngestJobStore;
  blob: Pick<BlobStoragePort, 'getStream' | 'delete'>;
  runIngest(job: TerminologyIngestJob, onProgress: (p: IngestProgress) => void): Promise<{ conceptsLoaded: number }>;
  audit: Pick<AuditStore, 'record'>;
  workDirBase: string;
  /** Where the worker records the jobs it takes back after an interruption. Absent (some unit
   *  tests), the worker takes nothing back. */
  interruptions?: InterruptionDeps;
  /** When this server process started: a job silent since before it was cut by a restart. */
  processStartedAt?: Date;
  intervalMs?: number;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}

export interface TerminologyIngestWorker {
  tickOnce(): Promise<void>;
  stop(): Promise<void>;
}

export function createTerminologyIngestWorker(deps: TerminologyIngestWorkerDeps): TerminologyIngestWorker {
  const intervalMs = deps.intervalMs ?? 3000;
  let stopped = false;
  let running = false;
  const processStartedAt = deps.processStartedAt ?? new Date();

  async function processJob(job: TerminologyIngestJob): Promise<void> {
    await runIngestJob({
      job, jobs: deps.jobs, blob: deps.blob, runIngest: deps.runIngest,
      audit: deps.audit, logger: deps.logger,
    });
  }

  async function tickOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      // A job a dead process was running goes back in the queue (or waits for Continue after
      // MAX_SELF_RESUMES cuts), with the cut recorded. Its heartbeat tells it from a live one.
      if (deps.interruptions) await sweepStale(deps.interruptions, {
        kind: 'terminology-ingest', processStartedAt, selfResume: true,
        listStale: (olderThan) => deps.jobs.listStaleRunning(olderThan),
        resume: async (id) => { await deps.jobs.requeue(id); },
        wait: (id) => deps.jobs.markInterrupted(id, 'interrupted too many times in a row; use Continue to run it again'),
      });
      const job = await deps.jobs.claimNext();
      if (job) await processJob(job);
    } catch (err) {
      deps.logger.error({ err }, 'terminology ingest tick failed');
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);

  return {
    tickOnce,
    async stop() { stopped = true; clearInterval(timer); },
  };
}

/** Build the worker only in the process that drains the queue, which is the API server.
 *  Building it is not inert: it takes back every `running` job whose heartbeat stopped. Every
 *  `openldr` CLI command builds an `AppContext`, so the queue stays with the server.
 *  The CLI's own `terminology distribution import` runs its job inline and needs no worker. */
export function createTerminologyIngestWorkerIfEnabled(
  enabled: boolean, deps: TerminologyIngestWorkerDeps,
): TerminologyIngestWorker | null {
  return enabled ? createTerminologyIngestWorker(deps) : null;
}
