import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Same shape ReferencePicker.test.tsx already uses — one idiom in this folder, not two. FormRuntime
// itself now calls these to resolve seeded reference answers on load.
vi.mock('@/api', () => ({
  referenceSearch: vi.fn(),
  referenceSearchPreview: vi.fn(),
}));
import { referenceSearch, referenceSearchPreview } from '@/api';
import { FormRuntime } from './FormRuntime';
import type { FormSchema } from './types';

beforeEach(() => {
  vi.mocked(referenceSearch).mockReset();
  vi.mocked(referenceSearchPreview).mockReset();
});

// New flat-model schema: required text field, a boolean, and a conditional text field.
const schema: FormSchema = {
  id: 'f1',
  name: 'Test form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'patientId',
      fhirPath: null,
      displayLabel: 'Patient ID',
      description: null,
      fieldType: 'text',
      required: true,
      enabled: true,
      order: 1,
      cardinality: { min: 1, max: '1' },
    },
    {
      id: 'addNotes',
      fhirPath: null,
      displayLabel: 'Add notes?',
      description: null,
      fieldType: 'boolean',
      required: false,
      enabled: true,
      order: 2,
      cardinality: { min: 0, max: '1' },
    },
    {
      id: 'notes',
      fhirPath: null,
      displayLabel: 'Notes',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 3,
      cardinality: { min: 0, max: '1' },
      // Only visible when addNotes === 'true'
      visibility: {
        combinator: 'all',
        conditions: [{ fieldId: 'addNotes', operator: 'equals', value: 'true' }],
      },
    },
  ],
  sections: [],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Minimal schema for preview-hook tests
const previewSchema: FormSchema = {
  id: 'p1',
  name: 'Preview form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'name',
      fhirPath: null,
      displayLabel: 'Name',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 1,
      cardinality: { min: 0, max: '1' },
    },
  ],
  sections: [],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Schema with a required field and a field with description for indicator tests
const indicatorSchema: FormSchema = {
  id: 'ind1',
  name: 'Indicator form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'req-field',
      fhirPath: null,
      displayLabel: 'Required Field',
      description: null,
      fieldType: 'text',
      required: true,
      enabled: true,
      order: 1,
      cardinality: { min: 1, max: '1' },
    },
    {
      id: 'desc-field',
      fhirPath: null,
      displayLabel: 'Described Field',
      description: 'Enter the patient age in years',
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 2,
      cardinality: { min: 0, max: '1' },
    },
  ],
  sections: [],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Schema with two sections for grouping tests.
