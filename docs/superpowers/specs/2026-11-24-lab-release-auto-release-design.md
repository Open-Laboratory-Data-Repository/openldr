# Lab plugin: release and auto-release

Date: 2026-11-24. Plugin repo: `openldr-ce-plugin-lab` (local main `7018577`). Size: a small change.

## What and why

Two things, both in the lab plugin.

1. **Release.** An authorised result reaches CE today as a ServiceRequest, Specimens, Observations
   and a Provenance. It has no DiagnosticReport, so CE's `diagnostic_reports` table gets no row for
   lab plugin results. That row is where the warehouse keeps the report's issue time and who
   authorised it. Authorise will also send one DiagnosticReport.
2. **Auto-release.** A test whose catalog entry says `requiresVerification: false` skips review.
   Submit sends it to CE at once, and the test is authorised. Today every result waits on the
   Review tab.

## Facts checked first (RULE 0)

- CE's `fhir_emit` takes any type the plugin's manifest lists under `emit-fhir`
  (`packages/marketplace/src/grant.ts:25`, `packages/bootstrap/src/plugin-host.ts:241`, `:559`).
  The lab manifest lists five types and no DiagnosticReport (`manifest.template.json:19-25`).
  So release needs one manifest line, not a CE change.
- CE projects a DiagnosticReport into `diagnostic_reports`
  (`packages/db/src/relational/diagnostic-report.ts:7`). It reads `basedOn[0]`, `specimen[0]`,
  `issued`, `effectiveDateTime`, `performer[0]`, `category` (section) and
  `resultsInterpreter[0].display` (`authorised_by`, `request-facts.ts:80-96`).
- `testCatalog.get` answers the whole test, `requiresVerification` included
  (`packages/bootstrap/src/plugin-host.ts:448-453`, `test-catalog.ts:118`). A test saved before
  the field reads as `true` (`test-catalog.ts:484`).
- The plugin already marks a critical value `HH` or `LL` (`src/results.rs:425-439`).

No CE code changes in this slice.

## How Corlix does it

- Corlix has no separate release step. Authorise is the release
  (`apps/desktop/src/main/results.ts:137`, statuses `AUTHORISED` and `AUTO_RELEASED`).
- Auto-release happens at submit: when the test does not require verification and no value is
  critical, the test goes straight to `AUTO_RELEASED`, verified by "Auto-released"
  (`results.ts:240-290`). A critical value always goes to review.
- Corlix sends one DiagnosticReport per order (`fhir-builder.ts:439-475`, `:818-833`).
- Corlix seeds a setting `auto_release_enabled` (`migrations/index.ts:1258`), but no main-process
  code reads it. Not ported.

## Approaches

- **A. Authorise sends the DiagnosticReport; submit auto-releases (chosen).** Follows Corlix, adds
  no new step, and every lock and retry path for `authorised` keeps working.
- **B. A separate Release step after authorise.** A second click per result. Corlix has none, and
  nothing in CE reads a state between authorised and released. Dropped.
- **C. One DiagnosticReport per order, as Corlix does.** CE keeps one request per test, and the
  warehouse reads only `basedOn[0]`, so an order-wide report would link to one test only. The
  cdr-source plugin also sends one report per request
  (`openldr-ce-plugin-cdr-source/src/fhir.rs:430-445`). Dropped.

## The design

My calls, each cheap to change later.

1. **One DiagnosticReport per authorised test**, sent in the same `fhir_emit` as the other records.
   - id fixed by the test, like the other records
     (`ids::fhir_id("DiagnosticReport", test id, order created_at)`).
   - `status: final`. `code`: the same codings as the test's ServiceRequest.
   - `subject`: `Patient/<pluginRef>`, rewritten by CE as today.
   - `basedOn`: the test's ServiceRequest. `specimen`: the test's first Specimen. `result`: every
     Observation sent.
   - `issued`: the authorise time. `effectiveDateTime`: the first sample's received time. The
     plugin keeps no collection time.
   - `resultsInterpreter`: the authoriser's name, or "Auto-released" for an auto-release, as Corlix
     writes it. CE stores it as `authorised_by`.
   - No `performer` and no `category`. The plugin does not know which facility is the lab, and it
     has no lab sections yet. Both are on the later list.
   - The Provenance targets the DiagnosticReport too.
2. **Auto-release at submit.** Submit reads the test's catalog entry. When `requiresVerification`
   is `false`, no value is flagged `HH` or `LL`, and the caller has no facility limit, submit sends
   the records to CE and the test becomes `authorised`.
   - Two events are written: `submit`, then `auto-release`. The history shows "Auto-released".
   - The Provenance activity is `auto-release`, with the person who submitted as its agent.
   - The self-authorise rule does not apply. No one authorises; the catalog does.
   - A test CE no longer has, a critical value, or a caller with a facility limit: the result goes
     to review as today.
   - If CE refuses the send, the result goes to review as today, and the page says why in a toast.
     The result is never lost.
   - The test keeps the status `authorised`, not a new status. All locks and the retry path stay
     as they are. Only the history tells the two apart.
3. **The page.**
   - The Enter results sheet shows one line when the test skips review: "This test is released
     without review, unless a value is critical."
   - Submit's toast says "Results released" when it auto-released, and "Submitted for review"
     otherwise.
   - The result and order history name the new event.
   - Strings in en, fr and pt.
4. **Manifest.** `DiagnosticReport` joins `emit-fhir` `resourceTypes`.
5. **Docs.** GUIDE (en, fr, pt): "What reaches CE" names the report, and a new task "Results that
   skip review". README: the auto-release rule.

## Not in this slice

- No backfill of reports for results authorised before this version. No lab has the plugin yet.
- No lab setting to turn auto-release off. The catalog flag decides, per test.
- `performer` (the lab's own facility) and `category` (lab section).
- Amendments.

## Proof

- `cargo test`, `cargo clippy`, the UI tests.
- Live check on a throwaway install on port 3242: a reviewed test sends a DiagnosticReport and CE's
  `diagnostic_reports` has the row with `authorised_by`; a test with `requiresVerification: false`
  is authorised at submit and its report says "Auto-released"; the same test with a critical value
  waits for review.
- Screenshots of the Enter results line and the history, desktop and 375 px.
