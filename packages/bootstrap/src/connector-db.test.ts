import { describe, it, expect, vi } from 'vitest';

// Captures what the mysql arm does to its pool. mysql2 is mocked at the module boundary because the
// thing under test happens at POOL CONSTRUCTION, before any connection exists, and there is no
// server here to open one against.
const { poolOn, poolQuery } = vi.hoisted(() => ({ poolOn: vi.fn(), poolQuery: vi.fn() }));
vi.mock('mysql2', () => ({
  createPool: () => ({ on: poolOn, query: poolQuery, getConnection: vi.fn(), end: vi.fn() }),
}));

import { createConnectorDb, buildPgUrl } from './connector-db';

describe('createConnectorDb', () => {
  it('builds a postgres connection object with query + close', () => {
    const conn = createConnectorDb('postgres', { host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' });
    expect(typeof conn.query).toBe('function');
    expect(typeof conn.close).toBe('function');
  });
  it('builds a microsoft-sql connection object', () => {
    const conn = createConnectorDb('microsoft-sql', { host: 'h', port: '1433', database: 'd', user: 'u', password: 'p' });
    expect(typeof conn.query).toBe('function');
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
