# Result field mapping

Slice 2 of test mapping. Map each lab's own result codes to the site's result dictionary, so a
report can pick a result by what it is, not by what one LIMS calls it.

Status: design approved in chat on 2026-10-11, section by section. This file needs the operator's
review before a plan is written.

Slice 1 is `docs/superpowers/specs/2026-10-11-test-mapping-design.md`. This spec keeps its table,
rebuild, routes and rules, and says only what changes.

## 1. Which user action is broken today

The same two as slice 1, one level down.

1. **A cross-lab report cannot pick one result across labs.** Slice 1 lets a report choose the
   test. Inside that test, the report still names the result by the LIMS's code.
2. **A country pack must hardcode its LIMS's result codes.** reports-zm names six DISA codes for the
   viral load result (`cdr-toolchain/packs/reports-zm/zm-sql.mjs:870`), and does the same in about
   a dozen other places (`:1000`, `:1118`, `:1225`, `:1594`, `:1726`).

## 2. Facts this design rests on

I checked each one in the code on 2026-10-11.

- **Slice 1 guessed wrong about the target.** Its section 5 said the catalog "gains a component
  level". That level already exists. It is the result-parameter dictionary,
  `urn:openldr:default_result`. Each catalog test already lists its parameters
  (`packages/bootstrap/src/test-catalog.ts:66`).
- **The dictionary belongs to one site.** It is a DISA PARMDICT import, and CE does not seed it on
  purpose (`packages/terminology/src/loaders/result-parameters.ts:36-40`). On a DISA site its codes
  are DISA's own result codes.
- **A dictionary on central reaches every lab.** Every terminology system change goes into the
  sync log (`packages/db/src/terminology-sync.ts:43`).
- **A parameter has no LOINC link today.** The loader stores role, units, context and citation, and
  nothing else (`result-parameters.ts:61-64`).
- **A result code means the same thing under every panel.** reports-zm reads one GeneXpert result
  code under two panels, `TBGNX` and `POCGT` (`zm-sql.mjs:1163`, `:1203`). So the mapping key is
  `(observation_system, observation_code)`, without the panel.
- **CE's own results already use the dictionary.** Bench result entry codes each result with the
  parameter's system and code (`packages/forms/src/test-details.ts:60`).
- **CE's own orders already use the catalog.** The Lab order's Tests field lists the active catalog
  tests in the catalog's own system (`packages/db/src/migrations/internal/105_lab_order_test_catalog.ts:5-14`).
  Slice 1's rebuild reads only mappings into the catalog (`packages/bootstrap/src/test-mapping.ts:196`),
  so `test_map` has no row for these orders and slice 1's report join drops them today.
- **`test_map` already has a `level` column.** External migration 023. This slice needs no migration.
- **Slice 1's rebuild triggers live in two checks.** `mappingTouchesTestMap` and
  `isTestMapRelevantRecord` (`test-mapping.ts:139`, `:145`). The term-mapping routes call the first
  (`apps/server/src/terminology-admin-routes.ts:269`, `:311`, `:337`). The sync handlers call the
  second (`packages/bootstrap/src/index.ts:1498`, `:1507`, `packages/bootstrap/src/sync-bundle.ts:331`, `:339`).
- **The pack schema drops keys it does not know.** The `test-mappings` step is a plain `z.object`
  (`packages/marketplace/src/content-pack.ts:24-28`). A slice 1 CE given `level: 'result'` would drop
  the key and write result codes as test mappings, with no error.
- **The catalog decides ownership from one row.** `ownedHere` reads `managed_origin` on the
  catalog's `terminology_systems` row (`test-catalog.ts:449-455`).

## 3. Decisions made in chat

| Question | Answer |
|---|---|
| What does a lab result code map to? | A parameter in the result dictionary. Each parameter gets an optional LOINC link. |
| How does a DISA site map its codes to the identical dictionary codes? | An explicit "Map matching codes" action with a preview. Never implicit. |
| Where is a parameter's LOINC link set? | A new Result fields tab on the Test catalog page, with CLI commands. |
| What about results and orders CE records itself? | The rebuild writes a row pointing each code at itself, at both levels. This also fixes slice 1's gap. |

