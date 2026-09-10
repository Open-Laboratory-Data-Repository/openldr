> **PARKED, 2026-09-10.** This slice was built, merged at `416d2131`, and then removed along with
> the Data step it served. The operator's call after running the whole wizard against the real
> Zambia export: overkill, and every repair is made on the source file instead. The removal is its
> own plan, `2026-09-10-remove-the-data-step.md`, and the reasoning is recorded in the spec.
>
> Nothing below is wrong. If cell editing is ever wanted again, this is the design to start from,
> with three things already known: `csv-parse`'s `info.lines` names the line a record FINISHES on;
> the paged read does not lowercase headers while `parseFacilityCsv` does; and a row quarantined for
> its field count cannot be rescued by any edit.

# Facility import cell edits (Slice C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator repair a cell in the uploaded file, keep that repair across re-uploads of the same file, and have validate and apply read the file through those repairs.

**Architecture:** A new table holds one row per edit, keyed on the register and the file hash rather than on the run. The parser gains an overlay that patches the split CSV record by column index, before the field map is built, so an edit reaches a contract field or `extras` according to what that column maps to. The worker loads the overlay for `(nationalSystem, fileHash)` and passes it into both the validate and the apply parse. The studio's Data grid becomes editable and offers two outcomes on a controlled-field column: change this one row, or sweep the value across the file.

**Tech Stack:** Kysely migrations (Postgres, pg-mem in tests), Fastify + zod routes, `csv-parse`, React 18 with shadcn components, vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-09-08-facility-import-data-stage-design.md`

## Global Constraints

Copied verbatim from `AGENTS.md`, `CLAUDE.md` and the spec. Every task's requirements include this section.

- Never add `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailers. The operator is the sole contributor.
- No em dashes anywhere in new writing. No emoji in headings or bullets. Short sentences, target 15 words.
- Never hardcode clinical vocabulary. Codes, statuses and value sets come from the terminology service or config.
- Kysely enforces strict numeric migration prefix order. `090_report_design_i18n.ts` is the newest; `091` is the next free number and no other branch claims it.
- pg-mem is not Postgres. It mishandles partial indexes: once a row leaves a partial index predicate it is excluded from any later query filtering on the indexed column. Use plain unique indexes over a computed key column, the way `080_facility_import_runs.ts` does with `active_key`.
- Actions go in a `MoreHorizontal` dropdown. Never a standalone Create/New button, never a `SheetFooter` with Cancel/Save.
- shadcn only. Never a native `<select>`, `<button>`, `<input>` or `<dialog>`.
- Every `<Table>` gets `TablePagination`.
- Test gate: `pnpm turbo run test --concurrency=2 --force`, redirected to a file. Never pipe turbo through `tail`.
- The operator is running the dev stack from this checkout with `AUTH_DEV_BYPASS=true`. Do not kill any dev server or stack.
- Commit after every task. Do not push or merge without being asked.

## Rulings taken before this plan was written

The spec left four things open. Each is decided here, with what it costs if the decision is wrong.

**R1. The editable grid is the Data step's grid, not a second grid under Mapping.** The spec's stage 3 paragraph says the grid sits below Mapping. Slice A shipped it as its own step and the wizard's strip now has four labels (`ImportFacilitiesSheet.tsx:1413`). Two grids over one file would be two paging states over one 64 MB register, and the Data step is one click away from Mapping. Cost if wrong: the operator clicks one extra tab to repair a value the Mapping step flagged.

**R2. CSV only. `parseFacilityRelease` gets no overlay.** A JSONL release is a publisher's file in the contract's own shape. The spec's own scope note says a row that should not be imported is a row to remove from the CSV. The studio hides editing when the run's `sourceFormat` is `jsonl`. Cost if wrong: a JSONL operator repairs their release before uploading, which is what they do today.

**R3. Two kinds of edit, one table.** A line-scoped edit names one cell (`line` set, `from_value` null). A value-scoped edit names every cell in one column holding one value (`line` null, `from_value` set). The value-scoped row is what "map everywhere" writes, so a sweep across 3 788 rows costs one row instead of 3 788. A line-scoped edit wins over a value-scoped one on the same cell: the operator repaired that exact cell after asking for the sweep, so the later, narrower decision stands. Cost if wrong: a sweep the operator then partially undid behaves differently from what they expected on one cell.

**R4. "Map everywhere" writes a value-scoped EDIT, not a terminology mapping.** Slice B already covers "this raw value means this code" through the value worklist and `writeFacilityValueMappings`. A cell edit is the operator typing a corrected string, not picking a code from a value set, and decision 6 makes every column editable including extras columns that have no value set at all. Routing it through terminology would need a code the operator never chose. Cost if wrong: a spelling repaired here does not teach the register anything, and the operator maps the corrected spelling once in the value worklist.

## File structure

**Created:**
- `packages/db/src/migrations/internal/091_facility_import_edits.ts` - the table.
- `packages/db/src/facility-import-edit-store.ts` - read, write, delete, clear. One responsibility: the edits table.
- `packages/db/src/facility-import-edit-store.test.ts`
- `apps/studio/src/facilities/CellEditChoiceDialog.tsx` - the this-row versus everywhere choice.
- `apps/studio/src/facilities/CellEditChoiceDialog.test.tsx`

**Modified:**
- `packages/db/src/schema/internal.ts` - the table type plus its entry in `InternalSchema`.
- `packages/db/src/migrations/internal/index.ts` - register `091`.
- `packages/db/src/index.ts` - export the store.
- `packages/bootstrap/src/facility-file-rows.ts` - the window carries each row's file line number.
- `packages/terminology/src/facility-csv.ts` - `FacilityCsvOptions.cellEdits` and the overlay in the row loop.
- `packages/bootstrap/src/facility-import.ts` - `FacilityImportOptions.cellEdits`, threaded into `parseOpts`.
- `packages/bootstrap/src/facility-import-worker.ts` - load the overlay before validate and before apply.
- `apps/server/src/facilities-routes.ts` - the edits routes, and `lines` on the rows response.
- `apps/studio/src/api.ts` - the edits client and `lines` on `FacilityImportRows`.
- `apps/studio/src/facilities/DataGridStep.tsx` - editable cells, the edited marker, undo.
- `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` - pass the run's format, the column map and the register down.
- `apps/studio/src/i18n/{en,fr,pt}.ts` - the new keys.
- `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md` and `apps/web/src/docs/0.1.0/facilities.md`.

---

### Task 1: The edits table and its store

**Files:**
- Create: `packages/db/src/migrations/internal/091_facility_import_edits.ts`
- Create: `packages/db/src/facility-import-edit-store.ts`
- Create: `packages/db/src/facility-import-edit-store.test.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Modify: `packages/db/src/migrations/internal/index.ts:90-91` and `:182-183`
- Modify: `packages/db/src/index.ts:59-61`

**Interfaces:**
- Consumes: `InternalSchema` from `./schema/internal`, `makeMigratedDb` from `./migrations/internal/test-helpers`.
- Produces:
  ```ts
  export interface FacilityImportEdit {
    id: string;
    nationalSystem: string;
    fileHash: string;
    header: string;
    line: number | null;
    fromValue: string | null;
    toValue: string;
    createdBy: string | null;
    createdAt: string;
  }
  export interface FacilityImportEditStore {
    list(nationalSystem: string, fileHash: string): Promise<FacilityImportEdit[]>;
    put(input: {
      nationalSystem: string; fileHash: string; header: string;
      line?: number | null; fromValue?: string | null; toValue: string;
      createdBy?: string | null;
    }): Promise<FacilityImportEdit>;
    remove(nationalSystem: string, fileHash: string, key:
      { header: string; line: number } | { header: string; fromValue: string }): Promise<boolean>;
    clear(nationalSystem: string, fileHash: string): Promise<number>;
  }
  export function createFacilityImportEditStore(db: Kysely<InternalSchema>): FacilityImportEditStore;
  ```

- [ ] **Step 1: Write the failing store test**

Create `packages/db/src/facility-import-edit-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityImportEditStore } from './facility-import-edit-store';
import type { InternalSchema } from './schema/internal';

const SYS = 'urn:zm:mfl';
const HASH = 'a'.repeat(64);

describe('createFacilityImportEditStore', () => {
  it('writes a line-scoped edit and reads it back for that file', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'Health Centre' });
    const rows = await store.list(SYS, HASH);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ header: 'Type', line: 12, fromValue: null, toValue: 'Health Centre' });
  });

  it('replaces an edit for the same cell rather than storing two', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'first' });
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'second' });
    const rows = await store.list(SYS, HASH);
    expect(rows).toHaveLength(1);
    expect(rows[0].toValue).toBe('second');
  });

  it('keeps a line-scoped and a value-scoped edit on one header apart', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'one row' });
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', fromValue: 'Others', toValue: 'everywhere' });
    const rows = await store.list(SYS, HASH);
    expect(rows).toHaveLength(2);
  });

  it('a different file hash does not see this file edits', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'x' });
    expect(await store.list(SYS, 'b'.repeat(64))).toEqual([]);
  });

  it('a different register does not see this register edits', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'x' });
    expect(await store.list('urn:tz:hfr', HASH)).toEqual([]);
  });

  it('removes one edit and reports whether anything went', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'x' });
    expect(await store.remove(SYS, HASH, { header: 'Type', line: 12 })).toBe(true);
    expect(await store.remove(SYS, HASH, { header: 'Type', line: 12 })).toBe(false);
    expect(await store.list(SYS, HASH)).toEqual([]);
  });

  it('removes a value-scoped edit by its value, not its line', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', fromValue: 'Others', toValue: 'y' });
    expect(await store.remove(SYS, HASH, { header: 'Type', fromValue: 'Others' })).toBe(true);
    expect(await store.list(SYS, HASH)).toEqual([]);
  });

  it('clear drops every edit for one file and counts them', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'x' });
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Name', line: 13, toValue: 'y' });
    expect(await store.clear(SYS, HASH)).toBe(2);
    expect(await store.list(SYS, HASH)).toEqual([]);
  });

  it('refuses an edit that names neither a line nor a value', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await expect(store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', toValue: 'x' }))
      .rejects.toThrow(/line or a value/i);
  });

  it('refuses an edit that names both a line and a value', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await expect(store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 2, fromValue: 'a', toValue: 'x' }))
      .rejects.toThrow(/line or a value/i);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @openldr/db exec vitest run src/facility-import-edit-store.test.ts`
Expected: FAIL, cannot resolve `./facility-import-edit-store`.

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/internal/091_facility_import_edits.ts`:

```ts
import { type Kysely, sql } from 'kysely';

// Slice C of the facility import data stage. One row per cell repair the operator made on the
// Data grid, so a repaired file imports as repaired without the uploaded blob ever being rewritten.
//
// Keyed on `(national_system, file_hash)`, NOT on the run. A re-upload of the same bytes mints a
// new run, so run-keyed edits would vanish the moment the operator re-uploaded for an unrelated
// reason. `file_hash` is a sha256 of the bytes and is `notNull` on every run (migration 080), so a
// file that actually changed gets a different hash and its old edits stop applying, which is right:
// the line numbers they name would no longer mean anything.
//
// Two shapes share this table. `line` set with `from_value` null is one cell. `line` null with
// `from_value` set is every cell in that column holding that value, which is what the grid's
// "change it everywhere" writes: one row instead of 3 788.
//
// PLAIN unique index over a computed `edit_key`, never a partial index on `line`. pg-mem
// mishandles partial indexes for the reason migration 080 documents at length, and the two shapes
// above would otherwise need one predicate each.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('facility_import_edits')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('national_system', 'text', (c) => c.notNull())
    .addColumn('file_hash', 'text', (c) => c.notNull())
    // The SOURCE header, spelled exactly as the file spells it, never a contract field. That is what
    // lets an edit reach a column carried through as extra data, which has no contract field at all.
    .addColumn('header', 'text', (c) => c.notNull())
    .addColumn('line', 'integer')
    .addColumn('from_value', 'text')
    .addColumn('to_value', 'text', (c) => c.notNull())
    .addColumn('edit_key', 'text', (c) => c.notNull())
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`create unique index facility_import_edits_key on facility_import_edits (edit_key)`.execute(db);

  await db.schema.createIndex('facility_import_edits_file')
    .on('facility_import_edits').columns(['national_system', 'file_hash']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('facility_import_edits').execute();
}
```

- [ ] **Step 4: Register the migration and the schema type**

In `packages/db/src/migrations/internal/index.ts`, after the `m090` import line:

```ts
import * as m091 from './091_facility_import_edits';
```

and after the `'090_report_design_i18n'` entry:

```ts
  '091_facility_import_edits': { up: m091.up, down: m091.down },
```

In `packages/db/src/schema/internal.ts`, beside `FacilityImportRunsTable`:

```ts
/** Slice C: one operator repair on the Data grid, keyed on the register and the file rather than on
 *  the run, so a re-upload of the same bytes keeps them. `edit_key` is a computed uniqueness key,
 *  not data: see migration 091 for why a plain index over it beats two partial indexes. */
export interface FacilityImportEditsTable {
  id: string;
  national_system: string;
  file_hash: string;
  header: string;
  line: number | null;
  from_value: string | null;
  to_value: string;
  edit_key: string;
  created_by: string | null;
  created_at: Generated<Date>;
}
```

and, in the `InternalSchema` interface beside `facility_import_runs: FacilityImportRunsTable;`:

```ts
  facility_import_edits: FacilityImportEditsTable;
```

- [ ] **Step 5: Write the store**

Create `packages/db/src/facility-import-edit-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

/** One operator repair on the Data grid. Either `line` is set (one cell) or `fromValue` is set
 *  (every cell in that column holding that value), never both and never neither. */
export interface FacilityImportEdit {
  id: string;
  nationalSystem: string;
  fileHash: string;
  /** The SOURCE header, spelled as the file spells it. Never a contract field: decision 6 of the
   *  design makes every column editable, including one carried through as extra data. */
  header: string;
  line: number | null;
  fromValue: string | null;
  toValue: string;
  createdBy: string | null;
  createdAt: string;
}

export interface FacilityImportEditStore {
  /** Every edit for one file, oldest first with a unique id tiebreaker so the order is stable. */
  list(nationalSystem: string, fileHash: string): Promise<FacilityImportEdit[]>;
  /** Writes or replaces one edit. Replacing is the point: editing the same cell twice must leave
   *  one row, not two, or the overlay would have to pick between them. */
  put(input: {
    nationalSystem: string; fileHash: string; header: string;
    line?: number | null; fromValue?: string | null; toValue: string;
    createdBy?: string | null;
  }): Promise<FacilityImportEdit>;
  /** The undo. `false` means there was nothing there, which is not an error. */
  remove(nationalSystem: string, fileHash: string, key:
    { header: string; line: number } | { header: string; fromValue: string }): Promise<boolean>;
  /** Every edit for one file, gone. Returns how many went. */
  clear(nationalSystem: string, fileHash: string): Promise<number>;
}

/** The uniqueness key the plain unique index in migration 091 sits on. The `line:`/`value:`
 *  discriminator is what keeps a line-scoped and a value-scoped edit on the same header apart,
 *  and what lets one index cover both shapes without a partial predicate pg-mem cannot plan. */
function editKey(
  nationalSystem: string, fileHash: string, header: string,
  scope: { line: number } | { fromValue: string },
): string {
  const tail = 'line' in scope ? `line:${scope.line}` : `value:${scope.fromValue}`;
  return `${nationalSystem}|${fileHash}|${header}|${tail}`;
}

export function createFacilityImportEditStore(db: Kysely<InternalSchema>): FacilityImportEditStore {
  const row = (r: {
    id: string; national_system: string; file_hash: string; header: string;
    line: number | null; from_value: string | null; to_value: string;
    created_by: string | null; created_at: Date;
  }): FacilityImportEdit => ({
    id: r.id,
    nationalSystem: r.national_system,
    fileHash: r.file_hash,
    header: r.header,
    line: r.line === null ? null : Number(r.line),
    fromValue: r.from_value,
    toValue: r.to_value,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  });

  return {
    async list(nationalSystem, fileHash) {
      const rows = await db.selectFrom('facility_import_edits')
        .selectAll()
        .where('national_system', '=', nationalSystem)
        .where('file_hash', '=', fileHash)
        // `id` is the tiebreaker AGENTS.md section 7 requires beside any ordered read. pg-mem's
        // scan order is stable, so it can never show a tie behaving non-deterministically.
        .orderBy('created_at', 'asc').orderBy('id', 'asc')
        .execute();
      return rows.map(row);
    },

    async put(input) {
      const hasLine = input.line !== undefined && input.line !== null;
      const hasValue = input.fromValue !== undefined && input.fromValue !== null;
      // Refused here rather than left to the index, because the index cannot tell "neither" from
      // "both": one produces a key with no scope and the other a key with two.
      if (hasLine === hasValue) {
        throw new Error('a facility import edit names a line or a value, never both and never neither');
      }
      const scope = hasLine ? { line: input.line as number } : { fromValue: input.fromValue as string };
      const key = editKey(input.nationalSystem, input.fileHash, input.header, scope);
      const values = {
        id: `fie_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        national_system: input.nationalSystem,
        file_hash: input.fileHash,
        header: input.header,
        line: hasLine ? (input.line as number) : null,
        from_value: hasValue ? (input.fromValue as string) : null,
        to_value: input.toValue,
        edit_key: key,
        created_by: input.createdBy ?? null,
      };
      const saved = await db.insertInto('facility_import_edits')
        .values(values)
        .onConflict((oc) => oc.column('edit_key').doUpdateSet({
          to_value: input.toValue,
          created_by: input.createdBy ?? null,
        }))
        .returningAll()
        .executeTakeFirstOrThrow();
      return row(saved);
    },

    async remove(nationalSystem, fileHash, key) {
      const scope = 'line' in key ? { line: key.line } : { fromValue: key.fromValue };
      const res = await db.deleteFrom('facility_import_edits')
        .where('edit_key', '=', editKey(nationalSystem, fileHash, key.header, scope))
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0) > 0;
    },

    async clear(nationalSystem, fileHash) {
      const res = await db.deleteFrom('facility_import_edits')
        .where('national_system', '=', nationalSystem)
        .where('file_hash', '=', fileHash)
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0);
    },
  };
}
```

In `packages/db/src/index.ts`, beside the other facility store exports around line 59:

```ts
export { createFacilityImportEditStore } from './facility-import-edit-store';
export type { FacilityImportEdit, FacilityImportEditStore } from './facility-import-edit-store';
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `pnpm --filter @openldr/db exec vitest run src/facility-import-edit-store.test.ts`
Expected: PASS, 10 tests.

Then run the migration suite, because a new prefix breaks boot if it is misregistered:

Run: `pnpm --filter @openldr/db exec vitest run src/migrations`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src
git commit -m "feat(facilities): a table for cell edits, keyed on the register and the file"
```

---

### Task 2: The paged read names each row's file line

**Files:**
- Modify: `packages/bootstrap/src/facility-file-rows.ts:69-110` (`readCsvRows`), `:142-178` (`readFileRows`)
- Modify: `apps/server/src/facilities-routes.ts:3025-3033` (the rows response)
- Modify: `apps/studio/src/api.ts:1657-1670` (`FacilityImportRows`)
- Test: `packages/bootstrap/src/facility-file-rows.test.ts`
- Test: `apps/server/src/facilities-routes.test.ts`

**Why this task exists.** An edit is keyed on a file line number, and the grid is the only thing that can name one. Today the window carries no line numbers, and `offset + index + 2` is wrong for any CSV with a quoted field containing a newline: `csv-parse` reports the record's true `info.lines`, which is what `parseFacilityCsv` already quarantines by (`facility-csv.ts:391`). Guessing here would key edits to lines the parser never sees.

**Interfaces:**
- Consumes: `FileRowWindow` from this same file.
- Produces: `FileRowWindow` gains `lines: number[]`, one entry per entry in `rows`, same order. `FacilityImportRows` gains the same field.

- [ ] **Step 1: Write the failing reader test**

Append to `packages/bootstrap/src/facility-file-rows.test.ts`:

```ts
it('names each row file line, counting a quoted newline as part of its row', async () => {
  const csv = 'code,name\n'
    + '1,Alpha\n'
    + '2,"Beta\nsecond half"\n'
    + '3,Gamma\n';
  const w = await readFileRows(Readable.from([csv]), { format: 'csv', offset: 0, limit: 10 });
  // Row 3 sits on line 5, not line 4: row 2 spans two lines.
  expect(w.lines).toEqual([2, 3, 5]);
});

it('names the line of each row in a later window, not of the window', async () => {
  const csv = 'code,name\n' + Array.from({ length: 6 }, (_, i) => `${i},row${i}`).join('\n') + '\n';
  const w = await readFileRows(Readable.from([csv]), { format: 'csv', offset: 4, limit: 2 });
  expect(w.lines).toEqual([6, 7]);
});

it('names each JSONL row line, skipping the lines it could not read', async () => {
  const jsonl = '{"code":"1"}\nnot json\n{"code":"3"}\n';
  const w = await readFileRows(Readable.from([jsonl]), { format: 'jsonl', offset: 0, limit: 10 });
  expect(w.lines).toEqual([1, 3]);
});
```

If `Readable` and `readFileRows` are not already imported in that file, add:

```ts
import { Readable } from 'node:stream';
import { readFileRows } from './facility-file-rows';
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-file-rows.test.ts`
Expected: FAIL, `w.lines` is undefined.

- [ ] **Step 3: Carry the line numbers through both readers**

In `packages/bootstrap/src/facility-file-rows.ts`, add `lines: number[]` to the `FileRowWindow` interface with this docblock:

```ts
  /** The FILE LINE each entry in `rows` came from, 1-based, same order and same length. Read off
   *  `csv-parse`'s own `info.lines`, which is the number `parseFacilityCsv` quarantines by
   *  (facility-csv.ts) and the number a cell edit is keyed on. NOT `offset + index + 2`: one quoted
   *  field containing a newline puts every later row on a line that arithmetic cannot reach. */
  lines: number[];
