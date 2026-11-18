# Roles part 2: dashboards shared with roles, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a dashboard can name the roles that may see it; an empty list keeps today's behaviour.

**Architecture:** a `dashboard_access` table and one shared check in `@openldr/bootstrap`, used by the dashboard
routes, the CLI and the studio list. The dashboard page's ⋯ menu opens a Share sheet. Built the way part 1
(forms) was, including its review fixes: the save locks the dashboard row and returns its own before and after,
and the share route returns role names so a person without `roles.view` can pick roles.

**Tech Stack:** TypeScript (db, bootstrap, server, studio, CLI).

**Spec:** `docs/superpowers/specs/2026-11-18-roles-scope-design.md`, section 2 and "Settled after the builder check".

## Global Constraints

- Migration 126 `dashboard_access` (`dashboard_id`, `role_id`, primary key both). No open branch claims 126 (checked 2026-11-18).
- The list stores role ids. A person passes when any of their roles is listed. Deleting a role removes its rows.
- Empty list: today's rule, everyone with `dashboards.view`. A non-empty list: `dashboards.view` and a listed role.
- The owner always passes. An admin (`roles.manage`) always passes. A dashboard with no owner (every existing one) has only admins as owner.
- The server sets `ownerId` to the caller on create and keeps the stored owner on update. Today the body sets it (`packages/dashboards/src/types.ts:187`), so it cannot be trusted.
- Only the owner or an admin may change the share list. Refusals: a dashboard a person may not see is 404; changing the share of one you may see but do not own is 403.
- AGENTS.md section 5: Sheet, ⋯ menu, label-left form, shadcn only. Section 6: CLI, docs en/fr/pt, mobile, changelog.

## The data is locked too (operator, 2026-11-18: "Also lock the data")

Today widget data comes from `POST /api/dashboards/query` (`apps/server/src/dashboards-routes.ts:78`). It needs
only `dashboards.view` and carries no dashboard id (`packages/dashboards/src/types.ts:118`), so any viewer can run
any query. Sharing alone would hide a dashboard but not its data. So:

- A viewer runs a **saved** widget: `POST /api/dashboards/:id/widgets/:widgetId/query` with only
  `{ filterValues }`. The server loads the stored dashboard, checks `maySee`, takes the stored widget query,
  binds the filter values, and runs it. Filter dropdown options likewise:
  `POST /api/dashboards/:id/filters/:filterId/options`.
- The free-form `POST /api/dashboards/query` and `compile-sql` stay for the widget editor but need
  `dashboards.edit`. A viewer can no longer run a query of their own.
- The binding code (`bindQuery`, `bindFilterTree`) moves from the studio into `@openldr/dashboards`, so the
  server and the studio bind the same way.
- The studio's dashboard view uses the saved-widget route. The widget editor, and a dashboard with unsaved
  changes, keep the free-form route; only editors reach them.

## Review Focus

- The default dashboard (`id: 'default'`, no owner) shared with some roles: other users must still get a page, not an error. The studio picks the first dashboard it may see.
- A person with two roles, one listed: sees it.
- PUT and DELETE of a dashboard a person may not see: 404, nothing changed.
- A client that sends a different `ownerId` on create or update: ignored.
- Two shares saved at once: one list wins, never both merged, and each audit row names its own lists.
- A viewer without `dashboards.edit` calling the free-form query route: 403. Calling a saved widget of a dashboard they may not see: 404, no query run.
- A widget id that is not on that dashboard, or a filter value for a filter the dashboard does not have: refused, no query run.
- A saved SQL widget with `dashboard.raw_sql` off still runs for a viewer, as today.

---

### Task 1: Storage

**Files:** `packages/db/src/migrations/internal/126_dashboard_access.ts`, `packages/db/src/dashboard-access-store.ts` (+ test, + live test gated on `DASHBOARD_ACCESS_TEST_DATABASE_URL`), `schema/internal.ts`, db `index.ts`; the role delete path that already calls `formAccessStore.removeRole` also calls this one.

**Interfaces:** `DashboardAccessStore { get(id): Promise<string[]>; set(id, roleIds): Promise<{before: string[]; after: string[]}>; forDashboards(ids): Promise<Map<string, string[]>>; removeRole(roleId): Promise<void> }`. `set` locks the `dashboards` row `FOR UPDATE` and reads before and after inside the transaction.

- [ ] pg-mem tests (get, set replaces, forDashboards, removeRole), and the live test (a save waits for a held lock; two saves at once keep one list; each returns its own before and after). Watch them fail, implement, pass, commit.

### Task 2: The shared check

**Files:** `packages/bootstrap/src/dashboard-access.ts` (+ test), exported from the bootstrap index, on `AppContext` as `dashboardAccessStore` and `dashboardAccess`.

**Interfaces:** `dashboardAccess({access})` with `maySee(user: FormUser & {id}, d: {id, ownerId})` and `visible(user, ds)`; `setDashboardShare(deps, id, names)` resolving role slug or id, de-duplicated, throwing `DashboardShareError` `no-dashboard` or `no-role`, returning the store's before and after.

- [ ] Tests: empty list passes `dashboards.view`; listed role passes; owner and admin pass; no owner means only admin; two roles one listed. Implement, commit.

### Task 2b: Binding moves to the shared package

**Files:** `packages/dashboards/src/bind.ts` (+ test) takes `bindQuery` and `bindFilterTree` from
`apps/studio/src/dashboard/DashboardWidget.tsx:6` and `dashboard/editor/conditionTree.model.ts:90`; the studio
imports them from `@openldr/dashboards`.

- [ ] Move the existing tests with them; both packages pass. Commit.

### Task 3: Routes

**Files:** `apps/server/src/dashboards-routes.ts` (+ `dashboards-share-routes.test.ts`).

- [ ] `GET /api/dashboards` lists only what the person may see. `GET`, `PUT`, `DELETE /api/dashboards/:id` answer 404 for one they may not see.
- [ ] Create sets `ownerId` to the caller; update keeps the stored owner.
- [ ] `GET /api/dashboards/:id/share` (may see) returns `{ roles, choices: [{id, slug, name}] }`. `PUT` (owner or admin) sets it, audited `dashboard.share.set` with the save's before and after.
- [ ] `POST /api/dashboards/:id/widgets/:widgetId/query` and `/filters/:filterId/options` (VIEW, `maySee`, stored query, bound server-side). `POST /api/dashboards/query` and `compile-sql` need `dashboards.edit`.
- [ ] Tests for each, including the Review Focus rows. Commit.

### Task 4: Studio

**Files:** `apps/studio/src/dashboard/DashboardPage.tsx` (⋯ **Share**, shown to the owner or an admin), new `ShareSheet.tsx` (+ test) copying `forms-builder/FormAccessSheet.tsx`; `api.ts`; i18n en/fr/pt.

- [ ] The view runs widgets and filter options through the saved routes; the editor and a dashboard with unsaved changes keep the free-form route.
- [ ] Tests: the sheet lists roles by name from `choices`; empty shows "Everyone with the permission"; saving sends the list; the ⋯ item hides for a non-owner. Implement, check at 375px on a scratch server, commit.

### Task 5: CLI and docs

**Files:** `packages/cli/src/dashboards.ts` (`openldr dashboards share <id>` shows; `--roles r1,r2` sets; `--clear` empties; `--json`), command-meta (`dashboards.view` to show, owner or admin enforced by the shared function), program; in-app dashboard guide and web CLI docs en/fr/pt, including that a viewer now sees data only through dashboards shared with them.

- [ ] Tests, implement, docs, commit. Full gate. Codex review.
