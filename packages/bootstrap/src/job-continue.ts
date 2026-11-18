// Continue for jobs that wait after an interruption (design 2026-11-18-interrupted-jobs). The page's
// row menu and the CLI both call these, so a Continue runs the same code wherever it starts.
import type { JobInterruption, JobInterruptionStore, JobKind, TerminologyIngestJobStore } from '@openldr/db';

/** The job's newest record that nothing has resolved yet: the cut a Continue answers. */
export async function openInterruption(store: JobInterruptionStore, kind: JobKind, jobId: string): Promise<JobInterruption | null> {
  const records = (await store.listFor(kind, [jobId])).get(jobId) ?? [];
  return [...records].reverse().find((r) => r.resumedBy === null) ?? null;
}

/** Marks the job's open cut as brought back by a person. Nothing to mark is fine: a failed job
 *  retried by a person had no cut. */
export async function resolveByPerson(store: JobInterruptionStore, kind: JobKind, jobId: string, now: Date, continuedAs?: string): Promise<void> {
  const open = await openInterruption(store, kind, jobId);
  if (open) await store.resolve(open.id, { resumedBy: 'person', resumedAt: now, ...(continuedAs ? { continuedAs } : {}) });
}

export type ContinueOutcome = 'requeued' | 'not-waiting' | 'busy';

/** Continue on an interrupted terminology upload: back in the queue, with the cut marked as
 *  brought back by a person. `busy` when another upload for the same system is active. */
export async function continueTerminologyIngestJob(
  ctx: { terminologyJobs: TerminologyIngestJobStore; jobInterruptions: JobInterruptionStore },
  id: string,
  now: Date = new Date(),
): Promise<ContinueOutcome> {
  const outcome = await ctx.terminologyJobs.continueInterrupted(id);
  if (outcome === 'requeued') await resolveByPerson(ctx.jobInterruptions, 'terminology-ingest', id, now);
  return outcome;
}

/** The words for an outcome that did not requeue, shared by the route and the CLI. */
export function continueRefusal(outcome: Exclude<ContinueOutcome, 'requeued'>): string {
  return outcome === 'busy'
    ? 'another job for the same system is running; continue this one when it finishes'
    : 'this job is not waiting to continue';
}

/** Continue on an interrupted workflow run: a new run with the stored input, and the cut recorded as
 *  brought back by a person, linked to the new run. A workflow run never re-runs by itself: it may
 *  have sent an email or called another system before the cut. `definitionChanged` tells the page
 *  to say the workflow changed since. */
export async function continueWorkflowReceipt(
  ctx: {
    workflows: { receipts: { continueFrom(workflowId: string, id: string): Promise<{ receipt: { runId: string; startedAt?: string | null; createdAt?: string }; definitionChanged: boolean } | 'not-waiting'>; get(id: string): Promise<{ startedAt: string | null; createdAt: string } | undefined> } };
    jobInterruptions: JobInterruptionStore;
  },
  workflowId: string,
  receiptId: string,
  now: Date = new Date(),
): Promise<{ runId: string; definitionChanged: boolean } | 'not-waiting'> {
  const before = await ctx.workflows.receipts.get(receiptId);
  const result = await ctx.workflows.receipts.continueFrom(workflowId, receiptId);
  if (result === 'not-waiting') return result;
  // The receipt's own `interrupted` status is the cut; the record says when it happened and links
  // the run a person started from it.
  const at = new Date(before?.startedAt ?? before?.createdAt ?? now);
  const { id } = await ctx.jobInterruptions.record('workflow-receipt', receiptId, { at, cause: 'lease-expired', phase: null });
  await ctx.jobInterruptions.resolve(id, { resumedBy: 'person', resumedAt: now, continuedAs: result.receipt.runId });
  return { runId: result.receipt.runId, definitionChanged: result.definitionChanged };
}
