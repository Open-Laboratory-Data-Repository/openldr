# Facility import fixed-value pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At Mapping, a fixed value for `level`, `status` or `country` is picked from that field's own value set, and a typed value that is not in the set says so on the spot.

**Architecture:** One new studio component, `ConstantValueField`, owns the picker for one controlled field. It fetches that field's whole value set from the route that already returns it, renders `SuggestCombobox` (proposes, never constrains), and shows a warning line when the current value is neither a code nor a display in the set. `ColumnMapStep` keeps its plain `Input` for every other contract field and renders `ConstantValueField` for the three controlled ones. No server change. No new route. No migration.

**Tech Stack:** React 18, TypeScript, vitest + @testing-library/react, react-i18next, Tailwind, shadcn primitives.

**Spec:** No separate spec file. The governing design is
`docs/superpowers/specs/2026-08-12-facility-import-mapping-design.md`, which introduced constants
and value mapping. The decision this plan implements was made in chat on 2026-09-07 and is recorded
below under "Decision record", with the measurements that produced it.

## Global Constraints

- `apps/studio` UI conventions are `AGENTS.md` §5. Form fields keep the existing
  `grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3` layout. shadcn primitives only.
- Every user-visible string is an i18n key present in all three of `en.ts`, `fr.ts` and `pt.ts`.
  `apps/studio/src/i18n/parity.test.ts` fails the moment one locale has a key another lacks.
- No em dashes in any file this plan touches. No emoji in headings or bullets.
- Never hardcode clinical vocabulary (`AGENTS.md` §8). Every code and display in this feature comes
  from the terminology service at runtime, through `suggestValueMappings`.
- Test command for one file: `npx vitest run <path> --root apps/studio --testTimeout 30000
  --hookTimeout 30000`. `pnpm --filter @openldr/studio test -- <path>` does NOT filter; the path is
  swallowed and the whole suite runs. Whole package: `npx vitest run --root apps/studio`.
  Full gate: `pnpm turbo run test`. Never pipe turbo through `tail`.
- No `Co-Authored-By` trailers.
- Work happens on a branch named `feat/facility-import-fixed-value-pickers`, cut from `main` at
  `58c78632`. Task 4 merges it to local `main` and then pushes. Do not open a PR unless asked.

---

## Decision record

Four facts, measured on 2026-09-07, that the tasks below depend on. An implementer who doubts a
task should re-check the cited line rather than guess.

**1. A typed fixed value is written verbatim to every row and then reported unmapped.**
`validateColumnMap` checks a constant's field name and collisions only, never its value
(`packages/terminology/src/facility-csv.ts:260-271`). The parser copies it into every row
(`packages/terminology/src/facility-csv.ts:411-413`). `resolveControlledFields` then finds it is
neither canonical nor mapped and pushes it into `unmapped`
(`packages/bootstrap/src/facility-controlled-fields.ts:146-154`).

Measured with a throwaway test in `packages/bootstrap`, since deleted:

```
RECORDS  [{"level":"Health Centre","status":"Functional","country":"ZMB"}, {...same}]
UNMAPPED {"level":["Health Centre"],"status":["Functional"],"country":[]}
```

`ZMB` passes because it is a seeded code
(`packages/db/src/migrations/internal/073_facility_country_and_admin_fields.ts:297`). Nothing else
about `country` is different. It works by luck.

**2. The picker stores the CODE, not the display.**
`applyControlledFields` rewrites a mapped raw value to the canonical code
(`packages/bootstrap/src/facility-controlled-fields.ts:183`). So a code chosen at Mapping is the
same string the mapping round trip would have produced, and it skips that round trip entirely.
`resolveControlledFields` accepts a code OR a non-empty display as canonical
(`packages/bootstrap/src/facility-controlled-fields.ts:139-143`), so a display would also pass, but
it would not match what the importer produces for every other value.

**3. The route already returns what a picker needs, and needs nothing new.**
`POST /api/facilities/import/suggest-values` returns `options`, the whole value set, alongside the
ranked `candidates` (`apps/server/src/facilities-routes.ts:1949`). It takes `{field, values}`; an
empty `values` array is valid and returns `{values: [], options: [...], notValidated}`. It does NOT
take `nationalSystem`, so the Mapping step can call it without knowing the register.

**4. `SuggestCombobox` does not portal, so the Sheet scroll trap does not apply.**
Its listbox is `absolute z-20` inside a `relative` wrapper
(`apps/studio/src/components/ui/suggest-combobox.tsx:126-131`). The `react-remove-scroll` trap in
`AGENTS.md` §6 applies to portalled `PopoverContent`, which is why the `Combobox` primitive
(`apps/studio/src/components/ui/combobox.tsx`) was not chosen here.

**Landmine this plan defuses in Task 2.** `apps/studio/src/facilities/ColumnMapStep.test.tsx` does
not mock `@/api` today, and `setupTests.ts` has no global `fetch` stub. `constantFields` is every
contract field no column claims, so its existing tests already render constants for `level`,
`status` and `country`. The moment those three render a fetching component, every existing test in
that file fires three unmocked requests. Task 2 adds the mock in the same commit as the wiring.

