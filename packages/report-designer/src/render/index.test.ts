import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import PDFDocument from 'pdfkit';
import { renderReportDesignPdf, type ResolvedTable } from './index';
import { columnWidths, HEAD_LINE_H, STACKED_HEAD_H, ROW_H } from './draw';
import { encodeCode128, encodeQr, QR_QUIET_ZONE } from '../encode';
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
/**
 * Every text run drawn in the PDF, decoded.
 *
 * ⚠ A plain string NEVER appears in a content stream, and neither does its hex — pdfkit splits a run
 * at every kerning pair, so "Surname" is emitted as `[<537572> -25 <6e616d65> 0] TJ` ("Sur", kern,
 * "name"). Assertions must therefore rejoin the `<...>` chunks WITHIN one `TJ` array before
 * comparing; hex-encoding the whole expected string and searching for it silently fails on any word
 * that happens to contain a kerning pair.
 */
function pdfTexts(pdf: Buffer): string[] {
  return textsOf(decodedContent(pdf));
}

/** The same decoding applied to ONE already-decompressed content stream, so a per-page assertion
 *  can say what that page draws rather than what the document draws somewhere. */
function textsOf(content: string): string[] {
  return [...content.matchAll(/\[(.*?)\]\s*TJ/g)].map((m) =>
    [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)]
      .map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
}

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
  id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', status: 'draft', parameters: [],
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
    // The chip is INSET inside its cell (CHIP_INSET_X 1, CHIP_INSET_Y 1.5) so two adjacent rows
    // sharing a status do not paint touching rectangles and merge into one slab.
    const expectedX = widths[0] + 1; // res is column index 1; rect.x is 0; + inset
    const expectedW = widths[1] - 2;
    const expectedY = 16 + 1.5; // r.y(0) + ROW_H(16) + row 0 * ROW_H, + inset
    const expectedH = 16 - 3;   // ROW_H less the inset top and bottom — still strictly inside a row

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

    const expectedRect = `${pdfNum(expectedX)} ${pdfNum(expectedY)} ${pdfNum(expectedW)} ${pdfNum(expectedH)} re`;
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

