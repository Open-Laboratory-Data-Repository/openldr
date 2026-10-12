# Result status in the warehouse implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry `Observation.status` and `Observation.dataAbsentReason` into three new `lab_results` columns, so a rejected test is no longer an empty result row, and leave rejected tests off the Observed Results list.

**Architecture:** External migration `024` adds `status`, `data_absent_code` and `data_absent_reason` to `lab_results`. `projectObservation` fills them, using the existing `codeable()` helper for the reason. The result-level scan behind the Observed list counts only rows whose status is null or not `cancelled`. Docs tell report authors how to count results and rejections, and that upgraded installs run `openldr db reproject --force` once.

**Tech stack:** TypeScript, Kysely (Postgres, MSSQL, MySQL warehouse), Vitest with pg-mem.

**Spec:** `docs/superpowers/specs/2026-10-12-lab-result-status-design.md`. Read it before Task 1.

**Worktree:** `.claude/worktrees/lab-result-status`, branch `feat/lab-result-status`. Every command below runs from that directory. Never `cd` to the main checkout.

## Global constraints

- Column names, exactly: `status`, `data_absent_code`, `data_absent_reason`. All nullable text.
- `status` = `Observation.status`. `data_absent_code` = `codeable(dataAbsentReason).code`. `data_absent_reason` = `codeable(dataAbsentReason).text` (that is `dataAbsentReason.text`, else `coding[0].display`).
- The reason's code system is not stored.
- External migration number `024`, name `024_lab_result_status`. Before Task 1, run `git branch -a --no-merged main` and check no branch adds a `024_` external migration.
- A row counts as a result when `status is null or status <> 'cancelled'`. A null status is a result.
- No backfill code. Upgraded installs run `openldr db reproject --force`.
- Docs in en, fr and pt where the page has those languages. No em dashes in new prose.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`. Never read `$?` through a pipe.
- No `Co-Authored-By` trailers. Commit only when the operator has said to commit.

## Review focus

Inputs the spec implies but no other test pins. Each has a test in the owning task.

1. **A code with both real results and a rejected test.** Expect the Observed list to count only the results. Task 2.
2. **A code whose only rows are rejected tests.** Expect it absent from the Observed list and its system absent from Map matching codes' system list. Task 2.
3. **A row projected before the upgrade, with a null status.** Expect it counted as a result. Task 2.
4. **A cancelled Observation with no `dataAbsentReason`.** Expect `status = 'cancelled'` and both reason columns null, no crash. Task 1.
5. **A `dataAbsentReason` with only `text`.** Expect the text in `data_absent_reason` and a null code. Task 1.

## File map

| File | Responsibility |
|---|---|
| `packages/db/src/migrations/external/024_lab_result_status.ts` (create) | The three columns. |
| `packages/db/src/migrations/external/024_lab_result_status.test.ts` (create) | Round-trip on Postgres. |
| `packages/db/src/migrations/external/index.ts`, `packages/db/src/migrations/migrations.test.ts` (modify) | Register and pin `024`. |
| `packages/db/src/schema/external.ts` (modify) | `LabResultsTable` and `EXTERNAL_TABLE_COLUMNS.lab_results`. |
| `packages/db/src/relational/observation.ts`, `observation.test.ts` (modify) | Projection. |
| `packages/db/src/relational-writer.test.ts` (modify) | A rejection reaches the table. |
| `packages/bootstrap/src/test-mapping.ts` (modify) | The result-level scan skips cancelled rows. |
| `packages/bootstrap/src/test-support/test-mapping-fixture.ts`, `packages/bootstrap/src/test-mapping-result.test.ts` (modify) | Fixture status option and the list test. |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/advanced-docs.md`, `apps/web/src/docs/0.1.8/load-data.md` (modify) | Docs. |

---

### Task 1: The columns and the projection

**Files:**
- Create: `packages/db/src/migrations/external/024_lab_result_status.ts`
- Create: `packages/db/src/migrations/external/024_lab_result_status.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts` (about lines 25 and 51)
- Modify: `packages/db/src/migrations/migrations.test.ts:15`
- Modify: `packages/db/src/schema/external.ts` (`LabResultsTable` at about line 59, `EXTERNAL_TABLE_COLUMNS.lab_results` at about line 301)
- Modify: `packages/db/src/relational/observation.ts`
- Modify: `packages/db/src/relational/observation.test.ts`
- Modify: `packages/db/src/relational-writer.test.ts`

