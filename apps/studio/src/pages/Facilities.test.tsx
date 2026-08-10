import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    importFacilitiesCsv: vi.fn(),
    // The Observed tab (Task 9) is its own component with its own test suite
    // (ObservedTab.test.tsx) — stubbed here only so switching tabs on THIS page doesn't reach the
    // real network; Radix Tabs unmounts the inactive TabsContent, so these are untouched by every
    // test above that never clicks the Observed trigger.
    listObservedFacilities: vi.fn(),
    // Task 11: the health chip's own data source, plus its Retry action.
    getFacilityHealth: vi.fn(),
    retryFacilityJob: vi.fn(),
    // Fix wave 1 / Finding 1: backs the zone/region/district/council Selects behind the "More
    // filters" disclosure. Stubbed here so opening that panel in a test never reaches the real
    // network; most tests never open it, so most never touch this mock at all.
    listFacilityAdminValues: vi.fn(),
  };
});

// hasCapability is reconfigured per-test (via useAuthMock) rather than fixed, so the I4 tests can
// exercise a viewer who holds facilities.view but not facilities.manage — exactly the
// data_analyst/system_auditor shape from packages/rbac/src/presets.ts.
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: useAuthMock }));

import { listFacilities, listPublishedForms, getForm, importFacilitiesCsv, listObservedFacilities, getFacilityHealth, retryFacilityJob, deleteFacility, listFacilityAdminValues, type Facility, type FacilityHealth, type FacilityPage } from '@/api';
import { Facilities } from './Facilities';

const listFacilitiesMock = listFacilities as ReturnType<typeof vi.fn>;

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

// Task 4 (scale): GET /api/facilities returns a page, not a bare array (Task 3) — `makeRows`
// produces `n` plausible rows off `sampleFacility`, and `makePage` wraps them in the
// `{ rows, total, limit, offset }` shape `listFacilities` now resolves. `total` defaults to
// `rows.length` (the common "one page, no more") rather than requiring every caller to repeat it.
function makeRows(n: number): Facility[] {
  return Array.from({ length: n }, (_, i) => ({
    ...sampleFacility, id: `f${i}`, localCode: `LAB0${i}`, name: `Facility ${i}`,
    health: 'mapped', mappingCount: 1,
  }));
}
function makePage(rows: Facility[], overrides: Partial<FacilityPage> = {}): FacilityPage {
  return { rows, total: rows.length, limit: 50, offset: 0, ...overrides };
}

const show = () => render(<MemoryRouter><Facilities /></MemoryRouter>);

// Task 11: a benign default so the 30-odd tests above this point (none of which care about the
// health chip) don't each have to stub it themselves.
const currentHealth: FacilityHealth = {
  reportDimension: { state: 'current', lastSuccessAt: '2026-08-01T10:00:00Z', rows: 42, error: null, jobId: null },
  projection: { failedCount: 0, failed: [] },
};

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

/** Open the Import sheet's own ⋯ "Import actions" menu and click `itemName`, waiting first for it
 *  to be enabled (Preview stays `aria-disabled` until the async `File.text()` read resolves). Used
 *  only by the F1 test below, which — unlike ImportFacilitiesSheet.test.tsx's own suite — renders
 *  the REAL Facilities page around the sheet, because F1 is specifically about what happens to the
 *  sheet when its caller's `reload()` runs, something a standalone-sheet render can never exercise. */
