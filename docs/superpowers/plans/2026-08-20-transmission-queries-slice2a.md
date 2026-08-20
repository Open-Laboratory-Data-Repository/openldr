# Transmission grid queries (slice 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `q-transmission-hvleid` and `q-transmission-other`, in all three dialects, so
each emits the shape the `cellgrid` element needs: two synthetic leading rows instead of one, two
computed columns per laboratory, and a unique `ord` per laboratory. Six variants total.

**Architecture:** Query text only, inside `packages/reporting/src/seed/report-seeds.ts`. No
schema, no design, no parameters, no CLI, no docs, no studio. The `cellgrid` renderer this feeds
already exists and is untouched (slice 1, `docs/superpowers/plans/2026-08-20-cellgrid-element-slice1.md`).

**Tech Stack:** Raw SQL (postgres/mssql/mysql dialect strings), TypeScript, vitest, pnpm workspaces.
Postgres changes are verified against the live warehouse at `TARGET_DATABASE_URL`, read-only.

**Slice boundary:** the two queries' `sql.postgres` / `sql.mssql` / `sql.mysql` strings, plus the
existing tests that assert on their shape. Nothing in `packages/report-designer` changes. The
seeded design `rt-transmission-grid` (a `table` element, not `cellgrid`) is not touched, and that
has a real consequence spelled out below and in "Known gaps this slice does not close." Read it
before starting.

**Spec:** `docs/superpowers/specs/2026-08-20-transmission-grid-cellgrid-design.md`, section 4.

---

## Background the engineer needs

Both queries share one shape. Five CTEs build the calendar and the arrivals, then a `grid` CTE
crosses every laboratory against every working day, then a final `select ... union all ... union
all` publishes two rows today: `ord = 0` (the date labels) and `ord = 1` (every laboratory,
sharing that one number). This slice changes only the `grid` CTE's mark value and the final
`select`. Every CTE before `grid`, namely `month_start`, `days`/`all_days`, `arrivals` and `labs`,
is untouched in all six variants, in every task below.

**Read section 4 of the spec before touching any SQL.** It names three changes: two synthetic
rows, two computed columns, and a unique `ord`. This plan makes exactly those three changes, plus
one more the spec's three-item list does not mention but the stated goal ("emit the shape the
`cellgrid` element needs") requires. See the next paragraph.

**A fourth change the spec's list omits: the mark value.** `cellgrid`'s palette computes
`Number(cellValue)` (`packages/report-designer/src/render/cellgrid.ts:520`, `stepFor`) and treats
anything that is not a finite positive number as empty. Today's mark is `'Y'` or `''`.
`Number('Y')` is `NaN` and `Number('')` is `0`. Both read as empty. Left as `'Y'`/`''`, every cell
in the new grid would paint as empty on every run, on every laboratory, silently. The fix is one
word: change the filled branch from `'Y'` to `'1'`. The blank branch **stays `''`**. Do not change
it to `'0'`. `Number('')` is already `0`, which `stepFor` already treats as empty (verified:
`node -e "console.log(Number(''))"` returns `0`), so touching it would be a needless second edit
to every one of the many existing tests that assert a blank cell is `''`. Changing only the filled
branch is the minimal, fully sufficient fix.

**A real consequence for the report that renders today, from touching the query alone.** The
seeded design `rt-transmission-grid` is a `table` element with `headerRow: true`. `bodyRowsFor`
(`packages/report-designer/src/render/draw.ts:352-355`) lifts **exactly one** row into the header
band, `rowsFor(...).slice(1)`, never `.slice(2)`. Today that is correct: one synthetic row, one
lift. After this slice the query emits **two** synthetic rows, and the design still lifts one.
The second (`ord = 1`, the week-token row) prints as an ordinary body row: a fake laboratory named
`'(week)'` with week numbers where marks used to be, above every real laboratory, on both grids.
This is not fixed in this slice. Fixing it means replacing `rt-transmission-grid` with a
`cellgrid`-based design, which is out of scope here by the brief ("no design change"). It is real,
it is cited, and Task 6 adds a test that pins the exact behaviour rather than leaving it as an
unverified claim. See "Known gaps this slice does not close" for what this means for deployment.

**`sortBy: 'ord'`'s comparator is numeric-safe regardless of the pg driver's return type.**
`row_number()` returns `bigint`, and node-postgres returns `bigint` columns as JS strings, not
numbers, while the literal `0 as ord` / `1 as ord` rows are `int4` and come back as JS numbers.
Once these are combined in one `UNION ALL`, Postgres widens the whole `ord` column to `bigint`, so
every row's `ord` (0, 1, 2, 3, up to 21) comes back from the driver as a **string**. This does not
break sorting: `compareOn` (`packages/report-designer/src/render/resolve.ts:9-16`) does
`Number(av) - Number(bn)` whenever both values parse as finite numbers, string or not, so `'10'`
sorts after `'9'` correctly. Checked by reading the comparator, not assumed.

**pg-mem cannot validate any of this.** No correlated-subquery support, stable scan order. See
`transmission-grid-live.test.ts:53` and AGENTS.md §7. Postgres is verified below against the real
warehouse at `TARGET_DATABASE_URL` (23,285 `diagnostic_reports`, 583 distinct performer codes,
read-only, `SELECT`/`WITH` only). MSSQL and MySQL cannot be executed in this environment: no
`sqlcmd`, no `mysql` client, no local server (`docker ps` shows only the Postgres container this
repo already runs). Both carry the same `HONEST NON-PROOF` marker the file already uses for these
two dialects, extended to say so plainly.

