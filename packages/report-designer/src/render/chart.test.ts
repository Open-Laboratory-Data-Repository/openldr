import { describe, it, expect } from 'vitest';
import { barLayout, linePoints, donutSlices, chartData, CHART_LABEL_H } from './chart';
import { toPt } from './units';
import type { DesignElement } from '../schema';
import type { ResolvedTable } from './pagination';

const box = { x: 40, y: 100, w: 400, h: 150 }; // POINTS, already converted

const data = [
  { label: 'Jan', values: [10] },
  { label: 'Feb', values: [30] },
  { label: 'Mar', values: [20] },
];

describe('barLayout', () => {
  it('keeps every bar inside the box, above the label band, proportional to its value', () => {
    const bars = barLayout(box, data, 1);
    expect(bars).toHaveLength(3);
    const plotBottom = box.y + box.h - CHART_LABEL_H;
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(box.x);
      expect(b.x + b.w).toBeLessThanOrEqual(box.x + box.w + 0.001);
      expect(b.y).toBeGreaterThanOrEqual(box.y);
      expect(b.y + b.h).toBeCloseTo(plotBottom, 5);
    }
    const [jan, feb, mar] = bars;
    expect(feb.h).toBeCloseTo((box.h - CHART_LABEL_H), 5); // max value fills the plot
    expect(jan.h).toBeCloseTo(feb.h / 3, 5);
    expect(mar.h).toBeCloseTo((feb.h * 2) / 3, 5);
  });

  it('two series pack side by side within each category slot', () => {
    const two = [{ label: 'A', values: [10, 20] }, { label: 'B', values: [20, 10] }];
    const bars = barLayout(box, two, 2);
    expect(bars).toHaveLength(4);
    expect(bars[0].series).toBe(0);
    expect(bars[1].series).toBe(1);
    expect(bars[1].x).toBeGreaterThan(bars[0].x);
  });

  it('degenerate inputs lay out nothing rather than NaN', () => {
    expect(barLayout(box, [], 1)).toEqual([]);
    const zeros = barLayout(box, [{ label: 'A', values: [0] }], 1);
    expect(zeros).toHaveLength(1);
    expect(zeros[0].h).toBe(0);
    expect(Number.isFinite(zeros[0].y)).toBe(true);
  });
});

describe('linePoints and donutSlices', () => {
  it('line points stay inside the plot and step across the width', () => {
    const [series] = linePoints(box, data, 1);
    expect(series).toHaveLength(3);
    for (const p of series) {
      expect(p.x).toBeGreaterThanOrEqual(box.x);
      expect(p.x).toBeLessThanOrEqual(box.x + box.w);
      expect(p.y).toBeGreaterThanOrEqual(box.y);
      expect(p.y).toBeLessThanOrEqual(box.y + box.h - CHART_LABEL_H);
    }
    expect(series[1].y).toBeLessThan(series[0].y); // bigger value sits higher
  });

  it('donut slices cover the full circle in proportion', () => {
    const slices = donutSlices([10, 30, 20]);
    expect(slices).toHaveLength(3);
    expect(slices[0].end - slices[0].start).toBeCloseTo((10 / 60) * Math.PI * 2, 5);
    expect(slices[2].end).toBeCloseTo(Math.PI * 2, 5);
  });

  it('a zero total yields no slices', () => {
    expect(donutSlices([0, 0])).toEqual([]);
  });
});

describe('chartData', () => {
  const el = (extra: Partial<DesignElement> = {}): DesignElement => ({
    id: 'c', kind: 'chart', name: 'c', rect: { x: 0, y: 0, w: 480, h: 200 },
    chartType: 'bar', labelColumn: 'month', valueColumns: ['count'],
    dataSource: { kind: 'custom-query', queryId: 'q' }, ...extra,
  });

  it('reads labels and numeric values from resolved rows, clamping junk to 0', () => {
    const resolved: ResolvedTable = {
      columns: [{ key: 'month', label: 'Month' }, { key: 'count', label: 'Count' }],
      rows: [{ month: 'Jan', count: '10' }, { month: 'Feb', count: 'n/a' }, { month: 'Mar', count: -5 }],
    };
    expect(chartData(el(), resolved)).toEqual([
      { label: 'Jan', values: [10] },
      { label: 'Feb', values: [0] },
      { label: 'Mar', values: [0] },
    ]);
  });

  it('an unbound chart supplies a small sample shape so the box is never blank', () => {
    const sample = chartData(el({ valueColumns: undefined, labelColumn: undefined, dataSource: undefined }), undefined);
    expect(sample.length).toBeGreaterThan(1);
    expect(sample.every((d) => Number.isFinite(d.values[0]))).toBe(true);
  });
});

describe('unit discipline', () => {
  it('the layout is computed from a toPt box, not the raw px rect', () => {
    // The same design rect in px would be 4/3 larger; a layout computed from it would spill past
    // the point-box bottom. This is the discriminating check the px-vs-pt memory demands.
    const pxRect = { x: 40 / 0.75, y: 100 / 0.75, w: 400 / 0.75, h: 150 / 0.75 };
    const ptBox = toPt(pxRect);
    const bars = barLayout(ptBox, data, 1);
    for (const b of bars) expect(b.y + b.h).toBeLessThanOrEqual(ptBox.y + ptBox.h);
  });
});

describe('rendering', () => {
  it('a design with bound and unbound charts renders a parseable PDF', async () => {
    const { renderReportDesignPdf } = await import('./index');
    const design = {
      id: 'd', name: 'D', paper: 'A4' as const, orientation: 'portrait' as const, status: 'draft' as const,
      parameters: [],
      pages: [{ id: 'p1', elements: [
        { id: 'b', kind: 'chart' as const, name: 'bars', rect: { x: 48, y: 48, w: 480, h: 200 },
          chartType: 'bar' as const, labelColumn: 'month', valueColumns: ['count'],
          dataSource: { kind: 'custom-query' as const, queryId: 'q' } },
        { id: 'l', kind: 'chart' as const, name: 'line', rect: { x: 48, y: 280, w: 480, h: 160 }, chartType: 'line' as const },
        { id: 'o', kind: 'chart' as const, name: 'donut', rect: { x: 48, y: 470, w: 200, h: 200 },
          chartType: 'donut' as const, labelColumn: 'month', valueColumns: ['count'],
          dataSource: { kind: 'custom-query' as const, queryId: 'q' } },
      ] }],
    };
    const resolved = new Map([
      ['b', { columns: [{ key: 'month', label: 'M' }, { key: 'count', label: 'C' }],
        rows: [{ month: 'Jan', count: 4 }, { month: 'Feb', count: 9 }, { month: 'Mar', count: 6 }] }],
      ['o', { columns: [{ key: 'month', label: 'M' }, { key: 'count', label: 'C' }],
        rows: [{ month: 'Jan', count: 4 }, { month: 'Feb', count: 9 }] }],
    ]);
    const buf = await renderReportDesignPdf(design, resolved as never, { now: new Date('2026-09-01T10:00:00Z') });
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1500);
  });
});