```

Change `readCsvRows`'s return type to `{ headers: string[]; rows: string[][]; lines: number[]; scanned: number }`, turn on `info` in the parser options, and read the line off each record:

```ts
  const parser = stream.pipe(parseCsvStream({
    columns: false,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    // The record's true file line. Everything else here is unchanged; `info: true` only changes the
    // SHAPE of what the iterator yields, from `string[]` to `{ record, info }`.
    info: true,
  }));

  let headers: string[] = [];
  const rows: string[][] = [];
  const lines: number[] = [];
  let scanned = 0;
  let first = true;

  try {
    for await (const entry of parser as AsyncIterable<{ record: string[]; info: { lines: number } }>) {
      const record = entry.record;
      if (first) {
        headers = record.map((h, i) => (i === 0 ? stripBom(h) : h));
        first = false;
        continue;
      }
      if (scanned >= offset && rows.length < limit) {
        rows.push(record);
        lines.push(entry.info.lines);
      }
      scanned += 1;
    }
  } catch (err) {
```

and return `{ headers, rows, lines, scanned }`.

In `readFileRows`, the CSV branch already spreads the window, so it needs no change beyond the type. In the JSONL branch, add `const lines: number[] = [];`, push `lineNumber` beside every `rows.push(...)`, and return `{ headers, rows, lines, scanned, skippedLines, skipped }`.

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-file-rows.test.ts`
Expected: PASS.

- [ ] **Step 5: Return the lines from the route and type them in the client**

In `apps/server/src/facilities-routes.ts`, in the rows route's success return (around line 3025), add `lines: window.lines,` beside `rows: window.rows,`.

In `apps/studio/src/api.ts`, add to `FacilityImportRows` after `rows`:

```ts
  /** The FILE LINE each entry in `rows` came from, 1-based, same order and same length. A cell edit
   *  is keyed on this number, so the grid must never compute it from `offset`. */
  lines: number[];
```

- [ ] **Step 6: Write and run the route test**

Add to the rows-route describe block in `apps/server/src/facilities-routes.test.ts`, following whatever fixture the neighbouring rows tests already use:

```ts
it('returns the file line of every row it pages back', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}/rows?offset=0&limit=2` });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { rows: string[][]; lines: number[] };
  expect(body.lines).toHaveLength(body.rows.length);
  expect(body.lines[0]).toBe(2);
});
```

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts`
Expected: PASS. Fix the fixture's `runId` binding if the neighbouring tests name it differently.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/facility-file-rows.ts packages/bootstrap/src/facility-file-rows.test.ts apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts apps/studio/src/api.ts
git commit -m "feat(facilities): the paged file read names each row's file line"
```

---

### Task 3: The overlay inside the CSV parser

**Files:**
- Modify: `packages/terminology/src/facility-csv.ts:52-73` (`FacilityCsvOptions`), `:391-406` (the row loop)
- Test: `packages/terminology/src/facility-csv.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. This is a pure function change.
- Produces:
  ```ts
  export interface FacilityCellEdits {
    /** file line -> source header -> replacement value */
    byLine: Record<number, Record<string, string>>;
    /** source header -> current value -> replacement value */
    byValue: Record<string, Record<string, string>>;
  }
  ```
  and `FacilityCsvOptions.cellEdits?: FacilityCellEdits`.

**Where it goes, and the one boundary it cannot cross.** The patch applies to the SPLIT RECORD, by column index, after the field-count quarantine check and before `r` is built at `facility-csv.ts:406`. That placement costs no CSV re-serialisation, carries an edit into a contract field or into `extras` according to what that column maps to, and lets the edit take part in every parse-time check that follows: a corrected coordinate becomes valid, a corrected name rescues a row the parser would otherwise skip. A row quarantined for the wrong FIELD COUNT is rejected before the field map exists, so no cell edit can rescue it. That row still needs fixing in the CSV.

**Trimming.** The parser runs with `trim: true`, and so does the reader that fed the grid. `byValue` keys are therefore compared against trimmed values, and the grid shows trimmed values. Both sides agree because both trim; neither side may start trusting untrimmed text.

- [ ] **Step 1: Write the failing parser tests**

Append to `packages/terminology/src/facility-csv.test.ts`:

```ts
describe('parseFacilityCsv cell edits', () => {
  const base = { nationalSystem: 'urn:zm:mfl' };
  const csv = 'national_code,name,level\n'
    + '1,Alpha,Health Centre\n'
    + '2,Beta,Others\n'
    + '3,Gamma,Others\n';

  it('replaces one cell on the line the edit names', () => {
    const res = parseFacilityCsv(csv, {
      ...base,
      cellEdits: { byLine: { 3: { level: 'Health Post' } }, byValue: {} },
    });
    expect(res.records.map((r) => r.level)).toEqual(['Health Centre', 'Health Post', 'Others']);
  });

  it('replaces a value everywhere it appears in that column', () => {
    const res = parseFacilityCsv(csv, {
      ...base,
      cellEdits: { byLine: {}, byValue: { level: { Others: 'Health Post' } } },
    });
    expect(res.records.map((r) => r.level)).toEqual(['Health Centre', 'Health Post', 'Health Post']);
  });

  it('leaves the same value in another column alone', () => {
    const two = 'national_code,name,level\n1,Others,Health Centre\n';
    const res = parseFacilityCsv(two, {
      ...base,
      cellEdits: { byLine: {}, byValue: { level: { Others: 'Health Post' } } },
    });
    expect(res.records[0].name).toBe('Others');
  });

  it('a line edit wins over a value edit on the same cell', () => {
    const res = parseFacilityCsv(csv, {
      ...base,
      cellEdits: {
        byLine: { 3: { level: 'from the line' } },
        byValue: { level: { Others: 'from the value' } },
      },
    });
    expect(res.records[1].level).toBe('from the line');
    expect(res.records[2].level).toBe('from the value');
  });

  it('an edit names the SOURCE header, so it works through a column map', () => {
    const mapped = 'code,facility,Type\n1,Alpha,Others\n';
    const res = parseFacilityCsv(mapped, {
      ...base,
      columnMap: { columns: { code: 'national_code', facility: 'name', Type: 'level' } },
      cellEdits: { byLine: {}, byValue: { Type: { Others: 'Health Post' } } },
    });
    expect(res.records[0].level).toBe('Health Post');
  });

  it('an edit reaches a column carried through as extra data', () => {
    const extra = 'national_code,name,Ward\n1,Alpha,typo\n';
    const res = parseFacilityCsv(extra, {
      ...base,
      allowUnknownColumns: true,
      cellEdits: { byLine: { 2: { Ward: 'Chilenje' } }, byValue: {} },
    });
    expect(res.records[0].extras?.Ward).toBe('Chilenje');
  });

  it('a corrected coordinate stops being invalid', () => {
    const coords = 'national_code,name,latitude,longitude\n1,Alpha,N/A,28.3\n';
    const res = parseFacilityCsv(coords, {
      ...base,
      cellEdits: { byLine: { 2: { latitude: '-15.4' } }, byValue: {} },
    });
    expect(res.invalid).toEqual([]);
    expect(res.records[0].latitude).toBe(-15.4);
  });

  it('a corrected required field rescues a row the parser would have skipped', () => {
    const missing = 'national_code,name\n1,\n';
    const res = parseFacilityCsv(missing, {
      ...base,
      cellEdits: { byLine: { 2: { name: 'Alpha' } }, byValue: {} },
    });
    expect(res.skipped).toBe(0);
    expect(res.records[0].name).toBe('Alpha');
  });

  it('cannot rescue a row quarantined for its field count', () => {
    const ragged = 'national_code,name\n1,Alpha,extra\n';
    const res = parseFacilityCsv(ragged, {
      ...base,
      cellEdits: { byLine: { 2: { name: 'Beta' } }, byValue: {} },
    });
    expect(res.quarantined).toHaveLength(1);
    expect(res.records).toEqual([]);
  });

  it('parses identically when no edits are supplied', () => {
    const withOut = parseFacilityCsv(csv, base);
    const withEmpty = parseFacilityCsv(csv, { ...base, cellEdits: { byLine: {}, byValue: {} } });
    expect(withEmpty.records).toEqual(withOut.records);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @openldr/terminology exec vitest run src/facility-csv.test.ts -t "cell edits"`
Expected: FAIL. `cellEdits` is not a known option, so every replacement assertion sees the original value.

- [ ] **Step 3: Add the option**

In `packages/terminology/src/facility-csv.ts`, before `FacilityCsvOptions`:

```ts
/** The operator's repairs to this file, as the Data grid recorded them (Slice C). Two shapes,
 *  because a sweep across 3 788 rows must not cost 3 788 rows in a table.
 *
 *  Both key on the SOURCE HEADER, never a contract field: every column is editable, and a column
 *  carried through as extra data has no contract field to name.
 *
 *  Values are compared AFTER trimming, because this parser runs with `trim: true` and so does the
 *  reader that showed the operator the cell. Both sides trim, so both sides agree. */
export interface FacilityCellEdits {
  /** file line -> source header -> replacement value. Wins over `byValue` on the same cell. */
  byLine: Record<number, Record<string, string>>;
  /** source header -> current value -> replacement value. */
  byValue: Record<string, Record<string, string>>;
}
```

and add to `FacilityCsvOptions`, after `columnMap`:

```ts
  /** Apply the operator's cell repairs while parsing (Slice C). Omitted means the file parses
   *  exactly as it was uploaded, which is what every caller predating this option gets. */
  cellEdits?: FacilityCellEdits;
```

- [ ] **Step 4: Apply the overlay in the row loop**

In `packages/terminology/src/facility-csv.ts`, inside `for (const { record, info, raw } of rows.slice(1)) {`, immediately AFTER the field-count quarantine `continue` and BEFORE `const r: Record<string, string> = {};`:

```ts
    // Slice C: the operator's cell repairs, patched into the SPLIT RECORD by column index before
    // the field map below is built. That is what carries an edit into a contract field or into
    // `extras` according to what the column maps to, and what lets it take part in every check
    // that follows: a corrected coordinate becomes valid, a corrected name rescues a row that
    // would otherwise be skipped.
    //
    // AFTER the field-count quarantine above, deliberately and unavoidably. A ragged row is
    // rejected before the field map exists, so no edit can rescue it; that row is fixed in the
    // CSV, which is what the parser already tells the operator.
    //
    // A LINE edit beats a VALUE edit on the same cell. The operator repaired that exact cell after
    // asking for the sweep, so the later, narrower decision is the one that stands.
    if (opts.cellEdits) {
      const lineEdits = opts.cellEdits.byLine[info.lines];
      const valueEdits = opts.cellEdits.byValue;
      for (let i = 0; i < headers.length; i += 1) {
        const header = headers[i];
        const fromLine = lineEdits?.[header];
        if (fromLine !== undefined) { record[i] = fromLine; continue; }
        const fromValue = valueEdits[header]?.[record[i]];
        if (fromValue !== undefined) record[i] = fromValue;
      }
    }
```

