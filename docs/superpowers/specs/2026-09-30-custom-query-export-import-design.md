# Custom query export and import, and the DISA VL pack (Mozambique slice D)

Date: 2026-09-30. Status: design agreed in chat, awaiting spec review.
Follows slice C (`2026-09-29-v1-request-facts-design.md`).

## 1. Goal

Mozambique's lab staff must be able to run their viral load (VL) reports in CE. Their reports are
SQL views over OpenLDR v1 (`corlix/fixtures/Mozambique_views/openldr-views-script.sql`).

The operator's decision, 2026-09-30: those reports are content for one system (DISA), not core
features. Core gains only a generic way to move custom queries between installs. The DISA queries,
value sets and lab register ship as files outside git, handed to the Mozambique team.

## 2. The user action that is broken today

1. A lab cannot load a query written elsewhere. A custom query can only be typed into `/query` or
   seeded at boot (`packages/bootstrap/src/seed.ts`), and no CLI command creates one
   (`packages/cli/src/` has no query command). A headless lab cannot load one at all.
2. Mozambique cannot run its VL reports in CE, because nobody has written them against CE's
   warehouse.

## 3. Decisions

| # | Decision |
|---|---|
| D1 | Mozambique staff run the reports in CE (`/query`, `/reports`). No external tool reads database views. Keep v1's column names anyway. |
| D2 | VL first: `viewVL_Info` and `viewVL_Result`. The other 17 views follow in later batches, using the pattern VL proves. |
| D3 | The three SQL functions the VL views call (`ViralLoadResultMerge`, `ViralLoadFinalResult`, `GetReasonForTest`) are not in the script. They live in Mozambique's data database. Their columns are left out; the raw inputs are returned instead. Nothing is guessed. |
| D4 | `DisaPoc`, `Disalink` and `Laboratories` come in as ordinary data through existing imports: a lab register and two value sets. No new tables. |
| D5 | System content (queries, value sets, registers for DISA) never enters the repo. It lives in `packs/<system>/`, whose contents git and Docker ignore. |
| D6 | Core gains custom-query export and import only (option 1). A single content-pack file (option 2) and marketplace artifacts (option 3) are revisited after the Moz team has tested this. |
| D7 | A new AGENTS.md rule stops country or system columns in the warehouse (section 6). |

## 4. Evidence

| Fact | Proof |
|---|---|
| Custom queries have a create route, a name-unique store, sync capture and audit | `apps/server/src/query-routes.ts:39-52`; `packages/db/src/custom-query-store.ts:32-60` |
| The input schema and the SELECT-only check exist | `packages/dashboards/src/custom-query.ts:25` (`CustomQueryInputSchema`); `packages/dashboards/src/sql-runner.ts:17` (`validateSelectSql`) |
| Sync already treats the connector as local | `packages/db/src/custom-query-store.ts:50-54` (hash excludes `connectorId`) |
| The default warehouse connector is found by name | `packages/bootstrap/src/seed.ts:49` (`Target Warehouse (Postgres)`), `:66`, `:72` |
| The `/query` explorer header has no actions menu | `apps/studio/src/query/QueryPage.tsx:76-84` (title and collapse button only) |
| The three functions are absent locally | `OpenLDRData` on the `sqlserver` container holds six scalar functions, none of these; `OpenLDRDict_MZ` holds none |
| The Moz dictionary tables exist locally | `OpenLDRDict_MZ`: `DisaPoc` 213 rows, `Disalink` 341, `Laboratories` 106 |
| Custom queries run on Postgres only | memory note on the reports page; `runStoredQuery` in `packages/dashboards/src/custom-query-run.ts` |

## 5. Design: custom query export and import (core)

### 5.1 The file

One JSON file holds one or more queries:

```json
{
  "format": "openldr.custom-queries",
  "version": 1,
  "exportedAt": "2026-09-30T10:00:00Z",
  "queries": [
    { "name": "DISA VL results", "sql": "select ...", "params": [] }
  ]
}
```

No `id` and no `connectorId`: both are local to an install. `params` is the existing
`CustomQueryParam[]` shape, `optionsSql` included.

### 5.2 Import rules

