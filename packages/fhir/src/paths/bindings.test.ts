import { describe, expect, it } from 'vitest';
import { bindingsFromTable, extractBindings, renderBindingsTable } from './bindings';
import { lookupBinding } from './index';
import { R4_BINDINGS } from './r4-bindings.generated';
import { R4_PATHS } from './r4-paths.generated';

const bundle = {
  resourceType: 'Bundle',
  entry: [
    {
      resource: {
        resourceType: 'StructureDefinition', kind: 'resource',
        snapshot: {
          element: [
            { path: 'Patient' },
            { path: 'Patient.gender', binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1' } },
            { path: 'Patient.maritalStatus', binding: { strength: 'extensible', valueSet: 'http://hl7.org/fhir/ValueSet/marital-status' } },
            { path: 'Patient.name' },
            { path: 'Patient.language', binding: { valueSet: 'http://example.org/no-strength' } },
          ],
        },
      },
    },
    {
      resource: {
        resourceType: 'StructureDefinition', kind: 'complex-type',
        snapshot: { element: [{ path: 'Address.use', binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/address-use' } }] },
      },
    },
  ],
};

describe('extractBindings', () => {
  it('reads each resource element binding, drops the version, and skips anything without a strength', () => {
    expect(extractBindings(bundle)).toEqual({
      'Patient.gender': { valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender', strength: 'required' },
      'Patient.maritalStatus': { valueSet: 'http://hl7.org/fhir/ValueSet/marital-status', strength: 'extensible' },
    });
  });

  it('keeps only the paths it is given', () => {
    expect(Object.keys(extractBindings(bundle, new Set(['Patient.gender'])))).toEqual(['Patient.gender']);
  });
});

describe('bindingsFromTable', () => {
  it("reads corlix's committed table shape and skips reference-only rows", () => {
    expect(bindingsFromTable({
      'Patient.gender': { vs: 'http://v|4.0.1', strength: 'required', targets: [] },
      'Patient.link.other': { targets: ['Patient'] },
    })).toEqual({ 'Patient.gender': { valueSet: 'http://v', strength: 'required' } });
  });
});

describe('renderBindingsTable', () => {
  it('writes the paths sorted, so a rerun diffs cleanly', () => {
    const source = renderBindingsTable({
      b: { valueSet: 'v', strength: 'example' },
      a: { valueSet: 'v', strength: 'required' },
    });
    expect(source.indexOf('"a"')).toBeLessThan(source.indexOf('"b"'));
    expect(source).toContain('GENERATED FILE');
  });
});

describe('the committed R4 bindings', () => {
  it('binds Patient.gender to administrative-gender, required', () => {
    expect(lookupBinding('Patient.gender')).toEqual({ valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender', strength: 'required' });
  });

  it('answers null for a path FHIR does not bind, and for no path', () => {
    expect(lookupBinding('Patient.name')).toBeNull();
    expect(lookupBinding(null)).toBeNull();
  });

  it('holds only paths the path table offers', () => {
    const paths = new Set(R4_PATHS.map(([p]) => p));
    expect(Object.keys(R4_BINDINGS).filter((p) => !paths.has(p))).toEqual([]);
    expect(Object.keys(R4_BINDINGS).length).toBeGreaterThan(60);
  });
});
