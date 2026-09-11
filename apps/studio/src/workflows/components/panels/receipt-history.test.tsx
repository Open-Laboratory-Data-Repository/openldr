import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api';
import { RunHistoryDrawer } from './run-history-drawer';

vi.mock('@/api', () => ({
  fetchWorkflowRuns: vi.fn(), fetchWorkflowRun: vi.fn(), downloadWorkflowArtifact: vi.fn(),
  fetchWorkflowReceipts: vi.fn(), fetchWorkflowReceipt: vi.fn(),
}));
const receipt = (id: string, status = 'queued') => ({
  id, workflowId: 'workflow-1', status, runId: null, createdAt: '2026-09-11T10:00:00Z',
  startedAt: null, finishedAt: null, reason: null, outcome: null,
});
async function openReceipts() {
  await act(async () => { render(<RunHistoryDrawer open workflowId="workflow-1" onClose={() => {}} />); });
  await act(async () => { fireEvent.mouseDown(screen.getByRole('tab', { name: 'Webhook receipts' }), { button: 0 }); });
}
async function menu(name: string, action: string) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
  const item = await screen.findByRole('menuitem', { name: action });
  await act(async () => { fireEvent.click(item); });
}
describe('webhook receipt history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchWorkflowRuns).mockResolvedValue([]);
    vi.mocked(api.fetchWorkflowReceipts).mockResolvedValue([receipt('request-1') as api.WorkflowReceipt]);
  });
  it('lists pending requests without claiming completion and always shows pagination', async () => {
    await openReceipts();
    expect(await screen.findByText('Queued')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(api.fetchWorkflowReceipts).toHaveBeenCalledWith('workflow-1', { limit: 26, offset: 0 });
  });
  it('reads detail, explains interrupted outcomes, and refreshes without replay', async () => {
    vi.mocked(api.fetchWorkflowReceipt).mockResolvedValue(receipt('request-1', 'interrupted') as api.WorkflowReceipt);
    await openReceipts();
    await screen.findByText('request-1');
    await menu('Receipt actions for request-1', 'View details');
    expect(await screen.findByText(/The outcome is uncertain/)).toBeInTheDocument();
    expect(screen.queryByText(/replay/i)).not.toBeInTheDocument();
    await menu('Receipt actions', 'Refresh');
    await waitFor(() => expect(api.fetchWorkflowReceipt).toHaveBeenCalledTimes(2));
  });
  it('loads the next server page without displaying the extra row', async () => {
    vi.mocked(api.fetchWorkflowReceipts).mockResolvedValue(Array.from({ length: 26 }, (_, i) => receipt(`request-${i}`) as api.WorkflowReceipt));
    await openReceipts();
    await screen.findByText('request-0');
    expect(screen.queryByText('request-25')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next page' })); });
    await waitFor(() => expect(api.fetchWorkflowReceipts).toHaveBeenCalledWith('workflow-1', { limit: 26, offset: 25 }));
  });
  it('shows a spinner while pending, then an empty state without a table', async () => {
    let resolve!: (value: api.WorkflowReceipt[]) => void;
    vi.mocked(api.fetchWorkflowReceipts).mockReturnValue(new Promise((done) => { resolve = done; }));
    await openReceipts();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('No webhook receipts yet.')).not.toBeInTheDocument();
    await act(async () => { resolve([]); });
    expect(await screen.findByText('No webhook receipts yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('offers refresh after a failed list request', async () => {
    vi.mocked(api.fetchWorkflowReceipts).mockRejectedValueOnce(new Error('unavailable'));
    await openReceipts();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load webhook receipts');
    await menu('Receipt actions', 'Refresh');
    expect(await screen.findByText('Queued')).toBeInTheDocument();
  });
});
