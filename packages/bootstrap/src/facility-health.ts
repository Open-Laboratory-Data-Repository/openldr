import type { Kysely } from 'kysely';
import type { InternalSchema, FacilityJobStore } from '@openldr/db';

export type FacilityDimensionState = 'current' | 'updating' | 'failed' | 'stale';

export interface FacilityHealth {
  reportDimension: {
    state: FacilityDimensionState; lastSuccessAt: string | null; rows: number | null; error: string | null;
    /** Task 11: the id of the failed `facility-map-rebuild` job — populated under the same condition
     *  as `error` (only when the LATEST attempt is the one that failed), so a client (the Facilities
     *  chip, the CLI) has something to pass to `POST /api/facilities/jobs/:id/retry` without a second
     *  request. Null whenever `error` is null, for the same reason. */
    jobId: string | null;
  };
  projection: {
    /** Always `failed.length` — derived, never counted separately, so the number on the chip and the
     *  rows behind it can never disagree. */
    failedCount: number;
    /** The failed `registry-projection` jobs themselves, not just a tally. A bare count named no job
     *  id, and `POST /api/facilities/jobs/:id/retry` needs one — so a failed PROJECTION was
     *  retryable by nobody: not from the page, not from the CLI, not over HTTP. `registryId` is the
     *  facility that needs repairing (a projection job repairs exactly one); `lastError` is why it
     *  could not be.
     *
     *  ⚠ These are `listFailed`'s rows, so they self-clear when a LATER job for the same facility
     *  supersedes them — but NOT when a later inline projection succeeds, because a successful
     *  inline projection writes no job row for anything to observe. See `listFailed`'s doc comment
     *  in packages/db/src/facility-job-store.ts. */
    failed: { id: string; registryId: string | null; lastError: string | null }[];
  };
}

/**
 * Resolve what the Facilities chip shows.
 *
 * "The last mutation" is max() over `facility_registry.updated_at` and `term_mappings.updated_at` —
 * the two tables whose contents determine what a rebuild would produce. Both already carry
 * `updated_at`, so this needs no new bookkeeping and cannot drift from the thing it describes.
 */
export async function facilityHealth(deps: { internalDb: Kysely<InternalSchema>; jobs: FacilityJobStore }): Promise<FacilityHealth> {
  const pending = await deps.jobs.listUnresolved();
  const latest = await deps.jobs.latest('facility-map-rebuild');
  const failedProjections = await deps.jobs.listFailed('registry-projection');

  const lastRegistry = await deps.internalDb.selectFrom('facility_registry')
    .select((eb) => eb.fn.max('updated_at').as('t')).executeTakeFirst();
  const lastMapping = await deps.internalDb.selectFrom('term_mappings')
    .select((eb) => eb.fn.max('updated_at').as('t')).executeTakeFirst();
  const lastMutation = [lastRegistry?.t, lastMapping?.t]
    .filter((d): d is Date => d != null)
    .reduce<Date | null>((m, d) => (m == null || d > m ? d : m), null);

  // ⛔ The last SUCCESSFUL rebuild, queried independently of `latest`. Deriving it as
  // `latest?.status === 'done' ? latest : null` would blank `lastSuccessAt` and `rows` the moment a
  // retry fails — losing "last known good" exactly when a Failed chip most needs to show it.
  const successRow = await deps.internalDb.selectFrom('facility_jobs').selectAll()
    .where('kind', '=', 'facility-map-rebuild').where('status', '=', 'done')
    .orderBy('finished_at', 'desc').limit(1).executeTakeFirst();
  const lastSuccess = successRow
    ? { finishedAt: new Date(successRow.finished_at as Date).toISOString(), resultCount: successRow.result_count }
    : null;

  let state: FacilityDimensionState;
  if (pending.some((j) => j.kind === 'facility-map-rebuild')) state = 'updating';
  else if (latest?.status === 'failed') state = 'failed';
  else if (lastSuccess && (!lastMutation || new Date(lastSuccess.finishedAt) >= lastMutation)) state = 'current';
  else state = 'stale';

  return {
    reportDimension: {
      state,
      // Populated even when `state === 'failed'` — see the query above.
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      rows: lastSuccess?.resultCount == null ? null : Number(lastSuccess.resultCount),
      error: latest?.status === 'failed' ? latest.lastError : null,
      jobId: latest?.status === 'failed' ? latest.id : null,
    },
    projection: {
      failedCount: failedProjections.length,
      failed: failedProjections.map((j) => ({ id: j.id, registryId: j.registryId, lastError: j.lastError })),
    },
  };
}
