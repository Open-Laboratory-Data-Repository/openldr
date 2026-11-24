import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, createCatalogTest: vi.fn(), updateCatalogTest: vi.fn(), setCatalogLabSettings: vi.fn(), searchTerms: vi.fn(), termExists: vi.fn() };
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
  sexes: [{ code: 'female', labels: { en: 'Female', fr: 'Femme', pt: 'Feminino' } }, { code: 'male', labels: { en: 'Male', fr: 'Homme', pt: 'Masculino' } }],
};
const HIVVL: api.CatalogTest = {
  code: 'HIVVL', testCode: 'HIVVL', display: 'HIV viral load', shortName: null, category: 'MOL', specimenTypes: [BLD, UR],
  resultParams: [], loinc: '25836-8', active: true, expectedTatHours: null, criticalTatHours: null, requiresVerification: true,
  lab: { enabled: false, specimenTypes: null, localDisplay: null },
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

async function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  await screen.findByRole('menu');
}

async function addBand(code: string) {
  await openMenu(`param-menu-${code}`);
  await act(async () => { fireEvent.click(await screen.findByTestId(`add-band-${code}`)); });
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
    type('Test code', 'HIVVL');
    type('Name', 'HIV viral load');
    type('Short name', 'VL');
    await pickCategory(/molecular/i);
    type('LOINC', '25836-8');
    fireEvent.click(screen.getByTestId('specimen-BLD'));
    await save();
    expect(api.createCatalogTest).toHaveBeenCalledWith({
      testCode: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD],
      resultParams: [], loinc: '25836-8', active: true, expectedTatHours: null, criticalTatHours: null, requiresVerification: true,
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
    type('Test code', 'HIVVL');
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
    type('Test code', 'HIVVL');
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

  it('edits a saved test, sending its Test code, with the id in the path', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue({ ...HIVVL, display: 'HIV-1 viral load' });
    renderSheet({ target: { kind: 'edit', test: HIVVL } });
    expect(screen.getByRole('textbox', { name: 'Test code' })).toHaveValue('HIVVL');
    type('Name', 'HIV-1 viral load');
    fireEvent.click(screen.getByRole('switch', { name: 'Active' }));
    await save();
    expect(api.updateCatalogTest).toHaveBeenCalledWith('HIVVL', {
      testCode: 'HIVVL', display: 'HIV-1 viral load', shortName: null, category: 'MOL', specimenTypes: [BLD, UR], resultParams: [],
      loinc: '25836-8', active: false, expectedTatHours: null, criticalTatHours: null, requiresVerification: true,
    });
    expect(api.setCatalogLabSettings).not.toHaveBeenCalled();
  });

  // Test identity spec, call 4: the Test code can change. The id in the path never does.
  it("changes a saved test's Test code, keeps its id in the path, and names the new code", async () => {
    const test = { ...HIVVL, code: 'tst-0123456789abcdef', testCode: 'HIVVL' };
    vi.mocked(api.updateCatalogTest).mockResolvedValue({ ...test, testCode: 'VL' });
    renderSheet({ target: { kind: 'edit', test } });
    expect(screen.getByText('Internal id: tst-0123456789abcdef')).toBeInTheDocument();
    type('Test code', '  VL ');
    await save();
    expect(api.updateCatalogTest).toHaveBeenCalledWith('tst-0123456789abcdef', expect.objectContaining({ testCode: 'VL' }));
    expect(toast.success).toHaveBeenCalledWith('VL saved.');
  });

  it('shows no internal id line when the id is the Test code', () => {
    renderSheet({ target: { kind: 'edit', test: HIVVL } });
    expect(screen.queryByText(/Internal id/)).toBeNull();
  });

  it('puts Test code first in Basic information', () => {
    renderSheet();
    const labels = [...document.querySelectorAll('label')].map((l) => l.textContent);
    // LOINC is the row above Basic information.
    expect(labels.slice(0, 3)).toEqual(['LOINC', 'Test code', 'Name']);
  });

  it('keeps Save off while the Test code is empty, and says it is required', async () => {
    renderSheet();
    type('Name', 'HIV viral load');
    type('Test code', '   ');
    expect(screen.getByText('Required. Use the code from your national test list.')).toBeInTheDocument();
    const trigger = screen.getByTestId('test-sheet-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByTestId('test-sheet-save')).toHaveAttribute('data-disabled');
    await act(async () => { fireEvent.click(screen.getByTestId('test-sheet-save')); });
    expect(api.createCatalogTest).not.toHaveBeenCalled();
  });

  it('shows the Test code and the id as text at a lab that receives central catalog', () => {
    renderSheet({ target: { kind: 'edit', test: { ...HIVVL, code: 'tst-0123456789abcdef', testCode: 'HIVVL' } }, ownedHere: false });
    expect(screen.queryByRole('textbox', { name: 'Test code' })).toBeNull();
    expect(screen.getByText('HIVVL')).toBeInTheDocument();
    expect(screen.getByText('Internal id: tst-0123456789abcdef')).toBeInTheDocument();
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

  it('saves the turnaround times and the verification switch the operator set', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(HIVVL);
    renderSheet({ target: { kind: 'edit', test: { ...HIVVL, expectedTatHours: 48 } } });
    expect(screen.getByRole('textbox', { name: 'Expected TAT (hours)' })).toHaveValue('48');
    type('Expected TAT (hours)', '');
    type('Critical TAT (hours)', '0.5');
    fireEvent.click(screen.getByRole('switch', { name: 'Requires verification' }));
    await save();
    expect(api.updateCatalogTest).toHaveBeenCalledWith('HIVVL', expect.objectContaining({
      expectedTatHours: null, criticalTatHours: 0.5, requiresVerification: false,
    }));
  });

  it('shows central turnaround times and verification as text at a lab that receives central catalog', () => {
    renderSheet({ target: { kind: 'edit', test: { ...HIVVL, expectedTatHours: 1, criticalTatHours: 72, requiresVerification: false } }, ownedHere: false });
    expect(screen.queryByRole('textbox', { name: 'Expected TAT (hours)' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Requires verification' })).toBeNull();
    expect(screen.getByText('1 hour')).toBeInTheDocument();
    expect(screen.getByText('72 hours')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
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
    expect(screen.getByRole('textbox', { name: 'LOINC' })).toBeInTheDocument();
    expect(screen.getByText('LOINC is not loaded here, so only the format is checked.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Search terms' })).toBeNull();
  });

  it('searches LOINC when it is loaded here', () => {
    renderSheet({ options: { ...OPTIONS, loinc: { systemId: 'cs-url-LOINC', system: 'http://loinc.org' } } });
    expect(screen.getByRole('combobox', { name: 'Search terms' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'LOINC' })).toBeNull();
  });

  it('shows a server refusal and stays open', async () => {
    vi.mocked(api.createCatalogTest).mockRejectedValue(new Error('add test failed: Test HIVVL is already in the catalog.'));
    const { onClose } = renderSheet();
    type('Test code', 'HIVVL');
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
    await addBand('HGB');
    fireEvent.change(screen.getByLabelText(/low for HGB band 1/i), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/high for HGB band 1/i), { target: { value: '15' } });
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands).toEqual([
      { name: null, low: 12, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null },
    ]);
  });

  it('reads text that is not a number as a blank bound, never NaN', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    renderSheet({ target: { kind: 'edit', test: withParam } });
    await addBand('HGB');
    fireEvent.change(screen.getByLabelText(/low for HGB band 1/i), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/age from for HGB band 1/i), { target: { value: '-' } });
    expect(screen.getByLabelText(/low for HGB band 1/i)).toHaveValue('');
    await save();
    const [band] = vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands ?? [];
    expect(band.low).toBeNull();
    expect(band.ageLow).toBeNull();
  });

  // On a phone the range fields stack, so a filled low or high box read as a bare number. Every field
  // now has a visible word beside it. Found on the live sheet at 375px, 2026-09-16.
  it('labels every field of a range with a visible word tied to its input', () => {
    const oneBand: api.CatalogTest = { ...withParam, resultParams: [{ ...withParam.resultParams[0], bands: [
      { name: 'Highland women', low: 13, high: 17, unit: null, sex: 'female', ageLow: 15, ageHigh: null },
    ] }] };
    renderSheet({ target: { kind: 'edit', test: oneBand } });
    const block = screen.getByTestId('band-HGB-1');
    const pairs: Array<[string, RegExp]> = [
      ['Name', /name for HGB band 1/i], ['Low', /low for HGB band 1/i], ['High', /high for HGB band 1/i],
      ['Unit', /^unit for HGB band 1/i], ['Age from', /age from for HGB band 1/i], ['Age to', /age to for HGB band 1/i],
    ];
    for (const [word, control] of pairs) {
      const label = within(block).getByText(word, { selector: 'label' });
      expect(label.getAttribute('for')).toBe(screen.getByLabelText(control).id);
    }
    const sex = within(block).getByText('Sex', { selector: 'label' });
    expect(sex.getAttribute('for')).toBe(screen.getByRole('combobox', { name: /sex for HGB band 1/i }).id);
  });

  // A bound was shown as String(number), so typing "11." parsed to 11 and redrew as "11": the dot
  // was lost and "11.5" saved as 115. A leading "-" cleared the field the same way.
  it('keeps a decimal point and a minus sign while the operator types a bound, one key at a time', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    const user = userEvent.setup();
    renderSheet({ target: { kind: 'edit', test: withParam } });
    await addBand('HGB');
    const low = screen.getByLabelText(/low for HGB band 1/i);
    await user.type(low, '11.');
    expect(low).toHaveValue('11.');
    await user.type(low, '5');
    expect(low).toHaveValue('11.5');
    const high = screen.getByLabelText(/high for HGB band 1/i);
    await user.type(high, '-');
    expect(high).toHaveValue('-');
    await user.type(high, '0.5');
    expect(high).toHaveValue('-0.5');
    await user.type(screen.getByLabelText(/age from for HGB band 1/i), '0.25');
    await user.type(screen.getByLabelText(/age to for HGB band 1/i), '1.5');
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands).toEqual([
      { name: null, low: 11.5, high: -0.5, unit: null, sex: null, ageLow: 0.25, ageHigh: 1.5 },
    ]);
  });

  it('shows critical low and high beside the age fields and saves them', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    renderSheet({ target: { kind: 'edit', test: withParam } });
    await addBand('HGB');
    const block = screen.getByTestId('band-HGB-1');
    const low = screen.getByLabelText(/critical low limit for HGB band 1/i);
    const high = screen.getByLabelText(/critical high limit for HGB band 1/i);
    expect(within(block).getByText('Critical low', { selector: 'label' }).getAttribute('for')).toBe(low.id);
    expect(within(block).getByText('Critical high', { selector: 'label' }).getAttribute('for')).toBe(high.id);
    fireEvent.change(screen.getByLabelText(/^low for HGB band 1/i), { target: { value: '12' } });
    fireEvent.change(low, { target: { value: '7' } });
    fireEvent.change(high, { target: { value: '20' } });
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands).toEqual([
      { name: null, low: 12, high: null, unit: null, sex: null, ageLow: null, ageHigh: null, criticalLow: 7, criticalHigh: 20 },
    ]);
  });

  it('shows the critical limits a saved range already has', () => {
    const oneBand: api.CatalogTest = { ...withParam, resultParams: [{ ...withParam.resultParams[0], bands: [
      { name: null, low: 12, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null, criticalLow: 7, criticalHigh: 20 },
    ] }] };
    renderSheet({ target: { kind: 'edit', test: oneBand } });
    expect(screen.getByLabelText(/critical low limit for HGB band 1/i)).toHaveValue('7');
    expect(screen.getByLabelText(/critical high limit for HGB band 1/i)).toHaveValue('20');
  });

  it('saves a range name, sex and age the operator set', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    renderSheet({ target: { kind: 'edit', test: withParam } });
    await addBand('HGB');
    fireEvent.change(screen.getByLabelText(/name for HGB band 1/i), { target: { value: 'Highland women' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: /sex for HGB band 1/i }), { key: 'ArrowDown' });
    await act(async () => { fireEvent.click(await screen.findByRole('option', { name: 'Female' })); });
    fireEvent.change(screen.getByLabelText(/age from for HGB band 1/i), { target: { value: '15' } });
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands).toEqual([
      { name: 'Highland women', low: null, high: null, unit: null, sex: 'female', ageLow: 15, ageHigh: null },
    ]);
  });

  it('saves the age unit the operator picked, and shows an unnamed range by it', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    renderSheet({ target: { kind: 'edit', test: withParam } });
    await addBand('HGB');
    const unit = screen.getByRole('combobox', { name: /age unit for HGB band 1/i });
    // A new range is in years until the operator picks another unit.
    expect(unit).toHaveTextContent('Years');
    expect(within(screen.getByTestId('band-HGB-1')).getByText('Age in', { selector: 'label' }).getAttribute('for')).toBe(unit.id);
    fireEvent.keyDown(unit, { key: 'ArrowDown' });
    await act(async () => { fireEvent.click(await screen.findByRole('option', { name: 'Days' })); });
    fireEvent.change(screen.getByLabelText(/age to for HGB band 1/i), { target: { value: '28' } });
    expect(screen.getByLabelText(/name for HGB band 1/i)).toHaveAttribute('placeholder', 'up to 28 days');
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands).toEqual([
      { name: null, low: null, high: null, unit: null, sex: null, ageLow: null, ageHigh: 28, ageUnit: 'd' },
    ]);
  });

  it('keeps a range saved before units without a unit when the operator does not touch it', async () => {
    const old: api.CatalogTest = { ...withParam, resultParams: [{ ...withParam.resultParams[0], bands: [
      { name: null, low: 11, high: 14, unit: null, sex: null, ageLow: 2, ageHigh: 17 },
    ] }] };
    vi.mocked(api.updateCatalogTest).mockResolvedValue(old);
    renderSheet({ target: { kind: 'edit', test: old } });
    expect(screen.getByRole('combobox', { name: /age unit for HGB band 1/i })).toHaveTextContent('Years');
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands[0]).not.toHaveProperty('ageUnit');
  });

  it('moves a range up, and removes one, from the range menu', async () => {
    const twoBands: api.CatalogTest = { ...withParam, resultParams: [{ ...withParam.resultParams[0], bands: [
      { name: 'Lowland', low: 11, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null },
      { name: 'Highland', low: 12, high: 16, unit: null, sex: null, ageLow: null, ageHigh: null },
    ] }] };
    vi.mocked(api.updateCatalogTest).mockResolvedValue(twoBands);
    renderSheet({ target: { kind: 'edit', test: twoBands } });
    await openMenu('band-menu-HGB-2');
    await act(async () => { fireEvent.click(await screen.findByTestId('band-up-HGB-2')); });
    await openMenu('band-menu-HGB-2');
    await act(async () => { fireEvent.click(await screen.findByTestId('band-remove-HGB-2')); });
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands.map((b) => b.name)).toEqual(['Highland']);
  });

  it('clears the parameters when the operator unticks the last one', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(HIVVL);
    renderSheet({ target: { kind: 'edit', test: withParam } });
    fireEvent.click(screen.getByTestId('param-HGB'));
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams).toEqual([]);
  });
});

