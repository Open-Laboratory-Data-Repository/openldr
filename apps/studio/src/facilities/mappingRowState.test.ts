import { describe, it, expect } from 'vitest';
import { mappingRowState } from './mappingRowState';

const base = { collides: false, confidence: null, checked: null, stale: false } as const;

describe('mappingRowState', () => {
  it('a collision is invalid, whatever else is true', () => {
    expect(mappingRowState({ ...base, collides: true })).toBe('invalid');
    expect(mappingRowState({ ...base, collides: true, confidence: 'exact' })).toBe('invalid');
    expect(mappingRowState({ ...base, collides: true, checked: { unrecognised: 0 } })).toBe('invalid');
  });

  // The operator's decision: an exact, collision-free suggestion is already certain, and making
  // them confirm 21 of those by hand is the busywork this step exists to remove.
  it('an exact suggestion with no collision is valid without being checked', () => {
    expect(mappingRowState({ ...base, confidence: 'exact' })).toBe('valid');
  });

  it('a likely or weak suggestion still needs a look', () => {
    expect(mappingRowState({ ...base, confidence: 'likely' })).toBe('neutral');
    expect(mappingRowState({ ...base, confidence: 'weak' })).toBe('neutral');
  });

  it('a check that found nothing unrecognised is valid; one that did is invalid', () => {
    expect(mappingRowState({ ...base, checked: { unrecognised: 0 } })).toBe('valid');
    expect(mappingRowState({ ...base, checked: { unrecognised: 3 } })).toBe('invalid');
  });

  // Stale beats a stored result, because that result describes a mapping that no longer exists.
  it('stale outranks a previous check, but never a collision', () => {
    expect(mappingRowState({ ...base, checked: { unrecognised: 0 }, stale: true })).toBe('stale');
    expect(mappingRowState({ ...base, confidence: 'exact', stale: true })).toBe('stale');
    expect(mappingRowState({ ...base, collides: true, stale: true })).toBe('invalid');
  });

  it('nothing known at all is neutral', () => {
    expect(mappingRowState(base)).toBe('neutral');
  });
});
