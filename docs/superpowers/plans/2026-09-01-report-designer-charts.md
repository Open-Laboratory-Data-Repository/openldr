# Report Designer Charts (Slice D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One new element kind, `chart` (bar, line, donut), bound like a table and drawn as vector shapes in the PDF.

**Architecture:** Schema gains `chartType` and `valueColumns`; the category labels reuse `labelColumn`. Colors are renderer-owned presentational constants (a print-safe categorical list beside `TEXT_COLOR`), never clinical and not yet a schema field — a palette option waits for someone to ask. Geometry lives in pure exported helpers in a new `render/chart.ts` so capacity is testable through `toPt` the way the px-vs-pt memory demands; `drawChart` consumes those helpers. A chart draws once per design page with text semantics (repeats on chunks, `showOn` available), participates in flow via the existing `drawnHeight` default, and exports to Excel as a rows sheet.

**Spec:** `docs/superpowers/specs/2026-09-01-report-designer-authoring-catchup-design.md` (Slice D).

## Global Constraints

As slices A to C, plus: every chart layout constant is POINTS; any capacity assertion converts the rect with `toPt` FIRST and must fail when the box shrinks; goldens for existing designs stay untouched; the final look is judged by rendering a PDF and looking at it, not by green suites.

## Tasks

### Task 1: schema and model
`ELEMENT_KIND_VALUES` gains `'chart'` (schema.ts — the comment there says which three sites the compiler then forces: icon map, default names, canvas switch). New optional fields `chartType: z.enum(['bar','line','donut'])` and `valueColumns: z.array(z.string())`. Studio `DEFAULT_NAME`, `KIND_ICON` (BarChart3), Insert default (`{x:48,y:48,w:480,h:200}`, chartType 'bar'), i18n `element.chart` in en, fr, pt. Failing tests first in schema.test.ts and model.test.ts; the compiler errors are the checklist.

### Task 2: renderer
`render/chart.ts`: pure `barLayout`, `linePoints`, `donutSlices` over `(boxPt, labels, values)` — every output inside the box, proportional to values, degenerate inputs (no rows, zero max, negative clamped to 0) return empty layouts rather than NaN. `CHART_COLORS`: a fixed print-safe categorical list. `drawChart(doc, el, boxPt, resolved)`: axis baseline, bars/line/arcs, category labels at 6pt, a small legend for donut. Bound with rows draws data; bound with `{error}` uses the existing red placeholder; unbound draws three sample bars so the shape is visible. Wire the `chart` case into `drawElement`'s switch. Tests: geometry units (including a shrunk-box test proven to fail before the fix), a render test that a chart design produces a parseable PDF, golden untouched. Rasterize one chart PDF with the scratchpad rasterizer and LOOK before calling this task done.

### Task 3: canvas preview and properties
`ChartPreview` in PageCanvas (shape-only, like `CellGridPreview`: bars/line/donut sketch from `chartType`, never invented data values). Properties branch: Type select, `labelColumn` Input, `valueColumns` list editor (the cellgrid editor's shape). Data tab: add `'chart'` to `BINDABLE_KINDS` with the same query-and-sort treatment as cellgrid and a note that columns are set in Properties. i18n keys in three languages. Component tests per control.

### Task 4: Excel export and page counts
`exportDesignToExcel` includes chart elements as sheets (bound: query rows under `res.columns`; unbound: nothing to export contributes). `fetchResolvedTables` already covers charts via `dataSource` — add a test proving a chart element gets its rows. Tests first.

### Task 5: gate, smoke, docs, merge
Full gate; live smoke with the bypass procedure: build a bar chart on a copy design over a seeded query, preview, download the PDF, rasterize and look; docs bullet (steps + element list already name kinds — extend); mobile spot check; merge `--no-ff`, changelog, push, confirm SHA.

## Scope cuts, stated
No series-color schema field, no axes with tick arithmetic beyond baseline and max label, no stacked or grouped multi-series bars (multi `valueColumns` render side by side for bar and as separate lines for line; donut uses the FIRST value column only and says so in the Properties hint). Charts never chunk.