- The name is the key. A new name is created. An existing name is skipped and reported, unless the
  caller asks to replace it (CLI `--force`, UI toggle). Replacing overwrites `sql` and `params` and
  keeps the existing id, so reports that point at the query keep working.
- Each query binds to one connector on the importing install. Default: the connector named
  `Target Warehouse (Postgres)` only, because custom queries run on Postgres. Another connector is
  chosen with `--connector <name>` or the picker. No connector found is an error.
- Each query passes `CustomQueryInputSchema`, and its SQL passes `validateSelectSql`, before any
  write. One bad query fails the whole file and nothing is written. The error names the query.
- An unknown `format` or a `version` above 1 is refused.
- Writes go through the existing store, so sync capture and audit work unchanged. Audit actions are
  `customQuery.create` and `customQuery.update`; the CLI actor is `cli`.
- The result lists each query as `created`, `replaced` or `skipped`.

### 5.3 Export

Export takes a list of query ids (UI) or names (CLI), or all queries when none are given, and writes
the section 5.1 file. Queries come out sorted by name, so two exports of the same set are identical.

### 5.4 Where the code lives

- Shared logic in `@openldr/bootstrap` (AGENTS.md section 6): `exportCustomQueries(ids)` and
  `importCustomQueries(file, { connectorName?, replace })`, called by both the routes and the CLI.
- Routes, behind the existing `query.run` capability: `POST /api/custom-queries/export`
  (body `{ ids?: string[] }`, returns the file) and `POST /api/custom-queries/import`
  (body `{ file, connectorName?, replace }`, returns the per-query result).
- CLI: `openldr query export [--name <n>...] --out <file>` and
  `openldr query import <file> [--connector <name>] [--force]`, registered in
  `packages/cli/src/index.ts`.

### 5.5 UI on `/query`

- A `⋯` menu in the explorer header (`QueryPage.tsx`), beside the collapse button, with "Export
  queries" and "Import queries". Ref: `pages/settings/Connectors.tsx`.
- Export: a Sheet with a checklist of saved queries and Download in the sheet's `⋯` menu.
- Import: a Sheet with a file picker, then a preview table marking each query `new`,
  `exists (skip)` or `exists (replace)`, with `TablePagination`. A replace switch and a connector
  picker sit in the form grid (label left, input right). Import runs from the sheet's `⋯` menu.
  The result is a toast with the counts, then the sheet closes and the saved-query list refreshes.
- Mobile: both sheets checked at 375x812.

### 5.6 Docs

The studio query page docs (`apps/studio/src/docs/0.1.8/{en,fr,pt}/query.md`) and a web docs page,
covering the file, the skip and replace rule, the connector rule and the two CLI commands.

## 6. Design: the warehouse column rule (AGENTS.md)

A new rule under section 8:

> **One shared warehouse model. No country or system columns.** A typed warehouse column is only for
> a fact any lab system can fill that has a standard slot (a FHIR element, or an HL7 v2 OBR, OBX,
> ORC, PID or SPM field). A fact from one system or country is a row in `lab_request_attributes`,
> keyed by a code in `urn:openldr:cs:request-attribute`. Queries, value sets and registers written
> for one system (for example DISA) are content: they ship as export files kept in `packs/`, never
> in the repo. One exception: `lab_requests.age_years` and `age_days` stay typed, because the
> source's stored age is more reliable than one worked out from the date of birth. The operator
> decided this on 2026-09-30.

Checked against slice C's 13 `lab_requests` columns and 2 `diagnostic_reports` columns:

| Column | Standard slot | Passes |
|---|---|---|
| obr_set_id | HL7 v2 OBR-1 Set ID | yes |
| analysis_at | OBX-19 Date/Time of the Analysis | yes |
| point_of_care | PV1-3 Assigned Patient Location; FHIR `ServiceRequest.locationCode` | yes |
| request_type | SPM-11 Specimen Role (P patient, Q control, O proficiency). DISA's D (diagnostic, 93,161 TDS requests) and E (quality or proficiency, 5,098) are DISA's own codes for that role | yes |
| registered_by | ORC-10 Entered By | yes |
| tested_by | OBX-16 Responsible Observer | yes |
| requester_practitioner | OBR-16 Ordering Provider; FHIR `ServiceRequest.requester` | yes |
| age_years, age_days | none direct; derivable from PID-7 date of birth | exception, kept (operator, 2026-09-30) |
| clinical_info | OBR-13 Relevant Clinical Information | yes |
| analyzer_code | OBX-18 Equipment Instance Identifier | yes |
| rejection_code, rejection_reason | SPM-21 Specimen Reject Reason | yes |
| section_code | OBR-24 Diagnostic Serv Sect ID | yes |
| authorised_by | OBR-32 Principal Result Interpreter; FHIR `DiagnosticReport.resultsInterpreter` | yes |

