import { describe, it, expect } from 'vitest';
import { suggest } from './suggest';
import type { MapTarget } from './target';
import { labResultTarget } from './targets';
import { mapSynonyms } from './synonyms';
import { seededStarterPacks } from '../samples/starter-packs';

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
    // Different scores: two columns at the same best score would be a tie, which gives nothing.
    const res = suggest(target, ['pat_no', 'pat_number'], synonyms);
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

describe('suggest: nested names, ties and full names', () => {
  const people: MapTarget = {
    ...target,
    fields: [
      ...target.fields,
      { path: 'Patient.name.given', label: 'First name', required: false, repeats: false, valueSet: null },
      { path: 'Patient.name.family', label: 'Last name', required: false, repeats: false, valueSet: null },
    ],
  };
  const syn = {
    ...synonyms,
    [ID]: ['pat no', 'patient id', 'mrn'],
    'Patient.name.given': ['first_name', 'given_name'],
    'Patient.name.family': ['last_name', 'surname'],
    '!Patient.name.given': ['name', 'full_name', 'fullname'],
    '!Patient.name.family': ['name', 'full_name', 'fullname'],
  };
  const pairs = (names: string[]) => suggest(people, names, syn).map((s) => `${s.field}>${s.targetPath}`).sort();

  it('reads a nested name by its last part too, whatever the order of the columns', () => {
    const want = [`patient.dob>Patient.birthDate`, `patient.mrn>${ID}`].sort();
    expect(pairs(['patient.dob', 'patient.mrn'])).toEqual(want);
    expect(pairs(['patient.mrn', 'patient.dob'])).toEqual(want);
  });

  it('gives a field nothing when two columns share its best score', () => {
    expect(suggest(people, ['pat no', 'patient id'], syn).filter((s) => s.targetPath === ID)).toEqual([]);
  });

  it('never offers a full-name column as First name or Last name, and still offers first_name', () => {
    for (const n of ['name', 'full_name', 'fullname', 'patient.name']) {
      expect(suggest(people, [n], syn).filter((s) => s.targetPath.startsWith('Patient.name')), n).toEqual([]);
    }
    expect(pairs(['first_name'])).toEqual(['first_name>Patient.name.given']);
  });
});

describe('suggest on the Lab result target, with the shipped synonyms', () => {
  const real = labResultTarget(seededStarterPacks(), 'en');
  const of = (names: string[]) => Object.fromEntries(suggest(real, names, mapSynonyms('en')).map((x) => [x.field, x.targetPath]));

  it('offers Test for a nested analyte, and no name part for a full name', () => {
    const got = of(['accession', 'patient_id', 'name', 'sex', 'results.analyte', 'results.value']);
    expect(got['results.analyte']).toBe('Observation.code');
    expect(got.name).toBeUndefined();
  });

  it('gives Patient ID the identifier and Date of birth the birth date for nested patient columns', () => {
    const got = of(['patient.dob', 'patient.mrn', 'patient.surname', 'patient.given']);
    expect(got).toMatchObject({
      'patient.dob': 'Patient.birthDate',
      'patient.mrn': 'Patient.identifier.value',
      'patient.surname': 'Patient.name.family?use=official',
      'patient.given': 'Patient.name.given?use=official',
    });
  });
});

describe('suggest: parent context and column order (C5-1, C5-2)', () => {
  const real = labResultTarget(seededStarterPacks(), 'en');
  const of = (names: string[]) => Object.fromEntries(suggest(real, names, mapSynonyms('en')).map((x) => [x.field, x.targetPath]));

  it('lets the patient parent win a tie over another parent, and never offers the loser elsewhere', () => {
    for (const names of [['patient.dob', 'mother.dob'], ['mother.dob', 'patient.dob']]) {
      expect(of(names), names.join()).toEqual({ 'patient.dob': 'Patient.birthDate' });
    }
  });

  it('prefers a flat column to one under another parent', () => {
    expect(of(['mother.dob', 'dob'])).toEqual({ dob: 'Patient.birthDate' });
  });

  it('gives the same suggestions whatever the order of the columns, when ties overlap', () => {
    const t: MapTarget = {
      ...target,
      fields: [
        { path: 'Patient.identifier.value', label: 'Alpha', required: false, repeats: false, valueSet: null },
        { path: 'Patient.birthDate', label: 'Beta', required: false, repeats: false, valueSet: null },
      ],
    };
    const syn = { 'Patient.identifier.value': ['x', 'y'], 'Patient.birthDate': ['x'] };
    expect(suggest(t, ['x', 'y'], syn)).toEqual(suggest(t, ['y', 'x'], syn));
    expect(suggest(t, ['x', 'y'], syn)).toEqual([]);
  });
});
