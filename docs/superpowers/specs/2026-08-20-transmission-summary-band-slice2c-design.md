# The LIS Stakeholders Update grows a summary band

**Date:** 2026-08-20
**Status:** built. Both slices landed on 2026-08-20.
**Design:** `rt-transmission-grid`  **Report:** `r-transmission-grid`

Page 1 of the approved design carries a month calendar and four figures above the two laboratory
grids. Slice 2b shipped the grids. This is the band.

Extends `2026-08-20-transmission-grid-cellgrid-design.md` section 5.1, which deferred this work and
named the reason. Nothing in that spec is reversed here.

---

## 1. Two slices, not one

**2c-i is the queries. 2c-ii is the design.**

Slices 2a and 2b had to merge together, because 2a changed the SHAPE of two queries the live design
was already bound to, and the moment those queries emitted a second synthetic row the shipped report
grew a laboratory named `(week)`. That does not apply here. `q-transmission-calendar` and
`q-transmission-summary` are new ids. Nothing binds them until 2c-ii does, so 2c-i changes no
rendered output at all and can merge on its own.

The operator chose the split on 2026-08-20 over one large slice covering six SQL variants, two new
elements, a schema field, a renderer fix and the page-1 geometry.

---

## 2. The queries

Both take `month` and nothing else. Neither takes `panels`.

The band sits above both grids and describes the whole month, so the HVL/EID split does not apply to
it. `substituteParams` builds its replacements from the query's own declared parameters
(`packages/dashboards/src/custom-query-run.ts:24`), so a run that supplies `panels` as well is fine.
The extra value is ignored.

### 2.1 What they reuse, and the one thing they cannot

`month_start` and `arrivals` carry over from `q-transmission-hvleid` unchanged, minus the panel
predicate. The clinical-date ladder, the batch attribution and the string month test are all the
same decisions, already argued in that query's own comments.

`days` does NOT carry over. It is Mon-Fri, and the calendar needs all seven. That is not a
theoretical difference. Measured on the dev warehouse, 2026-08-20:

| Month | Weekend arrivals |
|---|---|
| 2013-07 | 7 |
| 2013-09 | 10 |

Laboratories do submit at weekends here. A calendar built on the working-day CTE would drop those
cells and print a month with holes in it. So the calendar gets its own `cal` CTE over every day of
the month, and the working-day `days` CTE stays where it is, feeding the figures that are defined in
working days.

### 2.2 `q-transmission-calendar`

One row per ISO week, seven cell columns, Monday first.

`ord = 0` is the header row: `M T W T F S S`. The cellgrid lifts it and draws it in the header band,
the same way the laboratory grids' day numbers arrive as data rather than as design constants. There
is no group-token row, so the lift is 1, not 2.

Each cell is the number of DISTINCT laboratories that submitted on that calendar day. A day outside
the month is blank.

Measured live, 2013-07 and 2013-09:

```
2013-07                     2013-09
wk 27   0  0  2  1  3  0  1     wk 35   .  .  .  .  .  .  1
wk 28   3  3  2  6  7  1  0     wk 36   1  4  6  1  0  0  0
wk 29   2  6  6  7  2  0  0     wk 37   1  2  2  4  1  0  0
wk 30   1 12  4 11 17  3  2     wk 38   2  4  1  2  6  1  3
wk 31   3  2  6  .  .  .  .     wk 39   3  6  8  2  6  2  3
                                wk 40   5  .  .  .  .  .  .
```

September 2013 starts on a Sunday and its first row carries one cell. That is the mid-week start
case, working, with no special handling anywhere.

Six rows is the most any month can produce. A 31-day month beginning on a Sunday is the worst case,
and it spans six ISO weeks. Section 4 spends that number.

**ISO week numbers are the grouping key, not a printed value.** They never reach the page. Within one
month they cannot collide: no month contains two week 01s.

### 2.3 `q-transmission-summary`

One row, four columns. A bound `keyvalue` reads exactly `resolved.rows[0]`
(`packages/report-designer/src/render/draw.ts:479`), so a second row would be silently dropped and
there is nothing useful to put in one.

| Column | Meaning | 2013-07 | 2013-09 |
|---|---|---|---|
| `labs` | distinct laboratories with any arrival in the month | 47 | 28 |
| `pct_lab_days` | lab-days carrying data, over labs x working days | 9.8 | 11.4 |
| `busiest` | most laboratories on one CALENDAR day | 17 | 8 |
| `silent10` | laboratories silent 10 or more working days | 11 | 10 |

`busiest` counts calendar days, so it can land on a Saturday. `pct_lab_days` and `silent10` are
defined in working days, because both compare against what the month asked of a laboratory.
The two units in one panel are deliberate and stated here so nobody later "fixes" one to match the
other.

`busiest` is also the cross-check between the two queries. It must equal the largest cell in the
calendar. Both months above agree, and a test asserts it rather than leaving it as a coincidence
somebody once observed.

`silent10` reuses the same invented 10-working-day threshold `lab_stats` already carries in both
grid queries. It is an operational number the approved preview chose, not a clinical one, and it is
now in three places. 2c-i states that in each one.

