# Test mapping implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map each lab's own test codes to test catalog entries, and copy the result into a warehouse table `test_map` that report SQL can join.

**Architecture:** A mapping is an ordinary `term_mappings` row from the lab's `(panel_system, panel_code)` to a catalog code. One bootstrap module, `test-mapping.ts`, reads the observed codes from the warehouse, writes mappings through `TerminologyAdminStore.termMappings.saveExclusive`, and rebuilds `test_map` delete-then-insert. The routes, the CLI and the content pack installer all call that module. The studio gets an Observed tab on the Test catalog page.

**Tech stack:** TypeScript, Kysely (Postgres, MSSQL, MySQL warehouse), Fastify, Commander, React with shadcn and Radix, Vitest with pg-mem, react-i18next.

**Spec:** `docs/superpowers/specs/2026-10-11-test-mapping-design.md`. Read it before Task 1.

## Global constraints

- Catalog code system: `urn:openldr:codesystem:test-catalog` (`TEST_CATALOG_SYSTEM`, `packages/bootstrap/src/test-catalog.ts:30`).
- A test mapping: `from_system` = `lab_requests.panel_system`, `from_code` = `lab_requests.panel_code`, `to_system` = catalog, `map_type` = `'SAME-AS'`.
- Codes match exactly. No trimming, no case folding. The report join is SQL equality.
- `test_map.level` is `'test'` in this plan. The rebuild deletes only `level = 'test'` rows.
- `test_map` is rebuilt delete-then-insert in one transaction. Never upsert-then-prune.
- Insert chunks stay under MSSQL's ~2,000 bound parameters: 9 columns, so 200 rows per insert.
- External migration number: `023`. Run `git branch -a --no-merged origin/main` before Task 1 and check no branch adds an `023_` external migration.
- Studio rules (AGENTS.md §5): actions in a `MoreHorizontal` `DropdownMenu`, Sheets not Dialogs, labels left and inputs right, `TablePagination` on every table, `LoadingState` and `StripedEmpty` in a `colSpan` cell, shadcn components only.
- Every user-facing string exists in `en.ts`, `fr.ts` and `pt.ts`.
- Destructive CLI commands refuse without `--force`. CLI audit uses `cliActor()`.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`.
- No `Co-Authored-By` trailers. Commit only when the operator asks. The commit steps below run when the operator has said to commit.

## Where this plan departs from the spec

Each follows existing code, which the spec did not account for.

1. **A lab editing a central-owned mapping gets 409 with `kind: 'central-managed'`, not 403.** The catalog routes already answer that way (`apps/server/src/test-catalog-routes.ts:101-105`, `TestCatalogError` kinds at `packages/bootstrap/src/test-catalog.ts:180-185`).
2. **Refusals are `{ error, kind }`, not error-catalog codes.** Same source.
3. **The studio install confirm does not show the pack's mapped, kept and skipped lists.** It does not call the check today, for link-matching either (`packages/cli/src/market.ts:146` is the only reader of `linkPreview`). The CLI dry run shows them, and the install's audit row records them.
4. **Catalog edits trigger a rebuild through a new optional `onChanged` callback on `createTestCatalog`,** so the route and the CLI do not each have to remember.
5. **Sync bursts go through a coalescing runner.** One pull can carry hundreds of term mappings. The spec said "rebuild"; this rebuilds at most twice per burst.
6. **The Observed list leaves out warehouse rows whose `panel_system` or `panel_code` is null.** They cannot be mapped, because `term_mappings.from_system` and `from_code` are NOT NULL.
7. **A blank `catalog_code` and blank `loinc` in an imported CSV row means "no change".** An exported file lists unmapped codes with both blank, and re-importing it must not clear anything. Clearing is the Clear action and `map clear`.

The spec file gets a short "Changes during planning" note listing these seven. That is Task 11, Step 1.

## Review focus

Inputs the spec implies but no other test pins. Each has a test in the owning task.

1. **A pack lists the same lab code twice.** Expect one write; the second is skipped with "listed twice in this pack". Task 7.
2. **A mapping exists for a code the warehouse has not seen yet** (set from the CLI before data arrives). Expect it on the Observed list with 0 requests, not hidden. Task 2.
3. **Warehouse rows with a null `panel_system` or `panel_code`.** Expect them left out, no crash. Task 2.
4. **A CSV saved by Excel: BOM, CRLF line ends, a quoted description containing a comma.** Expect it parsed as three rows. Task 4.
5. **A sync pull applies 500 relevant records in a burst.** Expect at most two rebuild runs. Task 3.

## File map

| File | Responsibility |
|---|---|
| `packages/db/src/test-map.ts` (create) | `testMapId`, `TestMapLevel`. |
| `packages/db/src/migrations/external/023_test_map.ts` (create) | The table and its index. |
| `packages/db/src/schema/external.ts` (modify) | `TestMapTable`, `ExternalSchema.test_map`, `EXTERNAL_TABLE_COLUMNS.test_map`. |
| `packages/dashboards/src/models/registry.ts`, `apps/server/src/dashboards-routes.ts` (modify) | Data Exposure governance. |
| `packages/bootstrap/src/test-mapping.ts` (create) | Read side, rebuild, writes, CSV, pack planning, coalescer. |
| `packages/bootstrap/src/test-catalog.ts` (modify) | `onChanged` callback. |
| `packages/bootstrap/src/index.ts` (modify) | Wiring, boot rebuild, sync hook, pack deps. |
| `packages/marketplace/src/content-pack.ts` (modify) | The `test-mappings` step. |
| `packages/bootstrap/src/content-pack-install.ts` (modify) | Check and write passes. |
| `apps/server/src/test-mapping-routes.ts` (create) | HTTP routes. |
| `apps/server/src/terminology-admin-routes.ts` (modify) | Rebuild after a general mapping edit touching the catalog. |
| `packages/cli/src/test-mapping.ts` (create), `packages/cli/src/program.ts`, `packages/cli/src/market.ts` (modify) | CLI. |
| `apps/studio/src/api.ts` (modify) | Client functions and types. |
| `apps/studio/src/test-catalog/ObservedCodesTab.tsx`, `MapCodeSheet.tsx`, `ImportMappingsSheet.tsx` (create) | The tab and its sheets. |
| `apps/studio/src/pages/TestCatalog.tsx` (modify) | Tabs. |
| `apps/studio/src/i18n/{en,fr,pt}.ts` (modify) | Strings. |
| Docs (modify) | In-app and web docs in en, fr, pt. |

---

### Task 1: The `test_map` warehouse table

**Files:**
- Create: `packages/db/src/test-map.ts`, `packages/db/src/test-map.test.ts`
- Create: `packages/db/src/migrations/external/023_test_map.ts`, `packages/db/src/migrations/external/023_test_map.test.ts`
- Modify: `packages/db/src/index.ts:89-90`, `packages/db/src/migrations/external/index.ts`, `packages/db/src/migrations/migrations.test.ts`, `packages/db/src/schema/external.ts`
- Modify: `packages/dashboards/src/models/registry.ts:16-45`, `apps/server/src/dashboards-routes.ts:23-33`

**Interfaces:**
- Produces: `testMapId(level: TestMapLevel, sourceSystem: string, sourceCode: string): string` and `type TestMapLevel = 'test' | 'result'` from `@openldr/db`. `ExternalSchema['test_map']` typed as `TestMapTable`.

- [ ] **Step 1: Write the failing id test**

`packages/db/src/test-map.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { testMapId } from './test-map';

