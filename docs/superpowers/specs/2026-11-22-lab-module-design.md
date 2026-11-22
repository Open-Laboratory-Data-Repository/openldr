# Lab module: design

Status: APPROVED by the operator on 2026-11-22. No code written.
Date: 2026-11-22.
Relates to: `2026-11-22-profile-packs-design.md` and `2026-11-22-form-entries-design.md` (both
merged). Reference: the Corlix LIS at `~/Projects/Repositories/corlix`, used for how a lab's day
flows, not as code to copy.

## 1. What this is and why

OpenLDR CE stores and reports lab data that other systems send it. The operator wants CE, and its
standalone app in particular, to run the lab's own work: receive samples, reject what cannot be
used, enter results, have them authorised, and release them. The collection site profile and its
form were built first, and that was the wrong order: the clerk's form had to guess what the lab
needs. The operator decided on 2026-11-22 to build the lab module next and then work backwards to
the collection site.

The operator said the FHIR mapping is very important. Every step in this design is a correct FHIR
R4 record that a hub, a hospital system or another CE install can read without knowing CE's tables.

The user actions that are broken today:

- A sample arrives at the lab and nobody can record that it was received, by whom, or its condition.
- A request with a clerical mistake cannot be sent back to the site that made it.
- A lab has no list of the work waiting for it.
- Every result is saved as final the moment it is typed. Nobody reviews or authorises it.
- Nothing records who authorised a result.
- A released result that turns out wrong cannot be corrected with a reason.
- An order entered through a form has no patient.

## 2. Gap check

| Claim | Verdict | Proof |
|---|---|---|
| CE cannot record a rejection in FHIR | REFUTED | An order rejection sets the ServiceRequest to `revoked` with a reason extension, and the Specimen to `unsatisfactory` with a `condition`: `packages/forms/src/extract/extract.ts:330-351`. A test rejection gives a `cancelled` Observation with a reason: `packages/forms/src/extract/test-results.ts:26-73`. |
| CE has no rejection reason lists | REFUTED | Seeded value sets `urn:openldr:valueset:order-reject-reason` and `urn:openldr:valueset:test-reject-reason`: `packages/db/src/migrations/internal/106_result_entry.ts:17-56`. |
| CE has no result entry | REFUTED in part | The Lab order form enters results with reference bands: `apps/studio/src/forms-runtime/TestDetailSheet.tsx`, `RejectSheet.tsx`. Every result is saved `final` straight away. |
| CE has no sample reception | CONFIRMED | No route or screen sets `Specimen.receivedTime`, and `specimens` has no link to the request: `packages/db/src/schema/external.ts:103-112`. |
| CE has no worklist | CONFIRMED | "worklist" appears only in facility import code. |
| CE has no authorisation step | CONFIRMED | Results are written `final` at entry: `test-results.ts`. Only the report has a free-text `authorised_by`: `packages/db/src/relational/request-facts.ts:82-96`. |
| CE cannot store a FHIR Task | CONFIRMED | No Task schema: `packages/fhir/src/resources/index.ts:1-13`. `validateResource` refuses an unregistered type: `packages/fhir/src/validate.ts:27-33`. |
| CE cannot record who changed a record | REFUTED | `amend` writes a FHIR Provenance resource: `packages/db/src/fhir-store.ts:743-758`. It accepts only Observation, DiagnosticReport and ServiceRequest: `fhir-store.ts:111`. |
| A plugin could carry the lab module | REFUTED | A plugin cannot write or read FHIR, query its own data beyond one field, or open a socket: `packages/plugin-ui-sdk/src/types.ts:18-62`, `packages/plugins/src/extism-runner.ts:9-23`. The module lives in CE. |
| The Sex field cannot be a select list | CONFIRMED, cause found | The bundled FHIR value sets are imported by `importFhirCatalog` without `refreshCacheAndProject`, so `$expand` cannot find them: `packages/db/src/terminology-admin-store.ts:1201-1238` and `:515-526`. |
| Each lab can hold its own test settings | REFUTED as a gap | `test_catalog_lab_settings` holds per-lab `enabled`, `specimen_types`, `local_display`: `packages/db/src/schema/internal.ts:1129-1136`. |

## 3. Goals, non-goals, anti-goals

Goals:

- Reception finds any request by requisition number or barcode, whatever its source, and
  registers one that is not found.
- Reception records receipt, the sample's condition, and the patient.
- Three ways to handle a mistake: correct a typo, return a request to its site, reject an unfit
  sample and ask for a redraw.
- A worklist by stage, filtered by the lab's own sections.
- Results go through entry, review and authorisation, with a second person by default.
- Each test is released as it is authorised.
- A released result can be corrected, with a reason, and the old value is kept.
- Every step is correct FHIR R4.

