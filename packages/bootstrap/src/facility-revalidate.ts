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
  /** Operator-supplied options. Identity fields present here are DROPPED, not refused: a caller
   *  sending a whole stored options blob should get their column map applied, not an error. */
  options: Record<string, unknown>;
}

/**
 * The one state a re-validate may start from.
 *
 * ⛔ NOT a list, and not `!isApplicable(...)`. `awaiting_confirmation` is the only state that has
 * all three of a stored file, a finished validate, and no work in flight. `previewed` (the inline
 * path) stored nothing; `queued`/`validating`/`applying` have work in flight; `confirmed` has been
 * decided; and a `cancelled` run has had its blob DELETED (`facility-import-worker.ts`), so it must
 * be refused on status before anything tries to read a key that now points at nothing.
 */
const REVALIDATABLE = 'awaiting_confirmation';

/**
 * Fields that describe WHICH FILE, UNDER WHICH REGISTER, this run is. They are set once by the
 * upload and are not the operator's to change afterwards: changing a register mid-run would file a
 * national list under the wrong identity, and changing the file reference would validate something
 * nobody uploaded.
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

  if (run.status !== REVALIDATABLE) {
    return {
      ok: false,
      code: 'not-revalidatable',
      message: `import run ${input.runId} cannot be checked again: status is "${run.status}", `
        + `and only "${REVALIDATABLE}" can be`,
    };
  }

  // Asked SEPARATELY from the status guard, deliberately, exactly as the confirm route asks it: a
  // run can be parked and still carry no file if it came from the inline path.
  if (!run.blobKey) {
    return {
      ok: false,
      code: 'no-stored-file',
      message: `import run ${input.runId} has no stored file — it was previewed inline; `
        + 'check it again through POST /api/facilities/import carrying its runId',
    };
  }

  const options: Record<string, unknown> = { ...input.options };
  for (const k of IDENTITY_KEYS) delete options[k];

  if (!await runs.requeueForValidation(input.runId, REVALIDATABLE, options)) {
    return {
      ok: false,
      code: 'raced',
      message: `import run ${input.runId} changed while this request was being handled; read it again`,
    };
  }
  return { ok: true };
}
