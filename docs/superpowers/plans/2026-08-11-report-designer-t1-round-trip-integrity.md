# Report Design Round-Trip Integrity (T1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ReportDesign.pageNumbers` survive a store round trip and participate in the content hash, so the boot seed stops overwriting eight built-in designs — and any operator edit to them — on every restart.

**Architecture:** One nullable column, three call sites in `packages/report-designer/src/store.ts`, and two layers of test that make this defect class fail loudly for future fields. No UI, no schema redesign, no change to the seed's overwrite contract.

**Tech Stack:** TypeScript, Kysely, zod, pg-mem, vitest, pnpm workspaces + turbo.

**Spec:** `docs/superpowers/specs/2026-08-11-report-designer-t1-round-trip-integrity-design.md`

## Global Constraints

- **Migration number was originally `082`.** At the time this task was written, `081_facility_source_and_register_state.ts` was taken by the unmerged `slice/facility-canonical-identity` branch, and `082` was the next free number. That branch went on to also claim `082` (as `082_facility_canonical_identity`) before merging to `main`, so this migration collided at merge exactly as the warning below predicted, and was renumbered to `083` — the next free number after `main` gained both `081` and `082`. Before creating a migration file, re-check `packages/db/src/migrations/internal/` on every live branch — a fourth concurrent session claiming `083` collides the same way.
- **The `081`/`082` gap was a runtime hazard, not just a bookkeeping one, while this branch predated the facilities merge.** Kysely's migrator enforces strict prefix ordering by name (see Task 1 Step 5), so a database migrated from a build missing `081` and `082` could not boot once they arrived. This was contained by merging `slice/facility-canonical-identity` first; renumbering to `083` after that merge removes the gap entirely, since `main` then has `081`, `082`, `083` in unbroken sequence.
- **The column MUST be nullable with no default.** `canonicalHash` treats an absent key and `undefined` identically (`6ffddfd66fb48cc1`) but `false` as a distinct value (`73d48a5cffe2bba7`). A `NOT NULL DEFAULT false` column changes the content hash of every design that never set the flag and makes labs re-pull designs whose content did not change.
- **`fromRow` MUST yield `undefined`, never `false`, for a NULL column.** The hash-identity property above depends on it.
- **Never add a `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailer** to any commit.
- **Stage named paths only. Never `git add -A`** — the repository directory is shared with concurrent sessions.
- **Gate command:** `pnpm turbo run typecheck test --force`. **Never pipe turbo through `tail`.**
- Working directory for every command: `D:/Projects/Repositories/openldr_ce/.worktrees/report-designer-trust`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/src/migrations/internal/083_report_design_page_numbers.ts` | Create — adds the nullable `page_numbers` column | 1 |
| `packages/db/src/migrations/internal/083_report_design_page_numbers.test.ts` | Create — proves the column exists and round-trips under a fully migrated DB | 1 |
| `packages/db/src/migrations/internal/index.ts` | Modify — register migration 083 | 1 |
| `packages/db/src/schema/internal.ts:758-768` | Modify — add `page_numbers` to `ReportDesignsTable` | 1 |
| `packages/report-designer/src/store.ts:6-16, 18-31, 43-48` | Modify — `toRow`, `fromRow`, `hashOf` | 2, 3 |
| `packages/report-designer/src/store.test.ts` | Modify — table setup, round trip, hash behaviour, tripwire, exhaustive fixture | 2, 3, 4 |
| `packages/bootstrap/src/report-design-seed-drift.test.ts` | Create — the boot-seed acceptance test against the real store | 5 |

---

### Task 1: Add the `page_numbers` column

**Files:**
- Create: `packages/db/src/migrations/internal/083_report_design_page_numbers.ts`
- Create: `packages/db/src/migrations/internal/083_report_design_page_numbers.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts:758-768`

**Interfaces:**
- Consumes: nothing.
- Produces: a nullable `boolean` column `report_designs.page_numbers`, and the TypeScript field `ReportDesignsTable.page_numbers: boolean | null`. Task 2 writes and reads it.

- [ ] **Step 1: Confirm 083 is still free**

