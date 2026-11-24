# Lab plugin release and auto-release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authorise also sends a DiagnosticReport per test, and a test whose catalog entry has `requiresVerification: false` is released at submit without review.

**Architecture:** Plugin only. `src/sends.rs` builds the DiagnosticReport; `src/results.rs` adds it to the authorise records and turns `authorise` into one release path with two callers: the reviewer, and submit's auto-release. The page reads two new fields. CE is unchanged.

**Tech Stack:** Rust (wasm32-wasip1, `cargo test` against `tests/fake_host.rs`), React + vitest in `ui/`, Node live-check scripts.

**Spec:** `docs/superpowers/specs/2026-11-24-lab-release-auto-release-design.md` (CE repo). Read it first.

**Repo:** plugin worktree `/home/fredrick/Projects/Repositories/openldr-ce-plugin-lab-release`, branch `feat/release` from `main` (`7018577`).

## Global Constraints

- No `Co-Authored-By` trailer in commits. No em dashes in any text or comment.
- Every UI string in en, fr and pt (`ui/src/i18n.ts`). A missing key fails `ui/src/i18n.test.ts`.
- FHIR record text is fixed English: "Auto-released", activity codes `authorise`, `self-authorise`, `auto-release`.
- Never use ports 3000, 5433, 3210-3213, 3220, 3241, 5173, 5174, 54320, 54331, 54332, 54340, 54350. The live check uses `WEB=3242`.
- Actions in the page stay in the dots menu; status messages go in a sonner toast, not in the form.
- Plain short sentences in comments and docs.

## Review Focus

1. A test CE no longer has: submit must not auto-release (catalog read answers `NOT_FOUND`); it goes to review. Test in Task 2.
2. A value flagged `HH` or `LL` on an auto-release test: it waits for review. Test in Task 2.
3. CE refuses the auto-release send: the test stays `pending_review`, the submit call still succeeds, and `autoReleaseError` names CE's message. Test in Task 2.
4. A bench user with a facility limit submits an auto-release test: it goes to review, no send is tried. Test in Task 2.
5. A held result (CE saved, plugin write failed) finished by a later authorise: the records sent the first time included the DiagnosticReport, and the finish sends nothing again. Covered by the existing held tests once Task 1 updates their record counts.

---

### Task 1: DiagnosticReport in the authorise records

**Files:**
- Modify: `src/sends.rs` (new `diagnostic_report`)
- Modify: `src/results.rs:1001-1028` (`authorise_records`)
- Modify: `manifest.template.json:19-25` (add `"DiagnosticReport"` after `"Observation"`)
- Test: `tests/results.rs` (`authorise_sends_exactly_the_records_of_ruling_9_with_fixed_ids` and any test that counts records), `tests/contract.rs` if it pins the resource types

**Interfaces:**
- Produces: `pub fn diagnostic_report(order: &Value, code: &Value, test_id: &str, specimens: &[Value], observations: &[Value], interpreter: &str, issued: &str) -> Value` in `src/sends.rs`. `code` is the ServiceRequest's `code` object, copied as the report's `code`.
- In this task `authorise_records` keeps its `self_authorised: bool` parameter; Task 2 replaces it with `how: Release`.

- [ ] **Step 1: Write the failing test.** Extend `authorise_sends_exactly_the_records_of_ruling_9_with_fixed_ids` so the emitted list is ServiceRequest, Specimen(s), Observations, DiagnosticReport, Provenance, in that order, and assert on the report:
  - `resourceType == "DiagnosticReport"`, `id == ids::fhir_id("DiagnosticReport", hb_test_id, order_created_at)`, `status == "final"`.
  - `code` equals the ServiceRequest's `code`.
  - `subject.reference == "Patient/<pluginRef>"`.
  - `basedOn == [{ reference: "ServiceRequest/<sr id>" }]`, `specimen == [{ reference: "Specimen/<first specimen id>" }]`.
  - `result` lists `Observation/<id>` for every Observation sent, same order.
  - `issued` equals the Provenance `recorded`; `effectiveDateTime` equals the first Specimen's `receivedTime`.
  - `resultsInterpreter == [{ display: <reviewer display name> }]`.
  - No `performer`, no `category`.
  - The Provenance `target` lists the Observations, then `DiagnosticReport/<id>`.
- [ ] **Step 2: Run** `cargo test --test results authorise_sends_exactly` and see it fail on the missing report.
- [ ] **Step 3: Implement** `diagnostic_report` and call it in `authorise_records` after the Observations. A test with no Specimen leaves out `specimen` and `effectiveDateTime`. Add `"DiagnosticReport"` to the manifest. Update any other test that counts records (search `tests/` for record counts and emitted lengths).
- [ ] **Step 4: Run** `cargo test` (all) and `cargo clippy --all-targets -- -D warnings`. Expected: pass, no warnings.
- [ ] **Step 5: Commit** `feat: authorise sends a DiagnosticReport with each result`.

