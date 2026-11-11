# Per-user preferences: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user's theme, sidebar state and first page are saved on the server, so they follow
the login to any browser or phone.

**Architecture:** One row per user in a new `user_preferences` table (JSON column). Shared read
and write logic lives in `@openldr/bootstrap`; the route and the CLI both call it. Studio keeps
`localStorage` as a first-paint cache and syncs with `/api/me/preferences` after login.

**Spec:** `docs/superpowers/specs/2026-11-11-studio-customization-and-helper-plugins-design.md`,
section 4.3 (B1) and the operator answers. The operator asked for exactly three things on
2026-11-11: theme travels with the user, the sidebar does too, and the user can pick a first page.

## Global constraints

- Migration number is `113`. No other branch claims it (checked every local branch).
- Any signed-in user may read and write their own preferences. No capability gate. A user can
  never read or write another user's row through the API.
- `startPage` is a studio path only: starts with `/`, no `//`, no scheme. The server checks the
  shape. Studio only redirects to a page that is in the user's sidebar.
- The first-page redirect happens once per app load, and only when the user lands on `/`.
  Clicking Dashboard later always shows the Dashboard.
- UI rules from AGENTS.md §5. The first-page choice copies the Language submenu in the user menu.
- Docs: new files only. No em dashes.

## Not in this plan

- Sidebar reorder or hiding items. Not asked for.
- Language following the user. Same mechanism, but not asked for. Listed as a follow-up.
- A plugin page as the first page.

## Review focus

1. Saved first page the user's role can no longer open. Expect the Dashboard, not Access denied.
2. Preferences request fails (offline, 500). Expect the app to load with the local theme.
3. User opens a deep link, then clicks Dashboard. Expect the Dashboard, no redirect.
4. Two devices: theme changed on one. Expect the other to pick it up on its next load.
5. A stored row with junk keys or values. Expect them dropped on read, not an error.

---

### Task 1: Migration and shared logic

**Files:**
- Create: `packages/db/src/migrations/internal/113_user_preferences.ts` and `.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`,
  `packages/db/src/schema/internal.ts`
- Create: `packages/bootstrap/src/user-preferences.ts` and `.test.ts`; export from `index.ts`

**Interfaces:**
```ts
// table: user_preferences(user_id text primary key, prefs jsonb not null default '{}', updated_at timestamptz not null default now())
export interface UserPreferences { theme?: 'light' | 'dark'; sidebarCollapsed?: boolean; startPage?: string }
export const userPreferencesPatchSchema: z.ZodType<...>; // strict; each key optional; null clears the key
export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>;
export function parseStoredPreferences(raw: unknown): UserPreferences; // drops unknown or invalid keys
export async function getUserPreferences(db: Kysely<InternalSchema>, userId: string): Promise<UserPreferences>;
export async function saveUserPreferences(db: Kysely<InternalSchema>, userId: string, patch: UserPreferencesPatch): Promise<UserPreferences>;
```
- `startPage` rule: `/^\/(?!\/)[A-Za-z0-9/_.:-]*$/`, max 200 chars.

- [ ] Tests: migration up, insert, primary key, down. Store: empty for a new user; patch merges;
  `null` clears a key; junk stored keys are dropped; bad `startPage` (`//evil`, `https://x`) rejected
  by the schema; unknown patch key rejected.
- [ ] Fail, implement, pass. Commit `feat(db): user_preferences table and shared read/write`.

### Task 2: Route and CLI

**Files:**
- Create: `apps/server/src/me-preferences-routes.ts` and `.test.ts`; register in `app.ts`
- Modify: `packages/cli/src/user.ts`, `packages/cli/src/program.ts`, `packages/cli/src/user.test.ts`

**Interfaces:**
- `GET /api/me/preferences` returns `UserPreferences`. `PUT /api/me/preferences` takes a patch and
  returns the merged `UserPreferences`. 401 without a user. 400 `{ error: 'invalid preferences' }`.
- CLI: `openldr user preferences show <id> [--json]` and
  `openldr user preferences set <id> <key> <value>` where `<value>` `none` clears the key.
  `set` audits `user.preferences.update` as `actorName: 'cli'` with `metadata: { keys }`.

