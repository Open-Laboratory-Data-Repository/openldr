# LIS Stakeholders Update as a submission calendar

**Date:** 2026-08-20
**Status:** designed, not started.
**Design:** `rt-transmission-grid`  **Report:** `r-transmission-grid`

Replace the grid of `Y` characters with a per-laboratory submission calendar. Add a new
data-bound element kind, `cellgrid`, that draws it. Turn the report portrait. Add scope
filtering, a block switch, and a per-laboratory tally.

**Supersedes two decisions** in `2026-08-18-transmission-grid-design.md`: the landscape
orientation, and the cell rendered as the letter `Y`. Everything else in that spec stands,
including the batch attribution route, the 23 working-day columns and the run-time panel
parameter. The clinical-date bucketing from `2026-08-19-transmission-grid-clinical-bucketing-design.md`
is untouched.

The visual design was settled through five preview rounds with the operator and is not reopened
here.

---

## 1. Why

The report today prints 8 laboratories per grid per page. That is measured arithmetic, not a
guess: `floor((160.5 - 24) / 16)` at `report-seeds.ts:3320`. Two grids means 16 rows a page.

Three problems follow from the `Y` grid, and they are separate problems.

**It stores a fact instead of answering a question.** The grid tells you whether Mohoro sent
something on the 12th, if you go looking for Mohoro and then find the 12th. It does not tell you
Mohoro stopped nineteen working days ago. That is what a reviewer is trying to learn, and
nothing on the page carries it.

**Non-reporting days are dropped from the header.** July 2018 prints 22 columns, one per working
day. The 1st, 7th, 8th, 14th and so on are simply absent. A quiet Tuesday and a Sunday are
therefore indistinguishable, and the month has no shape.

**It does not scale.** At 8000 facilities the current layout is 1000 pages. The redesign at
about 40 rows a page is 200. Five times better and still not a document, which is why scope
filtering is part of this work rather than a follow-up.

---

## 2. The `cellgrid` element

A new element kind. One row per record: a label, a run of small square cells whose fill comes
from a value, then optional text columns at the end.

Nothing in the contract mentions laboratories, months or submissions. This is deliberate. The
operator has asked for more elements in this family, so the first one sets the pattern.

```ts
{ kind: 'cellgrid', rect, dataSource,
  labelColumn:     'lab',
  cellColumns:     ['d01', … , 'd23'],
  groupBoundary:         'token-change',
  palette:         { ramp: 'blue', steps: 1 },
  trailingColumns: [{ key: 'days',   label: 'Days' },
                    { key: 'silent', label: 'Silent', emphasis: 'fill' }] }
```

### 2.1 Why it cannot be the `table` element

Three constraints in `packages/report-designer/src/render/draw.ts` make `table` unable to draw
this. All three were confirmed by reading the file.

| Constraint | Where | Effect |
|---|---|---|
| `MIN_COL_W = 22`, applied as `Math.min(MIN_COL_W, totalW / n)` | `draw.ts:123`, `draw.ts:168` | A column can never be the 10.5pt this design needs. This same floor is what forced the report landscape. |
| `STATUS_CHIP_FILL` is five clinical values: green, rose, dark rose, grey, pale grey | `draw.ts:29` | No blue, and no way for a design to declare one. |
| `ROW_H = 16` pt, fixed | `draw.ts:54` | The design's row is 12.75pt. |

The chip-fill path at `draw.ts:893` proves filled cells are drawable. The mechanism exists; it
cannot be driven at this density or in this palette.

### 2.2 The four properties `cellgrid` adds

**Declared cell pitch.** A cell is a fixed square, so no width measurement runs and `MIN_COL_W`
never applies. This is the single reason the block fits portrait.

**Its own palette.** A named sequential ramp plus a step count, separate from the clinical
status palette. A cell value of zero paints the empty tint. With `steps: 1` the grid is binary,
which is what the data supports today. Raising `steps` later carries result volume with no
change to the layout or the query shape.

**Group gaps.** `groupBoundary: 'token-change'` inserts a gap wherever the group token changes.
The token is data, so week grouping works for any month, including one starting mid-week where the
first group is short. No special case.

It is deliberately not called `groupBy`. Everywhere else in this repo that name takes a column key
(`packages/workflows/src/engine/node-handlers/pivot.ts`, `packages/dashboards/src/compile.ts`), and
this takes neither a column nor a key. Nor is the value called `header-change`: the tokens live in
their own row, not in the header row, and naming the header would send a reader to the wrong one.

