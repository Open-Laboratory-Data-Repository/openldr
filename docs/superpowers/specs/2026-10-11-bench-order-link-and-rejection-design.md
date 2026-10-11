# Bench entry: link results to the order, and reject a whole order

Date: 2026-10-11. Status: approved in chat, written for review.

Follows `2026-09-16-bench-result-entry-design.md` (bench result entry, shipped `0935d73e`). That spec
left two gaps, both found by the live check on 2026-10-11.

## 1. What is broken today

**Gap 1. Results are not linked to their order.** A bench submit writes one ServiceRequest and one
Observation per result. No Observation carries `basedOn`. The warehouse fills
`lab_results.request_id` from `basedOn[0]` (`packages/db/src/relational/observation.ts:21`), so every
bench result lands with an empty `request_id`. No report can join a bench result to its order.

Live proof, 2026-10-11, order `ZZBENCH-1`: `lab_requests` holds the order, `lab_results` holds three
rows (HGB 9.8, the Gram text, the cancelled Glucose), and all three have `request_id` NULL.

**Gap 4. Order-level rejection was never built.** The old spec (decision 7) and its plan said a bench
can reject the whole order with a coded reason. The live check found:

- The page's ⋯ menu offers Submit and Cancel only (`apps/studio/src/pages/FormCapture.tsx`).
- No answer field holds an order rejection.
- No extractor writes `ServiceRequest.status = 'revoked'` or a Specimen.
- What exists: `RejectSheet` already takes `level: 'order'`
  (`apps/studio/src/forms-runtime/RejectSheet.tsx:23-29`), the server already sends the order
  reasons (`apps/server/src/test-catalog-routes.ts:307`, `rejectReasons.order`), and migration 106
  seeds the codes in `urn:openldr:cs:reject-order` (DUPLICATE, UNLABELLED, WRONGPT).

## 2. Facts this design rests on

- **The ingest bundle step keeps an id a resource arrives with.** `unwrap-bundle.ts:59-61` only makes
  a new id when the resource has none, and `:65` resolves a relative `Type/id` reference to itself. So
  a resource can be given its id before the bundle is built, and others can point at it.
- **The warehouse already has rejection columns on the order.** `lab_requests.rejection_code` and
  `rejection_reason` are filled from the extension `urn:openldr:ext:rejection`, sub-extensions `code`
  (`valueCode`) and `reason` (`valueString`) (`packages/db/src/relational/request-facts.ts:50-56`).
  cdr writes the same shape for DISA rejections (cdr `apps/cli/src/export/fhir-transform.ts:229-234`).
  The old spec's "rejections never reach the warehouse" was written before those columns existed.
- **The warehouse keeps a Specimen's status.** `projectSpecimen` writes `specimens.status`
  (`packages/db/src/relational/specimen.ts:15`).
- **FHIR R4 makes `Specimen.type` optional.** An order-level Specimen may have no type.
- **The order's test row ids come from `lab_requests.id`,** which is the ServiceRequest's resource id
  (`service-request.ts:17`). `lab_results.request_id` holds the same id, so the join is
  `lab_results.request_id = lab_requests.id`.

## 3. Decisions (operator, 2026-10-11)

1. A rejected order is stored **both ways**: the order carries the rejection extension, and a
   Specimen carries `status: unsatisfactory` with the reason.
2. **Rejection wins.** When the order is rejected, no result is written. Each test row shows "Order
   rejected" and its result entry is closed. Values already typed stay in the form, so undoing the
   rejection brings them back, but they are not submitted.

## 4. Part 1: link every Observation to its order

**One helper, one call.** `@openldr/forms` gains a pure function `linkToOrder(resources, newId)`.
It is called once, in the submit route (`apps/server/src/forms-routes.ts`), after the extractors run
and before `toTransactionBundle`.

What it does:

- Find the one ServiceRequest in `resources`. If there is none, or more than one, return the
  resources unchanged. Only a requisition form produces a ServiceRequest, so other forms are not
  touched.
- Give that ServiceRequest an id from `newId()` if it has none.
- Set `basedOn: [{ reference: 'ServiceRequest/<id>' }]` on every Observation that has no `basedOn`.
  That covers bench results, a test's cancelled Observation, and any Observation the generic
  Observation extractor makes from a Lab order field.
- Give the order-rejection Specimen (part 2) an id from `newId()` if it has none, and set
  `ServiceRequest.specimen` to point at it.

The route passes `randomUUID` as `newId`. Tests pass a counter, so expected ids are fixed.

The extractors stay unchanged and independent. Nothing else builds bundles this way: the CLI
(`packages/cli/src/forms.ts`) and the ingest replay converter do not run the bench extractor, and are
out of scope (section 7).

**Effect in the warehouse.** Every bench Observation's `lab_results.request_id` holds its order's
`lab_requests.id`.

## 5. Part 2: reject a whole order

### Capture

**A new field on the Lab order.** `fld-ord-rejection`, a coded field bound to
`urn:openldr:valueset:order-reject-reason`, `required: false`, in the order section, with
`fhirPath: 'ServiceRequest.extension'` and `fhirDiscriminator: { url: 'urn:openldr:ext:rejection' }`. The
field fills that extension, a real R4 element, and the discriminator names which extension it is. The
FHIR path lint rule refuses a path that is not an R4 element, which is why the field does not bind a
path of CE's own. Every reader finds the field by path and discriminator url, never by its id, so an
operator's copy of the form keeps working, and a field bound to some other `ServiceRequest.extension`
is not taken for it. The runtime does not draw a field with this binding as an input. It is set only
through the page's ⋯ menu.