Run:
```bash
git branch -a --format='%(refname:short)' | while read b; do echo "-- $b"; git ls-tree --name-only "$b" packages/db/src/migrations/internal/ 2>/dev/null | grep -E '^packages.*/08[0-9]_' ; done
```
Expected: `081_facility_source_and_register_state.ts` appears on `slice/facility-canonical-identity`; **no** `083_` on any branch. If an `083_` exists anywhere, stop and rename this migration to the next free number, updating every reference in this plan.

- [ ] **Step 2: Write the failing migration test**

Create `packages/db/src/migrations/internal/083_report_design_page_numbers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('083_report_design_page_numbers', () => {
  it('adds a nullable page_numbers column that round-trips true, false and null', async () => {
    const db = await makeMigratedDb();

    const base = { pages: JSON.stringify([]), parameters: JSON.stringify([]), margins: null };
    await db.insertInto('report_designs').values([
      { id: 'd-true', name: 'On', page_numbers: true, ...base },
      { id: 'd-false', name: 'Off', page_numbers: false, ...base },
      { id: 'd-null', name: 'Unset', ...base },
    ] as never).execute();

    const rows = await db
      .selectFrom('report_designs')
      .select(['id', 'page_numbers'])
      .orderBy('id')
      .execute();

    expect(rows).toEqual([
      { id: 'd-false', page_numbers: false },
      { id: 'd-null', page_numbers: null },
      { id: 'd-true', page_numbers: true },
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
cd packages/db && npx vitest run src/migrations/internal/083_report_design_page_numbers.test.ts
```
Expected: FAIL — `Cannot find module './083_report_design_page_numbers'` is not the error (the test does not import it); the failure is a pg-mem error that column `page_numbers` does not exist.

- [ ] **Step 4: Write the migration**

Create `packages/db/src/migrations/internal/083_report_design_page_numbers.ts`:

```ts
import { type Kysely } from 'kysely';

// `ReportDesign.pageNumbers` has been in the zod schema and editable in the Properties tab since the
// designer shipped, but `report_designs` never had a column for it, so the store dropped it on every
// write. That silently broke more than a checkbox: the boot seed compares stored design content
// against the shipped definition via `designContent`, which normalises `pageNumbers ?? false`. All 8
// `simpleTableDesign` built-ins ship `pageNumbers: true`, so the comparison was permanently unequal
// and the seed overwrote them — and any operator edit to them — on every boot.
//
// ⛔ NULLABLE, NO DEFAULT, deliberately. `canonicalHash` (packages/core/src/canonical-json.ts) is
// JSON.stringify-based, so an ABSENT key and `undefined` hash identically while `false` is a
// distinct value. A `NOT NULL DEFAULT false` column would therefore change the content hash of
// every design that never set the flag, and `reference_change_log` would ship each of them to every
// lab as a change even though nothing about them changed. NULL -> `undefined` keeps those hashes
// byte-identical; only a real toggle moves the hash.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('report_designs').addColumn('page_numbers', 'boolean').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('report_designs').dropColumn('page_numbers').execute();
}
```

- [ ] **Step 5: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, add the import after the `m080` import line:

```ts
import * as m083 from './083_report_design_page_numbers';
```

and add the entry as the last line of the `internalMigrations` object, after `'080_facility_import_runs'`:

```ts
  '083_report_design_page_numbers': { up: m083.up, down: m083.down },
```

At the time this step was executed there was intentionally no `081` on this branch — it lived on the unmerged facilities branch and was expected to slot in ahead of this one at merge, as `082`.

⛔ **The gap was safe only because of merge order. It was not harmless in itself** — an earlier revision of this plan claimed it was, and that was wrong. `createMigrator` (`packages/db/src/migrator.ts:5-10`) constructs `new Migrator({ db, provider })` without `allowUnorderedMigrations`, and Kysely 0.28.17 defaults that to `false` (`DEFAULT_ALLOW_UNORDERED_MIGRATIONS`). It then sorts migrations by name and requires the executed set to be a strict prefix, throwing `corrupted migrations: expected previously executed migration … to be at index N but … was found in its place` otherwise. So a database that applies a later-numbered migration while an earlier one is absent, and is later upgraded to a build containing that earlier one, **fails to migrate — and `apps/server` self-migrates on startup, so that server will not boot.**

`makeMigratedDb` cannot detect this: it iterates `Object.values(internalMigrations)` directly and never invokes Kysely's `Migrator`. No test in this repository exercises the ordering check.

