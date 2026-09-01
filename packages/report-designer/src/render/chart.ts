import type { DesignElement } from '../schema';
import type { ResolvedTable } from './pagination';

/**
 * Chart geometry and drawing. Every constant and every box here is POINTS — the caller hands in
 * `toPt(el.rect)` and nothing in this file may touch a px value. Mixing the two scales is the bug
 * that once shipped a clipped keyvalue row past a green suite (the px-vs-pt memory).
 *
 * Colors are presentational constants, never authored and never clinical: a chart shows magnitude,
 * and no series color may ever carry a result meaning (AGENTS.md §8; the same line `CELL_RAMPS`
 * draws in schema.ts).
 */
type Doc = typeof import('pdfkit');

/** Print-safe categorical series colors, color-blind-considered, in assignment order. */
export const CHART_COLORS = ['#2f6db3', '#e08214', '#35978f', '#c51b7d', '#7570b3', '#66a61e'];
const AXIS_COLOR = '#a3a3a3';
const LABEL_COLOR = '#525252';
const SAMPLE_FILL = '#b9cde4';

/** Height of the category-label band under the plot, pt. */
export const CHART_LABEL_H = 10;
const LABEL_FONT_PT = 6;
const BAR_GAP_RATIO = 0.25; // share of each category slot left as air
const LINE_W = 1.5;
const DOT_R = 1.5;

export interface ChartDatum { label: string; values: number[] }
export interface BarBox { x: number; y: number; w: number; h: number; series: number; datum: number }

/** Rows → plottable data. A value that does not parse as a finite number, or is negative, becomes
 *  0: a chart of counts has no honest way to draw either. Unbound gets a small static sample so
 *  the box is never blank on paper, mirroring an unbound table's sample rows. */
export function chartData(el: DesignElement, resolved: ResolvedTable | undefined): ChartDatum[] {
  if (el.dataSource && resolved && 'rows' in resolved) {
    const valueKeys = el.valueColumns ?? [];
    if (valueKeys.length === 0) return [];
    return resolved.rows.map((row, i) => ({
      label: el.labelColumn ? String(row[el.labelColumn] ?? '') : String(i + 1),
      values: valueKeys.map((k) => {
        const n = Number(row[k]);
        return Number.isFinite(n) && n > 0 ? n : 0;
      }),
    }));
  }
  return [
    { label: 'A', values: [3] }, { label: 'B', values: [5] }, { label: 'C', values: [4] },
    { label: 'D', values: [7] }, { label: 'E', values: [6] },
  ];
}

type Box = { x: number; y: number; w: number; h: number };

const plotBottom = (box: Box): number => box.y + box.h - CHART_LABEL_H;
const maxValue = (data: ChartDatum[]): number => Math.max(0, ...data.flatMap((d) => d.values));

/** Grouped vertical bars: each category gets an equal slot, series pack side by side inside it. */
export function barLayout(box: Box, data: ChartDatum[], seriesCount: number): BarBox[] {
  if (data.length === 0 || seriesCount < 1) return [];
  const max = maxValue(data);
  const plotH = box.h - CHART_LABEL_H;
  const slotW = box.w / data.length;
  const gap = slotW * BAR_GAP_RATIO;
  const barW = (slotW - gap) / seriesCount;
  const bottom = plotBottom(box);
  const out: BarBox[] = [];
  data.forEach((d, di) => {
    for (let si = 0; si < seriesCount; si += 1) {
      const v = d.values[si] ?? 0;
      const h = max > 0 ? (v / max) * plotH : 0;
      out.push({ x: box.x + di * slotW + gap / 2 + si * barW, y: bottom - h, w: barW, h, series: si, datum: di });
    }
  });
  return out;
}

/** One polyline per series, points evenly stepped across the width. */
export function linePoints(box: Box, data: ChartDatum[], seriesCount: number): { x: number; y: number }[][] {
  if (data.length === 0 || seriesCount < 1) return [];
  const max = maxValue(data);
  const plotH = box.h - CHART_LABEL_H;
  const bottom = plotBottom(box);
  const step = data.length > 1 ? box.w / (data.length - 1) : 0;
  return Array.from({ length: seriesCount }, (_, si) =>
    data.map((d, di) => ({
      x: box.x + (data.length > 1 ? di * step : box.w / 2),
      y: bottom - (max > 0 ? ((d.values[si] ?? 0) / max) * plotH : 0),
    })));
}

