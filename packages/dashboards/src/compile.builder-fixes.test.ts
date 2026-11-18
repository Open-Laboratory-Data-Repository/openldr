import { describe, it, expect } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import { compileBuilderQuery } from './compile';
import { getModel } from './models/registry';

// Roles part 3, the sample rebuild (operator, 2026-11-18: fix the four builder faults). Layer: the
// SQL text only; the numbers are compared with the old SQL tiles in sample.postgres.test.ts.
const db = new Kysely<any>({ dialect: new PostgresDialect({ pool: {} as never }) });
const count = { key: 'count', agg: 'count' as const };
const compile = (model: string, q: object) => compileBuilderQuery(db, getModel(model)!, { mode: 'builder', model, metric: count, filters: [], ...q } as never).compile();

describe('builder fixes', () => {
  it('compares a date filter by day, so a period ending 31 Jan includes 31 Jan', () => {
    const { sql, parameters } = compile('service_requests', { filters: [
      { dimension: 'authored_on', op: 'gte', value: '2024-01-01' },
      { dimension: 'authored_on', op: 'lte', value: '2024-01-31' },
    ] });
    expect(sql).toContain('substring("authored_at", 1, 10) >= $1');
    expect(sql).toContain('substring("authored_at", 1, 10) <= $2');
    expect(parameters).toEqual(['2024-01-01', '2024-01-31']);
  });

  it('does the same inside a filter tree and a metric condition, and leaves a full timestamp alone', () => {
    const tree = compile('service_requests', { filterTree: { kind: 'group', combinator: 'and', children: [
      { kind: 'rule', dimension: 'authored_on', op: 'lte', value: '2024-01-31' },
      { kind: 'rule', dimension: 'authored_on', op: 'gte', value: '2024-01-01T10:00:00' },
    ] } });
    expect(tree.sql).toContain('substring("authored_at", 1, 10) <= $1');
    expect(tree.sql).toContain('"authored_at" >= $2');
    const wide = compileBuilderQuery(db, getModel('service_requests')!, { mode: 'builder', model: 'service_requests', filters: [],
      metrics: [{ key: 'jan', agg: 'count', where: [{ dimension: 'authored_on', op: 'lte', value: '2024-01-31' }] }] } as never).compile();
    expect(wide.sql).toContain('substring("authored_at", 1, 10) <= $1');
  });

  it('groups a date dimension with a grain by its day in SQL, so groups are days, not timestamps', () => {
    const { sql } = compile('service_requests', { dimension: { key: 'authored_on', grain: 'day' } });
    expect(sql).toContain('substring("authored_at", 1, 10) as "label"');
    expect(sql).toContain('group by substring("authored_at", 1, 10)');
    expect(compile('service_requests', { dimension: { key: 'authored_on' } }).sql).toContain('"authored_at" as "label"');
  });

  it('has neq, which keeps empty values, and set, which needs a value', () => {
    const neq = compile('service_requests', { filters: [{ dimension: 'status', op: 'neq', value: 'cancelled' }] });
    expect(neq.sql).toContain('("status" is null or "status" <> $1)');
    const set = compile('service_requests', { filters: [{ dimension: 'priority', op: 'set', value: null }] });
    expect(set.sql).toContain('"priority" is not null');
    const tree = compile('service_requests', { filterTree: { kind: 'group', combinator: 'and', children: [
      { kind: 'rule', dimension: 'priority', op: 'set', value: null },
      { kind: 'rule', dimension: 'status', op: 'neq', value: 'cancelled' },
    ] } });
    expect(tree.sql).toContain('"priority" is not null');
    expect(tree.sql).toContain('"status" is null or "status" <> $1');
  });

  it('joins a result to its request by the request\'s id, which is what a result stores', () => {
    const { sql } = compile('observations', { adhocDimensions: [{ key: 'req_test', label: 'Test', join: 'jr', column: 'panel_desc', kind: 'string' }],
      filters: [{ dimension: 'req_test', op: 'eq', value: 'HIV' }] });
    expect(sql).toContain('"lab_results"."request_id" = "jr"."id"');
  });

  it('offers a result\'s status', () => {
    expect(getModel('observations')!.dimensions.find((d) => d.key === 'status')?.column).toBe('status');
  });
});
