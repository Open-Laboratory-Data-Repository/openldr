import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowStore } from './use-workflow-store';
import type { WorkflowNode, WorkflowEdge } from '../lib/types';

const node = (id: string) => ({ id, type: 'action', position: { x: 0, y: 0 }, data: {} }) as unknown as WorkflowNode;
const edge = (id: string) => ({ id, source: 'a', target: 'b' }) as unknown as WorkflowEdge;

describe('useWorkflowStore — loadSeq, so the canvas fits each loaded workflow once', () => {
  it('setWorkflow counts a load', () => {
    const before = useWorkflowStore.getState().loadSeq;
    useWorkflowStore.getState().setWorkflow('wf_a', 'A', [node('n1')], []);
    expect(useWorkflowStore.getState().loadSeq).toBe(before + 1);
  });

  it('loading the same workflow again still counts, so a reopened workflow is fitted again', () => {
    useWorkflowStore.getState().setWorkflow('wf_a', 'A', [node('n1')], []);
    const before = useWorkflowStore.getState().loadSeq;
    useWorkflowStore.getState().setWorkflow('wf_a', 'A', [node('n1')], []);
    expect(useWorkflowStore.getState().loadSeq).toBe(before + 1);
  });

  it('clear() counts a load (a new workflow), clearCanvas() does not (same workflow, emptied)', () => {
    const before = useWorkflowStore.getState().loadSeq;
    useWorkflowStore.getState().clear();
    expect(useWorkflowStore.getState().loadSeq).toBe(before + 1);
    useWorkflowStore.getState().clearCanvas();
    expect(useWorkflowStore.getState().loadSeq).toBe(before + 1);
  });

  it('editing nodes does not count as a load, so adding a node never re-fits the view', () => {
    useWorkflowStore.getState().setWorkflow('wf_a', 'A', [node('n1')], []);
    const before = useWorkflowStore.getState().loadSeq;
    useWorkflowStore.getState().addNode(node('n2'));
    useWorkflowStore.getState().removeNode('n2');
    expect(useWorkflowStore.getState().loadSeq).toBe(before);
  });
});

describe('useWorkflowStore — clear vs clearCanvas', () => {
  beforeEach(() => {
    useWorkflowStore.getState().setWorkflow('wf_x', 'My WF', [node('n1')], [edge('e1')]);
  });

  it('clearCanvas empties the canvas but KEEPS the workflow identity (so Save updates, not creates)', () => {
    useWorkflowStore.getState().clearCanvas();
    const s = useWorkflowStore.getState();
    expect(s.nodes).toEqual([]);
    expect(s.edges).toEqual([]);
    expect(s.workflowId).toBe('wf_x'); // the bug: the Clear button used clear(), which nulled this → Save created a duplicate
    expect(s.workflowName).toBe('My WF');
  });

  it('clear() is a full reset that DOES drop identity (used only when starting a new workflow)', () => {
    useWorkflowStore.getState().clear();
    const s = useWorkflowStore.getState();
    expect(s.nodes).toEqual([]);
    expect(s.workflowId).toBeNull();
    expect(s.workflowName).toBe(''); // empty so the name input shows its placeholder for a new workflow
  });
});
