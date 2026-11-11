import { describe, it, expect } from 'vitest';
import { numericRows } from './chartData';

describe('numericRows', () => {
  it('turns a count that arrived as text into a number', () => {
    // Postgres returns COUNT(*) as bigint, which the driver hands over as a string.
    const rows = numericRows([{ label: 'FBC', value: '18' }, { label: 'HIV', value: '9' }], ['value']);
    expect(rows).toEqual([{ label: 'FBC', value: 18 }, { label: 'HIV', value: 9 }]);
  });

  it('leaves labels and non-numeric text alone', () => {
    const rows = numericRows([{ label: '007', value: 'n/a' }, { label: 'x', value: null }], ['value']);
    expect(rows).toEqual([{ label: '007', value: 'n/a' }, { label: 'x', value: null }]);
  });
});
