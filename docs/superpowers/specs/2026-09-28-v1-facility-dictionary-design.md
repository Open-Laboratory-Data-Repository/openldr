# v1 facility dictionary in CE (Mozambique slice A)

Date: 2026-09-28. Status: design agreed in chat, awaiting spec review.

## 1. Goal

Mozambique builds its reports and dashboards from SQL views over OpenLDR v1. Most of those views
join `OpenLDRDict.dbo.viewFacilities` to turn a DISA facility code into a facility name, province
and district. CE must answer the same question for the codes it receives, so the views can later
be rewritten as CE custom queries.

This slice gets the facility names and locations into CE and links them to incoming codes. It does
not port any view.

## 2. The user action that is broken today

A Mozambique operator imports their 2,830 facilities into CE. The report still shows bare DISA
codes such as `APHLO`, with no name, province or district. Each incoming code resolves only after
someone maps it by hand, one at a time.

## 3. Evidence

Source files: `corlix/fixtures/Mozambique_views/`. The dictionary backup was restored locally as
`OpenLDRDict_MZ` for these checks.

| Fact | Proof |
|---|---|
| viewFacilities is `Facilities` joined three times to `HealthcareAreas` (country, province, district). It drops rows with no province or district code. | `OpenLDRDict_MZ` `sys.sql_modules` for `viewFacilities` |
| viewFacilities is a standard v1 view, not a Moz one. | Tanzania's `OpenLDRDict` has it too |
| The Moz views join viewFacilities 64 times, for four facility roles. | `openldr-views-script.sql` |
| Moz `FacilityCode` is DISA's own facility code. | All 213 `DisaPoc` and 341 `Disalink` codes exist in `Facilities`. All 106 `Laboratories` rows are vendor `DISA`. In Tanzania, v1's dictionary shares 8,723 codes with DISA's `LOCNDIC4`, with identical names, and 94% of v1 request rows carry a DISA code. |
| CE receives that code as `diagnostic_reports.performer`. | `cdr-toolchain apps/cli/src/export/fhir-transform.ts:255-266`, `v2-transform.ts:341-373` |
| A code resolves only through an active SAME-AS row in `term_mappings`. | `packages/bootstrap/src/facility-reconcile.ts:608-626` |
| Every writer of `term_mappings` writes one row at a time. | `packages/db/src/terminology-admin-store.ts:937`, `:1080` |
| A code is unique within its register. | `packages/db/src/migrations/internal/088_facility_drop_old_codes.ts:55` |
| The warehouse's resolved facility table carries region, district and council, not zone. | `packages/db/src/schema/external.ts:155-176` |

Moz data facts that shape the import:

- 2,830 rows in the view. All `FacilityCode` values are unique. None is all digits.
- 171 rows have a blank `FacilityType` and a 1 or 2 character code. They are provinces and districts,
  not facilities.
- 525 rows have an empty `FacilityNationalCode`. 248 of them are active health facilities.
- 329 national codes carry 2 to 6 DISA codes each, usually one active and one retired
  (`MICAN` and `MICA` are both "CS Micane").

## 4. Decisions

| # | Decision |
|---|---|
| D1 | Key the Moz register on the **DISA code**. `MICAN` and `MICA` stay two rows, as in v1. The MISAU national code goes to extras. |
| D2 | Link incoming codes with a **bulk action that writes ordinary SAME-AS mappings** (L2). No second resolution route. |
| D3 | Import through the **existing importer**. No importer change. |
| D4 | Build the import file from the dictionary database with a **CSV export query**, not from Excel. Excel already turned `01` into `1`. |
| D5 | **Drop the 171 area rows** before import. |
| D6 | cdr-toolchain needs **no change** in this slice. |

## 5. Design

### 5.1 The import file

A generic query over any v1 `OpenLDRDict`, documented in the operator docs:

```sql
SELECT FacilityCode, Description, FacilityType, HFStatus, FacilityNationalCode,
       CountryName, ProvinceName, DistrictName
FROM dbo.viewFacilities
WHERE ISNULL(FacilityType, '') <> ''
```

Exported to CSV with every column as text. The `WHERE` drops the area rows (D5). This is
documentation, not code. CE never connects to v1.

### 5.2 Register and import (no code change)

1. The operator creates a register in the studio, for example "Mozambique DISA facility codes".
2. The operator imports the CSV into it with this column map:

| File column | CE field |
|---|---|
| `FacilityCode` | `national_code` (stored as `facility_code`) |
| `Description` | `name` |
| `ProvinceName` | `region` |
| `DistrictName` | `district` |
| `CountryName` | `country` |
| `FacilityType` | `level` |
| `HFStatus` | `status` |
| `FacilityNationalCode` | extras |

`ProvinceName` goes to `region`, not `zone`, because `facility_map` projects region and not zone.
The importer's existing value-mapping step asks what each `FacilityType` letter and each `HFStatus`
value means.

### 5.3 Link matching codes (new)

One function in `@openldr/bootstrap`, called by the route and the CLI:

```ts
linkMatchingFacilityCodes(deps, { registerUrl: string, apply: boolean }): Promise<LinkMatchingResult>
```

**Refusals.** An unknown or deactivated register is refused with the same checks and messages the
import doors use (`resolveFacilityRegisterForImport` in `packages/db/src/facility-register-sources.ts`).

**Candidates.** Every observed code from `resolveObservedFacilities`, the same fold the Observed tab
shows. Each is a pair: observed system and code.

