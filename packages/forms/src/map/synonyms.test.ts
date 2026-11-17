import { describe, expect, it } from 'vitest';
import { seededStarterPacks } from '../samples/starter-packs';
import { suggest } from './suggest';
import { mapSynonyms } from './synonyms';
import { labResultTarget } from './targets';
import synonymsEn from './synonyms.en.json';
import synonymsFr from './synonyms.fr.json';
import synonymsPt from './synonyms.pt.json';

const target = labResultTarget(seededStarterPacks());
const paths = new Set(target.fields.map((f) => f.path));
const files = { en: synonymsEn, fr: synonymsFr, pt: synonymsPt } as Record<string, Record<string, string[]>>;

describe('synonym lists', () => {
  for (const [locale, file] of Object.entries(files)) {
    it(`keys the ${locale} list by paths of the Lab result target, each with column names`, () => {
      expect(Object.keys(file).length).toBeGreaterThan(0);
      for (const [key, names] of Object.entries(file)) {
        // `!path` lists names that must not go to that field (suggest.ts).
        expect(paths.has(key.replace(/^!/, '')), `${locale}: ${key}`).toBe(true);
        expect(names.length, `${locale}: ${key}`).toBeGreaterThan(0);
        for (const n of names) expect(n.trim(), `${locale}: ${key}`).toBe(n);
        expect(new Set(names).size, `${locale}: ${key} has a repeat`).toBe(names.length);
      }
    });
  }
});

describe('synonym coverage', () => {
  it('gives every field of the Lab result target at least one English column name', () => {
    for (const f of target.fields) expect(synonymsEn[f.path as keyof typeof synonymsEn]?.length ?? 0, f.path).toBeGreaterThan(0);
  });

  for (const [locale, file] of Object.entries(files)) {
    it(`lists no ${locale} column name under two fields`, () => {
      const seen = new Map<string, string>();
      const twice: string[] = [];
      for (const [key, names] of Object.entries(file)) {
        if (key.startsWith('!')) continue; // a not-for list may name a column for several fields
        for (const n of names) {
          const at = seen.get(n.toLowerCase());
          if (at && at !== key) twice.push(`${n}: ${at} and ${key}`);
          seen.set(n.toLowerCase(), key);
        }
      }
      expect(twice).toEqual([]);
    });
  }
});

describe('mapSynonyms', () => {
  it('gives the English list for en and for an unknown locale', () => {
    expect(mapSynonyms('en')).toEqual(synonymsEn);
    expect(mapSynonyms('xx')).toEqual(synonymsEn);
  });

  it('puts the locale list first and adds the English names, without repeats', () => {
    for (const locale of ['fr', 'pt']) {
      const merged = mapSynonyms(locale);
      const own = files[locale];
      for (const key of new Set([...Object.keys(own), ...Object.keys(synonymsEn)])) {
        const want = [...new Set([...(own[key] ?? []), ...((synonymsEn as Record<string, string[]>)[key] ?? [])])];
        expect(merged[key], `${locale}: ${key}`).toEqual(want);
      }
      expect(Object.keys(merged).sort()).toEqual([...new Set([...Object.keys(own), ...Object.keys(synonymsEn)])].sort());
    }
  });

  it('lets a made-up patient number column find the Patient ID field', () => {
    const out = suggest(target, ['pat_no', 'zzz'], mapSynonyms('en'));
    expect(out.find((s) => s.field === 'pat_no')?.targetPath).toBe('Patient.identifier.value');
  });

  it('does not let a caller change the lists it returns', () => {
    const a = mapSynonyms('fr');
    a['Patient.identifier.value']?.push('changed');
    expect(mapSynonyms('fr')['Patient.identifier.value']).not.toContain('changed');
    expect(mapSynonyms('en')['Patient.identifier.value']).not.toContain('changed');
  });
});