`pct_lab_days` divides by `labs x working_days`. An empty month makes that zero, so the SQL guards
the division and the figure prints 0 rather than failing the run. A month with no arrivals must
render a real page, not an error.

**The percent sign lives in the caption, not the value.** The SQL emits `9.8`. Formatting a number
into a string is where three dialects stop agreeing, and the caption already has to say what the
figure means.

---

## 3. The elements

Neither is new. Both configurations already exist in tests.

**The calendar is a `cellgrid`**: seven `cellColumns`, no `labelColumn`, `palette: { ramp: 'blue',
steps: 5 }`, no `groupBoundary`. This is the exact configuration `golden.test.ts` already renders to
prove the element family holds without a special case. 2c-ii binds it to real data.

**The figures are a `keyvalue`** with `layout: 'stat'` and `panelColumns: 2`. Slice 2b built that
layout and no seeded design uses it. This is what it was built for.

The ramp scales across the whole calendar, so the busiest day is the darkest cell and every other
day is read against it.

---

## 4. Two renderer changes

Both are small, both are opt-in, and one of them is a bug fix that is not really about this band.

### 4.1 `showOn: 'first-chunk'`

A design page repeats every element on every physical chunk. The letterhead should repeat. A
month-wide summary above a continuation page should not: it costs 90pt of every later page and
restates figures that are already on page 1.

`showOn: 'first-chunk'` is read by `drawsOnChunk`, beside `showWithTable`, and fails open the same
way.

### 4.2 A `showOn` element adds no height to a follower

`drawnHeight` returns the full declared rect for anything that is not a table or a cellgrid, whatever
chunk it is asked about. A `flowAfter` follower therefore leaves a hole where a hidden element would
have been. `hvleid` flows after the stat panel, and on page 2 the panel is gone.

**Narrower than it first looked.** The obvious fix, "return 0 for anything `drawsOnChunk` hides",
does not terminate. A follower's pagination depends on its y, its y depends on the target's drawn
height, and a `showWithTable` target's visibility depends on the follower's own chunk count.
Measuring the target there is a cycle, and it is reachable from the design as it stands today:
`other` flows after a heading that `showWithTable` ties back to `other`.

So the rule is keyed on `showOn` alone, which cannot recurse because it reads nothing but the chunk
number. Nothing needs the wider version: a `showWithTable` heading is hidden exactly when the block
it names is hidden, so no drawn element ever measures one. Found while implementing, on 2026-08-20.

---

## 5. Page-1 geometry

The band sits between the scope panel and the HVL/EID heading. The calendar is on the left, the four
figures to its right.

**The stat panel is the flow anchor, at a fixed 120px@96 (90pt).**

The calendar's drawn height varies with the month: four weeks is 64pt, six is 89.5pt
(`CELL_HEAD_H 13 + 6 x CELL_ROW_H 12.75`). Anchoring the chain on an element whose height moves would
put the grids at a different y in a four-week month and, worse, would overlap the fixed panel beside
it. So the panel owns the band's height, 90pt covers the tallest calendar with half a point to
spare, and a seed test asserts that relationship from the constants rather than from the number 120.

The chain becomes:

```
scope panel (fixed y)
  stat panel + calendar          showOn: 'first-chunk'
    HVL/EID heading              flowAfter: stat panel
      hvleid                     flowAfter: heading
        Other heading            flowAfter: hvleid
          other                  flowAfter: heading, fillTo: 'rect-bottom'
```

On page 2 the band draws nothing, contributes zero height, and the whole chain moves up 90pt.
Continuation pages lose nothing.

**Page 1 loses about 7 grid rows.** `hvleid` keeps its fixed 285pt box and starts 90pt lower, so
`other` fills from lower down to the same bottom edge. That is the cost of the band and it is paid
once per report.

---

## 6. What this will not tell you

**Two of three dialects are unverified.** Postgres and MSSQL get a live run. MySQL ships written and
unverified, because no MySQL container runs on this machine. That is an HONEST NON-PROOF and 2c-i
says so in the slice report, not only here.

**pg-mem cannot stand in for any of it.** No correlated subqueries, a stable scan order, and the
pivot and the distinct counts are exactly what is under test.

**A day outside the month looks like a day nobody submitted on.** Both paint the empty tint. The
cellgrid has no third cell state, and adding one would contradict section 2.4 of the parent spec,
which says that needing a special case for the calendar means the element contract is wrong. The
operator accepted this on 2026-08-20 with the approved preview in front of them and this note in
hand.

**Nothing here proves the band matches the preview.** The preview is not committed anywhere this
document can read. The operator confirms the render.

---

## 7. Definition of done

Per AGENTS.md section 6.

1. **Studio.** No change. No new run parameter, and the studio canvas already does not draw
   `flowAfter`, so `showOn` joins a gap that exists rather than opening a new one.
2. **CLI parity.** No change. `packages/cli/src/report.ts` runs any design and names no layout.
3. **Docs.** No in-app or web doc names this report's layout. Grep before concluding it again in the
   plan, not here.
4. **Mobile.** The parameter sheet is unchanged. A PDF is not a mobile surface.
5. **Changelog.** `pnpm make:changelog` after each slice merges to `main`.

**No migration.** No column, no table, no parameter.
