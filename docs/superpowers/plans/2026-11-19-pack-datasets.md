# Pack-defined datasets implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A report pack can ship datasets, each a name and one SELECT, that CE stores as real warehouse tables and rebuilds after the warehouse changes, so slow reports read a pre-built table.

**Architecture:** A new content-pack step kind `datasets` carries the definitions. Installing a pack saves them in a new internal table and builds each as `dataset.<name>` in the warehouse with a build-then-swap. A refresher rebuilds a dataset when the warehouse has changed since its last build and the projection has caught up. The Query page lists them under Datasets, and `openldr db datasets` gives the same from the CLI.

**Tech Stack:** TypeScript, Kysely on PostgreSQL, zod, vitest (pg-mem for unit tests, real PostgreSQL for `.live.test.ts`), Fastify, React with shadcn components, commander.

**Spec:** `docs/superpowers/specs/2026-11-19-pack-summary-tables-design.md`

## Global Constraints

- PostgreSQL warehouses only. On `mssql` or `mysql` the step is refused at install with: `datasets need a PostgreSQL warehouse`.
- A dataset name matches `^[a-z][a-z0-9_]{2,47}$`. CE creates it as `dataset.<name>`. The schema is `dataset`.
- A dataset's SQL passes `validateSelectSql(sql, 'postgres')` from `packages/dashboards/src/sql-runner.ts:20`.
- A CE without the `datasets` kind refuses the pack as `this pack needs a newer CE`. `parseContentPack` already does this for an unknown kind.
- Internal migration number: `131`. Checked free on `main` and every unmerged branch on 2026-11-19.
- pg-mem cannot run `create table as`, `create schema` with a swap, or `alter table ... rename`. Anything that builds a table is proved in a `.live.test.ts` against `FHIR_SAVE_TEST_DATABASE_URL`, as `packages/db/src/relational-writer.live.test.ts` does.
- UI follows AGENTS.md section 5: actions in a `MoreHorizontal` dropdown, sheets not dialogs, `StripedEmpty` and `LoadingState`, shadcn only.
- Every user text exists in `apps/studio/src/i18n/en.ts`, `fr.ts` and `pt.ts`.
- Destructive CLI commands refuse without `--force` and audit as `actorName: 'cli'`.
- No em dashes, no emoji, in code comments, docs and commit messages.

## Review Focus

- A build that fails half way (the SELECT errors, or an index names a missing column): the old table must still be there and readable, and the error recorded.
- Two builds of the same dataset started at once (install and the refresher): one must wait or skip, never both writing `__new`.
- A dataset whose SELECT reads another dataset that is not built yet: the build order must follow the pack's list.
- A pack that names a dataset another pack owns: refused at check, before anything is written.
- A report run while a dataset is missing: the user sees `This report's dataset is still being built.`, not a raw PostgreSQL error.

---

### Task 1: The `datasets` step kind

**Files:**
- Modify: `packages/marketplace/src/content-pack.ts`
- Test: `packages/marketplace/src/content-pack.test.ts`

**Interfaces:**
- Produces: step `{ kind: 'datasets', tables: Array<{ name: string; sql: string; indexes?: string[][] }> }` in `ContentPackStep`. `summarizeContentPack` returns `{ kind: 'datasets', label: <names joined by ', '>, count: <tables.length> }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('parses_a_datasets_step', () => {
  const pack = parseContentPack({ formatVersion: 1, steps: [{ kind: 'datasets', tables: [{ name: 'zm_request_times', sql: 'select 1 as a', indexes: [['a']] }] }] });
  expect(pack.steps[0]).toEqual({ kind: 'datasets', tables: [{ name: 'zm_request_times', sql: 'select 1 as a', indexes: [['a']] }] });
});
it('refuses_a_dataset_name_that_is_not_a_plain_lower_case_name', () => {
  for (const name of ['Ab_c', 'ab', 'a-b-c', '1abc', 'public.x', 'a'.repeat(49)]) {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'datasets', tables: [{ name, sql: 'select 1' }] }] })).toThrow(/invalid pack/);
  }
});
it('refuses_two_datasets_with_one_name_in_a_step', () => {
  expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'datasets', tables: [{ name: 'abc', sql: 'select 1' }, { name: 'abc', sql: 'select 2' }] }] })).toThrow(/invalid pack/);
});
it('summarizes_a_datasets_step_by_its_names', () => {
  const pack = parseContentPack({ formatVersion: 1, steps: [{ kind: 'datasets', tables: [{ name: 'abc', sql: 'select 1' }, { name: 'abd', sql: 'select 2' }] }] });
  expect(summarizeContentPack(pack)).toEqual([{ kind: 'datasets', label: 'abc, abd', count: 2 }]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd packages/marketplace && npx vitest run src/content-pack.test.ts`
