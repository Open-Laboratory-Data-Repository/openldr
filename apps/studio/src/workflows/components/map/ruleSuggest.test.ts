import { describe, it, expect } from 'vitest';
import { dateFormatOf, isDateKey, suggestRuleFor, codeListUrlOf } from './ruleSuggest';
import type { RowDraft } from './rows';

const draft = (targetPath: string, field = 'c', extra: Partial<RowDraft> = {}): RowDraft => ({
  targetPath, label: 'L', required: false, repeats: false, valueSet: null, added: false,
  source: { kind: 'field', fields: [field] }, rule: { kind: 'none' }, ...extra,
});
const rows = (...vals: unknown[]) => vals.map((c) => ({ c }));

describe('dateFormatOf', () => {
  it('finds day first when a first part is over 12', () => {
    expect(dateFormatOf(['23/04/2025', '01/12/2024'])).toEqual({ format: 'dd/MM/yyyy', dayFirstGuess: false });
  });
  it('finds month first when a second part is over 12', () => {
    expect(dateFormatOf(['4-23-25', '12-1-24'])).toEqual({ format: 'M-d-yy', dayFirstGuess: false });
  });
  it('guesses day first when day and month cannot be told apart', () => {
    expect(dateFormatOf(['03.04.2025'])).toEqual({ format: 'dd.MM.yyyy', dayFirstGuess: true });
  });
  it('says nothing for ISO dates, mixed marks or other text', () => {
    expect(dateFormatOf(['2025-04-23'])).toBeNull();
    expect(dateFormatOf(['23/04/2025', '23-04-2025'])).toBeNull();
    expect(dateFormatOf(['23/04/2025 10:00'])).toBeNull();
    expect(dateFormatOf(['QZX-1'])).toBeNull();
  });
  it('reads year first with another mark', () => {
    expect(dateFormatOf(['2025/04/23'])).toEqual({ format: 'yyyy/MM/dd', dayFirstGuess: false });
  });
});

describe('isDateKey', () => {
  it('takes string leaves ending in Date, DateTime, date or Time', () => {
    expect(isDateKey('Patient.birthDate')).toBe(true);
    expect(isDateKey('Specimen.collection.collectedDateTime')).toBe(true);
    expect(isDateKey('Specimen.receivedTime')).toBe(true);
    expect(isDateKey('Patient.gender')).toBe(false);
  });
});

describe('suggestRuleFor', () => {
  it('suggests a decimal comma for a number field', () => {
    expect(suggestRuleFor(draft('Observation.valueQuantity.value'), rows('7,25', '3'), null)).toMatchObject({ kind: 'numberComma', rule: { kind: 'number', decimal: ',' } });
  });
  it('suggests nothing for numbers with a point, or already numbers', () => {
    expect(suggestRuleFor(draft('Observation.valueQuantity.value'), rows('7.25'), null)).toBeNull();
    expect(suggestRuleFor(draft('Observation.valueQuantity.value'), rows(7.25), null)).toBeNull();
  });
  it('suggests a date format for a date field', () => {
    expect(suggestRuleFor(draft('Patient.birthDate'), rows('23/04/2025'), null)).toMatchObject({ kind: 'date', format: 'dd/MM/yyyy', rule: { kind: 'date', format: 'dd/MM/yyyy' } });
  });
  it('suggests a values rule with no lines when a value is not one of the codes', () => {
    const s = suggestRuleFor(draft('Patient.gender'), rows('QZX-1'), new Set(['male', 'female']));
    expect(s).toEqual({ kind: 'values', rule: { kind: 'values', pairs: [] } });
    expect(JSON.stringify(s)).not.toContain('QZX');
    expect(suggestRuleFor(draft('Patient.gender'), rows('male'), new Set(['male', 'female']))).toBeNull();
    expect(suggestRuleFor(draft('Patient.gender'), rows('QZX-1'), null)).toBeNull();
  });
  it('suggests nothing for a row with a rule or no source', () => {
    expect(suggestRuleFor(draft('Patient.birthDate', 'c', { rule: { kind: 'trim' } }), rows('23/04/2025'), null)).toBeNull();
    expect(suggestRuleFor(draft('Patient.birthDate', 'c', { source: { kind: 'none' } }), rows('23/04/2025'), null)).toBeNull();
  });
  it('takes the code list from the field, else a required binding', () => {
    expect(codeListUrlOf(draft('Observation.valueString', 'c', { valueSet: 'urn:test:vs' }))).toBe('urn:test:vs');
    expect(codeListUrlOf(draft('Patient.gender'))).toBe('http://hl7.org/fhir/ValueSet/administrative-gender');
    expect(codeListUrlOf(draft('Specimen.type'))).toBeNull();
  });
});
