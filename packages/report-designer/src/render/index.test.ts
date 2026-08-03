import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import PDFDocument from 'pdfkit';
import { renderReportDesignPdf, type ResolvedTable } from './index';
import { columnWidths } from './draw';
import type { ReportDesign, BoundColumn } from '../schema';

const NOW = new Date('2026-07-08T00:00:00Z');

function baseDesign(over: Partial<ReportDesign> = {}): ReportDesign {
  return { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [], pages: [{ id: 'p1', elements: [] }], ...over } as ReportDesign;
}

describe('renderReportDesignPdf', () => {
  it('returns a non-empty PDF buffer starting with %PDF', async () => {
    const buf = await renderReportDesignPdf(baseDesign(), new Map(), { now: NOW });
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders a bound table from resolved rows and a query-error placeholder without throwing', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'A', rect: { x: 10, y: 10, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q1' }, boundColumns: [{ key: 'org', label: 'Organism' }] },
      { id: 't2', kind: 'table', name: 'B', rect: { x: 10, y: 200, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q2' } },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([
      ['t1', { columns: [{ key: 'org', label: 'Organism' }], rows: [{ org: 'E. coli' }] }],
      ['t2', { error: 'boom' }],
    ]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('does not throw or corrupt the stream when an image src is invalid, and still draws following elements', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 'img', kind: 'image', name: 'I', rect: { x: 10, y: 10, w: 80, h: 60 }, src: 'data:image/png;base64,NOTVALID' },
      { id: 'txt', kind: 'text', name: 'T', rect: { x: 10, y: 90, w: 300, h: 20 }, text: 'after the bad image' },
      { id: 'box', kind: 'rect', name: 'R', rect: { x: 10, y: 120, w: 100, h: 40 }, style: { fill: '#eef' } },
    ] }] });
    const buf = await renderReportDesignPdf(design, new Map(), { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(100);
  });

  it('emits one PDF page per design page', async () => {
    const two = baseDesign({ pages: [{ id: 'a', elements: [] }, { id: 'b', elements: [] }] });
    const buf = await renderReportDesignPdf(two, new Map(), { now: NOW });
    expect(buf.toString('latin1')).toContain('/Type /Pages');
    expect(buf.toString('latin1')).toMatch(/\/Count 2/);
  });

  it('paginates an overflowing table onto extra pages and repeats non-table elements', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 'title', kind: 'text', name: 'Title', rect: { x: 10, y: 10, w: 300, h: 20 }, text: 'Turnaround time' },
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 40, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([['t1', { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 7 }, (_, i) => ({ a: `row${i}` })) }]]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.toString('latin1')).toMatch(/\/Count 3/);
  });

  it('renders exactly one page when the table fits (no regression)', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 200 }, dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([['t1', { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 'x' }, { a: 'y' }] }]]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    expect(buf.toString('latin1')).toMatch(/\/Count 1/);
  });

  it('paginates an overflowing static (unbound) table through the render path', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 100 }, columns: ['A'], rows: Array.from({ length: 7 }, (_, i) => [`r${i}`]) },
    ] }] });
    const buf = await renderReportDesignPdf(design, new Map(), { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.toString('latin1')).toMatch(/\/Count 3/);
  });

  it('draws the page-number footer as chrome — same /Count with pageNumbers on as off, and does not throw', async () => {
    const pages = [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] },
    ] }] as ReportDesign['pages'];
    const resolved = new Map<string, ResolvedTable>([['t1', { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 7 }, (_, i) => ({ a: `row${i}` })) }]]);
    const off = await renderReportDesignPdf(baseDesign({ pages }), resolved, { now: NOW });
    const on = await renderReportDesignPdf(baseDesign({ pages, pageNumbers: true }), resolved, { now: NOW });
    expect(off.toString('latin1')).toMatch(/\/Count 3/);
    expect(on.toString('latin1')).toMatch(/\/Count 3/); // footer is chrome, not extra pages
    expect(on.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('an error table does not paginate (1 page) and does not throw', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q' } },
    ] }] });
    const buf = await renderReportDesignPdf(design, new Map([['t1', { error: 'boom' }]]), { now: NOW });
    expect(buf.toString('latin1')).toMatch(/\/Count 1/);
  });
});

