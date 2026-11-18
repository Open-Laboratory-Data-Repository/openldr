import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The dashboard menu's Share item: shown to the owner or an admin (roles part 2).
const auth = vi.hoisted(() => ({ user: { id: 'u-owner', username: 'o', displayName: null, roles: [] as string[] }, caps: [] as string[] }));
vi.mock('../auth/AuthProvider', async (orig) => ({
  ...(await orig<typeof import('../auth/AuthProvider')>()),
  useAuth: () => ({ user: auth.user, loading: false, hasCapability: (c: string) => auth.caps.includes(c), signOut: () => {}, authEnforced: true, authMode: 'oidc' }),
}));

import { DashboardPage } from './DashboardPage';
import { useDashboardStore } from './store';

beforeEach(() => useDashboardStore.setState({ current: null, editing: false, dirty: false }));
afterEach(() => vi.restoreAllMocks());

function serve() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
    if (String(url) === '/api/dashboards') return Promise.resolve(new Response(JSON.stringify([{ id: 'd1', ownerId: 'u-owner', name: 'District', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: false }]), { status: 200 }));
    if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
    return Promise.resolve(new Response('[]', { status: 200 }));
  });
}

async function menuItems(): Promise<string[]> {
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('District')).toBeTruthy());
  const trigger = screen.getByRole('button', { name: 'Dashboard menu' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.getAllByRole('menuitem').map((m) => m.textContent ?? '');
}

describe('Share in the dashboard menu', () => {
  it('shows Share to the owner', async () => {
    auth.user = { id: 'u-owner', username: 'o', displayName: null, roles: [] };
    auth.caps = ['dashboards.view'];
    serve();
    expect(await menuItems()).toContain('Share');
  });

  it('shows Share to an admin who does not own it', async () => {
    auth.user = { id: 'u-admin', username: 'a', displayName: null, roles: [] };
    auth.caps = ['dashboards.view', 'roles.manage'];
    serve();
    expect(await menuItems()).toContain('Share');
  });

  it('hides Share from anyone else', async () => {
    auth.user = { id: 'u-viewer', username: 'v', displayName: null, roles: [] };
    auth.caps = ['dashboards.view', 'dashboards.edit'];
    serve();
    expect(await menuItems()).not.toContain('Share');
  });

  it('offers a viewer no Edit, Rename, New dashboard or Import, so their widgets keep the saved route (review DS2)', async () => {
    auth.user = { id: 'u-viewer', username: 'v', displayName: null, roles: [] };
    auth.caps = ['dashboards.view'];
    serve();
    const items = await menuItems();
    for (const hidden of ['Edit', 'Rename', 'New dashboard', 'Import']) expect(items, hidden).not.toContain(hidden);
    expect(items).toContain('Export');
  });

  it('offers an editor Edit and Rename, and a creator New dashboard and Import', async () => {
    auth.user = { id: 'u-editor', username: 'e', displayName: null, roles: [] };
    auth.caps = ['dashboards.view', 'dashboards.edit', 'dashboards.create'];
    serve();
    const items = await menuItems();
    for (const shown of ['Edit', 'Rename', 'New dashboard', 'Import']) expect(items, shown).toContain(shown);
  });
});
