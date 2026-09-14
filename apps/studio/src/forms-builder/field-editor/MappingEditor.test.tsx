import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormField } from '@openldr/forms/pure';
import { MappingEditor } from './MappingEditor';
import * as truncatedTextModule from '@/components/ui/truncated-text';

const BASE_FIELD: FormField = {
  id: 'f-1',
  displayLabel: 'Patient name',
  fieldType: 'text',
  required: false,
  enabled: true,
  fhirPath: null,
  order: 0,
  cardinality: { min: 0, max: '1' },
  description: null,
};

// SuggestCombobox's <Input value={value}> is fully controlled with no state of its own
// (by design — it is a shared primitive; see suggest-combobox.tsx). A React controlled input
// needs its value prop to move on every keystroke for userEvent.type to accumulate text; a bare
// vi.fn() spy that never feeds a patch back into `field` leaves the DOM value snapping back after
// each character, so only the last keystroke would survive. FieldEditorSheet's patchDraft feeds
// every patch back into the field it renders next, so this harness mirrors exactly that, while
// still recording every call on the onUpdate spy the tests assert against.
function Harness({
  field,
  fhirResourceType,
  surveyMode,
  onUpdate,
}: {
  field: FormField;
  fhirResourceType: string | null;
  surveyMode?: boolean;
  onUpdate: (patch: Partial<FormField>) => void;
}) {
  const [current, setCurrent] = useState(field);
  return (
    <MappingEditor
      field={current}
      fhirResourceType={fhirResourceType}
      surveyMode={surveyMode}
      onUpdate={(patch) => {
        onUpdate(patch);
        setCurrent((f) => ({ ...f, ...patch }));
      }}
    />
  );
}

function renderEditor(overrides: Partial<FormField> = {}, fhirResourceType: string | null = 'Location', surveyMode = false) {
  const onUpdate = vi.fn();
  const field = { ...BASE_FIELD, ...overrides };
  const utils = render(
    <Harness field={field} fhirResourceType={fhirResourceType} surveyMode={surveyMode} onUpdate={onUpdate} />,
  );
  return { ...utils, onUpdate };
}