describe('testMapId', () => {
  it('is the readable level|system|code while it fits', () => {
    expect(testMapId('test', 'urn:openldr:disa', 'HIVVL')).toBe('test|urn:openldr:disa|HIVVL');
  });

  it('hashes past 200 characters, the same way every time', () => {
    const long = 'x'.repeat(250);
    const a = testMapId('test', 'urn:openldr:disa', long);
    expect(a).toMatch(/^tm-[0-9a-f]+$/);
    expect(testMapId('test', 'urn:openldr:disa', long)).toBe(a);
  });

  it('keeps the two levels apart for the same code', () => {
    expect(testMapId('test', 's', 'c')).not.toBe(testMapId('result', 's', 'c'));
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd packages/db && npx vitest run src/test-map.test.ts`
Expected: FAIL, cannot resolve `./test-map`.

- [ ] **Step 3: Write `test-map.ts`**

```ts
import { djb2Hex } from './relational/row-id';

// The warehouse copy of the test mappings (docs/superpowers/specs/2026-10-11-test-mapping-design.md, 4.2).

/** The levels a `test_map` row can hold. This slice writes 'test'. The result-field slice adds 'result'. */
export type TestMapLevel = 'test' | 'result';

const MAX_ID_LENGTH = 200;

/** `test_map.id`: readable `<level>|<system>|<code>` while it fits, else a djb2 hash of it. It must be
 *  deterministic, because every rebuild recomputes it. Same rule as `facilityMapId`. */
export function testMapId(level: TestMapLevel, sourceSystem: string, sourceCode: string): string {
  const readable = `${level}|${sourceSystem}|${sourceCode}`;
  return readable.length <= MAX_ID_LENGTH ? readable : `tm-${djb2Hex(readable)}`;
}
```

In `packages/db/src/index.ts`, after line 90, add:

```ts
export { testMapId } from './test-map';
export type { TestMapLevel } from './test-map';
```

- [ ] **Step 4: Run the id test and see it pass**

Run: `cd packages/db && npx vitest run src/test-map.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing migration test**

`packages/db/src/migrations/external/023_test_map.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDbWithMem } from '../../test-helpers-external';
import { collectCompiledSql } from './compile-test-helpers';
import * as m023 from './023_test_map';

// pg-mem checks the table on emulated Postgres. MySQL and MSSQL are checked offline against Kysely's
// real compilers, as in 022's test. Neither proves a real MSSQL or MySQL accepts it.
describe('023_test_map', () => {
  it('creates test_map with its columns and the source index', async () => {
    const { mem } = await makeMigratedExternalDbWithMem();
    const table = mem.public.getTable('test_map');
    expect(table.listColumns().map((c) => c.name).sort()).toEqual(
      ['catalog_code', 'catalog_name', 'category', 'id', 'level', 'loinc', 'source_code', 'source_system', 'updated_at'],
    );
    expect(table.listIndices().map((i) => i.name)).toContain('test_map_source_idx');
  });

  it('down() drops the table', async () => {
    const { mem, db } = await makeMigratedExternalDbWithMem();
    await m023.down(db);
    expect(() => mem.public.getTable('test_map')).toThrow();
  });

  it('uses key-sized columns on MySQL and MSSQL, and utf8mb4 on MySQL', async () => {
    const mysql = await collectCompiledSql('mysql', (db) => m023.up(db, 'mysql'));
    expect(mysql[0]).toContain('`level` varchar(255) not null');
    expect(mysql[0]).toContain('character set utf8mb4');
    expect(mysql[1]).toBe('create index `test_map_source_idx` on `test_map` (`level`, `source_system`, `source_code`)');
    const mssql = await collectCompiledSql('mssql', (db) => m023.up(db, 'mssql'));
    expect(mssql[0]).toContain('"source_code" varchar(450) not null');
    expect(mssql[1]).toBe('create index "test_map_source_idx" on "test_map" ("level", "source_system", "source_code")');
  });
});
```

- [ ] **Step 6: Run it and see it fail**

Run: `cd packages/db && npx vitest run src/migrations/external/023_test_map.test.ts`
Expected: FAIL, cannot resolve `./023_test_map`.

- [ ] **Step 7: Write the migration and register it**

`packages/db/src/migrations/external/023_test_map.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, timestampType, nowExpr } from './dialect';

// The warehouse copy of the test mappings (docs/superpowers/specs/2026-10-11-test-mapping-design.md,
// 4.2). term_mappings lives in the INTERNAL db, so a report can only join a lab's test code to its
// catalog test through a copy here, as 012_facility_map does for facilities.
//
// One row per (level, source_system, source_code). `id` is synthetic and deterministic for 012's
// reason: an MSSQL clustered key over keyType columns has no headroom.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  let built = db.schema.createTable('test_map')
    .addColumn('id', key, (c) => c.primaryKey())
    .addColumn('level', key, (c) => c.notNull())
    .addColumn('source_system', key, (c) => c.notNull())
    .addColumn('source_code', key, (c) => c.notNull())
    .addColumn('catalog_code', text)
    .addColumn('catalog_name', text)
    .addColumn('category', text)
    .addColumn('loinc', text)
    .addColumn('updated_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  await built.execute();
  // Every report join filters on all three together.
  await db.schema.createIndex('test_map_source_idx')
    .on('test_map').columns(['level', 'source_system', 'source_code']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('test_map').execute();
}
```

In `packages/db/src/migrations/external/index.ts` add `import * as m023 from './023_test_map';` after the `m022` import, and after the `'022_...'` entry:

```ts
    '023_test_map': { up: (db) => m023.up(db, engine), down: m023.down },
```

In `packages/db/src/migrations/migrations.test.ts`, append `'023_test_map'` to the end of the external list in the `expect(Object.keys(ext)).toEqual([...])` line.

- [ ] **Step 8: Add the schema type**

In `packages/db/src/schema/external.ts`, after `FacilityMapTable` (ends near line 202):

```ts
/** The warehouse copy of the test mappings (migration 023). One row per mapped lab code. */
export interface TestMapTable {
  id: string;
  /** 'test' for a lab test (panel) code. The result-field slice adds 'result'. */
  level: string;
  source_system: string;
  source_code: string;
  catalog_code: string | null;
  catalog_name: string | null;
  category: string | null;
  /** The catalog test's LOINC link. Portable pack SQL filters on it. */
  loinc: string | null;
  updated_at: Generated<Date>;
}
```

Add `test_map: TestMapTable;` to `ExternalSchema` after `facility_registry`, and to `EXTERNAL_TABLE_COLUMNS` after the `facility_registry` entry:

```ts
  test_map: ['id', 'level', 'source_system', 'source_code', 'catalog_code', 'catalog_name', 'category', 'loinc', 'updated_at'],
```

- [ ] **Step 9: Govern it**

In `packages/dashboards/src/models/registry.ts`, add to `HARDCODED_DENY_UNION` after `facility_map`:

```ts
  // test_map holds lab codes and catalog names, no patient data. Hide only the surrogate id; report
  // SQL joins on level, source_system and source_code.
  test_map: ['id'],
```

and to `PII_COLUMNS` after `facility_map: [],`:

```ts
  test_map: [],
```

In `apps/server/src/dashboards-routes.ts`, add to `GOVERNED` after the `facility_map` entry:

```ts
  // Test mapping spec 4.2: governed from the start, so no column is exposed by omission (FAC-P1-17).
  { table: 'test_map', label: 'Test Map' },
```

- [ ] **Step 10: Run the db tests and the two typechecks**

Run: `cd packages/db && npx vitest run src/test-map.test.ts src/migrations/external/023_test_map.test.ts src/migrations/migrations.test.ts`
Expected: PASS.

Run: `pnpm turbo run typecheck --force --concurrency=2 --filter @openldr/db --filter @openldr/dashboards --filter @openldr/server > /tmp/tc1.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Run the dashboards and server tests that pin the governed list: `cd apps/server && npx vitest run src/dashboards-routes.test.ts` and `cd packages/dashboards && npx vitest run`. If a test pins the exact `GOVERNED` list, add `test_map` to its expected value. Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/db/src/test-map.ts packages/db/src/test-map.test.ts packages/db/src/index.ts packages/db/src/migrations/external/023_test_map.ts packages/db/src/migrations/external/023_test_map.test.ts packages/db/src/migrations/external/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/external.ts packages/dashboards/src/models/registry.ts apps/server/src/dashboards-routes.ts
git commit -m "feat(db): test_map warehouse table for test mappings"
```

Add any test file changed in Step 10 by exact path.

---

### Task 2: Read side and rebuild

**Files:**
- Create: `packages/bootstrap/src/test-mapping.ts`, `packages/bootstrap/src/test-mapping.test.ts`, `packages/bootstrap/src/test-support/test-mapping-fixture.ts`
- Modify: `packages/bootstrap/src/index.ts` (export the module next to the `test-catalog` exports)

**Interfaces:**
- Consumes: `testMapId` from Task 1. `TEST_CATALOG_SYSTEM`, `TestCatalogError` from `./test-catalog`.
- Produces, all exported from `@openldr/bootstrap`:
  - `type ObservedStatus = 'unmapped' | 'mapped' | 'ambiguous'`
  - `interface ObservedTestCode { system: string; code: string; description: string | null; requests: number; lastSeen: string | null; status: ObservedStatus; catalog: { code: string; name: string | null; loinc: string | null } | null; centralManaged: boolean }`
  - `interface ObservedQuery { status: ObservedStatus | 'all'; q: string; limit: number; offset: number }`
  - `interface ObservedResult { rows: ObservedTestCode[]; total: number; warehouse: { stale: boolean; error: string | null } }`
  - `interface CatalogTarget { code: string; name: string | null; loinc: string | null; retired: boolean }`
  - `interface TestMapPublishResult { mapped: number; ambiguous: Array<{ system: string; code: string; catalogCodes: string[] }>; targetMissing: Array<{ system: string; code: string; catalogCode: string }>; written: number }`
  - `type RebuildOutcome = { ok: true; result: TestMapPublishResult } | { ok: false; error: string }`
  - `interface TestMappingDeps { internalDb: Kysely<InternalSchema>; externalDb: Kysely<ExternalSchema>; admin: TerminologyAdminStore; logger: { warn(obj: object, msg: string): void } }`
  - `function parseObservedQuery(raw: Record<string, unknown>): { ok: true; query: ObservedQuery } | { ok: false; error: string }`
  - `function createTestMapping(deps: TestMappingDeps): TestMapping`, where this task's part of `TestMapping` is `observed`, `targets`, `publish({ apply })`, `rebuildNow()`.

- [ ] **Step 1: Write the failing tests**

The shared helpers go in a fixture, not in a test file. Vitest registers a test file's `describe`
blocks again inside any file that imports it, so Tasks 3, 4 and 7 import this fixture instead.

`packages/bootstrap/src/test-support/test-mapping-fixture.ts`:

```ts
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import { createFhirStore, createTerminologyStore, createTerminologyAdminStore, type InternalSchema, type ValueSetProjection } from '@openldr/db';
import { LOINC_SYSTEM } from '@openldr/terminology';
import { TEST_CATALOG_SYSTEM } from '../test-catalog';
import { createTestMapping } from '../test-mapping';

// Shared by the test-mapping*.test.ts files: a migrated internal db, a migrated warehouse, the real
// terminology admin store, and helpers that seed catalog tests, mappings and lab requests.

export async function buildMapping() {
  const internalDb = await makeMigratedDb();
  const externalDb = await makeMigratedExternalDb();
  const fhirStore = createFhirStore(internalDb);
  const store = createTerminologyStore(internalDb, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(resource) {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url, version, kind, resourceId) { await store.saveSystem(url, version, kind, resourceId); },
    async deleteValueSetResource(url, id) {
      await fhirStore.delete('ValueSet', id);
      await internalDb.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const admin = createTerminologyAdminStore(internalDb, projection);
  const warnings: string[] = [];
  const mapping = createTestMapping({ internalDb, externalDb, admin, logger: { warn: (_o, msg) => { warnings.push(msg); } } });
  return { internalDb, externalDb, admin, mapping, warnings };
}

export async function seedCatalogTest(db: Kysely<InternalSchema>, code: string, display: string, opts: { category?: string; loinc?: string; status?: string } = {}) {
  await db.insertInto('terminology_concepts').values({
    system: TEST_CATALOG_SYSTEM, code, display, status: opts.status ?? 'ACTIVE',
    properties: JSON.stringify({ category: opts.category ?? null }) as never,
  }).execute();
  if (opts.loinc) {
    await db.insertInto('term_mappings').values({
      id: `loinc-${code}`, from_system: TEST_CATALOG_SYSTEM, from_code: code, to_system: LOINC_SYSTEM, to_code: opts.loinc,
      to_display: null, map_type: 'SAME-AS', relationship: null, owner: null, is_active: true, managed_origin: null,
    }).execute();
  }
}

export async function seedMapping(db: Kysely<InternalSchema>, id: string, system: string, code: string, catalogCode: string, opts: { active?: boolean; central?: boolean; mapType?: string } = {}) {
  await db.insertInto('term_mappings').values({
    id, from_system: system, from_code: code, to_system: TEST_CATALOG_SYSTEM, to_code: catalogCode,
    to_display: null, map_type: opts.mapType ?? 'SAME-AS', relationship: null, owner: null,
    is_active: opts.active ?? true, managed_origin: opts.central ? 'central' : null,
  }).execute();
}

export async function seedRequest(db: Kysely<any>, id: string, system: string | null, code: string | null, desc: string | null, authoredAt: string) {
  await db.insertInto('lab_requests').values({ id, panel_system: system, panel_code: code, panel_desc: desc, authored_at: authoredAt }).execute();
}
```

`packages/bootstrap/src/test-mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseObservedQuery } from './test-mapping';
import { buildMapping, seedCatalogTest, seedMapping, seedRequest } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';

describe('test mapping: read side and rebuild', () => {
  it('publishes one test_map row per mapped code, with the catalog name, category and LOINC', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { category: 'MOL', loinc: '25836-8' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedMapping(internalDb, 'm2', DISA, 'POCVR', 'VL');

    const result = await mapping.publish({ apply: true });

    expect(result).toEqual({ mapped: 2, ambiguous: [], targetMissing: [], written: 2 });
    const rows = await externalDb.selectFrom('test_map').selectAll().orderBy('source_code').execute();
    expect(rows.map((r) => [r.id, r.level, r.source_system, r.source_code, r.catalog_code, r.catalog_name, r.category, r.loinc])).toEqual([
      [`test|${DISA}|HIVVL`, 'test', DISA, 'HIVVL', 'VL', 'HIV viral load', 'MOL', '25836-8'],
      [`test|${DISA}|POCVR`, 'test', DISA, 'POCVR', 'VL', 'HIV viral load', 'MOL', '25836-8'],
    ]);
  });

  it('leaves out an ambiguous code and a code whose catalog test is gone, and reports both', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedCatalogTest(internalDb, 'EID', 'Early infant diagnosis');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedMapping(internalDb, 'm2', DISA, 'HIVVL', 'EID', { mapType: 'NARROWER-THAN' });
    await seedMapping(internalDb, 'm3', DISA, 'OLD', 'GONE');

    const result = await mapping.publish({ apply: true });

    expect(result.ambiguous).toEqual([{ system: DISA, code: 'HIVVL', catalogCodes: ['EID', 'VL'] }]);
    expect(result.targetMissing).toEqual([{ system: DISA, code: 'OLD', catalogCode: 'GONE' }]);
    expect(await externalDb.selectFrom('test_map').selectAll().execute()).toEqual([]);
  });

  it('maps to a retired catalog test, because old results still belong to it', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { status: 'DEPRECATED' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    expect((await mapping.publish({ apply: true })).mapped).toBe(1);
  });

  it('counts two rows naming the same target once, not as ambiguous', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedMapping(internalDb, 'm2', DISA, 'HIVVL', 'VL', { mapType: 'RELATED-TO' });
    expect((await mapping.publish({ apply: true })).ambiguous).toEqual([]);
  });

  it('ignores inactive mappings', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL', { active: false });
    expect((await mapping.publish({ apply: true })).mapped).toBe(0);
  });

  it('replaces every test-level row on each rebuild and writes nothing without apply', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await mapping.publish({ apply: true });
    await internalDb.updateTable('term_mappings').set({ is_active: false }).where('id', '=', 'm1').execute();

    expect((await mapping.publish({ apply: false })).mapped).toBe(0);
    expect(await externalDb.selectFrom('test_map').selectAll().execute()).toHaveLength(1);
    await mapping.publish({ apply: true });
    expect(await externalDb.selectFrom('test_map').selectAll().execute()).toHaveLength(0);
  });

  it('lists observed codes with counts, newest date and status, ordered by system then code', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL', { central: true });
    await seedRequest(externalDb, 'r1', DISA, 'HIVVL', 'HIV Viral Load', '2026-05-01T08:00:00Z');
    await seedRequest(externalDb, 'r2', DISA, 'HIVVL', 'HIV Viral Load', '2026-05-03T08:00:00Z');
    await seedRequest(externalDb, 'r3', DISA, 'CD4', 'CD4 count', '2026-05-02T08:00:00Z');

    const out = await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 });

    expect(out.total).toBe(2);
    expect(out.rows.map((r) => [r.code, r.requests, r.status, r.catalog?.code ?? null, r.catalog?.loinc ?? null, r.centralManaged])).toEqual([
      ['CD4', 1, 'unmapped', null, null, false],
      ['HIVVL', 2, 'mapped', 'VL', '25836-8', true],
    ]);
    expect(out.rows[1].lastSeen?.startsWith('2026-05-03')).toBe(true);
    expect(out.warehouse).toEqual({ stale: false, error: null });
  });

  // Review focus 2.
  it('lists a mapped code the warehouse has not seen yet, with 0 requests', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'POHVL', 'VL');
    const out = await mapping.observed({ status: 'mapped', q: '', limit: 25, offset: 0 });
    expect(out.rows.map((r) => [r.code, r.requests, r.lastSeen])).toEqual([['POHVL', 0, null]]);
  });

  // Review focus 3.
  it('leaves out warehouse rows with no code system or no code', async () => {
    const { externalDb, mapping } = await buildMapping();
    await seedRequest(externalDb, 'r1', null, 'HIVVL', null, '2026-05-01T08:00:00Z');
    await seedRequest(externalDb, 'r2', DISA, null, null, '2026-05-01T08:00:00Z');
    expect((await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 })).total).toBe(0);
  });

  it('matches codes exactly: a trailing space is a different code', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedRequest(externalDb, 'r1', DISA, 'HIVVL ', null, '2026-05-01T08:00:00Z');
    const out = await mapping.observed({ status: 'unmapped', q: '', limit: 25, offset: 0 });
    expect(out.rows.map((r) => r.code)).toEqual(['HIVVL ']);
  });

  it('filters by status and searches code, description and catalog name', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedRequest(externalDb, 'r1', DISA, 'HIVVL', null, '2026-05-01T08:00:00Z');
    await seedRequest(externalDb, 'r2', DISA, 'CD4', 'CD4 count', '2026-05-01T08:00:00Z');
    expect((await mapping.observed({ status: 'unmapped', q: '', limit: 25, offset: 0 })).rows.map((r) => r.code)).toEqual(['CD4']);
    expect((await mapping.observed({ status: 'all', q: 'viral', limit: 25, offset: 0 })).rows.map((r) => r.code)).toEqual(['HIVVL']);
    expect((await mapping.observed({ status: 'all', q: 'cd4 COUNT', limit: 25, offset: 0 })).rows.map((r) => r.code)).toEqual(['CD4']);
  });

  it('pages after sorting', async () => {
    const { externalDb, mapping } = await buildMapping();
    for (const c of ['C', 'A', 'B']) await seedRequest(externalDb, `r${c}`, DISA, c, null, '2026-05-01T08:00:00Z');
    const page = await mapping.observed({ status: 'all', q: '', limit: 2, offset: 1 });
    expect([page.total, page.rows.map((r) => r.code)]).toEqual([3, ['B', 'C']]);
  });

  it('lists catalog targets with their LOINC, sorted by code', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedCatalogTest(internalDb, 'CD4', 'CD4 count', { status: 'DEPRECATED' });
    expect(await mapping.targets()).toEqual([
      { code: 'CD4', name: 'CD4 count', loinc: null, retired: true },
      { code: 'VL', name: 'HIV viral load', loinc: '25836-8', retired: false },
    ]);
  });

  it('rebuildNow records a failure, warns, and the next observed read reports the copy stale', async () => {
    const { internalDb, externalDb, mapping, warnings } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await externalDb.schema.dropTable('test_map').execute();

    const outcome = await mapping.rebuildNow();

    expect(outcome.ok).toBe(false);
    expect(warnings).toEqual(['test_map rebuild failed']);
    const out = await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 });
    expect(out.warehouse.stale).toBe(true);
    expect(out.warehouse.error).not.toBeNull();
  });
});

describe('parseObservedQuery', () => {
  it('defaults to all, no search, 25 rows from 0', () => {
    expect(parseObservedQuery({})).toEqual({ ok: true, query: { status: 'all', q: '', limit: 25, offset: 0 } });
  });
  it('refuses an unknown status and a limit out of range', () => {
    expect(parseObservedQuery({ status: 'gone' })).toEqual({ ok: false, error: 'status must be unmapped, mapped, ambiguous or all' });
    expect(parseObservedQuery({ limit: '0' })).toEqual({ ok: false, error: 'limit must be a whole number from 1 to 200' });
    expect(parseObservedQuery({ offset: '-1' })).toEqual({ ok: false, error: 'offset must be a whole number from 0' });
  });
});
```

If `lab_requests` has a NOT NULL column without a default that `seedRequest` omits, the insert fails in Step 2 with that column's name. Add it to `seedRequest` with a fixed value, and nothing else.

- [ ] **Step 2: Run them and see them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping.test.ts`
Expected: FAIL, cannot resolve `./test-mapping`.

- [ ] **Step 3: Write the read side and rebuild**

`packages/bootstrap/src/test-mapping.ts`:

```ts
import type { Kysely } from 'kysely';
import { testMapId, type ExternalSchema, type InternalSchema, type MapType, type TerminologyAdminStore } from '@openldr/db';
import { LOINC_SYSTEM } from '@openldr/terminology';
import { TEST_CATALOG_SYSTEM } from './test-catalog';

// Test mapping (docs/superpowers/specs/2026-10-11-test-mapping-design.md). Each lab's own test codes,
// as the warehouse stores them in lab_requests.panel_system and panel_code, map to catalog tests
// through ordinary term_mappings rows. The route, the CLI and the content pack installer all call
// this module (AGENTS.md section 6), and test_map is the warehouse copy report SQL joins.

/** Must equal the map type the catalog's LOINC link uses (test-catalog.ts, LOINC_MAP_TYPE). */
const MAP_TYPE = 'SAME-AS' as const;
/** The catalog's retired status (test-catalog.ts, RETIRED_STATUS). */
const RETIRED = 'DEPRECATED';
/** 9 columns per row keeps one insert under MSSQL's ~2,000 bound parameters. */
const INSERT_CHUNK = 200;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const STATUSES = ['unmapped', 'mapped', 'ambiguous', 'all'] as const;

export type ObservedStatus = 'unmapped' | 'mapped' | 'ambiguous';

export interface ObservedTestCode {
  system: string;
  code: string;
  description: string | null;
  /** Requests carrying this code in the warehouse. 0 for a code mapped before any data arrived. */
  requests: number;
  lastSeen: string | null;
  status: ObservedStatus;
  catalog: { code: string; name: string | null; loinc: string | null } | null;
  /** Central sent this mapping down. A lab cannot change it. */
  centralManaged: boolean;
}

export interface ObservedQuery { status: ObservedStatus | 'all'; q: string; limit: number; offset: number }

export interface ObservedResult {
  rows: ObservedTestCode[];
  total: number;
  /** The last rebuild in this process failed, so test_map may be out of date. Boot rebuilds again. */
  warehouse: { stale: boolean; error: string | null };
}

export interface CatalogTarget { code: string; name: string | null; loinc: string | null; retired: boolean }

export interface TestMapPublishResult {
  mapped: number;
  ambiguous: Array<{ system: string; code: string; catalogCodes: string[] }>;
  targetMissing: Array<{ system: string; code: string; catalogCode: string }>;
  written: number;
}

export type RebuildOutcome = { ok: true; result: TestMapPublishResult } | { ok: false; error: string };

export interface TestMappingDeps {
  internalDb: Kysely<InternalSchema>;
  externalDb: Kysely<ExternalSchema>;
  admin: TerminologyAdminStore;
  logger: { warn(obj: object, msg: string): void };
}

type MappingRow = { id: string; from_system: string; from_code: string; to_code: string; to_display: string | null; map_type: string; managed_origin: string | null };
type CatalogEntry = { name: string | null; category: string | null; loinc: string | null; retired: boolean };
type Resolved =
  | { kind: 'mapped'; catalogCode: string }
  | { kind: 'ambiguous'; catalogCodes: string[] }
  | { kind: 'missing'; catalogCode: string };

const sourceKey = (system: string, code: string): string => `${system}\u0000${code}`;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function categoryOf(properties: unknown): string | null {
  const value = typeof properties === 'string' ? (JSON.parse(properties) as unknown) : properties;
  const category = (value as { category?: unknown } | null)?.category;
  return typeof category === 'string' && category !== '' ? category : null;
}

/** Read list filters from a query string or CLI flags. The route and `openldr test-catalog map list`
 *  both call this, so a bad value is refused in the same words at either door. */
export function parseObservedQuery(raw: Record<string, unknown>): { ok: true; query: ObservedQuery } | { ok: false; error: string } {
  const status = raw.status === undefined || raw.status === '' ? 'all' : String(raw.status);
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'status must be unmapped, mapped, ambiguous or all' };
  const limitRaw = raw.limit === undefined || raw.limit === '' ? String(DEFAULT_LIMIT) : String(raw.limit);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? '0' : String(raw.offset);
  if (!/^\d+$/.test(offsetRaw)) return { ok: false, error: 'offset must be a whole number from 0' };
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';
  return { ok: true, query: { status: status as ObservedQuery['status'], q, limit, offset: Number(offsetRaw) } };
}

export function createTestMapping(deps: TestMappingDeps) {
  const { internalDb, externalDb } = deps;
  let lastRebuild: { ok: boolean; error: string | null } = { ok: true, error: null };

  async function readCatalog(): Promise<Map<string, CatalogEntry>> {
    const concepts = await internalDb.selectFrom('terminology_concepts')
      .select(['code', 'display', 'status', 'properties'])
      .where('system', '=', TEST_CATALOG_SYSTEM).execute();
    const links = await internalDb.selectFrom('term_mappings').select(['from_code', 'to_code'])
      .where('from_system', '=', TEST_CATALOG_SYSTEM).where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', MAP_TYPE).where('is_active', '=', true).execute();
    const loinc = new Map(links.map((l) => [l.from_code, l.to_code]));
    return new Map(concepts.map((c) => [c.code, {
      name: c.display, category: categoryOf(c.properties), loinc: loinc.get(c.code) ?? null, retired: c.status === RETIRED,
    }]));
  }

  async function readMappings(): Promise<MappingRow[]> {
    return internalDb.selectFrom('term_mappings')
      .select(['id', 'from_system', 'from_code', 'to_code', 'to_display', 'map_type', 'managed_origin'])
      .where('to_system', '=', TEST_CATALOG_SYSTEM).where('is_active', '=', true).execute();
  }

  function resolveAll(rows: MappingRow[], catalog: Map<string, CatalogEntry>): Map<string, { system: string; code: string; resolved: Resolved; central: boolean }> {
    const groups = new Map<string, MappingRow[]>();
    for (const r of rows) {
      const k = sourceKey(r.from_system, r.from_code);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const out = new Map<string, { system: string; code: string; resolved: Resolved; central: boolean }>();
    for (const [k, group] of groups) {
      // Distinct targets, not rows: two rows naming one test resolve the same way.
      const targets = [...new Set(group.map((g) => g.to_code))].sort(compare);
      const resolved: Resolved = targets.length > 1
        ? { kind: 'ambiguous', catalogCodes: targets }
        : catalog.has(targets[0]) ? { kind: 'mapped', catalogCode: targets[0] } : { kind: 'missing', catalogCode: targets[0] };
      out.set(k, { system: group[0].from_system, code: group[0].from_code, resolved, central: group.some((g) => g.managed_origin === 'central') });
    }
    return out;
  }

  async function publish(opts: { apply: boolean }): Promise<TestMapPublishResult> {
    const catalog = await readCatalog();
    const resolved = [...resolveAll(await readMappings(), catalog).values()];
    const mapped = resolved.filter((r) => r.resolved.kind === 'mapped');
    const rows = mapped.map((r) => {
      const catalogCode = (r.resolved as { catalogCode: string }).catalogCode;
      const entry = catalog.get(catalogCode)!;
      return {
        id: testMapId('test', r.system, r.code), level: 'test', source_system: r.system, source_code: r.code,
        catalog_code: catalogCode, catalog_name: entry.name, category: entry.category, loinc: entry.loinc,
      };
    });
    const result: TestMapPublishResult = {
      mapped: mapped.length,
      ambiguous: resolved.flatMap((r) => (r.resolved.kind === 'ambiguous' ? [{ system: r.system, code: r.code, catalogCodes: r.resolved.catalogCodes }] : [])),
      targetMissing: resolved.flatMap((r) => (r.resolved.kind === 'missing' ? [{ system: r.system, code: r.code, catalogCode: r.resolved.catalogCode }] : [])),
      written: rows.length,
    };
    if (!opts.apply) return result;
    // Delete then insert in one transaction, so a reader never sees the table empty. Only this
    // level's rows: the result-field slice owns the 'result' rows.
    await externalDb.transaction().execute(async (trx) => {
      await trx.deleteFrom('test_map').where('level', '=', 'test').execute();
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await trx.insertInto('test_map').values(rows.slice(i, i + INSERT_CHUNK)).execute();
      }
    });
    return result;
  }

  /** Rebuild test_map now. Never throws: a failure is logged, kept for the Observed list, and returned. */
  async function rebuildNow(): Promise<RebuildOutcome> {
    try {
      const result = await publish({ apply: true });
      lastRebuild = { ok: true, error: null };
      return { ok: true, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      lastRebuild = { ok: false, error };
      deps.logger.warn({ err }, 'test_map rebuild failed');
      return { ok: false, error };
    }
  }

  async function readObservedGroups(): Promise<Array<{ system: string; code: string; description: string | null; requests: number; lastSeen: string | null }>> {
    const rows = await externalDb.selectFrom('lab_requests')
      .select((eb) => [
        'panel_system', 'panel_code',
        eb.fn.max('panel_desc').as('description'),
        eb.fn.countAll().as('requests'),
        eb.fn.max('authored_at').as('last_seen'),
      ])
      .where('panel_system', 'is not', null)
      .where('panel_code', 'is not', null)
      .groupBy(['panel_system', 'panel_code'])
      .execute();
    return rows.map((r) => {
      const last = r.last_seen as unknown;
      return {
        system: r.panel_system as string, code: r.panel_code as string,
        description: (r.description as string | null) ?? null,
        requests: Number(r.requests),
        lastSeen: last === null || last === undefined ? null : last instanceof Date ? last.toISOString() : String(last),
      };
    });
  }

  async function observedAll(): Promise<ObservedTestCode[]> {
    const catalog = await readCatalog();
    const resolved = resolveAll(await readMappings(), catalog);
    const seen = new Map((await readObservedGroups()).map((g) => [sourceKey(g.system, g.code), g]));
    // A code mapped before any data arrived is still listed, so a CLI-made mapping is never invisible.
    for (const [k, r] of resolved) {
      if (!seen.has(k)) seen.set(k, { system: r.system, code: r.code, description: null, requests: 0, lastSeen: null });
    }
    const rows = [...seen.entries()].map(([k, g]): ObservedTestCode => {
      const r = resolved.get(k);
      const kind = r?.resolved.kind;
      const catalogCode = kind === 'mapped' ? (r!.resolved as { catalogCode: string }).catalogCode : null;
      const entry = catalogCode ? catalog.get(catalogCode)! : null;
      return {
        ...g,
        status: kind === 'mapped' ? 'mapped' : kind === 'ambiguous' ? 'ambiguous' : 'unmapped',
        catalog: catalogCode ? { code: catalogCode, name: entry!.name, loinc: entry!.loinc } : null,
        centralManaged: r?.central ?? false,
      };
    });
    return rows.sort((a, b) => compare(a.system, b.system) || compare(a.code, b.code));
  }

  async function observed(query: ObservedQuery): Promise<ObservedResult> {
    const needle = query.q.toLowerCase();
    const matched = (await observedAll()).filter((r) => (query.status === 'all' || r.status === query.status)
      && (needle === '' || [r.code, r.description, r.catalog?.name].some((v) => (v ?? '').toLowerCase().includes(needle))));
    return {
      rows: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
      warehouse: { stale: !lastRebuild.ok, error: lastRebuild.error },
    };
  }

  async function targets(): Promise<CatalogTarget[]> {
    return [...(await readCatalog()).entries()]
      .map(([code, e]) => ({ code, name: e.name, loinc: e.loinc, retired: e.retired }))
      .sort((a, b) => compare(a.code, b.code));
  }

  return { observed, observedAll, targets, publish, rebuildNow, readCatalog, readMappings };
}

export type TestMapping = ReturnType<typeof createTestMapping>;
```

In `packages/bootstrap/src/index.ts`, next to the existing `export ... from './test-catalog'` lines, add:

```ts
export * from './test-mapping';
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping.test.ts`
Expected: PASS. If the `lastSeen` test fails because pg-mem returns a different date format, keep the `startsWith('2026-05-03')` assertion and change only how `lastSeen` is formatted.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/test-mapping.ts packages/bootstrap/src/test-mapping.test.ts packages/bootstrap/src/test-support/test-mapping-fixture.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): read observed test codes and rebuild test_map"
```

---

### Task 3: Writes, guards and the coalescing runner

**Files:**
- Modify: `packages/bootstrap/src/test-mapping.ts`
- Create: `packages/bootstrap/src/test-mapping-write.test.ts`

**Interfaces:**
- Consumes: Task 2's module and fixture (`buildMapping`, `seedCatalogTest`, `seedMapping`, `seedRequest` from `test-support/test-mapping-fixture.ts`).
- Produces:
  - `interface TestMappingChange { system: string; code: string; before: string | null; after: string | null; rebuild: RebuildOutcome }`
  - On `TestMapping`: `set(system: string, code: string, catalogCode: string): Promise<TestMappingChange>`, `clear(system: string, code: string): Promise<TestMappingChange>`, `requestRebuild(): Promise<void>`, and the private helper `writeMapping` used by Tasks 4 and 7.
  - `function createCoalescedRunner(run: () => Promise<void>): () => Promise<void>`
  - `function mappingTouchesTestMap(fromSystem: string | null | undefined, toSystem: string | null | undefined): boolean`
  - `function isTestMapRelevantRecord(rec: { entityType: string; body: unknown }): boolean`

- [ ] **Step 1: Write the failing tests**

`packages/bootstrap/src/test-mapping-write.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TEST_CATALOG_SYSTEM, TestCatalogError } from './test-catalog';
import { createCoalescedRunner, isTestMapRelevantRecord, mappingTouchesTestMap } from './test-mapping';
import { buildMapping, seedCatalogTest, seedMapping } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';

async function active(db: Awaited<ReturnType<typeof buildMapping>>['internalDb'], code: string) {
  return db.selectFrom('term_mappings').select(['to_code', 'map_type'])
    .where('from_system', '=', DISA).where('from_code', '=', code)
    .where('to_system', '=', TEST_CATALOG_SYSTEM).where('is_active', '=', true).execute();
}

describe('test mapping: writes', () => {
  it('set writes one SAME-AS mapping, rebuilds, and reports before and after', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');

    const change = await mapping.set(DISA, 'HIVVL', 'VL');

    expect([change.before, change.after, change.rebuild.ok]).toEqual([null, 'VL', true]);
    expect(await active(internalDb, 'HIVVL')).toEqual([{ to_code: 'VL', map_type: 'SAME-AS' }]);
    expect(await externalDb.selectFrom('test_map').select('source_code').execute()).toEqual([{ source_code: 'HIVVL' }]);
  });

  it('set replaces the earlier target and deactivates any other active mapping, whatever its type', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedCatalogTest(internalDb, 'EID', 'Early infant diagnosis');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'EID');
    await seedMapping(internalDb, 'm2', DISA, 'HIVVL', 'EID', { mapType: 'NARROWER-THAN' });

    const change = await mapping.set(DISA, 'HIVVL', 'VL');

    expect(change.before).toBe('EID');
    expect(await active(internalDb, 'HIVVL')).toEqual([{ to_code: 'VL', map_type: 'SAME-AS' }]);
  });

  it('set refuses an unknown catalog code as invalid', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.set(DISA, 'HIVVL', 'NOPE')).rejects.toMatchObject({ kind: 'invalid', message: 'no catalog test has code NOPE' });
  });

  it('set and clear refuse a mapping central sent down', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL', { central: true });
    await expect(mapping.set(DISA, 'HIVVL', 'VL')).rejects.toBeInstanceOf(TestCatalogError);
    await expect(mapping.set(DISA, 'HIVVL', 'VL')).rejects.toMatchObject({ kind: 'central-managed' });
    await expect(mapping.clear(DISA, 'HIVVL')).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('set refuses a blank system or code', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.set(' ', 'HIVVL', 'VL')).rejects.toMatchObject({ kind: 'invalid', message: 'system and code are required' });
  });

  it('clear deactivates every active catalog mapping for the code and rebuilds', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await mapping.set(DISA, 'HIVVL', 'VL');

    const change = await mapping.clear(DISA, 'HIVVL');

    expect([change.before, change.after, change.rebuild.ok]).toEqual(['VL', null, true]);
    expect(await active(internalDb, 'HIVVL')).toEqual([]);
    expect(await externalDb.selectFrom('test_map').selectAll().execute()).toEqual([]);
  });

  it('clear refuses a code with no mapping as not-found', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.clear(DISA, 'HIVVL')).rejects.toMatchObject({ kind: 'not-found', message: 'HIVVL has no catalog mapping' });
  });
});

describe('createCoalescedRunner', () => {
  // Review focus 5.
  it('runs at most twice for a burst of 500 requests', async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const request = createCoalescedRunner(async () => { runs += 1; if (runs === 1) await gate; });
    const all = Array.from({ length: 500 }, () => request());
    release();
    await Promise.all(all);
    expect(runs).toBe(2);
  });

  it('runs again for a request made after the burst finished', async () => {
    let runs = 0;
    const request = createCoalescedRunner(async () => { runs += 1; });
    await request();
    await request();
    expect(runs).toBe(2);
  });
});

describe('which changes touch test_map', () => {
  it('a mapping to or from the catalog does', () => {
    expect(mappingTouchesTestMap('urn:openldr:disa', TEST_CATALOG_SYSTEM)).toBe(true);
    expect(mappingTouchesTestMap(TEST_CATALOG_SYSTEM, 'http://loinc.org')).toBe(true);
    expect(mappingTouchesTestMap('urn:x', 'urn:y')).toBe(false);
  });

  it('a synced term mapping into the catalog, a mapping delete, and the catalog system itself do', () => {
    expect(isTestMapRelevantRecord({ entityType: 'term_mapping', body: { fromSystem: 'urn:openldr:disa', toSystem: TEST_CATALOG_SYSTEM } })).toBe(true);
    expect(isTestMapRelevantRecord({ entityType: 'term_mapping', body: null })).toBe(true);
    expect(isTestMapRelevantRecord({ entityType: 'term_mapping', body: { fromSystem: 'urn:x', toSystem: 'urn:y' } })).toBe(false);
    expect(isTestMapRelevantRecord({ entityType: 'terminology_system', body: { url: TEST_CATALOG_SYSTEM } })).toBe(true);
    expect(isTestMapRelevantRecord({ entityType: 'terminology_system', body: { url: 'urn:other' } })).toBe(false);
    expect(isTestMapRelevantRecord({ entityType: 'dashboard', body: {} })).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-write.test.ts`
Expected: FAIL, `createCoalescedRunner` is not exported.

- [ ] **Step 3: Add the writes and helpers**

In `packages/bootstrap/src/test-mapping.ts`, add `TestCatalogError` to the `./test-catalog` import, and add before `createTestMapping`:

```ts
export interface TestMappingChange {
  system: string;
  code: string;
  before: string | null;
  after: string | null;
  rebuild: RebuildOutcome;
}

/** Coalesce rebuild requests. One run at a time; requests made while it runs share one more run.
 *  A sync pull can apply hundreds of relevant records, and each must not cost a rebuild. */
export function createCoalescedRunner(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const loop = async (): Promise<void> => {
    try {
      do {
        again = false;
        await run();
      } while (again);
    } finally {
      running = null;
    }
  };
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = loop();
    return running;
  };
}

/** A term mapping into the catalog is a test mapping. One out of the catalog is its LOINC link. Both
 *  change test_map. */
export function mappingTouchesTestMap(fromSystem: string | null | undefined, toSystem: string | null | undefined): boolean {
  return toSystem === TEST_CATALOG_SYSTEM || fromSystem === TEST_CATALOG_SYSTEM;
}

/** Whether a record a lab pulled from central changes test_map. A term mapping delete carries no body,
 *  so it counts: a spare rebuild is cheap, a missed one leaves reports wrong. */
export function isTestMapRelevantRecord(rec: { entityType: string; body: unknown }): boolean {
  const body = rec.body as { fromSystem?: string; toSystem?: string; url?: string } | null;
  if (rec.entityType === 'term_mapping') return body === null || body === undefined || mappingTouchesTestMap(body.fromSystem, body.toSystem);
  if (rec.entityType === 'terminology_system') return body?.url === TEST_CATALOG_SYSTEM;
  return false;
}
```

Inside `createTestMapping`, before `return`, add:

```ts
  async function activeFor(system: string, code: string): Promise<MappingRow[]> {
    return internalDb.selectFrom('term_mappings')
      .select(['id', 'from_system', 'from_code', 'to_code', 'to_display', 'map_type', 'managed_origin'])
      .where('from_system', '=', system).where('from_code', '=', code)
      .where('to_system', '=', TEST_CATALOG_SYSTEM).where('is_active', '=', true).execute();
  }

  function assertSource(system: string, code: string): void {
    if (system.trim() === '' || code.trim() === '') throw new TestCatalogError('system and code are required', 'invalid');
  }

  function assertNotCentral(rows: MappingRow[], code: string): void {
    if (rows.some((r) => r.managed_origin === 'central')) {
      throw new TestCatalogError(`central maps ${code}; a lab cannot change it`, 'central-managed');
    }
  }

  async function deactivate(row: MappingRow): Promise<void> {
    await deps.admin.termMappings.update(row.id, {
      fromSystem: row.from_system, fromCode: row.from_code, toSystem: TEST_CATALOG_SYSTEM, toCode: row.to_code,
      toDisplay: row.to_display, mapType: row.map_type as MapType, isActive: false,
    });
  }

  /** Make `catalogCode` the one active catalog mapping for this code. No guard and no rebuild: the
   *  callers (set, CSV import, pack install) check first and rebuild once at the end. */
  async function writeMapping(system: string, code: string, catalogCode: string, name: string | null): Promise<void> {
    const saved = await deps.admin.termMappings.saveExclusive({
      fromSystem: system, fromCode: code, toSystem: TEST_CATALOG_SYSTEM, toCode: catalogCode,
      toDisplay: name, mapType: MAP_TYPE, isActive: true,
    });
    // saveExclusive supersedes only SAME-AS rows. One made through the general mapping dialog with
    // another type would stay active and make the code ambiguous, so it goes too.
    for (const other of await activeFor(system, code)) {
      if (other.id !== saved.mapping.id) await deactivate(other);
    }
  }

  async function set(system: string, code: string, catalogCode: string): Promise<TestMappingChange> {
    assertSource(system, code);
    const entry = (await readCatalog()).get(catalogCode);
    if (!entry) throw new TestCatalogError(`no catalog test has code ${catalogCode}`, 'invalid');
    const existing = await activeFor(system, code);
    assertNotCentral(existing, code);
    const before = existing.map((r) => r.to_code).sort(compare)[0] ?? null;
    await writeMapping(system, code, catalogCode, entry.name);
    return { system, code, before, after: catalogCode, rebuild: await rebuildNow() };
  }

  async function clear(system: string, code: string): Promise<TestMappingChange> {
    assertSource(system, code);
    const existing = await activeFor(system, code);
    if (existing.length === 0) throw new TestCatalogError(`${code} has no catalog mapping`, 'not-found');
    assertNotCentral(existing, code);
    for (const row of existing) await deactivate(row);
    return { system, code, before: existing.map((r) => r.to_code).sort(compare)[0], after: null, rebuild: await rebuildNow() };
  }

  const requestRebuild = createCoalescedRunner(async () => { await rebuildNow(); });
```

Change the `return` to:

```ts
  return { observed, observedAll, targets, publish, rebuildNow, requestRebuild, set, clear, writeMapping, activeFor, readCatalog, readMappings };
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-write.test.ts src/test-mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/test-mapping.ts packages/bootstrap/src/test-mapping-write.test.ts
git commit -m "feat(bootstrap): set and clear test mappings, with coalesced rebuilds"
```

---

### Task 4: CSV export and import

**Files:**
- Modify: `packages/bootstrap/src/test-mapping.ts`
- Create: `packages/bootstrap/src/test-mapping-csv.test.ts`

**Interfaces:**
- Consumes: `readTableFile`, `TableFileError` from `./table-file`. `toCsv` from `@openldr/reporting`. Task 3's `writeMapping`, `activeFor`.
- Produces:
  - `const TEST_MAPPING_IMPORT_MAX_BYTES = 5 * 1024 * 1024`, `const TEST_MAPPING_IMPORT_MAX_ROWS = 20_000`
  - `interface MappingImportReport { counts: { new: number; changed: number; unchanged: number; refused: number }; refused: Array<{ line: number; system: string; code: string; reason: string }>; rebuild: RebuildOutcome | null }`
  - On `TestMapping`: `exportCsv(): Promise<string>`, `importPreview(bytes: Uint8Array): Promise<MappingImportReport>`, `importApply(bytes: Uint8Array): Promise<MappingImportReport>`, and `catalogCodesForLoinc(loinc: string): Promise<string[]>`, used by Task 7.

- [ ] **Step 1: Write the failing tests**

`packages/bootstrap/src/test-mapping-csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TEST_CATALOG_SYSTEM } from './test-catalog';
import { buildMapping, seedCatalogTest, seedMapping, seedRequest } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';
const csv = (text: string) => new TextEncoder().encode(text);

describe('test mapping: CSV', () => {
  it('exports every observed code with its mapping, in the import layout', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedRequest(externalDb, 'r1', DISA, 'HIVVL', 'HIV, viral load', '2026-05-01T08:00:00Z');
    await seedRequest(externalDb, 'r2', DISA, 'CD4', null, '2026-05-01T08:00:00Z');

    expect(await mapping.exportCsv()).toBe(
      'system,code,description,requests,catalog_code,loinc\n'
      + `${DISA},CD4,,1,,\n`
      + `${DISA},HIVVL,"HIV, viral load",1,VL,25836-8\n`,
    );
  });

  it('previews new, changed, unchanged and refused rows, resolving LOINC when catalog_code is blank', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedCatalogTest(internalDb, 'CD4', 'CD4 count');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedMapping(internalDb, 'm2', DISA, 'POCVR', 'CD4');

    const report = await mapping.importPreview(csv([
      'system,code,catalog_code,loinc',
      `${DISA},HIVVL,VL,`,        // unchanged
      `${DISA},POCVR,,25836-8`,   // changed, CD4 to VL by LOINC
      `${DISA},CD4X,CD4,`,        // new
      `${DISA},UNMAPPED,,`,       // blank: no change
      `${DISA},BAD,NOPE,`,        // refused
      `${DISA},NOLOINC,,1234-5`,  // refused
      `,EMPTY,VL,`,               // refused
      `${DISA},CD4X,VL,`,         // refused, listed twice
    ].join('\n')));

    expect(report.counts).toEqual({ new: 1, changed: 1, unchanged: 2, refused: 4 });
    expect(report.refused).toEqual([
      { line: 6, system: DISA, code: 'BAD', reason: 'no catalog test has code NOPE' },
      { line: 7, system: DISA, code: 'NOLOINC', reason: 'no catalog test is linked to LOINC 1234-5' },
      { line: 8, system: '', code: 'EMPTY', reason: 'system and code are required' },
      { line: 9, system: DISA, code: 'CD4X', reason: 'listed twice in the file' },
    ]);
    expect(report.rebuild).toBeNull();
    expect(await internalDb.selectFrom('term_mappings').select('id').where('to_system', '=', TEST_CATALOG_SYSTEM).where('is_active', '=', true).execute()).toHaveLength(2);
  });

  it('refuses a row whose code central maps, and a LOINC two catalog tests share', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedCatalogTest(internalDb, 'VL2', 'HIV viral load (POC)', { loinc: '25836-8' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL', { central: true });

    const report = await mapping.importPreview(csv(`system,code,catalog_code,loinc\n${DISA},HIVVL,VL2,\n${DISA},POCVR,,25836-8\n`));

    expect(report.refused.map((r) => r.reason)).toEqual([
      'central maps HIVVL; a lab cannot change it',
      '2 catalog tests are linked to LOINC 25836-8',
    ]);
  });

  it('apply writes the new and changed rows, skips the refused ones, and rebuilds once', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    const report = await mapping.importApply(csv(`system,code,catalog_code,loinc\n${DISA},HIVVL,VL,\n${DISA},BAD,NOPE,\n`));
    expect(report.counts).toEqual({ new: 1, changed: 0, unchanged: 0, refused: 1 });
    expect(report.rebuild?.ok).toBe(true);
    expect(await externalDb.selectFrom('test_map').select('source_code').execute()).toEqual([{ source_code: 'HIVVL' }]);
  });

  // Review focus 4.
  it('reads a file Excel saved: BOM, CRLF and a quoted comma', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    const text = '﻿system,code,description,catalog_code\r\n'
      + `${DISA},A,"one, two",VL\r\n${DISA},B,plain,VL\r\n${DISA},C,,VL\r\n`;
    expect((await mapping.importPreview(csv(text))).counts).toEqual({ new: 3, changed: 0, unchanged: 0, refused: 0 });
  });

  it('refuses a file without the system and code columns, or without catalog_code and loinc', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.importPreview(csv('code,catalog_code\nA,VL\n'))).rejects.toMatchObject({ kind: 'invalid', message: 'the file needs a system column and a code column' });
    await expect(mapping.importPreview(csv('system,code\nx,A\n'))).rejects.toMatchObject({ kind: 'invalid', message: 'the file needs a catalog_code column or a loinc column' });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-csv.test.ts`
Expected: FAIL, `mapping.exportCsv is not a function`.

- [ ] **Step 3: Add the CSV functions**

In `packages/bootstrap/src/test-mapping.ts` add imports:

```ts
import { toCsv } from '@openldr/reporting';
import { readTableFile, TableFileError } from './table-file';
```

Add above `createTestMapping`:

```ts
export const TEST_MAPPING_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const TEST_MAPPING_IMPORT_MAX_ROWS = 20_000;

const CSV_COLUMNS = ['system', 'code', 'description', 'requests', 'catalog_code', 'loinc'].map((k) => ({ key: k, label: k }));

export interface MappingImportReport {
  counts: { new: number; changed: number; unchanged: number; refused: number };
  refused: Array<{ line: number; system: string; code: string; reason: string }>;
  /** Set by apply. Null for a preview. */
  rebuild: RebuildOutcome | null;
}

type PlannedRow = { system: string; code: string; catalogCode: string; name: string | null };
```

Inside `createTestMapping`, before `return`:

```ts
  async function catalogCodesForLoinc(loinc: string): Promise<string[]> {
    const rows = await internalDb.selectFrom('term_mappings').select('from_code')
      .where('from_system', '=', TEST_CATALOG_SYSTEM).where('to_system', '=', LOINC_SYSTEM)
      .where('to_code', '=', loinc).where('map_type', '=', MAP_TYPE).where('is_active', '=', true).execute();
    return [...new Set(rows.map((r) => r.from_code))].sort(compare);
  }

  async function exportCsv(): Promise<string> {
    const rows = await observedAll();
    return toCsv(CSV_COLUMNS, rows.map((r) => ({
      system: r.system, code: r.code, description: r.description, requests: r.requests,
      catalog_code: r.catalog?.code ?? null, loinc: r.catalog?.loinc ?? null,
    })));
  }

  async function planImport(bytes: Uint8Array): Promise<{ report: MappingImportReport; writes: PlannedRow[] }> {
    let table;
    try {
      table = readTableFile(bytes, 'csv', { maxBytes: TEST_MAPPING_IMPORT_MAX_BYTES, maxRows: TEST_MAPPING_IMPORT_MAX_ROWS });
    } catch (err) {
      if (err instanceof TableFileError) throw new TestCatalogError(err.message, 'invalid');
      throw err;
    }
    const headers = table.headers.map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
    const col = (name: string): number => headers.indexOf(name);
    if (col('system') < 0 || col('code') < 0) throw new TestCatalogError('the file needs a system column and a code column', 'invalid');
    if (col('catalog_code') < 0 && col('loinc') < 0) throw new TestCatalogError('the file needs a catalog_code column or a loinc column', 'invalid');
    const cell = (row: string[], name: string): string => (col(name) < 0 ? '' : (row[col(name)] ?? '').trim());

    const catalog = await readCatalog();
    const report: MappingImportReport = { counts: { new: 0, changed: 0, unchanged: 0, refused: 0 }, refused: [], rebuild: null };
    const writes: PlannedRow[] = [];
    const seen = new Set<string>();
    const refuse = (line: number, system: string, code: string, reason: string) => {
      report.counts.refused += 1;
      report.refused.push({ line, system, code, reason });
    };

    for (let i = 0; i < table.rows.length; i++) {
      const line = i + 2;
      // Codes are kept exactly as typed between the separators. Only the surrounding cell padding a
      // spreadsheet adds is dropped, which a real lab code never carries.
      const system = cell(table.rows[i], 'system');
      const code = cell(table.rows[i], 'code');
      if (system === '' || code === '') { refuse(line, system, code, 'system and code are required'); continue; }
      const key = sourceKey(system, code);
      if (seen.has(key)) { refuse(line, system, code, 'listed twice in the file'); continue; }
      seen.add(key);

      const catalogCodeCell = cell(table.rows[i], 'catalog_code');
      const loinc = cell(table.rows[i], 'loinc');
      let catalogCode: string | null = null;
      if (catalogCodeCell !== '') {
        if (!catalog.has(catalogCodeCell)) { refuse(line, system, code, `no catalog test has code ${catalogCodeCell}`); continue; }
        catalogCode = catalogCodeCell;
      } else if (loinc !== '') {
        const codes = await catalogCodesForLoinc(loinc);
        if (codes.length === 0) { refuse(line, system, code, `no catalog test is linked to LOINC ${loinc}`); continue; }
        if (codes.length > 1) { refuse(line, system, code, `${codes.length} catalog tests are linked to LOINC ${loinc}`); continue; }
        catalogCode = codes[0];
      }

      const existing = await activeFor(system, code);
      // Blank catalog_code and loinc: leave the code as it is. An exported file lists unmapped codes so.
      if (catalogCode === null) { report.counts.unchanged += 1; continue; }
      if (existing.some((r) => r.managed_origin === 'central')) { refuse(line, system, code, `central maps ${code}; a lab cannot change it`); continue; }
      const targets = [...new Set(existing.map((r) => r.to_code))];
      if (targets.length === 1 && targets[0] === catalogCode) { report.counts.unchanged += 1; continue; }
      if (existing.length === 0) report.counts.new += 1; else report.counts.changed += 1;
      writes.push({ system, code, catalogCode, name: catalog.get(catalogCode)!.name });
    }
    return { report, writes };
  }

  async function importPreview(bytes: Uint8Array): Promise<MappingImportReport> {
    return (await planImport(bytes)).report;
  }

  async function importApply(bytes: Uint8Array): Promise<MappingImportReport> {
    const { report, writes } = await planImport(bytes);
    for (const w of writes) await writeMapping(w.system, w.code, w.catalogCode, w.name);
    return { ...report, rebuild: await rebuildNow() };
  }
```

Add `exportCsv, importPreview, importApply, catalogCodesForLoinc` to the `return` object.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-csv.test.ts src/test-mapping-write.test.ts src/test-mapping.test.ts`
Expected: PASS. If the BOM test fails because `readTableFile` already strips the BOM, the `replace(/^﻿/, '')` is harmless; keep it.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/test-mapping.ts packages/bootstrap/src/test-mapping-csv.test.ts
git commit -m "feat(bootstrap): export and import test mappings as CSV"
```

---

### Task 5: Wiring and triggers

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts:248-252` (deps) and the bodies of `create`, `update`, `setActive`, `importApply`
- Modify: `packages/bootstrap/src/index.ts` (AppContext field near line 547, construction near line 988, boot near line 1078, sync `applyRecord` near line 1481, return object near line 1754)
- Modify: `apps/server/src/terminology-admin-routes.ts:238-335`
- Create: `packages/bootstrap/src/test-catalog-onchanged.test.ts`

**Interfaces:**
- Consumes: `createTestMapping`, `isTestMapRelevantRecord`, `mappingTouchesTestMap` from Tasks 2 and 3.
- Produces: `TestCatalogDeps.onChanged?: () => void`. `AppContext.testMapping: TestMapping`.

- [ ] **Step 1: Write the failing test for `onChanged`**

`packages/bootstrap/src/test-catalog-onchanged.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFhirStore, createTerminologyStore, createTerminologyAdminStore, type ValueSetProjection } from '@openldr/db';
import { createOperations } from '@openldr/terminology';
import { createTestCatalog } from './test-catalog';

async function catalogWithSpy() {
  const db = await makeMigratedDb();
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(r) { const s = await fhirStore.save(r as never); return (s as { id?: string })?.id ?? ''; },
    async registerSystem(url, version, kind, id) { await store.saveSystem(url, version, kind, id); },
    async deleteValueSetResource(url, id) { await fhirStore.delete('ValueSet', id); await db.deleteFrom('terminology_systems').where('url', '=', url).execute(); },
  };
  const admin = createTerminologyAdminStore(db, projection);
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c), findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q), getResourceByUrl: (u) => store.getResourceByUrl(u), translate: (q) => store.translate(q),
  });
  let calls = 0;
  const catalog = createTestCatalog({ db, admin, ops, onChanged: () => { calls += 1; } });
  return { catalog, calls: () => calls };
}

