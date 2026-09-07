# Facility import: Review reviews, Mapping decides (plan A, studio)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every decision about the import moves to Mapping. Review becomes a read-only issues report whose only action is Apply, and a summary that no longer matches its inputs is discarded rather than shown.

**Architecture:** `ImportFacilitiesSheet` gains one derived value, an inputs signature, and discards its summary whenever that signature changes. `ReconciliationSummary` moves to its own file and sheds every callback prop until it is presentational. The policy selects, the allow-overrides and the value-map panel move to step 2. No server change and no migration in this plan.

**Tech Stack:** React 18, TypeScript, vitest + @testing-library/react, react-i18next, Tailwind, shadcn primitives.

**Spec:** `docs/superpowers/specs/2026-09-07-facility-import-review-is-read-only-design.md`

**Sibling plan:** `docs/superpowers/plans/2026-09-07-facility-import-revalidate-route.md` (plan B)
adds the re-validate route so the streamed door re-parses a stored upload instead of re-uploading.
**This plan does not depend on it.** Without plan B the streamed door's loop is the one it already
has: go back, change the map, upload again. That is today's behaviour, so nothing regresses.

## Global Constraints

- `apps/studio` UI conventions are `AGENTS.md` §5. Actions live in a `⋯` `DropdownMenu`. Form fields
  keep `grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`. shadcn primitives only.
- Every user-visible string is an i18n key present in `en.ts`, `fr.ts` and `pt.ts`.
  `apps/studio/src/i18n/parity.test.ts` fails the moment one locale has a key another lacks.
- No em dashes in any file this plan touches. No emoji in headings or bullets.
- Test one file: `npx vitest run <path> --root apps/studio --testTimeout 30000 --hookTimeout 30000`.
  **`pnpm --filter @openldr/studio test -- <path>` does NOT filter**; the path is swallowed and all
  218 files run. Whole package: `npx vitest run --root apps/studio`.
  Full gate: `pnpm turbo run test`. Never pipe turbo through `tail`.
- No `Co-Authored-By` trailers.
- Branch `feat/facility-import-review-read-only`, cut from `main` at `c3510b00`. Task 6 merges to
  local `main` and pushes. No PR unless asked.

---

## Decision record

Facts checked on 2026-09-07. Re-check the cited line rather than guess.

**1. `ReconciliationSummary` lives inside a 2038-line file.** It is declared at
`apps/studio/src/facilities/ImportFacilitiesSheet.tsx:285-328` and rendered at `:1862-1888`. Task 1
extracts it. That is not unrelated refactoring: this plan's measurable end state is that it takes no
`on*Change` prop, and it needs its own file and its own test to show that.

**2. The step gate is built in the sheet, not in `stepModel.ts`.**
`hasReview: reviewResult !== null || appliedSummary !== null || runId !== null`
(`ImportFacilitiesSheet.tsx:1338`). `stepModel.ts` itself needs no change: `furthestStep` already
drops to 2 when `hasReview` goes false, and `clampStep` already pulls the rendered step down with it.

**3. `runId` in that gate is load-bearing and must survive.** An upload sets `runId` the instant it
resolves, while `reviewResult` stays null until the first poll answers. Drop `runId` from the gate
and the operator who just uploaded sits on Mapping watching nothing (`:1332-1337`).

**4. The allow-overrides currently re-run the preview when toggled.**
`toggleAllowUnknownColumns` calls `runPreview({ allowUnknownColumns: checked })`
(`ImportFacilitiesSheet.tsx:1058-1061`). Once they live on Mapping they must stop doing that: a
toggle becomes an edit that invalidates the summary, and the re-parse is the operator's next move.

**5. `allowMalformedRows` is deliberately pinned `false` in the preview request** and only sent on
apply (`ImportFacilitiesSheet.tsx:1010-1020`). That stays exactly as it is. Moving the checkbox does
not move the pin.

**6. The three capability names are one capability.** `MANAGE`, `IMPORT` and `UPLOAD` in
`facilities-routes.ts` (`:38`, `:57`, `:145`) all guard `facilities.manage` and differ only in
`bodyLimit`. Nothing in this plan touches the server, but do not read those names as permission
levels if a step tempts you to.

**7. A column-map refusal already retreats to Mapping from any step**
(`ImportFacilitiesSheet.tsx:1370-1378` and the effect below it). That retreat and this plan's
invalidation are different mechanisms with the same destination. Do not merge them: the refusal
fires on a *result*, the invalidation fires on an *input change*.

## File structure

| File | Responsibility |
|---|---|
| Create `apps/studio/src/facilities/ReconciliationSummary.tsx` | The read-only issues report. Ends the plan with no callback props. |
| Create `apps/studio/src/facilities/ReconciliationSummary.test.tsx` | That it renders every issue, and that its props expose nothing that changes import behaviour. |
| Create `apps/studio/src/facilities/ImportPolicyPanel.tsx` | The conflict/absent/deleted selects and the three allow-overrides, on Mapping. |
| Create `apps/studio/src/facilities/ImportPolicyPanel.test.tsx` | Its own behaviour, including that a toggle does not trigger a parse. |
| Create `apps/studio/src/facilities/importInputsSignature.ts` | One pure function: the inputs a summary is only valid for. Testable as arithmetic. |
| Create `apps/studio/src/facilities/importInputsSignature.test.ts` | Which changes move the signature and which do not. |
| Modify `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` | Wire the above, hold the two lifetimes, render the moved controls on step 2. |
| Modify `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx` | The loop, the invalidation, and that Review has one action. |
| Modify `apps/studio/src/i18n/{en,fr,pt}.ts` | Keys for the policy panel's new home and the worklist heading. |
| Modify `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`, `apps/web/src/docs/0.1.0/facilities.md` | The loop, described. |

