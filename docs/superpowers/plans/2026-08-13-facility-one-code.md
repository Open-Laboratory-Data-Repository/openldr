# One Code, One System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `local_code` + `national_code` with one `facility_code` and the `facility_system`
that names it.

**Architecture:** Expand then contract, because a column rename cannot be landed in halves. Stage 1
ADDS the two new columns and backfills them, leaving the old pair in place and dual-written. Stages 2
to 4 move writers, readers, and the form onto the new fields. Stage 5 DROPS the old pair. Every stage
ends green and landable on its own; nothing is half-renamed at any commit.

**Tech Stack:** TypeScript, Kysely, Postgres, pg-mem, Vitest, React 18, Fastify.

## Global Constraints

- **Every stage lands green.** `pnpm turbo run test` and `pnpm turbo run typecheck` both pass before
  each commit. A stage that only compiles because the next one is coming is not a stage.
- **Typecheck is the completeness proof for the renames.** `FacilityRecord` is camelCase TypeScript,
  so every consumer site is a compile error until it moves. Do not hunt with grep and hope.
- **No id ever moves.** `facility_concept_projection.registry_id`, `facility_jobs.registry_id`,
  `facility_map.registry_id` and `audit_events.entity_id` all point at ids; the whole design exists so
  none of them has to change.
- **Fork B**: `facility_map` (external database) is NOT touched. It keeps its own `local_code` and
  `national_code`, and the registry's single code is written into both. Decided from the measurement
  in the spec — `column_exposure_policy` holds explicit rows for those two columns.
- **Seven migrations are frozen snapshots** — internal 070/071/073/077/082/085 and external 012
  record what the schema *was*. New migrations alter; they never edit those.
- **Check the free migration number when you get there.** 085 is the highest today. This plan uses
  086 (schema) and 087 (form); a branch merging first makes both wrong, and a gap blocks boot.
- Full gate is `pnpm turbo run test`. **Never pipe turbo through `tail`.** A failure is usually a
  timeout: grep for `Test timed out` and re-run that package alone.
- `apps/server` is the only package with real lint.
- Never add a `Co-Authored-By` trailer. Commit per stage; do not push.

---

## Measured before writing this (dev install, 2026-08-13)

| | |
|---|---|
| Saved report / query / dashboard references to either column | **0** |
| Facilities carrying BOTH codes | **0** |
| Facilities with a NULL `national_system` | **1** |
| Value mappings under an empty system namespace | **0** |

Re-measure on any other install before migrating it. The rules below still handle all four cases —
they are defensive here, not dead.

---

## Stage 1 — Add the columns, backfill, register the local system

Adds `facility_system` and `facility_code`, backfills them, and constrains the pair. The old columns
stay and stay written. Nothing else in the codebase changes behaviour.

**Files:**
- Create: `packages/db/src/migrations/internal/086_facility_one_code.ts` + `.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`
- Modify: `packages/db/src/schema/internal.ts:240-262`
- Modify: `packages/db/src/facility-registry-store.ts` (`toRow`/`toRecord`)
- Modify: `packages/db/src/facility-answers.ts:19-23` (`CORE_FACILITY_KEYS`)

**Interfaces:**
- Produces: `FacilityRecord.facilityCode?: string | null` and `.facilitySystem?: string | null`,
  alongside the existing `localCode` / `nationalCode` / `nationalSystem`.
- Produces: `LOCAL_FACILITY_REGISTER_URL = 'urn:openldr:facility:local'` exported from
  `packages/db/src/facility-register-sources.ts`.

- [ ] **Step 1: Confirm 086 is free**

```bash
ls packages/db/src/migrations/internal/ | grep -E '^08[5-9]_' | grep -v test
```

Expected: `085_facility_national_code_field.ts` and nothing higher.

- [ ] **Step 2: Write the failing migration test**

Create `packages/db/src/migrations/internal/086_facility_one_code.test.ts`. Follow 085's idiom —
`makeMigratedDb()` runs every migration, so seed rows through `db.insertInto` and assert on the
result.

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

const row = (over: Record<string, unknown>) => ({
  id: 'f-' + String(over.id ?? '1'), name: 'A', source: 'manual', ...over,
});

