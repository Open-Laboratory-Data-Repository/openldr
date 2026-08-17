import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';

vi.mock('@/api', () => ({
  fetchActivity: vi.fn(async () => [
    { correlationId: 'A', workflowId: 'w', source: 'webhook', startedAt: '2026-07-03T10:00:00Z', currentStage: 'persisted', status: 'complete' },
  ]),
  fetchLifecycle: vi.fn(async () => ({
    correlationId: 'A',
    status: 'complete',
    stages: [
      { stage: 'received', status: 'ok', at: '2026-07-03T10:00:00Z', detail: 'webhook' },
      { stage: 'persisted', status: 'ok', at: '2026-07-03T10:00:05Z', detail: '1 × ServiceRequest' },
    ],
    runIds: ['run-1'],
  })),
  listPluginUis: vi.fn(async () => []),
  listNotifications: vi.fn(async () => ({ notifications: [], unreadCount: 0, total: 0 })),
  markNotificationsRead: vi.fn(async () => undefined),
  markAllNotificationsRead: vi.fn(async () => undefined),
}));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasCapability: () => true }),
}));

import { Activity } from './Activity';

describe('Activity page', () => {
  it('lists recent payloads with their stage', async () => {
    render(<MemoryRouter><Activity /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Persisted')).toBeInTheDocument());
  });

  it('opens the lifecycle detail when a row is clicked', async () => {
    const api = await import('@/api');
    render(<MemoryRouter><Activity /></MemoryRouter>);
    fireEvent.click(await screen.findByText('webhook'));
    await waitFor(() => expect(api.fetchLifecycle).toHaveBeenCalledWith('A'));
    expect(await screen.findByText('1 × ServiceRequest')).toBeInTheDocument();
  });

  it('renders the standard table toolbar with the chips row', async () => {
    render(<MemoryRouter><Activity /></MemoryRouter>);
    await screen.findByRole('table');
    await waitFor(() => expect(screen.getByText('webhook')).toBeInTheDocument());

    await addFilterViaPopover('A');
    expectStandardTableToolbar();
  });

  it('filters rows by the search box', async () => {
    render(<MemoryRouter><Activity /></MemoryRouter>);
    await screen.findByText('webhook');

    fireEvent.change(screen.getByPlaceholderText(/search payloads/i), { target: { value: 'zzz-no-such-payload' } });
    expect(screen.queryByText('webhook')).not.toBeInTheDocument();
  });

  // Regression for the search-vs-popover-filter fold bug: applyTableState folds rules flat,
  // left-to-right (applyTableState.ts:80-92), so appending a search rule to an active popover
  // filter list would turn `A AND B OR C` into `(A AND B) OR C` — a row matching only the search
  // term would leak back in regardless of the popover filter.
  it('excludes a row that matches search but fails the active popover filter', async () => {
    const api = await import('@/api');
    // addFilterViaPopover always targets the first filterable column (payload/correlationId)
    // with that type's first valid operator, which for 'text' is 'eq' (types.ts validOperators)
    // — so the popover filter here is an EXACT match: correlationId eq 'keep-me'.
    // Both rows' source contains 'hook', so the search term below matches both — only the
    // popover filter (correlationId eq 'keep-me') distinguishes which one survives.
    vi.mocked(api.fetchActivity).mockResolvedValueOnce([
      { correlationId: 'keep-me', workflowId: 'w', source: 'webhook', startedAt: '2026-07-03T10:00:00Z', currentStage: 'persisted', status: 'complete' },
      { correlationId: 'drop-me', workflowId: 'w', source: 'drophook', startedAt: '2026-07-03T10:00:00Z', currentStage: 'received', status: 'stuck' },
    ]);
    render(<MemoryRouter><Activity /></MemoryRouter>);
    await screen.findByText('keep-me');

    await addFilterViaPopover('keep-me');
    const table = screen.getByRole('table');
    expect(await within(table).findByText('keep-me')).toBeInTheDocument();
    expect(within(table).queryByText('drop-me')).not.toBeInTheDocument();

    // Search term 'hook' matches BOTH rows' source field, but drop-me's correlationId does not
    // equal the popover filter's value. It must stay excluded.
    fireEvent.change(screen.getByPlaceholderText(/search payloads/i), { target: { value: 'hook' } });
    expect(await within(table).findByText('keep-me')).toBeInTheDocument();
    expect(within(table).queryByText('drop-me')).not.toBeInTheDocument();
  });
});
