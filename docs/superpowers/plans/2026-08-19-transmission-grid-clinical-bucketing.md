# LIS Stakeholders Update: clinical-date bucketing implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a filled cell in the LIS Stakeholders Update mean the laboratory registered, tested or authorised work that day, instead of meaning the data reached the central system that day.

**Architecture:** Only the `arrivals` CTE inside the six seeded SQL variants changes. Its contract with the rest of each query is two columns, `lab` and `cal_day`, and `labs` and `grid` read nothing else, so day generation, the 23 fixed columns, the cross join and the printed layout are untouched. The CTE stops reading `ingest_events` and walks a three-step ladder over clinical timestamps already in the warehouse. The third step needs a DiagnosticReport to ServiceRequest link that CE does not yet project, so the slice opens with a migration.

**Tech Stack:** TypeScript, Kysely migrations over Postgres / SQL Server / MySQL, seeded SQL in `packages/reporting/src/seed/report-seeds.ts`, Vitest against a real Postgres for the live tests.

**Spec:** `docs/superpowers/specs/2026-08-19-transmission-grid-clinical-bucketing-design.md`

---

## Background the engineer needs

**The date rule.** For each request, for the requested month, the first of these whose date falls inside it:

1. `lab_requests.authored_at` (registered)
2. earliest `lab_results.result_timestamp` for that request (tested)
3. earliest `diagnostic_reports.issued` for that request (authorised)

A request with none of the three inside the month does not appear. One mark per request per month, not one per event: a request registered on the 3rd and authorised on the 7th marks the 3rd only. That is deliberate and mirrors the prior system's `CASE`, which stops at its first match.

**Why the month test is a string comparison.** All three columns hold ISO 8601 text carrying the source offset, for example `2013-06-03T15:10:00+03:00`. The `month` parameter is `YYYY-MM`. So `left(authored_at, 7) = {{param.month}}` is the in-month test and `cast(left(authored_at, 10) as date)` is the day. No timezone conversion, no date arithmetic, and all three engines accept both expressions unchanged.

**What this deletes.** The `tz` parameter, `at time zone` on SQL Server, and `convert_tz` on MySQL. That removes the documented MySQL failure where absent zone tables make `convert_tz` return NULL and the whole grid renders empty with no error, and the Windows-versus-IANA zone-name mismatch on SQL Server. Do not preserve either construct.

**Do not touch the attribution route.** The laboratory name still resolves through `diagnostic_reports.batch_id = lab_requests.batch_id` then `facility_map`, and `distinct` stays. The 2026-08-18 spec measured that route. Step 3 of the ladder uses a separate alias on the same table joined through `based_on_id`. Two different joins for two different jobs, both needed.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/external/017_diagnostic_report_based_on_and_lab_results_index.ts` | Add `based_on_id` plus the indexes the new query needs | Create |
| `packages/db/src/migrations/external/017_diagnostic_report_based_on_and_lab_results_index.test.ts` | Prove `up` adds column and indexes, `down` reverses it | Create |
| `packages/db/src/migrations/external/index.ts` | Register migration 017 | Modify |
| `packages/db/src/schema/external.ts:81-` | `DiagnosticReportsTable` gains `based_on_id` | Modify |
| `packages/db/src/relational/diagnostic-report.ts:13-` | Project `basedOn[0]` into `based_on_id` | Modify |
| `packages/reporting/src/seed/report-seeds.ts` | Six `arrivals` CTEs, both param lists, description, footer, design meta row | Modify |
| `packages/reporting/src/seed/transmission-grid-tz-live.test.ts` | Rewritten: the stored offset governs the day | Rewrite |
| `packages/reporting/src/seed/transmission-grid-live.test.ts` | Fixtures move to clinical timestamps; new ladder cases | Modify |
| `apps/studio/src/docs/0.1.0/{en,fr,pt}/reports.md` | Arrival wording, and the timezone bullet that loses its subject | Modify |
| `packages/reporting/src/seed/report-seeds.test.ts` | Four hermetic shape tests that pin the OLD arrival SQL | Modify, in Task 5 |

⛔ **The reporting package stays RED from Task 3 until Task 5 lands.** Found during Task 3 on 2026-08-19; the plan originally missed this file. `report-seeds.test.ts` has four regex tests that loop over both queries and all three dialects and assert the SQL still contains `resource_type = 'ServiceRequest'`, `{{param.tz}}` and `e.recorded_at >=`:

- `reads ServiceRequest arrivals, in every dialect`
- `buckets days in the supplied timezone, not UTC`
- `bounds recorded_at inside the arrivals CTE, in every dialect`
- `pins the EXACT civil-zone month bound, in every dialect`

They are hermetic, so they run in the ordinary gate rather than only under `TARGET_DATABASE_URL`. Because the assertions are per-dialect loops, they cannot go green until every variant is rewritten and `tz` is gone. Do not try to fix them in Tasks 3 or 4, and do not read them as a regression. Task 5 rewrites them to pin the NEW shape: no `ingest_events`, no `{{param.tz}}`, and a `left(ts, 7) = {{param.month}}` gate present in all six variants.

---

### Task 1: Project `DiagnosticReport.basedOn`

CE already projects `basedOn` for two resources and not for this one. `packages/db/src/relational/observation.ts:16` does `request_id: referenceId((r['basedOn'] as unknown[] | undefined)?.[0])`, and `questionnaire-response.ts:26` does the same into `based_on_id`. Follow that exactly. The wire already carries it: the CDR toolchain emits `basedOn: [{ reference: 'ServiceRequest/<obrId>' }]` at `apps/cli/src/export/fhir-transform.ts:250`.

⛔ Do not join step 3 on `diagnostic_reports.id = lab_requests.id`. That equality holds on all 23,285 rows of the current warehouse only because the CDR toolchain mints one `obrId` for both resources. `diagnostic-report.ts:13` sets `id: String(r['id'])`, the wire id, so the projection guarantees nothing.

**Files:**
- Create: `packages/db/src/migrations/external/017_diagnostic_report_based_on_and_lab_results_index.ts`
- Create: `packages/db/src/migrations/external/017_diagnostic_report_based_on_and_lab_results_index.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/schema/external.ts`
- Modify: `packages/db/src/relational/diagnostic-report.ts`
- Test: `packages/db/src/relational/relational.test.ts`

- [ ] **Step 1: Confirm 017 is still free**

Kysely enforces strict numeric prefix order and a gap blocks boot. pg-mem cannot catch this; it only shows on a real boot.

Run:
```bash
ls packages/db/src/migrations/external/ | grep -E '^01[6-9]' ; git branch -a --no-merged main
```
Expected: `016_ingest_events.ts` and its test are the highest, and no branch is listed. If a branch exists, read its migrations directory before choosing a number.

- [ ] **Step 2: Write the failing projection test**

Add to `packages/db/src/relational/relational.test.ts`, beside the existing `projectResource` cases:

```typescript
it('projects DiagnosticReport.basedOn into based_on_id', () => {
  const out = projectResource({
    resourceType: 'DiagnosticReport',
    id: 'req1-obr1',
    basedOn: [{ reference: 'ServiceRequest/req1-obr1' }],
    subject: { reference: 'Patient/pt-1' },
    issued: '2013-06-05T10:30:00+03:00',
  });
  expect(out.row).toMatchObject({ id: 'req1-obr1', based_on_id: 'req1-obr1' });
});

