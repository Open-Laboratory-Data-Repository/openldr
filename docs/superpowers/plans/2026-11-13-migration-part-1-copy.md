# Migration part 1, the copy: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CE copies the rows of a source database to its own disk, unattended, through cut links and server restarts.

**Architecture:** A plugin's wasm names the sets of rows to copy. The server reads each set page by page through a connector and writes the rows, as read, to one table. One shared page reader retries a lost connection and halves a page that is too slow, and the one-pass import that exists today uses it too. Only the server process drives a copy. It finds runs that need a driver by a heartbeat, so a restart needs no person.

**Tech stack:** TypeScript, Node, Kysely on Postgres, zod, vitest, pg-mem in tests, Rust on `wasm32-wasip1` with Extism, Preact for the plugin page, commander for the CLI.

**Spec:** `docs/superpowers/specs/2026-11-13-disa-and-v1-migration-design.md`. Read it first, section 9 above all. This plan argues from it.

**Build this after design C is merged** (`docs/superpowers/plans/2026-11-13-cli-through-the-app.md`). C changes how CLI commands run and adds `packages/cli/src/command-meta.ts`, which Task 9 edits.

## Global constraints

- No write of any kind to a source database. Every statement sent to a connector passes `validateSelectSql` first, as today (`packages/bootstrap/src/import-run.ts:265`).
- No source row value in a log line, an audit row, an error message or a CLI line. The copy table may hold values. Nothing else may. A failure is stored as a short code.
- No DISA name, table name or decoding code in this repo. This plan touches CE core and the v1 plugin only.
- A plugin whose manifest lacks the new fields behaves exactly as today. Existing signed manifests must parse to the same object.
- Fixed values. Heartbeat every 30 seconds. A run with no write for 2 minutes has no driver. First retry wait 5 seconds, doubling to a ceiling of 300 seconds. After a timeout the source gets a `SELECT 1` with a 5-second limit, and only when that answers is the page halved, down to 1. A page grows back by doubling after 5 good pages in a row, never above the run's page size. A key that times out 3 times at a page of 1 is skipped with the code `SOURCE_TIMEOUT`. Default page size 500. Delete batch 10,000 rows. The driver looks for work every 5 seconds.
- Existing `openldr import` commands keep their names, options and output.
- The next internal migration number is not known until design C and design D are merged. Before adding the migration, list `packages/db/src/migrations/internal` on `main` and on every branch (`git branch -a`). Use the next free number everywhere this plan says `NNN`. Kysely refuses a gap.
- pg-mem is not Postgres. Any `ORDER BY` with a limit needs a unique tiebreaker. Say in each test file which layer it covers and which it does not.
- The plugin page is Preact in a sandboxed iframe with its own styles. It carries its own strings in en, fr and pt, and `wasm/openldr-v1-import/ui/src/i18n.test.ts` fails when a key is missing in one language.
- All prose follows the `unslop` skill. No em dashes. Docs land in en, fr and pt.
- One commit per task. No `Co-Authored-By` trailer. Ask the operator before the first push of the work branch.
- Only Linux can be tested here. Mark every Windows and macOS claim as unproven.
- Safety on the build machine. A dev stack is running and in use. Never stop or change it. Never point branch code at the databases `openldr`, `openldr_target`, `openldr_docs`, `openldr_docs_target` or `keycloak`. From a worktree, `loadConfig()` finds the main checkout's `.env`, so set `OPENLDR_SKIP_ENV_FILE=true` or override both database URLs for anything you start. Never run `pnpm --filter @openldr/server build:check` bare. Use ports 3990 to 3997, scratch databases named `sa_scratch_*`, and temp folders, and remove them afterwards.
- Full gate, at the end, never piped through `tail`: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`, plus `pnpm depcruise`, whose violation count must not rise above what `main` reports.

## Review focus

Five conditions the spec implies and a country team will hit. Each has a test in the task named.

1. The link cuts in the middle of a page. Expected: no half page is kept, no row is stored twice, the run shows `waiting`, and it carries on with no person. Task 5.
2. The server is killed in the middle of a copy, as in a power cut. Expected: after the server starts, the copy carries on from its last saved position, and a CLI process that is running at the same time never drives it. Task 6.
3. Start is asked twice for the same copy, once from the page and once from the CLI. Expected: one run, one driver. Task 5.
4. Delete is asked while the copy is running, or the server stops in the middle of a delete. Expected: the first is refused, the second finishes after the restart, and no rows are left behind. Tasks 5 and 6.
5. CE's own database refuses a write, as with a full disk. Expected: the run ends `failed` with a plain message. It does not wait and retry, because waiting cannot fix it. Task 5.

## File map

| File | What it holds |
|---|---|
| `packages/marketplace/src/artifact-manifest.ts` | `importSource` gains `entrypoints.copy` |
| `packages/db/src/migrations/internal/NNN_import_copy_rows.ts` | The copy table |
| `packages/db/src/import-copy-store.ts` | Reads and writes of the copy table |
| `packages/bootstrap/src/import-retry.ts` | Pure rules: which errors to retry, how long to wait, page sizes |
| `packages/bootstrap/src/import-source-reader.ts` | Reads one page from a source with those rules |
| `packages/bootstrap/src/import-run.ts` | The one-pass import, changed to use the reader |
| `packages/bootstrap/src/import-copy.ts` | The copy service: start, stop, delete, drive |
| `packages/bootstrap/src/import-driver.ts` | The server's loop that picks up runs with no driver |
| `packages/bootstrap/src/plugin-broker.ts`, `packages/plugin-ui-sdk/src/*` | Copy operations for a plugin page |
| `packages/cli/src/import-copy.ts`, `program.ts`, `command-meta.ts` | `openldr import copy ...` |
| `wasm/openldr-v1-import/src/queries.rs`, `lib.rs` | The v1 plugin's `import_copy` entrypoint |
| `wasm/openldr-v1-import/ui/src/CopyPanel.tsx` and friends | The Copy tab on the plugin page |

---

### Task 1: Manifest fields

**Files:**
- Modify: `packages/marketplace/src/artifact-manifest.ts:54` (`importSourceSchema`)
- Test: `packages/marketplace/src/artifact-manifest.test.ts`

**Interfaces:**
- Produces: `importSourceSchema` with an optional `entrypoints.copy`, and `entrypoints.queries` and `entrypoints.map` optional when `copy` is present. Two helpers exported from `@openldr/marketplace`:
  `canImportOnePass(source: ImportSource): boolean` (has `queries` and `map`) and `canCopy(source: ImportSource): boolean` (has `copy`).

- [ ] **Step 1: Write the failing tests**

```ts
const base = { connectorTypes: ['microsoft-sql'], entrypoints: { queries: 'q', map: 'm' } };

it('an import source with no new field parses to the same object', () => {
  expect(importSourceSchema.parse(base)).toEqual(base);
});
it('takes a copy entrypoint beside queries and map', () => {
  const src = { ...base, entrypoints: { ...base.entrypoints, copy: 'import_copy' } };
  expect(importSourceSchema.parse(src)).toEqual(src);
  expect([canImportOnePass(src), canCopy(src)]).toEqual([true, true]);
});
it('takes a copy entrypoint alone', () => {
  const src = { connectorTypes: ['microsoft-sql'], entrypoints: { copy: 'import_copy' } };
  expect(importSourceSchema.parse(src)).toEqual(src);
  expect([canImportOnePass(src), canCopy(src)]).toEqual([false, true]);
});
it('refuses queries without map, map without queries, and no entrypoint at all', () => { /* three throws */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/marketplace test -- artifact-manifest`
Expected: FAIL, `canCopy` is not exported.

- [ ] **Step 3: Change the schema and add the two helpers**

No default value on any field, so an old manifest keeps its bytes. Then make the one-pass import honour it: `resolvePlugin` in `packages/bootstrap/src/import-run.ts:185` refuses a plugin for which `canImportOnePass` is false, with "plugin <id> can be copied from but cannot import", so `importers()` no longer lists it. Add that case to `packages/bootstrap/src/import-run.test.ts`.

- [ ] **Step 4: Run the package tests and typecheck**

Run: `pnpm --filter @openldr/marketplace test`, `pnpm --filter @openldr/marketplace typecheck` and `pnpm --filter @openldr/bootstrap test -- import-run`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(marketplace): an import source can name a copy entrypoint"`