**Out of scope, deliberately.** Adding a concept that is not in the value set. It needs two writes
(create the concept in the CodeSystem, then rewrite the value set's `compose`, which
`expandCompose` reads), across two routes that are `MANAGE` while the import wizard is `IMPORT`
(`apps/server/src/terminology-admin-routes.ts:162` and `:376`), and `ValueSetOption` does not carry
the CodeSystem identity the first write needs (`apps/studio/src/api.ts:1321`). No user action is
broken without it: an unmapped value is written through unblocked, deliberately
(`packages/bootstrap/src/facility-controlled-fields.ts:169-171`), and this slice's escape hatch
covers the urgent case. It becomes justified when a raw value written through blocks something
downstream, which is already half true in the Edit sheet's vocabulary guard
(`docs/audit/2026-08-13-edit-sheet-after-an-import.md`).

**Out of scope, already covered.** CLI parity (`AGENTS.md` §6 item 2). `--column-map` takes the
whole map including constants (`packages/cli/src/facilities.ts:203-211`), and the preview already
prints `N unmapped <field> value(s) written as-is` per field
(`packages/cli/src/facilities.ts:584-589`). A picker is a UI affordance, not a new capability, so no
CLI command is added.

## File structure

| File | Responsibility |
|---|---|
| Create `apps/studio/src/facilities/ConstantValueField.tsx` | One controlled field's fixed-value input: fetch its value set, render the picker, render the warning or the not-seeded note. |
| Create `apps/studio/src/facilities/ConstantValueField.test.tsx` | Its behaviour, including the "could not ask" versus "nothing to ask about" split. |
| Modify `apps/studio/src/facilities/ColumnMapStep.tsx:316-333` | Branch the constants row: controlled field gets `ConstantValueField`, everything else keeps the plain `Input`. |
| Modify `apps/studio/src/facilities/ColumnMapStep.test.tsx:1-14` | Add the `@/api` mock the new fetch requires, and cover the branch. |
| Modify `apps/studio/src/i18n/{en,fr,pt}.ts` | Six new keys, one removed key. |
| Modify `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md` | The "Give it a fixed value" bullet. |
| Modify `apps/web/src/docs/0.1.0/facilities.md` | The "A fixed value (`constants`)" bullet. English only; the web docs have no locale directories. |

---

### Task 1: `ConstantValueField`

**Files:**
- Create: `apps/studio/src/facilities/ConstantValueField.tsx`
- Create: `apps/studio/src/facilities/ConstantValueField.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts:1082-1085`
- Modify: `apps/studio/src/i18n/fr.ts:1029-1032`
- Modify: `apps/studio/src/i18n/pt.ts:1029-1032`

**Interfaces:**
- Consumes: `suggestValueMappings(field, values)` and the types `ControlledField`, `ValueSetOption`
  from `@/api` (`apps/studio/src/api.ts:1321-1336`). `SuggestCombobox` and `SuggestStatus` from
  `@/components/ui/suggest-combobox`.
- Produces: `export function ConstantValueField(props: ConstantValueFieldProps): JSX.Element` with
  `ConstantValueFieldProps = { id: string; field: ControlledField; value: string; onChange: (next: string) => void }`.
  Task 2 renders exactly this.

- [ ] **Step 0: Cut the branch**

```bash
git checkout -b feat/facility-import-fixed-value-pickers
```

Expected: `main` is clean at `58c78632` before this runs. If it is not, stop and say so.

- [ ] **Step 1: Add the six i18n keys to `en.ts`, and remove `constantPlaceholderCountry`**

In `apps/studio/src/i18n/en.ts`, replace lines 1082-1085:

```ts
        constantsTitle: 'Fixed values',
        constantsHint: 'For a contract field no column in this file carries — every row gets this value.',
        constantPlaceholder: 'Same value for every row',
        constantPlaceholderCountry: 'e.g. ZMB',
```

with:

```ts
        constantsTitle: 'Fixed values',
        constantsHint: 'For a contract field no column in this file carries. Every row gets this value.',
        constantPlaceholder: 'Same value for every row',
        constantPickerPlaceholder: 'Type or pick a value',
        constantPickerLoading: 'Loading values…',
        constantPickerEmpty: 'No matching value',
        constantPickerError: 'Could not load the value list',
        constantNotInList: 'Not in the {{field}} list. It imports exactly as typed, and Review will ask you to map it.',
        constantNotSeeded: 'No {{field}} value list on this install, so nothing can be checked. The value imports as typed.',
```

The em dash in `constantsHint` goes with this edit; it is a string this task already rewrites.
`constantPlaceholderCountry` is removed because `country` no longer renders a plain `Input`, and a
key nothing reads is worse than no key.

- [ ] **Step 2: Mirror the same key edit into `fr.ts` and `pt.ts`**

In `apps/studio/src/i18n/fr.ts`, replace lines 1029-1032 with:

