import type { ReconcileDeps } from './facility-reconcile';
import { publishFacilityMap as realPublishFacilityMap, projectRegistryRows as realProjectRegistryRows } from './facility-reconcile';

/**
 * The two functions `createFacilityJobRunners` calls, taken as dependencies (rather than imported
 * directly) so a unit test can inject fakes and assert on how they were called. Before this
 * extraction, the equivalent closures were inline in `packages/bootstrap/src/index.ts` and opaque to
 * any test — a review found that flipping `apply: true` to `apply: false`, or making the
 * missing-facility branch throw, left the existing suite at 13/13 green either way (see
 * `.superpowers/sdd/task-4-report.md`).
 */
export interface FacilityJobRunnerDeps extends ReconcileDeps {
  publishFacilityMap: typeof realPublishFacilityMap;
  projectRegistryRows: typeof realProjectRegistryRows;
}

export interface FacilityJobRunners {
  runRebuild(): Promise<{ written: number }>;
  runProjection(registryId: string): Promise<void>;
}

/**
 * Builds the `runRebuild`/`runProjection` pair `createFacilityJobWorker` drains jobs into, bound to
 * the SAME `ReconcileDeps` shape the facilities routes/CLI already build (see `reconcileDeps(ctx)` in
 * `apps/server/src/facilities-routes.ts`) rather than a second one.
 */
export function createFacilityJobRunners(deps: FacilityJobRunnerDeps): FacilityJobRunners {
  const reconcileDeps: ReconcileDeps = { internalDb: deps.internalDb, externalDb: deps.externalDb, admin: deps.admin };
  return {
    async runRebuild() {
      // `apply: true` is load-bearing: without it `publishFacilityMap` is a dry run that computes the
      // resolution but writes nothing to `facility_map`, so a job would claim, "run", and finish
      // `done` while the report-facing dimension stayed exactly as stale as before — the health chip
      // going green while nothing happened, which this whole workstream exists to eliminate.
      const r = await deps.publishFacilityMap(reconcileDeps, { apply: true });
      return { written: r.written };
    },
    async runProjection(registryId) {
      // The row may have been deleted between enqueue and run (e.g. a facility deleted right after a
      // create/update enqueued its projection job) — nothing left to project, so this resolves and
      // the job completes rather than fails. Treating that as an error would burn the job's retry
      // budget and surface a benign race as a permanent red chip.
      const row = await deps.internalDb.selectFrom('facility_registry')
        .select(['id', 'name']).where('id', '=', registryId).executeTakeFirst();
      if (row) await deps.projectRegistryRows(reconcileDeps, [row]);
    },
  };
}