describe('createTestCatalog onChanged', () => {
  it('fires after create, update and setActive, and not after a read', async () => {
    const { catalog, calls } = await catalogWithSpy();
    const options = await catalog.options();
    const category = options.categories[0]?.code ?? null;
    await catalog.create({ code: 'ZZVL', display: 'Viral load', shortName: null, category, specimenTypes: [], loinc: null } as never);
    expect(calls()).toBe(1);
    await catalog.update('ZZVL', { code: 'ZZVL', display: 'HIV viral load', shortName: null, category, specimenTypes: [], loinc: null } as never);
    await catalog.setActive('ZZVL', false);
    expect(calls()).toBe(3);
    await catalog.list({ q: undefined, status: 'all', limit: 25, offset: 0 } as never);
    expect(calls()).toBe(3);
  });
});
```

If `create` refuses this input in Step 2 for a reason other than the missing callback (for example a required specimen type), copy a passing `create` input from `test-catalog.test.ts` and keep the three assertions.

- [ ] **Step 2: Run it and see it fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog-onchanged.test.ts`
Expected: FAIL, `calls()` is 0.

- [ ] **Step 3: Add `onChanged` to the catalog**

In `packages/bootstrap/src/test-catalog.ts`, `TestCatalogDeps`:

```ts
export interface TestCatalogDeps {
  db: Kysely<InternalSchema>;
  admin: TerminologyAdminStore;
  ops: Operations;
  /** Called after a change that alters a test's name, category, LOINC link or status. Test mapping
   *  rebuilds test_map from it (docs/superpowers/specs/2026-10-11-test-mapping-design.md, 4.3). */
  onChanged?: () => void;
}
```