```ts
        constantsTitle: 'Valeurs fixes',
        constantsHint: 'Pour un champ du contrat qu’aucune colonne de ce fichier ne porte. Chaque ligne recevra cette valeur.',
        constantPlaceholder: 'Même valeur pour chaque ligne',
        constantPickerPlaceholder: 'Saisissez ou choisissez une valeur',
        constantPickerLoading: 'Chargement des valeurs…',
        constantPickerEmpty: 'Aucune valeur correspondante',
        constantPickerError: 'Impossible de charger la liste des valeurs',
        constantNotInList: 'Absent de la liste {{field}}. La valeur est importée telle quelle, et la Révision vous demandera de la mapper.',
        constantNotSeeded: 'Aucune liste de valeurs {{field}} sur cette installation, donc rien ne peut être vérifié. La valeur est importée telle quelle.',
```

In `apps/studio/src/i18n/pt.ts`, replace lines 1029-1032 with:

```ts
        constantsTitle: 'Valores fixos',
        constantsHint: 'Para um campo do contrato que nenhuma coluna deste ficheiro carrega. Cada linha recebe este valor.',
        constantPlaceholder: 'Mesmo valor para cada linha',
        constantPickerPlaceholder: 'Escreva ou escolha um valor',
        constantPickerLoading: 'A carregar valores…',
        constantPickerEmpty: 'Nenhum valor correspondente',
        constantPickerError: 'Não foi possível carregar a lista de valores',
        constantNotInList: 'Não está na lista {{field}}. É importado exatamente como escrito, e a Revisão vai pedir-lhe para o mapear.',
        constantNotSeeded: 'Não existe lista de valores {{field}} nesta instalação, por isso nada pode ser verificado. O valor é importado como escrito.',
```

- [ ] **Step 3: Run the parity test to confirm all three locales still match**

Run: `pnpm --filter @openldr/studio test -- src/i18n/parity.test.ts`
Expected: PASS, 3 tests.

If it fails, one of the three edits above dropped or misspelled a key. Fix the locale, not the test.

- [ ] **Step 4: Write the failing test file**

Create `apps/studio/src/facilities/ConstantValueField.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// `ConstantValueField` fetches its own value set, the same way `ValueMapPanel` does and unlike
// `ColumnMapStep`, which takes its column suggestions as a prop. There is no global `fetch` stub in
// `setupTests.ts`, so an unmocked call would hit Node's own `fetch` and reject on a relative URL.
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, suggestValueMappings: vi.fn() };
});

import * as api from '@/api';
import { ConstantValueField } from './ConstantValueField';

const mocked = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>;

const LEVEL_OPTIONS = [
  { code: 'health-center', display: 'Health Center' },
  { code: 'district-hospital', display: 'District Hospital' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocked(api.suggestValueMappings).mockResolvedValue({
    values: [], options: LEVEL_OPTIONS, notValidated: false,
  });
});

describe('ConstantValueField', () => {
  it('offers the whole value set and commits the CODE, not the display', async () => {
    const onChange = vi.fn();
    render(<ConstantValueField id="c-level" field="level" value="" onChange={onChange} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalledWith('level', []));

    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /health center/i }));

    expect(onChange).toHaveBeenCalledWith('health-center');
  });

  it('warns when the typed value is in neither the codes nor the displays', async () => {
    render(<ConstantValueField id="c-level" field="level" value="Health Centre" onChange={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/not in the level list/i);
  });

  it('does not warn about a value that is canonical by DISPLAY', async () => {
    render(<ConstantValueField id="c-level" field="level" value="Health Center" onChange={vi.fn()} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not warn about a value that is canonical by CODE', async () => {
    render(<ConstantValueField id="c-level" field="level" value="health-center" onChange={vi.fn()} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('never warns while the list is still loading', () => {
    mocked(api.suggestValueMappings).mockReturnValue(new Promise(() => {}));
    render(<ConstantValueField id="c-level" field="level" value="Health Centre" onChange={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // ⛔ "Could not ask" and "there is nothing to ask about" must not look the same on screen. This
  // is the exact confusion `ValueMapPanel` shipped with and had to fix: an operator faced with a
  // silently empty picker reasonably reads it as "there are no options".
  it('says the value set is not seeded, and warns about nothing, when notValidated', async () => {
    mocked(api.suggestValueMappings).mockResolvedValue({ values: [], options: [], notValidated: true });
    render(<ConstantValueField id="c-level" field="level" value="Health Centre" onChange={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/no level value list on this install/i);
    expect(screen.queryByText(/not in the level list/i)).toBeNull();
  });

  it('shows the fetch failure, and warns about nothing, when the request rejects', async () => {
    mocked(api.suggestValueMappings).mockRejectedValue(new Error('boom'));
    render(<ConstantValueField id="c-level" field="level" value="Health Centre" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the value list/i);
    expect(screen.queryByText(/not in the level list/i)).toBeNull();
  });

  // The parser writes the constant verbatim (`facility-csv.ts:411-413`) and `setConstant` stores it
  // untrimmed (`ColumnMapStep.tsx:232-235`), so a leading space genuinely is not canonical and the
  // warning must say so rather than quietly trimming for the check.
  it('treats a value with surrounding whitespace as not canonical', async () => {
    render(<ConstantValueField id="c-level" field="level" value=" health-center" onChange={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/not in the level list/i);
  });

  it('survives a route that returns no options key at all', async () => {
    mocked(api.suggestValueMappings).mockResolvedValue({ values: [], notValidated: false });
    render(<ConstantValueField id="c-level" field="level" value="" onChange={vi.fn()} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalled());
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run the test file to verify it fails**

Run: `pnpm --filter @openldr/studio test -- src/facilities/ConstantValueField.test.tsx`
Expected: FAIL. The first error is a module resolution failure, `Failed to resolve import "./ConstantValueField"`.

- [ ] **Step 6: Write the component**

Create `apps/studio/src/facilities/ConstantValueField.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SuggestCombobox, type SuggestStatus } from '@/components/ui/suggest-combobox';
import { suggestValueMappings, type ControlledField, type ValueSetOption } from '@/api';

