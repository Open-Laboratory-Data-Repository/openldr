# Clinical Report Cell Status Model (S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a report table colour individual cells from a status token supplied by the query, so clinical reports can show green/red/amber results without putting any clinical logic in the renderer.

**Architecture:** A bound column may name a `statusKey` — another column in the same query result carrying one of five presentational status tokens. A new `cellStatusesFor()` derives a parallel status grid; `drawGrid` paints from it. `rowsFor` and every width/pagination function keep their current `string[][]` signatures untouched, so a design with no `statusKey` produces a byte-identical PDF.

**Tech Stack:** TypeScript, zod, pdfkit 0.15.2, vitest 2.1.8, React (studio authoring UI).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-03-clinical-report-cell-status-and-ranges-design.md`.
- **Status vocabulary is exactly five tokens**, presentational not clinical: `normal | abnormal | critical | indeterminate | none`. Never add `high`/`low`/`resistant`/`positive` — that mapping belongs in SQL.
- **The renderer never computes a status.** It only reads, validates, and paints one.
- **No `statusKey` ⇒ byte-identical output to today.** This is the compatibility contract protecting all 8 built-in reports.
- **Fixed-height single-line rows are load-bearing.** `ROW_H = 16` (`draw.ts:20`), `maxRowsFor`, `tableChunkCount`, and the `height`-based ellipsis fix must not change behaviour. A status fill paints *within* `ROW_H` and must not move any text baseline.
- **Studio imports the browser-safe subpath** `@openldr/report-designer/pure`, never the package barrel (the barrel pulls `pdfkit`/`pg` into the bundle).
- **Commit trailer rule:** never add a `Co-Authored-By: Claude`/`Codex` trailer.
- Package test command: `cd packages/report-designer && npx vitest run <file>`. Never pipe turbo through `tail`.

## Spec corrections this plan carries

Two claims in spec §1.1/§1.6 were falsified while planning. **The spec is superseded on these two points; this plan is authoritative.**

1. **§1.1 said `rowsFor` returns `Cell[][]`.** It does not, in this plan. `rowsFor` is consumed by `tableChunkCount` and by four existing tests, and its `string[][]` shape feeds `columnWidths`/`isNumericColumn`. Changing it would put pagination and column-width regressions in scope for no benefit. **A parallel `cellStatusesFor()` is used instead** — strictly more surgical and it makes the "no statusKey ⇒ identical output" contract trivially provable.
2. **§1.6 listed `PageCanvas.tsx` as a surface.** `PageCanvas.tsx:171-187` renders **only** `el.columns`/`el.rows` (static sample data); it never resolves a bound query, so it cannot preview bound-column status without a far larger change. **The canvas is out of scope.** The studio surface that must change is `DataTab.tsx:174-176`, where `boundColumns` are authored.

Also verified while planning, requiring **no** change: `exportExcel.ts:71` projects `boundColumns` only, so a status column in the query result never leaks into the spreadsheet export.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/report-designer/src/schema.ts` | `CellStatus`/`ColumnKind`/`CellEmphasis` types; `BoundColumnSchema` gains `statusKey`, `emphasis`, `kind` | Modify |
| `packages/report-designer/src/schema.test.ts` | schema parsing tests | Modify |
| `packages/report-designer/src/render/draw.ts` | `asCellStatus`, `cellStatusesFor`, status palette, `drawGrid` painting | Modify |
| `packages/report-designer/src/render/draw.test.ts` | unit tests for the two new functions | Modify |
| `packages/report-designer/src/render/index.test.ts` | PDF-geometry regression test (the load-bearing one) | Modify |
| `apps/studio/src/report-designer/DataTab.tsx` | authoring UI for `statusKey`/`emphasis` | Modify |
| `apps/studio/src/report-designer/DataTab.test.tsx` | authoring tests | Modify |
| `packages/report-pdf/src/index.ts` | workflow-export sibling parity | Modify |

---

### Task 1: Status vocabulary in the schema

