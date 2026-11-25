# Conditional plugin writes and the lab's hold: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CE's `db_write` gets conditional update and delete steps, and the lab plugin uses them so
reject, cancel and send back can no longer race authorise.

**Architecture:** CE adds `where` and `expect` to update and delete steps in
`packages/db/src/plugin-data-requests.ts`; a wrong row count throws `PluginRequestError('conflict')`
inside the write's transaction, which the host already maps to `REQUEST_CONFLICT`. The plugin adds
`hold` and `hold_at` to `order_tests`; authorise sets the hold before `fhir_emit`, and the three
competing writes require an empty hold.

**Tech Stack:** TypeScript, Kysely, zod, vitest, pg-mem and PostgreSQL (CE); Rust, `cargo test`
with `tests/fake_host.rs` (plugin).

**Spec:** `docs/superpowers/specs/2026-11-25-plugin-conditional-write-design.md`

## Global Constraints

- The conflict code the plugin sees is exactly `REQUEST_CONFLICT`.
- `expect` is a whole number, 0 or more. `where` takes the select filter shape and its limit
  (`MAX_FILTERS`, 50).
- A hold is stale after 2 minutes (120 seconds).
- The refusal text while a fresh hold is on: "This test is being authorised. Try again in a moment."
- The refusal text while a stale hold is on: "This test's result may already be in CE. Authorise it
  to finish."
- Plugin tables change only by adding nullable columns (`tests/plan-1-tables.json` check).
- No em dashes in any text written (AGENTS.md section 1).

## Review Focus

1. A facility-limited caller's conditional step on another facility's row changes 0 rows: with
   `expect: 1` the write conflicts and saves nothing, rather than reporting success.
2. A `where` naming an undeclared column is refused as `REQUEST_COLUMN` before anything runs.
3. A conflict on step 2 rolls back step 1 of the same request.
4. Two reviewers authorise the same test at once: one finishes, the other is told the test is being
   authorised, and CE gets one set of records.
5. A failed send to CE clears the hold, so a reject right after works.

---

### Task 1: CE conditional update and delete steps

**Files:**
- Modify: `packages/db/src/plugin-data-requests.ts` (`PluginRequestErrorReason`, `writeStepSchema`,
  `PlannedStep`, `planStep`, the write loop in `createPluginRequests().write`)
- Test: `packages/db/src/plugin-data-requests.test.ts`, `packages/db/src/plugin-data-requests.live.test.ts`
- Docs: `apps/web/src/docs/0.1.8/{en,fr,pt}/plugin-host-functions.md` (the `db_write` section)

**Interfaces:**
- Produces: update and delete steps accept `where?: SelectFilter[]` and `expect?: number`.
  `PluginRequestErrorReason` gains `'conflict'`. Host answer code `REQUEST_CONFLICT` (existing
  mapping, `packages/bootstrap/src/plugin-host.ts:205`).

- [ ] **Step 1: Write the failing pg-mem tests** in `plugin-data-requests.test.ts`, beside the
  existing write tests and with their fixtures (`samples` table, `all`, `siteA`):
  - `an update with where changes only a row that still matches`: update `samples` key `{ id: 1 }`
    set `note: 'x'` where `[{ column: 'code', op: 'eq', value: <row 1's code> }]` gives `rowCount 1`;
    the same with a wrong code gives `rowCount 0` and the row is unchanged.
  - `expect refuses a wrong count and saves nothing of the request`: steps `[update id 1 set note
    'a', update id 2 set note 'b' where code eq 'nope' expect 1]` rejects with reason `conflict`,
    message containing `step 2` and `samples`; row 1's note is unchanged.
  - `expect 0 passes when nothing matches`: delete key `{ id: 99 }` expect 0 resolves `rowCount 0`.
  - `a facility-limited caller's conditional step on another facility's row conflicts`: `siteA`
    updates a row of facility `fb` with expect 1, rejects with `conflict`.
  - `where on an undeclared column is refused before anything runs`: reason `column`, and the
    statement counter shows no query ran.
  - `expect must be a whole number, 0 or more`: `expect: -1` and `expect: 1.5` reject with reason
    `invalid`.
- [ ] **Step 2: Run them and see them fail.** Run: `cd packages/db && npx vitest run src/plugin-data-requests.test.ts`.
  Expected: the new tests fail (unknown keys refused by the strict schema).
- [ ] **Step 3: Implement.** Add `where: z.array(filterSchema).max(MAX_FILTERS).optional()` and
  `expect: z.number().int().min(0).optional()` to the update and delete objects. Move the filter
  checking out of `planSelect` into `planFilters(t: TableFacts, where: SelectFilter[])` and use it
  from both. In the write loop, apply the planned filters to `q` the way the select builds them, and
  after `executeTakeFirst` throw `new PluginRequestError('conflict', \`step ${i + 1} on table ${t.name}: expected ${expect} rows to change, ${n} did; nothing was saved\`)`
  when `expect` is set and differs.
- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: all pass.
- [ ] **Step 5: Live test.** In `plugin-data-requests.live.test.ts` add `a conditional update loses
  to a change committed first, and saves nothing`: request A is `[insert a row, update row 1 where
  note eq 'old' expect 1]`; before it runs, another connection commits `note = 'new'` on row 1;
  A rejects with `conflict` and the inserted row is absent. Run with the live database variable the
  file names, pointed at the dev Postgres maintenance database (5433), as in batch 1. Expected: pass.
- [ ] **Step 6: Docs.** In the `db_write` section of the three `plugin-host-functions.md` files,
  describe `where`, `expect` and `REQUEST_CONFLICT` in two short paragraphs with one example. Run
  `cd apps/web && npx vitest run src/docs`. Expected: pass.
