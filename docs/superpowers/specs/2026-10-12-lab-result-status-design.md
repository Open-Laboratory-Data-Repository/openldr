# Result status in the warehouse

Carry a result's FHIR status and its reason for a missing value into `lab_results`, so a rejected test
stops looking like a result.

Status: design approved in chat on 2026-10-12. This file needs the operator's review before a plan is
written.

## 1. Which user action is broken today

When the bench rejects one test, CE writes a cancelled Observation coded with the test's catalog code
and carrying the reject reason. The warehouse turns it into an ordinary `lab_results` row with no value.
Nothing in the row says it was rejected, or why.

So:

1. **A query that counts results counts rejected tests as results.** Custom queries and the dashboard
   builder's Results model count every `lab_results` row.
2. **No report can count test rejections or their reasons.** The reason never reaches the warehouse.
3. **The Observed Results list shows rejected tests as unmapped result codes**, under the catalog's own
   system, and Map matching codes offers that system as a lab system.

Found during the result field mapping live check on 2026-10-12. The row was the 2026-10-11 bench live
check's rejected `CHEM-GLU` test.

## 2. Facts this design rests on

I checked each one in the code on 2026-10-12.

- **The bench writes a rejected test as a cancelled Observation.** It has `status: 'cancelled'`, the
  test's catalog code, and `dataAbsentReason` with the reject reason
  (`packages/forms/src/extract/test-results.ts:50-63`).
- **The projection drops both.** `projectObservation` maps code, values, flag and time, but not `status`
  or `dataAbsentReason` (`packages/db/src/relational/observation.ts:9-34`).
- **A rejected order already reaches the warehouse.** `lab_requests.rejection_code` and
  `rejection_reason` come from a ServiceRequest extension (`packages/db/src/relational/request-facts.ts:50-70`).
  A bench order with several tests is one `lab_requests` row, so a single test's rejection cannot live
  there.
- **Typed columns are allowed here.** `Observation.status` (HL7 v2 OBX-11) and
  `Observation.dataAbsentReason` are standard slots any lab system can fill (AGENTS.md section 8).
- **Shipped reports do not count raw result rows.** The AMR reports filter on organism code `634-6` or an
  S/I/R flag, and the volume report uses `lab_results` only to find orders by facility
  (`packages/reporting/src/seed/report-seeds.ts:311`, `:413`, `:954`, `:1006`,
  `packages/reporting/src/amr/query.ts:13-15`). A rejected test matches none of them. The seeded default
  dashboard (`packages/dashboards/src/samples/openldr-general.json`) did count them in three widgets,
  and this change filters them.
- **The Observed Results list scans every `lab_results` row** except the dictionary's own system
  (`packages/bootstrap/src/test-mapping.ts`, `scanResultGroups`).
- **cdr sends every Observation as `final`** (cdr `apps/cli/src/export/fhir-transform.ts:495`, `:552`, `:599`). DISA data never carries a cancelled result.
- **Rebuilding the warehouse from FHIR already exists.** `openldr db reproject --force` rewrites every
  projected row; post-upgrade backfill is its stated purpose (`packages/cli/src/db.ts:92-113`).
- **The next external migration is `024`.** `023_test_map` is the last
  (`packages/db/src/migrations/external/index.ts:51`).

## 3. Decisions made in chat

| Question | Answer |
|---|---|
| Keep test rejections in the warehouse, or drop the row? | Keep them. Reports must be able to count rejections and reasons. |
| Column names? | After the FHIR elements: `status`, `data_absent_code`, `data_absent_reason`. `dataAbsentReason` is broader than rejection, so a rejection-named column would mislabel a future "not performed". |

Rejected ways:

- **Write no row for a cancelled Observation.** Smaller, but no warehouse report could ever count test
  rejections.
- **Name the columns `rejection_code` and `rejection_reason`** to match `lab_requests`. It reads well, but
  any non-rejection reason would land in a column called rejection.

## 4. Design

### 4.1 Columns

External migration `024_lab_result_status` adds three nullable text columns to `lab_results`, in the
one-line pattern of `020_lab_result_comparator`:

| Column | Filled from | A rejected test |
|---|---|---|
| `status` | `Observation.status` | `cancelled` |
| `data_absent_code` | `Observation.dataAbsentReason.coding[0].code` | `HAEM` |
| `data_absent_reason` | `dataAbsentReason.text`, else `coding[0].display` | `Haemolysed` |

