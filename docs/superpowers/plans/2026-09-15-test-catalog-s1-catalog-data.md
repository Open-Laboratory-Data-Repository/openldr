# Test catalog S1: catalog data, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** CE holds a national test catalog it can read, add to and edit, and each install records which tests it runs, through a service the API and the `openldr test-catalog list` command share.

**Architecture:** Migration 104 seeds two CE-owned code systems (the catalog and its categories), the category ValueSet and a lab-only settings table. A service in `@openldr/bootstrap`, `createTestCatalog`, reads catalog concepts, their LOINC term mappings and the lab settings, and validates writes against the category and specimen-type ValueSets. `apps/server` serves it under `/api/test-catalog`, and the CLI lists it.

**Tech Stack:** TypeScript, Kysely, Postgres (`jsonb`), Fastify, zod, commander, vitest with pg-mem.

**Spec:** `docs/superpowers/specs/2026-09-15-test-catalog-design.md`, sections 4.2, 4.6, 5 (S1) and 7.

## Global Constraints

- Work in a git worktree under `.claude/worktrees/`, never the main checkout. Leave `.claude/worktrees/peaceful-kirch-839cb2` alone.
- Stage by exact path. Never `git add <dir>`. No `Co-Authored-By` trailer.
- Commit only as these steps say. Merge or push only when the operator asks.
- New writing follows the `unslop` skill, code comments included: no em dashes, no emoji in headings or bullets.
- Run a single test file as `cd <package> && npx vitest run <path>`. `pnpm --filter <pkg> test -- <path>` does not filter.
- The gate is `pnpm turbo run typecheck --force --concurrency=4` and `pnpm turbo run test --force --concurrency=4 --continue`, each redirected to a file before reading `$?`. Never pipe turbo through `tail`. A failure is usually a timeout: grep for `Test timed out` and re-run that package alone.
- **Migration 104.** Free on `main`, `origin/main`, every local branch and the `peaceful-kirch` working tree on 2026-09-15. Re-run the sweep in Task 8 right before merging. If another branch has taken 104, renumber: `git mv` both files, update `index.ts` (import alias and key, kept last), the manifest in `packages/db/src/migrations/migrations.test.ts`, and every comment naming the number.
- **Never migrate a persistent database from the worktree.** The running dev API (`nodemon`, main checkout) restarts when a merge changes its files, and it migrates the dev database on boot. Merging this branch migrates the dev database to 104, so merge only once the number is final.
- **No clinical vocabulary in service code** (AGENTS.md section 8). Category and specimen codes come from ValueSets. The five starting categories live only in migration 104.
- **No UI in S1,** so no 375px check. Docs ship in en, fr and pt. The changelog runs after the merge, on `main`.

---

## Settled before S1 (spec section 7)

### Open item 1: the lab ValueSet must never sync. Verdict: it would sync, lab to central, if built as a normal ValueSet.

- **ValueSets never travel central to lab.** The pull carries `reference_change_log`, whose entity types have no ValueSet (`packages/db/src/reference-change-log.ts:28-31`). Saving a ValueSet registers it through `saveSystem`, which sends no sync signal (`packages/db/src/terminology-store.ts:156-162`).
- **A lab's saved ValueSets do travel lab to central.** `valueSets.save` writes the FHIR resource through `fhirStore.save` (`packages/db/src/terminology-admin-store.ts:460-471`, `packages/bootstrap/src/index.ts:880-883`), which stamps a `fhir.change_log` row with the local `site_id` (`packages/db/src/fhir-store.ts:218-221`). The push sends every change_log row with no resource-type filter (`packages/db/src/projection/fetch.ts:26-32`), and central's `applyRemote` stores it.
- **A picker must read a FHIR resource.** `ops.expand` loads a ValueSet with `getResourceByUrl` (`packages/terminology/src/operations.ts:41-56`), which reads `terminology_systems` and then `fhir.fhir_resources`.
- **Consequence for S4, not S1:** `urn:openldr:valueset:lab-tests` must never be written through `valueSets.save` or `fhirStore.save`. Either write its canonical row directly with no change_log row, as migration 069 does (`packages/db/src/migrations/internal/069_result_role_valuesets.ts:84-101`), and mark it `immutable` so the Terminology page cannot re-save it, or have S4's picker read a catalog route instead of a ValueSet. S4's plan chooses. S1 builds no lab ValueSet.

### Open item 2: how categories are seeded. Decision: migration 104, the way 069 seeds its sets.

- The category ValueSet must exist on every install, because ValueSets never reach a lab through the pull (above).
- 104 writes the `value_sets` row, the canonical `fhir.fhir_resources` row and the `terminology_systems` row, and no `fhir.change_log` row. The set is a whole-system include with no expansion, so the warehouse projection loses nothing, and no global sequence shifts (the hazard in memory note `migration-seeded-changelog-blast-radius`).
- `ops.expand` computes the set live from the category concepts, so a category central adds reaches a lab as a concept, through the terminology pull, and the lab's set includes it with no re-save. Only the result-parameters loader ever re-saves a set (`packages/bootstrap/src/reexpand-value-sets.ts:74`).

### Open item 3: migration number. S1 takes 104, so the spec's migration 104 for the Lab order (S4) becomes 105.

---

## Where this plan departs from the spec

| Spec says | Plan does | Why |
|---|---|---|
| `specimenTypes` is "a list of SNOMED specimen codes" (4.2) | A list of `{ system, code }` codings, each in `urn:openldr:valueset:specimen-type` | The Lab order's specimen picker offers that ValueSet (`packages/forms/src/samples/forms.ts:482`). On a default install it holds four local codes on `urn:openldr:cs:local` (BLD, UR, CSF, SPT), not SNOMED (checked on the operator's database, 0 SNOMED concepts). Bare SNOMED codes would never match what the picker offers, so S4's narrowing could never work. A site that imports SNOMED repoints the ValueSet, and SNOMED codings then validate. |
| Status `ACTIVE` or `RETIRED` (4.2) | Retired is stored as concept status `DEPRECATED`, shown as `active: false` | Terminology's statuses are `ACTIVE`, `DRAFT`, `DEPRECATED`, `DISABLED` (`terminology-admin-store.ts:54`), and the term route refuses anything else (`apps/server/src/terminology-admin-routes.ts:124`). A `RETIRED` concept could not be saved from the Terminology page. |
| LOINC link with equivalence `equivalent` (4.2) | Map type `SAME-AS` | `term_mappings` has no equivalence column. `concept_map_elements.equivalence` stores the map type as given (`terminology-admin-store.ts:906`), and `SAME-AS` is CE's equivalent. |
| "If it was received from central" (4.3) | Received means `terminology_systems.managed_origin = 'central'` for the catalog URL | Only the lab's terminology drain sets it (`packages/sync/src/terminology-sync.ts:115-136`, column from migration 050). `managed_origin` exists on concepts nowhere (`049_terminology_managed_origin.ts:9`). |
| Migration 104 is the Lab order repoint (4.5) | 104 is S1's; S4's becomes 105 | S1 needs the first migration. |

**Also decided here:**

- **Named filters, not the shared table query grammar.** The spec names four filters (4.3). The Facilities route layers the grammar on top of named params (`apps/server/src/facilities-routes.ts:908-936`), and pg-mem cannot parse the grammar's `COLLATE` sorts (memory note `table-query-grammar-arc`). The shared toolbar works without the grammar (slice D of that arc).
- **No `GET /api/test-catalog/:code`.** Nothing needs it yet. The service's `get` exists for the writes and the audit.
- **The list filters in code, not SQL.** The catalog is capped at a few thousand tests (spec 4.4), and search spans four fields, one of them from the lab settings table.

## Known effects, not handled in S1

- **A LOINC link to a code that is not loaded stubs a `DRAFT` concept** in `http://loinc.org` (`terminology-admin-store.ts:908-912`, and the same in `saveExclusive`). Existing mapping behaviour. The service therefore counts LOINC as loaded only when a non-`DRAFT` LOINC concept exists.
- **Saving a test is two writes, not one transaction:** the concept, then the LOINC link through the admin store, which opens its own transaction. A failed link leaves the test saved without it, and saving again links it. S3's import applies in one transaction (spec 4.4) and must solve this.
- **A lab's first pull deletes any catalog tests the lab wrote itself** before enrolling. Ownership is per system, not per concept (`packages/sync/src/terminology-sync.ts:74-80`).
- **The Terminology page can still add, edit or delete catalog terms directly.** An edit there keeps `category` and `specimenTypes` (S0). A term added there has neither.
- **Lab settings for a test central later deletes stay as rows.** The list ignores them.
- **CLI parity (AGENTS.md section 6):** S1 ships `openldr test-catalog list` only, as spec section 5 says. The write routes have no CLI yet. `enable`, `disable`, `retire`, `import` and `export` land with the slices that own them.

---

## What changes

| File | Change |
|---|---|
| `packages/db/src/migrations/internal/104_test_catalog.ts` | Create. Table, two coding systems, five categories, category ValueSet. |
| `packages/db/src/migrations/internal/104_test_catalog.test.ts` | Create. |
| `packages/db/src/migrations/internal/index.ts` | Register 104. |
| `packages/db/src/migrations/migrations.test.ts` | Add `'104_test_catalog'` to the manifest. |
| `packages/db/src/schema/internal.ts` | `TestCatalogLabSettingsTable` and its `InternalSchema` entry. |
| `packages/bootstrap/src/test-catalog.ts` | Create. The service. |
| `packages/bootstrap/src/test-catalog.test.ts` | Create. |
| `packages/bootstrap/src/index.ts` | `AppContext.testCatalog`, construction, exports. |
| `apps/server/src/test-catalog-routes.ts` | Create. |
| `apps/server/src/test-catalog-routes.test.ts` | Create. |
| `apps/server/src/app.ts` | Register the routes. |
| `packages/cli/src/test-catalog.ts` | Create. `runTestCatalogList`. |
| `packages/cli/src/test-catalog.test.ts` | Create. |
| `packages/cli/src/test-catalog-cli-parsing.test.ts` | Create. |
| `packages/cli/src/program.ts` | Register `test-catalog list`. |
| `apps/web/src/docs/0.1.8/cli.md` | Command-group row, and a Test catalog section in en, fr and pt. |
| `apps/studio/src/docs/0.1.8/en/terminology.md` | A Test catalog section. fr and pt have no Terminology page; the registry shows English (`apps/studio/src/docs/registry.ts:415`). |

---

### Task 1: migration 104