**No migration.** This slice adds no new column, no new table, no new parameter. `facility_map`
is not touched (the region/facility filter predicates in spec §4 are a **different**, later
change; this slice's brief explicitly excludes new parameters). Confirmed by reading every CTE
this slice edits: none references a table this repo does not already have wired in.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/reporting/src/seed/report-seeds.ts` | **Modify.** `sql.postgres`/`sql.mssql`/`sql.mysql` on both `q-transmission-hvleid` (`:2216`) and `q-transmission-other` (`:2768`). |
| `packages/reporting/src/seed/report-seeds.test.ts` | **Modify.** Fix the `as ord` count (2 to 4) and add new shape tests for the week-token row, the unique `ord`, `days`/`silent`, and the `'1'` mark, inside the `SEED_QUERIES` transmission-grid `describe` block at `:1632`. |
| `packages/reporting/src/seed/transmission-grid-live.test.ts` | **Modify.** Fix the four `'Y'` literals, add fixture tests for `days`/`silent`/unique `ord`, and add the characterization test for the `rt-transmission-grid` regression described above. |

---

### Task 1: Postgres, `q-transmission-hvleid`

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:2330-2389` (`sql.postgres`)

This is the reference dialect: verified against the live warehouse, and the pattern Tasks 3 and 4
transliterate.

- [ ] **Step 1: Confirm the untouched CTEs, then replace `grid` through the end of the query**

`month_start` (`:2237-2250`), `days` (`:2251-2258`), `arrivals` (`:2259-2326`) and `labs`
(`:2327`) do not change. Replace lines `2330-2389`, the `grid` CTE through the final
`order by ord, lab`, with:

```sql
grid as (
  select l.lab, dy.n,
         case when a.lab is null then '' else '1' end as mark
  from labs l
  cross join days dy
  left join arrivals a on a.lab = l.lab and a.cal_day = dy.cal_day
),
lab_stats as (
  -- 'days': count of DISTINCT WORKING days this laboratory submitted on -- the same figure a
  -- reader gets by counting filled cells in its own row, computed here so the renderer does no
  -- arithmetic over the data (spec section 4).
  -- 'silent': working days between the laboratory's LAST submission and the last working day of
  -- the month. LEFT JOIN throughout, never INNER: a laboratory whose only submission this month
  -- landed on a Saturday or Sunday has ZERO rows in 'days' (Mon-Fri only), and an inner join here
  -- would drop that laboratory from the grid ENTIRELY instead of showing it silent all month.
  -- ⛔ MEASURED on the live warehouse, 2017-08, HVL/EID panels: 'Mbagala Kizuiani' and
  -- 'Mwananyamala' are exactly this case -- days=0, silent=23 (the whole month). See Step 2.
  select l.lab,
         count(dy.n) as days,
         (select max(n) from days) - coalesce(max(dy.n), 0) as silent
  from labs l
  left join arrivals a on a.lab = l.lab
  left join days dy on dy.cal_day = a.cal_day
  group by l.lab
),
lab_ord as (
  -- Unique per-laboratory ord, alphabetical from 2. 0 and 1 are spoken for by the date row and the
  -- week-token row below, so 'order by ord' alone is a full tiebreaker across the WHOLE result --
  -- what AGENTS.md section 7 requires of any ORDER BY carrying an OFFSET, and planPagination
  -- (packages/dashboards/src/sql-runner.ts:56) wraps this query in exactly that shape.
  select lab, row_number() over (order by lab) + 1 as ord
  from labs
)
select 0 as ord, '(dates)' as lab,
  max(case when n = 1 then to_char(cal_day, 'FMDD') || chr(10) || to_char(cal_day, 'Mon') else '' end) as d01,
  max(case when n = 2 then to_char(cal_day, 'FMDD') || chr(10) || to_char(cal_day, 'Mon') else '' end) as d02,
  -- d03..d22 UNCHANGED from the current file (same "max(case when n = N then …" pattern) --------
  max(case when n = 23 then to_char(cal_day, 'FMDD') || chr(10) || to_char(cal_day, 'Mon') else '' end) as d23,
  '' as days, '' as silent
from days
union all
select 1 as ord, '(week)' as lab,
  -- The ISO week number. NEVER DRAWN -- spec section 4: "the token's value is never drawn and
  -- carries no meaning, only its CHANGES matter." Verified against August 2017 on the live
  -- warehouse (Step 2): 23 working days fall into weeks 31,31,31,31 | 32×5 | 33×5 | 34×5 | 35×4 --
  -- breaks at n=5,10,15,20, exactly the fixture `cellgrid.test.ts`'s `groupBreaks` already covers.
  max(case when n = 1 then to_char(cal_day, 'IW') else '' end) as d01,
  max(case when n = 2 then to_char(cal_day, 'IW') else '' end) as d02,
  max(case when n = 3 then to_char(cal_day, 'IW') else '' end) as d03,
  max(case when n = 4 then to_char(cal_day, 'IW') else '' end) as d04,
  max(case when n = 5 then to_char(cal_day, 'IW') else '' end) as d05,
  max(case when n = 6 then to_char(cal_day, 'IW') else '' end) as d06,
  max(case when n = 7 then to_char(cal_day, 'IW') else '' end) as d07,
  max(case when n = 8 then to_char(cal_day, 'IW') else '' end) as d08,
  max(case when n = 9 then to_char(cal_day, 'IW') else '' end) as d09,
  max(case when n = 10 then to_char(cal_day, 'IW') else '' end) as d10,
  max(case when n = 11 then to_char(cal_day, 'IW') else '' end) as d11,
  max(case when n = 12 then to_char(cal_day, 'IW') else '' end) as d12,
  max(case when n = 13 then to_char(cal_day, 'IW') else '' end) as d13,
  max(case when n = 14 then to_char(cal_day, 'IW') else '' end) as d14,
  max(case when n = 15 then to_char(cal_day, 'IW') else '' end) as d15,
  max(case when n = 16 then to_char(cal_day, 'IW') else '' end) as d16,
  max(case when n = 17 then to_char(cal_day, 'IW') else '' end) as d17,
  max(case when n = 18 then to_char(cal_day, 'IW') else '' end) as d18,
  max(case when n = 19 then to_char(cal_day, 'IW') else '' end) as d19,
  max(case when n = 20 then to_char(cal_day, 'IW') else '' end) as d20,
  max(case when n = 21 then to_char(cal_day, 'IW') else '' end) as d21,
  max(case when n = 22 then to_char(cal_day, 'IW') else '' end) as d22,
  max(case when n = 23 then to_char(cal_day, 'IW') else '' end) as d23,
  '' as days, '' as silent
from days
union all
select max(lo.ord) as ord, g.lab,
  max(case when g.n = 1 then g.mark else '' end) as d01,
  max(case when g.n = 2 then g.mark else '' end) as d02,
  max(case when g.n = 3 then g.mark else '' end) as d03,
  max(case when g.n = 4 then g.mark else '' end) as d04,
  max(case when g.n = 5 then g.mark else '' end) as d05,
  max(case when g.n = 6 then g.mark else '' end) as d06,
  max(case when g.n = 7 then g.mark else '' end) as d07,
  max(case when g.n = 8 then g.mark else '' end) as d08,
  max(case when g.n = 9 then g.mark else '' end) as d09,
  max(case when g.n = 10 then g.mark else '' end) as d10,
  max(case when g.n = 11 then g.mark else '' end) as d11,
  max(case when g.n = 12 then g.mark else '' end) as d12,
  max(case when g.n = 13 then g.mark else '' end) as d13,
  max(case when g.n = 14 then g.mark else '' end) as d14,
  max(case when g.n = 15 then g.mark else '' end) as d15,
  max(case when g.n = 16 then g.mark else '' end) as d16,
  max(case when g.n = 17 then g.mark else '' end) as d17,
  max(case when g.n = 18 then g.mark else '' end) as d18,
  max(case when g.n = 19 then g.mark else '' end) as d19,
  max(case when g.n = 20 then g.mark else '' end) as d20,
  max(case when g.n = 21 then g.mark else '' end) as d21,
  max(case when g.n = 22 then g.mark else '' end) as d22,
  max(case when g.n = 23 then g.mark else '' end) as d23,
  max(ls.days::text) as days, max(ls.silent::text) as silent
from grid g
join lab_ord lo on lo.lab = g.lab
join lab_stats ls on ls.lab = g.lab
group by g.lab
order by ord
```

Three real changes inside the lab-row branch, beyond the two new CTEs: `grid` is now aliased `g`
(so `g.lab`/`g.n`/`g.mark` disambiguate against `lab_ord`'s and `lab_stats`'s own `lab` columns),
`ord` comes from `lab_ord` instead of the literal `1`, and `order by ord, lab` becomes `order by
ord`. `ord` alone is now a complete tiebreaker, so the second key is dead weight.

- [ ] **Step 2: Verify against the live warehouse (read-only, `SELECT`/`WITH` only)**

Write the substituted query (`{{param.month}}` → `'2017-08'`, `{{param.panels}}` →
`'HIVVL,VLID,HIVPC,EIDID,HIVEL'`) to a scratch file and run it inside a `READ ONLY` transaction:

```bash
export TARGET_DATABASE_URL=$(grep '^TARGET_DATABASE_URL=' .env | cut -d= -f2-)
node -e "
const { Pool } = require('./node_modules/.pnpm/pg@8.21.0/node_modules/pg/lib/index.js');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.TARGET_DATABASE_URL });
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const r = await client.query(fs.readFileSync('/tmp/verify-hvleid.sql', 'utf8'));
    console.log('rowCount', r.rowCount);
    for (const row of r.rows) console.log(row.ord, row.lab, row.days, row.silent);
    await client.query('COMMIT');
  } finally { client.release(); await pool.end(); }
})();
"
```

Expected (this is the ACTUAL output, captured 2026-08-20. A reader can rerun this and get the
same 20 rows, since the warehouse is read-only and unchanged by this task):

```
rowCount 20
2  Bugando Medical Centre (BMC)  days=3 silent=1
3  Buguruni                      days=1 silent=22
4  Cardinal Rugambwa             days=1 silent=9
5  Chanika                       days=1 silent=20
6  Ikuna                         days=1 silent=2
7  Keko Prison                   days=1 silent=20
8  Kibamba                       days=1 silent=20
9  Kibengu                       days=1 silent=6
10 Kigamboni                     days=1 silent=7
11 Lugalo                        days=1 silent=12
12 Lugalo RCH                    days=2 silent=5
13 Makambako .                   days=1 silent=0
14 Mbagala Kizuiani              days=0 silent=23
15 Mikocheni                     days=1 silent=2
16 Mkuranga                      days=3 silent=0
17 Mnazi Mmoja                   days=1 silent=2
18 Mwananyamala                  days=0 silent=23
19 Segerea                       days=1 silent=22
20 Tandale                       days=1 silent=2
21 Temeke                        days=1 silent=3
```

Check: `ord` is 2..21, contiguous, unique, alphabetical by `lab`. 20 laboratories, 20 slots.
`silent = 0` for `Makambako .` and `Mkuranga` (last submission on the month's last working day,
n=23). `days = 0, silent = 23` for the two labs whose only August submission fell on a weekend:
the case the `LEFT JOIN` in `lab_stats` exists for. **This is the case an `INNER JOIN` there gets
wrong.** Rerun with `join arrivals`/`join days` instead of `left join` in `lab_stats` and the row
count drops to 18, silently dropping `Mbagala Kizuiani` and `Mwananyamala` from the grid entirely,
rather than showing them silent. Confirm this by trying it. It is the one mistake in this pattern
that produces no error, only a wrong, shorter grid.

- [ ] **Step 3: Apply the change to `report-seeds.ts`**

Edit `sql.postgres` at `:2237-2389` as in Step 1.

- [ ] **Step 4: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts
git commit -m "$(cat <<'EOF'
feat(reports): two-row transmission grid shape, computed columns, unique ord (postgres hvleid)

Verified read-only against the live warehouse: 20 laboratories, ord 2..21 contiguous, days/silent
correct including the weekend-only-submission edge case an inner join would have dropped.
EOF
)"
```

---

### Task 2: Postgres, `q-transmission-other`

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:2861-2920` (`sql.postgres`)

