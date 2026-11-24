import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual, createCatalogTest: vi.fn(), updateCatalogTest: vi.fn(), setCatalogLabSettings: vi.fn(), searchTerms: vi.fn(),
    termExists: vi.fn(), fetchLabIdentity: vi.fn(), expandValueSetByUrl: vi.fn(),
  };
});

import * as api from '@/api';
import { TestSheet } from './TestSheet';

// Plan B task 4: each ticked field's ⋯ (Required, Settings, Move up, Move down), the six types, the
// order the fields are drawn in, and a range's plan B fields.

const DICT = 'urn:openldr:default_result';
const COUNTRY_VS = 'urn:openldr:valueset:country';
const OPTIONS: api.TestCatalogOptions = {
  categories: [],
  specimenTypes: [],
  resultParams: [
    { system: DICT, code: 'HGB', display: 'Haemoglobin', units: 'g/dL' },
    { system: DICT, code: 'WBC', display: 'White cells' },
    { system: DICT, code: 'NOTE', display: 'Comment' },
  ],
  loinc: null,
  sexes: [],
};
const param = (code: string, extra: Partial<api.CatalogTestResultParam> = {}): api.CatalogTestResultParam => ({
  system: DICT, code, resultType: 'numeric', valueSetUrl: null, bands: [], ...extra,
});
const TEST = (resultParams: api.CatalogTestResultParam[]): api.CatalogTest => ({
  code: 'FBC', testCode: 'FBC', display: 'Full blood count', shortName: null, category: null, specimenTypes: [],
  resultParams, loinc: null, active: true, expectedTatHours: null, criticalTatHours: null, requiresVerification: true, codings: [],
  lab: { enabled: false, specimenTypes: null, localDisplay: null },
});

function renderSheet(test: api.CatalogTest) {
  render(<TestSheet target={{ kind: 'edit', test }} options={OPTIONS} ownedHere onSaved={vi.fn()} onClose={vi.fn()} />);
}

async function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  await screen.findByRole('menu');
}
async function pick(testId: string, item: string) {
  await openMenu(testId);
  await act(async () => { fireEvent.click(await screen.findByTestId(item)); });
}
async function save() {
  await pick('test-sheet-menu', 'test-sheet-save');
}
const saved = () => vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams ?? [];
async function choose(combobox: HTMLElement, name: string | RegExp) {
  fireEvent.keyDown(combobox, { key: 'ArrowDown' });
  await act(async () => { fireEvent.click(await screen.findByRole('option', { name })); });
}
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.updateCatalogTest).mockImplementation(async (_code, input) => TEST(input.resultParams ?? []));
  vi.mocked(api.fetchLabIdentity).mockResolvedValue({
    fields: [{ id: 'country', labelKey: 'settings.laboratory.country', source: 'country', valueSetUrl: COUNTRY_VS }],
    values: {}, logo: { maxBytes: 0, mimeTypes: [] },
  } as unknown as api.LabIdentityResponse);
  vi.mocked(api.expandValueSetByUrl).mockResolvedValue([
    { system: 'urn:iso:std:iso:3166', code: 'KEN', display: 'Kenya' },
    { system: 'urn:iso:std:iso:3166', code: 'TZA', display: 'Tanzania' },
  ]);
});

describe('TestSheet: a field ⋯ menu', () => {
  it('holds Required, Settings, Move up and Move down, and keeps param-menu on the ranges sub-heading', async () => {
    renderSheet(TEST([param('HGB'), param('WBC')]));
    // Plan A's menu stays on the Reference ranges sub-heading.
    expect(screen.getByTestId('ranges-HGB').contains(screen.getByTestId('param-menu-HGB'))).toBe(true);
    await openMenu('field-menu-HGB');
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Required' })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByTestId('field-settings-HGB')).toHaveTextContent('Settings');
    // The first field cannot go up.
    expect(within(menu).getByTestId('field-up-HGB')).toHaveAttribute('data-disabled');
    expect(within(menu).getByTestId('field-down-HGB')).not.toHaveAttribute('data-disabled');
  });

  it('saves required false when the operator unticks it, and leaves it out when ticked again', async () => {
    renderSheet(TEST([param('HGB')]));
    await pick('field-menu-HGB', 'field-required-HGB');
    await save();
    expect(saved()[0].required).toBe(false);
    vi.mocked(api.updateCatalogTest).mockClear();
    await pick('field-menu-HGB', 'field-required-HGB');
    await save();
    expect(saved()[0]).not.toHaveProperty('required');
  });

  it('offers no Settings for a type that has none', async () => {
    renderSheet(TEST([param('HGB', { resultType: 'boolean' })]));
    await openMenu('field-menu-HGB');
    expect(screen.queryByTestId('field-settings-HGB')).toBeNull();
  });

  it('offers the six result types', async () => {
    renderSheet(TEST([param('HGB')]));
    fireEvent.keyDown(screen.getByLabelText(/result type for HGB/i), { key: 'ArrowDown' });
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(names).toEqual(['numeric', 'coded', 'text', 'yes/no', 'date', 'several answers']);
  });
});

