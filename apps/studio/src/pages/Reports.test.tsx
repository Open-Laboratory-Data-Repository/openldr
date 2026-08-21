import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const designReport = {
  id: 'r1', name: 'Custom Report', description: 'desc', category: 'operational', parameters: [], summaryMetrics: [], source: 'design', designId: 'd1',
};

// A report declaring a `tz` parameter, like the seeded LIS transmission grid.
const tzReport = {
  id: 'r-transmission-grid', name: 'LIS Transmission', description: 'desc', category: 'operational',
  parameters: [{ id: 'tz', label: 'Time zone', type: 'text', required: true }],
  summaryMetrics: [], source: 'design', designId: 'rt-transmission-grid',
};

const { fetchReportsMock, fetchLabIdentityMock } = vi.hoisted(() => ({
  fetchReportsMock: vi.fn(async () => [
    { id: 'amr-resistance', name: 'AMR Resistance Rate', description: 'desc', category: 'amr', parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }], summaryMetrics: [{ id: 'antibiotics', label: 'Antibiotics', type: 'count' }], source: 'catalog' },
  ]),
  fetchLabIdentityMock: vi.fn(async () => ({
    fields: [], values: { 'lab.timezone': 'Africa/Dar_es_Salaam' }, logo: { maxBytes: 0, mimeTypes: [] },
  })),
}));

vi.mock('../api', () => ({
  fetchReports: fetchReportsMock,
  fetchLabIdentity: fetchLabIdentityMock,
  fetchReport: vi.fn(async () => ({
    columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }],
    rows: [{ antibiotic: 'AMP' }],
    chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
    meta: { generatedAt: '2026-01-01', rowCount: 1 },
  })),
  fetchReportOptions: vi.fn(async () => ({})),
  fetchReportPdf: vi.fn(async () => new Blob(['%PDF'])),
  csvUrl: (id: string) => `/api/reports/${id}.csv`,
  logReportRun: vi.fn(async () => {}),
  fetchReportRuns: vi.fn(async () => ({ runs: [], total: 0 })),
  downloadReportCsv: vi.fn(async () => {}),
  listPluginUis: vi.fn(async () => []),
  listNotifications: vi.fn(async () => ({ notifications: [], unreadCount: 0, total: 0 })),
  markNotificationsRead: vi.fn(async () => undefined),
  markAllNotificationsRead: vi.fn(async () => undefined),
}));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div>pdf-viewer</div> }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasCapability: () => true }),
}));
vi.mock('../reports/ReportSchedulesDrawer', () => ({
  ReportSchedulesDrawer: ({ open }: { open: boolean }) => (open ? <div>schedules-drawer</div> : null),
}));

const { setReportStatus, deleteReportDef } = vi.hoisted(() => ({
  setReportStatus: vi.fn(async () => {}),
  deleteReportDef: vi.fn(async () => {}),
}));
vi.mock('../reports/reportDefsApi', () => ({ setReportStatus, deleteReportDef }));

const { listReportCategoriesMock } = vi.hoisted(() => ({
  listReportCategoriesMock: vi.fn(async () => [
    { id: 'amr', label: 'AMR / Surveillance', order: 0 },
    { id: 'operational', label: 'Operational', order: 1 },
  ]),
}));
vi.mock('../reports/reportCategoriesApi', () => ({
  listReportCategories: listReportCategoriesMock,
  saveReportCategories: vi.fn(async (list: unknown) => list),
}));

import { Reports } from './Reports';

