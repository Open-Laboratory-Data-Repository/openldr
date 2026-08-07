# Facilities Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four Facilities defects that can silently corrupt master data, silently break an existing facility mapping, or emit a bogus delete to a downstream lab — with a regression test for each that fails against current code.

**Architecture:** Four independent slices. Slice 1 removes `facility_registry` from the sync bus at all three points (capture, serve, apply) and purges its history. Slice 2 makes the CSV parser quarantine structurally malformed rows instead of column-shifting them. Slice 3 introduces a durable `registry_id → concept_code` link table and routes both projection paths through one function that transactionally migrates `term_mappings` whenever a facility's projected code moves. Slice 4 filters resolution to `SAME-AS`, reports ambiguity instead of picking a winner, and backs the invariant with a partial unique index.

**Tech Stack:** TypeScript, Kysely (Postgres for the internal DB), vitest, csv-parse, React + shadcn/ui (Studio), Fastify (server).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-07-facilities-phase-0-design.md`. Read it before Task 1.
- **No UI redesign.** Slice 2's import sheet changes are the only Studio work, and only to surface line-level errors and disable Apply. Nothing else in Facilities changes visually.
- **Migration numbers are fixed:** `076` (Slice 1), `077` (Slice 3), `078` (Slice 4). All internal, under `packages/db/src/migrations/internal/`.
- **Internal DB is Postgres-only.** No MSSQL/MySQL branches in internal migrations.
- **Migrations inline their constants**, never import live ones — a migration is a frozen snapshot. Follow `075_facility_registry_coding_system.ts`'s pattern and its `⛔ Deliberately INLINED` comment.
- **Never write new `reference_change_log` rows from a migration.** Deleting is safe; inserting perturbs the global `seq` and every site's `pendingPush` baseline.
- **`term_mappings` is authoritative; `concept_map_elements` is a mirror.** Any write to `term_mappings` must go through `admin.termMappings.*` so the mirror and `reference_change_log` capture both happen. Never `UPDATE term_mappings` directly.
- **CLI parity:** any new operator-facing capability needs an `openldr` command too.
- **Commit trailer:** never add `Co-Authored-By: Claude` or any AI co-author trailer.
- **Gate:** `pnpm turbo run typecheck test --force`. Never pipe turbo through `tail` — the shell reports tail's exit code. Redirect to a log and echo `$?`.
- Each slice merges to local `main` with `--no-ff`.

---

# Slice 1 — Contain the `facility_registry` sync half-state

**Invariant:** an entity type with no apply support must not appear in a sync payload at all, in any form, including as a delete.

### Task 1: Stop capture, and close serve and apply

**Files:**
- Modify: `packages/db/src/reference-change-log.ts:8-33`
- Modify: `packages/db/src/facility-registry-store.ts:273`, `:281`
- Modify: `packages/db/src/reference-apply.ts:313-341`
- Modify: `packages/bootstrap/src/sync-serve.ts:44-73`, `:149-154`
- Modify: `packages/bootstrap/src/index.test.ts` (the `referenceCapture` list pin, ~`:123`)
- Test: `packages/db/src/facility-registry-store.test.ts`, `packages/bootstrap/src/sync-serve.test.ts`, `packages/db/src/reference-apply.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ReferenceEntityType` no longer includes `'facility_registry'`. `SUSPENDED_REFERENCE_ENTITY_TYPES: readonly string[]` exported from `packages/db/src/reference-change-log.ts` — Slice 1's serve and apply guards both read it, and Task 2's migration inlines its own copy of the string.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/facility-registry-store.test.ts`, replace the existing capture assertions (currently at `:35-36`, which assert `facility_registry` upsert/delete records ARE written) with the inverse. Delete those two expectations and add:

```ts
it('does not capture facility_registry into reference_change_log (sync suspended)', async () => {
  const captured: { entityType: string; entityId: string; op: string }[] = [];
  const store = createFacilityRegistryStore(db, {
    record: async (_trx, entityType, entityId, op) => { captured.push({ entityType, entityId, op }); },
  });

  await store.upsert({ id: 'f9', name: 'Clinic', localCode: 'L9' } as never);
  await store.remove('f9');

  expect(captured).toEqual([]);
});
```

In `packages/bootstrap/src/sync-serve.test.ts`:

```ts
it('emits NO record for a legacy facility_registry change_log row — not even a delete', async () => {
  // A row logged before the entity type was suspended. Before this fix, fetchReferenceBody had no
  // case for it, returned null, and sync-serve.ts:66 turned it into a DELETE instruction the lab
  // would apply against a table central never served it a row for.
  await ctx.internalDb.insertInto('reference_change_log').values({
    entity_type: 'facility_registry', entity_id: 'fac-legacy', op: 'upsert', content_hash: 'h',
  } as never).execute();

  const { records } = await serveReferenceChanges(ctx, 0);

  expect(records.filter((r) => r.entityType === 'facility_registry')).toEqual([]);
});
```

In `packages/db/src/reference-apply.test.ts`:

```ts
it('rejects a suspended facility_registry record by name, not as an unknown entity', async () => {
  const apply = createReferenceApplier(db);
  await expect(
    apply({ seq: 1, entityType: 'facility_registry' as never, entityId: 'fac-1', op: 'upsert', body: {} }),
  ).rejects.toThrow(/facility_registry.*suspended/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/db exec vitest run src/facility-registry-store.test.ts src/reference-apply.test.ts
```

Expected: FAIL — the store test sees two captured records; the apply test throws `unknown entityType` (wrong message).

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/sync-serve.test.ts
```

Expected: FAIL — one record with `op: 'delete'` for `fac-legacy`.

- [ ] **Step 3: Suspend the entity type**

In `packages/db/src/reference-change-log.ts`, remove `| 'facility_registry'` from the union (`:24`) and `'facility_registry',` from `ENTITY_TYPES` (`:32`), and add below them:

```ts
/**
 * Entity types whose change capture is DELIBERATELY suspended: they were registered on the bus
 * before their serve/apply support existed, which made an upsert with no body resolver serve as a
 * bogus DELETE (`packages/bootstrap/src/sync-serve.ts` — a null body downgrades to a delete). The
 * type is named here rather than merely deleted from `ENTITY_TYPES` so serve and apply can both
 * refuse it EXPLICITLY: an older central still holds logged rows for it, and "not in the union" is a
 * compile-time fact that does nothing about a payload already on the wire.
 *
 * ⛔ Re-enabling one of these means landing its serve case, its apply case, and a central→lab
 * integration test in the SAME change. Do not re-add it to `ENTITY_TYPES` alone.
 */
export const SUSPENDED_REFERENCE_ENTITY_TYPES: readonly string[] = ['facility_registry'];
```

- [ ] **Step 4: Stop capture in the store**

In `packages/db/src/facility-registry-store.ts`, delete the two capture calls at `:273` and `:281`, replacing each with a comment:

```ts
        // Capture SUSPENDED — see SUSPENDED_REFERENCE_ENTITY_TYPES in reference-change-log.ts. The
        // `capture` dep stays on this store's interface so re-enabling is one line, not a re-wiring.
```

Leave the `capture` parameter and its type in place.

- [ ] **Step 5: Close serve and apply**

In `packages/bootstrap/src/sync-serve.ts`, inside the `for (const r of latest.values())` loop, immediately after `const seq = Number(r.seq);` (`:46`):

```ts
    // A suspended type can still have rows in an existing install's log. Skip it BEFORE the delete
    // branch below — `fetchReferenceBody` has no case for it, so falling through would emit a
    // delete the lab has no applier for.
    if (SUSPENDED_REFERENCE_ENTITY_TYPES.includes(entityType)) continue;
```

Import `SUSPENDED_REFERENCE_ENTITY_TYPES` from `@openldr/db`.

In `packages/db/src/reference-apply.ts`, immediately before the `switch (rec.entityType)` at `:313`:

```ts
    if (SUSPENDED_REFERENCE_ENTITY_TYPES.includes(rec.entityType)) {
      throw new Error(
        `applyReferenceChange: entityType ${rec.entityType} is suspended — its serve/apply support ` +
        `is not implemented. See SUSPENDED_REFERENCE_ENTITY_TYPES in reference-change-log.ts.`,
      );
    }
```

- [ ] **Step 6: Update the referenceCapture pin deliberately**

`packages/bootstrap/src/index.test.ts` (~`:123`) pins the list of stores wired for reference capture. Remove the facility registry entry and add a comment on the line above:

```ts
    // facility_registry is absent DELIBERATELY — capture suspended, see
    // SUSPENDED_REFERENCE_ENTITY_TYPES in @openldr/db's reference-change-log.ts.
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/db exec vitest run src/facility-registry-store.test.ts src/reference-apply.test.ts
pnpm --filter @openldr/bootstrap exec vitest run src/sync-serve.test.ts src/index.test.ts
```

Expected: PASS, all four files.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/reference-change-log.ts packages/db/src/facility-registry-store.ts packages/db/src/reference-apply.ts packages/bootstrap/src/sync-serve.ts packages/bootstrap/src/index.test.ts packages/db/src/facility-registry-store.test.ts packages/db/src/reference-apply.test.ts packages/bootstrap/src/sync-serve.test.ts
git commit -m "fix(sync): suspend facility_registry capture, serve, and apply

facility_registry was registered in ENTITY_TYPES with neither a serve nor
an apply case. fetchReferenceBody had no branch for it, so a null body
downgraded every upsert to a DELETE instruction, which the receiving lab
then rejected as an unknown entity. Change capture was already live, which
made the half-registered state look supported.

Suspends it at all three points and names it explicitly rather than only
deleting it from the union: an existing central still holds logged rows,
and a compile-time union says nothing about a payload already on the wire."
```

