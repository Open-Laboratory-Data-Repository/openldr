# Profile packs implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A content pack can create a role, a layout and forms, and name the bundles it needs, so one install sets up a job such as a collection site.

**Architecture:** Four step kinds join the content pack format. One new table records which pack made which role, layout or form. The existing installer checks every step before it writes, then runs the steps in order. Detaching a pack takes out the roles and layouts it made.

**Tech stack:** TypeScript, zod, Kysely on Postgres, Fastify, React with shadcn, vitest, pg-mem.

**Spec:** `docs/superpowers/specs/2026-11-22-profile-packs-design.md`. Read it before any task.

## Global constraints

- Work on branch `feat/profile-packs`. A worktree reads the dev `.env`, so tests must not point at the dev databases.
- `formatVersion` stays 1. An older CE refuses an unknown step kind already (`packages/marketplace/src/content-pack.ts:79`).
- A pack never changes a role, layout or form it does not own.
- A pack's layout and forms may name only roles an earlier step of the same pack creates.
- Capabilities are the lock. Do not add a second permission check.
- No clinical vocabulary in the core. Forms and codes live in the pack repo.
- Studio: actions in a dots menu, sheets not dialogs except a destructive confirm, shadcn only, label left and input right, `TablePagination` on every table.
- Every user-facing string in en, fr and pt.
- No em dashes in anything written. No `Co-Authored-By` trailer.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`.
- Check unmerged branches before claiming migration 135. Latest on `main` is 134.

## Review focus

1. A step fails after a role step wrote, then the admin installs again. The second run updates the same role. No duplicate. (Task 4)
2. The pack's role slug or layout name belongs to something an admin made. The check refuses and nothing is written. (Task 3)
3. The installer lacks a capability the pack's role grants. The check refuses and names the capability. (Task 3)
4. A newer version drops a role that a user still holds. The check refuses before any step writes. (Task 3)
5. A pack with none of the new steps detaches exactly as it does today. (Task 5)

---

## File map

| File | Responsibility |
|---|---|
| `packages/marketplace/src/content-pack.ts` | The four step schemas and their summary lines |
| `packages/db/src/migrations/internal/135_content_pack_items.ts` | Table of what each pack made |
| `packages/db/src/pack-item-store.ts` | Read and write that table |
| `packages/bootstrap/src/content-pack-profile.ts` | Check, write and remove logic for the four steps |
| `packages/bootstrap/src/content-pack-install.ts` | Calls the profile logic from `verify`, `runStep` and `detach` |
| `packages/bootstrap/src/index.ts` | Wires the new dependencies |
| `apps/server/src/marketplace-routes.ts` | Install gate, caller capabilities, detach refusal |
| `packages/cli/src/market.ts`, `program.ts` | Pack removal from the CLI |
| `apps/studio/src/pages/settings/marketplace/*`, `Layouts.tsx`, `pages/Roles.tsx` | Summary lines, owner label, Remove |

---

### Task 1: Step kinds in the pack format

**Files:**
- Modify: `packages/marketplace/src/content-pack.ts`
- Test: `packages/marketplace/src/content-pack.test.ts`

**Interfaces:**
- Produces: step shapes below, exported `PACK_ITEM_KEY`, and `summarizeContentPack` lines for each.

```ts
export const PACK_ITEM_KEY = /^[a-z][a-z0-9-]{1,47}$/;
{ kind: 'needs',  bundles: { id: string; version: string }[] }            // min 1, version is a range for isCompatible
{ kind: 'role',   slug: string; name: string; description?: string; capabilities: string[] }  // slug matches PACK_ITEM_KEY, capabilities min 1
{ kind: 'layout', key: string; name: string; startPage: string | null; pages: string[]; roles: string[] }
{ kind: 'form',   key: string; questionnaire: { resourceType: 'Questionnaire' } & Record<string, unknown>; open: string[]; submit: string[] }
```

Summary lines: `needs` gives label = ids joined by `, `, count = bundles. `role` gives label = name, count = capabilities. `layout` gives label = name, count = pages. `form` gives label = `questionnaire.title` or the key, count 1.

- [ ] **Step 1: Write failing tests**

```ts
it('parses the four profile steps', () => {
  const pack = parseContentPack({ formatVersion: 1, steps: [
    { kind: 'needs', bundles: [{ id: 'sample-tracking', version: '>=0.1.0' }] },
    { kind: 'role', slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view', 'forms.submit', 'patients.view'] },
    { kind: 'layout', key: 'collection-site', name: 'Collection site', startPage: '/forms', pages: ['/forms', '/patients', '/docs'], roles: ['sample-clerk'] },
    { kind: 'form', key: 'lab-request', questionnaire: { resourceType: 'Questionnaire', title: 'Lab request' }, open: ['sample-clerk'], submit: ['sample-clerk'] },
  ] });
  expect(summarizeContentPack(pack)).toEqual([
    { kind: 'needs', label: 'sample-tracking', count: 1 },
    { kind: 'role', label: 'Sample Clerk', count: 3 },
    { kind: 'layout', label: 'Collection site', count: 3 },
    { kind: 'form', label: 'Lab request', count: 1 },
  ]);
});
it('refuses a role with no capabilities', () => {
  expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'role', slug: 'x-role', name: 'X', capabilities: [] }] })).toThrow(/invalid pack/);
});
it('refuses two steps with the same kind and key', () => {
  const layout = { kind: 'layout', key: 'a-b', name: 'A', startPage: null, pages: ['/forms'], roles: [] };
  expect(() => parseContentPack({ formatVersion: 1, steps: [layout, { ...layout, name: 'B' }] })).toThrow(/listed twice/);
});
```

- [ ] **Step 2: Run** `pnpm --filter @openldr/marketplace test -- content-pack` and see the three fail.
- [ ] **Step 3: Add the kinds to `KINDS`, the schemas to `stepSchema`, the duplicate check to the `superRefine` on `steps`, and the four cases to `summarizeContentPack`.** A role's key is its slug.
- [ ] **Step 4: Run the same command.** Expect all pass.
- [ ] **Step 5: Commit** `feat(marketplace): a content pack can carry needs, role, layout and form steps`

### Task 2: Table of what each pack made

**Files:**
- Create: `packages/db/src/migrations/internal/135_content_pack_items.ts`, `packages/db/src/pack-item-store.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/pack-item-store.test.ts`

**Interfaces:**
- Produces:

```ts
export type PackItemKind = 'role' | 'layout' | 'form';
export interface PackItem { packId: string; kind: PackItemKind; key: string; itemId: string }
export interface PackItemStore {
  list(packId: string): Promise<PackItem[]>;              // ordered by kind, key
  owners(kind: PackItemKind): Promise<Map<string, string>>; // itemId to packId
  put(item: PackItem): Promise<void>;                      // upsert on (packId, kind, key)
  remove(packId: string, kind: PackItemKind, key: string): Promise<void>;
}
export function createPackItemStore(db: Kysely<InternalSchema>): PackItemStore;
```

Table `content_pack_items`: `pack_id text`, `kind text`, `key text`, `item_id text`, all not null. Primary key `(pack_id, kind, key)`. Unique `(kind, item_id)`.

- [ ] **Step 1: Write failing tests:** `put` then `list` returns the item; a second `put` with the same key and a new `itemId` replaces it; `owners('role')` maps the item id to the pack id; `remove` deletes one row only.
- [ ] **Step 2: Run** `pnpm --filter @openldr/db test -- pack-item-store` and see them fail.
- [ ] **Step 3: Write the migration, register it as `135_content_pack_items` in `index.ts`, add the table type, write the store, export it.** Follow `114_layout_presets.ts` for the migration style.
- [ ] **Step 4: Run the same command, then** `pnpm --filter @openldr/db test -- registration`. Expect all pass.
- [ ] **Step 5: Commit** `feat(db): record which content pack made a role, layout or form`

### Task 3: Check phase for the new steps

**Files:**
- Create: `packages/bootstrap/src/content-pack-profile.ts`
- Modify: `packages/bootstrap/src/content-pack-install.ts` (`ContentPackDeps`, `ContentPackInstallOptions`, `verify`)
- Test: `packages/bootstrap/src/content-pack-profile.test.ts`

**Interfaces:**
- Consumes: Task 1 step shapes, Task 2 `PackItemStore`.
- Produces:

```ts
export interface ProfileDeps {
  packItems: PackItemStore;
  roles: Pick<RoleStore, 'get' | 'getBySlug' | 'create' | 'update' | 'remove'>;
  /** Display names of the users who hold a role. */
  roleMembers(roleId: string): Promise<string[]>;
  layouts: {
    list(): Promise<LayoutList>;
    save(id: string | null, input: LayoutInput, actor: string | null): Promise<LayoutPreset>;
    remove(id: string): Promise<LayoutPreset>;
  };
  forms: {
    /** Create (formId null) or update a form from a Questionnaire, publish it, return its id. */
    install(formId: string | null, questionnaire: unknown, versionLabel: string, actorId: string | null): Promise<string>;
    /** Throws when the Questionnaire would not load. Writes nothing. */
    check(questionnaire: unknown): void;
    setAccess(formId: string, access: { open: string[]; submit: string[] }): Promise<void>; // role slugs
  };
  /** Installed version of a plugin or content pack, or null. */
  installedVersion(bundleId: string): Promise<string | null>;
  capabilityKeys: readonly string[];
}
export type InstallerCapabilities = readonly string[] | 'all';
export class PackRemovalError extends Error { constructor(readonly holders: { role: string; users: string[] }[]) }
/** Throws on the first problem. Writes nothing. */
export async function checkProfileSteps(deps: ProfileDeps, packId: string, steps: ContentPackStep[], caps: InstallerCapabilities): Promise<void>;
```

`ContentPackDeps` gains `profile: ProfileDeps`. `ContentPackInstallOptions.actor` gains `capabilities?: InstallerCapabilities`, absent meaning `'all'` so current callers and tests keep working. `verify` calls `checkProfileSteps` once after its own loop.

Rules, each with the exact message:

| Condition | Message |
|---|---|
| A needed bundle is not installed | `this pack needs <id> <range>, which is not installed` |
| Installed but outside the range | `this pack needs <id> <range>; <version> is installed` |
| Pack has a role step and caps lack `roles.manage` | `installing this pack needs the roles.manage capability` |
| Role capability not in `capabilityKeys` | `unknown capability: <key>` |
| Role capability the installer lacks | `you cannot install a role that grants <key>, because you do not hold it` |
| Role slug exists and this pack does not own it | `a role with the slug <slug> already exists and this pack did not make it` |
| Layout name exists and this pack does not own it | `a layout named <name> already exists and this pack did not make it` |
| Layout or form names a role no earlier step creates | `step <n> names the role <slug>, which no earlier step of this pack creates` |
| Layout fails `layoutInputSchema` | the schema's first issue message |
| Owned role is absent from the new steps and has members | throw `PackRemovalError` |

- [ ] **Step 1: Write one failing test per row of the table,** against in-memory fakes of `ProfileDeps`. Add a passing case: the collection site steps from Task 1 with `caps: 'all'` resolve.
- [ ] **Step 2: Run** `pnpm --filter @openldr/bootstrap test -- content-pack-profile` and see them fail.
- [ ] **Step 3: Implement `checkProfileSteps` and call it from `verify`.**
- [ ] **Step 4: Run the same command and** `pnpm --filter @openldr/bootstrap test -- content-pack-install`. Expect all pass.
- [ ] **Step 5: Commit** `feat(bootstrap): check a pack's needs, role, layout and form steps before writing`

