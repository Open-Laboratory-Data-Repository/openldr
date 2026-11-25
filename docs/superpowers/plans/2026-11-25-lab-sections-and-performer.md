# Lab sections and the performing lab: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bench filters Results and Review by the test's catalog category, and every report sent
to CE carries its category and the lab as performer.

**Architecture:** Plugin only. `order_tests.category` is copied at register; the worklist filters on
it; authorise reads the category live and the lab facility setting for the report.

**Tech Stack:** Rust (`cargo test`, `tests/fake_host.rs`), React + vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-lab-sections-and-performer-design.md` (CE repo)

## Global Constraints

- Category system `urn:openldr:codesystem:test-category`; value set `urn:openldr:valueset:test-category`.
- `labFacilityId`: text, empty means unset; must pass `facilities.get`; lab-wide (limited caller refused).
- Performer form = the ServiceRequest requester form (`sends.rs` `requester`).
- UI per AGENTS.md section 5; en, fr, pt; phone width. No em dashes.

## Review Focus

1. A test registered before this version (no category) under a Section filter: not shown, no error.
2. The lab facility removed from CE's register after it was set: the report keeps the stored name only, authorise still works.
3. A catalog test whose category changes after registration: the worklist filter uses the stored one, the report the new one.
4. `labFacilityId` set to "" clears it: reports go without performer again.
5. A facility-limited user reading settings sees the lab facility but cannot change it.

---

### Task 1: Plugin backend

**Files:** `manifest.template.json` (`order_tests.category` text nullable), `src/orders.rs` (register copies `t["category"]`), `src/results.rs` (worklist `category`; authorise passes category and performer), `src/sends.rs` (`diagnostic_report` gains `category: Option<Value>, performer: Option<Value>`), `src/settings.rs` (`labFacilityId`, default `""`, checked with `facilities.get`), `tests/fake_host.rs` (catalog tests carry `category`; `valueset.expand` of the test-category set), tests in `tests/results.rs` and `tests/settings.rs`, `README.md`.

- [ ] **Step 1: Failing tests:** `register_copies_the_tests_catalog_category`; `the_worklist_filters_by_category` (and a test with no category is left out of a filtered list, Review Focus 1); `a_report_carries_the_category_the_catalog_has_at_authorise` (Review Focus 3); `a_report_names_the_lab_facility_as_performer`; `no_performer_until_the_lab_facility_is_set_and_after_it_is_cleared` (Review Focus 4); `a_lab_facility_ce_no_longer_has_keeps_its_name_only` (Review Focus 2); `lab_facility_must_be_a_facility_ce_knows`; `a_limited_caller_cannot_set_the_lab_facility` (Review Focus 5).
- [ ] **Step 2: Run** `cargo test`. Expected: the new tests fail.
- [ ] **Step 3: Implement** as the files above say. The setting stores the facility id and the name read at save, so a report can still name it if CE later drops it.
- [ ] **Step 4: Run** `cargo test`, `cargo clippy --all-targets -- -D warnings`, `UPDATE_CONTRACT=1 cargo test --test contract` (check the diff is only the new fields). Expected: pass.
- [ ] **Step 5: Commit** `feat: sections from the catalog category, and the lab as performer on reports`.

### Task 2: Plugin UI and guide

**Files:** `ui/src/api.ts`, `ui/src/results/*` (Results and Review worklists: Section picker beside the facility filter), `ui/src/settings/SettingsTab.tsx` (This lab's facility, a facility search picker copied from the Orders facility filter), `ui/src/i18n.ts`, `docs/GUIDE*.md`.

- [ ] **Step 1: Failing UI tests:** the Results Section filter sends `category`; Review too; "All sections" sends none; the Settings facility picker saves `labFacilityId` and shows the name with a toast; clearing it sends `""`.
- [ ] **Step 2: Run** `pnpm --dir ui test`. Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --dir ui test` and `pnpm --dir ui typecheck`. Expected: pass.
- [ ] **Step 5: Guide** en, fr, pt: the Section filter, and "This lab's facility" with its CLI line.
- [ ] **Step 6: Commit** `feat(ui): Section filter on Results and Review, and the lab's facility in Settings`.

### Task 3: Live check and screenshots

- [ ] **Step 1:** In `tools/live-check/run-c.mjs`: set the lab facility, authorise a test, assert CE's DiagnosticReport has `category` and `performer`, and the warehouse `diagnostic_reports.performer` is the facility code; then clear the setting. Run `TARGET=dev ... all.sh`. Expected: all pass.
- [ ] **Step 2:** Screenshots of the Section filter and the setting at desktop and 375 px, onto the screenshot page.
- [ ] **Step 3: Commit** `test: live check for report category and performer`.