**Match.** Exact string equality between the observed code and a registry row's `facility_code`,
where that row's `facility_system` is the chosen register. No trimming. No case folding. The
observed code is stored exactly as it arrived, so a fuzzy match would link on a guess.

**Outcome per observed code.** Exactly one of:

| Outcome | When | Written |
|---|---|---|
| `linked` | No facility-route mapping exists, and the code matches one row | a SAME-AS mapping |
| `already-linked` | It already resolves to that same row | nothing |
| `kept` | It already has any other facility-route mapping: resolved elsewhere, ambiguous, target missing, or mapped to a non-facility system | nothing |
| `no-match` | Nothing in the register has that code | nothing |

`kept` never overwrites a person's decision. The operator fixes those by hand in the Observed tab.

**The row written.** Through `termMappings.saveExclusive`, the same writer the manual dialog uses.
`fromSystem` is the observed system and `fromCode` the observed code. `toSystem` is
`FACILITY_REGISTRY_SYSTEM`, `mapType` is `SAME-AS` and `isActive` is true. `toCode` is the row's
concept code from `registryConceptRows`, because resolution derives the code that way
(`facility-reconcile.ts:649-654`). A plain `facility_code` would fail to resolve when two registers
share a code.

**Dry run by default.** `apply: false` returns the outcomes and writes nothing, the same contract
as `scan-observed` and `publish`.

**Apply.** All writes go in one transaction through `saveExclusive`'s `opts.trx`. All land or none
do. After commit, enqueue the existing `facility-map-rebuild` job, so the warehouse's `facility_map`
picks up the links. `saveExclusive` already records each row for lab-to-central sync.

**Audit.** One audit event per applied run, with the register and the four counts.

**Result.** The four counts plus the list of pairs per outcome, for the preview.

### 5.4 Route

`POST /api/facilities/link-matching`, guarded by `MANAGE` like the scan and publish routes. Body:
`{ registerUrl, apply }`. Returns `LinkMatchingResult`.

### 5.5 Studio

In the Observed tab's header `⋯` menu (`apps/studio/src/facilities/ObservedTab.tsx:295`), a new item
"Link matching codes". It opens a Sheet:

- A register picker (shadcn, label left and input right).
- A dry-run preview: the four counts and a paginated table of `linked` pairs (`TablePagination`).
  `LoadingState` while the dry run runs, and `StripedEmpty` when nothing would link.
- The sheet header's `⋯` menu holds "Link N codes", disabled when N is 0.
- A toast on success, and the Observed tab refreshes.

Checked at 375x812.

### 5.6 CLI

`openldr facilities link-matching --register <url> [--apply] [--json]`, registered next to
`scan-observed` in `packages/cli/src/facilities.ts`. Audited as `actorName: 'cli'`. There is no
`--force`: it deletes nothing, and every row it writes can be undone one at a time.

### 5.7 Docs and changelog

- In-app docs, en, fr and pt (`apps/studio/src/docs/<ver>/{en,fr,pt}/facilities.md`): the action,
  its four outcomes, the export query in 5.1, and the Moz column map as a worked example.
- Web docs in the same three languages. `docs/CLI-REFERENCE.md` and `docs/HTTP-API.md`.
- `pnpm make:changelog` after merge.

## 6. Testing

Bootstrap, on pg-mem:

- A code in the register links. A code not in it reports `no-match`.
- A code with an existing mapping to a different row is `kept`, and that mapping is unchanged.
- A code already mapped to the same row is `already-linked` and writes no duplicate.
- `MICAN` does not match `mican`.
- Two registers sharing a code: the written `toCode` resolves, proven by running
  `resolveObservedFacilities` after the link.
- A dry run writes nothing.
- Apply is all or nothing: a failure part way leaves no rows.
- An unknown or deactivated register is refused.

Route test pins the request and response shape. CLI test covers dry run, `--apply` and `--json`.
Studio component test covers the sheet.

These prove the logic on pg-mem. They do not prove Postgres behaviour or real data.

**Live check.** No Moz request data exists here. Tanzania can stand in, because its v1 dictionary
uses DISA codes too: export Tanzania's viewFacilities with 5.1, import it into a test register on
the dev CE, run the link, and compare `facility_map.name` with `performer_display` for the linked
codes.

**HONEST NON-PROOF.** The Moz match rate is unknown until Moz pushes real data. The Tanzania run
proves the mechanism, not Moz coverage.

## 7. Out of scope, listed

- **B.** The testing lab (and receiving, if needed) as a second facility on the wire and in the
  warehouse. cdr-toolchain sends only the requesting clinic today.
- **C.** The v1 request columns the views read and CE doesn't store (rejection code, analyser,
  analysis time, ward, OBR set, and others).
- **D.** Porting the 19 other views as custom queries. Custom queries run on Postgres only.
- A Mozambique config in cdr-toolchain. Only `tanzania.yaml` and `zambia.yaml` exist.
- Creating a register from the CLI. No command exists, so a headless lab can't finish this setup
  without the studio. This is an existing gap.
- Latitude and longitude from `HFLattLong` (1,575 rows). `facility_map` doesn't carry coordinates.
- Merging `MICAN` and `MICA` under one national facility (option B, not chosen).

## 8. Open question for Mozambique

What each `FacilityType` letter means: `H` 2,554, `Q` 60, `Y` 20, `F` 17, `C` 4, `G`, `P`, `T`, `V`
one each. The value-mapping step needs the answer during import.