---

### Task 1: Extract `ReconciliationSummary`, unchanged

A pure move. Behaviour must not change, so the existing sheet tests are the proof.

**Files:**
- Create: `apps/studio/src/facilities/ReconciliationSummary.tsx`
- Create: `apps/studio/src/facilities/ReconciliationSummary.test.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx:285-328` (remove the declaration), and its import block

**Interfaces:**
- Produces: `export interface ReconciliationSummaryProps` and
  `export function ReconciliationSummary(props: ReconciliationSummaryProps): JSX.Element`, with the
  prop list byte-identical to today's. Later tasks remove props from it.

- [ ] **Step 0: Cut the branch**

```bash
git checkout -b feat/facility-import-review-read-only
```

Expected: `main` clean at `c3510b00`.

- [ ] **Step 1: Move the component**

Cut `interface ReconciliationSummaryProps { ... }` and `function ReconciliationSummary(props) { ... }`
from `ImportFacilitiesSheet.tsx` into the new file **verbatim**, including every docblock. Export
both. Carry across only the imports the moved JSX actually uses (`useTranslation`, `Badge`,
`Checkbox`, `Label`, `Select*`, `ValueMapPanel`, `CONTROLLED_FIELDS`, the `FacilityImportResult` and
`ReuploadOverrides` types). Add `import { ReconciliationSummary } from './ReconciliationSummary';`
to the sheet.

If `ReuploadOverrides` is declared in the sheet, export it from the sheet and import it in the new
file. Do not duplicate it.

- [ ] **Step 2: Prove nothing changed**

Run: `npx vitest run src/facilities --root apps/studio --testTimeout 30000 --hookTimeout 30000`
Expected: PASS, same count as before the move.

Run: `npx tsc --noEmit` from `apps/studio`. Expected: exit 0.

- [ ] **Step 3: Write the component's own test**

Create `apps/studio/src/facilities/ReconciliationSummary.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconciliationSummary } from './ReconciliationSummary';
import type { FacilityImportResult } from '@/api';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, suggestValueMappings: vi.fn().mockResolvedValue({ values: [], options: [], notValidated: false }) };
});

/** A result with something to say in every section. Fields this component does not read are left at
 *  their zero values deliberately: a test that fills everything cannot show which ones it depends on. */
const result = {
  parsed: 10, created: 3, changed: 2, unchanged: 5, skipped: 0,
  quarantined: [], invalid: [], unknownColumns: [], columnMapErrors: [],
  blocked: false, blockedReason: null,
  conflict: 1, absent: 2, deleted: 0,
  unmapped: { level: ['Health Centre'], status: [], country: [] },
  notValidated: [],
} as unknown as FacilityImportResult;

describe('ReconciliationSummary', () => {
  it('reports the counts it was given', () => {
    render(<ReconciliationSummary {...({ result } as never)} />);
    expect(screen.getByText(/10/)).toBeInTheDocument();
  });
});
```

This test is deliberately thin at this task. Task 3 and Task 4 rewrite it once the prop list is
final; writing assertions now against props about to be deleted would be work thrown away.

- [ ] **Step 4: Run it**

Run: `npx vitest run src/facilities/ReconciliationSummary.test.tsx --root apps/studio --testTimeout 30000 --hookTimeout 30000`
Expected: PASS, 1 test.

If it fails on a missing required prop, add that prop to the spread with a `vi.fn()` or a zero value.
Do not change the component to make it pass; this task changes no behaviour.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/facilities/ReconciliationSummary.tsx apps/studio/src/facilities/ReconciliationSummary.test.tsx apps/studio/src/facilities/ImportFacilitiesSheet.tsx
git commit -m "refactor(facilities): the reconciliation summary gets its own file"
```

---

### Task 2: Two lifetimes

Nothing moves yet. This task alone makes a changed input drop the operator to Mapping.

**Files:**
- Create: `apps/studio/src/facilities/importInputsSignature.ts`
- Create: `apps/studio/src/facilities/importInputsSignature.test.ts`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` (the gate at `:1338`, plus one effect)
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  `export interface ImportInputs { fileName: string | null; fileSize: number | null; nationalSystem: string; format: 'csv' | 'jsonl'; completeRelease: boolean; releaseVersion: string; columnMap: FacilityColumnMap; allowUnknownColumns: boolean; allowInvalidCoordinates: boolean; onConflict: string; onAbsent: string; onDeleted: string; valueMappingsSavedAt: number }`
  `export function summarySignature(i: ImportInputs): string`
  `export function worklistSignature(i: ImportInputs): string`

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/facilities/importInputsSignature.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarySignature, worklistSignature, type ImportInputs } from './importInputsSignature';

const base: ImportInputs = {
  fileName: 'mfl.csv', fileSize: 1024,
  nationalSystem: 'urn:zm:mfl', format: 'csv',
  completeRelease: false, releaseVersion: '',
  columnMap: { columns: { 'MFL Code': 'national_code' }, constants: {}, extras: [] },
  allowUnknownColumns: false, allowInvalidCoordinates: false,
  onConflict: 'skip', onAbsent: 'report', onDeleted: 'report',
  valueMappingsSavedAt: 0,
};

