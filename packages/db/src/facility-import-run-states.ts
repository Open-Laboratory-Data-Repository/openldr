/** The lifecycle of a `facility_import_runs` row, named once so no caller has to spell a state
 *  literal into a comparison.
 *
 *  ⛔ WHY THIS MODULE EXISTS. A2a shipped three states and two route guards written as
 *  `status !== 'previewed'` (`apps/server/src/facilities-routes.ts`: the supersede gate and the
 *  apply guard). Widening the enum for A2b's background job without widening those guards would
 *  make a `queued` or `awaiting_confirmation` run neither supersedable nor appliable — the register
 *  locks out of every future import, which is the exact defect A2a's fix wave closed. The guards
 *  now ask these sets, so a state added below is classified in ONE place.
 *
 *  ⛔ IT LIVES IN `@openldr/db`, NOT `@openldr/bootstrap`. `facility-import-run-store.ts` (this
 *  package) needs the union, and `@openldr/bootstrap` already depends on `@openldr/db` — putting it
 *  in bootstrap would be a cycle that does not compile.
 *
 *  ⚠ `facility_import_runs.status` is a plain `text notNull` column with NO check constraint
 *  (migration 080), so widening this union needs no migration. The database has never restricted
 *  the value; this module is the only thing that ever has.
 *
 *  ⚠ THREE of the five sets below partition the enum; `CLAIMABLE_RUN_STATES` and
 *  `APPLICABLE_RUN_STATES` do NOT. TERMINAL / SUPERSEDABLE / RUNNING are exhaustive and mutually
 *  exclusive, and the exhaustiveness test (`facility-import-run-states.test.ts`) forces a state added
 *  to `ALL_RUN_STATES` into exactly one of them. The other two cut ACROSS that partition — each is a
 *  separate positive list, and nothing forces a new state into either, so a state added later
 *  silently gets `isApplicable === false` and `isWorkerObserved === false` until someone lists it.
 *  Both defaults are fail-closed and correct (an unclassified state has not earned an apply's trust
 *  in its `previewed_at` watermark, and a cancel on a state no worker claims must be carried out by
 *  the writer rather than left as a flag), but they are defaults, not checks: the exhaustiveness test
 *  covers three of the five sets, never the other two. */

/** Every state, in lifecycle order. The single place a state is introduced: the union below is
 *  derived from this array, so a new entry cannot be omitted from the exhaustiveness test. */
export const ALL_RUN_STATES = [
  // Active — a background run (A2b) moves through these.
  //
  // ⛔ `confirmed` is a state and not a boolean column, and that is the whole of A2b Task 5's
  // authorisation model. `claimNext` selects on `status` alone, so the ONLY way an apply worker can
  // be stopped from claiming a run the operator has not decided about is for the confirm to move it
  // into a state of its own. `awaiting_confirmation` is where a run WAITS; `confirmed` is where the
  // operator has put it, and nothing but the confirm route writes it. See `APPLY_PHASE`.
  'queued', 'validating', 'awaiting_confirmation', 'confirmed', 'applying',
  // The inline preview/apply path A2a shipped mints exactly this one.
  'previewed',
  // Terminal.
  'applied', 'failed', 'cancelled',
] as const;

export type FacilityImportRunStatus = (typeof ALL_RUN_STATES)[number];

/** Nothing more will happen to this run, and a run here must NOT be holding `active_key`.
 *
 *  ⚠ That is a rule this module states, not one anything enforces — no constraint, no trigger, and
 *  no test in THIS file can see it. It is met because every writer of a terminal status nulls
 *  `active_key` in the same update, and A2b Task 2 made that structural rather than repeated:
 *  `finishApply` (`'applied' | 'failed'`, the inline path) and `finish` (`'applied' | 'failed' |
 *  'cancelled'`, the worker's) both delegate to ONE private `finishRun` in
 *  `facility-import-run-store.ts`, so the clear cannot be present in one and missing from the other.
 *  `supersede` and `failStaleRunning` write `failed` by their own guarded UPDATEs and clear the key
 *  there too. Any FUTURE writer of a terminal status must do the same, or that run holds its national
 *  system for good and locks the register out of every import. */