- [ ] Tests: 401; get empty; put then get; put for user A never changes user B; bad body 400.
  CLI: commands registered; `parsePreferenceArg('theme','dark')`, `('sidebarCollapsed','true')`,
  `('startPage','none')` give the right patch; unknown key throws.
- [ ] Fail, implement, pass, server lint. Commit `feat(server,cli): per-user preferences`.

### Task 3: Studio

**Files:**
- Modify: `apps/studio/src/api.ts` (`getMyPreferences`, `saveMyPreferences`, `UserPreferences`)
- Create: `apps/studio/src/shell/userPreferences.ts` (store) and `.test.ts`
- Create: `apps/studio/src/shell/UserPreferencesSync.tsx` and `.test.tsx` (sync + `StartPageGate`)
- Modify: `apps/studio/src/shell/useSidebar.ts`, `apps/studio/src/shell/AppShell.tsx` (export
  `NAV`, add the Start page submenu), `apps/studio/src/App.tsx` (mount sync, wrap `/`),
  i18n en, fr, pt (`layout.startPage`)

**Interfaces:**
```ts
// userPreferences.ts
export function useUserPreferences(): { loaded: boolean; prefs: UserPreferences };
export async function loadUserPreferences(): Promise<void>;          // never throws; loaded=true either way
export function setUserPreference(patch: UserPreferencesPatch): void; // updates state now; PUTs only after a successful load
export function noteEntryPath(pathname: string): void;               // marks the first-page choice as used unless pathname is '/' or '/auth/callback'
export function startPageUsed(): boolean; export function markStartPageUsed(): void;
export function resetUserPreferencesForTest(): void;
```
- `UserPreferencesSync` (renders nothing): loads when `user.id` appears; applies a stored theme
  through the theme context; saves the theme when it changes after load.
- `StartPageGate({ children })`: on the first entry at `/`, shows `LoadingState` until loaded,
  then `<Navigate replace>` to the saved page if it is in the user's sidebar, else the children.
- `useSidebar`: a loaded `sidebarCollapsed` wins over `localStorage`; a toggle saves both.

- [ ] Tests: store load, load failure, patch before and after load; gate redirects once, skips an
  unreachable page, skips after a deep link; sync applies and saves the theme; sidebar toggle
  saves; the Start page submenu lists only visible pages and saves the pick.
- [ ] Fail, implement, pass, studio typecheck. Phone check at 375x812.
- [ ] Commit `feat(studio): theme, sidebar and first page follow the user`.

### Task 4: Docs and gate

- [ ] New files: `apps/studio/src/docs/0.1.8/{en,fr,pt}/user-preferences.md`,
  `apps/web/src/docs/0.1.8/user-preferences.md`. Add nav entries to the hand-over note.
- [ ] Full forced gate at `--concurrency=2`, both halves. Quote the output.

## Added later the same day: language follows the user

The operator picked this from the follow-up list ("Language follows user").

Gap, checked: the language was saved to this browser only (`apps/studio/src/i18n/language.ts`,
`setLanguage` wrote `openldr.lang` to localStorage and nothing else), and `UserPreferences` had no
language key (`packages/bootstrap/src/user-preferences.ts`).

What changed:

- `language` (`en`, `fr` or `pt`) is a saved preference. No migration: the row is JSON.
- `openldr user preferences set <id> language fr` works, and `none` clears it.
- Studio applies the saved language after sign-in and saves a language the user picks.

One rule differs from the theme. With nothing saved, a browser's theme is saved so it travels.
For language, only a language that was **picked** in that browser is saved. A browser where none
was picked shows English by default, and saving that default would overwrite, at the next sign-in
elsewhere, the language the user chose on another device.

Proof: 1 new store test, 2 changed CLI tests, 5 new studio tests (saved language applied; a pick
is saved; an earlier pick in this browser is saved; the default is not saved; the next user's
language is applied). On a throwaway CE: picking French saved `{"language":"fr"}`; after clearing
the browser's storage and reloading, studio opened in French.

HONEST NON-PROOF: two real browsers or devices were not used. Clearing one browser's storage
stood in for a second browser.
