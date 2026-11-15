import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  Kysely, MssqlAdapter, MssqlIntrospector, MssqlQueryCompiler,
  type CompiledQuery, type DatabaseConnection, type Driver, type QueryResult,
} from 'kysely';

// Captures what the mysql arm does to its pool. mysql2 is mocked at the module boundary because the
// thing under test happens at POOL CONSTRUCTION, before any connection exists, and there is no
// server here to open one against.
const { poolOn, poolQuery, mssqlWithRequestTimeout, mssqlCreate, mysqlCreatePool, pgFake, mssqlFake } = vi.hoisted(() => {
  const poolOn = vi.fn();
  const poolQuery = vi.fn();
  return {
    mssqlCreate: vi.fn(),
    poolOn,
    poolQuery,
    mssqlWithRequestTimeout: vi.fn(async (timeoutMs: number) => {
      throw new Error(`bounded at ${timeoutMs}`);
    }),
    mysqlCreatePool: vi.fn((_options: Record<string, unknown>): unknown => ({ on: poolOn, query: poolQuery, getConnection: vi.fn(), end: vi.fn() })),
    /** When set, `new pg.Pool(options)` returns what this makes. Otherwise the real pool. */
    pgFake: { make: null as null | ((options: Record<string, unknown>) => unknown) },
    /** When set, `createMssqlStore` returns this store. */
    mssqlFake: { store: null as unknown },
  };
});
vi.mock('mysql2', () => ({ createPool: mysqlCreatePool }));
vi.mock('pg', async (importOriginal) => {
  const real = await importOriginal<typeof import('pg')>();
  class Pool {
    constructor(options: Record<string, unknown>) {
      return (pgFake.make ? pgFake.make(options) : new real.default.Pool(options)) as never;
    }
  }
  return { ...real, default: { ...real.default, Pool } };
});
vi.mock('@openldr/adapter-mssql-store', () => ({
  createMssqlStore: (cfg: unknown) => (mssqlCreate(cfg), mssqlFake.store ?? {
    db: {},
    withRequestTimeout: mssqlWithRequestTimeout,
    close: vi.fn(),
  }),
}));

import { createConnectorDb, buildPgUrl, splitMssqlHost } from './connector-db';

afterEach(() => {
  pgFake.make = null;
  mssqlFake.store = null;
});

const SCS = 'SET LOCAL standard_conforming_strings = on';
const MSSQL_CONFIG = { host: 'h', port: '1433', database: 'd', user: 'u', password: 'p' };
const MYSQL_CONFIG = { host: 'h', port: '3306', database: 'd', user: 'u', password: 'p' };

/** A fake pg pool: records what the pool and its one client are sent, and how the client is
 *  given back. `fail` makes the person's statement or the ROLLBACK throw. */
function fakePg(fail: { statement?: Error; rollback?: Error } = {}) {
  const onClient: string[] = [];
  const onPool: string[] = [];
  const releases: unknown[][] = [];
  const created: Record<string, unknown>[] = [];
  const own = new Set(['BEGIN READ ONLY', SCS, 'ROLLBACK']);
  const client = {
    async query(text: string) {
      onClient.push(text);
      if (text === 'ROLLBACK' && fail.rollback) throw fail.rollback;
      if (!own.has(text) && fail.statement) throw fail.statement;
      return { rows: [{ n: 1 }] };
    },
    release: (...args: unknown[]) => { releases.push(args); },
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (text: string) => { onPool.push(text); return { rows: [{ n: 1 }] }; }),
    end: async () => {},
  };
  pgFake.make = (options) => { created.push(options); return pool; };
  return { onClient, onPool, releases, pool, created };
}

/** A real Kysely over a fake SQL Server driver with a pool of ONE connection. It records each
 *  request, models the server's transaction state, and notes any request sent outside the
 *  store's request deadline. A connection that is never given back makes the next query fail. */
