import React from 'react';
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
    importFacilitiesCsv: vi.fn(),
    // The Observed tab (Task 9) is its own component with its own test suite
    // (ObservedTab.test.tsx) — stubbed here only so switching tabs on THIS page doesn't reach the
    // real network; Radix Tabs unmounts the inactive TabsContent, so these are untouched by every
    // test above that never clicks the Observed trigger.
    listObservedFacilities: vi.fn(),
    // Task 11: the health chip's own data source, plus its Retry action.
    getFacilityHealth: vi.fn(),
    retryFacilityJob: vi.fn(),
  };
});

// hasCapability is reconfigured per-test (via useAuthMock) rather than fixed, so the I4 tests can
// exercise a viewer who holds facilities.view but not facilities.manage — exactly the
// data_analyst/system_auditor shape from packages/rbac/src/presets.ts.
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: useAuthMock }));

import { listFacilities, listPublishedForms, getForm, importFacilitiesCsv, listObservedFacilities, getFacilityHealth, retryFacilityJob, FACILITIES_LIST_LIMIT, type Facility, type FacilityHealth } from '@/api';
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

// Task 11: a benign default so the 30-odd tests above this point (none of which care about the
// health chip) don't each have to stub it themselves.
const currentHealth: FacilityHealth = {
  reportDimension: { state: 'current', lastSuccessAt: '2026-08-01T10:00:00Z', rows: 42, error: null, jobId: null },
  projection: { failedCount: 0 },
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
    (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listObservedFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue(currentHealth);
    (retryFacilityJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
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
    // Minor 6: the loose /showing the first/i match above would still pass if `{{limit}}` rendered
    // literally instead of interpolating — assert on the actual number so a broken interpolation
    // fails this test.
    expect(screen.getByText(new RegExp(`showing the first ${FACILITIES_LIST_LIMIT} facilities`, 'i'))).toBeInTheDocument();
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

    it('hides Import facilities along with the rest of the header ⋯ menu', async () => {
      (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
      (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
      show();
      await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
      // The whole trigger is gone (asserted above), so there is no menu to open at all — this
      // pins that Import specifically never renders unguarded elsewhere on the page either.
      expect(screen.queryByRole('menuitem', { name: /import facilities/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/^import facilities$/i)).not.toBeInTheDocument();
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

  it('Minor 4: names the cause inline when rows exist but no facility form is published', async () => {
    // Distinct from I5 (which only pins that the TABLE keeps rendering): a lab in this exact state
    // sees Add and the row Edit item both greyed out with nothing else on the page explaining why —
    // this banner is that explanation.
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
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
    (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
    show();
    await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
    expect(screen.queryByText(/entered through a published form targeting the Facilities page/i)).not.toBeInTheDocument();
  });

  it('Minor 7: does not let the truncation banner outlive a later failed reload', async () => {
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    const capped: Facility[] = Array.from({ length: FACILITIES_LIST_LIMIT }, (_, i) => ({
      ...sampleFacility, id: `f${i}`, localCode: `LAB0${i}`, name: `Facility ${i}`,
    }));
    // React 18 StrictMode double-invokes mount effects (no cleanup is returned from the reload
    // effect, so nothing undoes the first call — it just fires twice against the same mounted
    // state). That's the realistic way a SECOND reload lands on this page without adding a retry
    // affordance that's out of scope for this round: the first of the two calls succeeds and hits
    // the cap, the second fails.
    (listFacilities as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(capped)
      .mockRejectedValueOnce(new Error('network blip'));

    render(<React.StrictMode><MemoryRouter><Facilities /></MemoryRouter></React.StrictMode>);

    await waitFor(() => expect(screen.getByText(/network blip/i)).toBeInTheDocument());
    // The failed reload never got to re-measure the row count it's claiming — a stale `true` left
    // over from the earlier successful call would keep the banner up describing data this attempt
    // never saw.
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
  });

  it('F1: a successful apply keeps the Import sheet mounted so its own success confirmation survives the list refresh', async () => {
    // This is the whole point of rendering the real Facilities page (not the sheet standalone, as
    // ImportFacilitiesSheet.test.tsx does): `onImported` calls THIS page's `reload`, and it is that
    // reload — not anything inside the sheet — that used to flip `loading` to true, which the page's
    // own render swaps in a full-page LoadingState that unmounts everything below it, sheet included.
    (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([publishedFacilityForm]);
    (listFacilities as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // initial load
      .mockResolvedValueOnce([sampleFacility]); // background reload triggered by onImported
    (importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        parsed: 3, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 0,
      })
      .mockResolvedValueOnce({
        parsed: 3, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], created: 2, updated: 1, duplicates: 0,
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
      (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
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
      (listFacilities as ReturnType<typeof vi.fn>).mockResolvedValue([sampleFacility]);
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
        projection: { failedCount: 0 },
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
        projection: { failedCount: 0 },
      });
      show();
      expect(await screen.findByText(/updating/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('shows Stale — a state that should never occur in practice, but must be renderable when it does', async () => {
      (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        reportDimension: { state: 'stale', lastSuccessAt: '2026-07-01T10:00:00Z', rows: 10, error: null, jobId: null },
        projection: { failedCount: 0 },
      });
      show();
      expect(await screen.findByText(/stale/i)).toBeInTheDocument();
    });

    it('shows Failed with a Retry action for a manage-capable actor, which re-queues the job and refreshes the chip', async () => {
      (getFacilityHealth as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          reportDimension: { state: 'failed', lastSuccessAt: null, rows: null, error: 'warehouse unreachable', jobId: 'fj-1' },
          projection: { failedCount: 0 },
        })
        .mockResolvedValueOnce({
          reportDimension: { state: 'updating', lastSuccessAt: null, rows: null, error: null, jobId: null },
          projection: { failedCount: 0 },
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
        projection: { failedCount: 0 },
      });
      show();
      expect(await screen.findByText(/failed/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('surfaces a failed projection count as a signal separate from the dimension state', async () => {
      (getFacilityHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
        reportDimension: { state: 'current', lastSuccessAt: '2026-08-01T10:00:00Z', rows: 88, error: null, jobId: null },
        projection: { failedCount: 2 },
      });
      show();
      // A failed projection must not make the dimension itself read as failed.
      expect(await screen.findByText(/current/i)).toBeInTheDocument();
      expect(screen.getByText(/2 facility mappings? .*attention/i)).toBeInTheDocument();
      expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    });
  });
});
