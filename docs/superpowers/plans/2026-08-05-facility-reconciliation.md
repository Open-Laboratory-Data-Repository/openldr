# Facility Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** map the facility strings arriving in ingested data to canonical `facility_registry` rows, using CE's existing coding-system + concept-mapping machinery, and publish the result to the warehouse so reports can print real names.

**Architecture:** observed `diagnostic_reports.performer` strings are captured verbatim as concepts in a local coding system (`urn:openldr:default_fac`); an operator maps them in the shipped `TermMappingDialog` to either a registry facility or a national code; a re-runnable publish flattens the resolved chain into a new external warehouse table (`facility_map`) that report SQL left-joins. Nothing ingested is ever rewritten.

**Tech Stack:** TypeScript, Kysely, Fastify, React + shadcn/ui, vitest, pg-mem (internal tests), Postgres/MSSQL/MySQL (warehouse).

**Spec:** `docs/superpowers/specs/2026-08-05-facility-reconciliation-design.md`

## Global Constraints

- **Internal migration number: `074`.** `073_facility_country_and_admin_fields` is the last one (`packages/db/src/migrations/internal/index.ts`).
- **External migration number: `012`.** `011_terminology_codes` is the last one (`packages/db/src/migrations/external/index.ts`).
- **⛔ `packages/db/src/migrations/migrations.test.ts` pins BOTH migration lists as exact arrays** — internal at line 7, external at line 15. It lives one directory ABOVE `migrations/internal`, so a task-scoped `--dir` test run will NOT see it. Slice 1 was caught by this; do not repeat it.
- **⛔ The concept code is the observed string byte-for-byte.** No `.toUpperCase()`, no case folding, no fuzzy matching, ever. openldr-v2 upper-cased (`default.schema.js:16-19`) because there the upper-cased value *was* the stored value; in CE `diagnostic_reports.performer` stores `Dodoma` verbatim and `DODOMA` would silently never join.
- **⛔ External-migration portability:** use `keyType` for any PRIMARY KEY or indexed column and `textType` only for free text (`packages/db/src/migrations/external/dialect.ts`). `textType` is `nvarchar(max)`/`longtext` and **cannot be a key** — MSSQL refuses LOB index keys, MySQL needs a prefix length (error 1170). ⚠ **Every external migration test runs Postgres via pg-mem, so engine-portability bugs are invisible to the gate.**
- **`terminology_concepts` PK is `(system, code)`.** Columns: `system, code, display, status, properties` (jsonb).
- **`term_mappings` is authoritative**, `concept_map_elements` @ `LOCAL_MAP_URL` is its mirror. The resolver reads `term_mappings` — only it carries `is_active` and `to_display`. Columns: `id, from_system, from_code, to_system, to_code, to_display, map_type, relationship, owner, is_active, created_at, updated_at, managed_origin`.
- **Three named identifiers**, exactly as spelled here:
  - `urn:openldr:default_fac` — observed-facility coding system (default; one per feed)
  - `urn:openldr:cs:facility-registry` — one concept per `facility_registry` row
  - `facility_map` — the external warehouse dimension. ⛔ NOT `facilities`, which already exists as the uncurated projection of ingested Organization/Location.
- **UI conventions (non-negotiable):** every action in a `⋯ DropdownMenu`, never standalone/footer buttons; shadcn controls only, never native `<select>`; edge-to-edge dividers; `TruncatedText` for clipped labels; `StripedEmpty`/`LoadingState` for empty and loading states.
- **Commits:** never `git add -A` (this directory is shared with concurrent sessions) — exact paths only. Never add a `Co-Authored-By` trailer.
- **Gate:** `pnpm turbo run typecheck test --force --concurrency=6` must be 67/67. Turbo's default concurrency oversubscribes 12 cores and produces false timeout failures.
- **Branch:** work on `slice/facility-reconciliation`, merge `--no-ff` to LOCAL `main`. Do not push.

---

## File Structure

**Create:**
- `packages/db/src/migrations/external/012_facility_map.ts` — the warehouse dimension
- `packages/db/src/migrations/external/012_facility_map.test.ts`
- `packages/db/src/migrations/internal/074_drop_facility_aliases.ts`
- `packages/db/src/migrations/internal/074_drop_facility_aliases.test.ts`
- `packages/db/src/facility-observed.ts` — pure shaping + the three system constants. **Dependency-free** (no `kysely`, no `pg`) so `apps/studio` can import it, mirroring `@openldr/db/facility-answers`.
- `packages/db/src/facility-observed.test.ts`
- `packages/bootstrap/src/facility-reconcile.ts` — `scanObservedFacilities` + `publishFacilityMap` + `resolveObservedFacilities`
- `packages/bootstrap/src/facility-reconcile.test.ts`
- `apps/studio/src/facilities/ObservedTab.tsx`
- `apps/studio/src/facilities/ObservedTab.test.tsx`

**Modify:**
- `packages/db/src/migrations/external/index.ts` — register `012`
- `packages/db/src/migrations/internal/index.ts` — register `074`
- `packages/db/src/migrations/migrations.test.ts:7,15` — both pinned lists
- `packages/db/src/schema/external.ts` — `FacilityMapTable` + `ExternalSchema` entry
- `packages/db/src/schema/internal.ts` — remove `facility_aliases`
- `packages/db/src/facility-registry-store.ts` — remove `attachAlias`/`detachAlias`/`resolve`/`listAliases` + `FacilityAlias`
- `packages/db/src/facility-registry-store.test.ts` — remove their tests
- `packages/db/src/index.ts` — export `facility-observed` surface, drop `FacilityAlias`
- `packages/bootstrap/src/index.ts` — export the new functions; wire the ingest hook near `createProjectionRunner` (line 960)
- `apps/server/src/facilities-routes.ts` — observed list, scan, publish, delete impact
- `packages/cli/src/facilities.ts` + `packages/cli/src/program.ts` — two new commands
- `apps/studio/src/pages/Facilities.tsx` — tabs
- `apps/studio/src/i18n/*` — new strings (en/fr/pt)

---

### Task 1: The warehouse dimension (external migration 012)

**Files:**
- Create: `packages/db/src/migrations/external/012_facility_map.ts`
- Create: `packages/db/src/migrations/external/012_facility_map.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/schema/external.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts:15`

**Interfaces:**
- Produces: table `facility_map` with columns `id, source_system, source_code, registry_id, name, level, status, region, district, council, national_system, national_code, resolved_via, updated_at`. `FacilityMapTable` on `ExternalSchema`.

**⛔ Why `id` is synthetic and not a composite PK.** A composite `(source_system, source_code)` primary key would be two `keyType` columns. `keyType` is `varchar(255)` on MySQL and `nvarchar(255)` on MSSQL; MSSQL's index key limit is 900 **bytes**, and two nvarchar(255) columns are up to 1020 bytes — the table would create on Postgres and pg-mem and fail on MSSQL, which no test in this repo can see. `011_terminology_codes` made exactly this decision for exactly this reason; read its file-level comment before writing this one.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/external/012_facility_map.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-support/external-db';
import { sql } from 'kysely';

