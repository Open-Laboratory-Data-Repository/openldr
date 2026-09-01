import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayersTab } from './LayersTab';
import type { DesignElement, ReportTemplate } from './types';

const el = (id: string, extra: Partial<DesignElement> = {}): DesignElement =>
  ({ id, kind: 'text', name: id.toUpperCase(), rect: { x: 0, y: 0, w: 10, h: 10 }, ...extra });

// Array order a, b, c — the layers list displays topmost (last-painted) first: C, B, A.
const tpl = (extra: Partial<DesignElement> = {}): ReportTemplate => ({
  id: 't', name: 't', paper: 'A4', orientation: 'portrait', status: 'draft', parameters: [],
  pages: [{ id: 'p1', elements: [el('a', extra), el('b'), el('c')] }],
});

function setup(template = tpl()) {
  const props = { template, selectedIds: [] as string[], onSelect: vi.fn(), onPatchElement: vi.fn(), onReorder: vi.fn() };
  render(<LayersTab {...props} />);
  return props;
}

describe('LayersTab visibility, locking and order', () => {
  it('hides and shows an element from the eye toggle (discrete)', () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText('Hide A'));
    expect(props.onPatchElement).toHaveBeenCalledWith('a', { hidden: true }, { discrete: true });
    const shown = setup(tpl({ hidden: true }));
    fireEvent.click(screen.getAllByLabelText('Show A')[0]);
    expect(shown.onPatchElement).toHaveBeenCalledWith('a', { hidden: undefined }, { discrete: true });
  });

  it('locks and unlocks from the lock toggle (discrete)', () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText('Lock A'));
    expect(props.onPatchElement).toHaveBeenCalledWith('a', { locked: true }, { discrete: true });
    const unlocked = setup(tpl({ locked: true }));
    fireEvent.click(screen.getAllByLabelText('Unlock A')[0]);
    expect(unlocked.onPatchElement).toHaveBeenCalledWith('a', { locked: undefined }, { discrete: true });
  });

  it('moving a row up in the list raises it later in the array (toward the front)', () => {
    const props = setup();
    // A is bottom-most (last in the display). Up means array index 0 -> 1.
    fireEvent.click(screen.getByLabelText('Raise A'));
    expect(props.onReorder).toHaveBeenCalledWith('a', 1);
    // C is topmost; its Raise button is disabled.
    expect(screen.getByLabelText('Raise C')).toBeDisabled();
  });

  it('moving a row down lowers it earlier in the array', () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText('Lower C'));
    expect(props.onReorder).toHaveBeenCalledWith('c', 1);
    expect(screen.getByLabelText('Lower A')).toBeDisabled();
  });

  it('drag and drop reorders to the target row position', () => {
    const props = setup();
    const rowA = screen.getByTestId('layer-a');
    const rowC = screen.getByTestId('layer-c');
    fireEvent.dragStart(rowA);
    fireEvent.dragOver(rowC);
    fireEvent.drop(rowC);
    expect(props.onReorder).toHaveBeenCalledWith('a', 2);
  });

  it('still selects on row click', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(props.onSelect).toHaveBeenCalledWith(['a']);
  });
});

describe('LayersTab groups', () => {
  const el = (id: string, groupId?: string): DesignElement =>
    ({ id, kind: 'text', name: id.toUpperCase(), rect: { x: 0, y: 0, w: 10, h: 10 }, ...(groupId ? { groupId } : {}) });
  const tplG = (over: Partial<{ hidden: boolean; locked: boolean }> = {}): ReportTemplate => ({
    id: 't', name: 't', paper: 'A4', orientation: 'portrait', status: 'draft', parameters: [],
    pages: [{ id: 'p1', groups: [{ id: 'g1', name: 'Letterhead', ...over }], elements: [el('a', 'g1'), el('b', 'g1'), el('c')] }],
  });
  function setupG(template = tplG()) {
    const props = { template, selectedIds: [] as string[], onSelect: vi.fn(), onPatchElement: vi.fn(), onReorder: vi.fn(), onPatchGroup: vi.fn(), onUngroup: vi.fn() };
    render(<LayersTab {...props} />);
    return props;
  }

  it('shows one header row per group, above its topmost member', () => {
    setupG();
    expect(screen.getByTestId('layer-group-g1')).toHaveTextContent('Letterhead');
  });

  it('hides and locks the whole group from its header row', () => {
    const props = setupG();
    fireEvent.click(screen.getByLabelText('Hide Letterhead'));
    expect(props.onPatchGroup).toHaveBeenCalledWith('g1', { hidden: true });
    fireEvent.click(screen.getByLabelText('Lock Letterhead'));
    expect(props.onPatchGroup).toHaveBeenCalledWith('g1', { locked: true });
  });

  it('clears a flag rather than storing false', () => {
    const props = setupG(tplG({ hidden: true }));
    fireEvent.click(screen.getByLabelText('Show Letterhead'));
    expect(props.onPatchGroup).toHaveBeenCalledWith('g1', { hidden: undefined });
  });

  it('ungroups from the header row', () => {
    const props = setupG();
    fireEvent.click(screen.getByLabelText('Ungroup Letterhead'));
    expect(props.onUngroup).toHaveBeenCalledWith('g1');
  });
});
