import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FormField, FormSchema } from '@openldr/forms/pure';
import { FieldType } from '@openldr/forms/pure';
import * as api from '../api';
import { FieldEditorSheet } from './FieldEditorSheet';

const vsMocks = vi.hoisted(() => ({
  gender: {
    id: 'vs-g', url: 'http://hl7.org/fhir/ValueSet/administrative-gender', name: 'AdministrativeGender',
    title: 'AdministrativeGender', version: null, status: 'active', immutable: true, publisherId: 'pub-hl7-fhir',
    category: null, codeCount: 2, primarySystem: null,
  },
}));

// Keep the real module and override what the editor parts fetch: other editor parts import other
// api calls, and a factory that returned only these would break them.
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listCodingSystems: vi.fn(async () => []),
  codeSuggestions: vi.fn(async () => []),
  listValueSets: vi.fn(async () => [vsMocks.gender]),
  findValueSetByUrl: vi.fn(async (url: string) => (url === vsMocks.gender.url ? vsMocks.gender : null)),
  storedValueSetCodes: vi.fn(async () => [
    { system: 'http://hl7.org/fhir/administrative-gender', code: 'male', display: 'Male' },
    { system: 'http://hl7.org/fhir/administrative-gender', code: 'female', display: 'Female' },
  ]),
}));

const BASE_FIELD: FormField = {
  id: 'f-1',
  displayLabel: 'Patient name',
  fieldType: 'text',
  required: false,
  enabled: true,
  fhirPath: null,
  section: undefined,
  groupId: undefined,
  placeholder: undefined,
  unit: undefined,
  order: 0,
  cardinality: { min: 0, max: '1' },
  description: null,
};

const GROUP_FIELD: FormField = {
  id: 'g-1',
  displayLabel: 'Demographics',
  fieldType: 'group',
  required: false,
  enabled: true,
  fhirPath: null,
  order: 1,
  cardinality: { min: 0, max: '1' },
  description: null,
};

const SECTIONS: FormSchema['sections'] = [
  { id: 'main', label: 'Main', order: 0 },
];

function renderSheet(
  overrides: Partial<Parameters<typeof FieldEditorSheet>[0]> = {},
) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <FieldEditorSheet
      field={BASE_FIELD}
      allFields={[BASE_FIELD, GROUP_FIELD]}
      sections={SECTIONS}
      fhirResourceType="Location"
      open={true}
      onSave={onSave}
      onCancel={onCancel}
      onOpenChange={onOpenChange}
      {...overrides}
    />,
  );
  return { ...utils, onSave, onCancel, onOpenChange };
}

