# Clinical Microbiology Report — Accept the Lab Number: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `r-clinical-micro` accept the lab number the LIS sends, so one report shows the organism and its susceptibilities even though DISA splits them across two or three orders.

**Architecture:** Two seeded SQL definitions change. `q-clinical-micro-header` widens its predicate to match either `lab_requests.request_id` or `lab_requests.id`, requires an isolate, and folds across the lab number's orders to stay one row. `q-clinical-micro-ast` gains a join to reach the same predicate and two structural filters — the interpretation must be in the `vs-ast-interpretation` value set, and the lab number must carry an isolate. A `help` field is added to report parameters so the field can say what it accepts. No migration: `report_designs.parameters` is a JSON column.

**Tech Stack:** TypeScript, Kysely, Postgres/MSSQL/MySQL SQL strings in `packages/reporting`, Vitest, React + shadcn in `apps/studio`.

**Spec:** `docs/superpowers/specs/2026-08-17-clinical-micro-lab-number-parameter-design.md`

## Global Constraints

- **Never add a `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailer** to any commit. The operator is the sole contributor.
- **Stage named paths only. Never `git add -A`** — the repository directory is shared with concurrent sessions.
- **Gate command:** `pnpm turbo run typecheck test --force --continue`. **Never pipe turbo through `tail`** — it truncates the failure list and hides which package failed.
- A gate failure is usually a **timeout, not a regression.** Grep the output for `Test timed out` and re-run that package alone before blaming a change.
- **Every SQL change must be made in all three dialects** — `postgres`, `mssql`, `mysql`. MSSQL has no ordinal `GROUP BY`, so its select expressions stay repeated in full.
- ⛔ **String concatenation differs in all three, and getting it wrong is silent.** Postgres uses `||`; MSSQL uses `+`; **MySQL uses `concat(a, b, c)`**. In MySQL `||` is *logical OR* unless `sql_mode` includes `PIPES_AS_CONCAT`, so a `||` there yields `0`/`1` where a location string belongs — no error, just a wrong value on a clinical report. Copy each dialect's existing operator from the string you are replacing; never carry one dialect's expression into another.
- **Never hardcode clinical vocabulary** (`AGENTS.md` §8). Codes come from `terminology_codes`. No drug, panel, or organism code list may be added to SQL. The two LOINC/local observation codes `'634-6'` and `'ORGS'` are already present in both queries and are the structural isolate marker, not a vocabulary list — do not extend them.
- **`{{param.request}}` may appear more than once in one query.** `substituteParams` replaces with a global regex and inlines an escaped quoted string literal (`packages/dashboards/src/custom-query-run.ts:37`). It does **not** bind a placeholder — any test must mirror that or it proves something the runtime never executes.
- **Do not touch** the `facility_of` / `facility_loc` / `facility` CTEs, their join guards, the design's element rects, or the barcode/QR bindings.
- **Do not add a field to the `hdr` keyvalue panel.** It holds ten pairs with 4pt of spare and an eleventh row is clipped silently (`packages/reporting/src/seed/report-seeds.ts:2249-2262`).
- Working directory for every command: the repository root, `D:/Projects/Repositories/openldr_ce`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/reporting/src/seed/report-seeds.ts` | Modify — `q-clinical-micro-ast` SQL, 3 dialects | 1 |
| `packages/reporting/src/seed/report-seeds.test.ts` | Modify — SQL-shape pins for the AST query | 1 |
| `packages/reporting/src/seed/clinical-micro-ast-live.test.ts` | Create — live Postgres behaviour for the AST query | 1 |
| `packages/reporting/src/seed/report-seeds.ts` | Modify — `q-clinical-micro-header` SQL, 3 dialects | 2 |
| `packages/reporting/src/seed/report-seeds.test.ts` | Modify — SQL-shape pins for the header | 2 |
| `packages/reporting/src/seed/clinical-micro-header-live.test.ts` | Modify — multi-order fixtures and assertions | 2 |
| `packages/report-designer/src/schema.ts` | Modify — `help?: string` on the design parameter | 3 |
| `packages/reporting/src/types.ts` | Modify — `help?: string` on `ReportParamMeta` | 3 |
| `packages/bootstrap/src/index.ts` | Modify — carry `help` into the summary mapping | 3 |
| `apps/studio/src/api.ts` | Modify — mirror `help` on the client type | 3 |
| `apps/studio/src/reports/ReportParametersBar.tsx` | Modify — info icon + tooltip when `help` is set | 3 |
| `apps/studio/src/reports/ReportParametersBar.test.tsx` | Modify — tooltip renders, absent when no help | 3 |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | Modify — the help string, all three languages | 3 |
| `packages/reporting/src/seed/report-seeds.ts` | Modify — `help` on the `rt-clinical-micro` parameter | 3 |
| `apps/studio/src/docs/0.1.0/en/reports.md` | Modify — document what the field accepts | 4 |
| `apps/web/src/landing/changelog.json` | Regenerate — `pnpm make:changelog` after merge | 4 |

---

## Task 1: `q-clinical-micro-ast` accepts either identifier and gates on terminology

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:1755-1824` (the whole `q-clinical-micro-ast` entry)
- Modify: `packages/reporting/src/seed/report-seeds.test.ts`
- Create: `packages/reporting/src/seed/clinical-micro-ast-live.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the AST query returns the same three columns as today — `test`, `result`, `status` — so `tbl`'s `boundColumns` and `summaryMetrics: [{ id: 'agents', type: 'count' }]` need no change. Task 2 depends on nothing here; the two tasks are independent.

