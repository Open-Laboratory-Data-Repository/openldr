# The lab's own lists, and `openldr plugin call`: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lab edits its return reasons and sample conditions (with sample types) on the Lab page,
the Receive sheet filters conditions by sample type, and `openldr plugin call` runs any plugin
action from the CLI.

**Architecture:** CE gets one CLI command that sends an `invoke` op through the existing plugin
broker. The plugin adds a `sample_types` column to `lists`, two `lab.settings` entrypoints, a Lists
area in the Settings tab, and a type filter in the Receive sheet.

**Tech Stack:** CE: TypeScript, commander, vitest. Plugin: Rust (`cargo test`, `tests/fake_host.rs`),
React + vitest UI.

**Spec:** `docs/superpowers/specs/2026-11-25-lab-lists-and-plugin-call-design.md`

## Global Constraints

- Plugin lists are exactly `return-reason` and `sample-condition`.
- `code` cannot change once saved. No delete; `active: false` turns an item off.
- `sampleTypes` is a list of `{ system, code }`; empty or missing means every type; a return reason
  with types is `invalid`; each type must be in CE's `urn:openldr:valueset:specimen-type` expansion.
- Editing needs `lab.settings` and no facility limit (`refused` otherwise).
- UI: AGENTS.md section 5 (⋯ menus, Sheet with label-left grid, pagination on every table, toasts,
  StripedEmpty and LoadingState), text in en, fr and pt, works at 375 px.
