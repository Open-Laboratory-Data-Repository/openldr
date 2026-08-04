import { describe, it, expect } from 'vitest';
import { interpolate, paramMap, tableChunkCount, pageChunkCount, rowsFor, totalPhysicalPages, pageFooterLabel, cellTextOptions, columnWidths, isNumericColumn, CELL_TEXT_H, ROW_H, asCellStatus, cellStatusesFor, isRightAligned, keyValuePairs, pairRects, elementValue } from './draw';
import type { ReportDesign, DesignElement, DesignPage } from '../schema';
import type { ResolvedTable } from './index';

const NOW = new Date('2026-07-08T00:00:00Z');

function design(over: Partial<ReportDesign> = {}): ReportDesign {
  return {
    id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', pages: [], parameters: [], ...over,
  } as ReportDesign;
}

describe('paramMap', () => {
  it('maps string params by key, expands daterange to from/to, and sets date from now', () => {
    const m = paramMap(design({ parameters: [
      { key: 'lab', label: 'Lab', type: 'text', value: 'Ndola' },
      { key: 'range', label: 'Range', type: 'daterange', value: { from: '2026-01-01', to: '2026-06-30' } },
    ] }), NOW);
    expect(m.get('lab')).toBe('Ndola');
    expect(m.get('from')).toBe('2026-01-01');
    expect(m.get('to')).toBe('2026-06-30');
    expect(m.get('date')).toBe(NOW.toLocaleDateString());
  });

  it('ignores params with no value but still sets date', () => {
    const m = paramMap(design({ parameters: [{ key: 'empty', label: 'E', type: 'text' }] }), NOW);
    expect(m.has('empty')).toBe(false);
    expect(m.get('date')).toBe(NOW.toLocaleDateString());
  });
});

describe('interpolate', () => {
  const tokens = new Map<string, string>([['lab', 'Ndola'], ['date', '2026-07-08']]);

  it('replaces {{param.x}} and {{ param.x }} (inner whitespace)', () => {
    expect(interpolate('Lab {{param.lab}}', tokens)).toBe('Lab Ndola');
    expect(interpolate('Lab {{ param.lab }}', tokens)).toBe('Lab Ndola');
  });

  it('replaces {{date}} and {{ date }}', () => {
    expect(interpolate('as of {{date}}', tokens)).toBe('as of 2026-07-08');
    expect(interpolate('as of {{ date }}', tokens)).toBe('as of 2026-07-08');
  });

  it('yields empty string for an unknown {{param.missing}} token', () => {
    expect(interpolate('x{{param.missing}}y', tokens)).toBe('xy');
  });

  it('leaves non-token text untouched', () => {
    expect(interpolate('plain text', tokens)).toBe('plain text');
  });
});

const tbl = (over: Partial<DesignElement>): DesignElement =>
  ({ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 300, h: 100 }, ...over } as DesignElement);

describe('rowsFor', () => {
  it('projects boundColumns from resolved rows for a bound table', () => {
    const el = tbl({ dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] });
    expect(rowsFor(el, { columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], rows: [{ a: 1, b: 2 }] })).toEqual([['1']]); // only boundColumn 'a', stringified
  });
  it('returns [] for an error-resolved bound table and the element static rows for an unbound table', () => {
    expect(rowsFor(tbl({ dataSource: { kind: 'custom-query', queryId: 'q' } }), { error: 'x' })).toEqual([]);
    expect(rowsFor(tbl({ columns: ['A'], rows: [['1'], ['2']] }), undefined)).toEqual([['1'], ['2']]);
  });
});

describe('tableChunkCount', () => {
  // box h=100px → 75pt; maxRows = floor((75-16)/16) = 3
  it('splits a bound table into ceil(rows/maxRows) chunks', () => {
    const el = tbl({ dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] });
    const resolved: ResolvedTable = { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 7 }, (_, i) => ({ a: i })) };
    expect(tableChunkCount(el, resolved)).toBe(3); // ceil(7/3)
  });
  it('returns 1 for a non-table, an error table, and a degenerate (too-short) box', () => {
    expect(tableChunkCount(tbl({ kind: 'text' } as Partial<DesignElement>), undefined)).toBe(1);
    expect(tableChunkCount(tbl({ dataSource: { kind: 'custom-query', queryId: 'q' } }), { error: 'x' })).toBe(1);
    expect(tableChunkCount(tbl({ rect: { x: 0, y: 0, w: 300, h: 10 }, columns: ['A'], rows: [['1'], ['2']] }), undefined)).toBe(1);
  });
  it('counts static (unbound) table rows', () => {
    expect(tableChunkCount(tbl({ columns: ['A'], rows: [['1'], ['2'], ['3'], ['4']] }), undefined)).toBe(2); // ceil(4/3)
  });
});

