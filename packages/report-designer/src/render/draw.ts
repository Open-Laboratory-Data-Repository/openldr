import type { BoundColumn, CellEmphasis, CellStatus, ColumnKind, DesignElement, DesignPage, ReportDesign } from '../schema';
import { CELL_STATUSES } from '../schema';
import { encodeCode128, encodeQr, QR_QUIET_ZONE } from '../encode';
import { toPt, PX_TO_PT } from './units';
import type { ResolvedTable } from './pagination';
import { formatDisplayDate, formatDisplayDateOf } from './format-date';
import {
  CELL_SIZE, CELL_GAP, GROUP_GAP, CELL_ROW_H, CELL_COL_GAP, CELL_HEAD_H, CELL_LABEL_W,
  cellFill, groupBreaks, splitCellGridRows, cellGridLift, cellGridRowSchedule, cellGridChunkStart,
  stripWidth as stripWidthOf,
} from './cellgrid';
import { drawChart } from './chart';
import { letterheadElements } from './letterhead';

// Type-only, so this stays runtime-pdfkit-free (the pure barrel re-exports this module's math into
// the browser). The AMBIENT `PDFKit.PDFDocument` spelling broke the studio's tsc, which compiles
// this file through /pure without @types/pdfkit in its own program; an explicit type import
// resolves from THIS package instead.
import type PDFDocument from 'pdfkit';
type Doc = typeof PDFDocument;
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
 * The `cellgrid` trailing-column chip, and the ink a trailing value is tinted with.
 *
 * ⛔ NOT `STATUS_CHIP_FILL`. That palette is CLINICAL: `#9f1239` is the dark rose this codebase
 * reserves for a critical result. A laboratory that has sent nothing for nineteen working days is
 * an operational fact about a data feed, not a result about a patient, and printing it in the same
 * red on a clinical report states something that is not true. `CELL_RAMPS`' own doc comment in
 * `schema.ts` already says the rule this restores: a cellgrid shows magnitude or presence, never a
 * result state, so it does not reach for `CELL_STATUSES`' colours.
 *
 * ⚠ ONE ink for every recognised token, deliberately. This element FLAGS, it does not grade: five
 * clinical severities collapsing to one near-black is the point, not an omission. A design that
 * needs two levels of emphasis here needs a second declaration, not a second clinical colour.
 *
 * Near-black is what the approved preview used. It is the darkest ink in the slate scale the rest
 * of this renderer draws from, so it survives a mono office printer, which a hue does not.
 */
const CELL_CHIP_FILL = '#0f172a';
const CELL_CHIP_TEXT = '#ffffff';

/**
 * A chip is inset inside its cell rather than filling it edge to edge.
 *
 * Without this, two vertically adjacent rows sharing a status paint touching rectangles and read as
 * ONE merged slab — on a real AST panel, "Cefotaxime / Ceftazidime" both Intermediate became a
 * single grey block, and two Resistant rows a single red one, so the reader loses the row boundary
 * and the count. The horizontal inset does the same job between a chip and its neighbouring column.
 *
 * ⚠ The inset must stay strictly inside `ROW_H`: pagination (`maxRowsFor`, `elementChunkCount`) and
 * the fixed `y = r.y + headH + ri * ROW_H` advance all assume a chip can never affect row pitch.
 */
const CHIP_INSET_X = 1;
const CHIP_INSET_Y = 1.5;
export const ROW_H = 16; // pt
/**
 * Baseline-to-baseline pitch of the SECOND line of a stacked header.
 *
 * 8pt, measured off the reference document this grid copies: its day number sits at y=744 and its
 * month at y=736. Tighter than `ROW_H` on purpose — at the row pitch the two lines read as two
 * separate headers rather than one two-line label.
 */
export const HEAD_LINE_H = 8;
/** Header band height when the table stacks a second header line. `CELL_PAD` above the first line,
 *  `HEAD_LINE_H` to the second, and one 8pt line (9.25pt of advance) below it. */
export const STACKED_HEAD_H = ROW_H + HEAD_LINE_H; // 24pt
/** Body rows that fit in a box of height `hPt` (pt), reserving `headH` for the header band. */
export const maxRowsFor = (hPt: number, headH: number = ROW_H): number => Math.floor((hPt - headH) / ROW_H);

/** Vertical padding above the text inside a row; also the space left below it. */
const CELL_PAD = 4;
/** Space a cell's text may occupy: from its baseline offset to the bottom of its own row. */
export const CELL_TEXT_H = ROW_H - CELL_PAD; // 12pt — one 8pt line (9.25pt), never two (18.5pt)

/**
 * Text options for one table cell — SINGLE LINE, truncated with an ellipsis.
 *
 * ⛔ `height` is the load-bearing option. Cells passed `width` + `ellipsis: true` but NO `height`,
 * and pdfkit only ellipsizes text it has constrained VERTICALLY — so `ellipsis` was inert and a
 * long value simply WRAPPED. Every row is drawn at a fixed `y = r.y + headH + ri * ROW_H`, so the
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
 * author-fixed box, and `maxRowsFor`/`elementChunkCount` derive pagination from a constant `ROW_H`,
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

/**
 * Cut `text` to fit `maxW` pt under the doc's CURRENT font/size, appending one ellipsis character.
 *
 * ⛔ NOT `{ ellipsis: true }`. `drawCellGrid`'s label call passed `width` + `lineBreak: false` +
 * `ellipsis: true` with no `height`, which is exactly the `cellTextOptions` quirk above minus the
 * `height` that quirk exists to supply — measured directly (pdfkit 0.15.2, a throwaway script
 * drawing "Bugando Medical Centre (BMC)" at `CELL_LABEL_W`): `ellipsis` did NOTHING, the string
 * still wrapped to a second line, and that second line ("(BMC)") printed on top of the laboratory
 * name in the row below it. Passing `height` (`cellTextOptions`'s fix) also stops the wrap, but a
 * `cellgrid` label is drawn without one, at a fixed `y = r.y + CELL_HEAD_H + ri * CELL_ROW_H`, and
 * this cuts the STRING instead so the fix does not lean on a pdfkit option combination that has
 * already been measured doing nothing once.
 *
 * Binary search on character count, not `widthOfString` per character shaved off one at a time —
 * a label column is short and this runs once per row, but there is no reason to make it O(n) when
 * O(log n) measurements answer the same question.
 */
export function truncateToWidth(doc: Doc, text: string, maxW: number): string {
  if (doc.widthOfString(text) <= maxW) return text;
  const ELLIPSIS = '…';
  if (doc.widthOfString(ELLIPSIS) > maxW) return '';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(text.slice(0, mid) + ELLIPSIS) <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + ELLIPSIS;
}

/** Lines a header cell may stack. Two, because `STACKED_HEAD_H` reserves room for exactly two —
 *  a third would be drawn over the first body row. */
export const MAX_HEAD_LINES = 2;

