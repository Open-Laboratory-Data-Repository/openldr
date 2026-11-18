# Anomaly flags on saved requests: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a saved request with at least one audit finding carries `v1-flags` and `v1-findings` request attributes into CE.

**Architecture:** the cdr-source plugin adds two request-attribute extensions to each saved ServiceRequest, next to the `v1-check` mark. CE stores them with no code change and gains two code names.

**Tech Stack:** Rust (plugin), TypeScript and JSON (CE terminology).

**Spec:** `docs/superpowers/specs/2026-11-18-anomaly-flags-design.md`

## Global Constraints

- Extension URL `urn:openldr:ext:request-attribute`, system `urn:openldr:cs:request-attribute`, value as `valueString`.
- `v1-flags`: distinct classes, sorted, joined by `,`. `v1-findings`: JSON text of the report's `anomalies` array, as `Anomaly::to_json` gives it.
- No finding, no attribute. Held requests unchanged.
- The `v1-check` mark stays the last extension on the ServiceRequest. The two new attributes go just before it.
- cdr-source version becomes 0.1.2. No signing, publishing or push without the operator's yes.

## Review Focus

- A request whose only finding is `info`: it must still carry both attributes (not only warnings).
- A request with two findings of the same class: `v1-flags` names the class once.
- A held request: no ServiceRequest goes out, so nothing changes; the existing held tests cover it.

---

### Task 1: The plugin adds the two attributes (cdr-source repo, new worktree `.claude/worktrees/flags`, branch `feat/anomaly-flags` from `main`)

**Files:**
- Modify: `src/decode.rs` (beside `add_mark` at :164, and its caller at :213)
- Test: `src/decode.rs` tests module

- [ ] **Step 1: Write failing tests**
  - `a_saved_request_with_findings_carries_its_flags_and_findings`: a request that is saved and whose audit has a finding. Assert each ServiceRequest has one `v1-flags` attribute whose value is the sorted distinct classes, one `v1-findings` whose parsed JSON equals the group's `findings`, and that `v1-check` is still last.
  - `a_saved_request_with_no_findings_carries_neither`: a clean fixture with empty `findings`; no `v1-flags` or `v1-findings`.
  - `flags_name_each_class_once`: unit test of the new helper with two findings of one class.
- [ ] **Step 2: Run `cargo test --lib decode` and see them fail.**
- [ ] **Step 3: Implement `fn add_findings(list: &mut [Value], report: &AuditReport)` in `src/decode.rs`**, called before `add_mark`, doing nothing when `report.anomalies` is empty. Update the existing tests that pin "the stored resources plus the mark and nothing else" and "the estimate is the last attribute before the check" so the two new attributes may sit between.
- [ ] **Step 4: Run `cargo test` (all) and the UI tests `cd ui && pnpm test`; both pass.**
- [ ] **Step 5: Bump to 0.1.2 the way the 0.1.1 release did (`git show bf76b6c --stat`), add the fault to `docs/fault-catalogue.md` section G, and a line in `docs/GUIDE.md` on where the flags land. Commit.**

### Task 2: CE names the two codes (CE worktree `.claude/worktrees/anomaly-flags`)

**Files:**
- Modify: `packages/terminology/codesystems/openldr-request-attribute.json`
- Test: `packages/terminology/src/request-attribute-codesystem.test.ts`

- [ ] **Step 1: Add a failing assertion that the file has `v1-flags` ("Data quality flags from the source check") and `v1-findings` ("Data quality findings from the source check").**
- [ ] **Step 2: Run the test and see it fail; add the two concepts; run it and see it pass.**
- [ ] **Step 3: Add the two codes wherever the docs list `v1-check` (grep under `apps/web/src/docs` and `apps/studio/src/docs`), en, fr and pt. Commit.**
