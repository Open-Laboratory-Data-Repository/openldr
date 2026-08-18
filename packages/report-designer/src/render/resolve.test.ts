import { describe, it, expect, vi } from 'vitest';
import { resolveDesignTables } from './resolve';

describe('resolveDesignTables', () => {
  it('resolves bound tables and turns a failing query into an error entry', async () => {
    const runQuery = async (queryId: string) => {
      if (queryId === 'q1') return { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] };
      throw new Error(`custom query not found: ${queryId}`);
    };
    const design = { parameters: [], pages: [{ id: 'p', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 }, dataSource: { kind: 'custom-query', queryId: 'q1' } },
      { id: 't2', kind: 'table', name: 'T2', rect: { x: 0, y: 0, w: 1, h: 1 }, dataSource: { kind: 'custom-query', queryId: 'missing' } },
      { id: 'txt', kind: 'text', name: 'x', rect: { x: 0, y: 0, w: 1, h: 1 }, text: 'hi' },
    ] }] } as any;
    const resolved = await resolveDesignTables(design, {}, runQuery);
    expect(resolved.get('t1')).toEqual({ columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] });
    expect((resolved.get('t2') as any).error).toContain('missing');
    expect(resolved.has('txt')).toBe(false);
  });
});

describe('resolveDesignTables — non-table bound elements', () => {
  it('resolves a bound KEYVALUE panel: the guard is dataSource, not kind', async () => {
    const runQuery = async () => ({ columns: [{ key: 'sn', label: 'Surname' }], rows: [{ sn: 'MWASEKAGA' }] });
    const design = { parameters: [], pages: [{ id: 'p', elements: [
      { id: 'kv', kind: 'keyvalue', name: 'K', rect: { x: 0, y: 0, w: 1, h: 1 }, dataSource: { kind: 'custom-query', queryId: 'q' } },
    ] }] } as any;
    const resolved = await resolveDesignTables(design, {}, runQuery);
    // Before S4 this was `undefined` — the panel rendered blank with no error to explain it.
    expect(resolved.get('kv')).toEqual({ columns: [{ key: 'sn', label: 'Surname' }], rows: [{ sn: 'MWASEKAGA' }] });
  });

  it('still skips every element that carries no dataSource, whatever its kind', async () => {
    const runQuery = vi.fn(async () => ({ columns: [], rows: [] }));
    const design = { parameters: [], pages: [{ id: 'p', elements: [
      { id: 'kv', kind: 'keyvalue', name: 'K', rect: { x: 0, y: 0, w: 1, h: 1 }, rows: [['A', 'B']] },
      { id: 'r', kind: 'rect', name: 'R', rect: { x: 0, y: 0, w: 1, h: 1 } },
    ] }] } as any;
    const resolved = await resolveDesignTables(design, {}, runQuery);
    expect(resolved.size).toBe(0);
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe('resolveDesignTables — sortBy', () => {
  // ⛔ Why an element-level sort exists at all: `planPagination` wraps a stored query as
  // `select * from (<inner>) as _q limit N offset 0` (packages/dashboards/src/sql-runner.ts:56).
  // MySQL's optimizer is free to discard an ORDER BY inside a derived table, so a query whose
  // FIRST row is meaningful (the transmission grid's date row) cannot rely on the engine keeping
  // it first. Sorting here — where the rows enter the renderer — makes every downstream consumer
  // (rows, cell statuses, keyvalue pairs) see one order.
  it('orders the resolved rows by the named column, numerically when it holds numbers', async () => {
    // ⛔ The fixture is 2 and 10, NOT 0 and 1. Under a pure string comparator '0' still sorts
    // before '1', so the old {0,1} fixture passed with the numeric branch of `compareOn` deleted —
    // it claimed to test numeric ordering and could not see its absence. '10' < '2' as text, so
    // this ordering is only reachable numerically.
    const runQuery = async () => ({
      columns: [{ key: 'ord', label: 'ord' }, { key: 'lab', label: 'lab' }],
      rows: [{ ord: 10, lab: 'B' }, { ord: 2, lab: '(dates)' }, { ord: 10, lab: 'A' }],
    });
    const design = { parameters: [], pages: [{ id: 'p', elements: [
      { id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 }, sortBy: 'ord',
        dataSource: { kind: 'custom-query', queryId: 'q' } },
    ] }] } as any;
    const resolved = await resolveDesignTables(design, {}, runQuery);
    expect((resolved.get('t') as any).rows.map((r: any) => r.lab)).toEqual(['(dates)', 'B', 'A']);
  });

  it('is stable — rows sharing a sort value keep the order the query returned them in', async () => {
    const runQuery = async () => ({
      columns: [{ key: 'ord', label: 'ord' }],
      rows: [{ ord: 1, lab: 'A' }, { ord: 1, lab: 'B' }, { ord: 1, lab: 'C' }],
    });
    const design = { parameters: [], pages: [{ id: 'p', elements: [
      { id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 }, sortBy: 'ord',
        dataSource: { kind: 'custom-query', queryId: 'q' } },
    ] }] } as any;
    const resolved = await resolveDesignTables(design, {}, runQuery);
    expect((resolved.get('t') as any).rows.map((r: any) => r.lab)).toEqual(['A', 'B', 'C']);
  });

  it('leaves the rows exactly as the query returned them when no sortBy is set', async () => {
    const runQuery = async () => ({
      columns: [{ key: 'ord', label: 'ord' }],
      rows: [{ ord: 9 }, { ord: 2 }],
    });
    const design = { parameters: [], pages: [{ id: 'p', elements: [
      { id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 },
        dataSource: { kind: 'custom-query', queryId: 'q' } },
    ] }] } as any;
    const resolved = await resolveDesignTables(design, {}, runQuery);
    expect((resolved.get('t') as any).rows.map((r: any) => r.ord)).toEqual([9, 2]);
  });
});