**Row pitch derived from cell size**, not the fixed 16pt.

### 2.3 Pagination

`cellgrid` paginates like `table`: it chunks to fit its rect, and every chunk redraws the header
band so continuation pages carry the day numbers. Its heading is tied to it with `showWithTable`
so an empty block never prints a heading over nothing. That is existing behaviour and the reason
the flag exists.

### 2.4 The month calendar is the same element

The calendar at the top of page 1 is `cellgrid` in a second configuration: seven cell columns,
one row per week, no label column, `steps: 5`.

This is the first test of whether the family idea holds. **If the calendar needs a special case
in the renderer, the contract is wrong.** Finding that out now is cheaper than finding it out
after four more elements exist.

### 2.5 The four figures

`keyvalue` gains a third `layout` value, `'stat'`, alongside the existing `'inline'` and
`'stacked'`. With `panelColumns: 2` that gives the two-by-two grid of number-over-caption boxes
the preview shows.

A new value on an existing field was preferred to a new element. `layout` and `panelColumns` are
both already in the schema.

---

## 3. Parameters

Five on the design, two of them new.

| Key | Type | Required | Notes |
|---|---|---|---|
| `month` | text | yes | Unchanged. `year-month` format, existing guard |
| `panels` | text | yes | Unchanged. Comma-separated HVL/EID panel codes |
| `region` | select | conditional | Options from a new `q-regions` |
| `facility` | select | conditional | Options from the existing `q-facilities` |
| `blocks` | select | yes | `both`, `hvleid`, `other` |

### 3.1 Scope is required

`region` and `facility` are each individually optional, with a rule that **at least one must be
set**. A run with neither is refused.

The refusal states how many laboratories matched, so the operator learns what they were being
protected from rather than just being blocked.

This is a deliberate cost on small installs. A 40-laboratory site must name a scope on every run
even though an unfiltered run would be fine. The operator chose this over a size threshold, on
the grounds that one rule is easier to reason about than a rule with an exception.

### 3.2 The facility control has to be searchable

The measurement in §7 makes this a requirement rather than a preference. On this warehouse the
facility list is 583 options whose labels are mostly the raw code: `5BQ01`, `AAS06`, `AAS22`,
`AAS31`, with only occasional resolved names like `AAM International`.

A plain `select` over 583 opaque codes, on a report that refuses to run without one, is a control
the operator cannot use. It needs type-ahead over both the code and the label, following the
existing studio combobox pattern rather than a new one.

**This is the weakest point in the design.** The required-scope rule assumes naming a scope is
easy. Where the registry is unresolved it is not, and no amount of renderer work fixes that. The
real repair is populating `facility_map`, which is out of scope here and worth its own slice.

### 3.3 Two controls, not one

A single control with tagged options was offered and rejected in favour of two explicit selects.
**When both are set they intersect**, and the scope panel names both.

### 3.4 The scope panel must name the filter

The panel gains a row carrying the active scope. Without it a reader cannot tell a region report
from a whole-network one.

This matters more than the page count. A filtered report that looks unfiltered is a report that
says a laboratory did not transmit when the truth is that it was never asked about.

---

## 4. Query changes

Both `q-transmission-hvleid` and `q-transmission-other` change shape.

**Two synthetic leading rows instead of one.** `ord = 0` carries the visible day labels, as
today. `ord = 1` carries a week token per column, read by `groupBoundary: 'token-change'`. This
reuses the existing `ord` mechanism rather than inventing a second one.

**Two computed columns per laboratory.** `days` is the count of working days carrying a
submission. `silent` is the count of working days since the last submission, as at the last
working day of the month. Both are SQL, so the renderer does no arithmetic over the data.

**`ord` numbers laboratories alphabetically from 2 upward.** The design keeps `sortBy: 'ord'`.
Alphabetical therefore costs nothing at render time, and `ord` is a unique tiebreaker, which is
what AGENTS.md §7 requires of any `ORDER BY` carrying an `OFFSET`.

**Two filter predicates** joining `facility_map`, each a no-op when its parameter is empty.
`region`, `district`, `council` and `level` already exist on that table
(`packages/db/src/migrations/external/012_facility_map.ts:41`). **No migration is needed.**

`blocks` is applied by the caller, not inside the SQL. It decides which of the two elements
render, and `showWithTable` already handles a block that is absent.

