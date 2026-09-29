# v1 Request Facts (CE side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find where DISA keeps each new request fact, then make CE store those facts: typed columns on `lab_requests` and `diagnostic_reports`, and a generic `lab_request_attributes` table filled from the same `ServiceRequest`.

**Architecture:** Task 1 is research only and stops for the operator. Tasks 2-5 are CE and do not depend on its outcome: they accept the facts whether or not a source sends them. A migration adds the columns and the attributes table. The projection gains a second function, `projectOwnedRows`, for rows a resource owns in other tables; the writer and `deleteById` call it beside `projectResource`, so every existing projection stays unchanged. The cdr-toolchain side is a separate plan, written after Task 1 names each DISA source.

**Tech Stack:** TypeScript, Kysely, pg-mem, vitest, pnpm/turbo; SQL Server and MySQL acceptance scripts.

**Spec:** `docs/superpowers/specs/2026-09-29-v1-request-facts-design.md`

## Global Constraints

- One shared model: no table or column is named for, or keyed by, a country.
- Warehouse migration number: `019`. All new columns nullable, on Postgres, SQL Server and MySQL.
- `lab_requests` new columns: `obr_set_id` (int), `analysis_at` (text), `point_of_care` (text), `request_type` (text), `registered_by` (text), `tested_by` (text), `requester_practitioner` (text), `age_years` (int), `age_days` (int), `clinical_info` (text), `analyzer_code` (text), `rejection_code` (text), `rejection_reason` (text).
- `diagnostic_reports` new columns: `section_code` (text), `authorised_by` (text). Ruling in this plan: they live on the report, not the request, because a report projection must not write a row its `ServiceRequest` owns.
- `lab_request_attributes`: `id` (key), `lab_request_id` (key, indexed), `system` (key), `code` (key), `value_text` (text), `value_number` (float), `value_datetime` (text), `value_boolean` (boolean), `source_system`, `plugin_id`, `plugin_version`, `batch_id` (text), `created_at` (timestamp default now). Key and index columns use `keyType`, never `textType`.
- Wire slots CE reads (spec 6): section `DiagnosticReport.category` system `http://terminology.hl7.org/CodeSystem/v2-0074`; authorised by `DiagnosticReport.resultsInterpreter[0].display`; point of care `ServiceRequest.locationCode[0].text`; clinical info `ServiceRequest.note[0].text`; doctor: contained `PractitionerRole.practitioner.display` via `requester` `#` reference; OBR set: `ServiceRequest.identifier` with system `urn:openldr:obr-set-id`; extensions `urn:openldr:ext:analysis-time` (valueDateTime), `registered-by` (valueString), `tested-by` (valueString), `request-type` (valueCode), `age-at-request` (sub-extensions `years`, `days`, valueInteger), `analyzer` (valueCode), `rejection` (sub-extensions `code` valueCode, `reason` valueString), `request-attribute` (repeating; sub-extensions `code` valueCoding, `value` one of valueString/valueDecimal/valueDateTime/valueBoolean).
- An absent fact projects to NULL. An unknown extension is ignored. A fact is never filled with a constant.
- Attribute vocabulary system: `urn:openldr:cs:request-attribute`, shipped as a CodeSystem file and imported with `openldr terminology import resource <file>`, never seeded by a migration.
- Data exposure: hide `lab_requests.clinical_info` and `lab_request_attributes.value_text` by default and give both the PII badge; also hide the attributes table's `id`, `lab_request_id`, `plugin_id`, `plugin_version`, `batch_id`.
- New writing has no em dashes and no emoji. Never a `Co-Authored-By` trailer.
- Work in `D:/Projects/Repositories/openldr_ce/.claude/worktrees/v1-request-facts`, branch `spec/v1-request-facts`. Prefix every command with `cd` to it and check `git branch --show-current` before committing.
- Tests: `pnpm --filter <pkg> exec vitest run <path>`. Typecheck: redirect, then `echo "exit=$?"`. Never read an exit code through a pipe.

---

### Task 1: Research the DISA source of each typed fact (report only, then STOP)

**Files:**
- Create: `docs/superpowers/specs/2026-09-29-v1-request-facts-disa-sources.md`

No code changes. This task can change what the cdr-toolchain plan builds, so it ends by reporting to the operator.

- [ ] **Step 1: List what cdr-toolchain already reads**

For each typed fact, record whether cdr-toolchain already reads it and from where. Start in `D:/Projects/Repositories/cdr-toolchain`:
- `apps/cli/src/export/types.ts` (`V2LabRequest`), `apps/cli/src/export/v2-transform.ts` (how each V2 field is filled),
- `apps/cli/src/export/v1-transform.ts` (the v1 export: the audit-trail extraction near line 113 gives RegisteredBy, AnalysisDateTime, TestedBy, AuthorisedBy; lines 279, 302, 327, 330 write constants),
- `packages/disalab/src/lib/Forms/specimenrecpt.ts` and `packages/disalab/src/lib/DisalabData/*.ts` (the decoders).

