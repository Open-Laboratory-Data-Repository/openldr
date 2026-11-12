import { describe, it, expect, vi } from 'vitest';

// Captures what the mysql arm does to its pool. mysql2 is mocked at the module boundary because the
// thing under test happens at POOL CONSTRUCTION, before any connection exists, and there is no
// server here to open one against.
const { poolOn, poolQuery, mssqlWithRequestTimeout, mssqlCreate } = vi.hoisted(() => ({
  mssqlCreate: vi.fn(),
  poolOn: vi.fn(),
  poolQuery: vi.fn(),
  mssqlWithRequestTimeout: vi.fn(async (timeoutMs: number) => {
    throw new Error(`bounded at ${timeoutMs}`);
  }),
}));
vi.mock('mysql2', () => ({
  createPool: () => ({ on: poolOn, query: poolQuery, getConnection: vi.fn(), end: vi.fn() }),
}));
vi.mock('@openldr/adapter-mssql-store', () => ({
  createMssqlStore: (cfg: unknown) => (mssqlCreate(cfg), {
    db: {},
    withRequestTimeout: mssqlWithRequestTimeout,
    close: vi.fn(),
  }),
}));

import { createConnectorDb, buildPgUrl, splitMssqlHost } from './connector-db';

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
