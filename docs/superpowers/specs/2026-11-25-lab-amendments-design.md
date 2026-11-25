# Lab plugin: amending an authorised result

Date: 2026-11-25. Lab plugin only (batch 3, item A1). The operator chose on 2026-11-25 that an
amended result goes through review again.

## Why

An authorised result is locked: every change answers "An authorised result is locked."
(`src/results.rs:842`, `:918`, `:972`). A lab that finds a wrong value after release has no way to
fix it. The result has already reached CE and the warehouse.

## Facts checked first

- CE keeps an `amended`, `corrected` or `entered-in-error` result in `lab_results`; it drops only
  `preliminary` and `registered` (`packages/db/src/relational/observation.ts:12`). The report's status
  is projected as sent (`relational/diagnostic-report.ts:16`).
- The plugin's FHIR ids are fixed by the test (`ids::fhir_id`), so sending again updates the same
  resources in CE, under the plugin's ownership check.
- `held_send` (`src/results.rs:294`) treats any `sent` result row of a test that is not `authorised`
  as "CE already holds this result". An amended test must not read as held.

## How Corlix does it

Corlix has no amendment flow. It defines one permission, `results.amend` ("Amend an already
authorised result"), held by the lab admin and lab manager roles
(`apps/desktop/src/main/migrations/index.ts:2727`, `:2811`, `:2883`), and maps it to no action yet
(`authz-manifest.ts:519-523`). Ported: a separate permission.

## Approaches

- Chosen: Amend reopens the result for the bench, and it is submitted and authorised again.
  Reuses the whole entry and review path and keeps a second person on a released result.
- Not chosen: the amender changes the value and releases it in one step. One person could change a
  released result alone.

## Design

- **Permission.** A new capability `lab.results.amend`, "Amend results" (en, fr, pt), for the action
  `lab_result_amend`. Who holds it is set in CE's roles (the lab profile pack, D1, gives it to the
  lab manager and lab admin roles).
- **Amend.** `lab_result_amend { testId, reason }` on an `authorised` test: the reason is required;
  the test goes back to `in_progress` with its values kept, so it shows on the Results tab; an
  `amend` event (with the reason) and an audit row are written. A caller with a facility limit may
  amend a test of their facility, as they may send one back. An order that is cancelled refuses.
- **While amending.** CE keeps the version it has. The test does not read as held by CE (it can be
  saved and submitted), but it still counts as sent: the order cannot be cancelled, its patient
  cannot change, and the test cannot be rejected, as for an authorised result.
- **Submit and authorise.** Unchanged, with two differences: an amended result is never
  auto-released, and authorise sends it as an amendment. The self-authorise setting applies as
  today.
- **The amended send.** The Observations and the DiagnosticReport go with status `amended`. An
  Observation CE holds from the last send whose parameter has no value now goes with status
  `entered-in-error`, so the warehouse does not keep a withdrawn value as final. The Provenance of
  the amendment is a new resource (its own id per amendment), activity `amend`, with the reason.
- **History.** The result's history shows "Amended" with the reason and who did it. The values CE
  held before the amendment are kept on the amend event (a new `values` column), which only the
  results actions read. The audit row, which the order's history shows to the desk, keeps no values.
- **Page.** On an authorised result, the order sheet's Results row gets **Amend** in its dots menu
  (for a holder of `lab.results.amend`). It opens a sheet with the reason; Save from the sheet's
  dots menu, a toast, and the test moves to the Results tab.
- **CLI.** `openldr plugin call lab lab_result_amend --input '{"testId":"...","reason":"..."}'`.
- **Docs.** Guide (en, fr, pt): a task "Amend an authorised result". README: the rule. Error
  sentences go in the catalog with fr and pt words.

## Proof

- `cargo test`: amend needs a reason and an authorised test; the amended test is saved, submitted
  and authorised again; the send says `amended`; a dropped value goes `entered-in-error`; never
  auto-released; cancel, patient change and reject still refused while amending; a held amend
  (CE saved, final write failed) finishes as an amendment.
- UI test: Amend shows only for an authorised result and a holder of the permission; saving sends
  the reason.
- Live check on the dev stack: amend, re-enter, authorise; CE's Observation and report say
  `amended`; the warehouse row has the new value and status.

## Left to the builder

- How the test is marked as amending (a column, or the send row's status), as long as the rules
  above hold.
- The words, in en, fr and pt.
