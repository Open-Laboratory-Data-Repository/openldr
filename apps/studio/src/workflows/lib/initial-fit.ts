/**
 * Should the canvas fit its view now?
 *
 * Once per loaded workflow, and only after React Flow has measured every node. A fit spent on
 * zero-size nodes, or on the graph the editor shows before the saved workflow arrives (the store's
 * sample, or the previous workflow's graph), zooms to the maximum and leaves the real workflow
 * off-screen.
 *
 * `loadSeq` counts loads in the workflow store; `fittedSeq` is the last load the canvas fitted.
 */
export function shouldFitLoadedWorkflow(input: {
  loadSeq: number;
  fittedSeq: number;
  nodeCount: number;
  nodesMeasured: boolean;
}): boolean {
  return input.loadSeq !== input.fittedSeq && input.nodeCount > 0 && input.nodesMeasured;
}
