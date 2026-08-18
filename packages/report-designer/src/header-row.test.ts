import { describe, it, expect } from 'vitest';
import { findUnsortedHeaderRows } from './header-row';
import { ReportDesignSchema, type ReportDesign } from './schema';

const design = (elements: unknown[]): ReportDesign => ({
  id: 'd', name: 'N', paper: 'A4', orientation: 'landscape', parameters: [], status: 'draft',
  pages: [{ id: 'p1', elements }],
} as ReportDesign);

const grid = (over: Record<string, unknown> = {}): unknown => ({
  id: 'g', kind: 'table', name: 'G', rect: { x: 0, y: 0, w: 400, h: 200 },
  dataSource: { kind: 'custom-query', queryId: 'q' },
  headerRow: true, sortBy: 'ord',
  ...over,
});

describe('findUnsortedHeaderRows', () => {
  it('⛔ names a bound table that lifts a header row without saying how the rows are ordered', () => {
    // The failure it prevents: `headerRow` lifts row 0 of whatever the renderer was handed. Without
    // `sortBy` that is the query's incidental first row, so the page prints a LABORATORY's name as
    // its date header — finished-looking and wrong, with no error anywhere.
    expect(findUnsortedHeaderRows(design([grid({ sortBy: undefined })])))
      .toEqual([{ elementId: 'g' }]);
  });

  it('passes the pair, and every table that does not lift a header row', () => {
    expect(findUnsortedHeaderRows(design([grid()]))).toEqual([]);
    expect(findUnsortedHeaderRows(design([grid({ headerRow: undefined, sortBy: undefined })]))).toEqual([]);
    expect(findUnsortedHeaderRows(design([grid({ headerRow: false, sortBy: undefined })]))).toEqual([]);
  });

  it('leaves an UNBOUND table alone — its rows are the author\'s own array, in the order written', () => {
    // Nothing can reorder a static `rows` array, so row 0 is already knowable and demanding
    // `sortBy` there would refuse a design that cannot be wrong.
    expect(findUnsortedHeaderRows(design([grid({
      dataSource: undefined, sortBy: undefined, columns: ['A'], rows: [['1'], ['2']],
    })]))).toEqual([]);
  });

  it('names every offender, across pages', () => {
    const d = {
      ...design([grid({ id: 'a', sortBy: undefined })]),
      pages: [
        { id: 'p1', elements: [grid({ id: 'a', sortBy: undefined }), grid({ id: 'ok' })] },
        { id: 'p2', elements: [grid({ id: 'b', sortBy: undefined })] },
      ],
    } as ReportDesign;
    expect(findUnsortedHeaderRows(d)).toEqual([{ elementId: 'a' }, { elementId: 'b' }]);
  });

  it('⛔ is NOT a schema refinement — an offending design still PARSES, so it stays openable', () => {
    // The rule `image-src.ts` records: `fromRow` parses every stored design through this schema on
    // READ, so a refinement here would make an already-stored design permanently unopenable. Taking
    // the report down is worse than the defect. This gate runs at WRITE, at the API boundary.
    const parsed = ReportDesignSchema.safeParse(design([grid({ sortBy: undefined })]));
    expect(parsed.success).toBe(true);
    expect(findUnsortedHeaderRows(parsed.data as ReportDesign)).toEqual([{ elementId: 'g' }]);
  });
});
