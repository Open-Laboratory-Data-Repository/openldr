import { describe, it, expect, vi } from 'vitest';
import { sql } from 'kysely';
import { createFacilityJobStore, FACILITY_REGISTRY_SYSTEM, observedSystemForFeed } from '@openldr/db';
import { SEED_QUERIES } from '@openldr/reporting';
import { makeReconcileDeps, seedRegistry, seedPerformers } from './test-support/facility-reconcile-fixture';
import { createFacilityJobRunners } from './facility-job-runners';
import { createFacilityJobWorker } from './facility-job-worker';
import { publishFacilityMap, projectRegistryRows, type ReconcileDeps } from './facility-reconcile';

/**
 * The SQL a SEEDED report actually runs, taken from `@openldr/reporting`'s `SEED_QUERIES` at
 * runtime rather than transcribed into this file.
 *
 * ⛔ This is the whole point of the test. Asserting against a join hand-written here would prove
 * nothing: it could keep passing while the shipped query — the one a real report executes — still
 * showed the raw performer string. Reading `SEED_QUERIES` means the assertion below cannot drift
 * from what ships, because there is only one copy of the text.
 *
 * `q-facilities` is the "Facilities (options)" query. Its `postgres` variant is the one exercised
 * here because the fixture's warehouse is pg-mem; the `mssql`/`mysql` variants of this query are
 * byte-identical to it (see the seed's own comment: "No postgres-isms at all — all three dialects
 * are byte-identical") — which the test "the seeded query it asserts through is the facility_map
 * join the audit named" at the end of this file re-checks rather than assumes. Its shape is exactly the join named in the audit:
 *   left join facility_map fm
 *     on fm.source_system = coalesce(dr.source_system, '') and fm.source_code = dr.performer
 * selecting `coalesce(fm.name, dr.performer_display, dr.performer)` as the label.
 */
const FACILITY_OPTIONS_QUERY = SEED_QUERIES.find((q) => q.id === 'q-facilities')!;
const FACILITY_OPTIONS_SQL = FACILITY_OPTIONS_QUERY.sql.postgres;

/**
 * Runs the seeded query above against the warehouse and returns the LABEL it produced for one
 * observed performer code — i.e. what a report bound to that query would display for that facility.
 * `null` when the query returned no row for the code at all (which would mean the test's own
 * arrangement, not the dimension, is broken).
 */
async function facilityNameFromReportQuery(deps: ReconcileDeps, code: string): Promise<string | null> {
  const res = await sql.raw<{ value: string; label: string }>(FACILITY_OPTIONS_SQL).execute(deps.externalDb);
  return res.rows.find((r) => r.value === code)?.label ?? null;
}

/** Silences the worker's own logging; `error` is captured so a swallowed tick failure can be shown
 *  in a test failure rather than mistaken for "the dimension just didn't change". */
const captureLogger = () => ({ info: vi.fn(), error: vi.fn() });

interface Harness {
  deps: ReconcileDeps;
  jobs: ReturnType<typeof createFacilityJobStore>;
  worker: ReturnType<typeof createFacilityJobWorker>;
  logger: ReturnType<typeof captureLogger>;
}

/**
 * The REAL chain, end to end: the real job store over a migrated internal db, the real runners
 * bound to the real `publishFacilityMap`/`projectRegistryRows`, and the real worker.
 *
 * ⛔ No fakes anywhere in the rebuild path. Injecting something like
 * `runRebuild: async () => ({ written: 88 })` would make every assertion below meaningless — the
 * job would go green while `facility_map` never changed, which is precisely the class of failure
 * this test exists to rule out.
 */
async function setupFacilityFixture(): Promise<Harness> {
  const deps = await makeReconcileDeps();
  const jobs = createFacilityJobStore(deps.internalDb);
  const runners = createFacilityJobRunners({ ...deps, publishFacilityMap, projectRegistryRows });
  const logger = captureLogger();
  const worker = createFacilityJobWorker({
    jobs,
    runRebuild: runners.runRebuild,
    runProjection: runners.runProjection,
    // Long enough that the worker's own setInterval never fires during the test; every run below is
    // an explicit `tickOnce()`, so the sequence under test is exactly the one written here.
    intervalMs: 10_000,
    logger,
  });
  return { deps, jobs, worker, logger };
}

/**
 * Drains one job and asserts it finished `done`.
 *
 * The worker deliberately catches everything a runner throws and logs it (so one bad job cannot
 * kill the loop). That containment would otherwise turn a broken rebuild into a silent no-op here,
 * and the final assertion would fail with a misleading "expected 'BALAB' to be 'Alpha Clinic'"
 * instead of the real cause. Asserting the job's terminal state surfaces the cause at the tick that
 * produced it.
 */
async function tickAndExpectDone(h: Harness): Promise<void> {
  await h.worker.tickOnce();
  const latest = await h.jobs.latest('facility-map-rebuild');
  expect({ status: latest?.status, lastError: latest?.lastError }).toEqual({ status: 'done', lastError: null });
}

