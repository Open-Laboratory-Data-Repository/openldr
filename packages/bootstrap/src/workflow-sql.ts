import type { Kysely } from 'kysely';
import { runSqlQuery, type SqlDialect, type SqlRunOpts } from '@openldr/dashboards';
import type { ExternalSchema } from '@openldr/db';

export interface WorkflowSqlDeps {
  db: Kysely<ExternalSchema>;
  /** Read per call, so a changed setting applies to the next run without a restart. */
  bounds: () => Promise<{ timeoutMs: number; rowCap: number }>;
  withDeadline?: SqlRunOpts['withDeadline'];
  engine: SqlDialect;
}

export interface WorkflowSqlResult {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}

/**
 * The workflow SQL Query node's runner (bug 12).
 *
 * It used to go through the dashboard query, which refuses typed SQL unless Dashboard raw SQL is
 * on. That switch is about who may type SQL into dashboard widgets. It did not protect the warehouse
 * from workflow authors: the Postgres node and the default warehouse connector run any SELECT with
 * the switch off. So the node now skips the switch and keeps the rest of the dashboard SQL bounds:
 * one SELECT only, read-only, the dashboard SQL timeout and the dashboard row cap.
 */
export function createWorkflowSql(deps: WorkflowSqlDeps): (sql: string) => Promise<WorkflowSqlResult> {
  return async (sql) => {
    const { timeoutMs, rowCap } = await deps.bounds();
    const r = await runSqlQuery(deps.db, sql, { timeoutMs, rowCap, withDeadline: deps.withDeadline }, deps.engine);
    return { columns: r.columns.map((c) => ({ key: c.key, label: c.label })), rows: r.rows };
  };
}
