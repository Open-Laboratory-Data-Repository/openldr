# Plugin host step 2a: a plugin's own tables, CE reads and FHIR emit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plugin's server code can keep its own records in its own tables, read CE resources, and send finished FHIR records into CE, without ever being able to reach another table.

**Architecture:** A plugin declares its table shapes in its signed manifest. CE creates them in a private schema `plugin_<id>` and upgrades them additively. Plugin code reaches them only through structured requests (`db_select`, `db_write`), which CE turns into Kysely statements inside that schema. Two more host functions, `ce_read` and `fhir_emit`, reuse CE's existing services. All host functions run on the Extism worker path, where the SDK already awaits async host functions. The broker passes the caller into every call.

**Tech stack:** TypeScript, Kysely on Postgres, Extism JS SDK 1.0.3 (worker path), Rust (`wasm/test-sink`, `openldr-plugin-sdk`), vitest, pg-mem, and real Postgres `*.live.test.ts` files.

**Spec:** `docs/superpowers/specs/2026-11-23-lab-plugin-design.md`, sections 5.1, 5.2 and 5.3. The facts behind this plan are in the session scratchpad `step2-facts.md` and memory note `lab-module-is-a-plugin`.

## Rulings

1. **Column types** are a fixed list: `text`, `integer`, `bigint`, `numeric`, `boolean`, `timestamptz`, `date`, `jsonb`, `uuid`. Names match `^[a-z][a-z0-9_]{0,62}$`. Every table gets CE-managed `created_at` and `updated_at`.
2. **Filters** in `db_select`: `eq`, `in` (up to 1000 values), `lt`, `lte`, `gt`, `gte`, `is_null`, and `prefix` (text only). Order by declared columns only. `limit` defaults to 100 and is capped at 1000. A request may also ask for `count`.
3. **Statement timeout:** 5 s per `db_select` or `db_write`, set with `SET LOCAL statement_timeout` inside the request's transaction.
4. **A facility table** declares one column as its facility column. CE adds `facility = ANY(caller facilities)` to every select, update and delete, and refuses an insert or update that sets another facility. It also turns on `FORCE ROW LEVEL SECURITY`, with a policy reading `current_setting('openldr.facilities', true)`. An unlimited caller gets the value `*`, which the policy reads as all.
5. **The caller's data limit** is resolved to facility ids once per call: the facilities listed, plus every facility in the listed districts and regions, from the facility register.
6. **`ce_read` ops**, first set: `patients.search`, `patients.get`, `patients.register`, `valueset.expand`, `valueset.lookup`, `testCatalog.list`, `testCatalog.get`, `facilities.search`. Each calls the same service the studio route calls, with the caller's data limit.
7. **`fhir_emit`** reuses `checkResources` (`packages/bootstrap/src/import-run.ts:189`) against `allowedResourceTypes(plugin.capabilities)`, then `workflowPersist` (`packages/bootstrap/src/index.ts:896`), with provenance `{ pluginId, pluginVersion, sourceSystem: 'plugin:<id>' }`.
8. **Worker path only.** A plugin that declares any of `host:db`, `host:ce-read` or `emit-fhir` runs its calls on the worker path. Where `canRunOffThread` is false (dev loaders), the call fails with a plain message, rather than running without its host functions.
9. **Removal.** `remove` with `keep: 'nothing'` drops the schema, after the existing typed confirmation. `removeVersion`, disable and rollback keep it.

## Global constraints

