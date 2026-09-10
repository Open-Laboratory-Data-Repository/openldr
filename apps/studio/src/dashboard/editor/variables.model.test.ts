import { describe, it, expect } from 'vitest';
import {
  extractVariables,
  extractLogicalVariables,
  compatibleFilters,
  hasBareDateRangeToken,
} from './variables.model';
import type { DashboardFilterDef } from '../../api';

const FILTERS: DashboardFilterDef[] = [
  { id: 'period', label: 'Period', type: 'date-range' },
  { id: 'test', label: 'Test', type: 'text' },
  { id: 'day', label: 'Day', type: 'date' },
  { id: 'top', label: 'Top N', type: 'number' },
];

describe('extractVariables', () => {
  it('returns each {{name}} once, in first-seen order', () => {
    expect(extractVariables('a {{x}} b {{y}} c {{x}}')).toEqual(['x', 'y']);
  });
  it('returns nothing for SQL with no placeholder', () => {
    expect(extractVariables('SELECT 1')).toEqual([]);
  });
});

describe('extractLogicalVariables', () => {
  it('folds _from/_to back into the date-range variable that declared them', () => {
    const defs = { period: { type: 'date-range' as const, label: 'Period' } };
    expect(extractLogicalVariables('d >= {{period_from}} AND d <= {{period_to}}', defs)).toEqual(['period']);
  });
  it('leaves a _from suffix alone when no date-range variable claims it', () => {
    expect(extractLogicalVariables('x = {{period_from}}', {})).toEqual(['period_from']);
  });
  it('folds a one-sided range without inventing the missing half', () => {
    const defs = { period: { type: 'date-range' as const, label: 'Period' } };
    expect(extractLogicalVariables('d >= {{period_from}}', defs)).toEqual(['period']);
  });
});

describe('compatibleFilters', () => {
  it('keeps only filters of the same type', () => {
    expect(compatibleFilters('date-range', FILTERS, undefined).map((f) => f.id)).toEqual(['period']);
    expect(compatibleFilters('text', FILTERS, undefined).map((f) => f.id)).toEqual(['test']);
    expect(compatibleFilters('number', FILTERS, undefined).map((f) => f.id)).toEqual(['top']);
  });

  // A saved binding that no longer type-matches must stay selectable. Dropping it would make the
  // picker render a blank trigger and hide a mismatch the author needs to see and fix.
  it('keeps a bound filter whose type no longer matches', () => {
    expect(compatibleFilters('date-range', FILTERS, 'test').map((f) => f.id)).toEqual(['period', 'test']);
  });

  it('does not duplicate a bound filter that already matches', () => {
    expect(compatibleFilters('text', FILTERS, 'test').map((f) => f.id)).toEqual(['test']);
  });

  it('ignores a bound id that no longer exists', () => {
    expect(compatibleFilters('text', FILTERS, 'deleted').map((f) => f.id)).toEqual(['test']);
  });
});

describe('hasBareDateRangeToken', () => {
  // `{{period}}` resolves to NULL for a date-range: resolveValues only ever produces
  // `period_from` and `period_to`. This is the one case that can never work.
  it('flags a bare {{name}} on a date-range variable', () => {
    expect(hasBareDateRangeToken('d >= {{period}}', 'period', 'date-range')).toBe(true);
  });
  it('flags it even when the split tokens are also present', () => {
    expect(hasBareDateRangeToken('{{period}} {{period_from}}', 'period', 'date-range')).toBe(true);
  });
  it('stays silent on a one-sided range, which is a real authoring choice', () => {
    expect(hasBareDateRangeToken('d >= {{period_from}}', 'period', 'date-range')).toBe(false);
  });
  it('stays silent on the split tokens', () => {
    expect(hasBareDateRangeToken('{{period_from}} {{period_to}}', 'period', 'date-range')).toBe(false);
  });
  it('stays silent for every other type, where the bare token is correct', () => {
    expect(hasBareDateRangeToken('x = {{ward}}', 'ward', 'text')).toBe(false);
    expect(hasBareDateRangeToken('x = {{day}}', 'day', 'date')).toBe(false);
    expect(hasBareDateRangeToken('x = {{n}}', 'n', 'number')).toBe(false);
  });
});