/** Text baselines, in PDF user space, parsed out of the (deflated) content streams.
 *  pdfkit emits `1 0 0 1 <x> <y> Tm` before each run — verified against pdfkit 0.15.2. */
function textYs(pdf: Buffer): number[] {
  const ys: number[] = [];
  const raw = pdf.toString('latin1');
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streams.exec(raw))) {
    let body: string;
    try { body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    const tm = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g;
    let t: RegExpExecArray | null;
    while ((t = tm.exec(body))) ys.push(parseFloat(t[2]));
  }
  return ys;
}

/** All content-stream bytes, decompressed and concatenated in stream order — for substring
 *  assertions on the raw PDF drawing operators (colours, rects) that `textYs` doesn't expose. */
function decodedContent(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  let out = '';
  while ((m = streams.exec(raw))) {
    try { out += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { /* not a flate stream (e.g. a font) */ }
  }
  return out;
}

/** Each physical page's own decoded content stream, in page order — found via `/Kids` rather than
 *  assumed from byte order, so a page-2-shows-page-1's-content bug can't hide behind a coincidence
 *  of object emission order. */
function pageContents(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const kids = raw.match(/\/Type\s*\/Pages[\s\S]*?\/Kids\s*\[([^\]]*)\]/);
  if (!kids) throw new Error('no /Kids found in PDF');
  const kidIds = [...kids[1].matchAll(/(\d+) 0 R/g)].map((m) => m[1]);
  const objBody = (id: string): string => {
    const m = raw.match(new RegExp(`(?:^|[^0-9])${id} 0 obj([\\s\\S]*?)endobj`));
    if (!m) throw new Error(`obj ${id} not found`);
    return m[1];
  };
  return kidIds.map((id) => {
    const contentsId = objBody(id).match(/\/Contents (\d+) 0 R/)?.[1];
    if (!contentsId) throw new Error(`page ${id} has no /Contents`);
    const stream = objBody(contentsId).match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (!stream) throw new Error(`contents ${contentsId} has no stream`);
    return zlib.inflateSync(Buffer.from(stream[1], 'latin1')).toString('latin1');
  });
}

/** The `/DeviceRGB cs\n<r> <g> <b> scn` operator pdfkit emits for a `fillColor(hex)` call —
 *  computed from the hex, not copied from a captured sample, so the assertion documents its own
 *  derivation instead of pinning a magic string. */
function fillOp(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return `${r} ${g} ${b} scn`;
}

/** pdfkit rounds every content-stream coordinate to 6 decimal places (`PDFObject.number`,
 *  `Math.round(n * 1e6) / 1e6`, pdfkit 0.15.2) before printing it into a `re`/`m`/`l` operator. */
function pdfNum(n: number): number { return Math.round(n * 1e6) / 1e6; }

const statusDesign = (boundColumns: BoundColumn[], rect: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 400, h: 200 }): ReportDesign => ({
  id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [],
  pages: [{ id: 'p', elements: [{
    id: 't', kind: 'table', name: 'T', rect,
    dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns,
  }] }],
} as ReportDesign);

const statusRows = (): Map<string, ResolvedTable> => new Map([['t', {
  columns: [{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }],
  rows: [
    { name: 'HIV 1/2 Ab', res: 'Negative', s: 'normal' },
    { name: 'HBsAg', res: 'Positive', s: 'abnormal' },
    { name: 'Treponema pallidum antibody screen', res: 'Indeterminate', s: 'indeterminate' },
  ],
}]]);

