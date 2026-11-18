import { describe, it, expect, vi } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFacilityJobStore, createJobInterruptionStore } from '@openldr/db';
import { sql } from 'kysely';
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

  it('takes back a job whose heartbeat stopped: requeued, run, and the cut recorded as a restart', async () => {
    const db = await makeMigratedDb();
    const jobs = createFacilityJobStore(db);
    const store = createJobInterruptionStore(db);
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    const job = (await jobs.claimNext())!;      // a process killed mid-run
    await sql`update facility_jobs set heartbeat_at = now() - interval '10 minutes' where id = ${job.id}`.execute(db);

    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => ({ written: 3 }), runProjection: async () => {},
      interruptions: { store, now: () => new Date() }, processStartedAt: new Date(Date.now() - 60_000),
      intervalMs: 10_000, logger: fakeLogger(),
    });
    await worker.tickOnce();
    await worker.stop();

    expect(await jobs.latest('facility-map-rebuild')).toMatchObject({ status: 'done', resultCount: 3 });
    expect((await store.listFor('facility-job', [job.id])).get(job.id)).toEqual([
      expect.objectContaining({ cause: 'server-restart', resumedBy: 'self' }),
    ]);
  });

  it('leaves a running job with a live heartbeat alone', async () => {
    const db = await makeMigratedDb();
    const jobs = createFacilityJobStore(db);
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    await jobs.claimNext();
    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => ({ written: 0 }), runProjection: async () => {},
      interruptions: { store: createJobInterruptionStore(db), now: () => new Date() },
      intervalMs: 10_000, logger: fakeLogger(),
    });
    await worker.tickOnce();
    await worker.stop();
    expect((await jobs.latest('facility-map-rebuild'))?.status).toBe('running');
  });
});

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

    // The server's shape is a real worker, and it too leaves a job with a live heartbeat running:
    // only a job silent for STALE_JOB_MS is taken back (design 2026-11-18-interrupted-jobs).
    const serving = createFacilityJobWorkerIfEnabled(true, deps);
    expect(serving).not.toBeNull();
    await serving!.tickOnce();
    await serving!.stop();
    expect((await jobs.latest('facility-map-rebuild'))?.status).toBe('running');
  });
});
