import { describe, it, expect, vi } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFacilityJobStore } from '@openldr/db';
import { createFacilityJobWorker } from './facility-job-worker';

const fakeLogger = () => ({ info: vi.fn(), error: vi.fn() });

describe('createFacilityJobWorker', () => {
  it('runs a queued rebuild and records the row count', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => ({ written: 88 }), runProjection: async () => {},
      intervalMs: 10_000, logger: fakeLogger(),
    });

    await worker.tickOnce();
    await worker.stop();

    const latest = await jobs.latest('facility-map-rebuild');
    expect(latest).toMatchObject({ status: 'done', resultCount: 88 });
  });

  it('records a failure with its message instead of throwing', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    // maxAttempts: 1 pins the assertion below deterministically. With the default budget (5) the
    // worker's own retry (job.attempts=1 < 5) requeues this same row inside the same tickOnce call,
    // so `latest()` would observe 'queued', not 'failed' — proven by running this test against the
    // brief's exact sample first: it failed with `status: "queued"` instead of `"failed"`. That is
    // not a bug in the worker; it is the retry design test 3 below pins. Exhausting the budget in
    // one shot isolates what this test is actually about (the failure message is recorded, and the
    // worker does not throw) from the separate retry-bound behaviour.
    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => { throw new Error('warehouse unreachable'); },
      runProjection: async () => {}, maxAttempts: 1, intervalMs: 10_000, logger: fakeLogger(),
    });

    await expect(worker.tickOnce()).resolves.toBeUndefined();
    await worker.stop();

    expect(await jobs.latest('facility-map-rebuild')).toMatchObject({
      status: 'failed', lastError: expect.stringContaining('warehouse unreachable'),
    });
  });

  it('re-queues a failure until maxAttempts, then stops retrying and stays visible', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => { throw new Error('nope'); }, runProjection: async () => {},
      maxAttempts: 2, intervalMs: 10_000, logger: fakeLogger(),
    });

    for (let i = 0; i < 5; i += 1) await worker.tickOnce();
    await worker.stop();

    const latest = await jobs.latest('facility-map-rebuild');
    expect(latest?.status).toBe('failed');
    expect(latest?.attempts).toBe(2);          // stopped at the bound, did not spin
  });

  it('runs a registry-projection job against its own facility', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'registry-projection', registryId: 'fac-A' });
    const seen: string[] = [];
    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => ({ written: 0 }),
      runProjection: async (id) => { seen.push(id); },
      intervalMs: 10_000, logger: fakeLogger(),
    });

    await worker.tickOnce();
    await worker.stop();

    expect(seen).toEqual(['fac-A']);
  });

  it('crash recovery: an orphaned running job becomes failed at startup', async () => {
    const db = await makeMigratedDb();
    const jobs = createFacilityJobStore(db);
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    await jobs.claimNext();                     // simulates a process killed mid-run

    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => ({ written: 0 }), runProjection: async () => {},
      intervalMs: 10_000, logger: fakeLogger(),
    });
    await worker.stop();                        // stop() awaits the crash-recovery handle

    expect((await jobs.latest('facility-map-rebuild'))?.status).toBe('failed');
  });

  it('stop() genuinely AWAITS the crash-recovery handle rather than merely firing it', async () => {
    // The plain crash-recovery test above does NOT pin this: with a real timer-backed delay removed
    // it still passes whether or not stop() awaits, because enough real microtask turns elapse
    // between worker construction and the assertion for an un-awaited recovery to finish anyway
    // (measured directly: mutating stop() to `void crashRecovery` still left the suite green,
    // repeatably, across 3 runs). This test makes the ordering deterministic instead of hoping for
    // it: failStaleRunning is wrapped with a real setTimeout delay, so a stop() that does not await
    // the handle returns to the caller BEFORE the delayed write lands, and the very next read
    // observes the pre-recovery state deterministically rather than by timing luck.
    const db = await makeMigratedDb();
    const jobs = createFacilityJobStore(db);
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    await jobs.claimNext();

    const delayedJobs: typeof jobs = {
      ...jobs,
      failStaleRunning: (error: string) =>
        new Promise((resolve) => setTimeout(() => resolve(jobs.failStaleRunning(error)), 30)),
    };

    const worker = createFacilityJobWorker({
      jobs: delayedJobs, runRebuild: async () => ({ written: 0 }), runProjection: async () => {},
      intervalMs: 10_000, logger: fakeLogger(),
    });
    await worker.stop();

    expect((await jobs.latest('facility-map-rebuild'))?.status).toBe('failed');
  });
});
