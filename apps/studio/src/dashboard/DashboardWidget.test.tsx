import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { DashboardWidget, bindQuery } from './DashboardWidget';
import type { WidgetConfig } from '../api';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const cfg: WidgetConfig = { id: 'w', type: 'kpi', title: 'Orders', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] } };

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(value: number) {
  return new Response(JSON.stringify({ columns: [], rows: [{ label: 'x', value }], chart: { type: 'stat', value: String(value), label: 'x' }, meta: { generatedAt: 'now', rowCount: 1 } }), { status: 200 });
}

describe('DashboardWidget refresh lifecycle', () => {
  it('waits for completion before counting the next refresh interval', async () => {
    vi.useFakeTimers();
    const pending = deferredResponse();
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise).mockResolvedValue(response(8));
    const view = render(<DashboardWidget config={{ ...cfg, refreshIntervalSec: 1 }} filterValues={{}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(response(7)); });
    expect(view.getByText('7')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(view.getByText('8')).toBeTruthy();
  });

  it.each(['filters', 'query'] as const)('aborts obsolete requests after %s change and ignores late results', async (change) => {
    const old = deferredResponse();
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(old.promise).mockResolvedValue(response(8));
    const view = render(<DashboardWidget config={cfg} filterValues={{}} />);
    const signal = fetch.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    view.rerender(<DashboardWidget config={change === 'query' ? { ...cfg, query: { mode: 'sql', sql: 'select 8' } } : cfg} filterValues={change === 'filters' ? { period: 'new' } : {}} />);
    expect(signal?.aborted).toBe(true);
    expect(await view.findByText('8')).toBeTruthy();
    await act(async () => { old.resolve(response(7)); });
    expect(view.queryByText('7')).toBeNull();
    expect(view.getByText('8')).toBeTruthy();
  });

  it('ignores an obsolete rejection after the replacement request succeeds', async () => {
    const old = deferredResponse();
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(old.promise).mockResolvedValue(response(8));
    const view = render(<DashboardWidget config={cfg} filterValues={{}} />);
    view.rerender(<DashboardWidget config={cfg} filterValues={{ period: 'new' }} />);
    expect(await view.findByText('8')).toBeTruthy();
    await act(async () => { old.reject(new DOMException('obsolete request', 'AbortError')); });
    expect(view.queryByText(/obsolete request/)).toBeNull();
    expect(view.getByText('8')).toBeTruthy();
  });

  it('aborts on unmount and never schedules another request', async () => {
    vi.useFakeTimers();
    const pending = deferredResponse();
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending.promise);
    const view = render(<DashboardWidget config={{ ...cfg, refreshIntervalSec: 1 }} filterValues={{}} />);
    const signal = fetch.mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.reject(new DOMException('aborted', 'AbortError')); await vi.advanceTimersByTimeAsync(5000); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('clears an earlier error when the next refresh succeeds', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValue(response(8));
    const view = render(<DashboardWidget config={{ ...cfg, refreshIntervalSec: 1 }} filterValues={{}} />);
    await act(async () => {});
    expect(view.getByText('temporary failure')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(view.queryByText('temporary failure')).toBeNull();
    expect(view.getByText('8')).toBeTruthy();
  });

  it('does not poll when automatic refresh is disabled', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(7));
    const view = render(<DashboardWidget config={cfg} filterValues={{}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(view.getByText('7')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('DashboardWidget', () => {
  it('fetches and renders the value', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ columns: [], rows: [{ label: 'x', value: 7 }], chart: { type: 'stat', value: '7', label: 'x' }, meta: { generatedAt: 'now', rowCount: 1 } }), { status: 200 }));
    const { getByText } = render(<DashboardWidget config={cfg} filterValues={{}} />);
    await waitFor(() => expect(getByText('7')).toBeTruthy());
  });
  it('shows an error message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 400 }));
    const { findByText } = render(<DashboardWidget config={cfg} filterValues={{}} />);
    expect(await findByText(/boom/)).toBeTruthy();
  });
});

describe('bindQuery', () => {
  it('expands a date-range dashboard-filter binding into gte + lte', () => {
    const q = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [], variableBindings: { authored_on: 'period' } } as any;
    const out = bindQuery(q, { period: { from: '2024-01-01', to: '2024-03-31' } }) as any;
    expect(out.filters).toEqual([
      { dimension: 'authored_on', op: 'gte', value: '2024-01-01' },
      { dimension: 'authored_on', op: 'lte', value: '2024-03-31' },
    ]);
  });

  it('binds a scalar dashboard filter as an eq filter (unchanged)', () => {
    const q = { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [], variableBindings: { priority: 'prio' } } as any;
    const out = bindQuery(q, { prio: 'stat' }) as any;
    expect(out.filters).toEqual([{ dimension: 'priority', op: 'eq', value: 'stat' }]);
  });

  it('drops a bound row\'s stale literal filter so the binding supersedes it (date-range)', () => {
    const q = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'authored_on', op: 'eq', value: '' }],
      variableBindings: { authored_on: 'period' },
    } as any;
    const out = bindQuery(q, { period: { from: '2024-01-01', to: '2024-03-31' } }) as any;
    expect(out.filters).toEqual([
      { dimension: 'authored_on', op: 'gte', value: '2024-01-01' },
      { dimension: 'authored_on', op: 'lte', value: '2024-03-31' },
    ]);
  });

  it('drops a bound row\'s stale literal filter so the binding supersedes it (scalar)', () => {
    const q = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      filters: [{ dimension: 'priority', op: 'eq', value: '' }],
      variableBindings: { priority: 'prio' },
    } as any;
    const out = bindQuery(q, { prio: 'stat' }) as any;
    expect(out.filters).toEqual([{ dimension: 'priority', op: 'eq', value: 'stat' }]);
  });

  it('injects a scalar binding into a filterTree, pruning the bound dimension', () => {
    const q = {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      filterTree: { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'F' }] },
      variableBindings: { priority: 'prio' },
    } as any;
    const out = bindQuery(q, { prio: 'stat' }) as any;
    expect(out.filterTree).toEqual({
      kind: 'group', combinator: 'and',
      children: [
        { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'status', op: 'eq', value: 'F' }] },
        { kind: 'rule', dimension: 'priority', op: 'eq', value: 'stat' },
      ],
    });
  });
});
