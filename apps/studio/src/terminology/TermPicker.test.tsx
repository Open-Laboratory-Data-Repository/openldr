import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { TermPicker } from './TermPicker';
import * as api from '../api';

const term = (code: string, display: string, status = 'ACTIVE') => ({
  system: 'http://x',
  code,
  display,
  status,
  shortName: null,
  class: null,
  unit: null,
  replacedBy: null,
  metadata: null,
  mappingCount: 0,
});

describe('TermPicker', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('searches and selects a term', async () => {
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [term('AMP', 'Ampicillin')], total: 1 } as never);
    const onChange = vi.fn();
    render(<TermPicker value={null} onChange={onChange} systemId="sys1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'amp' } });
    const opt = await screen.findByText(/Ampicillin/);
    fireEvent.click(opt);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ code: 'AMP', system: 'http://x' }));
  });

  it('shows the selected value as a chip with a clear button', () => {
    const onChange = vi.fn();
    render(<TermPicker value={{ system: 'http://x', code: 'AMP', display: 'Ampicillin' }} onChange={onChange} systemId="sys1" />);
    expect(screen.getByText(/AMP/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  // ── the status filter (FAC-P1-14) ──────────────────────────────────────────────────────────────
  //
  // Asserts the ARGUMENT the fake received, not the rendered list. A rendered-list assertion passes
  // against a picker that asked for everything and happened to be handed a filtered stub.
  it('sends every status it was given, not only a lone one', async () => {
    const spy = vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [], total: 0 } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" statuses={['ACTIVE', 'DRAFT']} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'lab' } });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.at(-1)![1].status).toEqual(['ACTIVE', 'DRAFT']);
  });

  it('sends a single status as a one-element list', async () => {
    const spy = vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [], total: 0 } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" statuses={['ACTIVE']} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'lab' } });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.at(-1)![1].status).toEqual(['ACTIVE']);
  });

  it('sends no status when it was given none', async () => {
    const spy = vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [], total: 0 } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'lab' } });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.at(-1)![1].status).toBeUndefined();
  });

  // The user-visible half of the same defect. The fake filters by the `status` it is handed, exactly
  // as the terms route's `status in (…)` does, so a picker that sends no filter is handed the
  // DEPRECATED row and offers a deleted facility as a mapping target.
  it('does not offer a term whose status was not asked for', async () => {
    const rows = [term('L-1', 'Active Lab'), term('L-2', 'Draft Lab', 'DRAFT'), term('L-9', 'Deleted Lab', 'DEPRECATED')];
    vi.spyOn(api, 'searchTerms').mockImplementation(async (_systemId, p) => {
      const wanted = p.status === undefined ? undefined : (Array.isArray(p.status) ? p.status : [p.status]);
      const kept = wanted ? rows.filter((r) => wanted.includes(r.status)) : rows;
      return { rows: kept, total: kept.length } as never;
    });
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" statuses={['ACTIVE', 'DRAFT']} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'lab' } });

    await screen.findByText('Active Lab');
    expect(screen.getByText('Draft Lab')).toBeInTheDocument();
    expect(screen.queryByText('Deleted Lab')).toBeNull();
  });

  // ── stale-response guard ───────────────────────────────────────────────────────────────────────
  //
  // ⚠ The debounce narrows this race; only the counter closes it. Both requests are in flight at
  // once here, and the OLDER one answers LAST — which no amount of debounce delay prevents.
  it('a slow answer to an older query cannot overwrite a newer one', async () => {
    const answer = new Map<string, (v: { rows: unknown[]; total: number }) => void>();
    vi.spyOn(api, 'searchTerms').mockImplementation(
      (_systemId, p) => new Promise((resolve) => { answer.set(p.q as string, resolve as never); }) as never,
    );
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    const box = screen.getByRole('textbox');

    fireEvent.change(box, { target: { value: 'older' } });
    await waitFor(() => expect(answer.has('older')).toBe(true));
    fireEvent.change(box, { target: { value: 'newer' } });
    await waitFor(() => expect(answer.has('newer')).toBe(true));

    await act(async () => { answer.get('newer')!({ rows: [term('NEW', 'Newer Result')], total: 1 }); });
    expect(screen.getByText('Newer Result')).toBeInTheDocument();

    // The stale answer lands second. `act` flushes its continuation, so this is not a race the
    // assertion can win by arriving early.
    await act(async () => { answer.get('older')!({ rows: [term('OLD', 'Stale Result')], total: 1 }); });
    expect(screen.queryByText('Stale Result')).toBeNull();
    expect(screen.getByText('Newer Result')).toBeInTheDocument();
  });

  // Every call site writes `statuses` as an inline array literal, so each PARENT render hands the
  // picker a new array object. If the debounced search depends on that identity, a parent that
  // re-renders faster than the debounce clears and re-arms the timer forever and the search never
  // runs at all. (The picker's OWN state updates are safe — its props object is not rebuilt.)
  it('still searches while a parent re-renders faster than the debounce', async () => {
    const spy = vi.spyOn(api, 'searchTerms').mockImplementation(async () => ({ rows: [term('L-1', 'Active Lab')], total: 1 } as never));
    function Parent(): JSX.Element {
      const [tick, setTick] = useState(0);
      return (
        <div>
          <button type="button" onClick={() => setTick((t) => t + 1)}>tick {tick}</button>
          <TermPicker value={null} onChange={vi.fn()} systemId="sys1" statuses={['ACTIVE', 'DRAFT']} />
        </div>
      );
    }
    render(<Parent />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'lab' } });

    // 6 × 60 ms = 360 ms, comfortably past the 200 ms debounce, with no gap long enough to reach it.
    for (let i = 0; i < 6; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: /^tick/ }));
      await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    }
    expect(spy).toHaveBeenCalled();
  });

  // ── the four search states ─────────────────────────────────────────────────────────────────────
  it('asks for a longer query instead of searching on one character', async () => {
    const spy = vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [], total: 0 } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'l' } });

    expect(await screen.findByText(/at least 2 characters/i)).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows a spinner while the search is in flight, and no "no results" until it answers', async () => {
    let release!: (v: { rows: unknown[]; total: number }) => void;
    vi.spyOn(api, 'searchTerms').mockImplementation(
      () => new Promise((resolve) => { release = resolve as never; }) as never,
    );
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'lab' } });

    expect(await screen.findByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByText(/no results/i)).toBeNull();

    await act(async () => { release({ rows: [], total: 0 }); });
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
  });

  it('reports a failed search and retries it on request', async () => {
    const spy = vi.spyOn(api, 'searchTerms')
      .mockRejectedValueOnce(new Error('search terms failed: 500'))
      .mockResolvedValue({ rows: [term('L-1', 'Active Lab')], total: 1 } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'lab' } });

    expect(await screen.findByText(/could not search/i)).toBeInTheDocument();
    // An error is NOT an empty result: offering "No results" for a failed request tells the
    // operator the registry has no such facility when nobody actually looked.
    expect(screen.queryByText(/no results/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Active Lab')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