### Task 2: Auto-release at submit

**Files:**
- Modify: `src/results.rs` (`authorise`, `submit`, `params`, `authorise_records`)
- Test: `tests/results.rs` (new tests), `tests/fake_host.rs` (a way to answer `requiresVerification: false`)

**Interfaces:**
- Consumes: Task 1's `diagnostic_report`.
- Produces:
  - `enum Release { Reviewer, Auto }` in `src/results.rs` (private is fine).
  - `fn release(host: &dyn Host, test_id: &str, how: Release) -> LabResult<Value>`: today's `authorise` body. `authorise(host, input)` becomes `release(host, &test_id, Release::Reviewer)`. `sends::retry` keeps calling `results::authorise`.
  - With `Release::Auto`: skip the self-authorise check; event action `auto-release` (no note); audit action `result-auto-release`; Provenance `activity.text = "auto-release"`, agent the caller; report `resultsInterpreter` display `"Auto-released"`. With `Reviewer`: as today, activity `authorise` or `self-authorise`, interpreter the caller's display name.
  - `submit` answer: the view plus `"autoReleased": bool` and `"autoReleaseError": string | null`.
  - `params` answer: the view plus `"requiresVerification": bool` (`false` only when `testCatalog.get` answers `requiresVerification: false`; a missing test or field reads `true`).
  - `pub fn requires_verification(host: &dyn Host, test: &Value) -> LabResult<bool>` in `src/results.rs`, via `facilities::catalog_entry`.
- Fake host: give `catalog()`'s `t(...)` a `"requiresVerification": true`, and add `pub fn skip_review(host: &FakeHost, code: &str)` that overrides `testCatalog.get` with `on_read` to answer that test with `requiresVerification: false`.

- [ ] **Step 1: Write the failing tests** in `tests/results.rs`:
  - `a_test_that_skips_review_is_released_at_submit`: `skip_review(host, "HB")`, save `hb_values()`, submit. Answer `autoReleased == true`, `autoReleaseError == null`, status `authorised`. Events newest first: `auto-release`, `submit`, `save`. One `fhir_emit` with a DiagnosticReport whose `resultsInterpreter[0].display == "Auto-released"` and a Provenance with `activity.text == "auto-release"`. A `fhir_sends` row `sent`. The bench caller submitted its own entry with self-authorise off and nothing was refused.
  - `a_critical_value_waits_for_review_even_when_the_test_skips_review`: `skip_review`, save HGB 21 on `women()` (criticalHigh 20, flag `HH`). Submit: `autoReleased == false`, status `pending_review`, no `fhir_emit`.
  - `a_test_that_needs_review_is_not_released`: no override. Submit: `autoReleased == false`, `pending_review`, no emit.
  - `a_test_ce_no_longer_has_waits_for_review`: override `testCatalog.get` to answer `NOT_FOUND` for HB. Submit: `pending_review`, no emit.
  - `a_limited_bench_user_is_not_auto_released`: `skip_review`, caller `site(&[facility])` holding `lab.results.enter`. Submit: `pending_review`, no emit tried.
  - `when_ce_refuses_an_auto_release_the_result_waits_for_review`: `skip_review`, `fhir_emit` answers an error. Submit succeeds: `autoReleased == false`, `autoReleaseError` holds CE's message, status `pending_review`, and a reviewer can then authorise it.
  - `params_say_whether_the_test_skips_review`: `lab_result_params` answers `requiresVerification == false` with the override, `true` without.
- [ ] **Step 2: Run** `cargo test --test results` and see the new tests fail.
- [ ] **Step 3: Implement.** Rename `authorise`'s body to `release(host, test_id, how)`. In `submit`, after its write succeeds: when `requires_verification` is false, the caller is not limited, and no stored value has `flag` `HH` or `LL`, call `release(.., Release::Auto)`. On `Ok(view)` answer it with `autoReleased: true`. On `Err(e)` re-read the test: if it is `authorised` answer `autoReleased: true`; otherwise answer the current view with `autoReleased: false, autoReleaseError: e.message`. Every other path answers `autoReleased: false, autoReleaseError: null`. A repeat submit of a `pending_review` test does not auto-release (it answers the view as today).
- [ ] **Step 4: Run** `cargo test` and `cargo clippy --all-targets -- -D warnings`. Expected: pass.
- [ ] **Step 5: Commit** `feat: a test that skips review is released at submit`.

### Task 3: The page and the docs

