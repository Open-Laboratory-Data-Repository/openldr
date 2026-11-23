import { describe, expect, it } from 'vitest';
import { ageIn, BIRTHDATE_ESTIMATED_EXTENSION, bandFit, bandInCatalog, findCatalogBand, matchBand, parseResultParams, patientBandKey, SEX_OPTIONS, type ResultBand } from './result-params';

// Ages are taken at one fixed moment. aged(n) is a patient born on 1 January n years before it, so
// whole years come out as n.
const AT = Date.parse('2026-11-23T12:00:00Z');
const aged = (years: number) => ({ birthDate: `${2026 - years}-01-01`, at: AT });

const band = (b: Partial<ResultBand>): ResultBand => ({ name: null, low: null, high: null, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null, ...b });

describe('result parameters: reading what a test stored', () => {
  it('reads a numeric parameter with its bands', () => {
    expect(parseResultParams([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [{ low: 12, high: 15, unit: 'g/dL', sex: 'female' }] },
    ])).toEqual([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null,
        bands: [{ name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: null, ageHigh: null }] },
    ]);
  });

  it('reads the critical limits a band stored, and leaves them out when it stored none', () => {
    const [param] = parseResultParams([
      { system: 'urn:openldr:default_result', code: 'K', resultType: 'numeric', bands: [
        { low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5 },
        { low: 3.5, high: 5.1, criticalHigh: 6.5 },
        { low: 3.5, high: 5.1, criticalLow: '2.5' },
      ] },
    ]);
    expect(param.bands[0]).toMatchObject({ criticalLow: 2.5, criticalHigh: 6.5 });
    expect(param.bands[1].criticalHigh).toBe(6.5);
    expect('criticalLow' in param.bands[1]).toBe(false);
    expect('criticalLow' in param.bands[2]).toBe(false);
  });

  it('reads a coded parameter with the value set its answers come from', () => {
    expect(parseResultParams([{ system: 'urn:openldr:default_result', code: 'MRDT', resultType: 'coded', valueSetUrl: 'urn:openldr:valueset:rdt-result' }]))
      .toEqual([{ system: 'urn:openldr:default_result', code: 'MRDT', resultType: 'coded', valueSetUrl: 'urn:openldr:valueset:rdt-result', bands: [] }]);
  });

  it('drops an entry that names no code, and defaults a missing type to text', () => {
    expect(parseResultParams([{ system: 'urn:openldr:default_result' }, { system: 'urn:openldr:default_result', code: 'NOTE' }]))
      .toEqual([{ system: 'urn:openldr:default_result', code: 'NOTE', resultType: 'text', valueSetUrl: null, bands: [] }]);
  });

  it('reads nothing from a value that is not a list', () => {
    expect(parseResultParams(undefined)).toEqual([]);
    expect(parseResultParams('HGB')).toEqual([]);
  });
});

describe('result parameters: which band applies', () => {
  const bands = [
    band({ low: 13, high: 17, sex: 'male', ageLow: 18 }),
    band({ low: 12, high: 15, sex: 'female', ageLow: 18 }),
    band({ low: 11, high: 14, ageLow: 2, ageHigh: 17 }),
    band({ low: 10, high: 13 }),
  ];

  it('takes the band whose sex and age both match', () => {
    expect(matchBand(bands, { sex: 'female', ...aged(30) })?.high).toBe(15);
    expect(matchBand(bands, { sex: 'male', ...aged(30) })?.high).toBe(17);
  });

  it('takes a band that names an age window but no sex', () => {
    expect(matchBand(bands, { sex: 'male', ...aged(9) })?.high).toBe(14);
  });

  it('falls back to the band that names neither', () => {
    expect(matchBand(bands, { sex: null, birthDate: null, at: AT })?.high).toBe(13);
    expect(matchBand(bands, { sex: 'other', ...aged(1) })?.high).toBe(13);
  });

  it('counts an age exactly on the low edge as inside, and the high edge as inside', () => {
    expect(matchBand(bands, { sex: 'male', ...aged(18) })?.high).toBe(17);
    expect(matchBand(bands, { sex: null, ...aged(17) })?.high).toBe(14);
  });

  it('answers null when nothing matches and there is no catch-all', () => {
    expect(matchBand([band({ low: 1, high: 2, sex: 'male' })], { sex: 'female', ...aged(20) })).toBeNull();
  });
});