export interface ConstantValueFieldProps {
  /** Matches the sibling `<Label htmlFor>` in `ColumnMapStep`'s constants grid. */
  id: string;
  field: ControlledField;
  /** The constant exactly as stored, untrimmed. `ColumnMapStep`'s `setConstant` does not trim, and
   *  the parser copies it into every row verbatim, so the canonical check below must not trim
   *  either. A leading space really is a different value. */
  value: string;
  onChange: (next: string) => void;
}

/** A fixed value for ONE controlled field, picked from that field's own value set.
 *
 *  ⛔ IT PROPOSES, IT DOES NOT CONSTRAIN. `SuggestCombobox` commits whatever is typed. That is
 *  deliberate: a field whose value set is not seeded on this install has nothing to offer, and
 *  refusing the operator's own value there would be worse than today's plain text box. The warning
 *  line is what closes the gap, by saying at Mapping what Review would otherwise say later.
 *
 *  ⛔ THE VALUE STORED IS THE CODE. `applyControlledFields` rewrites a mapped raw value to its
 *  canonical code (`packages/bootstrap/src/facility-controlled-fields.ts:183`), so a code chosen
 *  here is the same string the mapping round trip would have produced, and it skips that round trip
 *  entirely. The display renders as the option's label, so the list stays readable and searchable.
 *
 *  ⛔ THREE OUTCOMES, NOT TWO. "Loading", "the set is not seeded" and "the request failed" are
 *  distinct and are shown distinctly. `ValueMapPanel` shipped with the last two collapsed and an
 *  operator could not tell an empty picker from a broken one. Never warn in any of the three: the
 *  warning claims the value was checked, and in all three it was not. */