- `openldr plugin call` served-mode capability: `marketplace.view` (ruling: every app command needs a
  catalog key; the broker still checks the action's own permission).
- No em dashes in any text written.

## Review Focus

1. A sample condition whose sample type is later dropped from CE's value set: it still shows in
   Settings with its stored code, and saving it again without that type works.
2. A name left empty in fr or pt: the desk sees the English name, never a blank option.
3. Turning off a condition already stored on a received sample: the sample's view still shows it.
4. `--input` that is not JSON: the CLI says so and exits 1 without calling the plugin.
5. A served caller without the action's permission: the CLI prints the broker's refusal and exits 1.

---

### Task 1 (CE): `openldr plugin call`

**Files:**
- Create: `packages/cli/src/plugin-call.ts`, `packages/cli/src/plugin-call.test.ts`
- Modify: `packages/cli/src/program.ts` (plugin group, after `remove`), `packages/cli/src/command-meta.ts`
  (`'plugin call': { kind: 'app', capability: 'marketplace.view' }`)
- Docs: `apps/web/src/docs/0.1.8/{en,fr,pt}/cli.md` (plugin section)

**Interfaces:**
- Produces: `callPlugin(deps: { broker: Pick<PluginBroker, 'handle'>; principal: BrokerPrincipal }, plugin: string, action: string, inputText: string | undefined): Promise<{ exitCode: 0 | 1; answer: unknown }>`
  and `runPluginCall(plugin: string, action: string, opts: { input?: string; json: boolean }): Promise<number>`.
- The local principal: `{ id: 'cli', username: cliActor().actorName, roles: ['lab_admin'], capabilities: await ctx.capabilityCatalog.keys(), dataScope: EVERYTHING }`.
  The served principal: `servedCaller(ctx)` (`served-caller.ts`) mapped to `{ id, roles: roleIds, capabilities, dataScope }`;
  `null` from it exits 1 with "the signed-in account was not found".

- [ ] **Step 1: Failing tests** in `plugin-call.test.ts` with a fake broker:
  - `sends one invoke op with the parsed input and prints the answer`: `handle` called with
    `('lab', principal, { kind: 'invoke', entrypoint: 'lab_list_items', input: { a: 1 } })`; exit 0.
  - `no --input sends an empty object`.
  - `input that is not JSON exits 1 and calls nothing`: message contains `--input is not JSON`.
  - `a broker refusal exits 1 and prints its text`: `{ ok: false, error: 'the action ... needs one of these permissions: ...' }`.
  - `a plugin error answer exits 1`: `{ ok: true, data: { error: { code: 'refused', message: 'x' } } }`.
- [ ] **Step 2: Run** `cd packages/cli && npx vitest run src/plugin-call.test.ts`. Expected: fail (no module).
- [ ] **Step 3: Implement** `callPlugin` and `runPluginCall` (createAppContext, principal as above,
  `emit` for output), register `plugin call <plugin> <action>` with `--input <json>` and `--json`.
- [ ] **Step 4: Run** the new tests and `src/command-meta.test.ts`. Expected: pass.
- [ ] **Step 5: Docs** in the three `cli.md`: the command, one example
  (`openldr plugin call lab lab_settings_get`), and that the action's own permission applies.
  Run `cd apps/web && npx vitest run src/docs`. Expected: pass.
- [ ] **Step 6: Commit** `feat(cli): openldr plugin call runs one plugin action through the broker`.

### Task 2 (plugin): the lists entrypoints

**Files:**
- Modify: `manifest.template.json` (`lists.sample_types` jsonb nullable; entrypoints and
  actionPermissions for `lab_list_items`, `lab_list_item_save`: `lab.settings`), `src/lists.rs`,
  `src/actions.rs`, `src/lib.rs`, `README.md` (entrypoint table, the lists)
- Test: `tests/settings.rs` (or a new `tests/lists.rs`)

**Interfaces:**
- Produces: `lab_list_items` → `{ returnReasons: Item[], sampleConditions: Item[], specimenTypes: [{ system, code, display }] }` with
  `Item = { code, display: { en, fr, pt }, active, sort, sampleTypes: [{ system, code }] }`, sorted by sort then code;
  `lab_list_item_save` input `{ list, code, display, sort, active, sampleTypes? }` → the saved `Item`;
  `lab_lists` sample conditions gain `sampleTypes`.

- [ ] **Step 1: Failing tests:**
  - `items lists both lists with inactive ones, sample types, and CE's specimen types`.
  - `save adds an item and writes one audit row` (`action: "list-item-save"`, entity `list`).
  - `save changes an item's name, order, active and types, and keeps its code`.
  - `a code outside ^[A-Za-z0-9-]{1,40}$ is invalid`.
  - `an empty English name is invalid; empty fr or pt names are stored as missing`.
  - `a return reason with sample types is invalid`; `an unknown list is invalid`.
  - `a sample type outside CE's specimen-type expansion is invalid`.
  - `a caller with a facility limit is refused`; the action gate needs `lab.settings` (manifest test).
  - `the desk read gives each condition its sample types`.
  - `a stored type CE no longer lists still shows, and the item saves without it` (Review Focus 1).
  - `turning off a condition keeps it on a sample already received with it` (Review Focus 3).
- [ ] **Step 2: Run** `cargo test`. Expected: the new tests fail.
- [ ] **Step 3: Implement** in `src/lists.rs`: `pub fn items(host) -> LabResult<Value>` and
  `pub fn save(host, input) -> LabResult<Value>` (insert or update by `{ list, code }`, audit with
  facility `*` as `settings.rs` does, type check by `valueset.expand` of
  `urn:openldr:valueset:specimen-type`). Wire both in `actions.rs` and `lib.rs`.
- [ ] **Step 4: Run** `cargo test` and `cargo clippy --all-targets -- -D warnings`. Expected: pass.
- [ ] **Step 5: Commit** `feat: the lab edits its return reasons and sample conditions, with sample types`.

### Task 3 (plugin): the Lists area, and the Receive filter

**Files:**
- Create: `ui/src/settings/ListsSection.tsx`, `ui/src/settings/ListItemSheet.tsx`
- Modify: `ui/src/settings/SettingsTab.tsx`, `ui/src/api.ts` (`listItems`, `listItemSave`, types),
  `ui/src/reception/ReceiveSampleSheet.tsx` (filter), `ui/src/i18n.ts` (en, fr, pt),
  `docs/GUIDE.md`, `GUIDE.fr.md`, `GUIDE.pt.md` (a task "Edit the lab's lists", and the CLI line)
- Test: `ui/src/settings/SettingsTab.test.tsx` (create if missing), `ui/src/reception/ReceptionTab.test.tsx`

**Interfaces:**
- Consumes: Task 2's entrypoints, `Item` and `specimenTypes`.

- [ ] **Step 1: Failing UI tests:**
  - `the Settings tab shows both lists in tables with pagination`.
  - `Add opens a sheet; saving shows a toast and the new row`.
  - `Edit keeps the code read-only and saves the changed types`.
  - `Turn off saves active false and shows the row as Off`.
  - `the Receive sheet offers only conditions for the picked sample type, plus those with no type`.
  - `a condition with no French name shows its English name in French`.
- [ ] **Step 2: Run** `pnpm --dir ui test`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the section (two tables, header ⋯ Add, row ⋯ Edit and Turn off/on,
  `TablePagination` page size 10), the sheet (Code, Name en, Name fr, Name pt, Order, Active,
  Sample types multi-pick for conditions; ⋯ Save and Cancel), the Receive filter, and the words.
- [ ] **Step 4: Run** `pnpm --dir ui test` and `pnpm --dir ui typecheck`. Expected: pass.
- [ ] **Step 5: Guides** in en, fr and pt: the task, and
  `openldr plugin call lab lab_list_item_save --input '{...}'`.
- [ ] **Step 6: Commit** `feat(ui): the Lists area in Settings, and Receive offers the conditions of the sample type`.

### Task 4: Live check and screenshots

Needs Task 1 merged into CE's local `main` and the dev server restarted (ask first).

- [ ] **Step 1:** Add to `tools/live-check/run.mjs`: save a condition linked to one specimen type
  through the broker, read it in `lab_lists`, turn it off, and call `openldr plugin call lab
  lab_list_items` through `cli.sh` (exit 0, the item present). Run `TARGET=dev ... all.sh`.
  Expected: all pass.
- [ ] **Step 2:** Screenshots of the Settings Lists area and the sheet at desktop and 375 px,
  published to the screenshot Artifact page.
- [ ] **Step 3: Commit** `test: live check for the lab's lists and the CLI call`.
