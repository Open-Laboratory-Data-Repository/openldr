import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

// Mirrors Facilities.test.tsx's mocking pattern: spread the real module so anything this
// component doesn't override keeps working, and stub only the surface ObservedTab uses.
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    listObservedFacilities: vi.fn(),
    scanObservedFacilities: vi.fn(),
    publishFacilities: vi.fn(),
    listCodingSystems: vi.fn(),
    listTermMappings: vi.fn(),
  };
});

// hasCapability is reconfigured per-test, exactly as Facilities.test.tsx's I4 suite does, so a
// data_analyst/system_auditor-shaped actor (facilities.view WITHOUT facilities.manage — see
// packages/rbac/src/presets.ts) can be exercised here too.
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: useAuthMock }));

import {
  listObservedFacilities, scanObservedFacilities, publishFacilities, listCodingSystems, listTermMappings,
  type ObservedFacility, type CodingSystem, type TermMapping,
} from '@/api';
import { ObservedTab } from './ObservedTab';

const dodoma: ObservedFacility = {
  sourceSystem: 'webhook-ingest', sourceCode: 'Dodoma', reportCount: 247,
  registryId: 'f1', name: 'Dodoma Regional Referral Hospital', level: null, status: null,
  region: null, district: null, council: null, nationalSystem: null, nationalCode: null,
  resolvedVia: 'registry', targetMissing: false,
};
const kibondo: ObservedFacility = {
  sourceSystem: 'webhook-ingest', sourceCode: 'Kibondo', reportCount: 148,
  registryId: null, name: null, level: null, status: null, region: null, district: null,
  council: null, nationalSystem: null, nationalCode: null, resolvedVia: null, targetMissing: false,
};
const oceanRoad: ObservedFacility = {
  sourceSystem: 'webhook-ingest', sourceCode: 'Ocean Road Cancer Institute (O', reportCount: 6,
  registryId: null, name: null, level: null, status: null, region: null, district: null,
  council: null, nationalSystem: null, nationalCode: null, resolvedVia: null, targetMissing: true,
};

const defaultFacSystem: CodingSystem = {
  id: 'cs-1', systemCode: 'DEFAULT_FAC', systemName: 'Observed facilities',
  url: 'urn:openldr:default_fac', systemVersion: null, description: null, active: true,
  publisherId: 'pub-system', seeded: false,
};

const show = () => render(<ObservedTab />);

describe('ObservedTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([dodoma]);
    (listCodingSystems as ReturnType<typeof vi.fn>).mockResolvedValue([defaultFacSystem]);
    (listTermMappings as ReturnType<typeof vi.fn>).mockResolvedValue({ outgoing: [], reverse: [] });
    // Default: a lab_admin-shaped actor who can both view and manage.
    useAuthMock.mockReturnValue({
      user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] },
      loading: false,
      hasCapability: () => true,
    });
  });

  it('orders observed facilities by report count and names the fallback', async () => {
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([dodoma, kibondo]);
    show();

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('Dodoma')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Dodoma Regional Referral Hospital')).toBeInTheDocument();
    expect(within(rows[2]).getByText(/Kibondo/)).toBeInTheDocument();
  });

  it('marks a mapping whose target was deleted', async () => {
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([oceanRoad]);
    show();

    expect(await screen.findByText(/target missing/i)).toBeInTheDocument();
  });

  it('hides write actions without facilities.manage', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'analyst', username: 'analyst', displayName: null, roles: ['data_analyst'] },
      loading: false,
      // data_analyst/system_auditor hold facilities.view WITHOUT facilities.manage.
      hasCapability: (cap: string) => cap === 'facilities.view',
    });
    show();
    await screen.findByText('Dodoma');
    expect(screen.queryByRole('button', { name: /actions/i })).not.toBeInTheDocument();
  });

  it('shows a plain "not mapped" message for an unmapped row, distinct from the raw code', async () => {
    // Guards against the resolves-to cell repeating the raw code substring — if it did, a regex
    // match on that substring (as the brief's own "marks a mapping..." style test uses) would hit
    // BOTH the code cell and the resolves-to cell and throw "multiple elements found".
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([kibondo]);
    show();

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText(/not mapped/i)).toBeInTheDocument();
    // Exactly one element in the row carries the raw code text (the observed-code cell).
    expect(within(rows[1]).getAllByText('Kibondo')).toHaveLength(1);
  });

  it('shows an empty state when there are no observed facilities', async () => {
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    show();
    expect(await screen.findByText(/no observed facilities/i)).toBeInTheDocument();
  });

  it('surfaces a load error', async () => {
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network blip'));
    show();
    expect(await screen.findByText(/network blip/i)).toBeInTheDocument();
  });

  it('offers Scan and Publish in the header ⋯ menu for a manage-capable actor, and branches on the returned counters', async () => {
    (scanObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue({ discovered: 23, created: 2, updated: 21, systemRegistered: true });
    show();
    await screen.findByText('Dodoma');

    const trigger = screen.getByRole('button', { name: 'Observed facility actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /scan for new facilities/i })) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    fireEvent.click(screen.getByRole('menuitem', { name: /scan for new facilities/i }));

    await waitFor(() => expect(scanObservedFacilities).toHaveBeenCalledWith({ apply: true }));
    // The banner must report the REAL counters, not a bare "done" — a caller that only checked
    // res.ok would say the same thing for a scan that discovered zero new codes.
    expect(await screen.findByText(/23 discovered/i)).toBeInTheDocument();
    expect(screen.getByText(/2 created/i)).toBeInTheDocument();
    // The list is refreshed after a successful scan.
    await waitFor(() => expect(listObservedFacilities).toHaveBeenCalledTimes(2));
  });

  it('opens the shipped TermMappingDialog to map an unmapped row, prefilling nothing (create mode)', async () => {
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([kibondo]);
    show();
    await screen.findByText('Kibondo');

    const trigger = screen.getByRole('button', { name: 'Observed facility actions Kibondo' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /^map$/i })) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    fireEvent.click(screen.getByRole('menuitem', { name: /^map$/i }));

    // TermMappingDialog's own "New mapping" title — proves the REAL dialog opened, not a
    // hand-rolled substitute, and that no prior mapping was found to prefill.
    expect(await screen.findByText(/^new mapping$/i)).toBeInTheDocument();
  });

  it('opens the shipped TermMappingDialog in edit mode for an already-mapped row', async () => {
    const existing: TermMapping = {
      id: 'tm-1', fromSystem: 'urn:openldr:default_fac', fromCode: 'Dodoma',
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'f1', toDisplay: 'Dodoma Regional Referral Hospital',
      mapType: 'SAME-AS', relationship: null, owner: null, isActive: true,
    };
    (listTermMappings as ReturnType<typeof vi.fn>).mockResolvedValue({ outgoing: [existing], reverse: [] });
    show();
    await screen.findByText('Dodoma');

    const trigger = screen.getByRole('button', { name: 'Observed facility actions Dodoma' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /edit mapping/i })) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    fireEvent.click(screen.getByRole('menuitem', { name: /edit mapping/i }));

    expect(await screen.findByText(/^edit mapping$/i)).toBeInTheDocument();
  });
});
