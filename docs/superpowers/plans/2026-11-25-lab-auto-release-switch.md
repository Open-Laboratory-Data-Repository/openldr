# Lab-wide auto-release switch: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lab turns auto-release off for every test with one setting, "Allow auto-release".

**Architecture:** Lab plugin only. One new key in `src/settings.rs`; `requires_verification` in
`src/results.rs` answers `true` when the switch is off, so both its callers (the result view and
submit) follow it. A switch on the Settings tab, words in en, fr and pt, and one live check.

**Tech Stack:** Rust (`cargo test`, `tests/fake_host.rs`), React + vitest UI.

**Spec:** `docs/superpowers/specs/2026-11-25-lab-auto-release-switch-design.md`

## Global Constraints

- Key `allowAutoRelease`, boolean, default `true`.
- Off: every submitted result goes to `pending_review`; the view's `requiresVerification` is `true`.
- A result CE holds as an auto-release (send row `release: auto`) still finishes as one.
- A caller with a facility limit is refused a change, as for `allowSelfAuthorise`.
- UI: AGENTS.md section 5, toasts, label-left grid, works at 375 px, text in en, fr and pt.
- No em dashes in any text written.

## Review Focus

1. The switch turned off while a result is held by CE as an auto-release: it finishes as one.
2. A stored value of the wrong type (`"no"`): reads as the default, on.
3. Lab settings saved before this version (no `allowAutoRelease` row): auto-release stays on.
4. Turning it off does not touch results already `pending_review` or `authorised`.
5. A limited caller reads the switch but cannot change it.

---

### Task 1 (plugin): the setting and the submit rule

**Files:**
- Modify: `src/settings.rs` (`ALLOW_AUTO_RELEASE`, `defaults()`, `pub fn allow_auto_release(host) -> LabResult<bool>`),
  `src/results.rs:215-223` (`requires_verification` answers `true` when the switch is off),
  `README.md` (the auto-release rule names the switch)
- Test: `tests/settings.rs`, `tests/results.rs`

**Interfaces:**
- Produces: `lab_settings_get` and `lab_settings_set` answer `allowAutoRelease: bool` beside the others.

- [ ] **Step 1: Failing tests:**
  - settings: `auto_release_defaults_to_on_and_saves_off_with_an_audit_row` (`get` gives `allowAutoRelease: true`;
    `set {allowAutoRelease:false}` gives false and writes one audit row); `a_stored_auto_release_of_the_wrong_type_reads_as_on`;
    `a_limited_caller_cannot_turn_auto_release_off` (`refused`).
  - results: `with_auto_release_off_a_no_review_test_waits_for_review` (submit answers `autoReleased: false`,
    status `pending_review`, nothing sent to CE); `the_result_view_needs_review_when_auto_release_is_off`
    (`lab_result_params` gives `requiresVerification: true`); `a_held_auto_release_finishes_after_the_switch_is_turned_off`;
    `turning_auto_release_back_on_releases_the_next_submit`.
- [ ] **Step 2: Run** `cargo test --no-fail-fast`. Expected: the new tests fail; the tests that assert the whole settings
  shape fail too (they lack `allowAutoRelease`).
- [ ] **Step 3: Implement.** Add the key; update the shape tests to include `allowAutoRelease: true` (a ruling in the ledger).
- [ ] **Step 4: Run** `cargo test --no-fail-fast` and `cargo clippy --all-targets -- -D warnings`, and
  `UPDATE_CONTRACT=1 cargo test --test contract` if the settings contract changes. Expected: pass.
- [ ] **Step 5: Commit** `feat: a lab-wide switch turns auto-release off`.

### Task 2 (plugin): the switch on the Settings tab, and the guides

**Files:**
- Modify: `ui/src/settings/SettingsTab.tsx` (a switch under "Allow self-authorise", same pattern),
  `ui/src/api.ts` (settings type), `ui/src/i18n.ts` (`settings.autoRelease`, `.hint`, `.saved.on`, `.saved.off` in en, fr, pt),
  `docs/GUIDE.md`, `GUIDE.fr.md`, `GUIDE.pt.md` (task "Results that skip review": how to turn it off, and the CLI line)
- Test: `ui/src/settings/SettingsTab.test.tsx`

- [ ] **Step 1: Failing UI test** `the auto-release switch shows on, saves off with a toast, and shows off`.
- [ ] **Step 2: Run** `pnpm --dir ui test`. Expected: the new test fails.
- [ ] **Step 3: Implement** the switch and the words.
- [ ] **Step 4: Run** `pnpm --dir ui test` and `pnpm --dir ui typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(ui): Allow auto-release on the Settings tab`.

### Task 3: Live check on the dev stack

- [ ] **Step 1:** In `tools/live-check/run-c.mjs`, after c3: turn `allowAutoRelease` off, submit a normal value on the
  skip-review test (`autoReleased: false`, `pending_review`), turn it back on, submit another (`authorised`). Put the
  setting back to on in a `finally`. Run `TARGET=dev CE=/home/fredrick/Projects/Repositories/openldr_ce tools/live-check/all.sh`.
  Expected: all pass.
- [ ] **Step 2:** Screenshot of the Settings switch, desktop and 375 px, on the screenshot Artifact page.
- [ ] **Step 3: Commit** `test: live check for the auto-release switch`.
