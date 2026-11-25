# Row-level security on plugin data under a superuser login: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The facility policy on plugin data tables applies even when CE logs in as a Postgres superuser.

**Architecture:** Migration 145 makes the no-login role `openldr_plugin_data` and grants it the plugin
schemas. `plugin-schema.ts` grants it each new schema and table. `plugin-data-requests.ts` switches to
it with `SET LOCAL ROLE` at the start of each request transaction, only when the login bypasses
row-level security and may use the role.

**Tech Stack:** TypeScript, Kysely, vitest, pg-mem, live tests on real Postgres.

**Spec:** `docs/superpowers/specs/2026-11-25-plugin-data-rls-role-design.md`

## Global Constraints

- Role name `openldr_plugin_data`, `NOLOGIN NOSUPERUSER NOBYPASSRLS`; rights `USAGE` on each CE-made
  plugin schema (one holding `_openldr_shapes`) and `SELECT, INSERT, UPDATE, DELETE` on its tables.
- No switch when the login neither is a superuser nor has `BYPASSRLS`; no switch under pg-mem.
- Migration 145 changes nothing when the login cannot create roles, and when run on pg-mem.
- Live tests run on a throwaway database `openldr_rls_test` on the dev Postgres, dropped after.
- No em dashes. The droplet is not touched.

## Review Focus

1. A plugin installed after migration 145: its new schema and tables are granted, so its requests work under the switch.
2. A plugin whose update adds a table or column: the new table is granted.
3. A select's count query and a write's `expect` check run under the role: the policy does not change their numbers for an unlimited caller (`*`).
4. A superuser login where the role is missing: requests still work, with one warning.
5. pg-mem: every existing plugin data test still passes, unchanged.

---

### Task 1: migration 145 and the grants on new tables

**Files:** Create `packages/db/src/migrations/internal/145_plugin_data_role.ts` (and register it in
`index.ts`); modify `packages/db/src/plugin-schema.ts` (`export const PLUGIN_DATA_ROLE`; grant in
`apply` when the role exists); create `packages/db/src/plugin-data-role.live.test.ts`.

- [ ] **Step 1: Failing live tests** (skipped without `PLUGIN_ROLE_TEST_DATABASE_URL`): `migration 145 makes the role and grants an existing plugin schema`;
  `migration 145 run twice changes nothing more`; `apply grants a new schema and table to the role`; `a login that cannot create roles: migration 145 skips`.
- [ ] **Step 2: Run** against the throwaway database. Expected: fail.
- [ ] **Step 3: Implement.** The migration reads `rolsuper, rolcreaterole` for `current_user` inside a
  try (pg-mem has no `pg_roles`: skip).
- [ ] **Step 4: Run** the live tests and `cd packages/db && npx vitest run`. Expected: pass.
- [ ] **Step 5: Commit** `feat(db): a no-login role for plugin data, granted every plugin schema`.

### Task 2: the switch in plugin data requests

**Files:** Modify `packages/db/src/plugin-data-requests.ts` (`createPluginRequests(db, pgMem?)`;
`begin` switches); `packages/bootstrap/src/index.ts` (log the warning when the role is missing under a
bypassing login); extend `plugin-data-requests.live.test.ts`.

- [ ] **Step 1: Failing live tests:** `inside a request current_user is openldr_plugin_data under a superuser login`;
  `a raw select in the request sees only the set facilities`; `a login that does not bypass row-level security is not switched`;
  `with the role missing the request works and the status says missing`.
- [ ] **Step 2: Run.** Expected: fail.
- [ ] **Step 3: Implement.** `export async function pluginDataRoleStatus(db): Promise<'switch' | 'not-needed' | 'missing'>`, kept per process in the factory.
- [ ] **Step 4: Run** the live tests, `cd packages/db && npx vitest run`, then the full gate. Expected: pass.
- [ ] **Step 5: Commit** `feat(db): plugin data requests run as the plugin data role under a superuser login`.

### Task 3: after merge, on dev

- [ ] Ask before merging. After the merge, the dev server runs migration 145; run the lab plugin live
  check (`TARGET=dev`). Expected: all pass. Check `openldr_plugin_data` holds the lab and cdr-source schemas.
