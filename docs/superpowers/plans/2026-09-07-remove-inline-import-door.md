# Remove the inline import door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The facility import wizard sends a file one way, through the upload route, and stops
reading the whole file into the browser tab.

**Architecture:** Delete `runPreview`, `handleApplyConfirm` and everything gated on
`previewResult` from `ImportFacilitiesSheet.tsx`. Replace the whole-file `f.text()` read with a
64 KiB head slice, which is all the header-row suggestion ever needed. Re-point the tests that
proved importer reporting through the cheap door at the streamed door instead.

**Tech Stack:** React 18, Vite, Tailwind, shadcn/Radix, vitest, @testing-library/react (jsdom),
react-i18next.

**Spec:** `docs/superpowers/specs/2026-09-07-remove-inline-import-door-design.md`

## Global Constraints

- **The server route stays.** Do not touch `POST /api/facilities/import` in
  `apps/server/src/facilities-routes.ts`, and do not touch its tests in
  `apps/server/src/facilities-routes.test.ts`. Do not delete `importFacilitiesCsv` from
  `apps/studio/src/api.ts`. Operator decision, 2026-09-07.
- **No CLI change.** The CLI calls `importFacilities` from `@openldr/bootstrap` directly. It never
  used this door.
- **`HEAD_BYTES = 64 * 1024`.**
- **Tests run with** `npx vitest run <path> --root apps/studio --testTimeout 30000 --hookTimeout 30000`.
  `pnpm --filter @openldr/studio test -- <path>` does NOT filter; it silently runs all 221 files.
- **No `Co-Authored-By` trailers** (`AGENTS.md` section 9).
- **Order matters.** Tasks 1 to 4 re-point tests with NO production change, so each re-pointed test
  must pass against the current code. That is the whole discipline of this slice: a re-point that
  needed the deletion to pass was an assertion that changed, not an assertion that moved.
- **Every line number in this plan is against `2045413c`, and they drift as you delete.** Use them
  to find the code, never to address it. Search for the identifier and confirm what you are about to
  delete before deleting it. This bit an earlier slice on this same file: a value was removed one
  commit before its reader disappeared, and nothing failed until the next task.

---

## The test verdict table

`ImportFacilitiesSheet.test.tsx`, 102 `it` blocks. 48 drive the inline door only. Every one has a
verdict here. Do not decide any of these on contact.

