# Plugin host step 2b: plugin permissions, a gate per action, and plugin pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plugin declares its own permissions, which CE treats like its own while the plugin is installed. CE checks a permission before every plugin action. The plugin page knows who is signed in. A plugin's sidebar entry and page are gated, and a profile layout can list them. Site users can find a patient at their own facility.

**Architecture:** The signed manifest gains `permissions` (keys and labels) and `actionPermissions` (the permissions each entrypoint needs). A catalog provider in `@openldr/bootstrap` merges CE's static catalog with the permissions of active, enabled plugins. Every place that validates or lists capabilities reads that provider. The broker refuses an `invoke` whose caller lacks the action's permission. A new CE capability, `patients.find`, gives facility-limited users a strong-match patient lookup through plugins. The studio passes real capabilities into the plugin page, and filters plugin entries by capability and layout.

**Tech stack:** TypeScript, zod, Kysely, Fastify, React with shadcn, vitest, pg-mem.

**Spec:** `docs/superpowers/specs/2026-11-23-lab-plugin-design.md`, sections 5.4 and 5.5. Facts from step 2a are in memory note `lab-module-is-a-plugin` and in the session scratchpad `step2-facts.md`.

## Rulings

1. **Permission keys** match `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`. A key must not equal a CE capability or another installed plugin's key; such an install is refused with a plain message. Each key has a label and a description in English, and optional `labels` for French and Portuguese.
   **Groups owned forever** (operator, 2026-11-23, after the Task 2 review found key theft by rollback and by kept grants): a key's first segment is its group. The first plugin to install a key in a group owns that group for good, recorded in CE's database, even after the plugin is removed. No other plugin may ever declare a key in that group. CE's own group names (the first segment of every CE capability, and the capability group names) are reserved, so no plugin can claim a future CE permission. The lab plugin claims `lab`, so it still inherits the kept `lab.*` grants from step 1.
2. **`actionPermissions`** maps an entrypoint to a list of permissions. The caller needs any one of them to run it. A listed permission is either the plugin's own or a CE capability. **If a plugin declares `actionPermissions`, an entrypoint missing from it is refused** (closed by default). A plugin without it keeps today's behaviour, including `CORRECTOR_OPS`.
3. **The catalog provider** returns CE's static catalog plus one group per active, enabled plugin. The group label is the plugin's nav label, or its id. Role validation, the Roles page catalog, the CLI role commands and profile pack role steps all read it. Plugin keys never enter the 067 capability ledger. A plugin key stored on a role is "kept" (step 1) while the plugin is not installed, and "known" while it is.
4. **The Administrator role** gets every permission of a plugin when that plugin is installed or enabled, as it already holds every CE capability. Removing the plugin keeps the grants (kept). Other roles get nothing automatically.
5. **`patients.find`** is a new CE capability in the patients group: "Find a patient by an exact identifier, or by name with full birth date, at your own facilities." It is not in `LIMITED_SCOPE_DROPS`, so facility-limited users keep it. No preset gets it; the lab profile pack grants it. Through `ce_read`:
   - `patients.search` with `patients.find` (and without `patients.view`) is strong-match only: an exact identifier, or given and family name with a full birth date. Results are limited to the caller's facilities.
   - `patients.register` accepts either `patients.view` or `patients.find`.
   - `patients.get` with `patients.find` returns only a patient at the caller's facilities.
   - Results stay masked, as `patients.view` results are.
6. **`fhir_emit` from an action** needs the action's permission, like any other call (ruling 2). It still refuses facility-limited callers (step 2a).
7. **The plugin page** receives the caller's real capabilities in its init context, including the plugin's own permissions the caller holds. The page uses them only to show or hide its own tabs; the broker is the real gate.
8. **Sidebar and route.** The plugin's entry shows, and `/x/:pluginId` opens, only when the user holds any of `ui.requiredCapabilities`. A plugin with none stays open, as today. A profile layout may list `/x/<id>`; when a layout is active, a plugin entry shows only if the layout lists it. A start page of `/x/<id>` works when the entry is visible.

## Global constraints