describe('keyvalue panel rendering', () => {
  const kvDesign = (over: Partial<import('../schema').DesignElement> = {}): ReportDesign => ({
    id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', status: 'draft', parameters: [],
    pages: [{ id: 'p', elements: [{
      id: 'k', kind: 'keyvalue', name: 'K', rect: { x: 0, y: 0, w: 400, h: 200 },
      dataSource: { kind: 'custom-query', queryId: 'q' },
      boundColumns: [{ key: 'sn', label: 'Surname' }, { key: 'sex', label: 'Sex' }],
      ...over,
    }] }],
  } as ReportDesign);
  const kvRows = (): Map<string, ResolvedTable> => new Map([['k', {
    columns: [], rows: [{ sn: 'MWASEKAGA', sex: 'M', st: 'abnormal' }],
  }]]);

  it('draws every label and its row-0 value, and no header band', async () => {
    const pdf = await renderReportDesignPdf(kvDesign(), kvRows(), { now: NOW });
    const texts = pdfTexts(pdf);
    for (const s of ['Surname', 'MWASEKAGA', 'Sex']) expect(texts).toContain(s);
    // A table would paint its header band; a keyvalue panel has no header row at all.
    expect(decodedContent(pdf)).not.toContain(fillOp('#eef2f6'));
  });

  it('puts an inline label and its value on ONE baseline, and a stacked value below its label', async () => {
    const inline = textYs(await renderReportDesignPdf(kvDesign({ layout: 'inline' }), kvRows(), { now: NOW }));
    const stacked = textYs(await renderReportDesignPdf(kvDesign({ layout: 'stacked' }), kvRows(), { now: NOW }));
    // inline: label and value share a y, so 2 pairs → 2 distinct ys. stacked: 4.
    expect(new Set(inline).size).toBe(2);
    expect(new Set(stacked).size).toBe(4);
  });

  it('draws the title band only when the element carries title text', async () => {
    const withoutTitle = await renderReportDesignPdf(kvDesign(), kvRows(), { now: NOW });
    const withTitle = await renderReportDesignPdf(kvDesign({ text: 'PATIENT' }), kvRows(), { now: NOW });
    // ⚠ Assert on the BAND RECT, not on `fillOp('#334155')`: the title fill happens to be the same
    // colour as `BODY_TEXT`, so the colour operator is present either way and a colour-only
    // assertion passes on a panel that draws no band at all. The panel is 400px wide → 300pt, and
    // the band is ROW_H tall.
    const band = '0 0 300 16 re';
    expect(decodedContent(withoutTitle)).not.toContain(band);
    expect(decodedContent(withTitle)).toContain(band);
    expect(pdfTexts(withTitle)).toContain('PATIENT');
  });

  it('paints a chip only for fill emphasis on a recognised token, sized to the value not the pair', async () => {
    const plain = decodedContent(await renderReportDesignPdf(
      kvDesign({ boundColumns: [{ key: 'sn', label: 'Surname' }] }), kvRows(), { now: NOW }));
    const chipped = decodedContent(await renderReportDesignPdf(
      kvDesign({ boundColumns: [{ key: 'sn', label: 'Surname', statusKey: 'st', emphasis: 'fill' }] }), kvRows(), { now: NOW }));
    expect(plain).not.toContain(fillOp('#e11d48'));
    expect(chipped).toContain(fillOp('#e11d48'));
    // The chip must be narrower than the value box (300pt panel, 1 column, ~180pt of value area) —
    // a full-width bar is the defect this sizing exists to avoid.
    // ⚠ The element also emits a CLIP rect spanning the whole panel, which would otherwise be the
    // widest match every time. A clip is `re` followed by `W n`; a fill is `re` followed by the
    // colour operators and then `f`, so the negative lookahead — not an `f` match — is what
    // separates them.
    const filled = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re\n(?!W n)/g;
    const widths = [...chipped.matchAll(filled)].map((m) => parseFloat(m[3]));
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.max(...widths)).toBeLessThan(120);
  });

  it('draws the error placeholder for a failed query, as a bound table does', async () => {
    const content = decodedContent(await renderReportDesignPdf(
      kvDesign(), new Map([['k', { error: 'boom' }]]), { now: NOW }));
    expect(content).toContain(fillOp('#fef2f2'));
  });

  it('keeps the labels visible when the query returns no rows', async () => {
    const pdf = await renderReportDesignPdf(kvDesign(), new Map([['k', { columns: [], rows: [] }]]), { now: NOW });
    expect(pdfTexts(pdf)).toContain('Surname');
  });

  it('never paginates: a panel with more pairs than fit stays on one page', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, label: `L${i}` }));
    const rows = new Map<string, ResolvedTable>([['k', { columns: [], rows: [Object.fromEntries(many.map((c) => [c.key, 'v']))] }]]);
    const pdf = await renderReportDesignPdf(kvDesign({ boundColumns: many, rect: { x: 0, y: 0, w: 400, h: 60 } }), rows, { now: NOW });
    expect(pdf.toString('latin1')).toMatch(/\/Count 1/);
  });
});