> ⛔ **CORRECTION, 2026-08-17, after Task 1's first review.** Every `value_set_id =
> 'vs-ast-interpretation'` in this task's SQL below is **WRONG** — that id does not exist. Value-set
> ids are `vs-${randomUUID()}` minted at seed time; the stable key is
> `value_set_url = 'urn:openldr:valueset:ast-interpretation'`. Read the corrected §3 of the spec
> before using the SQL in Steps 3–5. Two sites need the URL: the new `in (select …)` filter **and**
> the pre-existing display `LEFT JOIN tc`. The live fixture in Step 7 must insert a **random** id
> with the real URL, mirroring production — inserting the literal id makes all six tests pass against
> a shape production never produces. Left in place below as the record of what was implemented first
> and why the review caught it.

**Why the isolate anchor lives in this query and is not inherited:** `reporting.run(id, params)` executes this query alone for the JSON preview and the CSV export (`apps/server/src/reports-routes.ts:54`), with no header and no `RP0005` gate. Without its own anchor, `GET /api/reports/r-clinical-micro.csv?request=TZDISATDS0010015` exports coded chemistry rows under susceptibility headings.

- [ ] **Step 1: Write the failing SQL-shape tests**

Add to `packages/reporting/src/seed/report-seeds.test.ts`:

```ts
describe('SEED_QUERIES — q-clinical-micro-ast resolves a lab number and gates on terminology', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-clinical-micro-ast')!;

  it('matches either the lab number or the order id, in every dialect', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not match the lab number`).toMatch(/q\.request_id\s*=\s*\{\{param\.request\}\}/);
      expect(sql, `${dialect} dropped the order-id path`).toMatch(/q\.id\s*=\s*\{\{param\.request\}\}/);
      expect(sql, `${dialect} must join lab_requests to reach request_id`)
        .toMatch(/join lab_requests q on q\.id\s*=\s*r\.request_id/);
    }
  });

  it('takes the interpretation from the vs-ast-interpretation value set, not a literal S/I/R list', () => {
    // AGENTS.md §8. A hardcoded in ('S','I','R') also lets HIV Rapid EQA panels through — measured
    // 2026-08-17: unanchored S/I/R selects EQA proficiency rows that are 100% R by design.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not gate on the value set`)
        .toMatch(/value_set_id\s*=\s*'vs-ast-interpretation'[\s\S]*?coalesce\(r\.coded_value, r\.abnormal_flag\) in \(\s*select code from terminology_codes/);
    }
  });

  it('anchors to an isolate, so the CSV export cannot return chemistry rows', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the isolate anchor`)
        .toMatch(/exists\s*\(\s*select 1 from lab_results/);
      expect(sql, `${dialect} isolate anchor must look for the organism codes`)
        .toMatch(/observation_code in \('634-6', 'ORGS'\)/);
    }
  });

  it('still returns exactly test, result and status', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      for (const col of ['test', 'result', 'status']) {
        expect(sql, `${dialect} stopped selecting ${col}`).toMatch(new RegExp(`as ${col}\\b`));
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "q-clinical-micro-ast resolves"
```

Expected: FAIL — four failures, the first reading `postgres does not match the lab number`.

- [ ] **Step 3: Replace the Postgres SQL**

In `packages/reporting/src/seed/report-seeds.ts`, replace the `postgres` string of `q-clinical-micro-ast`:

```sql
select
  r.observation_desc as test,
  coalesce(tc.display, r.text_value, r.coded_value) as result,
  case coalesce(r.coded_value, r.abnormal_flag)
    when 'S' then 'normal'
    when 'R' then 'abnormal'
    when 'I' then 'indeterminate'
    else '' end as status
from lab_results r
join lab_requests q on q.id = r.request_id
left join terminology_codes tc
  on tc.value_set_id = 'vs-ast-interpretation'
 and tc.code = coalesce(r.coded_value, r.abnormal_flag)
where (q.request_id = {{param.request}} or q.id = {{param.request}})
  and r.observation_code not in (select code from terminology_codes where value_set_id = 'vs-non-reportable')
  and coalesce(r.coded_value, r.abnormal_flag) in (
    select code from terminology_codes where value_set_id = 'vs-ast-interpretation')
  and r.observation_code not in ('634-6', 'ORGS')
  and exists (
    select 1 from lab_results iso
    join lab_requests iq on iq.id = iso.request_id
    where (iq.request_id = {{param.request}} or iq.id = {{param.request}})
      and iso.observation_code in ('634-6', 'ORGS'))
group by 1, 2, 3
order by 1
```

Two changes beyond the predicate. The `is not null` interpretation filter becomes an `in (select …)` against `vs-ast-interpretation` — that is what excludes the microscopy rows (`MCSF` orders carry 5–6: pus cells, epithelial cells, gram stain). The `exists` anchor is what excludes EQA and ARV panels: a susceptibility test exists *because* a culture grew something.

- [ ] **Step 4: Replace the MSSQL SQL**

Same query, but `group by` repeats the select expressions in full — MSSQL has no ordinal `GROUP BY`:

```sql
select
  r.observation_desc as test,
  coalesce(tc.display, r.text_value, r.coded_value) as result,
  case coalesce(r.coded_value, r.abnormal_flag)
    when 'S' then 'normal'
    when 'R' then 'abnormal'
    when 'I' then 'indeterminate'
    else '' end as status
from lab_results r
join lab_requests q on q.id = r.request_id
left join terminology_codes tc
  on tc.value_set_id = 'vs-ast-interpretation'
 and tc.code = coalesce(r.coded_value, r.abnormal_flag)
where (q.request_id = {{param.request}} or q.id = {{param.request}})
  and r.observation_code not in (select code from terminology_codes where value_set_id = 'vs-non-reportable')
  and coalesce(r.coded_value, r.abnormal_flag) in (
    select code from terminology_codes where value_set_id = 'vs-ast-interpretation')
  and r.observation_code not in ('634-6', 'ORGS')
  and exists (
    select 1 from lab_results iso
    join lab_requests iq on iq.id = iso.request_id
    where (iq.request_id = {{param.request}} or iq.id = {{param.request}})
      and iso.observation_code in ('634-6', 'ORGS'))
group by
  r.observation_desc,
  coalesce(tc.display, r.text_value, r.coded_value),
  case coalesce(r.coded_value, r.abnormal_flag)
    when 'S' then 'normal'
    when 'R' then 'abnormal'
    when 'I' then 'indeterminate'
    else '' end
order by 1
```

- [ ] **Step 5: Replace the MySQL SQL**

Identical to the Postgres string above, including `group by 1, 2, 3` — MySQL supports ordinal `GROUP BY`.

- [ ] **Step 6: Run the shape tests to verify they pass**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "q-clinical-micro-ast"
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Write the live behaviour test**

Shape tests are regexes; they cannot tell "reads right" from "returns right". Create `packages/reporting/src/seed/clinical-micro-ast-live.test.ts`, copying the harness contract from `clinical-micro-header-live.test.ts` — own throwaway database, real migrations, `substituteParams` mirrored exactly:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, externalMigrations } from '@openldr/db';
import { SEED_QUERIES } from './report-seeds';