| Line | Test | Verdict | Why |
|---|---|---|---|
| 218 | renders a Select, sends the URI never the display name | RE-POINT (task 3) | asserts the register identity on the request |
| 285 | "Register a source" refreshes the empty picklist | DROP MOCK (task 2) | it never previews; the mock is unused |
| 344 | never applies straight from the file picker | DELETE (task 5) | covered by 1373 and 2462 |
| 366 | shows the dry-run summary, then applies and reloads | DELETE (task 5) | covered by 1559 |
| 394 | parsed 0, no unknown columns reads as "nothing found" | RE-POINT (task 2) | reporting |
| 407 | unknown columns, explicit opt-in, names the columns | RE-POINT (task 2), SECOND HALF DELETED | the "re-previews once checked" half is covered by 1798 |
| 444 | quarantined line numbers, count, blocks Apply | RE-POINT (task 2) | reporting plus the withheld action |
| 489 | refuses Apply for a duplicate-header file | RE-POINT (task 2) | reporting plus the withheld action |
| 514 | sends allowMalformedRows true on Apply | DELETE (task 5) | covered by 1928 |
| 557 | re-imposes the quarantine block on un-tick | RE-POINT (task 2) | `blockedFor` reads the live checkbox on both doors |
| 603 | surfaces duplicates as a visible warning | RE-POINT (task 2) | reporting |
| 615 | a malformed-CSV 400 surfaces the server message | RE-POINT (task 4) | reject the upload instead |
| 629 | renders the over-cap 400 helpfully | DELETE (task 5) | the inline route's row cap |
| 661 | warns when a dry run exceeds the 2000-row cap | DELETE (task 5) | `overCap`; streamed covered by 1543 |
| 690 | F2: a wrong file still states an outcome | RE-POINT (task 2) | reporting |
| 727 | F3: headline count reflects create+changed | RE-POINT (task 2), CONFIRM-BODY ASSERTION DELETED | the apply-confirm dialog is gone |
| 750 | F3 regression: byte-identical re-import | RE-POINT (task 2) | reporting |
| 763 | F4: the 8MB size-cap 400 | DELETE (task 5) | the inline route's byte cap; streamed covered by 1575 |
| 794 | F6: the apply-confirm Cancel button is translated | DELETE (task 5) | the dialog is gone |
| 813 | create/changed/unchanged breakdown | RE-POINT (task 2) | reporting |
| 829 | conflict null as "not evaluated" | RE-POINT (task 2) | reporting |
| 855 | a non-zero conflict count | RE-POINT (task 2) | reporting |
| 869 | absent null as "not evaluated" | RE-POINT (task 2) | reporting |
| 886 | a changed-row sample shows the before/after diff | RE-POINT (task 2) | reporting |
| 909 | retirement choices stay off when nothing to retire | RE-POINT (task 2) | reporting |
| 932 | offers an overwrite choice once a runId exists | RE-POINT (task 2) | retitle: a run always has one |
| 950 | the overwrite choice stays off without a runId | DELETE (task 5) | unreachable: every streamed summary has a runId |
| 962 | retirement choice for declared-removed rows | RE-POINT (task 2) | reporting |
| 977 | retirement choice for merely-absent rows | RE-POINT (task 2) | reporting |
| 991 | Apply carries retirement choices AND the runId | DELETE (task 5) | covered by 1341 |
| 1027 | Apply carries the overwrite choice | DELETE (task 5) | covered by 1341 |
| 1056 | Apply sends the default onConflict skip | RE-POINT (task 3) | NOT covered: 1676 asserts omission, not defaults |
| 1074 | warns about an unrecognised national system | RE-POINT (task 2) | reporting |
| 1089 | applied summary reads written.created/updated | RE-POINT (task 2) | `status: 'applied'` |
| 1105 | CT-3: format/completeRelease/releaseVersion on both requests | RE-POINT (task 3) | asserts request contents |
| 1138 | CT-3: invalid-coordinate rows with line numbers | RE-POINT (task 2), SECOND HALF DELETED | the "override re-previews" half is covered by 1888 |
| 1169 | CT-3/Task 8: pick-list row per unmapped value | RE-POINT (task 2) | reporting |
| 1195 | CT-3: JSONL declared/parsed count mismatch | RE-POINT (task 2) | reporting |
| 1215 | CT-3: apply result shows conflict count and sample | RE-POINT (task 2) | `status: 'applied'` |
| 1233 | CT-3: apply result says "overwritten" not "skipped" | RE-POINT (task 2) | `status: 'applied'` |
| 1259 | CT-3: apply result silent when no conflicts | RE-POINT (task 2) | `status: 'applied'` |
| 2028 | Task 8: a seeded suggestion reaches the sent columnMap | RE-POINT (task 3) | asserts request contents |
| 2055 | Task 8: resets the column map on a file swap | RE-POINT (task 3) | asserts request contents |
| 2107 | renders columnMapErrors, keeps ColumnMapStep mounted | RE-POINT (task 2) | reporting; 2225 covers the re-upload, not the error content |
| 2146 | no columnMapErrors block once the file parses cleanly | RE-POINT (task 2) | reporting |
| 2181 | row-count hint and incomplete-map notice | RE-POINT (task 6), HINT ASSERTION DELETED | the hint itself is removed in task 6 |
| 2380 | Preview from the dropdown with no prior Continue | DELETE (task 5) | an inline-only retreat path; covered by 2225 |
| 2426 | says a CSV map was already sent, past Mapping | RE-POINT (task 2) | reporting |

Four more tests name no door but still name Preview or Apply:

| Line | Test | Verdict |
|---|---|---|
| 676 | Preview stays disabled until a file and a system are present | KEEP (task 5): drop the now-vacuous `queryByRole('menuitem', /preview/)` line |
| 777 | F5: a 0-byte CSV explains why Preview stays disabled | KEEP (task 6): same line dropped; the 0-byte assertion is what task 6 must not break |
| 1281 | A2b: Upload streams the File itself | KEEP (task 5): drop the `expect(api.importFacilitiesCsv).not.toHaveBeenCalled()` line |
| 2483 | shows exactly one primary action, with Preview still in the menu | REWRITE (task 5) |

`Facilities.test.tsx` has one inline test, re-pointed in task 7.

**Totals: 11 deleted, 36 re-pointed, 1 mock removal, 4 edited, 1 rewritten, 1 integration test
re-pointed.**

---

