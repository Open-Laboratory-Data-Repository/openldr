import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const caps = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] },
    loading: false,
    hasCapability: (c: string) => caps.set.has(c),
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    listTestCatalog: vi.fn(),
    getTestCatalogOptions: vi.fn(),
    setCatalogTestEnabled: vi.fn(),
    setCatalogTestActive: vi.fn(),
    downloadTestCatalogCsv: vi.fn(),
    // AppShell's notification bell and plugin menu call these on mount (see Notifications.test.tsx).
    listNotifications: vi.fn(async () => ({ notifications: [], unreadCount: 0, total: 0 })),
    listPluginUis: vi.fn(async () => []),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';
import { TestCatalog } from './TestCatalog';

const LOCAL = 'urn:openldr:cs:local';
const OPTIONS: api.TestCatalogOptions = {
  categories: [{ code: 'CHEM', display: 'Chemistry' }, { code: 'MOL', display: 'Molecular' }],
  specimenTypes: [{ system: LOCAL, code: 'BLD', display: 'Blood' }, { system: LOCAL, code: 'UR', display: 'Urine' }],
  loinc: null,
};
const HIVVL: api.CatalogTest = {
  code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
  specimenTypes: [{ system: LOCAL, code: 'BLD' }, { system: LOCAL, code: 'UR' }], loinc: '25836-8', active: true,
  lab: { enabled: true, specimenTypes: [{ system: LOCAL, code: 'UR' }], localDisplay: 'Viral load' },
};
const CD4: api.CatalogTest = {
  code: 'CD4', display: 'CD4 count', shortName: null, category: null, specimenTypes: [], loinc: null, active: true,
  lab: { enabled: false, specimenTypes: null, localDisplay: null },
};

function renderPage() {
  return render(<MemoryRouter><TestCatalog /></MemoryRouter>);
}

// Radix menus open on pointerDown in jsdom, with Enter as the fallback (as in Connectors.test.tsx).
function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

// The first filterable column, Category, is an enum, so the popover shows a Select rather than the
// text box the shared addFilterViaPopover helper types into (as in DistributedSync.test.tsx).
async function addEnumFilterViaPopover(optionName: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /^filter$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /add filter/i }));
  fireEvent.keyDown(await screen.findByLabelText(/pick value/i), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
  fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  caps.set = new Set(['terminology.view', 'terminology.manage']);
  vi.mocked(api.getTestCatalogOptions).mockResolvedValue(OPTIONS);
  vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [HIVVL, CD4], total: 2, ownedHere: true });
});

