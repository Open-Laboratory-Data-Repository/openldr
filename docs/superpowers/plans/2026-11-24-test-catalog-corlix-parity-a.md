# Test catalog Corlix parity, plan A: the LOINC pick and the sheet order

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Picking a LOINC code fills the test the way Corlix does, and the Test sheet reads top to bottom in Corlix's order.

**Architecture:** The LOINC facts the sheet needs come from one bootstrap function, `loincHints`, read by the route and the CLI. A pick changes only the unsaved draft. Save first makes the missing dictionary fields through the existing `resultFieldsFromLoinc`, then saves the test. A new migration adds Corlix's specimen types and links them to SNOMED in the local map.

**Tech stack:** TypeScript, Kysely, Fastify, React with shadcn, vitest and pg-mem.

**Spec:** `docs/superpowers/specs/2026-11-24-loinc-pick-parity-design.md`, sections 2 and 3. Its calls are rulings. The earlier spec and plan are `docs/superpowers/specs/2026-11-23-test-catalog-hints-design.md` and `docs/superpowers/plans/2026-11-23-test-catalog-hints.md`.

**Corlix reference:** `/home/fredrick/Projects/Repositories/corlix` at `0f308aee`. Read before porting:
- `apps/desktop/src/renderer/pages/TestEditorPage.tsx:585-720` (`handleTermChange`, `applySpecimenDisplayGuess`, `enrichAndScaffold`);
- `apps/desktop/src/renderer/lib/specimenMatch.ts` and `lib/scaffoldFields.ts`;
- `apps/desktop/src/main/migrations/index.ts:310-326` (the 15 specimen types and their SNOMED codes).

## Global constraints

