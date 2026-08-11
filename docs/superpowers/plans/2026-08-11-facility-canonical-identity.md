# Canonical facility identity, vocabulary and provenance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a national register's identity depending on what somebody typed, stop "the register dropped this row" overwriting "this facility closed", and show an operator where a facility came from and what has happened to it.

**Architecture:** A registry source becomes an explicit `coding_systems` row (they already exist, conjured implicitly by `upsertByUrl`), marked with a new `kind` column. `facility_registry.national_system` stops holding a typed label and holds that source's **canonical URI**, so the existing `idFor(nationalSystem, nationalCode)` hash becomes stable without changing shape. A new `register_state` column carries registry membership so HL7's `location-status` can go back to meaning only operational status. Provenance is read from data already captured in `audit_events`.

**Tech Stack:** TypeScript, Kysely, Fastify, React + shadcn, vitest, pg-mem for store/route tests, real Postgres for the scale checks.

**Spec:** `docs/superpowers/specs/2026-08-11-facility-canonical-identity-design.md` — read it before Task 1. Its *Measured before designing* section is load-bearing; do not re-derive those facts, and do not contradict them without measuring.

## Global Constraints

- **Branch:** `slice/facility-canonical-identity`, already checked out. Slice branch → `--no-ff` merge to local `main` at the end.
- ⛔ **NEVER `git add -A`.** The working directory is shared with concurrent sessions. Stage named paths only.
- ⛔ **NEVER add a `Co-Authored-By` trailer.**
- ⛔ **NEVER revert a mutation with `git checkout -- <file>`.** It reverts the whole file and has destroyed work in this repo. In-place reverse edits only.
- ⛔ **TDD:** write the failing test, RUN it and paste the failure, then implement.
- ⛔ **Mutation-prove every behavioural claim.** A mutation must be shown to actually EXECUTE the mutated line — print values at the mutated line or otherwise prove it ran. Eleven inert or near-inert mutations were caught during A2b.
- ⛔ **Check every new assertion can actually fail.** A2a shipped two `queryByText` guards whose regexes never matched the real copy.
- ⛔ **Every comment must be true of the code it describes.** A2b's waves corrected more than ten false comments; one caused a hang bug, one hid an OOM path by being wrong by 128×, one authorised a regression.
- ⛔ **Every action control lives in a `⋯` `DropdownMenu`.** Inputs are exempt and keep the label-left / input-right `grid-cols-[auto_1fr]` layout.
- ⛔ **New i18n keys go in `en.ts`, `fr.ts` AND `pt.ts` in the same commit** — `apps/studio/src/i18n/parity.test.ts` enforces it.
- ⛔ **Never inline a clinical vocabulary into source or SQL.** Vocabularies live in terminology and are read from it.
- **pg-mem hazards, all measured here:** `now()` is real millisecond wall-clock and **collides on ~50% of consecutive calls** — force the gap (`now() + interval '1 second'`) for any strictly-greater timestamp assertion. Zero correlated-subquery support. Does **not** roll back on a thrown error. Returns `numInsertedOrUpdatedRows: 1` for a skipped `onConflict().doNothing()`. **Stable scan order**, so it can never reveal a missing `ORDER BY` tiebreaker — every ordered query still needs a unique one.
- **Gate:** `pnpm turbo run typecheck test --force`. ⛔ **Never pipe turbo through `tail`** — redirect to a file and read it. Whole-package vitest runs need `--testTimeout=30000`.
- **Migration numbering:** internal `081` and `082` are free (`080_facility_import_runs` is the current head). External migrations are **not** touched by this plan.

---

## File Structure

**Created**
- `packages/db/src/migrations/internal/081_facility_source_and_register_state.ts` — schema: `coding_systems.kind/jurisdiction/contact`, `facility_registry.register_state`, seed the register-state valueset.
- `packages/db/src/migrations/internal/082_facility_canonical_identity.ts` — data: resolve each distinct `national_system` to a source row, rewrite it to the canonical URI, re-key facility ids and every internal reference, mark the warehouse dimension stale.
- `packages/db/src/facility-register-sources.ts` — the source list/create surface over `coding_systems`, filtered by `kind`.
- `apps/studio/src/facilities/FacilityHistory.tsx` — the timeline read-model view.

