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

describe('ColumnMapStep', () => {
  it('pre-selects exact suggestions and leaves unmatched headers unset', () => {
    render(<ColumnMapStep headers={suggestions.map((s) => s.header)} suggestions={suggestions}
      value={emptyMap} onChange={() => {}} />);
    expect(screen.getByLabelText('MFL Code')).toHaveTextContent('national_code');
    expect(screen.getByLabelText('Catchment population cso')).toHaveTextContent('Not mapped');
  });

  it('⛔ refuses to continue while a required field is unmapped', () => {
    render(<ColumnMapStep headers={['Province']} suggestions={[suggestions[1]]}
      value={{ columns: { Province: 'zone' }, constants: {}, extras: [] }} onChange={() => {}} />);
    expect(screen.getByText(/name is not mapped/i)).toBeInTheDocument();
  });

  it('sends a header to extras in one action', () => {
    const onChange = vi.fn();
    render(<ColumnMapStep headers={['Catchment population cso']} suggestions={[suggestions[2]]}
      value={emptyMap} onChange={onChange} />);
    openRowMenu('Actions for Catchment population cso');
    fireEvent.click(screen.getByRole('menuitem', { name: /keep as extra/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ extras: ['Catchment population cso'] }));
  });

  it('Clear resets a mapped header back to Not mapped', () => {
    const onChange = vi.fn();
    render(<ColumnMapStep headers={['MFL Code']} suggestions={[suggestions[0]]}
      value={{ columns: { 'MFL Code': 'national_code' }, constants: {}, extras: [] }} onChange={onChange} />);
    openRowMenu('Actions for MFL Code');
    fireEvent.click(screen.getByRole('menuitem', { name: /^clear$/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ columns: {} }));
  });

  describe('collision handling — measured on the real Zambia MFL export (⛔ the finding this panel exists for)', () => {
    it('pre-selects NEITHER Province nor Zone when both suggest `zone` at exact confidence', () => {
      const colliding: ColumnSuggestion[] = [
        { header: 'Province', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Zone', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
      ];
      render(<ColumnMapStep headers={['Province', 'Zone']} suggestions={colliding}
        value={emptyMap} onChange={() => {}} />);
      expect(screen.getByLabelText('Province')).toHaveTextContent('Not mapped');
      expect(screen.getByLabelText('Zone')).toHaveTextContent('Not mapped');
    });

    it('pre-selects NEITHER Ownership nor Ownership type when both suggest `ownership`', () => {
      const colliding: ColumnSuggestion[] = [
        { header: 'Ownership', candidates: [{ target: 'ownership', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Ownership type', candidates: [{ target: 'ownership', display: null, score: 1, confidence: 'exact' }] },
      ];
      render(<ColumnMapStep headers={['Ownership', 'Ownership type']} suggestions={colliding}
        value={emptyMap} onChange={() => {}} />);
      expect(screen.getByLabelText('Ownership')).toHaveTextContent('Not mapped');
      expect(screen.getByLabelText('Ownership type')).toHaveTextContent('Not mapped');
    });

    it('still pre-selects a lone exact suggestion once only one header claims the target', () => {
      // Same shape as the two tests above, minus the second claimant — the collision rule must not
      // over-fire and block an ordinary, unambiguous exact match.
      render(<ColumnMapStep headers={['MFL Code']} suggestions={[suggestions[0]]}
        value={emptyMap} onChange={() => {}} />);
      expect(screen.getByLabelText('MFL Code')).toHaveTextContent('national_code');
    });
  });

  it('pre-selects a `likely` suggestion WITH a badge telling the operator to check it', () => {
    const likely: ColumnSuggestion[] = [
      { header: 'Facility Type', candidates: [{ target: 'level', display: null, score: 0.8, confidence: 'likely' }] },
    ];
    render(<ColumnMapStep headers={['Facility Type']} suggestions={likely} value={emptyMap} onChange={() => {}} />);
    expect(screen.getByLabelText('Facility Type')).toHaveTextContent('level');
    expect(screen.getByText(/check this/i)).toBeInTheDocument();
  });

  it('does not pre-select — or badge — a `weak` suggestion', () => {
    const weak: ColumnSuggestion[] = [
      { header: 'Mobility status', candidates: [{ target: 'status', display: null, score: 0.65, confidence: 'weak' }] },
    ];
    render(<ColumnMapStep headers={['Mobility status']} suggestions={weak} value={emptyMap} onChange={() => {}} />);
    expect(screen.getByLabelText('Mobility status')).toHaveTextContent('Not mapped');
    expect(screen.queryByText(/check this/i)).not.toBeInTheDocument();
  });

  it('writes a typed constant for a field no column maps, e.g. country', () => {
    const onChange = vi.fn();
    render(<ColumnMapStep headers={[]} suggestions={[]} value={emptyMap} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('country'), { target: { value: 'ZMB' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ constants: expect.objectContaining({ country: 'ZMB' }) }));
  });

  it('a satisfied-by-constant required field does not appear in the blocking summary', () => {
    render(<ColumnMapStep headers={[]} suggestions={[]}
      value={{ columns: {}, constants: { national_code: 'FIXED', name: 'FIXED' }, extras: [] }}
      onChange={() => {}} />);
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
