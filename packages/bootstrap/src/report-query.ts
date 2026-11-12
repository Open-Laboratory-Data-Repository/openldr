import { runStoredQuery, type RunStoredQueryDeps } from '@openldr/dashboards';

/** Reports, scheduled exports and CLI runs supply flat from/to dates.
 * Bind those dates under each query's declared range id before SQL validation.
 * Explicit nested values retain the Query workbench contract. */
export async function runReportStoredQuery(
  deps: RunStoredQueryDeps, queryId: string, values: Record<string, unknown>,
): ReturnType<typeof runStoredQuery> {
  const query = await deps.customQueries.get(queryId);
  const queryValues = { ...values };
  for (const param of query?.params ?? []) {
    if (param.type !== 'daterange') continue;
    const value = values[param.id];
    // A range named from or to shares its key with a flat report date.
    // Keep explicit nested objects, including malformed ones, for the existing validation.
    const flatDateKey = (param.id === 'from' || param.id === 'to') && (value == null || typeof value !== 'object');
    if (Object.prototype.hasOwnProperty.call(values, param.id) && !flatDateKey) continue;
    queryValues[param.id] = { from: values.from, to: values.to };
  }
  // Reuse this record so metadata and SQL come from one store read.
  // The stored-query runner keeps the required, date, SELECT and row-limit checks.
  return runStoredQuery({ ...deps, customQueries: { get: async () => query } }, queryId, queryValues);
}
