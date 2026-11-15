import { describe, it, expect } from 'vitest';
import { runStoredQuery, substituteParams } from './custom-query-run';
it('runs a stored query through substitute→validate→connector', async () => {
  const deps = {
    customQueries: { get: async () => ({ id: 'q', name: 'q', connectorId: 'c', sql: 'select 1 as a', params: [] }) },
    connectorDialect: async () => 'postgres' as const,
    runConnectorSql: async () => ({ columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] }),
  };
  expect((await runStoredQuery(deps as any, 'q', {})).rows).toEqual([{ a: 1 }]);
});

it('delegates row-cap pagination to runConnectorSql instead of wrapping the SQL itself', async () => {
  let received: { connectorId: string; sql: string; rowCap?: number; offset?: number } | undefined;
  const deps = {
    customQueries: { get: async () => ({ id: 'q', name: 'q', connectorId: 'conn-1', sql: 'select 1 as a', params: [] }) },
    connectorDialect: async () => 'postgres' as const,
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
    connectorDialect: async () => 'postgres' as const,
    runConnectorSql: async () => ({ columns: [], rows }),
  }, 'q', {});
  expect(result.rows).toEqual(rows);
});
it('refuses a 1001st row instead of returning a partial stored query', async () => {
  await expect(runStoredQuery({
    customQueries: { get: async () => ({ connectorId: 'c', sql: 'select a from rows', params: [] }) as any },
    connectorDialect: async () => 'postgres' as const,
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
    connectorDialect: async () => 'postgres' as const,
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

describe('substituteParams: a token sits in plain SQL', () => {
  const name = { id: 'name', label: 'Name', type: 'text' as const, required: false };
  const QUOTED_TOKEN = 'a {{param.name}} sits inside quotes, a comment or a quoted name: remove the quotes; the value is quoted for you';

  it('refuses a parameter token inside quotes and says how to fix it', () => {
    const p = [{ id: 'name', type: 'text', label: 'Name', required: false }];
    expect(() => substituteParams("SELECT * FROM t WHERE n = '{{param.name}}'", p as never, { name: 'x' }))
      .toThrow(/remove the quotes/);
  });

  it('refuses a token inside a comment on every dialect, and the sentence holds no value', () => {
    for (const dialect of ['postgres', 'mssql', 'mysql', undefined] as const) {
      let message = '';
      try { substituteParams('SELECT 1 -- {{param.name}}\nFROM t', [name], { name: 'SECRETVALUE' }, dialect); } catch (e) { message = (e as Error).message; }
      expect(message).toBe(QUOTED_TOKEN);
      expect(message).not.toContain('SECRETVALUE');
    }
  });

  it('a token that is plain under one reading only is refused with that dialect and accepted with none', () => {
    expect(() => substituteParams('SELECT [{{param.name}}]', [name], { name: 'x' }, 'mssql')).toThrow(QUOTED_TOKEN);
    expect(substituteParams('SELECT [{{param.name}}]', [name], { name: 'x' })).toBe("SELECT ['x']");
  });

  it('on postgres a token right after a lone E is refused', () => {
    expect(() => substituteParams('SELECT E{{param.name}}', [name], { name: 'x' }, 'postgres'))
      .toThrow('a {{param.name}} follows a lone E, which Postgres reads as the start of an escape string: put a space before it');
    expect(substituteParams('SELECT E{{param.name}}', [name], { name: 'x' }, 'mssql')).toBe("SELECT E'x'");
  });

  it('a string that is never closed is refused with the reader sentence', () => {
    expect(() => substituteParams("SELECT {{param.name}}, 'open", [name], { name: 'x' }, 'mssql'))
      .toThrow('the SQL has a string, comment or quoted name that is never closed');
  });
});

describe('substituteParams: a value stays one literal', () => {
  const n = { id: 'n', label: 'N', type: 'text' as const, required: false };
  const a = { id: 'a', label: 'A', type: 'text' as const, required: false };
  const b = { id: 'b', label: 'B', type: 'text' as const, required: false };
  const BACKSLASH = String.fromCharCode(92);

  it('a value of -1 after a minus sign stays one literal', () => {
    // A parameter value always goes in as a quoted string, so the quote keeps the two minus
    // signs apart. No parentheses are needed here.
    expect(substituteParams('SELECT 10 -{{param.n}}', [n], { n: -1 })).toBe("SELECT 10 -'-1'");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('refuses the number %s with a fixed sentence', (v) => {
    let message = '';
    try { substituteParams('SELECT a FROM t WHERE x = {{param.n}}', [n], { n: v }); } catch (e) { message = (e as Error).message; }
    expect(message).toBe('the value for {{param.n}} is not a finite number');
    expect(message).not.toMatch(/NaN|Infinity/);
  });

  it('on mysql a value that ends in a backslash stays one literal', () => {
    const out = substituteParams('SELECT * FROM t WHERE a = {{param.a}} AND b = {{param.b}}', [a, b], { a: `x${BACKSLASH}`, b: 'y' }, 'mysql');
    expect(out).toBe(`SELECT * FROM t WHERE a = 'x${BACKSLASH}${BACKSLASH}' AND b = 'y'`);
  });

  it.each(['mssql', 'postgres', undefined] as const)('on %s a backslash in a value is left as it is', (dialect) => {
    const out = substituteParams('SELECT * FROM t WHERE a = {{param.a}} AND b = {{param.b}}', [a, b], { a: `x${BACKSLASH}`, b: 'y' }, dialect);
    expect(out).toBe(`SELECT * FROM t WHERE a = 'x${BACKSLASH}' AND b = 'y'`);
  });
});

describe('runStoredQuery: the fill uses the connector dialect', () => {
  const BACKSLASH = String.fromCharCode(92);
  const query = {
    id: 'q', name: 'q', connectorId: 'conn-7',
    sql: 'select a from t where a = {{param.a}} and b = {{param.b}}',
    params: [
      { id: 'a', label: 'A', type: 'text' as const, required: false },
      { id: 'b', label: 'B', type: 'text' as const, required: false },
    ],
  };

  it('asks connectorDialect for the query connector, and the filled SQL follows it', async () => {
    const asked: string[] = [];
    let sent = '';
    await runStoredQuery({
      customQueries: { get: async () => query as any },
      connectorDialect: async (id) => { asked.push(id); return 'mysql'; },
      runConnectorSql: async ({ sql }) => { sent = sql; return { columns: [], rows: [] }; },
    }, 'q', { a: `x${BACKSLASH}`, b: 'y' });
    expect(asked).toEqual(['conn-7']);
    expect(sent).toBe(`select a from t where a = 'x${BACKSLASH}${BACKSLASH}' and b = 'y'`);
  });

  it('keeps one backslash when the connector is SQL Server', async () => {
    let sent = '';
    await runStoredQuery({
      customQueries: { get: async () => query as any },
      connectorDialect: async () => 'mssql',
      runConnectorSql: async ({ sql }) => { sent = sql; return { columns: [], rows: [] }; },
    }, 'q', { a: `x${BACKSLASH}`, b: 'y' });
    expect(sent).toBe(`select a from t where a = 'x${BACKSLASH}' and b = 'y'`);
  });

  it('fails with the unsupported connector sentence when the connector has no dialect, and runs nothing', async () => {
    let ran = false;
    await expect(runStoredQuery({
      customQueries: { get: async () => query as any },
      connectorDialect: async () => null,
      runConnectorSql: async () => { ran = true; return { columns: [], rows: [] }; },
    }, 'q', { a: 'x', b: 'y' })).rejects.toThrow(/^unsupported connector type$/);
    expect(ran).toBe(false);
  });
});