describe('result parameters: a range name', () => {
  it('keeps a name, trimmed, and reads a blank one as none', () => {
    const [param] = parseResultParams([{
      system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric',
      bands: [{ name: '  Highland women ', low: 12, high: 16 }, { name: '   ', low: 11, high: 15 }],
    }]);
    expect(param.bands.map((b) => b.name)).toEqual(['Highland women', null]);
  });
});

describe('result parameters: whether a range fits a patient', () => {
  it('answers yes when sex and age both fit, or the range names neither', () => {
    expect(bandFit(band({ sex: 'female', ageLow: 15 }), { sex: 'female', ...aged(30) })).toBe('yes');
    expect(bandFit(band({}), { sex: null, birthDate: null, at: AT })).toBe('yes');
  });

  it('answers no when the sex or the age is outside the range', () => {
    expect(bandFit(band({ sex: 'male' }), { sex: 'female', ...aged(30) })).toBe('no');
    expect(bandFit(band({ ageLow: 15 }), { sex: 'female', ...aged(9) })).toBe('no');
    expect(bandFit(band({ ageHigh: 5 }), { sex: 'female', ...aged(9) })).toBe('no');
  });

  it('answers unknown when the range names a fact the patient record lacks', () => {
    expect(bandFit(band({ sex: 'female' }), { sex: null, ...aged(30) })).toBe('unknown');
    expect(bandFit(band({ ageLow: 15 }), { sex: 'female', birthDate: null, at: AT })).toBe('unknown');
  });

  it('answers no over unknown when one fact is missing and the other is outside', () => {
    expect(bandFit(band({ sex: 'male', ageLow: 15 }), { sex: 'female', birthDate: null, at: AT })).toBe('no');
  });
});

describe('result parameters: the sex choices', () => {
  it('offers the Patient codes, each with a label in en, fr and pt', () => {
    expect(SEX_OPTIONS.map((s) => s.code)).toEqual(['male', 'female', 'other', 'unknown']);
    for (const s of SEX_OPTIONS) expect(Object.keys(s.labels).sort()).toEqual(['en', 'fr', 'pt']);
  });
});

describe('result parameters: a submitted range against the catalog', () => {
  const stored = [band({ name: 'Highland women', low: 12, high: 16, sex: 'female', ageLow: 15 }), band({ low: 11, high: 16 })];

  it('finds a range that matches field for field, name included', () => {
    expect(bandInCatalog({ name: 'Highland women', low: 12, high: 16, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null }, stored)).toBe(true);
  });

  it('reads a missing name as none, so a range sent before names existed still matches', () => {
    expect(bandInCatalog({ low: 11, high: 16, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }, stored)).toBe(true);
  });

  it('refuses a range the catalog does not hold', () => {
    expect(bandInCatalog({ name: 'Highland women', low: 5, high: 30, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null }, stored)).toBe(false);
    expect(bandInCatalog('not a range', stored)).toBe(false);
  });

  it('finds the matched catalog band, not just whether one matched', () => {
    expect(findCatalogBand({ low: 11, high: 16, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }, stored))
      .toEqual(band({ low: 11, high: 16 }));
    expect(findCatalogBand({ low: 5, high: 30, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }, stored)).toBeNull();
  });

  it('treats critical limits as part of the band, and hands back the catalog copy with them', () => {
    const catalog = [band({ low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5 })];
    const sent = { low: 3.5, high: 5.1, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null, criticalLow: 2.5, criticalHigh: 6.5 };
    expect(findCatalogBand(sent, catalog)).toEqual(catalog[0]);
    // Changed limits, or a band sent from before the limits were set, no longer match.
    expect(findCatalogBand({ ...sent, criticalHigh: 7 }, catalog)).toBeNull();
    expect(findCatalogBand({ low: 3.5, high: 5.1, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }, catalog)).toBeNull();
    // A critical limit sent as a string is refused, not coerced to none.
    expect(findCatalogBand({ low: 3.5, high: 5.1, unit: 'g/dL', criticalLow: '2.5' }, [band({ low: 3.5, high: 5.1 })])).toBeNull();
  });

  it('refuses a band whose field has the wrong type rather than coercing it to null', () => {
    const catalog = [band({ low: null, high: 15 })];
    // A number field sent as a string must not be coerced to null and match a catalog null.
    expect(findCatalogBand({ low: '5', high: 15, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }, catalog)).toBeNull();
    // Same for a string field sent as a number.
    const namedCatalog = [band({ name: null, low: 10, high: 15 })];
    expect(findCatalogBand({ name: 123, low: 10, high: 15, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }, namedCatalog)).toBeNull();
  });
});

