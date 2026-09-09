
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
  /** How many times the OPERATOR has changed the column map, NOT the map itself.
   *
   *  ⛔ MEASURED, and the reason this is a counter. `ColumnMapStep` writes its suggestion seed into
   *  the map when the asynchronous suggestion call resolves, which can land after a check has run.
   *  Keyed on content, that seed was indistinguishable from an edit and silently discarded the
   *  Review the operator had just earned: 25 tests failed under load and passed alone. A
   *  programmatic reset of the map always accompanies a new file, register or format, and all
   *  three are already here. */
  columnMapEdits: number;
  allowUnknownColumns: boolean;
  allowInvalidCoordinates: boolean;
  /** ⛔ THE POLICY CHOICES ARE DELIBERATELY ABSENT from this type, and an earlier draft had them.
   *  `runPreview` sends `format`, `completeRelease`, `releaseVersion`, `columnMap` and the two
   *  parse overrides; it never sends `onConflict`/`onAbsent`/`onDeleted`, which ride the APPLY and
   *  the confirm instead. So a policy cannot change a single number a check reports, and retiring
   *  the summary over one would have forced a full re-upload of a national register on the streamed
   *  door to change a dropdown. Review renders the live policy rather than a snapshot, so nothing
   *  it says can go stale either way. */
  /** Bumped whenever value mappings are written. The mappings themselves live server-side in
   *  `term_mappings` and only take effect on a fresh parse, so the sheet cannot compare them; a
   *  monotonic stamp is what makes "something was saved" comparable at all. */
  valueMappingsSavedAt: number;
  /** Bumped every time the Data grid writes or undoes a cell edit (Slice C). In
   *  `summarySignature` but NOT in `worklistSignature`: an edit changes what the file parses to, so
   *  a validated summary computed before it is no longer a claim about this file. The worklist is
   *  left alone deliberately, for the reason `worklistSignature`'s own note gives about a save. */
  cellEditsAt: number;
}

/** `JSON.stringify` over an explicit array, not over the object: key order in an object literal is
 *  a refactoring hazard, and an array states the field list in one readable place. */
const sig = (parts: unknown[]): string => JSON.stringify(parts);

/**
 * What a Review summary is valid for. Any change here means the summary on screen describes inputs
 * that no longer exist, and the sheet discards it rather than showing a stale number.
 *
 * ⛔ THE POLICY SELECTS ARE NOT IN HERE. See `ImportInputs` for the measurement that took them out.
 */
export function summarySignature(i: ImportInputs): string {
  return sig([
    i.fileName, i.fileSize, i.nationalSystem, i.format, i.completeRelease, i.releaseVersion,
    i.columnMapEdits, i.allowUnknownColumns, i.allowInvalidCoordinates,
    i.valueMappingsSavedAt, i.cellEditsAt,
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
  return sig([i.fileName, i.fileSize, i.nationalSystem, i.format, i.columnMapEdits]);
}
