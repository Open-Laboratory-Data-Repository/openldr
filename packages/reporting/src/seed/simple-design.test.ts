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
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' as const }] };
    const without = simpleTableDesign(base);
    const with_ = simpleTableDesign({ ...base, metric: 'X' });
    const t = (d: typeof without) => d.pages[0].elements.find((e) => e.kind === 'table')!.rect.y;
    // 2 pairs -> 1 panel row -> ceil((4*2 + 1*14)/0.75) = ceil(29.33) = 30
    // 3 pairs -> 2 panel rows -> ceil((4*2 + 2*14)/0.75) = 48
    // Difference is 18, NOT ceil(14/0.75) = 19. The two ceilings do not distribute over the
    // subtraction — that is exactly the px@96-vs-points arithmetic this file gets wrong.
    expect(t(with_) - t(without)).toBe(18);
  });

  it('renders the legend as a text element under the table when declared', () => {
    const d = simpleTableDesign({
      id: 'rt-l', name: 'L', queryId: 'q-l', columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }],
      legend: 'A blank cell means not tested.',
    });
    const legend = d.pages[0].elements.find((e) => e.id === 'rt-l-legend')!;
    expect(legend.kind).toBe('text');
    expect(legend.text).toBe('A blank cell means not tested.');
  });

  it('omits the legend element entirely when none is declared', () => {
    const d = simpleTableDesign({
      id: 'rt-nl', name: 'NL', queryId: 'q-nl', columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }],
    });
    expect(d.pages[0].elements.some((e) => e.id === 'rt-nl-legend')).toBe(false);
  });

  // ⛔ THE UNIT TEST THAT MATTERS. simple-design.ts:59-63 records a slice that shipped a silently
  // clipped row by mixing px@96 with points while every unit-blind test stayed green. A wrong-unit
  // legend height shows up here as a negative gap, on both papers.
  it.each([
    ['A4', 'portrait'] as const,
    ['Letter', 'landscape'] as const,
  ])('keeps table -> legend -> footer rule in order and non-overlapping on %s %s', (paper, orientation) => {
    const d = simpleTableDesign({
      id: 'rt-geo', name: 'Geo', queryId: 'q-geo', columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }],
      paper, orientation,
      metric: 'Percent resistant (%R).',
      legend: 'A blank cell means not tested.',
    });
    const el = (id: string) => d.pages[0].elements.find((e) => e.id === `rt-geo-${id}`)!;
    const table = el('table'), legend = el('legend'), rule2 = el('rule2');
    expect(table.rect.h).toBeGreaterThan(0);
    expect(legend.rect.y).toBeGreaterThanOrEqual(table.rect.y + table.rect.h);
    expect(rule2.rect.y).toBeGreaterThanOrEqual(legend.rect.y + legend.rect.h);
  });
});