**Files:**
- Create: `packages/db/src/migrations/internal/104_test_catalog.ts`
- Create: `packages/db/src/migrations/internal/104_test_catalog.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (after the `103_lab_order_requisition_slot` import and entry)
- Modify: `packages/db/src/migrations/migrations.test.ts:7`
- Modify: `packages/db/src/schema/internal.ts` (new interface; `InternalSchema` at `:914`)

**Interfaces:**
- Produces: table `test_catalog_lab_settings(code text pk, enabled boolean not null default false, specimen_types jsonb, local_display text, updated_at timestamptz not null default now())`; coding systems `cs-url-TEST-CATALOG` (`urn:openldr:codesystem:test-catalog`) and `cs-url-TEST-CATEGORY` (`urn:openldr:codesystem:test-category`); five category concepts; ValueSet `vs-test-category` at `urn:openldr:valueset:test-category`. Later tasks rely on these URLs and the table.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/internal/104_test_catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { up, down, CATALOG_SYSTEM, CATEGORY_SYSTEM, CATEGORY_VALUE_SET } from './104_test_catalog';

describe('104 test catalog', () => {
  it('seeds the catalog and category systems under the System publisher', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('coding_systems').select(['id', 'url', 'publisher_id', 'seeded'])
      .where('url', 'in', [CATALOG_SYSTEM, CATEGORY_SYSTEM]).orderBy('id').execute();
    expect(rows).toEqual([
      { id: 'cs-url-TEST-CATALOG', url: CATALOG_SYSTEM, publisher_id: 'pub-system', seeded: true },
      { id: 'cs-url-TEST-CATEGORY', url: CATEGORY_SYSTEM, publisher_id: 'pub-system', seeded: true },
    ]);
  });

  it('seeds the five starting categories as active concepts', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('terminology_concepts').select(['code', 'display', 'status'])
      .where('system', '=', CATEGORY_SYSTEM).orderBy('code').execute();
    expect(rows).toEqual([
      { code: 'CHEM', display: 'Chemistry', status: 'ACTIVE' },
      { code: 'HAEM', display: 'Haematology', status: 'ACTIVE' },
      { code: 'MICRO', display: 'Microbiology', status: 'ACTIVE' },
      { code: 'MOL', display: 'Molecular', status: 'ACTIVE' },
      { code: 'SERO', display: 'Serology', status: 'ACTIVE' },
    ]);
  });

  it('registers the category ValueSet and writes no fhir.change_log row for it', async () => {
    const db = await makeMigratedDb();
    const reg = await db.selectFrom('terminology_systems').select(['kind', 'resource_id'])
      .where('url', '=', CATEGORY_VALUE_SET).executeTakeFirstOrThrow();
    expect(reg).toEqual({ kind: 'ValueSet', resource_id: 'vs-test-category' });
    const canonical = await db.selectFrom('fhir.fhir_resources').select('id')
      .where('resource_type', '=', 'ValueSet').where('id', '=', 'vs-test-category').execute();
    expect(canonical).toHaveLength(1);
    const logged = await db.selectFrom('fhir.change_log').select('seq')
      .where('resource_type', '=', 'ValueSet').where('resource_id', '=', 'vs-test-category').execute();
    expect(logged).toEqual([]);
  });

  it('creates the lab settings table with a test switched off by default', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('test_catalog_lab_settings').values({ code: 'HIVVL' }).execute();
    const row = await db.selectFrom('test_catalog_lab_settings').selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ code: 'HIVVL', enabled: false, specimen_types: null, local_display: null });
  });

  it('keeps a system already at the catalog url instead of replacing it', async () => {
    const db = await makeMigratedDb();
    await down(db as never);
    await db.insertInto('coding_systems').values({
      id: 'cs-operator-made', system_code: 'MY-CATALOG', system_name: 'Mine', url: CATALOG_SYSTEM,
      active: true, publisher_id: 'pub-system', seeded: false,
    } as never).execute();
    await up(db as never);
    const rows = await db.selectFrom('coding_systems').select('id').where('url', '=', CATALOG_SYSTEM).execute();
    expect(rows).toEqual([{ id: 'cs-operator-made' }]);
  });

  it('down removes what up seeded', async () => {
    const db = await makeMigratedDb();
    await down(db as never);
    expect(await db.selectFrom('coding_systems').select('id').where('url', 'in', [CATALOG_SYSTEM, CATEGORY_SYSTEM]).execute()).toEqual([]);
    expect(await db.selectFrom('terminology_concepts').select('code').where('system', '=', CATEGORY_SYSTEM).execute()).toEqual([]);
    expect(await db.selectFrom('value_sets').select('id').where('url', '=', CATEGORY_VALUE_SET).execute()).toEqual([]);
    expect(await db.selectFrom('terminology_systems').select('url').where('url', '=', CATEGORY_VALUE_SET).execute()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/db && npx vitest run src/migrations/internal/104_test_catalog.test.ts`

Expected: FAIL. The module `./104_test_catalog` does not exist.

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/internal/104_test_catalog.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import type { VsCompose } from '../../value-set-expander';

// The national test catalog and its categories (docs/superpowers/specs/2026-09-15-test-catalog-design.md,
// 4.2), seeded on every install so a lab has both before it ever pulls from central.
//
// These values are inlined, not imported, because a migration is a frozen record of what it wrote
// (see 075_facility_registry_coding_system.ts). They must stay equal to the constants in
// packages/bootstrap/src/test-catalog.ts:
//   CATALOG_SYSTEM     = TEST_CATALOG_SYSTEM
//   CATEGORY_SYSTEM    = TEST_CATEGORY_SYSTEM
//   CATEGORY_VALUE_SET = TEST_CATEGORY_VALUE_SET
export const CATALOG_SYSTEM = 'urn:openldr:codesystem:test-catalog';
export const CATEGORY_SYSTEM = 'urn:openldr:codesystem:test-category';
export const CATEGORY_VALUE_SET = 'urn:openldr:valueset:test-category';
const PUBLISHER_ID = 'pub-system';

// Ids follow `codingSystems.upsertByUrl`'s `cs-url-${systemCode}`, so a later upsert by url lands on
// these rows instead of creating competing ones. `seeded: true` stops the Terminology page deleting them.
const SYSTEMS = [
  { id: 'cs-url-TEST-CATALOG', system_code: 'TEST-CATALOG', system_name: 'Test catalog', url: CATALOG_SYSTEM },
  { id: 'cs-url-TEST-CATEGORY', system_code: 'TEST-CATEGORY', system_name: 'Test categories', url: CATEGORY_SYSTEM },
];

// The starting categories the spec names. Operators edit them on the Terminology page. Central's
// edits reach labs as concepts through the terminology pull.
const CATEGORIES = [
  { code: 'CHEM', display: 'Chemistry' },
  { code: 'HAEM', display: 'Haematology' },
  { code: 'MICRO', display: 'Microbiology' },
  { code: 'SERO', display: 'Serology' },
  { code: 'MOL', display: 'Molecular' },
];

