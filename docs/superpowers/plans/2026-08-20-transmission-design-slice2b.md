# Transmission grid design (slice 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the transmission grid report look like the approved design. Turn the page A4
portrait. Replace both laboratory grids with `cellgrid` elements instead of `table`. Give
`keyvalue` a third layout, `stat`, for a future four-figure summary panel. Extend the
`sortBy` gate to cover bound `cellgrid` elements the same way it already covers `table`. Delete
the characterization test that slice 2a added to pin the week-token-row regression, because this
slice is what fixes it.

**Architecture:** Schema and renderer changes land in `packages/report-designer`. The seeded
design change lands in `packages/reporting/src/seed/report-seeds.ts`. No new package, no new
route.

**Tech Stack:** TypeScript, zod (schema), pdfkit (drawing), vitest (tests), pnpm workspaces.

**Slice boundary:** `keyvalue`'s `layout` field, `header-row.ts`'s gate, and the
`rt-transmission-grid` design. **The month calendar and the four summary figures are NOT in this
slice.** See "Investigation: the summary band's data source" below for why, and the proposed
split.

**Spec:** `docs/superpowers/specs/2026-08-20-transmission-grid-cellgrid-design.md`

**Precedes:** nothing yet drafted. **Follows:**
`docs/superpowers/plans/2026-08-20-transmission-queries-slice2a.md` (the two queries this design
binds to), which is done or nearly done on this branch (`8b6b9cf3` is its last commit; one file,
`transmission-grid-live.test.ts`, is modified but not yet committed at the time this plan was
drafted).

---

## Background the engineer needs

`packages/report-designer` owns the design schema (`schema.ts`) and the PDF renderer
(`render/draw.ts`, `render/cellgrid.ts`). `packages/reporting/src/seed/report-seeds.ts` is where
the actual `rt-transmission-grid` design and its two queries are authored as data, not code.
Neither package is `apps/studio`.

`cellgrid` already exists and already draws (slice 1,
`docs/superpowers/plans/2026-08-20-cellgrid-element-slice1.md`). The two queries it will bind to
already emit the right shape (slice 2a): two synthetic leading rows (`ord=0` dates, `ord=1` week
tokens), a numeric mark (`'1'`/`''`), `days`/`silent` per laboratory, and a unique `ord`. This
slice's job is entirely on the drawing and binding side.

**A `cellgrid` always treats row 0 of its resolved rows as a header row it never draws as data,
whether or not the design says so.** `splitCellGridRows` (`packages/report-designer/src/render/
cellgrid.ts:150`) does `header: rows[0], body: rows.slice(grouped ? 2 : 1)` unconditionally.
`table` only does this when a design opts in with `headerRow: true`. This asymmetry is exactly
why the `sortBy` gate has to widen in Task 2: an unsorted bound `cellgrid` has the same
silent-misorder exposure `table`'s `headerRow` pairing already guards against, and nothing
currently enforces it.