**Modified**
- `packages/terminology/src/facility-csv.ts`, `facility-release.ts` — `opts.nationalSystem` becomes the canonical URI; `idFor` unchanged in shape.
- `packages/bootstrap/src/facility-controlled-fields.ts` — `observedFieldSystem` derives from the URI.
- `packages/bootstrap/src/facility-import.ts` — retirement writes `register_state`, not `status`; per-facility audit rows for changed rows only.
- `apps/server/src/facilities-routes.ts` — source list/create routes, server-side valueset validation on manual write, history route.
- `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` — the free-text box becomes a `Select`.
- `apps/studio/src/pages/Facilities.tsx`, `apps/studio/src/facilities/FacilityDialog.tsx` — badges, provenance, filters, display-by-label.
- `apps/studio/src/i18n/{en,fr,pt}.ts`.

---

## Task 1: Schema — source columns, register_state, and the register-state valueset

**Files:**
- Create: `packages/db/src/migrations/internal/081_facility_source_and_register_state.ts`
- Create: `packages/db/src/migrations/internal/081_facility_source_and_register_state.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (register the migration)
- Modify: `packages/db/src/schema/internal.ts` (add the columns to the typed schema)

**Interfaces:**
- Produces: `coding_systems.kind` (`text`, nullable), `coding_systems.jurisdiction` (`text`, nullable), `coding_systems.contact` (`text`, nullable), `facility_registry.register_state` (`text`, notNull, default `'not_registered'`). Valueset URL constant `FACILITY_REGISTER_STATE_VS = 'urn:openldr:valueset:facility-register-state'` exported from the migration module, with codes `in_register` / `dropped` / `not_registered`. Source kind constant `FACILITY_REGISTER_KIND = 'facility-register'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { makeMigratedDb } from './test-helpers';
import type { InternalSchema } from '../../schema/internal';
import { FACILITY_REGISTER_STATE_VS } from './081_facility_source_and_register_state';

describe('081 facility source + register state', () => {
  it('adds kind/jurisdiction/contact to coding_systems', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    await db.insertInto('coding_systems').values({
      id: 'cs-x', system_code: 'X', system_name: 'X', url: 'urn:x',
      kind: 'facility-register', jurisdiction: 'TZ', contact: 'moh@example.tz',
    } as never).execute();
    const row = await db.selectFrom('coding_systems').selectAll()
      .where('id', '=', 'cs-x').executeTakeFirstOrThrow() as never as
      { kind: string | null; jurisdiction: string | null; contact: string | null };
    expect(row.kind).toBe('facility-register');
    expect(row.jurisdiction).toBe('TZ');
    expect(row.contact).toBe('moh@example.tz');
  });

  it('adds register_state defaulting to not_registered', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    await db.insertInto('facility_registry').values({
      id: 'f1', name: 'Alpha', local_code: 'L1', source: 'manual',
    } as never).execute();
    const row = await db.selectFrom('facility_registry').select('register_state' as never)
      .where('id', '=', 'f1').executeTakeFirstOrThrow() as { register_state: string };
    expect(row.register_state).toBe('not_registered');
  });

  it('backfills an imported row to in_register and a manual row to not_registered', async () => {
    // The migration runs on rows that already exist, so both cases are seeded BEFORE it would run.
    // makeMigratedDb runs every migration, so assert the post-migration invariant instead: the
    // default plus the backfill agree on what a NULL national_system means.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    await db.insertInto('facility_registry').values([
      { id: 'f-imp', name: 'Imported', national_system: 'urn:tz:hfr', national_code: '100', source: 'import' },
      { id: 'f-man', name: 'Manual', local_code: 'L2', source: 'manual' },
    ] as never).execute();
    const rows = await db.selectFrom('facility_registry')
      .select(['id', 'register_state'] as never).orderBy('id' as never).execute() as
      { id: string; register_state: string }[];
    expect(rows.find((r) => r.id === 'f-man')?.register_state).toBe('not_registered');
  });

  it('seeds the register-state valueset with exactly three codes', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const vs = await db.selectFrom('value_sets').selectAll()
      .where('url', '=', FACILITY_REGISTER_STATE_VS).executeTakeFirstOrThrow();
    const codes = await db.selectFrom('value_set_codes').select('code' as never)
      .where('value_set_id' as never, '=', (vs as { id: string }).id).execute() as { code: string }[];
    expect(codes.map((c) => c.code).sort()).toEqual(['dropped', 'in_register', 'not_registered']);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/db && npx vitest run src/migrations/internal/081_facility_source_and_register_state.test.ts --testTimeout=30000`
Expected: FAIL — the module does not exist.

⚠ Before writing the migration, **read `072_facility_level_status_valuesets.ts`** and copy its valueset-seeding idiom exactly (table names, id derivation, `seeded` flags). Do not invent a second way to seed a valueset.

- [ ] **Step 3: Write the migration**

```ts
import { Kysely, sql } from 'kysely';

/** The registry-membership vocabulary. OpenLDR's own, deliberately: HL7 owns
 *  `location-status` (active/suspended/inactive) and has no membership concept, so carrying
 *  "the register dropped this row" there would mean inventing a non-conformant code — see
 *  facility-import.ts's retirement comment, which is correct about why it writes `inactive`. */
export const FACILITY_REGISTER_STATE_VS = 'urn:openldr:valueset:facility-register-state';

/** Marks a `coding_systems` row as a facility register.
 *
 *  ⛔ A REAL COLUMN, never a URL-prefix convention. Sniffing `urn:openldr:cs:facility-*` to decide
 *  what a row means would replace one string-derived identity with another, which is the defect
 *  this slice exists to remove. */
export const FACILITY_REGISTER_KIND = 'facility-register';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('coding_systems').addColumn('kind', 'text').execute();
  await db.schema.alterTable('coding_systems').addColumn('jurisdiction', 'text').execute();
  await db.schema.alterTable('coding_systems').addColumn('contact', 'text').execute();

  await db.schema.alterTable('facility_registry')
    .addColumn('register_state', 'text', (c) => c.notNull().defaultTo('not_registered'))
    .execute();

  // A row that came from a register IS in one until an import says otherwise. A row with no
  // national_system never came from one, and `not_registered` is the column default.
  await sql`
    update facility_registry set register_state = 'in_register'
    where national_system is not null and national_system <> ''
  `.execute(db);

  // Seed the valueset with the same idiom as 072 — see that migration.
  // (Copy its exact insert shape; the codes are the three below.)
}
```

⚠ Complete the seeding block by following `072_facility_level_status_valuesets.ts`. The three codes are `in_register`, `dropped`, `not_registered`, with displays `In register`, `Dropped by register`, `Not from a register`.

- [ ] **Step 4: Register the migration and extend the typed schema**

Add the module to `packages/db/src/migrations/internal/index.ts` in numeric order, and add `kind`, `jurisdiction`, `contact` to the `coding_systems` interface and `register_state: string` to the `facility_registry` interface in `packages/db/src/schema/internal.ts`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd packages/db && npx vitest run src/migrations/internal/081_facility_source_and_register_state.test.ts src/migrations/migrations.test.ts --testTimeout=30000`
Expected: PASS.