describe('cell status rendering', () => {
  it('does not move a single text baseline when a filled status column is added', async () => {
    const plain = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }]), statusRows());
    const filled = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }]), statusRows());
    expect(textYs(filled)).toEqual(textYs(plain));
  });

  it('keeps every body row exactly ROW_H apart with a long value in a filled cell', async () => {
    // The long value lives in `res` — the FILLED column — not `name`, so this actually exercises
    // the wrap-vs-ellipsis regression `cellTextOptions`'s docblock warns about: dropping `height`
    // from that function wraps this value onto a second line inside its fixed-height row, which
    // pushes every following row's baseline off the 16pt grid. A long `name` value alone cannot
    // catch that, because `name` carries no status/emphasis and was never the code path in question.
    const longVal = 'Methicillin-resistant Staphylococcus aureus screen POSITIVE result';
    const rows = new Map<string, ResolvedTable>([['t', {
      columns: [{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }],
      rows: [
        { name: 'HIV 1/2 Ab', res: 'Negative', s: 'normal' },
        { name: 'HBsAg', res: longVal, s: 'abnormal' },
        { name: 'Treponema pallidum antibody screen', res: 'Indeterminate', s: 'indeterminate' },
      ],
    }]]);
    const pdf = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }]), rows);
    const rowYs = [...new Set(textYs(pdf))].sort((a, b) => b - a);
    const gaps = rowYs.slice(1).map((y, i) => Number((rowYs[i] - y).toFixed(3)));
    expect(gaps).toEqual([16, 16, 16]);
  });

  it('emits no status fill colour anywhere when the design declares no statusKey', async () => {
    const plain = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }]), statusRows());
    const content = decodedContent(plain);
    // None of the five status chip colours may appear when no column carries a statusKey — a
    // byte-length comparison against a "filled" render (the prior version of this test) passes on
    // any extra byte at all, including the wrong colour, the wrong column, or a chip on every cell.
    for (const hex of ['#16a34a', '#e11d48', '#9f1239', '#94a3b8', '#e2e8f0']) {
      expect(content).not.toContain(fillOp(hex));
    }
  });

  it('paints the fill chip exactly on the status column band, ROW_H tall, in the status colour', async () => {
    const headers = ['Test', 'Result'];
    const rows = [['HBsAg', 'Positive']];
    const rectWPt = 300 * 0.75; // rect.w is authored in px (matches statusDesign's convention)
    const measureDoc = new PDFDocument({ autoFirstPage: false });
    const widths = columnWidths(headers, rows, rectWPt, (text, bold) => {
      measureDoc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      return measureDoc.widthOfString(text);
    });
    const expectedX = widths[0]; // res is column index 1; rect.x is 0
    const expectedW = widths[1];
    const expectedY = 16; // r.y(0) + ROW_H(16) + row 0 * ROW_H

    const resolved = new Map<string, ResolvedTable>([['t', {
      columns: [{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }],
      rows: [{ name: 'HBsAg', res: 'Positive', s: 'critical' }],
    }]]);
    const pdf = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }],
                   { x: 0, y: 0, w: 300, h: 100 }),
      resolved);
    const content = decodedContent(pdf);

    const expectedRect = `${pdfNum(expectedX)} ${pdfNum(expectedY)} ${pdfNum(expectedW)} 16 re`;
    const expectedFill = fillOp('#9f1239'); // STATUS_CHIP_FILL.critical
    // The rect, its fill colour, and the paint op must appear back-to-back — not just present
    // somewhere in the stream — so a wrong colour, wrong size, or wrong column all fail this.
    expect(content).toContain(`${expectedRect}\n/DeviceRGB cs\n${expectedFill}\nf`);
  });

  it('gives a `none` status a dark chip text colour, not the white used by every other status', async () => {
    // STATUS_CHIP_FILL.none (#e2e8f0) is near-white; white-on-white text (~1.15:1 contrast) is
    // effectively invisible. `none` must render with the same dark slate body text uses.
    const resolved = new Map<string, ResolvedTable>([['t', {
      columns: [{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }],
      rows: [{ name: 'CBC', res: 'Pending', s: 'none' }],
    }]]);
    const pdf = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }],
                   { x: 0, y: 0, w: 300, h: 100 }),
      resolved);
    const content = decodedContent(pdf);
    const chipFill = fillOp('#e2e8f0'); // STATUS_CHIP_FILL.none
    expect(content).toContain(`${chipFill}\nf\n/DeviceRGB cs\n${fillOp('#334155')}`); // dark slate (BODY_TEXT)
    expect(content).not.toContain(`${chipFill}\nf\n/DeviceRGB cs\n${fillOp('#ffffff')}`); // never white here
  });

  it('tints the value with STATUS_TEXT_COLOR under the default (omitted) emphasis, not a fill chip', async () => {
    // No test previously rendered a bound column with `emphasis` omitted (the documented default is
    // `'text'`), so STATUS_TEXT_COLOR was provably dead to the suite.
    const resolved = new Map<string, ResolvedTable>([['t', {
      columns: [{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }],
      rows: [{ name: 'HBsAg', res: 'Positive', s: 'abnormal' }],
    }]]);
    const pdf = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result', statusKey: 's' }]),
      resolved);
    const content = decodedContent(pdf);
    expect(content).toContain(fillOp('#b91c1c')); // STATUS_TEXT_COLOR.abnormal
    expect(content).not.toContain(fillOp('#e11d48')); // STATUS_CHIP_FILL.abnormal — no chip was drawn
  });

  it('shows page 2 its own statuses, not page 1s, after the table paginates', async () => {
    // A 4-row table in a box tall enough for exactly 2 body rows per page (`maxRows = 2`) needs 2
    // physical pages. `drawGrid` must slice `allStatuses` by the SAME [lo, lo+maxRows) window as
    // `allRows` — slicing statuses from the start of the array every time (a page-2-repeats-page-1's-
    // colours bug) would leave every one of the other 53 tests green.
    const resolved = new Map<string, ResolvedTable>([['t', {
      columns: [{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }],
      rows: [
        { name: 'r0', res: 'v0', s: 'normal' },
        { name: 'r1', res: 'v1', s: 'abnormal' },
        { name: 'r2', res: 'v2', s: 'critical' },
        { name: 'r3', res: 'v3', s: 'indeterminate' },
      ],
    }]]);
    const pdf = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }],
                   { x: 0, y: 0, w: 300, h: 64 }), // 64px -> 48pt -> maxRows = floor((48-16)/16) = 2
      resolved);
    const pages = pageContents(pdf);
    expect(pages.length).toBe(2);
    const normal = fillOp('#16a34a');
    const abnormal = fillOp('#e11d48');
    const critical = fillOp('#9f1239');
    const indeterminate = fillOp('#94a3b8');
    expect(pages[1]).toContain(critical);
    expect(pages[1]).toContain(indeterminate);
    expect(pages[1]).not.toContain(normal);
    expect(pages[1]).not.toContain(abnormal);
  });
});

