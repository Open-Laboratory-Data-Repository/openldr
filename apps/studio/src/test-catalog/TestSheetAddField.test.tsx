import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual, createCatalogTest: vi.fn(), updateCatalogTest: vi.fn(), setCatalogLabSettings: vi.fn(),
    searchTerms: vi.fn(), termExists: vi.fn(), createResultField: vi.fn(), listValueSets: vi.fn(),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { TestSheet } from './TestSheet';

const RESULT = 'urn:openldr:default_result';
const OPTIONS: api.TestCatalogOptions = {
  categories: [], specimenTypes: [],
  resultParams: [{ system: RESULT, code: 'HGB', display: 'Haemoglobin' }],
  loinc: null, sexes: [],
};
const HGB_PARAM: api.CatalogTestResultParam = { system: RESULT, code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [] };
const TEST: api.CatalogTest = {
  code: 'FBC', testCode: 'FBC', display: 'Full blood count', shortName: null, category: null, specimenTypes: [],
  resultParams: [], loinc: null, active: true, expectedTatHours: null, criticalTatHours: null, requiresVerification: true, codings: [],
  lab: { enabled: false, specimenTypes: null, localDisplay: null },
};
const VALUE_SETS: api.ValueSetSummary[] = [{
  id: 'vs1', url: 'urn:openldr:valueset:pos-neg', name: 'pos-neg', title: 'Positive or negative', version: null,
  status: 'active', immutable: false, publisherId: null, category: null, codeCount: 2, primarySystem: null,
}];

async function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  await screen.findByRole('menu');
}
async function choose(menu: string, item: string) {
  await openMenu(menu);
  await act(async () => { fireEvent.click(await screen.findByTestId(item)); });
}
async function pick(label: string, option: RegExp) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
const addSheet = () => screen.getByRole('dialog', { name: 'Add result field' });

function renderSheet(test: api.CatalogTest = TEST) {
  const onOptionsChanged = vi.fn();
  render(
    <TestSheet
      target={{ kind: 'edit', test }} options={OPTIONS} ownedHere
      onSaved={vi.fn()} onClose={vi.fn()} onOptionsChanged={onOptionsChanged}
    />,
  );
  return { onOptionsChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listValueSets).mockResolvedValue(VALUE_SETS);
});

describe('TestSheet: Add field', () => {
  it('sits in the Result parameters menu and opens its own sheet with a label-left grid', async () => {
    renderSheet();
    await choose('result-params-menu', 'add-field');
    const sheet = addSheet();
    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(within(sheet).getByRole('combobox', { name: 'Type' })).toBeTruthy();
    expect(sheet.querySelector('.grid-cols-\\[auto_minmax\\(0\\,1fr\\)\\]')).not.toBeNull();
  });

  it('adds a numeric field with its unit, ticks it on the test and asks for the choices again', async () => {
    vi.mocked(api.createResultField).mockResolvedValue({
      system: RESULT, code: 'HAEMOGLOBIN_A1C', display: 'Haemoglobin A1c', role: 'result', units: 'mmol/mol', loinc: null,
    });
    vi.mocked(api.updateCatalogTest).mockResolvedValue(TEST);
    const { onOptionsChanged } = renderSheet();
    await choose('result-params-menu', 'add-field');
    fireEvent.change(within(addSheet()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Haemoglobin A1c' } });
    fireEvent.change(within(addSheet()).getByRole('textbox', { name: 'Unit' }), { target: { value: 'mmol/mol' } });
    await choose('add-field-menu', 'add-field-save');
    expect(api.createResultField).toHaveBeenCalledWith({ code: null, display: 'Haemoglobin A1c', units: 'mmol/mol' });
    expect(toast.success).toHaveBeenCalledWith('HAEMOGLOBIN_A1C added and ticked on this test.');
    expect(onOptionsChanged).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId('param-HAEMOGLOBIN_A1C') as HTMLElement).getAttribute('data-state')).toBe('checked');
    await choose('test-sheet-menu', 'test-sheet-save');
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams).toEqual([
      { system: RESULT, code: 'HAEMOGLOBIN_A1C', resultType: 'numeric', valueSetUrl: null, bands: [] },
    ]);
  });

  it('a coded field needs a value set from the loaded ones, and sends no unit', async () => {
    vi.mocked(api.createResultField).mockResolvedValue({
      system: RESULT, code: 'HIVR', display: 'HIV rapid', role: 'result', units: null, loinc: null,
    });
    renderSheet();
    await choose('result-params-menu', 'add-field');
    fireEvent.change(within(addSheet()).getByRole('textbox', { name: 'Name' }), { target: { value: 'HIV rapid' } });
    fireEvent.change(within(addSheet()).getByRole('textbox', { name: 'Code' }), { target: { value: 'HIVR' } });
    await pick('Type', /coded/i);
    expect(within(addSheet()).queryByRole('textbox', { name: 'Unit' })).toBeNull();
    await openMenu('add-field-menu');
    expect((await screen.findByTestId('add-field-save')).getAttribute('data-disabled')).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await pick('Value set', /positive or negative/i);
    await choose('add-field-menu', 'add-field-save');
    expect(api.createResultField).toHaveBeenCalledWith({ code: 'HIVR', display: 'HIV rapid', units: null });
    expect((screen.getByTestId('param-HIVR') as HTMLElement).getAttribute('data-state')).toBe('checked');
  });

  it('keeps a parameter already ticked as it was when a field is added', async () => {
    vi.mocked(api.createResultField).mockResolvedValue({ system: RESULT, code: 'NOTE', display: 'Note', role: 'result', units: null, loinc: null });
    vi.mocked(api.updateCatalogTest).mockResolvedValue(TEST);
    const coded = { ...HGB_PARAM, resultType: 'coded' as const, valueSetUrl: 'urn:openldr:valueset:kept' };
    renderSheet({ ...TEST, resultParams: [coded] });
    await choose('result-params-menu', 'add-field');
    fireEvent.change(within(addSheet()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Note' } });
    await pick('Type', /text/i);
    await choose('add-field-menu', 'add-field-save');
    await choose('test-sheet-menu', 'test-sheet-save');
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams).toEqual([
      coded, { system: RESULT, code: 'NOTE', resultType: 'text', valueSetUrl: null, bands: [] },
    ]);
  });

  it('shows a refusal, such as a code already taken, and ticks nothing', async () => {
    vi.mocked(api.createResultField).mockRejectedValue(new Error('a result field with code HGB already exists.'));
    renderSheet();
    await choose('result-params-menu', 'add-field');
    fireEvent.change(within(addSheet()).getByRole('textbox', { name: 'Name' }), { target: { value: 'HGB' } });
    await choose('add-field-menu', 'add-field-save');
    expect(toast.error).toHaveBeenCalledWith('a result field with code HGB already exists.');
    expect(addSheet()).toBeTruthy();
    expect((screen.getByTestId('param-HGB') as HTMLElement).getAttribute('data-state')).toBe('unchecked');
  });

  it('gives focus back to the Result parameters menu button when the sheet closes', async () => {
    vi.mocked(api.createResultField).mockResolvedValue({ system: RESULT, code: 'NOTE', display: 'Note', role: 'result', units: null, loinc: null });
    renderSheet();
    await choose('result-params-menu', 'add-field');
    fireEvent.change(within(addSheet()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Note' } });
    await choose('add-field-menu', 'add-field-save');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add result field' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('result-params-menu')));
  });
});