Non-goals for this design:

- Analysers (ASTM, HL7 from instruments). Nothing to test against.
- QC and EQA.
- Billing, stock and equipment.
- Microbiology isolate and susceptibility trees. CE's WHONET plugin covers imported AMR data. A
  later design adds bench microbiology.
- The collection site's side of hand-backs. This design makes the FHIR Task and the lab's screen.
  The site's screen comes when we work backwards.
- Separate installs for a site and its lab. The operator decided on 2026-11-22 to build for one
  shared install first (sites and lab on one server, each clerk limited to their site). CE's sync
  today only sends a lab's records up to the hub (`packages/sync/src/batch.ts:31-46`); a path from
  the hub down to a lab and back is its own later design. The FHIR records are the same either way.

Anti-goals:

- No status kept only in a CE table. The FHIR records are the truth. The worklist table is a copy.
- No clinical codes in source (AGENTS.md section 8). Rejection reasons, sample conditions,
  sections and result value sets come from terminology or per-lab settings.
- No person authorises their own result unless the lab has switched that on, and then the record
  says so.
- No status written into a form. Results of an action are toasts.

## 4. Approaches

**A. The FHIR records carry the state, and the worklist reads a fast copy.** Statuses on
ServiceRequest, Specimen, Observation and DiagnosticReport say where work stands. CE keeps a small
worklist table in step with them, as it fills the warehouse today. A FHIR Task is used only for a
hand-off to another place: a request returned to its site, and a redraw requested.

**B. A FHIR Task for every step.** Receive, enter and authorise are each a Task. Most by the book,
but three or four extra records per test that must agree with the results they describe.

**C. Build on the Lab order form.** Fastest start. A worklist across forms and a second-person
review do not fit one form's screen.

The operator picked A on 2026-11-22. A plugin was ruled out (section 2).

## 5. The design

### 5.0 Orders and tests in FHIR

One ServiceRequest per test, grouped by the requisition number in `ServiceRequest.requisition`,
the R4 field for a group of requests made together. The requisition number also stays in
`identifier` as today. Today one ServiceRequest holds every test of an order as codings of one
`code` (`packages/forms/src/extract/extract.ts:279-296`), which in R4 means one concept, not several
tests, and leaves per-test state nowhere to sit. The warehouse already keeps one test per row in
`lab_requests` (`packages/db/src/schema/external.ts:33-35`), so one request per test matches it.
Ids are fixed from the requisition number and the test code, so a retry updates and never copies.

The Lab order form goes back to being an order form (operator, 2026-11-22). It no longer enters
results or saves them as final. Results are entered only through the lab worklist, so nobody gets
round authorisation. Its bench result entry and rejection parts move into the lab pages.

### 5.1 Who does what

New capabilities, in the `lab` group:

| Capability | Lets a user |
|---|---|
| `lab.receive` | find and register requests, receive samples, correct a typo, link the patient |
| `lab.reject` | return a request to its site, reject a sample and ask for a redraw |
| `lab.results.enter` | enter and change results that are not yet authorised |
| `lab.results.authorise` | authorise results entered by someone else |
| `lab.results.amend` | correct a released result |
| `lab.worklist.view` | see the worklists |
| `lab.settings` | set sections, which tests need review, and self-authorisation |

New preset roles: Reception (`lab.receive`, `lab.reject`, `lab.worklist.view`), Lab Technician
gains `lab.results.enter` and `lab.worklist.view`, Lab Manager gains all of them. A user may hold
several roles.

### 5.2 Per-lab settings

Added to each lab's row in `test_catalog_lab_settings`:

- `section`: a code from the lab's own section list, or none.
- `needs_review`: true or false. Default true.

Lab-wide, in the lab's settings (`app_settings`):

- the section list, as a small code system the lab edits (code and name);
- `lab.allowSelfAuthorise`: false by default.

A lab with no sections sees no section filter. A shared test catalog does not set these; each lab
does.

### 5.3 Reception

The Reception page has one box: scan or type a requisition number or barcode.

- **Found** (from a site through sync, from a hospital system through ingest, or registered
  earlier): it shows the order, the patient, the tests and where it came from. Reception checks it
  against the paper and the sample.
- **Not found:** reception registers it on the spot, on the same screen, with the patient, the
  requesting facility and the tests. This writes the same ServiceRequest any other path writes.

The patient: reception finds an existing patient by identifier or name and date of birth, or
registers a new one. The order's `subject` points to that Patient. Sex is a required select
bound to `http://hl7.org/fhir/ValueSet/administrative-gender`, after the import fix in 5.9.

