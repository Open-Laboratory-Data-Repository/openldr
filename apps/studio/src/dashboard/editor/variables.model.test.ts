import { describe, it, expect } from 'vitest';
import {
  extractVariables,
  extractLogicalVariables,
  compatibleFilters,
  hasBareDateRangeToken,
  setVariableType,
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

describe('setVariableType', () => {
  const RANGE_SQL = 'select 1 where d >= {{period_from}} and d <= {{period_to}}';

  it('sets the type of an ordinary variable', () => {
    const defs = { ward: { type: 'text' as const, label: 'Ward' } };
    expect(setVariableType(defs, 'ward', 'number')).toEqual({ ward: { type: 'number', label: 'Ward' } });
  });

  it('keeps the label when the type changes', () => {
    const defs = { period: { type: 'date-range' as const, label: 'Period' } };
    expect(setVariableType(defs, 'period', 'text').period.label).toBe('Period');
  });

  it('creates a def for a variable that had none', () => {
    expect(setVariableType({}, 'ward', 'date')).toEqual({ ward: { type: 'date', label: 'ward' } });
  });

  // A name ending in _from/_to can never itself be a range: its own tokens would be
  // `period_from_from`, which is in nobody's SQL. Date Range there means the range that owns
  // that half, so the type lands on the base name.
  it('puts a range on the base name, not on the _from half', () => {
    const next = setVariableType({}, 'period_from', 'date-range');
    expect(next).toEqual({ period: { type: 'date-range', label: 'period' } });
  });

  it('does the same from the _to half', () => {
    const next = setVariableType({}, 'period_to', 'date-range');
    expect(next).toEqual({ period: { type: 'date-range', label: 'period' } });
  });

  it('drops both halves so the fold can happen again', () => {
    const defs = {
      period: { type: 'text' as const, label: 'Period' },
      period_from: { type: 'text' as const, label: 'period_from' },
      period_to: { type: 'text' as const, label: 'period_to' },
    };
    const next = setVariableType(defs, 'period_from', 'date-range');
    expect(next).toEqual({ period: { type: 'date-range', label: 'Period' } });
  });

  // The operator's exact three steps: Date Range, then Text, then Date Range again.
  it('survives the Date Range to Text and back round trip', () => {
    const start = { period: { type: 'date-range' as const, label: 'Period' } };
    expect(extractLogicalVariables(RANGE_SQL, start)).toEqual(['period']);

    const toText = setVariableType(start, 'period', 'text');
    expect(extractLogicalVariables(RANGE_SQL, toText)).toEqual(['period_from', 'period_to']);

    const backToRange = setVariableType(toText, 'period_from', 'date-range');
    expect(extractLogicalVariables(RANGE_SQL, backToRange)).toEqual(['period']);
    expect(backToRange.period).toEqual({ type: 'date-range', label: 'Period' });
    expect(hasBareDateRangeToken(RANGE_SQL, 'period', 'date-range')).toBe(false);
  });

  // Only a range gets the base-name treatment. A text variable really can be called ward_from.
  it('leaves a _from name alone for every other type', () => {
    const next = setVariableType({}, 'ward_from', 'text');
    expect(next).toEqual({ ward_from: { type: 'text', label: 'ward_from' } });
  });

  it('never mutates the map it is given', () => {
    const defs = { period_from: { type: 'text' as const, label: 'x' } };
    setVariableType(defs, 'period_from', 'date-range');
    expect(defs).toEqual({ period_from: { type: 'text', label: 'x' } });
  });
});