In `createTestCatalog`, add `const changed = (): void => { deps.onChanged?.(); };`. In each of `create`, `update`, `setActive` and `importApply`, call `changed()` right before the function's final `return`, after the write has committed. Do not call it in `setEnabled` or `setLabSettings`; those change only this lab's settings.

- [ ] **Step 4: Run it and see it pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog-onchanged.test.ts src/test-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `testMapping` into `AppContext`**

In `packages/bootstrap/src/index.ts`:

1. Add to the `AppContext` interface, after `testCatalog: TestCatalog;`:

```ts
  /** Lab test codes mapped to catalog tests, and the warehouse copy test_map. */
  testMapping: TestMapping;
```

2. Replace line 988 with:

```ts
  // Built before the catalog, so a catalog change can ask for a test_map rebuild (test mapping spec 4.3).
  const testMapping = createTestMapping({ internalDb: termDb, externalDb, admin: termAdmin, logger });
  const testCatalog = createTestCatalog({
    db: termDb, admin: termAdmin, ops: terminology.ops,
    onChanged: () => { void testMapping.requestRebuild(); },
  });
```

3. Inside the `if (opts.runFacilityJobWorker === true) {` block near line 1078, after the facility enqueue:

```ts
    // Fills test_map once after an upgrade, and repairs it after a failed rebuild. Inline and cheap:
    // tens to hundreds of rows. Server boot only, for the same reason as the facility rebuild.
    void testMapping.requestRebuild();
```

4. Replace the `applyRecord` function near line 1481 with:

```ts
      const applyRecord = async (rec: import('@openldr/sync').PullRecord): Promise<'applied' | 'skipped'> => {
        if (rec.entityType === 'terminology_system') {
          await termBulk.syncSystem(rec.entityId, rec.body);
          // The catalog's tests arrive here. Their names and LOINC links feed test_map.
          if (isTestMapRelevantRecord(rec)) void testMapping.requestRebuild();
          return 'applied';
        }
        if (rec.entityType === 'concept_map') {
          await termBulk.syncConceptMap(rec.entityId, rec.body);
          return 'applied';
        }
        const outcome = await referenceApplier(rec);
        // A synced test mapping must reach this lab's warehouse now, not at its next boot.
        if (outcome === 'applied' && isTestMapRelevantRecord(rec)) void testMapping.requestRebuild();
        return outcome;
      };
```

5. Add `testMapping,` to the returned context object after `testCatalog,`.

Import nothing new: `test-mapping.ts` is in the same package. Add `createTestMapping, isTestMapRelevantRecord` and `type TestMapping` to a local import from `'./test-mapping'` at the top of `index.ts`.

- [ ] **Step 6: Rebuild after a general mapping edit that touches the catalog**

In `apps/server/src/terminology-admin-routes.ts` add `mappingTouchesTestMap` to the `@openldr/bootstrap` import.

POST handler, after the facility enqueue block and before `recordAudit`:

```ts
      // Test mapping spec 4.3: a mapping into the catalog, or a catalog test's LOINC link, changes test_map.
      if (mappingTouchesTestMap(system, parsed.data.toSystem)) void ctx.testMapping.requestRebuild();
```

PUT handler: change the `previous` select to `.select(['to_system', 'from_system'])`, and after the facility enqueue block add:

```ts
      if (mappingTouchesTestMap(previous?.from_system, parsed.data.toSystem)
        || (previous && mappingTouchesTestMap(previous.from_system, previous.to_system))) {
        void ctx.testMapping.requestRebuild();
      }
```

DELETE handler: change the `row` select to `.select(['to_system', 'from_system'])`, and after the facility enqueue block add:

```ts
      if (row && mappingTouchesTestMap(row.from_system, row.to_system)) void ctx.testMapping.requestRebuild();
```

In `apps/server/src/terminology-admin-routes.test.ts`, the fake context needs `testMapping: { requestRebuild: async () => {} }`. Add it to the fake context builder. Then add one test:

```ts
it('asks for a test_map rebuild when a mapping into the test catalog is created', async () => {
  // Build the app the way the neighbouring POST mapping tests do, with
  // ctx.testMapping = { requestRebuild: vi.fn(async () => {}) }.
  // POST /api/terminology/terms/urn%3Aopenldr%3Adisa/HIVVL/mappings with
  // { toSystem: 'urn:openldr:codesystem:test-catalog', toCode: 'VL', mapType: 'SAME-AS', isActive: true }.
  // Expect 201 and requestRebuild called once.
});
```

Write the body by copying the nearest existing POST mapping test in that file and changing only the body, the fake `testMapping`, and the assertion.

- [ ] **Step 7: Typecheck and run the touched tests**

Run: `pnpm turbo run typecheck --force --concurrency=2 --filter @openldr/bootstrap --filter @openldr/server > /tmp/tc5.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Run: `cd apps/server && npx vitest run src/terminology-admin-routes.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog-onchanged.test.ts packages/bootstrap/src/index.ts apps/server/src/terminology-admin-routes.ts apps/server/src/terminology-admin-routes.test.ts
git commit -m "feat(bootstrap): rebuild test_map on catalog edits, sync and boot"
```

---

### Task 6: HTTP routes

**Files:**
- Create: `apps/server/src/test-mapping-routes.ts`, `apps/server/src/test-mapping-routes.test.ts`
- Modify: `apps/server/src/app.ts:16,153`

**Interfaces:**
- Consumes: `AppContext.testMapping` (Task 5), `parseObservedQuery`, `TestCatalogError`, `TEST_MAPPING_IMPORT_MAX_BYTES`.
- Produces, all under `/api/test-catalog/mappings`:
  - `GET /observed?status=&q=&limit=&offset=` (terminology.view) returns `ObservedResult`.
  - `GET /targets` (terminology.view) returns `{ targets: CatalogTarget[] }`.
  - `PUT /` (terminology.manage), body `{ system, code, catalogCode }`, returns `TestMappingChange`.
  - `POST /clear` (terminology.manage), body `{ system, code }`, returns `TestMappingChange`.
  - `GET /export` (terminology.view) returns CSV.
  - `POST /import/preview` and `POST /import/apply` (terminology.manage), raw CSV bytes (`application/octet-stream`), return `MappingImportReport`.
  - `POST /rebuild` (terminology.manage) returns `RebuildOutcome`.

  Clear is a POST with a body, not `DELETE /:system/:code`, because a system is a URN with colons and slashes.

- [ ] **Step 1: Write the failing route tests**

`apps/server/src/test-mapping-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { TestCatalogError, type AppContext } from '@openldr/bootstrap';
import { registerTestMappingRoutes } from './test-mapping-routes';
import './auth-plugin';

const DISA = 'urn:openldr:disa';
const OBSERVED = {
  rows: [{ system: DISA, code: 'HIVVL', description: 'HIV VL', requests: 2, lastSeen: '2026-05-03T08:00:00.000Z', status: 'mapped', catalog: { code: 'VL', name: 'HIV viral load', loinc: '25836-8' }, centralManaged: false }],
  total: 1,
  warehouse: { stale: false, error: null },
};
const CHANGE = { system: DISA, code: 'HIVVL', before: null, after: 'VL', rebuild: { ok: true, result: { mapped: 1, ambiguous: [], targetMissing: [], written: 1 } } };
const REPORT = { counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [], rebuild: null };

type Impl = (...args: any[]) => Promise<unknown>;

function fakeCtx(over: Record<string, Impl> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const spy = (method: string, impl: Impl): Impl => async (...args) => { calls.push({ method, args }); return impl(...args); };
  const testMapping = {
    observed: spy('observed', over.observed ?? (async () => OBSERVED)),
    targets: spy('targets', over.targets ?? (async () => [{ code: 'VL', name: 'HIV viral load', loinc: '25836-8', retired: false }])),
    set: spy('set', over.set ?? (async () => CHANGE)),
    clear: spy('clear', over.clear ?? (async () => ({ ...CHANGE, before: 'VL', after: null }))),
    exportCsv: spy('exportCsv', over.exportCsv ?? (async () => 'system,code\n')),
    importPreview: spy('importPreview', over.importPreview ?? (async () => REPORT)),
    importApply: spy('importApply', over.importApply ?? (async () => ({ ...REPORT, rebuild: CHANGE.rebuild }))),
    rebuildNow: spy('rebuildNow', over.rebuildNow ?? (async () => CHANGE.rebuild)),
  };
  const ctx = {
    testMapping,
    audit: { record: async (e: Record<string, unknown>) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, calls, audit };
}

function appWith(ctx: AppContext, capabilities: string[] = ['terminology.view', 'terminology.manage']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'], capabilities };
  });
  registerTestMappingRoutes(app, ctx);
  return app;
}

