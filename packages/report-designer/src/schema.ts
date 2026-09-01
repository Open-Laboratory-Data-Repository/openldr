import { z } from 'zod';
import type { ReportParamFormat } from '@openldr/core/pure';

/** The formats a run parameter may declare, as a zod-usable tuple.
 *
 *  `satisfies` is the guard that matters: it fails to compile if this list names a format
 *  `paramFormatMessage` does not implement. That direction is the dangerous one — an unimplemented
 *  format would fall off the validator's switch and reject every value the operator typed. */
const PARAM_FORMATS = ['timezone-no-signed-offset', 'year-month'] as const satisfies readonly ReportParamFormat[];

/**
 * Every element kind, and the ONLY place the list lives.
 *
 * ⛔ `ElementKind` used to be a hand-written union beside `DesignElementSchema`'s own `z.enum`, and
 * the two drifted the moment `cellgrid` was added: the enum accepted it, the union did not, and
 * anything typed `Record<ElementKind, ...>` silently stopped covering the real set. The studio's
 * layer icons and default names were both such records, so `KIND_ICON[el.kind]` stopped
 * type-checking and the canvas's `switch` lost its exhaustiveness — the compiler could no longer
 * tell anyone a kind was unhandled, which is exactly what it is for.
 *
 * Same `as const` + `z.enum` shape `CELL_STATUSES` and `CELL_RAMPS` already use in this file.
 * MEASURED after the change: adding a hypothetical kind here fails three sites at once, the icon
 * map, the default names and the canvas switch. Before it, it failed none of them.
 */
export const ELEMENT_KIND_VALUES = [
  'text', 'table', 'image', 'line', 'rect', 'datetime', 'keyvalue', 'barcode', 'qrcode', 'cellgrid', 'chart', 'letterhead',
] as const;
export type ElementKind = (typeof ELEMENT_KIND_VALUES)[number];
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
/** `fill` paints the whole cell; `chip` hugs the text in a pill (T5 — a full-width Resistant bar
 *  shouts); `text` just tints. In a keyvalue panel `chip` and `fill` coincide, because its fill
 *  already hugged the value. */
export type CellEmphasis = 'fill' | 'text' | 'chip';
export type ColumnKind = 'value' | 'range' | 'units' | 'flag' | 'label';

/** A conditional-formatting rule an author writes WITHOUT SQL: "when this column's value passes
 *  `op value`, mark it `status`". Compiled into the same presentational status tokens `statusKey`
 *  delivers, at projection — the drawing paths never change, and one mechanism serves both
 *  authoring routes. `statusKey` WINS when both exist: data that already carries judgment is not
 *  second-guessed by a display rule. Numeric compare when both sides parse as numbers, else string
 *  equality. The threshold is authored per design, never hardcoded in source (AGENTS.md §8). */
export const ColumnRuleSchema = z.object({
  op: z.enum(['gte', 'lte', 'eq', 'neq']),
  value: z.string(),
  status: z.enum(CELL_STATUSES),
});
export type ColumnRule = z.infer<typeof ColumnRuleSchema>;

export const BoundColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Name of ANOTHER column in the same query result carrying a CellStatus token. */
  statusKey: z.string().optional(),
  /** See ColumnRuleSchema. One rule per column; more thresholds wait for a symptom. */
  rule: ColumnRuleSchema.optional(),
  /** How status is shown: a filled chip, or just coloured text. Defaults to 'text'. */
  emphasis: z.enum(['fill', 'text', 'chip']).optional(),
  /** Drives alignment/width policy only. `range` and `units` never right-align. */
  kind: z.enum(['value', 'range', 'units', 'flag', 'label']).optional(),
  /** Fixed decimal places for values that parse as numbers (`65` and `23.7` in one column read as
   *  a mistake). Renderer-side because number-to-string SQL is where the three dialects stop
   *  agreeing (the transmission seed's own lesson). Non-numbers pass through untouched. */
  decimals: z.number().int().min(0).max(4).optional(),
});
export type BoundColumn = z.infer<typeof BoundColumnSchema>;

/** How a `keyvalue` pair arranges its label against its value. `inline` puts them side by side;
 *  `stacked` puts a small uppercase label above the value, for values too long to share a line;
 *  `stat` puts a large value ABOVE a small uppercase caption, one figure per box, for a panel a
 *  reader scans by number first. */