describe('facility durable updates — a saved mapping reaches a report with no manual publish', () => {
  // ⛔ PINNED REGRESSION TEST. This passes as of Tasks 1–7; that is the intended outcome and NOT a
  // reason to delete it as redundant. Its value is forward-looking: it is the audit's own acceptance
  // criterion (FAC-P0-01 — "the Observed tab says mapped while the report keeps using the raw
  // performer string until someone finds the hidden Publish menu item"), and it fails loudly if any
  // future change reintroduces that manual step — by dropping the enqueue, by making the rebuild a
  // dry run, or by changing what the seeded report query joins against.
  //
  // Its discrimination was demonstrated, not assumed: with `runRebuild` changed to pass
  // `apply: false` the final assertion fails with `expected 'BALAB' to be 'Alpha Clinic'`, and with
  // the post-mapping enqueue removed it fails the same way. See `.superpowers/sdd/task-8-report.md`.
  it('saving a mapping reaches an actual report query with NO manual publish anywhere', async () => {
    const h = await setupFacilityFixture();
    const { deps, jobs } = h;

    // ── Arrange: a registry facility exists, and an observed performer string is in the warehouse.
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha Clinic', localCode: 'L-1' });
    // `seedPerformers` defaults to the `webhook-ingest` feed, so the observed code resolves under
    // `observedSystemForFeed('webhook-ingest')` — the same system the mapping is authored against
    // below.
    await seedPerformers(deps, [['BALAB', 6]]);

    // Stands in for the enqueue the CREATE-facility route performs (`apps/server/src/
    // facilities-routes.ts`, Task 5) — that route is not callable from this package, and Task 5's
    // own tests pin that it enqueues. ⚠ Not byte-for-byte the route's call: the route also passes
    // `requestedBy` (the actor id), which nothing downstream of the queue reads, so its absence
    // changes neither the job's identity nor what the worker does with it. Enqueuing it here means the tick below performs a REAL
    // rebuild, so the "raw string" assertion that follows is a statement about a dimension that was
    // genuinely built, not about one that was never built at all.
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    await tickAndExpectDone(h);

    // Before the mapping: the dimension has a row for this performer, but nothing resolved, so its
    // `name` is null and the report's `coalesce` falls through to the raw performer string.
    const beforeRow = await deps.externalDb
      .selectFrom('facility_map').select(['name', 'registry_id'])
      .where('source_code', '=', 'BALAB').executeTakeFirst();
    expect(beforeRow).toBeDefined();
    expect({ name: beforeRow?.name ?? null, registryId: beforeRow?.registry_id ?? null })
      .toEqual({ name: null, registryId: null });
    // ⛔ Load-bearing: without this the final assertion could pass vacuously (e.g. if the fixture
    // had somehow arranged 'Alpha Clinic' from the start, or if the query never looked at
    // facility_map at all).
    expect(await facilityNameFromReportQuery(deps, 'BALAB')).toBe('BALAB');

    // ── Act: the operator maps the observed code to the facility. NOTHING ELSE — no publish, no
    // scan. `saveExclusive` is the store method the real route calls for a facility target (see the
    // POST /api/terminology/terms/:system/:code/mappings handler in
    // `apps/server/src/terminology-admin-routes.ts`), not a raw INSERT into `term_mappings`, so this
    // write carries the same supersede-and-mirror behaviour production performs.
    await deps.admin.termMappings.saveExclusive({
      fromSystem: observedSystemForFeed('webhook-ingest'),
      fromCode: 'BALAB',
      toSystem: FACILITY_REGISTRY_SYSTEM,
      toCode: 'L-1',
      toDisplay: null,
      mapType: 'SAME-AS',
      isActive: true,
    });
    // The enqueue the MAPPING route performs immediately after the save (Task 6's, in
    // `apps/server/src/terminology-admin-routes.ts` — a different file from the create route above).
    // Written explicitly here for the same reason, and with the same `requestedBy` caveat: the route
    // is not callable from this package, and Task 6 pins that the route does enqueue. What this test is about is the rest of
    // the chain — WORKER → REBUILD → REPORT.
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    await tickAndExpectDone(h);

    // ── Assert: the report query — the shipped one — now shows the facility's registry name. No
    // operator ever opened a Publish menu.
    expect(await facilityNameFromReportQuery(deps, 'BALAB')).toBe('Alpha Clinic');

    await h.worker.stop();
  });

  // Guards the premise of the test above: it is only meaningful while `q-facilities` really is the
  // join the audit named. If someone rewrites the seeded query to resolve facilities some other way,
  // this fails and points at the assumption rather than letting the test above quietly assert
  // something else.
  it('the seeded query it asserts through is the facility_map join the audit named', () => {
    expect(FACILITY_OPTIONS_SQL).toContain(
      "left join facility_map fm on fm.source_system = coalesce(dr.source_system, '') and fm.source_code = dr.performer",
    );
    expect(FACILITY_OPTIONS_SQL).toContain('coalesce(fm.name, dr.performer_display, dr.performer)');
    // The other two dialects carry the same join, so the pg-mem run above speaks for all three.
    expect(FACILITY_OPTIONS_QUERY.sql.mssql).toBe(FACILITY_OPTIONS_SQL);
    expect(FACILITY_OPTIONS_QUERY.sql.mysql).toBe(FACILITY_OPTIONS_SQL);
  });
});