### Task 4: Write phase for the new steps

**Files:**
- Modify: `packages/bootstrap/src/content-pack-profile.ts`, `packages/bootstrap/src/content-pack-install.ts` (`runStep`, `install`)
- Test: `packages/bootstrap/src/content-pack-profile.test.ts`

**Interfaces:**
- Produces:

```ts
/** Runs one role, layout or form step. Safe to run again. Returns what to audit. A needs step writes nothing. */
export async function runProfileStep(
  deps: ProfileDeps, packId: string, version: string, step: ContentPackStep, actorId: string | null,
): Promise<{ action: 'role.create' | 'role.update' | 'layout.create' | 'layout.update' | 'form.install'; entityType: 'role' | 'layout' | 'form'; entityId: string } | null>;
/** After every step succeeded: remove roles and layouts the pack owns that the new steps leave out. Forms it leaves out lose their owner and stay. */
export async function dropLeftOut(deps: ProfileDeps, packId: string, steps: ContentPackStep[]): Promise<void>;
```

Each step looks up `(packId, kind, key)` in `packItems`. Found means update that item. Not found means create it, then `put` the row. A found row whose item no longer exists is treated as not found. A form step calls `forms.install`, then `forms.setAccess` with the step's slugs. `runStep` records the audit row with `metadata: source`, like the existing cases. `install` calls `dropLeftOut` only when no step failed.

