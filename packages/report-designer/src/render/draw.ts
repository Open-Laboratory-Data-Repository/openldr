import type { BoundColumn, CellEmphasis, CellStatus, ColumnKind, DesignElement, DesignPage, ReportDesign } from '../schema';
import { CELL_STATUSES } from '../schema';
import { encodeCode128, encodeQr, QR_QUIET_ZONE } from '../encode';
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
/**
 * A chip is inset inside its cell rather than filling it edge to edge.
 *
 * Without this, two vertically adjacent rows sharing a status paint touching rectangles and read as
 * ONE merged slab — on a real AST panel, "Cefotaxime / Ceftazidime" both Intermediate became a
 * single grey block, and two Resistant rows a single red one, so the reader loses the row boundary
 * and the count. The horizontal inset does the same job between a chip and its neighbouring column.
 *
 * ⚠ The inset must stay strictly inside `ROW_H`: pagination (`maxRowsFor`, `tableChunkCount`) and
 * the fixed `y = r.y + ROW_H + ri * ROW_H` advance all assume a chip can never affect row pitch.
 */
const CHIP_INSET_X = 1;
const CHIP_INSET_Y = 1.5;
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

// ---------------------------------------------------------------------------------------------
// keyvalue panel
// ---------------------------------------------------------------------------------------------

/** Panel title band height. Deliberately `ROW_H`, so a keyvalue panel's header aligns with a table's
 *  header when the two are placed side by side. */
const KV_TITLE_H = ROW_H;
const KV_TITLE_FILL = '#334155';
const KV_TITLE_TEXT = '#ffffff';
/** Pair label. Muted against the value on purpose: in a metadata block the reader scans VALUES and
 *  uses the labels only to locate one, so equal weight would make the block harder to read, not easier. */
const KV_LABEL_COLOR = '#64748b';
const KV_PAD_X = 6;
const KV_PAD_Y = 4;
/** Horizontal space between adjacent pair columns. */
const KV_GUTTER = 12;
const KV_INLINE_H = 14;
const KV_STACKED_H = 22;
/** An inline label's share of its pair's width, and the floor below which the share is not taken.
 *  40% keeps "First name" from wrapping while leaving the value the larger half. */
const KV_LABEL_FRAC = 0.4;
const KV_LABEL_MIN_W = 40;
const KV_LABEL_SIZE = 8;
const KV_VALUE_SIZE = 8;
const KV_STACKED_LABEL_SIZE = 6.5;
const KV_STACKED_VALUE_SIZE = 8.5;

export type KeyValuePair = { label: string; value: string; status?: CellStatus; emphasis: CellEmphasis };

/**
 * The pairs a keyvalue element renders.
 *
 * Bound: ONE PAIR PER `boundColumn`, valued from **row 0** — a metadata panel describes a single
 * subject (this patient, this specimen), so a second row has nothing to attach to. Unbound: the
 * element's `rows` as `[label, value]`, mirroring how an unbound table draws its sample rows.
 *
 * A query error yields `[]`; the caller draws the same red placeholder a bound table does. Zero rows
 * yields the labels with EMPTY values rather than nothing at all — the panel's shape is part of the
 * report, and a blank Surname line is information where a vanished panel is an invisible defect.
 */
export function keyValuePairs(el: DesignElement, resolved: ResolvedTable | undefined): KeyValuePair[] {
  if (el.kind !== 'keyvalue') return [];
  if (el.dataSource) {
    if (!resolved || 'error' in resolved) return [];
    const cols = el.boundColumns && el.boundColumns.length ? el.boundColumns : resolved.columns;
    const row = resolved.rows[0];
    return cols.map((c) => {
      const bc = c as BoundColumn;
      return {
        label: bc.label,
        value: row ? String(row[bc.key] ?? '') : '',
        status: row && bc.statusKey ? asCellStatus(row[bc.statusKey]) : undefined,
        emphasis: bc.emphasis ?? 'text',
      };
    });
  }
  return (el.rows ?? []).map((r) => ({ label: r[0] ?? '', value: r[1] ?? '', emphasis: 'text' as CellEmphasis }));
}