describe('test mapping routes', () => {
  it('GET observed passes the parsed filters and returns the answer as is', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/mappings/observed?status=mapped&q=viral&limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(OBSERVED);
    expect(calls).toEqual([{ method: 'observed', args: [{ status: 'mapped', q: 'viral', limit: 10, offset: 0 }] }]);
  });

  it('GET observed refuses a bad filter with 400 before the service', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/mappings/observed?status=gone' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'status must be unmapped, mapped, ambiguous or all' });
    expect(calls).toEqual([]);
  });

  it('GET targets wraps the list', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/mappings/targets' });
    expect(res.json()).toEqual({ targets: [{ code: 'VL', name: 'HIV viral load', loinc: '25836-8', retired: false }] });
  });

  it('PUT sets a mapping and audits before and after', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/mappings', payload: { system: DISA, code: 'HIVVL', catalogCode: 'VL' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(CHANGE);
    expect(calls).toEqual([{ method: 'set', args: [DISA, 'HIVVL', 'VL'] }]);
    expect(audit).toMatchObject([{ action: 'test_mapping.set', entityType: 'test_mapping', entityId: `${DISA}|HIVVL`, before: { catalogCode: null }, after: { catalogCode: 'VL' } }]);
  });

  it('PUT refuses a missing field with 400', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/mappings', payload: { system: DISA, code: 'HIVVL' } });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('maps service refusals to 400, 404 and 409 with their kind', async () => {
    for (const [kind, status] of [['invalid', 400], ['not-found', 404], ['central-managed', 409]] as const) {
      const { ctx, audit } = fakeCtx({ set: async () => { throw new TestCatalogError('no', kind); } });
      const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/mappings', payload: { system: DISA, code: 'HIVVL', catalogCode: 'VL' } });
      expect([res.statusCode, res.json()]).toEqual([status, { error: 'no', kind }]);
      expect(audit).toEqual([]);
    }
  });

  it('POST clear clears and audits', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog/mappings/clear', payload: { system: DISA, code: 'HIVVL' } });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([{ method: 'clear', args: [DISA, 'HIVVL'] }]);
    expect(audit).toMatchObject([{ action: 'test_mapping.clear', before: { catalogCode: 'VL' }, after: { catalogCode: null } }]);
  });

  it('GET export returns CSV with a download name', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/mappings/export' });
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="test-mappings.csv"');
    expect(res.body).toBe('system,code\n');
  });

  it('import preview reads raw bytes and writes no audit; apply audits the counts', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const app = appWith(ctx);
    const body = Buffer.from('system,code,catalog_code\nx,A,VL\n');
    const pre = await app.inject({ method: 'POST', url: '/api/test-catalog/mappings/import/preview', headers: { 'content-type': 'application/octet-stream' }, payload: body });
    expect(pre.statusCode).toBe(200);
    expect(Buffer.from(calls[0].args[0] as Uint8Array).toString()).toBe(body.toString());
    expect(audit).toEqual([]);
    const apply = await app.inject({ method: 'POST', url: '/api/test-catalog/mappings/import/apply', headers: { 'content-type': 'application/octet-stream' }, payload: body });
    expect(apply.statusCode).toBe(200);
    expect(audit).toMatchObject([{ action: 'test_mapping.import', metadata: { counts: REPORT.counts } }]);
  });

  it('POST rebuild returns the outcome', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog/mappings/rebuild' });
    expect(res.json()).toEqual(CHANGE.rebuild);
  });

  it('a viewer can read but not change', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx, ['terminology.view']);
    expect((await app.inject({ method: 'GET', url: '/api/test-catalog/mappings/observed' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/test-catalog/mappings', payload: { system: DISA, code: 'HIVVL', catalogCode: 'VL' } })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd apps/server && npx vitest run src/test-mapping-routes.test.ts`
Expected: FAIL, cannot resolve `./test-mapping-routes`.

- [ ] **Step 3: Write the routes**

`apps/server/src/test-mapping-routes.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import { parseObservedQuery, TestCatalogError, TEST_MAPPING_IMPORT_MAX_BYTES, type AppContext } from '@openldr/bootstrap';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// Test mapping (docs/superpowers/specs/2026-10-11-test-mapping-design.md, 4.4 to 4.6). Same gates as
// the catalog routes: terminology.view to read, terminology.manage to change.
const VIEW = { preHandler: requireCapability('terminology.view') };
const MANAGE = { preHandler: requireCapability('terminology.manage') };
const IMPORT_STEP = { ...MANAGE, bodyLimit: TEST_MAPPING_IMPORT_MAX_BYTES + 1024 };

const setBody = z.object({ system: z.string().min(1), code: z.string().min(1), catalogCode: z.string().min(1) });
const clearBody = z.object({ system: z.string().min(1), code: z.string().min(1) });

// A refusal keeps its words and says which kind it is, as replyCatalogError does in test-catalog-routes.ts.
function replyMappingError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof TestCatalogError)) throw err;
  const status = err.kind === 'invalid' ? 400 : err.kind === 'not-found' ? 404 : 409;
  return reply.code(status).send({ error: err.message, kind: err.kind });
}

async function readUpload(body: unknown): Promise<Buffer | null> {
  if (!body || typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator] !== 'function') return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > TEST_MAPPING_IMPORT_MAX_BYTES) break;
  }
  return Buffer.concat(chunks);
}

export function registerTestMappingRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_req: unknown, payload: unknown, done: (e: null, b: unknown) => void) => done(null, payload));
  }

  app.get('/api/test-catalog/mappings/observed', VIEW, async (req, reply) => {
    const parsed = parseObservedQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.testMapping.observed(parsed.query));
  });

  app.get('/api/test-catalog/mappings/targets', VIEW, async (_req, reply) => {
    return reply.send({ targets: await ctx.testMapping.targets() });
  });

  app.put('/api/test-catalog/mappings', MANAGE, async (req, reply) => {
    const parsed = setBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'system, code and catalogCode are required' });
    try {
      const change = await ctx.testMapping.set(parsed.data.system, parsed.data.code, parsed.data.catalogCode);
      await recordAudit(ctx, req, {
        action: 'test_mapping.set', entityType: 'test_mapping', entityId: `${change.system}|${change.code}`,
        before: { catalogCode: change.before }, after: { catalogCode: change.after }, metadata: { rebuild: change.rebuild.ok },
      });
      return reply.send(change);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/mappings/clear', MANAGE, async (req, reply) => {
    const parsed = clearBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'system and code are required' });
    try {
      const change = await ctx.testMapping.clear(parsed.data.system, parsed.data.code);
      await recordAudit(ctx, req, {
        action: 'test_mapping.clear', entityType: 'test_mapping', entityId: `${change.system}|${change.code}`,
        before: { catalogCode: change.before }, after: { catalogCode: null }, metadata: { rebuild: change.rebuild.ok },
      });
      return reply.send(change);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.get('/api/test-catalog/mappings/export', VIEW, async (_req, reply) => {
    const csv = await ctx.testMapping.exportCsv();
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="test-mappings.csv"')
      .send(csv);
  });

  app.post('/api/test-catalog/mappings/import/preview', IMPORT_STEP, async (req, reply) => {
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
    try {
      return reply.send(await ctx.testMapping.importPreview(bytes));
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/mappings/import/apply', IMPORT_STEP, async (req, reply) => {
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
    try {
      const report = await ctx.testMapping.importApply(bytes);
      await recordAudit(ctx, req, {
        action: 'test_mapping.import', entityType: 'test_mapping', entityId: 'import',
        before: null, after: null, metadata: { counts: report.counts, refused: report.refused, rebuild: report.rebuild?.ok ?? null },
      });
      return reply.send(report);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/mappings/rebuild', MANAGE, async (_req, reply) => {
    return reply.send(await ctx.testMapping.rebuildNow());
  });
}
```

In `apps/server/src/app.ts`, import it next to `registerTestCatalogRoutes` and call `registerTestMappingRoutes(app, ctx);` right after `registerTestCatalogRoutes(app, ctx);`.

`apps/server` has real lint. Every handler above returns `reply.send(...)`, which satisfies its `reply.send` rule.

- [ ] **Step 4: Run tests, lint and typecheck**

Run: `cd apps/server && npx vitest run src/test-mapping-routes.test.ts`
Expected: PASS.

Run: `pnpm --filter @openldr/server lint > /tmp/lint6.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/test-mapping-routes.ts apps/server/src/test-mapping-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): routes for test mappings"
```

---

### Task 7: The content pack step

**Files:**
- Modify: `packages/marketplace/src/content-pack.ts`, `packages/marketplace/src/content-pack.test.ts`
- Modify: `packages/bootstrap/src/test-mapping.ts`, `packages/bootstrap/src/test-mapping-pack.test.ts` (create)
- Modify: `packages/bootstrap/src/content-pack-install.ts`, `packages/bootstrap/src/content-pack-install.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (installer deps near line 1086)
- Modify: `packages/cli/src/market.ts:146-158`

**Interfaces:**
- Consumes: Task 3's `writeMapping`, `activeFor`, `rebuildNow`. Task 4's `catalogCodesForLoinc`, `readCatalog`.
- Produces:
  - `interface PackMappingInput { system: string; code: string; loinc: string }`
  - `interface PackMappingPlan { mapped: Array<{ system: string; code: string; catalogCode: string }>; kept: Array<{ system: string; code: string }>; skipped: Array<{ system: string; code: string; reason: string }> }`
  - On `TestMapping`: `planPack(mappings: PackMappingInput[]): Promise<PackMappingPlan>`, `applyPack(mappings: PackMappingInput[]): Promise<PackMappingPlan & { rebuild: RebuildOutcome }>`.
  - `ContentPackDeps.planTestMappings` and `applyTestMappings`. `check()` returns `testMapPreview: PackMappingPlan[]`.

- [ ] **Step 1: Write the failing marketplace test**

Add to `packages/marketplace/src/content-pack.test.ts`:

```ts
describe('test-mappings step', () => {
  const step = { kind: 'test-mappings', mappings: [{ system: 'urn:openldr:disa', code: 'HIVVL', loinc: '25836-8' }, { system: 'urn:openldr:disa', code: 'POCVR', loinc: '25836-8' }] };

  it('parses and summarises as "Test mappings" with the count', () => {
    const pack = parseContentPack({ formatVersion: 1, steps: [step] });
    expect(summarizeContentPack(pack)).toEqual([{ kind: 'test-mappings', label: 'Test mappings', count: 2 }]);
  });

  it('refuses a malformed LOINC code and an empty list', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ ...step, mappings: [{ system: 'x', code: 'y', loinc: 'abc' }] }] })).toThrow(/invalid pack/);
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ ...step, mappings: [] }] })).toThrow(/invalid pack/);
  });
});
```

Use the imports the file already has. If it lacks `parseContentPack` or `summarizeContentPack`, import them from `'./content-pack'`.

- [ ] **Step 2: Run it and see it fail**

Run: `cd packages/marketplace && npx vitest run src/content-pack.test.ts`
Expected: FAIL with "this pack needs a newer CE".

- [ ] **Step 3: Add the step to the parser**

In `packages/marketplace/src/content-pack.ts`:

```ts
const KINDS = ['code-system', 'value-set', 'facility-register', 'link-matching', 'custom-queries', 'test-mappings'] as const;
```

Add to `stepSchema`'s union, after `custom-queries`:

```ts
  // Lab test codes mapped to catalog tests by LOINC (test mapping spec 4.7). A CE without this kind
  // refuses the pack as needing a newer CE.
  z.object({
    kind: z.literal('test-mappings'),
    mappings: z.array(z.object({
      system: z.string().min(1), code: z.string().min(1), loinc: z.string().regex(/^\d{1,7}-\d$/),
    })).min(1),
  }),
```

Add to `summarizeContentPack`'s switch:

```ts
      case 'test-mappings':
        return { kind: s.kind, label: 'Test mappings', count: s.mappings.length };
```

Run: `cd packages/marketplace && npx vitest run src/content-pack.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing pack planning tests**

`packages/bootstrap/src/test-mapping-pack.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMapping, seedCatalogTest, seedMapping } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';

describe('test mapping: pack plan and apply', () => {
  it('maps by LOINC, keeps an existing mapping, and skips what it cannot resolve', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedCatalogTest(internalDb, 'A', 'A', { loinc: '1111-1' });
    await seedCatalogTest(internalDb, 'B', 'B', { loinc: '1111-1' });
    await seedMapping(internalDb, 'm1', DISA, 'POCVR', 'A');

    const plan = await mapping.planPack([
      { system: DISA, code: 'HIVVL', loinc: '25836-8' },
      { system: DISA, code: 'POCVR', loinc: '25836-8' },
      { system: DISA, code: 'WW', loinc: '9999-9' },
      { system: DISA, code: 'X', loinc: '1111-1' },
    ]);

    expect(plan).toEqual({
      mapped: [{ system: DISA, code: 'HIVVL', catalogCode: 'VL' }],
      kept: [{ system: DISA, code: 'POCVR' }],
      skipped: [
        { system: DISA, code: 'WW', reason: 'no catalog test is linked to LOINC 9999-9' },
        { system: DISA, code: 'X', reason: '2 catalog tests are linked to LOINC 1111-1' },
      ],
    });
  });

  // Review focus 1.
  it('skips a code the pack lists twice', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    const plan = await mapping.planPack([
      { system: DISA, code: 'HIVVL', loinc: '25836-8' },
      { system: DISA, code: 'HIVVL', loinc: '25836-8' },
    ]);
    expect(plan.mapped).toHaveLength(1);
    expect(plan.skipped).toEqual([{ system: DISA, code: 'HIVVL', reason: 'listed twice in this pack' }]);
  });

  it('apply writes the mapped codes, never touches a kept one, and rebuilds once', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedCatalogTest(internalDb, 'A', 'A');
    await seedMapping(internalDb, 'm1', DISA, 'POCVR', 'A');

    const out = await mapping.applyPack([
      { system: DISA, code: 'HIVVL', loinc: '25836-8' },
      { system: DISA, code: 'POCVR', loinc: '25836-8' },
    ]);

    expect(out.rebuild.ok).toBe(true);
    const rows = await externalDb.selectFrom('test_map').select(['source_code', 'catalog_code']).orderBy('source_code').execute();
    expect(rows).toEqual([{ source_code: 'HIVVL', catalog_code: 'VL' }, { source_code: 'POCVR', catalog_code: 'A' }]);
  });
});
```

- [ ] **Step 5: Run them and see them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-pack.test.ts`
Expected: FAIL, `mapping.planPack is not a function`.

- [ ] **Step 6: Add the pack functions**

In `packages/bootstrap/src/test-mapping.ts`, above `createTestMapping`:

```ts
export interface PackMappingInput { system: string; code: string; loinc: string }

export interface PackMappingPlan {
  mapped: Array<{ system: string; code: string; catalogCode: string }>;
  /** Already mapped here, by hand or by central. A pack never overwrites. */
  kept: Array<{ system: string; code: string }>;
  skipped: Array<{ system: string; code: string; reason: string }>;
}
```

Inside `createTestMapping`, before `return`:

```ts
  async function planPack(mappings: PackMappingInput[]): Promise<PackMappingPlan> {
    const plan: PackMappingPlan = { mapped: [], kept: [], skipped: [] };
    const seen = new Set<string>();
    for (const m of mappings) {
      const key = sourceKey(m.system, m.code);
      if (seen.has(key)) { plan.skipped.push({ system: m.system, code: m.code, reason: 'listed twice in this pack' }); continue; }
      seen.add(key);
      if ((await activeFor(m.system, m.code)).length > 0) { plan.kept.push({ system: m.system, code: m.code }); continue; }
      const codes = await catalogCodesForLoinc(m.loinc);
      if (codes.length === 0) { plan.skipped.push({ system: m.system, code: m.code, reason: `no catalog test is linked to LOINC ${m.loinc}` }); continue; }
      if (codes.length > 1) { plan.skipped.push({ system: m.system, code: m.code, reason: `${codes.length} catalog tests are linked to LOINC ${m.loinc}` }); continue; }
      plan.mapped.push({ system: m.system, code: m.code, catalogCode: codes[0] });
    }
    return plan;
  }

  async function applyPack(mappings: PackMappingInput[]): Promise<PackMappingPlan & { rebuild: RebuildOutcome }> {
    const plan = await planPack(mappings);
    const catalog = await readCatalog();
    for (const m of plan.mapped) await writeMapping(m.system, m.code, m.catalogCode, catalog.get(m.catalogCode)?.name ?? null);
    return { ...plan, rebuild: await rebuildNow() };
  }
```

Add `planPack, applyPack` to the `return` object.

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-pack.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing installer tests**

In `packages/bootstrap/src/content-pack-install.test.ts`, give `setup()`'s deps two more fakes:

```ts
    planTestMappings: vi.fn(async (m: any[]) => { calls.push('planTestMappings'); return { mapped: m.slice(0, 1).map((x) => ({ ...x, catalogCode: 'VL' })), kept: [], skipped: m.slice(1).map((x) => ({ system: x.system, code: x.code, reason: 'no catalog test is linked to LOINC 9999-9' })) }; }),
    applyTestMappings: vi.fn(async (m: any[]) => { calls.push('applyTestMappings'); return { mapped: m.slice(0, 1).map((x) => ({ ...x, catalogCode: 'VL' })), kept: [], skipped: m.slice(1).map((x) => ({ system: x.system, code: x.code, reason: 'no catalog test is linked to LOINC 9999-9' })) }; }),
```

Add `'applyTestMappings'` to the `WRITES` list. Then add:

```ts
  it('a test-mappings step plans in check, writes in install, and audits the counts', async () => {
    const pack = { formatVersion: 1, steps: [{ kind: 'test-mappings', mappings: [
      { system: 'urn:openldr:disa', code: 'HIVVL', loinc: '25836-8' },
      { system: 'urn:openldr:disa', code: 'WW', loinc: '9999-9' },
    ] }] };
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const s = setup();

    const checked = await s.installer.check(bundle);
    expect(checked.testMapPreview).toEqual([{
      mapped: [{ system: 'urn:openldr:disa', code: 'HIVVL', loinc: '25836-8', catalogCode: 'VL' }],
      kept: [],
      skipped: [{ system: 'urn:openldr:disa', code: 'WW', reason: 'no catalog test is linked to LOINC 9999-9' }],
    }]);
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);

    const res = await s.installer.install(bundle, { actor });
    expect(res.status).toBe('installed');
    expect(events(s.audit).find((e) => e.action === 'testMapping.pack')).toMatchObject({
      entityType: 'test_mapping', metadata: { mapped: 1, kept: 0, skipped: [{ code: 'WW' }] },
    });
    await cleanup();
  });
```

- [ ] **Step 8: Run it and see it fail**

Run: `cd packages/bootstrap && npx vitest run src/content-pack-install.test.ts`
Expected: FAIL, `checked.testMapPreview` is undefined.

- [ ] **Step 9: Add the step to the installer**

In `packages/bootstrap/src/content-pack-install.ts`, import the types:

```ts
import type { PackMappingInput, PackMappingPlan } from './test-mapping';
```

Add to `ContentPackDeps`:

```ts
  /** Resolve a pack's test mappings by LOINC, writing nothing (test mapping spec 4.7). */
  planTestMappings(mappings: PackMappingInput[]): Promise<PackMappingPlan>;
  /** Write the resolvable ones and rebuild test_map once. Existing mappings are kept. */
  applyTestMappings(mappings: PackMappingInput[]): Promise<PackMappingPlan>;
```

In `verify`, declare `const testMapPreview: PackMappingPlan[] = [];` beside `linkPreview`, add a case to the step switch:

```ts
        case 'test-mappings':
          testMapPreview.push(await deps.planTestMappings(step.mappings));
          break;
```

and return `{ pack, steps, linkPreview, testMapPreview }`.

In `runStep`, add:

```ts
      case 'test-mappings': {
        const plan = await deps.applyTestMappings(step.mappings);
        await record({
          ...who(actor), action: 'testMapping.pack', entityType: 'test_mapping', entityId: `pack:${at.pack}`,
          before: null, after: null,
          metadata: { ...source, mapped: plan.mapped.length, kept: plan.kept.length, skipped: plan.skipped },
        });
        return;
      }
```

Change `check` to return `testMapPreview` too:

```ts
  async function check(bundle: Bundle): Promise<{ steps: { kind: string; label: string; count: number }[]; linkPreview: LinkPreview[]; testMapPreview: PackMappingPlan[] }> {
    const { steps, linkPreview, testMapPreview } = await verify(bundle, { id: null, name: 'check' });
    return { steps, linkPreview, testMapPreview };
  }
```

In `packages/bootstrap/src/index.ts`, add to the `createContentPackInstaller({ ... })` deps near line 1086:

```ts
    planTestMappings: (mappings) => testMapping.planPack(mappings),
    applyTestMappings: (mappings) => testMapping.applyPack(mappings),
```

- [ ] **Step 10: Show the plan in the CLI dry run**

In `packages/cli/src/market.ts`, change the dry-run block:

```ts
      const { steps, linkPreview = [], testMapPreview = [] } = await ctx.marketplacePacks.check(bundle);
      emit(
        opts.json,
        { id, version, dryRun: true, steps, linkPreview, testMapPreview },
        [
          `dry run: ${id}@${version} would run ${steps.length} step(s)`,
          ...steps.map((s, i) => `  ${i + 1}. ${s.kind.padEnd(18)} ${s.label} (${s.count})`),
          ...linkPreview.map((p) => (p.wouldLink === null
            ? `would link codes to ${p.registerUrl} once this pack loads its register (not counted yet)`
            : `would link ${p.wouldLink} code(s) to ${p.registerUrl}`)),
          ...testMapPreview.flatMap((p) => [
            `test mappings: ${p.mapped.length} to map, ${p.kept.length} kept, ${p.skipped.length} skipped`,
            ...p.skipped.map((s) => `  skipped ${s.system} ${s.code}: ${s.reason}`),
          ]),
        ].join('\n'),
      );
