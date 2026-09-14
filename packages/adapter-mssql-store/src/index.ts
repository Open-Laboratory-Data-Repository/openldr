import { Kysely, MssqlDialect, sql } from 'kysely';
import * as tarn from 'tarn';
import * as tedious from 'tedious';
import { probe } from '@openldr/core';
import type { TargetSchema, TargetStorePort } from '@openldr/ports';
import { createRequestTimeoutScope } from './request-timeout';

export interface MssqlStoreConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export interface MssqlStoreDeps {
  // Injectable health probe for unit tests; defaults to `select 1` over the real connection.
  ping?: () => Promise<void>;
}

export interface MssqlStore extends TargetStorePort {
  withRequestTimeout<T>(timeoutMs: number, operation: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function buildMssqlDialectConfig(
  cfg: MssqlStoreConfig,
  Request: typeof tedious.Request,
): ConstructorParameters<typeof MssqlDialect>[0] {
  return {
    // SET LOCK_TIMEOUT and SET ROWCOUNT are session-scoped in SQL Server. Reset them before
    // another caller receives the pooled connection, including after a cancelled request.
    resetConnectionsOnRelease: true,
    tarn: { ...tarn, options: { min: 0, max: 10 } },
    tedious: {
      ...tedious,
      Request,
      connectionFactory: () =>
        new tedious.Connection({
          server: cfg.host,
          authentication: { type: 'default', options: { userName: cfg.user, password: cfg.password } },
          options: {
            port: cfg.port,
            database: cfg.database,
            encrypt: cfg.encrypt,
            trustServerCertificate: cfg.trustServerCertificate,
          },
        }),
    },
  };
}

export function createMssqlStore(cfg: MssqlStoreConfig, deps: MssqlStoreDeps = {}): MssqlStore {
  const requestTimeout = createRequestTimeoutScope(tedious.Request);
  const dialect = new MssqlDialect(buildMssqlDialectConfig(cfg, requestTimeout.Request));
  const db = new Kysely<TargetSchema>({ dialect });
  const ping = deps.ping ?? (async () => { await sql`select 1`.execute(db); });

  return {
    db,
    async transaction(fn) {
      return db.transaction().execute(fn);
    },
    async healthCheck() {
      return probe(ping);
    },
    withRequestTimeout(timeoutMs, operation) {
      return requestTimeout.run(timeoutMs, operation);
    },
    async close() {
      await db.destroy();
    },
  };
}

export {
  SUPPORTED_MSSQL_VERSIONS,
  MIN_SUPPORTED_MSSQL_MAJOR,
  isSupportedMssqlVersion,
  demoMssqlImage,
  type MssqlVersion,
} from './supported-versions';
