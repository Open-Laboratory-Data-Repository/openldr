import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('../api', () => ({ queryApi: {
  list: vi.fn(),
  exportQueries: vi.fn(),
} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

import { toast } from 'sonner';
import { queryApi } from '../api';
import { ExportQueriesSheet } from './ExportQueriesSheet';

const SAVED = [
  { id: 'q1', name: 'Alpha', connectorId: 'c', sql: 'select 1', params: [] },
  { id: 'q2', name: 'Beta', connectorId: 'c', sql: 'select 2', params: [] },
];

// Radix menus open on pointerDown in jsdom, with Enter as the fallback.
async function menuItem(testId: string) {
  const trigger = screen.getByTestId('export-sheet-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByTestId(testId);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queryApi.list).mockResolvedValue(SAVED);
  vi.mocked(queryApi.exportQueries).mockResolvedValue({
    format: 'openldr.custom-queries', version: 1, exportedAt: '2026-09-30T00:00:00.000Z', queries: [],
  });
});

describe('ExportQueriesSheet', () => {
  it('lists saved queries and keeps Download disabled until one is checked', async () => {
    render(<ExportQueriesSheet open onOpenChange={() => {}} />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(await menuItem('export-download')).toHaveAttribute('aria-disabled', 'true');
  });

  it('downloads the checked queries as openldr-queries-<date>.json', async () => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    let downloadName = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });
    render(<ExportQueriesSheet open onOpenChange={() => {}} />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
    const item = await menuItem('export-download');
    await act(async () => { fireEvent.click(item); });
    await waitFor(() => expect(queryApi.exportQueries).toHaveBeenCalledWith(['q2']));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(downloadName).toMatch(/^openldr-queries-\d{4}-\d{2}-\d{2}\.json$/);
    click.mockRestore();
  });

  it('select all checks every query', async () => {
    render(<ExportQueriesSheet open onOpenChange={() => {}} />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByRole('checkbox', { name: 'Alpha' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Beta' })).toBeChecked();
  });

  it('says the list could not be loaded, not that the export failed', async () => {
    vi.mocked(queryApi.list).mockRejectedValue(new Error('boom'));
    render(<ExportQueriesSheet open onOpenChange={() => {}} />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not load existing queries or connectors: boom'));
  });
});
