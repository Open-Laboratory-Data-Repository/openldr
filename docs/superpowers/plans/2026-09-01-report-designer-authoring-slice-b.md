# Report Designer Authoring Catch-up, Slice B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The designer shows how many physical pages a design prints as, and where page 1 ends, before anyone exports.

**Architecture:** The spec's open risk is resolved: `render/draw.ts` has NO runtime pdfkit import (only the ambient `PDFKit.PDFDocument` type at draw.ts:13; the sole runtime import sits in `render/index.ts:1`). So the chunk math (`pageChunkCount`, `totalPhysicalPages`, `elementChunkCount`, `drawsOnChunk`, `resolveFlowY`, and `cellgrid.ts` helpers) is already browser-safe and needs EXPORT WIRING, not extraction. A new `render/pagination.ts` owns the `ResolvedTable` type and re-exports the math; `pure.ts` re-exports it; the studio fetches bound rows the way `exportExcel.ts` already does and feeds the same math the renderer uses.

**Tech Stack:** TypeScript, vitest, React, shadcn. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-01-report-designer-authoring-catchup-design.md` (Slice B section).

## Global Constraints

- Same as slice A: shadcn only; i18n keys in en, fr AND pt; discrete vs coalesced patch opts; no `Co-Authored-By`; gate via `pnpm turbo run test --concurrency=4`, never through `tail`.
- The page count is a SNAPSHOT of the last load. The UI must say so and must never guess a count it has no data for.
- Zero renderer behavior change: `render/golden.test.ts` must pass untouched.

## File Structure

- Create: `packages/report-designer/src/render/pagination.ts` (type home + re-export surface)
- Modify: `packages/report-designer/src/render/index.ts` (ResolvedTable moves; re-export for compatibility)
- Modify: `packages/report-designer/src/render/draw.ts` (type import source only)
- Modify: `packages/report-designer/src/pure.ts`
- Create: `apps/studio/src/report-designer/pageCounts.ts` (fetch bound rows + compute counts and break offsets)
- Modify: `apps/studio/src/report-designer/exportExcel.ts` (extract the shared row-fetch)
- Create: `apps/studio/src/report-designer/PageStrip.tsx`
- Modify: `apps/studio/src/report-designer/ReportDesignerPage.tsx`, `PageCanvas.tsx`
- i18n: en, fr, pt

Branch: `feat/report-designer-page-strip`, merged to local `main` with `--no-ff`.

---

### Task 1: `render/pagination.ts` and the pure export

**Files:**
- Create: `packages/report-designer/src/render/pagination.ts`
- Modify: `packages/report-designer/src/render/index.ts:6` (ResolvedTable), `render/draw.ts:5` (type import), `src/pure.ts`
- Test: `packages/report-designer/src/render/pagination.test.ts`

**Interfaces:**
- Produces: `ResolvedTable` (moves here; `render/index.ts` re-exports it so no consumer changes), and re-exports of `pageChunkCount(page, resolved)`, `totalPhysicalPages(pages, resolved)`, `elementChunkCount(el, resolved, flow)`, `drawsOnChunk(el, page, resolved, chunk)`, `resolveFlowY(el, page, resolved, chunk)`, `rowsFor(el, resolved)`, plus `maxRowsFor`/`ROW_H` from draw.ts (export them from draw.ts if not already) and `cellGridRowSchedule`/`cellGridMaxRows`/`CELL_HEAD_H`/`CELL_ROW_H` from cellgrid.ts.

- [ ] **Step 1: Write the failing test**

```ts
// pagination.test.ts — imports ONLY via the pure barrel, which is the whole point
import { pageChunkCount, totalPhysicalPages, type ResolvedTable } from '../pure';