describe('012_facility_map', () => {
  it('creates facility_map and round-trips a resolved row', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into facility_map
      (id, source_system, source_code, registry_id, name, resolved_via)
      values ('webhook-ingest|Dodoma', 'webhook-ingest', 'Dodoma', 'fac-1',
              'Dodoma Regional Referral Hospital', 'registry')`.execute(db);
    const rows = await sql<{ name: string; source_code: string }>`
      select name, source_code from facility_map`.execute(db);
    expect(rows.rows).toEqual([
      { name: 'Dodoma Regional Referral Hospital', source_code: 'Dodoma' },
    ]);
  });
});
```

⚠ **SKETCH — verify the helper name and import path first.** `terminology-projection-fanout` records it as `makeMigratedExternalDb()` calling `externalMigrations('postgres')`, but its file location is not confirmed. Run `grep -rn "makeMigratedExternalDb" --include=*.ts packages/db/src | head -3` and use the real path.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm vitest run src/migrations/external/012_facility_map.test.ts`
Expected: FAIL — `relation "facility_map" does not exist`.

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/external/012_facility_map.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, timestampType, nowExpr } from './dialect';

// The resolved facility dimension. `facility_registry` and `term_mappings` live in the INTERNAL db
// while `diagnostic_reports.performer` lives here in the warehouse, so a report cannot resolve a
// performing laboratory unless the resolution is projected here — the same constraint
// 011_terminology_codes documents for terminology.
//
// One row per (source_system, source_code) — i.e. per observed facility string per feed.
//
// `id` is synthetic (`<source_system>|<source_code>`, hashed when long) rather than a composite
// primary key on those two columns: both are `keyType` (varchar/nvarchar(255)), and MSSQL's 900-BYTE
// index key limit cannot hold two of them (up to 1020 bytes as nvarchar). It must be DETERMINISTIC
// because a re-publish recomputes it.
//
// ⛔ NOT the same table as `facilities` — that is the uncurated projection of ingested
// Organization/Location resources. These two look joinable and are not.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  let built = db.schema.createTable('facility_map')
    .addColumn('id', key, (c) => c.primaryKey())
    // Indexed below — the join predicate is (source_system, source_code), so both are keyType.
    .addColumn('source_system', key)
    .addColumn('source_code', key)
    // The resolved facility. NULL is a legitimate, meaningful state: the string was observed but is
    // not mapped, or its mapping's target no longer exists. A report falls back to the raw string.
    .addColumn('registry_id', text)
    .addColumn('name', text)
    .addColumn('level', text)
    .addColumn('status', text)
    .addColumn('region', text)
    .addColumn('district', text)
    .addColumn('council', text)
    .addColumn('national_system', text)
    .addColumn('national_code', text)
    // 'registry' | 'national' | null — which route resolved this row. Lets the Observed tab and any
    // future audit explain a name rather than merely assert it.
    .addColumn('resolved_via', text)
    .addColumn('updated_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  // Mirrors 001_flat_tables' withCommon: facility names carry diacritics, and a self-hosted
  // MySQL/MariaDB may default to latin1/utf8mb3.
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  await built.execute();
  // Every report join filters on both columns together.
  await db.schema.createIndex('facility_map_source_idx')
    .on('facility_map').columns(['source_system', 'source_code']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('facility_map').execute();
}
```

- [ ] **Step 4: Register it**

In `packages/db/src/migrations/external/index.ts`, add the import after `m011` and the entry after `'011_terminology_codes'`:

```ts
import * as m012 from './012_facility_map';
```
```ts
    '012_facility_map': { up: (db) => m012.up(db, engine), down: m012.down },
```

- [ ] **Step 5: Add the schema type**

In `packages/db/src/schema/external.ts`, add the interface and the `ExternalSchema` entry:

```ts
export interface FacilityMapTable {
  id: string;
  source_system: string;
  source_code: string;
  registry_id: string | null;
  name: string | null;
  level: string | null;
  status: string | null;
  region: string | null;
  district: string | null;
  council: string | null;
  national_system: string | null;
  national_code: string | null;
  resolved_via: string | null;
  updated_at: Generated<Date>;
}
```
```ts
  facility_map: FacilityMapTable;
```

- [ ] **Step 6: Update the pinned migration list**

In `packages/db/src/migrations/migrations.test.ts:15`, append `'012_facility_map'` to the external array.

- [ ] **Step 7: Run the tests**

Run: `cd packages/db && pnpm vitest run src/migrations/`
Expected: PASS, including `migrations.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/external/012_facility_map.ts packages/db/src/migrations/external/012_facility_map.test.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): add facility_map warehouse dimension (external 012)"
```

---

### Task 2: Observed-facility constants and pure shaping

**Files:**
- Create: `packages/db/src/facility-observed.ts`
- Create: `packages/db/src/facility-observed.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_OBSERVED_FACILITY_SYSTEM = 'urn:openldr:default_fac'`
  - `FACILITY_REGISTRY_SYSTEM = 'urn:openldr:cs:facility-registry'`
  - `observedFacilityConceptRow(input: ObservedFacilityInput): ConceptRowInput`
  - `facilityMapId(sourceSystem: string, sourceCode: string): string`
  - types `ObservedFacilityInput`, `ConceptRowInput`, `ObservedFacilityProperties`

**⛔ This file must stay dependency-free** — no `kysely`, no `pg`, no `@openldr/forms`. `apps/studio` imports it for the Observed tab, exactly as it imports `@openldr/db/facility-answers`. Add a test that fails if a runtime import lands here, mirroring the one that already guards `facility-answers`. ⚠ Run `grep -rn "facility-answers" packages/db/package.json packages/db/src/*.test.ts | head` to find the existing guard and the `exports` subpath pattern to copy.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/facility-observed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OBSERVED_FACILITY_SYSTEM,
  FACILITY_REGISTRY_SYSTEM,
  observedFacilityConceptRow,
  facilityMapId,
} from './facility-observed';

describe('facility-observed', () => {
  it('uses the established urn:openldr naming', () => {
    expect(DEFAULT_OBSERVED_FACILITY_SYSTEM).toBe('urn:openldr:default_fac');
    expect(FACILITY_REGISTRY_SYSTEM).toBe('urn:openldr:cs:facility-registry');
  });

  // ⛔ The load-bearing assertion of this whole slice. Equality against the exact mixed-case
  // string is what makes it able to fail: a case-insensitive comparison would pass against the
  // very bug it exists to catch.
  it('keeps the observed string byte-for-byte as the concept code', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'Ocean Road Cancer Institute (O',
      seenAt: '2026-08-05T00:00:00.000Z',
      reportCount: 6,
    });
    expect(row.code).toBe('Ocean Road Cancer Institute (O');
    expect(row.display).toBe('Ocean Road Cancer Institute (O');
    expect(row.status).toBe('ACTIVE');
  });

  it('does not upper-case, unlike openldr-v2 normalizeCode', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'Dodoma',
      seenAt: '2026-08-05T00:00:00.000Z',
      reportCount: 247,
    });
    expect(row.code).toBe('Dodoma');
    expect(row.code).not.toBe('DODOMA');
  });

  it('records provenance in properties', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'HYDOH',
      seenAt: '2026-08-05T00:00:00.000Z',
      reportCount: 99,
    });
    expect(row.properties).toEqual({
      firstSeen: '2026-08-05T00:00:00.000Z',
      lastSeen: '2026-08-05T00:00:00.000Z',
      reportCount: 99,
    });
  });

  it('preserves firstSeen and a curated display when merging over an existing concept', () => {
    const row = observedFacilityConceptRow({
      system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      code: 'HYDOH',
      seenAt: '2026-08-06T00:00:00.000Z',
      reportCount: 104,
      existing: {
        display: 'Hydom Lutheran Hospital',
        properties: { firstSeen: '2026-08-01T00:00:00.000Z', lastSeen: '2026-08-05T00:00:00.000Z', reportCount: 99 },
      },
    });
    expect(row.display).toBe('Hydom Lutheran Hospital');
    expect(row.properties).toEqual({
      firstSeen: '2026-08-01T00:00:00.000Z',
      lastSeen: '2026-08-06T00:00:00.000Z',
      reportCount: 104,
    });
  });

  it('derives a deterministic, bounded facility_map id', () => {
    expect(facilityMapId('webhook-ingest', 'Dodoma')).toBe('webhook-ingest|Dodoma');
    expect(facilityMapId('webhook-ingest', 'Dodoma')).toBe(facilityMapId('webhook-ingest', 'Dodoma'));
    const long = facilityMapId('webhook-ingest', 'x'.repeat(400));
    expect(long.length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm vitest run src/facility-observed.test.ts`
Expected: FAIL — `Cannot find module './facility-observed'`.

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/facility-observed.ts`:

```ts
/**
 * Observed-facility reconciliation: the constants and the pure row shaping.
 *
 * ⛔ DEPENDENCY-FREE ON PURPOSE. `apps/studio` imports this module (see the Observed tab), exactly
 * as it imports `./facility-answers`. A runtime import of `kysely`/`pg` here would pull the whole
 * database layer into the browser bundle.
 */

/**
 * The default coding system for facility strings observed in ingested data.
 *
 * Named after openldr-v2's `SYSTEMS.FACILITY = 'DEFAULT_FAC'`, in CE's established
 * `urn:openldr:default_<x>` form (see `@openldr/terminology`'s `SITE_ORGANISM_SYSTEM` and
 * `RESULT_PARAM_SYSTEM`).
 *
 * ⛔ SITE-SPECIFIC — never seeded into CE, for the reason the organism dictionary's loader already
 * states about itself: one deployment's vocabulary shipped as a product default makes every other
 * deployment silently wrong. A second feed gets its OWN system rather than colliding here.
 */
export const DEFAULT_OBSERVED_FACILITY_SYSTEM = 'urn:openldr:default_fac';

/** One concept per `facility_registry` row, so `TermMappingDialog`'s search mode has something to
 *  pick. The concept `code` is the registry row's `id` — neither `local_code` (NULL on every
 *  imported row) nor `national_code` (NULL on hand-created rows) is universally present; the
 *  table's only guarantee is the `facility_registry_has_a_code` CHECK that at least one exists. */
export const FACILITY_REGISTRY_SYSTEM = 'urn:openldr:cs:facility-registry';

/** Bounded so the derived `facility_map.id` fits `keyType` (varchar(255)) on MySQL/MSSQL. */
const MAX_ID_LENGTH = 200;

export interface ObservedFacilityProperties {
  firstSeen: string;
  lastSeen: string;
  reportCount: number;
}

export interface ObservedFacilityInput {
  system: string;
  /** The performer string EXACTLY as it arrived. Never normalised. */
  code: string;
  /** ISO timestamp of this observation. Passed in, never read from a clock, so the shaping is pure
   *  and testable. */
  seenAt: string;
  reportCount: number;
  /** The already-stored concept, when re-scanning. */
  existing?: { display: string | null; properties: Record<string, unknown> | null };
}

export interface ConceptRowInput {
  system: string;
  code: string;
  display: string | null;
  status: string;
  properties: Record<string, unknown> | null;
}

/**
 * Shape one observed facility string into a `terminology_concepts` row.
 *
 * ⛔ `code` is `input.code` verbatim — no trimming, no case folding. It is a match KEY against
 * `diagnostic_reports.performer`, not a name. openldr-v2 upper-cased its codes; that was safe only
 * because there the upper-cased value WAS the stored value.
 *
 * A re-scan must not destroy operator work: an existing `display` is preserved (the operator may
 * have curated it) and `firstSeen` is carried forward. Only `lastSeen` and `reportCount` advance.
 */
export function observedFacilityConceptRow(input: ObservedFacilityInput): ConceptRowInput {
  const prior = (input.existing?.properties ?? null) as Partial<ObservedFacilityProperties> | null;
  const firstSeen = typeof prior?.firstSeen === 'string' ? prior.firstSeen : input.seenAt;
  return {
    system: input.system,
    code: input.code,
    display: input.existing?.display ?? input.code,
    status: 'ACTIVE',
    properties: { firstSeen, lastSeen: input.seenAt, reportCount: input.reportCount },
  };
}

/**
 * Deterministic id for a `facility_map` row. Deterministic because a re-publish recomputes it —
 * a non-deterministic id would duplicate every row on rebuild instead of replacing it.
 *
 * Readable while it fits, hashed when it does not, mirroring `terminology_codes`' synthetic key.
 */
export function facilityMapId(sourceSystem: string, sourceCode: string): string {
  const readable = `${sourceSystem}|${sourceCode}`;
  if (readable.length <= MAX_ID_LENGTH) return readable;
  return `fm-${djb2Hex(readable)}`;
}

/** A tiny, dependency-free stable hash — `node:crypto` would break this module's browser-safety. */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${s.length.toString(16)}`;
}
```

⚠ **Note on `djb2Hex`:** it is a collision-tolerant readability fallback for pathologically long strings, not a security primitive. Today the longest observed code is 30 characters, so this branch is unreachable on real data. If the implementer prefers, mirror `terminology_codes`' sha1 approach instead — but only if it can be done without a runtime `node:crypto` import, or this module stops being browser-safe and the Observed tab cannot import it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && pnpm vitest run src/facility-observed.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Export it**

Add to `packages/db/src/index.ts`, next to the existing `facility-answers` re-export:

```ts
export { DEFAULT_OBSERVED_FACILITY_SYSTEM, FACILITY_REGISTRY_SYSTEM, observedFacilityConceptRow, facilityMapId } from './facility-observed';
export type { ObservedFacilityInput, ObservedFacilityProperties, ConceptRowInput } from './facility-observed';
```

Add the `./facility-observed` subpath to `packages/db/package.json`'s `exports`, copying the shape of the existing `./facility-answers` entry verbatim.

- [ ] **Step 6: Typecheck and commit**

Run: `cd packages/db && pnpm typecheck`
Expected: no errors.

```bash
git add packages/db/src/facility-observed.ts packages/db/src/facility-observed.test.ts packages/db/src/index.ts packages/db/package.json
git commit -m "feat(db): observed-facility constants and pure concept shaping"
```

---

### Task 3: The re-runnable discovery scan

**Files:**
- Create: `packages/bootstrap/src/facility-reconcile.ts`
- Create: `packages/bootstrap/src/facility-reconcile.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (export only)

**Interfaces:**
- Consumes: `DEFAULT_OBSERVED_FACILITY_SYSTEM`, `observedFacilityConceptRow` (Task 2).
- Produces:
  ```ts
  export interface ReconcileDeps {
    internalDb: Kysely<InternalSchema>;
    externalDb: Kysely<ExternalSchema>;
    admin: TerminologyAdminStore;
  }
  export interface ScanResult {
    discovered: number;  // distinct performer values seen in the warehouse
    created: number;     // concepts that did not exist before
    updated: number;     // concepts whose lastSeen/reportCount advanced
    systemRegistered: boolean;
  }
  export function scanObservedFacilities(
    deps: ReconcileDeps,
    opts?: { system?: string; now?: string; apply?: boolean },
  ): Promise<ScanResult>;
  ```

**⛔ The trap this task exists to avoid.** `terminology_concepts` holds 646 concepts for `urn:openldr:default_org` and 83 for `urn:openldr:default_result`, and **neither has a `coding_systems` row** — the loaders in `@openldr/terminology` never create one. `TermMappingDialog` builds its system dropdown from `systems.filter((s) => s.active)` (`apps/studio/src/terminology/TermMappingDialog.tsx:137`), i.e. `coding_systems` rows. A dictionary built the way the organism dictionary was built would populate concepts **nobody can select as a mapping source or target**, and the entire "reuse the shipped UI" premise fails silently.

⚠ `codingSystems.upsertByUrl` inserts `active: true` but its `onConflict` update sets only `system_name`/`system_version`/`publisher_id` (`packages/db/src/terminology-admin-store.ts:470-478`) — it never re-activates a row that already exists with `active = false`. The assertion below must check the **flag**, not merely the row.

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/facility-reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scanObservedFacilities } from './facility-reconcile';
import { makeReconcileDeps, seedPerformers } from './test-support/facility-reconcile-fixture';

describe('scanObservedFacilities', () => {
  it('discovers distinct performers and creates concepts', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247], ['HYDOH', 99]]);

    const result = await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    expect(result).toMatchObject({ discovered: 2, created: 2, updated: 0 });
    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['Dodoma', 'HYDOH']);
  });

  // ⛔ THE trap. Must fail if `active` is false, not merely if the row is absent.
  it('registers an ACTIVE coding_systems row so the mapping UI can see the system', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247]]);

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const cs = await deps.admin.codingSystems.getByUrl('urn:openldr:default_fac');
    expect(cs).not.toBeNull();
    expect(cs!.active).toBe(true);
  });

  it('is idempotent and preserves a curated display on re-scan', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['HYDOH', 99]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    await deps.admin.terms.update('urn:openldr:default_fac', 'HYDOH', {
      system: 'urn:openldr:default_fac', code: 'HYDOH',
      display: 'Hydom Lutheran Hospital', status: 'ACTIVE',
    } as never);
    await seedPerformers(deps, [['HYDOH', 104]]);

    const second = await scanObservedFacilities(deps, { now: '2026-08-06T00:00:00.000Z', apply: true });

    expect(second).toMatchObject({ discovered: 1, created: 0, updated: 1 });
    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].display).toBe('Hydom Lutheran Hospital');
  });

  it('writes nothing when apply is falsy but still reports what it found', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247]]);

    const dry = await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z' });

    expect(dry).toMatchObject({ discovered: 1, created: 1 });
    const { total } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(total).toBe(0);
  });

  it('ignores null performers', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1], [null, 5]]);

    const result = await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    expect(result.discovered).toBe(1);
  });
});
```

⚠ **SKETCH — the fixture does not exist yet.** Create `packages/bootstrap/src/test-support/facility-reconcile-fixture.ts` exporting `makeReconcileDeps()` (a pg-mem internal db migrated with `internalMigrations`, a pg-mem external db migrated with `externalMigrations('postgres')`, and `createTerminologyAdminStore(internalDb)`) and `seedPerformers(deps, pairs)` (inserts `pairs.length` groups of `diagnostic_reports` rows with the given `performer` and row count, `source_system: 'webhook-ingest'`). **Copy the pg-mem setup from an existing bootstrap test rather than inventing it** — run `grep -rln "pg-mem\|newDb" packages/bootstrap/src/*.test.ts | head -3` and follow the established pattern. Also verify `terms.update`'s real `TermInput` shape before writing the third test; the cast above is a placeholder.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/bootstrap && pnpm vitest run src/facility-reconcile.test.ts`
Expected: FAIL — `Cannot find module './facility-reconcile'`.

- [ ] **Step 3: Write the implementation**

Create `packages/bootstrap/src/facility-reconcile.ts`:

```ts
import type { Kysely } from 'kysely';
import type { ExternalSchema, InternalSchema, TerminologyAdminStore } from '@openldr/db';
import { DEFAULT_OBSERVED_FACILITY_SYSTEM, observedFacilityConceptRow } from '@openldr/db';

export interface ReconcileDeps {
  internalDb: Kysely<InternalSchema>;
  externalDb: Kysely<ExternalSchema>;
  admin: TerminologyAdminStore;
}

export interface ScanResult {
  discovered: number;
  created: number;
  updated: number;
  systemRegistered: boolean;
}

export interface ScanOptions {
  /** Which coding system these codes belong to. One per FEED; defaults to the site default. */
  system?: string;
  /** ISO timestamp for this scan. Injected rather than read from a clock so the result is testable. */
  now?: string;
  /** The caller opts IN to writing, mirroring `importFacilities` and `openldr facilities import`. */
  apply?: boolean;
}