Structurally identical to Task 1: same `grid`/`lab_stats`/`lab_ord` additions, same rewritten
final `select`. The only textual difference anywhere in `arrivals` is `not in` instead of `in`
(`:2855`), already in the file and untouched by this task.

- [ ] **Step 1: Replace `grid` through the end of the query**

Same block as Task 1 Step 1, at `:2861-2920` instead of `:2330-2389`. Byte-identical CTE and
branch text (`lab_stats`, `lab_ord`, the three `union all` branches). The `panel_code` predicate
that makes this the complement query lives entirely inside `arrivals`, above the part this task
touches.

- [ ] **Step 2: Verify against the live warehouse**

Same script as Task 1 Step 2, `not in` in place of `in`, same month and panel list. Expected:
**65 rows**, `ord` 2..66 contiguous. Four laboratories overlap with the hvleid result,
`Buguruni`, `Mnazi Mmoja`, `Segerea`, `Temeke`, captured 2026-08-20. **This is not a bug.** The
spec's partition claim is about individual *requests*, not laboratory identities (spec §4, "so the
two grids PARTITION the month," read in context of `report-seeds.ts:2771`, "The complement of
q-transmission-hvleid... panel predicate inverted"). One physical laboratory can send both an
HVL/EID panel test and a different panel test in the same month; each is a separate request,
correctly attributed to its own grid, and the laboratory legitimately appears as a row in both.
`transmission-grid-live.test.ts`'s own partition test (`:262-271`) already asserts this at the
request level, not the laboratory level. Confirm by rereading it before assuming otherwise.