### Task 1: The test helper

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx` (helpers, near `uploadNow` at :169)

**Interfaces:**
- Consumes: `runView` (:154), `uploadNow` (:176), `pickFileAndSystem`, `baseResult` (:131), `mocked` (:168)
- Produces: `reviewWithSummary(summary, run?, csv?): Promise<void>` — used by tasks 2, 3, 4, 6.

- [ ] **Step 1: Add the helper**

Insert after `confirmNow` (ends :189), before `describe('ImportFacilitiesSheet', ...)`:

```tsx
/** Drive the STREAMED door until `summary` is rendered on Review.
 *
 *  The inline preview used to be the cheap way to put a `FacilityImportResult` on screen. With that
 *  door gone this is the only way, and it is also what an operator actually does: upload, the worker
 *  validates, the poll brings the summary back.
 *
 *  ⛔ NOT for a test that asserts what the UPLOAD was called with. This presses the button for you
 *  and supplies its own mocks, so those would be the thing under test rather than the subject. Such
 *  tests arrange by hand, exactly as the A2b tests at :1281 onward already do.
 *
 *  @param run Override the run row. `status: 'applied'` is how a test reaches `appliedSummary`.
 *  @param csv The fixture file's text, when the test cares about its headers.
 */
async function reviewWithSummary(
  summary: FacilityImportResult,
  run: Partial<FacilityImportRunView> = {},
  csv?: string,
): Promise<void> {
  mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
  mocked(api.getFacilityImportRun).mockResolvedValue(runView({
    status: 'awaiting_confirmation', phase: 'validated', summary, ...run,
  }));
  await pickFileAndSystem(csv);
  await uploadNow();
  // ⛔ Waits for the STEP, not for a text match. Every caller then asserts its own copy, and a
  // helper that waited on one caller's string would silently pass for a summary that never rendered.
  await waitFor(() => expect(screen.getByRole('button', { name: /3\s*Review/ }))
    .toHaveAttribute('aria-current', 'step'));
}
```

- [ ] **Step 2: Prove it on one test, and watch it fail first**

Take line 813, `renders the create/changed/unchanged breakdown the server classified, alongside the
headline count`. Replace its arrange block only. Before:

```tsx
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 7, create: 2, changed: 1, unchanged: 4,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();
```

After:

```tsx
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({ parsed: 7, create: 2, changed: 1, unchanged: 4 }));
```

**Every `expect` in the test stays byte-identical.** If one has to change, stop: the assertion did
not move, it changed, and that belongs in the verdict table as a DELETE with a reason.

- [ ] **Step 3: Run it**

```bash
npx vitest run src/facilities/ImportFacilitiesSheet.test.tsx --root apps/studio --testTimeout 30000 --hookTimeout 30000 -t "renders the create/changed/unchanged breakdown"
```

Expected: PASS, against unmodified production code.

- [ ] **Step 4: Run the whole file**

```bash
npx vitest run src/facilities --root apps/studio --testTimeout 30000 --hookTimeout 30000
```

Expected: 279 passed. Same as the baseline.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx
git commit -m "test(facilities): a helper that reaches Review through the upload door"
```

---

### Task 2: Re-point the reporting tests

The bulk. 25 tests that assert how a `FacilityImportResult` is rendered, plus one unused mock.

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

**Interfaces:**
- Consumes: `reviewWithSummary` from task 1.
- Produces: nothing new.

- [ ] **Step 1: Re-point the plain reporting tests**

Lines 394, 444, 489, 557, 603, 690, 750, 829, 855, 869, 886, 909, 932, 962, 977, 1074, 1169, 1195,
2107, 2146, 2426. For each, apply the same edit as task 1 step 2: delete the
`importFacilitiesCsv` mock and the `previewNow()` call, and put the fixture through
`reviewWithSummary`.

Three need more than the mechanical swap:

- **444, 489, 557** assert Apply is withheld. On the streamed door the withheld action is Confirm.
  Change `queryByRole('menuitem', { name: /^apply$/i })` to
  `queryByRole('button', { name: 'Confirm import' })`, which is what `canConfirmRun` gates. 557 also
  uses `forwardToReview()` after ticking the box; that helper still works, because
  `allowMalformedRows` is deliberately absent from `summarySignature`.
- **932** is titled "once a preview has minted a runId". A streamed run always has one, so retitle
  to `offers an overwrite choice when the summary reports a conflict, defaulting to Skip` and drop
  the `runId: 'run-44'` from the fixture, since `runView` supplies the id.
- **2107 and 2146** pass a fixture CSV. Pass it through `reviewWithSummary`'s third argument.

- [ ] **Step 2: Re-point the applied-result tests**

Lines 1089, 1215, 1233, 1259. These read `appliedSummary`, which on the streamed door is
`run.status === 'applied' ? run.summary : null`. So:

```tsx
    await reviewWithSummary(
      baseResult({ parsed: 3, written: { created: 2, updated: 1, retired: 0 } }),
      { status: 'applied' },
    );
```

⛔ A test that also drove Apply through the menu drops those two lines. The summary is already the
applied one; there is nothing left to click.

- [ ] **Step 3: Split the two half-inline tests**