describe('patientBandKey', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  it('reads the FHIR gender and the birth date, with the moment the age is taken at', () => {
    expect(patientBandKey({ gender: 'female', birthDate: '1990-01-05' }, now)).toEqual({ sex: 'female', birthDate: '1990-01-05', birthDateEstimated: false, at: now, timeZone: null });
  });
  it('answers nulls for a missing patient, birth date or gender', () => {
    expect(patientBandKey(null, now)).toEqual({ sex: null, birthDate: null, birthDateEstimated: false, at: now, timeZone: null });
    expect(patientBandKey({}, now)).toEqual({ sex: null, birthDate: null, birthDateEstimated: false, at: now, timeZone: null });
    expect(patientBandKey({ gender: 'female', birthDate: 'not a date' }, now)).toEqual({ sex: 'female', birthDate: null, birthDateEstimated: false, at: now, timeZone: null });
  });
});

describe('ageIn: a patient age in days, months or years', () => {
  const at = (iso: string) => Date.parse(iso);
  it('counts whole days, born today being 0', () => {
    expect(ageIn('d', '2026-11-23', at('2026-11-23T12:00:00Z'))).toBe(0);
    expect(ageIn('d', '2026-11-23', at('2026-11-24T00:00:00Z'))).toBe(1);
    expect(ageIn('d', '2026-10-26', at('2026-11-23T12:00:00Z'))).toBe(28);
  });
  it('counts whole calendar months, a month completing on the same day of the month', () => {
    expect(ageIn('mo', '2026-01-15', at('2026-02-14T23:00:00Z'))).toBe(0);
    expect(ageIn('mo', '2026-01-15', at('2026-02-15T00:00:00Z'))).toBe(1);
    expect(ageIn('mo', '2024-11-23', at('2026-11-23T12:00:00Z'))).toBe(24);
  });
  it('completes a month at a month end when the birth day is past the end of a shorter month', () => {
    // Born 31 January: one month on 28 February (not a leap year), 29 February in a leap year.
    expect(ageIn('mo', '2026-01-31', at('2026-02-27T12:00:00Z'))).toBe(0);
    expect(ageIn('mo', '2026-01-31', at('2026-02-28T00:00:00Z'))).toBe(1);
    expect(ageIn('mo', '2028-01-31', at('2028-02-28T12:00:00Z'))).toBe(0);
    expect(ageIn('mo', '2028-01-31', at('2028-02-29T00:00:00Z'))).toBe(1);
    // Two months on 31 March, not 28 March: the shorter month does not move later anniversaries.
    expect(ageIn('mo', '2026-01-31', at('2026-03-30T12:00:00Z'))).toBe(1);
    expect(ageIn('mo', '2026-01-31', at('2026-03-31T00:00:00Z'))).toBe(2);
  });
  it('counts whole calendar years, a year completing on the birthday itself', () => {
    expect(ageIn('y', '1990-01-05', at('2026-11-23T12:00:00Z'))).toBe(36);
    expect(ageIn('y', '2025-12-01', at('2026-11-23T12:00:00Z'))).toBe(0);
    // The day before the 18th birthday is 17; the birthday is 18.
    expect(ageIn('y', '2008-11-23', at('2026-11-22T23:59:00Z'))).toBe(17);
    expect(ageIn('y', '2008-11-23', at('2026-11-23T00:00:00Z'))).toBe(18);
    expect(bandFit(band({ ageLow: 18 }), { birthDate: '2008-11-23', at: at('2026-11-22T12:00:00Z') })).toBe('no');
    expect(bandFit(band({ ageLow: 18 }), { birthDate: '2008-11-23', at: at('2026-11-23T12:00:00Z') })).toBe('yes');
    // A first birthday is 1, with no day of delay.
    expect(ageIn('y', '2025-11-23', at('2026-11-23T00:00:00Z'))).toBe(1);
  });
  it('turns a 29 February birth a year older on 28 February in a year with no 29 February', () => {
    expect(ageIn('y', '2024-02-29', at('2025-02-27T12:00:00Z'))).toBe(0);
    expect(ageIn('y', '2024-02-29', at('2025-02-28T00:00:00Z'))).toBe(1);
    expect(ageIn('y', '2024-02-29', at('2028-02-28T12:00:00Z'))).toBe(3);
    expect(ageIn('y', '2024-02-29', at('2028-02-29T00:00:00Z'))).toBe(4);
  });
  it('answers null for a missing or unreadable birth date', () => {
    expect(ageIn('d', '2026-02-30', at('2026-11-23T12:00:00Z'))).toBeNull();
    expect(ageIn('d', null, at('2026-11-23T12:00:00Z'))).toBeNull();
    expect(ageIn('mo', 'not a date', at('2026-11-23T12:00:00Z'))).toBeNull();
  });
});

