import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
// The LOINC picker is a search box. Here it is a button per code, so a test can pick one. It also
// draws its second line for one sample term, so a test can read what the sheet passes as `detail`.
vi.mock('@/terminology/TermPicker', () => ({
  TermPicker: ({ onChange, ariaLabel, detail }: {
    onChange: (v: { system: string; code: string; display: string | null } | null) => void; ariaLabel?: string;
    detail?: (t: { shortName: string | null; class: string | null; unit: string | null }) => string | null;
  }) => (
    <div>
      {['6429-5', '2093-3', '24331-1'].map((code) => (
        <button key={code} type="button" data-testid={`pick-${code}`} aria-label={ariaLabel} onClick={() => onChange({ system: 'http://loinc.org', code, display: null })}>{code}</button>
      ))}
      {detail ? <span data-testid="detail-sample">{detail({ shortName: 'Cholest SerPl-mCnc', class: 'CHEM', unit: null })}</span> : null}
    </div>
  ),
}));
// The LOINC tree. Here it is one button that picks 2093-3, as a click on a node would.
vi.mock('@/terminology/ontology/OntologyBrowser', () => ({
  OntologyBrowser: ({ onPick, codingSystemId }: { onPick: (n: { code: string; display: string }) => void; codingSystemId: string }) => (
    <button type="button" data-testid={`browser-pick-${codingSystemId}`} onClick={() => onPick({ code: '2093-3', display: 'Cholesterol' })}>pick</button>
  ),
}));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual, createCatalogTest: vi.fn(), updateCatalogTest: vi.fn(), setCatalogLabSettings: vi.fn(),
    termExists: vi.fn(), getLoincHints: vi.fn(), resultFieldsFromLoinc: vi.fn(), listValueSets: vi.fn(),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { TestSheet } from './TestSheet';

const LOCAL = 'urn:openldr:cs:local';
const RESULT = 'urn:openldr:default_result';
const OPTIONS: api.TestCatalogOptions = {
  categories: [{ code: 'CHEM', display: 'Chemistry' }, { code: 'MICRO', display: 'Microbiology' }],
  specimenTypes: [{ system: LOCAL, code: 'BLD', display: 'Blood' }, { system: LOCAL, code: 'UR', display: 'Urine' }],
  resultParams: [{ system: RESULT, code: 'HGB', display: 'Haemoglobin' }],
  loinc: { systemId: 'loinc-id', system: 'http://loinc.org' },
  sexes: [],
};
const NEW_TEST = (over: Partial<api.CatalogTest> = {}): api.CatalogTest => ({
  code: 'T1', display: 'Test one', shortName: null, category: null, specimenTypes: [],
  resultParams: [], loinc: null, active: true, expectedTatHours: null, criticalTatHours: null, requiresVerification: true,
  lab: { enabled: false, specimenTypes: null, localDisplay: null }, ...over,
});

// The route's answers in task-4-report.md, for the fixture, with Task 1's fields (loinc-hints.ts).
const NO_FIELD = { shortName: null, component: null, systemPart: null, field: null, fieldProblem: null };
const HIV: api.LoincHints = {
  ...NO_FIELD,
  code: '6429-5', display: 'HIV identified in Blood by culture', class: 'MICRO',
  categorySuggestion: { code: 'MICRO', display: 'Microbiology' }, unit: null, resultType: 'text',
  specimens: [
    { snomed: '119297000', display: null, equivalence: 'equivalent', specimenType: { system: LOCAL, code: 'BLD', display: 'Blood' }, tick: true, via: 'snomed' },
    { snomed: '122555007', display: null, equivalence: 'narrower', specimenType: null, tick: false, via: 'snomed' },
  ],
  answers: [], panelMembers: [],
};
const CHOL: api.LoincHints = {
  code: '2093-3', display: 'Cholesterol [Mass/volume] in Serum or Plasma', shortName: 'Cholest SerPl-mCnc',
  component: 'Cholesterol', systemPart: 'Ser/Plas', class: 'CHEM', categorySuggestion: { code: 'CHEM', display: 'Chemistry' },
  unit: 'mg/dL', resultType: 'numeric', specimens: [], answers: [], panelMembers: [],
  field: { loinc: '2093-3', code: '2093-3', display: 'Cholesterol', resultType: 'numeric', unit: 'mg/dL', valueSetUrl: null, exists: false },
  fieldProblem: null,
};
const LIPID: api.LoincHints = {
  ...NO_FIELD,
  code: '24331-1', display: 'Lipid panel', class: 'PANEL.CHEM', categorySuggestion: null, unit: null, resultType: 'text',
  specimens: [], answers: [],
  panelMembers: [
    { code: '2093-3', display: 'Cholesterol', required: true, field: null, fieldProblem: null },
    { code: '2571-8', display: 'Triglyceride', required: false, field: null, fieldProblem: null },
  ],
};
const param = (code: string, over: Partial<api.CatalogTestResultParam> = {}): api.CatalogTestResultParam => (
  { system: RESULT, code, resultType: 'numeric', valueSetUrl: null, bands: [], ...over });
