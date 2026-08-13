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

  // Task 11: the Facilities chip's Retry action calls `POST /api/facilities/jobs/:id/retry`, which
  // needs the failed job's id — and until this, nothing under `apps/` could read one off `latest`
  // (facility-health.ts held it, but never returned it). Populated the same way `error` already is:
  // only when the LATEST attempt is the one that failed, mirroring that field exactly so the two
  // never disagree about which job they describe.
  it('carries the failed job\'s id so a client can retry it', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: REBUILD });
    const claimed = await deps.jobs.claimNext();
    await deps.jobs.finish(claimed!.id, 'failed', { error: 'warehouse unreachable' });

    expect((await facilityHealth(deps)).reportDimension.jobId).toBe(claimed!.id);
  });

  it('leaves jobId null when the dimension is not failed', async () => {
    const deps = await withCompletedRebuild();
    expect((await facilityHealth(deps)).reportDimension.jobId).toBeNull();
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
      id: 'fac-A', name: 'Alpha', facility_code: 'L-1', source: 'manual',
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

  // ⛔ A failed PROJECTION used to be retryable by NOBODY. `POST /api/facilities/jobs/:id/retry`
  // needs a job id, and this payload carried an id for the rebuild only — the projection side was a
  // bare count, so the page, the CLI and any HTTP client alike could see that N facilities were
  // broken and had no way to name, let alone repair, a single one of them.
  it('names each failed projection job, so every one of them can actually be retried', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: 'registry-projection', registryId: 'fac-A' });
    const a = await deps.jobs.claimNext();
    await deps.jobs.finish(a!.id, 'failed', { error: 'terminology store unreachable' });
    await deps.jobs.enqueue({ kind: 'registry-projection', registryId: 'fac-B' });
    const b = await deps.jobs.claimNext();
    await deps.jobs.finish(b!.id, 'failed', { error: 'code collision' });

    const { projection } = await facilityHealth(deps);

    // ⛔ Both, not one. Projection jobs coalesce PER FACILITY, so two failures are two rows and a
    // surface that reported only the first would leave the second permanently unrepairable.
    expect(projection.failedCount).toBe(2);
    expect(projection.failed).toEqual(expect.arrayContaining([
      { id: a!.id, registryId: 'fac-A', lastError: 'terminology store unreachable' },
      { id: b!.id, registryId: 'fac-B', lastError: 'code collision' },
    ]));
  });

  it('the count is derived from the rows, so the two can never disagree', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: 'registry-projection', registryId: 'fac-A' });
    const claimed = await deps.jobs.claimNext();
    await deps.jobs.finish(claimed!.id, 'failed', { error: 'boom' });

    const { projection } = await facilityHealth(deps);
    expect(projection.failedCount).toBe(projection.failed.length);
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
