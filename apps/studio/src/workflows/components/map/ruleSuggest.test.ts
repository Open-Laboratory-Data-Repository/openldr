import { describe, it, expect } from 'vitest';
import { codeNamedBy, dateFormatOf, decimalMarkOf, isDateKey, looksLikeExcelDates, suggestRuleFor, codeListUrlOf } from './ruleSuggest';
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

describe('looksLikeExcelDates', () => {
  // 18264 is 1950-01-01 and 73051 is 2100-01-01 in Excel's 1900 system.
  it('takes day numbers between 1950 and 2100, as numbers or plain-number texts', () => {
    expect(looksLikeExcelDates(['18264', '45000.75', '73051'])).toBe(true);
  });
  it('refuses a day number outside that range, a written date, and no examples', () => {
    expect(looksLikeExcelDates(['18263'])).toBe(false);
    expect(looksLikeExcelDates(['73052'])).toBe(false);
    expect(looksLikeExcelDates(['45000', '12/03/2023'])).toBe(false);
    expect(looksLikeExcelDates([])).toBe(false);
  });
});

describe('codeNamedBy', () => {
  const codes = [
    { system: 'urn:test:s', code: 'bld', display: 'Blood' },
    { system: 'urn:test:s', code: 'ser', display: 'Blood serum' },
  ];
  it('matches a code or a display, ignoring case and the spaces around it', () => {
    expect(codeNamedBy(' blood ', codes)?.code).toBe('bld');
    expect(codeNamedBy('SER', codes)?.code).toBe('ser');
  });
  it('never matches part of a display', () => {
    expect(codeNamedBy('Blo', codes)).toBeNull();
    expect(codeNamedBy('serum', codes)).toBeNull();
  });
});

describe('decimalMarkOf', () => {
  it('gives a comma when only comma decimals appear, past a leading comparator', () => {
    expect(decimalMarkOf(['7,25', '3', '≤0,5', '>= 1,5'])).toBe(',');
  });
  it('gives a point when only point decimals appear', () => {
    expect(decimalMarkOf(['7.25', '3', '<0.5'])).toBe('.');
  });
  it('gives null with no decimals, with both marks, or with text', () => {
    expect(decimalMarkOf(['3', '12'])).toBeNull();
    expect(decimalMarkOf(['7,25', '7.25'])).toBeNull();
    expect(decimalMarkOf(['1:320', 'positive'])).toBeNull();
    expect(decimalMarkOf([])).toBeNull();
  });
});

describe('suggestRuleFor with a comparator', () => {
  it('suggests a decimal comma when the values start with ≤ or >', () => {
    expect(suggestRuleFor(draft('Observation.valueQuantity.value'), rows('≤0,5', '>12,5'), null)).toMatchObject({ kind: 'numberComma' });
  });
});
