import { describe, it, expect } from 'vitest';
import { filterTokens } from './template';

describe('filterTokens', () => {
  it('names a date-range filter with _from and _to', () => {
    expect(filterTokens({ id: 'period', type: 'date-range' })).toEqual(['period_from', 'period_to']);
  });
  it('names every other type with the bare id', () => {
    expect(filterTokens({ id: 'ward', type: 'text' })).toEqual(['ward']);
    expect(filterTokens({ id: 'n', type: 'number' })).toEqual(['n']);
    expect(filterTokens({ id: 'day', type: 'date' })).toEqual(['day']);
  });
});
