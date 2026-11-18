// Taking back a long job that a server restart, a lease or an event's attempts cut off (design
// 2026-11-18-interrupted-jobs). Each worker calls `takeBack` for every job it finds orphaned: the
// cut is recorded, then the job either carries on by itself or waits for a person's Continue.
// `continueJob` is the Continue: the page's row menu and the CLI both call it through each job's
// own service, so they run the same code.
import type { InterruptionCause, JobInterruptionStore, JobKind } from '@openldr/db';

/** A job carries on by itself after at most this many cuts in one phase, then waits for Continue,
 *  so a job that keeps dying does not loop. */
export const MAX_SELF_RESUMES = 3;

export interface InterruptionDeps {
  store: JobInterruptionStore;
  now: () => Date;
}

export interface TakeBackInput {
  kind: JobKind;
  jobId: string;
  /** The job's phase when it was cut; a later phase starts the count again. */
  phase: string | null;
  /** The best time CE knows the job stopped: its last heartbeat or update. */
  at: Date;
  cause: InterruptionCause;
  /** False for a job that must never run again by itself, such as a workflow run. */
  selfResume: boolean;
  /** Puts the job back to run. */
  resume(): Promise<void>;
  /** Leaves the job waiting for Continue (its status becomes 'interrupted'). */
  wait(): Promise<void>;
}

/** Records the cut, then resumes the job or leaves it waiting. A cut already resolved runs nothing,
 *  so a worker that meets the same orphan twice does not start it twice; one recorded but never
 *  resolved is tried again. */
export async function takeBack(deps: InterruptionDeps, input: TakeBackInput): Promise<'resumed' | 'waiting' | 'already-recorded'> {
  const { id, inserted } = await deps.store.record(input.kind, input.jobId, { at: input.at, cause: input.cause, phase: input.phase });
  if (!inserted) {
    // The same cut met again. Done if it was resolved, or if it waits for a person. A cut a
    // self-resuming job recorded but never resolved means the take-back itself was cut (a resume
    // that threw, or a power cut between record and resolve): try it again (review R1).
    const existing = ((await deps.store.listFor(input.kind, [input.jobId])).get(input.jobId) ?? []).find((r) => r.id === id);
    if (!input.selfResume || existing?.resumedBy !== null) return 'already-recorded';
  }
  const cuts = await deps.store.inARow(input.kind, input.jobId, input.phase);
  if (!input.selfResume || cuts > MAX_SELF_RESUMES) {
    // Every wait is a status change guarded on the job's current state, so running it again on a
    // cut met again is safe, and it finishes a wait that was itself cut (re-review R1).
    await input.wait();
    return 'waiting';
  }
  await input.resume();
  await deps.store.resolve(id, { resumedBy: 'self', resumedAt: deps.now() });
  return 'resumed';
}

/** A person's Continue on a waiting job: `start` runs it again (and may return a new run's id),
 *  then the record says who brought it back and when. */
export async function continueJob(
  deps: InterruptionDeps,
  input: { kind: JobKind; jobId: string; interruptionId: string; start(): Promise<string | void> },
): Promise<void> {
  const continuedAs = await input.start();
  await deps.store.resolve(input.interruptionId, {
    resumedBy: 'person', resumedAt: deps.now(), ...(typeof continuedAs === 'string' ? { continuedAs } : {}),
  });
}

/** A running job writes a heartbeat this often. */
export const HEARTBEAT_MS = 30_000;
/** A running job silent for longer than this has nothing working on it any more, so a worker
 *  takes it back. Four missed heartbeats, the same rule as cdr-source runs (`import-run.ts`). */
export const STALE_JOB_MS = 2 * 60_000;

/** Calls `beat` every `everyMs` until the returned stop is called. A failed beat is ignored: the
 *  next one tries again, and a job that cannot beat for STALE_JOB_MS is taken back, which is safe. */
export function startHeartbeat(beat: () => Promise<void>, everyMs: number = HEARTBEAT_MS): () => void {
  const timer = setInterval(() => { void beat().catch(() => {}); }, everyMs);
  return () => clearInterval(timer);
}

/** Takes back every job `listStale` finds silent for longer than STALE_JOB_MS. The cause is
 *  `server-restart` when the job went silent before this process started, else `lease-expired`.
 *  Returns how many jobs it took back. */
export async function sweepStale(deps: InterruptionDeps, input: {
  kind: JobKind;
  processStartedAt: Date;
  selfResume: boolean;
  listStale(olderThan: Date): Promise<{ id: string; phase: string | null; at: Date }[]>;
  resume(id: string): Promise<void>;
  wait(id: string): Promise<void>;
}): Promise<number> {
  const stale = await input.listStale(new Date(deps.now().getTime() - STALE_JOB_MS));
  for (const job of stale) {
    await takeBack(deps, {
      kind: input.kind, jobId: job.id, phase: job.phase, at: job.at,
      cause: job.at.getTime() < input.processStartedAt.getTime() ? 'server-restart' : 'lease-expired',
      selfResume: input.selfResume, resume: () => input.resume(job.id), wait: () => input.wait(job.id),
    });
  }
  return stale.length;
}

/** What a service that takes over its own orphaned work needs to record it. */
export type SelfResumeDeps = InterruptionDeps & { processStartedAt: Date };

/** Records a cut that a job carried on through by itself: cdr-source copies, checks and imports,
 *  which resume from their saved cursor, so every resume makes progress and no cap applies.
 *  Recording never stops the takeover: a failure here is swallowed, as is a missing store. */
export async function recordSelfResume(deps: SelfResumeDeps | undefined, kind: JobKind, jobId: string, at: Date): Promise<void> {
  if (!deps) return;
  try {
    const { id, inserted } = await deps.store.record(kind, jobId, {
      at, phase: null, cause: at.getTime() < deps.processStartedAt.getTime() ? 'server-restart' : 'lease-expired',
    });
    if (inserted) await deps.store.resolve(id, { resumedBy: 'self', resumedAt: deps.now() });
  } catch {
    // The run carries on either way; the page then shows no record of this cut.
  }
}
