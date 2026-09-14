import { describe, expect, it } from 'vitest';
import type { FormField } from './schema/form-schema';
import { groupRepeats } from './group-repeats';
import { makeField } from './__fixtures__/forms';

const group = (overrides: Partial<FormField> = {}): FormField =>
  makeField({ id: 'g', displayLabel: 'G', fieldType: 'group', order: 0, ...overrides });

describe('groupRepeats', () => {
  it('is false for a field that is not a group', () => {
    expect(groupRepeats(makeField({ id: 'x', displayLabel: 'X', fieldType: 'text', order: 0 }), 'Location')).toBe(false);
  });

  it('repeats when unbound and uncapped, which every existing group is', () => {
    expect(groupRepeats(group(), null)).toBe(true);
  });

  it('ignores the default cardinality, which picking "group" never changes', () => {
    expect(groupRepeats(group({ cardinality: { min: 0, max: '1' } }), 'Location')).toBe(true);
  });

  it('holds one when the author capped it at one instance', () => {
    expect(groupRepeats(group({ maxItems: 1 }), null)).toBe(false);
  });

  it('holds one when bound to an element that holds one', () => {
    expect(groupRepeats(group({ fhirPath: 'Location.address' }), 'Location')).toBe(false);
  });

  it('resolves a bare path against the form resource type', () => {
    expect(groupRepeats(group({ fhirPath: 'address' }), 'Location')).toBe(false);
  });

  it('repeats when bound to an element that repeats', () => {
    expect(groupRepeats(group({ fhirPath: 'Location.telecom' }), 'Location')).toBe(true);
  });

  it('reads the element own maximum, not whether a parent repeats', () => {
    expect(groupRepeats(group({ fhirPath: 'Patient.contact.address' }), 'Patient')).toBe(false);
  });

  it('repeats when the path is not in the table, as an unbound group does', () => {
    expect(groupRepeats(group({ fhirPath: 'Questionnaire.item' }), 'Questionnaire')).toBe(true);
  });
});
