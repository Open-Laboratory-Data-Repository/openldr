# Lab plugin step 1: CE works alone again

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CE's Lab order form enters results and rejections again, and the lab-only code built in slices 1a to 3 leaves CE core, while the general pieces and every stored role grant stay.

**Architecture:** One internal migration (141) puts the two form fields back by exact match and frees the Reception role. The role store learns to keep stored grants the catalog no longer lists, so roles stay editable and the future lab plugin picks its `lab.*` grants up under the same keys. Then the lab-only server, CLI, studio and docs code is removed. Its logic stays in git history (`28762d534`) for the plugin to port.

**Tech stack:** TypeScript, Kysely on Postgres, Fastify, React with shadcn, vitest, pg-mem.

**Spec:** `docs/superpowers/specs/2026-11-23-lab-plugin-design.md`, section 6.

## Rulings this plan makes

1. **Stored grants of unknown keys are kept on every role save.** `validateCaps` refuses keys not in the catalog (`packages/db/src/role-store.ts:78-81`) and `writeCaps` rewrites all rows (`:157-161`). Today a role holding `lab.*` could not be edited, and loosening the check alone would wipe the grants. A save validates only the keys it adds, and keeps stored keys the catalog does not list. Spec 5.4 needs this anyway, for when a plugin is removed.
2. **`roles doctor` reports such keys as "kept", not as an error.** It still lists them and exits 0. If wrong: a real stray key no longer fails the doctor.
3. **The Reception role becomes an ordinary role.** 141 sets `is_system = false` on slug `reception`, keeping its grants and users, so an admin can delete it. The lab profile pack makes its own later.
4. **The 137 columns `section` and `needs_review` stay in the database, unused.** Dropping them gains nothing, and the plugin keeps its own settings.
5. **The lab-section local-only sync guard stays** (`packages/db/src/terminology-sync.ts:15-30`, `packages/sync/src/terminology-sync.ts`), so central sync never overwrites a lab's sections.
6. **Seeded value sets from 137 and 140 stay**, as the spec says.
7. **`openldr lab requisitions rebuild` stays**, as part of the kept requisition lookup, now gated by `settings.danger_zone`.
8. **`labSpecimenId`, `ORDER_ORIGIN_SYSTEM`, `labTaskId` and `labRejectionObservationId` leave `@openldr/forms`.** Only lab-only code used them. `orderKey` and `labOrderId` stay. `LAB_TASK_SYSTEM` stays inside migration 140, which needs it.
9. **A Lab order form edited after 140 is left alone, with a warning.** 141 matches only the shape 140 left, as 138 and 140 did.

## Global constraints

