import { describe, expect, it } from 'vitest';
import { isProtectedWorkflowId, PROTECTED_WORKFLOW_IDS, rebuildSystemWorkflow } from './system-workflows';

describe('protected system workflows', () => {
  it('protects the seeded ingest workflow', () => {
    expect(isProtectedWorkflowId('wf-ingest')).toBe(true);
  });

  it('protects the seeded reactive companion', () => {
    expect(isProtectedWorkflowId('wf-sample-reactive')).toBe(true);
  });

  it('does not protect a user-created workflow', () => {
    expect(isProtectedWorkflowId('wf-something-else')).toBe(false);
  });

  it('derives the list from the seed rather than hardcoding it', () => {
    // If buildDefaultWorkflows gains or renames a workflow, this list must follow
    // automatically — that is the point of deriving it.
    expect(PROTECTED_WORKFLOW_IDS.length).toBeGreaterThanOrEqual(2);
    expect([...PROTECTED_WORKFLOW_IDS]).toContain('wf-ingest');
  });
});

describe('rebuildSystemWorkflow', () => {
  const existing = {
    id: 'wf-ingest',
    name: 'Ingest (mangled)',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'webhook', data: { templateId: 'webhook-trigger', path: 'ingest', secret: { secretRef: 'wsec_KEEP_ME' } } },
        { id: 'form-validate-1', type: 'action', data: { templateId: 'form-validate', config: { formId: 'form-sample-order', sourcePath: 'body' } } },
      ],
      edges: [],
    },
  };

  it('restores the default graph', () => {
    const { workflow } = rebuildSystemWorkflow(existing as never);
    expect(workflow.name).toBe('Ingest');
    expect(workflow.definition.nodes.length).toBeGreaterThan(2);
  });

  it('PRESERVES the existing webhook secretRef', () => {
    const { workflow, secretPreserved } = rebuildSystemWorkflow(existing as never);
    const trigger = workflow.definition.nodes.find((n: any) => n.data?.templateId === 'webhook-trigger');
    expect((trigger as any).data.secret.secretRef).toBe('wsec_KEEP_ME');
    expect(secretPreserved).toBe(true);
  });

  it('preserves the existing form binding', () => {
    const { workflow } = rebuildSystemWorkflow(existing as never);
    const fv = workflow.definition.nodes.find((n: any) => n.data?.templateId === 'form-validate');
    expect((fv as any).data.config.formId).toBe('form-sample-order');
  });

  it('reports secretPreserved=false when the old graph has no secret to keep', () => {
    const gutted = { id: 'wf-ingest', name: 'x', definition: { nodes: [], edges: [] } };
    const { secretPreserved } = rebuildSystemWorkflow(gutted as never);
    expect(secretPreserved).toBe(false);
  });
});
