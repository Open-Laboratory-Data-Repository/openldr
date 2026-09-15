# Test catalog S3: import and export, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** An operator can import a national test list from a CSV or XLSX file, and export the catalog as CSV, from the Test catalog page and from `openldr test-catalog import | export`. Every write from one import lands in one transaction.

**Architecture:** A generic first-sheet reader in `@openldr/bootstrap` turns CSV or XLSX bytes into a table. Pure helpers suggest a column map and read rows. The S1 service gains `importPreview`, `importApply` and `exportCsv`. They share one set of rules with `create` and `update`, because `validate` becomes a pure `checkTest` over a context loaded once. `apps/server` serves four routes. The studio adds a four-step import sheet (file, columns, values, review). `@openldr/db`'s `saveExclusive` and `update` accept the caller's transaction, so LOINC links join the import's transaction.

**Tech Stack:** TypeScript, Kysely, SheetJS (`xlsx`), `csv-parse`, Fastify, zod, commander, React with Radix and shadcn, vitest (pg-mem for services, jsdom for the studio).

**Spec:** `docs/superpowers/specs/2026-09-15-test-catalog-design.md`, sections 4.4, 4.6 and 5 (S3). The S1 and S2 plans (`...-s1-catalog-data.md`, `...-s2-catalog-page.md`) hold the decisions this slice builds on.

## Global Constraints

- Work in a git worktree under `.claude/worktrees/`, never the main checkout. Leave `peaceful-kirch-839cb2` and `confident-lumiere-666963` alone.
- Stage by exact path. Never `git add <dir>`. No `Co-Authored-By` trailer.
- Commit only as these steps say. Merge or push only when the operator asks.
- New writing follows the `unslop` skill, code comments and UI copy included: no em dashes, no emoji in headings or bullets.
- Run one test file from its package: `cd <package> && npx vitest run <path> --testTimeout 30000`. `pnpm --filter <pkg> test -- <path>` does not filter.
- Typecheck one package: `cd <package> && npx tsc --noEmit -p . > "$TEMP/<name>.txt" 2>&1; echo "exit=$?"`. Never read `$?` through a pipe.
- The gate is `pnpm turbo run typecheck --force --concurrency=4` and `pnpm turbo run test --force --concurrency=4 --continue`, each redirected to a file. Never pipe turbo through `tail`. A failure is usually a timeout: grep for `Test timed out` and re-run that package alone.
- **No migration in S3.**
- **No clinical vocabulary in code** (AGENTS.md section 8). Categories and specimens come from the options ValueSets. Header synonyms in the column suggester are spreadsheet column names, not vocabulary.
- **Every studio string goes in `testCatalog` in `en.ts`, `fr.ts` and `pt.ts` together.** Page tests assert the English text, because the parity test cannot see a key no locale defines.
- **pg-mem does not roll back on a thrown error** (`packages/db/src/terminology-admin-store.test.ts:939`). No pg-mem test can prove the import is all-or-nothing. Tests prove the narrower fact that no second transaction is opened. Rollback on Postgres is HONEST NON-PROOF.
- **The Browser pane serves the main checkout**, so the live UI check runs after the merge. The studio is at `http://localhost:5173/studio/test-catalog`.

---

## Settled before S3 (operator, 2026-09-15)

1. **S3 adds its own small XLSX reader** in `@openldr/bootstrap`, generic over any table, that handles the SheetJS General-format trap. The facility reader, `packages/bootstrap/src/facility-xlsx.ts`, landed on `main` while this plan was written (`845468fc`). It turns a workbook into CSV for the facility import and stays as it is. Moving it onto the generic reader is not part of S3.
2. **LOINC's single-match specimen rule is dropped**, as S2 dropped suggestions. A row with no specimens imports with none.
3. **The wizard's Next, Back, Apply and Close live in the sheet's ⋯ menu.** No new AGENTS.md section 5 exception.
4. **A mapped column is authoritative: an empty cell clears the field** on an existing test. An unmapped column is left alone.

## Where this plan departs from the spec

| Spec says | Plan does | Why |
|---|---|---|
| XLSX "through the `xlsx` package already in `@openldr/bootstrap`" (4.4) | A new generic reader, `readTableFile`, that writes General-format numbers as their stored value | Decision 1. SheetJS's default text turns a 15-digit code into `1.23457E+14` (memory `facility-import-xlsx`) |
| A row with LOINC and no specimens takes LOINC's single match (4.4) | Dropped | Decision 2 |
| Reviews "the rows that will take LOINC-suggested specimens" (4.4) | Dropped | Follows from decision 2 |
| "Capped at 5,000 rows" (4.4) | 5,000 rows, and a 5 MiB file cap | The spec gives no byte figure. 5 MiB is far above 5,000 rows of CSV, and it bounds what an XLSX read can cost |
| "Apply, in one transaction" (4.4) | One transaction for categories, tests and LOINC links. The two sync signals are sent after it commits | `markTerminologyChanged` opens its own transaction, and loaders already signal once at the end of an operation (`packages/db/src/terminology-sync.ts:12`) |
| An unmatched category "is added" (4.4) | The Values step offers "Add as a new category" with an editable code, prefilled from the text | A category needs a code. The operator sees and can change it before anything is written |
| Export "in the import's column layout" (4.4) | Active tests only. Columns `code,name,short_name,loinc,category,specimen_types`; category and specimens as codes, specimens joined with `;` | Export matches the page's default view. The import suggests exactly these headers, so an export imports back with no manual mapping |
| (not specified) | Import never changes a test's status and never touches lab settings | Retiring is always explicit (4.4). Lab settings belong to each install |

## Known effects, not handled in S3

- **The table is re-sent with each step.** The server parses the file once and returns the table. The studio sends it back with each preview and with the apply, and the apply re-plans from scratch, never trusting the preview. At 5,000 rows that is well under the 16 MiB body cap set on those routes.
- **`toCsv` guards against spreadsheet formulas** (`packages/reporting/src/helpers.ts:83`), so an export writes a value that starts with `=`, `@` or a non-numeric `+`/`-` with a leading `'`. Importing that file back reads the `'` as part of the value. No real test code starts that way today.
- **A specimen code shared by two systems in the specimen list** is ambiguous in a file, so it is reported as unmatched and must be mapped.
- **`saveExclusive` re-inserts the ConceptMap mirror even for an inactive write** (`packages/db/src/terminology-admin-store.ts:1079-1082`), unlike `update` (`:971-976`). S3 unlinks through `update` and never writes an inactive row through `saveExclusive`. Not fixed here.
- **Line numbers in the review are row numbers:** the header is row 1, the first test is row 2.
- **Two columns with the same header** read as the first of them, and the Columns step offers the header once.
- **A new category is written to the category code system.** The category ValueSet includes that whole system (migration 104), so the category is offered at once. If an operator has changed the ValueSet to a list of codes, the new category is not in it, and the next edit of an imported test would refuse it.
- **Saving a test now reads both lists** (categories and specimens) on every save, where it read only the ones the test used. That is two ValueSet expansions per save.
- **The CLI reads its JSON map files with its own small reader.** `packages/cli/src/facilities.ts` keeps its private `readJsonFile`. The catalog's reader also checks the file against a schema, and importing `facilities.ts` would pull the whole facility command module into the catalog's.

---

## What changes

| File | Change |
|---|---|
| `packages/db/src/terminology-admin-store.ts` | `termMappings.saveExclusive` and `update` accept `{ trx }` |
| `packages/db/src/terminology-admin-store.test.ts` | Tests for the above |
| `packages/bootstrap/src/table-file.ts` | Create. `readTableFile`, `TableFileError` |
| `packages/bootstrap/src/table-file.test.ts` | Create |
| `packages/bootstrap/src/test-catalog-import.ts` | Create. Column suggestion, map checks, row reading, value resolution, export layout |
| `packages/bootstrap/src/test-catalog-import.test.ts` | Create |
| `packages/bootstrap/src/test-catalog.ts` | `checkTest` refactor; `readCatalogImportFile`, `importPreview`, `importApply`, `exportCsv`, `catalogImportAudit` |
| `packages/bootstrap/src/test-catalog.test.ts` | Import and export tests |
| `packages/bootstrap/src/index.ts` | Export the new names |
| `apps/server/src/test-catalog-routes.ts` | `POST /import/read`, `/import/preview`, `/import/apply`, `GET /export` |
| `apps/server/src/test-catalog-routes.test.ts` | Tests for the above |
| `packages/cli/src/test-catalog.ts` | `runTestCatalogImport`, `runTestCatalogExport` |
| `packages/cli/src/test-catalog-import.test.ts` | Create |
| `packages/cli/src/test-catalog-cli-parsing.test.ts` | Parsing tests for `import` and `export` |
| `packages/cli/src/program.ts` | Register `import` and `export` |
| `apps/studio/src/api.ts` | Import and export client |
| `apps/studio/src/api.testCatalog.test.ts` | Client tests |
| `apps/studio/src/test-catalog/ImportCatalogSheet.tsx` | Create. The four-step sheet |
| `apps/studio/src/test-catalog/ImportCatalogSheet.test.tsx` | Create |
| `apps/studio/src/pages/TestCatalog.tsx`, `TestCatalog.test.tsx` | Import and Export in the header menu |
| `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` | `testCatalog.importAction`, `exportAction`, `exported`, `testCatalog.import.*` |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/test-catalog.md` | Import and export sections |
| `apps/web/src/docs/0.1.8/test-catalog.md`, `cli.md` | Import and export, three languages |

---

### Task 1: term mappings can join the caller's transaction

**Files:**
- Modify: `packages/db/src/terminology-admin-store.ts` (the `TerminologyAdminStore` interface at `:187` and `:222`; the `update` implementation at `:953`; the `saveExclusive` implementation at `:995`)
- Modify: `packages/db/src/terminology-admin-store.test.ts`

**Interfaces:**
- Produces: `termMappings.update(id, input, opts?: { trx?: Kysely<InternalSchema> })` and `termMappings.saveExclusive(input, opts?: { id?: string; trx?: Kysely<InternalSchema> })`. With `trx`, each runs every write on it and opens no transaction of its own. Without it, both behave exactly as today.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/terminology-admin-store.test.ts`, change the first line to:

```ts
import { describe, it, expect, vi } from 'vitest';
```

Append at the end of the file:

```ts
describe('term mappings inside a caller transaction (test catalog S3)', () => {
  const input = (toCode: string, isActive = true): TermMappingInput => ({
    fromSystem: 'urn:openldr:codesystem:test-catalog', fromCode: 'HIVVL',
    toSystem: 'http://loinc.org', toCode, toDisplay: null, mapType: 'SAME-AS', isActive,
  });

  it('saveExclusive writes on the given transaction and opens none of its own', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db);
    const opened = vi.spyOn(db, 'transaction');
    let result: Awaited<ReturnType<typeof admin.termMappings.saveExclusive>> | undefined;
    await db.transaction().execute(async (trx) => {
      opened.mockClear(); // the outer transaction above is the caller's own
      result = await admin.termMappings.saveExclusive(input('25836-8'), { trx });
      expect(opened).not.toHaveBeenCalled();
    });
    expect(result?.mapping).toMatchObject({ fromCode: 'HIVVL', toCode: '25836-8', isActive: true });
    expect(await db.selectFrom('concept_map_elements').select('target_code').where('source_code', '=', 'HIVVL').execute())
      .toEqual([{ target_code: '25836-8' }]);
  });

  it('update writes on the given transaction, opens none, and drops the mirror of a deactivated link', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db);
    const { mapping } = await admin.termMappings.saveExclusive(input('25836-8'));
    const opened = vi.spyOn(db, 'transaction');
    await db.transaction().execute(async (trx) => {
      opened.mockClear();
      const { id, ...rest } = mapping;
      await admin.termMappings.update(id, { ...rest, isActive: false }, { trx });
      expect(opened).not.toHaveBeenCalled();
    });
    expect(await db.selectFrom('term_mappings').select('is_active').where('id', '=', mapping.id).executeTakeFirstOrThrow())
      .toEqual({ is_active: false });
    expect(await db.selectFrom('concept_map_elements').select('target_code').where('source_code', '=', 'HIVVL').execute())
      .toEqual([]);
  });

  it('still opens its own transaction when no caller transaction is given', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db);
    const opened = vi.spyOn(db, 'transaction');
    await admin.termMappings.saveExclusive(input('25836-8'));
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/db && npx vitest run src/terminology-admin-store.test.ts -t "caller transaction" --testTimeout 30000`

Expected: the first two tests FAIL. `opened` was called, because both methods ignore `trx` and open their own transaction. The third PASSES already; it guards today's behaviour.

- [ ] **Step 3: Let both methods take the caller's transaction**

In the `TerminologyAdminStore` interface, change the two signatures to:

```ts
    update(id: string, input: TermMappingInput, opts?: { trx?: Kysely<InternalSchema> }): Promise<TermMapping>;
```

```ts
    saveExclusive(
      input: TermMappingInput,
      opts?: { id?: string; trx?: Kysely<InternalSchema> },
    ): Promise<{ mapping: TermMapping; draftCreated: boolean; superseded: string[] }>;
```

and add this line to the end of `saveExclusive`'s doc comment, directly above its signature:

```ts
     * `opts.trx`: run on the caller's transaction and open none, so the write commits or fails with
     * the rest of the caller's work (the test catalog import). Without it, this opens its own.
```

Replace the `update` implementation with:

```ts
      async update(id, input, opts) {
        // A caller that already holds a transaction passes it, so this write joins the caller's work.
        const exec = opts?.trx ?? db;
        const existing = await exec.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`mapping not found: ${id}`, 'not-found');
        const run = async (trx: Kysely<InternalSchema>): Promise<void> => {
          await trx.deleteFrom('concept_map_elements').where('map_url', '=', LOCAL_MAP_URL)
            .where('source_system', '=', existing.from_system).where('source_code', '=', existing.from_code)
            .where('target_system', '=', existing.to_system).where('target_code', '=', existing.to_code).execute();
          await trx.updateTable('term_mappings').set({
            to_system: input.toSystem, to_code: input.toCode, to_display: input.toDisplay, map_type: input.mapType,
            relationship: input.relationship ?? null, owner: input.owner ?? null, is_active: input.isActive,
            updated_at: sql`now()`,
          }).where('id', '=', id).execute();
          // ⛔ A deactivated mapping must not go on being published. `sync-serve.ts` exports
          // `concept_map_elements` as the local FHIR ConceptMap, so re-inserting the mirror here
          // would tell every reader the mapping is live after the operator switched it off. The
          // delete above stays unconditional; only the re-insert is skipped. `saveExclusive`'s
          // supersede path already behaves this way, and migration 078 exists to clear the drift
          // this guard stops from accumulating again.
          if (input.isActive) {
            await trx.insertInto('concept_map_elements').values({
              map_url: LOCAL_MAP_URL, source_system: input.fromSystem, source_code: input.fromCode,
              target_system: input.toSystem, target_code: input.toCode, equivalence: input.mapType,
            }).execute();
          }
          const persisted = await trx.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
          if (capture) await capture.record(trx, 'term_mapping', id, 'upsert', tmContentHash(persisted));
        };
        if (opts?.trx) await run(opts.trx);
        else await db.transaction().execute(run);
        const row = await exec.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
        return tmRow(row);
      },
```

In the `saveExclusive` implementation, make three changes and leave everything else exactly as it is:

1. Replace the line `await db.transaction().execute(async (trx) => {` with:

```ts
        const run = async (trx: Kysely<InternalSchema>): Promise<void> => {
```

2. Replace the `});` that closes that callback (the line directly above `const row = await db.selectFrom('term_mappings')`) with:

```ts
        };
        // A caller that already holds a transaction (the test catalog import) passes it, so this
        // write commits or fails with the rest of its work. Otherwise it opens its own.
        if (opts?.trx) await run(opts.trx);
        else await db.transaction().execute(run);
```

3. Change the final read from `const row = await db.selectFrom('term_mappings')` to:

```ts
        const row = await (opts?.trx ?? db).selectFrom('term_mappings')
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/db && npx vitest run src/terminology-admin-store.test.ts --testTimeout 30000`

Expected: every test in the file PASSES, the existing `saveExclusive` and `update` tests included.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/db && npx tsc --noEmit -p . > "$TEMP/s3-t1-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts
git commit -m "feat(db): let a term mapping write join the caller's transaction" -m "termMappings.saveExclusive and update take an optional trx. With it they run every write on the caller's transaction and open none, so the test catalog import can write its tests and their LOINC links as one unit. Without it both behave as before."
```

---

### Task 2: read a CSV or XLSX file into a table

**Files:**
- Create: `packages/bootstrap/src/table-file.ts`
- Create: `packages/bootstrap/src/table-file.test.ts`

**Interfaces:**
- Produces: `type TableFileFormat = 'csv' | 'xlsx'`; `interface TableFile { headers: string[]; rows: string[][]; sheetName: string | null; sheetCount: number }`; `class TableFileError extends Error { reason: 'too_large' | 'not_xlsx' | 'unreadable' | 'empty' | 'too_many_rows' }`; `readTableFile(bytes: Uint8Array, format: TableFileFormat, limits: { maxBytes: number; maxRows: number }): TableFile`. Every row has exactly `headers.length` cells, each trimmed text.

The number rule copies the facility reader on `main`, `packages/bootstrap/src/facility-xlsx.ts` (merged at `845468fc`): a General-format number is written as its stored value, any other format keeps its displayed text. Do not "simplify" to `rawNumbers: true`, which drops zeros a number format pads.

- [ ] **Step 1: Write the failing tests**

Create `packages/bootstrap/src/table-file.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readTableFile, TableFileError } from './table-file';

const LIMITS = { maxBytes: 1024 * 1024, maxRows: 3 };
const csv = (text: string) => new TextEncoder().encode(text);

function workbook(sheets: Record<string, XLSX.WorkSheet>): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, sheet, name);
  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

function refusal(fn: () => unknown): { reason: string; message: string } {
  try {
    fn();
  } catch (err) {
    if (err instanceof TableFileError) return { reason: err.reason, message: err.message };
    throw err;
  }
  throw new Error('expected a TableFileError');
}

describe('readTableFile: CSV', () => {
  it('reads the header and rows, trimming cells and skipping a byte order mark and blank lines', () => {
    const file = readTableFile(csv('﻿code , name\n A1 ,Alpha \n\nB2,"Beta, two"\n'), 'csv', LIMITS);
    expect(file).toEqual({
      headers: ['code', 'name'],
      rows: [['A1', 'Alpha'], ['B2', 'Beta, two']],
      sheetName: null,
      sheetCount: 1,
    });
  });

  it('pads a short row with empty cells and drops cells past the header', () => {
    expect(readTableFile(csv('code,name,loinc\nA1\nB2,Beta,1-8,extra\n'), 'csv', LIMITS).rows)
      .toEqual([['A1', '', ''], ['B2', 'Beta', '1-8']]);
  });

  it('refuses a file over the byte limit, over the row limit, or with no rows, and says why', () => {
    expect(refusal(() => readTableFile(csv('x'.repeat(20)), 'csv', { maxBytes: 10, maxRows: 3 })))
      .toEqual({ reason: 'too_large', message: 'The file is larger than 10 bytes, the limit.' });
    expect(refusal(() => readTableFile(csv('code\nA\nB\nC\nD\n'), 'csv', LIMITS)))
      .toEqual({ reason: 'too_many_rows', message: 'The file has 4 rows under its header. The limit is 3.' });
    expect(refusal(() => readTableFile(csv('\n\n'), 'csv', LIMITS)))
      .toEqual({ reason: 'empty', message: 'The file has no rows.' });
  });
});

