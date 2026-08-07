import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityJobStore } from './facility-job-store';

const REBUILD = 'facility-map-rebuild' as const;

describe('createFacilityJobStore', () => {
  it('enqueues a job', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    const { job, coalesced } = await store.enqueue({ kind: REBUILD });
    expect(coalesced).toBe(false);
    expect(job).toMatchObject({ kind: REBUILD, status: 'queued', attempts: 0 });
  });

  it('COALESCES a second request while one is still queued', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const second = await store.enqueue({ kind: REBUILD });

    expect(second.coalesced).toBe(true);
    expect(await store.listUnresolved()).toHaveLength(1);
  });

  it('⛔ does NOT coalesce a request arriving while a rebuild is RUNNING', async () => {
    // The running build may already have read the data, so absorbing this request would silently
    // drop the change that caused it. This is the case an obvious implementation gets wrong.
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const claimed = await store.claimNext();
    expect(claimed?.status).toBe('running');

    const during = await store.enqueue({ kind: REBUILD });

    expect(during.coalesced).toBe(false);
    expect(await store.listUnresolved()).toHaveLength(2);
  });

  it('claimNext takes the oldest queued job exactly once', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const first = await store.claimNext();
    const second = await store.claimNext();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(first?.attempts).toBe(1);
  });

  it('finish records the result count and clears the row from unresolved', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const job = await store.claimNext();
    await store.finish(job!.id, 'done', { resultCount: 88 });

    expect(await store.listUnresolved()).toEqual([]);
    expect((await store.latest(REBUILD))?.resultCount).toBe(88);
  });

  it('failStaleRunning marks an orphaned running job failed so it becomes visible', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    await store.claimNext();

    expect(await store.failStaleRunning('server restarted')).toBe(1);

    const latest = await store.latest(REBUILD);
    expect(latest).toMatchObject({ status: 'failed', lastError: 'server restarted' });
  });

  it('retry re-queues a failed job and resets attempts so a fixed cause is not locked out', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const job = await store.claimNext();
    await store.finish(job!.id, 'failed', { error: 'warehouse unreachable' });

    await store.retry(job!.id);

    const latest = await store.latest(REBUILD);
    expect(latest).toMatchObject({ status: 'queued', attempts: 0, lastError: null });
  });

  it('⛔ retryPreservingAttempts re-queues WITHOUT clearing the budget the retry loop is bounded by', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const job = await store.claimNext();          // attempts -> 1
    await store.finish(job!.id, 'failed', { error: 'boom' });

    await store.retryPreservingAttempts(job!.id);

    const latest = await store.latest(REBUILD);
    expect(latest).toMatchObject({ status: 'queued', attempts: 1 });   // NOT reset to 0
  });

  it('countFailed reports failed projection retries', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: 'registry-projection', registryId: 'fac-1' });
    const job = await store.claimNext();
    await store.finish(job!.id, 'failed', { error: 'boom' });

    expect(await store.countFailed('registry-projection')).toBe(1);
  });
});
