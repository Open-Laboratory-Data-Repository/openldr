import PDFDocument from 'pdfkit';

export interface PdfColumn {
  key: string;
  label: string;
  /** Name of ANOTHER column in the same row carrying a status token (see `CELL_STATUSES` below). */
  statusKey?: string;
  /** How a recognised status paints: `'fill'` = saturated chip with knocked-out text, `'text'`
   *  (default) = just tint the value. `'text'` is the default because it survives a mono printer. */
  emphasis?: 'fill' | 'text';
  /** Overrides numeric-column detection for alignment only — see `isRightAligned` below. */
  kind?: 'value' | 'range' | 'units' | 'flag' | 'label';
}
export interface PdfInput {
  title: string;
  generatedAt: string;
  params: Record<string, unknown>;
  columns: PdfColumn[];
  rows: Record<string, unknown>[];
}

const ROW_H = 16;              // pt, one table row
const ROW_PAD = 4;             // pt, gap above the text inside the row
const ROW_TEXT_H = ROW_H - ROW_PAD; // 12pt — one 9pt line fits, two never do
// Same restrained, print-safe palette as the design renderer's grid, so a workflow-exported table
// and a Reports-page table read as the same product.
const HEAD_FILL = '#eef2f6';
const HEAD_TEXT = '#1f2933';
const HEAD_RULE = '#94a3b8';
const GRID_RULE = '#cbd5e1';
const ZEBRA_FILL = '#f8fafc';
const BODY_TEXT = '#334155';
const MIN_COL_W = 22;
const MAX_NATURAL_W = 160;
const WIDTH_SAMPLE_ROWS = 400;

/** Column widths proportional to content, and numeric-column detection.
 *
 *  ⚠ DUPLICATED from `@openldr/report-designer`'s `render/draw.ts`, deliberately. This package is
 *  the dependency leaf (pdfkit only) and report-designer sits above it, so importing across would
 *  invert the direction; adding a workspace dependency for two pure functions, right before the
 *  report-template work that will restructure both renderers, buys less than it costs. Consolidate
 *  the pair into one module when that work lands — and keep them in step until then. */
export function columnWidths(headers: string[], rows: string[][], totalW: number, measure: (t: string, bold: boolean) => number): number[] {
  const n = Math.max(headers.length, 1);
  const sample = rows.slice(0, WIDTH_SAMPLE_ROWS);
  const natural = Array.from({ length: n }, (_, i) => {
    let w = measure(headers[i] ?? '', true);
    for (const row of sample) w = Math.max(w, measure(row[i] ?? '', false));
    return Math.min(w + ROW_PAD * 2 + 2, MAX_NATURAL_W);
  });
  const sum = natural.reduce((a, b) => a + b, 0) || 1;
  let out = natural.map((w) => (w / sum) * totalW);
  const floor = Math.min(MIN_COL_W, totalW / n);
  const deficit = out.reduce((acc, w) => acc + Math.max(0, floor - w), 0);
  if (deficit > 0) {
    const surplus = out.reduce((acc, w) => acc + Math.max(0, w - floor), 0);
    out = out.map((w) => (w <= floor ? floor : w - (w - floor) * (deficit / (surplus || 1))));
  }
  return out;
}

export function isNumericColumn(rows: string[][], ci: number): boolean {
  let seen = 0;
  for (const row of rows) {
    const v = (row[ci] ?? '').trim();
    if (v === '') continue;
    if (!/^-?\d+(\.\d+)?$/.test(v)) return false;
    seen += 1;
  }
  return seen > 0;
}

/** Whether column `ci` is right-aligned.
 *
 *  ⚠ DUPLICATED from `@openldr/report-designer`'s `render/draw.ts`'s `isRightAligned`, deliberately
 *  — same reason as `columnWidths` above. A `units` or `range` column is text that merely LOOKS
 *  numeric ("3.5" as a unit, a lone bound of a range) and ranging it right would align it against
 *  the values it qualifies; `kind` overrides the numeric test, only ever toward the left. A column
 *  with no `kind` behaves exactly as `isNumericColumn` alone always has. */
export function isRightAligned(rows: string[][], ci: number, kind: PdfColumn['kind']): boolean {
  if (kind === 'units' || kind === 'range') return false;
  return isNumericColumn(rows, ci);
}

/** Status vocabulary and palette.
 *
 * ⚠ DUPLICATED from `@openldr/report-designer`'s `render/draw.ts`, deliberately — same reason as
 * `columnWidths` above (this package is the dependency leaf; report-designer sits above it, so
 * importing across would invert the dependency direction). Keep the two in step.
 *
 * `STATUS_CHIP_TEXT` is per-status, not one white constant: `none`'s fill (`#e2e8f0`) is near-white,
 * so white-on-it is ~1.15:1 contrast — effectively invisible — and gets the same dark slate the
 * plain body text uses instead. */
const CELL_STATUSES = ['normal', 'abnormal', 'critical', 'indeterminate', 'none'] as const;
export type CellStatus = (typeof CELL_STATUSES)[number];
const STATUS_CHIP_FILL: Record<CellStatus, string> = {
  normal: '#16a34a', abnormal: '#e11d48', critical: '#9f1239', indeterminate: '#94a3b8', none: '#e2e8f0',
};
const STATUS_CHIP_TEXT: Record<CellStatus, string> = {
  normal: '#ffffff', abnormal: '#ffffff', critical: '#ffffff', indeterminate: '#ffffff', none: BODY_TEXT,
};
const STATUS_TEXT_COLOR: Record<CellStatus, string> = {
  normal: '#166534', abnormal: '#b91c1c', critical: '#9f1239', indeterminate: '#475569', none: BODY_TEXT,
};

