import { describe, it, expect } from 'vitest';
import { classify } from './classify';
import { shapeOf } from './shape';
import { applyMapping, type ApplyDeps, type SavedMapping } from './apply';
import type { MapTarget } from './target';

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

  it('calls a row with a blank cell left out mapped', () => {
    const { result: _blank, ...row } = seen;
    expect(classify(row, forms, [saved])).toEqual({ kind: 'mapped', mapping: saved });
  });

  it('calls a row mapped when a column is a number in this row and text in the sample', () => {
    expect(classify({ ...seen, result: 4.2, lab_no: 17 }, forms, [saved])).toEqual({ kind: 'mapped', mapping: saved });
  });

  it('never calls a row with no keys mapped', () => {
    const forEmpty: SavedMapping = { shapeHash: shapeOf({}).hash, fieldNames: [], targetId: 'test-target', rows: [] };
    expect(classify({}, forms, [forEmpty, saved]).kind).toBe('unknown');
    expect(classify({ gone: undefined }, forms, [forEmpty, saved]).kind).toBe('unknown');
  });

  it('calls a row mapped when exactly one saved mapping knows its columns', () => {
    const other: SavedMapping = { ...saved, fieldNames: ['ward', 'bed'], targetId: 'other' };
    expect(classify({ lab_no: 'L-2' }, forms, [other, saved])).toEqual({ kind: 'mapped', mapping: saved });
  });

  it('calls a row that two nested mappings fit ambiguous', () => {
    const wide: SavedMapping = { ...saved, fieldNames: [...saved.fieldNames, 'ward'], targetId: 'wide' };
    const row = { lab_no: 'L-2', result: 3 };
    expect(classify(row, forms, [wide, saved])).toEqual({ kind: 'ambiguous', shape: shapeOf(row) });
  });

  it('calls a row that two overlapping mappings fit ambiguous', () => {
    const left: SavedMapping = { ...saved, fieldNames: ['lab_no', 'result', 'ward'], targetId: 'left' };
    const right: SavedMapping = { ...saved, fieldNames: ['lab_no', 'result', 'bed'], targetId: 'right' };
    const row = { lab_no: 'L-2', result: 3 };
    expect(classify(row, forms, [left, right])).toEqual({ kind: 'ambiguous', shape: shapeOf(row) });
    expect(classify({ ...row, ward: 'W-1' }, forms, [left, right])).toEqual({ kind: 'mapped', mapping: left });
  });

  it('calls two copies of one mapping ambiguous, and counts a repeated name once', () => {
    expect(classify({ lab_no: 'L-2' }, forms, [saved, { ...saved }]).kind).toBe('ambiguous');
    const repeated: SavedMapping = { ...saved, fieldNames: ['lab_no', 'lab_no', 'result'] };
    expect(classify({ lab_no: 'L-2' }, forms, [repeated])).toEqual({ kind: 'mapped', mapping: repeated });
  });

  it('does not guess between file A with a ward and file B without one', () => {
    const fileA: SavedMapping = { shapeHash: 'a', fieldNames: ['id', 'date', 'result', 'ward'], targetId: 'test-target', rows: [] };
    const fileB: SavedMapping = { shapeHash: 'b', fieldNames: ['id', 'date', 'result'], targetId: 'test-target', rows: [] };
    const trimmedA = { id: 'A-1', date: '01/02/26', result: 4 }; // a row of A whose blank ward was dropped
    const fullB = { id: 'B-1', date: '03/04/90', result: '5' };
    const fullA = { ...trimmedA, ward: 'W-1' };
    expect(classify(trimmedA, forms, [fileA, fileB])).toEqual({ kind: 'ambiguous', shape: shapeOf(trimmedA) });
    expect(classify(fullB, forms, [fileA, fileB])).toEqual({ kind: 'ambiguous', shape: shapeOf(fullB) });
    expect(classify(fullA, forms, [fileA, fileB])).toEqual({ kind: 'mapped', mapping: fileA });
  });

  it('calls a row that fits a form a form, even when a mapping also knows its columns', () => {
    const overForm: SavedMapping = { ...saved, fieldNames: ['pat_no', 'given', 'surname', 'ward'] };
    expect(classify({ pat_no: 'T-1', given: 'Ann' }, forms, [overForm])).toEqual({ kind: 'form', formId: 'form-a' });
    expect(classify({ given: 'Ann' }, forms, [overForm])).toEqual({ kind: 'mapped', mapping: overForm });
  });
});

describe('classify then applyMapping on a row with a blank cell', () => {
  const ID = 'Patient.identifier.value?system=urn:test:patient';
  const target: MapTarget = {
    id: 'test-target',
    name: 'Test patient',
    records: [{ type: 'Patient', packId: 'pack-p', repeats: false }],
    links: [],
    defaults: [],
    fields: [
      { path: ID, label: 'Patient number', required: true, repeats: false, valueSet: null },
      { path: 'Patient.name.family?use=official', label: 'Last name', required: false, repeats: false, valueSet: null },
    ],
    identity: [{ record: 'Patient', parts: [{ field: ID }] }],
  };
  const sample = { pat_no: 'T-1', surname: 'TESTER' };
  const mapping: SavedMapping = {
    shapeHash: shapeOf(sample).hash,
    fieldNames: Object.keys(sample),
    targetId: target.id,
    rows: [
      { targetPath: ID, from: { field: 'pat_no' } },
      { targetPath: 'Patient.name.family?use=official', from: { field: 'surname' } },
    ],
  };
  const deps: ApplyDeps = { hashId: (parts) => `id-${parts.length}`, translateCode: async () => null };

  it('maps a row missing an optional column', async () => {
    const row = { pat_no: 'T-2' };
    const c = classify(row, [], [mapping]);
    expect(c).toEqual({ kind: 'mapped', mapping });
    const res = await applyMapping(mapping, target, row, deps);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.resources[0]).toMatchObject({ resourceType: 'Patient', identifier: [{ system: 'urn:test:patient', value: 'T-2' }] });
  });

  it('classifies a row missing the column behind a required field as mapped, then apply fails naming the field', async () => {
    const row = { surname: 'QZX-NAME' };
    expect(classify(row, [], [mapping])).toEqual({ kind: 'mapped', mapping });
    const res = await applyMapping(mapping, target, row, deps);
    expect(res).toMatchObject({ ok: false, field: ID });
    if (!res.ok) {
      expect(res.reason).toContain('Patient number');
      expect(res.reason).not.toContain('QZX');
    }
  });
});
