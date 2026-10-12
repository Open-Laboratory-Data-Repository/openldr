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

describe('projectObservation status and missing-value reason', () => {
  const rejected = (extra: Record<string, unknown> = {}) => ({
    resourceType: 'Observation', id: 'o2', status: 'cancelled',
    code: { coding: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'CHEM-GLU' }] },
    ...extra,
  });

  it('carries a final result with no reason', () => {
    expect(projectObservation(obs({ value: 540 }), {})).toMatchObject({ status: 'final', data_absent_code: null, data_absent_reason: null });
  });

  it('carries a rejected test as cancelled, with its reason and no value', () => {
    const row = projectObservation(rejected({
      dataAbsentReason: { coding: [{ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }] },
    }), {});
    expect(row).toMatchObject({ status: 'cancelled', data_absent_code: 'HAEM', data_absent_reason: 'Haemolysed', result_type: null, numeric_value: null });
  });

  // Review focus 4.
  it('leaves both reason columns empty for a cancelled row with no reason', () => {
    expect(projectObservation(rejected(), {})).toMatchObject({ status: 'cancelled', data_absent_code: null, data_absent_reason: null });
  });

  // Review focus 5.
  it('keeps a reason that has only text', () => {
    expect(projectObservation(rejected({ dataAbsentReason: { text: 'Sample lost' } }), {})).toMatchObject({ data_absent_code: null, data_absent_reason: 'Sample lost' });
  });

  it('leaves status null when the Observation has none', () => {
    expect(projectObservation({ resourceType: 'Observation', id: 'o3', code: { coding: [{ code: 'X' }] } }, {}).status).toBeNull();
  });
});
