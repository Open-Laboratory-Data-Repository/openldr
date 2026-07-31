import { describe, expect, it } from 'vitest';
import { validateReferences, type ReferenceValidationDeps } from './validate-references';

const model = (over: Record<string, unknown> = {}) => ({
  id: 'm', name: 'M', versionLabel: null, fhirVersion: 'R4',
  fhirResourceType: null, fhirProfileUrl: null, facilityId: null,
  targetPages: [], sections: [], version: 1, active: true, status: 'draft',
  createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
  fields: [{
    id: 'p', fhirPath: null, displayLabel: 'Patient', description: null,
    fieldType: 'reference', required: false, enabled: true, order: 0,
    cardinality: { min: 0, max: '1' }, referenceTarget: 'Patient', ...over,
  }],
}) as never;

const deps = (over: Partial<ReferenceValidationDeps> = {}): ReferenceValidationDeps => ({
  validateCode: async () => ({ result: true, message: 'ok' }),
  exists: async () => true,
  ...over,
});

describe('validateReferences', () => {
  it('accepts an entity answer that exists', async () => {
    expect(await validateReferences(model(), { p: { reference: 'Patient/p1', display: null } }, deps()))
      .toEqual([]);
  });

  it('rejects an entity answer that does not exist', async () => {
    const errors = await validateReferences(
      model(), { p: { reference: 'Patient/ghost', display: null } }, deps({ exists: async () => false }),
    );
    expect(errors).toEqual([{ fieldId: 'p', label: 'Patient', reason: 'Patient/ghost does not exist' }]);
  });

  it('rejects a malformed reference string', async () => {
    const errors = await validateReferences(model(), { p: { reference: 'nope', display: null } }, deps());
    expect(errors).toEqual([{ fieldId: 'p', label: 'Patient', reason: "'nope' is not a valid reference" }]);
  });

  it('rejects a coding outside its ValueSet', async () => {
    const errors = await validateReferences(
      model({ referenceTarget: undefined, valueSetUrl: 'http://x/vs' }),
      { p: { system: 'http://loinc.org', code: 'bad', display: null } },
      deps({ validateCode: async () => ({ result: false, message: 'bad not in http://x/vs' }) }),
    );
    expect(errors).toEqual([{ fieldId: 'p', label: 'Patient', reason: 'bad not in http://x/vs' }]);
  });

  it('reports a terminology failure as a field error rather than throwing', async () => {
    const errors = await validateReferences(
      model({ referenceTarget: 'http://loinc.org' }),
      { p: { system: 'http://loinc.org', code: '718-7', display: null } },
      deps({ validateCode: async () => { throw new Error('terminology unreachable'); } }),
    );
    expect(errors).toEqual([{ fieldId: 'p', label: 'Patient', reason: 'could not be checked: terminology unreachable' }]);
  });

  it('ignores empty and non-reference fields', async () => {
    expect(await validateReferences(model(), {}, deps())).toEqual([]);
  });

  it('rejects a coding whose system does not match the field-bound codesystem, without calling validateCode', async () => {
    let called = false;
    const errors = await validateReferences(
      model({ referenceTarget: 'http://loinc.org' }),
      { p: { system: 'http://snomed.info/sct', code: '718-7', display: null } },
      deps({ validateCode: async () => { called = true; return { result: true, message: 'ok' }; } }),
    );
    expect(errors).toEqual([{
      fieldId: 'p', label: 'Patient',
      reason: "'http://snomed.info/sct' is not the system this field accepts (http://loinc.org)",
    }]);
    expect(called).toBe(false);
  });

  it('validates a codesystem-bound coding against the FIELD system, not the answer system', async () => {
    const received: Array<{ valueSetUrl?: string; code: string; system?: string }> = [];
    const errors = await validateReferences(
      model({ referenceTarget: 'http://loinc.org' }),
      { p: { system: 'http://loinc.org', code: '718-7', display: null } },
      deps({
        validateCode: async (input) => { received.push(input); return { result: true, message: 'ok' }; },
      }),
    );
    expect(errors).toEqual([]);
    expect(received).toEqual([{ system: 'http://loinc.org', code: '718-7' }]);
  });

  it('rejects a coding-shaped answer on an entity-sourced field', async () => {
    const errors = await validateReferences(
      model({ referenceTarget: 'Patient' }),
      { p: { system: 'http://loinc.org', code: '718-7', display: null } },
      deps(),
    );
    expect(errors).toEqual([{
      fieldId: 'p', label: 'Patient',
      reason: "'718-7' is a coded value but this field expects a reference",
    }]);
  });

  it('rejects an entity-shaped answer on a coding-sourced field', async () => {
    const errors = await validateReferences(
      model({ referenceTarget: 'http://loinc.org' }),
      { p: { reference: 'Patient/p1', display: null } },
      deps(),
    );
    expect(errors).toEqual([{
      fieldId: 'p', label: 'Patient',
      reason: "'Patient/p1' is a reference but this field expects a coded value",
    }]);
  });

  it('rejects a coding-shaped answer on a field that declares no reference source', async () => {
    const errors = await validateReferences(
      model({ referenceTarget: undefined }),
      { p: { system: 'http://loinc.org', code: '718-7', display: null } },
      deps(),
    );
    expect(errors).toEqual([{ fieldId: 'p', label: 'Patient', reason: 'field declares no reference source' }]);
  });

  it('rejects an entity-shaped answer on a field that declares no reference source', async () => {
    const errors = await validateReferences(
      model({ referenceTarget: undefined }),
      { p: { reference: 'Patient/p1', display: null } },
      deps(),
    );
    expect(errors).toEqual([{ fieldId: 'p', label: 'Patient', reason: 'field declares no reference source' }]);
  });
});
