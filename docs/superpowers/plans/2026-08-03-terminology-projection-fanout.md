# Terminology Projection Fan-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one FHIR resource project to many warehouse rows, so a ValueSet's expansion lands in the external warehouse as a joinable dimension that stays in step when the ValueSet changes or is deleted.

**Architecture:** `projectResource` returns `rows[]` instead of `row`, plus an optional `scope` naming the column that identifies "rows owned by this resource". The writer replaces a scope wholesale — delete-in-scope then insert, inside a transaction — which is the only shape that survives a 2,009-concept ValueSet on all three dialects. Fact tables return a single row with no scope and behave exactly as today.

**Tech Stack:** TypeScript, Kysely, Postgres/MSSQL/MySQL, vitest 2.1.8, pg-mem for migration tests.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-03-terminology-projection-fanout-design.md`.
- **Fact tables must be byte-for-byte unaffected.** `patients`, `lab_requests`, `lab_results`, `facilities`, `specimens`, `diagnostic_reports`, `questionnaire_responses` return one row and no scope. Any behaviour change to them is a defect.
- **A shrinking ValueSet must drop its removed codes**, and deleting a ValueSet must clear all of them. Both failures are silent today; that is the whole point of the slice.
- **All three dialects must work.** `insertBatchPg`, `mergeBatchMssql`, `insertBatchMysql` all conflict on `id`, so every projected row — including dimension rows — needs a unique `id`.
- ⚠ **MSSQL caps at 2,100 bound parameters.** A live seeded ValueSet (`vs-seed-specimen-type`) expands to **2,009 concepts**. Any `where … not in (<codes>)` delete is therefore unimplementable. Do not write one.
- ⚠ **Widening `RelationalResult` changes a type every projection call site builds.** Verification is `pnpm turbo run typecheck --force`, not a package test — vitest strips types ([[plans-cite-or-flag]] rule 8). Known consumers: `relational-writer.ts`, `projection/cycle.ts`, `bootstrap/src/db-context.ts:45`, `bootstrap/src/index.ts:493`.
- **Commit trailer rule:** never add a `Co-Authored-By: Claude`/`Codex` trailer.
- Test command: `cd packages/db && npx vitest run <file>`. Never pipe turbo through `tail`.

## Measured facts this plan is built on

Read from code and from the live dev DB on 2026-08-03. Cited so no task re-derives them:

| Fact | Source |
|---|---|
| `RelationalResult = { table, row }` — singular | `packages/db/src/relational/index.ts:19-22` |
| `write()` upserts `[p.row]`; `deleteById` matches one `id` | `packages/db/src/relational-writer.ts:33,53` |
| `applyProjection` writes-or-deletes exactly one resource | `packages/db/src/projection/cycle.ts:31-36` |
| Terminology dropped at `default: return null`; sibling switch at `:50` | `packages/db/src/relational/index.ts:36,50` |
| All 3 upserts conflict on `id`; `updateCols` excludes `id`/`created_at` | `packages/db/src/batch-upsert.ts:25-27,45,57` |
| MSSQL budget 2000 params / 1000 VALUES rows | `packages/db/src/batch-upsert.ts:13-14` |
| 6 ValueSets live, ALL carry `expansion.contains[]` as `{code, system, display}` | live probe, `fhir.fhir_resources` |
| Largest expansion is **2009** (`vs-seed-specimen-type`); others are 2-4 | live probe |
| External migrations run to `010_diagnostic_report_facility` | `packages/db/src/migrations/external/index.ts:25` |
| External migration tests use `makeMigratedExternalDb()` | `packages/db/src/migrations/external/007_drop_thin_rename_v2.test.ts:3` |
| `reprojectAll` has NO production callers | grep: only `cycle.ts` + a comment in `provenance.ts` |

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/db/src/migrations/external/011_terminology_codes.ts` | the dimension table | Create |
| `packages/db/src/migrations/external/011_terminology_codes.test.ts` | migration test | Create |
| `packages/db/src/migrations/external/index.ts` | register 011 | Modify |
| `packages/db/src/schema/external.ts` | `TerminologyCodesTable` + `EXTERNAL_TABLE_COLUMNS` entry | Modify |
| `packages/db/src/relational/value-set.ts` | `projectValueSet` (1→N) | Create |
| `packages/db/src/relational/value-set.test.ts` | projection tests | Create |
| `packages/db/src/relational/index.ts` | `RelationalResult` shape + both switches | Modify |
| `packages/db/src/relational-writer.ts` | scoped replace + scope-aware delete | Modify |
| `packages/db/src/relational-writer.test.ts` | writer tests | Create or extend |