Facts: obr_set_id, analysis_at, point_of_care, section_code, request_type, registered_by, tested_by, authorised_by, requester_practitioner, age_years, age_days, clinical_info, analyzer_code, rejection_code, rejection_reason; and the attributes therapy, ordering-notes, collection-volume, cost-units, encrypted-patient-id, vendor-code, deceased, newborn, repeated.

- [ ] **Step 2: Compare a sample with v1**

For every fact with a candidate source that cdr-toolchain does not already grade, compare 50 TDS labs against v1 `OpenLDRData.dbo.Requests` (`RequestID = 'TZDISA' + LabNo`) on the local `sqlserver` container. Use the deterministic spread `abs(checksum([LabNo])) % 500 = 0`, not `--limit`. Record match / mismatch / only-DISA / only-v1 per fact. Count an empty string as empty.

The compare gate already grades some of these (`apps/cli/src/compare/v2-mapping.ts`); where it does, run `compare-batch` on the same sample and quote its figures instead of writing a new comparison.

- [ ] **Step 3: Write the findings**

`docs/superpowers/specs/2026-09-29-v1-request-facts-disa-sources.md`: one row per fact with: DISA source (file:line), already in the V2 payload (yes/no), sample result, and a verdict: `source found`, `source found, differs from v1` (with examples), or `no source found` (ships empty). Short sentences, no em dashes.

- [ ] **Step 4: Commit and STOP**

```bash
git add docs/superpowers/specs/2026-09-29-v1-request-facts-disa-sources.md
git commit -m "docs(spec): where DISA keeps each v1 request fact"
```

Report the verdict counts to the operator and wait. Tasks 2-5 may proceed, because they do not depend on the findings; the cdr-toolchain plan waits for the operator.

---

### Task 2: Migration 019, types, column lists, data exposure

**Files:**
- Modify: `packages/db/src/migrations/external/dialect.ts` (add `intType`)
- Create: `packages/db/src/migrations/external/019_v1_request_facts.ts`
- Create: `packages/db/src/migrations/external/019_v1_request_facts.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/schema/external.ts`
- Modify: `packages/dashboards/src/models/registry.ts` (`HARDCODED_DENY_UNION`, `PII_COLUMNS`)
- Test: `packages/db/src/migrations/external/dialect.test.ts` (append)

**Interfaces:**
- Produces: `intType(engine)`; the columns and table in Global Constraints; `LabRequestAttributesTable` in `ExternalSchema` as `lab_request_attributes`; `EXTERNAL_TABLE_COLUMNS.lab_request_attributes`.

- [ ] **Step 1: Check 019 is free**

`ls packages/db/src/migrations/external | grep ^019` must print nothing, and `git branch -a --no-merged main` must list no branch adding a `019_` file. Otherwise STOP and report.

- [ ] **Step 2: Write the failing tests**

Append to `dialect.test.ts`:

```ts
describe('intType', () => {
  it('is a 32-bit integer on every engine', () => {
    expect(intType('postgres')).toBe('integer');
    expect(intType('mssql')).toBe('int');
    expect(intType('mysql')).toBe('int');
  });
});
```

(import `intType` beside the file's existing imports; match its existing `describe` style.)

Create `019_v1_request_facts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { sql } from 'kysely';

describe('019_v1_request_facts', () => {
  it('round-trips the new lab_requests facts', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_requests (id, request_id, obr_set_id, analysis_at, point_of_care, request_type,
        registered_by, tested_by, requester_practitioner, age_years, age_days, clinical_info, analyzer_code,
        rejection_code, rejection_reason)
      values ('sr-1', 'TDS0012345', 2, '2018-06-01T10:00:00+03:00', 'KCMC~Medical Ward 2', 'D',
        'AB', 'CD', 'Dr Mushi', 34, 12418, 'fever', 'ALINK', 'R01', 'Haemolysed')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select obr_set_id, age_years, age_days, point_of_care, rejection_reason
      from lab_requests where id = 'sr-1'`.execute(db);
    expect(rows.rows).toEqual([{ obr_set_id: 2, age_years: 34, age_days: 12418, point_of_care: 'KCMC~Medical Ward 2', rejection_reason: 'Haemolysed' }]);
  });

  it('adds section_code and authorised_by to diagnostic_reports', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into diagnostic_reports (id, section_code, authorised_by) values ('dr-1', 'HM', 'Dr Kimaro')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select section_code, authorised_by from diagnostic_reports`.execute(db);
    expect(rows.rows).toEqual([{ section_code: 'HM', authorised_by: 'Dr Kimaro' }]);
  });

  it('creates lab_request_attributes with typed value columns', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_request_attributes (id, lab_request_id, system, code, value_text, value_number, value_datetime, value_boolean)
      values ('a-1', 'sr-1', 'urn:openldr:cs:request-attribute', 'cost-units', null, 12.5, null, null),
             ('a-2', 'sr-1', 'urn:openldr:cs:request-attribute', 'newborn', null, null, null, true)`.execute(db);
    const rows = await sql<Record<string, unknown>>`select code, value_number, value_boolean from lab_request_attributes order by code`.execute(db);
    expect(rows.rows).toEqual([
      { code: 'cost-units', value_number: 12.5, value_boolean: null },
      { code: 'newborn', value_number: null, value_boolean: true },
    ]);
  });

  it('leaves every new column NULL when a request carries none of them', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_requests (id, request_id) values ('sr-2', 'TDS0012346')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select analysis_at, obr_set_id, analyzer_code from lab_requests where id = 'sr-2'`.execute(db);
    expect(rows.rows).toEqual([{ analysis_at: null, obr_set_id: null, analyzer_code: null }]);
  });
});
```

- [ ] **Step 3: Run them and check they fail**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/external/019_v1_request_facts.test.ts src/migrations/external/dialect.test.ts`
Expected: FAIL (no `intType`, no columns).

- [ ] **Step 4: `intType`**

In `dialect.ts`, next to `floatType`, add:

```ts
/** A 32-bit integer. `int` on SQL Server and MySQL, `integer` on Postgres. */
export function intType(engine: TargetEngine): string {
  return engine === 'postgres' ? 'integer' : 'int';
}
```

- [ ] **Step 5: The migration**

Create `019_v1_request_facts.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, floatType, intType, booleanType, timestampType, nowExpr } from './dialect';

