# Layout presets: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin makes named layouts. Each one sets which pages the sidebar shows and which page
opens first. The admin picks a default layout per role. A user can pick another one, or none.

**Architecture:** Layouts live in a new table, with a second table for the default per role
(migration 114). Shared read and write logic lives in `@openldr/bootstrap`; the routes and the CLI
both call it. The user's own pick is one more key, `layout`, in the slice 6 preferences row (JSON,
no migration). Studio works out the layout in force and filters its sidebar with it.

**Spec:** `ui-plugins-design-draft.md`, section 4.3 B3, in the shared notes folder. It builds on
slice 6 (`docs/superpowers/plans/2026-11-11-user-preferences.md`).

## Checked first (RULE 0)

- Nothing hides sidebar pages per user today. The sidebar shows every page the user's
  capabilities allow (`apps/studio/src/shell/AppShell.tsx`, the `NAV.filter` in the `<nav>`).
  Slice 6 left "hiding items" out on purpose (`2026-11-11-user-preferences.md`, "Not in this plan").
- The first page is per user only (`startPage` in `packages/bootstrap/src/user-preferences.ts:14`).
  Nothing sets it per role.

## Global constraints

- Migration `114_layout_presets`. Reserved for this slice by the coordinator.
- A layout only hides. It never shows a page the user's capabilities do not allow, and it is not
  a security boundary: a hidden page still opens from a link. Settings and Docs stay reachable.
- The first page in force: the user's own `startPage`, else the layout's, else the Dashboard.
  StartPageGate keeps its rule that it only redirects to a page in the user's sidebar.
- The layout in force: the user's own pick, else the default of their first role that has one, in
  the order the Roles page lists roles. The user's pick `full` means the full sidebar.
- No layouts ship with CE. The admin makes them. A layout names studio paths, not clinical codes,
  so §8 does not apply, but a shipped "Bench" would still guess at how a lab works.
- Writes need `settings.edit_general`. Reading the list needs only a signed-in user, because the
  user menu lists layouts.
- UI rules from AGENTS.md §5: Sheet editor, ⋯ menus, label left and input right, pagination on the
  table, `StripedEmpty` and `LoadingState`. Docs: new files only. No em dashes.

## Not in this plan

- Reordering sidebar pages. A layout shows pages in the usual order.
- Theme, density or accent in a layout.
- Plugin pages (`/x/<id>`) in a layout. They stay in the sidebar whatever the layout says. A
  follow-up if asked.

## Review focus

1. A layout lists a page the user's role cannot open. Expect it hidden anyway, no error.
2. The admin deletes a layout that is a role default and some user's pick. Expect both to fall
   back cleanly: role default gone, the user sees the next rule in line.
3. A user with two roles, each with a default. Expect the first role's, in Roles page order.
4. A layout whose start page the user cannot open. Expect the Dashboard, as in slice 6.
5. Phone: the editor sheet and the user menu's Layout submenu fit 375px.

---

### Task 1: Tables and shared logic

