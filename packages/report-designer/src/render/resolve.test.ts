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