// v1 request facts (Mozambique slice C, spec 2026-09-29-v1-request-facts-design.md). One shared model:
// every column is for every country and stays NULL where a source does not send it. Common facts are
// typed columns; rare ones are rows in lab_request_attributes, keyed by a code in the
// urn:openldr:cs:request-attribute vocabulary. section_code and authorised_by sit on the REPORT they
// arrive on, because a report projection must not write the row its ServiceRequest owns.
const REQUEST_TEXT = ['analysis_at', 'point_of_care', 'request_type', 'registered_by', 'tested_by',
  'requester_practitioner', 'clinical_info', 'analyzer_code', 'rejection_code', 'rejection_reason'] as const;
const REQUEST_INT = ['obr_set_id', 'age_years', 'age_days'] as const;
const REPORT_TEXT = ['section_code', 'authorised_by'] as const;

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const int = sql.raw(intType(engine));
  const key = sql.raw(keyType(engine));
  for (const col of REQUEST_TEXT) await db.schema.alterTable('lab_requests').addColumn(col, text).execute();
  for (const col of REQUEST_INT) await db.schema.alterTable('lab_requests').addColumn(col, int).execute();
  for (const col of REPORT_TEXT) await db.schema.alterTable('diagnostic_reports').addColumn(col, text).execute();

  let built = db.schema.createTable('lab_request_attributes')
    .addColumn('id', key, (c) => c.primaryKey())
    .addColumn('lab_request_id', key, (c) => c.notNull())
    .addColumn('system', key, (c) => c.notNull())
    .addColumn('code', key, (c) => c.notNull())
    .addColumn('value_text', text)
    .addColumn('value_number', sql.raw(floatType(engine)))
    .addColumn('value_datetime', text)
    .addColumn('value_boolean', sql.raw(booleanType(engine)))
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  await built.execute();
  // The writer replaces a request's attributes by this column (delete in scope, then insert).
  await db.schema.createIndex('lab_request_attributes_request_idx')
    .on('lab_request_attributes').column('lab_request_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('lab_request_attributes').execute();
  for (const col of [...REPORT_TEXT].reverse()) await db.schema.alterTable('diagnostic_reports').dropColumn(col).execute();
  for (const col of [...REQUEST_INT].reverse()) await db.schema.alterTable('lab_requests').dropColumn(col).execute();
  for (const col of [...REQUEST_TEXT].reverse()) await db.schema.alterTable('lab_requests').dropColumn(col).execute();
}
```

Check `011_terminology_codes.ts` for anything else a new table needs on SQL Server or MySQL (collation, index syntax) and copy it. Register `019` in `index.ts` after `018`, the same way `018` is registered.

- [ ] **Step 6: Types and column lists**

In `packages/db/src/schema/external.ts`:
- `LabRequestsTable`: add the 13 columns (`string | null`, the three int ones `number | null`).
- `DiagnosticReportsTable`: add `section_code: string | null; authorised_by: string | null;`.
- Add:

```ts
/** Rare v1 request facts as rows (migration 019). One row per (request, code). `id` is derived from
 *  the request id, system and code, so a re-send overwrites instead of duplicating. The writer
 *  replaces a request's whole set on every new version of the ServiceRequest. */
