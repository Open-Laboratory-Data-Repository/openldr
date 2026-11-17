import { describe, it, expect } from 'vitest';
import { reasonText } from './reasonText';
import type { RowDraft } from './rows';

const d = (targetPath: string, label: string, fields: string[]): RowDraft => ({
  targetPath, label, required: false, repeats: true, valueSet: null, added: false,
  source: { kind: 'field', fields }, rule: { kind: 'none' },
});
const drafts = [d('Observation.valueQuantity.value', 'Result (number)', ['res']), d('Observation.code', 'Test', ['t1'])];

describe('reasonText', () => {
  it('leads with the label when the field is a target key', () => {
    expect(reasonText('Observation.valueQuantity.value needs a number', 'Observation.valueQuantity.value', drafts)).toBe('Result (number): needs a number');
  });
  it('leads with the label when the field is a source column', () => {
    expect(reasonText('res: expected a number with a comma as the decimal mark', 'res', drafts)).toBe('Result (number): expected a number with a comma as the decimal mark');
  });
  it('swaps target keys for labels and keeps paths with no row', () => {
    expect(reasonText('Observation.code: missing; Patient.birthDate: bad', undefined, drafts)).toBe('Test: missing; Patient.birthDate: bad');
  });
  it('does not swap a key inside a longer path', () => {
    expect(reasonText('Observation.code.text is long', undefined, drafts)).toBe('Observation.code.text is long');
  });

  describe('a reason that names a record and a path', () => {
    const coded = [
      d('Patient.gender', 'Sex', ['sx']),
      d('Patient.identifier.value?system=urn:test:pid', 'Patient ID', ['pid']),
      { ...d('Specimen.type', 'Specimen type', ['st']), rule: { kind: 'values', pairs: [] } } as RowDraft,
    ];
    const ADD = 'Add a Values rule.';
    it('leads with the row label, and says to add a Values rule when the row has none', () => {
      expect(reasonText('record 1 (Patient) gender: this value is not one the field accepts', undefined, coded, ADD)).toBe(
        'Sex: this value is not one the field accepts. Add a Values rule.',
      );
    });
    it('matches a key with pins and a path with an index', () => {
      expect(reasonText('record 1 (Patient) identifier.0.value: failed the invalid check', undefined, coded, ADD)).toBe('Patient ID: failed the invalid check');
    });
    it('does not ask for a Values rule the row already has, and keeps a path with no row', () => {
      expect(reasonText('record 2 (Specimen) type: this value is not one the field accepts; record 3 (Observation) status: Required', undefined, coded, ADD)).toBe(
        'Specimen type: this value is not one the field accepts; record 3 (Observation) status: Required',
      );
    });
  });
});