const CATEGORY_VS_ID = 'vs-test-category';
const CATEGORY_VS_TITLE = 'Test categories';
const CATEGORY_VS_DESCRIPTION = 'The national list of test categories the test catalog uses.';
const CATEGORY_COMPOSE: VsCompose = { include: [{ system: CATEGORY_SYSTEM }] };

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;

  // One row per catalog test this install has touched. Sync never writes it: central's catalog
  // arrives as terminology concepts, and this table is the lab's own answer to it.
  await seedDb.schema.createTable('test_catalog_lab_settings')
    .addColumn('code', 'text', (c) => c.primaryKey())
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    // null means the lab uses the catalog's own specimen list. A list is the lab's narrower choice.
    .addColumn('specimen_types', 'jsonb')
    .addColumn('local_display', 'text')
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  for (const s of SYSTEMS) {
    // ON CONFLICT (url) DO NOTHING: an install that already holds a system at this url keeps it.
    await seedDb.insertInto('coding_systems').values({
      ...s, active: true, publisher_id: PUBLISHER_ID, seeded: true,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
  }

  for (const c of CATEGORIES) {
    await seedDb.insertInto('terminology_concepts').values({
      system: CATEGORY_SYSTEM, code: c.code, display: c.display, status: 'ACTIVE', properties: null,
    } as never).onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
  }

  // The category ValueSet, written the way 069 writes its sets: the value_sets row, the canonical
  // FHIR row and the terminology_systems registration, and deliberately no fhir.change_log row. It is
  // a whole-system include with no expansion, so the warehouse projection has nothing to lose. A
  // change_log row stamped with a lab's site_id would also be pushed to central, because the push
  // sends every change_log row (packages/db/src/projection/fetch.ts). ops.expand computes the set
  // live from the category concepts.
  await seedDb.insertInto('value_sets').values({
    id: CATEGORY_VS_ID, url: CATEGORY_VALUE_SET, version: null, name: 'test-category',
    title: CATEGORY_VS_TITLE, status: 'active', experimental: false, description: CATEGORY_VS_DESCRIPTION,
    compose: JSON.stringify(CATEGORY_COMPOSE) as never,
    immutable: false, category: null, publisher_id: PUBLISHER_ID, expanded_at: null,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

  const resource = valueSetToFhirResource({
    id: CATEGORY_VS_ID, url: CATEGORY_VALUE_SET, status: 'active', experimental: false, version: null,
    name: 'test-category', title: CATEGORY_VS_TITLE, description: CATEGORY_VS_DESCRIPTION, compose: CATEGORY_COMPOSE,
  });
  await seedDb.insertInto('fhir.fhir_resources').values({
    id: CATEGORY_VS_ID, resource_type: 'ValueSet', resource: JSON.stringify(resource),
  } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();

  await seedDb.insertInto('terminology_systems').values({
    url: CATEGORY_VALUE_SET, version: null, kind: 'ValueSet', resource_id: CATEGORY_VS_ID,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await seedDb.deleteFrom('terminology_systems').where('url', '=', CATEGORY_VALUE_SET).execute();
  await seedDb.deleteFrom('fhir.fhir_resources').where('resource_type', '=', 'ValueSet').where('id', '=', CATEGORY_VS_ID).execute();
  await seedDb.deleteFrom('value_sets').where('url', '=', CATEGORY_VALUE_SET).execute();
  // This migration created the category system outright, so its concepts go with it. Catalog tests
  // are operator data written after this migration ran, so they stay.
  await seedDb.deleteFrom('terminology_concepts').where('system', '=', CATEGORY_SYSTEM).execute();
  await seedDb.deleteFrom('coding_systems').where('id', 'in', SYSTEMS.map((s) => s.id)).execute();
  await seedDb.schema.dropTable('test_catalog_lab_settings').ifExists().execute();
}
```

- [ ] **Step 4: Register it**

In `packages/db/src/migrations/internal/index.ts`, after `import * as m103 from './103_lab_order_requisition_slot';` add:

```ts
import * as m104 from './104_test_catalog';
```

and after `'103_lab_order_requisition_slot': { up: m103.up, down: m103.down },` add:

```ts
  '104_test_catalog': { up: m104.up, down: m104.down },
```

In `packages/db/src/migrations/migrations.test.ts:7`, change the end of the manifest from `'103_lab_order_requisition_slot']);` to `'103_lab_order_requisition_slot', '104_test_catalog']);`.

- [ ] **Step 5: Add the table type**

In `packages/db/src/schema/internal.ts`, directly above `export interface InternalSchema {`, add:

```ts
// Test catalog S1 (migration 104): this install's own settings for a catalog test. Sync never writes it.
export interface TestCatalogLabSettingsTable {
  code: string;
  enabled: Generated<boolean>;
  // jsonb: a list of { system, code } specimen codings, or null for "use the catalog's own list".
  specimen_types: unknown | null;
  local_display: string | null;
  updated_at: Generated<Date>;
}

```

and inside `InternalSchema`, after `terminology_systems: TerminologySystemsTable;`, add:

```ts
  test_catalog_lab_settings: TestCatalogLabSettingsTable;
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd packages/db && npx vitest run src/migrations/internal/104_test_catalog.test.ts src/migrations/migrations.test.ts`

Expected: PASS, both files. If a pg-mem error names `onConflict` or `jsonb`, stop and report it; do not work around it.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/104_test_catalog.ts packages/db/src/migrations/internal/104_test_catalog.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): seed the test catalog and category systems, and the lab settings table" -m "Migration 104 adds two CE-owned code systems under the System publisher, the catalog and its categories, with Chemistry, Haematology, Microbiology, Serology and Molecular to start. The category ValueSet is written the way 069 writes its sets, with no fhir.change_log row, so no lab pushes it to central. test_catalog_lab_settings holds each install's own answer to the catalog; sync never writes it."
```

---

### Task 2: read the catalog

**Files:**
- Create: `packages/bootstrap/src/test-catalog.ts`
- Create: `packages/bootstrap/src/test-catalog.test.ts`

**Interfaces:**
- Consumes: migration 104's table and systems. `Operations` from `@openldr/terminology` (`expand(url, { count })`). `TerminologyAdminStore` from `@openldr/db`.
- Produces: `TEST_CATALOG_SYSTEM`, `TEST_CATEGORY_SYSTEM`, `TEST_CATEGORY_VALUE_SET`, `SPECIMEN_TYPE_VALUE_SET`; types `SpecimenCoding`, `CatalogTest`, `CatalogListQuery`, `CatalogListResult`, `TestCatalog`; class `TestCatalogError` with `kind: 'invalid' | 'not-found' | 'conflict' | 'central-managed'`; `parseCatalogListQuery(raw: Record<string, unknown>): { ok: true; query: CatalogListQuery } | { ok: false; error: string }`; `createTestCatalog(deps: { db; admin; ops }): TestCatalog` with `ownedHere()`, `list(query)`, `get(code)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/bootstrap/src/test-catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import {
  createFhirStore, createTerminologyStore, createTerminologyAdminStore,
  type InternalSchema, type ValueSetProjection,
} from '@openldr/db';
import { createOperations, LOINC_SYSTEM } from '@openldr/terminology';
import {
  createTestCatalog, parseCatalogListQuery, TEST_CATALOG_SYSTEM,
  type CatalogListQuery, type CatalogListResult,
} from './test-catalog';

const LOCAL = 'urn:openldr:cs:local';
// Three of the four codes the seeded specimen-type ValueSet lists (migration 014).
const BLD = { system: LOCAL, code: 'BLD' };
const UR = { system: LOCAL, code: 'UR' };
const CSF = { system: LOCAL, code: 'CSF' };

// The terminology context bootstrap builds (terminology-context.ts), over a migrated pg-mem db.
// Mirrors reexpand-value-sets.test.ts.
async function buildCatalog() {
  const db = await makeMigratedDb();
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(resource) {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url, version, kind, resourceId) {
      await store.saveSystem(url, version, kind, resourceId);
    },
    async deleteValueSetResource(url, id) {
      await fhirStore.delete('ValueSet', id);
      await db.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const admin = createTerminologyAdminStore(db, projection);
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c),
    findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q),
    getResourceByUrl: (u) => store.getResourceByUrl(u),
    translate: (q) => store.translate(q),
  });
  return { db, admin, catalog: createTestCatalog({ db, admin, ops }) };
}

async function seedTest(
  db: Kysely<InternalSchema>, code: string, display: string,
  properties: Record<string, unknown> | null, status: string | null = 'ACTIVE',
): Promise<void> {
  await db.insertInto('terminology_concepts').values({
    system: TEST_CATALOG_SYSTEM, code, display, status,
    properties: (properties === null ? null : JSON.stringify(properties)) as never,
  }).execute();
}

// What the lab's terminology drain writes after pulling central's catalog (packages/sync/src/terminology-sync.ts).
async function markCentral(db: Kysely<InternalSchema>): Promise<void> {
  await db.insertInto('terminology_systems')
    .values({ url: TEST_CATALOG_SYSTEM, version: null, kind: 'CodeSystem', resource_id: '', managed_origin: 'central' })
    .onConflict((oc) => oc.column('url').doUpdateSet({ managed_origin: 'central' }))
    .execute();
}

function q(over: Partial<CatalogListQuery> = {}): CatalogListQuery {
  return { status: 'active', limit: 25, offset: 0, ...over };
}

function codes(result: CatalogListResult): string[] {
  return result.rows.map((t) => t.code);
}

describe('parseCatalogListQuery', () => {
  it('defaults to active tests, 25 a page, from the start', () => {
    expect(parseCatalogListQuery({})).toEqual({ ok: true, query: { status: 'active', limit: 25, offset: 0 } });
  });

  it('reads every filter, trimming the search', () => {
    expect(parseCatalogListQuery({
      q: '  viral ', category: 'MOL', loinc: 'none', enabled: 'off', status: 'all', limit: '50', offset: '25',
    })).toEqual({
      ok: true,
      query: { q: 'viral', category: 'MOL', loinc: 'none', enabled: false, status: 'all', limit: 50, offset: 25 },
    });
  });

  it('refuses a value it does not know, in words the route and the CLI share', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ loinc: 'yes' }, 'loinc must be "linked" or "none"'],
      [{ enabled: 'true' }, 'enabled must be "on" or "off"'],
      [{ status: 'gone' }, 'status must be "active", "retired" or "all"'],
      [{ limit: '0' }, 'limit must be a whole number from 1 to 200'],
      [{ limit: '201' }, 'limit must be a whole number from 1 to 200'],
      [{ limit: 'abc' }, 'limit must be a whole number from 1 to 200'],
      [{ offset: '-1' }, 'offset must be a whole number, 0 or more'],
      [{ offset: '1.5' }, 'offset must be a whole number, 0 or more'],
    ];
    for (const [raw, error] of cases) expect(parseCatalogListQuery(raw)).toEqual({ ok: false, error });
  });
});

describe('test catalog: reads', () => {
  it('starts empty, and this install owns it', async () => {
    const { catalog } = await buildCatalog();
    expect(await catalog.list(q())).toEqual({ rows: [], total: 0, ownedHere: true });
  });

  it('reads a test with its properties, its LOINC link and this lab settings', async () => {
    const { db, admin, catalog } = await buildCatalog();
    await seedTest(db, 'HIVVL', 'HIV viral load', { shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR] });
    await admin.termMappings.create({
      fromSystem: TEST_CATALOG_SYSTEM, fromCode: 'HIVVL', toSystem: LOINC_SYSTEM, toCode: '25836-8',
      toDisplay: null, mapType: 'SAME-AS', isActive: true,
    });
    await db.insertInto('test_catalog_lab_settings').values({
      code: 'HIVVL', enabled: true, specimen_types: JSON.stringify([BLD]), local_display: 'Viral load',
    }).execute();

    expect(await catalog.list(q())).toEqual({
      rows: [{
        code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR],
        loinc: '25836-8', active: true, lab: { enabled: true, specimenTypes: [BLD], localDisplay: 'Viral load' },
      }],
      total: 1,
      ownedHere: true,
    });
  });

  it('ignores an inactive LOINC link', async () => {
    const { db, admin, catalog } = await buildCatalog();
    await seedTest(db, 'HIVVL', 'HIV viral load', null);
    await admin.termMappings.create({
      fromSystem: TEST_CATALOG_SYSTEM, fromCode: 'HIVVL', toSystem: LOINC_SYSTEM, toCode: '25836-8',
      toDisplay: null, mapType: 'SAME-AS', isActive: false,
    });
    expect((await catalog.get('HIVVL'))?.loinc).toBeNull();
  });

  it('hides retired tests unless asked, and counts a NULL status as active', async () => {
    const { db, catalog } = await buildCatalog();
    await seedTest(db, 'A', 'Active', null, 'ACTIVE');
    await seedTest(db, 'B', 'Retired', null, 'DEPRECATED');
    await seedTest(db, 'N', 'Loader-written', null, null);
    expect(codes(await catalog.list(q()))).toEqual(['A', 'N']);
    expect(codes(await catalog.list(q({ status: 'retired' })))).toEqual(['B']);
    expect(codes(await catalog.list(q({ status: 'all' })))).toEqual(['A', 'B', 'N']);
  });

  it('filters by category, LOINC link and switch, and searches code, name, short name and local name', async () => {
    const { db, admin, catalog } = await buildCatalog();
    await seedTest(db, 'A1', 'Glucose', { category: 'CHEM' });
    await seedTest(db, 'B2', 'Malaria smear', { category: 'MICRO' });
    await seedTest(db, 'C3', 'Syphilis screen', { category: 'SERO', shortName: 'RPR' });
    await admin.termMappings.create({
      fromSystem: TEST_CATALOG_SYSTEM, fromCode: 'A1', toSystem: LOINC_SYSTEM, toCode: '2345-7',
      toDisplay: null, mapType: 'SAME-AS', isActive: true,
    });
    await db.insertInto('test_catalog_lab_settings').values({ code: 'B2', enabled: true, local_display: 'Blood film' }).execute();

    expect(codes(await catalog.list(q({ category: 'CHEM' })))).toEqual(['A1']);
    expect(codes(await catalog.list(q({ loinc: 'linked' })))).toEqual(['A1']);
    expect(codes(await catalog.list(q({ loinc: 'none' })))).toEqual(['B2', 'C3']);
    expect(codes(await catalog.list(q({ enabled: true })))).toEqual(['B2']);
    expect(codes(await catalog.list(q({ enabled: false })))).toEqual(['A1', 'C3']);
    expect(codes(await catalog.list(q({ q: 'film' })))).toEqual(['B2']);
    expect(codes(await catalog.list(q({ q: 'rpr' })))).toEqual(['C3']);
    expect(codes(await catalog.list(q({ q: 'a1' })))).toEqual(['A1']);
    expect(codes(await catalog.list(q({ q: 'GLU' })))).toEqual(['A1']);
  });

  it('pages, and the total counts every match', async () => {
    const { db, catalog } = await buildCatalog();
    for (const c of ['T1', 'T2', 'T3']) await seedTest(db, c, c, null);
    const first = await catalog.list(q({ limit: 2 }));
    expect([codes(first), first.total]).toEqual([['T1', 'T2'], 3]);
    const second = await catalog.list(q({ limit: 2, offset: 2 }));
    expect([codes(second), second.total]).toEqual([['T3'], 3]);
  });

  it('says this install does not own the catalog once it came from central', async () => {
    const { db, catalog } = await buildCatalog();
    await markCentral(db);
    expect((await catalog.list(q())).ownedHere).toBe(false);
    expect(await catalog.ownedHere()).toBe(false);
  });

  it('gets one test by code, or null', async () => {
    const { db, catalog } = await buildCatalog();
    await seedTest(db, 'HIVVL', 'HIV viral load', null);
    expect((await catalog.get('HIVVL'))?.display).toBe('HIV viral load');
    expect(await catalog.get('NOPE')).toBeNull();
  });
});
```

`CSF` is unused until Task 4. Leave it; Task 4 uses it.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts`

Expected: FAIL. The module `./test-catalog` does not exist.

- [ ] **Step 3: Write the reads**

Create `packages/bootstrap/src/test-catalog.ts`:

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema, TerminologyAdminStore } from '@openldr/db';
import { LOINC_SYSTEM, type Operations } from '@openldr/terminology';

// The national test catalog, slice S1 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.2).
// The route and the `openldr test-catalog` CLI both call this module, so they share every rule
// (AGENTS.md section 6).
//
// The catalog is a CE-owned code system. Each test is a concept: code, display, status, and the
// properties shortName, category and specimenTypes. Its LOINC code is a term mapping, not a property.
// This install's own settings for a test live in test_catalog_lab_settings, which sync never writes.

/** Must equal CATALOG_SYSTEM in migration 104. */
export const TEST_CATALOG_SYSTEM = 'urn:openldr:codesystem:test-catalog';
/** Must equal CATEGORY_SYSTEM in migration 104. */
export const TEST_CATEGORY_SYSTEM = 'urn:openldr:codesystem:test-category';
/** A test's category must be a code in this ValueSet. Must equal CATEGORY_VALUE_SET in migration 104. */
export const TEST_CATEGORY_VALUE_SET = 'urn:openldr:valueset:test-category';
/** A test's specimens must come from the list the Lab order's specimen picker offers
 *  (packages/forms/src/samples/forms.ts), or narrowing at data entry could never match. */
export const SPECIMEN_TYPE_VALUE_SET = 'urn:openldr:valueset:specimen-type';

/** The map type of a test's LOINC link. concept_map_elements stores it as the equivalence. */
const LOINC_MAP_TYPE = 'SAME-AS' as const;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export interface SpecimenCoding {
  system: string;
  code: string;
}

export interface CatalogTest {
  code: string;
  display: string;
  shortName: string | null;
  category: string | null;
  specimenTypes: SpecimenCoding[];
  loinc: string | null;
  /** false when the test is retired. */
  active: boolean;
  /** This install's own settings. specimenTypes null means "use the catalog's list". */
  lab: { enabled: boolean; specimenTypes: SpecimenCoding[] | null; localDisplay: string | null };
}

export interface CatalogListQuery {
  q?: string;
  category?: string;
  loinc?: 'linked' | 'none';
  enabled?: boolean;
  status: 'active' | 'retired' | 'all';
  limit: number;
  offset: number;
}

export interface CatalogListResult {
  rows: CatalogTest[];
  total: number;
  /** false when this install received its catalog from central and may not change its tests. */
  ownedHere: boolean;
}

export class TestCatalogError extends Error {
  constructor(message: string, public readonly kind: 'invalid' | 'not-found' | 'conflict' | 'central-managed') {
    super(message);
    this.name = 'TestCatalogError';
  }
}

export interface TestCatalog {
  ownedHere(): Promise<boolean>;
  list(query: CatalogListQuery): Promise<CatalogListResult>;
  get(code: string): Promise<CatalogTest | null>;
}

export interface TestCatalogDeps {
  db: Kysely<InternalSchema>;
  admin: TerminologyAdminStore;
  ops: Operations;
}

/**
 * Read list filters from a query string or from CLI flags. GET /api/test-catalog and
 * `openldr test-catalog list` both call this, so a bad value is refused in the same words at either door.
 */
export function parseCatalogListQuery(raw: Record<string, unknown>): { ok: true; query: CatalogListQuery } | { ok: false; error: string } {
  const str = (key: string): string | undefined => {
    const v = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const loinc = str('loinc');
  if (loinc !== undefined && loinc !== 'linked' && loinc !== 'none') return { ok: false, error: 'loinc must be "linked" or "none"' };
  const enabled = str('enabled');
  if (enabled !== undefined && enabled !== 'on' && enabled !== 'off') return { ok: false, error: 'enabled must be "on" or "off"' };
  const status = str('status') ?? 'active';
  if (status !== 'active' && status !== 'retired' && status !== 'all') return { ok: false, error: 'status must be "active", "retired" or "all"' };
  const limitText = str('limit');
  const limit = limitText === undefined ? DEFAULT_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetText = str('offset');
  const offset = offsetText === undefined ? 0 : Number(offsetText);
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'offset must be a whole number, 0 or more' };

  const query: CatalogListQuery = { status, limit, offset };
  const text = str('q');
  if (text !== undefined) query.q = text;
  const category = str('category');
  if (category !== undefined) query.category = category;
  if (loinc !== undefined) query.loinc = loinc;
  if (enabled !== undefined) query.enabled = enabled === 'on';
  return { ok: true, query };
}

type ConceptRow = { code: string; display: string | null; status: string | null; properties: unknown };
type LabRow = { code: string; enabled: boolean; specimen_types: unknown; local_display: string | null };

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function toCodings(value: unknown): SpecimenCoding[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((c) => !!c && typeof c === 'object' && typeof c.system === 'string' && typeof c.code === 'string')
    .map((c: SpecimenCoding) => ({ system: c.system, code: c.code }));
}

function toTest(c: ConceptRow, loinc: string | null, lab: LabRow | undefined): CatalogTest {
  const p = (parseJson(c.properties) ?? {}) as Record<string, unknown>;
  return {
    code: c.code,
    display: c.display ?? c.code,
    shortName: typeof p.shortName === 'string' ? p.shortName : null,
    category: typeof p.category === 'string' ? p.category : null,
    specimenTypes: toCodings(p.specimenTypes),
    loinc,
    // NULL counts as ACTIVE, as it does everywhere else in terminology. DEPRECATED is how this
    // catalog stores a retired test; a DRAFT or DISABLED concept made on the Terminology page also
    // reads as not active.
    active: c.status === 'ACTIVE' || c.status === null,
    lab: {
      enabled: lab?.enabled ?? false,
      specimenTypes: lab && lab.specimen_types !== null ? toCodings(lab.specimen_types) : null,
      localDisplay: lab?.local_display ?? null,
    },
  };
}

export function createTestCatalog(deps: TestCatalogDeps): TestCatalog {
  const { db } = deps;

  async function ownedHere(): Promise<boolean> {
    // A lab that has pulled central's catalog has this row stamped 'central' by its terminology drain
    // (packages/sync/src/terminology-sync.ts). Central, a standalone lab and a lab that never pulled
    // own their catalog.
    const row = await db.selectFrom('terminology_systems').select('managed_origin')
      .where('url', '=', TEST_CATALOG_SYSTEM).executeTakeFirst();
    return row?.managed_origin !== 'central';
  }

  async function readTests(code?: string): Promise<CatalogTest[]> {
    let concepts = db.selectFrom('terminology_concepts')
      .select(['code', 'display', 'status', 'properties'])
      .where('system', '=', TEST_CATALOG_SYSTEM);
    let links = db.selectFrom('term_mappings').select(['from_code', 'to_code'])
      .where('from_system', '=', TEST_CATALOG_SYSTEM)
      .where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', LOINC_MAP_TYPE)
      .where('is_active', '=', true);
    let labs = db.selectFrom('test_catalog_lab_settings').select(['code', 'enabled', 'specimen_types', 'local_display']);
    if (code !== undefined) {
      concepts = concepts.where('code', '=', code);
      links = links.where('from_code', '=', code);
      labs = labs.where('code', '=', code);
    }
    // Codes are unique within the system, so ordering by code alone gives a stable page (AGENTS.md section 7).
    const rows = await concepts.orderBy('code').execute();
    const loincByCode = new Map((await links.execute()).map((l) => [l.from_code, l.to_code]));
    const labByCode = new Map((await labs.execute()).map((l) => [l.code, l as LabRow]));
    return rows.map((r) => toTest(r, loincByCode.get(r.code) ?? null, labByCode.get(r.code)));
  }

  async function list(query: CatalogListQuery): Promise<CatalogListResult> {
    // The catalog is capped at a few thousand tests (spec 4.4), so it is read whole and filtered
    // here. The search spans four fields, one of them from the lab settings table.
    const needle = query.q?.toLowerCase();
    const matched = (await readTests()).filter((t) => {
      if (query.status === 'active' && !t.active) return false;
      if (query.status === 'retired' && t.active) return false;
      if (query.category !== undefined && t.category !== query.category) return false;
      if (query.loinc === 'linked' && t.loinc === null) return false;
      if (query.loinc === 'none' && t.loinc !== null) return false;
      if (query.enabled !== undefined && t.lab.enabled !== query.enabled) return false;
      if (needle) {
        const text = [t.code, t.display, t.shortName ?? '', t.lab.localDisplay ?? ''].join('\n').toLowerCase();
        if (!text.includes(needle)) return false;
      }
      return true;
    });
    return {
      rows: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
      ownedHere: await ownedHere(),
    };
  }

  async function get(code: string): Promise<CatalogTest | null> {
    return (await readTests(code))[0] ?? null;
  }

  return {
    ownedHere,
    list,
    get,
  };
}
```

`deps.admin` and `deps.ops` stay unused until Task 3. TypeScript does not flag an unused property, so leave them on `deps` as written.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts`

Expected: PASS, every test in both `describe` blocks.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts
git commit -m "feat(bootstrap): read the test catalog with each lab's own settings" -m "createTestCatalog lists the catalog's tests with their short name, category, specimen types, LOINC link and this install's switch, narrowed specimens and local name. Retired tests are hidden unless asked for. parseCatalogListQuery reads the filters so the API and the CLI refuse a bad value in the same words. ownedHere is false once the catalog came from central."
```

---

### Task 3: add and edit tests

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts`
- Modify: `packages/bootstrap/src/test-catalog.test.ts`

**Interfaces:**
- Consumes: Task 2's module. `markTerminologyChanged(db, systemUrl)` from `@openldr/db`. `admin.termMappings.listOutgoing`, `saveExclusive`, `update` (`TermMapping`, `TermMappingInput` from `@openldr/db`).
- Produces: type `CatalogTestInput`; `TestCatalog.create(input)` and `TestCatalog.update(code, input)`, both `Promise<CatalogTest>`. Module helpers `clean`, `codingKey`, `uniqueCodings` that Task 4 reuses.

- [ ] **Step 1: Write the failing tests**

In `packages/bootstrap/src/test-catalog.test.ts`, change the import from `./test-catalog` to:

```ts
import {
  createTestCatalog, parseCatalogListQuery, TEST_CATALOG_SYSTEM,
  type CatalogListQuery, type CatalogListResult, type CatalogTestInput,
} from './test-catalog';
```

Add this helper below `codes`:

```ts
async function storedConcept(db: Kysely<InternalSchema>, code: string): Promise<{ status: string | null; properties: unknown }> {
  const row = await db.selectFrom('terminology_concepts').select(['status', 'properties'])
    .where('system', '=', TEST_CATALOG_SYSTEM).where('code', '=', code).executeTakeFirstOrThrow();
  return { status: row.status, properties: typeof row.properties === 'string' ? JSON.parse(row.properties) : row.properties };
}
```

Append this block at the end of the file:

```ts
describe('test catalog: writes', () => {
  it('creates a test with its properties and LOINC link', async () => {
    const { db, catalog } = await buildCatalog();
    const created = await catalog.create({
      code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
      specimenTypes: [BLD, UR, BLD], loinc: '25836-8',
    });
    expect(created).toEqual({
      code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR],
      loinc: '25836-8', active: true, lab: { enabled: false, specimenTypes: null, localDisplay: null },
    });
    expect(await storedConcept(db, 'HIVVL')).toEqual({
      status: 'ACTIVE', properties: { shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR] },
    });
  });

  it('gives a test with no national code its LOINC code', async () => {
    const { catalog } = await buildCatalog();
    expect((await catalog.create({ display: 'HIV viral load', loinc: '25836-8' })).code).toBe('25836-8');
  });

  it('refuses a test it cannot store, and says why', async () => {
    const { catalog } = await buildCatalog();
    const cases: Array<[CatalogTestInput, string]> = [
      [{ code: 'X', display: '  ' }, 'A test needs a name.'],
      [{ display: 'No codes' }, 'A test needs a national code or a LOINC code.'],
      [{ code: 'X', display: 'X', loinc: 'ABC' }, '"ABC" is not a LOINC code. LOINC codes look like 12345-6.'],
      [{ code: 'X', display: 'X', category: 'NOPE' }, 'Category NOPE is not in the test category list.'],
      [
        { code: 'X', display: 'X', specimenTypes: [{ system: LOCAL, code: 'XYZ' }] },
        'Specimen XYZ (urn:openldr:cs:local) is not in the specimen type list.',
      ],
    ];
    for (const [input, message] of cases) {
      await expect(catalog.create(input)).rejects.toMatchObject({ kind: 'invalid', message });
    }
  });

  it('refuses a code already in the catalog', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await expect(catalog.create({ code: 'HIVVL', display: 'Again' }))
      .rejects.toMatchObject({ kind: 'conflict', message: 'Test HIVVL is already in the catalog.' });
  });

  it('checks a LOINC code against LOINC when LOINC is loaded', async () => {
    const { db, catalog } = await buildCatalog();
    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    await expect(catalog.create({ code: 'VL', display: 'Viral load', loinc: '25836-8' }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'LOINC code 25836-8 is not in the LOINC loaded on this install.' });
    expect((await catalog.create({ code: 'GLU', display: 'Glucose', loinc: '2345-7' })).loinc).toBe('2345-7');
  });

  it('does not count the DRAFT stubs earlier links leave as a loaded LOINC', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'A', display: 'A', loinc: '25836-8' });
    const stub = await db.selectFrom('terminology_concepts').select('status')
      .where('system', '=', LOINC_SYSTEM).where('code', '=', '25836-8').executeTakeFirstOrThrow();
    expect(stub.status).toBe('DRAFT');
    expect((await catalog.create({ code: 'B', display: 'B', loinc: '11111-1' })).loinc).toBe('11111-1');
  });

  it('edits the whole test, keeps keys it does not manage, and keeps the code', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD] });
    // A key set elsewhere, such as `meta` from the Terminology page's Metadata field.
    await db.updateTable('terminology_concepts')
      .set({ properties: JSON.stringify({ shortName: 'VL', category: 'MOL', specimenTypes: [BLD], meta: { owner: 'lab' } }) as never })
      .where('system', '=', TEST_CATALOG_SYSTEM).where('code', '=', 'HIVVL').execute();

    const updated = await catalog.update('HIVVL', { display: 'HIV-1 viral load', category: null, specimenTypes: [] });
    expect(updated).toMatchObject({ code: 'HIVVL', display: 'HIV-1 viral load', shortName: null, category: null, specimenTypes: [] });
    expect((await storedConcept(db, 'HIVVL')).properties).toEqual({ meta: { owner: 'lab' } });

    await expect(catalog.update('HIVVL', { code: 'OTHER', display: 'x' }))
      .rejects.toMatchObject({ kind: 'invalid', message: "A test's code cannot change once saved (HIVVL)." });
    await expect(catalog.update('NOPE', { display: 'x' }))
      .rejects.toMatchObject({ kind: 'not-found', message: 'Test NOPE is not in the catalog.' });
  });

  it('relinks and unlinks LOINC, keeping one active link', async () => {
    const { admin, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
    const active = async () => (await admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, 'HIVVL'))
      .filter((m) => m.isActive).map((m) => m.toCode);

    expect((await catalog.update('HIVVL', { display: 'HIV viral load', loinc: '20447-9' })).loinc).toBe('20447-9');
    expect(await active()).toEqual(['20447-9']);

    expect((await catalog.update('HIVVL', { display: 'HIV viral load', loinc: null })).loinc).toBeNull();
    expect(await active()).toEqual([]);
  });

  it('retires a test as DEPRECATED, and restores it', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    expect((await catalog.update('HIVVL', { display: 'HIV viral load', active: false })).active).toBe(false);
    expect((await storedConcept(db, 'HIVVL')).status).toBe('DEPRECATED');
    expect(codes(await catalog.list(q()))).toEqual([]);
    expect((await catalog.update('HIVVL', { display: 'HIV viral load', active: true })).active).toBe(true);
    expect(codes(await catalog.list(q()))).toEqual(['HIVVL']);
  });

  it('refuses to add or edit tests once the catalog came from central', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await markCentral(db);
    await expect(catalog.create({ code: 'CD4', display: 'CD4 count' })).rejects.toMatchObject({ kind: 'central-managed' });
    await expect(catalog.update('HIVVL', { display: 'Changed' })).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('signals every edit so labs pull it', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await catalog.update('HIVVL', { display: 'HIV-1 viral load' });
    const sys = await db.selectFrom('terminology_systems').select('generation')
      .where('url', '=', TEST_CATALOG_SYSTEM).executeTakeFirstOrThrow();
    expect(Number(sys.generation)).toBe(2);
    const logged = await db.selectFrom('reference_change_log').select('op')
      .where('entity_type', '=', 'terminology_system').where('entity_id', '=', TEST_CATALOG_SYSTEM).execute();
    expect(logged).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts`

Expected: the typecheck inside vitest does not block, so the new tests FAIL with `catalog.create is not a function`. Task 2's tests still PASS.

- [ ] **Step 3: Add the module helpers**

In `packages/bootstrap/src/test-catalog.ts`, change the imports at the top to:

```ts
import type { Kysely } from 'kysely';
import { markTerminologyChanged, type InternalSchema, type TerminologyAdminStore } from '@openldr/db';
import { LOINC_SYSTEM, type Operations } from '@openldr/terminology';
```

Below `const MAX_LIMIT = 200;` add:

```ts
/** Terminology's statuses are ACTIVE, DRAFT, DEPRECATED and DISABLED, and the Terminology page accepts
 *  nothing else (apps/server/src/terminology-admin-routes.ts), so a retired test is stored as DEPRECATED. */
const RETIRED_STATUS = 'DEPRECATED';
const LOINC_CODE = /^\d{1,7}-\d$/;
```

Below the `CatalogListResult` interface add:

```ts
/** A whole test, as the edit sheet sends it. A field left out is cleared. */
export interface CatalogTestInput {
  /** The national code. Optional on create, where a test with none takes its LOINC code. Fixed once saved. */
  code?: string | null;
  display: string;
  shortName?: string | null;
  category?: string | null;
  specimenTypes?: SpecimenCoding[];
  loinc?: string | null;
  /** false retires the test. Retiring is reversible. Defaults to true. */
  active?: boolean;
}
```

Change the `TestCatalog` interface to:

```ts
export interface TestCatalog {
  ownedHere(): Promise<boolean>;
  list(query: CatalogListQuery): Promise<CatalogListResult>;
  get(code: string): Promise<CatalogTest | null>;
  create(input: CatalogTestInput): Promise<CatalogTest>;
  update(code: string, input: CatalogTestInput): Promise<CatalogTest>;
}
```

Below the `toTest` function (module level) add:

```ts
type ValidTest = {
  display: string;
  shortName: string | null;
  category: string | null;
  specimenTypes: SpecimenCoding[];
  loinc: string | null;
  active: boolean;
};

function clean(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function codingKey(c: SpecimenCoding): string {
  return `${c.system}|${c.code}`;
}

/** Drop repeats, keeping the first of each, in the order given. */
function uniqueCodings(list: SpecimenCoding[]): SpecimenCoding[] {
  const seen = new Set<string>();
  const out: SpecimenCoding[] = [];
  for (const c of list) {
    const key = codingKey(c);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ system: c.system, code: c.code });
    }
  }
  return out;
}
```

- [ ] **Step 4: Add the writes**

In `createTestCatalog`, directly above `  return {`, add:

```ts
  function invalid(message: string): TestCatalogError {
    return new TestCatalogError(message, 'invalid');
  }

  function notFound(code: string): TestCatalogError {
    return new TestCatalogError(`Test ${code} is not in the catalog.`, 'not-found');
  }

  async function refuseUnlessOwned(): Promise<void> {
    if (!(await ownedHere())) {
      throw new TestCatalogError(
        'This catalog comes from central, so only central can change its tests. This lab can switch tests '
          + 'on or off, narrow their specimens and set a local name.',
        'central-managed',
      );
    }
  }

  async function expandCodes(url: string): Promise<SpecimenCoding[]> {
    const vs = await deps.ops.expand(url, { count: 100_000 });
    return (vs.expansion?.contains ?? []).map((c) => ({ system: c.system ?? '', code: c.code ?? '' }));
  }

  async function loincLoaded(): Promise<boolean> {
    // Linking a test to a LOINC code that is not loaded stubs a DRAFT concept (terminology-admin-store.ts,
    // termMappings.create and saveExclusive), so DRAFT rows alone do not mean LOINC is loaded.
    const row = await db.selectFrom('terminology_concepts').select('code')
      .where('system', '=', LOINC_SYSTEM)
      .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'DRAFT')]))
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async function checkLoinc(code: string): Promise<void> {
    if (!LOINC_CODE.test(code)) throw invalid(`"${code}" is not a LOINC code. LOINC codes look like 12345-6.`);
    // With no LOINC loaded, only the format can be checked.
    if (!(await loincLoaded())) return;
    const hit = await db.selectFrom('terminology_concepts').select('status')
      .where('system', '=', LOINC_SYSTEM).where('code', '=', code).executeTakeFirst();
    if (!hit || hit.status === 'DRAFT') throw invalid(`LOINC code ${code} is not in the LOINC loaded on this install.`);
  }

  async function validate(input: CatalogTestInput): Promise<ValidTest> {
    const display = clean(input.display);
    if (!display) throw invalid('A test needs a name.');
    const category = clean(input.category);
    if (category && !(await expandCodes(TEST_CATEGORY_VALUE_SET)).some((c) => c.code === category)) {
      throw invalid(`Category ${category} is not in the test category list.`);
    }
    const specimenTypes = uniqueCodings(input.specimenTypes ?? []);
    if (specimenTypes.length) {
      const offered = new Set((await expandCodes(SPECIMEN_TYPE_VALUE_SET)).map(codingKey));
      const missing = specimenTypes.find((s) => !offered.has(codingKey(s)));
      if (missing) throw invalid(`Specimen ${missing.code} (${missing.system}) is not in the specimen type list.`);
    }
    const loinc = clean(input.loinc);
    if (loinc) await checkLoinc(loinc);
    return { display, shortName: clean(input.shortName), category, specimenTypes, loinc, active: input.active ?? true };
  }

  async function storedConcept(code: string): Promise<{ properties: unknown } | undefined> {
    return db.selectFrom('terminology_concepts').select('properties')
      .where('system', '=', TEST_CATALOG_SYSTEM).where('code', '=', code).executeTakeFirst();
  }

  async function writeConcept(code: string, t: ValidTest, stored: unknown): Promise<void> {
    // Keep every key this catalog does not manage, as terms.update does since test catalog S0.
    const parsed = parseJson(stored);
    const next: Record<string, unknown> = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
    delete next.shortName;
    delete next.category;
    delete next.specimenTypes;
    if (t.shortName) next.shortName = t.shortName;
    if (t.category) next.category = t.category;
    if (t.specimenTypes.length) next.specimenTypes = t.specimenTypes;
    const properties = Object.keys(next).length ? JSON.stringify(next) : null;
    await db.insertInto('terminology_concepts').values({
      system: TEST_CATALOG_SYSTEM, code, display: t.display,
      status: t.active ? 'ACTIVE' : RETIRED_STATUS,
      properties: properties as never,
    }).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
      display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
    }))).execute();
    // One terminology_system signal per edit, as terms.create does, so labs pull the change.
    await markTerminologyChanged(db, TEST_CATALOG_SYSTEM);
  }

  async function writeLoincLink(code: string, loinc: string | null): Promise<void> {
    const current = (await deps.admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, code))
      .find((m) => m.toSystem === LOINC_SYSTEM && m.mapType === LOINC_MAP_TYPE && m.isActive);
    if (loinc && current?.toCode !== loinc) {
      // saveExclusive keeps one active LOINC link per test and deactivates the old one.
      await deps.admin.termMappings.saveExclusive({
        fromSystem: TEST_CATALOG_SYSTEM, fromCode: code, toSystem: LOINC_SYSTEM, toCode: loinc,
        toDisplay: null, mapType: LOINC_MAP_TYPE, isActive: true,
      });
    } else if (!loinc && current) {
      const { id, ...rest } = current;
      await deps.admin.termMappings.update(id, { ...rest, isActive: false });
    }
  }

  async function saved(code: string): Promise<CatalogTest> {
    const test = await get(code);
    if (!test) throw notFound(code);
    return test;
  }

  async function create(input: CatalogTestInput): Promise<CatalogTest> {
    await refuseUnlessOwned();
    const t = await validate(input);
    const code = clean(input.code) ?? t.loinc;
    if (!code) throw invalid('A test needs a national code or a LOINC code.');
    if (await storedConcept(code)) throw new TestCatalogError(`Test ${code} is already in the catalog.`, 'conflict');
    // Two writes, not one transaction: the admin store opens its own. A failed link leaves the test
    // saved without it, and saving again links it.
    await writeConcept(code, t, null);
    await writeLoincLink(code, t.loinc);
    return saved(code);
  }

  async function update(code: string, input: CatalogTestInput): Promise<CatalogTest> {
    await refuseUnlessOwned();
    const stored = await storedConcept(code);
    if (!stored) throw notFound(code);
    const given = clean(input.code);
    if (given && given !== code) throw invalid(`A test's code cannot change once saved (${code}).`);
    const t = await validate(input);
    await writeConcept(code, t, stored.properties);
    await writeLoincLink(code, t.loinc);
    return saved(code);
  }

