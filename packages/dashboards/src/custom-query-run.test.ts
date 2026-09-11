import { describe, it, expect } from 'vitest';
import { runStoredQuery } from './custom-query-run';
it('runs a stored query through substitute→validate→connector', async () => {
  const deps = {
    customQueries: { get: async () => ({ id: 'q', name: 'q', connectorId: 'c', sql: 'select 1 as a', params: [] }) },
    runConnectorSql: async () => ({ columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] }),
  };
  expect((await runStoredQuery(deps as any, 'q', {})).rows).toEqual([{ a: 1 }]);
});

it('delegates row-cap pagination to runConnectorSql instead of wrapping the SQL itself', async () => {
  let received: { connectorId: string; sql: string; rowCap?: number; offset?: number } | undefined;
  const deps = {
    customQueries: { get: async () => ({ id: 'q', name: 'q', connectorId: 'conn-1', sql: 'select 1 as a', params: [] }) },
    runConnectorSql: async (input: { connectorId: string; sql: string; rowCap?: number; offset?: number }) => {
      received = input;
      return { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] };
    },
  };
  await runStoredQuery(deps as any, 'q', {});
  expect(received).toEqual({ connectorId: 'conn-1', sql: 'select 1 as a', rowCap: 1001 });
});

it.each([0, 999, 1000])('returns all %i rows within the stored query bound', async (count) => {
  const rows = Array.from({ length: count }, (_, a) => ({ a }));
  const result = await runStoredQuery({
    customQueries: { get: async () => ({ connectorId: 'c', sql: 'select a from rows limit 1000', params: [] }) as any },
    runConnectorSql: async () => ({ columns: [], rows }),
  }, 'q', {});
  expect(result.rows).toEqual(rows);
});
it('refuses a 1001st row instead of returning a partial stored query', async () => {
  await expect(runStoredQuery({
    customQueries: { get: async () => ({ connectorId: 'c', sql: 'select a from rows', params: [] }) as any },
    runConnectorSql: async ({ rowCap }) => ({ columns: [], rows: Array.from({ length: rowCap! }, (_, a) => ({ a })) }),
  }, 'q', {})).rejects.toThrow('1000');
});


it('respects an intentional SQL LIMIT inside the overflow probe', async () => {
  const { newDb } = await import('pg-mem');
  const { planPagination } = await import('./sql-runner');
  const db = newDb();
  db.public.none('create table source_rows (a integer)');
  db.public.none(`insert into source_rows values ${Array.from({ length: 1001 }, (_, a) => `(${a})`).join(',')}`);
  const result = await runStoredQuery({
    customQueries: { get: async () => ({ connectorId: 'c', sql: 'select a from source_rows order by a limit 1000', params: [] }) as any },
    runConnectorSql: async ({ sql, rowCap }) => ({ columns: [], rows: db.public.many(planPagination(sql, 'postgres', { limit: rowCap! }).sql) }),
  }, 'q', {});
  expect(result.rows).toHaveLength(1000);
  expect(result.rows[999]).toEqual({ a: 999 });
});
