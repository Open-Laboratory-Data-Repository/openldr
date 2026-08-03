import type { CellEmphasis, CellStatus, ColumnKind, DesignElement, DesignPage, ReportDesign } from '../schema';
import { CELL_STATUSES } from '../schema';
import { toPt, PX_TO_PT } from './units';
import type { ResolvedTable } from './index';

type Doc = PDFKit.PDFDocument;
type Box = { x: number; y: number; w: number; h: number };

const TEXT_COLOR = '#262626';
const LINE_COLOR = '#a3a3a3';
const RECT_BORDER = '#d4d4d4';
// Table palette. Deliberately restrained and print-safe: a tinted header band, a rule under it,
// and a zebra a shade or two off white. Heavier grid lines read as a spreadsheet, not a report,
// and mid-greys that look fine on screen turn to mud on a mono office printer.
const HEAD_FILL = '#eef2f6';
const HEAD_TEXT = '#1f2933';
const HEAD_RULE = '#94a3b8';
const GRID_RULE = '#cbd5e1';
const ZEBRA_FILL = '#f8fafc';
const BODY_TEXT = '#334155';
// Status palette. `fill` chips are saturated with knocked-out white text (the reference's language);
// `text` emphasis just tints the value and is the default, because it survives a mono office printer.
// ⚠ `indeterminate` (`#94a3b8`) happens to equal `HEAD_RULE` above, and `STATUS_TEXT_COLOR.critical`
// below happens to equal `critical` here. Both are coincidence, not a shared constant waiting to be
// factored out — the status palette and the table chrome are chosen independently and are free to
// diverge. Do not "de-duplicate" them.
const STATUS_CHIP_FILL: Record<CellStatus, string> = {
  normal: '#16a34a', abnormal: '#e11d48', critical: '#9f1239', indeterminate: '#94a3b8', none: '#e2e8f0',
};
// Chip text is knocked-out white on every saturated fill EXCEPT `none`, whose fill (`#e2e8f0`) is
// near-white — white-on-white would be ~1.15:1 contrast, effectively invisible. `none` gets the
// same dark slate the plain body text uses instead.
const STATUS_CHIP_TEXT: Record<CellStatus, string> = {
  normal: '#ffffff', abnormal: '#ffffff', critical: '#ffffff', indeterminate: '#ffffff', none: BODY_TEXT,
};
const STATUS_TEXT_COLOR: Record<CellStatus, string> = {
  normal: '#166534', abnormal: '#b91c1c', critical: '#9f1239', indeterminate: '#475569', none: BODY_TEXT,
};
export const ROW_H = 16; // pt
/** Body rows that fit in a box of height `hPt` (pt), reserving one row for the header. */
const maxRowsFor = (hPt: number): number => Math.floor((hPt - ROW_H) / ROW_H);

/** Vertical padding above the text inside a row; also the space left below it. */
const CELL_PAD = 4;
/** Space a cell's text may occupy: from its baseline offset to the bottom of its own row. */
export const CELL_TEXT_H = ROW_H - CELL_PAD; // 12pt — one 8pt line (9.25pt), never two (18.5pt)

/**
 * Text options for one table cell — SINGLE LINE, truncated with an ellipsis.
 *
 * ⛔ `height` is the load-bearing option. Cells passed `width` + `ellipsis: true` but NO `height`,
 * and pdfkit only ellipsizes text it has constrained VERTICALLY — so `ellipsis` was inert and a
 * long value simply WRAPPED. Every row is drawn at a fixed `y = r.y + ROW_H + ri * ROW_H`, so the
 * wrapped second line landed on top of the next row: "Chloramphenicol" and
 * "Trimethoprim/Sulfamethoxazole" overprinted the rows beneath them in AMR GLASS RIS.
 *
 * ⚠ `lineBreak: false` does NOT fix this and was measured doing nothing (pdfkit 0.15.2). It only
 * suppresses the DEFAULT width assignment in `_initOptions`; once an explicit `width` is passed the
 * LineWrapper still wraps to it. Measured y-advance at width 56pt, 8pt Helvetica:
 * "Trimethoprim/Sulfamethoxazole" → 27.74pt (3 lines) both with and without `lineBreak: false`,
 * and 9.25pt (1 line) once `height` is supplied. Do not "simplify" this back to `lineBreak`.
 *
 * Single-line is right for THIS element model rather than growing the row: a design's table has an
 * author-fixed box, and `maxRowsFor`/`tableChunkCount` derive pagination from a constant `ROW_H`,
 * so variable row heights would make the row count unknowable before layout. The untruncated value
 * stays available in the Spreadsheet tab and the CSV export, and an ellipsis is strictly better
 * than text printed over other text.
 *
 * The sibling calls in this file (`drawText`, `drawErrorPlaceholder`) always passed `height` — the
 * table cells were the only ones that did not, which is exactly why only tables overlapped.
 */