export interface PairBox {
  /** Pair cell box, inside the panel padding and below any title. */
  x: number; y: number; w: number; h: number;
  /** Label and value TEXT boxes — the `y` each is passed straight to `doc.text`, so the vertical
   *  centring lives here rather than in the drawer (which is what keeps an inline label and its
   *  value on ONE baseline; they were 3pt apart while the offset was applied to only one of them). */
  label: Box; value: Box;
}

/** pdfkit line height ≈ 1.15 × font size for Helvetica. Used only to centre text in a pair row; the
 *  drawer asks the document for the real value when it needs to size a chip. */
const lineH = (fontSize: number): number => fontSize * 1.15;

/**
 * Geometry for `n` pairs inside panel box `r`, flowing ACROSS then down.
 *
 * Extracted from the drawer and pure so pitch, flow order and the title offset are testable without
 * a PDF document — the same seam `columnWidths` uses. Pairs beyond the box's height are still
 * returned: clipping is the drawer's job (`doc.clip()`), and truncating here would make the helper
 * disagree with what the reader sees at the boundary.
 */
export function pairRects(
  r: Box, n: number, layout: 'inline' | 'stacked', panelColumns: number, hasTitle: boolean,
): PairBox[] {
  const cols = Math.max(1, Math.min(4, Math.floor(panelColumns) || 1));
  const pitch = layout === 'stacked' ? KV_STACKED_H : KV_INLINE_H;
  const x0 = r.x + KV_PAD_X;
  const y0 = r.y + (hasTitle ? KV_TITLE_H : 0) + KV_PAD_Y;
  const innerW = Math.max(0, r.w - KV_PAD_X * 2);
  const cellW = (innerW - KV_GUTTER * (cols - 1)) / cols;
  return Array.from({ length: Math.max(0, n) }, (_, i) => {
    const x = x0 + (i % cols) * (cellW + KV_GUTTER);
    const y = y0 + Math.floor(i / cols) * pitch;
    const cell = { x, y, w: cellW, h: pitch };
    if (layout === 'stacked') {
      const lh = lineH(KV_STACKED_LABEL_SIZE);
      return {
        ...cell,
        label: { x, y: y + 1, w: cellW, h: lh },
        value: { x, y: y + 1 + lh + 1, w: cellW, h: lineH(KV_STACKED_VALUE_SIZE) },
      };
    }
    // Both boxes share one `y`, centred in the pair row — an inline label and its value are read as
    // a single line and any offset between them shows.
    const labelW = Math.min(Math.max(KV_LABEL_MIN_W, cellW * KV_LABEL_FRAC), cellW);
    const lh = lineH(KV_VALUE_SIZE);
    const ty = y + (pitch - lh) / 2;
    return {
      ...cell,
      label: { x, y: ty, w: labelW, h: lh },
      value: { x: x + labelW, y: ty, w: Math.max(0, cellW - labelW), h: lh },
    };
  });
}

