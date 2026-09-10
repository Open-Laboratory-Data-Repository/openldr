# Remove the Data step and the cell-edit feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the facility import wizard's Data step and everything built to serve it, leaving a three-step wizard of Source, Mapping and Review.

**Architecture:** The removal runs consumers first, then routes, then packages, so every commit typechecks. The step renumbering is one atomic task because the step model and the sheet cannot disagree for even one commit. One class has to move rather than be deleted: `FacilityFileUnreadableError` lives in the file being removed and Slice B's column-values reader still throws it.

**Tech Stack:** Kysely migrations (Postgres, pg-mem in tests), Fastify with zod, React 18 with shadcn, vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-09-08-facility-import-data-stage-design.md`. That spec argued the Data step into existence, and this plan reverses part of it. Task 10 records why rather than deleting it.

## Why this is being removed

The operator ran the whole wizard against the real Zambia export and reached a working import. Their verdict: the Data step is overkill, every repair will be done on the source file, and the step does not work on a phone.

Two facts support it, both checked rather than assumed.

**The Data step was never on the forward path.** `apps/studio/src/facilities/stepModel.ts`'s `furthestStep` returns 1, 3 or 4. It never returns 2. Step 2 has only ever been reachable by clicking it in the strip, so calling it step 2 of four has been wrong since Slice A.

**The problem it was built for was solved by something else.** The spec's case was "you map blind: Mapping asks which field `Type` belongs to while showing none of the values in that column." Slice B answered that on the Mapping step, by rendering a column's unrecognised values in a worklist under the row they belong to (`ColumnMapStep.tsx`). The Data step never became how an operator stops mapping blind.

## What this also settles

The parked finding from Slice C's final review, that the confirm gate does not pin the overlay it validated, is closed BY this removal and needs no separate fix. `apps/server/src/facilities-routes.ts:2643-2646` states the original argument: `ConfirmSchema` has no `columnMap` key, so an apply is guaranteed to run with the same map its validate did, "by construction, not by a comparison anywhere." An immutable blob plus an un-overridable map was the whole guarantee. Slice C broke it by adding a mutable overlay the worker read twice. Removing the overlay restores it.

One adjacent thing is NOT in scope and stays as it is: `ConfirmSchema` accepts `allowInvalidCoordinates`, which genuinely changes which rows become records, so confirming with it on imports rows the validate's `parsed` count never included. That predates Slice C and is the operator's call to raise separately.

## Global Constraints

Copied verbatim from `AGENTS.md` and `CLAUDE.md`. Every task's requirements include this section.

- Never add `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailers. The operator is the sole contributor.
- No em dashes anywhere in new writing, in any language, source comments included. No emoji in headings or bullets. Short sentences, target 15 words.
- Never hardcode clinical vocabulary. Codes, statuses and value sets come from the terminology service or config.
- Kysely enforces strict numeric migration prefix order, and a gap blocks boot. `091_facility_import_edits.ts` is applied and recorded; `092` is the next free number.
- Actions go in a `MoreHorizontal` dropdown. shadcn only. Every `<Table>` gets `TablePagination`.
- Test gate: `pnpm turbo run test --concurrency=2 --force`, redirected to a file. Never pipe turbo through `tail`.
- `apps/server` is the only package with real lint. It enforces the return/await `reply.send` rule.
- The studio i18n types derive the fr and pt shape from en's keys, so a key removed from `en.ts` must be removed from `fr.ts` and `pt.ts` in the same commit or the typecheck fails.
- The operator's dev servers run from the main checkout with `AUTH_DEV_BYPASS=true`. Do not kill them.
- Commit after every task. Do not push or merge without being asked.

## Two decisions already taken

**The paged-read route goes too.** `GET /api/facilities/import/runs/:id/rows` and `readFileRows` exist only to feed the grid. The spec argued they should stay "scriptable", but that argument was there to justify skipping CLI parity for the grid, and it dies with the grid. The operator chose removal.

**Migration `091` stays, and `092` drops the table.** `091_facility_import_edits` is already recorded in `kysely_migration` on the operator's dev database, proven when the route answered `200 {"edits":[]}` live. Deleting the migration file would leave Kysely a recorded migration with no file and make the next feature's `091` collide. So the file stays and a new `092` drops the table.

## File structure

**Deleted:**
- `apps/studio/src/facilities/DataGridStep.tsx` and `DataGridStep.test.tsx`
- `apps/studio/src/facilities/CellEditChoiceDialog.tsx` and `CellEditChoiceDialog.test.tsx`
- `packages/bootstrap/src/facility-file-rows.ts` and `facility-file-rows.test.ts`
- `packages/db/src/facility-import-edit-store.ts` and `facility-import-edit-store.test.ts`

**Created:**
- `packages/db/src/migrations/internal/092_drop_facility_import_edits.ts`