`raw` is deliberately left alone. Quarantine reporting and the audit trail both want the line as the operator actually sent it.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --filter @openldr/terminology exec vitest run src/facility-csv.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Commit**

```bash
git add packages/terminology/src/facility-csv.ts packages/terminology/src/facility-csv.test.ts
git commit -m "feat(facilities): the CSV parser reads a file through the operator's cell edits"
```

---

### Task 4: Validate and apply read the file through the overlay

**Files:**
- Modify: `packages/bootstrap/src/facility-import.ts:97-140` (`FacilityImportOptions`), `:692-698` (`parseOpts`)
- Modify: `packages/bootstrap/src/facility-import-worker.ts:19-30` (deps), `:253-291` (`validateOptions`), `:292+` (`applyOptions`), `:396`, `:475`
- Test: `packages/bootstrap/src/facility-import-worker.test.ts`

**Interfaces:**
- Consumes: `FacilityCellEdits` from `@openldr/terminology` (Task 3), `FacilityImportEditStore` and `FacilityImportEdit` from `@openldr/db` (Task 1).
- Produces:
  ```ts
  // packages/bootstrap/src/facility-import.ts
  export function toCellEdits(edits: FacilityImportEdit[]): FacilityCellEdits;
  ```
  and `FacilityImportOptions.cellEdits?: FacilityCellEdits`.

  The worker deps gain an optional store:
  ```ts
  edits?: FacilityImportEditStore;
  ```

**Why the store is optional.** `FacilityImportWorkerDeps` already keeps `admin` and `facilityJobs` optional so a caller outside the app repo still works (see that interface's own note at `facility-import-worker.ts:24`). `edits` follows the same rule: no store means no overlay, and the file parses exactly as uploaded.

**Why the options are not stored.** `validateOptions(run)` and `applyOptions(run)` build a transient `FacilityImportOptions` from `run.options`; the object they return is handed straight to `importFacilities` and never persisted. `cellEdits` therefore never reaches `run.options` JSONB, and a run row stays a record of what the operator chose, not a copy of the edits table.

- [ ] **Step 1: Write the failing worker test**

Append to `packages/bootstrap/src/facility-import-worker.test.ts`, following the fixture the neighbouring worker tests already build:

```ts
it('validates the stored file through the edits recorded for that register and hash', async () => {
  const parsed: string[] = [];
  const deps = makeWorkerDeps({
    // The CSV the blob holds. Line 2's level reads `Others` on disk.
    blobBody: 'national_code,name,level\n1,Alpha,Others\n',
    edits: {
      list: async (sys: string, hash: string) => {
        expect(sys).toBe('urn:zm:mfl');
        expect(hash).toBe(RUN_FILE_HASH);
        return [{
          id: 'fie_1', nationalSystem: sys, fileHash: hash, header: 'level',
          line: 2, fromValue: null, toValue: 'Health Post',
          createdBy: null, createdAt: new Date().toISOString(),
        }];
      },
      put: async () => { throw new Error('not used'); },
      remove: async () => false,
      clear: async () => 0,
    },
    onParsedLevel: (v: string) => parsed.push(v),
  });
  await runOnce(deps);
  expect(parsed).toEqual(['Health Post']);
});

it('parses the file as uploaded when no edits store is wired', async () => {
  const parsed: string[] = [];
  const deps = makeWorkerDeps({
    blobBody: 'national_code,name,level\n1,Alpha,Others\n',
    onParsedLevel: (v: string) => parsed.push(v),
  });
  await runOnce(deps);
  expect(parsed).toEqual(['Others']);
});
```

If the existing worker test file has no `makeWorkerDeps` helper with a `blobBody`/`onParsedLevel` hook, add one alongside the existing fixture rather than reshaping the fixture other tests use. The observation point is the record set `importFacilities` writes: assert on what reached `deps.importDeps` rather than on a spy over the parser.

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-import-worker.test.ts`
Expected: FAIL, the first test sees `Others`.

- [ ] **Step 3: Add the option and the converter**

In `packages/bootstrap/src/facility-import.ts`, add to `FacilityImportOptions` after `columnMap`:

```ts
  /** The operator's cell repairs, from the Data grid (Slice C). Threaded straight into the parser,
   *  which applies them to the split record before the field map is built. CSV only: a JSONL
   *  release is a publisher's file in the contract's own shape, and `parseFacilityRelease` takes no
   *  overlay, so this is ignored rather than erroring for `format: 'jsonl'`. */
  cellEdits?: FacilityCellEdits;
```

Add `cellEdits: opts.cellEdits,` to the `parseOpts` object at line 692.

Add the converter, near the other exported helpers in the same file:

```ts
/** Fold the edits table's rows into the shape the parser takes. The two scopes stay separate all
 *  the way down, because the parser decides between them per cell: a line edit wins. */
export function toCellEdits(edits: FacilityImportEdit[]): FacilityCellEdits {
  const byLine: Record<number, Record<string, string>> = {};
  const byValue: Record<string, Record<string, string>> = {};
  for (const e of edits) {
    if (e.line !== null) {
      (byLine[e.line] ??= {})[e.header] = e.toValue;
    } else if (e.fromValue !== null) {
      (byValue[e.header] ??= {})[e.fromValue] = e.toValue;
    }
    // A row that is neither is impossible: the store refuses to write one. Skipped rather than
    // thrown, because a parse must not fail over a row that cannot exist.
  }
  return { byLine, byValue };
}
```

Import `FacilityCellEdits` from `@openldr/terminology` and `FacilityImportEdit` from `@openldr/db` at the top of the file.

- [ ] **Step 4: Load the overlay in the worker**

In `packages/bootstrap/src/facility-import-worker.ts`, add to the deps interface beside `admin`/`facilityJobs`:

```ts
  /** Slice C. Optional for the same reason `admin` is: a caller outside the app repo still works.
   *  Absent means the file parses exactly as it was uploaded. */
  edits?: FacilityImportEditStore;
```

Add a loader beside `validateOptions`:

```ts
  /** The overlay for one run's file, keyed on the register and the file hash rather than on the
   *  run, so a re-upload of the same bytes keeps the repairs. `undefined` when no store is wired,
   *  when the run has no edits, or when the file is a JSONL release, which takes no overlay. */
  async function cellEditsFor(run: FacilityImportRun): Promise<FacilityCellEdits | undefined> {
    if (!deps.edits || run.sourceFormat !== 'csv') return undefined;
    const rows = await deps.edits.list(run.nationalSystem, run.fileHash);
    return rows.length === 0 ? undefined : toCellEdits(rows);
  }
```

Widen both option builders to take it:

```ts
  function validateOptions(run: FacilityImportRun, cellEdits?: FacilityCellEdits): FacilityImportOptions {
```

and, in the returned object, `cellEdits,`. Do the same for `applyOptions`.

At line 396, replace the call:

```ts
      // Loaded BEFORE the parse, and once: the validate that produces the summary and the apply
      // that writes the register must read the file through the same repairs, or the confirm gate
      // would authorise a record set the operator never reviewed.
      const cellEdits = await cellEditsFor(run);
      const summary = await importFacilities(deps.importDeps, body, validateOptions(run, cellEdits));
```

At line 475, the same for the apply:

```ts
      const cellEdits = await cellEditsFor(run);
      summary = await importFacilities(deps.importDeps, body, applyOptions(run, cellEdits));
```

Import `toCellEdits` from `./facility-import`, `FacilityCellEdits` from `@openldr/terminology` and `FacilityImportEditStore` from `@openldr/db`.

- [ ] **Step 5: Wire the store where the worker is constructed**

In `packages/bootstrap/src/index.ts`, beside `createFacilityImportRunStore(internal.db)` at line 988, add:

```ts
  const facilityImportEdits = createFacilityImportEditStore(internal.db);
```

and pass `edits: facilityImportEdits` into the worker deps wherever `facilityImportRuns` is passed today. Add `createFacilityImportEditStore` to the `@openldr/db` import at line 39. Export `facilityImportEdits` on the app context beside `facilityImportRuns`, so Task 5's routes can reach it.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-import-worker.test.ts src/facility-import.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src apps/server/src
git commit -m "feat(facilities): validate and apply read the file through the cell edits"
```

---

### Task 5: The edits routes

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` (after the rows route, around line 3040)
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `createFacilityImportEditStore` from `@openldr/db` (Task 1); `importRuns` and the `MANAGE` guard, both already in this file at `:815`.
- Produces three routes:
  - `GET /api/facilities/import/runs/:id/edits` returns `{ edits: FacilityImportEdit[] }`
  - `PUT /api/facilities/import/runs/:id/edits` takes `{ header, line?, fromValue?, toValue }` and returns the saved edit
  - `DELETE /api/facilities/import/runs/:id/edits?header=&line=` or `?header=&fromValue=` returns `{ removed: boolean }`

**Why MANAGE, not VIEW.** The same access decision the rows route already documents at `:2982`. These routes read and write the raw content of an uploaded file. Putting the file there takes `facilities.manage`, so repairing it takes the same.

**Why keyed off the run and not off the register.** The operator has a run id in hand and nothing else. The route resolves `(nationalSystem, fileHash)` from the run row, which is also the guard: an operator cannot write edits against a register or a file they never uploaded.

- [ ] **Step 1: Write the failing route tests**

Add to `apps/server/src/facilities-routes.test.ts`, in the same describe block as the rows-route tests:

```ts
it('writes a cell edit and reads it back for the run', async () => {
  const put = await app.inject({
    method: 'PUT', url: `/api/facilities/import/runs/${runId}/edits`,
    payload: { header: 'level', line: 2, toValue: 'Health Post' },
  });
  expect(put.statusCode).toBe(200);
  const read = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}/edits` });
  expect(read.statusCode).toBe(200);
  expect((read.json() as { edits: unknown[] }).edits).toHaveLength(1);
});

it('writes a value-scoped edit', async () => {
  const put = await app.inject({
    method: 'PUT', url: `/api/facilities/import/runs/${runId}/edits`,
    payload: { header: 'level', fromValue: 'Others', toValue: 'Health Post' },
  });
  expect(put.statusCode).toBe(200);
  expect((put.json() as { line: number | null }).line).toBeNull();
});

it('refuses an edit naming neither a line nor a value', async () => {
  const res = await app.inject({
    method: 'PUT', url: `/api/facilities/import/runs/${runId}/edits`,
    payload: { header: 'level', toValue: 'Health Post' },
  });
  expect(res.statusCode).toBe(400);
});

it('refuses an edit naming both a line and a value', async () => {
  const res = await app.inject({
    method: 'PUT', url: `/api/facilities/import/runs/${runId}/edits`,
    payload: { header: 'level', line: 2, fromValue: 'Others', toValue: 'Health Post' },
  });
  expect(res.statusCode).toBe(400);
});

it('undoes one edit', async () => {
  await app.inject({
    method: 'PUT', url: `/api/facilities/import/runs/${runId}/edits`,
    payload: { header: 'level', line: 2, toValue: 'Health Post' },
  });
  const del = await app.inject({
    method: 'DELETE', url: `/api/facilities/import/runs/${runId}/edits?header=level&line=2`,
  });
  expect(del.statusCode).toBe(200);
  expect(del.json()).toEqual({ removed: true });
  const read = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}/edits` });
  expect((read.json() as { edits: unknown[] }).edits).toEqual([]);
});