export function cellTextOptions(width: number): { width: number; height: number; ellipsis: true } {
  return { width, height: CELL_TEXT_H, ellipsis: true };
}

/** Narrowest a column may be squeezed to — below this even a short header is unreadable. */
const MIN_COL_W = 22;
/** Widest a single column may claim from its natural size, so one long free-text column cannot
 *  starve every other column on the row. */
const MAX_NATURAL_W = 160;
/** Cap on how many rows are measured for width. Enough to be representative; bounded so a
 *  100k-row export does not pay for 100k text measurements. Widths are computed from ALL pages'
 *  rows (not the current chunk) so a column does not change width between pages. */
const WIDTH_SAMPLE_ROWS = 400;

/**
 * Column widths proportional to what the column actually contains.
 *
 * Columns used to be a flat `r.w / n`. On the AMR GLASS table that gave "Antibiotic" the same
 * width as "R" — so antibiotic names were truncated while single-digit count columns sat in
 * whitespace. Measuring instead means the text columns get the room and the numeric columns give
 * it up, which is most of the difference between a report that looks considered and one that
 * looks like a debug dump.
 *
 * `measure` is injected so the allocation is testable without a PDF document.
 */
export function columnWidths(
  headers: string[], rows: string[][], totalW: number,
  measure: (text: string, bold: boolean) => number,
): number[] {
  const n = Math.max(headers.length, 1);
  const sample = rows.slice(0, WIDTH_SAMPLE_ROWS);
  const natural = Array.from({ length: n }, (_, i) => {
    let w = measure(headers[i] ?? '', true);
    for (const row of sample) w = Math.max(w, measure(row[i] ?? '', false));
    return Math.min(w + CELL_PAD * 2 + 2, MAX_NATURAL_W); // +2 so text never touches the next column
  });

  // Scale to the available width, then lift anything that fell under the floor and pay for it
  // from the columns that are still above it — proportionally, so the shape is preserved.
  const sum = natural.reduce((a, b) => a + b, 0) || 1;
  let out = natural.map((w) => (w / sum) * totalW);

  const floor = Math.min(MIN_COL_W, totalW / n); // a very narrow table cannot honour MIN_COL_W
  const deficit = out.reduce((acc, w) => acc + Math.max(0, floor - w), 0);
  if (deficit > 0) {
    const surplus = out.reduce((acc, w) => acc + Math.max(0, w - floor), 0);
    out = out.map((w) => (w <= floor ? floor : w - (w - floor) * (deficit / (surplus || 1))));
  }
  return out;
}

/** True when every non-empty value in the column is a plain number.
 *
 *  Numbers belong on the right: it aligns the decimal point and the magnitude, which is how a
 *  reader compares a column of counts at a glance. Deliberately strict — "0% (13)" and "5-14" are
 *  NOT numbers and are better left ranged left with the rest of the text. */
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
 *  Numbers belong on the right, but a `units` or `range` column is text that merely looks numeric
 *  — "3.5" as a unit, or a range column holding a lone bound — and ranging it right would align it
 *  against the values it qualifies. `kind` therefore overrides the numeric test, and only ever
 *  toward the left; a column with no `kind` behaves exactly as it did before this feature. */