describe('Test catalog page', () => {
  it('lists each test with its category, specimens, LOINC and switch, and this lab narrower choices', async () => {
    renderPage();
    const row = await screen.findByTestId('test-row-HIVVL');
    expect(within(row).getByText('HIV viral load')).toBeInTheDocument();
    expect(within(row).getByText('This lab: Viral load')).toBeInTheDocument();
    expect(within(row).getByText('Molecular')).toBeInTheDocument();
    expect(within(row).getByText('Blood, Urine')).toBeInTheDocument();
    expect(within(row).getByText('This lab: Urine')).toBeInTheDocument();
    expect(within(row).getByText('25836-8')).toBeInTheDocument();
    expect(within(row).getByText('On')).toBeInTheDocument();
    const cd4 = screen.getByTestId('test-row-CD4');
    expect(within(cd4).getByText('No LOINC')).toBeInTheDocument();
    expect(within(cd4).getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('2 tests')).toBeInTheDocument();
    expect(api.listTestCatalog).toHaveBeenCalledWith({ q: undefined, limit: 25, offset: 0 });
  });

  it('keeps a test code and its LOINC code on one line', async () => {
    renderPage();
    const row = await screen.findByTestId('test-row-HIVVL');
    expect(within(row).getByText('HIVVL').closest('td')).toHaveClass('whitespace-nowrap');
    expect(within(row).getByText('25836-8').closest('td')).toHaveClass('whitespace-nowrap');
  });

  it('filters by category through the standard toolbar', async () => {
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    await addEnumFilterViaPopover(/molecular/i);
    await waitFor(() => expect(api.listTestCatalog).toHaveBeenLastCalledWith({ q: undefined, category: 'MOL', limit: 25, offset: 0 }));
    expectStandardTableToolbar();
  });

  it('searches on the server after a pause in typing', async () => {
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    fireEvent.change(screen.getByPlaceholderText('Search code or name'), { target: { value: ' viral ' } });
    await waitFor(() => expect(api.listTestCatalog).toHaveBeenLastCalledWith({ q: 'viral', limit: 25, offset: 0 }));
  });

  it('shows the striped empty state, and no table header, when there are no active tests', async () => {
    // The default list hides retired tests, so the words must stay true when only retired ones exist.
    vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [], total: 0, ownedHere: true });
    renderPage();
    expect(await screen.findByText('No active tests. Retired tests stay hidden unless you filter for them.')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader')).toBeNull();
  });

  it('pages through the server', async () => {
    vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [HIVVL], total: 30, ownedHere: true });
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(api.listTestCatalog).toHaveBeenLastCalledWith({ q: undefined, limit: 25, offset: 25 }));
  });

  it('switches a test on from the row menu, then reloads', async () => {
    vi.mocked(api.setCatalogTestEnabled).mockResolvedValue({ ...CD4, lab: { ...CD4.lab, enabled: true } });
    renderPage();
    await screen.findByTestId('test-row-CD4');
    openMenu('test-actions-CD4');
    fireEvent.click(await screen.findByTestId('test-switch-CD4'));
    await waitFor(() => expect(api.setCatalogTestEnabled).toHaveBeenCalledWith('CD4', true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('CD4 is on at this lab.'));
    await waitFor(() => expect(api.listTestCatalog).toHaveBeenCalledTimes(2));
  });

  it('retires a test from the row menu', async () => {
    vi.mocked(api.setCatalogTestActive).mockResolvedValue({ ...HIVVL, active: false });
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-actions-HIVVL');
    fireEvent.click(await screen.findByTestId('test-retire-HIVVL'));
    await waitFor(() => expect(api.setCatalogTestActive).toHaveBeenCalledWith('HIVVL', false));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('HIVVL is retired.'));
  });

  it('shows a refusal from a row action', async () => {
    vi.mocked(api.setCatalogTestActive).mockRejectedValue(new Error('retire test failed: central only'));
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-actions-HIVVL');
    fireEvent.click(await screen.findByTestId('test-retire-HIVVL'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('retire test failed: central only'));
  });

  it('says the catalog came from central, and offers no retire there', async () => {
    vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [HIVVL], total: 1, ownedHere: false });
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    expect(screen.getByText(/This catalog comes from central/)).toBeInTheDocument();
    openMenu('test-actions-HIVVL');
    expect(await screen.findByTestId('test-switch-HIVVL')).toBeInTheDocument();
    expect(screen.queryByTestId('test-retire-HIVVL')).toBeNull();
  });

  it('gives a viewer the table without any menu', async () => {
    caps.set = new Set(['terminology.view']);
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    expect(screen.queryByTestId('test-actions-HIVVL')).toBeNull();
    expect(screen.queryByTestId('test-catalog-menu-trigger')).toBeNull();
  });

  it('opens the add sheet from the header menu', async () => {
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-catalog-menu-trigger');
    fireEvent.click(await screen.findByTestId('add-test'));
    expect(await screen.findByRole('heading', { name: 'Add test' })).toBeInTheDocument();
  });

  it('opens the edit sheet for a row', async () => {
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-actions-HIVVL');
    fireEvent.click(await screen.findByTestId('test-edit-HIVVL'));
    expect(await screen.findByRole('heading', { name: 'Edit test' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('HIV viral load');
  });

  it('offers only Export when the catalog came from central', async () => {
    vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [HIVVL], total: 1, ownedHere: false });
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-catalog-menu-trigger');
    expect(await screen.findByTestId('export-tests')).toBeInTheDocument();
    expect(screen.queryByTestId('add-test')).toBeNull();
    expect(screen.queryByTestId('import-tests')).toBeNull();
  });

  it('exports the catalog from the header menu, and shows a failure', async () => {
    vi.mocked(api.downloadTestCatalogCsv).mockResolvedValueOnce(undefined);
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-catalog-menu-trigger');
    fireEvent.click(await screen.findByTestId('export-tests'));
    await waitFor(() => expect(api.downloadTestCatalogCsv).toHaveBeenCalledTimes(1));

    vi.mocked(api.downloadTestCatalogCsv).mockRejectedValueOnce(new Error('export tests failed: 500'));
    openMenu('test-catalog-menu-trigger');
    fireEvent.click(await screen.findByTestId('export-tests'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('export tests failed: 500'));
  });

  it('opens the import sheet from the header menu', async () => {
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-catalog-menu-trigger');
    fireEvent.click(await screen.findByTestId('import-tests'));
    expect(await screen.findByRole('heading', { name: 'Import tests' })).toBeInTheDocument();
  });
});
