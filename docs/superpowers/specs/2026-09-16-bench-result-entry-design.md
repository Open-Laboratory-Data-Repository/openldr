# Bench result entry on the Lab order, design

**Date:** 2026-09-16
**Status:** approved in brainstorming, not planned yet

## 1. What this is for

A lab with no analyser feed and no LIS types its results into CE. The person who takes the order
also types what came off the bench. CE is the system of record for those results, beside the
results that arrive from CDR through ingest.

The Lab order's Tests field already lists this lab's tests (test catalog S4). This design turns
each chosen test into a row the operator can open, fill in and reject.

## 2. What already exists, measured 2026-09-16 at `c31e80b7`

Read these before building. Three of them remove work this design would otherwise invent.

- **Result parameters are already a code system.** `urn:openldr:default_result`, one concept per
  analyte, carrying `parm_units` and a `result_role` of `result`, `specimen`, `metadata` or `admin`
  (`packages/terminology/src/loaders/result-parameters.ts:5-25`). Migration 069 seeds the ValueSet
  of the ones whose role is `result`. A test's analytes are these codes. Do not invent new ones.
- **PARMDICT's `reference` column is a citation, not bounds** ("Roche Reference Ranges for Adults
  and Children"), verified against the live dictionary (`result-parameters.ts:21-24`). No reference
  range exists anywhere in CE today. Never parse that column as a range.
- **The warehouse already splits result values** into `numeric_value`, `numeric_units`,
  `coded_value`, `text_value` and `abnormal_flag` on `lab_results`. The projection shape is there.
- **`lab_requests` holds one row per order**, with the first coding as `panel_code`
  (`packages/db/src/relational/service-request.ts:13-15`). There is no per-test row and no rejection
  column anywhere in the warehouse.
- **Nothing ships using Observation extraction.** The machinery exists (a field flagged
  `observationExtract` with a code, `packages/forms/src/extract/extract.ts`), but no sample form
  uses it.
- **`referenceDependsOn` now does something.** S4 made a field that depends on the Tests field
  narrow its own list. This design reuses that mechanism rather than adding another.
- **There is no route to read a submitted order back.** Only `POST /api/forms/:id/responses`
  exists (`apps/server/src/forms-routes.ts:379`), and no page lists submissions for a bench.

## 3. Settled with the operator, 2026-09-16

1. **Bench entry.** The studio originates results for labs with no analyser feed. It is not a
   correction surface for ingested results.
2. **A test names its result parameters.** One test can yield several values. Each is an existing
   result parameter concept.
3. **Reference ranges vary by sex and age band.** One parameter carries several bands. No per-lab
   override in this slice.
4. **Results are typed in the same session as the order.** The submit carries the order and its
   results together.
5. **No worklist, and no way to reopen a submitted order, in this slice.** The operator refused a
   recent-orders strip on the grounds that it would show bench orders only, while ingested orders
   are the larger pile. A worklist spanning both is its own piece of work.
6. **No verification step.** Every result submitted is final. The per-test "requires verification"
   flag the operator first asked for (configurable per test, default on) is deferred to the slice
   that can reach an existing order, because a second pair of eyes needs a way back in.
7. **Rejections are coded, at order level and test level**, from two seeded value sets. This matches
   how CDR rejection is already read: rejected means the reason code is populated.
8. **Authoring happens in the Test catalog sheet only.** Import and export columns for parameters
   and ranges are out of scope.
9. **Rejections are not projected to the warehouse in this slice.** They reach FHIR and stop there.
10. **Section 5 gets a second look after implementation.** The operator asked to revisit the
    storage and rejection shape once the code exists, rather than settle it further now.

## 4. The data

Three additions to a catalog test's concept properties, beside `shortName`, `category` and
`specimenTypes`.

- **`resultParams`**: an ordered list of `{ system, code }` into `urn:openldr:default_result`. A
  test with none produces no result inputs, which is how every test behaves today.
- **`resultType`** per parameter link: `numeric`, `coded` or `text`. The sheet draws the input from
  it, and the warehouse already splits the three. A `coded` parameter also names the ValueSet its
  answers come from, so the studio never carries a code list (AGENTS.md section 8).
- **`ranges`** for a `numeric` parameter: a list of bands, each `{ low?, high?, unit, sex?, ageLow?,
  ageHigh?, ageUnit? }`. A band with neither sex nor age is the catch-all. Text and coded parameters
  store no ranges.

Two new ValueSets, seeded by migration and editable on the Terminology page: order-level rejection
reasons, and test-level rejection reasons. They are separate because the causes differ. A whole
requisition is rejected for a wrong or unlabelled specimen. One test is rejected for haemolysis or
short volume.

Nothing here changes how the catalog syncs. These are more properties on concepts that already flow.

## 5. What the bench types, and where it goes

**The Tests field does not change.** It stays a reference field bound to the lab's test list,
checked by `ops.validateCode` at submit. Widening its answer would break that check and the capture
round-trip.

**A second field carries the detail.** One new field type, `testDetails`, with
`referenceDependsOn: 'tests'`, the mechanism S4 built for the specimen picker. Its answer is keyed
by `system|code` of each chosen test and holds the chosen specimen, an optional rejection, and one
value per result parameter.

**The QuestionnaireResponse stays the record of capture.** The field serialises as nested items: a
child item per test, a grandchild per parameter, each answer a plain FHIR value. Nothing is stored
outside the response, so the ingest path can replay what the bench typed.

**A new extractor** in `packages/forms/src/extract/`, beside the two that exist, emits one
Observation per result parameter: `code` the parameter's own coding, `subject` and
`effectiveDateTime` from the extraction context, `value[x]` by result type, `referenceRange` from
the band that matched, and `status: 'final'`. `ServiceRequestExtractor` is untouched, so S4's
LOINC-first ordering holds.

