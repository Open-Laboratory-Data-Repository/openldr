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
/** Baseline row pitch. Derived from cell size, not from `ROW_H`. */
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
 * The token itself is never drawn and its value carries no meaning — only the CHANGE does. That is
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