- Worktree `.claude/worktrees/lab-module`, branch `feat/lab-plugin`, base `9cb1d50`. The worktree reads the dev `.env`. Anything that opens a database runs with `OPENLDR_SKIP_ENV_FILE=true` on its own data folder. Never use ports 3000, 5433, 3210, 3212, 3213, 3220, 54320, 54331, 54332 or 54340.
- Migration: internal `141_lab_order_form_results_back`. Latest today: internal 140, external 028. No unmerged branch adds a migration (checked 2026-11-23).
- KEEP, per spec 6.1: FHIR Task and Provenance; Specimen `condition`; ServiceRequest `requisition` and `replaces`; `FhirStore.correct`; the value set expand fix; critical limits on catalog ranges; one ServiceRequest per test with fixed ids; `OrderExists` and `holderOfOrder`; warehouse filter 028; requisition lookup 139 and its hooks; `warnBlockedSystemRoles` and the role-store `blocked` guard.
- No em dashes. No `Co-Authored-By` trailer. Studio rules from AGENTS.md section 5. Strings in en, fr and pt.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue`, `pnpm turbo run typecheck --force --concurrency=2`, `pnpm --filter @openldr/server lint`. Never pipe turbo through `tail`. Build both `pnpm turbo run build --filter=@openldr/standalone...` and `--filter=@openldr/studio`.

## Review focus

1. A role holding `lab.*` keys is edited, both by adding a capability in the Roles page and by `openldr roles grant`: the save succeeds and the `lab.*` rows are still there. (Task 1)
2. An admin tries to add an unknown key: still refused. (Task 1)
3. An install where the Lab order form was edited after 140: 141 leaves it alone and logs a warning, and a second run of `up()` changes nothing. (Task 2)
4. A user whose start page was `/reception`, or a Reception user, signs in: they land on a page that exists, not a blank route. (Task 4)
5. A docs link to the removed Reception guide: the docs page shows "not found", not a crash. (Task 5)

---

### Task 1: Roles keep grants the catalog no longer lists

**Files:**
- Modify: `packages/db/src/role-store.ts` (`validateCaps` 78-81, `writeCaps` 157-161, the update path, `diagnoseCapabilities` 393-431), `packages/cli/src/roles.ts` (doctor output and exit code, 221 and 242)
- Test: `packages/db/src/role-store.test.ts`, the CLI roles test

**Interfaces:**
- Produces: the `diagnoseCapabilities` result gains `kept: string[]` (stored keys not in the catalog), and `orphaned` no longer contains them.

- [ ] **Step 1: Write failing tests.**
  - A role with stored `forms.view` and `lab.receive` (inserted directly) is updated to add `reports.view`. Its rows are `forms.view`, `lab.receive`, `reports.view`.
  - The same role updated to remove `forms.view` keeps `lab.receive`.
  - An update that adds `bogus.key` is refused with the existing unknown-capability error.
  - `diagnoseCapabilities` lists `lab.receive` under `kept`. `roles doctor` prints it under a "kept" heading and exits 0.
- [ ] **Step 2: Run** `pnpm --filter @openldr/db test -- role-store` and the CLI roles test. See them fail.
- [ ] **Step 3: Implement.** Validate only keys the call adds that are not already stored. `writeCaps` writes the requested set plus the stored keys the catalog does not list.
- [ ] **Step 4: Run** the db and cli tests and typecheck. Expect pass.
- [ ] **Step 5: Commit** `fix(rbac): keep stored grants the catalog no longer lists`

### Task 2: Migration 141 and the Lab order form

**Files:**
- Create: `packages/db/src/migrations/internal/141_lab_order_form_results_back.ts` and its test; register it.
- Modify: `packages/forms/src/samples/forms.ts` (both fields back, original `order` values); `packages/forms/src/samples/starter-packs.ts` (`STARTER_PACK_VERSION = '8'`, the two RATIONALE lines back); `apps/studio/src/forms-builder/FieldEditorSheet.tsx` (`FIELD_TYPES = FieldType.options`); `apps/studio/src/forms-builder/newFormFields.ts` (remove `offeredFieldTypes`).
- Test: `forms.test.ts`, `starter-packs.test.ts`, `FieldEditorSheet.test.tsx`, `newFormFields.test.ts`.

**Interfaces:**
- 141 copies inline the field shapes it needs, as 138 and 140 do: the shape 140 left (`LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT`, `140_lab_rejection.ts:243`) and the shape before 138 (`LAB_ORDER_PREV_FIELDS_SNAPSHOT`, `138_lab_order_form_orders_only.ts:17`). Export the restored shape as `LAB_ORDER_FORM_MIGRATION_RESULTS_BACK` from the db package.

- [ ] **Step 1: Write failing tests (pg-mem, real migrations).**
  - After 141, the Lab order form's fields equal the pre-138 shape, with `fld-ord-results` and `fld-ord-rejection`.
  - A form edited after 140 is left alone, and a warning is logged.
  - A second `up()` changes nothing.
  - The `reception` role row has `is_system = false`, with its grants and user assignments unchanged.
  - `down()` undoes only what `up()` did.
  - The bundled sample form has both fields, the starter pack version is `'8'`, and the form builder offers the test details field again.
- [ ] **Step 2: Run** `pnpm --filter @openldr/db test -- 141` and the forms and studio tests named above. See them fail.
- [ ] **Step 3: Implement**, copying 140 for the marker, the exact match and the warning.
- [ ] **Step 4: Run** the same tests, and the db, forms and studio typecheck. Expect pass.
- [ ] **Step 5: Commit** `feat(forms): the Lab order form enters results and rejections again`

### Task 3: Lab-only server, bootstrap, rbac and CLI code leaves

**Files:**
- Delete: `apps/server/src/lab-routes.ts`; `packages/bootstrap/src/lab-reception.ts`, `lab-rejection.ts`, `lab-shared.ts`, `lab-sections.ts`; and their tests. In `packages/cli/src/lab.ts`, delete every command except `runLabRequisitionsRebuild`, and move that one to a file named for what it does, such as `requisitions.ts`.
- Modify:
  - `apps/server/src/app.ts` (17, 179).
  - `settings-routes.ts`: lab sections and self-authorise (5-6, 35-43, 96, 98-150).
  - `test-catalog-routes.ts`: section and needs review (20-24, 76-77, 181, 185-191). Keep critical limits (37, 57-58).
  - `test-helpers.ts`.
  - `packages/bootstrap/src/index.ts` (20-21, 92, 614-620, 1254, 1259-1269, 2264-2266, 2351, 2368-2369). Keep 86, 93, 1217, 1657-1666.
  - `test-catalog.ts`: section and needsReview. Keep 609-618.
  - `packages/config/src/lab-identity.ts` (161-173) and `packages/bootstrap/src/lab-identity.ts` (3, 17-20, 50-55).
  - `packages/rbac/src/catalog.ts` (84-91, 115).
  - `presets.ts`: drop the lab keys and the RECEPTION role. Put the descriptions back to their `bf93a4e` text, and the technician back to `['forms.view','forms.submit']`.
  - `data-scope.ts` (17-19, 28).
  - `packages/forms/src/extract/order-ids.ts` (ruling 8).
  - `packages/cli/src/program.ts` (52-55, 697-726) and `command-meta.ts` (305-315). Keep only `lab requisitions rebuild`, with capability `settings.danger_zone`.
- Test: update every test the inventory names:
  - rbac: catalog, presets, data-scope.
  - server: data-scope-auth, settings-routes, test-catalog-routes, roles-routes.
  - bootstrap: index, test-catalog, test-catalog-import.
  - config and bootstrap: lab-identity.
  - command-meta.
  - the migrations count.

- [ ] **Step 1: Delete and edit as listed.** Use `git show bf93a4e:<file>` as the reference for text that existed before slice 1a.
- [ ] **Step 2: Run** the server, bootstrap, db, rbac, config, forms and cli tests and typecheck, and server lint. Expect pass. Then grep for `lab-reception`, `lab-rejection`, `labReception`, `labRejection`, `labSections`, `LAB_ALLOW_SELF_AUTHORISE` and `'lab.receive'`, outside migrations, `docs/superpowers` and the changelog. Expect no hits.
- [ ] **Step 3: Commit** `refactor(lab): move the lab-only server code out of CE`

### Task 4: Lab-only studio code leaves

**Files:**
- Delete: `apps/studio/src/pages/Reception.tsx`, all of `apps/studio/src/lab/`, `apps/studio/src/pages/settings/LabSections.tsx`, and their tests.
- Modify:
  - `App.tsx` (14, 62). Put 88 back to `cap="settings.view"`.
  - `shell/AppShell.tsx` (5, 44).
  - `shell/UserPreferencesSync.tsx` (78-89, 94). Put 121 back to `shown.find((n) => n.to !== '/')?.to`.
  - `pages/settings/Laboratory.tsx`: back to its `bf93a4e` version.
  - `settingsNav.ts`: 12-14 back to `settings.view`.
  - `test-catalog/TestSheet.tsx`: section and needs review. Keep critical limits (446-457).
  - `pages/TestCatalog.tsx` (34).
  - `api.ts` (501-502, 521-544, 3906-4040, 2674-2676, 2704-2707, 2718-2719). Keep 2905-2909.
  - `i18n/en.ts`, `fr.ts`, `pt.ts`: the keys the inventory lists. Keep the critical-limit strings.
- Test: `UserPreferencesSync.test.tsx` (drop the reception cases, add Review focus 4), `Laboratory.test.tsx`, `TestSheet.test.tsx`, `TestCatalog.test.tsx`, the i18n parity test.

- [ ] **Step 1: Write the Review focus 4 test:** a stored start page `/reception` resolves to the first page the user can open.
- [ ] **Step 2: Delete and edit as listed.**
- [ ] **Step 3: Run** the studio tests and typecheck. Expect pass. A grep for `reception` in `apps/studio/src`, outside docs, returns only the Lab order form's own words, if any.
- [ ] **Step 4: Commit** `refactor(studio): move the Reception desk out of CE`

### Task 5: Docs

**Files:**
- Delete: in-app `reception.md` in en, fr and pt, and its entry in `apps/studio/src/docs/registry.ts`.
- Modify: in-app `lab-setup.md`, `laboratory.md`, `roles.md`, `users.md`, `forms.md` and `test-catalog.md` (en, fr, pt), and `registry.ts` 448-475; web `cli.md` and `lab-setup.md` (en, fr, pt), and `apps/web/src/docs/content.ts:78`.

The guides describe CE as it now is:
- The Lab order form enters results and rejections.
- There is no Reception page, no lab sections, no self-authorise and no `lab.*` capabilities.
- `openldr lab requisitions rebuild` stays.
- One sentence in `lab-setup.md` says a lab plugin is planned for reception and result review.

Follow `HOW-TO-TEMPLATE.md`, and quote labels from the i18n files.

- [ ] **Step 1: Write the Review focus 5 test:** an unknown guide slug renders the docs not-found state.
- [ ] **Step 2: Edit the pages.**
- [ ] **Step 3: Run** the studio and web docs tests. Expect pass.
- [ ] **Step 4: Commit** `docs: CE without the Reception desk`

### Task 6: Proof and gate

- [ ] **Step 1: Run** both gate commands and server lint. Grep for `out of memory`, `VirtualAlloc` and `Test timed out` before reading a failure as a regression.
- [ ] **Step 2: Real Postgres, clean install,** on its own data folder and ports with `OPENLDR_SKIP_ENV_FILE=true`:
  - 141 applies.
  - The Lab order form shows Results and Order rejection.
  - A 2-test order with results saves and reaches `lab_requests` and `lab_results`.
  - There is no Reception page, and every `/api/lab/*` route answers 404.
- [ ] **Step 3: Existing install with lab data.** Copy a stopped slice 3 proof install. Before its first start, disable its stored connector with Postgres started alone. On this build:
  - 141 applies.
  - Lab Manager is edited in the Roles page and keeps its `lab.*` rows.
  - `openldr roles doctor` exits 0 and lists them as kept.
  - The Reception role can be deleted.
  - The old orders still show in the Lab order form's entries.
- [ ] **Step 4: Look at it.** Capture the Lab order form with results, at desktop and 375 wide, and the Roles page. Send the screenshots.
- [ ] **Step 5: Report** every ruling with its cost if wrong. Merge only when the operator says so, then run `pnpm make:changelog`, then rebuild and restart 3220.

Order: 1, 2, 3, 4, 5, 6. Task 1 must land before Task 3.