describe('pageChunkCount', () => {
  it('is the max chunk count across the page tables (min 1)', () => {
    const page: DesignPage = { id: 'p', elements: [
      tbl({ id: 'a', columns: ['A'], rows: [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7']] }), // ceil(7/3)=3
      tbl({ id: 'b', columns: ['A'], rows: [['1']] }),                                            // 1
      { id: 'x', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'hi' } as DesignElement,
    ] };
    expect(pageChunkCount(page, new Map())).toBe(3);
  });
  it('is 1 for a page with no tables', () => {
    const page: DesignPage = { id: 'p', elements: [{ id: 'x', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'hi' } as DesignElement] };
    expect(pageChunkCount(page, new Map())).toBe(1);
  });
});

describe('cellTextOptions', () => {
  // Regression: cells passed `width` + `ellipsis: true` but no `height`. pdfkit only ellipsizes
  // text it has constrained VERTICALLY, so `ellipsis` was inert and long values wrapped — drawn on
  // top of the next row, because rows sit at fixed ROW_H offsets. Seen live in AMR GLASS RIS on
  // "Chloramphenicol" and "Trimethoprim/Sulfamethoxazole".
  //
  // ⚠ Measured with the real y-ADVANCE of doc.text, not doc.heightOfString: heightOfString ignores
  // both `height` and `lineBreak` and reports the wrapped height either way, so it cannot tell a
  // fixed cell from a broken one. Using it here would produce a test that passes on the bug.
  const advanceOf = async (text: string, width: number, opts: Record<string, unknown>): Promise<number> => {
    const { default: PDFDocument } = await import('pdfkit');
    const doc = new PDFDocument({ size: 'A4' });
    doc.font('Helvetica').fontSize(8); // the table body font used by drawGrid
    doc.text(text, 0, 100, { width, ...opts });
    return doc.y - 100;
  };

  // A GLASS RIS cell is ~56pt: 10 columns across the design's table box.
  const CELL_W = 56;
  const LINE = 9.25; // one 8pt Helvetica line, to 2dp

  it('draws a long antibiotic name on ONE line where it used to take three', async () => {
    const value = 'Trimethoprim/Sulfamethoxazole';
    expect(await advanceOf(value, CELL_W, {})).toBeGreaterThan(2 * LINE);          // the bug
    expect(await advanceOf(value, CELL_W, cellTextOptions(CELL_W))).toBeCloseTo(LINE, 1); // fixed
  });

  it('draws Chloramphenicol on ONE line where it used to take two', async () => {
    expect(await advanceOf('Chloramphenicol', CELL_W, {})).toBeGreaterThan(1.5 * LINE);
    expect(await advanceOf('Chloramphenicol', CELL_W, cellTextOptions(CELL_W))).toBeCloseTo(LINE, 1);
  });

  it('leaves a value that already fits untouched', async () => {
    expect(await advanceOf('Ceftriaxone', CELL_W, cellTextOptions(CELL_W))).toBeCloseTo(LINE, 1);
  });

  it('constrains height, and keeps ellipsis so the truncation is visible', () => {
    const o = cellTextOptions(80);
    expect(o.width).toBe(80);
    expect(o.height).toBe(CELL_TEXT_H);
    expect(o.ellipsis).toBe(true);
  });

  it('allows exactly one line in a row — never two', () => {
    // The invariant the fix rests on. If ROW_H or the font ever changes such that two lines fit,
    // the overlap silently returns; this fails first.
    expect(CELL_TEXT_H).toBeGreaterThanOrEqual(LINE);
    expect(CELL_TEXT_H).toBeLessThan(2 * LINE);
    expect(ROW_H).toBe(16);
  });
});

describe('columnWidths', () => {
  // Stand-in for pdfkit metrics: bold is a touch wider, which is enough to exercise the header
  // contribution without pulling a PDF document into a unit test.
  const measure = (t: string, bold: boolean) => t.length * (bold ? 5.2 : 4.6);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  it('gives a long text column more room than a single-character count column', () => {
    // The real shape of AMR GLASS RIS, which is what motivated this.
    const headers = ['Antibiotic', 'R', 'I', 'S'];
    const rows = [['Trimethoprim/Sulfamethoxazole', '0', '0', '2'], ['Ceftriaxone', '1', '0', '3']];
    const w = columnWidths(headers, rows, 400, measure);
    expect(w[0]).toBeGreaterThan(w[1] * 2); // the old uniform split made these equal
    expect(sum(w)).toBeCloseTo(400, 5);     // and the row still fills its box exactly
  });

  it('always fills exactly the width it is given', () => {
    for (const total of [120, 400, 900]) {
      const w = columnWidths(['a', 'bb', 'ccc'], [['1', '22', '333']], total, measure);
      expect(sum(w)).toBeCloseTo(total, 5);
    }
  });

  it('keeps a narrow column legible instead of collapsing it to nothing', () => {
    // One enormous column beside several tiny ones: the tiny ones must not vanish.
    const headers = ['id', 'note', 'n'];
    const rows = [['1', 'x'.repeat(300), '2']];
    const w = columnWidths(headers, rows, 400, measure);
    for (const width of w) expect(width).toBeGreaterThanOrEqual(20);
    expect(sum(w)).toBeCloseTo(400, 5);
  });

  it('caps one runaway column so it cannot starve the rest', () => {
    const wide = columnWidths(['a', 'b'], [['x'.repeat(500), 'y']], 400, measure);
    const narrow = columnWidths(['a', 'b'], [['x'.repeat(40), 'y']], 400, measure);
    // Past the cap, growing the content further must not keep taking width from column b.
    expect(wide[0]).toBeCloseTo(narrow[0], 5);
  });

  it('survives a degenerate table without dividing by zero', () => {
    expect(sum(columnWidths([], [], 300, measure))).toBeCloseTo(300, 5);
    expect(sum(columnWidths(['a'], [], 300, measure))).toBeCloseTo(300, 5);
  });
});

describe('isNumericColumn', () => {
  const rows = [
    ['VIBCO', '18', '0% (13)', '5-14', ''],
    ['SHIFL', '3', '100% (1)', '1-4', ''],
  ];
  it('detects a column of plain numbers', () => {
    expect(isNumericColumn(rows, 1)).toBe(true);
  });
  it('leaves formatted and mixed values ranged left', () => {
    expect(isNumericColumn(rows, 0)).toBe(false); // text
    expect(isNumericColumn(rows, 2)).toBe(false); // "0% (13)" is not a number
    expect(isNumericColumn(rows, 3)).toBe(false); // "5-14" is an age band, not a negative number
  });
  it('is false for an all-empty column rather than vacuously true', () => {
    expect(isNumericColumn(rows, 4)).toBe(false);
  });
  it('ignores blanks among numbers, and accepts negatives and decimals', () => {
    expect(isNumericColumn([['1'], [''], ['-2.5']], 0)).toBe(true);
  });
});

describe('pageFooterLabel', () => {
  it('formats "Page N / total"', () => {
    expect(pageFooterLabel(2, 5)).toBe('Page 2 / 5');
    expect(pageFooterLabel(1, 1)).toBe('Page 1 / 1');
  });
});

describe('totalPhysicalPages', () => {
  it('sums each design page chunk count (a 3-chunk table page + a plain page → 4)', () => {
    const pages: DesignPage[] = [
      { id: 'p1', elements: [tbl({ id: 'a', columns: ['A'], rows: [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7']] })] }, // ceil(7/3)=3
      { id: 'p2', elements: [{ id: 'x', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'hi' } as DesignElement] }, // 1
    ];
    expect(totalPhysicalPages(pages, new Map())).toBe(4);
  });
});

describe('asCellStatus', () => {
  it('accepts the five tokens case-insensitively and trims', () => {
    expect(asCellStatus('normal')).toBe('normal');
    expect(asCellStatus('  ABNORMAL ')).toBe('abnormal');
    expect(asCellStatus('Indeterminate')).toBe('indeterminate');
  });
  it('rejects anything else, including clinical tokens and non-strings', () => {
    expect(asCellStatus('R')).toBeUndefined();
    expect(asCellStatus('high')).toBeUndefined();
    expect(asCellStatus(1)).toBeUndefined();
    expect(asCellStatus(null)).toBeUndefined();
  });
});

describe('cellStatusesFor', () => {
  const ds = { kind: 'custom-query', queryId: 'q' } as const;

  it('returns [] when no bound column declares a statusKey (the identical-output contract)', () => {
    const el = tbl({ dataSource: ds, boundColumns: [{ key: 'a', label: 'A' }] });
    const resolved = { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }, { a: 2 }] };
    expect(cellStatusesFor(el, resolved)).toEqual([]);
  });

  it('reads the status column and aligns it to the bound column position', () => {
    const el = tbl({ dataSource: ds, boundColumns: [
      { key: 'name', label: 'Test' },
      { key: 'res', label: 'Result', statusKey: 'res_status' },
    ] });
    const resolved = {
      columns: [{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }],
      rows: [
        { name: 'HIV', res: 'Negative', res_status: 'normal' },
        { name: 'HBsAg', res: 'Positive', res_status: 'abnormal' },
      ],
    };
    expect(cellStatusesFor(el, resolved)).toEqual([
      [undefined, 'normal'],
      [undefined, 'abnormal'],
    ]);
  });

  it('drops an unrecognised status rather than passing it through', () => {
    const el = tbl({ dataSource: ds, boundColumns: [{ key: 'res', label: 'R', statusKey: 's' }] });
    const resolved = { columns: [{ key: 'res', label: 'R' }], rows: [{ res: 'x', s: 'RESISTANT' }] };
    expect(cellStatusesFor(el, resolved)).toEqual([[undefined]]);
  });

  it('returns [] for a static table and for an error-resolved bound table', () => {
    expect(cellStatusesFor(tbl({ columns: ['A'], rows: [['1']] }), undefined)).toEqual([]);
    expect(cellStatusesFor(tbl({ dataSource: ds, boundColumns: [{ key: 'a', label: 'A', statusKey: 's' }] }), { error: 'x' })).toEqual([]);
  });
});

describe('isRightAligned', () => {
  const numericRows = [['5.0'], ['6.2'], ['7.1']];

  it('right-aligns a numeric column with no kind, exactly as before this feature', () => {
    expect(isRightAligned(numericRows, 0, undefined)).toBe(true);
    expect(isRightAligned(numericRows, 0, 'value')).toBe(true);
  });

  it('never right-aligns a units or range column, even when every value parses as a number', () => {
    expect(isRightAligned(numericRows, 0, 'units')).toBe(false);
    expect(isRightAligned(numericRows, 0, 'range')).toBe(false);
  });

  it('leaves a non-numeric column left-aligned regardless of kind', () => {
    expect(isRightAligned([['abc']], 0, 'value')).toBe(false);
  });
});

describe('keyValuePairs', () => {
  const kv = (over: Partial<DesignElement>): DesignElement =>
    ({ id: 'k', kind: 'keyvalue', name: 'K', rect: { x: 0, y: 0, w: 200, h: 80 }, ...over }) as DesignElement;
  const ds = { kind: 'custom-query' as const, queryId: 'q' };

  it('makes ONE pair per bound column, valued from row 0 only', () => {
    const resolved: ResolvedTable = {
      columns: [{ key: 'a', label: 'A' }],
      rows: [{ a: 'first', b: 'B1' }, { a: 'second', b: 'B2' }],
    };
    const el = kv({ dataSource: ds, boundColumns: [{ key: 'a', label: 'Surname' }, { key: 'b', label: 'Sex' }] });
    expect(keyValuePairs(el, resolved)).toEqual([
      { label: 'Surname', value: 'first', status: undefined, emphasis: 'text' },
      { label: 'Sex', value: 'B1', status: undefined, emphasis: 'text' },
    ]);
  });

  it('carries S1 status and emphasis through from the bound column', () => {
    const resolved: ResolvedTable = { columns: [], rows: [{ r: 'Positive', s: 'abnormal' }] };
    const el = kv({ dataSource: ds, boundColumns: [{ key: 'r', label: 'Result', statusKey: 's', emphasis: 'fill' }] });
    expect(keyValuePairs(el, resolved)).toEqual([{ label: 'Result', value: 'Positive', status: 'abnormal', emphasis: 'fill' }]);
  });

  it('keeps the labels with EMPTY values when the query returns no rows', () => {
    const el = kv({ dataSource: ds, boundColumns: [{ key: 'a', label: 'Surname' }] });
    expect(keyValuePairs(el, { columns: [], rows: [] })).toEqual([
      { label: 'Surname', value: '', status: undefined, emphasis: 'text' },
    ]);
  });

  it('yields [] for an errored query, so the caller draws the error placeholder instead', () => {
    const el = kv({ dataSource: ds, boundColumns: [{ key: 'a', label: 'A' }] });
    expect(keyValuePairs(el, { error: 'boom' })).toEqual([]);
  });

  it('reads static [label, value] rows when unbound', () => {
    expect(keyValuePairs(kv({ rows: [['Label', 'Value'], ['Solo']] }), undefined)).toEqual([
      { label: 'Label', value: 'Value', emphasis: 'text' },
      { label: 'Solo', value: '', emphasis: 'text' },
    ]);
  });

  it('is empty for any other element kind', () => {
    expect(keyValuePairs({ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 } }, undefined)).toEqual([]);
  });
});

describe('pairRects', () => {
  const box = { x: 100, y: 200, w: 400, h: 200 };

  it('puts an inline label and its value on ONE baseline', () => {
    const [p] = pairRects(box, 1, 'inline', 1, false);
    expect(p.label.y).toBe(p.value.y);
    expect(p.value.x).toBeGreaterThan(p.label.x);
  });

  it('puts a stacked value BELOW its label, in the same column', () => {
    const [p] = pairRects(box, 1, 'stacked', 1, false);
    expect(p.value.y).toBeGreaterThan(p.label.y);
    expect(p.value.x).toBe(p.label.x);
  });

  it('flows pairs across then down, and stacked pitch exceeds inline pitch', () => {
    const inline = pairRects(box, 4, 'inline', 2, false);
    expect(inline[1].y).toBe(inline[0].y);          // same line, next column
    expect(inline[1].x).toBeGreaterThan(inline[0].x);
    expect(inline[2].x).toBe(inline[0].x);          // wrapped back to column 0
    expect(inline[2].y).toBeGreaterThan(inline[0].y);
    const stacked = pairRects(box, 3, 'stacked', 1, false);
    expect(stacked[1].y - stacked[0].y).toBeGreaterThan(inline[2].y - inline[0].y);
  });

  it('offsets every pair by the title band when the panel has a title', () => {
    const without = pairRects(box, 1, 'inline', 1, false)[0];
    const withTitle = pairRects(box, 1, 'inline', 1, true)[0];
    expect(withTitle.y - without.y).toBe(ROW_H);
  });

  it('clamps panelColumns into 1..4 rather than dividing by a nonsense value', () => {
    expect(pairRects(box, 2, 'inline', 0, false)[1].y).toBeGreaterThan(pairRects(box, 2, 'inline', 0, false)[0].y);
    const wide = pairRects(box, 5, 'inline', 9, false);
    expect(wide[4].x).toBe(wide[0].x); // wrapped after 4 columns, not 9
  });

  it('returns every pair even when they overflow the box, leaving clipping to the drawer', () => {
    expect(pairRects({ ...box, h: 20 }, 6, 'inline', 1, false)).toHaveLength(6);
  });
});

describe('lab identity tokens', () => {
  const tokens = (identity?: Record<string, string>) =>
    paramMap(design({ parameters: [{ key: 'site', label: 'Site', type: 'text', value: 'Ndola' }] }), NOW, identity);

  it('resolves each {{lab.*}} token', () => {
    const t = tokens({ name: 'Muhimbili', address: 'PO Box 65000\nDar es Salaam', contact: '+255 22' });
    expect(interpolate('{{lab.name}}', t)).toBe('Muhimbili');
    expect(interpolate('{{lab.address}}', t)).toBe('PO Box 65000\nDar es Salaam');
    expect(interpolate('{{lab.contact}}', t)).toBe('+255 22');
  });

  it('resolves an UNSET identity key to empty, not to the literal token', () => {
    // A design referencing identity must stay valid on an install that never configured it.
    // Leaving "{{lab.name}}" on the page would print braces onto a clinical report.
    expect(interpolate('{{lab.name}}', tokens())).toBe('');
    expect(interpolate('{{lab.name}}', tokens({ contact: 'x' }))).toBe('');
  });

  it('leaves param and date behaviour exactly as before', () => {
    const t = tokens({ name: 'Muhimbili' });
    expect(interpolate('{{param.site}}', t)).toBe('Ndola');
    expect(interpolate('{{date}}', t)).toBe(NOW.toLocaleDateString());
  });

  it('⛔ a design PARAMETER cannot shadow the lab identity', () => {
    // Identity is namespaced and written last. A report whose letterhead could be overwritten by a
    // parameter value is a forgery risk, not a convenience — so a param called `name` must not
    // reach {{lab.name}}, and must still reach {{param.name}}.
    const d = design({ parameters: [{ key: 'name', label: 'Name', type: 'text', value: 'ATTACKER LAB' }] });
    const t = paramMap(d, NOW, { name: 'Muhimbili' });
    expect(interpolate('{{lab.name}}', t)).toBe('Muhimbili');
    expect(interpolate('{{param.name}}', t)).toBe('ATTACKER LAB');
  });

  it('tolerates whitespace inside the braces, like the existing tokens', () => {
    expect(interpolate('{{ lab.name }}', tokens({ name: 'M' }))).toBe('M');
  });

  it('leaves an unknown lab sub-key alone rather than emitting a stray empty string mid-sentence', () => {
    // `{{lab.motto}}` is not a declared field; it resolves empty like any other unset key.
    expect(interpolate('A{{lab.motto}}B', tokens({ name: 'M' }))).toBe('AB');
  });
});