**Interfaces:**
- Consumes: `codeable` and `str` from `packages/db/src/relational/extract.ts`, `textType` from `packages/db/src/migrations/external/dialect.ts`.
- Produces: `LabResultsTable.status`, `.data_absent_code`, `.data_absent_reason` (all `string | null`), which Task 2's Kysely query uses.

- [ ] **Step 1: Write the failing projection tests**

Append to `packages/db/src/relational/observation.test.ts`:

```ts
describe('projectObservation status and missing-value reason', () => {
  const rejected = (extra: Record<string, unknown> = {}) => ({
    resourceType: 'Observation', id: 'o2', status: 'cancelled',
    code: { coding: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'CHEM-GLU' }] },
    ...extra,
  });

  it('carries a final result with no reason', () => {
    expect(projectObservation(obs({ value: 540 }), {})).toMatchObject({ status: 'final', data_absent_code: null, data_absent_reason: null });
  });

  it('carries a rejected test as cancelled, with its reason and no value', () => {
    const row = projectObservation(rejected({
      dataAbsentReason: { coding: [{ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }] },
    }), {});
    expect(row).toMatchObject({ status: 'cancelled', data_absent_code: 'HAEM', data_absent_reason: 'Haemolysed', result_type: null, numeric_value: null });
  });

  // Review focus 4.
  it('leaves both reason columns empty for a cancelled row with no reason', () => {
    expect(projectObservation(rejected(), {})).toMatchObject({ status: 'cancelled', data_absent_code: null, data_absent_reason: null });
  });

  // Review focus 5.
  it('keeps a reason that has only text', () => {
    expect(projectObservation(rejected({ dataAbsentReason: { text: 'Sample lost' } }), {})).toMatchObject({ data_absent_code: null, data_absent_reason: 'Sample lost' });
  });

  it('leaves status null when the Observation has none', () => {
    expect(projectObservation({ resourceType: 'Observation', id: 'o3', code: { coding: [{ code: 'X' }] } }, {}).status).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing migration and writer tests**

Create `packages/db/src/migrations/external/024_lab_result_status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { sql } from 'kysely';

describe('024_lab_result_status', () => {
  it('round-trips status and the missing-value reason on lab_results', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_results (id, status, data_absent_code, data_absent_reason) values ('o-1', 'cancelled', 'HAEM', 'Haemolysed')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select status, data_absent_code, data_absent_reason from lab_results where id = 'o-1'`.execute(db);
    expect(rows.rows).toEqual([{ status: 'cancelled', data_absent_code: 'HAEM', data_absent_reason: 'Haemolysed' }]);
  });

  it('reads NULL for a row written without them', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_results (id, numeric_value) values ('o-2', 540)`.execute(db);
    const rows = await sql<Record<string, unknown>>`select status, data_absent_code, data_absent_reason from lab_results where id = 'o-2'`.execute(db);
    expect(rows.rows).toEqual([{ status: null, data_absent_code: null, data_absent_reason: null }]);
  });
});
```

Append inside the `describe('relational-writer', ...)` block of `packages/db/src/relational-writer.test.ts`:

```ts
  it('writes a rejected test with its status and reason', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    expect(await w.write({
      resourceType: 'Observation', id: 'o-rej', status: 'cancelled',
      code: { coding: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'CHEM-GLU' }] },
      dataAbsentReason: { coding: [{ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }] },
    }, {})).toBe('written');
    const rows = await db.selectFrom('lab_results').select(['status', 'data_absent_code', 'data_absent_reason', 'numeric_value']).execute();
    expect(rows).toEqual([{ status: 'cancelled', data_absent_code: 'HAEM', data_absent_reason: 'Haemolysed', numeric_value: null }]);
    await db.destroy();
  });
```

In `packages/db/src/migrations/migrations.test.ts:15`, append `'024_lab_result_status'` to the end of the external list, after `'023_test_map'`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd packages/db && npx vitest run src/relational/observation.test.ts src/migrations/external/024_lab_result_status.test.ts src/relational-writer.test.ts src/migrations/migrations.test.ts`
Expected: FAIL. The projection has no `status`, the migration module does not exist, and the migration list lacks `024`.

- [ ] **Step 4: Add the migration**

Create `packages/db/src/migrations/external/024_lab_result_status.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// A result's FHIR status and its reason for a missing value (docs/superpowers/specs/2026-10-12-
// lab-result-status-design.md). A test the bench rejects is a cancelled Observation carrying a
// dataAbsentReason; without these columns it reached the warehouse as an empty result row.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  await db.schema.alterTable('lab_results').addColumn('status', text).execute();
  await db.schema.alterTable('lab_results').addColumn('data_absent_code', text).execute();
  await db.schema.alterTable('lab_results').addColumn('data_absent_reason', text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('lab_results').dropColumn('data_absent_reason').execute();
  await db.schema.alterTable('lab_results').dropColumn('data_absent_code').execute();
  await db.schema.alterTable('lab_results').dropColumn('status').execute();
}
```

