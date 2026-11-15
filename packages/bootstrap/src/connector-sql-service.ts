import type { SqlResult } from '@openldr/workflows';
import { planPagination, validateSelectSql, type SqlDialect } from '@openldr/dashboards';
import { createConnectorDb, type ConnectorDb } from './connector-db';

// Row cap applied when a caller omits one (e.g. the workflow Database node, which templates SQL and
// runs it directly). Bounds an otherwise-unbounded `select * from big_table` from streaming every row
// into memory. Callers that need pagination pass their own rowCap.
const DEFAULT_ROW_CAP = 10_000;

/** The SQL dialect of a connector type, or null when the type has none. */
export function dialectFor(type: string): SqlDialect | null {
  if (type === 'postgres') return 'postgres';
  if (type === 'microsoft-sql') return 'mssql';
  // mysql has its own SqlDialect; planPagination's mysql arm internally reuses the
  // postgres LIMIT/OFFSET wrapper (same syntax), so behavior is unchanged.
  if (type === 'mysql') return 'mysql';
  return null;
}

export interface ConnectorSqlDeps {
  connectors: {
    get(id: string): Promise<{ type: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  /** Injectable for tests; defaults to the real createConnectorDb. */
  createDb?: (type: string, config: Record<string, string>) => ConnectorDb;
}

/** The type of a connector the runner may use. Throws for a missing or disabled connector and
 *  for one with no type. */
function usableType(c: { type: string | null; enabled: boolean } | null, connectorId: string): string {
  if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
  if (!c.type) throw new Error(`connector ${connectorId} is not a database connector`);
  return c.type;
}

/** Builds the `connectorDialect` dependency of `runStoredQuery`: the dialect of one connector,
 *  read the way the runner reads it. It throws the runner's sentences for a missing, disabled or
 *  typeless connector, and returns null for a type with no SQL dialect. */
export function createConnectorDialectLookup(connectors: Pick<ConnectorSqlDeps['connectors'], 'get'>) {
  return async (connectorId: string): Promise<SqlDialect | null> =>
    dialectFor(usableType(await connectors.get(connectorId), connectorId));
}

/** Build the runConnectorSql implementation: resolve a host connector, decrypt its config,
 *  open an ephemeral connection, run a validated SELECT, and always close.
 *
 *  Read-only is enforced HERE at the shared runner boundary — not only in callers — so every path
 *  (workflow Database node, custom-query run, schema introspection) is guarded uniformly:
 *   - `validateSelectSql` rejects DML/DDL, multi-statement batches, and `SELECT … INTO` (a write
 *     masquerading as a read). This is the same validator the dashboard/custom-query SQL paths use.
 *   - a default row cap bounds unbounded scans when the caller omits one.
 *   - the statement runs through `queryReadOnly`: read-only on Postgres, rolled back on SQL Server.
 *  Write-capable SQL must go through a separate, explicitly privileged path — never this runner. */
export function createConnectorSqlRunner(deps: ConnectorSqlDeps) {
  const make = deps.createDb ?? createConnectorDb;
  return async ({ connectorId, sql: userSql, rowCap, offset }: { connectorId: string; sql: string; rowCap?: number; offset?: number }): Promise<SqlResult> => {
    const type = usableType(await deps.connectors.get(connectorId), connectorId);
    // The check reads the SQL as this connector's engine does, so the dialect comes first. A type
    // with no dialect is refused here, with the sentence createConnectorDb would throw for it.
    const dialect = dialectFor(type);
    if (!dialect) throw new Error(`unsupported connector type: ${type}`);
    // SELECT-only guard before any connection is opened or credentials decrypted.
    validateSelectSql(userSql, dialect);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const conn = make(type, config);
    try {
      const cap = rowCap ?? DEFAULT_ROW_CAP;
      const plan = planPagination(userSql.replace(/;\s*$/, ''), dialect, { limit: cap, offset });
      const res = await conn.queryReadOnly(plan.sql);
      // MSSQL applies its offset in JS (SET ROWCOUNT fetched offset+limit rows); Postgres already
      // offset in SQL, so sliceOffset is 0.
      const rows = plan.sliceOffset ? res.rows.slice(plan.sliceOffset) : res.rows;
      const columns = rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : [];
      return { columns, rows };
    } finally {
      await conn.close();
    }
  };
}