it('counts chunks for an overflowing table through the pure barrel', () => {
  const el = { id: 't', kind: 'table' as const, name: 't', rect: { x: 0, y: 0, w: 400, h: 120 },
    dataSource: { kind: 'custom-query' as const, queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] };
  const rows = Array.from({ length: 40 }, (_, i) => ({ a: String(i) }));
  const resolved = new Map<string, ResolvedTable>([['t', { columns: [{ key: 'a', label: 'A' }], rows }]]);
  const page = { id: 'p', elements: [el] };
  expect(pageChunkCount(page, resolved)).toBeGreaterThan(1);
  expect(totalPhysicalPages([page], resolved)).toBe(pageChunkCount(page, resolved));
});
```

Import path note: inside the package, `../pure` IS the `./pure` subpath consumers use.

- [ ] **Step 2: Run, expect FAIL** (`pageChunkCount` not exported from pure)

- [ ] **Step 3: Implement**

`pagination.ts` defines `ResolvedTable` (moved verbatim from index.ts:6-8) and re-exports the names above from `./draw` and `./cellgrid`. `index.ts` replaces its local type with `export type { ResolvedTable } from './pagination'`. `draw.ts:5` changes `import type { ResolvedTable } from './index'` to `from './pagination'`. `pure.ts` adds `export * from './render/pagination'`. Export `maxRowsFor` and `ROW_H` from draw.ts if they are internal today (the px-vs-pt memory notes they were not forwarded; forwarding them closes that gap too).

- [ ] **Step 4: Run the whole package suite** (`pnpm --filter @openldr/report-designer test`): pagination test passes, golden test untouched.

- [ ] **Step 5: The browser-safety proof is the studio suite.** jsdom cannot load pdfkit; Task 3's studio test importing the math through `./types` (which re-exports `/pure`) fails the moment `/pure` pulls pdfkit. State this in the commit body. Commit: `feat(report-designer): pagination math is reachable without pdfkit`.

### Task 2: shared bound-row fetch in the studio

**Files:**
- Modify: `apps/studio/src/report-designer/exportExcel.ts`
- Create: `apps/studio/src/report-designer/pageCounts.ts`
- Test: `apps/studio/src/report-designer/pageCounts.test.ts`

**Interfaces:**
- Consumes: `queryApi.list/run` (as `exportExcel.ts` does), design params mapped by `param.key`.
- Produces: `fetchResolvedTables(design, deps): Promise<Map<string, ResolvedTable>>` — for every element with a `dataSource`, runs its query with the design's param values, paging past the run cap exactly like the Excel export; a failed query resolves to `{ error }`. And `designPageCounts(design, resolved): { perPage: number[]; total: number }` — a thin wrapper over `pageChunkCount`/`totalPhysicalPages`.

- [ ] **Step 1: Failing tests** (injectable deps like `ExcelExportDeps`): a bound table fetches rows and counts >1 page for a long result; a failed query yields `{ error }` and count 1; an unbound design counts 1 per page with no fetch.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement.** Extract the query-fetch loop from `exportExcel.ts` into a shared function both call (same file or `boundData.ts`, follow the file's existing shape). No behavior change to Excel export; its tests stay green.

- [ ] **Step 4: Run pageCounts + exportExcel tests, expect PASS. Commit.**

### Task 3: the page strip

**Files:**
- Create: `apps/studio/src/report-designer/PageStrip.tsx`
- Modify: `apps/studio/src/report-designer/ReportDesignerPage.tsx`
- Test: `apps/studio/src/report-designer/PageStrip.test.tsx`
- i18n: en, fr, pt

**Interfaces:**
- Props: `{ counts: { perPage: number[]; total: number } | null; loading: boolean; onLoad(): void; stale: boolean }`.

- [ ] **Step 1: Failing tests:** no counts → "Prints as at least 1 page" and a Load pages button; counts `{perPage:[3], total:3}` → three page boxes and "Prints as 3 pages"; `stale` → the as-of note; clicking Load calls `onLoad`.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement.** A slim bar between `CanvasHeader` and the canvas: small page boxes (pure CSS, `aria-label` per page), the count label, a ghost Load pages Button, and the snapshot note. `ReportDesignerPage` holds `resolved: Map | null` + `countsStale` state: any design edit marks stale (cheap: compare `stableJson` the dirty tracker already computes); switching designs clears it. `onLoad` calls `fetchResolvedTables` then stores the map.

- [ ] **Step 4: i18n keys** (`printsAsAtLeastOne`, `printsAsPages` with count, `loadPages`, `pageCountAsOf`) in en, fr, pt. Parity green.

- [ ] **Step 5: Run, PASS, commit.**

### Task 4: the dashed break line on the canvas

**Files:**
- Modify: `apps/studio/src/report-designer/PageCanvas.tsx` (accept `resolved` prop; per overflowing table/cellgrid draw the chunk-0 end line)
- Test: `apps/studio/src/report-designer/PageCanvas.test.tsx`

**Interfaces:**
- Consumes: `elementChunkCount`, `rowsFor`, `maxRowsFor`, `ROW_H`, `cellGridRowSchedule`, `CELL_HEAD_H`, `CELL_ROW_H`, `toPt`, `PX_TO_PT` via `./types`.

- [ ] **Step 1: Failing tests:** with a resolved map making a table span 3 chunks, the canvas shows `break-<elId>` at the y where its chunk-0 slice ends, labeled "page 2 starts here"; with no resolved data, no line; a one-chunk table, no line.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement.** For each `table`: line y in px = `el.rect.y + (headerBand + maxRowsFor(hPt) * ROW_H) / PX_TO_PT`, computed IN POINTS first and converted once — never mix the scales (the px-vs-pt memory is binding here; the capacity test must fail when the box shrinks). For each `cellgrid`: end of its chunk-0 schedule slice. Dashed line + right-aligned tag, `pointer-events-none`, drawn under the selection outline. Reuse the guide color constant.

- [ ] **Step 4: Run, PASS, commit.**

### Task 5: gate, smoke, merge

- [ ] Full gate at `--concurrency=4`; re-run any failing package alone before blaming the slice.
- [ ] Live smoke (needs the operator's auth arrangement again): open the LIS Stakeholders Update, Load pages, confirm the strip matches the exported PDF's page count for a month with data, and the dashed line sits where page 2 actually starts in the export.
- [ ] Docs: extend the report-designer guide's flow bullet with the page strip. Mobile check at 375x812.
- [ ] Merge `--no-ff` to local main, `pnpm make:changelog`, commit. No push without the operator.

## Self-review notes

- Spec coverage: pure math exposure (T1), snapshot counts with honest empty state (T2, T3), dashed line (T4). The spec's HONEST NON-PROOF is closed by inspection: draw.ts:13 uses only the ambient type.
- Deliberate scope cuts, said out loud: no auto-refresh of counts on edit (stale flag instead — running every bound query per keystroke is the alternative and it is absurd); the break line marks each overflowing element's own chunk end rather than one merged line, because two tables can end their first page at different heights.