In `packages/db/src/migrations/external/index.ts`, add the import after `import * as m023 from './023_test_map';`:

```ts
import * as m024 from './024_lab_result_status';
```

and the entry after the `'023_test_map'` entry:

```ts
    '024_lab_result_status': { up: (db) => m024.up(db, engine), down: m024.down },
```

- [ ] **Step 5: Add the schema columns**

In `packages/db/src/schema/external.ts`, in `LabResultsTable`, after `specimen_id: string | null;`:

```ts
  /** Observation.status. A test the bench rejects is 'cancelled'. Null on rows projected before 024. */
  status: string | null;
  /** Observation.dataAbsentReason code, for example a reject reason. */
  data_absent_code: string | null;
  /** Observation.dataAbsentReason text, else its first coding's display. */
  data_absent_reason: string | null;
```

In `EXTERNAL_TABLE_COLUMNS.lab_results`, insert `'status', 'data_absent_code', 'data_absent_reason'` right after `'specimen_id'`.

- [ ] **Step 6: Fill the columns in the projection**

In `packages/db/src/relational/observation.ts`, inside `projectObservation`, add after `const interpretation = ...`:

```ts
  // A rejected test is a cancelled Observation whose dataAbsentReason says why (bench result entry).
  const absent = codeable(r['dataAbsentReason']);
```

and add to the returned object, after `specimen_id: referenceId(r['specimen']),`:

```ts
    status: str(r['status']),
    data_absent_code: absent.code,
    data_absent_reason: absent.text,
```

- [ ] **Step 7: Run the tests**

Run: `cd packages/db && npx vitest run src/relational src/migrations src/relational-writer.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and run the package suite**

Run: `cd packages/db && npx tsc --noEmit > /tmp/tc-db.txt 2>&1; echo "exit=$?"`
Run: `cd packages/db && npx vitest run > /tmp/db-tests.txt 2>&1; echo "exit=$?"`
Expected: both `exit=0`. If a test that compares a whole `lab_results` row or the full column list now fails because of the three new columns, add the columns to its expectation and name the test in the task report. If it is a timeout, re-run that file alone.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/migrations/external/024_lab_result_status.ts packages/db/src/migrations/external/024_lab_result_status.test.ts packages/db/src/migrations/external/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/external.ts packages/db/src/relational/observation.ts packages/db/src/relational/observation.test.ts packages/db/src/relational-writer.test.ts
git commit -m "feat(db): carry a result's status and missing-value reason into lab_results"
```

Add any other test file Step 8 had to change.

---

### Task 2: Leave rejected tests off the Observed Results list

**Files:**
- Modify: `packages/bootstrap/src/test-mapping.ts` (`scanResultGroups`)
- Modify: `packages/bootstrap/src/test-support/test-mapping-fixture.ts` (`seedResult`)
- Modify: `packages/bootstrap/src/test-mapping-result.test.ts`

**Interfaces:**
- Consumes: `LabResultsTable.status` from Task 1.
- Produces: `seedResult(db, id, system, code, desc, createdAt, opts?: { status?: string | null })`. Existing callers pass no `opts` and keep writing a null status.

- [ ] **Step 1: Give the fixture a status option**

In `packages/bootstrap/src/test-support/test-mapping-fixture.ts`, replace `seedResult` with:

```ts
export async function seedResult(db: Kysely<any>, id: string, system: string | null, code: string | null, desc: string | null, createdAt: string, opts: { status?: string | null } = {}) {
  await db.insertInto('lab_results').values({
    id, observation_system: system, observation_code: code, observation_desc: desc, created_at: createdAt, status: opts.status ?? null,
  }).execute();
}
```

- [ ] **Step 2: Write the failing test**

Append to the `describe('test mapping: observed lists per level', ...)` block in `packages/bootstrap/src/test-mapping-result.test.ts`:

```ts
  // Review focus 1, 2 and 3.
  it('counts results only: a rejected test is left out, a row with no status is kept', async () => {
    const { externalDb, mapping } = await buildMapping();
    await seedResult(externalDb, 'o1', DISA, 'HIVVL', 'HIV VL', '2026-05-01T08:00:00Z', { status: 'final' });
    await seedResult(externalDb, 'o2', DISA, 'HIVVL', 'HIV VL', '2026-05-02T08:00:00Z', { status: 'cancelled' });
    await seedResult(externalDb, 'o3', DISA, 'HIVVL', 'HIV VL', '2026-05-03T08:00:00Z');
    await seedResult(externalDb, 'o4', 'urn:openldr:codesystem:test-catalog', 'CHEM-GLU', null, '2026-05-01T08:00:00Z', { status: 'cancelled' });

    const out = await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 }, 'result');

    expect(out.rows.map((r) => [r.system, r.code, r.requests])).toEqual([[DISA, 'HIVVL', 2]]);
    expect(await mapping.observedSystems('result')).toEqual([DISA]);
  });
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-result.test.ts`
Expected: FAIL. `HIVVL` counts 3, and `CHEM-GLU` is listed.

- [ ] **Step 4: Filter the scan**

In `packages/bootstrap/src/test-mapping.ts`, in `scanResultGroups`, add after the `.where('observation_system', '!=', RESULT_PARAM_SYSTEM)` line:

```ts
      // A test the bench rejects is a cancelled Observation, not a result. A null status is a row
      // projected before migration 024 and counts as a result.
      .where((eb) => eb.or([eb('status', 'is', null), eb('status', '<>', 'cancelled')]))
```

- [ ] **Step 5: Run the mapping tests**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping`
Expected: PASS, every existing result-level test included. Their rows have a null status, which still counts.

- [ ] **Step 6: Typecheck**

Run: `cd packages/bootstrap && npx tsc --noEmit > /tmp/tc-bootstrap.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/test-mapping.ts packages/bootstrap/src/test-support/test-mapping-fixture.ts packages/bootstrap/src/test-mapping-result.test.ts
git commit -m "fix(bootstrap): rejected tests are not result codes on the Observed list"
```

---

### Task 3: Docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/advanced-docs.md`, `fr/advanced-docs.md`, `pt/advanced-docs.md`
- Modify: `apps/web/src/docs/0.1.8/load-data.md`

**Interfaces:** none.

- [ ] **Step 1: Write the English paragraph**

In `apps/studio/src/docs/0.1.8/en/advanced-docs.md`, in "Request facts and request attributes", add this paragraph right after the paragraph that explains `lab_results.numeric_comparator` (it ends "`numeric_value` holds the limit in that case."), with one blank line on each side:

```markdown
Each result carries its FHIR status in `lab_results.status`. A test rejected at result entry is stored as a row with status `cancelled`, no value, and the reason in `data_absent_code` and `data_absent_reason`, for example `HAEM` and `Haemolysed`. To count results, add `(status is null or status <> 'cancelled')` to the query. To count rejected tests, use `status = 'cancelled'`. An install upgraded from an earlier version has no status on the rows it already held. Run `openldr db reproject --force` once after upgrading to fill them in.
```

In `apps/web/src/docs/0.1.8/load-data.md`, add the same English paragraph right after its `numeric_comparator` paragraph (about line 247-249).

- [ ] **Step 2: Write the French and Portuguese paragraphs**

In `apps/studio/src/docs/0.1.8/fr/advanced-docs.md`, right after the paragraph that explains `lab_results.numeric_comparator` (it ends "`numeric_value` contient alors la limite."):

```markdown
Chaque résultat porte son statut FHIR dans `lab_results.status`. Un test rejeté à la saisie des résultats est enregistré comme une ligne au statut `cancelled`, sans valeur, avec la raison dans `data_absent_code` et `data_absent_reason`, par exemple `HAEM` et `Haemolysed`. Pour compter les résultats, ajoutez `(status is null or status <> 'cancelled')` à la requête. Pour compter les tests rejetés, utilisez `status = 'cancelled'`. Une installation mise à niveau depuis une version antérieure n'a pas de statut sur les lignes qu'elle contenait déjà. Lancez `openldr db reproject --force` une fois après la mise à niveau pour les remplir.
```

In `apps/studio/src/docs/0.1.8/pt/advanced-docs.md`, right after the paragraph that explains `lab_results.numeric_comparator` (it ends "`numeric_value` guarda o limite nesse caso."):

```markdown
Cada resultado traz o seu estado FHIR em `lab_results.status`. Um teste rejeitado na introdução de resultados fica guardado como uma linha com estado `cancelled`, sem valor, e com o motivo em `data_absent_code` e `data_absent_reason`, por exemplo `HAEM` e `Haemolysed`. Para contar resultados, acrescente `(status is null or status <> 'cancelled')` à consulta. Para contar testes rejeitados, use `status = 'cancelled'`. Uma instalação atualizada a partir de uma versão anterior não tem estado nas linhas que já tinha. Execute `openldr db reproject --force` uma vez depois de atualizar para as preencher.
```