**Coordinates are px@96; the renderer multiplies by 0.75 to reach points.** `toPt()` in
`render/units.ts` does the conversion. Every constant inside `cellgrid.ts` and `draw.ts` is
already in points. This has shipped bugs here before (a footer placed off the bottom of two
seeded designs, cited in `render/index.ts`'s own comments), so every geometry number in this plan
states which space it is in.

Run the two packages' tests with:

```bash
pnpm --filter @openldr/report-designer test
pnpm --filter @openldr/reporting test
pnpm --filter @openldr/server test -- report-designs-routes.test.ts
```

---

## Investigation: the summary band's data source

The operator flagged this as a probable gap before any planning started. It is real, and it is
big enough to be its own slice.

**What the approved design's page 1 needs, above the two laboratory grids:**

- A month calendar: seven cell columns (one per day of week), one row per week, each cell coloured
  by how many laboratories submitted that day. `palette: { ramp: 'blue', steps: 5 }`.
- Four figures, in a `keyvalue` `layout: 'stat'` panel: laboratories in scope, percent of possible
  laboratory-days carrying data, most laboratories on one day, and how many laboratories were
  silent ten or more working days.

**Can either come from the two existing queries, unchanged?** No. Read two things to confirm
this rather than assume it: `resolveDesignTables` (`packages/report-designer/src/render/
resolve.ts:25`) runs one query per bound element and keeps whatever shape that query returns;
`keyValuePairs` (`packages/report-designer/src/render/draw.ts:479`) reads exactly `resolved.rows[0]`
for a bound `keyvalue`, one value per `boundColumns` key, and nothing else. `cellgrid` reads
every row, but always lifts row 0 as a header (see Background, above).

`q-transmission-hvleid` and `q-transmission-other` are shaped **one row per laboratory, 23
working-day columns**. Both a calendar (one row per week, all seven calendar days, a per-day
laboratory count) and a stat panel (one row, four aggregate scalars) are different shapes.
Neither is a reprojection of the existing rows; both need a new query.

**Can one new query serve both?** Technically yes, using a pattern already live in this exact
file: an `ord=0` carrier row whose `cellColumns` are blank (so nothing prints as a calendar
header) but whose extra columns carry the four aggregate figures, read by a `keyvalue` bound to
the same `queryId` with `sortBy: 'ord'` so that row is reliably first. This is not a made-up
trick; `q-transmission-hvleid` already does the same thing today, giving its date row and
week-token row blank `days`/`silent` columns purely for shape consistency with the laboratory
rows. **This plan does not recommend it.** It couples two design elements' semantics into one
row for a saving that does not materialise: every existing `SEED_QUERIES` entry duplicates its
CTEs per dialect already (nothing in this codebase shares SQL text across query ids), so writing
one query instead of two saves a query-id registration, not any SQL text. Two queries, one per
shape, match the existing convention (`q-transmission-hvleid` vs `q-transmission-other` are
already "one query per shape," not one query serving two purposes).

**Verified live, read-only, against the shared warehouse (`TARGET_DATABASE_URL`, 23,285
`diagnostic_reports`, 583 performer codes), month = `2017-08`, no panel filter (the union of both
grids' laboratories, since the summary band sits above both):**

The four figures, computed with the same CTE shape (`month_start`, `days`, `arrivals`, `labs`,
`lab_stats`) the existing queries already use, minus the panel filter:

```
labs_total            = 81   (20 hvleid + 65 other - 4 laboratories counted in both, matching
                               slice 2a's own live numbers exactly)
working_days           = 23
pct_possible_lab_days = 5.9
max_labs_one_day      = 45
silent_10_or_more     = 16
arrivals_on_weekend    = 13
```

`arrivals_on_weekend = 13` matters beyond being a number: it proves laboratories **do** submit on
Saturdays and Sundays in this warehouse, which the existing `days` CTE (Mon-Fri only) already
excludes from every laboratory's own `days`/`silent` figures. A calendar cell for a weekend day
can be non-zero. Any new "all calendar days" CTE for the calendar cannot reuse the working-day
`days` CTE; it needs its own, covering all seven days.

The calendar's week-by-day pivot, verified with the same `to_char(cal_day, 'IW')` ISO week
function `q-transmission-hvleid`'s own week-token row already uses (no new date arithmetic
needed):

```
wk 31   .  3  1  9  1  0  0
wk 32   0  1  2  0  1  1  1
wk 33   1  5  1  3  4  5  2
wk 34   0  5  4  5  0  1  3
wk 35  45  7  5  6  .  .  .
```

(Columns are Mon..Sun; `.` marks a calendar day outside the month. Row `wk 35`'s `45` matches
`max_labs_one_day` above, a cross-check that both queries agree.) This confirms the pivot is
straightforward SQL, not a research problem. What it is not, is free: it is a new query, in the
same three dialects the existing ones are written in.

**Verdict: two new queries are needed, one for the calendar and one for the four figures, each in
postgres/mssql/mysql, matching AGENTS.md's cost rules and this project's own convention for the
two existing queries.** That is six new SQL variants, comparable in size to all of slice 2a
(`docs/superpowers/plans/2026-08-20-transmission-queries-slice2a.md`, itself four dedicated
tasks plus live verification plus shape tests plus fixture tests). Folding that into this slice,
on top of Tasks 1 through 4 below, would roughly double this slice's size.

**Recommendation: split.** This plan (2b) ships the two laboratory grids as portrait `cellgrid`
elements, which is the core of the approved design and the piece slice 2a's queries already
support. A follow-up slice, referred to here as 2c and not yet drafted, would add:

- `q-transmission-calendar` and `q-transmission-summary` (working names), three dialects each.
- The calendar `cellgrid` (no `labelColumn`, seven `cellColumns`, `palette: { ramp: 'blue', steps: 5 }`).
- The four-figure `keyvalue` panel using `layout: 'stat'` (built in Task 1 below, so 2c does not
  also need a renderer change).
- Live verification of both new queries against the same warehouse, the same discipline slice 2a
  used.
- Vertical page-1 geometry that now has to fit letterhead, scope panel, calendar, four figures,
  and both laboratory grids. This plan's own vertical geometry for the two grids (Task 4) already
  uses most of the available portrait height; 2c's geometry has to renegotiate that split, not
  assume this slice's numbers survive unchanged.

This is a recommendation, not a decision this plan makes on the operator's behalf. If the
operator wants the summary band folded into this same slice instead, Tasks 1 through 4 below are
unaffected either way; only the "Explicitly not in this slice" list changes.

---

## Definition of done, mapped to AGENTS.md section 6

1. **Studio.** Not touched. `apps/studio` is out of scope for this slice; see "Known gaps" for
   what that leaves unrendered in the studio canvas.
2. **CLI parity.** No new parameter ships in this slice (`region`/`facility`/`blocks` are still
   unbuilt; `q-regions` does not exist yet, confirmed by grep). `packages/cli/src/report.ts` runs
   any report design generically and names no column layout, so it needs no change.
3. **Docs.** Grepped `apps/web/src/docs`, `apps/studio/src/i18n`, and `docs/` for `transmission`:
   no hit outside the specs/plans directories. No in-app or web doc names this report's
   orientation or column layout, so none needs updating.
4. **Mobile.** The report's run parameter sheet is unchanged (still `month` and `panels`); no new
   mobile surface. The PDF itself is not a mobile surface (spec section 6, item 4).
5. **Changelog.** Not part of this plan's tasks. Per AGENTS.md section 6, `pnpm make:changelog`
   runs after merging to `main`, not before, because the generator reads git history it cannot
   see yet.

**Migration.** None. This slice adds no column, no table, no parameter. Task 6 includes the
mechanical check.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/report-designer/src/schema.ts` | **Modify.** Add `'stat'` to `KeyValueLayout` and the `layout` enum. |
| `packages/report-designer/src/render/draw.ts` | **Modify.** `pairRects` and `drawKeyValue` learn the `stat` layout. |
| `packages/report-designer/src/render/draw.test.ts` | **Modify.** Unit tests for the `stat` branch of `pairRects`. |
| `packages/report-designer/src/render/golden.test.ts` | **Modify.** A determinism test for a rendered `stat` panel. |
| `packages/report-designer/src/header-row.ts` | **Modify.** `findUnsortedHeaderRows` also flags a bound `cellgrid` with no `sortBy`. |
| `packages/report-designer/src/header-row.test.ts` | **Modify.** Tests for the widened gate. |
| `apps/server/src/report-designs-routes.ts` | **Modify.** Error message wording no longer assumes only `headerRow` triggers the gate. |
| `apps/server/src/report-designs-routes.test.ts` | **Modify.** A route test for a bound `cellgrid` with no `sortBy`. |
| `packages/report-designer/src/render/index.ts` | **Modify.** Export `cellGridWidth` and `CELL_LABEL_W`, the same way `pairRects`/`toPt`/`paperSizePt` are already exported, so a seed test can assert its own geometry. |
| `packages/reporting/src/seed/report-seeds.ts` | **Modify.** `rt-transmission-grid` turns portrait and its two grids become `cellgrid`. |
| `packages/reporting/src/seed/report-seeds.test.ts` | **Modify.** Every test in the `rt-transmission-grid` describe blocks that assumed `table`/`landscape`/`boundColumns`, plus a new geometry-fit test. |
| `packages/reporting/src/seed/transmission-grid-live.test.ts` | **Modify.** Delete the `⛔ KNOWN GAP` characterization test; replace it with a test proving the leak is gone. |

---

### Task 1: `keyvalue` gains `layout: 'stat'`

**Files:**
- Modify: `packages/report-designer/src/schema.ts`
- Modify: `packages/report-designer/src/render/draw.ts:519-623` (`pairRects`, `drawKeyValue`)
- Modify: `packages/report-designer/src/render/draw.test.ts:454-492` (the `pairRects` describe block)
- Modify: `packages/report-designer/src/render/golden.test.ts`

This task builds the rendering capability only. No seeded design uses it yet; the four-figure
panel that will use it is deferred (see the investigation above). Building it now, proven by its
own tests, is what lets a follow-up slice consume it without a renderer change, the same split
slice 1 already used for `cellgrid` itself.

- [ ] **Step 1: Write the failing schema test**

Append to `packages/report-designer/src/schema.test.ts`:

```ts
it('accepts a keyvalue element with layout: stat', () => {
  const out = DesignElementSchema.parse({
    id: 'stats', kind: 'keyvalue', name: 'Summary', rect: { x: 0, y: 0, w: 400, h: 120 },
    layout: 'stat', panelColumns: 2,
    rows: [['Laboratories', '81'], ['Coverage', '5.9%'], ['Busiest day', '45'], ['Silent 10+d', '16']],
  });
  expect(out.layout).toBe('stat');
});

it('still rejects an unknown keyvalue layout', () => {
  expect(() => DesignElementSchema.parse({
    id: 'stats', kind: 'keyvalue', name: 'g', rect: { x: 0, y: 0, w: 10, h: 10 }, layout: 'grid',
  })).toThrow();
});
```

- [ ] **Step 2: Confirm it fails**

Run: `pnpm --filter @openldr/report-designer test -- schema.test.ts`
Expected: FAIL, `Invalid enum value. Expected 'inline' | 'stacked'`.

- [ ] **Step 3: Widen the schema**

In `packages/report-designer/src/schema.ts`, change the `KeyValueLayout` type (currently line 57)
and its doc comment:

```ts
/** How a `keyvalue` pair arranges its label against its value. `inline` puts them side by side;
 *  `stacked` puts a small uppercase label above the value, for values too long to share a line;
 *  `stat` puts a large value ABOVE a small uppercase caption, one figure per box, for a panel a
 *  reader scans by number first. */
export type KeyValueLayout = 'inline' | 'stacked' | 'stat';
```

And the `layout` field (currently line 194):

```ts
  /** `keyvalue` pair arrangement (default `inline`) */
  layout: z.enum(['inline', 'stacked', 'stat']).optional(),
```

- [ ] **Step 4: Confirm it passes**

Run: `pnpm --filter @openldr/report-designer test -- schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/schema.ts packages/report-designer/src/schema.test.ts
git commit -m "feat(report-designer): keyvalue accepts a stat layout"
```

---

- [ ] **Step 6: Write the failing `pairRects` tests**

Append to `packages/report-designer/src/render/draw.test.ts`, inside the existing
`describe('pairRects', ...)` block (currently `:454-493`):

```ts
it('stacks a stat pair value ABOVE its caption, both centred', () => {
  const box = { x: 0, y: 0, w: 200, h: 200 };
  const [p] = pairRects(box, 1, 'stat', 1, false);
  expect(p.value.y).toBeLessThan(p.label.y);
  expect(p.value.w).toBe(p.label.w);
});

it('gives every stat pair the same box width, split by panelColumns', () => {
  const box = { x: 0, y: 0, w: 200, h: 200 };
  const four = pairRects(box, 4, 'stat', 2, false);
  expect(four[0].w).toBeCloseTo(four[1].w, 5);
  expect(four[0].y).toBeCloseTo(four[1].y, 5);
  expect(four[2].y).toBeGreaterThan(four[0].y);
});
```

- [ ] **Step 7: Confirm they fail**

Run: `pnpm --filter @openldr/report-designer test -- draw.test.ts -t "pairRects"`
Expected: FAIL. `pairRects`'s `layout` parameter type does not accept `'stat'` yet (a TypeScript
error surfaces as a vitest transform failure, not a runtime assertion failure); once the type is
widened in Step 9 the runtime falls through to the existing `inline` branch and the first new
test fails on `p.value.y` not being less than `p.label.y`.

- [ ] **Step 8: Widen `pairRects`'s type signature**

In `draw.ts:519-520`:

```ts
export function pairRects(
  r: Box, n: number, layout: 'inline' | 'stacked' | 'stat', panelColumns: number, hasTitle: boolean,
): PairBox[] {
```

- [ ] **Step 9: Add the `stat` geometry constants and branch**

Add near the existing `KV_*` constants (`draw.ts:445-464`):

```ts
/** `stat` box pitch. Taller than `inline`/`stacked`: a stat panel holds two stacked lines at
 *  much larger sizes, not one line of label-and-value. */
const KV_STAT_H = 40;
/** Visible gutter below each stat box, so four boxes in a 2x2 grid read as separate cards rather
 *  than one solid block. Subtracted from KV_STAT_H, not added to it: the row PITCH stays
 *  KV_STAT_H so the grid math in pairRects does not need a second constant. */
const KV_STAT_VGAP = 6;
const KV_STAT_VALUE_SIZE = 18;
const KV_STAT_LABEL_SIZE = 7;
```

In `pairRects` (`draw.ts:531-539`), add a branch before the existing `if (layout === 'stacked')`:

```ts
    const cell = { x, y, w: cellW, h: pitch };
    if (layout === 'stat') {
      const boxH = pitch - KV_STAT_VGAP;
      const valueLh = lineH(KV_STAT_VALUE_SIZE);
      const labelLh = lineH(KV_STAT_LABEL_SIZE);
      const innerY = y + (boxH - valueLh - labelLh) / 2;
      return {
        ...cell,
        value: { x, y: innerY, w: cellW, h: valueLh },
        label: { x, y: innerY + valueLh, w: cellW, h: labelLh },
      };
    }
    if (layout === 'stacked') {
```

And the pitch selection at the top of `pairRects` (`draw.ts:523`):

```ts
  const pitch = layout === 'stacked' ? KV_STACKED_H : layout === 'stat' ? KV_STAT_H : KV_INLINE_H;
```

- [ ] **Step 10: Confirm the `pairRects` tests pass**

Run: `pnpm --filter @openldr/report-designer test -- draw.test.ts -t "pairRects"`
Expected: PASS.

- [ ] **Step 11: Write the failing `drawKeyValue` behaviour, then implement it**

`drawKeyValue` currently always bolds the label and leaves the value regular (`draw.ts:591-599`,
comment: "The label is BOLD and the value regular ... opposite of a table, on purpose"). A stat
panel is the opposite again: the NUMBER is what a reader sees first, so for `stat` the value is
large and bold, the caption is small, muted, and uppercase, and the value draws first (on top).

There is no existing golden fixture that would catch this by itself (a stat panel is not yet
bound to any seeded design), so this step is proven by the golden determinism test in Step 13,
not by a standalone assertion here. Change `drawKeyValue` (`draw.ts:588-620`):

```ts
  const boxes = pairRects(r, pairs.length, layout, el.panelColumns ?? 1, !!title);
  pairs.forEach((p, i) => {
    const b = boxes[i];
    if (layout === 'stat') {
      // The box itself, inset by half the vertical gutter so adjacent stat boxes read as
      // separate cards. Reuses HEAD_FILL rather than introducing a new near-duplicate tint.
      doc.rect(b.x, b.y, b.w, b.h - KV_STAT_VGAP).fill(HEAD_FILL);
    }
    const labelSize = layout === 'stacked' ? KV_STACKED_LABEL_SIZE
      : layout === 'stat' ? KV_STAT_LABEL_SIZE : KV_LABEL_SIZE;
    const valueSize = layout === 'stacked' ? KV_STACKED_VALUE_SIZE
      : layout === 'stat' ? KV_STAT_VALUE_SIZE : KV_VALUE_SIZE;

    // Draw the VALUE first and BOLD for `stat`, the opposite weighting from inline/stacked,
    // because a stat panel is scanned by number first, caption second.
    doc.font(layout === 'stat' ? 'Helvetica-Bold' : 'Helvetica').fontSize(valueSize);
    const value = values[i];
    const chip = p.status && p.emphasis === 'fill';
    const pad = chip ? CELL_PAD : 0;
    let valueColor = layout === 'stat' ? '#0f172a' : BODY_TEXT;
    if (chip) {
      const w = Math.min(doc.widthOfString(value) + pad * 2, b.value.w);
      doc.rect(b.value.x, b.value.y - CHIP_INSET_Y, w, b.value.h + CHIP_INSET_Y * 2).fill(STATUS_CHIP_FILL[p.status!]);
      valueColor = STATUS_CHIP_TEXT[p.status!];
    } else if (p.status) {
      valueColor = STATUS_TEXT_COLOR[p.status];
    }
    doc.fillColor(valueColor).text(value, b.value.x + pad, b.value.y,
      { width: Math.max(0, b.value.w - pad), height: b.value.h, ellipsis: true,
        align: layout === 'stat' ? 'center' : undefined });

    doc.font(layout === 'stat' ? 'Helvetica' : 'Helvetica-Bold').fontSize(labelSize).fillColor(KV_LABEL_COLOR)
      .text(layout === 'stacked' || layout === 'stat' ? p.label.toUpperCase() : p.label, b.label.x, b.label.y,
        { width: b.label.w, height: b.label.h, ellipsis: true,
          align: layout === 'stat' ? 'center' : undefined });
  });
```

This reorders the existing label-then-value drawing into value-then-label so the `stat` fill box
(drawn first, per pair) sits behind both, and swaps which of the two gets `Helvetica-Bold` based
on `layout`. `inline` and `stacked` keep their current weighting and draw order is irrelevant to
them since they do not share a fill.

- [ ] **Step 12: Run the full render test file**

Run: `pnpm --filter @openldr/report-designer test -- draw.test.ts`
Expected: PASS, including every pre-existing `keyvalue`/`pairRects` test untouched by this task.

- [ ] **Step 13: Add a golden determinism test for the stat panel**

Append to `packages/report-designer/src/render/golden.test.ts`, following the same pattern
Task 9 of the slice 1 plan used for `cellgrid`:

```ts
function statPanelDesign(): ReportDesign {
  return {
    id: 'sp', name: 'Stat', status: 'published', paper: 'A4', orientation: 'portrait',
    parameters: [],
    pages: [{
      id: 'p1',
      elements: [
        { id: 'panel', kind: 'keyvalue', name: 'panel', rect: { x: 48, y: 60, w: 300, h: 120 },
          layout: 'stat', panelColumns: 2,
          rows: [['Laboratories', '81'], ['Coverage', '5.9%'], ['Busiest day', '45'], ['Silent 10+d', '16']] },
      ],
    }],
    pageNumbers: false,
  };
}

it('draws a stat keyvalue panel identically across runs', async () => {
  const at = new Date('2026-01-15T09:00:00Z');
  const a = await renderReportDesignPdf(statPanelDesign(), new Map(), { now: at });
  const b = await renderReportDesignPdf(statPanelDesign(), new Map(), { now: at });
  expect(createHash('sha256').update(normalisePdf(a)).digest('hex'))
    .toBe(createHash('sha256').update(normalisePdf(b)).digest('hex'));
  expect(a.length).toBeGreaterThan(1000);
});
```

`new Map()` because this design is unbound (`rows`, not `dataSource`); no query resolution
needed. This proves determinism only, the same limit Task 9's cellgrid test states about itself:
nothing here says the four-box layout is visually right, only that it renders the same way twice.

- [ ] **Step 14: Run and confirm**

Run: `pnpm --filter @openldr/report-designer test -- golden.test.ts`
Expected: PASS, including the untouched-design digest test unchanged.

- [ ] **Step 15: Commit**

```bash
git add packages/report-designer/src/render/draw.ts packages/report-designer/src/render/draw.test.ts packages/report-designer/src/render/golden.test.ts
git commit -m "feat(report-designer): draw a keyvalue stat panel, value over caption"
```

---

### Task 2: `header-row.ts` sortBy gate extended to bound `cellgrid`

**Files:**
- Modify: `packages/report-designer/src/header-row.ts:32-44`
- Modify: `packages/report-designer/src/header-row.test.ts`
- Modify: `apps/server/src/report-designs-routes.ts:37,67` (error message wording)
- Modify: `apps/server/src/report-designs-routes.test.ts`

`findUnsortedHeaderRows` today only checks `el.kind !== 'table'`. A bound `cellgrid` has no
`headerRow` field to opt in with; per Background, it always lifts row 0. The gate needs a second,
unconditional branch for `cellgrid`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/report-designer/src/header-row.test.ts`, and add a `cellgrid` factory
mirroring the existing `grid` factory:

```ts
const cellgrid = (over: Record<string, unknown> = {}): unknown => ({
  id: 'cg', kind: 'cellgrid', name: 'CG', rect: { x: 0, y: 0, w: 400, h: 200 },
  dataSource: { kind: 'custom-query', queryId: 'q' },
  cellColumns: ['d01'], sortBy: 'ord',
  ...over,
});

describe('findUnsortedHeaderRows: cellgrid', () => {
  it('⛔ names a bound cellgrid with no sortBy, even though it has no headerRow field to opt in with', () => {
    // A cellgrid ALWAYS treats row 0 as its header (cellgrid.ts's splitCellGridRows), unlike
    // table where headerRow is opt-in. Without sortBy the same exposure headerRow's pairing
    // exists to prevent applies here with nothing currently enforcing it.
    expect(findUnsortedHeaderRows(design([cellgrid({ sortBy: undefined })])))
      .toEqual([{ elementId: 'cg' }]);
  });

  it('passes a bound cellgrid with sortBy', () => {
    expect(findUnsortedHeaderRows(design([cellgrid()]))).toEqual([]);
  });

  it('leaves an unbound cellgrid alone, its rows are the author\'s own array', () => {
    expect(findUnsortedHeaderRows(design([cellgrid({
      dataSource: undefined, sortBy: undefined, rows: [['1']],
    })]))).toEqual([]);
  });

  it('names both an offending table and an offending cellgrid on the same page', () => {
    expect(findUnsortedHeaderRows(design([
      grid({ id: 'a', sortBy: undefined }),
      cellgrid({ id: 'b', sortBy: undefined }),
    ]))).toEqual([{ elementId: 'a' }, { elementId: 'b' }]);
  });
});
```

- [ ] **Step 2: Confirm they fail**

Run: `pnpm --filter @openldr/report-designer test -- header-row.test.ts`
Expected: FAIL on the first new test, `received []` (a bound `cellgrid` with no `sortBy` is
currently invisible to the gate, since `el.kind !== 'table'` skips it immediately).

- [ ] **Step 3: Widen the gate**

Replace the loop body in `packages/report-designer/src/header-row.ts` (`:34-43`):

```ts
export function findUnsortedHeaderRows(design: ReportDesign): UnsortedHeaderRow[] {
  const bad: UnsortedHeaderRow[] = [];
  for (const page of design.pages) {
    for (const el of page.elements) {
      // A table only lifts a header row when it opts in with headerRow: true. A cellgrid has no
      // such flag: it ALWAYS lifts row 0 (splitCellGridRows, unconditional). Both therefore need
      // sortBy on the same rows-came-from-a-query condition below; only the "does this element
      // even lift a header row" test differs between the two kinds.
      const liftsHeaderRow = (el.kind === 'table' && el.headerRow === true) || el.kind === 'cellgrid';
      if (!liftsHeaderRow) continue;
      // An UNBOUND element draws its own static rows/columns in the order written, so row 0 is
      // already knowable and requiring sortBy there would refuse a design that cannot be wrong.
      if (!el.dataSource) continue;
      if (!el.sortBy) bad.push({ elementId: el.id });
    }
  }
  return bad;
}
```

- [ ] **Step 4: Confirm they pass**

Run: `pnpm --filter @openldr/report-designer test -- header-row.test.ts`
Expected: PASS, including every pre-existing `table` test unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/header-row.ts packages/report-designer/src/header-row.test.ts
git commit -m "feat(report-designer): the sortBy gate also covers a bound cellgrid"
```

---

- [ ] **Step 6: Fix the route's error wording**

`apps/server/src/report-designs-routes.ts:37` and `:67` both build the string
`` `headerRow needs sortBy: ${...}` ``. That wording assumed only a `table` with `headerRow` could
trigger the gate; a `cellgrid` violation would now print the same string even though `cellgrid`
has no `headerRow` field. Change both occurrences to:

```ts
      const error = `a header row needs sortBy: ${unsorted.map((u) => u.elementId).join(', ')}`;
```

- [ ] **Step 7: Write the failing route test**

Append to `apps/server/src/report-designs-routes.test.ts`, near the existing `withGrid`-based
test block (`:264-293`):

```ts
const withCellGrid = (over: Record<string, unknown>) => ({
  ...minimal,
  pages: [{ id: 'p1', elements: [{
    id: 'cg', kind: 'cellgrid', name: 'CG', rect: { x: 0, y: 0, w: 400, h: 200 },
    dataSource: { kind: 'custom-query', queryId: 'q' }, cellColumns: ['d01'], ...over,
  }] }],
});

it('⛔ refuses a bound cellgrid without sortBy, though it has no headerRow field to opt in with', () => {
  // cellgrid always lifts row 0 as a header. Unlike table, there is nothing to opt into. The
  // gate has to catch this unconditionally rather than by checking a flag that does not exist
  // on this element kind.
  const app = appWith(fakeCtx());
  const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withCellGrid({}) });
  expect(res.statusCode).toBe(400);
  expect(res.json().unsortedHeaderRows).toEqual([{ elementId: 'cg' }]);
  expect(res.json().error).toBe('a header row needs sortBy: cg');
});

it('accepts a bound cellgrid with sortBy', async () => {
  const app = appWith(fakeCtx());
  const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withCellGrid({ sortBy: 'ord' }) });
  expect(res.statusCode).toBe(201);
});
```

Also update the two existing assertions this wording change touches
(`report-designs-routes.test.ts:281,286`) from `'headerRow needs sortBy: hvleid'` to
`'a header row needs sortBy: hvleid'`.

- [ ] **Step 8: Run and confirm**

Run: `pnpm --filter @openldr/server test -- report-designs-routes.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/report-designs-routes.ts apps/server/src/report-designs-routes.test.ts
git commit -m "fix(server): the header-row gate error names cellgrid too, not just headerRow"
```

---

### Task 3: export `cellGridWidth` and `CELL_LABEL_W` from the package boundary

**Files:**
- Modify: `packages/report-designer/src/render/index.ts`

`packages/reporting`'s seed test needs to assert the real `rt-transmission-grid` design's
`cellgrid` rect fits the portrait body, computed from the same constants the renderer uses. Those
constants live in `packages/report-designer/src/render/cellgrid.ts`, which is internal to the
`report-designer` package today; nothing outside it can reach `cellGridWidth` or `CELL_LABEL_W`.

`render/index.ts` already exports `pairRects`, `toPt` and `paperSizePt` for exactly this reason
(its own comments say so: "a seeded design's keyvalue panel has a fixed box ... exporting the
geometry lets the seed that owns the panel assert its own capacity"). This task does the same
thing for `cellgrid`.

- [ ] **Step 1: Write the failing test**

Append to `packages/reporting/src/seed/report-seeds.test.ts` (import list at the top, `:15`):

```ts
import { pairRects, toPt, paperSizePt, cellGridWidth, CELL_LABEL_W, type ReportDesign } from '@openldr/report-designer';
```

```ts
it('exports cellGridWidth and CELL_LABEL_W for a seed test to use', () => {
  expect(typeof cellGridWidth).toBe('function');
  expect(CELL_LABEL_W).toBe(105);
});
```

- [ ] **Step 2: Confirm it fails**

Run: `pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "exports cellGridWidth"`
Expected: FAIL, `does not provide an export named 'cellGridWidth'`.

- [ ] **Step 3: Export both**

In `packages/report-designer/src/render/index.ts`, after the existing `paperSizePt` export
(`:28`):

```ts
// Exported for the same reason as pairRects above: a seed that binds a cellgrid needs to assert
// its OWN declared geometry fits the page it is authored for, using the same arithmetic the
// renderer itself uses rather than a hand-copied number that can drift out of sync with it.
export { cellGridWidth, CELL_LABEL_W } from './cellgrid';
```

- [ ] **Step 4: Confirm it passes**

Run: `pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "exports cellGridWidth"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/index.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(report-designer): export cellGridWidth and CELL_LABEL_W for seed tests"
```

---

### Task 4: `rt-transmission-grid` turns A4 portrait, both grids become `cellgrid`

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:3671-3720` (`TG_CONTENT_W`, `TG_GRID_H`,
  `transmissionGridColumns`), `:4004-4089` (the design itself)
