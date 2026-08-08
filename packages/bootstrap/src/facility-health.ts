import type { Kysely } from 'kysely';
import type { InternalSchema, FacilityJobStore } from '@openldr/db';

export type FacilityDimensionState = 'current' | 'updating' | 'failed' | 'stale';

export interface FacilityHealth {
  reportDimension: { state: FacilityDimensionState; lastSuccessAt: string | null; rows: number | null; error: string | null };
  projection: { failedCount: number };
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
  const failedProjections = await deps.jobs.countFailed('registry-projection');

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
    },
    projection: { failedCount: failedProjections },
  };
}