- [ ] **Step 1: Write failing tests:**
  - a role step creates the role and records ownership;
  - the same step run twice leaves one role, updated (Review focus 1);
  - a form step fails after a role step wrote, then a second full run succeeds with one role;
  - a layout step saves with `roles` set to the pack's slugs;
  - a form step sets access to the given slugs;
  - `dropLeftOut` deletes an owned layout the new steps omit and keeps an omitted form.
- [ ] **Step 2: Run** `pnpm --filter @openldr/bootstrap test -- content-pack-profile` and see them fail.
- [ ] **Step 3: Implement both functions and wire them into `runStep` and `install`.**
- [ ] **Step 4: Run the same command.** Expect all pass.
- [ ] **Step 5: Commit** `feat(bootstrap): a content pack creates its role, layout and forms`

### Task 5: Detach takes out the pack's roles and layouts

**Files:**
- Modify: `packages/bootstrap/src/content-pack-profile.ts`, `packages/bootstrap/src/content-pack-install.ts` (`detach`)
- Test: `packages/bootstrap/src/content-pack-profile.test.ts`, `packages/bootstrap/src/content-pack-install.test.ts`

**Interfaces:**
- Produces:

```ts
/** Throws PackRemovalError when a user holds one of the pack's roles. Otherwise deletes its layouts, then its roles, and forgets its forms. */
export async function removeProfileItems(deps: ProfileDeps, packId: string): Promise<{ roles: string[]; layouts: string[]; formsKept: string[] }>;
/** What detach would do, for the confirm prompt. Writes nothing. */
export async function previewRemoval(deps: ProfileDeps, packId: string): Promise<{ roles: string[]; layouts: string[]; formsKept: string[]; holders: { role: string; users: string[] }[] }>;
```

