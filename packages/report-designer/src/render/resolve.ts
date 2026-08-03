import type { ReportDesign } from '../schema';
import type { ResolvedTable } from './index';

export type RunQuery = (queryId: string, values: Record<string, unknown>) => Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;

/** Run every bound element's query with `values`; elId → rows|error (never throws per-element).
 *
 *  ⚠ Gated on `dataSource` ALONE, deliberately kind-agnostic. It used to also require
 *  `kind === 'table'`, which silently left a bound `keyvalue` panel unresolved — it rendered as an
 *  empty panel with no error anywhere, because the renderer cannot distinguish "no rows" from
 *  "never ran". `ResolvedTable` is `{columns,rows}|{error}`: a generic query result that is only
 *  NAMED table-ish. Any future bound element kind is covered by this predicate for free. */
export async function resolveDesignTables(
  design: ReportDesign, values: Record<string, unknown>, runQuery: RunQuery,
): Promise<Map<string, ResolvedTable>> {
  const resolved = new Map<string, ResolvedTable>();
  for (const page of design.pages) {
    for (const el of page.elements) {
      if (!el.dataSource) continue;
      try {
        const { columns, rows } = await runQuery(el.dataSource.queryId, values);
        resolved.set(el.id, { columns, rows });
      } catch (e) {
        resolved.set(el.id, { error: (e as Error).message });
      }
    }
  }
  return resolved;
}