export function isRightAligned(rows: string[][], ci: number, kind: ColumnKind | undefined): boolean {
  if (kind === 'units' || kind === 'range') return false;
  return isNumericColumn(rows, ci);
}

export function paramMap(design: ReportDesign, now: Date): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of design.parameters) {
    if (typeof p.value === 'string') m.set(p.key, p.value);
    else if (p.value) { m.set('from', p.value.from); m.set('to', p.value.to); }
  }
  m.set('date', now.toLocaleDateString());
  return m;
}

export function interpolate(input: string, tokens: Map<string, string>): string {
  return input
    .replace(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => tokens.get(k) ?? '')
    .replace(/\{\{\s*date\s*\}\}/g, tokens.get('date') ?? '');
}

/** The projected body rows for a table element (bound → project columns from resolved.rows; static → el.rows; error/unresolved → []). */
export function rowsFor(el: DesignElement, resolved: ResolvedTable | undefined): string[][] {
  if (el.kind !== 'table') return [];
  if (el.dataSource) {
    if (!resolved || 'error' in resolved) return [];
    const cols = el.boundColumns && el.boundColumns.length ? el.boundColumns : resolved.columns;
    return resolved.rows.map((row) => cols.map((c) => String(row[c.key] ?? '')));
  }
  return el.rows ?? [];
}

/** Parse a status token from a query cell. Unrecognised values become `undefined` — a report must
 *  never colour a cell on a token it does not understand. */
export function asCellStatus(v: unknown): CellStatus | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  return (CELL_STATUSES as readonly string[]).includes(s) ? (s as CellStatus) : undefined;
}

/**
 * Per-cell statuses aligned to `rowsFor`'s grid, or `[]` when this table has none.
 *
 * Returning `[]` on the no-statusKey path is the compatibility contract: `drawGrid` then takes
 * exactly the code path it took before this feature existed.
 *
 * ⚠ Only `el.boundColumns` is consulted. `resolved.columns` is `{key,label}` and carries no
 * `statusKey`, and binding columns explicitly is the only way to author one anyway.
 */
export function cellStatusesFor(
  el: DesignElement, resolved: ResolvedTable | undefined,
): (CellStatus | undefined)[][] {
  if (el.kind !== 'table' || !el.dataSource) return [];
  if (!resolved || 'error' in resolved) return [];
  const cols = el.boundColumns ?? [];
  if (!cols.some((c) => c.statusKey)) return [];
  return resolved.rows.map((row) => cols.map((c) => (c.statusKey ? asCellStatus(row[c.statusKey]) : undefined)));
}

/** How many physical pages this one table needs (repeat-page model). 1 for non-tables/errors/degenerate boxes. */
export function tableChunkCount(el: DesignElement, resolved: ResolvedTable | undefined): number {
  if (el.kind !== 'table') return 1;
  const maxRows = maxRowsFor(toPt(el.rect).h);
  if (maxRows < 1) return 1;
  const rowCount = rowsFor(el, resolved).length;
  return Math.max(1, Math.ceil(rowCount / maxRows));
}

/** Physical pages needed for a design page = the largest table's chunk count (min 1). */
export function pageChunkCount(page: DesignPage, resolved: Map<string, ResolvedTable>): number {
  return Math.max(1, ...page.elements.map((el) => tableChunkCount(el, resolved.get(el.id))));
}

/** Total physical PDF pages across the whole design = sum of each design page's chunk count. */
export function totalPhysicalPages(pages: DesignPage[], resolved: Map<string, ResolvedTable>): number {
  return pages.reduce((sum, p) => sum + pageChunkCount(p, resolved), 0);
}

/** Footer label for physical page `n` of `total` (hardcoded English, like the "Query error:" text). */
export function pageFooterLabel(n: number, total: number): string {
  return `Page ${n} / ${total}`;
}

