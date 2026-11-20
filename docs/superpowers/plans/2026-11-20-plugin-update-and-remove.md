# Plugin update, and a remove that stops its work: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installed plugin offers its newer Marketplace version, and Remove stops the plugin's running reads and checks, then deletes only what the person chose.

**Architecture:** Update is studio only: the server's install route already makes a newer version the active one (`packages/plugins/src/runtime.ts` install). Remove gets one shared module in `@openldr/bootstrap` (`plugin-removal.ts`) with `plan` and `remove`; a new pair of routes and the existing CLI `plugin remove` both call it.

**Tech Stack:** TypeScript, Fastify, Kysely, React with shadcn, Vitest, pg-mem.

**Spec:** `docs/superpowers/specs/2026-11-20-plugin-update-and-remove-design.md`

## Global Constraints

- Removing a plugin never leaves its work running. It stops it first.
- Choices: `all` (default), `settings`, `nothing`. Saved records in OpenLDR are never deleted.
- Studio: sheet, not dialog; actions in a `⋯` `DropdownMenu`; label left, input right; shadcn only; en, fr, pt strings (AGENTS.md section 5).
- CLI: refuses without `--force` when anything is running or anything would be deleted; audits as `actorName: 'cli'`.
- Never `h-screen`; check at 375 wide.

## Review Focus

1. A copy that does not reach `stopped` within the wait (a page mid-read over a slow link): remove must not go on; it says what is still stopping and removes nothing. Test in Task 3.
2. A check running on a copy: the check is stopped before the copy, since `remove` of a copy with a live check refuses (`import-copy.ts:1119-1122`). Test in Task 3.
3. `nothing` while copies are `deleting`: the plugin's other `plugin_data` goes, but `__import-copies` records stay for their drives to finish (`import-copy.ts:908`). Test in Task 3.
4. Removing one older, inactive version (`DELETE /api/marketplace/:id?version=`) keeps working as today and stops nothing. Test in Task 4.
5. A plugin rolled back to an older version: the card shows the quiet "X available", not "Update to X". Test in Task 1.

---

### Task 1: Update on the card and in the menu

**Files:**
- Modify: `apps/studio/src/pages/settings/marketplace/util.ts` (add `newerAvailable`)
- Modify: `apps/studio/src/pages/settings/marketplace/PackageCard.tsx`, `PackageDetail.tsx`, `MarketplaceTabs.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (`settings.marketplace.updateTo`, `settings.marketplace.updateAvailable`)
- Test: `util.test.ts`, `PackageCard.test.tsx`, `PackageDetail.test.tsx` beside them

**Interfaces:**
- Produces: `newerAvailable(entry: CardEntry, available: AvailableArtifact[], installedVersions: string[]): { version: string; ref: string; rolledBack: boolean } | null`. Newest Marketplace version of `entry.id` above the active version by `compareVersions`. `rolledBack` is true when a version above the active one is already installed.
- `CardEntry` gains `update?: { version: string; ref: string; rolledBack: boolean } | null`.

- [ ] **Step 1: Failing tests.** `newerAvailable` returns 0.1.5 for active 0.1.4 with 0.1.5 listed; null when the active is newest; `rolledBack: true` when 0.1.5 is installed but 0.1.4 is active. PackageCard shows "Update to 0.1.5" when `update` is set and not rolled back, "0.1.5 available" when rolled back, "Active" otherwise. PackageDetail's menu has `detail-update` labelled "Update to 0.1.5" for an installed plugin with `update`, and selecting it calls `onInstall` with `ref` = the 0.1.5 ref and `version` 0.1.5.
- [ ] **Step 2:** Run `pnpm --filter @openldr/studio exec vitest run src/pages/settings/marketplace`. Expected: the new cases fail.
- [ ] **Step 3:** Implement. `MarketplaceTabs` sets `update` on each entry. The detail menu item reuses the existing install consent path.
- [ ] **Step 4:** Same command. Expected: pass.
- [ ] **Step 5:** Commit `feat(studio): an installed plugin offers its newer Marketplace version`.

### Task 2: Installed versions in the detail view

**Files:** `PackageDetail.tsx`, its test, i18n en/fr/pt (`settings.marketplace.installedVersions`, `settings.marketplace.activeVersion`).

**Interfaces:** Consumes `props.installed` filtered to the entry's id. Produces nothing new.

- [ ] **Step 1: Failing test.** With 0.1.4 (active) and 0.1.5 installed, the detail side panel lists both under "Installed versions", 0.1.4 marked "active", newest first.
- [ ] **Step 2:** Run the marketplace tests. Expected: fail.
- [ ] **Step 3:** Implement the list in the existing details `dl`.
- [ ] **Step 4:** Run. Expected: pass.
- [ ] **Step 5:** Commit `feat(studio): the plugin detail lists its installed versions`.

### Task 3: The removal module

**Files:**
- Create: `packages/bootstrap/src/plugin-removal.ts`, `packages/bootstrap/src/plugin-removal.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (wire `pluginRemoval` into the context)
- Modify: the `plugin_data` store (`packages/plugins/src/` data store) to add `deleteAllExcept(pluginId: string, keepCollections: string[]): Promise<number>`

**Interfaces:**
- Produces:
  - `type RemoveKeep = 'all' | 'settings' | 'nothing'`
  - `interface RemovalPlan { running: Array<{ kind: 'copy' | 'check'; id: string; label: string; status: string }>; copies: number; copiedBytes: number }`
  - `createPluginRemoval(deps: { plugins: PluginRuntime; importCopies: ImportCopyService; importChecks: ImportCheckService; pluginData: PluginDataStore; audit?: AuditSink; sleep?: (ms: number) => Promise<void>; now?: () => Date })` returning `{ plan(pluginId: string): Promise<RemovalPlan>; remove(pluginId: string, o: { keep: RemoveKeep; actor: ImportActor; waitMs?: number }): Promise<{ stopped: string[]; deletedCopies: number }> }`.
