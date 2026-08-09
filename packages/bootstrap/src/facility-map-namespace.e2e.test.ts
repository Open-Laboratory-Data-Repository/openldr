import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { FACILITY_REGISTRY_SYSTEM, observedSystemForFeed } from '@openldr/db';
import { SEED_QUERIES } from '@openldr/reporting';
import { makeReconcileDeps, seedRegistry, seedPerformers, seedMapping } from './test-support/facility-reconcile-fixture';
import { publishFacilityMap, type ReconcileDeps } from './facility-reconcile';

/**
 * The SQL two seeded reports actually run, read from `SEED_QUERIES` at runtime rather than
 * transcribed into this file — the proven pattern from `facility-durable-updates.e2e.test.ts`'s
 * `FACILITY_OPTIONS_SQL`/`facilityNameFromReportQuery`.
 *
 * ⛔ A join hand-copied here would prove nothing: it could stay green while the shipped query — the
 * one a real report executes — still matched on the feed alone. There is exactly one copy of each
 * query's text.
 */
const FACILITY_OPTIONS_SQL = SEED_QUERIES.find((q) => q.id === 'q-facilities')!.sql.postgres;
const CLINICAL_HEADER_SQL = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;

/**
 * Coverage boundary for the two queries' `performer_system` clause (FAC-P0-07), stated honestly:
 *
 * - `q-clinical-micro-header` (via `FACILITY_CTES_SQL`/`performingLabForSpecimen`) IS covered live,
 *   by direction A below: it has no aggregation after the `facility_map` join, so two rows sharing a
 *   code but resolving through different namespaces produce two different observable results.
 *
 * - `q-facilities` (via `FACILITY_OPTIONS_SQL`/`labelFor`) is NOT covered live by any test in this
 *   file. Its only coverage is a text assertion over the query's own SQL string, in
 *   `packages/reporting/src/seed/report-seeds.test.ts` (`'matches the observed coding namespace too,
 *   not the feed alone (FAC-P0-07)'`, ~line 465).
 *
 * That's not an oversight — it's structural, and measured, not assumed: deleting the
 * `performer_system` clause from `q-facilities`' postgres SQL and running this file's three tests
 * unmodified leaves all three green (verified directly while writing this comment, then the clause
 * was restored). The reason is `q-facilities`' own shape: it does `group by dr.performer` and
 * selects `min(coalesce(fm.name, dr.performer_display, dr.performer)) as label`. When two
 * `facility_map` rows share a `(source_system, source_code)` pair and differ only in
 * `performer_system`, a `diagnostic_reports` row joins BOTH dimension rows regardless of whether the
 * namespace clause is present — the clause changes which row(s) match, but `group by` + `min()`
 * folds whatever set of labels results down to the same single value either way, and there is one
 * output row per distinct `dr.performer` regardless. The query's own aggregation makes the
 * difference unobservable through its result set, so no live test against this query's actual output
 * can distinguish "namespace clause present" from "namespace clause absent" for that fan-out case.
 * A live test here would therefore assert nothing beyond what the text assertion already pins.
 */

/**
 * What the Facilities dropdown (`q-facilities`) shows for one observed performer code.
 *
 * ⚠ Only good for telling apart codes that DIFFER — `q-facilities` does `group by dr.performer`,
 * so two rows sharing one code always fold into a SINGLE label (`min(...)` across them) no matter
 * how the join resolves each one individually. See direction A below for why that rules this helper
 * out as evidence when two namespaces share a code.
 */
async function labelFor(deps: ReconcileDeps, code: string): Promise<string | null> {
  const res = await sql.raw<{ value: string; label: string }>(FACILITY_OPTIONS_SQL).execute(deps.externalDb);
  return res.rows.find((r) => r.value === code)?.label ?? null;
}