/** Draw the "Page X / Y" footer centered ~24pt above the bottom edge of a full-bleed page. */
export function drawPageFooter(doc: Doc, wPt: number, hPt: number, n: number, total: number): void {
  doc.save().font('Helvetica').fontSize(8).fillColor('#737373')
    .text(pageFooterLabel(n, total), 0, hPt - 24, { width: wPt, align: 'center' });
  doc.restore();
}

export function drawElement(
  doc: Doc, el: DesignElement, tokens: Map<string, string>, resolved: ResolvedTable | undefined, chunk = 0,
): void {
  const r = toPt(el.rect);
  const s = el.style ?? {};
  switch (el.kind) {
    case 'rect': {
      if (s.fill && s.fill !== 'none') doc.save().rect(r.x, r.y, r.w, r.h).fill(s.fill).restore();
      doc.save().lineWidth(s.strokeWidth ?? 1).strokeColor(s.strokeColor ?? RECT_BORDER)
        .rect(r.x, r.y, r.w, r.h).stroke().restore();
      return;
    }
    case 'line': {
      doc.save().lineWidth(s.strokeWidth ?? 1).strokeColor(s.strokeColor ?? LINE_COLOR)
        .moveTo(r.x, r.y).lineTo(r.x + r.w, r.y + r.h).stroke().restore();
      return;
    }
    case 'text':
    case 'datetime': {
      const raw = el.text ?? (el.kind === 'datetime' ? '{{date}}' : '');
      drawText(doc, interpolate(raw, tokens), r, s);
      return;
    }
    case 'image': {
      if (el.src) {
        doc.save();
        try { doc.image(el.src, r.x, r.y, { fit: [r.w, r.h] }); doc.restore(); return; }
        catch { doc.restore(); /* fall through to placeholder */ }
      }
      doc.save().lineWidth(1).strokeColor(RECT_BORDER).dash(3, { space: 2 })
        .rect(r.x, r.y, r.w, r.h).stroke().undash().restore();
      return;
    }
    case 'table': {
      drawTable(doc, el, r, resolved, chunk);
      return;
    }
  }
}