it('reports 404 for a run that does not exist', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/facilities/import/runs/fir_missing/edits' });
  expect(res.statusCode).toBe(404);
});

it('a second run over the same file sees the first run edits', async () => {
  await app.inject({
    method: 'PUT', url: `/api/facilities/import/runs/${runId}/edits`,
    payload: { header: 'level', line: 2, toValue: 'Health Post' },
  });
  // Same register, same file hash, a new run row. This is the whole point of the key.
  const second = await makeStoredRun({ nationalSystem: REGISTER_URL, fileHash: RUN_FILE_HASH });
  const read = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${second}/edits` });
  expect((read.json() as { edits: unknown[] }).edits).toHaveLength(1);
});
```

Reuse whatever helper the existing rows tests use to mint a stored run. If none is factored out, extract one rather than copying the insert.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t "edit"`
Expected: FAIL with 404 on every route.

- [ ] **Step 3: Write the routes**

In `apps/server/src/facilities-routes.ts`, add `createFacilityImportEditStore` to the `@openldr/db` import at line 28, and beside `const importRuns = ...` at line 815:

```ts
  const importEdits = createFacilityImportEditStore(ctx.internalDb);
```

After the rows route, add:

```ts
  // Slice C: the operator's cell repairs for one run's file.
  //
  // KEYED OFF THE RUN, and resolved to `(nationalSystem, fileHash)` from the run row. That is the
  // guard as well as the lookup: an operator holds a run id and nothing else, and cannot name a
  // register or a file they never uploaded. It is also why a re-upload of the same bytes keeps the
  // repairs, which is the whole reason these are not run-scoped.
  //
  // MANAGE, not VIEW, for the reason the rows route above documents: these read and write the raw
  // content of an uploaded file.
  const EditScopeSchema = z.object({
    header: z.string().min(1),
    line: z.number().int().positive().optional(),
    fromValue: z.string().optional(),
  });
  const EditSchema = EditScopeSchema.extend({ toValue: z.string() });

  app.get('/api/facilities/import/runs/:id/edits', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await importRuns.get(id);
    if (!run) { reply.code(404); return { error: `import run not found: ${id}` }; }
    return { edits: await importEdits.list(run.nationalSystem, run.fileHash) };
  });

  app.put('/api/facilities/import/runs/:id/edits', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = EditSchema.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.issues[0]?.message ?? 'invalid edit' }; }
    const { header, line, fromValue, toValue } = parsed.data;
    // Refused HERE as well as in the store, because a 500 from the store's own throw would tell the
    // studio this was a server fault when it is a request that names no cell.
    if ((line === undefined) === (fromValue === undefined)) {
      reply.code(400);
      return { error: 'an edit names a line or a value, never both and never neither' };
    }
    const run = await importRuns.get(id);
    if (!run) { reply.code(404); return { error: `import run not found: ${id}` }; }
    return importEdits.put({
      nationalSystem: run.nationalSystem,
      fileHash: run.fileHash,
      header,
      line: line ?? null,
      fromValue: fromValue ?? null,
      toValue,
      createdBy: actorName(req),
    });
  });

  app.delete('/api/facilities/import/runs/:id/edits', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { header?: string; line?: string; fromValue?: string };
    if (!q.header) { reply.code(400); return { error: 'header is required' }; }
    // NaN check, not `||`: the same trap the rows route documents on its own numeric params.
    const parsedLine = q.line === undefined ? undefined : Number.parseInt(q.line, 10);
    const line = parsedLine === undefined || Number.isNaN(parsedLine) ? undefined : parsedLine;
    if ((line === undefined) === (q.fromValue === undefined)) {
      reply.code(400);
      return { error: 'an edit names a line or a value, never both and never neither' };
    }
    const run = await importRuns.get(id);
    if (!run) { reply.code(404); return { error: `import run not found: ${id}` }; }
    const key = line === undefined
      ? { header: q.header, fromValue: q.fromValue as string }
      : { header: q.header, line };
    return { removed: await importEdits.remove(run.nationalSystem, run.fileHash, key) };
  });
```

Use whatever this file already calls to name the actor. If it has no such helper, pass `createdBy: null` and note it in the task report rather than inventing one.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the server lint, which is the only real one in this repo**

Run: `pnpm --filter @openldr/server lint`
Expected: clean. This is the package that enforces the return/await `reply.send` rule.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): routes to record, read and undo a cell edit"
```

---

### Task 6: The grid client and the editable cell

**Files:**
- Modify: `apps/studio/src/api.ts` (after `readFacilityImportRows`, around line 1678)
- Modify: `apps/studio/src/facilities/DataGridStep.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx:1413-1416`
- Test: `apps/studio/src/facilities/DataGridStep.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts` (the `facilities.import` block, beside `rowsDesktopOnly` at line 961)

**Interfaces:**
- Consumes: the three routes from Task 5, and `FacilityImportRows.lines` from Task 2.
- Produces:
  ```ts
  // apps/studio/src/api.ts
  export interface FacilityImportEdit {
    header: string;
    line: number | null;
    fromValue: string | null;
    toValue: string;
  }
  export const readFacilityImportEdits: (runId: string) => Promise<FacilityImportEdit[]>;
  export const putFacilityImportEdit: (
    runId: string,
    edit: { header: string; line?: number; fromValue?: string; toValue: string },
  ) => Promise<FacilityImportEdit>;
  export const deleteFacilityImportEdit: (
    runId: string,
    key: { header: string; line?: number; fromValue?: string },
  ) => Promise<{ removed: boolean }>;
  ```
  and `DataGridStepProps` gains:
  ```ts
    /** Editing is CSV only: a JSONL release takes no overlay. False renders the grid exactly as
     *  Slice A shipped it. */
    editable?: boolean;
    /** Source header -> the controlled field it maps to, for the headers that map to one. A cell in
     *  one of these opens the this-row-versus-everywhere choice instead of writing straight away. */
    controlledHeaders?: Record<string, 'level' | 'status' | 'country'>;
  ```

- [ ] **Step 1: Write the failing grid tests**

Append to `apps/studio/src/facilities/DataGridStep.test.tsx`, extending the existing `vi.mock('@/api')` factory with the three new functions:

```ts
it('writes a cell edit keyed on the row file line, not on its position', async () => {
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['code', 'name'], rows: [['1', 'Alpha']], lines: [7],
    offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([]);
  mocked(api.putFacilityImportEdit).mockResolvedValue({
    header: 'name', line: 7, fromValue: null, toValue: 'Beta',
  });
  render(<DataGridStep runId="fir_1" editable />);
  await screen.findByText('Alpha');
  await userEvent.click(screen.getByText('Alpha'));
  const box = screen.getByRole('textbox');
  await userEvent.clear(box);
  await userEvent.type(box, 'Beta{Enter}');
  await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
    header: 'name', line: 7, toValue: 'Beta',
  }));
});

it('shows a stored edit in place of the file value', async () => {
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['code', 'name'], rows: [['1', 'Alpha']], lines: [7],
    offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([
    { header: 'name', line: 7, fromValue: null, toValue: 'Beta' },
  ]);
  render(<DataGridStep runId="fir_1" editable />);
  expect(await screen.findByText('Beta')).toBeInTheDocument();
  expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
});

it('applies a value-scoped edit to every matching cell in its own column', async () => {
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['name', 'level'], rows: [['Others', 'Others'], ['Alpha', 'Others']], lines: [2, 3],
    offset: 0, limit: 100, total: 2,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([
    { header: 'level', line: null, fromValue: 'Others', toValue: 'Health Post' },
  ]);
  render(<DataGridStep runId="fir_1" editable />);
  expect(await screen.findAllByText('Health Post')).toHaveLength(2);
  // The same string in the `name` column is untouched: an edit names one header.
  expect(screen.getByText('Others')).toBeInTheDocument();
});

it('undoes an edit and puts the file value back', async () => {
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([
    { header: 'name', line: 7, fromValue: null, toValue: 'Beta' },
  ]);
  mocked(api.deleteFacilityImportEdit).mockResolvedValue({ removed: true });
  render(<DataGridStep runId="fir_1" editable />);
  await screen.findByText('Beta');
  await userEvent.click(screen.getByRole('button', { name: /undo this change/i }));
  await waitFor(() => expect(api.deleteFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
    header: 'name', line: 7,
  }));
  expect(await screen.findByText('Alpha')).toBeInTheDocument();
});

it('does not offer editing when the run is not editable', async () => {
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
  });
  render(<DataGridStep runId="fir_1" />);
  await screen.findByText('Alpha');
  await userEvent.click(screen.getByText('Alpha'));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(api.readFacilityImportEdits).not.toHaveBeenCalled();
});

it('escape leaves the cell as it was', async () => {
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([]);
  render(<DataGridStep runId="fir_1" editable />);
  await screen.findByText('Alpha');
  await userEvent.click(screen.getByText('Alpha'));
  await userEvent.type(screen.getByRole('textbox'), 'Beta{Escape}');
  expect(api.putFacilityImportEdit).not.toHaveBeenCalled();
  expect(await screen.findByText('Alpha')).toBeInTheDocument();
});
```

Update every existing mock in this file to include `lines`, since Task 2 made it a required field.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/DataGridStep.test.tsx`
Expected: FAIL, `editable` is not a prop and the api functions do not exist.

- [ ] **Step 3: Write the api client**

In `apps/studio/src/api.ts`, after `readFacilityImportRows`:

```ts
/** One operator repair on the Data grid, as `GET /api/facilities/import/runs/:id/edits` returns it.
 *  Either `line` is set (one cell) or `fromValue` is set (every cell in that column holding that
 *  value), never both and never neither. */
export interface FacilityImportEdit {
  header: string;
  line: number | null;
  fromValue: string | null;
  toValue: string;
}

/** Every repair recorded against this run's FILE, which is not the same as against this run: the
 *  server keys them on `(nationalSystem, fileHash)`, so a re-upload of the same bytes still sees
 *  them. That is the whole reason this list can be non-empty on a run just created. */
export const readFacilityImportEdits = (runId: string): Promise<FacilityImportEdit[]> =>
  authFetch(`/api/facilities/import/runs/${encodeURIComponent(runId)}/edits`)
    .then((r) => okJson<{ edits: FacilityImportEdit[] }>(r, 'read import edits'))
    .then((j) => j.edits);

/** Records or replaces one repair. Pass `line` for one cell, `fromValue` for every cell in that
 *  column holding that value. Passing both, or neither, is a 400. */