**407.** Keep everything up to and including
`expect(await screen.findByText(/weird_col, other_col/)).toBeInTheDocument();`. Delete from
`await backToMapping();` to the end, and delete the second `mockResolvedValueOnce`. Retitle to
`shows unknown columns and names them`. Add above it:

```tsx
  // The opt-in's own round trip is 1798's ("the run door re-uploads the same file with
  // allowUnknownColumns"). This test is the amber box's copy, nothing more.
```

**1138.** Same shape. Keep to
`expect(screen.getByText(/line 2 — latitude: 95\.0/)).toBeInTheDocument();`, delete the rest and the
second mock, retitle to `CT-3: renders invalid-coordinate rows with line numbers`, and point the
comment at 1888.

**727.** Keep the headline-count assertion. Delete the apply-confirm dialog assertions and the
`clickMenuItem(/^apply$/i)` that reaches them. Retitle to
`F3: the headline row count reflects what the server classified as create+changed, not raw parsed`.

- [ ] **Step 4: Drop the unused mock at 285**

Delete the `importFacilitiesCsv` line. Nothing else in that test changes.

- [ ] **Step 5: Run**

```bash
npx vitest run src/facilities --root apps/studio --testTimeout 30000 --hookTimeout 30000
```

Expected: PASS, still against unmodified production code. Count will be 279 minus nothing: no test
is deleted in this task.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx
git commit -m "test(facilities): the reporting tests read a summary from the run"
```

---

### Task 3: Re-point the request-contents tests

Different risk from task 2. These assert what was SENT, and the two doors send it differently: the
inline door puts everything in a JSON body, the upload puts it in a query string with the `File` as
the body. A mechanical swap would lose the assertion.

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

**Interfaces:**
- Consumes: `uploadNow`, `confirmNow`, `runView` directly. NOT `reviewWithSummary`, which supplies
  its own upload mock.
- Produces: nothing new.

- [ ] **Step 1: 218, the register identity**

Arrange by hand and assert on the upload:

```tsx
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'validating' }));
```

Then after `await uploadNow();`:

```tsx
    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1));
    expect(api.uploadFacilityImport).toHaveBeenCalledWith(
      expect.objectContaining({ nationalSystem: HFR_SOURCE.url }), expect.any(Function),
    );
    expect(api.uploadFacilityImport).not.toHaveBeenCalledWith(
      expect.objectContaining({ nationalSystem: HFR_SOURCE.name }), expect.any(Function),
    );
```

⛔ The second argument is `expect.any(Function)`, the progress callback. `uploadFacilityImport`
takes two arguments (see :1296) and a one-argument `toHaveBeenCalledWith` fails.

Retitle: `B1 Task 9: renders a Select populated from the API and sends the URI, never the display
name`. Drop `keeps Preview disabled until a source is chosen` from the title and drop the assertion
that said it; 676 already covers "Mapping is unreachable without a register".

- [ ] **Step 2: 1105, the file-shape declarations**

The inline half asserted the same three values on preview and again on apply. The streamed
equivalent is: they ride the UPLOAD, and the confirm does not repeat them. Rewrite to

```tsx
    expect(api.uploadFacilityImport).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'jsonl', completeRelease: true, releaseVersion: 'r7' }),
      expect.any(Function),
    );
```

Retitle: `CT-3: format, completeRelease and releaseVersion ride the upload, so the validate parses
what the operator declared`.

⛔ Do NOT also assert they reach the confirm. They do not, and cannot: the run stored them at upload
time. That is the design, and an assertion inverting it would be wrong.

- [ ] **Step 3: 1056, the onConflict default**

Reach Review by hand, then `confirmNow()`, then:

```tsx
    await waitFor(() => expect(api.confirmFacilityImportRun).toHaveBeenCalledTimes(1));
    expect(api.confirmFacilityImportRun).toHaveBeenCalledWith('run-b1',
      expect.objectContaining({ onConflict: 'skip' }));
```

The fixture summary needs `conflict: 1` so the control is shown at all: `confirmOptionsFor` sends
only the choices whose control the operator saw (see 1676).

Retitle: `Confirm sends the default onConflict skip when the operator never touches the control`.

- [ ] **Step 4: 2028 and 2055, the column map**

The upload carries `columnMap` as an object on the request (`api.ts`'s `uploadFacilityImport`
serialises it). Assert:

```tsx
    expect(api.uploadFacilityImport).toHaveBeenCalledWith(
      expect.objectContaining({ columnMap: { columns: { national_code: 'MFL Code' }, extras: [] } }),
      expect.any(Function),
    );