const answer = (params: api.CatalogTestResultParam[]): api.ResultFieldsFromLoincAnswer => (
  { params, created: params.map((p) => p.code), reused: [], valueSetsCreated: [] });
const hintsFor = (map: Record<string, api.LoincHints | null>) => vi.mocked(api.getLoincHints).mockImplementation(async (c) => map[c] ?? null);

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
async function pickLoinc(code: string) {
  await act(async () => { fireEvent.click(screen.getByTestId(`pick-${code}`)); });
}
async function savedParams(): Promise<api.CatalogTestResultParam[]> {
  vi.mocked(api.updateCatalogTest).mockResolvedValue(NEW_TEST());
  await choose('test-sheet-menu', 'test-sheet-save');
  return vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams ?? [];
}
const checked = (id: string) => screen.getByTestId(id).getAttribute('data-state') === 'checked';
const categoryText = () => screen.getByRole('combobox', { name: 'Category' }).textContent;

function renderSheet(test: api.CatalogTest = NEW_TEST(), options: api.TestCatalogOptions = OPTIONS) {
  const view = render(<TestSheet target={{ kind: 'edit', test }} options={options} ownedHere onSaved={vi.fn()} onClose={vi.fn()} onOptionsChanged={vi.fn()} />);
  return view;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('TestSheet: LOINC hints fill empty fields', () => {
  it('fills the category and the one equivalent specimen, and only suggests the result field', async () => {
    hintsFor({ '2093-3': CHOL, '6429-5': HIV });
    renderSheet();
    await pickLoinc('6429-5');
    expect(categoryText()).toBe('Microbiology');
    expect(checked('specimen-BLD')).toBe(true);
    expect(checked('specimen-UR')).toBe(false);
    // A pick writes nothing: LOINC's field is a hint line until the menu adds it.
    expect(api.resultFieldsFromLoinc).not.toHaveBeenCalled();
    expect(screen.getByTestId('hint-result').textContent).toBe("LOINC's result field: HIV identified in Blood by culture.");
    // The narrower SNOMED match is only suggested, with how to make it tick by itself.
    expect(screen.getByTestId('hint-specimens').textContent).toBe('LOINC suggests SNOMED 122555007.');
    expect(screen.getByTestId('hint-specimens-map')).toBeTruthy();
    expect(screen.queryByTestId('hint-category')).toBeNull();
  });

  it("Use LOINC's result field makes and ticks it, and a new range on it starts with LOINC's unit", async () => {
    hintsFor({ '2093-3': CHOL });
    vi.mocked(api.resultFieldsFromLoinc).mockResolvedValue(answer([param('2093-3')]));
    renderSheet();
    await pickLoinc('2093-3');
    await choose('result-params-menu', 'use-loinc-field');
    expect(api.resultFieldsFromLoinc).toHaveBeenCalledWith(['2093-3'], false);
    expect(checked('param-2093-3')).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('1 result field from LOINC ticked on this test.');
    expect(screen.queryByTestId('hint-result')).toBeNull();
    await choose('param-menu-2093-3', 'add-band-2093-3');
    expect(screen.getByRole('textbox', { name: 'unit for 2093-3 band 1' })).toHaveProperty('value', 'mg/dL');
  });

  it("drops the hint after Use LOINC's result field reused a field with its own code", async () => {
    hintsFor({ '2093-3': CHOL });
    const options = { ...OPTIONS, resultParams: [...OPTIONS.resultParams, { system: RESULT, code: 'CHOL', display: 'Cholesterol', units: 'mg/dL' }] };
    vi.mocked(api.resultFieldsFromLoinc).mockResolvedValue({ params: [param('CHOL')], created: [], reused: ['CHOL'], valueSetsCreated: [] });
    renderSheet(NEW_TEST(), options);
    await pickLoinc('2093-3');
    expect(screen.getByTestId('hint-result')).toBeTruthy();
    await choose('result-params-menu', 'use-loinc-field');
    expect(checked('param-CHOL')).toBe(true);
    expect(screen.queryByTestId('hint-result')).toBeNull();
  });

  it('picking one code and then another ticks nothing until the menu is used, and the menu uses the last code', async () => {
    hintsFor({ '2093-3': CHOL, '6429-5': HIV });
    vi.mocked(api.resultFieldsFromLoinc).mockResolvedValue(answer([param('2093-3')]));
    renderSheet();
    await pickLoinc('6429-5');
    await pickLoinc('2093-3');
    expect(api.resultFieldsFromLoinc).not.toHaveBeenCalled();
    expect(screen.queryByTestId('param-6429-5')).toBeNull();
    expect(screen.getByTestId('hint-result').textContent).toBe("LOINC's result field: Cholesterol [Mass/volume] in Serum or Plasma (mg/dL).");
    await choose('result-params-menu', 'use-loinc-field');
    expect(api.resultFieldsFromLoinc).toHaveBeenCalledTimes(1);
    expect(api.resultFieldsFromLoinc).toHaveBeenCalledWith(['2093-3'], false);
    expect(await savedParams()).toEqual([param('2093-3')]);
  });

  // Review focus 3.
  it('never overwrites a category, specimen or field already set, and says what LOINC suggests instead', async () => {
    hintsFor({ '6429-5': HIV });
    const kept = param('HGB', { resultType: 'coded', valueSetUrl: 'urn:openldr:valueset:kept' });
    renderSheet(NEW_TEST({ category: 'CHEM', specimenTypes: [{ system: LOCAL, code: 'UR' }], resultParams: [kept] }));
    await pickLoinc('6429-5');
    expect(categoryText()).toBe('Chemistry');
    expect(screen.getByTestId('hint-category').textContent).toBe('Microbiology, suggested');
    expect([checked('specimen-UR'), checked('specimen-BLD')]).toEqual([true, false]);
    // Blood is marked on its own checkbox, so the line keeps only the SNOMED code no specimen type matched.
    expect(screen.getByTestId('suggested-BLD')).toBeTruthy();
    expect(screen.getByTestId('hint-specimens').textContent).toBe('LOINC suggests SNOMED 122555007.');
    expect(api.resultFieldsFromLoinc).not.toHaveBeenCalled();
    expect(screen.getByTestId('hint-result').textContent).toBe("LOINC's result field: HIV identified in Blood by culture.");
    expect(await savedParams()).toEqual([kept]);
  });

  it("Use LOINC's result field keeps a parameter already ticked, its value set included", async () => {
    hintsFor({ '6429-5': HIV });
    const kept = param('6429-5', { resultType: 'coded', valueSetUrl: 'urn:openldr:valueset:mine' });
    vi.mocked(api.resultFieldsFromLoinc).mockResolvedValue(answer([param('6429-5', { resultType: 'text' })]));
    renderSheet(NEW_TEST({ loinc: '6429-5', resultParams: [kept] }));
    await waitFor(() => expect(api.getLoincHints).toHaveBeenCalledWith('6429-5'));
    await choose('result-params-menu', 'use-loinc-field');
    expect(toast.success).toHaveBeenCalledWith("LOINC's result fields are already on this test.");
    expect(await savedParams()).toEqual([kept]);
  });

  it('opens a saved code with its hints but fills nothing', async () => {
    hintsFor({ '6429-5': HIV });
    renderSheet(NEW_TEST({ loinc: '6429-5' }));
    await screen.findByTestId('hint-category');
    expect(categoryText()).toBe('No category');
    expect(checked('specimen-BLD')).toBe(false);
    expect(api.resultFieldsFromLoinc).not.toHaveBeenCalled();
  });
});

describe('TestSheet: Fill from panel', () => {
  it('adds the members in LOINC order and keeps one already ticked', async () => {
    hintsFor({ '24331-1': LIPID });
    const kept = param('2093-3', { bands: [{ name: null, low: 0, high: 5, unit: 'mmol/L', sex: null, ageLow: null, ageHigh: null }] });
    vi.mocked(api.resultFieldsFromLoinc).mockResolvedValue(answer([param('2093-3'), param('2571-8')]));
    renderSheet(NEW_TEST({ resultParams: [param('HGB'), kept] }));
    await pickLoinc('24331-1');
    // A panel has no result of its own, so picking it makes no field by itself.
    expect(api.resultFieldsFromLoinc).not.toHaveBeenCalled();
    expect(screen.getByTestId('hint-result').textContent).toBe('This LOINC code is a panel of 2 tests. Fill from panel adds them.');
    await openMenu('result-params-menu');
    expect(screen.queryByTestId('use-loinc-field')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId('fill-from-panel')); });
    expect(api.resultFieldsFromLoinc).toHaveBeenCalledWith(['24331-1'], true);
    // Named in the field list. As a numeric field it also heads its own Reference ranges block.
    expect(screen.getByTestId('param-2571-8').closest('label')!.textContent).toContain('Triglyceride');
    expect(toast.success).toHaveBeenCalledWith('1 result field from LOINC ticked on this test.');
    expect(await savedParams()).toEqual([param('HGB'), kept, param('2571-8')]);
  });

  it('keeps the ticks when the page reads the choices again', async () => {
    hintsFor({ '24331-1': LIPID });
    vi.mocked(api.resultFieldsFromLoinc).mockResolvedValue(answer([param('2093-3'), param('2571-8')]));
    const target = { kind: 'edit' as const, test: NEW_TEST({ loinc: '24331-1' }) };
    // The page passes the same target object; only the choices are read again.
    const view = render(<TestSheet target={target} options={OPTIONS} ownedHere onSaved={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(api.getLoincHints).toHaveBeenCalled());
    await choose('result-params-menu', 'fill-from-panel');
    view.rerender(<TestSheet target={target} options={{ ...OPTIONS, loinc: { ...OPTIONS.loinc! } }} ownedHere onSaved={vi.fn()} onClose={vi.fn()} />);
    expect([checked('param-2093-3'), checked('param-2571-8')]).toEqual([true, true]);
  });
});

