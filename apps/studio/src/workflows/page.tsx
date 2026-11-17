import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useParams, Link } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Canvas } from './components/canvas';
import { Sidebar } from './components/sidebar';
import { NodeConfigPanel } from './components/panels/node-config-panel';
import { Toolbar } from './components/panels/toolbar';
import { ExecutionPanel } from './components/panels/execution-panel';
import { RunHistoryDrawer } from './components/panels/run-history-drawer';
import { DatasetsDrawer } from './components/panels/datasets-drawer';
import { useWorkflowStore } from './hooks/use-workflow-store';
import { useWorkflowApi } from './hooks/use-workflow-api';
import { SaveRequestContext, type SaveRequest } from './hooks/save-request';
import { fetchWorkflow } from '@/api';
import type { WorkflowNode, WorkflowEdge } from './lib/types';

export function Workflows() {
  const configNodeId = useWorkflowStore((s) => s.configNodeId);
  const workflowId = useWorkflowStore((s) => s.workflowId);
  const { save, execute, fireTrigger, saving, executing, lastExecution } = useWorkflowApi();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [datasetsOpen, setDatasetsOpen] = useState(false);
  // Fail-safe default: until we actually know whether this workflow is
  // protected, treat it as protected so an in-flight fetch can never let an
  // unconfirmed save through (see the effect below for the id-transition case).
  const [isProtected, setIsProtected] = useState(true);
  // The options of the save waiting on the confirm, or null when none waits.
  const [pendingProtectedSave, setPendingProtectedSave] = useState<Parameters<SaveRequest>[0] | null>(null);

  const { id } = useParams();
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);
  const setWorkflowMeta = useWorkflowStore((s) => s.setWorkflowMeta);
  const clear = useWorkflowStore((s) => s.clear);
  const setConfigNode = useWorkflowStore((s) => s.setConfigNode);

  // The store is a singleton that survives navigation, so a left-open config panel would
  // reappear on return. Close it when entering/switching a workflow and when leaving the builder.
  useEffect(() => {
    setConfigNode(null);
    return () => setConfigNode(null);
  }, [id, setConfigNode]);

  useEffect(() => {
    if (!id || id === 'new') { clear(); setIsProtected(false); return; }
    // The store's workflowId can outlive this component (see the comment above),
    // so a fresh mount or an id switch must not inherit a stale "not protected"
    // state from a previous workflow. Re-arm the fail-safe before fetching.
    setIsProtected(true);
    let active = true;
    void fetchWorkflow(id)
      .then((w) => {
        if (!active) return;
        setWorkflow(w.id, w.name, w.definition.nodes as WorkflowNode[], w.definition.edges as WorkflowEdge[]);
        setWorkflowMeta({ description: w.description, enabled: w.enabled });
        setIsProtected(w.protected === true);
      })
      .catch(() => { /* missing id leaves a blank builder; save will create one */ });
    return () => { active = false; };
  }, [id, setWorkflow, setWorkflowMeta, clear]);

  // Protected workflows carry form capture AND automated ingest. A broken edit stops
  // clerks saving data, so make the operator acknowledge it rather than discover it.
  // A save a node asks for (the Map to FHIR sheet) goes through the same confirm.
  const requestSave = useCallback<SaveRequest>((opts) => {
    if (isProtected) setPendingProtectedSave(opts ?? {});
    else void save(opts);
  }, [isProtected, save]);

  return (
    <AppShell title="Workflows" fullBleed>
      <ReactFlowProvider>
      <SaveRequestContext.Provider value={requestSave}>
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <Link to="/workflows" className="text-xs text-muted-foreground hover:text-foreground hover:underline" data-testid="back-to-workflows">← Workflows</Link>
          </div>
          <Toolbar
            onSave={() => requestSave()}
            onRun={execute}
            onHistory={() => setHistoryOpen(true)}
            onDatasets={() => setDatasetsOpen(true)}
            saving={saving}
            executing={executing}
          />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col">
              <div className="flex-1">
                <Canvas onFireTrigger={fireTrigger} />
              </div>
              <ExecutionPanel executing={executing} lastExecution={lastExecution} />
            </div>
            {configNodeId && <NodeConfigPanel />}
          </div>
        </div>
        {workflowId && (
          <RunHistoryDrawer
            open={historyOpen}
            workflowId={workflowId}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        <DatasetsDrawer open={datasetsOpen} onClose={() => setDatasetsOpen(false)} />
        <ConfirmDialog
          open={pendingProtectedSave !== null}
          onOpenChange={(o) => { if (!o) setPendingProtectedSave(null); }}
          title="Save changes to a system workflow?"
          description="Form capture and automated ingest both run through this workflow. If your changes break it, clerks will not be able to save data and incoming data will stop being stored. You can restore the default from the workflow list."
          confirmLabel="Save anyway"
          onConfirm={() => { const opts = pendingProtectedSave ?? undefined; setPendingProtectedSave(null); void save(opts); }}
        />
      </SaveRequestContext.Provider>
      </ReactFlowProvider>
    </AppShell>
  );
}
