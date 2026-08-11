import { describe, expect, it } from 'vitest';
import { WORKFLOW_STAGE, WORKFLOW_TIMINGS, nextWorkflowFrame, workflowStageScale } from './workflow-preview-model';

describe('workflow preview model', () => {
  it('holds the final log node before beginning the alternate route', () => {
    const completed = nextWorkflowFrame({ route: 'upper', step: 3, phase: 'flow', run: 0 });

    expect(completed).toEqual({ route: 'upper', step: 4, phase: 'node', run: 0 });
    expect(WORKFLOW_TIMINGS.finalHoldMs).toBe(2000);
    expect(nextWorkflowFrame(completed)).toEqual({ route: 'lower', step: 0, phase: 'node', run: 1 });
  });

  it('shrinks the diagram to a narrow pane and never enlarges it past its drawn size', () => {
    expect(workflowStageScale(538)).toBeCloseTo(0.5);
    expect(workflowStageScale(WORKFLOW_STAGE.width)).toBe(1);
    expect(workflowStageScale(1600)).toBe(1);
    // A pane measured before layout must not produce a scale of 0 or Infinity.
    expect(workflowStageScale(0)).toBe(1);
  });
});
