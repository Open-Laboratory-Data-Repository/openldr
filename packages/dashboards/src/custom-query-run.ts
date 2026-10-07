import type { CustomQueryParam, CustomQueryStore } from '@openldr/db';
import type { CustomQueryParam as DashboardCustomQueryParam } from './custom-query';
import { validateSelectSql } from './sql-runner';

// Shape check for injection-safety only (YYYY-MM-DD); the DB enforces calendar validity.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
// Shape check for injection-safety only; the DB enforces calendar validity.
function assertDate(v: unknown): string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) throw new Error(`invalid date: ${String(v)}`);
  return v;
}

/** Replace {{param.x}} tokens in `sql` using declared params + supplied values.
 *  - daterange param `p` provides {{param.from}} and {{param.to}} (value: { from, to }); a blank
 *    side of an optional range is ''.
 *  - text/select provide {{param.<id>}} as a quoted string literal; an unset optional one is ''.
 *  Read-only substitution only; caller has already run validateSelectSql. */
export function substituteParams(
  sql: string, params: DashboardCustomQueryParam[], values: Record<string, unknown>,
): string {
  const replacements = new Map<string, string>();
  for (const p of params) {
    const v = values[p.id];
    if (p.type === 'daterange') {
      const dr = (v ?? {}) as { from?: unknown; to?: unknown };
      // A side is blank when it is missing or '' (a date box the user cleared). Same rule as a
      // text param: a blank optional side binds to '', a blank required side is an error.
      const blank = (x: unknown) => x == null || x === '';
      if (p.required && (blank(dr.from) || blank(dr.to))) throw new Error(`required parameter: ${p.id}`);
      replacements.set('from', blank(dr.from) ? sqlString('') : sqlString(assertDate(dr.from)));
      replacements.set('to', blank(dr.to) ? sqlString('') : sqlString(assertDate(dr.to)));
    } else {
      if (p.required && (v == null || v === '')) throw new Error(`required parameter: ${p.id}`);
      // A blank optional param binds to '' so the SQL can read it as "no filter". Callers such as
      // the Query page send nothing for an untouched box.
      replacements.set(p.id, sqlString(v == null ? '' : String(v)));
    }
  }
  return sql.replace(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const r = replacements.get(key);
    if (r === undefined) throw new Error(`unbound parameter: ${key}`);
    return r;
  });
}

const ROW_CAP = 1000;

export class StoredQueryRowLimitError extends Error {
  readonly statusCode = 422;
  constructor(readonly queryId: string) {
    super(`Stored query exceeds the ${ROW_CAP} row limit. Narrow the report filters or date range. No export was generated.`);
    this.name = 'StoredQueryRowLimitError';
  }
}

export interface RunStoredQueryDeps {
  customQueries: Pick<CustomQueryStore, 'get'>;
  runConnectorSql(input: { connectorId: string; sql: string; rowCap?: number; offset?: number }): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
}

/** Substitute {{param.*}} then enforce SELECT-only. Returns the safe inner SQL. Throws on bad param/SQL. */
export function prepareSelect(sql: string, params: CustomQueryParam[], values: Record<string, unknown>): string {
  const inner = params.length ? substituteParams(sql, params, values) : sql;
  validateSelectSql(inner);
  return inner;
}

/** Load a stored custom query by id, run it (SELECT-only, row-capped) against its connector. */
export async function runStoredQuery(
  deps: RunStoredQueryDeps, queryId: string, values: Record<string, unknown>,
): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }> {
  const rec = await deps.customQueries.get(queryId);
  if (!rec) throw new Error(`custom query not found: ${queryId}`);
  const inner = prepareSelect(rec.sql, rec.params, values).replace(/;\s*$/, '');
  // Read one extra row to distinguish a complete boundary result from truncation.
  const result = await deps.runConnectorSql({ connectorId: rec.connectorId, sql: inner, rowCap: ROW_CAP + 1 });
  if (result.rows.length > ROW_CAP) throw new StoredQueryRowLimitError(queryId);
  return result;
}
