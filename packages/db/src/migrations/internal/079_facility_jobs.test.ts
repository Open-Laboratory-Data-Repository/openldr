import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

// `makeMigratedDb()` applies EVERY registered migration, including THIS ONE, before the test body
// runs (see test-helpers.ts and 077's test for the same note). 079 only CREATEs (no backfill to
// observe mid-migration, unlike 077), so there is nothing gained by isolating it the way 077 did --
// these tests just observe the table `makeMigratedDb()` already leaves behind.
describe('079 facility_jobs', () => {
  it('creates the table and accepts a queued job', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_jobs').values({
      id: 'fj1', kind: 'facility-map-rebuild', status: 'queued', attempts: 0, active_key: 'facility-map-rebuild',
    } as never).execute();

    const rows = await db.selectFrom('facility_jobs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'facility-map-rebuild', status: 'queued', attempts: 0 });
  });

  it('⛔ allows only ONE row per active_key — this is what makes enqueue coalesce', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_jobs').values({
      id: 'fj1', kind: 'facility-map-rebuild', status: 'queued', attempts: 0, active_key: 'facility-map-rebuild',
    } as never).execute();

    await expect(db.insertInto('facility_jobs').values({
      id: 'fj2', kind: 'facility-map-rebuild', status: 'queued', attempts: 0, active_key: 'facility-map-rebuild',
    } as never).execute()).rejects.toThrow();
  });

  it('⛔ allows MANY rows with a NULL active_key — this is what lets a job be enqueued while another RUNS', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_jobs').values([
      { id: 'fj1', kind: 'facility-map-rebuild', status: 'running', attempts: 1, active_key: null },
      { id: 'fj2', kind: 'facility-map-rebuild', status: 'done', attempts: 1, active_key: null },
    ] as never).execute();

    expect(await db.selectFrom('facility_jobs').selectAll().execute()).toHaveLength(2);
  });

  it('finds a row by active_key after its status leaves "queued" — proves the index is NOT partial', async () => {
    // Precedent: 061_terminology_ingest_jobs.ts:21-32 documents a real pg-mem planner bug — once a
    // row's status transitions out of a `WHERE status = 'queued'` partial predicate, pg-mem excludes
    // that row from ANY later query filtering on the indexed column, even a query with no status
    // filter. This test reproduces exactly that transition: seed a row with `active_key` set and
    // `status: 'queued'`, move its status to 'running' while leaving `active_key` set (real app code
    // clears `active_key` on this same transition via `claimNext`, per the migration's own comment;
    // this test deliberately does not, so it can still filter on `active_key` afterwards), then query
    // filtering on `active_key` alone.
    //
    // What this proves: the index on `active_key` is a plain (non-partial) index. Under a
    // `WHERE status = 'queued'` partial index, pg-mem's planner would drop this row from the result
    // once status is 'running', and the assertion below would fail.
    // What this does NOT prove: the migration's uniqueness guarantee (covered by the two tests
    // above), or anything about real Postgres — a partial index behaves correctly there, so this
    // test's discriminating power comes entirely from the pg-mem quirk 061 also relies on.
    const db = await makeMigratedDb();
    await db.insertInto('facility_jobs').values({
      id: 'fj1', kind: 'facility-map-rebuild', status: 'queued', attempts: 0, active_key: 'facility-map-rebuild',
    } as never).execute();

    await db.updateTable('facility_jobs').set({ status: 'running' } as never)
      .where('id', '=', 'fj1').execute();

    const rows = await db.selectFrom('facility_jobs').selectAll()
      .where('active_key', '=', 'facility-map-rebuild').execute();
    expect(rows).toHaveLength(1);
  });
});