The two age columns are the one exception, kept as typed columns by the operator's decision on
2026-09-30. DISA stores the age at registration, and it matches v1 on every Tanzania row, while an
age worked out from the date of birth missed 82 of 136 sample rows (slice C findings). The rule text
names this exception so it is not read as permission for other derived facts.

## 7. Design: the DISA VL pack (outside git)

### 7.1 The `packs/` folder

- `packs/README.md` is tracked. It says what a pack is, that contents are never committed, and how
  to import one.
- `.gitignore`: `packs/*` and `!packs/README.md`.
- `.dockerignore`: `packs`.
- The DISA pack lives in `packs/disa/`.

### 7.2 Contents of `packs/disa/`

1. `disa-vl-queries.json`, in the section 5.1 format: "DISA VL info" and "DISA VL results".
   - Column names as v1's `viewVL_Info` and `viewVL_Result`.
   - Sources: `lab_requests` joined to `lab_results` once per DISA observation code (the codes are
     in this SQL, which is DISA content); `diagnostic_reports` for section, authorised by,
     authorised time and status; `patients` for sex; `specimens` for dates;
     `lab_request_attributes` for rare facts; `facility_map` for facility name, region and district
     (requesting and testing); `terminology_codes` for `IsDisaPoc` and `IsDisaLink`, matched on
     value set URL.
   - v1 `LIMSRptResult` maps to CE text value, else numeric value, else coded value.
   - A v1 column with no CE source returns NULL under its v1 name.
   - Left out (D3): `HIVVL_ViralLoadResult` and its four siblings, `FinalViralLoadResult`,
     `ReasonForTest`. Returned instead: each observation's reported and coded value, and the raw
     reason text.
   - Params: a required date range on registered time (`{{param.from}}`, `{{param.to}}`) and an
     optional requesting facility (`({{param.facility}} = '' OR ...)`), as the existing reports do.
2. `disa-poc.valueset.json` and `disa-link.valueset.json` (with their CodeSystems), from
   `OpenLDRDict_MZ.DisaPoc` and `.Disalink`. Imported with `openldr terminology import resource`.
3. `moz-laboratories-register.csv`, from `Laboratories` plus `DisaPoc` (a POC's lab code is the
   first 3 characters of `DisaPocLabNo`). Imported with the existing facility import.
4. `build.mjs`, which regenerates items 2 and 3 from the dictionary database.
5. `README.md`: import order, every NULL column and why, and the request to Mozambique for the
   three function scripts.

### 7.3 Checking it without Mozambique data

- Execution: import the whole pack into the dev CE and run both queries. They must run without error
  on Postgres. They return zero rows, because no Mozambique codes are in the data.
- Pattern: a test copy of the SQL with Tanzania's HIV VL panel and observation codes, run on the dev
  CE against the Tanzania labs pushed on 2026-09-30, compared row by row with the same shape queried
  from Tanzania's v1 `OpenLDRData`. The test copy stays out of the pack.
- HONEST NON-PROOF: the Mozambique codes, the Mozambique dictionary joins on real data, and anything
  the three missing functions do.

## 8. Testing (core)

- Export then import round trip on a fresh store.
- Skip versus replace; replace keeps the id.
- One bad query writes nothing; a non-SELECT query is refused; an unknown format or version is
  refused.
- Connector resolution: default by name, `--connector`, none found.
- Route tests pinning both wire shapes.
- CLI parsing and exit codes.
- Studio tests for the two sheets (named files only, never the whole studio suite).

## 9. Out of scope

- The other 17 Mozambique views (later batches).
- A single content-pack file and marketplace artifacts (D6, revisited after testing).
- Porting the three missing functions.
- Exporting reports, designs, value sets or registers through the new export.