Rejected ways:

- **LOINC as the direct target.** A field with no LOINC code, such as pregnancy status or recency
  test mode, could not be mapped. Every install would also need LOINC loaded.
- **A new component level in the catalog.** The dictionary already is that level.
- **Implicit same-code matching in the rebuild.** A second LIMS whose code happens to equal a
  dictionary code with another meaning would be mapped silently, and reports would count the wrong
  result.

## 4. Design

### 4.1 Result mappings

One `term_mappings` row per lab result code:

- `from_system`, `from_code`: `lab_results.observation_system` and `observation_code`, exactly as
  the warehouse stores them.
- `to_system`: `urn:openldr:default_result`. `to_code`: the parameter code.

Several lab codes may map to one parameter. One lab code has at most one active target. Slice 1's
rules carry over unchanged. Two active targets of the same origin make the code ambiguous. Central's
row wins over a lab's (slice 1, section 10.7).

### 4.2 Parameter LOINC links

One `term_mappings` row from `urn:openldr:default_result|<code>` to LOINC, SAME-AS. This is the same
shape as a catalog test's link. A parameter has at most one link. Two parameters may share one LOINC
code. A pack then skips that LOINC code and lists it, as in 4.7.

### 4.3 `test_map` rows

No migration. The rebuild writes three kinds of rows beside slice 1's test mappings:

| Rows | `level` | `source_system`, `source_code` | Target columns |
|---|---|---|---|
| Result mapping | `result` | the lab's result code | `catalog_code` = parameter code, `catalog_name` = its display, `loinc` = its link, `category` null |
| Parameter self row | `result` | `urn:openldr:default_result`, the code itself | the same, for that parameter |
| Catalog test self row | `test` | `urn:openldr:codesystem:test-catalog`, the code itself | as slice 1 fills a test row |

Self rows cover every dictionary parameter and every catalog test, retired tests included. A route
refuses a mapping whose source system is its own target system (4.8), so a self row never collides
with a real mapping.

A report that wants viral load copies across labs reads:

```sql
select count(*)
from lab_results l
join test_map tm on tm.level = 'result'
  and tm.source_system = l.observation_system
  and tm.source_code = l.observation_code
where tm.loinc = '20447-9'
```

### 4.4 The rebuild

`publishTestMap` stays one function. It writes both levels, delete-then-insert, in one warehouse
transaction, through slice 1's one-at-a-time runner. The table grows from hundreds of rows to a few
thousand, because the Tanzanian dictionary alone holds 1,547 codes. Inserts go in chunks.

Its result adds a result-level count and the ambiguous and missing result codes. A result code's
target is missing when the parameter is no longer in the dictionary.

New triggers, added to slice 1's two checks so the existing callers pick them up:

- a term mapping to or from `urn:openldr:default_result`
- a sync record for the `urn:openldr:default_result` system
- a dictionary import, which today triggers nothing

No dictionary loaded means the rebuild writes test rows only.

### 4.5 Studio

The Test catalog page goes from two tabs to three: **Tests**, **Result fields**, **Observed**.

**Result fields tab (new).** It copies the Tests tab for layout and states.

- Rows: every dictionary parameter, with code, name, role, units and LOINC. Paged on the server,
  ordered by code, which is unique within one system.
- Filters: search, LOINC linked or not, role.
- Row `⋯`: "Link LOINC" opens a Sheet with the label left and the input right. It uses the test
  sheet's LOINC picker. Save and Clear link sit in the sheet's `⋯`.
- Page `⋯`: Export CSV, Import CSV.
- Read-only when the dictionary came from central. The rule copies `ownedHere`, reading
  `managed_origin` on the dictionary's `terminology_systems` row.
- No dictionary loaded: `StripedEmpty` says so and names `openldr terminology import parameters`.

**Observed tab (extended).** It gains a second button group, **Tests | Results**, styled like its
status filter (`apps/studio/src/test-catalog/ObservedCodesTab.tsx:88`). In Results mode:

- Rows: `lab_results` grouped by `(observation_system, observation_code)`, with description, result
  count and last seen. Self rows' system `urn:openldr:default_result` is left off the list, since
  those codes need no mapping.
