import { describe, expect, it } from 'vitest';
import { bandFit, bandInCatalog, findCatalogBand, matchBand, parseResultParams, SEX_OPTIONS, type ResultBand } from './result-params';

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
    expect(bandFit(band({ sex: 'female', ageLow: 15 }), { sex: 'female', ageYears: 30 })).toBe('yes');
    expect(bandFit(band({}), { sex: null, ageYears: null })).toBe('yes');
  });

  it('answers no when the sex or the age is outside the range', () => {
    expect(bandFit(band({ sex: 'male' }), { sex: 'female', ageYears: 30 })).toBe('no');
    expect(bandFit(band({ ageLow: 15 }), { sex: 'female', ageYears: 9 })).toBe('no');
    expect(bandFit(band({ ageHigh: 5 }), { sex: 'female', ageYears: 9 })).toBe('no');
  });

  it('answers unknown when the range names a fact the patient record lacks', () => {
    expect(bandFit(band({ sex: 'female' }), { sex: null, ageYears: 30 })).toBe('unknown');
    expect(bandFit(band({ ageLow: 15 }), { sex: 'female', ageYears: null })).toBe('unknown');
  });

  it('answers no over unknown when one fact is missing and the other is outside', () => {
    expect(bandFit(band({ sex: 'male', ageLow: 15 }), { sex: 'female', ageYears: null })).toBe('no');
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

  it('refuses a band whose field has the wrong type rather than coercing it to null', () => {
    const catalog = [band({ low: null, high: 15 })];
    // A number field sent as a string must not be coerced to null and match a catalog null.
    expect(findCatalogBand({ low: '5', high: 15, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }, catalog)).toBeNull();
    // Same for a string field sent as a number.
    const namedCatalog = [band({ name: null, low: 10, high: 15 })];
    expect(findCatalogBand({ name: 123, low: 10, high: 15, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }, namedCatalog)).toBeNull();
  });
});