- Work in this worktree, on branch `claude/test-catalog-corlix-parity-967249`. Nothing is merged or pushed.
- Never use ports 3000, 5433, 3210, 3212, 3213, 3220, 54320, 54331, 54332 or 54340. Never connect to the dev databases: a live run uses its own data folder and `OPENLDR_SKIP_ENV_FILE=true`.
- Migration 143 is the only new migration. Check again that no branch claims 143 before committing it.
- Never hardcode clinical vocabulary in source (AGENTS.md section 8). The migration is the one place the specimen codes and SNOMED codes are written, as seed data, the same way migration 014 seeds its four.
- AGENTS.md section 5: actions in `⋯` menus, sheets not dialogs (a confirm prompt may be a dialog), label left and input right, shadcn only.
- Every new string in en, fr and pt (`apps/studio/src/i18n/{en,fr,pt}.ts`). No em dashes anywhere. No `Co-Authored-By` trailer on commits.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue`, `pnpm turbo run typecheck --force --concurrency=2`, `pnpm --filter @openldr/server lint`. Never pipe turbo through `tail`.

## Calls made in this plan (for the report)

The spec leaves these open. They are decided here, cheaply, and told to the operator:
1. A LOINC scale of `Ord` with no answer list becomes text, since a coded field needs a value set. `Nom` becomes text even when LOINC gives answers (spec call 3, as Corlix).
2. "Fill from panel" also goes into the unsaved test, like a pick. Its new fields are made on Save. One rule for both.
3. A pick adds LOINC's result field only when the test holds no result field other than those an earlier pick added, as Corlix seeds a field only on an empty list. A panel code adds no field; it offers "Fill from panel".
4. Picking another code, or clearing it, drops what the earlier pick added: its new fields, and its ticks on dictionary fields. Fields ticked by hand, or before the pick, stay.
5. The migration adds only the 11 new specimen codes to the value set, never the four old ones, and only when missing. A lab that removed Blood keeps it removed. A lab that deleted the value set gets nothing. A local-map link is added only when that code has no active link to SNOMED yet.
6. Reference ranges move to their own section below Result parameters, grouped by field, as Corlix shows them. The band editor itself is unchanged.

## Review focus

1. A test someone already filled (name, short name, category, specimens, result fields) keeps every value when a LOINC code is picked (Tasks 1 and 4).
2. Save fails after the dictionary fields were made (for example a duplicate test code): Save again reuses those fields, makes nothing twice, and saves the test (Task 4).
3. Without LOINC or its ontology loaded, the sheet works as today: no Browse item, no hints, no pending fields, and Save never calls from-loinc (Task 4).
4. The migration run twice, or on a lab whose specimen list was edited, adds nothing twice and changes no existing row (Task 2).
5. A pick whose field is already in the dictionary under another code (CHOL for 2093-3) ticks that field and creates nothing (Tasks 1 and 4).

---

### Task 1: LOINC facts for a pick (terminology, bootstrap, route, CLI)

**Files:**
- Modify: `packages/terminology/src/loaders/loinc.ts` (keep `SHORTNAME`).
- Modify: `packages/db/src/terminology-admin-store.ts:341` (a term's `shortName`, `class` and `unit` fall back to LOINC's `SHORTNAME`, `CLASS` and `EXAMPLE_UCUM_UNITS`, so the term search answers them for LOINC). Mirror the same fallback in `apps/server/src/test-helpers.ts:161`.
- Modify: `packages/bootstrap/src/loinc-hints.ts`.
- Modify: `apps/server/src/result-fields-routes.ts:75` (the from-loinc body takes optional `names`).
- Modify: `packages/cli/src/loinc-hints.ts` (print short name and component).
- Tests: `packages/terminology/src/loaders/loinc.test.ts` (create if missing), `packages/bootstrap/src/loinc-hints.test.ts`, the server route test that covers loinc-hints, `packages/cli/src/loinc-hints.test.ts`.

**Interfaces:**
- Produces, in `loinc-hints.ts`:

```ts
/** The result field a LOINC code becomes on a test. */
export interface LoincFieldPlan {
  loinc: string;
  /** The dictionary field that already stands for the code (may be another code, CHOL for 2093-3), else the LOINC code. */
  code: string;
  /** LOINC's COMPONENT ("HIV 1 RNA"); the long name, then the panel member name, when it has none. */
  display: string;
  resultType: ResultType;            // spec call 3: Qn numeric, Ord with answers coded, else text
  unit: string | null;               // numeric only
  valueSetUrl: string | null;        // coded only: `${LOINC_ANSWERS_VALUE_SET_PREFIX}${loinc}`
  /** True when `code` is already a dictionary field. False means Save makes it. */
  exists: boolean;
}
LoincHints gains:
  shortName: string | null;          // SHORTNAME, or a terms CSV's shortName
  component: string | null;          // COMPONENT
  systemPart: string | null;         // LOINC's SYSTEM part, such as "Ser/Plas"
  field: LoincFieldPlan | null;      // null for a panel, or when the existing field is unusable
  fieldProblem: string | null;       // existingField's refusal message, when field is null for that reason
