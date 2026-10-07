import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TermsTable } from './TermsTable';
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

describe('TermsTable', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders terms from searchTerms', async () => {
    vi.spyOn(api, 'searchTerms').mockResolvedValue({
      rows: [term('AMP', 'Ampicillin')],
      total: 1,
    } as never);
    render(<TermsTable systemId="sys1" onOpenTerm={() => {}} />);
    await waitFor(() => expect(screen.getByText('Ampicillin')).toBeInTheDocument());
    expect(screen.getByText('AMP')).toBeInTheDocument();
  });

  it('accepts structured terminology source files for imports', async () => {
    const spy = vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [], total: 0 });
    render(<TermsTable systemId="sys1" onOpenTerm={() => {}} />);

    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', expect.stringContaining('.txt'));
    expect(input).toHaveAttribute('accept', expect.stringContaining('.rrf'));
    expect(input).toHaveAttribute('accept', expect.stringContaining('.jsonl'));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it('typing in search refetches with q', async () => {
    const spy = vi
      .spyOn(api, 'searchTerms')
      .mockResolvedValue({ rows: [], total: 0 } as never);
    render(<TermsTable systemId="sys1" onOpenTerm={() => {}} />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/search terms/i), {
      target: { value: 'cip' },
    });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        'sys1',
        expect.objectContaining({ q: 'cip' }),
      ),
    );
  });

  it('puts import, template and new term in one actions menu, with no standalone buttons', async () => {
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [], total: 0 });
    const onOpenTerm = vi.fn();
    render(<TermsTable systemId="sys1" onOpenTerm={onOpenTerm} />);

    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new term/i })).not.toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: 'Term actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /new term/i })) fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(await screen.findByRole('menuitem', { name: /import terms/i })).toBeInTheDocument();
    const template = screen.getByRole('menuitem', { name: /download template/i });
    expect(template).toHaveAttribute('download');
    fireEvent.click(screen.getByRole('menuitem', { name: /new term/i }));
    expect(onOpenTerm).toHaveBeenCalledWith(null);
  });
});
