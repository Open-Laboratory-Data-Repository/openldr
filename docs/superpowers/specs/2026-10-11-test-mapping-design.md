# Test mapping

Map each lab's own test codes to test catalog entries, so warehouse reports can count a test by
what it is, not by what one LIMS calls it.

Status: design approved in chat on 2026-10-11, slice by slice. This file needs the operator's
review before a plan is written.

## 1. Which user action is broken today

Two things, both chosen by the operator.

1. **A national or central report cannot count one test across labs.** Labs, and LIMS products,
   use different codes for the same test. A report must list every code by hand.
2. **A country pack must hardcode its LIMS's codes.** reports-zm names DISA's `HIVVL`, `POCVR`
   and `POHVL` for viral load (cdr `packs/reports-zm/zm-sql.mjs:869`), and every other test the
   same way. The pack cannot work for a second LIMS in the same country.

## 2. Facts this design rests on

I checked each one in the code on 2026-10-11.

- **The warehouse keeps each lab's codes as received.** `lab_requests.panel_code` and
  `panel_system`, `lab_results.observation_code` and `observation_system`
  (`packages/db/src/migrations/external/003_v2_core.ts:41-54`).
- **cdr sends one coding per test, in the lab system's namespace.** The system is
  `urn:openldr:<system id>` and the code is DISA's (cdr `apps/cli/src/export/fhir-transform.ts:92-95`,
  `:281`, `:496`). No LOINC is sent. Only organism results carry LOINC `634-6` first (`:602`).
  v1's LOINC columns were blank too, so the data holds no LOINC to read.
- **Nothing translates test codes today.** Term mappings are read for facilities and for the
  catalog's own LOINC link (`packages/bootstrap/src/test-catalog.ts:365`). Nothing reads a
  mapping from a lab test code.
- **The catalog has one level: orderable tests.** Code system
  `urn:openldr:codesystem:test-catalog` (`test-catalog.ts:30`). A test may link to one LOINC code
  through a term mapping. LOINC is "preferred, not required"
  (`docs/superpowers/specs/2026-09-15-test-catalog-design.md:37`). Nothing stops two tests from
  sharing one LOINC code.
- **Term mappings already sync from central to labs** (`packages/bootstrap/src/sync-serve.ts:252-270`).
  The sync applier stamps `managed_origin = 'central'` on rows it writes.
- **The facilities pattern is the model.** `facility_map` is a warehouse copy of the resolved
  mappings, rebuilt delete-then-insert, joined on `(source_system, source_code)`
  (`packages/db/src/migrations/external/012_facility_map.ts`).
- **A synced facility mapping reaches a lab's warehouse only at its next boot.** The mapping
  routes enqueue a rebuild (`apps/server/src/terminology-admin-routes.ts:263`, `:302`, `:326`), and
  boot does (`packages/bootstrap/src/index.ts:1079`). No sync handler does. This design must not
  repeat that.
- **A warehouse table must be governed, or its columns are exposed by omission.** `facility_map`
  was once in `EXTERNAL_TABLE_COLUMNS` and in no policy (`apps/server/src/dashboards-routes.ts:28-32`).
- **Packs already state a CE minimum that holds.** Since `a0b8a06c` the installer checks
  `compatibility.ceVersion` (`packages/bootstrap/src/content-pack-install.ts:79`).

## 3. Decisions made in chat

| Question | Answer |
|---|---|
| What does mapping make possible? | Cross-lab reports (1) and packs written against the catalog (2). |
| Which level? | Tests now. Result fields as a named second slice. The warehouse table is shaped for both. |
| How are mappings made? | By hand, by CSV, and by a content pack step. A pack never overwrites a mapping already there. |
| How does a pack name a catalog test? | By LOINC. The install resolves it to the one catalog test linked to that LOINC. |
| Where do reports read mappings? | A warehouse table, `test_map`, rebuilt from term mappings. |

