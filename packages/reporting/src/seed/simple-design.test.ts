import { describe, it, expect } from 'vitest';
import { simpleTableDesign } from './simple-design';

describe('simpleTableDesign', () => {
  it('builds a one-table A4 design bound to a query with a title, date and params', () => {
    const d = simpleTableDesign({
      id: 'rt-amr-resistance', name: 'AMR Resistance Rate', queryId: 'q-amr-resistance',
      columns: [{ key: 'antibiotic', label: 'Antibiotic' }, { key: 'percentR', label: '%R' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }, { key: 'facility', label: 'Facility', type: 'select' }],
    });
    expect(d.pages[0].elements.some((e) => e.kind === 'table' && e.dataSource?.queryId === 'q-amr-resistance')).toBe(true);
    const table = d.pages[0].elements.find((e) => e.kind === 'table')!;
    expect(table.boundColumns).toEqual([{ key: 'antibiotic', label: 'Antibiotic' }, { key: 'percentR', label: '%R' }]);
    expect(d.parameters).toHaveLength(2);
  });

  it('adds a Metric scope pair when the spec declares one, immediately before Generated', () => {
    const d = simpleTableDesign({
      id: 'rt-m', name: 'M', queryId: 'q-m',
      columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }],
      metric: 'Percent resistant (%R).',
    });
    const panel = d.pages[0].elements.find((e) => e.id === 'rt-m-meta')!;
    expect(panel.rows).toEqual([
      ['Reporting period', '{{param.from}} – {{param.to}}'],
      ['Metric', 'Percent resistant (%R).'],
      ['Generated', '{{date}}'],
    ]);
  });

  it('omits the Metric pair entirely when the spec declares none', () => {
    const d = simpleTableDesign({
      id: 'rt-n', name: 'N', queryId: 'q-n',
      columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }],
    });
    const panel = d.pages[0].elements.find((e) => e.id === 'rt-n-meta')!;
    expect(panel.rows).toEqual([
      ['Reporting period', '{{param.from}} – {{param.to}}'],
      ['Generated', '{{date}}'],
    ]);
  });

  it('grows the panel and pushes the table down by exactly one row when a metric is added', () => {
    const base = { id: 'rt-g', name: 'G', queryId: 'q-g', columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }] };
    const without = simpleTableDesign(base);
    const with_ = simpleTableDesign({ ...base, metric: 'X' });
    const t = (d: typeof without) => d.pages[0].elements.find((e) => e.kind === 'table')!.rect.y;
    // 2 pairs -> 1 panel row -> ceil((4*2 + 1*14)/0.75) = ceil(29.33) = 30
    // 3 pairs -> 2 panel rows -> ceil((4*2 + 2*14)/0.75) = 48
    // Difference is 18, NOT ceil(14/0.75) = 19. The two ceilings do not distribute over the
    // subtraction — that is exactly the px@96-vs-points arithmetic this file gets wrong.
    expect(t(with_) - t(without)).toBe(18);
  });
});