export interface LabRequestAttributesTable {
  id: string;
  lab_request_id: string;
  system: string;
  code: string;
  value_text: string | null;
  value_number: number | null;
  value_datetime: string | null;
  value_boolean: boolean | null;
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
  created_at: Generated<Date>;
}
```

- `ExternalSchema`: add `lab_request_attributes: LabRequestAttributesTable;`.
- `EXTERNAL_TABLE_COLUMNS`: append the 13 `lab_requests` names after `'requester_display'`; append `'section_code', 'authorised_by'` to `diagnostic_reports` before `'source_system'`; add `lab_request_attributes` with every column in the order above.

- [ ] **Step 7: Data exposure**

In `packages/dashboards/src/models/registry.ts`:
- `HARDCODED_DENY_UNION.lab_requests`: add `'clinical_info'`.
- `HARDCODED_DENY_UNION`: add `lab_request_attributes: ['id', 'lab_request_id', 'value_text', 'plugin_id', 'plugin_version', 'batch_id'],` with a short comment: `value_text` can hold a pseudonymous patient id and free text, so it is hidden until an operator decides.
- `PII_COLUMNS.lab_requests`: `['clinical_info']`; `PII_COLUMNS.lab_request_attributes`: `['value_text']`.

If a dashboards test pins these maps or the table list, update it and name it in the report.

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations src/schema > /tmp/c2.txt 2>&1; echo "exit=$?"` and `pnpm --filter @openldr/dashboards exec vitest run > /tmp/c2d.txt 2>&1; echo "exit=$?"`. Expected: both `exit=0`. Update a test that pins the migration list to include 019.

Typecheck `@openldr/db` and `@openldr/dashboards`. Expected: `exit=0`.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/migrations/external packages/db/src/schema/external.ts packages/dashboards/src/models/registry.ts
git commit -m "feat(db): v1 request facts and the request attributes table"
```

---

### Task 3: Rows a resource owns in other tables

**Files:**
- Create: `packages/db/src/relational/row-id.ts`
- Modify: `packages/db/src/facility-observed.ts` (use the shared hash instead of its private copy)
- Modify: `packages/db/src/relational/index.ts` (add `projectOwnedRows`, `ownedTablesFor`)
- Modify: `packages/db/src/relational-writer.ts`
- Test: `packages/db/src/relational-writer.test.ts` (append)

**Interfaces:**
- Produces: `export function boundedRowId(parts: string[], prefix: string): string`; `export function projectOwnedRows(resource: unknown, prov?: Provenance): RelationalResult[]` (every result carries a `scope`); `export function ownedTablesFor(resourceType: string): { table: keyof ExternalSchema; scopeColumn: string }[]`.
- Consumes (Task 4 fills it): `projectServiceRequestAttributes(r, prov)`.

- [ ] **Step 1: The shared id helper**

Create `packages/db/src/relational/row-id.ts`:

```ts
/** Dependency-free, stable hash (browser-safe: no node:crypto). */
export function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${s.length.toString(16)}`;
}

const MAX_ID_LENGTH = 200;

/** A deterministic row id from its natural key: readable when short, hashed when it would not fit
 *  `keyType` on MySQL/SQL Server. Deterministic because a re-projection must recompute it. */
export function boundedRowId(parts: string[], prefix: string): string {
  const readable = parts.join('|');
  return readable.length <= MAX_ID_LENGTH ? readable : `${prefix}-${djb2Hex(readable)}`;
}
```

In `facility-observed.ts`, delete its private `djb2Hex` and import it from `./relational/row-id`. That module is imported by the studio; check `row-id.ts` imports nothing, which keeps it browser-safe.

- [ ] **Step 2: Write the failing writer tests**

Append to `packages/db/src/relational-writer.test.ts` (reuse its setup helper for a migrated pg-mem external db):

