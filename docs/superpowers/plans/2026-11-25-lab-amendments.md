# Lab plugin amendments: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A holder of "Amend results" reopens an authorised result with a reason; the bench changes
it, it is reviewed and authorised again, and CE gets it as `amended`.

**Architecture:** Lab plugin only. A new action `lab_result_amend` moves an `authorised` test back to
`in_progress` and raises the result's version. "Held by CE" becomes "a `sent` row whose version is
the result's version", so an amended test can be edited; a new check "CE has this test" (any `sent`
row, or `authorised`) keeps the order locks. Authorise of a test CE already had sends `amended`
records. `results.sent_values` keeps the values CE holds, to find a dropped value.

**Tech Stack:** Rust (`cargo test`, `tests/fake_host.rs`), React + vitest UI.

**Spec:** `docs/superpowers/specs/2026-11-25-lab-amendments-design.md`

## Global Constraints

- Capability `lab.results.amend`, "Amend results" / "Corriger les résultats validés" / "Corrigir resultados autorizados".
- Amend needs a non-empty `reason`, an `authorised` test and a live order. A facility-limited caller may amend a test of their facility.
- An amended result is never auto-released. Self-authorise applies as today.
- Amended send: Observations and DiagnosticReport `status: "amended"`; a value CE holds that is now
  absent goes `entered-in-error`; the Provenance id is per amendment, activity `amend`, reason in `reason[0].text`.
- While amending, the order cannot be cancelled, its patient cannot change, and the test cannot be rejected.
- Every new error goes in `src/messages.rs` with fr and pt words. UI per AGENTS.md section 5. No em dashes.

## Review Focus

1. An amended test where the bench saves no change and submits: it is still sent as `amended`, and the warehouse row stays.
2. A second amendment of the same test: its Provenance has its own id, and the first is kept.
3. Authorise of an amendment where CE saves and the plugin's final write fails: it finishes as an amendment, not as a first release.
4. A multicoded value whose answers change: each Observation CE held for a dropped answer goes `entered-in-error`.
5. A result authorised before this version (no `sent_values`): it can be amended; nothing is marked `entered-in-error` for it, and the ledger says so.

---

### Task 1 (plugin): the amend action and the amended send

**Files:**
- Modify: `manifest.template.json` (capability `lab.results.amend` with fr/pt labels; entrypoint
  `lab_result_amend` with actionPermissions `["lab.results.amend"]`; `results.sent_values` jsonb nullable;
  `lab_me` and `lab_facilities_search` also allow `lab.results.amend`), `src/results.rs` (`amend`;
  `held_send` compares versions; `pub(crate) fn in_ce(host, test, order) -> LabResult<bool>`; submit never
  auto-releases when `in_ce`; authorise records with `Release` gaining `Amend`), `src/sends.rs`
  (status argument on the report and Observations), `src/orders.rs:655-659`, `:760-765`,
  `src/rejects.rs:143`, `:186`, `src/samples.rs:234`, `src/sends.rs:466` (use `in_ce` where they meant
  "CE has it"), `src/actions.rs`, `src/lib.rs`, `src/messages.rs` (new sentences), `README.md`
- Test: `tests/amend.rs` (new)

**Interfaces:**
- Produces: `lab_result_amend { testId, reason }` → the result view (status `in_progress`), events gain
  `amend` with the reason as note; audit action `result-amend` with `{ version, values }` of what CE held.

- [ ] **Step 1: Failing tests** in `tests/amend.rs`:
  - `amend_needs_a_reason_and_an_authorised_test` (`invalid` without reason; `conflict` on `pending_review`).
  - `amend_reopens_the_result_for_the_bench_with_its_values` (status `in_progress`, values kept, version + 1,
    `amend` event with the note, `result-amend` audit row with the old values).
  - `an_amended_result_is_saved_submitted_and_authorised_again` (never auto-released even when the test skips review).
  - `the_amended_send_says_amended` (Observations and report `amended`; Provenance id differs from the first one and
    activity `amend` with the reason; send row `release: amend`).
  - `a_value_dropped_in_the_amendment_goes_entered_in_error`.
  - `while_amending_the_order_cannot_be_cancelled_nor_the_test_rejected_nor_the_patient_changed`.
  - `a_held_amendment_finishes_as_an_amendment` (CE saved, final write failed, authorise again).
  - `a_second_amendment_has_its_own_provenance` (Review Focus 2).
  - `a_result_authorised_before_sent_values_can_be_amended` (Review Focus 5).
  - `amend_needs_the_amend_permission` (manifest action gate, as the settings test checks it).
- [ ] **Step 2: Run** `cargo test --test amend`. Expected: fails to compile (no `lab_result_amend`).
- [ ] **Step 3: Implement.** `sent_values` is set at every authorise and auto-release.
- [ ] **Step 4: Run** `cargo test --no-fail-fast`, `cargo clippy --all-targets -- -D warnings`,
  `UPDATE_CONTRACT=1 cargo test --test contract`. Expected: pass.
- [ ] **Step 5: Commit** `feat: amend an authorised result, reviewed again and sent as amended`.

### Task 2 (plugin UI): Amend on the order sheet, words, guides

**Files:**
- Create: `ui/src/orders/AmendResultSheet.tsx` (Sheet: test name, Reason textarea, ⋯ Save and Cancel; copy `MarkCorrectedSheet.tsx`)
- Modify: `ui/src/orders/OrderSheet.tsx` (each authorised test in `OrderResultsSection` gets a ⋯ with **Amend**
  for a holder of `lab.results.amend`), `ui/src/api.ts` (`resultAmend`), `ui/src/i18n.ts` (sheet words,
  `results.event.amend`, `orders.history.test.resultAmend`, en/fr/pt), `ui/src/error-words.ts` (new keys),
  `docs/GUIDE.md`, `GUIDE.fr.md`, `GUIDE.pt.md` (task "Amend an authorised result", with the CLI line)
- Test: `ui/src/orders/OrdersTab.test.tsx`

- [ ] **Step 1: Failing UI tests:** `Amend shows only on an authorised result, for a holder of lab.results.amend`;
  `saving the amend sheet sends the reason and shows a toast`; `an empty reason is refused on the page`;
  `the history names the amendment`.
- [ ] **Step 2: Run** `pnpm --dir ui exec vitest run`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --dir ui exec vitest run` and `pnpm --dir ui exec tsc --noEmit -p .`. Expected: pass.
- [ ] **Step 5: Commit** `feat(ui): Amend an authorised result from the order sheet`.

### Task 3: Live check and screenshots

- [ ] **Step 1:** In `tools/live-check/run-c.mjs`, after c5: authorise a result, amend it (the dev admin holds
  every capability), save a new value, submit, authorise as the reviewer; CE's Observation and report say
  `amended`, the warehouse `lab_results` row has the new value and status `amended`. Run
  `TARGET=dev CE=/home/fredrick/Projects/Repositories/openldr_ce tools/live-check/all.sh`. Expected: all pass.
- [ ] **Step 2:** Screenshots of Amend in the order sheet and the amend sheet, desktop and 375 px, on the Artifact page.
- [ ] **Step 3: Commit** `test: live check for amendments`.