function fakeMssqlStore(server: {
  rows?: Record<string, unknown>[];
  failQuery?: (sql: string) => { error: Error; endsTransaction?: boolean } | undefined;
  failRollback?: () => Error | undefined;
} = {}) {
  const trail: string[] = [];
  const outsideDeadline: string[] = [];
  const state = { leased: false, inTransaction: false, inDeadline: false };
  const note = (step: string) => { trail.push(step); if (!state.inDeadline) outsideDeadline.push(step); };
  const connection: DatabaseConnection = {
    async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
      note(q.sql);
      const fail = server.failQuery?.(q.sql);
      if (fail) {
        if (fail.endsTransaction) state.inTransaction = false;
        throw fail.error;
      }
      return { rows: (server.rows ?? []) as R[] };
    },
    async *streamQuery() { throw new Error('fake driver: not used'); },
  };
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      if (state.leased) throw new Error('fake pool: the only connection was never given back');
      state.leased = true;
      note('acquire');
      return connection;
    },
    async beginTransaction() {
      note('begin');
      if (state.inTransaction) throw new Error('fake server: a transaction is already open');
      state.inTransaction = true;
    },
    async commitTransaction() { note('commit'); state.inTransaction = false; },
    async rollbackTransaction() {
      note('rollback');
      const failure = server.failRollback?.();
      if (failure) throw failure;
      if (!state.inTransaction) throw new Error('3903: the ROLLBACK TRANSACTION request has no corresponding BEGIN TRANSACTION');
      state.inTransaction = false;
    },
    async releaseConnection() { note('release'); state.leased = false; },
    async destroy() {},
  };
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new MssqlAdapter(),
      createDriver: () => driver,
      createQueryCompiler: () => new MssqlQueryCompiler(),
      createIntrospector: (k) => new MssqlIntrospector(k),
    },
  });
  const withRequestTimeout = vi.fn(async <T>(_ms: number, op: () => Promise<T>): Promise<T> => {
    state.inDeadline = true;
    try { return await op(); } finally { state.inDeadline = false; }
  });
  mssqlFake.store = { db, withRequestTimeout, close: async () => {} };
  return { trail, outsideDeadline, state, withRequestTimeout };
}

/** A fake mysql2 pool whose one connection records what it is sent and how it is given back. */
function fakeMysql() {
  const sent: string[] = [];
  const given: string[] = [];
  const connection = {
    threadId: 7,
    query: (text: string, cb: (e: unknown, rows: unknown) => void) => { sent.push(text); cb(null, [{ n: 1 }]); },
    release: () => { given.push('release'); },
    destroy: () => { given.push('destroy'); },
  };
  mysqlCreatePool.mockImplementationOnce(() => ({
    on: vi.fn(),
    getConnection: (cb: (e: unknown, c: typeof connection) => void) => cb(null, connection),
    end: (cb: (e?: unknown) => void) => cb(),
  }));
  return { sent, given };
}