describe('drawTable wires column.kind into alignment', () => {
  // `columnWidths` depends only on headers/rows, never `kind`, so both renders below get IDENTICAL
  // column geometry — any difference in a text run's x-position is attributable purely to the
  // alignment `isRightAligned` chose, which proves `drawTable` actually forwards `column.kind` into
  // it (rather than, say, dropping the `kinds` array entirely — that mutation leaves every OTHER
  // test in this file green).
  it('renders an all-numeric column right-aligned by default, and left-aligned when kind is "units"', async () => {
    const resolved = new Map<string, ResolvedTable>([['t', {
      columns: [{ key: 'v', label: 'V' }],
      rows: [{ v: '100' }, { v: '5' }],
    }]]);
    const rightAligned = await renderReportDesignPdf(statusDesign([{ key: 'v', label: 'V' }]), resolved);
    const leftAligned = await renderReportDesignPdf(
      statusDesign([{ key: 'v', label: 'V', kind: 'units' }]), resolved);

    // Locate the "100" data cell's own text run (hex `313030` = the ASCII codes for "1","0","0")
    // in each decompressed content stream and read back its `Tm` x-coordinate.
    const cellRunX = (pdf: Buffer): string => {
      const content = decodedContent(pdf);
      const m = content.match(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\n\/F\d \d+ Tf\n\[<313030>[^\]]*\] TJ/);
      expect(m).not.toBeNull();
      return (m as RegExpMatchArray)[1];
    };
    expect(cellRunX(leftAligned)).not.toBe(cellRunX(rightAligned));
  });
});