describe('TestSheet: a range unit from UCUM', () => {
  const UCUM = 'http://unitsofmeasure.org';
  const WITH_UCUM: api.TestCatalogOptions = {
    ...OPTIONS,
    resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', display: 'Haemoglobin', units: 'g/dL' }],
    ucum: { systemId: 'cs-ucum-seed', system: UCUM },
  };
  const withParam: api.CatalogTest = {
    ...HIVVL,
    resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null, bands: [] }],
  };
  const term = (code: string, display: string | null): api.Term => ({
    system: UCUM, code, display, status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null, mappingCount: 0,
  });
  const bandsSaved = () => vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands ?? [];

  async function clearUnit() {
    await act(async () => { fireEvent.click(within(screen.getByTestId('band-HGB-1')).getByRole('button', { name: 'Clear' })); });
  }
  async function typeUnit(text: string) {
    const box = screen.getByRole('combobox', { name: /^unit for HGB band 1/i });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: text } });
  }

  it('starts a new range with the result field unit', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    renderSheet({ target: { kind: 'edit', test: withParam }, options: WITH_UCUM });
    await addBand('HGB');
    expect(within(screen.getByTestId('band-HGB-1')).getByText('g/dL')).toBeInTheDocument();
    await save();
    expect(bandsSaved()[0].unit).toBe('g/dL');
  });

  it('saves the code of a UCUM unit the operator picked', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    vi.mocked(api.searchTerms).mockResolvedValue({ rows: [term('mg/dL', 'milligram per deciliter')], total: 1 });
    renderSheet({ target: { kind: 'edit', test: withParam }, options: WITH_UCUM });
    await addBand('HGB');
    await clearUnit();
    await typeUnit('mg');
    fireEvent.click(await screen.findByRole('option', { name: /mg\/dL/ }));
    expect(vi.mocked(api.searchTerms).mock.calls[0][0]).toBe('cs-ucum-seed');
    expect(screen.queryByText('Not a UCUM unit')).toBeNull();
    await save();
    expect(bandsSaved()[0].unit).toBe('mg/dL');
  });

  it('keeps a typed unit UCUM does not hold, and says so', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    vi.mocked(api.searchTerms).mockResolvedValue({ rows: [], total: 0 });
    vi.mocked(api.termExists).mockResolvedValue(false);
    renderSheet({ target: { kind: 'edit', test: withParam }, options: WITH_UCUM });
    await addBand('HGB');
    await clearUnit();
    await typeUnit('cells');
    // Found outside act. Awaiting this findBy inside act hung the test past its 5s limit.
    const use = await screen.findByRole('button', { name: 'Use "cells"' });
    await act(async () => { fireEvent.click(use); });
    expect(await screen.findByText('Not a UCUM unit')).toBeInTheDocument();
    await save();
    expect(bandsSaved()[0].unit).toBe('cells');
  });

  // The search matches substrings and sorts by code, so "g" can have hundreds of rows before its own.
  // The check looks the exact code up instead.
  it('does not call a short UCUM code typed by hand a non-UCUM unit, even past 500 search rows', async () => {
    const many = Array.from({ length: 500 }, (_, i) => term(`${i}.g`, null));
    vi.mocked(api.searchTerms).mockResolvedValue({ rows: many, total: 501 });
    vi.mocked(api.termExists).mockResolvedValue(true);
    renderSheet({ target: { kind: 'edit', test: withParam }, options: WITH_UCUM });
    await addBand('HGB');
    await clearUnit();
    await typeUnit('g');
    // Found outside act. Awaiting this findBy inside act hung the test past its 5s limit.
    const use = await screen.findByRole('button', { name: 'Use "g"' });
    await act(async () => { fireEvent.click(use); });
    expect(vi.mocked(api.termExists)).toHaveBeenLastCalledWith(UCUM, 'g');
    expect(screen.queryByText('Not a UCUM unit')).toBeNull();
  });

  it('drops the note once the same unit is picked from UCUM', async () => {
    vi.mocked(api.searchTerms).mockResolvedValueOnce({ rows: [], total: 0 })
      .mockResolvedValue({ rows: [term('mmol/L', 'millimole per liter')], total: 1 });
    vi.mocked(api.termExists).mockResolvedValue(false);
    renderSheet({ target: { kind: 'edit', test: withParam }, options: WITH_UCUM });
    await addBand('HGB');
    await clearUnit();
    await typeUnit('mmol/L');
    const use = await screen.findByRole('button', { name: 'Use "mmol/L"' });
    await act(async () => { fireEvent.click(use); });
    expect(await screen.findByText('Not a UCUM unit')).toBeInTheDocument();
    await clearUnit();
    await typeUnit('mmol/L');
    fireEvent.click(await screen.findByRole('option', { name: /mmol\/L/ }));
    expect(screen.queryByText('Not a UCUM unit')).toBeNull();
  });

  it('opens a saved unit that is not UCUM unchanged, and saves it as it was', async () => {
    const saved: api.CatalogTest = { ...withParam, resultParams: [{ ...withParam.resultParams[0], bands: [
      { name: null, low: 1, high: 2, unit: 'cells/hpf', sex: null, ageLow: null, ageHigh: null },
    ] }] };
    vi.mocked(api.updateCatalogTest).mockResolvedValue(saved);
    renderSheet({ target: { kind: 'edit', test: saved }, options: WITH_UCUM });
    expect(within(screen.getByTestId('band-HGB-1')).getByText('cells/hpf')).toBeInTheDocument();
    expect(screen.queryByText('Not a UCUM unit')).toBeNull();
    await save();
    expect(bandsSaved()[0].unit).toBe('cells/hpf');
    expect(api.searchTerms).not.toHaveBeenCalled();
    expect(api.termExists).not.toHaveBeenCalled();
  });

  it('keeps the plain unit box when this install has no UCUM, prefilled from the result field', async () => {
    renderSheet({ target: { kind: 'edit', test: withParam }, options: { ...WITH_UCUM, ucum: null } });
    await addBand('HGB');
    expect(screen.getByRole('textbox', { name: /unit for HGB band 1/i })).toHaveValue('g/dL');
  });

  // jsdom has no layout, so this pins the classes that let the range wrap at 375px: one label and
  // field per line below sm, and a unit box that may shrink. A browser at 375px must still confirm it.
  it('keeps the range one field per line on a phone with the unit picker in it', async () => {
    renderSheet({ target: { kind: 'edit', test: withParam }, options: WITH_UCUM });
    await addBand('HGB');
    await clearUnit();
    const box = screen.getByRole('combobox', { name: /^unit for HGB band 1/i });
    const grid = box.closest('.grid') as HTMLElement;
    expect(grid.className).toMatch(/(^| )grid-cols-\[auto_minmax\(0,1fr\)\]( |$)/);
    expect(box.closest('.min-w-0')).not.toBeNull();
  });
});