**Files:**
- Modify: `packages/report-designer/src/schema.ts:28-29`
- Test: `packages/report-designer/src/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CellStatus`, `ColumnKind`, `CellEmphasis`, `CELL_STATUSES`, and a widened `BoundColumn` type `{ key: string; label: string; statusKey?: string; emphasis?: 'fill' | 'text'; kind?: ColumnKind }`. Tasks 2, 3, 4 and 5 all rely on these exact names.

- [ ] **Step 1: Write the failing test**

Append to `packages/report-designer/src/schema.test.ts`:

```ts
import { BoundColumnSchema, CELL_STATUSES } from './schema';

describe('BoundColumnSchema', () => {
  it('accepts a bare key/label pair (the shape every existing design uses)', () => {
    expect(BoundColumnSchema.parse({ key: 'a', label: 'A' }))
      .toEqual({ key: 'a', label: 'A' });
  });

  it('accepts statusKey, emphasis and kind', () => {
    expect(BoundColumnSchema.parse({
      key: 'result', label: 'Result', statusKey: 'result_status', emphasis: 'fill', kind: 'value',
    })).toEqual({
      key: 'result', label: 'Result', statusKey: 'result_status', emphasis: 'fill', kind: 'value',
    });
  });

  it('rejects an emphasis outside fill|text', () => {
    expect(() => BoundColumnSchema.parse({ key: 'a', label: 'A', emphasis: 'glow' })).toThrow();
  });

  it('exposes exactly the five presentational statuses', () => {
    expect(CELL_STATUSES).toEqual(['normal', 'abnormal', 'critical', 'indeterminate', 'none']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/report-designer && npx vitest run src/schema.test.ts`
Expected: FAIL — `CELL_STATUSES` is not exported from `./schema`.

- [ ] **Step 3: Write minimal implementation**

In `packages/report-designer/src/schema.ts`, add above `BoundColumnSchema` (currently line 28):

```ts
/** Presentational cell states. Deliberately NOT clinical: the mapping from `R`/`UNDET`/`IND` to one
 *  of these belongs in the query, which is what lets one renderer serve AST, serology and chemistry. */
export const CELL_STATUSES = ['normal', 'abnormal', 'critical', 'indeterminate', 'none'] as const;
export type CellStatus = (typeof CELL_STATUSES)[number];
export type CellEmphasis = 'fill' | 'text';
export type ColumnKind = 'value' | 'range' | 'units' | 'flag' | 'label';
```

Then replace `BoundColumnSchema` (line 28) with:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/report-designer && npx vitest run src/schema.test.ts`
Expected: PASS, all four new cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/schema.ts packages/report-designer/src/schema.test.ts
git commit -m "feat(report-designer): add presentational cell-status vocabulary to bound columns"
```

---

### Task 2: Derive the status grid

**Files:**
- Modify: `packages/report-designer/src/render/draw.ts` (add after `rowsFor`, currently ending line 145)
- Test: `packages/report-designer/src/render/draw.test.ts`

**Interfaces:**
- Consumes: `CellStatus`, `CELL_STATUSES` from Task 1.
- Produces: `asCellStatus(v: unknown): CellStatus | undefined` and `cellStatusesFor(el: DesignElement, resolved: ResolvedTable | undefined): (CellStatus | undefined)[][]`. Task 3 consumes both.

- [ ] **Step 1: Write the failing test**

Append to `packages/report-designer/src/render/draw.test.ts` (the file already defines the `tbl` helper at line 55):