- Modify: `packages/reporting/src/seed/report-seeds.test.ts:1886-2078` (every
  `rt-transmission-grid` describe block)

This is the centrepiece of the slice. It follows red-green: Step 1 rewrites the existing tests to
expect the new shape (so they fail against today's landscape/table design), Step 3 makes the
design change that turns them green.

**The geometry this task can prove, and the geometry it cannot.** The width arithmetic is fully
specified by spec section 5 and is asserted exactly (Step 7). The vertical split between the two
grids is **not** specified anywhere in the repo as text or data; the operator's preview rounds
happened outside it. This task proposes a derived default (below) and says so plainly rather than
presenting it as a rendering of the approved mockup.

**A note on the em dashes below.** `report-seeds.test.ts` already names several `describe` and
`it` blocks with an em dash (`SEED_DESIGNS — rt-transmission-grid`, and the existing `it('never
binds ord ...')` title, both quoted verbatim in this task), one existing test comment quotes the
backspace-character trap verbatim, and the footer element's own display text
(`'Generated by OpenLDR ...'`) is unchanged design copy, not new writing. All four predate this
plan's own no-em-dash rule. Where this task keeps one of them so the test file's structure, its
`-t` grep filters, or the design's own printed text keep working, that is a reference to an
existing identifier or string, not new writing, and none of them is rewritten here. Every new test
title and every new comment this task adds avoids the character.

- [ ] **Step 1: Rewrite the existing tests to expect portrait and cellgrid**

⚠ That em dash is not a rule 13 violation and must not be "fixed". It is the name of a `describe`
block that already exists and predates the rule, and `-t` filters and git history both depend on it
staying as it is. Keep the name exactly; do not put a new one anywhere else you write.

Replace the entire `describe('SEED_DESIGNS — rt-transmission-grid', ...)` block
(`report-seeds.test.ts:1886-1964`):

```ts
describe('SEED_DESIGNS — rt-transmission-grid', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id)!;

  it('is portrait, cellgrid does not need MIN_COL_W headroom the way table did', () => {
    // The reason the design was landscape (a 22pt column floor colliding with a 23-column grid)
    // no longer applies: cellgrid declares its cell pitch instead of measuring it. See the
    // geometry describe block below for the arithmetic that replaces this comment.
    expect(design().orientation).toBe('portrait');
  });

  it('binds both grids as cellgrid, not table', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).kind, `${id} is still a table`).toBe('cellgrid');
    }
  });

  it('sorts its own rows on ord instead of trusting the SQL row order', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).sortBy, `${id} trusts the SQL row order`).toBe('ord');
    }
  });

  it('groups day columns by the week-token row', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).groupBoundary, `${id} does not group by week`).toBe('token-change');
    }
  });

  it('marks a filled cell with the binary blue ramp', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).palette, `${id} palette`).toEqual({ ramp: 'blue', steps: 1 });
    }
  });

  it('ties each heading to its own grid, so neither survives onto a page the grid does not reach', () => {
    expect(el('rt-transmission-grid-hvleid-title').showWithTable).toBe('hvleid');
    expect(el('rt-transmission-grid-other-title').showWithTable).toBe('other');
  });

  it('draws BOTH grids on one page, as the reference does', () => {
    expect(el('hvleid').dataSource).toEqual({ kind: 'custom-query', queryId: 'q-transmission-hvleid' });
    expect(el('other').dataSource).toEqual({ kind: 'custom-query', queryId: 'q-transmission-other' });
  });

  it('binds the laboratory as labelColumn and all 23 day columns as cellColumns', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).labelColumn, `${id} labelColumn`).toBe('lab');
      const cells = el(id).cellColumns ?? [];
      expect(cells, `${id} cellColumns`).toHaveLength(23);
      expect(cells[0]).toBe('d01');
      expect(cells[22]).toBe('d23');
    }
  });

  it('trails each row with Days and Silent, matching the spec widths', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).trailingColumns, `${id} trailingColumns`).toEqual([
        { key: 'days', label: 'Days', width: 34.5 },
        { key: 'silent', label: 'Silent', width: 52 },
      ]);
    }
  });

  it('projects only keys the queries actually select', () => {
    const sql = SEED_QUERIES.find((q) => q.id === 'q-transmission-hvleid')!.sql.postgres;
    const keys = [
      el('hvleid').labelColumn!, ...(el('hvleid').cellColumns ?? []),
      ...(el('hvleid').trailingColumns ?? []).map((c) => c.key),
    ];
    for (const key of keys) {
      // ⚠ `\\b`, inside a TEMPLATE LITERAL a lone `\b` is the backspace character, not a word
      // boundary, so the pattern silently never matches.
      expect(new RegExp(`as ${key}\\b`).test(sql), `${key} is not selected`).toBe(true);
    }
  });
});
```

`transmissionGridColumns()` (`report-seeds.ts:3713-3720`) is no longer called by this design once
Step 3 lands; spec section 4.1 says to check whether any other design calls it before deleting it.
It is used only here, grep confirms, so this task deletes the function in Step 3 rather than
leaving dead code.

Replace the `boundColumns`/`labels`-specific test that has no cellgrid equivalent (the old
`'⛔ leaves the 23 day labels BLANK ...'` test, `:1913-1922`): `cellgrid` has no per-cell-column
label field to override with, so there is nothing left to pin. It is deleted, not replaced, and
this paragraph is the record of why.

Replace the `'fits 8 laboratories per grid per page'` test (`:1929-1940`) with the new capacity
test, folded into the geometry describe block rewrite below (Step 7), since it needs the same
`cellGridMaxRows` import that block already uses.

Replace `describe('SEED_DESIGNS — rt-transmission-grid keeps ord off the page', ...)`
(`:1998-2031`)'s first test, which reads `boundColumns`:

```ts
  it('never binds ord, it sorts the rows, it is not a column of the report', () => {
    for (const id of ['hvleid', 'other']) {
      const keys = [el(id).labelColumn, ...(el(id).cellColumns ?? []),
        ...(el(id).trailingColumns ?? []).map((c) => c.key)];
      expect(keys, `${id} prints ord`).not.toContain('ord');
    }
  });
```

The remaining two tests in that block (`'sorts its own rows on ord ...'` is now duplicated by the
rewritten block above, delete it here; `'⛔ pairs headerRow with sortBy ...'` calling
`findUnsortedHeaderRows(d)` over every `SEED_DESIGNS` entry, and `'names no panel code
anywhere ...'`) need no change: the first already exercises Task 2's widened gate automatically
once this task's `sortBy: 'ord'` lands on both `cellgrid` elements, and the second does not
inspect element kind at all.

- [ ] **Step 2: Confirm the rewritten tests fail**

Run: `pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "rt-transmission-grid"`
Expected: FAIL across most of the new tests. `design().orientation` is still `'landscape'`,
`el('hvleid').kind` is still `'table'`, `labelColumn`/`cellColumns`/`trailingColumns` are all
`undefined` on a `table` element.

- [ ] **Step 3: Rewrite the design**

In `packages/reporting/src/seed/report-seeds.ts`, replace `TG_CONTENT_W` and `TG_GRID_H`
(`:3671-3686`):

```ts
/** Body width of the transmission grid's A4-PORTRAIT page, px@96. Same arithmetic
 *  simpleTableDesign uses: round(pageWpt / 0.75) - 96, i.e. round(595.28/0.75) - 96 for A4
 *  portrait. Was 1027 (A4 landscape) from slice 1 through slice 2a; this slice turns the page
 *  portrait per the approved design (spec section 1), so the value moves with it. */
const TG_CONTENT_W = 698;

/** Height of each of the two grids, px@96 = 285pt each.
 *
 *  ⚠ NOT sourced from the approved preview. That mockup was shown to the operator across five
 *  rounds and its exact pixel geometry is not committed anywhere this plan can read. This value
 *  is derived instead: portrait content height (769.89pt, 36pt margins) minus the SAME leading
 *  letterhead/scope-panel chrome and trailing footer chrome the landscape design already used
 *  (unchanged, neither depends on orientation), split evenly between the two grids the way the
 *  landscape design already split its own 214pt equally between them.
 *
 *  cellGridMaxRows(285) = floor((285 - CELL_HEAD_H 13) / CELL_ROW_H 12.75) = 21 rows per
 *  page-chunk per grid. Measured against the live warehouse (slice 2a's own verification, August
 *  2017): the HVL/EID grid's 20 laboratories fit page 1 with no continuation; the Other grid's 65
 *  need ceil(65/21) = 4 chunks.
 *
 *  ⛔ Spec section 5 SAID continuation pages hold "about 43 rows". Corrected in 7588f8db to the
 *  preview's 40." This plan could not reconcile that figure with a two-grids-share-one-page
 *  layout: 43 rows needs roughly 561-574pt for ONE grid alone (cellGridMaxRows solved backwards),
 *  not 285pt for two side by side. Treat this constant as a documented starting point pending the
 *  operator's visual confirmation against the actual preview, not as a rendering of it. */
const TG_GRID_H = 380; // px@96; 380 * 0.75 = 285pt
```

Delete `transmissionGridColumns()` (`:3713-3720`) entirely, per Step 1's note.

Replace the design's `orientation` and the two grid elements plus their surrounding chrome
(`:4004-4089`). Everything from `rt-transmission-grid-logo` through `rt-transmission-grid-title`
(`:4038-4045`) keeps its existing `x`/`y`/`h`, only `w`s that reference `TG_CONTENT_W` pick up the
new value automatically. The scope panel, headings and grids change as follows:

```ts
    orientation: 'portrait',
```

```ts
      { id: 'rt-transmission-grid-meta', kind: 'keyvalue', name: 'Scope', rect: { x: 48, y: 138, w: TG_CONTENT_W, h: 48 },
        layout: 'inline', panelColumns: 2,
        rows: [
          ['Month', '{{param.month}}'],
          ['HVL/EID panel codes', '{{param.panels}}'],
          ['Generated', '{{date}}'],
        ] },

      { id: 'rt-transmission-grid-hvleid-title', kind: 'text', name: 'HVL/EID heading', rect: { x: 48, y: 194, w: 600, h: 14 },
        text: 'Any HVL/EID Data Submission by Testing Laboratory', style: { fontSize: 10, bold: true, color: '#334155' },
        showWithTable: 'hvleid' },
      { id: 'hvleid', kind: 'cellgrid', name: 'HVL/EID submission', rect: { x: 48, y: 210, w: TG_CONTENT_W, h: TG_GRID_H },
        dataSource: { kind: 'custom-query', queryId: 'q-transmission-hvleid' },
        sortBy: 'ord',
        labelColumn: 'lab',
        cellColumns: Array.from({ length: 23 }, (_, i) => `d${String(i + 1).padStart(2, '0')}`),
        groupBoundary: 'token-change',
        palette: { ramp: 'blue', steps: 1 },
        trailingColumns: [
          { key: 'days', label: 'Days', width: 34.5 },
          { key: 'silent', label: 'Silent', width: 52 },
        ] },

      { id: 'rt-transmission-grid-other-title', kind: 'text', name: 'Other heading', rect: { x: 48, y: 594, w: 600, h: 14 },
        text: 'Any Other Test Data Submission by Testing Laboratory', style: { fontSize: 10, bold: true, color: '#334155' },
        showWithTable: 'other' },
      { id: 'other', kind: 'cellgrid', name: 'Other submission', rect: { x: 48, y: 612, w: TG_CONTENT_W, h: TG_GRID_H },
        dataSource: { kind: 'custom-query', queryId: 'q-transmission-other' },
        sortBy: 'ord',
        labelColumn: 'lab',
        cellColumns: Array.from({ length: 23 }, (_, i) => `d${String(i + 1).padStart(2, '0')}`),
        groupBoundary: 'token-change',
        palette: { ramp: 'blue', steps: 1 },
        trailingColumns: [
          { key: 'days', label: 'Days', width: 34.5 },
          { key: 'silent', label: 'Silent', width: 52 },
        ] },

      { id: 'rt-transmission-grid-rule2', kind: 'line', name: 'rule2', rect: { x: 48, y: 1003, w: TG_CONTENT_W, h: 0 }, style: { strokeColor: '#cbd5e1', strokeWidth: 0.75 } },
      { id: 'rt-transmission-grid-foot', kind: 'text', name: 'Footer', rect: { x: 48, y: 1015, w: 500, h: 16 },
        text: 'Generated by OpenLDR, a filled cell means data arrived from that laboratory that day.', style: { fontSize: 7, color: '#94a3b8' } },
      { id: 'rt-transmission-grid-sig', kind: 'text', name: 'Signature', rect: { x: 371, y: 1015, w: 375, h: 16 },
        text: 'Reviewed by ______________________', style: { fontSize: 8, color: '#475569' } },
```

The signature's `x` moves from `700` to `371` because the page is narrower in portrait
(`TG_CONTENT_W` 698 vs 1027) and `700 + 375` would run past the new content width. `371` keeps it
right-aligned within `TG_CONTENT_W` the same way it was before (`700 + 375 = 1075`, close to
`48 + 1027 = 1075`; `371 + 375 = 746`, close to `48 + 698 = 746`).

- [ ] **Step 4: Confirm the rewritten tests now pass**

Run: `pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "rt-transmission-grid"`
Expected: PASS, all tests in every `rt-transmission-grid` describe block.

- [ ] **Step 5: Confirm this can fail. Flip one field back and rerun**

Temporarily set `orientation: 'landscape'` and rerun the first test in the rewritten block. It
must go RED. Revert before continuing. This is the check called for by AGENTS.md's own history
here: an earlier test on this exact file asserted `.not.toThrow()` and stayed green with the code
under test deleted.

- [ ] **Step 6: Commit the design and the test rewrite together**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reports): rt-transmission-grid turns A4 portrait, both grids become cellgrid"
```

---

- [ ] **Step 7: Write the failing geometry-fit test**

Replace `describe('SEED_DESIGNS — rt-transmission-grid geometry', ...)`
(`report-seeds.test.ts:2053-2078`, the two tests already there):

```ts
describe('SEED_DESIGNS — rt-transmission-grid geometry', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id)!;

  it('gives both grids the same width and the same height', () => {
    // Two readings of the same month, one above the other. Different geometry between them would
    // make a laboratory's row in the top grid not line up with its row in the bottom one.
    expect(el('hvleid').rect.w).toBe(el('other').rect.w);
    expect(el('hvleid').rect.h).toBe(el('other').rect.h);
    expect(el('hvleid').rect.x).toBe(el('other').rect.x);
  });

  it('fits the worst-case 23-day, 5-week month inside the A4 portrait body: DERIVED, not hardcoded', () => {
    // Worst case per spec section 5: a 31-day month starting Monday, 23 working days across 5
    // week groups, breaks at cell index 5, 10, 15, 20, the exact pattern q-transmission-hvleid's
    // own week-token union branch cites for August 2017 on the live warehouse.
    const worstCaseBreaks = [5, 10, 15, 20];
    const [pageWpt] = paperSizePt(design().paper, design().orientation);
    const bodyWpt = pageWpt - 72; // 36pt margins each side, per spec section 5
    for (const id of ['hvleid', 'other']) {
      const trailing = (el(id).trailingColumns ?? []).map((c) => c.width);
      const needed = cellGridWidth({
        labelWidth: CELL_LABEL_W,
        cellCount: (el(id).cellColumns ?? []).length,
        breaks: worstCaseBreaks,
        trailingWidths: trailing,
      });
      expect(needed, `${id} needs more than the ${bodyWpt}pt portrait body has`).toBeLessThanOrEqual(bodyWpt);
      expect(bodyWpt - needed, `${id} headroom`).toBeGreaterThan(0);
    }
  });

  it('declares a rect wide enough to hold the full body, not just the worst-case minimum', () => {
    // The grid's OWN rect need not equal the tight minimum computed above. cellgrid does not
    // stretch cells to fill unused width, so a wider clip region is harmless. This just confirms
    // the declared rect is not narrower than what the previous test proved is needed.
    const [pageWpt] = paperSizePt(design().paper, design().orientation);
    const bodyWpt = pageWpt - 72;
    for (const id of ['hvleid', 'other']) {
      expect(toPt(el(id).rect).w).toBeGreaterThan(bodyWpt - 10);
    }
  });
});
```

- [ ] **Step 8: Confirm it fails, then passes**

Run: `pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "geometry"`
Before Step 3's design change: FAIL (`design().orientation` is `'landscape'`, so `pageWpt` is the
landscape width and `el('hvleid').cellColumns` is `undefined`, `.length` throws).
After Step 3 (already landed by Step 6): PASS.

- [ ] **Step 9: Prove the fit test can fail on its own**

Temporarily change `worstCaseBreaks` to `[]` (no breaks) in the test and rerun. The needed width
drops (fewer `GROUP_GAP`s charged), so this alone will not fail it usefully. Instead, temporarily
bump one `trailingColumns` width in the design (`silent`'s `width: 52` to `width: 60`) and rerun.
Expected: RED, `needs more than the 523.28pt portrait body has` or headroom drops to zero.
Revert the temporary change before continuing.

- [ ] **Step 10: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.test.ts
git commit -m "test(reports): assert the real rt-transmission-grid cellgrid rect fits A4 portrait"
```