it('leaves based_on_id null when DiagnosticReport has no basedOn', () => {
  const out = projectResource({
    resourceType: 'DiagnosticReport',
    id: 'req2-obr1',
    subject: { reference: 'Patient/pt-2' },
  });
  expect(out.row.based_on_id).toBeNull();
});
```

⚠ Read the surrounding cases in that file first and match their exact `projectResource` call shape, including whether they pass a provenance argument and how they reach the projected row. The two cases above state the intent; the file's own idiom wins on call shape.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @openldr/db test -- relational.test.ts`
Expected: FAIL, `based_on_id` is undefined rather than `'req1-obr1'`.

- [ ] **Step 4: Add the column to the schema type**

In `packages/db/src/schema/external.ts`, inside `DiagnosticReportsTable` (starts line 81), after `conclusion`:

```typescript
  /** `DiagnosticReport.basedOn[0]` — the ServiceRequest this report answers, so a report's
   *  `issued` attributes to one request rather than to a whole submission batch. Mirrors
   *  `observations.request_id` and `questionnaire_responses.based_on_id`, which project the same
   *  field. Null when the sender omits `basedOn`. ⛔ NOT interchangeable with `id`: those coincide
   *  for the CDR/DISA source, which mints one obrId for both resources, and for no other reason. */
  based_on_id: string | null;
```

- [ ] **Step 5: Project it**

In `packages/db/src/relational/diagnostic-report.ts`, in the returned object after `conclusion: str(r['conclusion']),`:

```typescript
    based_on_id: referenceId((r['basedOn'] as unknown[] | undefined)?.[0]),
```

`referenceId` is already imported on line 4.

- [ ] **Step 6: Run the projection test**

Run: `pnpm --filter @openldr/db test -- relational.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the migration**

Create `packages/db/src/migrations/external/017_diagnostic_report_based_on_and_lab_results_index.ts`:

```typescript
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { keyType } from './dialect';

