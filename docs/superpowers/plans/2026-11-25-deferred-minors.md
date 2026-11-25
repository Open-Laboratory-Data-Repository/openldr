# Deferred minors from batches 2 to 5: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 37 deferred minor findings the operator chose on 2026-11-25 ("Confirmed + deferred",
verdict table in the session): 21 confirmed and 16 deferred. P1 changes only the pack README (a
higher CE range would refuse the dev install).

**Spec:** the verdict table rows below are the spec. Each fix follows the finding's plain words; three
design calls are mine and stated here.

## Design calls (mine)

- **A2a.** List items get a `version` integer column (nullable, read as 0). A save sends the version
  it read; a save of an older version is refused `conflict` "Someone else changed this item. Open it
  again." The Settings sheet sends it.
- **M7.** `lab_result_amend_cancel { testId }` (permission `lab.results.amend`): an amended test that
  is not yet authorised again goes back to `authorised`, its values put back from the amend event, the
  send row back to `sent`, an `amend-cancel` event. It also frees a test whose parameters CE dropped.
- **A5d.** The Enter results line reads "This test is released without review, unless a value is
  critical or the lab turned auto-release off." (en, fr, pt).

## Global Constraints

- Every fix has a test that fails first. Plugin: `cargo test`, `cargo clippy -D warnings`, UI vitest and
  tsc. CE: the full gate (`--force --concurrency=2`) and server lint. Pack: `node check.mjs`.
- New plugin error sentences go in `src/messages.rs` with fr and pt words.
- No em dashes. UI per AGENTS.md section 5.

---

### Task 1 (plugin): data and rules

A2a, A2b, 2a4, S1, S4, S5, E1, E2, E3, M3, M4, M5, M7, M9, and the M8 tests.
Files: `src/lists.rs`, `src/samples.rs`, `src/rejects.rs`, `src/settings.rs`, `src/results.rs`,
`src/sends.rs`, `src/messages.rs`, `manifest.template.json`, `tests/*.rs`, `README.md`.

### Task 2 (plugin): fake host and page

2a3 (fake host plans every step's filters before it writes, as CE does), A2d, A2e, S2, S3, S6, A5d,
E1 (page side), M7 (Cancel amendment in the order sheet), and the guides A5a, A5b, A5c, M7 in en, fr, pt.

### Task 3 (CE)

A2c (`plugin call` parses `--input` before CE starts), 2a2 (owner check locks rows in id order),
R1 (a failed role check is not kept), R2 (a missing role on `set local role` clears the kept answer and
retries once), R3 (Postgres 16 checks `SET`), R4 (the role may only read `_openldr_shapes`), R5 (down
leaves a role other databases use), R6 (live tests for an update that adds a table, and counts under
the role).

### Task 4 (pack)

P2 (drop the dead form check), P4 (name `marketplace.manage`), P5 (drop `/docs` from the layout),
P1 (README says why the range stays).

### Task 5

Fresh review of all three, fix pass, then ask about merging. Live check on dev after the plugin merge.