// Review focus 5.
describe('TestSheet: without LOINC hints', () => {
  it('shows no hint and no LOINC action when the route answers null, and fills nothing', async () => {
    hintsFor({});
    renderSheet();
    await pickLoinc('6429-5');
    expect(api.getLoincHints).toHaveBeenCalledWith('6429-5');
    expect(screen.queryByTestId('hint-category')).toBeNull();
    expect(screen.queryByTestId('hint-specimens')).toBeNull();
    expect(screen.queryByTestId('hint-result')).toBeNull();
    expect(categoryText()).toBe('No category');
    expect(api.resultFieldsFromLoinc).not.toHaveBeenCalled();
    await openMenu('result-params-menu');
    expect(screen.getByTestId('add-field')).toBeTruthy();
    expect(screen.queryByTestId('use-loinc-field')).toBeNull();
    expect(screen.queryByTestId('fill-from-panel')).toBeNull();
  });

  it('does not ask for hints when LOINC is not loaded here', () => {
    renderSheet(NEW_TEST({ loinc: '6429-5' }), { ...OPTIONS, loinc: null });
    expect(api.getLoincHints).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'LOINC code' })).toBeTruthy();
  });

  it('works as before when the hint read fails', async () => {
    vi.mocked(api.getLoincHints).mockRejectedValue(new Error('down'));
    renderSheet();
    await pickLoinc('2093-3');
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId('hint-result')).toBeNull();
  });
});