describe('status palette pinning', () => {
  // Only STATUS_TEXT_COLOR.abnormal (and the `none`/critical chip cases) are asserted anywhere
  // else in this file. Because this palette is a SANCTIONED duplicate of `@openldr/report-pdf`'s
  // copy in `../index.ts`, tests are the only thing keeping the two in step — pin every entry here
  // so a drift in any one of the 15 hex values fails loudly. Values verified against
  // `packages/report-pdf/src/index.ts` (not imported from `draw.ts`, which is module-private and
  // would just pin the duplicate to itself, proving nothing).
  const CHIP_FILL: Record<string, string> = {
    normal: '#16a34a', abnormal: '#e11d48', critical: '#9f1239', indeterminate: '#94a3b8', none: '#e2e8f0',
  };
  const CHIP_TEXT: Record<string, string> = {
    normal: '#ffffff', abnormal: '#ffffff', critical: '#ffffff', indeterminate: '#ffffff', none: '#334155', // BODY_TEXT
  };
  const TEXT_COLOR: Record<string, string> = {
    normal: '#166534', abnormal: '#b91c1c', critical: '#9f1239', indeterminate: '#475569', none: '#334155', // BODY_TEXT
  };
  const STATUSES = Object.keys(CHIP_FILL);

  it.each(STATUSES)('paints the "%s" fill chip and its chip-text colour', async (status) => {
    const resolved = new Map<string, ResolvedTable>([['t', {
      columns: [{ key: 'res', label: 'Result' }],
      rows: [{ res: 'v', s: status }],
    }]]);
    const pdf = await renderReportDesignPdf(
      statusDesign([{ key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }]), resolved);
    const content = decodedContent(pdf);
    expect(content).toContain(fillOp(CHIP_FILL[status]));
    expect(content).toContain(fillOp(CHIP_TEXT[status]));
  });

  it.each(STATUSES)('tints the "%s" value with STATUS_TEXT_COLOR under the default (text) emphasis', async (status) => {
    const resolved = new Map<string, ResolvedTable>([['t', {
      columns: [{ key: 'res', label: 'Result' }],
      rows: [{ res: 'v', s: status }],
    }]]);
    const pdf = await renderReportDesignPdf(
      statusDesign([{ key: 'res', label: 'Result', statusKey: 's' }]), resolved);
    const content = decodedContent(pdf);
    expect(content).toContain(fillOp(TEXT_COLOR[status]));
  });
});

describe('zebra-stripe fill tracking', () => {
  it('repaints BODY_TEXT before a zebra-striped row\'s text, not the leftover zebra colour (plain table, no statusKey)', async () => {
    // pdfkit's `rect(...).fill(color)` changes the doc's ACTUAL fill colour as a side effect (that
    // is how it paints), so `drawGrid`'s `lastFill` cache must be updated at the zebra-band call
    // site too — not just inside `setFill` — or the next `setFill(BODY_TEXT)` for that row's text
    // compares against a stale cached value, wrongly concludes nothing changed, and skips the colour
    // op. The text is then painted in whatever colour is still actually active on the doc (the
    // zebra fill), on top of a band of that same colour: invisible text on every other row of every
    // table. This is a plain, unbound table with no `statusKey` — the bug affects ALL tables, not
    // just ones using cell status.
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 300, h: 200 },
        columns: ['A', 'B'],
        rows: [['r0a', 'r0b'], ['r1a', 'r1b'], ['r2a', 'r2b'], ['r3a', 'r3b']] },
    ] }] });
    const pdf = await renderReportDesignPdf(design, new Map(), { now: NOW });
    const content = decodedContent(pdf);

    // Row index 1 is the first zebra-striped row: y = r.y(0) + ROW_H(16) + 1 * ROW_H(16) = 32.
    // r.w is the full table width (300px -> 225pt), since the zebra band spans the whole row.
    const zebraRect = `${pdfNum(0)} ${pdfNum(32)} ${pdfNum(225)} 16 re`;
    const zebraFill = fillOp('#f8fafc'); // ZEBRA_FILL
    const bodyFill = fillOp('#334155'); // BODY_TEXT
    expect(content).toContain(`${zebraRect}\n/DeviceRGB cs\n${zebraFill}\nf\n/DeviceRGB cs\n${bodyFill}\n`);
  });
});
