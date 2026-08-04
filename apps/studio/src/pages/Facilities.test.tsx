import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

// Mirrors Users.test.tsx's mocking pattern: spread the real module so AppShell's own API calls
// (listPluginUis, etc.) keep working, and only stub the facilities/forms surface this page uses.
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    listFacilities: vi.fn(),
    createFacility: vi.fn(),
    updateFacility: vi.fn(),
    deleteFacility: vi.fn(),
    listPublishedForms: vi.fn(),
    getForm: vi.fn(),
  };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasCapability: () => true }),
}));

import { listFacilities, listPublishedForms } from '@/api';
import { Facilities } from './Facilities';

const publishedFacilityForm = {
  id: 'form-sample-facility',
  name: 'Facility',
  versionLabel: null,
  status: 'published' as const,
  active: true,
  fhirResourceType: null,
  targetPages: ['facilities'],
  fieldCount: 8,
  updatedAt: '2026-01-01T00:00:00Z',
};

const show = () => render(<MemoryRouter><Facilities /></MemoryRouter>);

describe('Facilities page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('distinguishes "no published form" from "no facilities yet"', async () => {
    // Three gates can each independently leave this page empty (page target unavailable, form not
    // targeting facilities, form still a draft). One merged "nothing here" message is how they stay
    // invisible — so the no-form case must name its own cause and point at the builder.
    show();
    await waitFor(() => expect(screen.getByText(/no facility form/i)).toBeInTheDocument());
  });

  it('shows the add action when a published form exists and there are no facilities', async () => {
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    show();
    await waitFor(() => expect(screen.getByText(/no facilities yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/no facility form/i)).not.toBeInTheDocument();
  });

  it('lists facilities with their code, name and region', async () => {
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'f1', localCode: 'LAB01', nationalSystem: null, nationalCode: null, name: 'Dodoma Regional Referral',
        level: 'Hospital', ownership: null, status: 'Operating', country: 'TZ', zone: 'Central', region: 'Dodoma Region',
        district: 'Dodoma', council: null, ward: null, village: null, addressText: null, phone: null,
        latitude: null, longitude: null, extras: {}, managedOrigin: null, source: 'manual',
      },
    ]);
    show();
    await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
    expect(screen.getByText('LAB01')).toBeInTheDocument();
    expect(screen.getByText('Dodoma Region')).toBeInTheDocument();
  });
});