export function ConstantValueField({ id, field, value, onChange }: ConstantValueFieldProps): JSX.Element {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ValueSetOption[]>([]);
  const [status, setStatus] = useState<SuggestStatus>('loading');
  const [notSeeded, setNotSeeded] = useState(false);

  // ⛔ NO REF GUARD. `[field]` is already the correct and sufficient guard, and a ref set before the
  // await is exactly what made `ValueMapPanel` render empty pickers under React 18 StrictMode in
  // dev: pass one started the request and set the ref, cleanup set `cancelled`, pass two saw the
  // ref match and returned, and the first request resolved into a cancelled closure. See that
  // file's own docblock at `ValueMapPanel.tsx:100-108`.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setNotSeeded(false);
    setOptions([]);
    void suggestValueMappings(field, [])
      .then((res) => {
        if (cancelled) return;
        // `?? []` because the route omits `options` when the value set is missing, and several
        // existing test doubles resolve without the key at all.
        setOptions(res.options ?? []);
        setNotSeeded(res.notValidated === true);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => { cancelled = true; };
  }, [field]);

  const codes = useMemo(() => options.map((o) => o.code), [options]);

  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of options) m[o.code] = o.display && o.display !== '' ? o.display : o.code;
    return m;
  }, [options]);

  /** The code renders as the option's second line, so the operator sees the exact string the
   *  picker is about to store before they pick it. Omitted when it would repeat the label. */
  const descriptions = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of options) if (labels[o.code] !== o.code) m[o.code] = o.code;
    return m;
  }, [options, labels]);

  /** Codes AND non-empty displays, mirroring `resolveControlledFields`'s own rule
   *  (`packages/bootstrap/src/facility-controlled-fields.ts:139-143`). A check that differed from
   *  that one would warn about values the import accepts, or stay silent on values it does not. */
  const canonical = useMemo(() => {
    const s = new Set<string>();
    for (const o of options) {
      s.add(o.code);
      if (o.display !== null && o.display !== '') s.add(o.display);
    }
    return s;
  }, [options]);

  const checked = status === 'ready' && !notSeeded;
  const warn = checked && value !== '' && !canonical.has(value);

  return (
    <div className="space-y-1">
      <SuggestCombobox
        id={id}
        value={value}
        onChange={onChange}
        options={codes}
        optionLabels={labels}
        optionDescriptions={descriptions}
        status={status}
        placeholder={t('facilities.import.columnMap.constantPickerPlaceholder')}
        loadingLabel={t('facilities.import.columnMap.constantPickerLoading')}
        noSuggestionsLabel={t('facilities.import.columnMap.constantPickerEmpty')}
        errorFallback={t('facilities.import.columnMap.constantPickerError')}
      />
      {status === 'ready' && notSeeded && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('facilities.import.columnMap.constantNotSeeded', { field })}
        </p>
      )}
      {warn && (
        <p role="status" className="text-xs text-amber-700">
          {t('facilities.import.columnMap.constantNotInList', { field })}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run the test file to verify it passes**

Run: `pnpm --filter @openldr/studio test -- src/facilities/ConstantValueField.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 8: Run typecheck**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/facilities/ConstantValueField.tsx apps/studio/src/facilities/ConstantValueField.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(facilities): a fixed value for a controlled field is picked, not typed blind"
```

---

### Task 2: Wire it into the constants grid

**Files:**
- Modify: `apps/studio/src/facilities/ColumnMapStep.tsx:1-30` (imports and the mirrored field list)
- Modify: `apps/studio/src/facilities/ColumnMapStep.tsx:316-333` (the constants row)
- Modify: `apps/studio/src/facilities/ColumnMapStep.test.tsx:1-14` (the `@/api` mock)

**Interfaces:**
- Consumes: `ConstantValueField` from Task 1, exactly
  `{ id: string; field: ControlledField; value: string; onChange: (next: string) => void }`.
- Produces: no new exports. `ColumnMapStep`'s own props are unchanged, so
  `ImportFacilitiesSheet.tsx` needs no edit.

- [ ] **Step 1: Add the `@/api` mock to `ColumnMapStep.test.tsx` and write the failing tests**

At the very top of `apps/studio/src/facilities/ColumnMapStep.test.tsx`, before the
`import { ColumnMapStep }` line, insert:

```tsx
// ⛔ REQUIRED, not optional. `constantFields` is every contract field no column claims, so every
// test in this file already renders constants for `level`, `status` and `country`, and those three
// now render `ConstantValueField`, which fetches. There is no global `fetch` stub in
// `setupTests.ts`, so without this mock every test here fires three requests at Node's own `fetch`
// and rejects on a relative URL.
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, suggestValueMappings: vi.fn() };
});
```

Then add `beforeEach` to the `vitest` import on line 2 so it reads:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
```

Add these imports below the existing `import { ColumnMapStep } from './ColumnMapStep';` line:

```tsx
import * as api from '@/api';
```

Add this helper and hook immediately above `describe('ColumnMapStep', () => {`:

```tsx
const mockedApi = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedApi(api.suggestValueMappings).mockResolvedValue({
    values: [],
    options: [{ code: 'health-center', display: 'Health Center' }],
    notValidated: false,
  });
});
```

Then add these two tests inside the existing `describe('ColumnMapStep', ...)` block:

```tsx
  it('gives the three controlled fields a picker and every other field a plain box', async () => {
    render(<Controlled headers={suggestions.map((s) => s.header)} suggestions={suggestions} initial={emptyMap} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalledWith('level', []));
    expect(api.suggestValueMappings).toHaveBeenCalledWith('status', []);
    expect(api.suggestValueMappings).toHaveBeenCalledWith('country', []);
    expect(api.suggestValueMappings).toHaveBeenCalledTimes(3);

    // A picker is a combobox; a plain box is not.
    expect(screen.getByLabelText('level')).toHaveAttribute('role', 'combobox');
    expect(screen.getByLabelText('village')).not.toHaveAttribute('role', 'combobox');
  });

  it('picking a level writes the CODE into the column map', async () => {
    const onChangeSpy = vi.fn();
    render(
      <Controlled
        headers={suggestions.map((s) => s.header)}
        suggestions={suggestions}
        initial={emptyMap}
        onChangeSpy={onChangeSpy}
      />,
    );
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalled());

    fireEvent.focus(screen.getByLabelText('level'));
    fireEvent.click(await screen.findByRole('option', { name: /health center/i }));

    expect(onChangeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ constants: expect.objectContaining({ level: 'health-center' }) }),
    );
  });
```

Add `waitFor` to the `@testing-library/react` import on line 3 so it reads:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
```

- [ ] **Step 2: Run the file to verify the two new tests fail**

Run: `pnpm --filter @openldr/studio test -- src/facilities/ColumnMapStep.test.tsx`
Expected: the two new tests FAIL. The first fails on `expect(api.suggestValueMappings).toHaveBeenCalledWith('level', [])` with zero calls, because nothing fetches yet. The pre-existing tests in the file still pass.

- [ ] **Step 3: Wire the component into the constants grid**

In `apps/studio/src/facilities/ColumnMapStep.tsx`, add to the import block at the top:

```tsx
import type { ColumnSuggestion, ControlledField, FacilityColumnMap } from '@/api';
import { ConstantValueField } from './ConstantValueField';
```

