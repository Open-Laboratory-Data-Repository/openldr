# The facility register in the warehouse: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A custom query can read every facility register row from the warehouse table `facility_registry`.

**Architecture:** A new warehouse migration creates `facility_registry`. `publishFacilityMap`, which the `facility-map-rebuild` job already runs, deletes and rewrites it in the same transaction as `facility_map`. Bulk delete starts queuing that job too.

**Tech Stack:** TypeScript, Kysely (Postgres, SQL Server, MySQL), pg-mem and vitest for tests, Fastify routes, commander CLI.

**Spec:** `docs/superpowers/specs/2026-10-07-warehouse-facility-registry-design.md`

## Global Constraints

- Worktree: `D:/Projects/Repositories/openldr_ce/.claude/worktrees/warehouse-registry`, branch `feat/warehouse-facility-registry`. Prefix every command with `cd <worktree> &&`. Check `git branch --show-current` before each commit. Stage by exact path.
- The migration is `external/021`. Kysely needs strict numeric order; a gap blocks boot.
- Column types come only from `packages/db/src/migrations/external/dialect.ts`. An indexed column must be `keyType`, never `textType` (`indexed-columns.test.ts` enforces it).
- MSSQL bound-parameter limit: 2,100. The copy has 21 columns, so insert 90 rows per batch.
- Delete then insert, never upsert then prune.
- No em dashes in new writing. No emoji in headings or bullets. Short sentences.
- No `Co-Authored-By` trailer.
- Never read an exit code through a pipe. Redirect to a file, then `echo "exit=$?"`.
- pg-mem is Postgres only. No test here proves the SQL Server or MySQL DDL.

---

### Task 1: The warehouse table

**Files:**
- Create: `packages/db/src/migrations/external/021_facility_registry.ts`
- Create: `packages/db/src/migrations/external/021_facility_registry.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts` (import after line 22, entry after line 45)
- Modify: `packages/db/src/schema/external.ts` (new interface before `ExternalSchema`, a key in `ExternalSchema`, an entry in `EXTERNAL_TABLE_COLUMNS`)
- Modify: `packages/db/src/export-data.test.ts:4-41`

**Interfaces:**
- Produces: warehouse table `facility_registry`; type `WarehouseFacilityRegistryTable`; `ExternalSchema['facility_registry']`; `EXTERNAL_TABLE_COLUMNS.facility_registry`.

- [ ] **Step 1: Write the failing migration test**