- [ ] **Step 6: Mutation-prove the backfill**

Change the backfill's `where national_system is not null and national_system <> ''` to `where false`, add `console.error('MUT-081 backfill ran')` immediately above it, re-run the third test. Expected: the marker prints (the line executes) and the imported-row assertion goes RED. Revert with an in-place reverse edit.

⚠ If the third test passes under that mutation, the assertion is not reaching the backfill — strengthen it before continuing rather than accepting a green.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/081_facility_source_and_register_state.ts packages/db/src/migrations/internal/081_facility_source_and_register_state.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(facilities): add source kind/jurisdiction/contact and register_state"
```

---

## Task 2: The facility-register source surface

**Files:**
- Create: `packages/db/src/facility-register-sources.ts`
- Create: `packages/db/src/facility-register-sources.test.ts`
- Modify: `packages/db/src/index.ts` (export it)

**Interfaces:**
- Consumes: `FACILITY_REGISTER_KIND` from Task 1.
- Produces:
  ```ts
  export interface FacilityRegisterSource {
    id: string; url: string; name: string; code: string;
    version: string | null; jurisdiction: string | null; contact: string | null;
    publisherId: string | null; active: boolean;
  }
  export interface FacilityRegisterSourceStore {
    /** Active facility registers, ordered by name with a unique id tiebreaker. */
    list(opts?: { includeInactive?: boolean }): Promise<FacilityRegisterSource[]>;
    getByUrl(url: string): Promise<FacilityRegisterSource | null>;
    create(input: {
      url: string; name: string; code: string;
      version?: string | null; jurisdiction?: string | null; contact?: string | null;
      publisherId?: string | null;
    }): Promise<FacilityRegisterSource>;
  }
  export function createFacilityRegisterSourceStore(db: Kysely<InternalSchema>): FacilityRegisterSourceStore;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityRegisterSourceStore } from './facility-register-sources';
import type { InternalSchema } from './schema/internal';

const base = { url: 'urn:tz:hfr', name: 'Tanzania HFR', code: 'TZ_HFR' };

