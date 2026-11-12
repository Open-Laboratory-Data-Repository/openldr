import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { AuthProvider, useAuth, __resetAuthProviderState } from './AuthProvider';

vi.mock('@/api', () => ({ authFetch: vi.fn(), getMe: vi.fn(), getMyCapabilities: vi.fn() }));
vi.mock('./oidc', () => ({ getOidc: vi.fn(), createOidc: vi.fn(), __resetOidc: vi.fn() }));
vi.mock('./local', () => ({ localRefresh: vi.fn(), localLogout: vi.fn(), localLogin: vi.fn(), keepSessionFresh: vi.fn() }));

import { authFetch, getMe, getMyCapabilities } from '@/api';
import { getOidc } from './oidc';
import { keepSessionFresh, localLogin, localLogout, localRefresh, type LocalSession } from './local';
import { getAccessToken, notifyUnauthorized, setAccessToken } from './token';

function Probe() {
  const { user, loading, hasCapability } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      {user ? `${user.username}:${hasCapability('roles:manage')}:${hasCapability('roles:missing')}` : 'anon'}
    </div>
  );
}

const okConfig = (cfg: object) =>
  (authFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => cfg,
  });

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAuthProviderState();
  });

  it('dev-bypass (not enforced): loads /api/me anonymously, no OIDC', async () => {
    okConfig({ authEnforced: false, oidc: null, dashboardSqlEnabled: false });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'dev',
      username: 'dev-admin',
      displayName: null,
      roles: ['lab_admin'],
    });
    (getMyCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue(['roles:manage']);
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('dev-admin:true:false')).toBeTruthy());
    expect(getOidc).not.toHaveBeenCalled();
    expect(getMyCapabilities).toHaveBeenCalled();
  });

  it('enforced + no stored session: triggers signinRedirect', async () => {
    okConfig({ authEnforced: true, oidc: { issuerUrl: 'i', clientId: 'c', audience: null }, dashboardSqlEnabled: false });
    const signinRedirect = vi.fn();
    (getOidc as ReturnType<typeof vi.fn>).mockReturnValue({
      getStoredUser: vi.fn().mockResolvedValue(null),
      signinRedirect,
      handleCallback: vi.fn(),
      signoutRedirect: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(signinRedirect).toHaveBeenCalled());
  });

  it('enforced + stored session: loads /api/me', async () => {
    okConfig({ authEnforced: true, oidc: { issuerUrl: 'i', clientId: 'c', audience: null }, dashboardSqlEnabled: false });
    (getOidc as ReturnType<typeof vi.fn>).mockReturnValue({
      getStoredUser: vi.fn().mockResolvedValue({ access_token: 't', expired: false }),
      signinRedirect: vi.fn(),
      handleCallback: vi.fn(),
      signoutRedirect: vi.fn(),
    });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u',
      username: 'ada',
      displayName: null,
      roles: ['lab_admin'],
    });
    // Failed capabilities fetch must degrade safely to an empty set (hasCapability => false),
    // rather than crashing the provider.
    (getMyCapabilities as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('ada:false:false')).toBeTruthy());
  });

  it('enforced + at /auth/callback: skips signinRedirect (callback route)', async () => {
    okConfig({ authEnforced: true, oidc: { issuerUrl: 'i', clientId: 'c', audience: null }, dashboardSqlEnabled: false });
    const signinRedirect = vi.fn();
    (getOidc as ReturnType<typeof vi.fn>).mockReturnValue({
      getStoredUser: vi.fn().mockResolvedValue(null),
      signinRedirect,
      handleCallback: vi.fn(),
      signoutRedirect: vi.fn(),
    });
    render(
      <MemoryRouter initialEntries={['/auth/callback']}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    // loading becomes false (callback early-return), signinRedirect must NOT be called
    await waitFor(() => expect(screen.queryByText('loading')).toBeNull());
    expect(signinRedirect).not.toHaveBeenCalled();
  });

  it('config unreachable (ok:false): renders error card, does not call getMe', async () => {
    (authFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText('Cannot reach the server. Please reload.')).toBeTruthy(),
    );
    expect(getMe).not.toHaveBeenCalled();
    expect(getMyCapabilities).not.toHaveBeenCalled();
  });

  it('config fetch rejects: renders error card, does not call getMe', async () => {
    (authFetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText('Cannot reach the server. Please reload.')).toBeTruthy(),
    );
    expect(getMe).not.toHaveBeenCalled();
    expect(getMyCapabilities).not.toHaveBeenCalled();
  });
});

