import { describe, it, expect } from 'vitest';
import { numericRows, pivotSeries, shapeChart } from './chartData';

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

describe('pivotSeries', () => {
  // A Breakdown returns one row per (label, series). A chart needs one row per label with one
  // column per series.
  const rows = [
    { label: '2026-09', series: 'routine', value: 4 },
    { label: '2026-09', series: 'urgent', value: 1 },
    { label: '2026-10', series: 'routine', value: 6 },
  ];

  it('makes one column per series, in first-seen order', () => {
    const { data, series } = pivotSeries(rows, 'label', 'value');
    expect(series).toEqual(['routine', 'urgent']);
    expect(data).toEqual([
      { label: '2026-09', routine: 4, urgent: 1 },
      { label: '2026-10', routine: 6, urgent: 0 },
    ]);
  });

  it('adds up a series that repeats for one label', () => {
    const { data } = pivotSeries([...rows, { label: '2026-10', series: 'routine', value: '2' }], 'label', 'value');
    expect(data[1]).toEqual({ label: '2026-10', routine: 8, urgent: 0 });
  });
});

describe('shapeChart', () => {
  const rows = [
    { label: 'Sep', series: 'routine', value: 4 },
    { label: 'Sep', series: 'urgent', value: 1 },
  ];

  it('draws one series per Breakdown value on a bar chart', () => {
    const shaped = shapeChart('bar-chart', rows, 'label', 'value', true);
    expect(shaped.series).toEqual(['routine', 'urgent']);
    expect(shaped.data).toEqual([{ label: 'Sep', routine: 4, urgent: 1 }]);
  });

  it('adds the Breakdown values up for a pie, which has one ring', () => {
    const shaped = shapeChart('pie-chart', rows, 'label', 'value', true);
    expect(shaped.series).toEqual(['value']);
    expect(shaped.data).toEqual([{ label: 'Sep', value: 5 }]);
  });

  it('keeps a plain result as one series named by the value column', () => {
    const shaped = shapeChart('bar-chart', [{ label: 'Sep', value: '5' }], 'label', 'value', false);
    expect(shaped).toEqual({ data: [{ label: 'Sep', value: 5 }], series: ['value'] });
  });
});