- [ ] **Step 3: Apply the change to `report-seeds.ts`**

Edit `sql.postgres` at `:2780-2920` (`month_start` through the untouched `arrivals`/`labs`, then
the same `grid`/`lab_stats`/`lab_ord`/final-select block as Task 1, at this query's line numbers).

- [ ] **Step 4: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts
git commit -m "$(cat <<'EOF'
feat(reports): two-row transmission grid shape, computed columns, unique ord (postgres other)

Verified read-only against the live warehouse: 65 laboratories, ord contiguous from 2. Four labs
also appear in the hvleid grid -- expected, since requests partition, not laboratory identities.
EOF
)"
```

---

### Task 3: MSSQL, both queries

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:2490-2549` (`q-transmission-hvleid.sql.mssql`)
- Modify: `packages/reporting/src/seed/report-seeds.ts:3020-3079` (`q-transmission-other.sql.mssql`)

**HONEST NON-PROOF.** No `sqlcmd`, no local SQL Server instance in this environment (`docker ps`
shows only Postgres). This is a careful, deliberate transliteration of the pattern Tasks 1-2
verified on Postgres, using only T-SQL syntax the file's existing mssql variants already rely on
(`row_number() over (...)`, `datepart`, `cast ... as varchar`). It is unverified beyond that, the
same status the file's existing mssql variants already carry (`:2436-2446`, "WHAT IS PROVEN HERE...
HONEST NON-PROOF, for everything past that one [2026-08-19] run"). This task does not change that
status. It extends the same disclosure to the lines it adds.

- [ ] **Step 1: `q-transmission-hvleid`, replace `grid` through the end of the query**

Replace `:2490-2549` (the `grid` CTE and the final `select ... order by ord, lab`), leaving
`month_start`, `all_days`, `days` and `arrivals` (`:2397-2489`) untouched:

```sql
grid as (
  select l.lab, dy.n,
         case when a.lab is null then '' else '1' end as mark
  from labs l
  cross join days dy
  left join arrivals a on a.lab = l.lab and a.cal_day = dy.cal_day
),
lab_stats as (
  -- Same LEFT JOIN reasoning as the postgres variant: a laboratory whose only submission this
  -- month landed on a weekend has zero rows in 'days' (Mon-Fri only), and an inner join here would
  -- drop it from the grid entirely instead of showing it silent all month.
  select l.lab,
         count(dy.n) as days,
         (select max(n) from days) - coalesce(max(dy.n), 0) as silent
  from labs l
  left join arrivals a on a.lab = l.lab
  left join days dy on dy.cal_day = a.cal_day
  group by l.lab
),
lab_ord as (
  -- Unique per-laboratory ord, alphabetical from 2 -- see the postgres variant for why 'order by
  -- ord' alone is now a full tiebreaker (AGENTS.md section 7).
  select lab, row_number() over (order by lab) + 1 as ord
  from labs
)
select 0 as ord, '(dates)' as lab,
  max(case when n = 1 then concat(format(cal_day, '%d', 'en-US'), char(10), format(cal_day, 'MMM', 'en-US')) else '' end) as d01,
  max(case when n = 2 then concat(format(cal_day, '%d', 'en-US'), char(10), format(cal_day, 'MMM', 'en-US')) else '' end) as d02,
  -- d03..d22 UNCHANGED from the current file --------------------------------------------------
  max(case when n = 23 then concat(format(cal_day, '%d', 'en-US'), char(10), format(cal_day, 'MMM', 'en-US')) else '' end) as d23,
  '' as days, '' as silent
from days
union all
select 1 as ord, '(week)' as lab,
  -- ISO week number, never drawn -- see the postgres variant's comment for why. datepart(iso_week,
  -- ...) matches the file's existing preference for deterministic, session-setting-independent
  -- date arithmetic (see 'days' above: not datepart(weekday, ...), which depends on SET DATEFIRST).
  max(case when n = 1 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d01,
  max(case when n = 2 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d02,
  max(case when n = 3 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d03,
  max(case when n = 4 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d04,
  max(case when n = 5 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d05,
  max(case when n = 6 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d06,
  max(case when n = 7 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d07,
  max(case when n = 8 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d08,
  max(case when n = 9 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d09,
  max(case when n = 10 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d10,
  max(case when n = 11 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d11,
  max(case when n = 12 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d12,
  max(case when n = 13 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d13,
  max(case when n = 14 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d14,
  max(case when n = 15 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d15,
  max(case when n = 16 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d16,
  max(case when n = 17 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d17,
  max(case when n = 18 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d18,
  max(case when n = 19 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d19,
  max(case when n = 20 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d20,
  max(case when n = 21 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d21,
  max(case when n = 22 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d22,
  max(case when n = 23 then cast(datepart(iso_week, cal_day) as varchar(2)) else '' end) as d23,
  '' as days, '' as silent
from days
union all
select max(lo.ord) as ord, g.lab,
  max(case when g.n = 1 then g.mark else '' end) as d01,
  max(case when g.n = 2 then g.mark else '' end) as d02,
  max(case when g.n = 3 then g.mark else '' end) as d03,
  max(case when g.n = 4 then g.mark else '' end) as d04,
  max(case when g.n = 5 then g.mark else '' end) as d05,
  max(case when g.n = 6 then g.mark else '' end) as d06,
  max(case when g.n = 7 then g.mark else '' end) as d07,
  max(case when g.n = 8 then g.mark else '' end) as d08,
  max(case when g.n = 9 then g.mark else '' end) as d09,
  max(case when g.n = 10 then g.mark else '' end) as d10,
  max(case when g.n = 11 then g.mark else '' end) as d11,
  max(case when g.n = 12 then g.mark else '' end) as d12,
  max(case when g.n = 13 then g.mark else '' end) as d13,
  max(case when g.n = 14 then g.mark else '' end) as d14,
  max(case when g.n = 15 then g.mark else '' end) as d15,
  max(case when g.n = 16 then g.mark else '' end) as d16,
  max(case when g.n = 17 then g.mark else '' end) as d17,
  max(case when g.n = 18 then g.mark else '' end) as d18,
  max(case when g.n = 19 then g.mark else '' end) as d19,
  max(case when g.n = 20 then g.mark else '' end) as d20,
  max(case when g.n = 21 then g.mark else '' end) as d21,
  max(case when g.n = 22 then g.mark else '' end) as d22,
  max(case when g.n = 23 then g.mark else '' end) as d23,
  max(cast(ls.days as varchar(3))) as days, max(cast(ls.silent as varchar(3))) as silent
from grid g
join lab_ord lo on lo.lab = g.lab
join lab_stats ls on ls.lab = g.lab
group by g.lab
order by ord
```