```

In `packages/cli/src/market.test.ts`, the mocked `check` returns no `testMapPreview`; the `= []` default covers it. Add one test where the mocked `check` returns `testMapPreview: [{ mapped: [{ system: 's', code: 'A', catalogCode: 'VL' }], kept: [], skipped: [{ system: 's', code: 'B', reason: 'no catalog test is linked to LOINC 9999-9' }] }]`, and assert stdout contains `test mappings: 1 to map, 0 kept, 1 skipped` and `skipped s B: no catalog test is linked to LOINC 9999-9`. Copy the nearest existing dry-run test in that file for the harness.

- [ ] **Step 11: Run the tests and typecheck**

Run: `cd packages/bootstrap && npx vitest run src/content-pack-install.test.ts src/test-mapping-pack.test.ts`, then `cd packages/cli && npx vitest run src/market.test.ts`
Expected: PASS.

Run: `pnpm turbo run typecheck --force --concurrency=2 --filter @openldr/marketplace --filter @openldr/bootstrap --filter @openldr/cli > /tmp/tc7.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 12: Commit**

```bash
git add packages/marketplace/src/content-pack.ts packages/marketplace/src/content-pack.test.ts packages/bootstrap/src/test-mapping.ts packages/bootstrap/src/test-mapping-pack.test.ts packages/bootstrap/src/content-pack-install.ts packages/bootstrap/src/content-pack-install.test.ts packages/bootstrap/src/index.ts packages/cli/src/market.ts packages/cli/src/market.test.ts
git commit -m "feat(marketplace): test-mappings content pack step"
```

---

### Task 8: CLI commands

**Files:**
- Create: `packages/cli/src/test-mapping.ts`, `packages/cli/src/test-mapping.test.ts`
- Modify: `packages/cli/src/program.ts` (after the `test-catalog params` command, near line 403)

**Interfaces:**
- Consumes: `AppContext.testMapping`, `parseObservedQuery`, `recordAuditEvent`, `cliActor`.
- Produces: `runTestMappingList`, `runTestMappingSet`, `runTestMappingClear`, `runTestMappingExport`, `runTestMappingImport`, `runTestMappingRebuild`, each returning `Promise<number>`, the exit code.

- [ ] **Step 1: Write the failing CLI tests**

`packages/cli/src/test-mapping.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const testMapping = {
  observed: vi.fn(), set: vi.fn(), clear: vi.fn(), exportCsv: vi.fn(),
  importPreview: vi.fn(), importApply: vi.fn(), publish: vi.fn(), rebuildNow: vi.fn(),
};
const audit: unknown[] = [];
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
vi.mock('@openldr/bootstrap', async (orig) => {
  const actual = await orig<typeof import('@openldr/bootstrap')>();
  return {
    ...actual,
    createAppContext: async () => ({ testMapping, close: async () => {} }),
    recordAuditEvent: async (_ctx: unknown, _actor: unknown, e: unknown) => { audit.push(e); },
  };
});

import { runTestMappingClear, runTestMappingImport, runTestMappingList, runTestMappingRebuild, runTestMappingSet } from './test-mapping';

const DISA = 'urn:openldr:disa';
const REBUILT = { ok: true, result: { mapped: 1, ambiguous: [], targetMissing: [], written: 1 } };

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
  return { out: () => out.join(''), err: () => err.join('') };
}

beforeEach(() => { vi.restoreAllMocks(); audit.length = 0; for (const f of Object.values(testMapping)) f.mockReset(); });

describe('openldr test-catalog map', () => {
  it('list refuses a bad status in the route parser\'s words', async () => {
    const io = capture();
    expect(await runTestMappingList({ status: 'gone', json: false })).toBe(1);
    expect(io.err()).toContain('status must be unmapped, mapped, ambiguous or all');
    expect(testMapping.observed).not.toHaveBeenCalled();
  });

  it('list prints one line per code', async () => {
    testMapping.observed.mockResolvedValue({ rows: [{ system: DISA, code: 'HIVVL', description: null, requests: 2, lastSeen: null, status: 'mapped', catalog: { code: 'VL', name: 'HIV viral load', loinc: '25836-8' }, centralManaged: false }], total: 1, warehouse: { stale: false, error: null } });
    const io = capture();
    expect(await runTestMappingList({ json: false })).toBe(0);
    expect(io.out()).toContain(`${DISA}  HIVVL  2  mapped  VL HIV viral load (LOINC 25836-8)`);
  });

  it('set writes, audits as cli, and prints the change', async () => {
    testMapping.set.mockResolvedValue({ system: DISA, code: 'HIVVL', before: null, after: 'VL', rebuild: REBUILT });
    const io = capture();
    expect(await runTestMappingSet(DISA, 'HIVVL', 'VL', { json: false })).toBe(0);
    expect(io.out()).toContain('HIVVL now maps to VL.');
    expect(audit).toMatchObject([{ action: 'test_mapping.set', before: { catalogCode: null }, after: { catalogCode: 'VL' } }]);
  });

  it('set says when the warehouse copy could not be rebuilt, and still exits 0', async () => {
    testMapping.set.mockResolvedValue({ system: DISA, code: 'HIVVL', before: null, after: 'VL', rebuild: { ok: false, error: 'boom' } });
    const io = capture();
    expect(await runTestMappingSet(DISA, 'HIVVL', 'VL', { json: false })).toBe(0);
    expect(io.err()).toContain('the warehouse copy test_map is out of date: boom. Run openldr test-catalog map rebuild --apply.');
  });

  it('clear refuses without --force and writes nothing', async () => {
    const io = capture();
    expect(await runTestMappingClear(DISA, 'HIVVL', { force: false, json: false })).toBe(1);
    expect(io.err()).toContain('pass --force');
    expect(testMapping.clear).not.toHaveBeenCalled();
  });

  it('import previews unless --apply, and --apply needs --force', async () => {
    testMapping.importPreview.mockResolvedValue({ counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [], rebuild: null });
    const file = new URL('./test-mapping.test.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const io = capture();
    expect(await runTestMappingImport(file, { apply: false, force: false, json: false })).toBe(0);
    expect(io.out()).toContain('would map 1 new, change 0, leave 0 unchanged, refuse 0');
    expect(await runTestMappingImport(file, { apply: true, force: false, json: false })).toBe(1);
    expect(testMapping.importApply).not.toHaveBeenCalled();
  });

  it('rebuild without --apply is a dry run', async () => {
    testMapping.publish.mockResolvedValue({ mapped: 3, ambiguous: [{ system: DISA, code: 'X', catalogCodes: ['A', 'B'] }], targetMissing: [], written: 3 });
    const io = capture();
    expect(await runTestMappingRebuild({ apply: false, json: false })).toBe(0);
    expect(testMapping.publish).toHaveBeenCalledWith({ apply: false });
    expect(io.out()).toContain('would write 3 row(s); 1 ambiguous, 0 with a missing catalog test');
    expect(io.out()).toContain(`  ambiguous ${DISA} X: A, B`);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd packages/cli && npx vitest run src/test-mapping.test.ts`
Expected: FAIL, cannot resolve `./test-mapping`.

- [ ] **Step 3: Write the commands**

`packages/cli/src/test-mapping.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createAppContext, parseObservedQuery, recordAuditEvent, type RebuildOutcome } from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

// `openldr test-catalog map ...`: the CLI doors to the test mapping routes (test mapping spec 4.6).
// Each catches its own errors and returns an exit code, like the test-catalog commands.

function staleWarning(rebuild: RebuildOutcome | null): void {
  if (rebuild && !rebuild.ok) {
    process.stderr.write(`the warehouse copy test_map is out of date: ${rebuild.error}. Run openldr test-catalog map rebuild --apply.\n`);
  }
}

function fail(command: string, err: unknown, json: boolean): number {
  const msg = redactError(err);
  if (json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  else process.stderr.write(`test-catalog map ${command} failed: ${msg}\n`);
  return 1;
}

export interface TestMappingListOpts { status?: string; search?: string; limit?: string; offset?: string; json: boolean }

export async function runTestMappingList(opts: TestMappingListOpts): Promise<number> {
  const parsed = parseObservedQuery({ status: opts.status, q: opts.search, limit: opts.limit, offset: opts.offset });
  if (!parsed.ok) { process.stderr.write(`test-catalog map list failed: ${parsed.error}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.testMapping.observed(parsed.query);
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    const lines = out.rows.map((r) => {
      const target = r.catalog ? `${r.catalog.code} ${r.catalog.name ?? ''}${r.catalog.loinc ? ` (LOINC ${r.catalog.loinc})` : ''}` : '';
      return `${r.system}  ${r.code}  ${r.requests}  ${r.status}${target ? `  ${target}` : ''}${r.centralManaged ? '  [central]' : ''}`;
    });
    process.stdout.write([...lines, `${out.rows.length} of ${out.total} code(s)`].join('\n') + '\n');
    if (out.warehouse.stale) staleWarning({ ok: false, error: out.warehouse.error ?? 'the last rebuild failed' });
    return 0;
  } catch (err) { return fail('list', err, opts.json); } finally { await ctx.close(); }
}

export async function runTestMappingSet(system: string, code: string, catalogCode: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const change = await ctx.testMapping.set(system, code, catalogCode);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'test_mapping.set', entityType: 'test_mapping', entityId: `${system}|${code}`,
      before: { catalogCode: change.before }, after: { catalogCode: change.after }, metadata: { rebuild: change.rebuild.ok },
    });
    process.stdout.write(opts.json ? JSON.stringify(change, null, 2) + '\n' : `${code} now maps to ${catalogCode}.\n`);
    staleWarning(change.rebuild);
    return 0;
  } catch (err) { return fail('set', err, opts.json); } finally { await ctx.close(); }
}

export async function runTestMappingClear(system: string, code: string, opts: { force: boolean; json: boolean }): Promise<number> {
  if (!opts.force) { process.stderr.write('test-catalog map clear removes a mapping; pass --force to do it.\n'); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const change = await ctx.testMapping.clear(system, code);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'test_mapping.clear', entityType: 'test_mapping', entityId: `${system}|${code}`,
      before: { catalogCode: change.before }, after: { catalogCode: null }, metadata: { rebuild: change.rebuild.ok },
    });
    process.stdout.write(opts.json ? JSON.stringify(change, null, 2) + '\n' : `${code} no longer maps to a catalog test.\n`);
    staleWarning(change.rebuild);
    return 0;
  } catch (err) { return fail('clear', err, opts.json); } finally { await ctx.close(); }
}

export async function runTestMappingExport(opts: { out?: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const csv = await ctx.testMapping.exportCsv();
    if (opts.out) writeFileSync(opts.out, csv, 'utf8'); else process.stdout.write(csv);
    return 0;
  } catch (err) { return fail('export', err, false); } finally { await ctx.close(); }
}

export async function runTestMappingImport(file: string, opts: { apply: boolean; force: boolean; json: boolean }): Promise<number> {
  if (opts.apply && !opts.force) { process.stderr.write('test-catalog map import --apply writes mappings; pass --force to do it.\n'); return 1; }
  let bytes: Uint8Array;
  try { bytes = readFileSync(file); } catch (err) { process.stderr.write(`could not read ${file}: ${redactError(err)}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const report = opts.apply ? await ctx.testMapping.importApply(bytes) : await ctx.testMapping.importPreview(bytes);
    if (opts.apply) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'test_mapping.import', entityType: 'test_mapping', entityId: 'import',
        before: null, after: null, metadata: { counts: report.counts, refused: report.refused, rebuild: report.rebuild?.ok ?? null },
      });
    }
    if (opts.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return 0; }
    const c = report.counts;
    const verb = opts.apply ? 'mapped' : 'would map';
    process.stdout.write([
      `${verb} ${c.new} new, change ${c.changed}, leave ${c.unchanged} unchanged, refuse ${c.refused}`,
      ...report.refused.map((r) => `  line ${r.line} ${r.system} ${r.code}: ${r.reason}`),
    ].join('\n') + '\n');
    staleWarning(report.rebuild);
    return 0;
  } catch (err) { return fail('import', err, opts.json); } finally { await ctx.close(); }
}

export async function runTestMappingRebuild(opts: { apply: boolean; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await ctx.testMapping.publish({ apply: opts.apply });
    if (opts.json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return 0; }
    process.stdout.write([
      `${opts.apply ? 'wrote' : 'would write'} ${result.written} row(s); ${result.ambiguous.length} ambiguous, ${result.targetMissing.length} with a missing catalog test`,
      ...result.ambiguous.map((a) => `  ambiguous ${a.system} ${a.code}: ${a.catalogCodes.join(', ')}`),
      ...result.targetMissing.map((m) => `  missing ${m.system} ${m.code}: no catalog test ${m.catalogCode}`),
    ].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('rebuild', err, opts.json); } finally { await ctx.close(); }
}
```

In `packages/cli/src/program.ts`, import the six functions from `'./test-mapping'`, and after the `params <code>` command add:

```ts
  // Test mapping spec 4.6: lab test codes mapped to catalog tests. Clear and an applied import take --force.
  const testMap = testCatalog.command('map').description('Map lab test codes to catalog tests');
  testMap.command('list')
    .description('List the lab test codes seen in the warehouse, with their catalog mapping')
    .option('--status <unmapped|mapped|ambiguous|all>', 'which codes to list (default: all)')
    .option('--search <text>', 'match code, description or catalog name')
    .option('--limit <n>', 'rows per page, 1 to 200 (default: 25)')
    .option('--offset <n>', 'rows to skip (default: 0)')
    .option('--json', 'emit JSON', false)
    .action(async (opts: TestMappingListOpts) => { process.exitCode = await runTestMappingList(opts); });
  testMap.command('set <system> <code> <catalog-code>')
    .description('Map a lab test code to a catalog test')
    .option('--json', 'emit JSON', false)
    .action(async (system: string, code: string, catalogCode: string, opts: { json: boolean }) => {
      process.exitCode = await runTestMappingSet(system, code, catalogCode, opts);
    });
  testMap.command('clear <system> <code>')
    .description('Remove a lab test code\'s catalog mapping')
    .option('--force', 'confirm the removal', false)
    .option('--json', 'emit JSON', false)
    .action(async (system: string, code: string, opts: { force: boolean; json: boolean }) => {
      process.exitCode = await runTestMappingClear(system, code, opts);
    });
  testMap.command('export')
    .description('Write every observed code and its mapping as CSV, in the layout import reads')
    .option('--out <file>', 'write to this file instead of standard output')
    .action(async (opts: { out?: string }) => { process.exitCode = await runTestMappingExport(opts); });
  testMap.command('import <file>')
    .description('Import mappings from CSV. Shows what would change unless --apply --force is given.')
    .option('--apply', 'write the changes', false)
    .option('--force', 'confirm the write', false)
    .option('--json', 'emit JSON', false)
    .action(async (file: string, opts: { apply: boolean; force: boolean; json: boolean }) => {
      process.exitCode = await runTestMappingImport(file, opts);
    });
  testMap.command('rebuild')
    .description('Rebuild the warehouse copy test_map. Shows what it would write unless --apply is given.')
    .option('--apply', 'write test_map', false)
    .option('--json', 'emit JSON', false)
    .action(async (opts: { apply: boolean; json: boolean }) => { process.exitCode = await runTestMappingRebuild(opts); });
```

Also import `type TestMappingListOpts` from `'./test-mapping'`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd packages/cli && npx vitest run src/test-mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/test-mapping.ts packages/cli/src/test-mapping.test.ts packages/cli/src/program.ts
git commit -m "feat(cli): openldr test-catalog map commands"
```

---

### Task 9: Studio Observed tab, sheets and Tabs

**Files:**
- Modify: `apps/studio/src/api.ts` (after the test catalog block near line 2560)
- Create: `apps/studio/src/test-catalog/ObservedCodesTab.tsx`, `ObservedCodesTab.test.tsx`
- Create: `apps/studio/src/test-catalog/MapCodeSheet.tsx`, `MapCodeSheet.test.tsx`
- Create: `apps/studio/src/test-catalog/ImportMappingsSheet.tsx`, `ImportMappingsSheet.test.tsx`
- Modify: `apps/studio/src/pages/TestCatalog.tsx`, `apps/studio/src/pages/TestCatalog.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts` (`testCatalog` block at line 931, `packStep` at line 678), `fr.ts` (921, 676), `pt.ts` (921, 676)

**Interfaces:**
- Consumes: Task 6's routes.
- Produces: API functions `listObservedTestCodes(p)`, `getMappingTargets()`, `setTestMapping(system, code, catalogCode)`, `clearTestMapping(system, code)`, `downloadTestMappingsCsv()`, `previewTestMappingImport(file)`, `applyTestMappingImport(file)`, `rebuildTestMap()`. Types `ObservedTestCode`, `ObservedTestCodesResult`, `MappingTarget`, `TestMappingChange`, `MappingImportReport`, `RebuildOutcome`.

- [ ] **Step 1: Add the API client**

In `apps/studio/src/api.ts`, after `downloadTestCatalogCsv`:

```ts
// Mirrors of @openldr/bootstrap's test-mapping.ts. The routes are apps/server/src/test-mapping-routes.ts.
export type ObservedStatus = 'unmapped' | 'mapped' | 'ambiguous';
export interface ObservedTestCode {
  system: string; code: string; description: string | null; requests: number; lastSeen: string | null;
  status: ObservedStatus; catalog: { code: string; name: string | null; loinc: string | null } | null; centralManaged: boolean;
}
export interface ObservedTestCodesResult { rows: ObservedTestCode[]; total: number; warehouse: { stale: boolean; error: string | null } }
export interface MappingTarget { code: string; name: string | null; loinc: string | null; retired: boolean }
export type RebuildOutcome =
  | { ok: true; result: { mapped: number; ambiguous: Array<{ system: string; code: string; catalogCodes: string[] }>; targetMissing: Array<{ system: string; code: string; catalogCode: string }>; written: number } }
  | { ok: false; error: string };
export interface TestMappingChange { system: string; code: string; before: string | null; after: string | null; rebuild: RebuildOutcome }
export interface MappingImportReport {
  counts: { new: number; changed: number; unchanged: number; refused: number };
  refused: Array<{ line: number; system: string; code: string; reason: string }>;
  rebuild: RebuildOutcome | null;
}

export function listObservedTestCodes(p: { status?: ObservedStatus | 'all'; q?: string; limit: number; offset: number }): Promise<ObservedTestCodesResult> {
  const s = new URLSearchParams();
  if (p.status && p.status !== 'all') s.set('status', p.status);
  if (p.q) s.set('q', p.q);
  s.set('limit', String(p.limit));
  s.set('offset', String(p.offset));
  return apiGet<ObservedTestCodesResult>(`/api/test-catalog/mappings/observed?${s}`, 'list lab test codes');
}
export const getMappingTargets = (): Promise<MappingTarget[]> =>
  apiGet<{ targets: MappingTarget[] }>('/api/test-catalog/mappings/targets', 'load catalog tests').then((r) => r.targets);
export const setTestMapping = (system: string, code: string, catalogCode: string): Promise<TestMappingChange> =>
  authFetch('/api/test-catalog/mappings', jbody({ system, code, catalogCode }, 'PUT')).then((r) => okJson<TestMappingChange>(r, 'map test code'));
export const clearTestMapping = (system: string, code: string): Promise<TestMappingChange> =>
  authFetch('/api/test-catalog/mappings/clear', jbody({ system, code }, 'POST')).then((r) => okJson<TestMappingChange>(r, 'clear mapping'));
const uploadCsv = (url: string, file: File, what: string): Promise<MappingImportReport> =>
  authFetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file }).then((r) => okJson<MappingImportReport>(r, what));
export const previewTestMappingImport = (file: File): Promise<MappingImportReport> =>
  uploadCsv('/api/test-catalog/mappings/import/preview', file, 'check mappings file');
export const applyTestMappingImport = (file: File): Promise<MappingImportReport> =>
  uploadCsv('/api/test-catalog/mappings/import/apply', file, 'import mappings');
export const rebuildTestMap = (): Promise<RebuildOutcome> =>
  authFetch('/api/test-catalog/mappings/rebuild', { method: 'POST' }).then((r) => okJson<RebuildOutcome>(r, 'rebuild warehouse copy'));
export async function downloadTestMappingsCsv(): Promise<void> {
  const r = await authFetch('/api/test-catalog/mappings/export', { method: 'GET' });
  if (!r.ok) throw new Error(formatApiError('export mappings', await errorDetail(r)));
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = 'test-mappings.csv';
  a.click();
  URL.revokeObjectURL(url);
}
```

Before writing `downloadTestMappingsCsv`, read `downloadTestCatalogCsv`'s body (line 2556 on) and copy its exact download steps if they differ from the ones above.

- [ ] **Step 2: Add the strings in all three languages**

In `en.ts`, inside `testCatalog`, add:

```ts
    tabs: { tests: 'Tests', observed: 'Observed' },
    observed: {
      searchPlaceholder: 'Search code, description or catalog test',
      menuLabel: 'Observed codes actions',
      exportAction: 'Export CSV',
      importAction: 'Import CSV',
      rebuildAction: 'Rebuild warehouse copy',
      rebuilt: 'Warehouse copy rebuilt: {{count}} code(s)',
      stale: 'The warehouse copy test_map is out of date: {{error}}. Reports may show old mappings until it is rebuilt.',
      statusFilter: 'Status',
      status: { all: 'All', unmapped: 'Unmapped', mapped: 'Mapped', ambiguous: 'Ambiguous' },
      col: { system: 'System', code: 'Code', description: 'Description', requests: 'Requests', lastSeen: 'Last seen', catalog: 'Catalog test' },
      central: 'From central',
      noLoinc: 'No LOINC',
      empty: 'No lab test codes yet. They appear here once results arrive.',
      noMatch: 'No codes match.',
      count_one: '{{count}} code',
      count_other: '{{count}} codes',
      actionsFor: 'Actions for {{code}}',
      mapAction: 'Map to catalog test',
      rowActions: 'Row actions',
    },
    mapSheet: {
      title: 'Map lab test code',
      description: 'Reports count this lab code as the catalog test you choose.',
      section: 'Mapping',
      actions: 'Mapping actions',
      system: 'System',
      code: 'Code',
      catalogTest: 'Catalog test',
      pick: 'Choose a catalog test',
      search: 'Search catalog tests',
      clear: 'Clear mapping',
      saved: '{{code}} now maps to {{catalog}}',
      cleared: '{{code}} no longer maps to a catalog test',
      centralNote: 'Central maps this code. A lab cannot change it.',
      retired: 'retired',
    },
    importMappings: {
      title: 'Import mappings',
      description: 'A CSV with system and code columns, and catalog_code or loinc. A row with both blank is left as it is.',
      actions: 'Import actions',
      file: 'File',
      check: 'Check file',
      apply: 'Import',
      summary: '{{new}} new, {{changed}} changed, {{unchanged}} unchanged, {{refused}} refused',
      refusedLine: 'Line {{line}}, {{code}}: {{reason}}',
      done: 'Mappings imported',
    },
```

In the `packStep` object at line 678, add `'test-mappings': 'Test mappings'`.

In `fr.ts`, same keys:

```ts
    tabs: { tests: 'Tests', observed: 'Observés' },
    observed: {
      searchPlaceholder: 'Rechercher un code, une description ou un test du catalogue',
      menuLabel: 'Actions des codes observés',
      exportAction: 'Exporter en CSV',
      importAction: 'Importer un CSV',
      rebuildAction: 'Reconstruire la copie de l’entrepôt',
      rebuilt: 'Copie de l’entrepôt reconstruite : {{count}} code(s)',
      stale: 'La copie test_map de l’entrepôt n’est pas à jour : {{error}}. Les rapports peuvent montrer d’anciennes correspondances jusqu’à sa reconstruction.',
      statusFilter: 'Statut',
      status: { all: 'Tous', unmapped: 'Sans correspondance', mapped: 'Avec correspondance', ambiguous: 'Ambigu' },
      col: { system: 'Système', code: 'Code', description: 'Description', requests: 'Demandes', lastSeen: 'Vu pour la dernière fois', catalog: 'Test du catalogue' },
      central: 'Du central',
      noLoinc: 'Pas de LOINC',
      empty: 'Aucun code de test de laboratoire pour l’instant. Ils apparaissent ici dès que des résultats arrivent.',
      noMatch: 'Aucun code ne correspond.',
      count_one: '{{count}} code',
      count_other: '{{count}} codes',
      actionsFor: 'Actions pour {{code}}',
      mapAction: 'Associer à un test du catalogue',
      rowActions: 'Actions de la ligne',
    },
    mapSheet: {
      title: 'Associer un code de test de laboratoire',
      description: 'Les rapports comptent ce code de laboratoire comme le test du catalogue choisi.',
      section: 'Correspondance',
      actions: 'Actions de la correspondance',
      system: 'Système',
      code: 'Code',
      catalogTest: 'Test du catalogue',
      pick: 'Choisir un test du catalogue',
      search: 'Rechercher dans le catalogue',
      clear: 'Supprimer la correspondance',
      saved: '{{code}} correspond désormais à {{catalog}}',
      cleared: '{{code}} ne correspond plus à aucun test du catalogue',
      centralNote: 'Le central associe ce code. Un laboratoire ne peut pas le modifier.',
      retired: 'retiré',
    },
    importMappings: {
      title: 'Importer des correspondances',
      description: 'Un CSV avec les colonnes system et code, et catalog_code ou loinc. Une ligne où les deux sont vides reste inchangée.',
      actions: 'Actions de l’import',
      file: 'Fichier',
      check: 'Vérifier le fichier',
      apply: 'Importer',
      summary: '{{new}} nouvelles, {{changed}} modifiées, {{unchanged}} inchangées, {{refused}} refusées',
      refusedLine: 'Ligne {{line}}, {{code}} : {{reason}}',
      done: 'Correspondances importées',
    },
```

and in `packStep`: `'test-mappings': 'Correspondances de tests'`.

In `pt.ts`, same keys:

```ts
    tabs: { tests: 'Testes', observed: 'Observados' },
    observed: {
      searchPlaceholder: 'Pesquisar código, descrição ou teste do catálogo',
      menuLabel: 'Ações dos códigos observados',
      exportAction: 'Exportar CSV',
      importAction: 'Importar CSV',
      rebuildAction: 'Reconstruir a cópia do armazém',
      rebuilt: 'Cópia do armazém reconstruída: {{count}} código(s)',
      stale: 'A cópia test_map do armazém está desatualizada: {{error}}. Os relatórios podem mostrar correspondências antigas até ser reconstruída.',
      statusFilter: 'Estado',
      status: { all: 'Todos', unmapped: 'Sem correspondência', mapped: 'Com correspondência', ambiguous: 'Ambíguo' },
      col: { system: 'Sistema', code: 'Código', description: 'Descrição', requests: 'Pedidos', lastSeen: 'Visto pela última vez', catalog: 'Teste do catálogo' },
      central: 'Do central',
      noLoinc: 'Sem LOINC',
      empty: 'Ainda não há códigos de teste do laboratório. Aparecem aqui quando chegam resultados.',
      noMatch: 'Nenhum código corresponde.',
      count_one: '{{count}} código',
      count_other: '{{count}} códigos',
      actionsFor: 'Ações para {{code}}',
      mapAction: 'Associar a um teste do catálogo',
      rowActions: 'Ações da linha',
    },
    mapSheet: {
      title: 'Associar código de teste do laboratório',
      description: 'Os relatórios contam este código do laboratório como o teste do catálogo escolhido.',
      section: 'Correspondência',
      actions: 'Ações da correspondência',
      system: 'Sistema',
      code: 'Código',
      catalogTest: 'Teste do catálogo',
      pick: 'Escolher um teste do catálogo',
      search: 'Pesquisar no catálogo',
      clear: 'Remover correspondência',
      saved: '{{code}} corresponde agora a {{catalog}}',
      cleared: '{{code}} já não corresponde a nenhum teste do catálogo',
      centralNote: 'O central associa este código. Um laboratório não o pode alterar.',
      retired: 'retirado',
    },
    importMappings: {
      title: 'Importar correspondências',
      description: 'Um CSV com as colunas system e code, e catalog_code ou loinc. Uma linha com ambos vazios fica como está.',
      actions: 'Ações da importação',
      file: 'Ficheiro',
      check: 'Verificar ficheiro',
      apply: 'Importar',
      summary: '{{new}} novas, {{changed}} alteradas, {{unchanged}} inalteradas, {{refused}} recusadas',
      refusedLine: 'Linha {{line}}, {{code}}: {{reason}}',
      done: 'Correspondências importadas',
    },
```

and in `packStep`: `'test-mappings': 'Correspondências de testes'`.

If the repo has a test that checks every `en.ts` key exists in `fr.ts` and `pt.ts`, it now passes. If a key is missing, the studio shows literal braces, so check with that test in Step 9.

- [ ] **Step 3: Write the failing tab test**

`apps/studio/src/test-catalog/ObservedCodesTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listObservedTestCodes: vi.fn(), getMappingTargets: vi.fn(async () => []), rebuildTestMap: vi.fn(), downloadTestMappingsCsv: vi.fn() };
});

