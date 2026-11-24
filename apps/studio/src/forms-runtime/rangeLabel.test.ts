import { describe, expect, it } from 'vitest';
import { criteriaLabel, rangeLabel, RANGE_EN, sexLabel } from './rangeLabel';

const sexes = [{ code: 'female', labels: { en: 'Female', fr: 'Femme', pt: 'Feminino' } }];
const band = (b: object) => ({ name: null, low: 12, high: 16, unit: null, sex: null, ageLow: null, ageHigh: null, ...b });

describe('range labels', () => {
  it('uses the name when the range has one', () => {
    expect(rangeLabel(band({ name: 'Highland women', sex: 'female' }), sexes, RANGE_EN)).toBe('Highland women');
  });

  it('labels an unnamed range from its sex and age', () => {
    expect(rangeLabel(band({ sex: 'female', ageLow: 15 }), sexes, RANGE_EN)).toBe('Female 15+ years');
    expect(rangeLabel(band({ ageHigh: 5 }), sexes, RANGE_EN)).toBe('up to 5 years');
    expect(rangeLabel(band({ ageLow: 2, ageHigh: 17 }), sexes, RANGE_EN)).toBe('2 to 17 years');
    expect(rangeLabel(band({}), sexes, RANGE_EN)).toBe('Default');
  });

  it('labels an unnamed range in its own age unit, and a range with no unit in years', () => {
    expect(rangeLabel(band({ ageHigh: 28, ageUnit: 'd' }), sexes, RANGE_EN)).toBe('up to 28 days');
    expect(rangeLabel(band({ ageLow: 0, ageHigh: 28, ageUnit: 'd' }), sexes, RANGE_EN)).toBe('0 to 28 days');
    expect(rangeLabel(band({ ageLow: 1, ageHigh: 12, ageUnit: 'mo' }), sexes, RANGE_EN)).toBe('1 to 12 months');
    expect(rangeLabel(band({ sex: 'female', ageLow: 6, ageUnit: 'mo' }), sexes, RANGE_EN)).toBe('Female 6+ months');
    expect(rangeLabel(band({ ageLow: 1, ageHigh: 5, ageUnit: 'y' }), sexes, RANGE_EN)).toBe('1 to 5 years');
    expect(rangeLabel(band({ ageLow: 1, ageHigh: 5 }), sexes, RANGE_EN)).toBe('1 to 5 years');
  });

  it('describes who a range is for without its name, for the warning', () => {
    expect(criteriaLabel(band({ name: 'Highland women', sex: 'female', ageLow: 15 }), sexes, RANGE_EN)).toBe('Female 15+ years');
  });

  it('takes the sex label in the page language, then English, then the code', () => {
    expect(sexLabel(sexes[0], 'fr')).toBe('Femme');
    expect(sexLabel(sexes[0], 'pt-BR')).toBe('Feminino');
    expect(sexLabel({ code: 'other', labels: { en: 'Other' } }, 'fr')).toBe('Other');
    expect(sexLabel({ code: 'other', labels: {} }, 'fr')).toBe('other');
    expect(rangeLabel(band({ sex: 'female' }), sexes, { ...RANGE_EN, language: 'fr' })).toBe('Femme');
  });

  // Plan B, Task 3: pregnancy, country and valid dates say who and when a range is for.
  it('names pregnancy, country and valid dates after sex and age', () => {
    expect(criteriaLabel(band({ sex: 'female', ageLow: 15, pregnancy: 'pregnant' }), sexes, RANGE_EN)).toBe('Female 15+ years, pregnant');
    expect(criteriaLabel(band({ pregnancy: 'not-pregnant' }), sexes, RANGE_EN)).toBe('not pregnant');
    expect(criteriaLabel(band({ country: 'TZA' }), sexes, RANGE_EN)).toBe('TZA');
    expect(criteriaLabel(band({ validFrom: '2026-01-01', validTo: '2026-12-31' }), sexes, RANGE_EN)).toBe('valid 2026-01-01 to 2026-12-31');
    expect(criteriaLabel(band({ validFrom: '2026-01-01' }), sexes, RANGE_EN)).toBe('valid from 2026-01-01');
    expect(criteriaLabel(band({ validTo: '2026-12-31' }), sexes, RANGE_EN)).toBe('valid until 2026-12-31');
    expect(criteriaLabel(band({ sex: 'female', pregnancy: 'pregnant', country: 'TZA', validFrom: '2026-01-01' }), sexes, RANGE_EN))
      .toBe('Female, pregnant, TZA, valid from 2026-01-01');
  });

  it('takes the pregnancy and validity words from the caller', () => {
    expect(criteriaLabel(band({ pregnancy: 'pregnant', validTo: '2026-12-31' }), sexes, { pregnant: 'enceinte', validTo: "valable jusqu'au {to}" }))
      .toBe("enceinte, valable jusqu'au 2026-12-31");
  });

  it('reads a range with no pregnancy, country or dates as before', () => {
    expect(criteriaLabel(band({ sex: 'female', ageLow: 15 }), sexes, RANGE_EN)).toBe('Female 15+ years');
    expect(criteriaLabel(band({}), sexes, RANGE_EN)).toBe('Default');
  });
});