describe('barcode and qrcode rendering', () => {
  const VALUE = 'TZ00123/26';
  const symDesign = (el: Partial<import('../schema').DesignElement>): ReportDesign => ({
    id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', status: 'draft', parameters: [],
    pages: [{ id: 'p', elements: [{
      id: 's', kind: 'barcode', name: 'S', rect: { x: 0, y: 0, w: 400, h: 60 }, ...el,
    } as import('../schema').DesignElement] }],
  } as ReportDesign);
  // FILLED rects only. Three different things emit `re` here and the test means exactly one of
  // them: a fill (`re` then the colour operators then `f`), the element's own full-box CLIP
  // (`re` + `W n`), and the unencodable placeholder's dashed OUTLINE (`re` + `S`). Counting the
  // last two as bars is how "drew nothing" and "drew a box" both look like "drew one bar".
  const fillRects = (pdf: Buffer) =>
    [...decodedContent(pdf).matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re\n(?!W n|S\n)/g)]
      .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));

  it('draws one rect per RUN of bars, not one per module', async () => {
    const bars = encodeCode128(VALUE)!;
    let runs = 0;
    for (let i = 0; i < bars.length; i += 1) if (bars[i] && !bars[i - 1]) runs += 1;
    const rects = fillRects(await renderReportDesignPdf(symDesign({ text: VALUE }), new Map(), { now: NOW }));
    // Merging matters twice over: 145 modules would otherwise cost 145 operators, and adjacent
    // fractional-width rects can leave hairline seams a scanner reads as extra bars.
    expect(rects).toHaveLength(runs);
    expect(runs).toBeLessThan(bars.length);
  });

  it('scales the bars to fill the box width exactly', async () => {
    const bars = encodeCode128(VALUE)!;
    const rects = fillRects(await renderReportDesignPdf(symDesign({ text: VALUE }), new Map(), { now: NOW }));
    const mw = 300 / bars.length; // 400px box → 300pt
    expect(rects[0].x).toBeCloseTo(0, 4);
    const last = rects[rects.length - 1];
    expect(last.x + last.w).toBeCloseTo(300, 3);
    expect(rects[0].w / mw).toBeCloseTo(Math.round(rects[0].w / mw), 4); // a whole number of modules
  });

  it('reserves the caption strip only when the caption is on', async () => {
    const withCap = fillRects(await renderReportDesignPdf(symDesign({ text: VALUE }), new Map(), { now: NOW }));
    const noCap = fillRects(await renderReportDesignPdf(symDesign({ text: VALUE, caption: false }), new Map(), { now: NOW }));
    expect(noCap[0].h).toBeGreaterThan(withCap[0].h);
    expect(noCap[0].h).toBeCloseTo(45, 4); // 60px box → 45pt, bars take all of it
    expect(pdfTexts(await renderReportDesignPdf(symDesign({ text: VALUE }), new Map(), { now: NOW }))).toContain(VALUE);
    expect(pdfTexts(await renderReportDesignPdf(symDesign({ text: VALUE, caption: false }), new Map(), { now: NOW }))).not.toContain(VALUE);
  });

  it('interpolates {{param.x}} into the encoded value, as a text element would', async () => {
    const design = symDesign({ text: '{{param.lab}}' });
    design.parameters = [{ key: 'lab', label: 'Lab', type: 'text', value: VALUE }];
    // Encoding the LITERAL "{{param.lab}}" would still produce a valid-looking barcode — which is
    // exactly the failure this pins: it would scan, to the wrong thing.
    expect(pdfTexts(await renderReportDesignPdf(design, new Map(), { now: NOW }))).toContain(VALUE);
  });

  it('reserves a 4-module quiet zone on every side of a QR', async () => {
    const pdf = await renderReportDesignPdf(
      symDesign({ kind: 'qrcode', text: VALUE, rect: { x: 0, y: 0, w: 100, h: 100 } }), new Map(), { now: NOW });
    const rects = fillRects(pdf);
    const n = encodeQr(VALUE)!.length;
    const pitch = 75 / (n + QR_QUIET_ZONE * 2); // 100px → 75pt
    expect(rects.every((r) => Math.abs(r.h - pitch) < 1e-6)).toBe(true);
    // The top-left finder is dark at module 0,0, so the first dark pixel sits exactly the quiet
    // zone in. A regression that drops the margin still LOOKS right on a white page.
    expect(Math.min(...rects.map((r) => r.x)) / pitch).toBeCloseTo(QR_QUIET_ZONE, 4);
    expect(Math.min(...rects.map((r) => r.y)) / pitch).toBeCloseTo(QR_QUIET_ZONE, 4);
  });

  it('draws the dashed placeholder instead of throwing when a value cannot encode', async () => {
    for (const el of [{ text: '' }, { text: 'aemol/læ' }, { kind: 'qrcode' as const, text: '' }]) {
      const pdf = await renderReportDesignPdf(symDesign(el), new Map(), { now: NOW });
      // `[3 2] 0 d` is pdfkit's dash operator — the same placeholder an `image` with no usable
      // source draws, so "nothing to show" looks identical wherever it happens.
      expect(decodedContent(pdf)).toContain('[3 2] 0 d');
      // ...and nothing was FILLED: a half-drawn symbol would scan as a wrong value.
      expect(fillRects(pdf)).toHaveLength(0);
    }
  });

  it('encodes boundColumns[0] of row 0 for a bound symbol', async () => {
    const design = symDesign({
      dataSource: { kind: 'custom-query', queryId: 'q' },
      boundColumns: [{ key: 'lab', label: 'Lab number' }, { key: 'ignored', label: 'Other' }],
    });
    const resolved = new Map<string, ResolvedTable>([['s', {
      columns: [], rows: [{ lab: VALUE, ignored: 'NOT-THIS' }, { lab: 'SECOND-ROW' }],
    }]]);
    const texts = pdfTexts(await renderReportDesignPdf(design, resolved, { now: NOW }));
    expect(texts).toContain(VALUE);
    expect(texts).not.toContain('NOT-THIS');
    expect(texts).not.toContain('SECOND-ROW');
  });
});

