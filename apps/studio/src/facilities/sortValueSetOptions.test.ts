import { describe, it, expect } from 'vitest';
import { sortValueSetOptions } from './sortValueSetOptions';

const opt = (code: string, display: string | null) => ({ code, display });

describe('sortValueSetOptions', () => {
  it('orders by the string the operator actually reads', () => {
    const sorted = sortValueSetOptions([
      opt('zonal-referral-hospital', 'Zonal Referral Hospital'),
      opt('dispensary', 'Dispensary'),
      opt('health-center', 'Health Center'),
    ], 'en');
    expect(sorted.map((o) => o.display)).toEqual(['Dispensary', 'Health Center', 'Zonal Referral Hospital']);
  });

  // Migration 072 seeds several concepts with a null display; they must still be reachable and must
  // still land somewhere predictable rather than clumping at one end by accident.
  it('falls back to the code when a concept has no display', () => {
    const sorted = sortValueSetOptions([
      opt('zebra', null),
      opt('alpha', null),
      opt('m-code', 'Middle'),
    ], 'en');
    expect(sorted.map((o) => o.code)).toEqual(['alpha', 'm-code', 'zebra']);
  });

  // ⛔ LOCALE-AWARE, not a plain `<`. The studio ships in French and Portuguese, where a codepoint
  // comparison files every accented name after `Z`. `Île` belongs with `I`, not at the end.
  it('files accented names where a French reader looks for them', () => {
    const sorted = sortValueSetOptions([
      opt('z', 'Zone'), opt('i', 'Île-de-France'), opt('h', 'Hôpital'),
    ], 'fr');
    expect(sorted.map((o) => o.display)).toEqual(['Hôpital', 'Île-de-France', 'Zone']);
  });

  it('is case-insensitive, so a lowercase entry does not sort after every capital', () => {
    const sorted = sortValueSetOptions([opt('b', 'beta'), opt('a', 'Alpha'), opt('c', 'Gamma')], 'en');
    expect(sorted.map((o) => o.display)).toEqual(['Alpha', 'beta', 'Gamma']);
  });

  it('does not mutate the array it was given', () => {
    const input = [opt('b', 'Beta'), opt('a', 'Alpha')];
    sortValueSetOptions(input, 'en');
    expect(input.map((o) => o.display)).toEqual(['Beta', 'Alpha']);
  });

  it('survives an unknown language rather than throwing', () => {
    expect(() => sortValueSetOptions([opt('a', 'Alpha')], 'not-a-language')).not.toThrow();
  });
});
