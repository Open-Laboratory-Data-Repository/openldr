import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateTableSource } from './generate';
import {
  FHIR_PATH_RESOURCE_TYPES,
  fhirPathsFor,
  isKnownFhirResourceType,
  lookupFhirPath,
} from './index';

describe('lookupFhirPath', () => {
  it('resolves an administrative address element with its official label', () => {
    expect(lookupFhirPath('Location.address.district')).toEqual({
      path: 'Location.address.district',
      resourceType: 'Location',
      leafType: 'string',
      isArray: false,
      label: 'District name (aka county)',
    });
  });

  it('reports a path reached through an array as isArray, even when the leaf is a scalar', () => {
    // Location.identifier is Identifier[]. This is the signal the cardinality rule fires on.
    expect(lookupFhirPath('Location.identifier.value')).toMatchObject({ leafType: 'string', isArray: true });
  });

  it('carries the leaf datatype for coded elements', () => {
    expect(lookupFhirPath('Location.physicalType')).toMatchObject({ leafType: 'CodeableConcept' });
    expect(lookupFhirPath('Location.status')).toMatchObject({ leafType: 'code' });
  });

  it('returns null for a path that does not exist', () => {
    expect(lookupFhirPath('Location.address.zone')).toBeNull();
    expect(lookupFhirPath('Widget.name')).toBeNull();
    expect(lookupFhirPath('')).toBeNull();
  });

  // Every path bound by every shipped sample form. This is the list that proves the table has
  // no false negatives against real data. See packages/forms/src/samples/forms.ts.
  it.each([
    'Location.identifier.value', 'Location.name', 'Location.address.country',
    'Location.address.district', 'Location.address.state', 'Location.address.city',
    'Location.status', 'Location.physicalType',
    'Practitioner.name.given', 'Practitioner.name.family', 'Practitioner.telecom.value',
    'Patient.name.given', 'Patient.name.family', 'Patient.birthDate', 'Patient.gender',
    'Patient.telecom.value',
    'ServiceRequest.subject', 'ServiceRequest.code', 'ServiceRequest.priority',
    'ServiceRequest.locationCode', 'ServiceRequest.requester', 'ServiceRequest.identifier',
    'ServiceRequest.note', 'ServiceRequest.performer',
    'Specimen.type',
  ])('resolves the shipped sample path %s', (path) => {
    expect(lookupFhirPath(path)).not.toBeNull();
  });
});

describe('fhirPathsFor', () => {
  it('returns only that resource type, and a non-trivial number of them', () => {
    const rows = fhirPathsFor('Location');
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.every((r) => r.resourceType === 'Location')).toBe(true);
    expect(rows.map((r) => r.path)).toContain('Location.address.district');
  });

  it('returns an empty array for an unknown resource type', () => {
    expect(fhirPathsFor('Widget')).toEqual([]);
  });
});

describe('isKnownFhirResourceType', () => {
  it('accepts Practitioner, which is a shipped sample target but is absent from registerResource', () => {
    expect(isKnownFhirResourceType('Practitioner')).toBe(true);
  });

  it('rejects infrastructure resources no form binds to', () => {
    expect(isKnownFhirResourceType('Bundle')).toBe(false);
  });

  it('exposes the full list', () => {
    expect(FHIR_PATH_RESOURCE_TYPES).toContain('Location');
    expect([...FHIR_PATH_RESOURCE_TYPES]).toEqual([...FHIR_PATH_RESOURCE_TYPES].sort());
  });
});

describe('the generated table', () => {
  it('is not stale', () => {
    const { source: expected } = generateTableSource();
    // Resolved from this test file, not from cwd. Vitest's cwd is the package directory under
    // `pnpm --filter` but the repo root under `turbo run test`, so a relative path is not stable.
    const generatedFile = fileURLToPath(new URL('./r4-paths.generated.ts', import.meta.url));
    const actual = readFileSync(generatedFile, 'utf8');
    // Normalise line endings: git checks this file out with CRLF on Windows.
    expect(actual.replace(/\r\n/g, '\n')).toBe(expected.replace(/\r\n/g, '\n'));
  });
});
