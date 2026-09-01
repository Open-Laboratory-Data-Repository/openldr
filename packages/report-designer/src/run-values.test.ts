import { describe, it, expect } from 'vitest';
import { designRunValues } from './run-values';
import type { ReportDesign, TemplateParam } from './schema';

const design = (parameters: TemplateParam[]): ReportDesign => ({
  id: 'd', name: 'D', paper: 'A4', orientation: 'portrait', status: 'draft',
  parameters, pages: [],
});

describe('designRunValues', () => {
  it('flattens a daterange into the flat from/to the seeded queries read, keeping the nested value', () => {
    const v = designRunValues(design([
      { key: 'dateRange', label: 'Date range', type: 'daterange', value: { from: '2020-01-01', to: '2030-01-01' } },
    ]));
    expect(v.from).toBe('2020-01-01');
    expect(v.to).toBe('2030-01-01');
    expect(v.dateRange).toEqual({ from: '2020-01-01', to: '2030-01-01' });
  });

  it('carries every other parameter under its own key, unchanged', () => {
    const v = designRunValues(design([
      { key: 'facility', label: 'Facility', type: 'select', value: 'HQ' },
      { key: 'month', label: 'Month', type: 'text', value: '2018-08' },
    ]));
    expect(v).toEqual({ facility: 'HQ', month: '2018-08' });
  });

  it('a parameter declared literally as from wins over the flattening', () => {
    const v = designRunValues(design([
      { key: 'from', label: 'From', type: 'text', value: '1999-09-09' },
      { key: 'dateRange', label: 'Date range', type: 'daterange', value: { from: '2020-01-01', to: '2030-01-01' } },
    ]));
    expect(v.from).toBe('1999-09-09');
    // `to` was not declared on its own, so the range still supplies it.
    expect(v.to).toBe('2030-01-01');
  });

  it('an unset or half-set range contributes nothing rather than an empty date', () => {
    expect(designRunValues(design([
      { key: 'dateRange', label: 'R', type: 'daterange', value: { from: '', to: '' } },
    ]))).not.toHaveProperty('from');
    const half = designRunValues(design([
      { key: 'dateRange', label: 'R', type: 'daterange', value: { from: '2020-01-01', to: '' } },
    ]));
    expect(half.from).toBe('2020-01-01');
    expect(half).not.toHaveProperty('to');
    expect(designRunValues(design([{ key: 'dateRange', label: 'R', type: 'daterange' }]))).toEqual({});
  });
});