### 4.1 Two things the second synthetic row puts at risk

**`transmissionGridColumns()` is retired for this design.** `cellgrid` declares `cellColumns`
and `trailingColumns` instead of `boundColumns`. The blank day labels that function returns exist
so `headerTexts` fills them from the header row, and `cellgrid` reads that row directly. Check
whether any other design calls it before deleting it.

**The synthetic-row count goes from one to two, and two places already depend on it being one.**
`report-seeds.ts` records that `r-transmission-grid` declares `summaryMetrics: null` and a static
`chart` precisely to stop a fallback that counted rows and published "24" for a 23-laboratory
month. That off-by-one becomes off-by-two here. Both fields stay as they are, which keeps the
fallback from ever running, but any new count over these queries must subtract 2, not 1.

---

## 5. Page geometry

A4 portrait, 36pt margins, 523.28pt body width.

Worst case is a 31-day month starting Monday: 23 working days across 5 week groups.

```
label 105 + gap 9 + strip 298.5 + gap 9 + days 34.5 + gap 6 + silent 52  =  514.0pt
strip = 23 cells x 10.5  +  18 intra-gaps x 1.5  +  4 inter-gaps x 7.5
```

Nine points of headroom against 523.28. **That is thin enough to be a test rather than a
comment.** The worst-case month must be asserted to fit, computed from the constants, so a later
change to any one of them fails loudly instead of silently ellipsizing laboratory names.

Continuation pages hold about 43 rows against the preview's 40. That number is also asserted
rather than assumed.

---

## 6. Definition of done

Per AGENTS.md §6, five places.

1. **Studio.** The parameter sheet gains `region`, `facility` and `blocks`, following §5's
   conventions.
2. **CLI parity.** `packages/cli/src/report.ts` already exists. The new parameters flow through
   it, and the scope rule lives in shared code in `@openldr/bootstrap` so the Fastify route and
   the CLI refuse identically. Never two copies of the rule.
3. **Docs.** In-app and web, in en, fr and pt. A missing key renders as literal braces, so a
   partial translation ships visibly broken.
4. **Mobile.** The parameter sheet at 375x812. The PDF itself is not a mobile surface.
5. **Changelog.** `pnpm make:changelog` after merging to `main`, committed in the same slice.

---

## 7. Testing, and what it will not prove

**Golden tests** for `cellgrid`, covering the binary grid, the five-step calendar, a month
starting mid-week, and the worst-case 23-day month.

**Route tests** for the scope rule. `typecheck` green does not pin a route's wire shape.

**A geometry test** asserting the worst-case month fits the portrait body.

Three gaps, stated plainly because the alternative is discovering them later.

**pg-mem cannot validate the new SQL.** It has no correlated-subquery support and a stable scan
order. `days`, `silent` and both filter predicates need a live Postgres run. Until that happens
they are unverified, and a green suite does not change that.

**The greyscale result is arithmetic, not a print.** The filled cell is 68% ink, the empty cell
17%, and they are 50.8 percentage points apart in luminance. That was computed. Nobody has put
it through the printer these reports are signed on.

**`region` is empty on this warehouse.** Measured on 2026-08-20, not inferred:

| Check | Result |
|---|---|
| `facility_map` rows | 583 |
| ...with `region` | 0 |
| ...with `district` | 0 |
| ...with `name` | 0 |
| ...with `registry_id` | 0 |
| `diagnostic_reports` rows | 23,285, every one with a performer |
| Distinct performer codes | 583 |
| Options `q-facilities` returns | 583 |

The facility resolution has never landed here. `q-facilities` still works, because it falls back
through `coalesce(fm.name, dr.performer_display, dr.performer)` to the raw code.

**This is a supported state, not a defect.** The operator reports that Tanzania populates region
and Zambia does not. CE ships to both. An install with no region data is normal, so `q-regions`
returning zero rows must render as an empty control, never as an error.

---

## 8. Rejected

**Extending `table`.** Four special cases on the element every other report depends on.

**Sorting by coverage.** The preview sorted failing laboratories to the bottom of each block.
The operator chose alphabetical. The cost is that the `Silent` column now carries the exception
signal alone, and the page 1 figures carry more weight because of it.

**A row cap, and a page-count warning.** Both were offered as gentler alternatives to a required
scope. The operator chose the hard rule.

**A single scope control with tagged options.** The operator chose two explicit selects.
