import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColumnMapStep } from './ColumnMapStep';
import type { ColumnSuggestion, FacilityColumnMap } from '@/api';

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
function Controlled({ initial, onChangeSpy, ...rest }: {
  initial: FacilityColumnMap;
  onChangeSpy?: (next: FacilityColumnMap) => void;
  headers: string[];
  suggestions: ColumnSuggestion[];
  rowCount?: number;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ColumnMapStep
      {...rest}
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
    />
  );
}

describe('ColumnMapStep', () => {
  it('pre-selects exact suggestions and leaves unmatched headers unset', () => {
    render(<Controlled headers={suggestions.map((s) => s.header)} suggestions={suggestions} initial={emptyMap} />);
    expect(screen.getByLabelText('MFL Code')).toHaveTextContent('national_code');
    expect(screen.getByLabelText('Catchment population cso')).toHaveTextContent('Not mapped');
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
      expect(screen.getByLabelText('MFL Code')).toHaveTextContent('Not mapped');
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
      expect(screen.getByLabelText('Province')).toHaveTextContent('Not mapped');
      expect(screen.getByLabelText('Zone')).toHaveTextContent('Not mapped');
    });

    it('pre-selects NEITHER Ownership nor Ownership type when both suggest `ownership`', () => {
      const colliding: ColumnSuggestion[] = [
        { header: 'Ownership', candidates: [{ target: 'ownership', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Ownership type', candidates: [{ target: 'ownership', display: null, score: 1, confidence: 'exact' }] },
      ];
      render(<Controlled headers={['Ownership', 'Ownership type']} suggestions={colliding} initial={emptyMap} />);
      expect(screen.getByLabelText('Ownership')).toHaveTextContent('Not mapped');
      expect(screen.getByLabelText('Ownership type')).toHaveTextContent('Not mapped');
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
    expect(screen.getByLabelText('Mobility status')).toHaveTextContent('Not mapped');
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
      onValidityChange={onValidityChange} />);
    expect(onValidityChange).toHaveBeenLastCalledWith(false);

    rerender(<ColumnMapStep headers={['Province']} suggestions={[suggestions[1]]}
      value={{ columns: { Province: 'zone' }, constants: { national_code: 'X', name: 'Y' }, extras: [] }}
      onChange={() => {}} onValidityChange={onValidityChange} />);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });
});