/**
 * One header cell split into the lines it draws as. Always at least one entry, so callers never
 * have to special-case an empty header.
 *
 * ⛔ `max` is NOT decoration — it must be what the band actually reserves. A table that did not
 * opt into `headerRow` gets a `ROW_H` (16pt) band, and a second line drawn at `y + CELL_PAD +
 * HEAD_LINE_H` = y+12 with 12pt of height runs to y+24, over the first body row at y+16. The
 * newline does not have to be authored: `transposeResolved` builds header labels out of
 * first-column DATA, so an organism or drug name carrying a newline would overprint — where
 * pdfkit previously just clipped it to one line. Passing 1 keeps that table byte-identical to
 * before stacking existed.
 */
export function headerLines(text: string, max: number = MAX_HEAD_LINES): string[] {
  return text.split('\n').slice(0, Math.max(1, max));
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
  maxHeadLines: number = MAX_HEAD_LINES,
): number[] {
  const n = Math.max(headers.length, 1);
  const sample = rows.slice(0, WIDTH_SAMPLE_ROWS);
  const natural = Array.from({ length: n }, (_, i) => {
    // ⛔ The WIDEST LINE, not the whole string. A stacked header is drawn as separate lines, so
    // measuring `"2\nFeb"` as one run would reserve the width of `2 Feb` for a column that never
    // draws `2 Feb` — which is the entire reason stacking buys the neighbouring column any room.
    // Inert for a header with no newline: `split` yields one line and this is the old call.
    // ⛔ `maxHeadLines` must match what the band draws. A one-line band that measured the widest
    // of two lines would size the column for text it then clips — the mis-measure half of the
    // same defect as the overprint.
    let w = Math.max(...headerLines(headers[i] ?? '', maxHeadLines).map((line) => measure(line, true)));
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

/** Prefix under which the issuing laboratory's identity is stashed in the token map, so `lab.name`
 *  can never collide with a design parameter that happens to be called `name`. */
const LAB_TOKEN_PREFIX = 'lab.';

/** Rendered in place of a declared-but-unset parameter. A blank beside a label reads as a failed
 *  render; an em dash reads as "not filtered". */
const UNSET = '—';

export function paramMap(
  design: ReportDesign, now: Date, identity?: Record<string, string>, values?: Record<string, unknown>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of design.parameters) {
    // ⛔ A daterange's RUN values are FLAT `from`/`to`, NOT nested under the parameter's own key.
    // The Studio's picker writes top-level `from`/`to` (ReportParametersBar.tsx:38) and the seeded
    // queries declare `from`/`to` as their own text params, so `values['dateRange']` is ALWAYS
    // undefined. Keying on p.key here renders every date range as two em dashes.
    if (p.type === 'daterange') {
      const dflt = (p.value ?? {}) as { from?: string; to?: string };
      // Formatted for the page, not left as raw ISO — the audit called the ISO range mechanical.
      // `formatDisplayDate` passes anything that is not a plain ISO date through untouched, so the
      // UNSET em dash below survives as an em dash.
      m.set('from', formatDisplayDate((values?.from as string) || dflt.from || UNSET));
      m.set('to', formatDisplayDate((values?.to as string) || dflt.to || UNSET));
      continue;
    }
    // Every other parameter is keyed by its own name in both places. The RUN's value wins over the
    // authored default — without that a header describes the design rather than the run it is
    // printed from, which is correct-looking and wrong.
    const run = values?.[p.key];
    const v = run !== undefined && run !== '' ? run : p.value;
    // Declared but unset renders an em dash, not ''. A blank beside a label reads as a failed
    // render, where "—" reads as "not filtered".
    // A `text` parameter can legitimately hold a date — the seeded patient-demographics report
    // declares `asOf` as `type: 'text'` — so route it through `formatDisplayDate` too. That
    // function is a filter, not a parser: it returns its input unchanged unless the value is
    // exactly `YYYY-MM-DD` and a real calendar date, so a code, a GLASS year, or a
    // `Name (CODE)` label built by `withDisplayLabels` passes through untouched.
    m.set(p.key, typeof v === 'string' && v !== '' ? formatDisplayDate(v) : UNSET);
  }
  m.set('date', formatDisplayDateOf(now));
  // Namespaced, and added LAST so a design parameter can never shadow the lab's own identity —
  // a report whose letterhead could be overwritten by a parameter value is a forgery risk, not a
  // convenience.
  for (const [k, v] of Object.entries(identity ?? {})) m.set(LAB_TOKEN_PREFIX + k, v);
  return m;
}

export function interpolate(input: string, tokens: Map<string, string>): string {
  return input
    .replace(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => tokens.get(k) ?? '')
    // `{{lab.name}}` etc. An unset key resolves to '' exactly as an unknown param does, so a design
    // referencing identity stays valid on an install that has not configured it.
    .replace(/\{\{\s*lab\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => tokens.get(LAB_TOKEN_PREFIX + k) ?? '')
    .replace(/\{\{\s*date\s*\}\}/g, tokens.get('date') ?? '');
}

/**
 * Flip a resolved table: the query's COLUMNS become the rows, and its FIRST column's values become
 * the headers.
 *
 * Why this exists rather than a wider table or a smaller font: a matrix with a fixed, large column
 * count and a small data-driven row count cannot fit a page in its natural orientation at any font,
 * because the CELLS set the floor, not the headers. The cumulative antibiogram is 29 drug columns;
 * thirty columns of `100% (12)` need ~840pt where landscape Letter offers 696pt. Flipped, it is 29
 * rows against however many organisms cleared the isolate threshold.
 *
 * The original first column is consumed — its values are now the headers, so leaving it in the body
 * would print a row of organism names under an organism-named column.
 *
 * ⚠ Header KEYS are made unique by index, not taken from the value: two rows sharing a first-column
 * value are two distinct columns, and keying both on the value would silently collapse them into
 * one.
 */
export function transposeResolved(
  resolved: { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] },
  firstColumnLabel = '',
): { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] } {
  const [head, ...rest] = resolved.columns;
  if (!head) return { columns: [], rows: [] };
  const columns = [
    { key: 'c0', label: firstColumnLabel },
    ...resolved.rows.map((row, i) => ({ key: `c${i + 1}`, label: String(row[head.key] ?? '') })),
  ];
  const rows = rest.map((col) => {
    const out: Record<string, unknown> = { c0: col.label };
    resolved.rows.forEach((row, i) => { out[`c${i + 1}`] = String(row[col.key] ?? ''); });
    return out;
  });
  return { columns, rows };
}

/** The resolved table a table element actually draws from — flipped when `transpose` is set, so
 *  headers, body rows, chunking and column widths all derive from ONE source and cannot disagree. */
function effectiveResolved(el: DesignElement, resolved: ResolvedTable | undefined): ResolvedTable | undefined {
  if (!resolved || 'error' in resolved) return resolved;
  if (el.kind !== 'table' || !el.transpose) return resolved;
  return transposeResolved(resolved, el.transposeLabel ?? '');
}

/** `{{sum(elementName.columnKey)}}` in a text element: the numeric sum of that column on the NAMED
 *  same-page bound element, from the RAW resolved rows (never the projected ones, whose own totals
 *  row would double-count). Unresolvable — no such element, unbound, errored, or nothing parseable
 *  — renders the em dash character, matching the unset-param convention above. */
export function resolveSumTokens(text: string, flow?: FlowContext): string {
  return text.replace(/\{\{\s*sum\(([^).]+)\.([^)\s]+)\)\s*\}\}/g, (_m, name: string, key: string) => {
    const el = flow?.page.elements.find((e) => e.name === name);
    const rt = el && el.dataSource ? flow?.resolved.get(el.id) : undefined;
    if (!rt || 'error' in rt) return '—';
    let sum: number | null = null;
    for (const row of rt.rows) {
      const n = Number(row[key]);
      if (Number.isFinite(n) && row[key] !== '' && row[key] != null) sum = (sum ?? 0) + n;
    }
    return sum == null ? '—' : String(sum);
  });
}

