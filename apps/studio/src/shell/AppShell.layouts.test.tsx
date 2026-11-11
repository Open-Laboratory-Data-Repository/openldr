import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';

let caps: string[] | 'all' = 'all';
// The token's roles are deliberately wrong: role defaults must follow myRoles from the server.
const mockUser = { id: 'u1', username: 'amina', roles: ['from_token'] };
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: mockUser, loading: false, signOut: vi.fn(), authEnforced: true,
    hasCapability: (c: string) => caps === 'all' || caps.includes(c),
  }),
}));
vi.mock('@/api', async (orig) => ({
  ...(await orig<typeof import('@/api')>()),
  getMyPreferences: vi.fn(), saveMyPreferences: vi.fn(), listLayouts: vi.fn(), listPluginUis: vi.fn().mockResolvedValue([]),
}));
import * as api from '@/api';
import { AppShell } from './AppShell';
import { StartPageGate } from './UserPreferencesSync';
import { loadUserPreferences, resetUserPreferencesForTest } from './userPreferences';
import { loadLayouts, resetLayoutsForTest } from './layouts';

const bench = { id: 'bench', name: 'Bench', startPage: '/forms', pages: ['/forms', '/patients', '/query'], roles: ['tech'] };
const data = { id: 'data', name: 'Data', startPage: null, pages: ['/reports'], roles: [] };

async function load(prefs: api.UserPreferences) {
  vi.mocked(api.getMyPreferences).mockResolvedValue(prefs);
  vi.mocked(api.listLayouts).mockResolvedValue({ layouts: [bench, data], roleOrder: ['tech'], myRoles: ['tech'] });
  await act(async () => { await loadUserPreferences(); await loadLayouts(); });
}
const shell = () => render(<MemoryRouter><AppShell title="T"><div /></AppShell></MemoryRouter>);
const sidebar = () => screen.getAllByRole('link').map((a) => a.getAttribute('href'));

beforeEach(() => {
  vi.clearAllMocks();
  resetUserPreferencesForTest();
  resetLayoutsForTest();
  caps = 'all';
  vi.mocked(api.saveMyPreferences).mockResolvedValue({});
});

async function openUserSub(testId: string) {
  const trigger = screen.getByText('amina');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByTestId(testId)) fireEvent.keyDown(trigger, { key: 'Enter' });
  const sub = await screen.findByTestId(testId);
  fireEvent.keyDown(sub, { key: 'Enter' });
  return sub;
}

describe('sidebar under a layout', () => {
  it("shows only the role default's pages, plus Docs", async () => {
    await load({});
    shell();
    expect(sidebar()).toEqual(['/query', '/patients', '/forms', '/docs']); // the usual sidebar order
  });

  it('never shows a page the capabilities hide, even if the layout lists it', async () => {
    caps = ['terminology.view'];
    await load({});
    shell();
    expect(sidebar()).not.toContain('/query');
    expect(sidebar()).not.toContain('/patients');
    expect(sidebar()).toContain('/forms');
  });

  it("the user's pick wins, and full shows the whole sidebar", async () => {
    await load({ layout: 'data' });
    const a = shell();
    expect(sidebar()).toEqual(['/reports', '/docs']);
    a.unmount();
    await load({ layout: 'full' });
    shell();
    expect(sidebar()).toContain('/users');
    expect(sidebar()).toContain('/reports');
  });

  it('the Start page submenu offers only the pages the layout shows', async () => {
    await load({});
    shell();
    await openUserSub('start-page-menu');
    expect(await screen.findByTestId('start-page-/forms')).toBeTruthy();
    expect(screen.queryByTestId('start-page-/reports')).toBeNull();
  });

  it('the Layout submenu saves a pick, full, or a return to the role default', async () => {
    await load({ layout: 'data' });
    shell();
    await openUserSub('layout-menu');
    fireEvent.click(await screen.findByTestId('layout-pick-bench'));
    await waitFor(() => expect(api.saveMyPreferences).toHaveBeenCalledWith({ layout: 'bench' }));
    await openUserSub('layout-menu');
    fireEvent.click(await screen.findByTestId('layout-pick-full'));
    await waitFor(() => expect(api.saveMyPreferences).toHaveBeenCalledWith({ layout: 'full' }));
    await openUserSub('layout-menu');
    expect((await screen.findByTestId('layout-pick-default')).textContent).toMatch(/Bench/);
    fireEvent.click(screen.getByTestId('layout-pick-default'));
    await waitFor(() => expect(api.saveMyPreferences).toHaveBeenCalledWith({ layout: null }));
  });

  // Picking Dashboard used to clear the saved start page, and the layout's start page then took
  // over again: the user could never choose the Dashboard. Under a layout with a start page it is
  // saved as '/'. With no layout start page it still clears, as before.
  it("picking Dashboard sticks even when the layout has its own start page", async () => {
    vi.mocked(api.getMyPreferences).mockResolvedValue({});
    vi.mocked(api.listLayouts).mockResolvedValue({
      layouts: [{ id: 'lab', name: 'Lab', startPage: '/forms', pages: ['/', '/forms'], roles: ['tech'] }], roleOrder: ['tech'], myRoles: ['tech'],
    });
    await act(async () => { await loadUserPreferences(); await loadLayouts(); });
    shell();
    await openUserSub('start-page-menu');
    fireEvent.click(await screen.findByTestId('start-page-/'));
    await waitFor(() => expect(api.saveMyPreferences).toHaveBeenCalledWith({ startPage: '/' }));
  });

  it('has no Layout submenu when no layouts exist', async () => {
    vi.mocked(api.getMyPreferences).mockResolvedValue({});
    vi.mocked(api.listLayouts).mockResolvedValue({ layouts: [], roleOrder: [] });
    await act(async () => { await loadUserPreferences(); await loadLayouts(); });
    shell();
    await openUserSub('start-page-menu');
    expect(screen.queryByTestId('layout-menu')).toBeNull();
  });
});

describe('first page under a layout', () => {
  const gate = () => render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<StartPageGate><div data-testid="dashboard" /></StartPageGate>} />
        <Route path="/forms" element={<div data-testid="forms" />} />
        <Route path="/reports" element={<div data-testid="reports" />} />
      </Routes>
    </MemoryRouter>,
  );

  it("opens the layout's start page when the user saved none", async () => {
    await load({});
    gate();
    expect(await screen.findByTestId('forms')).toBeTruthy();
  });

  it("the user's own start page wins, if the layout shows it", async () => {
    await load({ layout: 'data', startPage: '/reports' });
    gate();
    expect(await screen.findByTestId('reports')).toBeTruthy();
  });

  it('shows the Dashboard when the start page is not in the layout', async () => {
    await load({ startPage: '/reports' });
    gate();
    expect(await screen.findByTestId('dashboard')).toBeTruthy();
  });
});