Both reason columns come from the existing `codeable()` helper (`packages/db/src/relational/extract.ts:24-32`), the rule the `code` column already uses. The reason's code system is not stored, as `lab_requests.rejection_code` stores none. The three columns
join `EXTERNAL_TABLE_COLUMNS.lab_results`. They hold no personal data, so the Data Exposure list needs no
new hidden column. Check for unmerged branches that claim `024` before the build.

### 4.2 Projection

`projectObservation` fills the three columns. Every Observation gets a status: cdr results and bench
results are `final`, a bench rejection is `cancelled`. An Observation with no `dataAbsentReason` leaves
both reason columns null.

### 4.3 Who reads the new columns

- **The Observed Results list** counts only rows where `status` is null or not `cancelled`. A rejected
  test is a test, not a result code, so it no longer appears there or in Map matching codes. Written in
  Kysely as `status is null or status <> 'cancelled'`, which every warehouse database reads the same way.
- **Shipped reports** need no change (section 2).
- **Report authors** get one paragraph in the docs: to count results, add
  `(status is null or status <> 'cancelled')`; to count test rejections, use `status = 'cancelled'`
  with `data_absent_code` and `data_absent_reason`.

### 4.4 Existing installs

Rows projected before the upgrade have a null status, and the rule in 4.3 counts a null as a result.
For a real result that is right. For an old rejection marker it stays wrong until the operator runs
`openldr db reproject --force`, which rebuilds the rows from FHIR with their status. The docs and the
release note say to run it once after upgrading. No backfill code: the warehouse holds no FHIR to read
the status from.

### 4.5 Errors

| Case | What happens |
|---|---|
| An Observation with no status | `status` stays null and the row counts as a result. FHIR requires a status, so only malformed data does this. |
| A `dataAbsentReason` with text and no coding | `data_absent_code` null, `data_absent_reason` holds the text. |
| A reason with several codings | The first coding is used, as `codeable()` does for `code`. |

## 5. Tests, and what each layer proves

| Test | Proves | Does not prove |
|---|---|---|
| `projectObservation` unit tests: a final result, a rejection with reason, a cancelled row with no reason, text-only reason | The mapping | The writer |
| Relational writer test: a rejection lands in `lab_results` with the three columns | The row reaches the warehouse, on pg-mem | Real Postgres |
| `migrations.test.ts` pins `024` | It runs, on Postgres | MSSQL and MySQL. HONEST NON-PROOF unless their acceptance scripts run. |
| Observed Results test: a cancelled row is left out, a null-status row is kept | The list filter | |
| Live check on the dev CE | Reject a test on the bench, see the warehouse row and the list | A real phone (no UI change) |

## 6. Done, per AGENTS.md section 6

1. UI: no new screen. The Observed Results list filter changes.
2. CLI parity: nothing new. `openldr db reproject --force` covers existing rows.
3. Docs: the comparator paragraph's neighbour in `apps/studio/src/docs/0.1.8/{en,fr,pt}/advanced-docs.md`
   ("Request facts and request attributes") and in `apps/web/src/docs/0.1.8/load-data.md`, in en, fr and pt.
   It names the three columns, the two query rules, and the reproject step for existing installs.
4. Mobile: no layout change.
5. `pnpm make:changelog` after merge.

## 7. Not in this spec

- A rejection-rate report or dashboard.
- Dashboard builder changes. The builder's Results model has a fixed field list
  (`packages/dashboards/src/models/registry.ts`, the `observations` model), so it does not offer `status`.
  Adding it waits for a null-safe "is not cancelled" filter, because the builder's not-equals compiles to
  plain `<>`, which drops every null-status row.
- Pack SQL. DISA data never carries a cancelled result.
- Storing the reason's code system.
- Bench rejection behaviour itself. The FHIR it writes stays as it is.

## 8. Changes during review

1. The default dashboard's three result counts now filter rejected tests.
2. The builder's Results model does not get `status`. Its field list is fixed, and its not-equals compiles to
   plain `<>`, which drops every null-status row.
3. The docs show the rule with a qualified column, and the upgrade guides name the reproject step.