// The LIS Stakeholders Update buckets a request by the first clinical timestamp falling inside the
// requested month: registered, then tested, then authorised. The third step needs
// `diagnostic_reports.issued` for ONE request, and no such link was projected — only `batch_id`,
// which carries up to 15 reports, so `min(issued)` over a batch would attribute one report's
// authorisation to a different request.
//
// `DiagnosticReport.basedOn` is on the wire already and is exactly what `observations.request_id`
// and `questionnaire_responses.based_on_id` project. This adds the same field to the third
// resource that carries it.
//
// ⛔ NULLABLE, and NO backfill statement. Unlike 015, this value cannot be derived from existing
// warehouse rows: its source of truth is `fhir.fhir_resources`. Populating it needs
// `openldr db reproject --force`, which is a deploy step, not a migration step.
//
// The indexes are not optional. The query runs one correlated lookup per request against
// `lab_results` (80,141 rows) and one against `diagnostic_reports` (23,285 rows) on the measured
// warehouse. Neither table had an index beyond its primary key, so without these the grid does a
// sequential scan per request.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('diagnostic_reports')
    .addColumn('based_on_id', sql.raw(keyType(engine)))
    .execute();
  await db.schema.createIndex('diagnostic_reports_based_on_idx')
    .on('diagnostic_reports').column('based_on_id').execute();
  await db.schema.createIndex('lab_results_request_idx')
    .on('lab_results').column('request_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('lab_results_request_idx').on('lab_results').execute();
  await db.schema.dropIndex('diagnostic_reports_based_on_idx').on('diagnostic_reports').execute();
  await db.schema.alterTable('diagnostic_reports').dropColumn('based_on_id').execute();
}
```

⚠ Open `015_facility_map_performer_system.ts` and `016_ingest_events.ts` before writing this. If either spells `createIndex` or `dropIndex` differently for cross-engine reasons, match them rather than the sketch above.

⛔ **CORRECTION, found in code-quality review on 2026-08-19. The sketch above is wrong twice.**

First, `dropIndex(...).on(table)` compiles to `drop index x on t` on every dialect in Kysely 0.28.17. There is no dialect override; `visitDropIndex` exists only at `dist/cjs/query-compiler/default-query-compiler.js:685`. Postgres has no `ON` clause there, so `down()` needs an `engine` parameter and must skip `.on()` for Postgres. Register it as `down: (db) => m017.down(db, engine)`, the pattern `007_drop_thin_rename_v2.ts` already uses.

Second, and worse, `lab_results.request_id` is declared `textType(engine)` at `003_v2_core.ts:52`. That is `longtext` on MySQL and `nvarchar(max)` on SQL Server, and neither can be an index key column. MySQL raises error 1170 and SQL Server raises Msg 1919, so the migration as sketched blocks boot on two of three supported targets. MySQL DDL is not transactional either, so a failure there leaves the column committed while the migration stays unrecorded, and a re-run then fails on a duplicate column.

The rule is already written down in this repo, at `011_terminology_codes.ts:23-28`. Indexed columns use `keyType`, never `textType`.

So `up()` must widen `lab_results.request_id` to `keyType(engine)` engine-conditionally before creating its index. Measure the longest existing value first and refuse rather than truncate. `based_on_id` is unaffected because it already uses `keyType`.

- [ ] **Step 8: Register it**

In `packages/db/src/migrations/external/index.ts`, beside the line 18 import and the line 37 entry:

```typescript
import * as m017 from './017_diagnostic_report_based_on_and_lab_results_index';
```
```typescript
    '017_diagnostic_report_based_on_and_lab_results_index': { up: (db) => m017.up(db, engine), down: m017.down },
```

- [ ] **Step 9: Write the migration test**

Create `packages/db/src/migrations/external/017_diagnostic_report_based_on_and_lab_results_index.test.ts`, modelled on `016_ingest_events.test.ts`. Read that file first and copy its harness rather than inventing one. It must assert:

- after `up`, `diagnostic_reports` has a nullable `based_on_id`
- after `up`, both indexes exist
- after `down`, the column and both indexes are gone

- [ ] **Step 10: Run the db package tests**

Run: `pnpm --filter @openldr/db test`
Expected: PASS, including the new migration test.

- [ ] **Step 11: Boot against a real database**

pg-mem cannot see a migration ordering gap. Only a real boot can.

Run: `pnpm --filter @openldr/cli build && node packages/cli/dist/index.js db migrate`
Expected: 017 applied, no ordering error.

- [ ] **Step 12: Commit**

```bash
git add packages/db/src/migrations/external/017_diagnostic_report_based_on_and_lab_results_index.ts \
        packages/db/src/migrations/external/017_diagnostic_report_based_on_and_lab_results_index.test.ts \
        packages/db/src/migrations/external/index.ts \
        packages/db/src/schema/external.ts \
        packages/db/src/relational/diagnostic-report.ts \
        packages/db/src/relational/relational.test.ts
