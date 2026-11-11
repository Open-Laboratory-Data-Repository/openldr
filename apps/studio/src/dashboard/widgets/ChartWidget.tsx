import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  ScatterChart, Scatter, FunnelChart, Funnel, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { ReportResult, WidgetConfig } from '../../api';
import { numericRows, shapeChart } from './chartData';

const COLORS = ['#4682B4', '#5A9BD6', '#22c55e', '#f59e0b', '#ef4444', '#898989'];

// Recharts' default Tooltip renders an opaque white box (and a light hover cursor), which
// reads as a stray white rectangle in dark mode — especially on empty charts. Theme it.
const TOOLTIP_PROPS = {
  contentStyle: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 12 },
  labelStyle: { color: 'var(--text-muted)' },
  itemStyle: { color: 'var(--text)' },
  cursor: { fill: 'var(--border)', fillOpacity: 0.15 },
} as const;

export function ChartWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  // No data → render an empty-state message instead of an axes-only chart whose hover
  // cursor/tooltip would otherwise flash a white box.
  if (!result.rows || result.rows.length === 0) {
    return <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">No data</div>;
  }
  const x = (config.visual.xAxisKey as string) ?? 'label';
  const y = (config.visual.yAxisKey as string) ?? 'value';
  const size = config.visual.sizeKey as string | undefined;
  const raw = result.rows as Record<string, unknown>[];
  // A scatter plot measures on both axes, so it keeps its rows as they are, with numbers fixed.
  const scatterRows = numericRows(raw, [x, y, ...(size ? [size] : [])]);
  // A Builder Breakdown adds a `series` column: one row per (label, series).
  const hasSeries = (result.columns ?? []).some((c) => c.key === 'series');
  const { data: rows, series } = shapeChart(config.type, raw, x, y, hasSeries);
  const color = (config.visual.color as string) ?? 'var(--brand)';
  // One series keeps the widget's own color. Several take the palette, with a legend to tell them apart.
  const seriesColor = (i: number) => (series.length === 1 ? color : COLORS[i % COLORS.length]);
  const legend = series.length > 1 ? <Legend /> : null;
  switch (config.type) {
    case 'line-chart':
      return <ResponsiveContainer><LineChart data={rows}><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip {...TOOLTIP_PROPS} />{legend}{series.map((s, i) => <Line key={s} type="monotone" dataKey={s} stroke={seriesColor(i)} />)}</LineChart></ResponsiveContainer>;
    case 'area-chart':
      return <ResponsiveContainer><AreaChart data={rows}><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip {...TOOLTIP_PROPS} />{legend}{series.map((s, i) => <Area key={s} type="monotone" dataKey={s} stroke={seriesColor(i)} fill={seriesColor(i)} fillOpacity={0.3} />)}</AreaChart></ResponsiveContainer>;
    case 'row-chart':
      return <ResponsiveContainer><BarChart data={rows} layout="vertical"><CartesianGrid stroke="var(--border)" /><XAxis type="number" stroke="var(--text-muted)" /><YAxis type="category" dataKey={x} stroke="var(--text-muted)" /><Tooltip {...TOOLTIP_PROPS} />{legend}{series.map((s, i) => <Bar key={s} dataKey={s} fill={seriesColor(i)} />)}</BarChart></ResponsiveContainer>;
    case 'pie-chart':
      return <ResponsiveContainer><PieChart><Pie data={rows} dataKey={y} nameKey={x} outerRadius="80%" innerRadius={(config.visual.innerRadius as number) ?? 0} label>{rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip {...TOOLTIP_PROPS} /><Legend /></PieChart></ResponsiveContainer>;
    case 'scatter-plot':
      return <ResponsiveContainer><ScatterChart><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis dataKey={y} stroke="var(--text-muted)" /><ZAxis dataKey={(config.visual.sizeKey as string) ?? undefined} range={[40, 200]} /><Tooltip {...TOOLTIP_PROPS} /><Scatter data={scatterRows} fill={color} /></ScatterChart></ResponsiveContainer>;
    case 'funnel':
      return <ResponsiveContainer><FunnelChart><Tooltip {...TOOLTIP_PROPS} /><Funnel data={rows} dataKey={y} nameKey={x}>{rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Funnel></FunnelChart></ResponsiveContainer>;
    default:
      return <ResponsiveContainer><BarChart data={rows}><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip {...TOOLTIP_PROPS} />{legend}{series.map((s, i) => <Bar key={s} dataKey={s} fill={seriesColor(i)} />)}</BarChart></ResponsiveContainer>;
  }
}