```ts
describe('rows a resource owns in other tables', () => {
  const sr = (attrs: { code: string; value: string }[]) => ({
    resourceType: 'ServiceRequest', id: 'sr-1', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' },
    extension: attrs.map((a) => ({
      url: 'urn:openldr:ext:request-attribute',
      extension: [
        { url: 'code', valueCoding: { system: 'urn:openldr:cs:request-attribute', code: a.code } },
        { url: 'value', valueString: a.value },
      ],
    })),
  });

  it('writes a request row and its attribute rows', async () => {
    const { db, writer } = await setup();
    await writer.write(sr([{ code: 'therapy', value: 'ART' }]), {});
    expect(await db.selectFrom('lab_requests').select('id').execute()).toEqual([{ id: 'sr-1' }]);
    expect(await db.selectFrom('lab_request_attributes').select(['lab_request_id', 'code', 'value_text']).execute())
      .toEqual([{ lab_request_id: 'sr-1', code: 'therapy', value_text: 'ART' }]);
  });

  it('replaces the attribute set on a re-send, including down to none', async () => {
    const { db, writer } = await setup();
    await writer.write(sr([{ code: 'therapy', value: 'ART' }, { code: 'vendor-code', value: 'DISA' }]), {});
    await writer.write(sr([{ code: 'therapy', value: 'ART2' }]), {});
    expect(await db.selectFrom('lab_request_attributes').select(['code', 'value_text']).execute())
      .toEqual([{ code: 'therapy', value_text: 'ART2' }]);
    await writer.write(sr([]), {});
    expect(await db.selectFrom('lab_request_attributes').selectAll().execute()).toEqual([]);
  });

  it('writeMany keeps each request\'s attributes separate', async () => {
    const { db, writer } = await setup();
    const a = sr([{ code: 'therapy', value: 'A' }]);
    const b = { ...sr([{ code: 'therapy', value: 'B' }]), id: 'sr-2' };
    await writer.writeMany([{ resource: a, provenance: {} }, { resource: b, provenance: {} }]);
    const rows = await db.selectFrom('lab_request_attributes').select(['lab_request_id', 'value_text']).orderBy('lab_request_id').execute();
    expect(rows).toEqual([{ lab_request_id: 'sr-1', value_text: 'A' }, { lab_request_id: 'sr-2', value_text: 'B' }]);
  });

  it('deleteById removes the request and its attributes', async () => {
    const { db, writer } = await setup();
    await writer.write(sr([{ code: 'therapy', value: 'ART' }]), {});
    await writer.deleteById('ServiceRequest', 'sr-1');
    expect(await db.selectFrom('lab_requests').selectAll().execute()).toEqual([]);
    expect(await db.selectFrom('lab_request_attributes').selectAll().execute()).toEqual([]);
  });
});
```

If the file's setup helper has another name or shape, use it and keep each test's meaning. These tests also need Task 4's attribute projection: write Task 3's code first with `projectServiceRequestAttributes` returning `[]`, confirm the "writes" tests fail on missing rows, then add a minimal `projectServiceRequestAttributes` in `packages/db/src/relational/service-request.ts` that handles only `valueString` (Task 4 completes it). Say so in the report.

- [ ] **Step 3: Run them and check they fail**

Run: `pnpm --filter @openldr/db exec vitest run src/relational-writer.test.ts -t "owns in other tables"`
Expected: FAIL (no attribute rows written).

- [ ] **Step 4: `projectOwnedRows` and `ownedTablesFor`**

In `packages/db/src/relational/index.ts` add, below `projectResource`:

```ts
/**
 * Rows a resource owns in tables OTHER than its own (`projectResource` gives its own row). Every
 * result is scoped: the writer replaces the whole set for that resource on each new version, so a
 * value the sender dropped does not linger. Keep in lockstep with `ownedTablesFor`.
 */
export function projectOwnedRows(resource: unknown, prov: Provenance = {}): RelationalResult[] {
  if (typeof resource !== 'object' || resource === null) return [];
  const r = resource as Record<string, unknown>;
  switch (r['resourceType']) {
    case 'ServiceRequest':
      return [{
        table: 'lab_request_attributes',
        rows: projectServiceRequestAttributes(r, prov),
        scope: { column: 'lab_request_id', value: String(r['id']) },
      }];
    default: return [];
  }
}

/** The tables `projectOwnedRows` writes for a resource type, with the column that scopes them. */
export function ownedTablesFor(resourceType: string): { table: keyof ExternalSchema; scopeColumn: string }[] {
  switch (resourceType) {
    case 'ServiceRequest': return [{ table: 'lab_request_attributes', scopeColumn: 'lab_request_id' }];
    default: return [];
  }
}
```

Import `projectServiceRequestAttributes` from `./service-request`.

- [ ] **Step 5: The writer**

In `packages/db/src/relational-writer.ts`:

- `write`: after `await replaceScope(p);`, add `for (const owned of projectOwnedRows(resource, provenance)) await replaceScope(owned);`. When `projectResource` returns null, return `'skipped'` without writing owned rows.
- `writeMany`: collect owned results per table while iterating: `const owned = new Map<string, { scopeColumn: string; scopeValues: unknown[]; rows: Record<string, unknown>[] }>()`. For each written item, for each `projectOwnedRows(...)` result, push its scope value and its rows (use a `for` loop, never a spread `push(...)`). After the existing upserts and scoped writes, for each owned table run ONE transaction: delete where the scope column is in the batch's scope values, in chunks of 500 values (SQL Server's parameter budget), then `upsertOn(trx, table, rows)`. All deletes run before the insert, so two requests in one batch cannot wipe each other's rows.
- `deleteById`: after deleting the resource's own row, for each `ownedTablesFor(resourceType)` entry delete where `scopeColumn = id`.

