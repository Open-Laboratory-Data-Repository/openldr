# cellgrid element (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `cellgrid` element kind to the report designer and PDF renderer, so a design can draw one row per record as a run of small filled squares, and prove the same element also draws a month calendar.

**Architecture:** `cellgrid` is a sibling of `table` in `packages/report-designer/src/render/draw.ts`. It reuses the existing resolve, sort and chunk machinery but brings its own geometry constants, its own sequential palette and its own header handling. Pure geometry and palette functions live in a new `cellgrid.ts` so they can be unit tested without pdfkit; only the drawing itself lands in `draw.ts`.

**Tech Stack:** TypeScript, zod (schema), pdfkit (drawing), vitest (tests), pnpm workspaces.

**Slice boundary:** renderer and schema only. No report design, query, parameter, CLI, docs or studio change. Nothing that renders today may change one byte, and Task 9 asserts that.

**Spec:** `docs/superpowers/specs/2026-08-20-transmission-grid-cellgrid-design.md`

---

## Background the engineer needs

You are working in a pnpm monorepo. Two packages matter:

- `packages/report-designer` owns the design schema and all drawing. Despite the name, it contains the renderer.
- `packages/report-pdf` is a separate, older, simpler renderer for a different path. **Do not touch it.**

A design is a list of pages, each a list of absolutely-positioned elements. Coordinates in a design are **px at 96dpi**; the renderer multiplies by 0.75 to reach PostScript points before drawing. `toPt()` in `render/units.ts` does that. Every constant inside `draw.ts` is already in points. Mixing the two scales overstates capacity by a third, always in the direction that says "it fits", and it has shipped bugs here before.

A `table` element paginates: `tableChunkCount` divides its row count by how many rows fit its rect, and a design page is drawn as many physical times as its longest table needs. `drawsOnChunk` then decides, per element, whether it draws on a given physical page. `cellgrid` must join all three of those or it will redraw its whole row list on every page.

Run this package's tests with:

```bash
pnpm --filter @openldr/report-designer test
```

---

## File structure

| File | Responsibility |
|---|---|
| `packages/report-designer/src/schema.ts` | **Modify.** Add `'cellgrid'` to the kind enum, plus `labelColumn`, `cellColumns`, `groupBoundary`, `palette`, `trailingColumns`. |
| `packages/report-designer/src/render/cellgrid.ts` | **Create.** Pure functions: geometry constants, width arithmetic, group breaks, palette stepping, chunk counting. No pdfkit import. |
| `packages/report-designer/src/render/cellgrid.test.ts` | **Create.** Unit tests for every function above. |
| `packages/report-designer/src/render/draw.ts` | **Modify.** Add `drawCellGrid`, dispatch it from `drawElement`, and teach `rowsFor`, `tableChunkCount` and `drawsOnChunk` about the new kind. |
| `packages/report-designer/src/render/golden.test.ts` | **Modify.** Keep the existing digest unchanged, then add cellgrid fixtures. |

`cellgrid.ts` is separate from `draw.ts` on purpose. `draw.ts` is already past 900 lines and needs a `Doc` to test anything. Everything here that can be checked with a number rather than a PDF belongs outside it.

---

### Task 1: Schema accepts the new kind

**Files:**
- Modify: `packages/report-designer/src/schema.ts`
- Test: `packages/report-designer/src/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/report-designer/src/schema.test.ts`:

```ts
// ⚠ Asserts the PARSED OUTPUT, never just `.not.toThrow()`. `DesignElementSchema` strips unknown
// keys, so a throw-only assertion passes just as happily when none of these fields exist on the
// schema at all. Measured: deleting all five fields and re-running left this test green.
it('accepts a cellgrid element and keeps every cellgrid field', () => {
  const out = DesignElementSchema.parse({
    id: 'grid', kind: 'cellgrid', name: 'Submission grid',
    rect: { x: 48, y: 200, w: 698, h: 400 },
    dataSource: { kind: 'custom-query', queryId: 'q' },
    sortBy: 'ord',
    labelColumn: 'lab',
    cellColumns: ['d01', 'd02', 'd03'],
    groupBoundary: 'token-change',
    palette: { ramp: 'blue', steps: 1 },
    trailingColumns: [
      { key: 'days', label: 'Days', width: 34.5 },
      { key: 'silent', label: 'Silent', width: 52, emphasis: 'fill' },
    ],
  });
  expect(out.kind).toBe('cellgrid');
  expect(out.labelColumn).toBe('lab');
  expect(out.cellColumns).toEqual(['d01', 'd02', 'd03']);
  expect(out.groupBoundary).toBe('token-change');
  expect(out.palette).toEqual({ ramp: 'blue', steps: 1 });
  expect(out.trailingColumns).toEqual([
    { key: 'days', label: 'Days', width: 34.5 },
    { key: 'silent', label: 'Silent', width: 52, emphasis: 'fill' },
  ]);
});

it('rejects an unknown ramp', () => {
  expect(() => DesignElementSchema.parse({
    id: 'grid', kind: 'cellgrid', name: 'g', rect: { x: 0, y: 0, w: 10, h: 10 },
    palette: { ramp: 'chartreuse', steps: 1 },
  })).toThrow();
});

it.each([0, 6, 2.5])('rejects a palette step count of %s', (steps) => {
  expect(() => DesignElementSchema.parse({
    id: 'grid', kind: 'cellgrid', name: 'g', rect: { x: 0, y: 0, w: 10, h: 10 },
    palette: { ramp: 'blue', steps },
  })).toThrow();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @openldr/report-designer test -- schema.test.ts`
Expected: FAIL, `Invalid enum value. Expected 'text' | 'table' | ... received 'cellgrid'`

- [ ] **Step 3: Add the schema**

In `packages/report-designer/src/schema.ts`, above `DesignElementSchema`:

```ts
/** Sequential ramps a `cellgrid` may paint with. Presentational, not clinical. A `cellgrid` shows
 *  magnitude or presence, never a result state, so it deliberately does not reach for
 *  `CELL_STATUSES`. Keeping the two apart is what stops a submission grid inheriting the meaning of
 *  a red AST chip. */
export const CELL_RAMPS = ['blue', 'slate'] as const;
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
  emphasis: z.enum(['fill', 'text']).optional(),
});
export type TrailingColumn = z.infer<typeof TrailingColumnSchema>;
```

Then change the kind enum and add five fields inside `DesignElementSchema`:

```ts
  kind: z.enum(['text', 'table', 'image', 'line', 'rect', 'datetime', 'keyvalue', 'barcode', 'qrcode', 'cellgrid']),
```

```ts
  /** `cellgrid`: result column holding each row's label. Omit for a grid with no label column, such
   *  as a month calendar whose position already says which day a cell is. */
  labelColumn: z.string().optional(),
  /** `cellgrid`: result columns drawn as cells, in order. */
  cellColumns: z.array(z.string()).optional(),
  /** `cellgrid`: insert a wider gap wherever the GROUP ROW's token changes.
   *
   *  The group row is data (row 1 of the sorted result, after the header row), never a design
   *  constant, because the grouping a month needs is not knowable when the design is authored. A
   *  month starting mid-week has a short first group, and every month has a different one. */
  groupBoundary: z.literal('token-change').optional(),
  /** `cellgrid`: how a cell value becomes a fill. */
  palette: CellPaletteSchema.optional(),
  /** `cellgrid`: text columns drawn after the cells. */
  trailingColumns: z.array(TrailingColumnSchema).optional(),
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter @openldr/report-designer test -- schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/schema.ts packages/report-designer/src/schema.test.ts
git commit -m "feat(report-designer): accept a cellgrid element in the design schema"
```

---

### Task 2: Geometry constants and width arithmetic

**Files:**
- Create: `packages/report-designer/src/render/cellgrid.ts`
- Create: `packages/report-designer/src/render/cellgrid.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/report-designer/src/render/cellgrid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripWidth, cellGridWidth, CELL_SIZE, CELL_GAP, GROUP_GAP } from './cellgrid';

describe('stripWidth', () => {
  it('is cells plus small gaps when there are no group breaks', () => {
    expect(stripWidth(5, [])).toBeCloseTo(5 * CELL_SIZE + 4 * CELL_GAP, 5);
  });

  it('charges a wide gap at each break and a small one elsewhere', () => {
    // 23 cells across 5 groups => 4 breaks, 18 small gaps
    expect(stripWidth(23, [5, 10, 15, 20]))
      .toBeCloseTo(23 * CELL_SIZE + 18 * CELL_GAP + 4 * GROUP_GAP, 5);
  });

  it('is one cell wide with no gaps at all for a single cell', () => {
    expect(stripWidth(1, [])).toBeCloseTo(CELL_SIZE, 5);
  });

  it('is zero for no cells', () => {
    expect(stripWidth(0, [])).toBe(0);
  });
});

describe('cellGridWidth', () => {
  it('matches the spec arithmetic for the worst-case month', () => {
    const w = cellGridWidth({
      labelWidth: 105,
      cellCount: 23,
      breaks: [5, 10, 15, 20],
      trailingWidths: [34.5, 52],
    });
    // 105 + 9 + 298.5 + 9 + 34.5 + 9 + 52. One gap constant, charged before every
    // trailing column. See spec section 5 for why it is not two.
    expect(w).toBeCloseTo(517, 1);
  });

  it('drops the label gap when there is no label column', () => {
    const withLabel = cellGridWidth({ labelWidth: 105, cellCount: 7, breaks: [], trailingWidths: [] });
    const without = cellGridWidth({ labelWidth: 0, cellCount: 7, breaks: [], trailingWidths: [] });
    expect(withLabel - without).toBeCloseTo(105 + 9, 5);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @openldr/report-designer test -- cellgrid.test.ts`
Expected: FAIL, `Cannot find module './cellgrid'`

- [ ] **Step 3: Write the implementation**

Create `packages/report-designer/src/render/cellgrid.ts`. It has no imports yet; Task 4 adds the one type import this file ever needs.

```ts
/**
 * Geometry for a `cellgrid`, in POINTS.
 *
 * ⚠ Points, like every other constant in this renderer. A design rect is px@96 and `toPt` converts
 * it before any of this applies. Doing this arithmetic against an unconverted rect overstates
 * capacity by a third.
 *
 * ⛔ These are DECLARED, never measured. `table` derives a column width from the widest string it
 * holds and floors the result at `MIN_COL_W` (22pt), which is exactly why a 23-column grid cannot
 * fit A4 portrait and why the report it serves is landscape today. A cell holds no text, so there
 * is nothing to measure and no floor to honour. That is the whole reason this element exists.
 */
export const CELL_SIZE = 10.5;
/** Between two cells inside a group. Keeps adjacent fills from reading as one merged slab, the same
 *  job `CHIP_INSET_X` does for a table. */
export const CELL_GAP = 1.5;
/** At a group break. Five times the small gap, so a break reads as structure rather than as a
 *  slightly larger gap. */
export const GROUP_GAP = 7.5;
/** Baseline row pitch. Its own constant: no formula ties it to `CELL_SIZE`, and the 2.25pt
 *  difference between them is not derived from anything. Settled by eye over preview rounds,
 *  the same way `CELL_SIZE` was. Stated rather than computed so nobody goes looking for the
 *  relationship. */
export const CELL_ROW_H = 12.75;
/** Between the label column and the strip, and between the strip and each trailing column. */
export const CELL_COL_GAP = 9;
/** The label band above the cells. Redrawn on every chunk, like a table header. */
export const CELL_HEAD_H = 13;
/** Width of the label column. Declared for the same reason every other width here is: a measured
 *  label column is what leaves 21.8pt for a laboratory name in A4 portrait. */
export const CELL_LABEL_W = 105;

/**
 * Width of the run of cells alone.
 *
 * `breaks` holds the cell INDEX each group starts at, excluding index 0. A break costs `GROUP_GAP`
 * in place of the `CELL_GAP` that would otherwise sit there, so the two are never both charged.
 */
export function stripWidth(cellCount: number, breaks: number[]): number {
  if (cellCount <= 0) return 0;
  const gaps = cellCount - 1;
  const wide = breaks.filter((b) => b > 0 && b < cellCount).length;
  return cellCount * CELL_SIZE + (gaps - wide) * CELL_GAP + wide * GROUP_GAP;
}

export interface CellGridWidthInput {
  /** 0 when the grid has no label column. */
  labelWidth: number;
  cellCount: number;
  breaks: number[];
  trailingWidths: number[];
}

/** Total width the element needs. Pure, so a design can assert it fits its page without rendering. */
export function cellGridWidth(i: CellGridWidthInput): number {
  const label = i.labelWidth > 0 ? i.labelWidth + CELL_COL_GAP : 0;
  const trailing = i.trailingWidths.reduce((sum, w) => sum + CELL_COL_GAP + w, 0);
  return label + stripWidth(i.cellCount, i.breaks) + trailing;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter @openldr/report-designer test -- cellgrid.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/cellgrid.ts packages/report-designer/src/render/cellgrid.test.ts
git commit -m "feat(report-designer): cellgrid geometry constants and width arithmetic"
```