---

### Task 5: delete the `⛔ KNOWN GAP` characterization test, prove the leak is gone

**Files:**
- Modify: `packages/reporting/src/seed/transmission-grid-live.test.ts`

Slice 2a added a test pinning a known, real, interim defect: with the query emitting a
week-token row but the design still a `table` with `headerRow: true`, only the date row was
lifted into the header, so the week-token row printed as a body row, a laboratory named `'(week)'`
above every real laboratory. Task 4 replaces the `table` with `cellgrid`, which lifts BOTH
synthetic rows (`splitCellGridRows`, `grouped ? 2 : 1`) whenever `groupBoundary: 'token-change'`
is set, which Task 4's design does set. The gap is closed; the test that pinned it is now
obsolete by the plan's own design, exactly as its comment said it would be
("Delete this test in the slice that replaces rt-transmission-grid with a cellgrid design").

- [ ] **Step 1: Delete the characterization test**

Remove this block from `transmission-grid-live.test.ts` (currently `:563-586`, immediately after
the `'keeps ord off the printed page'` test):

```ts
  // ⛔ KNOWN GAP, not fixed in this slice. 'rt-transmission-grid' is a `table` element with
  // ... [full comment and test body as added by slice 2a] ...
  it('⛔ KNOWN GAP: the unmodified rt-transmission-grid table shows the week-token row as a body row', async () => {
    ... [full test body] ...
  });
```

