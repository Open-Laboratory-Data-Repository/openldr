import { describe, it, expect } from 'vitest';
import {
  TERMINAL_RUN_STATES, SUPERSEDABLE_RUN_STATES, RUNNING_RUN_STATES, CLAIMABLE_RUN_STATES,
  isApplicable, isWorkerObserved, VALIDATE_PHASE, APPLY_PHASE,
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
    // A2b Task 5: `confirmed` is a QUEUE HEAD (the apply worker's), exactly like `queued` — no worker
    // holds it, and nothing expires it. A confirm the apply worker never got to must therefore be
    // takeable over by the next upload, or an operator who confirms on a server that is then stopped
    // locks the register for good.
    expect(SUPERSEDABLE_RUN_STATES.has('confirmed')).toBe(true);
  });

  it('permits an apply only from a state that has a completed preview behind it', () => {
    expect(isApplicable('previewed')).toBe(true);
    expect(isApplicable('awaiting_confirmation')).toBe(true);
    expect(isApplicable('queued')).toBe(false);      // nothing has classified yet
    expect(isApplicable('applying')).toBe(false);    // already in flight
    expect(isApplicable('applied')).toBe(false);     // replay
    expect(isApplicable('cancelled')).toBe(false);
    // A2b Task 5. `confirmed` DOES have a completed preview behind it, and is excluded anyway — the
    // same reason `applying` is: an apply has already been STARTED against it (the operator's confirm
    // handed it to the worker's queue). Admitting it would let the inline route's `runId` apply race
    // the worker over the same run, and would let a second confirm re-queue an already-confirmed one.
    expect(isApplicable('confirmed')).toBe(false);
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

  // A2b Task 4: a cancel is only ever ACTED on by a worker, and a worker only ever touches a run it
  // claims or is already running. Any other state's `cancel_requested` flag is inert forever, which
  // is why `requestCancel` cancels those outright instead of flagging them.
  it('marks exactly the states a worker claims or is already running as worker-observed', () => {
    // Every claim source must be a state a worker can actually take FROM — `claimNext`'s two source
    // states, and no other.
    // A2b Task 5 widens this by ONE concrete member: `confirmed`, the apply phase's queue head.
    // ⚠ `awaiting_confirmation` is still here and STILL claimed by nothing — the carry-forward Task 4
    // moved rather than removed (a cancel on it is flagged and never read). Task 5 deliberately does
    // not deepen it: the apply claims `confirmed`, never `awaiting_confirmation`, so no worker was
    // added that would apply an UNCONFIRMED run. Task 6 owns resolving the flag.
    expect([...CLAIMABLE_RUN_STATES].sort()).toEqual(['awaiting_confirmation', 'confirmed', 'queued']);
    for (const s of CLAIMABLE_RUN_STATES) expect(isWorkerObserved(s)).toBe(true);
    for (const s of RUNNING_RUN_STATES) expect(isWorkerObserved(s)).toBe(true);
    // `previewed` is the inline A2a path's own state: no worker claims it, so a flag set on it would
    // never be read. Terminal states are past caring.
    expect(isWorkerObserved('previewed')).toBe(false);
    for (const s of TERMINAL_RUN_STATES) expect(isWorkerObserved(s)).toBe(false);
  });

  // A2b Task 5. The apply phase's transition is a shared VALUE for the same reason `VALIDATE_PHASE`
  // is: its two halves are spelled in two different packages — the confirm route (apps/server) writes
  // `APPLY_PHASE.from`, and the worker (@openldr/bootstrap) claims from it — and if they drifted, a
  // confirmed run would never be claimed by anything while it went on holding `active_key`.
  it('names the apply phase as one value, from a claimable state into a running one', () => {
    expect(APPLY_PHASE).toEqual({ from: 'confirmed', to: 'applying' });
    // The `from` must be claimable and the `to` must be a state crash recovery sweeps, or a killed
    // apply holds its national register with nothing to release it.
    expect(CLAIMABLE_RUN_STATES.has(APPLY_PHASE.from)).toBe(true);
    expect(RUNNING_RUN_STATES.has(APPLY_PHASE.to)).toBe(true);
    // The two phases are genuinely distinct queues: sharing either half would make one worker claim
    // the other's work.
    expect(APPLY_PHASE.from).not.toBe(VALIDATE_PHASE.from);
    expect(APPLY_PHASE.to).not.toBe(VALIDATE_PHASE.to);
    // ⛔ And the apply's source is NOT the state the operator is merely parked in. This is the whole
    // of "an apply cannot fire without a confirm": nothing but the confirm route writes `confirmed`.
    expect(APPLY_PHASE.from).not.toBe('awaiting_confirmation');
  });

  it('never lets a CLAIMABLE state be one a worker is already running', () => {
    for (const s of CLAIMABLE_RUN_STATES) expect(RUNNING_RUN_STATES.has(s)).toBe(false);
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
