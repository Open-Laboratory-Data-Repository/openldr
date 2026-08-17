import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    fetchSites: vi.fn(), enrollSite: vi.fn(), rotateSite: vi.fn(),
    revokeSite: vi.fn(), downloadCentralCertificate: vi.fn() };
});
import * as api from '@/api';
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';
import { Sites } from './Sites';

const siteA = {
  siteId: 'lab-north', name: 'Northern Lab', clientId: 'client-north',
  enrolledAt: '2026-06-24T00:00:00Z', enrolledBy: 'admin', status: 'active' as const,
};
const siteB = {
  siteId: 'lab-south', name: 'Southern Lab', clientId: 'client-south',
  enrolledAt: '2026-06-25T00:00:00Z', enrolledBy: 'admin', status: 'revoked' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.fetchSites as any).mockResolvedValue([siteA, siteB]);
});

describe('Sites page', () => {
  it('lists enrolled sites', async () => {
    render(<MemoryRouter><Sites /></MemoryRouter>);
    expect(await screen.findByText('lab-north')).toBeTruthy();
    expect(screen.getByText('Southern Lab')).toBeTruthy();
  });

  it('renders the standard table toolbar with the chips row', async () => {
    render(<MemoryRouter><Sites /></MemoryRouter>);
    await screen.findByText('lab-north');

    await addFilterViaPopover('x');
    expectStandardTableToolbar();
  });

  it('filters rows by the search box', async () => {
    render(<MemoryRouter><Sites /></MemoryRouter>);
    await screen.findByText('lab-north');

    fireEvent.change(screen.getByPlaceholderText(/search sites/i), { target: { value: 'south' } });
    expect(screen.queryByText('lab-north')).toBeNull();
    expect(screen.getByText('lab-south')).toBeTruthy();
  });
});
