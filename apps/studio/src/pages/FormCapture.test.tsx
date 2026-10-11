import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FormCapture } from './FormCapture';
import * as api from '../api';
import '@/i18n';

// New-model FormDefinition: schema is a flat FormSchema
const form: api.FormDefinition = {
  id: 'form-1',
  name: 'Specimen intake',
  versionLabel: 'v1',
  fhirResourceType: 'ServiceRequest',
  status: 'draft',
  active: true,
  targetPages: ['forms'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  schema: {
    id: 'specimen-intake',
    name: 'Specimen intake',
    versionLabel: null,
    fhirVersion: null,
    fhirResourceType: 'ServiceRequest',
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
        id: 'hasNotes',
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
        visibility: {
          combinator: 'all' as const,
          conditions: [{ fieldId: 'hasNotes', operator: 'equals' as const, value: 'true' }],
        },
      },
    ],
    sections: [],
    targetPages: ['forms'],
    languages: ['en'],
    version: 1,
    active: true,
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
};

// Same form, but published — submission is only enabled for published forms.
const publishedForm: api.FormDefinition = { ...form, status: 'published' };

// A published form carrying a reference field, used to pin which id the picker searches with.
const referenceForm: api.FormDefinition = {
  ...publishedForm,
  schema: {
    id: 'specimen-intake',
    name: 'Specimen intake',
    versionLabel: null,
    fhirVersion: null,
    fhirResourceType: 'ServiceRequest',
    fhirProfileUrl: null,
    facilityId: null,
    sections: [],
    targetPages: ['forms'],
    languages: ['en'],
    version: 1,
    active: true,
    status: 'published',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fields: [
      {
        id: 'subject',
        fhirPath: null,
        displayLabel: 'Subject',
        description: null,
        fieldType: 'reference',
        required: false,
        enabled: true,
        order: 1,
        cardinality: { min: 0, max: '1' },
        referenceTarget: 'Patient',
      },
    ],
  },
};

/**
 * Open the ⋯ "Form actions" DropdownMenu and click a menu item by text.
 * Uses the Radix jsdom pattern: pointerDown on trigger, Enter fallback, then
 * pointerMove + click the item.
 */
function clickActionsMenuItem(itemText: string) {
  const trigger = screen.getByRole('button', { name: /form actions/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText(itemText)) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
  const item = screen.getByText(itemText);
  fireEvent.pointerMove(item);
  fireEvent.click(item);
}

describe('FormCapture page', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getForm').mockResolvedValue(form);
    vi.spyOn(api, 'submitFormResponse').mockResolvedValue({ resourceType: 'QuestionnaireResponse' });
  });

  it('renders form name, status badge in header, fields, and applies visibility', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/form-1']}>
        <Routes><Route path="/forms/:id" element={<FormCapture />} /></Routes>
      </MemoryRouter>,
    );

    // Form name and status badge appear in header
    expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();

    // Fields rendered; Notes hidden by default
    expect(screen.getByLabelText('Patient ID')).toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();

    // No standalone Back button or bottom Cancel button
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  it('disables submission while the form is unpublished (draft)', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/form-1']}>
        <Routes><Route path="/forms/:id" element={<FormCapture />} /></Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Specimen intake');

    // The unpublished banner is shown and Submit is a no-op.
    expect(screen.getByText(/not published/i)).toBeInTheDocument();
    clickActionsMenuItem('Submit');
    expect(api.submitFormResponse).not.toHaveBeenCalled();
  });

  it('validates required fields when submitting via the ⋯ menu', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(publishedForm);
    render(
      <MemoryRouter initialEntries={['/forms/form-1']}>
        <Routes><Route path="/forms/:id" element={<FormCapture />} /></Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Specimen intake');

    // Submit without filling required field
    clickActionsMenuItem('Submit');

    expect(await screen.findByText('Patient ID is required')).toBeInTheDocument();
    expect(api.submitFormResponse).not.toHaveBeenCalled();
  });

  it('applies visibility, validates required fields, and submits answers via the ⋯ menu', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(publishedForm);
    render(
      <MemoryRouter initialEntries={['/forms/form-1']}>
        <Routes><Route path="/forms/:id" element={<FormCapture />} /></Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Specimen intake');

    // Fill required field
    fireEvent.change(screen.getByLabelText('Patient ID'), { target: { value: 'P-100' } });

    // Reveal Notes via visibility condition
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add notes?' }));
    expect(await screen.findByLabelText('Notes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Follow up' } });

    // Submit via ⋯ menu
    clickActionsMenuItem('Submit');

    await waitFor(() =>
      expect(api.submitFormResponse).toHaveBeenCalledWith(
        'form-1',
        expect.objectContaining({ patientId: 'P-100', hasNotes: true, notes: 'Follow up' }),
      ),
    );
    expect(await screen.findByText('Response captured.')).toBeInTheDocument();
  });

  // Regression: `formId` is the DOM id of the <form> element ("form-capture"). Threading it into
  // the reference picker made every search request GET /api/forms/form-capture/... and 404 — so a
  // required reference field could never be satisfied. The search must use the ROUTE form id.
  it('searches references with the route form id, not the DOM form id', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(referenceForm);
    const search = vi.spyOn(api, 'referenceSearch').mockResolvedValue({ kind: 'entity', rows: [], total: 0 });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/forms/form-1']}>
        <Routes><Route path="/forms/:id" element={<FormCapture />} /></Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Specimen intake');
    await user.type(screen.getByRole('combobox'), 'doe');

    await waitFor(() => expect(search).toHaveBeenCalledWith('form-1', 'subject', { q: 'doe' }));
  });
});