Receiving a sample records `Specimen.receivedTime`, the receiver (as a Provenance), the sample type
and its condition. The condition is a CodeableConcept from a value set the lab can extend. The
seed uses HL7 v2 table 0493 (`http://terminology.hl7.org/ValueSet/v2-0493`). The Specimen gets
`request` pointing to the ServiceRequest, so the two are joined. The order's tests move to "to
enter" on the worklist.

### 5.4 The three ways to handle a mistake

**A typo, with the right paper in hand.** Reception edits the order's fields and gives a reason.
The ServiceRequest is saved as a new version. A Provenance records who, when and why, and the old
version stays in the FHIR history. This uses a new local correction path, not the existing
`amend`: `amend` refuses a record with no site id (`packages/db/src/fhir-store.ts:711-723`), writes
sync amendment rows meant for a hub changing a lab's records, and does not validate the result.

**An incomplete or unreadable form.** Reception returns the request to its site with a reason from
`urn:openldr:valueset:order-return-reason` (seeded with clerical mistake, form incomplete, form not
readable, wrong patient details; the lab can add more). The ServiceRequest goes `on-hold`. A FHIR
Task records the hand-off: `code` = correct request, `status` = requested, `focus` = the
ServiceRequest, `owner` = the requesting facility, `statusReason` = the reason, `requester` = the
lab. When the site sends the corrected request back, the Task becomes `completed` and the
ServiceRequest `active` again. The order leaves the worklist while it is on hold and comes back
when it returns. A request registered at the lab's own desk is never returned; reception corrects
it.

**An unfit sample.** Reception or a technician rejects the sample with a condition and a reason
from the existing order reject reasons. The Specimen becomes `unsatisfactory` with its
`condition`. The ServiceRequest becomes `revoked`. A FHIR Task asks for a redraw: `code` =
recollect sample, `owner` = the requesting facility. The new collection is a new ServiceRequest
whose `replaces` points to the old one. A test can also be rejected alone, as CE does today.

### 5.5 The worklist

One page, three tabs: To receive, To enter, To authorise. Each tab filters by section when the lab
has sections, and by facility and age. Each row is one test on one order: requisition number,
patient, test, section, waiting since. Pagination, `StripedEmpty`, `LoadingState`, dots menus, as
AGENTS.md section 5 says.

The worklist reads `lab_work_items`, an internal table with one row per test on an order: order
id, test code, section, stage, facility, patient name, received at, entered at, entered by. A
worker keeps it in step with the FHIR changes, the way the warehouse is filled. It holds nothing
the FHIR records do not.

"To receive" lists orders that have arrived through sync or ingest and have no received Specimen.

### 5.6 Result entry and review