/** Slice angles (radians from 12 o'clock, clockwise) for the FIRST series. Zero total → nothing. */
export function donutSlices(values: number[]): { start: number; end: number }[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return [];
  let acc = 0;
  return values.map((v) => {
    const start = (acc / total) * Math.PI * 2;
    acc += Math.max(0, v);
    return { start, end: (acc / total) * Math.PI * 2 };
  });
}

const polar = (cx: number, cy: number, r: number, angle: number): [number, number] =>
  [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];

/** Draw the chart into `r` (POINTS). Bound-with-error is the caller's placeholder, never ours. */
export function drawChart(doc: Doc, el: DesignElement, r: Box, resolved: ResolvedTable | undefined): void {
  const data = chartData(el, resolved);
  const bound = Boolean(el.dataSource && resolved && 'rows' in resolved);
  const seriesCount = bound ? Math.max(1, (el.valueColumns ?? []).length) : 1;
  const type = el.chartType ?? 'bar';
  const colorFor = (si: number): string => (bound ? CHART_COLORS[si % CHART_COLORS.length] : SAMPLE_FILL);

  doc.save();
  if (type === 'donut') {
    const values = data.map((d) => d.values[0] ?? 0);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const radius = Math.max(4, Math.min(r.w, r.h) / 2 - 6);
    const thickness = Math.max(3, radius * 0.4);
    const slices = donutSlices(values);
    if (slices.length === 0) {
      doc.lineWidth(thickness).strokeColor(SAMPLE_FILL).circle(cx, cy, radius - thickness / 2).stroke();
    } else {
      slices.forEach((s, i) => {
        // A tiny angular inset keeps neighbouring strokes from overpainting each other's ends.
        const inset = Math.min(0.02, (s.end - s.start) / 4);
        const [sx, sy] = polar(cx, cy, radius - thickness / 2, s.start + inset);
        const [ex, ey] = polar(cx, cy, radius - thickness / 2, s.end - inset);
        const large = s.end - s.start > Math.PI ? 1 : 0;
        doc.lineWidth(thickness).strokeColor(CHART_COLORS[i % CHART_COLORS.length])
          .path(`M ${sx} ${sy} A ${radius - thickness / 2} ${radius - thickness / 2} 0 ${large} 1 ${ex} ${ey}`)
          .stroke();
      });
    }
  } else if (type === 'line') {
    const series = linePoints(r, data, seriesCount);
    doc.lineWidth(0.5).strokeColor(AXIS_COLOR)
      .moveTo(r.x, plotBottom(r)).lineTo(r.x + r.w, plotBottom(r)).stroke();
    series.forEach((pts, si) => {
      if (pts.length === 0) return;
      doc.lineWidth(LINE_W).strokeColor(colorFor(si));
      pts.forEach((p, i) => (i === 0 ? doc.moveTo(p.x, p.y) : doc.lineTo(p.x, p.y)));
      doc.stroke();
      pts.forEach((p) => doc.circle(p.x, p.y, DOT_R).fill(colorFor(si)));
    });
  } else {
    doc.lineWidth(0.5).strokeColor(AXIS_COLOR)
      .moveTo(r.x, plotBottom(r)).lineTo(r.x + r.w, plotBottom(r)).stroke();
    for (const b of barLayout(r, data, seriesCount)) {
      if (b.h > 0) doc.rect(b.x, b.y, b.w, b.h).fill(colorFor(b.series));
    }
  }

  // Category labels under the plot (donut labels its slices poorly at small sizes; it gets none —
  // the bound columns' names are in the design, and a legend waits for someone to miss it).
  if (type !== 'donut') {
    const slotW = data.length > 0 ? r.w / data.length : r.w;
    doc.font('Helvetica').fontSize(LABEL_FONT_PT).fillColor(LABEL_COLOR);
    data.forEach((d, i) => {
      doc.text(d.label, r.x + i * slotW, plotBottom(r) + 2, {
        width: slotW, align: 'center', height: CHART_LABEL_H, ellipsis: true, lineBreak: false,
      });
    });
  }
  doc.restore();
}