/**
 * `q-clinical-micro-header`'s `facility_of`/`facility_loc`/`facility` CTEs — the part of that query
 * that actually performs the `facility_map` join under test — with the outer patient/specimen/
 * lab_request `select` sliced OFF.
 *
 * ⛔ Why sliced rather than running the whole query, measured, not assumed: pg-mem has ZERO support
 * for correlated subqueries (confirmed directly — `select t1.id, (select max(t2.val) from t2 where
 * t2.ref = t1.id) as v from t1` fails with "column t1.id does not exist" against a bare two-table
 * pg-mem db, no migrations involved). The SAME gap `test-support/facility-reconcile-fixture.ts`'s
 * `makeMigratedExternalDb` already documents for migration 015's backfill. `q-clinical-micro-header`'s
 * OUTER select correlates three subqueries against `lab_requests.id` (the organism lookup and two
 * `max(l.specimen_id) ... where l.request_id = q.id` lookups) and fails the same way the whole
 * query fails when run whole against `deps.externalDb` in this suite — reproduced while writing this
 * test, not hypothesised. There is no live Postgres available to this hermetic suite either (that
 * coverage is `clinical-micro-header-live.test.ts`, gated on `TARGET_DATABASE_URL`). The three CTEs
 * ABOVE that outer select use only `group by`/aggregates, never correlation, so they run fine under
 * pg-mem — and the `facility_map` join this test exists to pin lives entirely inside them.
 *
 * The slice point is found at runtime via regex over the real `SEED_QUERIES` string — never retyped
 * — so the join text under test is still read verbatim from the one shipped copy; only the boundary
 * BETWEEN "the CTEs" and "the correlated outer select" is located programmatically. Plain `\n` in the
 * pattern: `report-seeds.ts` is CRLF on disk, but per ECMA-262 a template literal normalises CR and
 * CRLF line terminators to LF in its cooked value, so `CLINICAL_HEADER_SQL` contains no `\r` at
 * runtime (confirmed directly: a multi-line template literal evaluated in Node has no CR in its
 * value regardless of the source file's line endings).
 */
const FACILITY_CTES_SQL = (() => {
  const boundary = /\nselect\n\s*p\.surname as patient_surname,/.exec(CLINICAL_HEADER_SQL);
  if (!boundary) {
    throw new Error(
      'q-clinical-micro-header no longer matches the expected CTE / outer-select boundary — update ' +
      'the slice pattern in facility-map-namespace.e2e.test.ts (FACILITY_CTES_SQL) to match its new shape',
    );
  }
  return CLINICAL_HEADER_SQL.slice(0, boundary.index);
})();

/**
 * What `q-clinical-micro-header`'s `facility` CTE resolves as the performing laboratory for one
 * `diagnostic_reports.specimen_id` — i.e. what the clinical report's header panel would print for
 * whichever request that specimen belongs to. Unlike `q-facilities` (`labelFor` above), this CTE has
 * NO aggregation after its `facility_map` join — one `diagnostic_reports` row folds to one `facility`
 * row per `specimen_id` — so it can tell apart two rows that share a performer CODE but resolve
 * through different NAMESPACES, which `q-facilities`' `min()` cannot (see direction A below).
 */
async function performingLabForSpecimen(deps: ReconcileDeps, specimenId: string): Promise<string | null> {
  const res = await sql.raw<{ specimen_id: string; performing_lab: string | null }>(
    `${FACILITY_CTES_SQL}\nselect * from facility`,
  ).execute(deps.externalDb);
  return res.rows.find((r) => r.specimen_id === specimenId)?.performing_lab ?? null;
}

/** One `diagnostic_reports` row naming `code` under `performerSystem`, with a `specimen_id` so
 *  `performingLabForSpecimen` above has something to key on. */
async function seedDiagnosticReport(
  deps: ReconcileDeps,
  input: { id: string; specimenId: string; code: string; sourceSystem: string; performerSystem: string },
): Promise<void> {
  await deps.externalDb.insertInto('diagnostic_reports').values({
    id: input.id, specimen_id: input.specimenId, performer: input.code,
    source_system: input.sourceSystem, performer_system: input.performerSystem,
  } as never).execute();
}

