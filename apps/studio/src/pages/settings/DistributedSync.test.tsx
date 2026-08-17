import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    fetchSyncConfig: vi.fn(), saveSyncConfig: vi.fn(),
    fetchSyncStatus: vi.fn(), triggerSyncNow: vi.fn(), fetchSyncActivity: vi.fn() };
});
import * as api from '@/api';
import { expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';
import { DistributedSync } from './DistributedSync';

const config = {
  enabled: true, mode: 'push' as const, centralUrl: 'https://central.example.org',
  siteId: 'lab-north', oidcIssuer: 'https://auth.example.org/realms/openldr', clientId: 'lab-north',
  clientSecretSet: true, intervalMinutes: 15, signingKeySet: true, centralPublicKey: '',
};

const activity = [
  { id: 'a1', occurredAt: '2026-06-24T10:00:00Z', direction: 'push' as const, event: 'synced' as const, records: 42, error: null, metadata: null },
  { id: 'a2', occurredAt: '2026-06-24T11:00:00Z', direction: 'pull' as const, event: 'failed' as const, records: 0, error: 'upstream refused the batch', metadata: null },
];

/**
 * The activity table's first filterable column is `direction`, an enum — so the popover renders a
 * Select, not the "Enter value" input that the shared addFilterViaPopover helper types into.
 * This drives the Select instead. Radix Select only mounts its popper via keyboard in jsdom.
 */
async function addEnumFilterViaPopover(optionName: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /^filter$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /add filter/i }));
  fireEvent.keyDown(await screen.findByLabelText(/pick value/i), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
  fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
}

// Radix Tabs activate on mouseDown in jsdom (matches Marketplace.test.tsx and Facilities.test.tsx).
async function openActivityTab() {
  fireEvent.mouseDown(await screen.findByRole('tab', { name: /activity/i }), { button: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.fetchSyncConfig as any).mockResolvedValue(config);
  (api.fetchSyncStatus as any).mockResolvedValue({ push: null, pull: null, pendingPush: 0 });
  (api.fetchSyncActivity as any).mockResolvedValue(activity);
});

describe('DistributedSync activity table', () => {
  it('lists sync activity rows', async () => {
    render(<MemoryRouter><DistributedSync /></MemoryRouter>);
    await openActivityTab();
    expect(await screen.findByText('upstream refused the batch')).toBeTruthy();
  });

  it('renders the standard table toolbar on the sync activity table', async () => {
    render(<MemoryRouter><DistributedSync /></MemoryRouter>);
    await openActivityTab();
    await screen.findByText('upstream refused the batch');

    await addEnumFilterViaPopover(/push/i);
    expectStandardTableToolbar();
  });

  it('filters rows by the search box', async () => {
    render(<MemoryRouter><DistributedSync /></MemoryRouter>);
    await openActivityTab();
    await screen.findByText('upstream refused the batch');

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'refused' } });
    expect(screen.getByText('upstream refused the batch')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zzz-no-such-event' } });
    expect(screen.queryByText('upstream refused the batch')).toBeNull();
  });
});
