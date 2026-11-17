import { describe, it, expect } from 'vitest';
import { buildBody } from './use-workflow-api';
import { useWorkflowStore } from './use-workflow-store';

describe('buildBody: Save keeps what it did not change (follow-up d)', () => {
  it('keeps the loaded description and a disabled workflow disabled', () => {
    const body = buildBody({ id: 'wf_1', name: 'Copy', nodes: [], edges: [], meta: { description: 'Nightly', enabled: false } });
    expect(body).toMatchObject({ id: 'wf_1', name: 'Copy', description: 'Nightly', enabled: false });
  });

  it('gives a new workflow no description and turns it on', () => {
    const body = buildBody({ id: 'wf_2', name: 'New', nodes: [], edges: [], meta: useWorkflowStore.getState().workflowMeta });
    expect(body).toMatchObject({ description: null, enabled: true });
  });
});

describe('useWorkflowStore: workflowMeta', () => {
  it('holds the loaded description and on/off state, and clear resets them', () => {
    useWorkflowStore.getState().setWorkflowMeta({ description: 'Nightly', enabled: false });
    expect(useWorkflowStore.getState().workflowMeta).toEqual({ description: 'Nightly', enabled: false });
    useWorkflowStore.getState().clear();
    expect(useWorkflowStore.getState().workflowMeta).toEqual({ description: null, enabled: true });
  });
});
