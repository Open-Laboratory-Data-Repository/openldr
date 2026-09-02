import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatDisplayDate, formatDisplayDateOf } from './format-date';

describe('formatDisplayDate', () => {
  it.each([
    ['2026-08-12', '12 Aug 2026'],
    ['2026-01-01', '1 Jan 2026'],      // no leading zero on the day
    ['2026-12-31', '31 Dec 2026'],
    ['2024-02-29', '29 Feb 2024'],     // leap year
    ['2000-02-29', '29 Feb 2000'],     // divisible by 400, IS a leap year
  ])('formats %s as %s', (input, expected) => {
    expect(formatDisplayDate(input)).toBe(expected);
  });

  // ⛔ Everything that is not a plain ISO date is returned UNCHANGED. `from`/`to` are declared
  // `text` and may hold anything, so this function is a filter, not a parser.
  it.each([
    ['—', 'the em dash a declared-but-unset parameter renders'],
    ['', 'an empty string'],
    ['not a date', 'free text'],
    ['2026-02-30', 'a date-shaped string that is not a real date'],
    ['2023-02-29', 'Feb 29 in a non-leap year'],
    ['1900-02-29', 'Feb 29 in a century year that is NOT a leap year'],
    ['2026-13-01', 'month 13'],
    ['2026-00-10', 'month 0'],
    ['2026-08-00', 'day 0'],
    ['2026-08-32', 'day 32'],
    ['2026-8-12', 'an unpadded month'],
    ['2026-08-12T00:00:00Z', 'a full timestamp, not a plain date'],
  ])('returns %s unchanged — %s', (input) => {
    expect(formatDisplayDate(input)).toBe(input);
  });

  // ⛔ The invariant the whole slice rests on: this module reads NOTHING from the environment.
  //
  // A runtime test cannot prove that. Setting `process.env.LANG` mid-test does not move ICU's
  // default locale — that is resolved when the process starts — so a "formats the same under a
  // different LANG" test would pass even if this module were rewritten to use
  // `Intl.DateTimeFormat(undefined, …)`, which is precisely the environment dependence being
  // removed. It would assert nothing while looking rigorous.
  //
  // So assert it at the only layer where it is decidable: the source. `toLocaleDateString()` with
  // no locale is what let the SERVER decide whether a Ministry document said 7 August or 8 July.
  it('reaches for no locale API — the CODE contains neither Intl nor toLocale', () => {
    const src = readFileSync(new URL('./format-date.ts', import.meta.url), 'utf8')
      // ⚠ Strip comments FIRST. That file's doc comments deliberately name `Intl.DateTimeFormat`
      // and `toLocaleDateString` to explain why neither is used, so matching the raw text would
      // fail on the explanation rather than on a real regression.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\bIntl\b/);
    expect(src).not.toMatch(/toLocale/);
  });
});

describe('formatDisplayDateOf', () => {
  // Built from LOCAL components on purpose. `new Date('2026-07-08T00:00:00Z')` would be 7 July in
  // any negative-offset timezone, so a literal expectation on it passes in Nairobi and fails in
  // New York. This constructor pins the local calendar day in every zone.
  it('formats a Date from its local calendar day', () => {
    expect(formatDisplayDateOf(new Date(2026, 6, 8))).toBe('8 Jul 2026');
    expect(formatDisplayDateOf(new Date(2026, 11, 31, 23, 59))).toBe('31 Dec 2026');
  });

  it('renders an unreadable clock as an em dash, not the word "undefined"', () => {
    // `now` is caller-supplied. Without this guard `MONTHS[NaN]` is `undefined` and the page prints
    // the literal `NaN undefined NaN`.
    expect(formatDisplayDateOf(new Date('nonsense'))).toBe('—');
  });
});

// ⛔ The month NAMES vary by print language; the ORDER never does. English, French and Portuguese
// all write the day first, so the ambiguous-numeric defect this module exists to prevent
// (`07/08/2026`) cannot come back through a locale that reorders the parts.
describe('formatDisplayDate per print language', () => {
  it('prints French and Portuguese month names', () => {
    expect(formatDisplayDate('2026-09-02', 'fr')).toBe('2 sept. 2026');
    expect(formatDisplayDate('2026-09-02', 'pt')).toBe('2 set. 2026');
    expect(formatDisplayDate('2026-08-12', 'fr')).toBe('12 août 2026');
  });

  it('an absent, unknown or English language prints exactly what it always did', () => {
    expect(formatDisplayDate('2026-09-02')).toBe('2 Sep 2026');
    expect(formatDisplayDate('2026-09-02', 'en')).toBe('2 Sep 2026');
    expect(formatDisplayDate('2026-09-02', 'sw')).toBe('2 Sep 2026');
  });

  it('resolves a regional tag by its base language', () => {
    expect(formatDisplayDate('2026-09-02', 'pt-BR')).toBe('2 set. 2026');
    expect(formatDisplayDate('2026-09-02', 'en-GB')).toBe('2 Sep 2026');
  });

  it('is still a filter: a non-date passes through in every language', () => {
    expect(formatDisplayDate('—', 'fr')).toBe('—');
    expect(formatDisplayDate('2026-02-30', 'fr')).toBe('2026-02-30');
    expect(formatDisplayDate('BAMAA', 'pt')).toBe('BAMAA');
  });

  it('formatDisplayDateOf follows the same language', () => {
    expect(formatDisplayDateOf(new Date(2026, 8, 2), 'fr')).toBe('2 sept. 2026');
    expect(formatDisplayDateOf(new Date(2026, 8, 2))).toBe('2 Sep 2026');
    expect(formatDisplayDateOf(new Date(NaN), 'fr')).toBe('—');
  });
});
