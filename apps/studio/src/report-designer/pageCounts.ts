import type { CustomQuery } from '../query/custom-query-types';
import { queryApi } from '../query/api';
import type { ReportTemplate, ResolvedTable } from './types';
import { pageChunkCount } from './types';
import { paramValues, runAllRows } from './exportExcel';

/** Injectable seams, mirroring `ExcelExportDeps` (list the query catalog, run SQL). */
export interface PageCountDeps {
  list(): Promise<CustomQuery[]>;
  run: typeof queryApi.run;
}

const defaultDeps: PageCountDeps = { list: () => queryApi.list(), run: queryApi.run };

/**
 * Run every query the design binds and hand back rows keyed by ELEMENT id — the exact map shape
 * `renderReportDesignPdf` takes, so the studio's page math and the renderer's read one source.
 *
 * A query shared by two elements runs ONCE (keyed by queryId, fanned out to each element).
 * A failed query becomes `{ error }` for its elements, mirroring the PDF's per-table placeholder:
 * counting pages must never throw because one query is broken.
 */
export async function fetchResolvedTables(
  design: ReportTemplate, deps: PageCountDeps = defaultDeps,
): Promise<Map<string, ResolvedTable>> {
  const bound = design.pages.flatMap((p) => p.elements).filter((e) => e.dataSource);
  const resolved = new Map<string, ResolvedTable>();
  if (bound.length === 0) return resolved;

  const queries = await deps.list();
  const values = paramValues(design);
  const byQuery = new Map<string, ResolvedTable>();
  for (const el of bound) {
    const queryId = el.dataSource!.queryId;
    let result = byQuery.get(queryId);
    if (!result) {
      const cq = queries.find((q) => q.id === queryId);
      if (!cq) result = { error: `custom query not found: ${queryId}` };
      else {
        try {
          result = await runAllRows(deps.run, { connectorId: cq.connectorId, sql: cq.sql, params: cq.params, values });
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
      }
      byQuery.set(queryId, result);
    }
    resolved.set(el.id, result);
  }
  return resolved;
}

/** Physical page count per design page, and the total — the same arithmetic the renderer uses. */
export function designPageCounts(
  design: ReportTemplate, resolved: Map<string, ResolvedTable>,
): { perPage: number[]; total: number } {
  const perPage = design.pages.map((p) => pageChunkCount(p, resolved));
  return { perPage, total: perPage.reduce((a, b) => a + b, 0) };
}