describe('FieldEditorSheet', () => {
  it('asks for suggested codes with the resolved path and the form id', async () => {
    renderSheet({ field: { ...BASE_FIELD, fhirPath: 'name' }, formId: 'form-1' });
    await waitFor(() => expect(vi.mocked(api.codeSuggestions)).toHaveBeenCalledWith({
      fhirPath: 'Location.name', valueSetUrl: null, formId: 'form-1',
    }));
  });

  describe('block order', () => {
    const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

    it('puts Mapping above Codes', () => {
      renderSheet();
      expect(headings()).toEqual(['General', 'Mapping', 'Codes', 'Translations', 'Visibility']);
    });

    it('gives a reference field its own Reference Configuration block after General', () => {
      renderSheet({ field: { ...BASE_FIELD, fieldType: 'reference' } });
      expect(headings()).toEqual(['General', 'Reference Configuration', 'Mapping', 'Codes', 'Translations', 'Visibility']);
    });
  });

  describe('Parts block', () => {
    const PART: FormField = { ...BASE_FIELD, id: 'p-1', displayLabel: 'City', groupId: 'g-1', fhirPath: 'Location.address.city', order: 2 };

    it('lists a group parts', () => {
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD, PART] });
      expect(screen.getByRole('button', { name: /City/ })).toBeTruthy();
    });

    it('says when a group has no parts', () => {
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD] });
      expect(screen.getByText('No parts yet.')).toBeTruthy();
    });

    it('opens a part and hands over the group draft, unsaved edits included', () => {
      const onOpenField = vi.fn();
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD, PART], onOpenField });
      fireEvent.change(screen.getByRole('textbox', { name: 'Display Label' }), { target: { value: 'Address block' } });
      fireEvent.click(screen.getByRole('button', { name: /City/ }));
      expect(onOpenField).toHaveBeenCalledWith('p-1', expect.objectContaining({ id: 'g-1', displayLabel: 'Address block' }));
    });

    it('adds a part with the group draft', () => {
      const onAddPart = vi.fn();
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD], onAddPart });
      fireEvent.click(screen.getByRole('button', { name: '+ Add a part' }));
      expect(onAddPart).toHaveBeenCalledWith(expect.objectContaining({ id: 'g-1' }));
    });

    it('sits after Mapping', () => {
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD] });
      const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
      expect(headings.indexOf('Parts')).toBe(headings.indexOf('Mapping') + 1);
    });
  });

  it('hides the mapping controls on a survey form', () => {
    renderSheet({ fhirResourceType: 'Questionnaire' });
    expect(screen.queryByText('FHIR Path')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Observation Extract' })).toBeTruthy();
  });

  describe('header', () => {
    it('shows "Edit Field" as the sheet title', () => {
      renderSheet();
      expect(screen.getByText('Edit Field')).toBeTruthy();
    });

    it('shows the field displayLabel as subtitle', () => {
      renderSheet();
      expect(screen.getByText('Patient name')).toBeTruthy();
    });

    it('has a ⋯ (Field actions) menu trigger', () => {
      renderSheet();
      expect(screen.getByRole('button', { name: 'Field actions' })).toBeTruthy();
    });
  });

  describe('null field', () => {
    it('renders nothing when field is null', () => {
      renderSheet({ field: null });
      expect(screen.queryByText('Edit Field')).toBeNull();
    });
  });

  describe('draft editing — does NOT call onSave immediately', () => {
    it('shows the current displayLabel value', () => {
      renderSheet();
      const input = screen.getByRole('textbox', { name: /display label/i });
      expect((input as HTMLInputElement).value).toBe('Patient name');
    });

    it('editing Display Label updates the draft but does NOT call onSave', () => {
      const { onSave } = renderSheet();
      const input = screen.getByRole('textbox', { name: /display label/i });
      fireEvent.change(input, { target: { value: 'Full Name' } });
      // onSave must NOT have been called yet
      expect(onSave).not.toHaveBeenCalled();
      // The input reflects the draft value
      expect((input as HTMLInputElement).value).toBe('Full Name');
    });
  });

  describe('⋯ menu — Save', () => {
    it('clicking ⋯ → Save calls onSave with the current draft (including edits)', () => {
      const { onSave } = renderSheet();
      // Edit display label in draft
      const input = screen.getByRole('textbox', { name: /display label/i });
      fireEvent.change(input, { target: { value: 'Full Name' } });

      // Open the ⋯ menu
      const trigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Save')) {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      }
      fireEvent.click(screen.getByText('Save'));

      expect(onSave).toHaveBeenCalledOnce();
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ displayLabel: 'Full Name' }),
      );
    });

    it('⋯ → Save with no edits calls onSave with the original field', () => {
      const { onSave } = renderSheet();
      const trigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Save')) {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      }
      fireEvent.click(screen.getByText('Save'));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'f-1', displayLabel: 'Patient name' }),
      );
    });
  });

  describe('⋯ menu — Cancel', () => {
    it('clicking ⋯ → Cancel calls onCancel', () => {
      const { onCancel } = renderSheet();
      const trigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Cancel')) {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      }
      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe('sheet close button calls onCancel', () => {
    it('clicking the X/Close button calls onCancel (not onSave)', () => {
      const { onSave, onCancel } = renderSheet();
      const closeBtn = screen.getByText('Close').closest('button') as HTMLElement;
      fireEvent.click(closeBtn);
      expect(onCancel).toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('draft reset when field prop changes', () => {
    it('rerendering with a different field resets the shown display label', () => {
      const { rerender } = renderSheet();
      // Initially shows BASE_FIELD label
      expect((screen.getByRole('textbox', { name: /display label/i }) as HTMLInputElement).value).toBe('Patient name');

      // Rerender with a different field
      const OTHER_FIELD: FormField = { ...BASE_FIELD, id: 'f-2', displayLabel: 'Sample ID' };
      rerender(
        <FieldEditorSheet
          field={OTHER_FIELD}
          allFields={[OTHER_FIELD, GROUP_FIELD]}
          sections={SECTIONS}
          fhirResourceType="Location"
          open={true}
          onSave={vi.fn()}
          onCancel={vi.fn()}
          onOpenChange={vi.fn()}
        />,
      );
      expect((screen.getByRole('textbox', { name: /display label/i }) as HTMLInputElement).value).toBe('Sample ID');
    });
  });

  describe('Field Type Select', () => {
    it('changing to "number" updates the draft (does not call onSave)', () => {
      const { onSave } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /field type/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('number'));
      expect(onSave).not.toHaveBeenCalled();
    });

    it('offers every FieldType enum member as an option — no drift', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /field type/i });
      fireEvent.click(trigger);
      const optionValues = screen.getAllByRole('option').map((el) => el.textContent);
      expect(optionValues).toEqual(expect.arrayContaining([...FieldType.options]));
      expect(optionValues).toHaveLength(FieldType.options.length);
    });
  });

  describe('Section Select', () => {
    it('has a "No section" option', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      expect(screen.getAllByText('No section').length).toBeGreaterThan(0);
    });

    it('lists section labels as options', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      expect(screen.getByText('Main')).toBeTruthy();
    });

    it('choosing a section updates the draft without calling onSave', () => {
      const { onSave } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('Main'));
      expect(onSave).not.toHaveBeenCalled();
    });

    it('choosing a section, then Save, emits the section id in the saved field', () => {
      const { onSave } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('Main'));

      const menuTrigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Save')) fireEvent.keyDown(menuTrigger, { key: 'Enter' });
      fireEvent.click(screen.getByText('Save'));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ section: 'main' }));
    });
  });

  describe('Group Select', () => {
    it('has a "No group" option', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /group/i });
      fireEvent.click(trigger);
      expect(screen.getAllByText('No group').length).toBeGreaterThan(0);
    });

    it('lists group-type fields as options', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /group/i });
      fireEvent.click(trigger);
      expect(screen.getByText('Demographics')).toBeTruthy();
    });

    it('choosing a group field updates the draft (does not call onSave)', () => {
      const { onSave } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /group/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('Demographics'));
      expect(onSave).not.toHaveBeenCalled();
    });

    it('shows the Group picker on a group, so a group can go inside another', () => {
      const other: FormField = { ...GROUP_FIELD, id: 'g-2', displayLabel: 'Visit', order: 2 };
      renderSheet({ field: GROUP_FIELD, allFields: [BASE_FIELD, GROUP_FIELD, other] });
      fireEvent.click(screen.getByRole('combobox', { name: /group/i }));
      expect(screen.getByRole('option', { name: 'Visit' })).toBeTruthy();
    });

    it('never offers a group itself or anything inside it', () => {
      const child: FormField = { ...GROUP_FIELD, id: 'g-child', displayLabel: 'Inner', order: 2, groupId: 'g-1' };
      const other: FormField = { ...GROUP_FIELD, id: 'g-2', displayLabel: 'Visit', order: 3 };
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD, child, other] });
      fireEvent.click(screen.getByRole('combobox', { name: /group/i }));
      expect(screen.queryByRole('option', { name: 'Inner' })).toBeNull();
      expect(screen.queryByRole('option', { name: 'Demographics' })).toBeNull();
      expect(screen.getByRole('option', { name: 'Visit' })).toBeTruthy();
    });

    it('notes a group that holds a single instance', () => {
      renderSheet({ field: { ...GROUP_FIELD, maxItems: 1 } });
      expect(screen.getByText('This group holds a single instance, so data entry shows no add control.')).toBeTruthy();
    });

    it('has no single-instance note on a group that holds many', () => {
      renderSheet({ field: GROUP_FIELD });
      expect(screen.queryByText(/holds a single instance/)).toBeNull();
    });
  });

  describe('Placeholder input', () => {
    it('updates the draft but does not call onSave', () => {
      const { onSave } = renderSheet();
      const input = screen.getByRole('textbox', { name: /placeholder/i });
      fireEvent.change(input, { target: { value: 'Enter name' } });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Unit input', () => {
    it('updates the draft but does not call onSave', () => {
      const { onSave } = renderSheet();
      const input = screen.getByRole('textbox', { name: /unit/i });
      fireEvent.change(input, { target: { value: 'mg/dL' } });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Required checkbox', () => {
    it('reflects the current required state', () => {
      renderSheet();
      const cb = screen.getByRole('checkbox', { name: /required/i });
      expect((cb as HTMLInputElement).getAttribute('data-state')).toBe('unchecked');
    });

    it('toggling Required updates the draft (does not call onSave)', () => {
      const { onSave } = renderSheet();
      const cb = screen.getByRole('checkbox', { name: /required/i });
      fireEvent.click(cb);
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Enabled checkbox', () => {
    it('reflects the current enabled state (checked)', () => {
      renderSheet();
      const cb = screen.getByRole('checkbox', { name: /enabled/i });
      expect((cb as HTMLInputElement).getAttribute('data-state')).toBe('checked');
    });

    it('toggling Enabled updates the draft and Save emits enabled: false', () => {
      const { onSave } = renderSheet();
      const cb = screen.getByRole('checkbox', { name: /enabled/i });
      fireEvent.click(cb);
      expect(onSave).not.toHaveBeenCalled();

      const menuTrigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Save')) fireEvent.keyDown(menuTrigger, { key: 'Enter' });
      fireEvent.click(screen.getByText('Save'));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });
  });

  it('never offers the field itself as a visibility condition', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    fireEvent.click(screen.getByRole('combobox', { name: /controlling field/i }));
    expect(screen.queryAllByRole('option', { name: 'Patient name' })).toHaveLength(0);
    expect(screen.getAllByRole('option', { name: 'Demographics' }).length).toBeGreaterThan(0);
  });

  describe('auto-bind', () => {
    beforeEach(() => vi.mocked(api.findValueSetByUrl).mockClear());

    function saveDraft() {
      const trigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Save')) fireEvent.keyDown(trigger, { key: 'Enter' });
      fireEvent.click(screen.getByText('Save'));
    }

    it('picking a required-bound path makes the field a select over the held set', async () => {
      const { onSave } = renderSheet({ fhirResourceType: 'Patient' });
      fireEvent.change(screen.getByLabelText('FHIR Path'), { target: { value: 'Patient.gender' } });
      expect(await screen.findByDisplayValue('male')).toBeTruthy();
      saveDraft();
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        fieldType: 'select', valueSetUrl: vsMocks.gender.url, bindingStrength: 'required', allowCustomValue: false,
      }));
    });

    it('leaves an example-bound path to the author', async () => {
      renderSheet({ fhirResourceType: 'ServiceRequest' });
      fireEvent.change(screen.getByLabelText('FHIR Path'), { target: { value: 'ServiceRequest.code' } });
      await waitFor(() => expect(screen.getByLabelText('FHIR Path')).toHaveValue('ServiceRequest.code'));
      expect(api.findValueSetByUrl).not.toHaveBeenCalled();
    });

    it('leaves a field that names a reference source alone', async () => {
      renderSheet({ fhirResourceType: 'Patient', field: { ...BASE_FIELD, fieldType: 'reference', referenceTarget: 'http://loinc.org' } });
      fireEvent.change(screen.getByLabelText('FHIR Path'), { target: { value: 'Patient.gender' } });
      await waitFor(() => expect(screen.getByLabelText('FHIR Path')).toHaveValue('Patient.gender'));
      expect(api.findValueSetByUrl).not.toHaveBeenCalled();
    });
  });
});
