import { StrictMode, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { TermPicker, type PickedTerm } from './TermPicker';
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'amp' } });
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.at(-1)![1].status).toEqual(['ACTIVE', 'DRAFT']);
  });

  it('sends a single status as a one-element list', async () => {
    const spy = vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [], total: 0 } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" statuses={['ACTIVE']} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.at(-1)![1].status).toEqual(['ACTIVE']);
  });

  it('sends no status when it was given none', async () => {
    const spy = vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [], total: 0 } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.at(-1)![1].status).toBeUndefined();
  });

  // The user-visible half of the same defect, against a fake that models what the SERVER really
  // does — not a simplified `wanted.includes(row.status)`.
  //
  // Two things that simpler fake got wrong, and both hid a Critical regression:
  //   1. A loader-imported concept is stored with status NULL, never 'ACTIVE'
  //      (organisms.ts:64, whonet.ts:42, result-parameters.ts:70, generic.ts:39). SQL `IN` does
  //      not match NULL, so the store has to let NULL in whenever ACTIVE is asked for; the
  //      `storedStatus` field below is that row class. On the live dev database 328 of 790
  //      concepts are in it.
  //   2. The wire never shows NULL. The store's `termRow` reports `status ?? 'ACTIVE'`, so the
  //      row arrives looking ACTIVE. Filtering on the REPORTED status is what made the class
  //      invisible to every test.
  const fakeSearch = (rows: { row: ReturnType<typeof term>; storedStatus: string | null }[]) =>
    vi.spyOn(api, 'searchTerms').mockImplementation(async (_systemId, p) => {
      const wanted = p.status === undefined ? undefined : (Array.isArray(p.status) ? p.status : [p.status]);
      const kept = wanted
        ? rows.filter((r) => (r.storedStatus === null ? wanted.includes('ACTIVE') : wanted.includes(r.storedStatus)))
        : rows;
      return { rows: kept.map((r) => r.row), total: kept.length } as never;
    });

  it('does not offer a term whose status was not asked for', async () => {
    fakeSearch([
      { row: term('L-1', 'Active Lab'), storedStatus: 'ACTIVE' },
      { row: term('L-2', 'Draft Lab', 'DRAFT'), storedStatus: 'DRAFT' },
      { row: term('L-9', 'Deleted Lab', 'DEPRECATED'), storedStatus: 'DEPRECATED' },
    ]);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" statuses={['ACTIVE', 'DRAFT']} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });

    await screen.findByText('Active Lab');
    expect(screen.getByText('Draft Lab')).toBeInTheDocument();
    expect(screen.queryByText('Deleted Lab')).toBeNull();
  });

  it('still offers a loader-imported term, whose stored status is NULL rather than ACTIVE', async () => {
    fakeSearch([
      { row: term('ORG-1', 'Escherichia coli'), storedStatus: null },
      { row: term('L-9', 'Deleted Lab', 'DEPRECATED'), storedStatus: 'DEPRECATED' },
    ]);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" statuses={['ACTIVE', 'DRAFT']} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'coli' } });

    expect(await screen.findByText('Escherichia coli')).toBeInTheDocument();
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
    const box = screen.getByRole('combobox');

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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });

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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'l' } });

    expect(await screen.findByText(/at least 2 characters/i)).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(spy).not.toHaveBeenCalled();
  });

  // `CodesEditor` points this picker at arbitrary coding systems where a one-character code is
  // ordinary (S/I/R, M/F, ABO). At the 2-character default those were findable only by display
  // text, so the minimum has to be overridable per call site.
  it('searches on one character when the call site lowers the minimum', async () => {
    const spy = vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [term('R', 'Resistant')], total: 1 } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" minQueryLength={1} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'R' } });

    expect(await screen.findByText('Resistant')).toBeInTheDocument();
    expect(spy.mock.calls.at(-1)![1].q).toBe('R');
    expect(screen.queryByText(/at least/i)).toBeNull();
  });

  // The dropdown is absolutely positioned, so it COVERS what is below it rather than pushing it
  // down. Opening on focus alone therefore hid `TermMappingDialog`'s search hint behind a panel
  // that had nothing to say yet.
  it('does not open the panel on focus alone, and opens it once something is typed', async () => {
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [], total: 0 } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    const box = screen.getByRole('combobox');

    fireEvent.focus(box);
    expect(screen.queryByText(/at least 2 characters/i)).toBeNull();

    fireEvent.change(box, { target: { value: 'l' } });
    expect(await screen.findByText(/at least 2 characters/i)).toBeInTheDocument();
  });

  it('shows a spinner while the search is in flight, and no "no results" until it answers', async () => {
    let release!: (v: { rows: unknown[]; total: number }) => void;
    vi.spyOn(api, 'searchTerms').mockImplementation(
      () => new Promise((resolve) => { release = resolve as never; }) as never,
    );
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });

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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });

    expect(await screen.findByText(/could not search/i)).toBeInTheDocument();
    // An error is NOT an empty result: offering "No results" for a failed request tells the
    // operator the registry has no such facility when nobody actually looked.
    expect(screen.queryByText(/no results/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Active Lab')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ── keyboard and screen-reader use (the a11y half of FAC-P1-14) ───────────────────────────────────
describe('TermPicker — keyboard and screen reader', () => {
  beforeEach(() => vi.restoreAllMocks());

  const ROWS = [term('L-1', 'Alpha Lab'), term('L-2', 'Bravo Lab'), term('L-3', 'Charlie Lab')];

  /** Types a query, waits for the three rows, and hands back the focused search box. */
  async function openWithResults(onChange = vi.fn()): Promise<HTMLElement> {
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: ROWS, total: ROWS.length } as never);
    render(<TermPicker value={null} onChange={onChange} systemId="sys1" />);
    const box = screen.getByRole('combobox', { name: /search terms/i });
    // Real DOM focus, not fireEvent.focus — the assertions below read document.activeElement.
    // It runs React's onFocus handler, so it is a state update and belongs inside act.
    act(() => { box.focus(); });
    fireEvent.change(box, { target: { value: 'lab' } });
    await screen.findByRole('option', { name: /Alpha Lab/ });
    return box;
  }

  it('names the search box — a placeholder is not an accessible name', () => {
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [], total: 0 } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    expect(screen.getByRole('combobox', { name: 'Search terms' })).toBeInTheDocument();
    // The role really changed; it is not a plain text field carrying combobox attributes.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('reports the panel as collapsed until it is showing, and expanded once it is', async () => {
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: ROWS, total: ROWS.length } as never);
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    const box = screen.getByRole('combobox', { name: /search terms/i });

    // Paired with the listbox's real presence — `aria-expanded` alone could be any constant.
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.change(box, { target: { value: 'lab' } });
    await screen.findByRole('option', { name: /Alpha Lab/ });
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('points aria-controls at the listbox that is actually rendered', async () => {
    const box = await openWithResults();
    const listbox = screen.getByRole('listbox');
    expect(listbox.id).not.toBe('');
    expect(box).toHaveAttribute('aria-controls', listbox.id);
  });

  it('renders results as options, not as buttons', async () => {
    await openWithResults();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    // A button inside a listbox nests one interactive role in another and breaks the pattern.
    expect(screen.queryByRole('button', { name: /Alpha Lab/ })).toBeNull();
  });

  it('ArrowDown highlights the first option and names it in aria-activedescendant', async () => {
    const box = await openWithResults();
    expect(box).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    const opts = screen.getAllByRole('option');
    expect(box).toHaveAttribute('aria-activedescendant', opts[0]!.id);
    expect(opts[0]).toHaveAttribute('aria-selected', 'true');
    expect(opts[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps DOM focus on the search box while the highlight moves', async () => {
    const box = await openWithResults();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(box);
    // Options must stay out of the tab order — the highlight is not DOM focus.
    for (const o of screen.getAllByRole('option')) expect(o).not.toHaveAttribute('tabindex');
  });

  it('ArrowDown then ArrowUp walks the list and stops at its ends', async () => {
    const box = await openWithResults();
    const idOf = (i: number): string => screen.getAllByRole('option')[i]!.id;

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box).toHaveAttribute('aria-activedescendant', idOf(1));
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box).toHaveAttribute('aria-activedescendant', idOf(0));
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box).toHaveAttribute('aria-activedescendant', idOf(0));

    for (let i = 0; i < 5; i += 1) fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box).toHaveAttribute('aria-activedescendant', idOf(2));
  });

  it('End jumps to the last option and Home back to the first', async () => {
    const box = await openWithResults();
    const idOf = (i: number): string => screen.getAllByRole('option')[i]!.id;

    fireEvent.keyDown(box, { key: 'End' });
    expect(box).toHaveAttribute('aria-activedescendant', idOf(2));
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(box, { key: 'Home' });
    expect(box).toHaveAttribute('aria-activedescendant', idOf(0));
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter picks the highlighted option', async () => {
    const onChange = vi.fn();
    const box = await openWithResults(onChange);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ system: 'http://x', code: 'L-2', display: 'Bravo Lab' });
  });

  it('Enter with nothing highlighted picks nothing', async () => {
    const onChange = vi.fn();
    const box = await openWithResults(onChange);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('Escape dismisses the panel without picking, and leaves focus where it was', async () => {
    const onChange = vi.fn();
    const box = await openWithResults(onChange);
    fireEvent.keyDown(box, { key: 'ArrowDown' });

    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(onChange).not.toHaveBeenCalled();
    // Focus never left the box, so there is nothing to restore.
    expect(document.activeElement).toBe(box);
  });

  it('ArrowDown reopens the panel Escape dismissed, without retyping', async () => {
    const box = await openWithResults();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('a mouse click on an option still picks it', async () => {
    const onChange = vi.fn();
    await openWithResults(onChange);
    fireEvent.click(screen.getByText('Charlie Lab'));
    expect(onChange).toHaveBeenCalledWith({ system: 'http://x', code: 'L-3', display: 'Charlie Lab' });
  });

  // ── announcements (WCAG 2.2 SC 4.1.3) ──────────────────────────────────────────────────────────
  it('announces how many results arrived, politely', async () => {
    await openWithResults();
    const live = screen.getByText('3 results available.');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('announces a failed search without an alert', async () => {
    vi.spyOn(api, 'searchTerms').mockRejectedValue(new Error('search terms failed: 500'));
    render(<TermPicker value={null} onChange={vi.fn()} systemId="sys1" />);
    fireEvent.change(screen.getByRole('combobox', { name: /search terms/i }), { target: { value: 'lab' } });

    const live = await screen.findByText('Search failed.');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces the picked term after the search box is replaced by the chip', async () => {
    function Harness(): JSX.Element {
      const [v, setV] = useState<PickedTerm | null>(null);
      return <TermPicker value={v} onChange={setV} systemId="sys1" />;
    }
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: ROWS, total: ROWS.length } as never);
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: /search terms/i });
    fireEvent.change(box, { target: { value: 'lab' } });
    await screen.findByRole('option', { name: /Alpha Lab/ });

    fireEvent.click(screen.getByText('Bravo Lab'));
    // The search box is gone; the announcement must survive that swap.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(await screen.findByText('Selected L-2 — Bravo Lab')).toHaveAttribute('aria-live', 'polite');
  });

  it('hands focus to the clear button when picking removes the search box', async () => {
    function Harness(): JSX.Element {
      const [v, setV] = useState<PickedTerm | null>(null);
      return <TermPicker value={v} onChange={setV} systemId="sys1" />;
    }
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: ROWS, total: ROWS.length } as never);
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: /search terms/i });
    // Real DOM focus, not fireEvent.focus — the assertions below read document.activeElement.
    // It runs React's onFocus handler, so it is a state update and belongs inside act.
    act(() => { box.focus(); });
    fireEvent.change(box, { target: { value: 'lab' } });
    await screen.findByRole('option', { name: /Alpha Lab/ });

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });

    const clear = await screen.findByRole('button', { name: /clear/i });
    await waitFor(() => expect(document.activeElement).toBe(clear));
  });

  // Every other test in this file mounts bare, so mount effects run once and a StrictMode-only
  // defect stays invisible. The app itself renders inside <StrictMode> (main.tsx), where every
  // effect mounts, cleans up and mounts again — the debounce timer and the highlight reset both
  // live in effects, so run the whole keyboard path through that once.
  it('works the same under StrictMode, where every effect mounts twice', async () => {
    const onChange = vi.fn();
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: ROWS, total: ROWS.length } as never);
    render(
      <StrictMode>
        <TermPicker value={null} onChange={onChange} systemId="sys1" />
      </StrictMode>,
    );
    const box = screen.getByRole('combobox', { name: /search terms/i });
    fireEvent.change(box, { target: { value: 'lab' } });
    await screen.findByRole('option', { name: /Alpha Lab/ });

    fireEvent.keyDown(box, { key: 'End' });
    expect(box).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[2]!.id);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ system: 'http://x', code: 'L-3', display: 'Charlie Lab' });
  });
});
