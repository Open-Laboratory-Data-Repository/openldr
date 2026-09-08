import type { FacilityImportRunStore } from '@openldr/db';

/**
 * Which import runs may be checked again, and what the refusal says. ONE function, called by the
 * route and by the CLI, so the two doors can never disagree about it (`AGENTS.md` §6 item 2).
 */
export type RevalidateOutcome =
  | { ok: true }
  | {
    ok: false;
    /** `not-found` is a 404. The other three are 409s: the run exists, but not in a state this can
     *  act on. */
    code: 'not-found' | 'not-revalidatable' | 'no-stored-file' | 'raced';
    message: string;
  };

export interface RevalidateInput {
  runId: string;
  /** Operator-supplied options. Identity fields present here are IGNORED, not refused: a caller
   *  sending a whole stored options blob should get their column map applied, not an error. The
   *  run's OWN identity values are written back in their place — see `IDENTITY_KEYS`. */
  options: Record<string, unknown>;
}

/**
 * The states a re-validate may start from. Two, not a list built from `!isApplicable(...)`.
 *
 * ⛔ `stored` is here because Task 2 (facility-import-data-stage) split the upload from the
 * validate: the upload can now store a file and validate nothing, so the FIRST validate a national
 * register ever gets has to be asked for later, once a column map exists (Mapping), not at upload
 * time. A `stored` run has no summary, no recorded options, and its column map is being SET for the
 * first time, not changed. Nothing has been approved and nothing here can disagree with an approval
 * that never happened.
 *
 * ⛔ `awaiting_confirmation` is untouched from before this task: the only OTHER state that has all
 * three of a stored file, a finished validate, and no work in flight. The operator has not
 * confirmed yet (that is `confirmed`, below), so checking it again under a corrected map is the
 * same re-check it always was.
 *
 * ⛔ Every other state stays refused, and this is the guard's real job. `previewed` (the inline
 * path) stored nothing; `queued`/`validating`/`applying` have work in flight; `confirmed` is where
 * the operator's approval actually lives. A re-validate there could get the apply to classify a
 * different record set than the one that was approved, which is the exact defect this guard exists
 * to prevent; and a `cancelled` run has had its blob DELETED (`facility-import-worker.ts`), so it
 * must be refused on status before anything tries to read a key that now points at nothing.
 */
const REVALIDATABLE_STATUSES = new Set(['stored', 'awaiting_confirmation']);
const REVALIDATABLE_LABEL = '"stored" or "awaiting_confirmation"';

/**
 * Fields that describe WHICH FILE, UNDER WHICH REGISTER, this run is. They are set once by the
 * upload and are not the operator's to change afterwards: changing a register mid-run would file a
 * national list under the wrong identity, and changing the file reference would validate something
 * nobody uploaded.
 *
 * ⛔ CARRIED FORWARD OFF THE RUN, NOT MERELY DROPPED FROM THE REQUEST, and the difference is the
 * whole of the defect this comment exists for. `requeueForValidation` REPLACES the run's `options`;
 * it does not merge (see its own note in `facility-import-run-store.ts`). Dropping these keys and
 * writing nothing back therefore ERASES them. `completeRelease` has no column on the run row, so
 * the worker reads it out of `run.options` alone and cannot recover it: the operator ticks "this
 * file is a complete release" on Source, the validate reports `absent: null` meaning NOT EVALUATED,
 * and a later `onAbsent: 'retire'` retires nothing. That flag is what makes a national register's
 * absences mean anything. It only ever bit on a re-check before; now that Mapping's Validate all is
 * the ONLY path to a FIRST validate, it bit every browser import.
 *
 * ⛔ THE CLIENT STILL CANNOT SUPPLY ONE. The value written is the run's own, read back off the row.
 * A value arriving in the request is discarded before this runs, and the route's zod schema forbids
 * these keys outright. Carrying forward what the upload recorded is not the same as accepting a new
 * one, and this must never become the same.
 *
 * A field added to the run's options later needs a decision here: is it a thing the operator may
 * change between checks, or a thing the upload settled? Default to settled.
 */
const IDENTITY_KEYS = [
  'nationalSystem', 'sourceFormat', 'completeRelease', 'releaseVersion',
  'blobKey', 'fileHash', 'byteSize',
] as const;

export async function revalidateImportRun(
  runs: FacilityImportRunStore,
  input: RevalidateInput,
): Promise<RevalidateOutcome> {
  const run = await runs.get(input.runId);
  if (!run) {
    return { ok: false, code: 'not-found', message: `import run not found: ${input.runId}` };
  }

  if (!REVALIDATABLE_STATUSES.has(run.status)) {
    return {
      ok: false,
      code: 'not-revalidatable',
      message: `import run ${input.runId} cannot be checked again: status is "${run.status}", `
        + `and only ${REVALIDATABLE_LABEL} can be`,
    };
  }

  // Asked SEPARATELY from the status guard, deliberately, exactly as the confirm route asks it: a
  // run can be parked and still carry no file if it came from the inline path.
  if (!run.blobKey) {
    return {
      ok: false,
      code: 'no-stored-file',
      message: `import run ${input.runId} has no stored file: it was previewed inline; `
        + 'check it again through POST /api/facilities/import carrying its runId',
    };
  }

  // Stored identity first, the operator's choices after, which is the order the confirm route
  // already writes in (`facilities-routes.ts`, `{ ...storedOptions, ...chosen }`). The loop below
  // then puts the stored identity back on top, so neither an operator nor a script can move a run
  // onto another register or another file by sending one of these.
  const stored = (run.options && typeof run.options === 'object' && !Array.isArray(run.options)
    ? run.options
    : {}) as Record<string, unknown>;
  const options: Record<string, unknown> = { ...input.options };
  for (const k of IDENTITY_KEYS) {
    delete options[k];
    // `in`, not a truthiness test: `completeRelease: false` is a recorded decision and stays
    // recorded, while a key the upload never wrote stays ABSENT rather than being written as an
    // explicit `undefined` that would read as a decision nobody made.
    if (k in stored) options[k] = stored[k];
  }

  // `run.status`, not a fixed constant: two statuses are revalidatable now, and the compare-and-swap
  // has to match whichever one this run was actually read at, or a `stored` run's CAS would compare
  // against `awaiting_confirmation` and never match.
  if (!await runs.requeueForValidation(input.runId, run.status, options)) {
    return {
      ok: false,
      code: 'raced',
      message: `import run ${input.runId} changed while this request was being handled; read it again`,
    };
  }
  return { ok: true };
}