---

### Task 2: The copy table and its store

**Files:**
- Create: `packages/db/src/migrations/internal/NNN_import_copy_rows.ts`, `packages/db/src/import-copy-store.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (register `NNN`), `packages/db/src/schema/internal.ts:1076` (add the table beside `plugin_data`), the package index that exports `createPluginDataStore`
- Test: `packages/db/src/import-copy-store.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CopyRow { detail: string; key: string; seq: number; row: Record<string, unknown> }
export interface ImportCopyStore {
  /** Replace every stored row of these keys in this set with `rows`, in one transaction. */
  replaceKeys(copyId: string, setName: string, keys: string[], rows: CopyRow[]): Promise<void>;
  /** Rows of the given keys, ordered by detail, key, seq. */
  read(copyId: string, setName: string, keys: string[]): Promise<CopyRow[]>;
  /** Delete up to `limit` rows of a copy. Returns how many went. 0 means the copy is gone. */
  deleteSome(copyId: string, limit: number): Promise<number>;
}
export function createImportCopyStore(db: Kysely<InternalSchema>): ImportCopyStore;
```

Table `import_copy_rows`: `copy_id text`, `set_name text`, `detail_name text`, `key text`, `seq integer`, `row jsonb`, `read_at timestamptz default now()`, all not null. Primary key `(copy_id, set_name, detail_name, key, seq)`. Use only DDL forms that pg-mem runs, as `113_user_preferences.ts` does.

- [ ] **Step 1: Write the failing tests**, on `makeMigratedDb()` from `migrations/internal/test-helpers`

```ts
it('stores a page and reads it back in order', async () => {
  await store.replaceKeys('c1', 'requests', ['A', 'B'], [
    { detail: 'results', key: 'A', seq: 1, row: { v: 2 } },
    { detail: 'results', key: 'A', seq: 0, row: { v: 1 } },
    { detail: 'requests', key: 'B', seq: 0, row: { v: 3 } },
  ]);
  expect((await store.read('c1', 'requests', ['A', 'B'])).map((r) => [r.detail, r.key, r.seq])).toEqual(
    [['requests', 'B', 0], ['results', 'A', 0], ['results', 'A', 1]]);
});
it('writing a page twice leaves one copy of it', async () => { /* same call twice, read returns 3 rows */ });
it('a second write drops rows the source no longer has', async () => { /* write 2 rows for A, then 1: read returns 1 */ });
it('a key with no rows clears what was stored for it', async () => { /* replaceKeys(..., ['A'], []) then read is [] */ });
it('keeps copies and sets apart', async () => { /* same key under c1/c2 and under two set names */ });
it('deleteSome removes at most the limit and reports 0 when the copy is gone', async () => {
  /* 5 rows: deleteSome('c1', 2) is 2, then 2, then 1, then 0; rows of c2 are untouched */
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @openldr/db test -- import-copy-store`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the migration, the schema type and `createImportCopyStore`**

`replaceKeys` deletes by `(copy_id, set_name, key in keys)` then inserts, in one transaction. Insert in chunks of 1,000 rows. `deleteSome` must not rely on `DELETE ... LIMIT`, which Postgres lacks. Select up to `limit` primary keys in primary key order, then delete those.

- [ ] **Step 4: Run the package tests and typecheck**

Run: `pnpm --filter @openldr/db test` and `pnpm --filter @openldr/db typecheck`
Expected: PASS. The migration test that walks every migration up and down must pass too.

- [ ] **Step 5: Commit**

`git commit -m "feat(db): a table and store for copied source rows"`

---

### Task 3: Retry rules and the page reader

**Files:**
- Create: `packages/bootstrap/src/import-retry.ts`, `packages/bootstrap/src/import-source-reader.ts`
- Test: `packages/bootstrap/src/import-retry.test.ts`, `packages/bootstrap/src/import-source-reader.test.ts`

**Interfaces:**
- Consumes: `ConnectorDb` (`packages/bootstrap/src/connector-db.ts`), `fillKeyQuery`, `fillDetailQuery`, `toPluginRow`, `assertSafeKey` (`import-sql.ts`), `validateSelectSql` (`@openldr/dashboards`), `classifyConnectError` (`connector-diagnose.ts:71`).
- Produces:

```ts
// import-retry.ts
export type SourceErrorKind = 'lost' | 'timeout' | 'refused';
export function classifySourceError(err: unknown): SourceErrorKind;
export function retryWaitMs(attempt: number): number;          // 1 -> 5000, 2 -> 10000, ... capped at 300000
export function shrinkPage(size: number): number;              // max(1, floor(size / 2))
export function growPage(size: number, target: number, goodInRow: number): number;

// import-source-reader.ts
export type PageResult =
  | { kind: 'page'; keys: string[]; rows: Record<string, Array<Record<string, unknown>>>; size: number }
  | { kind: 'end' }
  | { kind: 'stopped' }
  | { kind: 'skipped'; key: string };
export interface SourceReader {
  readPage(input: { keySql: string; details: Array<{ name: string; sql: string }>; after: string | null; size: number }): Promise<PageResult>;
  close(): Promise<void>;
}
export function createSourceReader(deps: {
  /** Opens a connection. The reader passes 5000 for its `SELECT 1` probe and nothing otherwise. */
  open(opts?: { queryTimeoutMs?: number }): Promise<ConnectorDb>;
  /** Called with a state when the reader starts waiting, and with null when it reads again. */
  onWaiting(state: { attempt: number; error: string } | null): Promise<void>;
  stopWanted(): Promise<boolean>;
  /** Makes driver text safe to show: masks the password, caps the length. */
  clean(text: string): string;
  sleep?: (ms: number) => Promise<void>;
}): SourceReader;
```

`classifySourceError` rules, in this order:

1. `timeout` when the error's `code` is `ETIMEOUT` or `ETIMEDOUT`, or its message matches `/timeout|timed out/i`.
2. `refused` when `code` is `ELOGIN`, or `classifyConnectError(message)` is `loginFailed` or `databaseMissing`.
3. `refused` when `code` is `EREQUEST`, except SQL Server error number 1205, a deadlock victim, which is `lost`.
4. `lost` for everything else. An unknown error is retried and shown, because the complaint this work answers is a run that stops and waits for a person.

- [ ] **Step 1: Write the failing rule tests**

```ts
it.each([
  [{ code: 'ETIMEOUT', message: 'Timeout: Request failed to complete in 30000ms' }, 'timeout'],
  [{ code: 'ESOCKET', message: 'Connection lost - read ECONNRESET' }, 'lost'],
  [{ code: 'ELOGIN', message: "Login failed for user 'x'." }, 'refused'],
  [{ code: 'EREQUEST', number: 208, message: "Invalid object name 'dbo.Requests'." }, 'refused'],
  [{ code: 'EREQUEST', number: 1205, message: 'deadlock victim' }, 'lost'],
  [new Error('something nobody has seen'), 'lost'],
])('classifies %j as %s', (err, kind) => expect(classifySourceError(err)).toBe(kind));

it('waits 5 s first and doubles to a ceiling of 300 s', () => {
  expect([1, 2, 3, 4, 5, 6, 7, 8, 40].map(retryWaitMs)).toEqual([5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
});
it('halves a page down to 1', () => { expect([500, 3, 1].map(shrinkPage)).toEqual([250, 1, 1]); });
it('grows back by doubling after 5 good pages, never above the target', () => {
  expect(growPage(100, 500, 4)).toBe(100);
  expect(growPage(100, 500, 5)).toBe(200);
  expect(growPage(400, 500, 5)).toBe(500);
});
```

- [ ] **Step 2: Write the failing reader tests**, with a fake `ConnectorDb` that fails on request and a fake `sleep` that records waits

```ts
it('reads the keys, then every detail query for those keys', ...);       // rows are passed through toPluginRow
it('reports end when the key query returns no keys', ...);
it('a lost connection closes the connection, waits, opens a new one and reads the same page', ...);
  // onWaiting called with { attempt: 1, error } then null; sleep called with 5000; one page returned
it('keeps waiting until stopWanted, then reports stopped', ...);          // lost on every call
it('a refused error is thrown to the caller', ...);                       // message kept through clean()
it('a timed-out page is read again at half the size when the source still answers', ...);   // SELECT 1 passes; sizes asked: 500, 250
it('a timeout with a source that does not answer is a lost connection, and the page size stays', ...);   // SELECT 1 fails; waits; size 500 again
it('an outage never skips a key', ...);                                   // every query times out, SELECT 1 too: no skipped result, only waiting
it('a key that times out 3 times at a page of 1 is reported as skipped', ...);
it('a detail row whose first column is not a key of the page is a refused error', ...);
it('a key query that times out at a page of 1 is retried, not skipped', ...);
it('checks every statement is one SELECT before it runs', ...);           // a bad statement throws and db.query is never called
it('the error handed to onWaiting has been through clean', ...);
```

- [ ] **Step 3: Run both and see them fail**

Run: `pnpm --filter @openldr/bootstrap test -- import-retry import-source-reader`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write both files**

The reader sleeps in slices of at most 1 second and asks `stopWanted` between slices, so a stop is felt within a second. It asks for `after` and `size` on every call and keeps no position of its own.

After any `timeout` the reader runs `SELECT 1` on a fresh connection with a 5-second limit. A failure or no answer makes the error `lost`. An answer keeps it `timeout`, and the page is halved.

`PageResult.rows` stays keyed by detail query name, as the plugin's `map` expects. The reader also checks that the first column of each detail row is one of the page's keys. `createConnectorDb` takes the limit as `queryTimeoutMs` (`connector-db.ts:66`), so `open` is called with the limit the reader wants.

- [ ] **Step 5: Run the tests and typecheck, then commit**

Run: `pnpm --filter @openldr/bootstrap test -- import-retry import-source-reader` and `pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

`git commit -m "feat(import): a page reader that retries a cut link and halves a slow page"`

---

### Task 4: The one-pass import uses the reader

**Files:**
- Modify: `packages/bootstrap/src/import-run.ts` (`ImportStatus`, `ImportRun`, `ImportActor`, `drive`, `view`, `STALE_MS`), `packages/bootstrap/src/activity-service.ts:62` (`importStatus`), `wasm/openldr-v1-import/ui/src/api.ts` (`RunStatus`, `isActive`)
- Test: `packages/bootstrap/src/import-run.test.ts`

**Interfaces:**
- Consumes: `createSourceReader` from Task 3.
- Produces: `ImportStatus` gains `'waiting'`. `ImportRun` gains `waiting: { since: string; attempt: number; error: string } | null` and `origin: 'server' | 'cli'`. `ImportServiceDeps` gains an optional `origin?: 'server' | 'cli'` that defaults to `'cli'`, so existing callers and tests need no change. `ImportActor['type']` gains `'system'`. `STALE_MS` becomes 2 minutes and is exported. A run read from before this change has neither new field. Treat a missing `waiting` as null and a missing `origin` as `'cli'`.

- [ ] **Step 1: Write the failing tests** in the existing harness (`fakeSource` at `import-run.test.ts:33`)

```ts
it('a cut link in the middle of a run shows waiting, then the run completes with no resume', ...);
  // the source throws { code: 'ESOCKET' } once on the second page; final status completed, counts.keys is the full count
it('a run that is waiting can be stopped', ...);
it('a missing table still ends the run as failed', ...);                  // the existing behaviour, now through the reader
it('a key that cannot be read is recorded with SOURCE_TIMEOUT and the run goes on', ...);
it('a waiting run writes its record at least every 30 seconds', ...);     // fake clock; updatedAt moves while waiting
it('records where the run was started', ...);                             // origin from deps
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @openldr/bootstrap test -- import-run`
Expected: the new tests FAIL. The existing ones still pass.

- [ ] **Step 3: Change `drive` to read pages through the reader**

`drive` keeps its loop, its per-key save and its counts. The two `db.query` blocks at `import-run.ts:282` to `:294` become one `reader.readPage` call. `onWaiting` sets `run.status` to `waiting` or back to `running`, fills `run.waiting`, and saves. A timer saves the run every 30 seconds for as long as `drive` runs, and is cleared in `finally`. `stopWanted` already exists at `:250`. In `view`, `waiting` counts as active beside `running` and `stopping`. Activity shows `waiting` as running.

- [ ] **Step 4: Run the package tests and typecheck, then commit**

Run: `pnpm --filter @openldr/bootstrap test` and `pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

`git commit -m "feat(import): an import waits out a cut link and carries on"`

---

### Task 5: The copy service

**Files:**
- Create: `packages/bootstrap/src/import-copy.ts`
- Test: `packages/bootstrap/src/import-copy.test.ts`

**Interfaces:**
- Consumes: `ImportCopyStore` (Task 2), `createSourceReader` (Task 3), `canCopy` (Task 1), `ImportActor`, `ImportAuditEvent` and `HOST_COLLECTION_PREFIX` from `import-run.ts`, the allow list that `ImportService.allowed` reads.
- Produces:

```ts
export type CopyStatus = 'queued' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'deleting';
export interface CopySetProgress { cursor: string | null; keys: number; rows: number; bytes: number; skipped: number; done: boolean }
export interface CopyRun {
  id: string; kind: 'copy';
  pluginId: string; pluginVersion: string;
  connectorId: string;
  status: CopyStatus;
  options: Record<string, string>;
  pageSize: number;
  sets: Record<string, CopySetProgress>;         // in the order the plugin named them
  setSql: Record<string, string>;                // set name -> SHA-256 of its key and detail SQL
  waiting: { since: string; attempt: number; error: string } | null;
  driver: string | null;                         // id of the process driving it
  startedAt: string; updatedAt: string; finishedAt: string | null;
  lastError: string | null; startedBy: string;
}
export function copyIdOf(pluginId: string, connectorId: string): string;
/** Thrown by start when a set's SQL differs from the stored one and `reread` was not given. */
export class CopySetChangedError extends Error { readonly sets: string[] }
export interface ImportCopyService {
  /** Plugins that can be copied from, with the connector types each reads. */
  copiers(): Promise<Array<{ id: string; version: string; connectorTypes: string[] }>>;
  start(input: { pluginId: string; connectorId: string; options: Record<string, string>; pageSize?: number; reread?: boolean; actor: ImportActor }): Promise<CopyRun>;
  get(pluginId: string, copyId: string): Promise<CopyRun | null>;
  list(pluginId: string): Promise<CopyRun[]>;
  stop(pluginId: string, copyId: string, actor: ImportActor): Promise<CopyRun>;
  remove(pluginId: string, copyId: string, actor: ImportActor): Promise<CopyRun>;
  /** Server only. Take every run that has no driver and drive it. Returns when nothing is left to take. */
  tick(): Promise<void>;
  /** Resolves when this process is driving nothing. For tests and for shutdown. */
  idle(): Promise<void>;
}
export function createImportCopyService(deps: ImportCopyServiceDeps): ImportCopyService;
```

`ImportCopyServiceDeps` has the same `plugins`, `connectors`, `secretsKey`, `pluginData`, `audit`, `createDb`, `now` as `ImportServiceDeps` (`import-run.ts:73`), plus `store: ImportCopyStore`, `allowed(pluginId: string): Promise<string[]>`, `driverId: string` and `sleep?`.

Decisions:

- Runs live in the `plugin_data` collection `__import-copies`, keyed by copy id. Skipped keys live in `__import-copy-skipped`, keyed `<copyId>:<setName>:<key>`, holding the set name and the key.
- `copyIdOf` is the first 32 hex characters of the SHA-256 of `<pluginId>|<connectorId>`. One copy per plugin and connector.
- `start` calls the plugin's copy entrypoint with the options and hashes each set's SQL. Then:
  - No copy yet: create it as `queued` with those hashes.
  - A set's hash differs from the stored one, or a stored set is no longer named: without `reread`, throw `CopySetChangedError` naming the sets and change nothing. With `reread`, store the new options and hashes, mark each changed set for emptying and set `queued`. The driver empties a marked set with batched deletes before it reads it again. A set that is no longer named is emptied and dropped from `sets`.
  - Nothing differs and the copy is `stopped`, `failed` or `completed`: set `queued`. A completed copy then only reads its skipped keys again, until top-up exists.
  - Nothing differs and the copy is `queued`, `running` or `waiting`: return it as it is.
  - The copy is `deleting`: refuse.
- `start` checks, before it writes anything: the plugin holds `host:import` and `canCopy` is true, the connector is enabled, of a declared type, and allowed for the plugin.
- A set marked for emptying is a field on its progress, `empty: true`. Add it to `CopySetProgress` as optional.
- A `skipped` page result writes the key to the skipped collection. When every set is done, the driver reads each skipped key once more at a page of one. A key that is read is removed from the collection and its set's `skipped` count falls. The copy is then `completed` whatever is left.
- `remove` refuses unless the status is `stopped`, `completed` or `failed`. It sets `deleting`.
- `start` and `remove` write their audit row first and refuse when it cannot be written, as `auditOrRefuse` does (`import-run.ts:177`).
- Audit actions: `import.copy.start`, `import.copy.stop`, `import.copy.takeover`, `import.copy.finish`, `import.copy.delete`. Add them to `ImportAuditEvent['action']`. Metadata holds counts and ids, never a row value or a key.
- `tick` takes a run when its status is `queued`, or when its status is `running`, `waiting`, `stopping` or `deleting`, its `driver` is not this process, and its `updatedAt` is older than 2 minutes. Taking means writing `driver` and saving. A takeover of a run that had another driver is audited as `import.copy.takeover` with the actor `{ type: 'system', id: null, name: 'system' }`.
- Driving a copy: call the plugin's copy entrypoint, check every statement, then for each set that is not done read pages with one reader. For each page call `store.replaceKeys`, then add to the set's counts, set its cursor and save the run. `bytes` is the UTF-8 length of each row's JSON. A `skipped` result adds to `skipped` and moves the cursor past the key. A set with no detail queries stores the key query's own rows under the set's name. `end` marks the set done. When every set is done the status is `completed`.
- A refused source error, a plugin error or an error from CE's own database ends the run as `failed`, with `lastError` cleaned as today (`import-run.ts:329`).
- Driving a delete: `store.deleteSome(id, 10000)` until it returns 0, saving the run between batches, then delete the run record.
- A timer saves the run every 30 seconds while this process drives it.

- [ ] **Step 1: Write the failing tests**, in the style of `import-run.test.ts`: real `plugin_data` and copy stores on pg-mem, a fake plugin, a fake source

```ts
it('copies every key of a set, in pages, and reports rows and bytes', ...);
it('copies a set with no detail queries from the key query rows', ...);
it('copies two sets one after the other, each with its own position', ...);
it('files each detail row under the key in its first column, in the order it came', ...);
it('a cut link in the middle of a page keeps no half page and stores no row twice', ...);     // review focus 1
it('shows waiting with a cleaned error while the source is away', ...);
it('carries on from the saved position when a new process takes the run', ...);
it('start asked twice gives one run', ...);                                                    // review focus 3
it('start with an option that changes a set is refused and names the set', ...);              // CopySetChangedError, nothing changed
it('start with reread empties the changed set and reads it again, and leaves the other set alone', ...);
it('start with an option that changes no SQL changes nothing in the copy', ...);
it('a plugin upgrade that changes a set is treated the same way as a changed option', ...);
it('a skipped key is listed, read again at the end of the pass, and read again at the next start', ...);
it('a copy with a skipped key left is completed with skipped above 0', ...);
it('copiers lists a copy-only plugin, and importers does not', ...);
it('start is refused for a connector the plugin is not allowed to read', ...);
it('start is refused when the audit row cannot be written', ...);
it('stop ends the run as stopped at the next page, and start carries it on', ...);
it('remove is refused while the copy is running', ...);                                        // review focus 4
it('remove deletes every row in batches, then the run record', ...);
it('a write error from CE ends the run as failed, with no retry', ...);                        // review focus 5
it('a missing table at the source ends the run as failed', ...);
it('does not take a run whose driver wrote less than 2 minutes ago', ...);
it('takes a run whose driver has been silent for 2 minutes, and audits the takeover', ...);
it('no audit row and no error text holds a key or a row value', ...);
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @openldr/bootstrap test -- import-copy`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `import-copy.ts`**

- [ ] **Step 4: Run the package tests and typecheck, then commit**

Run: `pnpm --filter @openldr/bootstrap test` and `pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

`git commit -m "feat(import): copy the rows of a source to CE, set by set"`

---

### Task 6: The server drives, and carries on after a restart

**Files:**
- Create: `packages/bootstrap/src/import-driver.ts`
- Modify: `packages/bootstrap/src/index.ts` (`AppContextOptions` near `:632`, the `imports` wiring at `:1734`, `AppContext` at `:543`, shutdown near `:1893`), `packages/bootstrap/src/import-run.ts` (add `adopt`), `apps/server/src/start.ts:52`
- Test: `packages/bootstrap/src/import-driver.test.ts`, `packages/bootstrap/src/import-run.test.ts`

**Interfaces:**
- Consumes: `ImportCopyService.tick` and `idle` (Task 5), `ImportService`, `STALE_MS` (Task 4).
- Produces:

```ts
// import-run.ts
interface ImportService {
  /** Server only. Resume every run this server started that has had no write for 2 minutes. */
  adopt(): Promise<ImportRun[]>;
}
// import-driver.ts
export function startImportDriver(deps: {
  copies: Pick<ImportCopyService, 'tick' | 'idle'>;
  imports: Pick<ImportService, 'adopt'>;
  intervalMs?: number;                 // default 5000
  onError?: (err: unknown) => void;
}): { stop(): Promise<void> };
// index.ts
interface AppContextOptions { runImportDriver?: boolean }
interface AppContext { importCopies: ImportCopyService }
```

Decisions:

- Only the API server passes `runImportDriver: true`, beside the two worker options at `start.ts:52`. A CLI process never drives. This is the rule the facility workers already follow (`index.ts:632`).
- The server builds its services with `origin: 'server'` and a random `driverId`. Every other process uses `origin: 'cli'`.
- `adopt` resumes a run whose `origin` is `server`, whose status is `running`, `waiting` or `stopping`, that this process is not driving, and whose `updatedAt` is older than 2 minutes. It calls the existing `resume` with the system actor.
- One loop turn calls `imports.adopt()` then `copies.tick()`. A turn never overlaps the one before. An error in a turn goes to `onError` and the loop goes on.
- `stop` ends the loop and waits for `copies.idle()`, so a shutting-down server leaves a clean saved position.

- [ ] **Step 1: Write the failing tests**

```ts
it('adopt resumes a server run that has been silent for 2 minutes', ...);
it('adopt leaves a run that a CLI process started', ...);
it('adopt leaves a run that wrote 1 minute ago', ...);
it('a run adopted after a restart finishes from its saved position, audited as system', ...);   // review focus 2
it('the driver calls adopt then tick, and never starts a turn while one runs', ...);
it('an error in one turn does not end the loop', ...);
it('stop waits for the copy in hand to save', ...);
it('a context built without runImportDriver never calls tick', ...);                            // review focus 2
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @openldr/bootstrap test -- import-driver import-run`
Expected: the new tests FAIL.

- [ ] **Step 3: Write the driver, `adopt`, and the wiring**

- [ ] **Step 4: Run the tests, the typecheck and the server lint, then commit**

Run: `pnpm --filter @openldr/bootstrap test`, `pnpm --filter @openldr/bootstrap typecheck`, `pnpm --filter @openldr/server typecheck`, `pnpm --filter @openldr/server lint`
Expected: PASS.

`git commit -m "feat(import): the server picks up imports and copies that lost their driver"`

---

### Task 7: The v1 plugin names what to copy

**Files:**
- Modify: `wasm/openldr-v1-import/src/queries.rs`, `wasm/openldr-v1-import/src/lib.rs`, `scripts/build-v1-import-plugin.mjs` (`ENTRYPOINTS` and `importSource.entrypoints`)
- Test: `wasm/openldr-v1-import/src/queries.rs` (unit tests), `packages/plugins/src/v1-import.integration.test.ts`

**Interfaces:**
- Produces: the wasm entrypoint `import_copy`. Input `{ options }`. Output `{ "sets": [ { "name": "requests", "keyQuery": { "sql": ... }, "detailQueries": [ ... ] } ] }`. The key query and the four detail queries are the ones `queries()` returns (`queries.rs:160`), unchanged. Each detail query already selects `[RequestID]` first, which the copy relies on.

- [ ] **Step 1: Write the failing Rust tests**

```rust
#[test]
fn copy_is_one_set_with_the_import_queries() {
    let o = opts(json!({ "tz": "Z" })).unwrap();
    let c = copy(&o);
    let sets = c["sets"].as_array().unwrap();
    assert_eq!(sets.len(), 1);
    assert_eq!(sets[0]["name"], "requests");
    assert_eq!(sets[0]["keyQuery"], queries(&o)["keyQuery"]);
    assert_eq!(sets[0]["detailQueries"], queries(&o)["detailQueries"]);
}
#[test]
fn copy_takes_the_same_options_and_refuses_the_same_bad_ones() { /* database, from, to, panels; unknown option is an error */ }
```

- [ ] **Step 2: Run and see them fail**

Run: `cd wasm && cargo test -p openldr-v1-import`
Expected: FAIL, `copy` not found.

- [ ] **Step 3: Add `queries::copy`, `import_copy` in `lib.rs` with its `#[plugin_fn]`, and the build script entries**

- [ ] **Step 4: Extend the integration test**: the built wasm answers `import_copy`, and the answer passes the copy service's own checks

Run: `cd wasm && cargo test -p openldr-v1-import`, then `pnpm build:v1-import`, then `pnpm --filter @openldr/plugins test -- v1-import`
Expected: PASS. `pnpm build:v1-import` needs Rust and the `wasm32-wasip1` target.

- [ ] **Step 5: Commit**

`git commit -m "feat(v1-import): the plugin names the rows to copy"`

---

### Task 8: Copy operations for a plugin page, and Activity

**Files:**
- Modify: `packages/bootstrap/src/plugin-broker.ts` (the op union at `:52`, the zod list at `:110`, the two capability switches at `:132` and `:170`, the handler at `:363`), `packages/plugin-ui-sdk/src/types.ts:84`, `bootstrap.ts:97`, `mock.ts:53`, `packages/bootstrap/src/activity-service.ts`, `packages/bootstrap/src/index.ts:936` (the Activity wiring)
- Test: `packages/bootstrap/src/plugin-broker.test.ts`, `packages/plugin-ui-sdk/src/bootstrap.test.ts`, `mock.test.ts`, `packages/bootstrap/src/activity-service.test.ts`

**Interfaces:**
- Consumes: `ImportCopyService` (Task 5).
- Produces: broker ops, all needing `host:import` as the import ops do:

```ts
| { kind: 'import.copy.start'; connectorId: string; options: Record<string, string>; pageSize?: number; reread?: boolean }
| { kind: 'import.copy.list' }
| { kind: 'import.copy.status'; copyId: string }
| { kind: 'import.copy.stop'; copyId: string }
| { kind: 'import.copy.delete'; copyId: string; confirm: true }
```

and on the page SDK: `openldr.imports.copy.start(input)`, `.list()`, `.status(copyId)`, `.stop(copyId)`, `.remove(copyId)`. `remove` sends `confirm: true`.

Activity lists a copy as one lifecycle. Its first stage reads `copy: <plugin id> <version>, started by <name>`. Its detail reads `<rows> rows copied, <skipped> keys skipped`. `completed` shows as complete, `failed` as failed, `stopped` as stopped, every other status as running.

- [ ] **Step 1: Write the failing tests**

```ts
it('import.copy.start passes the caller as the actor and the calling plugin as the plugin', ...);
it('a plugin without host:import is denied every copy op', ...);
it('import.copy.delete without confirm: true is refused by the schema', ...);
it('a changed set comes back as an error that names the sets, so the page can ask', ...);     // { ok: false, error, data: { changedSets } }
it('a plugin can only see and stop its own copies', ...);
it('the SDK sends each copy call as its op', ...);
it('Activity lists a copy run with its rows and its state', ...);
```

- [ ] **Step 2: Run, see them fail, implement, run again**

Run: `pnpm --filter @openldr/bootstrap test -- plugin-broker activity-service` and `pnpm --filter @openldr/plugin-ui-sdk test`
Expected: FAIL first, PASS after.

- [ ] **Step 3: Commit**

`git commit -m "feat(import): a plugin page can start, watch, stop and delete a copy"`

---

### Task 9: CLI

**Files:**
- Create: `packages/cli/src/import-copy.ts`
- Modify: `packages/cli/src/program.ts:135` (the `import` group), `packages/cli/src/command-meta.ts` (added by design C), `docs/CLI-REFERENCE.md`
- Test: `packages/cli/src/import-copy.test.ts`

**Interfaces:**
- Consumes: `ctx.importCopies` (Task 6), `cliActor` (`packages/cli/src/cli-actor.ts`).
- Produces these commands:

```
openldr import copy start --plugin <id> --connector <id> [--option name=value]... [--page-size <n>] [--reread] [--follow] [--json]
openldr import copy status <plugin> [copy] [--json]
openldr import copy stop <plugin> <copy>
openldr import copy delete <plugin> <copy> --force
```

Decisions:

- When a set's SQL changed, `start` prints `these sets would be read again from the start: <names>. Run again with --reread to do that.` and exits 1 with nothing changed.
- `start` records the request and returns. It does not drive. With `--follow` it reads the run every 2 seconds and prints a line when the counts change, until the status is `completed`, `stopped` or `failed`. Ctrl+C during `--follow` ends the following only. The copy goes on.
- When no server is running, `start` still records the request and says so: `recorded. The copy starts when the OpenLDR server is running.`
- `delete` without `--force` refuses and changes nothing.
- Exit code 0 when the request was recorded. With `--follow`, 0 only for `completed` with no skipped key.
- One line per copy: the id, the status, then per set `name keys=N rows=N bytes=N skipped=N`, then the cleaned error when waiting or failed. Never a key.
- In `command-meta.ts`, give each new command the same way of running and the same capability as `import start` has there.

- [ ] **Step 1: Write the failing tests**

```ts
it('start without --reread on a changed set exits 1, names the sets and changes nothing', ...);
it('start with --reread passes reread: true', ...);
it('formats a copy on one line with no key in it', ...);
it('delete without --force refuses and calls nothing', ...);
it('follow ends when the copy completes, with exit code 0', ...);
it('follow ends with exit code 1 when a key was skipped', ...);
it('every import copy command has a row in command-meta', ...);
```

- [ ] **Step 2: Run, see them fail, implement, run again**

Run: `pnpm --filter @openldr/cli test`
Expected: the new tests FAIL first. After, every CLI test passes, with no change to what the existing ones assert.

- [ ] **Step 3: Add the four commands to `docs/CLI-REFERENCE.md`, then commit**

`git commit -m "feat(cli): openldr import copy start, status, stop and delete"`

---

### Task 10: The Copy tab on the v1 importer page

**Files:**
- Create: `wasm/openldr-v1-import/ui/src/CopyPanel.tsx`, `wasm/openldr-v1-import/ui/src/CopyPanel.test.tsx`
- Modify: `wasm/openldr-v1-import/ui/src/App.tsx`, `api.ts`, `i18n.ts`, `styles.css`, `App.test.tsx`

**Interfaces:**
- Consumes: `openldr.imports.copy.*` (Task 8), the connector picker and the options form the Import steps already use (`steps.tsx`, `options.ts`).

The page gets two tabs. `Import` is the wizard that exists. `Copy` is new:

```
[ Import ]  [ Copy ]
---------------------------------------------------------------
Source      [ v1 database (connector) v ]        [ Check connection ]
Time zone   [ +02:00 ]      Database [        ]
From [          ]  To [          ]  Panels [                 ]
                                                    [ Start copy ]
---------------------------------------------------------------
Copying. 1,240,500 of an unknown number of requests.        [ ... ]
Set        Requests read   Rows        Size       State
requests   1,240,500       6,902,113   3.4 GB     copying
Waiting for the source. Tried 4 times. Next try in 40 s.
Last error: Connection lost - read ECONNRESET
```

Decisions:

- The dots menu holds Stop and Delete copy. Delete opens a confirm step where the person types the plugin id. This is a confirm step, which is what a dialog is for.
- While a copy is active, the form is read-only and shows the options the copy was started with. Once it is stopped, failed or completed the form can be edited and Start copy sends it again.
- When Start copy comes back with changed sets, the page shows a confirm step that names them: "These will be read again from the start: requests". Only a yes sends `reread: true`.
- The panel reads the copy every 2 seconds while its status is `queued`, `running`, `waiting`, `stopping` or `deleting`.
- A `skipped` count above 0 shows as a warning line under the table.
- Sizes use binary units with one decimal place. Numbers use the page's locale.
- Every string is in en, fr and pt.
- At 375 by 812 the set table scrolls inside its own box and the page does not scroll sideways.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows the Copy tab and starts a copy with the chosen connector and options', ...);
it('lists each set with its requests, rows, size and state', ...);
it('shows the waiting line with the try count and the last error', ...);
it('Stop calls stop; Delete is disabled while the copy is active', ...);
it('Delete asks for the plugin id and calls remove only when it matches', ...);
it('shows the stored options read-only while a copy is active', ...);
it('asks before reading a changed set again, and sends reread only on yes', ...);
it('warns when keys were skipped', ...);
```

- [ ] **Step 2: Run, see them fail, implement, run again**

Run: `pnpm --filter ./wasm/openldr-v1-import/ui test` (or the script name in that folder's `package.json`)
Expected: FAIL first, PASS after, including `i18n.test.ts`.

- [ ] **Step 3: Build the plugin and look at the page**

Run: `pnpm build:v1-import`. Install the staged plugin into a scratch CE on port 3990 with `OPENLDR_SKIP_ENV_FILE=true` and a `sa_scratch_*` database. Open the page at desktop width and at 375 by 812. Check for console errors.
Expected: both tabs render, and the Copy tab does not scroll sideways on the phone size. Say in the report that a real phone was not used.

- [ ] **Step 4: Commit**

`git commit -m "feat(v1-import): a Copy tab on the plugin page"`

---

### Task 11: Docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/v1-import.md`, `fr/v1-import.md`, `pt/v1-import.md`, and the same three under `apps/web/src/docs/0.1.8/`
- Test: the docs tests in both apps (`apps/studio/src/docs/*.test.ts`, `apps/web/src/docs/*.test.ts`)

The in-app guide follows `apps/studio/src/docs/HOW-TO-TEMPLATE.md`. Add one section, "Copy the source first", with these steps: open the Copy tab, choose the source and options, start the copy, read the set table, what Waiting means, stop and start again, delete a copy. Add the four CLI commands to the guide's CLI section. Add to Troubleshooting: "The copy says Waiting" and "A key was skipped".

State plainly in the guide: after this release a copy can be made and kept, and nothing reads it yet. The import still reads the source itself.

- [ ] **Step 1: Write the section in en, then fr and pt**
- [ ] **Step 2: Capture the screenshots the guide names**, from the scratch CE of Task 10, with the fictional fixture only
- [ ] **Step 3: Run the docs tests in both apps**

Run: `pnpm --filter @openldr/studio test -- docs` and `pnpm --filter @openldr/web test -- docs`
Expected: PASS.

- [ ] **Step 4: Commit**

`git commit -m "docs: how to copy a v1 source first"`

---

### Task 12: A real run, before the final review

Unit tests here use a fake source and pg-mem. This task is the only one that meets a real SQL Server, a real cut link and a real restart. Run it before the final review, and give it every item a review marked "proven by reading only".

**Setup:** a scratch CE on port 3990 with `OPENLDR_SKIP_ENV_FILE=true` and two `sa_scratch_*` Postgres databases. A SQL Server 2017 container, the oldest version with a Linux image, on a spare port. Load `apps/web/public/docs-samples/user-guide/v1-import/example-source.sql`, then add enough fictional requests to make a copy last several minutes. Write that generator as a throwaway script in a temp folder.

- [ ] **Step 1: Full copy.** Start a copy from the CLI with `--follow`. Expected: `completed`, and the row count in `import_copy_rows` equals the source's row count for each table.
- [ ] **Step 2: Cut link.** Start again on a fresh copy. Pause the container for 90 seconds in the middle, then resume it. Expected: the copy shows `waiting`, then completes with no command from a person. Row counts match. Write down the exact error object the driver threw, and correct `classifySourceError` and its test if a real cut is not classified as `lost` or `timeout`.
- [ ] **Step 3: Server down.** Stop the container fully for 2 minutes, then start it. Expected: the same.
- [ ] **Step 4: Restart.** Kill the CE server with `kill -9` in the middle of a copy. Start it again. Expected: within 3 minutes the copy carries on from its saved position and completes. The audit log has one `import.copy.takeover` row by `system`.
- [ ] **Step 5: Two processes.** While the server drives a copy, run `openldr import copy status` in a loop from a second terminal. Expected: the run's `driver` never changes.
- [ ] **Step 6: Slow page.** Throttle the container's network with `tc` until a page of 500 passes 30 seconds. Expected: the page size falls, the copy goes on, and no key is skipped that a page of one could read.
- [ ] **Step 7: Delete.** Delete a completed copy, and kill the server in the middle of the delete. Expected: after the restart the delete finishes and `import_copy_rows` has no row for that copy.
- [ ] **Step 8: Bad statement.** Rename a source table and start a copy. Expected: `failed` at once, with the table named and no retry.
- [ ] **Step 9: One-pass import.** Run `openldr import start` and pause the container in the middle. Expected: it waits and completes, with no `resume`.
- [ ] **Step 10: Search the server log and the audit table** for a request id and a patient name from the fixture. Expected: neither appears.
- [ ] **Step 11: Write the figures in the report**: rows per second, bytes per request, and the five slowest tests in the gate.
- [ ] **Step 12: Remove** the containers, the scratch databases and the temp folder.

HONEST NON-PROOF to carry into the report: SQL Server 2014 has no Linux image, so 2014 itself is not tested here. A real 2014 server at a site is the only proof.

---

### Task 13: Gate and changelog

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo run test --force --concurrency=2 --continue`, then `pnpm turbo run typecheck --force --concurrency=2`, then `pnpm depcruise`. Redirect each to a file and read the exit code from the command, never through a pipe.
Expected: all pass. For a failure, search the output for `Test timed out`, `out of memory` and `VirtualAlloc` before reading it as a regression, and re-run that package alone.

- [ ] **Step 2: After the merge to `main`, run `pnpm make:changelog`** and commit `apps/web/src/landing/changelog.json`.

---

## Not in this plan, and what unblocks each

- **Top-up passes** (spec 9.4). Blocked on two facts about each source: whether `DATESTAMP` is a row version, and the largest size of a binary column. One read-only query against a DISA copy and a v1 copy gives both. Until then a copy is one full pass.
- **The DISA plugin's copy entrypoint.** It lives in its own repository, which has no name yet (spec section 11, question 1). It needs no change in this repo beyond what this plan builds.
- **Reading the copy.** Checking, saving from the copy, the held-back view and the workflows switch are part 4.
