import { describe, it, expect } from 'vitest';
import { createJobInterruptionStore, createTerminologyIngestJobStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { continueTerminologyIngestJob, openInterruption, continueRefusal } from './job-continue';

const NOW = new Date('2026-11-18T07:00:00.000Z');

async function setup() {
  const db = await makeMigratedDb();
  const ctx = { terminologyJobs: createTerminologyIngestJobStore(db as never), jobInterruptions: createJobInterruptionStore(db) };
  const job = await ctx.terminologyJobs.insertRunning({ systemType: 'snomed', codingSystemId: 'cs_1', blobKey: 'k/a.zip', version: null, createdBy: 'cli' });
  return { ctx, job };
}

describe('continueTerminologyIngestJob', () => {
  it('requeues an interrupted upload and marks its cut as brought back by a person', async () => {
    const { ctx, job } = await setup();
    await ctx.jobInterruptions.record('terminology-ingest', job.id, { at: new Date('2026-11-18T06:00:00.000Z'), cause: 'server-restart', phase: 'concepts' });
    await ctx.terminologyJobs.markInterrupted(job.id, 'interrupted too many times');
    expect(await continueTerminologyIngestJob(ctx, job.id, NOW)).toBe('requeued');
    expect((await ctx.terminologyJobs.get(job.id))?.status).toBe('queued');
    expect(await openInterruption(ctx.jobInterruptions, 'terminology-ingest', job.id)).toBeNull();
    expect((await ctx.jobInterruptions.listFor('terminology-ingest', [job.id])).get(job.id)![0]).toMatchObject({ resumedBy: 'person', resumedAt: NOW.toISOString() });
  });

  it('refuses a job that is not waiting, and records nothing', async () => {
    const { ctx, job } = await setup();
    expect(await continueTerminologyIngestJob(ctx, job.id, NOW)).toBe('not-waiting');
    expect((await ctx.terminologyJobs.get(job.id))?.status).toBe('running');
    expect(continueRefusal('not-waiting')).toBe('this job is not waiting to continue');
  });
});
