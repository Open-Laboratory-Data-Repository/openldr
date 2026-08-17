import { describe, it, expect } from 'vitest';
import { parseSemver, compareSemver, isNewerVersion } from './semver';

describe('parseSemver', () => {
  it('parses a plain X.Y.Z', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('accepts the v prefix that git tags carry', () => {
    expect(parseSemver('v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0 });
  });

  it('rejects a two-part version', () => {
    expect(parseSemver('0.1')).toBeNull();
  });

  it('rejects a prerelease suffix — out of scope, and silently dropping it would mislead', () => {
    expect(parseSemver('1.0.0-rc1')).toBeNull();
  });

  it('rejects a non-numeric part', () => {
    expect(parseSemver('1.x.3')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parseSemver('')).toBeNull();
  });
});

describe('compareSemver', () => {
  // The case that bites every naive string compare.
  it('orders 0.10.0 above 0.2.0', () => {
    expect(compareSemver('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareSemver('0.10.0', '0.2.0')).toBeGreaterThan(0);
  });

  it('returns 0 for equal versions, v prefix or not', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
  });

  it('compares major before minor before patch', () => {
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareSemver('1.1.2', '1.1.1')).toBeGreaterThan(0);
  });

  it('throws on unparseable input rather than guessing', () => {
    expect(() => compareSemver('1.0', '1.0.0')).toThrow(/1\.0/);
  });
});

describe('isNewerVersion', () => {
  it('is true only when the candidate is strictly greater', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
  });

  // Never announce an update you could not verify.
  it('is false when either side is unparseable', () => {
    expect(isNewerVersion('garbage', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.2.0', 'garbage')).toBe(false);
  });
});
