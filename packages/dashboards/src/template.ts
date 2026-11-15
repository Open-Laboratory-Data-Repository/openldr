// Shared SQL-variable template logic, used by BOTH the client (widget editor preview + live
// widget) and the server (vetted stored-SQL execution), so a saved `{{var}}` / `[[ ... ]]`
// widget resolves identically everywhere. Keeping this on the server lets the query route
// receive the STORED template string (stable, vettable) plus opaque filter values, and apply
// the substitution itself — the client never bakes arbitrary SQL into the submitted string.

import { tokensInPlainSql, type SqlDialect } from './sql-text';

/** The `{{token}}` names a filter definition produces in SQL. A `date-range` splits into
 *  `id_from` / `id_to` (see `resolveValues`), so `{{id}}` alone never resolves for one.
 *  Both the filter editor and the widget SQL editor read this, so the hint shown to the
 *  author cannot drift from the substitution. */
export function filterTokens(f: { id: string; type: string }): string[] {
  return f.type === 'date-range' ? [`${f.id}_from`, `${f.id}_to`] : [f.id];
}

/** Resolve a name→value map into the flat key set the SQL template references, splitting a
 *  date-range value (`{from,to}`) into `name_from` / `name_to`. */
export function resolveValues(values: Record<string, unknown>): Record<string, string | number | null> {
  const resolved: Record<string, string | number | null> = {};
  for (const [name, val] of Object.entries(values)) {
    if (val && typeof val === 'object' && 'from' in (val as Record<string, unknown>)) {
      const r = val as { from: string; to: string };
      resolved[`${name}_from`] = r.from || null;
      resolved[`${name}_to`] = r.to || null;
    } else {
      resolved[name] = (val as string | number | null) ?? null;
    }
  }
  return resolved;
}

const DIALECTS: readonly SqlDialect[] = ['postgres', 'mssql', 'mysql'];

/** Whether every match of `token` in `template` sits in plain SQL.
 *  With a dialect, the template is read by that engine's rules. This is the guard for a run.
 *  With none, it is true when at least one of postgres, mssql and mysql reads it as plain SQL.
 *  That form is for the client-side preview, where the engine is not known. It is not the guard
 *  for a run. When no reading is true and one of them threw, the first throw is thrown again.
 *  Throws what `tokensInPlainSql` throws, with the same sentence. */
export function tokenSitsInPlainSql(template: string, token: RegExp, dialect?: SqlDialect): boolean {
  if (dialect) return tokensInPlainSql(template, token, dialect);
  let firstError: unknown = null;
  for (const each of DIALECTS) {
    try {
      if (tokensInPlainSql(template, token, each)) return true;
    } catch (e) {
      if (firstError === null) firstError = e;
    }
  }
  if (firstError !== null) throw firstError;
  return false;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Refuses `template` when a match of `pattern` sits in a string, a comment or a quoted name,
 *  read as `tokenSitsInPlainSql` reads it. `pattern` captures the token's name in group 1.
 *  `refusal(name)` writes the sentence; it must be fixed text that names the token and holds
 *  nothing else. The sentence names the first token whose own text is not plain. With no
 *  dialect, each token can be plain under a different engine while no one engine reads them all
 *  as plain; the template is refused then too, and the sentence names its first token. */
export function assertTokensInPlainSql(
  template: string, pattern: RegExp, refusal: (name: string) => string, dialect?: SqlDialect,
): void {
  if (tokenSitsInPlainSql(template, pattern, dialect)) return;
  const matches = [...template.matchAll(new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, '')}g`))];
  const first = matches.find((m) => !tokenSitsInPlainSql(template, new RegExp(escapeRegExp(m[0]), 'g'), dialect)) ?? matches[0];
  throw new Error(refusal(first?.[1] ?? ''));
}

/** The refusal for a `{{token}}` of a dashboard filter or a saved query's parameter. */
export function quotedTokenRefusal(token: string): string {
  return `a ${token} sits inside quotes, a comment or a quoted name: remove the quotes; the value is quoted for you`;
}

/** One value as one SQL literal. A string doubles its single quotes, and on mysql its
 *  backslashes too, because a MySQL server reads a backslash before the closing quote as an
 *  escape. A number goes in only when it is finite. A negative number goes in inside parentheses,
 *  so a `-` in the template just before it cannot make `--`. Zero and positive numbers go in bare,
 *  because MySQL does not take `LIMIT (5)`. `token` names the token in the refusal. */
export function sqlLiteral(value: string | number, token: string, dialect?: SqlDialect): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`the value for ${token} is not a finite number`);
    return value < 0 ? `(${String(value)})` : String(value);
  }
  const escaped = dialect === 'mysql' ? value.replace(/\\/g, '\\\\') : value;
  return `'${escaped.replace(/'/g, "''")}'`;
}

const FILTER_TOKEN = /\{\{(\w+)\}\}/g;

/** Apply `[[ ... {{var}} ... ]]` conditional clauses (kept only when every variable inside is
 *  set) then substitute `{{var}}` with a literal (or `NULL`).
 *  Between the two steps, every `{{var}}` left must sit in plain SQL, read by `dialect`. A token
 *  inside a dropped clause is gone by then and is not checked. A server path that runs the result
 *  passes the engine. With no dialect (the client-side preview), the token check passes when one
 *  engine reads the token as plain SQL, and a backslash in a value is left as it is. */
export function applyTemplate(
  sql: string, resolved: Record<string, string | number | null>, dialect?: SqlDialect,
): string {
  const isSet = (v: string | number | null | undefined) => v !== null && v !== undefined && v !== '';
  const withClauses = sql.replace(/\[\[([\s\S]*?)\]\]/g, (_, clause: string) => {
    const vars = (clause.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.slice(2, -2));
    return vars.every((v) => isSet(resolved[v])) ? clause : '';
  });
  assertTokensInPlainSql(withClauses, FILTER_TOKEN, (name) => quotedTokenRefusal(`{{${name}}}`), dialect);
  return withClauses.replace(FILTER_TOKEN, (_, name: string) => {
    const v = resolved[name];
    if (v === null || v === undefined || v === '') return 'NULL';
    return sqlLiteral(typeof v === 'number' ? v : String(v), `{{${name}}}`, dialect);
  });
}