describe('TestSheet: hint lines on a phone', () => {
  it('wrap inside their column instead of widening the sheet', async () => {
    hintsFor({ '6429-5': HIV });
    renderSheet(NEW_TEST({ category: 'CHEM', resultParams: [param('HGB')] }));
    await pickLoinc('6429-5');
    for (const id of ['hint-category', 'hint-specimens', 'hint-specimens-map', 'hint-result']) {
      const el = screen.getByTestId(id);
      expect(el.className).toContain('break-words');
      expect(el.parentElement!.className).toContain('min-w-0');
    }
  });
});

function renderNew(options: api.TestCatalogOptions = OPTIONS) {
  return render(<TestSheet target={{ kind: 'create' }} options={options} ownedHere onSaved={vi.fn()} onClose={vi.fn()} onOptionsChanged={vi.fn()} />);
}
const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

// Spec call 1, review focus 1.
describe('TestSheet: a pick fills an empty name and short name', () => {
  it("fills them from LOINC's long name and short name on a new test", async () => {
    hintsFor({ '2093-3': CHOL });
    renderNew();
    await pickLoinc('2093-3');
    expect(textbox('Name').value).toBe('Cholesterol [Mass/volume] in Serum or Plasma');
    expect(textbox('Short name').value).toBe('Cholest SerPl-mCnc');
  });

  it('keeps a name and short name already typed', async () => {
    hintsFor({ '2093-3': CHOL });
    renderNew();
    fireEvent.change(textbox('Name'), { target: { value: 'Total cholesterol' } });
    fireEvent.change(textbox('Short name'), { target: { value: 'TCHOL' } });
    await pickLoinc('2093-3');
    expect(textbox('Name').value).toBe('Total cholesterol');
    expect(textbox('Short name').value).toBe('TCHOL');
  });
});