// Runs only when TARGET_DATABASE_URL points at a live Postgres. The default hermetic `pnpm test`
// skips it. pg-mem cannot stand in: this asserts grouping and EXISTS behaviour over a multi-order
// shape, and pg-mem has no correlated-subquery support (AGENTS.md §7).
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

live('q-clinical-micro-ast resolves a lab number across orders (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_microast_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<Record<string, never>>;

  const runFor = async (param: string): Promise<Record<string, unknown>[]> => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-ast')!.sql.postgres;
    const text = raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'${param.replace(/'/g, "''")}'`);
    const res = await sql.raw<Record<string, unknown>>(text).execute(db);
    return res.rows;
  };

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString() }) }) });
    const up = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    expect(up.error).toBeUndefined();

    // The interpretation value set the query now gates on.
    for (const [code, display] of [['S', 'Susceptible'], ['I', 'Intermediate'], ['R', 'Resistant']]) {
      await db.insertInto('terminology_codes' as never).values({
        id: `vs-ast-${code}`, value_set_id: 'vs-ast-interpretation', code, display,
      } as never).execute();
    }

    // LAB-MICRO — the real DISA shape: organism on one order, susceptibilities on another.
    await db.insertInto('specimens' as never).values({ id: 'spec-micro', type_text: 'Stools' } as never).execute();
    await db.insertInto('lab_requests' as never).values([
      { id: 'micro-obr1', request_id: 'LAB-MICRO', panel_code: 'MSTRS', panel_desc: 'MICROBIOLOGY : STOOL' },
      { id: 'micro-obr2', request_id: 'LAB-MICRO', panel_code: 'MSENS', panel_desc: 'Microbiology Sensitivity' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'm-org', request_id: 'micro-obr1', specimen_id: 'spec-micro', observation_code: 'ORGS', text_value: 'Shigella flexneri' },
      { id: 'm-amp', request_id: 'micro-obr2', specimen_id: 'spec-micro', observation_code: 'AMPIC', observation_desc: 'Ampicillin', coded_value: 'R' },
      { id: 'm-cip', request_id: 'micro-obr2', specimen_id: 'spec-micro', observation_code: 'CIPRO', observation_desc: 'Ciprofloxacin', coded_value: 'S' },
      // Microscopy on the culture order: coded, but NOT a susceptibility interpretation.
      { id: 'm-pus', request_id: 'micro-obr1', specimen_id: 'spec-micro', observation_code: 'PUS', observation_desc: 'Pus cells', coded_value: '+++' },
    ] as never).execute();

    // LAB-CHEM — a chemistry lab number. No organism anywhere. abnormal_flag is set, which is what
    // the old `is not null` filter let through.
    await db.insertInto('lab_requests' as never).values([
      { id: 'chem-obr1', request_id: 'LAB-CHEM', panel_code: 'LFT', panel_desc: 'Liver Function' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'c-alt', request_id: 'chem-obr1', observation_code: 'ALT', observation_desc: 'ALT', abnormal_flag: 'H' },
    ] as never).execute();

    // LAB-EQA — an EQA proficiency panel. Real S/I/R values, no isolate. 87% of S/I/R rows in the
    // live warehouse are these, and they are 100% R by design.
    await db.insertInto('lab_requests' as never).values([
      { id: 'eqa-obr1', request_id: 'LAB-EQA', panel_code: 'EQSS1', panel_desc: 'HIV Rapid EQA Test 1' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'e-1', request_id: 'eqa-obr1', observation_code: 'EQSS1', observation_desc: 'A-1', coded_value: 'R' },
    ] as never).execute();
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
    await admin
      .query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName])
      .catch(() => undefined);
    await admin.query(`drop database if exists "${dbName}"`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it('returns the susceptibilities when given the LAB NUMBER, not an order id', async () => {
    const rows = await runFor('LAB-MICRO');
    expect(rows.map((r) => r.test).sort()).toEqual(['Ampicillin', 'Ciprofloxacin']);
  });

  it('still works when given a per-order id', async () => {
    const rows = await runFor('micro-obr2');
    expect(rows.map((r) => r.test).sort()).toEqual(['Ampicillin', 'Ciprofloxacin']);
  });

  it('resolves the interpretation display from terminology', async () => {
    const rows = await runFor('LAB-MICRO');
    const amp = rows.find((r) => r.test === 'Ampicillin');
    expect(amp?.result).toBe('Resistant');
    expect(amp?.status).toBe('abnormal');
  });

  it('leaves microscopy off the susceptibility table', async () => {
    // Pus cells sit on the culture order and are coded. Widening to the lab number would pull them
    // in were it not for the value-set gate.
    const rows = await runFor('LAB-MICRO');
    expect(rows.map((r) => r.test)).not.toContain('Pus cells');
  });

  it('returns nothing for a chemistry lab number', async () => {
    expect(await runFor('LAB-CHEM')).toHaveLength(0);
  });

  it('returns nothing for an EQA panel — S/I/R without an isolate is not a susceptibility', async () => {
    expect(await runFor('LAB-EQA')).toHaveLength(0);
  });
});
```

- [ ] **Step 8: Run the live test**

```bash
pnpm --filter @openldr/reporting test -- clinical-micro-ast-live.test.ts
```

Expected: PASS, 6 tests. If it reports `skipped`, `TARGET_DATABASE_URL` is unset — export it from `.env` (`postgres://openldr:openldr@127.0.0.1:5433/openldr_target`) and re-run. A skipped run is **not** a pass; do not proceed on one.

