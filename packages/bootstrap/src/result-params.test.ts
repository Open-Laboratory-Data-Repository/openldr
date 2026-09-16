import { describe, expect, it } from 'vitest';
import { matchBand, parseResultParams, type ResultBand } from './result-params';

const band = (b: Partial<ResultBand>): ResultBand => ({ low: null, high: null, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null, ...b });

describe('result parameters: reading what a test stored', () => {
  it('reads a numeric parameter with its bands', () => {
    expect(parseResultParams([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [{ low: 12, high: 15, unit: 'g/dL', sex: 'female' }] },
    ])).toEqual([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null,
        bands: [{ low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: null, ageHigh: null }] },
    ]);
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
    expect(matchBand(bands, { sex: 'female', ageYears: 30 })?.high).toBe(15);
    expect(matchBand(bands, { sex: 'male', ageYears: 30 })?.high).toBe(17);
  });

  it('takes a band that names an age window but no sex', () => {
    expect(matchBand(bands, { sex: 'male', ageYears: 9 })?.high).toBe(14);
  });

  it('falls back to the band that names neither', () => {
    expect(matchBand(bands, { sex: null, ageYears: null })?.high).toBe(13);
    expect(matchBand(bands, { sex: 'other', ageYears: 1 })?.high).toBe(13);
  });

  it('counts an age exactly on the low edge as inside, and the high edge as inside', () => {
    expect(matchBand(bands, { sex: 'male', ageYears: 18 })?.high).toBe(17);
    expect(matchBand(bands, { sex: null, ageYears: 17 })?.high).toBe(14);
  });

  it('answers null when nothing matches and there is no catch-all', () => {
    expect(matchBand([band({ low: 1, high: 2, sex: 'male' })], { sex: 'female', ageYears: 20 })).toBeNull();
  });
});
