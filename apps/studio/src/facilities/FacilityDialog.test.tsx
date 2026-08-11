import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    createFacility: vi.fn(),
    updateFacility: vi.fn(),
    listPublishedForms: vi.fn(),
    getForm: vi.fn(),
    listFacilityAdminValues: vi.fn(),
    // Task 10: back the read-only provenance panel — authority/version resolved from the
    // register-source list, "last import" from this facility's own history.
    listFacilityImportSources: vi.fn(),
    getFacilityHistory: vi.fn(),
  };
});

import * as api from '@/api';
import type { Facility } from '@/api';
import { FacilityDialog } from './FacilityDialog';

// The form-DEFINITION id (what getForm/listPublishedForms resolve to) is deliberately DIFFERENT
// from the schema's own `id` (its slug) below — that gap is exactly what Minor 4 pins: submitting
// schema.id instead of the definition id returns no fields server-side and 400s every save (see
// fieldsOf() in apps/server/src/facilities-routes.ts).
const FORM_DEFINITION_ID = 'form-def-id-999';
const SCHEMA_SLUG_ID = 'facility-schema-slug';

const facilitySchema = {
  id: SCHEMA_SLUG_ID,
  name: 'Facility',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    { id: 'f-name', displayLabel: 'Name', description: null, fieldType: 'text', apiProperty: 'name', fhirPath: null, required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' } },
    { id: 'f-localCode', displayLabel: 'Local code', description: null, fieldType: 'text', apiProperty: 'localCode', fhirPath: null, required: false, enabled: true, order: 1, cardinality: { min: 0, max: '1' } },
    { id: 'f-phone', displayLabel: 'Phone', description: null, fieldType: 'phone', apiProperty: 'phone', fhirPath: null, required: false, enabled: true, order: 2, cardinality: { min: 0, max: '1' } },
    // Deliberately no apiProperty — this is the exact shape I3 is about. splitFacilityAnswers
    // (packages/db/src/facility-answers.ts) keys such a field's extras entry by field.id.
    { id: 'f-contact', displayLabel: 'Contact person', description: null, fieldType: 'text', fhirPath: null, required: false, enabled: true, order: 3, cardinality: { min: 0, max: '1' } },
  ],
  sections: [],
  targetPages: ['facilities'],
  version: 3,
  active: true,
  status: 'published',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const editFacility: Facility = {
  id: 'fac-1', localCode: 'LAB01', nationalSystem: null, nationalCode: null, name: 'Dodoma RRH',
  level: null, ownership: null, status: null, country: null, zone: null, region: null, district: null,
  council: null, ward: null, village: null, addressText: null, phone: '+255700000000',
  latitude: null, longitude: null, extras: { 'f-contact': 'Jane Doe' }, managedOrigin: null, source: 'manual',
  registerState: 'not_registered',
};

/**
 * Open the ⋯ actions menu and click the item matching `itemName`. Radix opens DropdownMenuContent
 * on pointerdown; jsdom sometimes needs a follow-up Enter keydown for the menu to mount — same
 * pattern as apps/studio/src/users/UserDialog.test.tsx.
 */
function clickMenuItem(itemName: string | RegExp) {
  const trigger = screen.getByRole('button', { name: 'Facility actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: itemName })) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
  fireEvent.click(screen.getByRole('menuitem', { name: itemName }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: FORM_DEFINITION_ID, name: 'Facility', versionLabel: null, status: 'published', active: true, fhirResourceType: null, targetPages: ['facilities'], fieldCount: 4, updatedAt: '2026-01-01T00:00:00Z' },
  ]);
  (api.getForm as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: FORM_DEFINITION_ID, name: 'Facility', versionLabel: null, fhirResourceType: null, status: 'published', active: true,
    schema: facilitySchema, targetPages: ['facilities'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  });
  (api.listFacilityAdminValues as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.listFacilityImportSources as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.getFacilityHistory as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });
});