Update the comment on `writeMany` to describe the owned-rows pass and why deletes run before inserts.

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter @openldr/db exec vitest run src/relational-writer.test.ts src/relational src/facility-observed > /tmp/c3.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Typecheck `@openldr/db`. Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/relational packages/db/src/relational-writer.ts packages/db/src/relational-writer.test.ts packages/db/src/facility-observed.ts
git commit -m "feat(db): project rows a resource owns in other tables"
```

---

### Task 4: Project the request facts and the attributes

**Files:**
- Create: `packages/db/src/relational/request-facts.ts`
- Create: `packages/db/src/relational/request-facts.test.ts`
- Modify: `packages/db/src/relational/service-request.ts`
- Modify: `packages/db/src/relational/diagnostic-report.ts`

**Interfaces:**
- Consumes: Task 2 columns; Task 3 `boundedRowId`.
- Produces: `requestFacts(r)`, `reportFacts(r)`, `projectServiceRequestAttributes(r, prov)` (complete version).

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/relational/request-facts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { requestFacts, reportFacts } from './request-facts';
import { projectServiceRequest, projectServiceRequestAttributes } from './service-request';
import { projectDiagnosticReport } from './diagnostic-report';

const ext = (url: string, value: Record<string, unknown>) => ({ url: `urn:openldr:ext:${url}`, ...value });

const fullRequest = {
  resourceType: 'ServiceRequest', id: 'sr-1', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' },
  identifier: [
    { system: 'urn:openldr:request-id', value: 'TZDISATDS0012345' },
    { system: 'urn:openldr:obr-set-id', value: '2' },
  ],
  locationCode: [{ text: 'KCMC~Medical Ward 2' }],
  note: [{ text: 'fever' }],
  contained: [{ resourceType: 'PractitionerRole', id: 'requester', practitioner: { display: 'Dr Mushi' } }],
  requester: { reference: '#requester' },
  extension: [
    ext('analysis-time', { valueDateTime: '2018-06-01T10:00:00+03:00' }),
    ext('registered-by', { valueString: 'AB' }),
    ext('tested-by', { valueString: 'CD' }),
    ext('request-type', { valueCode: 'D' }),
    ext('age-at-request', { extension: [{ url: 'years', valueInteger: 34 }, { url: 'days', valueInteger: 12418 }] }),
    ext('analyzer', { valueCode: 'ALINK' }),
    ext('rejection', { extension: [{ url: 'code', valueCode: 'R01' }, { url: 'reason', valueString: 'Haemolysed' }] }),
    ext('some-future-thing', { valueString: 'ignored' }),
  ],
};

describe('requestFacts', () => {
  it('reads every slot', () => {
    expect(requestFacts(fullRequest)).toEqual({
      obr_set_id: 2, analysis_at: '2018-06-01T10:00:00+03:00', point_of_care: 'KCMC~Medical Ward 2',
      request_type: 'D', registered_by: 'AB', tested_by: 'CD', requester_practitioner: 'Dr Mushi',
      age_years: 34, age_days: 12418, clinical_info: 'fever', analyzer_code: 'ALINK',
      rejection_code: 'R01', rejection_reason: 'Haemolysed',
    });
  });

  it('gives NULL for every absent fact', () => {
    const facts = requestFacts({ resourceType: 'ServiceRequest', id: 'sr-2' });
    expect(Object.values(facts).every((v) => v === null)).toBe(true);
    expect(Object.keys(facts)).toHaveLength(13);
  });

  it('ignores a non-numeric OBR set id instead of guessing', () => {
    const facts = requestFacts({ ...fullRequest, identifier: [{ system: 'urn:openldr:obr-set-id', value: 'x' }] });
    expect(facts.obr_set_id).toBeNull();
  });

  it('is part of the lab_requests row', () => {
    expect(projectServiceRequest(fullRequest, {})).toMatchObject({ analysis_at: '2018-06-01T10:00:00+03:00', obr_set_id: 2 });
  });
});

describe('reportFacts', () => {
  it('reads section and authorised by', () => {
    const dr = {
      resourceType: 'DiagnosticReport', id: 'dr-1',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'HM' }] }],
      resultsInterpreter: [{ display: 'Dr Kimaro' }],
    };
    expect(reportFacts(dr)).toEqual({ section_code: 'HM', authorised_by: 'Dr Kimaro' });
    expect(projectDiagnosticReport(dr, {})).toMatchObject({ section_code: 'HM', authorised_by: 'Dr Kimaro' });
  });

  it('ignores a category from another system', () => {
    const dr = { resourceType: 'DiagnosticReport', id: 'dr-2', category: [{ coding: [{ system: 'urn:other', code: 'X' }] }] };
    expect(reportFacts(dr).section_code).toBeNull();
  });
});

describe('projectServiceRequestAttributes', () => {
  const attr = (code: string, value: Record<string, unknown>) => ({
    url: 'urn:openldr:ext:request-attribute',
    extension: [{ url: 'code', valueCoding: { system: 'urn:openldr:cs:request-attribute', code } }, { url: 'value', ...value }],
  });

  it('writes one row per attribute, each value in its typed column', () => {
    const rows = projectServiceRequestAttributes({
      resourceType: 'ServiceRequest', id: 'sr-1',
      extension: [
        attr('therapy', { valueString: 'ART' }),
        attr('cost-units', { valueDecimal: 12.5 }),
        attr('newborn', { valueBoolean: true }),
        attr('prereg-registration-time', { valueDateTime: '2018-06-01T08:00:00+03:00' }),
      ],
    }, { sourceSystem: 'webhook-ingest' });
    expect(rows.map((r) => [r.code, r.value_text, r.value_number, r.value_boolean, r.value_datetime])).toEqual([
      ['therapy', 'ART', null, null, null],
      ['cost-units', null, 12.5, null, null],
      ['newborn', null, null, true, null],
      ['prereg-registration-time', null, null, null, '2018-06-01T08:00:00+03:00'],
    ]);
    expect(rows.every((r) => r.lab_request_id === 'sr-1' && r.system === 'urn:openldr:cs:request-attribute' && r.source_system === 'webhook-ingest')).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(4);
  });

  it('skips an attribute with no code or no value', () => {
    const rows = projectServiceRequestAttributes({
      resourceType: 'ServiceRequest', id: 'sr-1',
      extension: [
        { url: 'urn:openldr:ext:request-attribute', extension: [{ url: 'value', valueString: 'orphan' }] },
        { url: 'urn:openldr:ext:request-attribute', extension: [{ url: 'code', valueCoding: { system: 'urn:openldr:cs:request-attribute', code: 'therapy' } }] },
      ],
    }, {});
    expect(rows).toEqual([]);
  });

  it('keeps the last value when the same code repeats, so the row id stays unique', () => {
    const rows = projectServiceRequestAttributes({
      resourceType: 'ServiceRequest', id: 'sr-1',
      extension: [attr('therapy', { valueString: 'A' }), attr('therapy', { valueString: 'B' })],
    }, {});
    expect(rows.map((r) => r.value_text)).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @openldr/db exec vitest run src/relational/request-facts.test.ts`
