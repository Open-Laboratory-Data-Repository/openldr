import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { FormBuilderPage } from './FormBuilderPage';
import * as api from '../api';

const NOW = '2026-01-01T00:00:00.000Z';

function makeFormDef(overrides: Partial<Parameters<typeof Object.assign>[0]> = {}) {
  return {
    id: 'form-1',
    name: 'Specimen intake',
    versionLabel: null,
    fhirResourceType: null,
    status: 'draft' as const,
    active: true,
    schema: {
      id: 'specimen-intake',
      name: 'Specimen intake',
      versionLabel: null,
      fhirVersion: null,
      fhirResourceType: null,
      fhirProfileUrl: null,
      facilityId: null,
      fields: [],
      sections: [],
      targetPages: [],
      version: 1,
      active: true,
      status: 'draft' as const,
      createdAt: NOW,
      updatedAt: NOW,
    },
    targetPages: ['forms'],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Open the ⋯ Builder actions dropdown. */
function openBuilderMenu(): void {
  const trigger = screen.getByRole('button', { name: 'Builder actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText('Save draft')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

/** Open the Field actions (⋯) menu in the FieldEditorSheet. */
function openFieldMenu(): void {
  const trigger = screen.getByRole('button', { name: 'Field actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText('Save')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

describe('FormBuilderPage (three-pane shell)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'createForm').mockResolvedValue(makeFormDef());
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('renders with /forms/new: the header Form name input is present', () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Form name')).toBeInTheDocument();
  });

  it('renders the Preview pane alongside the field list', () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    // PreviewPane renders a "Preview" heading
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('adds a field via the header ⋯ menu → Add field', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // Field card should appear in the field-list pane (may also appear in sheet description)
    await waitFor(() =>
      expect(screen.getAllByText('New text field').length).toBeGreaterThan(0),
    );
  });

  it('selecting a field opens the FieldEditorSheet with "Edit Field" header', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    // Add a field
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // Sheet is auto-opened (field is auto-selected on add); "Edit Field" heading appears
    expect(await screen.findByText('Edit Field')).toBeInTheDocument();
  });

  it('adding a field, editing Display Label and Saving updates the card label', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    // Add field via menu — auto-selected, sheet opens
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // The sheet shows a "Display Label" input
    const labelInput = await screen.findByLabelText('Display Label');
    expect(labelInput).toBeInTheDocument();
    fireEvent.change(labelInput, { target: { value: 'Patient Name' } });
    // Save via ⋯ → Save
    openFieldMenu();
    fireEvent.click(screen.getByText('Save'));
    // Card label should now show the new label in the field-list pane
    await waitFor(() =>
      expect(screen.getAllByText('Patient Name').length).toBeGreaterThan(0),
    );
  });

  it('cancel on a new (unsaved) field removes it from the list', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    // Add field — appears in list and sheet opens
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    await screen.findByText('Edit Field');
    // The field card is in the list
    expect(screen.getAllByText('New text field').length).toBeGreaterThan(0);

    // Click ⋯ → Cancel in the sheet
    openFieldMenu();
    fireEvent.click(screen.getByText('Cancel'));

    // The field should be removed from the list
    await waitFor(() =>
      expect(screen.queryAllByText('New text field')).toHaveLength(0),
    );
    // Sheet is closed
    expect(screen.queryByText('Edit Field')).not.toBeInTheDocument();
  });

  it('closing the sheet via Close button on a new field removes it (cancel == close)', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    expect(await screen.findByText('Edit Field')).toBeInTheDocument();

    // Close via the sheet's X close button — this triggers cancel
    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);

    // Sheet is closed and the pending new field is removed
    await waitFor(() =>
      expect(screen.queryByText('Edit Field')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryAllByText('New text field')).toHaveLength(0),
    );
  });

  it('cancelling an existing field (non-new) does NOT remove it from the list', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    // Add + Save the field first
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    await screen.findByText('Edit Field');
    openFieldMenu();
    fireEvent.click(screen.getByText('Save'));
    // Sheet closes, field is committed
    await waitFor(() => expect(screen.queryByText('Edit Field')).not.toBeInTheDocument());
    expect(screen.queryAllByText('New text field').length).toBeGreaterThan(0);

    // Now click the field card to re-open the sheet (not a pending-new)
    fireEvent.click(screen.getAllByText('New text field')[0]);
    await screen.findByText('Edit Field');

    // Cancel — should NOT remove the field
    openFieldMenu();
    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => expect(screen.queryByText('Edit Field')).not.toBeInTheDocument());
    // Field still present
    expect(screen.queryAllByText('New text field').length).toBeGreaterThan(0);
  });

  it('toggles the Enabled checkbox in the sheet (draft reflects immediately)', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // Sheet opens; find the Enabled checkbox inside the sheet
    const enabledCheckbox = await screen.findByLabelText('Enabled');
    // Starts checked (enabled: true)
    expect(enabledCheckbox).toBeChecked();
    fireEvent.click(enabledCheckbox);
    // Draft is unchecked immediately (local draft state)
    expect(enabledCheckbox).not.toBeChecked();
  });

  it('deletes a field via card ⋯ → Delete after the field has been saved', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // Sheet opens automatically (field auto-selected); Save the field first
    await screen.findByText('Edit Field');
    openFieldMenu();
    fireEvent.click(screen.getByText('Save'));
    // Sheet closes, field is committed to schema
    await waitFor(() => expect(screen.queryByText('Edit Field')).not.toBeInTheDocument());

    // Now the field card ⋯ menu is accessible
    const actionsBtn = screen.getByRole('button', { name: /Actions for New text field/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Delete')) {
      fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    }
    fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() =>
      expect(screen.queryAllByText('New text field')).toHaveLength(0),
    );
  });

  it('Save draft: opens ⋯ → Save draft → createForm called', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    // Set a form name via the header input
    const nameInput = screen.getByLabelText('Form name');
    fireEvent.change(nameInput, { target: { value: 'My New Form' } });

    openBuilderMenu();
    fireEvent.click(await screen.findByText('Save draft'));
    await waitFor(() =>
      expect(api.createForm).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My New Form' }),
      ),
    );
  });

  it('Publish: opens ⋯ → Publish → publishForm called for existing form', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'updateForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'publishForm').mockResolvedValue({ ...makeFormDef(), status: 'published' as const });

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Publish'));
    await waitFor(() =>
      expect(api.publishForm).toHaveBeenCalledWith('form-1', expect.anything()),
    );
  });

  it('Publish: saves the on-screen draft before snapshotting it', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    const update = vi.spyOn(api, 'updateForm').mockResolvedValue(makeFormDef());
    const publish = vi.spyOn(api, 'publishForm').mockResolvedValue({ ...makeFormDef(), status: 'published' as const });

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    const nameInput = await screen.findByDisplayValue('Specimen intake');
    fireEvent.change(nameInput, { target: { value: 'Specimen intake v2' } });

    openBuilderMenu();
    fireEvent.click(await screen.findByText('Publish'));

    await waitFor(() => expect(publish).toHaveBeenCalled());
    // The edit reached the server before the snapshot was taken. Without this, publish
    // snapshots the row as it was stored, so the rename above is silently left out.
    expect(update).toHaveBeenCalledWith('form-1', expect.objectContaining({ name: 'Specimen intake v2' }));
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0]);
  });

  it('Publish: reports success by name', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'updateForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'publishForm').mockResolvedValue({ ...makeFormDef(), status: 'published' as const });

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Publish'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Published Specimen intake'));
  });

  it('Publish: a rejected publish surfaces the server message instead of failing silently', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'updateForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'publishForm').mockRejectedValue(new Error('publish form: forms.publish required'));

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Publish'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('publish form: forms.publish required'),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('Save draft: a rejected save surfaces the server message instead of failing silently', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'updateForm').mockRejectedValue(new Error('update form: name is required'));

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Save draft'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('update form: name is required'),
    );
  });

  it('Archive: reports which form was archived', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'setFormStatus').mockResolvedValue({ ...makeFormDef(), status: 'archived' as const });

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Archive'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Archived Specimen intake'));
  });

  it('Disable: says the form was archived, because that is what the endpoint does', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'setFormStatus').mockResolvedValue({ ...makeFormDef(), status: 'archived' as const });

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Disable'));

    // Disable maps to archive until a dedicated active-toggle endpoint exists. The message has to
    // match the status badge the operator is about to see, not the menu item they clicked.
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Archived Specimen intake'));
  });

  it('Archive: a rejected archive surfaces the server message', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'setFormStatus').mockRejectedValue(new Error('set form status: form not found'));

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Archive'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('set form status: form not found'));
  });

  it('Compare: opens ⋯ → Compare → CompareDialog opens', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Compare'));
    expect(await screen.findByText(/Published version|Compare form versions/)).toBeInTheDocument();
  });

  it('Versions: ⋯ → Versions opens the history sheet', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Versions'));

    expect(await screen.findByText('Version history')).toBeInTheDocument();
  });

  // ── Lifecycle actions (archive / delete / export) ────────────────────────────

  it('Archive: ⋯ → Archive calls setFormStatus(formId, "archived")', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'setFormStatus').mockResolvedValue({ ...makeFormDef(), status: 'archived' as const });

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Archive'));
    await waitFor(() =>
      expect(api.setFormStatus).toHaveBeenCalledWith('form-1', 'archived'),
    );
  });

  it('Delete: ⋯ → Delete opens confirm dialog; confirming calls deleteForm and navigates to /forms', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'deleteForm').mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes>
          <Route path="/forms/:id/builder" element={<FormBuilderPage />} />
          <Route path="/forms" element={<div>Forms list</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Delete'));

    // Confirm dialog should now be visible
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();

    // Click the confirm/destructive action button
    const confirmBtn = screen.getByRole('button', { name: /delete/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(api.deleteForm).toHaveBeenCalledWith('form-1'));
    await waitFor(() => expect(screen.getByText('Forms list')).toBeInTheDocument());
  });

  it('Delete: reports which form went, on the list it lands on', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'deleteForm').mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes>
          <Route path="/forms/:id/builder" element={<FormBuilderPage />} />
          <Route path="/forms" element={<div>Forms list</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Delete'));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deleted Specimen intake'));
  });

  it('Export: ⋯ → Export calls formQuestionnaireUrl(formId)', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    const urlSpy = vi.spyOn(api, 'formQuestionnaireUrl');

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Export'));
    await waitFor(() =>
      expect(urlSpy).toHaveBeenCalledWith('form-1'),
    );
  });

  it('Sections popover: opening the Sections dropdown shows a "Section name…" input; adding a section updates the Sections count', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );

    // The Sections trigger button is present showing 0 sections
    const sectionsTrigger = screen.getByText(/Sections \(0\)/i);
    expect(sectionsTrigger).toBeInTheDocument();

    // Open the Sections popover
    fireEvent.click(sectionsTrigger);

    // SectionsManager is now visible with its "Section name…" input
    const nameInput = await screen.findByPlaceholderText('Section name…');
    expect(nameInput).toBeInTheDocument();

    // Type a name and click Add
    fireEvent.change(nameInput, { target: { value: 'Demographics' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    // Sections count in the trigger should now be 1
    await waitFor(() => {
      expect(screen.getByText(/Sections \(1\)/i)).toBeInTheDocument();
    });
  });
});

it('shows capture configuration guidance without blocking publishing', async () => {
  vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
  vi.spyOn(api, 'listFormVersions').mockResolvedValue([]);
  render(<MemoryRouter initialEntries={['/forms/form-1/edit']}>
    <Routes><Route path="/forms/:id/edit" element={<FormBuilderPage />} /></Routes>
  </MemoryRouter>);
  expect(await screen.findByText(/not configured for submission/i)).toBeInTheDocument();
  openBuilderMenu();
  expect(screen.getByRole('menuitem', { name: /^Publish$/ })).not.toHaveAttribute('data-disabled');
});
