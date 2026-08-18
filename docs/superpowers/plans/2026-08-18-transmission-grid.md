# Monthly LIS Transmission Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monthly report showing, per testing laboratory per working day, whether any data arrived — split into HVL/EID and Other.

**Architecture:** Two seeded custom queries read `ingest_events` (built in slice 1) for `ServiceRequest` arrivals only, join to `lab_requests` for the panel and batch, then to `diagnostic_reports` on `batch_id` for the performing laboratory. Days are bucketed in a new `lab.timezone` setting. The result is one row per laboratory with 23 fixed day columns, preceded by a synthetic row carrying the real dates. One seeded design draws both tables on one page.

**Tech Stack:** TypeScript, Kysely, Postgres/MSSQL/MySQL SQL strings, Vitest, React + shadcn, pdfkit via the report designer.

**Spec:** `docs/superpowers/specs/2026-08-18-transmission-grid-design.md`

## Global Constraints

- **Never add a `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailer** to any commit. The operator is the sole contributor.
- **Stage named paths only. Never `git add -A`** — the repo directory is shared and `.superpowers/` holds scratch files.
- **Gate command:** `pnpm turbo run typecheck test --force --continue --concurrency=4`. **Never pipe turbo through `tail`.** ⛔ **Use `--concurrency=4`** — this machine crashes ~56 of 69 tasks at default concurrency with a Windows memory-exhaustion exit. Measured, not incidental.
- A gate failure is usually a **timeout, not a regression.** Grep for `Test timed out` and re-run that package alone.
- **Never hardcode clinical vocabulary** (`AGENTS.md` §8). The HVL/EID panel list is a **run-time report parameter** — config supplied at run time, which complies. No panel code may appear in SQL or source.
- **Every SQL change exists in all three dialects** — `postgres`, `mssql`, `mysql`. MSSQL has no ordinal `GROUP BY`. Concatenation differs: Postgres `||`, MSSQL `+`, **MySQL `concat()`** — `||` in MySQL is logical OR unless `PIPES_AS_CONCAT`, so it silently yields 0/1.
- **Value sets are keyed by `value_set_url`, never `value_set_id`** — the id is `vs-${randomUUID()}` and matches nothing.
- `{{param.x}}` may appear more than once; `substituteParams` (`packages/dashboards/src/custom-query-run.ts:37`) inlines an **escaped quoted string literal** via a global regex and does not bind a placeholder. Mirror that in tests.
- pg-mem is not Postgres (`AGENTS.md` §7) — no correlated-subquery support, stable scan order. Only live tests prove query behaviour, and a hermetic run **skips** them: a skipped run is not a pass.
- `TARGET_DATABASE_URL` = `postgres://openldr:openldr@127.0.0.1:5433/openldr_target`, `INTERNAL_DATABASE_URL` = `postgres://openldr:openldr@127.0.0.1:5433/openldr`. Use `127.0.0.1`, never `localhost`.
- **Actions live in a `⋯` dropdown; shadcn only** (`AGENTS.md` §5). Every `<Table>` gets `TablePagination`.
- Working directory for every command: the repository root.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/config/src/lab-identity.ts` (+ `.test.ts`) | Modify — add the `lab.timezone` field and its validation | 1 |
| `apps/studio/src/pages/settings/Laboratory.tsx` | Modify — the control renders from the shared field list | 1 |
| `packages/cli/src/settings.ts` (+ `.test.ts`) | Modify — `--timezone` on `settings lab set` | 1 |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | Modify — the field's label and help | 1 |
| `packages/reporting/src/seed/report-seeds.ts` | Modify — two grid queries, 3 dialects each | 2 |
| `packages/reporting/src/seed/report-seeds.test.ts` | Modify — SQL shape pins | 2 |
| `packages/reporting/src/seed/transmission-grid-live.test.ts` | Create — live behaviour | 2 |
| `packages/reporting/src/seed/report-seeds.ts` | Modify — the design and the two report records | 3 |
| `apps/studio/src/docs/0.1.0/en/reports.md` | Modify — document the report | 4 |
| `apps/web/src/landing/changelog.json` | Regenerate after merge | 4 |

---

## Task 1: The `lab.timezone` setting

**Files:**
- Modify: `packages/config/src/lab-identity.ts`
- Modify: `packages/config/src/lab-identity.test.ts`
- Modify: `apps/studio/src/pages/settings/Laboratory.tsx` (only if it does not already render from the shared list — check first)
- Modify: `packages/cli/src/settings.ts`, `packages/cli/src/settings.test.ts`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `'lab.timezone'` in `LAB_IDENTITY_KEYS` and `LAB_IDENTITY_FIELDS`; readable via `ctx.labIdentity.all()` as `all()['lab.timezone']`.

**Why this rides existing machinery rather than being a new feature.** `LAB_IDENTITY_KEYS` is currently `['lab.name', 'lab.address', 'lab.contact', 'lab.logo', 'lab.facilitySystem']`. The test at `packages/config/src/lab-identity.test.ts:12-16` records the precedent in its own words: `lab.facilitySystem` "joined the four letterhead keys: it is the same kind of fact — something stated once about this installation rather than re-entered per record." A timezone is exactly that. The Settings ▸ Laboratory page, the `settings lab show/set` CLI and the docs already exist; this extends them.

- [ ] **Step 1: Write the failing tests**

In `packages/config/src/lab-identity.test.ts`, extend the key-list assertion and add validation cases:

```ts
    expect(LAB_IDENTITY_KEYS).toEqual([
      'lab.name', 'lab.address', 'lab.contact', 'lab.logo', 'lab.facilitySystem', 'lab.timezone',
    ]);
