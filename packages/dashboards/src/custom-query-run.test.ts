import { describe, it, expect } from 'vitest';
import { runStoredQuery, substituteParams } from './custom-query-run';
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

describe('substituteParams: a blank optional parameter means no filter', () => {
  const sql = "select 1 where ({{param.facility}} = '' or code = {{param.facility}})";
  const text = { id: 'facility', label: 'Facility', type: 'text' as const, required: false };
  const select = { id: 'facility', label: 'Facility', type: 'select' as const, required: false };

  it('binds an unset optional text param to the empty string', () => {
    expect(substituteParams(sql, [text], {})).toBe("select 1 where ('' = '' or code = '')");
  });
  it('binds an unset optional select param to the empty string', () => {
    expect(substituteParams(sql, [select], {})).toBe("select 1 where ('' = '' or code = '')");
  });
  it('binds a null optional param to the empty string', () => {
    expect(substituteParams(sql, [text], { facility: null })).toBe("select 1 where ('' = '' or code = '')");
  });
  it('still throws for an unset required param', () => {
    expect(() => substituteParams(sql, [{ ...text, required: true }], {})).toThrow('required parameter: facility');
  });
  it('still binds a given value', () => {
    expect(substituteParams(sql, [text], { facility: "O'K" })).toBe("select 1 where ('O''K' = '' or code = 'O''K')");
  });
  it('still throws for a token with no declared param', () => {
    expect(() => substituteParams('select {{param.region}}', [text], {})).toThrow('unbound parameter: region');
  });
});

describe('substituteParams: a blank optional date range means no filter', () => {
  const sql = "select 1 where ({{param.from}} = '' or d >= {{param.from}}) and ({{param.to}} = '' or d <= {{param.to}})";
  const optional = { id: 'period', label: 'Period', type: 'daterange' as const, required: false };
  const required = { ...optional, required: true };

  it('binds both sides to the empty string when the range is unset', () => {
    expect(substituteParams(sql, [optional], {})).toBe("select 1 where ('' = '' or d >= '') and ('' = '' or d <= '')");
  });
  it('binds a cleared side (empty string) to the empty string', () => {
    expect(substituteParams(sql, [optional], { period: { from: '', to: '' } }))
      .toBe("select 1 where ('' = '' or d >= '') and ('' = '' or d <= '')");
  });
  it('binds the given side and leaves the other blank', () => {
    expect(substituteParams(sql, [optional], { period: { from: '2026-01-01' } }))
      .toBe("select 1 where ('2026-01-01' = '' or d >= '2026-01-01') and ('' = '' or d <= '')");
  });
  it('still binds a full range', () => {
    expect(substituteParams(sql, [optional], { period: { from: '2026-01-01', to: '2026-01-31' } }))
      .toBe("select 1 where ('2026-01-01' = '' or d >= '2026-01-01') and ('2026-01-31' = '' or d <= '2026-01-31')");
  });
  it('still rejects a malformed date', () => {
    expect(() => substituteParams(sql, [optional], { period: { from: '01/02/2026' } })).toThrow('invalid date: 01/02/2026');
  });
  it('reports a required range with a missing or cleared side as required, not as an invalid date', () => {
    expect(() => substituteParams(sql, [required], {})).toThrow('required parameter: period');
    expect(() => substituteParams(sql, [required], { period: { from: '2026-01-01', to: '' } })).toThrow('required parameter: period');
  });
});
