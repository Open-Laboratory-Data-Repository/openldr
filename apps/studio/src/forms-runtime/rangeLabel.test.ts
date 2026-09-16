import { describe, expect, it } from 'vitest';
import { criteriaLabel, rangeLabel, RANGE_EN, sexLabel } from './rangeLabel';

const sexes = [{ code: 'female', labels: { en: 'Female', fr: 'Femme', pt: 'Feminino' } }];
const band = (b: object) => ({ name: null, low: 12, high: 16, unit: null, sex: null, ageLow: null, ageHigh: null, ...b });

describe('range labels', () => {
  it('uses the name when the range has one', () => {
    expect(rangeLabel(band({ name: 'Highland women', sex: 'female' }), sexes, RANGE_EN)).toBe('Highland women');
  });

  it('labels an unnamed range from its sex and age', () => {
    expect(rangeLabel(band({ sex: 'female', ageLow: 15 }), sexes, RANGE_EN)).toBe('Female 15+');
    expect(rangeLabel(band({ ageHigh: 5 }), sexes, RANGE_EN)).toBe('up to 5');
    expect(rangeLabel(band({ ageLow: 2, ageHigh: 17 }), sexes, RANGE_EN)).toBe('2 to 17');
    expect(rangeLabel(band({}), sexes, RANGE_EN)).toBe('Anyone');
  });

  it('describes who a range is for without its name, for the warning', () => {
    expect(criteriaLabel(band({ name: 'Highland women', sex: 'female', ageLow: 15 }), sexes, RANGE_EN)).toBe('Female 15+');
  });

  it('takes the sex label in the page language, then English, then the code', () => {
    expect(sexLabel(sexes[0], 'fr')).toBe('Femme');
    expect(sexLabel(sexes[0], 'pt-BR')).toBe('Feminino');
    expect(sexLabel({ code: 'other', labels: { en: 'Other' } }, 'fr')).toBe('Other');
    expect(sexLabel({ code: 'other', labels: {} }, 'fr')).toBe('other');
    expect(rangeLabel(band({ sex: 'female' }), sexes, { ...RANGE_EN, language: 'fr' })).toBe('Femme');
  });
});