```

```ts
describe('lab.timezone validation', () => {
  it('accepts an IANA zone', () => {
    expect(validateLabIdentityValue('lab.timezone', 'Africa/Dar_es_Salaam')).toBeNull();
  });

  it('accepts empty, which means the setting is unset', () => {
    expect(validateLabIdentityValue('lab.timezone', '')).toBeNull();
  });

  it('⛔ rejects a value the database cannot resolve, rather than storing it and silently bucketing wrong', () => {
    // A bad zone does not error at query time — Postgres AT TIME ZONE raises, but a typo like
    // "Africa/Dar-es-Salaam" would only surface when someone runs the report a month later and
    // reads a whole day on the wrong side of midnight. Reject at WRITE time, like lab.logo does.
    expect(validateLabIdentityValue('lab.timezone', 'Africa/Dar-es-Salaam')).not.toBeNull();
    expect(validateLabIdentityValue('lab.timezone', '+03:00')).not.toBeNull();
    expect(validateLabIdentityValue('lab.timezone', 'Not A Zone')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/config test
```

Expected: FAIL — the key-list assertion mismatches and the validation cases return `null`.

- [ ] **Step 3: Add the field and its validation**

In `packages/config/src/lab-identity.ts`, append to `LAB_IDENTITY_FIELDS`:

```ts
  {
    id: 'lab.timezone',
    // ⛔ The civil timezone this installation's days are bucketed in. NOT decoration: the
    // transmission grid asks "did data arrive on this day", and an arrival at 21:00Z is 00:00 the
    // NEXT day at +03. Bucketing in UTC moves a whole evening's arrivals to the previous day —
    // an off-by-one-day on every cell, with nothing on the page to show it happened.
    label: 'Time zone',
    placeholder: 'Africa/Dar_es_Salaam',
  },
```

Validate with the runtime's own zone database rather than a hand-written list, so it stays correct as zones change:

```ts
function isValidIanaZone(value: string): boolean {
  try {
    // Throws RangeError on an unknown zone. Rejects fixed offsets like "+03:00" too, which is
    // deliberate: an offset cannot express daylight saving, so a report spanning a DST boundary
    // would bucket half its days an hour out.
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
```

Wire it into `validateLabIdentityValue` beside the existing `lab.logo` and `lab.facilitySystem` cases, returning the same `LabIdentityValidationError` shape those use — read them and match it exactly rather than inventing a second shape.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/config test
```

Expected: PASS.

- [ ] **Step 5: Check whether the studio page and CLI need any change at all**

```bash
grep -n "LAB_IDENTITY_FIELDS" apps/studio/src/pages/settings/Laboratory.tsx packages/cli/src/settings.ts
```

If `Laboratory.tsx` maps over `LAB_IDENTITY_FIELDS`, the control appears with no edit — verify by rendering, do not assume. The CLI's `LabSetOpts` (`packages/cli/src/settings.ts:237-243`) names its options explicitly (`name`, `address`, `contact`, `logoFile`), so it **does** need `timezone` added there and registered in `packages/cli/src/program.ts`'s `settings lab set`. Follow the shape of the existing `--name` option exactly.

- [ ] **Step 6: Add the i18n strings to all three languages**

`parity.test.ts` compares key sets across en/fr/pt and a missing key renders as literal braces. Add the label and help text for the timezone field to `apps/studio/src/i18n/en.ts`, `fr.ts` and `pt.ts`, following the neighbouring lab-identity keys' naming.

- [ ] **Step 7: Run the studio and CLI suites**

```bash
pnpm --filter @openldr/studio test -- parity.test.ts Laboratory
```

```bash
pnpm --filter @openldr/cli test
```

Expected: PASS. A `parity.test.ts` failure naming the new key means one of fr/pt was missed.

- [ ] **Step 8: Commit**

```bash
git add packages/config/src/lab-identity.ts packages/config/src/lab-identity.test.ts packages/cli/src/settings.ts packages/cli/src/settings.test.ts packages/cli/src/program.ts apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts apps/studio/src/pages/settings/Laboratory.tsx
git commit -m "feat(settings): add the lab.timezone identity field"
```

---

## Task 2: The two grid queries

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` — add `q-transmission-hvleid` and `q-transmission-other` to `SEED_QUERIES`
- Modify: `packages/reporting/src/seed/report-seeds.test.ts`
- Create: `packages/reporting/src/seed/transmission-grid-live.test.ts`

**Interfaces:**
- Consumes: `lab.timezone` from Task 1, read by the caller and passed in as a parameter.
- Produces: two queries, each returning columns `lab`, `d01`..`d23` — 24 columns exactly. Row 0 is the date row. Task 3 binds these.

**Parameters** on both queries:
- `month` — `text`, `YYYY-MM`. Not a `daterange`: the grid has exactly 23 day columns, and a range spanning two months would silently drop days off the end.
- `panels` — `text`, a comma-separated panel-code list. The HVL/EID query keeps rows whose panel is in it; the Other query keeps rows whose panel is not.
- `tz` — `text`, the IANA zone. Supplied from `lab.timezone`.

**The join path, and why it is this one.** Measured 2026-08-18: the 3,713 batches carrying a laboratory and the 3,713 carrying a request are the same 3,713, and 0 requests sit in a batch with no laboratory.

```
ingest_events e   (e.resource_type = 'ServiceRequest')
  join lab_requests q        on q.id = e.resource_id          -- panel_code AND batch_id
  join diagnostic_reports d  on d.batch_id = q.batch_id       -- performer, one per batch
  left join facility_map fm  -- the laboratory's display name
```

⛔ **Do not attribute through `lab_results.specimen_id` → `diagnostic_reports`.** That route reaches 6,652 of 7,520 requests. The 868 it drops have no `lab_results` at all, and **548 of them are EID** — 99.6% of every EID request in the warehouse. The EID grid would print almost empty while those laboratories were transmitting. This is the whole reason the slice exists.

- [ ] **Step 1: Write the failing shape tests**

Add to `packages/reporting/src/seed/report-seeds.test.ts`:

```ts
describe('SEED_QUERIES — the transmission grids', () => {
  const q = (id: string) => SEED_QUERIES.find((x) => x.id === id)!;

  it('reads ServiceRequest arrivals, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect}`).toMatch(/resource_type\s*=\s*'ServiceRequest'/);
      }
    }
  });

  it('⛔ attributes through batch_id, never through the specimen', () => {
    // The specimen route drops 868 requests, 548 of them EID — 99.6% of all EID here.
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} lost the batch join`)
          .toMatch(/d\.batch_id\s*=\s*q\.batch_id/);
        expect(sql, `${id}/${dialect} attributes through the specimen`)
          .not.toMatch(/specimen_id\s*=\s*.*diagnostic_reports/);
      }
    }
  });

  it('buckets days in the supplied timezone, not UTC', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} ignores the tz parameter`).toContain('{{param.tz}}');
      }
    }
  });

  it('returns exactly the lab column and 23 day columns', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      const sql = q(id).sql.postgres;
      expect(sql).toMatch(/as lab\b/);
      for (let i = 1; i <= 23; i++) {
        const col = `d${String(i).padStart(2, '0')}`;
        expect(sql, `${id} is missing ${col}`).toMatch(new RegExp(`as ${col}\\b`));
      }
      expect(sql, `${id} has a d24`).not.toMatch(/as d24\b/);
    }
  });

  it('carries no panel code in SQL — the list is a run-time parameter', () => {
    // AGENTS.md §8. HIVVL/HIVPC are Tanzania's codes; another country's differ.
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect}`).not.toMatch(/HIVVL|HIVPC|HIVEL|HIVDR/);
        expect(sql, `${id}/${dialect} ignores the panel parameter`).toContain('{{param.panels}}');
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts
```

Expected: FAIL — `q-transmission-hvleid` is not in `SEED_QUERIES`, so `q(id)` throws on `undefined`.

- [ ] **Step 3: Write the Postgres SQL for `q-transmission-hvleid`**

The shape, with the pieces that matter called out. Build the 23 columns and the working-day series in a CTE so the two queries differ only in one predicate.

```sql
with tz as (select {{param.tz}} as zone),
month_start as (
  select cast({{param.month}} || '-01' as date) as d
),
days as (
  -- Working days only, Mon-Fri. NO holiday calendar: the reference shows 1 January 2021, a public
  -- holiday, so it applies none either.
  select d::date as day, row_number() over (order by d) as n
  from month_start m,
       generate_series(m.d, (m.d + interval '1 month' - interval '1 day')::date, interval '1 day') d
  where extract(isodow from d) between 1 and 5
),
arrivals as (
  select distinct
    coalesce(fm.name, d.performer_display, d.performer) as lab,
    -- ⛔ Bucket in the CIVIL timezone. recorded_at is an instant; 21:00Z is the NEXT day at +03.
    -- Bucketing in UTC moves a whole evening's arrivals to the previous day, on every cell.
    (e.recorded_at at time zone (select zone from tz))::date as day
  from ingest_events e
  join lab_requests q on q.id = e.resource_id
  join diagnostic_reports d on d.batch_id = q.batch_id
  left join facility_map fm
    on fm.source_system = coalesce(d.source_system, '')
   and fm.performer_system = coalesce(d.performer_system, '')
   and fm.source_code = d.performer
  where e.resource_type = 'ServiceRequest'
    and q.panel_code in (select trim(value) from unnest(string_to_array({{param.panels}}, ',')) as value)
),
labs as (select distinct lab from arrivals),
-- Every laboratory crossed with every working day, then left-joined to what actually arrived. The
-- CROSS JOIN is what makes a silent day render blank IN PLACE rather than shifting later days left.
grid as (
  select l.lab, dy.n,
         case when a.lab is null then '' else 'Y' end as mark
  from labs l
  cross join days dy
  left join arrivals a on a.lab = l.lab and a.day = dy.day
)
select 0 as ord, '(dates)' as lab,
  max(case when n = 1 then to_char(day, 'FMDD Mon') else '' end) as d01,
  -- ... expand for n = 2..22, identical but for the two numbers ...
  max(case when n = 23 then to_char(day, 'FMDD Mon') else '' end) as d23
from days
union all
select 1 as ord, lab,
  max(case when n = 1 then mark else '' end) as d01,
  -- ... expand for n = 2..22, identical but for the two numbers ...
  max(case when n = 23 then mark else '' end) as d23
from grid
group by lab
order by ord, lab
```

The `-- ... expand ...` lines are mechanical repetition of the line above them, not a decision left
open: write all 23, changing only the two numbers. The `ord` column exists solely to sort the date
row first; the design binds `lab` and `d01`..`d23` and never reads it.

Two shapes to get right:

**The date row must sort first.** `UNION ALL` a synthetic row and order by a discriminator, not by `lab` — otherwise a laboratory named "(dates)" would be the only thing keeping it at the top:

```sql
select 0 as ord, '(dates)' as lab,
  max(case when n = 1 then to_char(day, 'D Mon') else '' end) as d01, ...
from days
union all
select 1 as ord, lab, ... from grid group by lab
order by ord, lab
```

Strip `ord` from the projection the design binds, or bind only `lab` and `d01..d23`.

**A missing day must render blank, not shift.** Left-join the per-lab arrivals onto `days`, so a 20-weekday month leaves `d21..d23` empty rather than moving `d01` left.

- [ ] **Step 4: Write the MSSQL and MySQL SQL**

Same shape, three dialect differences that are silent when wrong:

- **Timezone.** Postgres `at time zone`. MSSQL: `recorded_at AT TIME ZONE 'UTC' AT TIME ZONE <zone>` — and MSSQL takes **Windows** zone names, not IANA. MySQL: `convert_tz(recorded_at, '+00:00', <zone>)`, which needs the zone tables loaded. **Record both as HONEST NON-PROOF** — neither engine is executed here, and the zone-name mismatch is a real portability defect, not a theoretical one.
- **Concatenation.** Postgres `||`, MSSQL `+`, **MySQL `concat()`**.
- **`GROUP BY`.** MSSQL has no ordinal form; repeat the expressions in full.
- **Day series.** `generate_series` is Postgres-only. MSSQL needs a recursive CTE or `master..spt_values`; MySQL 8 needs a recursive CTE. Write each properly rather than transliterating.

- [ ] **Step 5: Write `q-transmission-other`**

Identical, with one predicate inverted:

```sql
    and q.panel_code not in (select trim(value) from unnest(string_to_array({{param.panels}}, ',')) as value)
```

⚠ `not in` against a set containing NULL returns no rows in SQL. `string_to_array` on a non-empty parameter yields no NULLs, but an empty `panels` parameter yields `{''}` — which makes the HVL/EID grid empty and the Other grid everything. That is arguably correct, but it must be a deliberate decision, not an accident: state it in the query comment.

- [ ] **Step 6: Run the shape tests**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts
```

Expected: PASS, 5 new tests.

- [ ] **Step 7: Write the live test**

Create `packages/reporting/src/seed/transmission-grid-live.test.ts`, modelled on `packages/reporting/src/seed/clinical-micro-header-live.test.ts` — own throwaway database, `describe.skipIf(!url)`, dropped in `afterAll`, `substituteParams` mirrored exactly. Read that file first.

```ts
  it('⛔ fills a cell for a laboratory that submitted ONLY a registration — no results anywhere', async () => {
    // THE test for this slice. 548 of 550 EID requests in the real warehouse have no lab_results.
    // Attributing through the specimen would leave this cell empty and the EID grid nearly blank.
    // Fixture: a batch with a ServiceRequest and a DiagnosticReport, and NO lab_results at all.
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'Africa/Dar_es_Salaam' });
    const lab = rows.find((r) => r.lab === 'Registration Only Lab');
    expect(lab, 'a registration-only submission must still register').toBeDefined();
    expect(lab!.d02).not.toBe('');
  });

  it('buckets an arrival at 21:00Z into the NEXT day at +03', async () => {
    // The whole reason lab.timezone exists. Assert BOTH sides or this proves nothing.
    const east = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'Africa/Dar_es_Salaam' });
    const utc = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const e = east.find((r) => r.lab === 'Late Evening Lab')!;
    const u = utc.find((r) => r.lab === 'Late Evening Lab')!;
    expect(e.d03).not.toBe('');   // 2 March 21:00Z is 3 March 00:00 at +03
    expect(u.d02).not.toBe('');   // ...and 2 March in UTC
    expect(e.d02).toBe('');
  });

  it('leaves trailing columns blank in a short month rather than shifting cells left', async () => {
    // February 2026 has 20 working days. d21..d23 must be empty and d01 must still be the 2nd.
    const rows = await runFor({ month: '2026-02', panels: 'HIVPC', tz: 'UTC' });
    const dates = rows.find((r) => r.lab === '(dates)')!;
    expect(dates.d21).toBe('');
    expect(dates.d22).toBe('');
    expect(dates.d23).toBe('');
    expect(dates.d01).not.toBe('');
  });

  it('puts the date row first, whatever the laboratory names sort like', async () => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    expect(rows[0].lab).toBe('(dates)');
  });

  it('HVL/EID and Other partition the arrivals — none in both, none in neither', async () => {
    const hv = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const ot = await runForOther({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    // The registration-only lab submitted HIVPC only, so it appears in one grid and not the other.
    expect(hv.some((r) => r.lab === 'Registration Only Lab')).toBe(true);
    expect(ot.some((r) => r.lab === 'Registration Only Lab')).toBe(false);
  });
```

`runFor` and `runForOther` are two local helpers in the test file — one per query — each taking
`{ month, panels, tz }`, substituting them the way `substituteParams` does (a global regex inlining an
escaped quoted string literal, NOT a bound placeholder) and returning `res.rows`. Define them once at
the top beside the fixtures:

```ts
const runQuery = (queryId: string) => async (p: { month: string; panels: string; tz: string }) => {
  const raw = SEED_QUERIES.find((q) => q.id === queryId)!.sql.postgres;
  const text = raw
    .replace(/\{\{\s*param\.month\s*\}\}/g, `'${p.month.replace(/'/g, "''")}'`)
    .replace(/\{\{\s*param\.panels\s*\}\}/g, `'${p.panels.replace(/'/g, "''")}'`)
    .replace(/\{\{\s*param\.tz\s*\}\}/g, `'${p.tz.replace(/'/g, "''")}'`);
  const res = await sql.raw<Record<string, string>>(text).execute(db);
  return res.rows;
};
const runFor = runQuery('q-transmission-hvleid');
const runForOther = runQuery('q-transmission-other');
```

Write the fixtures through direct inserts into `ingest_events`, `lab_requests`, `diagnostic_reports` and `facility_map` — this test exercises the QUERY, not the projection, so hand-built rows are correct here (unlike slice 1's, which had to prove the projection itself).

- [ ] **Step 8: Run the live test**

```bash
TARGET_DATABASE_URL=postgres://openldr:openldr@127.0.0.1:5433/openldr_target pnpm --filter @openldr/reporting test -- transmission-grid-live.test.ts
```

Expected: PASS, 5 tests, **run not skipped**. A skipped run is not a pass.

- [ ] **Step 9: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts packages/reporting/src/seed/transmission-grid-live.test.ts
git commit -m "feat(reports): transmission grid queries, attributed through the submission batch"
```

---

## Task 3: The design and the two report records

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` — `SEED_DESIGNS` and `SEED_REPORT_DEFS`
- Modify: `packages/reporting/src/seed/report-seeds.test.ts`

**Interfaces:**
- Consumes: `q-transmission-hvleid` and `q-transmission-other` from Task 2, each returning `lab` plus `d01`..`d23`.
- Produces: design `rt-transmission-grid` and report `r-transmission-grid`.

**Design shape.** One design, two tables on one page, matching the reference. Follow `rt-clinical-micro` in the same file for the letterhead band, the `{{lab.*}}` tokens and the footer — read it before writing.

⛔ **`boundColumns` must list all 24 columns explicitly** — `lab`, `d01`..`d23`. Leaving it empty makes the table take headers from the query's own columns (`packages/report-designer/src/render/draw.ts:271`, `:348`), which would print `d01` as the header instead of a readable one. The dates travel in the first data row, not the header.

⚠ **Landscape.** 24 columns will not fit A4 portrait. The clinical micro design is portrait; this one is not. Set `orientation: 'landscape'` and size the rects for it.

- [ ] **Step 1: Write the failing tests**

```ts
describe('SEED_DESIGNS — rt-transmission-grid', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id)!;

  it('is landscape — 24 columns do not fit portrait', () => {
    expect(design().orientation).toBe('landscape');
  });

  it('draws BOTH grids on one page, as the reference does', () => {
    expect(el('hvleid').dataSource).toEqual({ kind: 'custom-query', queryId: 'q-transmission-hvleid' });
    expect(el('other').dataSource).toEqual({ kind: 'custom-query', queryId: 'q-transmission-other' });
  });

  it('binds the lab column and all 23 day columns explicitly', () => {
    for (const id of ['hvleid', 'other']) {
      const keys = (el(id).boundColumns ?? []).map((c) => c.key);
      expect(keys[0]).toBe('lab');
      expect(keys).toHaveLength(24);
      expect(keys).toContain('d23');
    }
  });

  it('projects only keys the queries actually select', () => {
    const sql = SEED_QUERIES.find((q) => q.id === 'q-transmission-hvleid')!.sql.postgres;
    for (const c of el('hvleid').boundColumns ?? []) {
      // ⚠ `\\b` — inside a TEMPLATE LITERAL a lone `\b` is the backspace character, not a word
      // boundary, so the pattern silently never matches.
      expect(new RegExp(`as ${c.key}\\b`).test(sql), `${c.key} is not selected`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts
```

Expected: FAIL — `rt-transmission-grid` is not in `SEED_DESIGNS`.

- [ ] **Step 3: Add the design**

Add `rt-transmission-grid` to `SEED_DESIGNS`, `orientation: 'landscape'`, with: the letterhead band copied from `rt-clinical-micro`; a title reading `LIS STAKEHOLDERS UPDATE`; a `keyvalue` strip showing the reporting period; a `table` `hvleid` titled "Any HVL/EID Data Submission by Testing Laboratory"; a `table` `other` titled "Any Other Test Data Submission by Testing Laboratory"; and the footer rule and signature line.

Parameters on the design:

```ts
    parameters: [
      { key: 'month', label: 'Month', type: 'text', required: true, value: '',
        help: 'The reporting month as YYYY-MM, for example 2021-01.' },
      { key: 'panels', label: 'HVL/EID panel codes', type: 'text', required: true, value: '',
        help: 'Comma-separated panel codes counted as HVL/EID. Everything else appears in the Other grid.' },
      { key: 'tz', label: 'Time zone', type: 'text', required: true, value: '',
        help: 'IANA zone the days are bucketed in. Defaults to Settings, Laboratory, Time zone.' },
    ],
```

- [ ] **Step 4: Add the report record**

Add `r-transmission-grid` to `SEED_REPORT_DEFS` with `designId: 'rt-transmission-grid'`, `primaryQueryId: 'q-transmission-hvleid'`, `category: 'operational'`, `status: 'published'`, and a description saying it reports arrival by laboratory and working day, and that a filled cell means data arrived that day.

⚠ Do **not** add it to `DESIGNS_REQUIRING_DATA`. That gate refuses to render when the named element has no rows — right for a per-patient clinical report, wrong here: a month in which nothing arrived from anyone is a real and important answer, and refusing to print it hides exactly the outage the report exists to reveal.

- [ ] **Step 5: Prefill the timezone parameter from the setting**

⛔ **Without this the setting is pointless.** If the operator must retype the zone on every run, a
stored `lab.timezone` buys nothing and two people running the same month can still disagree — the
exact failure the setting was chosen over a parameter to avoid.

The parameter stays a real parameter (the query needs it, and CLI/API callers must be able to pass
it). What changes is only the studio's initial value: when the parameters bar first opens for a
report that declares a `tz` parameter and no value is set yet, seed it from the laboratory identity
the studio already fetches.

In `apps/studio/src/reports/ReportParametersBar.tsx`, the params object is owned by the caller and
passed in, so do the seeding where that state is created rather than inside the bar — find the
Reports page component that holds it and initialise there. Read how it currently initialises
`params` before adding to it; do not introduce a second source of truth for that state.

⚠ **Say plainly in the report's parameter help that this is a default, not a binding.** A CLI or
scheduled run supplies `tz` explicitly and does not read the setting, so a scheduled monthly run
with a wrong or absent `tz` buckets wrongly and nothing warns. Slice 3 can close that by making the
schedule read the setting; it is out of scope here.

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts
```

```bash
pnpm --filter @openldr/studio test -- ReportParametersBar
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reports): seed the transmission grid design and report"
```

---

## Task 4: Docs, gate, and the rendered proof

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/reports.md`
- Modify: `apps/web/src/landing/changelog.json` (generated, after merge)

- [ ] **Step 1: Document the report**

`reports.md` follows a fixed page template — `Outcome`, `Before you begin`, `Steps`, `Expected result`, `Troubleshooting`, `Advanced web usage`, `Related guides`. **Do not add a new heading**; `validation.test.ts` checks the shape. Add to `Advanced web usage`:

```markdown
- The **LIS Stakeholders Update** shows, for each testing laboratory, whether any data arrived on each working day of a month. A filled cell means data reached OpenLDR that day; a hollow cell means none did. The first row carries the dates, because the column headers are fixed. Weekends are omitted, and no public-holiday calendar is applied. Set **Settings ▸ Laboratory ▸ Time zone** before relying on it: days are bucketed in that zone, and an unset or wrong zone moves late-evening arrivals to the previous day.
```

Add to `Troubleshooting`:

```markdown
- **A laboratory shows no data on a day you know it transmitted:** check **Settings ▸ Laboratory ▸ Time zone** first. Arrivals are bucketed by civil day, so a zone set to UTC on an installation running at +03 moves everything received after 21:00 local to the previous day.
- **A laboratory is missing from the grid entirely:** it sent nothing at all in that month. The grid lists only laboratories that appear in the window.
```

- [ ] **Step 2: Verify the docs still validate**

```bash
pnpm --filter @openldr/studio test -- validation.test.ts registry.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full gate**

```bash
pnpm turbo run typecheck test --force --continue --concurrency=4
```

Expected: all packages PASS. ⛔ `--concurrency=4` is not optional on this machine. Never pipe through `tail`. Report which live suites skipped — they will — so nobody reads a green gate as proof of this slice.

- [ ] **Step 4: Render the report and look at it**

⛔ **The step that matters.** With the API running and `AUTH_DEV_BYPASS` handled by the operator:

```bash
curl -s -o grid.pdf "http://127.0.0.1:3000/api/reports/r-transmission-grid.pdf?month=2026-08&panels=HIVVL,HIVPC&tz=Africa/Dar_es_Salaam"
```

Open it and confirm five things: the date row is the first row and its dates line up with the columns beneath; both grids are present; the laboratory names are readable rather than raw codes; a short month leaves trailing columns blank rather than shifting; and the page is landscape with nothing clipped at the right edge.

⚠ Use `127.0.0.1`, never `localhost`.

- [ ] **Step 5: Check the mobile view**

Resize to 375×812 and open the report. ⛔ A 24-column table cannot fit a phone. Confirm it scrolls horizontally **inside its own container** and does not make the page itself scroll sideways — `Table`'s wrapper needs `wrapperClassName="min-h-0 flex-1"` with a flex-column parent. Headless Chromium cannot see the `vh`-vs-`dvh` class, so if anything bottom-anchored changes, say only a real phone can confirm it.

- [ ] **Step 6: Merge and regenerate the changelog**

Merge to local `main` first, confirm the origin SHA after pushing, and do not open a PR unless asked. Then, **after** the merge, because the generator reads git history:

```bash
pnpm make:changelog
```

```bash
git add apps/web/src/landing/changelog.json && git commit -m "chore(web): regenerate the landing changelog"
```

---

## Verification summary

| Claim | Proven by | Layer it does NOT cover |
|---|---|---|
| Registration-only submissions register | the live test's first case | Nothing about the PDF |
| Days bucket in the civil timezone | the 21:00Z test, asserting both zones | MSSQL/MySQL, whose zone syntax differs |
| Short months blank rather than shift | the February case | — |
| The grids partition arrivals | the partition test | — |
| No clinical vocabulary in SQL | `report-seeds.test.ts` | — |
| The page reads correctly | Task 4 Step 4, by eye | Not automated |

**HONEST NON-PROOF — three gaps, stated rather than buried:**

1. **MSSQL and MySQL are shape-tested only, and the timezone syntax genuinely differs between them.** MSSQL takes **Windows** zone names where Postgres and MySQL take IANA, so a `lab.timezone` of `Africa/Dar_es_Salaam` is valid on two engines and invalid on the third. Neither engine executes here. This is a real portability defect, not a theoretical one — record it rather than implying parity.
2. **Nothing proves the grid matches the reference document** for the same month. CE holds neither the 2021 data nor the curated 21-laboratory list.
3. **88 rows, not 21.** The PDF will run to several pages where the reference is one. That follows from CE knowing more laboratories than the reference's curated list, and the curated list is slice 3's work.