---

### Task 1: The dimension table

**Files:**
- Create: `packages/db/src/migrations/external/011_terminology_codes.ts`
- Modify: `packages/db/src/migrations/external/index.ts:12,25`
- Modify: `packages/db/src/schema/external.ts` (table interface + `EXTERNAL_TABLE_COLUMNS`)
- Test: `packages/db/src/migrations/external/011_terminology_codes.test.ts`

**Interfaces:**
- Consumes: `textType(engine)` from `./dialect`, the `ProvenanceColumns` interface in `schema/external.ts`.
- Produces: table `terminology_codes` with columns `id, value_set_id, value_set_url, system, code, display` plus the provenance columns. `TerminologyCodesTable` exported from `schema/external.ts`; `terminology_codes` added to `ExternalSchema` and to `EXTERNAL_TABLE_COLUMNS`. Tasks 2-5 rely on these exact names.

⚠ `id` is a **synthetic deterministic key**, `<value_set_id>|<system>|<code>`. It exists because all three batch upserts conflict on `id` (`batch-upsert.ts:25-27,45,57`) — a natural composite key would require changing all three. Determinism matters: the same concept must produce the same `id` on every reprojection, or a rebuild duplicates every row.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/external/011_terminology_codes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedExternalDb } from '../../test-helpers-external';

