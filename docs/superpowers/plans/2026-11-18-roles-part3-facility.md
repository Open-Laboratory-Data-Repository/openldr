# Roles part 3: dashboard data limited to a facility or area, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a user can be limited to some facilities, districts or regions; every dashboard number they see then counts only rows from those places.

**Architecture:** a `user_data_scopes` table read where capabilities are resolved, so a limited user loses the permissions that read unlimited data everywhere at once. One scope-predicate builder in `@openldr/dashboards` is used by the builder compiler and by a SQL placeholder that the server fills. The Users sheet and `openldr users scope` set it.

**Spec:** `docs/superpowers/specs/2026-11-18-roles-scope-design.md`, section 3 and "Settled after the builder check".

## Operator decisions (2026-11-18)

- **A limited user never runs SQL** (revised after Codex plan review P3-03, which showed a placeholder cannot guarantee the limit: an optional `[[ ]]` clause drops it, and an `OR` beside it counts every facility). SQL widgets and filter-options SQL are refused for a limited user ("Not available with your data limit"). The builder adds the scope condition itself, so it cannot be lost.
- **The sample dashboard is rebuilt as builder widgets**, so limited users see it working. Each SQL tile becomes a builder widget where the builder can express it; one it cannot stays SQL and shows "Not available" to a limited user. Unlimited users must see the same numbers as before.
- **Forms stay, with patient search.** A limited user keeps `forms.*`. Patient search inside forms is not limited. The docs say so.

## Global Constraints