- [ ] **Step 9: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts packages/reporting/src/seed/clinical-micro-ast-live.test.ts
git commit -m "fix(reports): clinical micro susceptibilities resolve from the lab number"
```

---

## Task 2: `q-clinical-micro-header` accepts either identifier, requires an isolate, stays one row

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:1872-2020` (the whole `q-clinical-micro-header` entry, all three dialects)
- Modify: `packages/reporting/src/seed/report-seeds.test.ts`
- Modify: `packages/reporting/src/seed/clinical-micro-header-live.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the same eleven columns as today — `patient_surname`, `patient_firstname`, `sex`, `dob`, `specimen`, `received`, `lab_number`, `panel`, `organism`, `performing_lab`, `lab_location`. The design's `hdr`, `org`, `bc` and `qr` bindings are unchanged. `report-seeds.test.ts:971` asserts every bound column appears as `as <key>` in the Postgres SQL, so none may be renamed or dropped.

**The four changes, and why each is safe on measured data (2026-08-17, live dev warehouse):**

1. Predicate widens to `(q.request_id = … or q.id = …)`.
2. An `exists` isolate guard. With no organism the query returns zero rows, and the existing `DESIGNS_REQUIRING_DATA` gate (`packages/bootstrap/src/index.ts:259`) refuses with `RP0005` — so a chemistry lab number cannot render a PDF titled "MICROBIOLOGY — CULTURE & SENSITIVITY".
3. The `organism` subquery and the two `max(l.specimen_id)` lookups widen from `l.request_id = q.id` to every order under the resolved lab number. Safe: one specimen per lab number (240/240) and zero lab numbers carry two distinct organism values (0/117).
4. The driving row must collapse to one. `lab_requests` now matches several orders, so the outer select groups by the folded values and `panel` is picked as described below.

**`panel` names the order that supplied the susceptibilities.** Measured: exactly one order per lab number does, 5/5. Fallback for a culture-only lab number — 112 of 117 — is an organism-bearing order, tie-broken on `q.id`. That tiebreaker is **stable but arbitrary**: ten lab numbers have two organism-bearing orders and `q.id` text ordering puts `-obr10` before `-obr2`. Naming "the culture panel" is impossible — `authored_at` is identical across a lab number's orders (2995/2995), and `created_at` tracks ingest so a reprojection would silently change a printed clinical field.

- [ ] **Step 1: Write the failing SQL-shape tests**

Add to `packages/reporting/src/seed/report-seeds.test.ts`:

```ts
describe('SEED_QUERIES — q-clinical-micro-header resolves a lab number', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-clinical-micro-header')!;

  it('matches either the lab number or the order id, in every dialect', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not match the lab number`).toMatch(/q\.request_id\s*=\s*\{\{param\.request\}\}/);
      expect(sql, `${dialect} dropped the order-id path`).toMatch(/q\.id\s*=\s*\{\{param\.request\}\}/);
    }
  });

  it('requires an isolate, so a chemistry lab number renders no PDF', () => {
    // Without this the widened predicate would find the chemistry request, return a row, and the
    // DESIGNS_REQUIRING_DATA gate would pass — producing a MICROBIOLOGY-titled PDF of nothing.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the isolate guard`).toMatch(/exists\s*\(\s*select 1 from lab_results/);
    }
  });

  it('looks for the organism across every order under the lab number, not one order', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} still scopes the organism to a single order`)
        .not.toMatch(/where o\.request_id\s*=\s*q\.id\b/);
    }
  });

  it('still selects every column the design binds', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      for (const col of ['patient_surname', 'patient_firstname', 'sex', 'dob', 'specimen',
        'received', 'lab_number', 'panel', 'organism', 'performing_lab', 'lab_location']) {
        expect(sql, `${dialect} stopped selecting ${col}`).toMatch(new RegExp(`as ${col}\\b`));
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "q-clinical-micro-header resolves"
```

Expected: FAIL — three failures (the fourth, column coverage, passes already).

- [ ] **Step 3: Replace the Postgres SQL**

Keep the three existing CTEs (`facility_of`, `facility_loc`, `facility`) **byte-identical** — five tests in `report-seeds.test.ts:1086-1140` pin their join guards. Add two CTEs and rewrite the final select:

```sql
orders as (
  select q.id, q.request_id, q.panel_desc, q.patient_id
  from lab_requests q
  where (q.request_id = {{param.request}} or q.id = {{param.request}})
),
isolates as (
  select o.id from orders o
  join lab_results r on r.request_id = o.id
  where r.observation_code in ('634-6', 'ORGS')
),
ast_source as (
  select min(o.id) as id from orders o
  join lab_results r on r.request_id = o.id
  where coalesce(r.coded_value, r.abnormal_flag) in (
      select code from terminology_codes where value_set_id = 'vs-ast-interpretation')
    and r.observation_code not in ('634-6', 'ORGS')
),
panel_order as (
  select coalesce(
    (select id from ast_source),
    (select min(id) from isolates)) as id
),
spec as (
  select max(l.specimen_id) as specimen_id
  from lab_results l join orders o on o.id = l.request_id
)
select
  p.surname as patient_surname,
  p.firstname as patient_firstname,
  p.sex as sex,
  p.date_of_birth as dob,
  s.type_text as specimen,
  left(s.received_time, 10) as received,
  (select min(request_id) from orders) as lab_number,
  (select o.panel_desc from orders o join panel_order po on po.id = o.id) as panel,
  (select max(coalesce(r.text_value, r.coded_value)) from lab_results r
     join orders o on o.id = r.request_id
     where r.observation_code in ('634-6', 'ORGS')) as organism,
  f.performing_lab as performing_lab,
  case when f.district is not null and f.region is not null
       then f.district || ', ' || f.region
       else coalesce(f.district, f.region) end as lab_location
from spec
left join patients p on p.id = (select min(patient_id) from orders)
left join specimens s on s.id = spec.specimen_id
left join facility f on f.specimen_id = spec.specimen_id
where exists (select 1 from isolates)
```

`from spec` — not `from lab_requests` — is what makes the single row structural rather than a property of the fold. `spec` is one aggregate row by construction, so no `GROUP BY` is needed and no order can fan it out. `where exists (select 1 from isolates)` turns that one row into zero rows when there is no organism, which is what the `RP0005` gate reads.

- [ ] **Step 4: Replace the MSSQL SQL**

Same CTEs and select, with two dialect differences. Concatenation uses `+`, matching what is there today:

```sql
  case when f.district is not null and f.region is not null
       then f.district + ', ' + f.region
       else coalesce(f.district, f.region) end as lab_location
```

`left(s.received_time, 10)` is valid T-SQL and stays as-is. There is no `GROUP BY` in this rewrite, so the MSSQL ordinal-`GROUP BY` limitation does not apply here.

- [ ] **Step 5: Replace the MySQL SQL**

Same CTEs and select as Postgres, with one difference: **`lab_location` keeps `concat()`**, exactly as
the string you are replacing already has it (`report-seeds.ts:2009`):

```sql
  case when f.district is not null and f.region is not null
       then concat(f.district, ', ', f.region)
       else coalesce(f.district, f.region) end as lab_location
```

⛔ Do **not** carry the Postgres `||` into this string. MySQL reads `||` as logical OR unless
`PIPES_AS_CONCAT` is set, so `lab_location` would come back `0` or `1` with no error raised.
`left(...)` and `min(...)` are the same in MySQL, and MySQL supports ordinal `GROUP BY` — but this
rewrite has no `GROUP BY`, so that does not arise.

- [ ] **Step 6: Run the shape tests to verify they pass**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "q-clinical-micro"
```

Expected: PASS. The five pre-existing performing-laboratory tests must still pass untouched — if any fails, a CTE was edited that should not have been.

- [ ] **Step 7: Extend the live header test with the multi-order shape**

The eight existing tests in `clinical-micro-header-live.test.ts` must keep passing unchanged: `seedRequest` already inserts an `observation_code: '634-6'` row, so every existing fixture satisfies the new isolate guard. Add fixtures to `beforeAll`, after the `req-bare` block:

```ts
    // The real DISA shape — organism on the culture order, susceptibilities on the sensitivity
    // order, both under one lab number sharing one specimen.
    for (const [code, display] of [['S', 'Susceptible'], ['R', 'Resistant']]) {
      await db.insertInto('terminology_codes' as never).values({
        id: `vs-ast-${code}`, value_set_id: 'vs-ast-interpretation', code, display,
      } as never).execute();
    }
    await db.insertInto('specimens' as never).values({
      id: 'spec-split', type_text: 'Stools', received_time: '2026-02-03T04:05:06Z',
    } as never).execute();
    await db.insertInto('lab_requests' as never).values([
      { id: 'split-obr1', request_id: 'LAB-SPLIT', panel_desc: 'MICROBIOLOGY : STOOL' },
      { id: 'split-obr2', request_id: 'LAB-SPLIT', panel_desc: 'Microbiology Sensitivity' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'sp-org', request_id: 'split-obr1', specimen_id: 'spec-split', observation_code: 'ORGS', text_value: 'Shigella flexneri' },
      { id: 'sp-amp', request_id: 'split-obr2', specimen_id: 'spec-split', observation_code: 'AMPIC', observation_desc: 'Ampicillin', coded_value: 'R' },
    ] as never).execute();

    // Culture only — an organism, no susceptibilities. 112 of 117 real micro lab numbers.
    await db.insertInto('specimens' as never).values({ id: 'spec-cult', type_text: 'Urine' } as never).execute();
    await db.insertInto('lab_requests' as never).values([
      { id: 'cult-obr1', request_id: 'LAB-CULT', panel_desc: 'Specimen Collection' },
      { id: 'cult-obr2', request_id: 'LAB-CULT', panel_desc: 'MICROBIOLOGY : URINE' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'cu-org', request_id: 'cult-obr2', specimen_id: 'spec-cult', observation_code: 'ORGS', text_value: 'Escherichia coli' },
    ] as never).execute();

    // Chemistry — exists, but no isolate anywhere.
    await db.insertInto('lab_requests' as never).values([
      { id: 'chem-obr1', request_id: 'LAB-CHEM', panel_desc: 'Liver Function' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'ch-alt', request_id: 'chem-obr1', observation_code: 'ALT', abnormal_flag: 'H' },
    ] as never).execute();