describe('011 terminology_codes', () => {
  it('creates a table that accepts a projected concept row', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into terminology_codes (id, value_set_id, value_set_url, system, code, display)
              values ('vs1|sys|M','vs1','urn:openldr:valueset:biological-sex','sys','M','Male')`.execute(db);
    const rows = (await sql<{ code: string }>`select code from terminology_codes`.execute(db)).rows;
    expect(rows).toEqual([{ code: 'M' }]);
    await db.destroy();
  });

  it('rejects a duplicate id, so upsert-on-id is well defined', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into terminology_codes (id, value_set_id, system, code) values ('dup','vs1','sys','A')`.execute(db);
    await expect(
      sql`insert into terminology_codes (id, value_set_id, system, code) values ('dup','vs1','sys','A')`.execute(db),
    ).rejects.toThrow();
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run src/migrations/external/011_terminology_codes.test.ts`
Expected: FAIL — relation `terminology_codes` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/db/src/migrations/external/011_terminology_codes.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// The warehouse's first TERMINOLOGY dimension. Reports run against the external warehouse via
// runConnectorSql, while value_sets lives in the internal DB, so a report cannot join terminology
// unless it is projected here. One row per (value set, concept).
//
// `id` is synthetic — `<value_set_id>|<system>|<code>` — because all three batch upserts conflict
// on `id` (batch-upsert.ts). It must be DETERMINISTIC: a reprojection recomputes it, and a
// non-deterministic id would duplicate every row on rebuild instead of updating it.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  await db.schema.createTable('terminology_codes')
    .addColumn('id', text, (c) => c.primaryKey())
    .addColumn('value_set_id', text)
    .addColumn('value_set_url', text)
    .addColumn('system', text)
    .addColumn('code', text)
    .addColumn('display', text)
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .execute();
  // The projection replaces a whole value set at once, so every write and every delete filters on
  // value_set_id. Without this index that is a full scan of the dimension on each terminology edit.
  await db.schema.createIndex('terminology_codes_value_set_id_idx')
    .on('terminology_codes').column('value_set_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('terminology_codes').execute();
}
```

⚠ `created_at` is deliberately omitted here — check how the other external tables declare it
(`001_flat_tables.ts`) and follow that file exactly, including its default. `ProvenanceColumns` in
`schema/external.ts` declares `created_at: Generated<Date>`, so the column must exist.

Register it in `packages/db/src/migrations/external/index.ts` — add the import beside line 12 and
the entry beside line 25, following the existing shape:

```ts
import * as m011 from './011_terminology_codes';
```
```ts
    '011_terminology_codes': { up: (db) => m011.up(db, engine), down: m011.down },
```

Add to `packages/db/src/schema/external.ts`, beside the other table interfaces:

```ts
export interface TerminologyCodesTable extends ProvenanceColumns {
  id: string;
  value_set_id: string | null;
  value_set_url: string | null;
  system: string | null;
  code: string | null;
  display: string | null;
}
```

Add `terminology_codes: TerminologyCodesTable;` to `ExternalSchema`, and this entry to
`EXTERNAL_TABLE_COLUMNS` (the record at line 118):

```ts
  terminology_codes: ['id', 'value_set_id', 'value_set_url', 'system', 'code', 'display', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run src/migrations/external/`
Expected: PASS — the two new cases plus every pre-existing external migration test.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/external/011_terminology_codes.ts packages/db/src/migrations/external/011_terminology_codes.test.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts
git commit -m "feat(db): add the terminology_codes warehouse dimension"
```

---

### Task 2: Widen the projection result to many rows

**Files:**
- Modify: `packages/db/src/relational/index.ts:19-38`
- Test: `packages/db/src/relational/index.test.ts` (create if absent — check first)

**Interfaces:**
- Consumes: nothing new.
- Produces:
```ts
export interface RelationalResult {
  table: keyof ExternalSchema;
  rows: Record<string, unknown>[];
  scope?: { column: string; value: unknown };
}
```
Tasks 3, 4 and 5 all consume this shape. **`row` is gone; every existing projection now returns `rows: [ ... ]`.**

⚠ This task changes ONLY the shape. No projection gains a `scope` yet, and no behaviour changes.
Keeping the type change and the behaviour change in separate commits is deliberate: if the gate
goes red, it is unambiguous which one did it.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/relational/index.test.ts` (if the file does not exist, create it with the
`describe`/`it`/`expect` import from `vitest`):

```ts
import { projectResource } from './index';

describe('projectResource result shape', () => {
  it('returns a single-row array and no scope for a fact resource', () => {
    const r = projectResource({ resourceType: 'Patient', id: 'p1' }, {});
    expect(r?.table).toBe('patients');
    expect(r?.rows).toHaveLength(1);
    expect(r?.rows[0]).toMatchObject({ id: 'p1' });
    expect(r?.scope).toBeUndefined();
  });

  it('still returns null for an unmapped resource type', () => {
    expect(projectResource({ resourceType: 'Practitioner', id: 'x' }, {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run src/relational/`
Expected: FAIL — `r.rows` is undefined (the result still carries `row`).

- [ ] **Step 3: Write minimal implementation**

In `packages/db/src/relational/index.ts`, replace the interface (lines 19-22) and every `case` in
`projectResource` (lines 27-37). The full replacement:

```ts
export interface RelationalResult {
  table: keyof ExternalSchema;
  /** One row for a fact resource; many for a resource that fans out to a dimension. */
  rows: Record<string, unknown>[];
  /** Present only for fan-out resources. Names the column identifying every row this resource
   *  owns, so the writer can REPLACE that set — deleting rows the resource no longer produces.
   *  Without it a shrinking ValueSet would silently leave its removed codes behind. */
  scope?: { column: string; value: unknown };
}

export function projectResource(resource: unknown, prov: Provenance = {}): RelationalResult | null {
  if (typeof resource !== 'object' || resource === null) return null;
  const r = resource as Record<string, unknown>;
  switch (r['resourceType']) {
    case 'Patient': return { table: 'patients', rows: [projectPatient(r, prov)] };
    case 'ServiceRequest': return { table: 'lab_requests', rows: [projectServiceRequest(r, prov)] };
    case 'Observation': return { table: 'lab_results', rows: [projectObservation(r, prov)] };
    case 'Organization':
    case 'Location': return { table: 'facilities', rows: [projectFacility(r, prov)] };
    case 'Specimen': return { table: 'specimens', rows: [projectSpecimen(r, prov)] };
    case 'DiagnosticReport': return { table: 'diagnostic_reports', rows: [projectDiagnosticReport(r, prov)] };
    case 'QuestionnaireResponse': return { table: 'questionnaire_responses', rows: [projectQuestionnaireResponse(r, prov)] };
    default: return null;
  }
}
```

Then fix `packages/db/src/relational-writer.ts` to compile against it — minimally, without changing
behaviour yet:

- `write()` line 33: `await upsert(p.table, [p.row]);` → `await upsert(p.table, p.rows);`
- `writeMany()` lines 43-45: `list.push(p.row);` → `list.push(...p.rows);`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run src/relational/ src/relational-writer.test.ts`
Expected: PASS. Then run `cd packages/db && npx tsc --noEmit` — expected clean.

- [ ] **Step 5: Typecheck the consumers**

Run: `pnpm turbo run typecheck --force`
Expected: clean across all packages. `@openldr/cli#build` is a known Windows-only esbuild failure and is NOT part of this gate. If any package is red, fix it in THIS task — a widened shared type that only compiles in its own package is the exact defect [[plans-cite-or-flag]] rule 8 describes.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/relational/index.ts packages/db/src/relational/index.test.ts packages/db/src/relational-writer.ts
git commit -m "refactor(db): let a projection return many rows"
```

---

### Task 3: Scope replacement in the writer

**Files:**
- Modify: `packages/db/src/relational-writer.ts:21-56`
- Test: `packages/db/src/relational-writer.test.ts`

**Interfaces:**
- Consumes: `RelationalResult` (Task 2).
- Produces: `RelationalWriter.deleteById(resourceType, id)` becomes scope-aware. No signature change; behaviour widens.

**The replacement strategy, and why it is not a diff.** A scoped write DELETES every row in the
scope and INSERTS the new set, inside a transaction. The obvious alternative — upsert the new rows,
then delete the ones not in the new set — is **unimplementable**: `vs-seed-specimen-type` expands to
2,009 concepts and MSSQL caps at ~2,000 bound parameters (`batch-upsert.ts:13`), so the `not in`
list alone exceeds the budget. Delete-then-insert is O(1) parameters for the delete and reuses the
existing chunked batch inserts for the write.

The transaction is what stops a reader seeing an empty dimension mid-replace.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/relational-writer.test.ts` (create it if absent, using
`makeMigratedExternalDb` from `../test-helpers-external` as the external migration tests do):

```ts
import { createRelationalWriter } from './relational-writer';
import { makeMigratedExternalDb } from './test-helpers-external';
import { sql } from 'kysely';

const codes = (db: any) =>
  sql<{ code: string }>`select code from terminology_codes order by code`.execute(db)
    .then((r: any) => r.rows.map((x: any) => x.code));

const vs = (id: string, cs: string[]) => ({
  resourceType: 'ValueSet', id, url: `urn:test:${id}`,
  expansion: { contains: cs.map((c) => ({ system: 'sys', code: c, display: c })) },
});

describe('scoped projection', () => {
  it('drops the codes a shrinking value set no longer contains', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write(vs('vs1', ['A', 'B', 'C']), {});
    expect(await codes(db)).toEqual(['A', 'B', 'C']);
    await w.write(vs('vs1', ['A', 'C']), {});
    expect(await codes(db)).toEqual(['A', 'C']); // B is GONE, not merely stale
    await db.destroy();
  });

  it('does not let one value set delete another value set rows', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write(vs('vs1', ['A']), {});
    await w.write(vs('vs2', ['B']), {});
    expect(await codes(db)).toEqual(['A', 'B']);
    await db.destroy();
  });

  it('clears every row of a value set when the resource is deleted', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write(vs('vs1', ['A', 'B']), {});
    await w.deleteById('ValueSet', 'vs1');
    expect(await codes(db)).toEqual([]);
    await db.destroy();
  });

  it('leaves fact-table writes exactly as they were', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write({ resourceType: 'Patient', id: 'p1', gender: 'male' }, {});
    await w.write({ resourceType: 'Patient', id: 'p2', gender: 'female' }, {});
    const rows = (await sql<{ id: string }>`select id from patients order by id`.execute(db)).rows;
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2']); // no scope ⇒ no deletion of p1
    await db.destroy();
  });
});
```

⚠ These tests depend on Task 4's `projectValueSet` existing. Write Task 4 FIRST if you prefer, or
accept that Step 2 fails for two reasons at once (no scope handling AND no ValueSet projection) and
confirm both are gone by Step 4. State in your report which you did.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run src/relational-writer.test.ts`
Expected: FAIL — the shrinking case leaves `['A','B','C']` (nothing deletes `B`).

- [ ] **Step 3: Write minimal implementation**

Replace the body of `createRelationalWriter` in `packages/db/src/relational-writer.ts`:

```ts
export function createRelationalWriter(db: Kysely<ExternalSchema>, engine: TargetEngine = 'postgres'): RelationalWriter {
  const anyDb = db as unknown as Kysely<any>;
  async function upsertOn(exec: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    if (engine === 'mssql') await mergeBatchMssql(exec, table, rows);
    else if (engine === 'mysql') await insertBatchMysql(exec, table, rows);
    else await insertBatchPg(exec, table, rows);
  }

  /** Replace everything a fan-out resource owns. DELETE-then-INSERT, not upsert-then-prune: a
   *  `not in (<codes>)` prune is impossible on MSSQL, whose ~2000-parameter budget is smaller than
   *  a real value set (vs-seed-specimen-type expands to 2009). The transaction is what stops a
   *  concurrent reader seeing the scope empty between the delete and the insert. */
  async function replaceScope(p: RelationalResult): Promise<void> {
    const scope = p.scope;
    if (!scope) { await upsertOn(anyDb, p.table, p.rows); return; }
    await anyDb.transaction().execute(async (trx: Kysely<any>) => {
      await trx.deleteFrom(p.table).where(scope.column as any, '=', scope.value as any).execute();
      await upsertOn(trx, p.table, p.rows);
    });
  }

  return {
    async write(resource, provenance) {
      const p = projectResource(resource, provenance);
      if (!p) return 'skipped';
      await replaceScope(p);
      return 'written';
    },
    async writeMany(items) {
      const results: WriteResult[] = new Array(items.length).fill('skipped');
      const unscoped = new Map<string, Record<string, unknown>[]>();
      const scoped: RelationalResult[] = [];
      items.forEach((it, idx) => {
        const p = projectResource(it.resource, it.provenance);
        if (!p) return;
        results[idx] = 'written';
        // Scoped resources are applied INDIVIDUALLY. Merging two value sets into one batch would
        // make each one's scope-delete wipe the other's rows before either insert ran.
        if (p.scope) { scoped.push(p); return; }
        const list = unscoped.get(p.table) ?? [];
        list.push(...p.rows);
        unscoped.set(p.table, list);
      });
      for (const [table, rows] of unscoped) await upsertOn(anyDb, table, rows);
      for (const p of scoped) await replaceScope(p);
      return results;
    },
    async deleteById(resourceType, id) {
      const table = tableForResourceType(resourceType);
      if (!table) return;
      const scopeColumn = scopeColumnFor(resourceType);
      if (scopeColumn) {
        await anyDb.deleteFrom(table).where(scopeColumn as any, '=', id).execute();
        return;
      }
      await anyDb.deleteFrom(table).where('id', '=', id).execute();
    },
  };
}
```

Add the import of `RelationalResult` and `scopeColumnFor` to line 6's import from `./relational/index`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run src/`
Expected: PASS — all four new cases plus every pre-existing db test.

- [ ] **Step 5: Mutation-check the two load-bearing tests**

The shrink test and the cross-contamination test are the whole slice. Prove each can fail:
1. Delete the `await trx.deleteFrom(...)` line. Re-run: the **shrink** test must go RED (`B` survives). Restore.
2. In `writeMany`, remove the `if (p.scope) { scoped.push(p); return; }` guard so scoped rows join the unscoped batch. Re-run: the **cross-contamination** test must go RED. Restore.

If either stays green, the test is decoration — fix the test before continuing.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/relational-writer.ts packages/db/src/relational-writer.test.ts
git commit -m "feat(db): replace a fan-out resource's whole scope on write and delete"
```

---

### Task 4: Project ValueSet to concepts

**Files:**
- Create: `packages/db/src/relational/value-set.ts`
- Modify: `packages/db/src/relational/index.ts` (export, both switches, `scopeColumnFor`)
- Test: `packages/db/src/relational/value-set.test.ts`

**Interfaces:**
- Consumes: `ProvenanceColumns` via `provColumns` from `./extract`, `TerminologyCodesTable` (Task 1), `RelationalResult` (Task 2).
- Produces: `projectValueSet(r, prov): Insertable<TerminologyCodesTable>[]` and `scopeColumnFor(resourceType: string): string | null` (consumed by Task 3's `deleteById`).

**The resource shape is measured, not assumed.** All 6 live ValueSets carry
`expansion.contains[]` with `{ system, code, display }`. Sizes: 2, 2, 3, 3, 4, **2009**.
A ValueSet with no `expansion` projects to zero rows — which, with a scope, correctly means
"this value set now contributes nothing", not "leave the old rows alone".

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/relational/value-set.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { projectValueSet } from './value-set';
import { projectResource } from './index';

const vs = {
  resourceType: 'ValueSet', id: 'vs-seed-biological-sex', url: 'urn:openldr:valueset:biological-sex',
  expansion: { contains: [
    { system: 'urn:openldr:cs:local', code: 'M', display: 'Male' },
    { system: 'urn:openldr:cs:local', code: 'F', display: 'Female' },
  ] },
};

describe('projectValueSet', () => {
  it('projects one row per concept with a deterministic composite id', () => {
    const rows = projectValueSet(vs, {});
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'vs-seed-biological-sex|urn:openldr:cs:local|M',
      value_set_id: 'vs-seed-biological-sex',
      value_set_url: 'urn:openldr:valueset:biological-sex',
      system: 'urn:openldr:cs:local', code: 'M', display: 'Male',
    });
  });

  it('is deterministic — reprojecting the same resource yields identical ids', () => {
    expect(projectValueSet(vs, {}).map((r) => r.id)).toEqual(projectValueSet(vs, {}).map((r) => r.id));
  });

  it('projects zero rows for a value set with no expansion', () => {
    expect(projectValueSet({ resourceType: 'ValueSet', id: 'empty' }, {})).toEqual([]);
  });
});

describe('projectResource for ValueSet', () => {
  it('returns the concepts scoped by value_set_id', () => {
    const r = projectResource(vs, {});
    expect(r?.table).toBe('terminology_codes');
    expect(r?.rows).toHaveLength(2);
    expect(r?.scope).toEqual({ column: 'value_set_id', value: 'vs-seed-biological-sex' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run src/relational/value-set.test.ts`
Expected: FAIL — `./value-set` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/db/src/relational/value-set.ts`:

```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { TerminologyCodesTable } from '../schema/external';
import { provColumns, str } from './extract';

/** A ValueSet fans out to one warehouse row per expanded concept.
 *
 *  Reads `expansion.contains[]` — the MATERIALIZED expansion the terminology store already writes
 *  onto the resource. The projection is pure and synchronous, so it cannot expand an intensional
 *  set itself; it does not need to, because the resource arrives already expanded.
 *
 *  `id` is `<value_set_id>|<system>|<code>` and MUST stay deterministic: reprojectAll recomputes it
 *  for every resource, and a non-deterministic id would duplicate the dimension on every rebuild
 *  rather than updating it in place. */
export function projectValueSet(r: Record<string, unknown>, prov: Provenance): Insertable<TerminologyCodesTable>[] {
  const valueSetId = String(r['id']);
  const url = str(r['url']);
  const expansion = r['expansion'] as Record<string, unknown> | undefined;
  const contains = (expansion?.['contains'] as unknown[] | undefined) ?? [];
  return contains.map((entry) => {
    const c = entry as Record<string, unknown>;
    const system = str(c['system']);
    const code = str(c['code']);
    return {
      id: `${valueSetId}|${system ?? ''}|${code ?? ''}`,
      value_set_id: valueSetId,
      value_set_url: url,
      system, code,
      display: str(c['display']),
      ...provColumns(prov),
    };
  });
}
```

⚠ Confirm `str` and `provColumns` exist in `./extract` with those names before using them — the
sibling projections import exactly these (`relational/facility.ts:4`), but read the file.

In `packages/db/src/relational/index.ts`: add `import { projectValueSet } from './value-set';` and
`export * from './value-set';` beside the siblings, add the case to **both** switches, and add the
scope helper:

```ts
    case 'ValueSet': return {
      table: 'terminology_codes',
      rows: projectValueSet(r, prov),
      scope: { column: 'value_set_id', value: String(r['id']) },
    };
```
```ts
    case 'ValueSet': return 'terminology_codes';
```
```ts
/** The column identifying rows owned by a fan-out resource, or null for one-row fact resources.
 *  `deleteById` needs this: a ValueSet's rows are keyed by a synthetic composite id, so deleting
 *  `where id = <resource id>` would match nothing and silently leave the whole dimension behind. */
export function scopeColumnFor(resourceType: string): string | null {
  return resourceType === 'ValueSet' ? 'value_set_id' : null;
}
```

⚠ `projectResource` and `tableForResourceType` must stay in lockstep — they are two switches over
the same mapping, and a case added to one and not the other means writes land but deletes do not.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run src/`
Expected: PASS — including Task 3's four writer cases, which needed this projection.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/relational/value-set.ts packages/db/src/relational/value-set.test.ts packages/db/src/relational/index.ts
git commit -m "feat(db): project a ValueSet expansion into the terminology dimension"
```

---

### Task 5: Make `reprojectAll` safe for scoped resources

**Files:**
- Modify: `packages/db/src/projection/cycle.ts:65-92` (only if the test proves it necessary)
- Test: `packages/db/src/projection/cycle.test.ts` (extend; check the file's existing idiom first)

**Interfaces:**
- Consumes: everything from Tasks 2-4.
- Produces: no new names.

**Why this task exists.** `reprojectAll` pages 1,000 resources at a time and hands each page to
`writeMany` (`cycle.ts:76-85`). Task 3 made `writeMany` apply scoped resources individually, which
*should* already be correct — **this task's job is to prove it, not to assume it.** ⚠ `reprojectAll`
has **no production callers**, so a defect here surfaces only when an operator runs a rebuild, long
after the code shipped. That is precisely why it needs a test rather than an argument.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/projection/cycle.test.ts`:

```ts
it('rebuilds two value sets in one batch without either erasing the other', async () => {
  const internalDb = await makeMigratedDb();          // follow this file's existing helper
  const externalDb = await makeMigratedExternalDb();
  const relationalWriter = createRelationalWriter(externalDb as any);

  const mk = (id: string, code: string) => ({
    resourceType: 'ValueSet', id, url: `urn:test:${id}`,
    expansion: { contains: [{ system: 'sys', code, display: code }] },
  });
  for (const r of [mk('vs1', 'A'), mk('vs2', 'B')]) {
    await internalDb.insertInto('fhir.fhir_resources')
      .values({ resource_type: 'ValueSet', id: r.id, version_id: '1', version: 1, resource: JSON.stringify(r) } as never)
      .execute();
  }

  await reprojectAll({ internalDb, relationalWriter });

  const rows = await sql<{ code: string }>`select code from terminology_codes order by code`.execute(externalDb);
  expect(rows.rows.map((r) => r.code)).toEqual(['A', 'B']);
  await internalDb.destroy(); await externalDb.destroy();
});
```

⚠ The `fhir_resources` insert columns above are a **SKETCH** — read `packages/db/src/fhir-store.ts`
around line 187 for the real column list and required fields, and match it. Do not guess.

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `cd packages/db && npx vitest run src/projection/cycle.test.ts`
**Either outcome is informative.** If it PASSES, Task 3's per-resource handling already covers the
rebuild path — record that, change no production code, and keep the test as the regression guard.
If it FAILS, `writeMany`'s grouping is wrong for the paged rebuild; fix it in Step 3.

- [ ] **Step 3: Fix only if Step 2 failed**

If red, the cause is scoped resources being batched. Make `reprojectAll` apply them one at a time,
or make `writeMany` order scoped applications after unscoped ones per table. Show the diff in your
report and re-run.

If green, write "no production change required" in your report and move to Step 4.

- [ ] **Step 4: Mutation-check the guard**

Whether or not Step 3 changed anything, remove the `if (p.scope) { scoped.push(p); return; }` guard
from `writeMany` and re-run this test. Expected: RED (one value set erases the other). Restore.
This proves the test actually covers the rebuild path rather than passing incidentally.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/projection/cycle.test.ts packages/db/src/projection/cycle.ts
git commit -m "test(db): pin that a rebuild does not let value sets erase each other"
```

---

### Task 6: Whole-slice verification

**Files:** none modified.

- [ ] **Step 1: Typecheck every package**

Run: `pnpm turbo run typecheck --force`
Expected: clean. `@openldr/cli#build` is a known Windows-only esbuild failure, not part of this gate.

- [ ] **Step 2: Full test gate**

Run: `pnpm turbo run test --force`
Expected: clean. If a package fails, re-run that package's `vitest run` alone before blaming this change, and grep for `Test timed out` first ([[test-gate-flakiness-timeouts]]).

- [ ] **Step 3: Prove it on the live dev warehouse**

The dev stack has 6 real ValueSets, one of which expands to 2,009 concepts — the case the design is built around, and one no unit test exercises at scale.

```bash
docker compose up -d postgres
```

Then run the projection against the dev DBs and confirm, with SQL:
1. `select value_set_id, count(*) from terminology_codes group by 1` returns 6 rows totalling 2,025 (2009+4+3+4+3+2 — verify the arithmetic against the live expansions rather than trusting this number).
2. Re-running the projection leaves the counts **unchanged** (idempotent, deterministic ids).
3. Removing one concept from a value set and reprojecting **decrements** that value set's count.

Record the real numbers in your report. ⚠ This is the step that would catch an MSSQL-style parameter blow-up or a non-deterministic id, neither of which pg-mem-scale tests can see.

- [ ] **Step 4: Report; commit nothing**

---

## Self-Review

**Spec coverage.** Design §1 D1 (extend `projectResource`) → Task 2. D2 (delete-not-in-set) → Task 3, implemented as delete-then-insert because §Global Constraints proves `not in` is impossible at 2,009 concepts. D3 (machinery alone) → the "Not in this plan" section below. §2 contract → Tasks 2 and 4. §3 open question 1 (`reprojectAll`) → Task 5, deliberately written to accept either outcome. §3 question 2 (dialect parity) → the delete is a single equality predicate, so it is dialect-neutral; the inserts reuse the existing per-dialect batch functions unchanged, and Task 6 Step 3 exercises Postgres for real. §3 question 3 (primary key) → answered in Task 1: a synthetic deterministic `id`, because all three upserts conflict on `id`.

**Placeholder scan.** Two steps are deliberately marked SKETCH rather than fabricated: Task 5 Step 1's `fhir_resources` insert columns (read `fhir-store.ts:187`) and Task 1 Step 3's `created_at` declaration (read `001_flat_tables.ts`). Task 3 Step 1 flags that its tests depend on Task 4. Task 6 Step 3's row count is given with an explicit instruction to verify the arithmetic rather than trust it.

**Type consistency.** `RelationalResult.rows`, `RelationalResult.scope`, `scope.column`, `scope.value`, `projectValueSet`, `scopeColumnFor`, `terminology_codes`, `value_set_id`, `TerminologyCodesTable` are spelled identically in Tasks 1-5. `deleteById` keeps its `(resourceType, id)` signature throughout.

**Ordering risk, stated plainly.** Task 3's tests need Task 4's projection. The tasks are ordered writer-then-projection because the writer is the risky half and deserves the earlier, closer review; the plan tells the implementer to expect a two-cause failure at Task 3 Step 2 and to state which order they chose.

## Not in this plan

Reference ranges and `ObservationDefinition` (S2a), result classification (S2b), the report-side join that consumes `terminology_codes`, and the units mojibake (S2c, which needs a discriminating-byte measurement first). This slice ends when a ValueSet's expansion appears in the warehouse, stays in step when it changes, and disappears when it is deleted. Nothing reads the dimension yet — the first reader is S2b.
