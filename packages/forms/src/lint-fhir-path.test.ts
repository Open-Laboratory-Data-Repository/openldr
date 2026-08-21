import { describe, expect, it } from 'vitest';
import { lintFhirPaths } from './lint-fhir-path';
import type { FormSchema, FormField } from './schema/form-schema';

function field(partial: Partial<FormField> & { id: string }): FormField {
  return {
    displayLabel: partial.id, description: null, fieldType: 'text',
    required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' },
    fhirPath: null, ...partial,
  } as FormField;
}

function form(fhirResourceType: string | null, fields: FormField[]): FormSchema {
  return {
    id: 'f', name: 'F', versionLabel: null, fhirVersion: null, fhirResourceType,
    fhirProfileUrl: null, facilityId: null, fields, sections: [], targetPages: [],
    version: 1, active: true, status: 'draft', createdAt: '', updatedAt: '',
  } as FormSchema;
}

const codes = (issues: ReturnType<typeof lintFhirPaths>): string[] => issues.map((i) => i.code);

describe('unknown-fhir-path', () => {
  it('fires at error severity for a path absent from the table', () => {
    const issues = lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'address.zone' })]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'unknown-fhir-path', severity: 'error', fieldId: 'a' });
  });

  it('accepts a real path', () => {
    expect(codes(lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'address.district' })])))).toEqual([]);
  });

  it('accepts a path already carrying its resource prefix', () => {
    expect(codes(lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'Location.address.district' })])))).toEqual([]);
  });

  it('accepts a path prefixed with a DIFFERENT covered resource type', () => {
    // The shipped Lab order form declares ServiceRequest and binds Specimen.type on a
    // `reference` field (samples/forms.ts). fieldType must match: Specimen.type is a
    // CodeableConcept leaf, and the default `text` from `field()` would trip the unrelated
    // fhir-path-type-mismatch rule, which is not what this test isolates.
    expect(codes(lintFhirPaths(form('ServiceRequest', [field({ id: 'a', fhirPath: 'Specimen.type', fieldType: 'reference' })])))).toEqual([]);
  });

  it('STAYS SILENT for a resource type the table does not cover', () => {
    // The builder offers 145 resource types; the table covers 9. Firing here at error
    // severity would make every form on the other 136 permanently unpublishable.
    expect(codes(lintFhirPaths(form('Condition', [field({ id: 'a', fhirPath: 'onsetDateTime' })])))).toEqual([]);
  });

  it('stays silent for a form with no resource type at all', () => {
    expect(codes(lintFhirPaths(form(null, [field({ id: 'a', fhirPath: 'address.district' })])))).toEqual([]);
  });

  it('ignores a disabled field and a null path', () => {
    const issues = lintFhirPaths(form('Location', [
      field({ id: 'a', fhirPath: 'address.zone', enabled: false }),
      field({ id: 'b', fhirPath: null }),
    ]));
    expect(codes(issues)).toEqual([]);
  });
});

describe('unknown-fhir-path, depth past the generated table', () => {
  it('accepts a real path deeper than the table (depth 4, table caps at 3)', () => {
    // Observation.component.code is CodeableConcept, so .coding.code is a real R4 element, but
    // the table only lists Observation.component.code.coding (depth 3), not the .code under it.
    const issues = lintFhirPaths(form('Observation', [
      field({ id: 'a', fhirPath: 'component.code.coding.code' }),
    ]));
    expect(codes(issues)).toEqual([]);
  });

  it('still fires when the depth-3 ancestor of a deep path is not real', () => {
    // "bogus" is not a real element of Observation.component, so the depth-3 ancestor
    // (component.bogus.coding) is not in the table either, and the typo still gets caught.
    const issues = lintFhirPaths(form('Observation', [
      field({ id: 'a', fhirPath: 'component.bogus.coding.code' }),
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'unknown-fhir-path', severity: 'error', fieldId: 'a' });
  });

  it('still fires for a typo at depth 3, inside the table\'s own coverage', () => {
    const issues = lintFhirPaths(form('Observation', [
      field({ id: 'a', fhirPath: 'component.code.bogus' }),
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'unknown-fhir-path', severity: 'error', fieldId: 'a' });
  });
});

describe('fhir-path-cardinality', () => {
  it('fires at warning severity when the path crosses an array with no discriminator', () => {
    // Location.identifier is Identifier[], so `value` below it is array-reached.
    const issues = lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'identifier.value' })]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'fhir-path-cardinality', severity: 'warning', fieldId: 'a' });
  });

  it('stays silent when a fhirDiscriminator names the element', () => {
    const issues = lintFhirPaths(form('Location', [
      field({ id: 'a', fhirPath: 'identifier.value', fhirDiscriminator: { system: 'urn:x' } }),
    ]));
    expect(codes(issues)).toEqual([]);
  });

  it('stays silent when the path carries a numeric index', () => {
    expect(codes(lintFhirPaths(form('Patient', [field({ id: 'a', fhirPath: 'name.0.given' })])))).toEqual([]);
  });

  it('resolves an indexed path against its unindexed element definition', () => {
    // Location.identifier is Identifier[]. `identifier.0.value` pins element 0 and is a real
    // binding; the table holds only the unindexed `Location.identifier.value`.
    expect(codes(lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'identifier.0.value' })])))).toEqual([]);
  });

  it('stays silent for a path with no array segment', () => {
    expect(codes(lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'address.district' })])))).toEqual([]);
  });
});

describe('fhir-path-type-mismatch', () => {
  it('fires at warning severity for a text field on a Reference leaf', () => {
    const issues = lintFhirPaths(form('ServiceRequest', [field({ id: 'a', fhirPath: 'subject', fieldType: 'text' })]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'fhir-path-type-mismatch', severity: 'warning', fieldId: 'a' });
  });

  it('does NOT fire for a reference field on any leaf type', () => {
    // All three pairings below are shipped and correct in the Facility form. A rule that
    // constrained `reference` by leaf type would fire on working code.
    const issues = lintFhirPaths(form('Location', [
      field({ id: 'a', fhirPath: 'address.country', fieldType: 'reference' }),  // string leaf
      field({ id: 'b', fhirPath: 'status', fieldType: 'reference' }),           // code leaf
      field({ id: 'c', fhirPath: 'physicalType', fieldType: 'reference' }),     // CodeableConcept leaf
    ]));
    expect(codes(issues)).toEqual([]);
  });

  it('does not fire for a scalar field on a primitive leaf', () => {
    const issues = lintFhirPaths(form('Patient', [
      field({ id: 'a', fhirPath: 'birthDate', fieldType: 'date' }),     // string leaf
      field({ id: 'b', fhirPath: 'gender', fieldType: 'select' }),      // code leaf, select is not scalar-only
      field({ id: 'c', fhirPath: 'active', fieldType: 'boolean' }),     // boolean leaf
    ]));
    expect(codes(issues)).toEqual([]);
  });

  it('reports both codes when a field trips cardinality and type mismatch together', () => {
    // ServiceRequest.identifier is Identifier[] on a text field. Both rules apply.
    const issues = lintFhirPaths(form('ServiceRequest', [field({ id: 'a', fhirPath: 'identifier', fieldType: 'text' })]));
    expect(codes(issues).sort()).toEqual(['fhir-path-cardinality', 'fhir-path-type-mismatch']);
  });
});
