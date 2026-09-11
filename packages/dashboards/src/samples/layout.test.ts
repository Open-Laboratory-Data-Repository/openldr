import { describe, it, expect } from 'vitest';
import { SAMPLE_DASHBOARD } from './index';

/**
 * The grid renders with `compactType="vertical"`, which can only pull a widget UP. It cannot
 * fix a row whose widgets are different heights, so a ragged row in this file becomes a
 * permanent hole in the dashboard that every `db reset` restores. The sample shipped that way:
 * `Result Finalisation %` was one row taller than its three KPI siblings, which blocked
 * `Orders Trend` from rising and left a gap under `Results Recorded`.
 *
 * These tests hold the two properties that make compaction a no-op.
 */

const GRID_COLUMNS = 12;

type Cell = { i: string; x: number; y: number; w: number; h: number };

function rows(): Map<number, Cell[]> {
  const byY = new Map<number, Cell[]>();
  for (const cell of SAMPLE_DASHBOARD.layout as Cell[]) {
    byY.set(cell.y, [...(byY.get(cell.y) ?? []), cell]);
  }
  return byY;
}

describe('the sample dashboard layout', () => {
  it('gives every widget a layout entry, and every entry a widget', () => {
    const widgetIds = SAMPLE_DASHBOARD.widgets.map((w) => w.id).sort();
    const layoutIds = (SAMPLE_DASHBOARD.layout as Cell[]).map((l) => l.i).sort();
    expect(layoutIds).toEqual(widgetIds);
  });

  it('fills each row to the full grid width, leaving no hole', () => {
    for (const [y, cells] of rows()) {
      const width = cells.reduce((sum, c) => sum + c.w, 0);
      expect(`y=${y} width=${width}`).toBe(`y=${y} width=${GRID_COLUMNS}`);
    }
  });

  it('gives every widget in a row the same height', () => {
    for (const [y, cells] of rows()) {
      const heights = [...new Set(cells.map((c) => c.h))];
      expect(`y=${y} heights=${heights.join(',')}`).toBe(`y=${y} heights=${heights[0]}`);
    }
  });

  it('starts each row exactly where the one above ends', () => {
    const starts = [...rows().keys()].sort((a, b) => a - b);
    let expected = 0;
    for (const y of starts) {
      expect(y).toBe(expected);
      expected = y + rows().get(y)![0].h;
    }
  });

  it('never overlaps two widgets in the same row', () => {
    for (const [y, cells] of rows()) {
      const spans = cells.slice().sort((a, b) => a.x - b.x);
      for (let n = 1; n < spans.length; n += 1) {
        expect(`y=${y} ${spans[n].i} starts at ${spans[n].x}`).toBe(
          `y=${y} ${spans[n].i} starts at ${spans[n - 1].x + spans[n - 1].w}`,
        );
      }
    }
  });
});