/**
 * Discover the distinct facility strings present in the warehouse and record them as concepts.
 *
 * Re-runnable by construction, which is a hard requirement: new performer values arrive with every
 * ingest. It is NOT redundant with the ingest hook — it does three things the hook structurally
 * cannot. It backfills historical rows (a hook only ever sees new data); it computes `reportCount`,
 * which is an aggregate over the warehouse the hook cannot see from one row; and it repairs any gap
 * (a hook added after data landed, a failed cycle, a restored database).
 */
export async function scanObservedFacilities(deps: ReconcileDeps, opts: ScanOptions = {}): Promise<ScanResult> {
  const system = opts.system ?? DEFAULT_OBSERVED_FACILITY_SYSTEM;
  const now = opts.now ?? new Date().toISOString();

  const observed = await deps.externalDb
    .selectFrom('diagnostic_reports')
    .select(({ fn }) => ['performer', fn.countAll<number>().as('n')])
    .where('performer', 'is not', null)
    .groupBy('performer')
    .execute();

  const existing = new Map<string, { display: string | null; properties: Record<string, unknown> | null }>();
  const page = await deps.admin.terms.search(system, { limit: 10_000, offset: 0 });
  for (const t of page.rows) {
    existing.set(t.code, { display: t.display, properties: null });
  }

  const rows = observed
    .filter((o) => o.performer !== null)
    .map((o) =>
      observedFacilityConceptRow({
        system,
        code: o.performer as string,
        seenAt: now,
        reportCount: Number(o.n),
        existing: existing.get(o.performer as string),
      }),
    );

  const created = rows.filter((r) => !existing.has(r.code)).length;
  const result: ScanResult = {
    discovered: rows.length,
    created,
    updated: rows.length - created,
    systemRegistered: false,
  };

  if (!opts.apply) return result;

  // ⛔ MUST come before the concepts land, and MUST leave the row ACTIVE: TermMappingDialog builds
  // its system dropdown from active `coding_systems` rows, so concepts without one are invisible to
  // the operator who has to map them. `upsertByUrl` inserts `active: true` but never re-activates
  // an existing inactive row, so repair that explicitly.
  await deps.admin.codingSystems.upsertByUrl({
    url: system,
    systemCode: 'DEFAULT_FAC',
    systemName: 'Observed facilities',
    publisherId: 'pub-system',
  });
  const cs = await deps.admin.codingSystems.getByUrl(system);
  if (cs && !cs.active) {
    await deps.internalDb.updateTable('coding_systems').set({ active: true }).where('url', '=', system).execute();
  }
  result.systemRegistered = true;

  if (rows.length > 0) await deps.admin.terms.importRows(rows);

  return result;
}
```

⚠ **SKETCH — three things to verify against the real files before accepting this:**
1. `admin.terms.search` returns `Term` objects whose `properties` are unpacked into named fields (`shortName`/`class`/`unit`/`metadata`), so `existing.properties` is set to `null` above and `firstSeen` will be re-stamped on every scan. **Either** read the raw `terminology_concepts` row for the prior `properties` instead of going through `terms.search`, **or** accept that `firstSeen` tracks the first *scan* rather than the first *sighting* and say so in a comment. Decide explicitly; do not leave it ambiguous.
2. `systemCode` must be unique — `upsertByUrl` derives the row id as `cs-url-${systemCode}`. `'DEFAULT_FAC'` is unused today (measured: only `FACILITY-TYPE` and `LOCAL` exist among `urn:openldr:*`), but a second feed's system needs a distinct `systemCode`. Derive it from the system url when `opts.system` is not the default.
3. Confirm `pub-system` is the right publisher id (measured present, `role: 'local'`).

- [ ] **Step 4: Run tests**

Run: `cd packages/bootstrap && pnpm vitest run src/facility-reconcile.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Export and commit**

