import { describe, it, expect } from 'vitest';
import { interpolate, paramMap, elementChunkCount, pageChunkCount, rowsFor, totalPhysicalPages, pageFooterLabel, cellTextOptions, columnWidths, isNumericColumn, CELL_TEXT_H, ROW_H, asCellStatus, cellStatusesFor, isRightAligned, keyValuePairs, pairRects, elementValue, interpolatedPairValues, transposeResolved, tableHeaders, headerBandHeight, headerRowFor, bodyRowsFor, headerTexts, drawsOnChunk, STACKED_HEAD_H, headerLines } from './draw';
import type { ReportDesign, DesignElement, DesignPage } from '../schema';
import type { ResolvedTable } from './index';

const NOW = new Date('2026-07-08T00:00:00Z');
// Local midnight, so `getDate()` is 8 in EVERY timezone. `NOW` above is a UTC instant and is 7 July
// in any negative-offset zone, which would make a literal date expectation pass in Nairobi and fail
// in New York.
const NOW_LOCAL = new Date(2026, 6, 8);

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
    ] }), NOW_LOCAL);
    expect(m.get('lab')).toBe('Ndola');
    // The reporting period is reformatted too — the audit called the raw ISO range mechanical.
    expect(m.get('from')).toBe('1 Jan 2026');
    expect(m.get('to')).toBe('30 Jun 2026');
    // A LITERAL, not `NOW.toLocaleDateString()`. The old expectation called the same function as the
    // code, so it passed whatever the format was — including the ambiguous `07/08/2026` this slice
    // exists to remove.
    expect(m.get('date')).toBe('8 Jul 2026');
  });

  it('renders a declared-but-unset param as an em dash, and still sets date', () => {
    // A blank beside a label reads as a failed render; "—" reads as "not filtered". (Previously this
    // param was left out of the map entirely — that changed when `paramMap` started always emitting
    // a declared parameter's token, so a design that prints it never shows a literal `{{param.x}}`.)
    const m = paramMap(design({ parameters: [{ key: 'empty', label: 'E', type: 'text' }] }), NOW_LOCAL);
    expect(m.get('empty')).toBe('—');
    expect(m.get('date')).toBe('8 Jul 2026');
  });

  it('leaves an unset date range as em dashes rather than formatting them', () => {
    // `from`/`to` are declared `text` and hold `—` when the range is not supplied. Formatting that
    // would print `Invalid Date` on the scope panel of a clinical report.
    const m = paramMap(design({ parameters: [
      { key: 'range', label: 'Range', type: 'daterange' },
    ] }), NOW_LOCAL);
    expect(m.get('from')).toBe('—');
    expect(m.get('to')).toBe('—');
  });

  it('leaves a non-date parameter value alone', () => {
    const m = paramMap(design({ parameters: [
      { key: 'site', label: 'Site', type: 'text', value: 'Ndola' },
    ] }), NOW_LOCAL);
    expect(m.get('site')).toBe('Ndola');
  });

  it('formats a TEXT parameter that holds a date — the seeded patient-demographics `asOf` does', () => {
    const m = paramMap(design({ parameters: [
      { key: 'asOf', label: 'As of (YYYY-MM-DD)', type: 'text', value: '2026-08-12' },
    ] }), NOW_LOCAL);
    expect(m.get('asOf')).toBe('12 Aug 2026');
  });

  it('leaves a text parameter that is NOT a date alone', () => {
    const m = paramMap(design({ parameters: [
      { key: 'year', label: 'Year', type: 'text', value: '2026' },
      { key: 'country', label: 'Country code', type: 'text', value: 'ZMB' },
      { key: 'facility', label: 'Facility', type: 'text', value: 'Ndola (NDL-001)' },
    ] }), NOW_LOCAL);
    expect(m.get('year')).toBe('2026');
    expect(m.get('country')).toBe('ZMB');
    expect(m.get('facility')).toBe('Ndola (NDL-001)');
  });
});