```

Change the returned object to:

```ts
  return {
    ownedHere,
    list,
    get,
    create,
    update,
  };
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts`

Expected: every test PASSES. If the specimen refusal case fails because the specimen-type ValueSet cannot be loaded (`ValueSet not found: urn:openldr:valueset:specimen-type`), stop and report: it means pg-mem lacks the row migration 014 seeds, and the plan's assumption is wrong.

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s1-t3-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`. If not, read the file and fix only errors in `test-catalog.ts` and `test-catalog.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts
git commit -m "feat(bootstrap): add and edit catalog tests with their category, specimens and LOINC link" -m "create and update check the category against the test category ValueSet, each specimen against the specimen-type ValueSet the Lab order picker offers, and the LOINC code's format, and its presence when LOINC is loaded. A test with no national code takes its LOINC code, and a code never changes. A retired test is stored as DEPRECATED. Each edit keeps keys the catalog does not manage and signals labs to pull. Only an install that owns its catalog may change it."
```

---

### Task 4: this lab's settings, and a pull from central

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts`
- Modify: `packages/bootstrap/src/test-catalog.test.ts`

**Interfaces:**
- Consumes: Task 3's `clean`, `codingKey`, `uniqueCodings`, `notFound`, `invalid`, `saved`. `createTerminologyBulkSync` from `@openldr/sync` (test only).
- Produces: type `LabSettingsInput`; `TestCatalog.setLabSettings(code, input): Promise<CatalogTest>`.

- [ ] **Step 1: Write the failing tests**

In `packages/bootstrap/src/test-catalog.test.ts`, add `import { createTerminologyBulkSync } from '@openldr/sync';` below the `@openldr/terminology` import, and append:

```ts
describe('test catalog: this lab', () => {
  it('switches a test on with a local name', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
    const t = await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: '  Viral load ' });
    expect(t.lab).toEqual({ enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
  });

  it('lets a lab narrow the specimen list but never add to it', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
    expect((await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: [UR], localDisplay: null })).lab.specimenTypes)
      .toEqual([UR]);
    await expect(catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: [CSF], localDisplay: null })).rejects.toMatchObject({
      kind: 'invalid',
      message: "Specimen CSF is not on this test's catalog list. A lab can narrow the list but not add to it.",
    });
    expect((await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: null })).lab.specimenTypes)
      .toBeNull();
  });

  it('refuses settings for a test not in the catalog', async () => {
    const { catalog } = await buildCatalog();
    await expect(catalog.setLabSettings('NOPE', { enabled: true, specimenTypes: null, localDisplay: null }))
      .rejects.toMatchObject({ kind: 'not-found', message: 'Test NOPE is not in the catalog.' });
  });

  it('never signals a sync change for lab settings', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    const count = async () => (await db.selectFrom('reference_change_log').select('seq').execute()).length;
    const before = await count();
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
    expect(await count()).toBe(before);
  });

  it('keeps lab settings through a pull from central, which hands the catalog to central', async () => {
    const { db, catalog } = await buildCatalog();
    const central = [
      { code: 'CD4', display: 'CD4 count', status: 'ACTIVE', properties: null },
      { code: 'HIVVL', display: 'HIV viral load', status: 'ACTIVE', properties: { specimenTypes: [BLD, UR] } },
    ];
    const bulk = createTerminologyBulkSync({
      labDb: db,
      fetchConceptsPage: async () => ({ concepts: central, nextCode: null }),
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
      getToken: async () => 'token',
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });

    await bulk.syncSystem(TEST_CATALOG_SYSTEM, { kind: 'CodeSystem', generation: 1 });
    expect(await catalog.ownedHere()).toBe(false);
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: [BLD], localDisplay: 'Viral load' });

    await bulk.syncSystem(TEST_CATALOG_SYSTEM, { kind: 'CodeSystem', generation: 2 });
    expect((await catalog.get('HIVVL'))?.lab).toEqual({ enabled: true, specimenTypes: [BLD], localDisplay: 'Viral load' });
    expect(codes(await catalog.list(q()))).toEqual(['CD4', 'HIVVL']);
    await expect(catalog.update('HIVVL', { display: 'Changed' })).rejects.toMatchObject({ kind: 'central-managed' });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts`

Expected: the new tests FAIL with `catalog.setLabSettings is not a function`, except the pull test, which may fail at the same call. Every earlier test still PASSES.

- [ ] **Step 3: Add `setLabSettings`**

In `packages/bootstrap/src/test-catalog.ts`, change `import type { Kysely } from 'kysely';` to:

```ts
import { sql, type Kysely } from 'kysely';
```

Below the `CatalogTestInput` interface add:

```ts
export interface LabSettingsInput {
  enabled: boolean;
  /** null means "use the catalog's list". A list may only narrow it. */
  specimenTypes: SpecimenCoding[] | null;
  localDisplay: string | null;
}
```

Add `setLabSettings(code: string, input: LabSettingsInput): Promise<CatalogTest>;` as the last member of the `TestCatalog` interface.

In `createTestCatalog`, directly above `  return {`, add:

```ts
  async function setLabSettings(code: string, input: LabSettingsInput): Promise<CatalogTest> {
    // Any install may set these, a lab that receives central's catalog included. Nothing here signals
    // sync: the table is this install's own.
    const test = await get(code);
    if (!test) throw notFound(code);
    let specimenTypes: SpecimenCoding[] | null = null;
    if (input.specimenTypes !== null) {
      specimenTypes = uniqueCodings(input.specimenTypes);
      const offered = new Set(test.specimenTypes.map(codingKey));
      const extra = specimenTypes.find((s) => !offered.has(codingKey(s)));
      if (extra) throw invalid(`Specimen ${extra.code} is not on this test's catalog list. A lab can narrow the list but not add to it.`);
    }
    const values = {
      enabled: input.enabled,
      specimen_types: specimenTypes === null ? null : JSON.stringify(specimenTypes),
      local_display: clean(input.localDisplay),
      updated_at: sql<Date>`now()`,
    };
    await db.insertInto('test_catalog_lab_settings').values({ code, ...values })
      .onConflict((oc) => oc.column('code').doUpdateSet(values))
      .execute();
    return saved(code);
  }

```

Add `setLabSettings,` as the last entry of the returned object.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts`

Expected: every test PASSES.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s1-t4-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts
git commit -m "feat(bootstrap): let a lab switch catalog tests on and narrow their specimens" -m "setLabSettings stores this install's switch, a narrower specimen list and a local name in test_catalog_lab_settings. A lab can narrow a test's specimens but never add one. Nothing here signals sync. A test pulls central's catalog through the real terminology drain and shows the lab's settings survive a second pull, while the catalog's tests become central's to change."
```

---

### Task 5: the API

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (the `AppContext` interface, the context construction and return, the exports)
- Create: `apps/server/src/test-catalog-routes.ts`
- Create: `apps/server/src/test-catalog-routes.test.ts`
- Modify: `apps/server/src/app.ts:15` and `:151`

**Interfaces:**
- Consumes: `createTestCatalog`, `parseCatalogListQuery`, `TestCatalogError` and the types from Tasks 2 to 4.
- Produces: `AppContext.testCatalog: TestCatalog`. Routes:
  - `GET /api/test-catalog` (`terminology.view`): query `q`, `category`, `loinc=linked|none`, `enabled=on|off`, `status=active|retired|all`, `limit`, `offset`. 200 `{ rows: CatalogTest[], total, ownedHere }`. 400 `{ error }` on a bad filter.
  - `POST /api/test-catalog` (`terminology.manage`): body `CatalogTestInput`. 201 `CatalogTest`.
  - `PUT /api/test-catalog/:code` (`terminology.manage`): body `CatalogTestInput`. 200 `CatalogTest`.
  - `PUT /api/test-catalog/:code/lab` (`terminology.manage`): body `LabSettingsInput`. 200 `CatalogTest`.
  - A `TestCatalogError` answers `{ error, kind }`: `invalid` 400, `not-found` 404, `conflict` and `central-managed` 409. A zod failure answers 400 `{ error }`.
  - Audit actions `test_catalog.create`, `test_catalog.update`, `test_catalog.lab_settings`, entity type `test_catalog`, entity id the test code.

- [ ] **Step 1: Wire the service into the context**

In `packages/bootstrap/src/index.ts`:

After `  facilityRegistry: FacilityRegistryStore;` in the `AppContext` interface, add:

```ts
  /** The national test catalog (test catalog S1): the catalog code system, its LOINC links and this
   *  install's own settings for each test. The test catalog routes and CLI share it. */
  testCatalog: TestCatalog;
```

Directly above the comment line that starts `  // Task 6: terminology distribution ingest` (the first line after the `terminology` object closes), add:

```ts
  const testCatalog = createTestCatalog({ db: termDb, admin: termAdmin, ops: terminology.ops });

```

In the returned context object, after `    facilityRegistry,` add `    testCatalog,`. If `    facilityRegistry,` appears more than once in the file, use the occurrence followed by `    facilityJobs,`.

Add the import with the other `./` imports near the top of the file:

```ts
import { createTestCatalog, type TestCatalog } from './test-catalog';
```

After `export { importFacilities, resolveKnownNationalSystem } from './facility-import';` add:

```ts
export {
  createTestCatalog, parseCatalogListQuery, TestCatalogError,
  TEST_CATALOG_SYSTEM, TEST_CATEGORY_SYSTEM, TEST_CATEGORY_VALUE_SET, SPECIMEN_TYPE_VALUE_SET,
  type TestCatalog, type CatalogTest, type CatalogTestInput, type CatalogListQuery, type CatalogListResult,
  type LabSettingsInput, type SpecimenCoding,
} from './test-catalog';
```

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s1-t5-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 2: Write the failing route tests**

Create `apps/server/src/test-catalog-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { TestCatalogError, type AppContext, type CatalogTest } from '@openldr/bootstrap';
import { registerTestCatalogRoutes } from './test-catalog-routes';
import './auth-plugin';

const TEST: CatalogTest = {
  code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
  specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD' }], loinc: '25836-8', active: true,
  lab: { enabled: false, specimenTypes: null, localDisplay: null },
};

type Impl = (...args: any[]) => Promise<unknown>;

function fakeCtx(over: Partial<Record<'list' | 'get' | 'create' | 'update' | 'setLabSettings', Impl>> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const spy = (method: string, impl: Impl): Impl => async (...args) => {
    calls.push({ method, args });
    return impl(...args);
  };
  const testCatalog = {
    list: spy('list', over.list ?? (async () => ({ rows: [TEST], total: 1, ownedHere: true }))),
    get: spy('get', over.get ?? (async (code: string) => (code === 'HIVVL' ? TEST : null))),
    create: spy('create', over.create ?? (async () => TEST)),
    update: spy('update', over.update ?? (async () => TEST)),
    setLabSettings: spy('setLabSettings', over.setLabSettings ?? (async () => TEST)),
  };
  const ctx = {
    testCatalog,
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
  registerTestCatalogRoutes(app, ctx);
  return app;
}

describe('test catalog routes', () => {
  it('GET /api/test-catalog hands the parsed filters to the store and returns its answer as is', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog?q=viral&loinc=linked&enabled=on&limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rows: [TEST], total: 1, ownedHere: true });
    expect(calls).toEqual([
      { method: 'list', args: [{ q: 'viral', loinc: 'linked', enabled: true, status: 'active', limit: 10, offset: 0 }] },
    ]);
  });

  it('GET /api/test-catalog refuses a bad filter in the parser\'s words, before the store', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog?status=gone' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'status must be "active", "retired" or "all"' });
    expect(calls).toEqual([]);
  });

  it('reads need terminology.view and writes need terminology.manage', async () => {
    const { ctx } = fakeCtx();
    expect((await appWith(ctx, []).inject({ method: 'GET', url: '/api/test-catalog' })).statusCode).toBe(403);
    const viewer = appWith(ctx, ['terminology.view']);
    expect((await viewer.inject({ method: 'GET', url: '/api/test-catalog' })).statusCode).toBe(200);
    expect((await viewer.inject({ method: 'POST', url: '/api/test-catalog', payload: { code: 'X', display: 'X' } })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL', payload: { display: 'X' } })).statusCode).toBe(403);
    expect((await viewer.inject({
      method: 'PUT', url: '/api/test-catalog/HIVVL/lab', payload: { enabled: true, specimenTypes: null, localDisplay: null },
    })).statusCode).toBe(403);
  });

  it('POST creates a test, answers 201 with it, and audits the create', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const body = { code: 'HIVVL', display: 'HIV viral load', loinc: '25836-8', specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD' }] };
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(TEST);
    expect(calls).toEqual([{ method: 'create', args: [body] }]);
    expect(audit).toMatchObject([{ action: 'test_catalog.create', entityType: 'test_catalog', entityId: 'HIVVL', before: null, after: TEST }]);
  });

  it('POST refuses a body with no name before the store', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: { code: 'X' } });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('maps each catalog error to its status and keeps its words', async () => {
    const cases: Array<[TestCatalogError['kind'], number]> = [
      ['invalid', 400], ['not-found', 404], ['conflict', 409], ['central-managed', 409],
    ];
    for (const [kind, status] of cases) {
      const { ctx, audit } = fakeCtx({ create: async () => { throw new TestCatalogError(`refused: ${kind}`, kind); } });
      const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog', payload: { code: 'X', display: 'X' } });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ error: `refused: ${kind}`, kind });
      expect(audit).toEqual([]);
    }
  });

  it('PUT /:code updates the test the path names and audits before and after', async () => {
    const after = { ...TEST, display: 'HIV-1 viral load' };
    const { ctx, calls, audit } = fakeCtx({ update: async () => after });
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL', payload: { display: 'HIV-1 viral load' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(after);
    expect(calls).toEqual([
      { method: 'get', args: ['HIVVL'] },
      { method: 'update', args: ['HIVVL', { display: 'HIV-1 viral load' }] },
    ]);
    expect(audit).toMatchObject([{ action: 'test_catalog.update', entityType: 'test_catalog', entityId: 'HIVVL', before: TEST, after }]);
  });

  it('PUT /:code hands the store a decoded code', async () => {
    const { ctx, calls } = fakeCtx();
    await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIV%20VL', payload: { display: 'X' } });
    expect(calls.find((c) => c.method === 'update')?.args[0]).toBe('HIV VL');
  });

  it('PUT /:code/lab saves this lab\'s settings and audits them', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const body = { enabled: true, specimenTypes: null, localDisplay: 'Viral load' };
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/lab', payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(TEST);
    expect(calls).toEqual([
      { method: 'get', args: ['HIVVL'] },
      { method: 'setLabSettings', args: ['HIVVL', body] },
    ]);
    expect(audit).toMatchObject([{ action: 'test_catalog.lab_settings', entityType: 'test_catalog', entityId: 'HIVVL', before: TEST.lab, after: TEST.lab }]);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts`

Expected: FAIL. The module `./test-catalog-routes` does not exist.

- [ ] **Step 4: Write the routes**

Create `apps/server/src/test-catalog-routes.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import { parseCatalogListQuery, TestCatalogError, type AppContext } from '@openldr/bootstrap';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// Test catalog S1 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.6): terminology.view
// to read, terminology.manage to change anything, central edits and lab settings alike.
const VIEW = { preHandler: requireCapability('terminology.view') };
const MANAGE = { preHandler: requireCapability('terminology.manage') };

const coding = z.object({ system: z.string().min(1), code: z.string().min(1) });
const testInput = z.object({
  code: z.string().nullish(),
  display: z.string(),
  shortName: z.string().nullish(),
  category: z.string().nullish(),
  specimenTypes: z.array(coding).optional(),
  loinc: z.string().nullish(),
  active: z.boolean().optional(),
});
const labInput = z.object({
  enabled: z.boolean(),
  specimenTypes: z.array(coding).nullable(),
  localDisplay: z.string().nullable(),
});

// A catalog refusal keeps its words and says which kind it is. Anything else goes to the shared
// error handler.
function replyCatalogError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof TestCatalogError)) throw err;
  const status = err.kind === 'invalid' ? 400 : err.kind === 'not-found' ? 404 : 409;
  return reply.code(status).send({ error: err.message, kind: err.kind });
}

export function registerTestCatalogRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/test-catalog', VIEW, async (req, reply) => {
    const parsed = parseCatalogListQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.testCatalog.list(parsed.query));
  });

  app.post('/api/test-catalog', MANAGE, async (req, reply) => {
    const parsed = testInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const created = await ctx.testCatalog.create(parsed.data);
      await recordAudit(ctx, req, { action: 'test_catalog.create', entityType: 'test_catalog', entityId: created.code, before: null, after: created });
      return reply.code(201).send(created);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.put('/api/test-catalog/:code', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = testInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = await ctx.testCatalog.get(code);
      const updated = await ctx.testCatalog.update(code, parsed.data);
      await recordAudit(ctx, req, { action: 'test_catalog.update', entityType: 'test_catalog', entityId: code, before, after: updated });
      return reply.send(updated);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.put('/api/test-catalog/:code/lab', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = labInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = (await ctx.testCatalog.get(code))?.lab ?? null;
      const saved = await ctx.testCatalog.setLabSettings(code, parsed.data);
      await recordAudit(ctx, req, { action: 'test_catalog.lab_settings', entityType: 'test_catalog', entityId: code, before, after: saved.lab });
      return reply.send(saved);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });
}
```

In `apps/server/src/app.ts`, after `import { registerTerminologyAdminRoutes } from './terminology-admin-routes';` add:

```ts
import { registerTestCatalogRoutes } from './test-catalog-routes';
```

and after `  registerTerminologyAdminRoutes(app, ctx);` add:

```ts
  registerTestCatalogRoutes(app, ctx);
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts`

Expected: every test PASSES. If only `PUT /:code hands the store a decoded code` fails, Fastify did not decode the path parameter: stop and report, and do not add a `decodeURIComponent` until the operator decides (the terminology routes add one, `terminology-admin-routes.ts:178`, which double-decodes a `%25`).

- [ ] **Step 6: Lint and typecheck the server**

Run:

```bash
cd apps/server && npx eslint src/test-catalog-routes.ts src/test-catalog-routes.test.ts src/app.ts > "$TEMP/s1-t5-lint.txt" 2>&1; echo "lint exit=$?"
cd apps/server && npx tsc --noEmit -p . > "$TEMP/s1-t5-srv-tc.txt" 2>&1; echo "tsc exit=$?"
```

Expected: both `exit=0`. `apps/server` is the one package with real lint: it enforces `return reply.send` so gzip cannot clobber a response.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/index.ts apps/server/src/test-catalog-routes.ts apps/server/src/test-catalog-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): serve the test catalog under /api/test-catalog" -m "GET lists catalog tests with the named filters, POST adds a test, PUT /:code edits one and PUT /:code/lab saves this install's own settings for it. Reads need terminology.view and changes need terminology.manage. A catalog refusal answers 400, 404 or 409 with its own words and kind, and every change is audited as test_catalog.*."
```

---

### Task 6: `openldr test-catalog list`

**Files:**
- Create: `packages/cli/src/test-catalog.ts`
- Create: `packages/cli/src/test-catalog.test.ts`
- Create: `packages/cli/src/test-catalog-cli-parsing.test.ts`
- Modify: `packages/cli/src/program.ts` (import near `:35`; command before `const facilities = program.command('facilities')`)

**Interfaces:**
- Consumes: `createAppContext`, `parseCatalogListQuery` from `@openldr/bootstrap`; `ctx.testCatalog.list`.
- Produces: `runTestCatalogList(opts: TestCatalogListOpts): Promise<number>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/test-catalog.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAppContext: vi.fn(),
  list: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));

