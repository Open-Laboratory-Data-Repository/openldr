import { describe, it, expect } from 'vitest';
import {
  TERMINAL_RUN_STATES, SUPERSEDABLE_RUN_STATES, RUNNING_RUN_STATES, isApplicable,
  ALL_RUN_STATES, type FacilityImportRunStatus,
} from './facility-import-run-states';

describe('facility import run states', () => {
  it('classifies every state exactly once across terminal/supersedable/running', () => {
    for (const s of ALL_RUN_STATES) {
      const n = [TERMINAL_RUN_STATES, SUPERSEDABLE_RUN_STATES, RUNNING_RUN_STATES]
        .filter((set) => set.has(s)).length;
      expect(n, `state ${s} is in ${n} sets, expected exactly 1`).toBe(1);
    }
  });

  it('never lets a RUNNING state be superseded — taking over would race a live worker', () => {
    for (const s of RUNNING_RUN_STATES) expect(SUPERSEDABLE_RUN_STATES.has(s)).toBe(false);
  });

  it('treats an abandoned queued/awaiting run as supersedable, not as a permanent lock', () => {
    expect(SUPERSEDABLE_RUN_STATES.has('queued')).toBe(true);
    expect(SUPERSEDABLE_RUN_STATES.has('awaiting_confirmation')).toBe(true);
    expect(SUPERSEDABLE_RUN_STATES.has('previewed')).toBe(true);
  });

  it('permits an apply only from a state that has a completed preview behind it', () => {
    expect(isApplicable('previewed')).toBe(true);
    expect(isApplicable('awaiting_confirmation')).toBe(true);
    expect(isApplicable('queued')).toBe(false);      // nothing has classified yet
    expect(isApplicable('applying')).toBe(false);    // already in flight
    expect(isApplicable('applied')).toBe(false);     // replay
    expect(isApplicable('cancelled')).toBe(false);
  });

  // Not in the brief's list, and the two states it leaves unstated are exactly the two an apply
  // guard would wrongly wave through if `isApplicable` were written as a negation of the states the
  // brief DOES name. `validating` has no completed preview behind it yet; `failed` is terminal, and
  // A2a's `:1299` guard already 409s a `failed` run (facilities-routes.test.ts pins the `applied`
  // half of that with "replaying an already-applied runId is a 409").
  it('refuses an apply from the two states the brief leaves unstated', () => {
    expect(isApplicable('validating')).toBe(false);
    expect(isApplicable('failed')).toBe(false);
  });

  // A2a's Critical finding was a guard written against a narrow condition meeting a wider one
  // later. `ALL_RUN_STATES` is the single place a state is introduced, and the union is derived
  // from it — this pins that the derivation, not a hand-maintained second list, is what the
  // exhaustiveness test above iterates.
  it('derives the union from ALL_RUN_STATES, which carries every state exactly once', () => {
    expect(new Set(ALL_RUN_STATES).size).toBe(ALL_RUN_STATES.length);
    const union: FacilityImportRunStatus[] = [
      ...TERMINAL_RUN_STATES, ...SUPERSEDABLE_RUN_STATES, ...RUNNING_RUN_STATES,
    ];
    expect([...union].sort()).toEqual([...ALL_RUN_STATES].sort());
  });
});
