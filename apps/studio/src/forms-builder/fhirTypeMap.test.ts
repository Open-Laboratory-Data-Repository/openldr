import { describe, expect, it } from 'vitest';
import { codeOptionsFromLabel, elementDisplayName, fieldTypeForLeaf } from './fhirTypeMap';

describe('fieldTypeForLeaf', () => {
  it('maps the primitives and common datatypes, as corlix does', () => {
    expect(fieldTypeForLeaf('string', 'Location')).toBe('text');
    expect(fieldTypeForLeaf('number', 'Location')).toBe('number');
    expect(fieldTypeForLeaf('boolean', 'Location')).toBe('boolean');
    expect(fieldTypeForLeaf('code', 'Location')).toBe('select');
    expect(fieldTypeForLeaf('CodeableConcept', 'Location')).toBe('select');
    expect(fieldTypeForLeaf('Reference', 'Location')).toBe('reference');
    expect(fieldTypeForLeaf('Identifier', 'Location')).toBe('identifier');
    expect(fieldTypeForLeaf('Address', 'Location')).toBe('address');
    expect(fieldTypeForLeaf('ContactPoint', 'Location')).toBe('phone');
    expect(fieldTypeForLeaf('Attachment', 'Location')).toBe('attachment');
  });

  it('makes a group of a BackboneElement, named after its resource', () => {
    expect(fieldTypeForLeaf('LocationHoursOfOperation', 'Location')).toBe('group');
    expect(fieldTypeForLeaf('PatientContact', 'Patient')).toBe('group');
  });

  it('falls back to text for a datatype it does not map', () => {
    expect(fieldTypeForLeaf('HumanName', 'Patient')).toBe('text');
    expect(fieldTypeForLeaf('Period', 'Location')).toBe('text');
  });
});

describe('elementDisplayName', () => {
  it('names an element from its last path segment, camelCase split', () => {
    expect(elementDisplayName('Location.hoursOfOperation')).toBe('Hours of operation');
    expect(elementDisplayName('Location.address.city')).toBe('City');
  });
});

describe('codeOptionsFromLabel', () => {
  it('reads a coded element label as its options', () => {
    expect(codeOptionsFromLabel('active | suspended | inactive')).toEqual([
      { code: 'active', display: 'active' },
      { code: 'suspended', display: 'suspended' },
      { code: 'inactive', display: 'inactive' },
    ]);
  });

  it('is null for an ordinary label', () => {
    expect(codeOptionsFromLabel('Physical location')).toBeNull();
  });
});