```

⛔ **Read `api.ts`'s `uploadFacilityImport` signature before writing this.** If it takes the map
pre-stringified, assert the string. Getting this wrong gives a passing test that asserts nothing,
because `objectContaining` ignores keys it does not name.

2055's file swap: keep both `pickFileAndSystem` calls and both uploads, and assert the SECOND
upload's map, which is the point of the test.

- [ ] **Step 5: Run**

```bash
npx vitest run src/facilities --root apps/studio --testTimeout 30000 --hookTimeout 30000
```

Expected: PASS against unmodified production code.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx
git commit -m "test(facilities): the request-contents tests assert what the upload sent"
```

---

### Task 4: Re-point the error path

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

- [ ] **Step 1: 615, a rejected request keeps the sheet open**

```tsx
    mocked(api.uploadFacilityImport).mockRejectedValue(
      new Error('import facilities failed: Invalid Record Length: columns length is 3, got 2 on line 4'),
    );
    const onOpenChange = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={onOpenChange} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/invalid record length/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
```

Retitle: `a rejected upload surfaces the server message and keeps the sheet open`.

- [ ] **Step 2: Run**

```bash
npx vitest run src/facilities --root apps/studio --testTimeout 30000 --hookTimeout 30000
```

Expected: PASS. This is the LAST task that runs green against unmodified production code. Say so in
the commit, because it is the checkpoint the whole ordering exists to create.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx
git commit -m "test(facilities): the error path rejects an upload, not an inline post

Last commit where every re-pointed test passes against the untouched sheet.
That is the proof the assertions moved rather than changed."
```

---

### Task 5: Delete the inline door

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/facilities/ReconciliationSummary.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`
- Modify: `apps/studio/src/facilities/ReconciliationSummary.test.tsx` (if it passes `overCap`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ReconciliationSummary` props drop to
  `{ result, unknownColumnsOverridden, showConflictChoice, reupload }`.

- [ ] **Step 1: Delete the 11 tests**

Lines 344, 366, 514, 629, 661, 763, 794, 950, 991, 1027, 2380. Delete each `it` block whole,
including its preceding comment block.

- [ ] **Step 2: Edit the four that only name Preview**

- **676:** delete the line
  `expect(screen.queryByRole('menuitem', { name: /^preview$/i })).not.toBeInTheDocument();` and the
  paragraph of the comment above it that explains it. Keep the `Upload and validate` assertion,
  which is the guarantee.
- **1281:** delete `expect(api.importFacilitiesCsv).not.toHaveBeenCalled();` and its comment line.
- **2483:** rewrite. New title:
  `shows exactly one primary action, and the menu offers no second way to check`. Body: after
  `await screen.findByRole('button', { name: 'Upload and validate' })`, assert

```tsx
    expect(screen.queryByRole('button', { name: /^Preview$/ })).not.toBeInTheDocument();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^Preview$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Apply$/ })).not.toBeInTheDocument();
```

- **777** is task 6's, not this one. Leave it.

- [ ] **Step 3: Run, and watch it FAIL**

```bash
npx vitest run src/facilities --root apps/studio --testTimeout 30000 --hookTimeout 30000
```

Expected: 2483 FAILS, because Preview is still in the menu. That failure is the point: it is the
only test in the suite that asserts the door is gone.

- [ ] **Step 4: Delete the door**

In `ImportFacilitiesSheet.tsx`:

- Delete `runPreview` (:610-672) and its `overrides` doc comment above it.
- Delete `handleApplyConfirm` (:706-753).
- Delete the `ConfirmDialog` block (:1850-1858) and its `ConfirmDialog` import if unused elsewhere
  in the file.
- Delete the Preview `DropdownMenuItem` (:1287-1294, comment included) and the Apply one
  (:1295-1299).
- Delete state: `previewResult` (:320), `applyResult` (:322), and the `previewing`, `applying`,
  `confirmOpen` declarations.
- Delete derived: `previewDisabled` (:1143), `blockedByImport` (:1183), `canApply` (:1185),
  `overCap` (:1187), and the `APPLY_ROW_CAP` constant and its import.
- Delete the `importFacilitiesCsv` import (:24).
- In `friendlyImportErrorMessage` (:598-603), delete the `'inline apply limit'` and
  `'mb limit for this endpoint'` branches. Both name the inline route's caps and neither is
  reachable now. Keep `'byte upload limit'`, which is the upload's own 413.

Then collapse what became a tautology, in this file only:

- `reviewResult` (:940) becomes `awaitingSummary`. Replace the alias rather than keeping both names.
- `fromRun` (:941) is now `awaitingSummary !== null`, which every caller already implies. Inline it.
- Drop `!applyResult` from the six conditions that carry it (:1282, :1290, :1295, :1674, :1699,
  :1831) and `!run` from :1290 and :1295, both now dead with their items.
- `blockedFor(previewResult)` has no caller; `blockedFor` itself stays, called by `canConfirmRun`.

- [ ] **Step 5: Fix the fallback comment**

At :766, the docblock on `handleRevalidate` says the fallback exists because "a run that came from
the inline preview door stored no file". Replace that sentence. **Do not delete the branch.** New
text:

```
   * ⛔ THE FALLBACK IS NOT DEAD CODE, though half its old reason is gone. Every run now stores its
   * file, so `blobKey` is never null; but a run that has moved on from `awaiting_confirmation`
   * still cannot be re-checked, and `canRevalidate` tests both. For that one, sending the file
   * again is the only thing that can work.