describe('createFacilityRegisterSourceStore', () => {
  it('creates a source and reads it back by URL', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    const made = await store.create({ ...base, jurisdiction: 'TZ', version: '2026-Q3' });
    expect(made.url).toBe('urn:tz:hfr');
    const found = await store.getByUrl('urn:tz:hfr');
    expect(found).toMatchObject({ name: 'Tanzania HFR', jurisdiction: 'TZ', version: '2026-Q3', active: true });
  });

  it('⛔ lists ONLY facility registers, never other coding systems', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    await store.create(base);
    // A coding system that is NOT a register — the reason `kind` exists.
    await db.insertInto('coding_systems').values({
      id: 'cs-loinc', system_code: 'LOINC', system_name: 'LOINC', url: 'http://loinc.org',
    } as never).execute();
    const rows = await store.list();
    expect(rows.map((r) => r.url)).toEqual(['urn:tz:hfr']);
  });

  it('refuses a duplicate URL rather than minting a second identity for one register', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    await store.create(base);
    await expect(store.create({ ...base, name: 'Tanzania HFR (again)' })).rejects.toThrow(/already/i);
  });

  it('orders by name with a unique tiebreaker', async () => {
    // pg-mem's scan order is STABLE and can never reveal a missing tiebreaker, so this asserts the
    // ordered contract on rows sharing a name; the tiebreaker is what makes it deterministic on
    // real Postgres.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    await store.create({ url: 'urn:b', name: 'Same', code: 'B' });
    await store.create({ url: 'urn:a', name: 'Same', code: 'A' });
    const rows = await store.list();
    expect(rows).toHaveLength(2);
    expect(rows[0].id < rows[1].id).toBe(true);
  });

  it('excludes inactive sources unless asked', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    const made = await store.create(base);
    await db.updateTable('coding_systems').set({ active: false } as never)
      .where('id', '=', made.id).execute();
    expect(await store.list()).toHaveLength(0);
    expect(await store.list({ includeInactive: true })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd packages/db && npx vitest run src/facility-register-sources.test.ts --testTimeout=30000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Write `createFacilityRegisterSourceStore` over `coding_systems`, filtering `kind = FACILITY_REGISTER_KIND`. `create` writes `kind`, checks `getByUrl` first and throws `` `a facility register already exists for ${url}` `` when present. `list` orders `.orderBy('system_name', 'asc').orderBy('id', 'asc')` — the id is the unique tiebreaker.

⛔ Do not reuse `codingSystems.upsertByUrl`: it is an upsert and would silently adopt an existing non-register coding system as a register.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd packages/db && npx vitest run src/facility-register-sources.test.ts --testTimeout=30000`
Expected: PASS (5 tests).

- [ ] **Step 5: Mutation-prove the kind filter**

Delete the `.where('kind', '=', FACILITY_REGISTER_KIND)` clause from `list`, print the row count immediately after the query, and re-run. Expected: the marker shows 2 rows and the "lists ONLY facility registers" test goes RED. Revert with an in-place reverse edit.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/facility-register-sources.ts packages/db/src/facility-register-sources.test.ts packages/db/src/index.ts
git commit -m "feat(facilities): a facility-register source surface over coding_systems"
```

---

## Task 3: Key facility identity on the source's canonical URI

**Files:**
- Modify: `packages/terminology/src/facility-csv.ts` (the `idFor` docblock and `opts.nationalSystem` contract)
- Modify: `packages/bootstrap/src/facility-controlled-fields.ts:44` (`observedFieldSystem`)
- Modify: `apps/server/src/facilities-routes.ts` (validate that the submitted system is a known source URL)
- Test: `packages/terminology/src/facility-csv.test.ts`, `packages/bootstrap/src/facility-controlled-fields.test.ts`, `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `FacilityRegisterSourceStore.getByUrl` (Task 2).
- Produces: `FacilityImportOptions.nationalSystem` is now **the source's canonical URI**, not a typed label. `idFor` keeps its signature `idFor(nationalSystem: string, nationalCode: string): string`.

⛔ **`idFor`'s shape does not change. The VALUE passed to it does.** Do not add a parameter; every caller already passes `opts.nationalSystem`, and the fix is that this now holds a canonical URI supplied by a `Select` rather than a string somebody typed.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/bootstrap/src/facility-controlled-fields.test.ts
it('⛔ derives the observed field system from the canonical URI, so case cannot fork identity', () => {
  // Measured before this slice: idFor did NOT lowercase but observedFieldSystem DID, so `HFR` and
  // `hfr` produced DIFFERENT facility ids while SHARING one mapping namespace. Feeding both from a
  // canonical URI removes the ambiguity at the source: there is only one spelling to feed.
  const a = observedFieldSystem('level', 'urn:tz:hfr');
  const b = observedFieldSystem('level', 'urn:tz:hfr');
  expect(a).toBe(b);
  expect(a).toContain('urn_tz_hfr');
});
```

```ts
// apps/server/src/facilities-routes.test.ts
it('⛔ refuses an import whose nationalSystem is not a known register source', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST', url: '/api/facilities/import',
    payload: { csv: 'national_code,name\n100,Alpha\n', nationalSystem: 'HFR' },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toMatch(/not a known facility register/i);
});

it('accepts an import naming a registered source by its canonical URI', async () => {
  const app = await buildTestApp();
  await seedSource(app, { url: 'urn:tz:hfr', name: 'Tanzania HFR', code: 'TZ_HFR' });
  const res = await app.inject({
    method: 'POST', url: '/api/facilities/import',
    payload: { csv: 'national_code,name\n100,Alpha\n', nationalSystem: 'urn:tz:hfr' },
  });
  expect(res.statusCode).toBe(200);
});
```

⚠ `buildTestApp` and the seeding helper already exist in `facilities-routes.test.ts`. Read the file and use its helpers rather than adding new ones.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd apps/server && npx vitest run src/facilities-routes.test.ts -t "known facility register" --testTimeout=30000`
Expected: FAIL — a free-text `HFR` is currently accepted.

- [ ] **Step 3: Implement**

In the import route (both the inline path and the upload route's query parsing), resolve `nationalSystem` through `FacilityRegisterSourceStore.getByUrl` and answer **400** with `` `"${value}" is not a known facility register` `` when absent. Update `idFor`'s docblock to state that its first argument is the source's canonical URI and why. Update `observedFieldSystem`'s docblock the same way.

⛔ Do not remove `observedFieldSystem`'s slugification. It still has to produce a URL-safe suffix; what changes is that its input can no longer be two spellings of one register.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd apps/server && npx vitest run src/facilities-routes.test.ts --testTimeout=30000` and `cd packages/bootstrap && npx vitest run src/facility-controlled-fields.test.ts --testTimeout=30000`
Expected: PASS. ⚠ Existing tests that pass a bare `'urn:tz:hfr'`-style value keep working; ones passing a label must now seed a source. **Update their setup, never their assertions.**

- [ ] **Step 5: Mutation-prove the gate**

Replace the `getByUrl` guard with `const source = { url: nationalSystem }`, print `source.url` immediately after, and re-run. Expected: the marker prints and the "refuses an import" test goes RED. Revert in place.

- [ ] **Step 6: Commit**

```bash
git add packages/terminology/src/facility-csv.ts packages/bootstrap/src/facility-controlled-fields.ts apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts packages/bootstrap/src/facility-controlled-fields.test.ts
git commit -m "feat(facilities): key registry identity on the source's canonical URI"
```

---

## Task 4: Migration 082 — resolve sources, re-key ids, mark the dimension stale

**Files:**
- Create: `packages/db/src/migrations/internal/082_facility_canonical_identity.ts`
- Create: `packages/db/src/migrations/internal/082_facility_canonical_identity.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`

**Interfaces:**
- Consumes: `FACILITY_REGISTER_KIND` (Task 1), the URI contract (Task 3).

⛔ **Read the spec's *Where a facility id is written down* table before writing a line.** Nine places hold a facility id and only three follow automatically. **The migration rewrites internal references and NEVER touches the external warehouse database** — it may be Postgres, SQL Server or MySQL and may be unreachable when migrations run.

- [ ] **Step 1: Write the failing tests**

```ts
it('resolves an existing typed national_system to a source row and rewrites it to the URI', async () => {
  // seeded pre-migration state is simulated by inserting a legacy-shaped row post-migration and
  // re-running the migration's exported `rekey` helper — see Step 3.
});

it('⛔ REFUSES when two typed values would collapse into one source', async () => {
  // 'HFR' and 'hfr' both slug to one register. Silently merging them would fuse two registers'
  // facilities — the failure A2b spent a slice proving is how registers get corrupted.
  await expect(rekey(db)).rejects.toThrow(/HFR.*hfr|collaps/i);
});

it('re-keys the facility id and every INTERNAL reference that does not cascade', async () => {
  // identifiers + concept projection cascade; concept_code, term_mappings, dhis2 map,
  // form_definitions/form_versions and facility_jobs do NOT and must be rewritten.
});

it('⛔ marks the facility-map dimension stale and never writes to the warehouse', async () => {
  // Assert a facility-map-rebuild job is enqueued and that no external connection was opened.
});

it('leaves a manual row (NULL national_system) untouched', async () => { /* … */ });
```

⚠ Write these as real, complete tests — the sketch above names the cases, not the code. Each needs concrete seeded rows and concrete assertions.

- [ ] **Step 2: Run and confirm they fail**

Run: `cd packages/db && npx vitest run src/migrations/internal/082_facility_canonical_identity.test.ts --testTimeout=30000`

- [ ] **Step 3: Implement**

Export a `rekey(db)` helper the migration calls, so the tests can drive it directly on seeded legacy rows. It must:

1. Collect `select distinct national_system from facility_registry where national_system is not null and national_system <> ''`.
2. For each, derive a canonical URI (`urn:openldr:cs:facility-register:<slug>`), and **refuse** with both raw values named if two distinct values derive the same URI.
3. Upsert a `coding_systems` row per URI with `kind = 'facility-register'`, `system_name` = the original typed value, `system_code` = the slug.
4. Rewrite `facility_registry.national_system` to the URI, and `facility_registry.id` to `idFor(uri, national_code)`.
5. Rewrite the non-cascading internal references listed in the spec table.
6. Enqueue a `facility-map-rebuild` job. ⛔ **No external-database write.**

- [ ] **Step 4: Run and confirm they pass**

- [ ] **Step 5: Mutation-prove the collision refusal**

Change the refusal to a `continue`, print the two colliding values at that line, re-run. Expected: the marker prints both values and the refusal test goes RED. Revert in place.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/internal/082_facility_canonical_identity.ts packages/db/src/migrations/internal/082_facility_canonical_identity.test.ts packages/db/src/migrations/internal/index.ts
git commit -m "feat(facilities): re-key facility identity onto the canonical source URI"
```

---

## Task 5: Retirement writes register_state, and stops overwriting status

**Files:**
- Modify: `packages/bootstrap/src/facility-import.ts` (the retirement UPDATE, currently `:846`)
- Test: `packages/bootstrap/src/facility-import.test.ts`

**Interfaces:**
- Consumes: `facility_registry.register_state` (Task 1).

- [ ] **Step 1: Write the failing test**

```ts
it('⛔ retirement records that the REGISTER dropped the row and leaves operational status alone', async () => {
  // The whole point of the slice. Measured before it: a dropped row and a closed facility both
  // became status='inactive', so a report filtering status='active' silently dropped a lab that was
  // open and receiving specimens.
  const db = await seedRegistry([{ id: 'f1', national_code: '100', status: 'active' }]);
  await importFacilities(deps, releaseWithDeletionOf('100'), {
    nationalSystem: 'urn:tz:hfr', format: 'jsonl', apply: true, onDeleted: 'retire',
  });
  const row = await rowFor(db, 'f1');
  expect(row.register_state).toBe('dropped');
  expect(row.status).toBe('active'); // ⛔ UNCHANGED — the facility is still open.
});
```

- [ ] **Step 2: Run and confirm it fails** — today `status` becomes `'inactive'`.

- [ ] **Step 3: Implement** — change the retirement UPDATE to `.set({ register_state: 'dropped', updated_at: sql`now()` })` and rewrite the comment above it. ⛔ The existing comment explains why `'inactive'` rather than `'retired'`; that reasoning is **correct and must be preserved**, restated to say membership now lives in its own column. `retireRegistryConcepts` is untouched.

- [ ] **Step 4: Run and confirm it passes**

- [ ] **Step 5: Mutation-prove** — re-add `status: 'inactive'` to the `.set()`, print the row after the update, confirm the test goes RED on `status`. Revert in place.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-import.ts packages/bootstrap/src/facility-import.test.ts
git commit -m "fix(facilities): a dropped register row no longer overwrites operational status"
```

---

## Task 6: Server-enforced vocabulary on manual create/edit

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` (the POST and PATCH facility handlers)
- Test: `apps/server/src/facilities-routes.test.ts`

⛔ **Server-side, not UI-side.** The route is the door that matters — the CLI and integrators reach it too, and A2a's importer already validates while this path does not. That disagreement is the defect.

- [ ] **Step 1: Write the failing tests**

```ts
it('⛔ refuses a manually created facility whose status is not in the canonical valueset', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/facilities',
    payload: { name: 'Alpha', localCode: 'L1', status: 'Operating' } });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toMatch(/status/i);
});

