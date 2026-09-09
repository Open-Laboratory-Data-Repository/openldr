import { describe, it, expect } from 'vitest';
import { mappingRowState } from './mappingRowState';

const base = { collides: false, confidence: null, checked: null, stale: false } as const;

describe('mappingRowState', () => {
  it('a collision is invalid, whatever else is true', () => {
    expect(mappingRowState({ ...base, collides: true })).toBe('invalid');
    expect(mappingRowState({ ...base, collides: true, confidence: 'exact' })).toBe('invalid');
    expect(mappingRowState({ ...base, collides: true, checked: { unrecognised: 0 } })).toBe('invalid');
  });

  // Reversal, 2026-09-09. An exact suggestion used to go green on its own. It scores the COLUMN
  // NAME and says nothing about the values inside the column, and the two headers it greened
  // hardest on the real Zambia export ("Type" and "Operational status") are the only two whose
  // values need checking at all: both are hardcoded 1.0 synonyms in `facility-mapping-suggest.ts`.
  // A green tick there told the operator not to click the one control that would have found the
  // 16 unrecognised values. Confidence in the name now buys nothing.
  it('an exact suggestion is still unchecked, because it scores the name and not the values', () => {
    expect(mappingRowState({ ...base, confidence: 'exact' })).toBe('neutral');
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
    expect(mappingRowState({ ...base, collides: true, stale: true })).toBe('invalid');
  });

  // Nothing to go stale against: a row that was never checked stays neutral, whatever the ranker
  // thought of its name. Before the reversal an exact suggestion reached 'stale' here.
  it('an unchecked row is neutral even when the mapping changed', () => {
    expect(mappingRowState({ ...base, confidence: 'exact', stale: true })).toBe('neutral');
  });

  it('nothing known at all is neutral', () => {
    expect(mappingRowState(base)).toBe('neutral');
  });
});
