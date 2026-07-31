import { describe, expect, it } from 'vitest';
import { isProtectedWorkflowId, PROTECTED_WORKFLOW_IDS } from './system-workflows';

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
