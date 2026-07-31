import { describe, expect, it } from 'vitest';
import { cleanAnswers, validate } from './runtime';

describe('reference validation', () => {
  const schema = (over: Record<string, unknown> = {}) => ({
    id: 's', name: 'S', sections: [], fields: [{
      id: 'patient', fhirPath: null, displayLabel: 'Patient', description: null,
      fieldType: 'reference', required: true, enabled: true, order: 0,
      cardinality: { min: 0, max: '1' }, referenceTarget: 'Patient', ...over,
    }],
  }) as never;

  it('rejects a bare string', () => {
    expect(validate(schema(), { patient: 'asdf' }))
      .toEqual({ patient: 'select a value from the list' });
  });

  it('accepts a resolved entity answer', () => {
    expect(validate(schema(), { patient: { reference: 'Patient/p1', display: 'Doe Jane' } })).toEqual({});
  });

  it('still reports a missing required reference', () => {
    expect(validate(schema(), {})).toEqual({ patient: 'field patient is required' });
  });

  // FormRuntime renders a TEXT INPUT for a reference-family field with no source, so the
  // "select a value from the list" error pointed at a list that does not exist — which is
  // exactly what the seeded Lab order's sourceless `facility` field produced.
  it('accepts a bare string in a sourceless facility field', () => {
    const sourceless = schema({ id: 'facility', fieldType: 'facility', referenceTarget: undefined, required: false });
    expect(validate(sourceless, { facility: 'Kanyama Clinic' })).toEqual({});
  });
});

describe('cleanAnswers', () => {
  // The Lab order `tests` field is multi-valued ONLY via `referenceMultiple: true` — it sets
  // neither `repeatable` nor `fieldType: 'multiselect'`. That is exactly the combination the old
  // `field.repeatable || field.fieldType === 'multiselect'` predicate missed: it collapsed the
  // array to values[0] before the payload ever left the browser, silently dropping every test
  // after the first. A multiselect-based test would pass under BOTH the old and new predicate,
  // so it can't catch this — this test isolates the referenceMultiple-only case.
  it('preserves an array of resolved reference answers on a field that is multi-valued only via referenceMultiple', () => {
    const schema = {
      id: 's', name: 'S', sections: [], fields: [{
        id: 'tests', fhirPath: null, displayLabel: 'Tests', description: null,
        fieldType: 'reference', required: false, enabled: true, order: 0,
        cardinality: { min: 0, max: '*' }, referenceTarget: 'Observation',
        referenceMultiple: true,
      }],
    } as never;

    const codingA = { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' };
    const codingB = { system: 'http://loinc.org', code: '789-8', display: 'Erythrocytes' };

    const out = cleanAnswers(schema, { tests: [codingA, codingB] });

    expect(Array.isArray(out.tests)).toBe(true);
    expect(out.tests).toEqual([codingA, codingB]);
  });
});