Expected: FAIL, `this pack needs a newer CE`.

- [ ] **Step 3: Add `'datasets'` to `KINDS`, the zod object to `stepSchema` (name regex, `sql` min 1, `indexes` optional array of non-empty string arrays, at least one table, unique names via `superRefine`), and the `summarizeContentPack` case**

- [ ] **Step 4: Run the tests and see them pass**

- [ ] **Step 5: Commit**

`feat(marketplace): a content pack can carry datasets`

---

### Task 2: Where the definitions live

**Files:**
- Create: `packages/db/src/migrations/internal/131_warehouse_datasets.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`
- Create: `packages/db/src/warehouse-dataset-store.ts`, export from `packages/db/src/index.ts`
- Test: `packages/db/src/warehouse-dataset-store.test.ts`

**Interfaces:**
- Produces:

```ts
export interface WarehouseDataset {
  name: string; ownerPack: string; sql: string; indexes: string[][]; position: number;
  builtAtSeq: number | null; builtAt: string | null; buildMs: number | null; rowCount: number | null; lastError: string | null;
}
export interface WarehouseDatasetStore {
  list(): Promise<WarehouseDataset[]>;                       // ordered by owner_pack, position
  get(name: string): Promise<WarehouseDataset | undefined>;
  /** Replaces every definition `ownerPack` owns with `defs`, in order. Throws `dataset <name> belongs to <pack>` when another pack owns a name. */
  replaceForPack(ownerPack: string, defs: Array<{ name: string; sql: string; indexes?: string[][] }>): Promise<void>;
  markBuilt(name: string, r: { seq: number; ms: number; rows: number }): Promise<void>;   // clears last_error
  markFailed(name: string, error: string): Promise<void>;                                  // keeps built_* as they were
  remove(name: string): Promise<void>;
}
export function createWarehouseDatasetStore(db: Kysely<InternalSchema>): WarehouseDatasetStore;
```

- `ownerPack` is the pack id without its version (`reports-zm`), so a new version of the same pack replaces its own definitions.
- Table `warehouse_datasets`: `name text primary key`, `owner_pack text not null`, `sql text not null`, `indexes jsonb not null default '[]'`, `position int not null`, `built_at_seq bigint`, `built_at timestamptz`, `build_ms int`, `row_count bigint`, `last_error text`, `created_at`, `updated_at`.

- [ ] **Step 1: Write the failing tests**: `replaceForPack` saves in order and `list` returns them in order; a second call with fewer defs removes the dropped ones and keeps `built_*` of a def whose `sql` and `indexes` did not change, and clears `built_*` of one whose `sql` changed; a name owned by another pack throws and writes nothing; `markBuilt` then `markFailed` keeps the built values and sets the error; `markBuilt` clears the error.
- [ ] **Step 2: Run and see them fail** (`cd packages/db && npx vitest run src/warehouse-dataset-store.test.ts`)
- [ ] **Step 3: Write the migration (with `down`), the schema type, and the store**
- [ ] **Step 4: Run the tests, and `npx vitest run src/migrations` for the registration test**
- [ ] **Step 5: Commit** `feat(db): where pack datasets are recorded (migration 131)`

---

### Task 3: Building one dataset in the warehouse

**Files:**
- Create: `packages/db/src/warehouse-dataset-build.ts`, export from `packages/db/src/index.ts`
- Test: `packages/db/src/warehouse-dataset-build.live.test.ts`

**Interfaces:**
- Produces:

```ts
/** Builds `dataset.<name>` from `sql`: fills `dataset.<name>__new`, adds the indexes, analyzes it, then in one
 *  transaction drops the old table and renames the new one. Resolves to the row count. On any error the old
 *  table is untouched and `__new` is dropped. Holds a session advisory lock on the name for the whole build;
 *  a second build of the same name waits for it. */
export async function buildWarehouseDataset(db: Kysely<any>, def: { name: string; sql: string; indexes?: string[][] }): Promise<{ rows: number }>;
export async function dropWarehouseDataset(db: Kysely<any>, name: string): Promise<void>;
export const DATASET_SCHEMA = 'dataset';
```

