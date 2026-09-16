import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, createCatalogTest: vi.fn(), updateCatalogTest: vi.fn(), setCatalogLabSettings: vi.fn() };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { TestSheet, type TestSheetTarget } from './TestSheet';

const LOCAL = 'urn:openldr:cs:local';
const BLD = { system: LOCAL, code: 'BLD' };
const UR = { system: LOCAL, code: 'UR' };
const OPTIONS: api.TestCatalogOptions = {
  categories: [{ code: 'CHEM', display: 'Chemistry' }, { code: 'MOL', display: 'Molecular' }],
  specimenTypes: [{ ...BLD, display: 'Blood' }, { ...UR, display: 'Urine' }],
  resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', display: 'Haemoglobin' }],
  loinc: null,
};
const HIVVL: api.CatalogTest = {
  code: 'HIVVL', display: 'HIV viral load', shortName: null, category: 'MOL', specimenTypes: [BLD, UR],
  resultParams: [], loinc: '25836-8', active: true, lab: { enabled: false, specimenTypes: null, localDisplay: null },
};

function renderSheet(props: { target?: TestSheetTarget; options?: api.TestCatalogOptions; ownedHere?: boolean } = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <TestSheet
      target={props.target ?? { kind: 'create' }}
      options={props.options ?? OPTIONS}
      ownedHere={props.ownedHere ?? true}
      onSaved={onSaved}
      onClose={onClose}
    />,
  );
  return { onSaved, onClose };
}