/** A cell value as drawn: `decimals` pins numeric formatting (65 beside 23.7 in one column reads
 *  as a mistake); anything that does not parse as a finite number passes through untouched. */
function formatCell(c: { key: string; decimals?: number }, v: unknown): string {
  if (c.decimals == null) return String(v ?? '');
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(c.decimals) : String(v ?? '');
}

/** The projected body rows for a table element (bound → project columns from resolved.rows; static → el.rows; error/unresolved → []). */
export function rowsFor(el: DesignElement, resolved: ResolvedTable | undefined): string[][] {
  if (el.kind === 'cellgrid') return cellGridRowsFor(el, resolved);
  if (el.kind !== 'table') return [];
  if (el.dataSource) {
    const rt = effectiveResolved(el, resolved);
    if (!rt || 'error' in rt) return [];
    const cols = el.boundColumns && el.boundColumns.length ? el.boundColumns : rt.columns;
    return rt.rows.map((row) => cols.map((c) => formatCell(c, row[c.key])));
  }
  return el.rows ?? [];
}

/** A cellgrid's projection: label, then each cell column, then each trailing column. That ORDER is
 *  the contract every other cellgrid function indexes against, so it is built in exactly one place. */
function cellGridRowsFor(el: DesignElement, resolved: ResolvedTable | undefined): string[][] {
  if (!el.dataSource) return el.rows ?? [];
  const rt = effectiveResolved(el, resolved);
  if (!rt || 'error' in rt) return [];
  const keys = [
    ...(el.labelColumn ? [el.labelColumn] : []),
    ...(el.cellColumns ?? []),
    ...(el.trailingColumns ?? []).map((c) => c.key),
  ];
  return rt.rows.map((row) => keys.map((k) => String(row[k] ?? '')));
}

/** True when this element declares its first data row to be the header (`headerRow`). */
function liftsHeaderRow(el: DesignElement): boolean {
  return el.kind === 'table' && el.headerRow === true;
}

/** The data row this table draws as its header, or `undefined` when it does not declare one.
 *
 *  Row 0 of the ALREADY-SORTED rows: `resolveDesignTables` applies `sortBy` before anything here
 *  reads them, so "row 0" means the same thing to every reader. */
export function headerRowFor(el: DesignElement, resolved: ResolvedTable | undefined): string[] | undefined {
  if (!liftsHeaderRow(el)) return undefined;
  return rowsFor(el, resolved)[0];
}

/** The rows this table draws in its BODY — every row for a normal table, everything after row 0
 *  for one that lifts its header out of the data. */
export function bodyRowsFor(el: DesignElement, resolved: ResolvedTable | undefined): string[][] {
  const rows = rowsFor(el, resolved);
  const body = liftsHeaderRow(el) ? rows.slice(1) : rows;
  if (el.kind !== 'table' || !el.totals) return body;
  // The totals row is appended HERE, after the header lift, so pagination counts it and drawing
  // slices it — one source, and the last chunk can never overflow by one row. Sums come from the
  // PROJECTED strings (post-decimals values still parse), formatted by each column's decimals.
  const cols = el.dataSource
    ? (el.boundColumns && el.boundColumns.length ? el.boundColumns : (resolved && 'columns' in resolved ? resolved.columns : []))
    : (el.columns ?? []).map((label, i) => ({ key: String(i), label }));
  const totalsRow = cols.map((c, ci) => {
    if (!el.totals!.columns.includes(c.key)) return '';
    let sum: number | null = null;
    for (const row of body) {
      const n = Number(row[ci]);
      if (Number.isFinite(n) && row[ci] !== '') sum = (sum ?? 0) + n;
    }
    return sum == null ? '' : formatCell(c as { key: string; decimals?: number }, sum);
  });
  // The label takes the first column unless a sum already occupies it.
  if (totalsRow.length > 0 && totalsRow[0] === '') totalsRow[0] = el.totals.label;
  return [...body, totalsRow];
}

/** Height of this table's header band, in pt. */
export function headerBandHeight(el: DesignElement): number {
  return liftsHeaderRow(el) ? STACKED_HEAD_H : ROW_H;
}

/**
 * The text drawn in each header cell.
 *
 * The declared label wins wherever it is non-blank; only a blank one is filled from the header row.
 * That is what lets one design mix "Laboratory" — knowable when the design was authored — with 23
 * day columns whose labels only exist once a month has been chosen, and it means a query cell can
 * never relabel a column somebody published.
 *
 * Padded to the label count, so a short header row leaves the remaining headers blank rather than
 * `undefined` (which would print the string "undefined").
 */
export function headerTexts(labels: string[], headerRow: string[] | undefined): string[] {
  return labels.map((label, i) => (label.trim() !== '' ? label : (headerRow?.[i] ?? '')));
}

/**
 * Whether `el` draws anything on physical chunk `chunk` of its page.
 *
 * A page is as many physical pages as its LONGEST table needs (`pageChunkCount`), so on the last
 * pages the shorter tables have nothing left. Before this, such a table still drew its header band,
 * its rules and its box — an empty framed grid under a heading, which a reader takes as "nothing
 * was submitted" rather than "this grid ended two pages ago".
 *
 * `showWithTable` extends the same answer to the heading or note that belongs to a table. It fails
 * OPEN on a name that is not on the page: a dangling reference is a design defect and deleting its
 * companion from every page would hide the evidence.
 */
export function drawsOnChunk(
  el: DesignElement, page: DesignPage, resolved: Map<string, ResolvedTable>, chunk: number,
): boolean {
  // Hidden means ABSENT, on every chunk, before any other rule gets a say.
  if (el.hidden) return false;
  // ⛔ FIRST, before the table/cellgrid short-circuit below. A bound element answers that question
  // from its own chunk count and would never reach this line, and a bound calendar is exactly the
  // element `showOn` exists for. See its doc comment in `schema.ts`.
  if (el.showOn === 'first-chunk' && chunk > 0) return false;
  if (el.kind === 'table' || el.kind === 'cellgrid') {
    return elementDrawsOnChunk(el, resolved.get(el.id), chunk, { page, resolved });
  }
  if (!el.showWithTable) return true;
  // ⛔ `cellgrid` is accepted here too. `showWithTable` names the element a heading belongs to, and
  // the reason it exists (never print a heading over a block that finished earlier) applies to a
  // cellgrid exactly as it does to a table.
  const target = page.elements.find(
    (e) => e.id === el.showWithTable && (e.kind === 'table' || e.kind === 'cellgrid'),
  );
  if (!target) return true;
  return elementDrawsOnChunk(target, resolved.get(target.id), chunk, { page, resolved });
}

