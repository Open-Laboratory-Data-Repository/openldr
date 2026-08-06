# Clinical Report — Performing Laboratory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the Clinical Microbiology Report prints which laboratory performed the test and where that
laboratory is.

**Architecture:** `q-clinical-micro-header` gains two CTEs that resolve
`diagnostic_reports.performer` (a facility **code**) through the `facility_map` warehouse dimension,
falling back to the wire display and then the bare code; location falls back from `facility_map` to
the ingest-written `facilities` table. The two resulting columns bind as pairs 9 and 10 of the
already-shipped `hdr` keyvalue panel on `rt-clinical-micro`.

**Tech Stack:** TypeScript, Kysely, Vitest, pdfkit (via `@openldr/report-designer`), Postgres +
MSSQL + MySQL dialect variants maintained in parallel.

**Spec:** `docs/superpowers/specs/2026-08-05-clinical-report-performing-lab-design.md`

## Global Constraints

- **All three dialect variants must stay in step.** `packages/reporting/src/seed/report-seeds.ts`
  carries one SQL string per dialect (`postgres`, `mssql`, `mysql`). Every SQL change lands in all
  three. `report-seeds.test.ts` iterates `Object.entries(q().sql)` and will fail on any divergence.
- **No cross-database joins.** `facility_registry` and `term_mappings` are in the INTERNAL db
  (`openldr`); everything this plan touches is in the EXTERNAL warehouse (`openldr_target`).
- **`CONCAT_WS` is forbidden** — SQL Server 2017 is the documented floor (`docker-compose.yml`), and
  it keeps `''` while skipping NULL. Use the per-dialect operators in Task 1.
- **Never match a facility on `performer_display`.** Five DISA codes share the display `Aga Khan`.
  The join key is always `performer` (the code).
- **Test gate:** `pnpm turbo run typecheck test --force --concurrency=4` must be 67/67. Use
  `--concurrency=4`; 6 causes pnpm bin-link races on this box.
- ⛔ **Never pipe turbo through `tail`** — you get tail's exit code. Redirect to a log, echo `$?`.
- ⛔ **Never `git add -A`** — this working directory is shared with concurrent sessions. Exact paths
  only.
- ⛔ **Never add a `Co-Authored-By` trailer.**
- **Branch:** all work lands on `slice/clinical-report-performing-lab`, which already exists and
  already holds the spec commit `667917d2`. Do not push.

---