`detach` calls `removeProfileItems` before `installStore.remove`. The installer returns `previewRemoval` as a new method `removal(artifactId)`. The audit row's metadata gains the three lists.

- [ ] **Step 1: Write failing tests:** a held role makes detach throw `PackRemovalError` and deletes nothing; with no holder, layouts and roles go and the form stays published; a pack with no rows in `content_pack_items` detaches as before (Review focus 5).
- [ ] **Step 2: Run** `pnpm --filter @openldr/bootstrap test -- content-pack` and see them fail.
- [ ] **Step 3: Implement and wire.**
- [ ] **Step 4: Run the same command.** Expect all pass.
- [ ] **Step 5: Commit** `feat(bootstrap): detaching a content pack removes the roles and layouts it made`

### Task 6: Wiring and server routes

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (near line 1319), `apps/server/src/marketplace-routes.ts`, `apps/server/src/roles-routes.ts`, the layouts route file
- Test: `apps/server/src/marketplace-routes.test.ts`, the roles and layouts route tests

**Interfaces:**
- Consumes: `ProfileDeps`, `removal`, `PackRemovalError`.
- Produces on the wire:
  - `POST /api/marketplace/install` passes the caller's capabilities to the installer.
  - `GET /api/marketplace/:id/removal` returns `{ roles, layouts, formsKept, holders }` for a pack id.
  - `POST /api/marketplace/:id/detach` returns 409 `{ error, holders }` on `PackRemovalError`.
  - `GET /api/roles` and `GET /api/layouts` add `ownerPack: string | null` to each item.

