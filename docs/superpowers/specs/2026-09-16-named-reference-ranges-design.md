# Named reference ranges, picked at the bench, design

**Date:** 2026-09-16
**Status:** approved in brainstorming, not planned yet

## 1. What this is for

Today the server picks a reference range from the patient's sex and age alone. Two women aged 15 or more, one
living in the lowlands and one in the highlands, get the same haemoglobin range, and the catalog has
no way to hold both. OpenLDR CE runs centrally, so one install serves labs at every altitude. A
range per lab does not fit.

This design gives each range a name, lets the person entering results pick the range for each
parameter, and warns when the pick does not fit the patient's sex or age.

It follows bench result entry (`2026-09-16-bench-result-entry-design.md`).

## 2. What already exists, measured 2026-09-16 at `d881d225`

- **A range has six fields.** They are `low`, `high`, `unit`, `sex`, `ageLow` and `ageHigh`
  (`packages/bootstrap/src/result-params.ts:15-22`). Nothing else can decide which range applies.
- **Ranges live inside the test's stored properties.** `parseResultParams` reads them
  (`result-params.ts:54-71`). They are not a table, so a new field needs no migration.
- **The server picks one range** with `matchBand`, which takes the first range whose sex and age fit
  (`result-params.ts:79-89`). It reads the patient's `gender` and whole years from `birthDate`
  (`apps/server/src/test-catalog-routes.ts:78-88`).
- **The results sheet already receives every range** of each parameter, and the one matched
  (`resultParamsFor`, `packages/bootstrap/src/test-catalog.ts:982-1014`; studio copy
  `CatalogResultParam`, `apps/studio/src/api.ts:2552-2556`).
- **On submit, the stored range is whatever the sheet sent.** `testBandsFrom` copies each result's
  band (`apps/server/src/forms-routes.ts:92-103`), and the extractor writes it as the Observation's
  `referenceRange` (`packages/forms/src/extract/test-results.ts:29-36`). Nothing checks it against
  the catalog.
- **The range editor on the Test catalog page edits low, high and unit only**
  (`apps/studio/src/test-catalog/TestSheet.tsx:311-340`). It cannot show or set sex and age, and it
  cannot reorder ranges. Its Add band and Remove controls are standalone buttons.
- **The four patient sex codes are already defined** by the FHIR package's Patient schema
  (`packages/fhir/src/resources/patient.ts:15`).

## 3. Settled with the operator, 2026-09-16

1. **The person entering results picks the range.** Each range has a name, and the bench chooses by
   name. CE stores no altitude, on the facility or the patient.
2. **The bench always picks from every range on the parameter.** Sex and age only choose which range
   starts selected.
3. **A pick that does not fit the patient warns and is allowed.** The out-of-range flag works the same
   way and never refuses a value.
4. **The pick is per parameter.** A full blood count with three parameters has three pickers.
5. **Names are typed per range.** There is no managed list. A name only needs to be clear within its
   own parameter.
6. **The server refuses a submit whose range is not in the catalog.** The stored range is clinical data
   the catalog owns, so an edited request must not be able to invent one.

## 4. Defining ranges: the Test catalog page

**The range.** `ResultBand` gains `name: string | null`. The studio labels a range with no name from
its sex and age, such as "Women 15+", "Men", "Under 5" or "Anyone". Ranges saved before this change
keep working without edits.

**The editor.** Each range row holds name, low, high, unit, sex, age from and age to. The sex choice
offers the four codes from the Patient schema, sent by `GET /api/test-catalog/options` as `sexes`, so
the studio names none. Blank means any.

Per AGENTS.md section 5, the row's actions go in a `⋯` menu: move up, move down, remove. Add range
moves into the parameter's `⋯` menu. This replaces the standalone Add band and Remove buttons.

Order still matters. It decides which range starts selected at the bench.

**Checks on save.** The save trims each name, and a blank name means none. Two ranges on one
parameter may not share a name, because the bench could not tell them apart. `ageLow` may not exceed `ageHigh`, and `low` may
not exceed `high`. Each refusal names the parameter and the range.

## 5. Entering results: the Lab order results sheet

**The picker.** Each numeric parameter with ranges shows a range picker beside its input, listing
every range by name or label. It starts on the first range that fits the patient, the same rule as
`matchBand`. When none fits, it starts empty, and a result submitted with no range stores no
`referenceRange`, as today.

