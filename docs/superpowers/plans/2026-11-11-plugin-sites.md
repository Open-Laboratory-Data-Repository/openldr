# Plugin dashboard card and side panel: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plugin can show a card on the home dashboard and a right side panel that stays open
while the user moves between pages. An admin can switch either one off per plugin.

**Architecture:** The signed manifest gains an optional `ui.sites`. The plugin keeps its one
signed `ui.html`; the host tells it which place it is drawn in (`site` in the init context), so
no new signed asset is needed. Which sites are off is one `app_settings` row, read and written by
shared code in `@openldr/bootstrap` that the route and the CLI both call. The panel is mounted
once, outside the page routes, so its iframe is not reloaded on each page change.

**Spec:** `ui-plugins-design-draft.md`, section 4.3 B2, in the shared notes folder.

## Global constraints

- `ui.sites` is optional with no default. A manifest without it parses as before. Signatures are
  checked against the raw manifest (`packages/marketplace/src/bundle-fs.ts:93`), so existing
  signed bundles stay valid.
- Sites need the webview tier (`ui.entry` set). A declarative-only plugin with `sites` is rejected.
- Switching a site off only hides that place. The plugin's page, its nav entry and its broker
  calls are unchanged. Disabling the whole plugin stays the existing Disable action.
- The same role gate applies: a user without the plugin's `requiredRoles` sees no card and no
  panel (the `/api/plugins/ui` filter already does this).
- No migration. The off list is `app_settings` key `plugins.sitesOff`. Feature flags and number
  settings look keys up by name and ignore unknown ones (`feature-flags.ts:35`,
  `number-settings.ts:40`), so a new key does not disturb them.
- UI rules from AGENTS.md §5. Docs: new files only. No em dashes.

## Not in this plan

- Moving or resizing a plugin card inside the user's dashboard grid. The cards sit in their own
  row under the grid, in manifest order.
- Toasts, status lines, or any other place.
- A per-user switch. Off is lab-wide, set by an admin.
- Signing and publishing a real plugin that uses sites. The browser check uses the unsigned
  `ui-reference` plugin in dev mode.

## Review focus

1. An existing signed bundle without `sites` installs and verifies. Expect no change.
2. A panel is open and the admin disables the plugin. Expect the panel to close on the next page
   load, not to show an error frame.
3. A user without the plugin's role. Expect no card and no panel button.
4. The stored off list is junk (bad JSON, a non-array). Expect every site treated as on, no 500.
5. A phone. Expect the panel to take the full width with a reachable close button, and the card
   row to stack in one column.

---

### Task 1: Manifest, SDK, and shared off list

**Files:**
- Modify: `packages/marketplace/src/artifact-manifest.ts`, `artifact-manifest.test.ts`
- Modify: `packages/plugin-ui-sdk/src/types.ts`, `bootstrap.ts`, `bootstrap.test.ts`
- Create: `packages/bootstrap/src/plugin-sites.ts` and `.test.ts`; export from `index.ts`

**Interfaces:**
```ts
// artifact-manifest.ts, inside uiContributionSchema
sites: z.object({
  widget: z.object({ title: z.string().min(1).max(60), height: z.enum(['small', 'medium', 'large']).default('medium') }).strict().optional(),
  panel: z.object({ title: z.string().min(1).max(60) }).strict().optional(),
}).strict().optional(),
export type PluginSite = 'widget' | 'panel';
export type UiSites = NonNullable<UiContribution['sites']>;

// plugin-ui-sdk types.ts
PluginInitContext.site?: 'page' | 'widget' | 'panel';   // absent means 'page'
OpenLdrPluginApi.site: 'page' | 'widget' | 'panel';

// bootstrap plugin-sites.ts
export const SITES_OFF_KEY = 'plugins.sitesOff';
export async function getSitesOff(store: AppSettingStore): Promise<Set<string>>;   // entries are `${pluginId}:${site}`; junk value gives an empty set
export async function setSiteOn(store: AppSettingStore, pluginId: string, site: PluginSite, on: boolean, actor: string | null): Promise<Set<string>>;
export function visibleSites(declared: UiSites | undefined, off: Set<string>, pluginId: string): UiSites; // drops off sites
```

- [ ] Tests, manifest: no `sites` parses and has no `sites` key; widget and panel parse, height
  defaults to `medium`; `sites` on a declarative-only UI throws; an unknown site key throws.
- [ ] Test, manifest: an existing signed bundle fixture (from `bundle-fs.test.ts`) still verifies.
- [ ] Tests, SDK: `openldr.site` is `'page'` before init and with no `site`; it is `'widget'` after
  an init carrying `site: 'widget'`.
- [ ] Tests, plugin-sites: empty store gives empty set; off then on round-trips; turning off
  twice stores one entry; junk stored value gives an empty set; `visibleSites` drops an off site.
