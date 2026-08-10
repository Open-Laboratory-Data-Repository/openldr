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
 *  ⚠ THREE of the four sets below partition the enum; `APPLICABLE_RUN_STATES` does NOT. TERMINAL /
 *  SUPERSEDABLE / RUNNING are exhaustive and mutually exclusive, and the exhaustiveness test
 *  (`facility-import-run-states.test.ts`) forces a state added to `ALL_RUN_STATES` into exactly one
 *  of them. `APPLICABLE_RUN_STATES` cuts ACROSS that partition — it is a separate positive list, and
 *  nothing forces a new state into it, so a state added later silently gets `isApplicable === false`
 *  until someone lists it. That default is fail-closed and correct (an unclassified state has not
 *  earned an apply's trust in its `previewed_at` watermark), but it is a default, not a check: the
 *  exhaustiveness test covers three of the four sets, never the fourth. */

/** Every state, in lifecycle order. The single place a state is introduced: the union below is
 *  derived from this array, so a new entry cannot be omitted from the exhaustiveness test. */
export const ALL_RUN_STATES = [
  // Active — a background run (A2b) moves through these.
  'queued', 'validating', 'awaiting_confirmation', 'applying',
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
 *  then simply never confirms would lock the national system permanently. */
export const SUPERSEDABLE_RUN_STATES: ReadonlySet<FacilityImportRunStatus> =
  new Set<FacilityImportRunStatus>(['queued', 'awaiting_confirmation', 'previewed']);

/** A worker is mid-flight. A new request gets 409 — taking over would race a live run. */
export const RUNNING_RUN_STATES: ReadonlySet<FacilityImportRunStatus> =
  new Set<FacilityImportRunStatus>(['validating', 'applying']);

/** The states an apply may start from: those a preview has RUN to completion for, so that whatever
 *  `previewed_at` the run carries is a watermark an apply may trust as its conflict baseline.
 *  Deliberately a positive list, not `!TERMINAL && !RUNNING` — `queued` is neither, and it reaches an
 *  apply with nothing classified yet. (`validating` IS in `RUNNING_RUN_STATES`, so the negative
 *  formulation would exclude it correctly; `queued` alone is what makes that formulation wrong.)
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
