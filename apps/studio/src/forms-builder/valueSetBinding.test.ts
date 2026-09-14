import { describe, expect, it } from 'vitest';
import type { FormField } from '@openldr/forms/pure';
import {
  LOCAL_OPTIONS_SYSTEM, autoBindApplies, bindingUpdates, codesToOptions, optionsToValueSetInput, suggestValueSetUrl,
} from './valueSetBinding';

const f = (extra: Partial<FormField> = {}): FormField => ({
  id: 'x', displayLabel: 'x', fieldType: 'text', required: false, enabled: true, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null, ...extra,
});
const REQUIRED = { valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender', strength: 'required' as const };

describe('codesToOptions', () => {
  it('uses the code when a display is missing', () => {
    expect(codesToOptions([
      { system: 's', code: 'a', display: 'A' },
      { system: 's', code: 'b', display: null },
    ])).toEqual([{ code: 'a', display: 'A' }, { code: 'b', display: 'b' }]);
  });
});

describe('bindingUpdates', () => {
  it('sets the URL, the strength and the options, and a required binding forbids custom values', () => {
    expect(bindingUpdates('u', 'required', [{ code: 'a', display: 'A' }])).toEqual({
      valueSetUrl: 'u', bindingStrength: 'required', valueSetOptions: [{ code: 'a', display: 'A' }], allowCustomValue: false,
    });
    expect(bindingUpdates('u', 'extensible', [])).not.toHaveProperty('allowCustomValue');
  });
});

describe('autoBindApplies', () => {
  it('binds a required or extensible element on an unbound field', () => {
    expect(autoBindApplies(f(), REQUIRED)).toBe(true);
    expect(autoBindApplies(f(), { ...REQUIRED, strength: 'extensible' })).toBe(true);
  });

  it('leaves preferred and example bindings to the author', () => {
    expect(autoBindApplies(f(), { ...REQUIRED, strength: 'preferred' })).toBe(false);
    expect(autoBindApplies(f(), { ...REQUIRED, strength: 'example' })).toBe(false);
  });

  it('never touches a bound field, a group, or a field that names a reference source', () => {
    expect(autoBindApplies(f({ valueSetUrl: 'v' }), REQUIRED)).toBe(false);
    expect(autoBindApplies(f({ fieldType: 'group' }), REQUIRED)).toBe(false);
    expect(autoBindApplies(f({ fieldType: 'reference', referenceTarget: 'http://loinc.org' }), REQUIRED)).toBe(false);
    expect(autoBindApplies(f(), null)).toBe(false);
  });
});

describe('saving typed options as a ValueSet', () => {
  it('suggests a local URL from the title', () => {
    expect(suggestValueSetUrl('Ward / Department')).toBe('urn:openldr:valueset:ward-department');
  });

  it('lists the options as local concepts, published by System', () => {
    expect(optionsToValueSetInput({ title: 'Ward', url: 'urn:openldr:valueset:ward', options: [{ code: 'opd', display: 'OPD' }] })).toEqual({
      url: 'urn:openldr:valueset:ward', name: 'ward', title: 'Ward', status: 'active', publisherId: 'pub-system',
      compose: { include: [{ system: LOCAL_OPTIONS_SYSTEM, concept: [{ code: 'opd', display: 'OPD' }] }] },
    });
  });
});