Expected: FAIL (no `./request-facts`).

- [ ] **Step 3: `request-facts.ts`**

Create `packages/db/src/relational/request-facts.ts` with:
- a helper `extension(r, name)` returning the first extension whose `url` is `urn:openldr:ext:<name>`, and `subValue(ext, url, key)` for a sub-extension's `value<Key>`;
- `requestFacts(r)` returning exactly the 13 `lab_requests` fact columns (types as in Global Constraints). `obr_set_id` comes from the identifier with system `urn:openldr:obr-set-id`, parsed with `Number` and kept only when `Number.isInteger`. `requester_practitioner` follows the `#` reference to a contained `PractitionerRole` and reads `practitioner.display` (reuse the lookup in `./requester` rather than writing a second one; export a small helper from there if needed). `point_of_care` is `locationCode[0].text`; `clinical_info` is `note[0].text`. Use `str` from `./extract` for strings; an integer is kept only when `Number.isInteger`.
- `reportFacts(r)` returning `{ section_code, authorised_by }`: the first `category[].coding[]` whose system is `http://terminology.hl7.org/CodeSystem/v2-0074`, and `resultsInterpreter[0].display`.

Export the extension URL prefix and the v2-0074 system as named constants at the top of the file, each with a one-line comment.

- [ ] **Step 4: Wire into the projections**

