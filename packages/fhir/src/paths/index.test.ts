import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateTableSource } from './generate';
import {
  FHIR_PATH_RESOURCE_TYPES,
  fhirPathOptionsFor,
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

describe('fhirPathOptionsFor', () => {
  it('drops structural noise that nobody binds a form field to', () => {
    const paths = fhirPathOptionsFor('Location').map((r) => r.path);
    expect(paths).not.toContain('Location.identifier.id');
    expect(paths).not.toContain('Location.extension');
    expect(paths).not.toContain('Location.address.extension');
  });

  it('keeps every real element, including the ones this whole workstream is about', () => {
    const paths = fhirPathOptionsFor('Location').map((r) => r.path);
    expect(paths).toContain('Location.address.district');
    expect(paths).toContain('Location.address.state');
    expect(paths).toContain('Location.address.city');
    expect(paths).toContain('Location.physicalType');
    expect(paths).toContain('Location.identifier.value');
  });

  it('keeps a leading segment that happens to share a noise name', () => {
    // `Patient.identifier` is a real element. Only NON-LEADING id/extension segments are noise.
    expect(fhirPathOptionsFor('Patient').map((r) => r.path)).toContain('Patient.identifier');
  });

  it('trims about a third of the table, and leaves a list a person can browse', () => {
    // Measured 2026-08-24: 1596 rows total, 1099 after trimming, Location 77.
    expect(fhirPathOptionsFor('Location')).toHaveLength(77);
    expect(fhirPathOptionsFor('Observation').length).toBeGreaterThan(200);
  });

  it('carries the definition, which is the point of the picker', () => {
    const district = fhirPathOptionsFor('Location').find((r) => r.path === 'Location.address.district');
    expect(district?.label).toBe('District name (aka county)');
  });

  it('returns an empty array for a resource type the table does not cover', () => {
    // The builder offers 145 resource types; the table covers 9. The picker must degrade.
    expect(fhirPathOptionsFor('Condition')).toEqual([]);
  });

  it('never returns more than fhirPathsFor, which stays untrimmed for the lint rules', () => {
    expect(fhirPathOptionsFor('Location').length).toBeLessThan(fhirPathsFor('Location').length);
    expect(fhirPathsFor('Location').map((r) => r.path)).toContain('Location.identifier.id');
  });
});