describe('FacilityDialog', () => {
  it('submits formSchemaId as the form-DEFINITION id, never schema.id (the schema slug)', async () => {
    (api.createFacility as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editFacility, id: 'new-1' });
    render(<FacilityDialog open facility={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'New Facility' } });
    clickMenuItem(/^create$/i);

    await waitFor(() => expect(api.createFacility).toHaveBeenCalled());
    const body = (api.createFacility as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.formSchemaId).toBe(FORM_DEFINITION_ID);
    expect(body.formSchemaId).not.toBe(SCHEMA_SLUG_ID);
  });

  it("surfaces the server's duplicate-local-code message inline and keeps the dialog open", async () => {
    (api.createFacility as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('create facility failed: a facility with that local code (or national code) already exists'),
    );
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<FacilityDialog open facility={null} onOpenChange={onOpenChange} onSaved={onSaved} />);

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Dup Facility' } });
    clickMenuItem(/^create$/i);

    expect(await screen.findByText(/already exists/i)).toBeTruthy();
    // Success is withheld: no onSaved, and the sheet stays open so the operator can see the
    // message and correct the local code.
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('preserves an extras answer for a field with no apiProperty when saving without touching it (I3)', async () => {
    (api.updateFacility as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editFacility });
    render(<FacilityDialog open facility={editFacility} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    // Seeded from extras['f-contact'] even though the field declares no apiProperty at all.
    await waitFor(() => expect(screen.getByLabelText('Contact person')).toHaveValue('Jane Doe'));

    clickMenuItem(/^save$/i);

    await waitFor(() => expect(api.updateFacility).toHaveBeenCalled());
    const body = (api.updateFacility as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.answers['f-contact']).toBe('Jane Doe');
  });

  it('submits an explicit empty value when an operator clears a previously-filled optional field (I2)', async () => {
    (api.updateFacility as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editFacility });
    render(<FacilityDialog open facility={editFacility} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    const phoneInput = await screen.findByLabelText('Phone');
    await waitFor(() => expect(phoneInput).toHaveValue('+255700000000'));
    fireEvent.change(phoneInput, { target: { value: '' } });

    clickMenuItem(/^save$/i);

    await waitFor(() => expect(api.updateFacility).toHaveBeenCalled());
    const body = (api.updateFacility as ReturnType<typeof vi.fn>).mock.calls[0][1];
    // FormRuntime deletes a blanked field's key entirely (see cleanAnswers/setField) — without the
    // dialog restoring an explicit '', this key would be absent and the route's clearedCoreKeys
    // (which requires Object.hasOwn(answers, field.id)) would never see the clear at all.
    expect(body.answers).toHaveProperty('f-phone', '');
  });

  it('does NOT submit an empty value for a seeded field that is currently HIDDEN by a visibility rule (Important 1)', async () => {
    // cleanAnswers (forms-runtime/runtime.ts) drops a field for being hidden, not only for being
    // blanked. Restoring '' for every seeded field regardless of visibility turned an operator never
    // touching a hidden field into an explicit clear on the very first Save — nulling district here,
    // or 400ing if the hidden field were name/localCode/nationalCode instead.
    const schemaWithHiddenField = {
      ...facilitySchema,
      fields: [
        ...facilitySchema.fields,
        {
          id: 'f-district', displayLabel: 'District', description: null, fieldType: 'text',
          apiProperty: 'district', fhirPath: null, required: false, enabled: true, order: 4,
          cardinality: { min: 0, max: '1' },
          // Never satisfied: f-name can never equal this sentinel, so f-district stays hidden
          // throughout the test regardless of what the operator does to other fields.
          visibility: { combinator: 'all', conditions: [{ fieldId: 'f-name', operator: 'equals', value: '__never__' }] },
        },
      ],
    };
    (api.getForm as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: FORM_DEFINITION_ID, name: 'Facility', versionLabel: null, fhirResourceType: null, status: 'published', active: true,
      schema: schemaWithHiddenField, targetPages: ['facilities'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    const facilityWithDistrict: Facility = { ...editFacility, district: 'Kinondoni' };
    (api.updateFacility as ReturnType<typeof vi.fn>).mockResolvedValue(facilityWithDistrict);
    render(<FacilityDialog open facility={facilityWithDistrict} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    // Confirm the field really is hidden (not merely absent from the schema) before saving.
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Dodoma RRH'));
    expect(screen.queryByLabelText('District')).not.toBeInTheDocument();

    clickMenuItem(/^save$/i);

    await waitFor(() => expect(api.updateFacility).toHaveBeenCalled());
    const body = (api.updateFacility as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.answers).not.toHaveProperty('f-district');

    // A VISIBLE, untouched field is unaffected by this — FormRuntime's own cleanAnswers already
    // carries its real value through, confirming the fix narrows the restore loop's blank-'' path
    // rather than disabling field submission generally.
    expect(body.answers).toHaveProperty('f-phone', '+255700000000');
  });

  // ── Task 5: admin-area suggestions (zone/region/district/council) ───────────────────────────

  const schemaWithAdminFields = {
    ...facilitySchema,
    fields: [
      ...facilitySchema.fields,
      { id: 'f-region', displayLabel: 'Region', description: null, fieldType: 'suggest', apiProperty: 'region', fhirPath: null, required: false, enabled: true, order: 4, cardinality: { min: 0, max: '1' } },
      { id: 'f-district', displayLabel: 'District', description: null, fieldType: 'suggest', apiProperty: 'district', fhirPath: null, required: false, enabled: true, order: 5, cardinality: { min: 0, max: '1' } },
    ],
  };

  function renderWithAdminFields(facilityArg: Facility | null = null) {
    (api.getForm as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: FORM_DEFINITION_ID, name: 'Facility', versionLabel: null, fhirResourceType: null, status: 'published', active: true,
      schema: schemaWithAdminFields, targetPages: ['facilities'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    return render(<FacilityDialog open facility={facilityArg} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
  }

  it('a suggest field fetches its options scoped by the parent values currently chosen', async () => {
    (api.listFacilityAdminValues as ReturnType<typeof vi.fn>).mockImplementation((level: string) =>
      Promise.resolve(level === 'district' ? [{ value: 'Kinondoni', count: 3 }] : []),
    );
    renderWithAdminFields();

    fireEvent.change(await screen.findByLabelText('Region'), { target: { value: 'Dar es Salaam' } });

    await waitFor(() =>
      expect(api.listFacilityAdminValues).toHaveBeenCalledWith('district', { region: 'Dar es Salaam' }),
    );

    fireEvent.focus(screen.getByLabelText('District'));
    expect(await screen.findByText('Kinondoni')).toBeInTheDocument();
  });

  it('changing Region refetches District with the new scope', async () => {
    const mock = api.listFacilityAdminValues as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue([]);
    renderWithAdminFields();
    const regionInput = await screen.findByLabelText('Region');

    fireEvent.change(regionInput, { target: { value: 'Dar es Salaam' } });
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith('district', { region: 'Dar es Salaam' }),
    );

    mock.mockClear();
    fireEvent.change(regionInput, { target: { value: 'Dodoma' } });
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith('district', { region: 'Dodoma' }),
    );
  });

  it('a value typed but never suggested is still submitted verbatim', async () => {
    (api.createFacility as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editFacility, id: 'new-2' });
    renderWithAdminFields();

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'New Facility' } });
    fireEvent.change(screen.getByLabelText('District'), { target: { value: 'A Brand New Ward' } });
    clickMenuItem(/^create$/i);

    await waitFor(() => expect(api.createFacility).toHaveBeenCalled());
    const body = (api.createFacility as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.answers['f-district']).toBe('A Brand New Ward');
  });

  it('an edit-mode dialog with all four admin levels populated still offers alternatives for Region (Important 1)', async () => {
    // Every admin level (Zone/Region/District/Council) has a value — the common case, since the
    // shipped form marks Zone/Region/District required. Under the old symmetric scoping, Region's
    // own fetch would have been scoped by District+Council too, collapsing its options down to
    // essentially the one value already in the field.
    const schemaAllFourLevels = {
      ...facilitySchema,
      fields: [
        ...facilitySchema.fields,
        { id: 'f-zone', displayLabel: 'Zone', description: null, fieldType: 'suggest', apiProperty: 'zone', fhirPath: null, required: false, enabled: true, order: 4, cardinality: { min: 0, max: '1' } },
        { id: 'f-region', displayLabel: 'Region', description: null, fieldType: 'suggest', apiProperty: 'region', fhirPath: null, required: false, enabled: true, order: 5, cardinality: { min: 0, max: '1' } },
        { id: 'f-district', displayLabel: 'District', description: null, fieldType: 'suggest', apiProperty: 'district', fhirPath: null, required: false, enabled: true, order: 6, cardinality: { min: 0, max: '1' } },
        { id: 'f-council', displayLabel: 'Council', description: null, fieldType: 'suggest', apiProperty: 'council', fhirPath: null, required: false, enabled: true, order: 7, cardinality: { min: 0, max: '1' } },
      ],
    };
    (api.getForm as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: FORM_DEFINITION_ID, name: 'Facility', versionLabel: null, fhirResourceType: null, status: 'published', active: true,
      schema: schemaAllFourLevels, targetPages: ['facilities'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    (api.listFacilityAdminValues as ReturnType<typeof vi.fn>).mockImplementation((level: string) =>
      Promise.resolve(level === 'region'
        ? [{ value: 'Dodoma', count: 3 }, { value: 'Mwanza', count: 2 }, { value: 'Arusha', count: 1 }]
        : []),
    );
    const fullyPopulatedFacility: Facility = {
      ...editFacility, zone: 'North', region: 'Dodoma', district: 'Dodoma Urban', council: 'Dodoma City',
    };
    render(<FacilityDialog open facility={fullyPopulatedFacility} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText('Region')).toHaveValue('Dodoma'));
    // Proves the SCOPE itself: Region's fetch carries Zone alone, not District/Council too.
    await waitFor(() =>
      expect(api.listFacilityAdminValues).toHaveBeenCalledWith('region', { zone: 'North' }),
    );

    // SuggestCombobox's own listbox filters by the CURRENT typed value (see suggest-combobox.tsx),
    // so with 'Dodoma' still sitting in the field, only 'Dodoma' itself would show — that filtering
    // is unrelated to this hook's scoping bug and would mask it. Clear the field, the way an
    // operator changing Region actually would, to see the full fetched list.
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: '' } });
    fireEvent.focus(screen.getByLabelText('Region'));
    // Alternatives besides the value that was already in the field are present — a symmetric-scope
    // fetch (Region also scoped by District+Council, both already filled in) would have returned
    // nothing useful beyond Dodoma itself.
    expect(await screen.findByText('Mwanza')).toBeInTheDocument();
    expect(screen.getByText('Arusha')).toBeInTheDocument();
    expect(screen.getByText('Dodoma')).toBeInTheDocument();
  });

  it('a suggestions fetch failure degrades to free text rather than blocking the form', async () => {
    (api.listFacilityAdminValues as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('registry unreachable'));
    (api.createFacility as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editFacility, id: 'new-3' });
    renderWithAdminFields();

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'New Facility' } });
    // The operator can keep typing straight through the fetch failure — no disabled/blocked input.
    fireEvent.change(screen.getByLabelText('District'), { target: { value: 'Free Typed District' } });

    await waitFor(() => expect(api.listFacilityAdminValues).toHaveBeenCalled());
    expect(screen.getByLabelText('District')).toHaveValue('Free Typed District');

    clickMenuItem(/^create$/i);
    await waitFor(() => expect(api.createFacility).toHaveBeenCalled());
    const body = (api.createFacility as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.answers['f-district']).toBe('Free Typed District');
  });

  // Task 10: "where a facility came from" — the read-only provenance panel on the edit view.
  describe('Task 10: provenance panel', () => {
    const HFR_SOURCE = {
      id: 'cs-freg-hfr', url: 'HFR', name: 'National Health Facility Registry', code: 'HFR',
      version: '2026-Q3', jurisdiction: 'TZ', contact: null, publisherId: null, active: true,
    };

    it('does not render a provenance panel for a NEW (unsaved) facility', async () => {
      render(<FacilityDialog open facility={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
      await screen.findByLabelText('Name');
      expect(screen.queryByText('Provenance')).not.toBeInTheDocument();
    });

    it('shows the Manual badge for a manually-entered facility, and Imported for an imported one', async () => {
      render(<FacilityDialog open facility={editFacility} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
      expect(await screen.findByText('Provenance')).toBeInTheDocument();
      expect(screen.getByText('Manual entry')).toBeInTheDocument();

      const { unmount } = render(
        <FacilityDialog open facility={{ ...editFacility, source: 'import' }} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
      );
      expect(await screen.findAllByText('Imported')).not.toHaveLength(0);
      unmount();
    });

    it('resolves authority, canonical URI and version from the matching register source', async () => {
      (api.listFacilityImportSources as ReturnType<typeof vi.fn>).mockResolvedValue([HFR_SOURCE]);
      render(
        <FacilityDialog
          open
          facility={{ ...editFacility, nationalSystem: 'HFR', nationalCode: 'NC-001' }}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
      expect(await screen.findByText('National Health Facility Registry')).toBeInTheDocument();
      expect(screen.getByText('HFR')).toBeInTheDocument();
      expect(screen.getByText('2026-Q3')).toBeInTheDocument();
    });

    it('still shows the canonical URI when no active register source matches it (deactivated or unknown)', async () => {
      (api.listFacilityImportSources as ReturnType<typeof vi.fn>).mockResolvedValue([]); // active-only list, none match
      render(
        <FacilityDialog
          open
          facility={{ ...editFacility, nationalSystem: 'urn:tz:legacy-register' }}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
      expect(await screen.findByText('urn:tz:legacy-register')).toBeInTheDocument();
    });

    it("shows 'not linked to a national register' when the facility has no nationalSystem", async () => {
      render(<FacilityDialog open facility={editFacility} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
      expect(await screen.findByText(/not linked to a national register/i)).toBeInTheDocument();
    });

    it('shows the last import time from history when an import has touched this facility', async () => {
      (api.getFacilityHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [
          { occurredAt: '2026-08-05T10:00:00Z', actorName: 'jane', action: 'facility.update', before: {}, after: {} },
          { occurredAt: '2026-08-01T09:00:00Z', actorName: 'facility-import', action: 'facility.import.row', before: {}, after: {} },
        ],
      });
      render(<FacilityDialog open facility={editFacility} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
      expect(await screen.findByText('Last import')).toBeInTheDocument();
      expect(screen.getByText(/2026/)).toBeInTheDocument();
      expect(screen.queryByText('Never imported')).not.toBeInTheDocument();
    });

    it("shows 'never imported' when this facility's history has no import row", async () => {
      (api.getFacilityHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ occurredAt: '2026-08-05T10:00:00Z', actorName: 'jane', action: 'facility.create', before: null, after: {} }],
      });
      render(<FacilityDialog open facility={editFacility} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
      expect(await screen.findByText('Never imported')).toBeInTheDocument();
    });
  });
});