/** ⛔ A FAILED table keeps drawing on every chunk. Running out of rows and failing to run are not
 *  the same condition: the first is finished, the second is a defect that is just as true on page 3
 *  as on page 1, and a reader who is handed only the last page must still see it. */
function elementDrawsOnChunk(
  el: DesignElement, resolved: ResolvedTable | undefined, chunk: number, flow?: FlowContext,
): boolean {
  if (el.dataSource && resolved && 'error' in resolved) return true;
  return chunk < elementChunkCount(el, resolved, flow);
}

/** One column's status for one row: `statusKey` wins (data carrying judgment is not second-guessed
 *  by a display rule); else the authored rule evaluates against the column's OWN value — numeric
 *  compare when both sides parse, string equality otherwise. */
export function statusOf(
  c: { key: string; statusKey?: string; rule?: { op: 'gte' | 'lte' | 'eq' | 'neq'; value: string; status: CellStatus } },
  row: Record<string, unknown>,
): CellStatus | undefined {
  if (c.statusKey) return asCellStatus(row[c.statusKey]);
  if (!c.rule) return undefined;
  const raw = row[c.key];
  const a = Number(raw);
  const b = Number(c.rule.value);
  const numeric = Number.isFinite(a) && Number.isFinite(b) && String(raw).trim() !== '';
  const hit = c.rule.op === 'gte' ? (numeric ? a >= b : false)
    : c.rule.op === 'lte' ? (numeric ? a <= b : false)
    : c.rule.op === 'eq' ? (numeric ? a === b : String(raw ?? '') === c.rule.value)
    : (numeric ? a !== b : String(raw ?? '') !== c.rule.value);
  return hit ? c.rule.status : undefined;
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
  if (!cols.some((c) => c.statusKey || c.rule)) return [];
  return resolved.rows.map((row) => cols.map((c) => statusOf(c, row)));
}

/**
 * Per-record status for each `cellgrid` trailing column that declares a `statusKey`, one entry per
 * RECORD (the synthetic header/group rows already stripped), one status per `el.trailingColumns`
 * in order. `[]` when no trailing column carries a `statusKey` — the compatibility contract
 * `cellStatusesFor` documents above, so a cellgrid that does not opt in draws exactly the plain-text
 * path it always has.
 *
 * ⛔ NOT read off `rowsFor`'s projected row array. `cellGridRowsFor` projects each trailing
 * column's `key` (the DISPLAYED value — a count, in this design) but never its `statusKey`: most
 * designs bind no trailing status at all, and adding an invisible column to every projected row
 * would be dead weight for every one of them. This reads `resolved.rows` directly instead, the same
 * way `cellStatusesFor` does for `table`, and relies on the SAME already-sorted order
 * `resolveDesignTables` produced — `cellGridRowsFor` reads that identical array, so index `i` here
 * is index `i` there.
 */
