import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasCapability: () => true }),
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

beforeEach(() => {
  vi.clearAllMocks();
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
    await screen.findByText('0.2.0');
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
});
