import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, readTestCatalogFile: vi.fn(), previewTestCatalogImport: vi.fn(), applyTestCatalogImport: vi.fn() };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { ImportCatalogSheet } from './ImportCatalogSheet';

const LOCAL = 'urn:openldr:cs:local';
const OPTIONS: api.TestCatalogOptions = {
  categories: [{ code: 'CHEM', display: 'Chemistry' }, { code: 'MOL', display: 'Molecular' }],
  specimenTypes: [{ system: LOCAL, code: 'BLD', display: 'Blood' }, { system: LOCAL, code: 'UR', display: 'Urine' }],
  loinc: null,
};
const FILE: api.CatalogImportFile = {
  headers: ['Test code', 'Test name', 'Category', 'Specimens'],
  rows: [['VL1', 'Viral load', 'Virology', 'Plasma']],
  sheetName: null, sheetCount: 1,
  suggested: { code: 'Test code', name: 'Test name', category: 'Category', specimenTypes: 'Specimens' },
};
const report = (over: Partial<api.CatalogImportReport> = {}): api.CatalogImportReport => ({
  counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [],
  unmatched: { categories: [], specimens: [] }, categoriesToAdd: [], loincChecked: true, ...over,
});
const UNMATCHED = report({
  counts: { new: 0, changed: 0, unchanged: 0, refused: 1 },
  refused: [{ line: 2, code: 'VL1', reason: 'Category "Virology" is not in the test category list. Choose a category for it.' }],
  unmatched: { categories: [{ text: 'Virology', rows: 1 }], specimens: [{ text: 'Plasma', rows: 1 }] },
});

function renderSheet() {
  const onImported = vi.fn();
  const onClose = vi.fn();
  render(<ImportCatalogSheet open options={OPTIONS} onImported={onImported} onClose={onClose} />);
  return { onImported, onClose };
}

// Radix menus open on pointerDown in jsdom, with Enter as the fallback (as in TestSheet.test.tsx).
async function choose(testId: string) {
  const trigger = screen.getByTestId('import-sheet-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByTestId(testId);
  await act(async () => { fireEvent.click(item); });
}

// Radix Select opens from the keyboard in jsdom.
async function pick(name: RegExp | string, option: RegExp) {
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

async function chooseFile(name: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [new File(['x'], name)] } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readTestCatalogFile).mockResolvedValue(FILE);
});

describe('ImportCatalogSheet', () => {
  it('reads a file, takes the suggested columns, collects answers, and applies them', async () => {
    vi.mocked(api.previewTestCatalogImport).mockResolvedValueOnce(UNMATCHED).mockResolvedValueOnce(report({
      unmatched: UNMATCHED.unmatched, categoriesToAdd: [{ code: 'VIRO', display: 'Virology' }],
    }));
    vi.mocked(api.applyTestCatalogImport).mockResolvedValue(report());
    const { onImported, onClose } = renderSheet();

    await chooseFile('tests.csv');
    expect(api.readTestCatalogFile).toHaveBeenCalledWith(expect.any(File), 'csv');
    expect(await screen.findByText('Step 2 of 4: Columns')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Name' })).toHaveTextContent('Test name');

    await choose('import-next');
    expect(await screen.findByText('Step 3 of 4: Values')).toBeInTheDocument();
    await pick(/Virology/, /add as a new category/i);
    const code = screen.getByRole('textbox', { name: /new category code/i });
    expect(code).toHaveValue('VIROLOGY');
    fireEvent.change(code, { target: { value: 'VIRO' } });
    await pick(/Plasma/, /^blood$/i);

    await choose('import-next');
    expect(await screen.findByText('Step 4 of 4: Review')).toBeInTheDocument();
    const sent: api.CatalogImportInput = {
      table: { headers: FILE.headers, rows: FILE.rows },
      columnMap: FILE.suggested,
      valueMap: {
        categories: [{ text: 'Virology', kind: 'new', code: 'VIRO', display: 'Virology' }],
        specimens: [{ text: 'Plasma', system: LOCAL, code: 'BLD' }],
      },
    };
    expect(api.previewTestCatalogImport).toHaveBeenLastCalledWith(sent);
    expect(screen.getByText('VIRO (Virology)')).toBeInTheDocument();

    await choose('import-apply');
    expect(api.applyTestCatalogImport).toHaveBeenCalledWith(sent);
    expect(toast.success).toHaveBeenCalledWith('1 added, 0 changed.');
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refuses a file of the wrong type, and lets the operator drop a column and go back', async () => {
    vi.mocked(api.previewTestCatalogImport).mockResolvedValue(report());
    renderSheet();

    await chooseFile('tests.pdf');
    expect(screen.getByText('Choose a .csv or .xlsx file. tests.pdf is neither.')).toBeInTheDocument();
    expect(api.readTestCatalogFile).not.toHaveBeenCalled();

    await chooseFile('tests.xlsx');
    expect(api.readTestCatalogFile).toHaveBeenCalledWith(expect.any(File), 'xlsx');
    await screen.findByText('Step 2 of 4: Columns');
    await pick('Code', /not in the file/i);
    await choose('import-next');
    await screen.findByText('Step 3 of 4: Values');
    expect(screen.getByText('Every category and specimen in the file matched the lists.')).toBeInTheDocument();
    expect(api.previewTestCatalogImport).toHaveBeenLastCalledWith(expect.objectContaining({
      columnMap: { name: 'Test name', category: 'Category', specimenTypes: 'Specimens' },
    }));

    await choose('import-back');
    expect(await screen.findByText('Step 2 of 4: Columns')).toBeInTheDocument();
  });

  it('shows the refused rows and the LOINC note, and offers no Apply with nothing to write', async () => {
    vi.mocked(api.previewTestCatalogImport).mockResolvedValue(report({
      counts: { new: 0, changed: 0, unchanged: 2, refused: 1 },
      refused: [{ line: 3, code: 'X1', reason: 'A test needs a name.' }],
      loincChecked: false,
    }));
    renderSheet();
    await chooseFile('tests.csv');
    await choose('import-next');
    await choose('import-next');
    await screen.findByText('Step 4 of 4: Review');
    expect(screen.getByText('A test needs a name.')).toBeInTheDocument();
    expect(screen.getByText('LOINC is not loaded here, so LOINC codes were checked for their format only.')).toBeInTheDocument();
    expect(screen.getByText('Nothing to apply: no row is new or changed.')).toBeInTheDocument();
    const trigger = screen.getByTestId('import-sheet-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByTestId('import-apply')).toHaveAttribute('data-disabled');
  });

  it('shows a refusal from the server and stays on the step', async () => {
    vi.mocked(api.previewTestCatalogImport).mockRejectedValue(new Error('check import failed: The file has no column "Test name".'));
    renderSheet();
    await chooseFile('tests.csv');
    await choose('import-next');
    expect(toast.error).toHaveBeenCalledWith('check import failed: The file has no column "Test name".');
    expect(screen.getByText('Step 2 of 4: Columns')).toBeInTheDocument();
  });
});