describe('086_facility_one_code', () => {
  it('backfills the national pair when there is one', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never).values(
      row({ id: 'nat', national_system: 'urn:zm:mfl', national_code: '2445' }) as never,
    ).execute();
    const r: any = await db.selectFrom('facility_registry' as never).selectAll()
      .where('id' as never, '=', 'f-nat').executeTakeFirstOrThrow();
    expect(r.facility_code).toBe('2445');
    expect(r.facility_system).toBe('urn:zm:mfl');
    await db.destroy();
  });

  it('backfills a local-only row onto the install-local register', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never).values(
      row({ id: 'loc', local_code: '111317-4' }) as never,
    ).execute();
    const r: any = await db.selectFrom('facility_registry' as never).selectAll()
      .where('id' as never, '=', 'f-loc').executeTakeFirstOrThrow();
    expect(r.facility_code).toBe('111317-4');
    expect(r.facility_system).toBe('urn:openldr:facility:local');
    await db.destroy();
  });

  it('⛔ keeps the NATIONAL pair when a row carries both, parking the local code in extras', async () => {
    // Measured 0 such rows on the dev install, but the importer preserves a hand-assigned local code
    // through re-import (facility-classify.ts:38-41), so a live deployment can have them. Losing one
    // silently would be worse than refusing to migrate.
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never).values(
      row({ id: 'both', local_code: 'LAB01', national_system: 'urn:zm:mfl', national_code: '2445' }) as never,
    ).execute();
    const r: any = await db.selectFrom('facility_registry' as never).selectAll()
      .where('id' as never, '=', 'f-both').executeTakeFirstOrThrow();
    expect(r.facility_code).toBe('2445');
    expect(r.facility_system).toBe('urn:zm:mfl');
    const extras = typeof r.extras === 'string' ? JSON.parse(r.extras) : r.extras;
    expect(extras.__localCode).toBe('LAB01');
    await db.destroy();
  });

  it('registers the install-local system as a real facility register', async () => {
    // ⛔ Otherwise the one migrated local-only row names a system that
    // `resolveFacilityRegisterForImport` cannot resolve, and its next edit is refused with
    // "is not a known facility register" — a row made uneditable by its own migration.
    const db = await makeMigratedDb();
    const cs: any = await db.selectFrom('coding_systems' as never).selectAll()
      .where('url' as never, '=', 'urn:openldr:facility:local').executeTakeFirst();
    expect(cs).toBeTruthy();
    expect(cs.kind).toBe('facility-register');
    await db.destroy();
  });

  it('leaves the old columns in place — this migration only ADDS', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never).values(
      row({ id: 'keep', national_system: 'urn:zm:mfl', national_code: '9' }) as never,
    ).execute();
    const r: any = await db.selectFrom('facility_registry' as never).selectAll()
      .where('id' as never, '=', 'f-keep').executeTakeFirstOrThrow();
    expect(r.national_code).toBe('9');
    expect(r.local_code).toBeNull();
    await db.destroy();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
pnpm --filter @openldr/db test -- 086_facility_one_code
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write migration 086**

