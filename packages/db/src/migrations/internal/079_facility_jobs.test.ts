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
});