function drawText(doc: Doc, str: string, r: Box, s: DesignElement['style']): void {
  const st = s ?? {};
  doc.save()
    .font(st.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize((st.fontSize ?? 11) * PX_TO_PT) // element fontSize is px@96 too → to pt
    .fillColor(st.color ?? TEXT_COLOR)
    .text(str, r.x, r.y, { width: r.w, height: r.h, align: st.align ?? 'left', ellipsis: true });
  doc.restore();
}

function drawTable(doc: Doc, el: DesignElement, r: Box, resolved: ResolvedTable | undefined, chunk: number): void {
  if (el.dataSource && resolved && 'error' in resolved) { drawErrorPlaceholder(doc, r, resolved.error); return; }
  const headers = tableHeaders(el, resolved);
  const allRows = rowsFor(el, resolved);
  const statuses = cellStatusesFor(el, resolved);
  const cols = el.boundColumns ?? [];
  const emphasis = cols.map((c) => c.emphasis ?? 'text');
  const kinds = cols.map((c) => c.kind);
  drawGrid(doc, r, headers, allRows, chunk, statuses, emphasis, kinds);
}

function tableHeaders(el: DesignElement, resolved: ResolvedTable | undefined): string[] {
  if (!el.dataSource) return el.columns ?? [];
  const cols = el.boundColumns && el.boundColumns.length
    ? el.boundColumns
    : (resolved && !('error' in resolved) ? resolved.columns : []);
  return cols.map((c) => c.label);
}

function drawGrid(
  doc: Doc, r: Box, headers: string[], allRows: string[][], chunk: number,
  allStatuses: (CellStatus | undefined)[][] = [], emphasis: CellEmphasis[] = [],
  kinds: (ColumnKind | undefined)[] = [],
): void {
  const n = Math.max(headers.length, 1);
  const maxRows = maxRowsFor(r.h);
  const lo = chunk * maxRows;
  const rows = maxRows >= 1 ? allRows.slice(lo, lo + maxRows) : [];
  const statuses = maxRows >= 1 ? allStatuses.slice(lo, lo + maxRows) : [];

  // Widths come from ALL rows, not just this chunk, so a column keeps the same width on every page.
  const widths = columnWidths(headers, allRows, r.w, (text, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    return doc.widthOfString(text);
  });
  const xOf = (ci: number): number => r.x + widths.slice(0, ci).reduce((a, b) => a + b, 0);
  const numeric = headers.map((_, ci) => isRightAligned(allRows, ci, kinds[ci]));

  doc.save().rect(r.x, r.y, r.w, r.h).clip();

  // Header: a tinted band closed by a rule. The rule is what separates "a table" from "rows of
  // text" — the old fill alone left the header floating.
  doc.rect(r.x, r.y, r.w, ROW_H).fill(HEAD_FILL);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(HEAD_TEXT);
  headers.forEach((h, i) => doc.text(h, xOf(i) + CELL_PAD, r.y + CELL_PAD, {
    ...cellTextOptions(widths[i] - CELL_PAD * 2), align: numeric[i] ? 'right' : 'left',
  }));
  doc.save().lineWidth(0.75).strokeColor(HEAD_RULE)
    .moveTo(r.x, r.y + ROW_H).lineTo(r.x + r.w, r.y + ROW_H).stroke().restore();

  doc.font('Helvetica').fontSize(8);
  // pdfkit emits `fillColor` unconditionally — it does not cache the current colour — so calling it
  // once per cell instead of once per row cost every wide table ~40 bytes/cell of repeated colour
  // operators for a colour that, most of the time, had not actually changed. `lastFill` tracks what
  // colour is ACTUALLY in effect on the doc right now, so `setFill` can skip the call when nothing
  // would change. ⚠ `rect(...).fill(color)` also changes the doc's current fill colour as a side
  // effect (that is how it paints) — every call site that uses it, not just `setFill`, must update
  // `lastFill` too, or the next `setFill` compares against a stale value and skips a call it needed,
  // leaving text painted in the rect's colour instead of its own.
  let lastFill: string | undefined;
  const setFill = (color: string): void => {
    if (color !== lastFill) { doc.fillColor(color); lastFill = color; }
  };
  rows.forEach((row, ri) => {
    const y = r.y + ROW_H + ri * ROW_H;
    if (ri % 2 === 1) { doc.rect(r.x, y, r.w, ROW_H).fill(ZEBRA_FILL); lastFill = ZEBRA_FILL; }
    row.forEach((cell, ci) => {
      const st = statuses[ri]?.[ci];
      // A chip is exactly one row tall and one column wide, so it can never affect the y-advance.
      if (st && (emphasis[ci] ?? 'text') === 'fill') {
        doc.rect(xOf(ci), y, widths[ci], ROW_H).fill(STATUS_CHIP_FILL[st]);
        lastFill = STATUS_CHIP_FILL[st];
        setFill(STATUS_CHIP_TEXT[st]);
      } else {
        setFill(st ? STATUS_TEXT_COLOR[st] : BODY_TEXT);
      }
      doc.text(cell, xOf(ci) + CELL_PAD, y + CELL_PAD, {
        ...cellTextOptions(widths[ci] - CELL_PAD * 2), align: numeric[ci] ? 'right' : 'left',
      });
    });
  });

  // Close the body with the same rule weight as the header, so the block reads as one object
  // rather than trailing off into the page.
  const bodyEnd = r.y + ROW_H + rows.length * ROW_H;
  doc.save().lineWidth(0.5).strokeColor(GRID_RULE)
    .moveTo(r.x, bodyEnd).lineTo(r.x + r.w, bodyEnd).stroke().restore();

  doc.restore();
}

function drawErrorPlaceholder(doc: Doc, r: Box, msg: string): void {
  doc.save().rect(r.x, r.y, r.w, r.h).fill('#fef2f2');
  doc.fillColor('#b91c1c').font('Helvetica').fontSize(8)
    .text(`Query error: ${msg}`, r.x + 4, r.y + 4, { width: r.w - 8, height: r.h - 8, ellipsis: true });
  doc.restore();
}
