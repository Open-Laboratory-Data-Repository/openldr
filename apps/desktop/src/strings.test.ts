import { describe, expect, it } from 'vitest';
import { pickLang, STRINGS, type Lang } from './strings';

describe('pickLang', () => {
  it.each([
    ['fr-CA', 'fr'],
    ['fr', 'fr'],
    ['pt-BR', 'pt'],
    ['pt_PT', 'pt'],
    ['en-GB', 'en'],
    ['de-DE', 'en'],
    ['FR-fr', 'fr'],
    ['', 'en'],
  ])('%s gives %s', (locale, lang) => {
    expect(pickLang(locale)).toBe(lang);
  });
});

describe('STRINGS', () => {
  const english = Object.keys(STRINGS.en).sort();

  it('has words in English', () => {
    expect(english.length).toBeGreaterThan(0);
  });

  it.each(['fr', 'pt'] as const)('%s holds exactly the English keys', (lang: Lang) => {
    expect(Object.keys(STRINGS[lang]).sort()).toEqual(english);
  });

  it.each(['en', 'fr', 'pt'] as const)('%s has no empty value', (lang: Lang) => {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      expect(typeof value, `${lang}.${key}`).toBe('string');
      expect(value.trim(), `${lang}.${key}`).not.toBe('');
    }
  });
});