git commit -m "feat(db): project DiagnosticReport.basedOn so a report attributes to one request"
```

---

### Task 2: Populate the column on the existing warehouse

A migration adds the column empty. The value lives in canonical FHIR, so the read model has to be rebuilt.

**Files:** none. Deploy step, run once.

- [ ] **Step 1: Reproject**

Run: `node packages/cli/dist/index.js db reproject --force`
Expected: completes without error.

- [ ] **Step 2: Verify the column populated**

Run:
```bash
docker exec openldr_ce-postgres-1 psql -U openldr -d openldr_target -c "select count(*) total, count(based_on_id) linked from diagnostic_reports;"
```
Expected: `linked` equals `total` (23,285 on the current warehouse). Anything lower means senders exist that omit `basedOn`. Note the number: those requests can only ever reach steps 1 and 2 of the ladder.

- [ ] **Step 3: Verify the link resolves, not just that it is non-null**

Run:
```bash
docker exec openldr_ce-postgres-1 psql -U openldr -d openldr_target -c "select count(*) from diagnostic_reports d join lab_requests q on q.id = d.based_on_id;"
```
Expected: matches `linked` from step 2. A shortfall means `based_on_id` points at ids that are not requests.

---

### Task 3: Rewrite the `arrivals` CTE, Postgres, HVL/EID grid

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:2249-2290` (the `arrivals` CTE in `q-transmission-hvleid`'s `postgres` variant)
- Test: `packages/reporting/src/seed/transmission-grid-live.test.ts`

- [ ] **Step 1: Write the failing ladder tests**

Add to `transmission-grid-live.test.ts`. Read the file's existing fixture helpers first and use them; the calls below state what rows must exist, not necessarily the literal helper names.

```typescript
it('falls through to the result date when registration sits outside the month', async () => {
  // Registered in March, resulted in April. The April grid must mark 2 April.
  await seedRequest({ id: 'r1-obr1', batchId: 'b1', panel: 'HIVVL',
    authoredAt: '2013-03-28T09:00:00+03:00' });
  await seedReport({ id: 'dr1', basedOnId: 'r1-obr1', batchId: 'b1', performer: 'LAB-A',
    issued: null });
  await seedResult({ id: 'o1', requestId: 'r1-obr1',
    resultTimestamp: '2013-04-02T11:00:00+03:00' });

  const rows = await runQuery('q-transmission-hvleid', { month: '2013-04', panels: 'HIVVL' });

  const lab = rows.find((r) => r.lab === 'LAB-A')!;
  expect(lab.d02).toBe('Y');   // 2 April 2013 is the second working day
  expect(lab.d01).toBe('');
});

it('marks one day per request per month, at the highest-priority in-month date', async () => {
  // Registered AND authorised inside the same month. Only registration marks.
  await seedRequest({ id: 'r2-obr1', batchId: 'b2', panel: 'HIVVL',
    authoredAt: '2013-04-03T09:00:00+03:00' });
  await seedReport({ id: 'dr2', basedOnId: 'r2-obr1', batchId: 'b2', performer: 'LAB-B',
    issued: '2013-04-09T16:00:00+03:00' });

  const rows = await runQuery('q-transmission-hvleid', { month: '2013-04', panels: 'HIVVL' });

  const lab = rows.find((r) => r.lab === 'LAB-B')!;
  expect(lab.d03).toBe('Y');   // 3 April, registration
  expect(lab.d07).toBe('');    // 9 April, authorisation, must stay blank
});
```

⚠ April 2013 starts on a Monday. Recount the working-day indices `d02`, `d03` and `d07` against a real calendar before trusting them, counting Mon-Fri only.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @openldr/reporting test -- transmission-grid-live`
Expected: FAIL. The current query reads `ingest_events`, which these fixtures do not write, so the laboratory is absent and `.find(...)` returns undefined.

- [ ] **Step 3: Replace the CTE**

Replace lines 2249 to 2290 with:

```sql
arrivals as (
  -- One row per (laboratory, day) that laboratory showed activity on, for the requested month.
  --
  -- The DAY is the first clinical timestamp falling inside the month: registered, then tested,
  -- then authorised. One mark per request per month, NOT one per event — a request registered on
  -- the 3rd and authorised on the 7th marks the 3rd only, because coalesce stops at its first
  -- non-null. Deliberate, and mirrors the prior system's CASE.
  --
  -- ⛔ Do NOT bucket on ingest arrival. A bulk backfill lands months of clinical work on one
  -- calendar day, and the grid then reports laboratories as transmitting in a month they were not.
  --
  -- ⛔ The month test is a STRING comparison on 'YYYY-MM'. These columns hold ISO 8601 text
  -- carrying the source's own offset, so left(ts,10) is the laboratory's local day and needs no
  -- conversion. Converting into a viewer's zone would make one historical cell render as two
  -- different days for two readers.
  select distinct x.lab, cast(left(x.ts, 10) as date) as cal_day
  from (
    select
      coalesce(fm.name, d.performer_display, d.performer, '(unknown)') as lab,
      coalesce(
        case when left(q.authored_at, 7) = {{param.month}} then q.authored_at end,
        (select min(r.result_timestamp) from lab_results r
          where r.request_id = q.id and left(r.result_timestamp, 7) = {{param.month}}),
        (select min(dr.issued) from diagnostic_reports dr
          where dr.based_on_id = q.id and left(dr.issued, 7) = {{param.month}})
      ) as ts
    from lab_requests q
    -- ⛔ Attribute the LABORATORY through the SUBMISSION BATCH, never through
    -- lab_results.specimen_id — see the 2026-08-18 spec for the 868 requests the specimen route
    -- drops. 'distinct' above is LOAD-BEARING: this join fans out up to 15x.
    join diagnostic_reports d on d.batch_id = q.batch_id
    left join facility_map fm
      on fm.source_system = coalesce(d.source_system, '')
     and fm.performer_system = coalesce(d.performer_system, '')
     and fm.source_code = d.performer
    -- Cheap month gate before the coalesce, mirroring the prior system's three-way OR. Without it
    -- the batch join runs over every request ever loaded rather than over the month's.
    where (
         left(q.authored_at, 7) = {{param.month}}
      or exists (select 1 from lab_results r
                  where r.request_id = q.id and left(r.result_timestamp, 7) = {{param.month}})
      or exists (select 1 from diagnostic_reports dr
                  where dr.based_on_id = q.id and left(dr.issued, 7) = {{param.month}})
    )
    -- The panel list is a RUN-TIME parameter (AGENTS.md §8) — no code is written here.
    -- ⛔ An EMPTY panels value NEVER REACHES THIS SQL. 'panels' is declared required and
    -- substituteParams throws 'required parameter: panels' first
    -- (packages/dashboards/src/custom-query-run.ts:33). An empty HVL/EID grid means the codes
    -- supplied do not match the codes this laboratory sends.
    -- coalesce(panel_code, '') so a NULL panel is a real value on both sides: without it
    -- 'null not in (...)' is NULL and a request with no panel would vanish from BOTH grids.
      and coalesce(q.panel_code, '') in (
        select trim(value) from unnest(string_to_array({{param.panels}}, ',')) as value)
  ) x
  where x.ts is not null
),
```

`d` and `dr` are two joins on the same table doing two different jobs: `d` resolves the laboratory name through the batch, `dr` fetches one request's authorisation date. Both are needed. Do not merge them.

- [ ] **Step 4: Run the ladder tests**

Run: `pnpm --filter @openldr/reporting test -- transmission-grid-live`
Expected: both new cases PASS. Older cases in the file still fail; Task 6 fixes their fixtures.

- [ ] **Step 5: Check the query plan**

Run `explain analyze` over the rewritten CTE with `month` set to `2013-06` and the panel list inlined:

```bash
docker exec openldr_ce-postgres-1 psql -U openldr -d openldr_target
```

Expected: index scans on `lab_results_request_idx` and `diagnostic_reports_based_on_idx`.

⚠ **CORRECTION, measured during Task 3 on 2026-08-19. "No sequential scan on `lab_results`" was the wrong expectation.** Postgres flattens the month gate's `EXISTS` into a hashed subplan and scans `lab_results` once, 80,141 rows keeping 793 in about 16ms, rather than probing the index 23,285 times. That is cheaper than the index route, not a defect. The correlated `min()` subqueries do use `lab_results_request_idx`, measured at 89 loops. `diagnostic_reports_based_on_idx` can legitimately show `never executed` on a given month because `coalesce` short-circuits before step 3.

Measured totals for the CTE at `month='2013-06'`: 38.658 ms with `jit=off`, 46.786 ms for the full grid query. `diagnostic_reports` is scanned once for the `batch_id` join at 4.65 ms of that, so it does not dominate and needs no index.

⛔ **Separate problem, do not fix here.** With JIT on, the same CTE takes 782 ms and the full query 1279 ms, so JIT is roughly 733 ms of pure overhead. It fires because the planner costs the correlated subplans as per-row over 23,285 requests and estimates 997,687, not knowing `coalesce` short-circuits. Real work is about 40 ms. Record it, do not chase it in this slice.

If `diagnostic_reports` is sequentially scanned for the `batch_id` join and dominates the runtime, an index on `batch_id` is the fix. ⛔ It is not a one-liner. `diagnostic_reports.batch_id` is `textType` like `lab_results.request_id` was, so it cannot be indexed without the same `keyType` widening described in Task 1's correction, and for the same reason on MySQL and SQL Server. Do the widening and the index together in a new migration, not by appending to 017 once 017 has been applied anywhere.

Decide from the plan output, not from expectation. A sequential scan of 23,285 rows may well be cheap enough to leave alone, and widening an index without measurement is what `015` explicitly refuses to do.

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts \
        packages/reporting/src/seed/transmission-grid-live.test.ts
git commit -m "fix(reports): bucket the HVL/EID transmission grid by clinical date (postgres)"
```

---

### Task 4: Rewrite the remaining five `arrivals` CTEs

Same body, five more places. Do them one at a time and run the SQL-text gates after each.

Line numbers shift as you edit, so locate each by searching for `arrivals as (` inside the named variant rather than trusting the number.

| Query | Dialect | `arrivals` at |
|---|---|---|
| `q-transmission-hvleid` | mssql | 2373 |
| `q-transmission-hvleid` | mysql | 2527 |
| `q-transmission-other` | postgres | 2672 |
| `q-transmission-other` | mssql | 2794 |
| `q-transmission-other` | mysql | 2947 |

**Dialect deltas, and there are only two.**

The panel predicate keeps whatever each variant already uses: Postgres `in (select trim(value) from unnest(string_to_array({{param.panels}}, ',')) as value)`, SQL Server `in (select ltrim(rtrim(value)) from string_split({{param.panels}}, ','))`, MySQL its existing `panel_list` recursive CTE. Copy each from the variant you are editing. Do not port the Postgres version across.

The `q-transmission-other` variants invert that predicate to `not in`. Preserve the inversion. The two grids must keep partitioning the month, so no request-day lands in both or in neither.

Everything else in the new CTE — `coalesce`, `left`, `cast(... as date)`, `min()`, the correlated `exists` gates, and the derived table with its `x` alias — is accepted unchanged by all three engines.

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts`

- [ ] **Step 1: Delete every timezone construct in these five CTEs**

Search each for `at time zone`, `convert_tz` and `{{param.tz}}`. All must go. The long HONEST NON-PROOF comments about Windows-versus-IANA zone names and about `convert_tz` returning NULL without zone tables go with them: their subject no longer exists. Do not carry those comments forward.

⛔ Keep the separate HONEST NON-PROOF stating this SQL has never been parsed by SQL Server or MySQL. That is still true and this task does not change it.

- [ ] **Step 2: Rewrite each CTE**

Use the Task 3 Step 3 body, with the two deltas above.

- [ ] **Step 3: Run the SQL-text gates**

Run: `pnpm --filter @openldr/bootstrap test -- seed-queries-select-gate`
Expected: PASS.

⚠ These gates are regexes over the SQL text. By construction they cannot see a syntax error. Passing them is not evidence the SQL Server or MySQL variants parse.

- [ ] **Step 4: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts
git commit -m "fix(reports): bucket both transmission grids by clinical date on all three dialects"
```

---

### Task 5: Drop the `tz` parameter

Nothing reads it now. A parameter that does nothing is the kind of thing this whole change exists to remove.

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` (both `params` arrays, the `r-transmission-grid` record, the `rt-transmission-grid` design's meta element)
- Test: `packages/bootstrap/src/reporting-param-format.test.ts`

- [ ] **Step 1: Remove it from both query param lists**

In `q-transmission-hvleid` and `q-transmission-other`, delete:

```typescript
      { id: 'tz', label: 'Timezone', type: 'text', required: true },
```

leaving `month` and `panels`.

- [ ] **Step 2: Remove the Time zone row from the design**

In the `rt-transmission-grid` design, the `keyvalue` element with id `rt-transmission-grid-meta` (around line 3484) carries a Time zone row. Remove that row. Keep Month, HVL/EID panel codes and Generated.

- [ ] **Step 3: Remove it from the report record**

Find the `r-transmission-grid` entry and drop `tz` from its parameter declarations, leaving `month` and `panels`.

- [ ] **Step 4: Grep for stragglers**

Run: `grep -rn "param.tz\|id: 'tz'" packages/reporting/src/seed/report-seeds.ts`
Expected: no output.

- [ ] **Step 5: Run the seed and param tests**

Run: `pnpm --filter @openldr/reporting test && pnpm --filter @openldr/bootstrap test -- reporting-param-format reporting-data-driven`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts
git commit -m "fix(reports): drop the now-unused Time zone filter from the transmission grids"
```

---

### Task 6: Fix the fixtures in the main live test

**Files:**
- Modify: `packages/reporting/src/seed/transmission-grid-live.test.ts`

- [ ] **Step 1: Move every fixture off `ingest_events`**

Each fixture that writes an `ingest_events` row to place a mark now writes clinical timestamps instead: `lab_requests.authored_at` for the ordinary case, and `diagnostic_reports.based_on_id` wherever a report is seeded. Keep `batch_id` on both, since the laboratory still resolves through the batch.

- [ ] **Step 2: Drop the `tz` argument from every query invocation**

Every call passing `{ month, panels, tz }` becomes `{ month, panels }`.

- [ ] **Step 3: Keep these assertions unchanged**

The grid-shape and PDF-layout expectations still hold and are the regression net for this whole change: a day with no activity renders hollow, a laboratory absent from the window does not appear, the two grids partition the month, and the date header repeats on every page.

- [ ] **Step 4: Run it**

Run: `pnpm --filter @openldr/reporting test -- transmission-grid-live`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/transmission-grid-live.test.ts
git commit -m "test(reports): move the transmission grid fixtures onto clinical timestamps"
```

---

### Task 7: Rewrite the timezone live test

Its subject, converting an arrival instant into a civil zone, no longer exists. The replacement asserts the rule that took its place.

**Files:**
- Rewrite: `packages/reporting/src/seed/transmission-grid-tz-live.test.ts`

- [ ] **Step 1: Write the replacement cases**

Keep the file's existing Postgres harness. Replace its cases with:

```typescript
it('buckets on the offset the source stored, not the server session zone', async () => {
  await seedRequest({ id: 'r3-obr1', batchId: 'b3', panel: 'HIVVL',
    authoredAt: '2013-04-03T23:30:00+03:00' });
  await seedReport({ id: 'dr3', basedOnId: 'r3-obr1', batchId: 'b3', performer: 'LAB-C' });

  for (const zone of ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo']) {
    await db.executeQuery(sql`set time zone ${sql.lit(zone)}`.compile(db));
    const rows = await runQuery('q-transmission-hvleid', { month: '2013-04', panels: 'HIVVL' });
    const lab = rows.find((r) => r.lab === 'LAB-C')!;
    expect(lab.d03, `session zone ${zone}`).toBe('Y');   // 3 April, every time
  }
});

it('still buckets a timestamp stored without an offset', async () => {
  await seedRequest({ id: 'r4-obr1', batchId: 'b4', panel: 'HIVVL',
    authoredAt: '2013-04-04T08:15:00' });
  await seedReport({ id: 'dr4', basedOnId: 'r4-obr1', batchId: 'b4', performer: 'LAB-D' });

  const rows = await runQuery('q-transmission-hvleid', { month: '2013-04', panels: 'HIVVL' });
  expect(rows.find((r) => r.lab === 'LAB-D')!.d04).toBe('Y');   // 4 April
});
```

The 23:30 in the first case is the point. Under the old conversion it crossed a day boundary depending on the zone. Under the new rule it cannot.

- [ ] **Step 2: Run it**

Run: `pnpm --filter @openldr/reporting test -- transmission-grid-tz-live`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/reporting/src/seed/transmission-grid-tz-live.test.ts
git commit -m "test(reports): assert the stored offset governs the transmission grid day"
```

---

### Task 8: Fix the wording

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:339` (footer) and `:3664` (description)

- [ ] **Step 1: Rewrite the description**

At line 3664:

```typescript
    description: 'Which laboratories did work on which working day of a month: one grid for the '
      + 'HVL/EID panels named in the parameter, one for every other test. A filled cell means the '
      + 'laboratory registered, tested or authorised work that day, taking the earliest of those '
      + 'that falls in the month; a blank cell means none of the three did. Days are the '
      + 'laboratory\'s own local dates, as the source recorded them.',
```

- [ ] **Step 2: Rewrite the footer**

At line 339:

```typescript
        text: 'Generated by OpenLDR — a filled cell means that laboratory registered, tested or authorised work that day.', style: { fontSize: 7, color: '#94a3b8' } },