### Task 1: The header query resolves the performing laboratory

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:1771-1813` (the `q-clinical-micro-header`
  entry — all three of `sql.postgres`, `sql.mssql`, `sql.mysql`)
- Test: `packages/reporting/src/seed/report-seeds.test.ts` (append a new `describe` block at the end
  of the file)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: two new result columns on `q-clinical-micro-header`, both `string | null`:
  - `performing_lab` — the laboratory name
  - `lab_location` — `"district, region"`, or one of them alone, or `''`

  Task 3 binds these two keys. The names are exact and case-sensitive; `report-seeds.test.ts`'s
  existing `projects only keys the header query actually selects` test asserts a design's
  `boundColumns[].key` appears as `as <key>` in the postgres SQL, so a rename here breaks Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `packages/reporting/src/seed/report-seeds.test.ts`:

```ts
// The report never said which laboratory performed the test. `performer` is the facility CODE
// (BAMAA) and `performer_display` the human name (Aga Khan) — five DISA codes share that one
// display, so the join keys on the code and the DISPLAY is only ever a fallback for printing.
describe('SEED_QUERIES — q-clinical-micro-header names the performing laboratory', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-clinical-micro-header')!;

  it('selects performing_lab and lab_location in every dialect', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not select performing_lab`).toMatch(/as performing_lab\b/);
      expect(sql, `${dialect} does not select lab_location`).toMatch(/as lab_location\b/);
    }
  });

  it('falls back name -> display -> code, so an unmapped facility never prints a bare code', () => {
    // The three-level ladder is the whole point: performer_display is itself 30-char truncated
    // upstream, but "Ocean Road Cancer Institute (O" is still readable and "BALAB" is not.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the three-level name fallback`)
        .toContain('coalesce(fm.name, fo.performer_display, fo.performer) as performing_lab');
    }
  });

  it('joins facility_map on the CODE, never on the human display', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not join facility_map on the code`)
        .toMatch(/fm\.source_code\s*=\s*fo\.performer\b/);
      expect(sql, `${dialect} matches on the display — five facilities share the string "Aga Khan"`)
        .not.toMatch(/fm\.source_code\s*=\s*fo\.performer_display/);
    }
  });

  it('guards the facility_map join against a NULL source_system', () => {
    // resolveObservedFacilities normalises NULL source_system to '' when building facility_map,
    // and relational-writer.ts documents having written NULL into every row for months. A plain
    // equality join drops those rows silently, because NULL = NULL is false.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the NULL source_system guard`)
        .toMatch(/fm\.source_system\s*=\s*coalesce\(fo\.source_system, ''\)/);
    }
  });

  it('joins facilities on BOTH source_system and code — the fan-out guard', () => {
    // `facilities` has no uniqueness constraint on (source_system, facility_code). This query
    // returns ONE row that the design binds; a duplicate would fan it out to two and the keyvalue
    // panel would silently render the first.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not scope the facilities join by feed`)
        .toMatch(/fa\.source_system\s*=\s*fo\.source_system\s+and\s+fa\.facility_code\s*=\s*fo\.performer/);
    }
  });

  it('prefers the curated facility_map location over the ingested one', () => {
    // One measured facilities row (BAGAE) carries a street address and a PO box where a region and
    // district belong. It is the one facility that IS mapped, so this order is what keeps a PO box
    // off a clinical report.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the district preference`)
        .toContain('coalesce(fm.district, fa.district) as district');
      expect(sql, `${dialect} lost the region preference`)
        .toContain('coalesce(fm.region, fa.region) as region');
    }
  });

  it('collapses reports to one row per specimen before joining — the fan-out guard', () => {
    // Reports are per-ORDER, not per-specimen. Measured: 0 of 3713 specimens disagree on performer
    // and 0 of 88 codes carry two displays, so the three min()s cannot splice one facility's code
    // onto another's name.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the facility_of CTE`).toContain('facility_of as (');
      expect(sql, `${dialect} does not fold reports per specimen`)
        .toMatch(/min\(performer\) as performer[\s\S]*group by specimen_id/);
      expect(sql, `${dialect} joins diagnostic_reports directly and will fan out`)
        .not.toMatch(/join diagnostic_reports [a-z]+ on/);
    }
  });

  it('reaches the facility through the same max(specimen_id) subselect, not through s.id', () => {
    // `s` is LEFT joined, so a specimen_id present in lab_results but absent from `specimens`
    // leaves s.id NULL and would silently drop the facility.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} hangs the facility off the specimens join`)
        .toContain('left join facility f on f.specimen_id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)');
    }
  });

  it('composes the location with each dialect’s own concatenation', () => {
    // CONCAT_WS would say this once for all three, but it arrived in SQL Server 2017 — exactly the
    // floor docker-compose.yml documents — and it keeps '' while skipping NULL.
    expect(q().sql.postgres).toContain("f.district || ', ' || f.region");
    expect(q().sql.mssql).toContain("f.district + ', ' + f.region");
    expect(q().sql.mysql).toContain("concat(f.district, ', ', f.region)");
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} smuggled in CONCAT_WS`).not.toMatch(/concat_ws/i);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "names the performing laboratory"
```

Expected: FAIL — 9 failing assertions, the first reporting
`postgres does not select performing_lab`.

- [ ] **Step 3: Rewrite all three dialect variants**

Replace the whole `sql: { postgres: ..., mssql: ..., mysql: ... }` object of the
`q-clinical-micro-header` entry (currently `report-seeds.ts:1771-1813`) with the following. The three
strings are identical except for the concatenation operator on the `lab_location` line.

Also replace the comment block above the entry (`report-seeds.ts:1760-1765`) — keep its existing
`request_id` and `max(...)` notes and add the facility notes — with:

```ts
  // Patient/specimen header for the same request. Returns ONE row; the design binds it several
  // times with different column projections (the panel strip, the isolate, the barcode, the QR).
  // ⚠ `lab_results.request_id` references the ServiceRequest **id**, so `lab_requests` joins on
  // `id` — NOT on its own `request_id` column, which is the site's lab number. Getting that
  // backwards returns an empty header and looks exactly like a binding failure.
  // `max(...)` rather than `limit 1`/`top 1`: portable across all three dialects unchanged.
  //
  // ⛔ THE PERFORMING LABORATORY. `diagnostic_reports.performer` is the facility CODE (`BAMAA`);
  // `performer_display` is the human name (`Aga Khan`). Resolution goes through `facility_map`, the
  // external warehouse dimension — `facility_registry` is in the INTERNAL db and CANNOT be joined
  // from here (the constraint `011_terminology_codes` documents and `012_facility_map` exists to
  // work around).
  //  - ⛔ NEVER key on `performer_display`: five DISA codes (BAMAA/BBFAF/CDABE/EAFAE/NDFAM) all
  //    display "Aga Khan", in five different districts. FHIR says `Reference.display` must never be
  //    used for matching, and keying on it once already collapsed five laboratories into one.
  //  - name falls back CODE-resolved -> wire display -> bare code. `performer_display` is itself
  //    30-char truncated upstream by DISA ("Ocean Road Cancer Institute (O"), so the fallback is
  //    readable but clipped; only a registry mapping produces the full name.
  //  - location falls back `facility_map` -> `facilities`. `facility_map` is rebuilt only by a
  //    MANUAL publish while ingest runs continuously, so a site first seen since the last publish
  //    has no `facility_map` row at all; `facilities` is written at ingest and is always current.
  //    Preferring `facility_map` also keeps one measured bad row off the page — BAGAE's
  //    `facilities` row carries a street address and a PO box where region/district belong.
  //  - ⛔ `coalesce(fo.source_system, '')` on the facility_map side only: the resolver normalises a
  //    NULL source_system to '' when building the dimension, and `NULL = NULL` is false, so a plain
  //    equality join drops exactly the rows `relational-writer.ts` says exist.
  //  - the `facility_of` CTE is the same per-specimen fold, for the same reason, as
  //    `q-amr-facility-summary`: reports are per-ORDER, so joining `diagnostic_reports` directly
  //    would fan this one-row header out. Measured: 0 of 3713 specimens disagree on `performer` and
  //    0 of 88 codes carry two displays, so the three `min()`s cannot mix two facilities.
```

Then the SQL. **postgres:**

```sql
with facility_of as (
  select specimen_id,
    min(performer) as performer,
    min(performer_display) as performer_display,
    min(source_system) as source_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
),
facility as (
  select fo.specimen_id,
    coalesce(fm.name, fo.performer_display, fo.performer) as performing_lab,
    coalesce(fm.district, fa.district) as district,
    coalesce(fm.region, fa.region) as region
  from facility_of fo
  left join facility_map fm on fm.source_system = coalesce(fo.source_system, '') and fm.source_code = fo.performer
  left join facilities fa on fa.source_system = fo.source_system and fa.facility_code = fo.performer
)
select
  p.surname as patient_surname,
  p.firstname as patient_firstname,
  p.sex as sex,
  p.date_of_birth as dob,
  s.type_text as specimen,
  left(s.received_time, 10) as received,
  q.request_id as lab_number,
  q.panel_desc as panel,
  (select max(coalesce(o.text_value, o.coded_value)) from lab_results o
     where o.request_id = q.id and o.observation_code in ('634-6', 'ORGS')) as organism,
  f.performing_lab as performing_lab,
  case when f.district is not null and f.region is not null
       then f.district || ', ' || f.region
       else coalesce(f.district, f.region) end as lab_location
from lab_requests q
left join patients p on p.id = q.patient_id
left join specimens s on s.id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)
left join facility f on f.specimen_id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)
where q.id = {{param.request}}
```

**mssql:** byte-identical to the postgres string except the one `lab_location` line:

```sql
  case when f.district is not null and f.region is not null
       then f.district + ', ' + f.region
       else coalesce(f.district, f.region) end as lab_location
```

**mysql:** byte-identical to the postgres string except the one `lab_location` line:

```sql
  case when f.district is not null and f.region is not null
       then concat(f.district, ', ', f.region)
       else coalesce(f.district, f.region) end as lab_location
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts
```

Expected: PASS — the 9 new assertions plus every pre-existing `q-clinical-micro-header` and
`rt-clinical-micro` test. In particular `projects only keys the header query actually selects` must
still pass; it will fail if `as performing_lab` was written as a bare `f.performing_lab` with no
alias.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reporting): resolve the performing laboratory in the clinical header query"
```

---

### Task 2: Prove the SQL behaves, not just that it reads right

**Files:**
- Create: `packages/reporting/src/seed/clinical-micro-header-live.test.ts`

**Interfaces:**
- Consumes: `SEED_QUERIES` from `./report-seeds` — specifically
  `q-clinical-micro-header`'s `sql.postgres`, run verbatim.
- Produces: nothing consumed by later tasks.

**Why this task exists.** Every assertion in Task 1 is a *regex over a string*. They pin the shape
and kill specific mutations, but none of them can tell whether the query returns the right value —
a query can match every pattern and still return NULL for every row. The spec's §5 behaviours
(fallback ladder, location preference, the NULL-`source_system` guard, comma composition) are
semantic, so they need a real Postgres. This follows the established live-test convention:
`describe.skipIf(!process.env.TARGET_DATABASE_URL)`, provisioning its own throwaway database so it
never touches the shared dev warehouse. The default hermetic `pnpm test` skips it; the gate in Task 4
runs it, because `.env` sets `TARGET_DATABASE_URL`.

- [ ] **Step 1: Write the failing test**

Create `packages/reporting/src/seed/clinical-micro-header-live.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, externalMigrations } from '@openldr/db';
import { SEED_QUERIES } from './report-seeds';