- [ ] Fail, implement, pass. Commit `feat(plugins): ui.sites in the manifest and the sites-off list`.

### Task 2: Routes and CLI

**Files:**
- Modify: `apps/server/src/plugin-ui-routes.ts` and `.test.ts`
- Modify: `apps/server/src/marketplace-routes.ts` and `.test.ts`
- Modify: `packages/cli/src/market.ts`, `market.test.ts`, `program.ts`, `program-market.test.ts`
- Modify: `docs/HTTP-API.md`

**Interfaces:**
- `GET /api/plugins/ui` entries gain `sites: { widget?: { title; height }; panel?: { title } }`,
  with off sites removed. `sites` is `{}` when none.
- `GET /api/marketplace/:id/sites` (MANAGE) returns `{ declared: UiSites; off: PluginSite[] }`.
- `PUT /api/marketplace/:id/sites` (MANAGE) body `{ site: 'widget' | 'panel'; on: boolean }`.
  404 for an unknown plugin. 400 `{ error: 'site not declared' }` when the manifest has no such
  site. Audits `plugin.sites.update` with `metadata: { site, on }`. Returns the GET shape.
- CLI: `openldr market sites <id> [--json]` prints declared sites and on/off.
  `openldr market sites <id> <widget|panel> <on|off>` sets one, audited as `actorName: 'cli'`.

- [ ] Tests, ui route: a plugin with both sites lists both; one switched off lists the other only;
  a user without the required role gets no entry; a disabled plugin gets no entry.
- [ ] Tests, marketplace route: GET shape; PUT off then GET; undeclared site 400; unknown id 404;
  audit row written; non-admin 403.
- [ ] Tests, CLI: commands registered; `on`/`off` parsed; any other value exits 1 with a message.
- [ ] Fail, implement, pass, server lint. Commit `feat(server,cli): list plugin sites and switch them off`.

### Task 3: Studio, card, panel, and admin sheet

**Files:**
- Modify: `apps/studio/src/api.ts` (`PluginUiEntry.sites`, `getPluginSites`, `setPluginSite`)
- Modify: `apps/studio/src/plugins/PluginFrame.tsx` (pass `site` through the init context)
- Create: `apps/studio/src/plugins/PluginWidgets.tsx` and `.test.tsx`
- Create: `apps/studio/src/plugins/pluginPanel.ts` (store) and `PluginPanelHost.tsx`, with tests
- Create: `apps/studio/src/pages/settings/marketplace/PluginSitesSheet.tsx` and `.test.tsx`
- Modify: `apps/studio/src/dashboard/DashboardPage.tsx` (card row under the grid)
- Modify: `apps/studio/src/shell/AppShell.tsx` (panel menu in the header)
- Modify: `apps/studio/src/App.tsx` (mount `PluginPanelHost` once, outside `<Routes>`)
- Modify: `apps/studio/src/components/ui/sheet.tsx` (optional `hideOverlay` prop)
- Modify: `apps/studio/src/pages/settings/marketplace/PackageDetail.tsx` (⋯ item "Places")
- Modify: i18n en, fr, pt (`plugins.sites.*`)
- Modify: `scripts/build-ui-reference.mjs`, `reference-plugins/ui-reference/ui.html` (declare
  both sites, show a short view per site) for the browser check

**Interfaces:**
```ts
// pluginPanel.ts
export function usePluginPanel(): { open: { id: string; title: string } | null };
export function openPluginPanel(id: string, title: string): void;
export function closePluginPanel(): void;
export function syncPluginPanel(entries: PluginUiEntry[]): void; // closes the panel if its plugin or panel site is gone
```
- Card heights: small 160px, medium 240px, large 360px. Row is one column below `md`, two from `md`.
- Panel: a `Sheet` with `modal={false}`, `hideOverlay`, `onInteractOutside` prevented, so the page
  stays usable beside it. `w-96` from `md`, full width below. Closes on sign-out.
- Header: a `PanelRight` icon button opens a `DropdownMenu` listing the user's panel plugins. Shown
  only when there is at least one. AppShell calls `syncPluginPanel` after each plugin list fetch.
- Admin: "Places" in the package ⋯ menu, only for a plugin that declares sites. The sheet shows one
  `Switch` per declared site, label left and switch right.
- The panel is a `Sheet` because it is a side surface, not a confirm prompt.

- [ ] Tests, card row: renders one frame per widget with `site: 'widget'` and the right height;
  renders nothing with no widgets.
- [ ] Tests, panel: opening renders a frame with `site: 'panel'`; the frame element is the same
  after a route change; `syncPluginPanel` with the plugin gone closes it; sign-out closes it.