describe('TestSheet: the Field settings sheet', () => {
  it('saves the numeric limits the operator set, leaving a blank one out', async () => {
    renderSheet(TEST([param('HGB')]));
    await pick('field-menu-HGB', 'field-settings-HGB');
    const sheet = await screen.findByRole('dialog', { name: 'Field settings' });
    fireEvent.change(within(sheet).getByLabelText('Minimum'), { target: { value: '0' } });
    fireEvent.change(within(sheet).getByLabelText('Decimal places'), { target: { value: '1' } });
    await pick('field-settings-menu', 'field-settings-apply');
    await save();
    expect(saved()[0]).toEqual({ ...param('HGB'), min: 0, decimals: 1 });
    expect(saved()[0]).not.toHaveProperty('max');
  });

  it('opens with the saved limits and saves the text lengths', async () => {
    renderSheet(TEST([param('NOTE', { resultType: 'text', maxLength: 200 })]));
    await pick('field-menu-NOTE', 'field-settings-NOTE');
    const sheet = await screen.findByRole('dialog', { name: 'Field settings' });
    expect(within(sheet).queryByLabelText('Minimum')).toBeNull();
    expect(within(sheet).getByLabelText('Maximum length')).toHaveValue('200');
    fireEvent.change(within(sheet).getByLabelText('Minimum length'), { target: { value: '2' } });
    await pick('field-settings-menu', 'field-settings-apply');
    await save();
    expect(saved()[0]).toEqual({ ...param('NOTE', { resultType: 'text' }), minLength: 2, maxLength: 200 });
  });

  it('saves a date limit, and leaves any out', async () => {
    renderSheet(TEST([param('NOTE', { resultType: 'date' })]));
    await pick('field-menu-NOTE', 'field-settings-NOTE');
    const sheet = await screen.findByRole('dialog', { name: 'Field settings' });
    await choose(within(sheet).getByRole('combobox', { name: 'Dates allowed' }), 'Past dates only');
    await pick('field-settings-menu', 'field-settings-apply');
    await save();
    expect(saved()[0].dateLimit).toBe('past');
  });

  it('keeps Apply off and says why when the minimum is above the maximum', async () => {
    renderSheet(TEST([param('HGB')]));
    await pick('field-menu-HGB', 'field-settings-HGB');
    const sheet = await screen.findByRole('dialog', { name: 'Field settings' });
    fireEvent.change(within(sheet).getByLabelText('Minimum'), { target: { value: '10' } });
    fireEvent.change(within(sheet).getByLabelText('Maximum'), { target: { value: '5' } });
    expect(within(sheet).getByText('The minimum is above the maximum.')).toBeInTheDocument();
    await openMenu('field-settings-menu');
    expect(screen.getByTestId('field-settings-apply')).toHaveAttribute('data-disabled');
  });

  it('drops the settings when the type changes', async () => {
    renderSheet(TEST([param('HGB', { min: 0, max: 20, required: false })]));
    await choose(screen.getByLabelText(/result type for HGB/i), 'text');
    await save();
    expect(saved()[0]).toEqual({ ...param('HGB', { resultType: 'text' }), required: false });
  });
});

describe('TestSheet: field order', () => {
  it('draws the ticked fields in the saved order, then the unticked, and the ranges the same way', () => {
    renderSheet(TEST([param('WBC'), param('HGB')]));
    expect(before(screen.getByTestId('param-WBC'), screen.getByTestId('param-HGB'))).toBe(true);
    expect(before(screen.getByTestId('param-HGB'), screen.getByTestId('param-NOTE'))).toBe(true);
    expect(before(screen.getByTestId('ranges-WBC'), screen.getByTestId('ranges-HGB'))).toBe(true);
  });

  it('moves a field down and up, in the saved list and on screen', async () => {
    renderSheet(TEST([param('HGB'), param('WBC')]));
    await pick('field-menu-HGB', 'field-down-HGB');
    expect(before(screen.getByTestId('param-WBC'), screen.getByTestId('param-HGB'))).toBe(true);
    expect(before(screen.getByTestId('ranges-WBC'), screen.getByTestId('ranges-HGB'))).toBe(true);
    await save();
    expect(saved().map((p) => p.code)).toEqual(['WBC', 'HGB']);
    vi.mocked(api.updateCatalogTest).mockClear();
    await pick('field-menu-HGB', 'field-up-HGB');
    await save();
    expect(saved().map((p) => p.code)).toEqual(['HGB', 'WBC']);
  });
});