describe('renderReportDesignPdf prefers RUN parameter values over the design defaults', () => {
  // The design's authored default (2000-*) is deliberately DIFFERENT from the run values (2026-*):
  // if the render path silently fell back to the design default, the "not contain 2000-*"
  // assertions would catch it, whereas a design whose default equalled the run value would let a
  // reverted wiring change pass by coincidence.
  const paramDesign = (): ReportDesign => ({
    id: 'd', name: 'N', paper: 'A4', orientation: 'portrait',
    parameters: [{ key: 'dateRange', label: 'Range', type: 'daterange',
      value: { from: '2000-01-01', to: '2000-12-31' } }],
    pages: [{ id: 'p', elements: [
      { id: 'txt', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 400, h: 20 },
        text: 'Period: {{param.from}} to {{param.to}}' },
    ] }],
  } as ReportDesign);

  it('renders the flat from/to the run supplies, not the design default', async () => {
    const texts = pdfTexts(await renderReportDesignPdf(paramDesign(), new Map(), {
      now: NOW, values: { from: '2026-01-01', to: '2026-03-31' },
    }));
    // Reformatted for the page, not left as raw ISO — draw.ts now routes from/to through
    // `formatDisplayDate`, so the rendered text is '1 Jan 2026', not '2026-01-01'.
    expect(texts.some((t) => t.includes('1 Jan 2026') && t.includes('31 Mar 2026'))).toBe(true);
    expect(texts.join('')).not.toContain('1 Jan 2000');
    expect(texts.join('')).not.toContain('31 Dec 2000');
  });

  it('interpolates an UNBOUND keyvalue pair with the run value too, not the literal token', async () => {
    const design: ReportDesign = {
      ...paramDesign(),
      pages: [{ id: 'p', elements: [
        { id: 'k', kind: 'keyvalue', name: 'K', rect: { x: 0, y: 0, w: 400, h: 60 },
          rows: [['Reporting period', '{{param.from}} to {{param.to}}']] },
      ] }],
    } as ReportDesign;
    const texts = pdfTexts(await renderReportDesignPdf(design, new Map(), {
      now: NOW, values: { from: '2026-01-01', to: '2026-03-31' },
    }));
    expect(texts.some((t) => t.includes('1 Jan 2026') && t.includes('31 Mar 2026'))).toBe(true);
    expect(texts.join('')).not.toContain('{{param.from}}');
    expect(texts.join('')).not.toContain('1 Jan 2000');
  });
});