import * as api from '@/api';
import { ObservedCodesTab } from './ObservedCodesTab';

const DISA = 'urn:openldr:disa';
const ROW: api.ObservedTestCode = {
  system: DISA, code: 'HIVVL', description: 'HIV VL', requests: 2, lastSeen: '2026-05-03T08:00:00.000Z',
  status: 'mapped', catalog: { code: 'VL', name: 'HIV viral load', loinc: '25836-8' }, centralManaged: false,
};

beforeEach(() => { vi.mocked(api.listObservedTestCodes).mockReset(); });

describe('ObservedCodesTab', () => {
  it('shows the spinner, then a row with its catalog test and LOINC', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [ROW], total: 1, warehouse: { stale: false, error: null } });
    render(<ObservedCodesTab canManage />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByTestId('observed-row-HIVVL')).toBeTruthy();
    expect(screen.getByText('HIV viral load')).toBeTruthy();
    expect(screen.getByText('25836-8')).toBeTruthy();
    expect(vi.mocked(api.listObservedTestCodes)).toHaveBeenCalledWith({ status: 'all', q: undefined, limit: 25, offset: 0 });
  });

  it('shows the striped empty state when there are no codes, and no table', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [], total: 0, warehouse: { stale: false, error: null } });
    render(<ObservedCodesTab canManage />);
    expect(await screen.findByText('No lab test codes yet. They appear here once results arrive.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('warns when the warehouse copy is out of date', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [ROW], total: 1, warehouse: { stale: true, error: 'boom' } });
    render(<ObservedCodesTab canManage />);
    expect(await screen.findByTestId('observed-stale')).toBeTruthy();
  });

  it('marks an unmapped row and a central row', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({
      rows: [{ ...ROW, code: 'CD4', status: 'unmapped', catalog: null }, { ...ROW, centralManaged: true }], total: 2, warehouse: { stale: false, error: null },
    });
    render(<ObservedCodesTab canManage />);
    expect(await screen.findByText('Unmapped')).toBeTruthy();
    expect(screen.getByText('From central')).toBeTruthy();
  });

  it('hides row actions from a viewer', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [ROW], total: 1, warehouse: { stale: false, error: null } });
    render(<ObservedCodesTab canManage={false} />);
    await screen.findByTestId('observed-row-HIVVL');
    expect(screen.queryByTestId('observed-actions-HIVVL')).toBeNull();
  });

  it('asks again with the status filter', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [ROW], total: 1, warehouse: { stale: false, error: null } });
    render(<ObservedCodesTab canManage />);
    await screen.findByTestId('observed-row-HIVVL');
    fireEvent.click(screen.getByTestId('observed-status-unmapped'));
    await waitFor(() => expect(vi.mocked(api.listObservedTestCodes)).toHaveBeenLastCalledWith({ status: 'unmapped', q: undefined, limit: 25, offset: 0 }));
  });
});
```

- [ ] **Step 4: Run it and see it fail**

Run: `cd apps/studio && npx vitest run src/test-catalog/ObservedCodesTab.test.tsx`
Expected: FAIL, cannot resolve `./ObservedCodesTab`.

- [ ] **Step 5: Write the tab**

Open `apps/studio/src/facilities/ObservedTab.tsx` and `apps/studio/src/pages/TestCatalog.tsx` side by side first. Copy their table, state and pagination markup. `apps/studio/src/test-catalog/ObservedCodesTab.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import {
  downloadTestMappingsCsv, listObservedTestCodes, rebuildTestMap,
  type ObservedStatus, type ObservedTestCode, type ObservedTestCodesResult,
} from '@/api';
import { MapCodeSheet } from './MapCodeSheet';
import { ImportMappingsSheet } from './ImportMappingsSheet';

// The Observed tab of the Test catalog page (docs/superpowers/specs/2026-10-11-test-mapping-design.md,
// 4.4). Layout copied from facilities/ObservedTab.tsx and pages/TestCatalog.tsx.

const STATUSES: Array<ObservedStatus | 'all'> = ['all', 'unmapped', 'mapped', 'ambiguous'];