- [ ] **Step 2: Add the replacement, proving the fix rather than just removing the old claim**

In its place:

```ts
  it('no longer leaks the week-token row into the body, now that the design binds cellgrid', async () => {
    // The regression this replaces: with rt-transmission-grid as a `table` with `headerRow: true`,
    // only the date row was lifted and the week-token row printed as a body row named '(week)'.
    // cellgrid lifts BOTH synthetic rows unconditionally when groupBoundary is set
    // (splitCellGridRows), so '(week)' should not appear as drawn text anywhere on the page.
    const design = SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;
    const runForDesign = async (queryId: string, values: Record<string, unknown>) => {
      const rows = await runQuery(queryId)(values as { month: string; panels: string; tz: string });
      return { columns: Object.keys(rows[0]).map((k) => ({ key: k, label: k })), rows: [...rows].reverse() };
    };
    const resolved = await resolveDesignTables(
      design, { month: '2026-03', panels: 'HIVPC', tz: 'UTC' }, runForDesign);
    const buf = await renderReportDesignPdf(design, resolved, {
      now: new Date('2026-03-31T09:00:00Z'),
      values: { month: '2026-03', panels: 'HIVPC', tz: 'UTC' },
    });
    const page1 = pageStreams(buf)[0];
    const drawn = textRuns(page1);
    expect(drawn.map((r) => r.text)).not.toContain('(week)');
  });
```