(the existing `import type { ColumnSuggestion, FacilityColumnMap } from '@/api';` on line 12 gains
`ControlledField`.)

Add this below the `CONTRACT_FIELD_SET` declaration near line 29:

```tsx
/** The three fields bound to a value set. Mirrors `@openldr/bootstrap`'s `CONTROLLED_FIELDS`, the
 *  same "mirrored, not shared" idiom `ValueMapPanel.tsx:19` and this file's own `CONTRACT_FIELDS`
 *  already use, because this app has no dependency on that package. */
const CONTROLLED_CONSTANT_FIELDS = new Set<string>(['level', 'status', 'country']);
```

Replace the body of the `constantFields.map` at lines 316-331 with:

```tsx
            {constantFields.map((field) => (
              <Fragment key={field}>
                <Label htmlFor={`column-map-constant-${field}`} className="break-words">{field}</Label>
                {CONTROLLED_CONSTANT_FIELDS.has(field) ? (
                  // A controlled field's fixed value is picked from its own value set. Typing one
                  // blind could never work: `level` has 66 seeded concepts and the match is exact
                  // against a code or a display, so `Health Centre` misses `health-center` and
                  // `Health Center` both, and the operator only found out at Review.
                  <ConstantValueField
                    id={`column-map-constant-${field}`}
                    field={field as ControlledField}
                    value={value.constants?.[field] ?? ''}
                    onChange={(next) => setConstant(field, next)}
                  />
                ) : (
                  <Input
                    id={`column-map-constant-${field}`}
                    value={value.constants?.[field] ?? ''}
                    onChange={(e) => setConstant(field, e.target.value)}
                    placeholder={t('facilities.import.columnMap.constantPlaceholder')}
                  />
                )}
              </Fragment>
            ))}
```

The country placeholder branch goes with this edit. `country` no longer renders an `Input`, so
`constantPlaceholderCountry` has no reader, which is why Task 1 removed the key.

- [ ] **Step 4: Run the file to verify every test passes**

Run: `pnpm --filter @openldr/studio test -- src/facilities/ColumnMapStep.test.tsx`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Run the sheet's own test file, which mounts `ColumnMapStep` for real**

Run: `pnpm --filter @openldr/studio test -- src/facilities/ImportFacilitiesSheet.test.tsx`
Expected: PASS. That file already mocks `suggestValueMappings` and gives it a default resolved
value at `ImportFacilitiesSheet.test.tsx:188`, which resolves without an `options` key. The
component's `res.options ?? []` is what keeps this green; if it goes red on `options`, the `??` was
dropped.

- [ ] **Step 6: Run the whole studio package and typecheck**

Run: `pnpm --filter @openldr/studio test`
Expected: PASS. The baseline before this plan was 1842 of 1842.

Run: `pnpm --filter @openldr/studio typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/facilities/ColumnMapStep.tsx apps/studio/src/facilities/ColumnMapStep.test.tsx
git commit -m "feat(facilities): level, status and country fixed values are picked at Mapping"
```

---

### Task 3: Documentation

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/facilities.md:51-54`
- Modify: `apps/studio/src/docs/0.1.0/fr/facilities.md:61-64`
- Modify: `apps/studio/src/docs/0.1.0/pt/facilities.md:57-60`
- Modify: `apps/web/src/docs/0.1.0/facilities.md:24`

**Interfaces:**
- Consumes: nothing. Prose only.
- Produces: nothing later tasks read.

The web docs have no locale directories. `apps/web/src/docs/0.1.0/` holds nine `.md` files served
in English only, so the en/fr/pt requirement in `AGENTS.md` §6 item 3 is satisfied by the three
studio files. Do not go looking for `apps/web/src/docs/0.1.0/fr/`.

- [ ] **Step 1: Update the English in-app doc**

In `apps/studio/src/docs/0.1.0/en/facilities.md`, replace lines 51-54:

```markdown
- **Give it a fixed value.** Use this when the contract needs a field the file has no column for at
  all — a national file rarely carries its own country, for example, so `country` is usually a fixed
  value (`ZMB`, `TZA`, …) rather than a mapped column. Fixed values are the ISO code, never a label
  someone typed by hand.
```

with:

```markdown
- **Give it a fixed value.** Use this when the contract needs a field the file has no column for at
  all. A national file rarely carries its own country, for example, so `country` is usually a fixed
  value rather than a mapped column.

  `level`, `status` and `country` are bound to value sets, so their fixed value is picked from a
  list rather than typed. Picking writes the code, which is the same string the importer produces
  for a value you map at Review, so a picked value needs no mapping at all. You can still type a
  value the list does not offer. The panel says so when you do, and that value is imported exactly
  as typed and turns up at Review to be mapped. If an install has no value list for a field, the
  panel says that too, and nothing is checked.
