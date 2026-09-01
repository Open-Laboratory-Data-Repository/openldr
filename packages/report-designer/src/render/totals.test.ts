import { describe, it, expect } from 'vitest';
import { bodyRowsFor, elementChunkCount, maxRowsFor, ROW_H, toPt, headerBandHeight } from './pagination';
import type { ResolvedTable } from './pagination';
import type { DesignElement } from '../schema';
import { findTransposedTotals } from '../header-row';

const boundTable = (extra: Partial<DesignElement> = {}): DesignElement => ({
  id: 't', kind: 'table', name: 't', rect: { x: 0, y: 0, w: 400, h: 120 },
  dataSource: { kind: 'custom-query', queryId: 'q' },
  boundColumns: [
    { key: 'name', label: 'Name' },
    { key: 'count', label: 'Count' },
    { key: 'pct', label: '%R', decimals: 1 },
  ],
  ...extra,
});

const resolved: ResolvedTable = {
  columns: [{ key: 'name', label: 'Name' }, { key: 'count', label: 'Count' }, { key: 'pct', label: '%R' }],
  rows: [
    { name: 'A', count: 4, pct: 10 },
    { name: 'B', count: 6, pct: '20.5' },
    { name: 'C', count: 'n/a', pct: 'x' },
  ],
};

describe('F1: totals row', () => {
  it('appends the label and per-column sums as the last body row, respecting decimals', () => {
    const el = boundTable({ totals: { label: 'Total', columns: ['count', 'pct'] } });
    const rows = bodyRowsFor(el, resolved);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toEqual(['Total', '10', '30.5']);
  });

  it('a column with no parseable values totals blank, and zero body rows still label the row', () => {
    const el = boundTable({ totals: { label: 'Total', columns: ['count'] } });
    const empty = bodyRowsFor(el, { columns: resolved.columns, rows: [] });
    expect(empty).toEqual([['Total', '', '']]);
    const junk = bodyRowsFor(boundTable({ totals: { label: 'T', columns: ['name'] } }),
      { columns: resolved.columns, rows: [{ name: 'A', count: 1, pct: 2 }] });
    expect(junk[1][0]).toBe('T');
  });

  it('the totals row counts toward pagination, so the last chunk cannot overflow', () => {
    const many: ResolvedTable = {
      columns: resolved.columns,
      rows: Array.from({ length: 40 }, (_, i) => ({ name: String(i), count: 1, pct: 1 })),
    };
    const without = elementChunkCount(boundTable(), many);
    const withTotals = elementChunkCount(boundTable({ totals: { label: 'Total', columns: ['count'] } }), many);
    const perChunk = maxRowsFor(toPt(boundTable().rect).h, headerBandHeight(boundTable()));
    // 40 rows fill the chunks exactly or not; +1 totals row must never be silently absorbed.
    expect(withTotals).toBe(Math.ceil(41 / perChunk));
    expect(without).toBe(Math.ceil(40 / perChunk));
  });

  it('a transposed table with totals is refused at write time', () => {
    const design = {
      id: 'd', name: 'D', paper: 'A4' as const, orientation: 'portrait' as const, status: 'draft' as const,
      parameters: [],
      pages: [{ id: 'p', elements: [boundTable({ transpose: true, totals: { label: 'Total', columns: ['count'] } })] }],
    };
    expect(findTransposedTotals(design)).toEqual([{ elementId: 't' }]);
    expect(findTransposedTotals({ ...design, pages: [{ id: 'p', elements: [boundTable()] }] })).toEqual([]);
  });
});

describe('F1: sum tokens', () => {
  it('resolves against the named same-page element and em-dashes the unresolvable', async () => {
    const { resolveSumTokens } = await import('./draw');
    const table = boundTable();
    const page = { id: 'p', elements: [table] };
    const flow = { page, resolved: new Map([['t', resolved]]) } as never;
    expect(resolveSumTokens('Total tested: {{sum(t.count)}}', flow)).toBe('Total tested: 10');
    expect(resolveSumTokens('{{sum(ghost.count)}}', flow)).toBe('—');
    expect(resolveSumTokens('{{sum(t.nope)}}', flow)).toBe('—');
    expect(resolveSumTokens('{{sum(t.count)}}', undefined)).toBe('—');
  });
});
