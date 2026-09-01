# Report designer: author what the engine already does

Date: 2026-09-01. Status: awaiting operator review. Spec 1 of 3.

## Problem

The PDF engine is ahead of the editor. The best report in the product
(`rt-transmission-grid`) uses `cellgrid`, `flowAfter`, `fillTo`, `showOn`, `showWithTable`,
`headerRow`, `sortBy` and `transpose`. None of these can be authored in the studio. They
were written by an AI editing design JSON. A person cannot reproduce that report today.

Proof the gap is real, per field:

- `cellgrid` is deliberately excluded from Insert: `apps/studio/src/report-designer/model.ts:16`.
- No Properties or Data control writes `flowAfter`, `flowGap`, `fillTo`, `showOn`,
  `showWithTable`, `headerRow`, `sortBy`, `transpose`, `groupBoundary`, `labelColumn`,
  `cellColumns`, `trailingColumns`, or `statusKey`-on-trailing. Grep of
  `apps/studio/src/report-designer/*.tsx` finds them only in `PageCanvas` previews.
- The keyvalue layout Select offers `inline` and `stacked` only
  (`PropertiesTab.tsx:315`). The schema and the transmission grid also use `stat`.
- Page count is invisible until export. The canvas shows one idealized page.

## Goal

A person can rebuild `rt-transmission-grid` from a blank design using only the UI, and can
see how many physical pages a design prints as before exporting. Plus one new element
kind: charts.

## Non-goals

- No renderer behavior changes, except the chart element (slice D) and honoring `hidden`.
- No new binding model. `dataSource` plus a Custom Query stays the only way.
- Nothing from spec 2 (new features) or spec 3 (template fixes).

## Slice A: expose the existing fields

**Insert menu.** Add Cell grid to `ELEMENT_KINDS`. The old reason for excluding it
(useless without data config) dies in this slice, because the config becomes authorable.
Default insert: an unbound grid with 5 `cellColumns`, `palette {ramp:'blue', steps:1}`.

**Properties tab, new Flow section** on every element:

- Place below: Select over the other element ids on the same page, writes `flowAfter`.
  Empty option clears it. Show the element's `name`, never the id.
- Gap: NumberField, writes `flowGap`. Disabled until Place below is set (schema says it
  is inert without `flowAfter`).
- First page only: Checkbox, writes `showOn: 'first-chunk'`.
- Show with: Select over table and cellgrid elements on the page, writes `showWithTable`.
- Fill to bottom of box: Checkbox, cellgrid only, writes `fillTo: 'rect-bottom'`.
- The cycle rule: the renderer throws on a `flowAfter` cycle (schema.ts:212). The UI must
  refuse to offer options that close a cycle, not rely on the render error.

**Properties tab, per-kind additions:**

- keyvalue: add `stat` to the layout Select.
- table: Transpose checkbox plus `transposeLabel` Input. When transpose is on, hide the
  bound-columns editor and show the same data-derived-header note the canvas shows
  (a transposed table must leave `boundColumns` empty, schema.ts:133).
- cellgrid: labelColumn Input, cellColumns list editor (add, remove, reorder), palette
  steps NumberField (1 to 5), group-boundary Checkbox, trailingColumns editor
  (key, label, width, optional statusKey and emphasis).

**Data tab additions** for bound elements:

- Sort by: Input, writes `sortBy`. Help text: why the query's own ORDER BY is not enough
  (schema.ts:143).
- First data row is the header: Checkbox, writes `headerRow`. Disabled with an
  explanation until `sortBy` is set. The API already refuses the broken pair
  (`packages/report-designer/src/header-row.ts`), the UI must not let you reach that 400.
- Per-column statusKey and emphasis already exist. Leave them.

## Slice B: show the pages

A page strip above the canvas: one thumbnail box per physical page, a label
"Prints as N pages", and a dashed line on the canvas where page 1 ends.

The pagination math lives in `render/draw.ts` and `render/cellgrid.ts`, which sit behind
the Node-only barrel (pdfkit import). The studio cannot import it.