describe('readTableFile: XLSX', () => {
  it('reads the first worksheet and says which one, and how many there are', () => {
    const bytes = workbook({
      Tests: XLSX.utils.aoa_to_sheet([['code', 'name'], ['A1', 'Alpha']]),
      Notes: XLSX.utils.aoa_to_sheet([['ignored']]),
    });
    expect(readTableFile(bytes, 'xlsx', LIMITS)).toEqual({
      headers: ['code', 'name'], rows: [['A1', 'Alpha']], sheetName: 'Tests', sheetCount: 2,
    });
  });

  it('keeps a 15-digit General number whole, and the zeros a number format pads', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['code', 'padded'], [123456789012345, 123]]);
    sheet.B2.z = '000000';
    const file = readTableFile(workbook({ Tests: sheet }), 'xlsx', LIMITS);
    // SheetJS's default text would read 1.23457E+14 here.
    expect(file.rows).toEqual([['123456789012345', '000123']]);
  });

  it('refuses bytes that are not a workbook, and an empty worksheet', () => {
    expect(refusal(() => readTableFile(csv('code,name\n'), 'xlsx', LIMITS)))
      .toEqual({ reason: 'not_xlsx', message: 'The file is not an Excel workbook (.xlsx).' });
    expect(refusal(() => readTableFile(workbook({ Empty: XLSX.utils.aoa_to_sheet([]) }), 'xlsx', LIMITS)))
      .toEqual({ reason: 'empty', message: 'The worksheet "Empty" has no rows.' });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/table-file.test.ts --testTimeout 30000`

Expected: FAIL. `./table-file` does not exist.

- [ ] **Step 3: Write the reader**

Create `packages/bootstrap/src/table-file.ts`:

```ts
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

// A table read from an uploaded CSV or Excel file: the header row and the rows under it, every cell
// as trimmed text. Generic on purpose: the test catalog import uses it first, and the facility import
// can move onto it (docs/superpowers/plans/2026-09-15-test-catalog-s3-import-export.md, decision 1).

export type TableFileFormat = 'csv' | 'xlsx';

export interface TableFile {
  headers: string[];
  /** Every row has exactly headers.length cells. */
  rows: string[][];
  /** The worksheet read from an Excel file. Null for CSV. */
  sheetName: string | null;
  /** How many worksheets the workbook holds. Only the first is read. 1 for CSV. */
  sheetCount: number;
}

export type TableFileRefusal = 'too_large' | 'not_xlsx' | 'unreadable' | 'empty' | 'too_many_rows';

export class TableFileError extends Error {
  constructor(message: string, public readonly reason: TableFileRefusal) {
    super(message);
    this.name = 'TableFileError';
  }
}

export interface TableFileLimits {
  maxBytes: number;
  /** Rows under the header. */
  maxRows: number;
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function describeBytes(n: number): string {
  return n >= 1024 * 1024 ? `${n / 1024 / 1024} MB` : `${n} bytes`;
}

export function readTableFile(bytes: Uint8Array, format: TableFileFormat, limits: TableFileLimits): TableFile {
  if (bytes.length > limits.maxBytes) {
    throw new TableFileError(`The file is larger than ${describeBytes(limits.maxBytes)}, the limit.`, 'too_large');
  }
  const read = format === 'xlsx' ? readXlsx(bytes) : { records: readCsv(bytes), sheetName: null, sheetCount: 1 };
  const records = read.records.filter((r) => r.some((c) => c.trim() !== ''));
  if (records.length === 0) {
    throw new TableFileError(
      read.sheetName === null ? 'The file has no rows.' : `The worksheet "${read.sheetName}" has no rows.`,
      'empty',
    );
  }
  const [head, ...body] = records;
  if (body.length > limits.maxRows) {
    throw new TableFileError(`The file has ${body.length} rows under its header. The limit is ${limits.maxRows}.`, 'too_many_rows');
  }
  const headers = head.map((h) => h.trim());
  // Every row as long as the header: a short row reads as empty cells, never as missing ones.
  const rows = body.map((r) => headers.map((_, i) => (r[i] ?? '').trim()));
  return { headers, rows, sheetName: read.sheetName, sheetCount: read.sheetCount };
}

function readCsv(bytes: Uint8Array): string[][] {
  let text = Buffer.from(bytes).toString('utf8');
  // Excel saves "CSV UTF-8" with a byte order mark, which would otherwise glue onto the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return parseCsv(text, { relax_column_count: true, skip_empty_lines: true }) as string[][];
  } catch (err) {
    throw new TableFileError(`The CSV file could not be read: ${err instanceof Error ? err.message : String(err)}`, 'unreadable');
  }
}

function readXlsx(bytes: Uint8Array): { records: string[][]; sheetName: string; sheetCount: number } {
  if (!ZIP_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new TableFileError('The file is not an Excel workbook (.xlsx).', 'not_xlsx');
  }
  let book: XLSX.WorkBook;
  try {
    // A Buffer view over the same memory: SheetJS's 'buffer' type expects a Node Buffer, and a caller
    // may hand over a plain Uint8Array.
    book = XLSX.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      type: 'buffer',
      sheets: 0, // parse the first worksheet only; SheetNames still lists them all
      dense: true,
      cellDates: true,
      cellNF: true, // keeps each cell's number format, which tells General apart from 000000
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
    });
  } catch (err) {
    throw new TableFileError(`The Excel workbook could not be read: ${err instanceof Error ? err.message : String(err)}`, 'unreadable');
  }
  const sheetName = book.SheetNames[0];
  const sheet = sheetName === undefined ? undefined : book.Sheets[sheetName];
  if (sheetName === undefined || !sheet) throw new TableFileError('The Excel workbook has no worksheets.', 'unreadable');

  // ⛔ SheetJS reads the text Excel DISPLAYS. "General" displays a 15-digit number as 1.23457E+14,
  // which would rewrite a code on the way in. So a General number takes its stored value, and a number
  // with a format of its own (000000, a date) keeps the text the operator sees.
  for (const row of sheet['!data'] ?? []) {
    for (const cell of row ?? []) {
      if (cell?.t === 'n' && (cell.z === undefined || cell.z === 'General')) cell.w = String(cell.v);
    }
  }
  const records = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  return {
    records: records.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))),
    sheetName,
    sheetCount: book.SheetNames.length,
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/table-file.test.ts --testTimeout 30000`

Expected: PASS, six tests. If the General-number test fails with `1.23457E+14`, the number rule did not run: check that `cellNF: true` is set and that `sheet['!data']` is the dense data array. Stop and report rather than switching to `rawNumbers`.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s3-t2-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/table-file.ts packages/bootstrap/src/table-file.test.ts
git commit -m "feat(bootstrap): read a CSV or Excel file into a table of text" -m "readTableFile reads a CSV, or the first worksheet of an .xlsx, into a header row and rows of trimmed text, each as long as the header. A General-format number keeps its stored value, so a 15-digit code is not rewritten as 1.23457E+14, and a padded format keeps its zeros. It refuses a file over its byte or row limit, an empty one, and bytes that are not a workbook, with a message saying which."
```

---

### Task 3: suggest columns, read rows, match values

**Files:**
- Create: `packages/bootstrap/src/test-catalog-import.ts`
- Create: `packages/bootstrap/src/test-catalog-import.test.ts`

**Interfaces:**
- Consumes: the types `CatalogCategoryOption`, `CatalogSpecimenOption`, `CatalogTest`, `SpecimenCoding` from `./test-catalog` (type-only import, so no import cycle at run time).
- Produces:
  - `CATALOG_IMPORT_MAX_BYTES = 5 * 1024 * 1024`, `CATALOG_IMPORT_MAX_ROWS = 5000`
  - `type CatalogImportField = 'code' | 'name' | 'shortName' | 'loinc' | 'category' | 'specimenTypes'`, `CATALOG_IMPORT_FIELDS`
  - `type CatalogColumnMap = Partial<Record<CatalogImportField, string>>` (field to header text)
  - `type CategoryAnswer = { text: string; kind: 'existing'; code: string } | { text: string; kind: 'new'; code: string; display: string }`
  - `interface SpecimenAnswer { text: string; system: string; code: string }`
  - `interface CatalogValueMap { categories: CategoryAnswer[]; specimens: SpecimenAnswer[] }`
  - `interface CatalogImportRow { line: number; values: Partial<Record<CatalogImportField, string>> }`
  - `valueKey(text)`, `suggestCatalogColumns(headers)`, `checkColumnMap(map, headers): string | null`, `readCatalogRows(table, map)`, `splitSpecimens(text)`, `matchCategory(text, options): string | null`, `matchSpecimen(text, options): SpecimenCoding | null`
  - `CATALOG_EXPORT_HEADERS`, `CATALOG_EXPORT_COLUMNS` (for `toCsv`), `catalogExportRow(test): Record<string, string>`
  - zod schemas `catalogColumnMapSchema`, `catalogValueMapSchema`, `catalogImportInputSchema`. The route checks request bodies with them and the CLI checks its `--column-map` and `--value-map` files with them, so both refuse the same shapes.

The value map travels as arrays of `{ text, ... }`, not as an object keyed by the file's text. A key such as `__proto__` in a plain object would reach the prototype.

- [ ] **Step 1: Write the failing tests**

Create `packages/bootstrap/src/test-catalog-import.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  suggestCatalogColumns, checkColumnMap, readCatalogRows, splitSpecimens, valueKey,
  matchCategory, matchSpecimen, catalogExportRow, CATALOG_EXPORT_HEADERS,
  catalogColumnMapSchema, catalogValueMapSchema,
} from './test-catalog-import';
import type { CatalogTest } from './test-catalog';

const LOCAL = 'urn:openldr:cs:local';
const CATEGORIES = [{ code: 'MOL', display: 'Molecular' }, { code: 'HAEM', display: 'Haematology' }];
const SPECIMENS = [
  { system: LOCAL, code: 'BLD', display: 'Blood' },
  { system: LOCAL, code: 'UR', display: 'Urine' },
  // The same code in a second list, so "UR" alone names two specimens.
  { system: 'urn:example:other', code: 'UR', display: 'Urine sample' },
];

describe('suggestCatalogColumns', () => {
  it('matches common header spellings, ignoring case, spaces and punctuation', () => {
    expect(suggestCatalogColumns(['Test Code', 'Test name', 'Abbreviation', 'LOINC code', 'Category', 'Specimen types', 'Notes']))
      .toEqual({
        code: 'Test Code', name: 'Test name', shortName: 'Abbreviation', loinc: 'LOINC code',
        category: 'Category', specimenTypes: 'Specimen types',
      });
  });

  it('suggests every column of an export, so an export imports back with no mapping', () => {
    expect(suggestCatalogColumns([...CATALOG_EXPORT_HEADERS])).toEqual({
      code: 'code', name: 'name', shortName: 'short_name', loinc: 'loinc', category: 'category', specimenTypes: 'specimen_types',
    });
  });

  it('leaves a field out when no header fits it', () => {
    expect(suggestCatalogColumns(['Name', 'Description'])).toEqual({ name: 'Name' });
  });
});

describe('checkColumnMap', () => {
  it('needs the name, and each column it names must exist and be used once', () => {
    const headers = ['code', 'name'];
    expect(checkColumnMap({ code: 'code', name: 'name' }, headers)).toBeNull();
    expect(checkColumnMap({ code: 'code' }, headers)).toBe('Choose the column that holds the test name. It is required.');
    expect(checkColumnMap({ name: 'title' }, headers)).toBe('The file has no column "title".');
    expect(checkColumnMap({ name: 'name', shortName: 'name' }, headers)).toBe('Column "name" is chosen for two fields.');
  });
});

describe('readCatalogRows', () => {
  it('reads each mapped column, numbers rows as the spreadsheet does, and leaves unmapped fields out', () => {
    const table = { headers: ['code', 'name', 'notes'], rows: [[' A1 ', 'Alpha', 'x'], ['', 'Beta', '']] };
    expect(readCatalogRows(table, { code: 'code', name: 'name' })).toEqual([
      { line: 2, values: { code: 'A1', name: 'Alpha' } },
      { line: 3, values: { code: '', name: 'Beta' } },
    ]);
  });
});

describe('matching file text to the lists', () => {
  it('ignores case and spacing', () => {
    expect(valueKey('  Whole   Blood ')).toBe('whole blood');
    expect(splitSpecimens('Blood; urine ;;')).toEqual(['Blood', 'urine']);
  });

  it('matches a category by its code or its name', () => {
    expect(matchCategory('molecular', CATEGORIES)).toBe('MOL');
    expect(matchCategory(' mol ', CATEGORIES)).toBe('MOL');
    expect(matchCategory('Virology', CATEGORIES)).toBeNull();
  });

  it('matches a specimen by code or name, and not when the text names two', () => {
    expect(matchSpecimen('blood', SPECIMENS)).toEqual({ system: LOCAL, code: 'BLD' });
    expect(matchSpecimen('BLD', SPECIMENS)).toEqual({ system: LOCAL, code: 'BLD' });
    expect(matchSpecimen('Urine', SPECIMENS)).toEqual({ system: LOCAL, code: 'UR' });
    expect(matchSpecimen('UR', SPECIMENS)).toBeNull();
    expect(matchSpecimen('Stool', SPECIMENS)).toBeNull();
  });
});

describe('catalogExportRow', () => {
  it('writes a test in the import layout, codes for category and specimens', () => {
    const test: CatalogTest = {
      code: 'HIVVL', display: 'HIV viral load', shortName: null, category: 'MOL',
      specimenTypes: [{ system: LOCAL, code: 'BLD' }, { system: LOCAL, code: 'UR' }], loinc: '25836-8', active: true,
      lab: { enabled: true, specimenTypes: null, localDisplay: 'VL' },
    };
    expect(catalogExportRow(test)).toEqual({
      code: 'HIVVL', name: 'HIV viral load', short_name: '', loinc: '25836-8', category: 'MOL', specimen_types: 'BLD;UR',
    });
  });
});

describe('the shapes the route and the CLI accept', () => {
  it('takes a column map of known fields only', () => {
    expect(catalogColumnMapSchema.safeParse({ name: 'Test name', loinc: 'LOINC' }).success).toBe(true);
    expect(catalogColumnMapSchema.safeParse({ name: 'Test name', notes: 'Notes' }).success).toBe(false);
  });

  it('takes a value map whose new categories carry a name', () => {
    const ok = {
      categories: [{ text: 'Virology', kind: 'new', code: 'VIRO', display: 'Virology' }, { text: 'Mol', kind: 'existing', code: 'MOL' }],
      specimens: [{ text: 'Plasma', system: LOCAL, code: 'BLD' }],
    };
    expect(catalogValueMapSchema.safeParse(ok).success).toBe(true);
    expect(catalogValueMapSchema.safeParse({ categories: [{ text: 'Virology', kind: 'new', code: 'VIRO' }], specimens: [] }).success)
      .toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog-import.test.ts --testTimeout 30000`

Expected: FAIL. `./test-catalog-import` does not exist.

- [ ] **Step 3: Write the helpers**

Create `packages/bootstrap/src/test-catalog-import.ts`:

```ts
import { z } from 'zod';
import type { TableFile } from './table-file';
import type { CatalogCategoryOption, CatalogSpecimenOption, CatalogTest, SpecimenCoding } from './test-catalog';

// The pure half of the test catalog import (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.4):
// which column feeds which field, reading rows, and matching file text to the category and specimen
// lists. The service in ./test-catalog.ts does everything that reads or writes the database.

/** A national list is hundreds of rows, a few thousand at most (spec 4.4). */
export const CATALOG_IMPORT_MAX_ROWS = 5000;
/** Far above 5,000 rows of CSV. It bounds what reading an Excel file can cost. */
export const CATALOG_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export type CatalogImportField = 'code' | 'name' | 'shortName' | 'loinc' | 'category' | 'specimenTypes';
export const CATALOG_IMPORT_FIELDS: readonly CatalogImportField[] = ['code', 'name', 'shortName', 'loinc', 'category', 'specimenTypes'];

/** Which file column feeds each field, by header text. A field left out is not read, so the import leaves it alone. */
export type CatalogColumnMap = Partial<Record<CatalogImportField, string>>;

/** The operator's answer for a category text that matched nothing: an existing category, or a new one. */
export type CategoryAnswer =
  | { text: string; kind: 'existing'; code: string }
  | { text: string; kind: 'new'; code: string; display: string };

/** The operator's answer for a specimen text that matched nothing. */
export interface SpecimenAnswer {
  text: string;
  system: string;
  code: string;
}

/** Answers travel as lists, not as an object keyed by the file's text: a key like __proto__ would reach the prototype. */
export interface CatalogValueMap {
  categories: CategoryAnswer[];
  specimens: SpecimenAnswer[];
}

export interface CatalogImportRow {
  /** The row number in the spreadsheet. The header is row 1. */
  line: number;
  /** Each mapped column's trimmed text. A field missing here was not mapped. */
  values: Partial<Record<CatalogImportField, string>>;
}

/** The header names each field answers to, lower case with everything but letters and digits removed. */
const HEADER_NAMES: Record<CatalogImportField, readonly string[]> = {
  code: ['code', 'nationalcode', 'testcode'],
  name: ['name', 'testname', 'display'],
  shortName: ['shortname', 'abbreviation'],
  loinc: ['loinc', 'loinccode'],
  category: ['category', 'testcategory'],
  specimenTypes: ['specimentypes', 'specimentype', 'specimens', 'specimen'],
};

function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Case and spacing do not count when file text is matched to a list (spec 4.4). */
export function valueKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** CE's guess at the column map. The operator confirms it on the Columns step. */
export function suggestCatalogColumns(headers: string[]): CatalogColumnMap {
  const map: CatalogColumnMap = {};
  const used = new Set<string>();
  for (const field of CATALOG_IMPORT_FIELDS) {
    const hit = headers.find((h) => !used.has(h) && HEADER_NAMES[field].includes(headerKey(h)));
    if (hit !== undefined) {
      map[field] = hit;
      used.add(hit);
    }
  }
  return map;
}

/** What is wrong with a column map, or null. The first problem only. */
export function checkColumnMap(map: CatalogColumnMap, headers: string[]): string | null {
  if (!map.name) return 'Choose the column that holds the test name. It is required.';
  const used = new Set<string>();
  for (const field of CATALOG_IMPORT_FIELDS) {
    const header = map[field];
    if (header === undefined) continue;
    if (!headers.includes(header)) return `The file has no column "${header}".`;
    if (used.has(header)) return `Column "${header}" is chosen for two fields.`;
    used.add(header);
  }
  return null;
}

/**
 * Read the mapped columns of every row. Cells are trimmed again here, because the table comes back
 * from the studio with each step. Two columns with the same header read as the first of them.
 */
export function readCatalogRows(table: Pick<TableFile, 'headers' | 'rows'>, map: CatalogColumnMap): CatalogImportRow[] {
  const columns: Array<[CatalogImportField, number]> = [];
  for (const field of CATALOG_IMPORT_FIELDS) {
    const header = map[field];
    if (header !== undefined) columns.push([field, table.headers.indexOf(header)]);
  }
  return table.rows.map((cells, i) => {
    const values: Partial<Record<CatalogImportField, string>> = {};
    for (const [field, col] of columns) values[field] = (cells[col] ?? '').trim();
    return { line: i + 2, values };
  });
}

/** A cell may hold several specimens, split on ";" (spec 4.4). */
export function splitSpecimens(text: string): string[] {
  return text.split(';').map((s) => s.trim()).filter((s) => s !== '');
}

/** The one category the text names, by code or by name. Null when none does, or when two do. */
export function matchCategory(text: string, options: CatalogCategoryOption[]): string | null {
  const key = valueKey(text);
  const hits = new Set(options
    .filter((o) => valueKey(o.code) === key || (o.display !== null && valueKey(o.display) === key))
    .map((o) => o.code));
  return hits.size === 1 ? [...hits][0] : null;
}

/** The one specimen the text names, by code or by name. Null when none does, or when two do. */
export function matchSpecimen(text: string, options: CatalogSpecimenOption[]): SpecimenCoding | null {
  const key = valueKey(text);
  const hits = new Map<string, SpecimenCoding>();
  for (const o of options) {
    if (valueKey(o.code) === key || (o.display !== null && valueKey(o.display) === key)) {
      hits.set(`${o.system}|${o.code}`, { system: o.system, code: o.code });
    }
  }
  return hits.size === 1 ? [...hits.values()][0] : null;
}

/** The export's columns. suggestCatalogColumns maps every one, so an export imports back as it is. */
export const CATALOG_EXPORT_HEADERS = ['code', 'name', 'short_name', 'loinc', 'category', 'specimen_types'] as const;
export const CATALOG_EXPORT_COLUMNS = CATALOG_EXPORT_HEADERS.map((h) => ({ key: h, label: h }));

export function catalogExportRow(t: CatalogTest): Record<string, string> {
  return {
    code: t.code,
    name: t.display,
    short_name: t.shortName ?? '',
    loinc: t.loinc ?? '',
    category: t.category ?? '',
    specimen_types: t.specimenTypes.map((s) => s.code).join(';'),
  };
}

// The shapes an import step accepts. The route checks request bodies with these and the CLI checks its
// --column-map and --value-map files with them, so the two doors refuse the same things.
const headerText = z.string().min(1);
export const catalogColumnMapSchema = z.object({
  code: headerText.optional(),
  name: headerText.optional(),
  shortName: headerText.optional(),
  loinc: headerText.optional(),
  category: headerText.optional(),
  specimenTypes: headerText.optional(),
}).strict();

export const catalogValueMapSchema = z.object({
  categories: z.array(z.discriminatedUnion('kind', [
    z.object({ text: z.string(), kind: z.literal('existing'), code: z.string().min(1) }),
    z.object({ text: z.string(), kind: z.literal('new'), code: z.string(), display: z.string() }),
  ])),
  specimens: z.array(z.object({ text: z.string(), system: z.string().min(1), code: z.string().min(1) })),
});

export const catalogImportInputSchema = z.object({
  table: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) }),
  columnMap: catalogColumnMapSchema,
  valueMap: catalogValueMapSchema.optional(),
});
```

A new category's code and name may be blank in the schema. The service says which one is missing, in words the Values step can show, rather than zod's.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog-import.test.ts --testTimeout 30000`

Expected: PASS, eleven tests.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s3-t3-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/test-catalog-import.ts packages/bootstrap/src/test-catalog-import.test.ts
git commit -m "feat(bootstrap): match an imported test list's columns and values" -m "Pure helpers for the test catalog import. They suggest which column feeds each field from its header, check the operator's column map, read rows with their spreadsheet row numbers, and match category and specimen text to the lists by code or name, ignoring case and spacing. Text that names two specimens matches neither. The export layout lives here too, and the suggester maps every export column, so an export imports back with no mapping. The zod schemas for an import step live here so the route and the CLI accept the same shapes."
```

---

