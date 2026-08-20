import type { CellPalette, CellRamp } from '../schema';

/**
 * Geometry for a `cellgrid`, in POINTS.
 *
 * ⚠ Points, like every other constant in this renderer. A design rect is px@96 and `toPt` converts
 * it before any of this applies. Doing this arithmetic against an unconverted rect overstates
 * capacity by a third.
 *
 * ⛔ These are DECLARED, never measured. `table` derives a column width from the widest string it
 * holds and floors the result at `MIN_COL_W` (22pt), which is exactly why a 23-column grid cannot
 * fit A4 portrait and why the report it serves is landscape today. A cell holds no text, so there
 * is nothing to measure and no floor to honour. That is the whole reason this element exists.
 */
export const CELL_SIZE = 10.5;
/** Between two cells inside a group. Keeps adjacent fills from reading as one merged slab, the same
 *  job `CHIP_INSET_X` does for a table. */
export const CELL_GAP = 1.5;
/** At a group break. Five times the small gap, so a break reads as structure rather than as a
 *  slightly larger gap. */
export const GROUP_GAP = 7.5;
/** Baseline row pitch. Its own constant: no formula ties it to `CELL_SIZE`, and the 2.25pt
 *  difference between them is not derived from anything. Settled by eye over preview rounds,
 *  the same way `CELL_SIZE` was. Stated rather than computed so nobody goes looking for the
 *  relationship. */
export const CELL_ROW_H = 12.75;
/** Between the label column and the strip, and between the strip and each trailing column. */
export const CELL_COL_GAP = 9;
/** The label band above the cells. Redrawn on every chunk, like a table header. */
export const CELL_HEAD_H = 13;
/** Width of the label column. Declared for the same reason every other width here is: a measured
 *  label column is what leaves 21.8pt for a laboratory name in A4 portrait. */
export const CELL_LABEL_W = 105;

/**
 * Width of the run of cells alone.
 *
 * `breaks` holds the cell INDEX each group starts at, excluding index 0. A break costs `GROUP_GAP`
 * in place of the `CELL_GAP` that would otherwise sit there, so the two are never both charged.
 */
export function stripWidth(cellCount: number, breaks: number[]): number {
  if (cellCount <= 0) return 0;
  const gaps = cellCount - 1;
  const wide = breaks.filter((b) => b > 0 && b < cellCount).length;
  return cellCount * CELL_SIZE + (gaps - wide) * CELL_GAP + wide * GROUP_GAP;
}

export interface CellGridWidthInput {
  /** 0 when the grid has no label column. */
  labelWidth: number;
  cellCount: number;
  breaks: number[];
  trailingWidths: number[];
}

/** Total width the element needs. Pure, so a design can assert it fits its page without rendering. */
export function cellGridWidth(i: CellGridWidthInput): number {
  const label = i.labelWidth > 0 ? i.labelWidth + CELL_COL_GAP : 0;
  const trailing = i.trailingWidths.reduce((sum, w) => sum + CELL_COL_GAP + w, 0);
  return label + stripWidth(i.cellCount, i.breaks) + trailing;
}

/**
 * Cell indices at which a new group starts, read from the group row.
 *
 * The token itself is never drawn and its value carries no meaning. Only the CHANGE does. That is
 * what lets one implementation group by week, by quarter, by batch or by anything else a query can
 * emit, without the renderer knowing what any of them are.
 */
export function groupBreaks(groupRow: string[] | undefined): number[] {
  if (!groupRow) return [];
  const out: number[] = [];
  for (let i = 1; i < groupRow.length; i += 1) {
    if (groupRow[i] !== groupRow[i - 1]) out.push(i);
  }
  return out;
}

/**
 * The empty cell.
 *
 * ⚠ COMPUTED, not printed. `#cbd5e1` is 17% ink and the darkest blue step is 68%, which is 50.8
 * percentage points of ITU-R 601 luma apart. The ~15pp a 600dpi laser needs to hold two tints
 * apart is a general figure, not one measured on the printer these reports are signed on. Nobody
 * has run this through that printer. A tint near 6% ink would be the one at risk of dropping out
 * and taking the whole grid with it, leaving filled cells floating with no positional ruler, but
 * that is reasoning from the same arithmetic rather than something anyone observed.
 *
 * It happens to equal `GRID_RULE` in `draw.ts`. That is a coincidence of both wanting the lightest
 * slate that still prints, not a shared constant. Do not factor them together.
 */