describe('result parameters: ranges by days, months or years', () => {
  const NOW = Date.parse('2026-11-23T12:00:00Z');
  const newborn = { sex: 'female', birthDate: '2026-11-23', at: NOW };
  const twoYearOld = { sex: 'female', birthDate: '2024-11-23', at: NOW };
  const neonatal = band({ name: null, ageLow: 0, ageHigh: 28, ageUnit: 'd' });
  const infant = band({ ageLow: 1, ageHigh: 12, ageUnit: 'mo' });
  const child = band({ ageLow: 1, ageHigh: 5, ageUnit: 'y' });
  const adult = band({ ageLow: 18 });

  it('fits a newborn to "0 to 28 days" and not to an adult range', () => {
    expect(bandFit(neonatal, newborn)).toBe('yes');
    expect(bandFit(adult, newborn)).toBe('no');
    expect(matchBand([adult, neonatal], newborn)).toBe(neonatal);
  });

  it('fits a 2-year-old to "1 to 5 years" and not to "1 to 12 months"', () => {
    expect(bandFit(child, twoYearOld)).toBe('yes');
    expect(bandFit(infant, twoYearOld)).toBe('no');
    expect(matchBand([infant, child], twoYearOld)).toBe(child);
  });

  it('counts the high edge as inside in its own unit, as the years rule does', () => {
    // Day 28 is inside "0 to 28 days"; day 29 is not.
    expect(bandFit(neonatal, { birthDate: '2026-10-26', at: NOW })).toBe('yes');
    expect(bandFit(neonatal, { birthDate: '2026-10-25', at: NOW })).toBe('no');
    // 12 whole months is inside "1 to 12 months" until the 13th month completes.
    expect(bandFit(infant, { birthDate: '2025-11-23', at: NOW })).toBe('yes');
    expect(bandFit(infant, { birthDate: '2025-10-23', at: NOW })).toBe('no');
    // A baby of 0 whole months is below "1 to 12 months".
    expect(bandFit(infant, { birthDate: '2026-11-01', at: NOW })).toBe('no');
  });

  it('answers unknown for any age window when the birth date is missing', () => {
    for (const b of [neonatal, infant, child, adult]) expect(bandFit(b, { sex: 'female', birthDate: null, at: NOW })).toBe('unknown');
  });

  it('reads a range saved before units, with no ageUnit, exactly as years', () => {
    const [param] = parseResultParams([{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric',
      bands: [{ low: 11, high: 14, ageLow: 2, ageHigh: 17 }] }]);
    expect('ageUnit' in param.bands[0]).toBe(false);
    const asYears = { ...param.bands[0], ageUnit: 'y' as const };
    for (const birthDate of ['2024-11-24', '2024-11-22', '2009-11-23', '2008-11-23', '2008-01-01', '2026-01-01', null]) {
      const who = { birthDate, at: NOW };
      expect(bandFit(param.bands[0], who)).toBe(bandFit(asYears, who));
    }
    expect(bandFit(param.bands[0], { birthDate: '2016-06-01', at: NOW })).toBe('yes');
    expect(bandFit(param.bands[0], { birthDate: '2008-01-01', at: NOW })).toBe('no');
  });
});