Two other ways were rejected. Stamping the catalog code onto `lab_requests` at projection time means
every mapping change re-projects millions of rows, and it adds a column for a CE-only fact. A view
over the internal tables cannot work, because the warehouse is a separate database, possibly MSSQL
or MySQL.

## 4. Design

### 4.1 The mapping

One row in `term_mappings` per lab test code:

- `from_system`, `from_code`: the code exactly as the warehouse stores it in `lab_requests`, for
  example `urn:openldr:disa` and `HIVVL`.
- `to_system`: `urn:openldr:codesystem:test-catalog`. `to_code`: the catalog test's code.

Several lab codes may map to one catalog test. One lab code has at most one active catalog
mapping. A second active one makes the code **ambiguous**.

No new internal table and no new column. Audit and sync come with term mappings.

### 4.2 The warehouse table `test_map`

External migration `023`. Check for unmerged branches that claim `023` before the build,
including the operator's Linux branches. One row per mapped lab code:

| Column | Type | Meaning |
|---|---|---|
| `id` | key, primary | `<level>\|<source_system>\|<source_code>`, hashed when long, deterministic. Same rule and reason as `facility_map`. |
| `level` | key, not null | `'test'` in this slice. The second slice adds `'result'`. |
| `source_system` | key, not null | The lab's code system. |
| `source_code` | key, not null | The lab's code. |
| `catalog_code` | text | The catalog test's code. |
| `catalog_name` | text | Its display name. |
| `category` | text | Its category code. |
| `loinc` | text | Its LOINC link. Null when it has none. Portable pack SQL filters on this. |
| `updated_at` | timestamp, not null | |

One index on `(level, source_system, source_code)`. MySQL gets `utf8mb4`, as `facility_map` does.

Only mapped codes get a row. An unmapped code finds no match, and the report decides whether to
drop it or show the raw code. A report reads:

```sql
select tm.catalog_name, count(*)
from lab_requests lr
join test_map tm on tm.level = 'test'
  and tm.source_system = lr.panel_system
  and tm.source_code = lr.panel_code
where tm.loinc = '25836-8'
group by tm.catalog_name
```

`test_map` joins `EXTERNAL_TABLE_COLUMNS` and the Data Exposure list `GOVERNED` as "Test Map". It
holds no personal data. It is not added to the dashboard builder's join list.

### 4.3 The rebuild

`publishTestMap(deps, { apply })` in `@openldr/bootstrap`. The route, the CLI and the pack
installer call it. It:

1. Reads every active term mapping whose `to_system` is the catalog.
2. Joins each to its catalog test for name, category and LOINC link.
3. Sorts each lab code into **mapped**, **ambiguous** or **target missing**. A code is ambiguous
   when it has two or more active catalog mappings. Its target is missing when the catalog code no
   longer exists. A retired catalog test still maps, because old results belong to it.
4. With `apply`, replaces `test_map` delete-then-insert in one warehouse transaction. Never
   upsert-then-prune.

It returns the counts and the ambiguous and missing codes. Without `apply` it writes nothing.

It runs inline, not as a queued job. The table is tens to hundreds of rows.

**Triggers, on the API server:**

- A test mapping is created, changed or deleted, through the studio, the API or the CLI.
- A catalog test's name, category or LOINC link changes.
- The sync applier writes a term mapping into the catalog, or applies a catalog change.
- A content pack's `test-mappings` step finishes.
- Boot.

**A failed rebuild does not undo the mapping.** The mapping is saved first. The response, and the
Observed tab, then say the warehouse copy is out of date and offer a rebuild. Boot rebuilds again.

### 4.4 Making mappings in the studio

The Test catalog page (`apps/studio/src/pages/TestCatalog.tsx`) gains Tabs: **Tests**, the table it
has today, and **Observed**. The Observed tab copies the Facilities one
(`apps/studio/src/facilities/ObservedTab.tsx`) for layout, wording and states.