describe('facility_map keyed on the observed namespace — end to end (FAC-P0-07)', () => {
  it('direction A: one feed, two namespaces, ONE shared code — each namespace resolves to ITS OWN facility', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha Clinic', localCode: 'L-A' });
    await seedRegistry(deps, { id: 'fac-B', name: 'Beta Hospital', localCode: 'L-B' });

    // ONE feed, TWO namespaces, the SAME code. Two DIFFERENT codes would still resolve correctly
    // even with the namespace clause removed from the join, because `dr.performer` alone already
    // discriminates them (see task-5-report.md's mutation-1 evidence — that is exactly what this
    // shape was rewritten to stop hiding). Only a SHARED code forces the JOIN itself, rather than
    // `q-facilities`' `group by dr.performer`, to do the discriminating work.
    await seedPerformers(deps, [['SHARED', 1]], { sourceSystem: 'webhook-ingest', performerSystem: 'urn:ns:a' });
    await seedPerformers(deps, [['SHARED', 1]], { sourceSystem: 'webhook-ingest', performerSystem: 'urn:ns:b' });
    await seedMapping(deps, { fromSystem: 'urn:ns:a', fromCode: 'SHARED', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-A' });
    await seedMapping(deps, { fromSystem: 'urn:ns:b', fromCode: 'SHARED', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-B' });

    await publishFacilityMap(deps, { apply: true });

    // facility_map holds TWO rows for the one code — same source_system, same source_code, distinct
    // performer_system — each carrying ITS OWN resolution rather than one colliding onto the other.
    const rows = await deps.externalDb.selectFrom('facility_map')
      .select(['performer_system', 'name']).orderBy('performer_system').execute();
    expect(rows).toEqual([
      { performer_system: 'urn:ns:a', name: 'Alpha Clinic' },
      { performer_system: 'urn:ns:b', name: 'Beta Hospital' },
    ]);

    // And the shipped `q-clinical-micro-header` join (via `FACILITY_CTES_SQL`) resolves each
    // namespace's own specimen to ITS OWN facility — not through `q-facilities`, whose `group by
    // dr.performer` cannot keep two rows sharing a code apart (see `labelFor`'s doc comment above).
    await seedDiagnosticReport(deps, { id: 'dr-a', specimenId: 'spec-a', code: 'SHARED', sourceSystem: 'webhook-ingest', performerSystem: 'urn:ns:a' });
    await seedDiagnosticReport(deps, { id: 'dr-b', specimenId: 'spec-b', code: 'SHARED', sourceSystem: 'webhook-ingest', performerSystem: 'urn:ns:b' });

    expect(await performingLabForSpecimen(deps, 'spec-a')).toBe('Alpha Clinic');
    expect(await performingLabForSpecimen(deps, 'spec-b')).toBe('Beta Hospital');
  });

  it("direction B: two feeds sharing a namespace — BOTH feeds' reports resolve", async () => {
    // Not in the audit. These fold into ONE ResolvedFacility whose sourceSystem is merely the
    // display tiebreak winner, so before the fan-out feed-b had no dimension row and its reports
    // fell back to the raw performer code.
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-S', name: 'Shared Lab', localCode: 'L-S' });
    await seedPerformers(deps, [['NHL-01', 5]], { sourceSystem: 'feed-a', performerSystem: 'urn:ns:shared', performerDisplay: 'raw a' });
    await seedPerformers(deps, [['NHL-01', 1]], { sourceSystem: 'feed-b', performerSystem: 'urn:ns:shared', performerDisplay: 'raw b' });
    await seedMapping(deps, { fromSystem: 'urn:ns:shared', fromCode: 'NHL-01', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-S' });

    await publishFacilityMap(deps, { apply: true });

    // Both feeds must have their own dimension row, or the losing feed's reports match nothing.
    const rows = await deps.externalDb.selectFrom('facility_map')
      .select(['source_system', 'name']).orderBy('source_system').execute();
    expect(rows).toEqual([
      { source_system: 'feed-a', name: 'Shared Lab' },
      { source_system: 'feed-b', name: 'Shared Lab' },
    ]);
    // And the shipped query resolves the code rather than falling back to either raw display.
    expect(await labelFor(deps, 'NHL-01')).toBe('Shared Lab');
  });

  it('a report whose wire supplied NO namespace still joins', async () => {
    // `NULL = NULL` is false in SQL. The dimension stores '' and the join coalesces to '' — the
    // class of bug that produced a silent reportCount: 0 in an earlier slice.
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-N', name: 'Nullspace Lab', localCode: 'L-N' });
    await seedPerformers(deps, [['NOSYS', 1]], { sourceSystem: 'webhook-ingest', performerSystem: null });
    await seedMapping(deps, {
      fromSystem: observedSystemForFeed('webhook-ingest'), fromCode: 'NOSYS',
      toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-N',
    });

    await publishFacilityMap(deps, { apply: true });

    expect(await labelFor(deps, 'NOSYS')).toBe('Nullspace Lab');
  });
});