- Worktree `.claude/worktrees/lab-module`, branch `feat/plugin-host-2b`, base `1ceecb0`. Anything that opens a database runs with `OPENLDR_SKIP_ENV_FILE=true` on its own data folder, or on a throwaway Postgres container on a free port (memory capped, removed after). Never use ports 3000, 5433, 3210, 3212, 3213, 3220, 54320, 54331, 54332 or 54340.
- No CE migration is needed unless a task says so. `patients.find` enters the 067 ledger at boot, like any new CE capability, and is granted to no preset.
- Bundles without `permissions` or `actionPermissions` stay byte-identical, so their signatures still verify.
- Studio rules from AGENTS.md section 5. Strings in en, fr and pt. No em dashes. No `Co-Authored-By` trailer.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue`, `pnpm turbo run typecheck --force --concurrency=2`, `pnpm --filter @openldr/server lint`. Never pipe turbo through `tail`.

## Review focus

1. A caller without the action's permission is refused, including through a crafted op that names an entrypoint not in `actionPermissions`. (Task 3)
2. A plugin cannot grant itself a CE capability. Declaring `forms.edit` as its own key is refused at install. Listing it in `actionPermissions` only requires it of callers. (Tasks 1 and 3)
3. Uninstalling a plugin leaves its role grants stored (kept), and roles holding them stay editable. Reinstalling restores them. (Task 2)
4. A facility-limited user with `patients.find` finds a patient at their facility by exact identifier, does not find one at another facility, and cannot browse by a partial name. (Task 4)
5. A user without the plugin's `ui.requiredCapabilities` neither sees the entry nor opens `/x/<id>` by typing it. (Task 5)

---

### Task 1: Manifest: permissions and actionPermissions

**Files:** `packages/marketplace/src/artifact-manifest.ts` (the payload fields, with cross-field rules: keys are unique, match the pattern and are not CE keys; `actionPermissions` entrypoints exist in `entrypoints`; listed keys are declared or CE keys); the consent screen lines in `apps/studio/src/pages/settings/marketplace/util.ts` and i18n; tests.

- [ ] **Tests:** each refusal in rulings 1 and 2, and a bundle without the fields unchanged byte for byte.
- [ ] **Implement,** then commit `feat(plugins): plugins declare permissions and the permission each action needs`.

### Task 2: The catalog provider and roles

**Files:**
- New `packages/bootstrap/src/capability-catalog.ts`: `createCapabilityCatalog(deps)` with `keys(): string[]`, `groups(): CapabilityGroup[]`, `isKnown(k)` and `pluginKeys(): string[]`.
- Wire it into `packages/db/src/role-store.ts` (`validateCaps`, `unlisted` and `diagnose` use the provider; the ledger stays static), `apps/server/src/roles-routes.ts` (`/api/roles/catalog`), `packages/cli/src/roles.ts`, and the profile pack role step (`packages/bootstrap/src/index.ts` ~1429).
- Install and enable grant plugin keys to `lab_admin` (ruling 4).
- An install whose keys collide with another plugin's is refused (ruling 1).
- Tests.

- [ ] **Tests:**
  - A plugin key is valid on a role while the plugin is installed.
  - After removal the key is kept and the role is still editable. After reinstall it is known again.
  - A key collision is refused.
  - The Roles catalog shows a group for the plugin.
  - The Administrator gets the keys at install.
  - `roles doctor` lists installed plugin keys as known, not kept.
  - The ledger never records plugin keys.
- [ ] **Implement,** then commit `feat(rbac): plugin permissions join the capability catalog while installed`.

### Task 3: The gate per action

**Files:** `packages/bootstrap/src/plugin-broker.ts` (`invoke`: rulings 2 and 6, checked after `uiAllows`, reading `actionPermissions` from the stored manifest row); tests.

- [ ] **Tests:**
  - Review focus 1 and 2.
  - A plugin without `actionPermissions` behaves exactly as before.
  - A facility-limited caller with the permission reaches the action, and its host functions still see only its facilities.
- [ ] **Implement,** then commit `feat(plugins): every plugin action checks the caller's permission`.

### Task 4: patients.find

**Files:** `packages/rbac/src/catalog.ts` (ruling 5's text in English, plus studio i18n labels in en, fr and pt for the Roles page); `packages/bootstrap/src/plugin-host.ts` (the `ce_read` patient ops); the patient search used there (a strong-match mode limited to facilities); tests.

- [ ] **Tests:**
  - Review focus 4.
  - A limited caller keeps `patients.find` after the data-limit drop.
  - `patients.register` works with `patients.find` alone.
  - Results are masked.
- [ ] **Implement,** then commit `feat(patients): patients.find, a strong-match lookup limited users keep`.

### Task 5: The plugin page and sidebar

**Files:** `apps/studio/src/plugins/PluginContainer.tsx` and `PluginFrame.tsx` (real capabilities in the init context); `apps/studio/src/shell/AppShell.tsx` (plugin entries filtered by capability and layout); `apps/studio/src/App.tsx` (`/x/:pluginId` gated by the plugin's `requiredCapabilities`); StartPageGate for `/x/<id>`; `GET /api/plugins/ui` returns `requiredCapabilities`; tests.

- [ ] **Tests:**
  - Review focus 5.
  - The init context carries the user's capabilities.
  - A layout that lists `/x/<id>` shows it, and one that doesn't hides it.
  - A start page of `/x/<id>` opens.
- [ ] **Implement,** then commit `feat(studio): plugin pages know the user and follow permissions and layouts`.

### Task 6: Docs and proof

- [ ] **Docs.** Web docs for plugin authors (en, fr, pt): `permissions`, `actionPermissions`, closed by default, Administrator grants, kept grants. In-app docs (en, fr, pt): the Roles guide on plugin permission groups and `patients.find`, and the Users guide on what a limited user keeps.
- [ ] **Integration test.** Extend `test-sink-host` (the 2a test plugin) with permissions and `actionPermissions`. Prove Review focus 1 to 4 through the broker, on a throwaway Postgres.
- [ ] **Gate:** both commands and server lint.
- [ ] **Proof install.** Install the test plugin, grant its permission to a role in the Roles page, and see the plugin's group there. A user without it does not see the plugin entry. Put screenshots on the screenshot Artifact page.
- [ ] **Commit** `test(plugins): prove plugin permissions end to end`. Merge only when the operator says so.

Order: 1, 2, 3, 4, 5, 6. Task 4 can follow Task 2 in either order with Task 3.