describe('letterhead identity rendering', () => {
  const headerDesign = (): ReportDesign => ({
    id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', status: 'draft', parameters: [],
    pages: [{ id: 'p', elements: [
      { id: 'logo', kind: 'image', name: 'Logo', rect: { x: 0, y: 0, w: 60, h: 60 }, src: '{{lab.logo}}' },
      { id: 'nm', kind: 'text', name: 'Name', rect: { x: 70, y: 0, w: 400, h: 20 }, text: '{{lab.name}}' },
      { id: 'ad', kind: 'text', name: 'Addr', rect: { x: 70, y: 22, w: 400, h: 30 }, text: '{{lab.address}}' },
    ] }],
  } as ReportDesign);
  // 1x1 PNG — enough to prove the data URI reached pdfkit, which is all the renderer owes us.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('renders the configured identity', async () => {
    const texts = pdfTexts(await renderReportDesignPdf(headerDesign(), new Map(), {
      now: NOW, identity: { name: 'Muhimbili National Referral Laboratory', address: 'PO Box 65000' },
    }));
    expect(texts).toContain('Muhimbili National Referral Laboratory');
    expect(texts).toContain('PO Box 65000');
  });

  it('⛔ renders BLANK, never the literal token, on an unconfigured install', async () => {
    // The failure this pins: a design shipped with {{lab.name}} printing braces onto a clinical
    // report. Asserting "the line exists" would pass on exactly that bug — assert the ABSENCE of
    // braces and the ABSENCE of the token text.
    const texts = pdfTexts(await renderReportDesignPdf(headerDesign(), new Map(), { now: NOW }));
    expect(texts.join('')).not.toContain('{{');
    expect(texts.join('')).not.toContain('lab.name');
  });

  it('resolves a token image src to the configured logo, and placeholders when unset', async () => {
    const withLogo = decodedContent(await renderReportDesignPdf(headerDesign(), new Map(), { now: NOW, identity: { logo: PNG } }));
    const without = decodedContent(await renderReportDesignPdf(headerDesign(), new Map(), { now: NOW }));
    // pdfkit emits an XObject Do for a drawn image; the dashed placeholder emits the dash operator.
    expect(withLogo).toMatch(/\/I\d+ Do/);
    expect(without).not.toMatch(/\/I\d+ Do/);
    expect(without).toContain('[3 2] 0 d');
  });

  it('does not throw when the logo is a URL — it placeholders, which is why write-time validation exists', async () => {
    const content = decodedContent(await renderReportDesignPdf(headerDesign(), new Map(), {
      now: NOW, identity: { logo: 'https://example.org/logo.png' },
    }));
    expect(content).toContain('[3 2] 0 d');
  });
});

// ---------------------------------------------------------------------------------------------
// `headerRow` and `showWithTable`, end to end through a real PDF
// ---------------------------------------------------------------------------------------------

