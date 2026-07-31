import { describe, it, expect } from 'vitest';
import { validateAnswers } from './validate-answers';
import { resolveReferenceSource } from './reference-source';
import { toAnswer } from './answer-value';
import { sampleForms } from './samples/forms';
import type { FormSchema, FormField } from './schema/form-schema';

const field = (over: Partial<FormField>): FormField => ({
  id: 'f', fhirPath: null, displayLabel: 'F', description: null, fieldType: 'text',
  required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, ...over,
}) as FormField;

const model = (fields: FormField[]): FormSchema => ({
  id: 'form-1', name: 'T', versionLabel: null, fhirVersion: null, fhirResourceType: null,
  fhirProfileUrl: null, facilityId: null, fields, sections: [], targetPages: [],
  version: 1, active: true, status: 'published', createdAt: '', updatedAt: '',
}) as FormSchema;

describe('validateAnswers', () => {
  it('flags a missing required field', () => {
    const errs = validateAnswers(model([field({ id: 'name', displayLabel: 'Name', required: true })]), {});
    expect(errs).toEqual([{ fieldId: 'name', label: 'Name', reason: 'required' }]);
  });

  it('passes when a required field is present', () => {
    const errs = validateAnswers(model([field({ id: 'name', required: true })]), { name: 'Ada' });
    expect(errs).toEqual([]);
  });

  it('rejects a select value outside the option set', () => {
    const f = field({ id: 'sex', fieldType: 'select', valueSetOptions: [{ code: 'M', display: 'Male' }, { code: 'F', display: 'Female' }] });
    const errs = validateAnswers(model([f]), { sex: 'X' });
    expect(errs).toHaveLength(1);
    expect(errs[0].fieldId).toBe('sex');
  });

  it('allows a custom select value when allowCustomValue is set', () => {
    const f = field({ id: 'sex', fieldType: 'select', allowCustomValue: true, valueSetOptions: [{ code: 'M', display: 'Male' }] });
    expect(validateAnswers(model([f]), { sex: 'X' })).toEqual([]);
  });

  it('enforces numeric min/max', () => {
    const f = field({ id: 'age', fieldType: 'number', constraints: { min: 0, max: 120 } });
    expect(validateAnswers(model([f]), { age: 200 })).toHaveLength(1);
    expect(validateAnswers(model([f]), { age: 30 })).toEqual([]);
  });

  it('enforces text maxLength', () => {
    const f = field({ id: 'note', fieldType: 'text', constraints: { maxLength: 3 } });
    expect(validateAnswers(model([f]), { note: 'abcd' })).toHaveLength(1);
  });

  it('skips disabled and group fields', () => {
    const disabled = field({ id: 'a', required: true, enabled: false });
    const group = field({ id: 'g', required: true, fieldType: 'group' });
    expect(validateAnswers(model([disabled, group]), {})).toEqual([]);
  });
});

describe('reference shape validation', () => {
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

  it('rejects a bare string in a reference field', () => {
    expect(validateAnswers(model(), { p: 'asdf' })).toEqual([
      { fieldId: 'p', label: 'Patient', reason: 'must be selected from the list' },
    ]);
  });

  it('rejects an object missing both code and reference', () => {
    expect(validateAnswers(model(), { p: { display: 'Doe Jane' } })).toEqual([
      { fieldId: 'p', label: 'Patient', reason: 'must be selected from the list' },
    ]);
  });

  it('accepts a resolved entity answer', () => {
    expect(validateAnswers(model(), { p: { reference: 'Patient/p1', display: 'Doe Jane' } })).toEqual([]);
  });

  it('accepts a resolved coding answer', () => {
    expect(validateAnswers(model(), { p: { system: 'http://loinc.org', code: '718-7', display: 'Hb' } })).toEqual([]);
  });

  it('checks every element of a multi-valued reference field', () => {
    expect(validateAnswers(model({ repeatable: true, cardinality: { min: 0, max: '*' } }), {
      p: [{ reference: 'Patient/p1', display: null }, 'asdf'],
    })).toEqual([
      { fieldId: 'p', label: 'Patient', reason: 'must be selected from the list' },
    ]);
  });

  // A facility/organism/antibiogram field with no source renders a TEXT INPUT (FormRuntime),
  // lint only warns about it, and toAnswer preserves its string. Rejecting a bare string here
  // made the seeded Lab order form unsubmittable and made the ingest Form Validate node drop
  // an external producer's organism names into meta.invalid.
  it('accepts a bare string in a sourceless facility field', () => {
    const sourceless = model({ id: 'fac', displayLabel: 'Facility', fieldType: 'facility', referenceTarget: undefined });
    expect(validateAnswers(sourceless, { fac: 'Kanyama Clinic' })).toEqual([]);
  });

  it('accepts a bare string in a sourceless organism field', () => {
    const sourceless = model({ id: 'org', displayLabel: 'Organism', fieldType: 'organism', referenceTarget: undefined });
    expect(validateAnswers(sourceless, { org: 'E. coli' })).toEqual([]);
  });

  it('still rejects a bare string once the same facility field declares a source', () => {
    const sourced = model({ id: 'fac', displayLabel: 'Facility', fieldType: 'facility', referenceTarget: 'Location' });
    expect(validateAnswers(sourced, { fac: 'Kanyama Clinic' })).toEqual([
      { fieldId: 'fac', label: 'Facility', reason: 'must be selected from the list' },
    ]);
  });

  it('accepts the seeded Lab order sourceless facility field end to end', () => {
    const labOrder = sampleForms.find((f) => f.id === 'sample-order')!;
    const facility = labOrder.fields.find((f) => f.id === 'fld-ord-ref-facility')!;
    expect(resolveReferenceSource(facility).ok).toBe(false);

    // Validates (the form's other required fields are irrelevant here), then serializes to the
    // same valueReference toAnswer already produced for a bare-string facility.
    const errs = validateAnswers(labOrder, { 'fld-ord-ref-facility': 'Kanyama Clinic' });
    expect(errs.filter((e) => e.fieldId === 'fld-ord-ref-facility')).toEqual([]);
    expect(toAnswer(facility, 'Kanyama Clinic')).toEqual({ valueReference: { reference: 'Kanyama Clinic' } });
  });
});