- [ ] Tests, header: no panel button with no panel plugins; one item per panel plugin.
- [ ] Tests, admin sheet: shows only declared sites; toggling calls `setPluginSite`; a failed save
  shows an error and puts the switch back.
- [ ] Fail, implement, pass, studio typecheck.
- [ ] Browser check on a throwaway CE with `ui-reference` built with both sites: card on the
  dashboard, panel stays open from Dashboard to Reports, admin turns the card off and it is gone
  after reload. Repeat at 375x812. Screenshot each.
- [ ] Commit `feat(studio): plugin card on the dashboard and a side panel`.

### Task 4: Docs and gate

- [ ] New files: `apps/studio/src/docs/0.1.8/{en,fr,pt}/plugin-sites.md` (user and admin view)
  and `apps/web/src/docs/0.1.8/plugin-sites.md` (author view: the manifest block and
  `openldr.site`). Nav entries for `registry.ts` and `content.ts` go in the hand-over note.
- [ ] Full forced gate at `--concurrency=2`, both halves. Quote the output.
- [ ] Append "as built" and the proof by layer to this plan. Commit
  `docs(plugin-sites): guide in en, fr and pt, and the plan as built`.

Shared files this slice touches outside the plugin area: `AppShell.tsx`, `App.tsx`,
`components/ui/sheet.tsx` (one optional prop), `DashboardPage.tsx`, `docs/HTTP-API.md`,
`packages/cli/src/program.ts`.

---

## As built (2026-11-11)

Commits on `claude/ui-plugins-2-daf625`: `5d5355a8` manifest, SDK and off list; `de822da8` routes and
CLI; `20a29954` studio; `8fe87651` docs; `b6ddbf22` fixes from the branch review.

Changes from the plan:

- `/api/plugins/ui` lists only the active version of a plugin. The store lists every installed
  version (`packages/plugins/src/store.ts:93`), so a plugin with two versions showed twice in the
  sidebar and would have shown two cards. A route test failed first, then passed.
- The CLI audits with the existing `cliActor()` (actor type `cli`, name from `--actor` or the OS
  user), the same as `openldr user preferences set`.
- The panel sits under the 48px header, so the header buttons stay usable. On desktop the page is
  padded by the panel's width while it is open, so the panel never covers page content.
- Opening the phone menu closes the panel. On a phone the panel fills the screen and would cover
  the drawer.
- Escape closes the panel only when focus is inside it.
- The panel menu does not hand focus back to its button on close. A refocused button reopened its
  tooltip over the header.
- The shared `Switch` takes no `id`, so the Places sheet labels each switch with `aria-label`.

### Proof, by layer

| Layer | What ran |
| --- | --- |
| Manifest schema | 5 new tests: no `sites` key when absent, both sites and the height default, rejected on a declarative-only UI, unknown site, bad height. |
| Signature | 1 new test: a signed manifest carrying `sites` verifies, and adding a panel after signing fails with `bad-signature`. |
| SDK | 1 new test: `openldr.site` is `page` before init and when absent, `widget` when sent, `page` for junk. |
| Shared off list | 8 tests in `plugin-sites.test.ts`, including junk stored values and the not-found and not-declared errors. |
| Routes | 6 new `/api/plugins/ui` tests (sites listed, one switched off, none, role gate, disabled, two versions). 6 new admin route tests (GET, PUT and audit, undeclared 400, bad body 400, unknown 404, no `marketplace.manage` 403). |
| CLI | 7 command tests and 2 registration tests. |
| Studio | Panel store 4, panel host 6, card row 2, admin sheet 4, header menu 5, Places item 1. |
| Browser, throwaway CE | Card on the dashboard drawn with `site` widget at 160px. Panel opened from the header, stayed open from Dashboard to Reports with the same iframe element. Places sheet switched the card off: gone from `/api/plugins/ui` and from the dashboard after reload, audit row `plugin.sites.update` written. `openldr market sites` listed and switched sites; a bad site exited 1 with the usage line. Plugin disabled with the panel open: the panel closed on the next page. With a panel open on desktop, the rightmost page button ends at 614px and the panel starts at 640px. |
| Phone, 375x812 | Card row one column, no sideways scroll. Panel full width under the header, close button at the top and working. Opening the menu closes the panel and shows the whole drawer. |

HONEST NON-PROOF:

- The panel is pinned to the bottom of the screen. Headless Chromium cannot show the `vh` versus
  `dvh` problem, so only a real phone can confirm its bottom edge.
- The reference plugin's own CSS sets dark text, so its card and panel are hard to read in dark
  mode. That is the test plugin, not the host.
- Two admins switching sites at the same moment can lose one change. The read and write of the
  off list are not in a transaction.

Deferred minors from the branch review:

- Settings keeps one AppShell, so a panel switched off from Marketplace stays open until the admin
  leaves Settings.
- The Places sheet fetches again when the package page redraws.
