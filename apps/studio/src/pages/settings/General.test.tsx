import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
// Mutable so a test can drop the caller to a signed-in user with no settings capability.
const caps = { granted: true };
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasCapability: () => caps.granted }),
}));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    fetchClientConfig: vi.fn(),
    fetchFeatureFlags: vi.fn(),
    fetchNumberSettings: vi.fn(),
    getValidation: vi.fn(),
    fetchUpdateState: vi.fn(),
    setUpdateCheckEnabled: vi.fn(),
  };
});
import * as api from '@/api';
import { General } from './General';

const AVAILABLE = {
  enabled: true, running: '0.1.1', latestVersion: '0.2.0', releasedAt: '2026-08-20',
  notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z',
  lastCheckedAt: '2026-08-20T10:00:00.000Z', lastError: null, updateAvailable: true,
};

/** A check that has been failing for a year: it keeps stamping lastCheckedAt, so the card would
 *  otherwise read "Last checked 4 minutes ago" and nothing else. */
const FAILING = {
  enabled: true, running: '0.1.1', latestVersion: null, releasedAt: null, notesUrl: null,
  firstSeenAt: null, lastCheckedAt: '2026-08-20T10:00:00.000Z',
  lastError: 'update check timed out after 10000ms', updateAvailable: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  caps.granted = true;
  (api.fetchClientConfig as any).mockResolvedValue({
    dashboardSqlEnabled: false, authEnforced: false, version: '0.1.1', environment: 'test', oidc: null,
  });
  (api.fetchFeatureFlags as any).mockResolvedValue([]);
  (api.fetchNumberSettings as any).mockResolvedValue([]);
  (api.getValidation as any).mockResolvedValue({ strictness: 'high' });
  (api.fetchUpdateState as any).mockResolvedValue({ ...AVAILABLE, updateAvailable: false, latestVersion: '0.1.1', running: '0.1.1' });
});

describe('General settings — About card update notice', () => {
  it('shows the available version next to the running one', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(AVAILABLE);
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByText(/0\.2\.0 available/i)).toBeInTheDocument();
  });

  it('shows the two upgrade commands when an update exists', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(AVAILABLE);
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByText(/docker compose pull/)).toBeInTheDocument();
    expect(screen.getByText(/docker compose up -d/)).toBeInTheDocument();
  });

  it('does not show the commands when the install is current', async () => {
    (api.fetchClientConfig as any).mockResolvedValue({
      dashboardSqlEnabled: false, authEnforced: false, version: '0.2.0', environment: 'test', oidc: null,
    });
    (api.fetchUpdateState as any).mockResolvedValue({
      enabled: true, running: '0.2.0', latestVersion: '0.2.0', releasedAt: '2026-08-20',
      notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z',
      lastCheckedAt: '2026-08-20T10:00:00.000Z', lastError: null, updateAvailable: false,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    await screen.findByTestId('update-latest');
    expect(screen.queryByText(/docker compose pull/)).toBeNull();
  });

  it('links to the release notes when the manifest carried a URL', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(AVAILABLE);
    render(<MemoryRouter><General /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: /release notes/i });
    expect(link.getAttribute('href')).toBe('https://example.org/x');
  });

  it('turning the check off calls the server and reflects the stored value', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(AVAILABLE);
    (api.setUpdateCheckEnabled as any).mockResolvedValue({ enabled: false });
    render(<MemoryRouter><General /></MemoryRouter>);

    const sw = await screen.findByTestId('update-check-enabled');
    expect(sw.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(sw);

    await waitFor(() => expect(api.setUpdateCheckEnabled).toHaveBeenCalledWith(false));
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
  });

  it('reverts the switch when the save fails', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(AVAILABLE);
    (api.setUpdateCheckEnabled as any).mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><General /></MemoryRouter>);

    const sw = await screen.findByTestId('update-check-enabled');
    fireEvent.click(sw);

    await waitFor(() => expect(api.setUpdateCheckEnabled).toHaveBeenCalled());
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
  });

  it('renders the rest of the About card when the update state cannot be loaded', async () => {
    (api.fetchUpdateState as any).mockRejectedValue(new Error('404'));
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByText('0.1.1')).toBeInTheDocument();
    expect(screen.queryByText(/docker compose pull/)).toBeNull();
  });

  // A check that never succeeds is the dangerous case: lastCheckedAt still moves, so a silent card
  // reads as "up to date" forever.
  it('shows why the check failed instead of only when it last ran', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(FAILING);
    render(<MemoryRouter><General /></MemoryRouter>);
    const line = await screen.findByTestId('update-last-error');
    expect(line.textContent).toMatch(/timed out after 10000ms/);
  });

  it('shows the check state to a user with no settings capability, without the switch', async () => {
    caps.granted = false;
    (api.fetchUpdateState as any).mockResolvedValue(FAILING);
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByTestId('update-last-error')).toBeInTheDocument();
    expect(screen.getByTestId('update-last-checked')).toBeInTheDocument();
    expect(screen.queryByTestId('update-check-enabled')).toBeNull();
  });

  it('shows the release date beside the available version', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(AVAILABLE);
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByText(/2026-08-20/)).toBeInTheDocument();
  });

  it('shows the running version from the update state when /api/config fails', async () => {
    (api.fetchClientConfig as any).mockRejectedValue(new Error('boom'));
    (api.fetchUpdateState as any).mockResolvedValue(AVAILABLE);
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByText('0.1.1')).toBeInTheDocument();
  });

  it('states the install is up to date, naming the version', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      ...AVAILABLE, running: '0.1.3', latestVersion: '0.1.3', updateAvailable: false, lastError: null,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    const row = await screen.findByTestId('update-latest');
    expect(row).toHaveTextContent('0.1.3');
    expect(row).toHaveTextContent(/up to date/i);
  });

  it('names the newer version and its notes in the Latest row', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(AVAILABLE);
    render(<MemoryRouter><General /></MemoryRouter>);
    const row = await screen.findByTestId('update-latest');
    expect(row).toHaveTextContent('0.2.0');
    expect(row).toHaveTextContent(/Release notes/i);
  });

  // ⛔ Without this row, "check is off" and "you are current" look identical on screen, and the
  // switch that would tell them apart is hidden from anyone without settings.edit_general.
  it('says the check is off rather than implying the install is current', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      ...AVAILABLE, enabled: false, updateAvailable: false,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByTestId('update-latest')).toHaveTextContent(/off/i);
  });

  it('says it cannot confirm when the last check failed', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(FAILING);
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByTestId('update-latest')).toHaveTextContent(/cannot confirm/i);
  });

  it('says not checked yet when nothing has ever been cached', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      ...AVAILABLE, latestVersion: null, releasedAt: null, notesUrl: null,
      lastCheckedAt: null, lastError: null, updateAvailable: false,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByTestId('update-latest')).toHaveTextContent(/not checked yet/i);
  });

  // An older server has no /api/update, so the studio sets update to null. The card must fall
  // back to today's behaviour rather than showing a Latest row with a dash in it.
  it('omits the Latest row entirely when the update state cannot be loaded', async () => {
    (api.fetchUpdateState as any).mockRejectedValue(new Error('404'));
    render(<MemoryRouter><General /></MemoryRouter>);
    await screen.findByText('About');
    expect(screen.queryByTestId('update-latest')).toBeNull();
  });
});