LoincPanelMemberHint gains: field: LoincFieldPlan | null; fieldProblem: string | null;
LoincSpecimenHint gains: via: 'snomed' | 'system-name';
resultFieldsFromLoinc(codes: string[], opts?: { panel?: boolean; names?: Record<string, string> })
```

- Each new field's display is its plan's `display`, so the hint, the draft and the saved field agree. `names` gives the name for a code missing from the loaded LOINC, as a panel member's name does today.
- Route body: `{ codes: string[]; panel?: boolean; names?: Record<string, string> }`. Studio `resultFieldsFromLoinc(codes, panel, names?)` in `apps/studio/src/api.ts` gains the third argument.

- [ ] **Step 1: Write the failing tests.** With the LOINC fixture under `packages/terminology/src/ontology/adapters/__fixtures__/loinc`:
  - `loincRowToConcept` keeps `SHORTNAME` ("Cholest SerPl-mCnc" for 2093-3) and leaves it out when empty.
  - A term search on LOINC answers `shortName`, `class` and `unit` from those keys.
  - `hints('2093-3')` answers `shortName: 'Cholest SerPl-mCnc'`, `component: 'Cholesterol'`, `systemPart: 'Ser/Plas'`, and `field: { code: '2093-3', display: 'Cholesterol', resultType: 'numeric', unit: 'mg/dL', valueSetUrl: null, exists: false }`.
  - After `resultFieldsFromLoinc(['2093-3'])`, `hints('2093-3').field.exists` is true. With a field CHOL linked to 2093-3, `field.code` is `'CHOL'` and `exists` true.
  - `hints('6429-5')` (Nom) answers `resultType: 'text'`, even if the fixture gives answers. An `Ord` code with answers answers `coded` and its value set URL. An `Ord` code without answers answers `text`.
  - `hints('24331-1')` (panel) answers `field: null` and each member's `field` in panel order.
  - `resultFieldsFromLoinc(['2093-3'])` makes a field named `Cholesterol`, not the long name.
  - `resultFieldsFromLoinc(['X-member'], { names: { 'X-member': 'Some member' } })` for a valid code missing from LOINC makes it with that name.
  - The SYSTEM-part fallback: a code with no LOINC specimen link, whose SYSTEM is `Bld`, and a specimen type displayed "Blood", answers one specimen with `via: 'system-name'` and `tick: true`. With two name matches, none is ticked. Port Corlix's test (name equal, or the SYSTEM part contains the name, compared lowercase), and widen it so `Ser/Plas` matches "Serum" and "Plasma": split on `/`, and match a part equal to the name or a prefix of it. Say in a comment that this is wider than Corlix's `includes`, because LOINC writes abbreviations.
  - The loinc-hints route answers the new fields (wire shape test). The from-loinc route passes `names` through.
  - `openldr test-catalog loinc-hints 2093-3` prints the short name and the component, and `--json` carries them.
- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @openldr/bootstrap test -- loinc-hints`, and the same for terminology, server and cli.
- [ ] **Step 3: Implement.** One private `planField(systemId, loinc, fallbackName)` in `loinc-hints.ts` is used by both `hints` and `resultFieldsFromLoinc`, so they can never disagree on name or type. `resultTypeOf` becomes the spec call 3 rule, reading the scale from both import doors as today.
- [ ] **Step 4: Run the tests and see them pass.** Also run the existing `loinc-hints` tests: any that assumed the long name or the old type rule are updated to the spec's rule, and nothing else changes.
- [ ] **Step 5: Commit** `feat(test-catalog): LOINC short name, component and field plan on a pick`.

### Task 2: Corlix's specimen types, linked to SNOMED (migration 143)

**Files:**
- Create: `packages/db/src/migrations/internal/143_specimen_types_snomed.ts` and its `.test.ts`.
- Modify: `packages/db/src/migrations/internal/index.ts` (register it).