```

- [ ] **Step 6: Remove `overCap` from `ReconciliationSummary`**

Delete the prop from its type and from the block that renders the over-cap sentence. Delete the
`overCap` argument at the call site in the sheet. If `ReconciliationSummary.test.tsx` passes it,
delete that too, along with any test whose only subject is the over-cap sentence.

Its i18n key goes with it: grep for the key name in `apps/studio/src/i18n/en.ts`, delete it from all
three of `en.ts`, `fr.ts`, `pt.ts`, or `parity.test.ts` fails.

- [ ] **Step 7: Run**

```bash
npx vitest run src/facilities --root apps/studio --testTimeout 30000 --hookTimeout 30000
npx tsc --noEmit -p apps/studio
```

Expected: all PASS. Count is 279 minus 11 deleted, minus whatever `ReconciliationSummary.test.tsx`
lost, plus 0 new.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/facilities/
git commit -m "fix(facilities): one door into the importer, not two

Preview and Apply were the last two things driving POST /api/facilities/import
from the studio, and neither was a visible button: step 2's action has been
Upload and validate and step 3's has been Confirm since the step shell landed.

Removing Preview removes the inline Apply with it, because canApply read
previewResult and nothing else. The row cap that refused an inline apply over
2000 rows goes too; the streamed door never had one.

The route and its client stay. The CLI never used this door."
```

---

### Task 6: Stop reading the whole file

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/facilities/ColumnMapStep.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`
- Modify: `apps/studio/src/facilities/ColumnMapStep.test.tsx` (if it passes `rowCount`)
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ColumnMapStep` props lose `rowCount?: number`.

- [ ] **Step 1: Write the failing test**

Add to the `the file drop zone` describe (:2634) or beside 1281:

```tsx
  it('reads only the head of the file, never the whole register', async () => {
    mocked(api.suggestColumnMap).mockResolvedValue({ headers: ['MFL Code'], columns: [] });
    // A file whose text() would resolve to something far larger than its header row. `slice` is
    // what the sheet must call; `text` is what it must not.
    const big = new File(['MFL Code\n' + 'x\n'.repeat(50_000)], 'big.csv', { type: 'text/csv' });
    const sliceSpy = vi.spyOn(big, 'slice');
    const textSpy = vi.spyOn(big, 'text');
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('File'), { target: { files: [big] } });

    await waitFor(() => expect(sliceSpy).toHaveBeenCalledWith(0, 64 * 1024));
    expect(textSpy).not.toHaveBeenCalled();
  });
```

⛔ `vi.spyOn(big, 'text')` on a jsdom `File` may fail if `text` is inherited and non-configurable.
If it throws, drop the `textSpy` half and keep the `sliceSpy` assertion, which is the load-bearing
one. Say in the commit which of the two shipped.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/facilities/ImportFacilitiesSheet.test.tsx --root apps/studio --testTimeout 30000 --hookTimeout 30000 -t "reads only the head"
```

Expected: FAIL. `slice` was never called.

- [ ] **Step 3: The head read**

In `ImportFacilitiesSheet.tsx`, beside `ACCEPTED_FILE_EXTENSIONS` (:209):

```tsx
/** How much of the chosen file is read into this tab.
 *
 *  The ONLY thing the sheet needs the file's text for is its header row: `suggestColumnMap` posts
 *  it, and that route splits on the first newline and throws the rest away
 *  (apps/server/src/facilities-routes.ts). Reading the whole file was the INLINE door's
 *  requirement, because it carried the register in a JSON body. That door is gone, and the upload
 *  sends the `File` itself.
 *
 *  ⛔ A header row longer than this truncates, and a truncated line reaches the same 400 the route
 *  already returns for a header row it cannot read. The contract has 16 fields and a real register
 *  carries perhaps 30 columns, so a header runs to hundreds of bytes. This is a ceiling with a wide
 *  margin, not a measured fit. */