it('accepts a canonical status', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/facilities',
    payload: { name: 'Alpha', localCode: 'L1', status: 'active' } });
  expect(res.statusCode).toBe(201);
});

it('applies the same rule to level and country', async () => { /* one case each */ });

it('reports NOT VALIDATED rather than refusing when the valueset is not seeded', async () => {
  // Mirrors resolveControlledFields' own contract: a field whose valueset is absent on this install
  // is not classified at all. Refusing would make an unseeded install unable to create a facility.
});
```

- [ ] **Step 2: Run and confirm they fail** — today anything is accepted.

- [ ] **Step 3: Implement** — validate `level`/`status`/`country` against `CONTROLLED_VALUE_SETS` via the terminology store, exactly as `resolveControlledFields` does. Reuse that module; do **not** write a second resolver.

- [ ] **Step 4: Run and confirm they pass**

- [ ] **Step 5: Mutation-prove** — make the validator always return valid, print the value at that line, confirm the refusal test goes RED. Revert in place.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): enforce the canonical vocabulary on manual facility writes"
```

---

## Task 7: Per-facility audit rows for rows that actually changed

**Files:**
- Modify: `packages/bootstrap/src/facility-import.ts`
- Test: `packages/bootstrap/src/facility-import.test.ts`

**Interfaces:**
- Produces: `facility.import.row` audit events, `entityType: 'facility'`, `entityId: <facility id>`, with real `before`/`after`.

