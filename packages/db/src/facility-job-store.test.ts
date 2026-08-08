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

  it('latest breaks a requested_at tie by id, the opposite end to claimNext', async () => {
    // Same tie `claimNext` guards (requested_at defaults to TRANSACTION time, so rows enqueued in
    // one transaction share it) seen from the other end: claimNext takes the oldest/lowest id,
    // `latest` must take the newest/highest. Without the tiebreak pg-mem returns insertion order,
    // which is the OPPOSITE of id order here — so the two cannot agree by luck.
    const db = await makeMigratedDb();
    const store = createFacilityJobStore(db);
    const tie = new Date('2026-01-01T00:00:00Z');
    await db.insertInto('facility_jobs')
      .values({ id: 'fj_aaa', kind: REBUILD, status: 'done', attempts: 1, requested_at: tie, active_key: null })
      .execute();
    await db.insertInto('facility_jobs')
      .values({ id: 'fj_zzz', kind: REBUILD, status: 'failed', attempts: 1, last_error: 'boom', requested_at: tie, active_key: null })
      .execute();

    expect((await store.latest(REBUILD))?.id).toBe('fj_zzz');
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

  it('listFailed reports a failed projection retry, with the facility and error a repair needs', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: PROJECTION, registryId: 'fac-1' });
    const job = await store.claimNext();
    await store.finish(job!.id, 'failed', { error: 'boom' });

    const failed = await store.listFailed(PROJECTION);
    expect(failed).toHaveLength(1);
    // The id is what a Retry action has to pass; registryId is what names the facility to repair.
    expect(failed[0]).toMatchObject({ id: job!.id, registryId: 'fac-1', lastError: 'boom' });
  });

  it('⛔ listFailed drops a failed job a LATER job for the SAME facility has superseded', async () => {
    // The count this replaced was `count(*) where status = 'failed'`, so a facility that failed once
    // stayed on the Facilities page's warning forever — including after a LATER projection job for
    // that same facility succeeded. This is the ordinary path there: `retry` re-queues the SAME row,
    // but a subsequent edit whose inline projection fails again enqueues a NEW row (the old one is
    // terminal, so it no longer holds the identity), and that new row is what can succeed.
    //
    // `requested_at` is seeded EXPLICITLY rather than left to now(): supersession is decided on that
    // column alone, and two enqueues landing in the same millisecond would otherwise make this
    // assertion depend on clock resolution. fac-broken is present so the assertion cannot pass by
    // returning nothing at all.
    const db = await makeMigratedDb();
    const store = createFacilityJobStore(db);
    const at = (iso: string) => new Date(iso);
    await db.insertInto('facility_jobs').values([
      { id: 'fj_old_fail', kind: PROJECTION, status: 'failed', attempts: 5, registry_id: 'fac-repaired',
        last_error: 'boom', requested_at: at('2026-08-01T00:00:00Z'), active_key: null },
      { id: 'fj_new_done', kind: PROJECTION, status: 'done', attempts: 1, registry_id: 'fac-repaired',
        requested_at: at('2026-08-02T00:00:00Z'), active_key: null },
      { id: 'fj_broken', kind: PROJECTION, status: 'failed', attempts: 5, registry_id: 'fac-broken',
        last_error: 'still broken', requested_at: at('2026-08-01T00:00:00Z'), active_key: null },
    ] as never).execute();

    expect((await store.listFailed(PROJECTION)).map((j) => j.registryId)).toEqual(['fac-broken']);
  });

  it('listFailed keeps a failed job whose only sibling for that facility is OLDER', async () => {
    // The other side of the rule above: an EARLIER success must not suppress a LATER failure —
    // a facility that projected fine once and has since broken is exactly what needs reporting.
    const db = await makeMigratedDb();
    const store = createFacilityJobStore(db);
    await db.insertInto('facility_jobs').values([
      { id: 'fj_old_done', kind: PROJECTION, status: 'done', attempts: 1, registry_id: 'fac-A',
        requested_at: new Date('2026-08-01T00:00:00Z'), active_key: null },
      { id: 'fj_new_fail', kind: PROJECTION, status: 'failed', attempts: 5, registry_id: 'fac-A',
        last_error: 'boom', requested_at: new Date('2026-08-02T00:00:00Z'), active_key: null },
    ] as never).execute();

    expect((await store.listFailed(PROJECTION)).map((j) => j.id)).toEqual(['fj_new_fail']);
  });

  it('⛔ refuses to retry a RUNNING job rather than silently discarding the request', async () => {
    // Re-queueing a running row re-arms its `active_key` under a live run; that run's own finish()
    // then writes a terminal status, so the operator's retry evaporates with nothing saying so.
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const j1 = await store.claimNext();
    expect(j1?.status).toBe('running');

    expect(await store.retry(j1!.id)).toBe('running');
    await expect(store.retryPreservingAttempts(j1!.id)).resolves.toBeUndefined();

    // Untouched: still running, still on its first attempt, and its identity still free — so the
    // refusal has not disturbed the mid-run asymmetry either.
    expect(await store.latest(REBUILD)).toMatchObject({ status: 'running', attempts: 1 });
    expect((await store.enqueue({ kind: REBUILD })).coalesced).toBe(false);
  });

  it('⛔ finish releases the identity, so a later enqueue is not coalesced onto a dead job', async () => {
    // A TERMINAL row must never keep holding its `active_key`: `enqueue`'s pre-check only asks
    // whether the key exists, so every later request of that identity would report `coalesced: true`
    // onto a job that can never run again — permanently, silently. The state is seeded directly
    // because `retry`'s running-guard is now the other half of this defence and stops the store
    // producing it; the two are independent, and this pins THIS one.
    const db = await makeMigratedDb();
    const store = createFacilityJobStore(db);
    await db.insertInto('facility_jobs')
      .values({ id: 'fj_wedged', kind: REBUILD, status: 'running', attempts: 1, active_key: REBUILD })
      .execute();

    await store.finish('fj_wedged', 'done', { resultCount: 88 });

    const next = await store.enqueue({ kind: REBUILD });
    expect(next.coalesced).toBe(false);
    expect(next.job).toMatchObject({ status: 'queued' });
    expect(await store.listUnresolved()).toHaveLength(1);
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

    await expect(store.retry(j1!.id)).resolves.toBe('requeued');

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