- Worktree `.claude/worktrees/lab-module`, branch `feat/plugin-host`, base `0ffb0a6`. The worktree reads the dev `.env`. Anything that opens a database runs with `OPENLDR_SKIP_ENV_FILE=true` on its own data folder. Never use ports 3000, 5433, 3210, 3212, 3213, 3220, 54320, 54331, 54332 or 54340.
- No CE migration is needed unless a task says so; plugin schemas are created at plugin install. The latest internal migration is 141.
- Bundles that do not declare tables stay byte-identical, so existing signatures still verify.
- No em dashes. No `Co-Authored-By` trailer. Strings in en, fr and pt.
- pg-mem cannot run CREATE POLICY, `current_setting` or DROP SCHEMA. Prove those with `*.live.test.ts` files gated by an env URL (pattern: `packages/db/src/user-data-scope-store.live.test.ts:12-31`), and run them in Task 7 against a scratch Postgres.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue`, `pnpm turbo run typecheck --force --concurrency=2`, `pnpm --filter @openldr/server lint`. Never pipe turbo through `tail`.

## Review focus

1. A hostile request is refused before any SQL runs: a table or column name with quotes, a dot, `pg_catalog.x`, `public.users`, a name not in the declared shape, or a limit of 10 million. (Task 3)
2. A site user's `db_select` with no facility filter returns only their facility's rows, and an insert for another facility is refused. (Task 3, live)
3. An upgrade that drops or renames a column, or changes a type, is refused, and the old version stays active. (Tasks 2 and 4)
4. `fhir_emit` with a resource type the plugin did not declare is refused, and nothing is saved. (Task 5)
5. A plugin with host functions on a dev loader fails with a plain message, not silently. (Task 5)

---

### Task 1: Manifest: declared tables and the new capabilities

**Files:** `packages/marketplace/src/capabilities.ts` (`host:db`, `host:ce-read`); `packages/marketplace/src/artifact-manifest.ts` (`pluginPayload.tables`, with the cross-field rule that `tables` needs `host:db`); consent labels in `apps/studio/src/pages/settings/marketplace/util.ts` and i18n; `packages/plugin-ui-sdk` types if needed; and the tests that list the kinds.

**Interfaces:**
- Produces, exported from `@openldr/marketplace` with the zod schema `tableShapeSchema`:
  - `TableShape = { name: string; columns: ColumnShape[]; primaryKey: string[]; indexes?: { columns: string[]; unique?: boolean }[]; facilityColumn?: string }`
  - `ColumnShape = { name: string; type: ColumnType; nullable?: boolean; default?: string | number | boolean | null }`

- [ ] **Tests:**
  - A manifest with tables and `host:db` parses.
  - Tables without `host:db` are refused.
  - Each of these is refused: a bad name, an unknown type, a primary key or facility column that is not one of the columns.
  - A manifest with no tables is unchanged, byte for byte.
- [ ] **Implement,** run the marketplace and studio tests and typecheck, and commit `feat(plugins): declare tables and the host:db and host:ce-read capabilities`.

### Task 2: The plugin schema manager

**Files:** Create `packages/db/src/plugin-schema.ts` and its tests (pg-mem, and `plugin-schema.live.test.ts`).

**Interfaces:**
- Produces: `createPluginSchemas(db: Kysely<any>)`, with:
  - `apply(pluginId: string, shapes: TableShape[]): Promise<{ created: string[]; added: string[] }>`
  - `plan(pluginId, shapes): Promise<ShapePlan>`, which refuses a non-additive change with `PluginShapeError { reason: 'drop' | 'rename' | 'type' | 'name' }`
  - `drop(pluginId): Promise<void>`
  - `schemaName(pluginId): string`

- [ ] **Tests (pg-mem):**
  - The first apply creates the schema and its tables.
  - A second apply with one new table and one new nullable column adds only those.
  - Dropping a column, changing a type, or adding a non-nullable column each refuse, with the reason.
  - A plugin id with odd characters gives a safe schema name.
- [ ] **Tests (live):** a facility table has forced row-level security and its policy, and `drop` removes the schema.
- [ ] **Implement,** checking every identifier against ruling 1's pattern and letting Kysely quote it. Commit `feat(db): plugin schemas from declared table shapes`.

### Task 3: Structured requests

**Files:** Create `packages/db/src/plugin-data-requests.ts` and its tests (pg-mem and live).

**Interfaces:**
- Produces: `createPluginRequests(db)`, with:
  - `select(pluginId, shapes, caller: PluginCaller, req: SelectRequest): Promise<{ rows: Record<string, unknown>[]; count?: number }>`
  - `write(pluginId, shapes, caller, req: WriteRequest): Promise<{ results: { rowCount: number }[] }>`
  - the zod schemas `selectRequestSchema` and `writeRequestSchema`
  - `PluginCaller = { userId: string; displayName: string | null; capabilities: string[]; facilities: string[] | '*' }`

- [ ] **Tests:**
  - Review focus 1 and 2.
  - Each kind of filter, order and paging, and `count`.
  - A write of an insert, an update and a delete in one transaction rolls back whole when one step fails.
  - The 5 s timeout is set (live).
- [ ] **Implement** rulings 2 to 4. Commit `feat(db): structured requests on a plugin's own tables`.

