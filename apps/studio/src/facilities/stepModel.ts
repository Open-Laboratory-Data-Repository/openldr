/** Which of the import sheet's three steps the operator is on.
 *
 *  The sheet used to present five stages of work as one scrolling surface with no numbering and no
 *  way back, and every action for every stage in a single dropdown. This module is the "where am I"
 *  half of the fix. It holds no React state and no copy, so it can be tested as arithmetic.
 */
export type ImportStep = 1 | 2 | 3;

/** What the operator has actually supplied, as four booleans. Deliberately not the sheet's own
 *  state shape: this module must not know what a run, a preview or a summary is. */
export interface StepGate {
  hasFile: boolean;
  hasRegister: boolean;
  /** An upload has been started, or a validated summary is on screen. Deliberately NOT "a summary
   *  exists": a background run has no summary while it validates, and gating the run's own progress
   *  block on a summary would leave the operator watching nothing after clicking Upload. */
  hasReview: boolean;
  /** A background run is validating or applying right now. */
  runActive: boolean;
}

/** The furthest step the operator has earned. Never guesses forward. */
export function furthestStep(gate: StepGate): ImportStep {
  if (!gate.hasFile || !gate.hasRegister) return 1;
  return gate.hasReview ? 3 : 2;
}

/** The step to actually render: what was asked for, or the furthest earned, whichever is lower. */
export function clampStep(requested: ImportStep, gate: StepGate): ImportStep {
  const furthest = furthestStep(gate);
  return (requested < furthest ? requested : furthest);
}

/** Back is offered on any step but the first, and never while a run is in flight: the run is for
 *  THAT file under THAT register, and nothing in this sheet can retract it. Same reasoning as
 *  `inputsDisabled` freezing the inputs for a live run. */
export function canGoBack(step: ImportStep, gate: StepGate): boolean {
  return step > 1 && !gate.runActive;
}
