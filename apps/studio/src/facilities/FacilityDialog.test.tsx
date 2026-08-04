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
});