### Task 4: Install, upgrade and removal

**Files:** `packages/plugins/src/runtime.ts` (`install` applies the shapes before `store.install` flips the version active); `packages/bootstrap/src/plugin-removal.ts` (drop at `keep: 'nothing'`); wiring in `packages/bootstrap/src/index.ts`; tests.

- [ ] **Tests:**
  - Installing a plugin with tables creates them.
  - An upgrade with a refused shape change leaves the old version active, and reports the reason.
  - `remove` with `keep: 'nothing'` drops the schema; `removeVersion` and disable do not.
- [ ] **Implement.** Commit `feat(plugins): create and upgrade plugin tables at install`.

### Task 5: The host functions

**Files:**
- `packages/plugins/src/runner.ts`: `RunOptions.hostFns?: Record<string, (input: unknown) => Promise<unknown>>`.
- `extism-runner.ts`: register them under `extism:host/user`, JSON in and out, and force the worker path (ruling 8).
- `wasm-sink.ts`: `SinkInvokeOptions.caller` and `host`.
- `packages/bootstrap/src/plugin-host.ts` (new): builds the four functions for one plugin and one caller, from Tasks 2 and 3 and CE services (rulings 5 to 7).
- Tests with a fake runner.

**Interfaces:**
- Produces: `createPluginHost(deps)`, returning `forCall(plugin: { id; version; capabilities; tables }, caller: PluginCaller): Record<string, (input: unknown) => Promise<unknown>>`.

- [ ] **Tests:**
  - Each function is present only with its capability.
  - `ce_read` refuses an unknown op.
  - `patients.search` honours the caller's data limit.
  - `fhir_emit`: Review focus 4.
  - Ruling 8's plain message (Review focus 5).
- [ ] **Implement.** Commit `feat(plugins): host functions for tables, CE reads and FHIR emit`.

### Task 6: The broker passes the caller

**Files:** `packages/bootstrap/src/plugin-broker.ts` (`BrokerPrincipal.displayName`; `invoke` passes `caller` and the host from Task 5); `apps/server/src/plugin-ui-routes.ts:107` (the principal gains `displayName`, and the data limit is resolved per ruling 5); tests.

- [ ] **Tests:**
  - `invoke` passes the caller, with facilities resolved.
  - A limited caller still reaches `invoke` (it is in `LIMITED_OPS`), and its host functions see only its own facilities.
- [ ] **Implement.** Commit `feat(plugins): the broker passes the caller to plugin code`.

### Task 7: Proof with a real plugin

**Files:** `wasm/` `openldr-plugin-sdk` (Rust imports and wrappers for the four host functions); `wasm/test-sink` (new entrypoints that use them, and a declared facility table); `scripts/build-test-sink.mjs` (entrypoints, tables, capabilities); and the integration test `packages/plugins/src/host-fns.integration.test.ts` (skipped when the wasm or the live URL is missing).

- [ ] **Build** the test plugin. Run the integration tests on the worker path against a scratch Postgres: its own data folder, `OPENLDR_SKIP_ENV_FILE=true`, a free port.
- [ ] **Prove** Review focus 1 to 5 end to end. Run the live tests from Tasks 2 and 3 against the same Postgres.
- [ ] **Run** both gate commands and server lint.
- [ ] **Docs:** web docs for plugin authors (en, fr, pt) on declared tables, the request shapes and the host functions. The in-app marketplace consent labels are done in Task 1.
- [ ] **Commit** `test(plugins): prove plugin host functions with the test plugin`.

Order: 1, 2, 3, 4, 5, 6, 7. Step 2b is its own plan after this one: plugin-declared capabilities, a gate per entrypoint, the page knowing the caller, and the sidebar and layouts.