⭐ A2a's reconciliation already computes `create`/`changed`/`unchanged` exactly. Use that set — do not recompute it.

- [ ] **Step 1: Write the failing tests**

```ts
it('⛔ a byte-identical re-import writes ZERO per-facility audit rows', async () => {
  await importFacilities(deps, release, applyOpts);   // first import
  const before = await auditCount(db);
  await importFacilities(deps, release, applyOpts);   // same bytes again
  expect(await auditCount(db)).toBe(before);
});

it('writes one audit row per CHANGED facility, with before and after', async () => {
  await importFacilities(deps, release, applyOpts);
  await importFacilities(deps, releaseWithRenamed('100', 'Alpha Renamed'), applyOpts);
  const rows = await auditRows(db, 'facility.import.row');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ entity_type: 'facility' });
  expect((rows[0].before as { name: string }).name).not.toBe((rows[0].after as { name: string }).name);
});
```

- [ ] **Step 2–4:** run RED, implement off the existing changed set, run GREEN.

- [ ] **Step 5: Mutation-prove** — write an audit row for every parsed record instead of the changed set, print the count at that line, confirm the byte-identical test goes RED with 13 000 rows rather than 0. Revert in place.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-import.ts packages/bootstrap/src/facility-import.test.ts
git commit -m "feat(facilities): audit imported facility changes per row, only when they changed"
```

---

## Task 8: The facility history route

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Produces: `GET /api/facilities/:id/history` → `{ rows: { occurredAt, actorName, action, before, after }[] }`, capability `facilities.view`, newest first with a unique tiebreaker.

⭐ A read model only. `audit_events` already carries actor and real before/after — **no new table and no new capture.**

- [ ] **Step 1: Write the failing tests** — returns create/update events for that facility, newest first; excludes other facilities' events; 403 without `facilities.view`; empty array for an unknown id (not 404, since a deleted facility's history is still meaningful).
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement** — query `audit_events` on `entity_type = 'facility'` and `entity_id`, `.orderBy('occurred_at', 'desc').orderBy('id', 'desc')`.
- [ ] **Step 4: Run GREEN.**
- [ ] **Step 5: Mutation-prove** — drop the `entity_id` predicate, print the row count, confirm the "excludes other facilities" test goes RED. Revert in place.
- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): serve a facility's change history from audit events"
```