**What it writes.** Inline every constant (the frozen-snapshot rule in 078's header). The specimen value set is `urn:openldr:valueset:specimen-type`, its concepts live in `urn:openldr:cs:local`, and SNOMED is `http://snomed.info/sct`.

| Local code | Display | SNOMED |
|---|---|---|
| BLD (exists) | Blood | 119297000 |
| UR (exists) | Urine | 122575003 |
| CSF (exists) | CSF | 258566005 |
| SPT (exists) | Sputum | 119394009 |
| PLAS | Plasma | 119361006 |
| SER | Serum | 119364003 |
| STL | Stool | 119339001 |
| PLR | Pleural fluid | 418564007 |
| ASC | Ascitic fluid | 309201001 |
| SAL | Saliva | 119342007 |
| WND | Wound specimen | 119295008 |
| THRT | Throat swab | 258529004 |
| NASL | Nasal swab | 258603007 |
| SYN | Synovial fluid | 258580003 |
| BM | Bone marrow | 122592007 |

Steps inside `up`:
1. Insert the 11 new concepts into `terminology_concepts` with `onConflict doNothing`.
2. If the value set exists, add each new code missing from its `compose` include for the local system, add its `valueset_expansions` row, and rewrite its stored FHIR resource the way migration 014 builds it (`valueSetToFhirResource`). Never add the four old codes, never remove anything, never change its status.
3. For each of the 15, when there is no active `term_mappings` row from `urn:openldr:cs:local|<code>` to SNOMED, write one `SAME-AS` row and its `concept_map_elements` mirror under `urn:openldr:terminology:local-map`, with the same columns `terminology-admin-store.ts` writes (read its `termMappings` save around line 960 and copy the row shape and the equivalence it mirrors).
4. `down` removes only what `up` wrote, when it can tell those rows apart safely. If it cannot, `down` is a no-op with a comment saying why.

- [ ] **Step 1: Write the failing tests** (pg-mem, the migration test helpers beside 142):
  - After `up`, the value set expands to 15 codes, and `ops.translate` from `urn:openldr:cs:local|SER` to SNOMED answers `119364003`.
  - Running `up` twice leaves 15 codes and one mapping per code.
  - A lab that removed BLD from the compose, and mapped UR to another SNOMED code, keeps both: BLD stays out, UR keeps its own link, no second link is added.
  - With the value set deleted, `up` adds no expansion rows and does not fail.
  - A loinc-hints test (in `packages/bootstrap`) with the migrated specimen list: a fixture code whose LOINC specimen link is serum or plasma matches SER or PLAS through the local map. If the fixture has no such link, add one to the fixture's part link file and say so in the commit.
- [ ] **Step 2: Run and see them fail.** `pnpm --filter @openldr/db test -- 143`.
- [ ] **Step 3: Implement the migration.** Check every local branch again for a `143_` file first.
- [ ] **Step 4: Run and see them pass**, plus `pnpm --filter @openldr/db test -- registration`.
- [ ] **Step 5: Commit** `feat(test-catalog): Corlix's 15 specimen types, linked to SNOMED`.

### Task 3: The sheet's order, Browse LOINC, search lines and suggestion marks (studio)

**Files:**
- Modify: `apps/studio/src/test-catalog/TestSheet.tsx`.
- Modify: `apps/studio/src/terminology/TermPicker.tsx` (an optional second line per result).
- Modify: `apps/studio/src/api.ts` (the `LoincHints` type, as Task 1 produced it).
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`.
- Tests: `apps/studio/src/test-catalog/TestSheet.test.tsx`, `TestSheetLoinc.test.tsx`, `apps/studio/src/terminology/TermPicker.test.tsx` (create if missing).

**Interfaces:**
- Consumes: `LoincHints` from Task 1.
- Produces: `TermPicker` prop `detail?: (term: Term) => string | null`, drawn as a muted second line under each result. Other pickers pass nothing and look as today.

**The order** (spec section 2), each a titled section with an edge-to-edge rule (`Divider` from `components/ui/bleed.tsx`), in the one grid the sheet already uses:
1. LOINC code. The picker, and beside it a `⋯` menu with "Browse LOINC" (only when `options.loinc` is set). Browse opens `apps/studio/src/terminology/ontology/OntologyPickerDialog.tsx` over the LOINC system id, and its pick goes through the same `pickLoinc` as a search pick.
2. Additional codings: not in plan A. Leave a comment marking where plan B puts it.
3. Basic information: code, name, short name, category, expected TAT, critical TAT, review, and Active on a saved test.
4. Specimen types.
5. Result parameters: the field list, each field's type and `⋯`.
6. Reference ranges: for each ticked numeric field, a sub-heading with its name, its "Add range" item in a `⋯` beside the sub-heading, and its bands below. Move the existing band block here without changing it.

The read-only view (a lab that receives the catalog from central) follows the same order. "This lab" stays last.

**Pick fills** (spec call 1), in `pickLoinc`: an empty name takes `hints.display`, an empty short name takes `hints.shortName`. Category and specimen fill as today.

**Suggestion marks:**
- Category (spec call 6): when `hints.categorySuggestion` differs from the draft's category, the hint line becomes a small link-style `Button` reading "MICRO, suggested" from i18n `testCatalog.sheet.categorySuggested` with `{{name}}`. One click sets the category. With no matching category it stays the text line it is today.
- Specimens (spec call 5): each specimen type that a hint matched but is not ticked shows a small muted "suggested" `Badge` beside its name, as Corlix's checkboxes do. The specimen hint line keeps only the SNOMED codes no specimen type matched, and the map hint line stays.

**Search line** (spec call 7): the LOINC picker passes `detail` that joins the term's short name, class and unit with " · ", skipping empty ones.

- [ ] **Step 1: Write the failing tests:**
  - The sections render in the spec's order, LOINC first, for a new test, a saved test and the read-only view (assert heading order in the DOM).
  - Picking 2093-3 in a new test fills name "Cholesterol [Mass/volume] in Serum or Plasma" and short name "Cholest SerPl-mCnc". With a typed name and short name, both stay (review focus 1).
  - The category button sets the suggested category in one click, and disappears when they match.
  - A matched, unticked specimen shows "suggested"; ticking it removes the mark.
  - "Browse LOINC" is in the LOINC row's menu only when LOINC is loaded, and a pick in the browser fills the draft like a search pick (mock `OntologyBrowser` to call `onPick`).
  - `TermPicker` with `detail` shows the second line; without it, no second line.
  - Ranges show under the Reference ranges section for a ticked numeric field, and "Add range" there adds a band starting with the field's unit.
- [ ] **Step 2: Run and see them fail.** `pnpm --filter @openldr/studio test -- TestSheet TermPicker`.
- [ ] **Step 3: Implement.** Keep the existing test ids (`add-band-<code>`, `band-<code>-<n>` and so on) so the old tests still find them.
- [ ] **Step 4: Run and see them pass**, then the whole studio suite: `pnpm --filter @openldr/studio test`.
- [ ] **Step 5: Commit** `feat(test-catalog): the test sheet in Corlix's order, with Browse LOINC and suggestion marks`.

### Task 4: LOINC's result fields go into the unsaved test (studio)

**Files:**
- Modify: `apps/studio/src/test-catalog/TestSheet.tsx`.
- Create: `apps/studio/src/test-catalog/loinc-draft.ts` (the pure add and drop rules) and `loinc-draft.test.ts`.
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`.
- Tests: `apps/studio/src/test-catalog/TestSheetLoinc.test.tsx`, `loinc-draft.test.ts`.

**Interfaces:**
- Consumes: `LoincHints.field`, `panelMembers[].field`, and `resultFieldsFromLoinc(codes, panel, names)` from Task 1.
- Produces, in `loinc-draft.ts`:

```ts
/** What a LOINC pick or a panel fill put on the draft, so another pick can take it back. */
export interface LoincAdded { loinc: string; params: string[]; newFields: LoincFieldPlan[] }
export function addFromLoinc(params: CatalogTestResultParam[], plans: LoincFieldPlan[], mode: 'add' | 'replace'): { params: CatalogTestResultParam[]; added: string[] };
export function dropLoincAdded(params: CatalogTestResultParam[], added: LoincAdded | null): CatalogTestResultParam[];
```

**Behaviour:**
- A pick (spec call 2, and plan call 3) adds `hints.field` when the draft holds no result field other than those the last pick added. The param is `{ system, code: plan.code, resultType, valueSetUrl, bands: [] }`. A plan with `exists: false` also appears in the field list, ticked, with a "New, saved with the test" `Badge` (`testCatalog.sheet.newWithTest`).
- Another pick, or clearing the code, first calls `dropLoincAdded` with the last pick's record (plan call 4).
- "Fill from panel" (spec call 4): with no fields on the draft, it adds every member's plan. With fields, it opens a confirm `Dialog` (a confirm prompt, allowed by AGENTS.md section 5) titled from `testCatalog.sheet.fillFromPanelTitle`, with Replace, Add and Cancel. Replace drops every param on the draft; Add skips members already present. Both go into the draft only (plan call 2). A member whose `field` is null is skipped and named in a toast with its `fieldProblem`.
- "Use LOINC's result field" stays in the menu only when the pick did not add the field (the test already had fields). It then adds `hints.field` the same way.
- Save: the ticked params whose plan has `exists: false` are sent to `resultFieldsFromLoinc(codes, false, names)` first, where `names` maps each code to its plan's display. Then the test is saved with the draft's params. Then `onOptionsChanged` runs. If the from-loinc call fails, nothing else is sent and the error shows in a toast. Unticked new fields are never made.
- After a save, the new fields are ordinary dictionary fields: clear the pending marks.

- [ ] **Step 1: Write the failing tests:**
  - `addFromLoinc` add mode skips a code already present and keeps the present param untouched (type, value set, bands).
  - `dropLoincAdded` removes only the params the record lists, and keeps one the user ticked by hand after the pick.
  - Picking 2093-3 on a new test ticks a "Cholesterol" field marked "New, saved with the test", and no request goes to from-loinc before Save.
  - Save sends `resultFieldsFromLoinc(['2093-3'], false, { '2093-3': 'Cholesterol' })`, then `createCatalogTest` with the param (assert call order).
  - Unticking the new field, then Save, sends no from-loinc call.
  - Picking 2571-8 after 2093-3 drops Cholesterol and adds Triglyceride. Clearing drops Triglyceride.
  - A pick whose plan has `exists: true` and `code: 'CHOL'` ticks CHOL with no "New" mark, and Save sends no from-loinc call (review focus 5).
  - A test with a field ticked by hand: the pick adds nothing, and "Use LOINC's result field" is in the menu.
  - Fill from panel on an empty draft adds the members in order. On a draft with fields it asks; Replace leaves only the members; Add appends the missing ones.
  - Save fails on the test after from-loinc answered: a second Save sends from-loinc again (the server reuses), then the test (review focus 2).
  - Without `options.loinc`, a typed LOINC code adds nothing and Save never calls from-loinc (review focus 3).
- [ ] **Step 2: Run and see them fail.** `pnpm --filter @openldr/studio test -- TestSheetLoinc loinc-draft`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass**, then the whole studio suite.
- [ ] **Step 5: Commit** `feat(test-catalog): a LOINC pick puts its result field on the unsaved test`.

### Task 5: Docs, gate and live run

**Files:**
- The Test catalog guide, in-app (`apps/studio/src/docs/<current version>/{en,fr,pt}/test-catalog.md`; find the folder the studio serves as current) and web (`apps/web/src/docs`, the same guide in en, fr and pt). Follow `apps/studio/src/docs/HOW-TO-TEMPLATE.md`.

Cover: the new order; what a pick fills (name, short name, category, specimens, the result field marked new until Save); Replace or Add on Fill from panel; Browse LOINC; the 15 specimen types and their SNOMED links; that a lab which loaded LOINC before this change loads it again for short names (`openldr terminology import loinc`).

- [ ] **Step 1: Write the docs** in three languages, and check no i18n key renders as braces.
- [ ] **Step 2: Commit** `docs: test catalog follows Corlix for a LOINC pick`.
- [ ] **Step 3: Gate.** The three gate commands. Expected: every package passes. Grep for `out of memory`, `VirtualAlloc` and `Test timed out` before reading a failure as a regression.
- [ ] **Step 4: Live run** on a throwaway install, with its own data folder, `OPENLDR_SKIP_ENV_FILE=true`, and free ports outside the banned list. Load the LOINC fixture with `openldr terminology import loinc --accept-license` and build its ontology. In the browser:
  1. A new test: pick 2093-3. See name, short name, the category suggestion, SER and PLAS marked, and Cholesterol marked new. Save. See the field in the Result fields tab.
  2. Pick the panel 24331-1 on another test, Fill from panel, Save.
  3. Browse LOINC and pick from the tree.
  4. At 375x812, the sheet has no sideways scroll.

  Put the screenshots on an Artifact page for the operator.

The changelog runs after the operator approves the merge, on `main`, not here.

Order: 1, 2, 3, 4, 5. Task 2 does not depend on Task 1, except its last test. Task 4 needs Tasks 1 and 3.