```

Then add the assertions:

```ts
  it('resolves the LAB NUMBER, returning one row across two orders', async () => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const res = await sql.raw<Record<string, unknown>>(
      raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'LAB-SPLIT'`)).execute(db);
    expect(res.rows).toHaveLength(1);
  });

  it('carries the organism even though it sits on the other order', async () => {
    const row = await runFor('LAB-SPLIT');
    expect(row?.organism).toBe('Shigella flexneri');
    expect(row?.lab_number).toBe('LAB-SPLIT');
    expect(row?.specimen).toBe('Stools');
  });

  it('names the panel that supplied the susceptibilities', async () => {
    const row = await runFor('LAB-SPLIT');
    expect(row?.panel).toBe('Microbiology Sensitivity');
  });

  it('falls back to an organism-bearing order for a culture with no susceptibilities', async () => {
    const row = await runFor('LAB-CULT');
    expect(row?.panel).toBe('MICROBIOLOGY : URINE');
    expect(row?.organism).toBe('Escherichia coli');
  });

  it('returns NO row for a lab number with no microbiology, so the PDF is refused', async () => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const res = await sql.raw<Record<string, unknown>>(
      raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'LAB-CHEM'`)).execute(db);
    expect(res.rows).toHaveLength(0);
  });

  it('returns NO row for an unknown identifier', async () => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const res = await sql.raw<Record<string, unknown>>(
      raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'NOPE'`)).execute(db);
    expect(res.rows).toHaveLength(0);
  });
```

- [ ] **Step 8: Run the live header test**

```bash
pnpm --filter @openldr/reporting test -- clinical-micro-header-live.test.ts
```

Expected: PASS, 14 tests — the 8 that existed plus 6 new. A skipped run is not a pass.

- [ ] **Step 9: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts packages/reporting/src/seed/clinical-micro-header-live.test.ts
git commit -m "fix(reports): clinical micro header resolves the lab number and requires an isolate"
```

---

## Task 3: the parameter says what it accepts

**Files:**
- Modify: `packages/report-designer/src/schema.ts` — the design parameter schema
- Modify: `packages/reporting/src/types.ts:11-18` — `ReportParamMeta`
- Modify: `packages/bootstrap/src/index.ts:163` — the summary mapping
- Modify: `apps/studio/src/api.ts:~92` — the client mirror of `ReportParamMeta`
- Modify: `apps/studio/src/reports/ReportParametersBar.tsx`
- Modify: `apps/studio/src/reports/ReportParametersBar.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Modify: `packages/reporting/src/seed/report-seeds.ts:2225` — the `rt-clinical-micro` parameter

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `ReportParamMeta` gains `help?: string`. The design parameter gains `help?: string`. No other signature changes.

**No migration.** `report_designs.parameters` is a JSON column (`packages/report-designer/src/store.ts:15`), so a new field inside a parameter object needs no schema change. `designContentFingerprint` covers `parameters`, so adding `help` changes the fingerprint and the boot seed's managed-overwrite path pushes it to existing installs (`packages/reporting/src/seed/report-seeds.ts:2573-2587`). ⚠ An operator who edited this built-in design in place loses those edits — the accepted trade documented at `:2584`.

**i18n is enforced.** `apps/studio/src/i18n/parity.test.ts` compares key sets across en/fr/pt. Adding a key to `en.ts` alone fails the gate. A missing key renders as literal braces on the page.

- [ ] **Step 1: Write the failing UI test**

Add to `apps/studio/src/reports/ReportParametersBar.test.tsx`:

The existing fixture in this file is `const report: ReportSummary` at line 8 — spread it, do not build a
new one and do not rename it:

```tsx
it('shows a help tooltip trigger for a parameter that carries help text', () => {
  const withHelp: ReportSummary = {
    ...report,
    parameters: [{ id: 'request', label: 'Request ID', type: 'text', required: true, help: 'Accepts the lab number.' }],
  };
  render(<ReportParametersBar report={withHelp} params={{}} options={{}} onChange={() => {}} onRun={() => {}} running={false} canRun />);
  expect(screen.getByRole('button', { name: /about request id/i })).toBeInTheDocument();
});

it('shows no help trigger when the parameter has none', () => {
  const noHelp: ReportSummary = {
    ...report,
    parameters: [{ id: 'asOf', label: 'As of', type: 'text', required: false }],
  };
  render(<ReportParametersBar report={noHelp} params={{}} options={{}} onChange={() => {}} onRun={() => {}} running={false} canRun />);
  expect(screen.queryByRole('button', { name: /about as of/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter openldr-studio test -- ReportParametersBar.test.tsx
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name /about request id/i`. A TypeScript error on `help` is also expected and is fixed by Step 3.

- [ ] **Step 3: Add `help` to the three type definitions**

`packages/reporting/src/types.ts`:

```ts
export interface ReportParamMeta {
  id: string;
  label: string;
  type: 'daterange' | 'select' | 'text';
  required: boolean;
  /** Key into the report's options() result, for type 'select'. */
  optionsKey?: string;
  /** Operator-facing note on what the field accepts. Rendered as a tooltip beside the label. */
  help?: string;
}
```

`apps/studio/src/api.ts` — add `help?: string;` to its `ReportParamMeta` mirror, beside the existing `optionsKey?: string;` at line ~92.

`packages/report-designer/src/schema.ts:109-115` — the design parameter schema is `TemplateParamSchema`. Add `help` after `value`:

```ts
export const TemplateParamSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'select', 'daterange']).optional(),
  required: z.boolean().optional(),
  value: z.union([z.string(), DateRangeValueSchema]).optional(),
  /** Operator-facing note on what the field accepts. Surfaced as ReportParamMeta.help. */
  help: z.string().optional(),
});
```

- [ ] **Step 4: Carry `help` through the summary mapping**

`packages/bootstrap/src/index.ts`, in the block at line ~163 that builds each `ReportParamMeta` from a design parameter — after the existing `optionsKey` line:

```ts
    if (p.help) base.help = p.help;
```

- [ ] **Step 5: Render the tooltip**

`apps/studio/src/reports/ReportParametersBar.tsx`. shadcn only — use the existing `Tooltip` primitives from `@/components/ui/tooltip` and `Info` from `lucide-react`. Never a native `<button>` or `title` attribute.

```tsx
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
```

Replace the `<Label>` block in the returned JSX:

```tsx
          <Label className="flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {p.label}{p.required && <span className="text-destructive"> *</span>}
            {p.help && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-4 text-muted-foreground hover:text-foreground"
                    aria-label={t('reports.aboutParam', { label: p.label })}
                  >
                    <Info className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{p.help}</TooltipContent>
              </Tooltip>
            )}
          </Label>
```

`apps/studio/src/components/ui/tooltip.tsx` already exists — import from it. Do not build a primitive and do not reach for a native `title` attribute.

- [ ] **Step 6: Add the i18n key to all three languages**

`apps/studio/src/i18n/en.ts`, inside the `reports:` object (line ~608):

```ts
    aboutParam: 'About {{label}}',
```

`fr.ts`: `aboutParam: 'À propos de {{label}}',`
`pt.ts`: `aboutParam: 'Sobre {{label}}',`

- [ ] **Step 7: Set the help text on the seeded parameter**

`packages/reporting/src/seed/report-seeds.ts:2225`:

```ts
    parameters: [{ key: 'request', label: 'Request ID', type: 'text', required: true, value: '',
      help: 'The lab number, as the LIS sends it (for example TZDISATDS0013538). A single order id also works.' }],
```

The example is a real micro lab number in the dev warehouse, so an operator who copies it gets a report rather than another refusal.

- [ ] **Step 8: Run the studio and i18n tests**

```bash
pnpm --filter openldr-studio test -- ReportParametersBar.test.tsx parity.test.ts
```

Expected: PASS. A `parity.test.ts` failure naming `reports.aboutParam` means one of fr/pt was missed.

- [ ] **Step 9: Check the mobile view**

Start the studio, open Reports ▸ Clinical Microbiology Report, and resize to 375×812. The info trigger must not push the Run button off the row, and the tooltip must be reachable.

⛔ Headless Chromium **cannot** see the `100vh`-vs-`dvh` bug class. This change touches no bottom-anchored UI, so that limit does not apply here — but if the parameters bar is made to wrap or stick, say that only a real phone can confirm it.

- [ ] **Step 10: Commit**

```bash
git add packages/reporting/src/types.ts packages/report-designer/src/schema.ts packages/bootstrap/src/index.ts apps/studio/src/api.ts apps/studio/src/reports/ReportParametersBar.tsx apps/studio/src/reports/ReportParametersBar.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts packages/reporting/src/seed/report-seeds.ts
git commit -m "feat(reports): report parameters can carry operator help text"
```

---

## Task 4: docs, full gate, and the landing changelog

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/reports.md`
- Modify: `apps/web/src/landing/changelog.json` (generated)

**Interfaces:** none.

**`AGENTS.md` §6 item 2 — CLI parity — needs no new command, and here is why.** The rule covers admin,
settings, danger-zone and maintenance features, because labs run headless and the CLI is the operator
surface. A per-patient clinical report is none of those; it is a clinician-facing document. More to the
point, the fix lands in `SEED_QUERIES` inside `@openldr/bootstrap`'s reach, so **every** surface already
gets it: the Fastify route, the CSV/PDF exports, the scheduler, and `packages/cli/src/report.ts` all run
`ctx.reporting`, never their own copy of the SQL. There is no generic "run any report by id" CLI command
today (`report.ts` wires only `r-amr-glass-ris`, at line 66), and adding one to satisfy this rule would
be a new feature nobody asked for — §4 forbids that. If the operator later wants headless clinical
report printing, that is the bulk-print slice, which is where it belongs.

**Honest scope note on `AGENTS.md` §6 item 3.** It asks for docs in en, fr and pt. The in-app docs tree holds **only** `apps/studio/src/docs/0.1.0/en/`, and the web docs tree (`apps/web/src/docs/0.1.0/`) is also English-only and has **no reports page at all**. So the translated surface for this slice is the i18n string added in Task 3, which is enforced by `parity.test.ts`. Do not create fr/pt doc trees or a new web docs page here — that is a docs-infrastructure slice, not this one. Report the deviation rather than papering over it.

- [ ] **Step 1: Document what the field accepts**

`apps/studio/src/docs/0.1.0/en/reports.md` follows a fixed page template — `Outcome`, `Before you
begin`, `Steps`, `Expected result`, `Troubleshooting`, `Advanced web usage`, `Related guides`. **Do not
add a new top-level or `###` section**; `validation.test.ts` checks the page shape. Add to the existing
sections instead.

Add one bullet to **`## Advanced web usage`**, after the bullet about filters coming from the
template's parameters:

```markdown
- The **Clinical Microbiology Report** takes the **lab number** as its Request ID — the number on the request form and the specimen label, as the LIS sends it (for example `TZDISATDS0013538`). A laboratory system usually splits one microbiology result into several orders under that one lab number: the culture that grew the organism is one order, the susceptibility panel another. The report reads all of them, so the organism and its susceptibilities print on one page. A single order id also works if you have one.
```

Add two bullets to **`## Troubleshooting`**, after the "The result is empty" bullet:

```markdown
- **"no data for this report request" on the Clinical Microbiology Report:** the lab number carries no microbiology. A chemistry or serology request has no organism, and the report is refused rather than printed empty — a microbiology report with no organism reads like a negative culture. Check the request's panels in **Query** before assuming a fault.
- **A microbiology report prints an organism but no susceptibilities:** that is a valid result. The culture grew something and no sensitivity testing was done on it. The organism band is the finding.
```

- [ ] **Step 2: Verify the docs page still builds and the anchor is reachable**

```bash
pnpm --filter openldr-studio test -- registry.test.ts validation.test.ts
```

Expected: PASS. `validation.test.ts` catches a malformed heading or a broken internal link.

- [ ] **Step 3: Run the full gate**

```bash
pnpm turbo run typecheck test --force --continue
```

Expected: all packages PASS. **Never pipe this through `tail`.** On failure, grep the output for `Test timed out` first — a gate failure is usually a timeout, not a regression. Re-run the named package alone before blaming a change.

- [ ] **Step 4: Render the PDF and look at it — the step the tests cannot replace**

The tests exercise SQL and the refusal path. They do **not** prove the page reads correctly. With the API running:

```bash
curl -s -o micro-split.pdf "http://127.0.0.1:3000/api/reports/r-clinical-micro.pdf?request=TZDISATDS0013538"
```

Open it and confirm four things: the organism band names *Shigella flexneri* (not a code), the
susceptibility table lists the four agents, `Panel` shows a single value that is not clipped, and the
barcode caption reads the lab number.

Then a culture-only lab number, which must render rather than refuse:

```bash
curl -s -o micro-culture.pdf "http://127.0.0.1:3000/api/reports/r-clinical-micro.pdf?request=TZDISATDS0012061"
```

And the case that started this, which must now refuse with `RP0005` and produce no PDF:

```bash
curl -s "http://127.0.0.1:3000/api/reports/r-clinical-micro.pdf?request=TZDISATDS0010015"
```

⚠ Use `127.0.0.1`, never `localhost` — a stored connector or client resolving to `::1` produces a bare
`ECONNRESET` that looks like a server bug.

- [ ] **Step 5: Merge to local `main`**

Work merges to local `main` first, then syncs to origin. Confirm the origin SHA after pushing. Do not open a PR unless asked.

- [ ] **Step 6: Regenerate and commit the landing changelog**

Run this **after** merging to `main` — the generator reads git history and cannot see commits that are not there yet.

```bash
pnpm make:changelog
```

```bash
git add apps/web/src/landing/changelog.json && git commit -m "chore(web): regenerate the landing changelog"
```

It reads a rolling window of the last 400 commits and publishes only `feat`/`fix`/`perf`, so the two
fixes and one feat from Tasks 1–3 appear. Do **not** run `pnpm gallery:screenshots` — that is a heavy
Playwright capture belonging to a release pass, not this slice.

---

## Verification summary — what is proven and what is not

| Claim | Proven by | Layer it does NOT cover |
|---|---|---|
| Both queries accept a lab number and an order id | `report-seeds.test.ts` shape pins + both live tests | Nothing about the rendered page |
| The header returns exactly one row across orders | `clinical-micro-header-live.test.ts`, real Postgres | Behaviour on MSSQL/MySQL — no live harness exists for either |
| Microscopy and EQA rows stay out of the table | `clinical-micro-ast-live.test.ts` | Whether the live warehouse holds a shape neither fixture models |
| A chemistry lab number renders no PDF | header live test returns 0 rows + `report-seeds.test.ts:261` pinning the `hdr` gate | The end-to-end 404 — assert it in Step 4 by hand |
| Help text reaches the studio | `ReportParametersBar.test.tsx` + `parity.test.ts` | Whether the tooltip is legible on a real phone |

**HONEST NON-PROOF — three gaps, stated rather than hidden:**

1. **MSSQL and MySQL are shape-tested only.** The regex pins prove the strings contain the right
   clauses. Nothing executes them. The rewrite drops `GROUP BY` in favour of `from spec`, which is
   valid in all three dialects, but "valid" here is reasoning, not a test run.
2. **pg-mem cannot substitute for the live tests.** It has no correlated-subquery support and a stable
   scan order, so it can neither execute these queries nor demonstrate a fold that fans out
   (`AGENTS.md` §7). A hermetic `pnpm test` **skips** both live files. If `TARGET_DATABASE_URL` is
   unset, this plan has verified almost nothing — a skipped run is not a pass.
3. **The `panel` tiebreaker is untested against the ambiguous case.** Ten real lab numbers have two
   organism-bearing orders. The fixture models one. The pick is deterministic per dataset, not
   clinically meaningful, and no test asserts which of two it lands on because there is no correct
   answer to assert.
