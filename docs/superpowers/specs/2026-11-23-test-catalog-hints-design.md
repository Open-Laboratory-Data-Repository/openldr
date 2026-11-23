# Test catalog: ages in days, units from UCUM, LOINC hints

Status: for operator approval, 2026-11-23.

## 1. Why

A Corlix comparison, checked against CE's code, found the Test catalog sheet weaker than Corlix's test editor in six confirmed ways (verdict table, 2026-11-23). The operator chose three to build:

1. **Range ages in days.** Ranges hold whole years only (`packages/bootstrap/src/result-params.ts:24-25`), and a patient's fit uses whole years (`:153`). Newborn and infant ranges cannot be set. A newborn gets adult ranges or none.
2. **Units from a list.** A band's unit is typed by hand (`apps/studio/src/test-catalog/TestSheet.tsx:400-405`). CE already ships the full UCUM code system (`packages/bootstrap/src/seed.ts:42`).
3. **LOINC hints.** Picking a LOINC code fills nothing else. CE's LOINC ontology already holds what Corlix used:
   - `specimenCodes(loinc)`, the SNOMED specimens with their equivalence;
   - `answerOptions(loinc)`;
   - `panelMembers(panel)`.

   These are at `packages/db/src/ontology-store.ts:416-446`. The LOINC concept properties hold `CLASS` and `SYSTEM` (`packages/terminology/src/loaders/loinc.ts:24-31`), and the ontology build keeps `EXAMPLE_UCUM_UNITS` (`packages/terminology/src/ontology/build.ts:105-106`).

The aim is to make defining a test faster and more consistent, from shared codes, as Corlix's design argued. Corlix's spec is `docs/superpowers/specs/2026-06-10-test-definition-ontology-design.md` in that repo.

## 2. Goals and non-goals

Goals:
- A range sets its age window in days, months or years.
- Every fit check compares the patient's exact age: the catalog's `fits`, bench result entry, and the lab plugin's ranges.
- A band's unit is picked from UCUM. A unit outside UCUM can still be typed, with a short note.
- When LOINC is loaded, picking a test's LOINC code suggests:
  - its category (LOINC class);
  - its specimen types (from SNOMED);
  - one result field with its unit, or a coded field with LOINC's answer list;
  - for a panel, one result field per member test ("Fill from panel").
- Suggestions never overwrite a value someone typed. A suggestion fills an empty field, and otherwise shows as a hint.

Non-goals:
- Altitude, pregnancy, source and validity fields on ranges. The operator ruled altitude a named range picked at the bench (named ranges design 3.1).
- New result types such as organism or antibiogram. Microbiology is a non-goal of the lab plugin design.
- Shipping LOINC. It is a licensed download. Labs load it with `openldr terminology import loinc` and build its ontology as today.
- Changing how a test syncs from central.

## 3. Calls I made, for the operator to check

1. **Age unit per range.**
   - `ResultBand` gains `ageUnit: 'd' | 'mo' | 'y'`. A missing unit means years, so every saved range works unchanged.
   - A patient's age is worked out in days from the birth date.
   - A window compares in its own unit: days exactly, months as whole calendar months, years as whole years.
   - A range labels itself by its unit, for example "Under 28 days" or "1 to 12 months".
2. **The fit rule is one shared function** in `@openldr/bootstrap`. It is used by `resultParamsFor`, the bench sheet and the plugin host. The lab plugin keeps its own Rust copy of the label rules only. It reads `fits` from CE.
3. **UCUM picker.**
   - The unit field becomes a search over the UCUM code system, with the existing term search (`TermPicker`).
   - A typed value that is not a UCUM code is kept, and the sheet says "Not a UCUM unit".
   - Saved ranges are not checked or changed.
4. **Specimen suggestion.** LOINC gives SNOMED codes. A specimen-type concept matches when:
   - its code is that SNOMED code; or
   - the lab's local concept map translates it to that SNOMED code (CE's `$translate`, `packages/terminology/src/operations.ts:87`).

   The default specimen list uses local codes (BLD, UR, CSF, SPT; migration 014). Until someone maps them, the sheet shows the SNOMED suggestion as text, with a line saying how to make it pick automatically. One `equivalent` match is ticked. Several matches are suggested and none is ticked, as Corlix does (`specimenMatch.ts`).
5. **Category suggestion.** The LOINC class is suggested only when the test-category value set holds a concept whose code or display equals it. Otherwise it is shown as text.
6. **Result fields from LOINC.**
   - "Use LOINC's result field" adds a result field to `urn:openldr:default_result`, with the LOINC code as its code, LOINC's name and LOINC's example unit. It saves through the existing result field path, and needs `testCatalog.edit` like that path.
   - An existing field with the same code is reused.
   - A LOINC code with an answer list makes a `coded` field. Its answers become a value set `urn:openldr:valueset:loinc-answers:<code>`, made from LOINC's answer list, in the same save.
   - "Fill from panel" does the same for each member test, in LOINC's order.
7. **Where hints live.** One read-only route, `GET /api/test-catalog/loinc-hints/:code`, answers everything in point 1 for a code. Both the sheet and a CLI command `openldr test-catalog loinc-hints <code>` use it, through one bootstrap function.
9. **Turnaround and review on the test** (operator, 2026-11-23, after Corlix's editor). A catalog test gains:
   - `expectedTatHours`, a number or null;
   - `criticalTatHours`, a number or null;
   - `requiresVerification`, a boolean, true by default.

   They are stored as concept properties beside `specimenTypes`, so they need no migration and they sync from central with the test. They are edited in the test sheet's basic information, in the CSV import and export, and on the CLI, and answered by `testCatalog.get` to plugins. CE itself only stores and shows them. The lab plugin uses `requiresVerification` for auto-release, and TAT for its worklists, in its plan 3.
8. **The lab plugin** follows in the same plan. Its band equality check and labels gain `ageUnit`. Its fit comes from CE as today.

## 4. Places that copy a range field by field

Each must carry `ageUnit` (the named ranges design 6 list, updated):
- `toBand` and `parseResultParams`, `packages/bootstrap/src/result-params.ts`;
- the route band schema, `apps/server/src/test-catalog-routes.ts`;
- `packages/forms` band types and the extractor's `referenceRange` (age as `{ low, high, unit }` in UCUM `d`, `mo` or `a`);
- the studio's `CatalogResultBand`;
- the lab plugin's band check (`src/results.rs`) and labels (`ui/src/results/ranges.ts`).

A test per place fails when `ageUnit` is dropped.

## 5. Five places (AGENTS.md section 6)

- **UI:** the Test catalog sheet; mobile at 375 px.
- **CLI:**
  - `test-catalog params --set` carries `ageUnit` through `parseResultParams`;
  - a new `test-catalog loinc-hints <code>`;
  - a new `test-catalog result-fields from-loinc <code> [--panel]`, which shares the bootstrap function the sheet uses.
- **Docs:** the Test catalog guide, in-app and web, in en, fr and pt.
- **Mobile:** a range row gains one picker. It wraps at 375 px.
- **Changelog:** after the merge.

## 6. Proof and honest non-proof

- **pg-mem tests** cover the fit rule at each unit edge, hints from a small LOINC fixture, and creating fields from a panel.
- **A live run** on a throwaway install loads the LOINC fixture under `packages/terminology` test data and builds its ontology.
- **HONEST NON-PROOF.** No full LOINC release is on this machine. Suggestions on real LOINC data, and the speed of the hint read on a full release, are unproved until the operator loads a licensed LOINC copy.