```

- [ ] **Step 2: Update the French in-app doc**

In `apps/studio/src/docs/0.1.0/fr/facilities.md`, replace the bullet at lines 61-64 with:

```markdown
- **Lui donner une valeur fixe.** À utiliser quand le contrat a besoin d'un champ pour lequel le
  fichier n'a aucune colonne. Un fichier national porte rarement son propre pays, par exemple, donc
  `country` est généralement une valeur fixe plutôt qu'une colonne mappée.

  `level`, `status` et `country` sont liés à des jeux de valeurs, donc leur valeur fixe se choisit
  dans une liste au lieu de se saisir. Le choix écrit le code, c'est-à-dire la même chaîne que
  l'importateur produit pour une valeur mappée à la Révision, donc une valeur choisie n'a besoin
  d'aucun mappage. Vous pouvez toujours saisir une valeur absente de la liste. Le panneau vous le
  signale, et cette valeur est importée telle quelle puis apparaît à la Révision pour être mappée.
  Si une installation n'a aucune liste de valeurs pour un champ, le panneau le dit aussi, et rien
  n'est vérifié.
```

Read the surrounding lines before editing. Keep the existing bullet's exact indentation and the
list markers around it.

- [ ] **Step 3: Update the Portuguese in-app doc**

In `apps/studio/src/docs/0.1.0/pt/facilities.md`, replace the bullet at lines 57-60 with:

```markdown
- **Dar-lhe um valor fixo.** Use isto quando o contrato precisa de um campo para o qual o ficheiro
  não tem qualquer coluna. Um ficheiro nacional raramente carrega o seu próprio país, por exemplo,
  pelo que `country` é normalmente um valor fixo em vez de uma coluna mapeada.

  `level`, `status` e `country` estão ligados a conjuntos de valores, por isso o seu valor fixo
  escolhe-se numa lista em vez de se escrever. A escolha grava o código, que é a mesma cadeia que o
  importador produz para um valor mapeado na Revisão, pelo que um valor escolhido não precisa de
  mapeamento nenhum. Pode continuar a escrever um valor que a lista não oferece. O painel avisa-o
  quando o faz, e esse valor é importado exatamente como escrito e aparece na Revisão para ser
  mapeado. Se uma instalação não tiver lista de valores para um campo, o painel também o diz, e nada
  é verificado.
```

- [ ] **Step 4: Update the web doc**

In `apps/web/src/docs/0.1.0/facilities.md`, read line 24 and the two or three lines after it, then
append this sentence to that bullet, matching its existing indentation:

```markdown
  `level`, `status` and `country` are bound to value sets. In the studio their fixed value is picked
  from a list and stored as the code; through the CLI's `--column-map` file a `constants` entry for
  one of those three should be a code or a display from that field's value set, or the import writes
  it through as typed and reports it as unmapped.
```

- [ ] **Step 5: Verify the docs still build and render**

Run: `pnpm --filter @openldr/studio test -- src/docs`
Expected: PASS. `registry.test.ts` and `screenshots.test.ts` check that every doc listed in the
registry exists and that the screenshot manifest still matches. Neither reads the prose, so a
failure here means a file was renamed or moved, not that the wording is wrong.

Run: `pnpm --filter @openldr/web test`
Expected: PASS.

Do NOT run `pnpm docs:seed` or `pnpm gallery:screenshots`. Neither is part of this slice, and
`docs:seed` breaks after a `db reset`.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/docs/0.1.0/en/facilities.md apps/studio/src/docs/0.1.0/fr/facilities.md apps/studio/src/docs/0.1.0/pt/facilities.md apps/web/src/docs/0.1.0/facilities.md
git commit -m "docs(facilities): fixed values for the three controlled fields are picked"
```

---

### Task 4: Verification, merge, changelog

**Files:** none created or modified except `apps/web/src/landing/changelog.json`, which is generated.