### Task 2: Purge logged `facility_registry` history

**Files:**
- Create: `packages/db/src/migrations/internal/076_suspend_facility_registry_sync.ts`
- Create: `packages/db/src/migrations/internal/076_suspend_facility_registry_sync.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts` (exact-list assertion)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime — the migration inlines its own `'facility_registry'` string.
- Produces: no exports.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/internal/076_suspend_facility_registry_sync.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigrationDb } from './test-helpers';
import { up } from './076_suspend_facility_registry_sync';

describe('076 suspend facility_registry sync', () => {
  it('deletes logged facility_registry rows and leaves every other entity type untouched', async () => {
    const db = await makeMigrationDb();
    await db.insertInto('reference_change_log').values([
      { entity_type: 'facility_registry', entity_id: 'fac-1', op: 'upsert', content_hash: 'h1' },
      { entity_type: 'facility_registry', entity_id: 'fac-2', op: 'delete', content_hash: null },
      { entity_type: 'form', entity_id: 'form-1', op: 'upsert', content_hash: 'h2' },
    ] as never).execute();

    await up(db as never);

    const rows = await db.selectFrom('reference_change_log').select(['entity_type', 'entity_id']).execute();
    expect(rows).toEqual([{ entity_type: 'form', entity_id: 'form-1' }]);
  });

  it('writes no new rows — a change_log insert from a migration perturbs every site pendingPush baseline', async () => {
    const db = await makeMigrationDb();
    await db.insertInto('reference_change_log').values(
      { entity_type: 'form', entity_id: 'form-1', op: 'upsert', content_hash: 'h' } as never,
    ).execute();
    const before = await db.selectFrom('reference_change_log').select('seq').execute();

    await up(db as never);

    const after = await db.selectFrom('reference_change_log').select('seq').execute();
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/db exec vitest run src/migrations/internal/076_suspend_facility_registry_sync.test.ts
```

Expected: FAIL — `Cannot find module './076_suspend_facility_registry_sync'`.

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/internal/076_suspend_facility_registry_sync.ts`:

```ts
import { type Kysely } from 'kysely';

// `facility_registry` was registered in `reference_change_log`'s ENTITY_TYPES before its serve and
// apply cases existed. Capture ran anyway, so an upgraded install can hold logged rows for it — and
// `sync-serve.ts` turns an upsert with no body resolver into a DELETE instruction. Those rows are
// therefore not merely inert history; they are bogus delete instructions waiting to be served.
//
// ⛔ Deliberately INLINED, not imported from SUSPENDED_REFERENCE_ENTITY_TYPES: a migration is a
// frozen snapshot of what it did when it ran. If that constant later gains or loses a type, this
// migration must keep deleting exactly what it deleted the day it shipped.
const SUSPENDED = 'facility_registry';

export async function up(db: Kysely<unknown>): Promise<void> {
  const anyDb = db as Kysely<any>;
  // DELETE only. Never INSERT into reference_change_log from a migration: `seq` is global and every
  // site's pendingPush baseline is derived from it, so a synthetic row silently re-queues unrelated
  // entities at every lab.
  await anyDb.deleteFrom('reference_change_log').where('entity_type', '=', SUSPENDED).execute();
}

export async function down(): Promise<void> {
  // Irreversible by design: the deleted rows were bogus delete instructions. Recreating them would
  // reintroduce the defect, and their original `seq` values are gone.
}
```

- [ ] **Step 4: Register the migration**

Add the import and entry to `packages/db/src/migrations/internal/index.ts`, following the existing `075` entry's exact shape. Then update the exact-list assertion in `packages/db/src/migrations/migrations.test.ts` to include `076_suspend_facility_registry_sync`.

> That assertion lives one directory ABOVE the `--dir .../migrations/internal` filter, so a per-file vitest run will not catch a missing entry. Run the package suite in Step 5, not just the new file.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/db exec vitest run src/migrations
```

Expected: PASS, including `migrations.test.ts`'s exact-list assertion.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations
git commit -m "fix(sync): purge logged facility_registry change rows

An upgraded install can hold reference_change_log rows for facility_registry
captured before the type was suspended. Those are not inert history: serve
downgrades an upsert with no body resolver to a DELETE, so each one is a
bogus delete instruction waiting to be served to a lab.

Deletes only. Inserting into reference_change_log from a migration would
perturb the global seq and every site's pendingPush baseline."
```

- [ ] **Step 7: Merge the slice**

```bash
pnpm turbo run typecheck test --force > /tmp/gate-slice1.log 2>&1; echo "exit=$?"
```

Expected: `exit=0`. Then merge to local `main` with `--no-ff`.

---

# Slice 2 — CSV structural integrity

**Invariant:** a row whose field count differs from the header's is never mapped to columns.

### Task 3: Quarantine ragged rows in the parser

**Files:**
- Modify: `packages/terminology/src/facility-csv.ts:67-120`
- Test: `packages/terminology/src/facility-csv.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface QuarantinedRow { line: number; raw: string; reason: 'too_few_fields' | 'too_many_fields'; }
  ```
  `FacilityCsvResult` gains `quarantined: QuarantinedRow[]`. `records`, `unknownColumns`, and `skipped` keep their exact current meanings — `skipped` stays "dropped for a missing required field" and is NOT overloaded.

- [ ] **Step 1: Write the failing tests**

Add to `packages/terminology/src/facility-csv.test.ts`:

```ts
const opts = { nationalSystem: 'HFR' };

it('quarantines a row with an unescaped comma instead of shifting values into the wrong columns', () => {
  // The audit's exact reproduction. Before this fix relax_column_count accepted the row and mapped
  // level:'East', region:'Hospital', silently dropping 'Dodoma'.
  const csv = 'national_code,name,level,region\n1,Clinic, East,Hospital,Dodoma\n';

  const r = parseFacilityCsv(csv, opts);

  expect(r.records).toEqual([]);
  expect(r.quarantined).toEqual([
    { line: 2, raw: '1,Clinic, East,Hospital,Dodoma', reason: 'too_many_fields' },
  ]);
});

it('quarantines a row with too few fields', () => {
  const csv = 'national_code,name,level,region\n1,Clinic\n';
  const r = parseFacilityCsv(csv, opts);
  expect(r.records).toEqual([]);
  expect(r.quarantined).toEqual([{ line: 2, raw: '1,Clinic', reason: 'too_few_fields' }]);
});

it('never throws on a ragged row — one bad row must not kill a national import', () => {
  const csv = 'national_code,name\n1,Good\n2,Bad,Extra\n3,AlsoGood\n';
  const r = parseFacilityCsv(csv, opts);
  expect(r.records.map((x) => x.nationalCode)).toEqual(['1', '3']);
  expect(r.quarantined).toHaveLength(1);
  expect(r.quarantined[0].line).toBe(3);
});

it('accepts a quoted comma and a quoted multiline name as WELL-FORMED', () => {
  const csv = 'national_code,name\n1,"St. Mary, Annex"\n2,"Line\nTwo"\n';
  const r = parseFacilityCsv(csv, opts);
  expect(r.quarantined).toEqual([]);
  expect(r.records.map((x) => x.name)).toEqual(['St. Mary, Annex', 'Line\nTwo']);
});

it('handles CRLF line endings without quarantining every row', () => {
  const csv = 'national_code,name\r\n1,Clinic\r\n2,Other\r\n';
  const r = parseFacilityCsv(csv, opts);
  expect(r.quarantined).toEqual([]);
  expect(r.records).toHaveLength(2);
});

it('reports a duplicate header as an unknown-column style failure rather than mapping it twice', () => {
  const csv = 'national_code,name,name\n1,A,B\n';
  const r = parseFacilityCsv(csv, opts);
  expect(r.records).toEqual([]);
  expect(r.duplicateColumns).toEqual(['name']);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/terminology exec vitest run src/facility-csv.test.ts
```

Expected: FAIL — `quarantined` and `duplicateColumns` are undefined; the unescaped-comma row currently produces a record.

- [ ] **Step 3: Rewrite the parse to array mode**

Replace the body of `parseFacilityCsv` in `packages/terminology/src/facility-csv.ts`. Keep the entire existing docblock (`:51-66`) and add the paragraph shown below to it.

```ts
export interface QuarantinedRow {
  line: number;
  /** The row exactly as it appeared, so an operator can find and fix it in their source file. */
  raw: string;
  reason: 'too_few_fields' | 'too_many_fields';
}
```

Add to `FacilityCsvResult`:

```ts
  /** Rows whose field count did not match the header's. NEVER mapped to columns — that is the whole
   *  point (see the docblock). Distinct from `skipped`, which counts well-formed rows missing a
   *  REQUIRED value. */
  quarantined: QuarantinedRow[];
  /** Headers appearing more than once. Non-empty ⇒ nothing imported: which column wins is arbitrary,
   *  so mapping either one is a guess about master data. */
  duplicateColumns: string[];
```

New body:

```ts
export function parseFacilityCsv(csv: string, opts: FacilityCsvOptions): FacilityCsvResult {
  // ARRAY mode, not `columns`. The object mapping is done by hand below so a row's RAW field count is
  // observable — `columns` applies relax_column_count's pad/truncate before we ever see the row, which
  // is exactly how a shifted row used to arrive looking well-formed.
  const rows = parseCsvSync(csv, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    info: true,
  }) as { record: string[]; info: { lines: number } }[];

  if (rows.length === 0) {
    return { records: [], unknownColumns: [], duplicateColumns: [], quarantined: [], skipped: 0 };
  }

  const headers = rows[0].record.map((h) => h.trim().toLowerCase());
  const duplicateColumns = headers.filter((h, i) => h !== '' && headers.indexOf(h) !== i);
  const unknownColumns = headers.filter((h, i) => h !== '' && headers.indexOf(h) === i && !KNOWN.has(h));

  if (duplicateColumns.length > 0) {
    return { records: [], unknownColumns, duplicateColumns: [...new Set(duplicateColumns)], quarantined: [], skipped: 0 };
  }
  if (unknownColumns.length > 0 && !opts.allowUnknownColumns) {
    return { records: [], unknownColumns, duplicateColumns: [], quarantined: [], skipped: 0 };
  }

  const quarantined: QuarantinedRow[] = [];
  let skipped = 0;
  const records: FacilityRecord[] = [];

  for (const { record, info } of rows.slice(1)) {
    if (record.length !== headers.length) {
      quarantined.push({
        line: info.lines,
        raw: record.join(','),
        reason: record.length > headers.length ? 'too_many_fields' : 'too_few_fields',
      });
      continue;
    }

    const r: Record<string, string> = {};
    headers.forEach((h, i) => { r[h] = record[i]; });

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
      // No managedOrigin stamp — see the docblock above.
      source: 'import',
    });
  }

  return { records, unknownColumns, duplicateColumns: [], quarantined, skipped };
}
```

Delete the now-unused `csvHeader` helper (`:122-128`) — array mode reads the header from row 0, including the empty-data-rows case.

Add this paragraph to the existing docblock:

```
 * A row whose field count differs from the header's is QUARANTINED, never mapped. `relax_column_count`
 * stays on so the parser still cannot throw — one unescaped comma must not kill a 14 000-row national
 * import, which is why it was set in the first place — but the row is now reported with its line number
 * instead of silently having its values shifted one column left.
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/terminology exec vitest run src/facility-csv.test.ts
```

Expected: PASS. If a pre-existing test asserts "a ragged row does not throw" by checking it produced a record, update it to assert quarantine instead — the audit names that test as pinning the unsafe behaviour.

- [ ] **Step 5: Commit**

```bash
git add packages/terminology/src/facility-csv.ts packages/terminology/src/facility-csv.test.ts
git commit -m "fix(terminology): quarantine ragged facility CSV rows instead of shifting columns

relax_column_count let a row with one unescaped comma parse successfully
with every value shifted one column left and the last one dropped, so
'1,Clinic, East,Hospital,Dodoma' imported as level=East, region=Hospital.
No unknown column was reported and the row applied silently.

Parses in array mode so a row's raw field count is observable before the
object mapping, and quarantines any mismatch with its line number and raw
content. relax_column_count stays on deliberately: it was set because a
throwing parser killed an entire 14k-row import over one bad row, and that
reason still holds."
```

### Task 4: Block Apply while rows are quarantined

**Files:**
- Modify: `packages/bootstrap/src/facility-import.ts:207-222`
- Test: `packages/bootstrap/src/facility-import.test.ts`

**Interfaces:**
- Consumes: `QuarantinedRow`, `FacilityCsvResult.quarantined`, `.duplicateColumns` from Task 3.
- Produces: `FacilityImportOptions` gains `allowMalformedRows?: boolean`. `FacilityImportResult` gains `quarantined: QuarantinedRow[]` and `duplicateColumns: string[]`. Task 5 consumes both.

- [ ] **Step 1: Write the failing tests**

Add to `packages/bootstrap/src/facility-import.test.ts`:

```ts
it('refuses to apply while any row is quarantined, and writes nothing', async () => {
  const csv = 'national_code,name\n1,Good\n2,Bad,Extra\n';

  const r = await importFacilities(deps, csv, { nationalSystem: 'HFR', apply: true });

  expect(r.created).toBe(0);
  expect(r.updated).toBe(0);
  expect(r.quarantined).toHaveLength(1);
  expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
});

it('applies the good rows when allowMalformedRows is set, and still reports the bad one', async () => {
  const csv = 'national_code,name\n1,Good\n2,Bad,Extra\n3,AlsoGood\n';

  const r = await importFacilities(deps, csv, {
    nationalSystem: 'HFR', apply: true, allowMalformedRows: true,
  });

  expect(r.created).toBe(2);
  expect(r.quarantined).toHaveLength(1);
  expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(2);
});

it('reports quarantined rows on a dry run without needing the override', async () => {
  const csv = 'national_code,name\n1,Good\n2,Bad,Extra\n';
  const r = await importFacilities(deps, csv, { nationalSystem: 'HFR' });
  expect(r.quarantined).toHaveLength(1);
  expect(r.parsed).toBe(1);
});

it('refuses to apply a file with duplicate headers', async () => {
  const r = await importFacilities(deps, 'national_code,name,name\n1,A,B\n', {
    nationalSystem: 'HFR', apply: true, allowMalformedRows: true,
  });
  expect(r.created).toBe(0);
  expect(r.duplicateColumns).toEqual(['name']);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-import.test.ts
```

Expected: FAIL — `quarantined` undefined, and the first test applies the good row.

- [ ] **Step 3: Add the gate**

In `packages/bootstrap/src/facility-import.ts`, extend the destructure and the early return:

```ts
  const { records: parsedRecords, unknownColumns, duplicateColumns, quarantined, skipped } =
    parseFacilityCsv(csv, {
      nationalSystem: opts.nationalSystem,
      allowUnknownColumns: opts.allowUnknownColumns,
    });
  const { records, duplicates } = dedupeById(parsedRecords);

  // Structural damage BLOCKS apply. `allowMalformedRows` is the explicit "I have seen the line
  // numbers, import the rest" override — the same shape as `allowUnknownColumns` above, so a file
  // with something wrong with it has exactly one idiom for proceeding anyway. Duplicate headers have
  // NO override: which of two identically-named columns wins is arbitrary, so applying either is a
  // guess about master data rather than a documented trade.
  const blocked =
    duplicateColumns.length > 0 || (quarantined.length > 0 && !opts.allowMalformedRows);

  if (!opts.apply || blocked || records.length === 0) {
    return {
      parsed: parsedRecords.length, skipped, unknownColumns, duplicateColumns, quarantined,
      created: 0, updated: 0, duplicates,
    };
  }
```

Add `duplicateColumns` and `quarantined` to every other `return` in the function, and to the `FacilityImportResult` interface. Add `allowMalformedRows?: boolean` to `FacilityImportOptions` with a doc comment naming the override's meaning.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-import.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/facility-import.ts packages/bootstrap/src/facility-import.test.ts
git commit -m "feat(bootstrap): block facility import apply while rows are quarantined

A structurally malformed row now stops the apply rather than being skipped
into silence. allowMalformedRows is the explicit override, mirroring the
existing allowUnknownColumns opt-in so a problem file has one consistent
idiom for proceeding anyway.

Duplicate headers get no override: which of two identically-named columns
wins is arbitrary, so applying either is a guess about master data."
```

### Task 5: Surface line-level errors in the route, CLI, and import sheet

**Files:**
- Modify: `apps/server/src/facilities-routes.ts:39-55`, `:761-766`
- Modify: `packages/cli/src/program.ts` (the `facilities import` command, ~`:247`)
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx:26-37`, `:162-169`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/server/src/facilities-routes.test.ts`, `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

**Interfaces:**
- Consumes: `FacilityImportResult.quarantined` / `.duplicateColumns` from Task 4.
- Produces: the import response body carries `quarantined` and `duplicateColumns`; the request body accepts `allowMalformedRows`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/facilities-routes.test.ts`:

```ts
it('returns quarantined rows with line numbers and applies nothing', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/facilities/import',
    payload: { csv: 'national_code,name\n1,Good\n2,Bad,Extra\n', nationalSystem: 'HFR', apply: true },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({
    created: 0,
    quarantined: [{ line: 3, reason: 'too_many_fields' }],
  });
});
```

In `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`:

```ts
it('lists quarantined line numbers and disables Apply with a stated reason', async () => {
  renderSheet({ preview: { parsed: 1, quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }] } });

  expect(await screen.findByText(/line 3/i)).toBeInTheDocument();
  const apply = screen.getByRole('button', { name: /apply/i });
  expect(apply).toBeDisabled();
  expect(screen.getByText(/1 row could not be read/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t quarantined
pnpm --filter @openldr/studio exec vitest run src/facilities/ImportFacilitiesSheet.test.tsx
```

Expected: FAIL — the response has no `quarantined` key; the sheet renders no line numbers.

- [ ] **Step 3: Plumb the route and CLI**

In `apps/server/src/facilities-routes.ts`, add `allowMalformedRows` to the import request body schema (boolean, optional, default false) and pass it into `importFacilities`. The result is already spread into the response; confirm `quarantined` and `duplicateColumns` reach the body and are not stripped by a response schema. If a response schema exists, add both fields to it.

In `packages/cli/src/program.ts`, add `--allow-malformed-rows` to `facilities import` (CLI parity is a repo convention) and print each quarantined row as `line <n>: <reason> — <raw>`, followed by `<n> row(s) quarantined; re-run with --allow-malformed-rows to import the rest`.

- [ ] **Step 4: Surface it in the sheet**

In `ImportFacilitiesSheet.tsx`, render a quarantine block when `preview.quarantined.length > 0`: a count line plus a scrollable list of `line {n} — {raw}`. Disable Apply while `quarantined.length > 0 && !allowMalformedRows`, and set the disabled reason text from i18n. Add an `allowMalformedRows` checkbox using the same control and copy pattern as the existing unknown-columns opt-in — do not invent a new affordance.

Add keys to `en.ts`, `fr.ts`, and `pt.ts`. All user-visible strings come from translation resources; no inline English.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts
pnpm --filter @openldr/studio exec vitest run src/facilities/ImportFacilitiesSheet.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit and merge the slice**

```bash
git add apps/server/src/facilities-routes.ts packages/cli/src/program.ts apps/studio/src/facilities apps/studio/src/i18n
git commit -m "feat(facilities): surface quarantined CSV rows in route, CLI, and import sheet

Line number and raw content for every structurally malformed row, an
explicit allow-malformed-rows override in all three operator paths, and
Apply disabled with a stated reason rather than silently importing a
partial file."
pnpm turbo run typecheck test --force > /tmp/gate-slice2.log 2>&1; echo "exit=$?"
```

Expected: `exit=0`. Then merge to local `main` with `--no-ff`.

---

# Slice 3 — The rename-migration layer

**Invariant:** a `term_mappings` row that resolved to facility X before a projection still resolves to facility X after it, whatever happened to X's code.

### Task 6: The projection link table

**Files:**
- Create: `packages/db/src/migrations/internal/077_facility_concept_projection.ts`
- Create: `packages/db/src/migrations/internal/077_facility_concept_projection.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`
- Modify: `packages/db/src/schema/internal.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `facility_concept_projection (registry_id text pk, concept_code text not null, updated_at timestamptz not null)` and its `InternalSchema` entry `FacilityConceptProjectionTable`. Task 7 reads and writes it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeMigrationDb } from './test-helpers';
import { up } from './077_facility_concept_projection';

describe('077 facility_concept_projection', () => {
  it('creates the link table keyed on registry_id', async () => {
    const db = await makeMigrationDb();
    await up(db as never);

    await db.insertInto('facility_concept_projection').values(
      { registry_id: 'fac-1', concept_code: '111317-4', updated_at: new Date() } as never,
    ).execute();

    const rows = await db.selectFrom('facility_concept_projection').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ registry_id: 'fac-1', concept_code: '111317-4' });
  });

  it('backfills one row per existing registry facility from its live concept', async () => {
    const db = await makeMigrationDb();
    await db.insertInto('facility_registry').values(
      { id: 'fac-1', name: 'Clinic', local_code: '111317-4' } as never,
    ).execute();
    await db.insertInto('terminology_concepts').values(
      { system: 'urn:openldr:cs:facility-registry', code: '111317-4', display: 'Clinic', status: 'ACTIVE' } as never,
    ).execute();

    await up(db as never);

    const rows = await db.selectFrom('facility_concept_projection').selectAll().execute();
    expect(rows).toEqual([expect.objectContaining({ registry_id: 'fac-1', concept_code: '111317-4' })]);
  });

  it('cascades the link away when its facility is deleted', async () => {
    const db = await makeMigrationDb();
    await db.insertInto('facility_registry').values({ id: 'fac-1', name: 'C', local_code: 'L' } as never).execute();
    await up(db as never);
    await db.insertInto('facility_concept_projection').values(
      { registry_id: 'fac-1', concept_code: 'L', updated_at: new Date() } as never,
    ).execute();

    await db.deleteFrom('facility_registry').where('id', '=', 'fac-1').execute();

    expect(await db.selectFrom('facility_concept_projection').selectAll().execute()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/db exec vitest run src/migrations/internal/077_facility_concept_projection.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the migration**

```ts
import { sql, type Kysely } from 'kysely';

// The durable answer to "what code does facility X currently project as?".
//
// ⛔ NOT concept `properties`. There is a live open bug where `terms.update` destroys unknown
// concept properties (it rewrites the jsonb wholesale), which would silently eat this link and take
// the mapping-migration layer down with it — the layer would then compute "no code change" for a row
// whose code had in fact moved, which is exactly the failure it exists to prevent.
//
// ⛔ Deliberately INLINED, not imported from FACILITY_REGISTRY_SYSTEM: frozen-snapshot rule.
const REGISTRY_SYSTEM = 'urn:openldr:cs:facility-registry';

export async function up(db: Kysely<unknown>): Promise<void> {
  const anyDb = db as Kysely<any>;

  await anyDb.schema
    .createTable('facility_concept_projection')
    .addColumn('registry_id', 'text', (c) =>
      c.primaryKey().references('facility_registry.id').onDelete('cascade'))
    .addColumn('concept_code', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // Backfill from the LIVE concept, not by recomputing the preferred code: the point of this table
  // is to record what was actually projected, including any collision fallback to the row's id that
  // a past projection applied. Recomputing here would assert a code the concepts may not carry, and
  // the first projection after this migration would then "migrate" mappings that were never broken.
  await sql`
    insert into facility_concept_projection (registry_id, concept_code, updated_at)
    select r.id, c.code, now()
      from facility_registry r
      join terminology_concepts c
        on c.system = ${REGISTRY_SYSTEM}
       and c.code in (coalesce(r.local_code, r.national_code), r.id)
     on conflict (registry_id) do nothing
  `.execute(anyDb);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await (db as Kysely<any>).schema.dropTable('facility_concept_projection').execute();
}
```

> The `c.code in (preferred, id)` join covers both projection eras: a row projected on its human code and one still on its id after a collision. `on conflict do nothing` keeps the first match when a row somehow has both.

- [ ] **Step 4: Add the schema type and register the migration**

In `packages/db/src/schema/internal.ts`:

```ts
export interface FacilityConceptProjectionTable {
  registry_id: string;
  concept_code: string;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}
```

Add `facility_concept_projection: FacilityConceptProjectionTable;` to `InternalSchema`. Register `077` in `migrations/internal/index.ts` and in `migrations.test.ts`'s exact list.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/db exec vitest run src/migrations
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations packages/db/src/schema/internal.ts
git commit -m "feat(db): add facility_concept_projection link table

Records what code each facility_registry row currently projects as, so a
later projection can tell that a row's code MOVED and migrate the mappings
pointing at the old one.

Deliberately a table rather than a concept property: terms.update rewrites
concept properties wholesale and would silently eat the link, which would
make the migration layer compute 'no change' for exactly the rows whose
code had moved."
```

### Task 7: Migrate mappings when a projected code moves

**Files:**
- Modify: `packages/bootstrap/src/facility-reconcile.ts` (new exported `reprojectRegistryRows`, near `projectRegistryRows` at `:888`)
- Test: `packages/bootstrap/src/facility-reconcile.test.ts`

**Interfaces:**
- Consumes: `facility_concept_projection` from Task 6; `registryConceptRows` / `registryPreferredCode` from `packages/db/src/facility-observed.ts`; `admin.termMappings.update` (signature at `terminology-admin-store.ts:601`).
- Produces:
  ```ts
  export interface ReprojectResult { projected: number; codeChanges: { registryId: string; from: string; to: string; mappingsMigrated: number }[]; }
  export async function reprojectRegistryRows(deps: ReconcileDeps, rows: { id: string; name: string }[]): Promise<ReprojectResult>;
  ```
  Task 8 makes both existing projection paths call it.

- [ ] **Step 1: Write the failing tests**

Add to `packages/bootstrap/src/facility-reconcile.test.ts`:

```ts
it('ANCHOR: an unrelated facility colliding on a code does not orphan an existing mapping', async () => {
  // The audit's FAC-P0-04, sharpened. Nobody edits A, yet a full reprojection used to flip A's
  // concept code to its UUID and leave A's mapping pointing at a ghost '111317-4' concept that
  // stayed selectable in the picker.
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha Clinic', localCode: '111317-4' });
  await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha Clinic' }]);
  await seedMapping(deps, { fromSystem: OBSERVED, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: '111317-4' });

  await seedFacility(deps, { id: 'fac-B', name: 'Beta Clinic', nationalCode: '111317-4' });
  await publishRegistryConcepts(deps, { apply: true });

  const resolved = await resolveObservedFacilities(deps);
  const row = resolved.find((r) => r.sourceCode === 'BALAB')!;
  expect(row.registryId).toBe('fac-A');
  expect(row.targetMissing).toBe(false);
});

it('follows a local_code rename on a facility that already has a mapping', async () => {
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha', localCode: 'OLD-1' });
  await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
  await seedMapping(deps, { fromSystem: OBSERVED, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'OLD-1' });

  await deps.internalDb.updateTable('facility_registry').set({ local_code: 'NEW-1' }).where('id', '=', 'fac-A').execute();
  const r = await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

  expect(r.codeChanges).toEqual([{ registryId: 'fac-A', from: 'OLD-1', to: 'NEW-1', mappingsMigrated: 1 }]);
  const resolved = await resolveObservedFacilities(deps);
  expect(resolved.find((x) => x.sourceCode === 'BALAB')!.registryId).toBe('fac-A');
});

it('leaves no ghost concept behind after a code change', async () => {
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha', localCode: 'OLD-1' });
  await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
  await deps.internalDb.updateTable('facility_registry').set({ local_code: 'NEW-1' }).where('id', '=', 'fac-A').execute();
  await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

  const codes = await deps.internalDb.selectFrom('terminology_concepts')
    .select('code').where('system', '=', FACILITY_REGISTRY_SYSTEM).execute();
  expect(codes.map((c) => c.code)).toEqual(['NEW-1']);
});

it('mirrors the migrated mapping into concept_map_elements', async () => {
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha', localCode: 'OLD-1' });
  await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
  await seedMapping(deps, { fromSystem: OBSERVED, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'OLD-1' });

  await deps.internalDb.updateTable('facility_registry').set({ local_code: 'NEW-1' }).where('id', '=', 'fac-A').execute();
  await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

  const mirror = await deps.internalDb.selectFrom('concept_map_elements')
    .select(['target_code']).where('target_system', '=', FACILITY_REGISTRY_SYSTEM).execute();
  expect(mirror.map((m) => m.target_code)).toEqual(['NEW-1']);
});

it('follows the code back when a collision is resolved by deleting the other facility', async () => {
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha', localCode: '111317-4' });
  await seedFacility(deps, { id: 'fac-B', name: 'Beta', nationalCode: '111317-4' });
  await publishRegistryConcepts(deps, { apply: true });
  await seedMapping(deps, { fromSystem: OBSERVED, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'fac-A' });

  await deps.internalDb.deleteFrom('facility_registry').where('id', '=', 'fac-B').execute();
  await publishRegistryConcepts(deps, { apply: true });

  expect(await currentConceptCode(deps, 'fac-A')).toBe('111317-4');
  const resolved = await resolveObservedFacilities(deps);
  expect(resolved.find((x) => x.sourceCode === 'BALAB')!.registryId).toBe('fac-A');
});
```

Add the `seedFacility`, `seedMapping`, and `currentConceptCode` helpers to the file's existing helper block if they are not already there.

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts -t ANCHOR
```

Expected: FAIL — `reprojectRegistryRows is not a function`. After Step 3 stubs exist, the ANCHOR test must still fail with `targetMissing: true` before Step 4 lands.

- [ ] **Step 3: Write `reprojectRegistryRows`**

Add to `packages/bootstrap/src/facility-reconcile.ts`:

```ts
export interface ReprojectResult {
  projected: number;
  codeChanges: { registryId: string; from: string; to: string; mappingsMigrated: number }[];
}

/**
 * Project the given `facility_registry` rows AND migrate any `term_mappings` whose target code moves
 * as a result. The ONE write path for registry concepts — `publishRegistryConcepts` and
 * `projectRegistryRows` both delegate here so the two can never disagree about a row's code, which
 * is exactly the bug this closes: `projectRegistryRows` forced only its own batch to fall back to
 * `id` on a collision while `publishRegistryConcepts` forced both sides, so importing an unrelated
 * facility flipped an EXISTING facility's concept code on the next Scan and orphaned its mapping.
 *
 * `facility_concept_projection` is what makes "moved" observable: without a durable record of what a
 * row projected as LAST time, a projection can only compute a desired code and has no way to know
 * which old code's mappings to carry forward.
 *
 * ⛔ Mappings are rewritten through `admin.termMappings.update`, never with a direct UPDATE.
 * `term_mappings` is authoritative and `concept_map_elements` is its mirror; a raw UPDATE would
 * leave the mirror pointing at the old code and skip `reference_change_log` capture.
 */
export async function reprojectRegistryRows(
  deps: ReconcileDeps,
  rows: { id: string; name: string }[],
): Promise<ReprojectResult> {
  if (rows.length === 0) return { projected: 0, codeChanges: [] };

  await ensureRegistrySystemActive(deps);

  const ids = rows.map((r) => r.id);
  const own = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'local_code', 'national_code'])
    .where('id', 'in', ids)
    .execute();
  const ownById = new Map(own.map((r) => [r.id, r]));

  const inputs: RegistryRowForConcept[] = rows.map((r) => {
    const f = ownById.get(r.id);
    return { id: r.id, name: r.name, localCode: f?.local_code ?? null, nationalCode: f?.national_code ?? null };
  });

  const forceOwnIdFor = await collidingRegistryIds(deps, inputs);
  const desired = registryConceptRows(inputs, { forceOwnIdFor });

  const links = await deps.internalDb
    .selectFrom('facility_concept_projection')
    .select(['registry_id', 'concept_code'])
    .where('registry_id', 'in', ids)
    .execute();
  const previousById = new Map(links.map((l) => [l.registry_id, l.concept_code]));

  // Write the new concepts FIRST — same ordering contract `deleteSupersededIdConcepts` documents: a
  // mid-failure must leave a stale concept for the next projection to retry, never a facility with
  // ZERO concepts.
  await deps.admin.terms.importRows(desired);

  const codeChanges: ReprojectResult['codeChanges'] = [];

  for (let i = 0; i < inputs.length; i += 1) {
    const registryId = inputs[i].id;
    const to = desired[i].code;
    const from = previousById.get(registryId);

    if (from === to) continue;

    let mappingsMigrated = 0;
    if (from !== undefined) {
      const stale = await deps.internalDb
        .selectFrom('term_mappings')
        .selectAll()
        .where('to_system', '=', FACILITY_REGISTRY_SYSTEM)
        .where('to_code', '=', from)
        .execute();

      for (const m of stale) {
        await deps.admin.termMappings.update(m.id, {
          fromSystem: m.from_system, fromCode: m.from_code,
          toSystem: FACILITY_REGISTRY_SYSTEM, toCode: to, toDisplay: inputs[i].name,
          mapType: m.map_type as never, relationship: m.relationship, owner: m.owner,
          isActive: m.is_active,
        });
        mappingsMigrated += 1;
      }

      // Only now is the old concept unreferenced. Deleting it before the rewrite above would strand
      // every mapping that still pointed at it if the rewrite then failed.
      await deps.internalDb
        .deleteFrom('terminology_concepts')
        .where('system', '=', FACILITY_REGISTRY_SYSTEM)
        .where('code', '=', from)
        .execute();
    }

    await deps.internalDb
      .insertInto('facility_concept_projection')
      .values({ registry_id: registryId, concept_code: to, updated_at: new Date() })
      .onConflict((oc) => oc.column('registry_id').doUpdateSet({ concept_code: to, updated_at: new Date() }))
      .execute();

    if (from !== undefined) codeChanges.push({ registryId, from, to, mappingsMigrated });
  }

  // A row projected for the FIRST time has no previous link yet.
  const linked = new Set(links.map((l) => l.registry_id));
  const fresh = inputs
    .map((r, i) => ({ registry_id: r.id, concept_code: desired[i].code, updated_at: new Date() }))
    .filter((r) => !linked.has(r.registry_id));
  if (fresh.length > 0) {
    await deps.internalDb
      .insertInto('facility_concept_projection')
      .values(fresh)
      .onConflict((oc) => oc.column('registry_id').doNothing())
      .execute();
  }

  return { projected: inputs.length, codeChanges };
}
```

Extract the existing collision lookup from `projectRegistryRows` (`:913-943`) into a shared helper, unchanged in behaviour:

```ts
/** Registry ids whose preferred code is claimed by MORE THAN ONE row anywhere in the table, and which
 *  must therefore fall back to their own `id`. Extracted verbatim from `projectRegistryRows` so the
 *  full-table and given-rows paths share one definition of "collision". */
async function collidingRegistryIds(
  deps: Pick<ReconcileDeps, 'internalDb'>,
  inputs: RegistryRowForConcept[],
): Promise<Set<string>>
```

Move the block currently inline in `projectRegistryRows` at `:913-943` — from `const forceOwnIdFor = new Set<string>();` through the closing brace of `if (candidates.length > 0) { ... }` — into this function verbatim, and `return forceOwnIdFor;`. Do not rewrite it: its `claimantIdsByCode.get(candidate)?.size > 1` check (a row always claims its own code, so `> 1` is what distinguishes a real collision from a row seeing its own claim reflected back) is subtle and already correct.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts
```

Expected: PASS, including ANCHOR.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts
git commit -m "feat(facilities): migrate term_mappings when a facility's projected code moves

A facility's concept code is derived from local_code ?? national_code with
a fallback to its id on collision, so the code can move without anyone
editing that facility: importing an unrelated row that claims the same code
flips BOTH rows to their UUIDs on the next full reprojection, orphaning any
mapping authored against the human code and leaving the old concept behind
as a selectable ghost.

reprojectRegistryRows makes the move observable via
facility_concept_projection and carries the mappings across, through
admin.termMappings.update so the concept_map_elements mirror and change
capture both follow."
```

### Task 8: Route both projection paths through the new function

**Files:**
- Modify: `packages/bootstrap/src/facility-reconcile.ts:710-735` (`publishRegistryConcepts`), `:888-956` (`projectRegistryRows`)
- Test: `packages/bootstrap/src/facility-reconcile.test.ts`

**Interfaces:**
- Consumes: `reprojectRegistryRows` from Task 7.
- Produces: `projectRegistryRows` keeps its exact signature and its never-throws contract. `publishRegistryConcepts` keeps `{ concepts, systemRegistered }`.

- [ ] **Step 1: Write the failing test**

```ts
it('the create/update path and the full reprojection agree on a colliding row\'s code', async () => {
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha', localCode: '111317-4' });
  await projectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
  await seedFacility(deps, { id: 'fac-B', name: 'Beta', nationalCode: '111317-4' });
  await projectRegistryRows(deps, [{ id: 'fac-B', name: 'Beta' }]);

  const afterIncremental = await currentConceptCode(deps, 'fac-A');
  await publishRegistryConcepts(deps, { apply: true });
  const afterFull = await currentConceptCode(deps, 'fac-A');

  expect(afterFull).toBe(afterIncremental);
});

it('projectRegistryRows still never throws when projection fails', async () => {
  const broken = { ...deps, admin: { ...deps.admin, terms: { importRows: async () => { throw new Error('boom'); } } } };
  await expect(projectRegistryRows(broken as never, [{ id: 'fac-A', name: 'A' }])).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts -t "agree on a colliding"
```

Expected: FAIL — the incremental path leaves `fac-A` on `111317-4` while the full reprojection moves it to its id.

- [ ] **Step 3: Delegate both paths**

`publishRegistryConcepts` body, replacing `:723-732`:

```ts
  if (registry.length > 0) {
    await reprojectRegistryRows(deps, registry.map((r) => ({ id: r.id, name: r.name })));
  }
```

`projectRegistryRows` body, replacing `:893-950`, keeping the surrounding `try`/`catch` and its comments exactly as they are:

```ts
    // Widen to every OTHER row that claims one of this batch's candidate codes. Without this the
    // two paths disagree: the given-rows path would force only ITS rows to fall back to `id` while
    // leaving the colliding incumbent on the shared human code, and the next full reprojection would
    // then move the incumbent — a code change caused by a write to a DIFFERENT facility.
    const widened = await widenToCollidingRows(deps, rows);
    await reprojectRegistryRows(deps, widened);
```

Add:

```ts
/** `rows` plus every other `facility_registry` row claiming one of their candidate codes, so a
 *  given-rows projection reprojects the incumbent side of a collision too. Without this the two
 *  paths disagree — see `reprojectRegistryRows`' docblock. */
async function widenToCollidingRows(
  deps: Pick<ReconcileDeps, 'internalDb'>,
  rows: { id: string; name: string }[],
): Promise<{ id: string; name: string }[]> {
  const ids = rows.map((r) => r.id);
  const own = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'local_code', 'national_code'])
    .where('id', 'in', ids)
    .execute();

  const candidates = [...new Set(
    own.map((r) => r.local_code ?? r.national_code).filter((c): c is string => c !== null),
  )];
  if (candidates.length === 0) return rows;

  const claimants = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'name'])
    .where((eb) => eb.or([eb('local_code', 'in', candidates), eb('national_code', 'in', candidates)]))
    .execute();

  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const c of claimants) if (!byId.has(c.id)) byId.set(c.id, { id: c.id, name: c.name });
  return [...byId.values()];
}
```

Delete `deleteSupersededIdConcepts` and `registryRowIdsWithSupersededIdConcept` call sites here — the link table now drives supersession, and the old id-concept cleanup is a special case of a code change. Leave the exported helpers in `facility-observed.ts` in place if other callers remain; otherwise remove them and their tests in the same commit.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts
pnpm --filter @openldr/db exec vitest run src/facility-observed.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts packages/db/src/facility-observed.ts
git commit -m "fix(facilities): make both projection paths agree on a colliding code

projectRegistryRows forced only its own batch to fall back to id on a code
collision, so the incumbent facility kept the shared human code until the
next full reprojection moved it. The write path and the Scan path therefore
disagreed about the same row.

Both now delegate to reprojectRegistryRows, and the given-rows path widens
its batch to include the incumbent side of any collision it creates."
```

### Task 9: Retire rather than delete a facility's concept

**Files:**
- Modify: `packages/bootstrap/src/facility-reconcile.ts` (`reprojectRegistryRows`, plus a new `retireRegistryConcepts`)
- Modify: `apps/server/src/facilities-routes.ts` (the delete route, `:706-712`)
- Test: `packages/bootstrap/src/facility-reconcile.test.ts`, `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `reprojectRegistryRows` from Task 7.
- Produces: `export async function retireRegistryConcepts(deps: ReconcileDeps, registryIds: string[]): Promise<number>` — sets `terminology_concepts.status = 'RETIRED'` for those rows' current concepts and returns the count.

- [ ] **Step 1: Write the failing tests**

```ts
it('retires a deleted facility\'s concept instead of deleting it, so history still resolves', async () => {
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha', localCode: 'L-1' });
  await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
  await seedMapping(deps, { fromSystem: OBSERVED, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-1' });

  await retireRegistryConcepts(deps, ['fac-A']);

  const c = await deps.internalDb.selectFrom('terminology_concepts').selectAll()
    .where('system', '=', FACILITY_REGISTRY_SYSTEM).where('code', '=', 'L-1').executeTakeFirstOrThrow();
  expect(c.status).toBe('RETIRED');
});

it('a retired concept is excluded from new mapping selection', async () => {
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha', localCode: 'L-1' });
  await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
  await retireRegistryConcepts(deps, ['fac-A']);

  const hits = await deps.admin.terms.search({ system: FACILITY_REGISTRY_SYSTEM, query: 'L-1', status: ['ACTIVE'] });
  expect(hits).toEqual([]);
});
```

And in `facilities-routes.test.ts`:

```ts
it('DELETE /api/facilities/:id retires the concept rather than leaving a selectable ghost', async () => {
  await createFacility(app, { id: 'fac-A', name: 'Alpha', localCode: 'L-1' });
  await app.inject({ method: 'DELETE', url: '/api/facilities/fac-A' });

  const c = await ctx.internalDb.selectFrom('terminology_concepts').select('status')
    .where('code', '=', 'L-1').executeTakeFirst();
  expect(c?.status).toBe('RETIRED');
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts -t retire
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t retires
```

Expected: FAIL — `retireRegistryConcepts is not a function`; the route leaves the concept `ACTIVE`.

- [ ] **Step 3: Implement retirement**

```ts
/**
 * Mark the given facilities' projected concepts RETIRED. Deliberately NOT a delete: an operator who
 * already mapped an observed code to this facility must still be able to interpret the historical
 * reports that resolved through it. A retired concept stays resolvable and drops out of new
 * selection, which is the split the picker's ACTIVE-only status filter already expresses.
 */
export async function retireRegistryConcepts(deps: ReconcileDeps, registryIds: string[]): Promise<number> {
  if (registryIds.length === 0) return 0;
  const links = await deps.internalDb
    .selectFrom('facility_concept_projection')
    .select('concept_code')
    .where('registry_id', 'in', registryIds)
    .execute();
  if (links.length === 0) return 0;

  const res = await deps.internalDb
    .updateTable('terminology_concepts')
    .set({ status: 'RETIRED' })
    .where('system', '=', FACILITY_REGISTRY_SYSTEM)
    .where('code', 'in', links.map((l) => l.concept_code))
    .executeTakeFirst();
  return Number(res.numUpdatedRows ?? 0);
}
```

Call it from the delete route **before** the `facility_registry` row is removed — the `on delete cascade` on `facility_concept_projection` drops the link the moment the facility goes, and the link is how the concept is found.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit and merge the slice**

```bash
git add packages/bootstrap/src/facility-reconcile.ts apps/server/src/facilities-routes.ts packages/bootstrap/src/facility-reconcile.test.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): retire a deleted facility's concept instead of leaving a ghost

A deleted facility's concept was kept ACTIVE and stayed selectable in the
mapping picker while pointing at nothing. It is now RETIRED: still
resolvable so historical reports remain interpretable, but excluded from
new selection by the picker's ACTIVE-only filter.

Retirement runs before the registry row is deleted, because the projection
link that locates the concept cascades away with the row."
pnpm turbo run typecheck test --force > /tmp/gate-slice3.log 2>&1; echo "exit=$?"
```

Expected: `exit=0`. Then merge to local `main` with `--no-ff`.

---

# Slice 4 — One supported active facility resolution

**Invariant:** an observed `(from_system, from_code)` has at most one active `SAME-AS` mapping into the facility registry system, and only such a mapping can resolve a facility.

### Task 10: Filter to SAME-AS and report ambiguity

**Files:**
- Modify: `packages/bootstrap/src/facility-reconcile.ts:261-335` (`ResolvedFacility`), `:352-360` (`assertResolvedFacilityInvariant`), `:494-599` (`resolveObservedFacilities`)
- Test: `packages/bootstrap/src/facility-reconcile.test.ts`

**Interfaces:**
- Consumes: nothing from Slice 3.
- Produces: `ResolvedFacility` gains `ambiguous: boolean`. `assertResolvedFacilityInvariant` widens to `Pick<ResolvedFacility, 'resolvedVia' | 'targetMissing' | 'nonFacilityTarget' | 'ambiguous'>`. Tasks 11 and 12 rely on both.

- [ ] **Step 1: Write the failing tests**

```ts
it('does not resolve through an UNMAPPED-FROM mapping', async () => {
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha', localCode: 'L-1' });
  await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
  await seedMapping(deps, {
    fromSystem: OBSERVED, fromCode: 'BALAB',
    toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-1', mapType: 'UNMAPPED-FROM',
  });

  const row = (await resolveObservedFacilities(deps)).find((r) => r.sourceCode === 'BALAB')!;

  expect(row.registryId).toBeNull();
  expect(row.resolvedVia).toBeNull();
});

it('does not resolve through a RELATED-TO mapping', async () => {
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha', localCode: 'L-1' });
  await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
  await seedMapping(deps, { fromSystem: OBSERVED, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-1', mapType: 'RELATED-TO' });

  expect((await resolveObservedFacilities(deps)).find((r) => r.sourceCode === 'BALAB')!.resolvedVia).toBeNull();
});

it('reports two competing active SAME-AS mappings as ambiguous and resolves NEITHER', async () => {
  await seedFacility(deps, { id: 'fac-A', name: 'Alpha', localCode: 'L-1' });
  await seedFacility(deps, { id: 'fac-B', name: 'Beta', localCode: 'L-2' });
  await publishRegistryConcepts(deps, { apply: true });
  await seedMapping(deps, { fromSystem: OBSERVED, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-1' });
  await seedMapping(deps, { fromSystem: OBSERVED, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-2' });

  const row = (await resolveObservedFacilities(deps)).find((r) => r.sourceCode === 'BALAB')!;

  expect(row.ambiguous).toBe(true);
  expect(row.registryId).toBeNull();
  expect(row.resolvedVia).toBeNull();
});

it('the invariant assertion rejects an ambiguous row that also claims a resolution', () => {
  expect(() => assertResolvedFacilityInvariant({
    resolvedVia: 'registry', targetMissing: false, nonFacilityTarget: false, ambiguous: true,
  })).toThrow(/ambiguous/i);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts -t "UNMAPPED-FROM|ambiguous"
```

Expected: FAIL — the `UNMAPPED-FROM` mapping resolves to `fac-A`; `ambiguous` is undefined.

- [ ] **Step 3: Add `ambiguous` and the SAME-AS filter**

Add to `ResolvedFacility`:

```ts
  /** More than one ACTIVE `SAME-AS` mapping into the facility registry exists for this observed
   *  `(system, code)`. The row resolves to NOTHING — never to an arbitrary winner. Database order
   *  used to decide which facility appeared in reports; a nondeterministic answer is worse than a
   *  visibly absent one, so this reports the conflict and lets the operator settle it. Mutually
   *  exclusive with `resolvedVia`. */
  ambiguous: boolean;
```

Extend `assertResolvedFacilityInvariant`'s parameter type and add:

```ts
  if (row.ambiguous && row.resolvedVia !== null) {
    throw new Error(
      `ResolvedFacility invariant violated: ambiguous=true must imply resolvedVia=null ` +
      `(got resolvedVia=${JSON.stringify(row.resolvedVia)})`,
    );
  }
```

In `resolveObservedFacilities`, add `map_type` to the select at `:497` and filter:

```ts
        .select(['from_system', 'from_code', 'to_system', 'to_code', 'map_type'])
        .where('from_system', 'in', systems)
        .where('is_active', '=', true)
        // Only an exact equivalence resolves a facility. The generic TermMappingDialog offers five
        // map types and this resolver used to honour ALL of them, so recording UNMAPPED-FROM — the
        // operator's way of saying "this does NOT correspond" — still drove reports to that facility.
        .where('map_type', '=', 'SAME-AS')
```

Then in the per-row block, replace the `registryMapping` lookup:

```ts
    const registryCandidates = candidates.filter((c) => c.toSystem === FACILITY_REGISTRY_SYSTEM);
    const ambiguous = registryCandidates.length > 1;
    const registryMapping = ambiguous ? undefined : registryCandidates[0];
```

and thread `ambiguous` into the invariant assertion and the returned row. Where `nonFacilityTarget` is computed, exclude the ambiguous case so an ambiguous row is not also reported as having no facility route.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts
```

Expected: PASS. Update `ObservedTab.tsx`, the facilities routes, and the CLI to carry `ambiguous` through — the type change will surface every site.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts apps/studio/src/facilities apps/server/src/facilities-routes.ts packages/cli/src/program.ts
git commit -m "fix(facilities): only SAME-AS resolves, and competing mappings resolve to nothing

The resolver never looked at map_type, so an operator who recorded
UNMAPPED-FROM -- explicitly saying 'this does not correspond' -- still drove
reports to that facility. It also took the first candidate the database
happened to return when several were active, making the facility shown in a
report depend on row order.

Resolution now requires SAME-AS, and two competing active mappings report
ambiguous and resolve to nothing rather than to an arbitrary winner."
```

### Task 11: Reject unsupported semantics and supersede at the API boundary

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` (the facility mapping save route)
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `FACILITY_REGISTRY_SYSTEM`.
- Produces: the save route returns a coded 400 for an unsupported `map_type`, and deactivates the prior active mapping for the same `(from_system, from_code)` in the same transaction as the new one.

- [ ] **Step 1: Write the failing tests**

```ts
it('rejects a non-SAME-AS facility mapping at the API boundary, not just in the UI', async () => {
  const res = await saveFacilityMapping(app, { fromCode: 'BALAB', toCode: 'L-1', mapType: 'RELATED-TO' });
  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe('FAC0010');
});

it('supersedes the previous active mapping in the same transaction', async () => {
  await saveFacilityMapping(app, { fromCode: 'BALAB', toCode: 'L-1' });
  await saveFacilityMapping(app, { fromCode: 'BALAB', toCode: 'L-2' });

  const active = await ctx.internalDb.selectFrom('term_mappings').select(['to_code'])
    .where('from_code', '=', 'BALAB').where('is_active', '=', true).execute();

  expect(active).toEqual([{ to_code: 'L-2' }]);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t "SAME-AS|supersede"
```

Expected: FAIL — the route accepts `RELATED-TO` with 200; both mappings stay active.

- [ ] **Step 3: Enforce at the boundary**

Register `FAC0010` in the error catalog (`@openldr/core`'s coded errors) as "unsupported facility mapping semantic". In the save route, before writing:

```ts
  // Domain-layer enforcement, not UI-layer. The audit's rule: the UI must never be the only place a
  // mapping semantic, uniqueness, status, or permission is enforced.
  if (body.mapType !== 'SAME-AS') {
    throw new AppError('FAC0010', `facility resolution requires map_type SAME-AS, got ${body.mapType}`);
  }
```

Then deactivate the prior active mapping through `admin.termMappings.update` before creating the new one, inside one transaction so a failure cannot leave both active or neither.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts packages/core/src
git commit -m "feat(facilities): enforce SAME-AS and single active resolution at the API boundary

Rejects an unsupported mapping semantic with a coded 400 and supersedes the
previous active mapping in the same transaction, so the UI is not the only
enforcement point for either rule."
```

### Task 12: Detect conflicts, record them, and add the unique index

**Files:**
- Create: `packages/db/src/migrations/internal/078_one_active_facility_resolution.ts` and its test
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`, `packages/db/src/schema/internal.ts`

**Interfaces:**
- Consumes: nothing at runtime — inlines its own constants.
- Produces: table `facility_mapping_conflicts` and index `term_mappings_one_active_facility_resolution`. Task 13 reads the table.

- [ ] **Step 1: Write the failing test**

```ts
const REGISTRY = 'urn:openldr:cs:facility-registry';

it('records a conflicting set, deactivates every member, and creates the index', async () => {
  const db = await makeMigrationDb();
  await db.insertInto('term_mappings').values([
    { id: 'tm-1', from_system: 'S', from_code: 'BALAB', to_system: REGISTRY, to_code: 'L-1', map_type: 'SAME-AS', is_active: true },
    { id: 'tm-2', from_system: 'S', from_code: 'BALAB', to_system: REGISTRY, to_code: 'L-2', map_type: 'SAME-AS', is_active: true },
  ] as never).execute();

  await up(db as never);

  const active = await db.selectFrom('term_mappings').select('id').where('is_active', '=', true).execute();
  expect(active).toEqual([]);

  const conflicts = await db.selectFrom('facility_mapping_conflicts').selectAll().execute();
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]).toMatchObject({ from_system: 'S', from_code: 'BALAB', kind: 'duplicate' });
});

it('records an unsupported map_type WITHOUT deactivating it', async () => {
  const db = await makeMigrationDb();
  await db.insertInto('term_mappings').values(
    { id: 'tm-3', from_system: 'S', from_code: 'X', to_system: REGISTRY, to_code: 'L-1', map_type: 'RELATED-TO', is_active: true } as never,
  ).execute();

  await up(db as never);

  const row = await db.selectFrom('term_mappings').select('is_active').where('id', '=', 'tm-3').executeTakeFirstOrThrow();
  expect(row.is_active).toBe(true);
  const conflicts = await db.selectFrom('facility_mapping_conflicts').select('kind').execute();
  expect(conflicts).toEqual([{ kind: 'unsupported_map_type' }]);
});

it('the index rejects a second active SAME-AS mapping for the same observed key', async () => {
  const db = await makeMigrationDb();
  await up(db as never);
  await db.insertInto('term_mappings').values(
    { id: 'tm-1', from_system: 'S', from_code: 'K', to_system: REGISTRY, to_code: 'L-1', map_type: 'SAME-AS', is_active: true } as never,
  ).execute();

  await expect(db.insertInto('term_mappings').values(
    { id: 'tm-2', from_system: 'S', from_code: 'K', to_system: REGISTRY, to_code: 'L-2', map_type: 'SAME-AS', is_active: true } as never,
  ).execute()).rejects.toThrow();
});

it('leaves a non-facility duplicate alone — the index is scoped to the registry system', async () => {
  const db = await makeMigrationDb();
  await up(db as never);
  await db.insertInto('term_mappings').values([
    { id: 'tm-1', from_system: 'S', from_code: 'K', to_system: 'http://loinc.org', to_code: 'A', map_type: 'SAME-AS', is_active: true },
    { id: 'tm-2', from_system: 'S', from_code: 'K', to_system: 'http://loinc.org', to_code: 'B', map_type: 'SAME-AS', is_active: true },
  ] as never).execute();

  expect(await db.selectFrom('term_mappings').select('id').where('is_active', '=', true).execute()).toHaveLength(2);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/db exec vitest run src/migrations/internal/078_one_active_facility_resolution.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the migration**

```ts
import { sql, type Kysely } from 'kysely';

// ⛔ Deliberately INLINED — frozen-snapshot rule (see 075's docblock).
const REGISTRY_SYSTEM = 'urn:openldr:cs:facility-registry';

/**
 * Order matters and is not rearrangeable: the partial unique index cannot be created while duplicate
 * active rows exist, so detection and deactivation must both complete first.
 *
 * Deactivating EVERY member of a conflicting set — rather than keeping the oldest — is the deliberate
 * choice. Picking a winner here would change published report output as an invisible side effect of a
 * migration. Zero active members means the observed row resolves to nothing and falls back to the raw
 * performer string, which is visibly wrong rather than confidently wrong, and the set survives in
 * `facility_mapping_conflicts` for an operator to settle.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const anyDb = db as Kysely<any>;

  await anyDb.schema
    .createTable('facility_mapping_conflicts')
    .addColumn('id', 'serial', (c) => c.primaryKey())
    .addColumn('from_system', 'text', (c) => c.notNull())
    .addColumn('from_code', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull()) // 'duplicate' | 'unsupported_map_type'
    .addColumn('mapping_ids', 'jsonb', (c) => c.notNull())
    .addColumn('detail', 'jsonb')
    .addColumn('detected_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('resolved_at', 'timestamptz')
    .execute();

  // 1+2: duplicate active SAME-AS sets → record.
  await sql`
    insert into facility_mapping_conflicts (from_system, from_code, kind, mapping_ids, detail)
    select m.from_system, m.from_code, 'duplicate',
           jsonb_agg(m.id order by m.created_at),
           jsonb_agg(jsonb_build_object('id', m.id, 'toCode', m.to_code, 'createdAt', m.created_at) order by m.created_at)
      from term_mappings m
     where m.is_active and m.to_system = ${REGISTRY_SYSTEM} and m.map_type = 'SAME-AS'
     group by m.from_system, m.from_code
    having count(*) > 1
  `.execute(anyDb);

  // 3: deactivate every member of a recorded duplicate set.
  await sql`
    update term_mappings m set is_active = false
     where m.is_active and m.to_system = ${REGISTRY_SYSTEM} and m.map_type = 'SAME-AS'
       and exists (
         select 1 from facility_mapping_conflicts c
          where c.kind = 'duplicate' and c.from_system = m.from_system and c.from_code = m.from_code
       )
  `.execute(anyDb);

  // 4: record unsupported semantics WITHOUT deactivating — the resolver already refuses to resolve
  // through them, so nothing about the stored row needs to change; this only explains to the operator
  // why their mapping stopped driving reports.
  await sql`
    insert into facility_mapping_conflicts (from_system, from_code, kind, mapping_ids, detail)
    select m.from_system, m.from_code, 'unsupported_map_type',
           jsonb_build_array(m.id), jsonb_build_object('mapType', m.map_type, 'toCode', m.to_code)
      from term_mappings m
     where m.is_active and m.to_system = ${REGISTRY_SYSTEM} and m.map_type <> 'SAME-AS'
  `.execute(anyDb);

  // 5: the invariant.
  await sql`
    create unique index term_mappings_one_active_facility_resolution
      on term_mappings (from_system, from_code)
      where is_active and to_system = ${REGISTRY_SYSTEM} and map_type = 'SAME-AS'
  `.execute(anyDb);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const anyDb = db as Kysely<any>;
  await sql`drop index if exists term_mappings_one_active_facility_resolution`.execute(anyDb);
  await anyDb.schema.dropTable('facility_mapping_conflicts').execute();
}
```

- [ ] **Step 4: Add the schema type and register**

Add `FacilityMappingConflictsTable` to `packages/db/src/schema/internal.ts` and `InternalSchema`, register `078` in `migrations/internal/index.ts`, and update `migrations.test.ts`'s exact list.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/db exec vitest run src/migrations
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations packages/db/src/schema/internal.ts
git commit -m "feat(db): enforce one active SAME-AS facility resolution per observed key

Records every conflicting set in facility_mapping_conflicts, deactivates all
of its members, then creates the partial unique index that keeps new ones
from forming.

Deactivating every member rather than keeping the oldest is deliberate:
picking a winner inside a migration would change published report output as
an invisible side effect. Zero active members makes the observed row fall
back to the raw performer string -- visibly unresolved rather than
confidently wrong -- with the set preserved for review."
```

### Task 13: Prove sync quarantine, and expose the review queue

**Files:**
- Modify: `packages/sync/src/pull-worker.test.ts`
- Modify: `packages/cli/src/program.ts` (new `openldr facilities conflicts` command)
- Modify: `apps/server/src/facilities-routes.ts` (`GET /api/facilities/mapping-conflicts`)
- Test: `packages/sync/src/pull-worker.test.ts`, `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `facility_mapping_conflicts` from Task 12.
- Produces: `GET /api/facilities/mapping-conflicts` returning unresolved conflict rows; `openldr facilities conflicts` printing the same.

- [ ] **Step 1: Write the failing tests**

```ts
it('quarantines a conflicting synced facility mapping and still advances the cursor', async () => {
  // The unique index can reject an incoming central mapping. term_mapping is NOT a hold record
  // (only terminology_system and concept_map are), so this must quarantine, not wedge the stream.
  let cursor = 0;
  const runner = createSyncPullRunner({
    getToken: async () => 't',
    postPull: async () => ({ records: [refRec(5, 'term_mapping'), refRec(6, 'form')], nextSeq: 6 }),
    applyRecord: async (rec) => {
      if (rec.seq === 5) throw new Error('duplicate key value violates unique constraint "term_mappings_one_active_facility_resolution"');
      return 'applied';
    },
    readCursor: async () => cursor,
    advanceCursor: async (s) => { cursor = s; },
    logger: testLogger,
  });

  const r = await runner.runCycle();

  expect(r.outcome).toBe('progressed');
  expect(cursor).toBe(6);
});
```

```ts
it('lists unresolved mapping conflicts for review', async () => {
  await ctx.internalDb.insertInto('facility_mapping_conflicts').values(
    { from_system: 'S', from_code: 'BALAB', kind: 'duplicate', mapping_ids: ['tm-1', 'tm-2'] } as never,
  ).execute();

  const res = await app.inject({ method: 'GET', url: '/api/facilities/mapping-conflicts' });

  expect(res.json()).toMatchObject([{ fromCode: 'BALAB', kind: 'duplicate' }]);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/sync exec vitest run src/pull-worker.test.ts -t quarantines
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t "mapping conflicts"
```

Expected: FAIL — the route 404s. The sync test may already pass; if so, keep it as a pinned regression test and say so in its comment.

- [ ] **Step 3: Add the route and CLI command**

Add `GET /api/facilities/mapping-conflicts` behind `facilities.manage`, returning rows where `resolved_at is null`. Add `openldr facilities conflicts` printing `from_system  from_code  kind  mapping_ids` (CLI parity).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/sync exec vitest run src/pull-worker.test.ts
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit and merge the slice**

```bash
git add packages/sync/src/pull-worker.test.ts apps/server/src/facilities-routes.ts packages/cli/src/program.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): expose the mapping-conflict review queue

Route and CLI for the conflicts migration 078 recorded, plus a pinned
regression test proving a unique-constraint rejection on an incoming synced
mapping quarantines rather than wedging the lab's pull cursor."
pnpm turbo run typecheck test --force > /tmp/gate-slice4.log 2>&1; echo "exit=$?"
```

Expected: `exit=0`. Then merge to local `main` with `--no-ff`.

---

## Self-review notes

**Spec coverage.** Slice 1 → Tasks 1–2. Slice 2 → Tasks 3–5. Slice 3 → Tasks 6–9. Slice 4 → Tasks 10–13. Every acceptance criterion in the spec maps to at least one test above: sync suspension (T1, T2), CSV quarantine and the 14k-survives case (T3, T4), identifier change including the unrelated-facility case (T7 ANCHOR), retired facilities excluded from selection but resolvable (T9), one active resolution enforced in the database (T12), unsupported semantics cannot resolve (T10).

**Known follow-ups, deliberately not in this plan.** Audit Phase 0 items 5 (`facility_map`'s natural key omitting the observed coding namespace) and 6 (durable, observable projection state) remain open. Task 9 relies on the picker's ACTIVE-only status filter; `TermPicker` only sends a status to the API when exactly one is selected (FAC-P1-14), so the facility flow must request `['ACTIVE']` alone for retirement to take effect — verify this during Task 9 rather than assuming it.
