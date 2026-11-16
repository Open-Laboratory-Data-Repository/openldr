# Part 4, first cut: the check run and the held-back view: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lab administrator starts a check on a finished copy from the plugin's page, sees it save what passes and hold what does not, and reads why each held request was held.

**Architecture:** CE core gains a check run beside the copy run: it pages the copy, calls the plugin's decode, saves through the normal save path and keeps held groups in a table of their own. A plugin page reaches it through six broker operations. The `cdr-source` plugin gains a reference copy of v1, a label on each group, and two tabs on its page.

**Tech stack:** TypeScript (Kysely, zod, vitest on pg-mem) in `openldr_ce`; Rust and Preact in `cdr-source`.

**Spec:** `docs/superpowers/specs/2026-11-16-migration-check-run-design.md`. Sections 5.1 to 5.7 bind this plan. Its section 5.8 steps 4 to 7 (CLI, v1-only list, workflows switch, docs) are a later plan.

**Where:** `openldr_ce` on branch `check-run`, in the worktree `/home/fredrick/Projects/Repositories/openldr_ce/.claude/worktrees/check-run`. `cdr-source` on branch `check-run`, in `/home/fredrick/Projects/Repositories/cdr-source`. Tasks C1 to C4 are CE and run one after another. Tasks P1 and P2 are the plugin and run one after another. The two lines run side by side.

## Global constraints

- CE core never names a source system, a source table or a clinical code. It reads `key`, `held`, `resources`, `error` and `label` of a group and nothing inside `findings` or `check`.
- A source row value never reaches a log line, an audit row, an error message or a thrown error's text. Only `import_copy_rows` and `import_check_held` hold values. A plugin's error is kept only as a bare code (`/^[A-Z][A-Z0-9_]{0,63}$/`), as `pluginCode` in `packages/bootstrap/src/import-run.ts` does.
- A request is saved only when its group is not held, has no error, and its resources pass `checkResources` against the plugin's emit grant. Anything else is held or failed. Nothing is saved when the decode call fails.
- Copy the sibling. The check service follows `packages/bootstrap/src/import-copy.ts` for its run record, its compare-and-swap writes, heartbeat (30 s), takeover (2 minutes), `tick`, `idle` and `release`. The operations follow the copy operations in `packages/bootstrap/src/plugin-broker.ts`. The page follows `CopyPanel.tsx`.
- Tests run on pg-mem. Any `ORDER BY` with a limit has a unique last column.
- Run from the CE worktree with `OPENLDR_SKIP_ENV_FILE=true`. Never touch the databases `openldr`, `openldr_target`, `openldr_docs`, `openldr_docs_target` or `keycloak`, port 3000, or the containers `openldr-mssql` and `openldr-docs-system-mssql`. Never open a `.env` file or a `temp/` or `data/` folder. Never start a container or a dev server.
- Migration number 119 is free on every branch as of 2026-11-16. Check again before adding it.
- `apps/server` lint: a route handler returns or awaits `reply.send`.
- No `Co-Authored-By` and no "Generated with" line in any commit. Never push. Never merge.
- Prose in comments, docs and messages: short sentences, plain words, no em dash.

## Review focus

1. Two servers tick at once: a check run is driven by one. (C3)
2. The plugin call fails or times out on a page: nothing of that page is saved, the page is halved, and at one request the request is held with `DECODE_FAILED`. (C3)
3. A request held by one run passes in the next: its held row goes. (C3)
4. A held request's values in an error path: no value in a log or a thrown message. (C3, C4)
5. A held list of zero rows, and of more than one page, on a phone at 375 by 812. (P2)

---

### Task C1: the copy store lists keys, and the held-back store (`@openldr/db`)

**Files:**
- Modify: `packages/db/src/import-copy-store.ts`, `packages/db/src/import-copy-store.test.ts`
- Create: `packages/db/src/migrations/internal/119_import_check_held.ts` and its test, registered in `migrations/internal/index.ts`; `packages/db/src/import-check-held-store.ts` and its test
- Modify: `packages/db/src/schema/internal.ts`, the package's exports