describe('MappingEditor', () => {
  describe('discriminator editor', () => {
    const slot = { fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system: 'urn:x' } };

    it('shows no criteria until the box is ticked', () => {
      renderEditor();
      expect(screen.queryByText('Match criteria')).toBeNull();
    });

    it('ticking the box writes an empty discriminator and the value field', () => {
      const { onUpdate } = renderEditor();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Array element (discriminator)' }));
      expect(onUpdate).toHaveBeenCalledWith({ fhirDiscriminator: {}, fhirValueField: 'value' });
    });

    it('unticking clears both', () => {
      const { onUpdate } = renderEditor(slot);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Array element (discriminator)' }));
      expect(onUpdate).toHaveBeenCalledWith({ fhirDiscriminator: undefined, fhirValueField: undefined });
    });

    it('shows a stored map as one condition row', () => {
      renderEditor(slot);
      expect((screen.getByRole('textbox', { name: 'Condition 1 element' }) as HTMLInputElement).value).toBe('system');
      expect((screen.getByRole('textbox', { name: 'Condition 1 value' }) as HTMLInputElement).value).toBe('urn:x');
    });

    it('stores a plain equality edit as the old map', () => {
      const { onUpdate } = renderEditor(slot);
      fireEvent.change(screen.getByRole('textbox', { name: 'Condition 1 value' }), { target: { value: 'urn:y' } });
      expect(onUpdate).toHaveBeenLastCalledWith({ fhirDiscriminator: { system: 'urn:y' } });
    });

    it('hides All and Any at one condition and shows them at two', () => {
      renderEditor(slot);
      expect(screen.queryByRole('button', { name: 'Any' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '+ Add condition' }));
      expect(screen.getByRole('button', { name: 'Any' })).toBeTruthy();
    });

    it('choosing Any stores a rule', () => {
      const { onUpdate } = renderEditor({ ...slot, fhirDiscriminator: { system: 'a', use: 'b' } });
      fireEvent.click(screen.getByRole('button', { name: 'Any' }));
      expect(onUpdate).toHaveBeenLastCalledWith({
        fhirDiscriminator: {
          join: 'any',
          conds: [{ el: 'system', op: 'equals', val: 'a' }, { el: 'use', op: 'equals', val: 'b' }],
        },
      });
    });

    it('choosing starts with stores a rule', () => {
      const { onUpdate } = renderEditor(slot);
      fireEvent.click(screen.getByRole('combobox', { name: 'Condition 1 operator' }));
      fireEvent.click(screen.getByText('starts with'));
      expect(onUpdate).toHaveBeenLastCalledWith({
        fhirDiscriminator: { join: 'all', conds: [{ el: 'system', op: 'starts with', val: 'urn:x' }] },
      });
    });

    it('removes a condition', () => {
      const { onUpdate } = renderEditor({ ...slot, fhirDiscriminator: { system: 'a', use: 'b' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove condition' })[1]);
      expect(onUpdate).toHaveBeenLastCalledWith({ fhirDiscriminator: { system: 'a' } });
    });

    it('edits the value field', () => {
      const { onUpdate } = renderEditor(slot);
      fireEvent.change(screen.getByRole('textbox', { name: 'Value Field' }), { target: { value: 'code' } });
      expect(onUpdate).toHaveBeenLastCalledWith({ fhirValueField: 'code' });
    });
  });

  describe('survey mode', () => {
    it('hides FHIR Path, API Property and the discriminator, and keeps Observation Extract', () => {
      renderEditor({}, 'Questionnaire', true);
      expect(screen.queryByText('FHIR Path')).toBeNull();
      expect(screen.queryByRole('textbox', { name: /api property/i })).toBeNull();
      expect(screen.queryByRole('checkbox', { name: 'Array element (discriminator)' })).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'Observation Extract' })).toBeTruthy();
    });
  });

  describe('FHIR path input', () => {
    // The control is now a SuggestCombobox (role="combobox"), not a plain textbox — that is
    // exactly what this task changes. The role in these assertions was updated to match; the
    // behavior under test (shows the value, commits on change, clears to null) is unchanged.
    it('shows the current fhirPath value', () => {
      renderEditor({ fhirPath: 'Patient.name' });
      const input = screen.getByRole('combobox', { name: /fhir path/i });
      expect((input as HTMLInputElement).value).toBe('Patient.name');
    });

    it('calls onUpdate with fhirPath on change', () => {
      const { onUpdate } = renderEditor();
      const input = screen.getByRole('combobox', { name: /fhir path/i });
      fireEvent.change(input, { target: { value: 'Patient.name' } });
      expect(onUpdate).toHaveBeenCalledWith({ fhirPath: 'Patient.name' });
    });

    it('calls onUpdate with null when fhirPath cleared', () => {
      const { onUpdate } = renderEditor({ fhirPath: 'Patient.name' });
      const input = screen.getByRole('combobox', { name: /fhir path/i });
      fireEvent.change(input, { target: { value: '' } });
      expect(onUpdate).toHaveBeenCalledWith({ fhirPath: null });
    });
  });

  describe('apiProperty input', () => {
    it('calls onUpdate with apiProperty on change', () => {
      const { onUpdate } = renderEditor();
      const input = screen.getByRole('textbox', { name: /api property/i });
      fireEvent.change(input, { target: { value: 'patientName' } });
      expect(onUpdate).toHaveBeenCalledWith({ apiProperty: 'patientName' });
    });

    it('calls onUpdate with undefined when apiProperty cleared', () => {
      const { onUpdate } = renderEditor({ apiProperty: 'patientName' });
      const input = screen.getByRole('textbox', { name: /api property/i });
      fireEvent.change(input, { target: { value: '' } });
      expect(onUpdate).toHaveBeenCalledWith({ apiProperty: undefined });
    });
  });

  describe('observationExtract checkbox', () => {
    it('calls onUpdate with observationExtract: true when checked', () => {
      const { onUpdate } = renderEditor({ observationExtract: false });
      const cb = screen.getByRole('checkbox', { name: /observation extract/i });
      fireEvent.click(cb);
      expect(onUpdate).toHaveBeenCalledWith({ observationExtract: true });
    });
  });

  describe('standard binding', () => {
    it('shows the set FHIR binds the path to, and how strongly', () => {
      render(<Harness field={{ ...BASE_FIELD, fhirPath: 'Patient.gender' }} fhirResourceType="Patient" onUpdate={vi.fn()} />);
      expect(screen.getByTestId('fhir-path-binding').textContent).toBe('bound: administrative-gender required');
    });

    it('shows nothing for a path FHIR does not bind', () => {
      render(<Harness field={{ ...BASE_FIELD, fhirPath: 'Patient.name' }} fhirResourceType="Patient" onUpdate={vi.fn()} />);
      expect(screen.queryByTestId('fhir-path-binding')).toBeNull();
    });

    it('no longer has a free-text ValueSet box or a strength select', () => {
      render(<Harness field={BASE_FIELD} fhirResourceType="Patient" onUpdate={vi.fn()} />);
      expect(screen.queryByLabelText('Value Set URL')).toBeNull();
      expect(screen.queryByLabelText('Binding Strength')).toBeNull();
    });
  });

  describe('Advanced section', () => {
    // The advanced section may be inside a collapsible — open it first.
    function openAdvanced() {
      const btn = screen.getByRole('button', { name: /advanced/i });
      fireEvent.click(btn);
    }

    describe('constraints — maxLength', () => {
      it('calls onUpdate merging maxLength into existing constraints', () => {
        const { onUpdate } = renderEditor({ constraints: { min: 1 } });
        openAdvanced();
        const input = screen.getByRole('spinbutton', { name: /max length/i });
        fireEvent.change(input, { target: { value: '255' } });
        expect(onUpdate).toHaveBeenCalledWith({
          constraints: { min: 1, maxLength: 255 },
        });
      });

      it('omits maxLength from constraints when cleared', () => {
        const { onUpdate } = renderEditor({ constraints: { maxLength: 255 } });
        openAdvanced();
        const input = screen.getByRole('spinbutton', { name: /max length/i });
        fireEvent.change(input, { target: { value: '' } });
        expect(onUpdate).toHaveBeenCalledWith({
          constraints: { maxLength: undefined },
        });
      });
    });

    describe('adminNote textarea', () => {
      it('calls onUpdate with adminNote on change', () => {
        const { onUpdate } = renderEditor();
        openAdvanced();
        const textarea = screen.getByRole('textbox', { name: /admin note/i });
        fireEvent.change(textarea, { target: { value: 'Internal note' } });
        expect(onUpdate).toHaveBeenCalledWith({ adminNote: 'Internal note' });
      });

      it('calls onUpdate with undefined when adminNote cleared', () => {
        const { onUpdate } = renderEditor({ adminNote: 'Internal note' });
        openAdvanced();
        const textarea = screen.getByRole('textbox', { name: /admin note/i });
        fireEvent.change(textarea, { target: { value: '' } });
        expect(onUpdate).toHaveBeenCalledWith({ adminNote: undefined });
      });
    });
  });
});