export const TERMINAL_RUN_STATES: ReadonlySet<FacilityImportRunStatus> =
  new Set<FacilityImportRunStatus>(['applied', 'failed', 'cancelled']);

/** A run a NEW request may take over: the operator walked away. Superseded, never 409'd.
 *
 *  Nothing expires a run that stays here, so without this an operator who previews (or uploads) and
 *  then simply never confirms would lock the national system permanently.
 *
 *  ⚠ `confirmed` IS here, which reads odd next to the other three (the operator did NOT walk away —
 *  they asked for the write). It belongs anyway, because the test is "is a worker holding this
 *  run?", not "did the operator mean it": a `confirmed` run is sitting in a queue no worker has
 *  reached, exactly like `queued`, and nothing expires it either. A server stopped between the
 *  confirm and the apply would otherwise leave the register locked with no operator path back. What
 *  a take-over costs here is one un-run apply, which the superseding upload replaces. */
export const SUPERSEDABLE_RUN_STATES: ReadonlySet<FacilityImportRunStatus> =
  new Set<FacilityImportRunStatus>(['queued', 'awaiting_confirmation', 'confirmed', 'previewed']);

/** A worker is mid-flight. A new request gets 409 — taking over would race a live run. */
export const RUNNING_RUN_STATES: ReadonlySet<FacilityImportRunStatus> =
  new Set<FacilityImportRunStatus>(['validating', 'applying']);

/** The states `claimNext` may take a run FROM — the queue heads of the two worker phases (validate
 *  claims `VALIDATE_PHASE.from`, apply claims `APPLY_PHASE.from`).
 *
 *  ⚠ Like `APPLICABLE_RUN_STATES` below, this cuts ACROSS the three-way partition rather than
 *  extending it (every member is also SUPERSEDABLE — an operator who walks away from any of them is
 *  taken over, which is the whole reason those states are supersedable), so the exhaustiveness
 *  test cannot force a new state in here. That default is fail-closed for `isWorkerObserved`: an
 *  unclassified state counts as one NO worker will reach, and a cancel on it is therefore effected
 *  immediately rather than left as a flag nothing reads.
 *
 *  ⛔ CARRY-FORWARD, unresolved and deliberately not deepened by A2b Task 5. `awaiting_confirmation`
 *  is listed here because `claimNext`'s TYPE names it, not because any worker claims it — and after
 *  Task 5 no worker claims it still: the apply phase claims `APPLY_PHASE.from` (`confirmed`), so
 *  that a run the operator has not decided about can never be written. The consequence is that
 *  `isWorkerObserved('awaiting_confirmation')` is `true`, so `requestCancel` merely FLAGS a run
 *  parked for the operator and nothing ever reads the flag — the exact shape this module's
 *  `isWorkerObserved` comment describes for `previewed`. A2b Task 6 (cancel) owns resolving it. */
export const CLAIMABLE_RUN_STATES: ReadonlySet<FacilityImportRunStatus> =
  new Set<FacilityImportRunStatus>(['queued', 'awaiting_confirmation', 'confirmed']);

/** The validate phase's transition as ONE value: the state it claims a run FROM and the state it
 *  moves that run TO.
 *
 *  ⛔ WHY IT IS A SHARED CONSTANT AND NOT TWO LITERALS. Both halves are spelled in two different
 *  packages — `claimNext(from, to)` in `@openldr/bootstrap`'s import worker, and
 *  `completeValidation`'s `where status = <to>` compare-and-swap in `facility-import-run-store.ts`
 *  — and they must agree. Change one and every validation silently DROPS: the CAS matches 0 rows,
 *  `completeValidation` returns `false`, and the worker logs "was taken over" for a run nothing took
 *  over, while the register stays locked until a sweep or a supersede frees it. No test can catch
 *  that drift, because each side on its own stays internally consistent — the two spellings simply
 *  stop being the same string. Naming the pair here makes them the same VALUE, so they cannot
 *  disagree.
 *
 *  ⚠ The literal types are declared rather than inferred so `claimNext`'s narrowed parameter types
 *  (`'queued' | 'awaiting_confirmation'`, `'validating' | 'applying'`) still accept them. */
export const VALIDATE_PHASE: { readonly from: 'queued'; readonly to: 'validating' } =
  { from: 'queued', to: 'validating' };

