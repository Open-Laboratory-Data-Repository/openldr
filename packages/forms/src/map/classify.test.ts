import { describe, it, expect } from 'vitest';
import { classify } from './classify';
import { shapeOf } from './shape';
import type { SavedMapping } from './apply';

const forms = [
  { id: 'form-a', fieldIds: ['pat_no', 'given', 'surname'], requiredIds: ['pat_no'] },
  { id: 'form-b', fieldIds: ['code', 'name'], requiredIds: [] },
];

const seen = { lab_no: 'L-1', result: '4,2', tested_on: '01/02/26' };
const saved: SavedMapping = {
  shapeHash: shapeOf(seen).hash,
  fieldNames: Object.keys(seen),
  targetId: 'test-target',
  rows: [],
};

describe('classify', () => {
  it('calls a resource, a bundle and a list of resources fhir', () => {
    expect(classify({ resourceType: 'Patient', id: 'p1' }, forms, [saved])).toEqual({ kind: 'fhir' });
    expect(classify({ resourceType: 'Bundle', type: 'collection', entry: [] }, forms, [saved])).toEqual({ kind: 'fhir' });
    expect(classify([{ resourceType: 'Patient' }, { resourceType: 'Observation' }], forms, [saved])).toEqual({ kind: 'fhir' });
  });

  it('calls an item whose keys sit in one form and cover its required ids a form', () => {
    expect(classify({ pat_no: 'T-1', given: 'Ann' }, forms, [saved])).toEqual({ kind: 'form', formId: 'form-a' });
    expect(classify({ code: 'C-1' }, forms, [saved])).toEqual({ kind: 'form', formId: 'form-b' });
  });

  it('does not call an item with a stray key a form', () => {
    expect(classify({ pat_no: 'T-1', ward: 'W-1' }, forms, []).kind).toBe('unknown');
  });

  it('does not call an item missing a required id a form', () => {
    expect(classify({ given: 'Ann' }, forms, []).kind).toBe('unknown');
  });

  it('never calls an item with no keys a form', () => {
    expect(classify({}, [{ id: 'empty', fieldIds: [], requiredIds: [] }], []).kind).toBe('unknown');
  });

  it('calls a saved shape mapped, whatever the values', () => {
    const res = classify({ tested_on: '09/09/25', result: '1,0', lab_no: 'L-77' }, forms, [saved]);
    expect(res).toEqual({ kind: 'mapped', mapping: saved });
  });

  it('calls the saved shape plus one field a new shape', () => {
    const res = classify({ ...seen, ward: 'W-1' }, forms, [saved]);
    expect(res.kind).toBe('unknown');
    if (res.kind === 'unknown') expect(res.shape).toEqual(shapeOf({ ...seen, ward: 'W-1' }));
  });

  it('calls anything that is not a plain object unknown with no fields, and does not throw', () => {
    const empty = shapeOf({});
    for (const v of ['text', 4, null, [], [{ resourceType: 'Patient' }, 3], [{ a: 1 }]]) {
      expect(classify(v, forms, [saved])).toEqual({ kind: 'unknown', shape: empty });
    }
  });
});
