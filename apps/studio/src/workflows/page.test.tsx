import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, fetchWorkflow: vi.fn() };
});
const setWorkflow = vi.fn();
const clear = vi.fn();
vi.mock('./hooks/use-workflow-store', () => ({
  useWorkflowStore: (sel?: (s: any) => unknown) => {
    const state = { configNodeId: null, workflowId: null, setWorkflow, clear, setConfigNode: vi.fn() };
    return sel ? sel(state) : state;
  },
}));
// Stable across re-renders (unlike an inline `vi.fn()` in the factory) so tests can assert
// on save calls that happen after the component has re-rendered (e.g. once the fetch resolves).
const save = vi.fn();
vi.mock('./hooks/use-workflow-api', () => ({ useWorkflowApi: () => ({ save, execute: vi.fn(), fireTrigger: vi.fn(), saving: false, executing: false, lastExecution: null }) }));
vi.mock('./components/canvas', () => ({ Canvas: () => null }));
vi.mock('./components/sidebar', () => ({ Sidebar: () => null }));
vi.mock('./components/panels/node-config-panel', () => ({ NodeConfigPanel: () => null }));
// The real Toolbar pulls in the full workflow store; stub it with just enough to drive
// the Save button so the save-gate tests below can click it.
vi.mock('./components/panels/toolbar', () => ({
  Toolbar: ({ onSave }: { onSave: () => void }) => (
    <button onClick={onSave}>Save</button>
  ),
}));
vi.mock('./components/panels/execution-panel', () => ({ ExecutionPanel: () => null }));
vi.mock('./components/panels/run-history-drawer', () => ({ RunHistoryDrawer: () => null }));
vi.mock('./components/panels/datasets-drawer', () => ({ DatasetsDrawer: () => null }));

import * as api from '@/api';
import { Workflows } from './page';

const wf = { id: 'wf_1', name: 'AMR sync', description: null, definition: { nodes: [{ id: 'n1' }], edges: [] }, enabled: true, createdBy: null, createdAt: '', updatedAt: '' };
beforeEach(() => { vi.clearAllMocks(); (api.fetchWorkflow as any).mockResolvedValue(wf); clear.mockReset(); setWorkflow.mockReset(); });

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/workflows/new" element={<Workflows />} />
        <Route path="/workflows/:id" element={<Workflows />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Workflows builder', () => {
  it('loads the workflow named by :id into the store', async () => {
    renderAt('/workflows/wf_1');
    await waitFor(() => expect(api.fetchWorkflow).toHaveBeenCalledWith('wf_1'));
    await waitFor(() => expect(setWorkflow).toHaveBeenCalledWith('wf_1', 'AMR sync', wf.definition.nodes, wf.definition.edges));
  });
  it('starts blank for /workflows/new (resets, no fetch)', async () => {
    renderAt('/workflows/new');
    await waitFor(() => expect(clear).toHaveBeenCalled());
    expect(api.fetchWorkflow).not.toHaveBeenCalled();
  });
});

describe('Workflows builder — save gate for protected workflows', () => {
  it('protected workflow: Save shows a confirmation and does not save until confirmed', async () => {
    (api.fetchWorkflow as any).mockResolvedValue({ ...wf, protected: true });
    renderAt('/workflows/wf_1');
    await waitFor(() => expect(api.fetchWorkflow).toHaveBeenCalledWith('wf_1'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('confirming the protected-workflow dialog performs the save', async () => {
    (api.fetchWorkflow as any).mockResolvedValue({ ...wf, protected: true });
    renderAt('/workflows/wf_1');
    await waitFor(() => expect(api.fetchWorkflow).toHaveBeenCalledWith('wf_1'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it('non-protected workflow: Save proceeds directly, no confirmation', async () => {
    (api.fetchWorkflow as any).mockResolvedValue({ ...wf, protected: false });
    renderAt('/workflows/wf_1');
    await waitFor(() => expect(api.fetchWorkflow).toHaveBeenCalledWith('wf_1'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // Regression test for the confirmation-gate bypass: `isProtected` used to be local state
  // initialised to `false` on every mount and only flipped to `true` once `fetchWorkflow`
  // resolved — but the workflow id lives in a Zustand store that survives navigation, so
  // revisiting a protected workflow reset `isProtected` to `false` again while the store
  // still pointed at the protected id. Clicking Save in that window saved with no
  // confirmation at all. This test fails without the fail-safe fix (isProtected defaulting
  // to, and being re-armed as, `true` until the fetch actually resolves).
  it('race: clicking Save before the fetch resolves never performs an unconfirmed save on a protected workflow', async () => {
    let resolveFetch!: (w: unknown) => void;
    (api.fetchWorkflow as any).mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    renderAt('/workflows/wf_1');
    // Click immediately — before the fetch (and therefore the real protection flag) resolves.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();

    // Resolve the fetch confirming the workflow really is protected, then confirm the save.
    resolveFetch({ ...wf, protected: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});
