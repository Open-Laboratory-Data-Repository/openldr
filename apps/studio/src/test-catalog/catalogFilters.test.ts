import { describe, expect, it } from 'vitest';
import type { FilterRule } from '@/components/data-table';
import { translateFilters } from './catalogFilters';

const rule = (column: string, value: unknown, operator = 'eq'): FilterRule =>
  ({ id: `${column}-${String(value)}`, column, operator, value, combine: 'and' }) as FilterRule;

describe('translateFilters', () => {
  it('maps each filter column to its named API parameter', () => {
    expect(translateFilters([rule('category', 'MOL'), rule('loinc', 'none'), rule('enabled', 'on'), rule('status', 'retired')]))
      .toEqual({ category: 'MOL', loinc: 'none', enabled: 'on', status: 'retired' });
  });

  it('drops what the API cannot express', () => {
    expect(translateFilters([rule('category', 'MOL', 'ne'), rule('loinc', 'maybe'), rule('code', 'X'), rule('enabled', '')]))
      .toEqual({});
  });

  it('lets a later rule on the same column win', () => {
    expect(translateFilters([rule('enabled', 'on'), rule('enabled', 'off')])).toEqual({ enabled: 'off' });
  });
});
