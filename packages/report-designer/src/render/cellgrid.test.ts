import { describe, it, expect } from 'vitest';
import {
  stripWidth, cellGridWidth, groupBreaks, rampSteps, stepFor, cellFill, EMPTY_FILL,
  splitCellGridRows, cellGridMaxRows, cellGridChunks,
  CELL_SIZE, CELL_GAP, GROUP_GAP,
} from './cellgrid';

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

describe('rampSteps', () => {
  it('gives the darkest step alone when the grid is binary', () => {
    expect(rampSteps('blue', 1)).toEqual(['#185FA5']);
  });

  it('gives five distinct steps at full depth', () => {
    const s = rampSteps('blue', 5);
    expect(s).toHaveLength(5);
    expect(new Set(s).size).toBe(5);
  });

  it('always ends on the darkest step', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(rampSteps('blue', n)[n - 1]).toBe('#185FA5');
    }
  });
});

describe('stepFor', () => {
  it('is empty for zero, whatever the depth', () => {
    expect(stepFor(0, 10, 5)).toBe(-1);
    expect(stepFor(0, 10, 1)).toBe(-1);
  });

  it('is empty for a negative or unparseable value', () => {
    expect(stepFor(-2, 10, 3)).toBe(-1);
    expect(stepFor(Number.NaN, 10, 3)).toBe(-1);
  });

  it('collapses every non-zero value onto one step when binary', () => {
    expect(stepFor(1, 24, 1)).toBe(0);
    expect(stepFor(24, 24, 1)).toBe(0);
  });

  it('puts the maximum on the darkest step', () => {
    expect(stepFor(24, 24, 5)).toBe(4);
  });

  it('never exceeds the declared depth', () => {
    expect(stepFor(9999, 24, 5)).toBe(4);
  });

  it('is empty when the maximum is zero, rather than dividing by it', () => {
    // ⚠ A POSITIVE value against a zero max. `stepFor(0, 0, 5)` reads like it covers this and
    // does not: the `value <= 0` guard returns first, so the max guard could be deleted whole
    // and this would stay green. Measured, by deleting it.
    expect(stepFor(5, 0, 5)).toBe(-1);
  });
});

describe('cellFill', () => {
  it('paints the empty tint for a zero value', () => {
    expect(cellFill(0, 24, { ramp: 'blue', steps: 5 })).toBe(EMPTY_FILL);
  });

  it('paints the darkest step for the maximum', () => {
    expect(cellFill(24, 24, { ramp: 'blue', steps: 5 })).toBe('#185FA5');
  });
});

describe('splitCellGridRows', () => {
  const rows = [
    ['', '02', '03'],
    ['', '1', '1'],
    ['Bahi', '0', '1'],
    ['Chunya', '1', '0'],
  ];

  it('lifts both synthetic rows when grouping is on', () => {
    const s = splitCellGridRows(rows, true);
    expect(s.header).toEqual(['', '02', '03']);
    expect(s.groups).toEqual(['', '1', '1']);
    expect(s.body).toHaveLength(2);
    expect(s.body[0][0]).toBe('Bahi');
  });

  it('lifts only the header when grouping is off', () => {
    const s = splitCellGridRows(rows, false);
    expect(s.groups).toBeUndefined();
    expect(s.body).toHaveLength(3);
  });

  it('survives a result with no rows at all', () => {
    const s = splitCellGridRows([], true);
    expect(s.header).toEqual([]);
    expect(s.groups).toBeUndefined();
    expect(s.body).toEqual([]);
  });

  it('survives a result carrying only the synthetic rows', () => {
    const s = splitCellGridRows([['', '02'], ['', '1']], true);
    expect(s.body).toEqual([]);
  });
});

describe('cellGridMaxRows', () => {
  it('subtracts the header band before dividing by the row pitch', () => {
    // (400 - 13) / 12.75 = 30.35 -> 30
    expect(cellGridMaxRows(400)).toBe(30);
  });

  it('is zero for a rect too short to hold its own header', () => {
    expect(cellGridMaxRows(8)).toBe(0);
  });
});

describe('cellGridChunks', () => {
  it('is one when everything fits', () => {
    expect(cellGridChunks(10, 400)).toBe(1);
  });

  it('is never zero, even with no rows, so an empty grid still draws its header once', () => {
    expect(cellGridChunks(0, 400)).toBe(1);
  });

  it('rounds up', () => {
    expect(cellGridChunks(31, 400)).toBe(2);
    expect(cellGridChunks(60, 400)).toBe(2);
    expect(cellGridChunks(61, 400)).toBe(3);
  });

  it('is one when the rect cannot hold a single row, rather than looping forever', () => {
    expect(cellGridChunks(50, 8)).toBe(1);
  });
});
