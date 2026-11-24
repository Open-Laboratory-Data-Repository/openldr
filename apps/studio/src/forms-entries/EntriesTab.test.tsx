import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as api from '@/api';
import '@/i18n';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { EntriesTab } from './EntriesTab';

const caps = { void: true };
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u-1' }, hasCapability: (c: string) => c === 'forms.void_entries' && caps.void }),
}));

const entry = (over: Partial<api.FormEntry>): api.FormEntry => ({
  id: 'e-1', formId: 'form-1', facilityId: 'f-1', facilityCode: 'FAC-1', facilityName: 'Hill Clinic',
  entryKey: 'CS-0001', summary: [{ label: 'Test', value: 'HIV VL' }, { label: 'Patient', value: 'Amina J.' }],
  enteredBy: 'u-1', enteredByName: 'proofclerk', enteredAt: '2026-11-22T14:20:00.000Z',
  status: 'active', statusBy: null, statusAt: null, statusReason: null, statusByName: null, ...over,
});

const rows = [
  entry({ id: 'e-3', entryKey: 'CS-0003' }),
  entry({ id: 'e-2', entryKey: 'CS-0002', status: 'incomplete' }),
  entry({ id: 'e-1', entryKey: 'CS-0001', status: 'entered-in-error', enteredBy: 'u-2', enteredByName: 'aisha' }),
];