**What actually happened:** merge order was not guaranteed. The facilities branch went on to claim `082` for its own migration (`082_facility_canonical_identity`) before merging, colliding with this branch's page-numbers migration exactly as the collision warning above predicted. The resolution was renumbering: this migration became `083`, the next free number once `main` carried both `081` and `082` from the facilities merge. `main` now sees `081`, `082`, `083` in unbroken sequence, so the gap this section warned about does not exist on any shipped build.

- [ ] **Step 6: Add the column to the TypeScript table type**

In `packages/db/src/schema/internal.ts`, in `interface ReportDesignsTable` (line 758), add the field after `margins`:

```ts
export interface ReportDesignsTable {
  id: string;
  name: string;
  paper: Generated<string>;
  orientation: Generated<string>;
  pages: unknown;
  parameters: unknown;
  margins: unknown | null;
  page_numbers: boolean | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run:
```bash
cd packages/db && npx vitest run src/migrations/internal/083_report_design_page_numbers.test.ts
```
Expected: PASS, 1 test.

- [ ] **Step 8: Typecheck the package**

Run:
```bash
cd packages/db && npx tsc --noEmit
```
Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/migrations/internal/083_report_design_page_numbers.ts packages/db/src/migrations/internal/083_report_design_page_numbers.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(report-designer): add nullable report_designs.page_numbers column

Nullable with no default so an unset flag keeps hashing identically to
today — a NOT NULL DEFAULT false column would change every existing
design's content hash and re-ship them all over reference sync."
```

---

### Task 2: Persist `pageNumbers` through the store

**Files:**
- Modify: `packages/report-designer/src/store.ts:6-16` (`toRow`), `:18-31` (`fromRow`)
- Modify: `packages/report-designer/src/store.test.ts:10-18` (hand-built table), plus new tests

**Interfaces:**
- Consumes: `report_designs.page_numbers` from Task 1.
- Produces: `createReportDesignStore(db, capture?)` whose `create`/`update`/`get`/`list` preserve `pageNumbers`. `get` returns `pageNumbers: boolean | undefined` — never `false` for a NULL column. Tasks 3, 4 and 5 depend on this.

- [ ] **Step 1: Add the column to the test table**

`store.test.ts` hand-builds its table rather than running migrations, so it needs the column or the new tests fail for the wrong reason and read as a real defect. In `packages/report-designer/src/store.test.ts`, change the `beforeEach` table builder (line 10-18) to add `page_numbers` after `margins`:

```ts
  await db.schema.createTable('report_designs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('paper', 'text')
    .addColumn('orientation', 'text')
    .addColumn('pages', 'jsonb').addColumn('parameters', 'jsonb')
    .addColumn('margins', 'jsonb')
    .addColumn('page_numbers', 'boolean')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text').execute();
```

- [ ] **Step 2: Write the failing test**

Append inside the existing `describe('ReportDesignStore', ...)` block in `packages/report-designer/src/store.test.ts`:

```ts
  it('round-trips pageNumbers, and reads an unset flag back as undefined not false', async () => {
    const store = createReportDesignStore(db);

    await store.create({ ...makeDesign('pn-on', 'On'), pageNumbers: true });
    expect((await store.get('pn-on'))?.pageNumbers).toBe(true);

    await store.create({ ...makeDesign('pn-off', 'Off'), pageNumbers: false });
    expect((await store.get('pn-off'))?.pageNumbers).toBe(false);

    // Unset must come back `undefined`. `false` would change the design's content hash and
    // re-ship every previously-unflagged design over reference sync (see migration 083).
    await store.create(makeDesign('pn-unset', 'Unset'));
    expect((await store.get('pn-unset'))?.pageNumbers).toBeUndefined();
  });

  it('preserves pageNumbers across an update', async () => {
    const store = createReportDesignStore(db);
    const created = await store.create({ ...makeDesign('pn-upd', 'Upd'), pageNumbers: true });
    await store.update('pn-upd', { ...created, name: 'Renamed' });
    const updated = await store.get('pn-upd');
    expect(updated?.name).toBe('Renamed');
    expect(updated?.pageNumbers).toBe(true);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:
```bash
cd packages/report-designer && npx vitest run src/store.test.ts
```
Expected: FAIL, 2 failing tests — `expected undefined to be true` on the first assertion of each new test.

- [ ] **Step 4: Write the implementation**

In `packages/report-designer/src/store.ts`, add the field to `toRow`:

```ts
function toRow(d: ReportDesign) {
  return {
    id: d.id,
    name: d.name,
    paper: d.paper,
    orientation: d.orientation,
    pages: JSON.stringify(d.pages),
    parameters: JSON.stringify(d.parameters),
    margins: d.margins ? JSON.stringify(d.margins) : null,
    // `?? null` not `?? false` — see migration 083. An unset flag must persist as NULL so it reads
    // back `undefined` and leaves the content hash unchanged.
    page_numbers: d.pageNumbers ?? null,
  };
}
```

and to `fromRow`, after the `margins` line:

```ts
    margins: r.margins == null ? undefined : parse(r.margins, undefined),
    pageNumbers: r.page_numbers == null ? undefined : Boolean(r.page_numbers),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