it('removes protected content and explains local-only signout', async () => {
  okConfig({ authEnforced: true, oidc: { mode: 'oidc', issuerUrl: 'https://idp', clientId: 'c', audience: null } });
  vi.mocked(getMe).mockResolvedValue({ id: 'local', username: 'bob' } as never);
  vi.mocked(getMyCapabilities).mockResolvedValue([]);
  vi.mocked(getOidc).mockReturnValue({ getStoredUser: vi.fn().mockResolvedValue({ access_token: 't' }), signoutRedirect: vi.fn().mockResolvedValue('local'), signinRedirect: vi.fn() } as never);
  function Session() {
    const auth = useAuth();
    return <><span>Protected content</span><span>{String(auth.authCapabilities?.identityAdmin)}</span><button onClick={auth.signOut}>Leave</button></>;
  }
  render(<MemoryRouter><AuthProvider><Session /></AuthProvider></MemoryRouter>);
  fireEvent.click(await screen.findByText('Leave'));
  await screen.findByText(/Signed out of this browser/);
  expect(screen.queryByText('Protected content')).toBeNull();
});

describe('AuthProvider under local sign-in', () => {
  const localConfig = { authEnforced: true, oidc: null, dashboardSqlEnabled: false, auth: { mode: 'local', setupRequired: false } };
  const mockConfig = okConfig;
  const mockLocalRefresh = (s: LocalSession | null) => vi.mocked(localRefresh).mockResolvedValue(s);
  const stop = vi.fn();
  let ended: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetAuthProviderState();
    setAccessToken(null);
    ended = null;
    vi.mocked(keepSessionFresh).mockImplementation((s, onEnded) => {
      setAccessToken(s.accessToken);
      ended = onEnded;
      return stop;
    });
    vi.mocked(localLogout).mockResolvedValue(true);
    vi.mocked(getMe).mockResolvedValue({ id: 'u', username: 'ada', displayName: null, roles: [] } as never);
    vi.mocked(getMyCapabilities).mockResolvedValue([]);
  });

  function App() {
    const { signOut } = useAuth();
    return <><p>app</p><button onClick={signOut}>Leave</button></>;
  }
  const renderApp = () => render(<MemoryRouter><AuthProvider><App /></AuthProvider></MemoryRouter>);

  it('shows the sign-in form under local sign-in and loads no user', async () => {
    mockConfig(localConfig);
    mockLocalRefresh(null);
    renderApp();
    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(screen.queryByText('app')).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
    expect(getMyCapabilities).not.toHaveBeenCalled();
    expect(getOidc).not.toHaveBeenCalled();
  });

  it('loads the app when a local session exists', async () => {
    mockConfig(localConfig);
    mockLocalRefresh({ accessToken: 't', expiresIn: 600, mustChangePassword: false });
    renderApp();
    expect(await screen.findByText('app')).toBeInTheDocument();
    expect(getAccessToken()).toBe('t');
    expect(getMe).toHaveBeenCalled();
    expect(getOidc).not.toHaveBeenCalled();
  });

  it('loads the app after signing in on the sign-in page', async () => {
    mockConfig(localConfig);
    mockLocalRefresh(null);
    vi.mocked(localLogin).mockResolvedValue({ accessToken: 'fresh', expiresIn: 600, mustChangePassword: false });
    renderApp();
    fireEvent.change(await screen.findByLabelText('Username or email'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('app')).toBeInTheDocument();
    expect(getAccessToken()).toBe('fresh');
    expect(getMe).toHaveBeenCalled();
  });

  it('shows the sign-in page while setup is required and does not try a refresh', async () => {
    mockConfig({ ...localConfig, auth: { mode: 'local', setupRequired: true } });
    renderApp();
    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(localRefresh).not.toHaveBeenCalled();
  });

  it('loads no user when the session must change its password', async () => {
    mockConfig(localConfig);
    mockLocalRefresh({ accessToken: 't', expiresIn: 600, mustChangePassword: true });
    renderApp();
    await waitFor(() => expect(keepSessionFresh).toHaveBeenCalled());
    expect(screen.queryByText('app')).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
  });

  it('still treats a missing oidc block as bypass when auth is not enforced', async () => {
    mockConfig({ ...localConfig, authEnforced: false });
    renderApp();
    expect(await screen.findByText('app')).toBeInTheDocument();
    expect(getMe).toHaveBeenCalled();
    expect(localRefresh).not.toHaveBeenCalled();
  });

  it('keeps the old behaviour for an older server that sends no auth block', async () => {
    mockConfig({ authEnforced: true, oidc: null, dashboardSqlEnabled: false });
    renderApp();
    expect(await screen.findByText('app')).toBeInTheDocument();
    expect(getMe).toHaveBeenCalled();
    expect(localRefresh).not.toHaveBeenCalled();
  });

  it('signs out: ends the server session, stops the refresh timer, clears the token', async () => {
    mockConfig(localConfig);
    mockLocalRefresh({ accessToken: 't', expiresIn: 600, mustChangePassword: false });
    renderApp();
    fireEvent.click(await screen.findByText('Leave'));
    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(localLogout).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
    expect(screen.queryByText('app')).toBeNull();
    expect(screen.queryByText(/Sign-out did not reach the server/)).toBeNull();
  });

  it('warns and offers a retry when sign-out did not reach the server; a working retry removes the warning', async () => {
    mockConfig(localConfig);
    mockLocalRefresh({ accessToken: 't', expiresIn: 600, mustChangePassword: false });
    vi.mocked(localLogout).mockResolvedValueOnce(false);
    renderApp();
    fireEvent.click(await screen.findByText('Leave'));
    expect(await screen.findByText(/Sign-out did not reach the server/)).toBeInTheDocument();
    expect(screen.getByLabelText('Username or email')).toBeInTheDocument();
    expect(screen.queryByText('app')).toBeNull();
    expect(stop).toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();

    vi.mocked(localLogout).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Try signing out again' }));
    await waitFor(() => expect(localLogout).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Sign-out did not reach the server/)).toBeInTheDocument();

    vi.mocked(localLogout).mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Try signing out again' }));
    await waitFor(() => expect(screen.queryByText(/Sign-out did not reach the server/)).toBeNull());
    expect(localLogout).toHaveBeenCalledTimes(3);
    expect(getAccessToken()).toBeNull();
  });

  it('removes the sign-out warning after a successful sign-in', async () => {
    mockConfig(localConfig);
    mockLocalRefresh({ accessToken: 't', expiresIn: 600, mustChangePassword: false });
    vi.mocked(localLogout).mockResolvedValueOnce(false);
    renderApp();
    fireEvent.click(await screen.findByText('Leave'));
    await screen.findByText(/Sign-out did not reach the server/);
    vi.mocked(localLogin).mockResolvedValue({ accessToken: 'again', expiresIn: 600, mustChangePassword: false });
    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('app')).toBeInTheDocument();
    // Return to the sign-in page by a path that does not touch the flag itself: the session ends.
    act(() => ended?.());
    await screen.findByLabelText('Username or email');
    expect(screen.queryByText(/Sign-out did not reach the server/)).toBeNull();
  });

  it('stops the refresh timer on unmount', async () => {
    mockConfig(localConfig);
    mockLocalRefresh({ accessToken: 't', expiresIn: 600, mustChangePassword: false });
    const { unmount } = renderApp();
    await screen.findByText('app');
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it('shows the sign-in page when the refresh timer reports the session ended', async () => {
    mockConfig(localConfig);
    mockLocalRefresh({ accessToken: 't', expiresIn: 600, mustChangePassword: false });
    renderApp();
    await screen.findByText('app');
    act(() => ended?.());
    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });

  it('on a 401 tries one refresh and keeps the app when it works', async () => {
    mockConfig(localConfig);
    mockLocalRefresh({ accessToken: 't', expiresIn: 600, mustChangePassword: false });
    renderApp();
    await screen.findByText('app');
    vi.mocked(localRefresh).mockClear();
    mockLocalRefresh({ accessToken: 't2', expiresIn: 600, mustChangePassword: false });
    act(() => { notifyUnauthorized(); notifyUnauthorized(); });
    await waitFor(() => expect(getAccessToken()).toBe('t2'));
    expect(localRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('app')).toBeInTheDocument();
  });

  it('on a 401 shows the sign-in page when the refresh finds no session', async () => {
    mockConfig(localConfig);
    mockLocalRefresh({ accessToken: 't', expiresIn: 600, mustChangePassword: false });
    renderApp();
    await screen.findByText('app');
    mockLocalRefresh(null);
    act(() => notifyUnauthorized());
    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
  });
});