**Fit, worked out on the server.** For each range, `resultParamsFor` answers `fits` as `yes`, `no` or
`unknown`. `unknown` means the range names a sex or age and the patient's record lacks it. The browser
still never works out an age.

**The warning.** Picking a range whose `fits` is `no` shows a short warning under the picker, such as
"This range is for men 15+". `unknown` shows nothing. The bench can keep any pick.

**The flag.** The out-of-range flag and the range text under the input use the picked range.

**What is stored.** The result's band is the picked range, name included. The extractor writes the
name as `referenceRange.text`.

**The check on submit.** Before extraction, the forms route compares each result's band with the
ranges the catalog holds for that test and parameter, field by field, name included, with a missing
name read as none. A band that matches none refuses the whole submit with a 400. The message names the test and
parameter, says the ranges changed, and asks the bench to reopen the test.

## 6. Fields a strict copy would drop

The browse-tests slice met this bug. Zod silently strips a key its schema does not declare. Every
place that copies a range field by field must add `name`, each with a test that fails if the name is
lost.

- `toBand`, `packages/bootstrap/src/result-params.ts:44-51`
- the route's `band` schema and its transform, `apps/server/src/test-catalog-routes.ts:27-48`
- the answer's band type, `packages/forms/src/test-details.ts:20`, and its parse at `:62`
- the extraction context's band type, `packages/forms/src/extract/extract.ts:36`
- the studio's own copies, `CatalogResultBand` and `CatalogTestResultParam`,
  `apps/studio/src/api.ts:2552-2562`

## 7. The five places

1. **UI.** The range editor (section 4) and the results sheet picker (section 5), in `apps/studio`.
2. **CLI.** None. The CLI has no command that edits a test's ranges today, and picking is data entry,
   which AGENTS.md section 6 item 2 leaves out. The CSV import and export carry no ranges and do not
   change.
3. **Docs.** The Test catalog and Forms guides, in-app and web, in en, fr and pt.
4. **Mobile.** A range row holds seven inputs, so it wraps at 375px. The picker sits under the input
   on a narrow screen. Only a real phone can confirm the sheet's bottom edge.
5. **Changelog.** `pnpm make:changelog` after the merge.

No migration and no seeding.

## 8. Tests, and what each layer proves

- **Bootstrap.** `toBand` and `parseResultParams` keep a name. `fits` answers `yes`, `no` and
  `unknown` for sex, age and a patient missing either. The save checks refuse a duplicate name and
  crossed edges.
- **Route.** A range name survives a create and an update through the zod schema. `options` answers
  `sexes`. The forms submit route refuses a band that is not in the catalog and accepts one that is,
  named or unnamed.
- **Forms.** The answer parse keeps a name, and the extractor writes `referenceRange.text`.
- **Studio.** The editor shows and saves name, sex and age, and moves or removes a range from the row
  menu. The results picker starts on the first fitting range, warns on a `no` and stays quiet on
  `unknown`. The flag follows the pick.

**HONEST NON-PROOF.**

- pg-mem is not Postgres. Ranges are JSON inside a property, so nothing here depends on SQL ordering.
  Only a live submit on the dev database proves the refusal and `referenceRange.text` reach a stored
  Observation.
- The editor and picker at 375px on a real phone.
- A central install feeding labs. Ranges sync inside the test, so a lab should get names with the
  catalog, but nobody has run a two-node check.

## 9. Known effects, not handled here

- **A range edited after the sheet opened refuses the submit.** The bench reopens the test row, which
  reloads the ranges.
- **A saved draft from before this change** carries ranges with no name. It still submits while the
  catalog ranges stay unnamed. Once someone names them, the server refuses that draft until the bench reopens the test.
- **The warehouse is unchanged.** `lab_results` does not gain the range name. Reports that need it are
  their own piece of work.
- **This does not rewrite submitted orders.**

## 10. Deferred, and why

- **Altitude as data** on a facility or patient. The operator chose picking at the bench.
- **A managed list of range names.** Decision 5.
- **Choosing once per order or per test.** Decision 4.

## 11. Open for the operator

- **Sex labels.** The server sends the four codes. Showing "Female" rather than `female` in en, fr and
  pt needs translated labels. Either the studio holds one i18n key per code, which names the codes in
  the studio's translation files, or the server sends labels in each language. The plan should not
  pick one without the operator.
