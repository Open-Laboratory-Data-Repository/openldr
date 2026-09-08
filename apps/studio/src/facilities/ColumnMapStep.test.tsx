import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
    // tell "never called" apart from "not a mock" — this file never invokes either for real.
    readFacilityImportColumnValues: vi.fn(),
    uploadFacilityImport: vi.fn(),
    revalidateFacilityImportRun: vi.fn(),
  };
});

import * as api from '@/api';
import { ColumnMapStep } from './ColumnMapStep';
import type { ColumnSuggestion, FacilityColumnMap } from '@/api';

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

  describe('⛔ Task 5 — the per-field check (checks one column, never the whole register)', () => {
    // Call history is NOT cleared between tests anywhere else in this file (no global
    // `clearMocks`/`resetMocks`), and the "was X called" assertions in this group depend on a
    // clean slate — without this, an earlier test's own click leaks into a later test's "not
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
      // A truncated column is never sent to the ranker — its values were never even collected.
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
      // it against — judged case: the check still runs (it reads the column) but records zero
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
  });
});