// Spec section 2: the sheet reads top to bottom as Corlix's test editor does, LOINC first. LOINC is one
// row (label, picker, menu) with no title line, so the titled sections start at Basic information.
describe('TestSheet: the order of its sections', () => {
  const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  const OWNED = ['Basic information', 'Specimen types', 'Result parameters', 'Reference ranges', 'This lab'];
  const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const basic = () => screen.getByRole('heading', { level: 3, name: 'Basic information' });

  it('puts the LOINC row first on a new test, with no title line of its own', () => {
    renderSheet();
    expect(headings()).toEqual(OWNED);
    const loinc = screen.getByRole('textbox', { name: 'LOINC' });
    expect(before(loinc, basic())).toBe(true);
    expect(before(basic(), screen.getByRole('textbox', { name: 'Test code' }))).toBe(true);
    // The rule between the LOINC row and Basic information still bleeds to the sheet edges.
    expect(basic().parentElement!.previousElementSibling!.className).toContain('-mx-6');
  });

  it('puts the LOINC row first on a saved test', () => {
    renderSheet({ target: { kind: 'edit', test: HIVVL } });
    expect(headings()).toEqual(OWNED);
    expect(before(screen.getByRole('textbox', { name: 'LOINC' }), basic())).toBe(true);
  });

  it('keeps the same order in the read-only view, with the LOINC row first and this lab last', () => {
    renderSheet({ target: { kind: 'edit', test: HIVVL }, ownedHere: false });
    expect(headings()).toEqual(['Basic information', 'Specimen types', 'This lab']);
    const label = screen.getByText('LOINC', { selector: 'label' });
    expect(label.nextElementSibling!.textContent).toBe('25836-8');
    expect(before(label, basic())).toBe(true);
  });
});