**Files:**
- Modify: `ui/src/api.ts` (types: `ParamsView.requiresVerification: boolean`, submit answer `ResultView & { autoReleased: boolean; autoReleaseError: string | null }`)
- Modify: `ui/src/results/ResultEntrySheet.tsx:145-161` and its body
- Modify: `ui/src/i18n.ts` (en, fr, pt), `ui/src/i18n.test.ts:48-50`
- Modify: `ui/src/testing/fake.ts` if it fakes submit
- Test: `ui/src/results/results.test.tsx`
- Modify: `docs/GUIDE.md`, `docs/GUIDE.fr.md`, `docs/GUIDE.pt.md`, `README.md`

**Interfaces:**
- Consumes: Task 2's `requiresVerification`, `autoReleased`, `autoReleaseError`; event action `auto-release`; audit action `result-auto-release`.
- New i18n keys (en text fixed here; write fr and pt):
  - `results.skipsReview`: "This test is released without review, unless a value is critical."
  - `results.released`: "{test}: results released."
  - `results.autoReleaseFailed`: "{test} was submitted for review. It could not be released: {error}"
  - `results.event.autoRelease`: "Auto-released"
  - `orders.history.test.resultAutoRelease`: "Result auto-released"

- [ ] **Step 1: Write the failing tests** in `results.test.tsx`: the Enter results sheet shows the `results.skipsReview` text when `requiresVerification` is false and not when true; submit shows the `released` toast when `autoReleased`, the `autoReleaseFailed` error toast when `autoReleaseError` is set, and the existing `submitted` toast otherwise; a result history with an `auto-release` event shows "Auto-released". Add `autoRelease` and `resultAutoRelease` to the used-key lists in `i18n.test.ts`.
- [ ] **Step 2: Run** `pnpm --dir ui test` and see them fail.
- [ ] **Step 3: Implement.** The line sits under the sheet's header block, as muted text, where the "Sent back" note sits. Keep the dots menu as it is.
- [ ] **Step 4: Docs.** GUIDE (en, fr, pt): in "What reaches CE", add the report ("a report that links the request, the sample and the results, with who authorised it, or Auto-released"). Add a task "Results that skip review" after "Authorise a result": which tests (the test catalog's "Requires verification" off), what the bench sees, that a critical value still goes to review, and that a refused send leaves it in review with a message. Troubleshooting: "Submit says it could not be released". README: the auto-release rule in the `results.rs` bullet, and `DiagnosticReport` in the sends bullet.
- [ ] **Step 5: Run** `pnpm --dir ui typecheck`, `pnpm --dir ui test`, then `node scripts/build.mjs`. Expected: pass, including `ui/src/guide/guide.test.ts`.
- [ ] **Step 6: Commit** `feat: the page says when a test skips review, and the guide explains release`.

### Task 4: Live checks for release and auto-release

**Files:**
- Create: `tools/live-check/run-c.mjs`
- Modify: `tools/live-check/all.sh` (run `node run-c.mjs` after `run-b.mjs`; exit non-zero if any part failed)
- Modify: `tools/live-check/last-run.md` (after the run, by the controller)

**Interfaces:**
- Consumes: the helpers in `tools/live-check/lib.mjs` and `db.mjs`, and the users and tests `seed.sh` makes. Read `run-b.mjs` for how it registers, receives, saves, submits and authorises through the broker, and reads `openldr_target`.

- [ ] **Step 1: Write `run-c.mjs`** with these checks, each by `check(id, label, pass, detail)` as in `run-b.mjs`:
  - `c1`: a reviewed test authorised by the reviewer: CE's FHIR store has `DiagnosticReport/<id>`, and the warehouse `diagnostic_reports` row for it has `based_on_id` equal to the ServiceRequest id, `status` `final`, `authorised_by` the reviewer's display name, `specimen_id` set, and `issued` set (poll up to 60 s, as `run-b.mjs` polls the warehouse).
  - `c2`: set a test to skip review with the CLI (`openldr test-catalog set <code> --requires-verification false`, see `packages/cli/src/test-catalog.ts` in CE). Bench saves a normal value and submits: answer `autoReleased: true`, status `authorised`, the report row's `authorised_by` is `Auto-released`, and its `lab_results` rows exist.
  - `c3`: same test, a value at or above its critical high: submit answers `autoReleased: false`, status `pending_review`, no DiagnosticReport in CE for it. If the seeded test has no critical limit, give it one first.
  - `c4`: `lab_result_params` answers `requiresVerification: false` for that test, `true` for a test left as it was.
  - Set the test back to `--requires-verification true` at the end.
- [ ] **Step 2: Run** `node --check tools/live-check/run-c.mjs`. Expected: no syntax error. The controller runs the full kit.
- [ ] **Step 3: Commit** `test: live checks for release and auto-release`.