```ts
import { Kysely, sql } from 'kysely';

// One code, one system. `local_code` (OURS) and `national_code` (THEIRS) collapse into
// `facility_code` plus the `facility_system` that names it — which is what `Location.identifier`
// already is, and what removes the `localCode ?? nationalCode` fallback that made the Facilities
// table and the Edit sheet disagree about which code a facility has.
//
// ⛔ ADDITIVE ONLY. The old columns stay, and stay written, until a later migration drops them. A
// column rename cannot land in halves, so this one expands and a later one contracts.
//
// ⛔ NO ROW IS RE-KEYED. `idFor` is a write key, not an identity contract — nothing looks a row up by
// recomputing it (facility-import.ts matches on ids the parser stamped). So
// facility_concept_projection, facility_jobs, facility_map and audit_events all keep pointing at rows
// that never moved.

/** The register a facility belongs to when it is not in any national list. Registered as a real
 *  `coding_systems` row below: `resolveFacilityRegisterForImport` refuses a system it cannot resolve,
 *  so a migrated row naming an UNregistered system would be uneditable from the moment it migrated. */
const LOCAL_REGISTER_URL = 'urn:openldr:facility:local';

export async function up(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;

  await d.schema.alterTable('facility_registry').addColumn('facility_system', 'text').execute();
  await d.schema.alterTable('facility_registry').addColumn('facility_code', 'text').execute();

  // Register the local system BEFORE backfilling onto it, so the two writes cannot disagree if this
  // migration is interrupted between them.
  await sql`
    insert into coding_systems (id, system_code, system_name, url, kind, seeded)
    values ('cs-freg-openldr-local', 'OPENLDR_LOCAL', 'This installation (local facilities)',
            ${LOCAL_REGISTER_URL}, 'facility-register', true)
    on conflict (url) do nothing`.execute(d);

  // The national pair wins wherever it exists — it is the register's identity, and the importer is
  // authoritative for it. A local code that would otherwise be lost is parked, never dropped.
  await sql`
    update facility_registry
       set extras = coalesce(extras, '{}'::jsonb) || jsonb_build_object('__localCode', local_code)
     where local_code is not null and national_code is not null`.execute(d);

  await sql`
    update facility_registry
       set facility_code   = coalesce(national_code, local_code),
           facility_system = case when national_code is not null
                                  then coalesce(national_system, ${LOCAL_REGISTER_URL})
                                  else ${LOCAL_REGISTER_URL} end`.execute(d);

  // Only now can they be NOT NULL: `facility_registry_has_a_code` guaranteed at least one source
  // column, so every row has a value by this point.
  await sql`alter table facility_registry alter column facility_code set not null`.execute(d);
  await sql`alter table facility_registry alter column facility_system set not null`.execute(d);

  await d.schema
    .createIndex('facility_registry_system_code_unique')
    .unique()
    .on('facility_registry')
    .columns(['facility_system', 'facility_code'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;
  await d.schema.dropIndex('facility_registry_system_code_unique').execute();
  await d.schema.alterTable('facility_registry').dropColumn('facility_code').execute();
  await d.schema.alterTable('facility_registry').dropColumn('facility_system').execute();
  await sql`delete from coding_systems where url = ${LOCAL_REGISTER_URL}`.execute(d);
  // `extras.__localCode` is deliberately NOT stripped: it is a copy of a column that still exists, so
  // leaving it costs nothing, and removing it would edit rows this down() did not create.
}
```

Register it in `packages/db/src/migrations/internal/index.ts` (import + map entry) and add
`'086_facility_one_code'` to the ordered list pinned in
`packages/db/src/migrations/migrations.test.ts` — 085 is already there and shows the shape.

⚠ Confirm `coding_systems` really has `kind` and `seeded` columns before writing that insert; migration
081 added `kind`. If the column list differs, match it — do not invent one.

- [ ] **Step 5: Widen the types and the store**

`packages/db/src/schema/internal.ts:240-262` — add both columns above the pair they replace:

```ts
export interface FacilityRegistryTable {
  id: string;
  /** The register this facility is listed in, by canonical URI. With `facility_code`, the row's
   *  identity — unique as a pair. */
  facility_system: string;
  /** The code that register carries for this facility. */
  facility_code: string;
  /** @deprecated Superseded by `facility_code`/`facility_system`; dropped in a later migration. */
  local_code: string | null;
  national_system: string | null;
  /** @deprecated Superseded by `facility_code`. */
  national_code: string | null;
  // …unchanged from here
```

`facility-registry-store.ts` — `toRecord` gains the two fields; `toRow` writes BOTH shapes so an
older reader keeps working through the transition:

```ts
    facilityCode: r.facility_code,
    facilitySystem: r.facility_system,
```

```ts
    // Dual-write through the transition. `facility_code` is authoritative; the old pair is kept in
    // step so anything still reading it sees the same value. Stage 5 deletes this.
    facility_code: rec.facilityCode ?? rec.nationalCode ?? rec.localCode ?? '',
    facility_system: rec.facilitySystem ?? rec.nationalSystem ?? 'urn:openldr:facility:local',
    local_code: rec.localCode ?? null,
    national_system: rec.nationalSystem ?? null,
    national_code: rec.nationalCode ?? null,
```

Add `facilityCode` and `facilitySystem` to `CORE_FACILITY_KEYS`
(`packages/db/src/facility-answers.ts:19-23`) and to `FacilityRecord`
(`facility-registry-store.ts:18-25`). Leave the old keys in place — Stage 5 removes them.

- [ ] **Step 6: Run**

```bash
pnpm --filter @openldr/db test && pnpm turbo run typecheck
```