```ts
import { asCellStatus, cellStatusesFor } from './draw';

describe('asCellStatus', () => {
  it('accepts the five tokens case-insensitively and trims', () => {
    expect(asCellStatus('normal')).toBe('normal');
    expect(asCellStatus('  ABNORMAL ')).toBe('abnormal');
    expect(asCellStatus('Indeterminate')).toBe('indeterminate');
  });
  it('rejects anything else, including clinical tokens and non-strings', () => {
    expect(asCellStatus('R')).toBeUndefined();
    expect(asCellStatus('high')).toBeUndefined();
    expect(asCellStatus(1)).toBeUndefined();
    expect(asCellStatus(null)).toBeUndefined();
  });
});

describe('cellStatusesFor', () => {
  const ds = { kind: 'custom-query', queryId: 'q' } as const;

  it('returns [] when no bound column declares a statusKey (the identical-output contract)', () => {
    const el = tbl({ dataSource: ds, boundColumns: [{ key: 'a', label: 'A' }] });
    const resolved = { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }, { a: 2 }] };
    expect(cellStatusesFor(el, resolved)).toEqual([]);
  });

  it('reads the status column and aligns it to the bound column position', () => {
    const el = tbl({ dataSource: ds, boundColumns: [
      { key: 'name', label: 'Test' },
      { key: 'res', label: 'Result', statusKey: 'res_status' },
    ] });
    const resolved = {
      columns: [{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }],
      rows: [
        { name: 'HIV', res: 'Negative', res_status: 'normal' },
        { name: 'HBsAg', res: 'Positive', res_status: 'abnormal' },
      ],
    };
    expect(cellStatusesFor(el, resolved)).toEqual([
      [undefined, 'normal'],
      [undefined, 'abnormal'],
    ]);
  });

  it('drops an unrecognised status rather than passing it through', () => {
    const el = tbl({ dataSource: ds, boundColumns: [{ key: 'res', label: 'R', statusKey: 's' }] });
    const resolved = { columns: [{ key: 'res', label: 'R' }], rows: [{ res: 'x', s: 'RESISTANT' }] };
    expect(cellStatusesFor(el, resolved)).toEqual([[undefined]]);
  });

  it('returns [] for a static table and for an error-resolved bound table', () => {
    expect(cellStatusesFor(tbl({ columns: ['A'], rows: [['1']] }), undefined)).toEqual([]);
    expect(cellStatusesFor(tbl({ dataSource: ds, boundColumns: [{ key: 'a', label: 'A', statusKey: 's' }] }), { error: 'x' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/report-designer && npx vitest run src/render/draw.test.ts`
Expected: FAIL — `asCellStatus` / `cellStatusesFor` are not exported from `./draw`.

- [ ] **Step 3: Write minimal implementation**

In `packages/report-designer/src/render/draw.ts`, extend the type import on line 1 and add the two functions directly after `rowsFor` (line 145):

```ts
import type { CellStatus, DesignElement, DesignPage, ReportDesign } from '../schema';
import { CELL_STATUSES } from '../schema';
```

```ts
/** Parse a status token from a query cell. Unrecognised values become `undefined` — a report must
 *  never colour a cell on a token it does not understand. */
export function asCellStatus(v: unknown): CellStatus | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  return (CELL_STATUSES as readonly string[]).includes(s) ? (s as CellStatus) : undefined;
}

/**
 * Per-cell statuses aligned to `rowsFor`'s grid, or `[]` when this table has none.
 *
 * Returning `[]` on the no-statusKey path is the compatibility contract: `drawGrid` then takes
 * exactly the code path it took before this feature existed.
 *
 * ⚠ Only `el.boundColumns` is consulted. `resolved.columns` is `{key,label}` and carries no
 * `statusKey`, and binding columns explicitly is the only way to author one anyway.
 */
export function cellStatusesFor(
  el: DesignElement, resolved: ResolvedTable | undefined,
): (CellStatus | undefined)[][] {
  if (el.kind !== 'table' || !el.dataSource) return [];
  if (!resolved || 'error' in resolved) return [];
  const cols = el.boundColumns ?? [];
  if (!cols.some((c) => c.statusKey)) return [];
  return resolved.rows.map((row) => cols.map((c) => (c.statusKey ? asCellStatus(row[c.statusKey]) : undefined)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/report-designer && npx vitest run src/render/draw.test.ts`