- [ ] **Step 2: `q-transmission-other`, apply the same replacement at `:3020-3079`**

Identical block, `not in` in `arrivals` (`:3015`, untouched) makes this the complement query.

- [ ] **Step 3: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts
git commit -m "$(cat <<'EOF'
feat(reports): two-row transmission grid shape, computed columns, unique ord (mssql)

Transliterated from the live-verified postgres pattern (Tasks 1-2). Unverified beyond that --
no SQL Server available here -- same HONEST NON-PROOF status the file's existing mssql
variants already carry.
EOF
)"
```

---

### Task 4: MySQL, both queries, and the 1267 disclosure

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:2692-2764` (`q-transmission-hvleid.sql.mysql`)
- Modify: `packages/reporting/src/seed/report-seeds.ts:3221-3293` (`q-transmission-other.sql.mysql`)

**Operator decision, not reopened here: port anyway.** The file already discloses (`:2550-2552`
and `:2629-2648`) that both mysql variants cannot run through the connector pool today. `max()`
over the date row's `concat` raises error 1267, illegal mix of collations. This task ports the
same three-change shape to mysql regardless, so all six variants stay in step.

**Does this slice make the 1267 path worse, better, or unchanged? Unchanged.** Reasoning, not a
measurement. No MySQL server is available here either:

- The failure is **branch-local**. Each `union all` branch computes its own `max(case ...)`
  aggregates over its own `group by lab`, independently, before any branch result is combined by
  the union. The existing disclosure places the fault specifically in the date row's own
  `max(concat(...))` (`:2629-2632`). That branch fails on its own, during its own execution, before
  the union step is ever reached.
- The new week-token branch this task adds does **not** reproduce that pattern: it aggregates
  `max(case when n = N then date_format(cal_day, '%v') else '' end)`, a single `date_format` call
  with no `concat` and no `char(... using utf8mb4)` mixed-collation literal. Nothing about that
  expression should itself trigger 1267.
- But the **existing** date-row branch is untouched by this task, and it still fails on its own,
  first. Since a `UNION ALL` executes every branch, one failing branch fails the whole statement
  regardless of what the other branches do. The query could not run before this task and cannot
  run after it, for the same reason it always could not: the date row's own aggregate.

State this plainly in the SQL comment rather than asserting more confidence than a hand run can
give. This is inference from the existing disclosure's wording, not a fresh measurement.

- [ ] **Step 1: `q-transmission-hvleid`, replace `grid` through the end of the query**

`month_start`, `panel_list`, `all_days`, `days`, `arrivals` (`:2560-2691`) are untouched. Replace
`:2692-2764`:

```sql
grid as (
  select l.lab, dy.n,
         case when a.lab is null then '' else '1' end as mark
  from labs l
  cross join days dy
  left join arrivals a on a.lab = l.lab and a.cal_day = dy.cal_day
),
lab_stats as (
  -- Same LEFT JOIN reasoning as the postgres variant: a laboratory whose only submission this
  -- month landed on a weekend has zero rows in 'days' (Mon-Fri only), and an inner join here would
  -- drop it from the grid entirely instead of showing it silent all month.
  select l.lab,
         count(dy.n) as days,
         (select max(n) from days) - coalesce(max(dy.n), 0) as silent
  from labs l
  left join arrivals a on a.lab = l.lab
  left join days dy on dy.cal_day = a.cal_day
  group by l.lab
),
lab_ord as (
  -- Unique per-laboratory ord, alphabetical from 2 -- see the postgres variant for why 'order by
  -- ord' alone is now a full tiebreaker (AGENTS.md section 7). MySQL 8 supports window functions.
  select lab, row_number() over (order by lab) + 1 as ord
  from labs
)
-- ⛔ READ FIRST, still true after this task: this query CANNOT RUN on a MySQL warehouse today.
-- max() over the date row's concat still raises error 1267 through the connector pool -- see
-- 'arrivals' above for the measured path. This task adds a SECOND synthetic row (the week-token
-- row directly below) but that row's own max() does not concatenate a mixed-collation literal, so
-- it does not itself trip 1267. The overall cannot-run status is UNCHANGED: the union's date-row
-- branch fails on its own aggregate, independently of what any other branch does, before the union
-- ever combines them. HONEST NON-PROOF beyond that reasoning -- no MySQL server is available here
-- to confirm which branch actually raises first once the query is three branches instead of two.
select 0 as ord, '(dates)' as lab,
  max(case when n = 1 then concat(date_format(cal_day, '%e'), char(10 using utf8mb4), date_format(cal_day, '%b')) else '' end) as d01,
  max(case when n = 2 then concat(date_format(cal_day, '%e'), char(10 using utf8mb4), date_format(cal_day, '%b')) else '' end) as d02,
  -- d03..d22 UNCHANGED from the current file --------------------------------------------------
  max(case when n = 23 then concat(date_format(cal_day, '%e'), char(10 using utf8mb4), date_format(cal_day, '%b')) else '' end) as d23,
  '' as days, '' as silent
from days
union all
select 1 as ord, '(week)' as lab,
  -- ISO week number, never drawn. '%v' alone (Monday-first ISO week, 01..53) is sufficient: MySQL's
  -- own docs recommend pairing it with '%x' only for GLOBAL uniqueness across year boundaries,
  -- which this token does not need -- one calendar month never touches more than 5-6 weeks, and the
  -- renderer only cares that the token CHANGES, never what it says (spec section 4). No concat, no
  -- explicit collation literal -- this branch's own max() does not reproduce the 1267 pattern.
  max(case when n = 1 then date_format(cal_day, '%v') else '' end) as d01,
  max(case when n = 2 then date_format(cal_day, '%v') else '' end) as d02,
  max(case when n = 3 then date_format(cal_day, '%v') else '' end) as d03,
  max(case when n = 4 then date_format(cal_day, '%v') else '' end) as d04,
  max(case when n = 5 then date_format(cal_day, '%v') else '' end) as d05,
  max(case when n = 6 then date_format(cal_day, '%v') else '' end) as d06,
  max(case when n = 7 then date_format(cal_day, '%v') else '' end) as d07,
  max(case when n = 8 then date_format(cal_day, '%v') else '' end) as d08,
  max(case when n = 9 then date_format(cal_day, '%v') else '' end) as d09,
  max(case when n = 10 then date_format(cal_day, '%v') else '' end) as d10,
  max(case when n = 11 then date_format(cal_day, '%v') else '' end) as d11,
  max(case when n = 12 then date_format(cal_day, '%v') else '' end) as d12,
  max(case when n = 13 then date_format(cal_day, '%v') else '' end) as d13,
  max(case when n = 14 then date_format(cal_day, '%v') else '' end) as d14,
  max(case when n = 15 then date_format(cal_day, '%v') else '' end) as d15,
  max(case when n = 16 then date_format(cal_day, '%v') else '' end) as d16,
  max(case when n = 17 then date_format(cal_day, '%v') else '' end) as d17,
  max(case when n = 18 then date_format(cal_day, '%v') else '' end) as d18,
  max(case when n = 19 then date_format(cal_day, '%v') else '' end) as d19,
  max(case when n = 20 then date_format(cal_day, '%v') else '' end) as d20,
  max(case when n = 21 then date_format(cal_day, '%v') else '' end) as d21,
  max(case when n = 22 then date_format(cal_day, '%v') else '' end) as d22,
  max(case when n = 23 then date_format(cal_day, '%v') else '' end) as d23,
  '' as days, '' as silent
from days
union all
select max(lo.ord) as ord, g.lab,
  max(case when g.n = 1 then g.mark else '' end) as d01,
  max(case when g.n = 2 then g.mark else '' end) as d02,
  max(case when g.n = 3 then g.mark else '' end) as d03,
  max(case when g.n = 4 then g.mark else '' end) as d04,
  max(case when g.n = 5 then g.mark else '' end) as d05,
  max(case when g.n = 6 then g.mark else '' end) as d06,
  max(case when g.n = 7 then g.mark else '' end) as d07,
  max(case when g.n = 8 then g.mark else '' end) as d08,
  max(case when g.n = 9 then g.mark else '' end) as d09,
  max(case when g.n = 10 then g.mark else '' end) as d10,
  max(case when g.n = 11 then g.mark else '' end) as d11,
  max(case when g.n = 12 then g.mark else '' end) as d12,
  max(case when g.n = 13 then g.mark else '' end) as d13,
  max(case when g.n = 14 then g.mark else '' end) as d14,
  max(case when g.n = 15 then g.mark else '' end) as d15,
  max(case when g.n = 16 then g.mark else '' end) as d16,
  max(case when g.n = 17 then g.mark else '' end) as d17,
  max(case when g.n = 18 then g.mark else '' end) as d18,
  max(case when g.n = 19 then g.mark else '' end) as d19,
  max(case when g.n = 20 then g.mark else '' end) as d20,
  max(case when g.n = 21 then g.mark else '' end) as d21,
  max(case when g.n = 22 then g.mark else '' end) as d22,
  max(case when g.n = 23 then g.mark else '' end) as d23,
  max(cast(ls.days as char(3))) as days, max(cast(ls.silent as char(3))) as silent
from grid g
join lab_ord lo on lo.lab = g.lab
join lab_stats ls on ls.lab = g.lab
group by g.lab
order by ord
```

- [ ] **Step 2: `q-transmission-other`, apply the same replacement at `:3221-3293`**

Identical block, `not in` in `arrivals` (`:3216`, untouched) makes this the complement query.
Same READ FIRST disclosure comment at the top of the `select`.

- [ ] **Step 3: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts
git commit -m "$(cat <<'EOF'
feat(reports): two-row transmission grid shape, computed columns, unique ord (mysql)

Ported for parity, not because it runs -- the mysql variant still cannot reach the connector pool
(error 1267, unchanged by this change, disclosed inline). Unverified beyond the reasoning in the
comment -- no MySQL server available here.
EOF
)"
```

---

### Task 5: `report-seeds.test.ts`, shape tests for the new query shape

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.test.ts:1632-1837`, the `SEED_QUERIES`
  transmission-grid `describe` block

By this point all six SQL variants carry three branches (`0 as ord`, `1 as ord`, and
`max(lo.ord) as ord`), so the file-wide `as ord` count goes from 2 to 3 per dialect. This task
updates that existing assertion and adds four new ones.

- [ ] **Step 1: Fix the existing `as ord` count**

At `:1719-1723`, change the expected length:

```ts
  it('selects the ord discriminator sortBy depends on, in every dialect', () => {
    // Four occurrences of `as ord` per dialect per dialect string now: the dates row (`0 as ord`), the week-token
    // row (`1 as ord`), and the laboratory rows (`max(lo.ord) as ord`).
    const ORD = /\bas ord\b/g;
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql.match(ORD) ?? [], `${id}/${dialect} dropped 'as ord', so sortBy silently degrades to no sort`)
          .toHaveLength(3);
      }
    }
  });
```

- [ ] **Step 2: Run it to confirm it fails, then apply Tasks 1-4 if not already applied**

Run: `pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "selects the ord discriminator"`
Expected before Tasks 1-4: FAIL at the first dialect checked (`q-transmission-hvleid/postgres`;
`Object.entries` iterates in declared key order, postgres then mssql then mysql), `received length
2, expected 3`. After Tasks 1-4 land: PASS.

- [ ] **Step 3: Add four new tests, after the existing `describe` block's last test (`:1836`)**

