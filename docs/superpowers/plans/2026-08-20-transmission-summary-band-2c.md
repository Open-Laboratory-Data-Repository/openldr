# Implementation plan: the LIS Stakeholders Update summary band

**Spec:** `docs/superpowers/specs/2026-08-20-transmission-summary-band-slice2c-design.md`
**Design:** `rt-transmission-grid`  **Branch:** work on local `main`, merge there, then push.

Two slices. 2c-i adds two query ids and binds nothing, so it changes no rendered output and merges
on its own. 2c-ii binds them, adds one schema field, fixes one latent `flowAfter` defect and
renegotiates the page-1 geometry.

Read `AGENTS.md` first. RULE 0 applies to every claim below: the measurements are dated and were
taken on the dev warehouse on 2026-08-20, whose contents have changed at least once during this arc.
Re-measure before trusting a number.

---

## Background a reader needs

`SEED_QUERIES` (`packages/reporting/src/seed/report-seeds.ts`) holds every built-in query, each with
`postgres`, `mssql` and `mysql` text. `seedDataDrivenReports` refreshes stored SQL from this file on
every boot, so an install that takes the code takes the SQL.

`substituteParams` (`packages/dashboards/src/custom-query-run.ts:24`) inlines an escaped quoted
literal for each of the QUERY's own declared parameters. A value supplied for a parameter the query
does not declare is ignored. That is what lets the band's queries take `month` alone while the
design also carries `panels`.

A bound `keyvalue` reads `resolved.rows[0]` only (`draw.ts:479`). A `cellgrid` lifts row 0 as its
header band, and row 1 as well when `groupBoundary` is set (`cellgrid.ts`, `splitCellGridRows`).

The mysql transmission variants CANNOT RUN on a MySQL warehouse today. `q-transmission-hvleid`'s own
mysql text opens with that disclosure: `max()` over the date row's `concat` raises error 1267
through the connector pool. The band's mysql variants must not repeat that shape, and they are
unverified either way.

---

# Slice 2c-i: the two queries

## Task 1: `q-transmission-calendar`, postgres

**Files:** modify `packages/reporting/src/seed/report-seeds.ts`.

Shape: `ord`, `c1`..`c7`. `ord = 0` carries `M T W T F S S`. Then one row per ISO week, ordered by
the week's first calendar day, cell = distinct laboratories that submitted that day.

- CTEs `month_start` and `arrivals` copy `q-transmission-hvleid`'s, MINUS the panel predicate and
  minus the `panel_list` CTE.
- New `cal` CTE over every day of the month. Do NOT reuse `days`: it is Mon-Fri and weekend arrivals
  are real (7 in 2013-07, 10 in 2013-09, measured).
- Every column is text. A `union all` of a text header row and numeric week rows does not type-check
  in postgres, so the counts cast.
- A day outside the month is `''`, which the renderer reads as the empty tint.

**Verify:** run it against `TARGET_DATABASE_URL` for 2013-07 and 2013-09. Expect the pivots in spec
section 2.2, including September's single-cell first row.

**Commit:** `feat(reports): add q-transmission-calendar (postgres)`

## Task 2: `q-transmission-summary`, postgres

One row, four columns: `labs`, `pct_lab_days`, `busiest`, `silent10`.

- `busiest` counts CALENDAR days. `pct_lab_days` and `silent10` count WORKING days. Both units in
  one panel, deliberately. Say so in the SQL comment.
- Guard the division. An empty month prints 0 and renders a page.
- Emit `9.8`, never `'9.8%'`. The caption carries the unit.
- `silent10` reuses the invented 10-working-day threshold. Name it as invented, as the two grid
  queries already do.

**Verify:** 2013-07 gives 47 / 9.8 / 17 / 11. 2013-09 gives 28 / 11.4 / 8 / 10.

**Commit:** `feat(reports): add q-transmission-summary (postgres)`

## Task 3: the mssql variants

Follow `q-transmission-hvleid`'s mssql conventions exactly: recursive `all_days`,
`format(..., 'yyyy-MM', 'en-US')` for the month, `datediff(day, '19000101', cal_day) % 7` for the
weekday, `datepart(iso_week, cal_day)` for the week.

**Verify:** against the running SQL Server container, on a database built by the real external
migrations with a small fixture. Record what was run and what it returned.

**Commit:** `feat(reports): add the mssql variants of the summary band queries`

## Task 4: the mysql variants

Follow the mysql conventions: `with recursive`, `date_format(..., '%Y-%m')`, `weekday()`,
`weekofyear()`.