- **Rows.** Each lab test code in the warehouse, `lab_requests` grouped by `panel_system` and
  `panel_code`, with the description, request count and last seen date. Read on the server,
  paginated, ordered by the unique pair `(system, code)`. Filters: unmapped, mapped, ambiguous, all.
- **Columns.** System, code, description, requests, last seen, and the catalog test with its LOINC,
  or an "Unmapped" or "Ambiguous" badge.
- **Row `⋯` menu.** "Map to catalog test" opens a Sheet. Label left, input right. A catalog test
  picker searches by name or code. Save and Clear mapping sit in the sheet's `⋯` menu.
- **Page `⋯` menu.** Export CSV, Import CSV, Rebuild warehouse copy.
- `TablePagination`. `LoadingState` while loading, `StripedEmpty` when empty, both in a `colSpan`
  cell with `p-0` and the data state's height. `data-[state=inactive]:hidden` on each
  `TabsContent`. Checked at 375 px.

**Who can edit.** A mapping with `managed_origin = 'central'` is read-only on a lab. A lab may map
codes central has not mapped. The new test-mapping routes enforce this. The general term-mapping
routes have no such guard today, and this spec does not change them.

### 4.5 CSV import and export

Columns: `system, code, description, requests, catalog_code, loinc`.

- Export writes every observed code and its current mapping.
- Import uses `catalog_code` when set. Otherwise it resolves `loinc` to a catalog test, refusing
  the row on none or several.
- On a lab, a row whose code central has mapped is refused, as in 4.4.
- A preview counts new, changed, unchanged and refused rows before anything is written. Then
  `publishTestMap` runs once.

### 4.6 CLI

Through the same `@openldr/bootstrap` functions:

```
openldr test-catalog map list [--status unmapped|mapped|ambiguous] [--json]
openldr test-catalog map set <system> <code> <catalog-code>
openldr test-catalog map clear <system> <code> --force
openldr test-catalog map export --out <file>
openldr test-catalog map import <file> [--apply --force]
openldr test-catalog map rebuild [--apply]
```

Clear and an applied import refuse without `--force`. Audit records `actorName: 'cli'`.

### 4.7 The content pack step

A new step kind `test-mappings` with `mappings: { system, code, loinc }[]`. The summary label is
"Test mappings" with the count.

**Check pass, no writes.** It is shown in the CLI dry run and in the studio confirm.

- Each `loinc` resolves to the one catalog test linked to it.
- A `loinc` with no catalog test, or several, is **skipped and listed**:
  "`HIVVL` not mapped: no catalog test is linked to LOINC 25836-8". It does not refuse the pack.
- A code with an active catalog mapping already, made by hand or by central, is **kept**.

**Write pass.** It writes the resolved mappings as term mappings, audits each one, and calls
`publishTestMap` once. The install result and the audit row carry the mapped, kept and skipped
counts.

A CE that does not know the step kind refuses the pack, as it does today for any unknown step. A
pack using the step sets `ceVersion` to the release that ships it.

A later pack version that drops a mapping leaves it installed. Packs have no uninstall, and an admin
can clear a mapping by hand.

### 4.8 Errors

| Case | What happens |
|---|---|
| Map to a catalog code that does not exist | The route refuses with 400 and `{ error, kind: 'invalid' }`. |
| Edit a central-owned mapping on a lab | The route refuses with 409 and `kind: 'central-managed'`. |
| Map a code that already has a mapping | Set replaces it. On a lab, a central-owned mapping refuses as in the row above. One active mapping per code. |
| Two active mappings exist, from a sync race or old data | The rebuild leaves the code out of `test_map`. The Observed tab shows it as ambiguous. |
| The warehouse write fails | The mapping stays saved. The Observed tab shows the copy is out of date. |

## 5. Slices

**Slice 1, this spec: tests.** Sections 4.1 to 4.8.

**Slice 2, a short spec of its own before the build: result fields.**

- The catalog gains a component level, perhaps seeded from LOINC panel members in
  `ontology_panel_members`.
