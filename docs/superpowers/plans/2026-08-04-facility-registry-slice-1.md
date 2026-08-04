# Facility Registry — Slice 1 (registry + aliases + import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CE a curated registry of facilities — created by hand at a lab or imported from a national list — with a per-feed alias table that resolves what arriving data called a facility to what we know it is.

**Architecture:** Two internal tables. `facility_registry` holds curated facilities; `facility_aliases` maps `(source_system, source_code)` → one registry row, so many observed codes resolve to one facility. A Kysely store in `@openldr/db` (mirroring `createReportStore`) owns all writes and takes an injected `ReferenceCapture` so central-side writes land in `reference_change_log` for down-sync. A CSV importer parses to the store's record type and never touches the DB itself, so it is unit-testable without a database.

**Tech Stack:** TypeScript, Kysely (Postgres internal DB), Vitest, `csv-parse` (already a dependency of `@openldr/terminology`), pg-mem for migration tests (via `makeMigratedDb()`, which runs each migration's `up()` in order — measured to enforce CHECK constraints and partial unique indexes).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-04-facility-registry-model-design.md`. Read it before Task 1.
- **This slice does NOT include:** the Facilities page, the entity resolver for form pickers, the reconciliation UI, or the sync wiring. Slice 1 is the model, the store and the importer only.
- **Migration number:** `070_facility_registry` — `069_result_role_valuesets` is the current highest.
- **Never `git add -A`.** The repo dir is shared with concurrent sessions; add exact paths.
- **No `Co-Authored-By` trailer** on any commit.
- **Gate before merge:** `pnpm turbo run typecheck test --force` must be 67/67. Never pipe turbo through `tail`.
- **`managed_origin`, not `origin`.** The spec says `origin`; the codebase already has a `managed_origin` convention (migration 048, `reference-apply.ts`) where `NULL` = lab-local and `'central'` = central-managed, with deletes guarded by the stamp. Use the existing convention — Task 1 records this deviation in the spec.
- **Three similarly-named columns, three meanings.** `facility_registry.local_code` (authored, ours) ≠ `facility_aliases.source_code` (observed, per feed) ≠ `facilities.facility_code` (the projection of an ingested FHIR identifier, a different table entirely). Do not join them.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/migrations/internal/070_facility_registry.ts` | Create both tables. |
| `packages/db/src/migrations/internal/070_facility_registry.test.ts` | Migration shape + constraint behaviour. |
| `packages/db/src/schema/internal.ts` *(modify)* | Kysely row types for both tables. |
| `packages/db/src/facility-registry-store.ts` | All reads/writes. Capture-aware. |
| `packages/db/src/facility-registry-store.test.ts` | Store behaviour incl. the CHECK and alias PK. |
| `packages/db/src/index.ts` *(modify)* | Export the store and its types. |
| `packages/terminology/src/facility-csv.ts` | Pure CSV → records parser + unknown-column report. |
| `packages/terminology/src/facility-csv.test.ts` | Parser behaviour incl. the unknown-column rule. |

---

## Task 1: Migration — the two tables

**Files:**
- Create: `packages/db/src/migrations/internal/070_facility_registry.ts`
- Create: `packages/db/src/migrations/internal/070_facility_registry.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `docs/superpowers/specs/2026-08-04-facility-registry-model-design.md`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `facility_registry` and `facility_aliases` with the columns Task 2 types.

- [ ] **Step 1: Read the spec's model section**

Read `docs/superpowers/specs/2026-08-04-facility-registry-model-design.md` §2, §2.1, §2.2. The column list and the CHECK come from there.

- [ ] **Step 2: Write the failing migration test**

Create `packages/db/src/migrations/internal/070_facility_registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('070_facility_registry', () => {
  it('creates a registry row identified by a local code alone', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never).values({
      id: 'f1', local_code: 'LAB01', name: 'Bahebe Health Laboratory', source: 'manual',
    } as never).execute();
    const row = await db.selectFrom('facility_registry' as never).selectAll().executeTakeFirstOrThrow();
    expect((row as any).local_code).toBe('LAB01');
    expect((row as any).national_code).toBeNull();
    // NULL managed_origin means lab-local — the existing convention from migration 048.
    expect((row as any).managed_origin).toBeNull();
    expect((row as any).extras).toEqual({});
  });

  it('creates a registry row identified by a national code alone', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never).values({
      id: 'f2', national_system: 'urn:tz:hfr', national_code: '122023-5',
      name: 'BAHEBE HEALTH LABORATORY', source: 'import', managed_origin: 'central',
    } as never).execute();
    const row = await db.selectFrom('facility_registry' as never).selectAll().executeTakeFirstOrThrow();
    expect((row as any).local_code).toBeNull();
    expect((row as any).national_code).toBe('122023-5');
  });

  it('REJECTS a row carrying neither code — a facility must be identifiable somehow', async () => {
    const db = await makeMigratedDb();
    await expect(db.insertInto('facility_registry' as never).values({
      id: 'f3', name: 'Nameless', source: 'manual',
    } as never).execute()).rejects.toThrow();
  });

  it('resolves many aliases to one facility, but one alias to only one facility', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never).values({
      id: 'f1', local_code: 'LAB01', name: 'Dodoma Regional Referral', source: 'manual',
    } as never).execute();
    // Two different feeds, two codes, one facility — the multi-LIS case.
    await db.insertInto('facility_aliases' as never).values([
      { source_system: 'lis-a', source_code: 'DOD01', registry_id: 'f1' },
      { source_system: 'urn:openldr:cdr:performer', source_code: 'Dodoma', registry_id: 'f1' },
    ] as never).execute();
    const rows = await db.selectFrom('facility_aliases' as never).selectAll().execute();
    expect(rows).toHaveLength(2);
    // The SAME (source_system, source_code) cannot mean two facilities.
    await expect(db.insertInto('facility_aliases' as never).values(
      { source_system: 'lis-a', source_code: 'DOD01', registry_id: 'f1' } as never,
    ).execute()).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run --dir packages/db/src/migrations/internal 070_facility_registry`
Expected: FAIL — the table does not exist (`relation "facility_registry" does not exist`).

- [ ] **Step 4: Write the migration**

Create `packages/db/src/migrations/internal/070_facility_registry.ts`:

```typescript
import { type Kysely, sql } from 'kysely';

// Facility registry slice 1. `facility_registry` is what we KNOW about a facility (curated);
// `facility_aliases` is what an incoming FEED called it (observed). They are deliberately separate
// from the `facilities` table in the ANALYTICS schema, which is the uncurated projection of ingested
// Organization/Location resources — see the spec's §6. Do not consolidate them.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('facility_registry')
    .addColumn('id', 'text', (c) => c.primaryKey())
    // OURS: required at data entry, absent on a nationally-imported row.
    .addColumn('local_code', 'text', (c) => c.unique())
    // THEIRS: the only code an imported row carries.
    .addColumn('national_system', 'text')
    .addColumn('national_code', 'text')
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('level', 'text')
    .addColumn('ownership', 'text')
    .addColumn('status', 'text')
    // Administrative chain as REAL COLUMNS: anything a report groups by must be indexable, and a
    // jsonb key is not. Free text, not FKs — another country maps its own vocabulary onto these.
    .addColumn('country', 'text')
    .addColumn('zone', 'text')
    .addColumn('region', 'text')
    .addColumn('district', 'text')
    .addColumn('council', 'text')
    .addColumn('ward', 'text')
    .addColumn('village', 'text')
    .addColumn('address_text', 'text')
    .addColumn('phone', 'text')
    .addColumn('latitude', 'numeric')
    .addColumn('longitude', 'numeric')
    // Fields a form added beyond the core, so an admin can extend without a migration (Users pattern).
    .addColumn('extras', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    // NULL = lab-local, 'central' = central-managed and replaceable by down-sync. Matches the
    // existing convention from migration 048 / reference-apply.ts, whose deletes are guarded by it
    // so a lab-local row sharing an id is never touched.
    .addColumn('managed_origin', 'text')
    .addColumn('source', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // A facility must be identifiable SOMEHOW. Neither column can be NOT NULL on its own: an
    // imported row has no local code, and a hand-entered one may never acquire a national code.
    .addCheckConstraint('facility_registry_has_a_code', sql`local_code is not null or national_code is not null`)
    .execute();

  // One national code means one facility, per register. Partial so the many rows without a national
  // code do not collide with each other.
  await db.schema
    .createIndex('facility_registry_national_unique')
    .unique()
    .on('facility_registry')
    .columns(['national_system', 'national_code'])
    .where(sql.ref('national_code'), 'is not', null)
    .execute();

  for (const col of ['region', 'district', 'council', 'status']) {
    await db.schema.createIndex(`facility_registry_${col}_idx`).on('facility_registry').column(col).execute();
  }

  await db.schema
    .createTable('facility_aliases')
    .addColumn('source_system', 'text', (c) => c.notNull())
    .addColumn('source_code', 'text', (c) => c.notNull())
    .addColumn('registry_id', 'text', (c) => c.notNull().references('facility_registry.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text')
    // THE PK IS THE DESIGN: one alias resolves to exactly ONE facility, while many aliases point at
    // one registry row. That is the multi-LIS answer — a second LIS adds aliases, never forks the
    // registry — and it makes reconciliation idempotent.
    .addPrimaryKeyConstraint('facility_aliases_pk', ['source_system', 'source_code'])
    .execute();

  await db.schema
    .createIndex('facility_aliases_registry_idx')
    .on('facility_aliases')
    .column('registry_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('facility_aliases').ifExists().execute();
  await db.schema.dropTable('facility_registry').ifExists().execute();
}
```

- [ ] **Step 5: Register the migration**

Open `packages/db/src/migrations/internal/index.ts`, find the list of migration imports, and add `070_facility_registry` following the exact shape of the `069_result_role_valuesets` entry immediately above it.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run --dir packages/db/src/migrations/internal 070_facility_registry`
Expected: PASS, 4 tests.

ℹ These tests run against **pg-mem**, not real Postgres (`makeMigratedDb` runs each migration's
`up()` in order — pg-mem cannot do Kysely's Migrator introspection). MEASURED for this plan: pg-mem
**does** enforce `CHECK` constraints and **does** support partial unique indexes, so both the
constraint test and the partial index behave as written. Do not weaken them.

- [ ] **Step 7: Record the managed_origin deviation in the spec**

In `docs/superpowers/specs/2026-08-04-facility-registry-model-design.md` §2, change the `origin` line to:

```
  managed_origin  text  NULL               -- NULL = lab-local | 'central' = central-managed (§8)
```

and add immediately below the model block:

```markdown
⚠ The column is `managed_origin`, not `origin`: migration 048 and `reference-apply.ts` already
establish that name and semantics (NULL = lab-local, `'central'` = managed), and the applier's
deletes are guarded by it. Reusing the convention means the sync task inherits that guard instead of
reimplementing it.
```

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/internal/070_facility_registry.ts packages/db/src/migrations/internal/070_facility_registry.test.ts packages/db/src/migrations/internal/index.ts docs/superpowers/specs/2026-08-04-facility-registry-model-design.md
git commit -m "feat(db): add facility_registry and facility_aliases tables"
```

---

## Task 2: Kysely row types

**Files:**
- Modify: `packages/db/src/schema/internal.ts`

**Interfaces:**
- Consumes: the tables from Task 1.
- Produces: `FacilityRegistryTable`, `FacilityAliasesTable`, both added to `InternalSchema`.

- [ ] **Step 1: Add the row types**

In `packages/db/src/schema/internal.ts`, next to the other config-table interfaces, add:

```typescript
/** Curated facility record — what we KNOW. Distinct from the analytics `facilities` table, which is
 *  the uncurated projection of ingested Organization/Location resources. */
export interface FacilityRegistryTable {
  id: string;
  /** OURS. Required at data entry, absent on a nationally-imported row. */
  local_code: string | null;
  national_system: string | null;
  /** THEIRS. The only code an imported row carries. */
  national_code: string | null;
  name: string;
  level: string | null;
  ownership: string | null;
  status: string | null;
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
  extras: unknown;
  /** NULL = lab-local, 'central' = central-managed (migration 048 convention). */
  managed_origin: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

/** What an incoming FEED called a facility. Many per facility; the PK makes one alias mean one. */
export interface FacilityAliasesTable {
  source_system: string;
  source_code: string;
  registry_id: string;
  created_at: string;
  created_by: string | null;
}
```

Then add both to the `InternalSchema` interface, beside the existing entries:

```typescript
  facility_registry: FacilityRegistryTable;
  facility_aliases: FacilityAliasesTable;
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p packages/db/tsconfig.json`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/internal.ts
git commit -m "feat(db): type the facility registry tables"
```

---

## Task 3: The store

**Files:**
- Create: `packages/db/src/facility-registry-store.ts`
- Create: `packages/db/src/facility-registry-store.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `FacilityRegistryTable`/`FacilityAliasesTable` (Task 2); `ReferenceCapture` from `./reference-capture`.
- Produces:
  - `type FacilityRecord` — camelCase record shape.
  - `type FacilityAlias = { sourceSystem: string; sourceCode: string; registryId: string }`
  - `createFacilityRegistryStore(db: Kysely<InternalSchema>, capture?: ReferenceCapture): FacilityRegistryStore`
  - `FacilityRegistryStore` with: `get(id)`, `list(opts?)`, `upsert(rec)`, `remove(id)`, `attachAlias(a)`, `detachAlias(sourceSystem, sourceCode)`, `resolve(sourceSystem, sourceCode)`, `listAliases(registryId)`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/facility-registry-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityRegistryStore } from './facility-registry-store';