const HEAD_BYTES = 64 * 1024;
```

Rename the state. `csv` no longer holds the file, and a name that says it does will mislead the next
reader:

```tsx
  const [csvHead, setCsvHead] = useState<string | null>(null);
```

In `selectFile` (:513-517), replace the read:

```tsx
    if (!f) { setCsvHead(null); return; }
    void f.slice(0, HEAD_BYTES).text().then(setCsvHead).catch((err: unknown) => {
      setCsvHead(null);
      setError(err instanceof Error ? err.message : String(err));
    });
```

Update the comment above it: it currently says the read is "for the INLINE path only". It is now for
the header row only.

Rename the remaining reads: :556, :562, :576, :582 (the effect's dependency array), :1138, :1143.

- [ ] **Step 4: `emptyFile` reads the size**

Replace :1138:

```tsx
  // ⛔ `file.size`, not the read. The old test was `csv === ''`, which could only become true once
  // `File.text()` resolved — so between choosing a 0-byte file and that read landing, `uploadDisabled`
  // let a doomed click through. `size` is known the instant the file is chosen.
  const emptyFile = !!file && file.size === 0;
```

`uploadDisabled` (:1147) already reads `emptyFile` and needs no change. Delete `!csv` from it if
present, since nothing has to be read before Upload is live.

- [ ] **Step 5: Delete the row-count hint**

- Delete `columnMapRowCount` (:1199-1201) and its comment block.
- Delete the `rowCount` prop from the `ColumnMapStep` call site.
- In `ColumnMapStep.tsx`, delete `rowCount?: number` (:81), the destructured `rowCount` (:100), and
  the render block at :255-258.
- Delete `facilities.import.columnMap.rowCountHint` from `en.ts`, `fr.ts` and `pt.ts`. All three, or
  `parity.test.ts` fails.
- In test 2181, delete the row-count assertion and retitle to
  `shows a non-blocking notice while the column map is incomplete`. Re-point its arrange block to
  `reviewWithSummary`, which is the part deferred from task 2.
- In test 777, delete the vacuous `menuitem /preview/` line. **Its 0-byte assertion must still
  pass**; it is the direct test of step 4.
- If `ColumnMapStep.test.tsx` passes `rowCount` or asserts the hint, delete that too.

- [ ] **Step 6: Run**

```bash
npx vitest run src/facilities --root apps/studio --testTimeout 30000 --hookTimeout 30000
npx vitest run src/i18n --root apps/studio
npx tsc --noEmit -p apps/studio
```

Expected: all PASS, including the new head-read test and 777.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/facilities/ apps/studio/src/i18n/
git commit -m "fix(facilities): read the header row, not the whole register

The sheet read the entire chosen file into a JavaScript string so the inline
door could put it in a JSON body. That door is gone, and the only remaining
reader is the header-row suggestion, whose route reads one line.

A 64 MiB register no longer enters the tab at all. The empty-file check now
reads File.size, which is known the instant a file is chosen rather than after
a read resolves, so a 0-byte file can no longer slip a click through.

The map panel's row-count hint goes with the read. It was informational; the
authoritative count is parsed, which Review already shows."
```

---

### Task 7: The page-level integration test

**Files:**
- Modify: `apps/studio/src/pages/Facilities.test.tsx` (:465-530)

- [ ] **Step 1: Re-point it**

The test drives the real Facilities page through an import and asserts the list reloads and the
sheet keeps its own success confirmation. All of that survives; only the door changes.

Replace the two `importFacilitiesCsv` `mockResolvedValueOnce` fixtures with:

```tsx
    const VALIDATED = {
      parsed: 3, skipped: 0, unknownColumns: [], duplicateColumns: [], columnMapErrors: [],
      quarantined: [], invalid: [], duplicates: 0, blocked: false, blockedReason: null,
      create: 3, changed: 0, unchanged: 0, conflict: null, absent: null, deleted: 0,
      samples: { create: [], changed: [], conflict: [], absent: [], deleted: [] },
      written: { created: 0, updated: 0, retired: 0 }, runId: 'run-1', knownNationalSystem: true,
      meta: null, countMismatch: [], releaseVersion: null,
      unmapped: { level: [], status: [], country: [] }, notValidated: [],
    };
    const APPLIED = {
      ...VALIDATED,
      create: 2, changed: 1, written: { created: 2, updated: 1, retired: 0 },
    };
    (uploadFacilityImport as ReturnType<typeof vi.fn>).mockResolvedValue({ runId: 'run-1' });
    (getFacilityImportRun as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(runViewFixture({ status: 'awaiting_confirmation', phase: 'validated', summary: VALIDATED }))
      .mockResolvedValue(runViewFixture({ status: 'applied', summary: APPLIED }));
    (confirmFacilityImportRun as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'confirmed' });
```