export const putFacilityImportEdit = (
  runId: string,
  edit: { header: string; line?: number; fromValue?: string; toValue: string },
): Promise<FacilityImportEdit> =>
  authFetch(`/api/facilities/import/runs/${encodeURIComponent(runId)}/edits`, jbody(edit, 'PUT'))
    .then((r) => okJson<FacilityImportEdit>(r, 'write import edit'));

/** The undo. `removed: false` means there was nothing there, which is not an error. */
export const deleteFacilityImportEdit = (
  runId: string,
  key: { header: string; line?: number; fromValue?: string },
): Promise<{ removed: boolean }> => {
  const q = new URLSearchParams({ header: key.header });
  if (key.line !== undefined) q.set('line', String(key.line));
  if (key.fromValue !== undefined) q.set('fromValue', key.fromValue);
  return authFetch(
    `/api/facilities/import/runs/${encodeURIComponent(runId)}/edits?${q.toString()}`,
    { method: 'DELETE' },
  ).then((r) => okJson<{ removed: boolean }>(r, 'undo import edit'));
};
```

- [ ] **Step 4: Make the grid editable**

In `apps/studio/src/facilities/DataGridStep.tsx`:

Add the props described in Interfaces above, plus this state and loader:

```ts
  const [edits, setEdits] = useState<FacilityImportEdit[]>([]);
  /** Which cell is open for typing. `null` when none is. */
  const [editing, setEditing] = useState<{ line: number; header: string } | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    // Not fetched at all when editing is off: a read-only grid has nothing to overlay, and this
    // route takes `facilities.manage` like the rows route does.
    if (!editable || narrow) return undefined;
    let cancelled = false;
    readFacilityImportEdits(runId)
      .then((res) => { if (!cancelled) setEdits(res); })
      // Deliberately silent. A failure here costs the operator the overlay, not the file: the grid
      // still shows what was uploaded, which is the truthful fallback. The write path reports its
      // own failures, where the operator is actually waiting on an answer.
      .catch(() => { if (!cancelled) setEdits([]); });
    return () => { cancelled = true; };
  }, [runId, editable, narrow]);
```

Resolve each cell through the overlay. This mirrors, exactly, the precedence the parser applies in Task 3, and the two must never disagree: the grid is the operator's evidence for what the import will do.

```ts
  /** What one cell reads after the overlay, and whether an edit put it there.
   *
   *  ⛔ THE SAME PRECEDENCE THE PARSER USES (facility-csv.ts's row loop): a line-scoped edit wins
   *  over a value-scoped one. If these two ever disagree, the grid is lying about the import. */
  function cellOf(line: number, header: string, fileValue: string): {
    value: string; edit: FacilityImportEdit | null;
  } {
    const byLine = edits.find((e) => e.line === line && e.header === header);
    if (byLine) return { value: byLine.toValue, edit: byLine };
    const byValue = edits.find((e) => e.line === null && e.header === header && e.fromValue === fileValue);
    if (byValue) return { value: byValue.toValue, edit: byValue };
    return { value: fileValue, edit: null };
  }
```

Replace the `TableCell` render with a cell that opens an `Input` on click and commits on Enter or blur:

```tsx
              {data.headers.map((h, c) => {
                const line = data.lines[i];
                const fileValue = row[c] ?? '';
                const { value, edit } = cellOf(line, h, fileValue);
                const open = editing?.line === line && editing.header === h;
                if (open) {
                  return (
                    <TableCell key={c} className="p-1">
                      <Input
                        autoFocus
                        aria-label={t('facilities.import.editCellLabel', { header: h, line })}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { void commit(line, h, fileValue); }
                          // Escape cancels. Without it the only way out of a mistyped cell is to
                          // commit it and then undo, which is two writes to change nothing.
                          if (e.key === 'Escape') { setEditing(null); }
                        }}
                        onBlur={() => { void commit(line, h, fileValue); }}
                      />
                    </TableCell>
                  );
                }
                return (
                  <TableCell
                    key={c}
                    // The marker for an edited cell. A left rule, not a background: a background
                    // over a 21-column grid reads as a selection, and every third cell edited would
                    // make the table unreadable.
                    className={edit ? 'border-l-2 border-l-amber-500' : undefined}
                    onClick={editable ? () => { setEditing({ line, header: h }); setDraft(value); } : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {value}
                      {edit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          aria-label={t('facilities.import.editUndo')}
                          onClick={(e) => { e.stopPropagation(); void undo(edit); }}
                        >
                          <Undo2 className="h-3 w-3" />
                        </Button>
                      )}
                    </span>
                  </TableCell>
                );
              })}
```

with these two handlers:

```ts
  async function commit(line: number, header: string, fileValue: string): Promise<void> {
    setEditing(null);
    const { value: current } = cellOf(line, header, fileValue);
    // Nothing typed, or typed back to what it already read. No write: an edit row that changes
    // nothing still marks the cell as edited, which would tell the operator they changed something.
    if (draft === current) return;
    // Back to what the FILE says, with an edit standing. That is an undo, not a new edit.
    const standing = edits.find((e) => e.line === line && e.header === header);
    if (draft === fileValue && standing) { await undo(standing); return; }
    // The choice dialog (Task 7) intercepts a controlled-field column before this runs.
    try {
      const saved = await putFacilityImportEdit(runId, { header, line, toValue: draft });
      setEdits((prev) => [...prev.filter((e) => !(e.line === line && e.header === header)), saved]);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
  }

  async function undo(edit: FacilityImportEdit): Promise<void> {
    try {
      await deleteFacilityImportEdit(runId, edit.line === null
        ? { header: edit.header, fromValue: edit.fromValue as string }
        : { header: edit.header, line: edit.line });
      setEdits((prev) => prev.filter((e) => e !== edit));
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
  }
```

Import `Input` from `@/components/ui/input`, `Button` from `@/components/ui/button`, `Undo2` from `lucide-react`, and the three api functions plus `FacilityImportEdit` from `@/api`.

Update the component's docblock: the "READ ONLY, and that is not a placeholder for a later slice" paragraph is now wrong. Replace it with what is true, keeping the desktop-only paragraph exactly as it is.

- [ ] **Step 5: Pass the props from the sheet**

In `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` at the `step === 2` block:

```tsx
            <DataGridStep
              runId={runId}
              // CSV only. A JSONL release is the publisher's file in the contract's own shape, and
              // the parser takes no overlay for one (see `FacilityImportOptions.cellEdits`).
              editable={format === 'csv'}
              controlledHeaders={controlledHeaders}
            />
```

with, near the other derived values:

```ts
  /** Source header -> the controlled field it maps to, for the headers that map to one. Empty
   *  until the operator has mapped something, which is the ordinary state on a first pass through
   *  Data. A cell in one of these opens the this-row-versus-everywhere choice. */
  const controlledHeaders = useMemo(() => {
    const out: Record<string, ControlledField> = {};
    for (const [header, target] of Object.entries(columnMap?.columns ?? {})) {
      if ((CONTROLLED_FIELDS as string[]).includes(target)) out[header] = target as ControlledField;
    }
    return out;
  }, [columnMap]);
```

- [ ] **Step 6: Add the English copy**

In `apps/studio/src/i18n/en.ts`, in the `facilities.import` block beside `rowsDesktopOnly`:

```ts
      editCellLabel: 'Edit {{header}} on line {{line}}',
      editUndo: 'Undo this change',
      editFailed: 'This change could not be saved.',
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/DataGridStep.test.tsx src/facilities/ImportFacilitiesSheet.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src
git commit -m "feat(facilities): the data grid edits a cell, marks it, and undoes it"
```

---

### Task 7: The this-row versus everywhere choice

**Files:**
- Create: `apps/studio/src/facilities/CellEditChoiceDialog.tsx`
- Create: `apps/studio/src/facilities/CellEditChoiceDialog.test.tsx`
- Modify: `apps/studio/src/facilities/DataGridStep.tsx` (`commit`)
- Modify: `apps/studio/src/facilities/DataGridStep.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`

**Interfaces:**
- Consumes: `putFacilityImportEdit` from Task 6, `controlledHeaders` from Task 6.
- Produces:
  ```ts
  export interface CellEditChoiceDialogProps {
    open: boolean;
    header: string;
    /** What the cell reads in the file, before this change. The value a sweep would match on. */
    fromValue: string;
    /** What the operator typed. */
    toValue: string;
    onOpenChange: (open: boolean) => void;
    /** `'row'` writes a line-scoped edit; `'everywhere'` writes a value-scoped one. */
    onChoose: (scope: 'row' | 'everywhere') => void;
  }
  export function CellEditChoiceDialog(props: CellEditChoiceDialogProps): JSX.Element;
  ```

**Why only a controlled-field column asks.** On an ordinary column a value repeats by coincidence: two facilities named the same thing are two facilities. On a controlled-field column a value repeats because it is a category, so one repair almost always means every row carrying it. Asking on every column would put a dialog between the operator and 3 788 typos.

**Why an empty `fromValue` never sweeps.** A blank cell is not a category, and a sweep over every blank cell in a column would fill in data the file never carried. The dialog is skipped and a line edit is written.

- [ ] **Step 1: Write the failing dialog tests**

Create `apps/studio/src/facilities/CellEditChoiceDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellEditChoiceDialog } from './CellEditChoiceDialog';

const base = {
  open: true, header: 'Type', fromValue: 'Others', toValue: 'Health Post',
  onOpenChange: () => {},
};

describe('CellEditChoiceDialog', () => {
  it('names the column, the old value and the new one', () => {
    render(<CellEditChoiceDialog {...base} onChoose={() => {}} />);
    expect(screen.getByText(/Others/)).toBeInTheDocument();
    expect(screen.getByText(/Health Post/)).toBeInTheDocument();
    expect(screen.getByText(/Type/)).toBeInTheDocument();
  });

  it('reports the row choice', async () => {
    const onChoose = vi.fn();
    render(<CellEditChoiceDialog {...base} onChoose={onChoose} />);
    await userEvent.click(screen.getByRole('button', { name: /just this row/i }));
    expect(onChoose).toHaveBeenCalledWith('row');
  });

  it('reports the everywhere choice', async () => {
    const onChoose = vi.fn();
    render(<CellEditChoiceDialog {...base} onChoose={onChoose} />);
    await userEvent.click(screen.getByRole('button', { name: /every row/i }));
    expect(onChoose).toHaveBeenCalledWith('everywhere');
  });
});
```

And add to `apps/studio/src/facilities/DataGridStep.test.tsx`:

```tsx
it('asks before changing a controlled-field cell, then sweeps the value', async () => {
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['Type'], rows: [['Others']], lines: [2], offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([]);
  mocked(api.putFacilityImportEdit).mockResolvedValue({
    header: 'Type', line: null, fromValue: 'Others', toValue: 'Health Post',
  });
  render(<DataGridStep runId="fir_1" editable controlledHeaders={{ Type: 'level' }} />);
  await screen.findByText('Others');
  await userEvent.click(screen.getByText('Others'));
  const box = screen.getByRole('textbox');
  await userEvent.clear(box);
  await userEvent.type(box, 'Health Post{Enter}');
  // Nothing is written until the operator has answered.
  expect(api.putFacilityImportEdit).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole('button', { name: /every row/i }));
  await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
    header: 'Type', fromValue: 'Others', toValue: 'Health Post',
  }));
});

