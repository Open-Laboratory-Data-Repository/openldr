import { describe, it, expect, vi } from 'vitest';
import { fetchResolvedTables, designPageCounts } from './pageCounts';
import type { ReportTemplate, DesignElement } from './types';

const design = (elements: DesignElement[]): ReportTemplate => ({
  id: 'd', name: 'D', paper: 'A4', orientation: 'portrait', status: 'draft',
  parameters: [{ key: 'month', label: 'Month', type: 'text', value: '2018-08' }],
  pages: [{ id: 'p1', elements }],
});

const boundTable = (id: string, h = 120): DesignElement => ({
  id, kind: 'table', name: id, rect: { x: 0, y: 0, w: 400, h },
  dataSource: { kind: 'custom-query', queryId: 'cq_1' },
  boundColumns: [{ key: 'a', label: 'A' }],
});

const CQ = { id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 'select 1', params: [{ id: 'month' }] } as never;

describe('fetchResolvedTables', () => {
  it('runs each bound query with the design param values and pages past the run cap', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 1000 }, () => ({ a: '1' })) })
      .mockResolvedValueOnce({ columns: [{ key: 'a', label: 'A' }], rows: [{ a: '2' }] });
    const resolved = await fetchResolvedTables(design([boundTable('t')]), { list: async () => [CQ], run });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ values: { month: '2018-08' }, offset: 0 }));
    const t = resolved.get('t');
    expect(t && 'rows' in t ? t.rows.length : 0).toBe(1001);
  });

  it('fetches a shared query once for two elements bound to it', async () => {
    const run = vi.fn().mockResolvedValue({ columns: [{ key: 'a', label: 'A' }], rows: [{ a: '1' }] });
    const resolved = await fetchResolvedTables(design([boundTable('t1'), boundTable('t2')]), { list: async () => [CQ], run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(resolved.get('t1')).toBeDefined();
    expect(resolved.get('t2')).toBeDefined();
  });

  it('a failed query resolves to an error entry, never a rejection', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    const resolved = await fetchResolvedTables(design([boundTable('t')]), { list: async () => [CQ], run });
    expect(resolved.get('t')).toEqual({ error: 'boom' });
  });

  it('an unbound design fetches nothing', async () => {
    const list = vi.fn();
    const run = vi.fn();
    const el: DesignElement = { id: 'x', kind: 'text', name: 'x', rect: { x: 0, y: 0, w: 10, h: 10 } };
    const resolved = await fetchResolvedTables(design([el]), { list, run });
    expect(resolved.size).toBe(0);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('designPageCounts', () => {
  it('counts one page per design page with no data, more when a table overflows', async () => {
    const short = designPageCounts(design([boundTable('t')]), new Map());
    expect(short).toEqual({ perPage: [1], total: 1 });
    const rows = Array.from({ length: 40 }, (_, i) => ({ a: String(i) }));
    const long = designPageCounts(design([boundTable('t')]),
      new Map([['t', { columns: [{ key: 'a', label: 'A' }], rows }]]));
    expect(long.perPage[0]).toBeGreaterThan(1);
    expect(long.total).toBe(long.perPage[0]);
  });
});