export function ObservedCodesTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ObservedStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<ObservedTestCodesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ObservedTestCode | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => { setQ(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listObservedTestCodes({ status, q: q || undefined, limit: pageSize, offset: page * pageSize }));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status, q, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  const rebuild = async () => {
    try {
      const out = await rebuildTestMap();
      if (out.ok) toast.success(t('testCatalog.observed.rebuilt', { count: out.result.written }));
      else toast.error(out.error);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const rows = data?.rows ?? [];
  const statusLabel = (s: ObservedStatus): string => t(`testCatalog.observed.status.${s}`);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="observed-codes-tab">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('testCatalog.observed.searchPlaceholder')}
          className="h-8 sm:max-w-xs"
          data-testid="observed-search"
        />
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('testCatalog.observed.statusFilter')}>
          {STATUSES.map((s) => (
            <Button
              key={s}
              variant={status === s ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              data-testid={`observed-status-${s}`}
              aria-pressed={status === s}
              onClick={() => { setStatus(s); setPage(0); }}
            >
              {t(`testCatalog.observed.status.${s}`)}
            </Button>
          ))}
        </div>
        {canManage && (
          <div className="sm:ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="observed-menu-trigger" aria-label={t('testCatalog.observed.menuLabel')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="observed-export"
                  onSelect={() => { downloadTestMappingsCsv().catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); }); }}
                >
                  {t('testCatalog.observed.exportAction')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="observed-import" onSelect={() => setImporting(true)}>
                  {t('testCatalog.observed.importAction')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="observed-rebuild" onSelect={() => void rebuild()}>
                  {t('testCatalog.observed.rebuildAction')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {data?.warehouse.stale && (
        <div className="border-b border-border px-4 py-2 text-xs text-destructive" data-testid="observed-stale">
          {t('testCatalog.observed.stale', { error: data.warehouse.error ?? '' })}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && error && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">
            {q !== '' || status !== 'all' ? t('testCatalog.observed.noMatch') : t('testCatalog.observed.empty')}
          </StripedEmpty>
        )}
        {/* Rendered only when populated: an empty table's header forces intrinsic width and scrolls a
            phone sideways (AGENTS.md section 6). */}
        {!loading && !error && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('testCatalog.observed.col.code')}</TableHead>
                <TableHead>{t('testCatalog.observed.col.description')}</TableHead>
                <TableHead className="text-right">{t('testCatalog.observed.col.requests')}</TableHead>
                <TableHead>{t('testCatalog.observed.col.catalog')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('testCatalog.observed.col.system')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('testCatalog.observed.col.lastSeen')}</TableHead>
                {canManage && <TableHead className="w-12"><span className="sr-only">{t('testCatalog.observed.rowActions')}</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((r) => (
                <TableRow key={`${r.system}|${r.code}`} data-testid={`observed-row-${r.code}`}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>{r.description ?? ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.requests}</TableCell>
                  <TableCell>
                    {r.status === 'mapped' && r.catalog ? (
                      <div className="flex flex-col">
                        <span>{r.catalog.name ?? r.catalog.code}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.catalog.code} · {r.catalog.loinc ?? t('testCatalog.observed.noLoinc')}
                        </span>
                      </div>
                    ) : (
                      <Badge variant={r.status === 'ambiguous' ? 'destructive' : 'outline'}>{statusLabel(r.status)}</Badge>
                    )}
                    {r.centralManaged && <Badge variant="secondary" className="ml-2">{t('testCatalog.observed.central')}</Badge>}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">{r.system}</TableCell>
                  <TableCell className="hidden md:table-cell">{r.lastSeen ? r.lastSeen.slice(0, 10) : ''}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                              data-testid={`observed-actions-${r.code}`}
                              aria-label={t('testCatalog.observed.actionsFor', { code: r.code })}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem data-testid={`observed-map-${r.code}`} onSelect={() => setMapping(r)}>
                              {t('testCatalog.observed.mapAction')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <TablePagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
        leftSlot={<span className="text-muted-foreground">{t('testCatalog.observed.count', { count: data?.total ?? 0 })}</span>}
      />

      <MapCodeSheet target={mapping} onClose={() => setMapping(null)} onSaved={() => { void load(); }} />
      <ImportMappingsSheet open={importing} onClose={() => setImporting(false)} onImported={() => { void load(); }} />
    </div>
  );
}

export default ObservedCodesTab;
```

Check `Badge`'s variant names in `components/ui/badge.tsx` and `LoadingState`'s rendered role in `components/ui/spinner.tsx`. If `LoadingState` does not render `role="status"`, change the first test's spinner assertion to the label text `t('common.loading')`.

- [ ] **Step 6: Write the failing sheet tests**

`apps/studio/src/test-catalog/MapCodeSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getMappingTargets: vi.fn(), setTestMapping: vi.fn(), clearTestMapping: vi.fn() };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { MapCodeSheet } from './MapCodeSheet';

const DISA = 'urn:openldr:disa';
const ROW: api.ObservedTestCode = { system: DISA, code: 'HIVVL', description: null, requests: 2, lastSeen: null, status: 'unmapped', catalog: null, centralManaged: false };
const REBUILT: api.RebuildOutcome = { ok: true, result: { mapped: 1, ambiguous: [], targetMissing: [], written: 1 } };

beforeEach(() => {
  vi.mocked(api.getMappingTargets).mockResolvedValue([{ code: 'VL', name: 'HIV viral load', loinc: '25836-8', retired: false }]);
  vi.mocked(api.setTestMapping).mockReset();
  vi.mocked(api.clearTestMapping).mockReset();
});

describe('MapCodeSheet', () => {
  it('shows the system and code labels left, and Save is in the sheet menu', async () => {
    render(<MapCodeSheet target={ROW} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByText(DISA)).toBeTruthy();
    expect(screen.getByText('HIVVL')).toBeTruthy();
    expect(screen.getByTestId('map-sheet-menu')).toBeTruthy();
  });

  it('saves the chosen catalog test and tells the page', async () => {
    vi.mocked(api.setTestMapping).mockResolvedValue({ system: DISA, code: 'HIVVL', before: null, after: 'VL', rebuild: REBUILT });
    const onSaved = vi.fn();
    render(<MapCodeSheet target={{ ...ROW, status: 'mapped', catalog: { code: 'VL', name: 'HIV viral load', loinc: '25836-8' } }} onClose={vi.fn()} onSaved={onSaved} />);
    await waitFor(() => expect(api.getMappingTargets).toHaveBeenCalled());
    fireEvent.pointerDown(screen.getByTestId('map-sheet-menu'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId('map-sheet-save'));
    await waitFor(() => expect(api.setTestMapping).toHaveBeenCalledWith(DISA, 'HIVVL', 'VL'));
    expect(onSaved).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('a central mapping is read-only: no Save, a note instead', async () => {
    render(<MapCodeSheet target={{ ...ROW, centralManaged: true }} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByText('Central maps this code. A lab cannot change it.')).toBeTruthy();
    expect(screen.queryByTestId('map-sheet-menu')).toBeNull();
  });
});
```

Radix `DropdownMenu` opens on pointer events. If `pointerDown` does not open it under jsdom, copy how `TestSheet.test.tsx` opens `test-sheet-menu`.

`apps/studio/src/test-catalog/ImportMappingsSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    previewTestMappingImport: vi.fn(async () => ({ counts: { new: 1, changed: 0, unchanged: 2, refused: 1 }, refused: [{ line: 4, system: 's', code: 'BAD', reason: 'no catalog test has code NOPE' }], rebuild: null })),
    applyTestMappingImport: vi.fn(async () => ({ counts: { new: 1, changed: 0, unchanged: 2, refused: 1 }, refused: [], rebuild: { ok: true, result: { mapped: 1, ambiguous: [], targetMissing: [], written: 1 } } })),
  };
});

import * as api from '@/api';
import { ImportMappingsSheet } from './ImportMappingsSheet';

describe('ImportMappingsSheet', () => {
  it('checks the file first and lists refused rows, then imports', async () => {
    const onImported = vi.fn();
    render(<ImportMappingsSheet open onClose={vi.fn()} onImported={onImported} />);
    const file = new File(['system,code,catalog_code\n'], 'm.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('import-mappings-file'), { target: { files: [file] } });
    expect(await screen.findByText('1 new, 0 changed, 2 unchanged, 1 refused')).toBeTruthy();
    expect(screen.getByText('Line 4, BAD: no catalog test has code NOPE')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('import-mappings-menu'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId('import-mappings-apply'));
    await waitFor(() => expect(api.applyTestMappingImport).toHaveBeenCalledWith(file));
    expect(onImported).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run them and see them fail**

Run: `cd apps/studio && npx vitest run src/test-catalog/MapCodeSheet.test.tsx src/test-catalog/ImportMappingsSheet.test.tsx`
Expected: FAIL, cannot resolve the modules.

- [ ] **Step 8: Write the two sheets**

`apps/studio/src/test-catalog/MapCodeSheet.tsx`, header and section layout copied from `TestSheet.tsx:164-200`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { clearTestMapping, getMappingTargets, setTestMapping, type MappingTarget, type ObservedTestCode } from '@/api';

export function MapCodeSheet({ target, onClose, onSaved }: {
  target: ObservedTestCode | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [targets, setTargets] = useState<MappingTarget[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setPicked(target.catalog?.code ?? null);
    getMappingTargets().then(setTargets).catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); });
  }, [target]);

  const run = async (action: () => Promise<{ rebuild: { ok: boolean } }>, done: string) => {
    setBusy(true);
    try {
      const change = await action();
      toast.success(done);
      if (!change.rebuild.ok) toast.error(t('testCatalog.observed.stale', { error: '' }));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const options = targets.map((x) => ({
    value: x.code,
    label: `${x.name ?? x.code} (${x.code}${x.loinc ? `, ${x.loinc}` : ''})${x.retired ? `, ${t('testCatalog.mapSheet.retired')}` : ''}`,
  }));
  const pickedName = targets.find((x) => x.code === picked)?.name ?? picked ?? '';

  return (
    <Sheet open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.mapSheet.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.mapSheet.description')}</SheetDescription>
        </SheetHeader>
        {target && (
          <section>
            <div className="flex items-center justify-between px-6 py-3">
              <div className="text-sm font-medium text-foreground">{t('testCatalog.mapSheet.section')}</div>
              {!target.centralManaged && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="map-sheet-menu" aria-label={t('testCatalog.mapSheet.actions')}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      data-testid="map-sheet-save"
                      disabled={busy || !picked}
                      onSelect={() => void run(() => setTestMapping(target.system, target.code, picked!), t('testCatalog.mapSheet.saved', { code: target.code, catalog: pickedName }))}
                    >
                      {t('common.save')}
                    </DropdownMenuItem>
                    {target.status !== 'unmapped' && (
                      <DropdownMenuItem
                        data-testid="map-sheet-clear"
                        disabled={busy}
                        onSelect={() => void run(() => clearTestMapping(target.system, target.code), t('testCatalog.mapSheet.cleared', { code: target.code }))}
                      >
                        {t('testCatalog.mapSheet.clear')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem data-testid="map-sheet-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="border-t border-border" />
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <div className="text-muted-foreground">{t('testCatalog.mapSheet.system')}</div>
              <div className="break-all font-mono text-xs">{target.system}</div>
              <div className="text-muted-foreground">{t('testCatalog.mapSheet.code')}</div>
              <div className="font-mono text-xs">{target.code}</div>
              <div className="text-muted-foreground">{t('testCatalog.mapSheet.catalogTest')}</div>
              {target.centralManaged ? (
                <div className="text-xs text-muted-foreground">{t('testCatalog.mapSheet.centralNote')}</div>
              ) : (
                <Combobox
                  options={options}
                  value={picked}
                  onChange={setPicked}
                  placeholder={t('testCatalog.mapSheet.pick')}
                  searchPlaceholder={t('testCatalog.mapSheet.search')}
                  disabled={busy}
                />
              )}
            </div>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

`Combobox` uses a Popover. AGENTS.md §6 warns that a portalled `PopoverContent` inside a Sheet cannot scroll. Read `components/ui/combobox.tsx` first. If its list is portalled and long lists cannot scroll in the Sheet, use the fix the existing pickers in `TestSheet.tsx` use, and nothing new.

`apps/studio/src/test-catalog/ImportMappingsSheet.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { applyTestMappingImport, previewTestMappingImport, type MappingImportReport } from '@/api';

export function ImportMappingsSheet({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<MappingImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => { setFile(null); setReport(null); onClose(); };

  const pick = async (f: File | null) => {
    setFile(f);
    setReport(null);
    if (!f) return;
    setBusy(true);
    try {
      setReport(await previewTestMappingImport(f));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const done = await applyTestMappingImport(file);
      toast.success(t('testCatalog.importMappings.done'));
      if (done.rebuild && !done.rebuild.ok) toast.error(t('testCatalog.observed.stale', { error: done.rebuild.error }));
      onImported();
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const c = report?.counts;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.importMappings.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.importMappings.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t('testCatalog.importMappings.file')}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="import-mappings-menu" aria-label={t('testCatalog.importMappings.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="import-mappings-apply"
                  disabled={busy || !report || (report.counts.new + report.counts.changed === 0)}
                  onSelect={() => void apply()}
                >
                  {t('testCatalog.importMappings.apply')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={close}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <div className="text-muted-foreground">{t('testCatalog.importMappings.file')}</div>
            <Input
              type="file"
              accept=".csv,text/csv"
              data-testid="import-mappings-file"
              disabled={busy}
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            />
          </div>
          {c && (
            <div className="space-y-1 border-t border-border px-6 py-4 text-sm">
              <div>{t('testCatalog.importMappings.summary', { new: c.new, changed: c.changed, unchanged: c.unchanged, refused: c.refused })}</div>
              {report!.refused.map((r) => (
                <div key={r.line} className="text-xs text-destructive">
                  {t('testCatalog.importMappings.refusedLine', { line: r.line, code: r.code, reason: r.reason })}
                </div>
              ))}
            </div>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
```

`Input type="file"` is the shadcn `Input`, not a native `<input>`.

- [ ] **Step 9: Put the page under Tabs**

In `apps/studio/src/pages/TestCatalog.tsx`, import `Tabs, TabsList, TabsTrigger, TabsContent` from `@/components/ui/tabs` and `ObservedCodesTab` from `@/test-catalog/ObservedCodesTab`. Wrap the existing body, following `pages/Facilities.tsx:1026-1044` and `:1085`:

```tsx
    <AppShell title={t('testCatalog.title')} fullBleed>
      <Tabs defaultValue="tests" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-4">
          <TabsList className="border-b-0">
            <TabsTrigger value="tests" data-testid="test-catalog-tab-tests">{t('testCatalog.tabs.tests')}</TabsTrigger>
            <TabsTrigger value="observed" data-testid="test-catalog-tab-observed">{t('testCatalog.tabs.observed')}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="tests" className="flex min-h-0 flex-1 flex-col">
          {/* the existing <div className="flex min-h-0 flex-1 flex-col" data-testid="test-catalog-page"> ... </div>, unchanged */}
        </TabsContent>
        <TabsContent value="observed" className="flex min-h-0 flex-1 flex-col">
          <ObservedCodesTab canManage={canManage} />
        </TabsContent>
      </Tabs>
    </AppShell>
```

`TabsContent` already carries `data-[state=inactive]:hidden` (`components/ui/tabs.tsx`, see the comment at `Facilities.tsx:1077-1084`). Check it is there; if not, add it to this page's two `TabsContent` class names.

In `apps/studio/src/pages/TestCatalog.test.tsx`, mock `listObservedTestCodes` the way it mocks `listTestCatalog`, and add a test that switching to the Observed tab renders `observed-codes-tab`. Radix switches tabs on `mouseDown`, not `click` (`Facilities.test.tsx:586`):

```tsx
  it('switches to the Observed tab', async () => {
    // render the page as the existing tests do
    fireEvent.mouseDown(await screen.findByTestId('test-catalog-tab-observed'));
    expect(await screen.findByTestId('observed-codes-tab')).toBeTruthy();
  });
```

- [ ] **Step 10: Run the studio tests and typecheck**

Run: `cd apps/studio && npx vitest run src/test-catalog src/pages/TestCatalog.test.tsx`
Expected: PASS.

Run the i18n key test if one exists: `cd apps/studio && npx vitest run src/i18n`
Expected: PASS.

Run: `pnpm turbo run typecheck --force --concurrency=2 --filter @openldr/studio > /tmp/tc9.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 11: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/test-catalog/ObservedCodesTab.tsx apps/studio/src/test-catalog/ObservedCodesTab.test.tsx apps/studio/src/test-catalog/MapCodeSheet.tsx apps/studio/src/test-catalog/MapCodeSheet.test.tsx apps/studio/src/test-catalog/ImportMappingsSheet.tsx apps/studio/src/test-catalog/ImportMappingsSheet.test.tsx apps/studio/src/pages/TestCatalog.tsx apps/studio/src/pages/TestCatalog.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Observed tab maps lab test codes to catalog tests"
```

---

### Task 10: Docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/test-catalog.md`, `fr/test-catalog.md`, `pt/test-catalog.md`
- Modify: `apps/web/src/docs/0.1.8/test-catalog.md` (its English, Français and Português sections)
- Modify: `apps/studio/src/docs/0.1.8/en/marketplace.md` (Content packs section, line 45), and `fr/marketplace.md` where it has a content pack section
- Modify: `apps/web/src/docs/0.1.8/cli.md` (the `test-catalog` commands)

**Interfaces:** none.

- [ ] **Step 1: Write the English in-app section**

Add to `apps/studio/src/docs/0.1.8/en/test-catalog.md`, after "Result parameters":

````markdown
## Mapping lab test codes

Each lab system names its tests its own way. DISA calls viral load `HIVVL`, `POCVR` or `POHVL`. Map each of those codes to the catalog test it means, and reports can count the catalog test whatever the lab called it.

Open the **Observed** tab. It lists every test code in the warehouse, with its description, the number of requests and the date last seen. A code you mapped before any data arrived shows with 0 requests. Filter by **Unmapped**, **Mapped** or **Ambiguous**.

To map a code, open its row's ⋯ menu and choose **Map to catalog test**. Pick the test, then **Save** from the sheet's ⋯ menu. **Clear mapping** removes it.

Codes match exactly. `HIVVL` and `HIVVL ` with a trailing space are two codes.

A code is **Ambiguous** when it has two catalog mappings, for example one made on the Terminology page and one here. Reports leave it out until you map it again.

A lab cannot change a mapping central sent down. Its row says **From central**.

### Mapping many codes at once

**Export CSV** from the tab's ⋯ menu writes every observed code. Fill in `catalog_code`, or `loinc` when you know only the LOINC code, then **Import CSV**. The import shows new, changed, unchanged and refused rows before it writes anything. A row with both columns blank is left as it is.

### Reports

Mappings are copied to the warehouse table `test_map`. A report joins it like this:

```sql
select tm.catalog_name, count(*)
from lab_requests lr
join test_map tm on tm.level = 'test'
  and tm.source_system = lr.panel_system
  and tm.source_code = lr.panel_code
where tm.loinc = '25836-8'
group by tm.catalog_name
```

The copy updates when a mapping or a catalog test changes, and at start-up. If an update fails, the tab says so. Choose **Rebuild warehouse copy** from its ⋯ menu.
````

- [ ] **Step 2: Write the French and Portuguese in-app sections**

Translate Step 1's section into `fr/test-catalog.md` and `pt/test-catalog.md`. Use the same UI names as the strings added in Task 9, Step 2: **Observés** and **Observados**, **Associer à un test du catalogue** and **Associar a um teste do catálogo**, and so on. Keep the SQL block unchanged.

- [ ] **Step 3: Add the section to the web docs**

In `apps/web/src/docs/0.1.8/test-catalog.md`, add a short paragraph to each of its three language sections: the Observed tab, mapping a code, the CSV, and the `test_map` join, in the same words as Steps 1 and 2.

- [ ] **Step 4: Document the pack step**

In `apps/studio/src/docs/0.1.8/en/marketplace.md`, in "Content packs", add:

```markdown
A pack can map lab test codes to catalog tests (**Test mappings**). It names each code's LOINC code, and CE maps it to the catalog test linked to that LOINC. A code the pack cannot resolve is skipped and listed: no catalog test has that LOINC, or two do. A code already mapped here is kept. The CLI dry run (`openldr market install <dir> --dry-run`) lists what it would map, keep and skip.
```

Add the same paragraph, translated, to `fr/marketplace.md` if that file has a content pack section. `pt/marketplace.md` has no content pack section (a gap that predates this plan). Say so in the task report rather than writing half a section.

- [ ] **Step 5: Document the CLI**

In `apps/web/src/docs/0.1.8/cli.md`, next to the `test-catalog` commands, add the six `openldr test-catalog map` commands from the spec, 4.6, each with one line on what it does, and note that `clear` and `import --apply` need `--force`.

- [ ] **Step 6: Run the docs tests**

Run: `cd apps/studio && npx vitest run src/docs` and `cd apps/web && npx vitest run src/docs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/test-catalog.md apps/studio/src/docs/0.1.8/fr/test-catalog.md apps/studio/src/docs/0.1.8/pt/test-catalog.md apps/web/src/docs/0.1.8/test-catalog.md apps/studio/src/docs/0.1.8/en/marketplace.md apps/web/src/docs/0.1.8/cli.md
git commit -m "docs: mapping lab test codes to the test catalog"
```

Add `apps/studio/src/docs/0.1.8/fr/marketplace.md` if Step 4 changed it.

---

### Task 11: Spec note, gate, live check, changelog

**Files:**
- Modify: `docs/superpowers/specs/2026-10-11-test-mapping-design.md`

- [ ] **Step 1: Record the planning changes in the spec**

Append to the spec:

```markdown
## 9. Changes during planning

Each follows existing code.

1. A lab editing a central-owned mapping gets 409 with `kind: 'central-managed'`, as the catalog routes do, not 403.
2. Refusals are `{ error, kind }`, as the catalog routes do, not error-catalog codes.
3. The studio install confirm does not show the pack's mapped, kept and skipped lists. It does not call the check for link-matching either. The CLI dry run and the audit row carry them.
4. Catalog edits call an `onChanged` callback on `createTestCatalog`.
5. Sync bursts go through a coalescing runner: at most two rebuilds per burst.
6. Warehouse rows with a null `panel_system` or `panel_code` are left off the Observed list.
7. A blank `catalog_code` and `loinc` in an imported CSV row means no change.
```

Also change section 4.8's first two error rows to match points 1 and 2.

- [ ] **Step 2: Run the full gate**

Run, in this order, each to its own file:

```bash
pnpm turbo run test --force --concurrency=2 --continue > /tmp/gate-test.txt 2>&1; echo "test exit=$?"
pnpm turbo run typecheck --force --concurrency=2 > /tmp/gate-tc.txt 2>&1; echo "typecheck exit=$?"
pnpm --filter @openldr/server lint > /tmp/gate-lint.txt 2>&1; echo "lint exit=$?"
```

Expected: all three `exit=0`, `Cached: 0 cached`. If a package fails, grep its output for `out of memory`, `VirtualAlloc` and `Test timed out`, and re-run that package alone before treating it as a regression (CLAUDE.md, test gate).

- [ ] **Step 3: Live check on the dev CE**

This needs the work merged to `main`, because the dev servers run from the main checkout. Ask the operator before merging. Then:

1. Start the API and studio the usual way. Ingest a small FHIR bundle with two `ServiceRequest`s coded `urn:openldr:disa`/`HIVVL` and one coded `urn:openldr:disa`/`CD4`, using `openldr ingest`. The dev warehouse holds no lab requests.
2. Add a catalog test `ZZVL` with LOINC `25836-8` on the Tests tab.
3. On the Observed tab, check `HIVVL` shows 2 requests and `CD4` shows 1. Map `HIVVL` to `ZZVL` through the sheet.
4. Export the CSV, set `CD4`'s `loinc` to `25836-8`, import it, and check the preview says 1 changed or new. Apply it.
5. Run as a custom query on the Query page: `select source_code, catalog_code, loinc from test_map order by source_code`. Expect both codes, `ZZVL`, `25836-8`.
6. Run `openldr test-catalog map list --status mapped` and `openldr test-catalog map rebuild`.
7. Check the Observed tab and the map sheet at 375 px with `resize_window`. No sideways scroll, every action reachable.
8. Clean up: clear both mappings, retire `ZZVL`, and remove the ingested test rows the way the test catalog S4 live check did (memory note `test-catalog-workstream`).

Report what was checked live and what was not. The sync path (a central mapping reaching a lab) needs two nodes, and stays an **honest non-proof** unless the operator runs the two-node demo. A real phone is also outside what `resize_window` proves.

- [ ] **Step 4: Changelog**

After merging to `main`: run `pnpm make:changelog`, check the new entries, and commit `apps/web/src/landing/changelog.json`.

---

## Self-review

**Spec coverage.**

| Spec section | Task |
|---|---|
| 4.1 mapping as a term mapping | 3 (`writeMapping`) |
| 4.2 `test_map` and governance | 1 |
| 4.3 rebuild and every trigger | 2 (publish), 3 (coalescer), 5 (catalog, sync, boot, general routes), 3/4/7 (writers) |
| 4.4 Observed tab, central read-only | 2 (read), 3 (guard), 6 (routes), 9 (UI) |
| 4.5 CSV | 4, 6, 9 |
| 4.6 CLI | 8 |
| 4.7 pack step | 7 |
| 4.8 errors | 3, 4, 6 |
| 6 tests | every task, plus Task 11 |
| 7 done: UI, CLI, docs, mobile, changelog | 9, 8, 10, 11, 11 |

**Placeholders.** Three steps say "copy the nearest existing test" (Task 5 Step 6, Task 7 Step 10, Task 9 Step 9). Each names the file and the exact assertion to add. Their harnesses exist and differ per file, so copying them is safer than guessing here.

**Type consistency.** `ObservedTestCode`, `ObservedQuery`, `RebuildOutcome`, `TestMappingChange`, `MappingImportReport`, `PackMappingInput` and `PackMappingPlan` are defined once in `test-mapping.ts` and mirrored field for field in `api.ts`. `TestMapping` is `ReturnType<typeof createTestMapping>`, so each task's added functions join it automatically. The route test's fake names exactly the methods the routes call.

**Review focus.** Each of the five lines has a test: 1 in Task 7, 2 and 3 in Task 2, 4 in Task 4, 5 in Task 3.
