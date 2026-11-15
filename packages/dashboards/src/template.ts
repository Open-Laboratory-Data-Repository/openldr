// SQL-variable template logic for the server. The widget preview and the live widget both send
// the STORED template (stable, vettable) plus opaque filter values, and the server fills it
// once, for its own engine. The client never fills SQL. The studio keeps only its own copy of
// `filterTokens`, kept in step with the one here by hand.

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
 *  That form is for when the engine is not known. Today that is `/api/query/run` on a connector
 *  type with no dialect, which the connector runner then refuses. It is not the guard for a run.
 *  When no reading is true and one of them threw, the first throw is thrown again.
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
 *  as plain; the template is refused then too, and the sentence names its first token.
 *
 *  On postgres, and with no dialect, a token right after a lone `E` or `e` is refused too. The
 *  filled text would be `E'...'`, an escape string, where a backslash in the value escapes the
 *  closing quote. That sentence names the token as the template writes it. */
export function assertTokensInPlainSql(
  template: string, pattern: RegExp, refusal: (name: string) => string, dialect?: SqlDialect,
): void {
  const matches = [...template.matchAll(new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, '')}g`))];
  if (!tokenSitsInPlainSql(template, pattern, dialect)) {
    const first = matches.find((m) => !tokenSitsInPlainSql(template, new RegExp(escapeRegExp(m[0]), 'g'), dialect)) ?? matches[0];
    throw new Error(refusal(first?.[1] ?? ''));
  }
  if (dialect === undefined || dialect === 'postgres') {
    const afterE = matches.find((m) => followsLoneE(template, m.index ?? 0));
    if (afterE) throw new Error(`a ${afterE[0]} follows a lone E, which Postgres reads as the start of an escape string: put a space before it`);
  }
}

/** Whether the text just before `index` is an `E` or `e` that is not the end of a longer
 *  Postgres name (a letter, digit, `_`, `$` or any character at or above U+0080). */
function followsLoneE(template: string, index: number): boolean {
  const prev = template[index - 1];
  if (prev !== 'E' && prev !== 'e') return false;
  const before = template[index - 2];
  if (before === undefined) return true;
  return !/[A-Za-z0-9_$]/.test(before) && before.charCodeAt(0) < 0x80;
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
 *  passes the engine. With no dialect (no engine known), the token check passes when one engine
 *  reads the token as plain SQL, and a backslash in a value is left as it is. */
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