const sectionedSchema: FormSchema = {
  id: 'sectioned',
  name: 'Sectioned form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'fname',
      fhirPath: null,
      displayLabel: 'First name',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 1,
      section: 'main',
      cardinality: { min: 0, max: '1' },
    },
    {
      id: 'testType',
      fhirPath: null,
      displayLabel: 'Test type',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 2,
      section: 'extra',
      cardinality: { min: 0, max: '1' },
    },
  ],
  sections: [
    { id: 'main', label: 'Patient', order: 0 },
    { id: 'extra', label: 'Order Details', order: 1 },
  ],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('FormRuntime', () => {
  it('required validation blocks submit and shows error', async () => {
    const onSubmit = vi.fn();
    render(<FormRuntime schema={schema} submitLabel="Submit" onSubmit={onSubmit} />);
    // Patient ID is rendered
    expect(screen.getByLabelText('Patient ID')).toBeInTheDocument();
    // Notes is hidden (visibility not satisfied)
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();

    // Submit without filling required field
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('field patientId is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('toggling boolean reveals conditional field', async () => {
    const onSubmit = vi.fn();
    render(<FormRuntime schema={schema} submitLabel="Submit" onSubmit={onSubmit} />);

    // Notes hidden initially
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();

    // Toggle the boolean checkbox
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add notes?' }));
    // Notes should now be visible
    expect(await screen.findByLabelText('Notes')).toBeInTheDocument();
  });

  it('complete submit calls onSubmit with answers keyed by field id', async () => {
    const onSubmit = vi.fn();
    render(<FormRuntime schema={schema} submitLabel="Submit" onSubmit={onSubmit} />);

    // Fill Patient ID
    fireEvent.change(screen.getByLabelText('Patient ID'), { target: { value: 'P-001' } });
    // Toggle boolean to reveal Notes
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add notes?' }));
    // Fill Notes
    fireEvent.change(await screen.findByLabelText('Notes'), { target: { value: 'Some note' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'P-001', addNotes: true, notes: 'Some note' }),
    );
  });

  it('initialAnswers pre-fills the field input', () => {
    render(
      <FormRuntime
        schema={previewSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
        initialAnswers={{ name: 'Seed' }}
      />,
    );
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('Seed');
  });

  it('required field shows a "Required" indicator with aria-label', () => {
    render(
      <FormRuntime
        schema={indicatorSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // The "!" span has aria-label="Required"
    const marker = screen.getByLabelText('Required');
    expect(marker).toBeTruthy();
    expect(marker.textContent).toBe('!');
  });

  it('field with description shows a "?" help indicator with aria-label = description', () => {
    render(
      <FormRuntime
        schema={indicatorSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // The "?" span has aria-label equal to the description text
    const marker = screen.getByLabelText('Enter the patient age in years');
    expect(marker).toBeTruthy();
    expect(marker.textContent).toBe('?');
  });

  it('required field does NOT show a "?" help indicator when description is null', () => {
    render(
      <FormRuntime
        schema={indicatorSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // req-field has no description — only "!" should appear for it, not "?"
    // Confirm only one "?" in total (for desc-field)
    const questionMarkers = screen.getAllByText('?');
    expect(questionMarkers).toHaveLength(1);
  });

  // ── Section grouping ─────────────────────────────────────────────────────────

  it('renders section headers when schema has sections', () => {
    render(
      <FormRuntime
        schema={sectionedSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // Both section labels must appear as headers
    expect(screen.getByText('Patient')).toBeTruthy();
    expect(screen.getByText('Order Details')).toBeTruthy();
  });

  it('renders fields under correct section headers', () => {
    render(
      <FormRuntime
        schema={sectionedSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // Field labels are still in the document
    expect(screen.getByLabelText('First name')).toBeTruthy();
    expect(screen.getByLabelText('Test type')).toBeTruthy();
    // Section headers appear before their fields in DOM order
    const patientHeader = screen.getByText('Patient');
    const firstNameInput = screen.getByLabelText('First name');
    expect(
      patientHeader.compareDocumentPosition(firstNameInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const orderHeader = screen.getByText('Order Details');
    const testTypeInput = screen.getByLabelText('Test type');
    expect(
      orderHeader.compareDocumentPosition(testTypeInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders fields as flat list with no section headers when schema has no sections', () => {
    render(
      <FormRuntime
        schema={previewSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // Field appears
    expect(screen.getByLabelText('Name')).toBeTruthy();
    // No section header elements
    expect(screen.queryByText('Patient')).toBeNull();
    expect(screen.queryByText('Order Details')).toBeNull();
  });

  // ── formId prop ──────────────────────────────────────────────────────────────

  it('sets the form element id when formId prop is provided', () => {
    const { container } = render(
      <FormRuntime
        schema={previewSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
        formId="test-form-id"
      />,
    );
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    expect(form?.id).toBe('test-form-id');
  });

  it('does not set form id when formId prop is absent', () => {
    const { container } = render(
      <FormRuntime
        schema={previewSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    expect(form?.id).toBe('');
  });

  // ── multiselect: cleanAnswers preserves all selected values ─────────────────

  it('non-repeatable multiselect submits ALL selected values (not just first)', async () => {
    const onSubmit = vi.fn();
    const multiselectSchema: FormSchema = {
      ...previewSchema,
      id: 'ms1',
      fields: [
        {
          id: 'roles',
          fhirPath: null,
          displayLabel: 'Roles',
          description: null,
          fieldType: 'multiselect',
          required: false,
          enabled: true,
          order: 1,
          cardinality: { min: 0, max: '*' },
          valueSetOptions: [
            { code: 'lab_admin', display: 'Lab Admin' },
            { code: 'lab_manager', display: 'Lab Manager' },
            { code: 'lab_technician', display: 'Lab Technician' },
          ],
        },
      ],
    };
    render(
      <FormRuntime
        schema={multiselectSchema}
        submitLabel="Submit"
        onSubmit={onSubmit}
        initialAnswers={{ roles: ['lab_admin', 'lab_manager'] }}
      />,
    );
    // Submit with two roles pre-seeded via initialAnswers
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(Array.isArray(submitted['roles'])).toBe(true);
    expect((submitted['roles'] as string[]).length).toBe(2);
    expect(submitted['roles']).toEqual(expect.arrayContaining(['lab_admin', 'lab_manager']));
  });

  // ── Select full-width ────────────────────────────────────────────────────────

  it('renders a select field trigger', () => {
    const selectSchema: FormSchema = {
      ...previewSchema,
      id: 'sel1',
      fields: [
        {
          id: 'color',
          fhirPath: null,
          displayLabel: 'Color',
          description: null,
          fieldType: 'select',
          required: false,
          enabled: true,
          order: 1,
          cardinality: { min: 0, max: '1' },
          valueSetOptions: [
            { code: 'red', display: 'Red' },
            { code: 'blue', display: 'Blue' },
          ],
        },
      ],
    };
    render(
      <FormRuntime
        schema={selectSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // The select trigger should be present (aria-label matches field label)
    expect(screen.getByRole('combobox', { name: 'Color' })).toBeInTheDocument();
  });

  // ── suggest field type ───────────────────────────────────────────────────────

  function suggestSchema(): FormSchema {
    return {
      ...previewSchema,
      id: 'sug1',
      fields: [
        {
          id: 'district',
          fhirPath: null,
          displayLabel: 'District',
          description: null,
          fieldType: 'suggest',
          required: false,
          enabled: true,
          order: 1,
          cardinality: { min: 0, max: '1' },
        },
      ],
    };
  }

  it('renders a suggest field as a combobox', () => {
    render(<FormRuntime schema={suggestSchema()} submitLabel="" footer={null} onSubmit={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'District' })).toBeInTheDocument();
  });

  it('suggest field: typing filters the suggestion list', () => {
    render(
      <FormRuntime
        schema={suggestSchema()}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
        initialAnswers={{ district: 'ki' }}
        fieldSuggestions={{ district: { status: 'ready', options: ['Kampala', 'Kigali', 'Kisumu'] } }}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'District' });
    fireEvent.focus(input);
    expect(screen.getByText('Kigali')).toBeInTheDocument();
    expect(screen.getByText('Kisumu')).toBeInTheDocument();
    expect(screen.queryByText('Kampala')).not.toBeInTheDocument();
  });

  it('suggest field: picking a suggestion sets the answer to that plain string and submits it', async () => {
    const onSubmit = vi.fn();
    render(
      <FormRuntime
        schema={suggestSchema()}
        submitLabel="Submit"
        onSubmit={onSubmit}
        fieldSuggestions={{ district: { status: 'ready', options: ['Kampala', 'Kigali'] } }}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox', { name: 'District' }));
    fireEvent.click(screen.getByText('Kigali'));

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ district: 'Kigali' }));
  });

  it('suggest field: typing a value not in the list is accepted and submitted verbatim', async () => {
    const onSubmit = vi.fn();
    render(
      <FormRuntime
        schema={suggestSchema()}
        submitLabel="Submit"
        onSubmit={onSubmit}
        fieldSuggestions={{ district: { status: 'ready', options: ['Kampala', 'Kigali'] } }}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'District' }), { target: { value: 'A Brand New Ward' } });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ district: 'A Brand New Ward' }));
  });

  it('suggest field: an empty suggestion list still allows free typing and shows "no suggestions", distinct from loading', () => {
    const onSubmit = vi.fn();
    render(
      <FormRuntime
        schema={suggestSchema()}
        submitLabel="Submit"
        onSubmit={onSubmit}
        fieldSuggestions={{ district: { status: 'ready', options: [] } }}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'District' });
    fireEvent.focus(input);
    expect(screen.getByText(/no suggestions/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Freehand Value' } });
    expect((input as HTMLInputElement).value).toBe('Freehand Value');
  });

  it('suggest field: a loading state is shown distinctly from "no suggestions"', () => {
    render(
      <FormRuntime
        schema={suggestSchema()}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
        fieldSuggestions={{ district: { status: 'loading', options: [] } }}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox', { name: 'District' }));
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/no suggestions/i)).not.toBeInTheDocument();
  });

  it('suggest field: no fieldSuggestions prop at all still renders and allows free typing', () => {
    render(<FormRuntime schema={suggestSchema()} submitLabel="" footer={null} onSubmit={() => {}} />);
    const input = screen.getByRole('combobox', { name: 'District' });
    fireEvent.change(input, { target: { value: 'Typed freely' } });
    expect((input as HTMLInputElement).value).toBe('Typed freely');
  });

  // ── onAnswersChange ──────────────────────────────────────────────────────────
  // FormRuntime keeps `answers` as private state (see the `useState` at the top of the
  // component) — a caller like FacilityDialog needs the live, currently-typed values to build
  // the scope for cascading `suggest` field suggestions (a parent field's value determines a
  // child field's fetch), but has no other way to observe them. `onAnswersChange` is a plain
  // read-only reporting callback: FormRuntime still owns the state and still never fetches
  // anything itself (see the `fieldSuggestions` doc comment above) — this only notifies.

  it('onAnswersChange fires once on mount with the initial answers', () => {
    const onAnswersChange = vi.fn();
    render(
      <FormRuntime
        schema={previewSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
        initialAnswers={{ name: 'Seed' }}
        onAnswersChange={onAnswersChange}
      />,
    );
    expect(onAnswersChange).toHaveBeenCalledWith({ name: 'Seed' });
  });

  it('onAnswersChange fires again whenever a field value changes', () => {
    const onAnswersChange = vi.fn();
    render(
      <FormRuntime
        schema={previewSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
        onAnswersChange={onAnswersChange}
      />,
    );
    onAnswersChange.mockClear();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Typed' } });
    expect(onAnswersChange).toHaveBeenCalledWith({ name: 'Typed' });
  });

  it('omitting onAnswersChange is safe — no crash, form still usable', () => {
    render(<FormRuntime schema={previewSchema} submitLabel="" footer={null} onSubmit={() => {}} />);
    const input = screen.getByLabelText('Name');
    fireEvent.change(input, { target: { value: 'No listener' } });
    expect((input as HTMLInputElement).value).toBe('No listener');
  });
});

describe('seeded reference answers are resolved before validation sees them', () => {
  const refSchema = {
    id: 's', name: 'S', sections: [], version: 1,
    versionLabel: null, fhirVersion: null, fhirResourceType: null, fhirProfileUrl: null, facilityId: null,
    fields: [{
      id: 'level', fhirPath: null, description: null, displayLabel: 'Level',
      fieldType: 'reference', required: true, enabled: true, order: 0,
      cardinality: { min: 1, max: '1' }, valueSetUrl: 'urn:openldr:valueset:facility-type',
    }],
  } as never as FormSchema;

  const codingResult = {
    kind: 'coding' as const,
    total: 1,
    rows: [{ system: 'urn:openldr:cs:facility-type', code: 'health-center', display: 'Health Center' }],
  };

  it('submits a facility seeded with a stored DISPLAY, instead of blocking on it', async () => {
    // The defect: the sheet seeds 'Health Center' (a string), `validate` demands {system, code},
    // and Save silently does nothing. Measured on a live install before this fix.
    const onSubmit = vi.fn();
    vi.mocked(referenceSearch).mockResolvedValue(codingResult);

    render(<FormRuntime schema={refSchema} formDefinitionId="form-1" initialAnswers={{ level: 'Health Center' }} onSubmit={onSubmit} submitLabel="Save" />);
    await waitFor(() => expect(vi.mocked(referenceSearch)).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].level).toEqual({
      system: 'urn:openldr:cs:facility-type', code: 'health-center', display: 'Health Center',
    });
  });

  it('submits an UNRESOLVABLE seeded value untouched, instead of demanding the operator re-pick it', async () => {
    // 'Health Centre' is what the Zambia register writes, and it is genuinely not in the value set —
    // the importer writes an unmapped value through deliberately, and mapping is optional. Blocking
    // here made 3788 of 3788 imported rows uneditable: renaming one demanded first re-picking a
    // level the operator never entered. The raw value must survive the round trip untouched.
    const onSubmit = vi.fn();
    vi.mocked(referenceSearch).mockResolvedValue(codingResult);

    render(<FormRuntime schema={refSchema} formDefinitionId="form-1" initialAnswers={{ level: 'Health Centre' }} onSubmit={onSubmit} submitLabel="Save" />);
    await waitFor(() => expect(vi.mocked(referenceSearch)).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].level).toBe('Health Centre');
  });

  it('still blocks a required reference field left EMPTY — the exemption is for seeded values only', async () => {
    const onSubmit = vi.fn();
    render(<FormRuntime schema={refSchema} formDefinitionId="form-1" initialAnswers={{}} onSubmit={onSubmit} submitLabel="Save" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('field level is required')).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a failed lookup degrades to today's behaviour rather than blanking the field", async () => {
    vi.mocked(referenceSearch).mockRejectedValue(new Error('network'));
    render(<FormRuntime schema={refSchema} formDefinitionId="form-1" initialAnswers={{ level: 'Health Center' }} onSubmit={vi.fn()} submitLabel="Save" />);
    await waitFor(() => expect(vi.mocked(referenceSearch)).toHaveBeenCalled());
    // The value is still displayed — a lookup failure must never eat the operator's data.
    // Rendered as a selected chip, not an input value: ReferencePicker shows a selected reference in
    // a div and falls back to the value's own string form when it is not a coding object.
    expect(screen.getByText('Health Center')).toBeInTheDocument();
  });

  it('does not search when there is no form id to scope the search to', async () => {
    render(<FormRuntime schema={refSchema} initialAnswers={{ level: 'Health Center' }} onSubmit={vi.fn()} submitLabel="Save" />);
    await new Promise((r) => { setTimeout(r, 50); });
    expect(vi.mocked(referenceSearch)).not.toHaveBeenCalled();
  });
});