Add to `packages/bootstrap/src/index.ts`:
```ts
export { scanObservedFacilities } from './facility-reconcile';
export type { ReconcileDeps, ScanResult, ScanOptions } from './facility-reconcile';
```

```bash
git add packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts packages/bootstrap/src/test-support/facility-reconcile-fixture.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): re-runnable observed-facility discovery scan"
```

---

### Task 4: Resolution and publish

**Files:**
- Modify: `packages/bootstrap/src/facility-reconcile.ts`
- Modify: `packages/bootstrap/src/facility-reconcile.test.ts`

**Interfaces:**
- Consumes: `ReconcileDeps` (Task 3), `FACILITY_REGISTRY_SYSTEM` / `facilityMapId` (Task 2), `facility_map` (Task 1).
- Produces:
  ```ts
  export type ResolvedVia = 'registry' | 'national';
  export interface ResolvedFacility {
    sourceSystem: string;
    sourceCode: string;
    registryId: string | null;
    name: string | null;
    level: string | null; status: string | null;
    region: string | null; district: string | null; council: string | null;
    nationalSystem: string | null; nationalCode: string | null;
    resolvedVia: ResolvedVia | null;
    /** True when a mapping exists but its target resolves to no live registry row. */
    targetMissing: boolean;
  }
  export function resolveObservedFacilities(deps: ReconcileDeps, opts?: { system?: string }): Promise<ResolvedFacility[]>;
  export function publishFacilityMap(deps: ReconcileDeps, opts?: { system?: string; sourceSystem?: string; apply?: boolean }): Promise<PublishResult>;
  export interface PublishResult { resolved: number; unmapped: number; targetMissing: number; written: number }
  ```

**Precedence, from spec §2.1 — implement exactly this order:**
1. A mapping whose `to_system` is `FACILITY_REGISTRY_SYSTEM` wins; its `to_code` is a `facility_registry.id`.
2. Otherwise a national mapping resolves by `facility_registry WHERE national_system = to_system AND national_code = to_code`.
3. If neither yields a live registry row, `resolvedVia` is `null` and `targetMissing` is true when a mapping existed.

⛔ Read mappings from **`term_mappings`**, not `concept_map_elements`. Only `term_mappings` carries `is_active`, and an inactive mapping must not resolve. Filter `where('is_active', '=', true)`.

⛔ **The publish is a full rebuild: DELETE then INSERT, never upsert.** All three dialect batch-upserts conflict on `id` and MSSQL caps at ~2000 bound parameters, so a `where id not in (...)` prune is unimplementable at register scale — the same reason `terminology_codes` is delete-then-insert. Wrap both in one transaction so a concurrent reader never sees the table empty.

- [ ] **Step 1: Write the failing tests**

Append to `packages/bootstrap/src/facility-reconcile.test.ts`:

```ts
import { resolveObservedFacilities, publishFacilityMap } from './facility-reconcile';
import { seedRegistry, seedMapping } from './test-support/facility-reconcile-fixture';

describe('resolveObservedFacilities', () => {
  it('resolves a registry-route mapping to the canonical name', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD', region: 'Dodoma' });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Dodoma',
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'fac-1',
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Dodoma Regional Referral Hospital');
    expect(row.resolvedVia).toBe('registry');
    expect(row.region).toBe('Dodoma');
    expect(row.targetMissing).toBe(false);
  });

  it('resolves a national-route mapping through (national_system, national_code)', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Muhimbili', 82]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-2', name: 'Muhimbili National Hospital', nationalSystem: 'urn:tz:hfr', nationalCode: 'TZ-001' });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Muhimbili',
      toSystem: 'urn:tz:hfr', toCode: 'TZ-001',
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Muhimbili National Hospital');
    expect(row.resolvedVia).toBe('national');
  });

  // ⛔ The operator chose "both targets allowed"; this pins the tiebreak so it can never be a coin flip.
  it('prefers the registry route when both mappings exist', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Mnazi Mmoja', 182]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-3', name: 'Mnazi Mmoja Hospital', localCode: 'MMH' });
    await seedRegistry(deps, { id: 'fac-4', name: 'Some Other Hospital', nationalSystem: 'urn:tz:hfr', nationalCode: 'TZ-999' });
    await seedMapping(deps, { fromSystem: 'urn:openldr:default_fac', fromCode: 'Mnazi Mmoja', toSystem: 'urn:tz:hfr', toCode: 'TZ-999' });
    await seedMapping(deps, { fromSystem: 'urn:openldr:default_fac', fromCode: 'Mnazi Mmoja', toSystem: 'urn:openldr:cs:facility-registry', toCode: 'fac-3' });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Mnazi Mmoja Hospital');
    expect(row.resolvedVia).toBe('registry');
  });

  it('reports an unmapped code as null, not blank', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Kibondo', 148]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBeNull();
    expect(row.resolvedVia).toBeNull();
    expect(row.targetMissing).toBe(false);
    expect(row.sourceCode).toBe('Kibondo');
  });

  it('flags targetMissing when the mapped facility was deleted', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Ocean Road Cancer Institute (O', 6]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Ocean Road Cancer Institute (O',
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'fac-deleted',
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.targetMissing).toBe(true);
    expect(row.name).toBeNull();
  });

  it('ignores an inactive mapping', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Dodoma',
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'fac-1', isActive: false,
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.resolvedVia).toBeNull();
  });
});

describe('publishFacilityMap', () => {
  it('writes resolved rows to the warehouse and re-publishes without duplicating', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247], ['Kibondo', 148]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Dodoma',
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'fac-1',
    });

    const first = await publishFacilityMap(deps, { apply: true });
    const second = await publishFacilityMap(deps, { apply: true });

    expect(first).toMatchObject({ resolved: 1, unmapped: 1, written: 2 });
    expect(second).toEqual(first);
    const rows = await deps.externalDb.selectFrom('facility_map').selectAll().execute();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.source_code === 'Dodoma')!.name).toBe('Dodoma Regional Referral Hospital');
    expect(rows.find((r) => r.source_code === 'Kibondo')!.name).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/bootstrap && pnpm vitest run src/facility-reconcile.test.ts`
