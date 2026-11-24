import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual, createCatalogTest: vi.fn(), updateCatalogTest: vi.fn(), setCatalogLabSettings: vi.fn(),
    searchTerms: vi.fn(), termExists: vi.fn(), listCodingSystems: vi.fn(),
  };
});

import * as api from '@/api';
import { TestSheet } from './TestSheet';

// Plan B, Task 5: the Additional codings section of the Test sheet and its Add coding sheet.

const EXTRA = 'urn:test:cs:extra';
const OPTIONS: api.TestCatalogOptions = { categories: [], specimenTypes: [], resultParams: [], loinc: null, sexes: [] };
const TEST: api.CatalogTest = {
  code: 'GLU', testCode: 'GLU', display: 'Glucose', shortName: null, category: null, specimenTypes: [],
  resultParams: [], loinc: null, active: true, expectedTatHours: null, criticalTatHours: null, requiresVerification: true, codings: [],
  lab: { enabled: false, specimenTypes: null, localDisplay: null },
};
const system = (over: Partial<api.CodingSystem>): api.CodingSystem => ({
  id: 'cs-extra', systemCode: 'EXTRA', systemName: 'Extra system', url: EXTRA, systemVersion: null, description: null,
  active: true, publisherId: null, seeded: false, source: 'user', sourceRef: null, ...over,
});
const SYSTEMS: api.CodingSystem[] = [
  system({}),
  // The catalog's own systems, LOINC (the test's LOINC field) and an inactive one are not offered.
  system({ id: 'cs-catalog', systemName: 'Test catalog', url: api.TEST_CATALOG_SYSTEM }),
  system({ id: 'cs-loinc', systemName: 'LOINC', url: 'http://loinc.org' }),
  system({ id: 'cs-off', systemName: 'Switched off', url: 'urn:test:cs:off', active: false }),
];
const term = (code: string, display: string): api.Term => ({
  system: EXTRA, code, display, status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null, mappingCount: 0,
});
const X1: api.CatalogTestCoding = { system: EXTRA, code: 'X1', display: 'Extra one', purpose: 'INDICATION', note: 'why' };

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
async function pick(scope: HTMLElement, label: string, option: RegExp) {
  fireEvent.keyDown(within(scope).getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
const codingSheet = (name = 'Add coding') => screen.getByRole('dialog', { name });
const sent = () => vi.mocked(api.updateCatalogTest).mock.calls[0][1].codings;

function renderSheet(test: api.CatalogTest = TEST, ownedHere = true) {
  render(<TestSheet target={{ kind: 'edit', test }} options={OPTIONS} ownedHere={ownedHere} onSaved={vi.fn()} onClose={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listCodingSystems).mockResolvedValue(SYSTEMS);
  vi.mocked(api.updateCatalogTest).mockResolvedValue(TEST);
});

describe('TestSheet: Additional codings', () => {
  it('says there are none, and offers Add coding in the section menu', async () => {
    renderSheet();
    expect(screen.getByText('No additional codings.')).toBeTruthy();
    await openMenu('codings-menu');
    expect(await screen.findByTestId('add-coding')).toBeTruthy();
  });

  it('adds a coding from a loaded system, with its purpose and note, and Save sends it', async () => {
    vi.mocked(api.searchTerms).mockResolvedValue({ rows: [term('X1', 'Extra one')], total: 1 });
    renderSheet();
    await choose('codings-menu', 'add-coding');
    const sheet = codingSheet();
    expect(sheet.querySelector('.grid-cols-\\[auto_minmax\\(0\\,1fr\\)\\]')).not.toBeNull();
    // Only the active systems that are not the catalog's own or LOINC are offered.
    fireEvent.keyDown(within(sheet).getByRole('combobox', { name: 'System' }), { key: 'ArrowDown' });
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Extra system']);
    fireEvent.click(screen.getByRole('option', { name: 'Extra system' }));
    const box = within(codingSheet()).getByRole('combobox', { name: 'Code' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'X1' } });
    fireEvent.click(await screen.findByRole('option', { name: /X1/ }));
    expect(vi.mocked(api.searchTerms).mock.calls[0][0]).toBe('cs-extra');
    await pick(codingSheet(), 'Purpose', /^Indication$/);
    fireEvent.change(within(codingSheet()).getByRole('textbox', { name: 'Note' }), { target: { value: 'why' } });
    await choose('add-coding-menu', 'add-coding-save');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add coding' })).toBeNull());
    const row = screen.getByTestId('coding-row-0');
    expect(row.textContent).toContain('Extra one');
    expect(row.textContent).toContain('Indication');
    await choose('test-sheet-menu', 'test-sheet-save');
    expect(sent()).toEqual([X1]);
  });

  it('searches a code from two letters, the TermPicker default', async () => {
    vi.mocked(api.searchTerms).mockResolvedValue({ rows: [], total: 0 });
    renderSheet();
    await choose('codings-menu', 'add-coding');
    await pick(codingSheet(), 'System', /Extra system/);
    const box = within(codingSheet()).getByRole('combobox', { name: 'Code' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'X' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(api.searchTerms).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'X1' } });
    await waitFor(() => expect(api.searchTerms).toHaveBeenCalledTimes(1));
  });

  it('cannot save a coding with no code, or one the test already has', async () => {
    vi.mocked(api.searchTerms).mockResolvedValue({ rows: [term('X1', 'Extra one')], total: 1 });
    renderSheet({ ...TEST, codings: [X1] });
    await choose('codings-menu', 'add-coding');
    await pick(codingSheet(), 'System', /Extra system/);
    await openMenu('add-coding-menu');
    expect((await screen.findByTestId('add-coding-save')).getAttribute('data-disabled')).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    const box = within(codingSheet()).getByRole('combobox', { name: 'Code' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'X1' } });
    fireEvent.click(await screen.findByRole('option', { name: /X1/ }));
    expect(within(codingSheet()).getByText(`This test already has ${EXTRA} X1.`)).toBeTruthy();
    await openMenu('add-coding-menu');
    expect((await screen.findByTestId('add-coding-save')).getAttribute('data-disabled')).not.toBeNull();
  });

  it('edits a coding from its row menu, keeping its code, and Save sends the change', async () => {
    renderSheet({ ...TEST, codings: [X1] });
    await choose('coding-menu-0', 'coding-edit-0');
    const sheet = codingSheet('Edit coding');
    await waitFor(() => expect(within(sheet).getByText('X1')).toBeTruthy());
    await pick(sheet, 'Purpose', /^Category$/);
    await choose('add-coding-menu', 'add-coding-save');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit coding' })).toBeNull());
    expect(screen.getByTestId('coding-row-0').textContent).toContain('Category');
    await choose('test-sheet-menu', 'test-sheet-save');
    expect(sent()).toEqual([{ ...X1, purpose: 'CATEGORY' }]);
  });

  it('removes a coding from its row menu, and Save sends the shorter list', async () => {
    renderSheet({ ...TEST, codings: [X1] });
    expect(screen.getByTestId('coding-row-0')).toBeTruthy();
    await choose('coding-menu-0', 'coding-remove-0');
    expect(screen.queryByTestId('coding-row-0')).toBeNull();
    await choose('test-sheet-menu', 'test-sheet-save');
    expect(sent()).toEqual([]);
  });

  it('shows the codings as text with no menus at a lab that receives central catalog', () => {
    renderSheet({ ...TEST, codings: [X1] }, false);
    expect(screen.getByTestId('coding-row-0').textContent).toContain('Extra one');
    expect(screen.queryByTestId('codings-menu')).toBeNull();
    expect(screen.queryByTestId('coding-menu-0')).toBeNull();
  });
});