export function cellGridTrailingStatusesFor(
  el: DesignElement, resolved: ResolvedTable | undefined,
): (CellStatus | undefined)[][] {
  if (el.kind !== 'cellgrid' || !el.dataSource) return [];
  if (!resolved || 'error' in resolved) return [];
  const cols = el.trailingColumns ?? [];
  if (!cols.some((c) => c.statusKey || c.rule)) return [];
  const lift = cellGridLift(el.groupBoundary === 'token-change');
  return resolved.rows.slice(lift).map((row) => cols.map((c) => statusOf(c, row)));
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
/** `stat` box pitch. Taller than `inline`/`stacked`: a stat panel holds two stacked lines at
 *  much larger sizes, not one line of label-and-value. */
const KV_STAT_H = 40;
/** Visible gutter below each stat box, so four boxes in a 2x2 grid read as separate cards rather
 *  than one solid block. Subtracted from KV_STAT_H, not added to it: the row PITCH stays
 *  KV_STAT_H so the grid math in pairRects does not need a second constant. */
const KV_STAT_VGAP = 6;
const KV_STAT_VALUE_SIZE = 18;
const KV_STAT_LABEL_SIZE = 7;

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
        status: row ? statusOf(bc, row) : undefined,
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
/** Helvetica's cap height as a fraction of the point size, from the font's own metrics. Used to
 *  find where a line of capitals or digits actually ENDS, which is its baseline, rather than where
 *  its line box does. */
const HELVETICA_CAP = 0.718;


/**
 * Geometry for `n` pairs inside panel box `r`, flowing ACROSS then down.
 *
 * Extracted from the drawer and pure so pitch, flow order and the title offset are testable without
 * a PDF document — the same seam `columnWidths` uses. Pairs beyond the box's height are still
 * returned: clipping is the drawer's job (`doc.clip()`), and truncating here would make the helper
 * disagree with what the reader sees at the boundary.
 */
export function pairRects(
  r: Box, n: number, layout: 'inline' | 'stacked' | 'stat', panelColumns: number, hasTitle: boolean,
): PairBox[] {
  const cols = Math.max(1, Math.min(4, Math.floor(panelColumns) || 1));
  const pitch = layout === 'stacked' ? KV_STACKED_H : layout === 'stat' ? KV_STAT_H : KV_INLINE_H;
  const x0 = r.x + KV_PAD_X;
  const y0 = r.y + (hasTitle ? KV_TITLE_H : 0) + KV_PAD_Y;
  const innerW = Math.max(0, r.w - KV_PAD_X * 2);
  const cellW = (innerW - KV_GUTTER * (cols - 1)) / cols;
  return Array.from({ length: Math.max(0, n) }, (_, i) => {
    const x = x0 + (i % cols) * (cellW + KV_GUTTER);
    const y = y0 + Math.floor(i / cols) * pitch;
    const cell = { x, y, w: cellW, h: pitch };
    if (layout === 'stat') {
      const boxH = pitch - KV_STAT_VGAP;
      const valueLh = lineH(KV_STAT_VALUE_SIZE);
      const labelLh = lineH(KV_STAT_LABEL_SIZE);
      // ⛔ Centre the INK, not the two line boxes. Both strings here are a number and an uppercase
      // caption, so neither has a descender, and pdfkit puts a line box's TOP at the cap top: the
      // ink starts at `innerY` and stops at the caption's BASELINE, leaving the caption's own
      // descender space empty. Charging that empty space to the block pushed everything up by half
      // of it. MEASURED on a rendered page, 2026-08-20: a 34pt card carried 2.63pt above the digits
      // and 5.65pt below the caption, which reads as bottom padding with none on top.
      const inkH = valueLh + KV_STAT_LABEL_SIZE * HELVETICA_CAP;
      const innerY = y + (boxH - inkH) / 2;
      return {
        ...cell,
        value: { x, y: innerY, w: cellW, h: valueLh },
        label: { x, y: innerY + valueLh, w: cellW, h: labelLh },
      };
    }
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

/** Pair values as DRAWN: authored (unbound) values resolve `{{...}}` tokens exactly as a text
 *  element does; BOUND values never do.
 *  ⛔ The asymmetry is a security property, not an oversight — interpolating query data would let a
 *  result cell containing `{{lab.name}}` forge letterhead into the body of a report. */
export function interpolatedPairValues(
  el: DesignElement, resolved: ResolvedTable | undefined, tokens: Map<string, string>,
): string[] {
  const bound = Boolean(el.kind === 'keyvalue' && el.dataSource);
  return keyValuePairs(el, resolved).map((p) => (bound ? p.value : interpolate(p.value, tokens)));
}

function drawKeyValue(doc: Doc, el: DesignElement, r: Box, resolved: ResolvedTable | undefined, tokens: Map<string, string>): void {
  if (el.dataSource && resolved && 'error' in resolved) { drawErrorPlaceholder(doc, r, resolved.error); return; }
  const s = el.style ?? {};
  const title = interpolate(el.text ?? '', tokens).trim();
  const pairs = keyValuePairs(el, resolved);
  const values = interpolatedPairValues(el, resolved, tokens);
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
    doc.save().lineWidth((s.strokeWidth ?? 0.5) * PX_TO_PT).strokeColor(s.strokeColor)
      .rect(r.x, r.y, r.w, r.h).stroke().restore();
  }

  const boxes = pairRects(r, pairs.length, layout, el.panelColumns ?? 1, !!title);
  pairs.forEach((p, i) => {
    const b = boxes[i];

    // `stat` is a fully separate branch, not folded into the shared inline/stacked drawing below.
    // It draws the VALUE first and BOLD, and the caption second and small — the opposite order and
    // weighting from inline/stacked, because a stat panel is scanned by number first, caption
    // second. Sharing one code path with inline/stacked would reorder THEIR draw calls too, which
    // changes the bytes of the content stream even though the rendered pixels are unchanged — that
    // is what golden.test.ts's digest caught here.
    if (layout === 'stat') {
      // The box itself, inset by half the vertical gutter so adjacent stat boxes read as
      // separate cards. Reuses HEAD_FILL rather than introducing a new near-duplicate tint.
      doc.rect(b.x, b.y, b.w, b.h - KV_STAT_VGAP).fill(HEAD_FILL);
      doc.font('Helvetica-Bold').fontSize(KV_STAT_VALUE_SIZE).fillColor('#0f172a')
        .text(values[i], b.value.x, b.value.y,
          { width: b.value.w, height: b.value.h, ellipsis: true, align: 'center' });
      doc.font('Helvetica').fontSize(KV_STAT_LABEL_SIZE).fillColor(KV_LABEL_COLOR)
        .text(p.label.toUpperCase(), b.label.x, b.label.y,
          { width: b.label.w, height: b.label.h, ellipsis: true, align: 'center' });
      return;
    }

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
    const value = values[i];
    // `chip` and `fill` coincide here on purpose: this fill already hugged the value text.
    const chip = p.status && (p.emphasis === 'fill' || p.emphasis === 'chip');
    const pad = chip ? CELL_PAD : 0;
    let valueColor = BODY_TEXT;
    if (chip) {
      const w = Math.min(doc.widthOfString(value) + pad * 2, b.value.w);
      doc.rect(b.value.x, b.value.y - CHIP_INSET_Y, w, b.value.h + CHIP_INSET_Y * 2).fill(STATUS_CHIP_FILL[p.status!]);
      valueColor = STATUS_CHIP_TEXT[p.status!];
    } else if (p.status) {
      valueColor = STATUS_TEXT_COLOR[p.status];
    }
    doc.fillColor(valueColor).text(value, b.value.x + pad, b.value.y,
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

/**
 * What an element needs to know about the PAGE around it, for the two declarations whose answer
 * depends on it: `flowAfter` (where the element starts) and `fillTo` (how much room that leaves).
 *
 * Optional at every call site, and the answer is identical without it for the elements that declare
 * neither, which is every element in every design that has not opted in.
 *
 * `seen` is `resolveFlowY`'s cycle guard, carried through so a `fillTo` element whose height is being
 * measured mid-resolution still throws on a cycle instead of recursing forever.
 */
export interface FlowContext {
  page: DesignPage;
  resolved: Map<string, ResolvedTable>;
  seen?: ReadonlySet<string>;
}

/**
 * Records this cellgrid draws on each chunk. The ONE answer `elementChunkCount`, `drawnHeight` and
 * `drawCellGrid` all read. See `cellGridRowSchedule` for why this is a loop and not a division.
 */
function cellGridScheduleFor(
  el: DesignElement, resolved: ResolvedTable | undefined, flow?: FlowContext,
): number[] {
  const body = splitCellGridRows(rowsFor(el, resolved), el.groupBoundary === 'token-change').body;
  return cellGridRowSchedule(body.length, (chunk) => elementHeight(el, chunk, flow), el.id);
}

/**
 * The height, in pt, the element's BOX has on chunk `chunk`.
 *
 * The declared rect height, unless the element declares `fillTo`. Then its bottom edge is fixed and
 * its top is wherever `flowAfter` put it, so the box is whatever is left between them.
 */
function elementHeight(el: DesignElement, chunk: number, flow?: FlowContext): number {
  const box = toPt(el.rect);
  if (el.kind !== 'cellgrid' || el.fillTo !== 'rect-bottom' || !flow) return box.h;
  return box.y + box.h - resolveFlowY(el, flow.page, flow.resolved, chunk, flow.seen);
}

/** How many physical pages this one table needs (repeat-page model). 1 for non-tables/errors/degenerate boxes. */
export function elementChunkCount(
  el: DesignElement, resolved: ResolvedTable | undefined, flow?: FlowContext,
): number {
  // A hidden element never extends the page run, however many rows its query returns.
  if (el.hidden) return 1;
  if (el.kind === 'cellgrid') return cellGridScheduleFor(el, resolved, flow).length;
  if (el.kind !== 'table') return 1;
  const maxRows = maxRowsFor(toPt(el.rect).h, headerBandHeight(el));
  if (maxRows < 1) return 1;
  const rowCount = bodyRowsFor(el, resolved).length;
  return Math.max(1, Math.ceil(rowCount / maxRows));
}

/** Physical pages needed for a design page = the largest table's chunk count (min 1). */
export function pageChunkCount(page: DesignPage, resolved: Map<string, ResolvedTable>): number {
  return Math.max(1, ...page.elements.map(
    (el) => elementChunkCount(el, resolved.get(el.id), { page, resolved }),
  ));
}

/** Total physical PDF pages across the whole design = sum of each design page's chunk count. */
export function totalPhysicalPages(pages: DesignPage[], resolved: Map<string, ResolvedTable>): number {
  return pages.reduce((sum, p) => sum + pageChunkCount(p, resolved), 0);
}

/** Footer label for physical page `n` of `total` (hardcoded English, like the "Query error:" text). */
export function pageFooterLabel(n: number, total: number): string {
  return `Page ${n} / ${total}`;
}

/**
 * The height, in pt, `el` actually draws on chunk `chunk` — for `flowAfter`, never for anything
 * else.
 *
 * ⛔ NOT `toPt(el.rect).h`. That is the MOST an element may occupy, declared at design time; a
 * `cellgrid`/`table` almost never fills it, which is the entire reason `flowAfter` exists — see
 * its doc comment in `schema.ts`. The one exception is a FAILED query: `elementDrawsOnChunk` keeps
 * a broken table/cellgrid drawing on every chunk, and it always paints the full error-placeholder
 * box, so this returns the full rect height for that case, matching what actually lands on the
 * page.
 *
 * A chunk this element does not reach at all (its rows ran out on an earlier page) draws nothing —
 * zero — which is what lets a `flowAfter` follower move up and take its place.
 */
export function drawnHeight(
  el: DesignElement, resolved: ResolvedTable | undefined, chunk: number, flow?: FlowContext,
): number {
  // An element `showOn` keeps off this chunk draws nothing, so it adds nothing to a follower and
  // the block below it moves up into its place. ⛔ Deliberately narrower than "anything
  // `drawsOnChunk` hides": consulting that predicate here would recurse forever for a
  // `showWithTable` target, whose visibility depends on the follower whose height is being measured.
  // See `showOn` in `schema.ts`.
  if (el.showOn === 'first-chunk' && chunk > 0) return 0;
  // Hidden draws nothing anywhere, so a follower takes its place — same shape as the showOn rule
  // above, and safe here for the same reason: hidden consults no other element's visibility.
  if (el.hidden) return 0;
  // The box the element actually paints into: its declared height, or the filled one when it
  // declares `fillTo`. The error placeholder below fills that box, whichever it is.
  const boxH = elementHeight(el, chunk, flow);
  if (el.dataSource && resolved && 'error' in resolved) return boxH;
  if (el.kind !== 'cellgrid' && el.kind !== 'table') return boxH;
  if (el.kind === 'cellgrid') {
    const schedule = cellGridScheduleFor(el, resolved, flow);
    if (chunk >= schedule.length) return 0;
    return CELL_HEAD_H + schedule[chunk] * CELL_ROW_H;
  }
  if (chunk >= elementChunkCount(el, resolved, flow)) return 0;
  const headH = headerBandHeight(el);
  const maxRows = maxRowsFor(boxH, headH);
  const rowCount = bodyRowsFor(el, resolved).length;
  const rowsInChunk = maxRows < 1 ? 0 : Math.max(0, Math.min(maxRows, rowCount - chunk * maxRows));
  return headH + rowsInChunk * ROW_H;
}

/**
 * The y (pt) `el` actually draws at on chunk `chunk`, honouring `flowAfter` (see `schema.ts`).
 *
 * `seen` carries every id visited on THIS resolution, so a cycle — including a straight
 * self-reference — throws instead of looping: a page has finitely many elements, so recursing here
 * either lands on an element with no `flowAfter`, a name not on the page, or an id already in
 * `seen`. There is no fourth outcome, so this cannot spin.
 */
export function resolveFlowY(
  el: DesignElement, page: DesignPage, resolved: Map<string, ResolvedTable>, chunk: number,
  seen: ReadonlySet<string> = new Set(),
): number {
  const declared = toPt(el.rect).y;
  if (!el.flowAfter) return declared;
  if (seen.has(el.id)) {
    const path = [...seen, el.id].join(' -> ');
    throw new Error(`report design '${page.id}': flowAfter cycle at '${el.id}' (${path})`);
  }
  const target = page.elements.find((e) => e.id === el.flowAfter);
  // Fails OPEN, same contract `showWithTable` documents: a dangling reference is a design defect,
  // not a reason to jump this element somewhere unrelated.
  if (!target) return declared;
  const nextSeen = new Set(seen);
  nextSeen.add(el.id);
  const targetY = resolveFlowY(target, page, resolved, chunk, nextSeen);
  // `nextSeen`, not `seen`: measuring a `fillTo` target means resolving its own y, which walks
  // further up the chain. Carrying the guard is what keeps a cycle throwing instead of recursing.
  const drawn = drawnHeight(target, resolved.get(target.id), chunk, { page, resolved, seen: nextSeen });
  // `flowGap` is charged even when the target drew nothing: a section break is a property of the
  // block below it, not of whatever happens to sit above.
  return targetY + drawn + (el.flowGap ?? 0) * PX_TO_PT;
}

/** Draw the "Page X / Y" footer centered ~24pt above the bottom edge of a full-bleed page. */
export function drawPageFooter(doc: Doc, wPt: number, hPt: number, n: number, total: number): void {
  doc.save().font('Helvetica').fontSize(8).fillColor('#737373')
    .text(pageFooterLabel(n, total), 0, hPt - 24, { width: wPt, align: 'center' });
  doc.restore();
}

export function drawElement(
  doc: Doc, el: DesignElement, tokens: Map<string, string>, resolved: ResolvedTable | undefined, chunk = 0,
  // `flowAfter`'s resolved y, in pt. The caller always passes `resolveFlowY`'s result — for an
  // element with no `flowAfter` that is exactly `toPt(el.rect).y`, so this parameter changes
  // nothing for the (still overwhelmingly common) design that never opts in.
  yPt?: number,
  // The page around this element, needed only by `fillTo`. See `FlowContext`.
  flow?: FlowContext,
): void {
  const box = toPt(el.rect);
  // A `fillTo` element keeps its BOTTOM edge and takes everything down to it, so the box grows by
  // exactly what `flowAfter` moved it up. Every other element keeps its authored height.
  const y = yPt ?? box.y;
  const r = { ...box, y, h: el.fillTo === 'rect-bottom' && el.kind === 'cellgrid' ? box.y + box.h - y : box.h };
  const s = el.style ?? {};
  switch (el.kind) {
    case 'rect': {
      if (s.fill && s.fill !== 'none') doc.save().rect(r.x, r.y, r.w, r.h).fill(s.fill).restore();
      // Authored widths are px@96 like every other design length; consumed raw as POINTS they drew
      // every border a third too thick. Converted default-inclusive, exactly as fontSize is.
      doc.save().lineWidth((s.strokeWidth ?? 1) * PX_TO_PT).strokeColor(s.strokeColor ?? RECT_BORDER)
        .rect(r.x, r.y, r.w, r.h).stroke().restore();
      return;
    }
    case 'line': {
      doc.save().lineWidth((s.strokeWidth ?? 1) * PX_TO_PT).strokeColor(s.strokeColor ?? LINE_COLOR)
        .moveTo(r.x, r.y).lineTo(r.x + r.w, r.y + r.h).stroke().restore();
      return;
    }
    case 'text':
    case 'datetime': {
      const raw = el.text ?? (el.kind === 'datetime' ? '{{date}}' : '');
      drawText(doc, resolveSumTokens(interpolate(raw, tokens), flow), r, s);
      return;
    }
    case 'chart': {
      // A failed query gets the same red placeholder every bound kind gets; drawChart never sees it.
      if (el.dataSource && resolved && 'error' in resolved) { drawErrorPlaceholder(doc, r, resolved.error); return; }
      drawChart(doc, el, r, resolved);
      return;
    }
    case 'letterhead': {
      // One block, expanded from the single source of letterhead geometry. `y` honours flowAfter
      // the way every element does: the children are laid out from the flowed origin.
      const base = y === box.y ? el : { ...el, rect: { ...el.rect, y: y / PX_TO_PT } };
      for (const child of letterheadElements(base)) drawElement(doc, child, tokens, undefined, chunk);
      return;
    }
    case 'image': {
      // Interpolated like text, so `src: "{{lab.logo}}"` resolves to the configured logo.
      //
      // ⚠ MEASURED: pdfkit treats a URL src as a FILE PATH and throws ENOENT — only `data:` URIs
      // (and real local paths) draw. An `https://` logo therefore renders fine on the studio canvas,
      // where `<img>` is perfectly happy with it, and silently becomes the dashed placeholder below
      // in the PDF. That is why `lab.logo` is validated as a data URI at WRITE time rather than
      // here: by the time we are drawing, there is nobody left to tell.
      const src = el.src ? interpolate(el.src, tokens) : '';
      // An UNSET slot prints nothing: every install without a configured logo used to stamp a
      // dashed rectangle onto the letterhead of every report, which a reader takes as "something
      // failed". Empty-after-interpolation means "this install has no logo", not a defect. The
      // canvas keeps its placeholder — authoring still needs to see the slot.
      if (!src) return;
      doc.save();
      try { doc.image(src, r.x, r.y, { fit: [r.w, r.h] }); doc.restore(); return; }
      catch { doc.restore(); /* a src that RESOLVED but cannot draw is a real defect — show it */ }
      doc.save().lineWidth(1).strokeColor(RECT_BORDER).dash(3, { space: 2 })
        .rect(r.x, r.y, r.w, r.h).stroke().undash().restore();
      return;
    }
    case 'table': {
      drawTable(doc, el, r, resolved, chunk);
      return;
    }
    case 'cellgrid': {
      drawCellGrid(doc, el, r, resolved, chunk, flow);
      return;
    }
    case 'keyvalue': {
      drawKeyValue(doc, el, r, resolved, tokens);
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
  const lift = liftsHeaderRow(el);
  const headers = headerTexts(tableHeaders(el, resolved), headerRowFor(el, resolved));
  const allRows = bodyRowsFor(el, resolved);
  // Statuses are indexed in lockstep with the rows, so the lift has to shift them too — otherwise
  // every chip moves up one row and colours the wrong laboratory.
  const allStatuses = cellStatusesFor(el, resolved);
  const statuses = lift ? allStatuses.slice(1) : allStatuses;
  const cols = el.boundColumns ?? [];
  const emphasis = cols.map((c) => c.emphasis ?? 'text');
  const kinds = cols.map((c) => c.kind);
  drawGrid(doc, r, headers, allRows, chunk, statuses, emphasis, kinds, headerBandHeight(el), Boolean(el.totals));
}

/**
 * One row per record: a label, a run of fixed-size filled squares, then declared-width text columns.
 *
 * ⛔ Nothing here measures a string to decide a width. Every horizontal position comes from the
 * constants in `cellgrid.ts`, which is what lets 23 columns fit A4 portrait where `table`'s
 * measured-and-floored widths cannot.
 */
/**
 * Top offset inside a cellgrid row for a line of digits or capitals at `size`, so its INK centres
 * on the RUN OF CELLS beside it.
 *
 * CELL_SIZE, not CELL_ROW_H. The squares are what a reader reads as the row; the extra 2.25pt of
 * pitch below them is the gap to the next one. Everything on the row lines up on the squares'
 * centre: the laboratory name, both trailing values, and the chip behind one of them.
 *
 * ⛔ Ink, not line box. pdfkit puts a line box's top at the cap top for a string with no descender,
 * and its bottom is then the BASELINE, not the box. Centring the box instead leaves the text high
 * by half the unused descender space, which is what put a Silent count at the top of its own pill.
 */
const cellRowInkY = (size: number): number => (CELL_SIZE - size * HELVETICA_CAP) / 2;

function drawCellGrid(
  doc: Doc, el: DesignElement, r: Box, resolved: ResolvedTable | undefined, chunk: number,
  flow?: FlowContext,
): void {
  if (el.dataSource && resolved && 'error' in resolved) { drawErrorPlaceholder(doc, r, resolved.error); return; }

  const grouped = el.groupBoundary === 'token-change';
  const split = splitCellGridRows(rowsFor(el, resolved), grouped);
  const hasLabel = Boolean(el.labelColumn);
  const cellCount = (el.cellColumns ?? []).length;
  const trailing = el.trailingColumns ?? [];
  const palette = el.palette ?? { ramp: 'blue' as const, steps: 1 };

  // Every projected row is [label?, ...cells, ...trailing], so a cell's slot is offset by the label.
  const cellIndex = (i: number): number => (hasLabel ? 1 : 0) + i;

  const cellStart = hasLabel ? CELL_LABEL_W + CELL_COL_GAP : 0;
  // ⛔ Sliced to EXACTLY the cell range. Passing the trailing-column tokens too happens to be
  // harmless, because a spurious break lands at an index `stripWidth` and `xOfCell` both discard.
  // That is a coincidence of index ranges, not a design, and it stops being true the moment the
  // trailing columns carry varying tokens.
  const cellsFrom = hasLabel ? 1 : 0;
  const breaks = grouped ? groupBreaks(split.groups?.slice(cellsFrom, cellsFrom + cellCount)) : [];
  const xOfCell = (i: number): number => {
    let x = r.x + cellStart;
    for (let k = 0; k < i; k += 1) x += CELL_SIZE + (breaks.includes(k + 1) ? GROUP_GAP : CELL_GAP);
    return x;
  };
  const trailingStart = r.x + cellStart + stripWidthOf(cellCount, breaks);

  // ⚠ The maximum is taken over EVERY record, not over the chunk being drawn. A per-chunk maximum
  // would re-scale the ramp on page 2 and paint the same value two different colours in one
  // document.
  let max = 0;
  for (const row of split.body) {
    for (let i = 0; i < cellCount; i += 1) {
      const v = Number(row[cellIndex(i)]);
      if (Number.isFinite(v) && v > max) max = v;
    }
  }

  doc.save().rect(r.x, r.y, r.w, r.h).clip();

  // Header band: cell labels then trailing labels, redrawn on every chunk.
  doc.font('Helvetica').fontSize(6).fillColor(HEAD_RULE);
  for (let i = 0; i < cellCount; i += 1) {
    const text = split.header[cellIndex(i)] ?? '';
    if (text) doc.text(text, xOfCell(i), r.y + 3, { width: CELL_SIZE, align: 'center', lineBreak: false });
  }
  let hx = trailingStart;
  for (const c of trailing) {
    hx += CELL_COL_GAP;
    doc.text(c.label, hx, r.y + 3, { width: c.width, align: 'center', lineBreak: false });
    hx += c.width;
  }

  // Records. ⛔ The slice comes from the SAME schedule the chunk count was taken from, never from a
  // division computed here. See `cellGridRowSchedule`. With `fillTo` the capacity differs per page,
  // so `chunk * perChunk` is not this chunk's first record and never was safe to assume.
  const schedule = cellGridScheduleFor(el, resolved, flow);
  const from = cellGridChunkStart(schedule, chunk);
  const slice = split.body.slice(from, from + (schedule[chunk] ?? 0));
  const trailingStatuses = cellGridTrailingStatusesFor(el, resolved);
  slice.forEach((row, ri) => {
    const y = r.y + CELL_HEAD_H + ri * CELL_ROW_H;
    if (hasLabel) {
      doc.font('Helvetica').fontSize(8).fillColor(BODY_TEXT)
        .text(truncateToWidth(doc, row[0] ?? '', CELL_LABEL_W), r.x, y + cellRowInkY(8), { width: CELL_LABEL_W, lineBreak: false });
    }
    for (let i = 0; i < cellCount; i += 1) {
      doc.rect(xOfCell(i), y, CELL_SIZE, CELL_SIZE).fill(cellFill(Number(row[cellIndex(i)]), max, palette));
    }
    let x = trailingStart;
    // `from + ri` is this row's index in `split.body`, which `trailingStatuses` is aligned to (both
    // are `resolved.rows` with the same synthetic header/group rows stripped).
    const rowStatuses = trailingStatuses[from + ri];
    trailing.forEach((c, ci) => {
      x += CELL_COL_GAP;
      const v = row[cellIndex(cellCount) + ci] ?? '';
      const st = rowStatuses?.[ci];
      // A trailing cell is already chip-sized, so `chip` and `fill` coincide here too.
      const filled = Boolean(st) && ((c.emphasis ?? 'text') === 'fill' || c.emphasis === 'chip');
      if (filled) {
        // Same centre line as the value it sits behind, and as the cells to its left.
        const chipH = CELL_ROW_H - CHIP_INSET_Y * 2;
        doc.rect(x + CHIP_INSET_X, y + (CELL_SIZE - chipH) / 2, c.width - CHIP_INSET_X * 2, chipH)
          .fill(CELL_CHIP_FILL);
      }
      // ⛔ The cellgrid's own two colours, never the clinical status palette. See `CELL_CHIP_FILL`.
      // The token still decides WHETHER the value is emphasised; it never decides in what colour.
      doc.font('Helvetica').fontSize(7)
        .fillColor(filled ? CELL_CHIP_TEXT : (st ? CELL_CHIP_FILL : BODY_TEXT))
        .text(v, x, y + cellRowInkY(7), { width: c.width, align: 'center', lineBreak: false });
      x += c.width;
    });
  });

  doc.restore();
}

export function tableHeaders(el: DesignElement, resolved: ResolvedTable | undefined): string[] {
  if (!el.dataSource) return el.columns ?? [];
  const rt = effectiveResolved(el, resolved);
  const cols = el.boundColumns && el.boundColumns.length
    ? el.boundColumns
    : (rt && !('error' in rt) ? rt.columns : []);
  return cols.map((c) => c.label);
}

function drawGrid(
  doc: Doc, r: Box, headers: string[], allRows: string[][], chunk: number,
  allStatuses: (CellStatus | undefined)[][] = [], emphasis: CellEmphasis[] = [],
  kinds: (ColumnKind | undefined)[] = [], headH: number = ROW_H,
  // `bodyRowsFor` already APPENDED the totals row; this only says the absolute-last row gets the
  // bold face and its closing rule. It lands on whatever chunk the slice puts it on.
  totals = false,
): void {
  const n = Math.max(headers.length, 1);
  // ⛔ Derived from the band this table actually reserves, never a constant. `headerBandHeight`
  // gives STACKED_HEAD_H only to a table that declared `headerRow`; every other table gets ROW_H
  // and may draw exactly one header line. Tying the two together here is what makes it impossible
  // for a caller to reserve one line's worth of band and then draw two.
  const maxHeadLines = headH >= STACKED_HEAD_H ? MAX_HEAD_LINES : 1;
  const maxRows = maxRowsFor(r.h, headH);
  const lo = chunk * maxRows;
  const rows = maxRows >= 1 ? allRows.slice(lo, lo + maxRows) : [];
  const statuses = maxRows >= 1 ? allStatuses.slice(lo, lo + maxRows) : [];

  // Widths come from ALL rows, not just this chunk, so a column keeps the same width on every page.
  const widths = columnWidths(headers, allRows, r.w, (text, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    return doc.widthOfString(text);
  }, maxHeadLines);
  const xOf = (ci: number): number => r.x + widths.slice(0, ci).reduce((a, b) => a + b, 0);
  const numeric = headers.map((_, ci) => isRightAligned(allRows, ci, kinds[ci]));

  doc.save().rect(r.x, r.y, r.w, r.h).clip();

  // Header: a tinted band closed by a rule. The rule is what separates "a table" from "rows of
  // text" — the old fill alone left the header floating.
  doc.rect(r.x, r.y, r.w, headH).fill(HEAD_FILL);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(HEAD_TEXT);
  // Each line is its own `doc.text` at a fixed y, for the same reason body cells are: pdfkit only
  // ellipsizes text it has constrained VERTICALLY, and a wrapped header would land on the row
  // beneath it. `cellTextOptions`' height fits exactly one line, so each call draws one.
  headers.forEach((h, i) => headerLines(h, maxHeadLines).forEach((line, li) => doc.text(
    line, xOf(i) + CELL_PAD, r.y + CELL_PAD + li * HEAD_LINE_H,
    { ...cellTextOptions(widths[i] - CELL_PAD * 2), align: numeric[i] ? 'right' : 'left' },
  )));
  doc.save().lineWidth(0.75).strokeColor(HEAD_RULE)
    .moveTo(r.x, r.y + headH).lineTo(r.x + r.w, r.y + headH).stroke().restore();

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
    const y = r.y + headH + ri * ROW_H;
    const isTotals = totals && lo + ri === allRows.length - 1;
    if (isTotals) {
      doc.save().lineWidth(0.75).strokeColor(HEAD_RULE)
        .moveTo(r.x, y).lineTo(r.x + r.w, y).stroke().restore();
      doc.font('Helvetica-Bold').fontSize(8);
    }
    if (ri % 2 === 1 && !isTotals) { doc.rect(r.x, y, r.w, ROW_H).fill(ZEBRA_FILL); lastFill = ZEBRA_FILL; }
    row.forEach((cell, ci) => {
      const st = statuses[ri]?.[ci];
      // A chip is exactly one row tall and one column wide, so it can never affect the y-advance.
      if (st && (emphasis[ci] ?? 'text') === 'fill') {
        doc.rect(xOf(ci) + CHIP_INSET_X, y + CHIP_INSET_Y, widths[ci] - CHIP_INSET_X * 2, ROW_H - CHIP_INSET_Y * 2)
          .fill(STATUS_CHIP_FILL[st]);
        lastFill = STATUS_CHIP_FILL[st];
        setFill(STATUS_CHIP_TEXT[st]);
      } else if (st && emphasis[ci] === 'chip') {
        // T5: a pill hugging the TEXT, not the column — a full-width Resistant bar across a 350pt
        // column shouts. Positioned against the same edge the text aligns to, clamped to the cell.
        const textW = doc.widthOfString(cell);
        const chipW = Math.min(textW + CELL_PAD * 2, widths[ci] - CHIP_INSET_X * 2);
        const chipH = ROW_H - CHIP_INSET_Y * 2;
        const chipX = numeric[ci]
          ? xOf(ci) + widths[ci] - CELL_PAD - textW - CELL_PAD
          : xOf(ci) + CHIP_INSET_X;
        doc.roundedRect(Math.max(xOf(ci) + CHIP_INSET_X, chipX), y + CHIP_INSET_Y, chipW, chipH, chipH / 2)
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
  const bodyEnd = r.y + headH + rows.length * ROW_H;
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