```

- [ ] **Step 3: Run the seed tests**

Run: `pnpm --filter @openldr/reporting test`
Expected: PASS. If a test asserts the old description text, update it to the new string.

- [ ] **Step 4: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts
git commit -m "docs(reports): say the transmission grid marks clinical work, not arrival"
```

---

### Task 9: Documentation in en, fr and pt

⛔ **CORRECTION, measured 2026-08-19. This task is English-only, and the plan was wrong to name three files.**

`reports.md` exists ONLY in English. `apps/studio/src/docs/0.1.0/en/` holds 19 files; `fr/` and `pt/` hold 2 each, `audit.md` and `facilities.md`. There is no fr or pt `reports.md` to modify.

That is safe, not broken. The docs registry falls back to English per section: `apps/studio/src/pages/Docs.tsx:83-85` narrows the locale, and `Docs.test.tsx:179` pins the behaviour with a test named "uses English fallback when app language is fr". A missing locale FILE degrades to English. The AGENTS.md §6.3 warning about literal braces applies to a missing i18n KEY in the app shell, which is a different mechanism.

Do NOT translate `reports.md` into fr and pt as part of this slice. Seventeen other files are equally untranslated, so doing one here would be an inconsistent partial fix and a large piece of writing unrelated to clinical-date bucketing. Record it, do not build it.

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/reports.md`

- [ ] **Step 1: Find every affected passage**

Run: `grep -n "Stakeholders\|arriv\|Time zone\|fuseau\|fuso" apps/studio/src/docs/0.1.0/{en,fr,pt}/reports.md`

The English file has at least three, and the other two mirror it:

- **line 50**, a troubleshooting bullet whose subject is gone. It currently reads:

  > **The LIS Stakeholders Update shows no data for a day you know a laboratory transmitted:** check **Settings ▸ Laboratory ▸ Time zone** first, or the **Time zone** filter on the run itself. Arrivals are bucketed by civil day, so a zone set to UTC on an installation running ahead of UTC can push a late-evening arrival to the previous day.

  Replace it with:

  > **The LIS Stakeholders Update shows no data for a day you know a laboratory worked:** the grid marks the day the laboratory registered, tested or authorised the work, not the day the data reached OpenLDR. A laboratory that works on Monday and transmits on Friday marks Monday. If the day still looks wrong, check the clinical dates on the source record; no OpenLDR setting moves them.

- **line 53**, a bullet on a missing laboratory. It currently opens "it sent nothing that month". Replace that clause with "it did no registered, tested or authorised work that month". The rest of the bullet stands.

- **line 65**, the main description. Rewrite the two arrival sentences ("whether any data reached OpenLDR on each working day of a month" and "A filled cell means data arrived that day; an empty cell means none did") to the registered/tested/authorised rule, and delete the whole Time zone paragraph, which describes a control that no longer exists:

  > Days are bucketed in the timezone set at **Settings ▸ Laboratory ▸ Time zone**. The run's own **Time zone** filter starts from that setting as a convenience default, but you can overwrite it, and a scheduled or CLI run does not read the setting at all — it must be given the zone directly.

  Add in its place: days are the laboratory's own local dates as the source recorded them, so the same cell reads the same for every viewer.

Everything else in that paragraph stays, including the weekend and holiday rules, the HVL/EID panel filter, and the note that the Spreadsheet view and CSV carry the date row first.

- [ ] **Step 2: Rewrite all three languages**

Keep the same structure in each so the files stay parallel. Translate the English above rather than paraphrasing, so the three stay comparable on review.

- [ ] **Step 3: Check nothing still promises the filter**

Run: `grep -rn "Time zone\|fuseau horaire\|fuso horário" apps/studio/src/docs/0.1.0/*/reports.md`
Expected: no hit referring to a filter on this report. Hits about other reports or about Settings are fine.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs/0.1.0/en/reports.md \
        apps/studio/src/docs/0.1.0/fr/reports.md \
        apps/studio/src/docs/0.1.0/pt/reports.md
git commit -m "docs(reports): document clinical-date bucketing in en, fr and pt"
```

---

### Task 10: Verify end to end and close out

- [ ] **Step 1: Full gate**

Run: `pnpm turbo run test`

⛔ Never pipe this through `tail`. It truncates the failure list and hides which package failed.

Expected: PASS, except for one known pre-existing failure named below. A failure here is usually a timeout, not a regression. Grep the output for `Test timed out` and re-run that package alone before blaming a change.

⛔ **Known failure, not from this slice.** `apps/studio/src/api.reports.test.ts > fetchReportPdf returns a Blob` fails with a cross-realm `Blob` identity problem. Found during Task 1's code-quality review on 2026-08-19. It reproduces standalone, sits in a file no task in this plan touches, and was last changed by an unrelated refactor. Nobody has bisected it to an origin commit. Do not fix it here and do not let it block this slice. Add it to the list instead.

- [ ] **Step 2: Reseed so the running install picks up the new SQL**

Run: `node packages/cli/dist/index.js db seed`
Expected: the summary reports built-in queries updated. `report-seeds.ts:3798` calls `customQueries.update(q.id, { sql: wantSql, params: q.params })`, so both the SQL and the shortened parameter list refresh.

- [ ] **Step 3: Prove the behaviour changed**

```bash
node packages/cli/dist/index.js report run r-transmission-grid --param month=2013-06 --param panels=HIVVL --format csv | head -20
node packages/cli/dist/index.js report run r-transmission-grid --param month=2026-08 --param panels=HIVVL --format csv | head -20
```

Expected: the 2013-06 run returns laboratories with marks spread across the month's working days. The 2026-08 run returns the date header and no laboratories, because no clinical work happened in August 2026. That inversion is the whole point of the change.

The command no longer takes `--param tz=...`.

- [ ] **Step 4: Confirm the report renders**

Open Reports in Studio, run the LIS Stakeholders Update for a month inside 2013 to 2019, and confirm the Time zone filter is gone and the grid fills across days.

The CLI path proves the query and the connector. It does not prove the HTTP route or the Studio rendering, so this step is not optional.

- [ ] **Step 5: Merge to local `main`, then sync**

Per CLAUDE.md, work merges to local `main` first. Confirm the origin SHA after pushing.

- [ ] **Step 6: Regenerate the landing changelog**

Run: `pnpm make:changelog`

Run it AFTER merging to `main`. The generator reads git history and cannot see commits that are not there yet. Commit `apps/web/src/landing/changelog.json` in this slice. The generator publishes `feat`, `fix` and `perf`, so this slice's commits do produce entries.

```bash
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): regenerate the landing changelog"
```

---

## What this plan does not do

- **No page 2 volume tables.** Still blocked for its own unrelated reason: `lab_requests.status` holds only `completed` and `revoked`, so Registered / Tested / Authorised counts cannot be distinguished. A status-column limit, not a timestamp one.
- **No third cell state, no per-lab expected-submission windows.** Deferred by the 2026-08-18 spec.
- **No SQL Server or MySQL execution.** Both variants ship unparsed by their engines, exactly as they did before. This slice reduces what is unproven, by deleting the timezone functions, but proves nothing new. Say so rather than reporting the dialects verified.
- **No change to `ingest_events`, the arrival ledger, or `reprojectAll`.** The column is added and populated through the existing reprojection path.
