# Roles part 1: who may open and submit each form — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a form can name the roles that may open it and the roles that may submit it; empty lists keep today's behaviour.

**Architecture:** a `form_access` table and one shared check in `@openldr/bootstrap`, used by the form routes, the CLI and the studio list. The form builder's ⋯ menu opens an Access sheet.

**Tech Stack:** TypeScript (db, bootstrap, server, studio, CLI).

**Spec:** `docs/superpowers/specs/2026-11-18-roles-scope-design.md`, section 1 and "Settled after the builder check".

## Global Constraints

- Migration 125 `form_access` (`form_id`, `role_id`, `mode` `open|submit`, primary key all three). 124 is taken by held corrections, which must merge first; check open branches before merging.
- Lists store role ids. A user passes when any of their roles is listed. Deleting a role removes its rows.
- Empty list for a mode: today's rule (the capability alone). A non-empty list: the capability and a listed role.
- A holder of `roles.manage` always passes. A holder of `forms.edit` sees every form in the builder list, so they can manage access.
- Refusals: opening a form you may not open is 404 (its existence is not disclosed); submitting is 403.
- AGENTS.md section 5: Sheet, ⋯ menu, label-left form, shadcn only. Section 6: CLI, docs en/fr/pt, mobile, changelog.

## Review Focus

- A form with an open list but no submit list: listed roles open it; every `forms.submit` holder of those roles submits.
- A user with two roles, one listed: passes.
- `GET /api/forms/published` and the form runtime list: only forms the user may open.
- A role deleted: its rows go, and a list that becomes empty means "everyone" again. The Access sheet says so.
- A starter-pack or duplicated form: starts with empty lists.

---

### Task 1: Storage

**Files:** `packages/db/src/migrations/internal/125_form_access.ts` (+ index, migrations test list), `packages/db/src/form-access-store.ts` (+ test), schema types; the role store's delete removes the role's `form_access` rows.

**Produces:** `createFormAccessStore(db)`: `get(formId) → { open: string[]; submit: string[] }`, `set(formId, { open, submit })` (replaces both), `forForms(formIds) → Map`, `removeRole(roleId)`.

- [ ] Tests (pg-mem): set then get; set replaces; forForms groups; removeRole clears a role in every form; role delete clears it.
- [ ] Implement, run db tests, commit.

### Task 2: The shared check

**Files:** `packages/bootstrap/src/form-access.ts` (+ test), exported.

**Produces:** `formAccess(deps: { access: FormAccessStore }) → { mayOpen(user, formId): Promise<boolean>; maySubmit(user, formId): Promise<boolean>; visible(user, formIds): Promise<Set<string>> }` where `user = { roleIds: string[]; capabilities: string[] }`.

- [ ] Tests: the five Review Focus cases plus admin passes and empty lists keep today's rule.
- [ ] Implement, run, commit.

### Task 3: Routes and the user's role ids

**Files:** `apps/server/src/forms-routes.ts`, `apps/server/src/auth-plugin.ts` (`req.user.roleIds` from `roles.rolesForUser`), route tests.

- [ ] Tests: list and published filtered for a non-editor; `GET /:id`, `/questionnaire`, `/versions` 404 when not allowed; `POST /:id/responses` 403; `GET/PUT /api/forms/:id/access` (`forms.edit`), PUT validates role ids exist; audit `form.access.set`.
- [ ] Implement, run server tests, commit.

### Task 4: Studio

**Files:** `apps/studio/src/forms-builder/BuilderHeader.tsx` (⋯ **Access**), new `apps/studio/src/forms-builder/FormAccessSheet.tsx` (+ test) copying `FieldEditorSheet.tsx`; `api.ts`; i18n en/fr/pt.

- [ ] Tests: the sheet shows two role pickers, label left; saving sends both lists; empty shows "Everyone with the permission"; the ⋯ item only for `forms.edit`.
- [ ] Implement, run studio tests, check at 375px, commit.

### Task 5: CLI and docs

**Files:** `packages/cli/src/forms.ts` (`forms access <formId>` shows; `--open r1,r2 --submit r3`, `--clear`), command-meta, program; in-app forms guide and web CLI docs en/fr/pt.

- [ ] Tests, implement, docs, commit. Full gate.