describe('TestSheet: a range plan B fields', () => {
  const ONE_BAND = TEST([param('HGB', { bands: [{ name: null, low: 12, high: 15, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }] })]);

  it('saves a range without them when the operator sets none', async () => {
    renderSheet(ONE_BAND);
    await save();
    const band = saved()[0].bands[0];
    for (const key of ['pregnancy', 'country', 'validFrom', 'validTo', 'source', 'scope']) expect(band).not.toHaveProperty(key);
  });

  it('labels each new field, and saves pregnancy, country, source and scope', async () => {
    renderSheet(ONE_BAND);
    const block = screen.getByTestId('band-HGB-1');
    for (const [word, name] of [['Pregnancy', /pregnancy for HGB band 1/i], ['Country', /country for HGB band 1/i], ['Source', /source for HGB band 1/i], ['Scope', /scope for HGB band 1/i]] as const) {
      const label = within(block).getByText(word, { selector: 'label' });
      expect(label.getAttribute('for')).toBe(screen.getByRole('combobox', { name }).id);
    }
    expect(within(block).getByText('Valid from', { selector: 'label' }).getAttribute('for')).toBe('band-HGB-1-validFrom');
    expect(within(block).getByText('Valid to', { selector: 'label' }).getAttribute('for')).toBe('band-HGB-1-validTo');
    await choose(screen.getByRole('combobox', { name: /pregnancy for HGB band 1/i }), 'not pregnant');
    await choose(screen.getByRole('combobox', { name: /country for HGB band 1/i }), 'Tanzania (TZA)');
    await choose(screen.getByRole('combobox', { name: /source for HGB band 1/i }), 'WHO');
    await choose(screen.getByRole('combobox', { name: /scope for HGB band 1/i }), 'National');
    await save();
    expect(saved()[0].bands[0]).toEqual({
      name: null, low: 12, high: 15, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null,
      pregnancy: 'not-pregnant', country: 'TZA', source: 'WHO', scope: 'national',
    });
    expect(api.expandValueSetByUrl).toHaveBeenCalledWith(COUNTRY_VS);
  });

  it('clears a saved country, source and pregnancy back to none', async () => {
    renderSheet(TEST([param('HGB', { bands: [{ name: null, low: 1, high: 2, unit: null, sex: null, ageLow: null, ageHigh: null, country: 'KEN', source: 'CLSI', pregnancy: 'pregnant' }] })]));
    await choose(screen.getByRole('combobox', { name: /country for HGB band 1/i }), 'none');
    await choose(screen.getByRole('combobox', { name: /source for HGB band 1/i }), 'none');
    await choose(screen.getByRole('combobox', { name: /pregnancy for HGB band 1/i }), 'any');
    await save();
    const band = saved()[0].bands[0];
    for (const key of ['pregnancy', 'country', 'source']) expect(band).not.toHaveProperty(key);
  });

  it('saves the valid-from and valid-to dates picked from the calendar', async () => {
    renderSheet(ONE_BAND);
    const pickDay = async (id: string): Promise<string> => {
      fireEvent.click(document.getElementById(id)!);
      const cell = document.querySelector<HTMLElement>('[data-day]:not([data-outside]) button:not([disabled])')!.closest<HTMLElement>('[data-day]')!;
      await act(async () => { fireEvent.click(cell.querySelector('button')!); });
      return cell.dataset.day!;
    };
    const from = await pickDay('band-HGB-1-validFrom');
    const to = await pickDay('band-HGB-1-validTo');
    await save();
    expect(saved()[0].bands[0]).toMatchObject({ validFrom: from, validTo: to });
  });

  it('shows a saved country the list does not hold by its code', async () => {
    vi.mocked(api.expandValueSetByUrl).mockRejectedValue(new Error('down'));
    renderSheet(TEST([param('HGB', { bands: [{ name: null, low: 1, high: 2, unit: null, sex: null, ageLow: null, ageHigh: null, country: 'KEN' }] })]));
    expect(screen.getByRole('combobox', { name: /country for HGB band 1/i })).toHaveTextContent('KEN');
    await save();
    expect(saved()[0].bands[0].country).toBe('KEN');
  });
});