/** The apply phase's transition as ONE value, exactly as `VALIDATE_PHASE` names the validate's.
 *
 *  ⛔ WHY IT IS A SHARED CONSTANT. Its two halves are spelled in two different packages, and neither
 *  is checkable from the other: `POST /api/facilities/import/runs/:id/confirm` (apps/server) writes
 *  `from` through `confirm()`, and the worker in `@openldr/bootstrap` claims `claimNext(from, to)`.
 *  Spelled separately they can drift, and the drift is silent in the worst possible direction — the
 *  confirm answers 202, the operator is told their import is queued, and NO worker ever claims the
 *  run while it goes on holding `active_key`. Naming the pair here makes them the same VALUE.
 *
 *  ⛔ `from` is `'confirmed'` and NOT `'awaiting_confirmation'`, which is the entire safety property
 *  of the two-phase flow. `claimNext` selects on status alone, so an apply claiming the parked state
 *  would write a national register the moment a validate finished — with no operator decision
 *  anywhere in the path. The confirm route is the only writer of `'confirmed'`, so the apply cannot
 *  fire without one. */
export const APPLY_PHASE: { readonly from: 'confirmed'; readonly to: 'applying' } =
  { from: 'confirmed', to: 'applying' };

/** Will a worker ever look at this run again — and therefore ever READ its `cancel_requested` flag?
 *
 *  ⛔ WHY THIS EXISTS (A2b Task 4's carry-forward from Task 2's review). `requestCancel` guarded only
 *  on "not terminal", so a cancel on a `previewed` run — the state the INLINE A2a preview mints, and
 *  the one state no `claimNext` ever names — returned `'requested'`, set the flag, and was inert
 *  forever: no worker claims `previewed`, so nothing would ever observe it, and the run kept
 *  `active_key` while the operator had been told their import was asked to stop. The register was
 *  then reachable only by the next upload's supersede gate. A cancel that cannot be carried out by a
 *  worker must therefore be carried out by the WRITER — see `requestCancel` in
 *  `facility-import-run-store.ts`. */
export function isWorkerObserved(status: FacilityImportRunStatus): boolean {
  return CLAIMABLE_RUN_STATES.has(status) || RUNNING_RUN_STATES.has(status);
}

/** The states an apply may start from: those a preview has RUN to completion for, so that whatever
 *  `previewed_at` the run carries is a watermark an apply may trust as its conflict baseline.
 *  Deliberately a positive list, not `!TERMINAL && !RUNNING` — `queued` is neither, and it reaches an
 *  apply with nothing classified yet. (`validating` IS in `RUNNING_RUN_STATES`, so the negative
 *  formulation would exclude it correctly; `queued` alone is what makes that formulation wrong.)
 *
 *  ⛔ `confirmed` is deliberately ABSENT even though a preview HAS run to completion for it. The
 *  question this set answers is "may an apply be STARTED", and a confirmed run already has one
 *  started against it — the operator handed it to the apply queue. Admitting it would let the inline
 *  route's `runId` apply race the worker over the same run (two writes, one watermark), and would
 *  let the confirm route re-queue a run it had already queued. Same exclusion, same reason, as
 *  `applying`.
 *
 *  ⚠ Membership here does NOT promise a non-null `previewed_at`. `startPreview` inserts the row
 *  already `previewed` and `completePreview` stamps `previewed_at` in a LATER statement (see
 *  `facility-import-run-store.ts`), so a run whose process died between the two is `previewed`,
 *  `isApplicable`, and has no watermark at all. That is handled, not broken: the route passes
 *  `previewedAt: null` through to `importFacilities`, which then reports `conflict: null` — NOT
 *  EVALUATED, never `0`. A null watermark is the honest answer to "were conflicts checked?", so this
 *  set gates on "may an apply start", never on "is a watermark present". */
const APPLICABLE_RUN_STATES: ReadonlySet<FacilityImportRunStatus> =
  new Set<FacilityImportRunStatus>(['previewed', 'awaiting_confirmation']);

/** May an apply be started against this run? */
export function isApplicable(status: FacilityImportRunStatus): boolean {
  return APPLICABLE_RUN_STATES.has(status);
}
