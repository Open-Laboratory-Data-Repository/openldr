import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReferencePicker } from './ReferencePicker';

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
    // Explicit timeout: the component debounces search by 200ms (ReferencePicker.tsx:104),
    // which restarts on every keystroke from user.type. Under a full-workspace `turbo` run
    // the debounce + mocked search + re-render can exceed testing-library's 1000ms findBy*
    // default, so give these post-type assertions real headroom instead of relying on it.
    await user.click(await screen.findByText('Doe Jane', {}, { timeout: 5000 }));
    expect(onChange).toHaveBeenCalledWith({ reference: 'Patient/p1', display: 'Doe Jane' });
  });

  it('selects with the keyboard', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={onChange} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await screen.findByText('Doe Jane', {}, { timeout: 5000 });
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

  it('shows an empty state when nothing matches', async () => {
    vi.mocked(referenceSearch).mockResolvedValue({ kind: 'entity', rows: [], total: 0 });
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(await screen.findByText(/no matches/i, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows an error row when the search fails', async () => {
    vi.mocked(referenceSearch).mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'doe');
    expect(await screen.findByText(/boom/i, {}, { timeout: 5000 })).toBeInTheDocument();
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
    const option = await screen.findByText('Doe Jane', {}, { timeout: 5000 });

    expect(combobox).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    const optionEl = option.closest('[role="option"]') as HTMLElement;
    expect(optionEl).toHaveAttribute('id');
    expect(combobox).toHaveAttribute('aria-activedescendant', optionEl.id);
  });
});