function drawKeyValue(doc: Doc, el: DesignElement, r: Box, resolved: ResolvedTable | undefined): void {
  if (el.dataSource && resolved && 'error' in resolved) { drawErrorPlaceholder(doc, r, resolved.error); return; }
  const s = el.style ?? {};
  const title = (el.text ?? '').trim();
  const pairs = keyValuePairs(el, resolved);
  const layout = el.layout ?? 'inline';

  doc.save().rect(r.x, r.y, r.w, r.h).clip();

  if (title) {
    doc.rect(r.x, r.y, r.w, KV_TITLE_H).fill(s.fill && s.fill !== 'none' ? s.fill : KV_TITLE_FILL);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(s.color ?? KV_TITLE_TEXT)
      .text(title, r.x + KV_PAD_X, r.y + CELL_PAD, { width: r.w - KV_PAD_X * 2, height: CELL_TEXT_H, ellipsis: true });
  }

  // An outline is opt-in (`style.strokeColor`), because band 2 of the reference is a bare metadata
  // strip that a box would only clutter. A TITLED panel usually wants one: without it the dark title
  // bar floats above its own content and reads as an unrelated section band.
  if (s.strokeColor) {
    doc.save().lineWidth(s.strokeWidth ?? 0.5).strokeColor(s.strokeColor)
      .rect(r.x, r.y, r.w, r.h).stroke().restore();
  }

  const boxes = pairRects(r, pairs.length, layout, el.panelColumns ?? 1, !!title);
  pairs.forEach((p, i) => {
    const b = boxes[i];
    const labelSize = layout === 'stacked' ? KV_STACKED_LABEL_SIZE : KV_LABEL_SIZE;
    const valueSize = layout === 'stacked' ? KV_STACKED_VALUE_SIZE : KV_VALUE_SIZE;
    // The label is BOLD and the value regular — the opposite of a table, on purpose. A table's
    // column header is read once and its rows many times; a metadata panel is scanned by hunting
    // for a label, so the label is the entry point and needs the weight. Colour alone was not
    // enough to separate the two at 8pt.
    doc.font('Helvetica-Bold').fontSize(labelSize).fillColor(KV_LABEL_COLOR)
      .text(layout === 'stacked' ? p.label.toUpperCase() : p.label, b.label.x, b.label.y,
        { width: b.label.w, height: b.label.h, ellipsis: true });

    // A `fill` chip is sized to the VALUE TEXT, not to the pair's width: a metadata panel's value
    // column is as wide as the widest value in it, so a full-width chip would paint a bar across
    // empty space instead of the pill the reference shows. The chip is grown from the text box
    // rather than the pair row so it hugs the value in BOTH layouts (a stacked pair's row also
    // contains its label, which a chip must not cover).
    doc.font('Helvetica').fontSize(valueSize);
    const chip = p.status && p.emphasis === 'fill';
    const pad = chip ? CELL_PAD : 0;
    let valueColor = BODY_TEXT;
    if (chip) {
      const w = Math.min(doc.widthOfString(p.value) + pad * 2, b.value.w);
      doc.rect(b.value.x, b.value.y - CHIP_INSET_Y, w, b.value.h + CHIP_INSET_Y * 2).fill(STATUS_CHIP_FILL[p.status!]);
      valueColor = STATUS_CHIP_TEXT[p.status!];
    } else if (p.status) {
      valueColor = STATUS_TEXT_COLOR[p.status];
    }
    doc.fillColor(valueColor).text(p.value, b.value.x + pad, b.value.y,
      { width: Math.max(0, b.value.w - pad), height: b.value.h, ellipsis: true });
  });

  doc.restore();
}

// ---------------------------------------------------------------------------------------------
// barcode / qrcode
// ---------------------------------------------------------------------------------------------

/** Caption strip height under a barcode, and its font size. */
const BARCODE_CAPTION_H = 9;
const BARCODE_CAPTION_SIZE = 7;
/** Gap between the bars and the caption, so descenders never touch the bars. */
const BARCODE_CAPTION_GAP = 1;

/**
 * The single value a `barcode`/`qrcode` element encodes.
 *
 * Bound: **`boundColumns[0]` of row 0**. One symbol carries one value, so the first bound column is
 * the value and any others are ignored — the Data tab says so rather than silently dropping them.
 * Unbound: the element's `text`, interpolated, so `{{param.x}}` reaches a symbol exactly as it
 * reaches a text element.
 *
 * Returns `''` (never throws) when the query failed or returned nothing; the caller draws a
 * placeholder, because a report whose barcode could not resolve still owes the reader its results.
 */
export function elementValue(
  el: DesignElement, resolved: ResolvedTable | undefined, tokens: Map<string, string>,
): string {
  if (el.dataSource) {
    if (!resolved || 'error' in resolved) return '';
    const col = el.boundColumns?.[0];
    const row = resolved.rows[0];
    if (!col || !row) return '';
    return String(row[col.key] ?? '');
  }
  return interpolate(el.text ?? '', tokens);
}

/**
 * Bars scaled to fill the box width.
 *
 * ⚠ Consecutive same-value modules are merged into ONE rect rather than emitted per module. A
 * 145-module symbol otherwise costs 145 rect operators, most of them adjacent and identical; worse,
 * adjacent rects drawn at fractional module widths can leave hairline seams where the rasteriser
 * rounds each edge independently, which a scanner reads as extra bars.
 */
