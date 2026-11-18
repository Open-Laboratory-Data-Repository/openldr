import { describe, it, expect, vi } from 'vitest';
import { createJobInterruptionStore, createTerminologyIngestJobStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { continueTerminologyIngestJob, continueWorkflowReceipt, openInterruption, continueRefusal } from './job-continue';

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

describe('continueWorkflowReceipt', () => {
  async function ctxWith(result: unknown) {
    const db = await makeMigratedDb();
    const jobInterruptions = createJobInterruptionStore(db);
    const continueFrom = vi.fn(async () => result);
    const get = vi.fn(async () => ({ startedAt: '2026-11-18T05:00:00.000Z', createdAt: '2026-11-18T04:59:00.000Z' }));
    return { ctx: { workflows: { receipts: { continueFrom, get } }, jobInterruptions } as never, jobInterruptions, continueFrom };
  }

  it('starts a new run and records the cut as continued by a person, linked to it', async () => {
    const { ctx, jobInterruptions, continueFrom } = await ctxWith({ receipt: { runId: 'run-2' }, definitionChanged: true });
    expect(await continueWorkflowReceipt(ctx, 'wf1', 'rcpt1', NOW)).toEqual({ runId: 'run-2', definitionChanged: true });
    expect(continueFrom).toHaveBeenCalledWith('wf1', 'rcpt1');
    expect((await jobInterruptions.listFor('workflow-receipt', ['rcpt1'])).get('rcpt1')).toEqual([
      expect.objectContaining({ at: '2026-11-18T05:00:00.000Z', resumedBy: 'person', resumedAt: NOW.toISOString(), continuedAs: 'run-2' }),
    ]);
  });

  it('resolves the open record the receipt service wrote when the run was cut (review R6)', async () => {
    const { ctx, jobInterruptions } = await ctxWith({ receipt: { runId: 'run-3' }, definitionChanged: false });
    await jobInterruptions.record('workflow-receipt', 'rcpt1', { at: new Date('2026-11-18T05:30:00.000Z'), cause: 'lease-expired', phase: null });
    await continueWorkflowReceipt(ctx, 'wf1', 'rcpt1', NOW);
    expect((await jobInterruptions.listFor('workflow-receipt', ['rcpt1'])).get('rcpt1')).toEqual([
      expect.objectContaining({ at: '2026-11-18T05:30:00.000Z', resumedBy: 'person', continuedAs: 'run-3' }),
    ]);
  });

  it('refuses a receipt that is not waiting, and records nothing', async () => {
    const { ctx, jobInterruptions } = await ctxWith('not-waiting');
    expect(await continueWorkflowReceipt(ctx, 'wf1', 'rcpt1', NOW)).toBe('not-waiting');
    expect((await jobInterruptions.listFor('workflow-receipt', ['rcpt1'])).size).toBe(0);
  });
});
