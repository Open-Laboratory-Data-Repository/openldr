import {
  Kysely,
  MssqlAdapter,
  MssqlIntrospector,
  MssqlQueryCompiler,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import type { CompiledQuery, DatabaseConnection, QueryResult } from 'kysely';
import type { TargetEngine } from '../../engine';

// Kysely's own DummyDriver pattern (see its JSDoc: "build a query and compile it to SQL... trying
// to execute the query will throw an error"), extended to RECORD the compiled SQL instead of
// discarding it. This is how a test proves what a migration would send to MySQL or MSSQL, without
// a live server: wire the real dialect-specific compiler and adapter to a driver that never
// connects, only logs.
class RecordingConnection implements DatabaseConnection {
  constructor(private readonly log: string[]) {}
  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.log.push(compiledQuery.sql);
    return { rows: [] };
  }
  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    return;
  }
}

class RecordingDriver {
  constructor(private readonly log: string[]) {}
  async init(): Promise<void> {}
  async acquireConnection(): Promise<RecordingConnection> {
    return new RecordingConnection(this.log);
  }
  async beginTransaction(): Promise<void> {}
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
  async releaseSavepoint(): Promise<void> {}
  async rollbackToSavepoint(): Promise<void> {}
  async savepoint(): Promise<void> {}
}

function dialectFor(engine: TargetEngine) {
  if (engine === 'mysql') {
    return { adapter: new MysqlAdapter(), compiler: new MysqlQueryCompiler(), introspector: (db: Kysely<any>) => new MysqlIntrospector(db) };
  }
  if (engine === 'mssql') {
    return { adapter: new MssqlAdapter(), compiler: new MssqlQueryCompiler(), introspector: (db: Kysely<any>) => new MssqlIntrospector(db) };
  }
  return { adapter: new PostgresAdapter(), compiler: new PostgresQueryCompiler(), introspector: (db: Kysely<any>) => new PostgresIntrospector(db) };
}

/** Runs `body` against a Kysely instance backed by the real query compiler for `engine`, with no
 *  real connection, and returns every compiled SQL statement it executed, in order. Use this to
 *  assert on the exact DDL a migration emits per engine, offline. `dialect.test.ts` and
 *  `016_ingest_events.test.ts` already assert dialect-specific behaviour by inspecting the type
 *  strings `keyType`/`shortKeyType` return; this does the same job one level up, for compiled SQL
 *  rather than type strings, which is what a cross-engine index or column-alteration bug shows up
 *  in first. */
export async function collectCompiledSql(engine: TargetEngine, body: (db: Kysely<any>) => Promise<void>): Promise<string[]> {
  const log: string[] = [];
  const { adapter, compiler, introspector } = dialectFor(engine);
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => adapter,
      createDriver: () => new RecordingDriver(log),
      createIntrospector: introspector,
      createQueryCompiler: () => compiler,
    },
  });
  await body(db);
  return log;
}
