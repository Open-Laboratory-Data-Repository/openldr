import { sql, Kysely } from 'kysely';
import type { TargetSchema } from '@openldr/ports';
import pg from 'pg';
import { createMssqlStore } from '@openldr/adapter-mssql-store';
import { createPool, createConnection, type ConnectionOptions } from 'mysql2';

/** A connector-backed DB connection: run one raw query, then close. */
export interface ConnectorDb {
  query(rawSql: string): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
}

export function validatePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`invalid connector port: ${raw}`);
  return port;
}

export function buildPgUrl(config: Record<string, string>): string {
  const host = config.host ?? 'localhost';
  // hostname / IPv4, or IPv6 (raw or bracketed)
  if (!/^[A-Za-z0-9.\-]+$/.test(host) && !/^\[?[0-9A-Fa-f:]+\]?$/.test(host)) {
    throw new Error(`invalid connector host: ${host}`);
  }
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host; // bracket IPv6
  const port = validatePort(config.port, 5432);
  const user = encodeURIComponent(config.user ?? '');
  const pass = encodeURIComponent(config.password ?? '');
  const dbName = encodeURIComponent(config.database ?? '');
  const ssl = config.ssl === 'true' ? '?sslmode=require' : '';
  return `postgresql://${user}:${pass}@${hostPart}:${port}/${dbName}${ssl}`;
}

function wrap(store: { db: Kysely<TargetSchema>; close(): Promise<void> }): ConnectorDb {
  return {
    async query(rawSql) { const r = await sql.raw(rawSql).execute(store.db); return { rows: r.rows as Record<string, unknown>[] }; },
    close: () => store.close(),
  };
}

/** Build an ephemeral DB connection for a host connector by type + decrypted config.
 *  Caller MUST call close() (use try/finally). */
export function createConnectorDb(
  type: string,
  config: Record<string, string>,
  { queryTimeoutMs = 30_000 }: { queryTimeoutMs?: number } = {},
): ConnectorDb {
  if (!Number.isSafeInteger(queryTimeoutMs) || queryTimeoutMs < 1 || queryTimeoutMs > 30_000) {
    throw new Error('connector query timeout must be an integer between 1 and 30000 ms');
  }
  if (type === 'postgres') {
    const pool = new pg.Pool({
      connectionString: buildPgUrl(config),
      connectionTimeoutMillis: queryTimeoutMs,
      statement_timeout: queryTimeoutMs,
      // Allow the server cancellation to arrive first. The client bound also covers a stalled socket.
      query_timeout: queryTimeoutMs + 1000,
    });
    let closed = false;
    return {
      async query(rawSql) {
        // Pool.query discards the client on error, including a client-side timeout.
        const result = await pool.query(rawSql);
        return { rows: result.rows };
      },
      async close() { if (!closed) { closed = true; await pool.end(); } },
    };
  }
  if (type === 'microsoft-sql') {
    return wrap(createMssqlStore({
      host: config.host ?? 'localhost',
      port: validatePort(config.port, 1433),
      database: config.database ?? '',
      user: config.user ?? '',
      password: config.password ?? '',
      encrypt: config.encrypt !== 'false',
      trustServerCertificate: config.trustServerCertificate === 'true',
    }));
  }
  if (type === 'mysql') {
    const port = validatePort(config.port, 3306);
    const host = config.host ?? 'localhost';
    if (!/^[A-Za-z0-9.\-]+$/.test(host) && !/^\[?[0-9A-Fa-f:]+\]?$/.test(host)) {
      throw new Error(`invalid connector host: ${host}`);
    }
    const connectionOptions: ConnectionOptions = {
      connectTimeout: queryTimeoutMs,
      host, port, user: config.user ?? '', password: config.password ?? '', database: config.database ?? '',
      ...(config.ssl === 'true' ? { ssl: { rejectUnauthorized: config.sslRejectUnauthorized === 'true' } } : {}),
    };
    const pool = createPool({ ...connectionOptions, waitForConnections: false });
    // ⛔ Adopt the DATABASE's own collation on every connection, or nothing that compares a column
    // to a literal can run. mysql2 defaults the connection to utf8mb4_unicode_ci while a MySQL 8
    // table defaults to utf8mb4_0900_ai_ci, so `left(authored_at, 7) = 'yyyy-mm'` mixes an IMPLICIT
    // column collation with an IMPLICIT connection one and the server refuses it outright:
    // ER_CANT_AGGREGATE_2COLLATIONS, errno 1267. Every seeded report query does that comparison, so
    // every report failed on a MySQL warehouse, while the same SQL through the `mysql` CLI worked
    // because the CLI negotiates the server collation instead. That difference is why this was
    // mis-diagnosed for months as being about one `concat` in one query.
    //
    // ⛔ `@@collation_database`, never a hardcoded name. utf8mb4_0900_ai_ci does not exist on
    // MariaDB, which this connector also supports, and pinning it there would trade one 1267 for an
    // unknown-collation error. Reading the database's own default is the one expression that is
    // correct on both. Assigning collation_connection sets character_set_connection with it.
    //
    // MEASURED 2026-08-21 on MySQL 8.4.10 through this pool: collation_database utf8mb4_0900_ai_ci
    // against a connection that arrived as latin1_swedish_ci. `pnpm mysql:reports:accept` is the
    // harness that catches it; it failed on its first run, on this line's absence.
    pool.on('connection', (c) => {
      c.query('set collation_connection = @@collation_database', (err: unknown) => {
        // A failure here is not fatal to the connection: it means the server refused the statement,
        // and the query that follows will raise its own, more specific error rather than this one
        // being swallowed into a silent wrong answer.
        if (err) console.warn('[connector-db] could not adopt the database collation:', err);
      });
    });
    let closed = false;
    return {
      query(rawSql) {
        return new Promise((resolve, reject) => {
          pool.getConnection((acquireError, connection) => {
            if (acquireError) { reject(acquireError); return; }
            let cancelling = false;
            const timer = setTimeout(async () => {
              cancelling = true;
              // Keep the original session open until KILL is sent, preventing thread-id reuse.
              let cancellationError: unknown;
              try {
                cancellationError = await killMysqlConnection(connectionOptions, connection.threadId);
              } catch (error) {
                cancellationError = error;
              } finally {
                connection.destroy();
                reject(new Error(cancellationError
                  ? 'connector query deadline exceeded; server cancellation failed'
                  : 'connector query deadline exceeded', cancellationError ? { cause: cancellationError } : undefined));
              }
            }, queryTimeoutMs);
            connection.query(rawSql, (error, rows) => {
              if (cancelling) return;
              clearTimeout(timer);
              connection.release();
              if (error) reject(error);
              else resolve({ rows: rows as Record<string, unknown>[] });
            });
          });
        });
      },
      async close() {
        if (closed) return;
        closed = true;
        await new Promise<void>((resolve, reject) => pool.end((error) => error ? reject(error) : resolve()));
      },
    };
  }
  throw new Error(`unsupported connector type: ${type}`);
}

/** Kill only this connector's own session. A separate connection cannot queue behind the slow SQL. */
function killMysqlConnection(options: ConnectionOptions, threadId: number): Promise<Error | null> {
  return new Promise((resolve) => {
    const control = createConnection({ ...options, connectTimeout: 1000 });
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      control.destroy();
      resolve(error);
    };
    const timer = setTimeout(() => finish(new Error('server cancellation timed out')), 1000);
    control.on('error', finish);
    control.query(`KILL CONNECTION ${threadId}`, (error) => finish(error));
  });
}