describe('createConnectorDb', () => {
  it.each([0, -1, 30_001, Infinity, 1.5])('rejects a disabled or excessive query deadline: %s', (queryTimeoutMs) => {
    expect(() => createConnectorDb('postgres', {}, { queryTimeoutMs })).toThrow(/timeout/);
  });
  it('builds a postgres connection object with query + close', () => {
    const conn = createConnectorDb('postgres', { host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' });
    expect(typeof conn.query).toBe('function');
    expect(typeof conn.close).toBe('function');
  });
  it('builds a microsoft-sql connection object', () => {
    const conn = createConnectorDb('microsoft-sql', { host: 'h', port: '1433', database: 'd', user: 'u', password: 'p' });
    expect(typeof conn.query).toBe('function');
  });
  it('runs microsoft-sql queries inside the configured request deadline', async () => {
    mssqlWithRequestTimeout.mockClear();
    const conn = createConnectorDb(
      'microsoft-sql',
      { host: 'h', port: '1433', database: 'd', user: 'u', password: 'p' },
      { queryTimeoutMs: 432 },
    );

    await expect(conn.query('select 1')).rejects.toThrow('bounded at 432');
    expect(mssqlWithRequestTimeout).toHaveBeenCalledWith(432, expect.any(Function));
  });
  it('throws on an unsupported type', () => {
    expect(() => createConnectorDb('mongodb', {})).toThrow(/unsupported connector type/);
  });
  it('accepts an IPv6 host and brackets it in the pg URL', () => {
    expect(() => createConnectorDb('postgres', { host: '::1', port: '5432', database: 'd', user: 'u', password: 'p' })).not.toThrow();
    expect(buildPgUrl({ host: '::1', port: '5432', database: 'd', user: 'u', password: 'p' })).toContain('[::1]');
  });
  it('throws on an invalid host', () => {
    expect(() => createConnectorDb('postgres', { host: 'evil/db', port: '5432', database: 'd', user: 'u', password: 'p' })).toThrow(/invalid connector host/);
  });
  it('throws on a non-numeric port', () => {
    expect(() => createConnectorDb('postgres', { host: 'h', port: 'abc', database: 'd', user: 'u', password: 'p' })).toThrow(/invalid connector port/);
  });
});

describe('createConnectorDb — mysql', () => {
  it('builds a mysql connection object with query + close', () => {
    const conn = createConnectorDb('mysql', { host: 'h', port: '3306', database: 'd', user: 'u', password: 'p' });
    expect(typeof conn.query).toBe('function');
    expect(typeof conn.close).toBe('function');
  });
  it('rejects an invalid mysql port', () => {
    expect(() => createConnectorDb('mysql', { host: 'h', port: 'abc', database: 'd', user: 'u', password: 'p' })).toThrow(/invalid connector port/);
  });

  // ⛔ THE regression this exists for. mysql2 opens a connection as latin1_swedish_ci while a MySQL
  // 8 table is utf8mb4_0900_ai_ci, so comparing any column to any literal mixes two IMPLICIT
  // collations and the server refuses the whole statement with errno 1267. Every seeded report
  // query compares a timestamp prefix to a month string, so on 2026-08-21 NO report could run on a
  // MySQL warehouse at all. Measured through this pool, on MySQL 8.4.10.
  //
  // ⚠ `@@collation_database`, never a hardcoded collation name: utf8mb4_0900_ai_ci does not exist
  // on MariaDB, which this same connector supports. Asserting the literal statement is the point of
  // the test, so a well-meaning edit to a named collation fails here rather than on a MariaDB site.
  it('adopts the database collation on every new connection', () => {
    poolOn.mockClear();
    createConnectorDb('mysql', { host: 'h', port: '3306', database: 'd', user: 'u', password: 'p' });

    const registration = poolOn.mock.calls.find((c) => c[0] === 'connection');
    expect(registration, 'the mysql pool registers no connection handler').toBeDefined();

    // Drive the handler with a fake connection and read back the statement it issues.
    const seen: string[] = [];
    (registration![1] as (c: { query: (sql: string, cb: (e: unknown) => void) => void }) => void)({
      query: (statement, cb) => { seen.push(statement); cb(null); },
    });
    expect(seen).toEqual(['set collation_connection = @@collation_database']);
  });
});

describe('splitMssqlHost', () => {
  it('splits the SERVER\\INSTANCE form SSMS shows', () => {
    expect(splitMssqlHost('LABSRV\\SQLEXPRESS')).toEqual({ host: 'LABSRV', instanceName: 'SQLEXPRESS' });
  });
  it('leaves a plain host alone', () => {
    expect(splitMssqlHost('LABSRV')).toEqual({ host: 'LABSRV' });
  });
  it('lets an explicit instance name win over one in the host', () => {
    expect(splitMssqlHost('LABSRV\\A', 'B')).toEqual({ host: 'LABSRV', instanceName: 'B' });
  });
  it('ignores a blank instance after the backslash', () => {
    expect(splitMssqlHost('LABSRV\\ ')).toEqual({ host: 'LABSRV' });
  });
});

describe('microsoft-sql instance and Windows login', () => {
  it('passes instance and domain through, and does not validate a port when an instance is set', () => {
    mssqlCreate.mockClear();
    createConnectorDb('microsoft-sql', { host: 'LABSRV\\SQLEXPRESS', port: 'not-a-port', database: 'd', user: 'u', password: 'p', domain: 'LAB' });
    expect(mssqlCreate).toHaveBeenCalledWith(expect.objectContaining({ host: 'LABSRV', instanceName: 'SQLEXPRESS', domain: 'LAB' }));
  });
  it('still validates the port when there is no instance', () => {
    expect(() => createConnectorDb('microsoft-sql', { host: 'LABSRV', port: 'not-a-port' })).toThrow(/invalid connector port/);
  });
});

// The import page reader calls `query` for every page it reads. These pin it as it is: one raw
// statement, no transaction, on each engine.
describe('query is unchanged', () => {
  it('query is unchanged: one raw statement, no transaction (postgres)', async () => {
    const pg = fakePg();
    const conn = createConnectorDb('postgres', { host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' });
    expect((await conn.query('select 1')).rows).toEqual([{ n: 1 }]);
    expect(pg.onPool).toEqual(['select 1']);
    expect(pg.pool.connect).not.toHaveBeenCalled();
    expect(pg.onClient).toEqual([]);
  });
  it('query is unchanged: one raw statement, no transaction (microsoft-sql)', async () => {
    const mssql = fakeMssqlStore({ rows: [{ n: 1 }] });
    const conn = createConnectorDb('microsoft-sql', MSSQL_CONFIG, { queryTimeoutMs: 432 });
    expect((await conn.query('select 1')).rows).toEqual([{ n: 1 }]);
    expect(mssql.trail).toEqual(['acquire', 'select 1', 'release']);
    expect(mssql.withRequestTimeout).toHaveBeenCalledWith(432, expect.any(Function));
  });
  it('query is unchanged: one raw statement, no transaction (mysql)', async () => {
    const mysql = fakeMysql();
    const conn = createConnectorDb('mysql', MYSQL_CONFIG);
    expect((await conn.query('select 1')).rows).toEqual([{ n: 1 }]);
    expect(mysql.sent).toEqual(['select 1']);
    expect(mysql.given).toEqual(['release']);
    await conn.close();
  });
});

describe('queryReadOnly on postgres', () => {
  const PG = { host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' };

  it('postgres: BEGIN READ ONLY, the statement, ROLLBACK, in that order on one client', async () => {
    const pg = fakePg();
    const conn = createConnectorDb('postgres', PG);
    expect((await conn.queryReadOnly('select 1')).rows).toEqual([{ n: 1 }]);
    expect(pg.onClient).toEqual(['BEGIN READ ONLY', SCS, 'select 1', 'ROLLBACK']);
    expect(pg.pool.connect).toHaveBeenCalledTimes(1);
    expect(pg.onPool).toEqual([]);
    // Given back healthy: no error passed, so the pool keeps it.
    expect(pg.releases).toEqual([[]]);
  });
  it('postgres: an error in the statement still sends ROLLBACK and releases the client as broken', async () => {
    const pg = fakePg({ statement: new Error('canceling statement due to statement timeout') });
    const conn = createConnectorDb('postgres', PG);
    await expect(conn.queryReadOnly('select pg_sleep(60)')).rejects.toThrow('canceling statement due to statement timeout');
    expect(pg.onClient).toEqual(['BEGIN READ ONLY', SCS, 'select pg_sleep(60)', 'ROLLBACK']);
    expect(pg.releases).toEqual([[true]]);
  });
  it('postgres: a ROLLBACK that fails after a failed statement does not hide the statement error', async () => {
    const pg = fakePg({ statement: new Error('relation "nope" does not exist'), rollback: new Error('Connection terminated') });
    const conn = createConnectorDb('postgres', PG);
    await expect(conn.queryReadOnly('select * from nope')).rejects.toThrow('relation "nope" does not exist');
    expect(pg.releases).toEqual([[true]]);
  });
  it('postgres: a ROLLBACK that fails after a good read returns the rows and drops the client', async () => {
    const pg = fakePg({ rollback: new Error('Connection terminated') });
    const conn = createConnectorDb('postgres', PG);
    expect((await conn.queryReadOnly('select 1')).rows).toEqual([{ n: 1 }]);
    expect(pg.releases).toEqual([[true]]);
  });
  it('postgres: the pool timeouts that bound query still bound queryReadOnly', async () => {
    const pg = fakePg();
    const conn = createConnectorDb('postgres', PG, { queryTimeoutMs: 432 });
    await conn.queryReadOnly('select 1');
    // statement_timeout is set on every session of the pool, query_timeout on every client query.
    expect(pg.created).toHaveLength(1);
    expect(pg.created[0]).toMatchObject({ statement_timeout: 432, query_timeout: 1432 });
    expect(pg.pool.connect).toHaveBeenCalledTimes(1);
  });
});

describe('queryReadOnly on microsoft-sql', () => {
  it('mssql: the statement runs on a transaction that is rolled back on success', async () => {
    const mssql = fakeMssqlStore({ rows: [{ n: 1 }] });
    const conn = createConnectorDb('microsoft-sql', MSSQL_CONFIG, { queryTimeoutMs: 432 });
    expect((await conn.queryReadOnly('select 1')).rows).toEqual([{ n: 1 }]);
    expect(mssql.trail).toEqual(['acquire', 'begin', 'select 1', 'rollback', 'release']);
    expect(mssql.withRequestTimeout).toHaveBeenCalledWith(432, expect.any(Function));
    expect(mssql.outsideDeadline).toEqual([]);
    expect(mssql.state).toMatchObject({ leased: false, inTransaction: false });
  });
  it('mssql: the statement runs on a transaction that is rolled back on failure', async () => {
    const mssql = fakeMssqlStore({ failQuery: () => ({ error: new Error("Invalid object name 'nope'.") }) });
    const conn = createConnectorDb('microsoft-sql', MSSQL_CONFIG);
    await expect(conn.queryReadOnly('select * from nope')).rejects.toThrow("Invalid object name 'nope'.");
    expect(mssql.trail).toEqual(['acquire', 'begin', 'select * from nope', 'rollback', 'release']);
    expect(mssql.trail).not.toContain('commit');
    expect(mssql.outsideDeadline).toEqual([]);
    expect(mssql.state).toMatchObject({ leased: false, inTransaction: false });
  });
  it('mssql: when the roll-back itself fails, the error thrown is the statement\'s own', async () => {
    const mssql = fakeMssqlStore({
      failQuery: (s) => (s === 'SELECT 1' ? { error: new Error('Conversion failed'), endsTransaction: true } : undefined),
      failRollback: () => new Error('3903'),
    });
    const conn = createConnectorDb('microsoft-sql', MSSQL_CONFIG);
    await expect(conn.queryReadOnly('SELECT 1')).rejects.toThrow('Conversion failed');
    expect(mssql.trail.slice(-2)).toEqual(['rollback', 'release']);
    // The pool's one connection serves the next query: it was given back.
    await expect(conn.query('select 2')).resolves.toEqual({ rows: [] });
  });
  it('mssql: a roll-back that fails after a good read still returns the rows and gives the connection back', async () => {
    const mssql = fakeMssqlStore({ rows: [{ n: 1 }], failRollback: () => new Error('the roll-back request failed') });
    const conn = createConnectorDb('microsoft-sql', MSSQL_CONFIG);
    expect((await conn.queryReadOnly('select 1')).rows).toEqual([{ n: 1 }]);
    expect(mssql.trail.slice(-2)).toEqual(['rollback', 'release']);
    expect(mssql.state.leased).toBe(false);
  });
  it('mssql: after the deadline cancels the statement, the transaction is rolled back inside the deadline', async () => {
    const mssql = fakeMssqlStore({ failQuery: () => ({ error: new Error('Timeout: Request failed to complete in 432ms') }) });
    const conn = createConnectorDb('microsoft-sql', MSSQL_CONFIG, { queryTimeoutMs: 432 });
    await expect(conn.queryReadOnly('select 1')).rejects.toThrow('Timeout');
    expect(mssql.trail).toEqual(['acquire', 'begin', 'select 1', 'rollback', 'release']);
    expect(mssql.outsideDeadline).toEqual([]);
    expect(mssql.state).toMatchObject({ leased: false, inTransaction: false });
  });
});

// R7: the roll-back is its own request, so a trailing line comment cannot swallow it.
describe('a statement that ends in a line comment', () => {
  it('is still rolled back on mssql, and still ends with ROLLBACK on postgres', async () => {
    const mssql = fakeMssqlStore();
    await createConnectorDb('microsoft-sql', MSSQL_CONFIG).queryReadOnly('SELECT 1 -- note');
    expect(mssql.trail).toEqual(['acquire', 'begin', 'SELECT 1 -- note', 'rollback', 'release']);
    expect(mssql.state.inTransaction).toBe(false);

    const pg = fakePg();
    await createConnectorDb('postgres', { host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' }).queryReadOnly('SELECT 1 -- note');
    expect(pg.onClient).toEqual(['BEGIN READ ONLY', SCS, 'SELECT 1 -- note', 'ROLLBACK']);
  });
});

describe('queryReadOnly on mysql', () => {
  it('mysql: queryReadOnly sends exactly what query sends', async () => {
    const mysql = fakeMysql();
    const conn = createConnectorDb('mysql', MYSQL_CONFIG);
    const a = await conn.query('select 1');
    const b = await conn.queryReadOnly('select 1');
    expect(b).toEqual(a);
    // One raw statement each, and no transaction words.
    expect(mysql.sent).toEqual(['select 1', 'select 1']);
    expect(mysql.given).toEqual(['release', 'release']);
    await conn.close();
  });
  it('mysql: neither pool turns multipleStatements on', () => {
    mysqlCreatePool.mockClear();
    // A config key of that name is not carried into the pool either.
    createConnectorDb('mysql', { ...MYSQL_CONFIG, multipleStatements: 'true' });
    expect(mysqlCreatePool).toHaveBeenCalledTimes(1);
    const options = mysqlCreatePool.mock.calls[0][0];
    expect(options.multipleStatements).toBeUndefined();
    expect(options.host).toBe('h');
  });
});

// Bug 13: the Postgres node and the Query page read COUNT(*) and AVG() as text through this pool.
// Against a real Postgres, only when one is configured (the dev install's TARGET_DATABASE_URL).
const liveUrl = process.env.TARGET_DATABASE_URL;
describe.skipIf(!liveUrl)('a Postgres connector against a real database', () => {
  it('returns COUNT and AVG as numbers, and text as text', async () => {
    const u = new URL(liveUrl!);
    const db = createConnectorDb('postgres', {
      host: u.hostname, port: u.port || '5432', database: u.pathname.slice(1),
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    });
    try {
      const { rows } = await db.query("select count(*) as n, avg(y) as third, '10234' as code from (values (1), (2), (4)) as u(y)");
      expect(rows[0]).toEqual({ n: 3, third: 2.3333333333333335, code: '10234' });
    } finally {
      await db.close();
    }
  });
});