Wire `ProfileDeps` in `index.ts`: `roles` from the role store, `layouts` from `listLayouts`, `saveLayout`, `deleteLayout`, `forms.install` from the same form store calls `form-artifact-install.ts:48` to `:66` uses, `forms.setAccess` from `setFormAccess` (`form-access.ts:45`), `installedVersion` from the plugin store and the install store, `capabilityKeys` from `CAPABILITY_KEYS`.

- [ ] **Step 1: Write failing route tests:** install of a role pack by a caller without `roles.manage` gives 400 with the Task 3 message; detach with a holder gives 409 and the holder list; `GET /api/roles` shows `ownerPack` for a pack role and null for a hand-made one.
- [ ] **Step 2: Run** `pnpm --filter @openldr/server test -- marketplace-routes roles-routes` and see them fail.
- [ ] **Step 3: Wire and implement.** Keep `return` on every `reply.send` path, as the server lint requires.
- [ ] **Step 4: Run the same command and** `pnpm --filter @openldr/server lint`. Expect all pass.
- [ ] **Step 5: Commit** `feat(server): install and detach routes for packs that carry a role`

### Task 7: CLI

**Files:**
- Modify: `packages/cli/src/market.ts`, `packages/cli/src/program.ts` (the `remove <id> [version]` command near line 1697), `docs/CLI-REFERENCE.md`
- Test: `packages/cli/src/market.test.ts`

**Interfaces:**
- Produces: `openldr market remove <id> --force` detaches a content pack. Without `--force` it prints what `removal` returns and exits 1. In served mode `market install` passes the signed-in caller's capabilities; a local run passes `'all'`. Audit through `cliActor()`.

- [ ] **Step 1: Write failing tests:** remove of a pack id without `--force` exits 1 and lists the roles and layouts; with `--force` it detaches; a held role exits 1 and names the users.
- [ ] **Step 2: Run** `pnpm --filter @openldr/cli test -- market` and see them fail.
- [ ] **Step 3: Implement.** The pack branch comes before the plugin branch, chosen by whether the id is in `marketplacePacks.list()`.
- [ ] **Step 4: Run the same command.** Expect all pass.
- [ ] **Step 5: Commit** `feat(cli): market remove detaches a content pack`

### Task 8: Studio