Opening a test from "To enter" shows its result fields from the test catalog. As a value is typed,
the screen shows the matching reference band (by the patient's sex and age) and flags high, low or
critical. Critical limits are new: each reference band in the test catalog gains `criticalLow` and
`criticalHigh` beside `low` and `high` (`packages/bootstrap/src/result-params.ts:20-25`). The result is saved as an Observation with `status` = preliminary, `referenceRange`, and
`interpretation` (H, L, HH, LL, N from `http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation`).
One Observation per result field, each with its own code from the test catalog.

Unauthorised results stay out of reports and connectors. A preliminary Observation is stored in
the FHIR store, but the warehouse projection fills `lab_results` only from final, corrected,
amended and cancelled Observations, and connectors send on the release event, not on save. Today
the projection copies every Observation whatever its status.

Submitting moves the test to "To authorise", unless the test does not need review and no value is
critical. Then it is authorised at once by the system and released.

Authorising: a user with `lab.results.authorise` opens the test, sees the values, flags and who
entered them, and authorises or sends it back with a note. A send-back note is saved as
`Observation.note`; the status stays preliminary and the test returns to "To enter". Authorising sets the Observations
`final` and records the authoriser as a Provenance and in `Observation.performer`. If the person
authorising entered the result, they are refused unless `lab.allowSelfAuthorise` is on; then it
goes through and the Provenance says self-authorised.

### 5.7 Release

When a test is authorised it is released. The order's DiagnosticReport is created on the first
release and updated after each: `status` = partial while tests remain, `final` when all are done,
`result` = the released Observations, `basedOn` = the ServiceRequest, `specimen`, `performer` =
the lab, `resultsInterpreter` = the authorisers, `issued` = the time.

On release:

- the requesting site's Entries list shows "Result ready" for that order, through sync;
- the user who ordered it gets a notification in the bell;
- CE's existing workflows and connectors send it on to hospital systems;
- the report designer prints it.

### 5.8 Amendments

A user with `lab.results.amend` opens a released test, changes a value and gives a reason. The
Observation is saved as a new version with `status` = corrected, through the same local correction
path as a typo (5.4), which writes the Provenance. The DiagnosticReport becomes `corrected`. The site and the
person who ordered it are told. A self-authorisation rule does not apply to amendments; the
amender is always recorded.

### 5.9 Groundwork

- The bundled FHIR value sets are imported so that `$expand` finds them.
- The FHIR store accepts Task and Provenance: a schema and validation for each, and a projection
  of Task into `lab_work_items`. Today Provenance is written only by `amend`, past validation.
- A local correction path: save a new version of a lab-owned ServiceRequest, Specimen or
  Observation, validated, with a Provenance carrying who and why.
- The warehouse projection of Observation skips preliminary and registered results.
- Reference bands gain `criticalLow` and `criticalHigh`.
- The Lab order form stops entering results.
- New seeded value sets: order return reasons; the lab section code system (empty); sample
  condition bound to v2-0493.

### 5.10 FHIR summary

| Step | Resource | Status and fields |
|---|---|---|
| Registered | ServiceRequest | active; `subject` = Patient |
| Typo corrected | ServiceRequest | new version; Provenance with reason |
| Returned to site | ServiceRequest, Task | on-hold; Task requested, owner = site |
| Corrected by site | ServiceRequest, Task | active; Task completed |
| Received | Specimen | `receivedTime`, `condition`, `request`; Provenance |
| Sample rejected | Specimen, ServiceRequest, Task | unsatisfactory; revoked; Task for redraw |
| Redraw | ServiceRequest | new, `replaces` = old |
| Entered | Observation | preliminary, `referenceRange`, `interpretation` |
| Authorised | Observation | final, `performer`; Provenance |
| Released | DiagnosticReport | partial, then final |
| Amended | Observation, DiagnosticReport | corrected; Provenance with reason |

### 5.11 CLI

Admin and maintenance only, as AGENTS.md section 6 asks:

- `openldr lab sections list|add|remove`
- `openldr lab tests set <code> --section <code> --needs-review true|false`
- `openldr lab settings set allow-self-authorise true|false`
- `openldr lab worklist rebuild` (rebuild `lab_work_items` from FHIR)

Bench work (receive, enter, authorise) stays in the studio.

### 5.12 Definition of done

UI, CLI, docs in en, fr and pt (in-app guides for Reception, Worklist and Review; web docs for
setting up a lab), mobile at 375 wide, changelog after the merge.

## 6. Calls I made, for the operator to check

- Reception is its own role and cannot enter results.
- Reception finds or registers the patient and links the order.
- Result entry flags high, low and critical as values are typed.
- A critical value always goes to review.
- One DiagnosticReport per order, updated on each release.
- Amendment uses the `corrected` status.
- Sample conditions seed from HL7 v2 table 0493.
- Return reasons are a new value set, separate from reject reasons.
- A request registered at the lab's desk is corrected there, never returned.
- Bench work has no CLI commands.
- One ServiceRequest per test, grouped by `requisition`, with fixed ids.
- A local correction path, not `amend`.
- Preliminary results never reach the warehouse or connectors.
- Critical limits live on the catalog's reference bands.
- An authoriser's send-back note is `Observation.note`.

## 7. Slices

Each slice ships UI, CLI where it applies, docs in three languages and a mobile check.

| # | Slice | Depends on |
|---|---|---|
| 1 | Groundwork: value set import fix, Task and Provenance in the FHIR store, the local correction path, the warehouse status filter, critical limits, settings, capabilities and roles, seeded value sets, one ServiceRequest per test, the Lab order form as an order form only | none |
| 2 | Reception: find or register, patient, receive, correct a typo | 1 |
| 3 | Rejection: return to site, reject a sample, redraw | 2 |
| 4 | Worklist: `lab_work_items` and the three tabs | 2 |
| 5 | Result entry and authorisation | 4 |
| 6 | Release: the report, notifications, the site's "Result ready" | 5 |
| 7 | Amendments | 6 |

Each slice gets its own plan and goes through the same build and review as the last two pieces.

## 8. Left to the builder

- The exact worker that keeps `lab_work_items` in step, and how it catches up after a restart.
- How "To receive" learns that an order arrived through sync.
- The screen layout of Reception and Review, copied from the nearest existing pages.
- The exact columns of `lab_work_items` beyond those listed.
- Migration numbers: the latest on `main` is 136. Check unmerged branches first.

## 9. Verification

- Route tests pin every wire shape.
- pg-mem cannot show ORDER BY ties or Postgres-only behaviour; each slice ends with a run on a
  clean standalone install with real Postgres, as the last two pieces did.
- The FHIR records of a full run (receive, enter, authorise, release, amend) are read back from
  the store and checked field by field against section 5.10.
- Only a real phone proves bottom-anchored UI.