Expected: FAIL — `resolveObservedFacilities is not a function`.

- [ ] **Step 3: Implement resolution**

Append to `packages/bootstrap/src/facility-reconcile.ts`:

```ts
import { FACILITY_REGISTRY_SYSTEM, facilityMapId } from '@openldr/db';

export type ResolvedVia = 'registry' | 'national';

export interface ResolvedFacility {
  sourceSystem: string;
  sourceCode: string;
  registryId: string | null;
  name: string | null;
  level: string | null;
  status: string | null;
  region: string | null;
  district: string | null;
  council: string | null;
  nationalSystem: string | null;
  nationalCode: string | null;
  resolvedVia: ResolvedVia | null;
  /** A mapping exists, but its target resolves to no live registry row. Surfaced on the Observed
   *  tab; the report still falls back to the raw string. */
  targetMissing: boolean;
}

/**
 * Resolve every observed facility code through its mapping to a registry row.
 *
 * ⛔ Reads `term_mappings`, NOT `concept_map_elements`. `term_mappings` is the authoritative table
 * (`terminology-admin-store.ts:567-633` reads it and writes the concept_map_elements mirror
 * alongside), and only it carries `is_active` — an operator-deactivated mapping must not resolve.
 *
 * ⛔ Precedence is fixed and total: registry route, then national route, then unresolved. Never a
 * silent pick between two candidates.
 */
export async function resolveObservedFacilities(
  deps: ReconcileDeps,
  opts: { system?: string } = {},
): Promise<ResolvedFacility[]> {
  const system = opts.system ?? DEFAULT_OBSERVED_FACILITY_SYSTEM;

  const observed = await deps.externalDb
    .selectFrom('diagnostic_reports')
    .select(['performer', 'source_system'])
    .where('performer', 'is not', null)
    .groupBy(['performer', 'source_system'])
    .execute();

  const mappings = await deps.internalDb
    .selectFrom('term_mappings')
    .select(['from_code', 'to_system', 'to_code'])
    .where('from_system', '=', system)
    .where('is_active', '=', true)
    .execute();

  const registry = await deps.internalDb.selectFrom('facility_registry').selectAll().execute();
  const byId = new Map(registry.map((r) => [r.id, r]));
  const byNational = new Map(
    registry
      .filter((r) => r.national_system && r.national_code)
      .map((r) => [`${r.national_system}|${r.national_code}`, r]),
  );

  const byCode = new Map<string, { toSystem: string; toCode: string }[]>();
  for (const m of mappings) {
    const list = byCode.get(m.from_code) ?? [];
    list.push({ toSystem: m.to_system, toCode: m.to_code });
    byCode.set(m.from_code, list);
  }

  return observed.map((o) => {
    const code = o.performer as string;
    const sourceSystem = o.source_system ?? '';
    const candidates = byCode.get(code) ?? [];

    // 1. Registry route wins — the registry is what holds a printable name.
    const registryMapping = candidates.find((c) => c.toSystem === FACILITY_REGISTRY_SYSTEM);
    const nationalMapping = candidates.find((c) => c.toSystem !== FACILITY_REGISTRY_SYSTEM);

    const row = registryMapping
      ? byId.get(registryMapping.toCode)
      : nationalMapping
        ? byNational.get(`${nationalMapping.toSystem}|${nationalMapping.toCode}`)
        : undefined;

    const resolvedVia: ResolvedVia | null = row ? (registryMapping ? 'registry' : 'national') : null;

    return {
      sourceSystem,
      sourceCode: code,
      registryId: row?.id ?? null,
      name: row?.name ?? null,
      level: row?.level ?? null,
      status: row?.status ?? null,
      region: row?.region ?? null,
      district: row?.district ?? null,
      council: row?.council ?? null,
      nationalSystem: row?.national_system ?? null,
      nationalCode: row?.national_code ?? null,
      resolvedVia,
      // A mapping was authored but points at nothing live — distinct from "never mapped".
      targetMissing: candidates.length > 0 && !row,
    };
  });
}

export interface PublishResult {
  resolved: number;
  unmapped: number;
  targetMissing: number;
  written: number;
}

/**
 * Rebuild `facility_map` from the current resolution.
 *
 * ⛔ DELETE-then-INSERT, never upsert-then-prune. All three dialect batch-upserts conflict on `id`
 * and MSSQL caps at ~2000 bound parameters, so a `where id not in (...)` prune is unimplementable
 * at register scale — the same constraint that made `terminology_codes` delete-then-insert. One
 * transaction, so a concurrent reader never sees the dimension empty.
 */
export async function publishFacilityMap(
  deps: ReconcileDeps,
  opts: { system?: string; apply?: boolean } = {},
): Promise<PublishResult> {
  const resolved = await resolveObservedFacilities(deps, { system: opts.system });

  const result: PublishResult = {
    resolved: resolved.filter((r) => r.resolvedVia !== null).length,
    unmapped: resolved.filter((r) => r.resolvedVia === null && !r.targetMissing).length,
    targetMissing: resolved.filter((r) => r.targetMissing).length,
    written: resolved.length,
  };
  if (!opts.apply) return result;

  const rows = resolved.map((r) => ({
    id: facilityMapId(r.sourceSystem, r.sourceCode),
    source_system: r.sourceSystem,
    source_code: r.sourceCode,
    registry_id: r.registryId,
    name: r.name,
    level: r.level,
    status: r.status,
    region: r.region,
    district: r.district,
    council: r.council,
    national_system: r.nationalSystem,
    national_code: r.nationalCode,
    resolved_via: r.resolvedVia,
  }));

  await deps.externalDb.transaction().execute(async (trx) => {
    await trx.deleteFrom('facility_map').execute();
    // Chunked: MSSQL's parameter budget is ~2000 and each row binds 12 values.
    const chunk = 150;
    for (let i = 0; i < rows.length; i += chunk) {
      await trx.insertInto('facility_map').values(rows.slice(i, i + chunk) as never).execute();
    }
  });

  return result;
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/bootstrap && pnpm vitest run src/facility-reconcile.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Mutation-check the precedence assertion**

Temporarily swap the precedence so `nationalMapping` is preferred over `registryMapping`. Re-run.
Expected: the "prefers the registry route" test FAILS. Revert the swap.
This confirms the assertion is not decoration — per the standing rule that every load-bearing test must be able to go red.

- [ ] **Step 6: Export and commit**

```ts
export { resolveObservedFacilities, publishFacilityMap } from './facility-reconcile';
export type { ResolvedFacility, ResolvedVia, PublishResult } from './facility-reconcile';
```

```bash
git add packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts packages/bootstrap/src/test-support/facility-reconcile-fixture.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): resolve observed facilities and publish facility_map"
```

---

### Task 4b: Project the registry into its own coding system

**Files:**
- Modify: `packages/bootstrap/src/facility-reconcile.ts`
- Modify: `packages/bootstrap/src/facility-reconcile.test.ts`

**Interfaces:**
- Consumes: `FACILITY_REGISTRY_SYSTEM` (Task 2), `ReconcileDeps` (Task 3).
- Produces: `publishRegistryConcepts(deps: ReconcileDeps, opts?: { apply?: boolean }): Promise<{ concepts: number; systemRegistered: boolean }>`, called by `publishFacilityMap` (Task 4) on every publish.

**⛔ Why this task exists.** `TermMappingDialog`'s *search* mode picks a target from a coding system's concepts; *manual* mode makes the operator type a code by hand. Without this projection, `urn:openldr:cs:facility-registry` has **zero concepts**, so an operator cannot author a registry-route mapping through the UI at all — they would have to hand-type a `facility_registry.id` UUID. Task 4's tests seed mappings directly and therefore pass without this, which is exactly why the gap was invisible.

⚠ The concept `code` is `facility_registry.id`. Neither `local_code` (NULL on every imported row) nor `national_code` (NULL on hand-created rows — measured: `NHLQATC` today) is universally present; the table's only guarantee is the `facility_registry_has_a_code` CHECK that at least one exists. The operator never types the id — the picker resolves it and shows `display`.

⚠ `termMappings.create` auto-creates a DRAFT concept for an unknown target (`terminology-admin-store.ts:590-594`). So mapping into this system before the projection has run leaves a ghost DRAFT concept with no registry row behind it. That is precisely what `targetMissing` (Task 4) surfaces, and it is another reason this projection must run on every publish rather than once.

- [ ] **Step 1: Write the failing test**

```ts
describe('publishRegistryConcepts', () => {
  // The assertion is the OPERATOR-VISIBLE outcome — what the picker will search — not that some
  // internal function was called.
  it('makes every registry row pickable as a mapping target', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });
    await seedRegistry(deps, { id: 'fac-2', name: 'Muhimbili National Hospital', nationalSystem: 'urn:tz:hfr', nationalCode: 'TZ-001' });

    const result = await publishRegistryConcepts(deps, { apply: true });

    expect(result).toMatchObject({ concepts: 2, systemRegistered: true });
    const { rows } = await deps.admin.terms.search('urn:openldr:cs:facility-registry', { limit: 50, offset: 0 });
    expect(rows.map((r) => ({ code: r.code, display: r.display })).sort((a, b) => a.code.localeCompare(b.code)))
      .toEqual([
        { code: 'fac-1', display: 'Dodoma Regional Referral Hospital' },
        { code: 'fac-2', display: 'Muhimbili National Hospital' },
      ]);
  });

  it('registers an ACTIVE coding_systems row', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });

    await publishRegistryConcepts(deps, { apply: true });

    const cs = await deps.admin.codingSystems.getByUrl('urn:openldr:cs:facility-registry');
    expect(cs).not.toBeNull();
    expect(cs!.active).toBe(true);
  });

  it('tracks a renamed facility on re-publish', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Hospital', localCode: 'DOD' });
    await publishRegistryConcepts(deps, { apply: true });

    await deps.internalDb.updateTable('facility_registry')
      .set({ name: 'Dodoma Regional Referral Hospital' }).where('id', '=', 'fac-1').execute();
    await publishRegistryConcepts(deps, { apply: true });

    const { rows } = await deps.admin.terms.search('urn:openldr:cs:facility-registry', { limit: 10, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].display).toBe('Dodoma Regional Referral Hospital');
  });

  it('is called by publishFacilityMap', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });

    await publishFacilityMap(deps, { apply: true });

    const { total } = await deps.admin.terms.search('urn:openldr:cs:facility-registry', { limit: 10, offset: 0 });
    expect(total).toBe(1);
  });
});
```

⚠ Note the third test asserts the display **tracks** the registry: unlike the observed system (Task 2), where a curated display is preserved because the operator owns it, here `facility_registry.name` is the source of truth and the concept is a projection of it. These two rules are deliberately opposite — do not "unify" them.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/bootstrap && pnpm vitest run src/facility-reconcile.test.ts -t publishRegistryConcepts`
Expected: FAIL — `publishRegistryConcepts is not a function`.