export type KeyValueLayout = 'inline' | 'stacked' | 'stat';

/** Sequential ramps a `cellgrid` may paint with. Presentational, not clinical: a `cellgrid` shows
 *  magnitude or presence, never a result state, so it deliberately does not reach for
 *  `CELL_STATUSES`. Keeping the two apart is what stops a submission grid inheriting the meaning of
 *  a red AST chip. */
export const CELL_RAMPS = ['blue'] as const;
export type CellRamp = (typeof CELL_RAMPS)[number];

export const CellPaletteSchema = z.object({
  ramp: z.enum(CELL_RAMPS),
  /** How many filled steps the ramp is quantised into. 1 makes the grid binary, which is the right
   *  choice when the data is presence/absence rather than a count. */
  steps: z.number().int().min(1).max(5),
});
export type CellPalette = z.infer<typeof CellPaletteSchema>;

/** A text column drawn AFTER a `cellgrid`'s run of cells. Width is DECLARED, not measured: the whole
 *  reason `cellgrid` exists is that measured widths cannot go below `MIN_COL_W`. */
export const TrailingColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Points. Declared so the element's total width is knowable without a Doc. */
  width: z.number().positive(),
  statusKey: z.string().optional(),
  /** See ColumnRuleSchema on BoundColumnSchema — same contract, statusKey wins. */
  rule: ColumnRuleSchema.optional(),
  emphasis: z.enum(['fill', 'text', 'chip']).optional(),
});
export type TrailingColumn = z.infer<typeof TrailingColumnSchema>;

