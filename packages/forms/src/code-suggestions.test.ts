import { describe, expect, it } from 'vitest';
import type { FormField } from './schema/form-schema';
import { codingKey, offerSuggestions, rankCodeSuggestions, tallyFormCodes, type CodeSuggestion } from './code-suggestions';

const field = (id: string, fhirPath: string | null, code?: FormField['code']): FormField => ({
  id, fhirPath, displayLabel: id, description: null, fieldType: 'text', required: false, enabled: true,
  order: 0, cardinality: { min: 0, max: '1' }, ...(code ? { code } : {}),
});
const form = (id: string, fhirResourceType: string | null, fields: FormField[]) => ({ id, fhirResourceType, schema: { fields } });

const HB = { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' };
const WBC = { system: 'http://loinc.org', code: '6690-2', display: 'WBC' };

describe('tallyFormCodes', () => {
  it('counts each code once per form, on the same path only', () => {
    const rows = tallyFormCodes([
      form('a', 'Observation', [field('x', 'Observation.code', [HB]), field('y', 'Observation.code', [HB, WBC])]),
      form('b', 'Observation', [field('x', 'Observation.code', [HB])]),
      form('c', 'Observation', [field('x', 'Observation.category', [WBC])]),
    ], 'Observation.code');
    expect(rows).toEqual([{ ...HB, count: 2 }, { ...WBC, count: 1 }]);
  });

  it('matches a bare path through the form resource type', () => {
    expect(tallyFormCodes([form('a', 'Observation', [field('x', 'code', [HB])])], 'Observation.code'))
      .toEqual([{ ...HB, count: 1 }]);
  });

  it('leaves out the form being edited', () => {
    expect(tallyFormCodes([form('a', 'Observation', [field('x', 'Observation.code', [HB])])], 'Observation.code', 'a'))
      .toEqual([]);
  });

  it('keeps the first display it finds, and skips a coding with no code', () => {
    const rows = tallyFormCodes([
      form('a', 'Observation', [field('x', 'Observation.code', [{ system: HB.system, code: HB.code }, { system: HB.system, code: '' }])]),
      form('b', 'Observation', [field('x', 'Observation.code', [HB])]),
    ], 'Observation.code');
    expect(rows).toEqual([{ ...HB, count: 2 }]);
  });

  it('reads a form with no field list as empty', () => {
    expect(tallyFormCodes([{ id: 'a', fhirResourceType: 'Observation', schema: {} }], 'Observation.code')).toEqual([]);
  });
});

describe('rankCodeSuggestions', () => {
  it('puts the codes your forms use first, by count, then binding codes no form uses, and marks the codes CE holds', () => {
    const ranked = rankCodeSuggestions({
      binding: [{ system: 's', code: 'b2', display: 'B2' }, { system: 's', code: 'b1', display: null }],
      yourForms: [
        { system: 's', code: 'f1', display: 'F1', count: 1 },
        { system: 's', code: 'f2', display: 'F2', count: 3 },
        { system: 's', code: 'b2', display: 'from a form', count: 2 },
      ],
      known: new Set([codingKey('s', 'f2')]),
    });
    // A code in both sources keeps its Binding label and ranks by its count.
    expect(ranked.map((r) => r.code)).toEqual(['f2', 'b2', 'f1', 'b1']);
    expect(ranked[0]).toEqual({ system: 's', code: 'f2', display: 'F2', source: 'your-forms', count: 3, inTerminology: true });
    expect(ranked[1]).toEqual({ system: 's', code: 'b2', display: 'B2', source: 'binding', count: 2, inTerminology: false });
    expect(ranked[3]).toEqual({ system: 's', code: 'b1', display: null, source: 'binding', inTerminology: false });
  });

  it('breaks a tie on code by system, whatever the input order', () => {
    const ranked = rankCodeSuggestions({
      binding: [],
      yourForms: [{ system: 'z', code: 'c', display: null, count: 1 }, { system: 'a', code: 'c', display: null, count: 1 }],
      known: new Set(),
    });
    expect(ranked.map((r) => r.system)).toEqual(['a', 'z']);
  });

  it('lists a code the binding repeats only once', () => {
    const b = { system: 's', code: 'x', display: 'X' };
    expect(rankCodeSuggestions({ binding: [b, b], yourForms: [], known: new Set() })).toHaveLength(1);
  });
});

describe('offerSuggestions', () => {
  const row = (code: string, source: CodeSuggestion['source'], count?: number): CodeSuggestion => ({
    system: 's', code, display: null, source, ...(count !== undefined ? { count } : {}), inTerminology: true,
  });

  it('leaves out codes already on the field', () => {
    expect(offerSuggestions([row('a', 'binding'), row('b', 'your-forms', 1)], [{ system: 's', code: 'a' }], 50))
      .toEqual({ shown: [row('b', 'your-forms', 1)], hidden: 0 });
  });

  it('caps binding codes no form uses, and never hides a counted code', () => {
    const rows = [row('a', 'binding', 2), row('b', 'binding'), row('c', 'binding'), row('d', 'your-forms', 1)];
    expect(offerSuggestions(rows, [], 1)).toEqual({
      shown: [row('a', 'binding', 2), row('b', 'binding'), row('d', 'your-forms', 1)],
      hidden: 1,
    });
  });
});