describe('result parameters: the age unit is kept wherever a band is copied', () => {
  it('parseResultParams keeps d, mo and y, and drops a unit it does not know', () => {
    const [param] = parseResultParams([{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [
      { low: 1, ageHigh: 28, ageUnit: 'd' }, { low: 1, ageHigh: 12, ageUnit: 'mo' }, { low: 1, ageHigh: 5, ageUnit: 'y' }, { low: 1, ageUnit: 'w' },
    ] }]);
    expect(param.bands.map((b) => b.ageUnit)).toEqual(['d', 'mo', 'y', undefined]);
  });

  it('findCatalogBand tells a days band from a years band, and reads a missing unit as years', () => {
    const days = band({ low: 1, ageHigh: 28, ageUnit: 'd' });
    const years = band({ low: 1, ageHigh: 28 });
    const sent = { name: null, low: 1, high: null, unit: 'g/dL', sex: null, ageLow: null, ageHigh: 28 };
    expect(findCatalogBand({ ...sent, ageUnit: 'd' }, [years, days])).toBe(days);
    expect(findCatalogBand(sent, [days, years])).toBe(years);
    expect(findCatalogBand({ ...sent, ageUnit: 'y' }, [days, years])).toBe(years);
    expect(findCatalogBand(sent, [days])).toBeNull();
    expect(findCatalogBand({ ...sent, ageUnit: 'w' }, [years])).toBeNull();
  });
});

describe('ageIn: today is the lab date, in the lab time zone', () => {
  const NAIROBI = 'Africa/Nairobi'; // UTC+3, no daylight saving
  const BOGOTA = 'America/Bogota'; // UTC-5, no daylight saving
  // 22:30 UTC on the 23rd is 01:30 on the 24th in Nairobi.
  const nairobiEarly = Date.parse('2026-11-23T22:30:00Z');
  // 04:00 UTC on the 24th is 23:00 on the 23rd in Bogota.
  const bogotaLate = Date.parse('2026-11-24T04:00:00Z');
  const neonatal = band({ ageLow: 0, ageHigh: 28, ageUnit: 'd' });

  it('gives 0 days to a baby born on the lab date, at 01:30 in UTC+3', () => {
    expect(ageIn('d', '2026-11-24', nairobiEarly, NAIROBI)).toBe(0);
    expect(bandFit(neonatal, { birthDate: '2026-11-24', at: nairobiEarly, timeZone: NAIROBI })).toBe('yes');
    // In UTC the same moment is still the 23rd, so the baby is not born yet.
    expect(ageIn('d', '2026-11-24', nairobiEarly)).toBe(-1);
  });

  it('gives 0 days to a baby born on the lab date, late in the evening in UTC-5', () => {
    expect(ageIn('d', '2026-11-23', bogotaLate, BOGOTA)).toBe(0);
    expect(ageIn('d', '2026-11-23', bogotaLate)).toBe(1);
    expect(bandFit(band({ ageLow: 1, ageHigh: 7, ageUnit: 'd' }), { birthDate: '2026-11-23', at: bogotaLate, timeZone: BOGOTA })).toBe('no');
  });

  it('completes a month and a year on the lab date', () => {
    expect(ageIn('mo', '2026-10-24', nairobiEarly, NAIROBI)).toBe(1);
    expect(ageIn('mo', '2026-10-24', nairobiEarly)).toBe(0);
    expect(ageIn('mo', '2026-10-23', bogotaLate, BOGOTA)).toBe(1);
    expect(ageIn('mo', '2026-10-24', bogotaLate, BOGOTA)).toBe(0);
    // The fourth birthday is the 24th in Nairobi, still the 23rd in UTC and in Bogota.
    expect(ageIn('y', '2022-11-24', nairobiEarly, NAIROBI)).toBe(4);
    expect(ageIn('y', '2022-11-24', nairobiEarly)).toBe(3);
    expect(ageIn('y', '2022-11-24', bogotaLate, BOGOTA)).toBe(3);
    expect(ageIn('y', '2025-11-24', nairobiEarly, NAIROBI)).toBe(1);
    expect(ageIn('y', '2025-11-24', nairobiEarly)).toBe(0);
  });

  it('moves a birth dateTime with a zone to the lab date first', () => {
    // 23:30 UTC on the 23rd is 02:30 on the 24th in Nairobi.
    const at = Date.parse('2026-11-24T10:00:00Z');
    expect(ageIn('d', '2026-11-23T23:30:00Z', at, NAIROBI)).toBe(0);
    expect(ageIn('d', '2026-11-23T23:30:00Z', at)).toBe(1);
    expect(ageIn('d', '2026-11-24T02:30:00+03:00', at, NAIROBI)).toBe(0);
  });

  it('reads an unset or unreadable zone as UTC', () => {
    expect(ageIn('d', '2026-11-24', nairobiEarly, 'Not/AZone')).toBe(-1);
    expect(ageIn('d', '2026-11-24', nairobiEarly, '  ')).toBe(-1);
  });

  it('keeps the zone in the band key', () => {
    expect(patientBandKey({ gender: 'female', birthDate: '2026-11-24' }, nairobiEarly, NAIROBI))
      .toEqual({ sex: 'female', birthDate: '2026-11-24', birthDateEstimated: false, at: nairobiEarly, timeZone: NAIROBI });
  });
});

