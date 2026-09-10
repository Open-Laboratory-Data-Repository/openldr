// Shared SQL-variable template logic, used by both the widget editor (preview, with local
// test values) and the live widget (runtime, with bound dashboard-filter values), so a saved
// `{{var}}` / `[[ ... ]]` widget resolves identically in both places.
//
// NOTE: an identical copy lives server-side in @openldr/dashboards/template so the query route
// can apply the substitution to the STORED template (vetted stored-SQL execution). The studio
// app deliberately does not depend on @openldr/dashboards (that would pull server-only DB deps
// into the browser bundle), so this small, pure module is kept in sync by hand.

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

/** Apply `[[ ... {{var}} ... ]]` conditional clauses (kept only when every variable inside is
 *  set) then substitute `{{var}}` with a quoted literal (or `NULL`). Values become SQL literals;
 *  this path is admin-gated, Postgres-only and read-only. */
export function applyTemplate(sql: string, resolved: Record<string, string | number | null>): string {
  const isSet = (v: string | number | null | undefined) => v !== null && v !== undefined && v !== '';
  const withClauses = sql.replace(/\[\[([\s\S]*?)\]\]/g, (_, clause: string) => {
    const vars = (clause.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.slice(2, -2));
    return vars.every((v) => isSet(resolved[v])) ? clause : '';
  });
  return withClauses.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = resolved[name];
    if (!isSet(v)) return 'NULL';
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  });
}
