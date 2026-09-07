import type { FacilityColumnMap } from '@/api';

/** Everything a parse's answer depends on. Deliberately a flat value object and not the sheet's
 *  state: this module must not know what a run, a preview or a summary is, the same discipline
 *  `stepModel.ts` already keeps, so it can be tested as arithmetic. */
export interface ImportInputs {
  /** The file is identified by name and size rather than held: a `File` is a new object identity on
   *  every pick, so comparing the object would report a change on every render. Name plus size is
   *  not a hash and cannot catch an edit-in-place of the same length. That is accepted: the case
   *  this guards is the operator picking a different file, and a fresh check is one action away
   *  either way. */
  fileName: string | null;
  fileSize: number | null;
  nationalSystem: string;
  format: 'csv' | 'jsonl';
  completeRelease: boolean;
  releaseVersion: string;
  columnMap: FacilityColumnMap;
  allowUnknownColumns: boolean;
  allowInvalidCoordinates: boolean;
  onConflict: string;
  onAbsent: string;
  onDeleted: string;
  /** Bumped whenever value mappings are written. The mappings themselves live server-side in
   *  `term_mappings` and only take effect on a fresh parse, so the sheet cannot compare them; a
   *  monotonic stamp is what makes "something was saved" comparable at all. */
  valueMappingsSavedAt: number;
}

/** `JSON.stringify` over an explicit array, not over the object: key order in an object literal is
 *  a refactoring hazard, and an array states the field list in one readable place. */
const sig = (parts: unknown[]): string => JSON.stringify(parts);

/**
 * What a Review summary is valid for. Any change here means the summary on screen describes inputs
 * that no longer exist, and the sheet discards it rather than showing a stale number.
 *
 * ⛔ THE POLICY SELECTS ARE IN HERE. `onConflict`/`onAbsent`/`onDeleted` do not change what a parse
 * READS, but they change what the summary PROMISES the apply will do, and the summary states that
 * promise. A summary still saying "2 absent facilities will be retired" after the operator switched
 * to report is exactly the false number this whole design exists to keep off the screen.
 */
export function summarySignature(i: ImportInputs): string {
  return sig([
    i.fileName, i.fileSize, i.nationalSystem, i.format, i.completeRelease, i.releaseVersion,
    i.columnMap, i.allowUnknownColumns, i.allowInvalidCoordinates,
    i.onConflict, i.onAbsent, i.onDeleted, i.valueMappingsSavedAt,
  ]);
}

/**
 * What the value-mapping worklist is valid for: only the things that change which raw values the
 * file contains at all.
 *
 * ⛔ NARROWER THAN `summarySignature`, and that gap is the feature. Saving a mapping, or picking a
 * conflict policy, must not empty the list of values the operator is halfway through fixing.
 */
export function worklistSignature(i: ImportInputs): string {
  return sig([i.fileName, i.fileSize, i.nationalSystem, i.format, i.columnMap]);
}