export const DesignElementSchema = z.object({
  id: z.string(),
  kind: z.enum(ELEMENT_KIND_VALUES),
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
  /** `table`: append one bold totals row after the last body row. `label` sits in the first
   *  column; each column NAMED here gets the numeric sum of its values (unparseable values
   *  contribute nothing; a column with none stays blank), formatted by that column's `decimals`.
   *
   *  ⛔ The synthetic row travels through `bodyRowsFor`, so pagination counts it and the last
   *  chunk cannot overflow by one row — the drawing and the arithmetic read one source.
   *  ⛔ A TRANSPOSED table refuses totals at write time (`findTransposedTotals`, header-row.ts):
   *  summing across organisms is meaningless.
   *  ⛔ Opt-in, and inert when unset (`render/golden.test.ts`). */
  totals: z.object({ label: z.string(), columns: z.array(z.string()) }).optional(),
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
   *  ⛔ REQUIRES `sortBy` on a bound table, and the API refuses the pair being broken
   *  (`findUnsortedHeaderRows` in `header-row.ts`, called by POST/PUT `/api/report-designs`).
   *  This lifts row 0 of whatever the renderer was handed; only `sortBy` makes row 0 a KNOWN row.
   *  Set this alone and the page prints a laboratory's name as its date header, with no error.
   *  It is a write-time gate rather than a refinement here on purpose — see that file.
   *
   *  ⛔ Opt-in, and inert when unset. A design without it renders byte-for-byte as before
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
  /** Take this element's y from the NAMED element's own y plus the height that element actually
   *  drew on the current physical chunk, instead of the declared `rect.y`.
   *
   *  `showWithTable` answers "does this belong on this page"; this answers "where does it sit,
   *  given what the page before it actually drew." Without it, a follower's y is fixed forever at
   *  whatever gap fit page 1 — the `other` grid sat at a constant `rect.y` of 612px@96 while the
   *  `hvleid` grid above it, on continuation pages, had already finished and drew nothing. The gap
   *  a reader saw was not "no data": it was 380px@96 of paper `other` had no reason to leave
   *  blank, on every page after the first, turning a 2-page report into 4.
   *
   *  The height added is DRAWN, not declared — `toPt(el.rect).h` is the most an element may
   *  occupy, and a `cellgrid`/`table` almost never fills it. A target that draws nothing on a
   *  chunk (its rows ran out on an earlier page) contributes zero, and the follower moves up to
   *  take its place. A target that FAILED (query error) keeps its full declared height on every
   *  chunk, matching the placeholder box it actually paints every time.
   *
   *  ⛔ Fails OPEN, same contract `showWithTable` documents: a name that is not on the page draws
   *  at its own declared `rect.y`. A dangling reference is a design defect, not a reason to jump
   *  the element somewhere unrelated.
   *
   *  ⛔ A cycle — including a straight self-reference — THROWS instead of looping. A page has
   *  finitely many elements, so resolving this can only end one of three ways: a target with no
   *  `flowAfter`, a target not on the page, or an id already visited on this same resolution. The
   *  third case is a design defect loud enough that rendering must stop, not one page quietly
   *  never finishing.
   *
   *  ⛔ Opt-in, and inert when unset. A design without it renders byte-for-byte as before
   *  (`render/golden.test.ts`). */
  flowAfter: z.string().optional(),
  /** `cellgrid` only: end this element at its DECLARED BOTTOM EDGE (`rect.y + rect.h`) on every
   *  chunk, taking whatever height `flowAfter` freed above it, instead of carrying its authored
   *  height around.
   *
   *  `flowAfter` moves an element's TOP. Without this, its CAPACITY never moved with it: the
   *  `other` grid on `rt-transmission-grid` started higher on every continuation page and still held
   *  the 21 records its authored 285pt box allowed, so the blank band a reader saw simply moved from
   *  the top of the page to the bottom, and the report still spent 4 pages on 2 pages of grid.
   *
   *  ⛔ Capacity then DIFFERS PER PAGE. A full grid above on page 1, finished grid contributing
   *  and nothing on page 3, so the chunk count stops being `ceil(records / perPage)` and becomes a loop
   *  that consumes records page by page. `cellGridRowSchedule` (`render/cellgrid.ts`) is that loop
   *  and is the only place it lives: the chunk count, the drawn height and the drawn slice all read
   *  the same array, because two of them disagreeing by one row makes a laboratory vanish from the
   *  report or print twice, with no error anywhere.
   *
   *  ⛔ Fails OPEN, like `flowAfter`: asked with no page context around it, the element falls back to
   *  its declared height. Every render path supplies the context.
   *
   *  ⛔ Opt-in, and inert when unset. A design without it renders byte-for-byte as before
   *  (`render/golden.test.ts`). */
  fillTo: z.literal('rect-bottom').optional(),
  /** Draw this element on the FIRST physical chunk of its design page and on no other.
   *
   *  A design page repeats every element on every chunk it runs to. The letterhead should repeat. A
   *  month-wide summary band above a continuation page should not: it costs its own height on every
   *  later page and restates figures the reader already has on page 1.
   *
   *  ⛔ Checked BEFORE `drawsOnChunk`'s table/cellgrid short-circuit. A bound element answers that
   *  question from its own chunk count, so a `cellgrid` declaring this would otherwise ignore it,
   *  and a bound calendar is the element the flag exists for.
   *
   *  ⛔ An element hidden this way also contributes ZERO height to a `flowAfter` follower, so the
   *  block below it moves up and takes the space instead of leaving a hole the size of the band.
   *  That is deliberately NOT extended to `showWithTable`: a follower's own pagination depends on
   *  its y, its y depends on the target's height, and a `showWithTable` target's visibility depends
   *  on the follower's chunk count. Measuring it there would be a cycle. Nothing needs it today,
   *  because a `showWithTable` heading is hidden exactly when the block it names is hidden too.
   *
   *  ⛔ Opt-in, and inert when unset. A design without it renders byte-for-byte as before
   *  (`render/golden.test.ts`). */
  showOn: z.literal('first-chunk').optional(),
  /** Space in px@96 left BETWEEN the element named by `flowAfter` and this one, on top of the
   *  height that element actually drew.
   *
   *  `flowAfter` puts a follower flush against the block above it, which is right for a heading and
   *  its own table and wrong between two sections: the second grid's heading sat hard against the
   *  last row of the first, and on a page where the first grid was empty it landed on top of its
   *  header band.
   *
   *  ⛔ Inert without `flowAfter`. It describes the space after the thing this element follows, and
   *  with nothing to follow there is no such space. It is NOT a top margin.
   *
   *  ⛔ px@96, like every other coordinate on a design, converted with `PX_TO_PT` at resolution.
   *  Declaring it in points would make it the only length here that is not. */
  flowGap: z.number().nonnegative().optional(),
  /** `cellgrid`: result column holding each row's label. Omit for a grid with no label column, such
   *  as a month calendar whose position already says which day a cell is. */
  labelColumn: z.string().optional(),
  /** `cellgrid`: result columns drawn as cells, in order. */
  cellColumns: z.array(z.string()).optional(),
  /** `cellgrid`: insert a wider gap wherever the GROUP ROW's token changes.
   *
   *  The group row is data (row 1 of the sorted result, after the header row), never a design
   *  constant, because the grouping a month needs is not knowable when the design is authored. A
   *  month starting mid-week has a short first group, and every month has a different one.
   *
   *  ⛔ NOT `groupBy`. That name takes a column key everywhere else in this repo
   *  (`packages/workflows/src/engine/node-handlers/pivot.ts`,
   *  `packages/dashboards/src/compile.ts`), and this takes neither a column nor a key. The value is
   *  `token-change` rather than `header-change` for the same kind of reason: the tokens live in
   *  their own row, and naming the header would send a reader to the wrong one. */
  groupBoundary: z.literal('token-change').optional(),
  /** `cellgrid`: how a cell value becomes a fill. */
  palette: CellPaletteSchema.optional(),
  /** `cellgrid`: text columns drawn after the cells. */
  trailingColumns: z.array(TrailingColumnSchema).optional(),
  /** `keyvalue` pair arrangement (default `inline`) */
  layout: z.enum(['inline', 'stacked', 'stat']).optional(),
  /** `keyvalue` pairs side by side per line (default 1). Capped at 4 — beyond that a pair's share of
   *  an A4 width is narrower than its own label. */
  panelColumns: z.number().int().min(1).max(4).optional(),
  /** `barcode` human-readable text under the bars (default TRUE — standard on specimen labels, and
   *  what lets a human read the accession when a scanner is unavailable). */
  caption: z.boolean().optional(),
  /** `chart` only: the shape drawn (default `bar`). Series colors are renderer-owned presentational
   *  constants, deliberately not authored here — a palette field waits for someone to need one, and
   *  nothing clinical may ever ride on a color (AGENTS.md §8). */
  chartType: z.enum(['bar', 'line', 'donut']).optional(),
  /** `chart` only: result columns plotted as series, in order. Category labels come from
   *  `labelColumn`, shared with `cellgrid`. A donut uses the FIRST entry only. */
  valueColumns: z.array(z.string()).optional(),
  /** Authoring-only: the canvas refuses move, resize and delete on a locked element. The renderer
   *  ignores it entirely — a locked letterhead still prints. Opt-in and inert when unset. */
  locked: z.boolean().optional(),
  /** The element is ABSENT: it draws nothing, adds no physical pages, and contributes zero height
   *  to a `flowAfter` follower (the block below moves up, the `showOn` contract). It keeps its id,
   *  so flow references to it resolve rather than dangle. Opt-in and inert when unset. */
  hidden: z.boolean().optional(),
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
  /**
   * The shape the RUN value must have, checked when the report runs — see
   * `paramFormatMessage` (`packages/core/src/param-format.ts`).
   *
   * ⛔ Optional, and NOT a refinement. `fromRow` (`./store.ts`) parses every stored design through
   * `ReportDesignSchema` on READ, so a refinement here would run on read too and make an existing
   * design permanently unopenable — the same trap `image-src.ts` documents. This field only
   * DECLARES the format; the check happens at run time on the value, never on the design.
   *
   * A parameter that omits it is not checked at all, which is every parameter authored before this
   * existed.
   *
   * ⛔ `.catch(undefined)` is not decoration — it is the read-time escape hatch, and it was added
   * because the hazard was MEASURED, not imagined. A dev install's `report_designs` row already
   * held the earlier spelling of a format name (`iana-timezone`, renamed once the rule behind it
   * changed). Without this, `fromRow` parsing that stored row throws and the design becomes
   * permanently unopenable — the exact failure `image-src.ts` documents. With it, an unrecognised
   * format silently becomes "no declared format", which FAILS OPEN to the pre-existing behaviour
   * (the value simply is not checked) and is corrected on the next seed. It generalises: any
   * future rename of a format is survivable, not just this one.
   */
  format: z.enum(PARAM_FORMATS).optional().catch(undefined),
  /** Example text shown INSIDE the empty box (`ReportParametersBar`). Distinct from `help`, which
   *  lives in a ⓘ popover the operator has to open. The transmission grid's month was typed as `1`
   *  and its time zone as `+3` while both formats sat unread in that popover. */
  placeholder: z.string().optional(),
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
