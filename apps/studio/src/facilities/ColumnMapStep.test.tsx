import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// ⛔ REQUIRED, not optional. `constantFields` is every contract field no column claims, so every
// test in this file already renders constants for `level`, `status` and `country`, and those three
// now render `ConstantValueField`, which fetches. There is no global `fetch` stub in
// `setupTests.ts`, so without this mock every test here fires three requests at Node's own `fetch`
// and rejects on a relative URL.
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    suggestValueMappings: vi.fn(),
    // Task 5: the per-field check and the two calls it must never make. `uploadFacilityImport`
    // and `revalidateFacilityImportRun` are mocked purely so `.not.toHaveBeenCalled()` below can
    // tell "never called" apart from "not a mock". This file never invokes either for real.
    readFacilityImportColumnValues: vi.fn(),
    uploadFacilityImport: vi.fn(),
    revalidateFacilityImportRun: vi.fn(),
    // Fix pass (Critical finding, mapping-answers-back Slice B Task 6): the Save button aggregates
    // every row's chosen mappings into one call. No test in this file exercised it before this pass.
    writeFacilityValueMappings: vi.fn(),
  };
});

import * as api from '@/api';
import { ColumnMapStep } from './ColumnMapStep';
import type { ColumnSuggestion, ControlledField, FacilityColumnMap } from '@/api';

const mockedApi = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>;

