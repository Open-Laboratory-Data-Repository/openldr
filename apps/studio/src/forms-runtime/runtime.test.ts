import { describe, expect, it } from 'vitest';
import { validate } from './runtime';

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
