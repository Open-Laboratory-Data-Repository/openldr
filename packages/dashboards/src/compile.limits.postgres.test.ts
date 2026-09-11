import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createRequire } from 'node:module';
import { runBuilderQuery } from './compile';
import { getModel } from './models/registry';
import type { WidgetQuery } from './types';

// Explicit disposable database only. Never falls back to application configuration.
const url = process.env.BUILDER_LIMITS_TEST_URL;
const pg = createRequire(createRequire(import.meta.url).resolve('@openldr/db'))('pg');
const suite = url ? describe : describe.skip;
suite('builder execution bounds on PostgreSQL', () => {
  let db: Kysely<any>;
  const schema = `builder_limits_${process.pid}`;
  const model = getModel('service_requests')!;
  const query: Extract<WidgetQuery, { mode: 'builder' }> = {
    mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
    dimension: { key: 'code_text' }, filters: [], limit: 1,
  };
  const bounds = { timeoutMs: 1000, rowCap: 3 };
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/review') {
      throw new Error('Use a localhost disposable review database');
    }
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}` }) }) });
    await sql.raw(`create schema ${schema}`).execute(db);
    await sql`create table lab_requests (panel_desc text, authored_at text, priority text)`.execute(db);
    await sql`insert into lab_requests values ('A', '2024-01-01', 'X'), ('B', '2024-01-02', 'X'), ('C', '2024-02-01', 'Y'), ('C', '2024-02-01', 'Y')`.execute(db);
  });
  afterAll(async () => {
    if (db) { await sql.raw(`drop schema ${schema} cascade`).execute(db); await db.destroy(); }
  });
  it('refuses overflow before top-N can hide missing groups', async () => {
    await expect(runBuilderQuery(db, model, query, undefined, { ...bounds, rowCap: 2 })).rejects.toThrow(/group.*limit|limit.*group/i);
  });
  it('keeps complete aggregate totals and chooses the actual top label at the boundary', async () => {
    expect((await runBuilderQuery(db, model, query, undefined, bounds)).rows).toEqual([{ label: 'C', value: 2 }]);
  });
  it('preserves date buckets and breakdown totals at the boundary', async () => {
    const q = { ...query, dimension: { key: 'authored_on', grain: 'month' as const }, breakdown: { key: 'priority' }, limit: undefined };
    expect((await runBuilderQuery(db, model, q, undefined, bounds)).rows).toEqual([
      { label: '2024-01', series: 'X', value: 2 }, { label: '2024-02', series: 'Y', value: 2 },
    ]);
    await expect(runBuilderQuery(db, model, q, undefined, { ...bounds, rowCap: 2 })).rejects.toThrow(/group.*limit|limit.*group/i);
  });
  it('refuses wide query overflow before computing derived measures', async () => {
    const q = { ...query, metrics: [{ key: 'total', agg: 'count' as const }, { key: 'ratio', agg: 'count' as const, derived: { numerator: 'total', denominator: 'total', scale: 100, decimals: 1 } }] };
    await expect(runBuilderQuery(db, model, q, undefined, { ...bounds, rowCap: 2 })).rejects.toThrow(/group.*limit|limit.*group/i);
    expect((await runBuilderQuery(db, model, q, undefined, bounds)).rows).toEqual([{ label: 'C', total: 2, ratio: 100 }]);
  });
  it('retains bound filter values and aggregates all source rows', async () => {
    const q = { ...query, dimension: undefined, filters: [{ dimension: 'code_text', op: 'eq' as const, value: 'C' }] };
    const result = await runBuilderQuery(db, model, q, undefined, { ...bounds, rowCap: 1 });
    expect(result.rows[0].value).toBe(2);
  });
  it('cancels a slow database statement and leaves the connection reusable', async () => {
    await sql`create view slow_requests as select lab_requests.* from lab_requests, lateral pg_sleep(0.2)`.execute(db);
    const slowModel = { ...model, table: 'slow_requests' as typeof model.table };
    await expect(runBuilderQuery(db, slowModel, query, undefined, { ...bounds, timeoutMs: 20 })).rejects.toThrow(/statement timeout/);
    expect((await runBuilderQuery(db, model, query, undefined, bounds)).rows).toEqual([{ label: 'C', value: 2 }]);
    const timeout = await sql<{ statement_timeout: string }>`show statement_timeout`.execute(db);
    expect(timeout.rows[0].statement_timeout).toBe('0');
  });
});