- The name is checked against `^[a-z][a-z0-9_]{2,47}$` again here and quoted with `sql.id`. Index columns are quoted with `sql.id`. The SELECT is passed with `sql.raw` after the caller validated it. Index names: `<name>_<n>_idx`, renamed with the table.
- One connection for the whole build (`db.connection().execute`), because the advisory lock is per session.

- [ ] **Step 1: Write the failing live tests** (skipped without `FHIR_SAVE_TEST_DATABASE_URL`, scratch database per file as in `relational-writer.live.test.ts`):
  - `builds_a_table_with_the_selects_rows_and_its_indexes`: seed `patients` with 3 rows, build `{ name: 'abc', sql: 'select id, surname from patients', indexes: [['surname']] }`, expect `rows` 3, `select count(*) from dataset.abc` 3, and one index on `surname` in `pg_indexes`.
  - `a_rebuild_replaces_the_rows`: add a fourth patient, build again, expect 4, and no `abc__new` left.
  - `a_failed_build_keeps_the_old_table`: build with `sql: 'select id from no_such_table'`, expect it to reject, `dataset.abc` still has 4 rows, no `abc__new`.
  - `an_index_on_a_missing_column_fails_and_keeps_the_old_table`.
  - `two_builds_at_once_both_finish_and_leave_one_table`: `Promise.all` of two builds, both resolve, one table.
  - `a_dataset_can_read_a_dataset_built_before_it`.
  - `refuses_a_name_that_is_not_plain`: `buildWarehouseDataset(db, { name: 'x; drop', sql: 'select 1' })` rejects before running anything.
- [ ] **Step 2: Run and see them fail** (`FHIR_SAVE_TEST_DATABASE_URL=postgres://bench@127.0.0.1:54399/postgres npx vitest run src/warehouse-dataset-build.live.test.ts`)
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run and see them pass**
- [ ] **Step 5: Commit** `feat(db): build a pack dataset as a warehouse table, old table kept until the new one is ready`

---

### Task 4: The service: install, rebuild, refresh, delete