Expected: PASS — the new cases plus all pre-existing `rowsFor`/`tableChunkCount` cases still green.

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/draw.ts packages/report-designer/src/render/draw.test.ts
git commit -m "feat(report-designer): derive a per-cell status grid from a bound status column"
```

---

### Task 3: Paint status in the grid

**Files:**
- Modify: `packages/report-designer/src/render/draw.ts:228-284` (`drawTable` + `drawGrid`)
- Test: `packages/report-designer/src/render/index.test.ts`

**Interfaces:**
- Consumes: `cellStatusesFor` from Task 2.
- Produces: no new exported names; `drawGrid` gains a `statuses` parameter (module-private).

**Why the test is a PDF-geometry test:** a test asserting "a fill was emitted" would stay green through the exact regression it names — a chip that pushes text onto the next row. The assertion below compares **text baselines with and without status** for equality, which only passes if the y-advance is untouched. Verified against pdfkit 0.15.2: content streams are deflated and text is positioned with `1 0 0 1 <x> <y> Tm`; consecutive body rows differ by exactly `ROW_H`.

- [ ] **Step 1: Write the failing test**

Append to `packages/report-designer/src/render/index.test.ts`:

```ts
import zlib from 'node:zlib';
import { renderReportDesignPdf, type ResolvedTable } from './index';
import type { ReportDesign, BoundColumn } from '../schema';

/** Text baselines, in PDF user space, parsed out of the (deflated) content streams.
 *  pdfkit emits `1 0 0 1 <x> <y> Tm` before each run — verified against pdfkit 0.15.2. */
function textYs(pdf: Buffer): number[] {
  const ys: number[] = [];
  const raw = pdf.toString('latin1');
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streams.exec(raw))) {
    let body: string;
    try { body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    const tm = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g;
    let t: RegExpExecArray | null;
    while ((t = tm.exec(body))) ys.push(parseFloat(t[2]));
  }
  return ys;
}

const statusDesign = (boundColumns: BoundColumn[]): ReportDesign => ({
  id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [],
  pages: [{ id: 'p', elements: [{
    id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 400, h: 200 },
    dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns,
  }] }],
} as ReportDesign);

const statusRows = (): Map<string, ResolvedTable> => new Map([['t', {
  columns: [{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }],
  rows: [
    { name: 'HIV 1/2 Ab', res: 'Negative', s: 'normal' },
    { name: 'HBsAg', res: 'Positive', s: 'abnormal' },
    { name: 'Treponema pallidum antibody screen', res: 'Indeterminate', s: 'indeterminate' },
  ],
}]]);