describe('summarySignature', () => {
  it('is stable for an unchanged input set', () => {
    expect(summarySignature(base)).toBe(summarySignature({ ...base }));
  });

  // Every one of these changes what a parse would report, so a summary computed before it is a lie.
  it.each([
    ['a different file', { fileName: 'other.csv' }],
    ['a file of a different size with the same name', { fileSize: 2048 }],
    ['a different register', { nationalSystem: 'urn:tz:hfr' }],
    ['a different format', { format: 'jsonl' as const }],
    ['the complete-release flag', { completeRelease: true }],
    ['a release version', { releaseVersion: 'v2' }],
    ['a column map edit', { columnMap: { columns: { Name: 'name' }, constants: {}, extras: [] } }],
    ['a fixed value', { columnMap: { ...base.columnMap, constants: { country: 'ZMB' } } }],
    ['an allow-override', { allowUnknownColumns: true }],
    ['a conflict policy', { onConflict: 'overwrite' }],
    ['an absent policy', { onAbsent: 'retire' }],
    ['a deleted policy', { onDeleted: 'retire' }],
    ['a saved value mapping', { valueMappingsSavedAt: 1 }],
  ])('changes when %s changes', (_label, patch) => {
    expect(summarySignature({ ...base, ...patch } as ImportInputs)).not.toBe(summarySignature(base));
  });
});

