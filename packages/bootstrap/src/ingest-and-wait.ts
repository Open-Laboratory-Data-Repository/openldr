import type { AcceptInput } from '@openldr/ingest';
import type { IngestContext } from './ingest-context';

export interface IngestWait { intervalMs: number; timeoutMs: number }

export interface IngestOutcome {
  batchId: string;
  /** The batch's last status, undefined when the batch is gone. */
  status: string | undefined;
  resourceCount: number | undefined;
  error: string | null | undefined;
  /** Status is 'done' or 'failed'. */
  finished: boolean;
}

const FINISHED = new Set(['done', 'failed']);

/** Accepts one payload, drains, then waits for whichever process has the batch to finish it.
 *  `openldr ingest` and the Studio sample data load both use it. */
export async function ingestAndWait(
  ctx: Pick<IngestContext, 'accept' | 'drain' | 'batches'>,
  input: AcceptInput,
  wait: IngestWait = { intervalMs: 500, timeoutMs: 60_000 },
): Promise<IngestOutcome> {
  const { batchId } = await ctx.accept(input);
  await ctx.drain();
  // A running API server's worker may claim the batch before this drain does, and then the drain
  // finds nothing. Wait for whichever process has it to finish, rather than reading it mid-run.
  let batch = await ctx.batches.get(batchId);
  const deadline = Date.now() + wait.timeoutMs;
  while (batch && !FINISHED.has(batch.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait.intervalMs));
    batch = await ctx.batches.get(batchId);
  }
  return {
    batchId,
    status: batch?.status,
    resourceCount: batch?.resource_count,
    error: batch?.last_error,
    finished: !!batch && FINISHED.has(batch.status),
  };
}