describe('a table whose header is its first data row', () => {
  /** 3 day columns; box h = 100px = 75pt → floor((75-24)/16) = 3 body rows per chunk. */
  const gridDesign = (): ReportDesign => baseDesign({
    orientation: 'landscape',
    pages: [{ id: 'p1', elements: [
      { id: 'head', kind: 'text', name: 'H', rect: { x: 10, y: 10, w: 400, h: 14 }, text: 'Submission by laboratory', showWithTable: 'g' },
      { id: 'g', kind: 'table', name: 'G', rect: { x: 10, y: 30, w: 400, h: 100 },
        dataSource: { kind: 'custom-query', queryId: 'q' }, sortBy: 'ord', headerRow: true,
        boundColumns: [
          { key: 'lab', label: 'Laboratory' }, { key: 'd01', label: '' },
          { key: 'd02', label: '' }, { key: 'd03', label: '' },
        ] as BoundColumn[] },
    ] }],
  });

  const gridRows = (n: number): ResolvedTable => ({
    columns: [{ key: 'ord', label: 'ord' }, { key: 'lab', label: 'lab' },
      { key: 'd01', label: 'd01' }, { key: 'd02', label: 'd02' }, { key: 'd03', label: 'd03' }],
    // ⚠ The dates come FIRST here because `sortBy` has ALREADY run: the renderer is handed rows
    // that `resolveDesignTables` ordered, and `headerRow` lifts row 0 of what it is given. An
    // unsorted fixture would be testing the sort, which lives in `resolve.ts` and is tested there.
    rows: [
      { ord: 0, lab: '(dates)', d01: '1\nFeb', d02: '2\nFeb', d03: '3\nFeb' },
      ...Array.from({ length: n }, (_, i) => ({ ord: 1, lab: `Laboratory ${i}`, d01: 'Y', d02: '', d03: 'Y' })),
    ],
  });

  it('⛔ repeats the dates on EVERY page, and never prints them as a body row', async () => {
    // The defect this pins: the dates were an ordinary row, so page 2 showed marks under blank
    // columns and a reader could not tell which day any mark belonged to.
    const buf = await renderReportDesignPdf(gridDesign(), new Map([['g', gridRows(7)]]), { now: NOW });
    const pages = pageContents(buf).map(textsOf);
    expect(pages).toHaveLength(3); // ceil(7/3)
    for (const texts of pages) {
      expect(texts).toContain('Feb');           // the month, stacked under its day number
      expect(texts).toContain('Laboratory');    // the declared label survives the lift
      expect(texts).not.toContain('(dates)');   // the header row's own lab value never prints
    }
  });

  it('puts the laboratories of chunk 2 on page 2 and none of chunk 1', async () => {
    const buf = await renderReportDesignPdf(gridDesign(), new Map([['g', gridRows(7)]]), { now: NOW });
    const pages = pageContents(buf).map(textsOf);
    expect(pages[0]).toEqual(expect.arrayContaining(['Laboratory 0', 'Laboratory 1', 'Laboratory 2']));
    expect(pages[1]).toEqual(expect.arrayContaining(['Laboratory 3', 'Laboratory 4', 'Laboratory 5']));
    expect(pages[1]).not.toContain('Laboratory 0');
    expect(pages[2]).toEqual(['Submission by laboratory', 'Laboratory', '1', 'Feb', '2', 'Feb', '3', 'Feb', 'Laboratory 6', 'Y', 'Y']);
  });

  it('stacks the two header lines HEAD_LINE_H apart, and drops the body by the taller band', async () => {
    // Baselines, not absolute positions: what this must pin is the PITCH between the two header
    // lines and between the band and the first row. An absolute y would additionally encode
    // pdfkit's ascender, which is a font fact and not this renderer's decision.
    const buf = await renderReportDesignPdf(gridDesign(), new Map([['g', gridRows(2)]]), { now: NOW });
    const ys = [...new Set(textYs(buf))].sort((a, b) => b - a);
    // ⛔ LITERAL POINTS, not the constants the drawing reads. Asserting `HEAD_LINE_H` against a
    // pitch computed from `HEAD_LINE_H` passes for every value of it — measured: changing the
    // constant to 9 left this test green until the literals went in.
    // 8pt is the reference document's own day-to-month gap (y=744 and y=736); 24 = 16 + 8.
    // [0] is the heading above the box; [1] header line 1; [2] header line 2; [3] first body row.
    expect(ys[1] - ys[2]).toBeCloseTo(8, 6);
    expect(ys[1] - ys[3]).toBeCloseTo(24, 6);
    expect(ys[3] - ys[4]).toBeCloseTo(16, 6);
    // ...and the constants themselves are those numbers, so the two can never drift apart.
    expect([HEAD_LINE_H, STACKED_HEAD_H, ROW_H]).toEqual([8, 24, 16]);
  });

  it('drops the whole grid AND its heading from a page the grid does not reach', async () => {
    // Two tables on one page: the page runs as long as the longer one.
    const design = baseDesign({ orientation: 'landscape', pages: [{ id: 'p1', elements: [
      ...gridDesign().pages[0].elements,
      { id: 'long', kind: 'table', name: 'L', rect: { x: 10, y: 200, w: 400, h: 100 },
        dataSource: { kind: 'custom-query', queryId: 'q2' }, headerRow: true,
        boundColumns: [{ key: 'lab', label: 'Other laboratory' }] as BoundColumn[] },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([
      ['g', gridRows(2)], // 1 chunk
      ['long', { columns: [{ key: 'lab', label: 'lab' }], rows: Array.from({ length: 8 }, (_, i) => ({ lab: `Other ${i}` })) }], // 3 chunks
    ]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    const pages = pageContents(buf);
    const texts = pages.map(textsOf);
    expect(pages).toHaveLength(3);
    expect(texts[0]).toContain('Submission by laboratory');
    // Pages 2 and 3 carry neither the heading nor an empty framed box under it.
    expect(texts[1]).not.toContain('Submission by laboratory');
    expect(texts[2]).not.toContain('Submission by laboratory');
    expect(texts[1]).not.toContain('Laboratory');
    // ⛔ Not just the text — the BOX is gone too. The header band is the only `#eef2f6` fill on the
    // page, so counting it counts grids drawn.
    expect(pages[0].split(fillOp('#eef2f6')).length - 1).toBe(2); // both grids
    expect(pages[1].split(fillOp('#eef2f6')).length - 1).toBe(1); // only the long one
    // ...while the longer table is still drawing.
    expect(texts[1]).toContain('Other 4');
  });
});
