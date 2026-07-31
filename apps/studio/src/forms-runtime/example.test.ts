import { describe, expect, it } from 'vitest';
import { makeExampleAnswers } from './example';
import type { FormSchema } from './types';

const schema: FormSchema = {
  id: 'ex1',
  name: 'Example form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'name',
      fhirPath: null,
      displayLabel: 'Name',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 1,
      cardinality: { min: 0, max: '1' },
    },
    {
      id: 'age',
      fhirPath: null,
      displayLabel: 'Age',
      description: null,
      fieldType: 'number',
      required: false,
      enabled: true,
      order: 2,
      cardinality: { min: 0, max: '1' },
    },
    {
      id: 'ok',
      fhirPath: null,
      displayLabel: 'OK?',
      description: null,
      fieldType: 'boolean',
      required: false,
      enabled: true,
      order: 3,
      cardinality: { min: 0, max: '1' },
    },
    {
      id: 'sex',
      fhirPath: null,
      displayLabel: 'Sex',
      description: null,
      fieldType: 'select',
      required: false,
      enabled: true,
      order: 4,
      cardinality: { min: 0, max: '1' },
      valueSetOptions: [{ code: 'f', display: 'F' }],
    },
    {
      id: 'disabled_field',
      fhirPath: null,
      displayLabel: 'Hidden',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: false,
      order: 5,
      cardinality: { min: 0, max: '1' },
    },
  ],
  sections: [],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('makeExampleAnswers', () => {
  it('returns example values for each enabled field type', () => {
    const result = makeExampleAnswers(schema);
    expect(typeof result['name']).toBe('string');
    expect(typeof result['age']).toBe('number');
    expect(result['ok']).toBe(true);
    expect(result['sex']).toBe('f');
  });

  it('omits disabled fields', () => {
    const result = makeExampleAnswers(schema);
    expect('disabled_field' in result).toBe(false);
  });

  // "Fill example" used to hand the literal string 'example' to reference-family fields. Once
  // those fields render the picker, a bare string makes `'reference' in v` throw during render.
  describe('reference-family fields', () => {
    const withField = (extra: Partial<FormSchema['fields'][number]>): FormSchema => ({
      ...schema,
      fields: [{
        id: 'ref', fhirPath: null, displayLabel: 'Ref', description: null,
        fieldType: 'reference', required: false, enabled: true, order: 1,
        cardinality: { min: 0, max: '1' }, ...extra,
      } as FormSchema['fields'][number]],
    });

    it('shapes an entity-bound field as an entity answer', () => {
      expect(makeExampleAnswers(withField({ referenceTarget: 'Patient' }))['ref'])
        .toEqual({ reference: 'Patient/example', display: 'Example' });
    });

    it('shapes a coding-bound field as a coding answer', () => {
      expect(makeExampleAnswers(withField({ referenceTarget: 'http://loinc.org' }))['ref'])
        .toEqual({ system: 'http://loinc.org', code: 'example', display: 'Example' });
    });

    it('wraps a multi-valued reference field in an array', () => {
      const answers = makeExampleAnswers(withField({
        referenceTarget: 'http://loinc.org', referenceMultiple: true, cardinality: { min: 0, max: '*' },
      }));
      expect(answers['ref']).toEqual([{ system: 'http://loinc.org', code: 'example', display: 'Example' }]);
    });

    it('keeps a bare string for a sourceless facility, which renders a text input', () => {
      expect(makeExampleAnswers(withField({ fieldType: 'facility' }))['ref']).toBe('Example');
    });

    it('emits nothing for a sourceless reference field, which has no usable control', () => {
      expect('ref' in makeExampleAnswers(withField({}))).toBe(false);
    });
  });
});