// Spec call 6.
describe("TestSheet: LOINC's category, suggested", () => {
  it('sets the suggested category in one click, and the button goes once they match', async () => {
    hintsFor({ '6429-5': HIV });
    renderSheet(NEW_TEST({ category: 'CHEM' }));
    await pickLoinc('6429-5');
    const button = screen.getByRole('button', { name: 'Microbiology, suggested' });
    expect(button).toBe(screen.getByTestId('hint-category'));
    await act(async () => { fireEvent.click(button); });
    expect(categoryText()).toBe('Microbiology');
    expect(screen.queryByTestId('hint-category')).toBeNull();
  });

  it('keeps a text line when no category here matches the class', async () => {
    hintsFor({ '24331-1': LIPID });
    renderSheet();
    await pickLoinc('24331-1');
    const hint = screen.getByTestId('hint-category');
    expect(hint.tagName).not.toBe('BUTTON');
    expect(hint.textContent).toBe('LOINC class PANEL.CHEM matches no category here.');
  });
});

// Spec call 5.
describe('TestSheet: suggested specimen types', () => {
  const TWO: api.LoincHints = {
    ...HIV,
    specimens: [
      { snomed: '119297000', display: null, equivalence: 'equivalent', specimenType: { system: LOCAL, code: 'BLD', display: 'Blood' }, tick: false, via: 'snomed' },
      { snomed: null, display: null, equivalence: null, specimenType: { system: LOCAL, code: 'UR', display: 'Urine' }, tick: false, via: 'system-name' },
    ],
  };

  it('marks each matched, unticked specimen type, and ticking it removes the mark', async () => {
    hintsFor({ '6429-5': TWO });
    renderSheet();
    await pickLoinc('6429-5');
    // Two matches, so neither is ticked by itself.
    expect([checked('specimen-BLD'), checked('specimen-UR')]).toEqual([false, false]);
    expect(screen.getByTestId('suggested-BLD').textContent).toBe('suggested');
    expect(screen.getByTestId('suggested-UR').textContent).toBe('suggested');
    // Every match has a specimen type, so there is no line and no map advice.
    expect(screen.queryByTestId('hint-specimens')).toBeNull();
    expect(screen.queryByTestId('hint-specimens-map')).toBeNull();
    fireEvent.click(screen.getByTestId('specimen-UR'));
    expect(screen.queryByTestId('suggested-UR')).toBeNull();
    expect(screen.getByTestId('suggested-BLD')).toBeTruthy();
  });

  it('marks nothing without hints', async () => {
    hintsFor({});
    renderSheet();
    await pickLoinc('6429-5');
    expect(screen.queryByTestId('suggested-BLD')).toBeNull();
  });
});

// Spec call 7.
describe('TestSheet: Browse LOINC and the search line', () => {
  it('browses LOINC from the LOINC row menu, and a pick there fills the draft like a search pick', async () => {
    hintsFor({ '2093-3': CHOL });
    renderNew();
    await choose('loinc-menu', 'browse-loinc');
    await act(async () => { fireEvent.click(await screen.findByTestId('browser-pick-loinc-id')); });
    expect(api.getLoincHints).toHaveBeenCalledWith('2093-3');
    expect(textbox('Name').value).toBe('Cholesterol [Mass/volume] in Serum or Plasma');
    expect(categoryText()).toBe('Chemistry');
    expect(screen.queryByTestId('browser-pick-loinc-id')).toBeNull();
  });

  it('gives focus back to the LOINC menu button after a Browse pick', async () => {
    hintsFor({ '2093-3': CHOL });
    renderNew();
    await choose('loinc-menu', 'browse-loinc');
    await act(async () => { fireEvent.click(await screen.findByTestId('browser-pick-loinc-id')); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('loinc-menu')));
  });

  it('has no LOINC row menu when LOINC is not loaded here', () => {
    renderNew({ ...OPTIONS, loinc: null });
    expect(screen.queryByTestId('loinc-menu')).toBeNull();
  });

  it("gives each search result LOINC's short name, class and unit, skipping empty ones", () => {
    renderNew();
    expect(screen.getByTestId('detail-sample').textContent).toBe('Cholest SerPl-mCnc · CHEM');
  });
});
