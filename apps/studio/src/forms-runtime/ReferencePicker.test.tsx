import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReferencePicker } from './ReferencePicker';

// ⛔ Do not add a per-call `{ timeout: N }` to any `findBy*`/`waitFor` in this file.
// `setupTests.ts` already raises the default async-utility budget to 15000ms
// (`configure({ asyncUtilTimeout: 15000 })`), so an explicit `{ timeout: 5000 }` here would
// LOWER the effective budget below that, not extend it — this file carried exactly that mistake
// for a while (twice), misdiagnosed as "needs a longer timeout" when the actual failure was
// never a timeout at all: `findByText` was resolving fine, but the returned element reference
// went stale (detached from the DOM by a later re-render) before the following synchronous
// `toBeInTheDocument()` assertion ran, which reports as `expect(element).toBeInTheDocument()`
// failing — a materially different error from `findByText` itself rejecting ("Unable to find an
// element with the text ..."). See "shows an empty state when nothing matches" below for the one
// place in this file where that race is real, and why the fix is to re-query on every poll
// (`waitFor(() => expect(screen.getByText(...)).toBeInTheDocument())`) instead of resolving a
// `findByText` once and asserting on the stale reference.

vi.mock('@/api', () => ({
  referenceSearch: vi.fn(),
  referenceSearchPreview: vi.fn(),
}));
import { referenceSearch, referenceSearchPreview } from '@/api';

const field = { id: 'patient', displayLabel: 'Patient', fieldType: 'reference', referenceTarget: 'Patient' } as never;
const entityResult = {
  kind: 'entity' as const,
  rows: [{ reference: 'Patient/p1', display: 'Doe Jane', secondary: '1992-01-01 · F' }],
  total: 1,
};

beforeEach(() => {
  vi.mocked(referenceSearch).mockReset();
  vi.mocked(referenceSearchPreview).mockReset();
});