describe('paramMap prefers the RUN values over the design defaults', () => {
  const paramDesign = design({
    parameters: [
      { key: 'dateRange', label: 'Range', type: 'daterange', required: true, value: { from: '2000-01-01', to: '2000-12-31' } },
      { key: 'facility', label: 'Facility', type: 'select', required: false, value: '' },
    ],
  });

  it('reads a daterange from the FLAT from/to the runtime actually supplies', () => {
    // ⛔ The run values are flat — the Studio's picker writes top-level from/to and the seeded
    // queries declare from/to as their own params, so values['dateRange'] is always undefined.
    // Keying on the parameter's own name renders every date range as two em dashes.
    const m = paramMap(paramDesign, NOW, undefined, { from: '2026-01-01', to: '2026-03-31', facility: 'BAMAA' });
    expect(m.get('from')).toBe('1 Jan 2026');
    expect(m.get('to')).toBe('31 Mar 2026');
    expect(m.get('facility')).toBe('BAMAA');
  });

  it('renders a declared-but-unset parameter as an em dash, not blank', () => {
    // A blank beside a label reads as a failure; "—" reads as "not filtered".
    const m = paramMap(paramDesign, NOW, undefined, { from: '2026-01-01', to: '2026-03-31' });
    expect(m.get('facility')).toBe('—');
  });

  it('still falls back to the design defaults when no run values are supplied', () => {
    const m = paramMap(paramDesign, NOW);
    expect(m.get('from')).toBe('1 Jan 2000');
  });
});