async function clickImportMenuItem(itemName: string | RegExp) {
  const trigger = screen.getByRole('button', { name: 'Import actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('menuitem', { name: itemName })).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(screen.getByRole('menuitem', { name: itemName }));
}

describe('Facilities page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listFacilitiesMock.mockResolvedValue(makePage([]));
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue(currentHealth);
    (retryFacilityJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (listFacilityAdminValues as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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

  it('offers Import facilities in the header ⋯ menu for a manage-capable actor, opening the upload sheet', async () => {
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    show();
    await waitFor(() => expect(screen.getByText(/no facilities yet/i)).toBeInTheDocument());

    clickMenuItem('Facility actions', /import facilities/i);
    expect(await screen.findByText(/^import facilities$/i)).toBeInTheDocument();
    expect(await screen.findByLabelText('File')).toBeInTheDocument();
    expect(screen.getByLabelText('National system')).toBeInTheDocument();
  });

  it('offers Import facilities even without a published form — importing writes core columns directly, not through the form', async () => {
    // Distinct from Add (disabled={!hasForm} above): a lab whose Facilities form was archived
    // after the national register was already imported must still be able to re-import a
    // refreshed register.
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    show();
    await waitFor(() => expect(screen.getByText(/no facility form/i)).toBeInTheDocument());

    const trigger = screen.getByRole('button', { name: 'Facility actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /import facilities/i })) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    expect(screen.getByRole('menuitem', { name: /import facilities/i })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('lists facilities with their code, name and region', async () => {
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
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
    listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
    show();
    await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
    expect(screen.queryByText(/no facility form/i)).not.toBeInTheDocument();
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
      listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
      show();
      await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Facility actions' })).not.toBeInTheDocument();
    });

    it('hides Import facilities along with the rest of the header ⋯ menu', async () => {
      (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
      listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
      show();
      await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
      // The whole trigger is gone (asserted above), so there is no menu to open at all — this
      // pins that Import specifically never renders unguarded elsewhere on the page either.
      expect(screen.queryByRole('menuitem', { name: /import facilities/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/^import facilities$/i)).not.toBeInTheDocument();
    });

    it('hides the per-row Edit/Delete ⋯ menu', async () => {
      (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
      listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
      show();
      await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /facility actions dodoma regional referral/i })).not.toBeInTheDocument();
    });

    it('does not open the edit dialog by clicking the row', async () => {
      (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
      listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
      show();
      const cell = await screen.findByText('Dodoma Regional Referral');
      fireEvent.click(cell.closest('tr')!);
      expect(screen.queryByText(/edit facility/i)).not.toBeInTheDocument();
    });
  });

  it('Minor 4: names the cause inline when rows exist but no facility form is published', async () => {
    // Distinct from I5 (which only pins that the TABLE keeps rendering): a lab in this exact state
    // sees Add and the row Edit item both greyed out with nothing else on the page explaining why —
    // this banner is that explanation.
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
    show();
    await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
    // Reuses the noFormHelp body text, NOT the noForm title — the title ("No facility form is
    // published.") is reserved for the dedicated empty state and must stay absent here, exactly
    // what the existing I5 assertion above already locks in.
    expect(screen.getByText(/entered through a published form targeting the Facilities page/i)).toBeInTheDocument();
    expect(screen.queryByText(/no facility form/i)).not.toBeInTheDocument();
  });

  it('Minor 4: does not show the banner once a form is published, even with rows present', async () => {
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
    show();
    await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
    expect(screen.queryByText(/entered through a published form targeting the Facilities page/i)).not.toBeInTheDocument();
  });

  it('F1: a successful apply keeps the Import sheet mounted so its own success confirmation survives the list refresh', async () => {
    // This is the whole point of rendering the real Facilities page (not the sheet standalone, as
    // ImportFacilitiesSheet.test.tsx does): `onImported` calls THIS page's `reload`, and it is that
    // reload — not anything inside the sheet — that used to flip `loading` to true, which the page's
    // own render swaps in a full-page LoadingState that unmounts everything below it, sheet included.
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    listFacilitiesMock
      .mockResolvedValueOnce(makePage([])) // initial load
      .mockResolvedValueOnce(makePage([sampleFacility])); // background reload triggered by onImported
    // A2a (FAC-P1-03/05): the sheet now reads the server's full reconciliation shape (`create`/
    // `changed`/`unchanged`/`conflict`/`absent`/`deleted`/`samples`/`written`/`runId`/
    // `knownNationalSystem`), not just the old flat `created`/`updated` — see
    // ImportFacilitiesSheet.test.tsx's own `baseResult` helper, mirrored here since this test drives
    // the sheet through the real Facilities page rather than standalone.
    // CT-3 (whole-branch review): Wave A's new fields (facility-import.ts's `FacilityImportResult`)
    // — release provenance and controlled-field warnings, both empty for this plain CSV fixture.
    (importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        parsed: 3, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], invalid: [], duplicates: 0,
        blocked: false, blockedReason: null,
        create: 3, changed: 0, unchanged: 0, conflict: null, absent: null, deleted: 0,
        samples: { create: [], changed: [], conflict: [], absent: [], deleted: [] },
        written: { created: 0, updated: 0, retired: 0 }, runId: 'run-1', knownNationalSystem: true,
        meta: null, countMismatch: [], releaseVersion: null,
        unmapped: { level: [], status: [], country: [] }, notValidated: [],
      })
      .mockResolvedValueOnce({
        parsed: 3, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], invalid: [], duplicates: 0,
        blocked: false, blockedReason: null,
        create: 2, changed: 1, unchanged: 0, conflict: null, absent: null, deleted: 0,
        samples: { create: [], changed: [], conflict: [], absent: [], deleted: [] },
        written: { created: 2, updated: 1, retired: 0 }, runId: 'run-1', knownNationalSystem: true,
        meta: null, countMismatch: [], releaseVersion: null,
        unmapped: { level: [], status: [], country: [] }, notValidated: [],
      });
    show();
    await waitFor(() => expect(screen.getByText(/no facilities yet/i)).toBeInTheDocument());

    clickMenuItem('Facility actions', /import facilities/i);
    expect(await screen.findByText(/^import facilities$/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [new File(['local_code,name\nLAB01,Dodoma RRH\n'], 'register.csv', { type: 'text/csv' })] },
    });
    fireEvent.change(screen.getByLabelText('National system'), { target: { value: 'HFR' } });

    await clickImportMenuItem(/^preview$/i);
    await waitFor(() => expect(importFacilitiesCsv).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/3 row\(s\) will be imported/i)).toBeInTheDocument();

    await clickImportMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(importFacilitiesCsv).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listFacilities).toHaveBeenCalledTimes(2));

    // The sheet must still be showing ITS OWN success confirmation after the background reload
    // settles — not a blank, freshly-remounted sheet with the result thrown away.
    expect(await screen.findByText(/import complete/i)).toBeInTheDocument();
    expect(screen.getByText(/created 2, updated 1, skipped 0/i)).toBeInTheDocument();
    // And the underlying table did actually pick up the refreshed row from the background reload.
    expect(await screen.findByText('Dodoma Regional Referral')).toBeInTheDocument();
  });

  describe('Task 9: Registry | Observed tabs', () => {
    it('shows the Registry table by default, and switching to Observed mounts the Observed tab instead', async () => {
      (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
      listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
      (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([
        { sourceSystem: 'webhook-ingest', sourceCode: 'Dodoma', reportCount: 247, registryId: null, localCode: null, name: null, level: null, status: null, region: null, district: null, council: null, nationalSystem: null, nationalCode: null, resolvedVia: null, targetMissing: false },
      ]);
      show();
      await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
      // The Observed tab hasn't been clicked yet — Radix unmounts inactive TabsContent, so its
      // fetch must not have fired.
      expect(listObservedFacilities).not.toHaveBeenCalled();

      // Radix's TabsTrigger switches tabs on `onMouseDown`, not `onClick` — a bare fireEvent.click
      // fires neither event on its own in jsdom.
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Observed' }), { button: 0, ctrlKey: false });
      expect(await screen.findByText('Dodoma')).toBeInTheDocument();
      // The Registry table is gone now that Observed is the active tab (Radix unmounts the
      // inactive TabsContent, via an async Presence transition — wait for it rather than
      // asserting synchronously).
      await waitFor(() => expect(screen.queryByText('Dodoma Regional Referral')).not.toBeInTheDocument());
    });

    it('review finding: the Observed tab trigger is reachable while the Registry fetch is still pending', async () => {
      // A slow/failing Registry fetch (e.g. a large CSV import in flight) used to gate the WHOLE
      // page behind a full-page LoadingState rendered BEFORE Tabs even mounted — the operator
      // couldn't even see the Observed trigger, let alone click it. listFacilities() here never
      // resolves, simulating that slow fetch; listPublishedForms() likewise never resolves, so
      // `hasForm` also never settles. Only the Registry panel's own body should show a spinner.
      (listFacilities as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
      (listPublishedForms as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
      (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([
        { sourceSystem: 'webhook-ingest', sourceCode: 'Dodoma', reportCount: 247, registryId: null, localCode: null, name: null, level: null, status: null, region: null, district: null, council: null, nationalSystem: null, nationalCode: null, resolvedVia: null, targetMissing: false },
      ]);
      show();

      // The tab trigger itself is reachable immediately — the old code never rendered Tabs at all
      // while loading, so this `getByRole` would have thrown before this fix.
      const observedTrigger = await screen.findByRole('tab', { name: 'Observed' });
      fireEvent.mouseDown(observedTrigger, { button: 0, ctrlKey: false });
      // Observed fetches independently and is not blocked by the still-pending Registry calls.
      expect(await screen.findByText('Dodoma')).toBeInTheDocument();
    });

    it('hosts a single ⋯ on the tab strip that swaps content with the active tab, instead of a second header row per tab', async () => {
      (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
      listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
      (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      show();
      await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());

      // Registry's ⋯ is present, and neither tab's old redundant title row survives (both were
      // there purely to host the ⋯ this now replaces).
      expect(screen.getByRole('button', { name: 'Facility actions' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Observed facility actions' })).not.toBeInTheDocument();
      expect(screen.queryByText('Observed facilities')).not.toBeInTheDocument();

      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Observed' }), { button: 0, ctrlKey: false });
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Facility actions' })).not.toBeInTheDocument());

      // Exactly one ⋯ trigger exists at a time, and it is now Observed's own (Scan/Publish) menu —
      // the two menus stay entirely separate, never merged into one combined menu. Registry's own
      // items (Add facility / Import facilities) must not have bled into it.
      expect(screen.getAllByRole('button', { name: 'Observed facility actions' })).toHaveLength(1);
      const trigger = screen.getByRole('button', { name: 'Observed facility actions' });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByRole('menuitem', { name: /scan for new facilities/i })) fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(screen.getByRole('menuitem', { name: /scan for new facilities/i })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /rebuild reports dimension/i })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /add facility/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /import facilities/i })).not.toBeInTheDocument();
    });
  });

  // Task 11: the report-dimension health chip. FAC-P0-08's complaint was that this page shows a
  // mapping as successful while published reports keep the old/raw facility — this chip is what
  // makes the report-facing `facility_map` dimension's own freshness visible instead of assumed.
  describe('Task 11: report-dimension health chip', () => {
    it('shows Current with the last successful build time', async () => {
      (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        reportDimension: { state: 'current', lastSuccessAt: '2026-08-01T10:00:00Z', rows: 88, error: null, jobId: null },
        projection: { failedCount: 0, failed: [] },
      });
      show();
      expect(await screen.findByText(/current/i)).toBeInTheDocument();
      // The last successful build time must actually be driven by `lastSuccessAt`, not just
      // present as static copy — assert the year the fixture supplies renders somewhere.
      expect(screen.getByText(/2026/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('shows Updating while a rebuild is queued, with no Retry action', async () => {
      (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        reportDimension: { state: 'updating', lastSuccessAt: null, rows: null, error: null, jobId: null },
        projection: { failedCount: 0, failed: [] },
      });
      show();
      expect(await screen.findByText(/updating/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('shows Stale — a state that should never occur in practice, but must be renderable when it does', async () => {
      (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        reportDimension: { state: 'stale', lastSuccessAt: '2026-07-01T10:00:00Z', rows: 10, error: null, jobId: null },
        projection: { failedCount: 0, failed: [] },
      });
      show();
      expect(await screen.findByText(/stale/i)).toBeInTheDocument();
    });

    it('shows Failed with a Retry action for a manage-capable actor, which re-queues the job and refreshes the chip', async () => {
      (getFacilityHealth as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          reportDimension: { state: 'failed', lastSuccessAt: null, rows: null, error: 'warehouse unreachable', jobId: 'fj-1' },
          projection: { failedCount: 0, failed: [] },
        })
        .mockResolvedValueOnce({
          reportDimension: { state: 'updating', lastSuccessAt: null, rows: null, error: null, jobId: null },
          projection: { failedCount: 0, failed: [] },
        });
      show();
      const retryBtn = await screen.findByRole('button', { name: /retry/i });
      expect(screen.getByText(/failed/i)).toBeInTheDocument();

      fireEvent.click(retryBtn);

      // Driven by the health payload's own jobId, not a hardcoded/guessed id.
      await waitFor(() => expect(retryFacilityJob).toHaveBeenCalledWith('fj-1'));
      await waitFor(() => expect(getFacilityHealth).toHaveBeenCalledTimes(2));
      expect(await screen.findByText(/updating/i)).toBeInTheDocument();
    });

    it('hides the Retry action for a view-only actor even when the dimension has failed', async () => {
      useAuthMock.mockReturnValue({
        user: { id: 'analyst', username: 'analyst', displayName: null, roles: ['data_analyst'] },
        loading: false,
        hasCapability: (cap: string) => cap === 'facilities.view',
      });
      (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        reportDimension: { state: 'failed', lastSuccessAt: null, rows: null, error: 'warehouse unreachable', jobId: 'fj-1' },
        projection: { failedCount: 0, failed: [] },
      });
      show();
      expect(await screen.findByText(/failed/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('surfaces a failed projection count as a signal separate from the dimension state', async () => {
      (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        reportDimension: { state: 'current', lastSuccessAt: '2026-08-01T10:00:00Z', rows: 88, error: null, jobId: null },
        projection: {
          failedCount: 2,
          failed: [
            { id: 'fj-p1', registryId: 'fac-A', lastError: 'boom' },
            { id: 'fj-p2', registryId: 'fac-B', lastError: 'boom' },
          ],
        },
      });
      show();
      // A failed projection must not make the dimension itself read as failed.
      expect(await screen.findByText(/current/i)).toBeInTheDocument();
      expect(screen.getByText(/2 facility mappings? .*attention/i)).toBeInTheDocument();
      expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    });

    // ⛔ A failed PROJECTION was retryable from nowhere: the payload carried a count and no job id,
    // so this page could report that N facilities were missing from the mapping picker and offer no
    // way to repair a single one of them. One action PER JOB — projection jobs coalesce per facility,
    // so a single grouped action could only ever fix one and would strand the rest.
    it('offers a Retry per failed projection, each re-queuing its own job', async () => {
      (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        reportDimension: { state: 'current', lastSuccessAt: '2026-08-01T10:00:00Z', rows: 88, error: null, jobId: null },
        projection: {
          failedCount: 2,
          failed: [
            { id: 'fj-p1', registryId: 'fac-A', lastError: 'terminology store unreachable' },
            { id: 'fj-p2', registryId: 'fac-B', lastError: 'code collision' },
          ],
        },
      });
      show();

      // Each names the facility it repairs, so two identical "Retry" buttons cannot be confused.
      const retryA = await screen.findByRole('button', { name: /retry fac-A/i });
      expect(screen.getByRole('button', { name: /retry fac-B/i })).toBeInTheDocument();

      fireEvent.click(retryA);

      // fac-A's OWN job id, driven by the payload — not the dimension's jobId (null here) and not
      // the other row's.
      await waitFor(() => expect(retryFacilityJob).toHaveBeenCalledWith('fj-p1'));
      expect(retryFacilityJob).toHaveBeenCalledTimes(1);
    });

    it('hides the per-projection Retry actions from a view-only actor', async () => {
      useAuthMock.mockReturnValue({
        user: { id: 'analyst', username: 'analyst', displayName: null, roles: ['data_analyst'] },
        loading: false,
        hasCapability: (cap: string) => cap === 'facilities.view',
      });
      (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        reportDimension: { state: 'current', lastSuccessAt: '2026-08-01T10:00:00Z', rows: 88, error: null, jobId: null },
        projection: { failedCount: 1, failed: [{ id: 'fj-p1', registryId: 'fac-A', lastError: 'boom' }] },
      });
      show();
      // The WARNING still shows — a viewer should know the data is incomplete — but not the action.
      expect(await screen.findByText(/1 facility mapping .*attention/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    // ⛔ The other half of the same defect: the chip refreshed on mount and after a Retry ONLY, so
    // every mutation on this page left it frozen. Deleting a facility enqueues a rebuild server-side
    // and takes the local-row-removal path (no `reload()`), which is exactly where the refresh was
    // missing — a `reload()`-only fix would leave this case still frozen.
    it('refreshes the chip after a facility is deleted', async () => {
      listFacilitiesMock.mockResolvedValue(makePage([sampleFacility]));
      (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
      (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue(currentHealth);
      (deleteFacility as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      show();

      await screen.findByText('Dodoma Regional Referral');
      const afterMount = (getFacilityHealth as ReturnType<typeof vi.fn>).mock.calls.length;

      clickMenuItem(`Facility actions ${sampleFacility.name}`, /delete/i);
      fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));

      await waitFor(() => expect(deleteFacility).toHaveBeenCalledWith('f1'));
      await waitFor(() =>
        expect((getFacilityHealth as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(afterMount));
    });

    // ⛔ `Updating` is transient, so a chip that only refreshes on mount and after a Retry can never
    // show it resolving — an operator who saved a facility, applied an import or edited a mapping
    // watched a frozen chip until they reloaded the page. The whole argument for enqueue-plus-worker
    // over an inline rebuild is that the stale window is VISIBLE and bounded rather than silent.
    it('polls while the dimension is Updating, and stops once it is Current', async () => {
      vi.useFakeTimers();
      try {
        (getFacilityHealth as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce({
            reportDimension: { state: 'updating', lastSuccessAt: null, rows: null, error: null, jobId: null },
            projection: { failedCount: 0, failed: [] },
          })
          .mockResolvedValue({
            reportDimension: { state: 'current', lastSuccessAt: '2026-08-01T10:00:00Z', rows: 88, error: null, jobId: null },
            projection: { failedCount: 0, failed: [] },
          });
        show();

        await vi.waitFor(() => expect(screen.getByText(/updating/i)).toBeInTheDocument());
        const afterMount = (getFacilityHealth as ReturnType<typeof vi.fn>).mock.calls.length;

        await vi.advanceTimersByTimeAsync(5000);
        expect((getFacilityHealth as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(afterMount);
        await vi.waitFor(() => expect(screen.getByText(/current/i)).toBeInTheDocument());

        // ⛔ And it STOPS. Leaving the interval armed turns a transient chip into a permanent
        // background poll on a page an operator may leave open all day.
        const afterSettled = (getFacilityHealth as ReturnType<typeof vi.fn>).mock.calls.length;
        await vi.advanceTimersByTimeAsync(20000);
        expect((getFacilityHealth as ReturnType<typeof vi.fn>).mock.calls.length).toBe(afterSettled);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not poll while the dimension is Current', async () => {
      vi.useFakeTimers();
      try {
        (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue(currentHealth);
        show();
        await vi.waitFor(() => expect(screen.getByText(/current/i)).toBeInTheDocument());
        const settled = (getFacilityHealth as ReturnType<typeof vi.fn>).mock.calls.length;

        await vi.advanceTimersByTimeAsync(20000);

        expect((getFacilityHealth as ReturnType<typeof vi.fn>).mock.calls.length).toBe(settled);
      } finally {
        vi.useRealTimers();
      }
    });

    // ⛔ Distinct from the two tests above: those pin the OBSERVABLE behaviour (no further requests),
    // which the `cancelled` flag alone already satisfies — a leaked `setInterval` with a no-op body
    // produces identical request counts (see the ⚠ in the fix report). This one pins the CLEANUP
    // itself: the SPECIFIC timer the poll effect registers (identified by its HEALTH_POLL_MS delay,
    // not by aggregate timer count — the page mounts other Radix primitives that own timers of their
    // own, so counting ALL pending timers would be noisy) must actually be torn down via
    // `clearInterval` on unmount, so an operator who navigates away mid-rebuild does not strand a 5s
    // timer holding the component's closure alive.
    it('clears the poll interval on unmount', async () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      try {
        (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
          reportDimension: { state: 'updating', lastSuccessAt: null, rows: null, error: null, jobId: null },
          projection: { failedCount: 0, failed: [] },
        });
        const { unmount } = show();

        await vi.waitFor(() => expect(screen.getByText(/updating/i)).toBeInTheDocument());
        // 5000 mirrors Facilities.tsx's un-exported `HEALTH_POLL_MS` — this is how the poll interval
        // is told apart from any other timer Radix primitives on the page may register.
        const pollCall = setIntervalSpy.mock.calls.find((call) => call[1] === 5000);
        expect(pollCall).toBeDefined();
        const pollTimerId = setIntervalSpy.mock.results[setIntervalSpy.mock.calls.indexOf(pollCall!)]?.value;
        expect(pollTimerId).toBeDefined();

        unmount();

        expect(clearIntervalSpy.mock.calls.map((c) => c[0])).toContainEqual(pollTimerId);
      } finally {
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  // Task 4 (scale): the paged registry table — replaces the fetch-up-to-2000-and-render-them-all
  // approach (I1's tests, and the `truncated` banner they pinned, are gone along with it: with an
  // exact `total` from the server there is nothing left for a truncation warning to say). Kept LAST
  // in this file deliberately — these are the only tests that touch `window.location` directly
  // (Facilities.tsx reads/writes it via `window.history`, not react-router's in-memory history,
  // since MemoryRouter has no bearing on the real URL bar), and nothing here resets it between
  // tests. Running last means that mutation can never leak into an earlier, unrelated test.
  describe('Task 4: paging, search and URL state', () => {
    it('requests a page and shows the total, not a truncation warning', async () => {
      listFacilitiesMock.mockResolvedValue(makePage(makeRows(50), { total: 13000 }));
      show();
      expect(await screen.findByText(/13000|13,000/)).toBeInTheDocument();
      expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
    });

    it('puts search, filter and page state in the URL', async () => {
      listFacilitiesMock.mockResolvedValue(makePage(makeRows(50), { total: 13000 }));
      show();
      await userEvent.type(await screen.findByRole('searchbox'), 'dodoma');
      // Fix wave 1 / Finding 3: search now debounces (250ms) before committing into the URL, so
      // this can no longer assert the URL updates on the very next microtask — awaiting the
      // SETTLED state (via `waitFor`'s own retry loop) is what the fix instructions ask for here,
      // not weakening what's asserted: the URL must still end up exactly `q=dodoma`, just not
      // necessarily synchronously with the last keystroke.
      await waitFor(() => expect(window.location.search).toContain('q=dodoma'));
    });

    // Fix wave 1 / Finding 1: the ten open-vocabulary filters added behind the "More filters"
    // disclosure — pins that the toggle reveals them, that a Select among them (zone, backed by
    // `listFacilityAdminValues`) round-trips through the URL exactly like `health`/`source`
    // already did, and that a free-text one among them (nationalSystem — deliberately the audit's
    // actual "registry source", see the design's provenance table) goes through the same debounce
    // as search rather than firing on every keystroke.
    it('Fix wave 1 / Finding 1: reveals the open-vocabulary filters behind "More filters" and round-trips them through the URL', async () => {
      listFacilitiesMock.mockResolvedValue(makePage(makeRows(1), { total: 1 }));
      (listFacilityAdminValues as ReturnType<typeof vi.fn>).mockImplementation((level: string) =>
        level === 'zone' ? Promise.resolve([{ value: 'Central', count: 3 }]) : Promise.resolve([]));
      show();
      await screen.findByText('Facility 0');

      // Collapsed by default — none of the ten extra filters are visible yet.
      expect(screen.queryByLabelText('National system')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /more filters/i }));
      expect(await screen.findByLabelText('National system')).toBeInTheDocument();

      // The zone Select is populated from `listFacilityAdminValues('zone', {})` — the same
      // mechanism `useFacilityAdminSuggestions` uses, called directly rather than through that
      // hook (which requires a FormSchema this toolbar doesn't have).
      await waitFor(() => expect(listFacilityAdminValues).toHaveBeenCalledWith('zone'));
      fireEvent.click(screen.getByRole('combobox', { name: 'Zone' }));
      fireEvent.click(await screen.findByRole('option', { name: 'Central' }));
      await waitFor(() => expect(window.location.search).toContain('zone=Central'));
      await waitFor(() => expect(listFacilitiesMock).toHaveBeenCalledWith(
        expect.objectContaining({ zone: 'Central' }),
      ));

      // A free-text filter from the same panel debounces into the URL exactly like search does.
      fireEvent.change(screen.getByLabelText('National system'), { target: { value: 'HFR' } });
      await waitFor(() => expect(window.location.search).toContain('nationalSystem=HFR'));
      await waitFor(() => expect(listFacilitiesMock).toHaveBeenCalledWith(
        expect.objectContaining({ nationalSystem: 'HFR' }),
      ));
    });

    // Fix wave 1 / Finding 2: `reload()` had no request-sequencing guard — every keystroke fired an
    // unguarded fetch, and an out-of-order response (entirely plausible against a 13,000-row table
    // under load) could silently overwrite fresher `rows`/`total` with stale ones. This drives two
    // DISTINCT committed searches (each clears its own 250ms debounce, so both are real in-flight
    // requests, not one debounced commit) and resolves the LATER one FIRST — the exact out-of-order
    // arrival the finding describes — then asserts the page still reflects the later result once
    // the stale one finally resolves too.
    it('Fix wave 1 / Finding 2: an in-flight response that resolves AFTER a later one must not overwrite the later result', async () => {
      vi.useFakeTimers();
      try {
        listFacilitiesMock.mockResolvedValueOnce(makePage([])); // the initial mount load

        let resolveFirst!: (page: FacilityPage) => void;
        let resolveSecond!: (page: FacilityPage) => void;
        const firstResponse = new Promise<FacilityPage>((resolve) => { resolveFirst = resolve; });
        const secondResponse = new Promise<FacilityPage>((resolve) => { resolveSecond = resolve; });
        listFacilitiesMock.mockImplementationOnce(() => firstResponse);
        listFacilitiesMock.mockImplementationOnce(() => secondResponse);

        show();
        // Wait for the search box itself (not just the mock call count) — the mount `reload()`
        // call is registered on the mock synchronously, but the box only appears once its
        // resolution has actually been rendered (`loading`/`hasForm` settling).
        await vi.waitFor(() => expect(screen.getByRole('searchbox')).toBeInTheDocument());
        expect(listFacilitiesMock).toHaveBeenCalledTimes(1);

        const search = screen.getByRole('searchbox');
        fireEvent.change(search, { target: { value: 'a' } });
        await vi.advanceTimersByTimeAsync(300); // past the 250ms debounce — commits 'a', fires request #2
        fireEvent.change(search, { target: { value: 'ab' } });
        await vi.advanceTimersByTimeAsync(300); // commits 'ab', fires request #3

        await vi.waitFor(() => expect(listFacilitiesMock).toHaveBeenCalledTimes(3));

        // Resolve the LATER request ('ab') first, then the earlier one ('a') — out of order.
        resolveSecond(makePage([{ ...sampleFacility, id: 'later', name: 'Later Result' }]));
        await vi.waitFor(() => expect(screen.getByText('Later Result')).toBeInTheDocument());

        resolveFirst(makePage([{ ...sampleFacility, id: 'stale', name: 'Stale Result' }]));
        await vi.advanceTimersByTimeAsync(0); // let the now-resolved stale promise's .then() run

        // The later (fresher) response must still be what's on screen — the stale response that
        // arrived after it must never have overwritten it.
        expect(screen.getByText('Later Result')).toBeInTheDocument();
        expect(screen.queryByText('Stale Result')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('restores search and page from the URL on mount', async () => {
      window.history.replaceState({}, '', '/facilities?q=dodoma&offset=100');
      listFacilitiesMock.mockResolvedValue(makePage(makeRows(50), { total: 13000, offset: 100 }));
      show();
      await waitFor(() => expect(listFacilitiesMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'dodoma', offset: 100 }),
      ));
    });

    // M11 (whole-branch review): neither pager button had a test — a broken `onClick` (wrong
    // direction, wrong step size, or a stale `offset` closed over) would have shipped green.
    it('M11: clicking Next requests the next page at the page size, and it round-trips through the URL', async () => {
      window.history.replaceState({}, '', '/facilities');
      // 130 rows total, 50 per page (PAGE_SIZE, un-exported from Facilities.tsx — mirrored here the
      // same way HEALTH_POLL_MS is elsewhere in this file) — a middle page exists (offset 50, not
      // yet the last), so clicking Next from page 1 has somewhere unambiguous to go.
      listFacilitiesMock.mockResolvedValue(makePage(makeRows(50), { total: 130, offset: 0 }));
      show();
      await waitFor(() => expect(listFacilitiesMock).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => expect(listFacilitiesMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 50, limit: 50 }),
      ));
      await waitFor(() => expect(window.location.search).toContain('offset=50'));
    });

    it('M11: disables Previous on the first page and Next on the last page, and enables the other one', async () => {
      // Reset the URL state left behind by an earlier test in this describe block — these tests
      // deliberately run last and share `window.location` (see this describe block's own doc
      // comment above), and `readUrlState()` reads `offset` straight off it on mount.
      window.history.replaceState({}, '', '/facilities');
      // First page: offset 0, total (130) comfortably larger than one page — Previous has nowhere
      // to go, Next does.
      listFacilitiesMock.mockResolvedValue(makePage(makeRows(50), { total: 130, offset: 0 }));
      show();
      await waitFor(() => expect(listFacilitiesMock).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();

      // Last page: offset 100 with the same total 130 — 100 + 50 (PAGE_SIZE) >= 130, so Next has
      // nowhere left to go; Previous does.
      listFacilitiesMock.mockResolvedValue(makePage(makeRows(30), { total: 130, offset: 100 }));
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await waitFor(() => expect(window.location.search).toContain('offset=100'));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
    });
  });

  /** ⛔ Every other test on this page renders `<Facilities />` bare (`show()`), so the mount effect
   *  runs ONCE. The real app renders under `<StrictMode>` (apps/studio/src/main.tsx), where React
   *  deliberately runs every mount effect TWICE — and refs survive that simulated remount. So the
   *  second run sees `isFirstLoad.current === false`, issues a `background: true` reload, and bumps
   *  the generation ref past the first call's captured value. Neither call can then clear `loading`:
   *  the blocking one is superseded (guard fails in `finally`), the background one never touches
   *  `loading` by design — and the Registry panel shows its spinner forever, on every dev page load,
   *  with the data sitting fetched and discarded. This is the ONLY test that mounts the page the way
   *  production actually does. */
  it('renders rows under StrictMode, whose doubled mount effect must not strand the spinner', async () => {
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    listFacilitiesMock.mockResolvedValue(makePage(makeRows(3)));
    window.history.replaceState({}, '', '/facilities');

    render(<React.StrictMode><MemoryRouter><Facilities /></MemoryRouter></React.StrictMode>);

    expect(await screen.findByText('Facility 0')).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });
});
