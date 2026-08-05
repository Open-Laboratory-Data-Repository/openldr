import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parse } from 'csv-parse/sync';
import { ISO3166_COUNTRIES } from './iso3166';

// Resolved relative to this source file (not cwd) — same precedent as bundled-terminology.ts —
// so the test works whether run from the package root or the monorepo root.
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'iso3166',
  'iso3166-1.csv',
);

/** RFC4180 parse of the committed fixture. `packages/terminology/src/facility-csv.ts` uses the
 *  same library for the same reason: several rows quote a comma inside `name`
 *  (`"Bolivia, Plurinational State of"`, `"Korea, Republic of"`, `"Tanzania, United Republic of"`)
 *  and a naive `split(',')` would corrupt them. */
function parseFixture(): { name: string; 'alpha-3': string }[] {
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  return parse(raw, { columns: true, bom: true, trim: false, skip_empty_lines: true }) as {
    name: string;
    'alpha-3': string;
  }[];
}

const DIACRITIC_NAMES = [
  'Åland Islands',
  "Côte d'Ivoire",
  'Curaçao',
  'Réunion',
  'Saint Barthélemy',
  'Türkiye',
];

const rows = parseFixture();

describe('ISO 3166-1 fixture', () => {
  it('has exactly 249 rows', () => {
    expect(rows.length).toBe(249);
  });

  it('has 249 unique alpha-3 codes', () => {
    expect(new Set(rows.map((r) => r['alpha-3'])).size).toBe(249);
  });

  it('has 249 unique names', () => {
    expect(new Set(rows.map((r) => r.name)).size).toBe(249);
  });

  it('every alpha-3 code is three uppercase letters', () => {
    for (const r of rows) {
      expect(r['alpha-3']).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('keeps all six diacritic names byte-intact', () => {
    const names = new Set(rows.map((r) => r.name));
    for (const d of DIACRITIC_NAMES) {
      expect(names.has(d)).toBe(true);
    }
  });

  it('spot-checks TZA = Tanzania, United Republic of', () => {
    const tza = rows.find((r) => r['alpha-3'] === 'TZA');
    expect(tza?.name).toBe('Tanzania, United Republic of');
  });
});

describe('ISO3166_COUNTRIES (exported literals)', () => {
  it('has exactly 249 entries', () => {
    expect(ISO3166_COUNTRIES.length).toBe(249);
  });

  it('has 249 unique alpha-3 codes', () => {
    expect(new Set(ISO3166_COUNTRIES.map(([a3]) => a3)).size).toBe(249);
  });

  it('has 249 unique names', () => {
    expect(new Set(ISO3166_COUNTRIES.map(([, name]) => name)).size).toBe(249);
  });

  it('every alpha-3 code is three uppercase letters', () => {
    for (const [a3] of ISO3166_COUNTRIES) {
      expect(a3).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('keeps all six diacritic names byte-intact', () => {
    const names = new Set(ISO3166_COUNTRIES.map(([, name]) => name));
    for (const d of DIACRITIC_NAMES) {
      expect(names.has(d)).toBe(true);
    }
  });

  it('spot-checks TZA = Tanzania, United Republic of', () => {
    const tza = ISO3166_COUNTRIES.find(([a3]) => a3 === 'TZA');
    expect(tza?.[1]).toBe('Tanzania, United Republic of');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ISO3166_COUNTRIES)).toBe(true);
  });

  // The drift guard: the whole point of inlining literals is that a migration can trust them
  // without re-reading a moving CSV. This test is what stops the literals and the fixture ever
  // silently diverging — if someone edits the fixture (or the literals) without regenerating the
  // other, this fails.
  it('equals the fixture exactly, in file order (drift guard)', () => {
    const expected = rows.map((r) => [r['alpha-3'], r.name]);
    expect(ISO3166_COUNTRIES.map(([a3, name]) => [a3, name])).toEqual(expected);
  });
});
