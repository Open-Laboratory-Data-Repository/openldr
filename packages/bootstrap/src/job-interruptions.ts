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

/** Records the cut, then resumes the job or leaves it waiting. A cut already recorded runs nothing,
 *  so a worker that meets the same orphan twice does not start it twice. */
export async function takeBack(deps: InterruptionDeps, input: TakeBackInput): Promise<'resumed' | 'waiting' | 'already-recorded'> {
  const { id, inserted } = await deps.store.record(input.kind, input.jobId, { at: input.at, cause: input.cause, phase: input.phase });
  if (!inserted) return 'already-recorded';
  const cuts = await deps.store.inARow(input.kind, input.jobId, input.phase);
  if (!input.selfResume || cuts > MAX_SELF_RESUMES) {
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