**Rejection in FHIR.** An order-level rejection sets `ServiceRequest.status = 'revoked'`, and the
specimen carries `Specimen.status = 'unsatisfactory'` with the reason in `Specimen.condition`. A
test-level rejection emits an Observation with `status: 'cancelled'`, no value, and the reason
coding.

**Known effect, accepted.** None of those rejections reach the warehouse. `lab_requests` has one
row per order and no rejection column, and `lab_results` has none either. A rejected test is stored,
readable in FHIR, and invisible to reports until a later slice adds the columns. The docs say so.

## 6. The screens

Every rule in AGENTS.md section 5 applies. Actions in a `⋯` menu, sheets rather than dialogs,
label left and input right, `StripedEmpty` for empty and `LoadingState` for loading, shadcn only,
and `TablePagination` on every table.

**Authoring, on the Test catalog page.** `TestSheet.tsx` gains a "Result parameters" section in the
existing one-grid layout. A row per parameter with its type, and a `⋯` menu to edit its bands or
remove it. Adding one uses a picker over the ValueSet migration 069 seeds, so no vocabulary is
typed. A numeric parameter's bands are a small table of low, high, unit, sex and age window.

**Entry, on the Lab order capture page.** The `testDetails` field renders the list directly under
the Tests input. Each row shows the code, the name, the description when there is one, the category
code when mapped, and one line of state: the chosen specimen, or that none is set, or the rejection
reason. Its `⋯` menu holds open, set specimen type, reject with reason, and remove.

**The sheet.** Clicking a row opens a `Sheet` in the pattern of `FieldEditorSheet.tsx`, carrying
the specimen picker, the matched band as read-only text, and one input per result parameter:
numeric with its unit, a picker for coded, a text box for text. A numeric value outside its band
gets a quiet flag beside the input. It never refuses the value.

**Rejecting** from either menu opens a small sheet with a reason picker over the matching ValueSet.

**Mobile.** At 375px the sheet is the surface that matters. A picker inside a sheet cannot scroll
sideways, so the parameter list wraps. Only a real phone can confirm the bottom edge.

**i18n.** Every new string lands in `en.ts`, `fr.ts` and `pt.ts` together. A missing key renders as
literal braces.

## 7. The server, the CLI and the docs

**Two routes**, both shaped like S4's.

- `POST /api/test-catalog/result-params`, gated on `forms.view`, takes the chosen tests and the
  patient reference and answers each test's parameters with type, unit, any coded ValueSet, and the
  single band that applies to that patient. Sex and age matching happen on the server, where the
  patient's record already is. The studio does no date arithmetic and names no ValueSet.
  `forms.view` rather than `terminology.view`, because a Lab Technician holds
  `forms.view` and `forms.submit` only (`packages/rbac/src/presets.ts:52`).
- `PUT /api/test-catalog/:code`, the existing authoring route gated on `terminology.manage`, gains
  `resultParams`.

**CLI parity** (AGENTS.md section 6, item 2). Authoring is catalog administration, so
`openldr test-catalog params <code>` lists a test's parameters and a set form writes parameters and
bands. Shared logic lives in `@openldr/bootstrap` so the route and the CLI call identical code.
Bench entry is data entry, so it gets no command, exactly as S4 got none.

**Docs** in-app and web, in English, French and Portuguese: what a result parameter is, how a band
is matched, that a rejected test is stored but not yet reported on, and that results are typed with
the order. Then `pnpm make:changelog` in the same slice.

## 8. Tests, and what each layer proves

- **Store tests (pg-mem):** parameters and bands round-trip; band matching picks the right band for
  a sex and an age, including the catch-all and an age exactly on a boundary. pg-mem is not
  Postgres, so the live check still has to run.
- **Extractor tests (pure):** one Observation per parameter, the right `value[x]` per type, the
  matched `referenceRange` attached, a cancelled Observation for a rejected test, and no change to
  what `ServiceRequestExtractor` writes.
- **Route tests:** both wire shapes and both gates. A typecheck does not pin either
  (AGENTS.md section 7).
- **Studio tests (jsdom):** the row list, the sheet, one input per result type, the out-of-band
  flag, and both rejection paths.

**HONEST NON-PROOF, stated in advance.**

- No real bench will have used it.
- Band matching against real patient records needs the live check.
- The sheet at 375px on a real phone. Headless Chromium cannot see the `vh` against `dvh` class of
  bug.
- Rejections are invisible to reports by decision, not by accident.

## 9. Deferred, and why

- **A worklist that reaches an existing order**, bench-entered and ingested alike. Everything below
  depends on it.
- **Verification**, configurable per test and defaulting to on. It needs a way back into an order.
- **Rejection in the warehouse.** Needs a per-test row or new columns, and the MSSQL variant with
  them.
- **Per-lab range overrides.** The lab settings pattern already exists if this is wanted later.
- **Parameters and ranges in the import and export file.** Bands do not flatten into a CSV cell
  cleanly.
- **Panels that map one test to a nested set of tests.** A test names parameters, not other tests.

## 10. Open items for the plan

1. **The next free migration number.** 105 was taken by test catalog S4 at `c31e80b7`. Re-check
   every branch and worktree, including the operator's Linux machine, before writing the migration.
2. **How the `testDetails` answer passes `validateAnswers`.** The existing validator knows scalar
   and coding answers. Decide whether it learns this shape or the field is excluded by type.
3. **Whether `toQuestionnaire` needs items for the nested result fields**, given that the chosen
   tests are dynamic while the stored schema is static.
4. **Where the patient's sex and birth date come from at capture time.** The reference picker
   carries a display only, so the route resolves the patient itself.
