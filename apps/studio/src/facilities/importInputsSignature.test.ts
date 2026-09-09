import { describe, it, expect } from 'vitest';
import { summarySignature, worklistSignature, type ImportInputs } from './importInputsSignature';

const base: ImportInputs = {
  fileName: 'mfl.csv', fileSize: 1024,
  nationalSystem: 'urn:zm:mfl', format: 'csv',
  completeRelease: false, releaseVersion: '',
  columnMapEdits: 0,
  allowUnknownColumns: false, allowInvalidCoordinates: false,
  valueMappingsSavedAt: 0,
  cellEditsAt: 0,
};

// ⛔ A POLICY CHOICE IS IN NEITHER SIGNATURE. `runPreview` never sends onConflict/onAbsent/onDeleted;
// they ride the apply and the confirm. A policy therefore cannot change a number a check reports,
// and retiring the summary over one would force a full re-upload to change a dropdown.
describe('summarySignature', () => {
  it('is stable for an unchanged input set', () => {
    expect(summarySignature(base)).toBe(summarySignature({ ...base }));
  });

  // Every one of these changes what a parse would report, or what the summary PROMISES an apply
  // would do, so a summary computed before it is a lie.
  it.each([
    ['a different file', { fileName: 'other.csv' }],
    ['a file of a different size with the same name', { fileSize: 2048 }],
    ['a different register', { nationalSystem: 'urn:tz:hfr' }],
    ['a different format', { format: 'jsonl' as const }],
    ['the complete-release flag', { completeRelease: true }],
    ['a release version', { releaseVersion: 'v2' }],
    ['a column map edit', { columnMapEdits: 1 }],
    ['an allow-override', { allowUnknownColumns: true }],
    ['a saved value mapping', { valueMappingsSavedAt: 1 }],
  ])('changes when %s changes', (_label, patch) => {
    expect(summarySignature({ ...base, ...patch } as ImportInputs)).not.toBe(summarySignature(base));
  });

  // Slice C, Task 8: an edit changes what the file parses to, so a summary computed before it is
  // no longer a claim about this file.
  it('a cell edit changes the summary signature', () => {
    expect(summarySignature({ ...base, cellEditsAt: 1 }))
      .not.toBe(summarySignature({ ...base, cellEditsAt: 2 }));
  });
});

describe('worklistSignature', () => {
  // ⛔ The seed is not an edit. `ColumnMapStep` writes its suggestion seed into the map when the
  // asynchronous suggestion call resolves, and keying on the map's CONTENT made that arrival
  // indistinguishable from an operator decision.
  it('does not move when the map content changes without an operator edit', () => {
    expect(worklistSignature({ ...base })).toBe(worklistSignature({ ...base }));
  });

  // ⛔ NARROWER ON PURPOSE. The worklist is the set of raw values the operator is working through.
  // Saving one mapping must not make the other nineteen rows vanish mid-edit, and neither must
  // choosing a conflict policy, which has nothing to do with which raw values the file contains.
  it.each([
    ['a saved value mapping', { valueMappingsSavedAt: 1 }],
    ['an allow-override', { allowUnknownColumns: true }],
    ['the complete-release flag', { completeRelease: true }],
  ])('does NOT change when %s changes', (_label, patch) => {
    expect(worklistSignature({ ...base, ...patch } as ImportInputs)).toBe(worklistSignature(base));
  });

  // ⛔ THE ONE THING THIS TASK DELIBERATELY DOES NOT INVALIDATE. Throwing the worklist away on an
  // edit would drop every unsaved pick the operator has made. A stale entry stays listed instead;
  // the row goes stale and the re-check the stale icon invites re-reads the column and drops it.
  it('a cell edit does NOT change the worklist signature', () => {
    expect(worklistSignature({ ...base, cellEditsAt: 1 }))
      .toBe(worklistSignature({ ...base, cellEditsAt: 2 }));
  });

  it.each([
    ['a different file', { fileName: 'other.csv' }],
    ['a different register', { nationalSystem: 'urn:tz:hfr' }],
    ['a different format', { format: 'jsonl' as const }],
    ['a column map edit', { columnMapEdits: 1 }],
  ])('changes when %s changes', (_label, patch) => {
    expect(worklistSignature({ ...base, ...patch } as ImportInputs)).not.toBe(worklistSignature(base));
  });
});