**Files:**
- Modify: `apps/studio/src/api.ts`, `apps/studio/src/pages/settings/marketplace/PayloadPreview.tsx`, `PackageDetail.tsx`, `apps/studio/src/pages/settings/Layouts.tsx`, `apps/studio/src/pages/Roles.tsx`, `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Create: `apps/studio/src/pages/settings/marketplace/RemovePackDialog.tsx`
- Test: the matching `.test.tsx` files

**Interfaces:**
- Consumes: the wire shapes of Task 6.

What to build:
- `PayloadPreview` shows a line for each new step kind, as in spec section 5.4. A role line expands to list every capability by its catalog label.
- `PackageDetail` for an installed pack gets "Remove" in its dots menu. Copy `RemovePluginSheet.tsx` for the data flow. The prompt is a `Dialog` because it is a destructive confirm. It lists the roles and layouts that go and the forms that stay. With holders it shows them and disables the confirm button.
- `Roles.tsx` and `Layouts.tsx` show the owning pack's id under the name when `ownerPack` is set.

- [ ] **Step 1: Write failing tests:** the preview renders the four lines for the collection site steps; the dialog disables confirm when holders exist; a role row shows its owner.
- [ ] **Step 2: Run** `pnpm --filter @openldr/studio test -- PayloadPreview RemovePackDialog Roles Layouts` and see them fail.
- [ ] **Step 3: Implement, with every string in the three language files.**
- [ ] **Step 4: Run the same command.** Expect all pass.
- [ ] **Step 5: Look at it.** Start the dev server with the preview tool. Check the install summary and the dialog at desktop width and at 375 by 812. Send the operator both screenshots.
- [ ] **Step 6: Commit** `feat(studio): show what a profile pack installs, and remove it`

### Task 9: Docs

**Files:**
- Create: an in-app guide in `apps/studio/src/docs/<current version>/{en,fr,pt}/profile-packs.md`, following `apps/studio/src/docs/HOW-TO-TEMPLATE.md`; a web doc in `apps/web/src/docs/<current version>/{en,fr,pt}/profile-packs.md`
- Modify: `apps/studio/src/docs/registry.ts` and the web docs index, to list them

The in-app guide covers installing a profile, what the summary lines mean, and removing one. The web doc covers what a profile is and how to write the four steps, with the collection site pack as the example.

- [ ] **Step 1: Write the six files and register them.**
- [ ] **Step 2: Run** `pnpm --filter @openldr/studio test -- docs` and `pnpm --filter @openldr/web test -- content`. Expect pass.
- [ ] **Step 3: Commit** `docs: profile packs, in the app and on the web`

### Task 10: The collection site pack

**Files:**
- Create: repo `~/Projects/Repositories/openldr-ce-content-pack-collection-site`, laid out like `openldr-ce-content-pack-reports-zm` (`build.mjs`, `PACK.md`, `README.md`, a check script, `dist/`)

Contents, from spec section 5.5:
- Role `sample-clerk`, name "Sample Clerk", capabilities `forms.view`, `forms.submit`, `patients.view`.
- Layout key `collection-site`, name "Collection site", pages `/forms`, `/patients`, `/docs`, start page `/forms`, roles `sample-clerk`.
- Form `lab-request` and form `samples-sent`, both open and submit for `sample-clerk`. The builder chooses the fields. Every coded field takes its codes from a value set, never an inline list.
- No `needs` step.

- [ ] **Step 1: Write the generator and its check,** which parses the output with `parseContentPack` from the CE checkout.
- [ ] **Step 2: Build and sign with the dev publisher key.** Follow the steps in the cdr-source repo.
- [ ] **Step 3: Prove it.** On a clean standalone run, install with `openldr market install <dir>`. Create a user with only the Sample Clerk role and sign in. Expect three sidebar items, start page Forms, two forms. Then `openldr market remove collection-site` refuses and names the user. Remove the user's role, then `--force` succeeds, and both forms are still published.
- [ ] **Step 4: Commit in the new repo.** Do not push or publish. The operator decides that.

### Task 11: Gate and hand back

- [ ] **Step 1: Run both gate commands from Global constraints.** Grep the output for `out of memory`, `VirtualAlloc` and `Test timed out` before reading a failure as a regression.
- [ ] **Step 2: Boot the server once against a real Postgres** to prove migration 135 applies in order. pg-mem cannot show this.
- [ ] **Step 3: Report to the operator** with the command output, the screenshots from Task 8 and the proof from Task 10. Say that merging to local `main` reaches the running dev server. Merge only when the operator says so, then run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json`.

## Not proved by this plan

- Bottom-anchored UI on a real phone. The dialog is centred, so this should not apply, but only a phone can confirm it.
- Behaviour on a central server with syncing labs. The spec limits a pack to the install it runs on, and no task tests a sync.