- Migration 127 `user_data_scopes` (and its item rows). 127 is free on every branch (checked 2026-11-18).
- Scopes are keyed by the role subject (`user_roles.user_id`, `subject ?? id`), so `resolveCapabilities(subject)` can read them (`packages/db/src/schema/internal.ts:260-262`).
- Two explicit states: **Everything** (no row, today's behaviour) and **Limited** (a row, plus items). Limited with no items sees nothing. Fails closed.
- Items: a register facility (`registry_id`), a district (stored with its region, because district names repeat), or a region. Picked from the register, never typed.
- A row counts when its **requesting facility or its testing lab** is in scope (operator: "either one"). A row with no known facility is hidden from a limited user.
- Scope to codes happens in the warehouse: `facility_map` rows whose `registry_id`, `region` or (`region`, `district`) match, joined on `(source_system, performer_system, source_code)` as the seeded reports do (`packages/reporting/src/seed/report-seeds.ts:229`). Requests use `requester_system`/`requester_code`. Studio-entered orders (`requester_system = urn:openldr:cs:facility-registry`) are not in `facility_map` (`packages/bootstrap/src/facility-reconcile.ts:166-185`), so they match the register's projected concept identity, the code the picker emits, which is the row id when two registers share a `facility_code` (`packages/db/src/facility-observed.ts:245`, `facility-reconcile.ts:503` `registryConceptCodeById`). Test duplicate codes across registers (review P3-05).
- The testing lab of a request is reached with `EXISTS` on `diagnostic_reports` by `based_on_id` (`packages/db/src/schema/external.ts:123-130`), never a join, so counts do not fan out. (The seeded report at `report-seeds.ts:2315` joins by `batch_id` with `DISTINCT`; that is the fan-out this avoids, not a precedent; review P3-07.)
- AGENTS.md section 5 (sheet, ⋯ menu, label-left, shadcn), section 6 (CLI, docs en/fr/pt, mobile, changelog), section 8 (no hard-coded facilities).

## What a limited user loses (dropped where capabilities are resolved)

`reports.*`, `patients.*`, `query.run`, `data.export`, `dashboards.create`, `dashboards.edit`, `workflows.view`, `workflows.edit`, `workflows.run`, `connectors.manage`, `audit.view`, `activity.view`, `imports.correct_held`, `facilities.view`, `sync.view`, `sync.manage` (review P3-02: sync shows incoming clinical bodies, `apps/server/src/settings-routes.ts:185-187`, and `sync export` needs only `sync.manage`, `packages/cli/src/command-meta.ts:408-410`).

**Plugins.** The plugin broker runs `reports.run` without checking the caller's report permission (`packages/bootstrap/src/plugin-broker.ts:474`, wired at `packages/bootstrap/src/index.ts:1972`). For a limited caller the broker refuses every report and data operation (review P3-01). Kept: `dashboards.view`, `forms.*` (operator), and the admin and settings permissions their roles give. The Users sheet lists what the limit removes.

## Review Focus

- A `filterTree` with OR cannot widen the scope: the scope condition is ANDed after the user's filters (`packages/dashboards/src/compile.ts:371`).
- A request tested at an in-scope lab but requested elsewhere: counted. A row with neither code known: not counted.
- A district name shared by two regions: only the stored region's district counts.
- A limited user whose `facility_map` has not been rebuilt since a new code appeared: that row is hidden until the rebuild (fail closed). The docs say so.
- Models with no facility link (`patients`, `facilities`, `specimens`) are not offered to a limited user, in `/api/dashboards/models` and at query time.
- The dev bypass grants every capability (`apps/server/src/auth-plugin.ts:93`) and is never limited.

---

### Task 1: Storage

**Files:** `packages/db/src/migrations/internal/127_user_data_scopes.ts`, `packages/db/src/user-data-scope-store.ts` (+ test, + live test), schema, db index.

**Shared setter (review P3-06):** `packages/bootstrap/src/data-scope.ts` `setUserDataScope(deps, subject, input)` checks the subject exists, checks every facility, district and region against the register, and returns the store's before and after. The route and the CLI both call it.

**Interfaces:** `DataScope = { limited: false } | { limited: true; facilities: string[]; districts: Array<{ region: string; district: string }>; regions: string[] }`. `UserDataScopeStore { get(subject): Promise<DataScope>; set(subject, scope): Promise<{ before: DataScope; after: DataScope }> }`. `set` takes a per-subject lock and reads before and after inside it (lessons of part 1, FR5 and FR10).

- [ ] Tests: no row is Everything; Limited with items round-trips; Limited with none stays Limited; set returns its own before and after. Implement, commit.

### Task 2: Capabilities and the scope on the request

**Files:** `packages/db/src/role-store.ts` (`resolveCapabilities` drops the list above for a limited subject), `packages/rbac` (the dropped list, exported, one place), `apps/server/src/auth-plugin.ts` and `access-key-auth.ts` (`req.user.dataScope`), the CLI handoff caller (`dataScope`).

- [ ] Tests: a limited subject loses exactly the list and keeps the rest; an unlimited one is unchanged; `req.user.dataScope` is set on both sign-in paths. Commit.

### Task 3: The scope condition

**Files:** `packages/dashboards/src/scope.ts` (+ test): `scopeCondition(kind: 'request'|'report'|'result', alias, scope)` returns a Kysely expression with bound values. `compile.ts`: `compileBuilderQuery(..., scope?)` ANDs it last for linked models; `registry.ts` names each model's link kind (`service_requests` request, `diagnostic_reports` report, `observations` result; others none). The SQL path (`packages/bootstrap/src/index.ts:958-976`) refuses any SQL for a limited user, which also covers filter-options SQL.

- [ ] Tests on pg-mem where possible, and a live test on a disposable Postgres with `facility_map` rows: requester in scope, lab in scope, neither, shared district name, studio-entered order (including duplicate codes across registers), OR filter tree. Commit.

### Task 4: Routes

**Files:** `packages/bootstrap/src/index.ts` (`dashboards.query(q, scope?)`, `runDashboardQuery`), `packages/bootstrap/src/plugin-broker.ts` (refuse report and data ops for a limited principal; the principal carries `dataScope` from `apps/server/src/plugin-ui-routes.ts:105`), `apps/server/src/dashboards-routes.ts` (pass `req.user.dataScope` on the saved-widget, filter-options and free-form routes; `/models` hides unlinked models for a limited user), `apps/server/src/users`/roles routes: `GET`/`PUT /api/users/:subject/data-scope` (`roles.manage`, audited `user.data_scope.set`, before and after as objects).

- [ ] Tests for each, including "Not available with your data limit", a limited plugin caller refused a report (P3-01), and a limited user refused sync bodies and `sync export` (P3-02). Commit.

### Task 5: The sample dashboard

**Files:** `packages/dashboards/src/samples/openldr-general.json` and its seed: each SQL tile becomes a builder widget where the builder can express it. The specimen branch of the pipeline funnel (`openldr-general.json:160`, review P3-04) has no facility link, so that tile stays SQL and shows "Not available" to a limited user. Filters keep static options where they have them; a filter whose options come from SQL has no suggestions for a limited user.

- [ ] Tests: on a fixture warehouse each rebuilt tile returns the same numbers as its SQL before (unlimited); a limited run counts only in-scope rows; the seed updates an existing install's unedited sample. Commit.

### Task 6: Studio

**Files:** `apps/studio/src/users/UserDialog.tsx` (a **Data** row, label left: Everything / Limited, then facility, district and region pickers from the register; saved after roles), `api.ts`, the widget's "Not available with your data limit" text, i18n en/fr/pt.

- [ ] Tests; check at 375px on a scratch server with warehouse rows for two facilities, as an admin and as a limited user. Commit.

### Task 7: CLI and docs

**Files:** `packages/cli/src/user.ts` (`openldr users scope <subject>` shows; `--all`; `--facility id,id --district Region/District --region R` sets), command-meta (`roles.manage`), program; users guide, dashboard guide (placeholders, what a limited user loses, the rebuild delay, forms keep patient search) and web CLI docs, en/fr/pt.

- [ ] Tests, docs (what a limited user loses, that they never run SQL, the rebuild delay, forms keep patient search), commit. Full gate. Codex review.