function openRowMenu(name: string) {
  const trigger = screen.getByRole('button', { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('EntriesTab', () => {
  beforeEach(() => {
    caps.void = true;
    vi.mocked(toast.error).mockClear();
    vi.spyOn(api, 'listFormEntries').mockResolvedValue({ entries: rows, total: 3 });
  });

  it('shows the spinner, not the stripes, while the list loads', () => {
    vi.spyOn(api, 'listFormEntries').mockReturnValue(new Promise(() => {}));
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('No entries yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the empty state and no table when there are no entries', async () => {
    vi.spyOn(api, 'listFormEntries').mockResolvedValue({ entries: [], total: 0 });
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    expect(await screen.findByText('No entries yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a failed load as one toast and the could-not-load text, not the stripes or a red box', async () => {
    vi.spyOn(api, 'listFormEntries').mockRejectedValue(new Error('list form entries failed: 403'));
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    expect(await screen.findByText('Could not load this list. Reload the page to try again.')).toBeInTheDocument();
    expect(screen.queryByText('No entries yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('list form entries failed: 403')).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('list form entries failed: 403');

    // A reload that fails the same way does not toast again.
    openRowMenu('Entries actions');
    fireEvent.click(await screen.findByText('Refresh'));
    await waitFor(() => expect(api.listFormEntries).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Could not load this list. Reload the page to try again.')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('lists the entries, strikes a voided one through and marks an incomplete one', async () => {
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    expect(await screen.findByText('CS-0003')).toBeInTheDocument();
    const voided = screen.getByText('CS-0001').closest('tr')!;
    expect(within(voided).getByText('Entered in error')).toBeInTheDocument();
    expect(within(voided).getByText('CS-0001').closest('td')).toHaveClass('line-through');
    const incomplete = screen.getByText('CS-0002').closest('tr')!;
    expect(within(incomplete).getByText('Not fully saved')).toBeInTheDocument();
    // Each summary is drawn twice: wrapping for a phone, truncated from sm up. CSS shows one.
    expect(screen.getAllByText('HIV VL, Amina J.')).toHaveLength(6);
    expect(api.listFormEntries).toHaveBeenCalledWith('form-1', expect.objectContaining({ limit: 25, offset: 0 }));
  });

  it('says a yes/no summary answer in the reader\'s language', async () => {
    vi.spyOn(api, 'listFormEntries').mockResolvedValue({ entries: [
      entry({ id: 'e-9', entryKey: 'CS-0009', summary: [{ label: 'Pregnant', value: true }, { label: 'Fasting', value: false }] }),
    ], total: 1 });
    const { default: i18n } = await import('@/i18n');
    await i18n.changeLanguage('fr');
    try {
      render(<EntriesTab formId="form-1" refreshKey={0} />);
      await screen.findByText('CS-0009');
      expect(screen.getAllByText('Oui, Non').length).toBeGreaterThan(0);
      expect(screen.queryByText(/true|false/)).not.toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('shows an entry saved before as the text it holds', async () => {
    // An entry saved before yes/no answers stayed booleans holds the text "true". It is not migrated.
    vi.spyOn(api, 'listFormEntries').mockResolvedValue({ entries: [
      entry({ id: 'e-8', entryKey: 'CS-0008', summary: [{ label: 'Pregnant', value: 'true' }] }),
    ], total: 1 });
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    await screen.findByText('CS-0008');
    expect(screen.getAllByText('true').length).toBeGreaterThan(0);
  });

  it('fits a phone: the date moves under the summary, and the Entered and By columns hide below sm', async () => {
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    await screen.findByText('CS-0003');
    const row = screen.getByText('CS-0003').closest('tr')!;
    const cells = row.querySelectorAll('td');
    const dateLine = within(row).getByTestId('entry-date-line');
    expect(cells[1]).toContainElement(dateLine);
    expect(dateLine).toHaveClass('sm:hidden');
    expect(dateLine.textContent).toBe(cells[2]!.textContent);
    expect(cells[2]).toHaveClass('hidden', 'sm:table-cell');
    expect(cells[3]).toHaveClass('hidden', 'sm:table-cell');
    expect(cells[4]).toHaveClass('w-10');
    expect(cells[4]).not.toHaveClass('hidden');
    const heads = screen.getAllByRole('columnheader');
    expect(heads[2]).toHaveClass('hidden', 'sm:table-cell');
    expect(heads[2]).toHaveTextContent('Entered');
  });

  it('searches by requisition number', async () => {
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    await screen.findByText('CS-0003');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search requisition' }), { target: { value: 'CS-00' } });
    await waitFor(() => expect(api.listFormEntries).toHaveBeenLastCalledWith('form-1', expect.objectContaining({ search: 'CS-00', offset: 0 })));
  });

  it('waits for typing to pause before it asks the server, then asks once', async () => {
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    await screen.findByText('CS-0003');
    const box = screen.getByRole('searchbox', { name: 'Search requisition' });
    for (const text of ['C', 'CS', 'CS-', 'CS-0']) fireEvent.change(box, { target: { value: text } });
    // Straight after the keys, nothing new has been asked.
    expect(api.listFormEntries).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.listFormEntries).toHaveBeenCalledTimes(2));
    expect(api.listFormEntries).toHaveBeenLastCalledWith('form-1', expect.objectContaining({ search: 'CS-0' }));
    await new Promise((r) => setTimeout(r, 400));
    expect(api.listFormEntries).toHaveBeenCalledTimes(2);
  });

  it('offers Mark as entered in error only with the capability, and never on a voided row', async () => {
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    await screen.findByText('CS-0003');
    openRowMenu('Actions for CS-0003');
    expect(await screen.findByRole('menuitem', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Mark as entered in error' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    openRowMenu('Actions for CS-0001');
    expect(await screen.findByRole('menuitem', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark as entered in error' })).not.toBeInTheDocument();
  });

  it('hides Mark as entered in error without the capability', async () => {
    caps.void = false;
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    await screen.findByText('CS-0003');
    openRowMenu('Actions for CS-0003');
    expect(await screen.findByRole('menuitem', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark as entered in error' })).not.toBeInTheDocument();
  });

  it('reads the list again when the page says a save landed', async () => {
    const { rerender } = render(<EntriesTab formId="form-1" refreshKey={0} />);
    await screen.findByText('CS-0003');
    expect(api.listFormEntries).toHaveBeenCalledTimes(1);
    rerender(<EntriesTab formId="form-1" refreshKey={1} />);
    await waitFor(() => expect(api.listFormEntries).toHaveBeenCalledTimes(2));
  });
});
