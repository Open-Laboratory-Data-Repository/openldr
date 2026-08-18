import { z } from 'zod';

export type ElementKind = 'text' | 'table' | 'image' | 'line' | 'rect' | 'datetime' | 'keyvalue' | 'barcode' | 'qrcode';
export type Paper = 'A4' | 'Letter';
export type Orientation = 'portrait' | 'landscape';
export type TextAlign = 'left' | 'center' | 'right';

export const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Rect = z.infer<typeof RectSchema>;

export const ElementStyleSchema = z.object({
  fontSize: z.number().optional(),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  color: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  fill: z.string().optional(),
});
export type ElementStyle = z.infer<typeof ElementStyleSchema>;

export const MarginsSchema = z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() });
export type Margins = z.infer<typeof MarginsSchema>;

export const DataSourceSchema = z.object({ kind: z.literal('custom-query'), queryId: z.string() });
export type DataSource = z.infer<typeof DataSourceSchema>;

/** Presentational cell states. Deliberately NOT clinical: the mapping from `R`/`UNDET`/`IND` to one
 *  of these belongs in the query, which is what lets one renderer serve AST, serology and chemistry. */
export const CELL_STATUSES = ['normal', 'abnormal', 'critical', 'indeterminate', 'none'] as const;
export type CellStatus = (typeof CELL_STATUSES)[number];
export type CellEmphasis = 'fill' | 'text';
export type ColumnKind = 'value' | 'range' | 'units' | 'flag' | 'label';

export const BoundColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Name of ANOTHER column in the same query result carrying a CellStatus token. */
  statusKey: z.string().optional(),
  /** How status is shown: a filled chip, or just coloured text. Defaults to 'text'. */
  emphasis: z.enum(['fill', 'text']).optional(),
  /** Drives alignment/width policy only. `range` and `units` never right-align. */
  kind: z.enum(['value', 'range', 'units', 'flag', 'label']).optional(),
});
export type BoundColumn = z.infer<typeof BoundColumnSchema>;

/** How a `keyvalue` pair arranges its label against its value. `inline` puts them side by side;
 *  `stacked` puts a small uppercase label above the value, for values too long to share a line. */
export type KeyValueLayout = 'inline' | 'stacked';

