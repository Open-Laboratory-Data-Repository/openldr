// Test helper: a made-up target and made-up sample rows. Marker values (QZX-...) make a leak of a
// sample value into saved config easy to assert.
import type { MapTarget } from '@openldr/forms/pure';

export const TEST_TARGET: MapTarget = {
  id: 'test-target',
  name: 'Test target',
  records: [
    { type: 'Patient', packId: 'p', repeats: false },
    { type: 'Observation', packId: 'o', repeats: true },
  ],
  links: [],
  defaults: [],
  fields: [
    { path: 'Patient.identifier.value', label: 'Patient ID', required: true, repeats: false, valueSet: null },
    { path: 'Patient.gender', label: 'Sex', required: false, repeats: false, valueSet: null },
    { path: 'Observation.code', label: 'Test', required: true, repeats: true, valueSet: null },
    { path: 'Observation.valueString', label: 'Result (text)', required: false, repeats: true, valueSet: null },
  ],
  identity: [
    { record: 'Patient', parts: [{ field: 'Patient.identifier.value' }] },
    { record: 'Observation', parts: [{ record: 'Patient' }, { field: 'Observation.code' }] },
  ],
};

export const MARKERS = ['QZX-1', 'QZX-2', 'QZX-3', 'QZX-4', 'QZX-5', 'QZX-6'];

/** Two rows of one shape. */
export const ROWS_A = [
  { pat_no: 'QZX-1', sex: 'QZX-2', test_a: 'QZX-3', test_b: 'QZX-4' },
  { pat_no: 'QZX-5', sex: 'QZX-6', test_a: 'QZX-3', test_b: 'QZX-4' },
];

/** One row of another shape. */
export const ROWS_B = [{ ident: 'QZX-1', result: 'QZX-2' }];

/** Rows as the editor holds them, a list of `{ json }`. */
export const asItems = (rows: Record<string, unknown>[]) => rows.map((json) => ({ json }));