async function store() {
  const db = await makeMigratedDb();
  return { db, s: createFacilityRegistryStore(db as never) };
}

const manual = { id: 'f1', localCode: 'LAB01', name: 'Dodoma Regional Referral', source: 'manual' as const };

describe('createFacilityRegistryStore', () => {
  it('round-trips a hand-entered facility', async () => {
    const { s } = await store();
    await s.upsert(manual);
    expect(await s.get('f1')).toMatchObject({ id: 'f1', localCode: 'LAB01', name: 'Dodoma Regional Referral' });
  });

  it('resolves an observed feed code to the facility it was attached to', async () => {
    const { s } = await store();
    await s.upsert(manual);
    await s.attachAlias({ sourceSystem: 'urn:openldr:cdr:performer', sourceCode: 'Dodoma', registryId: 'f1' });
    expect(await s.resolve('urn:openldr:cdr:performer', 'Dodoma')).toMatchObject({ id: 'f1' });
    expect(await s.resolve('urn:openldr:cdr:performer', 'Mnazi Mmoja')).toBeUndefined();
  });

  it('stores an observed string EXACTLY as it arrived, truncation included', async () => {
    // The 30-char truncation is a match key, not a name. Never normalise it.
    const { s } = await store();
    await s.upsert(manual);
    const truncated = 'International School of Tangan';
    await s.attachAlias({ sourceSystem: 'cdr', sourceCode: truncated, registryId: 'f1' });
    expect(await s.resolve('cdr', truncated)).toMatchObject({ id: 'f1' });
    expect(await s.resolve('cdr', 'International School of Tanganyika')).toBeUndefined();
  });

  it('is idempotent: re-attaching the same alias is a no-op, not a duplicate', async () => {
    const { s } = await store();
    await s.upsert(manual);
    const a = { sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: 'f1' };
    await s.attachAlias(a);
    await s.attachAlias(a);
    expect(await s.listAliases('f1')).toHaveLength(1);
  });

  it('re-points an alias when it is attached to a different facility', async () => {
    const { s } = await store();
    await s.upsert(manual);
    await s.upsert({ id: 'f2', localCode: 'LAB02', name: 'Muhimbili', source: 'manual' });
    await s.attachAlias({ sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: 'f1' });
    await s.attachAlias({ sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: 'f2' });
    expect(await s.resolve('cdr', 'Dodoma')).toMatchObject({ id: 'f2' });
    expect(await s.listAliases('f1')).toHaveLength(0);
  });

  it('upsert updates in place, so aliases survive a rename', async () => {
    const { s } = await store();
    await s.upsert(manual);
    await s.attachAlias({ sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: 'f1' });
    await s.upsert({ ...manual, name: 'Dodoma Regional Referral Hospital' });
    expect(await s.get('f1')).toMatchObject({ name: 'Dodoma Regional Referral Hospital' });
    expect(await s.listAliases('f1')).toHaveLength(1);
  });

  it('captures a reference change for central-managed writes', async () => {
    const { db } = await store();
    const seen: { entityType: string; entityId: string; op: string }[] = [];
    const s = createFacilityRegistryStore(db as never, {
      record: async (_trx, entityType, entityId, op) => { seen.push({ entityType, entityId, op }); },
    });
    await s.upsert({ id: 'f9', nationalSystem: 'urn:tz:hfr', nationalCode: '122023-5', name: 'Bahebe', source: 'import' });
    await s.remove('f9');
    expect(seen).toEqual([
      { entityType: 'facility_registry', entityId: 'f9', op: 'upsert' },
      { entityType: 'facility_registry', entityId: 'f9', op: 'delete' },
    ]);
  });

  it('does NOT capture alias writes — aliases are lab-local and must never sync', async () => {
    // An alias maps ONE lab's feed codes; it is meaningless at central and actively wrong at another
    // lab whose identical local code means a different facility.
    const { db } = await store();
    const seen: string[] = [];
    const s = createFacilityRegistryStore(db as never, {
      record: async (_trx, entityType) => { seen.push(entityType); },
    });
    await s.upsert(manual);
    seen.length = 0;
    await s.attachAlias({ sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: 'f1' });
    await s.detachAlias('cdr', 'Dodoma');
    expect(seen).toEqual([]);
  });

  it('filters the list by region and status', async () => {
    const { s } = await store();
    await s.upsert({ ...manual, region: 'Dodoma Region', status: 'Operating' });
    await s.upsert({ id: 'f2', localCode: 'LAB02', name: 'Closed One', source: 'manual', region: 'Dodoma Region', status: 'Closed' });
    expect(await s.list({ region: 'Dodoma Region' })).toHaveLength(2);
    expect(await s.list({ region: 'Dodoma Region', status: 'Operating' })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --dir packages/db/src facility-registry-store`
Expected: FAIL — `Cannot find module './facility-registry-store'`.

- [ ] **Step 3: Write the store**

Create `packages/db/src/facility-registry-store.ts`:

```typescript
import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';
import type { ReferenceCapture } from './reference-capture';

/** A curated facility. camelCase; the store translates to/from the snake_case row. */
export interface FacilityRecord {
  id: string;
  /** OURS — required at data entry, absent on a nationally-imported row. */
  localCode?: string | null;
  nationalSystem?: string | null;
  /** THEIRS — the only code an imported row carries. */
  nationalCode?: string | null;
  name: string;
  level?: string | null;
  ownership?: string | null;
  status?: string | null;
  country?: string | null;
  zone?: string | null;
  region?: string | null;
  district?: string | null;
  council?: string | null;
  ward?: string | null;
  village?: string | null;
  addressText?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Fields a form added beyond the core — extend without a migration (the Users pattern). */
  extras?: Record<string, unknown>;
  /** NULL = lab-local, 'central' = central-managed and replaceable by down-sync. */
  managedOrigin?: string | null;
  source: 'manual' | 'import';
}

export interface FacilityAlias {
  sourceSystem: string;
  sourceCode: string;
  registryId: string;
  createdBy?: string | null;
}

export interface FacilityListOptions {
  region?: string;
  district?: string;
  council?: string;
  status?: string;
  limit?: number;
}

export interface FacilityRegistryStore {
  get(id: string): Promise<FacilityRecord | undefined>;
  list(opts?: FacilityListOptions): Promise<FacilityRecord[]>;
  upsert(rec: FacilityRecord): Promise<FacilityRecord>;
  remove(id: string): Promise<void>;
  /** Attach an observed feed code to a facility. Idempotent; re-points if already attached elsewhere. */
  attachAlias(alias: FacilityAlias): Promise<void>;
  detachAlias(sourceSystem: string, sourceCode: string): Promise<void>;
  /** What facility did this feed's code mean? `undefined` when nothing has been attached yet. */
  resolve(sourceSystem: string, sourceCode: string): Promise<FacilityRecord | undefined>;
  listAliases(registryId: string): Promise<FacilityAlias[]>;
}

type Row = InternalSchema['facility_registry'];

function toRecord(r: Row): FacilityRecord {
  return {
    id: r.id,
    localCode: r.local_code,
    nationalSystem: r.national_system,
    nationalCode: r.national_code,
    name: r.name,
    level: r.level,
    ownership: r.ownership,
    status: r.status,
    country: r.country,
    zone: r.zone,
    region: r.region,
    district: r.district,
    council: r.council,
    ward: r.ward,
    village: r.village,
    addressText: r.address_text,
    phone: r.phone,
    latitude: r.latitude,
    longitude: r.longitude,
    extras: (r.extras ?? {}) as Record<string, unknown>,
    managedOrigin: r.managed_origin,
    source: r.source as 'manual' | 'import',
  };
}

function toRow(rec: FacilityRecord): Omit<Row, 'created_at' | 'updated_at'> {
  return {
    id: rec.id,
    local_code: rec.localCode ?? null,
    national_system: rec.nationalSystem ?? null,
    national_code: rec.nationalCode ?? null,
    name: rec.name,
    level: rec.level ?? null,
    ownership: rec.ownership ?? null,
    status: rec.status ?? null,
    country: rec.country ?? null,
    zone: rec.zone ?? null,
    region: rec.region ?? null,
    district: rec.district ?? null,
    council: rec.council ?? null,
    ward: rec.ward ?? null,
    village: rec.village ?? null,
    address_text: rec.addressText ?? null,
    phone: rec.phone ?? null,
    latitude: rec.latitude ?? null,
    longitude: rec.longitude ?? null,
    extras: rec.extras ?? {},
    managed_origin: rec.managedOrigin ?? null,
    source: rec.source,
  };
}

/** Hash the STORED record, not the input, so the captured hash reflects what is served. */
function hashOf(rec: FacilityRecord): string {
  return createHash('sha256').update(JSON.stringify(rec)).digest('hex');
}

export function createFacilityRegistryStore(
  db: Kysely<InternalSchema>,
  capture?: ReferenceCapture,
): FacilityRegistryStore {
  return {
    async get(id) {
      const r = await db.selectFrom('facility_registry').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? toRecord(r as Row) : undefined;
    },

    async list(opts = {}) {
      let q = db.selectFrom('facility_registry').selectAll();
      if (opts.region) q = q.where('region', '=', opts.region);
      if (opts.district) q = q.where('district', '=', opts.district);
      if (opts.council) q = q.where('council', '=', opts.council);
      if (opts.status) q = q.where('status', '=', opts.status);
      q = q.orderBy('name', 'asc');
      if (opts.limit) q = q.limit(opts.limit);
      return (await q.execute()).map((r) => toRecord(r as Row));
    },

    async upsert(rec) {
      const row = toRow(rec);
      return db.transaction().execute(async (trx) => {
        await trx
          .insertInto('facility_registry')
          .values(row as never)
          .onConflict((oc) => oc.column('id').doUpdateSet({ ...row, updated_at: new Date().toISOString() } as never))
          .execute();
        const stored = toRecord(
          (await trx.selectFrom('facility_registry').selectAll().where('id', '=', rec.id).executeTakeFirstOrThrow()) as Row,
        );
        if (capture) await capture.record(trx, 'facility_registry', rec.id, 'upsert', hashOf(stored));
        return stored;
      });
    },

    async remove(id) {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('facility_registry').where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'facility_registry', id, 'delete', null);
      });
    },

    // ⚠ Alias writes are NOT captured. An alias maps ONE lab's feed codes to a facility; it is
    // meaningless at central and actively wrong at another lab whose identical code means something
    // else. Registry syncs down; aliases stay local.
    async attachAlias(alias) {
      await db
        .insertInto('facility_aliases')
        .values({
          source_system: alias.sourceSystem,
          source_code: alias.sourceCode,
          registry_id: alias.registryId,
          created_by: alias.createdBy ?? null,
        } as never)
        .onConflict((oc) =>
          oc.columns(['source_system', 'source_code']).doUpdateSet({ registry_id: alias.registryId } as never),
        )
        .execute();
    },

    async detachAlias(sourceSystem, sourceCode) {
      await db
        .deleteFrom('facility_aliases')
        .where('source_system', '=', sourceSystem)
        .where('source_code', '=', sourceCode)
        .execute();
    },

    async resolve(sourceSystem, sourceCode) {
      const r = await db
        .selectFrom('facility_aliases')
        .innerJoin('facility_registry', 'facility_registry.id', 'facility_aliases.registry_id')
        .selectAll('facility_registry')
        .where('facility_aliases.source_system', '=', sourceSystem)
        .where('facility_aliases.source_code', '=', sourceCode)
        .executeTakeFirst();
      return r ? toRecord(r as Row) : undefined;
    },

    async listAliases(registryId) {
      const rows = await db
        .selectFrom('facility_aliases')
        .selectAll()
        .where('registry_id', '=', registryId)
        .orderBy('source_system', 'asc')
        .execute();
      return rows.map((r) => ({
        sourceSystem: r.source_system,
        sourceCode: r.source_code,
        registryId: r.registry_id,
        createdBy: r.created_by,
      }));
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --dir packages/db/src facility-registry-store`
Expected: PASS, 9 tests.

- [ ] **Step 5: Export from the package**

In `packages/db/src/index.ts`, beside the other store exports, add:

```typescript
export { createFacilityRegistryStore } from './facility-registry-store';
export type { FacilityRecord, FacilityAlias, FacilityListOptions, FacilityRegistryStore } from './facility-registry-store';
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p packages/db/tsconfig.json`
Expected: no output.

⚠ `'facility_registry'` is not yet a member of `ReferenceEntityType`, so the `capture.record` call will not typecheck. Add it to the union and to `ENTITY_TYPES` in `packages/db/src/reference-change-log.ts`, placed **after** the existing entries (order matters only for dependency replay, and the registry depends on nothing).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/facility-registry-store.ts packages/db/src/facility-registry-store.test.ts packages/db/src/index.ts packages/db/src/reference-change-log.ts
git commit -m "feat(db): facility registry store with lab-local aliases"
```

---

## Task 4: The CSV importer

**Files:**
- Create: `packages/terminology/src/facility-csv.ts`
- Create: `packages/terminology/src/facility-csv.test.ts`
- Modify: `packages/terminology/src/index.ts`

**Interfaces:**
- Consumes: `FacilityRecord` from `@openldr/db` (Task 3).
- Produces: `parseFacilityCsv(csv: string, opts: { nationalSystem: string; allowUnknownColumns?: boolean }): FacilityCsvResult` where `FacilityCsvResult = { records: FacilityRecord[]; unknownColumns: string[]; skipped: number }`.

- [ ] **Step 1: Write the failing test**

Create `packages/terminology/src/facility-csv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseFacilityCsv, FACILITY_CSV_TEMPLATE } from './facility-csv';

const HFR = 'urn:tz:hfr';
const csv = (body: string) => parseFacilityCsv(body, { nationalSystem: HFR });

describe('parseFacilityCsv', () => {
  it('parses the documented column contract into records', () => {
    const r = csv(
      'national_code,name,level,region,council,ward,ownership,status\n' +
      '122023-5,BAHEBE HEALTH LABORATORY,Level IA2 (Dispensary Laboratory),Geita,Chato DC,Nyamirembe,Private For Profit,Operating\n',
    );
    expect(r.unknownColumns).toEqual([]);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({
      nationalSystem: HFR,
      nationalCode: '122023-5',
      name: 'BAHEBE HEALTH LABORATORY',
      level: 'Level IA2 (Dispensary Laboratory)',
      region: 'Geita',
      council: 'Chato DC',
      ward: 'Nyamirembe',
      status: 'Operating',
      source: 'import',
    });
  });

  it('gives an imported row NO local code — a national register has no concept of one', () => {
    const r = csv('national_code,name\n122023-5,BAHEBE\n');
    expect(r.records[0].localCode).toBeUndefined();
  });

  it('⛔ REPORTS unknown columns and yields NO records, rather than silently dropping them', () => {
    // This is the whole reason the rule exists: parseTermsCsv's docblock claims extra columns reach
    // properties while the code keeps three and discards the rest, so an import "succeeds" having
    // lost half the data. A silent success that lost data is the worst outcome available.
    const r = csv('national_code,name,favourite_colour,mystery\n122023-5,BAHEBE,blue,x\n');
    expect(r.unknownColumns).toEqual(['favourite_colour', 'mystery']);
    expect(r.records).toEqual([]);
  });

  it('imports anyway when unknown columns are explicitly allowed, keeping them in extras', () => {
    const r = parseFacilityCsv('national_code,name,favourite_colour\n122023-5,BAHEBE,blue\n', {
      nationalSystem: HFR, allowUnknownColumns: true,
    });
    expect(r.unknownColumns).toEqual(['favourite_colour']);
    expect(r.records[0].extras).toEqual({ favourite_colour: 'blue' });
  });

  it('skips rows missing a required field and counts them, rather than failing the whole file', () => {
    const r = csv('national_code,name\n122023-5,BAHEBE\n,NO CODE\n999-9,\n');
    expect(r.records).toHaveLength(1);
    expect(r.skipped).toBe(2);
  });

  it('parses coordinates as numbers and leaves blanks null', () => {
    const r = csv('national_code,name,latitude,longitude\n122023-5,BAHEBE,-2.6,32.1\n120264-7,MATONDO,,\n');
    expect(r.records[0]).toMatchObject({ latitude: -2.6, longitude: 32.1 });
    expect(r.records[1].latitude).toBeNull();
  });

  it('generates a stable id from the national system and code, so re-import updates in place', () => {
    const a = csv('national_code,name\n122023-5,BAHEBE\n').records[0];
    const b = csv('national_code,name\n122023-5,BAHEBE RENAMED\n').records[0];
    expect(a.id).toBe(b.id);
  });

  it('exposes a template whose header matches what the parser accepts', () => {
    const r = parseFacilityCsv(FACILITY_CSV_TEMPLATE, { nationalSystem: HFR });
    expect(r.unknownColumns).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --dir packages/terminology/src facility-csv`
Expected: FAIL — `Cannot find module './facility-csv'`.

- [ ] **Step 3: Write the parser**

Create `packages/terminology/src/facility-csv.ts`:

```typescript
import { createHash } from 'node:crypto';
import { parse as parseCsvSync } from 'csv-parse/sync';
import type { FacilityRecord } from '@openldr/db';

/** The documented import contract. Country-agnostic: whoever obtains a national list maps their
 *  columns onto these once. */
const REQUIRED = ['national_code', 'name'] as const;
const OPTIONAL = [
  'level', 'ownership', 'status',
  'country', 'zone', 'region', 'district', 'council', 'ward', 'village',
  'address', 'phone', 'latitude', 'longitude',
] as const;
const KNOWN = new Set<string>([...REQUIRED, ...OPTIONAL]);

export const FACILITY_CSV_TEMPLATE =
  'national_code,name,level,ownership,status,country,zone,region,district,council,ward,village,address,phone,latitude,longitude\n';

export interface FacilityCsvOptions {
  /** Which national register these codes belong to. Configuration, never hardcoded. */
  nationalSystem: string;
  /** Import despite unrecognised columns, carrying them into `extras`. */
  allowUnknownColumns?: boolean;
}

export interface FacilityCsvResult {
  records: FacilityRecord[];
  /** Columns the contract does not define. Non-empty ⇒ nothing imported unless explicitly allowed. */
  unknownColumns: string[];
  /** Rows dropped for missing a required field. */
  skipped: number;
}

/** Stable id from the register + code, so re-importing a newer release UPDATES in place and any
 *  aliases attached to the row survive a rename. */
function idFor(nationalSystem: string, nationalCode: string): string {
  return `fac-${createHash('sha256').update(`${nationalSystem}|${nationalCode}`).digest('hex').slice(0, 16)}`;
}

const text = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

const num = (v: string | undefined): number | null => {
  const t = (v ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Parse a national facility CSV.
 *
 * ⛔ Unknown columns FAIL the file rather than being dropped. `parseTermsCsv` in this same package
 * does the opposite — its docblock promises "extra columns go to properties" while the code keeps
 * exactly three and silently discards the rest — so an import reports success having lost half the
 * data. That is the worst available outcome, and this parser deliberately does not repeat it.
 */
export function parseFacilityCsv(csv: string, opts: FacilityCsvOptions): FacilityCsvResult {
  const rows = parseCsvSync(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  const headers = rows.length > 0 ? Object.keys(rows[0]) : csvHeader(csv);
  const unknownColumns = headers.filter((h) => h !== '' && !KNOWN.has(h));

  if (unknownColumns.length > 0 && !opts.allowUnknownColumns) {
    return { records: [], unknownColumns, skipped: 0 };
  }

  let skipped = 0;
  const records: FacilityRecord[] = [];
  for (const r of rows) {
    const nationalCode = text(r.national_code);
    const name = text(r.name);
    if (!nationalCode || !name) { skipped += 1; continue; }

    const extras: Record<string, unknown> = {};
    for (const col of unknownColumns) {
      const v = text(r[col]);
      if (v !== null) extras[col] = v;
    }

    records.push({
      id: idFor(opts.nationalSystem, nationalCode),
      nationalSystem: opts.nationalSystem,
      nationalCode,
      name,
      level: text(r.level),
      ownership: text(r.ownership),
      status: text(r.status),
      country: text(r.country),
      zone: text(r.zone),
      region: text(r.region),
      district: text(r.district),
      council: text(r.council),
      ward: text(r.ward),
      village: text(r.village),
      addressText: text(r.address),
      phone: text(r.phone),
      latitude: num(r.latitude),
      longitude: num(r.longitude),
      extras: Object.keys(extras).length > 0 ? extras : undefined,
      // Imported rows are central-managed and replaceable by down-sync; lab-local rows are not.
      managedOrigin: 'central',
      source: 'import',
    });
  }
  return { records, unknownColumns, skipped };
}

/** Header of a file with no data rows — `csv-parse` yields nothing to read keys from. */
function csvHeader(csv: string): string[] {
  const first = csv.split(/\r?\n/, 1)[0] ?? '';
  return first.split(',').map((h) => h.trim());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --dir packages/terminology/src facility-csv`
Expected: PASS, 8 tests.

- [ ] **Step 5: Export it**

In `packages/terminology/src/index.ts`, add beside the other exports:

```typescript
export * from './facility-csv';
```

- [ ] **Step 6: Verify the dependency direction**

`@openldr/terminology` must already depend on `@openldr/db` for this import to resolve.

Run: `grep '"@openldr/db"' packages/terminology/package.json`
Expected: a `workspace:*` line. If ABSENT, do **not** add the dependency — instead move `facility-csv.ts` to `packages/db/src/` and adjust the imports and export site accordingly, because `@openldr/db` must not gain a dependency on `@openldr/terminology` (that would invert the direction).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p packages/terminology/tsconfig.json`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add packages/terminology/src/facility-csv.ts packages/terminology/src/facility-csv.test.ts packages/terminology/src/index.ts
git commit -m "feat(terminology): facility CSV import contract that refuses to drop columns"
```

---

## Task 5: Gate and merge

**Files:** none.

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 67 successful, 67 total`.

⚠ If a package you did not touch fails, run it alone before blaming this work — parallel-turbo flakes are documented and a re-run is usually green. `grep 'Test timed out'` in the output distinguishes a timeout from a real failure.

- [ ] **Step 2: Merge to local main**

```bash
git checkout main
git merge --no-ff slice/facility-registry-slice-1 -m "Merge: facility registry slice 1 (model, store, importer)"
git branch -d slice/facility-registry-slice-1
```

- [ ] **Step 3: Report what is NOT done**

Slice 1 delivers the model, the store and the parser. Explicitly still missing, and none of it should be claimed: the Facilities page, the reconciliation screen, the CLI import command, the sync wiring (`facility_registry` is in `ENTITY_TYPES` but nothing serves or applies it yet — `sync-serve.ts`'s `fetchReferenceBody` and `reference-apply.ts` both need a case), and rewiring `q-facilities` / `q-amr-facility-summary`.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 model, §2.1 identifiers, §2.2 hierarchy | Task 1, Task 2 |
| §3 import contract, §3.1 unknown columns, §3.2 upsert | Task 4 |
| §4 national system is configuration | Task 4 (`nationalSystem` is a required option) |
| §5 reconciliation (store primitives only) | Task 3 (`attachAlias`/`resolve`); the SCREEN is out of slice |
| §6 relationship to `facilities` | Task 1 migration comment |
| §7 Users pattern / `extras` | Task 1 (`extras` column), Task 2, Task 3 |
| §8 sync direction | Task 3 (capture on registry, none on aliases) + Task 5's not-done list |
| §8.1 overwrite trap | Task 1 (`managed_origin`) |

**Deliberately deferred, with reasons:** the Facilities page and reconciliation screen (UI, needs the store first); the CLI command (thin wrapper over Task 4, no design risk); sync serve/apply cases (belong with the sync slice, which needs a central to test against).

**Type consistency:** `FacilityRecord` is defined once in Task 3 and consumed by Task 4; `attachAlias` takes a `FacilityAlias` object in both the interface and the tests; `resolve(sourceSystem, sourceCode)` is positional in both. `source_code` is used throughout — never `local_code` — for the alias column.
