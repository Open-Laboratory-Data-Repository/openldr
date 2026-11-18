import type { JobInterruptionStore } from '@openldr/db';
import type { BatchStore } from './batch-store';

/** A batch whose event ran out of delivery attempts would sit at `processing` for ever (design
 *  2026-11-18-interrupted-jobs, review R9). This marks it `interrupted` and opens a record, so the
 *  page says it waits for a person to retry it. Returns how many batches it marked. */
export async function sweepStuckBatches(deps: {
  batches: Pick<BatchStore, 'listStuck' | 'markInterrupted'>;
  interruptions: Pick<JobInterruptionStore, 'record'>;
  olderThanMs: number;
}): Promise<number> {
  const stuck = await deps.batches.listStuck(deps.olderThanMs);
  for (const b of stuck) {
    await deps.interruptions.record('ingest-batch', b.batch_id, { at: new Date(b.updated_at), cause: 'attempts-exhausted', phase: null });
    await deps.batches.markInterrupted(b.batch_id, 'The batch was cut off too many times. Retry it to carry on.');
  }
  return stuck.length;
}