**Files:**
- Create: `packages/db/src/migrations/internal/114_layout_presets.ts` and `.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `migrations.test.ts`, `packages/db/src/schema/internal.ts`
- Create: `packages/bootstrap/src/layout-presets.ts` and `.test.ts`; export from `index.ts`
- Modify: `packages/bootstrap/src/user-preferences.ts` and `.test.ts` (the `layout` key)

**Interfaces:**
```ts
// layout_presets(id text pk, name text not null unique, start_page text null, pages jsonb not null,
//                updated_at timestamptz not null default now(), updated_by text null)
// role_layout_defaults(role_id text pk references roles(id) on delete cascade,
//                      layout_id text not null references layout_presets(id) on delete cascade)
export interface LayoutPreset { id: string; name: string; startPage: string | null; pages: string[]; roles: string[] /* role slugs */ }
export const layoutInputSchema: z.ZodType<{ name: string; startPage: string | null; pages: string[]; roles: string[] }>;
export async function listLayouts(db: Kysely<InternalSchema>): Promise<LayoutPreset[]>; // roles filled
export async function saveLayout(db, id: string | null, input, actor: string | null): Promise<LayoutPreset>; // null id creates
export async function deleteLayout(db, id: string): Promise<void>;
// user-preferences.ts: UserPreferences.layout?: string  // a layout id, or 'full' for the full sidebar
```
- `pages` and `startPage` use the slice 6 path rule. `pages` has 1 to 50 entries, no duplicates.
- Setting `roles` on a layout replaces that layout's role defaults and moves a role off any other
  layout, in one transaction. A role has at most one default.

- [ ] Tests: migration up and down, both keys, the cascade when a role or a layout is deleted.
  Store: create, update, list with roles, a role moved between layouts, delete clears defaults,
  duplicate name refused, bad path refused, empty `pages` refused. Preference `layout` saved,
  `null` clears it, junk dropped on read.
- [ ] Fail, implement, pass. Commit `feat(db): layout presets and role defaults`.

### Task 2: Routes and CLI

**Files:**
- Create: `apps/server/src/layout-routes.ts` and `.test.ts`; register in `app.ts`
- Create: `packages/cli/src/layouts.ts` and `.test.ts`; register in `program.ts`
- Modify: `packages/cli/src/user.ts` (`preferences set <id> layout <id|full|none>`, `none` clears it as for every key), `docs/HTTP-API.md`

**Interfaces:**
- `GET /api/layouts` (signed in) returns `LayoutPreset[]`.
- `POST /api/layouts`, `PUT /api/layouts/:id`, `DELETE /api/layouts/:id` need
  `settings.edit_general`. 400 `{ error }` on bad input, 404 unknown id, 409 duplicate name.
  Audit `layout.create`, `layout.update`, `layout.delete` with `metadata: { name }`.
- CLI: `openldr layouts list [--json]`,
  `openldr layouts set <name> --pages <path,...> [--start-page <path>] [--roles <slug,...>]`
  (creates or updates by name), `openldr layouts delete <name> --force`. Audited as the CLI actor.

- [ ] Tests: 401, 403, create then list, update roles moves a default, delete, 409, bad body 400.
  CLI: commands registered, `--pages` parsed, delete refuses without `--force`.
- [ ] Fail, implement, pass, server lint. Commit `feat(server,cli): layout presets`.

### Task 3: Studio

**Files:**
- Modify: `apps/studio/src/api.ts` (`listLayouts`, `saveLayout`, `deleteLayout`, `LayoutPreset`)
- Create: `apps/studio/src/shell/layouts.ts` (store plus `layoutInForce(prefs, layouts, userRoles, roleOrder)`) and `.test.ts`
- Create: `apps/studio/src/pages/settings/Layouts.tsx`, `LayoutSheet.tsx`, with tests; route and
  sub-nav entry under Settings
- Modify: `apps/studio/src/shell/AppShell.tsx` (filter `NAV` by the layout in force; a **Layout**
  submenu in the user menu, next to **Start page**), `apps/studio/src/shell/UserPreferencesSync.tsx`
  (the layout's start page in StartPageGate), i18n en, fr, pt

**Interfaces:**
```ts
export function layoutInForce(
  prefs: UserPreferences, layouts: LayoutPreset[], userRoles: string[], roleOrder: string[],
): LayoutPreset | null; // null means the full sidebar
```
- Layouts page: table of name, pages count, start page, default for roles. Header ⋯ has New
  layout. Row ⋯ has Edit and Delete (confirm prompt). `TablePagination`.
- Sheet: Name, Start page (Select of sidebar pages), Pages (one checkbox per sidebar page),
  Default for roles (checkbox per role). Save in the sheet's ⋯ menu.
- User menu **Layout** submenu: "Role default (name)", each layout by name, "Full sidebar".

- [ ] Tests: `layoutInForce` for each rule in Global constraints; sidebar hides a page the layout
  leaves out and never shows one the capabilities hide; Start page submenu offers only shown pages;
  Layout submenu saves the pick; the editor creates and edits; delete asks first.
- [ ] Fail, implement, pass, studio typecheck. Browser at desktop and 375x812 on a throwaway CE.
- [ ] Commit `feat(studio): layout presets: admin page, role defaults, and the user's pick`.

### Task 4: Docs and gate

- [ ] New files: `apps/studio/src/docs/0.1.8/{en,fr,pt}/layouts.md` and
  `apps/web/src/docs/0.1.8/layouts.md`. Nav entries go in the hand-over note.
- [ ] Full forced gate at `--concurrency=2`, both halves. Quote the output.
- [ ] Append "as built" and the proof by layer to this plan.

Shared files this slice touches outside the plugin area: `packages/db` (migration 114, schema),
`apps/server/src/app.ts`, `apps/studio/src/App.tsx`, `apps/studio/src/shell/AppShell.tsx`,
`SettingsShell.tsx` (sub-nav entry), `packages/cli/src/program.ts`, `docs/HTTP-API.md`.

## Questions for the operator

1. Ship no layouts, as planned, or seed the three examples from the design (Bench, Data, Admin)?
2. A user with several roles: is "first role in Roles page order" the right tie-break?
3. Who may edit layouts: `settings.edit_general` (planned), or `roles.manage`?