`packages/db/src/migrations/external/021_facility_registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import * as m021 from './021_facility_registry';

describe('021_facility_registry', () => {
  it('round-trips a full register row', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into facility_registry
      (id, facility_system, facility_code, name, level, ownership, status, register_state,
       country, zone, region, district, council, ward, village, address_text, phone,
       latitude, longitude, extras, updated_at)
      values ('fac-1', 'urn:openldr:mz:facilities', 'PMC', 'HG Machava', 'H', 'public', 'active',
              'in_register', 'MZ', null, 'Maputo Provincia', 'Matola', null, null, null, null, null,
              -25.9, 32.5, '{"HFStatus":"1"}', '2026-10-07T00:00:00Z')`.execute(db);
    const rows = await sql<Record<string, unknown>>`
      select facility_system, facility_code, name, region, district, register_state, latitude, extras
      from facility_registry`.execute(db);
    expect(rows.rows).toEqual([{
      facility_system: 'urn:openldr:mz:facilities', facility_code: 'PMC', name: 'HG Machava',
      region: 'Maputo Provincia', district: 'Matola', register_state: 'in_register',
      latitude: -25.9, extras: '{"HFStatus":"1"}',
    }]);
  });

  it('allows a row with no register, as the internal table does', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into facility_registry (id, facility_code, name) values ('fac-2', 'L-1', 'Local lab')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select facility_system, updated_at is not null as stamped from facility_registry`.execute(db);
    expect(rows.rows).toEqual([{ facility_system: null, stamped: true }]);
  });

  it('down drops the table', async () => {
    const db = await makeMigratedExternalDb();
    await m021.down(db);
    await expect(sql`select count(*) from facility_registry`.execute(db)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd <worktree> && pnpm --filter @openldr/db exec vitest run src/migrations/external/021_facility_registry.test.ts > /tmp/t1.txt 2>&1; echo "exit=$?"; grep -E "Tests |Error" /tmp/t1.txt | head`
Expected: exit 1. The import of `./021_facility_registry` fails (file does not exist).

- [ ] **Step 3: Write the migration**

`packages/db/src/migrations/external/021_facility_registry.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, floatType, timestampType, nowExpr } from './dialect';

// A copy of the internal `facility_registry`: every register, every row, every register_state.
// The Query page and custom queries reach only the warehouse, so without this copy no query can
// list a register. `publishFacilityMap` deletes and rewrites it in the same transaction as
// `facility_map`. Spec: docs/superpowers/specs/2026-10-07-warehouse-facility-registry-design.md.
//
// Same name as the internal table on purpose: it is the same data, in a different database.
// `extras` is JSON text, because SQL Server and MySQL have no jsonb.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  const float = sql.raw(floatType(engine));
  let built = db.schema.createTable('facility_registry')
    .addColumn('id', key, (c) => c.primaryKey())
    // NULL for a facility in no register, as in the internal table (migration 086).
    .addColumn('facility_system', key)
    .addColumn('facility_code', key, (c) => c.notNull())
    .addColumn('name', text, (c) => c.notNull())
    .addColumn('level', text)
    .addColumn('ownership', text)
    .addColumn('status', text)
    .addColumn('register_state', text)
    .addColumn('country', text)
    .addColumn('zone', text)
    .addColumn('region', text)
    .addColumn('district', text)
    .addColumn('council', text)
    .addColumn('ward', text)
    .addColumn('village', text)
    .addColumn('address_text', text)
    .addColumn('phone', text)
    .addColumn('latitude', float)
    .addColumn('longitude', float)
    .addColumn('extras', text)
    .addColumn('updated_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  // Facility names carry diacritics, and a self-hosted MySQL may default to latin1 (see 012).
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  await built.execute();
  // Every lookup filters on the register and the code together.
  await db.schema.createIndex('facility_registry_code_idx')
    .on('facility_registry').columns(['facility_system', 'facility_code']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('facility_registry').execute();
}
```

In `packages/db/src/migrations/external/index.ts`, add after the `m020` import:

```ts
import * as m021 from './021_facility_registry';
```

and after the `'020_lab_result_comparator'` entry:

```ts
    '021_facility_registry': { up: (db) => m021.up(db, engine), down: m021.down },
```

- [ ] **Step 4: Add the schema type**

In `packages/db/src/schema/external.ts`, add before `export interface ExternalSchema`:

```ts
/** The warehouse copy of the internal facility register (migration 021). One row per internal
 *  `facility_registry` row, rewritten by `publishFacilityMap`. Named apart from the internal
 *  `FacilityRegistryTable` because the db barrel re-exports both schema modules. */
export interface WarehouseFacilityRegistryTable {
  id: string;
  facility_system: string | null;
  facility_code: string;
  name: string;
  level: string | null;
  ownership: string | null;
  status: string | null;
  register_state: string | null;
  country: string | null;
  zone: string | null;
  region: string | null;
  district: string | null;
  council: string | null;
  ward: string | null;
  village: string | null;
  address_text: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  /** The internal `extras` as JSON text. NULL when the internal value is empty. */
  extras: string | null;
  updated_at: Generated<Date>;
}
```

Add to `ExternalSchema`, after `facility_map: FacilityMapTable;`:

```ts
  facility_registry: WarehouseFacilityRegistryTable;
```

Add to `EXTERNAL_TABLE_COLUMNS`, after the `facility_map` entry:

```ts
  facility_registry: ['id', 'facility_system', 'facility_code', 'name', 'level', 'ownership', 'status', 'register_state', 'country', 'zone', 'region', 'district', 'council', 'ward', 'village', 'address_text', 'phone', 'latitude', 'longitude', 'extras', 'updated_at'],
```

- [ ] **Step 5: Update the pinned table list**

In `packages/db/src/export-data.test.ts`, add to the comment block above the first `it` (after the `lab_request_attributes` paragraph):

```ts
  // facility_registry is included deliberately: the warehouse copy of the facility register
  // (migration 021), rebuilt by publishFacilityMap. It carries no patient data. It is in no
  // query model and no Data Exposure policy, so only custom SQL reaches it.
```

Change the first test's name and expected list to:

```ts
  it('covers the 7 canonical fact tables, the terminology dimension, the facility_map dimension, the facility_registry copy, the ingest_events ledger, and the lab_request_attributes table', () => {
    expect(Object.keys(EXTERNAL_TABLE_COLUMNS).sort()).toEqual(
      ['diagnostic_reports', 'facilities', 'facility_map', 'facility_registry', 'ingest_events', 'lab_request_attributes', 'lab_requests', 'lab_results', 'patients', 'questionnaire_responses', 'specimens', 'terminology_codes'],
    );
  });
```

In the second test, before `expect(cols).toContain('id');`, add:

```ts
      // facility_registry is a copy of the internal register, not an ingest fact: it has an id but
      // no feed and no batch. Named explicitly, same reasoning as ingest_events.
      if (table === 'facility_registry') { expect(cols).toContain('id'); continue; }
```

- [ ] **Step 6: Run the db tests**

Run: `cd <worktree> && pnpm --filter @openldr/db exec vitest run src/migrations/external src/export-data.test.ts > /tmp/t1.txt 2>&1; echo "exit=$?"; grep -E "Tests |FAIL" /tmp/t1.txt | head`
Expected: exit 0. The three new tests pass. `indexed-columns.test.ts` passes, since both indexed columns are `keyType`.

- [ ] **Step 7: Commit**

```bash
cd <worktree> && git branch --show-current && git add packages/db/src/migrations/external/021_facility_registry.ts packages/db/src/migrations/external/021_facility_registry.test.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts packages/db/src/export-data.test.ts && git commit -m "feat(db): a warehouse copy of the facility register"
```

---

### Task 2: `publishFacilityMap` rewrites the copy

**Files:**
- Modify: `packages/bootstrap/src/facility-reconcile.ts` (`PublishResult` at :821-835, `publishFacilityMap` at :848-933)
- Modify: `packages/bootstrap/src/facility-reconcile.test.ts` (new `describe` at the end of the file)
- Modify: `packages/bootstrap/src/facility-job-runners.test.ts:9-11`

**Interfaces:**
- Consumes: `ExternalSchema['facility_registry']` from Task 1.
- Produces: `PublishResult.registryRows: number`, the number of register rows copied (or, on a dry run, the number that would be).

- [ ] **Step 1: Write the failing tests**

Append to `packages/bootstrap/src/facility-reconcile.test.ts`. Add `FACILITY_REGISTER_STATE_DROPPED` to the existing `@openldr/db` import on line 2, and add `import { sql } from 'kysely';` if the file has no `sql` import.

```ts
// Spec 2026-10-07-warehouse-facility-registry: the warehouse holds a copy of every register row,
// so a custom query can list a register with no results present.
describe('publishFacilityMap copies the register into the warehouse', () => {
  async function seedTwoRegisters(deps: Awaited<ReturnType<typeof makeReconcileDeps>>) {
    await seedRegistry(deps, { id: 'fac-1', name: 'HG Machava', nationalCode: 'PMC', nationalSystem: 'urn:test:facilities', region: 'Maputo Provincia', district: 'Matola' });
    await seedRegistry(deps, { id: 'fac-2', name: 'Old clinic', nationalCode: 'OLD', nationalSystem: 'urn:test:facilities' });
    await seedRegistry(deps, { id: 'lab-1', name: 'HG Machava lab', nationalCode: 'PMC', nationalSystem: 'urn:test:labs' });
    await deps.internalDb.updateTable('facility_registry')
      .set({ register_state: FACILITY_REGISTER_STATE_DROPPED, extras: sql`cast(${JSON.stringify({ HFStatus: '0' })} as jsonb)` } as never)
      .where('id', '=', 'fac-2').execute();
  }

  it('copies every row of every register, a dropped one included', async () => {
    const deps = await makeReconcileDeps();
    await seedTwoRegisters(deps);

    const result = await publishFacilityMap(deps, { apply: true });

    expect(result.registryRows).toBe(3);
    const rows = await deps.externalDb.selectFrom('facility_registry').selectAll().orderBy('id').execute();
    expect(rows.map((r) => [r.id, r.facility_system, r.facility_code, r.name])).toEqual([
      ['fac-1', 'urn:test:facilities', 'PMC', 'HG Machava'],
      ['fac-2', 'urn:test:facilities', 'OLD', 'Old clinic'],
      ['lab-1', 'urn:test:labs', 'PMC', 'HG Machava lab'],
    ]);
    expect(rows[0]).toMatchObject({ region: 'Maputo Provincia', district: 'Matola', extras: null });
    expect(rows[1].register_state).toBe(FACILITY_REGISTER_STATE_DROPPED);
    expect(JSON.parse(rows[1].extras!)).toEqual({ HFStatus: '0' });
    // Every register_state comes across exactly as the internal row holds it.
    const internal = await deps.internalDb.selectFrom('facility_registry').select(['id', 'register_state']).orderBy('id').execute();
    expect(rows.map((r) => r.register_state)).toEqual(internal.map((r) => r.register_state));
  });

  it('drops a row deleted from the register on the next apply', async () => {
    const deps = await makeReconcileDeps();
    await seedTwoRegisters(deps);
    await publishFacilityMap(deps, { apply: true });
    await deps.internalDb.deleteFrom('facility_registry').where('id', '=', 'lab-1').execute();

    const result = await publishFacilityMap(deps, { apply: true });

    expect(result.registryRows).toBe(2);
    const ids = (await deps.externalDb.selectFrom('facility_registry').select('id').orderBy('id').execute()).map((r) => r.id);
    expect(ids).toEqual(['fac-1', 'fac-2']);
  });

  it('counts the rows on a dry run and writes nothing', async () => {
    const deps = await makeReconcileDeps();
    await seedTwoRegisters(deps);

    const result = await publishFacilityMap(deps, {});

    expect(result.registryRows).toBe(3);
    expect(await deps.externalDb.selectFrom('facility_registry').select('id').execute()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd <worktree> && pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts -t "copies the register" > /tmp/t2.txt 2>&1; echo "exit=$?"; grep -E "Tests |AssertionError|expected" /tmp/t2.txt | head`
Expected: exit 1. All three fail: `registryRows` is `undefined`, and the copy is empty.

- [ ] **Step 3: Implement**

In `packages/bootstrap/src/facility-reconcile.ts`, add to `PublishResult` after `written: number;`:

```ts
  /** Register rows in the warehouse copy, `facility_registry` (migration 021). On a dry run, the
   *  number that would be copied. */
  registryRows: number;
```

Add this helper above `publishFacilityMap`:

```ts
/** 21 columns, so 90 rows bind 1,890 parameters: under MSSQL's 2,100. */
const REGISTRY_COPY_CHUNK = 90;

/** One internal register row as its warehouse copy. `extras` becomes JSON text, NULL when empty,
 *  because SQL Server and MySQL have no jsonb. */
function toWarehouseRegistryRow(r: {
  id: string; facility_system: string | null; facility_code: string; name: string;
  level: string | null; ownership: string | null; status: string | null; register_state: string;
  country: string | null; zone: string | null; region: string | null; district: string | null;
  council: string | null; ward: string | null; village: string | null; address_text: string | null;
  phone: string | null; latitude: number | null; longitude: number | null; extras: unknown; updated_at: unknown;
}) {
  const extras = typeof r.extras === 'string' ? JSON.parse(r.extras) as unknown : r.extras;
  const hasExtras = extras !== null && typeof extras === 'object' && Object.keys(extras as object).length > 0;
  return {
    id: r.id, facility_system: r.facility_system, facility_code: r.facility_code, name: r.name,
    level: r.level, ownership: r.ownership, status: r.status, register_state: r.register_state,
    country: r.country, zone: r.zone, region: r.region, district: r.district, council: r.council,
    ward: r.ward, village: r.village, address_text: r.address_text, phone: r.phone,
    latitude: r.latitude, longitude: r.longitude,
    extras: hasExtras ? JSON.stringify(extras) : null,
    updated_at: new Date(r.updated_at as string),
  };
}
```

In `publishFacilityMap`, after `const resolved = await resolveObservedFacilities(deps);`, read the register:

```ts
  // The whole register, for the warehouse copy. Read before the transaction, like `resolved`.
  const registry = await deps.internalDb.selectFrom('facility_registry')
    .select(['id', 'facility_system', 'facility_code', 'name', 'level', 'ownership', 'status', 'register_state',
      'country', 'zone', 'region', 'district', 'council', 'ward', 'village', 'address_text', 'phone',
      'latitude', 'longitude', 'extras', 'updated_at'])
    .execute();
```

Add `registryRows: registry.length,` to the `result` object after `written: resolved.length,`.

Inside the existing transaction, after the `facility_map` insert loop, add:

```ts
    // The warehouse copy of the register, in the same transaction so a reader never sees it out
    // of step with facility_map. Delete then insert, for the reason in this function's doc comment.
    await trx.deleteFrom('facility_registry').execute();
    const copy = registry.map(toWarehouseRegistryRow);
    for (let i = 0; i < copy.length; i += REGISTRY_COPY_CHUNK) {
      await trx.insertInto('facility_registry').values(copy.slice(i, i + REGISTRY_COPY_CHUNK)).execute();
    }
```

Update the function's doc comment (line 837 onward). Its first line becomes:

```ts
 * Rebuild `facility_map` from the current resolution, and the warehouse copy of the register
 * (`facility_registry`) from the internal one.
```

- [ ] **Step 4: Fix the typed fake in the job-runners test**

In `packages/bootstrap/src/facility-job-runners.test.ts:10`, change the fake result to:

```ts
      resolved: 3, unmapped: 1, targetMissing: 0, nonFacilityTarget: 0, ambiguous: 0, written: 4, registryRows: 0,
```

- [ ] **Step 5: Run the tests**

Run: `cd <worktree> && pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts src/facility-job-runners.test.ts > /tmp/t2.txt 2>&1; echo "exit=$?"; grep -E "Tests |FAIL" /tmp/t2.txt | head`
Expected: exit 0. The three new tests pass, and every existing one still passes.

Then typecheck the package: `cd <worktree> && pnpm --filter @openldr/bootstrap exec tsc --noEmit > /tmp/tc2.txt 2>&1; echo "exit=$?"; head -20 /tmp/tc2.txt`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd <worktree> && git branch --show-current && git add packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts packages/bootstrap/src/facility-job-runners.test.ts && git commit -m "feat(facilities): copy the facility register into the warehouse on every rebuild"
```

---

### Task 3: The CLI prints the count

**Files:**
- Modify: `packages/cli/src/facilities.ts:1474-1479` (`formatPublishHuman`)
- Modify: `packages/cli/src/facilities.test.ts:2380-2415`

**Interfaces:**
- Consumes: `PublishResult.registryRows` from Task 2.

- [ ] **Step 1: Write the failing assertions**

In `packages/cli/src/facilities.test.ts`, in the two tests at :2380 and :2402, change each mocked result to add `registryRows: 3150`:

```ts
    mocks.publishFacilityMap.mockResolvedValue({ resolved: 8, unmapped: 3, targetMissing: 1, nonFacilityTarget: 2, ambiguous: 1, written: 12, registryRows: 3150 });
```

In the dry-run test, after `expect(human).toMatch(/written 12/);`, add:

```ts
    expect(human).toMatch(/registry rows 3150/);
```

In the `--apply` test, after `expect(human).toMatch(/written 12/);`, add the same line.

- [ ] **Step 2: Run them and see them fail**

Run: `cd <worktree> && pnpm --filter @openldr/cli exec vitest run src/facilities.test.ts -t "facility.publish|dry-runs by default" > /tmp/t3.txt 2>&1; echo "exit=$?"; grep -E "Tests |registry rows" /tmp/t3.txt | head`
Expected: exit 1. Both fail on `/registry rows 3150/`.

- [ ] **Step 3: Implement**

In `formatPublishHuman`, change the `counts` line to:

```ts
  const counts = `resolved ${result.resolved}, unmapped ${result.unmapped}, targetMissing ${result.targetMissing}, nonFacilityTarget ${result.nonFacilityTarget}, ambiguous ${result.ambiguous}, written ${result.written}, registry rows ${result.registryRows}`;
```

- [ ] **Step 4: Run the tests**

Run: `cd <worktree> && pnpm --filter @openldr/cli exec vitest run src/facilities.test.ts > /tmp/t3.txt 2>&1; echo "exit=$?"; grep -E "Tests |FAIL" /tmp/t3.txt | head`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd <worktree> && git branch --show-current && git add packages/cli/src/facilities.ts packages/cli/src/facilities.test.ts && git commit -m "feat(cli): facilities publish prints the register rows copied"
```

---

### Task 4: Bulk delete queues the rebuild

**Files:**
- Modify: `apps/server/src/facilities-routes.ts:1817-1829` (the bulk-delete route, after its reprojection loop)
- Modify: `apps/server/src/facilities-routes.test.ts` (new `it` inside `describe('POST /api/facilities/bulk-delete')` at :6832)

- [ ] **Step 1: Write the failing test**

Inside `describe('POST /api/facilities/bulk-delete', ...)`, after the `'deletes exactly the resolved set when the confirmed count still holds'` test, add:

```ts
  it('queues a facility-map-rebuild, so the warehouse copies drop the deleted rows', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    // The create queued its own rebuild. Resolve it, so only the bulk delete can explain the job below.
    ctx.facilityJobs.__resolveAll();
    const before = (await app.inject({ method: 'GET', url: '/api/facilities' })).json().total;

    const res = await app.inject({ method: 'POST', url: BULK, payload: { selection: {}, expectedCount: before } });

    expect(res.statusCode).toBe(200);
    const queued = await ctx.facilityJobs.listUnresolved();
    expect(queued.map((j: any) => j.kind)).toContain('facility-map-rebuild');
  });
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd <worktree> && pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t "queues a facility-map-rebuild, so the warehouse" > /tmp/t4.txt 2>&1; echo "exit=$?"; grep -E "Tests |expected" /tmp/t4.txt | head`
Expected: exit 1. The queued kinds do not contain `facility-map-rebuild`.

- [ ] **Step 3: Implement**

In the bulk-delete route, after the `for (const registryId of [...new Set(failedRegistryIds)])` loop and before `await recordAudit(`, add:

```ts
    // The warehouse copies (`facility_map`, `facility_registry`) still hold the deleted rows until
    // a rebuild. Wrapped like the single-row delete: the rows are already gone, so a lost enqueue
    // must not turn this into a 500. Logged, because a lost enqueue leaves the copies stale.
    try {
      await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: actorFromRequest(req).actorId });
    } catch (err) {
      ctx.logger.error({ err, count: deleted }, 'failed to enqueue a facility-map-rebuild job after a bulk delete');
    }
```

- [ ] **Step 4: Run the route tests and the lint**

Run: `cd <worktree> && pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts > /tmp/t4.txt 2>&1; echo "exit=$?"; grep -E "Tests |FAIL" /tmp/t4.txt | head`
Expected: exit 0.

Run: `cd <worktree> && pnpm --filter @openldr/server lint > /tmp/l4.txt 2>&1; echo "exit=$?"; tail -5 /tmp/l4.txt`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd <worktree> && git branch --show-current && git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts && git commit -m "fix(facilities): a bulk delete refreshes the warehouse copies"
```

---

### Task 5: Docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/facilities.md` (new section before `## Related guides`, line 430)
- Modify: `apps/studio/src/docs/0.1.8/fr/facilities.md` (before `## Guides associés`, line 472)
- Modify: `apps/studio/src/docs/0.1.8/pt/facilities.md` (before its related-guides heading; find it with `grep -n "^## " apps/studio/src/docs/0.1.8/pt/facilities.md`)
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/query.md` (one sentence each)
- Modify: `apps/web/src/docs/0.1.8/facilities.md` (the same section as the studio en text)

The files use CRLF line endings. Keep them: edit with the Edit tool, not `sed`.

- [ ] **Step 1: Studio en**

Add before `## Related guides` in `en/facilities.md`:

```markdown
## Querying a register

The warehouse holds a copy of every register in the table `facility_registry`. A custom query on
the Query page can read it, even before any results arrive. It has one row per facility, from
every register, with `facility_system` (the register's URL), `facility_code`, `name`, the area
columns, `register_state` and `extras` (as JSON text).

The copy is rebuilt with the facility map: after an import, an edit, a delete, a content pack, a
link-matching run, and at startup. To rebuild it by hand, run `openldr facilities publish --apply`.

For example, the Mozambique facility register:

    select facility_code, name, region, district
    from facility_registry
    where facility_system = 'urn:openldr:mz:facilities'
    order by facility_code
```

Add to `en/query.md`, at the end of the troubleshooting list:

```markdown
- **Need the facility register in a query?** Read the warehouse table `facility_registry`. See [Facilities](/docs/facilities).
```

- [ ] **Step 2: Studio fr**

Add before `## Guides associés` in `fr/facilities.md`:

```markdown
## Interroger un registre

L'entrepôt garde une copie de chaque registre dans la table `facility_registry`. Une requête
personnalisée de la page Query peut la lire, même avant l'arrivée de résultats. Elle contient une
ligne par établissement, de chaque registre, avec `facility_system` (l'URL du registre),
`facility_code`, `name`, les colonnes de zone, `register_state` et `extras` (en texte JSON).

La copie est reconstruite avec la carte des établissements : après une importation, une
modification, une suppression, un pack de contenu, une liaison des codes, et au démarrage. Pour la
reconstruire à la main, lancez `openldr facilities publish --apply`.

Par exemple, le registre des établissements du Mozambique :

    select facility_code, name, region, district
    from facility_registry
    where facility_system = 'urn:openldr:mz:facilities'
    order by facility_code
```

Add to `fr/query.md`, after the paragraph about a blank optional parameter:

```markdown
Pour lire le registre des établissements, interrogez la table `facility_registry` de l'entrepôt. Voir [Établissements](/docs/facilities).
```

- [ ] **Step 3: Studio pt**

Add before the related-guides heading in `pt/facilities.md`:

```markdown
## Consultar um registo

O armazém guarda uma cópia de cada registo na tabela `facility_registry`. Uma consulta
personalizada na página Query pode lê-la, mesmo antes de chegarem resultados. Tem uma linha por
unidade, de cada registo, com `facility_system` (o URL do registo), `facility_code`, `name`, as
colunas de área, `register_state` e `extras` (em texto JSON).

A cópia é reconstruída com o mapa de unidades: depois de uma importação, uma edição, uma
eliminação, um pacote de conteúdo, uma ligação de códigos, e no arranque. Para a reconstruir à
mão, execute `openldr facilities publish --apply`.

Por exemplo, o registo de unidades de Moçambique:

    select facility_code, name, region, district
    from facility_registry
    where facility_system = 'urn:openldr:mz:facilities'
    order by facility_code
```

Add to `pt/query.md`, after the paragraph about a blank optional parameter:

```markdown
Para ler o registo de unidades, consulte a tabela `facility_registry` do armazém. Ver [Unidades](/docs/facilities).
```

- [ ] **Step 4: Web docs**

Add the en section from Step 1 to `apps/web/src/docs/0.1.8/facilities.md`, before its related-guides heading (find it with `grep -n "^## " apps/web/src/docs/0.1.8/facilities.md`; if there is none, add it at the end).

- [ ] **Step 5: Run the docs tests**

Run: `cd <worktree> && pnpm --filter @openldr/studio exec vitest run src/docs > /tmp/t5.txt 2>&1; echo "exit=$?"; grep -E "Tests |FAIL" /tmp/t5.txt | head`
Expected: exit 0.

Run: `cd <worktree> && pnpm --filter @openldr/web exec vitest run src/docs > /tmp/t5w.txt 2>&1; echo "exit=$?"; grep -E "Tests |FAIL" /tmp/t5w.txt | head`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd <worktree> && git branch --show-current && git add apps/studio/src/docs/0.1.8/en/facilities.md apps/studio/src/docs/0.1.8/fr/facilities.md apps/studio/src/docs/0.1.8/pt/facilities.md apps/studio/src/docs/0.1.8/en/query.md apps/studio/src/docs/0.1.8/fr/query.md apps/studio/src/docs/0.1.8/pt/query.md apps/web/src/docs/0.1.8/facilities.md && git commit -m "docs(facilities): query the facility register from the warehouse"
```

---

### Task 6: Gates, merge and live check

No new code. Steps marked STOP need the operator's yes.

- [ ] **Step 1: Full CE gates, both forced**

Run in the background (about 16 minutes): `cd <worktree> && pnpm turbo run test --force --concurrency=3 --continue > <scratchpad>/ce-test.txt 2>&1; echo "test exit=$?"`
Then: `cd <worktree> && pnpm turbo run typecheck --force > <scratchpad>/ce-tc.txt 2>&1; echo "typecheck exit=$?"`
Then: `cd <worktree> && pnpm --filter @openldr/server lint > <scratchpad>/ce-lint.txt 2>&1; echo "lint exit=$?"`
Expected: three exit 0. Check `Tasks:` and `Cached: 0 cached` lines. A `Test timed out` failure: re-run that file alone before treating it as a regression.

- [ ] **Step 2: STOP. Ask to merge to local main and restart the API**

On a yes: `cd D:/Projects/Repositories/openldr_ce && git merge --no-ff feat/warehouse-facility-registry -m "Merge branch 'feat/warehouse-facility-registry': the facility register in the warehouse"`. nodemon restarts the dev API on the change. Wait until :3000 listens. Migration 021 runs on that boot.

- [ ] **Step 3: Changelog**

`cd D:/Projects/Repositories/openldr_ce && pnpm make:changelog`, then commit `apps/web/src/landing/changelog.json` as `chore(web): update changelog after the warehouse facility register`.

- [ ] **Step 4: Live check**

Boot already queues a rebuild (`packages/bootstrap/src/index.ts:1067`). Confirm the copy:

`docker exec openldr_ce-postgres-1 psql -U openldr -d openldr_target -Atc "select facility_system, count(*) from facility_registry group by 1 order by 1"`
Expected: `urn:openldr:mz:facilities|2839` and `urn:openldr:mz:laboratories|311`.

On the Query page (`http://localhost:5173/studio/query`), open a new tab on "Target Warehouse (Postgres)" and run:

```sql
select facility_code as "FacilityCode", name as "Description", 'MZ' as "CountryCode",
       region as "ProvinceName", district as "DistrictName", 'Mozambique' as "CountryName"
from facility_registry
where facility_system = 'urn:openldr:mz:facilities'
order by facility_code
```

Expected: rows, no error, total 2,839. Screenshot it.

- [ ] **Step 5: STOP. Ask to push**

On a yes: `git push origin main`, then `git fetch origin` and confirm the local and origin SHAs match.

---

## What this plan does not prove

- The DDL on SQL Server and MySQL. pg-mem runs Postgres only. `indexed-columns.test.ts` compiles the DDL for both and checks only the index column types.
- A register of national size. The dev CE has 3,150 rows. 15,000 rows means 167 insert batches in one transaction; no timing is measured here.
