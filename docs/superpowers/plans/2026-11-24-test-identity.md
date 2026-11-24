# Test catalog: internal id and Test code, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A test keeps a fixed internal id, and people work with a required national Test code that can change.

**Architecture:** The terminology concept code stays the test's id, so every table, mapping, order and plugin lookup keyed on it is untouched. The Test code is a new concept property, read with a fallback to the concept code, so saved tests need no migration. Create, edit, import, the CLI, the screens and what leaves CE switch to the Test code.

**Tech stack:** TypeScript, Kysely, Fastify, React with shadcn, vitest and pg-mem; Rust and React in the lab plugin.

**Spec:** `docs/superpowers/specs/2026-11-24-test-identity-design.md`. Its section 3 calls are rulings. The research behind it (every place the code is a key, with file:line) is in `.superpowers/sdd/2026-11-24-test-identity/code-as-key.md`.

## Global constraints

- CE work in this worktree, branch `claude/test-catalog-corlix-parity-967249`. Plugin work in a git worktree of `/home/fredrick/Projects/Repositories/openldr-ce-plugin-lab` at `/home/fredrick/Projects/Repositories/openldr-ce-plugin-lab-corlix-parity`, branch `feat/corlix-parity` from `e2fd9c6`. Nothing is merged or pushed.
- No migration. Spec call 1 makes saved tests read their concept code as their Test code.
- Never use ports 3000, 5433, 3210, 3212, 3213, 3220, 54320, 54331, 54332 or 54340. Never connect to the dev databases.
- The Test code system is `urn:openldr:codesystem:test-catalog:test-code`. Define it once, beside `TEST_CATALOG_SYSTEM` in `packages/bootstrap/src/test-catalog.ts`, and import it everywhere.
- AGENTS.md section 5 UI rules. Strings in en, fr and pt. No em dashes. No `Co-Authored-By` trailer.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue`, `pnpm turbo run typecheck --force --concurrency=2`, `pnpm --filter @openldr/server lint`. Never pipe turbo through `tail`.

## Review focus

1. A test saved before this change (no `testCode` property) shows, searches, exports and edits by its old code, and its lab settings, LOINC link and mappings still work (Task 1).
2. Changing a Test code changes nothing keyed by the id: lab settings, LOINC link, lab-code mappings, saved orders (Tasks 1 and 3).
3. Two tests can never hold the same Test code, counting a saved test's fallback code, and counting retired tests (Task 1).
4. A CSV exported, edited (one Test code changed) and imported again updates that test, and does not make a second one (Task 1).
5. A plugin order made before the change still finds its test and its result parameters (Task 4).

---

### Task 1: The Test code in bootstrap, routes, CSV and CLI

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts` (`CatalogTest`, `CatalogTestInput`, `create` near :783, `update` near :797, search near :542, the CSV import near :971 and :1028).
- Modify: `packages/bootstrap/src/test-catalog-import.ts` (export columns near :159-165, header aliases near :51).
- Modify: `packages/bootstrap/src/plugin-host.ts` (`testCatalog.get`, `list` answer `testCode`).
- Modify: `apps/server/src/test-catalog-routes.ts` (body schemas take `testCode`; audit `entityId` stays the id and the detail names the Test code, old and new on a change).
- Modify: `packages/cli/src/program.ts` and the test-catalog CLI module (`set` takes `--test-code`; every command that takes `<code>` resolves a Test code first, then an id).
- Tests beside each file.

**Interfaces:**
- Produces:

```ts
export const TEST_CODE_SYSTEM = 'urn:openldr:codesystem:test-catalog:test-code';
CatalogTest gains: testCode: string;            // props.testCode, else the concept code
CatalogTestInput: `code` is replaced by `testCode: string | null` (required on create; on update, absent means unchanged)
TestCatalog gains: findByTestCode(testCode: string): Promise<CatalogTest | null>;
                   resolve(codeOrId: string): Promise<CatalogTest | null>;   // Test code first, then id
newTestId(): string;   // 'tst-' + 16 hex chars from randomUUID()
```

- Plugin host `testCatalog.get` and `list` rows gain `testCode`. `code` keeps meaning the id.

- [ ] **Step 1: Write the failing tests:**
  - create with `testCode: 'HB'` makes a concept whose code matches `/^tst-[0-9a-f]{16}$/`, with property `testCode: 'HB'`; `get(id).testCode === 'HB'`.
  - create with no Test code is refused ("A test needs a Test code"). The LOINC fallback is gone.
  - create or update with a Test code another test holds is refused, naming that test. This counts a saved test with no `testCode` property by its concept code, and counts retired tests (review focus 3).
  - update changes the Test code; the id, lab settings row, LOINC link and lab-code mappings stay (review focus 2).
  - a test saved without `testCode` reads `testCode === code`, and search by that code finds it (review focus 1).
  - search finds a test by Test code and by name.
  - CSV export has `id` and `code` (the Test code). Import matches on `id` when present, else on Test code; a changed Test code with the `id` column updates that test (review focus 4); a row with a new Test code and no `id` makes a new test with a `tst-` id; a row with no Test code is refused.
  - the routes accept `testCode`, and their wire shape answers `testCode` (route tests). The audit detail of a change names old and new Test code.
  - plugin host `testCatalog.get` and `list` answer `testCode`.
  - CLI: `test-catalog set <code> --test-code NEW` changes it; `enable`, `params` and the others find a test by Test code or by id.
