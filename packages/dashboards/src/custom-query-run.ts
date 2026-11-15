import type { CustomQueryParam, CustomQueryStore } from '@openldr/db';
import type { CustomQueryParam as DashboardCustomQueryParam } from './custom-query';
import { validateSelectSql, validateSelectSqlForSave, type SqlDialect } from './sql-runner';
import { assertTokensInPlainSql, quotedTokenRefusal, sqlLiteral } from './template';

// Shape check for injection-safety only (YYYY-MM-DD); the DB enforces calendar validity.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const PARAM_TOKEN = /\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g;

/** The sentence `runStoredQuery` throws when the query's connector has no SQL dialect. The
 *  connector runner throws the same words, followed by the type. */
const UNSUPPORTED_CONNECTOR = 'unsupported connector type';
// Shape check for injection-safety only; the DB enforces calendar validity.
function assertDate(v: unknown): string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) throw new Error(`invalid date: ${String(v)}`);
  return v;
}

/** Replace {{param.x}} tokens in `sql` using declared params + supplied values.
 *  - daterange param `p` provides {{param.from}} and {{param.to}} (value: { from, to }); a blank
 *    side of an optional range is ''.
 *  - text/select provide {{param.<id>}} as a quoted string literal; an unset optional one is ''.
 *    A number goes in as a quoted string too, and only when it is finite.
 *  Before any value goes in, every token must sit in plain SQL, read by `dialect`. With a
 *  dialect, a string value is quoted for that engine (on mysql its backslashes are doubled).
 *  With none (no engine known), the token check passes when one engine reads the token as plain
 *  SQL, and a backslash is left as it is; that form is not the guard for a run.
 *  Read-only substitution only. It does not check the SQL; the caller checks the result
 *  (`prepareSelect`). */
export function substituteParams(
  sql: string, params: DashboardCustomQueryParam[], values: Record<string, unknown>, dialect?: SqlDialect,
): string {
  const quoted = (v: string, id: string) => sqlLiteral(v, `{{param.${id}}}`, dialect);
  const replacements = new Map<string, string>();
  for (const p of params) {
    const v = values[p.id];
    if (p.type === 'daterange') {
      const dr = (v ?? {}) as { from?: unknown; to?: unknown };
      // A side is blank when it is missing or '' (a date box the user cleared). Same rule as a
      // text param: a blank optional side binds to '', a blank required side is an error.
      const blank = (x: unknown) => x == null || x === '';
      if (p.required && (blank(dr.from) || blank(dr.to))) throw new Error(`required parameter: ${p.id}`);
      replacements.set('from', quoted(blank(dr.from) ? '' : assertDate(dr.from), 'from'));
      replacements.set('to', quoted(blank(dr.to) ? '' : assertDate(dr.to), 'to'));
    } else {
      if (p.required && (v == null || v === '')) throw new Error(`required parameter: ${p.id}`);
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`the value for {{param.${p.id}}} is not a finite number`);
      // A blank optional param binds to '' so the SQL can read it as "no filter". Callers such as
      // the Query page send nothing for an untouched box.
      replacements.set(p.id, quoted(v == null ? '' : String(v), p.id));
    }
  }
  assertTokensInPlainSql(sql, PARAM_TOKEN, (id) => quotedTokenRefusal(`{{param.${id}}}`), dialect);
  return sql.replace(PARAM_TOKEN, (_m, key: string) => {
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
  /** The SQL dialect of a connector, or null when its type has none. */
  connectorDialect(connectorId: string): Promise<SqlDialect | null>;
  runConnectorSql(input: { connectorId: string; sql: string; rowCap?: number; offset?: number }): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
}

/** Substitute {{param.*}} then enforce SELECT-only. Returns the safe inner SQL. Throws on bad param/SQL.
 *  With a dialect the fill and the check read the SQL as that engine does. Without one the check
 *  is the save-time check, which is only right when the SQL then goes to the connector runner,
 *  which checks again with the connector's dialect. */
export function prepareSelect(
  sql: string, params: CustomQueryParam[], values: Record<string, unknown>, dialect?: SqlDialect,
): string {
  const inner = params.length ? substituteParams(sql, params, values, dialect) : sql;
  if (dialect) validateSelectSql(inner, dialect);
  else validateSelectSqlForSave(inner);
  return inner;
}

/** Load a stored custom query by id, run it (SELECT-only, row-capped) against its connector. The
 *  values are filled for the connector's dialect. */
export async function runStoredQuery(
  deps: RunStoredQueryDeps, queryId: string, values: Record<string, unknown>,
): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }> {
  const rec = await deps.customQueries.get(queryId);
  if (!rec) throw new Error(`custom query not found: ${queryId}`);
  const dialect = await deps.connectorDialect(rec.connectorId);
  if (!dialect) throw new Error(UNSUPPORTED_CONNECTOR);
  // runConnectorSql checks the SQL again with the connector's dialect.
  const inner = prepareSelect(rec.sql, rec.params, values, dialect).replace(/;\s*$/, '');
  // Read one extra row to distinguish a complete boundary result from truncation.
  const result = await deps.runConnectorSql({ connectorId: rec.connectorId, sql: inner, rowCap: ROW_CAP + 1 });
  if (result.rows.length > ROW_CAP) throw new StoredQueryRowLimitError(queryId);
  return result;
}