**Interfaces:**
- Consumes: everything Tasks 1 to 3 produced.
- Produces: the merge and the regenerated changelog.

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo run test`
Expected: PASS across every package.

Never pipe this through `tail`. It truncates the failure list and hides which package failed. A
failure here is usually a timeout, not a regression: grep the output for `Test timed out` and re-run
that one package alone before blaming anything in this plan.

- [ ] **Step 2: Start the dev stack and open the import sheet**

Do NOT start servers with Bash. Use the Browser pane's `preview_start`.

Navigate to the Facilities page, open the import sheet, pick a register, choose a CSV whose headers
leave `level`, `status` and `country` unclaimed, and continue to step 2 Mapping.

`AUTH_DEV_BYPASS` is `false` in `.env`. If it needs to be `true` for this run, say so out loud
before flipping it, and set it back to `false` when finished.

- [ ] **Step 3: Confirm the three pickers, on a desktop viewport**

Check, and record what you saw:
- `level`, `status` and `country` each open a list on focus.
- The list shows the display over the code.
- Picking writes the code into the box.
- Typing `Health Centre` into `level` shows the amber "Not in the level list" line.
- `region`, `village`, `address` and `phone` still render a plain box with no list.

- [ ] **Step 4: Check it at 375x812**

Use `resize_window` at 375x812. Check that the open listbox is not clipped by the sheet's scroll
container, and that the warning line wraps rather than overflowing.

`SuggestCombobox` does not portal, so the `react-remove-scroll` trap does not apply here. The risk
that remains is the plain one: a `max-h-64` listbox opening near the bottom of a Sheet.

This step touches no bottom-anchored UI and no `h-screen`, so headless Chromium can settle it. If
that changes, say only a real phone can confirm it and do not report it verified.

- [ ] **Step 5: Screenshot and report**

Take a screenshot of the constants section with a picker open, and a second at 375x812. Send both
with `SendUserFile`. State plainly what was proven and what was not.

- [ ] **Step 6: Stop the dev stack and confirm the ports are free**

`preview_stop` does not kill `node dev.mjs` or its vite children. Check that ports 3000 and 5173 are
actually free before saying the stack is down.

- [ ] **Step 7: Merge to local `main`, then sync to origin**

```bash
git checkout main
git merge --no-ff feat/facility-import-fixed-value-pickers
git push origin main
git rev-parse origin/main
```

Confirm the origin SHA after pushing. Do not open a PR unless asked.

- [ ] **Step 8: Regenerate and commit the landing changelog**

Run AFTER the merge, never before. The generator reads git history, so it cannot see commits that
are not there yet.

```bash
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
git push origin main
```

`changelog.json` is committed source, not build output. Nothing regenerates it. The public
`/changelog` page reads a rolling window of the last 400 commits, so a slice that waits drops off
the tail.

Do NOT run `pnpm gallery:screenshots`. It is a heavy Playwright capture that belongs to a release
pass.

---

## What this plan does not do

State these plainly when reporting completion.

- No concept can be added to a value set from the wizard. Deferred, with the cost and the
  justifying symptom recorded under "Decision record".
- No CLI command is added. `--column-map` already carries constants and the preview already reports
  unmapped values per field.
- Slice 2 (remove the inline Preview door) and slice 4 (value-map Save affordance, re-validate
  route, toast feedback) are untouched.
- The warning is advisory. It never blocks Continue, never blocks Apply, and never blanks a value.
  An unmapped value staying importable is existing, deliberate behaviour
  (`packages/bootstrap/src/facility-controlled-fields.ts:169-171`) and this slice does not change it.
- Nothing runs against real Postgres. The studio tests are jsdom and the value sets are test
  doubles. A green studio suite proves the component and the wiring, not that this install's
  `facility-type` value set contains what an operator expects.


---

## What actually happened

Recorded after execution, on 2026-09-07. Read this before trusting a step above.

**Every task landed.** Five commits, `1921722f`, `9183a26e`, `7b9d07a3`, `063b4a6e`, `cffb96a1`.
Full gate green, 35 of 35 tasks. Studio 218 files and 1858 tests, up from 1842 by exactly the 16
added here.

**Three deviations.**

1. **The test command in this plan was wrong.** `pnpm --filter @openldr/studio test -- <path>`
   swallows the path and runs all 217 files. Corrected in Global Constraints above.

2. **The `constantPlaceholderCountry` removal moved from Task 1 to Task 2.** Task 1 removed a key
   whose only reader disappeared in Task 2, so the commit in between would have shipped a dead
   placeholder. The key now goes in the same commit as its reader.

3. **Two defects in `SuggestCombobox` were found by Task 4's browser check, and fixed.** Both are
   in the shared primitive, so `FormRuntime` and `MappingEditor` get them too. The operator
   approved widening the slice to cover them.

   - **Escape closed the whole sheet.** Radix's `useEscapeKeydown` registers on `document` with
     `{ capture: true }`, so a bubble-phase `stopPropagation` cannot reach it. A `window`-level
     capture listener, armed only while the list is open, is the only thing that can. Commit
     `063b4a6e`.
   - **The open list was clipped by the sheet's scroll container.** `country`'s 249 options in a
     256px list were clipped by 231px at 375x812 and by 260px on desktop. One
     `scrollIntoView({ block: 'nearest' })` from the effect takes all three fields to 0. Commit
     `cffb96a1`.

**A measurement error worth not repeating.** Two intermediate readings claimed the scroll needed
one and then two `requestAnimationFrame`s. Both were wrong. The probe reset the list with
`body.click()`, but the list closes on `mousedown`, so it never closed, `open` never changed, and
the effect never re-ran. A third reading was taken while the Browser pane was hidden, which pauses
rAF entirely. **A UI probe must verify its own preconditions**, here that the list actually closed
and that `document.visibilityState` is `visible`, before its numbers mean anything.

**HONEST NON-PROOF.**

- The final re-confirmation run of the scroll fix never completed. After many HMR cycles the sheet
  state thrashed and the renderer hung. The clean measurement above stands; a fresh repeat does not.
- "Upload and validate" was never pressed, because it writes a `facility_import_runs` row on a live
  install. Nothing proves end to end that a picked code stays out of `unmapped` at Review.
- The gate reported 34 of 35 packages cached. Only `apps/studio` changed, so that is legitimate,
  but no other package was exercised under load by this run.
