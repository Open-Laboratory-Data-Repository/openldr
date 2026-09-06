import { describe, it, expect } from 'vitest';
import { furthestStep, clampStep, canGoBack, type StepGate } from './importSteps';

const gate = (over: Partial<StepGate> = {}): StepGate => ({
  hasFile: false, hasRegister: false, hasReview: false, runActive: false, ...over,
});

describe('furthestStep', () => {
  it('stays on Source until BOTH a file and a register are chosen', () => {
    expect(furthestStep(gate())).toBe(1);
    expect(furthestStep(gate({ hasFile: true }))).toBe(1);
    expect(furthestStep(gate({ hasRegister: true }))).toBe(1);
  });

  it('opens Mapping once both are chosen', () => {
    expect(furthestStep(gate({ hasFile: true, hasRegister: true }))).toBe(2);
  });

  it('opens Review once a validated summary exists', () => {
    expect(furthestStep(gate({ hasFile: true, hasRegister: true, hasReview: true }))).toBe(3);
  });
});

describe('clampStep', () => {
  it('refuses a step the operator has not earned', () => {
    expect(clampStep(3, gate({ hasFile: true, hasRegister: true }))).toBe(2);
    expect(clampStep(2, gate())).toBe(1);
  });

  it('leaves a reachable step alone', () => {
    expect(clampStep(1, gate({ hasFile: true, hasRegister: true }))).toBe(1);
  });
});

describe('canGoBack', () => {
  it('allows going back from Mapping', () => {
    expect(canGoBack(2, gate({ hasFile: true, hasRegister: true }))).toBe(true);
  });

  it('never offers Back on the first step', () => {
    expect(canGoBack(1, gate())).toBe(false);
  });

  // The run is for THAT file under THAT register and nothing in the sheet can retract it, which is
  // the same reason `inputsDisabled` freezes the inputs while a run is live.
  it('refuses to go back while a run is live', () => {
    expect(canGoBack(3, gate({ hasFile: true, hasRegister: true, hasReview: true, runActive: true }))).toBe(false);
  });

  it('allows going back from a parked review, where nothing is in flight', () => {
    expect(canGoBack(3, gate({ hasFile: true, hasRegister: true, hasReview: true }))).toBe(true);
  });
});