```ts
  // ⛔ cellgrid's palette does Number(cellValue) and treats anything that is not a finite
  // positive number as empty (packages/report-designer/src/render/cellgrid.ts, stepFor). 'Y' is
  // NaN. Left as 'Y', every cell in the grid would paint empty on every run, silently.
  it('marks a submission with a numeric string cellgrid can parse, not the letter Y, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} still marks with the letter Y`)
          .toMatch(/case when a\.lab is null then '' else '1' end as mark/);
      }
    }
  });

  it('carries a second synthetic row of week tokens at ord = 1, in every dialect', () => {
    const WEEK_ROW = /union all\s*\nselect 1 as ord, '\(week\)' as lab,/;
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} lost the week-token row`).toMatch(WEEK_ROW);
      }
    }
  });

  it('gives each laboratory a unique ord from 2, alphabetically, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} lost the per-laboratory ord`)
          .toMatch(/row_number\(\) over \(order by lab\)\s*\+\s*1 as ord/);
      }
    }
  });

  // ⛔ LEFT, never INNER: a laboratory whose only submission this month landed on a weekend has
  // zero rows in 'days' (Mon-Fri only). An inner join here silently drops that laboratory from the
  // grid instead of showing it silent all month -- no error, just a shorter grid. Measured on the
  // live warehouse (see the plan this test came from): 'Mbagala Kizuiani' and 'Mwananyamala',
  // 2017-08.
  it('computes days and silent per laboratory, outer-joined to the working-day calendar, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} lost lab_stats`).toMatch(/lab_stats as \(/);
        expect(sql, `${id}/${dialect} no longer selects days`).toMatch(/\bas days\b/);
        expect(sql, `${id}/${dialect} no longer selects silent`).toMatch(/\bas silent\b/);
        expect(sql, `${id}/${dialect} inner-joins days inside lab_stats and can drop a weekend-only lab`)
          .toMatch(/left join days dy on dy\.cal_day = a\.cal_day/);
      }
    }
  });
```

- [ ] **Step 4: Run the whole describe block**

Run: `pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "SEED_QUERIES — the transmission grids"`

⚠ That em dash is not a rule 13 violation. It is quoting the name of a `describe` block that
already exists at `report-seeds.test.ts:1632` and predates the rule. Changing it here would just
make the filter match nothing. Do not "fix" it, and do not copy it into anything new you write.
Expected: PASS, all tests including the ones untouched by this slice (the ladder, batch
attribution, no-arrival-bucketing, panel-list-per-element tests). None of these read `ord`, the
mark, or the day-count, so none of them should have moved.

- [ ] **Step 5: Confirm each new test can actually fail**

Temporarily revert the `'1'` mark to `'Y'` in one dialect and rerun. The first new test must go
red. Repeat for `lab_ord`/`lab_stats` (delete one CTE, rerun) and for the week-token row (delete
the `union all` block, rerun). Revert the temporary breaks before continuing. This step is a
check, not a change to land.

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.test.ts
git commit -m "$(cat <<'EOF'
test(reports): pin the two-row transmission grid shape across all six variants

Fixes the pre-existing 'as ord' count (2 -> 3) and adds shape tests for the numeric mark, the
week-token row, the unique per-laboratory ord, and days/silent -- each verified capable of
failing by breaking the code under test and rerunning.
EOF
)"
```

---

### Task 6: `transmission-grid-live.test.ts`, fixture proof and the known regression

**Files:**
- Modify: `packages/reporting/src/seed/transmission-grid-live.test.ts`

This file provisions its own throwaway Postgres database via the real migrations (`beforeAll`,
`:156-216`). It is not the shared warehouse Tasks 1-2 queried, and it runs only when
`TARGET_DATABASE_URL` is set (`describe.skipIf(!url)`, `:54`).

- [ ] **Step 1: Fix the four `'Y'` literals**

At `:152-153` (the `marksExactlyOneDay` helper) and `:299`, `:320`:

```ts
  const marksExactlyOneDay = (row: Record<string, string>, day: string): void => {
    expect(row[day], `expected the mark on ${day}`).toBe('1');
    expect(dayCells(row).filter((c) => c === '1'), `${row.lab} marked more than one day`).toEqual(['1']);
  };
```

Rename the test at `:293` and fix its two assertions:

```ts
  it("writes exactly '1' in an arrival cell and leaves a silent day empty", async () => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const lab = rows.find((r) => r.lab === 'Registration Only Lab')!;
    expect(lab.d02).toBe('1');
    expect(lab.d01).toBe('');
  });
```

At `:320` (the `'(unknown)'` fallback test):

```ts
    expect(unknown!.d02).toBe('1');
```

Every other `.toBe('')` in this file (blank-cell assertions) stays unchanged. The blank branch
is not touched by this slice; only the filled branch changes from `'Y'` to `'1'`.

- [ ] **Step 2: Run to confirm the whole file still passes**

Run: `TARGET_DATABASE_URL=$(grep '^TARGET_DATABASE_URL=' .env | cut -d= -f2-) pnpm --filter @openldr/reporting test -- transmission-grid-live.test.ts`
Expected: PASS. This exercises the real migrations and the real `arrivals`/`grid`/`lab_stats`
CTEs end to end, on fixture data this file controls: the deterministic complement to Tasks 1-2's
real-warehouse spot check.

- [ ] **Step 3: Add fixture tests for the new columns**

After the existing `"renders 23 day columns and no more, on every row"` test (`:303-312`):

```ts
  it('gives each laboratory a unique ord from 2, alphabetically', async () => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const labRows = rows.filter((r) => r.lab !== '(dates)' && r.lab !== '(week)');
    const ords = labRows.map((r) => Number(r.ord)).sort((a, b) => a - b);
    expect(new Set(ords).size, 'ord repeats across laboratories').toBe(ords.length);
    expect(Math.min(...ords)).toBe(2);
    const byName = [...labRows].sort((a, b) => a.lab.localeCompare(b.lab));
    expect(labRows.map((r) => r.lab)).toEqual(byName.map((r) => r.lab));
  });

  it('carries a week-token row at ord = 1, whose value changes across a week boundary', async () => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const week = rows.find((r) => r.lab === '(week)');
    expect(week, 'the week-token row is missing').toBeDefined();
    // 2 March 2026 (d01) is a Monday and 6 March (d05) is a Friday, same week; 9 March (d06) is
    // the following Monday. The token must change there and only there among d01..d06.
    expect(week!.d01).toBe(week!.d05);
    expect(week!.d06).not.toBe(week!.d01);
  });

  it('computes days as the count of marked working days, and silent against the last one', async () => {
    // Registration Only Lab (fixture, beforeAll) marks exactly d02 in March 2026 and nothing else.
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const lab = rows.find((r) => r.lab === 'Registration Only Lab')!;
    expect(lab.days).toBe('1');
    // March 2026 has 22 working days (starts on a Sunday, see the file header comment). Silent
    // since d02 (n=2) as at the month's last working day (n=22) is 22 - 2 = 20.
    expect(lab.silent).toBe('20');
  });
```