cd packages/report-designer && npx vitest run src/store.test.ts
```
Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add packages/report-designer/src/store.ts packages/report-designer/src/store.test.ts
git commit -m "fix(report-designer): persist pageNumbers through the design store

toRow dropped the field and fromRow never read it back, so a design saved
with page numbers enabled came back with them off. NULL reads as undefined
rather than false to keep the content hash of never-flagged designs stable."
```

---

### Task 3: Include `pageNumbers` in the content hash

**Files:**
- Modify: `packages/report-designer/src/store.ts:43-48` (`hashOf`)
- Modify: `packages/report-designer/src/store.test.ts` — new tests

**Interfaces:**
- Consumes: the round trip from Task 2.
- Produces: `hashOf` covering `pageNumbers`, so a toggle propagates over reference sync. Nothing later depends on new symbols; `hashOf` stays module-private and is observed through the injected `ReferenceCapture`.

- [ ] **Step 1: Write the failing tests**

`hashOf` is module-private. Observe it through the `capture` the store already accepts. Add these imports at the top of `packages/report-designer/src/store.test.ts`:

```ts
import type { ReferenceCapture } from '@openldr/db';
```

Then append inside the existing `describe('ReportDesignStore', ...)` block:

```ts
  // Captures the content hash the store records for each write, which is the only observable
  // surface of the module-private `hashOf`.
  function spyCapture() {
    const hashes: (string | null)[] = [];
    const capture: ReferenceCapture = {
      record: async (_trx, _entityType, _entityId, _op, contentHash) => { hashes.push(contentHash); },
    };
    return { capture, hashes };
  }

  it('hashes an unset pageNumbers identically to an explicitly undefined one', async () => {
    // Pins canonicalJson's undefined-dropping. If that ever changed, every never-flagged design's
    // hash would move and reference sync would re-ship the whole design set.
    const { capture, hashes } = spyCapture();
    const store = createReportDesignStore(db, capture);
    await store.create(makeDesign('h-absent', 'Same'));
    await store.create({ ...makeDesign('h-undef', 'Same'), pageNumbers: undefined });
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('hashes false differently from unset', async () => {
    // This is the property migration 083's nullability rests on: `false` is NOT the same as unset,
    // so a NOT NULL DEFAULT false column would have moved every existing design's hash.
    const { capture, hashes } = spyCapture();
    const store = createReportDesignStore(db, capture);
    await store.create(makeDesign('h-unset', 'Same'));
    await store.create({ ...makeDesign('h-false', 'Same'), pageNumbers: false });
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('hashes true differently from false, so a real toggle propagates', async () => {
    const { capture, hashes } = spyCapture();
    const store = createReportDesignStore(db, capture);
    await store.create({ ...makeDesign('h-off', 'Same'), pageNumbers: false });
    await store.create({ ...makeDesign('h-on', 'Same'), pageNumbers: true });
    expect(hashes[0]).not.toBe(hashes[1]);
  });
```

Note: `makeDesign` builds `pages: [{ id: \`${id}-p1\`, elements: [] }]`, so two designs with different ids differ in `pages` and would hash differently for the wrong reason. Change `makeDesign` (line 21-29) to take a fixed page id so these comparisons isolate `pageNumbers`:

