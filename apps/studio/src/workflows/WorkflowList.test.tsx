import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasCapability: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, fetchWorkflows: vi.fn(), createWorkflow: vi.fn(), deleteWorkflow: vi.fn(), resetWorkflow: vi.fn() };
});
import * as api from '@/api';
import { WorkflowList } from './WorkflowList';

const wf = (over = {}) => ({ id: 'wf_1', name: 'AMR sync', description: null, definition: { nodes: [], edges: [] }, enabled: true, createdBy: null, createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z', ...over });

// Radix menus open on pointerDown in jsdom, with a keyboard fallback.
function openMenu(name: RegExp | string) {
  const trigger = screen.getByRole('button', { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return trigger;
}
async function openMenuItem(menuName: RegExp | string, itemTestId: string) {
  const trigger = openMenu(menuName);
  if (!screen.queryByTestId(itemTestId)) fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByTestId(itemTestId);
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.fetchWorkflows as any).mockResolvedValue([wf()]);
});

describe('WorkflowList', () => {
  it('lists workflows', async () => {
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    expect(await screen.findByText('AMR sync')).toBeTruthy();
  });
  it('navigates to the builder for a new workflow', async () => {
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    await screen.findByText('AMR sync');
    fireEvent.click(await openMenuItem('Workflow actions', 'workflow-new'));
    expect(navigateMock).toHaveBeenCalledWith('/workflows/new');
  });
  it('opens a workflow in the builder', async () => {
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('open-wf_1'));
    expect(navigateMock).toHaveBeenCalledWith('/workflows/wf_1');
  });
  it('duplicates a workflow', async () => {
    (api.createWorkflow as any).mockResolvedValue(wf({ id: 'wf_2', name: 'AMR sync (copy)' }));
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    await screen.findByText('AMR sync');
    fireEvent.click(await openMenuItem(/actions for amr sync/i, 'duplicate-wf_1'));
    await waitFor(() => expect(api.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({ name: 'AMR sync (copy)' })));
  });
  it('deletes a workflow after confirm', async () => {
    (api.deleteWorkflow as any).mockResolvedValue(undefined);
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    await screen.findByText('AMR sync');
    fireEvent.click(await openMenuItem(/actions for amr sync/i, 'delete-wf_1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteWorkflow).toHaveBeenCalledWith('wf_1'));
  });
  it('offers reset instead of delete for a protected workflow', async () => {
    (api.fetchWorkflows as any).mockResolvedValue([
      { id: 'wf-ingest', name: 'Ingest', enabled: true, protected: true } as never,
      { id: 'wf-mine', name: 'Mine', enabled: true, protected: false } as never,
    ]);
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    await screen.findByTestId('open-wf-ingest');

    await openMenuItem(/actions for ingest/i, 'reset-wf-ingest');
    expect(screen.queryByTestId('delete-wf-ingest')).not.toBeInTheDocument();
    expect(screen.getByTestId('reset-wf-ingest')).toBeInTheDocument();
  });
  it('still offers delete for a user workflow', async () => {
    (api.fetchWorkflows as any).mockResolvedValue([
      { id: 'wf-mine', name: 'Mine', enabled: true, protected: false } as never,
    ]);
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    await screen.findByTestId('open-wf-mine');

    await openMenuItem(/actions for mine/i, 'delete-wf-mine');
    expect(screen.getByTestId('delete-wf-mine')).toBeInTheDocument();
    expect(screen.queryByTestId('reset-wf-mine')).not.toBeInTheDocument();
  });
});
