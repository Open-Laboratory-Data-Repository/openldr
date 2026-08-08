import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFacilityJobStore } from '@openldr/db';
import { facilityHealth } from './facility-health';

const REBUILD = 'facility-map-rebuild' as const;

/** Finish one rebuild successfully and return the deps the health function takes. */
async function withCompletedRebuild(rows = 88) {
  const internalDb = await makeMigratedDb();
  const jobs = createFacilityJobStore(internalDb);
  await jobs.enqueue({ kind: REBUILD });
  const claimed = await jobs.claimNext();
  await jobs.finish(claimed!.id, 'done', { resultCount: rows });
  return { internalDb, jobs };
}

describe('facilityHealth', () => {
  it('reports current when the last rebuild is newer than the last mutation', async () => {
    const deps = await withCompletedRebuild();
    const health = await facilityHealth(deps);
    expect(health.reportDimension).toMatchObject({ state: 'current', rows: 88, error: null });
    expect(health.reportDimension.lastSuccessAt).not.toBeNull();
  });

  it('reports updating while a job is queued', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: REBUILD });
    expect((await facilityHealth(deps)).reportDimension.state).toBe('updating');
  });

  it('reports updating while a job is running', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: REBUILD });
    await deps.jobs.claimNext();
    expect((await facilityHealth(deps)).reportDimension.state).toBe('updating');
  });

  it('reports failed with the error when the last attempt failed', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: REBUILD });
    const claimed = await deps.jobs.claimNext();
    await deps.jobs.finish(claimed!.id, 'failed', { error: 'warehouse unreachable' });

    expect((await facilityHealth(deps)).reportDimension).toMatchObject({
      state: 'failed', error: 'warehouse unreachable',
    });
  });

  it('⛔ keeps the last known good build time and row count while showing Failed', async () => {
    // A Failed chip that also blanks "last current at" tells the operator nothing about how stale
    // their reports actually are. Deriving lastSuccess from the LATEST job would do exactly that.
    const deps = await withCompletedRebuild(88);
    await deps.jobs.enqueue({ kind: REBUILD });
    const claimed = await deps.jobs.claimNext();
    await deps.jobs.finish(claimed!.id, 'failed', { error: 'warehouse unreachable' });

    const { reportDimension } = await facilityHealth(deps);
    expect(reportDimension.state).toBe('failed');
    expect(reportDimension.lastSuccessAt).not.toBeNull();
    expect(reportDimension.rows).toBe(88);
  });

  it('reports stale when a mutation is newer than the last success and no job is pending', async () => {
    // A safety net that should never appear in practice — every mutation site enqueues. It is
    // rendered because a state that cannot be displayed cannot be diagnosed.
    const deps = await withCompletedRebuild();
    await deps.internalDb.insertInto('facility_registry').values({
      id: 'fac-A', name: 'Alpha', local_code: 'L-1', source: 'manual',
      updated_at: sql`now() + interval '1 hour'`,
    } as never).execute();

    expect((await facilityHealth(deps)).reportDimension.state).toBe('stale');
  });

  it('counts failed projection retries separately from the dimension state', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: 'registry-projection', registryId: 'fac-A' });
    const claimed = await deps.jobs.claimNext();
    await deps.jobs.finish(claimed!.id, 'failed', { error: 'boom' });

    const health = await facilityHealth(deps);
    expect(health.projection.failedCount).toBe(1);
    // A failed PROJECTION must not make the DIMENSION read as failed — they are separate signals,
    // and conflating them would tell an operator their reports are stale when they are not.
    expect(health.reportDimension.state).toBe('current');
  });

  it('⛔ a pending projection must not make the dimension read updating', async () => {
    // Pins the same separation as the test above, on the OTHER side: `withCompletedRebuild` leaves
    // no `facility-map-rebuild` pending, so the only job in flight is a `registry-projection`. If the
    // state check were kind-blind (any pending job ⇒ 'updating'), this would wrongly tell an operator
    // their report DIMENSION is mid-rebuild when only one facility's projection is running.
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: 'registry-projection', registryId: 'fac-A' });

    expect((await facilityHealth(deps)).reportDimension.state).toBe('current');
  });
});