/** Parse a status token from a query cell. Unrecognised values become `undefined` — this renderer
 *  never COMPUTES a status, it only paints one it is given. */
export function asCellStatus(v: unknown): CellStatus | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  return (CELL_STATUSES as readonly string[]).includes(s) ? (s as CellStatus) : undefined;
}

/** Per-cell statuses aligned to `cells`'s grid (one entry per row × column). `undefined` wherever a
 *  column has no `statusKey`, or the row's value under it isn't a recognised token — both render
 *  exactly as they did before this feature existed (see `asCellStatus`).
 *
 *  ⚠ Same name, different empty-case contract than `report-designer`'s `cellStatusesFor`: that one
 *  returns `[]` (its documented "compatibility contract") when no column declares a `statusKey`;
 *  this one always returns a full grid of `undefined`. Render output is identical either way, but
 *  keep this in mind if the two ever get consolidated. */
export function cellStatusesFor(columns: PdfColumn[], rows: Record<string, unknown>[]): (CellStatus | undefined)[][] {
  return rows.map((row) => columns.map((c) => (c.statusKey ? asCellStatus(row[c.statusKey]) : undefined)));
}

/**
 * Text options for one table cell — SINGLE LINE, truncated with an ellipsis.
 *
 * ⛔ `height` is the load-bearing option. Cells passed `width` + `ellipsis: true` but no `height`,
 * and pdfkit only ellipsizes text it has constrained VERTICALLY, so `ellipsis` was inert and long
 * values WRAPPED. Rows advance by a fixed `rowH`, so the second line was drawn over the next row.
 *
 * ⚠ `lineBreak: false` does NOT prevent this (measured, pdfkit 0.15.2) — it only suppresses the
 * default width assignment, and an explicit `width` still wraps. Same defect, same fix, as
 * `report-designer`'s grid renderer; see its `cellTextOptions` for the measurements.
 */
function cellTextOptions(width: number): { width: number; height: number; ellipsis: true } {
  return { width, height: ROW_TEXT_H, ellipsis: true };
}

export function renderReportPdf(input: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape', bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const usable = right - left;

    doc.font('Helvetica-Bold').fontSize(16).text(input.title, left, doc.y);
    doc.font('Helvetica').fontSize(8).fillColor('#555')
      .text(`Generated ${input.generatedAt}  ·  ${Object.entries(input.params).map(([k, v]) => `${k}=${String(v)}`).join('  ') || 'no params'}`);
    doc.fillColor('#000').moveDown(0.5);

    const cols = input.columns;
    const rowH = ROW_H;
    const cells = input.rows.map((row) => cols.map((c) => String(row[c.key] ?? '')));
    const statuses = cellStatusesFor(cols, input.rows);
    const widths = columnWidths(cols.map((c) => c.label), cells, usable, (text, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      return doc.widthOfString(text);
    });
    const xOf = (ci: number): number => left + widths.slice(0, ci).reduce((a, b) => a + b, 0);
    const numeric = cols.map((c, ci) => isRightAligned(cells, ci, c.kind));
    const opts = (ci: number) => ({ ...cellTextOptions(widths[ci] - ROW_PAD * 2), align: numeric[ci] ? ('right' as const) : ('left' as const) });

    const drawHeader = (): void => {
      doc.font('Helvetica-Bold').fontSize(9);
      const y = doc.y;
      doc.rect(left, y, usable, rowH).fill(HEAD_FILL).fillColor(HEAD_TEXT);
      cols.forEach((c, i) => doc.text(c.label, xOf(i) + ROW_PAD, y + ROW_PAD, opts(i)));
      doc.save().lineWidth(0.75).strokeColor(HEAD_RULE).moveTo(left, y + rowH).lineTo(right, y + rowH).stroke().restore();
      doc.fillColor(BODY_TEXT);
      doc.y = y + rowH + 2;
    };
    drawHeader();

    doc.font('Helvetica').fontSize(9).fillColor(BODY_TEXT);
    // ⚠ Neither branch below re-asserts `fillColor(BODY_TEXT)` after a fill — the per-cell branch in
    // the row loop owns the fill colour for every cell it draws, so doing that here would overwrite
    // every status colour it set on the row that follows.
    cells.forEach((row, idx) => {
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(9); }
      const y = doc.y;
      if (idx % 2 === 1) doc.rect(left, y, usable, rowH).fill(ZEBRA_FILL);
      row.forEach((cell, ci) => {
        const st = statuses[idx]?.[ci];
        // A chip is exactly one row tall and one column wide, so it can never affect the y-advance.
        if (st && (cols[ci].emphasis ?? 'text') === 'fill') {
          doc.rect(xOf(ci), y, widths[ci], rowH).fill(STATUS_CHIP_FILL[st]);
          doc.fillColor(STATUS_CHIP_TEXT[st]);
        } else {
          doc.fillColor(st ? STATUS_TEXT_COLOR[st] : BODY_TEXT);
        }
        doc.text(cell, xOf(ci) + ROW_PAD, y + ROW_PAD, opts(ci));
      });
      doc.y = y + rowH;
    });
    if (cells.length > 0) {
      doc.save().lineWidth(0.5).strokeColor(GRID_RULE).moveTo(left, doc.y).lineTo(right, doc.y).stroke().restore();
    }
    if (input.rows.length === 0) doc.fillColor('#777').text('(no rows)', left, doc.y + 4).fillColor('#000');

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(7).fillColor('#999')
        .text(`OpenLDR  ·  page ${i + 1} of ${range.count}`, left, doc.page.height - doc.page.margins.bottom + 4, { width: usable, align: 'right' });
    }
    doc.end();
  });
}