### Task 4: one set of row rules, and the import preview

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts`
- Modify: `packages/bootstrap/src/test-catalog.test.ts`
- Modify: `packages/bootstrap/src/index.ts:1746-1752`

**Interfaces:**
- Consumes: `readTableFile`, `TableFileError`, `TableFileFormat` (Task 2); everything Task 3 produces.
- Produces:
  - `readCatalogImportFile(bytes: Uint8Array, format: TableFileFormat): CatalogImportFile`, a plain function, not a service method. It throws `TestCatalogError('invalid')` for a file it refuses.
  - `interface CatalogImportFile { headers; rows; sheetName; sheetCount; suggested: CatalogColumnMap }`
  - `interface CatalogImportInput { table: { headers: string[]; rows: string[][] }; columnMap: CatalogColumnMap; valueMap?: CatalogValueMap }`
  - `interface CatalogImportReport { counts: { new; changed; unchanged; refused }; refused: CatalogImportRefusal[]; unmatched: { categories: CatalogUnmatchedValue[]; specimens: CatalogUnmatchedValue[] }; categoriesToAdd: Array<{ code: string; display: string }>; loincChecked: boolean }`
  - `interface CatalogImportRefusal { line: number; code: string | null; reason: string }`, `interface CatalogUnmatchedValue { text: string; rows: number }`
  - `TestCatalog.importPreview(input: CatalogImportInput): Promise<CatalogImportReport>`
  - Internal, for Task 5: `planImport(input): Promise<{ report: CatalogImportReport; writes: PlannedWrite[] }>` and `interface PlannedWrite { code; test: ValidTest; stored: unknown; loincBefore: string | null }`.

`validate` becomes `checkTest`, a function that reads nothing, over a `CheckContext` loaded once. `create` and `update` load it for one test; the import loads it for the whole file. So every door refuses a test in the same words. One visible change: `validate` now reads both lists on every save, where it used to read only the ones a test used. That is two ValueSet expansions per save.

`checkTest` takes a third argument, the LOINC code the test already has. A row that keeps it is not checked again, so a test linked before LOINC was loaded (a DRAFT stub) does not start failing an import that never touches LOINC. `create` and `update` pass nothing, so the sheet behaves exactly as in S2.

- [ ] **Step 1: Write the failing tests**

In `packages/bootstrap/src/test-catalog.test.ts`, replace the import from `./test-catalog` with:

```ts
import {
  createTestCatalog, parseCatalogListQuery, catalogChangeAction, readCatalogImportFile, TEST_CATALOG_SYSTEM,
  type CatalogListQuery, type CatalogListResult, type CatalogTestInput, type CatalogImportInput,
} from './test-catalog';
import type { CatalogColumnMap } from './test-catalog-import';
```

Add these helpers directly below the `codes` helper:

```ts
// The export's own layout, so every import test also exercises the headers an export writes.
const IMPORT_HEAD = ['code', 'name', 'short_name', 'loinc', 'category', 'specimen_types'];
const ALL_COLUMNS: CatalogColumnMap = {
  code: 'code', name: 'name', shortName: 'short_name', loinc: 'loinc', category: 'category', specimenTypes: 'specimen_types',
};

function importInput(rows: string[][], over: Partial<CatalogImportInput> = {}): CatalogImportInput {
  return { table: { headers: IMPORT_HEAD, rows }, columnMap: ALL_COLUMNS, ...over };
}