describe('MappingEditor FHIR path picker', () => {
  it('offers the real elements of the form resource type when the operator types', async () => {
    renderEditor();
    const input = screen.getByLabelText('FHIR Path');
    await userEvent.type(input, 'address.dist');
    expect(await screen.findByRole('option', { name: /Location\.address\.district/ })).toBeInTheDocument();
  });

  it('shows the path and the definition as separate text nodes, not joined into one line', async () => {
    // A narrow mobile column cannot fit both on one line (measured 313px needed vs 163px
    // available). Two separate nodes let the definition wrap onto its own line instead of
    // being clipped away with the rest of a single truncated string.
    renderEditor();
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'address.dist');
    const option = await screen.findByRole('option', { name: /Location\.address\.district/ });
    expect(within(option).getByText('Location.address.district')).toBeInTheDocument();
    expect(within(option).getByText('District name (aka county)')).toBeInTheDocument();
  });

  it('finds an element by what it MEANS, not only by its path', async () => {
    // This is the case the whole workstream exists for. Someone thinking "county" must be able
    // to find address.district, whose path never contains that word.
    renderEditor();
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'county');
    expect(await screen.findByRole('option', { name: /Location\.address\.district/ })).toBeInTheDocument();
  });

  it('commits the path alone when an option is picked, not the label', async () => {
    const { onUpdate } = renderEditor();
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'address.dist');
    await userEvent.click(await screen.findByRole('option', { name: /Location\.address\.district/ }));
    expect(onUpdate).toHaveBeenCalledWith({ fhirPath: 'Location.address.district' });
  });

  it('shows the official definition under the input for the current value', () => {
    renderEditor({ fhirPath: 'Location.address.district' });
    expect(screen.getByText('District name (aka county)')).toBeInTheDocument();
  });

  it('shows no definition for a path the table does not know', () => {
    renderEditor({ fhirPath: 'Location.address.zone' });
    expect(screen.queryByTestId('fhir-path-definition')).not.toBeInTheDocument();
  });

  it('still accepts free text, so a gap in the table never blocks anyone', async () => {
    const { onUpdate } = renderEditor();
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'Location.address.zone');
    expect(onUpdate).toHaveBeenLastCalledWith({ fhirPath: 'Location.address.zone' });
  });

  it('clears the path to null when the box is emptied', async () => {
    const { onUpdate } = renderEditor({ fhirPath: 'Location.name' });
    await userEvent.clear(screen.getByLabelText('FHIR Path'));
    expect(onUpdate).toHaveBeenLastCalledWith({ fhirPath: null });
  });

  it('degrades to a plain free-text field for an uncovered resource type', async () => {
    // The builder offers 145 resource types and the table covers 9. An empty picker must not
    // look broken, and must never stop someone typing.
    const { onUpdate } = renderEditor({}, 'Condition');
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'onsetDateTime');
    expect(onUpdate).toHaveBeenLastCalledWith({ fhirPath: 'onsetDateTime' });
  });

  it('degrades the same way when the form declares no resource type at all', async () => {
    const { onUpdate } = renderEditor({}, null);
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'name');
    expect(onUpdate).toHaveBeenLastCalledWith({ fhirPath: 'name' });
  });

  it('clips option labels from the start, so a long path shows its tail', async () => {
    // Location.address.period, .period.end, and .period.start are indistinguishable under
    // end-truncation (`Location.address.per...` for all three). Start-truncation keeps the
    // segment that actually tells them apart.
    //
    // jsdom has no layout and no canvas, so there is no pixel cut to assert here (under
    // jsdom, TruncatedText falls back to rendering the full text either way). What this test
    // can honestly check is that MappingEditor actually asks for start-truncation on this
    // option, by spying on the real TruncatedText component rather than asserting CSS.
    const spy = vi.spyOn(truncatedTextModule, 'TruncatedText');
    renderEditor();
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'address.period');
    const option = await screen.findByRole('option', { name: /Location\.address\.period\.start/ });
    within(option).getByText('Location.address.period.start');
    const reachedStart = spy.mock.calls.some((call) => call[0].truncateFrom === 'start'
      && call[0].text === 'Location.address.period.start');
    expect(reachedStart).toBe(true);
    spy.mockRestore();
  });
});
