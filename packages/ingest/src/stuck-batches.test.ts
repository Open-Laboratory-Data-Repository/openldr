import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { createJobInterruptionStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { createBatchStore } from './batch-store';
import { sweepStuckBatches } from './stuck-batches';

async function setup(eventStatus: string | null) {
  const db = await makeMigratedDb();
  const batches = createBatchStore(db);
  const store = createJobInterruptionStore(db);
  await batches.create({ batchId: 'b1', source: 'lab', blobKey: 'k', converter: 'fhir-bundle' });
  await batches.markProcessing('b1');
  await sql`update ingest_batches set updated_at = now() - interval '1 hour' where batch_id = 'b1'`.execute(db);
  if (eventStatus) {
    await sql`insert into outbox_events (id, type, payload, status) values ('e1', 'ingest.received', ${JSON.stringify({ batchId: 'b1' })}::jsonb, ${eventStatus})`.execute(db);
  }
  return { db, batches, store };
}

describe('sweepStuckBatches (design 2026-11-18-interrupted-jobs, review R9)', () => {
  it('marks a batch left processing after its event ran out of attempts as interrupted, with an open record', async () => {
    const { batches, store } = await setup('failed');
    expect(await sweepStuckBatches({ batches, interruptions: store, olderThanMs: 15 * 60_000 })).toBe(1);
    expect((await batches.get('b1'))?.status).toBe('interrupted');
    expect((await store.listFor('ingest-batch', ['b1'])).get('b1')).toEqual([
      expect.objectContaining({ cause: 'attempts-exhausted', resumedBy: null }),
    ]);
  });

  it('also catches a batch whose event is gone', async () => {
    const { batches, store } = await setup(null);
    expect(await sweepStuckBatches({ batches, interruptions: store, olderThanMs: 15 * 60_000 })).toBe(1);
  });

  it('leaves a batch whose event is still pending or being processed, and a recent batch', async () => {
    const pending = await setup('pending');
    expect(await sweepStuckBatches({ batches: pending.batches, interruptions: pending.store, olderThanMs: 15 * 60_000 })).toBe(0);
    expect((await pending.batches.get('b1'))?.status).toBe('processing');
    const recent = await setup('failed');
    expect(await sweepStuckBatches({ batches: recent.batches, interruptions: recent.store, olderThanMs: 2 * 60 * 60_000 })).toBe(0);
  });
});