`runQuery`, `resolveDesignTables`, `renderReportDesignPdf`, `pageStreams`, `textRuns` are all
already imported or defined earlier in this file; this test reuses the same scaffolding the
deleted one used, so no new import is needed.

- [ ] **Step 3: Run and confirm**

Run: `TARGET_DATABASE_URL=$(grep '^TARGET_DATABASE_URL=' .env | cut -d= -f2-) pnpm --filter @openldr/reporting test -- transmission-grid-live.test.ts`
Expected: PASS.

- [ ] **Step 4: Confirm this test can fail**

Its own failure mode already happened, historically: the OLD test (deleted in Step 1) asserted
`.toContain('(week)')` and passed against the pre-Task-4 design. Re-running that exact assertion
against the post-Task-4 design (the one this new test now runs against) would fail, which is the
proof this new assertion is meaningful and not vacuous. No separate revert-and-rerun is needed
because Task 4's own Step 5 already demonstrated the design change is load-bearing.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/transmission-grid-live.test.ts
git commit -m "test(reports): the week-token row no longer leaks into rt-transmission-grid's body"
```

---

### Task 6: full gate

- [ ] **Step 1: Run each touched package**

```bash
pnpm --filter @openldr/report-designer test
pnpm --filter @openldr/server test
pnpm --filter @openldr/reporting test
```

Expected: PASS. `@openldr/reporting`'s `transmission-grid-live.test.ts` only runs its live block
when `TARGET_DATABASE_URL` is set; without it, that block is skipped, not failed.

- [ ] **Step 2: Run the full gate**

Run: `pnpm turbo run test`

Do not pipe this through `tail`. It truncates the failure list and hides which package failed
(CLAUDE.md). A failure here is usually a timeout, not a regression: grep the output for `Test
timed out` and rerun that package alone before concluding this slice broke something.

- [ ] **Step 3: Confirm no migration was added**

```bash
git status packages/db/src/migrations/
```

Expected: no output. This slice adds no column, no table, no parameter.

- [ ] **Step 4: Render the design once, by hand, and look at it**

This plan's vertical geometry (Task 4) is a derived default, not a rendering of the approved
preview. Before treating this slice as visually done, render `rt-transmission-grid` for a real
month against real or fixture data and look at the output page by page, specifically checking:
both grids fit their declared `TG_GRID_H` without an unintended third continuation page for the
smaller grid, the week gaps are visible, and the footer sits inside the page rather than running
off the bottom edge (the exact defect `render/index.ts`'s own comments warn about). This is a
manual step; nothing in the automated suite proves the page LOOKS right, only that it renders
deterministically and fits the arithmetic this plan derived.

---

## Done when

- `pnpm --filter @openldr/report-designer test` passes.
- `pnpm --filter @openldr/server test` passes.
- `pnpm --filter @openldr/reporting test` passes, including `transmission-grid-live.test.ts` when
  `TARGET_DATABASE_URL` is set.
- `pnpm turbo run test` passes.
- `rt-transmission-grid` is `orientation: 'portrait'`, both grids are `kind: 'cellgrid'`.
- The worst-case 23-day, 5-week month is asserted to fit the real design's declared rect, derived
  from `cellGridWidth` and `paperSizePt`, not a hardcoded 517/523.28 pair.
- The `⛔ KNOWN GAP` characterization test is deleted and replaced with a test proving the leak it
  pinned is gone.
- `keyvalue` accepts and draws `layout: 'stat'`, proven by its own tests, not yet bound to any
  seeded design.
- The `sortBy` gate covers a bound `cellgrid` the same way it covers a `table` with
  `headerRow: true`, at both the pure-function level (`header-row.test.ts`) and the route level
  (`report-designs-routes.test.ts`).

## Explicitly not in this slice

**The month calendar and the four summary figures**, and the two new queries that would feed
them. See "Investigation: the summary band's data source" above for why, and the proposed 2c
split. `region`/`facility`/`blocks` scope filtering and `q-regions` (spec sections 3, 3.1, 3.2,
3.3, 3.4), not started on this branch, confirmed by grep, out of scope for this slice regardless.
`apps/studio`: AGENTS.md section 5 governs it, but this slice touches no studio code, at all,
including for the new `stat` layout. See "Known gaps" for what that leaves broken there.

## Known gaps this slice does not close

**The vertical split between the two grids is this plan's own derivation, not a rendering of the
approved preview.** Task 4's `TG_GRID_H = 380` (px@96, 285pt) is computed from the portrait
page's available height and the landscape design's existing chrome heights, not from any pixel
data the operator's five preview rounds produced (none is committed to this repo in a form this
plan could read). Spec section 5 states continuation pages hold "about 43 rows against the
preview's 40," a figure this plan could not reconcile with a two-grids-share-one-page layout;
solving `cellGridMaxRows` backwards for 43 rows needs roughly 561-574pt for ONE grid alone. Task
6's Step 4 (render and look) is the closest this plan gets to catching a mismatch before it ships;
it cannot substitute for the operator confirming the rendered page against what they actually
approved.

**`apps/studio`'s report designer canvas cannot render a `cellgrid` element at all, and does not
know the `stat` layout exists.** Found while confirming AGENTS.md section 5 truly did not apply
here, not something this plan was asked to investigate. Two separate, citable facts:

- `apps/studio/src/report-designer/PageCanvas.tsx`'s `ElementContent` function switches on
  `el.kind` with no `case 'cellgrid':` and no `default:` branch. A `cellgrid` element on the
  canvas renders nothing (`undefined`), a blank box with no error. This has been true since slice
  1 landed `cellgrid` in the schema; nothing in slice 1's own "explicitly not in this slice" list
  named it.
- `packages/report-designer/src/schema.ts:11` exports a standalone `ElementKind` type,
  `'text' | 'table' | 'image' | 'line' | 'rect' | 'datetime' | 'keyvalue' | 'barcode' | 'qrcode'`,
  used by `apps/studio/src/report-designer/model.ts`'s `ELEMENT_KINDS` (the "add element" toolbar
  list) and `elementIcons.ts`'s `KIND_ICON` map. It does not include `'cellgrid'` and has not
  since slice 1, because `DesignElementSchema`'s own `kind` enum (which DOES include `'cellgrid'`,
  and is what `DesignElement['kind']` is actually inferred from) is a separate, inline
  `z.enum([...])` at `schema.ts:88` that nothing keeps in sync with the standalone type. An
  operator cannot add a `cellgrid` element from the studio toolbar today, and this slice does not
  change that. `apps/studio/src/report-designer/PropertiesTab.tsx`'s `keyvalue` layout dropdown
  (`:313-320`) is a similar, smaller case: it offers only `inline`/`stacked`, so a `stat` panel
  opened in Studio shows an unselected dropdown, though it does not crash and `KeyValuePreview`
  still renders an approximation of it (falling through to its non-stacked branch).

None of this is fixed here. `ElementKind` is a one-line fix inside `packages/report-designer`
(not `apps/studio`) and is flagged as a candidate for a small, separate follow-up rather than
folded into this slice, since it was not asked for and the brief explicitly excludes studio work.

**MSSQL and MySQL live behaviour for the two existing queries is still unverified beyond slice
2a's careful transliteration and reasoning**, unchanged by this slice, since this slice touches no
SQL text.