**Interfaces, produced:**
```ts
// import-copy-store.ts, added to ImportCopyStore
/** Up to `limit` distinct keys of a set, in key order, after `after` (null = from the start). */
listKeys(copyId: string, setName: string, after: string | null, limit: number): Promise<string[]>;
/** Every row of a set, ordered by detail, key, seq. Throws CopySetTooLargeError past `maxBytes` of row JSON. */
readSet(copyId: string, setName: string, maxBytes: number): Promise<CopyRow[]>;
export class CopySetTooLargeError extends Error { readonly setName: string; readonly bytes: number }

// import-check-held-store.ts
export type HeldReason = 'held' | 'error';
export interface HeldRow { copyId: string; key: string; runId: string; reason: HeldReason; label: string | null; error: string | null; heldAt: string }
export interface HeldItem extends HeldRow { findings: unknown; check: unknown }
export interface ImportCheckHeldStore {
  put(item: Omit<HeldItem, 'heldAt'>): Promise<void>;            // insert or replace by (copyId, key)
  remove(copyId: string, keys: string[]): Promise<void>;
  list(copyId: string, opts: { reason?: HeldReason; label?: string; offset: number; limit: number }): Promise<{ rows: HeldRow[]; total: number }>; // ordered by key
  get(copyId: string, key: string): Promise<HeldItem | null>;
  deleteSome(copyId: string, limit: number): Promise<number>;    // 0 means none left
}
export function createImportCheckHeldStore(db: Kysely<InternalSchema>): ImportCheckHeldStore;
```
Table `import_check_held`: `copy_id` text, `key` text, `run_id` text, `reason` text, `label` text null, `error` text null, `findings` jsonb, `check` jsonb, `held_at` timestamptz default now; primary key `(copy_id, key)`. Follow migration 118 for the dialect helpers and the down step.

- [ ] **Step 1: failing tests.** `listKeys`: 5 keys with several rows each, `limit` 2 from null gives the first 2 in key order, from the second gives the next 2, past the end gives none; another set and another copy are not seen. `readSet`: rows in detail, key, seq order; a set over `maxBytes` throws `CopySetTooLargeError` whose message holds the set name and the size and no row value. Held store: `put` twice on one key keeps one row with the later values; `list` pages by key with a total, filters by reason and by label; `get` returns the JSON as stored; `remove` and `deleteSome` as documented; rows of another copy are not seen. Migration test as 118's.
- [ ] **Step 2: run them.** `pnpm --filter @openldr/db test -- import-copy-store import-check-held 119` Expected: fail.
- [ ] **Step 3: implement.**
- [ ] **Step 4: run the package's tests and typecheck.** `pnpm --filter @openldr/db test` and `pnpm --filter @openldr/db typecheck`, each redirected to a file, exit code read after.
- [ ] **Step 5: commit.** `feat(db): list a copy's keys and keep held-back requests`

### Task C2: the manifest names a decode (`@openldr/marketplace`)

**Files:** `packages/marketplace/src/artifact-manifest.ts` and its test.

**Interfaces, produced:** `importSource.entrypoints` gains `decode?: string` and `twinKeys?: string`. `export function canCheck(source: ImportSource): boolean` is true when `copy` and `decode` are both named. Refused at parse: `twinKeys` without `decode`; `decode` without `copy`. The install rule that every import entrypoint name appears in `payload.entrypoints` covers the two new names.

- [ ] **Step 1: failing tests** for each line above, beside the existing `canCopy` tests.
- [ ] **Step 2 to 4: run, implement, run the package's tests and typecheck.**
- [ ] **Step 5: commit.** `feat(marketplace): a plugin can name a decode and a twin-keys entrypoint`

### Task C3: the check run (`@openldr/bootstrap`)

**Files:**
- Create: `packages/bootstrap/src/import-check.ts`, `import-check.test.ts`
- Modify: `packages/bootstrap/src/import-driver.ts` and its test (a turn also calls `checks.tick()`, after the copies), `import-copy.ts` (removing a copy also empties its held rows, and is refused while a check run on it is live), `activity-service.ts` (a check run shows as a lifecycle, `check:<plugin>`), `index.ts` (wiring, beside `importCopies`), `import-run.ts` (export what is shared; add the audit action names)

