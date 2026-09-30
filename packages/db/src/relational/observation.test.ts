import { describe, it, expect } from 'vitest';
import { projectObservation } from './observation';

const obs = (valueQuantity: Record<string, unknown>) => ({
  resourceType: 'Observation', id: 'o1', status: 'final', code: { coding: [{ code: 'HIVVM' }] }, valueQuantity,
});

describe('projectObservation comparator', () => {
  it.each(['<', '<=', '>=', '>'])('keeps %s', (c) => {
    expect(projectObservation(obs({ value: 20, comparator: c }), {})).toMatchObject({ numeric_value: 20, numeric_comparator: c, result_type: 'NM' });
  });
  it('is null without a comparator', () => {
    expect(projectObservation(obs({ value: 540 }), {}).numeric_comparator).toBeNull();
  });
  it('drops an unknown comparator', () => {
    expect(projectObservation(obs({ value: 20, comparator: 'ad' }), {}).numeric_comparator).toBeNull();
  });
});
