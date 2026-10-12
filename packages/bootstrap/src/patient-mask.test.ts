import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ageInYears, birthYear, createRefCodec, maskName, maskValue } from './patient-mask';

describe('patient masking', () => {
  it('masks a name to its first character', () => {
    expect([maskName('Mwanza'), maskName(' banda'), maskName('Émile'), maskName(''), maskName(null)]).toEqual(['M***', 'b***', 'É***', null, null]);
  });

  it('masks an identifier to its last four characters, or entirely when it is short', () => {
    expect([maskValue('123456/10/1'), maskValue('ABCDE'), maskValue('ABCD'), maskValue('A'), maskValue(null)])
      .toEqual(['•••10/1', '•••BCDE', '•••', '•••', null]);
  });

  it('works out whole years of age and the birth year', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    expect([ageInYears('1990-10-12', now), ageInYears('1990-10-13', now), ageInYears('2026', now), ageInYears(null, now), ageInYears('bad', now)])
      .toEqual([36, 35, 0, null, null]);
    expect([birthYear('1990-10-12'), birthYear('1990'), birthYear(null), birthYear('x')]).toEqual(['1990', '1990', null, null]);
  });

  it('round-trips a ref, and refuses one from another key or tampered', () => {
    const codec = createRefCodec(randomBytes(32));
    const ref = codec.encode('hl7-12345');
    expect(ref).not.toContain('12345');
    expect(ref).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codec.decode(ref)).toBe('hl7-12345');
    expect(createRefCodec(randomBytes(32)).decode(ref)).toBeNull();
    const i = Math.floor(ref.length / 2);
    const tampered = ref.slice(0, i) + (ref[i] === 'A' ? 'B' : 'A') + ref.slice(i + 1);
    expect(tampered).not.toBe(ref);
    expect(codec.decode(tampered)).toBeNull();
    expect(codec.decode('not a ref!')).toBeNull();
    expect(codec.decode('')).toBeNull();
  });
});
