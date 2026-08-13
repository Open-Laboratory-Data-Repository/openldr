import { describe, it, expect } from 'vitest';
import { normaliseLabel, similarity, suggestColumns, suggestValues } from './facility-mapping-suggest';

describe('normaliseLabel', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normaliseLabel('  MFL_Code  ')).toBe('mfl code');
    expect(normaliseLabel('Operational status')).toBe('operational status');
  });
});

describe('similarity', () => {
  it('is 1 for identical strings and 0 for nothing in common', () => {
    expect(similarity('health centre', 'health centre')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
  });

  it('scores a near miss above a far one', () => {
    expect(similarity('health centre', 'health center'))
      .toBeGreaterThan(similarity('health centre', 'health post'));
  });
});

describe('suggestColumns', () => {
  it('matches a contract field by its own name', () => {
    const [s] = suggestColumns(['Name']);
    expect(s.candidates[0]).toMatchObject({ target: 'name', confidence: 'exact' });
  });

  it('resolves the shipped synonyms', () => {
    const byHeader = Object.fromEntries(
      suggestColumns(['MFL Code', 'Province', 'Type', 'Operational status'])
        .map((s) => [s.header, s.candidates[0]]),
    );
    expect(byHeader['MFL Code']).toMatchObject({ target: 'national_code', confidence: 'exact' });
    expect(byHeader.Province).toMatchObject({ target: 'zone', confidence: 'exact' });
    expect(byHeader.Type).toMatchObject({ target: 'level', confidence: 'exact' });
    expect(byHeader['Operational status']).toMatchObject({ target: 'status', confidence: 'exact' });
  });

  it('⛔ offers NOTHING for a header with no plausible target', () => {
    const [s] = suggestColumns(['Catchment population cso']);
    expect(s.candidates).toEqual([]);
  });

  it('measured against the Zambia MFL export: 12 of 21 headers get a suggestion', () => {
    // Started as "10 of 21" in the brief; measured at 12 against the shipped reference SYNONYMS/
    // direct-match logic, verbatim, with WEAK_MIN untouched. The two extra matches are both exact
    // (score 1), not borderline, so no threshold explains or fixes the gap:
    //  - 'Zone' -> 'zone' is a literal contract-field-name match, the SAME mechanism the 'Name'
    //    test above exercises. It cannot be suppressed without breaking that mechanism.
    //  - 'Ownership type' -> 'ownership' fires on the shipped SYNONYMS entry `'ownership type':
    //    'ownership'`, consistent with the already-established "X type" convention ('facility
    //    type'/'tier' -> 'level'). Removing that entry would not even change the count: the fuzzy
    //    fallback still finds 'ownership' at 0.762, comfortably above WEAK_MIN (0.62).
    // Every one of the 9 non-matching headers sits well below WEAK_MIN (worst near-miss: 'Mobility
    // status' at 0.526), so WEAK_MIN is not what is being tested here either way.
    const headers = [
      'MFL Code', 'DHIS2 UID', 'Hims code', 'Name', 'Province', 'District', 'Constituency',
      'Ward', 'Zone', 'Location', 'Type', 'Ownership', 'Ownership type', 'Operational status',
      'Mobility status', 'Accesibility', 'Catchment population head count',
      'Catchment population cso', 'Number of households', 'Latitude', 'Longitude',
    ];
    const suggested = suggestColumns(headers).filter((s) => s.candidates.length > 0);
    expect(suggested.map((s) => s.header).sort()).toEqual([
      'District', 'Latitude', 'Longitude', 'MFL Code', 'Name', 'Operational status',
      'Ownership', 'Ownership type', 'Province', 'Type', 'Ward', 'Zone',
    ]);
  });
});

describe('suggestValues', () => {
  const levels = [
    { code: 'health-center', display: 'Health Center' },
    { code: 'health-post', display: 'Health Post' },
    { code: 'district-hospital', display: 'District Hospital' },
    { code: 'general-clinic', display: 'General Clinic' },
  ];

  it('matches a display that differs only in spelling', () => {
    const [s] = suggestValues(['Health Centre'], levels);
    expect(s.candidates[0]).toMatchObject({ target: 'health-center', confidence: 'likely' });
  });

  it('matches an exact display outright', () => {
    const [s] = suggestValues(['Health Post'], levels);
    expect(s.candidates[0]).toMatchObject({ target: 'health-post', confidence: 'exact' });
  });

  it('⛔ offers NOTHING for 1st Level Hospital — a weak guess is worse than none', () => {
    // This needs knowledge of how Zambia tiers its hospitals. String similarity cannot reach it,
    // and pretending otherwise is how a wrong vocabulary ships looking confirmed.
    const [s] = suggestValues(['1st Level Hospital'], levels);
    expect(s.candidates).toEqual([]);
  });
});
