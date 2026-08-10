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
 *  the value; this module is the only thing that ever has. */

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

/** Nothing more will happen to this run. Its `active_key` is released — `finishApply` nulls the key
 *  in the same update that moves the run here, which is what stops a finished row holding its
 *  national system for good (see `facility-import-run-store.ts`). */
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

/** The states an apply may start from: exactly those with a COMPLETED preview behind them, whose
 *  `previewed_at` watermark an apply can therefore trust as its conflict baseline. Deliberately a
 *  positive list, not `!TERMINAL && !RUNNING` — `queued` and `validating` are neither, and both
 *  reach an apply with nothing classified yet. */
const APPLICABLE_RUN_STATES: ReadonlySet<FacilityImportRunStatus> =
  new Set<FacilityImportRunStatus>(['previewed', 'awaiting_confirmation']);

/** May an apply be started against this run? */
export function isApplicable(status: FacilityImportRunStatus): boolean {
  return APPLICABLE_RUN_STATES.has(status);
}