**Modified:**
- `apps/studio/src/facilities/stepModel.ts` and `stepModel.test.ts`
- `apps/studio/src/facilities/ImportSteps.tsx`
- `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` and `ImportFacilitiesSheet.test.tsx`
- `apps/studio/src/facilities/ColumnMapStep.tsx` and `ColumnMapStep.test.tsx`
- `apps/studio/src/facilities/mappingCheckState.ts`
- `apps/studio/src/facilities/importInputsSignature.ts` and `importInputsSignature.test.ts`
- `apps/studio/src/api.ts`
- `apps/studio/src/i18n/{en,fr,pt}.ts`
- `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`
- `apps/web/src/docs/0.1.0/facilities.md`
- `apps/server/src/facilities-routes.ts` and `facilities-routes.test.ts`
- `packages/bootstrap/src/facility-column-values.ts` (gains the moved error class)
- `packages/bootstrap/src/index.ts`
- `packages/bootstrap/src/facility-import.ts`, `facility-import.test.ts`
- `packages/bootstrap/src/facility-import-worker.ts`, `facility-import-worker.test.ts`
- `packages/terminology/src/facility-csv.ts` and `facility-csv.test.ts`
- `packages/db/src/index.ts`, `packages/db/src/schema/internal.ts`
- `packages/db/src/migrations/internal/index.ts`
- `packages/db/src/migrations/migrations.test.ts`
- `docs/superpowers/specs/2026-09-08-facility-import-data-stage-design.md`
- `docs/superpowers/plans/2026-09-09-facility-import-cell-edits-slice-c.md` (a parked note at the top, nothing else)

## Order, and why it is this order

Consumers before producers, so every commit typechecks on its own. Studio UI, then the stale-invalidation threading, then the server routes, then the packages, then the copy and docs. Task 1 is the one place two files must change together.

---

### Task 1: The wizard becomes three steps

**Files:**
- Modify: `apps/studio/src/facilities/stepModel.ts`
- Modify: `apps/studio/src/facilities/stepModel.test.ts` (9 existing tests)
- Modify: `apps/studio/src/facilities/ImportSteps.tsx:6-11`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` (25 step sites, listed below)
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts` (the `steps` block)

**This task is atomic and cannot be split.** `ImportStep` is a literal union. Narrow it in `stepModel.ts` without renumbering the sheet in the same commit and the typecheck fails, because the sheet compares against `4`. The sheet's own comment at `:1156` records a real bug from exactly this kind of renumbering, where Mapping rendered in the strip's Review slot. The step model's tests are the safety net, so write them first.

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export type ImportStep = 1 | 2 | 3;` with 1 Source, 2 Mapping, 3 Review. `furthestStep` returns `1`, `2` or `3`. `StepGate` keeps all five booleans unchanged, `hasStoredFile` included: it still gates leaving Source.

- [ ] **Step 1: Rewrite the step model's tests for three steps**

In `apps/studio/src/facilities/stepModel.test.ts`, change every expectation that names a step. The mapping is mechanical: an old `3` becomes `2`, an old `4` becomes `3`, and any test asserting step `2` is reachable is deleted because there is no longer a step between Source and Mapping. Add these two, which pin the new shape:

```ts
it('a stored file earns Mapping, which is now step 2', () => {
  expect(furthestStep({
    hasFile: true, hasRegister: true, hasStoredFile: true, hasReview: false, runActive: false,
  })).toBe(2);
});

