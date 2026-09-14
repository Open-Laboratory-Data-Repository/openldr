import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CodeSuggestion, FormField } from '@openldr/forms/pure';
import { CodeSuggestionPanel } from './CodeSuggestionPanel';

const api = vi.hoisted(() => ({
  codeSuggestions: vi.fn(),
  importSuggestedCode: vi.fn(),
  undoSuggestedCode: vi.fn(),
}));
vi.mock('../../api', () => api);

const auth = vi.hoisted(() => ({ caps: new Set<string>() }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ hasCapability: (c: string) => auth.caps.has(c) }) }));

const LOINC = 'http://loinc.org';
const field = (extra: Partial<FormField> = {}): FormField => ({
  id: 'f', displayLabel: 'Test', fieldType: 'text', required: false, enabled: true, fhirPath: 'Observation.code',
  order: 0, cardinality: { min: 0, max: '1' }, description: null, ...extra,
});
const hb: CodeSuggestion = { system: LOINC, code: '718-7', display: 'Hemoglobin', source: 'your-forms', count: 2, inTerminology: true };
const wbc: CodeSuggestion = { system: LOINC, code: '6690-2', display: 'WBC', source: 'binding', inTerminology: false };

function renderPanel(f: FormField = field(), fhirResourceType: string | null = 'Observation') {
  const onAdd = vi.fn();
  const utils = render(<CodeSuggestionPanel field={f} fhirResourceType={fhirResourceType} formId="form-1" onAdd={onAdd} />);
  return { ...utils, onAdd };
}

beforeEach(() => {
  api.codeSuggestions.mockReset();
  api.importSuggestedCode.mockReset();
  api.undoSuggestedCode.mockReset();
  auth.caps = new Set();
});

describe('CodeSuggestionPanel', () => {
  it('draws nothing for a field with no FHIR path', () => {
    const { container } = renderPanel(field({ fhirPath: null }));
    expect(container.innerHTML).toBe('');
    expect(api.codeSuggestions).not.toHaveBeenCalled();
  });

  it('asks for the resolved path, the field set, and this form', async () => {
    api.codeSuggestions.mockResolvedValue([]);
    renderPanel(field({ fhirPath: 'code', valueSetUrl: 'urn:test:vs' }));
    await waitFor(() => expect(api.codeSuggestions).toHaveBeenCalledWith({ fhirPath: 'Observation.code', valueSetUrl: 'urn:test:vs', formId: 'form-1' }));
  });

  it("falls back to FHIR's standard binding for the element", async () => {
    api.codeSuggestions.mockResolvedValue([]);
    renderPanel(field({ fhirPath: 'Patient.gender' }), 'Patient');
    await waitFor(() => expect(api.codeSuggestions).toHaveBeenCalledWith({
      fhirPath: 'Patient.gender', valueSetUrl: 'http://hl7.org/fhir/ValueSet/administrative-gender', formId: 'form-1',
    }));
  });

  it('says the terminology is thin when nothing is found', async () => {
    api.codeSuggestions.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText(/Your terminology may be thin/)).toBeTruthy();
  });

  it('shows a failed load as an error, not as an empty list', async () => {
    api.codeSuggestions.mockRejectedValue(new Error('load suggested codes failed: 500'));
    renderPanel();
    expect(await screen.findByText('load suggested codes failed: 500')).toBeTruthy();
    expect(screen.queryByText(/thin/)).toBeNull();
  });

  it('labels each row by source and marks a code CE lacks', async () => {
    api.codeSuggestions.mockResolvedValue([wbc, hb]);
    renderPanel();
    const wbcRow = await screen.findByRole('button', { name: /WBC/ });
    expect(wbcRow.textContent).toContain('Binding');
    expect(wbcRow.textContent).toContain('not in your terminology');
    const hbRow = screen.getByRole('button', { name: /Hemoglobin/ });
    expect(hbRow.textContent).toContain('Your forms · 2');
    expect(hbRow.textContent).not.toContain('not in your terminology');
  });

  it('leaves out codes already on the field, and says so when none are left', async () => {
    api.codeSuggestions.mockResolvedValue([hb]);
    renderPanel(field({ code: [{ system: LOINC, code: '718-7' }] }));
    expect(await screen.findByText('Every suggestion for this field is already on it.')).toBeTruthy();
  });

  it('adds a code CE holds without touching the terminology', async () => {
    api.codeSuggestions.mockResolvedValue([hb]);
    const { onAdd } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Hemoglobin/ }));
    expect(onAdd).toHaveBeenCalledWith({ system: LOINC, code: '718-7', display: 'Hemoglobin' });
    expect(api.importSuggestedCode).not.toHaveBeenCalled();
  });

  it('greys a code CE lacks for an author who cannot manage terminology', async () => {
    api.codeSuggestions.mockResolvedValue([wbc]);
    renderPanel();
    const row = await screen.findByRole('button', { name: /WBC/ });
    expect((row as HTMLButtonElement).disabled).toBe(true);
    expect(row.textContent).toContain('Someone who can manage terminology must add this code first.');
  });

  it('imports a code CE lacks, says so, and Undo removes only the term', async () => {
    auth.caps = new Set(['terminology.manage']);
    api.codeSuggestions.mockResolvedValue([wbc]);
    api.importSuggestedCode.mockResolvedValue({ ok: true });
    api.undoSuggestedCode.mockResolvedValue(undefined);
    const { onAdd } = renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /WBC/ }));
    expect(await screen.findByText('Added “WBC” to your terminology.')).toBeTruthy();
    expect(api.importSuggestedCode).toHaveBeenCalledWith({ system: LOINC, code: '6690-2', display: 'WBC' });
    expect(onAdd).toHaveBeenCalledWith({ system: LOINC, code: '6690-2', display: 'WBC' });

    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(api.undoSuggestedCode).toHaveBeenCalledWith({ system: LOINC, code: '6690-2' }));
    await waitFor(() => expect(screen.queryByText(/to your terminology\./)).toBeNull());
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('refuses a code whose system CE does not know, and does not add it', async () => {
    auth.caps = new Set(['terminology.manage']);
    api.codeSuggestions.mockResolvedValue([wbc]);
    api.importSuggestedCode.mockResolvedValue({ ok: false, reason: 'unknown-system' });
    const { onAdd } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /WBC/ }));
    expect(await screen.findByText(/Add the system on the Terminology page first\./)).toBeTruthy();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('adds a code someone else added since the list loaded, with nothing to undo', async () => {
    auth.caps = new Set(['terminology.manage']);
    api.codeSuggestions.mockResolvedValue([wbc]);
    api.importSuggestedCode.mockResolvedValue({ ok: false, reason: 'already-present' });
    const { onAdd } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /WBC/ }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ system: LOINC, code: '6690-2', display: 'WBC' }));
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });
});