- `service-request.ts`: add `...requestFacts(r),` to the returned row, and replace Task 3's minimal `projectServiceRequestAttributes` with the complete one: one row per `urn:openldr:ext:request-attribute` extension with a code and exactly one value; `valueString`/`valueCode` go to `value_text`, `valueDecimal`/`valueInteger` to `value_number`, `valueDateTime` to `value_datetime`, `valueBoolean` to `value_boolean`; a repeated code keeps its last value; `id = boundedRowId([labRequestId, system, code], 'lra')`; provenance columns from `provColumns(prov)`.
- `diagnostic-report.ts`: add `...reportFacts(r),` to the returned row.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @openldr/db exec vitest run src/relational src/relational-writer.test.ts > /tmp/c4.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Typecheck `@openldr/db`. Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/relational
git commit -m "feat(db): project the v1 request facts and request attributes"
```

---

### Task 5: The attribute vocabulary and the docs

**Files:**
- Create: `packages/terminology/codesystems/openldr-request-attribute.json`
- Create: `packages/terminology/src/request-attribute-codesystem.test.ts`
- Modify: studio docs `apps/studio/src/docs/<newest>/{en,fr,pt}/` (the page that describes the warehouse tables or reports; find it with `grep -rli "lab_requests\|warehouse" apps/studio/src/docs`), and the web docs page for the same topic in `apps/web/src/docs/<newest>/`

- [ ] **Step 1: The CodeSystem file**

Create `packages/terminology/codesystems/openldr-request-attribute.json`:

```json
{
  "resourceType": "CodeSystem",
  "id": "openldr-request-attribute",
  "url": "urn:openldr:cs:request-attribute",
  "name": "OpenLDRRequestAttribute",
  "title": "OpenLDR request attributes",
  "status": "active",
  "content": "complete",
  "description": "Rare lab request facts stored as rows in lab_request_attributes. Most come from OpenLDR v1's Requests table.",
  "concept": [
    { "code": "therapy", "display": "Therapy" },
    { "code": "ordering-notes", "display": "Ordering notes" },
    { "code": "collection-volume", "display": "Collection volume" },
    { "code": "cost-units", "display": "Cost units" },
    { "code": "encrypted-patient-id", "display": "Encrypted patient id" },
    { "code": "vendor-code", "display": "LIMS vendor code" },
    { "code": "deceased", "display": "Deceased" },
    { "code": "newborn", "display": "Newborn" },
    { "code": "repeated", "display": "Repeated" },
    { "code": "loinc-panel-code", "display": "LOINC panel code" },
    { "code": "admit-attend-time", "display": "Admit or attend time" },
    { "code": "icd10-clinical-info", "display": "ICD-10 clinical info codes" },
    { "code": "hl7-specimen-source", "display": "HL7 specimen source code" },
    { "code": "specimen-site-code", "display": "Specimen site code" },
    { "code": "specimen-site-desc", "display": "Specimen site description" },
    { "code": "hl7-specimen-site", "display": "HL7 specimen site code" },
    { "code": "ethnic-group", "display": "Ethnic group" },
    { "code": "patient-class", "display": "Patient class" },
    { "code": "referring-request-id", "display": "Referring request id" },
    { "code": "prereg-registration-time", "display": "Pre-registration time" },
    { "code": "prereg-received-time", "display": "Pre-registration received time" },
    { "code": "prereg-registration-facility", "display": "Pre-registration facility" },
    { "code": "work-units", "display": "Work units" },
    { "code": "target-time-days", "display": "Target time in days" },
    { "code": "target-time-mins", "display": "Target time in minutes" }
  ]
}
```

- [ ] **Step 2: A test that the file is valid and imports**

Create `packages/terminology/src/request-attribute-codesystem.test.ts` that reads the file, checks `url` is `urn:openldr:cs:request-attribute`, every concept has a lowercase-hyphen `code` and a `display`, codes are unique, and there are 25 concepts. Then feed it through the same loader `openldr terminology import resource` uses (`ctx.loaders.resource`, whose CodeSystem branch is in `packages/terminology/src/loaders/generic.ts`), using the pg-mem setup the loader's own tests use, and assert 25 concepts land under that system. Copy the setup from the existing generic loader test file.

Run: `pnpm --filter @openldr/terminology exec vitest run src/request-attribute-codesystem.test.ts`. Expected: PASS.

- [ ] **Step 3: Docs**

In the studio docs page for the warehouse or reports (en, fr, pt) and the matching web page (English), add a section:

````markdown
### Request facts and request attributes

Each lab request carries, where the source sends them: the OBR set, analysis time, point of care,
request type, who registered and tested it, the requesting doctor, age at the request, clinical
information, analyser, and rejection code and reason. Each report carries its section and who
authorised it.

Rarer facts are rows in `lab_request_attributes`, one row per request and attribute. The attribute
codes are the `urn:openldr:cs:request-attribute` coding system. Load it once with:

    openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json

A fact the source does not send stays empty. Nothing is filled in.

`clinical_info` and the attribute text values are hidden from the dashboard builder by default,
because they can hold free text or a pseudonymous patient id. Unhide them in Settings, then Data
Exposure.
````

Translate for fr and pt using each file's existing vocabulary. Keep the command unchanged. Run `pnpm --filter @openldr/studio exec vitest run src/docs` (never the whole studio suite). Expected: PASS. `git diff HEAD | grep "^+" | grep -c "—"` must print 0.

- [ ] **Step 4: Commit**

```bash
git add packages/terminology/codesystems packages/terminology/src/request-attribute-codesystem.test.ts apps/studio/src/docs apps/web/src/docs
git commit -m "feat(terminology): the request attribute vocabulary, and docs"
```

---

### Task 6: Gates, engines, merge (controller)

Run by the controller.

- [ ] **Step 1: CE gate**

`pnpm turbo run test --force --concurrency=4` and `pnpm turbo run typecheck --force`, each redirected, each `exit=0`.

- [ ] **Step 2: Three engines**

`pnpm mssql:accept` against a throwaway database on the `sqlserver` container (`MSSQL_ACCEPT_TARGET_ONLY=1`), dropped afterwards; `pnpm mysql:accept` against `openldr_ce-mysql-1`. Both must show `019_v1_request_facts` applied and pass. Do not run `reports:accept` against any database but a throwaway one (it deletes every warehouse table).

- [ ] **Step 3: Merge (ask the operator first)**

Merge `spec/v1-request-facts` to local `main` with `--no-ff`, restart the dev API so 019 runs, import the vocabulary file with the CLI, and run `pnpm make:changelog`. The live comparison against v1 waits for the cdr-toolchain plan.