describe('worklistSignature', () => {
  // ⛔ NARROWER ON PURPOSE. The worklist is the set of raw values the operator is working through.
  // Saving one mapping must not make the other nineteen rows vanish mid-edit, and neither must
  // choosing a conflict policy, which has nothing to do with which raw values the file contains.
  it.each([
    ['a saved value mapping', { valueMappingsSavedAt: 1 }],
    ['a conflict policy', { onConflict: 'overwrite' }],
    ['an absent policy', { onAbsent: 'retire' }],
    ['a deleted policy', { onDeleted: 'retire' }],
    ['an allow-override', { allowUnknownColumns: true }],
    ['the complete-release flag', { completeRelease: true }],
  ])('does NOT change when %s changes', (_label, patch) => {
    expect(worklistSignature({ ...base, ...patch } as ImportInputs)).toBe(worklistSignature(base));
  });

  it.each([
    ['a different file', { fileName: 'other.csv' }],
    ['a different register', { nationalSystem: 'urn:tz:hfr' }],
    ['a different format', { format: 'jsonl' as const }],
    ['a column map edit', { columnMap: { columns: { Name: 'name' }, constants: {}, extras: [] } }],
  ])('changes when %s changes', (_label, patch) => {
    expect(worklistSignature({ ...base, ...patch } as ImportInputs)).not.toBe(worklistSignature(base));
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/facilities/importInputsSignature.test.ts --root apps/studio --testTimeout 30000 --hookTimeout 30000`
Expected: FAIL, `Failed to resolve import "./importInputsSignature"`.

- [ ] **Step 3: Write the module**

Create `apps/studio/src/facilities/importInputsSignature.ts`:

```ts
import type { FacilityColumnMap } from '@/api';

/** Everything a parse's answer depends on. Deliberately a flat value object and not the sheet's
 *  state: this module must not know what a run, a preview or a summary is, the same discipline
 *  `stepModel.ts` already keeps. */
export interface ImportInputs {
  /** The file is identified by name and size rather than held: a `File` is a new object identity on
   *  every pick, so comparing the object would report a change every render. Name plus size is not a
   *  hash and cannot catch an edit-in-place of the same length. That is accepted: the operator
   *  re-picking a file is the case this guards, and a fresh parse is one click away regardless. */
  fileName: string | null;
  fileSize: number | null;
  nationalSystem: string;
  format: 'csv' | 'jsonl';
  completeRelease: boolean;
  releaseVersion: string;
  columnMap: FacilityColumnMap;
  allowUnknownColumns: boolean;
  allowInvalidCoordinates: boolean;
  onConflict: string;
  onAbsent: string;
  onDeleted: string;
  /** Bumped whenever value mappings are written. The mappings themselves live server-side in
   *  `term_mappings` and only take effect on a fresh parse, so the sheet cannot compare them; a
   *  monotonic stamp is what makes "something was saved" comparable at all. */
  valueMappingsSavedAt: number;
}

/** `JSON.stringify` over an explicit array, not over the object: key order in an object literal is
 *  a refactoring hazard, and an array states the field list in one readable place. */
const sig = (parts: unknown[]): string => JSON.stringify(parts);

/**
 * What a Review summary is valid for. Any change here means the summary on screen describes inputs
 * that no longer exist, and the sheet discards it rather than showing a stale number.
 *
 * ⛔ THE POLICY SELECTS ARE IN HERE. `onConflict`/`onAbsent`/`onDeleted` do not change what a parse
 * READS, but they change what the summary PROMISES the apply will do, and the summary states that
 * promise. A summary that says "2 absent facilities will be retired" after the operator switched to
 * report is exactly the false number this whole design exists to keep off the screen.
 */
export function summarySignature(i: ImportInputs): string {
  return sig([
    i.fileName, i.fileSize, i.nationalSystem, i.format, i.completeRelease, i.releaseVersion,
    i.columnMap, i.allowUnknownColumns, i.allowInvalidCoordinates,
    i.onConflict, i.onAbsent, i.onDeleted, i.valueMappingsSavedAt,
  ]);
}

/**
 * What the value-mapping worklist is valid for: only the things that change which raw values the
 * file contains at all.
 *
 * ⛔ NARROWER THAN `summarySignature`, and that gap is the feature. Saving a mapping, or picking a
 * conflict policy, must not empty the list of values the operator is halfway through fixing.
 */
export function worklistSignature(i: ImportInputs): string {
  return sig([i.fileName, i.fileSize, i.nationalSystem, i.format, i.columnMap]);
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `npx vitest run src/facilities/importInputsSignature.test.ts --root apps/studio --testTimeout 30000 --hookTimeout 30000`
Expected: PASS.

- [ ] **Step 5: Wire the summary lifetime into the sheet**

In `ImportFacilitiesSheet.tsx`, add near the other derived values and **above** the `stepGate` at
`:1338`:

```tsx
  // Task 2: the inputs the summary on screen was computed from. `valueMappingsSavedAt` is bumped by
  // `handleValueMappingsSaved`; every other field is existing sheet state.
  const inputs: ImportInputs = {
    fileName: file?.name ?? null,
    fileSize: file?.size ?? null,
    nationalSystem: nationalSystem.trim(),
    format,
    completeRelease,
    releaseVersion,
    columnMap,
    allowUnknownColumns,
    allowInvalidCoordinates,
    onConflict,
    onAbsent,
    onDeleted,
    valueMappingsSavedAt,
  };
  const currentSummarySignature = summarySignature(inputs);
```

Add the two state values next to the sheet's other `useState` calls:

```tsx
  /** The signature the summary on screen was computed under. `null` means there is no summary. */
  const [summaryAt, setSummaryAt] = useState<string | null>(null);
  const [valueMappingsSavedAt, setValueMappingsSavedAt] = useState(0);
```

Set it wherever a summary is earned. In `runPreview`, immediately after `setPreviewResult(result)`:

```tsx
      setSummaryAt(currentSummarySignature);
```

And in the upload handler, immediately after the `runId` is set, for the same reason `runId` is in
the gate at all:

```tsx
      setSummaryAt(currentSummarySignature);
```

Then change the gate at `:1338`:

```tsx
    // ⛔ `summaryAt === currentSummarySignature` is what makes this "a summary that matches the
    // inputs", not merely "a summary exists". Change the file, the register, the map, a fixed
    // value, an override or a policy and this goes false, `furthestStep` returns 2 and `clampStep`
    // pulls the operator back to Mapping. That is the whole safety half of this slice: Review is
    // either current or absent, never stale.
    //
    // ⛔ `runId !== null` STAYS, and still ORs in. An upload sets it the instant it resolves while
    // `reviewResult` waits for the first poll; without it the operator who just uploaded sits on
    // Mapping watching nothing. It is guarded by the same signature for the same reason.
    hasReview: summaryAt !== null && summaryAt === currentSummarySignature
      && (reviewResult !== null || appliedSummary !== null || runId !== null),
```

- [ ] **Step 6: Write the sheet's failing tests**

Add to `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`, inside the existing top-level
`describe`:

```tsx
  it('⛔ discards the summary and drops to Mapping when the column map changes', async () => {
    await renderAtReview();
    expect(screen.getByText(/what this file would do/i)).toBeInTheDocument();

    // Any column-map edit. The signature does not care which.
    fireEvent.change(screen.getByLabelText('country'), { target: { value: 'TZA' } });

    await waitFor(() => expect(screen.queryByText(/what this file would do/i)).toBeNull());
    expect(screen.getByText(/fixed values/i)).toBeInTheDocument();
  });

  it('⛔ discards the summary when a conflict policy changes, because the summary states that promise', async () => {
    await renderAtReview();
    fireEvent.change(screen.getByLabelText(/on conflict/i), { target: { value: 'overwrite' } });
    await waitFor(() => expect(screen.queryByText(/what this file would do/i)).toBeNull());
  });

  it('keeps the summary when nothing has changed', async () => {
    await renderAtReview();
    expect(screen.getByText(/what this file would do/i)).toBeInTheDocument();
  });
```

`renderAtReview` is a helper this file needs. It composes the file's OWN existing helpers,
`pickFileAndSystem` (`:74`) and `previewNow` (`:86`), rather than driving the sheet a second way:

```tsx
/** Drives the sheet to a Review with a summary on screen, through the inline door.
 *  `pickFileAndSystem` and `previewNow` are this file's existing helpers; `previewNow` already
 *  knows how to reach Mapping from either side (its own docblock explains why). */
async function renderAtReview(result = cleanPreview) {
  mocked(api.importFacilitiesCsv).mockResolvedValue(result);
  render(<ImportFacilitiesSheet {...defaultProps} />);
  await pickFileAndSystem();
  await previewNow();
  await waitFor(() => expect(screen.getByRole('button', { name: /3\s*Review/ }))
    .toHaveAttribute('aria-current', 'step'));
}
```

`cleanPreview` is the file's existing fixture (`:129`), `baseResult({ parsed: 3, create: 3, runId: 'run-1' })`.
For the worklist tests in Task 4, pass
`baseResult({ parsed: 3, create: 3, runId: 'run-1', unmapped: { level: ['Health Centre'], status: [], country: [] } })`.

**Assert on the step strip, not on a heading.** `screen.getByRole('button', { name: /3\s*Review/ })`
with `aria-current="step"` is what `previewNow` already keys on, and it does not break when the
summary's wording changes. Every `/what this file would do/i` in the tests above is written that way
for readability; replace each with the step-strip assertion or with a heading you have read out of
`en.ts`, and do not guess the wording.

- [ ] **Step 7: Run, expect the first two to fail, then pass after Step 5**

If Step 5 is already applied, all three pass. If you are running them before wiring, expect the two
`⛔` tests to fail with the summary still on screen.

Run: `npx vitest run src/facilities/ImportFacilitiesSheet.test.tsx --root apps/studio --testTimeout 30000 --hookTimeout 30000`
Expected: PASS, all tests including the three new ones.

- [ ] **Step 8: Typecheck and commit**

Run `npx tsc --noEmit` from `apps/studio`. Expected: exit 0.

```bash
git add apps/studio/src/facilities/importInputsSignature.ts apps/studio/src/facilities/importInputsSignature.test.ts apps/studio/src/facilities/ImportFacilitiesSheet.tsx apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx
git commit -m "fix(facilities): a Review that no longer matches its inputs is discarded, not shown"
```

---

### Task 3: The policy controls move to Mapping

**Files:**
- Create: `apps/studio/src/facilities/ImportPolicyPanel.tsx`
- Create: `apps/studio/src/facilities/ImportPolicyPanel.test.tsx`
- Modify: `apps/studio/src/facilities/ReconciliationSummary.tsx` (remove those props and their JSX)
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` (render the panel on step 2; stop auto-previewing on toggle)
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`

**Interfaces:**
- Consumes: Task 2's invalidation. A toggle here changes sheet state, which moves
  `summarySignature`, which drops `hasReview`. Nothing in this task re-parses.
- Produces:
  ```ts
  export interface ImportPolicyPanelProps {
    onConflict: 'skip' | 'overwrite';
    onConflictChange: (v: 'skip' | 'overwrite') => void;
    onAbsent: 'retire' | 'report';
    onAbsentChange: (v: 'retire' | 'report') => void;
    onDeleted: 'retire' | 'report';
    onDeletedChange: (v: 'retire' | 'report') => void;
    allowUnknownColumns: boolean;
    onAllowUnknownColumnsChange: (v: boolean) => void;
    allowInvalidCoordinates: boolean;
    onAllowInvalidCoordinatesChange: (v: boolean) => void;
    allowMalformedRows: boolean;
    onAllowMalformedRowsChange: (v: boolean) => void;
    disabled: boolean;
    /** Whether a conflict policy can influence anything yet. Same question `showConflictChoice`
     *  answered on Review; the answer moves with the control. */
    showConflictChoice: boolean;
  }
  export function ImportPolicyPanel(props: ImportPolicyPanelProps): JSX.Element
  ```

- [ ] **Step 1: Add the i18n keys**

The policy labels already exist (`facilities.import.onConflictLabel` and friends). Add only the
panel's own heading and hint, to `en.ts` beside `columnMap.constantsTitle`:

```ts
        policyTitle: 'What to do with the differences',
        policyHint: 'Decided before the file is checked. Review reports what these choices would do.',
```

Mirror into `fr.ts`:

```ts
        policyTitle: 'Que faire des différences',
        policyHint: 'À décider avant la vérification du fichier. La Révision indique ce que ces choix produiraient.',
```

And `pt.ts`:

```ts
        policyTitle: 'O que fazer com as diferenças',
        policyHint: 'Decidido antes de o ficheiro ser verificado. A Revisão indica o que estas escolhas fariam.',
```

Run: `npx vitest run src/i18n/parity.test.ts --root apps/studio --testTimeout 30000 --hookTimeout 30000`
Expected: PASS, 3 tests.

- [ ] **Step 2: Write the failing test**

Create `apps/studio/src/facilities/ImportPolicyPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportPolicyPanel } from './ImportPolicyPanel';

const base = {
  onConflict: 'skip' as const, onConflictChange: vi.fn(),
  onAbsent: 'report' as const, onAbsentChange: vi.fn(),
  onDeleted: 'report' as const, onDeletedChange: vi.fn(),
  allowUnknownColumns: false, onAllowUnknownColumnsChange: vi.fn(),
  allowInvalidCoordinates: false, onAllowInvalidCoordinatesChange: vi.fn(),
  allowMalformedRows: false, onAllowMalformedRowsChange: vi.fn(),
  disabled: false, showConflictChoice: true,
};

describe('ImportPolicyPanel', () => {
  it('reports a changed absent policy to its caller', () => {
    const onAbsentChange = vi.fn();
    render(<ImportPolicyPanel {...base} onAbsentChange={onAbsentChange} />);
    fireEvent.change(screen.getByLabelText(/absent/i), { target: { value: 'retire' } });
    expect(onAbsentChange).toHaveBeenCalledWith('retire');
  });

  // ⛔ The panel proposes and reports. It must not know how to parse anything: on Review these
  // toggles re-ran the preview on every click, and moving them here without dropping that would
  // spend a full validate of a national register every time a checkbox moved.
  it('exposes no way to trigger a parse', () => {
    const props = Object.keys(base);
    expect(props.filter((k) => /preview|parse|validate|upload/i.test(k))).toEqual([]);
  });

  it('hides the conflict choice when nothing can act on it', () => {
    render(<ImportPolicyPanel {...base} showConflictChoice={false} />);
    expect(screen.queryByLabelText(/conflict/i)).toBeNull();
  });

  it('disables every control while a request is in flight', () => {
    render(<ImportPolicyPanel {...base} disabled />);
    expect(screen.getByLabelText(/absent/i)).toBeDisabled();
  });
});
```

Run it. Expected: FAIL, `Failed to resolve import "./ImportPolicyPanel"`.

- [ ] **Step 3: Build the panel**

Create `ImportPolicyPanel.tsx` by **moving** the policy JSX out of `ReconciliationSummary.tsx`
(`onDeleted` at its `:593`, `onAbsent` at `:609`, `onConflict` at `:634`, and the three allow
checkboxes) rather than rewriting it. Keep the existing labels, hints and `SelectItem` values
exactly. Wrap them in the section header from Step 1 and the standard
`grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`.

Preserve every docblock that travels with that JSX, especially any note explaining why
`allowMalformedRows` is separate from the other two.

- [ ] **Step 4: Render it on Mapping and stop the auto-preview**

In `ImportFacilitiesSheet.tsx`, render `<ImportPolicyPanel .../>` inside the `step === 2` block,
below `ColumnMapStep`.

Then replace the three toggle handlers. They currently re-run the preview
(`ImportFacilitiesSheet.tsx:1058-1061`):

```tsx
  // ⛔ NO `runPreview` HERE ANY MORE. On Review these re-ran the parse on every click, which was
  // right when the summary was the page you were on. On Mapping a toggle is an edit: it moves
  // `summarySignature`, `hasReview` goes false, and the operator re-parses when they choose to.
  // Re-parsing on a checkbox would spend a full validate of a national register per click.
  const toggleAllowUnknownColumns = (checked: boolean) => setAllowUnknownColumns(checked);
  const toggleAllowInvalidCoordinates = (checked: boolean) => setAllowInvalidCoordinates(checked);
```

Leave `toggleAllowMalformedRows` doing whatever it does today if it does not preview; check it before
editing.

Remove the six policy props and the three toggle props from `ReconciliationSummaryProps` and from the
call site, and delete the corresponding JSX from `ReconciliationSummary.tsx`. Keep `showConflictChoice`
only if the summary still reads it for wording; if it does not, delete it there and pass it to the
panel instead.

- [ ] **Step 5: Run the panel, the summary, the sheet**

Run: `npx vitest run src/facilities --root apps/studio --testTimeout 30000 --hookTimeout 30000`
Expected: PASS.

`allowMalformedRows` must still be pinned `false` in the preview request
(`ImportFacilitiesSheet.tsx:1010-1020`). If a test starts failing about a blocked run becoming
unblocked, that pin was disturbed. Restore it; the checkbox moved, the pin did not.

- [ ] **Step 6: Typecheck and commit**

```bash
git add apps/studio/src/facilities/ImportPolicyPanel.tsx apps/studio/src/facilities/ImportPolicyPanel.test.tsx apps/studio/src/facilities/ReconciliationSummary.tsx apps/studio/src/facilities/ImportFacilitiesSheet.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "fix(facilities): the import's policy choices move to Mapping, where the decisions are"
```

---

### Task 4: The value-map worklist moves to Mapping

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/facilities/ReconciliationSummary.tsx`
- Modify: `apps/studio/src/facilities/ValueMapPanel.tsx` (the `onSaved` contract only)
- Modify: `apps/studio/src/facilities/ValueMapPanel.test.tsx`
- Modify: `apps/studio/src/facilities/ReconciliationSummary.test.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`

**Interfaces:**
- Consumes: `worklistSignature` from Task 2, `ValueMapPanel`'s existing props.
- Produces: `ReconciliationSummaryProps` reduced to `{ result, overCap, reupload }`. **That is this
  plan's measurable end state.** If it still takes an `on*Change`, the slice is not done.

- [ ] **Step 1: Hold the worklist in the sheet**

Add beside the other state:

```tsx
  /** Task 4: the unmapped values from the last parse, and the inputs they were computed under.
   *  Kept SEPARATELY from the summary because the two have different lifetimes (see
   *  `importInputsSignature.ts`): the operator works through this list at Mapping while the summary
   *  that revealed it is already gone. */
  const [worklist, setWorklist] = useState<FacilityImportResult['unmapped'] | null>(null);
  const [worklistAt, setWorklistAt] = useState<string | null>(null);
```

Set both wherever a parse result lands, next to `setSummaryAt`:

```tsx
      setWorklist(result.unmapped);
      setWorklistAt(worklistSignature(inputs));
```

Read it with its own guard:

```tsx
  // Stale by a DIFFERENT rule than the summary: only a change to which raw values exist at all
  // retires this list. See `worklistSignature`.
  const liveWorklist = worklistAt === worklistSignature(inputs) ? worklist : null;
```

- [ ] **Step 2: Render it on Mapping**

Inside the `step === 2` block, below `ImportPolicyPanel`:

```tsx
            {liveWorklist && CONTROLLED_FIELDS.some((f) => liveWorklist[f].length > 0) && (
              <ValueMapPanel
                nationalSystem={nationalSystem.trim()}
                unmapped={liveWorklist}
                onSaved={handleValueMappingsSaved}
              />
            )}
```

Delete the `ValueMapPanel` render from `ReconciliationSummary.tsx`, and remove `nationalSystem` and
`onValueMappingsSaved` from its props and its call site.

`ReconciliationSummary` keeps reporting unmapped counts read-only from `result.unmapped`. It reports;
it no longer offers a control.

- [ ] **Step 3: Saving stops re-parsing**

Replace `handleValueMappingsSaved`:

```tsx
  // ⛔ NO `runPreview` HERE ANY MORE. Saving used to re-parse and carry the operator to Review, so
  // the page both asked the question and reported the answer. Now it bumps the stamp, which moves
  // `summarySignature` and retires the summary, and moving forward stays the operator's decision.
  // The worklist deliberately survives: `worklistSignature` does not read this stamp.
  const handleValueMappingsSaved = (): void => {
    setValueMappingsSavedAt((n) => n + 1);
  };
```

- [ ] **Step 4: Add the worklist heading key**

`en.ts`, beside the keys from Task 3:

```ts
        worklistTitle: 'Values this register uses that we do not recognise',
        worklistHint: 'Found by the last check. Map what you can; anything left is imported exactly as written.',
```

`fr.ts`:

```ts
        worklistTitle: 'Valeurs utilisées par ce registre que nous ne reconnaissons pas',
        worklistHint: 'Trouvées lors de la dernière vérification. Mappez ce que vous pouvez ; le reste est importé tel quel.',
```

`pt.ts`:

```ts
        worklistTitle: 'Valores usados por este registo que não reconhecemos',
        worklistHint: 'Encontrados na última verificação. Mapeie o que puder; o resto é importado tal como está escrito.',
```

Use them for the panel's heading on Mapping. The old amber "Values with no canonical mapping" heading
stays on Review, where it is now a report.

- [ ] **Step 5: The end-state test**

Add to `ReconciliationSummary.test.tsx`:

```tsx
  // ⛔ THE MEASURABLE END STATE of this slice. Review reports; it decides nothing. A callback prop
  // reappearing here means a control moved back onto the page whose whole purpose is that it has
  // none.
  it('takes no prop that could change what the import does', () => {
    const summary = ReconciliationSummary as unknown as (p: Record<string, unknown>) => unknown;
    const source = summary.toString();
    expect(source).not.toMatch(/props\.on[A-Z]\w*Change/);
    expect(source).not.toMatch(/onValueMappingsSaved/);
  });
```

If that reads too much like testing the implementation, replace it with the honest structural check:
render the component with only `{ result, overCap, reupload }` and assert it does not throw and that
`screen.queryAllByRole('combobox')` and `queryAllByRole('checkbox')` are both empty.

Prefer the second form. Write it that way:

```tsx
  it('renders no control at all: Review reports, it does not decide', () => {
    render(<ReconciliationSummary result={result} overCap={false} reupload={null} />);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
```

- [ ] **Step 6: Add the sheet-level loop test**

```tsx
/** The fixture for these two: a clean preview that nevertheless found one unmapped `level`. */
const previewWithUnmapped = baseResult({
  parsed: 3, create: 3, runId: 'run-1',
  unmapped: { level: ['Health Centre'], status: [], country: [] },
});

/** Click the step strip back to Mapping. `previewNow` (`:86`) already uses this exact selector and
 *  documents why coming back from Review is an ordinary thing for an operator to do. */
function backToMapping() {
  fireEvent.click(screen.getByRole('button', { name: /2\s*Mapping/ }));
}

  it('⛔ shows no worklist on the first pass, and shows it after a parse finds one', async () => {
    mocked(api.importFacilitiesCsv).mockResolvedValue(previewWithUnmapped);
    render(<ImportFacilitiesSheet {...defaultProps} />);
    await pickFileAndSystem();

    // On Mapping, before anything has read the file. There is nothing to list yet.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByText('Health Centre')).toBeNull();

    await previewNow();
    await waitFor(() => expect(screen.getByRole('button', { name: /3\s*Review/ }))
      .toHaveAttribute('aria-current', 'step'));

    backToMapping();
    expect(await screen.findByText('Health Centre')).toBeInTheDocument();
  });

  it('keeps the worklist when a mapping is saved, and retires the summary', async () => {
    mocked(api.writeFacilityValueMappings).mockResolvedValue({ written: 1, superseded: [] });
    await renderAtReview(previewWithUnmapped);
    backToMapping();
    await screen.findByText('Health Centre');

    // The panel's own ⋯ menu. `openMenu`/`clickMenuItem` (`:40`, `:51`) are this file's helpers,
    // but they target the SHEET's menu; the panel has its own trigger, so open that one by name.
    const trigger = screen.getByRole('button', { name: /value mapping actions/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /save mappings/i }));

    // The worklist survives: the operator is still working through it.
    await waitFor(() => expect(api.writeFacilityValueMappings).toHaveBeenCalled());
    expect(screen.getByText('Health Centre')).toBeInTheDocument();
    // The summary does not: the saved mapping moved `summarySignature`.
    expect(screen.getByRole('button', { name: /3\s*Review/ })).toBeDisabled();
  });
```

All three assumptions in that snippet were checked on 2026-09-07 and hold:
`writeFacilityValueMappings` is in this file's `vi.mock('@/api')` factory (`:30`) with a default at
`:189`; the panel's trigger is `aria-label` "Value mapping actions"
(`facilities.import.valueMap.actions`, `en.ts:1103`); and an unreachable step-strip button really
does render `disabled` (`ImportSteps.tsx:39`, `disabled={!reachable}`), so `toBeDisabled()` is the
right assertion and not `aria-current`. The Radix `pointerDown` idiom is this file's own, copied
from `openMenu` (`:40`), because `userEvent.click` does not reliably open a Radix dropdown under
jsdom.

- [ ] **Step 7: Run everything in the folder, typecheck, commit**

Run: `npx vitest run src/facilities --root apps/studio --testTimeout 30000 --hookTimeout 30000`
Run: `npx tsc --noEmit` from `apps/studio`.

```bash
git add apps/studio/src/facilities apps/studio/src/i18n
git commit -m "fix(facilities): value mapping moves to Mapping, and Review stops deciding"
```

---

### Task 5: Documentation

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`
- Modify: `apps/web/src/docs/0.1.0/facilities.md`

The web docs have no locale directories. `apps/web/src/docs/0.1.0/` is nine English files, so the
en/fr/pt requirement in `AGENTS.md` §6 item 3 is met by the three studio files.

- [ ] **Step 1: Describe the loop in the English studio doc**

Find the section describing the import steps and add, in the same voice as its neighbours:

```markdown
### The loop

Mapping is where you decide. Review is where you look.

Every choice about how the file is read or what happens to the differences is made on **Mapping**:
which column is which, fixed values, what to do with conflicts, absences and deletions, and which of
the register's own words map onto the vocabulary.

**Review** reports what a check found and offers one action, Apply. Nothing on it is editable. If
the check turns up something you want to change, go back to Mapping, change it, and come forward
again.

The first time through, Mapping has no list of unrecognised values, because nothing has read the
file yet. Continue, let the check run, and the list is waiting for you when you come back.

Changing anything on Mapping discards the last Review. That is deliberate: a summary that no longer
matches what you are about to import is worse than no summary, so the sheet takes it away rather
than leave a number on screen that is no longer true. The list of unrecognised values is kept while
you work through it, and only clears when you change the file, the register, the format or the
column map.
```

- [ ] **Step 2: Translate into `fr` and `pt`**

Read each file's existing register and match it. Keep the same headings and structure. Every key idea
must survive: Mapping decides, Review reports, the first pass has no list, changing something
discards the summary, the worklist survives while you work.

- [ ] **Step 3: Update the web doc**

Add the same explanation, condensed to a paragraph, in the section describing the wizard.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/docs --root apps/studio --testTimeout 30000 --hookTimeout 30000`
Run: `npx vitest run --root apps/web`

Do NOT run `pnpm docs:seed` or `pnpm gallery:screenshots`. Neither is part of this slice.

```bash
git add apps/studio/src/docs apps/web/src/docs
git commit -m "docs(facilities): Mapping decides and Review reports"
```

---

### Task 6: Verification, merge, changelog

- [ ] **Step 1: Full gate**

Run: `pnpm turbo run test --concurrency=4`
Expected: every task successful.

Never pipe through `tail`. A failure is usually a timeout: grep for `Test timed out` and re-run that
package alone before blaming a change.

- [ ] **Step 2: Live check**

Start the stack with the Browser pane's `preview_start`, never Bash. `AUTH_DEV_BYPASS` is `false` in
`.env`; if the run needs it `true`, say so out loud before flipping it and set it back afterwards.

⚠ `preview_start` has refused port 3000 as held by another chat while netstat showed it free. If that
recurs, the workaround that worked on 2026-09-07 was a temporary `api-alt` launch entry on 3001 plus
a one-line `vite.config.ts` proxy edit, both reverted before merging. `loadConfig` calls dotenv
without `override` (`packages/config/src/load.ts:29-33`), so a harness-set `PORT` wins over `.env`.

Confirm and record:
- Mapping carries columns, fixed values, the policy choices, and after a check the worklist.
- Review carries no editable control.
- Changing anything on Mapping removes Review from the step strip until a fresh check runs.
- Saving a value mapping leaves the worklist on screen and removes the summary.

- [ ] **Step 3: Mobile at 375x812**

Use `resize_window`. Mapping is now the longest pane in the sheet and has never been seen at this
width. Check the pane scrolls as one column, that no control overflows sideways, and that
`document.body.scrollWidth` equals 375.

⚠ Before trusting any measurement, assert your own preconditions: that `document.visibilityState` is
`visible` (a hidden pane pauses `requestAnimationFrame`), and that any list you meant to close
actually closed. `SuggestCombobox` closes on `mousedown`, not `click`, and a synthetic `mousedown` on
`document.body` is outside the Radix layer and dismisses the whole sheet. Both cost real time on
2026-09-07.

Headless Chromium cannot see a `vh`-versus-`dvh` problem. If anything bottom-anchored changed, say
only a real phone can confirm it and do not report it verified.

- [ ] **Step 4: Screenshot and report**

Capture Mapping and Review at both widths. State plainly what was proven and what was not.

- [ ] **Step 5: Stop the stack**

`preview_stop` does not kill `node dev.mjs` or its vite children. Check ports 3000 and 5173 are
actually free, and that `AUTH_DEV_BYPASS` is back to `false`.

- [ ] **Step 6: Merge and push**

```bash
git checkout main
git merge --no-ff feat/facility-import-review-read-only
git push origin main
git rev-parse origin/main
```

Confirm the origin SHA. No PR unless asked.

- [ ] **Step 7: Changelog, after the merge**

```bash
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
git push origin main
```

The generator reads git history, so it cannot see commits that are not there yet.

---

## What this plan does not do

State these when reporting completion.

- **No re-validate route.** Plan B adds it. Until then the streamed door's loop is the one it already
  has: change the map, upload again. Today's behaviour, so nothing regresses.
- **No change to what Apply writes.** This plan moves where decisions are made, never what the import
  does with them.
- **No fourth Apply step.** Rejected by the operator: with Review stripped of controls there is
  nothing left to confuse Apply with.
- **S-6 and S-7 are untouched.** Picker ordering and case-only differences both shorten this loop and
  are the next two slices. Doing them here would hide their measurements inside a structural change.
- **Nothing runs against real Postgres.** The studio tests are jsdom over test doubles. A green suite
  proves the state machine, not that a real register behaves this way end to end.
