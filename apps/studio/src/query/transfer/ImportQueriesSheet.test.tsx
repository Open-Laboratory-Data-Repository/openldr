import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('../api', () => ({ queryApi: {
  list: vi.fn(),
  connectors: vi.fn(),
  importQueries: vi.fn(),
} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

import { toast } from 'sonner';
import { queryApi } from '../api';
import { useQueryStore } from '../store';
import { ImportQueriesSheet } from './ImportQueriesSheet';

const FILE = {
  format: 'openldr.custom-queries', version: 1, exportedAt: '2026-09-30T00:00:00.000Z',
  queries: [
    { name: 'Fresh', sql: 'select 1', params: [] },
    { name: 'Alpha', sql: 'select 2', params: [] },
  ],
};

async function chooseFile(content: unknown) {
  const file = new File([typeof content === 'string' ? content : JSON.stringify(content)], 'q.json');
  await act(async () => { fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } }); });
}
async function menuItem(testId: string) {
  const trigger = screen.getByTestId('import-sheet-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByTestId(testId);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queryApi.list).mockResolvedValue([{ id: 'q1', name: 'Alpha', connectorId: 'c', sql: 'x', params: [] }]);
  vi.mocked(queryApi.connectors).mockResolvedValue([
    { id: 'c1', name: 'Other', type: 'postgres' },
    { id: 'c2', name: 'Target Warehouse (Postgres)', type: 'postgres' },
  ]);
});

describe('ImportQueriesSheet', () => {
  it('marks each query new or exists (skip), and replace flips skip to replace', async () => {
    render(<ImportQueriesSheet open onOpenChange={() => {}} />);
    await chooseFile(FILE);
    expect(await screen.findByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
    expect(screen.getByText('exists (skip)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByText('exists (replace)')).toBeInTheDocument();
  });

  it('keeps Import disabled until a valid file is loaded and rejects a wrong file', async () => {
    render(<ImportQueriesSheet open onOpenChange={() => {}} />);
    expect(await menuItem('import-apply')).toHaveAttribute('aria-disabled', 'true');
    await chooseFile('{"nope":1}');
    expect(await screen.findByText('This is not an OpenLDR queries file.')).toBeInTheDocument();
  });

  it('imports with the default connector name and replace flag, toasts counts, refreshes the list', async () => {
    vi.mocked(queryApi.importQueries).mockResolvedValue({ results: [
      { name: 'Fresh', outcome: 'created', id: 'n1' }, { name: 'Alpha', outcome: 'skipped', id: 'q1' },
    ] });
    const before = useQueryStore.getState().savedRevision;
    const onOpenChange = vi.fn();
    render(<ImportQueriesSheet open onOpenChange={onOpenChange} />);
    await chooseFile(FILE);
    await screen.findByText('Fresh');
    await waitFor(() => expect(queryApi.connectors).toHaveBeenCalled());
    const item = await menuItem('import-apply');
    await act(async () => { fireEvent.click(item); });
    await waitFor(() => expect(queryApi.importQueries).toHaveBeenCalledWith({
      file: FILE, connectorName: 'Target Warehouse (Postgres)', replace: false,
    }));
    expect(toast.success).toHaveBeenCalledWith('1 created, 0 replaced, 1 skipped.');
    expect(useQueryStore.getState().savedRevision).toBe(before + 1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the server error on a 400 and keeps the sheet open', async () => {
    vi.mocked(queryApi.importQueries).mockRejectedValue(new Error('connector not found'));
    const onOpenChange = vi.fn();
    render(<ImportQueriesSheet open onOpenChange={onOpenChange} />);
    await chooseFile(FILE);
    await screen.findByText('Fresh');
    await waitFor(() => expect(queryApi.connectors).toHaveBeenCalled());
    const item = await menuItem('import-apply');
    await act(async () => { fireEvent.click(item); });
    expect(await screen.findByText('Import failed: connector not found')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('points at the menu before a file is chosen, and says so when the file holds no queries', async () => {
    render(<ImportQueriesSheet open onOpenChange={() => {}} />);
    expect(screen.getByText('Choose a file from the ⋯ menu to see what it holds.')).toBeInTheDocument();
    await chooseFile({ ...FILE, queries: [] });
    expect(await screen.findByText('This file holds no queries.')).toBeInTheDocument();
  });

  it('shows an error line when the saved-query list fails to load', async () => {
    vi.mocked(queryApi.list).mockRejectedValue(new Error('boom'));
    render(<ImportQueriesSheet open onOpenChange={() => {}} />);
    expect(await screen.findByText('Could not load existing queries or connectors: boom')).toBeInTheDocument();
  });

  it('keeps the load-failure line after a file is chosen', async () => {
    vi.mocked(queryApi.list).mockRejectedValue(new Error('boom'));
    render(<ImportQueriesSheet open onOpenChange={() => {}} />);
    await screen.findByText('Could not load existing queries or connectors: boom');
    await chooseFile(FILE);
    expect(await screen.findByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('Could not load existing queries or connectors: boom')).toBeInTheDocument();
  });

  it('leaves the connector empty and Import disabled when no connector has the default name', async () => {
    vi.mocked(queryApi.connectors).mockResolvedValue([{ id: 'c1', name: 'Other', type: 'postgres' }]);
    render(<ImportQueriesSheet open onOpenChange={() => {}} />);
    await chooseFile(FILE);
    await screen.findByText('Fresh');
    expect(await screen.findByText('Choose the connector these queries will run on.')).toBeInTheDocument();
    expect(await menuItem('import-apply')).toHaveAttribute('aria-disabled', 'true');
  });
});