```ts
function makeDesign(id: string, name: string): ReportDesign {
  return {
    id,
    name,
    paper: 'A4',
    orientation: 'portrait',
    // Fixed, not derived from `id` — the hash tests compare two designs that must differ ONLY in
    // `pageNumbers`, and `hashOf` covers `pages`.
    pages: [{ id: 'p1', elements: [] }],
    parameters: [],
  };
}
```

- [ ] **Step 2: Run the tests to verify the right ones fail**

Run:
```bash
cd packages/report-designer && npx vitest run src/store.test.ts
```
Expected: the first hash test PASSES (both hashes already omit the field), and the second and third FAIL with `expected '…' not to be '…'` — because `hashOf` ignores `pageNumbers`, all three designs hash identically.

- [ ] **Step 3: Write the implementation**

In `packages/report-designer/src/store.ts`, add the field to `hashOf`:

```ts
function hashOf(d: ReportDesign): string {
  return canonicalHash({
    name: d.name, paper: d.paper, orientation: d.orientation,
    pages: d.pages, parameters: d.parameters, margins: d.margins,
    // Omitted until T1: a page-numbers toggle produced an unchanged hash, so the de-dupe in
    // recordReferenceChange suppressed it and the change never reached a lab.
    pageNumbers: d.pageNumbers,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd packages/report-designer && npx vitest run src/store.test.ts
```
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/store.ts packages/report-designer/src/store.test.ts
git commit -m "fix(report-designer): include pageNumbers in the design content hash

Without it a toggle produced an unchanged hash, so recordReferenceChange's
de-dupe suppressed the change and it never propagated central to lab."
```

---

### Task 4: Guard against the next dropped field

**Files:**
- Modify: `packages/report-designer/src/store.test.ts` — new tests

**Interfaces:**
- Consumes: the store from Tasks 2 and 3.
- Produces: no runtime symbols. Adds `KNOWN_TOP_LEVEL_FIELDS`, a test-local constant that a future author must extend when the schema grows.

- [ ] **Step 1: Write the failing tests**

Add this import at the top of `packages/report-designer/src/store.test.ts`:

```ts
import { ReportDesignSchema } from './schema';
```

Then append a new `describe` block at the end of the file, outside `describe('ReportDesignStore', ...)`:

```ts
// The defect this slice fixes was "a field nobody remembered". A fixture alone cannot catch the
// next one, because a new field is simply absent from it and everything still passes. The tripwire
// is what forces the fixture to grow.
const KNOWN_TOP_LEVEL_FIELDS = [
  'id', 'name', 'paper', 'orientation', 'pages', 'parameters', 'margins', 'pageNumbers',
  'createdAt', 'updatedAt',
] as const;