export const EMPTY_FILL = '#cbd5e1';

/** Five-step sequential ramps, lightest to darkest. One hue each: a sequential scale that changes
 *  hue stops encoding magnitude and starts encoding category. */
const RAMPS: Record<CellRamp, readonly string[]> = {
  blue: ['#c9ddf3', '#9dc2e8', '#5f9adb', '#2f76bd', '#185FA5'],
};

/**
 * `n` evenly spaced steps of a ramp, always ending on the darkest.
 *
 * Ending on the darkest matters more than even spacing: at `steps: 1` the single step must be the
 * one with the most contrast against the empty tint, not the one nearest the middle.
 */
export function rampSteps(ramp: CellRamp, n: number): string[] {
  const full = RAMPS[ramp];
  const last = full.length - 1;
  if (n <= 1) return [full[last]];
  return Array.from({ length: n }, (_, i) => full[Math.round((i * last) / (n - 1))]);
}

/** Which step a value lands on, or -1 for the empty tint. */
export function stepFor(value: number, max: number, steps: number): number {
  if (!Number.isFinite(value) || value <= 0) return -1;
  if (max <= 0) return -1;
  if (steps <= 1) return 0;
  return Math.min(steps - 1, Math.floor((value / max) * steps));
}

/** The fill a cell paints. */
export function cellFill(value: number, max: number, palette: CellPalette): string {
  const step = stepFor(value, max, palette.steps);
  if (step < 0) return EMPTY_FILL;
  return rampSteps(palette.ramp, palette.steps)[step];
}

export interface SplitRows {
  /** Cell labels drawn in the header band, redrawn on every chunk. */
  header: string[];
  /** Group tokens, or `undefined` when the element does not group. Never drawn. */
  groups: string[] | undefined;
  /** One entry per record. */
  body: string[][];
}

/**
 * Separate the synthetic leading rows from the records.
 *
 * ⛔ TWO synthetic rows, where `table`'s `headerRow` lifts ONE. Row 0 is the labels a reader sees,
 * row 1 is the grouping the renderer needs and nobody sees. They cannot be the same row: a day
 * column shows "02" and belongs to week 1, and neither value derives from the other for an
 * arbitrary month.
 *
 * ⚠ Anything counting rows over one of these queries must now subtract 2, not 1.
 * `r-transmission-grid` already declares `summaryMetrics: null` and a static `chart` to stop a
 * row-count fallback that once published "24" for a 23-laboratory month. That off-by-one is an
 * off-by-two here.
 */
export function splitCellGridRows(rows: string[][], grouped: boolean): SplitRows {
  const lift = grouped ? 2 : 1;
  return {
    header: rows[0] ?? [],
    groups: grouped ? rows[1] : undefined,
    body: rows.slice(lift),
  };
}

/** Records that fit a rect of height `hPt`. */
export function cellGridMaxRows(hPt: number): number {
  return Math.max(0, Math.floor((hPt - CELL_HEAD_H) / CELL_ROW_H));
}

/** Physical chunks this grid needs. Never zero: an empty grid still draws its header once, which is
 *  what tells a reader the block ran and found nothing rather than being omitted. */
export function cellGridChunks(bodyRowCount: number, hPt: number): number {
  const max = cellGridMaxRows(hPt);
  if (max < 1) return 1;
  return Math.max(1, Math.ceil(bodyRowCount / max));
}

/** Records actually drawn on physical chunk `chunk` — not the whole body, just this chunk's own
 *  slice. Shared by `drawCellGrid`'s own slicing and by `flowAfter`'s `drawnHeight`, so the two can
 *  never disagree about how many rows one page carries. */
export function cellGridRowsInChunk(bodyRowCount: number, hPt: number, chunk: number): number {
  const max = cellGridMaxRows(hPt);
  if (max < 1) return 0;
  return Math.max(0, Math.min(max, bodyRowCount - chunk * max));
}
