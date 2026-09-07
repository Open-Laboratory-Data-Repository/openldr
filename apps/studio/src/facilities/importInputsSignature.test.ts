import { describe, it, expect } from 'vitest';
import { summarySignature, worklistSignature, type ImportInputs } from './importInputsSignature';

const base: ImportInputs = {
  fileName: 'mfl.csv', fileSize: 1024,
  nationalSystem: 'urn:zm:mfl', format: 'csv',
  completeRelease: false, releaseVersion: '',
  columnMap: { columns: { 'MFL Code': 'national_code' }, constants: {}, extras: [] },
  allowUnknownColumns: false, allowInvalidCoordinates: false,
  onConflict: 'skip', onAbsent: 'report', onDeleted: 'report',
  valueMappingsSavedAt: 0,
};

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
    ['a column map edit', { columnMap: { columns: { Name: 'name' }, constants: {}, extras: [] } }],
    ['a fixed value', { columnMap: { columns: { 'MFL Code': 'national_code' }, constants: { country: 'ZMB' }, extras: [] } }],
    ['an allow-override', { allowUnknownColumns: true }],
    ['a conflict policy', { onConflict: 'overwrite' }],
    ['an absent policy', { onAbsent: 'retire' }],
    ['a deleted policy', { onDeleted: 'retire' }],
    ['a saved value mapping', { valueMappingsSavedAt: 1 }],
  ])('changes when %s changes', (_label, patch) => {
    expect(summarySignature({ ...base, ...patch } as ImportInputs)).not.toBe(summarySignature(base));
  });
});

describe('worklistSignature', () => {
  // ⛔ NARROWER ON PURPOSE. The worklist is the set of raw values the operator is working through.
  // Saving one mapping must not make the other nineteen rows vanish mid-edit, and neither must
  // choosing a conflict policy, which has nothing to do with which raw values the file contains.
  it.each([
    ['a saved value mapping', { valueMappingsSavedAt: 1 }],
    ['a conflict policy', { onConflict: 'overwrite' }],
    ['an absent policy', { onAbsent: 'retire' }],
    ['a deleted policy', { onDeleted: 'retire' }],
    ['an allow-override', { allowUnknownColumns: true }],
    ['the complete-release flag', { completeRelease: true }],
  ])('does NOT change when %s changes', (_label, patch) => {
    expect(worklistSignature({ ...base, ...patch } as ImportInputs)).toBe(worklistSignature(base));
  });

  it.each([
    ['a different file', { fileName: 'other.csv' }],
    ['a different register', { nationalSystem: 'urn:tz:hfr' }],
    ['a different format', { format: 'jsonl' as const }],
    ['a column map edit', { columnMap: { columns: { Name: 'name' }, constants: {}, extras: [] } }],
  ])('changes when %s changes', (_label, patch) => {
    expect(worklistSignature({ ...base, ...patch } as ImportInputs)).not.toBe(worklistSignature(base));
  });
});