- The target column shows the parameter and its LOINC code, or an Unmapped or Ambiguous badge.
- Row `⋯`: "Map to result field" opens slice 1's `MapCodeSheet` with a parameter picker in place of
  the catalog picker.
- Page `⋯`: Export CSV, Import CSV, Rebuild, and **Map matching codes**. That item is hidden in Tests
  mode.

**Map matching codes.** A Sheet. Pick one source system from those observed. The preview lists each
unmapped code in that system that equals a dictionary code, with the dictionary entry and the result
count. Apply sits in the sheet's `⋯`. It writes ordinary term mappings, audits each, and rebuilds
once. A code central has mapped counts as mapped, so it never appears in the preview.

Shared rules: `TablePagination` on both tables. `LoadingState` and `StripedEmpty` in a `colSpan`
cell with `p-0`, at the data state's height. `data-[state=inactive]:hidden` on the new
`TabsContent`. Checked at 375 px, where three tabs and two button groups must wrap.

### 4.6 CSV and CLI

Result mappings CSV: `system, code, description, results, parameter_code, loinc`. Import uses
`parameter_code` when set. Otherwise it resolves `loinc` to the one linked parameter, and refuses the
row on none or several. Slice 1's preview, refusals, trimming rule and single rebuild carry over.

Parameter links CSV: `code, display, role, units, loinc`. Import reads only `code` and `loinc`. A blank
`loinc` means no change (slice 1, section 9.7). Clearing a link is `params unlink`.

`--level` defaults to `test`, so slice 1's commands keep working.

```
openldr test-catalog map list [--status ...] [--json] --level result
openldr test-catalog map set <system> <code> <parameter-code> --level result
openldr test-catalog map clear <system> <code> --level result --force
openldr test-catalog map export --out <file> --level result
openldr test-catalog map import <file> [--apply --force] --level result
openldr test-catalog map match <system> [--apply --force]
openldr test-catalog result-fields list [--loinc linked|none] [--role <role>] [--json]
openldr test-catalog result-fields link <code> <loinc>
openldr test-catalog result-fields unlink <code> --force
openldr test-catalog result-fields export --out <file>
openldr test-catalog result-fields import <file> [--apply --force]
```

Each command calls the same `@openldr/bootstrap` function as its route. Clear, unlink, match and
an applied import refuse without `--force`. Audit records `actorName: 'cli'`.

### 4.7 The content pack step

A new step kind, `result-mappings`, with `mappings: { system, code, loinc }[]`. The summary label is
"Result mappings" with the count.

It is a new kind, not a `level` key on `test-mappings`, because of the schema fact in section 2. A
CE without the new kind refuses the pack as needing a newer CE. A pack using it sets `ceVersion` to
the release that ships it.

It has the same two passes as `test-mappings`:

- **Check pass, no writes.** Each `loinc` resolves to the one parameter linked to it. An entry whose
  LOINC code links to no parameter, or to several, is skipped and listed. A code that already has an
  active result mapping is kept.
- **Write pass.** It writes the resolved mappings as term mappings, audits them with the mapped,
  kept and skipped lists, and calls `publishTestMap` once.

Packs name parameters by LOINC only.

### 4.8 Errors

As slice 1 (section 4.8, with 409 `central-managed` and 400 `invalid` refusals), plus:

| Case | What happens |
|---|---|
| Map to a parameter not in the dictionary | 400, `kind: 'invalid'` |
| A mapping's source system is its own target system | 400, `kind: 'invalid'`. This protects the self rows, at both levels. |
| Link or unlink a parameter on a lab whose dictionary came from central | 409, `kind: 'central-managed'` |
| Link a parameter to a code that is not LOINC-shaped | 400, `kind: 'invalid'`, using the catalog's LOINC pattern (`test-catalog.ts:51`) |
| Map matching codes finds nothing | The preview says none, and Apply is disabled. |
| No dictionary loaded | Result fields shows the empty state. The rebuild writes test rows only. |

## 5. Measured cost of the Observed results list

