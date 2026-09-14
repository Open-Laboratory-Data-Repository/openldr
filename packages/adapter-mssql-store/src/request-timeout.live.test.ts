import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createMssqlStore } from './index';

const port = process.env.MSSQL_DEADLINE_TEST_PORT;
const live = describe.skipIf(!port);

live('SQL Server request deadline', () => {
  const store = createMssqlStore({
    host: process.env.MSSQL_DEADLINE_TEST_HOST ?? '127.0.0.1',
    port: Number(port),
    database: process.env.MSSQL_DEADLINE_TEST_DATABASE ?? 'master',
    user: process.env.MSSQL_DEADLINE_TEST_USER ?? 'sa',
    password: process.env.MSSQL_DEADLINE_TEST_PASSWORD ?? '',
    encrypt: false,
    trustServerCertificate: true,
  });

  afterAll(async () => { await store.close(); });

  it('cancels slow work and reuses a clean connection', async () => {
    const startedAt = Date.now();
    await expect(store.withRequestTimeout(100, () =>
      sql.raw("waitfor delay '00:00:02'; select 1 as value").execute(store.db),
    )).rejects.toThrow(/timeout/i);
    expect(Date.now() - startedAt).toBeLessThan(1_500);

    const result = await store.withRequestTimeout(1_000, () =>
      sql<{ value: number }>`select 1 as value union all select 2 as value`.execute(store.db),
    );
    expect(result.rows.map((row) => Number(row.value))).toEqual([1, 2]);
  });

  it('clears session-scoped query controls before pool reuse', async () => {
    await store.withRequestTimeout(1_000, () =>
      sql.raw('set lock_timeout 7; set rowcount 1; select 1 as value').execute(store.db),
    );

    const result = await store.withRequestTimeout(1_000, () =>
      sql<{ lockTimeout: number; value: number }>`
        select @@lock_timeout as lockTimeout, value
        from (values (1), (2)) as rows(value)
        order by value
      `.execute(store.db),
    );
    expect(result.rows.map((row) => Number(row.value))).toEqual([1, 2]);
    expect(Number(result.rows[0].lockTimeout)).toBe(-1);
  });
});