**Interfaces, produced:**
```ts
export type CheckStatus = 'queued' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'completed' | 'failed';
export interface CheckCounts { read: number; saved: number; held: number; failed: number; resources: number; labels: Record<string, number> }
export interface CheckRun {
  id: string; kind: 'check'; rev: number;
  pluginId: string; pluginVersion: string;
  copyId: string; referenceCopyId: string | null;
  status: CheckStatus; options: Record<string, string>; pageSize: number;
  cursor: string | null; counts: CheckCounts;
  waiting: { since: string; attempt: number; error: string } | null;
  driver: string | null; startedAt: string; updatedAt: string; finishedAt: string | null;
  lastError: string | null; startedBy: string;
}
export interface ImportCheckStartInput { pluginId: string; copyId: string; referenceCopyId: string | null; options: Record<string, string>; pageSize?: number; actor: ImportActor }
export interface ImportCheckService {
  checkers(): Promise<Array<{ id: string; version: string; needsReference: boolean }>>;
  start(input: ImportCheckStartInput): Promise<CheckRun>;
  get(pluginId: string, runId: string): Promise<CheckRun | null>;
  list(pluginId: string): Promise<CheckRun[]>;
  stop(pluginId: string, runId: string, actor: ImportActor): Promise<CheckRun>;
  held(pluginId: string, copyId: string, opts: { reason?: HeldReason; label?: string; offset: number; limit: number }): Promise<{ rows: HeldRow[]; total: number }>;
  heldItem(pluginId: string, copyId: string, key: string): Promise<HeldItem | null>;
  tick(): Promise<void>; idle(): Promise<void>; release(): Promise<void>;
}
```
Fixed values: collection `__import-checks`; run id = the first 32 hex characters of SHA-256 of `check|<copyId>`, so one run per source copy; default page size 500, from 1 to 2000; dictionaries cap 64 MB (`64 * 1024 * 1024`); labels match `/^[a-z][a-z0-9_]{0,31}$/`, at most 12 distinct per run, others counted under `other`; audit actions `import.check.start`, `import.check.stop`, `import.check.takeover`, `import.check.finish`; decode output schema: `{ groups: [{ key: string, held?: boolean, findings?: unknown, check?: unknown, resources?: unknown[], error?: string, label?: string }] }`; twin-keys output schema: `{ keys: string[] }`.

Rules, from the design's 5.1 and 5.4:
- `start` is refused unless the source copy belongs to the plugin and is `completed`; unless `referenceCopyId` is another completed copy of the same plugin when given; when the plugin names `twinKeys`, `referenceCopyId` may still be null (the site has no reference) and the decode then gets `twins: { requests: [], results: [] }`. A start on a run that is `stopped`, `completed` or `failed` begins again at the first key with counts at zero. A start on a live run is refused.
- One page: `listKeys` of set `requests`; `read` its rows and group them by detail name into `rows`; dictionaries are every other set of the source copy read with `readSet`, once per drive, as `{ [setName]: rows }`; with `twinKeys` and a reference copy, call it with `{ options, keys }`, `read` the returned keys from the reference copy's set `twins`, and group them by detail name into `twins`; call `decode` with `{ options, now, dictionaries, keys, rows, twins }` where `now` is `deps.now().toISOString()`.
- For each key of the page: no group gives failed with `NO_GROUP`, kept in the held store with reason `error`; a group with `error` gives failed with `pluginCode(error)`, kept with reason `error`; `held === true` gives held, kept with reason `held`, its `findings`, `check` and `label`; else `checkResources`, then `deps.persist(resources, provenance)` with `batchId` the run id; a refusal or a save error gives failed with that code, kept with reason `error`; a save gives saved, and `held.remove` for that key.
- A decode call that throws or times out saves nothing of the page. The page size is halved and the same cursor read again. At one key, that key is failed with `DECODE_FAILED` and the cursor moves. After 5 good pages the size grows back, as `import-run.ts` does.
- A database error on CE's side puts the run in `waiting` with the wait times of `retryWaitMs`, as a copy does. It never fails the run on the first error.
- The run is written after every page and at least every 30 seconds. `completed` when `listKeys` returns no key.

