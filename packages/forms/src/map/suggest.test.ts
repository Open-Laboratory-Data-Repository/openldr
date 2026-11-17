import { describe, it, expect } from 'vitest';
import { suggest } from './suggest';
import type { MapTarget } from './target';

const ID = 'Patient.identifier.value?system=urn:test:patient';

const target: MapTarget = {
  id: 't',
  name: 'T',
  records: [{ type: 'Patient', packId: 'p', repeats: false }],
  links: [],
  defaults: [],
  fields: [
    { path: ID, label: 'Patient number', required: true, repeats: false, valueSet: null },
    { path: 'Patient.birthDate', label: 'Date of birth', required: false, repeats: false, valueSet: null },
    { path: 'Patient.gender', label: 'Sex', required: false, repeats: false, valueSet: null },
  ],
  identity: [{ record: 'Patient', parts: [{ field: ID }] }],
};

const synonyms = { [ID]: ['pat no', 'patient id'], 'Patient.birthDate': ['dob'] };

describe('suggest', () => {
  it('ranks pat_no for the patient identifier through the synonym list', () => {
    expect(suggest(target, ['pat_no'], synonyms)).toEqual([{ targetPath: ID, field: 'pat_no', score: 1 }]);
  });

  it('ranks patient_id for the patient identifier through the synonym list', () => {
    expect(suggest(target, ['patient_id'], synonyms)).toEqual([{ targetPath: ID, field: 'patient_id', score: 1 }]);
  });

  it('suggests at most one field per target field', () => {
    const res = suggest(target, ['pat_no', 'patient_id'], synonyms);
    expect(res.filter((s) => s.targetPath === ID)).toHaveLength(1);
  });

  it('suggests a source field for at most one target field, the higher score winning', () => {
    const res = suggest(target, ['patient number'], { ...synonyms, 'Patient.gender': ['patient numbe'] });
    expect(res).toEqual([{ targetPath: ID, field: 'patient number', score: 1 }]);
  });

  it('matches on the label too', () => {
    expect(suggest(target, ['date_of_birth'], {})).toEqual([{ targetPath: 'Patient.birthDate', field: 'date_of_birth', score: 1 }]);
  });

  it('gives no suggestion for an unrelated name', () => {
    expect(suggest(target, ['freezer_temp'], synonyms)).toEqual([]);
  });

  it('sorts by score, highest first', () => {
    const res = suggest(target, ['DOB', 'pat_number', 'sex'], synonyms);
    expect(res.length).toBeGreaterThan(1);
    const scores = res.map((s) => s.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(res.find((s) => s.field === 'pat_number')?.targetPath).toBe(ID);
    expect(res.find((s) => s.field === 'pat_number')!.score).toBeLessThan(1);
  });
});
