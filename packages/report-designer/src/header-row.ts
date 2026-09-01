import type { ReportDesign } from './schema';

/**
 * The `headerRow` companion rule: a table that promotes its first data row to the header must also
 * declare which column orders the rows.
 *
 * ⛔ Why the pair is load-bearing. `headerRow` lifts **row 0 of whatever the renderer was handed**.
 * Only `sortBy` makes row 0 a known row: `planPagination` wraps every stored query as
 * `select * from (<inner>) as _q limit N offset 0` (`packages/dashboards/src/sql-runner.ts:56`),
 * and MySQL's optimizer may discard an `ORDER BY` inside a derived table. Set one without the
 * other and the page prints **a laboratory's name as its date header**, with no error anywhere —
 * the report looks finished and is wrong. That is the same failure `sortBy` was introduced to
 * prevent, made worse by promoting the mis-sorted row into the header.
 *
 * ⚠ Deliberately NOT a zod refinement on `DesignElementSchema`, for the reason `image-src.ts`
 * records: `fromRow` (`./store.ts`) parses every stored design through `ReportDesignSchema`, so a
 * refinement runs on READ too and would make an already-stored design permanently unopenable —
 * including inside the boot seed's own `get`. Taking the report down is a worse outcome than the
 * defect. This is a WRITE-time rule, enforced at the API boundary, exactly as
 * `findInvalidImageSources` is.
 *
 * ⚠ It does NOT cover every writer of that column, and must not be read as if it does.
 * `packages/db/src/reference-apply.ts`'s `reportDesignRow` — the applier a lab uses for a design
 * PULLED from central — writes `pages` straight to the table with neither the schema parse nor this
 * gate. Same trusted-source boundary the image cap documents.
 */
export interface UnsortedHeaderRow {
  elementId: string;
}

/** Every transposed table that also declares totals. Empty when fine. Summing across a transposed
 *  table adds organisms together, which means nothing — refused at the same write boundary as the
 *  header-row rule, for the same read-safety reason it is not a zod refinement. */
export function findTransposedTotals(design: ReportDesign): UnsortedHeaderRow[] {
  const bad: UnsortedHeaderRow[] = [];
  for (const page of design.pages) {
    for (const el of page.elements) {
      if (el.kind === 'table' && el.transpose && el.totals) bad.push({ elementId: el.id });
    }
  }
  return bad;
}

/** Every table that lifts a header row without saying how the rows are ordered. Empty when fine. */
export function findUnsortedHeaderRows(design: ReportDesign): UnsortedHeaderRow[] {
  const bad: UnsortedHeaderRow[] = [];
  for (const page of design.pages) {
    for (const el of page.elements) {
      // A table only lifts a header row when it opts in with headerRow: true. A cellgrid has no
      // such flag: it ALWAYS lifts row 0 (splitCellGridRows, unconditional). Both therefore need
      // sortBy on the same rows-came-from-a-query condition below; only the "does this element
      // even lift a header row" test differs between the two kinds.
      const liftsHeaderRow = (el.kind === 'table' && el.headerRow === true) || el.kind === 'cellgrid';
      if (!liftsHeaderRow) continue;
      // An UNBOUND element draws its own static rows/columns in the order written, so row 0 is
      // already knowable and requiring sortBy there would refuse a design that cannot be wrong.
      if (!el.dataSource) continue;
      if (!el.sortBy) bad.push({ elementId: el.id });
    }
  }
  return bad;
}