- [ ] **Step 1: failing tests** in `import-check.test.ts`, with a fake plugin and a fake copy as `import-copy.test.ts` builds them. One test per rule above, and the five review-focus cases that belong to C3. Named at least: `start_is_refused_until_the_copy_is_completed`, `a_passing_request_is_saved_and_a_held_one_is_kept`, `a_plugin_error_is_kept_as_a_bare_code`, `a_decode_call_that_throws_saves_nothing_and_halves_the_page`, `one_request_that_cannot_be_decoded_is_held_as_DECODE_FAILED`, `a_request_that_passes_later_leaves_the_held_store`, `start_again_begins_at_the_first_key`, `two_ticks_drive_a_run_once`, `a_run_left_by_a_dead_server_is_taken_after_two_minutes`, `stop_ends_the_run_at_the_next_page`, `twins_are_read_from_the_reference_copy_by_the_keys_the_plugin_names`, `with_no_reference_the_decode_gets_empty_twins`, `dictionaries_over_the_cap_fail_the_run_with_the_size_and_no_value`, `labels_are_counted_and_capped`, `removing_a_copy_empties_its_held_rows`, `no_row_value_reaches_an_audit_row_or_an_error`.
- [ ] **Step 2 to 4: run, implement, run** `pnpm --filter @openldr/bootstrap test -- import-check import-driver import-copy activity` then the package's whole test and typecheck.
- [ ] **Step 5: commit.** `feat(bootstrap): a check run over a copy, saving what passes and keeping what is held`

### Task C4: operations for a plugin page, and the page SDK

**Files:** `packages/bootstrap/src/plugin-broker.ts` and its test; `packages/plugin-ui-sdk/src/types.ts`, `bootstrap.ts` and their tests; `packages/bootstrap/src/index.ts` (the broker gets the check service).

**Interfaces, produced.** Broker operations, with the copy operations' permission checks:

| Operation | Input | Output |
|---|---|---|
| `import.check.start` | `copyId`, `referenceCopyId: string \| null`, `options`, `pageSize?` | `CheckRun` for the page |
| `import.check.list` | | `CheckRun[]` |
| `import.check.status` | `runId` | `CheckRun \| null` |
| `import.check.stop` | `runId` | `CheckRun` |
| `import.check.held` | `copyId`, `reason?`, `label?`, `offset` (0 or more), `limit` (1 to 100) | `{ rows, total }` |
| `import.check.heldItem` | `copyId`, `key` (at most 200 characters) | `HeldItem \| null` |

A run for a page drops `driver`, as `copyForPage` does. SDK: `openldr.imports.check` with `start`, `list`, `status`, `stop`, `held`, `heldItem`, typed as `PluginCheckRun`, `PluginHeldRow`, `PluginHeldItem`.

- [ ] **Step 1: failing tests**, beside the copy operations' tests: each operation's happy path; refused without `host:import`; refused for a role below `lab_admin`; a copy of another plugin is not reachable; `limit` above 100 is refused.
- [ ] **Step 2 to 4: run, implement, run** the two packages' tests and typecheck.
- [ ] **Step 5: commit.** `feat: check run operations for a plugin page`

---

### Task P1: the plugin offers a reference copy and labels its groups (`cdr-source`, Rust)

**Files:** `src/options.rs`, `src/queries.rs`, `src/decode.rs`, `scripts/build.mjs`, their tests; `README.md`.

**Interfaces, produced:**
- `import_copy` with option `role` = `reference` returns exactly one set, `twins`: key query over the v1 request table's distinct `RequestID` that start with the option `requestIdPrefix` (required for this role), and two details, `requests` and `results`, each `SELECT [RequestID] AS [__key], <the columns the check reads>`. The column lists are the ones `src/check_request.rs` and `src/check_results.rs` read, and must include `RequestID`. Option `v1Db` names the database, default `OpenLDRData`, checked like the other database names. Any other `role` value is refused. With no `role` the output is byte for byte what it is today.
- Each group of `source_decode` gains `label`: `error` groups have none; held with a failed check and no error-level finding: `held_check`; held with an error-level finding and a check that did not fail: `held_rules`; both: `held_both`; not held with a passed check: `passed`; not held and not checked: `unchecked`.
- The built manifest names `importSource.entrypoints.decode = "source_decode"` and `twinKeys = "source_twin_keys"`.