- [ ] **Step 2: Run and see them fail** (`pnpm --filter @openldr/bootstrap test -- test-catalog`, and server and cli).
- [ ] **Step 3: Implement.** Uniqueness is checked in TypeScript over the catalog's concepts; the catalog is small. Keep the existing `:code` route paths meaning the id.
- [ ] **Step 4: Run and see them pass**, then the full bootstrap, server and cli suites, their typecheck, and server lint.
- [ ] **Step 5: Commit** `feat(test-catalog): an internal id and a Test code that can change`.

### Task 2: What leaves CE carries the Test code (forms extractor, test map)

**Files:**
- Modify: `packages/forms/src/extract/extract.ts:374-381` (ServiceRequest codings) and whatever feeds it the test's LOINC today (it must also get the Test code).
- Modify: `packages/bootstrap/src/test-mapping.ts:292` and `:297` (`test_map.catalog_code` and the self-mapping publish the Test code).
- Tests beside each.

**Interfaces:** Consumes `TEST_CODE_SYSTEM` and `CatalogTest.testCode` from Task 1.

- [ ] **Step 1: Write the failing tests:** a ServiceRequest for a test with LOINC has codings `[LOINC, {TEST_CODE_SYSTEM, testCode}, {TEST_CATALOG_SYSTEM, id}]`; without LOINC, the first coding is the Test code, so the relational `panel_code` is the Test code, never a `tst-` id. The ServiceRequest id (order-ids.ts) is unchanged for a saved order. The test map publishes the Test code.
- [ ] **Step 2: Run and see them fail.** `pnpm --filter @openldr/forms test`, `pnpm --filter @openldr/bootstrap test -- test-mapping`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass**, plus the full forms, db and bootstrap suites.
- [ ] **Step 5: Commit** `feat(test-catalog): orders and the test map carry the Test code`.

### Task 3: Screens and docs (studio)

**Files:**
- Modify: `apps/studio/src/api.ts` (`CatalogTest.testCode`, `CatalogTestInput.testCode`).
- Modify: `apps/studio/src/test-catalog/TestSheet.tsx`: the first basic row is "Test code" (input, required, editable on a saved test too), with the id shown under it in muted mono text ("Internal id: tst-..."), hidden when the id equals the Test code. Save is disabled while the Test code is empty. The read-only view shows the Test code.
- Modify: `apps/studio/src/pages/TestCatalog.tsx` (the code column shows the Test code, header "Test code").
- Modify: test mapping screens that show a catalog test code (find them: `apps/studio/src/test-catalog/MapCodeSheet.tsx`, `MatchCodesSheet.tsx`, `ObservedCodesTab.tsx`) and `apps/studio/src/forms-runtime/TestDetailsField.tsx:104`: show the Test code.
- Carried from plan A (ledger N1): in the TestSheet Save, after from-loinc's answer rewrites param codes, collapse `resultParams` by code, keeping the first. Test it.
- i18n en, fr, pt: "Test code", the required message, the id line. Remove `codeHint` ("Leave it empty to use the LOINC code") in all three.
- Docs: the Test catalog guide (in-app `apps/studio/src/docs/0.1.8/{en,fr,pt}/test-catalog.md`, and web docs that mention the code) in en, fr and pt: the Test code is the national code, required, can change; the internal id; LOINC is the mapping and the search helps fill a new test; CSV `id` column; CLI `--test-code`.

- [ ] **Step 1: Write the failing tests:** the sheet's first basic row is Test code; Save sends `testCode`; editing a saved test's Test code sends it and keeps the id in the path; an empty Test code disables Save; the table shows the Test code; TestDetailsField shows the Test code; the N1 dedupe.
- [ ] **Step 2: Run and see them fail.** `pnpm --filter @openldr/studio test -- TestSheet TestCatalog TestDetails`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass**, then the studio suite, typecheck, and the docs tests (`pnpm --filter @openldr/web test`).
- [ ] **Step 5: Commit** `feat(test-catalog): the screens and docs use the Test code`.

### Task 4: The lab plugin shows and sends the Test code (plugin repo)

**Files (plugin worktree):** `src/sends.rs:86-113` (the ServiceRequest coding adds `{TEST_CODE_SYSTEM, testCode}` before the catalog coding, read live from `testCatalog.get`), `ui/src/reception/RegisterOrderSheet.tsx` and the order panel (`OrderPanel.tsx:128`): show the Test code from the catalog list, keep keying on the id. Copy the contract fixtures from CE's new `testCatalog.get` and `list` answer shape. Read the plugin's `README.md` and `docs/` first for its build and test commands.

- [ ] **Step 1: Write the failing tests:** a send for a test with Test code `HB` carries that coding; an order stored with an id still finds its test and result parameters (review focus 5); the UI shows `HB`, and an old order whose test has no `testCode` shows its code.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass**, plus the plugin's full Rust and UI suites.
- [ ] **Step 5: Commit** `feat: show and send the national Test code`.

### Task 5: Gate and live run

- [ ] **Step 1: Gate** (CE). Grep for `out of memory`, `VirtualAlloc`, `Test timed out` before reading a failure as a regression.
- [ ] **Step 2: Live run** on the throwaway install: make a test with Test code `CHOL1` from LOINC 2093-3; change its Test code to `CHOL`; check the id did not change, the LOINC link and lab settings are kept, and an export shows `id` and `code`. Screenshots on the operator's Artifact page.

Order: 1, 2, 3, 4, 5. Task 4 needs Task 1's answer shape.
