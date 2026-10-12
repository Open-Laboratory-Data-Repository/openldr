import { describe, it, expect } from 'vitest';
import { projectPatient, projectPatientIdentifiers, patientMatchKey } from './patient';

describe('projectPatient active/replaced_by_id', () => {
  it('defaults active to true and replaced_by_id to null for a plain patient', () => {
    const out = projectPatient({ resourceType: 'Patient', id: 'p1', name: [{ family: 'X' }] }, {});
    expect(out.active).toBe(true);
    expect(out.replaced_by_id).toBeNull();
  });
  it('reads active:false and extracts the replaced-by link target', () => {
    const out = projectPatient(
      { resourceType: 'Patient', id: 'p-dup', active: false, link: [{ type: 'replaced-by', other: { reference: 'Patient/p-surv' } }] },
      {},
    );
    expect(out.active).toBe(false);
    expect(out.replaced_by_id).toBe('p-surv');
  });
});

describe('projectPatientIdentifiers', () => {
  const patient = (identifier: unknown[]) => ({ resourceType: 'Patient', id: 'p1', identifier });

  it('writes one row per identifier with its system, type and use', () => {
    const rows = projectPatientIdentifiers(patient([
      { system: 'urn:zm:mpi', value: 'MPI-1', use: 'official', type: { coding: [{ code: 'MR' }], text: 'MPI number' } },
      { system: 'urn:zm:nrc', value: '123456/10/1', type: { coding: [{ code: 'NI', display: 'National id' }] } },
    ]), { sourceSystem: 'hims' });
    expect(rows.map((r) => [r.patient_id, r.system, r.value, r.type_code, r.type_text, r.use, r.source_system])).toEqual([
      ['p1', 'urn:zm:mpi', 'MPI-1', 'MR', 'MPI number', 'official', 'hims'],
      ['p1', 'urn:zm:nrc', '123456/10/1', 'NI', 'National id', null, 'hims'],
    ]);
  });

  it('keeps an identifier with no system and skips one with no value', () => {
    const rows = projectPatientIdentifiers(patient([{ value: 'F-77' }, { system: 'urn:x' }, { system: 'urn:y', value: '' }]), {});
    expect(rows.map((r) => [r.system, r.value])).toEqual([[null, 'F-77']]);
  });

  it('collapses a repeated system and value to one row', () => {
    const rows = projectPatientIdentifiers(patient([{ system: 'urn:zm:mpi', value: 'A' }, { system: 'urn:zm:mpi', value: 'A' }]), {});
    expect(rows).toHaveLength(1);
  });

  it('returns no rows for a patient without identifiers', () => {
    expect(projectPatientIdentifiers({ resourceType: 'Patient', id: 'p1' }, {})).toEqual([]);
  });
});

describe('patientMatchKey', () => {
  it('lowercases, strips accents and collapses spaces', () => {
    expect(patientMatchKey('  Mwanza ', 'Émile  Jean', '1990-01-05')).toBe('mwanza|emile jean|1990-01-05');
    expect(patientMatchKey('MWANZA', 'emile jean', '1990-01-05')).toBe(patientMatchKey('mwanza', 'Émile Jean', '1990-01-05'));
  });

  it('is null when any part is missing or blank', () => {
    expect(patientMatchKey(null, 'A', '1990')).toBeNull();
    expect(patientMatchKey('B', '  ', '1990')).toBeNull();
    expect(patientMatchKey('B', 'A', null)).toBeNull();
  });

  it('keeps a partial date as given', () => {
    expect(patientMatchKey('B', 'A', '1990')).toBe('b|a|1990');
  });

  it('hashes a key too long for a key-sized column', () => {
    const key = patientMatchKey('x'.repeat(300), 'A', '1990') as string;
    expect(key.length).toBeLessThanOrEqual(200);
    expect(key).toMatch(/^mk-/);
    expect(patientMatchKey('x'.repeat(300), 'A', '1990')).toBe(key);
  });
});

describe('projectPatient match_key', () => {
  it('stores the key from the first name entry and birth date', () => {
    const out = projectPatient({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Banda', given: ['Ruth'] }], birthDate: '1985-02-03' }, {});
    expect(out.match_key).toBe('banda|ruth|1985-02-03');
  });

  it('stores null without a birth date', () => {
    expect(projectPatient({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Banda', given: ['Ruth'] }] }, {}).match_key).toBeNull();
  });
});
