# Facility import step shell (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the facility import sheet three numbered steps, one visible primary action per step, and a register empty state that offers Add a register as its own action instead of hiding it in a dropdown.

**Architecture:** One explicit `step` state in `ImportFacilitiesSheet.tsx`, clamped by what the operator has actually supplied, plus a small presentational `ImportSteps` component. The sheet body is gated by step. No route, store or import behaviour changes at all: every existing action keeps working and keeps its place in the `⋯` menu, and the primary button only duplicates the one action that advances.

**Tech Stack:** React 18, TypeScript, Radix via `components/ui`, i18next (en/fr/pt), vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-06-facility-import-workflow-redesign-design.md`

## Global Constraints

- AGENTS.md section 5 bends here for exactly one thing: the primary step action. Everything else stays in the `⋯` dropdown. No `SheetFooter` with Cancel/Save. No standalone Create/New button anywhere else.
- shadcn only. Never a native `<select>`, `<button>`, `<input>` or `<dialog>`. Reuse `components/ui/*`.
- i18n keys land in all three of `apps/studio/src/i18n/{en,fr,pt}.ts` in the same commit. A missing key renders as literal braces.
- No em dashes in new prose or new copy. No emoji in headings or bullets.
- Full-height elements use `h-dvh`, never `h-screen`.
- Slice 1 changes no server route, no store method, and no import semantics. If a task appears to require one, stop and report rather than widening.
- The inline Preview path still exists in slice 1 and stays in the `⋯` menu. Slice 2 removes it. Do not delete it here.

---

### Task 1: The step model

A single source of truth for which step the operator is on, and which steps they are allowed to reach.

**Files:**
- Create: `apps/studio/src/facilities/importSteps.ts`
- Test: `apps/studio/src/facilities/importSteps.test.ts`

**Interfaces:**
- Produces:
  - `export type ImportStep = 1 | 2 | 3;`
  - `export interface StepGate { hasFile: boolean; hasRegister: boolean; hasReview: boolean; runActive: boolean; }`
  - `export function furthestStep(gate: StepGate): ImportStep`
  - `export function clampStep(requested: ImportStep, gate: StepGate): ImportStep`
  - `export function canGoBack(step: ImportStep, gate: StepGate): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { furthestStep, clampStep, canGoBack, type StepGate } from './importSteps';

const gate = (over: Partial<StepGate> = {}): StepGate => ({
  hasFile: false, hasRegister: false, hasReview: false, runActive: false, ...over,
});

describe('furthestStep', () => {
  it('stays on Source until BOTH a file and a register are chosen', () => {
    expect(furthestStep(gate())).toBe(1);
    expect(furthestStep(gate({ hasFile: true }))).toBe(1);
    expect(furthestStep(gate({ hasRegister: true }))).toBe(1);
  });

  it('opens Mapping once both are chosen', () => {
    expect(furthestStep(gate({ hasFile: true, hasRegister: true }))).toBe(2);
  });

  it('opens Review once a validated summary exists', () => {
    expect(furthestStep(gate({ hasFile: true, hasRegister: true, hasReview: true }))).toBe(3);
  });
});

describe('clampStep', () => {
  it('refuses a step the operator has not earned', () => {
    expect(clampStep(3, gate({ hasFile: true, hasRegister: true }))).toBe(2);
    expect(clampStep(2, gate())).toBe(1);
  });

  it('leaves a reachable step alone', () => {
    expect(clampStep(1, gate({ hasFile: true, hasRegister: true }))).toBe(1);
  });
});

describe('canGoBack', () => {
  it('allows going back from Mapping', () => {
    expect(canGoBack(2, gate({ hasFile: true, hasRegister: true }))).toBe(true);
  });

  it('never offers Back on the first step', () => {
    expect(canGoBack(1, gate())).toBe(false);
  });

  // The run is for THAT file under THAT register and nothing in the sheet can retract it, which is
  // the same reason `inputsDisabled` freezes the inputs while a run is live.
  it('refuses to go back while a run is live', () => {
    expect(canGoBack(3, gate({ hasFile: true, hasRegister: true, hasReview: true, runActive: true }))).toBe(false);
  });

  it('allows going back from a parked review, where nothing is in flight', () => {
    expect(canGoBack(3, gate({ hasFile: true, hasRegister: true, hasReview: true }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd apps/studio && npx vitest run src/facilities/importSteps.test.ts`
Expected: FAIL, cannot resolve `./importSteps`.

- [ ] **Step 3: Write the implementation**

```ts
/** Which of the import sheet's three steps the operator is on.
 *
 *  The sheet used to present five stages of work as one scrolling surface with no numbering and no
 *  way back, and every action for every stage in a single dropdown. This module is the "where am I"
 *  half of the fix. It holds no React state and no copy, so it can be tested as arithmetic.
 */
