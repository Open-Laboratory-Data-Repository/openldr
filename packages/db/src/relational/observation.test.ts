import { describe, it, expect } from 'vitest';
import { projectObservation, UNAUTHORISED_RESULT_STATUSES } from './observation';
import { projectResource } from './index';

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

describe('projectResource and unauthorised results', () => {
  const result = (status: string) => ({
    resourceType: 'Observation', id: 'o9', status, code: { coding: [{ code: 'HIVVM' }] }, valueQuantity: { value: 540 },
  });

  it('projects a final result', () => {
    const out = projectResource(result('final'), {});
    expect(out).toMatchObject({ table: 'lab_results', rows: [{ id: 'o9', status: 'final' }] });
  });

  it.each(['preliminary', 'registered'])('deletes a %s result instead of projecting it', (status) => {
    expect(projectResource(result(status), {})).toEqual({ delete: { table: 'lab_results', id: 'o9' } });
  });

  it.each(['cancelled', 'amended', 'corrected'])('still projects a %s result', (status) => {
    expect(projectResource(result(status), {})).toMatchObject({ table: 'lab_results', rows: [{ id: 'o9', status }] });
  });

  it('names the statuses it keeps out', () => {
    expect(UNAUTHORISED_RESULT_STATUSES).toEqual(['preliminary', 'registered']);
  });
});