describe('ReportDesign round-trip completeness', () => {
  it('has no top-level schema field the store has not been taught about', () => {
    // FAILING HERE? You added a field to ReportDesignSchema. Do all three:
    //   1. persist it in `toRow` and read it in `fromRow` (packages/report-designer/src/store.ts),
    //      adding a column via a migration if it is not inside the `pages` jsonb blob;
    //   2. add it to `hashOf`, or it will never sync;
    //   3. add it to KNOWN_TOP_LEVEL_FIELDS and to EVERY_FIELD below, with a non-default value.
    expect(Object.keys(ReportDesignSchema.shape).sort()).toEqual([...KNOWN_TOP_LEVEL_FIELDS].sort());
  });

  it('round-trips every persisted field at a non-default value', async () => {
    const EVERY_FIELD: ReportDesign = {
      id: 'full',
      name: 'Every field set',
      paper: 'Letter',
      orientation: 'landscape',
      margins: { top: 11, right: 22, bottom: 33, left: 44 },
      parameters: [{ key: 'facility', label: 'Facility', type: 'select', required: true, value: 'Ndola' }],
      pages: [{
        id: 'full-p1',
        elements: [{ id: 'e1', kind: 'text', name: 'Title', rect: { x: 1, y: 2, w: 3, h: 4 }, text: 'Hi' }],
      }],
      pageNumbers: true,
    };

    const store = createReportDesignStore(db);
    await store.create(EVERY_FIELD);
    const got = await store.get('full');
    expect(got).toBeDefined();

    // `createdAt`/`updatedAt` are stamped by the database, not round-tripped from the input.
    const { createdAt, updatedAt, ...persisted } = got!;
    expect(createdAt).toBeDefined();
    expect(updatedAt).toBeDefined();
    expect(persisted).toEqual(EVERY_FIELD);
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run:
```bash
cd packages/report-designer && npx vitest run src/store.test.ts
```
Expected: PASS. Both are green because Tasks 1-3 already did the work — they are regression guards, not drivers.

- [ ] **Step 3: Verify the tripwire actually trips**

Temporarily add a throwaway field to `ReportDesignSchema` in `packages/report-designer/src/schema.ts`, immediately after the `pageNumbers` line:

```ts
  zzThrowaway: z.string().optional(),
```

Run:
```bash
cd packages/report-designer && npx vitest run src/store.test.ts
```
Expected: FAIL on `has no top-level schema field the store has not been taught about`, listing `zzThrowaway`. **Now remove the throwaway line** and re-run to confirm PASS. A guard that has never been seen to fail is not a guard.

- [ ] **Step 4: Confirm the schema file is back to its committed state**

Run:
```bash
git diff --stat packages/report-designer/src/schema.ts
```
Expected: no output. If anything is listed, the throwaway field is still there — remove it.

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/store.test.ts
git commit -m "test(report-designer): guard every top-level design field against being dropped

A key-set tripwire over ReportDesignSchema.shape plus an exhaustive
round-trip fixture. Neither is sufficient alone: the fixture proves the
round trip, the tripwire is what forces the fixture to be extended."
```

---

### Task 5: Prove the boot seed no longer sees drift

**Files:**
- Create: `packages/bootstrap/src/report-design-seed-drift.test.ts`

**Interfaces:**
- Consumes: `createReportDesignStore` (Tasks 2, 3) and `seedDataDrivenReports`, `SEED_DESIGNS`, `DEFAULT_CONNECTOR_NAME`, `SeedDataDrivenReportsDeps` from `@openldr/reporting`.
- Produces: nothing consumed downstream. This is the acceptance criterion for the whole slice.

**Why this test lives in `packages/bootstrap`:** `packages/reporting`'s existing suite already has `is idempotent — re-running with the same connector seeds nothing new` (`report-seeds.test.ts:104`), which asserts `designsUpdated: 0` and **passes today** while production drifts on every boot. It passes because its `designs` fake is a lossless `Map` that cannot drop `pageNumbers` the way the real store did. The bug only appears when the real store is in the loop, and `packages/bootstrap` is the only package that depends on both `@openldr/reporting` and `@openldr/report-designer` and has `pg-mem` available.

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/report-design-seed-drift.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createReportDesignStore } from '@openldr/report-designer';
import {
  seedDataDrivenReports,
  SEED_DESIGNS,
  DEFAULT_CONNECTOR_NAME,
  type SeedDataDrivenReportsDeps,
} from '@openldr/reporting';

// The seeded designs are the only dep that must be REAL here. `packages/reporting`'s own idempotence
// test uses a lossless Map for designs, so it stayed green while every boot overwrote all 8
// `simpleTableDesign` built-ins — the store dropped `pageNumbers: true`, `designContent` normalised
// the missing value to `false`, and the comparison against the shipped `true` was never equal.
let db: Kysely<any>;
beforeEach(async () => {
  const mem = newDb();
  db = mem.adapters.createKysely();
  await db.schema.createTable('report_designs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('paper', 'text')
    .addColumn('orientation', 'text')
    .addColumn('pages', 'jsonb').addColumn('parameters', 'jsonb')
    .addColumn('margins', 'jsonb')
    .addColumn('page_numbers', 'boolean')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text').execute();
});

function depsWithRealDesignStore(): SeedDataDrivenReportsDeps {
  const queries = new Map<string, { id: string; connectorId: string; sql: string; params?: unknown }>();
  const reportDefs = new Map<string, { id: string }>();
  return {
    customQueries: {
      get: async (id) => (queries.has(id) ? (queries.get(id) as never) : null),
      create: async (q) => { queries.set(q.id, { id: q.id, connectorId: q.connectorId, sql: q.sql, params: q.params }); },
      update: async (id, patch) => {
        const cur = queries.get(id);
        if (cur) {
          queries.set(id, {
            ...cur,
            ...('sql' in patch ? { sql: patch.sql as string } : {}),
            ...('params' in patch ? { params: patch.params } : {}),
          });
        }
      },
    },
    designs: createReportDesignStore(db),
    reportDefs: {
      get: async (id) => reportDefs.get(id) as never,
      create: async (r) => { reportDefs.set(r.id, { ...r } as never); return r; },
      update: async (id, r) => { reportDefs.set(id, { ...r, id } as never); return { ...r, id } as never; },
    },
    connectors: { list: async () => [{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }] as never },
  };
}

describe('boot seed drift against the real report-design store', () => {
  it('seeds every design once and reports no drift on the second run', async () => {
    const deps = depsWithRealDesignStore();

    const first = await seedDataDrivenReports(deps);
    expect(first.designsSeeded).toBe(SEED_DESIGNS.length);
    expect(first.designsUpdated).toBe(0);

    // The real defect: this was `8` on every boot, silently reverting any operator edit to a
    // built-in design (see the managed-overwrite comment at report-seeds.ts:2534).
    const second = await seedDataDrivenReports(deps);
    expect(second.designsSeeded).toBe(0);
    expect(second.designsUpdated).toBe(0);

    // A third run must be just as quiet — drift that only settles after one rewrite is still drift.
    const third = await seedDataDrivenReports(deps);
    expect(third.designsUpdated).toBe(0);
  });

  it('keeps pageNumbers on a seeded built-in after a round trip', async () => {
    const deps = depsWithRealDesignStore();
    await seedDataDrivenReports(deps);
    const stored = await deps.designs.get('rt-amr-resistance');
    expect(stored?.pageNumbers).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails when the store is reverted**

This test must be seen to fail against the pre-fix store, or it proves nothing. Temporarily revert the two `page_numbers` lines in `packages/report-designer/src/store.ts` — comment out the `page_numbers:` line in `toRow` and the `pageNumbers:` line in `fromRow` — then run:

```bash
cd packages/bootstrap && npx vitest run src/report-design-seed-drift.test.ts
```
Expected: FAIL — `expected 8 to be 0` on `second.designsUpdated`, and `expected undefined to be true` on the second test.

- [ ] **Step 3: Restore the store and confirm the test passes**

Un-comment both lines, then run:

```bash
git diff --stat packages/report-designer/src/store.ts
```
Expected: no output — the file is back to its committed state.

```bash
cd packages/bootstrap && npx vitest run src/report-design-seed-drift.test.ts
```
Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/report-design-seed-drift.test.ts
git commit -m "test(bootstrap): pin the boot seed against report-design drift

packages/reporting's idempotence test uses a lossless Map for designs, so
it stayed green while the real store dropped pageNumbers and every boot
rewrote all 8 simpleTableDesign built-ins. This one runs the seed loop
against the real store."
```

---

### Task 6: Full gate

**Files:** none modified.

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: evidence the slice is clean across packages.

- [ ] **Step 1: Run the full gate**

Run from the worktree root:
```bash
pnpm turbo run typecheck test --force
```
Expected: all packages pass. **Do not pipe this through `tail`** — a Windows lock/EPERM race can flake `--force` installs, and piping hides which package failed.

- [ ] **Step 2: Triage any failure before blaming this slice**

If a package fails, grep the output for `Test timed out`. Gate failures in this repo are frequently timeouts rather than regressions. Re-run the single package directly:

```bash
cd packages/<name> && npx vitest run
```
If it passes in isolation, it was a parallel-turbo flake. If it fails in isolation, it is a real regression from this slice — fix it before proceeding.

- [ ] **Step 3: Confirm the working tree contains only intended changes**

Run:
```bash
git status --short
git log --oneline main..HEAD
```
Expected: a clean tree, and five commits from Tasks 1-5. No throwaway probe files, no `zzThrowaway` schema field.

---

## Definition of Done

- `report_designs.page_numbers` exists, nullable, registered as migration `083`.
- A design saved with page numbers enabled reads back enabled; a design that never set the flag reads back `undefined`, not `false`.
- Toggling page numbers changes the design's content hash; leaving it unset does not.
- `Object.keys(ReportDesignSchema.shape)` is pinned, and the tripwire has been observed to fail and recover.
- `seedDataDrivenReports` run three times against the real store reports `designsUpdated: 0` after the first.
- `pnpm turbo run typecheck test --force` is clean.