// Partial: parseCatalogListQuery stays real, so this test checks the same parser the route uses.
vi.mock('@openldr/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return { createAppContext: mocks.createAppContext, parseCatalogListQuery: actual.parseCatalogListQuery };
});

import { runTestCatalogList } from './test-catalog';

const TEST = {
  code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
  specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD' }], loinc: '25836-8', active: true,
  lab: { enabled: true, specimenTypes: null, localDisplay: null },
};

describe('openldr test-catalog list', () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    mocks.list.mockResolvedValue({ rows: [TEST], total: 3, ownedHere: true });
    mocks.close.mockResolvedValue(undefined);
    mocks.createAppContext.mockResolvedValue({ testCatalog: { list: mocks.list }, close: mocks.close });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.createAppContext.mockReset();
    mocks.list.mockReset();
    mocks.close.mockReset();
  });

  it('refuses a bad flag in the route\'s words, before opening a context', async () => {
    expect(await runTestCatalogList({ status: 'gone', json: false })).toBe(1);
    expect(err.join('')).toBe('test-catalog list failed: status must be "active", "retired" or "all"\n');
    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });

  it('prints one line per test and says how many it shows', async () => {
    expect(await runTestCatalogList({ search: 'viral', enabled: 'on', json: false })).toBe(0);
    expect(mocks.list).toHaveBeenCalledWith({ q: 'viral', enabled: true, status: 'active', limit: 25, offset: 0 });
    expect(out.join('')).toBe('HIVVL\tHIV viral load\tMOL\t25836-8\ton\nshowing 1 of 3\n');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('marks a retired test and one with no LOINC', async () => {
    mocks.list.mockResolvedValue({ rows: [{ ...TEST, loinc: null, active: false, lab: { ...TEST.lab, enabled: false } }], total: 1, ownedHere: true });
    await runTestCatalogList({ status: 'all', json: false });
    expect(out.join('')).toBe('HIVVL\tHIV viral load\tMOL\tNo LOINC\toff\tretired\nshowing 1 of 1\n');
  });

  it('prints the store\'s answer as JSON with --json', async () => {
    await runTestCatalogList({ json: true });
    expect(JSON.parse(out.join(''))).toEqual({ rows: [TEST], total: 3, ownedHere: true });
  });

  it('reports a store failure and still closes the context', async () => {
    mocks.list.mockRejectedValue(new Error('boom'));
    expect(await runTestCatalogList({ json: false })).toBe(1);
    expect(err.join('')).toContain('test-catalog list failed: boom');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
```

Create `packages/cli/src/test-catalog-cli-parsing.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program';

// Checks only what commander hands runTestCatalogList. The function itself is tested in
// test-catalog.test.ts. A fresh Command per test: commander keeps parsed values across parseAsync calls.
const mocks = vi.hoisted(() => ({ runTestCatalogList: vi.fn().mockResolvedValue(0) }));

vi.mock('./test-catalog', () => ({ runTestCatalogList: mocks.runTestCatalogList }));

describe('test-catalog list: commander parsing', () => {
  beforeEach(() => {
    mocks.runTestCatalogList.mockClear();
  });

  it('hands every flag to runTestCatalogList as given', async () => {
    await buildProgram().exitOverride().parseAsync([
      'node', 'openldr', 'test-catalog', 'list',
      '--search', 'viral', '--category', 'MOL', '--loinc', 'none', '--enabled', 'off',
      '--status', 'all', '--limit', '10', '--offset', '20', '--json',
    ]);
    expect(mocks.runTestCatalogList).toHaveBeenCalledWith({
      search: 'viral', category: 'MOL', loinc: 'none', enabled: 'off', status: 'all', limit: '10', offset: '20', json: true,
    });
  });

  it('defaults --json to false', async () => {
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', 'list']);
    expect(mocks.runTestCatalogList).toHaveBeenCalledWith({ json: false });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/cli && npx vitest run src/test-catalog.test.ts src/test-catalog-cli-parsing.test.ts`

Expected: FAIL. `./test-catalog` does not exist, and `test-catalog` is not a command.

- [ ] **Step 3: Write the command**

Create `packages/cli/src/test-catalog.ts`:

```ts
import { loadConfig } from '@openldr/config';
import { createAppContext, parseCatalogListQuery } from '@openldr/bootstrap';
import { redactError } from './redact-error';

export interface TestCatalogListOpts {
  search?: string;
  category?: string;
  loinc?: string;
  enabled?: string;
  status?: string;
  limit?: string;
  offset?: string;
  json: boolean;
}

/** `openldr test-catalog list`: the CLI door to GET /api/test-catalog. It uses the route's own parser,
 *  so a bad flag is refused in the same words, and it catches its own errors and returns an exit code. */
export async function runTestCatalogList(opts: TestCatalogListOpts): Promise<number> {
  const parsed = parseCatalogListQuery({
    q: opts.search, category: opts.category, loinc: opts.loinc, enabled: opts.enabled,
    status: opts.status, limit: opts.limit, offset: opts.offset,
  });
  if (!parsed.ok) {
    process.stderr.write(`test-catalog list failed: ${parsed.error}\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await ctx.testCatalog.list(parsed.query);
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      const lines = result.rows.map((t) => [
        t.code, t.display, t.category ?? '-', t.loinc ?? 'No LOINC', t.lab.enabled ? 'on' : 'off', t.active ? '' : 'retired',
      ].join('\t').trimEnd());
      process.stdout.write((lines.length ? lines.join('\n') : '(no tests)') + '\n');
      // The list is paged, so say how much of it this is, as `facilities list` does.
      process.stdout.write(`showing ${result.rows.length} of ${result.total}\n`);
    }
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`test-catalog list failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}
```

In `packages/cli/src/program.ts`, add below the `} from './facilities';` import:

```ts
import { runTestCatalogList, type TestCatalogListOpts } from './test-catalog';
```

and directly above `  const facilities = program.command('facilities').description('Facility registry (facility_registry)');` add:

```ts
  // Test catalog S1: the list door for GET /api/test-catalog. runTestCatalogList catches its own
  // errors and returns a code, like `facilities list`.
  const testCatalog = program.command('test-catalog').description('National test catalog: the tests offered and which this lab runs');
  testCatalog
    .command('list')
    .description('List catalog tests. Retired tests are hidden unless --status says otherwise.')
    .option('--search <text>', 'match code, name, short name or local name')
    .option('--category <code>', 'only tests in this category')
    .option('--loinc <linked|none>', 'only tests with, or without, a LOINC code')
    .option('--enabled <on|off>', 'only tests this lab runs, or does not run')
    .option('--status <active|retired|all>', 'which tests to include (default: active)')
    .option('--limit <n>', 'rows per page, 1 to 200 (default: 25)')
    .option('--offset <n>', 'rows to skip (default: 0)')
    .option('--json', 'emit JSON', false)
    .action(async (opts: TestCatalogListOpts) => {
      process.exitCode = await runTestCatalogList(opts);
    });

```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/cli && npx vitest run src/test-catalog.test.ts src/test-catalog-cli-parsing.test.ts`

Expected: PASS, both files.

- [ ] **Step 5: Typecheck the CLI**

Run: `cd packages/cli && npx tsc --noEmit -p . > "$TEMP/s1-t6-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/test-catalog.ts packages/cli/src/test-catalog.test.ts packages/cli/src/test-catalog-cli-parsing.test.ts packages/cli/src/program.ts
git commit -m "feat(cli): add openldr test-catalog list" -m "Lists catalog tests with their category, LOINC code and whether this lab runs them, filtered with --search, --category, --loinc, --enabled and --status, and paged with --limit and --offset. It reads flags with the API's own parser, so a bad value is refused in the same words, and --json prints the API's answer."
```

---

### Task 7: docs

**Files:**
- Modify: `apps/web/src/docs/0.1.8/cli.md` (the Command groups table, after the `facilities` row; a new section at the end of the file)
- Modify: `apps/studio/src/docs/0.1.8/en/terminology.md` (a new section directly above `## Troubleshooting`)

**Interfaces:** none.

- [ ] **Step 1: Add the command group row**

In `apps/web/src/docs/0.1.8/cli.md`, after the line that starts `` | `facilities` | ``, add:

```markdown
| `test-catalog` | The national test catalog: `list` the tests with their category, LOINC code and whether this lab runs them. |
```

- [ ] **Step 2: Add the section in three languages**

At the end of `apps/web/src/docs/0.1.8/cli.md`, add:

````markdown

## Test catalog

### English

The test catalog is the national list of tests. It is a code system on the Terminology page, **Test catalog**. Its categories are a second code system, **Test categories**, with five to start: Chemistry, Haematology, Microbiology, Serology and Molecular. Edit categories on the Terminology page.

Central keeps the catalog. A lab receives it through terminology sync and cannot change its tests. Each lab records its own settings for a test: whether it runs it, a shorter specimen list, and a local name. Sync never sends those settings.

List the catalog from the command line:

```sh
openldr test-catalog list --search viral --category MOL --loinc linked --enabled on --json
```

Retired tests are hidden unless you pass `--status retired` or `--status all`. `--loinc none` lists tests with no LOINC code. `--limit` is 25 by default and 200 at most. Page with `--offset`. The JSON holds `rows`, `total` and `ownedHere`. `ownedHere` is false when this install received its catalog from central.

### Français

Le catalogue des examens est la liste nationale des examens. C'est un système de codes de la page Terminologie, **Test catalog**. Ses catégories forment un second système de codes, **Test categories**, avec cinq catégories au départ : Chemistry, Haematology, Microbiology, Serology et Molecular. Modifiez les catégories sur la page Terminologie.

Le site central tient le catalogue. Un laboratoire le reçoit par la synchronisation de la terminologie et ne peut pas modifier ses examens. Chaque laboratoire enregistre ses propres réglages pour un examen : s'il le réalise, une liste de prélèvements plus courte et un nom local. La synchronisation n'envoie jamais ces réglages.

Depuis la ligne de commande :

```sh
openldr test-catalog list --search viral --category MOL --loinc linked --enabled on --json
```

Les examens retirés sont masqués, sauf avec `--status retired` ou `--status all`. `--loinc none` liste les examens sans code LOINC. `--limit` vaut 25 par défaut et 200 au plus. Paginez avec `--offset`. Le JSON contient `rows`, `total` et `ownedHere`. `ownedHere` vaut false quand cette installation a reçu son catalogue du site central.

### Português

O catálogo de exames é a lista nacional de exames. É um sistema de códigos na página Terminologia, **Test catalog**. As categorias formam um segundo sistema de códigos, **Test categories**, com cinco no início: Chemistry, Haematology, Microbiology, Serology e Molecular. Edite as categorias na página Terminologia.

O nível central mantém o catálogo. Um laboratório recebe-o pela sincronização da terminologia e não pode alterar os seus exames. Cada laboratório regista as suas próprias definições para um exame: se o realiza, uma lista de amostras mais curta e um nome local. A sincronização nunca envia essas definições.

Na linha de comandos:

```sh
openldr test-catalog list --search viral --category MOL --loinc linked --enabled on --json
```

Os exames retirados ficam ocultos, exceto com `--status retired` ou `--status all`. `--loinc none` lista os exames sem código LOINC. `--limit` é 25 por omissão e 200 no máximo. Pagine com `--offset`. O JSON contém `rows`, `total` e `ownedHere`. `ownedHere` é false quando esta instalação recebeu o catálogo do nível central.
````

- [ ] **Step 3: Add the studio section**

In `apps/studio/src/docs/0.1.8/en/terminology.md`, directly above `## Troubleshooting`, add:

```markdown
## Test catalog and categories

Every install has two code systems under the System publisher. **Test catalog** holds the national list of tests. **Test categories** holds the categories a test can belong to, starting with Chemistry, Haematology, Microbiology, Serology and Molecular. Add or rename categories here.

A catalog test also carries a category, specimen types and a LOINC link that this page does not show. Editing a test here keeps them. A term added here has none of them. On a lab that receives the catalog from central, central's next change replaces any edit made here.

```

- [ ] **Step 4: Check the docs tests**

Run: `cd apps/studio && npx vitest run src/docs` and `cd apps/web && npx vitest run src/docs`

Expected: PASS, both.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/docs/0.1.8/cli.md apps/studio/src/docs/0.1.8/en/terminology.md
git commit -m "docs(terminology): document the test catalog and its list command"
```

---

### Task 8: gate, and report

**Files:** none.

- [ ] **Step 1: Run the full forced gate**

From the worktree root:

```bash
pnpm turbo run typecheck --force --concurrency=4 > "$TEMP/s1-tc.txt" 2>&1; echo "typecheck exit=$?"
pnpm turbo run test --force --concurrency=4 --continue > "$TEMP/s1-test.txt" 2>&1; echo "test exit=$?"
grep -E "Tasks:|Failed:|Cached:|Test timed out" "$TEMP/s1-tc.txt" "$TEMP/s1-test.txt"
```

Expected: both exit 0, typecheck `36 successful, 36 total`, tests `35 successful, 35 total`, `0 cached` in both. A failure outside the files this plan touches is most likely a test that counts seeded coding systems or concepts. Read it, report it, and ask before changing a test outside this plan.

- [ ] **Step 2: Confirm the gate did not migrate the dev database**

```bash
docker exec openldr_ce-postgres-1 psql -U openldr -d openldr -At -c "select name from kysely_migration order by name desc limit 2;"
```

Expected: `103_lab_order_requisition_slot` on top, and no `104_test_catalog`. If 104 is there, stop and report before anything else.

- [ ] **Step 3: Re-check the migration number**

```bash
git branch -a --format='%(refname:short)' | grep -v '^origin$' | while read b; do n=$(git ls-tree --name-only "$b" packages/db/src/migrations/internal/ 2>/dev/null | sed 's#.*/##' | grep -oE "^[0-9]{3}" | sort | tail -1); echo "$b $n"; done
```

Expected: this branch `104`, every other branch `103` or lower. Also list the `peaceful-kirch` working tree's migrations, read-only.

- [ ] **Step 4: Report, and ask before merging**

Tell the operator what each layer proves:

- **Migration test (pg-mem):** 104 seeds the systems, categories, ValueSet and table, writes no change_log row for the set, keeps a system already at the catalog URL, and `down` removes what it seeded. Not boot order: that is checked on `kysely_migration` after a real boot.
- **Service tests (pg-mem):** list, filters, paging and ownership; create and update rules; lab settings narrowing; and a pull through the real terminology drain keeping lab settings and handing the catalog to central. pg-mem is not Postgres: the `jsonb` round trip, `ORDER BY code` under Postgres collation and the migration's `ON CONFLICT` targets are not proven there.
- **Route tests:** the wire shape, permissions, error mapping and audit of the four routes, over a fake service. They do not reach a database.
- **CLI tests:** flag parsing and output, over a fake context.
- **HONEST NON-PROOF:** a real boot running 104, the API on the running app, and a real central-and-lab pull. After a merge the dev API restarts under `nodemon` and runs 104 on the dev database. Then, with the operator's go-ahead: read `kysely_migration`; `GET /api/test-catalog` should answer `{ rows: [], total: 0, ownedHere: true }`; `openldr terminology expand urn:openldr:valueset:test-category` (run with `node_modules/.bin/tsx packages/cli/src/index.ts`) should list the five categories. A write check needs a scratch test, which has no delete route: remove it afterwards through the Terminology page's term delete and one `psql` delete of its `test_catalog_lab_settings` row. Ask before creating it.

Merge, changelog (`pnpm make:changelog` after merging, per AGENTS.md section 6) and push only when the operator asks.
