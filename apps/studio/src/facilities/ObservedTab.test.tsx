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
  sourceSystem: 'webhook-ingest', sourceCode: 'Dodoma', sourceDisplay: null, reportCount: 247,
  registryId: 'f1', localCode: 'DOD-REF', name: 'Dodoma Regional Referral Hospital', level: 'Hospital', status: null,
  region: 'Dodoma', district: 'Dodoma Urban', council: null, nationalSystem: null, nationalCode: null,
  resolvedVia: 'registry', targetMissing: false,
};
// Alphabetically "Arusha" sorts BEFORE "Dodoma", but carries fewer reports (148 < 247) — deliberately
// the opposite of alphabetical order, so a sort-by-code mutation cannot pass the ordering test below
// by accident (Minor finding: the old "Kibondo" fixture was alphabetical AND count-descending too,
// so this fixture is deliberately renamed/reordered to break that coincidence).
const arusha: ObservedFacility = {
  sourceSystem: 'webhook-ingest', sourceCode: 'Arusha', sourceDisplay: null, reportCount: 148,
  registryId: null, localCode: null, name: null, level: null, status: null, region: null, district: null,
  council: null, nationalSystem: null, nationalCode: null, resolvedVia: null, targetMissing: false,
};
const oceanRoad: ObservedFacility = {
  sourceSystem: 'webhook-ingest', sourceCode: 'Ocean Road Cancer Institute (O', sourceDisplay: null, reportCount: 6,
  registryId: null, localCode: null, name: null, level: null, status: null, region: null, district: null,
  council: null, nationalSystem: null, nationalCode: null, resolvedVia: null, targetMissing: true,
};
// DisaGlobal.dbo.LOCNDIC4 holds five distinct facility codes whose DESCRIPTION is all exactly
// "Aga Khan" — BAMAA is one of them. Used to pin that the observed-code cell shows the code AND
// its name, so an operator sees "BAMAA — Aga Khan" rather than an opaque code indistinguishable
// from the other four.
const bamaa: ObservedFacility = {
  sourceSystem: 'webhook-ingest', sourceCode: 'BAMAA', sourceDisplay: 'Aga Khan', reportCount: 12,
  registryId: null, localCode: null, name: null, level: null, status: null, region: null, district: null,
  council: null, nationalSystem: null, nationalCode: null, resolvedVia: null, targetMissing: false,
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
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([dodoma, arusha]);
    show();

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('Dodoma')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Dodoma Regional Referral Hospital')).toBeInTheDocument();
    expect(within(rows[2]).getByText(/Arusha/)).toBeInTheDocument();
  });

  // ⛔ THE point of this whole slice: DisaGlobal holds 5 distinct facility codes (BAMAA/BBFAF/
  // CDABE/EAFAE/NDFAM) whose display is all exactly "Aga Khan". Without the name shown alongside
  // the code, an operator triaging the Observed tab sees five opaque, indistinguishable codes.
  it('shows the observed display alongside the observed code (BAMAA — Aga Khan)', async () => {
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([bamaa]);
    show();
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('BAMAA')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Aga Khan')).toBeInTheDocument();
  });

  it('shows no second line under the code when sourceDisplay is null', async () => {
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([arusha]);
    show();
    const rows = await screen.findAllByRole('row');
    // arusha.sourceDisplay is null, and it is unmapped — 'Arusha' must appear exactly once (the
    // code cell), not doubled by a stray display line.
    expect(within(rows[1]).getAllByText('Arusha')).toHaveLength(1);
  });

  it('shows the local code, level and admin area under a resolved name, so two similarly-named facilities are distinguishable', async () => {
    // Operator request: "I need to know is it Dodoma referral or Dodoma zonal lab" — the name alone
    // cannot answer that; `dodoma`'s fixture carries localCode: 'DOD-REF', level: 'Hospital',
    // district: 'Dodoma Urban', region: 'Dodoma'.
    show();
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('Dodoma Regional Referral Hospital')).toBeInTheDocument();
    expect(within(rows[1]).getByText('DOD-REF · Hospital · Dodoma Urban, Dodoma · via registry')).toBeInTheDocument();
  });

  it('omits a null part of the detail line rather than rendering an empty separator', async () => {
    // A registry-resolved row with NO localCode/level/district/region set (only region/district
    // absent, say) must not render stray "· ·" from the omitted parts.
    const sparse = {
      ...dodoma, sourceCode: 'Sparse', localCode: null, level: null, region: null, district: null,
    };
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sparse]);
    show();
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('via registry')).toBeInTheDocument();
  });

  it('omits localCode from the detail line when it is byte-identical to the observed code already shown in column 1', async () => {
    // Operator observation: on a single-feed install, facility_registry.local_code is either NULL
    // or a verbatim repeat of the observed code (column 1) — showing it again in the detail line
    // is pure noise. Here sourceCode === localCode === 'NHLQATC', the measured live-DB shape.
    const sameCode = {
      ...dodoma, sourceCode: 'NHLQATC', localCode: 'NHLQATC', level: 'Hospital',
      district: 'Dodoma Urban', region: 'Dodoma',
    };
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sameCode]);
    show();
    const rows = await screen.findAllByRole('row');
    // The code must not repeat: no "NHLQATC · Hospital · ..." — just level/area/via.
    expect(within(rows[1]).getByText('Hospital · Dodoma Urban, Dodoma · via registry')).toBeInTheDocument();
    expect(within(rows[1]).queryByText(/NHLQATC ·/)).not.toBeInTheDocument();
  });

  it('shows localCode in the detail line when it differs from the observed code (a second feed sending a different code for the same facility)', async () => {
    // dodoma's fixture: sourceCode 'Dodoma', localCode 'DOD-REF' — genuinely different strings,
    // so localCode carries real information and must render.
    show();
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('DOD-REF · Hospital · Dodoma Urban, Dodoma · via registry')).toBeInTheDocument();
  });

  it('renders level and admin area with no leading or doubled separator when localCode is null (the real Dodoma row on this install today)', async () => {
    // Measured live-DB shape: 3 of 4 facility_registry rows have local_code NULL (the CSV importer
    // only writes national fields). This must not render a leading "· Hospital · ..." nor a
    // doubled "· ·" where the omitted localCode would have been.
    const noLocalCode = { ...dodoma, localCode: null };
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([noLocalCode]);
    show();
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('Hospital · Dodoma Urban, Dodoma · via registry')).toBeInTheDocument();
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
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([arusha]);
    show();

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText(/not mapped/i)).toBeInTheDocument();
    // Exactly one element in the row carries the raw code text (the observed-code cell).
    expect(within(rows[1]).getAllByText('Arusha')).toHaveLength(1);
  });

  it('shows an empty state when there are no observed facilities', async () => {
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    show();
    expect(await screen.findByText(/no observed facilities/i)).toBeInTheDocument();
  });

  it('surfaces a load error, and does not ALSO show the misleading "run a scan" empty state', async () => {
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network blip'));
    show();
    expect(await screen.findByText(/network blip/i)).toBeInTheDocument();
    // A load failure leaves `rows` at `[]`, same as a genuinely empty result — but "run a scan to
    // discover facility strings" actively misdirects an operator whose fetch failed for network
    // reasons; there is nothing a scan fixes here. The two states must be mutually exclusive.
    expect(screen.queryByText(/no observed facilities/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/run a scan/i)).not.toBeInTheDocument();
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

  it('renders an all-zero scan result honestly rather than as a bare success', async () => {
    // Minor finding: nothing previously pinned that a scan discovering NOTHING new still shows its
    // real (zero) counters, rather than e.g. a generic "done" a caller might be tempted to
    // special-case when every counter is 0.
    (scanObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue({ discovered: 0, created: 0, updated: 0, systemRegistered: true });
    show();
    await screen.findByText('Dodoma');

    const trigger = screen.getByRole('button', { name: 'Observed facility actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /scan for new facilities/i })) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    fireEvent.click(screen.getByRole('menuitem', { name: /scan for new facilities/i }));

    await waitFor(() => expect(scanObservedFacilities).toHaveBeenCalledWith({ apply: true }));
    expect(await screen.findByText(/0 discovered/i)).toBeInTheDocument();
    expect(screen.getByText(/0 created/i)).toBeInTheDocument();
    expect(screen.getByText(/0 updated/i)).toBeInTheDocument();
  });

  it('paginates client-side using the shared TablePagination, and resets to page 0 after a scan', async () => {
    const many: ObservedFacility[] = Array.from({ length: 30 }, (_, i) => ({
      ...arusha, sourceCode: `Facility ${String(i).padStart(2, '0')}`, reportCount: 100 - i,
    }));
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue(many);
    (scanObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue({ discovered: 30, created: 0, updated: 30, systemRegistered: true });
    show();

    // Default page size is 25 — the first page shows Facility 00..24, not Facility 29.
    await screen.findByText('Facility 00');
    expect(screen.queryByText('Facility 29')).not.toBeInTheDocument();
    expect(screen.getByText(/1–25 of 30/)).toBeInTheDocument(); // from the shared TablePagination

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(await screen.findByText('Facility 29')).toBeInTheDocument();
    expect(screen.queryByText('Facility 00')).not.toBeInTheDocument();

    // A scan changes the underlying row set — the operator must not be stranded on page 2.
    const trigger = screen.getByRole('button', { name: 'Observed facility actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /scan for new facilities/i })) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    fireEvent.click(screen.getByRole('menuitem', { name: /scan for new facilities/i }));

    await waitFor(() => expect(screen.getByText('Facility 00')).toBeInTheDocument());
    expect(screen.queryByText('Facility 29')).not.toBeInTheDocument();
  });

  it('opens the shipped TermMappingDialog to map an unmapped row, prefilling nothing (create mode)', async () => {
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([arusha]);
    show();
    await screen.findByText('Arusha');

    const trigger = screen.getByRole('button', { name: 'Observed facility actions Arusha' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /^map$/i })) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    fireEvent.click(screen.getByRole('menuitem', { name: /^map$/i }));

    // TermMappingDialog's own "New mapping" title — proves the REAL dialog opened, not a
    // hand-rolled substitute, and that no prior mapping was found to prefill.
    expect(await screen.findByText(/^new mapping$/i)).toBeInTheDocument();
  });

  // Gap 2 (Task 9b fix round 1): each row belongs to its own ingest feed (`row.sourceSystem`), and
  // the coding system the mapping is authored against must be DERIVED from that feed, not
  // hardcoded to the default. A CDR-fed row sharing a code with a webhook-fed row must be mappable
  // under ITS OWN system, or the resolver (which looks up mappings per-feed, see
  // facility-reconcile.ts's `resolveObservedFacilities`) will never find the mapping. Asserts on the
  // ACTUAL system string passed to `listTermMappings` and rendered by the real `TermMappingDialog` —
  // not merely that some prop was defined.
  it("derives the mapping dialog's coding system from the row's own sourceSystem, not the default", async () => {
    const cdrSystem: CodingSystem = {
      id: 'cs-2', systemCode: 'FAC_CDR_IMPORT', systemName: 'Observed facilities',
      url: 'urn:openldr:fac_cdr_import', systemVersion: null, description: null, active: true,
      publisherId: 'pub-system', seeded: false,
    };
    const cdrRow: ObservedFacility = { ...arusha, sourceSystem: 'cdr-import', sourceCode: 'NHL-01' };
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([cdrRow]);
    (listCodingSystems as ReturnType<typeof vi.fn>).mockResolvedValue([defaultFacSystem, cdrSystem]);
    show();
    await screen.findByText('NHL-01');

    const trigger = screen.getByRole('button', { name: 'Observed facility actions NHL-01' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /^map$/i })) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    fireEvent.click(screen.getByRole('menuitem', { name: /^map$/i }));

    // The pre-fill lookup must query the ROW's own derived system (`observedSystemForFeed`
    // applied to 'cdr-import'), never `urn:openldr:default_fac`.
    await waitFor(() => expect(listTermMappings).toHaveBeenCalledWith('urn:openldr:fac_cdr_import', 'NHL-01'));
    // The dialog itself must have been opened against that same system: its header renders the
    // FROM term as "<systemCode> <code>" (TermMappingDialog.tsx), so the SECOND system's code
    // (FAC_CDR_IMPORT) must appear directly next to the observed code — not the default system's
    // code (DEFAULT_FAC), and not blank (which `mappingSystemCode`'s `?? ''` fallback would produce
    // if the lookup missed).
    expect(await screen.findByText(/FAC_CDR_IMPORT NHL-01/)).toBeInTheDocument();
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
