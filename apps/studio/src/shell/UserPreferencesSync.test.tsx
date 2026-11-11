import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';

let caps: string[] | 'all' = 'all';
let mockUser: { id: string; username: string } | null = { id: 'u1', username: 'amina' };
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: mockUser, loading: false, signOut: vi.fn(), authEnforced: true,
    hasCapability: (c: string) => caps === 'all' || caps.includes(c),
  }),
}));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getMyPreferences: vi.fn(), saveMyPreferences: vi.fn(), listPluginUis: vi.fn().mockResolvedValue([]) };
});
import * as api from '@/api';
import { ThemeProvider } from './ThemeProvider';
import { useTheme } from './useTheme';
import { useSidebar } from './useSidebar';
import { StartPageGate, UserPreferencesSync } from './UserPreferencesSync';
import { AppShell } from './AppShell';
import { loadUserPreferences } from './userPreferences';
import { noteEntryPath, resetUserPreferencesForTest, startPageUsed } from './userPreferences';

beforeEach(() => {
  vi.clearAllMocks();
  resetUserPreferencesForTest();
  localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'dark');
  caps = 'all';
  mockUser = { id: 'u1', username: 'amina' };
  (api.saveMyPreferences as any).mockResolvedValue({});
});

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return <button type="button" data-testid="toggle" onClick={toggle}>{theme}</button>;
}

function app(initial = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initial]}>
        <UserPreferencesSync />
        <ThemeToggle />
        <Routes>
          <Route path="/" element={<StartPageGate><div data-testid="dashboard">dashboard</div></StartPageGate>} />
          <Route path="/reports" element={<div data-testid="reports">reports <Link to="/">home</Link></div>} />
          <Route path="/query" element={<div data-testid="query">query <Link to="/">home</Link></div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('first page', () => {
  it('opens the saved page once, and the Dashboard link still works after that', async () => {
    (api.getMyPreferences as any).mockResolvedValue({ startPage: '/reports' });
    app('/');
    expect(await screen.findByTestId('reports')).toBeTruthy();
    fireEvent.click(screen.getByText('home'));
    expect(await screen.findByTestId('dashboard')).toBeTruthy();
  });

  it('shows the Dashboard when nothing is saved', async () => {
    (api.getMyPreferences as any).mockResolvedValue({});
    app('/');
    expect(await screen.findByTestId('dashboard')).toBeTruthy();
  });

  it('shows the Dashboard when the saved page is not one this user can open', async () => {
    caps = ['dashboards.view'];
    (api.getMyPreferences as any).mockResolvedValue({ startPage: '/reports' });
    app('/');
    expect(await screen.findByTestId('dashboard')).toBeTruthy();
    expect(screen.queryByTestId('reports')).toBeNull();
  });

  it('shows the Dashboard when the preferences cannot be read', async () => {
    (api.getMyPreferences as any).mockRejectedValue(new Error('offline'));
    app('/');
    expect(await screen.findByTestId('dashboard')).toBeTruthy();
  });

  it('does not redirect after a deep link', async () => {
    (api.getMyPreferences as any).mockResolvedValue({ startPage: '/reports' });
    app('/query');
    await screen.findByTestId('query');
    await waitFor(() => expect(api.getMyPreferences).toHaveBeenCalled());
    expect(startPageUsed()).toBe(true);
    fireEvent.click(screen.getByText('home'));
    expect(await screen.findByTestId('dashboard')).toBeTruthy();
  });

  it('passes straight through when no user is signed in', () => {
    mockUser = null;
    app('/');
    expect(screen.getByTestId('dashboard')).toBeTruthy();
    expect(api.getMyPreferences).not.toHaveBeenCalled();
  });
});

describe('theme follows the user', () => {
  it('applies the saved theme over the one this browser had', async () => {
    (api.getMyPreferences as any).mockResolvedValue({ theme: 'light' });
    app('/');
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
    expect(api.saveMyPreferences).not.toHaveBeenCalled();
  });

  it('saves a theme change made after loading', async () => {
    (api.getMyPreferences as any).mockResolvedValue({ theme: 'dark' });
    app('/');
    await screen.findByTestId('dashboard');
    fireEvent.click(screen.getByTestId('toggle'));
    await waitFor(() => expect(api.saveMyPreferences).toHaveBeenCalledWith({ theme: 'light' }));
  });

  it("saves this browser's theme when the user has none saved yet", async () => {
    (api.getMyPreferences as any).mockResolvedValue({});
    app('/');
    await waitFor(() => expect(api.saveMyPreferences).toHaveBeenCalledWith({ theme: 'dark' }));
  });
});

describe('sidebar follows the user', () => {
  it('uses the saved state over this browser, and saves a toggle', async () => {
    (api.getMyPreferences as any).mockResolvedValue({ sidebarCollapsed: true, theme: 'dark' });
    app('/');
    await screen.findByTestId('dashboard');
    const { result } = renderHook(() => useSidebar());
    expect(result.current[0]).toBe(true);
    act(() => { result.current[1](); });
    expect(result.current[0]).toBe(false);
    await waitFor(() => expect(api.saveMyPreferences).toHaveBeenCalledWith({ sidebarCollapsed: false }));
    expect(localStorage.getItem('openldr-sidebar-collapsed')).toBe('false');
  });

  it('still works from this browser alone before anything loads', () => {
    noteEntryPath('/');
    const { result } = renderHook(() => useSidebar());
    expect(result.current[0]).toBe(false);
    act(() => { result.current[1](); });
    expect(result.current[0]).toBe(true);
    expect(api.saveMyPreferences).not.toHaveBeenCalled();
  });
});

describe('start page menu', () => {
  async function openStartPageMenu() {
    render(<MemoryRouter><AppShell title="Dashboard"><div>content</div></AppShell></MemoryRouter>);
    const trigger = screen.getByText('amina');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByTestId('start-page-menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
    const sub = await screen.findByTestId('start-page-menu');
    fireEvent.keyDown(sub, { key: 'Enter' });
    if (!screen.queryByTestId('start-page-/reports')) fireEvent.click(sub);
  }

  it('offers only the pages in this user\'s sidebar and saves the pick', async () => {
    caps = ['dashboards.view', 'reports.view'];
    (api.getMyPreferences as any).mockResolvedValue({});
    await act(async () => { await loadUserPreferences(); });
    await openStartPageMenu();
    const reports = await screen.findByTestId('start-page-/reports');
    expect(screen.queryByTestId('start-page-/query')).toBeNull();
    // The current first page (Dashboard, when nothing is saved) is shown as already chosen.
    expect(screen.getByTestId('start-page-/').getAttribute('data-disabled')).not.toBeNull();
    fireEvent.click(reports);
    await waitFor(() => expect(api.saveMyPreferences).toHaveBeenCalledWith({ startPage: '/reports' }));
  });

  it('clears the saved page when Dashboard is picked', async () => {
    (api.getMyPreferences as any).mockResolvedValue({ startPage: '/reports' });
    await act(async () => { await loadUserPreferences(); });
    await openStartPageMenu();
    fireEvent.click(await screen.findByTestId('start-page-/'));
    await waitFor(() => expect(api.saveMyPreferences).toHaveBeenCalledWith({ startPage: null }));
  });
});