- [ ] **Step 3: Implement it**

Append to `packages/bootstrap/src/facility-reconcile.ts`:

```ts
/**
 * Project `facility_registry` into `FACILITY_REGISTRY_SYSTEM` so registry rows are pickable as
 * mapping targets in `TermMappingDialog`'s search mode.
 *
 * ⛔ `display` TRACKS `facility_registry.name` — this concept is a projection, and the registry is
 * the source of truth for a facility's name. That is the OPPOSITE of the observed-facility system,
 * where a curated display is preserved because the operator owns it. Both rules are deliberate.
 */
export async function publishRegistryConcepts(
  deps: ReconcileDeps,
  opts: { apply?: boolean } = {},
): Promise<{ concepts: number; systemRegistered: boolean }> {
  const registry = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'name'])
    .execute();

  if (!opts.apply) return { concepts: registry.length, systemRegistered: false };

  await deps.admin.codingSystems.upsertByUrl({
    url: FACILITY_REGISTRY_SYSTEM,
    systemCode: 'FACILITY-REGISTRY',
    systemName: 'OpenLDR facility registry',
    publisherId: 'pub-system',
  });
  const cs = await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);
  if (cs && !cs.active) {
    await deps.internalDb.updateTable('coding_systems').set({ active: true })
      .where('url', '=', FACILITY_REGISTRY_SYSTEM).execute();
  }

  if (registry.length > 0) {
    await deps.admin.terms.importRows(
      registry.map((r) => ({
        system: FACILITY_REGISTRY_SYSTEM,
        code: r.id,
        display: r.name,
        status: 'ACTIVE',
        properties: null,
      })),
    );
  }

  return { concepts: registry.length, systemRegistered: true };
}
```

⚠ **A deleted facility leaves its concept behind.** `importRows` upserts and never prunes. That is acceptable and deliberate: the stale concept is what makes `targetMissing` (Task 4) detectable at all, since resolution checks the live `facility_registry` row rather than the concept. Do **not** add a prune here — it would silently erase the evidence the Observed tab exists to show.

- [ ] **Step 4: Call it from `publishFacilityMap`**

In `publishFacilityMap` (Task 4), immediately before resolution:

```ts
  if (opts.apply) await publishRegistryConcepts(deps, { apply: true });
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/bootstrap && pnpm vitest run src/facility-reconcile.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts
git commit -m "feat(bootstrap): project facility_registry into a pickable coding system"
```

---

### Task 5: The ingest hook

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (near `createProjectionRunner`, line 960)
- Modify: `packages/bootstrap/src/facility-reconcile.ts`
- Modify: `packages/bootstrap/src/facility-reconcile.test.ts`

**Interfaces:**
- Produces: `captureObservedFacility(deps: Pick<ReconcileDeps, 'admin'>, system: string, code: string, now: string): Promise<void>` — the single-row path, sharing `observedFacilityConceptRow` with the scan so the two cannot drift on shape.

⚠ **SKETCH — verify the seam before writing this task.** `createProjectionRunner` receives `{ internalDb, fhirStore, relationalWriter, logger, fetch }` (`packages/bootstrap/src/index.ts:960-966`), so an internal write from the projection loop is reachable. But `projectResource` itself is pure and per-resource. **Read `createProjectionRunner`'s implementation first** and decide where a per-resource side-effect belongs: an optional `onProjected?: (resourceType: string, row: Record<string, unknown>) => Promise<void>` callback threaded into the runner is the least invasive shape, but confirm it against the real control flow rather than assuming. If the seam turns out to be genuinely awkward, **say so and stop** — the scan (Task 3) already delivers the user-visible behaviour, and a forced hook is worse than no hook.

- [ ] **Step 1: Write the failing test**

```ts
describe('captureObservedFacility', () => {
  it('creates a concept for a newly seen performer', async () => {
    const deps = await makeReconcileDeps();

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['Namansi']);
  });

  it('is idempotent for a performer already captured', async () => {
    const deps = await makeReconcileDeps();
    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-05T00:00:00.000Z');

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-06T00:00:00.000Z');

    const { total } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(total).toBe(1);
  });

  it('keeps the string byte-for-byte', async () => {
    const deps = await makeReconcileDeps();

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Aga Khan', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows[0].code).toBe('Aga Khan');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/bootstrap && pnpm vitest run src/facility-reconcile.test.ts -t captureObservedFacility`
Expected: FAIL — not a function.

- [ ] **Step 3: Implement the single-row capture**

Append to `packages/bootstrap/src/facility-reconcile.ts`:

```ts
/**
 * Capture ONE observed facility string, from the ingest path.
 *
 * Shares `observedFacilityConceptRow` with `scanObservedFacilities` so the two capture paths cannot
 * drift on concept shape. It deliberately does NOT compute `reportCount` — that is an aggregate
 * over the warehouse this path cannot see from a single resource; the scan owns it. A code first
 * seen here carries `reportCount: 0` until the next scan corrects it.
 */
export async function captureObservedFacility(
  deps: Pick<ReconcileDeps, 'admin'>,
  system: string,
  code: string,
  now: string,
): Promise<void> {
  if (!code) return;
  const { rows } = await deps.admin.terms.search(system, { query: code, limit: 1, offset: 0 });
  const existing = rows.find((r) => r.code === code);
  if (existing) return; // Already known; the scan advances lastSeen/reportCount.
  await deps.admin.terms.importRows([
    observedFacilityConceptRow({ system, code, seenAt: now, reportCount: 0 }),
  ]);
}
```

⚠ `terms.search` with `query` does a `lower(code) like %…%` match (`terminology-admin-store.ts:490-497`), so the `rows.find((r) => r.code === code)` exact filter above is load-bearing — a substring hit is not the same concept.

- [ ] **Step 4: Wire the hook**

Thread `captureObservedFacility` into the projection runner per the seam identified in the SKETCH note above. **The hook must never fail an ingest cycle** — wrap the call so an error is logged and swallowed. A facility-capture failure must not stop clinical data from projecting.

- [ ] **Step 5: Run the tests**

Run: `cd packages/bootstrap && pnpm vitest run src/facility-reconcile.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): capture observed facilities at ingest time"
```

---

### Task 6: HTTP routes

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Modify: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `scanObservedFacilities`, `publishFacilityMap`, `resolveObservedFacilities` (Tasks 3-4).
- Produces:
  - `GET /api/facilities/observed` → `ResolvedFacility[]` plus `reportCount` per row, ordered by count desc. Gate: `facilities.view`.
  - `POST /api/facilities/scan-observed` `{ system?, apply? }` → `ScanResult`. Gate: `facilities.manage`.
  - `POST /api/facilities/publish` `{ system?, apply? }` → `PublishResult`. Gate: `facilities.manage`.

⚠ **Route ordering:** `/api/facilities/observed` must be registered BEFORE `/api/facilities/:id`, or Fastify matches the parameterised route and `observed` is read as an id. The existing file already registers `/api/facilities/admin-values` before `:id` for exactly this reason — follow that placement.

⚠ Follow the file's established conventions: `VIEW`/`MANAGE` preHandlers, `zod` body parsing returning `{ error }` with an explicit `reply.code(400)`, and `recordAudit` after any applied write (mirror the `facility.import` call at the end of the import route). Add audit actions `facility.scan` and `facility.publish`.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists observed facilities ordered by report count', async () => {
  const { app } = await makeServer();
  // seed two performers with different volumes, then scan
  const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.map((r: { sourceCode: string }) => r.sourceCode)).toEqual(['Dodoma', 'Kibondo']);
  expect(body[0].reportCount).toBe(247);
});