describe('drawKeyValue interpolates authored pairs but never query data', () => {
  it('resolves tokens in an UNBOUND pair value', () => {
    const el = { id: 'k', kind: 'keyvalue', name: 'K', rect: { x: 0, y: 0, w: 400, h: 60 },
      rows: [['Reporting period', '{{param.from}} – {{param.to}}']] } as unknown as DesignElement;
    const pairs = keyValuePairs(el, undefined);
    expect(interpolatedPairValues(el, undefined, new Map([['from', '2026-01-01'], ['to', '2026-03-31']])))
      .toEqual(['2026-01-01 – 2026-03-31']);
    expect(pairs[0].value).toBe('{{param.from}} – {{param.to}}'); // raw at the pair layer
  });

  it('⛔ does NOT interpolate a BOUND value — that would let query data forge letterhead', () => {
    const el = { id: 'k', kind: 'keyvalue', name: 'K', rect: { x: 0, y: 0, w: 400, h: 60 },
      dataSource: { kind: 'custom-query', queryId: 'q' },
      boundColumns: [{ key: 'note', label: 'Note' }] } as unknown as DesignElement;
    const resolved = { columns: [{ key: 'note', label: 'Note' }], rows: [{ note: '{{lab.name}}' }] };
    // The key MUST be 'lab.name' (LAB_TOKEN_PREFIX = 'lab.', a dot — draw.ts:156), so the token map
    // actually HITS. A mismatched key (e.g. 'lab:name') would make this pass for the wrong reason:
    // the lookup misses regardless of the bound/unbound gate, so a wrongly-interpolated value would
    // render as '' rather than as the forged 'Ministry of Health' text — the assertion would pass
    // even if the security gate were inverted.
    expect(interpolatedPairValues(el, resolved, new Map([['lab.name', 'Ministry of Health']])))
      .toEqual(['{{lab.name}}']);
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

describe('elementChunkCount', () => {
  // box h=100px → 75pt; maxRows = floor((75-16)/16) = 3
  it('splits a bound table into ceil(rows/maxRows) chunks', () => {
    const el = tbl({ dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] });
    const resolved: ResolvedTable = { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 7 }, (_, i) => ({ a: i })) };
    expect(elementChunkCount(el, resolved)).toBe(3); // ceil(7/3)
  });
  it('returns 1 for a non-table, an error table, and a degenerate (too-short) box', () => {
    expect(elementChunkCount(tbl({ kind: 'text' } as Partial<DesignElement>), undefined)).toBe(1);
    expect(elementChunkCount(tbl({ dataSource: { kind: 'custom-query', queryId: 'q' } }), { error: 'x' })).toBe(1);
    expect(elementChunkCount(tbl({ rect: { x: 0, y: 0, w: 300, h: 10 }, columns: ['A'], rows: [['1'], ['2']] }), undefined)).toBe(1);
  });
  it('counts static (unbound) table rows', () => {
    expect(elementChunkCount(tbl({ columns: ['A'], rows: [['1'], ['2'], ['3'], ['4']] }), undefined)).toBe(2); // ceil(4/3)
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

  it('stacks a stat pair value ABOVE its caption, both centred', () => {
    const box = { x: 0, y: 0, w: 200, h: 200 };
    const [p] = pairRects(box, 1, 'stat', 1, false);
    expect(p.value.y).toBeLessThan(p.label.y);
    expect(p.value.w).toBe(p.label.w);
  });

  it('gives every stat pair the same box width, split by panelColumns', () => {
    const box = { x: 0, y: 0, w: 200, h: 200 };
    const four = pairRects(box, 4, 'stat', 2, false);
    expect(four[0].w).toBeCloseTo(four[1].w, 5);
    expect(four[0].y).toBeCloseTo(four[1].y, 5);
    expect(four[2].y).toBeGreaterThan(four[0].y);
  });
});

describe('lab identity tokens', () => {
  const tokens = (identity?: Record<string, string>) =>
    paramMap(design({ parameters: [{ key: 'site', label: 'Site', type: 'text', value: 'Ndola' }] }), NOW_LOCAL, identity);

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
    expect(interpolate('{{date}}', t)).toBe('8 Jul 2026');
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

describe('transposeResolved', () => {
  // The cumulative antibiogram is 29 drug columns wide against a handful of organism rows. Thirty
  // columns of "100% (12)" need ~840pt and landscape Letter has 696pt, so the natural orientation
  // cannot fit at ANY font — the cells set the floor, not the headers. Flipping it gives 29 rows
  // against however many organisms cleared the isolate threshold.
  const resolved = {
    columns: [
      { key: 'pathogen', label: 'Pathogen' },
      { key: 'Ampicillin', label: 'Ampicillin' },
      { key: 'Ciprofloxacin', label: 'Ciprofloxacin' },
    ],
    rows: [
      { pathogen: 'Shigella flexneri', Ampicillin: '100% (1)', Ciprofloxacin: '0% (1)' },
      { pathogen: 'Pseudomonas aeruginosa', Ampicillin: '', Ciprofloxacin: '0% (1)' },
    ],
  };

  it('turns the query columns into rows and the first column values into headers', () => {
    const t = transposeResolved(resolved, 'Antibiotic');
    expect(t.columns.map((c) => c.label)).toEqual(['Antibiotic', 'Shigella flexneri', 'Pseudomonas aeruginosa']);
    expect(t.rows).toHaveLength(2);
    expect(Object.values(t.rows[0])).toEqual(['Ampicillin', '100% (1)', '']);
    expect(Object.values(t.rows[1])).toEqual(['Ciprofloxacin', '0% (1)', '0% (1)']);
  });

  it('drops the original first column from the body — it became the headers', () => {
    // Leaving it in would print an organism-named row of organism names.
    const t = transposeResolved(resolved, 'Antibiotic');
    expect(t.rows.some((r) => Object.values(r).includes('Pathogen'))).toBe(false);
  });

  it('survives an empty result without inventing a column', () => {
    const t = transposeResolved({ columns: resolved.columns, rows: [] }, 'Antibiotic');
    expect(t.columns.map((c) => c.label)).toEqual(['Antibiotic']);
    expect(t.rows).toHaveLength(2);
  });

  it('keys every header uniquely even when two rows share a first-column value', () => {
    // Duplicate keys would silently collapse two organisms into one column.
    const dup = {
      columns: resolved.columns,
      rows: [
        { pathogen: 'E. coli', Ampicillin: 'a', Ciprofloxacin: 'b' },
        { pathogen: 'E. coli', Ampicillin: 'c', Ciprofloxacin: 'd' },
      ],
    };
    const t = transposeResolved(dup, 'Antibiotic');
    expect(new Set(t.columns.map((c) => c.key)).size).toBe(t.columns.length);
    expect(Object.values(t.rows[0])).toEqual(['Ampicillin', 'a', 'c']);
  });
});

describe('a transposed table element flows through headers, rows and pagination', () => {
  const el = {
    id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 700, h: 400 },
    dataSource: { kind: 'custom-query', queryId: 'q' }, transpose: true, transposeLabel: 'Antibiotic',
  } as unknown as DesignElement;
  const resolved = {
    columns: [
      { key: 'pathogen', label: 'Pathogen' },
      { key: 'Ampicillin', label: 'Ampicillin' },
      { key: 'Ciprofloxacin', label: 'Ciprofloxacin' },
    ],
    rows: [{ pathogen: 'Shigella flexneri', Ampicillin: '100% (1)', Ciprofloxacin: '0% (1)' }],
  };

  it('derives headers from the flipped table', () => {
    expect(tableHeaders(el, resolved)).toEqual(['Antibiotic', 'Shigella flexneri']);
  });

  it('derives body rows from the flipped table', () => {
    expect(rowsFor(el, resolved)).toEqual([['Ampicillin', '100% (1)'], ['Ciprofloxacin', '0% (1)']]);
  });

  it('paginates on the flipped ROW count, not the original one', () => {
    // The real antibiogram is ONE organism row across 30 drug columns; flipped that is 29 rows.
    // If chunking read the unflipped table it would see a single row, decide one page was enough,
    // and the drugs past the fold would silently never print.
    const wide = {
      columns: [{ key: 'pathogen', label: 'Pathogen' },
        ...Array.from({ length: 29 }, (_, i) => ({ key: `d${i}`, label: `Drug ${i}` }))],
      rows: [Object.fromEntries([['pathogen', 'E. coli'], ...Array.from({ length: 29 }, (_, i) => [`d${i}`, '0% (1)'])])],
    };
    const short = { ...el, rect: { x: 0, y: 0, w: 700, h: 160 } } as unknown as DesignElement;
    const flat = { ...short, transpose: false } as unknown as DesignElement;
    expect(rowsFor(short, wide)).toHaveLength(29);
    expect(elementChunkCount(short, wide)).toBeGreaterThan(elementChunkCount(flat, wide));
  });
});

// ---------------------------------------------------------------------------------------------
// `headerRow` — the first data row IS the header
// ---------------------------------------------------------------------------------------------

/** A bound table whose query returns a leading row carrying run-time column labels. */
const gridEl = (over: Partial<DesignElement> = {}): DesignElement => tbl({
  id: 'g',
  rect: { x: 0, y: 0, w: 400, h: 200 },
  dataSource: { kind: 'custom-query', queryId: 'q' },
  headerRow: true,
  boundColumns: [
    { key: 'lab', label: 'Laboratory' },
    { key: 'd01', label: '' },
    { key: 'd02', label: '' },
  ],
  ...over,
} as Partial<DesignElement>);

const gridResolved = (bodyCount = 4): ResolvedTable => ({
  columns: [{ key: 'lab', label: 'lab' }, { key: 'd01', label: 'd01' }, { key: 'd02', label: 'd02' }],
  rows: [
    { lab: '(dates)', d01: '1\nFeb', d02: '2\nFeb' },
    ...Array.from({ length: bodyCount }, (_, i) => ({ lab: `Lab ${i}`, d01: 'Y', d02: '' })),
  ],
});

describe('headerRow — lifting the first data row out of the body', () => {
  it('is inert without the flag: the header row stays a body row and the band is one row tall', () => {
    const el = gridEl({ headerRow: undefined });
    expect(headerRowFor(el, gridResolved())).toBeUndefined();
    expect(bodyRowsFor(el, gridResolved())).toEqual(rowsFor(el, gridResolved()));
    expect(bodyRowsFor(el, gridResolved())).toHaveLength(5);
    expect(headerBandHeight(el)).toBe(ROW_H);
  });

  it('lifts row 0 out of the body and gives the band a second line', () => {
    const el = gridEl();
    expect(headerRowFor(el, gridResolved())).toEqual(['(dates)', '1\nFeb', '2\nFeb']);
    expect(bodyRowsFor(el, gridResolved())).toEqual([
      ['Lab 0', 'Y', ''], ['Lab 1', 'Y', ''], ['Lab 2', 'Y', ''], ['Lab 3', 'Y', ''],
    ]);
    expect(headerBandHeight(el)).toBe(STACKED_HEAD_H);
    expect(STACKED_HEAD_H).toBeGreaterThan(ROW_H);
  });

  it('keeps a declared label and fills only the blank ones from the header row', () => {
    // The design knows "Laboratory" at design time and the run knows the dates. Neither may
    // overwrite the other: a data cell that could replace an authored header would let a query
    // relabel a column of a published report.
    expect(headerTexts(['Laboratory', '', ''], ['(dates)', '1\nFeb', '2\nFeb']))
      .toEqual(['Laboratory', '1\nFeb', '2\nFeb']);
    expect(headerTexts(['Laboratory', '', ''], undefined)).toEqual(['Laboratory', '', '']);
    // A header row shorter than the column list leaves the remaining headers blank, never undefined.
    expect(headerTexts(['A', '', ''], ['x'])).toEqual(['A', '', '']);
  });

  it('excludes the lifted row from the chunk arithmetic and pays for the taller band', () => {
    // h = 200px = 150pt. Without the flag: floor((150-16)/16) = 8 rows over 5 rows = 1 chunk.
    // With it: floor((150-24)/16) = 7 body rows over 20 body rows = 3 chunks.
    const plain = gridEl({ headerRow: undefined });
    expect(elementChunkCount(plain, gridResolved(20))).toBe(3); // ceil(21/8)
    expect(elementChunkCount(gridEl(), gridResolved(20))).toBe(3); // ceil(20/7)
    expect(elementChunkCount(gridEl(), gridResolved(7))).toBe(1);
    expect(elementChunkCount(gridEl(), gridResolved(8))).toBe(2);
  });

  it('is 1 chunk when the query returned only the header row', () => {
    expect(elementChunkCount(gridEl(), gridResolved(0))).toBe(1);
  });
});

describe('columnWidths measures a stacked header line by line', () => {
  // A fake metric: 10 per character. Enough to prove WHICH string is measured, which is the whole
  // question — the real pdfkit numbers live in the seed test that owns the design.
  const measure = (t: string): number => t.length * 10;

  it('takes the widest LINE of a multi-line header, never the concatenation', () => {
    // TWO columns, so the proportion is observable — with one column every input scales to
    // `totalW` and the assertion would pass whatever was measured.
    // "1\nFeb" must measure as "Feb" (3 chars = 30), not as the 5-character run "1Feb"/"1 Feb".
    expect(columnWidths(['name', '1\nFeb'], [], 1000, measure))
      .toEqual(columnWidths(['name', 'Feb'], [], 1000, measure));
    expect(columnWidths(['name', '1\nFeb'], [], 1000, measure))
      .not.toEqual(columnWidths(['name', '1 Feb'], [], 1000, measure));
  });

  it('gives the wide column the room the stacking frees', () => {
    const rows = [['Kilimanjaro Christian Medical Centre', 'Y', 'Y']];
    const inline = columnWidths(['Laboratory', '23 Feb', '23 Feb'], rows, 600, measure);
    const stacked = columnWidths(['Laboratory', '23\nFeb', '23\nFeb'], rows, 600, measure);
    expect(stacked[0]).toBeGreaterThan(inline[0]);
    expect(stacked[1]).toBeLessThan(inline[1]);
  });

  it('is unchanged for a header with no newline', () => {
    // natural = widest of (header, sampled cells) + CELL_PAD*2 + 2 → 40+10=50 and 50+10=60,
    // scaled to 500 in proportion. Nothing here is above MIN_COL_W, so no floor is applied.
    const rows = [['a', 'bb'], ['ccc', 'd']];
    const w = columnWidths(['Head', 'Other'], rows, 500, measure);
    expect(w[0]).toBeCloseTo(500 * 50 / 110, 10);
    expect(w[1]).toBeCloseTo(500 * 60 / 110, 10);
  });

  // ⛔ The line budget is the band's, not a constant. A table that did NOT declare `headerRow`
  // reserves ROW_H and may draw exactly ONE header line; only a table that did reserves
  // STACKED_HEAD_H and may draw two. Measuring two lines for a one-line band sizes the column
  // for text it then clips — the mis-measure half of the overprint defect.
  it('measures ONE line when only one was reserved, and two when two were', () => {
    expect(columnWidths(['name', '1\nFebruary'], [], 1000, measure, 1))
      .toEqual(columnWidths(['name', '1'], [], 1000, measure, 1));
    expect(columnWidths(['name', '1\nFebruary'], [], 1000, measure, 1))
      .not.toEqual(columnWidths(['name', '1\nFebruary'], [], 1000, measure, 2));
  });
});

describe('headerLines — the line budget', () => {
  it('stacks two lines by default, because STACKED_HEAD_H reserves room for two', () => {
    expect(headerLines('1\nFeb')).toEqual(['1', 'Feb']);
    expect(headerLines('1\nFeb\nExtra')).toEqual(['1', 'Feb']);
  });

  it('clips to the FIRST line when the caller reserved only one', () => {
    // The pre-fix behaviour for every table that did not opt into `headerRow`: the second line
    // was drawn at r.y + CELL_PAD + HEAD_LINE_H = y+12, 12pt tall, over a first body row that
    // starts at y+16.
    expect(headerLines('1\nFeb', 1)).toEqual(['1']);
  });

  it('never returns zero lines, so a caller never has to special-case an empty header', () => {
    expect(headerLines('x', 0)).toEqual(['x']);
    expect(headerLines('')).toEqual(['']);
  });
});

describe('drawsOnChunk — nothing is drawn for a chunk a table does not reach', () => {
  const short = tbl({ id: 'short', columns: ['A'], rows: [['1']] });                  // 1 chunk
  const long = tbl({ id: 'long', columns: ['A'], rows: [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7']] }); // 3
  const heading = { id: 'h', kind: 'text', name: 'H', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'Short grid', showWithTable: 'short' } as DesignElement;
  const plainText = { id: 'p', kind: 'text', name: 'P', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'Footer' } as DesignElement;
  const page: DesignPage = { id: 'p', elements: [short, long, heading, plainText] };
  const resolved = new Map<string, ResolvedTable>();

  it('draws a table only on the chunks it actually fills', () => {
    expect(drawsOnChunk(short, page, resolved, 0)).toBe(true);
    expect(drawsOnChunk(short, page, resolved, 1)).toBe(false);
    expect(drawsOnChunk(long, page, resolved, 2)).toBe(true);
  });

  it('hides an element tied to that table on the same chunks', () => {
    expect(drawsOnChunk(heading, page, resolved, 0)).toBe(true);
    expect(drawsOnChunk(heading, page, resolved, 1)).toBe(false);
  });

  it('leaves every other element on every chunk', () => {
    expect(drawsOnChunk(plainText, page, resolved, 0)).toBe(true);
    expect(drawsOnChunk(plainText, page, resolved, 2)).toBe(true);
  });

  it('⛔ keeps drawing a FAILED table, and its heading, on every chunk', () => {
    // Out of rows and failed to run are different conditions. A reader handed only the last page
    // must still see that the query failed, so the error placeholder repeats where an exhausted
    // grid disappears.
    const broken = tbl({ id: 'broken', dataSource: { kind: 'custom-query', queryId: 'q' } });
    const brokenHead = { id: 'bh', kind: 'text', name: 'BH', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'Broken grid', showWithTable: 'broken' } as DesignElement;
    const p: DesignPage = { id: 'p', elements: [broken, long, brokenHead] };
    const errored = new Map<string, ResolvedTable>([['broken', { error: 'boom' }]]);
    expect(drawsOnChunk(broken, p, errored, 0)).toBe(true);
    expect(drawsOnChunk(broken, p, errored, 2)).toBe(true);
    expect(drawsOnChunk(brokenHead, p, errored, 2)).toBe(true);
  });

  it('draws an element whose showWithTable names something that is not on the page', () => {
    // Fail OPEN. A dangling reference must not silently delete a heading from every page; the
    // missing element is a design defect and hiding its companion would hide the evidence.
    const dangling = { ...heading, id: 'd', showWithTable: 'nope' } as DesignElement;
    expect(drawsOnChunk(dangling, page, resolved, 0)).toBe(true);
    expect(drawsOnChunk(dangling, page, resolved, 5)).toBe(true);
  });
});

it('projects cellgrid rows through labelColumn, cellColumns and trailingColumns in order', () => {
  const el = {
    id: 'g', kind: 'cellgrid', name: 'g', rect: { x: 0, y: 0, w: 400, h: 200 },
    dataSource: { kind: 'custom-query', queryId: 'q' },
    labelColumn: 'lab',
    cellColumns: ['d01', 'd02'],
    trailingColumns: [{ key: 'days', label: 'Days', width: 34.5 }],
  } as DesignElement;
  const resolved: ResolvedTable = {
    columns: [{ key: 'lab', label: 'Lab' }, { key: 'd01', label: '' }, { key: 'd02', label: '' }, { key: 'days', label: 'Days' }],
    rows: [{ lab: 'Bahi', d01: 0, d02: 1, days: '01/22' }],
  };
  expect(rowsFor(el, resolved)).toEqual([['Bahi', '0', '1', '01/22']]);
});

it('omits the label slot for a cellgrid with no labelColumn', () => {
  const el = {
    id: 'g', kind: 'cellgrid', name: 'g', rect: { x: 0, y: 0, w: 400, h: 200 },
    dataSource: { kind: 'custom-query', queryId: 'q' },
    cellColumns: ['d01'],
  } as DesignElement;
  const resolved: ResolvedTable = { columns: [{ key: 'd01', label: '' }], rows: [{ d01: 3 }] };
  expect(rowsFor(el, resolved)).toEqual([['3']]);
});

function cellGridEl(rows: number): { el: DesignElement; resolved: ResolvedTable } {
  // 545px@96 = 408.75pt; (408.75 - 13) / 12.75 = 31.03 -> 31 rows a chunk
  const el = {
    id: 'g', kind: 'cellgrid', name: 'g', rect: { x: 0, y: 0, w: 900, h: 545 },
    dataSource: { kind: 'custom-query', queryId: 'q' },
    labelColumn: 'lab', cellColumns: ['d01'], groupBoundary: 'token-change',
  } as DesignElement;
  const body = Array.from({ length: rows }, (_, i) => ({ lab: `L${i}`, d01: 1 }));
  const resolved: ResolvedTable = {
    columns: [{ key: 'lab', label: '' }, { key: 'd01', label: '' }],
    rows: [{ lab: '', d01: '02' }, { lab: '', d01: '1' }, ...body],
  };
  return { el, resolved };
}

it('chunks a cellgrid by its own row pitch, not the table row pitch', () => {
  const a = cellGridEl(31);
  expect(elementChunkCount(a.el, a.resolved)).toBe(1);
  const b = cellGridEl(32);
  expect(elementChunkCount(b.el, b.resolved)).toBe(2);
});

it('stops drawing a cellgrid once its rows run out', () => {
  const { el, resolved } = cellGridEl(10);
  const page = { id: 'p', elements: [el] };
  const map = new Map([['g', resolved]]);
  expect(drawsOnChunk(el, page, map, 0)).toBe(true);
  expect(drawsOnChunk(el, page, map, 1)).toBe(false);
});

it('lets a heading follow a cellgrid via showWithTable', () => {
  const { el, resolved } = cellGridEl(10);
  const heading = {
    id: 'h', kind: 'text', name: 'h', rect: { x: 0, y: 0, w: 100, h: 14 },
    text: 'Any HVL/EID data submission', showWithTable: 'g',
  } as DesignElement;
  const page = { id: 'p', elements: [heading, el] };
  const map = new Map([['g', resolved]]);
  expect(drawsOnChunk(heading, page, map, 0)).toBe(true);
  expect(drawsOnChunk(heading, page, map, 1)).toBe(false);
});
