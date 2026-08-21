import { describe, expect, it } from 'vitest';
import { lintFacilityAdminOrder } from './lint-facility-admin';
import type { FormSchema, FormField } from './schema/form-schema';

function field(id: string, apiProperty: string, fhirPath: string | null): FormField {
  return {
    id, apiProperty, fhirPath, displayLabel: id, description: null, fieldType: 'suggest',
    required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' },
  } as FormField;
}

function form(fields: FormField[]): FormSchema {
  return {
    id: 'f', name: 'Facility', versionLabel: null, fhirVersion: null, fhirResourceType: 'Location',
    fhirProfileUrl: null, facilityId: null, fields, sections: [], targetPages: ['facilities'],
    version: 1, active: true, status: 'draft', createdAt: '', updatedAt: '',
  } as FormSchema;
}

describe('facility-admin-order', () => {
  it('fires when a wider level binds a narrower Address element', () => {
    // The shipped bug: Zone (widest) on address.district, Region (narrower) on address.state.
    const issues = lintFacilityAdminOrder(form([
      field('z', 'zone', 'address.district'),
      field('r', 'region', 'address.state'),
      field('d', 'district', 'address.city'),
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'facility-admin-order', severity: 'error' });
    expect(issues[0]!.message).toContain('zone');
    expect(issues[0]!.message).toContain('region');
  });

  it('accepts the corrected mapping, where two levels carry no path at all', () => {
    const issues = lintFacilityAdminOrder(form([
      field('z', 'zone', null),
      field('r', 'region', 'Location.address.state'),
      field('d', 'district', 'Location.address.district'),
      field('c', 'council', null),
    ]));
    expect(issues).toEqual([]);
  });

  it('accepts a form where an optional level is absent entirely', () => {
    // Region became optional in 085; the Zambia MFL has nothing between Province and District.
    const issues = lintFacilityAdminOrder(form([
      field('z', 'zone', null),
      field('d', 'district', 'Location.address.district'),
    ]));
    expect(issues).toEqual([]);
  });

  it('ignores a level bound to something that is not an Address element', () => {
    const issues = lintFacilityAdminOrder(form([
      field('z', 'zone', 'Location.name'),
      field('r', 'region', 'Location.address.state'),
    ]));
    expect(issues).toEqual([]);
  });

  it('ignores a disabled field', () => {
    const bad = field('z', 'zone', 'address.district');
    const issues = lintFacilityAdminOrder(form([
      { ...bad, enabled: false },
      field('r', 'region', 'address.state'),
    ]));
    expect(issues).toEqual([]);
  });

  it('does nothing for a form that carries no admin levels', () => {
    expect(lintFacilityAdminOrder(form([field('n', 'name', 'Location.name')]))).toEqual([]);
  });

  it('keys on apiProperty, not the display label', () => {
    const relabelled = { ...field('z', 'zone', 'address.district'), displayLabel: 'Provincia' };
    const issues = lintFacilityAdminOrder(form([relabelled, field('r', 'region', 'address.state')]));
    expect(issues).toHaveLength(1);
  });
});