it('refuses the scan without facilities.manage', async () => {
  const { app } = await makeServer({ capabilities: ['facilities.view'] });
  const res = await app.inject({ method: 'POST', url: '/api/facilities/scan-observed', payload: { apply: true } });
  expect(res.statusCode).toBe(403);
});

it('dry-runs the scan by default', async () => {
  const { app } = await makeServer();
  const res = await app.inject({ method: 'POST', url: '/api/facilities/scan-observed', payload: {} });
  expect(res.statusCode).toBe(200);
  expect(res.json().created).toBeGreaterThan(0);
  // and nothing was written
});
```

⚠ **SKETCH — `makeServer` is a placeholder.** Read `apps/server/src/facilities-routes.test.ts` and reuse whatever harness it already uses (`test-helpers.ts` builds a real `AppContext`); do not invent a new one.

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement the three routes**
- [ ] **Step 4: Run the tests**

Run: `cd apps/server && pnpm vitest run src/facilities-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `cd apps/server && pnpm lint`
Expected: clean. ⚠ `apps/server` is the ONLY package with real lint, and it enforces the `return`/`await reply.send` gzip-clobber invariant.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(server): observed-facility list, scan and publish routes"
```

---

### Task 7: The delete guard

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` (the `DELETE /api/facilities/:id` handler, currently at lines 514-521)
- Modify: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Produces: `GET /api/facilities/:id/impact` → `{ mappingCount: number; reportCount: number }`. Gate: `facilities.view`.

**Behaviour (spec §6):** the mapping SURVIVES a delete. Nothing cascades, nothing is silently destroyed, and re-creating the facility repairs the mapping. The Observed tab renders the orphan as `target missing` (already implemented by `ResolvedFacility.targetMissing` in Task 4). The route only needs to expose the impact counts so the UI can warn first.

- [ ] **Step 1: Write the failing tests**

```ts
it('reports how many observed codes and reports a facility affects', async () => {
  const { app } = await makeServer();
  // seed registry row fac-1, map 'Dodoma' (247 reports) to it
  const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/impact' });
  expect(res.json()).toEqual({ mappingCount: 1, reportCount: 247 });
});

it('leaves the mapping in place when the facility is deleted', async () => {
  const { app } = await makeServer();
  await app.inject({ method: 'DELETE', url: '/api/facilities/fac-1' });
  const observed = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
  const row = observed.json().find((r: { sourceCode: string }) => r.sourceCode === 'Dodoma');
  expect(row.targetMissing).toBe(true);
  expect(row.name).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement `GET /api/facilities/:id/impact`**

Count `term_mappings` rows where `to_system = FACILITY_REGISTRY_SYSTEM AND to_code = :id`, plus the national-route rows matching the facility's `(national_system, national_code)`. Sum `reportCount` for the observed codes those mappings come from. Register the route before `/api/facilities/:id` is fine — a distinct suffix does not collide — but keep it adjacent to the other `:id` routes for readability.

- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(server): facility deletion impact, mappings survive delete"
```

---

### Task 8: CLI parity

**Files:**
- Modify: `packages/cli/src/facilities.ts`
- Modify: `packages/cli/src/program.ts`
- Modify: `packages/cli/src/facilities.test.ts`

**Interfaces:**
- Produces:
  - `openldr facilities scan-observed [--system <url>] [--apply] [--json]`
  - `openldr facilities publish [--system <url>] [--apply] [--json]`

⚠ Repo rule: a new operator capability ships as a CLI command too, sharing the same function the HTTP route calls. Follow `runFacilitiesImport`'s established shape (`packages/cli/src/facilities.ts:27-50`): `createAppContext(loadConfig())`, `redactError` instead of a stack trace, a `--json` branch, an audit call after an applied run, and a numeric exit code.

⚠ Both commands **dry-run by default** — `--apply` opts in, mirroring `facilities import`. Both must print counts (`discovered / created / updated`, `resolved / unmapped / targetMissing / written`), never a bare "ok". Slice A's trap 5 was a client that read a wrong file as success because it branched on status rather than counters.

- [ ] **Step 1: Write the failing test**

```ts
it('dry-runs scan-observed by default and prints counts', async () => {
  const code = await runFacilitiesScanObserved({ json: true });
  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ discovered: expect.any(Number), created: expect.any(Number) });
});
```

⚠ **SKETCH** — read `packages/cli/src/facilities.test.ts` for the existing stdout-capture harness and reuse it.

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement both commands and register them in `program.ts`**
- [ ] **Step 4: Run the tests**

Run: `cd packages/cli && pnpm vitest run src/facilities.test.ts`
Expected: PASS.

