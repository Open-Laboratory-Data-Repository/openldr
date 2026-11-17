import { describe, it, expect } from 'vitest';
import { readAge, ageExtension, AGE_EXTENSION_URL } from './age';

const UCUM = 'http://unitsofmeasure.org';

describe('readAge', () => {
  const cases: [string, ReturnType<typeof readAge>][] = [
    ['3 days', { days: 3, source: { value: 3, unit: 'days', system: UCUM, code: 'd' }, text: '3 days' }],
    ['6 wk', { days: 42, source: { value: 6, unit: 'wk', system: UCUM, code: 'wk' }, text: '6 wk' }],
    ['1 month', { days: 30, daysEstimated: true, source: { value: 1, unit: 'month', system: UCUM, code: 'mo' }, text: '1 month' }],
    ['2 years', { years: 2, days: 730, daysEstimated: true, source: { value: 2, unit: 'years', system: UCUM, code: 'a' }, text: '2 years' }],
    ['23 hours', { days: 0, source: { value: 23, unit: 'hours', system: UCUM, code: 'h' }, text: '23 hours' }],
    ['2y 3m', { years: 2, days: 821, daysEstimated: true, text: '2y 3m' }],
    ['18 mois', { years: 1, days: 547, daysEstimated: true, source: { value: 18, unit: 'mois', system: UCUM, code: 'mo' }, text: '18 mois' }],
    ['4 dias', { days: 4, source: { value: 4, unit: 'dias', system: UCUM, code: 'd' }, text: '4 dias' }],
    ['10 ans', { years: 10, days: 3652, daysEstimated: true, source: { value: 10, unit: 'ans', system: UCUM, code: 'a' }, text: '10 ans' }],
  ];
  for (const [sent, want] of cases) {
    it(`reads "${sent}"`, () => expect(readAge(sent)).toEqual(want));
  }

  it('reads a number with a unit from another field, and keeps no text', () => {
    expect(readAge(3, 'semanas')).toEqual({ days: 21, source: { value: 3, unit: 'semanas', system: UCUM, code: 'wk' } });
  });

  it('reads a bare number as years, and never gives a baby 0 years', () => {
    expect(readAge('45')).toEqual({ years: 45, days: 16436, daysEstimated: true, source: { value: 45, unit: 'a', system: UCUM, code: 'a' } });
    expect(readAge(0.5)).toEqual({ days: 182, daysEstimated: true, source: { value: 0.5, unit: 'a', system: UCUM, code: 'a' } });
  });

  it('keeps an age it cannot read as text only', () => {
    expect(readAge('unknown')).toEqual({ text: 'unknown', unread: true });
    expect(readAge(5, 'fortnights')).toEqual({ text: '5 fortnights', unread: true });
  });
});

describe('ageExtension', () => {
  it('writes the read age as the age-at-request extension, with no birth date', () => {
    expect(ageExtension(readAge('2 years'))).toEqual({
      url: AGE_EXTENSION_URL,
      extension: [
        { url: 'years', valueInteger: 2 },
        { url: 'days', valueInteger: 730 },
        { url: 'daysEstimated', valueBoolean: true },
        { url: 'source', valueAge: { value: 2, unit: 'years', system: UCUM, code: 'a' } },
        { url: 'text', valueString: '2 years' },
      ],
    });
    expect(ageExtension(readAge('unknown'))).toEqual({ url: AGE_EXTENSION_URL, extension: [{ url: 'text', valueString: 'unknown' }] });
  });
});