describe('ReferencePicker — endpoint selection', () => {
  it('searches the stored form when given a form definition id', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="form-7" multiple={false} value={null} onChange={() => {}} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await waitFor(() => expect(referenceSearch).toHaveBeenCalledWith('form-7', 'patient', { q: 'doe' }));
    expect(referenceSearchPreview).not.toHaveBeenCalled();
  });

  it('uses the preview endpoint only when preview is explicitly set', async () => {
    vi.mocked(referenceSearchPreview).mockResolvedValue(entityResult);
    const user = userEvent.setup();
    render(<ReferencePicker field={field} preview multiple={false} value={null} onChange={() => {}} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await waitFor(() => expect(referenceSearchPreview).toHaveBeenCalledTimes(1));
    expect(referenceSearch).not.toHaveBeenCalled();
  });

  it('renders an unavailable state — never the privileged preview endpoint — when given neither', () => {
    render(<ReferencePicker field={field} multiple={false} value={null} onChange={() => {}} />);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(/not attached to a saved form/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Patient')).toBeDisabled();
    expect(referenceSearchPreview).not.toHaveBeenCalled();
    expect(referenceSearch).not.toHaveBeenCalled();
  });
});

describe('ReferencePicker', () => {
  it('searches after the debounce and renders display plus secondary', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await waitFor(() => expect(screen.getByText('Doe Jane')).toBeInTheDocument());
    expect(screen.getByText('1992-01-01 · F')).toBeInTheDocument();
  });

  it('coalesces keystrokes into a single request', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await waitFor(() => expect(referenceSearch).toHaveBeenCalledTimes(1));
  });

  it('emits the selected row', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={onChange} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    // `findByText` here waits on the configured default (setupTests.ts's `asyncUtilTimeout:
    // 15000`, see ReferencePicker.test.tsx's file-level note) — do NOT add a per-call
    // `{ timeout: ... }` override; that LOWERS the effective budget below the configured 15s
    // rather than raising it.
    await user.click(await screen.findByText('Doe Jane'));
    expect(onChange).toHaveBeenCalledWith({ reference: 'Patient/p1', display: 'Doe Jane' });
  });

  it('selects with the keyboard', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={onChange} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await screen.findByText('Doe Jane');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith({ reference: 'Patient/p1', display: 'Doe Jane' });
  });

  it('clears a selection', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ReferencePicker field={field} formDefinitionId="f1" multiple={false}
        value={{ reference: 'Patient/p1', display: 'Doe Jane' }} onChange={onChange} />,
    );
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  // A display-less valueReference decodes back to a bare string by design, and the builder's
  // "Fill example" used to inject one too. `'reference' in v` throws on a primitive, and keyOf
  // runs inside key={...} during render — so this used to unmount the tree, not degrade.
  it('renders a bare-string value instead of throwing', () => {
    render(
      <ReferencePicker field={field} formDefinitionId="f1" multiple={false}
        value={'Patient/legacy' as never} onChange={() => {}} />,
    );
    expect(screen.getByText('Patient/legacy')).toBeInTheDocument();
  });

  it('renders one chip per value when multiple', () => {
    render(
      <ReferencePicker field={field} formDefinitionId="f1" multiple
        value={[{ reference: 'Patient/p1', display: 'Doe Jane' }, { reference: 'Patient/p2', display: 'Doe John' }]}
        onChange={() => {}} />,
    );
    expect(screen.getByText('Doe Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe John')).toBeInTheDocument();
  });

  // ⛔ THE transient-node trap this file exists to document (see the file-level note above): the
  // listbox opens as soon as `query.trim().length >= 2` (ReferencePicker.tsx's `open && query.trim
  // ().length >= 2` render guard), and "No matches" (`!busy && !error && rows.length === 0`)
  // renders IMMEDIATELY at that instant — `busy` only flips true once the 200ms debounce actually
  // fires (ReferencePicker.tsx:104). So "No matches" shows PRE-debounce, gets replaced by
  // "Searching…" ~200ms later, then (once the mocked response resolves) reflects whatever the mock
  // actually returned. A single `findByText` resolves against the FIRST (pre-debounce) occurrence
  // and hands back a node reference that gets detached before the following `toBeInTheDocument()`
  // runs — `waitFor` re-querying the DOM on every poll fixes THAT failure mode, but on its own it
  // is not enough: a bare `waitFor(() => expect(screen.getByText(/no matches/i))...)` right after
  // `user.type` is satisfied by that SAME pre-debounce flash on its very first (synchronous) check,
  // before the mocked search has even been called — so it would pass even if the mock were changed
  // to return real rows (verified: mutating the mock to `entityResult` here left this test green
  // until the explicit wait for `referenceSearch` below was added). Waiting for `referenceSearch`
  // to have been called first guarantees the debounce has fired and the assertion after it is
  // checking the SETTLED result, not the transient pre-debounce placeholder.
  it('shows an empty state when nothing matches', async () => {
    vi.mocked(referenceSearch).mockResolvedValue({ kind: 'entity', rows: [], total: 0 });
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'zzz');
    await waitFor(() => expect(referenceSearch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/no matches/i)).toBeInTheDocument());
  });

  it('shows an error row when the search fails', async () => {
    vi.mocked(referenceSearch).mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'doe');
    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
  });

  it('ignores a stale response that resolves after a newer one', async () => {
    const staleResult = {
      kind: 'entity' as const,
      rows: [{ reference: 'Patient/stale', display: 'Stale Match', secondary: null }],
      total: 1,
    };
    const freshResult = {
      kind: 'entity' as const,
      rows: [{ reference: 'Patient/fresh', display: 'Fresh Match', secondary: null }],
      total: 1,
    };
    // First call (broader query) resolves slowly; second call (narrower query) resolves quickly.
    // Without the generation guard, the slow-but-first promise settles LAST and its
    // setRows(...) call clobbers the fresh rows already on screen -- so a naive
    // `waitFor(() => expect(screen.getByText('Fresh Match')).toBeInTheDocument())`
    // would pass right up until the stale promise resolves and then silently regress.
    // Asserting the stale text is absent *after* that slow promise has settled is what
    // actually falsifies the no-guard behavior.
    let resolveStale!: (v: typeof staleResult) => void;
    const stalePromise = new Promise<typeof staleResult>((resolve) => { resolveStale = resolve; });
    vi.mocked(referenceSearch)
      .mockImplementationOnce(() => stalePromise)
      .mockImplementationOnce(() => Promise.resolve(freshResult));

    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} />);

    const combobox = screen.getByRole('combobox');
    await user.type(combobox, 'do');
    await waitFor(() => expect(referenceSearch).toHaveBeenCalledTimes(1));

    await user.clear(combobox);
    await user.type(combobox, 'doe');
    await waitFor(() => expect(referenceSearch).toHaveBeenCalledTimes(2));

    // The fresh (second) response wins because it resolved first.
    await waitFor(() => expect(screen.getByText('Fresh Match')).toBeInTheDocument());

    // Now let the slow, stale (first) response settle. If the component lacks a
    // generation guard, this resolves and overwrites the rows with the stale result.
    resolveStale(staleResult);
    await waitFor(() => expect(referenceSearch).toHaveBeenCalledTimes(2));
    // Flush microtasks so the (would-be) stale setRows has a chance to apply.
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText('Fresh Match')).toBeInTheDocument();
    expect(screen.queryByText('Stale Match')).not.toBeInTheDocument();
  });

  it('sets aria-activedescendant to the keyboard-active option id', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} />);

    const combobox = screen.getByRole('combobox');
    await user.type(combobox, 'doe');
    const option = await screen.findByText('Doe Jane');

    expect(combobox).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    const optionEl = option.closest('[role="option"]') as HTMLElement;
    expect(optionEl).toHaveAttribute('id');
    expect(combobox).toHaveAttribute('aria-activedescendant', optionEl.id);
  });
});