it('a summary earns Review, which is now step 3', () => {
  expect(furthestStep({
    hasFile: true, hasRegister: true, hasStoredFile: true, hasReview: true, runActive: false,
  })).toBe(3);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/stepModel.test.ts`
Expected: FAIL. `furthestStep` still returns 3 for a stored file and 4 for a summary.

- [ ] **Step 3: Renumber the step model**

In `apps/studio/src/facilities/stepModel.ts`:

```ts
/** Which of the import sheet's three steps the operator is on: 1 Source, 2 Mapping, 3 Review.
 *
 *  The sheet used to present five stages of work as one scrolling surface with no numbering and no
 *  way back, and every action for every stage in a single dropdown. This module is the "where am I"
 *  half of the fix. It holds no React state and no copy, so it can be tested as arithmetic.
 *
 *  There used to be a fourth step, Data, showing the uploaded file as a table. It was removed once
 *  the wizard worked end to end: every repair is made on the source file instead. It had never been
 *  on the forward path anyway, because this function never returned 2 for it. See the design spec's
 *  own note on the removal. */
export type ImportStep = 1 | 2 | 3;
```

and, in `furthestStep`, the last line becomes:

```ts
  return gate.hasReview ? 3 : 2;
```

Leave `StepGate` exactly as it is, including `hasStoredFile` and its docblock's first sentence. Edit only the half of that docblock that mentions the Data stage, so it reads that a stored file is what gives Mapping something to map.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/stepModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Drop Data from the strip**

In `apps/studio/src/facilities/ImportSteps.tsx`, the `STEPS` array becomes:

```ts
const STEPS: { step: ImportStep; key: string }[] = [
  { step: 1, key: 'facilities.import.steps.source' },
  { step: 2, key: 'facilities.import.steps.mapping' },
  { step: 3, key: 'facilities.import.steps.review' },
];
```

Nothing else in that file changes. It is presentational and decides nothing about reachability.

In `apps/studio/src/i18n/en.ts`, `fr.ts` and `pt.ts`, delete the `data` key from the `facilities.import.steps` block. In `en.ts` that is line 911. Leave `label`, `source`, `mapping` and `review`.

- [ ] **Step 6: Renumber the sheet**

In `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`, every `step === 3` becomes `step === 2`, every `step === 4` becomes `step === 3`, and every `setRequestedStep(3)` becomes `setRequestedStep(2)` and `setRequestedStep(4)` becomes `setRequestedStep(3)`. The sites, by line number before the edit:

- `:1279` `columnMapPanelShown = step === 3 && ...` becomes `step === 2`
- `:1785`, `:1800`, `:1979` the Mapping branches, `step === 3` becomes `step === 2`
- `:1666`, `:1669`, `:1687`, `:1694`, `:1703`, `:1828`, `:1844`, `:1991` the Review branches, `step === 4` becomes `step === 3`
- `:1171` and `:1175` in the advance effect, `3` becomes `2` and `4` becomes `3`
- `:1840` `onGoToMapping={() => setRequestedStep(3)}` becomes `setRequestedStep(2)`
- `:1950` `setRequestedStep(3)` becomes `setRequestedStep(2)`

Delete outright:
- `:1432-1435` the `{step === 2 && runId && (` block that renders `DataGridStep`
- `:1949-1953` the `{step === 2 && (` footer Continue button
- `:884` `setRequestedStep(2)` becomes `setRequestedStep(2)` unchanged in value but check what it means now: read its surrounding comment, and if it was sending the operator to Data after an upload, it must send them to Mapping, which is now 2. Keep the literal `2`, and correct the comment.

The comments at `:319`, `:1156` and `:1157` describe the old four-step numbering and the Data step. Rewrite them to describe what is true now. Do not delete the `:1156` comment's warning about the off-by-one bug; that warning is the reason this task is atomic, and it should survive with the new numbers.

`step === 1` sites are unchanged.

- [ ] **Step 7: Fix the sheet's tests**

`apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx` has 42 lines mentioning Data or a step number. Update every step number the same way, delete any test whose subject is the Data step itself, and delete the `DataGridStep` entry from the file's `vi.mock('@/api')` factory if it has one.

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/ImportFacilitiesSheet.test.tsx src/facilities/stepModel.test.ts`
Expected: PASS. The grid component still exists at this point, so its own test file is untouched and still passes; Task 2 deletes both.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/facilities/stepModel.ts apps/studio/src/facilities/stepModel.test.ts apps/studio/src/facilities/ImportSteps.tsx apps/studio/src/facilities/ImportFacilitiesSheet.tsx apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx apps/studio/src/i18n
git commit -m "refactor(facilities): the import wizard is three steps, not four"
```

---

### Task 2: Delete the grid, the dialog and their clients

**Files:**
- Delete: `apps/studio/src/facilities/DataGridStep.tsx`, `DataGridStep.test.tsx`
- Delete: `apps/studio/src/facilities/CellEditChoiceDialog.tsx`, `CellEditChoiceDialog.test.tsx`
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`

**Interfaces:**
- Consumes: Task 1 removed the only render site of `DataGridStep`, so nothing imports it now.
- Produces: `apps/studio/src/api.ts` loses `FacilityImportRows`, `readFacilityImportRows`, `FacilityImportEdit`, `readFacilityImportEdits`, `putFacilityImportEdit` and `deleteFacilityImportEdit`.

- [ ] **Step 1: Confirm nothing else imports them**

Run these and read the output before deleting anything:

```bash
grep -rn "DataGridStep\|CellEditChoiceDialog" apps/studio/src --include=*.ts --include=*.tsx
grep -rn "readFacilityImportRows\|FacilityImportRows\|readFacilityImportEdits\|putFacilityImportEdit\|deleteFacilityImportEdit" apps/studio/src --include=*.ts --include=*.tsx
```

Expected: the only hits are the four files being deleted, plus the `api.ts` definitions. If anything else appears, stop and report it rather than deleting.

Note that `apps/studio/src/pages/Facilities.test.tsx` mocked `readFacilityImportRows` at one point. If it still does, remove that mock entry in this task.

- [ ] **Step 2: Delete the four files**

```bash
git rm apps/studio/src/facilities/DataGridStep.tsx apps/studio/src/facilities/DataGridStep.test.tsx apps/studio/src/facilities/CellEditChoiceDialog.tsx apps/studio/src/facilities/CellEditChoiceDialog.test.tsx
```

- [ ] **Step 3: Remove the api clients**

In `apps/studio/src/api.ts`, delete the `FacilityImportRows` interface, the `readFacilityImportRows` function, the `FacilityImportEdit` interface, and the three edit functions `readFacilityImportEdits`, `putFacilityImportEdit` and `deleteFacilityImportEdit`, with their docblocks. Leave `getFacilityImportRun`, `uploadFacilityImport`, `FacilityImportConfirmOptions` and everything else untouched.

- [ ] **Step 4: Remove the sheet's controlled-header memo**

In `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`, delete the `controlledHeaders` `useMemo` (around line 311) that existed only to feed the grid's dialog. If `CONTROLLED_FIELDS` or `ControlledField` become unused imports in that file as a result, remove them too. Run the typecheck to find out rather than guessing.

- [ ] **Step 5: Remove the grid's copy**

In `apps/studio/src/i18n/en.ts`, delete these keys, and delete the matching keys from `fr.ts` and `pt.ts` in the same commit:

```
rowsFailed, rowsEmpty, rowsEmptySkipped_one, rowsEmptySkipped_other,
rowsSkipped_one, rowsSkipped_other, rowsDesktopOnly,
editCellLabel, editUndo, editUndoSweep,
editScopeTitle, editScopeBody, editScopeRow, editScopeEverywhere,
raggedRowNote, editWriteFailed
```

In `en.ts` those are lines 955 to 974, minus `noRowsFound` and `noRowsFoundSkipped`, which belong to the Review step's refusal copy and STAY. Check each key against a grep before deleting it:

```bash
grep -rn "noRowsFound" apps/studio/src --include=*.tsx
```

- [ ] **Step 6: Run the studio suite and the typecheck**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities src/i18n src/pages/Facilities.test.tsx`
Expected: PASS.

Run: `pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: clean. This is what catches an import left behind.

- [ ] **Step 7: Commit**

```bash
git add -A apps/studio/src
git commit -m "refactor(facilities): remove the data grid, the cell-edit dialog and their clients"
```

---

### Task 3: Remove the stale-invalidation threading

**Files:**
- Modify: `apps/studio/src/facilities/importInputsSignature.ts`, `importInputsSignature.test.ts`
- Modify: `apps/studio/src/facilities/mappingCheckState.ts`
- Modify: `apps/studio/src/facilities/ColumnMapStep.tsx`, `ColumnMapStep.test.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`

**What this removes and why it is safe.** `cellEditsAt` existed so a cell edit would make the last column check stale and make Review fall away. With no cell edits, nothing can change what the file parses to between a check and a validate, so the counter has nothing to report. The other half of `stale`, `check.target !== selected`, predates Slice C and STAYS: a row whose target moved still needs re-checking.

**Interfaces:**
- Consumes: nothing from Task 2 beyond the grid being gone, which removed the only caller of `onEditsChanged`.
- Produces: `ImportInputs` loses `cellEditsAt`. `RowCheck` loses `editsAt`. `ColumnMapStep` loses its `cellEditsAt` prop.

- [ ] **Step 1: Remove the signature field and its tests**

In `apps/studio/src/facilities/importInputsSignature.ts`, delete the `cellEditsAt` field from `ImportInputs` with its docblock, and remove `i.cellEditsAt` from the array in `summarySignature`. `worklistSignature` never carried it and does not change.

In `importInputsSignature.test.ts`, delete `cellEditsAt` from the `const base: ImportInputs` fixture at line 4, and delete the two tests that assert it changes the summary signature and does not change the worklist signature.

- [ ] **Step 2: Remove the row-check stamp**

In `apps/studio/src/facilities/mappingCheckState.ts`, delete the `editsAt` field from `RowCheck` with its docblock.

- [ ] **Step 3: Remove the panel's prop and narrow the stale test**

In `apps/studio/src/facilities/ColumnMapStep.tsx`:
- delete the `cellEditsAt` prop from the props interface and from the destructure, including its default of 0
- every site that stamps `editsAt` onto a `RowCheck` loses that field. There are four, around lines 436, 444, 467 and 532. The typecheck will name any you miss, because `RowCheck` no longer has the field.
- the stale comparison goes back to one clause:

```ts
          // A row goes stale when its TARGET moved. That is the only thing that can change what a
          // check would answer now: the file itself is immutable once stored.
          const stale = !!check && check.target !== selected;
```

In `ColumnMapStep.test.tsx`, delete the test that bumps `cellEditsAt` and expects the row to go stale, and remove `cellEditsAt` from the props the test helper passes.

- [ ] **Step 4: Remove the sheet's counter**

In `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`, delete the `cellEditsAt` state and its setter, remove `cellEditsAt` from the `inputs` object, remove the `cellEditsAt` prop passed to `ColumnMapStep`, and remove the reset of it beside `checkState.reset()`.

- [ ] **Step 5: Run the suite and the typecheck**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities`
Expected: PASS.

Run: `pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/facilities
git commit -m "refactor(facilities): a check goes stale only when its target moves"
```

---

### Task 4: Remove the server routes

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Modify: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 removed the studio clients, so these four routes now have no caller.
- Produces: `GET /runs/:id/rows`, `GET /runs/:id/edits`, `PUT /runs/:id/edits` and `DELETE /runs/:id/edits` no longer exist. `GET /runs/:id/columns/:header/values` STAYS, untouched: it is Slice B's, it feeds the Mapping step's worklist, and it is how the wizard still works.

- [ ] **Step 1: Delete the four routes**

In `apps/server/src/facilities-routes.ts`:

- Delete the `GET /api/facilities/import/runs/:id/rows` handler at around line 2985, with the whole comment block above it that starts "Task 3 (facility-import-data-stage, Slice A)". That block ends where the next route's comment begins.
- Delete the three edits routes at around lines 3065 to 3160, with their shared comment block and the `EditScopeSchema` and `EditSchema` zod objects defined just above them.
- Delete `const importEdits = createFacilityImportEditStore(ctx.internalDb);` at around line 820.
- Remove `createFacilityImportEditStore` and `readFileRows` from the `@openldr/db` and `@openldr/bootstrap` import lists at the top of the file.

Leave `FacilityFileUnreadableError` in the import list. The column-values route still catches it, at the second of its two original sites. Task 7 changes where that class is imported FROM, not whether it is imported.

- [ ] **Step 2: Delete their tests**

In `apps/server/src/facilities-routes.test.ts`, delete the describe block for the edits routes and every rows-route test. The rows-route tests include the one added for `lines`, which asserts `body.lines[0]` is 2.

Two tests in that file assert a whole response body with `toEqual` and were amended to carry `lines`. Find them and take `lines` back out rather than deleting the tests: they are about other routes.

```bash
grep -n "lines" apps/server/src/facilities-routes.test.ts
```

Read every hit before changing it.

- [ ] **Step 3: Run the route tests and the lint**

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts`
Expected: PASS. Report the count; it was 345 before this task.

Run: `pnpm --filter @openldr/server lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src
git commit -m "refactor(facilities): remove the paged-read and cell-edit routes"
```

---

### Task 5: Remove the import and worker threading

**Files:**
- Modify: `packages/bootstrap/src/facility-import.ts`, `facility-import.test.ts`
- Modify: `packages/bootstrap/src/facility-import-worker.ts`, `facility-import-worker.test.ts`
- Modify: `packages/bootstrap/src/index.ts`

**Interfaces:**
- Consumes: `FacilityCsvOptions.cellEdits` still exists at this point and stops being passed.
- Produces: `FacilityImportOptions` loses `cellEdits`. `toCellEdits` is gone. The worker's deps lose `edits` and the worker loses `cellEditsFor`.

- [ ] **Step 1: Delete the worker's overlay tests**

In `packages/bootstrap/src/facility-import-worker.test.ts`, delete the two cell-edit tests: the one asserting `facility_registry.level` reads the repaired value after a full validate, confirm and apply, and the one asserting the validate summary alone reports `{ parsed: 1, skipped: 0 }`. Remove the optional `edits` parameter from the `harness()` fixture.

In `packages/bootstrap/src/facility-import.test.ts`, delete the `describe('toCellEdits', ...)` block, 4 tests.

- [ ] **Step 2: Remove the worker's loader and dep**

In `packages/bootstrap/src/facility-import-worker.ts`:
- delete the `edits?: FacilityImportEditStore;` field from the worker deps interface with its docblock
- delete the `cellEditsFor` function
- narrow `validateOptions` and `applyOptions` back to taking only `run`, and delete the `cellEdits,` entry from each returned object
- at both call sites, delete the `const cellEdits = await cellEditsFor(run);` line and the second argument, so they read `validateOptions(run)` and `applyOptions(run)` again
- remove the now-unused imports: `toCellEdits`, `FacilityCellEdits`, `FacilityImportEditStore`

Delete the comment at the validate call site that explained why the overlay was loaded once for both phases. It describes a mechanism that no longer exists, and a comment about an absent guarantee is worse than no comment.

- [ ] **Step 3: Remove the option and the converter**

In `packages/bootstrap/src/facility-import.ts`:
- delete the `cellEdits?: FacilityCellEdits;` field from `FacilityImportOptions` with its docblock
- delete `cellEdits: opts.cellEdits,` from the `parseOpts` object
- delete the exported `toCellEdits` function with its docblock
- remove the now-unused `FacilityCellEdits` and `FacilityImportEdit` imports

- [ ] **Step 4: Remove the wiring**

In `packages/bootstrap/src/index.ts`:
- delete the `facilityImportEdits` construction
- delete `edits: facilityImportEdits,` from the worker deps object
- remove `createFacilityImportEditStore` from the `@openldr/db` import list

Do NOT touch the `readFileRows` export block in that file yet. Task 7 owns it.

- [ ] **Step 5: Run the bootstrap tests and the typecheck**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-import.test.ts src/facility-import-worker.test.ts`
Expected: PASS. Report the counts; they were 86 and 37.

Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src
git commit -m "refactor(facilities): validate and apply read the stored file directly"
```

---

### Task 6: Remove the parser overlay

**Files:**
- Modify: `packages/terminology/src/facility-csv.ts`
- Modify: `packages/terminology/src/facility-csv.test.ts`

**Interfaces:**
- Consumes: Task 5 removed the last caller that passes `cellEdits` into the parser, so the option can now go without breaking the build.
- Produces: `FacilityCellEdits` and `FacilityCsvOptions.cellEdits` no longer exist.

- [ ] **Step 1: Delete the overlay tests**

In `packages/terminology/src/facility-csv.test.ts`, delete the whole `describe('parseFacilityCsv cell edits', ...)` block, 10 tests.

- [ ] **Step 2: Delete the option and the type**

In `packages/terminology/src/facility-csv.ts`:
- delete the `FacilityCellEdits` interface with its docblock, which sits just before `FacilityCsvOptions`
- delete the `cellEdits?: FacilityCellEdits;` field from `FacilityCsvOptions` with its docblock

- [ ] **Step 3: Delete the overlay from the row loop**

In the same file, delete two blocks inside `parseFacilityCsv`:
- the one-time case fold that builds the lowercased cell-edit maps, which sits before the row loop and carries the comment about `columnMap` applying the same fold
- the `if (opts.cellEdits) { ... }` patch inside the row loop, which sits immediately after the field-count quarantine `continue` and before `const r: Record<string, string> = {};`

The field-count quarantine, `r`, the constants loop and everything after are unchanged.

- [ ] **Step 4: Run the terminology tests**

Run: `pnpm --filter @openldr/terminology exec vitest run src/facility-csv.test.ts`
Expected: PASS, 50 tests. It was 60 with the overlay block.

- [ ] **Step 5: Commit**

```bash
git add packages/terminology/src
git commit -m "refactor(facilities): the CSV parser reads the file as uploaded"
```

---

### Task 7: Move the error class, then delete the file-rows reader

**Files:**
- Delete: `packages/bootstrap/src/facility-file-rows.ts`, `facility-file-rows.test.ts`
- Modify: `packages/bootstrap/src/facility-column-values.ts`
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `apps/server/src/facilities-routes.ts` (one import line)

**The one thing that makes this task more than a delete.** `FacilityFileUnreadableError` is DEFINED in `facility-file-rows.ts:43` and is still needed. `packages/bootstrap/src/facility-column-values.ts:4` imports it and `:92` throws it, and that file is Slice B's column-values reader, which stays and is how the Mapping step's worklist gets its values. Deleting the file without moving the class breaks the wizard.

`stripBom` needs no moving: `facility-column-values.ts:21` already has its own copy.

**Interfaces:**
- Consumes: Task 4 removed the `/rows` route, the only caller of `readFileRows`.
- Produces: `FacilityFileUnreadableError` is exported from `packages/bootstrap/src/facility-column-values.ts`. `readFileRows`, `FileRowWindow` and `ReadFileRowsOptions` no longer exist.

- [ ] **Step 1: Confirm the reader has no callers left**

```bash
grep -rn "readFileRows\|FileRowWindow\|ReadFileRowsOptions" apps packages --include=*.ts --include=*.tsx
```

Expected: hits only inside `facility-file-rows.ts`, its test, and the export block in `packages/bootstrap/src/index.ts:1708`. Comments in `facility-column-values.ts` also mention `readFileRows` by name; those are prose and Step 3 rewrites them. If a real caller appears, stop and report it.

- [ ] **Step 2: Move the error class**

Cut the whole `FacilityFileUnreadableError` class, with its docblock, out of `packages/bootstrap/src/facility-file-rows.ts` and paste it into `packages/bootstrap/src/facility-column-values.ts`, above the first function that uses it. Then delete the `import { FacilityFileUnreadableError } from './facility-file-rows';` line at the top of that file.

Add one sentence to the class docblock recording why it lives here now:

```ts
/** ... existing docblock text ...
 *
 *  Defined here because this is the only thing that throws it. It used to live in
 *  `facility-file-rows.ts`, alongside the paged reader that fed the import wizard's Data step; that
 *  step and its reader were removed once every repair moved to the source file. */
```

- [ ] **Step 3: Delete the reader**

```bash
git rm packages/bootstrap/src/facility-file-rows.ts packages/bootstrap/src/facility-file-rows.test.ts
```

Then fix the two comments in `facility-column-values.ts` that say "Same parser and options as `readFileRows`'s `readCsvRows`" and "Same line-by-line JSONL read as `readFileRows`". They now point at a file that does not exist. Rewrite each to state the setting it was justifying, without naming the deleted function.

- [ ] **Step 4: Fix the two export sites**

In `packages/bootstrap/src/index.ts`, replace the export block at line 1708:

```ts
export {
  readColumnValues, FacilityFileUnreadableError,
  type ColumnValues, type ReadColumnValuesOptions,
} from './facility-column-values';
```

and delete the old `./facility-file-rows` export block and the separate `readColumnValues` export line, so there is one block for that module rather than two.

In `apps/server/src/facilities-routes.ts`, the import at line 21 already names `FacilityFileUnreadableError` from `@openldr/bootstrap` rather than from a file, so it keeps working and needs no change. Verify that by reading the line; if it imports from a deep path, repoint it.

- [ ] **Step 5: Run the bootstrap and server tests plus both typechecks**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-column-values.test.ts`
Expected: PASS.

Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit` and `pnpm --filter @openldr/server exec tsc --noEmit`
Expected: both clean.

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts`
Expected: PASS. This is what proves the column-values route still answers 422 on an unreadable file, which is the behaviour the moved class carries.

- [ ] **Step 6: Commit**

```bash
git add -A packages/bootstrap/src apps/server/src
git commit -m "refactor(facilities): the unreadable-file error moves to its only thrower"
```

---

### Task 8: Remove the store and drop the table

**Files:**
- Delete: `packages/db/src/facility-import-edit-store.ts`, `facility-import-edit-store.test.ts`
- Create: `packages/db/src/migrations/internal/092_drop_facility_import_edits.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`

**Why `091` is not deleted.** It is applied and recorded in `kysely_migration` on the operator's dev database, proven live when the route answered `200 {"edits":[]}`. Deleting the file would leave Kysely a recorded migration with no file, and the next feature's `091` would collide. The file stays as history and `092` undoes its effect.

**Interfaces:**
- Consumes: Tasks 4 and 6 removed both callers of the store.
- Produces: `createFacilityImportEditStore`, `FacilityImportEdit` and `FacilityImportEditStore` no longer exist. `facility_import_edits` no longer exists in the database or in `InternalSchema`.

- [ ] **Step 1: Confirm the store has no callers**

```bash
grep -rn "createFacilityImportEditStore\|FacilityImportEditStore\|FacilityImportEdit\b\|facility_import_edits" apps packages --include=*.ts --include=*.tsx
```

Expected: hits only in the store and its test, the `index.ts` exports, the `InternalSchema` table type, and migration `091`. Anything else means an earlier task left something behind; stop and report it.

- [ ] **Step 2: Write the migration**

Create `packages/db/src/migrations/internal/092_drop_facility_import_edits.ts`:

```ts
import { type Kysely, sql } from 'kysely';

// Drops the table migration 091 created. The facility import's Data step let an operator repair a
// cell in the uploaded file, and the repairs lived here. The step was removed once the wizard worked
// end to end: every repair is made on the source file instead.
//
// 091 IS NOT DELETED, deliberately. It is already applied and recorded in `kysely_migration` on
// running installs. Removing the file would leave Kysely a recorded migration with no file, and the
// next feature to claim 091 would collide. So the history stays linear and this undoes the effect.
//
// `if exists`, because an install that never reached 091 has no table to drop and this must not be
// the migration that blocks its boot.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists facility_import_edits`.execute(db);
}

// Recreates the table exactly as 091 built it, so a down-migration past this point leaves 091's
// schema intact. The rows are gone either way: a drop is not reversible.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('facility_import_edits')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('national_system', 'text', (c) => c.notNull())
    .addColumn('file_hash', 'text', (c) => c.notNull())
    .addColumn('header', 'text', (c) => c.notNull())
    .addColumn('line', 'integer')
    .addColumn('from_value', 'text')
    .addColumn('to_value', 'text', (c) => c.notNull())
    .addColumn('edit_key', 'text', (c) => c.notNull())
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`create unique index facility_import_edits_key on facility_import_edits (edit_key)`.execute(db);

  await db.schema.createIndex('facility_import_edits_file')
    .on('facility_import_edits').columns(['national_system', 'file_hash']).execute();
}
```

- [ ] **Step 3: Register it**

In `packages/db/src/migrations/internal/index.ts`, after the `m091` import:

```ts
import * as m092 from './092_drop_facility_import_edits';
```

and after the `'091_facility_import_edits'` entry:

```ts
  '092_drop_facility_import_edits': { up: m092.up, down: m092.down },
```

In `packages/db/src/migrations/migrations.test.ts`, add `'092_drop_facility_import_edits'` to the hardcoded migration-name list. That list is why registering a migration without touching this file fails.

- [ ] **Step 4: Run the migration suite and watch it pass**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations`
Expected: PASS. A failure naming a missing or out-of-order migration means Step 3 is incomplete.

- [ ] **Step 5: Delete the store and its schema type**

```bash
git rm packages/db/src/facility-import-edit-store.ts packages/db/src/facility-import-edit-store.test.ts
```

In `packages/db/src/index.ts`, delete the two export lines for `createFacilityImportEditStore` and its types.

In `packages/db/src/schema/internal.ts`, delete the `FacilityImportEditsTable` interface with its docblock, and delete the `facility_import_edits: FacilityImportEditsTable;` line from `InternalSchema`.

Migration `092`'s `down` uses the Kysely schema builder on `Kysely<unknown>`, so it does not need the type and still compiles.

- [ ] **Step 6: Run the db suite and the typecheck**

Run: `pnpm --filter @openldr/db exec vitest run`
Expected: PASS.

Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add -A packages/db/src
git commit -m "refactor(facilities): drop the cell-edits table and its store"
```

---

### Task 9: Documentation, the spec, and the parked plan

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/facilities.md`, and the `fr` and `pt` siblings
- Modify: `apps/web/src/docs/0.1.0/facilities.md`
- Modify: `docs/superpowers/specs/2026-09-08-facility-import-data-stage-design.md`
- Modify: `docs/superpowers/plans/2026-09-09-facility-import-cell-edits-slice-c.md`

**The i18n keys are already gone.** Task 2 removed them from all three locales. If `pnpm --filter @openldr/studio exec vitest run src/i18n` is not green when you start, an earlier task is incomplete; report it rather than patching it here.

- [ ] **Step 1: Remove the documentation sections**

In each of the four documentation files, delete the cell-edit section and correct every sentence that says the wizard has four steps or names a Data step. The places, by line number before the edit:

`apps/studio/src/docs/0.1.0/en/facilities.md`
- `:19` heading "The four steps of the import wizard" becomes three
- `:21` the sentence listing "Source, Data, Mapping, and Review"
- `:129` to the end of that section, the whole "### Repairing a cell on the Data step"
- `:205` a sentence inside the column-map material that describes the Data step showing the file as a read only table

`apps/studio/src/docs/0.1.0/fr/facilities.md`
- `:21` "Les quatre étapes", `:23` the list naming "Données"
- `:142` the whole "### Corriger une cellule à l'étape Données"
- the sentence matching the English `:205`, found by structure

`apps/studio/src/docs/0.1.0/pt/facilities.md`
- `:21` "Os quatro passos", `:23` the list naming "Dados"
- `:136` the whole "### Corrigir uma célula no passo Dados"
- `:217` the sentence describing "O passo Dados"

`apps/web/src/docs/0.1.0/facilities.md`
- `:59` heading "The import wizard's four steps"
- `:61` the sentence listing the steps, which names "Data (the stored file as a ...)"
- `:120` the whole "### Repairing a cell on the Data step"

Search each file afterwards for anything left behind:

```bash
grep -rn "four steps\|quatre étapes\|quatro passos\|Data step\|étape Données\|passo Dados" apps/studio/src/docs apps/web/src/docs
```

Expected: no hits.

Do not add a sentence explaining that a step was removed. In-app documentation tells an operator how the app works now, not what it used to do. The history belongs in the spec.

- [ ] **Step 2: Record the removal in the spec**

In `docs/superpowers/specs/2026-09-08-facility-import-data-stage-design.md`, change the Status line to say the Data stage and Slice C were removed, and add one section near the end. Write it in the operator's register, short sentences, no em dashes. That file predates the no-em-dash rule and keeps its own; do not copy them and do not reformat the rest of it.

The section has to say four things:

1. The Data stage and all of Slice C were removed on 2026-09-10, after the operator ran the whole wizard against the real Zambia export and reached a working import. Their verdict: overkill, every repair is made on the source file, and the step did not work on a phone.
2. The stage was never on the forward path. `stepModel.ts`'s `furthestStep` returned 1, 3 or 4 and never 2, so step 2 was only ever reachable by clicking it in the strip.
3. The problem the stage was built for was solved by Slice B instead. The spec's case was "you map blind"; Slice B answered it by putting a column's unrecognised values in a worklist under the mapping row they belong to.
4. The parked finding about the confirm gate not pinning the overlay it validated is closed by the removal, not by a fix. `facilities-routes.ts` records the original guarantee: `ConfirmSchema` has no `columnMap` key, so an apply runs with the same map its validate did, by construction rather than by any comparison. Slice C broke that by adding a mutable overlay the worker read twice. Removing the overlay restores it.

Also note what was deliberately KEPT, so a later reader does not think it was missed: migration `091`, because it is recorded on running installs, with `092` undoing its effect; and `FacilityFileUnreadableError`, moved to `facility-column-values.ts` because Slice B's column-values reader still throws it.

- [ ] **Step 3: Park the plan**

At the very top of `docs/superpowers/plans/2026-09-09-facility-import-cell-edits-slice-c.md`, above the existing first heading, add a short block. Change nothing else in that file: it is the record of a slice that was really built, and rewriting it would falsify the history.

```markdown
> **PARKED, 2026-09-10.** This slice was built, merged at `416d2131`, and then removed along with
> the Data step it served. The operator's call after running the whole wizard against the real
> Zambia export: overkill, and every repair is made on the source file instead. The removal is its
> own plan, `2026-09-10-remove-the-data-step.md`, and the reasoning is recorded in the spec.
>
> Nothing below is wrong. If cell editing is ever wanted again, this is the design to start from,
> with three things already known: `csv-parse`'s `info.lines` names the line a record FINISHES on;
> the paged read does not lowercase headers while `parseFacilityCsv` does; and a row quarantined for
> its field count cannot be rescued by any edit.
```

- [ ] **Step 4: Run the docs and i18n tests**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs src/i18n`
Expected: PASS. Report the counts; they were 64 and 12.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/docs apps/web/src/docs docs/superpowers
git commit -m "docs(facilities): the wizard is three steps, and the spec records why"
```

---

## Verification, and its limits

Run all of it before calling this done.

**1. The full gate.**

```bash
pnpm turbo run test --concurrency=2 --force > /tmp/remove-data-gate.txt 2>&1; echo "exit=$?"; grep -E "^ Tasks:|Test timed out" /tmp/remove-data-gate.txt
```

`--force` because a cached green run proves nothing. Never pipe turbo itself through `tail`: redirect first, then read the file. A failure is more often a timeout than a regression, so grep for `Test timed out` and re-run that package alone before blaming a change.

**2. The server lint**, the only real lint here.

```bash
pnpm --filter @openldr/server lint
```

**3. Every package's typecheck.** A removal's characteristic failure is an import left behind, and only the typecheck finds it.

```bash
pnpm turbo run typecheck
```

**4. The migration on a real boot.** pg-mem cannot catch a numbering problem, and `092` drops a table that exists on the operator's dev database. Boot the stack once against the real database and confirm `092` applied and the app serves. The operator's dev servers run from the main checkout with `MIGRATE_ON_START=true`, so a restart there applies it. Do not kill their servers without being asked.

**5. A live pass through the wizard**, because no test in this repo renders the sheet against a real server. Upload the Zambia export, confirm the strip shows three steps, map a column, check a row, validate, and reach Review. Say what you actually saw.

**Two limits to state in the reports rather than find again.**

No test asserts what the step strip renders against a real browser. The step model is tested as arithmetic and the sheet is tested with a mocked api. An off-by-one between them is exactly the bug the sheet's own comment at `:1156` records, and only step 5 above would catch it.

Dropping a table is not reversible. `092`'s `down` recreates the schema, not the rows. Any edit an operator had recorded is gone when `092` runs. On the operator's dev database that is one test row this session already deleted, so nothing real is lost, but say so rather than implying the migration is round-trippable.

## Self-review

Checked against the goal after writing.

**Coverage.** Every surface the inventory found has a task: the studio grid and dialog (2), their clients (2), the step model and strip (1), the stale threading (3), the four routes (4), the import and worker threading (5), the parser overlay (6), the reader and its error class (7), the store and the table (8), the copy (2), the documentation and the spec (9).

**Order.** Consumers before producers throughout, so every commit typechecks. The two places that could have gone wrong: the import and worker threading (5) comes before the parser overlay (6), because the worker is what passes the option; and the error class moves (7) before its file is deleted, in the same task, because Slice B still throws it.

**What is NOT removed, deliberately.** `GET /runs/:id/columns/:header/values` and `readColumnValues` stay: they are Slice B's and they are how the Mapping step's worklist gets its values. `noRowsFound` and `noRowsFoundSkipped` stay: they are Review's refusal copy. Migration `091` stays. `StepGate.hasStoredFile` stays: it still gates leaving Source. The `stale` comparison keeps its `check.target !== selected` clause.

**After the merge, not before.** Run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json`. The generator reads git history, so it cannot see commits that are not there yet. This slice is `refactor` and `docs` commits, which the generator does not publish, so expect no new entries and run it anyway.