Expected: PASS, including the five new migration tests.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(facilities): add facility_code and facility_system alongside the pair they replace"
```

---

## Stage 2 — Writers produce the new fields

Everything that CREATES a facility record sets `facilityCode`/`facilitySystem`. The old fields are
still written by the store, so reads are unaffected.

**Files:**
- `packages/terminology/src/facility-csv.ts:413-416`, `facility-release.ts:175`
- `packages/bootstrap/src/facility-import.ts`, `facility-classify.ts`
- `apps/server/src/facilities-routes.ts` (POST/PUT)
- `packages/cli/src/facilities.ts`
- their tests

- [ ] **Step 1: Change the parsers**

In `facility-csv.ts`, the record gains the two fields beside the ones it already sets:

```ts
    records.push({
      id: idFor(opts.nationalSystem, nationalCode),
      facilitySystem: opts.nationalSystem,
      facilityCode: nationalCode,
      nationalSystem: opts.nationalSystem,
      nationalCode,
      name,
```

Same shape in `facility-release.ts:175`.

- [ ] **Step 2: Teach the importer to match on the pair**

This is the load-bearing change of the whole slice — it is what makes "no id ever moves" true.

In `packages/bootstrap/src/facility-import.ts`, `loadExisting` currently resolves
`WHERE id IN (...)`. Add a second resolution by `(facility_system, facility_code)` and prefer an
existing row's id over the derived one:

```ts
/**
 * Derived id -> the id of the row already holding that `(facility_system, facility_code)`.
 *
 * ⛔ The unique PAIR is the identity; the id is only a write key.
 *
 * A facility registered by hand carries a `randomUUID` id, so a later import of the same register
 * derives an id that does not match and would try to INSERT — colliding with
 * `facility_registry_system_code_unique` and failing the row. Resolving by the pair first adopts the
 * existing row instead, which is why no migration and no edit ever has to re-key anything.
 *
 * Chunked on the same `CHUNK` bound `loadExisting` uses, for the same reason: a national release runs
 * 13k rows and the driver has a parameter ceiling. Two parameters per record here, not one.
 *
 * Runs INSIDE the write transaction (see the caller): a lookup before it opens would let a
 * concurrent create slip between the lookup and the write.
 */
async function resolveIdsByPair(
  exec: Kysely<InternalSchema>, records: FacilityRecord[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = records.filter((r) => r.facilitySystem && r.facilityCode);
  for (const chunk of chunkArray(wanted, Math.floor(CHUNK / 2))) {
    const rows = await exec
      .selectFrom('facility_registry')
      .select(['id', 'facility_system', 'facility_code'])
      .where((eb) => eb.or(chunk.map((r) => eb.and([
        eb('facility_system', '=', r.facilitySystem!),
        eb('facility_code', '=', r.facilityCode!),
      ]))))
      .execute();
    const byPair = new Map(rows.map((r) => [`${r.facility_system} ${r.facility_code}`, r.id]));
    for (const r of chunk) {
      const existing = byPair.get(`${r.facilitySystem} ${r.facilityCode}`);
      // Only a row whose id DIFFERS is worth recording — the common case (an imported row keyed by
      // the same derivation) needs no remapping at all.
      if (existing !== undefined && existing !== r.id) out.set(r.id, existing);
    }
  }
  return out;
}
```

Apply it to each record before `classifyFacilityRows` runs, so classification, `loadExisting` and the
write all agree on the same id:

```ts
    const remap = await resolveIdsByPair(trx, records);
    const keyed = remap.size === 0
      ? records
      : records.map((r) => (remap.has(r.id) ? { ...r, id: remap.get(r.id)! } : r));
```

⚠ `chunkArray` is this module's existing `chunk` helper — reuse it rather than adding a second one.
Half the usual bound because each record contributes two bind parameters, not one. Getting that wrong
reads as `bind message has N parameter formats but 0 parameters`, not as "too many parameters".

- [ ] **Step 3: Route and CLI**

`facilities-routes.ts` POST already derives its id from `(nationalSystem, nationalCode)`. Switch it to
read `facilitySystem`/`facilityCode` from the record, and drop the PUT guard that refuses setting a
national code — with pair-matching, changing a facility's system or code is safe, because the next
import resolves by the pair rather than by the id.

⚠ Keep the register gate (`resolveFacilityRegisterForImport`). A system that is not a registered
register must still be refused, on both POST and PUT.

- [ ] **Step 4: Run**

```bash
pnpm turbo run test && pnpm turbo run typecheck
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(facilities): writers set facility_code/facility_system, and the importer matches on the pair"
```

---

## Stage 3 — Readers use the single code

**Files:**
- `packages/db/src/facility-observed.ts:150-172` — `registryPreferredCode` and `RegistryRowForConcept`
- `packages/bootstrap/src/facility-reconcile.ts` (29 references)
- `packages/bootstrap/src/facility-mapping-suggest.ts`
- `apps/studio/src/pages/Facilities.tsx:967`, `facilities/FacilityDialog.tsx`, `facilities/ObservedTab.tsx`, `api.ts`
- `packages/dashboards/src/models/registry.ts` (comment only — fork B leaves `facility_map` alone)

- [ ] **Step 1: Collapse the preferred-code rule**

```ts
/**
 * A registry row's operator-facing code.
 *
 * Was `localCode ?? nationalCode`. That fallback is gone with the second column: a row has ONE code.
 * The fallback is what made the Facilities table show a code the Edit sheet could not bind — the
 * defect this whole arc started from.
 *
 * Still exported: `projectRegistryRows` needs to derive a candidate code the same way when it goes
 * looking for rows that might collide with it.
 */
export function registryPreferredCode(row: { facilityCode?: string | null }): string | null {
  return row.facilityCode ?? null;
}
```

The in-batch collision guard in `registryConceptRows` **stays**. Two rows under different systems can
still share a code, and concepts are keyed on `(system, code)` alone — the same five-Aga-Khans defect
that guard exists for.

- [ ] **Step 2: Let typecheck drive the rest**

```bash
pnpm turbo run typecheck
```

Every remaining `localCode` / `nationalCode` read is now an error or a stale field. Work the list to
zero. **Do not grep-and-replace** — `facility_map.local_code` (external, fork B) and
`extras.__localCode` legitimately keep the old name.

- [ ] **Step 3: Studio**

`Facilities.tsx:967` becomes `{f.facilityCode}` — no fallback. The CODE column header may now
usefully carry the system alongside it; check with the operator before adding a column.

- [ ] **Step 4: Run and commit**

```bash
pnpm turbo run test && pnpm turbo run typecheck
git commit -am "refactor(facilities): readers use the single facility code"
```

---

## Stage 4 — The form, page targets, and the Settings default

**Files:**
- Create: `packages/db/src/migrations/internal/087_facility_form_one_code.ts` + `.test.ts`
- `packages/forms/src/samples/forms.ts`, `samples/forms.test.ts`, `packages/db/src/index.ts:102`
- `packages/forms/src/page-targets.ts:30-40`
- `apps/server/src/settings-routes.ts:17-20`, `apps/studio/src/pages/settings/Laboratory.tsx`
- `apps/studio/src/facilities/FacilityDialog.tsx`

- [ ] **Step 1: Migration 087 — the form snapshot**

Mirror `085_facility_national_code_field.ts` structure for structure — `PREV_BOUND_FIELDS_SNAPSHOT`
copied verbatim from 085's exported one, `BOUND_FIELDS_SNAPSHOT` exported, a `__migration087` marker,
`repointForm`/`unrepointForm`, and the same `stableStringify`/`sortValue` pair copied rather than
imported. It rewrites only a form whose fields deep-equal 085's snapshot. The new field list:

| order | id | apiProperty | required |
|---|---|---|---|
| 0 | `fld-fac-system` | `facilitySystem` | **yes** |
| 1 | `fld-fac-code` | `facilityCode` | **yes** |
| 2 | `fld-fac-name` | `name` | **yes** |
| 3+ | country, zone, region, district, council, status, level | unchanged | unchanged |

`fld-fac-national-code`, `fld-fac-national-system` and `fld-fac-local-code` are **removed**. Export
`BOUND_FIELDS_SNAPSHOT` and repoint `FACILITY_FORM_MIGRATION_BOUND_FIELDS`
(`packages/db/src/index.ts:102`) at 087, then move `packages/forms/src/samples/forms.ts` to match
exactly — the pin that catches the desync lives on the forms side.

- [ ] **Step 2: Page targets**

`packages/forms/src/page-targets.ts:40`:

```ts
  { id: 'facilities', label: 'Facilities', match: 'apiProperty', requiredKeys: ['facilitySystem', 'facilityCode', 'name'], available: true },
```

Rewrite the doc comment at `:30-33`. It currently justifies requiring `localCode` with *"A template
has no field for national_code"*, which migration 085 already made false.

- [ ] **Step 3: `lab.facilitySystem`**

Add to the settings schema beside `lab.logo` (`apps/server/src/settings-routes.ts:17-20`):

```ts
  'lab.facilitySystem': z.string().optional(),
```

On the Settings → Laboratory page, render it as a **picker over
`/api/facilities/import/sources`**, never a text box:

```
⛔ A typed register label mints a second permanent identity for one register — `idFor` hashes the
system string without normalising it. That is the defect migration 082 had to clean up.
```

`FacilityDialog` defaults the System field from this setting on create.

- [ ] **Step 4: Run and commit**

```bash
pnpm turbo run test && pnpm turbo run typecheck
git commit -am "feat(facilities): one code on the form, and the register default lives in Settings"
```

---

## Stage 5 — Drop the old columns

Only after stages 1-4 have landed and the live check below has passed once.

- [ ] **Step 1: Migration 088 — drop the old pair**

```ts
import { Kysely, sql } from 'kysely';

// Contract half of the expand/contract begun in 086. Every reader and writer moved to
// `facility_code`/`facility_system` in stages 2-4; these columns have been dead weight since.
//
// ⛔ down() CANNOT restore the data. It rebuilds the columns and the constraints so a schema
// rollback is possible, but the values are gone — `facility_code` alone cannot say whether a code
// was once local or national. A `extras.__localCode` written by 086 is the only survivor, and only
// for rows that carried both. Restore from a backup, not from here.
export async function up(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;
  // Constraints and indexes first: dropping a column out from under them is engine-dependent.
  await sql`alter table facility_registry drop constraint if exists facility_registry_has_a_code`.execute(d);
  await sql`drop index if exists facility_registry_national_unique`.execute(d);
  await d.schema.alterTable('facility_registry').dropColumn('local_code').execute();
  await d.schema.alterTable('facility_registry').dropColumn('national_code').execute();
  await d.schema.alterTable('facility_registry').dropColumn('national_system').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;
  await d.schema.alterTable('facility_registry').addColumn('local_code', 'text', (c) => c.unique()).execute();
  await d.schema.alterTable('facility_registry').addColumn('national_system', 'text').execute();
  await d.schema.alterTable('facility_registry').addColumn('national_code', 'text').execute();
  // The CHECK is NOT restored: it asserts a code exists in columns this down() leaves empty, so
  // re-adding it would refuse every existing row.
}
```

⚠ `local_code` carried a UNIQUE constraint created inline by 070, so dropping the column drops it
too — that is why only the named CHECK and the partial index need explicit statements.

- [ ] **Step 2: Remove the dual-write** from `toRow`, the deprecated fields from
      `FacilityRegistryTable` and `FacilityRecord`, and the old keys from `CORE_FACILITY_KEYS`.

- [ ] **Step 3: Run and commit**

```bash
pnpm turbo run test && pnpm turbo run typecheck
git commit -am "refactor(facilities): drop local_code and national_code"
```

---

## Stage 6 — Live verification, with the mouse

- [ ] **Step 1: Full gate.** `pnpm turbo run test`, not piped through `tail`.

- [ ] **Step 2: Re-measure before migrating.** On the install being migrated, count rows carrying both
      codes, rows with a NULL `national_system`, and value mappings under an empty system namespace.
      The dev numbers were 0 / 1 / 0; another install may differ.

- [ ] **Step 3: The Zambia register.** With `AUTH_DEV_BYPASS` on (announce it, restore it after), the
      3788 rows should carry `facility_system = urn:zm:mfl` and `facility_code` = their MFL code.
      Open one, press Save, change nothing — it must save.

- [ ] **Step 4: Adoption, which no longer exists as a special case.** Take the hand-made facility,
      set its System to the Zambia register and its code to one in the file, save. Re-import the
      register. The row must be **updated**, not duplicated and not failed. This is the test the whole
      pair-matching design exists for.

- [ ] **Step 5: Real Postgres.** Two facilities under the same `(system, code)` must be refused.
      pg-mem cannot show this.

- [ ] **Step 6: Report.** Per step, the action and its outcome. Anything not produced by a click or a
      command is written down as **HONEST NON-PROOF**. Restore `AUTH_DEV_BYPASS=false` and say so.

---

## Not in this plan

- **Merging `facility_map`'s code columns** — fork A, deferred. `column_exposure_policy` holds
  explicit rows for both; a rename must carry them or the Data Exposure policy silently stops
  covering the column.
- **Re-keying rows to derive ids uniformly.** Unnecessary once the importer matches on the pair.
- **Storing codes instead of displays** for level/status/country. Open from slice 1.