describe('TestSheet: the Reference ranges section', () => {
  const WITH_UNIT: api.TestCatalogOptions = {
    ...OPTIONS,
    resultParams: [
      { system: 'urn:openldr:default_result', code: 'HGB', display: 'Haemoglobin', units: 'g/dL' },
      { system: 'urn:openldr:default_result', code: 'GRP', display: 'Blood group' },
    ],
  };
  const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const rangesHeading = () => screen.getByRole('heading', { level: 3, name: 'Reference ranges' });

  it('shows a ticked numeric field under Reference ranges, and Add range there starts with its unit', async () => {
    const test: api.CatalogTest = { ...HIVVL, resultParams: [
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [] },
      { system: 'urn:openldr:default_result', code: 'GRP', resultType: 'coded', valueSetUrl: null, bands: [] },
    ] };
    renderSheet({ target: { kind: 'edit', test }, options: WITH_UNIT });
    // The field list stays in Result parameters, above the ranges.
    expect(before(screen.getByTestId('param-HGB'), rangesHeading())).toBe(true);
    const sub = screen.getByTestId('ranges-HGB');
    expect(before(rangesHeading(), sub)).toBe(true);
    expect(sub.textContent).toContain('Haemoglobin');
    // A coded field has no ranges, so no sub-heading.
    expect(screen.queryByTestId('ranges-GRP')).toBeNull();
    expect(before(rangesHeading(), screen.getByTestId('param-menu-HGB'))).toBe(true);
    await addBand('HGB');
    const band = screen.getByTestId('band-HGB-1');
    expect(before(sub, band)).toBe(true);
    expect(screen.getByRole('textbox', { name: /unit for HGB band 1/i })).toHaveValue('g/dL');
  });

  it('says to tick a numeric field when no ticked field can have ranges', () => {
    renderSheet({ target: { kind: 'edit', test: HIVVL }, options: WITH_UNIT });
    expect(screen.getByText('Tick a numeric result field to give it reference ranges.')).toBeInTheDocument();
    expect(screen.queryByTestId('ranges-HGB')).toBeNull();
  });
});
