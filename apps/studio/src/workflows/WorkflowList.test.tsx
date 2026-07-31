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
import { toast } from 'sonner';
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

  // The reset toast is the only signal an operator gets that a webhook secret rotated —
  // silently swallowing it (or making it look identical to the no-rotation case) would leave
  // external senders quietly broken. See the "Never swallow this" comment in WorkflowList.
  //
  // The wording changed: it used to say "existing senders must be given the new token", which the
  // product cannot support — workflow secrets are write-only (SEC-06) and there is no reveal
  // endpoint, so the minted token can never be read back. It now names the action that works.
  it('tells the operator to set a new secret when reset had none to keep', async () => {
    (api.fetchWorkflows as any).mockResolvedValue([
      { id: 'wf-ingest', name: 'Ingest', enabled: true, protected: true } as never,
    ]);
    (api.resetWorkflow as any).mockResolvedValue({ ok: true, secretPreserved: false });
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    await screen.findByTestId('open-wf-ingest');

    fireEvent.click(await openMenuItem(/actions for ingest/i, 'reset-wf-ingest'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(api.resetWorkflow).toHaveBeenCalledWith('wf-ingest'));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      'Ingest restored, but its webhook had no secret to keep. Open it, set a new secret on the Ingest webhook trigger, and give that to your senders.',
    ));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('does not warn when reset preserves the existing webhook secret', async () => {
    (api.fetchWorkflows as any).mockResolvedValue([
      { id: 'wf-ingest', name: 'Ingest', enabled: true, protected: true } as never,
    ]);
    (api.resetWorkflow as any).mockResolvedValue({ ok: true, secretPreserved: true });
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    await screen.findByTestId('open-wf-ingest');

    fireEvent.click(await openMenuItem(/actions for ingest/i, 'reset-wf-ingest'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(api.resetWorkflow).toHaveBeenCalledWith('wf-ingest'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ingest restored to its default.'));
    expect(toast.warning).not.toHaveBeenCalled();
  });

  // Reset discards the operator's entire customised graph, GCs the secret rows the old graph
  // referenced, and can rotate the webhook token. Delete — which the route REFUSES for these
  // workflows — already had a confirmation, so the destructive action had less friction than the
  // refused one.
  it('does not reset until the confirmation is accepted', async () => {
    (api.fetchWorkflows as any).mockResolvedValue([
      { id: 'wf-ingest', name: 'Ingest', enabled: true, protected: true } as never,
    ]);
    (api.resetWorkflow as any).mockResolvedValue({ ok: true, secretPreserved: true });
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    await screen.findByTestId('open-wf-ingest');

    fireEvent.click(await openMenuItem(/actions for ingest/i, 'reset-wf-ingest'));

    // The dialog is up and nothing has been sent.
    expect(await screen.findByText(/changes you have made to this workflow will be discarded/i)).toBeTruthy();
    expect(api.resetWorkflow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(api.resetWorkflow).toHaveBeenCalledWith('wf-ingest'));
  });

  it('does not reset when the confirmation is cancelled', async () => {
    (api.fetchWorkflows as any).mockResolvedValue([
      { id: 'wf-ingest', name: 'Ingest', enabled: true, protected: true } as never,
    ]);
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    await screen.findByTestId('open-wf-ingest');

    fireEvent.click(await openMenuItem(/actions for ingest/i, 'reset-wf-ingest'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull());
    expect(api.resetWorkflow).not.toHaveBeenCalled();
  });
});