// The performing-lab resolution is SEMANTIC — a fallback ladder, a join guard and a string
// composition. Task 1's tests are regexes over the SQL text and cannot distinguish "reads right"
// from "returns right": a query can match every pattern and still yield NULL for every row.
//
// Runs only when TARGET_DATABASE_URL points at a live Postgres (the migrated dev target DB); the
// default hermetic `pnpm test` skips it. It provisions its OWN throwaway database, so it never
// touches the shared dev warehouse — same pattern as external/reset-roundtrip-live.test.ts.
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

live('q-clinical-micro-header resolves the performing laboratory (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_perflab_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<Record<string, never>>;

  // `substituteParams` inlines a QUOTED STRING LITERAL, it does not bind a placeholder
  // (packages/dashboards/src/custom-query-run.ts). Mirror that exactly, or this test would prove
  // something the runtime never executes.
  const runFor = async (requestId: string): Promise<Record<string, unknown> | undefined> => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const text = raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'${requestId.replace(/'/g, "''")}'`);
    const res = await sql<Record<string, unknown>>.raw(text).execute(db);
    return res.rows[0];
  };

  // One request -> one lab_result -> one specimen -> one diagnostic_report naming `code`.
  const seedRequest = async (
    requestId: string, code: string, display: string | null, sourceSystem: string | null,
  ): Promise<void> => {
    const specimenId = `spec-${requestId}`;
    await db.insertInto('specimens' as never).values({
      id: specimenId, type_text: 'Blood', received_time: '2026-01-02T03:04:05Z',
    } as never).execute();
    await db.insertInto('lab_requests' as never).values({
      id: requestId, request_id: `LAB-${requestId}`, panel_desc: 'Culture',
    } as never).execute();
    await db.insertInto('lab_results' as never).values({
      id: `res-${requestId}`, request_id: requestId, specimen_id: specimenId,
      observation_code: '634-6', text_value: 'Klebsiella pneumoniae',
    } as never).execute();
    await db.insertInto('diagnostic_reports' as never).values({
      id: `dr-${requestId}`, specimen_id: specimenId, performer: code,
      performer_display: display, source_system: sourceSystem,
    } as never).execute();
  };

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString() }) }) });
    const up = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    expect(up.error).toBeUndefined();

    // MAPPED: facility_map resolves the name and the location.
    await db.insertInto('facility_map' as never).values({
      id: 'feed|MAPPED', source_system: 'feed', source_code: 'MAPPED',
      name: 'National Public Health Laboratory', region: 'Dar es Salaam', district: 'Ubungo',
      resolved_via: 'registry',
    } as never).execute();
    // ...and `facilities` disagrees, holding the address lines BAGAE really carries. The curated
    // row must win, or a PO box prints on a clinical report.
    await db.insertInto('facilities' as never).values({
      id: 'fa-mapped', facility_code: 'MAPPED', facility_name: 'NHLQATC', source_system: 'feed',
      region: '2448 Luthuli Street/Sokoine', district: 'P.O.Box 9083',
    } as never).execute();

    // UNMAPPED but located: facility_map row exists with name NULL (what an unmapped facility
    // actually looks like — not a missing row), location comes from `facilities`.
    await db.insertInto('facility_map' as never).values({
      id: 'feed|UNMAPPED', source_system: 'feed', source_code: 'UNMAPPED',
    } as never).execute();
    await db.insertInto('facilities' as never).values({
      id: 'fa-unmapped', facility_code: 'UNMAPPED', facility_name: 'Mnazi Mmoja',
      source_system: 'feed', region: 'Dar es Salaam', district: 'Ilala',
    } as never).execute();

    // REGION-ONLY: no district anywhere, so no stray comma may appear.
    await db.insertInto('facilities' as never).values({
      id: 'fa-regiononly', facility_code: 'REGIONONLY', facility_name: 'Korogwe',
      source_system: 'feed', region: 'Tanga',
    } as never).execute();

    // NULLFEED: the facility_map row was built with '' because the resolver folds NULL -> ''.
    await db.insertInto('facility_map' as never).values({
      id: '|NULLFEED', source_system: '', source_code: 'NULLFEED', name: 'Folded Feed Laboratory',
    } as never).execute();

    await seedRequest('req-mapped', 'MAPPED', 'NHLQATC', 'feed');
    await seedRequest('req-unmapped', 'UNMAPPED', 'Mnazi Mmoja', 'feed');
    await seedRequest('req-regiononly', 'REGIONONLY', 'Korogwe', 'feed');
    await seedRequest('req-nodisplay', 'NODISPLAY', null, 'feed');
    await seedRequest('req-nullfeed', 'NULLFEED', 'Wire Name', null);

    // A request whose specimen has NO diagnostic_report at all.
    await db.insertInto('specimens' as never).values({ id: 'spec-bare', type_text: 'Urine' } as never).execute();
    await db.insertInto('lab_requests' as never).values({
      id: 'req-bare', request_id: 'LAB-bare', panel_desc: 'Culture',
    } as never).execute();
    await db.insertInto('lab_results' as never).values({
      id: 'res-bare', request_id: 'req-bare', specimen_id: 'spec-bare', observation_code: '634-6',
    } as never).execute();
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
    await admin
      .query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName])
      .catch(() => undefined);
    await admin.query(`drop database if exists "${dbName}"`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it('prints the registry name for a MAPPED facility, not the wire acronym', async () => {
    const row = await runFor('req-mapped');
    expect(row?.performing_lab).toBe('National Public Health Laboratory');
  });

  it('prefers the curated location, keeping a PO box off the report', async () => {
    const row = await runFor('req-mapped');
    expect(row?.lab_location).toBe('Ubungo, Dar es Salaam');
  });

  it('falls back to the wire display for an UNMAPPED facility, and locates it from facilities', async () => {
    const row = await runFor('req-unmapped');
    expect(row?.performing_lab).toBe('Mnazi Mmoja');
    expect(row?.lab_location).toBe('Ilala, Dar es Salaam');
  });

  it('renders a region-only location with no stray comma', async () => {
    const row = await runFor('req-regiononly');
    expect(row?.lab_location).toBe('Tanga');
  });

  it('falls all the way back to the bare code rather than printing nothing', async () => {
    const row = await runFor('req-nodisplay');
    expect(row?.performing_lab).toBe('NODISPLAY');
    expect(row?.lab_location).toBeNull();
  });

  it('still resolves a report whose source_system is NULL', async () => {
    // The guard this pins: without coalesce(fo.source_system, ''), NULL = '' is false and this row
    // silently falls back to the wire display instead of resolving.
    const row = await runFor('req-nullfeed');
    expect(row?.performing_lab).toBe('Folded Feed Laboratory');
  });

  it('still returns the patient header when the specimen has no diagnostic report', async () => {
    const row = await runFor('req-bare');
    expect(row).toBeDefined();
    expect(row?.lab_number).toBe('LAB-bare');
    expect(row?.performing_lab).toBeNull();
    expect(row?.lab_location).toBeNull();
  });

  it('returns exactly ONE row — the design binds a single header row', async () => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const res = await sql<Record<string, unknown>>.raw(raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'req-mapped'`)).execute(db);
    expect(res.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

First confirm it is actually running rather than skipping — a silently skipped live test proves
nothing:

```bash
pnpm --filter @openldr/reporting test -- clinical-micro-header-live.test.ts --reporter=verbose
```

Expected: the suite RUNS (8 tests listed, not `skipped`). If every test shows as skipped,
`TARGET_DATABASE_URL` is not set in the shell — export it from `.env`
(`postgres://openldr:<pw>@127.0.0.1:5433/openldr_target`) and re-run before continuing.

If Task 1 is already complete these tests PASS on the first run. That is expected and fine — the
value is regression protection. To confirm they can actually fail, temporarily change
`coalesce(fm.name, fo.performer_display, fo.performer)` to `coalesce(fo.performer_display,
fo.performer)` in `sql.postgres`, re-run, and see
`expected 'NHLQATC' to be 'National Public Health Laboratory'`. Revert that edit before Step 3.

- [ ] **Step 3: Run the test to verify it passes**

```bash
pnpm --filter @openldr/reporting test -- clinical-micro-header-live.test.ts
```

Expected: PASS — 8 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/reporting/src/seed/clinical-micro-header-live.test.ts
git commit -m "test(reporting): prove the performing-lab fallback ladder against live Postgres"
```

---

### Task 3: The report prints it

**Files:**
- Modify: `packages/report-designer/src/render/index.ts:10` (widen the barrel — see Step 1)
- Modify: `packages/reporting/src/seed/report-seeds.ts:1990-2002` (the `hdr` element's
  `boundColumns` array on `rt-clinical-micro`)
- Test: `packages/reporting/src/seed/report-seeds.test.ts` (extend the existing
  `SEED_DESIGNS — rt-clinical-micro uses real keyvalue panels` describe block)

**Interfaces:**
- Consumes: `performing_lab` and `lab_location` from Task 1.
- Produces: nothing consumed by later tasks.

**Geometry.** The `hdr` panel is `{ x: 40, y: 152, w: 700, h: 84 }`, `layout: 'inline'`,
`panelColumns: 2`, no title. From `pairRects`: pairs start at `y = 152 + KV_PAD_Y(4) = 156` and step
by `KV_INLINE_H` = 14. Ten pairs fill five rows, the last occupying **212 → 226**, inside the box
bottom of **236**. Nothing below the panel moves — `org` stays at y=244. **A sixth row would land at
226 → 240 and be silently `doc.clip()`ped by the drawer**, which is why Step 1 pins the fit.

- [ ] **Step 1: Export `pairRects` across the package boundary, then write the failing test**

`pairRects` and `PairBox` are exported from `render/draw.ts` but stop at the render barrel, and
`@openldr/report-designer`'s `exports` map is `{ ".": "./src/index.ts" }` only — so a deep import
cannot resolve and the test cannot reach it as things stand. Widen the barrel.

In `packages/report-designer/src/render/index.ts`, beside the existing
`export { resolveDesignTables, type RunQuery } from './resolve';` (line 10), add:

```ts
// Widened to the package boundary for `@openldr/reporting`'s seed tests: a seeded design's keyvalue
// panel has a FIXED box, and pairs past its bottom are clipped by the drawer rather than
// overflowing — so a panel that has run out of room fails silently at render time. Exporting the
// geometry lets the seed that owns the panel assert its own capacity.
export { pairRects, type PairBox } from './draw';
```

Then add this import to the top of `packages/reporting/src/seed/report-seeds.test.ts` (alongside the
existing imports):

```ts
import { pairRects } from '@openldr/report-designer';
```

Then add these two tests inside the existing
`describe('SEED_DESIGNS — rt-clinical-micro uses real keyvalue panels', ...)` block:

```ts
  it('names the performing laboratory and where it is', () => {
    // The report never said which lab produced the result. On a national instance the letterhead is
    // the MINISTRY, so nothing else on the page supplies it — and five DISA codes share the display
    // "Aga Khan", so the name alone does not identify a laboratory either.
    const keys = (el('hdr').boundColumns ?? []).map((c) => c.key);
    expect(keys).toContain('performing_lab');
    expect(keys).toContain('lab_location');
  });

  it('fits every header pair inside the panel box', () => {
    // ⛔ pairRects returns boxes past the bottom of the box and the drawer clips them, so an
    // eleventh field does not overflow — it VANISHES, with no error. This is the only thing that
    // turns that into a failing test. Ten pairs end at y=226 inside a box ending at 236; pair
    // eleven starts a sixth row at 226 and ends at 240. Whoever adds field eleven must grow `h`
    // and push `org` (y=244) and everything below it down.
    const hdr = el('hdr');
    const n = (hdr.boundColumns ?? []).length;
    const pairs = pairRects(hdr.rect, n, 'inline', hdr.panelColumns ?? 1, !!(hdr.text ?? '').trim());
    const last = pairs[n - 1];
    expect(
      last.y + last.h,
      `pair ${n} falls outside the panel and will be silently clipped`,
    ).toBeLessThanOrEqual(hdr.rect.y + hdr.rect.h);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "rt-clinical-micro uses real keyvalue panels"
```

Expected: FAIL on `names the performing laboratory and where it is` with
`expected [ 'patient_surname', ... ] to contain 'performing_lab'`. The fit test PASSES at this point
(eight pairs fit); it is the guard that must keep passing after Step 3.

- [ ] **Step 3: Bind the two pairs**

In `report-seeds.ts`, append two entries to the `hdr` element's `boundColumns` array — **after**
`{ key: 'panel', ... }`, so they land as pairs 9 and 10 and therefore as row five, left then right.
Update the element's comment to record that the panel is now full:

```ts
      // Band 2 of the reference: a label→value metadata strip, NOT a one-row table. It was a table
      // with a header row until S4 gave the vocabulary a `keyvalue` panel; the column labels sat
      // above the values in a tinted band, which reads as a spreadsheet fragment rather than a
      // patient header. Two pair columns, so the ten facts fill five lines instead of ten.
      // ⛔ THIS PANEL IS NOW FULL. Pairs flow across then down at KV_INLINE_H (14) from y+4, so ten
      // pairs end at y=226 inside a box ending at 236 — and an ELEVENTH lands at 240 and is
      // silently clipped by the drawer, not overflowed. Field eleven must grow `h` and push `org`
      // (y=244) and everything below it down. `report-seeds.test.ts` fails if it does not.
      { id: 'hdr', kind: 'keyvalue', name: 'Patient & specimen', rect: { x: 40, y: 152, w: 700, h: 84 },
        layout: 'inline', panelColumns: 2,
        dataSource: { kind: 'custom-query', queryId: 'q-clinical-micro-header' },
        boundColumns: [
          { key: 'patient_surname', label: 'Surname', kind: 'label' },
          { key: 'specimen', label: 'Specimen', kind: 'label' },
          { key: 'patient_firstname', label: 'First name', kind: 'label' },
          { key: 'received', label: 'Received', kind: 'label' },
          { key: 'sex', label: 'Sex', kind: 'label' },
          { key: 'lab_number', label: 'Lab number', kind: 'label' },
          { key: 'dob', label: 'DOB', kind: 'label' },
          { key: 'panel', label: 'Panel', kind: 'label' },
          { key: 'performing_lab', label: 'Performing lab', kind: 'label' },
          { key: 'lab_location', label: 'Lab location', kind: 'label' },
        ] },
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts
```

Expected: PASS — the whole file. Three pre-existing tests are load-bearing here and must still be
green: `projects only keys the header query actually selects` (proves both new keys really are
selected by Task 1's SQL), `fits every header pair inside the panel box`, and `leaves no element
overprinting another` (the panel rect did not change, so nothing new collides).

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/index.ts packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reporting): print the performing laboratory on the clinical micro report"
```

---

### Task 4: Gate, render a real PDF, look at it, merge

**Files:** none modified — this task is verification and integration.

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `main` advanced by a `--no-ff` merge commit.

⛔ **A passing test proves the code is merged, not that the running instance does this.** The spec
requires an actual rendered PDF, inspected. Do not report the field as working without it.

- [ ] **Step 1: Refresh the reports dimension**

`facility_map` is rebuilt only by a publish. Skipping this makes the mapped facility render its old
name and looks exactly like a broken join.

```bash
pnpm --filter @openldr/cli build && node packages/cli/dist/index.js facilities publish --apply
```

Expected: a summary line reporting `resolved: 1` and `written: 88`.

- [ ] **Step 2: Re-seed so the running instance picks up the new SQL and design**

`SEED_QUERIES` is managed-overwrite, so a stored query whose SQL drifted is refreshed; designs are
refreshed when they drift from the shipped definition. Restart the dev API to trigger seeding, or run
the seeding path directly. Confirm the stored query actually changed:

```bash
docker exec openldr_ce-postgres-1 psql -U openldr -d openldr -t -c "select position('performing_lab' in sql) from custom_queries where id = 'q-clinical-micro-header';"
```

Expected: a non-zero position. If it returns `0`, the seed did not run — restart the dev API and
re-check before rendering, or the PDF will be rendered from the OLD SQL and the field will be blank.

- [ ] **Step 3: Render both fallback paths**

These two request ids were measured on the live warehouse and exercise the two paths that matter.

```bash
node packages/cli/dist/index.js report run r-clinical-micro --format pdf --param request=TZDISATDS0010107-obr2 --out mapped.pdf
```

Expected: `wrote mapped.pdf (NNNNN bytes)`. This request is served by `BAGAE` — the **mapped**
facility.

```bash
node packages/cli/dist/index.js report run r-clinical-micro --format pdf --param request=TZDISATDS0010015-obr2 --out unmapped.pdf
```

Expected: `wrote unmapped.pdf (NNNNN bytes)`. This request is served by `BAMAD` — **unmapped**, but
located by `facilities`.

- [ ] **Step 4: Look at both PDFs**

Use the `Read` tool on `mapped.pdf` with `pages: "1"`, then on `unmapped.pdf`. The Read tool renders
PDF pages visually — do NOT try to open a `file://` PDF in the browser pane (it will not rasterise
it) and do NOT settle for inflating the content streams, which proves text exists but not that it is
legible or correctly placed.

Confirm by eye, on `mapped.pdf`:
- row five of the patient panel reads `Performing lab  National Public Health Laboratory` and
  `Lab location  Ubungo, Dar es Salaam`
- **not** `NHLQATC`, and **not** a PO box
- the values sit on one line each, not wrapped or ellipsized mid-word
- `ORGANISM ISOLATED` still starts below the panel with clear space — nothing overprints

and on `unmapped.pdf`:
- `Performing lab  Mnazi Mmoja` and `Lab location  Ilala, Dar es Salaam`

If either value is blank, the stored query is stale — return to Step 2.

- [ ] **Step 5: Run the full gate**

⛔ Never pipe turbo through `tail` — the shell reports tail's exit code, not turbo's.

```bash
pnpm turbo run typecheck test --force --concurrency=4 > gate.log 2>&1; echo "EXIT=$?"; grep -E "Tasks:|Failed:" gate.log
```

Expected: `EXIT=0` and `Tasks: 67 successful, 67 total`.

If a package fails, read WHICH error before concluding anything. A gate failure at ~1.0× a default
timeout is MARGINAL, not flaky — `grep "Test timed out" gate.log` and re-run that package alone
before blaming it on the box.

- [ ] **Step 6: Merge to LOCAL main**

`main` moves under you — a concurrent session shares this working directory. Capture the branch head
first, merge, then prove the merge tree is byte-identical to the gated branch head.

```bash
git rev-parse slice/clinical-report-performing-lab > /tmp/gated-head
git checkout main && git merge --no-ff slice/clinical-report-performing-lab -m "Merge: name the performing laboratory on the clinical microbiology report"
git diff --stat $(cat /tmp/gated-head) HEAD
```

Expected: **empty output** from the final `git diff --stat`. Any output means `main` moved and the
merge produced a tree that was never gated — re-run Step 5 on the merge commit before going further.

Do **not** push.

- [ ] **Step 7: Clean up the scratch PDFs**

```bash
rm -f mapped.pdf unmapped.pdf gate.log
```

---

## Self-Review

**Spec coverage.** Every section maps to a task:

| Spec section | Task |
|---|---|
| §3.1 the query, all three dialects | Task 1, Steps 3–4 |
| §3.2 resolution through `facility_map`, never the display | Task 1 tests 3, 7 |
| §3.3 name ladder / location preference / `coalesce` guard / fan-out guard | Task 1 tests 2, 4, 5, 6; proven semantically in Task 2 |
| §3.4 placement, geometry, panel is full | Task 3 |
| §4 what the operator sees | Task 4, Steps 3–4 (both rows of the table rendered and inspected) |
| §5 every testing bullet | Task 1 (shape), Task 2 (behaviour), Task 3 (`pairRects` capacity), Task 4 (PDF, parity via the gate) |
| §6 out of scope | nothing in this plan touches the registry, charts, or the seeded design beyond `hdr` |

**Type consistency.** `performing_lab` and `lab_location` are used identically in Task 1 (SQL
aliases), Task 2 (result keys) and Task 3 (`boundColumns[].key`). `pairRects(box, n, layout,
panelColumns, hasTitle)` matches its signature in `packages/report-designer/src/render/draw.ts:309`.

**Known residual risk, deliberately not engineered around** (spec §3.3): `facilities` has no
uniqueness constraint on `(source_system, facility_code)`. Today the only duplicate `facility_code`
is NULL on two `seed` rows, so the one-row header cannot fan out. If the header ever renders the
wrong facility, check that first.