- [ ] **Step 1: failing tests.** The reference set's exact SQL, as `the_taken_detail_is_exact` pins one today; the prefix is quoted as a literal and a quote in it is refused; a role of `Reference` or `x` is refused; no role equals today's output. One test per label on existing fixtures. A test that every column the check reads from a twin row is in the detail SQL.
- [ ] **Step 2 to 4: run, implement, run** `cargo test`, `cargo clippy --all-targets`, `cargo build --release --target wasm32-wasip1`, `node --test tools/real-data-check/*.test.mjs tests/fixture-guard.test.mts`. The golden fixtures gain `label` on every group: state it once in the report, with the count per label.
- [ ] **Step 5: commit.** `feat: a reference copy of v1, and a label on each decoded request`

### Task P2: the Check and Held back tabs (`cdr-source/ui`, Preact)

**Files:** `ui/src/App.tsx`, `api.ts`, `i18n.ts` (en, fr and pt for every new key), `styles.css`; create `CheckPanel.tsx`, `HeldPanel.tsx` and their tests; `App.test.tsx` if absent.

**Interfaces, consumed.** The six operations of Task C4, reached as `getOpenldr().imports.check`. Pin their shapes in `api.ts`, as the connector shapes are pinned there today, so the page builds against the SDK as it is on CE's `main`:
```ts
export interface CheckRun { id: string; copyId: string; referenceCopyId: string | null; status: 'queued'|'running'|'waiting'|'stopping'|'stopped'|'completed'|'failed'; options: Record<string,string>; pageSize: number; counts: { read: number; saved: number; held: number; failed: number; resources: number; labels: Record<string, number> }; waiting: { since: string; attempt: number; error: string } | null; startedAt: string; updatedAt: string; finishedAt: string | null; lastError: string | null }
export interface HeldRow { copyId: string; key: string; runId: string; reason: 'held'|'error'; label: string | null; error: string | null; heldAt: string }
export interface HeldItem extends HeldRow { findings: unknown; check: unknown }
```
`findings` is the plugin's own list: `[{ class, severity, message, details }]`. `check` is the plugin's own object: `{ passed, twin_key, request: { fields: [{ name, status, disa, v1, reason }] }, results: { observations: [...] } }`. Read the exact shapes from `src/check.rs` and `src/audit.rs` in this repository and from a fixture's expected output. Draw the source side under the heading "Source" and the other under "Reference". No string on the page names a source system.

The page:
- Tabs `Copy`, `Check`, `Held back`, drawn as the v1 plugin's page draws its tabs (`/home/fredrick/Projects/Repositories/openldr_ce/wasm/openldr-v1-import/ui/src/App.tsx`).
- **Copy:** the form gains "What this copy is": source, or reference. Reference shows the fields `v1Db` and `requestIdPrefix` and sends `role=reference`.
- **Check:** selects for the source copy and the reference copy (completed copies only, by connector name; plus "This site has no reference"); fields for site, laboratory code, time zone and request id prefix; label left, input right. A dots menu with Start, Start again and Stop, each shown only when the server would accept it. Status, the four counts, and the label counts with plain names. It reads the run again every `pollMs` while it is live.
- **Held back:** a table of 25 rows a page with the page controls of the copy panel's style: request, why, when. A filter by why: all, held by rules, held by check, held by both, error. An empty list shows the page's empty state, not an empty table. A row opens a panel over the page with the findings (severity, rule, message, values) and the check (field, source, reference, status, reason), then the results. Close returns focus to the row.
- At 375 by 812 nothing scrolls sideways but the tables' own wrappers.

- [ ] **Step 1: failing tests** in vitest with the fake SDK the copy panel's tests use: the tabs switch; Start sends the chosen copies and options; Start is absent while a run is live; the counts draw; the held list pages and filters; an empty list draws the empty state; a row opens the detail and draws both sides' values; every new i18n key exists in en, fr and pt (extend `i18n.test.ts`).
- [ ] **Step 2 to 4: run, implement, run** `pnpm test` and `pnpm typecheck` in `ui/`, then `node scripts/build.mjs`.
- [ ] **Step 5: commit.** `feat(ui): check controls and a held-back view on the plugin's page`

---

### After the tasks (controller)

- One whole-branch review of each repository's branch, one fix wave each, one re-review.
- The full CE gate on the worktree: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`.
- A scratch CE on port 3990 with both branches, the plugin installed, a source copy and a reference copy of a small real sample, a check run, and screenshots at desktop and phone width. The operator tests there.