---

### Task 3: Group breaks from the group row

**Files:**
- Modify: `packages/report-designer/src/render/cellgrid.ts`
- Modify: `packages/report-designer/src/render/cellgrid.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `cellgrid.test.ts`, and add `groupBreaks` to the existing import from `./cellgrid`:

```ts
describe('groupBreaks', () => {
  it('breaks wherever the token changes', () => {
    expect(groupBreaks(['1', '1', '1', '2', '2', '3'])).toEqual([3, 5]);
  });

  it('never reports a break at index 0', () => {
    expect(groupBreaks(['9', '9'])).toEqual([]);
  });

  it('breaks on every cell when every token differs', () => {
    expect(groupBreaks(['a', 'b', 'c'])).toEqual([1, 2]);
  });

  it('is empty for an absent group row', () => {
    expect(groupBreaks(undefined)).toEqual([]);
  });

  it('handles a short first group, which is what a month starting mid-week gives', () => {
    // Wed Thu Fri | Mon..Fri
    expect(groupBreaks(['1', '1', '1', '2', '2', '2', '2', '2'])).toEqual([3]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @openldr/report-designer test -- cellgrid.test.ts`
Expected: FAIL, `groupBreaks is not a function`

- [ ] **Step 3: Write the implementation**

Append to `cellgrid.ts`:

```ts
/**
 * Cell indices at which a new group starts, read from the group row.
 *
 * The token itself is never drawn and its value carries no meaning. Only the CHANGE does. That is
 * what lets one implementation group by week, by quarter, by batch or by anything else a query can
 * emit, without the renderer knowing what any of them are.
 */
export function groupBreaks(groupRow: string[] | undefined): number[] {
  if (!groupRow) return [];
  const out: number[] = [];
  for (let i = 1; i < groupRow.length; i += 1) {
    if (groupRow[i] !== groupRow[i - 1]) out.push(i);
  }
  return out;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter @openldr/report-designer test -- cellgrid.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/cellgrid.ts packages/report-designer/src/render/cellgrid.test.ts
git commit -m "feat(report-designer): derive cellgrid group breaks from the group row"
```

---

### Task 4: The sequential palette

**Files:**
- Modify: `packages/report-designer/src/render/cellgrid.ts`
- Modify: `packages/report-designer/src/render/cellgrid.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `cellgrid.test.ts`, adding `rampSteps`, `stepFor`, `cellFill` and `EMPTY_FILL` to the import:

```ts
describe('rampSteps', () => {
  it('gives the darkest step alone when the grid is binary', () => {
    expect(rampSteps('blue', 1)).toEqual(['#185FA5']);
  });

  it('gives five distinct steps at full depth', () => {
    const s = rampSteps('blue', 5);
    expect(s).toHaveLength(5);
    expect(new Set(s).size).toBe(5);
  });

  it('always ends on the darkest step', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(rampSteps('blue', n)[n - 1]).toBe('#185FA5');
    }
  });
});

describe('stepFor', () => {
  it('is empty for zero, whatever the depth', () => {
    expect(stepFor(0, 10, 5)).toBe(-1);
    expect(stepFor(0, 10, 1)).toBe(-1);
  });

  it('is empty for a negative or unparseable value', () => {
    expect(stepFor(-2, 10, 3)).toBe(-1);
    expect(stepFor(Number.NaN, 10, 3)).toBe(-1);
  });

  it('collapses every non-zero value onto one step when binary', () => {
    expect(stepFor(1, 24, 1)).toBe(0);
    expect(stepFor(24, 24, 1)).toBe(0);
  });

  it('puts the maximum on the darkest step', () => {
    expect(stepFor(24, 24, 5)).toBe(4);
  });

  it('never exceeds the declared depth', () => {
    expect(stepFor(9999, 24, 5)).toBe(4);
  });

  it('is empty when the maximum is zero, rather than dividing by it', () => {
    // ⚠ A POSITIVE value against a zero max. `stepFor(0, 0, 5)` reads like it covers this and
    // does not: the `value <= 0` guard returns first, so the max guard could be deleted whole
    // and this would stay green. Measured, by deleting it.
    expect(stepFor(5, 0, 5)).toBe(-1);
  });
});

describe('cellFill', () => {
  it('paints the empty tint for a zero value', () => {
    expect(cellFill(0, 24, { ramp: 'blue', steps: 5 })).toBe(EMPTY_FILL);
  });

  it('paints the darkest step for the maximum', () => {
    expect(cellFill(24, 24, { ramp: 'blue', steps: 5 })).toBe('#185FA5');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @openldr/report-designer test -- cellgrid.test.ts`
Expected: FAIL, `rampSteps is not a function`

- [ ] **Step 3: Write the implementation**

Add the type import at the top of `cellgrid.ts`. This is the only import the file needs, and this is the first task that uses it:

```ts
import type { CellPalette, CellRamp } from '../schema';
```

Then append:

```ts
/**
 * The empty cell.
 *
 * ⚠ MEASURED for a mono office printer, which is what these reports are signed on. `#cbd5e1` is 17%
 * ink; the darkest blue step is 68%. That is 50.8 percentage points of luminance apart, well clear
 * of the ~15pp a 600dpi laser needs to hold two tints apart. A lighter empty tint was tried at 6%
 * ink and drops out entirely on some lasers, which erases the grid and leaves filled cells floating
 * with no positional ruler behind them.
 *
 * It happens to equal `GRID_RULE` in `draw.ts`. That is a coincidence of both wanting the lightest
 * slate that still prints, not a shared constant. Do not factor them together.
 */
export const EMPTY_FILL = '#cbd5e1';

/** Five-step sequential ramps, lightest to darkest. One hue each: a sequential scale that changes
 *  hue stops encoding magnitude and starts encoding category. */
const RAMPS: Record<CellRamp, readonly string[]> = {
  blue:  ['#c9ddf3', '#9dc2e8', '#5f9adb', '#2f76bd', '#185FA5'],
  slate: ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#334155'],
};

/**
 * `n` evenly spaced steps of a ramp, always ending on the darkest.
 *
 * Ending on the darkest matters more than even spacing: at `steps: 1` the single step must be the
 * one with the most contrast against the empty tint, not the one nearest the middle.
 */
export function rampSteps(ramp: CellRamp, n: number): string[] {
  const full = RAMPS[ramp];
  const last = full.length - 1;
  if (n <= 1) return [full[last]];
  return Array.from({ length: n }, (_, i) => full[Math.round((i * last) / (n - 1))]);
}

/** Which step a value lands on, or -1 for the empty tint. */
export function stepFor(value: number, max: number, steps: number): number {
  if (!Number.isFinite(value) || value <= 0) return -1;
  if (max <= 0) return -1;
  if (steps <= 1) return 0;
  return Math.min(steps - 1, Math.floor((value / max) * steps));
}

/** The fill a cell paints. */
export function cellFill(value: number, max: number, palette: CellPalette): string {
  const step = stepFor(value, max, palette.steps);
  if (step < 0) return EMPTY_FILL;
  return rampSteps(palette.ramp, palette.steps)[step];
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter @openldr/report-designer test -- cellgrid.test.ts`
Expected: PASS, 22 tests

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/cellgrid.ts packages/report-designer/src/render/cellgrid.test.ts
git commit -m "feat(report-designer): sequential cell palette with a print-safe empty tint"
```

---

### Task 5: Row splitting and chunk counting

**Files:**
- Modify: `packages/report-designer/src/render/cellgrid.ts`
- Modify: `packages/report-designer/src/render/cellgrid.test.ts`

The resolved result carries two synthetic leading rows: row 0 is the visible cell labels, row 1 is the group tokens. Everything after them is a record. Without `groupBoundary`, only row 0 is synthetic.

- [ ] **Step 1: Write the failing test**

Append to `cellgrid.test.ts`, adding `splitCellGridRows`, `cellGridMaxRows` and `cellGridChunks` to the import:

```ts
describe('splitCellGridRows', () => {
  const rows = [
    ['', '02', '03'],
    ['', '1', '1'],
    ['Bahi', '0', '1'],
    ['Chunya', '1', '0'],
  ];

  it('lifts both synthetic rows when grouping is on', () => {
    const s = splitCellGridRows(rows, true);
    expect(s.header).toEqual(['', '02', '03']);
    expect(s.groups).toEqual(['', '1', '1']);
    expect(s.body).toHaveLength(2);
    expect(s.body[0][0]).toBe('Bahi');
  });

  it('lifts only the header when grouping is off', () => {
    const s = splitCellGridRows(rows, false);
    expect(s.groups).toBeUndefined();
    expect(s.body).toHaveLength(3);
  });

  it('survives a result with no rows at all', () => {
    const s = splitCellGridRows([], true);
    expect(s.header).toEqual([]);
    expect(s.groups).toBeUndefined();
    expect(s.body).toEqual([]);
  });

  it('survives a result carrying only the synthetic rows', () => {
    const s = splitCellGridRows([['', '02'], ['', '1']], true);
    expect(s.body).toEqual([]);
  });
});

describe('cellGridMaxRows', () => {
  it('subtracts the header band before dividing by the row pitch', () => {
    // (400 - 13) / 12.75 = 30.35 -> 30
    expect(cellGridMaxRows(400)).toBe(30);
  });

  it('is zero for a rect too short to hold its own header', () => {
    expect(cellGridMaxRows(8)).toBe(0);
  });
});

describe('cellGridChunks', () => {
  it('is one when everything fits', () => {
    expect(cellGridChunks(10, 400)).toBe(1);
  });

  it('is never zero, even with no rows, so an empty grid still draws its header once', () => {
    expect(cellGridChunks(0, 400)).toBe(1);
  });

  it('rounds up', () => {
    expect(cellGridChunks(31, 400)).toBe(2);
    expect(cellGridChunks(60, 400)).toBe(2);
    expect(cellGridChunks(61, 400)).toBe(3);
  });

  it('is one when the rect cannot hold a single row, rather than looping forever', () => {
    expect(cellGridChunks(50, 8)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @openldr/report-designer test -- cellgrid.test.ts`
Expected: FAIL, `splitCellGridRows is not a function`

- [ ] **Step 3: Write the implementation**

Append to `cellgrid.ts`:

```ts
export interface SplitRows {
  /** Cell labels drawn in the header band, redrawn on every chunk. */
  header: string[];
  /** Group tokens, or `undefined` when the element does not group. Never drawn. */
  groups: string[] | undefined;
  /** One entry per record. */
  body: string[][];
}

/**
 * Separate the synthetic leading rows from the records.
 *
 * ⛔ TWO synthetic rows, where `table`'s `headerRow` lifts ONE. Row 0 is the labels a reader sees,
 * row 1 is the grouping the renderer needs and nobody sees. They cannot be the same row: a day
 * column shows "02" and belongs to week 1, and neither value derives from the other for an
 * arbitrary month.
 *
 * ⚠ Anything counting rows over one of these queries must now subtract 2, not 1.
 * `r-transmission-grid` already declares `summaryMetrics: null` and a static `chart` to stop a
 * row-count fallback that once published "24" for a 23-laboratory month. That off-by-one is an
 * off-by-two here.
 */
export function splitCellGridRows(rows: string[][], grouped: boolean): SplitRows {
  const lift = grouped ? 2 : 1;
  return {
    header: rows[0] ?? [],
    groups: grouped ? rows[1] : undefined,
    body: rows.slice(lift),
  };
}

/** Records that fit a rect of height `hPt`. */
export function cellGridMaxRows(hPt: number): number {
  return Math.max(0, Math.floor((hPt - CELL_HEAD_H) / CELL_ROW_H));
}

/** Physical chunks this grid needs. Never zero: an empty grid still draws its header once, which is
 *  what tells a reader the block ran and found nothing rather than being omitted. */
export function cellGridChunks(bodyRowCount: number, hPt: number): number {
  const max = cellGridMaxRows(hPt);
  if (max < 1) return 1;
  return Math.max(1, Math.ceil(bodyRowCount / max));
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter @openldr/report-designer test -- cellgrid.test.ts`
Expected: PASS, 32 tests

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/cellgrid.ts packages/report-designer/src/render/cellgrid.test.ts
git commit -m "feat(report-designer): cellgrid row splitting and chunk arithmetic"
```

---

### Task 6: `rowsFor` returns cellgrid rows

**Files:**
- Modify: `packages/report-designer/src/render/draw.ts:305-314`
- Test: `packages/report-designer/src/render/draw.test.ts`

`rowsFor` returns `[]` for anything that is not a table, so a cellgrid currently resolves to nothing.

- [ ] **Step 1: Write the failing test**

Append to `packages/report-designer/src/render/draw.test.ts`:

```ts
it('projects cellgrid rows through labelColumn, cellColumns and trailingColumns in order', () => {
  const el = {
    id: 'g', kind: 'cellgrid', name: 'g', rect: { x: 0, y: 0, w: 400, h: 200 },
    dataSource: { kind: 'custom-query', queryId: 'q' },
    labelColumn: 'lab',
    cellColumns: ['d01', 'd02'],
    trailingColumns: [{ key: 'days', label: 'Days', width: 34.5 }],
  } as DesignElement;
  const resolved: ResolvedTable = {
    columns: [{ key: 'lab', label: 'Lab' }, { key: 'd01', label: '' }, { key: 'd02', label: '' }, { key: 'days', label: 'Days' }],
    rows: [{ lab: 'Bahi', d01: 0, d02: 1, days: '01/22' }],
  };
  expect(rowsFor(el, resolved)).toEqual([['Bahi', '0', '1', '01/22']]);
});

it('omits the label slot for a cellgrid with no labelColumn', () => {
  const el = {
    id: 'g', kind: 'cellgrid', name: 'g', rect: { x: 0, y: 0, w: 400, h: 200 },
    dataSource: { kind: 'custom-query', queryId: 'q' },
    cellColumns: ['d01'],
  } as DesignElement;
  const resolved: ResolvedTable = { columns: [{ key: 'd01', label: '' }], rows: [{ d01: 3 }] };
  expect(rowsFor(el, resolved)).toEqual([['3']]);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @openldr/report-designer test -- draw.test.ts`
Expected: FAIL, received `[]`

- [ ] **Step 3: Change `rowsFor`**

Replace the guard at `draw.ts:306` and add a cellgrid branch below it:

```ts
export function rowsFor(el: DesignElement, resolved: ResolvedTable | undefined): string[][] {
  if (el.kind === 'cellgrid') return cellGridRowsFor(el, resolved);
  if (el.kind !== 'table') return [];
  if (el.dataSource) {
    const rt = effectiveResolved(el, resolved);
    if (!rt || 'error' in rt) return [];
    const cols = el.boundColumns && el.boundColumns.length ? el.boundColumns : rt.columns;
    return rt.rows.map((row) => cols.map((c) => String(row[c.key] ?? '')));
  }
  return el.rows ?? [];
}

/** A cellgrid's projection: label, then each cell column, then each trailing column. That ORDER is
 *  the contract every other cellgrid function indexes against, so it is built in exactly one place. */
function cellGridRowsFor(el: DesignElement, resolved: ResolvedTable | undefined): string[][] {
  if (!el.dataSource) return el.rows ?? [];
  const rt = effectiveResolved(el, resolved);
  if (!rt || 'error' in rt) return [];
  const keys = [
    ...(el.labelColumn ? [el.labelColumn] : []),
    ...(el.cellColumns ?? []),
    ...(el.trailingColumns ?? []).map((c) => c.key),
  ];
  return rt.rows.map((row) => keys.map((k) => String(row[k] ?? '')));
}
```

`cellGridRowsFor` reads only the element and the resolved table, so this task adds **no import** from `./cellgrid`. Task 7 adds the first two symbols and Task 8 adds the rest, each where they are first used.

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter @openldr/report-designer test -- draw.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/draw.ts packages/report-designer/src/render/draw.test.ts
git commit -m "feat(report-designer): resolve cellgrid rows in column order"
```

---

### Task 7: Pagination knows about cellgrid

**Files:**
- Modify: `packages/report-designer/src/render/draw.ts:369-385`, `:710-716`
- Test: `packages/report-designer/src/render/draw.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `draw.test.ts`:

```ts
// NOT `gridEl`. `draw.test.ts` already has an unrelated `const gridEl` used by the existing table
// pagination tests, and redeclaring it is a build error, not a lint warning.
function cellGridEl(rows: number): { el: DesignElement; resolved: ResolvedTable } {
  // 545px@96 = 408.75pt; (408.75 - 13) / 12.75 = 31.03 -> 31 rows a chunk
  const el = {
    id: 'g', kind: 'cellgrid', name: 'g', rect: { x: 0, y: 0, w: 900, h: 545 },
    dataSource: { kind: 'custom-query', queryId: 'q' },
    labelColumn: 'lab', cellColumns: ['d01'], groupBoundary: 'token-change',
  } as DesignElement;
  const body = Array.from({ length: rows }, (_, i) => ({ lab: `L${i}`, d01: 1 }));
  const resolved: ResolvedTable = {
    columns: [{ key: 'lab', label: '' }, { key: 'd01', label: '' }],
    rows: [{ lab: '', d01: '02' }, { lab: '', d01: '1' }, ...body],
  };
  return { el, resolved };
}

it('chunks a cellgrid by its own row pitch, not the table row pitch', () => {
  const a = cellGridEl(31);
  expect(tableChunkCount(a.el, a.resolved)).toBe(1);
  const b = cellGridEl(32);
  expect(tableChunkCount(b.el, b.resolved)).toBe(2);
});

it('stops drawing a cellgrid once its rows run out', () => {
  const { el, resolved } = cellGridEl(10);
  const page = { id: 'p', elements: [el] };
  const map = new Map([['g', resolved]]);
  expect(drawsOnChunk(el, page, map, 0)).toBe(true);
  expect(drawsOnChunk(el, page, map, 1)).toBe(false);
});

it('lets a heading follow a cellgrid via showWithTable', () => {
  const { el, resolved } = cellGridEl(10);
  const heading = {
    id: 'h', kind: 'text', name: 'h', rect: { x: 0, y: 0, w: 100, h: 14 },
    text: 'Any HVL/EID data submission', showWithTable: 'g',
  } as DesignElement;
  const page = { id: 'p', elements: [heading, el] };
  const map = new Map([['g', resolved]]);
  expect(drawsOnChunk(heading, page, map, 0)).toBe(true);
  expect(drawsOnChunk(heading, page, map, 1)).toBe(false);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @openldr/report-designer test -- draw.test.ts`
Expected: FAIL. `tableChunkCount` returns 1 for 32 rows, and the heading test fails because `showWithTable` only resolves a target whose kind is `table`.

- [ ] **Step 3: Change the two functions**

First add the import at the top of `draw.ts`:

```ts
import { splitCellGridRows, cellGridChunks } from './cellgrid';
```

In `tableChunkCount` at `draw.ts:710`, add a cellgrid branch before the table guard:

```ts
export function tableChunkCount(el: DesignElement, resolved: ResolvedTable | undefined): number {
  if (el.kind === 'cellgrid') {
    const body = splitCellGridRows(rowsFor(el, resolved), el.groupBoundary === 'token-change').body;
    return cellGridChunks(body.length, toPt(el.rect).h);
  }
  if (el.kind !== 'table') return 1;
  const maxRows = maxRowsFor(toPt(el.rect).h, headerBandHeight(el));
  if (maxRows < 1) return 1;
  const rowCount = bodyRowsFor(el, resolved).length;
  return Math.max(1, Math.ceil(rowCount / maxRows));
}
```

In `drawsOnChunk` at `draw.ts:369`, widen both the self-check and the `showWithTable` lookup:

```ts
export function drawsOnChunk(
  el: DesignElement, page: DesignPage, resolved: Map<string, ResolvedTable>, chunk: number,
): boolean {
  if (el.kind === 'table' || el.kind === 'cellgrid') return tableDrawsOnChunk(el, resolved.get(el.id), chunk);
  if (!el.showWithTable) return true;
  // ⛔ `cellgrid` is accepted here too. `showWithTable` names the element a heading belongs to, and
  // the reason it exists (never print a heading over a block that finished earlier) applies to a
  // cellgrid exactly as it does to a table.
  const target = page.elements.find(
    (e) => e.id === el.showWithTable && (e.kind === 'table' || e.kind === 'cellgrid'),
  );
  if (!target) return true;
  return tableDrawsOnChunk(target, resolved.get(target.id), chunk);
}
```

`tableDrawsOnChunk` needs no change: it calls `tableChunkCount`, which now handles both kinds.

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter @openldr/report-designer test -- draw.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/draw.ts packages/report-designer/src/render/draw.test.ts
git commit -m "feat(report-designer): paginate cellgrid and let headings follow it"
```

---

### Task 8: Draw it

**Files:**
- Modify: `packages/report-designer/src/render/draw.ts:740-798` (dispatch), then append `drawCellGrid`

- [ ] **Step 1: Add the dispatch case**

In `drawElement`'s switch, immediately after the `case 'table':` block:

```ts
    case 'cellgrid': {
      drawCellGrid(doc, el, r, resolved, chunk);
      return;
    }
```

- [ ] **Step 2: Widen the `./cellgrid` import**

Extend the import Task 7 added. `stripWidth` is aliased because `draw.ts` already has local width helpers and an unaliased name invites confusion with them:

```ts
import {
  CELL_SIZE, CELL_GAP, GROUP_GAP, CELL_ROW_H, CELL_COL_GAP, CELL_HEAD_H, CELL_LABEL_W,
  cellFill, groupBreaks, splitCellGridRows, cellGridMaxRows, cellGridChunks,
  stripWidth as stripWidthOf,
} from './cellgrid';
```

- [ ] **Step 3: Write `drawCellGrid`**

Append to `draw.ts`, next to `drawTable`:

```ts
/**
 * One row per record: a label, a run of fixed-size filled squares, then declared-width text columns.
 *
 * ⛔ Nothing here measures a string to decide a width. Every horizontal position comes from the
 * constants in `cellgrid.ts`, which is what lets 23 columns fit A4 portrait where `table`'s
 * measured-and-floored widths cannot.
 */
function drawCellGrid(
  doc: Doc, el: DesignElement, r: Box, resolved: ResolvedTable | undefined, chunk: number,
): void {
  if (el.dataSource && resolved && 'error' in resolved) { drawErrorPlaceholder(doc, r, resolved.error); return; }

  const grouped = el.groupBoundary === 'token-change';
  const split = splitCellGridRows(rowsFor(el, resolved), grouped);
  const hasLabel = Boolean(el.labelColumn);
  const cellCount = (el.cellColumns ?? []).length;
  const trailing = el.trailingColumns ?? [];
  const palette = el.palette ?? { ramp: 'blue' as const, steps: 1 };

  // Every projected row is [label?, ...cells, ...trailing], so a cell's slot is offset by the label.
  const cellIndex = (i: number): number => (hasLabel ? 1 : 0) + i;

  const cellStart = hasLabel ? CELL_LABEL_W + CELL_COL_GAP : 0;
  const breaks = grouped ? groupBreaks(split.groups?.slice(hasLabel ? 1 : 0)) : [];
  const xOfCell = (i: number): number => {
    let x = r.x + cellStart;
    for (let k = 0; k < i; k += 1) x += CELL_SIZE + (breaks.includes(k + 1) ? GROUP_GAP : CELL_GAP);
    return x;
  };
  const trailingStart = r.x + cellStart + stripWidthOf(cellCount, breaks);

  // ⚠ The maximum is taken over EVERY record, not over the chunk being drawn. A per-chunk maximum
  // would re-scale the ramp on page 2 and paint the same value two different colours in one
  // document.
  let max = 0;
  for (const row of split.body) {
    for (let i = 0; i < cellCount; i += 1) {
      const v = Number(row[cellIndex(i)]);
      if (Number.isFinite(v) && v > max) max = v;
    }
  }

  doc.save().rect(r.x, r.y, r.w, r.h).clip();

  // Header band: cell labels then trailing labels, redrawn on every chunk.
  doc.font('Helvetica').fontSize(6).fillColor(HEAD_RULE);
  for (let i = 0; i < cellCount; i += 1) {
    const text = split.header[cellIndex(i)] ?? '';
    if (text) doc.text(text, xOfCell(i), r.y + 3, { width: CELL_SIZE, align: 'center', lineBreak: false });
  }
  let hx = trailingStart;
  for (const c of trailing) {
    hx += CELL_COL_GAP;
    doc.text(c.label, hx, r.y + 3, { width: c.width, align: 'center', lineBreak: false });
    hx += c.width;
  }

  // Records.
  const perChunk = cellGridMaxRows(r.h);
  const slice = perChunk < 1 ? [] : split.body.slice(chunk * perChunk, (chunk + 1) * perChunk);
  slice.forEach((row, ri) => {
    const y = r.y + CELL_HEAD_H + ri * CELL_ROW_H;
    if (hasLabel) {
      doc.font('Helvetica').fontSize(8).fillColor(BODY_TEXT)
        .text(row[0] ?? '', r.x, y + 1, { width: CELL_LABEL_W, lineBreak: false, ellipsis: true });
    }
    for (let i = 0; i < cellCount; i += 1) {
      doc.rect(xOfCell(i), y, CELL_SIZE, CELL_SIZE).fill(cellFill(Number(row[cellIndex(i)]), max, palette));
    }
    let x = trailingStart;
    trailing.forEach((c, ci) => {
      x += CELL_COL_GAP;
      const v = row[cellIndex(cellCount) + ci] ?? '';
      doc.font('Helvetica').fontSize(7).fillColor(BODY_TEXT)
        .text(v, x, y + 1, { width: c.width, align: 'center', lineBreak: false });
      x += c.width;
    });
  });

  doc.restore();
}
```

- [ ] **Step 4: Run the whole package**

Run: `pnpm --filter @openldr/report-designer test`
Expected: PASS, including the untouched `golden.test.ts` digest

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/draw.ts
git commit -m "feat(report-designer): draw the cellgrid element"
```

---

### Task 9: The regression guard, and a golden for the grid

**Files:**
- Modify: `packages/report-designer/src/render/golden.test.ts`

The existing digest test is this slice's safety net. A design that opts into nothing new must render byte-identically. **Do not update that digest in this slice.** If it fails, something in Tasks 6 to 8 leaked into the shared path, and the digest is telling you so.

- [ ] **Step 1: Write the failing test**

Append to `golden.test.ts`, and add these imports at the top:

```ts
import { tableChunkCount } from './draw';
import { cellFill } from './cellgrid';
```

```ts
/** A binary submission grid: two week groups, the first short, which is the shape a month starting
 *  mid-week produces. Kept separate from `goldenDesign()` so the untouched-design digest above
 *  stays sensitive to the shared path and nothing else. */
function cellGridDesign(): ReportDesign {
  return {
    id: 'cg', name: 'CellGrid', status: 'published', paper: 'A4', orientation: 'portrait',
    parameters: [],
    pages: [{
      id: 'p1',
      elements: [
        { id: 'head', kind: 'text', name: 'head', rect: { x: 48, y: 40, w: 600, h: 14 },
          text: 'Any HVL/EID data submission by testing laboratory',
          style: { fontSize: 10, bold: true }, showWithTable: 'grid' },
        { id: 'grid', kind: 'cellgrid', name: 'grid', rect: { x: 48, y: 60, w: 698, h: 200 },
          dataSource: { kind: 'custom-query', queryId: 'q' },
          sortBy: 'ord',
          labelColumn: 'lab',
          cellColumns: ['d01', 'd02', 'd03', 'd04', 'd05', 'd06', 'd07', 'd08'],
          groupBoundary: 'token-change',
          palette: { ramp: 'blue', steps: 1 },
          trailingColumns: [
            { key: 'days', label: 'Days', width: 34.5 },
            { key: 'silent', label: 'Silent', width: 52 },
          ] },
      ],
    }],
    pageNumbers: true,
  };
}

function cellGridResolved(): Map<string, ResolvedTable> {
  const spread = (vals: (string | number)[]) =>
    Object.fromEntries(vals.map((v, i) => [`d${String(i + 1).padStart(2, '0')}`, v]));
  // ⛔ Keyed by the ELEMENT id, never the query id. `resolveDesignTables` does
  // `resolved.set(el.id, ...)` (resolve.ts:35) and every reader does `resolved.get(el.id)`
  // (index.ts:78, draw.ts:392, :401, :749). Keying by `'q'` resolves to undefined, the grid
  // renders as if it had zero rows, and the pagination assertion below fails for a reason that
  // has nothing to do with pagination. `goldenResolved()` above already keys by element id.
  return new Map([['grid', {
    columns: [{ key: 'lab', label: '' },
      ...Array.from({ length: 8 }, (_, i) => ({ key: `d${String(i + 1).padStart(2, '0')}`, label: '' })),
      { key: 'days', label: 'Days' }, { key: 'silent', label: 'Silent' }],
    rows: [
      // Wed Thu Fri | Mon Tue Wed Thu Fri  -> one break, at cell index 3
      { ord: 0, lab: '', days: 'Days', silent: 'Silent', ...spread(['03','04','05','09','10','11','12','13']) },
      { ord: 1, lab: '', days: '', silent: '', ...spread(['1','1','1','2','2','2','2','2']) },
      { ord: 2, lab: 'Bahi',   days: '02/08', silent: 'current',    ...spread([0, 0, 1, 0, 0, 0, 0, 1]) },
      { ord: 3, lab: 'Chunya', days: '01/08', silent: '05d silent', ...spread([1, 0, 0, 0, 0, 0, 0, 0]) },
    ],
  }]]);
}

// Proves DETERMINISM, not correctness. Two renders of one design agree; nothing here says the
// drawing is right. Task 10 and the unit tests in `cellgrid.test.ts` carry that.
//
// ⚠ Hash `normalisePdf(buf)`, never the raw buffer. pdfkit derives `/ID` by MD5-ing
// `info.CreationDate.getTime()` at millisecond precision, and `CreationDate` defaults to real
// wall-clock time at construction. `opts.now` does not reach it. Two back-to-back renders of an
// identical design therefore differ, and only in `/ID`. That is why the digest test above
// normalises too.
it('draws a cellgrid identically across runs', async () => {
  const at = new Date('2026-01-15T09:00:00Z');
  const a = await renderReportDesignPdf(cellGridDesign(), cellGridResolved(), { now: at });
  const b = await renderReportDesignPdf(cellGridDesign(), cellGridResolved(), { now: at });
  expect(createHash('sha256').update(normalisePdf(a)).digest('hex'))
    .toBe(createHash('sha256').update(normalisePdf(b)).digest('hex'));
  expect(a.length).toBeGreaterThan(1000);
});

// ⛔ Asserts the chunk count directly. It does NOT scrape the rendered PDF for `Page 5 / 5`:
// pdfkit FlateDecodes every content stream and splits text runs at kerning pairs inside `[...] TJ`
// arrays, so a plain string never appears in the bytes. `index.test.ts` documents that and carries
// `decodedContent`/`textsOf` helpers for the cases that genuinely need it. This one does not, and
// a direct assertion says what it means.
it('paginates a cellgrid whose rows exceed its rect', async () => {
  const many = cellGridResolved();
  const q = many.get('grid') as { columns: unknown[]; rows: Record<string, unknown>[] };
  for (let i = 0; i < 40; i += 1) {
    q.rows.push({ ord: 100 + i, lab: `Extra ${i}`, days: '00/08', silent: '08d silent',
      ...Object.fromEntries(Array.from({ length: 8 }, (_, k) => [`d${String(k + 1).padStart(2, '0')}`, 0])) });
  }
  const el = cellGridDesign().pages[0].elements.find((e) => e.id === 'grid')!;
  // 200px@96 = 150pt; (150 - 13) / 12.75 = 10 rows a chunk; 42 records => 5 chunks
  expect(tableChunkCount(el, many.get('grid'))).toBe(5);
  const buf = await renderReportDesignPdf(cellGridDesign(), many, { now: new Date('2026-01-15T09:00:00Z') });
  expect(buf.length).toBeGreaterThan(1000);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @openldr/report-designer test -- golden.test.ts`
Expected: the two new tests PASS, and the existing untouched-design digest test PASSES unchanged.

If the digest test fails, Tasks 6 to 8 changed the shared path. That is the bug. Fix the code, not the digest.

- [ ] **Step 3: Commit**

```bash
git add packages/report-designer/src/render/golden.test.ts
git commit -m "test(report-designer): golden coverage for cellgrid drawing and pagination"
```

---

### Task 10: Prove the calendar is the same element

**Files:**
- Modify: `packages/report-designer/src/render/golden.test.ts`

This is the task the slice exists for. Spec §2.4: if the month calendar needs a special case in the renderer, the `cellgrid` contract is wrong and slices 2 to 4 must not be built on it.

- [ ] **Step 1: Write the test**

Append to `golden.test.ts`:

```ts
/**
 * The month calendar from the approved design, expressed as a `cellgrid` in a DIFFERENT
 * configuration: seven cell columns, one row per week, no label column, five palette steps instead
 * of one, and no grouping.
 *
 * ⛔ If this needs anything added to `drawCellGrid`, the contract in spec §2.4 is wrong and slices 2
 * to 4 must not be built on it. Passing WITHOUT a production change is the assertion.
 */
function calendarDesign(): ReportDesign {
  return {
    id: 'cal', name: 'Calendar', status: 'published', paper: 'A4', orientation: 'portrait',
    parameters: [],
    pages: [{
      id: 'p1',
      elements: [
        { id: 'cal', kind: 'cellgrid', name: 'cal', rect: { x: 48, y: 60, w: 200, h: 120 },
          dataSource: { kind: 'custom-query', queryId: 'q' },
          sortBy: 'ord',
          cellColumns: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
          palette: { ramp: 'blue', steps: 5 } },
      ],
    }],
    pageNumbers: false,
  };
}

function calendarResolved(): Map<string, ResolvedTable> {
  const week = (ord: number, vals: (string | number)[]) =>
    ({ ord, ...Object.fromEntries(vals.map((v, i) => [`c${i + 1}`, v])) });
  // Element id, not query id. Same reason as `cellGridResolved` above.
  return new Map([['cal', {
    columns: Array.from({ length: 7 }, (_, i) => ({ key: `c${i + 1}`, label: '' })),
    rows: [
      week(0, ['M', 'T', 'W', 'T', 'F', 'S', 'S']),
      week(1, [0, 0, 0, 0, 0, 0, 1]),   // July 2018 starts on a Sunday
      week(2, [4, 1, 0, 0, 1, 0, 0]),
      week(3, [0, 0, 0, 5, 0, 0, 0]),
      week(4, [0, 0, 0, 0, 1, 0, 0]),
      week(5, [1, 1, 1, 2, 0, 0, 0]),
      week(6, [3, 2, 0, 0, 0, 0, 0]),
    ],
  }]]);
}

it('draws a month calendar as the same element in a second configuration', async () => {
  const buf = await renderReportDesignPdf(calendarDesign(), calendarResolved(), {
    now: new Date('2026-01-15T09:00:00Z'),
  });
  expect(buf.length).toBeGreaterThan(500);
});

it('keeps a calendar on one page: six weeks fit its rect', () => {
  const el = calendarDesign().pages[0].elements[0];
  expect(tableChunkCount(el, calendarResolved().get(el.id))).toBe(1);
});

it('scales the ramp across the whole calendar rather than per chunk', () => {
  // The maximum is 5. At steps: 5 the busiest day lands on the darkest step, and a 1 must not.
  expect(cellFill(5, 5, { ramp: 'blue', steps: 5 })).toBe('#185FA5');
  expect(cellFill(1, 5, { ramp: 'blue', steps: 5 })).not.toBe('#185FA5');
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @openldr/report-designer test -- golden.test.ts`
Expected: PASS with **no production change**.

**If it does not pass, stop.** Write down what the calendar needed that the grid did not, and take it back to the spec before starting slice 2. That decision is the point of this task.

- [ ] **Step 3: Run the full gate**

Run: `pnpm turbo run test`

Do not pipe this through `tail`; it truncates the failure list and hides which package failed. A failure here is usually a timeout rather than a regression, so grep the output for `Test timed out` and re-run that package alone before blaming a change.

- [ ] **Step 4: Commit**

```bash
git add packages/report-designer/src/render/golden.test.ts
git commit -m "test(report-designer): prove a month calendar is a cellgrid configuration"
```

---

## Done when

- `pnpm --filter @openldr/report-designer test` passes.
- `pnpm turbo run test` passes.
- The untouched-design digest in `golden.test.ts` is **unchanged**, proving no existing report moved a byte.
- Task 10 passes with no production change, settling spec §2.4.

## Explicitly not in this slice

Report design, queries, parameters, `q-regions`, the `keyvalue` `layout: 'stat'` addition, CLI, docs, studio, mobile and the changelog. No seeded report changes, so nothing user-visible ships from slice 1. That is deliberate: it means slice 1 cannot break a report that renders today.

## Known gaps this slice does not close

- **The worst-case geometry is asserted as arithmetic, not as a rendered page.** `cellGridWidth` is checked against 514pt in Task 2, but no test renders a real 23-column month against a real A4 portrait body. That belongs in slice 2, where a design with a real rect exists to check.
- **The greyscale claim in `EMPTY_FILL`'s comment is computed, not printed.** Nobody has run it through the printer these reports are signed on.