Avoid `max()` over `concat` of table columns. The calendar's cells are counts, so cast each count to
`char` inside the `case` and keep every literal a plain literal. That sidesteps the collation mix
that already stops the two grid queries running on MySQL.

**HONEST NON-PROOF.** No MySQL container runs on this machine. These ship written, parsed by nobody,
and the slice report says so. What would prove them: a MySQL harness in CI running all three
dialects on every change.

**Commit:** `feat(reports): add the mysql variants of the summary band queries`

## Task 5: shape tests

**Files:** modify `packages/reporting/src/seed/report-seeds.test.ts`.

Regexes over SQL text cannot see a syntax error. What they CAN pin, and what has gone wrong before
in this arc:

- Both queries declare `month` and only `month`.
- Neither mentions `{{param.panels}}`. The band is not filtered by panel.
- Neither mentions `ingest_events`, `recorded_at`, `at time zone` or `convert_tz`, the same ban the
  grid queries carry.
- The calendar returns exactly `ord` and `c1`..`c7`.
- The summary returns exactly the four figure columns.
- All three dialects exist for both ids.

**Commit:** `test(reports): pin the shape of the summary band queries`

## Task 6: live tests

**Files:** new `packages/reporting/src/seed/transmission-summary-live.test.ts`.

Provision a throwaway database, migrate it, seed a fixture, run both queries. Assert:

- `busiest` equals the largest cell in the calendar. This is the cross-check that the two queries
  agree, and it is the one assertion that catches a pivot drifting away from the aggregate.
- A weekend arrival appears in the calendar and does not appear in `pct_lab_days`.
- A month with no arrivals returns one summary row of zeros and a full calendar of blanks, rather
  than no rows.
- A laboratory silent 10 or more working days is counted, one silent 9 is not.

Every test must be driven red before it is accepted. A test that stays green when the code under
test is deleted proves nothing, and eight were rejected in this project for exactly that.

**Commit:** `test(reports): drive the summary band queries through a live warehouse`

## Task 7: gate and merge 2c-i

`pnpm turbo run test`, never piped through `tail`. Then merge to local `main`, push, confirm the
origin SHA, and run `pnpm make:changelog`.

---

# Slice 2c-ii: the design

## Task 8: `showOn: 'first-chunk'`

**Files:** `packages/report-designer/src/schema.ts`, `render/draw.ts`, `render/draw.test.ts`.

Read by `drawsOnChunk`, beside `showWithTable`, failing open the same way. Opt-in and inert when
unset.

**Commit:** `feat(report-designer): showOn lets an element draw on the first chunk only`

## Task 9: `drawnHeight` returns 0 for an element that is not drawn

**Files:** `render/draw.ts`, `render/draw.test.ts`.

Today it returns the full declared rect for anything that is not a table or a cellgrid, on every
chunk, so a `flowAfter` follower leaves a hole where a hidden element would have been. Nothing hits
it today. The band does.

`golden.test.ts` proves this changes no existing design. Do not edit that file.

**Commit:** `fix(report-designer): a hidden element adds no height to a flowAfter follower`

## Task 10: the elements and the page-1 geometry

**Files:** `packages/reporting/src/seed/report-seeds.ts`, `report-seeds.test.ts`.

- Calendar `cellgrid`: seven `cellColumns`, no `labelColumn`, `steps: 5`, `sortBy: 'ord'`,
  `showOn: 'first-chunk'`.
- Figures `keyvalue`: `layout: 'stat'`, `panelColumns: 2`, four `boundColumns`,
  `showOn: 'first-chunk'`.
- The stat panel is the flow anchor at 120px@96. A seed test asserts that height covers a six-week
  calendar, computed from `CELL_HEAD_H` and `CELL_ROW_H`, not from the literal 120.
- `hvleid`'s heading gains `flowAfter` on the stat panel. The rest of the chain is unchanged.

**Commit:** `feat(reports): the LIS Stakeholders Update grows its summary band`

## Task 11: render it and look at it

Render against the live warehouse for a month with data, convert to images, and look at every page.
Check: the band appears on page 1 and nowhere else, the grids move up on page 2, the busiest day is
the darkest cell, and the footer stays on the page.

Show the operator the images. This is the only step that says the page looks right.

## Task 12: gate and merge 2c-ii

As Task 7.

---

## What this plan does not do

**No migration.** No column, no table, no parameter.

**No studio change.** The canvas does not draw `flowAfter` today, so `showOn` joins an existing gap.

**No i18n.** This report is English throughout, as it was before this slice.
