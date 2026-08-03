import PDFDocument from 'pdfkit';

export interface PdfColumn { key: string; label: string }
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
function columnWidths(headers: string[], rows: string[][], totalW: number, measure: (t: string, bold: boolean) => number): number[] {
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

function isNumericColumn(rows: string[][], ci: number): boolean {
  let seen = 0;
  for (const row of rows) {
    const v = (row[ci] ?? '').trim();
    if (v === '') continue;
    if (!/^-?\d+(\.\d+)?$/.test(v)) return false;
    seen += 1;
  }
  return seen > 0;
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
    const widths = columnWidths(cols.map((c) => c.label), cells, usable, (text, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      return doc.widthOfString(text);
    });
    const xOf = (ci: number): number => left + widths.slice(0, ci).reduce((a, b) => a + b, 0);
    const numeric = cols.map((_, ci) => isNumericColumn(cells, ci));
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
    cells.forEach((row, idx) => {
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(9).fillColor(BODY_TEXT); }
      const y = doc.y;
      if (idx % 2 === 1) doc.rect(left, y, usable, rowH).fill(ZEBRA_FILL).fillColor(BODY_TEXT);
      row.forEach((cell, ci) => doc.text(cell, xOf(ci) + ROW_PAD, y + ROW_PAD, opts(ci)));
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
