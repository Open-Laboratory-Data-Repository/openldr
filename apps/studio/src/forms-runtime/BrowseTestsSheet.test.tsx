import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api', () => ({ browseTestCatalog: vi.fn() }));
import { browseTestCatalog } from '@/api';
import { BrowseTestsSheet } from './BrowseTestsSheet';

// The system arrives in the server's answer, so the sheet names none.
const CATALOG = 'urn:openldr:codesystem:test-catalog';
const rows = [
  { code: 'HIVVL', display: 'HIV viral load', category: 'MOL', enabled: true },
  { code: 'CD4', display: 'CD4 count', category: 'HAEM', enabled: false },
];

beforeEach(() => {
  vi.mocked(browseTestCatalog).mockReset();
  vi.mocked(browseTestCatalog).mockResolvedValue({ rows, total: 2, system: CATALOG });
});

describe('BrowseTestsSheet', () => {
  it('lists every test, with its code and category', async () => {
    render(<BrowseTestsSheet onPick={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('HIV viral load')).toBeInTheDocument();
    expect(screen.getByText('CD4 count')).toBeInTheDocument();
    expect(screen.getByText('MOL')).toBeInTheDocument();
  });

  it('marks a test this lab does not run, and refuses to pick it', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<BrowseTestsSheet onPick={onPick} onClose={() => {}} />);
    await screen.findByText('CD4 count');
    expect(screen.getByText(/not offered/i)).toBeInTheDocument();
    await user.click(screen.getByText('CD4 count'));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('picks an offered test as a coding, and closes', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<BrowseTestsSheet onPick={onPick} onClose={onClose} />);
    await user.click(await screen.findByText('HIV viral load'));
    expect(onPick).toHaveBeenCalledWith({ system: CATALOG, code: 'HIVVL', display: 'HIV viral load' });
    expect(onClose).toHaveBeenCalled();
  });

  it('asks the server again when the search changes', async () => {
    const user = userEvent.setup();
    render(<BrowseTestsSheet onPick={() => {}} onClose={() => {}} />);
    await screen.findByText('HIV viral load');
    await user.type(screen.getByRole('searchbox'), 'vir');
    await waitFor(() => expect(browseTestCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'vir' })));
  });

  it('filters by a category the rows carry', async () => {
    const user = userEvent.setup();
    render(<BrowseTestsSheet onPick={() => {}} onClose={() => {}} />);
    await screen.findByText('HIV viral load');
    await user.click(screen.getByLabelText(/category/i));
    // By role: the row still shows MOL too, so text alone matches two elements.
    await user.click(await screen.findByRole('option', { name: 'MOL' }));
    await waitFor(() => expect(browseTestCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'MOL' })));
  });

  it('shows the empty state when this install holds no tests', async () => {
    vi.mocked(browseTestCatalog).mockResolvedValue({ rows: [], total: 0, system: CATALOG });
    render(<BrowseTestsSheet onPick={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/no tests are loaded/i)).toBeInTheDocument();
  });

  it('takes its copy from the caller, and falls back to English', async () => {
    vi.mocked(browseTestCatalog).mockResolvedValue({ rows: [], total: 0, system: CATALOG });
    render(<BrowseTestsSheet onPick={() => {}} onClose={() => {}} copy={{ empty: 'Aucun examen chargé' }} />);
    expect(await screen.findByText('Aucun examen chargé')).toBeInTheDocument();
  });
});