export type ImportStep = 1 | 2 | 3;

/** What the operator has actually supplied, as four booleans. Deliberately not the sheet's own
 *  state shape: this module must not know what a run, a preview or a summary is. */
export interface StepGate {
  hasFile: boolean;
  hasRegister: boolean;
  /** A validated summary is on screen, from either door. */
  hasReview: boolean;
  /** A background run is validating or applying right now. */
  runActive: boolean;
}

/** The furthest step the operator has earned. Never guesses forward. */
export function furthestStep(gate: StepGate): ImportStep {
  if (!gate.hasFile || !gate.hasRegister) return 1;
  return gate.hasReview ? 3 : 2;
}

/** The step to actually render: what was asked for, or the furthest earned, whichever is lower. */
export function clampStep(requested: ImportStep, gate: StepGate): ImportStep {
  const furthest = furthestStep(gate);
  return (requested < furthest ? requested : furthest);
}

/** Back is offered on any step but the first, and never while a run is in flight: the run is for
 *  THAT file under THAT register, and nothing in this sheet can retract it. Same reasoning as
 *  `inputsDisabled` freezing the inputs for a live run. */
export function canGoBack(step: ImportStep, gate: StepGate): boolean {
  return step > 1 && !gate.runActive;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd apps/studio && npx vitest run src/facilities/importSteps.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/facilities/importSteps.ts apps/studio/src/facilities/importSteps.test.ts
git commit -m "feat(facilities): a step model for the import sheet"
```

---

### Task 2: The step indicator

**Files:**
- Create: `apps/studio/src/facilities/ImportSteps.tsx`
- Test: `apps/studio/src/facilities/ImportSteps.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `apps/studio/src/i18n/fr.ts`, `apps/studio/src/i18n/pt.ts`

**Interfaces:**
- Consumes: `ImportStep` from `./importSteps`
- Produces: `export function ImportSteps(props: { current: ImportStep; furthest: ImportStep; onSelect: (s: ImportStep) => void }): JSX.Element`

- [ ] **Step 1: Add the i18n keys, all three languages**

In `apps/studio/src/i18n/en.ts`, inside the `facilities.import` group, immediately after `actions:`:

```ts
        steps: {
          label: 'Import steps',
          source: 'Source',
          mapping: 'Mapping',
          review: 'Review',
          position: 'Step {{current}} of 3',
        },
```

In `fr.ts`, same position:

```ts
        steps: {
          label: 'Étapes de l’import',
          source: 'Source',
          mapping: 'Correspondance',
          review: 'Vérification',
          position: 'Étape {{current}} sur 3',
        },
```

In `pt.ts`, same position:

```ts
        steps: {
          label: 'Passos da importação',
          source: 'Origem',
          mapping: 'Mapeamento',
          review: 'Revisão',
          position: 'Passo {{current}} de 3',
        },
```

- [ ] **Step 2: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { ImportSteps } from './ImportSteps';

describe('ImportSteps', () => {
  it('names all three steps and marks the current one', () => {
    render(<ImportSteps current={2} furthest={2} onSelect={vi.fn()} />);
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Mapping')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mapping/ })).toHaveAttribute('aria-current', 'step');
  });

  it('lets the operator go back to an earned step', () => {
    const onSelect = vi.fn();
    render(<ImportSteps current={2} furthest={2} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Source/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  // A step the operator has not earned must not be clickable: jumping to Review before a file is
  // chosen would show an empty surface with no explanation.
  it('disables a step that has not been earned, and does not fire onSelect for it', () => {
    const onSelect = vi.fn();
    render(<ImportSteps current={1} furthest={1} onSelect={onSelect} />);
    const review = screen.getByRole('button', { name: /Review/ });
    expect(review).toBeDisabled();
    fireEvent.click(review);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `cd apps/studio && npx vitest run src/facilities/ImportSteps.test.tsx`
Expected: FAIL, cannot resolve `./ImportSteps`.

- [ ] **Step 4: Write the implementation**

```tsx
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import type { ImportStep } from './importSteps';

const STEPS: { step: ImportStep; key: string }[] = [
  { step: 1, key: 'facilities.import.steps.source' },
  { step: 2, key: 'facilities.import.steps.mapping' },
  { step: 3, key: 'facilities.import.steps.review' },
];

export interface ImportStepsProps {
  current: ImportStep;
  /** The furthest step earned. Anything beyond it is rendered but not reachable. */
  furthest: ImportStep;
  onSelect: (step: ImportStep) => void;
}

/** The "where am I" strip. Presentational only: it holds no state and decides nothing about what is
 *  reachable, which is `importSteps.ts`'s job and is tested there as arithmetic. */
export function ImportSteps({ current, furthest, onSelect }: ImportStepsProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('facilities.import.steps.label')} className="flex items-center gap-1">
      {STEPS.map(({ step, key }) => {
        const reachable = step <= furthest;
        return (
          <Button
            key={step}
            variant="ghost"
            size="sm"
            aria-current={step === current ? 'step' : undefined}
            disabled={!reachable}
            onClick={() => onSelect(step)}
            className={cn(
              'h-7 px-2 text-xs',
              step === current ? 'text-foreground font-medium' : 'text-muted-foreground',
            )}
          >
            <span className="mr-1.5 tabular-nums">{step}</span>
            {t(key)}
          </Button>
        );
      })}
    </nav>
  );
}

export default ImportSteps;
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd apps/studio && npx vitest run src/facilities/ImportSteps.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/facilities/ImportSteps.tsx apps/studio/src/facilities/ImportSteps.test.tsx apps/studio/src/i18n
git commit -m "feat(facilities): a step indicator for the import sheet"
```

---

### Task 3: Wire the shell into the sheet, and gate the body by step

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Test: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

**Interfaces:**
- Consumes: `ImportStep`, `furthestStep`, `clampStep`, `canGoBack` from `./importSteps`; `ImportSteps` from `./ImportSteps`

- [ ] **Step 1: Write the failing test**

Append inside the existing outer `describe` in `ImportFacilitiesSheet.test.tsx`:

```tsx
  describe('the step shell', () => {
    it('starts on Source and does not show the mapping panel yet', async () => {
      mocked(api.suggestColumnMap).mockResolvedValue({ headers: [], columns: [] });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      expect(await screen.findByRole('button', { name: /1\s*Source/ }))
        .toHaveAttribute('aria-current', 'step');
      expect(screen.getByRole('button', { name: /2\s*Mapping/ })).toBeDisabled();
    });

    it('opens Mapping once a file and a register are chosen, and shows the column map there', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();

      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      expect(await screen.findByLabelText('MFL Code')).toBeInTheDocument();
    });

    // The register picker and the file input belong to step 1 and must not be on screen at step 2:
    // leaving them there is what made five stages read as one scrolling surface.
    it('hides the source inputs once past Source', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

      expect(screen.queryByLabelText('File')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'National system' })).not.toBeInTheDocument();
    });

    it('goes back to Source and shows those inputs again', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('button', { name: /1\s*Source/ }));

      expect(await screen.findByLabelText('File')).toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd apps/studio && npx vitest run src/facilities/ImportFacilitiesSheet.test.tsx -t "the step shell"`
Expected: FAIL. The first assertion cannot find a step button.

- [ ] **Step 3: Add the step state to the sheet**

Beside the other `useState` calls (near `const [file, setFile]`):

```tsx
  /** ⛔ REQUESTED, not effective. `clampStep` below is what actually renders, so a step the operator
   *  has not earned can never be shown even if this holds a stale value: picking a different file
   *  drops `hasReview` and the view falls back on its own, with no extra reset to remember. */
  const [requestedStep, setRequestedStep] = useState<ImportStep>(1);
```

After the existing `runActive` / `reviewResult` derivations:

```tsx
  const stepGate = {
    hasFile: !!file,
    hasRegister: nationalSystem.trim() !== '',
    hasReview: reviewResult !== null || appliedSummary !== null,
    runActive,
  };
  const furthest = furthestStep(stepGate);
  const step = clampStep(requestedStep, stepGate);
  const showBack = canGoBack(step, stepGate);
```

Add the import at the top of the file:

```tsx
import { ImportSteps } from './ImportSteps';
import { furthestStep, clampStep, canGoBack, type ImportStep } from './importSteps';
```

- [ ] **Step 4: Advance the step when the operator earns it**

Add one effect, directly after the derivations above:

```tsx
  // Auto-advance ONLY forward, and only to a step the operator has earned. Without this, uploading
  // from Mapping would leave them on Mapping staring at a panel while the summary rendered below
  // the fold. Never rewinds: `clampStep` already handles falling back when a file is swapped.
  useEffect(() => {
    setRequestedStep((prev) => (furthest > prev ? furthest : prev));
  }, [furthest]);
```

- [ ] **Step 5: Render the indicator beside the actions menu**

Replace the opening of the actions row (`<div className="flex items-center justify-end px-6 py-3">`) with:

```tsx
        <div className="flex items-center justify-between gap-2 px-6 py-3">
          <ImportSteps current={step} furthest={furthest} onSelect={setRequestedStep} />
```

Leave the `DropdownMenu` that follows exactly as it is. It keeps every existing item.

- [ ] **Step 6: Gate the body by step**

Wrap the source inputs block (the `grid grid-cols-[auto_1fr]` holding File, National system, File format, complete release and Release version) in `{step === 1 && ( ... )}`.

Wrap the `ColumnMapStep` block by adding `step === 2 &&` as a new FIRST term of its existing gate. That gate currently reads:

```tsx
          {format === 'csv' && columnMapHeaders.length > 0 && !appliedSummary
            && (!run || columnMapRefused)
            && (!reviewResult || columnMapRefused) && (
```

It becomes:

```tsx
          {step === 2 && format === 'csv' && columnMapHeaders.length > 0 && !appliedSummary
            && (!run || columnMapRefused)
            && (!reviewResult || columnMapRefused) && (
```

Do not remove or reorder any existing term. `columnMapRefused` is what keeps the panel mounted through a column-map refusal on both doors, and dropping it re-opens a bug fixed on 2026-09-06.

Wrap `ReconciliationSummary`, the run status blocks and `appliedSummary` in `{step === 3 && ( ... )}`.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/facilities/ImportFacilitiesSheet.test.tsx`
Expected: PASS. Some pre-existing tests will now fail because they assert on elements that belong to a later step. Fix each by driving the flow (click Continue) rather than by loosening the assertion, and add a one-line comment on any test you touch saying why it now needs the step.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/facilities
git commit -m "feat(facilities): gate the import sheet body by step"
```

---

### Task 4: One visible primary action per step

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`
- Test: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

- [ ] **Step 1: Add the i18n keys, all three languages**

`en.ts`, inside `facilities.import`:

```ts
        continueAction: 'Continue',
        backAction: 'Back',
```

`fr.ts`:

```ts
        continueAction: 'Continuer',
        backAction: 'Retour',
```

`pt.ts`:

```ts
        continueAction: 'Continuar',
        backAction: 'Voltar',
```

- [ ] **Step 2: Write the failing test**

```tsx
  describe('the primary action', () => {
    it('offers Continue on Source and Upload and validate on Mapping', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      const cont = await screen.findByRole('button', { name: 'Continue' });
      fireEvent.click(cont);

      expect(await screen.findByRole('button', { name: 'Upload and validate' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    });

    // The whole point of the exception to AGENTS.md section 5: the action that advances is visible,
    // and it is the ONLY visible one. Everything else stays in the dropdown.
    it('shows exactly one primary action, with Preview still in the menu', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

      expect(screen.queryByRole('button', { name: /^Preview$/ })).not.toBeInTheDocument();
      openMenu();
      expect(screen.getByRole('menuitem', { name: /^Preview$/ })).toBeInTheDocument();
    });

    it('Continue stays disabled until a file and a register are both chosen', async () => {
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled();
    });
  });
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cd apps/studio && npx vitest run src/facilities/ImportFacilitiesSheet.test.tsx -t "the primary action"`
Expected: FAIL, no Continue button.

- [ ] **Step 4: Render the primary action row**

Immediately after the `ImportSteps` / dropdown row, add:

```tsx
        {/* ⛔ THE ONE EXCEPTION to AGENTS.md section 5, and it is deliberately narrow: exactly one
            visible button, the one that advances this step. Every other action, including Preview,
            all three re-uploads, Cancel and Close, stays in the dropdown above. The rule broke
            because eleven items shared one menu and the operator could not tell which of them moved
            them forward. See the 2026-09-06 redesign spec. */}
        <div className="flex items-center justify-between gap-2 px-6 pb-3">
          {showBack ? (
            <Button variant="ghost" size="sm" onClick={() => setRequestedStep((s) => (s - 1) as ImportStep)}>
              {t('facilities.import.backAction')}
            </Button>
          ) : <span />}
          {step === 1 && (
            <Button
              size="sm"
              disabled={!stepGate.hasFile || !stepGate.hasRegister}
              onClick={() => setRequestedStep(2)}
            >
              {t('facilities.import.continueAction')}
            </Button>
          )}
          {step === 2 && (
            <Button size="sm" disabled={uploadDisabled} onClick={() => void handleUpload()}>
              {uploading ? uploadLabel : t('facilities.import.uploadAction')}
            </Button>
          )}
          {step === 3 && canConfirmRun && (
            <Button size="sm" disabled={confirming || cancelling} onClick={() => void handleConfirmRun()}>
              {confirming ? t('facilities.import.confirming') : t('facilities.import.confirmAction')}
            </Button>
          )}
        </div>
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/facilities/ImportFacilitiesSheet.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/facilities apps/studio/src/i18n
git commit -m "feat(facilities): one visible primary action per import step"
```

---

### Task 5: The register empty state

The fix for "you cannot start". A fresh install has no register, and today the only remedy is an item in a dropdown nothing points at.

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`
- Test: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

- [ ] **Step 1: Add the i18n keys, all three languages**

`en.ts`:

```ts
        noRegisterTitle: 'Register this file’s source first',
        noRegisterBody: 'An import is filed under a national register, and this install has none yet. Add one to continue.',
```

`fr.ts`:

```ts
        noRegisterTitle: 'Enregistrez d’abord la source de ce fichier',
        noRegisterBody: 'Un import est classé sous un registre national, et cette installation n’en a aucun. Ajoutez-en un pour continuer.',
```

`pt.ts`:

```ts
        noRegisterTitle: 'Registe primeiro a origem deste ficheiro',
        noRegisterBody: 'Uma importação é arquivada sob um registo nacional, e esta instalação ainda não tem nenhum. Adicione um para continuar.',
```

- [ ] **Step 2: Write the failing test**

```tsx
  describe('the register empty state', () => {
    it('says a register is required and offers Add a register as the step action', async () => {
      mocked(api.listFacilityImportSources).mockResolvedValue([]);
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      expect(await screen.findByText(/Register this file’s source first/)).toBeInTheDocument();
      // ⛔ The action is VISIBLE, not an item in a menu nobody has a reason to open. This is the
      // whole fix for "user doesnt know they have to register a national system first".
      expect(screen.getByRole('button', { name: 'Register a source' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    });

    it('goes back to the ordinary Continue action once a register exists', async () => {
      // A bare array, NOT `{ rows }` — that is this client's actual shape, and the file's own
      // HFR_SOURCE fixture is the same. Getting it wrong makes `sources.length === 0` stay true and
      // the test passes for the wrong reason.
      mocked(api.listFacilityImportSources).mockResolvedValue([HFR_SOURCE]);
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument();
      expect(screen.queryByText(/Register this file’s source first/)).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cd apps/studio && npx vitest run src/facilities/ImportFacilitiesSheet.test.tsx -t "the register empty state"`
Expected: FAIL, no such text.

- [ ] **Step 4: Implement**

Add the derivation beside the other step derivations:

```tsx
  /** A fresh install has NO register: migration 082's back-fill seeds only from `national_system`
   *  values a pre-existing `facility_registry` already carries. Import is then unreachable until one
   *  is created, and the only affordance was a dropdown item. This makes the requirement the step's
   *  own content, and the remedy its own button. */
  const needsRegister = !sourcesLoading && !sourcesError && sources.length === 0;
```

In the step-1 body, above the source inputs:

```tsx
          {step === 1 && needsRegister && (
            <div className="mx-6 mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
              <p className="font-medium">{t('facilities.import.noRegisterTitle')}</p>
              <p className="text-xs">{t('facilities.import.noRegisterBody')}</p>
            </div>
          )}
```

In the primary-action row, replace the `step === 1` branch with:

```tsx
          {step === 1 && (needsRegister ? (
            <Button size="sm" disabled={inputsDisabled} onClick={() => setRegisterSourceOpen(true)}>
              {t('facilities.import.registerSourceAction')}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!stepGate.hasFile || !stepGate.hasRegister}
              onClick={() => setRequestedStep(2)}
            >
              {t('facilities.import.continueAction')}
            </Button>
          ))}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/facilities/ImportFacilitiesSheet.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/facilities apps/studio/src/i18n
git commit -m "feat(facilities): state the register requirement where it blocks the import"
```

---

### Task 6: Docs, mobile, and the full gate

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`
- Modify: `apps/web/src/docs/0.1.0/facilities.md`

- [ ] **Step 1: Update the in-app docs, all three languages**

In each `facilities.md`, in the import section, replace any prose describing the sheet as a single surface with a short description of the three steps: Source (file and register, and Add a register when the install has none), Mapping (columns and fixed values), Review (the validated summary, value mapping, and Confirm). State that every other action stays in the `⋯` menu.

Keep the existing passthrough and unrecognised-columns notes exactly as they are. Slice 1 changes none of that behaviour.

- [ ] **Step 2: Update the web docs**

`apps/web/src/docs/0.1.0/facilities.md`: one paragraph naming the three steps. No API changes in this slice, so nothing else moves.

- [ ] **Step 3: Typecheck and run the full studio suite**

```bash
cd apps/studio && npx tsc --noEmit -p tsconfig.json && npx vitest run --no-file-parallelism
```

Expected: tsc exit 0, and all tests pass. A failure in an unrelated file with `Test timed out in 5000ms` is load, not a regression: re-run that file alone before blaming this change.

- [ ] **Step 4: Verify at 375 by hand**

Start the API and studio via `preview_start`, resize to 375x812, open the sheet, and check three things: the step strip does not overflow, the primary action is reachable without horizontal scrolling, and `document.documentElement.scrollWidth` equals `window.innerWidth`.

The primary action row is NOT bottom-pinned in this design, so the `vh` versus `dvh` trap does not apply. If a later change pins it, that change must say only a real phone can confirm it, because headless Chromium has no retractable URL bar and every bottom-edge check passes either way.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/docs apps/web/src/docs
git commit -m "docs(facilities): describe the three import steps"
```

- [ ] **Step 6: Merge and regenerate the changelog**

```bash
git checkout main
git merge --no-ff <branch> -m "merge: a step shell for the facility import sheet"
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
```

Confirm the origin SHA after any push.

---

## Out of scope for this slice

Named here so an executor does not drift into them.

- Removing the inline Preview path. That is slice 2. Preview stays in the `⋯` menu.
- Changing what a header can map to. That is slice 3. `Not mapped` still exists.
- The value-mapping Save affordance, the re-validate route, and sonner feedback. That is slice 4.
- The shared refusal wording (`both map to`) and the `actorName` doc mismatch. Both out of the whole redesign.
