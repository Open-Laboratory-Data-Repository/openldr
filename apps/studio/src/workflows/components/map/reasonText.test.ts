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
});
