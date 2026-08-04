import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

// Mirrors Users.test.tsx's mocking pattern: spread the real module so AppShell's own API calls
// (listPluginUis, etc.) keep working, and only stub the facilities/forms surface this page uses.
// FACILITIES_LIST_LIMIT is overridden to a small number so the I1 (truncation) test below doesn't
// have to render tens of thousands of table rows to hit the cap.
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    FACILITIES_LIST_LIMIT: 5,
    listFacilities: vi.fn(),
    createFacility: vi.fn(),
    updateFacility: vi.fn(),
    deleteFacility: vi.fn(),
    listPublishedForms: vi.fn(),
    getForm: vi.fn(),
  };
});

// hasCapability is reconfigured per-test (via useAuthMock) rather than fixed, so the I4 tests can
// exercise a viewer who holds facilities.view but not facilities.manage — exactly the
// data_analyst/system_auditor shape from packages/rbac/src/presets.ts.
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: useAuthMock }));

import { listFacilities, listPublishedForms, getForm, FACILITIES_LIST_LIMIT, type Facility } from '@/api';
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

const facilityFormSchema = {
  id: 'facility-schema-slug',
  name: 'Facility',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    { id: 'f-name', displayLabel: 'Name', description: null, fieldType: 'text', apiProperty: 'name', fhirPath: null, required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' } },
  ],
  sections: [],
  targetPages: ['facilities'],
  version: 1,
  active: true,
  status: 'published',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const sampleFacility: Facility = {
  id: 'f1', localCode: 'LAB01', nationalSystem: null, nationalCode: null, name: 'Dodoma Regional Referral',
  level: 'Hospital', ownership: null, status: 'Operating', country: 'TZ', zone: 'Central', region: 'Dodoma Region',
  district: 'Dodoma', council: null, ward: null, village: null, addressText: null, phone: null,
  latitude: null, longitude: null, extras: {}, managedOrigin: null, source: 'manual',
};

const show = () => render(<MemoryRouter><Facilities /></MemoryRouter>);

/** Open the ⋯ menu named `triggerName` and click the item matching `itemName`. Radix opens
 *  DropdownMenuContent on pointerdown; jsdom sometimes needs a follow-up Enter keydown. */
function clickMenuItem(triggerName: string, itemName: string | RegExp) {
  const trigger = screen.getByRole('button', { name: triggerName });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: itemName })) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
  fireEvent.click(screen.getByRole('menuitem', { name: itemName }));
}

describe('Facilities page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    // Default: a lab_admin-shaped actor who can both view and manage the registry. Individual
    // tests (I4) override this to a view-only actor.
    useAuthMock.mockReturnValue({
      user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] },
      loading: false,
      hasCapability: () => true,
    });
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
    (getForm as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: publishedFacilityForm.id, name: 'Facility', versionLabel: null, fhirResourceType: null,
      status: 'published', active: true, schema: facilityFormSchema, targetPages: ['facilities'],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    show();
    await waitFor(() => expect(screen.getByText(/no facilities yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/no facility form/i)).not.toBeInTheDocument();

    // Strengthened: this test's name promised the add action works, but the body only ever
    // checked the no-form message's absence — a broken Add button would have shipped green.
    // Actually drive it: open ⋯ → Add facility and confirm the create dialog renders its form.
    clickMenuItem('Facility actions', /add facility/i);
    // Exact match: the Sheet's own description text ("Enter a new facility into the registry.")
    // also contains the substring "new facility", so a loose /new facility/i match here throws
    // "multiple elements found" inside findByText's internal waitFor — which reads as an endless
    // retry (a timeout), not the assertion failure it actually is.
    expect(await screen.findByText(/^new facility$/i)).toBeInTheDocument();
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
  });

  it('lists facilities with their code, name and region', async () => {
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
    show();
    await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
    expect(screen.getByText('LAB01')).toBeInTheDocument();
    expect(screen.getByText('Dodoma Region')).toBeInTheDocument();
  });

  it('I5: still shows the table for existing rows even with no published form — the no-form state gates writes, not the list', async () => {
    // A lab that imported the national register and later archived the Facilities form must not
    // lose visibility of rows it already has — !hasForm used to replace the whole body, table
    // included, leaving zero ability to view, count, or delete existing facilities.
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
    show();
    await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
    expect(screen.queryByText(/no facility form/i)).not.toBeInTheDocument();
  });

  it('I1: warns plainly when the list hits the client-requested cap', async () => {
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    const capped: Facility[] = Array.from({ length: FACILITIES_LIST_LIMIT }, (_, i) => ({
      ...sampleFacility, id: `f${i}`, localCode: `LAB0${i}`, name: `Facility ${i}`,
    }));
    (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue(capped);
    show();
    await waitFor(() => expect(screen.getByText('Facility 0')).toBeInTheDocument());
    // A silent cap is the defect (see I1) — hitting FACILITIES_LIST_LIMIT must say so plainly,
    // not just render exactly as many rows as fit and leave the operator to guess.
    expect(screen.getByText(/showing the first/i)).toBeInTheDocument();
  });

  it('I1: does not warn when the list is comfortably under the cap', async () => {
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
    show();
    await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
  });

  describe('I4: facilities.manage gating (a view-only actor, e.g. data_analyst)', () => {
    beforeEach(() => {
      useAuthMock.mockReturnValue({
        user: { id: 'analyst', username: 'analyst', displayName: null, roles: ['data_analyst'] },
        loading: false,
        // data_analyst / system_auditor hold facilities.view WITHOUT facilities.manage
        // (packages/rbac/src/presets.ts) — everything but 'facilities.view' must read as denied.
        hasCapability: (cap: string) => cap === 'facilities.view',
      });
    });

    it('hides the header ⋯ Add action entirely', async () => {
      (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
      (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
      show();
      await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Facility actions' })).not.toBeInTheDocument();
    });

    it('hides the per-row Edit/Delete ⋯ menu', async () => {
      (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
      (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
      show();
      await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /facility actions dodoma regional referral/i })).not.toBeInTheDocument();
    });

    it('does not open the edit dialog by clicking the row', async () => {
      (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
      (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
      show();
      const cell = await screen.findByText('Dodoma Regional Referral');
      fireEvent.click(cell.closest('tr')!);
      expect(screen.queryByText(/edit facility/i)).not.toBeInTheDocument();
    });
  });
});