function drawBarcode(doc: Doc, el: DesignElement, r: Box, value: string): void {
  const bars = encodeCode128(value);
  if (!bars || !bars.length) { drawUnencodable(doc, r); return; }
  const caption = (el.caption ?? true) && value !== '';
  const barsH = Math.max(1, r.h - (caption ? BARCODE_CAPTION_H + BARCODE_CAPTION_GAP : 0));
  const mw = r.w / bars.length;

  doc.save().rect(r.x, r.y, r.w, r.h).clip();
  doc.fillColor(TEXT_COLOR);
  let i = 0;
  while (i < bars.length) {
    if (!bars[i]) { i += 1; continue; }
    let run = 1;
    while (i + run < bars.length && bars[i + run]) run += 1;
    doc.rect(r.x + i * mw, r.y, run * mw, barsH).fill(TEXT_COLOR);
    i += run;
  }
  if (caption) {
    doc.font('Helvetica').fontSize(BARCODE_CAPTION_SIZE).fillColor(TEXT_COLOR)
      .text(value, r.x, r.y + barsH + BARCODE_CAPTION_GAP,
        { width: r.w, height: BARCODE_CAPTION_H, align: 'center', ellipsis: true });
  }
  doc.restore();
}

/**
 * A square QR centred in the box, including its mandatory quiet zone.
 *
 * The module pitch divides by `size + QR_QUIET_ZONE * 2`, so the 4-module margin the QR spec
 * requires is reserved from the SAME budget as the modules — the code shrinks to make room for it
 * instead of the margin being trimmed away. Scanners fail without that margin, and on a white page
 * its absence is invisible, so this is geometry a test pins rather than something eyeballed.
 */
function drawQrCode(doc: Doc, r: Box, value: string): void {
  const modules = encodeQr(value);
  if (!modules) { drawUnencodable(doc, r); return; }
  const n = modules.length;
  const pitch = Math.min(r.w, r.h) / (n + QR_QUIET_ZONE * 2);
  const side = pitch * (n + QR_QUIET_ZONE * 2);
  // Centre the whole symbol (quiet zone included) in the author's box.
  const x0 = r.x + (r.w - side) / 2 + pitch * QR_QUIET_ZONE;
  const y0 = r.y + (r.h - side) / 2 + pitch * QR_QUIET_ZONE;

  doc.save();
  doc.fillColor(TEXT_COLOR);
  // Merge horizontal runs, for the same reason as the barcode: fewer operators, and no hairline
  // seams between adjacent modules for a scanner to misread.
  for (let row = 0; row < n; row += 1) {
    let c = 0;
    while (c < n) {
      if (!modules[row][c]) { c += 1; continue; }
      let run = 1;
      while (c + run < n && modules[row][c + run]) run += 1;
      doc.rect(x0 + c * pitch, y0 + row * pitch, run * pitch, pitch).fill(TEXT_COLOR);
      c += run;
    }
  }
  doc.restore();
}

/** The dashed box an `image` with no usable source already draws. Reused deliberately: "this
 *  element has nothing to show" should look the same wherever it happens. */
function drawUnencodable(doc: Doc, r: Box): void {
  doc.save().lineWidth(1).strokeColor(RECT_BORDER).dash(3, { space: 2 })
    .rect(r.x, r.y, r.w, r.h).stroke().undash().restore();
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
    case 'keyvalue': {
      drawKeyValue(doc, el, r, resolved);
      return;
    }
    case 'barcode': {
      drawBarcode(doc, el, r, elementValue(el, resolved, tokens));
      return;
    }
    case 'qrcode': {
      drawQrCode(doc, r, elementValue(el, resolved, tokens));
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
        doc.rect(xOf(ci) + CHIP_INSET_X, y + CHIP_INSET_Y, widths[ci] - CHIP_INSET_X * 2, ROW_H - CHIP_INSET_Y * 2)
          .fill(STATUS_CHIP_FILL[st]);
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