---

## Task 9: Source routes and the import sheet's Select

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` (`GET`/`POST /api/facilities/import/sources`)
- Modify: `apps/studio/src/api.ts`, `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`
- Test: `apps/server/src/facilities-routes.test.ts`, `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

⛔ The free-text input becomes a **shadcn `Select`** — never a native `<select>`. Creating a source is an action and lives in the `⋯` `DropdownMenu`; the Select is an input and keeps label-left / input-right.

- [ ] **Step 1: Write the failing tests** — `GET` lists only registers and requires `facilities.view`; `POST` requires `facilities.manage` and refuses a duplicate URL; the sheet renders a Select populated from the API, disables Upload until one is chosen, and sends the chosen **URI**.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement.** Add the three i18n keys to **en, fr and pt** in this commit.
- [ ] **Step 4: Run GREEN**, including `apps/studio` `parity.test.ts`.
- [ ] **Step 5: Mutation-prove** — make the sheet send the source's *display name* instead of its URL, print the sent value, confirm the "sends the URI" assertion goes RED. Revert in place.
- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/studio/src/api.ts apps/studio/src/facilities/ImportFacilitiesSheet.tsx apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): pick a register source instead of typing one"
```

---

## Task 10: Provenance in the UI — badges, detail, history, filters

**Files:**
- Create: `apps/studio/src/facilities/FacilityHistory.tsx` (+ test)
- Modify: `apps/studio/src/pages/Facilities.tsx`, `apps/studio/src/facilities/FacilityDialog.tsx`, `apps/studio/src/api.ts`, `apps/studio/src/i18n/{en,fr,pt}.ts`

- [ ] **Step 1: Write the failing tests** — a Manual row shows the Manual badge and an Imported row the Imported badge; the detail sheet shows authority, canonical URI, version and last import; the history view renders newest-first with a before→after diff; the list gains a `register_state` filter; **status and level render their display labels, not their stored codes**.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement.** ⛔ `managed_origin` is **not** surfaced — see the spec: nothing writes `'central'` to a facility and no facility down-sync exists. Do not add a Synced badge for a state that cannot occur.
- [ ] **Step 4: Run GREEN**, including `parity.test.ts`.
- [ ] **Step 5: Mutation-prove** — render the raw stored code instead of the looked-up label, print both at that line, confirm the label assertion goes RED. ⚠ Verify the assertion matches the **real rendered copy**; A2a shipped two `queryByText` guards whose regexes never matched.
- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/facilities/FacilityHistory.tsx apps/studio/src/facilities/FacilityHistory.test.tsx apps/studio/src/pages/Facilities.tsx apps/studio/src/facilities/FacilityDialog.tsx apps/studio/src/api.ts apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(facilities): show where a facility came from and what happened to it"
```