export const DesignElementSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'table', 'image', 'line', 'rect', 'datetime', 'keyvalue', 'barcode', 'qrcode']),
  name: z.string(),
  rect: RectSchema,
  /** text/datetime content; the OPTIONAL title of a `keyvalue` panel (no title when empty); and the
   *  static value of an UNBOUND `barcode`/`qrcode` (interpolated, so `{{param.x}}` works) */
  text: z.string().optional(),
  /** table column headers */
  columns: z.array(z.string()).optional(),
  /** table sample rows (looks-only); for an unbound `keyvalue`, `[label, value]` sample pairs */
  rows: z.array(z.array(z.string())).optional(),
  /** real table/keyvalue binding (configured in the Data tab) */
  dataSource: DataSourceSchema.optional(),
  /** picked/reordered/relabeled projection of the query's result columns.
   *  On a `keyvalue` element each entry is ONE label→value pair, valued from row 0. */
  boundColumns: z.array(BoundColumnSchema).optional(),
  /** `table`: flip the bound result so the query's COLUMNS become the rows and its first column's
   *  values become the headers.
   *
   *  For a matrix whose column count is fixed and large while its row count is small and
   *  data-driven, the natural orientation cannot fit a page at any font: the cumulative antibiogram
   *  is 29 drug columns wide, and 30 columns of `100% (12)` need ~840pt where landscape Letter has
   *  696pt. Transposed it is 29 rows by however many organisms cleared the isolate threshold, which
   *  fits with room to spare and prints every drug name in full.
   *
   *  Applied to the RESOLVED table, so headers, row chunking, column widths and cell statuses all
   *  derive from one flipped source and cannot disagree. A transposed table should leave
   *  `boundColumns` empty — the headers come from the data, not from the design. */
  transpose: z.boolean().optional(),
  /** Header for a transposed table's first column, which holds the ORIGINAL column labels
   *  (default `''`). The original header of that column describes the values that are now the
   *  headers, so it cannot be reused. */
  transposeLabel: z.string().optional(),
  /** Result column the bound rows are ordered by before anything draws them (ascending; numeric
   *  when every value parses as a number, otherwise a string compare; stable, so rows sharing a
   *  value keep the order the query returned them in).
   *
   *  ⛔ Exists because a stored query's own ORDER BY is not guaranteed to survive the runner.
   *  `planPagination` wraps every query as `select * from (<inner>) as _q limit N offset 0`
   *  (packages/dashboards/src/sql-runner.ts:56) and MySQL's optimizer may discard an ORDER BY
   *  inside a derived table. A design whose FIRST row is meaningful — the transmission grid's
   *  date row — would then print that row somewhere in the middle of the grid, with no error.
   *
   *  The column named here does NOT have to be bound: a sort discriminator is usually not a
   *  column of the report. */
  sortBy: z.string().optional(),
  /** `table`: the FIRST data row is this table's HEADER, not a body row.
   *
   *  For a grid whose columns are only known at RUN time — one column per working day of a
   *  requested month — the labels cannot be authored. They arrive as data, in a leading row the
   *  query emits and `sortBy` puts first. Without this flag that row is an ordinary body row: it
   *  prints once, on the first chunk, so page 2 onward shows marks under blank columns.
   *
   *  What it changes, all three because of one lift:
   *  - the row is drawn in the header band and REPEATS on every chunk, like any header;
   *  - it stops consuming a body slot, so the chunk arithmetic counts real rows;
   *  - a cell's NEWLINES become stacked header lines, and `columnWidths` measures the widest LINE
   *    rather than the whole string — which is what keeps a `2`/`Feb` column near the width of
   *    `Feb` instead of the width of `2 Feb`.
   *
   *  A column whose `boundColumns` label is non-blank KEEPS that label; only a blank one is filled
   *  from the row. The design states what it can know, the run supplies the rest, and query data
   *  can never overwrite an authored header.
   *
   *  ⛔ Opt-in, and inert when unset — a design without it renders byte-for-byte as before
   *  (`render/golden.test.ts`). */
  headerRow: z.boolean().optional(),
  /** Draw this element only on the physical chunks the NAMED table element on the same page
   *  actually fills.
   *
   *  A page with two tables is as long as the LONGER one (`pageChunkCount`). Without this, the
   *  shorter table's heading keeps printing on pages where that table has no rows left — a bold
   *  "…Data Submission by Testing Laboratory" over nothing, which reads as "no laboratory
   *  submitted", the opposite of the truth. The table itself is guarded without any declaration;
   *  this exists for the heading, rule or note that BELONGS to it.
   *
   *  Fails OPEN: naming an element that is not on the page draws normally. A dangling reference is
   *  a design defect, and silently deleting a heading everywhere would hide it. */
  showWithTable: z.string().optional(),
  /** `keyvalue` pair arrangement (default `inline`) */
  layout: z.enum(['inline', 'stacked']).optional(),
  /** `keyvalue` pairs side by side per line (default 1). Capped at 4 — beyond that a pair's share of
   *  an A4 width is narrower than its own label. */
  panelColumns: z.number().int().min(1).max(4).optional(),
  /** `barcode` human-readable text under the bars (default TRUE — standard on specimen labels, and
   *  what lets a human read the accession when a scanner is unavailable). */
  caption: z.boolean().optional(),
  /** presentational style (text/line/rect) */
  style: ElementStyleSchema.optional(),
  /** image source: a `data:` URI or an interpolation token (`{{lab.logo}}`), never a bare URL — a
   *  `https://…`/`http://…`/file-path source is refused at write (`image-src.ts`'s
   *  `validateImageSrc`) because pdfkit reads a URL image source as a file path and throws, so it
   *  would render fine on the studio canvas and silently vanish from the printed PDF. */
  src: z.string().optional(),
});
export type DesignElement = z.infer<typeof DesignElementSchema>;

export const DesignPageSchema = z.object({ id: z.string(), elements: z.array(DesignElementSchema).default([]) });
export type DesignPage = z.infer<typeof DesignPageSchema>;

export const DateRangeValueSchema = z.object({ from: z.string(), to: z.string() });
export type DateRangeValue = z.infer<typeof DateRangeValueSchema>;

export const TemplateParamSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'select', 'daterange']).optional(),
  required: z.boolean().optional(),
  value: z.union([z.string(), DateRangeValueSchema]).optional(),
  /** Operator-facing note on what the field accepts. Surfaced as ReportParamMeta.help. */
  help: z.string().optional(),
});
export type TemplateParam = z.infer<typeof TemplateParamSchema>;

export const ReportDesignSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  paper: z.enum(['A4', 'Letter']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  pages: z.array(DesignPageSchema).default([]),
  parameters: z.array(TemplateParamSchema).default([]),
  margins: MarginsSchema.optional(),
  /** opt-in "Page X of Y" footer on every physical page (default off) */
  pageNumbers: z.boolean().optional(),
  /** Authoring state. `draft` is the working copy; `published` is what labs mirror and what the
   *  reference-sync capture is gated on. Mirrors `form_definitions.status`. */
  status: z.enum(['draft', 'published']).default('draft'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ReportDesign = z.infer<typeof ReportDesignSchema>;
