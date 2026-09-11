import { describe, expect, it } from 'vitest';
import { canSubmitForm } from './routing';
import { makeField, makeSchema } from './__fixtures__/forms';

const field = makeField({ id: 'result', displayLabel: 'Result', fieldType: 'number', order: 0,
  observationExtract: true, code: [{ system: 'urn:test:measurements', code: 'test-result' }] });
const schema = (fields = [field], fhirResourceType: string | null = null) =>
  makeSchema({ id: 'form', name: 'Form', fields, fhirResourceType });

describe('capture eligibility', () => {
  it.each([null, 'Observation', 'Patient', 'Location'])('rejects %s without extractable fields', (type) => {
    expect(canSubmitForm(schema([], type))).toBe(false);
  });
  it('accepts coded observations even on custom forms', () => {
    expect(canSubmitForm(schema())).toBe(true);
  });
  it('requires both the extraction flag and a code', () => {
    expect(canSubmitForm(schema([{ ...field, observationExtract: false }]))).toBe(false);
    expect(canSubmitForm(schema([{ ...field, code: [] }]))).toBe(false);
  });
  it('excludes disabled fields and group containers', () => {
    expect(canSubmitForm(schema([{ ...field, enabled: false }]))).toBe(false);
    expect(canSubmitForm(schema([{ ...field, fieldType: 'group' }]))).toBe(false);
  });
  it('supports the existing requisition extractor', () => {
    expect(canSubmitForm(schema([], 'ServiceRequest'))).toBe(true);
  });
});

it('rejects extraction fields inside a disabled group', () => {
  const group = makeField({ id: 'group', displayLabel: 'Group', fieldType: 'group', order: 0, enabled: false });
  expect(canSubmitForm(schema([group, { ...field, groupId: 'group' }]))).toBe(false);
});
