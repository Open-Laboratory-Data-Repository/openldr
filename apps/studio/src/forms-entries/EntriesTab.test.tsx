import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as api from '@/api';
import '@/i18n';
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

  it('lists the entries, strikes a voided one through and marks an incomplete one', async () => {
    render(<EntriesTab formId="form-1" refreshKey={0} />);
    expect(await screen.findByText('CS-0003')).toBeInTheDocument();
    const voided = screen.getByText('CS-0001').closest('tr')!;
    expect(within(voided).getByText('Entered in error')).toBeInTheDocument();
    expect(within(voided).getByText('CS-0001').closest('td')).toHaveClass('line-through');
    const incomplete = screen.getByText('CS-0002').closest('tr')!;
    expect(within(incomplete).getByText('Not fully saved')).toBeInTheDocument();
    expect(screen.getAllByText('HIV VL, Amina J.')).toHaveLength(3);
    expect(api.listFormEntries).toHaveBeenCalledWith('form-1', expect.objectContaining({ limit: 25, offset: 0 }));
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
