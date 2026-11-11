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

---

## As built (2026-11-11)

Commits on `claude/ui-plugins-2-daf625`: `68df5f4c` tables and shared logic; `4c21827f` routes and
CLI; `0fd9c946` studio; `468c30d4` docs; `ac028c3d` fixes from the branch review; the next commit
keeps the dev sign-in's roles.

The operator approved the plan as written, so the three questions took their planned answers: no
shipped layouts, the first role in Roles page order, and `settings.edit_general`.

Changes from the plan:

- `GET /api/layouts` returns `{ layouts, roleOrder, myRoles }`, not a bare list. Studio needs the
  role order, and a user without `roles.view` cannot read the Roles list. `myRoles` is the caller's
  roles from `user_roles`. The review found that `req.user.roles` holds the sign-in token's roles,
  which are empty on an OIDC install and stale on Keycloak (`apps/server/src/auth-plugin.ts:131`).
  The dev sign-in (bypass on, no bearer token, the same test `auth-plugin.ts` uses) has no
  `user_roles` rows, so it uses its `AUTH_DEV_ROLES`; so does a caller with no users row. Found on
  the throwaway CE after the first fix: the dev sign-in got no roles. `bearer` in
  `auth-plugin.ts` is now exported for this.
- The user's full-sidebar pick is stored as `full`, not `none`. The CLI already uses `none` to
  clear any preference key.
- `openldr layouts set` on an existing name keeps the start page and roles that are not given.
- Docs always shows under a layout and is not offered in the editor.
- A start page must be one of the layout's pages. The editor clears it when its page is unticked;
  the API and CLI refuse it.
- Picking Dashboard as start page saves `/` when a layout start page would otherwise take over.
  With no layout start page it still clears the key, as in slice 6.
- The `/settings` route gate also admits `settings.edit_general`.

### Proof, by layer

| Layer | What ran |
| --- | --- |
| Migration | pg-mem test: unique name, one default per role, cascades. Real Postgres 16 (throwaway): migration ran at boot; deleting a role that was a default removed the default (psql). |
| Shared logic | 6 tests: create, update, role moved between layouts, Roles page order, duplicate name, unknown role, unknown id, delete, input rules including the start page rule. |
| Preferences | `layout` saved, cleared, junk dropped; CLI `layout full` and `layout none`. |
| Routes | 5 tests: 401, 403, create, list, update, delete, audit rows, 400, 404, 409, `myRoles` from `user_roles` with a wrong token role, the dev sign-in's roles, and a bearer token never treated as the dev sign-in. Real server: the dev sign-in got `myRoles: ["lab_admin"]` and its role default cut the sidebar and opened Forms; a start page outside the pages got 400. |
| CLI | 6 command tests and 3 registration tests. Real run: `layouts set`, `layouts list`, `layouts delete` refusing without `--force`. |
| Studio | `layoutInForce` 6, store 1, sidebar and menus 7, first page 3, Layouts page 6. |
| Browser, throwaway CE | A role default layout cut the sidebar to its pages plus Docs and opened its start page on first load. Full sidebar from the Layout submenu saved `full` and showed every page. Settings, Layouts listed both layouts; editing one and ticking a role saved through the sheet's ⋯ menu. |
| Phone, 375x812 | Layouts table fits, ⋯ at 359px. Editor sheet has no sideways scroll. Layout submenu opens on a tap and sits inside the screen. |

Full forced gate: see the hand-over note for the run on the final commit.

HONEST NON-PROOF:

- `myRoles` from `user_roles` is proven by a route test over pg-mem with the real role store. It
  was not run with a real Keycloak or OIDC sign-in; the throwaway CE uses the dev sign-in, which
  takes the fallback.
- The phone checks used touch-type events in a desktop browser, not a real phone.

Deferred minors from the branch review:

- A personal start page that the layout hides lands on the Dashboard, not on the layout's start page.
- Two admins creating a layout with the same name at the same instant: the second gets a 500, not a 409.
