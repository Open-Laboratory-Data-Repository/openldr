export type WorkflowRoute = 'upper' | 'lower';
export type WorkflowPhase = 'node' | 'flow';

export interface WorkflowFrame {
  route: WorkflowRoute;
  step: 0 | 1 | 2 | 3 | 4;
  phase: WorkflowPhase;
  run: number;
}

export const WORKFLOW_TIMINGS = {
  nodeMs: 1200,
  edgeMs: 1450,
  finalHoldMs: 2000,
} as const;

export function nextWorkflowFrame(frame: WorkflowFrame): WorkflowFrame {
  if (frame.phase === 'node' && frame.step < 4) {
    return { ...frame, phase: 'flow' };
  }

  if (frame.phase === 'flow' && frame.step < 3) {
    return { ...frame, step: (frame.step + 1) as WorkflowFrame['step'], phase: 'node' };
  }

  if (frame.phase === 'flow') {
    return { ...frame, step: 4, phase: 'node' };
  }

  return {
    route: frame.route === 'upper' ? 'lower' : 'upper',
    step: 0,
    phase: 'node',
    run: frame.run + 1,
  };
}

// The diagram is drawn at a fixed size and then scaled down to whatever width the page gives
// it, so it never needs a scrollbar of its own. Width covers the right edge of the last node
// (928 + 132) plus a 16px margin; height covers the bottom of the lowest node (344 + 115).
export const WORKFLOW_STAGE = { width: 1076, height: 475 } as const;

export function workflowStageScale(containerWidth: number): number {
  if (containerWidth <= 0) return 1;
  return Math.min(1, containerWidth / WORKFLOW_STAGE.width);
}

export function workflowFrameDuration(frame: WorkflowFrame): number {
  if (frame.phase === 'flow') return WORKFLOW_TIMINGS.edgeMs;
  return frame.step === 4 ? WORKFLOW_TIMINGS.finalHoldMs : WORKFLOW_TIMINGS.nodeMs;
}