- [ ] **Step 3: Run the docs tests**

Run: `cd apps/studio && npx vitest run src/docs`
Run: `cd apps/web && npx vitest run src/docs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/advanced-docs.md apps/studio/src/docs/0.1.8/fr/advanced-docs.md apps/studio/src/docs/0.1.8/pt/advanced-docs.md apps/web/src/docs/0.1.8/load-data.md
git commit -m "docs: result status and rejected tests in lab_results"
```

---

### Task 4: Gate, live check, changelog

**Files:** none, unless the gate finds something.

- [ ] **Step 1: Run the full gate**

Run, in this order, each to its own file:

```bash
pnpm turbo run test --force --concurrency=2 --continue > /tmp/gate-test.txt 2>&1; echo "test exit=$?"
pnpm turbo run typecheck --force --concurrency=2 > /tmp/gate-tc.txt 2>&1; echo "typecheck exit=$?"
pnpm --filter @openldr/server lint > /tmp/gate-lint.txt 2>&1; echo "lint exit=$?"
```

Expected: all three `exit=0` and `Cached: 0 cached`. If a package fails, grep its output for `out of memory`, `VirtualAlloc`, `Zone Allocation failed` and `Test timed out`, and re-run that package alone before treating it as a regression.

- [ ] **Step 2: Live check on the dev CE**

This needs the work merged to `main`, because the dev servers run from the main checkout. Ask the operator before merging. Then:

1. Confirm the API restarted after the merge (nodemon) and that migration 024 ran: `select column_name from information_schema.columns where table_name = 'lab_results' and column_name in ('status', 'data_absent_code', 'data_absent_reason')` on the warehouse returns three rows.
2. Ingest a scratch FHIR bundle with `node_modules/.bin/tsx packages/cli/src/index.ts ingest <file> --source zzrs-live --json`. It holds one Patient `zzrs-p1`, one ServiceRequest `zzrs-sr1` (system `urn:openldr:zzrs`), one final Observation `zzrs-o1` (code `ZZVAL`, a value) and one cancelled Observation `zzrs-o2` (code `ZZREJ`, `dataAbsentReason` coding `HAEM`, display `Haemolysed`), both based on the order.
3. Check the warehouse: `zzrs-o1` has status `final` and no reason; `zzrs-o2` has status `cancelled`, `data_absent_code` `HAEM`, `data_absent_reason` `Haemolysed`.
4. On the Test catalog page, Observed tab, Results mode: `ZZVAL` is listed with 1 result, `ZZREJ` is not. The match sheet's system list does not offer a system that has only cancelled rows.
5. Run `openldr db reproject --force` and confirm both rows keep their status. This is the upgrade path the docs give.
6. If the bench is set up on the dev CE, also reject one test on a bench order and confirm its row. Otherwise report that the bench path was not exercised.
7. Clean up the scratch rows: `fhir.fhir_resources`, `fhir.resource_history` and `fhir.change_log` for ids `zzrs-%`, the `ingest_batches` row for source `zzrs-live`, and in the warehouse `lab_results`, `lab_requests`, `patients` and `ingest_events` for ids `zzrs-%`.

Report what was checked live and what was not. MSSQL and MySQL stay an honest non-proof: migration 024 is checked as compiled SQL only.

- [ ] **Step 3: Changelog**

After merging to `main`: run `pnpm make:changelog`, check the new entries, and commit `apps/web/src/landing/changelog.json`.

---

## Self-review

| Spec | Task |
|---|---|
| 4.1 Columns, migration 024, `EXTERNAL_TABLE_COLUMNS` | 1 |
| 4.2 Projection | 1 |
| 4.3 Observed Results filter | 2 |
| 4.3 Shipped reports unchanged | No task, by design |
| 4.3 Docs for report authors | 3 |
| 4.4 Existing installs and reproject | 3 (docs), 4 (live check step 5) |
| 4.5 Errors: no status, text-only reason, several codings | 1 (first two tested; first coding is `codeable()`'s rule) |
| 5 Tests | 1, 2, 4 |
| 6 Done | UI 2, CLI none, docs 3, mobile none, changelog 4 |

Names used across tasks: the three column names (Task 1, used by Task 2's query and Task 3's docs), and `seedResult`'s new `opts.status` (Task 2 only).
