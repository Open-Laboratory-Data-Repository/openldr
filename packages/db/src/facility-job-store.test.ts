import { describe, it, expect, vi } from 'vitest';
import { makeMigratedDb, makeMigratedDbWithMem } from './migrations/internal/test-helpers';
import { createFacilityJobStore } from './facility-job-store';

// Lets one test force an id COLLISION, which is the only way to make the store's insert raise a
// unique violation that is not an `active_key` conflict. Real `randomUUID` everywhere else.
const uuid = vi.hoisted(() => ({ fixed: null as string | null }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: () => uuid.fixed ?? actual.randomUUID() };
});

const REBUILD = 'facility-map-rebuild' as const;
const PROJECTION = 'registry-projection' as const;

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

  it('claimNext advances to the next candidate when a concurrent claimer wins the guarded UPDATE first', async () => {
    // Stages the race the guarded UPDATE exists for: something else takes the head-of-queue row
    // between claimNext's own SELECT and its own UPDATE, so that UPDATE matches 0 rows. claimNext
    // must advance to the next candidate rather than reporting the queue idle.
    const { db, mem } = await makeMigratedDbWithMem();
    const store = createFacilityJobStore(db);
    await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' });
    await store.enqueue({ kind: PROJECTION, registryId: 'fac-B' });

    // Same ordering claimNext itself queries by, so this really is "the row it will try first".
    const head = await db.selectFrom('facility_jobs').select('id')
      .where('status', '=', 'queued')
      .orderBy('requested_at', 'asc').orderBy('id', 'asc')
      .limit(1).executeTakeFirstOrThrow();

    let stolen = false;
    mem.public.interceptQueries((sqlText: string) => {
      if (!stolen && /update facility_jobs/i.test(sqlText) && sqlText.includes(head.id)) {
        stolen = true; // guard: the steal query below is itself an UPDATE matching head.id
        mem.public.none(`update facility_jobs set status='running', active_key=null where id='${head.id}'`);
      }
      return null; // fall through to the real query, which the steal above now makes match 0 rows
    });

    const claimed = await store.claimNext();

    expect(claimed).not.toBeNull();
    expect(claimed!.id).not.toBe(head.id);
    expect(claimed!.status).toBe('running');
  });

  it('claimNext breaks a requested_at tie by id, not by insertion order', async () => {
    // Two rows with a LITERAL identical requested_at (not just close). Inserted in the OPPOSITE of
    // id order, so if the `id` tiebreaker were not applied, pg-mem's default scan order (insertion
    // order, here) would return 'fj_bbb' first instead -- the two orders cannot agree by luck.
    const db = await makeMigratedDb();
    const store = createFacilityJobStore(db);
    const tie = new Date('2026-01-01T00:00:00Z');
    await db.insertInto('facility_jobs')
      .values({ id: 'fj_bbb', kind: REBUILD, status: 'queued', attempts: 0, requested_at: tie, active_key: null })
      .execute();
    await db.insertInto('facility_jobs')
      .values({ id: 'fj_aaa', kind: REBUILD, status: 'queued', attempts: 0, requested_at: tie, active_key: null })
      .execute();

    const claimed = await store.claimNext();

    expect(claimed?.id).toBe('fj_aaa');
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

  it('⛔ does NOT coalesce projection repairs for DIFFERENT facilities', async () => {
    // A projection job repairs ONE named facility. Coalescing on the kind alone would mean 200
    // facilities failing during one import produce exactly one repair, and the other 199 stay
    // unmapped while the queue drains and the health chip goes green.
    const store = createFacilityJobStore(await makeMigratedDb());
    const a = await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' });
    const b = await store.enqueue({ kind: PROJECTION, registryId: 'fac-B' });

    expect(a.coalesced).toBe(false);
    expect(b.coalesced).toBe(false);
    expect((await store.listUnresolved()).map((j) => j.registryId).sort()).toEqual(['fac-A', 'fac-B']);
  });

  it('COALESCES a second projection repair for the SAME facility', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' });
    const second = await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' });

    expect(second.coalesced).toBe(true);
    expect(await store.listUnresolved()).toHaveLength(1);
  });

  it('a rebuild still coalesces on its KIND alone, ignoring any registryId', async () => {
    // A rebuild rewrites the whole dimension, so every rebuild request is interchangeable — that is
    // what makes a 14 000-row CSV import enqueue one job rather than 14 000.
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD, registryId: 'fac-A' });
    const second = await store.enqueue({ kind: REBUILD, registryId: 'fac-B' });

    expect(second.coalesced).toBe(true);
    expect(await store.listUnresolved()).toHaveLength(1);
  });

  it('⛔ retryPreservingAttempts does not throw when the identity is already held by a queued job', async () => {
    // Exactly the state the asymmetry creates: J1 running, J2 queued holding the active_key, J1 then
    // fails. Re-arming the key unconditionally raises 23505 inside the worker's retry loop.
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const j1 = await store.claimNext();
    expect((await store.enqueue({ kind: REBUILD })).coalesced).toBe(false);
    await store.finish(j1!.id, 'failed', { error: 'boom' });

    await expect(store.retryPreservingAttempts(j1!.id)).resolves.toBeUndefined();

    const unresolved = await store.listUnresolved();
    expect(unresolved).toHaveLength(2);
    expect(unresolved.find((j) => j.id === j1!.id)).toMatchObject({ status: 'queued', attempts: 1 });
  });

  it('⛔ retry does not throw when the identity is already held by a queued job', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' });
    const j1 = await store.claimNext();
    expect((await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' })).coalesced).toBe(false);
    await store.finish(j1!.id, 'failed', { error: 'boom' });

    await expect(store.retry(j1!.id)).resolves.toBeUndefined();

    const unresolved = await store.listUnresolved();
    expect(unresolved).toHaveLength(2);
    expect(unresolved.find((j) => j.id === j1!.id)).toMatchObject({ status: 'queued', attempts: 0, lastError: null });
  });

  it('⛔ a unique violation that is NOT an active_key conflict is not reported as a coalesce', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    uuid.fixed = '11111111-1111-4111-8111-111111111111';
    try {
      expect((await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' })).coalesced).toBe(false);
      // Same generated id, DIFFERENT identity: this violates the PRIMARY KEY, not `active_key`.
      // Reporting `coalesced: true` would tell the caller fac-B's repair is pending when it was
      // dropped — the exact silent-drop this workstream exists to remove.
      await expect(store.enqueue({ kind: PROJECTION, registryId: 'fac-B' })).rejects.toThrow();
    } finally {
      uuid.fixed = null;
    }
    expect((await store.listUnresolved()).map((j) => j.registryId)).toEqual(['fac-A']);
  });
});