async function catalogGeneration(db: Kysely<InternalSchema>): Promise<number> {
  const row = await db.selectFrom('terminology_systems').select('generation')
    .where('url', '=', TEST_CATALOG_SYSTEM).executeTakeFirst();
  return row ? Number(row.generation) : 0;
}
```

Append at the end of the file:

```ts
describe('test catalog: import preview', () => {
  it('reads a file for import and suggests its columns, and refuses a bad one as invalid', () => {
    const file = readCatalogImportFile(new TextEncoder().encode('Test code,Test name\nHIVVL,HIV viral load\n'), 'csv');
    expect(file).toEqual({
      headers: ['Test code', 'Test name'], rows: [['HIVVL', 'HIV viral load']], sheetName: null, sheetCount: 1,
      suggested: { code: 'Test code', name: 'Test name' },
    });
    let caught: unknown;
    try {
      readCatalogImportFile(new TextEncoder().encode('code,name\n'), 'xlsx');
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ kind: 'invalid', message: 'The file is not an Excel workbook (.xlsx).' });
  });

  it('counts new, changed, unchanged and refused rows, and writes nothing', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', category: 'MOL', specimenTypes: [BLD] });
    await catalog.create({ code: 'CD4', display: 'CD4 count', category: 'HAEM' });
    const generation = await catalogGeneration(db);

    const report = await catalog.importPreview(importInput([
      ['HIVVL', 'HIV viral load', '', '', 'Molecular', 'Blood'],
      ['CD4', 'CD4 cell count', '', '', 'haem', ''],
      ['GLU', 'Glucose', '', '', 'Chemistry', 'Blood; urine'],
      ['', 'No code', '', '', '', ''],
      ['HIVVL', 'HIV viral load again', '', '', '', ''],
    ]));

    expect(report).toEqual({
      counts: { new: 1, changed: 1, unchanged: 1, refused: 2 },
      refused: [
        { line: 5, code: null, reason: 'A test needs a national code or a LOINC code.' },
        { line: 6, code: 'HIVVL', reason: 'Test HIVVL is already on row 2 of this file.' },
      ],
      unmatched: { categories: [], specimens: [] },
      categoriesToAdd: [],
      loincChecked: false,
    });
    expect((await catalog.get('CD4'))?.display).toBe('CD4 count');
    expect(await catalog.get('GLU')).toBeNull();
    expect(await catalogGeneration(db)).toBe(generation);
  });

  it('lists text that matched nothing, refuses its rows until answered, and adds a category the operator names', async () => {
    const { catalog } = await buildCatalog();
    const rows = [
      ['VL1', 'Viral load 1', '', '', 'Virology', 'Plasma'],
      ['VL2', 'Viral load 2', '', '', 'virology', 'Blood'],
    ];

    const unanswered = await catalog.importPreview(importInput(rows));
    expect(unanswered.counts).toEqual({ new: 0, changed: 0, unchanged: 0, refused: 2 });
    expect(unanswered.refused).toEqual([
      {
        line: 2, code: 'VL1',
        reason: 'Category "Virology" is not in the test category list. Choose a category for it. '
          + 'Specimen "Plasma" is not in the specimen type list. Choose a specimen for it.',
      },
      { line: 3, code: 'VL2', reason: 'Category "virology" is not in the test category list. Choose a category for it.' },
    ]);
    expect(unanswered.unmatched).toEqual({ categories: [{ text: 'Virology', rows: 2 }], specimens: [{ text: 'Plasma', rows: 1 }] });

    const answered = await catalog.importPreview(importInput(rows, {
      valueMap: {
        categories: [{ text: 'VIROLOGY', kind: 'new', code: 'VIRO', display: 'Virology' }],
        specimens: [{ text: 'plasma', system: LOCAL, code: 'BLD' }],
      },
    }));
    expect(answered.counts).toEqual({ new: 2, changed: 0, unchanged: 0, refused: 0 });
    expect(answered.categoriesToAdd).toEqual([{ code: 'VIRO', display: 'Virology' }]);
    // Answered text stays listed, so the Values step can show the answer.
    expect(answered.unmatched).toEqual(unanswered.unmatched);
  });

  it('refuses a new category with no code or name, or one that already exists', async () => {
    const { catalog } = await buildCatalog();
    const withNew = (code: string, display: string) => importInput([['VL1', 'Viral load', '', '', 'Virology', '']], {
      valueMap: { categories: [{ text: 'Virology', kind: 'new', code, display }], specimens: [] },
    });
    await expect(catalog.importPreview(withNew(' ', 'Virology')))
      .rejects.toMatchObject({ kind: 'invalid', message: 'The new category for "Virology" needs a code.' });
    await expect(catalog.importPreview(withNew('VIRO', ' ')))
      .rejects.toMatchObject({ kind: 'invalid', message: 'The new category VIRO needs a name.' });
    await expect(catalog.importPreview(withNew('MOL', 'Molecular again')))
      .rejects.toMatchObject({ kind: 'invalid', message: 'Category MOL already exists. Choose it instead of adding it.' });
  });

  it('leaves a field alone when its column is not mapped', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
    const report = await catalog.importPreview({
      table: { headers: ['code', 'name'], rows: [['HIVVL', 'HIV viral load']] },
      columnMap: { code: 'code', name: 'name' },
    });
    expect(report.counts).toEqual({ new: 0, changed: 0, unchanged: 1, refused: 0 });
  });

  it('checks LOINC codes against LOINC when it is loaded, and says when it could check only their format', async () => {
    const { db, catalog } = await buildCatalog();
    const rows = [['A', 'A', '', 'ABC', '', ''], ['B', 'B', '', '25836-8', '', ''], ['C', 'C', '', '2345-7', '', '']];

    const unloaded = await catalog.importPreview(importInput(rows));
    expect(unloaded.loincChecked).toBe(false);
    expect(unloaded.refused).toEqual([{ line: 2, code: 'A', reason: '"ABC" is not a LOINC code. LOINC codes look like 12345-6.' }]);

    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    const loaded = await catalog.importPreview(importInput(rows));
    expect(loaded.loincChecked).toBe(true);
    expect(loaded.counts).toEqual({ new: 1, changed: 0, unchanged: 0, refused: 2 });
    expect(loaded.refused[1]).toEqual({ line: 3, code: 'B', reason: 'LOINC code 25836-8 is not in the LOINC loaded on this install.' });
  });

  it('does not check again a LOINC code the test already has', async () => {
    const { db, catalog } = await buildCatalog();
    // Linked before LOINC was loaded, so only a DRAFT stub stands behind the code.
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    const report = await catalog.importPreview(importInput([['HIVVL', 'HIV viral load', '', '25836-8', '', '']]));
    expect(report.counts).toEqual({ new: 0, changed: 0, unchanged: 1, refused: 0 });
  });

  it('refuses a map with no name, a table over the row limit, and a lab whose catalog comes from central', async () => {
    const { db, catalog } = await buildCatalog();
    await expect(catalog.importPreview(importInput([], { columnMap: { code: 'code' } })))
      .rejects.toMatchObject({ kind: 'invalid', message: 'Choose the column that holds the test name. It is required.' });
    const many = Array.from({ length: 5001 }, (_, i) => [`T${i}`, `Test ${i}`, '', '', '', '']);
    await expect(catalog.importPreview(importInput(many)))
      .rejects.toMatchObject({ kind: 'invalid', message: 'The file has 5001 rows under its header. The limit is 5000.' });
    await markCentral(db);
    await expect(catalog.importPreview(importInput([]))).rejects.toMatchObject({ kind: 'central-managed' });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: the eight new tests FAIL with `readCatalogImportFile is not a function` or `catalog.importPreview is not a function`. Every S1 and S2 test still PASSES.

- [ ] **Step 3: Add the import types and the file read**

In `packages/bootstrap/src/test-catalog.ts`, add below the existing imports:

```ts
import { readTableFile, TableFileError, type TableFileFormat } from './table-file';
import {
  CATALOG_IMPORT_MAX_BYTES, CATALOG_IMPORT_MAX_ROWS, checkColumnMap, matchCategory, matchSpecimen,
  readCatalogRows, splitSpecimens, suggestCatalogColumns, valueKey,
  type CatalogColumnMap, type CatalogValueMap, type CategoryAnswer,
} from './test-catalog-import';
```

Below `const LOINC_CODE = /^\d{1,7}-\d$/;` add:

```ts
/** An import looks its LOINC codes up in batches, so thousands of rows cost a few queries. */
const LOINC_LOOKUP_CHUNK = 1000;
```

Directly below the `CatalogOptions` interface add:

```ts
/** A file read for import: its table, and CE's guess at which column feeds which field. */
export interface CatalogImportFile {
  headers: string[];
  rows: string[][];
  sheetName: string | null;
  sheetCount: number;
  suggested: CatalogColumnMap;
}

/** One import step. The studio sends the table back with each one, so the server keeps nothing between steps. */
export interface CatalogImportInput {
  table: { headers: string[]; rows: string[][] };
  columnMap: CatalogColumnMap;
  valueMap?: CatalogValueMap;
}

export interface CatalogImportRefusal {
  /** The spreadsheet row. The header is row 1. */
  line: number;
  code: string | null;
  reason: string;
}

/** File text that matched nothing in a list, and how many rows use it. */
export interface CatalogUnmatchedValue {
  text: string;
  rows: number;
}

/** What an import will do (preview) or did (apply). Both are worked out by the same code. */
export interface CatalogImportReport {
  counts: { new: number; changed: number; unchanged: number; refused: number };
  refused: CatalogImportRefusal[];
  /** Every text that matched nothing on its own, answered or not, so the Values step can list it. */
  unmatched: { categories: CatalogUnmatchedValue[]; specimens: CatalogUnmatchedValue[] };
  /** The new categories the operator named that a written test uses. */
  categoriesToAdd: Array<{ code: string; display: string }>;
  /** false when LOINC is not loaded here, so LOINC codes were checked for their format only. */
  loincChecked: boolean;
}
```

Directly below the `TestCatalogError` class add:

```ts
/**
 * Read an uploaded file for import. The route and `openldr test-catalog import` both call this, so they
 * refuse the same files in the same words.
 */
export function readCatalogImportFile(bytes: Uint8Array, format: TableFileFormat): CatalogImportFile {
  try {
    const table = readTableFile(bytes, format, { maxBytes: CATALOG_IMPORT_MAX_BYTES, maxRows: CATALOG_IMPORT_MAX_ROWS });
    return { ...table, suggested: suggestCatalogColumns(table.headers) };
  } catch (err) {
    if (err instanceof TableFileError) throw new TestCatalogError(err.message, 'invalid');
    throw err;
  }
}
```

In the `TestCatalog` interface, add after `setActive`:

```ts
  importPreview(input: CatalogImportInput): Promise<CatalogImportReport>;
```

Directly below the `ValidTest` type add:

```ts
/** What checkTest needs from the database. An import reads it once for every row. */
interface CheckContext {
  categories: CatalogSpecimenOption[];
  specimens: CatalogSpecimenOption[];
  loincLoaded: boolean;
  /** The LOINC codes asked about that LOINC holds as more than a DRAFT stub. */
  knownLoinc: Set<string>;
}

/** A row the import will write. */
interface PlannedWrite {
  code: string;
  test: ValidTest;
  /** The stored properties, so keys this catalog does not manage survive. Null for a new test. */
  stored: unknown;
  /** The LOINC code linked before the import. */
  loincBefore: string | null;
}

/** Status is not compared: an import never changes it. */
function sameTest(a: CatalogTest, b: ValidTest): boolean {
  return a.display === b.display && a.shortName === b.shortName && a.category === b.category && a.loinc === b.loinc
    && a.specimenTypes.map(codingKey).join('\n') === b.specimenTypes.map(codingKey).join('\n');
}
```

- [ ] **Step 4: Turn validate into checkTest over a context loaded once**

Inside `createTestCatalog`, delete the `expandCodes` function. Replace the `checkLoinc` and `validate` functions with:

```ts
  /**
   * The rules every write shares: create, update and each import row. It reads nothing, so an import
   * checks thousands of rows against one read of the lists. `linked` is the LOINC code the test already
   * has. It was checked when it was linked, so a row that keeps it is not checked again.
   */
  function checkTest(input: CatalogTestInput, ctx: CheckContext, linked: string | null = null): ValidTest {
    const display = clean(input.display);
    if (!display) throw invalid('A test needs a name.');
    const category = clean(input.category);
    if (category && !ctx.categories.some((c) => c.code === category)) {
      throw invalid(`Category ${category} is not in the test category list.`);
    }
    const specimenTypes = uniqueCodings(input.specimenTypes ?? []);
    const offered = new Set(ctx.specimens.map(codingKey));
    const missing = specimenTypes.find((s) => !offered.has(codingKey(s)));
    if (missing) throw invalid(`Specimen ${missing.code} (${missing.system}) is not in the specimen type list.`);
    const loinc = clean(input.loinc);
    if (loinc && loinc !== linked) {
      if (!LOINC_CODE.test(loinc)) throw invalid(`"${loinc}" is not a LOINC code. LOINC codes look like 12345-6.`);
      // With no LOINC loaded, only the format can be checked.
      if (ctx.loincLoaded && !ctx.knownLoinc.has(loinc)) {
        throw invalid(`LOINC code ${loinc} is not in the LOINC loaded on this install.`);
      }
    }
    return { display, shortName: clean(input.shortName), category, specimenTypes, loinc, active: input.active ?? true };
  }

  async function loadCheckContext(loincCodes: string[]): Promise<CheckContext> {
    const [categories, specimens, loaded] = await Promise.all([
      expandEntries(TEST_CATEGORY_VALUE_SET), expandEntries(SPECIMEN_TYPE_VALUE_SET), loincLoaded(),
    ]);
    const knownLoinc = new Set<string>();
    const wanted = [...new Set(loincCodes.filter((c) => LOINC_CODE.test(c)))];
    if (loaded) {
      for (let i = 0; i < wanted.length; i += LOINC_LOOKUP_CHUNK) {
        const found = await db.selectFrom('terminology_concepts').select('code')
          .where('system', '=', LOINC_SYSTEM)
          .where('code', 'in', wanted.slice(i, i + LOINC_LOOKUP_CHUNK))
          // A DRAFT row is the stub an earlier link left, not a loaded code.
          .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'DRAFT')]))
          .execute();
        for (const f of found) knownLoinc.add(f.code);
      }
    }
    return { categories, specimens, loincLoaded: loaded, knownLoinc };
  }

  async function validate(input: CatalogTestInput): Promise<ValidTest> {
    const loinc = clean(input.loinc);
    return checkTest(input, await loadCheckContext(loinc ? [loinc] : []));
  }
```

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts -t "test catalog: writes" --testTimeout 30000`

Expected: every S1 write test PASSES. This is the refactor's own check: create and update refuse in exactly the old words.

- [ ] **Step 5: Plan an import**

Inside `createTestCatalog`, directly above `return {`, add:

```ts
  /**
   * The new categories the operator named, checked. A bad one stops the whole step, because it is the
   * operator's own answer and they can fix it on the Values step.
   */
  async function newCategories(answers: CategoryAnswer[]): Promise<Array<{ code: string; display: string }>> {
    const taken = new Set((await db.selectFrom('terminology_concepts').select('code')
      .where('system', '=', TEST_CATEGORY_SYSTEM).execute()).map((r) => r.code));
    const added = new Map<string, string>();
    for (const a of answers) {
      if (a.kind !== 'new') continue;
      const code = a.code.trim();
      const display = a.display.trim();
      if (!code) throw invalid(`The new category for "${a.text}" needs a code.`);
      if (!display) throw invalid(`The new category ${code} needs a name.`);
      // Checked against every concept in the category system, a retired one included, because the
      // insert would collide with it.
      if (taken.has(code)) throw invalid(`Category ${code} already exists. Choose it instead of adding it.`);
      const seen = added.get(code);
      if (seen !== undefined && seen !== display) throw invalid(`Category ${code} is added twice, with two names.`);
      added.set(code, display);
    }
    return [...added].map(([code, display]) => ({ code, display })).sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Work out what an import does, row by row, writing nothing. The preview returns the report; the apply
   * runs this again and writes the plan, so it never trusts what an earlier preview said.
   */
  async function planImport(input: CatalogImportInput): Promise<{ report: CatalogImportReport; writes: PlannedWrite[] }> {
    await refuseUnlessOwned();
    const { table, columnMap } = input;
    if (table.rows.length > CATALOG_IMPORT_MAX_ROWS) {
      throw invalid(`The file has ${table.rows.length} rows under its header. The limit is ${CATALOG_IMPORT_MAX_ROWS}.`);
    }
    const mapProblem = checkColumnMap(columnMap, table.headers);
    if (mapProblem) throw invalid(mapProblem);
    const rows = readCatalogRows(table, columnMap);

    const tests = new Map((await readTests()).map((t) => [t.code, t]));
    const storedByCode = new Map((await db.selectFrom('terminology_concepts').select(['code', 'properties'])
      .where('system', '=', TEST_CATALOG_SYSTEM).execute()).map((r) => [r.code, r.properties as unknown]));
    const ctx = await loadCheckContext(rows.flatMap((r) => (r.values.loinc ? [r.values.loinc] : [])));
    const answers = input.valueMap ?? { categories: [], specimens: [] };
    const toAdd = await newCategories(answers.categories);
    // A row may use a category this import adds.
    const rowCtx: CheckContext = {
      ...ctx,
      categories: [...ctx.categories, ...toAdd.map((c) => ({ system: TEST_CATEGORY_SYSTEM, code: c.code, display: c.display }))],
    };
    const categoryAnswers = new Map(answers.categories
      .filter((a) => a.code.trim() !== '')
      .map((a) => [valueKey(a.text), a.code.trim()]));
    const specimenAnswers = new Map(answers.specimens.map((a) => [valueKey(a.text), { system: a.system, code: a.code }]));

    const unmatchedCategories = new Map<string, CatalogUnmatchedValue>();
    const unmatchedSpecimens = new Map<string, CatalogUnmatchedValue>();
    const tally = (into: Map<string, CatalogUnmatchedValue>, text: string): void => {
      const seen = into.get(valueKey(text));
      if (seen) seen.rows += 1;
      else into.set(valueKey(text), { text, rows: 1 });
    };

    const report: CatalogImportReport = {
      counts: { new: 0, changed: 0, unchanged: 0, refused: 0 },
      refused: [],
      unmatched: { categories: [], specimens: [] },
      categoriesToAdd: [],
      loincChecked: ctx.loincLoaded,
    };
    const writes: PlannedWrite[] = [];
    const firstLine = new Map<string, number>();

    for (const { line, values: v } of rows) {
      // A test with no national code takes its LOINC code, as create does.
      const code = v.code || v.loinc || null;
      if (!code) {
        report.refused.push({ line, code: null, reason: 'A test needs a national code or a LOINC code.' });
        continue;
      }
      const first = firstLine.get(code);
      if (first !== undefined) {
        report.refused.push({ line, code, reason: `Test ${code} is already on row ${first} of this file.` });
        continue;
      }
      firstLine.set(code, line);

      const problems: string[] = [];
      // undefined means the column is not mapped, so the test keeps what it has (decision 4).
      let category: string | null | undefined;
      if (v.category !== undefined) {
        category = v.category === '' ? null : matchCategory(v.category, ctx.categories);
        if (v.category !== '' && category === null) {
          tally(unmatchedCategories, v.category);
          category = categoryAnswers.get(valueKey(v.category)) ?? null;
          if (category === null) problems.push(`Category "${v.category}" is not in the test category list. Choose a category for it.`);
        }
      }
      let specimenTypes: SpecimenCoding[] | undefined;
      if (v.specimenTypes !== undefined) {
        specimenTypes = [];
        for (const text of splitSpecimens(v.specimenTypes)) {
          let hit = matchSpecimen(text, ctx.specimens);
          if (!hit) {
            tally(unmatchedSpecimens, text);
            hit = specimenAnswers.get(valueKey(text)) ?? null;
          }
          if (hit) specimenTypes.push(hit);
          else problems.push(`Specimen "${text}" is not in the specimen type list. Choose a specimen for it.`);
        }
      }
      if (problems.length) {
        report.refused.push({ line, code, reason: problems.join(' ') });
        continue;
      }

      const before = tests.get(code);
      // A mapped column is authoritative, so an empty cell clears the field. An unmapped one is left alone.
      const merged: CatalogTestInput = {
        display: v.name ?? '',
        shortName: v.shortName !== undefined ? v.shortName : before?.shortName ?? null,
        category: category !== undefined ? category : before?.category ?? null,
        specimenTypes: specimenTypes ?? before?.specimenTypes ?? [],
        loinc: v.loinc !== undefined ? v.loinc : before?.loinc ?? null,
        // An import never retires or restores a test. Retiring is always explicit (spec 4.4).
        active: before?.active ?? true,
      };
      let test: ValidTest;
      try {
        test = checkTest(merged, rowCtx, before?.loinc ?? null);
      } catch (err) {
        if (!(err instanceof TestCatalogError)) throw err;
        report.refused.push({ line, code, reason: err.message });
        continue;
      }
      if (!before) {
        report.counts.new += 1;
        writes.push({ code, test, stored: null, loincBefore: null });
      } else if (sameTest(before, test)) {
        report.counts.unchanged += 1;
      } else {
        report.counts.changed += 1;
        writes.push({ code, test, stored: storedByCode.get(code) ?? null, loincBefore: before.loinc });
      }
    }

    report.counts.refused = report.refused.length;
    const byText = (a: CatalogUnmatchedValue, b: CatalogUnmatchedValue): number => a.text.localeCompare(b.text);
    report.unmatched = {
      categories: [...unmatchedCategories.values()].sort(byText),
      specimens: [...unmatchedSpecimens.values()].sort(byText),
    };
    // Only a new category a written test uses is added.
    report.categoriesToAdd = toAdd.filter((c) => writes.some((w) => w.test.category === c.code));
    return { report, writes };
  }

  async function importPreview(input: CatalogImportInput): Promise<CatalogImportReport> {
    return (await planImport(input)).report;
  }
```

Add `importPreview,` to the object `createTestCatalog` returns, after `setActive,`.

- [ ] **Step 6: Export the new names**

In `packages/bootstrap/src/index.ts`, replace the `export { ... } from './test-catalog';` block at `:1746-1752` with:

```ts
export {
  createTestCatalog, parseCatalogListQuery, catalogChangeAction, readCatalogImportFile, TestCatalogError,
  TEST_CATALOG_SYSTEM, TEST_CATEGORY_SYSTEM, TEST_CATEGORY_VALUE_SET, SPECIMEN_TYPE_VALUE_SET,
  type TestCatalog, type CatalogTest, type CatalogTestInput, type CatalogListQuery, type CatalogListResult,
  type LabSettingsInput, type SpecimenCoding,
  type CatalogOptions, type CatalogCategoryOption, type CatalogSpecimenOption,
  type CatalogImportFile, type CatalogImportInput, type CatalogImportReport, type CatalogImportRefusal,
  type CatalogUnmatchedValue,
} from './test-catalog';
export {
  CATALOG_IMPORT_FIELDS, CATALOG_IMPORT_MAX_BYTES, CATALOG_IMPORT_MAX_ROWS,
  catalogColumnMapSchema, catalogValueMapSchema, catalogImportInputSchema,
  type CatalogImportField, type CatalogColumnMap, type CatalogValueMap, type CategoryAnswer, type SpecimenAnswer,
} from './test-catalog-import';
export type { TableFileFormat } from './table-file';
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: PASS, every test in the file, the eight new ones included.

- [ ] **Step 8: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s3-t4-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 9: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): preview a test catalog import" -m "importPreview works out what an import would do, row by row, and writes nothing: new, changed, unchanged and refused rows with each reason, the category and specimen text that matched nothing, and the categories it would add. A mapped column is authoritative and an unmapped one is left alone. Status is never changed. The row rules are now one function, checkTest, over lists read once, so create, update and the import refuse a test in the same words. readCatalogImportFile reads the uploaded file for both the route and the CLI."
```

---

### Task 5: apply an import in one transaction, and export the catalog

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts`
- Modify: `packages/bootstrap/src/test-catalog.test.ts`

**Interfaces:**
- Consumes: `planImport`, `PlannedWrite` (Task 4); `termMappings.saveExclusive(input, { trx })` and `termMappings.update(id, input, { trx })` (Task 1); `CATALOG_EXPORT_COLUMNS`, `catalogExportRow` (Task 3); `toCsv` from `@openldr/reporting`.
- Produces: `TestCatalog.importApply(input: CatalogImportInput): Promise<CatalogImportReport>` and `TestCatalog.exportCsv(): Promise<string>`.

The apply runs `planImport` again from the table, then writes the plan in one `db.transaction()`: the new categories, each test, and each LOINC link change. `markTerminologyChanged` opens its own transaction, so the two sync signals follow the commit. A plan with nothing to write opens no transaction and sends no signal.

- [ ] **Step 1: Write the failing tests**

In `packages/bootstrap/src/test-catalog.test.ts`, change the first line to:

```ts
import { describe, it, expect, vi } from 'vitest';
```

and add `TEST_CATEGORY_SYSTEM` to the import from `./test-catalog`, after `TEST_CATALOG_SYSTEM`.

Append at the end of the file:

```ts
describe('test catalog: import apply and export', () => {
  it('writes the rows it can, skips refused ones, and opens one transaction for all of them', async () => {
    const { db, catalog } = await buildCatalog();
    const opened = vi.spyOn(db, 'transaction');
    const report = await catalog.importApply(importInput([
      ['HIVVL', 'HIV viral load', 'VL', '25836-8', 'Virology', 'Blood'],
      ['CD4', 'CD4 count', '', '24467-3', 'HAEM', 'blood; urine'],
      ['', 'No code', '', '', '', ''],
    ], { valueMap: { categories: [{ text: 'Virology', kind: 'new', code: 'VIRO', display: 'Virology' }], specimens: [] } }));

    expect(report.counts).toEqual({ new: 2, changed: 0, unchanged: 0, refused: 1 });
    expect(report.categoriesToAdd).toEqual([{ code: 'VIRO', display: 'Virology' }]);
    // The import's own transaction, then one sync signal for the catalog and one for the categories.
    // A LOINC link that opened a transaction of its own would make this 5.
    expect(opened).toHaveBeenCalledTimes(3);
    expect(await catalog.get('HIVVL')).toMatchObject({
      shortName: 'VL', loinc: '25836-8', category: 'VIRO', specimenTypes: [BLD], active: true,
    });
    expect(await catalog.get('CD4')).toMatchObject({ loinc: '24467-3', category: 'HAEM', specimenTypes: [BLD, UR] });
    // The category ValueSet includes its whole system, so the new category is offered at once.
    expect((await catalog.options()).categories.map((c) => c.code)).toContain('VIRO');
    expect(await catalogGeneration(db)).toBe(1);
    const categories = await db.selectFrom('terminology_systems').select('generation')
      .where('url', '=', TEST_CATEGORY_SYSTEM).executeTakeFirstOrThrow();
    expect(Number(categories.generation)).toBe(1);
  });

  it('clears a field whose mapped cell is empty, and leaves an unmapped one alone', async () => {
    const { admin, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
    const report = await catalog.importApply({
      table: { headers: ['code', 'name', 'short_name', 'loinc'], rows: [['HIVVL', 'HIV viral load', '', '']] },
      columnMap: { code: 'code', name: 'name', shortName: 'short_name', loinc: 'loinc' },
    });
    expect(report.counts.changed).toBe(1);
    expect(await catalog.get('HIVVL')).toMatchObject({ shortName: null, loinc: null, category: 'MOL', specimenTypes: [BLD] });
    const links = await admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, 'HIVVL');
    expect(links.filter((m) => m.isActive)).toEqual([]);
  });

  it('never changes a test status or this lab settings', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await catalog.setEnabled('HIVVL', true);
    await catalog.setActive('HIVVL', false);
    await catalog.importApply(importInput([['HIVVL', 'HIV-1 viral load', '', '', '', '']]));
    expect(await catalog.get('HIVVL')).toMatchObject({ display: 'HIV-1 viral load', active: false, lab: { enabled: true } });
  });

  it('changes nothing, and signals nothing, when the same file is applied twice', async () => {
    const { db, catalog } = await buildCatalog();
    const file = importInput([
      ['HIVVL', 'HIV viral load', 'VL', '25836-8', 'MOL', 'Blood'],
      ['CD4', 'CD4 count', '', '', 'HAEM', ''],
    ]);
    await catalog.importApply(file);
    const generation = await catalogGeneration(db);
    const opened = vi.spyOn(db, 'transaction');
    expect((await catalog.importApply(file)).counts).toEqual({ new: 0, changed: 0, unchanged: 2, refused: 0 });
    expect(opened).not.toHaveBeenCalled();
    expect(await catalogGeneration(db)).toBe(generation);
  });

  it('exports the active tests in the import layout, and the export imports back unchanged', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD, UR], loinc: '25836-8' });
    await catalog.create({ code: 'CD4', display: 'CD4 count, absolute', category: 'HAEM' });
    await catalog.create({ code: 'OLD', display: 'Old test' });
    await catalog.setActive('OLD', false);

    const csv = await catalog.exportCsv();
    expect(csv).toBe(
      'code,name,short_name,loinc,category,specimen_types\n'
      + 'CD4,"CD4 count, absolute",,,HAEM,\n'
      + 'HIVVL,HIV viral load,VL,25836-8,MOL,BLD;UR\n',
    );
    const file = readCatalogImportFile(new TextEncoder().encode(csv), 'csv');
    const report = await catalog.importPreview({ table: file, columnMap: file.suggested });
    expect(report.counts).toEqual({ new: 0, changed: 0, unchanged: 2, refused: 0 });
  });

  it('refuses to apply at a lab whose catalog comes from central', async () => {
    const { db, catalog } = await buildCatalog();
    await markCentral(db);
    await expect(catalog.importApply(importInput([['A', 'A', '', '', '', '']]))).rejects.toMatchObject({ kind: 'central-managed' });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts -t "import apply and export" --testTimeout 30000`

Expected: FAIL, six tests, with `catalog.importApply is not a function` or `catalog.exportCsv is not a function`.

- [ ] **Step 3: Write concepts and links on a given transaction**

In `packages/bootstrap/src/test-catalog.ts`:

1. Change the `@openldr/db` import to:

```ts
import {
  markTerminologyChanged, type InternalSchema, type TerminologyAdminStore, type TermMapping, type TermMappingInput,
} from '@openldr/db';
```

2. Add below it:

```ts
import { toCsv } from '@openldr/reporting';
```

3. Add `CATALOG_EXPORT_COLUMNS, catalogExportRow,` to the import from `./test-catalog-import`.

4. Directly below the `sameTest` function add:

```ts
function isLoincLink(m: TermMapping): boolean {
  return m.toSystem === LOINC_SYSTEM && m.mapType === LOINC_MAP_TYPE && m.isActive;
}

function loincLinkInput(code: string, loinc: string): TermMappingInput {
  return {
    fromSystem: TEST_CATALOG_SYSTEM, fromCode: code, toSystem: LOINC_SYSTEM, toCode: loinc,
    toDisplay: null, mapType: LOINC_MAP_TYPE, isActive: true,
  };
}
```

5. Replace the `writeConcept` and `writeLoincLink` functions with:

```ts
  async function writeConceptOn(exec: Kysely<InternalSchema>, code: string, t: ValidTest, stored: unknown): Promise<void> {
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
    await exec.insertInto('terminology_concepts').values({
      system: TEST_CATALOG_SYSTEM, code, display: t.display,
      status: t.active ? 'ACTIVE' : RETIRED_STATUS,
      properties: properties as never,
    }).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
      display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
    }))).execute();
  }

  async function writeConcept(code: string, t: ValidTest, stored: unknown): Promise<void> {
    await writeConceptOn(db, code, t, stored);
    // One terminology_system signal per edit, as terms.create does, so labs pull the change.
    await markTerminologyChanged(db, TEST_CATALOG_SYSTEM);
  }

  async function writeLoincLink(code: string, loinc: string | null): Promise<void> {
    const current = (await deps.admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, code)).find(isLoincLink);
    if (loinc && current?.toCode !== loinc) {
      // saveExclusive keeps one active LOINC link per test and deactivates the old one.
      await deps.admin.termMappings.saveExclusive(loincLinkInput(code, loinc));
    } else if (!loinc && current) {
      const { id, ...rest } = current;
      await deps.admin.termMappings.update(id, { ...rest, isActive: false });
    }
  }
```

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts -t "test catalog: writes" --testTimeout 30000`

Expected: every S1 write test still PASSES.

- [ ] **Step 4: Apply and export**

Directly above `return {` inside `createTestCatalog`, add:

```ts
  async function importApply(input: CatalogImportInput): Promise<CatalogImportReport> {
    const { report, writes } = await planImport(input);
    if (writes.length === 0) return report;

    // The links to switch off are read before the transaction, so every statement inside it runs on it.
    // No row touches another row's link: a code appears once in a plan.
    const unlink = new Map<string, TermMapping>();
    for (const w of writes) {
      if (w.loincBefore === null || w.test.loinc !== null) continue;
      const link = (await deps.admin.termMappings.listOutgoing(TEST_CATALOG_SYSTEM, w.code)).find(isLoincLink);
      if (link) unlink.set(w.code, link);
    }

    // ⛔ One transaction for categories, tests and links (spec 4.4). saveExclusive and update take it,
    // so neither opens one of its own and a failure part way leaves nothing behind.
    await db.transaction().execute(async (trx) => {
      for (const c of report.categoriesToAdd) {
        await trx.insertInto('terminology_concepts').values({
          system: TEST_CATEGORY_SYSTEM, code: c.code, display: c.display, status: 'ACTIVE', properties: null as never,
        }).execute();
      }
      for (const w of writes) {
        await writeConceptOn(trx, w.code, w.test, w.stored);
        if (w.test.loinc !== null && w.test.loinc !== w.loincBefore) {
          await deps.admin.termMappings.saveExclusive(loincLinkInput(w.code, w.test.loinc), { trx });
        } else {
          const link = unlink.get(w.code);
          if (link) {
            const { id, ...rest } = link;
            await deps.admin.termMappings.update(id, { ...rest, isActive: false }, { trx });
          }
        }
      }
    });
    // markTerminologyChanged opens its own transaction, so the signals follow the commit, one per system,
    // as the loaders send them (packages/db/src/terminology-sync.ts). A failed import sends none.
    await markTerminologyChanged(db, TEST_CATALOG_SYSTEM);
    if (report.categoriesToAdd.length) await markTerminologyChanged(db, TEST_CATEGORY_SYSTEM);
    return report;
  }

  async function exportCsv(): Promise<string> {
    // Active tests only, as the page shows by default. Retired tests stay out of a file meant for editing.
    const tests = (await readTests()).filter((t) => t.active);
    return toCsv(CATALOG_EXPORT_COLUMNS, tests.map(catalogExportRow));
  }
```

In the `TestCatalog` interface, add after `importPreview`:

```ts
  importApply(input: CatalogImportInput): Promise<CatalogImportReport>;
  exportCsv(): Promise<string>;
```

Add `importApply,` and `exportCsv,` to the returned object, after `importPreview,`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: PASS, every test in the file. If the first test counts a transaction number other than 3, find which call opened the extra one before changing the number. Only a LOINC link write or a sync signal should.

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s3-t5-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts
git commit -m "feat(bootstrap): apply a test catalog import and export the catalog" -m "importApply works the plan out again from the table, then writes new categories, tests and LOINC link changes in one transaction. The LOINC links join it through the term mapping store's trx option. The catalog and category sync signals follow the commit, once each. Applying the same file twice writes nothing and signals nothing. exportCsv writes the active tests in the import's own layout, so an export imports back with every row unchanged."
```

---

### Task 6: the import and export routes

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts` (add `catalogImportAudit`)
- Modify: `packages/bootstrap/src/index.ts` (export it)
- Modify: `apps/server/src/test-catalog-routes.ts`
- Modify: `apps/server/src/test-catalog-routes.test.ts`

**Interfaces:**
- Consumes: `readCatalogImportFile`, `catalogImportInputSchema`, `CATALOG_IMPORT_MAX_BYTES`, `importPreview`, `importApply`, `exportCsv`.
- Produces:
  - `catalogImportAudit(report: CatalogImportReport): AuditDetails` in `@openldr/bootstrap`, so the route and the CLI record the same entry.
  - `POST /api/test-catalog/import/read?format=csv|xlsx`, raw file body (`application/octet-stream`), answers `CatalogImportFile`. `terminology.manage`.
  - `POST /api/test-catalog/import/preview`, JSON `CatalogImportInput`, answers `CatalogImportReport`. `terminology.manage`, 16 MiB body limit.
  - `POST /api/test-catalog/import/apply`, the same body, answers `CatalogImportReport` and audits `test_catalog.import`. `terminology.manage`, 16 MiB body limit.
  - `GET /api/test-catalog/export`, answers `text/csv; charset=utf-8` with `content-disposition: attachment; filename="test-catalog.csv"`. `terminology.view`.
  - Refusals keep S1's shape: `{ error, kind }` with 400, 404 or 409.

`bodyLimit` does not bound a passthrough parser (`apps/server/src/facilities-routes.ts:120-149`). The read route counts bytes itself and stops one chunk past 5 MiB; `readCatalogImportFile` then refuses that size in its own words.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/test-catalog-routes.test.ts`:

1. Change the bootstrap import to:

```ts
import {
  TestCatalogError, type AppContext, type CatalogImportReport, type CatalogOptions, type CatalogTest,
} from '@openldr/bootstrap';
```

2. Add below `OPTIONS`:

```ts
const REPORT: CatalogImportReport = {
  counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [],
  unmatched: { categories: [], specimens: [] }, categoriesToAdd: [{ code: 'VIRO', display: 'Virology' }], loincChecked: false,
};
```

3. Replace the `fakeCtx` signature line and the `testCatalog` object with:

```ts
type Method = 'list' | 'get' | 'create' | 'update' | 'setLabSettings' | 'options' | 'setEnabled' | 'setActive'
  | 'importPreview' | 'importApply' | 'exportCsv';

function fakeCtx(over: Partial<Record<Method, Impl>> = {}) {
```

```ts
  const testCatalog = {
    list: spy('list', over.list ?? (async () => ({ rows: [TEST], total: 1, ownedHere: true }))),
    get: spy('get', over.get ?? (async (code: string) => (code === 'HIVVL' ? TEST : null))),
    create: spy('create', over.create ?? (async () => TEST)),
    update: spy('update', over.update ?? (async () => TEST)),
    setLabSettings: spy('setLabSettings', over.setLabSettings ?? (async () => TEST)),
    options: spy('options', over.options ?? (async () => OPTIONS)),
    setEnabled: spy('setEnabled', over.setEnabled ?? (async () => TEST)),
    setActive: spy('setActive', over.setActive ?? (async () => TEST)),
    importPreview: spy('importPreview', over.importPreview ?? (async () => REPORT)),
    importApply: spy('importApply', over.importApply ?? (async () => REPORT)),
    exportCsv: spy('exportCsv', over.exportCsv ?? (async () => 'code,name\nHIVVL,HIV viral load\n')),
  };
```

4. Append inside the `describe` block, after its last test:

```ts
  it('POST /import/read reads the raw file and answers its table and suggested columns', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({
      method: 'POST', url: '/api/test-catalog/import/read?format=csv',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('Test code,Test name\nHIVVL,HIV viral load\n'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      headers: ['Test code', 'Test name'], rows: [['HIVVL', 'HIV viral load']], sheetName: null, sheetCount: 1,
      suggested: { code: 'Test code', name: 'Test name' },
    });
    // Reading a file touches no data, so no service call.
    expect(calls).toEqual([]);
  });

  it('POST /import/read refuses a bad format, a body that is not a file, and a file over 5 MB, in words', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx);
    const badFormat = await app.inject({
      method: 'POST', url: '/api/test-catalog/import/read?format=pdf',
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x'),
    });
    expect(badFormat.statusCode).toBe(400);
    expect(badFormat.json()).toEqual({ error: 'format must be "csv" or "xlsx"' });

    const json = await app.inject({ method: 'POST', url: '/api/test-catalog/import/read?format=csv', payload: { a: 1 } });
    expect(json.statusCode).toBe(400);
    expect(json.json()).toEqual({ error: 'Send the file itself as the request body, as application/octet-stream.' });

    const big = await app.inject({
      method: 'POST', url: '/api/test-catalog/import/read?format=csv',
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(5 * 1024 * 1024 + 1, 0x61),
    });
    expect(big.statusCode).toBe(400);
    expect(big.json()).toEqual({ error: 'The file is larger than 5 MB, the limit.', kind: 'invalid' });
  });

  it('import needs terminology.manage, and export needs terminology.view', async () => {
    const { ctx } = fakeCtx();
    const viewer = appWith(ctx, ['terminology.view']);
    const body = { table: { headers: ['name'], rows: [] }, columnMap: { name: 'name' } };
    expect((await viewer.inject({
      method: 'POST', url: '/api/test-catalog/import/read?format=csv',
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('name\nA\n'),
    })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'POST', url: '/api/test-catalog/import/preview', payload: body })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'POST', url: '/api/test-catalog/import/apply', payload: body })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'GET', url: '/api/test-catalog/export' })).statusCode).toBe(200);
  });

  it('POST /import/preview hands the checked body to the service, and refuses a bad one before it', async () => {
    const { ctx, calls } = fakeCtx();
    const app = appWith(ctx);
    const body = { table: { headers: ['code', 'name'], rows: [['A', 'Alpha']] }, columnMap: { code: 'code', name: 'name' } };
    const res = await app.inject({ method: 'POST', url: '/api/test-catalog/import/preview', payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(REPORT);
    expect(calls).toEqual([{ method: 'importPreview', args: [body] }]);

    const bad = await app.inject({
      method: 'POST', url: '/api/test-catalog/import/preview',
      payload: { ...body, columnMap: { name: 'name', notes: 'notes' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('takes an import step body over 1 MB, the Fastify default', async () => {
    const { ctx } = fakeCtx();
    const rows = Array.from({ length: 5000 }, (_, i) => [`T${i}`, 'x'.repeat(300)]);
    const res = await appWith(ctx).inject({
      method: 'POST', url: '/api/test-catalog/import/preview',
      payload: { table: { headers: ['code', 'name'], rows }, columnMap: { code: 'code', name: 'name' } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /import/apply applies, audits the counts and the categories added, and answers the report', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const body = { table: { headers: ['code', 'name'], rows: [['A', 'Alpha']] }, columnMap: { code: 'code', name: 'name' } };
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/test-catalog/import/apply', payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(REPORT);
    expect(calls).toEqual([{ method: 'importApply', args: [body] }]);
    expect(audit).toMatchObject([{
      action: 'test_catalog.import', entityType: 'test_catalog', entityId: 'urn:openldr:codesystem:test-catalog',
      metadata: { counts: REPORT.counts, categoriesAdded: ['VIRO'] },
    }]);
  });

  it('POST /import/apply keeps a refusal words and audits nothing', async () => {
    const { ctx, audit } = fakeCtx({
      importApply: async () => { throw new TestCatalogError('This catalog comes from central.', 'central-managed'); },
    });
    const res = await appWith(ctx).inject({
      method: 'POST', url: '/api/test-catalog/import/apply',
      payload: { table: { headers: ['name'], rows: [] }, columnMap: { name: 'name' } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'This catalog comes from central.', kind: 'central-managed' });
    expect(audit).toEqual([]);
  });

  it('GET /export answers the CSV as a download', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="test-catalog.csv"');
    expect(res.body).toBe('code,name\nHIVVL,HIV viral load\n');
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: the eight new tests FAIL with 404 (no such route) or on `catalogImportAudit` being missing. The S1 and S2 route tests still PASS.

- [ ] **Step 3: Add the shared audit entry**

In `packages/bootstrap/src/test-catalog.ts`, add below the existing imports:

```ts
import type { AuditDetails } from './record-audit';
```

and directly below `catalogChangeAction` add:

```ts
/** The audit entry for an applied import. The route and the CLI both record it, so they must agree. */
export function catalogImportAudit(report: CatalogImportReport): AuditDetails {
  return {
    action: 'test_catalog.import', entityType: 'test_catalog', entityId: TEST_CATALOG_SYSTEM,
    metadata: { counts: report.counts, categoriesAdded: report.categoriesToAdd.map((c) => c.code) },
  };
}
```

In `packages/bootstrap/src/index.ts`, add `catalogImportAudit,` after `catalogChangeAction,` in the `./test-catalog` export block.

- [ ] **Step 4: Add the routes**

In `apps/server/src/test-catalog-routes.ts`, replace the bootstrap import with:

```ts
import {
  catalogChangeAction, catalogImportAudit, catalogImportInputSchema, parseCatalogListQuery, readCatalogImportFile,
  CATALOG_IMPORT_MAX_BYTES, TestCatalogError, type AppContext,
} from '@openldr/bootstrap';
```

Below `const MANAGE = ...` add:

```ts
// An import step sends the whole table back, up to 5,000 rows, which passes Fastify's 1 MiB default.
const IMPORT_STEP = { ...MANAGE, bodyLimit: 16 * 1024 * 1024 };
const importFormat = z.enum(['csv', 'xlsx']);
```

Below `replyCatalogError` add:

```ts
/**
 * The uploaded file's bytes, or null when the body is not a file. `bodyLimit` does not bound a
 * passthrough parser (facilities-routes.ts, MAX_UPLOAD_BYTES), so the count happens here. Reading stops
 * one chunk past the limit, and readCatalogImportFile refuses that size in its own words.
 */
async function readUpload(body: unknown): Promise<Buffer | null> {
  if (!body || typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator] !== 'function') return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > CATALOG_IMPORT_MAX_BYTES) break;
  }
  return Buffer.concat(chunks);
}
```

At the top of `registerTestCatalogRoutes`, before the first route, add:

```ts
  // The upload arrives as raw bytes. terminology-admin-routes.ts registers this parser first on the same
  // app, and a second registration throws, so it is guarded as in facilities-routes.ts.
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_req: unknown, payload: unknown, done: (e: null, b: unknown) => void) => done(null, payload));
  }
