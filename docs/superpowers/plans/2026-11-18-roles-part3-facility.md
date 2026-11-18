# Roles part 3: dashboard data limited to a facility or area, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a user can be limited to some facilities, districts or regions; every dashboard number they see then counts only rows from those places.

**Architecture:** a `user_data_scopes` table read where capabilities are resolved, so a limited user loses the permissions that read unlimited data everywhere at once. One scope-predicate builder in `@openldr/dashboards` is used by the builder compiler and by a SQL placeholder that the server fills. The Users sheet and `openldr users scope` set it.

**Spec:** `docs/superpowers/specs/2026-11-18-roles-scope-design.md`, section 3 and "Settled after the builder check".

## Operator decisions (2026-11-18)

- **SQL widgets use a scope placeholder.** A SQL widget or filter-options query writes `{{scope:request:<alias>}}`, `{{scope:report:<alias>}}` or `{{scope:result:<alias>}}` where a condition goes. The server fills it with `TRUE` for an unlimited user and with the scope condition for a limited one. SQL with no placeholder is refused for a limited user ("Not available with your data limit"). The sample dashboard's SQL gets the placeholders.
- **Forms stay, with patient search.** A limited user keeps `forms.*`. Patient search inside forms is not limited. The docs say so.

## Global Constraints

- Migration 127 `user_data_scopes` (and its item rows). 127 is free on every branch (checked 2026-11-18).
- Scopes are keyed by the role subject (`user_roles.user_id`, `subject ?? id`), so `resolveCapabilities(subject)` can read them (`packages/db/src/schema/internal.ts:260-262`).
- Two explicit states: **Everything** (no row, today's behaviour) and **Limited** (a row, plus items). Limited with no items sees nothing. Fails closed.
- Items: a register facility (`registry_id`), a district (stored with its region, because district names repeat), or a region. Picked from the register, never typed.
- A row counts when its **requesting facility or its testing lab** is in scope (operator: "either one"). A row with no known facility is hidden from a limited user.
- Scope to codes happens in the warehouse: `facility_map` rows whose `registry_id`, `region` or (`region`, `district`) match, joined on `(source_system, performer_system, source_code)` as the seeded reports do (`packages/reporting/src/seed/report-seeds.ts:229`). Requests use `requester_system`/`requester_code`. Studio-entered orders (`requester_system = urn:openldr:cs:facility-registry`) are not in `facility_map` (`packages/bootstrap/src/facility-reconcile.ts:166-185`), so they match the register code directly.
- The testing lab of a request is reached with `EXISTS` on `diagnostic_reports` (`based_on_id`), never a join, so counts do not fan out (`report-seeds.ts:2312-2316`).
- AGENTS.md section 5 (sheet, ⋯ menu, label-left, shadcn), section 6 (CLI, docs en/fr/pt, mobile, changelog), section 8 (no hard-coded facilities).

## What a limited user loses (dropped where capabilities are resolved)

`reports.*`, `patients.*`, `query.run`, `data.export`, `dashboards.create`, `dashboards.edit`, `workflows.view`, `workflows.edit`, `workflows.run`, `connectors.manage`, `audit.view`, `activity.view`, `imports.correct_held`, `facilities.view`. Kept: `dashboards.view`, `forms.*` (operator), and the admin and settings permissions their roles give. The Users sheet lists what the limit removes.

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

**Interfaces:** `DataScope = { limited: false } | { limited: true; facilities: string[]; districts: Array<{ region: string; district: string }>; regions: string[] }`. `UserDataScopeStore { get(subject): Promise<DataScope>; set(subject, scope): Promise<{ before: DataScope; after: DataScope }> }`. `set` takes a per-subject lock and reads before and after inside it (lessons of part 1, FR5 and FR10).

- [ ] Tests: no row is Everything; Limited with items round-trips; Limited with none stays Limited; set returns its own before and after. Implement, commit.

### Task 2: Capabilities and the scope on the request

**Files:** `packages/db/src/role-store.ts` (`resolveCapabilities` drops the list above for a limited subject), `packages/rbac` (the dropped list, exported, one place), `apps/server/src/auth-plugin.ts` and `access-key-auth.ts` (`req.user.dataScope`), the CLI handoff caller (`dataScope`).

- [ ] Tests: a limited subject loses exactly the list and keeps the rest; an unlimited one is unchanged; `req.user.dataScope` is set on both sign-in paths. Commit.

### Task 3: The scope condition

**Files:** `packages/dashboards/src/scope.ts` (+ test): `scopeCondition(kind: 'request'|'report'|'result', alias, scope)` returns a SQL fragment with bound values. `compile.ts`: `compileBuilderQuery(..., scope?)` ANDs it last for linked models; `registry.ts` names each model's link kind (`service_requests` request, `diagnostic_reports` report, `observations` result; others none). `sql-text.ts`/`template.ts`: fill `{{scope:kind:alias}}` (alias checked as an identifier), refuse SQL with none for a limited user.

- [ ] Tests on pg-mem where possible, and a live test on a disposable Postgres with `facility_map` rows: requester in scope, lab in scope, neither, shared district name, studio-entered order, OR filter tree. Commit.

### Task 4: Routes

**Files:** `packages/bootstrap/src/index.ts` (`dashboards.query(q, scope?)`, `runDashboardQuery`), `apps/server/src/dashboards-routes.ts` (pass `req.user.dataScope` on the saved-widget, filter-options and free-form routes; `/models` hides unlinked models for a limited user), `apps/server/src/users`/roles routes: `GET`/`PUT /api/users/:subject/data-scope` (`roles.manage`, audited `user.data_scope.set`, before and after as objects).

- [ ] Tests for each, including "Not available with your data limit". Commit.

### Task 5: The sample dashboard

**Files:** `packages/dashboards/src/samples/openldr-general.json` and its seed: each tile's SQL and each filter-options SQL gets the placeholder for its table.

- [ ] Test: every sample SQL holds a placeholder; an unlimited run returns what it did before (the seed's drift check). Commit.

### Task 6: Studio

**Files:** `apps/studio/src/users/UserDialog.tsx` (a **Data** row, label left: Everything / Limited, then facility, district and region pickers from the register; saved after roles), `api.ts`, the widget's "Not available with your data limit" text, i18n en/fr/pt.

- [ ] Tests; check at 375px on a scratch server with warehouse rows for two facilities, as an admin and as a limited user. Commit.

### Task 7: CLI and docs

**Files:** `packages/cli/src/user.ts` (`openldr users scope <subject>` shows; `--all`; `--facility id,id --district Region/District --region R` sets), command-meta (`roles.manage`), program; users guide, dashboard guide (placeholders, what a limited user loses, the rebuild delay, forms keep patient search) and web CLI docs, en/fr/pt.

- [ ] Tests, docs, commit. Full gate. Codex review.