- [ ] **Step 7: Commit** `feat(plugins): conditional update and delete steps in db_write`.

### Task 2: Plugin fake host and the hold columns

**Files:**
- Modify: `tests/fake_host.rs` (`apply`, update and delete arms), `manifest.template.json`
  (`order_tests` columns), `tests/plan-1-tables.json` only if its check requires listing new columns
- Test: `tests/store.rs`

**Interfaces:**
- Consumes: Task 1's step fields and code.
- Produces: `order_tests.hold` (text, nullable) and `order_tests.hold_at` (timestamp, nullable). The
  fake host answers `REQUEST_CONFLICT` as CE does, and keeps the tables unchanged on it.

- [ ] **Step 1: Failing tests** in `tests/store.rs`: `fake host applies where and expect` (an update
  with `where status eq 'x'` on a row whose status is `y` gives rowCount 0; with `expect: 1` it
  errors `REQUEST_CONFLICT` and an earlier step in the same write is not kept).
- [ ] **Step 2: Run** `cargo test --test store`. Expected: the new test fails.
- [ ] **Step 3: Implement** in `apply`: read `step["where"]` through `checked_filter` and `passes`
  (the select helpers), require it on update and delete matches, and compare `step["expect"]` to the
  count. Add the two columns to `order_tests` in the manifest.
- [ ] **Step 4: Run** `cargo test`. Expected: all pass, including the tables check.
- [ ] **Step 5: Commit** `feat: order_tests hold columns, and the fake host learns conditional steps`.

### Task 3: The hold on authorise, and the guarded writes

**Files:**
- Modify: `src/results.rs` (`release`, `set_status` callers at send back), `src/rejects.rs`
  (`reject_tests` step at line 85, `reject_test`, `reject_sample`), `src/orders.rs` (cancel, line 750)
- Modify: `README.md` ("Known limits" loses both entries), `docs/GUIDE.md`, `GUIDE.fr.md`,
  `GUIDE.pt.md` (one line where reject is described: a test being authorised cannot be rejected for
  a moment)
- Test: `tests/results.rs`, `tests/orders.rs`

**Interfaces:**
- Consumes: Task 2's columns and fake host.
- Produces: `fn hold_step(test_id: &str, expected_status: &str, token: &str, now: &str, stale: Option<&str>) -> Value`
  and `fn unhold_step(test_id: &str, token: &str) -> Value` in `src/results.rs`; `pub const HOLD_STALE_SECS: i64 = 120`;
  `pub fn being_authorised(host: &dyn Host, test_id: &str) -> LabResult<LabError>` that reads the
  hold and returns the fresh or stale refusal from Global Constraints.

- [ ] **Step 1: Failing tests** in `tests/results.rs`:
  - `a reject while authorise holds the test is refused and the test is authorised`: use the fake
    host's race hook to land a reject's write between authorise's hold and its final write; the
    reject answers the fresh refusal; the test ends `authorised`; CE got one emit.
  - `a reject that wins before the hold makes authorise refuse and send nothing`: reject first,
    then authorise; authorise answers a conflict and `fhir_emit` was not called.
  - `two authorise calls at once: one finishes, one is told the test is being authorised`.
  - `a failed send clears the hold, and a reject right after works`.
  - `a stale hold is taken over by authorise, and refuses a reject with the stale text` (set
    `hold_at` 121 s before the fake clock).
  - In `tests/orders.rs`: `cancel refuses while a test is held`.
- [ ] **Step 2: Run** `cargo test`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** In `release`, after the checks and before `fhir_emit`: write
  `hold_step` (where status eq the read status and `hold is_null`, expect 1); on `REQUEST_CONFLICT`
  try once more with `stale = Some(old token)` when the stored hold is older than
  `HOLD_STALE_SECS`, otherwise return `being_authorised`. Token: `ids::hash_parts` of test id,
  caller id and `now`. On `fhir_emit` error, write `unhold_step` and return the error. The final
  write's status step becomes conditional on `hold eq token` with expect 1 and sets `hold` and
  `hold_at` to null. `keep_held` adds `unhold_step`. In reject, cancel and send back, add
  `where hold is_null` and `expect 1` to the order_tests status update; on `REQUEST_CONFLICT`
  return `being_authorised`. Remove the "read again just before the write" check only if its tests
  still pass without it; otherwise leave it.
- [ ] **Step 4: Run** `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `pnpm --dir ui test`. Expected: all pass.
- [ ] **Step 5: README and guides.** Remove both "Known limits" entries and describe the hold in
  the results section in three lines. Add the one guide line in en, fr and pt.
- [ ] **Step 6: Commit** `fix: authorise holds a test while it sends to CE, so reject, cancel and send back cannot race it`.

### Task 4: Live check on the dev stack

Needs Task 1 merged into CE's local `main` (the dev stack runs from it) and the dev server
restarted by the operator, or the plugin's conditional steps are refused there. Ask before merging.

- [ ] **Step 1:** `TARGET=dev CE=/home/fredrick/Projects/Repositories/openldr_ce tools/live-check/all.sh`.
  Expected: every run passes as before.
- [ ] **Step 2:** Add to `tools/live-check/run-c.mjs` one case: authorise and reject the same test
  with two users at the same moment (`Promise.all`), then assert the test is either `authorised`
  with the reject refused, or `rejected` with authorise refused and no DiagnosticReport in CE for it.
  Run it ten times in a loop. Expected: never rejected while CE holds its report.
- [ ] **Step 3: Commit** `test: live check races authorise against reject`.
