import { describe, it, expect } from 'vitest';
import { stripWidth, cellGridWidth, groupBreaks, CELL_SIZE, CELL_GAP, GROUP_GAP } from './cellgrid';

describe('stripWidth', () => {
  it('is cells plus small gaps when there are no group breaks', () => {
    expect(stripWidth(5, [])).toBeCloseTo(5 * CELL_SIZE + 4 * CELL_GAP, 5);
  });

  it('charges a wide gap at each break and a small one elsewhere', () => {
    // 23 cells across 5 groups => 4 breaks, 18 small gaps
    expect(stripWidth(23, [5, 10, 15, 20]))
      .toBeCloseTo(23 * CELL_SIZE + 18 * CELL_GAP + 4 * GROUP_GAP, 5);
  });

  it('is one cell wide with no gaps at all for a single cell', () => {
    expect(stripWidth(1, [])).toBeCloseTo(CELL_SIZE, 5);
  });

  it('is zero for no cells', () => {
    expect(stripWidth(0, [])).toBe(0);
  });
});

describe('cellGridWidth', () => {
  it('matches the spec arithmetic for the worst-case month', () => {
    const w = cellGridWidth({
      labelWidth: 105,
      cellCount: 23,
      breaks: [5, 10, 15, 20],
      trailingWidths: [34.5, 52],
    });
    // 105 + 9 + 298.5 + 9 + 34.5 + 9 + 52. One gap constant, charged before every
    // trailing column. See spec section 5 for why it is not two.
    expect(w).toBeCloseTo(517, 1);
  });

  it('drops the label gap when there is no label column', () => {
    const withLabel = cellGridWidth({ labelWidth: 105, cellCount: 7, breaks: [], trailingWidths: [] });
    const without = cellGridWidth({ labelWidth: 0, cellCount: 7, breaks: [], trailingWidths: [] });
    expect(withLabel - without).toBeCloseTo(105 + 9, 5);
  });
});

describe('groupBreaks', () => {
  it('breaks wherever the token changes', () => {
    expect(groupBreaks(['1', '1', '1', '2', '2', '3'])).toEqual([3, 5]);
  });

  it('never reports a break at index 0', () => {
    expect(groupBreaks(['9', '9'])).toEqual([]);
  });

  it('breaks on every cell when every token differs', () => {
    expect(groupBreaks(['a', 'b', 'c'])).toEqual([1, 2]);
  });

  it('is empty for an absent group row', () => {
    expect(groupBreaks(undefined)).toEqual([]);
  });

  it('handles a short first group, which is what a month starting mid-week gives', () => {
    // Wed Thu Fri | Mon..Fri
    expect(groupBreaks(['1', '1', '1', '2', '2', '2', '2', '2'])).toEqual([3]);
  });
});