The list groups every `lab_results` row, as slice 1 groups `lab_requests`
(`test-mapping.ts:288-298`). The dev warehouse holds 4 results, so I timed the same GROUP BY on 10
million synthetic rows (1.5 GB, 300 codes, 2 systems) in a scratch database on the dev Postgres
container, default settings (128 MB shared buffers, 4 MB `work_mem`). The scratch database was
dropped afterwards.

| Run | Time |
|---|---|
| Cold | 2.7 s |
| Warm | 2.0 s |

So a lab pays about 2 to 3 seconds once a minute, behind slice 1's 60-second cache. A central
warehouse with 50 million results would pay roughly five times that, if the cost stays linear. I
did not measure that, nor MSSQL or MySQL. This slice adds no index. If a real warehouse proves slow,
a covering index on `(observation_system, observation_code)` is the next step.

## 6. Tests, and what each layer proves

| Test | Proves | Does not prove |
|---|---|---|
| `publishTestMap` unit tests: result rows, self rows at both levels, ambiguous and missing results, chunked insert, no dictionary | The sorting and the write, on pg-mem | Real Postgres |
| Trigger tests: the two checks return true for the dictionary system | The routes and sync handlers rebuild | |
| Route tests: Result fields list, link, unlink, central read-only, Observed results, map, match preview and apply, self-system refusal | The wire shapes | The studio |
| Pack step tests: resolve, skip, keep, write, old `test-mappings` unchanged | The installer's two passes | A real signed bundle |
| CLI tests for each new command and `--level` | The commands and `--force` | |
| Studio tests for the new tab, the level switch and the match sheet | Rendering and actions | A real phone |
| Live check on the dev CE | The whole path | |

The Result fields list and the Observed results list page with `ORDER BY` and `OFFSET`. Their keys,
`code` and `(system, code)`, are unique. pg-mem will never show a missing tiebreaker.

**Live check.** Import a small dictionary. Ingest a sample bundle with results in a lab system and
results entered at the bench. Run Map matching codes. Link a parameter to LOINC by sheet and by CSV.
Install a scratch pack with the step. Read the report in 4.3 through a custom query and confirm it
counts both the ingested and the bench results. Check both tabs and the match sheet at 375 px.

## 7. Done, per AGENTS.md section 6

1. UI: section 4.5.
2. CLI parity: section 4.6.
3. Docs: in-app and web docs in en, fr and pt. Result fields, the Results mode, Map matching codes,
   both CSVs, the CLI, the pack step, the self rows, and the join in 4.3.
4. Mobile: 375 px.
5. `pnpm make:changelog` after merge.

## 8. Not in this spec

- Packs naming a parameter by dictionary code.
- Updating reports-zm and vl-reports-mz to ship result mappings and filter on `test_map.loinc`.
  That is cdr-toolchain work, and it needs a DISA-to-LOINC list each country confirms.
- A guard on the general term-mapping routes for central-owned rows (slice 1, section 8).
- Any index or query work on the Observed results list beyond the cache, unless section 5's numbers
  prove wrong on a real warehouse.
- A `category` value for result rows. Role would fit, but no report asks for it.

## 9. Changes during planning

Each comes from code the design did not account for.

1. The CLI group is `openldr test-catalog result-fields`, not `params`. `openldr test-catalog params <code>` already edits one test's result parameters (`packages/cli/src/program.ts:391-398`).
2. The Observed list leaves out the catalog's own system in Tests mode too. CE's own orders are mapped by self rows, and listing them as Unmapped would invite a mapping the routes refuse.
3. The dictionary import exists only in the CLI, through a context with no warehouse. The CLI opens the app context after the import and rebuilds once. The Result fields empty state names that command.
4. The mapping routes keep the body field `catalogCode` for the target code at both levels, and take an optional `level`.
5. Audit actions stay `test_mapping.*` with `metadata.level`. Map matching codes audits `test_mapping.match`. Result fields audit `result_field.link`, `.unlink` and `.import`.
6. A result-fields CSV preview is refused too on a lab whose dictionary came from central.
7. Last seen on the Results list is the newest `lab_results.created_at`, the time the row reached the warehouse. cdr sends no result time.
8. The rebuild result keeps slice 1's top-level fields for the test level, and adds `results` and `selfRows`. `written` counts every row.
