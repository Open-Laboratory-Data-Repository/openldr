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

  // secretPreserved means exactly one thing: NO external sender's webhook token changed.
  // The three branches below are the complete case split.
  describe('secretPreserved', () => {
    it('is true when an existing secretRef was carried over (same token stays in force)', () => {
      expect(rebuildSystemWorkflow(existing as never).secretPreserved).toBe(true);
    });

    it('is false when the restored graph has a webhook but nothing was carried over', () => {
      // The gutted graph is exactly the recovery case reset exists for: the rebuilt wf-ingest
      // has a webhook node carrying a NEWLY minted token, so every existing sender is dead.
      const gutted = { id: 'wf-ingest', name: 'x', definition: { nodes: [], edges: [] } };
      const { workflow, secretPreserved } = rebuildSystemWorkflow(gutted as never);
      expect(workflow.definition.nodes.some((n: any) => n.data?.templateId === 'webhook-trigger')).toBe(true);
      expect(secretPreserved).toBe(false);
    });

    it('is false when the old webhook secret was PLAINTEXT (no ref to carry over)', () => {
      const plaintext = {
        id: 'wf-ingest', name: 'x',
        definition: { nodes: [{ id: 't', type: 'webhook', data: { templateId: 'webhook-trigger', secret: 'raw-token' } }], edges: [] },
      };
      expect(rebuildSystemWorkflow(plaintext as never).secretPreserved).toBe(false);
    });

    it('is true for wf-sample-reactive, whose restored graph has no webhook node at all', () => {
      // Its trigger is an event-trigger — there is no token, so a reset cannot break a sender.
      const reactive = { id: 'wf-sample-reactive', name: 'x', definition: { nodes: [], edges: [] } };
      const { workflow, secretPreserved } = rebuildSystemWorkflow(reactive as never);
      expect(workflow.definition.nodes.some((n: any) => n.data?.templateId === 'webhook-trigger')).toBe(false);
      expect(secretPreserved).toBe(true);
    });
  });
});