describe('result parameters: a birth date estimated from an age', () => {
  const NOW = Date.parse('2026-11-23T12:00:00Z');
  const ESTIMATED = [{ url: BIRTHDATE_ESTIMATED_EXTENSION, valueBoolean: true }];
  // The lab plugin registers a newborn whose age was given as 0 years as born 1 January this year.
  const newborn = patientBandKey({ gender: 'female', birthDate: '2026-01-01', extension: ESTIMATED }, NOW);

  it('reads the mark from the stored Patient, and only when it is true', () => {
    expect(newborn.birthDateEstimated).toBe(true);
    expect(patientBandKey({ birthDate: '2026-01-01', extension: [{ url: BIRTHDATE_ESTIMATED_EXTENSION, valueBoolean: false }] }, NOW).birthDateEstimated).toBe(false);
    expect(patientBandKey({ birthDate: '2026-01-01', extension: [{ url: 'urn:other', valueBoolean: true }] }, NOW).birthDateEstimated).toBe(false);
  });

  it('answers unknown for days and months ranges, and still fits a years range', () => {
    expect(bandFit(band({ ageLow: 0, ageHigh: 28, ageUnit: 'd' }), newborn)).toBe('unknown');
    expect(bandFit(band({ ageLow: 1, ageHigh: 12, ageUnit: 'mo' }), newborn)).toBe('unknown');
    expect(bandFit(band({ ageLow: 0, ageHigh: 1, ageUnit: 'y' }), newborn)).toBe('yes');
    expect(bandFit(band({ ageLow: 0, ageHigh: 1 }), newborn)).toBe('yes');
    expect(bandFit(band({ ageLow: 18 }), newborn)).toBe('no');
    // Without the mark the same date is a 326-day-old baby, who fits "1 to 12 months" for certain.
    const known = patientBandKey({ gender: 'female', birthDate: '2026-01-01' }, NOW);
    expect(bandFit(band({ ageLow: 1, ageHigh: 12, ageUnit: 'mo' }), known)).toBe('yes');
  });

  it('never picks a days or months range for that patient, falling to the years range', () => {
    const days = band({ low: 14, high: 22, ageLow: 0, ageHigh: 28, ageUnit: 'd' });
    const months = band({ low: 10, high: 14, ageLow: 1, ageHigh: 12, ageUnit: 'mo' });
    const years = band({ low: 11, high: 14, ageLow: 0, ageHigh: 1 });
    expect(matchBand([days, months, years], newborn)).toBe(years);
  });

  it('still answers no for a days range whose sex does not match', () => {
    expect(bandFit(band({ sex: 'male', ageLow: 0, ageHigh: 28, ageUnit: 'd' }), newborn)).toBe('no');
  });
});