// The report-detail ⋯ menu (the library no longer has its own header ⋯ menu — see
// [[reports-page-custom-queries-templates]] / the library New-report menu removal).
function openActionsMenu() {
  const trigger = screen.getByRole('button', { name: 'Actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

// Parameters (and therefore Run) live in a sheet opened from the ⋯ menu, so the report body
// starts near the top of the viewport on a phone rather than below an always-on parameter bar.
async function openParameters() {
  openActionsMenu();
  fireEvent.click(await screen.findByText(/^(parameters|paramètres|parâmetros)$/i));
}

beforeEach(() => {
  localStorage.clear();
  fetchReportsMock.mockClear();
  fetchLabIdentityMock.mockClear();
  setReportStatus.mockClear();
  deleteReportDef.mockClear();
});

describe('Reports page', () => {
  it('has no library header ⋯ menu / New-report entry (moved to the designer\'s Publish action)', async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>);
    await screen.findByText('AMR Resistance Rate');
    expect(screen.queryByRole('button', { name: /library actions/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^new report$/i)).not.toBeInTheDocument();
  });

  it('lists reports; selecting + running shows the document tab', async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('AMR Resistance Rate'));
    await openParameters();
    fireEvent.click(await screen.findByRole('button', { name: /^(run|exécuter|executar)$/i }));
    await waitFor(() => expect(screen.getByText('pdf-viewer')).toBeInTheDocument());
  });

  it('logs a preview run after Run', async () => {
    const api = await import('../api');
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('AMR Resistance Rate'));
    await openParameters();
    fireEvent.click(await screen.findByRole('button', { name: /^(run|exécuter|executar)$/i }));
    await waitFor(() => expect(api.logReportRun).toHaveBeenCalledWith(
      'amr-resistance',
      expect.objectContaining({ format: 'preview' }),
    ));
  });

  // ⛔ THE refresh complaint, reported 2026-08-21: "it doesn't look like it's refreshing". Re-running
  // keeps the same parameters, so the row count and every cell can come back identical and the only
  // change is a timestamp nobody is watching. The page has to SAY it is re-running while it does.
  // Measured against the live warehouse the same day: the PDF for this report takes 4.7 to 5.2
  // seconds, so this state is on screen for seconds, not a flicker.
  it('says it is running while a re-run is in flight, and shows the row count again after', async () => {
    const api = await import('../api');
    let release: (v: unknown) => void = () => {};
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('AMR Resistance Rate'));
    await openParameters();
    fireEvent.click(await screen.findByRole('button', { name: /^(run|exécuter|executar)$/i }));
    await waitFor(() => expect(screen.getByText(/1 row/i)).toBeInTheDocument());

    // Hold the second run open so the in-flight state is observable rather than a race.
    vi.mocked(api.fetchReport).mockImplementationOnce(() => new Promise((res) => {
      release = res as (v: unknown) => void;
    }) as ReturnType<typeof api.fetchReport>);

    openActionsMenu();
    fireEvent.click(await screen.findByText(/^(refresh|actualiser|atualizar)$/i));

    // While it runs: a busy indicator and the running label, in place of the run meta.
    expect(await screen.findByText(/running|exécution|executando/i)).toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);

    release({
      columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }],
      rows: [{ antibiotic: 'AMP' }],
      chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
      meta: { generatedAt: '2026-01-01', rowCount: 1 },
    });

    // ...and afterwards the meta line is back, so the running state is not sticky.
    await waitFor(() => expect(screen.getByText(/1 row/i)).toBeInTheDocument());
  });

  it('opens the Schedules drawer for a manager', async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('AMR Resistance Rate'));
    openActionsMenu();
    fireEvent.click(await screen.findByText(/schedules|planifications|agendamentos/i));
    expect(await screen.findByText('schedules-drawer')).toBeInTheDocument();
  });

  it('unpublishes a design-sourced report, clears selection, and refetches', async () => {
    fetchReportsMock.mockResolvedValue([designReport]);
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Custom Report'));
    openActionsMenu();
    fireEvent.click(await screen.findByText(/unpublish|dépublier|despublicar/i));
    await waitFor(() => expect(setReportStatus).toHaveBeenCalledWith('r1', 'draft'));
    await waitFor(() => expect(screen.getByText(/select a report|sélectionnez un rapport|selecione um relatório/i)).toBeInTheDocument());
    expect(fetchReportsMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('deletes a design-sourced report after confirmation, clears selection, and refetches', async () => {
    fetchReportsMock.mockResolvedValue([designReport]);
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Custom Report'));
    openActionsMenu();
    fireEvent.click(await screen.findByText(/delete report|supprimer le rapport|excluir relatório/i));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /delete report|supprimer le rapport|excluir relatório/i }));
    await waitFor(() => expect(deleteReportDef).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.getByText(/select a report|sélectionnez un rapport|selecione um relatório/i)).toBeInTheDocument());
    expect(fetchReportsMock.mock.calls.length).toBeGreaterThan(1);
  });
});

// ⛔ Without this the `lab.timezone` setting buys nothing: an operator who retypes the zone on
// every run can still disagree with a colleague running the same month, which is the exact failure
// a stored setting was chosen over a bare parameter to avoid.
describe('Reports page — time-zone prefill', () => {
  it('prefills tz from the laboratory setting when the report declares one', async () => {
    fetchReportsMock.mockResolvedValue([tzReport]);
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('LIS Transmission'));
    await openParameters();
    await waitFor(() => expect(screen.getByPlaceholderText('Time zone')).toHaveValue('Africa/Dar_es_Salaam'));
  });

  it('lets a zone the operator already ran with win over the setting', async () => {
    fetchReportsMock.mockResolvedValue([tzReport]);
    localStorage.setItem('reports.lastParams', JSON.stringify({ 'r-transmission-grid': { tz: 'Europe/Lisbon' } }));
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('LIS Transmission'));
    await openParameters();
    await waitFor(() => expect(screen.getByPlaceholderText('Time zone')).toHaveValue('Europe/Lisbon'));
  });

  it('leaves tz empty when the setting is unset, and never blocks the page when the fetch fails', async () => {
    fetchReportsMock.mockResolvedValue([tzReport]);
    fetchLabIdentityMock.mockRejectedValueOnce(new Error('offline'));
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('LIS Transmission'));
    await openParameters();
    expect(screen.getByPlaceholderText('Time zone')).toHaveValue('');
  });
});

// ⛔ The settings call and the reports call are fired together, so which lands first is a race the
// page does not control. On a slow link the operator can pick a report before the zone arrives.
// Seeding only at pick time drops the prefill silently in exactly that case.
describe('Reports page — the time zone can arrive after the report is picked', () => {
  it('still prefills tz when the laboratory setting resolves late', async () => {
    fetchReportsMock.mockResolvedValue([tzReport]);
    let releaseIdentity = (): void => {};
    fetchLabIdentityMock.mockReturnValueOnce(new Promise((resolve) => {
      releaseIdentity = () => resolve({
        fields: [], values: { 'lab.timezone': 'Africa/Dar_es_Salaam' }, logo: { maxBytes: 0, mimeTypes: [] },
      });
    }));
    render(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(await screen.findByText('LIS Transmission'));
    await openParameters();
    expect(screen.getByPlaceholderText('Time zone')).toHaveValue('');
    releaseIdentity();
    await waitFor(() => expect(screen.getByPlaceholderText('Time zone')).toHaveValue('Africa/Dar_es_Salaam'));
  });
});
