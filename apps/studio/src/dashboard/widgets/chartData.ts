const NUMBER_TEXT = /^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;

/**
 * Turn numbers that arrived as text into numbers, for the named keys only.
 *
 * Postgres returns COUNT(*) as bigint, and the driver hands bigint over as a string ("18").
 * Recharts adds only real numbers, so a pie of strings totals 0 and draws nothing. It also
 * finds an axis maximum by comparing strings, so "9" beats "18" and tall bars are cut off.
 * Labels are left alone: a code such as "007" must stay text.
 */
export function numericRows(rows: Record<string, unknown>[], keys: string[]): Record<string, unknown>[] {
  return rows.map((row) => {
    let out = row;
    for (const key of keys) {
      const v = row[key];
      if (typeof v === 'string' && NUMBER_TEXT.test(v)) {
        if (out === row) out = { ...row };
        out[key] = Number(v);
      }
    }
    return out;
  });
}

/**
 * Reshape Breakdown rows for a multi-series chart. The query returns one row per (label, series);
 * Recharts wants one row per label with one numeric column per series. Series keep first-seen
 * order, a missing pair reads 0, and a pair that repeats is added up.
 */
export function pivotSeries(rows: Record<string, unknown>[], x: string, y: string, seriesKey = 'series'): { data: Record<string, unknown>[]; series: string[] } {
  const series: string[] = [];
  const byLabel = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const name = String(row[seriesKey] ?? '(none)');
    if (!series.includes(name)) series.push(name);
    const label = String(row[x] ?? '');
    let out = byLabel.get(label);
    if (!out) { out = { [x]: row[x] }; byLabel.set(label, out); }
    out[name] = (Number(out[name]) || 0) + (Number(row[y]) || 0);
  }
  const data = [...byLabel.values()].map((out) => {
    for (const name of series) if (out[name] === undefined) out[name] = 0;
    return out;
  });
  return { data, series };
}

/** Charts that can draw several series side by side. Pie and funnel have one ring or one stack. */
const MULTI_SERIES = new Set(['bar-chart', 'row-chart', 'line-chart', 'area-chart']);

/**
 * The rows and series a chart draws. A Breakdown result becomes one series per Breakdown value on
 * a bar, row, line or area chart, and is added up per label for a pie or funnel. Any other result
 * is one series named by the value column. Numbers that arrived as text become numbers.
 */
export function shapeChart(type: string, rows: Record<string, unknown>[], x: string, y: string, hasSeries: boolean): { data: Record<string, unknown>[]; series: string[] } {
  if (!hasSeries) return { data: numericRows(rows, [y]), series: [y] };
  const pivot = pivotSeries(rows, x, y);
  if (MULTI_SERIES.has(type)) return pivot;
  const data = pivot.data.map((row) => ({ [x]: row[x], [y]: pivot.series.reduce((sum, name) => sum + (Number(row[name]) || 0), 0) }));
  return { data, series: [y] };
}