```

At the end of `registerTestCatalogRoutes`, after the `/active` route, add:

```ts
  // Import step 1: read the file. Nothing is stored. The table goes back to the studio, which sends it
  // with each later step, so the server keeps no state between steps.
  app.post('/api/test-catalog/import/read', MANAGE, async (req, reply) => {
    const format = importFormat.safeParse((req.query as Record<string, unknown>).format);
    if (!format.success) return reply.code(400).send({ error: 'format must be "csv" or "xlsx"' });
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'Send the file itself as the request body, as application/octet-stream.' });
    try {
      return reply.send(readCatalogImportFile(bytes, format.data));
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.post('/api/test-catalog/import/preview', IMPORT_STEP, async (req, reply) => {
    const parsed = catalogImportInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return reply.send(await ctx.testCatalog.importPreview(parsed.data));
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  // `openldr test-catalog import --apply` calls the same service method and records the same entry.
  app.post('/api/test-catalog/import/apply', IMPORT_STEP, async (req, reply) => {
    const parsed = catalogImportInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const report = await ctx.testCatalog.importApply(parsed.data);
      await recordAudit(ctx, req, catalogImportAudit(report));
      return reply.send(report);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.get('/api/test-catalog/export', VIEW, async (_req, reply) => {
    const csv = await ctx.testCatalog.exportCsv();
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="test-catalog.csv"')
      .send(csv);
  });
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

- [ ] **Step 6: Typecheck and lint**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s3-t6-tc-b.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx tsc --noEmit -p . > "$TEMP/s3-t6-tc-s.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src/test-catalog-routes.ts > "$TEMP/s3-t6-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` three times. The lint holds the `return reply.send` rule.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/index.ts apps/server/src/test-catalog-routes.ts apps/server/src/test-catalog-routes.test.ts
git commit -m "feat(server): test catalog import and export routes" -m "POST /api/test-catalog/import/read takes the raw file and answers its table with the suggested columns, counting bytes itself because bodyLimit does not bound a passthrough parser. /import/preview and /import/apply take the table back with the column and value maps, up to 16 MiB. Apply audits test_catalog.import with the counts and the categories added, through catalogImportAudit, which the CLI shares. GET /export answers the catalog as a CSV download. Import needs terminology.manage; export needs terminology.view."
```

---

### Task 7: `openldr test-catalog import` and `export`

**Files:**
- Modify: `packages/cli/src/test-catalog.ts`
- Create: `packages/cli/src/test-catalog-import.test.ts`
- Modify: `packages/cli/src/test-catalog-cli-parsing.test.ts`
- Modify: `packages/cli/src/program.ts:36` and after `:363`

**Interfaces:**
- Consumes: `readCatalogImportFile`, `catalogColumnMapSchema`, `catalogValueMapSchema`, `catalogImportAudit`, `importPreview`, `importApply`, `exportCsv`.
- Produces:
  - `interface TestCatalogImportOpts { apply: boolean; columnMap?: string; valueMap?: string; json: boolean }`
  - `runTestCatalogImport(path: string, opts: TestCatalogImportOpts): Promise<number>`
  - `runTestCatalogExport(opts: { out?: string }): Promise<number>`
  - Commands: `openldr test-catalog import <file> [--apply] [--column-map <file>] [--value-map <file>] [--json]` and `openldr test-catalog export [--out <file>]`.

Import previews unless `--apply` is given, as spec 4.6 names it. The format comes from the file's extension. Without `--column-map`, the suggested map is used. Both map files are checked with the same zod schemas as the route. File problems are refused before the app context opens, so a typo costs no database connection.

`packages/cli/src/facilities.ts` has a private `readJsonFile`. This task does not reuse or move it. The catalog's reader also checks each file against a schema, and importing `facilities.ts` would pull the facility command module, and every bootstrap name it uses, into this one. The CLI tests mock `@openldr/bootstrap` with a short list of names, so that import would break them.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/test-catalog-import.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  createAppContext: vi.fn(),
  importPreview: vi.fn(),
  importApply: vi.fn(),
  exportCsv: vi.fn(),
  close: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));
vi.mock('./cli-actor', () => ({ cliActor: () => ({ actorType: 'cli', actorId: null, actorName: 'tester' }) }));

// Partial: the file reader, the schemas and the audit entry stay real, so the CLI is checked against
// the route's own rules.
vi.mock('@openldr/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return {
    createAppContext: mocks.createAppContext,
    recordAuditEvent: mocks.recordAuditEvent,
    parseCatalogListQuery: actual.parseCatalogListQuery,
    catalogChangeAction: actual.catalogChangeAction,
    catalogImportAudit: actual.catalogImportAudit,
    catalogColumnMapSchema: actual.catalogColumnMapSchema,
    catalogValueMapSchema: actual.catalogValueMapSchema,
    readCatalogImportFile: actual.readCatalogImportFile,
    TestCatalogError: actual.TestCatalogError,
  };
});

import { TestCatalogError } from '@openldr/bootstrap';
import { runTestCatalogExport, runTestCatalogImport } from './test-catalog';

const REPORT = {
  counts: { new: 1, changed: 1, unchanged: 3, refused: 1 },
  refused: [{ line: 5, code: 'X1', reason: 'Specimen "Plasma" is not in the specimen type list. Choose a specimen for it.' }],
  unmatched: { categories: [{ text: 'Virology', rows: 2 }], specimens: [{ text: 'Plasma', rows: 1 }] },
  categoriesToAdd: [{ code: 'VIRO', display: 'Virology' }],
  loincChecked: false,
};

describe('openldr test-catalog import and export', () => {
  let dir: string;
  let out: string[];
  let err: string[];

  const file = (name: string, text: string): string => {
    const path = join(dir, name);
    writeFileSync(path, text, 'utf8');
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'catalog-cli-'));
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    mocks.importPreview.mockResolvedValue(REPORT);
    mocks.importApply.mockResolvedValue(REPORT);
    mocks.close.mockResolvedValue(undefined);
    mocks.createAppContext.mockResolvedValue({
      testCatalog: { importPreview: mocks.importPreview, importApply: mocks.importApply, exportCsv: mocks.exportCsv },
      close: mocks.close,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it('previews by default with the suggested columns, and writes and audits nothing', async () => {
    const path = file('tests.csv', 'Test code,Test name\nHIVVL,HIV viral load\n');
    expect(await runTestCatalogImport(path, { apply: false, json: false })).toBe(0);
    expect(mocks.importPreview).toHaveBeenCalledWith({
      table: { headers: ['Test code', 'Test name'], rows: [['HIVVL', 'HIV viral load']] },
      columnMap: { code: 'Test code', name: 'Test name' },
    });
    expect(mocks.importApply).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(out.join('')).toBe([
      'Preview only. Nothing was written. Run again with --apply to write it.',
      'new 1, changed 1, unchanged 3, refused 1',
      'LOINC is not loaded here, so LOINC codes were checked for their format only.',
      'Categories to add: VIRO (Virology)',
      'Category text with no match: "Virology" (2 rows)',
      'Specimen text with no match: "Plasma" (1 row)',
      'Refused:',
      '  row 5, X1: Specimen "Plasma" is not in the specimen type list. Choose a specimen for it.',
      '',
    ].join('\n'));
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('--apply writes, audits as the CLI, and reads the --column-map and --value-map files', async () => {
    const path = file('tests.csv', 'Test code,Test name\nHIVVL,HIV viral load\n');
    const columnMap = { code: 'Test code', name: 'Test name' };
    const valueMap = { categories: [{ text: 'Virology', kind: 'new', code: 'VIRO', display: 'Virology' }], specimens: [] };
    expect(await runTestCatalogImport(path, {
      apply: true, json: false,
      columnMap: file('cols.json', JSON.stringify(columnMap)),
      valueMap: file('vals.json', JSON.stringify(valueMap)),
    })).toBe(0);
    expect(mocks.importApply).toHaveBeenCalledWith({
      table: { headers: ['Test code', 'Test name'], rows: [['HIVVL', 'HIV viral load']] }, columnMap, valueMap,
    });
    expect(out[0]).toBe('Applied.\n');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      { actorType: 'cli', actorId: null, actorName: 'tester' },
      {
        action: 'test_catalog.import', entityType: 'test_catalog', entityId: 'urn:openldr:codesystem:test-catalog',
        metadata: { counts: REPORT.counts, categoriesAdded: ['VIRO'] },
      },
    );
  });

  it('prints the report as JSON with --json', async () => {
    const path = file('tests.csv', 'name\nA\n');
    await runTestCatalogImport(path, { apply: false, json: true });
    expect(JSON.parse(out.join(''))).toEqual(REPORT);
  });

  it('refuses a file or map it cannot use, in words, without opening the app', async () => {
    const txt = file('tests.txt', 'name\nA\n');
    expect(await runTestCatalogImport(txt, { apply: false, json: false })).toBe(1);
    expect(err.join('')).toBe(`test-catalog import failed: ${txt} must end in .csv or .xlsx\n`);

    err.length = 0;
    const notXlsx = file('tests.xlsx', 'name\nA\n');
    expect(await runTestCatalogImport(notXlsx, { apply: false, json: false })).toBe(1);
    expect(err.join('')).toBe('test-catalog import failed: The file is not an Excel workbook (.xlsx).\n');

    err.length = 0;
    const csv = file('tests.csv', 'name\nA\n');
    const badMap = file('vals.json', JSON.stringify({ categories: [{ text: 'Virology', kind: 'new', code: 'VIRO' }], specimens: [] }));
    expect(await runTestCatalogImport(csv, { apply: false, json: false, valueMap: badMap })).toBe(1);
    expect(err.join('')).toBe(`test-catalog import failed: --value-map ${badMap}: categories.0.display Required\n`);

    err.length = 0;
    const notJson = file('cols.json', '{ nope');
    expect(await runTestCatalogImport(csv, { apply: false, json: false, columnMap: notJson })).toBe(1);
    expect(err.join('')).toBe(`test-catalog import failed: --column-map ${notJson} is not valid JSON\n`);

    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });

  it('reports a service refusal and still closes the context', async () => {
    mocks.importPreview.mockRejectedValue(new TestCatalogError('This catalog comes from central.', 'central-managed'));
    const path = file('tests.csv', 'name\nA\n');
    expect(await runTestCatalogImport(path, { apply: false, json: false })).toBe(1);
    expect(err.join('')).toBe('test-catalog import failed: This catalog comes from central.\n');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('export writes the CSV to standard output, or to --out', async () => {
    mocks.exportCsv.mockResolvedValue('code,name\nHIVVL,HIV viral load\n');
    expect(await runTestCatalogExport({})).toBe(0);
    expect(out.join('')).toBe('code,name\nHIVVL,HIV viral load\n');

    out.length = 0;
    const target = join(dir, 'catalog.csv');
    expect(await runTestCatalogExport({ out: target })).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe('code,name\nHIVVL,HIV viral load\n');
    expect(out.join('')).toBe(`Wrote ${target}.\n`);
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
});
```

In `packages/cli/src/test-catalog-cli-parsing.test.ts`, replace the `mocks` and `vi.mock` blocks with:

```ts
const mocks = vi.hoisted(() => ({
  runTestCatalogList: vi.fn().mockResolvedValue(0),
  runTestCatalogChange: vi.fn().mockResolvedValue(0),
  runTestCatalogImport: vi.fn().mockResolvedValue(0),
  runTestCatalogExport: vi.fn().mockResolvedValue(0),
}));

vi.mock('./test-catalog', () => ({
  runTestCatalogList: mocks.runTestCatalogList,
  runTestCatalogChange: mocks.runTestCatalogChange,
  runTestCatalogImport: mocks.runTestCatalogImport,
  runTestCatalogExport: mocks.runTestCatalogExport,
}));
```

and append inside its `describe` block:

```ts
  it('hands import its file and flags, and export its --out', async () => {
    await buildProgram().exitOverride().parseAsync([
      'node', 'openldr', 'test-catalog', 'import', 'tests.xlsx',
      '--apply', '--column-map', 'cols.json', '--value-map', 'vals.json', '--json',
    ]);
    expect(mocks.runTestCatalogImport).toHaveBeenCalledWith(
      'tests.xlsx', { apply: true, columnMap: 'cols.json', valueMap: 'vals.json', json: true },
    );
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', 'import', 'tests.csv']);
    expect(mocks.runTestCatalogImport).toHaveBeenLastCalledWith('tests.csv', { apply: false, json: false });
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', 'export', '--out', 'catalog.csv']);
    expect(mocks.runTestCatalogExport).toHaveBeenCalledWith({ out: 'catalog.csv' });
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/cli && npx vitest run src/test-catalog-import.test.ts src/test-catalog-cli-parsing.test.ts --testTimeout 30000`

Expected: the six import and export tests FAIL (`runTestCatalogImport is not a function`), and the new parsing test FAILS (`unknown command 'import'` or a `process.exit` from commander). The three S1 and S2 parsing tests still PASS.

- [ ] **Step 3: Write the two commands**

In `packages/cli/src/test-catalog.ts`, replace the first three import lines with:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { loadConfig } from '@openldr/config';
import {
  catalogChangeAction, catalogColumnMapSchema, catalogImportAudit, catalogValueMapSchema, createAppContext,
  parseCatalogListQuery, readCatalogImportFile, recordAuditEvent,
  type CatalogColumnMap, type CatalogImportFile, type CatalogImportReport, type CatalogValueMap,
} from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
```

Append at the end of the file:

```ts
export interface TestCatalogImportOpts {
  apply: boolean;
  columnMap?: string;
  valueMap?: string;
  json: boolean;
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Read a --column-map or --value-map file and check it against the route's own schema. */
function readMapFile<T>(
  flag: string, path: string,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } } },
): Checked<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { ok: false, error: err instanceof SyntaxError ? `${flag} ${path} is not valid JSON` : `could not read ${path}: ${redactError(err)}` };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: `${flag} ${path}: ${issue.path.join('.') || 'the file'} ${issue.message}` };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function describeReport(report: CatalogImportReport, applied: boolean): string {
  const c = report.counts;
  const lines = [
    applied ? 'Applied.' : 'Preview only. Nothing was written. Run again with --apply to write it.',
    `new ${c.new}, changed ${c.changed}, unchanged ${c.unchanged}, refused ${c.refused}`,
  ];
  if (!report.loincChecked) lines.push('LOINC is not loaded here, so LOINC codes were checked for their format only.');
  if (report.categoriesToAdd.length) {
    lines.push(`Categories to add: ${report.categoriesToAdd.map((a) => `${a.code} (${a.display})`).join(', ')}`);
  }
  for (const u of report.unmatched.categories) lines.push(`Category text with no match: "${u.text}" (${plural(u.rows, 'row', 'rows')})`);
  for (const u of report.unmatched.specimens) lines.push(`Specimen text with no match: "${u.text}" (${plural(u.rows, 'row', 'rows')})`);
  if (report.refused.length) {
    lines.push('Refused:');
    for (const r of report.refused) lines.push(`  row ${r.line}${r.code ? `, ${r.code}` : ''}: ${r.reason}`);
  }
  return lines.join('\n') + '\n';
}

/** `openldr test-catalog import <file>`: the CLI door to the page's import. It previews unless --apply
 *  is given, calls the same service methods as the routes, and audits an apply as the CLI actor. */
export async function runTestCatalogImport(path: string, opts: TestCatalogImportOpts): Promise<number> {
  const fail = (msg: string): number => {
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`test-catalog import failed: ${msg}\n`);
    return 1;
  };
  const ext = extname(path).toLowerCase();
  const format = ext === '.csv' ? 'csv' : ext === '.xlsx' ? 'xlsx' : null;
  if (!format) return fail(`${path} must end in .csv or .xlsx`);

  // Everything about the file is checked before the app context opens.
  let file: CatalogImportFile;
  try {
    file = readCatalogImportFile(readFileSync(path), format);
  } catch (err) {
    return fail(redactError(err));
  }
  let columnMap: CatalogColumnMap = file.suggested;
  if (opts.columnMap) {
    const read = readMapFile('--column-map', opts.columnMap, catalogColumnMapSchema);
    if (!read.ok) return fail(read.error);
    columnMap = read.value;
  }
  let valueMap: CatalogValueMap | undefined;
  if (opts.valueMap) {
    const read = readMapFile('--value-map', opts.valueMap, catalogValueMapSchema);
    if (!read.ok) return fail(read.error);
    valueMap = read.value;
  }
  const input = { table: { headers: file.headers, rows: file.rows }, columnMap, ...(valueMap ? { valueMap } : {}) };

  const ctx = await createAppContext(loadConfig());
  try {
    const report = opts.apply ? await ctx.testCatalog.importApply(input) : await ctx.testCatalog.importPreview(input);
    if (opts.apply) await recordAuditEvent(ctx, cliActor(), catalogImportAudit(report));
    process.stdout.write(opts.json ? JSON.stringify(report, null, 2) + '\n' : describeReport(report, opts.apply));
    return 0;
  } catch (err) {
    return fail(redactError(err));
  } finally {
    await ctx.close();
  }
}

/** `openldr test-catalog export`: the CLI door to GET /api/test-catalog/export. */
export async function runTestCatalogExport(opts: { out?: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const csv = await ctx.testCatalog.exportCsv();
    if (opts.out) {
      writeFileSync(opts.out, csv, 'utf8');
      process.stdout.write(`Wrote ${opts.out}.\n`);
    } else {
      process.stdout.write(csv);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`test-catalog export failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}
```

The first test expects `importPreview` to be called with no `valueMap` key at all. That is why `input` spreads `valueMap` in only when a file gave one.

- [ ] **Step 4: Register the commands**

In `packages/cli/src/program.ts`, change line 36 to:

```ts
import {
  runTestCatalogList, runTestCatalogChange, runTestCatalogImport, runTestCatalogExport,
  type TestCatalogListOpts, type TestCatalogImportOpts,
} from './test-catalog';
```

Directly after the `for (const [change, description] of testCatalogChanges) { ... }` loop, add:

```ts
  // Test catalog S3: import and export. Import shows what would change unless --apply is given.
  testCatalog
    .command('import <file>')
    .description('Import tests from a CSV or Excel (.xlsx) file. Shows what would change unless --apply is given.')
    .option('--apply', 'write the changes', false)
    .option('--column-map <file>', 'JSON file naming the column for each field (default: matched by header)')
    .option('--value-map <file>', 'JSON file answering category and specimen text that matched nothing')
    .option('--json', 'emit JSON', false)
    .action(async (file: string, opts: TestCatalogImportOpts) => {
      process.exitCode = await runTestCatalogImport(file, opts);
    });
  testCatalog
    .command('export')
    .description('Write the active tests as CSV, in the layout import reads')
    .option('--out <file>', 'write to this file instead of standard output')
    .action(async (opts: { out?: string }) => {
      process.exitCode = await runTestCatalogExport(opts);
    });
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd packages/cli && npx vitest run src/test-catalog-import.test.ts src/test-catalog-cli-parsing.test.ts src/test-catalog-change.test.ts src/test-catalog.test.ts --testTimeout 30000`

Expected: PASS, every test in the four files.

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/cli && npx tsc --noEmit -p . > "$TEMP/s3-t7-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`. If `readMapFile`'s schema parameter does not accept a zod schema, the structural type is wrong: read the error, do not add `zod` to the CLI's dependencies.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/test-catalog.ts packages/cli/src/test-catalog-import.test.ts packages/cli/src/test-catalog-cli-parsing.test.ts packages/cli/src/program.ts
git commit -m "feat(cli): openldr test-catalog import and export" -m "import <file> reads a CSV or .xlsx, uses the suggested columns unless --column-map names them, takes answers for unmatched text from --value-map, and shows what would change. --apply writes it and audits test_catalog.import as the CLI. Both map files are checked with the route's own schemas before the app opens. export writes the active tests as CSV to standard output or to --out."
```

---

### Task 8: the studio client, and Export in the page menu

**Files:**
- Modify: `apps/studio/src/api.ts` (after `setCatalogTestActive`, `:2478-2480`)
- Modify: `apps/studio/src/api.testCatalog.test.ts`
- Modify: `apps/studio/src/pages/TestCatalog.tsx`
- Modify: `apps/studio/src/pages/TestCatalog.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Produces, in `@/api`: the types `CatalogImportField`, `CatalogColumnMap`, `CatalogCategoryAnswer`, `CatalogSpecimenAnswer`, `CatalogValueMap`, `CatalogImportFile`, `CatalogImportInput`, `CatalogImportReport` (mirrors of the bootstrap types), and `catalogImportFormat(name): 'csv' | 'xlsx' | null`, `readTestCatalogFile(file, format)`, `previewTestCatalogImport(input)`, `applyTestCatalogImport(input)`, `downloadTestCatalogCsv()`.
- Page: the header ⋯ menu now shows for anyone with `terminology.manage`. **Add test** stays owner-only. **Export CSV** shows at every install, a central-fed lab included.

- [ ] **Step 1: Write the failing tests**

In `apps/studio/src/api.testCatalog.test.ts`, replace the import from `./api` with:

```ts
import {
  applyTestCatalogImport, catalogImportFormat, downloadTestCatalogCsv, getTestCatalogOptions, listTestCatalog,
  previewTestCatalogImport, readTestCatalogFile, setCatalogTestActive, setCatalogTestEnabled, updateCatalogTest,
} from './api';
```

and append inside its `describe` block:

```ts
  it('sends the file as raw bytes with its format, and each import step as JSON', async () => {
    const file = new File(['code,name\n'], 'tests.csv', { type: 'text/csv' });
    await readTestCatalogFile(file, 'csv');
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/import/read?format=csv', {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file,
    });
    const input = { table: { headers: ['name'], rows: [['A']] }, columnMap: { name: 'name' } };
    await previewTestCatalogImport(input);
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/import/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    await applyTestCatalogImport(input);
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/import/apply', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
  });

  it('tells a file format from its name', () => {
    expect(catalogImportFormat('Tests.XLSX')).toBe('xlsx');
    expect(catalogImportFormat('tests.csv')).toBe('csv');
    expect(catalogImportFormat('tests.xls')).toBeNull();
  });

  it('downloads the export through a link named test-catalog.csv', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('code,name\n', { status: 200, headers: { 'content-type': 'text/csv' } })));
    const revokeObjectURL = vi.fn();
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:catalog'), revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await downloadTestCatalogCsv();
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/export', { method: 'GET' });
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('test-catalog.csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:catalog');
    click.mockRestore();
  });
```

In `apps/studio/src/pages/TestCatalog.test.tsx`, add to the mocked `@/api` object, after `setCatalogTestActive: vi.fn(),`:

```ts
    downloadTestCatalogCsv: vi.fn(),
```

Replace the test `offers no Add test when the catalog came from central` with:

```ts
  it('offers only Export when the catalog came from central', async () => {
    vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [HIVVL], total: 1, ownedHere: false });
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-catalog-menu-trigger');
    expect(await screen.findByTestId('export-tests')).toBeInTheDocument();
    expect(screen.queryByTestId('add-test')).toBeNull();
    expect(screen.queryByTestId('import-tests')).toBeNull();
  });

  it('exports the catalog from the header menu, and shows a failure', async () => {
    vi.mocked(api.downloadTestCatalogCsv).mockResolvedValueOnce(undefined);
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-catalog-menu-trigger');
    fireEvent.click(await screen.findByTestId('export-tests'));
    await waitFor(() => expect(api.downloadTestCatalogCsv).toHaveBeenCalledTimes(1));

    vi.mocked(api.downloadTestCatalogCsv).mockRejectedValueOnce(new Error('export tests failed: 500'));
    openMenu('test-catalog-menu-trigger');
    fireEvent.click(await screen.findByTestId('export-tests'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('export tests failed: 500'));
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/api.testCatalog.test.ts src/pages/TestCatalog.test.tsx --testTimeout 30000`

Expected: the three new client tests FAIL (`readTestCatalogFile is not a function`, and so on), and the two page tests FAIL (no menu trigger at a central-fed lab; no `export-tests` item). The other page tests still PASS.

- [ ] **Step 3: Add the client**

In `apps/studio/src/api.ts`, directly after `setCatalogTestActive`, add:

```ts
// ── Test catalog import and export (test catalog S3) ──────────────────────────
// Mirrors of @openldr/bootstrap's test-catalog-import.ts and test-catalog.ts import types.
export type CatalogImportField = 'code' | 'name' | 'shortName' | 'loinc' | 'category' | 'specimenTypes';
/** Which file column feeds each field, by header text. A field left out is not changed on existing tests. */
export type CatalogColumnMap = Partial<Record<CatalogImportField, string>>;
export type CatalogCategoryAnswer =
  | { text: string; kind: 'existing'; code: string }
  | { text: string; kind: 'new'; code: string; display: string };
export interface CatalogSpecimenAnswer { text: string; system: string; code: string }
export interface CatalogValueMap { categories: CatalogCategoryAnswer[]; specimens: CatalogSpecimenAnswer[] }
export interface CatalogImportFile {
  headers: string[];
  rows: string[][];
  sheetName: string | null;
  sheetCount: number;
  suggested: CatalogColumnMap;
}
export interface CatalogImportInput {
  table: { headers: string[]; rows: string[][] };
  columnMap: CatalogColumnMap;
  valueMap?: CatalogValueMap;
}
export interface CatalogImportReport {
  counts: { new: number; changed: number; unchanged: number; refused: number };
  refused: { line: number; code: string | null; reason: string }[];
  unmatched: { categories: { text: string; rows: number }[]; specimens: { text: string; rows: number }[] };
  categoriesToAdd: { code: string; display: string }[];
  loincChecked: boolean;
}

/** The server needs the format said, and the file name is where the studio can read it. */
export function catalogImportFormat(name: string): 'csv' | 'xlsx' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}
export const readTestCatalogFile = (file: File, format: 'csv' | 'xlsx'): Promise<CatalogImportFile> =>
  authFetch(`/api/test-catalog/import/read?format=${format}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file,
  }).then((r) => okJson<CatalogImportFile>(r, 'read file'));
export const previewTestCatalogImport = (i: CatalogImportInput): Promise<CatalogImportReport> =>
  authFetch('/api/test-catalog/import/preview', jbody(i, 'POST')).then((r) => okJson<CatalogImportReport>(r, 'check import'));
export const applyTestCatalogImport = (i: CatalogImportInput): Promise<CatalogImportReport> =>
  authFetch('/api/test-catalog/import/apply', jbody(i, 'POST')).then((r) => okJson<CatalogImportReport>(r, 'import tests'));
/** Fetched with the token, then saved through a link, as exportFormBundle does. */
export async function downloadTestCatalogCsv(): Promise<void> {
  const r = await authFetch('/api/test-catalog/export', { method: 'GET' });
  if (!r.ok) throw new Error(formatApiError('export tests', await errorDetail(r)));
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url; a.download = 'test-catalog.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Put Export in the page menu**

In `apps/studio/src/pages/TestCatalog.tsx`:

1. Add `downloadTestCatalogCsv,` to the `@/api` import, after `getTestCatalogOptions,`.

2. Replace the whole `actions={canManage && ownedHere ? ( ... ) : undefined}` prop with:

```tsx
            actions={canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8"
                    data-testid="test-catalog-menu-trigger" aria-label={t('testCatalog.menuLabel')}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {ownedHere && (
                    <DropdownMenuItem data-testid="add-test" onSelect={() => setSheet({ kind: 'create' })}>
                      {t('testCatalog.add')}
                    </DropdownMenuItem>
                  )}
                  {/* Any install can export, a lab that receives central's catalog included. */}
                  <DropdownMenuItem
                    data-testid="export-tests"
                    onSelect={() => {
                      downloadTestCatalogCsv().catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); });
                    }}
                  >
                    {t('testCatalog.exportAction')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : undefined}
```

3. In `en.ts`, directly after `    edit: 'Edit',` inside `testCatalog`, add:

```ts
    exportAction: 'Export CSV',
```

In `fr.ts`, after `    edit: 'Modifier',` inside `testCatalog`:

```ts
    exportAction: 'Exporter en CSV',
```

In `pt.ts`, after `    edit: 'Editar',` inside `testCatalog`:

```ts
    exportAction: 'Exportar CSV',
```

`edit: 'Edit',` and its translations occur elsewhere in each file. Anchor the edit on the `add:` line above it (`    add: 'Add test',`, `    add: 'Ajouter un examen',`, `    add: 'Adicionar exame',`), which is unique to `testCatalog`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/api.testCatalog.test.ts src/pages/TestCatalog.test.tsx src/i18n --testTimeout 30000`

Expected: PASS, including the i18n parity test.

- [ ] **Step 6: Typecheck the package**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/s3-t8-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.testCatalog.test.ts apps/studio/src/pages/TestCatalog.tsx apps/studio/src/pages/TestCatalog.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): export the test catalog from the page menu" -m "The studio client gains the test catalog import and export calls. The page's header menu now shows for every manager, and Export CSV downloads the active tests at any install, a lab that receives central's catalog included. Add test stays with the install that owns the catalog."
```

---

### Task 9: the import sheet

**Files:**
- Create: `apps/studio/src/test-catalog/ImportCatalogSheet.tsx`
- Create: `apps/studio/src/test-catalog/ImportCatalogSheet.test.tsx`
- Modify: `apps/studio/src/pages/TestCatalog.tsx`, `TestCatalog.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: the Task 8 client.
- Produces: `ImportCatalogSheet({ open, options, onClose, onImported })`. The page opens it from an **Import** item in the header menu, shown only where this install owns the catalog.

Siblings copied (AGENTS.md section 5): `test-catalog/TestSheet.tsx` for the sheet, its width and the ⋯ menu on the first section's title row; `facilities/ImportFacilitiesSheet.tsx:1469-1523` for the file drop target with its `sr-only` input. The steps are File, Columns, Values and Review. Back, Next, Apply and Close are in the ⋯ menu (decision 3). A successful file read moves to Columns by itself. Next on Columns and on Values runs a preview, so Review always shows the report for the current maps. The Values step always shows, saying so when everything matched. Nothing is written before Apply.

Studio has no Tailwind reset (memory `studio-no-tailwind-preflight`), so the sheet uses `div` and `span`, never `p` or `h3`.

- [ ] **Step 1: Write the failing tests**

Create `apps/studio/src/test-catalog/ImportCatalogSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, readTestCatalogFile: vi.fn(), previewTestCatalogImport: vi.fn(), applyTestCatalogImport: vi.fn() };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { ImportCatalogSheet } from './ImportCatalogSheet';

const LOCAL = 'urn:openldr:cs:local';
const OPTIONS: api.TestCatalogOptions = {
  categories: [{ code: 'CHEM', display: 'Chemistry' }, { code: 'MOL', display: 'Molecular' }],
  specimenTypes: [{ system: LOCAL, code: 'BLD', display: 'Blood' }, { system: LOCAL, code: 'UR', display: 'Urine' }],
  loinc: null,
};
const FILE: api.CatalogImportFile = {
  headers: ['Test code', 'Test name', 'Category', 'Specimens'],
  rows: [['VL1', 'Viral load', 'Virology', 'Plasma']],
  sheetName: null, sheetCount: 1,
  suggested: { code: 'Test code', name: 'Test name', category: 'Category', specimenTypes: 'Specimens' },
};
const report = (over: Partial<api.CatalogImportReport> = {}): api.CatalogImportReport => ({
  counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [],
  unmatched: { categories: [], specimens: [] }, categoriesToAdd: [], loincChecked: true, ...over,
});
const UNMATCHED = report({
  counts: { new: 0, changed: 0, unchanged: 0, refused: 1 },
  refused: [{ line: 2, code: 'VL1', reason: 'Category "Virology" is not in the test category list. Choose a category for it.' }],
  unmatched: { categories: [{ text: 'Virology', rows: 1 }], specimens: [{ text: 'Plasma', rows: 1 }] },
});

function renderSheet() {
  const onImported = vi.fn();
  const onClose = vi.fn();
  render(<ImportCatalogSheet open options={OPTIONS} onImported={onImported} onClose={onClose} />);
  return { onImported, onClose };
}

// Radix menus open on pointerDown in jsdom, with Enter as the fallback (as in TestSheet.test.tsx).
async function choose(testId: string) {
  const trigger = screen.getByTestId('import-sheet-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByTestId(testId);
  await act(async () => { fireEvent.click(item); });
}

// Radix Select opens from the keyboard in jsdom.
async function pick(name: RegExp | string, option: RegExp) {
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

async function chooseFile(name: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [new File(['x'], name)] } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readTestCatalogFile).mockResolvedValue(FILE);
});

describe('ImportCatalogSheet', () => {
  it('reads a file, takes the suggested columns, collects answers, and applies them', async () => {
    vi.mocked(api.previewTestCatalogImport).mockResolvedValueOnce(UNMATCHED).mockResolvedValueOnce(report({
      unmatched: UNMATCHED.unmatched, categoriesToAdd: [{ code: 'VIRO', display: 'Virology' }],
    }));
    vi.mocked(api.applyTestCatalogImport).mockResolvedValue(report());
    const { onImported, onClose } = renderSheet();

    await chooseFile('tests.csv');
    expect(api.readTestCatalogFile).toHaveBeenCalledWith(expect.any(File), 'csv');
    expect(await screen.findByText('Step 2 of 4: Columns')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Name' })).toHaveTextContent('Test name');

    await choose('import-next');
    expect(await screen.findByText('Step 3 of 4: Values')).toBeInTheDocument();
    await pick(/Virology/, /add as a new category/i);
    const code = screen.getByRole('textbox', { name: /new category code/i });
    expect(code).toHaveValue('VIROLOGY');
    fireEvent.change(code, { target: { value: 'VIRO' } });
    await pick(/Plasma/, /^blood$/i);

    await choose('import-next');
    expect(await screen.findByText('Step 4 of 4: Review')).toBeInTheDocument();
    const sent: api.CatalogImportInput = {
      table: { headers: FILE.headers, rows: FILE.rows },
      columnMap: FILE.suggested,
      valueMap: {
        categories: [{ text: 'Virology', kind: 'new', code: 'VIRO', display: 'Virology' }],
        specimens: [{ text: 'Plasma', system: LOCAL, code: 'BLD' }],
      },
    };
    expect(api.previewTestCatalogImport).toHaveBeenLastCalledWith(sent);
    expect(screen.getByText('VIRO (Virology)')).toBeInTheDocument();

    await choose('import-apply');
    expect(api.applyTestCatalogImport).toHaveBeenCalledWith(sent);
    expect(toast.success).toHaveBeenCalledWith('1 added, 0 changed.');
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refuses a file of the wrong type, and lets the operator drop a column and go back', async () => {
    vi.mocked(api.previewTestCatalogImport).mockResolvedValue(report());
    renderSheet();

    await chooseFile('tests.pdf');
    expect(screen.getByText('Choose a .csv or .xlsx file. tests.pdf is neither.')).toBeInTheDocument();
    expect(api.readTestCatalogFile).not.toHaveBeenCalled();

    await chooseFile('tests.xlsx');
    expect(api.readTestCatalogFile).toHaveBeenCalledWith(expect.any(File), 'xlsx');
    await screen.findByText('Step 2 of 4: Columns');
    await pick('Code', /not in the file/i);
    await choose('import-next');
    await screen.findByText('Step 3 of 4: Values');
    expect(screen.getByText('Every category and specimen in the file matched the lists.')).toBeInTheDocument();
    expect(api.previewTestCatalogImport).toHaveBeenLastCalledWith(expect.objectContaining({
      columnMap: { name: 'Test name', category: 'Category', specimenTypes: 'Specimens' },
    }));

    await choose('import-back');
    expect(await screen.findByText('Step 2 of 4: Columns')).toBeInTheDocument();
  });

  it('shows the refused rows and the LOINC note, and offers no Apply with nothing to write', async () => {
    vi.mocked(api.previewTestCatalogImport).mockResolvedValue(report({
      counts: { new: 0, changed: 0, unchanged: 2, refused: 1 },
      refused: [{ line: 3, code: 'X1', reason: 'A test needs a name.' }],
      loincChecked: false,
    }));
    renderSheet();
    await chooseFile('tests.csv');
    await choose('import-next');
    await choose('import-next');
    await screen.findByText('Step 4 of 4: Review');
    expect(screen.getByText('A test needs a name.')).toBeInTheDocument();
    expect(screen.getByText('LOINC is not loaded here, so LOINC codes were checked for their format only.')).toBeInTheDocument();
    expect(screen.getByText('Nothing to apply: no row is new or changed.')).toBeInTheDocument();
    const trigger = screen.getByTestId('import-sheet-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByTestId('import-apply')).toHaveAttribute('data-disabled');
  });

  it('shows a refusal from the server and stays on the step', async () => {
    vi.mocked(api.previewTestCatalogImport).mockRejectedValue(new Error('check import failed: The file has no column "Test name".'));
    renderSheet();
    await chooseFile('tests.csv');
    await choose('import-next');
    expect(toast.error).toHaveBeenCalledWith('check import failed: The file has no column "Test name".');
    expect(screen.getByText('Step 2 of 4: Columns')).toBeInTheDocument();
  });
});
```

In `apps/studio/src/pages/TestCatalog.test.tsx`, append inside the `describe` block:

```tsx
  it('opens the import sheet from the header menu', async () => {
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-catalog-menu-trigger');
    fireEvent.click(await screen.findByTestId('import-tests'));
    expect(await screen.findByRole('heading', { name: 'Import tests' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/test-catalog/ImportCatalogSheet.test.tsx src/pages/TestCatalog.test.tsx --testTimeout 30000`

Expected: the sheet file FAILS to load (`./ImportCatalogSheet` does not exist), and the new page test FAILS (no `import-tests` item).

- [ ] **Step 3: Add the strings**

In `en.ts`, directly after `    exportAction: 'Export CSV',` inside `testCatalog`, add:

```ts
    importAction: 'Import',
    import: {
      title: 'Import tests',
      description: 'Read a national test list from a CSV or Excel file, check it, then apply it. Nothing is written before Apply.',
      actions: 'Import actions',
      back: 'Back',
      next: 'Next',
      apply: 'Apply',
      close: 'Close',
      stepFile: 'Step 1 of 4: File',
      stepColumns: 'Step 2 of 4: Columns',
      stepValues: 'Step 3 of 4: Values',
      stepReview: 'Step 4 of 4: Review',
      fileLabel: 'File',
      fileDropHint: 'Drag a .csv or .xlsx file here, or click to choose one',
      fileDropActive: 'Drop the file to read it',
      fileWrongType: 'Choose a .csv or .xlsx file. {{name}} is neither.',
      reading: 'Reading the file',
      fileRead_one: '{{name}}: {{count}} row',
      fileRead_other: '{{name}}: {{count}} rows',
      sheetNote: 'Read the worksheet "{{sheet}}", the first of {{count}}.',
      columnsHint: 'Choose the column that holds each field. Name is required. A field set to "Not in the file" is not changed on existing tests. An empty cell in a chosen column clears the field.',
      notInFile: 'Not in the file',
      field: {
        code: 'Code',
        name: 'Name',
        shortName: 'Short name',
        loinc: 'LOINC code',
        category: 'Category',
        specimenTypes: 'Specimen types',
      },
      valuesHint: 'This text matched nothing in the lists. Choose what each one means. A row with text left unchosen is refused.',
      allMatched: 'Every category and specimen in the file matched the lists.',
      categories: 'Categories',
      specimens: 'Specimens',
      rows_one: '{{count}} row',
      rows_other: '{{count}} rows',
      notChosen: 'Not chosen',
      addCategory: 'Add as a new category',
      newCode: 'New category code for "{{text}}"',
      countNew: 'New',
      countChanged: 'Changed',
      countUnchanged: 'Unchanged',
      countRefused: 'Refused',
      loincNotChecked: 'LOINC is not loaded here, so LOINC codes were checked for their format only.',
      categoriesToAdd: 'Categories to add',
      nothingToApply: 'Nothing to apply: no row is new or changed.',
      refusedTitle: 'Refused rows',
      colRow: 'Row',
      colCode: 'Code',
      colReason: 'Reason',
      applied: '{{new}} added, {{changed}} changed.',
    },
```

In `fr.ts`, after `    exportAction: 'Exporter en CSV',`:

```ts
    importAction: 'Importer',
    import: {
      title: 'Importer des examens',
      description: "Lire une liste nationale d'examens depuis un fichier CSV ou Excel, la vérifier, puis l'appliquer. Rien n'est écrit avant Appliquer.",
      actions: "Actions d'import",
      back: 'Retour',
      next: 'Suivant',
      apply: 'Appliquer',
      close: 'Fermer',
      stepFile: 'Étape 1 sur 4 : Fichier',
      stepColumns: 'Étape 2 sur 4 : Colonnes',
      stepValues: 'Étape 3 sur 4 : Valeurs',
      stepReview: 'Étape 4 sur 4 : Vérification',
      fileLabel: 'Fichier',
      fileDropHint: 'Déposez un fichier .csv ou .xlsx ici, ou cliquez pour en choisir un',
      fileDropActive: 'Déposez le fichier pour le lire',
      fileWrongType: "Choisissez un fichier .csv ou .xlsx. {{name}} n'est ni l'un ni l'autre.",
      reading: 'Lecture du fichier',
      fileRead_one: '{{name}} : {{count}} ligne',
      fileRead_other: '{{name}} : {{count}} lignes',
      sheetNote: 'Feuille lue : « {{sheet}} », la première sur {{count}}.',
      columnsHint: 'Choisissez la colonne de chaque champ. Le nom est obligatoire. Un champ réglé sur « Absent du fichier » ne change pas sur les examens existants. Une cellule vide dans une colonne choisie efface le champ.',
      notInFile: 'Absent du fichier',
      field: {
        code: 'Code',
        name: 'Nom',
        shortName: 'Nom court',
        loinc: 'Code LOINC',
        category: 'Catégorie',
        specimenTypes: 'Types de prélèvement',
      },
      valuesHint: "Ce texte ne correspond à rien dans les listes. Choisissez ce que chacun signifie. Une ligne dont un texte reste sans choix est refusée.",
      allMatched: 'Chaque catégorie et chaque prélèvement du fichier correspondent aux listes.',
      categories: 'Catégories',
      specimens: 'Prélèvements',
      rows_one: '{{count}} ligne',
      rows_other: '{{count}} lignes',
      notChosen: 'Non choisi',
      addCategory: 'Ajouter comme nouvelle catégorie',
      newCode: 'Code de la nouvelle catégorie pour « {{text}} »',
      countNew: 'Nouveaux',
      countChanged: 'Modifiés',
      countUnchanged: 'Inchangés',
      countRefused: 'Refusés',
      loincNotChecked: "LOINC n'est pas chargé ici, seul le format des codes LOINC a été vérifié.",
      categoriesToAdd: 'Catégories à ajouter',
      nothingToApply: "Rien à appliquer : aucune ligne n'est nouvelle ou modifiée.",
      refusedTitle: 'Lignes refusées',
      colRow: 'Ligne',
      colCode: 'Code',
      colReason: 'Motif',
      applied: '{{new}} ajoutés, {{changed}} modifiés.',
    },
```

In `pt.ts`, after `    exportAction: 'Exportar CSV',`:

```ts
    importAction: 'Importar',
    import: {
      title: 'Importar exames',
      description: 'Ler uma lista nacional de exames de um ficheiro CSV ou Excel, verificá-la e depois aplicá-la. Nada é escrito antes de Aplicar.',
      actions: 'Ações de importação',
      back: 'Voltar',
      next: 'Seguinte',
      apply: 'Aplicar',
      close: 'Fechar',
      stepFile: 'Passo 1 de 4: Ficheiro',
      stepColumns: 'Passo 2 de 4: Colunas',
      stepValues: 'Passo 3 de 4: Valores',
      stepReview: 'Passo 4 de 4: Revisão',
      fileLabel: 'Ficheiro',
      fileDropHint: 'Arraste um ficheiro .csv ou .xlsx para aqui, ou clique para escolher',
      fileDropActive: 'Largue o ficheiro para o ler',
      fileWrongType: 'Escolha um ficheiro .csv ou .xlsx. {{name}} não é nenhum deles.',
      reading: 'A ler o ficheiro',
      fileRead_one: '{{name}}: {{count}} linha',
      fileRead_other: '{{name}}: {{count}} linhas',
      sheetNote: 'Folha lida: "{{sheet}}", a primeira de {{count}}.',
      columnsHint: 'Escolha a coluna de cada campo. O nome é obrigatório. Um campo definido como "Não está no ficheiro" não muda nos exames existentes. Uma célula vazia numa coluna escolhida apaga o campo.',
      notInFile: 'Não está no ficheiro',
      field: {
        code: 'Código',
        name: 'Nome',
        shortName: 'Nome curto',
        loinc: 'Código LOINC',
        category: 'Categoria',
        specimenTypes: 'Tipos de amostra',
      },
      valuesHint: 'Este texto não corresponde a nada nas listas. Escolha o que cada um significa. Uma linha com texto sem escolha é recusada.',
      allMatched: 'Todas as categorias e amostras do ficheiro correspondem às listas.',
      categories: 'Categorias',
      specimens: 'Amostras',
      rows_one: '{{count}} linha',
      rows_other: '{{count}} linhas',
      notChosen: 'Sem escolha',
      addCategory: 'Adicionar como nova categoria',
      newCode: 'Código da nova categoria para "{{text}}"',
      countNew: 'Novos',
      countChanged: 'Alterados',
      countUnchanged: 'Sem alteração',
      countRefused: 'Recusados',
      loincNotChecked: 'O LOINC não está carregado aqui, por isso só o formato dos códigos LOINC foi verificado.',
      categoriesToAdd: 'Categorias a adicionar',
      nothingToApply: 'Nada a aplicar: nenhuma linha é nova ou alterada.',
      refusedTitle: 'Linhas recusadas',
      colRow: 'Linha',
      colCode: 'Código',
      colReason: 'Motivo',
      applied: '{{new}} adicionados, {{changed}} alterados.',
    },
```

- [ ] **Step 4: Write the sheet**

Create `apps/studio/src/test-catalog/ImportCatalogSheet.tsx`:

```tsx
import { Fragment, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal, Upload } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import {
  applyTestCatalogImport, catalogImportFormat, previewTestCatalogImport, readTestCatalogFile,
  type CatalogCategoryAnswer, type CatalogColumnMap, type CatalogImportField, type CatalogImportFile,
  type CatalogImportInput, type CatalogImportReport, type CatalogValueMap, type TestCatalogOptions,
} from '@/api';

// Test catalog S3 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.4): import a national test
// list in four steps. Copies TestSheet.tsx (the sheet and the ⋯ menu on its first section row) and
// facilities/ImportFacilitiesSheet.tsx (the file drop target). Nothing is written before Apply.

type Step = 'file' | 'columns' | 'values' | 'review';
const STEPS: Step[] = ['file', 'columns', 'values', 'review'];
const STEP_TITLE: Record<Step, string> = {
  file: 'testCatalog.import.stepFile',
  columns: 'testCatalog.import.stepColumns',
  values: 'testCatalog.import.stepValues',
  review: 'testCatalog.import.stepReview',
};
const FIELDS: CatalogImportField[] = ['code', 'name', 'shortName', 'loinc', 'category', 'specimenTypes'];
const NO_ANSWERS: CatalogValueMap = { categories: [], specimens: [] };
/** Radix Select cannot hold an empty value, so these stand in for "no choice" in the pickers only. */
const NOT_IN_FILE = '__not_in_file__';
const NOT_CHOSEN = '__not_chosen__';
const NEW_CATEGORY = '__new_category__';

const specimenKey = (s: { system: string; code: string }): string => `${s.system}|${s.code}`;

/** A starting code for a new category, from the file's text. The operator can change it. */
function codeFromText(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function ImportCatalogSheet({ open, options, onClose, onImported }: {
  open: boolean;
  options: TestCatalogOptions;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<CatalogImportFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [wrongType, setWrongType] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [columnMap, setColumnMap] = useState<CatalogColumnMap>({});
  const [valueMap, setValueMap] = useState<CatalogValueMap>(NO_ANSWERS);
  const [report, setReport] = useState<CatalogImportReport | null>(null);
  const [refusedPage, setRefusedPage] = useState(0);
  const [refusedPageSize, setRefusedPageSize] = useState(10);
  const [busy, setBusy] = useState(false);

  // Each opening starts over. Nothing is kept between imports.
  useEffect(() => {
    if (!open) return;
    setStep('file');
    setFile(null);
    setFileName('');
    setWrongType(null);
    setColumnMap({});
    setValueMap(NO_ANSWERS);
    setReport(null);
    setRefusedPage(0);
  }, [open]);

  const fail = (e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); };
  const input = (): CatalogImportInput | null =>
    (file ? { table: { headers: file.headers, rows: file.rows }, columnMap, valueMap } : null);

  async function readFile(f: File) {
    const format = catalogImportFormat(f.name);
    if (!format) {
      setWrongType(f.name);
      return;
    }
    setWrongType(null);
    setBusy(true);
    try {
      const read = await readTestCatalogFile(f, format);
      setFile(read);
      setFileName(f.name);
      setColumnMap(read.suggested);
      setValueMap(NO_ANSWERS);
      setReport(null);
      setStep('columns');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Cleared, so choosing the same file again still reads it.
    e.target.value = '';
    if (f) void readFile(f);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const f = e.dataTransfer.files?.[0];
    if (f) void readFile(f);
  };

  async function preview(to: Step) {
    const i = input();
    if (!i || busy) return;
    setBusy(true);
    try {
      setReport(await previewTestCatalogImport(i));
      setRefusedPage(0);
      setStep(to);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const i = input();
    if (!i || busy) return;
    setBusy(true);
    try {
      const done = await applyTestCatalogImport(i);
      toast.success(t('testCatalog.import.applied', { new: done.counts.new, changed: done.counts.changed }));
      onImported();
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const index = STEPS.indexOf(step);
  const next = () => {
    if (step === 'file') setStep('columns');
    else if (step === 'columns') void preview('values');
    else if (step === 'values') void preview('review');
  };
  const nextDisabled = busy || (step === 'file' && !file) || (step === 'columns' && !columnMap.name);
  const writes = report ? report.counts.new + report.counts.changed : 0;

  const setColumn = (field: CatalogImportField, header: string) => setColumnMap((m) => {
    const out = { ...m };
    if (header === NOT_IN_FILE) delete out[field];
    else out[field] = header;
    return out;
  });
  const categoryAnswer = (text: string) => valueMap.categories.find((a) => a.text === text);
  const specimenAnswer = (text: string) => valueMap.specimens.find((a) => a.text === text);
  const setCategory = (text: string, choice: string) => setValueMap((m) => {
    const rest = m.categories.filter((a) => a.text !== text);
    if (choice === NOT_CHOSEN) return { ...m, categories: rest };
    const answer: CatalogCategoryAnswer = choice === NEW_CATEGORY
      ? { text, kind: 'new', code: codeFromText(text), display: text.trim() }
      : { text, kind: 'existing', code: choice };
    return { ...m, categories: [...rest, answer] };
  });
  const setNewCode = (text: string, code: string) => setValueMap((m) => ({
    ...m, categories: m.categories.map((a) => (a.text === text && a.kind === 'new' ? { ...a, code } : a)),
  }));
  const setSpecimen = (text: string, choice: string) => setValueMap((m) => {
    const rest = m.specimens.filter((a) => a.text !== text);
    const hit = options.specimenTypes.find((s) => specimenKey(s) === choice);
    return { ...m, specimens: hit ? [...rest, { text, system: hit.system, code: hit.code }] : rest };
  });

  // Headers are picker values, so an empty one cannot be offered, and a repeated one is offered once.
  const headers = file ? [...new Set(file.headers.filter((h) => h !== ''))] : [];
  const unmatched = report?.unmatched ?? { categories: [], specimens: [] };
  const refusedRows = report?.refused.slice(refusedPage * refusedPageSize, (refusedPage + 1) * refusedPageSize) ?? [];
  const valueLabel = 'max-w-[40vw] break-words sm:max-w-[16rem]';

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Full width on a phone: the base sheet stops at 90vw. */}
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.import.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.import.description')}</SheetDescription>
        </SheetHeader>

        <section>
          {/* Back, Next, Apply and Close sit on the first section's title row, as in TestSheet.tsx, clear
              of the sheet's own close button. */}
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t(STEP_TITLE[step])}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  data-testid="import-sheet-menu" aria-label={t('testCatalog.import.actions')}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {index > 0 && (
                  <DropdownMenuItem data-testid="import-back" disabled={busy} onSelect={() => setStep(STEPS[index - 1])}>
                    {t('testCatalog.import.back')}
                  </DropdownMenuItem>
                )}
                {step !== 'review' && (
                  <DropdownMenuItem data-testid="import-next" disabled={nextDisabled} onSelect={next}>
                    {t('testCatalog.import.next')}
                  </DropdownMenuItem>
                )}
                {step === 'review' && (
                  <DropdownMenuItem data-testid="import-apply" disabled={busy || writes === 0} onSelect={() => void apply()}>
                    {t('testCatalog.import.apply')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem data-testid="import-close" onSelect={onClose}>{t('testCatalog.import.close')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />

          {step === 'file' && (
            <div className="flex flex-col gap-2 px-6 py-4 text-sm">
              {/* sr-only, not removed: the real input below takes its accessible name from this Label. */}
              <Label htmlFor="catalog-import-file" className="sr-only">{t('testCatalog.import.fileLabel')}</Label>
              <div
                role="button"
                tabIndex={busy ? -1 : 0}
                aria-disabled={busy || undefined}
                onClick={() => { if (!busy) fileInputRef.current?.click(); }}
                onKeyDown={(e) => {
                  if (busy) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }
                }}
                // onDragOver must preventDefault or the browser opens the dropped file.
                onDragOver={(e) => { if (!busy) { e.preventDefault(); setDragOver(true); } }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6',
                  'text-center text-xs transition-colors',
                  busy ? 'cursor-not-allowed border-border opacity-50' : 'cursor-pointer hover:border-muted-foreground/60',
                  dragOver && !busy && 'border-primary bg-primary/5',
                )}
              >
                <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
                <span className={file && !busy ? 'text-foreground' : 'text-muted-foreground'}>
                  {busy
                    ? t('testCatalog.import.reading')
                    : file
                      ? t('testCatalog.import.fileRead', { name: fileName, count: file.rows.length })
                      : t(dragOver ? 'testCatalog.import.fileDropActive' : 'testCatalog.import.fileDropHint')}
                </span>
                {/* The real input opens the picker, carries `accept`, and is what a screen reader
                    announces. sr-only, never hidden, so it keeps its name. */}
                <input
                  ref={fileInputRef}
                  id="catalog-import-file"
                  type="file"
                  accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy}
                  onChange={onFileChange}
                  className="sr-only"
                  tabIndex={-1}
                />
              </div>
              {wrongType && (
                <div className="text-xs text-destructive">{t('testCatalog.import.fileWrongType', { name: wrongType })}</div>
              )}
            </div>
          )}

          {step === 'columns' && file && (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <div className="col-span-2 text-xs text-muted-foreground">{t('testCatalog.import.columnsHint')}</div>
              {file.sheetCount > 1 && (
                <div className="col-span-2 text-xs text-muted-foreground">
                  {t('testCatalog.import.sheetNote', { sheet: file.sheetName, count: file.sheetCount })}
                </div>
              )}
              {FIELDS.map((field) => (
                <Fragment key={field}>
                  <Label htmlFor={`import-column-${field}`} className="whitespace-nowrap">
                    {t(`testCatalog.import.field.${field}`)}
                  </Label>
                  <Select value={columnMap[field] ?? NOT_IN_FILE} onValueChange={(v) => setColumn(field, v)}>
                    <SelectTrigger id={`import-column-${field}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOT_IN_FILE}>{t('testCatalog.import.notInFile')}</SelectItem>
                      {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Fragment>
              ))}
            </div>
          )}

          {step === 'values' && (
            unmatched.categories.length === 0 && unmatched.specimens.length === 0 ? (
              <div className="px-6 py-4 text-sm text-muted-foreground">{t('testCatalog.import.allMatched')}</div>
            ) : (
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
                <div className="col-span-2 text-xs text-muted-foreground">{t('testCatalog.import.valuesHint')}</div>
                {unmatched.categories.length > 0 && (
                  <div className="col-span-2 -mx-6 border-y border-border px-6 py-3 font-medium text-foreground">
                    {t('testCatalog.import.categories')}
                  </div>
                )}
                {unmatched.categories.map((u, i) => {
                  const answer = categoryAnswer(u.text);
                  const id = `import-category-${i}`;
                  return (
                    <Fragment key={u.text}>
                      <Label htmlFor={id} className={valueLabel}>
                        &quot;{u.text}&quot; <span className="text-muted-foreground">({t('testCatalog.import.rows', { count: u.rows })})</span>
                      </Label>
                      <div className="flex min-w-0 flex-col gap-2">
                        <Select
                          value={answer ? (answer.kind === 'new' ? NEW_CATEGORY : answer.code) : NOT_CHOSEN}
                          onValueChange={(v) => setCategory(u.text, v)}
                        >
                          <SelectTrigger id={id}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NOT_CHOSEN}>{t('testCatalog.import.notChosen')}</SelectItem>
                            {options.categories.map((c) => <SelectItem key={c.code} value={c.code}>{c.display ?? c.code}</SelectItem>)}
                            <SelectItem value={NEW_CATEGORY}>{t('testCatalog.import.addCategory')}</SelectItem>
                          </SelectContent>
                        </Select>
                        {answer?.kind === 'new' && (
                          <Input
                            aria-label={t('testCatalog.import.newCode', { text: u.text })}
                            value={answer.code}
                            onChange={(e) => setNewCode(u.text, e.target.value)}
                          />
                        )}
                      </div>
                    </Fragment>
                  );
                })}
                {unmatched.specimens.length > 0 && (
                  <div className="col-span-2 -mx-6 border-y border-border px-6 py-3 font-medium text-foreground">
                    {t('testCatalog.import.specimens')}
                  </div>
                )}
                {unmatched.specimens.map((u, i) => {
                  const answer = specimenAnswer(u.text);
                  const id = `import-specimen-${i}`;
                  return (
                    <Fragment key={u.text}>
                      <Label htmlFor={id} className={valueLabel}>
                        &quot;{u.text}&quot; <span className="text-muted-foreground">({t('testCatalog.import.rows', { count: u.rows })})</span>
                      </Label>
                      <Select value={answer ? specimenKey(answer) : NOT_CHOSEN} onValueChange={(v) => setSpecimen(u.text, v)}>
                        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NOT_CHOSEN}>{t('testCatalog.import.notChosen')}</SelectItem>
                          {options.specimenTypes.map((s) => (
                            <SelectItem key={specimenKey(s)} value={specimenKey(s)}>{s.display ?? s.code}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Fragment>
                  );
                })}
              </div>
            )
          )}

          {step === 'review' && report && (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
                <Label className="whitespace-nowrap">{t('testCatalog.import.countNew')}</Label>
                <div>{report.counts.new}</div>
                <Label className="whitespace-nowrap">{t('testCatalog.import.countChanged')}</Label>
                <div>{report.counts.changed}</div>
                <Label className="whitespace-nowrap">{t('testCatalog.import.countUnchanged')}</Label>
                <div>{report.counts.unchanged}</div>
                <Label className="whitespace-nowrap">{t('testCatalog.import.countRefused')}</Label>
                <div>{report.counts.refused}</div>
                {report.categoriesToAdd.length > 0 && (
                  <>
                    <Label className="self-start whitespace-nowrap">{t('testCatalog.import.categoriesToAdd')}</Label>
                    <div className="flex flex-col">
                      {report.categoriesToAdd.map((c) => <span key={c.code}>{`${c.code} (${c.display})`}</span>)}
                    </div>
                  </>
                )}
                {!report.loincChecked && (
                  <div className="col-span-2 text-xs text-muted-foreground">{t('testCatalog.import.loincNotChecked')}</div>
                )}
                {writes === 0 && (
                  <div className="col-span-2 text-xs text-muted-foreground">{t('testCatalog.import.nothingToApply')}</div>
                )}
              </div>
              {report.refused.length > 0 && (
                <>
                  <div className="border-y border-border px-6 py-3 text-sm font-medium text-foreground">
                    {t('testCatalog.import.refusedTitle')}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16 pl-6">{t('testCatalog.import.colRow')}</TableHead>
                        <TableHead>{t('testCatalog.import.colCode')}</TableHead>
                        <TableHead className="pr-6">{t('testCatalog.import.colReason')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {refusedRows.map((r) => (
                        <TableRow key={`${r.line}`}>
                          <TableCell className="pl-6">{r.line}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs">{r.code ?? t('testCatalog.none')}</TableCell>
                          <TableCell className="pr-6">{r.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <TablePagination
                    page={refusedPage}
                    pageSize={refusedPageSize}
                    total={report.refused.length}
                    onPageChange={setRefusedPage}
                    onPageSizeChange={(n) => { setRefusedPageSize(n); setRefusedPage(0); }}
                  />
                </>
              )}
            </>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Open it from the page**

In `apps/studio/src/pages/TestCatalog.tsx`:

1. Add below the `TestSheet` import:

```tsx
import { ImportCatalogSheet } from '@/test-catalog/ImportCatalogSheet';
```

2. Below `const [sheet, setSheet] = useState<TestSheetTarget | null>(null);` add:

```tsx
  const [importing, setImporting] = useState(false);
```

3. Replace the options `useEffect` (the one calling `getTestCatalogOptions()`) with:

```tsx
  // Read again after an import, which can add categories.
  const loadOptions = useCallback(() => {
    getTestCatalogOptions()
      .then(setOptions)
      .catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); });
  }, []);

  useEffect(() => { loadOptions(); }, [loadOptions]);
```

4. In the header menu, directly after the `{ownedHere && ( ... add-test ... )}` item, add:

```tsx
                  {ownedHere && (
                    <DropdownMenuItem data-testid="import-tests" onSelect={() => setImporting(true)}>
                      {t('testCatalog.importAction')}
                    </DropdownMenuItem>
                  )}
```

5. Directly after the `<TestSheet ... />` element, add:

```tsx
        <ImportCatalogSheet
          open={importing}
          options={options}
          onClose={() => setImporting(false)}
          onImported={() => { void load(); loadOptions(); }}
        />
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/test-catalog src/pages/TestCatalog.test.tsx src/i18n --testTimeout 30000`

Expected: PASS, every test in those files, the four sheet tests and the i18n parity test included.

- [ ] **Step 7: Typecheck the package**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/s3-t9-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/test-catalog/ImportCatalogSheet.tsx apps/studio/src/test-catalog/ImportCatalogSheet.test.tsx apps/studio/src/pages/TestCatalog.tsx apps/studio/src/pages/TestCatalog.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): import a national test list into the test catalog" -m "The Test catalog page's menu opens a four-step import sheet. File reads a CSV or .xlsx dropped or chosen. Columns shows CE's suggested map for the operator to confirm. Values asks what each unmatched category or specimen means, and a category can be added with a code prefilled from the text. Review shows the counts, the refused rows with their reasons, and whether LOINC was checked. Back, Next, Apply and Close are in the sheet's menu. Nothing is written before Apply. Import shows only where this install owns the catalog."
```

---

### Task 10: docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/test-catalog.md`, `fr/test-catalog.md`, `pt/test-catalog.md`
- Modify: `apps/web/src/docs/0.1.8/test-catalog.md`
- Modify: `apps/web/src/docs/0.1.8/cli.md`

No new docs test: both pages exist since S2, and `src/docs` in each app already checks they render. This task adds sections only.

- [ ] **Step 1: The in-app guides**

Append to `apps/studio/src/docs/0.1.8/en/test-catalog.md`:

````markdown

## Importing a test list

Where this install owns the catalog, choose **Import** from the ⋯ menu. The sheet has four steps. Back, Next, Apply and Close are in its ⋯ menu. Nothing is written before **Apply**.

1. **File.** Drop a CSV or Excel (.xlsx) file, or click to choose one. CE reads the first worksheet of an Excel file. A file holds at most 5,000 tests and 5 MB.
2. **Columns.** CE matches the headers to the fields. Check each one. Name is required. A field set to **Not in the file** is left alone on tests already in the catalog. An empty cell in a chosen column clears that field.
3. **Values.** Category and specimen text match the lists by code or name, ignoring case and spacing. A specimen cell can hold several specimens, split with `;`. Choose what each unmatched text means. A category can be added: its code starts from the text, and you can change it. A row whose text is left unchosen is refused.
4. **Review.** CE shows how many tests are new, changed, unchanged and refused, each refusal with its row and reason, and the categories it will add. Choose **Apply** to write them all at once.

Tests match on their code, so importing the same file twice changes nothing. A test missing from the file is not retired. An import never changes a test's status or this lab's settings. When LOINC is not loaded here, LOINC codes are checked for their format only, and the review says so.

## Exporting the catalog

Choose **Export CSV** from the ⋯ menu. Any install can export, a lab that receives central's catalog included. The file holds the active tests in the columns an import reads: `code`, `name`, `short_name`, `loinc`, `category` and `specimen_types`. Edit it in a spreadsheet and import it back. A value that starts with `=` or `@` gets a leading `'`, so a spreadsheet does not run it as a formula.

From the command line: `openldr test-catalog import <file>` shows what would change, and `--apply` writes it. `openldr test-catalog export` writes the CSV.
````

Append to `apps/studio/src/docs/0.1.8/fr/test-catalog.md`:

````markdown

## Importer une liste d'examens

Si cette installation est propriétaire du catalogue, choisissez **Importer** dans le menu ⋯. Le panneau a quatre étapes. Retour, Suivant, Appliquer et Fermer sont dans son menu ⋯. Rien n'est écrit avant **Appliquer**.

1. **Fichier.** Déposez un fichier CSV ou Excel (.xlsx), ou cliquez pour en choisir un. CE lit la première feuille d'un fichier Excel. Un fichier contient au plus 5 000 examens et 5 Mo.
2. **Colonnes.** CE associe les en-têtes aux champs. Vérifiez chacun. Le nom est obligatoire. Un champ réglé sur **Absent du fichier** ne change pas sur les examens déjà au catalogue. Une cellule vide dans une colonne choisie efface ce champ.
3. **Valeurs.** Les textes de catégorie et de prélèvement sont rapprochés des listes par code ou par nom, sans tenir compte de la casse ni des espaces. Une cellule de prélèvement peut en contenir plusieurs, séparés par `;`. Choisissez ce que signifie chaque texte sans correspondance. Une catégorie peut être ajoutée : son code part du texte, et vous pouvez le changer. Une ligne dont un texte reste sans choix est refusée.
4. **Vérification.** CE indique combien d'examens sont nouveaux, modifiés, inchangés et refusés, chaque refus avec sa ligne et son motif, et les catégories qu'il ajoutera. Choisissez **Appliquer** pour tout écrire en une fois.

Les examens sont rapprochés par leur code : importer deux fois le même fichier ne change rien. Un examen absent du fichier n'est pas retiré. Un import ne change jamais le statut d'un examen ni les réglages de ce laboratoire. Si LOINC n'est pas chargé ici, seul le format des codes LOINC est vérifié, et la vérification le signale.

## Exporter le catalogue

Choisissez **Exporter en CSV** dans le menu ⋯. Toute installation peut exporter, y compris un laboratoire qui reçoit le catalogue du site central. Le fichier contient les examens actifs dans les colonnes qu'un import lit : `code`, `name`, `short_name`, `loinc`, `category` et `specimen_types`. Modifiez-le dans un tableur et importez-le à nouveau. Une valeur qui commence par `=` ou `@` reçoit un `'` en tête, pour qu'un tableur ne l'exécute pas comme une formule.

En ligne de commande : `openldr test-catalog import <fichier>` montre ce qui changerait, et `--apply` l'écrit. `openldr test-catalog export` écrit le CSV.
````

Append to `apps/studio/src/docs/0.1.8/pt/test-catalog.md`:

````markdown

## Importar uma lista de exames

Quando esta instalação é dona do catálogo, escolha **Importar** no menu ⋯. O painel tem quatro passos. Voltar, Seguinte, Aplicar e Fechar estão no seu menu ⋯. Nada é escrito antes de **Aplicar**.

1. **Ficheiro.** Arraste um ficheiro CSV ou Excel (.xlsx), ou clique para escolher um. O CE lê a primeira folha de um ficheiro Excel. Um ficheiro tem no máximo 5000 exames e 5 MB.
2. **Colunas.** O CE associa os cabeçalhos aos campos. Verifique cada um. O nome é obrigatório. Um campo definido como **Não está no ficheiro** não muda nos exames que já estão no catálogo. Uma célula vazia numa coluna escolhida apaga esse campo.
3. **Valores.** Os textos de categoria e de amostra são comparados com as listas pelo código ou pelo nome, sem contar maiúsculas nem espaços. Uma célula de amostra pode ter várias, separadas por `;`. Escolha o que significa cada texto sem correspondência. Pode adicionar uma categoria: o código parte do texto, e pode alterá-lo. Uma linha com texto sem escolha é recusada.
4. **Revisão.** O CE mostra quantos exames são novos, alterados, sem alteração e recusados, cada recusa com a linha e o motivo, e as categorias que vai adicionar. Escolha **Aplicar** para escrever tudo de uma vez.

Os exames são comparados pelo código, por isso importar o mesmo ficheiro duas vezes não muda nada. Um exame que não está no ficheiro não é retirado. Uma importação nunca muda o estado de um exame nem as definições deste laboratório. Quando o LOINC não está carregado aqui, só o formato dos códigos LOINC é verificado, e a revisão indica-o.

## Exportar o catálogo

Escolha **Exportar CSV** no menu ⋯. Qualquer instalação pode exportar, incluindo um laboratório que recebe o catálogo do nível central. O ficheiro tem os exames ativos nas colunas que uma importação lê: `code`, `name`, `short_name`, `loinc`, `category` e `specimen_types`. Edite-o numa folha de cálculo e importe-o de novo. Um valor que começa por `=` ou `@` recebe um `'` no início, para que uma folha de cálculo não o execute como fórmula.

Na linha de comandos: `openldr test-catalog import <ficheiro>` mostra o que mudaria, e `--apply` escreve-o. `openldr test-catalog export` escreve o CSV.
````

- [ ] **Step 2: The web page**

In `apps/web/src/docs/0.1.8/test-catalog.md`, add a paragraph after the last paragraph of each language section.

After the English paragraph that starts `A LOINC code is searched`:

```markdown

Import a national list from a CSV or Excel (.xlsx) file with **Import** in the page's ⋯ menu, where this install owns the catalog. The sheet reads the file, matches its headers to the fields for you to check, asks what each unmatched category or specimen means, and shows new, changed, unchanged and refused rows before anything is written. A file holds at most 5,000 tests. Tests match on their code, so the same file twice changes nothing, and a test missing from the file is not retired. **Export CSV** writes the active tests in the same columns, so an export imports back as it is.
```

After the French paragraph that starts `Un code LOINC est recherché`:

```markdown

Importez une liste nationale depuis un fichier CSV ou Excel (.xlsx) avec **Importer** dans le menu ⋯ de la page, si cette installation est propriétaire du catalogue. Le panneau lit le fichier, associe ses en-têtes aux champs pour que vous les vérifiiez, demande ce que signifie chaque catégorie ou prélèvement sans correspondance, et montre les lignes nouvelles, modifiées, inchangées et refusées avant toute écriture. Un fichier contient au plus 5 000 examens. Les examens sont rapprochés par leur code : le même fichier importé deux fois ne change rien, et un examen absent du fichier n'est pas retiré. **Exporter en CSV** écrit les examens actifs dans les mêmes colonnes, pour qu'un export s'importe tel quel.
```

After the Portuguese paragraph that starts `Um código LOINC é pesquisado`:

```markdown

Importe uma lista nacional de um ficheiro CSV ou Excel (.xlsx) com **Importar** no menu ⋯ da página, quando esta instalação é dona do catálogo. O painel lê o ficheiro, associa os cabeçalhos aos campos para que os verifique, pergunta o que significa cada categoria ou amostra sem correspondência, e mostra as linhas novas, alteradas, sem alteração e recusadas antes de escrever qualquer coisa. Um ficheiro tem no máximo 5000 exames. Os exames são comparados pelo código: o mesmo ficheiro importado duas vezes não muda nada, e um exame que não está no ficheiro não é retirado. **Exportar CSV** escreve os exames ativos nas mesmas colunas, para que uma exportação se importe tal como está.
```

- [ ] **Step 3: The CLI reference**

In `apps/web/src/docs/0.1.8/cli.md`, change the `test-catalog` row of the command groups table to:

```markdown
| `test-catalog` | The national test catalog: `list` the tests, `import` a list from CSV or Excel, `export` it as CSV, `enable` or `disable` one at this lab, and `retire` or `restore` one where this install owns the catalog. |
```

After the English paragraph that ends `Each is recorded in the audit log as the CLI user.`, add:

````markdown

Import a test list from a CSV or Excel (.xlsx) file:

```sh
openldr test-catalog import national-tests.xlsx
openldr test-catalog import national-tests.xlsx --value-map answers.json --apply
```

Without `--apply` nothing is written. The command prints the counts of new, changed, unchanged and refused rows, each refusal with its row number, and any category or specimen text that matched nothing. Columns are matched by their header. To name them yourself, pass `--column-map` with a JSON file such as `{"code": "Test code", "name": "Test name"}`. Answer unmatched text with `--value-map`:

```json
{
  "categories": [{ "text": "Virology", "kind": "new", "code": "VIRO", "display": "Virology" }],
  "specimens": [{ "text": "Plasma", "system": "urn:openldr:cs:local", "code": "BLD" }]
}
```

A category answer is `"kind": "existing"` with a `code`, or `"kind": "new"` with a `code` and a `display`. Only an install that owns the catalog can import. An apply is recorded in the audit log as the CLI user. Export the active tests as CSV, to standard output or to a file:

```sh
openldr test-catalog export --out catalog.csv
```
````

After the French paragraph that ends `Chacune est inscrite au journal d'audit au nom de l'utilisateur de la CLI.`, add:

````markdown

Importer une liste d'examens depuis un fichier CSV ou Excel (.xlsx) :

```sh
openldr test-catalog import national-tests.xlsx
openldr test-catalog import national-tests.xlsx --value-map answers.json --apply
```

Sans `--apply`, rien n'est écrit. La commande affiche le nombre de lignes nouvelles, modifiées, inchangées et refusées, chaque refus avec son numéro de ligne, et tout texte de catégorie ou de prélèvement sans correspondance. Les colonnes sont associées par leur en-tête. Pour les nommer vous-même, passez `--column-map` avec un fichier JSON comme `{"code": "Test code", "name": "Test name"}`. Répondez aux textes sans correspondance avec `--value-map` :

```json
{
  "categories": [{ "text": "Virology", "kind": "new", "code": "VIRO", "display": "Virology" }],
  "specimens": [{ "text": "Plasma", "system": "urn:openldr:cs:local", "code": "BLD" }]
}
```

Une réponse de catégorie est `"kind": "existing"` avec un `code`, ou `"kind": "new"` avec un `code` et un `display`. Seule une installation propriétaire du catalogue peut importer. Une application est inscrite au journal d'audit au nom de l'utilisateur de la CLI. Exporter les examens actifs en CSV, vers la sortie standard ou un fichier :

```sh
openldr test-catalog export --out catalog.csv
```
````

After the Portuguese paragraph that ends `Cada um fica no registo de auditoria em nome do utilizador da CLI.`, add:

````markdown

Importar uma lista de exames de um ficheiro CSV ou Excel (.xlsx):

```sh
openldr test-catalog import national-tests.xlsx
openldr test-catalog import national-tests.xlsx --value-map answers.json --apply
```

Sem `--apply` nada é escrito. O comando mostra o número de linhas novas, alteradas, sem alteração e recusadas, cada recusa com o número da linha, e qualquer texto de categoria ou de amostra sem correspondência. As colunas são associadas pelo cabeçalho. Para as indicar, passe `--column-map` com um ficheiro JSON como `{"code": "Test code", "name": "Test name"}`. Responda aos textos sem correspondência com `--value-map`:

```json
{
  "categories": [{ "text": "Virology", "kind": "new", "code": "VIRO", "display": "Virology" }],
  "specimens": [{ "text": "Plasma", "system": "urn:openldr:cs:local", "code": "BLD" }]
}
```

Uma resposta de categoria é `"kind": "existing"` com um `code`, ou `"kind": "new"` com um `code` e um `display`. Só uma instalação dona do catálogo pode importar. Uma aplicação fica no registo de auditoria em nome do utilizador da CLI. Exportar os exames ativos em CSV, para a saída padrão ou para um ficheiro:

```sh
openldr test-catalog export --out catalog.csv
```
````

- [ ] **Step 4: Run the docs tests**

Run: `cd apps/studio && npx vitest run src/docs --testTimeout 30000`

Run: `cd apps/web && npx vitest run src/docs --testTimeout 30000`

Expected: PASS in both.

- [ ] **Step 5: Check the new prose for em dashes**

Use the Grep tool with the em dash character (U+2014) as the pattern, over the five changed docs files.

Expected: no match in any added line.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/test-catalog.md apps/studio/src/docs/0.1.8/fr/test-catalog.md apps/studio/src/docs/0.1.8/pt/test-catalog.md apps/web/src/docs/0.1.8/test-catalog.md apps/web/src/docs/0.1.8/cli.md
git commit -m "docs(test-catalog): document importing and exporting the test catalog" -m "The in-app guide and the web page, in English, French and Portuguese, say how the four import steps work, what a mapped or unmapped column does, why the same file twice changes nothing, and what the export holds. The CLI reference adds import with its --column-map and --value-map files, and export."
```

---

### Task 11: gate and report

**Files:** none changed.

- [ ] **Step 1: Confirm no migration was added**

Run: `git diff --name-only main... -- packages/db/src/migrations`

Expected: no output.

- [ ] **Step 2: Run the forced gate**

Run: `pnpm turbo run typecheck --force --concurrency=4 > "$TEMP/s3-gate-tc.txt" 2>&1; echo "exit=$?"`

Run: `pnpm turbo run test --force --concurrency=4 --continue > "$TEMP/s3-gate-test.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src > "$TEMP/s3-gate-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` three times. On a test failure, grep `$TEMP/s3-gate-test.txt` for `Test timed out` and `FAIL`, then re-run that package alone before blaming a change.

- [ ] **Step 3: Report, then stop**

Report to the operator:

1. The gate's three exit codes, and each package's test count from the turbo summary.
2. What each layer proves:
   - `table-file.test.ts`: the reader's own rules, a 15-digit General number and padded zeros included. Built with SheetJS, not with Excel.
   - `test-catalog-import.test.ts`: header suggestion, row reading, value matching, the export layout and the shared schemas. Pure functions.
   - `test-catalog.test.ts` (pg-mem): preview counts and reasons, answers, a mapped empty cell clearing and an unmapped column kept, status and lab settings untouched, the same file twice, the export round trip, one transaction opened for the writes, and one sync signal per system after it.
   - `terminology-admin-store.test.ts` (pg-mem): `saveExclusive` and `update` open no transaction when given one.
   - `test-catalog-routes.test.ts`: the four routes' wire shapes, permissions, the 5 MB count, the 16 MiB body, and the audit entry.
   - CLI tests: preview by default, `--apply`, map files checked with the route's schemas, export to stdout or a file, and commander's parsing.
   - Studio tests: the client calls, the four steps, the answers sent, Apply disabled with nothing to write, and the page menu at owning and central-fed installs.
3. **HONEST NON-PROOF**, each with what would prove it:
   - Rollback. pg-mem does not roll back on a thrown error, so no test shows a failed import leaves nothing behind. A Postgres run that forces a failure part way would.
   - An .xlsx saved by real Excel, LibreOffice or Google Sheets. Tests build workbooks with SheetJS. Importing a real national list during the live check would.
   - The page and sheet in a browser, at desktop width and at 375px. The live check after merging would. A real phone was not used.
   - The CLI against Postgres. `openldr test-catalog import` and `export` run on the dev database would.
   - The live check needs `AUTH_DEV_BYPASS` and the dev servers, and a scratch test or file. Say so before starting it.
4. Anything skipped or changed from this plan, and why.

Then ask the operator before merging, pushing, or running the live check. After a merge to `main`, run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json` (AGENTS.md section 6, item 5).
