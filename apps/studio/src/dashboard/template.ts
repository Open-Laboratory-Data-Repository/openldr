// The `{{token}}` names a dashboard filter produces in SQL, for the filter editor and the widget
// SQL editor.
//
// The studio does not fill templates. The widget preview and the live widget both send the
// stored template plus the filter values, and the server fills them once, for its own engine
// (`applyTemplate` and `resolveValues` in @openldr/dashboards). The studio does not depend on
// the @openldr/dashboards root, which would pull server-only DB deps into the browser bundle,
// so this rule is kept in step with the server's `filterTokens` by hand.

/** The `{{token}}` names a filter definition produces in SQL. A `date-range` splits into
 *  `id_from` / `id_to` (the server's `resolveValues` does the same split), so `{{id}}` alone
 *  never resolves for one. Both the filter editor and the widget SQL editor read this, so the
 *  hint shown to the author cannot drift from the substitution. */
export function filterTokens(f: { id: string; type: string }): string[] {
  return f.type === 'date-range' ? [`${f.id}_from`, `${f.id}_to`] : [f.id];
}
