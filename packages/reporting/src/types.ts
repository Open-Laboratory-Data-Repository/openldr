import type { ReportParamFormat } from '@openldr/core/pure';

export type ChartHint =
  | { type: 'bar'; x: string; y: string; series?: string }
  | { type: 'line'; x: string; y: string; series?: string }
  | { type: 'pie'; label: string; value: string }
  | { type: 'stat'; value: string; label: string };

// Free-form category id (references the global, editable report-category list — see
// report-category.ts's ReportCategoryEntry/ReportCategoryListSchema). Was a hardcoded enum.
export type ReportCategory = string;

export interface ReportParamMeta {
  id: string;
  label: string;
  type: 'daterange' | 'select' | 'text';
  required: boolean;
  /** Key into the report's options() result, for type 'select'. */
  optionsKey?: string;
  /** Operator-facing note on what the field accepts. Rendered as a tooltip beside the label. */
  help?: string;
  /** The shape the run value must have. Enforced SERVER-side before the query is built (see
   *  `createDataDrivenReporting` in `packages/bootstrap/src/index.ts`); published here only so a
   *  client can say the same thing sooner. Absent ⇒ the value is not checked. */
  format?: ReportParamFormat;
  /** Example text for the empty input. Absent ⇒ the box falls back to showing the label, exactly
   *  as it did before this field existed. */
  placeholder?: string;
}

export interface ReportMetricMeta {
  id: string;
  label: string;
  type: 'count' | 'sum' | 'avg' | 'pct';
  /** Column the metric is computed over (sum/avg/pct). */
  column?: string;
  /** For pct: the value to match against `column`. */
  match?: string;
}

export interface ReportColumn {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'percent' | 'date';
  decimals?: number;
}

export interface ReportResultData {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  chart: ChartHint;
}

export interface ReportResult extends ReportResultData {
  meta: { generatedAt: string; rowCount: number };
}

export interface ReportSummary {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;
  parameters: ReportParamMeta[];
  summaryMetrics?: ReportMetricMeta[];
  source?: 'catalog' | 'design';
  /** For source==='design': the linked report-designer template id, for a studio deep-link. */
  designId?: string;
}