These two objects are the file's existing inline fixtures, unchanged except that `create`/`changed`
move to the applied one, because the streamed door reports the validate and the apply as two
separate rows rather than as two responses to the same call.

`runViewFixture` is a local copy of `runView`; this file does not import the sheet's test helpers.
Copy the shape from `ImportFacilitiesSheet.test.tsx:154` and say in a comment that it is mirrored,
the same note the file already carries for `baseResult`.

Replace the two menu clicks:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload and validate' }));
    expect(await screen.findByText(/3 row\(s\) will be imported/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm import' }));
```

⛔ Check this file's `vi.mock('@/api')` factory. If `uploadFacilityImport`, `getFacilityImportRun`
and `confirmFacilityImportRun` are not in it, they are `undefined` and every call throws. Add them,
and add them to the named import at :57.

- [ ] **Step 2: Run**

```bash
npx vitest run src/pages/Facilities.test.tsx --root apps/studio --testTimeout 30000 --hookTimeout 30000
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/pages/Facilities.test.tsx
git commit -m "test(facilities): the page-level import test drives the upload door"
```

---

### Task 8: Docs, three languages

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/facilities.md`
- Modify: `apps/studio/src/docs/0.1.0/fr/facilities.md`
- Modify: `apps/studio/src/docs/0.1.0/pt/facilities.md`

- [ ] **Step 1: Find every mention**

```bash
grep -rn -i "preview\|aperçu\|pré-visualiza\|previs" apps/studio/src/docs/0.1.0/*/facilities.md
```

The known one is `en/facilities.md:67`: "Every other action, including Preview, the three
check-again options, Cancel, and Close, stays in the page's `⋯` menu." Its fr and pt counterparts
say the same thing.

- [ ] **Step 2: Edit all three**

Drop "Preview," from the list. The sentence still reads correctly with the three check-again
options, Cancel and Close.

⛔ Do not translate by pattern-matching the English. Read the surrounding fr and pt sentences and
match their register, the way the rest of those files do.

- [ ] **Step 3: Run the docs tests**

```bash
npx vitest run src/docs --root apps/studio
```

Expected: PASS. `validation.test.ts` checks the three trees agree structurally.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs/
git commit -m "docs(facilities): the import wizard has one check, not two"
```

---

### Task 9: Verification

**Files:** none modified unless something fails.

- [ ] **Step 1: The full gate**

```bash
pnpm turbo run test --concurrency=4
```

⛔ Never pipe turbo through `tail`; it truncates the failure list. A failure is usually a TIMEOUT,
not a regression: grep for `Test timed out` and re-run that package alone before blaming a change.

- [ ] **Step 2: Typecheck**

```bash
pnpm turbo run typecheck --concurrency=4
```

- [ ] **Step 3: Confirm the route survived**

```bash
git diff main --stat -- apps/server packages
```

Expected: EMPTY. This slice touches `apps/studio` only. Anything else is scope creep and must be
explained or reverted.

- [ ] **Step 4: Live check**

The worktree has no `.env`. Copy one in from the main checkout, and **announce the
`AUTH_DEV_BYPASS` flip before making it** (`flag-dev-shortcuts-in-advance`). Restore
`AUTH_DEV_BYPASS=false` afterwards.

⛔ Port 3000 is held by another chat's `node dev.mjs` and `preview_start` refuses it. The known
workaround is a temporary `api-alt` launch entry on 3001 plus a one-line `vite.config.ts` proxy
edit, both reverted before merge. See the `facility-import-fixed-value-pickers` memory note.

What to prove, and it is the spec's HONEST NON-PROOF:

1. Load the **real Zambia MFL export**, not a fixture. Confirm the map panel lists every one of its
   headers. That is the only thing that shows a 64 KiB head is enough for a real register.
2. Confirm the ⋯ menu shows no Preview and no Apply.
3. Confirm Upload and validate still reaches Review, and Confirm still applies.

- [ ] **Step 5: Mobile**

`resize_window` at 375x812. Measure `document.body.scrollWidth` against `clientWidth` on Source,
Mapping and Review. Expected 0 overflow. The Source grid was measured there this morning and this
slice touches the same step's file row.

Headless Chromium cannot see the `vh`-vs-`dvh` class of bug. Do not report bottom-edge behaviour as
verified.

- [ ] **Step 6: Merge and changelog**

Merge to local `main` with `--no-ff`, push, confirm the origin SHA, then `pnpm make:changelog` and
commit the result. In that order: the generator reads git history and cannot see commits that are
not there yet.