// The sheet's Save lives behind its ⋯ menu. Radix menus open on pointerDown in jsdom, with Enter as
// the fallback (as in Connectors.test.tsx).
async function save() {
  const trigger = screen.getByTestId('test-sheet-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByTestId('test-sheet-save');
  await act(async () => { fireEvent.click(item); });
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
}

// Radix Select opens from the keyboard in jsdom.
async function pickCategory(name: RegExp) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Category' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TestSheet', () => {
  it('adds a test with its catalog fields, and leaves this lab settings alone when untouched', async () => {
    vi.mocked(api.createCatalogTest).mockResolvedValue({ ...HIVVL, shortName: 'VL', specimenTypes: [BLD] });
    const { onSaved, onClose } = renderSheet();
    type('Code', 'HIVVL');
    type('Name', 'HIV viral load');
    type('Short name', 'VL');
    await pickCategory(/molecular/i);
    type('LOINC code', '25836-8');
    fireEvent.click(screen.getByTestId('specimen-BLD'));
    await save();
    expect(api.createCatalogTest).toHaveBeenCalledWith({
      code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD],
      resultParams: [], loinc: '25836-8', active: true,
    });
    expect(api.setCatalogLabSettings).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('HIVVL saved.');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches the new test on at this lab in the same save', async () => {
    vi.mocked(api.createCatalogTest).mockResolvedValue({ ...HIVVL, specimenTypes: [], loinc: null });
    vi.mocked(api.setCatalogLabSettings)
      .mockResolvedValue({ ...HIVVL, lab: { enabled: true, specimenTypes: null, localDisplay: 'Viral load' } });
    renderSheet();
    type('Code', 'HIVVL');
    type('Name', 'HIV viral load');
    fireEvent.click(screen.getByRole('switch', { name: 'On at this lab' }));
    type('Local name', 'Viral load');
    await save();
    expect(api.createCatalogTest).toHaveBeenCalledTimes(1);
    expect(api.setCatalogLabSettings).toHaveBeenCalledWith('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
  });

  it('stays open as an edit when the lab step fails, so saving again does not add the test twice', async () => {
    vi.mocked(api.createCatalogTest).mockResolvedValue({ ...HIVVL, specimenTypes: [], loinc: null });
    vi.mocked(api.updateCatalogTest).mockResolvedValue({ ...HIVVL, specimenTypes: [], loinc: null });
    vi.mocked(api.setCatalogLabSettings)
      .mockRejectedValueOnce(new Error('save lab settings failed: 500'))
      .mockResolvedValueOnce({ ...HIVVL, lab: { enabled: true, specimenTypes: null, localDisplay: null } });
    const { onClose } = renderSheet();
    type('Code', 'HIVVL');
    type('Name', 'HIV viral load');
    fireEvent.click(screen.getByRole('switch', { name: 'On at this lab' }));
    await save();
    expect(toast.error).toHaveBeenCalledWith('save lab settings failed: 500');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Edit test' })).toBeInTheDocument();
    await save();
    expect(api.createCatalogTest).toHaveBeenCalledTimes(1);
    expect(api.updateCatalogTest).toHaveBeenCalledWith('HIVVL', expect.objectContaining({ display: 'HIV viral load' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('edits a test without letting its code change', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue({ ...HIVVL, display: 'HIV-1 viral load' });
    renderSheet({ target: { kind: 'edit', test: HIVVL } });
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull();
    expect(screen.getByText('HIVVL')).toBeInTheDocument();
    type('Name', 'HIV-1 viral load');
    fireEvent.click(screen.getByRole('switch', { name: 'Active' }));
    await save();
    expect(api.updateCatalogTest).toHaveBeenCalledWith('HIVVL', {
      display: 'HIV-1 viral load', shortName: null, category: 'MOL', specimenTypes: [BLD, UR], resultParams: [],
      loinc: '25836-8', active: false,
    });
    expect(api.setCatalogLabSettings).not.toHaveBeenCalled();
  });

  it('at a lab that receives central catalog, shows central fields as text and saves only this lab settings', async () => {
    vi.mocked(api.setCatalogLabSettings)
      .mockResolvedValue({ ...HIVVL, lab: { enabled: false, specimenTypes: [BLD], localDisplay: null } });
    renderSheet({ target: { kind: 'edit', test: HIVVL }, ownedHere: false });
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(screen.getByText('HIV viral load')).toBeInTheDocument();
    expect(screen.getByText('Blood, Urine')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lab-specimen-UR'));
    await save();
    expect(api.updateCatalogTest).not.toHaveBeenCalled();
    expect(api.setCatalogLabSettings).toHaveBeenCalledWith('HIVVL', { enabled: false, specimenTypes: [BLD], localDisplay: null });
  });

  it('lays the catalog and lab fields in one grid, so their labels share one column', () => {
    renderSheet();
    const name = screen.getByRole('textbox', { name: 'Name' });
    const localName = screen.getByRole('textbox', { name: 'Local name' });
    expect(name.closest('.grid')).not.toBeNull();
    expect(name.closest('.grid')).toBe(localName.closest('.grid'));
    expect(screen.getByText('Specimens taken')).toBeInTheDocument();
  });

  it('types a LOINC code, and says only its format is checked, when LOINC is not loaded here', () => {
    renderSheet();
    expect(screen.getByRole('textbox', { name: 'LOINC code' })).toBeInTheDocument();
    expect(screen.getByText('LOINC is not loaded here, so only the format is checked.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Search terms' })).toBeNull();
  });

  it('searches LOINC when it is loaded here', () => {
    renderSheet({ options: { ...OPTIONS, loinc: { systemId: 'cs-url-LOINC', system: 'http://loinc.org' } } });
    expect(screen.getByRole('combobox', { name: 'Search terms' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'LOINC code' })).toBeNull();
  });

  it('shows a server refusal and stays open', async () => {
    vi.mocked(api.createCatalogTest).mockRejectedValue(new Error('add test failed: Test HIVVL is already in the catalog.'));
    const { onClose } = renderSheet();
    type('Code', 'HIVVL');
    type('Name', 'HIV viral load');
    await save();
    expect(toast.error).toHaveBeenCalledWith('add test failed: Test HIVVL is already in the catalog.');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TestSheet: result parameters', () => {
  const withParam: api.CatalogTest = {
    ...HIVVL,
    resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null, bands: [] }],
  };

  it('offers each parameter the server listed, unticked when the test names none', () => {
    renderSheet({ target: { kind: 'edit', test: HIVVL } });
    expect(screen.getByTestId('param-HGB')).not.toBeChecked();
    expect(screen.getByText('Haemoglobin')).toBeInTheDocument();
  });

  it('shows a parameter the test already names as ticked, with its type', () => {
    renderSheet({ target: { kind: 'edit', test: withParam } });
    expect(screen.getByTestId('param-HGB')).toBeChecked();
    expect(screen.getByLabelText(/result type for HGB/i)).toBeInTheDocument();
  });

  it('saves a parameter the operator ticked', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    renderSheet({ target: { kind: 'edit', test: HIVVL } });
    fireEvent.click(screen.getByTestId('param-HGB'));
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams).toEqual([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [] },
    ]);
  });

  it('saves a band the operator typed', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    renderSheet({ target: { kind: 'edit', test: withParam } });
    fireEvent.click(screen.getByRole('button', { name: /add band for HGB/i }));
    fireEvent.change(screen.getByLabelText(/low for HGB band 1/i), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/high for HGB band 1/i), { target: { value: '15' } });
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands).toEqual([
      { low: 12, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null },
    ]);
  });

  it('clears the parameters when the operator unticks the last one', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(HIVVL);
    renderSheet({ target: { kind: 'edit', test: withParam } });
    fireEvent.click(screen.getByTestId('param-HGB'));
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams).toEqual([]);
  });
});
