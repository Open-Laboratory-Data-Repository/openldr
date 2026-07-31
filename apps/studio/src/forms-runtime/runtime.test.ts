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
});