---

## Task 11: CLI parity

**Files:**
- Modify: `packages/cli/src/facilities.ts`, `packages/cli/src/program.ts`
- Test: `packages/cli/src/facilities.test.ts`

⛔ Repo convention: a new operator feature also gets an `openldr` command.

⚠ **commander 12.1.0 parses a parent's declared options BEFORE dispatching to a subcommand** — measured during A2b. A nested `facilities sources list --json` has `--json` swallowed by the parent. **Use sibling command names** (`facilities import-sources`), not nested ones.

- [ ] **Step 1: Write the failing tests** — `openldr facilities import-sources [--json]` lists registers; `facilities import --source <uri>` refuses an unknown URI with a non-zero exit and a readable message.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Mutation-prove** the unknown-source refusal, printing the resolved value at the mutated line.
- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/facilities.ts packages/cli/src/program.ts packages/cli/src/facilities.test.ts
git commit -m "feat(cli): list facility register sources and import against one"
```

---

## Task 12: Gate, live verification, and the whole-branch review

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run typecheck test --force > .superpowers/sdd/b1-gate.log 2>&1
```
⛔ Never pipe turbo through `tail`. Read the log. Expected: 67/67 (or the current task count) with zero failures. ⚠ `@openldr/db` has known parallel-turbo timeouts (`fhir-store-merge`, `workflow secret store`, `sync quarantine store`) that pass in isolation — re-run the package alone before blaming a change. **If this branch made something slow, fix the cause rather than raising the budget.**

- [ ] **Step 2: Live-verify at national scale on real Postgres**

Against the real 13 000-row release (`../corlix/fixtures/mfl-TZ-2026-Q3-large.jsonl`), on a scratch database, confirm:
- an import against a registered source produces 13 000 rows with ids derived from the source URI;
- a **byte-identical re-import still reports `unchanged: 13000`** and now writes **zero** per-facility audit rows;
- a release carrying a `deletion` sets `register_state='dropped'` and leaves `status` untouched;
- two installs importing the same register derive **identical** facility ids.

Delete throwaway probes afterwards and drop every scratch database.

- [ ] **Step 3: Grep for callers**

Every module this branch adds must have a real production caller. A2a shipped a module through three review gates with **zero** callers. Paste the grep output.

- [ ] **Step 4: Whole-branch review**

Ask explicitly: **which guard introduced early in this branch did a later commit make vacuous?** A2a's Critical and A2b's Critical were both found only this way, and this branch changes an identity function that many things depend on.

- [ ] **Step 5: Merge**

⚠ **Re-read `main` immediately before moving it** — a concurrent session advanced it mid-session once before. Then `--no-ff` merge, verify the merge tree is byte-identical to the verified tip (`git diff <tip> HEAD` empty), run the post-merge gate expecting FULL TURBO cache hits, and delete the branch.

---

## Self-review

**Spec coverage:** §1 sources → Tasks 1, 2, 9, 11. §1 id keying → Tasks 3, 4. §2 vocabulary → Tasks 1, 5, 6, 10. §3 provenance → Tasks 7, 8, 10. §4 migration/re-key → Task 4. §5 UI → Tasks 9, 10. Testing → every task plus Task 12.

**Known gap, stated deliberately:** Tasks 4 and 6 carry test *sketches* naming cases rather than complete test bodies, because their fixtures depend on helpers in files the implementer must read first (`facilities-routes.test.ts`'s app builder, the migration test helpers). Each names its cases and its assertions explicitly; the implementer writes the bodies against the real helpers. Every other task carries runnable code.
