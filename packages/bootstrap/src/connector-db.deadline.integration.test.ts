import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { createConnection } from 'mysql2/promise';
import { createConnectorDb } from './connector-db';

// Only explicitly supplied disposable databases may run these tests.
const pgUrl = process.env.CONNECTOR_DEADLINE_TEST_PG_URL;
const mysqlUrl = process.env.CONNECTOR_DEADLINE_TEST_MYSQL_URL;

describe.skipIf(!pgUrl)('PostgreSQL connector deadline', () => {
  it('cancels slow SQL, closes its connection, and accepts another query', async () => {
    const url = new URL(pgUrl!);
    const config = { host: url.hostname, port: url.port, user: url.username, password: url.password, database: url.pathname.slice(1) };
    const conn = createConnectorDb('postgres', config, { queryTimeoutMs: 150 });
    const observer = new pg.Client({ connectionString: pgUrl });
    await observer.connect();
    try {
      const { rows } = await conn.query('select pg_backend_pid() as id');
      const id = rows[0]!.id;
      const start = Date.now();
      await expect(conn.query('select pg_sleep(2)')).rejects.toThrow(/timeout|deadline/i);
      expect(Date.now() - start).toBeLessThan(1500);
      expect((await conn.query('select 42 as answer')).rows).toEqual([{ answer: 42 }]);
      await conn.close();
      const active = await observer.query('select pid from pg_stat_activity where pid = $1', [id]);
      expect(active.rows).toEqual([]);
    } finally {
      await conn.close();
      await observer.end();
    }
  });
});

describe.skipIf(!mysqlUrl)('MySQL connector deadline', () => {
  it('kills slow SQL on the server, preserves collation, and accepts another query', async () => {
    const url = new URL(mysqlUrl!);
    const config = { host: url.hostname, port: url.port, user: url.username, password: url.password, database: url.pathname.slice(1) };
    const conn = createConnectorDb('mysql', config, { queryTimeoutMs: 150 });
    const observer = await createConnection(mysqlUrl!);
    try {
      const { rows } = await conn.query('select connection_id() as id, @@collation_connection = @@collation_database as matched');
      const id = rows[0]!.id;
      expect(rows[0]!.matched).toBe(1);
      const start = Date.now();
      await expect(conn.query('select sleep(2)')).rejects.toThrow(/timeout|deadline/i);
      expect(Date.now() - start).toBeLessThan(1500);
      const [active] = await observer.query('select ID from information_schema.PROCESSLIST where ID = ?', [id]);
      expect(active).toEqual([]);
      expect((await conn.query('select 42 as answer')).rows).toEqual([{ answer: 42 }]);
      const healthy = await conn.query('select connection_id() as id');
      await conn.close();
      const [remaining] = await observer.query('select ID from information_schema.PROCESSLIST where ID = ?', [healthy.rows[0]!.id]);
      expect(remaining).toEqual([]);
    } finally {
      await conn.close();
      await observer.end();
    }
  });
});
