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
