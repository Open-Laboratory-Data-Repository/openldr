/**
 * Sparklines: a miniature trend line drawn INSIDE one table cell.
 *
 * The value is data, not a label: the query supplies a delimited numeric string in the column
 * (`4,6,9,7`), and the cell draws the shape instead of printing the string. Everything here is
 * POINTS, like the rest of the renderer, and every constant lives beside its use.
 *
 * ⛔ Refuses more than it accepts. A column marked `spark` whose value is not two or more clean
 * numbers falls back to drawing the raw text, so a query that changes shape degrades to a readable
 * cell rather than a blank one or a throw. Partial garbage (`4,n/a,9`) is refused whole rather than
 * silently dropped: a trend with a hole in it is a lie about the data.
 */

/** The parsed series, or null when this value is not a drawable trend. */
export function sparkValues(raw: unknown): number[] | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(/[,;|\s]+/).map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length < 2) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

type Box = { x: number; y: number; w: number; h: number };

/** Evenly stepped points across the box, scaled between the series' own min and max. A FLAT series
 *  would divide by zero, so it draws along the middle instead. */
export function sparkPoints(box: Box, values: number[]): { x: number; y: number }[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = values.length > 1 ? box.w / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: box.x + i * step,
    // Scaled within the box, not from zero: a sparkline shows SHAPE, and a series of 980..1010
    // flattened against a zero baseline would show nothing at all.
    y: span === 0 ? box.y + box.h / 2 : box.y + box.h - ((v - min) / span) * box.h,
  }));
}