const suggestions: ColumnSuggestion[] = [
  { header: 'MFL Code', candidates: [{ target: 'national_code', display: null, score: 1, confidence: 'exact' }] },
  { header: 'Province', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
  { header: 'Catchment population cso', candidates: [] },
];

const emptyMap: FacilityColumnMap = { columns: {}, constants: {}, extras: [] };

/** Opens a row's ⋯ menu. `DropdownMenuItem` (Radix) renders with `role="menuitem"` and only mounts
 *  once the menu is open, so it is never reachable via `getByRole('button', ...)` without this —
 *  same idiom `ImportFacilitiesSheet.test.tsx`'s own `openMenu`/`RegisterSourceDialog.test.tsx`'s
 *  `openDialogMenu` already use for every other ⋯ menu in this app: `userEvent.click` does not
 *  reliably open a Radix dropdown under jsdom, so this fires the pointer event Radix itself listens
 *  for, with a keyboard fallback. */
function openRowMenu(name: string) {
  const trigger = screen.getByRole('button', { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

/** ⛔ Fix pass (declined-suggestion finding): the panel now seeds suggestions into `value.columns`
 *  ONCE, via `onChange`, on mount — see `ColumnMapStep.tsx`'s own fix-pass docblock. A no-op
 *  `onChange` therefore no longer reflects that seed back into what the panel reads, and a bare
 *  `render()` under-tests real usage: Task 8's `ImportFacilitiesSheet` genuinely is a controlled
 *  parent that stores `value` in state and re-renders on every `onChange`. This wrapper is that
 *  parent, so every test below exercises the real contract, not a stub that happens to look right
 *  once. `onChangeSpy` (when passed) still observes every call, same as a `vi.fn()` would. */
function Controlled({ initial, onChangeSpy, runId = null, ...rest }: {
  initial: FacilityColumnMap;
  onChangeSpy?: (next: FacilityColumnMap) => void;
  runId?: string | null;
  headers: string[];
  suggestions: ColumnSuggestion[];
  onValidityChange?: (valid: boolean) => void;
  unmappedByField?: Record<ControlledField, string[]>;
  nationalSystem?: string;
  onValueMappingsSaved?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ColumnMapStep
      {...rest}
      runId={runId}
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
    />
  );
}

/** Task 6: a thin wrapper matching the brief's own call shape (`renderColumnMapStep({ runId,
 *  headers, value })`), with `Controlled` underneath, same as every other test in this file.
 *
 *  Fix pass (Critical finding): also forwards `unmappedByField`/`nationalSystem`/
 *  `onValueMappingsSaved`, which is what `unmappedByFieldSignature`'s own effect and `handleSaveValueMappings`
 *  read, so a test can reproduce the server-vs-client worklist disagreement directly. */
function renderColumnMapStep(props: {
  runId?: string | null;
  headers: string[];
  suggestions?: ColumnSuggestion[];
  value: FacilityColumnMap;
  onChangeSpy?: (next: FacilityColumnMap) => void;
  onValidityChange?: (valid: boolean) => void;
  unmappedByField?: Record<ControlledField, string[]>;
  nationalSystem?: string;
  onValueMappingsSaved?: () => void;
}) {
  return render(
    <Controlled
      runId={props.runId ?? null}
      headers={props.headers}
      suggestions={props.suggestions ?? []}
      initial={props.value}
      onChangeSpy={props.onChangeSpy}
      onValidityChange={props.onValidityChange}
      unmappedByField={props.unmappedByField}
      nationalSystem={props.nationalSystem}
      onValueMappingsSaved={props.onValueMappingsSaved}
    />,
  );
}

beforeEach(() => {
  mockedApi(api.suggestValueMappings).mockResolvedValue({
    values: [],
    options: [{ code: 'health-center', display: 'Health Center' }],
    notValidated: false,
  });
});

describe('ColumnMapStep', () => {
  it('gives the three controlled fields a picker and every other field a plain box', async () => {
    render(<Controlled headers={suggestions.map((s) => s.header)} suggestions={suggestions} initial={emptyMap} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalledWith('level', [], ''));
    expect(api.suggestValueMappings).toHaveBeenCalledWith('status', [], '');
    expect(api.suggestValueMappings).toHaveBeenCalledWith('country', [], '');
    expect(api.suggestValueMappings).toHaveBeenCalledTimes(3);

    // A picker is a combobox; a plain box is not.
    expect(screen.getByLabelText('level')).toHaveAttribute('role', 'combobox');
    expect(screen.getByLabelText('village')).not.toHaveAttribute('role', 'combobox');
  });

  // Slice B, Task 3: a row's own check must tell suggest-values which register the values came
  // from, so the studio shows a register's own facility types, not just the shared list.
  it('tells suggest-values which register the values came from', async () => {
    mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
      header: 'Type', values: ['Others'], distinct: 1, truncated: false,
    });
    renderColumnMapStep({
      runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
      value: { columns: { Type: 'level' }, constants: {}, extras: [] },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalledWith('level', ['Others'], 'urn:zm:mfl'));
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

  // ⛔ THE OPTION IS LABELLED "Keep as extra data", not "Not mapped", and the assertions below
  // moved with it. The old label was a description of the wire shape (an absent `columns` entry)
  // rather than of what happens: an unmapped column is carried into each row's `extras`. It is
  // now true on every row, whether the header spells a contract field or not, which is what let
  // the parser stop refusing files over columns the operator had deliberately skipped.

  it('pre-selects exact suggestions and leaves unmatched headers unset', () => {
    render(<Controlled headers={suggestions.map((s) => s.header)} suggestions={suggestions} initial={emptyMap} />);
    expect(screen.getByLabelText('MFL Code')).toHaveTextContent('national_code');
    expect(screen.getByLabelText('Catchment population cso')).toHaveTextContent('Keep as extra data');
  });

  it('⛔ refuses to continue while a required field is unmapped', () => {
    render(<Controlled headers={['Province']} suggestions={[suggestions[1]]}
      initial={{ columns: { Province: 'zone' }, constants: {}, extras: [] }} />);
    expect(screen.getByText(/name is not mapped/i)).toBeInTheDocument();
  });

  it('sends a header to extras in one action', () => {
    const onChange = vi.fn();
    render(<Controlled headers={['Catchment population cso']} suggestions={[suggestions[2]]}
      initial={emptyMap} onChangeSpy={onChange} />);
    openRowMenu('Actions for Catchment population cso');
    fireEvent.click(screen.getByRole('menuitem', { name: /keep as extra/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ extras: ['Catchment population cso'] }));
  });

  it('Clear resets a mapped header back to Not mapped', () => {
    const onChange = vi.fn();
    render(<Controlled headers={['MFL Code']} suggestions={[suggestions[0]]}
      initial={{ columns: { 'MFL Code': 'national_code' }, constants: {}, extras: [] }} onChangeSpy={onChange} />);
    openRowMenu('Actions for MFL Code');
    fireEvent.click(screen.getByRole('menuitem', { name: /^clear$/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ columns: {} }));
  });

  describe('⛔ fix pass — an explicitly declined suggestion must stick (the finding this pass fixes)', () => {
    it('Clear stays "Not mapped" after the panel re-renders with the value it just emitted', () => {
      // MFL Code is the SOLE claimant of the exact suggestion for national_code — nothing else
      // could re-seed it. Before the fix, `selectedTarget` fell back to `autoTargetByHeader` on
      // every render, so the Select silently snapped back to `national_code` right after Clear.
      render(<Controlled headers={['MFL Code']} suggestions={[suggestions[0]]}
        initial={{ columns: { 'MFL Code': 'national_code' }, constants: {}, extras: [] }} />);
      expect(screen.getByLabelText('MFL Code')).toHaveTextContent('national_code');

      openRowMenu('Actions for MFL Code');
      fireEvent.click(screen.getByRole('menuitem', { name: /^clear$/i }));

      // The `Controlled` wrapper already re-rendered the panel with the emitted value by this
      // point (its own `onChange` calls `setValue` synchronously) — this assertion is the one
      // that fails on the pre-fix component, once real re-render is exercised at all.
      expect(screen.getByLabelText('MFL Code')).toHaveTextContent('Keep as extra data');
    });

    it('Keep as extra makes the blocking summary name the now-missing required field', () => {
      // Same setup: MFL Code is the sole claimant of national_code. Before the fix,
      // `claimedTargets` fell back to `autoTargetByHeader` for ANY header without a `columns`
      // entry — including one just sent to `extras` — so the summary and `onValidityChange` both
      // kept reporting the map as satisfied even though the server's `validateColumnMap` would
      // refuse it with `missing_required`.
      // `name` is required too — satisfy it with a constant so `national_code` is the only field
      // under test here; otherwise `onValidityChange` would read false from the start regardless
      // of the fix, for an unrelated reason.
      const onValidityChange = vi.fn();
      render(<Controlled headers={['MFL Code']} suggestions={[suggestions[0]]}
        initial={{ columns: { 'MFL Code': 'national_code' }, constants: { name: 'Test Facility' }, extras: [] }}
        onValidityChange={onValidityChange} />);
      expect(screen.queryByText(/national_code is not mapped/i)).not.toBeInTheDocument();
      expect(onValidityChange).toHaveBeenLastCalledWith(true);

      openRowMenu('Actions for MFL Code');
      fireEvent.click(screen.getByRole('menuitem', { name: /keep as extra/i }));

      expect(screen.getByText(/national_code is not mapped/i)).toBeInTheDocument();
      expect(onValidityChange).toHaveBeenLastCalledWith(false);
    });
  });

  describe('collision handling — measured on the real Zambia MFL export (⛔ the finding this panel exists for)', () => {
    it('pre-selects NEITHER Province nor Zone when both suggest `zone` at exact confidence', () => {
      const colliding: ColumnSuggestion[] = [
        { header: 'Province', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Zone', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
      ];
      render(<Controlled headers={['Province', 'Zone']} suggestions={colliding} initial={emptyMap} />);
      expect(screen.getByLabelText('Province')).toHaveTextContent('Keep as extra data');
      // ⛔ `Zone` reads `zone` — NOT because the seed picked it (it did not, which is what this
      // test is about) but because the header spells the field, so the parser's passthrough rule
      // claims it. Asserting "Not mapped" here is what this panel used to do, and it was untrue:
      // the server then refused `Province → zone` with `duplicate_target`. See the passthrough
      // block below for that rule on its own.
      expect(screen.getByLabelText('Zone')).toHaveTextContent('zone');
      // The seed genuinely wrote nothing: with the claim released, the row falls back to unmapped.
      expect(screen.queryByText(/both claim zone/i)).not.toBeInTheDocument();
    });

    it('pre-selects NEITHER Ownership nor Ownership type when both suggest `ownership`', () => {
      const colliding: ColumnSuggestion[] = [
        { header: 'Ownership', candidates: [{ target: 'ownership', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Ownership type', candidates: [{ target: 'ownership', display: null, score: 1, confidence: 'exact' }] },
      ];
      render(<Controlled headers={['Ownership', 'Ownership type']} suggestions={colliding} initial={emptyMap} />);
      // Same split as Province/Zone above: neither is SEEDED, but `Ownership` spells the field and
      // therefore claims it. `Ownership type` spells nothing and stays genuinely unmapped.
      expect(screen.getByLabelText('Ownership')).toHaveTextContent('ownership');
      expect(screen.getByLabelText('Ownership type')).toHaveTextContent('Keep as extra data');
    });

    it('still pre-selects a lone exact suggestion once only one header claims the target', () => {
      // Same shape as the two tests above, minus the second claimant — the collision rule must not
      // over-fire and block an ordinary, unambiguous exact match.
      render(<Controlled headers={['MFL Code']} suggestions={[suggestions[0]]} initial={emptyMap} />);
      expect(screen.getByLabelText('MFL Code')).toHaveTextContent('national_code');
    });
  });

  it('pre-selects a `likely` suggestion WITH a badge telling the operator to check it', () => {
    const likely: ColumnSuggestion[] = [
      { header: 'Facility Type', candidates: [{ target: 'level', display: null, score: 0.8, confidence: 'likely' }] },
    ];
    render(<Controlled headers={['Facility Type']} suggestions={likely} initial={emptyMap} />);
    expect(screen.getByLabelText('Facility Type')).toHaveTextContent('level');
    expect(screen.getByText(/check this/i)).toBeInTheDocument();
  });

  it('does not pre-select — or badge — a `weak` suggestion', () => {
    const weak: ColumnSuggestion[] = [
      { header: 'Mobility status', candidates: [{ target: 'status', display: null, score: 0.65, confidence: 'weak' }] },
    ];
    render(<Controlled headers={['Mobility status']} suggestions={weak} initial={emptyMap} />);
    expect(screen.getByLabelText('Mobility status')).toHaveTextContent('Keep as extra data');
    expect(screen.queryByText(/check this/i)).not.toBeInTheDocument();
  });

  it('writes a typed constant for a field no column maps, e.g. country', () => {
    const onChange = vi.fn();
    render(<Controlled headers={[]} suggestions={[]} initial={emptyMap} onChangeSpy={onChange} />);
    fireEvent.change(screen.getByLabelText('country'), { target: { value: 'ZMB' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ constants: expect.objectContaining({ country: 'ZMB' }) }));
  });

  it('a satisfied-by-constant required field does not appear in the blocking summary', () => {
    render(<Controlled headers={[]} suggestions={[]}
      initial={{ columns: {}, constants: { national_code: 'FIXED', name: 'FIXED' }, extras: [] }} />);
    expect(screen.queryByText(/is not mapped/i)).not.toBeInTheDocument();
  });

  it('reports validity through onValidityChange as required fields are resolved', () => {
    const onValidityChange = vi.fn();
    const { rerender } = render(<ColumnMapStep headers={['Province']} suggestions={[suggestions[1]]}
      value={{ columns: { Province: 'zone' }, constants: {}, extras: [] }} onChange={() => {}}
      runId={null} onValidityChange={onValidityChange} />);
    expect(onValidityChange).toHaveBeenLastCalledWith(false);

    rerender(<ColumnMapStep headers={['Province']} suggestions={[suggestions[1]]}
      value={{ columns: { Province: 'zone' }, constants: { national_code: 'X', name: 'Y' }, extras: [] }}
      onChange={() => {}} runId={null} onValidityChange={onValidityChange} />);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  describe('⛔ passthrough — a header that already spells a contract field claims it', () => {
    // The parser's rule, not this panel's invention: `validateColumnMap`
    // (packages/terminology/src/facility-csv.ts) walks the file's own headers and lets any header
    // spelling a contract field claim that field unless an explicit `extras` entry releases it.
    // The panel used to show such a header as "Not mapped", which is simply untrue — the Zambia
    // team hit it as a `duplicate_target` refusal on a map the panel had called safe.
    const zambia: ColumnSuggestion[] = [
      { header: 'Province', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
      { header: 'Zone', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
    ];

    it('shows the field it claims, not the release option', () => {
      render(<Controlled headers={['Province', 'Zone']} suggestions={zambia} initial={emptyMap} />);
      expect(screen.getByLabelText('Zone')).toHaveTextContent('zone');
    });

    it('satisfies a required field on its own, with no blocking summary', () => {
      // Neither header is mapped and there is no constant anywhere. The server would accept this
      // file; before the fix the panel claimed both required fields were missing.
      render(<Controlled headers={['national_code', 'name']} suggestions={[]} initial={emptyMap} />);
      expect(screen.queryByText(/is not mapped/i)).not.toBeInTheDocument();
    });

    it('names both claimants when a mapped column collides with a passthrough header', () => {
      render(<Controlled headers={['Province', 'Zone']} suggestions={zambia}
        initial={{ columns: { Province: 'zone' }, constants: {}, extras: [] }} />);
      expect(screen.getByText(/both claim zone/i)).toBeInTheDocument();
    });

    it('reports a collision as invalid through onValidityChange', () => {
      const onValidityChange = vi.fn();
      render(<Controlled headers={['Province', 'Zone']} suggestions={zambia}
        initial={{ columns: { Province: 'zone' }, constants: { national_code: 'X', name: 'Y' }, extras: [] }}
        onValidityChange={onValidityChange} />);
      expect(onValidityChange).toHaveBeenLastCalledWith(false);
    });

    it('names both claimants when a fixed value collides with a passthrough header', () => {
      // The second error the Zambia team saw, and the reason it was unfixable: `Ownership` and
      // `Ownership type` both suggest `ownership`, so the collision rule leaves BOTH unmapped —
      // yet `Ownership` still claims the field by spelling it. The panel therefore offered a fixed
      // value for `ownership` that could only ever collide.
      render(<Controlled headers={['Ownership', 'Ownership type']} suggestions={[]}
        initial={{ columns: {}, constants: { ownership: 'PUBLIC' }, extras: [] }} />);
      expect(screen.getByText(/both claim ownership/i)).toBeInTheDocument();
    });

    it('releases the claim when the operator picks Not mapped', async () => {
      const onChange = vi.fn();
      render(<Controlled headers={['Province', 'Zone']} suggestions={zambia}
        initial={{ columns: { Province: 'zone' }, constants: {}, extras: [] }} onChangeSpy={onChange} />);
      fireEvent.click(screen.getByLabelText('Zone'));
      fireEvent.click(await screen.findByRole('option', { name: 'Keep as extra data' }));
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ extras: ['Zone'] }));
      expect(screen.queryByText(/both claim zone/i)).not.toBeInTheDocument();
    });

    // ⛔ THE BADGE IS GONE, and this test moved with it rather than being deleted. It was added
    // when the option still read "Not mapped", which said nothing about where the column went, so a
    // header in `extras` needed a second element to distinguish it from one nobody had touched. The
    // option now reads "Keep as extra data" itself, so the badge repeated it word for word on the
    // same row. What still matters is the distinction it existed for, and the Select alone now
    // carries it: this asserts that.
    it('shows a header sitting in extras as kept, not as untouched', () => {
      render(<Controlled headers={['Zone']} suggestions={[zambia[1]]}
        initial={{ columns: {}, constants: {}, extras: ['Zone'] }} />);
      expect(screen.getByLabelText('Zone')).toHaveTextContent('Keep as extra data');
      // ...and it is NOT still claiming the contract field it spells, which is what `extras` released.
      expect(screen.getByLabelText('Zone')).not.toHaveTextContent('zone');
      expect(screen.queryByText(/both claim zone/i)).not.toBeInTheDocument();
    });
  });

  describe('⛔ fixed values — the box must survive being typed in', () => {
    it('keeps the box on screen after a value is typed', () => {
      // A non-empty constant claims its field, and the section used to render only UNCLAIMED
      // fields — so the first keystroke unmounted the very input being typed into, and the value
      // it had just stored was displayed nowhere at all.
      render(<Controlled headers={[]} suggestions={[]} initial={emptyMap} />);
      fireEvent.change(screen.getByLabelText('country'), { target: { value: 'Z' } });
      expect(screen.getByLabelText('country')).toHaveValue('Z');
    });

    it('lets a typed value be cleared again', () => {
      render(<Controlled headers={[]} suggestions={[]}
        initial={{ columns: {}, constants: { country: 'ZMB' }, extras: [] }} />);
      expect(screen.getByLabelText('country')).toHaveValue('ZMB');
      fireEvent.change(screen.getByLabelText('country'), { target: { value: '' } });
      expect(screen.getByLabelText('country')).toHaveValue('');
    });
  });

  describe('Task 5: the column-map dropdown separates its passthrough option', () => {
    it('separates Keep as extra data from the contract fields', async () => {
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'],
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByLabelText('Type'));

      await screen.findByRole('option', { name: 'Keep as extra data' });
      const listbox = screen.getByRole('listbox');
      expect(within(listbox).getAllByRole('separator')).toHaveLength(1);
    });
  });

  describe('⛔ Task 5: the per-field check (checks one column, never the whole register)', () => {
    // Call history is NOT cleared between tests anywhere else in this file (no global
    // `clearMocks`/`resetMocks`), and the "was X called" assertions in this group depend on a
    // clean slate. Without this, an earlier test's own click leaks into a later test's "not
    // called" assertion.
    beforeEach(() => {
      mockedApi(api.readFacilityImportColumnValues).mockClear();
      mockedApi(api.suggestValueMappings).mockClear();
      mockedApi(api.uploadFacilityImport).mockClear();
      mockedApi(api.revalidateFacilityImportRun).mockClear();
    });

    it('checks one field on its own, and does not validate the whole register to do it', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Health Post', '1st Level Hospital'], distinct: 2, truncated: false,
      });
      // A conditional implementation, not `mockResolvedValueOnce`: the two unclaimed constant
      // fields (`status`, `country`) each fetch their own value set through this same mock on
      // mount, and a queued "once" answer would go to whichever of those wins the race instead
      // of to the click below.
      mockedApi(api.suggestValueMappings).mockImplementation(async (field: string, values: string[]) => {
        if (field === 'level' && values.includes('Health Post')) {
          return {
            values: [
              { value: 'Health Post', candidates: [{ target: 'health-post', display: null, score: 1, confidence: 'exact' }] },
              { value: '1st Level Hospital', candidates: [] },
            ],
            options: [],
            notValidated: false,
          };
        }
        return { values: [], options: [], notValidated: false };
      });

      render(<Controlled runId="run-1" headers={['Type']} suggestions={[]}
        initial={{ columns: { Type: 'level' }, constants: {}, extras: [] }} />);

      // `/^Type:/` picks the status button on purpose: the row's own ⋯ menu trigger is named
      // "Actions for Type", which also contains the word "Type" and would make a bare /Type/
      // match two buttons.
      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

      // The row reports what the check found, in the row.
      expect(await screen.findByText(/1 value\(s\) are not recognised/i)).toBeInTheDocument();
      // AND THE REGISTER WAS NOT RE-VALIDATED. That is the whole point of the route this uses.
      expect(api.uploadFacilityImport).not.toHaveBeenCalled();
      expect(api.revalidateFacilityImportRun).not.toHaveBeenCalled();
    });

    it('says so when a column has more distinct values than a person should be asked to map', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Name', values: ['a', 'b'], distinct: 3788, truncated: true,
      });
      render(<Controlled runId="run-1" headers={['Name']} suggestions={[]}
        initial={{ columns: { Name: 'level' }, constants: {}, extras: [] }} />);

      fireEvent.click(screen.getByRole('button', { name: /^Name:/ }));

      expect(await screen.findByText(/3,?788 distinct/i)).toBeInTheDocument();
      // A truncated column is never sent to the ranker: its values were never even collected.
      expect(api.suggestValueMappings).not.toHaveBeenCalledWith('level', expect.anything());
    });

    it('cannot check anything before a file is uploaded, and says so without touching the API', () => {
      render(<Controlled runId={null} headers={['Type']} suggestions={[]}
        initial={{ columns: { Type: 'level' }, constants: {}, extras: [] }} />);

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

      expect(screen.getByText(/upload the file first/i)).toBeInTheDocument();
      expect(api.readFacilityImportColumnValues).not.toHaveBeenCalled();
    });

    it('a target with no vocabulary goes green on a check, honestly', async () => {
      // `address` is not one of the three controlled fields, so there is no vocabulary to check
      // it against. Judged case: the check still runs (it reads the column) but records zero
      // unrecognised values, and the row goes green rather than staying stuck unchecked.
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Address', values: ['1 Main St', '2 Main St'], distinct: 2, truncated: false,
      });
      render(<Controlled runId="run-1" headers={['Address']} suggestions={[]}
        initial={{ columns: { Address: 'address' }, constants: {}, extras: [] }} />);

      fireEvent.click(screen.getByRole('button', { name: /^Address:/ }));

      expect(await screen.findByRole('button', { name: /^Address: checked, nothing wrong/i })).toBeInTheDocument();
      expect(api.suggestValueMappings).not.toHaveBeenCalledWith('address', expect.anything());
    });

    // ⛔ FIX PASS (review Finding 1, CRITICAL): the `truncated` branch used to fire before the
    // controlled-field check, so a free-text field (`name`, `national_code`, `address`, `phone`)
    // with thousands of distinct values, the CORRECT case for those fields, was reported as
    // probably mapped to the wrong field. `name` is one of the two required fields of every
    // import, so this broke the ordinary case, not an edge one.
    it('a truncated result on a non-controlled target is not a wrong-field finding', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Name', values: ['a', 'b'], distinct: 3788, truncated: true,
      });
      render(<Controlled runId="run-1" headers={['Name']} suggestions={[]}
        initial={{ columns: { Name: 'name' }, constants: {}, extras: [] }} />);

      fireEvent.click(screen.getByRole('button', { name: /^Name:/ }));

      // `name` has no bound vocabulary, so a truncated read is the expected shape of that column,
      // not a finding. The row goes green, the same as an untruncated non-controlled check.
      expect(await screen.findByRole('button', { name: /^Name: checked, nothing wrong/i })).toBeInTheDocument();
      expect(screen.queryByText(/distinct/i)).not.toBeInTheDocument();
      // A truncated column is never sent to the ranker (its values were never even collected),
      // and a non-controlled target has no ranker call to make either way.
      expect(api.suggestValueMappings).not.toHaveBeenCalledWith('name', expect.anything());
    });

    // ⛔ FIX PASS (review Finding 2): wiring test, not a repeat of `mappingRowState.test.ts`'s pure
    // function coverage. That file already proves the arithmetic; this proves `ColumnMapStep`
    // actually feeds it a stale flag when the operator re-targets a checked row.
    it('a checked row goes stale when the operator re-targets it', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Health Post'], distinct: 1, truncated: false,
      });
      // A conditional implementation, not `mockResolvedValueOnce`: the unclaimed constant fields
      // each fetch their own value set through this same mock on mount and after the re-target.
      mockedApi(api.suggestValueMappings).mockImplementation(async (field: string, values: string[]) => {
        if (field === 'level' && values.includes('Health Post')) {
          return {
            values: [{ value: 'Health Post', candidates: [{ target: 'health-post', display: null, score: 1, confidence: 'exact' }] }],
            options: [],
            notValidated: false,
          };
        }
        return { values: [], options: [], notValidated: false };
      });

      render(<Controlled runId="run-1" headers={['Type']} suggestions={[]}
        initial={{ columns: { Type: 'level' }, constants: {}, extras: [] }} />);

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      expect(await screen.findByRole('button', { name: /^Type: checked, nothing wrong/i })).toBeInTheDocument();

      // Re-target the row to a different field. The check just recorded describes `level`, not
      // `status`, so it must stop speaking for this row.
      fireEvent.click(screen.getByLabelText('Type'));
      fireEvent.click(await screen.findByRole('option', { name: 'status' }));

      expect(screen.getByRole('button', { name: /^Type: changed since the last check/i })).toBeInTheDocument();
    });

    // ⛔ REVERSAL, 2026-09-09. This used to assert the opposite: an exact, collision-free
    // suggestion read green with no click. The ranker scores the COLUMN NAME, and on the real
    // Zambia export the two headers it scored 1.0 hardest ("Type", "Operational status") are the
    // only two whose VALUES needed checking, so the green tick landed exactly where it was least
    // earned and told the operator not to click the control that would have found the problem.
    // A row is green only once a check has actually read the column. See `mappingRowState.ts`.
    it('an exact suggestion is still unchecked, because it scored the name and not the values', () => {
      render(<Controlled runId="run-1" headers={['MFL Code']} suggestions={[suggestions[0]]} initial={emptyMap} />);

      expect(screen.getByRole('button', { name: /^MFL Code: not checked yet/i })).toBeInTheDocument();
      // Still no automatic read: the row waits for the operator, it does not check itself.
      expect(api.readFacilityImportColumnValues).not.toHaveBeenCalled();
    });
  });

  describe('⛔ Task 6: the worklist moves into the row, not a separate box at the bottom', () => {
    beforeEach(() => {
      mockedApi(api.readFacilityImportColumnValues).mockClear();
      mockedApi(api.suggestValueMappings).mockClear();
      // ⛔ Now that a CHECK writes, this one leaks between tests too: an earlier test's own write
      // made "was it called" assertions here pass or fail on the wrong test's history.
      mockedApi(api.writeFacilityValueMappings).mockClear();
    });

    // ⛔ Deviation from the brief's literal snippet: `/Type/` alone matches TWO buttons on this row:
    // the status icon AND the row's own "Actions for Type" ⋯ menu trigger both contain the word
    // "Type". That is the exact ambiguity this file's own Task 5 tests already worked around with
    // `/^Type:/`. This test does the same.
    it('puts a controlled field\'s unrecognised values under the row that maps it', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['1st Level Hospital', 'Others'], distinct: 2, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [
          { value: '1st Level Hospital', candidates: [] },
          { value: 'Others', candidates: [] },
        ],
        options: [{ code: 'health-post', display: 'Health Post' }],
        notValidated: false,
      });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'],
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

      const row = (await screen.findByText('1st Level Hospital')).closest('[data-mapping-row="Type"]');
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByLabelText('1st Level Hospital')).toBeInTheDocument();
    });

    // ⛔ THE REPORTED BUG, AND ITS SECOND ROUND. A separate Save button was the wrong answer to it:
    // the operator's own words were "after mapping I am going to press the info button again, why
    // not make that a save, cause I am trying to get it to be green". The status icon is already
    // the control they press to get a row green, so it is the control that writes. There is no
    // Save button anywhere on the step now.
    it('writes the picks on a row when its status icon is clicked, then re-reads the column', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['1st Level Hospital'], distinct: 1, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [{ value: '1st Level Hospital', candidates: [] }],
        options: [{ code: 'health-post', display: 'Health Post' }],
        notValidated: false,
      });
      mockedApi(api.writeFacilityValueMappings).mockResolvedValue({ written: 1, superseded: [] });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      fireEvent.click(await screen.findByLabelText('1st Level Hospital'));
      fireEvent.click(await screen.findByRole('option', { name: 'Health Post' }));
      expect(api.writeFacilityValueMappings).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

      await waitFor(() => expect(api.writeFacilityValueMappings).toHaveBeenCalledWith(
        'urn:zm:mfl', [{ field: 'level', rawValue: '1st Level Hospital', toCode: 'health-post' }],
      ));
      // And the row goes green, which is the whole reason the operator pressed it.
      expect(await screen.findByRole('button', { name: /^Type: checked, nothing wrong/i })).toBeInTheDocument();
    });

    it('has no Save button anywhere', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['1st Level Hospital'], distinct: 1, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [{ value: '1st Level Hospital', candidates: [] }],
        options: [{ code: 'health-post', display: 'Health Post' }],
        notValidated: false,
      });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'],
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await screen.findByText('1st Level Hospital');

      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    });

    // A check with nothing chosen must not call the write route at all. Otherwise every click on
    // an untouched row posts an empty write and toasts "0 mapping(s) written".
    it('writes nothing when the row has no picks', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['1st Level Hospital'], distinct: 1, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [{ value: '1st Level Hospital', candidates: [] }],
        options: [{ code: 'health-post', display: 'Health Post' }],
        notValidated: false,
      });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await screen.findByText('1st Level Hospital');
      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

      await waitFor(() => expect(api.readFacilityImportColumnValues).toHaveBeenCalledTimes(2));
      expect(api.writeFacilityValueMappings).not.toHaveBeenCalled();
    });

    // The other half of the same report. With all four pick-lists filled, the row still read a flat
    // "4 value(s) are not recognised", which looks like a contradiction and says nothing about what
    // would close it. It now names the pending picks, so the Save beside it has a reason.
    it('says how many picks are waiting to be saved', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Zonal Hospital'], distinct: 1, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [{ value: 'Zonal Hospital', candidates: [] }],
        options: [{ code: 'hospital', display: 'Hospital' }],
        notValidated: false,
      });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await screen.findByLabelText('Zonal Hospital');
      // Nothing chosen yet: the line says only what the check found.
      expect(screen.queryByText(/not saved/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Zonal Hospital'));
      fireEvent.click(await screen.findByRole('option', { name: 'Hospital' }));

      expect(await screen.findByText(/1 chosen, not saved/i)).toBeInTheDocument();
    });

    // A row with no worklist has nothing to save, so it carries no Save at all.
    it('offers no Save on a row whose check found nothing to map', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Address', values: ['1 Main St'], distinct: 1, truncated: false,
      });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Address'],
        value: { columns: { Address: 'address' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Address:/ }));
      await screen.findByRole('button', { name: /^Address: checked, nothing wrong/i });

      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    });

    it('shows the OTHER unrecognised value in the same row too', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['1st Level Hospital', 'Others'], distinct: 2, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [
          { value: '1st Level Hospital', candidates: [] },
          { value: 'Others', candidates: [] },
        ],
        options: [{ code: 'health-post', display: 'Health Post' }],
        notValidated: false,
      });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'],
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

      const row = (await screen.findByText('1st Level Hospital')).closest('[data-mapping-row="Type"]') as HTMLElement;
      expect(within(row).getByLabelText('Others')).toBeInTheDocument();
      expect(within(row).getByLabelText('1st Level Hospital')).toHaveTextContent('Not mapped');
    });

    // Final review, M1: the test above used to claim this ordering in its name and never open a
    // Select. Opening one is the only thing that proves this step feeds `ValueMapRow` the right
    // `options`, which it reads off `check.options`.
    it('puts the ranked candidates in score order at the top and sorts the tail after them', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Zonal Hospital'], distinct: 1, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockImplementation(async (field: string, values: string[]) => {
        if (field !== 'level' || !values.includes('Zonal Hospital')) {
          return { values: [], options: [], notValidated: false };
        }
        return {
          values: [{
            value: 'Zonal Hospital',
            // Both `weak`, deliberately. A confident top candidate means the value is NOT
            // unrecognised, so `checkRow` would leave it off the worklist and there would be no
            // pick-list to open. Weak candidates are still ranked, which is what this asserts.
            candidates: [
              { target: 'zonal-hospital', display: 'Zonal Hospital', score: 0.6, confidence: 'weak' as const },
              { target: 'hospital', display: 'Hospital', score: 0.5, confidence: 'weak' as const },
            ],
          }],
          // Deliberately NOT alphabetical, and deliberately in the order a value set expansion
          // returns them: seed order. The tail is what gets sorted; the ranked head is not.
          options: [
            { code: 'zonal-hospital', display: 'Zonal Hospital' },
            { code: 'hospital', display: 'Hospital' },
            { code: 'health-post', display: 'Health Post' },
            { code: 'clinic', display: 'Clinic' },
          ],
          notValidated: false,
        };
      });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'],
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      fireEvent.click(await screen.findByLabelText('Zonal Hospital'));

      const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
      // `Not mapped` and `Ignore this value` first (this row maps `level`), then the two ranked
      // candidates in SCORE order, then the rest of the value set alphabetically. Clinic sorts
      // before Health Post; seed order had it last.
      expect(options).toEqual([
        'Not mapped', 'Ignore this value', 'Zonal Hospital', 'Hospital', 'Clinic', 'Health Post',
      ]);
    });

    it('does not show a picklist for a row nothing has found unrecognised values for', () => {
      renderColumnMapStep({
        runId: 'run-1', headers: ['MFL Code'],
        suggestions: [suggestions[0]],
        value: emptyMap,
      });

      expect(screen.queryByText('1st Level Hospital')).not.toBeInTheDocument();
    });

    it('offers Ignore this value on a level row', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Others'], distinct: 1, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [{ value: 'Others', candidates: [] }],
        options: [{ code: 'health-post', display: 'Health Post' }],
        notValidated: false,
      });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      fireEvent.click(await screen.findByLabelText('Others'));

      expect(await screen.findByRole('option', { name: 'Ignore this value' })).toBeInTheDocument();
    });

    // Spec decision 6. Withheld deliberately, keyed on the row's target.
    it('does not offer Ignore on a status row', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Operational status', values: ['Functional'], distinct: 1, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [{ value: 'Functional', candidates: [] }],
        options: [{ code: 'active', display: 'Active' }],
        notValidated: false,
      });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Operational status'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { 'Operational status': 'status' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Operational status:/ }));
      fireEvent.click(await screen.findByLabelText('Functional'));

      expect(await screen.findByRole('option', { name: 'Not mapped' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Ignore this value' })).not.toBeInTheDocument();
    });

    it('sends ignore: true, and no toCode, when the operator picks Ignore', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Others'], distinct: 1, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [{ value: 'Others', candidates: [] }],
        options: [{ code: 'health-post', display: 'Health Post' }],
        notValidated: false,
      });
      mockedApi(api.writeFacilityValueMappings).mockResolvedValue({ written: 1, superseded: [] });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      fireEvent.click(await screen.findByLabelText('Others'));
      fireEvent.click(await screen.findByRole('option', { name: 'Ignore this value' }));
      mockedApi(api.writeFacilityValueMappings).mockClear();

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

      await waitFor(() => expect(api.writeFacilityValueMappings).toHaveBeenCalledWith(
        'urn:zm:mfl', [{ field: 'level', rawValue: 'Others', ignore: true }],
      ));
    });

    // The reason the operator wanted this at all.
    it('turns the row green once its only value is ignored', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Others'], distinct: 1, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [{ value: 'Others', candidates: [] }],
        options: [{ code: 'health-post', display: 'Health Post' }],
        notValidated: false,
      });
      mockedApi(api.writeFacilityValueMappings).mockResolvedValue({ written: 1, superseded: [] });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      fireEvent.click(await screen.findByLabelText('Others'));
      fireEvent.click(await screen.findByRole('option', { name: 'Ignore this value' }));
      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

      expect(await screen.findByRole('button', { name: /^Type: checked, nothing wrong/i })).toBeInTheDocument();
    });

    it('separates the outcomes that are not a code from the codes themselves', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Others'], distinct: 1, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockResolvedValue({
        values: [{ value: 'Others', candidates: [] }],
        options: [{ code: 'health-post', display: 'Health Post' }],
        notValidated: false,
      });
      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      fireEvent.click(await screen.findByLabelText('Others'));

      await screen.findByRole('option', { name: 'Not mapped' });
      const listbox = screen.getByRole('listbox');
      const separators = within(listbox).getAllByRole('separator');
      expect(separators).toHaveLength(1);
    });
  });

  // ⛔ Fix pass (Critical finding): `unmappedByField` (the server's own report) and `checkRow` (the
  // client ranker's guess) used to answer two DIFFERENT questions about the same worklist, and
  // `checkRow` silently overwrote the server's answer with its own. These three tests are the
  // reviewer's own reproduction cases.
  describe('⛔ fix pass: the worklist is a union, never a replacement (Critical finding)', () => {
    beforeEach(() => {
      mockedApi(api.readFacilityImportColumnValues).mockClear();
      mockedApi(api.suggestValueMappings).mockClear();
      mockedApi(api.writeFacilityValueMappings).mockClear();
    });

    it('a value the server reported unmapped survives a click-check the ranker is confident about', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Zonal Hospital', 'Others'], distinct: 2, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockImplementation(async (field: string, values: string[]) => {
        if (field !== 'level') return { values: [], options: [], notValidated: false };
        return {
          values: values.map((v) => ({
            value: v,
            // The ranker is CONFIDENT about "Others", and that must not decide whether it needs
            // mapping. Only the server's own report decides that.
            candidates: v === 'Others'
              ? [{ target: 'other', display: 'Other', score: 1, confidence: 'exact' as const }]
              : [],
          })),
          options: [{ code: 'other', display: 'Other' }],
          notValidated: false,
        };
      });

      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'],
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
        unmappedByField: { level: ['Zonal Hospital', 'Others'], status: [], country: [] },
      });

      // The server's own report puts both rows on screen before anything is clicked.
      await screen.findByLabelText('Zonal Hospital');
      expect(screen.getByLabelText('Others')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

      // The click-check finishes...
      await screen.findByText(/2 value\(s\) are not recognised/i);
      // ...and BOTH values are still there. "Others" did not vanish just because the ranker
      // suddenly had an opinion about it.
      expect(screen.getByLabelText('Zonal Hospital')).toBeInTheDocument();
      expect(screen.getByLabelText('Others')).toBeInTheDocument();
    });

    it('a mapping the operator already chose survives a re-check and still reaches Save', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Zonal Hospital'], distinct: 1, truncated: false,
      });
      let levelCalls = 0;
      mockedApi(api.suggestValueMappings).mockImplementation(async (field: string, values: string[]) => {
        if (field !== 'level') return { values: [], options: [], notValidated: false };
        levelCalls += 1;
        // The FIRST check has no opinion, so "Zonal Hospital" surfaces as unrecognised and the
        // operator picks a mapping by hand. The SECOND check (the re-check below) turns confident
        // about a DIFFERENT code, which must not evict the row or reset the operator's own pick.
        const confident = levelCalls > 1;
        return {
          values: values.map((v) => ({
            value: v,
            candidates: confident
              ? [{ target: 'hospital', display: 'Hospital', score: 1, confidence: 'exact' as const }]
              : [],
          })),
          options: [
            { code: 'hospital', display: 'Hospital' },
            { code: 'health-post', display: 'Health Post' },
          ],
          notValidated: false,
        };
      });

      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await screen.findByLabelText('Zonal Hospital');

      // Operator picks a mapping by hand, different from whatever the ranker later guesses.
      fireEvent.click(screen.getByLabelText('Zonal Hospital'));
      fireEvent.click(await screen.findByRole('option', { name: 'Health Post' }));
      expect(screen.getByLabelText('Zonal Hospital')).toHaveTextContent('Health Post');

      // Re-check the row.
      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await waitFor(() => expect(levelCalls).toBe(2));

      // The operator's own choice is still what is shown, not evicted and not reset to the
      // ranker's fresh (and different) guess.
      expect(screen.getByLabelText('Zonal Hospital')).toHaveTextContent('Health Post');

      // The check itself is the write, so the choice that survived the re-check above is what the
      // NEXT check sends. (The re-check above wrote it too; this asserts the payload.)
      await waitFor(() => expect(api.writeFacilityValueMappings).toHaveBeenCalledWith(
        'urn:zm:mfl', [{ field: 'level', rawValue: 'Zonal Hospital', toCode: 'health-post' }],
      ));
    });

    // ⛔ REVERSAL. This used to assert one Save aggregating BOTH headers' picks into a single call.
    // That Save lived after every mapping row, a screen away from the values it wrote, and the
    // operator never found it. Each worklist now carries its own Save, and each writes only its own
    // header's values: a Save that also commits picks on a row the operator has scrolled past and
    // never looked at is writing decisions nobody made.
    it('each row saves only its own values, never a neighbouring row', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockImplementation(
        async (_runId: string, header: string) => {
          if (header === 'Type') return { header, values: ['Zonal Hospital'], distinct: 1, truncated: false };
          if (header === 'Condition') return { header, values: ['Functional'], distinct: 1, truncated: false };
          return { header, values: [], distinct: 0, truncated: false };
        },
      );
      mockedApi(api.suggestValueMappings).mockImplementation(async (field: string) => {
        if (field === 'level') {
          return {
            values: [{ value: 'Zonal Hospital', candidates: [] }],
            options: [{ code: 'hospital', display: 'Hospital' }],
            notValidated: false,
          };
        }
        if (field === 'status') {
          return {
            values: [{ value: 'Functional', candidates: [] }],
            options: [{ code: 'active', display: 'Active' }],
            notValidated: false,
          };
        }
        return { values: [], options: [], notValidated: false };
      });

      renderColumnMapStep({
        runId: 'run-1', headers: ['Type', 'Condition'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level', Condition: 'status' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await screen.findByLabelText('Zonal Hospital');
      fireEvent.click(screen.getByLabelText('Zonal Hospital'));
      fireEvent.click(await screen.findByRole('option', { name: 'Hospital' }));

      fireEvent.click(screen.getByRole('button', { name: /^Condition:/ }));
      await screen.findByLabelText('Functional');
      fireEvent.click(screen.getByLabelText('Functional'));
      fireEvent.click(await screen.findByRole('option', { name: 'Active' }));

      mockedApi(api.writeFacilityValueMappings).mockClear();
      mockedApi(api.writeFacilityValueMappings).mockResolvedValue({ written: 1, superseded: [] });

      // Re-check the Type row. It writes `level` and says nothing about `status`, even though the
      // Condition row has a pick sitting on screen at the same moment.
      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await waitFor(() => expect(api.writeFacilityValueMappings).toHaveBeenCalledTimes(1));
      expect(api.writeFacilityValueMappings).toHaveBeenNthCalledWith(
        1, 'urn:zm:mfl', [{ field: 'level', rawValue: 'Zonal Hospital', toCode: 'hospital' }],
      );

      // Re-check the Condition row. Separately, and only `status`.
      fireEvent.click(screen.getByRole('button', { name: /^Condition:/ }));
      await waitFor(() => expect(api.writeFacilityValueMappings).toHaveBeenCalledTimes(2));
      expect(api.writeFacilityValueMappings).toHaveBeenNthCalledWith(
        2, 'urn:zm:mfl', [{ field: 'status', rawValue: 'Functional', toCode: 'active' }],
      );
    });
  });

  // Final review, C1 (CRITICAL): a checked row could never go back to green. The row's count came
  // straight off the length of its worklist, and the worklist is a UNION that nothing ever removes
  // from, so one unrecognised value made the row red for the life of the sheet. Two different things
  // were sharing one number. Worklist membership stays sticky, so a choice the operator has already
  // made is never dropped; the count now reads only the values still unresolved.
  describe('a checked row can go back to green once its values are mapped', () => {
    beforeEach(() => {
      mockedApi(api.readFacilityImportColumnValues).mockClear();
      mockedApi(api.suggestValueMappings).mockClear();
      mockedApi(api.writeFacilityValueMappings).mockClear();
    });

    it('goes green after the operator maps the value, saves, and checks again', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Zonal Hospital'], distinct: 1, truncated: false,
      });
      // The ranker never gets confident about this value, on either check. That is the point: the
      // written mapping is what resolves it, not a better guess.
      mockedApi(api.suggestValueMappings).mockImplementation(async (field: string, values: string[]) => {
        if (field !== 'level') return { values: [], options: [], notValidated: false };
        return {
          values: values.map((v) => ({ value: v, candidates: [] })),
          options: [{ code: 'hospital', display: 'Hospital' }],
          notValidated: false,
        };
      });

      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await screen.findByLabelText('Zonal Hospital');
      expect(screen.getByRole('button', { name: /^Type: 1 value\(s\) are not recognised/i })).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Zonal Hospital'));
      fireEvent.click(await screen.findByRole('option', { name: 'Hospital' }));

      mockedApi(api.writeFacilityValueMappings).mockResolvedValue({ written: 1, superseded: [] });
      // One click, not two: the status icon writes the pick and then re-reads the column.
      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await waitFor(() => expect(api.writeFacilityValueMappings).toHaveBeenCalledTimes(1));

      expect(await screen.findByRole('button', { name: /^Type: checked, nothing wrong/i })).toBeInTheDocument();
      // Sticky membership: the row the operator worked through is still on screen with their pick
      // in it, so a mapping can still be corrected. It just no longer counts against the row.
      expect(screen.getByLabelText('Zonal Hospital')).toHaveTextContent('Hospital');
    });

    it('a value left unmapped still counts, so mapping one of two does not turn a row green', async () => {
      mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
        header: 'Type', values: ['Zonal Hospital', 'Others'], distinct: 2, truncated: false,
      });
      mockedApi(api.suggestValueMappings).mockImplementation(async (field: string, values: string[]) => {
        if (field !== 'level') return { values: [], options: [], notValidated: false };
        return {
          values: values.map((v) => ({ value: v, candidates: [] })),
          options: [{ code: 'hospital', display: 'Hospital' }],
          notValidated: false,
        };
      });

      renderColumnMapStep({
        runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
        value: { columns: { Type: 'level' }, constants: {}, extras: [] },
      });

      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await screen.findByLabelText('Zonal Hospital');

      // Only one of the two gets a mapping. The other is left as it came.
      fireEvent.click(screen.getByLabelText('Zonal Hospital'));
      fireEvent.click(await screen.findByRole('option', { name: 'Hospital' }));

      mockedApi(api.writeFacilityValueMappings).mockResolvedValue({ written: 1, superseded: [] });
      fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
      await waitFor(() => expect(api.writeFacilityValueMappings).toHaveBeenCalledTimes(1));

      expect(await screen.findByRole('button', { name: /^Type: 1 value\(s\) are not recognised/i })).toBeInTheDocument();
    });
  });
});
