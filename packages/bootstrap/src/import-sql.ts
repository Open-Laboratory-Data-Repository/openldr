// SQL helpers for the import run (import-run.ts). The plugin's signed wasm supplies SQL templates;
// this file fills in the paging tokens. Everything here is written for SQL Server, the only
// connector type an import source may declare today (marketplace importSourceSchema).

/** Longest source key the run will page on. */
export const KEY_MAX = 200;
export const PAGE_SIZE_MIN = 1;
export const PAGE_SIZE_MAX = 2000;

const TOKEN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/**
 * A source key becomes a SQL literal, so it is checked first. Printable ASCII only:
 *  - control characters have no place in a key and make a literal hard to reason about;
 *  - a plain '...' literal cannot carry non-ASCII text safely, and an N'...' literal would make
 *    SQL Server convert a varchar key column on every row, which turns an index seek into a scan.
 */
export function assertSafeKey(key: string): void {
  if (key.length === 0 || key.length > KEY_MAX || !/^[\x20-\x7E]+$/.test(key)) {
    throw new Error(`source key is empty, longer than ${KEY_MAX} characters, or not printable ASCII`);
  }
}

/** A SQL Server string literal. A single quote is the only character that can end one. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function fill(sql: string, values: Record<string, string>): string {
  for (const name of Object.keys(values)) {
    if (!new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(sql)) throw new Error(`import SQL is missing the {{${name}}} token`);
  }
  return sql.replace(TOKEN, (_m, name: string) => {
    const v = values[name];
    if (v === undefined) throw new Error(`import SQL has an unknown token: {{${name}}}`);
    return v;
  });
}

/** Fill a key query for one page. `after` is the last key of the page before; null on the first
 *  page, where the empty string sorts before every key. */
export function fillKeyQuery(sql: string, after: string | null, limit: number): string {
  if (!Number.isInteger(limit) || limit < PAGE_SIZE_MIN || limit > PAGE_SIZE_MAX) {
    throw new Error(`page size must be a whole number from ${PAGE_SIZE_MIN} to ${PAGE_SIZE_MAX}`);
  }
  if (after !== null) assertSafeKey(after);
  return fill(sql, { after: quoteLiteral(after ?? ''), limit: String(limit) });
}

/** Fill a detail query with the page's keys. */
export function fillDetailQuery(sql: string, keys: string[]): string {
  if (keys.length === 0) throw new Error('import detail query has no keys');
  for (const key of keys) assertSafeKey(key);
  return fill(sql, { keys: keys.map(quoteLiteral).join(', ') });
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Make one source row safe to send to the plugin as JSON.
 *
 * A SQL Server datetime has no time zone. tedious hands it over as a Date whose UTC fields are
 * the stored wall-clock (its `useUTC` default), so those fields are written back out as text with
 * no zone. Serializing the Date directly would add a `Z` and claim the value is UTC, which is how
 * local lab times end up shifted by the site's offset. The plugin applies the offset the admin chose.
 */
export function toPluginRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    if (value === undefined || value === null) out[name] = null;
    else if (value instanceof Date) {
      out[name] = Number.isNaN(value.getTime())
        ? null
        : `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
          + `T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.${pad(value.getUTCMilliseconds(), 3)}`;
    } else if (typeof value === 'bigint') out[name] = value.toString();
    else if (value instanceof Uint8Array) out[name] = Buffer.from(value).toString('base64');
    else out[name] = value;
  }
  return out;
}
