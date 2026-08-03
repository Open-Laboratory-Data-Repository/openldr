import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import PDFDocument from 'pdfkit';
import {
  renderReportPdf, columnWidths, isNumericColumn, isRightAligned, asCellStatus, cellStatusesFor,
} from './index';

describe('renderReportPdf', () => {
  it('produces a PDF buffer with the %PDF header', async () => {
    const buf = await renderReportPdf({
      title: 'AMR First-Isolate Summary', generatedAt: '2026-06-14T00:00:00Z', params: { from: '2026-01-01' },
      columns: [{ key: 'pathogen', label: 'Pathogen' }, { key: 'percentR', label: '%R' }],
      rows: [{ pathogen: 'eco', percentR: 50 }, { pathogen: 'kpn', percentR: 100 }],
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(500);
  });
  it('handles zero rows', async () => {
    const buf = await renderReportPdf({ title: 'Empty', generatedAt: '2026-06-14T00:00:00Z', params: {}, columns: [{ key: 'a', label: 'A' }], rows: [] });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders a status-filled column without changing the row pitch', async () => {
    const rows = [
      { test: 'HIV 1/2 Ab', res: 'Negative', s: 'normal' },
      { test: 'HBsAg', res: 'Positive', s: 'abnormal' },
    ];
    const plain = await renderReportPdf({
      title: 'T', generatedAt: 'now', params: {},
      columns: [{ key: 'test', label: 'Test' }, { key: 'res', label: 'Result' }], rows,
    });
    const filled = await renderReportPdf({
      title: 'T', generatedAt: 'now', params: {},
      columns: [{ key: 'test', label: 'Test' },
                { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }], rows,
    });
    expect(filled.length).toBeGreaterThan(plain.length);
  });
});

/** Text baselines, in PDF user space, parsed out of the (deflated) content streams.
 *  pdfkit emits `1 0 0 1 <x> <y> Tm` before each run — verified against pdfkit 0.15.x (same
 *  idiom as `report-designer`'s `render/index.test.ts`, which measured this against the exact
 *  version pinned in this monorepo). */
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

/** The `/DeviceRGB cs\n<r> <g> <b> scn` operator pdfkit emits for a `fillColor(hex)` call —
 *  computed from the hex, not copied from a captured sample, so the assertion documents its own
 *  derivation instead of pinning a magic string. */
function fillOp(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return `${r} ${g} ${b} scn`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** pdfkit rounds every content-stream coordinate to 6 decimal places (`PDFObject.number`,
 *  `Math.round(n * 1e6) / 1e6`, pdfkit 0.15.x) before printing it into a `re`/`m`/`l` operator —
 *  same measurement as `report-designer`'s equivalent helper. Numbers computed in the test (e.g. by
 *  summing widths ourselves) must be rounded the same way before comparing against the stream. */
function pdfNum(n: number): number { return Math.round(n * 1e6) / 1e6; }

const statusRows = [
  { test: 'HIV 1/2 Ab', res: 'Negative', s: 'normal' },
  { test: 'HBsAg', res: 'Positive', s: 'abnormal' },
  { test: 'Treponema pallidum antibody screen', res: 'Indeterminate', s: 'indeterminate' },
];

describe('cell status rendering', () => {
  it('does not move a single text baseline when a filled status column is added', async () => {
    const plain = await renderReportPdf({
      title: 'T', generatedAt: 'now', params: {},
      columns: [{ key: 'test', label: 'Test' }, { key: 'res', label: 'Result' }], rows: statusRows,
    });
    const filled = await renderReportPdf({
      title: 'T', generatedAt: 'now', params: {},
      columns: [{ key: 'test', label: 'Test' },
                { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }], rows: statusRows,
    });
    expect(textYs(filled)).toEqual(textYs(plain));
  });

  it('keeps every body row exactly ROW_H apart with a long value in a filled cell', async () => {
    // The long value lives in `res` — the FILLED column — not `test`, so this exercises the
    // wrap-vs-ellipsis regression `cellTextOptions`'s docblock warns about: dropping `height` from
    // that function wraps this value onto a second line inside its fixed-height row. The title,
    // subtitle, header row and footer all draw text too, at unrelated y-positions, so this isolates
    // ONLY the `res` column's own text runs (by x-coordinate — every row's `res` cell starts at the
    // same x) rather than assuming the N smallest/largest y's in the whole document are body rows.
    const longVal = 'Methicillin-resistant Staphylococcus aureus screen POSITIVE result, confirmed by repeat testing on a second specimen collected the following day';
    const rows = [
      { test: 'HIV 1/2 Ab', res: 'Negative', s: 'normal' },
      { test: 'HBsAg', res: longVal, s: 'abnormal' },
      { test: 'Treponema pallidum antibody screen', res: 'Indeterminate', s: 'indeterminate' },
    ];
    const pdf = await renderReportPdf({
      title: 'T', generatedAt: 'now', params: {},
      columns: [{ key: 'test', label: 'Test' },
                { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }], rows,
    });
    const content = decodedContent(pdf);
    // Anchor on the header's own "Result" label to find the column's x — dynamically, not hardcoded.
    const headerTextMatch = content.match(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\n\/F\d \d+ Tf\n\[<526573756c74> 0\] TJ/);
    expect(headerTextMatch).not.toBeNull();
    const [, resX] = headerTextMatch as RegExpMatchArray;
    const tmAtResX = new RegExp(`1 0 0 1 ${escapeRe(resX)} (-?[\\d.]+) Tm`, 'g');
    const ys: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = tmAtResX.exec(content))) ys.push(parseFloat(m[1]));
    ys.sort((a, b) => b - a); // largest (header) first, down to the last body row
    // Exactly 4 runs at this x: the header label + 3 body values. A wrapped second line would add a
    // 5th run at the SAME x, which both this count check and the gap check below would catch.
    expect(ys.length).toBe(4);
    const gaps = ys.slice(1).map((y, i) => Number((ys[i] - y).toFixed(3)));
    expect(gaps).toEqual([18, 16, 16]); // header→row0 leaves drawHeader's extra 2pt; then ROW_H apart
  });

  it('emits no status fill colour anywhere when no column declares a statusKey, even if emphasis is "fill"', async () => {
    // `res` asks for a fill chip but has no `statusKey` to read from — the renderer must never
    // paint a chip it has no status for. Declaring `emphasis: 'fill'` here (rather than omitting it,
    // as a plain column would) is what makes this catch a dropped `st &&` guard: without it, both
    // sides of `st && emphasis === 'fill'` are already false for an unrelated reason, and the
    // assertion below would pass regardless of whether the guard on `st` exists.
    const columns = [{ key: 'test', label: 'Test' }, { key: 'res', label: 'Result', emphasis: 'fill' as const }];
    const plain = await renderReportPdf({ title: 'T', generatedAt: 'now', params: {}, columns, rows: statusRows });
    const content = decodedContent(plain);
    // None of the five status chip colours may appear when no column carries a statusKey — a
    // byte-length comparison against a "filled" render passes on any extra byte at all, including
    // the wrong colour, the wrong column, or a chip on every cell.
    for (const hex of ['#16a34a', '#e11d48', '#9f1239', '#94a3b8', '#e2e8f0']) {
      expect(content).not.toContain(fillOp(hex));
    }
    // Colour-agnostic belt-and-braces: a dropped `st &&` guard paints a column-width chip rect in
    // whatever fill colour happens to still be active on the doc (not necessarily one of the five
    // status hexes above, e.g. it can reuse BODY_TEXT) — so also assert NO rect this narrow exists
    // at all. The header/zebra bands are always the FULL table width, never a single column's.
    const measureDoc = new PDFDocument({ autoFirstPage: false });
    const cells = statusRows.map((r) => [r.test, r.res]);
    const headerRe = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) 16 re\n\/DeviceRGB cs\n0\.9333333333333333 0\.9490196078431372 0\.9647058823529412 scn\nf/;
    const headerMatch = content.match(headerRe);
    expect(headerMatch).not.toBeNull();
    const headerW = Number((headerMatch as RegExpMatchArray)[3]);
    const widths = columnWidths(['Test', 'Result'], cells, headerW, (text, bold) => {
      measureDoc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      return measureDoc.widthOfString(text);
    });
    const rectAtChipWidth = new RegExp(`-?[\\d.]+ -?[\\d.]+ ${escapeRe(String(pdfNum(widths[1])))} 16 re`);
    expect(content).not.toMatch(rectAtChipWidth);
  });

  it('paints the fill chip exactly on the status column band, ROW_H tall, in the status colour', async () => {
    const columns = [{ key: 'test', label: 'Test' },
                      { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' as const }];
    const rows = [{ test: 'HBsAg', res: 'Positive', s: 'critical' }];
    const pdf = await renderReportPdf({ title: 'T', generatedAt: 'now', params: {}, columns, rows });
    const content = decodedContent(pdf);

    // Recover the header band's rect from the SAME render (rather than hand-computing title/margin
    // metrics), so the geometry check derives entirely from pdfkit's own output.
    const headerRe = new RegExp(`(-?[\\d.]+) (-?[\\d.]+) (-?[\\d.]+) 16 re\\n/DeviceRGB cs\\n${escapeRe(fillOp('#eef2f6'))}\\nf`);
    const headerMatch = content.match(headerRe);
    expect(headerMatch).not.toBeNull();
    const [, hx, hy, hw] = headerMatch as RegExpMatchArray;
    const headerX = Number(hx);
    const headerY = Number(hy);
    const headerW = Number(hw);
    const bodyY = headerY + 16 + 2; // rowH + the 2pt gap `drawHeader` leaves below its rule

    // Recompute the same column widths the renderer computed, from the same headers/rows/width.
    const measureDoc = new PDFDocument({ autoFirstPage: false });
    const widths = columnWidths(['Test', 'Result'], [['HBsAg', 'Positive']], headerW, (text, bold) => {
      measureDoc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      return measureDoc.widthOfString(text);
    });
    const chipX = pdfNum(headerX + widths[0]);
    const chipW = pdfNum(widths[1]);

    const expectedRect = `${chipX} ${bodyY} ${chipW} 16 re`;
    const expectedFill = fillOp('#9f1239'); // STATUS_CHIP_FILL.critical
    // The rect, its fill colour, and the paint op must appear back-to-back — not just present
    // somewhere in the stream — so a wrong colour, wrong size, or wrong column all fail this.
    expect(content).toContain(`${expectedRect}\n/DeviceRGB cs\n${expectedFill}\nf`);
  });

  it('gives a `none` status a dark chip text colour, not the white used by every other status', async () => {
    // STATUS_CHIP_FILL.none (#e2e8f0) is near-white; white-on-white text (~1.15:1 contrast) is
    // effectively invisible. `none` must render with the same dark slate body text uses.
    const columns = [{ key: 'test', label: 'Test' },
                      { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' as const }];
    const rows = [{ test: 'CBC', res: 'Pending', s: 'none' }];
    const pdf = await renderReportPdf({ title: 'T', generatedAt: 'now', params: {}, columns, rows });
    const content = decodedContent(pdf);
    const chipFill = fillOp('#e2e8f0'); // STATUS_CHIP_FILL.none
    expect(content).toContain(`${chipFill}\nf\n/DeviceRGB cs\n${fillOp('#334155')}`); // dark slate (BODY_TEXT)
    expect(content).not.toContain(`${chipFill}\nf\n/DeviceRGB cs\n${fillOp('#ffffff')}`); // never white here
  });

  it('tints the value with STATUS_TEXT_COLOR under the default (omitted) emphasis, not a fill chip', async () => {
    const columns = [{ key: 'test', label: 'Test' }, { key: 'res', label: 'Result', statusKey: 's' }];
    const rows = [{ test: 'HBsAg', res: 'Positive', s: 'abnormal' }];
    const pdf = await renderReportPdf({ title: 'T', generatedAt: 'now', params: {}, columns, rows });
    const content = decodedContent(pdf);
    expect(content).toContain(fillOp('#b91c1c')); // STATUS_TEXT_COLOR.abnormal
    expect(content).not.toContain(fillOp('#e11d48')); // STATUS_CHIP_FILL.abnormal — no chip was drawn
  });

  it('repaints BODY_TEXT before a zebra-striped row\'s text, not the leftover zebra colour', async () => {
    // pdfkit's `rect(...).fill(color)` changes the doc's ACTUAL fill colour as a side effect — the
    // renderer's per-cell branch must set `fillColor` again for every cell, or a zebra-striped
    // row's text paints in the zebra band's colour on top of a band of that same colour: invisible
    // text. This is a PLAIN table with no `statusKey` — the bug would affect every table.
    const columns = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }];
    const rows = [
      { a: 'r0a', b: 'r0b' }, { a: 'r1a', b: 'r1b' }, { a: 'r2a', b: 'r2b' }, { a: 'r3a', b: 'r3b' },
    ];
    const pdf = await renderReportPdf({ title: 'T', generatedAt: 'now', params: {}, columns, rows });
    const content = decodedContent(pdf);
    const zebraFill = fillOp('#f8fafc'); // ZEBRA_FILL
    const bodyFill = fillOp('#334155'); // BODY_TEXT
    expect(content).toContain(`\n/DeviceRGB cs\n${zebraFill}\nf\n/DeviceRGB cs\n${bodyFill}\n`);
  });

  it('shows a status only on the row/column it was declared for, not adjacent cells', async () => {
    const columns = [{ key: 'test', label: 'Test' },
                      { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' as const }];
    const rows = [
      { test: 'r0', res: 'v0', s: 'normal' },
      { test: 'r1', res: 'v1', s: 'abnormal' },
      { test: 'r2', res: 'v2', s: 'critical' },
    ];
    const pdf = await renderReportPdf({ title: 'T', generatedAt: 'now', params: {}, columns, rows });
    const content = decodedContent(pdf);
    expect(content).toContain(fillOp('#16a34a')); // normal
    expect(content).toContain(fillOp('#e11d48')); // abnormal
    expect(content).toContain(fillOp('#9f1239')); // critical
    expect(content).not.toContain(fillOp('#94a3b8')); // indeterminate — no row uses it
  });
});

describe('renderReportPdf wires column.kind into alignment', () => {
  // `columnWidths` depends only on headers/rows, never `kind`, so both renders below get IDENTICAL
  // column geometry — any difference in a text run's x-position is attributable purely to the
  // alignment `isRightAligned` chose, which proves the renderer actually forwards `column.kind`
  // into it (rather than, say, calling `isRightAligned(cells, ci, undefined)` or falling back to
  // the old `isNumericColumn(cells, ci)` — both of those mutations leave every OTHER test green).
  it('renders an all-numeric column right-aligned by default, and left-aligned when kind is "units"', async () => {
    const rows = [{ v: '100' }, { v: '5' }];
    const base = { title: 'T', generatedAt: 'now', params: {}, rows };
    const rightAligned = await renderReportPdf({ ...base, columns: [{ key: 'v', label: 'V' }] });
    const leftAligned = await renderReportPdf({ ...base, columns: [{ key: 'v', label: 'V', kind: 'units' as const }] });

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
  // Only STATUS_TEXT_COLOR.abnormal is asserted anywhere else in this file. Because this palette is
  // a SANCTIONED duplicate of `@openldr/report-designer`'s `render/draw.ts` copy (see the docblock
  // above `CELL_STATUSES` in `../src/index.ts`), tests are the only thing keeping the two in step —
  // pin every entry here so a drift in any one of the 15 hex values fails loudly. Values verified
  // against `packages/report-designer/src/render/draw.ts` (not copied from this package's own
  // source, which would just pin the duplicate to itself).
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
    const columns = [{ key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' as const }];
    const rows = [{ res: 'v', s: status }];
    const pdf = await renderReportPdf({ title: 'T', generatedAt: 'now', params: {}, columns, rows });
    const content = decodedContent(pdf);
    expect(content).toContain(fillOp(CHIP_FILL[status]));
    expect(content).toContain(fillOp(CHIP_TEXT[status]));
  });

  it.each(STATUSES)('tints the "%s" value with STATUS_TEXT_COLOR under the default (text) emphasis', async (status) => {
    const columns = [{ key: 'res', label: 'Result', statusKey: 's' }];
    const rows = [{ res: 'v', s: status }];
    const pdf = await renderReportPdf({ title: 'T', generatedAt: 'now', params: {}, columns, rows });
    const content = decodedContent(pdf);
    expect(content).toContain(fillOp(TEXT_COLOR[status]));
  });
});

describe('cellStatusesFor', () => {
  it('is a grid of undefined when no column declares a statusKey', () => {
    const grid = cellStatusesFor(
      [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
      [{ a: 'normal', b: 'abnormal' }],
    );
    expect(grid).toEqual([[undefined, undefined]]);
  });

  it('parses a recognised token only under the declared statusKey column', () => {
    const grid = cellStatusesFor(
      [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', statusKey: 's' }],
      [{ a: 'x', b: 'y', s: 'critical' }],
    );
    expect(grid).toEqual([[undefined, 'critical']]);
  });

  it('leaves an unrecognised token as undefined', () => {
    const grid = cellStatusesFor(
      [{ key: 'a', label: 'A', statusKey: 's' }],
      [{ a: 'x', s: 'not-a-status' }],
    );
    expect(grid).toEqual([[undefined]]);
  });
});

describe('asCellStatus', () => {
  it('recognises every vocabulary token, trimmed and case-insensitively', () => {
    expect(asCellStatus('normal')).toBe('normal');
    expect(asCellStatus('ABNORMAL')).toBe('abnormal');
    expect(asCellStatus('  critical  ')).toBe('critical');
    expect(asCellStatus('Indeterminate')).toBe('indeterminate');
    expect(asCellStatus('none')).toBe('none');
  });
  it('returns undefined for an unrecognised string', () => {
    expect(asCellStatus('positive')).toBeUndefined();
  });
  it('returns undefined for non-string input', () => {
    expect(asCellStatus(42)).toBeUndefined();
    expect(asCellStatus(null)).toBeUndefined();
    expect(asCellStatus(undefined)).toBeUndefined();
  });
});

describe('isNumericColumn', () => {
  it('is true for a column of plain numbers', () => {
    expect(isNumericColumn([['1'], ['2.5'], ['-3']], 0)).toBe(true);
  });
  it('is false for text', () => {
    expect(isNumericColumn([['abc']], 0)).toBe(false);
  });
  it('is false for a value with trailing annotation ("0% (13)")', () => {
    expect(isNumericColumn([['0% (13)']], 0)).toBe(false);
  });
  it('is false for an age band ("5-14"), not a negative number', () => {
    expect(isNumericColumn([['5-14']], 0)).toBe(false);
  });
  it('is false when every value is blank (nothing seen)', () => {
    expect(isNumericColumn([[''], ['']], 0)).toBe(false);
  });
  it('ignores blanks mixed with numbers', () => {
    expect(isNumericColumn([['1'], [''], ['-2.5']], 0)).toBe(true);
  });
});

describe('isRightAligned', () => {
  const numericRows = [['1'], ['2'], ['3']];
  it('is true for a numeric column with no kind', () => {
    expect(isRightAligned(numericRows, 0, undefined)).toBe(true);
  });
  it('is true for a numeric column with kind "value"', () => {
    expect(isRightAligned(numericRows, 0, 'value')).toBe(true);
  });
  it('is false for a numeric column with kind "units", even though every value parses', () => {
    expect(isRightAligned(numericRows, 0, 'units')).toBe(false);
  });
  it('is false for a numeric column with kind "range", even though every value parses', () => {
    expect(isRightAligned(numericRows, 0, 'range')).toBe(false);
  });
  it('is false for a non-numeric column regardless of kind', () => {
    expect(isRightAligned([['abc']], 0, 'value')).toBe(false);
  });
});