it('writes only the row when the operator says just this row', async () => {
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['Type'], rows: [['Others']], lines: [2], offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([]);
  mocked(api.putFacilityImportEdit).mockResolvedValue({
    header: 'Type', line: 2, fromValue: null, toValue: 'Health Post',
  });
  render(<DataGridStep runId="fir_1" editable controlledHeaders={{ Type: 'level' }} />);
  await screen.findByText('Others');
  await userEvent.click(screen.getByText('Others'));
  const box = screen.getByRole('textbox');
  await userEvent.clear(box);
  await userEvent.type(box, 'Health Post{Enter}');
  await userEvent.click(await screen.findByRole('button', { name: /just this row/i }));
  await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
    header: 'Type', line: 2, toValue: 'Health Post',
  }));
});

it('does not ask on an ordinary column', async () => {
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['name'], rows: [['Alpha']], lines: [2], offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([]);
  mocked(api.putFacilityImportEdit).mockResolvedValue({
    header: 'name', line: 2, fromValue: null, toValue: 'Beta',
  });
  render(<DataGridStep runId="fir_1" editable controlledHeaders={{ Type: 'level' }} />);
  await screen.findByText('Alpha');
  await userEvent.click(screen.getByText('Alpha'));
  const box = screen.getByRole('textbox');
  await userEvent.clear(box);
  await userEvent.type(box, 'Beta{Enter}');
  await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: /every row/i })).not.toBeInTheDocument();
});

it('does not ask on a controlled column whose cell is blank', async () => {
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['Type'], rows: [['']], lines: [2], offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([]);
  mocked(api.putFacilityImportEdit).mockResolvedValue({
    header: 'Type', line: 2, fromValue: null, toValue: 'Health Post',
  });
  render(<DataGridStep runId="fir_1" editable controlledHeaders={{ Type: 'level' }} />);
  await screen.findAllByRole('row');
  await userEvent.click(screen.getAllByRole('cell')[0]);
  await userEvent.type(screen.getByRole('textbox'), 'Health Post{Enter}');
  await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
    header: 'Type', line: 2, toValue: 'Health Post',
  }));
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/CellEditChoiceDialog.test.tsx src/facilities/DataGridStep.test.tsx`
Expected: FAIL, the module does not exist and the grid writes without asking.

- [ ] **Step 3: Write the dialog**

Create `apps/studio/src/facilities/CellEditChoiceDialog.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export interface CellEditChoiceDialogProps {
  open: boolean;
  header: string;
  /** What the cell reads in the file. The value a sweep matches on. */
  fromValue: string;
  /** What the operator typed. */
  toValue: string;
  onOpenChange: (open: boolean) => void;
  onChoose: (scope: 'row' | 'everywhere') => void;
}

/** The choice decision 2 of the design calls for: change this one row, or change every row in this
 *  column that reads the same thing.
 *
 *  ⛔ ASKED ONLY ON A CONTROLLED-FIELD COLUMN, and the caller decides that, not this dialog. On an
 *  ordinary column a value repeats by coincidence: two facilities named the same thing are two
 *  facilities, and asking there would put a dialog between the operator and 3 788 typos. On a
 *  controlled-field column a value repeats because it is a CATEGORY, so one repair almost always
 *  means all of them.
 *
 *  ⛔ TWO BUTTONS, NOT A ⋯ MENU. AGENTS.md section 5 sends ACTIONS to a dots menu. This is not a
 *  set of actions on an object; it is one question with two answers, and a menu would hide half
 *  the question behind a click. Same shape as any confirm dialog in this app. */