- [ ] **Step 4: Add the characterization test for the known regression**

After the round-trip test (`:466-531`):

```ts
  // ⛔ KNOWN GAP, not fixed in this slice. 'rt-transmission-grid' is a `table` element with
  // `headerRow: true`. `bodyRowsFor` (report-designer/src/render/draw.ts:352-355) lifts EXACTLY
  // ONE row into the header band, `rowsFor(...).slice(1)`, never `.slice(2)`. This slice's query
  // now emits TWO synthetic rows. Only ord=0 (the dates) is lifted; ord=1 (the week tokens) prints
  // as an ordinary body row: a fake laboratory named '(week)' with week numbers where marks used
  // to be, above every real laboratory, on both grids. Fixing it means replacing this design with
  // a `cellgrid` one (out of scope, "no design change", see this task's plan). This test PINS the
  // current, real, interim behaviour so it is a documented fact rather than a silent regression.
  // Delete this test in the slice that replaces `rt-transmission-grid` with a `cellgrid` design.
  it('⛔ KNOWN GAP: the unmodified rt-transmission-grid table shows the week-token row as a body row', async () => {
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
    expect(drawn.map((r) => r.text), 'the week-token row no longer leaks into the body: check whether the design was fixed and this test should be deleted').toContain('(week)');
  });
```

- [ ] **Step 5: Run the whole file**

Run: `TARGET_DATABASE_URL=$(grep '^TARGET_DATABASE_URL=' .env | cut -d= -f2-) pnpm --filter @openldr/reporting test -- transmission-grid-live.test.ts`
Expected: PASS, including the new characterization test. It asserts the CURRENT (undesired but
real) behaviour, so it passing is the point.

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/seed/transmission-grid-live.test.ts
git commit -m "$(cat <<'EOF'
test(reports): fixture proof for the two-row grid shape, and pin the rt-transmission-grid gap

Fixes the four 'Y' literals the mark-value change touches, adds fixture tests for the unique ord,
the week-token row and days/silent, and adds a characterization test documenting that the
unmodified rt-transmission-grid table now shows the week-token row as a body row -- a real,
citable interim regression this slice does not fix (see the plan's "Known gaps" section).
EOF
)"
```

---

### Task 7: Full gate

- [ ] **Step 1: Run the package suite**

Run: `pnpm --filter @openldr/reporting test`
Expected: PASS.

- [ ] **Step 2: Run the full gate**

Run: `pnpm turbo run test`

Do not pipe this through `tail`. It truncates the failure list and hides which package failed
(CLAUDE.md). A failure here is usually a timeout, not a regression: grep the output for `Test
timed out` and rerun that package alone before concluding this slice broke something.

- [ ] **Step 3: Confirm no migration was added**

```bash
git status packages/db/src/migrations/
```

Expected: no output. This slice adds no column, no table, no parameter (Background already
establishes why). This step is the mechanical check that nothing slipped in.

---

## Done when

- `pnpm --filter @openldr/reporting test` passes, including `transmission-grid-live.test.ts` when
  `TARGET_DATABASE_URL` is set.
- `pnpm turbo run test` passes.
- All six SQL variants (`q-transmission-hvleid` × 3 dialects, `q-transmission-other` × 3 dialects)
  emit: two synthetic leading rows (`ord = 0` dates, `ord = 1` week tokens), a numeric-parseable
  mark (`'1'`/`''`), computed `days`/`silent` per laboratory, and a unique `ord` per laboratory
  from 2 upward, alphabetical.
- Postgres verified read-only against the live warehouse (Tasks 1-2), with captured, rerunnable
  output.
- MSSQL and MySQL carry an explicit `HONEST NON-PROOF` marker, consistent with the file's existing
  disclosure style for these two dialects.
- The `rt-transmission-grid` regression is documented and pinned by a passing characterization
  test (Task 6, Step 4), not left as an unverified claim.

## Explicitly not in this slice

The region/facility filter predicates and the `region`/`facility`/`blocks` parameters (spec §4,
§3). These need new parameters, which this slice's brief excludes. Any schema, design, CLI, docs
or studio change. Replacing `rt-transmission-grid` with a `cellgrid`-based design. The
`transmissionGridColumns()` retirement the spec mentions (spec §4.1): that only applies once a
`cellgrid` design exists to replace the current one.

## Known gaps this slice does not close

**The currently published `r-transmission-grid` report will render a garbled extra row once this
slice reaches a running install.** The boot seed refreshes `SEED_QUERIES` content from
`report-seeds.ts` automatically: `seedDataDrivenReports` compares each seeded query's stored SQL
against the shipped `q.sql[dialect]` and calls `customQueries.update(...)` whenever they differ
(`packages/reporting/src/seed/report-seeds.ts:4006-4011`, the `queriesUpdated` branch). This is
not a hypothetical, it is what already happens on every boot when the shipped SQL text differs
from what is stored. `rt-transmission-grid` still binds these two queries
as a `table` element with `headerRow: true`, which lifts exactly one synthetic row
(`draw.ts:352-355`). The second synthetic row this slice adds, the week-token row at `ord = 1`,
will print as an ordinary body row: a laboratory named `'(week)'` with week numbers instead of
marks, above every real laboratory, on both grids, on the next boot after this slice merges. Task
6 Step 4 pins this with a passing test rather than leaving it undiscovered. **Before merging this
slice to a branch that reaches a running install, the operator should decide whether to accept
this interim state or hold the merge until the `cellgrid`-based design replacing
`rt-transmission-grid` is ready to land in the same release.** This plan does not make that call.

**MSSQL and MySQL are unverified beyond careful transliteration and reasoning.** No SQL Server or
MySQL instance is available in this environment. What would prove them: a CI harness that runs all
three dialects against real servers on every change, the same gap the file already discloses for
the existing mssql/mysql variants (`:2436-2446`, `:2643-2648`), now extended to the lines this
slice adds.

**The MySQL cannot-run status is reasoned about, not re-measured.** Task 4's "unchanged" verdict
follows from reading the existing disclosure's own account of where the fault sits (the date row's
own aggregate, evaluated before any union combination). No MySQL server was available to run the
new three-branch query and confirm which error surfaces first.
