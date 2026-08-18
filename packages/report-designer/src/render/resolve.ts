import type { ReportDesign } from '../schema';
import type { ResolvedTable } from './index';

export type RunQuery = (queryId: string, values: Record<string, unknown>) => Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;

/** Ascending compare on one result column: numeric when both values parse as finite numbers,
 *  otherwise a plain string compare. Numbers first, because a sort discriminator is a number and
 *  comparing 2 against 10 as text puts 10 first. */
function compareOn(a: Record<string, unknown>, b: Record<string, unknown>, key: string): number {
  const av = a[key], bv = b[key];
  const an = Number(av), bn = Number(bv);
  if (av !== null && av !== '' && bv !== null && bv !== '' && Number.isFinite(an) && Number.isFinite(bn)) {
    return an - bn;
  }
  return String(av ?? '').localeCompare(String(bv ?? ''));
}

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
        // Ordered HERE, where the rows enter the renderer, so `rowsFor`, `cellStatusesFor` and
        // `keyValuePairs` all read one order and cannot disagree about which row is row 0.
        // See `sortBy` in schema.ts for why the query's own ORDER BY is not enough.
        // `Array.prototype.sort` is stable, so the query's ordering within a tie is preserved.
        const ordered = el.sortBy ? [...rows].sort((a, b) => compareOn(a, b, el.sortBy!)) : rows;
        resolved.set(el.id, { columns, rows: ordered });
      } catch (e) {
        resolved.set(el.id, { error: (e as Error).message });
      }
    }
  }
  return resolved;
}