export function CellEditChoiceDialog({
  open, header, fromValue, toValue, onOpenChange, onChoose,
}: CellEditChoiceDialogProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t('facilities.import.editScopeTitle')}</DialogTitle>
        <DialogDescription>
          {t('facilities.import.editScopeBody', { header, from: fromValue, to: toValue })}
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="outline" onClick={() => onChoose('row')}>
            {t('facilities.import.editScopeRow')}
          </Button>
          <Button onClick={() => onChoose('everywhere')}>
            {t('facilities.import.editScopeEverywhere', { from: fromValue })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CellEditChoiceDialog;
```

- [ ] **Step 4: Route the commit through the dialog**

In `DataGridStep.tsx`, add:

```ts
  /** A typed change waiting on the this-row-versus-everywhere answer. `null` when nothing waits. */
  const [pending, setPending] = useState<
    { line: number; header: string; fromValue: string; toValue: string } | null
  >(null);
```

and, in `commit`, before the `putFacilityImportEdit` call:

```ts
    // A controlled-field column with a non-blank value asks first. A blank cell never sweeps: a
    // blank is not a category, and filling in every blank in a column writes data the file never
    // carried.
    if (controlledHeaders?.[header] && fileValue !== '') {
      setPending({ line, header, fromValue: fileValue, toValue: draft });
      return;
    }
```

Render the dialog beside the table:

```tsx
      {pending && (
        <CellEditChoiceDialog
          open
          header={pending.header}
          fromValue={pending.fromValue}
          toValue={pending.toValue}
          onOpenChange={(o) => { if (!o) setPending(null); }}
          onChoose={(scope) => { void resolvePending(scope); }}
        />
      )}
```

with:

```ts
  async function resolvePending(scope: 'row' | 'everywhere'): Promise<void> {
    if (!pending) return;
    const { line, header, fromValue, toValue } = pending;
    setPending(null);
    try {
      const saved = await putFacilityImportEdit(runId, scope === 'row'
        ? { header, line, toValue }
        : { header, fromValue, toValue });
      setEdits((prev) => [
        // A sweep supersedes any line edit on the same cell only in what the SERVER stores; here
        // the line edit is dropped from the local list for the same reason, so the grid keeps
        // agreeing with the parser's precedence.
        ...prev.filter((e) => !(e.line === line && e.header === header)
          && !(e.line === null && e.header === header && e.fromValue === fromValue)),
        saved,
      ]);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
  }
```

- [ ] **Step 5: Add the English copy**

In `apps/studio/src/i18n/en.ts`, beside the Task 6 keys:

```ts
      editScopeTitle: 'Change this value where?',
      editScopeBody: 'The {{header}} column reads "{{from}}" here. You changed it to "{{to}}".',
      editScopeRow: 'Just this row',
      editScopeEverywhere: 'Every row that reads "{{from}}"',
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src
git commit -m "feat(facilities): a repaired category value can change one row or every matching row"
```

---

### Task 8: An edit makes the check and the summary stale

**Files:**
- Modify: `apps/studio/src/facilities/importInputsSignature.ts:20-57`
- Modify: `apps/studio/src/facilities/mappingCheckState.ts:22-28` (`RowCheck`)
- Modify: `apps/studio/src/facilities/ColumnMapStep.tsx:645` (the `stale` comparison) and wherever it writes a `RowCheck`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx:1022-1033` (`inputs`) and the `step === 2` block
- Modify: `apps/studio/src/facilities/DataGridStep.tsx`
- Test: `apps/studio/src/facilities/importInputsSignature.test.ts`, `apps/studio/src/facilities/DataGridStep.test.tsx`

**Why this task exists, and it is the one thing the spec does not spell out.** A validated summary is a claim about a file. After Task 6, an edit changes what that file parses to, and nothing today tells Review. Without this, an operator repairs 40 coordinates, Review still reports the pre-repair numbers, and the confirm gate authorises a record set that was never reviewed. That is the exact failure the spec's own "Splitting the store from the validate" section exists to prevent, arriving through a new door.

**Interfaces:**
- Consumes: the grid's write path from Task 6 and Task 7.
- Produces:
  - `ImportInputs` gains `cellEditsAt: number`.
  - `RowCheck` gains `editsAt: number`.
  - `DataGridStepProps` gains `onEditsChanged?: () => void`.

**The one thing this deliberately does NOT invalidate: the value worklist.** `worklistSignature` stays as it is. Its own docblock says saving a mapping must not empty a list the operator is halfway through fixing, and an edit is the same case: throwing the worklist away would drop every unsaved pick. A stale entry stays listed, the row goes stale, and the re-check the stale icon invites re-reads the column and drops it. The cost of getting this wrong is one listed value that no longer appears in the file, which the next check removes.

- [ ] **Step 1: Write the failing signature test**

Append to `apps/studio/src/facilities/importInputsSignature.test.ts`:

```ts
it('a cell edit changes the summary signature', () => {
  const base = makeInputs();
  expect(summarySignature({ ...base, cellEditsAt: 1 }))
    .not.toBe(summarySignature({ ...base, cellEditsAt: 2 }));
});

it('a cell edit does NOT change the worklist signature', () => {
  const base = makeInputs();
  expect(worklistSignature({ ...base, cellEditsAt: 1 }))
    .toBe(worklistSignature({ ...base, cellEditsAt: 2 }));
});
```

Use whatever this file already builds its fixture inputs with; if there is no `makeInputs` helper, add one rather than repeating the object.

And append to `apps/studio/src/facilities/DataGridStep.test.tsx`:

```tsx
it('reports every successful edit write so the sheet can invalidate its summary', async () => {
  const onEditsChanged = vi.fn();
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([]);
  mocked(api.putFacilityImportEdit).mockResolvedValue({
    header: 'name', line: 7, fromValue: null, toValue: 'Beta',
  });
  render(<DataGridStep runId="fir_1" editable onEditsChanged={onEditsChanged} />);
  await screen.findByText('Alpha');
  await userEvent.click(screen.getByText('Alpha'));
  const box = screen.getByRole('textbox');
  await userEvent.clear(box);
  await userEvent.type(box, 'Beta{Enter}');
  await waitFor(() => expect(onEditsChanged).toHaveBeenCalledTimes(1));
});

it('reports an undo as well, since it changes the file just as much', async () => {
  const onEditsChanged = vi.fn();
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([
    { header: 'name', line: 7, fromValue: null, toValue: 'Beta' },
  ]);
  mocked(api.deleteFacilityImportEdit).mockResolvedValue({ removed: true });
  render(<DataGridStep runId="fir_1" editable onEditsChanged={onEditsChanged} />);
  await screen.findByText('Beta');
  await userEvent.click(screen.getByRole('button', { name: /undo this change/i }));
  await waitFor(() => expect(onEditsChanged).toHaveBeenCalledTimes(1));
});

it('does not report a keystroke that changed nothing', async () => {
  const onEditsChanged = vi.fn();
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
  });
  mocked(api.readFacilityImportEdits).mockResolvedValue([]);
  render(<DataGridStep runId="fir_1" editable onEditsChanged={onEditsChanged} />);
  await screen.findByText('Alpha');
  await userEvent.click(screen.getByText('Alpha'));
  await userEvent.type(screen.getByRole('textbox'), '{Enter}');
  expect(api.putFacilityImportEdit).not.toHaveBeenCalled();
  expect(onEditsChanged).not.toHaveBeenCalled();
});
```

The first two tests go in `DataGridStep.test.tsx`, not in the sheet's file. The sheet's own half is covered by the signature tests above: `cellEditsAt` feeds `summarySignature`, and `hasReview` already requires `summaryAt === currentSummarySignature`, which is the mechanism that pulls the operator back to Mapping.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/importInputsSignature.test.ts`
Expected: FAIL, `cellEditsAt` is not part of `ImportInputs`.

- [ ] **Step 3: Add the field to the signature**

In `apps/studio/src/facilities/importInputsSignature.ts`, add to `ImportInputs`:

```ts
  /** Bumped every time the Data grid writes or undoes a cell edit (Slice C). In
   *  `summarySignature` but NOT in `worklistSignature`: an edit changes what the file parses to, so
   *  a validated summary computed before it is no longer a claim about this file. The worklist is
   *  left alone deliberately, for the reason `worklistSignature`'s own note gives about a save. */
  cellEditsAt: number;
```

and add `i.cellEditsAt,` to the `summarySignature` array. Leave `worklistSignature` untouched.

- [ ] **Step 4: Thread it through the sheet and the grid**

In `ImportFacilitiesSheet.tsx`:

```ts
  /** Bumped by the Data grid on every successful edit write or undo. Feeds `summarySignature`, so a
   *  validated summary computed before the edit stops matching and Review falls away, and feeds
   *  every row's `stale`, so the mapping step invites the re-check that would answer differently. */
  const [cellEditsAt, setCellEditsAt] = useState(0);
```

Add `cellEditsAt,` to the `inputs` object, and pass `onEditsChanged={() => setCellEditsAt((n) => n + 1)}` to `DataGridStep`. Reset it to 0 in the same place `checkState.reset()` is called on a file or register change (line 546).

In `DataGridStep.tsx`, add the prop and call it at the end of every successful `commit`, `resolvePending` and `undo`.

- [ ] **Step 5: Make a checked row go stale**

In `mappingCheckState.ts`, add to `RowCheck`:

```ts
  /** The `cellEditsAt` this check ran at. A later value means the file has changed underneath the
   *  answer, which is exactly what `stale` is for. */
  editsAt: number;
```

In `ColumnMapStep.tsx`, take `cellEditsAt` as a prop (defaulting to 0 so the panel still works standalone), stamp it onto every `RowCheck` it writes, and widen the comparison at line 645:

```ts
          // A row goes stale when its TARGET moved, or when a cell edit changed what the column
          // holds. Both mean the last answer describes something that is no longer being imported.
          const stale = !!check && (check.target !== selected || check.editsAt !== cellEditsAt);
```

Pass `cellEditsAt={cellEditsAt}` from the sheet's `<ColumnMapStep .../>` at line 1694.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src
git commit -m "fix(facilities): a cell edit makes the check and the review summary stale"
```

---

### Task 9: Translations and documentation

**Files:**
- Modify: `apps/studio/src/i18n/fr.ts`, `apps/studio/src/i18n/pt.ts`
- Modify: `apps/studio/src/docs/0.1.0/en/facilities.md`, `.../fr/facilities.md`, `.../pt/facilities.md`
- Modify: `apps/web/src/docs/0.1.0/facilities.md`
- Modify: `docs/superpowers/specs/2026-09-08-facility-import-data-stage-design.md` (the Status line and the Slices section)

**Why this is a task and not a footnote.** A missing i18n key renders as literal braces, and the operator sees it. `apps/studio/src/i18n/parity.test.ts` is what catches a partial translation; it must be green before this task is done.

- [ ] **Step 1: Run the parity test and watch it fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/i18n/parity.test.ts`
Expected: FAIL, naming the seven keys Tasks 6 and 7 added to `en.ts` and not to `fr.ts` or `pt.ts`.

- [ ] **Step 2: Add the French copy**

In `apps/studio/src/i18n/fr.ts`, in the `facilities.import` block at the same position as in `en.ts`:

```ts
      editCellLabel: 'Modifier {{header}} à la ligne {{line}}',
      editUndo: 'Annuler cette modification',
      editFailed: 'Cette modification n’a pas pu être enregistrée.',
      editScopeTitle: 'Où appliquer cette valeur ?',
      editScopeBody: 'La colonne {{header}} contient « {{from}} » ici. Vous l’avez remplacée par « {{to}} ».',
      editScopeRow: 'Cette ligne seulement',
      editScopeEverywhere: 'Toutes les lignes contenant « {{from}} »',
```

- [ ] **Step 3: Add the Portuguese copy**

In `apps/studio/src/i18n/pt.ts`, same position:

```ts
      editCellLabel: 'Editar {{header}} na linha {{line}}',
      editUndo: 'Anular esta alteração',
      editFailed: 'Não foi possível guardar esta alteração.',
      editScopeTitle: 'Onde aplicar este valor?',
      editScopeBody: 'A coluna {{header}} contém "{{from}}" aqui. Alterou para "{{to}}".',
      editScopeRow: 'Apenas esta linha',
      editScopeEverywhere: 'Todas as linhas que contêm "{{from}}"',
```

- [ ] **Step 4: Run the parity test and watch it pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/i18n`
Expected: PASS.

- [ ] **Step 5: Write the in-app documentation**

In `apps/studio/src/docs/0.1.0/en/facilities.md`, under "The four steps of the import wizard", add a section after the Mapping material. Write it in the operator's register: short sentences, plain nouns, no em dashes, no emoji.

```markdown
### Repairing a cell on the Data step

The Data step shows your file as a table. Click a cell to change what it says.

Your changes are not written back to the file you uploaded. They are recorded against
the file itself, so uploading the same file again keeps every repair you made. Change the
file and the repairs stop applying, because the line numbers they name no longer mean
anything.

A repaired cell gets an amber rule down its left edge and an undo button. Undo puts the
file's own value back.

Repairing a cell in a column you mapped to Level, Status or Country asks one question:
change this row, or change every row that reads the same thing. Categories usually repeat,
so a value you correct once is usually wrong everywhere it appears.

Two things a repair cannot do. It cannot rescue a row whose column count does not match the
header: that row is set aside before any cell exists, so fix it in the CSV. And it cannot add
or remove a row. A row that should not be imported is a row to remove from the CSV.

Repairing a cell makes your last check stale. Check the column again, then validate, before
you go on to Review.
```

Translate the same section into `fr/facilities.md` and `pt/facilities.md`, at the same position.

- [ ] **Step 6: Write the web documentation**

In `apps/web/src/docs/0.1.0/facilities.md`, add the same material under "The import wizard's four steps", trimmed to that page's shorter register.

- [ ] **Step 7: Update the spec**

In `docs/superpowers/specs/2026-09-08-facility-import-data-stage-design.md`:

- Change the Status line to say Slice C is built.
- In the Slices section, under Slice C, record the four rulings from this plan's "Rulings taken before this plan was written" section, so a later reader finds them where they will look.

- [ ] **Step 8: Run the docs validation**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs`
Expected: PASS. This catches a doc file the registry does not know about and a heading structure it cannot render.

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/i18n apps/studio/src/docs apps/web/src/docs docs/superpowers/specs
git commit -m "docs(facilities): cell edits in three languages, and the spec records slice C"
```

---

## Verification, and its limits

Run before calling this done, in this order.

**1. The full gate.**

```bash
pnpm turbo run test --concurrency=2 --force > /tmp/slice-c-gate.txt 2>&1; tail -n 40 /tmp/slice-c-gate.txt
```

`--force` because a cached green run proves nothing, and it once hid a real 500 for a whole day. Never pipe turbo itself through `tail`: redirect first, then read the file. A failure is more often a timeout than a regression, so grep the output for `Test timed out` and re-run that package alone before blaming a change.

**2. The server lint,** which is the only real lint in this repo.

```bash
pnpm --filter @openldr/server lint
```

**3. A live check against the real export, in the running stack.** The operator is running the stack with `AUTH_DEV_BYPASS=true`. Do not restart it.

Upload the Zambia MFL export, edit one `Type` cell, choose "every row", validate, and confirm that:
- the validated summary changes to match the repair,
- re-uploading the same file shows the repair still in place,
- the confirm applies the repaired value to the registry.

Report the numbers you actually saw. Nothing in this plan's test suite measures any of the three.

**4. Migration order on a real boot.** pg-mem cannot catch a numbering gap, and the failure only appears on a real Postgres boot. Boot the stack once against a real database after Task 1 and say that it booted.

**Three limits to state in the task reports rather than find again.**

pg-mem is not Postgres. It cannot parse `COLLATE`, its scan order is stable, and it will never show an `ORDER BY` tie behaving non-deterministically. The store's `orderBy('created_at').orderBy('id')` tiebreaker is therefore untested by anything offline.

No test here measures a grid over 3 788 rows with an overlay resolved per cell. `cellOf` is a linear scan of the edits list per cell, which is fine for tens of edits and is not fine for thousands. If the live check shows a slow grid, index the edits by header before rendering rather than leaving it. Say what you measured or say nothing.

The Data grid is desktop only, by the spec's own recorded exception. The mobile pass in AGENTS.md section 6 applies to steps 1, 3 and 4, which this slice does not touch. Headless Chromium cannot see the `vh`-versus-`dvh` class of bug, so if anything bottom-anchored moves, say only a real phone can confirm it.

## Self-review

Checked against the spec after writing.

**Spec coverage.** Decision 1 (edits are imported) is Tasks 3 and 4. Decision 2 (the controlled-field choice) is Task 7. Decision 4 (keyed on register and file) is Task 1. Decision 6 (every column, edits name a source header) is Task 1's `header` column and Task 3's overlay. Decision 7 (undo) is Task 1's `remove`, Task 5's DELETE and Task 6's undo button. The spec's "edits table and its migration, the map-everywhere versus this-row choice, and apply and re-validate reading the file through the edit overlay" is Tasks 1, 7 and 4 respectively. The one boundary (a field-count quarantine cannot be rescued) is asserted in Task 3.

**Two things the spec did not name and this plan adds.** Task 2 exists because an edit is keyed on a line number the paged read did not carry, and computing one from `offset` is wrong for a quoted newline. Task 8 exists because an edit after a validate would otherwise leave Review reporting a file that no longer parses that way, which is the same failure the spec's "Splitting the store from the validate" section was written to prevent.

**Out of scope, as the spec says.** No row insert or delete, no column add, no sorting or filtering beyond what Slice A shipped. No CLI parity and no mobile view for the grid, both recorded in the spec as deliberate exceptions to AGENTS.md section 6 and both already accepted by the operator.

**Not covered here, and still open from earlier slices.** Finding I1: a value resolved by an existing `term_mappings` row is re-listed as unrecognised. The two parked Slice B minors: a deprecated concept surfacing a raw primary-key violation as a 400, and `suggest-values` ungated by the register lookup. None of them is made worse by this slice.

**After the merge, not before.** Run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json`. The generator reads git history, so it cannot see commits that are not there yet.