it('explains unsupported capture before entry and refuses submission', async () => {
  vi.spyOn(api, 'getForm').mockResolvedValue({ ...publishedForm,
    schema: { ...(publishedForm.schema as object), fhirResourceType: null } });
  const submit = vi.spyOn(api, 'submitFormResponse');
  render(<MemoryRouter initialEntries={['/forms/form-1']}>
    <Routes><Route path="/forms/:id" element={<FormCapture />} /></Routes>
  </MemoryRouter>);
  expect(await screen.findByText(/not configured for submission/i)).toBeInTheDocument();
  expect(screen.queryByLabelText('Patient ID')).not.toBeInTheDocument();
  clickActionsMenuItem('Submit');
  expect(submit).not.toHaveBeenCalled();
});

describe('FormCapture order rejection (2026-10-11 spec)', () => {
  const rejectionField = {
    id: 'rej',
    fhirPath: 'ServiceRequest.extension',
    fhirDiscriminator: { url: 'urn:openldr:ext:rejection' },
    displayLabel: 'Order rejection',
    description: null,
    fieldType: 'reference',
    required: false,
    enabled: true,
    order: 9,
    cardinality: { min: 0, max: '1' },
    valueSetUrl: 'urn:openldr:valueset:order-reject-reason',
  };
  const labOrderForm: api.FormDefinition = {
    ...publishedForm,
    schema: { ...(publishedForm.schema as object), fields: [...(publishedForm.schema as { fields: unknown[] }).fields, rejectionField] },
  };

  const renderPage = () => render(
    <MemoryRouter initialEntries={['/forms/form-1']}>
      <Routes><Route path="/forms/:id" element={<FormCapture />} /></Routes>
    </MemoryRouter>,
  );

  beforeEach(() => {
    vi.spyOn(api, 'submitFormResponse').mockResolvedValue({ resourceType: 'QuestionnaireResponse' });
    vi.spyOn(api, 'catalogResultParams').mockResolvedValue({
      tests: [],
      rejectReasons: { order: [{ system: 's', code: 'WRONGPT', display: 'Wrong patient' }], test: [] },
      sexes: [],
    });
  });

  it('rejects the order from the menu, shows the reason, and undoes it', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(labOrderForm);
    renderPage();
    await screen.findByText('Specimen intake');

    clickActionsMenuItem('Reject order');
    fireEvent.click(await screen.findByText('Wrong patient'));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(await screen.findByText('Order rejected: Wrong patient')).toBeInTheDocument();
    expect(api.catalogResultParams).toHaveBeenCalledWith([], null);

    clickActionsMenuItem('Undo rejection');
    await waitFor(() => expect(screen.queryByText('Order rejected: Wrong patient')).not.toBeInTheDocument());
  });

  it('sends the rejection with the submission', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(labOrderForm);
    renderPage();
    await screen.findByText('Specimen intake');
    fireEvent.change(screen.getByLabelText('Patient ID'), { target: { value: 'P-100' } });

    clickActionsMenuItem('Reject order');
    fireEvent.click(await screen.findByText('Wrong patient'));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await screen.findByText('Order rejected: Wrong patient');

    clickActionsMenuItem('Submit');
    await waitFor(() => expect(api.submitFormResponse).toHaveBeenCalledWith(
      'form-1',
      expect.objectContaining({ patientId: 'P-100', rej: { system: 's', code: 'WRONGPT', display: 'Wrong patient' } }),
    ));
    // The rejection stays after submit. The form keeps its answers, so clearing it would reopen the
    // rows and a second Submit would write an accepted duplicate with the typed results.
    expect(await screen.findByText('Response captured.')).toBeInTheDocument();
    expect(screen.getByText('Order rejected: Wrong patient')).toBeInTheDocument();
  });

  it('shows the spinner, not the empty state, while the reasons are read', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(labOrderForm);
    vi.spyOn(api, 'catalogResultParams').mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText('Specimen intake');
    clickActionsMenuItem('Reject order');
    expect(await screen.findByText('Reject this order')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('No reasons are configured.')).not.toBeInTheDocument();
  });

  it('says the reasons could not be read when the read fails', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(labOrderForm);
    vi.spyOn(api, 'catalogResultParams').mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByText('Specimen intake');
    clickActionsMenuItem('Reject order');
    expect(await screen.findByText('The reasons could not be read.')).toBeInTheDocument();
    expect(screen.queryByText('No reasons are configured.')).not.toBeInTheDocument();
  });

  it('keeps the striped none state when the server really offers no reasons', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(labOrderForm);
    vi.spyOn(api, 'catalogResultParams').mockResolvedValue({ tests: [], rejectReasons: { order: [], test: [] }, sexes: [] });
    renderPage();
    await screen.findByText('Specimen intake');
    clickActionsMenuItem('Reject order');
    expect(await screen.findByText('No reasons are configured.')).toBeInTheDocument();
  });

  it('offers neither menu item on a form without the rejection field', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(publishedForm);
    renderPage();
    await screen.findByText('Specimen intake');
    fireEvent.pointerDown(screen.getByRole('button', { name: /form actions/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    expect(await screen.findByText('Submit')).toBeInTheDocument();
    expect(screen.queryByText('Reject order')).not.toBeInTheDocument();
    expect(screen.queryByText('Undo rejection')).not.toBeInTheDocument();
  });
});