- Observed result codes come from `lab_results.observation_system` and `observation_code`.
- Mappings target components. `test_map` gains `level = 'result'` rows.
- Slice 1's table, rebuild and routes keep their shape.

## 6. Tests, and what each layer proves

| Test | Proves | Does not prove |
|---|---|---|
| `publishTestMap` unit tests: mapped, ambiguous, missing, retired, LOINC carried, delete-then-insert | The sorting and the write, on pg-mem | Real Postgres. pg-mem is not Postgres. |
| Pack step tests: resolve, skip, keep, write, unknown step refused | The installer's two passes | A real signed bundle. The live check covers that. |
| Route tests: Observed list, set, clear, import preview, rebuild, central read-only | The wire shapes. A typecheck cannot. | The studio. |
| `migrations.test.ts` pins `023` | It runs, on Postgres | MSSQL and MySQL. HONEST NON-PROOF unless the MSSQL and MySQL acceptance scripts run. |
| CLI tests for each `map` subcommand | The commands and `--force` | |
| Studio tests for the tab and sheet | Rendering and actions | A real phone. |
| Live check on the dev CE | The whole path | |

The Observed list pages with `ORDER BY` and `OFFSET`, so its key `(system, code)` must be unique.
pg-mem has a stable scan order and will never show a missing tiebreaker.

**Live check.** The dev warehouse has no lab requests, so ingest a small sample bundle first. Map a
code by hand and by CSV. Install a pack with the step. Read the result through a custom query.
Check the tab and the sheet at 375 px.

## 7. Done, per AGENTS.md §6

1. UI: the Observed tab and the sheet, as in 4.4.
2. CLI parity: 4.6.
3. Docs: in-app and web docs in en, fr and pt. The Observed tab, the CSV, the CLI, the pack step,
   and the example join from 4.2.
4. Mobile: 375 px.
5. `pnpm make:changelog` after merge.

## 8. Not in this spec

- Automatic matching, such as same-code linking as facilities have. Lab codes rarely equal catalog
  codes, and packs cover the bulk.
- Updating reports-zm and vl-reports-mz to ship mappings and filter on `test_map.loinc`. That is
  cdr-toolchain work and needs a DISA-to-LOINC list each country confirms.
- A guard on the general term-mapping routes for central-owned rows.
- The dashboard builder's join list.
- Fixing the boot-only rebuild for synced facility mappings (section 2). Noted, not fixed here.

## 9. Changes during planning

Each follows existing code.

1. A lab editing a central-owned mapping gets 409 with `kind: 'central-managed'`, as the catalog routes do, not 403.
2. Refusals are `{ error, kind }`, as the catalog routes do, not error-catalog codes.
3. The studio install confirm does not show the pack's mapped, kept and skipped lists. It does not call the check for link-matching either. The CLI dry run and the audit row carry them.
4. Catalog edits call an `onChanged` callback on `createTestCatalog`.
5. Sync bursts go through a coalescing runner: at most two rebuilds per burst.
6. Warehouse rows with a null `panel_system` or `panel_code` are left off the Observed list.
7. A blank `catalog_code` and `loinc` in an imported CSV row means no change.

## 10. Changes during the build

Each came from a task review.

1. Rebuilds run one at a time. A save's rebuild and a sync rebuild could otherwise overlap, and the second would fail on the primary key and report the copy out of date.
2. `AppContext.close()` waits for a rebuild in flight before it closes the databases. A CLI command could otherwise exit mid-rebuild.
3. An offline sync bundle import asks for a rebuild, as an online pull does.
4. On a lab, a CSV row that asks for the mapping central already has counts as unchanged. Only a row that would change it is refused.
5. The file reader trims every cell, so a CSV row is refused when the warehouse holds its code only with surrounding spaces. Such a code is mapped on the Observed tab or with `map set`.
6. Codes match the way the warehouse database compares text: exact on Postgres; MSSQL and MySQL default collations ignore case, and MSSQL ignores trailing spaces. The docs say so.
