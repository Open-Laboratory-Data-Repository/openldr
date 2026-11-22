import type { Dashboard } from './types';

/**
 * The authoring gate for raw SQL. When the `dashboard.raw_sql` flag is off, a dashboard may not
 * bring NEW or CHANGED SQL: a `mode:'sql'` widget, or a filter with non-empty `optionsSql`.
 * SQL whose trimmed text is already in `storedTemplates` was vetted before and passes.
 * Returns the refusal message the dashboards route sends, or null when the dashboard may be saved.
 * Pure, so studio's examples test can run the same check the server does.
 */
export function sqlAuthoringRefusal(dashboard: Dashboard, sqlEnabled: boolean, storedTemplates: Set<string>): string | null {
  if (sqlEnabled) return null;
  for (const w of dashboard.widgets) {
    if (w.query.mode === 'sql') {
      const sql = typeof w.query.sql === 'string' ? w.query.sql.trim() : '';
      if (!storedTemplates.has(sql)) return 'raw SQL widgets are disabled';
    }
  }
  // New or changed filter options SQL is authoring too (review DS4); the stored one stays.
  for (const f of dashboard.filters ?? []) {
    if (typeof f.optionsSql === 'string' && f.optionsSql.trim() !== '' && !storedTemplates.has(f.optionsSql.trim())) {
      return 'raw SQL is disabled, so a filter cannot get new options SQL';
    }
  }
  return null;
}