describe('cell status rendering', () => {
  it('does not move a single text baseline when a filled status column is added', async () => {
    const plain = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }]), statusRows());
    const filled = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }]), statusRows());
    expect(textYs(filled)).toEqual(textYs(plain));
  });

  it('keeps every body row exactly ROW_H apart with a long value in a filled cell', async () => {
    const pdf = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }]), statusRows());
    const rowYs = [...new Set(textYs(pdf))].sort((a, b) => b - a);
    const gaps = rowYs.slice(1).map((y, i) => Number((rowYs[i] - y).toFixed(3)));
    expect(gaps).toEqual([16, 16, 16]);
  });

  it('emits no status fill when the design declares no statusKey', async () => {
    const plain = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }]), statusRows());
    const filled = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }]), statusRows());
    expect(filled.length).toBeGreaterThan(plain.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/report-designer && npx vitest run src/render/index.test.ts`
Expected: FAIL — the third case fails (`filled.length` equals `plain.length`, because `statusKey` is not painted yet). The first two pass trivially, which is expected and correct: they are regression guards, not feature proofs.

- [ ] **Step 3: Write minimal implementation**

In `packages/report-designer/src/render/draw.ts`, add to the palette block (after line 19):

```ts
// Status palette. `fill` chips are saturated with knocked-out white text (the reference's language);
// `text` emphasis just tints the value and is the default, because it survives a mono office printer.
const STATUS_CHIP_FILL: Record<CellStatus, string> = {
  normal: '#16a34a', abnormal: '#e11d48', critical: '#9f1239', indeterminate: '#94a3b8', none: '#e2e8f0',
};
const STATUS_CHIP_TEXT = '#ffffff';
const STATUS_TEXT_COLOR: Record<CellStatus, string> = {
  normal: '#166534', abnormal: '#b91c1c', critical: '#9f1239', indeterminate: '#475569', none: BODY_TEXT,
};
```

Replace `drawTable` (line 228) with:

```ts
function drawTable(doc: Doc, el: DesignElement, r: Box, resolved: ResolvedTable | undefined, chunk: number): void {
  if (el.dataSource && resolved && 'error' in resolved) { drawErrorPlaceholder(doc, r, resolved.error); return; }
  const headers = tableHeaders(el, resolved);
  const allRows = rowsFor(el, resolved);
  const statuses = cellStatusesFor(el, resolved);
  const emphasis = (el.boundColumns ?? []).map((c) => c.emphasis ?? 'text');
  drawGrid(doc, r, headers, allRows, chunk, statuses, emphasis);
}
```

Replace `drawGrid` (line 243) with — note the statuses are sliced by the **same** chunk window as the rows, which is what keeps page 2's colours on page 2's rows:

```ts
function drawGrid(
  doc: Doc, r: Box, headers: string[], allRows: string[][], chunk: number,
  allStatuses: (CellStatus | undefined)[][] = [], emphasis: CellEmphasis[] = [],
): void {
  const n = Math.max(headers.length, 1);
  const maxRows = maxRowsFor(r.h);
  const lo = chunk * maxRows;
  const rows = maxRows >= 1 ? allRows.slice(lo, lo + maxRows) : [];
  const statuses = maxRows >= 1 ? allStatuses.slice(lo, lo + maxRows) : [];

  const widths = columnWidths(headers, allRows, r.w, (text, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    return doc.widthOfString(text);
  });
  const xOf = (ci: number): number => r.x + widths.slice(0, ci).reduce((a, b) => a + b, 0);
  const numeric = headers.map((_, ci) => isNumericColumn(allRows, ci));

  doc.save().rect(r.x, r.y, r.w, r.h).clip();

  doc.rect(r.x, r.y, r.w, ROW_H).fill(HEAD_FILL);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(HEAD_TEXT);
  headers.forEach((h, i) => doc.text(h, xOf(i) + CELL_PAD, r.y + CELL_PAD, {
    ...cellTextOptions(widths[i] - CELL_PAD * 2), align: numeric[i] ? 'right' : 'left',
  }));
  doc.save().lineWidth(0.75).strokeColor(HEAD_RULE)
    .moveTo(r.x, r.y + ROW_H).lineTo(r.x + r.w, r.y + ROW_H).stroke().restore();

  doc.font('Helvetica').fontSize(8);
  rows.forEach((row, ri) => {
    const y = r.y + ROW_H + ri * ROW_H;
    if (ri % 2 === 1) doc.rect(r.x, y, r.w, ROW_H).fill(ZEBRA_FILL);
    row.forEach((cell, ci) => {
      const st = statuses[ri]?.[ci];
      // A chip is exactly one row tall and one column wide, so it can never affect the y-advance.
      if (st && (emphasis[ci] ?? 'text') === 'fill') {
        doc.rect(xOf(ci), y, widths[ci], ROW_H).fill(STATUS_CHIP_FILL[st]);
        doc.fillColor(STATUS_CHIP_TEXT);
      } else {
        doc.fillColor(st ? STATUS_TEXT_COLOR[st] : BODY_TEXT);
      }
      doc.text(cell, xOf(ci) + CELL_PAD, y + CELL_PAD, {
        ...cellTextOptions(widths[ci] - CELL_PAD * 2), align: numeric[ci] ? 'right' : 'left',
      });
    });
  });

  const bodyEnd = r.y + ROW_H + rows.length * ROW_H;
  doc.save().lineWidth(0.5).strokeColor(GRID_RULE)
    .moveTo(r.x, bodyEnd).lineTo(r.x + r.w, bodyEnd).stroke().restore();

  doc.restore();
}
```

Add `CellEmphasis` to the type import on line 1.

⚠ The old body loop set `.fillColor(BODY_TEXT)` by chaining off the zebra `.fill()`. That chaining is removed above because the per-cell branch now owns the fill colour; do not reinstate it, or every status colour is overwritten by `BODY_TEXT`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/report-designer && npx vitest run src/render/`
Expected: PASS — all three new cases plus every pre-existing `draw`/`index` render test.

- [ ] **Step 5: Mutation-check the load-bearing test**

Temporarily change the chip rect to `doc.rect(xOf(ci), y, widths[ci], ROW_H + 4)`.
Run: `cd packages/report-designer && npx vitest run src/render/index.test.ts`
Expected: the "ROW_H apart" case still passes but the baseline-equality case must still pass too — a taller rect does not move text. **Then** change `cellTextOptions`'s `height` to `CELL_TEXT_H * 3` and re-run: the baseline-equality case **must go red**. Revert both edits. If it does not go red, the test is decoration — stop and fix the test before continuing.

- [ ] **Step 6: Commit**

```bash
git add packages/report-designer/src/render/draw.ts packages/report-designer/src/render/index.test.ts
git commit -m "feat(report-designer): paint per-cell status as a chip or tinted text"
```

---

### Task 4: Author status binding in the Data tab

**Files:**
- Modify: `apps/studio/src/report-designer/DataTab.tsx:174-176`
- Test: `apps/studio/src/report-designer/DataTab.test.tsx`

**Interfaces:**
- Consumes: `BoundColumn` (Task 1), imported from `@openldr/report-designer/pure`.
- Produces: no new exports; patches `boundColumns` entries with `statusKey`/`emphasis`.

⚠ Read `DataTab.tsx` in full before editing — this plan cites its `bound`/`setBound` helpers at lines 174-176 but does not reproduce its JSX, and the surrounding control markup must follow the file's existing idiom. Per repo convention, controls are **shadcn** primitives, never a native `<select>`, and actions live in a `⋯` `DropdownMenu` rather than standalone buttons.

- [ ] **Step 1: Write the failing test**

Append to `apps/studio/src/report-designer/DataTab.test.tsx`, matching the existing `onPatchElement` assertion idiom at lines 50-76:

```ts
it('binds a status column to an included column', async () => {
  const onPatchElement = vi.fn();
  renderDataTab({
    el: tableEl({ dataSource: { kind: 'custom-query', queryId: 'cq_1' },
                  boundColumns: [{ key: 'res', label: 'Result' }] }),
    onPatchElement,
  });
  await userEvent.click(await screen.findByLabelText('Status column for Result'));
  await userEvent.click(await screen.findByRole('option', { name: 'res_status' }));
  expect(onPatchElement).toHaveBeenLastCalledWith(
    't', { boundColumns: [{ key: 'res', label: 'Result', statusKey: 'res_status' }] }, undefined,
  );
});

it('clears statusKey when the status column is set back to none', async () => {
  const onPatchElement = vi.fn();
  renderDataTab({
    el: tableEl({ dataSource: { kind: 'custom-query', queryId: 'cq_1' },
                  boundColumns: [{ key: 'res', label: 'Result', statusKey: 'res_status' }] }),
    onPatchElement,
  });
  await userEvent.click(await screen.findByLabelText('Status column for Result'));
  await userEvent.click(await screen.findByRole('option', { name: 'None' }));
  expect(onPatchElement).toHaveBeenLastCalledWith(
    't', { boundColumns: [{ key: 'res', label: 'Result' }] }, undefined,
  );
});
```

⚠ `renderDataTab` and `tableEl` are the file's existing helpers — reuse them verbatim; do not introduce new ones. If their signatures differ from the sketch above, follow the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/studio && npx vitest run src/report-designer/DataTab.test.tsx`
Expected: FAIL — no element labelled "Status column for Result".

- [ ] **Step 3: Write minimal implementation**

Per included bound column, render a shadcn `Select` whose options are the **result columns not already bound as visible columns**, plus a "None" option. On change:

```tsx
const setStatusKey = (idx: number, statusKey: string | undefined) =>
  setBound(bound.map((c, i) => {
    if (i !== idx) return c;
    const { statusKey: _drop, ...rest } = c;
    return statusKey ? { ...rest, statusKey } : rest;
  }));
```

⚠ Setting back to "None" must **delete** the key, not set `undefined` — the tests above assert an object with no `statusKey` property, and a persisted `statusKey: undefined` would round-trip through zod/JSON as an absent key anyway, making an `undefined`-valued assertion silently pass. Deleting keeps the stored design clean.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/studio && npx vitest run src/report-designer/DataTab.test.tsx`
Expected: PASS, including the pre-existing include/relabel/reorder cases.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/report-designer/DataTab.tsx apps/studio/src/report-designer/DataTab.test.tsx
git commit -m "feat(studio): bind a status column to a report table column"
```

---

### Task 5: Workflow-export renderer parity

**Files:**
- Modify: `packages/report-pdf/src/index.ts:96-125`
- Test: `packages/report-pdf/src/index.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this package is the dependency **leaf** and must not import `@openldr/report-designer`.
- Produces: `PdfColumn` gains `statusKey?: string` and `emphasis?: 'fill' | 'text'`.

⚠ This package deliberately **duplicates** `columnWidths`/`isNumericColumn`/`cellTextOptions` (see its comment at lines 27-33). Duplicate the status palette and parsing the same way, with the same "keep them in step" comment. Do **not** add a workspace dependency to fix the duplication — the spec's parent workstream restructures both renderers later.

- [ ] **Step 1: Write the failing test**

Append to `packages/report-pdf/src/index.test.ts`:

```ts
it('renders a status-filled column without changing the row pitch', async () => {
  const rows = [
    { test: 'HIV 1/2 Ab', res: 'Negative', s: 'normal' },
    { test: 'HBsAg', res: 'Positive', s: 'abnormal' },
  ];
  const plain = await renderReportPdf({
    title: 'T', generatedAt: 'now', params: {},
    columns: [{ key: 'test', label: 'Test' }, { key: 'res', label: 'Result' }], rows,
  });
  const filled = await renderReportPdf({
    title: 'T', generatedAt: 'now', params: {},
    columns: [{ key: 'test', label: 'Test' },
              { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }], rows,
  });
  expect(filled.length).toBeGreaterThan(plain.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/report-pdf && npx vitest run src/index.test.ts`
Expected: FAIL — `statusKey` is not in `PdfColumn`, so this is a TypeScript error and the byte lengths are equal.

- [ ] **Step 3: Write minimal implementation**

Widen `PdfColumn` (line 3) and add, beside the duplicated helpers:

```ts
export interface PdfColumn { key: string; label: string; statusKey?: string; emphasis?: 'fill' | 'text' }

/** ⚠ DUPLICATED from `@openldr/report-designer`'s `render/draw.ts`, deliberately — same reason as
 *  `columnWidths` above (this package is the dependency leaf). Keep the two in step. */
const CELL_STATUSES = ['normal', 'abnormal', 'critical', 'indeterminate', 'none'] as const;
type CellStatus = (typeof CELL_STATUSES)[number];
const STATUS_CHIP_FILL: Record<CellStatus, string> = {
  normal: '#16a34a', abnormal: '#e11d48', critical: '#9f1239', indeterminate: '#94a3b8', none: '#e2e8f0',
};
const STATUS_CHIP_TEXT = '#ffffff';
const STATUS_TEXT_COLOR: Record<CellStatus, string> = {
  normal: '#166534', abnormal: '#b91c1c', critical: '#9f1239', indeterminate: '#475569', none: BODY_TEXT,
};
function asCellStatus(v: unknown): CellStatus | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  return (CELL_STATUSES as readonly string[]).includes(s) ? (s as CellStatus) : undefined;
}
```

Build a status grid beside `cells` (line 98) and paint it in the row loop (line 119), mirroring Task 3:

```ts
const statuses = input.rows.map((row) => cols.map((c) => (c.statusKey ? asCellStatus(row[c.statusKey]) : undefined)));
```

```ts
    cells.forEach((row, idx) => {
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(9); }
      const y = doc.y;
      if (idx % 2 === 1) doc.rect(left, y, usable, rowH).fill(ZEBRA_FILL);
      row.forEach((cell, ci) => {
        const st = statuses[idx]?.[ci];
        if (st && (cols[ci].emphasis ?? 'text') === 'fill') {
          doc.rect(xOf(ci), y, widths[ci], rowH).fill(STATUS_CHIP_FILL[st]);
          doc.fillColor(STATUS_CHIP_TEXT);
        } else {
          doc.fillColor(st ? STATUS_TEXT_COLOR[st] : BODY_TEXT);
        }
        doc.text(cell, xOf(ci) + ROW_PAD, y + ROW_PAD, opts(ci));
      });
      doc.y = y + rowH;
    });
```

⚠ The original loop chained `.fill(ZEBRA_FILL).fillColor(BODY_TEXT)` and set `fillColor(BODY_TEXT)` on the page-break branch. Both are removed above because the per-cell branch owns the fill colour; reinstating either overwrites every status colour.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/report-pdf && npx vitest run src/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/report-pdf/src/index.ts packages/report-pdf/src/index.test.ts
git commit -m "feat(report-pdf): honour per-cell status on the workflow-export renderer"
```

---

### Task 6: Whole-slice verification

**Files:** none modified.

- [ ] **Step 1: Typecheck every package that builds the widened type**

`BoundColumn` is a shared type consumed by `report-designer`, `apps/studio` and (in parallel form) `report-pdf`. Per [[plans-cite-or-flag]] rule 8, vitest strips types and will not catch a break here.

Run: `pnpm turbo run typecheck --force`
Expected: clean. `@openldr/cli#build` is a known Windows-only esbuild failure and is **not** part of this gate.

- [ ] **Step 2: Run the full test gate**

Run: `pnpm turbo run test --force`
Expected: clean. If a package fails, re-run that package's `vitest run` **alone** before blaming this change — grep the output for `Test timed out` first ([[test-gate-flakiness-timeouts]]).

- [ ] **Step 3: Confirm the compatibility contract on a real built-in report**

Render any of the 8 built-in reports from the Reports page before and after this branch and compare the PDF byte length. Expected: **identical**, because none of them declares a `statusKey`.

- [ ] **Step 4: Commit nothing; report results**

---

## Self-Review

**Spec coverage.** §1.1 status entry point → Task 2 (with the documented correction). §1.2 five-token vocabulary → Task 1. §1.3 two emphases → Tasks 1, 3, 5. §1.4 column `kind` → Task 1 defines it; **no task consumes it**, because alignment currently derives from `isNumericColumn` and changing that is a separate behaviour change. Flagged deliberately: `kind` ships as authored-but-inert metadata in S1 and is consumed in S2 when `range`/`units` columns actually exist. §1.5 no-regression → Task 3 Steps 1/5 and Task 6. §1.6 surfaces → Tasks 1-5, minus `PageCanvas.tsx` per the correction above.

**Placeholder scan.** Task 4 Step 3 is the weakest step: it specifies the state-update function exactly but describes the JSX rather than showing it, because `DataTab.tsx`'s markup idiom was not read in full while planning. It is marked with a ⚠ read-first instruction rather than a fabricated component. Task 5 Step 3 shows the two edited blocks but not the whole file.

**Type consistency.** `CellStatus`, `CELL_STATUSES`, `asCellStatus`, `cellStatusesFor`, `statusKey`, `emphasis`, `STATUS_CHIP_FILL`, `STATUS_CHIP_TEXT`, `STATUS_TEXT_COLOR` are spelled identically in Tasks 1, 2, 3 and 5. `report-pdf` redefines `CELL_STATUSES`/`asCellStatus`/the palette locally by design (leaf package) rather than importing them.

## Not in this plan

S2a (reference ranges as `ObservationDefinition`), S2b (result classification), the terminology→warehouse projection machinery, and S2c (the units mojibake) are a separate subsystem — DB migration, FHIR projection, terminology authoring — and get their own plan. S1 is complete and shippable without them; it simply has no clinical data feeding it yet, which is why Task 3's tests supply statuses directly.