- Order inside `remove`: stop running checks, then running copies; poll `get` once a second until each is terminal, up to `waitMs` (default 120000); on timeout throw `PluginStillStopping` naming the ids and change nothing more. Then for `settings` and `nothing`, `importCopies.remove` each copy. For `nothing`, `pluginData.deleteAllExcept(pluginId, ['__import-copies'])`. Then `plugins.remove(pluginId)`. One audit `marketplace.remove` with `metadata: { keep, stopped, deletedCopies }`.

- [ ] **Step 1: Failing tests (pg-mem, fake drives).** (a) `plan` lists a running copy and its running check with `copiedBytes` = sum of set bytes. (b) `remove` with `keep: 'all'` stops both, check first, waits, removes the plugin row, leaves the copy and its rows. (c) `keep: 'settings'` marks every copy `deleting` and keeps `__import-allowed`. (d) `keep: 'nothing'` also empties every other collection and keeps `__import-copies`. (e) A copy stuck in `stopping` past `waitMs: 50` throws `PluginStillStopping` and the plugin row is still there. (f) No saved FHIR rows change in any case.
- [ ] **Step 2:** Run `pnpm --filter @openldr/bootstrap exec vitest run src/plugin-removal.test.ts`. Expected: fail, module missing.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: pass.
- [ ] **Step 5:** Commit `feat(bootstrap): removing a plugin stops its reads and checks, then keeps what was chosen`.

### Task 4: Routes

**Files:** `apps/server/src/marketplace-routes.ts`, its test.

**Interfaces:**
- `GET /api/marketplace/:id/removal` (MANAGE) returns `RemovalPlan`.
- `POST /api/marketplace/:id/remove` (MANAGE) body `{ keep: RemoveKeep }`; 400 on a bad `keep`; 409 `{ error, stillStopping: string[] }` on `PluginStillStopping`; 200 `{ stopped, deletedCopies }`. Return or await `reply.send` per the server lint.
- `DELETE /api/marketplace/:id` without `version` now goes through `remove` with `keep: 'all'`; with `version` it removes that version only, as today.

- [ ] **Step 1: Failing route tests** for each status above, and for `DELETE ?version=0.1.4` leaving a running copy untouched.
- [ ] **Step 2:** Run `pnpm --filter @openldr/server exec vitest run src/marketplace-routes.test.ts`. Expected: fail.
- [ ] **Step 3:** Implement; then `pnpm --filter @openldr/server lint`.
- [ ] **Step 4:** Run both. Expected: pass.
- [ ] **Step 5:** Commit `feat(server): routes to plan and carry out a plugin removal`.

### Task 5: The Remove sheet

**Files:** Create `apps/studio/src/pages/settings/marketplace/RemovePluginSheet.tsx` and its test; modify `PackageDetail.tsx` (its Remove item opens the sheet for a plugin), `apps/studio/src/api.ts` (`getRemovalPlan`, `removePlugin`), i18n en/fr/pt. Copy `forms-builder/FieldEditorSheet.tsx`.

**Interfaces:** Consumes Task 4's routes.

- [ ] **Step 1: Failing tests.** The sheet lists running reads and checks with "Removing stops these"; three choices with their good and cost lines, `all` chosen; `copiedBytes` shown as size; the sentence that saved records are kept; the ⋯ menu's "Remove" posts the chosen `keep`; a 409 shows which reads are still stopping and keeps the sheet open.
- [ ] **Step 2:** Run the marketplace tests. Expected: fail.
- [ ] **Step 3:** Implement. Choices as a shadcn radio group (build `components/ui/radio-group.tsx` in the Radix pattern if missing).
- [ ] **Step 4:** Run, plus `pnpm --filter @openldr/studio typecheck`. Expected: pass.
- [ ] **Step 5:** Commit `feat(studio): Remove stops a plugin's work and asks what to keep`.

### Task 6: CLI

**Files:** `packages/cli/src/program.ts` (`plugin remove`), its test.

- [ ] **Step 1: Failing tests.** `plugin remove cdr-source` with a running copy and no `--force` exits 1 naming the copy; `--keep settings` without `--force` refuses (it would delete); `--force --keep all` stops and removes; `--keep bogus` is refused; audit actor `cli`.
- [ ] **Step 2:** Run `pnpm --filter @openldr/cli exec vitest run`. Expected: fail.
- [ ] **Step 3:** Implement on `pluginRemoval`.
- [ ] **Step 4:** Run. Expected: pass.
- [ ] **Step 5:** Commit `feat(cli): plugin remove stops running work and takes --keep`.

### Task 7: Docs, gate and live proof

- [ ] **Step 1:** Marketplace how-to in `apps/studio/src/docs/0.1.8/{en,fr,pt}`: updating a plugin, rolling back, removing and the three choices. `CLI-REFERENCE.md` for `plugin remove`.
- [ ] **Step 2:** Gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Expected: green, or only known timeouts re-run alone.
- [ ] **Step 3:** Live on the rc.1 Docker install rebuilt from the branch: install cdr-source 0.1.4 file, see "Update to 0.1.5", update; start a read, Remove with `settings`, confirm the read stopped and its rows went, connector access kept. Screenshots at 1280 and 375.
- [ ] **Step 4:** Commit docs; after merge, `pnpm make:changelog` and commit.
