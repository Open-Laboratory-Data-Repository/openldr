import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';
import { Forms } from './Forms';
import * as api from '../api';

const importedSchema = {
  id: 'specimen-intake',
  name: 'Specimen intake',
  title: { en: 'Specimen intake' },
  status: 'active',
  languages: ['en'],
  sections: [
    {
      id: 'main',
      title: { en: 'Main' },
      fields: [{ id: 'patientId', type: 'string', label: { en: 'Patient ID' }, required: false }],
    },
  ],
};

const form: api.FormSummary = {
  id: 'form-1',
  name: 'Specimen intake',
  versionLabel: 'v1',
  status: 'draft',
  active: true,
  fhirResourceType: 'Questionnaire',
  targetPages: ['forms'],
  fieldCount: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Forms page', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listForms').mockResolvedValue([form]);
    vi.spyOn(api, 'createForm').mockResolvedValue({ ...form, schema: importedSchema, targetPages: ['forms'], createdAt: form.updatedAt });
    vi.spyOn(api, 'setFormStatus').mockImplementation(async (_id, status) => ({ ...form, status, schema: importedSchema, targetPages: ['forms'], createdAt: form.updatedAt }));
    vi.spyOn(api, 'publishForm').mockResolvedValue({ ...form, status: 'published', schema: importedSchema, targetPages: ['forms'], createdAt: form.updatedAt });
    vi.spyOn(api, 'deleteForm').mockResolvedValue();
    vi.spyOn(api, 'exportFormBundle').mockResolvedValue(undefined);
  });

  it('lists forms, imports JSON, and exposes row actions', async () => {
    render(<MemoryRouter><Forms /></MemoryRouter>);

    expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
    expect(screen.getByText('Questionnaire')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Form actions' })).toBeEnabled();

    const file = new File([JSON.stringify(importedSchema)], 'specimen-intake.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(/import form json/i), { target: { files: [file] } });

    await waitFor(() => expect(api.createForm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Specimen intake', schema: importedSchema })));

    fireEvent.pointerDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Publish')) fireEvent.keyDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Publish'));
    await waitFor(() => expect(api.publishForm).toHaveBeenCalledWith('form-1', expect.objectContaining({ versionLabel: 'v1' })));

    fireEvent.pointerDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Export')) fireEvent.keyDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: 'Export' })).toHaveAttribute('href', '/api/forms/form-1/questionnaire');

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(api.deleteForm).toHaveBeenCalledWith('form-1'));
  });

  it('opens the builder from the New menu action', async () => {
    render(
      <MemoryRouter initialEntries={['/forms']}>
        <Routes>
          <Route path="/forms" element={<Forms />} />
          <Route path="/forms/new" element={<div>Builder opened</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Form actions' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('New')) fireEvent.keyDown(screen.getByRole('button', { name: 'Form actions' }), { key: 'Enter' });
    fireEvent.click(await screen.findByText('New'));
    expect(await screen.findByText('Builder opened')).toBeInTheDocument();
  });

  it('routes a standalone form (targets the Forms page) to the run/submit view on row click', async () => {
    render(
      <MemoryRouter initialEntries={['/forms']}>
        <Routes>
          <Route path="/forms" element={<Forms />} />
          <Route path="/forms/:id" element={<div>Run view</div>} />
          <Route path="/forms/:id/builder" element={<div>Builder view</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText('Specimen intake'));
    expect(await screen.findByText('Run view')).toBeInTheDocument();
  });

  it('routes a page-allocated form to the builder on row click', async () => {
    const allocated: api.FormSummary = { ...form, id: 'form-9', name: 'Order entry', targetPages: ['orders'] };
    vi.spyOn(api, 'listForms').mockResolvedValue([allocated]);
    render(
      <MemoryRouter initialEntries={['/forms']}>
        <Routes>
          <Route path="/forms" element={<Forms />} />
          <Route path="/forms/:id" element={<div>Run view</div>} />
          <Route path="/forms/:id/builder" element={<div>Builder view</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText('Order entry'));
    expect(await screen.findByText('Builder view')).toBeInTheDocument();
  });

  it('exports a published form as a marketplace bundle', async () => {
    const published: api.FormSummary = { ...form, status: 'published' };
    vi.spyOn(api, 'listForms').mockResolvedValue([published]);
    render(<MemoryRouter><Forms /></MemoryRouter>);
    expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByTestId('export-bundle-form-1')) fireEvent.keyDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('export-bundle-form-1'));
    await waitFor(() => expect(api.exportFormBundle).toHaveBeenCalledWith('form-1'));
  });

  it('duplicates forms from row actions', async () => {
    const duplicateSpy = vi.spyOn(api, 'duplicateForm').mockResolvedValue({ ...form, id: 'form-2', name: 'Specimen intake copy', schema: importedSchema, targetPages: ['forms'], createdAt: form.updatedAt });
    render(<MemoryRouter><Forms /></MemoryRouter>);
    expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Duplicate')) fireEvent.keyDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Duplicate'));
    await waitFor(() => expect(duplicateSpy).toHaveBeenCalledWith('form-1'));
  });

  it('renders the standard table toolbar with the chips row', async () => {
    render(<MemoryRouter><Forms /></MemoryRouter>);
    await screen.findByText('Specimen intake');

    await addFilterViaPopover('Specimen');
    expectStandardTableToolbar();
  });

  it('filters rows by the search box', async () => {
    render(<MemoryRouter><Forms /></MemoryRouter>);
    await screen.findByText('Specimen intake');

    fireEvent.change(screen.getByPlaceholderText(/search forms/i), { target: { value: 'zzz-no-such-form' } });
    expect(screen.queryByText('Specimen intake')).not.toBeInTheDocument();
  });

  // Regression for the search-vs-popover-filter fold bug: applyTableState folds rules flat,
  // left-to-right (applyTableState.ts:80-92), so appending a multi-field OR search rule to an
  // active popover filter list turned `A AND B OR C` into `(A AND B) OR C` — a row matching only
  // the trailing OR term (fhirResourceType) came back regardless of the popover filter.
  it('excludes a row that matches search only via FHIR type but fails the active popover filter', async () => {
    // addFilterViaPopover always targets the first filterable column (name) with that type's
    // first valid operator, which for 'text' is 'eq', not 'like' (types.ts validOperators) —
    // so the popover filter here is an EXACT match: name eq 'Alpha Intake'.
    const alpha: api.FormSummary = { ...form, id: 'form-a', name: 'Alpha Intake', fhirResourceType: 'Encounter' };
    const beta: api.FormSummary = { ...form, id: 'form-b', name: 'Beta Form', fhirResourceType: 'AlphaType' };
    vi.spyOn(api, 'listForms').mockResolvedValue([alpha, beta]);
    render(<MemoryRouter><Forms /></MemoryRouter>);
    await screen.findByText('Alpha Intake');

    await addFilterViaPopover('Alpha Intake');
    // Scoped to the table: the applied-filter chip also renders the value 'Alpha Intake'
    // in a sibling element, so an unscoped query matches both and throws.
    const table = screen.getByRole('table');
    expect(await within(table).findByText('Alpha Intake')).toBeInTheDocument();
    expect(within(table).queryByText('Beta Form')).not.toBeInTheDocument();

    // Search term 'Alpha' also matches Beta Form's fhirResourceType ('AlphaType'), but Beta
    // Form's name does not equal the popover filter's value. It must stay excluded.
    fireEvent.change(screen.getByPlaceholderText(/search forms/i), { target: { value: 'Alpha' } });
    expect(await within(table).findByText('Alpha Intake')).toBeInTheDocument();
    expect(within(table).queryByText('Beta Form')).not.toBeInTheDocument();
  });

  it('matches search against FHIR type alone, with no popover filter active', async () => {
    const gamma: api.FormSummary = { ...form, id: 'form-c', name: 'Gamma Form', fhirResourceType: 'XRayStudy' };
    vi.spyOn(api, 'listForms').mockResolvedValue([gamma]);
    render(<MemoryRouter><Forms /></MemoryRouter>);
    await screen.findByText('Gamma Form');

    fireEvent.change(screen.getByPlaceholderText(/search forms/i), { target: { value: 'xray' } });
    expect(await screen.findByText('Gamma Form')).toBeInTheDocument();
  });
});