**Files:**
- Create: `packages/bootstrap/src/warehouse-datasets.ts`
- Test: `packages/bootstrap/src/warehouse-datasets.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (build the service, add `warehouseDatasets` to `AppContext`, start the refresher beside the projection worker, stop it on close), `packages/bootstrap/src/db-context.ts` (same service for the CLI, no refresher)

**Interfaces:**
- Consumes: `WarehouseDatasetStore` (Task 2), `buildWarehouseDataset`, `dropWarehouseDataset` (Task 3), `readWarehouseReading` (`packages/bootstrap/src/warehouse-status.ts`), `validateSelectSql`.
- Produces:

```ts
export interface WarehouseDatasetService {
  list(): Promise<WarehouseDataset[]>;
  /** Throws on the first problem, writes nothing: engine not postgres, SQL not one SELECT, a name another pack owns. */
  check(ownerPack: string, defs: PackDataset[]): Promise<void>;
  /** Saves the definitions and builds each in order. Throws on the first build that fails, after recording the error. */
  install(ownerPack: string, defs: PackDataset[]): Promise<void>;
  /** Rebuilds one, or all in order. Resolves to what happened to each. Never throws for a build error. */
  rebuild(name?: string): Promise<Array<{ name: string; ok: boolean; rows?: number; ms?: number; error?: string }>>;
  /** Rebuilds the datasets that are stale, only when the warehouse is up to date. Resolves to the names rebuilt. */
  refreshDue(): Promise<string[]>;
  remove(name: string): Promise<void>;
  /** True while a build runs in this process. */
  building(): boolean;
}
export function createWarehouseDatasetService(deps: {
  store: WarehouseDatasetStore; internalDb: Kysely<InternalSchema>; warehouseDb: Kysely<any>; engine: 'postgres' | 'mssql' | 'mysql';
  build?: typeof buildWarehouseDataset; drop?: typeof dropWarehouseDataset; logger: Logger; now?: () => number;
}): WarehouseDatasetService;
```

- A dataset is stale when `builtAtSeq === null` or `builtAtSeq < reading.head`. `refreshDue` does nothing when `reading.behind > 0`.
- `markBuilt` records the `head` read **before** the build started, so a change saved during the build makes it stale again.
- Builds in one process run one at a time (a promise chain). `building()` reads that.
- A recorded error is `redact(message)`, first line, at most 500 characters.
- The refresher in `index.ts`: call `refreshDue()` 10 seconds after the projection worker reports a cycle that projected nothing after one that did, and every 5 minutes. A throw is logged and never stops the timer.

- [ ] **Step 1: Write the failing tests** with pg-mem for the internal database and a fake `build` that records calls:
  - `check_refuses_a_warehouse_that_is_not_postgresql` (message `datasets need a PostgreSQL warehouse`)
  - `check_refuses_sql_that_is_not_one_select` (`'delete from patients'`, `'select 1; select 2'`)
  - `check_refuses_a_name_another_pack_owns`
  - `install_saves_and_builds_in_the_packs_order`
  - `install_stops_at_the_first_failed_build_and_records_its_error`
  - `refresh_does_nothing_while_the_warehouse_is_behind`
  - `refresh_rebuilds_only_the_stale_ones_when_up_to_date`
  - `a_change_saved_during_a_build_leaves_the_dataset_stale` (the fake `build` saves a record before it returns)
  - `a_failed_rebuild_keeps_the_built_values_and_sets_the_error`
  - `builds_run_one_at_a_time` (two `rebuild()` calls, the fake asserts no overlap)
  - `remove_drops_the_table_and_the_row`
- [ ] **Step 2: Run and see them fail**
- [ ] **Step 3: Implement the service, then wire it in `index.ts` and `db-context.ts`**
- [ ] **Step 4: Run the tests, then `npx tsc --noEmit` in `packages/bootstrap` and `apps/server` (the server's `test-helpers.ts` builds a whole `AppContext` and needs the new field)**
- [ ] **Step 5: Commit** `feat(bootstrap): install, rebuild and refresh pack datasets`

---

### Task 5: The pack installer runs the step

**Files:**
- Modify: `packages/bootstrap/src/content-pack-install.ts`, and where `createContentPackInstaller` is built in `packages/bootstrap/src/index.ts`
- Test: `packages/bootstrap/src/content-pack-install.test.ts`

**Interfaces:**
- Consumes: `WarehouseDatasetService.check` and `.install`.
- Produces: `ContentPackDeps` gains `checkDatasets(ownerPack: string, defs: PackDataset[]): Promise<void>` and `installDatasets(ownerPack: string, defs: PackDataset[]): Promise<void>`. `ownerPack` is `bundle.manifest.id`.

- [ ] **Step 1: Write the failing tests**: `check` of a pack with a bad dataset SQL throws and writes nothing; `install` calls `installDatasets` with the manifest id and the tables, and writes an audit event `dataset.install` with `entityType: 'dataset'`, `entityId: <pack id>`, `metadata: { source: 'content-pack', pack, step, names }`; a failed build makes the install `failed` at that step with the redacted error.
- [ ] **Step 2: Run and see them fail**
- [ ] **Step 3: Add the `datasets` case to `verify` and `runStep`, and pass the two deps in `index.ts`**
- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit** `feat(marketplace): installing a pack builds its datasets`

Ruling to record: `detach` leaves the datasets in place, as it leaves every other thing a pack loaded. A dataset is removed by its own Delete action (Tasks 6 and 7).

---

### Task 6: Routes and the Query page

**Files:**
- Modify: `apps/server/src/query-routes.ts`, `apps/server/src/app.ts`, `apps/server/src/test-helpers.ts`
- Test: `apps/server/src/query-routes.test.ts`
- Modify: `apps/studio/src/query/api.ts`, `apps/studio/src/query/tree/ExplorerTree.tsx`, `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Create: `apps/studio/src/query/DatasetInfoSheet.tsx`
- Test: `apps/studio/src/query/DatasetInfoSheet.test.tsx`, and the ExplorerTree test that covers the Datasets branch

**Interfaces:**
- Produces:
  - `GET /api/query/warehouse-datasets` (same guard as the other query routes) returns `Array<{ name, ownerPack, rowCount, builtAt, buildMs, lastError, stale: boolean }>`.
  - `POST /api/query/warehouse-datasets/:name/rebuild` (the capability that guards custom query edits) returns the one result of `rebuild(name)`. Audits `dataset.rebuild`.
  - `DELETE /api/query/warehouse-datasets/:name` (same capability) removes it. Audits `dataset.delete`.
  - A report or query run whose error is PostgreSQL code `42P01` naming a `dataset.` relation answers with `This report's dataset is still being built.` in place of the raw text.
- UI: under **Datasets** in the explorer, pack datasets list after the workflow ones, each with its row count. Selecting one opens the existing table tab on `dataset.<name>` through the warehouse connector. Each row has a `MoreHorizontal` menu: **Details** (opens `DatasetInfoSheet`: owner pack, rows, last built, build time, last error, label left and value right), **Rebuild**, **Delete** (type-to-confirm dialog, as other deletes on this page).