Design: extract the pure chunk arithmetic (`maxRowsFor`, `tableChunkCount`,
`pageChunkCount`, `cellGridRowSchedule`, and the flow resolution they depend on) into a
new pdfkit-free module exported from `/pure`. The render barrel re-exports it so nothing
downstream moves. HONEST NON-PROOF: I have read these functions' call sites but have not
proven the extraction has no pdfkit tangle. Task one of the plan is that falsification.

Page count needs row counts, and row counts are data. The strip therefore has two states:

- Unbound or unloaded: "Prints as at least 1 page" and no dashed line. Never guess.
- After the author presses the existing Load columns (or a new Count rows action that runs
  each bound query with `limit` paging the way `exportExcel.ts` already does): real counts,
  real chunk math, real dashed line and strip.

The count is a snapshot and says so in the UI ("as of last load").

## Slice C: canvas comfort

- Lock and hide per element. Two new optional schema fields, `locked` and `hidden`.
  `locked`: canvas refuses drag, resize, and delete; renderer ignores it. `hidden`:
  canvas dims the row and hides the element; the renderer SKIPS it, because a hidden
  layer that still prints is a lie. Both opt-in and inert when unset, with a golden test
  proving an old design renders byte-identical.
- Duplicate element (kebab and Ctrl+D), pasted 12px offset, one undo step.
- Copy and paste elements, including across pages of the same design.
- Drag to reorder the Layers list (z-order). Radix-friendly pointer events; remember the
  jsdom PointerEvent polyfill notes in the workstream memory.

## Slice D: charts

New element kind `chart`. One kind, a `chartType` field: `bar`, `line`, `donut`.

- Schema: `chartType`, `labelColumn` (reuse), `valueColumns: string[]` (new, or reuse
  `cellColumns`; decide in the plan after checking name collisions), palette reusing
  `CELL_RAMPS`. Colors are presentational ramps, never clinical meaning (AGENTS.md §8,
  and the CELL_STATUSES comment in schema.ts:53).
- Renderer: pure pdfkit vector drawing in a new `render/chart.ts`, like `cellgrid.ts`.
  pdfkit embeds only JPEG and PNG images, so charts are drawn, not pasted
  (see the pdfkit-draws-jpeg-png-only memory).
- Unit discipline: every layout constant in points, capacity assertions go through
  `toPt` first, and each test must fail when the box shrinks. This is the trap that
  shipped a clipped keyvalue row past a green test (report-designer-px-vs-pt-units memory).
- Canvas: a shape-only preview like `CellGridPreview` (PageCanvas.tsx:311). It draws the
  shape from config, never invented data.
- Data tab: binds like a table. Query, label column, value columns.
- Pagination: a chart never chunks. It draws once per design page like text does, and
  participates in `flowAfter` like any element.
- Excel export: a chart element exports its bound rows as a sheet, same as a table.

## Testing

- Studio: component tests per new control, writing the exact schema field. The suite
  proves the UI writes the fields; it does not prove the PDF is right.
- Renderer (slice D): draw.test-style unit tests plus a golden test. Then render a PDF
  with the scratchpad rasterizer (pdfjs-dist@6.0.227 plus @napi-rs/canvas@1.0.0, white
  background first) and look at it. That step is mandatory, not ceremony.
- The rebuilt-by-hand transmission grid is the acceptance test for slice A: author it in
  the UI, export, compare against the seeded design's PDF.
- pg-mem proves none of this. Say so in each task's notes.

## Definition of done (AGENTS.md §6)

UI, docs in en, fr and pt (every new label is an i18n key in all three or it renders as
braces), mobile pass at 375x812 with the dvh caveat stated, `pnpm make:changelog` in the
landing slice. CLI parity: not applicable, this is an authoring surface, stating that here
per the rule.

## Open questions for the operator

1. Slice order fine? A, B, C, D as separate merges to local main.
2. Chart types: bar, line, donut enough for round one?
