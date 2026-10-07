import { describe, it, expect, vi } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFacilityJobStore } from '@openldr/db';
import { createFacilityJobWorker, createFacilityJobWorkerIfEnabled } from './facility-job-worker';

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

// ── 2026-10-07: `openldr market install` lost its DB connection mid-job ─────────────────────────
//
// The CLI's own worker claimed the boot rebuild, then `close()` stopped the worker and destroyed the
// DB while the rebuild was still running. `finish()` threw "driver has already been destroyed" and
// the row stayed `running` for good, so the Facilities chip read "Updating" forever.
describe('createFacilityJobWorker — shutdown and ownership', () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
  };

  it('stop() waits for an in-flight job to finish before it resolves', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    const order: string[] = [];
    const recordingJobs: typeof jobs = {
      ...jobs,
      finish: async (...args) => { await jobs.finish(...args); order.push('finish'); },
    };
    const gate = deferred();
    const started = deferred();
    const worker = createFacilityJobWorker({
      jobs: recordingJobs,
      runRebuild: async () => { started.resolve(); await gate.promise; return { written: 7 }; },
      runProjection: async () => {}, intervalMs: 10_000, logger: fakeLogger(),
    });

    const tick = worker.tickOnce();
    await started.promise;                       // the rebuild is now in flight
    const stopping = worker.stop().then(() => { order.push('stopped'); });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual([]);                   // stop() has NOT returned under a live job

    gate.resolve();
    await stopping;
    await tick;

    expect(order).toEqual(['finish', 'stopped']);
    expect(await jobs.latest('facility-map-rebuild')).toMatchObject({ status: 'done', resultCount: 7 });
  });

  it('a tick after stop() claims nothing, so shutdown cannot start a new job', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    const runRebuild = vi.fn(async () => ({ written: 0 }));
    const worker = createFacilityJobWorker({
      jobs, runRebuild, runProjection: async () => {}, intervalMs: 10_000, logger: fakeLogger(),
    });

    await worker.stop();
    await worker.tickOnce();

    expect(runRebuild).not.toHaveBeenCalled();
    expect((await jobs.latest('facility-map-rebuild'))?.status).toBe('queued');
  });

  it('a CLI-shaped construction (opt-in withheld) builds no worker and cannot fail a live job', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    await jobs.claimNext();                      // the API server's live rebuild
    const deps = {
      jobs, runRebuild: async () => ({ written: 0 }), runProjection: async () => {},
      intervalMs: 10_000, logger: fakeLogger(),
    };

    expect(createFacilityJobWorkerIfEnabled(false, deps)).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect((await jobs.latest('facility-map-rebuild'))?.status).toBe('running');

    // The server's shape over the SAME row does sweep it, so the assertion above is not vacuous.
    const serving = createFacilityJobWorkerIfEnabled(true, deps);
    expect(serving).not.toBeNull();
    await serving!.stop();
    expect((await jobs.latest('facility-map-rebuild'))?.status).toBe('failed');
  });
});