- [ ] **Step 1: Write the failing route tests** (list shape, rebuild and delete need the capability and audit, the `42P01` message)
- [ ] **Step 2: Run and see them fail**
- [ ] **Step 3: Implement the routes and wire them**
- [ ] **Step 4: Write the failing UI tests** (the branch lists both kinds, the menu items, the sheet's fields, the error shown when `lastError` is set)
- [ ] **Step 5: Implement the UI and the three language files**
- [ ] **Step 6: Run the server and studio tests, `apps/server` lint, and the i18n parity test**
- [ ] **Step 7: Look at it** at desktop width and at 375 by 812, on a database that has one built dataset and one failed one. Save both pictures.
- [ ] **Step 8: Commit** `feat(query): pack datasets show under Datasets, with details, rebuild and delete`

---

### Task 7: CLI and the Warehouse line

**Files:**
- Modify: `packages/cli/src/db.ts`, `packages/cli/src/program.ts`, `packages/cli/src/command-meta.ts`, `packages/cli/src/command-meta.test.ts`
- Test: `packages/cli/src/db.test.ts`
- Modify: `packages/bootstrap/src/warehouse-status.ts` (status gains `datasetsBuilding: boolean`), `apps/studio/src/components/WarehouseStatusBand.tsx`, the three language files, their tests

**Interfaces:**
- Produces: `openldr db datasets list [--json]`, `openldr db datasets rebuild [name] [--json]`, `openldr db datasets delete <name> --force [--json]`. Kinds in `command-meta.ts`: list `{ kind: 'app', capability: 'activity.view' }`; rebuild and delete `{ kind: 'app', capability: <the custom query edit capability>, destructive: true }` for delete only.
- `list` prints one line per dataset: `name  rows  built <iso> in <n> s  [stale]  [error: ...]`.
- The Warehouse line shows `rebuilding datasets` in its small text while `datasetsBuilding` is true.

- [ ] **Step 1: Write the failing tests** (output lines, `delete` refuses without `--force`, the registry tests, the band text)
- [ ] **Step 2: Run and see them fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the CLI, bootstrap and studio tests**
- [ ] **Step 5: Commit** `feat(cli): openldr db datasets, and the Warehouse line says when datasets rebuild`

---

### Task 8: Docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/query.md` (a section "Use a dataset a pack installed": what it is, how to open it, how to read Details, Rebuild, why a report can be one rebuild behind), `apps/web/src/docs/0.1.8/{en,fr,pt}/load-data.md` (two sentences under "Where the data goes"), `docs/CLI-REFERENCE.md` (one row)
- Follow `apps/studio/src/docs/HOW-TO-TEMPLATE.md`.

- [ ] **Step 1: Write the three in-app sections and the three web passages**
- [ ] **Step 2: Run the docs tests** (`cd apps/studio && npx vitest run src/docs`, `cd apps/web && npx vitest run src/docs`)
- [ ] **Step 3: Run `unslop` over the new text**
- [ ] **Step 4: Commit** `docs: pack datasets, in the app and on the web, in en, fr and pt`

---

### Task 9: Proof on the full Tanzania warehouse

**Files:**
- Create (outside the repo): a scratch pack in `~/.local/share/demo5-evidence/dataset-pack/` holding one dataset (the shared first step of the report generator, with the lab name in it) and copies of the 7 reports rewritten to read it.
- Modify: `docs/benchmarks/log.md`, `docs/superpowers/specs/2026-11-19-check-as-bulk-load-research.md`

- [ ] **Step 1: Build a standalone from the branch and install it over the existing data** (the data folder is kept)
- [ ] **Step 2: Install the scratch pack. Record the build time and row count of the dataset.**
- [ ] **Step 3: Run each of the 7 rewritten reports and the 7 originals with the same parameters. Compare the outputs row for row. Record each time.**
- [ ] **Step 4: Save a record so the warehouse changes, wait for the refresher, and confirm the dataset rebuilt and holds the new record's request.**
- [ ] **Step 5: Add the rows to the benchmark log and a section to the research write-up. State what was not proved.**
- [ ] **Step 6: Full gate** (`pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`, each redirected to a file, exit code read after), then a fresh-context review of the whole branch.

Expected at the end: no rewritten report over 5 seconds, every output equal.

Not in this plan: moving the reports generator out of `cdr-toolchain` into `openldr-ce-content-pack-reports-zm` and publishing the real pack. That is the next piece of work and gets its own plan.