⚠ `packages/cli` `build` fails on Windows (esbuild ssh2/cpu-features native) — that is a known environment flake, not this change. Only `typecheck` and `test` need to be green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/facilities.ts packages/cli/src/program.ts packages/cli/src/facilities.test.ts
git commit -m "feat(cli): facilities scan-observed and publish commands"
```

---

### Task 9: The Observed tab

**Files:**
- Create: `apps/studio/src/facilities/ObservedTab.tsx`
- Create: `apps/studio/src/facilities/ObservedTab.test.tsx`
- Modify: `apps/studio/src/pages/Facilities.tsx`
- Modify: `apps/studio/src/pages/Facilities.test.tsx`
- Modify: `apps/studio/src/i18n/` (en, fr, pt)

**Interfaces:**
- Consumes: `GET /api/facilities/observed`, `POST /api/facilities/scan-observed`, `POST /api/facilities/publish` (Task 6).

**Layout:** `Registry | Observed` tabs on the existing page. The Observed table has columns **observed code · reports · resolves to · ⋯**, ordered by report count descending. Row states: mapped (shows the resolved name and `registry`/`national`), unmapped (shows the raw string the report will print), target missing (destructive styling).

**⛔ Traps this page must not repeat, each already paid for on this exact page:**
- Use `reload({ background: true })`, never a bare `reload()`. A plain reload sets `loading`, `Facilities.tsx` early-returns a full-page spinner at line 100, the sheet unmounts and remounts blank — this destroyed slice A's own success confirmation.
- Branch on the **counters**, never the HTTP status. A wrong input returns 200 with zero counts.
- `facilities.manage` needs a **client-side** check too — `data_analyst`/`system_auditor` hold `view` without `manage`. Gate the write affordances, not the list.
- Every action in a `⋯ DropdownMenu`. No standalone buttons.
- `TruncatedText` for the observed code — `Ocean Road Cancer Institute (O` will clip.

- [ ] **Step 1: Write the failing test**

```tsx
it('orders observed facilities by report count and names the fallback', async () => {
  server.use(http.get('/api/facilities/observed', () => HttpResponse.json([
    { sourceSystem: 'webhook-ingest', sourceCode: 'Dodoma', reportCount: 247, name: 'Dodoma Regional Referral Hospital', resolvedVia: 'registry', targetMissing: false },
    { sourceSystem: 'webhook-ingest', sourceCode: 'Kibondo', reportCount: 148, name: null, resolvedVia: null, targetMissing: false },
  ])));

  render(<ObservedTab />);

  const rows = await screen.findAllByRole('row');
  expect(within(rows[1]).getByText('Dodoma')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Dodoma Regional Referral Hospital')).toBeInTheDocument();
  expect(within(rows[2]).getByText(/Kibondo/)).toBeInTheDocument();
});

it('marks a mapping whose target was deleted', async () => {
  server.use(http.get('/api/facilities/observed', () => HttpResponse.json([
    { sourceSystem: 'webhook-ingest', sourceCode: 'Ocean Road Cancer Institute (O', reportCount: 6, name: null, resolvedVia: null, targetMissing: true },
  ])));

  render(<ObservedTab />);

  expect(await screen.findByText(/target missing/i)).toBeInTheDocument();
});

it('hides write actions without facilities.manage', async () => {
  render(<ObservedTab />, { capabilities: ['facilities.view'] });
  await screen.findByText('Dodoma');
  expect(screen.queryByRole('button', { name: /actions/i })).not.toBeInTheDocument();
});
```

⚠ **SKETCH** — read `apps/studio/src/pages/Facilities.test.tsx` for the existing render harness, capability mocking, and MSW setup. Reuse them; do not invent a second pattern.

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Build `ObservedTab.tsx`**
- [ ] **Step 4: Add tabs to `Facilities.tsx`**

Wrap the existing registry table in a `Registry` tab and add `Observed`. ⚠ Use the repo's shadcn `Tabs` primitive; if `apps/studio/src/components/ui/tabs.tsx` does not exist, create it from shadcn rather than hand-rolling. ⚠ Tab headers bleed to the pane edges — use `@/components/ui/bleed`.

- [ ] **Step 5: Add i18n strings for en, fr and pt**

All three locales, in the same commit. The repo's i18n sweep is complete and a missing locale is a regression.

- [ ] **Step 6: Run the tests**

Run: `cd apps/studio && pnpm vitest run src/facilities/ src/pages/Facilities.test.tsx`
Expected: PASS.

- [ ] **Step 7: Show the screen**

Start the dev API (`cd apps/server && node dev.mjs`) and the studio, run the scan, and look at `/facilities` → Observed. ⚠ Announce up front if `AUTH_DEV_BYPASS` is used; it defaults to `false` in `.env`, the running process keeps its env, and with the bypass on the API binds `0.0.0.0` with no auth — kill it when done.

Expected on today's dev data: 23 rows, `Dodoma` (247) / `Mnazi Mmoja` (182) / `Muhimbili` (82) / `NHLQATC` (57) resolvable once mapped, 19 unmapped.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/facilities/ObservedTab.tsx apps/studio/src/facilities/ObservedTab.test.tsx apps/studio/src/pages/Facilities.tsx apps/studio/src/pages/Facilities.test.tsx apps/studio/src/i18n
git commit -m "feat(studio): Observed facilities tab on the Facilities page"
```

---

### Task 10: Drop `facility_aliases`

**Files:**
- Create: `packages/db/src/migrations/internal/074_drop_facility_aliases.ts`
- Create: `packages/db/src/migrations/internal/074_drop_facility_aliases.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts:7`
- Modify: `packages/db/src/schema/internal.ts`
- Modify: `packages/db/src/facility-registry-store.ts`
- Modify: `packages/db/src/facility-registry-store.test.ts`
- Modify: `packages/db/src/index.ts`

**Why last:** dropping it earlier would leave the branch with no facility-mapping mechanism at all between tasks. Nothing in Tasks 1-9 uses it.

⚠ Measured: `facility_aliases` holds **0 rows**, so nothing is lost. Its FK is `ON DELETE CASCADE` — the exact silent-data-loss behaviour spec §6 replaces.

⚠ Before writing the migration, run `grep -rn "facility_aliases\|attachAlias\|detachAlias\|listAliases" --include=*.ts packages apps | grep -v node_modules` and remove **every** caller. A list is a claim about the filesystem — grep it, do not recall it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '../../test-support/internal-db';
import { sql } from 'kysely';

describe('074_drop_facility_aliases', () => {
  it('removes the facility_aliases table', async () => {
    const db = await makeMigratedDb();
    const { rows } = await sql<{ table_name: string }>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'facility_aliases'`.execute(db);
    expect(rows).toEqual([]);
  });
});
```

⚠ **SKETCH** — the helper is `makeMigratedDb()` per `plans-cite-or-flag` (NOT `makeMigrationDb`), but verify its import path with `grep -rn "makeMigratedDb" --include=*.ts packages/db/src | head -3`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/db && pnpm vitest run src/migrations/internal/074_drop_facility_aliases.test.ts`
Expected: FAIL — the table is still present.

- [ ] **Step 3: Write the migration**

```ts
import type { Kysely } from 'kysely';

// `facility_aliases` (migration 070) is superseded by the terminology approach: observed facility
// strings are concepts in a local coding system, mapped through `term_mappings`. Keeping both would
// leave two answers to one question in the codebase.
//
// Measured 0 rows before the drop, so nothing is lost. Its FK was ON DELETE CASCADE, which silently
// destroyed a lab's mappings whenever a facility was deleted — the behaviour the new design
// deliberately replaces with a warn-before / surface-after orphan state.
//
// `down` recreates the table but cannot recover rows; it exists so the migration is reversible in
// shape, not in data.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('facility_aliases').ifExists().execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('facility_aliases')
    .addColumn('source_system', 'text', (c) => c.notNull())
    .addColumn('source_code', 'text', (c) => c.notNull())
    .addColumn('registry_id', 'text', (c) => c.notNull().references('facility_registry.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text')
    .addPrimaryKeyConstraint('facility_aliases_pk', ['source_system', 'source_code'])
    .execute();
}
```

⚠ **SKETCH — transcribe `down` from `070_facility_registry.ts` rather than from this block.** Read the real `CREATE TABLE` there and mirror it exactly; the column list above is from a live `information_schema` query and matches, but the constraint spelling should come from the migration that created it.

- [ ] **Step 4: Register it and update the pinned list**

Add to `packages/db/src/migrations/internal/index.ts`, and append `'074_drop_facility_aliases'` to the internal array at `packages/db/src/migrations/migrations.test.ts:7`.

- [ ] **Step 5: Remove the store surface**

From `packages/db/src/facility-registry-store.ts`: delete the `FacilityAlias` interface (lines 47-52), the four method signatures on `FacilityRegistryStore` (lines 104-109), and their four implementations (lines 298-351, including the comment block about alias writes not being captured). Remove `facility_aliases` from `packages/db/src/schema/internal.ts` and drop the `FacilityAlias` export from `packages/db/src/index.ts`. Delete the corresponding tests from `facility-registry-store.test.ts`.

- [ ] **Step 6: Run the full package suite**

Run: `cd packages/db && pnpm vitest run && pnpm typecheck`
Expected: PASS, including `migrations.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/074_drop_facility_aliases.ts packages/db/src/migrations/internal/074_drop_facility_aliases.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/internal.ts packages/db/src/facility-registry-store.ts packages/db/src/facility-registry-store.test.ts packages/db/src/index.ts
git commit -m "refactor(db): drop facility_aliases, superseded by terminology mapping"
```

---

### Task 11: Gate and merge

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo run typecheck test --force --concurrency=6`
Expected: 67/67.

⚠ If a package fails, `grep 'Test timed out'` in the output and re-run that package alone before blaming a change. But if a file is anywhere near its limit, this slice made it marginal — fix it, do not retry.

⚠ Adding to a shared type (`AppContext`) requires `turbo typecheck`, not one package's tests: vitest strips types via esbuild and never typechecks, so a broken `apps/server/src/test-helpers.ts` stays green under test and only `tsc --noEmit` sees it.

- [ ] **Step 2: Live-verify the end-to-end path**

With the dev API running against the dev DBs:

```bash
node -e "require('child_process')" # placeholder — use the CLI:
```
```bash
pnpm --filter @openldr/cli exec openldr facilities scan-observed --apply --json
```

Expected: `{"discovered":23,"created":23,"updated":0,"systemRegistered":true}`.

Then map `Dodoma` → `Dodoma Regional Referral Hospital` in `/terminology`, run publish, and confirm:

```bash
docker exec openldr_ce-postgres-1 psql -U openldr -d openldr_target -Atc "select source_code, name, resolved_via from facility_map order by source_code"
```

Expected: 23 rows, `Dodoma` carrying the canonical name and `resolved_via = registry`.

⚠ **A live test that supplies its own trigger cannot tell you the trigger exists.** Verify the ingest hook by posting a NEW report through the real webhook with an unseen performer — not by calling `captureObservedFacility` from a script.

- [ ] **Step 3: Merge**

```bash
git checkout main
git merge --no-ff slice/facility-reconciliation
```

Do not push.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1.2 cross-database constraint | 1 (the `facility_map` dimension) |
| §2.1 both routes, registry precedence | 4 |
| §2.2 byte-for-byte code | 2 (assertion), 3, 5 |
| §3 shared writer, two paths | 2 (shaping), 3 (scan), 5 (hook) |
| §3.3 ACTIVE coding_systems row | 3 |
| §3.4 naming, not seeded | 2 |
| §4 warehouse dimension + publish | 1, 4 |
| §4.1 registry coding system | **4b** (added during self-review — see below) |
| §5 Observed tab | 9 |
| §6 delete guard, orphan surfacing | 4 (`targetMissing`), 7 |
| §7 drop `facility_aliases` | 10 |
| §8 CLI parity | 8 |
| §9 testing | throughout; gate in 11 |

**⚠ Gap found during self-review and FIXED inline as Task 4b.** Spec §4.1 requires `facility_registry` rows to be projected into `urn:openldr:cs:facility-registry` as concepts, so `TermMappingDialog`'s search mode has something to pick. The first draft of this plan had **no task for it**, and Task 4's tests seed mappings directly — so the whole suite would have gone green while an operator could not author a registry-route mapping through the UI at all, only hand-type a UUID.

This is the same class of defect as terminology-projection-fanout's *"a live test that supplies its own trigger cannot tell you the trigger exists"*. Task 4b's tests therefore assert the operator-visible outcome — that `admin.terms.search(FACILITY_REGISTRY_SYSTEM, …)` returns one row per registry row — rather than that a function was called.

**Placeholder scan:** every SKETCH marker above is deliberate and names what to verify and where. There are no unmarked assertions about code I did not open. The `terms.search`-vs-raw-`properties` question in Task 3 and the projection-runner seam in Task 5 are the two places where an implementer must make a decision rather than transcribe one; both say so explicitly and Task 5 says to stop rather than force it.

**Type consistency:** `ReconcileDeps`, `ScanResult`, `ResolvedFacility`, `PublishResult`, `ResolvedVia` are declared once in Task 3/4 and used unchanged in 5-9. `facilityMapId(sourceSystem, sourceCode)` has the same signature in Tasks 2 and 4. `DEFAULT_OBSERVED_FACILITY_SYSTEM` / `FACILITY_REGISTRY_SYSTEM` are spelled identically in Tasks 2, 3, 4 and the Global Constraints.
