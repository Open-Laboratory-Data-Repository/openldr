import { describe, expect, it } from 'vitest';
import { resolveFhirPath } from './fhir-path';

describe('resolveFhirPath', () => {
  it('prefixes a bare path with the form resource type', () => {
    expect(resolveFhirPath('address.district', 'Location')).toBe('Location.address.district');
    expect(resolveFhirPath('name', 'Location')).toBe('Location.name');
  });

  it('leaves an already prefixed path untouched', () => {
    expect(resolveFhirPath('ServiceRequest.code', 'ServiceRequest')).toBe('ServiceRequest.code');
  });

  it('leaves a path prefixed with a DIFFERENT resource type untouched', () => {
    // The shipped Requisition form declares fhirResourceType ServiceRequest and binds
    // Specimen.type. Multi-resource extraction is exactly why the prefix exists.
    expect(resolveFhirPath('Specimen.type', 'ServiceRequest')).toBe('Specimen.type');
  });

  it('returns null for an empty or missing path', () => {
    expect(resolveFhirPath(null, 'Location')).toBeNull();
    expect(resolveFhirPath(undefined, 'Location')).toBeNull();
    expect(resolveFhirPath('', 'Location')).toBeNull();
  });

  it('returns null for a bare path when the form declares no resource type', () => {
    expect(resolveFhirPath('address.district', null)).toBeNull();
    expect(resolveFhirPath('address.district', '')).toBeNull();
  });

  it('returns null for a bare path when the resource type is not covered by the table', () => {
    // Bundle is a real FHIR resource but not a form binding target, so nothing can be resolved
    // against it. Guessing a prefix here would manufacture a path the table cannot check.
    expect(resolveFhirPath('entry.resource', 'Bundle')).toBeNull();
  });

  it('does not mistake a single-segment path for a resource prefix', () => {
    expect(resolveFhirPath('status', 'Location')).toBe('Location.status');
  });
});