**The ⋯ menu.** On a form that has this field, the page header ⋯ menu adds "Reject order". It opens
`RejectSheet` at `level: 'order'` with the order reasons the server already sends. Choosing a reason
sets the field. When the field is set, the menu shows "Undo rejection" instead, which clears it.
Submit and Cancel stay. This follows AGENTS.md section 5: actions in the ⋯ menu, a Sheet for the
choice.

**What the bench sees.** When the order is rejected:

- A line under the header reads "Order rejected: <reason>".
- Each test row in Results shows "Order rejected". Its ⋯ menu offers Remove only. Open and the
  test-level Reject are hidden, so result entry is closed.
- Values already typed stay in the answer, so Undo rejection brings them back.

**Shipping the field.** Migration **110** adds `fld-ord-rejection` to the stored Lab order on
existing installs, in the same way migration 106 added `fld-ord-results`. The sample form in
`packages/forms/src/samples/forms.ts` gains the field. The starter pack needs a rationale for it and
a version bump (`starter-packs.ts` throws on a field with no rationale). Before writing the migration,
check that no unmerged branch has claimed 110.

### Extraction

When the field bound to `ServiceRequest.extension` with the rejection discriminator holds a reason (each extractor reads it through
the Questionnaire index it already builds, `indexItems` in `extract.ts`):

- **ServiceRequest.** `ServiceRequestExtractor` sets `status: 'revoked'` and adds
  `{ url: 'urn:openldr:ext:rejection', extension: [{ url: 'code', valueCode: <code> },
  { url: 'reason', valueString: <display> }] }`. The display is the reason's display text.
- **Specimen.** The same extractor emits one Specimen: `status: 'unsatisfactory'`,
  `condition: [<reason coding>]`, `subject` from the context. Its `type` is set only when every test
  on the order chose the same specimen type. Otherwise it has no type. `linkToOrder` gives it its id
  and links it from `ServiceRequest.specimen`.
- **No Observations.** `TestResultsExtractor` writes nothing for any test on a rejected order: no
  results and no per-test cancelled Observations.

**What the warehouse shows.** `lab_requests.status = 'revoked'`, `rejection_code` = the reason code,
`rejection_reason` = the reason text. `specimens.status = 'unsatisfactory'`. No `lab_results` rows.
The Zambia and Mozambique packs' rejection reports read `lab_requests.rejection_code`, so they count
bench rejections too.

**One known mix.** `rejection_code` then holds two code spaces: DISA's codes from cdr, and the CE
order codes (DUPLICATE, UNLABELLED, WRONGPT). The column has no system. A report that groups by code
sees both. This is accepted; the docs say so.

### Validation

The submit route already checks coded answers against their value set (`validateReferences`). The new
field goes through the same check, so a code outside the order-reason value set is refused with 400.

A rejected order still needs a patient and at least one test. The existing required checks stay. The
Results field is `required: false` (migration 106), so a rejected order with no typed value passes.
Typed values kept in the answer are still checked against the catalog bands as today; they are not
written.

## 6. Definition of done

1. **UI.** The ⋯ menu entries, the banner, the closed rows. Studio text in en, fr and pt
   (`FormCapture.tsx` supplies copy; the form runtime has no i18n of its own).
2. **CLI.** None. This is bench capture, not admin or maintenance work (AGENTS.md section 6 item 2).
3. **Docs.** The in-app and web docs for bench result entry, in en, fr and pt: rejecting an order, and
   results now linked to their order. Remove any line saying rejections never reach the warehouse.
4. **Mobile.** A 375px check of the ⋯ menu, the reject sheet, the banner and the closed rows. The
   banner sits at the top, so the `vh`/`dvh` trap does not apply, but say what was not checked on a
   real phone.
5. **Changelog.** `pnpm make:changelog` after merging to `main`.

**Tests.**

- `linkToOrder`: links results, cancelled tests and generic Observations; leaves a non-requisition
  set unchanged; leaves an existing `basedOn` alone; fixed ids with a counter.
- `ServiceRequestExtractor`: revoked status, the rejection extension, the Specimen with and without a
  shared type.
- `TestResultsExtractor`: nothing written on a rejected order.
- The warehouse projection: a revoked order with the extension fills `rejection_code` and
  `rejection_reason`. A projection test on the submitted shape.
- Migration 110 on the stored Lab order, and the sample form pinned against it, as 106 does.
- A route test: a submit with results gives every Observation `basedOn`; a rejected submit gives a
  revoked order, a Specimen and no Observations.
- Studio: the menu shows Reject order or Undo rejection; rows close and reopen.

**Live check.** On the dev API and studio, real Postgres:

- One order with results: every `lab_results` row has `request_id` = the order's `lab_requests.id`.
- One rejected order: `lab_requests` status `revoked` with the code and text, one `specimens` row with
  status `unsatisfactory`, no `lab_results` rows.
- Undo rejection brings the typed values back in the form.
- Scratch orders named `ZZREJ-*`, left in place or removed as the operator says.

## 7. Out of scope (listed, not built)

- **The ingest replay** runs only the generic Observation and ServiceRequest extractors
  (`packages/ingest/src/converters/questionnaire-response.ts:16-19`), so a replayed bench response
  produces no results. The old spec says it does.
- **No abnormal flag.** The bench sees "below 12", but the Observation has no `interpretation`, so
  `lab_results.abnormal_flag` is empty.
- **No Specimen for a normal order.** The specimen type chosen per test is kept only in the form
  answer.
- **A rejected test is an empty `lab_results` row.** Its cancelled Observation projects with no value.
  `lab_results` has no status column, so a report can count it as a result.
- `lab_requests.panel_code` holds only the first test (one row per order, already known).
