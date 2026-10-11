# Result field mapping implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map each lab's own result codes to the site's result dictionary, give each dictionary field an optional LOINC link, and copy both into the warehouse table `test_map` with `level = 'result'`.

**Architecture:** Slice 1's module `packages/bootstrap/src/test-mapping.ts` gains a `level` argument on every function, defaulting to `'test'`, so slice 1's callers keep working. The rebuild writes both levels and a self row for every catalog test and every dictionary field. A new module `result-fields.ts` owns the dictionary list and its LOINC links. Routes, CLI and the content pack installer call these two modules. The studio gets a Results mode on the Observed tab, a Map matching codes sheet, and a Result fields tab.

**Tech stack:** TypeScript, Kysely (Postgres, MSSQL, MySQL warehouse), Fastify, Commander, React with shadcn and Radix, Vitest with pg-mem, react-i18next.

**Spec:** `docs/superpowers/specs/2026-10-11-result-field-mapping-design.md`. Read it before Task 1. Slice 1's spec `docs/superpowers/specs/2026-10-11-test-mapping-design.md` explains the code this plan changes.

**Worktree:** `.claude/worktrees/result-field-mapping`, branch `feat/result-field-mapping`. Every command below runs from that directory. Never `cd` to the main checkout.

## Global constraints

- Result dictionary system: `urn:openldr:default_result` (`RESULT_PARAM_SYSTEM`, exported by `@openldr/terminology`).
- Catalog system: `urn:openldr:codesystem:test-catalog` (`TEST_CATALOG_SYSTEM`, `packages/bootstrap/src/test-catalog.ts:30`).
- A result mapping: `from_system` = `lab_results.observation_system`, `from_code` = `lab_results.observation_code`, `to_system` = `RESULT_PARAM_SYSTEM`, `map_type` = `'SAME-AS'`.
- A field's LOINC link: `from_system` = `RESULT_PARAM_SYSTEM`, `to_system` = `http://loinc.org` (`LOINC_SYSTEM`), `map_type` = `'SAME-AS'`.
- Every `level` argument defaults to `'test'`. A caller that passes nothing gets slice 1's behaviour.
- Codes match exactly. No trimming, no case folding.
- `test_map` is rebuilt delete-then-insert in one transaction, both levels together. 200 rows per insert (MSSQL's ~2,000 bound parameters, 9 columns).
- No migration. External migration 023 already has `test_map.level`.
- Refusals are `TestCatalogError` with kind `invalid`, `not-found` or `central-managed`. Routes answer 400, 404 and 409 with `{ error, kind }`.
- Studio rules (AGENTS.md section 5): actions in a `MoreHorizontal` `DropdownMenu`, Sheets not Dialogs, labels left and inputs right, `TablePagination` on every `<Table>`, `LoadingState` and `StripedEmpty` in the data area at `min-h-[16rem]`, shadcn components only, no native `<select>`, `<button>` or `<input>`.
- Every user-facing string exists in `en.ts`, `fr.ts` and `pt.ts`. French strings use the typographic apostrophe `’`, as the file already does.
- Destructive CLI commands refuse without `--force`. CLI audit uses `cliActor()`.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`. Never read `$?` through a pipe.
- No `Co-Authored-By` trailers. Commit only when the operator has said to commit.

## Where this plan departs from the spec

Each comes from code the spec did not account for. Task 12 records them in the spec.

1. **The CLI group is `openldr test-catalog result-fields`, not `params`.** `openldr test-catalog params <code>` already exists. It lists or replaces one test's result parameters (`packages/cli/src/program.ts:391-398`), so `params list` would read `list` as a test code.
2. **The Observed list leaves out the catalog's own system in Tests mode too.** CE's own orders carry catalog codes (`packages/db/src/migrations/internal/105_lab_order_test_catalog.ts:5-14`). With self rows they are mapped already, and listing them as Unmapped would invite a mapping the routes refuse.
3. **The dictionary import exists only in the CLI** (`packages/cli/src/terminology.ts:41-50`), through `createTerminologyContext`, which opens no warehouse. So the CLI opens the app context after the import and rebuilds once. The Result fields empty state names that command, not a Terminology page import.
4. **The mapping routes keep the body field `catalogCode`** for the target code at both levels, and take an optional `level`. Renaming it would break slice 1's clients.
5. **Audit actions stay `test_mapping.set`, `.clear`, `.import` and `.pack`, with `metadata.level`.** Map matching codes audits `test_mapping.match`. Result fields audit `result_field.link`, `result_field.unlink` and `result_field.import`.
6. **A result-fields CSV preview is refused too** on a lab whose dictionary came from central, not only the apply.
7. **Last seen on the Results list is the newest `lab_results.created_at`,** the time the row reached the warehouse. cdr sends no result time (`result_timestamp` is a hardcoded null, `cdr-toolchain/apps/cli/src/export/fhir-transform.ts:508`).
8. **The rebuild result keeps slice 1's top-level fields for the test level,** and adds `results` (the same counts for result codes) and `selfRows`. `written` counts every row.

## Review focus

Inputs the spec implies but no other test pins. Each has a test in the owning task.

1. **A term mapping already exists from the target system to itself,** made through the general Terminology dialog. Expect the rebuild to ignore it. If it did not, it would collide with the self row on the primary key and every rebuild would fail. Task 1.
2. **No dictionary is loaded.** Expect the rebuild to write test rows only, the Result fields list to say `loaded: false`, and Map matching codes to find nothing. Tasks 1, 4, 5.
3. **Map matching codes meets a code that is ambiguous, or that central has mapped.** Expect it left out of the preview. Task 4.
4. **The test-level CSV is fed to the result-level import** (it has `catalog_code`, no `parameter_code`). Expect a refusal naming the missing column, not a silent "unchanged" for every row. Task 3.
5. **A pack's `result-mappings` entry names the dictionary's own system.** Expect it skipped with a reason, not written. Task 4.

## File map

| File | Responsibility |
|---|---|
| `packages/bootstrap/src/test-mapping.ts` (modify) | Levels, self rows, both-level rebuild, per-level observed list, writes, CSV, match, pack planning. |
| `packages/bootstrap/src/test-support/test-mapping-fixture.ts` (modify) | `seedParam`, `seedResultMapping`, `seedResult`, a result-scan counter. |
| `packages/bootstrap/src/test-mapping-result.test.ts` (create) | Rebuild and observed tests for the result level. |
| `packages/bootstrap/src/test-mapping-result-write.test.ts` (create) | Writes, CSV, match and pack tests for the result level. |
| `packages/bootstrap/src/result-fields.ts` (create) | The dictionary list, LOINC links, CSV. |
| `packages/bootstrap/src/test-catalog.ts` (modify) | Export `LOINC_CODE` and `isLoincLoaded`. |
| `packages/bootstrap/src/index.ts` (modify) | `resultFields` on `AppContext`, pack deps with a level, exports. |
| `packages/marketplace/src/content-pack.ts` (modify) | The `result-mappings` step kind. |
| `packages/bootstrap/src/content-pack-install.ts` (modify) | Check and write passes for both kinds. |
| `apps/server/src/test-mapping-routes.ts` (modify) | `level`, systems, match. |
| `apps/server/src/result-fields-routes.ts` (create) | Result fields routes. |
| `apps/server/src/app.ts`, `apps/server/src/test-helpers.ts` (modify) | Registration, fake context. |
| `packages/cli/src/test-mapping.ts`, `packages/cli/src/result-fields.ts` (create), `packages/cli/src/program.ts`, `packages/cli/src/market.ts`, `packages/cli/src/terminology.ts` (modify) | CLI. |
| `apps/studio/src/api.ts` (modify) | Client functions and types. |
| `apps/studio/src/test-catalog/ObservedCodesTab.tsx`, `MapCodeSheet.tsx`, `ImportMappingsSheet.tsx` (modify) | Results mode. |
| `apps/studio/src/test-catalog/MatchCodesSheet.tsx`, `ResultFieldsTab.tsx`, `ResultFieldSheet.tsx` (create) | New sheet and tab. |
| `apps/studio/src/pages/TestCatalog.tsx` (modify) | Three tabs. |
| `apps/studio/src/i18n/{en,fr,pt}.ts` (modify) | Strings. |
| Docs (modify) | In-app and web docs in en, fr, pt. |

---

### Task 1: Both levels and self rows in the rebuild

**Files:**
- Modify: `packages/bootstrap/src/test-mapping.ts`
- Modify: `packages/bootstrap/src/test-support/test-mapping-fixture.ts`
- Modify: `packages/bootstrap/src/test-mapping.test.ts` (four expectations change because of self rows)
- Modify: `packages/bootstrap/src/index.ts` (one comment)
- Create: `packages/bootstrap/src/test-mapping-result.test.ts`

**Interfaces:**
- Consumes: slice 1's `createTestMapping`, `resolveAll`, `readCatalog`, and `testMapId` from `@openldr/db`.
- Produces:
  - `export type MapLevel = TestMapLevel` (`'test' | 'result'`).
  - `export const MAP_TARGET_SYSTEM: Record<MapLevel, string>`.
  - `export function parseMapLevel(raw: unknown): { ok: true; level: MapLevel } | { ok: false; error: string }`. Blank means `'test'`. Error text: `level must be test or result`.
  - `export interface LevelPublishSummary { mapped: number; ambiguous: Array<{ system: string; code: string; catalogCodes: string[] }>; targetMissing: Array<{ system: string; code: string; catalogCode: string }> }`.
  - `TestMapPublishResult extends LevelPublishSummary` with `results: LevelPublishSummary; selfRows: number; written: number`.
  - Inside `createTestMapping`: `readTargets(level: MapLevel)` and `readMappings(level: MapLevel = 'test')`, both on the returned object.
  - `mappingTouchesTestMap` and `isTestMapRelevantRecord` also answer true for `RESULT_PARAM_SYSTEM`.
  - Fixture: `seedParam`, `seedResultMapping`, `seedResult`, and `counter.resultGroupQueries`.

- [ ] **Step 1: Add the fixture helpers**

In `packages/bootstrap/src/test-support/test-mapping-fixture.ts`, change the terminology import to:

```ts
import { LOINC_SYSTEM, RESULT_PARAM_SYSTEM } from '@openldr/terminology';
```

Replace the counter and its plugin inside `buildMapping` with:

```ts
  // Counts selects that read lab_requests or lab_results, so a test can tell a cached Observed scan from a fresh one.
  const counter = { groupQueries: 0, resultGroupQueries: 0 };
  const countingDb = externalDb.withPlugin({
    transformQuery(args) {
      const node = args.node as { kind: string; from?: { froms?: Array<{ table?: { identifier?: { name?: string } } }> } };
      const names = node.kind === 'SelectQueryNode' ? (node.from?.froms ?? []).map((f) => f.table?.identifier?.name) : [];
      if (names.includes('lab_requests')) counter.groupQueries += 1;
      if (names.includes('lab_results')) counter.resultGroupQueries += 1;
      return args.node;
    },
    async transformResult(args) { return args.result; },
  });
```

Append these helpers to the end of the file:

```ts
export async function seedParam(db: Kysely<InternalSchema>, code: string, display: string, opts: { role?: string; units?: string; loinc?: string } = {}) {
  await db.insertInto('terminology_concepts').values({
    system: RESULT_PARAM_SYSTEM, code, display, status: null,
    properties: JSON.stringify({ result_role: opts.role ?? 'result', ...(opts.units ? { parm_units: opts.units } : {}) }) as never,
  }).execute();
  if (opts.loinc) {
    await db.insertInto('term_mappings').values({
      id: `loinc-param-${code}`, from_system: RESULT_PARAM_SYSTEM, from_code: code, to_system: LOINC_SYSTEM, to_code: opts.loinc,
      to_display: null, map_type: 'SAME-AS', relationship: null, owner: null, is_active: true, managed_origin: null,
    }).execute();
  }
}

export async function seedResultMapping(db: Kysely<InternalSchema>, id: string, system: string, code: string, paramCode: string, opts: { active?: boolean; central?: boolean; mapType?: string } = {}) {
  await db.insertInto('term_mappings').values({
    id, from_system: system, from_code: code, to_system: RESULT_PARAM_SYSTEM, to_code: paramCode,
    to_display: null, map_type: opts.mapType ?? 'SAME-AS', relationship: null, owner: null,
    is_active: opts.active ?? true, managed_origin: opts.central ? 'central' : null,
  }).execute();
}

export async function seedResult(db: Kysely<any>, id: string, system: string | null, code: string | null, desc: string | null, createdAt: string) {
  await db.insertInto('lab_results').values({ id, observation_system: system, observation_code: code, observation_desc: desc, created_at: createdAt }).execute();
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/bootstrap/src/test-mapping-result.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LOINC_SYSTEM, RESULT_PARAM_SYSTEM } from '@openldr/terminology';
import { TEST_CATALOG_SYSTEM } from './test-catalog';
import { isTestMapRelevantRecord, mappingTouchesTestMap, parseMapLevel } from './test-mapping';
import { buildMapping, seedCatalogTest, seedMapping, seedParam, seedResultMapping } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';
const PARAMS = RESULT_PARAM_SYSTEM;
const NO_RESULTS = { mapped: 0, ambiguous: [], targetMissing: [] };
type MapRow = { id: string; level: string; source_system: string; source_code: string; catalog_code: string | null; catalog_name: string | null; category: string | null; loinc: string | null };
const cols = (r: MapRow) => [r.id, r.level, r.source_system, r.source_code, r.catalog_code, r.catalog_name, r.category, r.loinc];

describe('test mapping: result level rebuild', () => {
  it('publishes a result mapping and the self row of its field', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedResultMapping(internalDb, 'r1', DISA, 'HIVVL', 'VLC');

    const result = await mapping.publish({ apply: true });

    expect(result).toEqual({ ...NO_RESULTS, results: { mapped: 1, ambiguous: [], targetMissing: [] }, selfRows: 1, written: 2 });
    const rows = await externalDb.selectFrom('test_map').selectAll().orderBy('id').execute();
    expect(rows.map(cols)).toEqual([
      [`result|${PARAMS}|VLC`, 'result', PARAMS, 'VLC', 'VLC', 'HIV VL copies', null, '20447-9'],
      [`result|${DISA}|HIVVL`, 'result', DISA, 'HIVVL', 'VLC', 'HIV VL copies', null, '20447-9'],
    ]);
  });

  it('writes a self row for every catalog test and every result field', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { category: 'MOL', loinc: '25836-8' });
    await seedParam(internalDb, 'CD4', 'CD4 count');

    const result = await mapping.publish({ apply: true });

    expect([result.selfRows, result.written]).toEqual([2, 2]);
    const rows = await externalDb.selectFrom('test_map').selectAll().orderBy('id').execute();
    expect(rows.map(cols)).toEqual([
      [`result|${PARAMS}|CD4`, 'result', PARAMS, 'CD4', 'CD4', 'CD4 count', null, null],
      [`test|${TEST_CATALOG_SYSTEM}|VL`, 'test', TEST_CATALOG_SYSTEM, 'VL', 'VL', 'HIV viral load', 'MOL', '25836-8'],
    ]);
  });

  it('reports ambiguous result codes and missing fields, and leaves both out', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await seedParam(internalDb, 'VLL', 'HIV VL log');
    await seedResultMapping(internalDb, 'r1', DISA, 'HIVVL', 'VLC');
    await seedResultMapping(internalDb, 'r2', DISA, 'HIVVL', 'VLL', { mapType: 'NARROWER-THAN' });
    await seedResultMapping(internalDb, 'r3', DISA, 'OLD', 'GONE');

    const result = await mapping.publish({ apply: true });

    expect(result.results).toEqual({
      mapped: 0,
      ambiguous: [{ system: DISA, code: 'HIVVL', catalogCodes: ['VLC', 'VLL'] }],
      targetMissing: [{ system: DISA, code: 'OLD', catalogCode: 'GONE' }],
    });
    expect(await externalDb.selectFrom('test_map').selectAll().where('source_system', '=', DISA).execute()).toEqual([]);
  });

  // Review focus 1.
  it('ignores a mapping from the target system to itself, so it cannot collide with the self row', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await seedResultMapping(internalDb, 'bad1', PARAMS, 'VLC', 'VLC');
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'bad2', TEST_CATALOG_SYSTEM, 'VL', 'VL');

    const outcome = await mapping.rebuildNow();

    expect(outcome).toMatchObject({ ok: true, result: { written: 2, selfRows: 2 } });
  });

  // Review focus 2.
  it('writes test rows only when no dictionary is loaded', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    const result = await mapping.publish({ apply: true });
    expect([result.results, result.selfRows, result.written]).toEqual([NO_RESULTS, 1, 1]);
  });

  it('writes a large dictionary in chunks', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    for (let i = 0; i < 450; i++) await seedParam(internalDb, `P${String(i).padStart(3, '0')}`, `Field ${i}`);
    expect((await mapping.publish({ apply: true })).written).toBe(450);
    const count = await externalDb.selectFrom('test_map').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(450);
  });
});

describe('rebuild triggers', () => {
  it('count a mapping into or out of the dictionary, and a dictionary sync', () => {
    expect(mappingTouchesTestMap(DISA, PARAMS)).toBe(true);
    expect(mappingTouchesTestMap(PARAMS, LOINC_SYSTEM)).toBe(true);
    expect(mappingTouchesTestMap(DISA, 'urn:openldr:other')).toBe(false);
    expect(isTestMapRelevantRecord({ entityType: 'terminology_system', body: { url: PARAMS } })).toBe(true);
    expect(isTestMapRelevantRecord({ entityType: 'terminology_system', body: { url: 'urn:openldr:other' } })).toBe(false);
  });
});

describe('parseMapLevel', () => {
  it('defaults to test and refuses anything but test or result', () => {
    expect(parseMapLevel(undefined)).toEqual({ ok: true, level: 'test' });
    expect(parseMapLevel('')).toEqual({ ok: true, level: 'test' });
    expect(parseMapLevel('result')).toEqual({ ok: true, level: 'result' });
    expect(parseMapLevel('panel')).toEqual({ ok: false, error: 'level must be test or result' });
  });
});
```

The rows sort by `id`, and `urn:openldr:default_result` sorts before `urn:openldr:disa`, so the self row comes first in the first test.

- [ ] **Step 3: Run the new tests to see them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-result.test.ts`
Expected: FAIL. `parseMapLevel` is not exported, and `publish` returns no `results` field.

- [ ] **Step 4: Add the level constants and the triggers**

In `packages/bootstrap/src/test-mapping.ts`, change the first two imports to:

```ts
import { testMapId, type ExternalSchema, type InternalSchema, type MapType, type TerminologyAdminStore, type TestMapLevel } from '@openldr/db';
import { LOINC_SYSTEM, RESULT_PARAM_SYSTEM } from '@openldr/terminology';
```

Replace the header comment with:

```ts
// Test mapping (docs/superpowers/specs/2026-10-11-test-mapping-design.md) and result field mapping
// (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md). A lab's own test codes map to
// catalog tests, and its result codes map to fields of the result dictionary, through ordinary
// term_mappings rows. The route, the CLI and the content pack installer all call this module
// (AGENTS.md section 6), and test_map is the warehouse copy report SQL joins.
```

After `const STATUSES = ...`, add:

```ts
/** A mapping's level: a lab test code maps to a catalog test, a lab result code to a result field. */
export type MapLevel = TestMapLevel;
/** Where each level's mappings point. A code in this system is a target already and needs no mapping. */
export const MAP_TARGET_SYSTEM: Record<MapLevel, string> = { test: TEST_CATALOG_SYSTEM, result: RESULT_PARAM_SYSTEM };
const TARGET_SYSTEMS = new Set(Object.values(MAP_TARGET_SYSTEM));
/** How each level names its target in messages. Slice 1's test-level wording is kept exactly. */
const TARGET_NOUN: Record<MapLevel, string> = { test: 'catalog test', result: 'result field' };

/** Read a level from a query string, a body or a CLI flag. Blank means 'test', slice 1's only level. */
export function parseMapLevel(raw: unknown): { ok: true; level: MapLevel } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, level: 'test' };
  if (raw === 'test' || raw === 'result') return { ok: true, level: raw };
  return { ok: false, error: 'level must be test or result' };
}
```

`TARGET_NOUN` is first used in Task 3. The package has no unused-locals check, so it can wait there.

Replace the `TestMapPublishResult` interface with:

```ts
export interface LevelPublishSummary {
  mapped: number;
  ambiguous: Array<{ system: string; code: string; catalogCodes: string[] }>;
  targetMissing: Array<{ system: string; code: string; catalogCode: string }>;
}

/** The top-level counts are the test level, as slice 1 shipped them. */
export interface TestMapPublishResult extends LevelPublishSummary {
  /** The same counts for result codes. */
  results: LevelPublishSummary;
  /** Rows that point a catalog test or a result field at itself, so CE's own orders and results join. */
  selfRows: number;
  /** Every row written: both levels, self rows included. */
  written: number;
}
```

Replace `mappingTouchesTestMap` and `isTestMapRelevantRecord` with:

```ts
/** A term mapping into the catalog or the dictionary is a mapping. One out of either is a LOINC link. All
 *  of them change test_map. */
export function mappingTouchesTestMap(fromSystem: string | null | undefined, toSystem: string | null | undefined): boolean {
  return TARGET_SYSTEMS.has(toSystem ?? '') || TARGET_SYSTEMS.has(fromSystem ?? '');
}

/** Whether a record a lab pulled from central changes test_map. A term mapping delete carries no body,
 *  so it counts: a spare rebuild is cheap, a missed one leaves reports wrong. */
export function isTestMapRelevantRecord(rec: { entityType: string; body?: unknown }): boolean {
  const body = rec.body as { fromSystem?: string; toSystem?: string; url?: string } | null;
  if (rec.entityType === 'term_mapping') return body === null || body === undefined || mappingTouchesTestMap(body.fromSystem, body.toSystem);
  if (rec.entityType === 'terminology_system') return TARGET_SYSTEMS.has(body?.url ?? '');
  return false;
}
```

The term-mapping routes (`apps/server/src/terminology-admin-routes.ts:269`, `:311`, `:337`) and the sync handlers (`packages/bootstrap/src/index.ts:1498`, `:1507`, `packages/bootstrap/src/sync-bundle.ts:331`, `:339`) already call these two functions, so they need no change.

- [ ] **Step 5: Read both levels and write both in the rebuild**

Inside `createTestMapping`, after `readCatalog`, add:

```ts
  /** The result dictionary, shaped like the catalog. A field has no category. */
  async function readParams(): Promise<Map<string, CatalogEntry>> {
    const concepts = await internalDb.selectFrom('terminology_concepts')
      .select(['code', 'display', 'status'])
      .where('system', '=', RESULT_PARAM_SYSTEM).execute();
    const links = await internalDb.selectFrom('term_mappings').select(['from_code', 'to_code'])
      .where('from_system', '=', RESULT_PARAM_SYSTEM).where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', MAP_TYPE).where('is_active', '=', true).execute();
    const loinc = new Map(links.map((l) => [l.from_code, l.to_code]));
    return new Map(concepts.map((c) => [c.code, {
      name: c.display, category: null, loinc: loinc.get(c.code) ?? null, retired: c.status === RETIRED,
    }]));
  }

  function readTargets(level: MapLevel): Promise<Map<string, CatalogEntry>> {
    return level === 'test' ? readCatalog() : readParams();
  }
```

Replace `readMappings` with:

```ts
  async function readMappings(level: MapLevel = 'test'): Promise<MappingRow[]> {
    return internalDb.selectFrom('term_mappings')
      .select(MAPPING_COLUMNS)
      .where('to_system', '=', MAP_TARGET_SYSTEM[level]).where('is_active', '=', true)
      // A row from the target system to itself would collide with that code's self row on the key.
      .where('from_system', '!=', MAP_TARGET_SYSTEM[level]).execute();
  }
```

Replace `publish` with:

```ts
  type TestMapRow = {
    id: string; level: MapLevel; source_system: string; source_code: string;
    catalog_code: string; catalog_name: string | null; category: string | null; loinc: string | null;
  };

  async function planLevel(level: MapLevel): Promise<{ rows: TestMapRow[]; selfRows: number; summary: LevelPublishSummary }> {
    const targets = await readTargets(level);
    const resolved = [...resolveAll(await readMappings(level), targets).values()];
    const row = (system: string, code: string, targetCode: string): TestMapRow => {
      const entry = targets.get(targetCode)!;
      return {
        id: testMapId(level, system, code), level, source_system: system, source_code: code,
        catalog_code: targetCode, catalog_name: entry.name, category: entry.category, loinc: entry.loinc,
      };
    };
    const mapped = resolved.flatMap((r) => (r.resolved.kind === 'mapped' ? [row(r.system, r.code, r.resolved.catalogCode)] : []));
    // CE's own orders and results already carry the target's code, so each target maps to itself.
    const self = [...targets.keys()].sort(compare).map((code) => row(MAP_TARGET_SYSTEM[level], code, code));
    return {
      rows: [...mapped, ...self],
      selfRows: self.length,
      summary: {
        mapped: mapped.length,
        ambiguous: resolved.flatMap((r) => (r.resolved.kind === 'ambiguous' ? [{ system: r.system, code: r.code, catalogCodes: r.resolved.catalogCodes }] : [])),
        targetMissing: resolved.flatMap((r) => (r.resolved.kind === 'missing' ? [{ system: r.system, code: r.code, catalogCode: r.resolved.catalogCode }] : [])),
      },
    };
  }

  async function publish(opts: { apply: boolean }): Promise<TestMapPublishResult> {
    const tests = await planLevel('test');
    const results = await planLevel('result');
    const rows = [...tests.rows, ...results.rows];
    const result: TestMapPublishResult = {
      ...tests.summary, results: results.summary, selfRows: tests.selfRows + results.selfRows, written: rows.length,
    };
    if (!opts.apply) return result;
    // Delete then insert in one transaction, so a reader never sees the table empty. This module owns
    // both levels, so it replaces the whole table.
    await externalDb.transaction().execute(async (trx) => {
      await trx.deleteFrom('test_map').execute();
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await trx.insertInto('test_map').values(rows.slice(i, i + INSERT_CHUNK)).execute();
      }
    });
    return result;
  }
```

Add `readTargets` to the returned object, after `readMappings`.

In `packages/bootstrap/src/index.ts`, find the boot rebuild comment at about line 1090 and change "Inline and cheap: tens to hundreds of rows." to "Inline and cheap: a few thousand rows at most."

- [ ] **Step 6: Update slice 1's tests for self rows**

Self rows are now expected in `test_map`. In `packages/bootstrap/src/test-mapping.test.ts`:

1. Add `const NO_RESULTS = { mapped: 0, ambiguous: [], targetMissing: [] };` after `const DISA = ...`.
2. In "publishes one test_map row per mapped code", change the result expectation to
   `expect(result).toEqual({ mapped: 2, ambiguous: [], targetMissing: [], results: NO_RESULTS, selfRows: 1, written: 3 });`
   and add `.where('source_system', '=', DISA)` before `.orderBy('source_code')` in the rows query.
3. In "leaves out an ambiguous code and a code whose catalog test is gone", change the last line to
   `expect(await externalDb.selectFrom('test_map').selectAll().where('source_system', '=', DISA).execute()).toEqual([]);`
4. In "lets central win over a lab row for the same code", add `.where('source_system', '=', DISA)` before `.execute()` in the `test_map` query.
5. In "replaces every test-level row on each rebuild", add `.where('source_system', '=', DISA)` before `.execute()` in both `test_map` length checks.

- [ ] **Step 7: Run the bootstrap mapping tests**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping`
Expected: PASS for `test-mapping.test.ts`, `test-mapping-result.test.ts`, `test-mapping-csv.test.ts`, `test-mapping-pack.test.ts` and `test-mapping-write.test.ts`. If another file fails on a `written` count or a `test_map` row count, the cause is a self row. Filter that query by the lab system as in Step 6, and name the test in the task report.

- [ ] **Step 8: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit > /tmp/tc-bootstrap.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. Read `/tmp/tc-bootstrap.txt` if not.

- [ ] **Step 9: Commit**

```bash
git add packages/bootstrap/src/test-mapping.ts packages/bootstrap/src/test-support/test-mapping-fixture.ts packages/bootstrap/src/test-mapping.test.ts packages/bootstrap/src/test-mapping-result.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): test_map rebuild writes result mappings and self rows"
```

---

### Task 2: Observed list and targets per level

**Files:**
- Modify: `packages/bootstrap/src/test-mapping.ts`
- Modify: `packages/bootstrap/src/test-mapping-result.test.ts`

**Interfaces:**
- Consumes: Task 1's `MapLevel`, `MAP_TARGET_SYSTEM`, `readTargets`, `readMappings(level)`, and the fixture's `seedResult`, `counter.resultGroupQueries`.
- Produces, all with `level` defaulting to `'test'`:
  - `observed(query: ObservedQuery, level?: MapLevel): Promise<ObservedResult>`
  - `observedAll(level?: MapLevel): Promise<ObservedTestCode[]>`
  - `targets(level?: MapLevel): Promise<CatalogTarget[]>`
  - `readObservedGroups(level?: MapLevel)` (internal, used by Task 3's import).
  - The row shape stays `ObservedTestCode`. At the result level `requests` holds the result count and `catalog` holds the result field.

- [ ] **Step 1: Write the failing tests**

Append to `packages/bootstrap/src/test-mapping-result.test.ts`. Add `seedRequest` and `seedResult` to the fixture import at the top.

```ts
describe('test mapping: observed lists per level', () => {
  it('lists observed result codes with counts and status, leaving out the dictionary\'s own codes', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedResultMapping(internalDb, 'm1', DISA, 'HIVVL', 'VLC');
    await seedResult(externalDb, 'o1', DISA, 'HIVVL', 'HIV VL', '2026-05-01T08:00:00Z');
    await seedResult(externalDb, 'o2', DISA, 'HIVVL', 'HIV VL', '2026-05-03T08:00:00Z');
    await seedResult(externalDb, 'o3', DISA, 'CD4', 'CD4 count', '2026-05-02T08:00:00Z');
    await seedResult(externalDb, 'o4', PARAMS, 'VLC', 'entered at the bench', '2026-05-02T08:00:00Z');

    const out = await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 }, 'result');

    expect(out.total).toBe(2);
    expect(out.rows.map((r) => [r.code, r.requests, r.status, r.catalog?.code ?? null, r.catalog?.loinc ?? null])).toEqual([
      ['CD4', 1, 'unmapped', null, null],
      ['HIVVL', 2, 'mapped', 'VLC', '20447-9'],
    ]);
    expect(out.rows[1].lastSeen?.startsWith('2026-05-03')).toBe(true);
  });

  it('leaves the catalog\'s own codes off the Tests list, because self rows map them', async () => {
    const { externalDb, mapping } = await buildMapping();
    await seedRequest(externalDb, 'q1', TEST_CATALOG_SYSTEM, 'VL', 'ordered in CE', '2026-05-01T08:00:00Z');
    await seedRequest(externalDb, 'q2', DISA, 'HIVVL', null, '2026-05-01T08:00:00Z');
    const out = await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 });
    expect(out.rows.map((r) => r.code)).toEqual(['HIVVL']);
  });

  it('keeps one scan cache per level', async () => {
    let clock = 1_000_000;
    const { externalDb, mapping, counter } = await buildMapping({ now: () => clock });
    await seedResult(externalDb, 'o1', DISA, 'HIVVL', null, '2026-05-01T08:00:00Z');
    const query = { status: 'all' as const, q: '', limit: 25, offset: 0 };

    await mapping.observed(query, 'result');
    await mapping.observed(query, 'test');
    expect([counter.resultGroupQueries, counter.groupQueries]).toEqual([1, 1]);

    clock += 59_000;
    await mapping.observed(query, 'result');
    expect(counter.resultGroupQueries).toBe(1);
  });

  it('lists result fields as targets, sorted by code', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedParam(internalDb, 'CD4', 'CD4 count');
    expect(await mapping.targets('result')).toEqual([
      { code: 'CD4', name: 'CD4 count', loinc: null, retired: false },
      { code: 'VLC', name: 'HIV VL copies', loinc: '20447-9', retired: false },
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-result.test.ts`
Expected: FAIL. `observed` ignores the level and scans `lab_requests`, so the first test gets 0 rows. The second test lists `VL` too.

- [ ] **Step 3: Make the scan and the cache per level**

In `packages/bootstrap/src/test-mapping.ts`, replace everything from `type ObservedGroup = ...` through the end of `scanObservedGroups` with:

```ts
  type ObservedGroup = { system: string; code: string; description: string | null; requests: number; lastSeen: string | null };
  // The group-by over lab_requests or lab_results is the costly read behind the Observed list. Cache it
  // for a minute, one entry per level. A rebuild does not clear it: a rebuild changes neither table.
  // Mappings, the catalog and the dictionary are never cached. A failed scan is not kept.
  const observedCache: Record<MapLevel, { at: number; groups: Promise<ObservedGroup[]> } | null> = { test: null, result: null };

  function readObservedGroups(level: MapLevel = 'test'): Promise<ObservedGroup[]> {
    const cached = observedCache[level];
    if (cached && now() - cached.at < OBSERVED_CACHE_MS) return cached.groups;
    const entry = { at: now(), groups: level === 'test' ? scanRequestGroups() : scanResultGroups() };
    observedCache[level] = entry;
    entry.groups.catch(() => { if (observedCache[level] === entry) observedCache[level] = null; });
    return entry.groups;
  }

  function toGroup(r: { system: unknown; code: unknown; description: unknown; requests: unknown; last_seen: unknown }): ObservedGroup {
    const last = r.last_seen;
    return {
      system: r.system as string, code: r.code as string,
      description: (r.description as string | null) ?? null,
      requests: Number(r.requests),
      lastSeen: last === null || last === undefined ? null : last instanceof Date ? last.toISOString() : String(last),
    };
  }

  async function scanRequestGroups(): Promise<ObservedGroup[]> {
    const rows = await externalDb.selectFrom('lab_requests')
      .select((eb) => [
        'panel_system as system', 'panel_code as code',
        eb.fn.max('panel_desc').as('description'),
        eb.fn.countAll().as('requests'),
        eb.fn.max('authored_at').as('last_seen'),
      ])
      .where('panel_system', 'is not', null)
      .where('panel_code', 'is not', null)
      // CE's own orders carry catalog codes, which self rows map already.
      .where('panel_system', '!=', TEST_CATALOG_SYSTEM)
      .groupBy(['panel_system', 'panel_code'])
      .execute();
    return rows.map(toGroup);
  }

  async function scanResultGroups(): Promise<ObservedGroup[]> {
    const rows = await externalDb.selectFrom('lab_results')
      .select((eb) => [
        'observation_system as system', 'observation_code as code',
        eb.fn.max('observation_desc').as('description'),
        eb.fn.countAll().as('requests'),
        // When the row reached the warehouse. cdr sends no result time of its own.
        eb.fn.max('created_at').as('last_seen'),
      ])
      .where('observation_system', 'is not', null)
      .where('observation_code', 'is not', null)
      // CE's own results carry dictionary codes, which self rows map already.
      .where('observation_system', '!=', RESULT_PARAM_SYSTEM)
      .groupBy(['observation_system', 'observation_code'])
      .execute();
    return rows.map(toGroup);
  }
```

- [ ] **Step 4: Give observedAll, observed and targets a level**

Replace `observedAll`, `observed` and `targets` with:

```ts
  async function observedAll(level: MapLevel = 'test'): Promise<ObservedTestCode[]> {
    const targetsByCode = await readTargets(level);
    const resolved = resolveAll(await readMappings(level), targetsByCode);
    const seen = new Map((await readObservedGroups(level)).map((g) => [sourceKey(g.system, g.code), g]));
    // A code mapped before any data arrived is still listed, so a CLI-made mapping is never invisible.
    for (const [k, r] of resolved) {
      if (!seen.has(k)) seen.set(k, { system: r.system, code: r.code, description: null, requests: 0, lastSeen: null });
    }
    const rows = [...seen.entries()].map(([k, g]): ObservedTestCode => {
      const r = resolved.get(k);
      const kind = r?.resolved.kind;
      const targetCode = kind === 'mapped' ? (r!.resolved as { catalogCode: string }).catalogCode : null;
      const entry = targetCode ? targetsByCode.get(targetCode)! : null;
      return {
        ...g,
        status: kind === 'mapped' ? 'mapped' : kind === 'ambiguous' ? 'ambiguous' : 'unmapped',
        catalog: targetCode ? { code: targetCode, name: entry!.name, loinc: entry!.loinc } : null,
        centralManaged: r?.central ?? false,
      };
    });
    return rows.sort((a, b) => compare(a.system, b.system) || compare(a.code, b.code));
  }

  async function observed(query: ObservedQuery, level: MapLevel = 'test'): Promise<ObservedResult> {
    const needle = query.q.toLowerCase();
    const matched = (await observedAll(level)).filter((r) => (query.status === 'all' || r.status === query.status)
      && (needle === '' || [r.code, r.description, r.catalog?.name].some((v) => (v ?? '').toLowerCase().includes(needle))));
    return {
      rows: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
      warehouse: { stale: !lastRebuild.ok, error: lastRebuild.error },
    };
  }

  async function targets(level: MapLevel = 'test'): Promise<CatalogTarget[]> {
    return [...(await readTargets(level)).entries()]
      .map(([code, e]) => ({ code, name: e.name, loinc: e.loinc, retired: e.retired }))
      .sort((a, b) => compare(a.code, b.code));
  }
```

Update the doc comment on `ObservedTestCode.requests` to:

```ts
  /** Rows carrying this code in the warehouse: requests at the test level, results at the result level.
   *  0 for a code mapped before any data arrived. */
```

and on `catalog`:

```ts
  /** The target: a catalog test at the test level, a result field at the result level. */
```

The import in Task 3 calls `readObservedGroups`. Slice 1's `planImport` already calls it with no argument, which still means the test level.

- [ ] **Step 5: Run the mapping tests**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping`
Expected: PASS, slice 1's tests included. Slice 1's cache test still counts one `lab_requests` scan per minute.

- [ ] **Step 6: Typecheck**

Run: `cd packages/bootstrap && npx tsc --noEmit > /tmp/tc-bootstrap.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/test-mapping.ts packages/bootstrap/src/test-mapping-result.test.ts
git commit -m "feat(bootstrap): observed result codes and result field targets"
```

---

### Task 3: Writes, the self-system guard, and CSV per level

**Files:**
- Modify: `packages/bootstrap/src/test-mapping.ts`
- Create: `packages/bootstrap/src/test-mapping-result-write.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces, all with `level` defaulting to `'test'`:
  - `activeFor(system: string, code: string, level?: MapLevel): Promise<MappingRow[]>`
  - `writeMapping(system: string, code: string, targetCode: string, name: string | null, level?: MapLevel): Promise<void>`
  - `set(system: string, code: string, targetCode: string, level?: MapLevel): Promise<TestMappingChange>`
  - `clear(system: string, code: string, level?: MapLevel): Promise<TestMappingChange>`
  - `catalogCodesForLoinc(loinc: string, level?: MapLevel): Promise<string[]>`
  - `exportCsv(level?: MapLevel): Promise<string>`
  - `importPreview(bytes: Uint8Array, level?: MapLevel)` and `importApply(bytes: Uint8Array, level?: MapLevel)`, both `Promise<MappingImportReport>`.
  - Result-level CSV columns: `system, code, description, results, parameter_code, loinc`.
  - New refusal, both levels: a source system equal to the level's target system. Text: `<system> codes are <noun>s already and need no mapping`, for example `urn:openldr:default_result codes are result fields already and need no mapping`.

- [ ] **Step 1: Write the failing tests**

Create `packages/bootstrap/src/test-mapping-result-write.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RESULT_PARAM_SYSTEM } from '@openldr/terminology';
import { TEST_CATALOG_SYSTEM } from './test-catalog';
import { buildMapping, seedCatalogTest, seedParam, seedResult, seedResultMapping } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';
const PARAMS = RESULT_PARAM_SYSTEM;
const csv = (text: string) => new TextEncoder().encode(text);

describe('test mapping: result level writes', () => {
  it('set maps a result code to a field, at the result level only, and rebuilds', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');

    const change = await mapping.set(DISA, 'HIVVL', 'VLC', 'result');

    expect([change.before, change.after, change.rebuild.ok]).toEqual([null, 'VLC', true]);
    expect((await mapping.activeFor(DISA, 'HIVVL', 'result')).map((r) => r.to_code)).toEqual(['VLC']);
    expect(await mapping.activeFor(DISA, 'HIVVL')).toEqual([]);
    expect(await externalDb.selectFrom('test_map').select('catalog_code').where('id', '=', `result|${DISA}|HIVVL`).execute()).toEqual([{ catalog_code: 'VLC' }]);
  });

  it('set refuses a field the dictionary does not hold', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.set(DISA, 'HIVVL', 'NOPE', 'result')).rejects.toMatchObject({ kind: 'invalid', message: 'no result field has code NOPE' });
  });

  it('refuses a source in the target system at both levels', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await expect(mapping.set(PARAMS, 'VLC', 'VLC', 'result')).rejects.toMatchObject({
      kind: 'invalid', message: `${PARAMS} codes are result fields already and need no mapping`,
    });
    await expect(mapping.set(TEST_CATALOG_SYSTEM, 'VL', 'VL')).rejects.toMatchObject({
      kind: 'invalid', message: `${TEST_CATALOG_SYSTEM} codes are catalog tests already and need no mapping`,
    });
  });

  it('a lab cannot change a result mapping central sent down', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await seedParam(internalDb, 'VLL', 'HIV VL log');
    await seedResultMapping(internalDb, 'c1', DISA, 'HIVVL', 'VLC', { central: true });
    await expect(mapping.set(DISA, 'HIVVL', 'VLL', 'result')).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('clear removes a result mapping, and says so when there is none', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await seedResultMapping(internalDb, 'm1', DISA, 'HIVVL', 'VLC');

    const change = await mapping.clear(DISA, 'HIVVL', 'result');

    expect([change.before, change.after]).toEqual(['VLC', null]);
    await expect(mapping.clear(DISA, 'HIVVL', 'result')).rejects.toMatchObject({ kind: 'not-found', message: 'HIVVL has no result field mapping' });
  });
});

describe('test mapping: result level CSV', () => {
  it('exports every observed result code with its field, in the import layout', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedResultMapping(internalDb, 'm1', DISA, 'HIVVL', 'VLC');
    await seedResult(externalDb, 'o1', DISA, 'HIVVL', 'HIV, VL', '2026-05-01T08:00:00Z');
    await seedResult(externalDb, 'o2', DISA, 'HIVVL', 'HIV, VL', '2026-05-01T08:00:00Z');
    await seedResult(externalDb, 'o3', DISA, 'CD4', null, '2026-05-01T08:00:00Z');

    expect(await mapping.exportCsv('result')).toBe(
      'system,code,description,results,parameter_code,loinc\n'
      + `${DISA},CD4,,1,,\n`
      + `${DISA},HIVVL,"HIV, VL",2,VLC,20447-9\n`,
    );
  });

  it('previews by parameter_code or LOINC and refuses dictionary codes and unknown fields', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedParam(internalDb, 'CD4', 'CD4 count');
    await seedResultMapping(internalDb, 'm1', DISA, 'HIVVL', 'VLC');

    const report = await mapping.importPreview(csv([
      'system,code,parameter_code,loinc',
      `${DISA},HIVVL,VLC,`,       // unchanged
      `${DISA},POCVC,,20447-9`,   // new, by LOINC
      `${DISA},CD4,CD4,`,         // new
      `${DISA},BAD,NOPE,`,        // refused
      `${PARAMS},VLC,VLC,`,       // refused, a dictionary code
    ].join('\n')), 'result');

    expect(report.counts).toEqual({ new: 2, changed: 0, unchanged: 1, refused: 2 });
    expect(report.refused).toEqual([
      { line: 5, system: DISA, code: 'BAD', reason: 'no result field has code NOPE' },
      { line: 6, system: PARAMS, code: 'VLC', reason: `${PARAMS} codes are result fields already and need no mapping` },
    ]);
  });

  // Review focus 4.
  it('refuses the test-level file at the result level, naming the missing column', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.importPreview(csv(`system,code,catalog_code\n${DISA},HIVVL,VL`), 'result'))
      .rejects.toMatchObject({ kind: 'invalid', message: 'the file needs a parameter_code column or a loinc column' });
  });

  it('applies result mappings and rebuilds once', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });

    const report = await mapping.importApply(csv(`system,code,parameter_code,loinc\n${DISA},POCVC,,20447-9`), 'result');

    expect(report.counts.new).toBe(1);
    expect(report.rebuild?.ok).toBe(true);
    expect((await mapping.activeFor(DISA, 'POCVC', 'result')).map((r) => r.to_code)).toEqual(['VLC']);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-result-write.test.ts`
Expected: FAIL. `set` ignores the level and looks the code up in the catalog.

- [ ] **Step 3: Give the writes a level**

In `packages/bootstrap/src/test-mapping.ts`, replace `activeFor`, `assertSource`, `deactivate`, `writeMapping`, `set` and `clear` with:

```ts
  async function activeFor(system: string, code: string, level: MapLevel = 'test'): Promise<MappingRow[]> {
    return internalDb.selectFrom('term_mappings')
      .select(MAPPING_COLUMNS)
      .where('from_system', '=', system).where('from_code', '=', code)
      .where('to_system', '=', MAP_TARGET_SYSTEM[level]).where('is_active', '=', true).execute();
  }

  /** A code in the target system is a target already. Mapping it would collide with its self row. */
  function selfSystemReason(system: string, level: MapLevel): string | null {
    return system === MAP_TARGET_SYSTEM[level] ? `${system} codes are ${TARGET_NOUN[level]}s already and need no mapping` : null;
  }

  function assertSource(system: string, code: string, level: MapLevel): void {
    if (system.trim() === '' || code.trim() === '') throw new TestCatalogError('system and code are required', 'invalid');
    const self = selfSystemReason(system, level);
    if (self) throw new TestCatalogError(self, 'invalid');
  }

  function assertNotCentral(rows: MappingRow[], code: string): void {
    if (rows.some((r) => r.managed_origin === 'central')) {
      throw new TestCatalogError(`central maps ${code}; a lab cannot change it`, 'central-managed');
    }
  }

  async function deactivate(row: MappingRow, level: MapLevel): Promise<void> {
    await deps.admin.termMappings.update(row.id, {
      fromSystem: row.from_system, fromCode: row.from_code, toSystem: MAP_TARGET_SYSTEM[level], toCode: row.to_code,
      toDisplay: row.to_display, mapType: row.map_type as MapType, isActive: false,
    });
  }

  /** Make `targetCode` the one active mapping for this code at this level. No guard and no rebuild: the
   *  callers (set, CSV import, pack install, match) check first and rebuild once at the end. */
  async function writeMapping(system: string, code: string, targetCode: string, name: string | null, level: MapLevel = 'test'): Promise<void> {
    const saved = await deps.admin.termMappings.saveExclusive({
      fromSystem: system, fromCode: code, toSystem: MAP_TARGET_SYSTEM[level], toCode: targetCode,
      toDisplay: name, mapType: MAP_TYPE, isActive: true,
    });
    // saveExclusive supersedes only SAME-AS rows. One made through the general mapping dialog with
    // another type would stay active and make the code ambiguous, so it goes too.
    for (const other of await activeFor(system, code, level)) {
      if (other.id !== saved.mapping.id) await deactivate(other, level);
    }
  }

  async function set(system: string, code: string, targetCode: string, level: MapLevel = 'test'): Promise<TestMappingChange> {
    assertSource(system, code, level);
    const entry = (await readTargets(level)).get(targetCode);
    if (!entry) throw new TestCatalogError(`no ${TARGET_NOUN[level]} has code ${targetCode}`, 'invalid');
    const existing = await activeFor(system, code, level);
    assertNotCentral(existing, code);
    const before = existing.map((r) => r.to_code).sort(compare)[0] ?? null;
    await writeMapping(system, code, targetCode, entry.name, level);
    return { system, code, before, after: targetCode, rebuild: await rebuildNow() };
  }

  async function clear(system: string, code: string, level: MapLevel = 'test'): Promise<TestMappingChange> {
    assertSource(system, code, level);
    const existing = await activeFor(system, code, level);
    // Slice 1's words at the test level, kept exactly.
    if (existing.length === 0) throw new TestCatalogError(`${code} has no ${level === 'test' ? 'catalog' : 'result field'} mapping`, 'not-found');
    assertNotCentral(existing, code);
    for (const row of existing) await deactivate(row, level);
    return { system, code, before: existing.map((r) => r.to_code).sort(compare)[0], after: null, rebuild: await rebuildNow() };
  }
```

Replace `catalogCodesForLoinc` with:

```ts
  async function catalogCodesForLoinc(loinc: string, level: MapLevel = 'test'): Promise<string[]> {
    const rows = await internalDb.selectFrom('term_mappings').select('from_code')
      .where('from_system', '=', MAP_TARGET_SYSTEM[level]).where('to_system', '=', LOINC_SYSTEM)
      .where('to_code', '=', loinc).where('map_type', '=', MAP_TYPE).where('is_active', '=', true).execute();
    return [...new Set(rows.map((r) => r.from_code))].sort(compare);
  }
```

- [ ] **Step 4: Give the CSV a level**

Replace `const CSV_COLUMNS = ...` near the top of the file with:

```ts
/** Each level's CSV. The count column and the target column differ; system, code and loinc do not. */
const CSV_COLUMNS: Record<MapLevel, Array<{ key: string; label: string }>> = {
  test: ['system', 'code', 'description', 'requests', 'catalog_code', 'loinc'].map((k) => ({ key: k, label: k })),
  result: ['system', 'code', 'description', 'results', 'parameter_code', 'loinc'].map((k) => ({ key: k, label: k })),
};
const COUNT_COLUMN: Record<MapLevel, string> = { test: 'requests', result: 'results' };
const TARGET_COLUMN: Record<MapLevel, string> = { test: 'catalog_code', result: 'parameter_code' };
```

`CSV_COLUMNS` refers to `MapLevel`, so it must sit below the `MapLevel` type from Task 1. Move it there if it is above.

Replace `exportCsv` with:

```ts
  async function exportCsv(level: MapLevel = 'test'): Promise<string> {
    const rows = await observedAll(level);
    return toCsv(CSV_COLUMNS[level], rows.map((r) => ({
      system: r.system, code: r.code, description: r.description, [COUNT_COLUMN[level]]: r.requests,
      [TARGET_COLUMN[level]]: r.catalog?.code ?? null, loinc: r.catalog?.loinc ?? null,
    })));
  }
```

In `planImport`, change the signature to `async function planImport(bytes: Uint8Array, level: MapLevel): Promise<{ report: MappingImportReport; writes: PlannedRow[] }>` and make these changes inside it:

1. Replace the `catalog_code`/`loinc` header check with:
   ```ts
   const targetColumn = TARGET_COLUMN[level];
   if (col(targetColumn) < 0 && col('loinc') < 0) throw new TestCatalogError(`the file needs a ${targetColumn} column or a loinc column`, 'invalid');
   ```
2. Replace `const catalog = await readCatalog();` with `const targetsByCode = await readTargets(level);`.
3. Replace `for (const g of await readObservedGroups())` with `for (const g of await readObservedGroups(level))`.
4. Right after the `heldWithSpaces` refusal block, add:
   ```ts
   const self = selfSystemReason(system, level);
   if (self) { refuse(line, system, code, self); continue; }
   ```
5. Replace the block from `const catalogCodeCell = ...` through `writes.push(...)` with:
   ```ts
   const targetCell = cell(table.rows[i], targetColumn);
   const loinc = cell(table.rows[i], 'loinc');
   const noun = TARGET_NOUN[level];
   let targetCode: string | null = null;
   if (targetCell !== '') {
     if (!targetsByCode.has(targetCell)) { refuse(line, system, code, `no ${noun} has code ${targetCell}`); continue; }
     targetCode = targetCell;
   } else if (loinc !== '') {
     const codes = await catalogCodesForLoinc(loinc, level);
     if (codes.length === 0) { refuse(line, system, code, `no ${noun} is linked to LOINC ${loinc}`); continue; }
     if (codes.length > 1) { refuse(line, system, code, `${codes.length} ${noun}s are linked to LOINC ${loinc}`); continue; }
     targetCode = codes[0];
   }

   const existing = await activeFor(system, code, level);
   // Blank target and loinc: leave the code as it is. An exported file lists unmapped codes so.
   if (targetCode === null) { report.counts.unchanged += 1; continue; }
   const current = [...new Set(existing.map((r) => r.to_code))];
   // A row that asks for the target the code already has is no change, central-owned or not, so an
   // untouched export re-imports cleanly. Central only blocks a different target.
   if (current.length === 1 && current[0] === targetCode) { report.counts.unchanged += 1; continue; }
   if (existing.some((r) => r.managed_origin === 'central')) { refuse(line, system, code, `central maps ${code}; a lab cannot change it`); continue; }
   if (existing.length === 0) report.counts.new += 1; else report.counts.changed += 1;
   writes.push({ system, code, catalogCode: targetCode, name: targetsByCode.get(targetCode)!.name });
   ```

Replace `importPreview` and `importApply` with:

```ts
  async function importPreview(bytes: Uint8Array, level: MapLevel = 'test'): Promise<MappingImportReport> {
    return (await planImport(bytes, level)).report;
  }

  async function importApply(bytes: Uint8Array, level: MapLevel = 'test'): Promise<MappingImportReport> {
    const { report, writes } = await planImport(bytes, level);
    try {
      for (const w of writes) await writeMapping(w.system, w.code, w.catalogCode, w.name, level);
    } catch (err) {
      // Writes already made stay made, so test_map must still catch up with them before the failure goes up.
      await rebuildNow();
      throw err;
    }
    return { ...report, rebuild: await rebuildNow() };
  }
```

`planPack` and `applyPack` still call `activeFor`, `catalogCodesForLoinc` and `writeMapping` with no level, which means the test level. Task 4 gives them a level.

- [ ] **Step 5: Run the mapping tests**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping`
Expected: PASS, slice 1's CSV and write tests included. Their messages are unchanged at the test level.

- [ ] **Step 6: Typecheck**

Run: `cd packages/bootstrap && npx tsc --noEmit > /tmp/tc-bootstrap.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/test-mapping.ts packages/bootstrap/src/test-mapping-result-write.test.ts
git commit -m "feat(bootstrap): result mappings by hand and by CSV"
```

---

### Task 4: Map matching codes, and pack planning per level

**Files:**
- Modify: `packages/bootstrap/src/test-mapping.ts`
- Modify: `packages/bootstrap/src/test-mapping-result-write.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces:
  - `export interface MatchPlan { system: string; matches: Array<{ code: string; display: string | null; results: number }> }`
  - `observedSystems(level?: MapLevel): Promise<string[]>`, sorted.
  - `planMatch(system: string): Promise<MatchPlan>`, result level only, writes nothing.
  - `applyMatch(system: string): Promise<MatchPlan & { rebuild: RebuildOutcome }>`.
  - `planPack(mappings: PackMappingInput[], level?: MapLevel): Promise<PackMappingPlan>` and `applyPack(mappings, level?)`. `PackMappingPlan` keeps its shape. At the result level `mapped[].catalogCode` holds the field code.

- [ ] **Step 1: Write the failing tests**

Append to `packages/bootstrap/src/test-mapping-result-write.test.ts`:

```ts
describe('map matching codes', () => {
  async function seeded() {
    const built = await buildMapping();
    const { internalDb, externalDb } = built;
    await seedParam(internalDb, 'HIVVL', 'HIV VL');
    await seedParam(internalDb, 'CD4', 'CD4 count');
    await seedParam(internalDb, 'TBHIV', 'TB HIV status');
    await seedResult(externalDb, 'o1', DISA, 'HIVVL', null, '2026-05-01T08:00:00Z');
    await seedResult(externalDb, 'o2', DISA, 'HIVVL', null, '2026-05-01T08:00:00Z');
    await seedResult(externalDb, 'o3', DISA, 'CD4', null, '2026-05-01T08:00:00Z');
    await seedResult(externalDb, 'o4', DISA, 'TBHIV', null, '2026-05-01T08:00:00Z');
    await seedResult(externalDb, 'o5', DISA, 'ZZZ', null, '2026-05-01T08:00:00Z');
    await seedResult(externalDb, 'o6', 'urn:openldr:other', 'HIVVL', null, '2026-05-01T08:00:00Z');
    // CD4 is mapped by central. TBHIV is ambiguous: two lab rows name different fields.
    await seedResultMapping(internalDb, 'c1', DISA, 'CD4', 'CD4', { central: true });
    await seedResultMapping(internalDb, 'a1', DISA, 'TBHIV', 'TBHIV');
    await seedResultMapping(internalDb, 'a2', DISA, 'TBHIV', 'CD4', { mapType: 'NARROWER-THAN' });
    return built;
  }

  // Review focus 3.
  it('lists only unmapped codes in that system that equal a field', async () => {
    const { mapping } = await seeded();
    expect(await mapping.planMatch(DISA)).toEqual({ system: DISA, matches: [{ code: 'HIVVL', display: 'HIV VL', results: 2 }] });
  });

  it('applies the matches as ordinary mappings and rebuilds once', async () => {
    const { externalDb, mapping } = await seeded();

    const out = await mapping.applyMatch(DISA);

    expect([out.matches.length, out.rebuild.ok]).toEqual([1, true]);
    expect(await externalDb.selectFrom('test_map').select('catalog_code').where('id', '=', `result|${DISA}|HIVVL`).execute()).toEqual([{ catalog_code: 'HIVVL' }]);
    expect((await mapping.planMatch(DISA)).matches).toEqual([]);
  });

  it('refuses the dictionary system, and lists the observed systems', async () => {
    const { mapping } = await seeded();
    await expect(mapping.planMatch(PARAMS)).rejects.toMatchObject({ kind: 'invalid' });
    expect(await mapping.observedSystems('result')).toEqual([DISA, 'urn:openldr:other']);
  });

  // Review focus 2.
  it('finds nothing when no dictionary is loaded', async () => {
    const { externalDb, mapping } = await buildMapping();
    await seedResult(externalDb, 'o1', DISA, 'HIVVL', null, '2026-05-01T08:00:00Z');
    expect((await mapping.planMatch(DISA)).matches).toEqual([]);
  });
});

describe('pack result mappings', () => {
  // Review focus 5.
  it('resolves by the field\'s LOINC, and skips unknown LOINC codes and dictionary codes', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });

    const plan = await mapping.planPack([
      { system: DISA, code: 'HIVVL', loinc: '20447-9' },
      { system: DISA, code: 'CD4', loinc: '9999-9' },
      { system: PARAMS, code: 'VLC', loinc: '20447-9' },
    ], 'result');

    expect(plan).toEqual({
      mapped: [{ system: DISA, code: 'HIVVL', catalogCode: 'VLC' }],
      kept: [],
      skipped: [
        { system: DISA, code: 'CD4', reason: 'no result field is linked to LOINC 9999-9' },
        { system: PARAMS, code: 'VLC', reason: `${PARAMS} codes are result fields already and need no mapping` },
      ],
    });
  });

  it('writes result mappings, not test mappings', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });

    await mapping.applyPack([{ system: DISA, code: 'HIVVL', loinc: '20447-9' }], 'result');

    expect((await mapping.activeFor(DISA, 'HIVVL', 'result')).map((r) => r.to_code)).toEqual(['VLC']);
    expect(await mapping.activeFor(DISA, 'HIVVL')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping-result-write.test.ts`
Expected: FAIL. `planMatch` and `observedSystems` do not exist, and `planPack` ignores the level.

- [ ] **Step 3: Add matching**

In `packages/bootstrap/src/test-mapping.ts`, after the `PackMappingPlan` interface, add:

```ts
/** Map matching codes (result field mapping spec 4.5): the unmapped result codes of one lab system that
 *  equal a dictionary code. On a DISA site the dictionary is DISA's own list, so most codes match. */
export interface MatchPlan {
  system: string;
  matches: Array<{ code: string; display: string | null; results: number }>;
}
```

Inside `createTestMapping`, before the `return`, add:

```ts
  async function observedSystems(level: MapLevel = 'test'): Promise<string[]> {
    return [...new Set((await observedAll(level)).map((r) => r.system))].sort(compare);
  }

  async function planMatch(system: string): Promise<MatchPlan> {
    if (system.trim() === '') throw new TestCatalogError('system is required', 'invalid');
    const self = selfSystemReason(system, 'result');
    if (self) throw new TestCatalogError(self, 'invalid');
    const params = await readTargets('result');
    // Only unmapped codes. A code central has mapped counts as mapped, and an ambiguous one needs a person.
    const rows = (await observedAll('result')).filter((r) => r.system === system && r.status === 'unmapped' && params.has(r.code));
    return { system, matches: rows.map((r) => ({ code: r.code, display: params.get(r.code)!.name, results: r.requests })) };
  }

  async function applyMatch(system: string): Promise<MatchPlan & { rebuild: RebuildOutcome }> {
    const plan = await planMatch(system);
    try {
      for (const m of plan.matches) await writeMapping(system, m.code, m.code, m.display, 'result');
    } catch (err) {
      // As importApply: writes already made stay made, so test_map catches up before the failure goes up.
      await rebuildNow();
      throw err;
    }
    return { ...plan, rebuild: await rebuildNow() };
  }
```

- [ ] **Step 4: Give pack planning a level**

Replace `planPack` and `applyPack` with:

```ts
  async function planPack(mappings: PackMappingInput[], level: MapLevel = 'test'): Promise<PackMappingPlan> {
    const plan: PackMappingPlan = { mapped: [], kept: [], skipped: [] };
    const noun = TARGET_NOUN[level];
    const seen = new Set<string>();
    for (const m of mappings) {
      const key = sourceKey(m.system, m.code);
      if (seen.has(key)) { plan.skipped.push({ system: m.system, code: m.code, reason: 'listed twice in this pack' }); continue; }
      seen.add(key);
      const self = selfSystemReason(m.system, level);
      if (self) { plan.skipped.push({ system: m.system, code: m.code, reason: self }); continue; }
      if ((await activeFor(m.system, m.code, level)).length > 0) { plan.kept.push({ system: m.system, code: m.code }); continue; }
      const codes = await catalogCodesForLoinc(m.loinc, level);
      if (codes.length === 0) { plan.skipped.push({ system: m.system, code: m.code, reason: `no ${noun} is linked to LOINC ${m.loinc}` }); continue; }
      if (codes.length > 1) { plan.skipped.push({ system: m.system, code: m.code, reason: `${codes.length} ${noun}s are linked to LOINC ${m.loinc}` }); continue; }
      plan.mapped.push({ system: m.system, code: m.code, catalogCode: codes[0] });
    }
    return plan;
  }

  async function applyPack(mappings: PackMappingInput[], level: MapLevel = 'test'): Promise<PackMappingPlan & { rebuild: RebuildOutcome }> {
    const plan = await planPack(mappings, level);
    const targetsByCode = await readTargets(level);
    for (const m of plan.mapped) await writeMapping(m.system, m.code, m.catalogCode, targetsByCode.get(m.catalogCode)?.name ?? null, level);
    return { ...plan, rebuild: await rebuildNow() };
  }
```

Add `observedSystems, planMatch, applyMatch` to the returned object.

- [ ] **Step 5: Run the mapping tests**

Run: `cd packages/bootstrap && npx vitest run src/test-mapping`
Expected: PASS, slice 1's pack tests included.

- [ ] **Step 6: Typecheck**

Run: `cd packages/bootstrap && npx tsc --noEmit > /tmp/tc-bootstrap.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/test-mapping.ts packages/bootstrap/src/test-mapping-result-write.test.ts
git commit -m "feat(bootstrap): map matching result codes, and pack planning per level"
```

---

### Task 5: The Result fields service

**Files:**
- Create: `packages/bootstrap/src/result-fields.ts`
- Create: `packages/bootstrap/src/result-fields.test.ts`
- Modify: `packages/bootstrap/src/test-catalog.ts` (export `LOINC_CODE` and `isLoincLoaded`)
- Modify: `packages/bootstrap/src/index.ts` (build it, put it on `AppContext`, export it)
- Modify: `apps/server/src/test-helpers.ts` (the fake context gains `resultFields`)

**Interfaces:**
- Consumes: `TestCatalogError`, `readTableFile`, `TEST_MAPPING_IMPORT_MAX_BYTES` and `TEST_MAPPING_IMPORT_MAX_ROWS` (from `test-mapping.ts`), and the fixture's `buildMapping`, `seedParam`.
- Produces:
  - `export interface ResultField { code: string; display: string | null; role: string | null; units: string | null; loinc: string | null }`
  - `export interface ResultFieldQuery { q: string; loinc: 'linked' | 'none' | 'all'; role: string | null; limit: number; offset: number }`
  - `export interface ResultFieldList { rows: ResultField[]; total: number; ownedHere: boolean; loaded: boolean }`
  - `export interface ResultFieldLinkChange { code: string; before: string | null; after: string | null }`
  - `export interface ResultFieldImportReport { counts: { new: number; changed: number; unchanged: number; refused: number }; refused: Array<{ line: number; code: string; reason: string }> }`
  - `export function parseResultFieldQuery(raw: Record<string, unknown>): { ok: true; query: ResultFieldQuery } | { ok: false; error: string }`
  - `export function createResultFields(deps: { db: Kysely<InternalSchema>; admin: TerminologyAdminStore; onChanged?: () => void })` returning `{ list, link, unlink, exportCsv, importPreview, importApply, ownedHere }`.
  - `export type ResultFields = ReturnType<typeof createResultFields>`, and `AppContext.resultFields: ResultFields`.
  - From `test-catalog.ts`: `export const LOINC_CODE` and `export async function isLoincLoaded(db: Kysely<InternalSchema>): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/bootstrap/src/result-fields.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { LOINC_SYSTEM, RESULT_PARAM_SYSTEM } from '@openldr/terminology';
import { createResultFields, parseResultFieldQuery } from './result-fields';
import { buildMapping, seedParam } from './test-support/test-mapping-fixture';

const Q = { q: '', loinc: 'all' as const, role: null, limit: 25, offset: 0 };
const csv = (text: string) => new TextEncoder().encode(text);

async function build() {
  const base = await buildMapping();
  const onChanged = vi.fn();
  const fields = createResultFields({ db: base.internalDb, admin: base.admin, onChanged });
  return { ...base, fields, onChanged };
}

async function activeLinks(admin: Awaited<ReturnType<typeof build>>['admin'], code: string): Promise<string[]> {
  return (await admin.termMappings.listOutgoing(RESULT_PARAM_SYSTEM, code))
    .filter((m) => m.isActive && m.toSystem === LOINC_SYSTEM).map((m) => m.toCode);
}

describe('result fields', () => {
  it('lists fields with role, units and LOINC, sorted by code', async () => {
    const { internalDb, fields } = await build();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { units: 'copies/mL', loinc: '20447-9' });
    await seedParam(internalDb, 'AGE', 'Age', { role: 'metadata' });
    expect(await fields.list(Q)).toEqual({
      rows: [
        { code: 'AGE', display: 'Age', role: 'metadata', units: null, loinc: null },
        { code: 'VLC', display: 'HIV VL copies', role: 'result', units: 'copies/mL', loinc: '20447-9' },
      ],
      total: 2, ownedHere: true, loaded: true,
    });
  });

  it('filters by LOINC, role and search, and pages', async () => {
    const { internalDb, fields } = await build();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedParam(internalDb, 'AGE', 'Age', { role: 'metadata' });
    const codes = async (q: Partial<typeof Q>) => (await fields.list({ ...Q, ...q })).rows.map((r) => r.code);
    expect(await codes({ loinc: 'linked' })).toEqual(['VLC']);
    expect(await codes({ loinc: 'none' })).toEqual(['AGE']);
    expect(await codes({ role: 'metadata' })).toEqual(['AGE']);
    expect(await codes({ q: 'copies' })).toEqual(['VLC']);
    expect(await codes({ q: '20447' })).toEqual(['VLC']);
    const page = await fields.list({ ...Q, limit: 1, offset: 1 });
    expect([page.total, page.rows.map((r) => r.code)]).toEqual([2, ['VLC']]);
  });

  // Review focus 2.
  it('says when no dictionary is loaded', async () => {
    const { fields } = await build();
    expect(await fields.list(Q)).toEqual({ rows: [], total: 0, ownedHere: true, loaded: false });
  });

  it('links, relinks and unlinks, calling onChanged each time', async () => {
    const { internalDb, admin, fields, onChanged } = await build();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');

    expect(await fields.link('VLC', '20447-9')).toEqual({ code: 'VLC', before: null, after: '20447-9' });
    expect(await fields.link('VLC', '25836-8')).toEqual({ code: 'VLC', before: '20447-9', after: '25836-8' });
    expect(await activeLinks(admin, 'VLC')).toEqual(['25836-8']);
    expect(await fields.unlink('VLC')).toEqual({ code: 'VLC', before: '25836-8', after: null });
    expect(await activeLinks(admin, 'VLC')).toEqual([]);
    expect(onChanged).toHaveBeenCalledTimes(3);
    await expect(fields.unlink('VLC')).rejects.toMatchObject({ kind: 'not-found', message: 'VLC has no LOINC link' });
  });

  it('refuses an unknown field and a malformed LOINC code', async () => {
    const { internalDb, fields } = await build();
    await expect(fields.link('NOPE', '20447-9')).rejects.toMatchObject({ kind: 'not-found', message: 'no result field has code NOPE' });
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await expect(fields.link('VLC', 'abc')).rejects.toMatchObject({ kind: 'invalid', message: '"abc" is not a LOINC code. LOINC codes look like 12345-6.' });
  });

  it('refuses every change when the dictionary came from central', async () => {
    const { internalDb, fields } = await build();
    await internalDb.insertInto('terminology_systems').values({
      url: RESULT_PARAM_SYSTEM, version: null, kind: 'CodeSystem', resource_id: 'cs-params', managed_origin: 'central',
    }).execute();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    expect((await fields.list(Q)).ownedHere).toBe(false);
    await expect(fields.link('VLC', '20447-9')).rejects.toMatchObject({ kind: 'central-managed' });
    await expect(fields.unlink('VLC')).rejects.toMatchObject({ kind: 'central-managed' });
    await expect(fields.importPreview(csv('code,loinc\nVLC,20447-9'))).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('exports and imports links as CSV', async () => {
    const { internalDb, admin, fields, onChanged } = await build();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedParam(internalDb, 'CD4', 'CD4 count', { units: 'cells/uL' });
    await seedParam(internalDb, 'AGE', 'Age', { role: 'metadata' });
    await seedParam(internalDb, 'HB', 'Haemoglobin');

    expect(await fields.exportCsv()).toBe(
      'code,display,role,units,loinc\n'
      + 'AGE,Age,metadata,,\n'
      + 'CD4,CD4 count,result,cells/uL,\n'
      + 'HB,Haemoglobin,result,,\n'
      + 'VLC,HIV VL copies,result,,20447-9\n',
    );

    const file = csv([
      'code,loinc',
      'VLC,20447-9',   // unchanged
      'CD4,24467-3',   // new
      'AGE,',          // blank: no change
      'NOPE,1234-5',   // refused
      'VLC,1-1',       // refused, listed twice
      'HB,abc',        // refused, not a LOINC code
    ].join('\n'));
    const preview = await fields.importPreview(file);
    expect(preview).toEqual({
      counts: { new: 1, changed: 0, unchanged: 2, refused: 3 },
      refused: [
        { line: 5, code: 'NOPE', reason: 'no result field has code NOPE' },
        { line: 6, code: 'VLC', reason: 'listed twice in the file' },
        { line: 7, code: 'HB', reason: '"abc" is not a LOINC code. LOINC codes look like 12345-6.' },
      ],
    });
    expect(onChanged).not.toHaveBeenCalled();

    await fields.importApply(file);
    expect(await activeLinks(admin, 'CD4')).toEqual(['24467-3']);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe('parseResultFieldQuery', () => {
  it('defaults and refuses bad values in plain words', () => {
    expect(parseResultFieldQuery({})).toEqual({ ok: true, query: { q: '', loinc: 'all', role: null, limit: 25, offset: 0 } });
    expect(parseResultFieldQuery({ loinc: 'some' })).toEqual({ ok: false, error: 'loinc must be linked, none or all' });
    expect(parseResultFieldQuery({ role: 'boss' })).toEqual({ ok: false, error: 'role must be result, specimen, metadata or admin' });
    expect(parseResultFieldQuery({ limit: '0' })).toEqual({ ok: false, error: 'limit must be a whole number from 1 to 200' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/bootstrap && npx vitest run src/result-fields.test.ts`
Expected: FAIL with "Cannot find module './result-fields'".

- [ ] **Step 3: Export the LOINC helpers from the catalog**

In `packages/bootstrap/src/test-catalog.ts`, change `const LOINC_CODE = /^\d{1,7}-\d$/;` to:

```ts
/** A LOINC code's shape. Result fields check their links against it too. */
export const LOINC_CODE = /^\d{1,7}-\d$/;
```

Above `export function createTestCatalog`, add:

```ts
/** Whether LOINC itself is loaded here. Linking to a LOINC code that is not loaded stubs a DRAFT concept
 *  (terminology-admin-store.ts, termMappings.create and saveExclusive), so DRAFT rows alone do not count. */
export async function isLoincLoaded(db: Kysely<InternalSchema>): Promise<boolean> {
  const row = await db.selectFrom('terminology_concepts').select('code')
    .where('system', '=', LOINC_SYSTEM)
    .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'DRAFT')]))
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
```

Replace the body of the closure's `loincLoaded` with `return isLoincLoaded(db);` and delete its old comment, which now sits on `isLoincLoaded`.

- [ ] **Step 4: Write the module**

Create `packages/bootstrap/src/result-fields.ts`:

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema, TerminologyAdminStore, TermMapping } from '@openldr/db';
import { LOINC_SYSTEM, RESULT_PARAM_SYSTEM, RESULT_ROLES } from '@openldr/terminology';
import { toCsv } from '@openldr/reporting';
import { isLoincLoaded, LOINC_CODE, TestCatalogError } from './test-catalog';
import { TEST_MAPPING_IMPORT_MAX_BYTES, TEST_MAPPING_IMPORT_MAX_ROWS } from './test-mapping';
import { readTableFile, TableFileError } from './table-file';

// Result fields (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md, 4.2 and 4.5): the
// site's result dictionary, urn:openldr:default_result, with each field's optional LOINC link. A link is
// a term mapping from the field to LOINC, the same shape as a catalog test's link. The routes and the
// CLI call this module (AGENTS.md section 6).

const MAP_TYPE = 'SAME-AS' as const;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const LOINC_FILTERS = ['linked', 'none', 'all'] as const;
const CSV_COLUMNS = ['code', 'display', 'role', 'units', 'loinc'].map((k) => ({ key: k, label: k }));

export interface ResultField { code: string; display: string | null; role: string | null; units: string | null; loinc: string | null }

export interface ResultFieldQuery { q: string; loinc: 'linked' | 'none' | 'all'; role: string | null; limit: number; offset: number }

export interface ResultFieldList {
  rows: ResultField[];
  total: number;
  /** false when this install received its dictionary from central and may not change its links. */
  ownedHere: boolean;
  /** false when no dictionary is loaded here at all. */
  loaded: boolean;
}

export interface ResultFieldLinkChange { code: string; before: string | null; after: string | null }

export interface ResultFieldImportReport {
  counts: { new: number; changed: number; unchanged: number; refused: number };
  refused: Array<{ line: number; code: string; reason: string }>;
}

/** Read list filters from a query string or CLI flags, so both doors refuse a bad value in the same words. */
export function parseResultFieldQuery(raw: Record<string, unknown>): { ok: true; query: ResultFieldQuery } | { ok: false; error: string } {
  const loinc = raw.loinc === undefined || raw.loinc === '' ? 'all' : String(raw.loinc);
  if (!(LOINC_FILTERS as readonly string[]).includes(loinc)) return { ok: false, error: 'loinc must be linked, none or all' };
  const role = raw.role === undefined || raw.role === '' ? null : String(raw.role);
  if (role !== null && !(RESULT_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: `role must be ${RESULT_ROLES.slice(0, -1).join(', ')} or ${RESULT_ROLES[RESULT_ROLES.length - 1]}` };
  }
  const limitRaw = raw.limit === undefined || raw.limit === '' ? String(DEFAULT_LIMIT) : String(raw.limit);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? '0' : String(raw.offset);
  if (!/^\d+$/.test(offsetRaw)) return { ok: false, error: 'offset must be a whole number from 0' };
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';
  return { ok: true, query: { q, loinc: loinc as ResultFieldQuery['loinc'], role, limit, offset: Number(offsetRaw) } };
}

function propsOf(properties: unknown): Record<string, unknown> {
  const value = typeof properties === 'string' ? (JSON.parse(properties) as unknown) : properties;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
// The export puts an apostrophe before a cell that starts with = @ + - (reporting toCsv). Take it off.
const unguard = (v: string): string => (/^'[=@+-]/.test(v) ? v.slice(1) : v);

export function createResultFields(deps: { db: Kysely<InternalSchema>; admin: TerminologyAdminStore; onChanged?: () => void }) {
  const { db } = deps;
  const invalid = (message: string) => new TestCatalogError(message, 'invalid');

  async function ownedHere(): Promise<boolean> {
    // A lab that pulled central's dictionary has this row stamped 'central' by its terminology drain, as
    // the catalog's row is (test-catalog.ts, ownedHere).
    const row = await db.selectFrom('terminology_systems').select('managed_origin')
      .where('url', '=', RESULT_PARAM_SYSTEM).executeTakeFirst();
    return row?.managed_origin !== 'central';
  }

  async function refuseUnlessOwned(): Promise<void> {
    if (!(await ownedHere())) {
      throw new TestCatalogError('this lab receives its result dictionary from central; only central can change its LOINC links', 'central-managed');
    }
  }

  async function readAll(): Promise<ResultField[]> {
    const concepts = await db.selectFrom('terminology_concepts').select(['code', 'display', 'properties'])
      .where('system', '=', RESULT_PARAM_SYSTEM).execute();
    const links = await db.selectFrom('term_mappings').select(['from_code', 'to_code'])
      .where('from_system', '=', RESULT_PARAM_SYSTEM).where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', MAP_TYPE).where('is_active', '=', true).execute();
    const loinc = new Map(links.map((l) => [l.from_code, l.to_code]));
    return concepts.map((c) => {
      const p = propsOf(c.properties);
      return { code: c.code, display: c.display, role: text(p.result_role), units: text(p.parm_units), loinc: loinc.get(c.code) ?? null };
    }).sort((a, b) => compare(a.code, b.code));
  }

  async function list(query: ResultFieldQuery): Promise<ResultFieldList> {
    const all = await readAll();
    const needle = query.q.toLowerCase();
    const matched = all.filter((f) => (query.loinc === 'all' || (query.loinc === 'linked') === (f.loinc !== null))
      && (query.role === null || f.role === query.role)
      && (needle === '' || [f.code, f.display, f.loinc].some((v) => (v ?? '').toLowerCase().includes(needle))));
    return {
      rows: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
      ownedHere: await ownedHere(),
      loaded: all.length > 0,
    };
  }

  async function currentLink(code: string): Promise<TermMapping | undefined> {
    return (await deps.admin.termMappings.listOutgoing(RESULT_PARAM_SYSTEM, code))
      .find((m) => m.toSystem === LOINC_SYSTEM && m.mapType === MAP_TYPE && m.isActive);
  }

  async function knownLoinc(loinc: string): Promise<boolean> {
    const row = await db.selectFrom('terminology_concepts').select('code')
      .where('system', '=', LOINC_SYSTEM).where('code', '=', loinc)
      .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'DRAFT')]))
      .executeTakeFirst();
    return row !== undefined;
  }

  /** The reason a LOINC code is refused, or null. With no LOINC loaded only the shape can be checked. */
  async function loincProblem(loinc: string, loaded: boolean): Promise<string | null> {
    if (!LOINC_CODE.test(loinc)) return `"${loinc}" is not a LOINC code. LOINC codes look like 12345-6.`;
    if (loaded && !(await knownLoinc(loinc))) return `LOINC code ${loinc} is not in the LOINC loaded on this install.`;
    return null;
  }

  async function saveLink(code: string, loinc: string): Promise<void> {
    // saveExclusive keeps one active LOINC link per field and deactivates the old one.
    await deps.admin.termMappings.saveExclusive({
      fromSystem: RESULT_PARAM_SYSTEM, fromCode: code, toSystem: LOINC_SYSTEM, toCode: loinc,
      toDisplay: null, mapType: MAP_TYPE, isActive: true,
    });
  }

  async function link(code: string, loinc: string): Promise<ResultFieldLinkChange> {
    await refuseUnlessOwned();
    if (!(await readAll()).some((f) => f.code === code)) throw new TestCatalogError(`no result field has code ${code}`, 'not-found');
    const wanted = loinc.trim();
    const problem = await loincProblem(wanted, await isLoincLoaded(db));
    if (problem) throw invalid(problem);
    const current = await currentLink(code);
    if (current?.toCode !== wanted) await saveLink(code, wanted);
    deps.onChanged?.();
    return { code, before: current?.toCode ?? null, after: wanted };
  }

  async function unlink(code: string): Promise<ResultFieldLinkChange> {
    await refuseUnlessOwned();
    const current = await currentLink(code);
    if (!current) throw new TestCatalogError(`${code} has no LOINC link`, 'not-found');
    const { id, ...rest } = current;
    await deps.admin.termMappings.update(id, { ...rest, isActive: false });
    deps.onChanged?.();
    return { code, before: current.toCode, after: null };
  }

  async function exportCsv(): Promise<string> {
    return toCsv(CSV_COLUMNS, (await readAll()).map((f) => ({ ...f })));
  }

  async function planImport(bytes: Uint8Array): Promise<{ report: ResultFieldImportReport; writes: Array<{ code: string; loinc: string }> }> {
    await refuseUnlessOwned();
    let table;
    try {
      table = readTableFile(bytes, 'csv', { maxBytes: TEST_MAPPING_IMPORT_MAX_BYTES, maxRows: TEST_MAPPING_IMPORT_MAX_ROWS });
    } catch (err) {
      if (err instanceof TableFileError) throw invalid(err.message);
      throw err;
    }
    const headers = table.headers.map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
    const col = (name: string): number => headers.indexOf(name);
    if (col('code') < 0 || col('loinc') < 0) throw invalid('the file needs a code column and a loinc column');
    const cell = (row: string[], name: string): string => (row[col(name)] ?? '').trim();

    const fields = new Map((await readAll()).map((f) => [f.code, f]));
    const loaded = await isLoincLoaded(db);
    const report: ResultFieldImportReport = { counts: { new: 0, changed: 0, unchanged: 0, refused: 0 }, refused: [] };
    const writes: Array<{ code: string; loinc: string }> = [];
    const seen = new Set<string>();
    const refuse = (line: number, code: string, reason: string) => {
      report.counts.refused += 1;
      report.refused.push({ line, code, reason });
    };

    for (let i = 0; i < table.rows.length; i++) {
      const line = i + 2;
      const code = unguard(cell(table.rows[i], 'code'));
      const loinc = cell(table.rows[i], 'loinc');
      if (code === '') { refuse(line, code, 'code is required'); continue; }
      if (seen.has(code)) { refuse(line, code, 'listed twice in the file'); continue; }
      seen.add(code);
      const field = fields.get(code);
      if (!field) { refuse(line, code, `no result field has code ${code}`); continue; }
      // A blank loinc leaves the link as it is. Clearing one is unlink.
      if (loinc === '') { report.counts.unchanged += 1; continue; }
      const problem = await loincProblem(loinc, loaded);
      if (problem) { refuse(line, code, problem); continue; }
      if (field.loinc === loinc) { report.counts.unchanged += 1; continue; }
      if (field.loinc === null) report.counts.new += 1; else report.counts.changed += 1;
      writes.push({ code, loinc });
    }
    return { report, writes };
  }

  async function importPreview(bytes: Uint8Array): Promise<ResultFieldImportReport> {
    return (await planImport(bytes)).report;
  }

  async function importApply(bytes: Uint8Array): Promise<ResultFieldImportReport> {
    const { report, writes } = await planImport(bytes);
    try {
      for (const w of writes) await saveLink(w.code, w.loinc);
    } finally {
      // Links already saved stay saved, so test_map must catch up even when a later write fails.
      if (writes.length > 0) deps.onChanged?.();
    }
    return report;
  }

  return { list, link, unlink, exportCsv, importPreview, importApply, ownedHere };
}

export type ResultFields = ReturnType<typeof createResultFields>;
```

If `TermMapping` is not exported from `@openldr/db`, take the type from the same import `test-catalog.ts` uses at its line 2 to 5. It is exported there today.

- [ ] **Step 5: Run the tests**

Run: `cd packages/bootstrap && npx vitest run src/result-fields.test.ts src/test-catalog`
Expected: PASS. The catalog tests prove the `isLoincLoaded` move changed nothing.

- [ ] **Step 6: Wire it into the app context**

In `packages/bootstrap/src/index.ts`:

1. Add the import beside the test mapping import (about line 78):
   ```ts
   import { createResultFields, type ResultFields } from './result-fields';
   ```
2. Add to the `AppContext` interface, after `testMapping: TestMapping;` (about line 550):
   ```ts
     /** The result dictionary and its LOINC links (result field mapping spec 4.5). */
     resultFields: ResultFields;
   ```
3. After `const testCatalog = createTestCatalog({ ... });` (about line 997), add:
   ```ts
   // A changed LOINC link changes the loinc column of test_map's result rows.
   const resultFields = createResultFields({ db: termDb, admin: termAdmin, onChanged: () => { void testMapping.requestRebuild(); } });
   ```
4. In the returned context object, after `testMapping,` (about line 1773), add `resultFields,`.
5. After `export * from './test-mapping';` (about line 1853), add `export * from './result-fields';`.

In `apps/server/src/test-helpers.ts`, after `testMapping: {} as never,` (line 557), add `resultFields: {} as never,`.

- [ ] **Step 7: Typecheck bootstrap and server**

Run: `cd packages/bootstrap && npx tsc --noEmit > /tmp/tc-bootstrap.txt 2>&1; echo "exit=$?"`
Run: `cd apps/server && npx tsc --noEmit > /tmp/tc-server.txt 2>&1; echo "exit=$?"`
Expected: both `exit=0`. If the server typecheck runs out of memory, re-run it alone before treating it as a failure (CLAUDE.md, test gate).

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/result-fields.ts packages/bootstrap/src/result-fields.test.ts packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/index.ts apps/server/src/test-helpers.ts
git commit -m "feat(bootstrap): result fields with LOINC links"
```

---

### Task 6: The `result-mappings` pack step

**Files:**
- Modify: `packages/marketplace/src/content-pack.ts`, `packages/marketplace/src/content-pack.test.ts`
- Modify: `packages/bootstrap/src/content-pack-install.ts`, `packages/bootstrap/src/content-pack-install.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (pack deps pass the level)
- Modify: `packages/cli/src/market.ts` (dry run names the level)

**Interfaces:**
- Consumes: Task 4's `planPack(mappings, level)` and `applyPack(mappings, level)`, and `MapLevel`.
- Produces:
  - Step kind `result-mappings` with `mappings: { system: string; code: string; loinc: string }[]`, summary label `Result mappings`.
  - Installer deps: `planTestMappings(mappings: PackMappingInput[], level: MapLevel)` and `applyTestMappings(mappings: PackMappingInput[], level: MapLevel)`.
  - `check(bundle)` returns `testMapPreview: Array<PackMappingPlan & { level: MapLevel }>`.
  - Audit row `test_mapping.pack` gains `metadata.level`.

- [ ] **Step 1: Write the failing schema test**

Append to `packages/marketplace/src/content-pack.test.ts`:

```ts
describe('result-mappings step', () => {
  const step = { kind: 'result-mappings', mappings: [{ system: 'urn:openldr:disa', code: 'HIVVL', loinc: '20447-9' }] };

  it('parses and summarises as "Result mappings" with the count', () => {
    const pack = parseContentPack({ formatVersion: 1, steps: [step] });
    expect(summarizeContentPack(pack)).toEqual([{ kind: 'result-mappings', label: 'Result mappings', count: 1 }]);
  });

  it('refuses a malformed LOINC code and an empty list', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ ...step, mappings: [{ system: 'x', code: 'y', loinc: 'abc' }] }] })).toThrow(/invalid pack/);
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ ...step, mappings: [] }] })).toThrow(/invalid pack/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/marketplace && npx vitest run src/content-pack.test.ts`
Expected: FAIL. The unknown kind is refused as needing a newer CE.

- [ ] **Step 3: Add the kind**

In `packages/marketplace/src/content-pack.ts`:

1. Add `'result-mappings'` to the end of `KINDS`.
2. After the `test-mappings` object in the step schema, add:
   ```ts
     // Lab result codes mapped to result fields by LOINC (result field mapping spec 4.7). A kind of its
     // own, not a level key on test-mappings: z.object drops unknown keys, so a CE from before this step
     // would read a level key as nothing and write result codes as test mappings. As a new kind, that CE
     // refuses the pack as needing a newer CE.
     z.object({
       kind: z.literal('result-mappings'),
       mappings: z.array(z.object({
         system: z.string().min(1), code: z.string().min(1), loinc: z.string().regex(/^\d{1,7}-\d$/),
       })).min(1),
     }),
   ```
3. In `summarizeContentPack`, after the `test-mappings` case, add:
   ```ts
         case 'result-mappings':
           return { kind: s.kind, label: 'Result mappings', count: s.mappings.length };
   ```

Run: `cd packages/marketplace && npx vitest run src/content-pack.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing installer test**

In `packages/bootstrap/src/content-pack-install.test.ts`:

1. In the existing test "a test-mappings step plans in check, writes in install, and audits the counts", change the `testMapPreview` expectation to start with `level: 'test',`:
   ```ts
   expect(checked.testMapPreview).toEqual([{
     level: 'test',
     mapped: [{ system: 'urn:openldr:disa', code: 'HIVVL', loinc: '25836-8', catalogCode: 'VL' }],
     kept: [],
     skipped: [{ system: 'urn:openldr:disa', code: 'WW', reason: 'no catalog test is linked to LOINC 9999-9' }],
   }]);
   ```
   and add `level: 'test',` inside the audit `metadata` it matches.
2. After that test, add:
   ```ts
   it('a result-mappings step plans and writes at the result level', async () => {
     const pack = { formatVersion: 1, steps: [{ kind: 'result-mappings', mappings: [
       { system: 'urn:openldr:disa', code: 'HIVVL', loinc: '20447-9' },
     ] }] };
     const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
     const s = setup();

     const checked = await s.installer.check(bundle);
     expect(checked.testMapPreview.map((p) => p.level)).toEqual(['result']);
     expect(s.deps.planTestMappings).toHaveBeenLastCalledWith(pack.steps[0].mappings, 'result');

     await s.installer.install(bundle, { actor });
     expect(s.deps.applyTestMappings).toHaveBeenLastCalledWith(pack.steps[0].mappings, 'result');
     expect(events(s.audit).find((e) => e.action === 'test_mapping.pack')).toMatchObject({ metadata: { level: 'result' } });
     await cleanup();
   });
   ```

Run: `cd packages/bootstrap && npx vitest run src/content-pack-install.test.ts`
Expected: FAIL. The preview has no `level`, and the installer has no `result-mappings` case.

- [ ] **Step 5: Handle both kinds in the installer**

In `packages/bootstrap/src/content-pack-install.ts`:

1. Import the level type beside `PackMappingInput`: add `type MapLevel` to that import from `./test-mapping`.
2. Change the two deps (about line 47):
   ```ts
     /** Resolve a pack's test or result mappings by LOINC, writing nothing (mapping specs 4.7). */
     planTestMappings(mappings: PackMappingInput[], level: MapLevel): Promise<PackMappingPlan>;
     /** Write the resolvable ones and rebuild test_map once. Existing mappings are kept. */
     applyTestMappings(mappings: PackMappingInput[], level: MapLevel): Promise<PackMappingPlan>;
   ```
3. Change `const testMapPreview: PackMappingPlan[] = [];` to `const testMapPreview: Array<PackMappingPlan & { level: MapLevel }> = [];`.
4. Replace the `test-mappings` case in the check pass with:
   ```ts
           case 'test-mappings':
           case 'result-mappings': {
             const level: MapLevel = step.kind === 'test-mappings' ? 'test' : 'result';
             testMapPreview.push({ level, ...(await deps.planTestMappings(step.mappings, level)) });
             break;
           }
   ```
5. Replace the `test-mappings` case in `runStep` with:
   ```ts
         case 'test-mappings':
         case 'result-mappings': {
           const level: MapLevel = step.kind === 'test-mappings' ? 'test' : 'result';
           const plan = await deps.applyTestMappings(step.mappings, level);
           await record({
             ...who(actor), action: 'test_mapping.pack', entityType: 'test_mapping', entityId: `pack:${at.pack}`,
             before: null, after: null,
             metadata: {
               ...source,
               level,
               mapped: plan.mapped.map((m) => ({ system: m.system, code: m.code, catalogCode: m.catalogCode })),
               kept: plan.kept, skipped: plan.skipped,
               mappedCount: plan.mapped.length, keptCount: plan.kept.length, skippedCount: plan.skipped.length,
             },
           });
           return;
         }
   ```
6. Change the return type of `check` to use `Array<PackMappingPlan & { level: MapLevel }>` for `testMapPreview`.

In `packages/bootstrap/src/index.ts` (about line 1147), change the two deps to:

```ts
    planTestMappings: (mappings, level) => testMapping.planPack(mappings, level),
    applyTestMappings: (mappings, level) => testMapping.applyPack(mappings, level),
```

- [ ] **Step 6: Name the level in the CLI dry run**

In `packages/cli/src/market.ts` (about line 157), change the preview line to:

```ts
            `${p.level === 'result' ? 'result' : 'test'} mappings: ${p.mapped.length} to map, ${p.kept.length} kept, ${p.skipped.length} skipped`,
```

- [ ] **Step 7: Run the tests**

Run: `cd packages/bootstrap && npx vitest run src/content-pack-install.test.ts src/test-mapping`
Run: `cd packages/cli && npx vitest run src/market.test.ts`
Expected: PASS. If `market.test.ts` builds a `testMapPreview` without `level`, the dry run still prints `test mappings:` for it.

- [ ] **Step 8: Typecheck**

Run: `cd packages/bootstrap && npx tsc --noEmit > /tmp/tc-bootstrap.txt 2>&1; echo "exit=$?"`
Run: `cd packages/marketplace && npx tsc --noEmit > /tmp/tc-market.txt 2>&1; echo "exit=$?"`
Run: `cd packages/cli && npx tsc --noEmit > /tmp/tc-cli.txt 2>&1; echo "exit=$?"`
Expected: all `exit=0`.

- [ ] **Step 9: Commit**

```bash
git add packages/marketplace/src/content-pack.ts packages/marketplace/src/content-pack.test.ts packages/bootstrap/src/content-pack-install.ts packages/bootstrap/src/content-pack-install.test.ts packages/bootstrap/src/index.ts packages/cli/src/market.ts
git commit -m "feat(marketplace): result-mappings content pack step"
```

The cdr-toolchain pack builder (`cdr-toolchain/packs/shared/pack-build.mjs`, `summarizeStep`) knows neither mapping kind. That is cdr work, out of scope (spec section 8). Task 12's live check builds its scratch pack without it.

---

### Task 7: HTTP routes

**Files:**
- Modify: `apps/server/src/test-mapping-routes.ts`, `apps/server/src/test-mapping-routes.test.ts`
- Create: `apps/server/src/result-fields-routes.ts`, `apps/server/src/result-fields-routes.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `ctx.testMapping` (Tasks 1 to 4), `ctx.resultFields` (Task 5), `parseMapLevel`, `parseResultFieldQuery`.
- Produces, every mapping route taking `level` (query string on GET and uploads, body on PUT and POST):
  - `GET /api/test-catalog/mappings/observed?level=result&...`
  - `GET /api/test-catalog/mappings/targets?level=result`
  - `PUT /api/test-catalog/mappings` body `{ system, code, catalogCode, level? }`
  - `POST /api/test-catalog/mappings/clear` body `{ system, code, level? }`
  - `GET /api/test-catalog/mappings/export?level=result` (file `result-mappings.csv` at the result level)
  - `POST /api/test-catalog/mappings/import/preview?level=result` and `/import/apply?level=result`
  - `GET /api/test-catalog/mappings/systems?level=result` returns `{ systems: string[] }`
  - `GET /api/test-catalog/mappings/match?system=...` returns `MatchPlan`
  - `POST /api/test-catalog/mappings/match` body `{ system }` returns `MatchPlan & { rebuild }`, audit `test_mapping.match`
  - `GET /api/test-catalog/result-fields?q&loinc&role&limit&offset` returns `ResultFieldList`
  - `PUT /api/test-catalog/result-fields/:code/loinc` body `{ loinc }`, audit `result_field.link`
  - `DELETE /api/test-catalog/result-fields/:code/loinc`, audit `result_field.unlink`
  - `GET /api/test-catalog/result-fields/export` (file `result-fields.csv`)
  - `POST /api/test-catalog/result-fields/import/preview` and `/import/apply`, audit `result_field.import`
  - Exported from `test-mapping-routes.ts` for reuse: `replyMappingError`, `readUpload`.

- [ ] **Step 1: Write the failing mapping route tests**

In `apps/server/src/test-mapping-routes.test.ts`:

1. Add to the fake `testMapping` object in `fakeCtx`:
   ```ts
       observedSystems: spy('observedSystems', over.observedSystems ?? (async () => ['urn:openldr:disa'])),
       planMatch: spy('planMatch', over.planMatch ?? (async () => MATCH)),
       applyMatch: spy('applyMatch', over.applyMatch ?? (async () => ({ ...MATCH, rebuild: CHANGE.rebuild }))),
   ```
   and add after `const REPORT = ...`:
   ```ts
   const MATCH = { system: DISA, matches: [{ code: 'HIVVL', display: 'HIV VL', results: 2 }] };
   ```
2. Every existing `calls` expectation now has the level appended. Change the observed test's expectation to
   `expect(calls).toEqual([{ method: 'observed', args: [{ status: 'mapped', q: 'viral', limit: 10, offset: 0 }, 'test'] }]);`
   and, in any other test that checks `args` for `targets`, `set`, `clear`, `exportCsv`, `importPreview` or `importApply`, append `'test'` the same way.
3. Append these tests inside the `describe`:
   ```ts
     it('passes level=result through to the service, and refuses an unknown level', async () => {
       const { ctx, calls } = fakeCtx();
       const app = appWith(ctx);
       await app.inject({ method: 'GET', url: '/api/test-catalog/mappings/observed?level=result' });
       await app.inject({ method: 'GET', url: '/api/test-catalog/mappings/targets?level=result' });
       await app.inject({ method: 'PUT', url: '/api/test-catalog/mappings', payload: { system: DISA, code: 'HIVVL', catalogCode: 'VLC', level: 'result' } });
       expect(calls.map((c) => [c.method, c.args[c.args.length - 1]])).toEqual([['observed', 'result'], ['targets', 'result'], ['set', 'result']]);
       const bad = await app.inject({ method: 'GET', url: '/api/test-catalog/mappings/observed?level=panel' });
       expect([bad.statusCode, bad.json()]).toEqual([400, { error: 'level must be test or result' }]);
     });

     it('records the level on the audit row of a set', async () => {
       const { ctx, audit } = fakeCtx();
       await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/mappings', payload: { system: DISA, code: 'HIVVL', catalogCode: 'VLC', level: 'result' } });
       expect(audit[0]).toMatchObject({ action: 'test_mapping.set', metadata: { level: 'result' } });
     });

     it('names the result-level export file', async () => {
       const { ctx } = fakeCtx();
       const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/mappings/export?level=result' });
       expect(res.headers['content-disposition']).toBe('attachment; filename="result-mappings.csv"');
     });

     it('lists observed systems, previews a match, and audits an applied match', async () => {
       const { ctx, calls, audit } = fakeCtx();
       const app = appWith(ctx);
       expect((await app.inject({ method: 'GET', url: '/api/test-catalog/mappings/systems?level=result' })).json()).toEqual({ systems: [DISA] });
       expect((await app.inject({ method: 'GET', url: `/api/test-catalog/mappings/match?system=${encodeURIComponent(DISA)}` })).json()).toEqual(MATCH);
       const applied = await app.inject({ method: 'POST', url: '/api/test-catalog/mappings/match', payload: { system: DISA } });
       expect(applied.statusCode).toBe(200);
       expect(calls.map((c) => c.method)).toEqual(['observedSystems', 'planMatch', 'applyMatch']);
       expect(audit[0]).toMatchObject({ action: 'test_mapping.match', entityId: `match:${DISA}`, metadata: { level: 'result', system: DISA, codes: ['HIVVL'] } });
     });

     it('refuses a match with no system, and a match by a viewer', async () => {
       const { ctx } = fakeCtx();
       expect((await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/mappings/match' })).statusCode).toBe(400);
       const viewer = await appWith(ctx, ['terminology.view']).inject({ method: 'POST', url: '/api/test-catalog/mappings/match', payload: { system: DISA } });
       expect(viewer.statusCode).toBe(403);
     });
   ```

Run: `cd apps/server && npx vitest run src/test-mapping-routes.test.ts`
Expected: FAIL. The routes ignore `level`, and `/systems` and `/match` do not exist.

- [ ] **Step 2: Add the level, systems and match to the mapping routes**

In `apps/server/src/test-mapping-routes.ts`:

1. Change the bootstrap import to:
   ```ts
   import { parseMapLevel, parseObservedQuery, TestCatalogError, TEST_MAPPING_IMPORT_MAX_BYTES, type AppContext } from '@openldr/bootstrap';
   ```
2. Change the header comment's first line to name both specs:
   ```ts
   // Test mapping and result field mapping (docs/superpowers/specs/2026-10-11-test-mapping-design.md and
   // 2026-10-11-result-field-mapping-design.md). Same gates as the catalog routes: terminology.view to
   // read, terminology.manage to change.
   ```
3. Replace the two body schemas with:
   ```ts
   const level = z.enum(['test', 'result']).optional();
   // catalogCode is the target code at either level: a catalog test, or a result field at level 'result'.
   const setBody = z.object({ system: z.string().min(1), code: z.string().min(1), catalogCode: z.string().min(1), level });
   const clearBody = z.object({ system: z.string().min(1), code: z.string().min(1), level });
   const matchBody = z.object({ system: z.string().min(1) });
   ```
4. Export `replyMappingError` and `readUpload` (add `export` before each `function`).
5. Add this helper after `readUpload`. It returns the parse result, so each handler returns its own 400 and the `reply.send` lint rule holds:
   ```ts
   /** The level from a query string. Blank means 'test'. */
   function levelOf(query: unknown): ReturnType<typeof parseMapLevel> {
     return parseMapLevel((query as Record<string, unknown> | undefined)?.level);
   }
   ```
6. Replace the route bodies as follows. Each existing route keeps its path and gate.

   Observed:
   ```ts
     app.get('/api/test-catalog/mappings/observed', VIEW, async (req, reply) => {
       const lvl = levelOf(req.query);
       if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
       const level = lvl.level;
       const parsed = parseObservedQuery(req.query as Record<string, unknown>);
       if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
       return reply.send(await ctx.testMapping.observed(parsed.query, level));
     });
   ```
   Targets:
   ```ts
     app.get('/api/test-catalog/mappings/targets', VIEW, async (req, reply) => {
       const lvl = levelOf(req.query);
       if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
       const level = lvl.level;
       return reply.send({ targets: await ctx.testMapping.targets(level) });
     });
   ```
   Set (the audit gains `level`):
   ```ts
     app.put('/api/test-catalog/mappings', MANAGE, async (req, reply) => {
       const parsed = setBody.safeParse(req.body);
       if (!parsed.success) return reply.code(400).send({ error: 'system, code and catalogCode are required; level must be test or result' });
       const lvl = parsed.data.level ?? 'test';
       try {
         const change = await ctx.testMapping.set(parsed.data.system, parsed.data.code, parsed.data.catalogCode, lvl);
         await recordAudit(ctx, req, {
           action: 'test_mapping.set', entityType: 'test_mapping', entityId: `${change.system}|${change.code}`,
           before: { catalogCode: change.before }, after: { catalogCode: change.after }, metadata: { level: lvl, rebuild: change.rebuild.ok },
         });
         return reply.send(change);
       } catch (err) { return replyMappingError(err, reply); }
     });
   ```
   Clear:
   ```ts
     app.post('/api/test-catalog/mappings/clear', MANAGE, async (req, reply) => {
       const parsed = clearBody.safeParse(req.body);
       if (!parsed.success) return reply.code(400).send({ error: 'system and code are required; level must be test or result' });
       const lvl = parsed.data.level ?? 'test';
       try {
         const change = await ctx.testMapping.clear(parsed.data.system, parsed.data.code, lvl);
         await recordAudit(ctx, req, {
           action: 'test_mapping.clear', entityType: 'test_mapping', entityId: `${change.system}|${change.code}`,
           before: { catalogCode: change.before }, after: { catalogCode: null }, metadata: { level: lvl, rebuild: change.rebuild.ok },
         });
         return reply.send(change);
       } catch (err) { return replyMappingError(err, reply); }
     });
   ```
   Export:
   ```ts
     app.get('/api/test-catalog/mappings/export', VIEW, async (req, reply) => {
       const lvl = levelOf(req.query);
       if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
       const level = lvl.level;
       const csv = await ctx.testMapping.exportCsv(level);
       return reply
         .header('content-type', 'text/csv; charset=utf-8')
         .header('content-disposition', `attachment; filename="${level === 'result' ? 'result' : 'test'}-mappings.csv"`)
         .send(csv);
     });
   ```
   Import preview and apply (the apply audit gains `level`):
   ```ts
     app.post('/api/test-catalog/mappings/import/preview', IMPORT_STEP, async (req, reply) => {
       const lvl = levelOf(req.query);
       if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
       const level = lvl.level;
       const bytes = await readUpload(req.body);
       if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
       try {
         return reply.send(await ctx.testMapping.importPreview(bytes, level));
       } catch (err) { return replyMappingError(err, reply); }
     });

     app.post('/api/test-catalog/mappings/import/apply', IMPORT_STEP, async (req, reply) => {
       const lvl = levelOf(req.query);
       if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
       const level = lvl.level;
       const bytes = await readUpload(req.body);
       if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
       try {
         const report = await ctx.testMapping.importApply(bytes, level);
         await recordAudit(ctx, req, {
           action: 'test_mapping.import', entityType: 'test_mapping', entityId: 'import',
           before: null, after: null, metadata: { level, counts: report.counts, refused: report.refused, rebuild: report.rebuild?.ok ?? null },
         });
         return reply.send(report);
       } catch (err) { return replyMappingError(err, reply); }
     });
   ```
7. Before the rebuild route, add:
   ```ts
     app.get('/api/test-catalog/mappings/systems', VIEW, async (req, reply) => {
       const lvl = levelOf(req.query);
       if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
       const level = lvl.level;
       return reply.send({ systems: await ctx.testMapping.observedSystems(level) });
     });

     // Map matching codes (result field mapping spec 4.5). Result level only.
     app.get('/api/test-catalog/mappings/match', VIEW, async (req, reply) => {
       const system = (req.query as Record<string, unknown> | undefined)?.system;
       if (typeof system !== 'string' || system === '') return reply.code(400).send({ error: 'system is required' });
       try {
         return reply.send(await ctx.testMapping.planMatch(system));
       } catch (err) { return replyMappingError(err, reply); }
     });

     app.post('/api/test-catalog/mappings/match', MANAGE, async (req, reply) => {
       const parsed = matchBody.safeParse(req.body);
       if (!parsed.success) return reply.code(400).send({ error: 'system is required' });
       try {
         const out = await ctx.testMapping.applyMatch(parsed.data.system);
         await recordAudit(ctx, req, {
           action: 'test_mapping.match', entityType: 'test_mapping', entityId: `match:${out.system}`,
           before: null, after: null,
           metadata: { level: 'result', system: out.system, codes: out.matches.map((m) => m.code), count: out.matches.length, rebuild: out.rebuild.ok },
         });
         return reply.send(out);
       } catch (err) { return replyMappingError(err, reply); }
     });
   ```

`apps/server` has real lint. Every handler returns its `reply.send(...)`, as the rule requires.

Run: `cd apps/server && npx vitest run src/test-mapping-routes.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing result fields route tests**

Create `apps/server/src/result-fields-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { TestCatalogError, type AppContext } from '@openldr/bootstrap';
import { registerResultFieldsRoutes } from './result-fields-routes';
import './auth-plugin';

const LIST = { rows: [{ code: 'VLC', display: 'HIV VL copies', role: 'result', units: null, loinc: '20447-9' }], total: 1, ownedHere: true, loaded: true };
const REPORT = { counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [] };

type Impl = (...args: any[]) => Promise<unknown>;

function fakeCtx(over: Record<string, Impl> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const spy = (method: string, impl: Impl): Impl => async (...args) => { calls.push({ method, args }); return impl(...args); };
  const resultFields = {
    list: spy('list', over.list ?? (async () => LIST)),
    link: spy('link', over.link ?? (async () => ({ code: 'VLC', before: null, after: '20447-9' }))),
    unlink: spy('unlink', over.unlink ?? (async () => ({ code: 'VLC', before: '20447-9', after: null }))),
    exportCsv: spy('exportCsv', over.exportCsv ?? (async () => 'code,display,role,units,loinc\n')),
    importPreview: spy('importPreview', over.importPreview ?? (async () => REPORT)),
    importApply: spy('importApply', over.importApply ?? (async () => REPORT)),
  };
  const ctx = {
    resultFields,
    audit: { record: async (e: Record<string, unknown>) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, calls, audit };
}

function appWith(ctx: AppContext, capabilities: string[] = ['terminology.view', 'terminology.manage']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'], capabilities };
  });
  registerResultFieldsRoutes(app, ctx);
  return app;
}

describe('result fields routes', () => {
  it('GET passes the parsed filters and returns the list', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/result-fields?loinc=linked&role=result&q=vl' });
    expect([res.statusCode, res.json()]).toEqual([200, LIST]);
    expect(calls).toEqual([{ method: 'list', args: [{ q: 'vl', loinc: 'linked', role: 'result', limit: 25, offset: 0 }] }]);
  });

  it('GET refuses a bad filter before the service', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/result-fields?loinc=some' });
    expect([res.statusCode, res.json()]).toEqual([400, { error: 'loinc must be linked, none or all' }]);
    expect(calls).toEqual([]);
  });

  it('PUT links and audits; DELETE unlinks and audits', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const app = appWith(ctx);
    const put = await app.inject({ method: 'PUT', url: '/api/test-catalog/result-fields/VLC/loinc', payload: { loinc: '20447-9' } });
    const del = await app.inject({ method: 'DELETE', url: '/api/test-catalog/result-fields/VLC/loinc' });
    expect([put.statusCode, del.statusCode]).toEqual([200, 200]);
    expect(calls.map((c) => [c.method, ...c.args])).toEqual([['link', 'VLC', '20447-9'], ['unlink', 'VLC']]);
    expect(audit.map((a) => [a.action, a.entityId])).toEqual([['result_field.link', 'VLC'], ['result_field.unlink', 'VLC']]);
  });

  it('maps refusals to 400, 404 and 409 with their kind', async () => {
    const refusing = (kind: 'invalid' | 'not-found' | 'central-managed') => fakeCtx({ link: async () => { throw new TestCatalogError('no', kind); } });
    const statuses = [];
    for (const kind of ['invalid', 'not-found', 'central-managed'] as const) {
      const res = await appWith(refusing(kind).ctx).inject({ method: 'PUT', url: '/api/test-catalog/result-fields/VLC/loinc', payload: { loinc: '1-1' } });
      statuses.push([res.statusCode, res.json().kind]);
    }
    expect(statuses).toEqual([[400, 'invalid'], [404, 'not-found'], [409, 'central-managed']]);
  });

  it('refuses a viewer\'s link with 403', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['terminology.view']).inject({ method: 'PUT', url: '/api/test-catalog/result-fields/VLC/loinc', payload: { loinc: '20447-9' } });
    expect(res.statusCode).toBe(403);
  });

  it('exports, previews and applies a CSV, auditing the apply', async () => {
    const { ctx, audit } = fakeCtx();
    const app = appWith(ctx);
    const exp = await app.inject({ method: 'GET', url: '/api/test-catalog/result-fields/export' });
    expect(exp.headers['content-disposition']).toBe('attachment; filename="result-fields.csv"');
    const upload = { headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('code,loinc\nVLC,20447-9\n') };
    expect((await app.inject({ method: 'POST', url: '/api/test-catalog/result-fields/import/preview', ...upload })).json()).toEqual(REPORT);
    expect((await app.inject({ method: 'POST', url: '/api/test-catalog/result-fields/import/apply', ...upload })).json()).toEqual(REPORT);
    expect(audit.map((a) => a.action)).toEqual(['result_field.import']);
  });
});
```

Run: `cd apps/server && npx vitest run src/result-fields-routes.test.ts`
Expected: FAIL with "Cannot find module './result-fields-routes'".

- [ ] **Step 4: Write the result fields routes**

Create `apps/server/src/result-fields-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { parseResultFieldQuery, TEST_MAPPING_IMPORT_MAX_BYTES, type AppContext } from '@openldr/bootstrap';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';
import { readUpload, replyMappingError } from './test-mapping-routes';

// Result fields (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md, 4.5 and 4.6): the
// result dictionary and each field's LOINC link. Same gates as the test mapping routes.
const VIEW = { preHandler: requireCapability('terminology.view') };
const MANAGE = { preHandler: requireCapability('terminology.manage') };
const IMPORT_STEP = { ...MANAGE, bodyLimit: TEST_MAPPING_IMPORT_MAX_BYTES + 1024 };

const linkBody = z.object({ loinc: z.string().min(1) });

export function registerResultFieldsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_req: unknown, payload: unknown, done: (e: null, b: unknown) => void) => done(null, payload));
  }

  app.get('/api/test-catalog/result-fields', VIEW, async (req, reply) => {
    const parsed = parseResultFieldQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.resultFields.list(parsed.query));
  });

  app.put('/api/test-catalog/result-fields/:code/loinc', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = linkBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'loinc is required' });
    try {
      const change = await ctx.resultFields.link(code, parsed.data.loinc);
      await recordAudit(ctx, req, {
        action: 'result_field.link', entityType: 'result_field', entityId: code,
        before: { loinc: change.before }, after: { loinc: change.after },
      });
      return reply.send(change);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.delete('/api/test-catalog/result-fields/:code/loinc', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      const change = await ctx.resultFields.unlink(code);
      await recordAudit(ctx, req, {
        action: 'result_field.unlink', entityType: 'result_field', entityId: code,
        before: { loinc: change.before }, after: { loinc: null },
      });
      return reply.send(change);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.get('/api/test-catalog/result-fields/export', VIEW, async (_req, reply) => {
    const csv = await ctx.resultFields.exportCsv();
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="result-fields.csv"')
      .send(csv);
  });

  app.post('/api/test-catalog/result-fields/import/preview', IMPORT_STEP, async (req, reply) => {
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
    try {
      return reply.send(await ctx.resultFields.importPreview(bytes));
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/result-fields/import/apply', IMPORT_STEP, async (req, reply) => {
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
    try {
      const report = await ctx.resultFields.importApply(bytes);
      await recordAudit(ctx, req, {
        action: 'result_field.import', entityType: 'result_field', entityId: 'import',
        before: null, after: null, metadata: { counts: report.counts, refused: report.refused },
      });
      return reply.send(report);
    } catch (err) { return replyMappingError(err, reply); }
  });
}
```

In `apps/server/src/app.ts`, add `import { registerResultFieldsRoutes } from './result-fields-routes';` beside the test mapping import (line 17), and `registerResultFieldsRoutes(app, ctx);` right after `registerTestMappingRoutes(app, ctx);` (line 155).

`/api/test-catalog/result-fields` is a static path segment. Fastify ranks it above the catalog's `/api/test-catalog/:code`, so the catalog route does not catch it. The first test in Step 3 proves it for this file only. Step 6 runs the whole server suite.

- [ ] **Step 5: Run the route tests and the lint**

Run: `cd apps/server && npx vitest run src/result-fields-routes.test.ts src/test-mapping-routes.test.ts src/terminology-admin-routes.test.ts`
Expected: PASS.
Run: `pnpm --filter @openldr/server lint > /tmp/lint-server.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 6: Typecheck and run the server suite**

Run: `cd apps/server && npx tsc --noEmit > /tmp/tc-server.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.
Run: `cd apps/server && npx vitest run > /tmp/server-tests.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. If not, grep `/tmp/server-tests.txt` for `Test timed out` and `out of memory` before reading a failure as a regression.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/test-mapping-routes.ts apps/server/src/test-mapping-routes.test.ts apps/server/src/result-fields-routes.ts apps/server/src/result-fields-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): result mapping and result field routes"
```

---

### Task 8: CLI commands

**Files:**
- Modify: `packages/cli/src/test-mapping.ts`, `packages/cli/src/test-mapping.test.ts`
- Create: `packages/cli/src/result-fields.ts`, `packages/cli/src/result-fields.test.ts`
- Modify: `packages/cli/src/program.ts`
- Modify: `packages/cli/src/terminology.ts`, `packages/cli/src/terminology.test.ts`

**Interfaces:**
- Consumes: `ctx.testMapping` and `ctx.resultFields` through `createAppContext`, `parseMapLevel`, `parseResultFieldQuery`, `recordAuditEvent`, `cliActor`.
- Produces:
  - `--level <test|result>` on `map list`, `map set`, `map clear`, `map export`, `map import`. Default `test`.
  - `openldr test-catalog map match <system> [--apply --force] [--json]`.
  - `openldr test-catalog result-fields list [--search] [--loinc linked|none|all] [--role <role>] [--limit] [--offset] [--json]`
  - `openldr test-catalog result-fields link <code> <loinc> [--json]`
  - `openldr test-catalog result-fields unlink <code> --force [--json]`
  - `openldr test-catalog result-fields export [--out <file>]`
  - `openldr test-catalog result-fields import <file> [--apply --force] [--json]`
  - `openldr terminology import parameters <file>` rebuilds `test_map` after the import.

- [ ] **Step 1: Write the failing map tests**

In `packages/cli/src/test-mapping.test.ts`:

1. Add `observedSystems: vi.fn(), planMatch: vi.fn(), applyMatch: vi.fn()` to the `testMapping` mock object.
2. Add `runTestMappingMatch` to the import from `./test-mapping`.
3. Append inside the `describe`:
   ```ts
     it('passes --level result to the service and refuses an unknown level', async () => {
       testMapping.set.mockResolvedValue({ system: DISA, code: 'HIVVL', before: null, after: 'VLC', rebuild: REBUILT });
       const io = capture();
       expect(await runTestMappingSet(DISA, 'HIVVL', 'VLC', { json: false, level: 'result' })).toBe(0);
       expect(testMapping.set).toHaveBeenCalledWith(DISA, 'HIVVL', 'VLC', 'result');
       expect(io.out()).toContain('HIVVL now maps to result field VLC.');
       expect(audit[0]).toMatchObject({ action: 'test_mapping.set', metadata: { level: 'result' } });
       expect(await runTestMappingSet(DISA, 'HIVVL', 'VLC', { json: false, level: 'panel' })).toBe(1);
       expect(io.err()).toContain('level must be test or result');
     });

     it('match previews without --apply and refuses --apply without --force', async () => {
       testMapping.planMatch.mockResolvedValue({ system: DISA, matches: [{ code: 'HIVVL', display: 'HIV VL', results: 2 }] });
       const io = capture();
       expect(await runTestMappingMatch(DISA, { apply: false, force: false, json: false })).toBe(0);
       expect(io.out()).toContain('would map 1 code(s)');
       expect(io.out()).toContain('  HIVVL  HIV VL  2');
       expect(testMapping.applyMatch).not.toHaveBeenCalled();
       expect(await runTestMappingMatch(DISA, { apply: true, force: false, json: false })).toBe(1);
       expect(testMapping.applyMatch).not.toHaveBeenCalled();
     });

     it('match --apply --force writes and audits', async () => {
       testMapping.applyMatch.mockResolvedValue({ system: DISA, matches: [{ code: 'HIVVL', display: 'HIV VL', results: 2 }], rebuild: REBUILT });
       capture();
       expect(await runTestMappingMatch(DISA, { apply: true, force: true, json: false })).toBe(0);
       expect(audit[0]).toMatchObject({ action: 'test_mapping.match', entityId: `match:${DISA}`, metadata: { codes: ['HIVVL'] } });
     });
   ```

Run: `cd packages/cli && npx vitest run src/test-mapping.test.ts`
Expected: FAIL. `runTestMappingMatch` does not exist.

- [ ] **Step 2: Add the level and match to the map commands**

In `packages/cli/src/test-mapping.ts`:

1. Change the bootstrap import to:
   ```ts
   import { createAppContext, parseMapLevel, parseObservedQuery, recordAuditEvent, type MapLevel, type RebuildOutcome } from '@openldr/bootstrap';
   ```
2. Add after `fail`:
   ```ts
   /** Read --level. Prints the refusal and returns null when it is not test or result. */
   function levelFlag(command: string, raw: string | undefined): MapLevel | null {
     const parsed = parseMapLevel(raw);
     if (parsed.ok) return parsed.level;
     process.stderr.write(`test-catalog map ${command} failed: ${parsed.error}\n`);
     return null;
   }
   ```
3. Add `level?: string` to `TestMappingListOpts`. In `runTestMappingList`, after the `parsed` check, add `const level = levelFlag('list', opts.level); if (!level) return 1;` and call `ctx.testMapping.observed(parsed.query, level)`.
4. Replace `runTestMappingSet` and `runTestMappingClear` with:
   ```ts
   export async function runTestMappingSet(system: string, code: string, targetCode: string, opts: { json: boolean; level?: string }): Promise<number> {
     const level = levelFlag('set', opts.level);
     if (!level) return 1;
     const ctx = await createAppContext(loadConfig());
     try {
       const change = await ctx.testMapping.set(system, code, targetCode, level);
       await recordAuditEvent(ctx, cliActor(), {
         action: 'test_mapping.set', entityType: 'test_mapping', entityId: `${system}|${code}`,
         before: { catalogCode: change.before }, after: { catalogCode: change.after }, metadata: { level, rebuild: change.rebuild.ok },
       });
       const done = level === 'result' ? `${code} now maps to result field ${targetCode}.` : `${code} now maps to ${targetCode}.`;
       process.stdout.write(opts.json ? JSON.stringify(change, null, 2) + '\n' : `${done}\n`);
       staleWarning(change.rebuild);
       return 0;
     } catch (err) { return fail('set', err, opts.json); } finally { await ctx.close(); }
   }

   export async function runTestMappingClear(system: string, code: string, opts: { force: boolean; json: boolean; level?: string }): Promise<number> {
     if (!opts.force) { process.stderr.write('test-catalog map clear removes a mapping; pass --force to do it.\n'); return 1; }
     const level = levelFlag('clear', opts.level);
     if (!level) return 1;
     const ctx = await createAppContext(loadConfig());
     try {
       const change = await ctx.testMapping.clear(system, code, level);
       await recordAuditEvent(ctx, cliActor(), {
         action: 'test_mapping.clear', entityType: 'test_mapping', entityId: `${system}|${code}`,
         before: { catalogCode: change.before }, after: { catalogCode: null }, metadata: { level, rebuild: change.rebuild.ok },
       });
       const done = level === 'result' ? `${code} no longer maps to a result field.` : `${code} no longer maps to a catalog test.`;
       process.stdout.write(opts.json ? JSON.stringify(change, null, 2) + '\n' : `${done}\n`);
       staleWarning(change.rebuild);
       return 0;
     } catch (err) { return fail('clear', err, opts.json); } finally { await ctx.close(); }
   }
   ```
5. In `runTestMappingExport`, add `level?: string` to `opts`, add `const level = levelFlag('export', opts.level); if (!level) return 1;` before the context opens, and call `ctx.testMapping.exportCsv(level)`.
6. In `runTestMappingImport`, add `level?: string` to `opts`, add `const level = levelFlag('import', opts.level); if (!level) return 1;` after the `--force` check, call `importApply(bytes, level)` and `importPreview(bytes, level)`, and add `level` to the audit `metadata`.
7. Append:
   ```ts
   /** `openldr test-catalog map match <system>`: the CLI door to Map matching codes (result field mapping
    *  spec 4.5). It previews unless --apply --force is given. */
   export async function runTestMappingMatch(system: string, opts: { apply: boolean; force: boolean; json: boolean }): Promise<number> {
     if (opts.apply && !opts.force) { process.stderr.write('test-catalog map match --apply writes mappings; pass --force to do it.\n'); return 1; }
     const ctx = await createAppContext(loadConfig());
     try {
       const out = opts.apply ? await ctx.testMapping.applyMatch(system) : await ctx.testMapping.planMatch(system);
       if (opts.apply && 'rebuild' in out) {
         await recordAuditEvent(ctx, cliActor(), {
           action: 'test_mapping.match', entityType: 'test_mapping', entityId: `match:${system}`, before: null, after: null,
           metadata: { level: 'result', system, codes: out.matches.map((m) => m.code), count: out.matches.length, rebuild: out.rebuild.ok },
         });
       }
       if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
       process.stdout.write([
         `${opts.apply ? 'mapped' : 'would map'} ${out.matches.length} code(s) in ${system} to the result field with the same code`,
         ...out.matches.map((m) => `  ${m.code}  ${m.display ?? ''}  ${m.results}`),
       ].join('\n') + '\n');
       if ('rebuild' in out) staleWarning(out.rebuild);
       return 0;
     } catch (err) { return fail('match', err, opts.json); } finally { await ctx.close(); }
   }
   ```

Run: `cd packages/cli && npx vitest run src/test-mapping.test.ts`
Expected: PASS. Slice 1's set test expected `${code} now maps to ${catalogCode}.`, which is unchanged at the test level.

- [ ] **Step 3: Write the failing result fields tests**

Create `packages/cli/src/result-fields.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resultFields = { list: vi.fn(), link: vi.fn(), unlink: vi.fn(), exportCsv: vi.fn(), importPreview: vi.fn(), importApply: vi.fn() };
const audit: unknown[] = [];
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
vi.mock('@openldr/bootstrap', async (orig) => {
  const actual = await orig<typeof import('@openldr/bootstrap')>();
  return {
    ...actual,
    createAppContext: async () => ({ resultFields, close: async () => {} }),
    recordAuditEvent: async (_ctx: unknown, _actor: unknown, e: unknown) => { audit.push(e); },
  };
});

import { runResultFieldsImport, runResultFieldsLink, runResultFieldsList, runResultFieldsUnlink } from './result-fields';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
  return { out: () => out.join(''), err: () => err.join('') };
}

beforeEach(() => { vi.restoreAllMocks(); audit.length = 0; for (const f of Object.values(resultFields)) f.mockReset(); });

describe('openldr test-catalog result-fields', () => {
  it('list refuses a bad filter in the route parser\'s words', async () => {
    const io = capture();
    expect(await runResultFieldsList({ loinc: 'some', json: false })).toBe(1);
    expect(io.err()).toContain('loinc must be linked, none or all');
    expect(resultFields.list).not.toHaveBeenCalled();
  });

  it('list prints one line per field', async () => {
    resultFields.list.mockResolvedValue({ rows: [{ code: 'VLC', display: 'HIV VL copies', role: 'result', units: 'copies/mL', loinc: '20447-9' }], total: 1, ownedHere: true, loaded: true });
    const io = capture();
    expect(await runResultFieldsList({ json: false })).toBe(0);
    expect(io.out()).toContain('VLC  HIV VL copies  result  copies/mL  LOINC 20447-9');
  });

  it('link audits as the CLI actor', async () => {
    resultFields.link.mockResolvedValue({ code: 'VLC', before: null, after: '20447-9' });
    capture();
    expect(await runResultFieldsLink('VLC', '20447-9', { json: false })).toBe(0);
    expect(audit[0]).toMatchObject({ action: 'result_field.link', entityId: 'VLC', after: { loinc: '20447-9' } });
  });

  it('unlink and an applied import refuse without --force', async () => {
    capture();
    expect(await runResultFieldsUnlink('VLC', { force: false, json: false })).toBe(1);
    expect(resultFields.unlink).not.toHaveBeenCalled();
    const file = join(mkdtempSync(join(tmpdir(), 'rf-')), 'links.csv');
    writeFileSync(file, 'code,loinc\nVLC,20447-9\n');
    expect(await runResultFieldsImport(file, { apply: true, force: false, json: false })).toBe(1);
    expect(resultFields.importApply).not.toHaveBeenCalled();
  });

  it('import previews by default', async () => {
    resultFields.importPreview.mockResolvedValue({ counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [] });
    const file = join(mkdtempSync(join(tmpdir(), 'rf-')), 'links.csv');
    writeFileSync(file, 'code,loinc\nVLC,20447-9\n');
    const io = capture();
    expect(await runResultFieldsImport(file, { apply: false, force: false, json: false })).toBe(0);
    expect(io.out()).toContain('would link 1 new, change 0, leave 0 unchanged, refuse 0');
  });
});
```

Run: `cd packages/cli && npx vitest run src/result-fields.test.ts`
Expected: FAIL with "Cannot find module './result-fields'".

- [ ] **Step 4: Write the result fields commands**

Create `packages/cli/src/result-fields.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createAppContext, parseResultFieldQuery, recordAuditEvent } from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

// `openldr test-catalog result-fields ...`: the CLI doors to the result fields routes (result field
// mapping spec 4.6). Named result-fields because `test-catalog params <code>` already edits one test's
// result parameters. Each command catches its own errors and returns an exit code.

function fail(command: string, err: unknown, json: boolean): number {
  const msg = redactError(err);
  if (json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  else process.stderr.write(`test-catalog result-fields ${command} failed: ${msg}\n`);
  return 1;
}

export interface ResultFieldsListOpts { search?: string; loinc?: string; role?: string; limit?: string; offset?: string; json: boolean }

export async function runResultFieldsList(opts: ResultFieldsListOpts): Promise<number> {
  const parsed = parseResultFieldQuery({ q: opts.search, loinc: opts.loinc, role: opts.role, limit: opts.limit, offset: opts.offset });
  if (!parsed.ok) { process.stderr.write(`test-catalog result-fields list failed: ${parsed.error}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.resultFields.list(parsed.query);
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    if (!out.loaded) { process.stdout.write('No result dictionary is loaded. Import one with openldr terminology import parameters <file>.\n'); return 0; }
    const lines = out.rows.map((f) => `${f.code}  ${f.display ?? ''}  ${f.role ?? ''}  ${f.units ?? ''}  ${f.loinc ? `LOINC ${f.loinc}` : 'no LOINC'}`);
    process.stdout.write([...lines, `${out.rows.length} of ${out.total} field(s)${out.ownedHere ? '' : ' (from central, read-only here)'}`].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('list', err, opts.json); } finally { await ctx.close(); }
}

export async function runResultFieldsLink(code: string, loinc: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const change = await ctx.resultFields.link(code, loinc);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'result_field.link', entityType: 'result_field', entityId: code,
      before: { loinc: change.before }, after: { loinc: change.after },
    });
    process.stdout.write(opts.json ? JSON.stringify(change, null, 2) + '\n' : `${code} is now linked to LOINC ${change.after}.\n`);
    return 0;
  } catch (err) { return fail('link', err, opts.json); } finally { await ctx.close(); }
}

export async function runResultFieldsUnlink(code: string, opts: { force: boolean; json: boolean }): Promise<number> {
  if (!opts.force) { process.stderr.write('test-catalog result-fields unlink removes a LOINC link; pass --force to do it.\n'); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const change = await ctx.resultFields.unlink(code);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'result_field.unlink', entityType: 'result_field', entityId: code,
      before: { loinc: change.before }, after: { loinc: null },
    });
    process.stdout.write(opts.json ? JSON.stringify(change, null, 2) + '\n' : `${code} no longer has a LOINC link.\n`);
    return 0;
  } catch (err) { return fail('unlink', err, opts.json); } finally { await ctx.close(); }
}

export async function runResultFieldsExport(opts: { out?: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const csv = await ctx.resultFields.exportCsv();
    if (opts.out) writeFileSync(opts.out, csv, 'utf8'); else process.stdout.write(csv);
    return 0;
  } catch (err) { return fail('export', err, false); } finally { await ctx.close(); }
}

export async function runResultFieldsImport(file: string, opts: { apply: boolean; force: boolean; json: boolean }): Promise<number> {
  if (opts.apply && !opts.force) { process.stderr.write('test-catalog result-fields import --apply writes links; pass --force to do it.\n'); return 1; }
  let bytes: Uint8Array;
  try { bytes = readFileSync(file); } catch (err) { process.stderr.write(`could not read ${file}: ${redactError(err)}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const report = opts.apply ? await ctx.resultFields.importApply(bytes) : await ctx.resultFields.importPreview(bytes);
    if (opts.apply) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'result_field.import', entityType: 'result_field', entityId: 'import',
        before: null, after: null, metadata: { counts: report.counts, refused: report.refused },
      });
    }
    if (opts.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return 0; }
    const c = report.counts;
    process.stdout.write([
      `${opts.apply ? 'linked' : 'would link'} ${c.new} new, change ${c.changed}, leave ${c.unchanged} unchanged, refuse ${c.refused}`,
      ...report.refused.map((r) => `  line ${r.line} ${r.code}: ${r.reason}`),
    ].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('import', err, opts.json); } finally { await ctx.close(); }
}
```

Run: `cd packages/cli && npx vitest run src/result-fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the commands**

In `packages/cli/src/program.ts`:

1. Add `runTestMappingMatch` to the import from `./test-mapping` (line 42 to 44).
2. Add an import:
   ```ts
   import {
     runResultFieldsList, runResultFieldsLink, runResultFieldsUnlink, runResultFieldsExport, runResultFieldsImport,
     type ResultFieldsListOpts,
   } from './result-fields';
   ```
3. Add `.option('--level <test|result>', 'test codes or result codes (default: test)')` to `map list`, `map set`, `map clear`, `map export` and `map import`. Add `level?: string` to each action's `opts` type and pass `opts` on as today. For `map set`, rename the third argument in the usage to `<target-code>` and its description to `'Map a lab test code to a catalog test, or with --level result a lab result code to a result field'`.
4. After the `map rebuild` command, add:
   ```ts
     testMap.command('match <system>')
       .description('Map each unmapped result code in one lab system to the result field with the same code. Shows the list unless --apply --force is given.')
       .option('--apply', 'write the mappings', false)
       .option('--force', 'confirm the write', false)
       .option('--json', 'emit JSON', false)
       .action(async (system: string, opts: { apply: boolean; force: boolean; json: boolean }) => {
         process.exitCode = await runTestMappingMatch(system, opts);
       });

     // Result field mapping spec 4.6: the result dictionary's LOINC links. Unlink and an applied import take --force.
     const resultFields = testCatalog.command('result-fields').description('The result dictionary and its LOINC links');
     resultFields.command('list')
       .description('List the result fields with their role, units and LOINC link')
       .option('--search <text>', 'match code, name or LOINC')
       .option('--loinc <linked|none|all>', 'which fields to list (default: all)')
       .option('--role <result|specimen|metadata|admin>', 'only fields with this role')
       .option('--limit <n>', 'rows per page, 1 to 200 (default: 25)')
       .option('--offset <n>', 'rows to skip (default: 0)')
       .option('--json', 'emit JSON', false)
       .action(async (opts: ResultFieldsListOpts) => { process.exitCode = await runResultFieldsList(opts); });
     resultFields.command('link <code> <loinc>')
       .description('Link a result field to a LOINC code')
       .option('--json', 'emit JSON', false)
       .action(async (code: string, loinc: string, opts: { json: boolean }) => { process.exitCode = await runResultFieldsLink(code, loinc, opts); });
     resultFields.command('unlink <code>')
       .description('Remove a result field\'s LOINC link')
       .option('--force', 'confirm the removal', false)
       .option('--json', 'emit JSON', false)
       .action(async (code: string, opts: { force: boolean; json: boolean }) => { process.exitCode = await runResultFieldsUnlink(code, opts); });
     resultFields.command('export')
       .description('Write every result field and its LOINC link as CSV, in the layout import reads')
       .option('--out <file>', 'write to this file instead of standard output')
       .action(async (opts: { out?: string }) => { process.exitCode = await runResultFieldsExport(opts); });
     resultFields.command('import <file>')
       .description('Import LOINC links from CSV. Shows what would change unless --apply --force is given.')
       .option('--apply', 'write the changes', false)
       .option('--force', 'confirm the write', false)
       .option('--json', 'emit JSON', false)
       .action(async (file: string, opts: { apply: boolean; force: boolean; json: boolean }) => { process.exitCode = await runResultFieldsImport(file, opts); });
   ```

Run: `cd packages/cli && npx vitest run src/test-catalog-cli-parsing.test.ts src/test-mapping.test.ts src/result-fields.test.ts`
Expected: PASS.

- [ ] **Step 6: Rebuild test_map after a dictionary import**

In `packages/cli/src/terminology.test.ts`:

1. Add to the hoisted `mocks` object:
   ```ts
     appCtx: { testMapping: { rebuildNow: vi.fn() }, close: vi.fn() },
     createAppContext: vi.fn(),
   ```
2. Add `createAppContext: mocks.createAppContext,` to the `@openldr/bootstrap` mock.
3. In `beforeEach`, add:
   ```ts
       mocks.createAppContext.mockResolvedValue(mocks.appCtx);
       mocks.appCtx.close.mockResolvedValue(undefined);
       mocks.appCtx.testMapping.rebuildNow.mockResolvedValue({ ok: true, result: { written: 2 } });
   ```
4. In "terminology import parameters audits coding_system.import", add at the end:
   ```ts
       // The import runs through a context with no warehouse, so the CLI rebuilds test_map itself.
       expect(mocks.appCtx.testMapping.rebuildNow).toHaveBeenCalledTimes(1);
       expect(mocks.appCtx.close).toHaveBeenCalledTimes(1);
   ```

Run: `cd packages/cli && npx vitest run src/terminology.test.ts`
Expected: FAIL. `rebuildNow` is not called.

In `packages/cli/src/terminology.ts`, add `createAppContext` to the bootstrap import. In the `parameters` branch, after its `recordAuditEvent(...)` line, add:

```ts
      // The dictionary's fields get self rows in test_map, and their LOINC links fill its loinc column.
      // This context opens no warehouse, so open the app context and rebuild once.
      const app = await createAppContext(loadConfig());
      try {
        const rebuilt = await app.testMapping.rebuildNow();
        if (!rebuilt.ok) {
          process.stderr.write(`the warehouse copy test_map is out of date: ${rebuilt.error}. Run openldr test-catalog map rebuild --apply.\n`);
        }
      } finally {
        await app.close();
      }
```

Run: `cd packages/cli && npx vitest run src/terminology.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and run the CLI suite**

Run: `cd packages/cli && npx tsc --noEmit > /tmp/tc-cli.txt 2>&1; echo "exit=$?"`
Run: `cd packages/cli && npx vitest run > /tmp/cli-tests.txt 2>&1; echo "exit=$?"`
Expected: both `exit=0`.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/test-mapping.ts packages/cli/src/test-mapping.test.ts packages/cli/src/result-fields.ts packages/cli/src/result-fields.test.ts packages/cli/src/program.ts packages/cli/src/terminology.ts packages/cli/src/terminology.test.ts
git commit -m "feat(cli): result mappings, map match and result-fields commands"
```

---

### Task 9: Studio, the Results mode of the Observed tab

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/test-catalog/ObservedCodesTab.tsx`, `ObservedCodesTab.test.tsx`
- Modify: `apps/studio/src/test-catalog/MapCodeSheet.tsx`, `MapCodeSheet.test.tsx`
- Modify: `apps/studio/src/test-catalog/ImportMappingsSheet.tsx`
- Create: `apps/studio/src/test-catalog/MatchCodesSheet.tsx`, `MatchCodesSheet.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: Task 7's routes.
- Produces, in `apps/studio/src/api.ts`:
  - `export type MapLevel = 'test' | 'result'`
  - `export interface MatchPlan { system: string; matches: Array<{ code: string; display: string | null; results: number }> }`
  - `listObservedTestCodes(p: { level?: MapLevel; status?; q?; limit; offset })`
  - `getMappingTargets(level?: MapLevel)`, `setTestMapping(system, code, catalogCode, level?)`, `clearTestMapping(system, code, level?)`, `previewTestMappingImport(file, level?)`, `applyTestMappingImport(file, level?)`, `downloadTestMappingsCsv(level?)`, each defaulting to `'test'`.
  - `getObservedSystems(level: MapLevel): Promise<string[]>`, `previewMatchCodes(system): Promise<MatchPlan>`, `applyMatchCodes(system): Promise<MatchPlan & { rebuild: RebuildOutcome }>`.
  - `export interface ImportReportLike { counts: MappingImportReport['counts']; refused: Array<{ line: number; code: string; reason: string }>; rebuild?: RebuildOutcome | null }`
- `MapCodeSheet` gains `level?: MapLevel`. `ImportMappingsSheet` gains optional `preview`, `apply` and `description` props. Task 10 reuses both.

- [ ] **Step 1: Update the API client**

In `apps/studio/src/api.ts`, in the block that starts `// Mirrors of @openldr/bootstrap's test-mapping.ts`:

1. Add after the comment line:
   ```ts
   export type MapLevel = 'test' | 'result';
   ```
2. Replace `RebuildOutcome` with:
   ```ts
   export interface LevelPublishSummary {
     mapped: number;
     ambiguous: Array<{ system: string; code: string; catalogCodes: string[] }>;
     targetMissing: Array<{ system: string; code: string; catalogCode: string }>;
   }
   export type RebuildOutcome =
     | { ok: true; result: LevelPublishSummary & { results: LevelPublishSummary; selfRows: number; written: number } }
     | { ok: false; error: string };
   ```
3. After `MappingImportReport`, add:
   ```ts
   /** What ImportMappingsSheet shows. Test mapping and result field imports both fit it. */
   export interface ImportReportLike {
     counts: MappingImportReport['counts'];
     refused: Array<{ line: number; code: string; reason: string }>;
     rebuild?: RebuildOutcome | null;
   }
   export interface MatchPlan { system: string; matches: Array<{ code: string; display: string | null; results: number }> }
   ```
4. Replace the functions from `listObservedTestCodes` through `downloadTestMappingsCsv` with:
   ```ts
   export function listObservedTestCodes(p: { level?: MapLevel; status?: ObservedStatus | 'all'; q?: string; limit: number; offset: number }): Promise<ObservedTestCodesResult> {
     const s = new URLSearchParams();
     if (p.level) s.set('level', p.level);
     if (p.status && p.status !== 'all') s.set('status', p.status);
     if (p.q) s.set('q', p.q);
     s.set('limit', String(p.limit));
     s.set('offset', String(p.offset));
     return apiGet<ObservedTestCodesResult>(`/api/test-catalog/mappings/observed?${s}`, 'list lab codes');
   }
   export const getMappingTargets = (level: MapLevel = 'test'): Promise<MappingTarget[]> =>
     apiGet<{ targets: MappingTarget[] }>(`/api/test-catalog/mappings/targets?level=${level}`, 'load mapping targets').then((r) => r.targets);
   export const setTestMapping = (system: string, code: string, catalogCode: string, level: MapLevel = 'test'): Promise<TestMappingChange> =>
     authFetch('/api/test-catalog/mappings', jbody({ system, code, catalogCode, level }, 'PUT')).then((r) => okJson<TestMappingChange>(r, 'map code'));
   export const clearTestMapping = (system: string, code: string, level: MapLevel = 'test'): Promise<TestMappingChange> =>
     authFetch('/api/test-catalog/mappings/clear', jbody({ system, code, level }, 'POST')).then((r) => okJson<TestMappingChange>(r, 'clear mapping'));
   const uploadCsv = <T,>(url: string, file: File, what: string): Promise<T> =>
     authFetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file }).then((r) => okJson<T>(r, what));
   export const previewTestMappingImport = (file: File, level: MapLevel = 'test'): Promise<MappingImportReport> =>
     uploadCsv(`/api/test-catalog/mappings/import/preview?level=${level}`, file, 'check mappings file');
   export const applyTestMappingImport = (file: File, level: MapLevel = 'test'): Promise<MappingImportReport> =>
     uploadCsv(`/api/test-catalog/mappings/import/apply?level=${level}`, file, 'import mappings');
   export const rebuildTestMap = (): Promise<RebuildOutcome> =>
     authFetch('/api/test-catalog/mappings/rebuild', { method: 'POST' }).then((r) => okJson<RebuildOutcome>(r, 'rebuild warehouse copy'));
   /** Fetched with the token, then saved through a link, exactly as downloadTestCatalogCsv does. */
   async function downloadCsv(url: string, filename: string, what: string): Promise<void> {
     const r = await authFetch(url, { method: 'GET' });
     if (!r.ok) throw new Error(formatApiError(what, await errorDetail(r)));
     const href = URL.createObjectURL(await r.blob());
     const a = document.createElement('a');
     a.href = href; a.download = filename;
     document.body.appendChild(a); a.click(); a.remove();
     URL.revokeObjectURL(href);
   }
   export const downloadTestMappingsCsv = (level: MapLevel = 'test'): Promise<void> =>
     downloadCsv(`/api/test-catalog/mappings/export?level=${level}`, `${level}-mappings.csv`, 'export mappings');
   export const getObservedSystems = (level: MapLevel): Promise<string[]> =>
     apiGet<{ systems: string[] }>(`/api/test-catalog/mappings/systems?level=${level}`, 'list lab systems').then((r) => r.systems);
   export const previewMatchCodes = (system: string): Promise<MatchPlan> =>
     apiGet<MatchPlan>(`/api/test-catalog/mappings/match?system=${encodeURIComponent(system)}`, 'check matching codes');
   export const applyMatchCodes = (system: string): Promise<MatchPlan & { rebuild: RebuildOutcome }> =>
     authFetch('/api/test-catalog/mappings/match', jbody({ system }, 'POST')).then((r) => okJson<MatchPlan & { rebuild: RebuildOutcome }>(r, 'map matching codes'));
   ```

If `uploadMappingsCsv` is referenced anywhere else (`grep -rn uploadMappingsCsv apps/studio/src`), change those calls to `uploadCsv`.

- [ ] **Step 2: Add the strings**

In `apps/studio/src/i18n/en.ts`, inside `testCatalog`:

1. In `observed`, add after `rowActions`:
   ```ts
         levelFilter: 'Level',
         level: { test: 'Tests', result: 'Results' },
         searchPlaceholderResult: 'Search code, description or result field',
         emptyResult: 'No lab result codes yet. They appear here once results arrive.',
         matchAction: 'Map matching codes',
         mapResultAction: 'Map to result field',
   ```
   and add `results: 'Results', resultField: 'Result field'` to `observed.col`.
2. In `mapSheet`, add after `retired`:
   ```ts
         titleResult: 'Map lab result code',
         descriptionResult: 'Reports count this lab code as the result field you choose.',
         resultField: 'Result field',
         pickResult: 'Choose a result field',
         searchResult: 'Search result fields',
         clearedResult: '{{code}} no longer maps to a result field',
   ```
3. In `importMappings`, add after `done`:
   ```ts
         descriptionResult: 'A CSV with system and code columns, and parameter_code or loinc. A row with both blank is left as it is.',
   ```
4. After the `importMappings` block, add:
   ```ts
       matchSheet: {
         title: 'Map matching codes',
         description: 'Maps each unmapped result code in one lab system to the result field with the same code. Nothing is written until you choose Map these codes.',
         section: 'Matching codes',
         actions: 'Matching actions',
         system: 'Lab system',
         pickSystem: 'Choose a lab system',
         apply: 'Map these codes',
         none: 'No unmapped code in this system matches a result field.',
         line: '{{code}} · {{display}} · {{count}} result(s)',
         done_one: 'Mapped {{count}} code',
         done_other: 'Mapped {{count}} codes',
       },
   ```

In `apps/studio/src/i18n/fr.ts`, same places:

```ts
      // observed
      levelFilter: 'Niveau',
      level: { test: 'Tests', result: 'Résultats' },
      searchPlaceholderResult: 'Rechercher un code, une description ou un champ de résultat',
      emptyResult: 'Aucun code de résultat de laboratoire pour l’instant. Ils apparaissent ici dès que des résultats arrivent.',
      matchAction: 'Associer les codes identiques',
      mapResultAction: 'Associer à un champ de résultat',
      // observed.col
      results: 'Résultats', resultField: 'Champ de résultat',
      // mapSheet
      titleResult: 'Associer un code de résultat de laboratoire',
      descriptionResult: 'Les rapports comptent ce code de laboratoire comme le champ de résultat choisi.',
      resultField: 'Champ de résultat',
      pickResult: 'Choisir un champ de résultat',
      searchResult: 'Rechercher un champ de résultat',
      clearedResult: '{{code}} ne correspond plus à aucun champ de résultat',
      // importMappings
      descriptionResult: 'Un CSV avec les colonnes system et code, et parameter_code ou loinc. Une ligne où les deux sont vides reste inchangée.',
    matchSheet: {
      title: 'Associer les codes identiques',
      description: 'Associe chaque code de résultat sans correspondance d’un système de laboratoire au champ de résultat qui porte le même code. Rien n’est écrit avant de choisir Associer ces codes.',
      section: 'Codes identiques',
      actions: 'Actions des codes identiques',
      system: 'Système de laboratoire',
      pickSystem: 'Choisir un système de laboratoire',
      apply: 'Associer ces codes',
      none: 'Aucun code sans correspondance de ce système ne correspond à un champ de résultat.',
      line: '{{code}} · {{display}} · {{count}} résultat(s)',
      done_one: '{{count}} code associé',
      done_other: '{{count}} codes associés',
    },
```

In `apps/studio/src/i18n/pt.ts`, same places:

```ts
      // observed
      levelFilter: 'Nível',
      level: { test: 'Testes', result: 'Resultados' },
      searchPlaceholderResult: 'Pesquisar código, descrição ou campo de resultado',
      emptyResult: 'Ainda não há códigos de resultado do laboratório. Aparecem aqui quando chegam resultados.',
      matchAction: 'Associar códigos iguais',
      mapResultAction: 'Associar a um campo de resultado',
      // observed.col
      results: 'Resultados', resultField: 'Campo de resultado',
      // mapSheet
      titleResult: 'Associar código de resultado do laboratório',
      descriptionResult: 'Os relatórios contam este código do laboratório como o campo de resultado escolhido.',
      resultField: 'Campo de resultado',
      pickResult: 'Escolher um campo de resultado',
      searchResult: 'Pesquisar campos de resultado',
      clearedResult: '{{code}} já não corresponde a nenhum campo de resultado',
      // importMappings
      descriptionResult: 'Um CSV com as colunas system e code, e parameter_code ou loinc. Uma linha com ambos vazios fica como está.',
    matchSheet: {
      title: 'Associar códigos iguais',
      description: 'Associa cada código de resultado sem correspondência de um sistema do laboratório ao campo de resultado com o mesmo código. Nada é gravado até escolher Associar estes códigos.',
      section: 'Códigos iguais',
      actions: 'Ações dos códigos iguais',
      system: 'Sistema do laboratório',
      pickSystem: 'Escolher um sistema do laboratório',
      apply: 'Associar estes códigos',
      none: 'Nenhum código sem correspondência deste sistema corresponde a um campo de resultado.',
      line: '{{code}} · {{display}} · {{count}} resultado(s)',
      done_one: '{{count}} código associado',
      done_other: '{{count}} códigos associados',
    },
```

The `// observed` comments mark where each line goes. Do not paste the comments.

- [ ] **Step 3: Write the failing studio tests**

In `apps/studio/src/test-catalog/ObservedCodesTab.test.tsx`:

1. Add `getObservedSystems: vi.fn(async () => [])` to the `@/api` mock.
2. Change both existing call expectations to include `level: 'test'`:
   `{ level: 'test', status: 'all', q: undefined, limit: 25, offset: 0 }` and `{ level: 'test', status: 'unmapped', q: undefined, limit: 25, offset: 0 }`.
3. Append inside the `describe`:
   ```ts
     it('switches to result codes, with their own column names and the match action', async () => {
       vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [ROW], total: 1, warehouse: { stale: false, error: null } });
       render(<ObservedCodesTab canManage />);
       await screen.findByTestId('observed-row-HIVVL');
       fireEvent.click(screen.getByTestId('observed-level-result'));
       await waitFor(() => expect(vi.mocked(api.listObservedTestCodes)).toHaveBeenLastCalledWith({ level: 'result', status: 'all', q: undefined, limit: 25, offset: 0 }));
       await screen.findByTestId('observed-row-HIVVL');
       expect(screen.getByText('Result field')).toBeTruthy();
       openMenu('observed-menu-trigger');
       expect(await screen.findByTestId('observed-match')).toBeTruthy();
     });

     it('hides the match action at the test level', async () => {
       vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [ROW], total: 1, warehouse: { stale: false, error: null } });
       render(<ObservedCodesTab canManage />);
       await screen.findByTestId('observed-row-HIVVL');
       openMenu('observed-menu-trigger');
       await screen.findByTestId('observed-export');
       expect(screen.queryByTestId('observed-match')).toBeNull();
     });
   ```
   and add the menu helper the other studio tests use, after the imports:
   ```ts
   // Radix menus open on pointerDown in jsdom, with Enter as the fallback (as in ImportMappingsSheet.test.tsx).
   function openMenu(testId: string) {
     const trigger = screen.getByTestId(testId);
     fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
     if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
   }
   ```

In `apps/studio/src/test-catalog/MapCodeSheet.test.tsx`, change line 47 to
`await waitFor(() => expect(api.setTestMapping).toHaveBeenCalledWith(DISA, 'HIVVL', 'VL', 'test'));`

Create `apps/studio/src/test-catalog/MatchCodesSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getObservedSystems: vi.fn(), previewMatchCodes: vi.fn(), applyMatchCodes: vi.fn() };
});

import * as api from '@/api';
import { MatchCodesSheet } from './MatchCodesSheet';

const DISA = 'urn:openldr:disa';

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => {
  vi.mocked(api.getObservedSystems).mockResolvedValue([DISA]);
  vi.mocked(api.previewMatchCodes).mockReset();
  vi.mocked(api.applyMatchCodes).mockReset();
});

describe('MatchCodesSheet', () => {
  it('picks the only system, lists its matches, and applies them', async () => {
    vi.mocked(api.previewMatchCodes).mockResolvedValue({ system: DISA, matches: [{ code: 'HIVVL', display: 'HIV VL', results: 2 }] });
    vi.mocked(api.applyMatchCodes).mockResolvedValue({ system: DISA, matches: [{ code: 'HIVVL', display: 'HIV VL', results: 2 }], rebuild: { ok: false, error: 'boom' } });
    const onApplied = vi.fn();
    render(<MatchCodesSheet open onClose={vi.fn()} onApplied={onApplied} />);
    expect(await screen.findByText('HIVVL · HIV VL · 2 result(s)')).toBeTruthy();
    expect(api.previewMatchCodes).toHaveBeenCalledWith(DISA);
    openMenu('match-sheet-menu');
    const apply = await screen.findByTestId('match-sheet-apply');
    await act(async () => { fireEvent.click(apply); });
    await waitFor(() => expect(api.applyMatchCodes).toHaveBeenCalledWith(DISA));
    expect(onApplied).toHaveBeenCalled();
  });

  it('says so when nothing matches, and keeps apply disabled', async () => {
    vi.mocked(api.previewMatchCodes).mockResolvedValue({ system: DISA, matches: [] });
    render(<MatchCodesSheet open onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(await screen.findByText('No unmapped code in this system matches a result field.')).toBeTruthy();
    openMenu('match-sheet-menu');
    expect((await screen.findByTestId('match-sheet-apply')).getAttribute('aria-disabled')).toBe('true');
  });
});
```

Run: `cd apps/studio && npx vitest run src/test-catalog`
Expected: FAIL. There is no level switch and no `MatchCodesSheet`.

- [ ] **Step 4: Let ImportMappingsSheet take its functions**

In `apps/studio/src/test-catalog/ImportMappingsSheet.tsx`:

1. Change the API import to:
   ```ts
   import { applyTestMappingImport, previewTestMappingImport, type ImportReportLike } from '@/api';
   ```
2. Replace the component's signature and state with:
   ```tsx
   /** The import sheet for test mappings. Result mappings and result field links pass their own functions
    *  and description; every caller shares the preview, refusals and apply. */
   export function ImportMappingsSheet({ open, onClose, onImported, preview = previewTestMappingImport, apply: applyFile = applyTestMappingImport, description }: {
     open: boolean;
     onClose: () => void;
     onImported: () => void;
     preview?: (file: File) => Promise<ImportReportLike>;
     apply?: (file: File) => Promise<ImportReportLike>;
     description?: string;
   }): JSX.Element {
     const { t } = useTranslation();
     const [file, setFile] = useState<File | null>(null);
     const [report, setReport] = useState<ImportReportLike | null>(null);
     const [busy, setBusy] = useState(false);
   ```
3. In `pick`, call `preview(f)` in place of `previewTestMappingImport(f)`.
4. Rename the inner `apply` function to `runApply`, call `applyFile(file)` inside it, and change the menu item's `onSelect` to `() => void runApply()`.
5. Change `<SheetDescription>{t('testCatalog.importMappings.description')}</SheetDescription>` to `<SheetDescription>{description ?? t('testCatalog.importMappings.description')}</SheetDescription>`.

`ImportMappingsSheet.test.tsx` passes no new props, so it still proves the defaults.

- [ ] **Step 5: Give MapCodeSheet a level**

In `apps/studio/src/test-catalog/MapCodeSheet.tsx`:

1. Add `type MapLevel` to the `@/api` import.
2. Change the signature to:
   ```tsx
   export function MapCodeSheet({ target, level = 'test', onClose, onSaved }: {
     target: ObservedTestCode | null;
     /** 'result' maps a lab result code to a result field. */
     level?: MapLevel;
     onClose: () => void;
     onSaved: () => void;
   }): JSX.Element {
   ```
3. In the effect, call `getMappingTargets(level)` and add `level` to its dependency list: `}, [target, level]);`.
4. After `const pickedName = ...`, add:
   ```tsx
     const result = level === 'result';
   ```
5. Pass the level on: `setTestMapping(target.system, target.code, picked, level)` and `clearTestMapping(target.system, target.code, level)`.
6. Swap the words by level:
   - title: `t(result ? 'testCatalog.mapSheet.titleResult' : 'testCatalog.mapSheet.title')`
   - description: `t(result ? 'testCatalog.mapSheet.descriptionResult' : 'testCatalog.mapSheet.description')`
   - the target label: `t(result ? 'testCatalog.mapSheet.resultField' : 'testCatalog.mapSheet.catalogTest')`
   - the picker placeholder and search: `t(result ? 'testCatalog.mapSheet.pickResult' : 'testCatalog.mapSheet.pick')` and `t(result ? 'testCatalog.mapSheet.searchResult' : 'testCatalog.mapSheet.search')`
   - the cleared toast: `t(result ? 'testCatalog.mapSheet.clearedResult' : 'testCatalog.mapSheet.cleared', { code: target.code })`

- [ ] **Step 6: Write MatchCodesSheet**

Create `apps/studio/src/test-catalog/MatchCodesSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LoadingState } from '@/components/ui/spinner';
import { applyMatchCodes, getObservedSystems, previewMatchCodes, type MatchPlan } from '@/api';

// Map matching codes (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md, 4.5). Header,
// section and menu copied from ImportMappingsSheet.tsx. Apply lives in the section's menu.

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function MatchCodesSheet({ open, onClose, onApplied }: { open: boolean; onClose: () => void; onApplied: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [systems, setSystems] = useState<string[]>([]);
  const [system, setSystem] = useState<string | null>(null);
  const [plan, setPlan] = useState<MatchPlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSystem(null);
    setPlan(null);
    getObservedSystems('result')
      .then((list) => {
        setSystems(list);
        // Most labs have one system. Pick it, so the preview shows at once.
        if (list.length === 1) setSystem(list[0]);
      })
      .catch((e: unknown) => { toast.error(errorText(e)); });
  }, [open]);

  useEffect(() => {
    if (!system) return;
    let live = true;
    setBusy(true);
    setPlan(null);
    previewMatchCodes(system)
      .then((p) => { if (live) setPlan(p); })
      .catch((e: unknown) => { if (live) toast.error(errorText(e)); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [system]);

  const apply = async () => {
    if (!system) return;
    setBusy(true);
    try {
      const out = await applyMatchCodes(system);
      toast.success(t('testCatalog.matchSheet.done', { count: out.matches.length }));
      if (!out.rebuild.ok) toast.error(t('testCatalog.observed.stale', { error: out.rebuild.error }));
      onApplied();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.matchSheet.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.matchSheet.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t('testCatalog.matchSheet.section')}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="match-sheet-menu" aria-label={t('testCatalog.matchSheet.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="match-sheet-apply"
                  disabled={busy || !plan || plan.matches.length === 0}
                  onSelect={() => void apply()}
                >
                  {t('testCatalog.matchSheet.apply')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <div className="text-muted-foreground">{t('testCatalog.matchSheet.system')}</div>
            <Select value={system ?? undefined} onValueChange={setSystem} disabled={busy}>
              <SelectTrigger data-testid="match-sheet-system" className="min-w-0">
                <SelectValue placeholder={t('testCatalog.matchSheet.pickSystem')} />
              </SelectTrigger>
              <SelectContent>
                {systems.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {system && busy && !plan && <LoadingState className="min-h-[8rem]" label={t('common.loading')} />}
          {plan && (
            <div className="space-y-1 border-t border-border px-6 py-4 text-sm" data-testid="match-sheet-list">
              {plan.matches.length === 0
                ? <div className="text-muted-foreground">{t('testCatalog.matchSheet.none')}</div>
                : plan.matches.map((m) => (
                  <div key={m.code} className="break-all">
                    {t('testCatalog.matchSheet.line', { code: m.code, display: m.display ?? '', count: m.results })}
                  </div>
                ))}
            </div>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}

export default MatchCodesSheet;
```

The match list is a plain list in the sheet, not a `<Table>`, so the pagination rule does not apply. The sheet scrolls.

- [ ] **Step 7: Add the level switch to the Observed tab**

In `apps/studio/src/test-catalog/ObservedCodesTab.tsx`:

1. Add to the `@/api` import: `applyTestMappingImport, previewTestMappingImport, type MapLevel`. Add `import { MatchCodesSheet } from './MatchCodesSheet';`.
2. After `const STATUSES = ...`, add `const LEVELS: MapLevel[] = ['test', 'result'];`.
3. Add state after `status`: `const [level, setLevel] = useState<MapLevel>('test');`, and after `importing`: `const [matching, setMatching] = useState(false);`. Add `const result = level === 'result';` after the state.
4. In `load`, call `listObservedTestCodes({ level, status, q: q || undefined, limit: pageSize, offset: page * pageSize })` and add `level` to its dependency list.
5. Before the status button group, add the level group, styled the same way:
   ```tsx
           <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('testCatalog.observed.levelFilter')}>
             {LEVELS.map((l) => (
               <Button
                 key={l}
                 variant={level === l ? 'secondary' : 'ghost'}
                 size="sm"
                 className="h-8"
                 data-testid={`observed-level-${l}`}
                 aria-pressed={level === l}
                 onClick={() => { setLevel(l); setPage(0); }}
               >
                 {t(`testCatalog.observed.level.${l}`)}
               </Button>
             ))}
           </div>
   ```
6. Search placeholder: `placeholder={t(result ? 'testCatalog.observed.searchPlaceholderResult' : 'testCatalog.observed.searchPlaceholder')}`.
7. Export item: `downloadTestMappingsCsv(level).catch(...)`. After the rebuild item, add:
   ```tsx
                   {result && (
                     <DropdownMenuItem data-testid="observed-match" onSelect={() => setMatching(true)}>
                       {t('testCatalog.observed.matchAction')}
                     </DropdownMenuItem>
                   )}
   ```
8. Empty state text: `t(result ? 'testCatalog.observed.emptyResult' : 'testCatalog.observed.empty')` in place of `t('testCatalog.observed.empty')`.
9. Column headers: `t(result ? 'testCatalog.observed.col.results' : 'testCatalog.observed.col.requests')` and `t(result ? 'testCatalog.observed.col.resultField' : 'testCatalog.observed.col.catalog')`.
10. Row menu item: `t(result ? 'testCatalog.observed.mapResultAction' : 'testCatalog.observed.mapAction')`.
11. Replace the two sheets at the bottom with:
   ```tsx
         <MapCodeSheet target={mapping} level={level} onClose={() => setMapping(null)} onSaved={() => { void load(); }} />
         <ImportMappingsSheet
           open={importing}
           onClose={() => setImporting(false)}
           onImported={() => { void load(); }}
           preview={(f) => previewTestMappingImport(f, level)}
           apply={(f) => applyTestMappingImport(f, level)}
           description={t(result ? 'testCatalog.importMappings.descriptionResult' : 'testCatalog.importMappings.description')}
         />
         <MatchCodesSheet open={matching} onClose={() => setMatching(false)} onApplied={() => { void load(); }} />
   ```

- [ ] **Step 8: Run the studio tests**

Run: `cd apps/studio && npx vitest run src/test-catalog src/i18n`
Expected: PASS. If an i18n test checks that the three locale files have the same keys, it proves Step 2 is complete.

- [ ] **Step 9: Typecheck**

Run: `cd apps/studio && npx tsc --noEmit > /tmp/tc-studio.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 10: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/test-catalog/ObservedCodesTab.tsx apps/studio/src/test-catalog/ObservedCodesTab.test.tsx apps/studio/src/test-catalog/MapCodeSheet.tsx apps/studio/src/test-catalog/MapCodeSheet.test.tsx apps/studio/src/test-catalog/ImportMappingsSheet.tsx apps/studio/src/test-catalog/MatchCodesSheet.tsx apps/studio/src/test-catalog/MatchCodesSheet.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): result codes on the Observed tab, and Map matching codes"
```

---

### Task 10: Studio, the Result fields tab

**Files:**
- Modify: `apps/studio/src/api.ts`
- Create: `apps/studio/src/test-catalog/ResultFieldsTab.tsx`, `ResultFieldsTab.test.tsx`
- Create: `apps/studio/src/test-catalog/ResultFieldSheet.tsx`, `ResultFieldSheet.test.tsx`
- Modify: `apps/studio/src/pages/TestCatalog.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: Task 7's result fields routes, Task 9's `ImportMappingsSheet` props and `downloadCsv` helper, `TermPicker` from `@/terminology/TermPicker`, `TestCatalogOptions['loinc']`.
- Produces, in `apps/studio/src/api.ts`:
  - `export interface ResultField { code: string; display: string | null; role: string | null; units: string | null; loinc: string | null }`
  - `export interface ResultFieldList { rows: ResultField[]; total: number; ownedHere: boolean; loaded: boolean }`
  - `export interface ResultFieldLinkChange { code: string; before: string | null; after: string | null }`
  - `listResultFields(p: { q?: string; loinc?: 'linked' | 'none' | 'all'; role?: string; limit: number; offset: number }): Promise<ResultFieldList>`
  - `linkResultField(code, loinc)`, `unlinkResultField(code)`, both `Promise<ResultFieldLinkChange>`.
  - `downloadResultFieldsCsv()`, `previewResultFieldsImport(file)`, `applyResultFieldsImport(file)`.
- `ResultFieldsTab({ canManage, loinc })` and `ResultFieldSheet({ field, ownedHere, loinc, onClose, onSaved })`.

- [ ] **Step 1: Add the API client functions**

In `apps/studio/src/api.ts`, after `applyMatchCodes` (Task 9), add:

```ts
// Mirrors of @openldr/bootstrap's result-fields.ts. The routes are apps/server/src/result-fields-routes.ts.
export interface ResultField { code: string; display: string | null; role: string | null; units: string | null; loinc: string | null }
export interface ResultFieldList { rows: ResultField[]; total: number; ownedHere: boolean; loaded: boolean }
export interface ResultFieldLinkChange { code: string; before: string | null; after: string | null }

export function listResultFields(p: { q?: string; loinc?: 'linked' | 'none' | 'all'; role?: string; limit: number; offset: number }): Promise<ResultFieldList> {
  const s = new URLSearchParams();
  if (p.q) s.set('q', p.q);
  if (p.loinc && p.loinc !== 'all') s.set('loinc', p.loinc);
  if (p.role) s.set('role', p.role);
  s.set('limit', String(p.limit));
  s.set('offset', String(p.offset));
  return apiGet<ResultFieldList>(`/api/test-catalog/result-fields?${s}`, 'list result fields');
}
const resultFieldLoincUrl = (code: string) => `/api/test-catalog/result-fields/${encodeURIComponent(code)}/loinc`;
export const linkResultField = (code: string, loinc: string): Promise<ResultFieldLinkChange> =>
  authFetch(resultFieldLoincUrl(code), jbody({ loinc }, 'PUT')).then((r) => okJson<ResultFieldLinkChange>(r, 'link LOINC'));
export const unlinkResultField = (code: string): Promise<ResultFieldLinkChange> =>
  authFetch(resultFieldLoincUrl(code), { method: 'DELETE' }).then((r) => okJson<ResultFieldLinkChange>(r, 'clear LOINC link'));
export const downloadResultFieldsCsv = (): Promise<void> =>
  downloadCsv('/api/test-catalog/result-fields/export', 'result-fields.csv', 'export result fields');
export const previewResultFieldsImport = (file: File): Promise<ImportReportLike> =>
  uploadCsv('/api/test-catalog/result-fields/import/preview', file, 'check result fields file');
export const applyResultFieldsImport = (file: File): Promise<ImportReportLike> =>
  uploadCsv('/api/test-catalog/result-fields/import/apply', file, 'import result fields');
```

- [ ] **Step 2: Add the strings**

In `apps/studio/src/i18n/en.ts`, inside `testCatalog`:

1. Change `tabs` to `tabs: { tests: 'Tests', resultFields: 'Result fields', observed: 'Observed' },`.
2. After the `matchSheet` block (Task 9), add:
   ```ts
       resultFields: {
         searchPlaceholder: 'Search code, name or LOINC',
         menuLabel: 'Result fields actions',
         exportAction: 'Export CSV',
         importAction: 'Import CSV',
         importDescription: 'A CSV with code and loinc columns. A blank loinc leaves the link as it is.',
         loincFilter: 'LOINC',
         loinc: { all: 'All', linked: 'Linked', none: 'No LOINC' },
         roleFilter: 'Role',
         role: { all: 'All roles', result: 'Result', specimen: 'Specimen', metadata: 'Metadata', admin: 'Admin' },
         col: { code: 'Code', name: 'Name', role: 'Role', units: 'Units', loinc: 'LOINC' },
         fromCentral: 'This result dictionary comes from central. Only central can change its LOINC links.',
         notLoaded: 'No result dictionary is loaded. Import one with openldr terminology import parameters <file>.',
         noMatch: 'No result fields match.',
         count_one: '{{count}} result field',
         count_other: '{{count}} result fields',
         actionsFor: 'Actions for {{code}}',
         linkAction: 'Link LOINC',
         rowActions: 'Row actions',
       },
       resultFieldSheet: {
         title: 'Result field',
         description: 'Link this result field to a LOINC code, so portable reports and content packs can find it.',
         section: 'LOINC link',
         actions: 'LOINC link actions',
         code: 'Code',
         name: 'Name',
         role: 'Role',
         units: 'Units',
         loinc: 'LOINC',
         loincTyped: 'LOINC is not loaded here, so only the format is checked.',
         clear: 'Clear link',
         saved: '{{code}} is now linked to LOINC {{loinc}}',
         cleared: '{{code}} no longer has a LOINC link',
       },
   ```

In `apps/studio/src/i18n/fr.ts`, same places:

```ts
    tabs: { tests: 'Tests', resultFields: 'Champs de résultat', observed: 'Observés' },
    resultFields: {
      searchPlaceholder: 'Rechercher un code, un nom ou un LOINC',
      menuLabel: 'Actions des champs de résultat',
      exportAction: 'Exporter en CSV',
      importAction: 'Importer un CSV',
      importDescription: 'Un CSV avec les colonnes code et loinc. Un loinc vide laisse le lien inchangé.',
      loincFilter: 'LOINC',
      loinc: { all: 'Tous', linked: 'Liés', none: 'Pas de LOINC' },
      roleFilter: 'Rôle',
      role: { all: 'Tous les rôles', result: 'Résultat', specimen: 'Échantillon', metadata: 'Métadonnée', admin: 'Administratif' },
      col: { code: 'Code', name: 'Nom', role: 'Rôle', units: 'Unités', loinc: 'LOINC' },
      fromCentral: 'Ce dictionnaire de résultats vient du central. Seul le central peut modifier ses liens LOINC.',
      notLoaded: 'Aucun dictionnaire de résultats n’est chargé. Importez-en un avec openldr terminology import parameters <fichier>.',
      noMatch: 'Aucun champ de résultat ne correspond.',
      count_one: '{{count}} champ de résultat',
      count_other: '{{count}} champs de résultat',
      actionsFor: 'Actions pour {{code}}',
      linkAction: 'Lier un LOINC',
      rowActions: 'Actions de la ligne',
    },
    resultFieldSheet: {
      title: 'Champ de résultat',
      description: 'Liez ce champ de résultat à un code LOINC, pour que les rapports portables et les packs de contenu le trouvent.',
      section: 'Lien LOINC',
      actions: 'Actions du lien LOINC',
      code: 'Code',
      name: 'Nom',
      role: 'Rôle',
      units: 'Unités',
      loinc: 'LOINC',
      loincTyped: 'LOINC n’est pas chargé ici, seul le format est vérifié.',
      clear: 'Supprimer le lien',
      saved: '{{code}} est maintenant lié au LOINC {{loinc}}',
      cleared: '{{code}} n’a plus de lien LOINC',
    },
```

In `apps/studio/src/i18n/pt.ts`, same places:

```ts
    tabs: { tests: 'Testes', resultFields: 'Campos de resultado', observed: 'Observados' },
    resultFields: {
      searchPlaceholder: 'Pesquisar código, nome ou LOINC',
      menuLabel: 'Ações dos campos de resultado',
      exportAction: 'Exportar CSV',
      importAction: 'Importar CSV',
      importDescription: 'Um CSV com as colunas code e loinc. Um loinc vazio deixa a ligação como está.',
      loincFilter: 'LOINC',
      loinc: { all: 'Todos', linked: 'Ligados', none: 'Sem LOINC' },
      roleFilter: 'Função',
      role: { all: 'Todas as funções', result: 'Resultado', specimen: 'Amostra', metadata: 'Metadado', admin: 'Administrativo' },
      col: { code: 'Código', name: 'Nome', role: 'Função', units: 'Unidades', loinc: 'LOINC' },
      fromCentral: 'Este dicionário de resultados vem do central. Só o central pode alterar as suas ligações LOINC.',
      notLoaded: 'Nenhum dicionário de resultados está carregado. Importe um com openldr terminology import parameters <ficheiro>.',
      noMatch: 'Nenhum campo de resultado corresponde.',
      count_one: '{{count}} campo de resultado',
      count_other: '{{count}} campos de resultado',
      actionsFor: 'Ações para {{code}}',
      linkAction: 'Ligar LOINC',
      rowActions: 'Ações da linha',
    },
    resultFieldSheet: {
      title: 'Campo de resultado',
      description: 'Ligue este campo de resultado a um código LOINC, para que os relatórios portáveis e os pacotes de conteúdo o encontrem.',
      section: 'Ligação LOINC',
      actions: 'Ações da ligação LOINC',
      code: 'Código',
      name: 'Nome',
      role: 'Função',
      units: 'Unidades',
      loinc: 'LOINC',
      loincTyped: 'O LOINC não está carregado aqui, por isso só o formato é verificado.',
      clear: 'Remover ligação',
      saved: '{{code}} está agora ligado ao LOINC {{loinc}}',
      cleared: '{{code}} já não tem ligação LOINC',
    },
```

- [ ] **Step 3: Write the failing tests**

Create `apps/studio/src/test-catalog/ResultFieldsTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listResultFields: vi.fn(), downloadResultFieldsCsv: vi.fn() };
});

import * as api from '@/api';
import { ResultFieldsTab } from './ResultFieldsTab';

const FIELD: api.ResultField = { code: 'VLC', display: 'HIV VL copies', role: 'result', units: 'copies/mL', loinc: '20447-9' };
const list = (over: Partial<api.ResultFieldList> = {}): api.ResultFieldList => ({ rows: [FIELD], total: 1, ownedHere: true, loaded: true, ...over });

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => { vi.mocked(api.listResultFields).mockReset(); });

describe('ResultFieldsTab', () => {
  it('shows the spinner, then a field with its role, units and LOINC', async () => {
    vi.mocked(api.listResultFields).mockResolvedValue(list());
    render(<ResultFieldsTab canManage loinc={null} />);
    expect(screen.getByRole('status')).toBeTruthy();
    const row = await screen.findByTestId('result-field-row-VLC');
    expect(row.textContent).toContain('HIV VL copies');
    expect(row.textContent).toContain('20447-9');
    expect(vi.mocked(api.listResultFields)).toHaveBeenCalledWith({ q: undefined, loinc: 'all', role: undefined, limit: 25, offset: 0 });
  });

  it('says no dictionary is loaded, with stripes and no table', async () => {
    vi.mocked(api.listResultFields).mockResolvedValue(list({ rows: [], total: 0, loaded: false }));
    render(<ResultFieldsTab canManage loinc={null} />);
    expect(await screen.findByText('No result dictionary is loaded. Import one with openldr terminology import parameters <file>.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('asks again with the LOINC filter', async () => {
    vi.mocked(api.listResultFields).mockResolvedValue(list());
    render(<ResultFieldsTab canManage loinc={null} />);
    await screen.findByTestId('result-field-row-VLC');
    fireEvent.click(screen.getByTestId('result-fields-loinc-none'));
    await waitFor(() => expect(vi.mocked(api.listResultFields)).toHaveBeenLastCalledWith({ q: undefined, loinc: 'none', role: undefined, limit: 25, offset: 0 }));
  });

  it('is read-only when the dictionary came from central', async () => {
    vi.mocked(api.listResultFields).mockResolvedValue(list({ ownedHere: false }));
    render(<ResultFieldsTab canManage loinc={null} />);
    await screen.findByTestId('result-field-row-VLC');
    expect(screen.getByText('This result dictionary comes from central. Only central can change its LOINC links.')).toBeTruthy();
    expect(screen.queryByTestId('result-field-actions-VLC')).toBeNull();
    openMenu('result-fields-menu-trigger');
    await screen.findByTestId('result-fields-export');
    expect(screen.queryByTestId('result-fields-import')).toBeNull();
  });
});
```

Create `apps/studio/src/test-catalog/ResultFieldSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    linkResultField: vi.fn(async () => ({ code: 'VLC', before: null, after: '20447-9' })),
    unlinkResultField: vi.fn(async () => ({ code: 'VLC', before: '20447-9', after: null })),
  };
});

import * as api from '@/api';
import { ResultFieldSheet } from './ResultFieldSheet';

const FIELD: api.ResultField = { code: 'VLC', display: 'HIV VL copies', role: 'result', units: null, loinc: null };

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('ResultFieldSheet', () => {
  it('saves a typed LOINC code when LOINC is not loaded', async () => {
    const onSaved = vi.fn();
    render(<ResultFieldSheet field={FIELD} ownedHere loinc={null} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByTestId('result-field-loinc'), { target: { value: '20447-9' } });
    openMenu('result-field-sheet-menu');
    const save = await screen.findByTestId('result-field-save');
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(api.linkResultField).toHaveBeenCalledWith('VLC', '20447-9'));
    expect(onSaved).toHaveBeenCalled();
  });

  it('clears an existing link', async () => {
    render(<ResultFieldSheet field={{ ...FIELD, loinc: '20447-9' }} ownedHere loinc={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    openMenu('result-field-sheet-menu');
    const clear = await screen.findByTestId('result-field-clear');
    await act(async () => { fireEvent.click(clear); });
    await waitFor(() => expect(api.unlinkResultField).toHaveBeenCalledWith('VLC'));
  });

  it('shows no actions when the dictionary came from central', () => {
    render(<ResultFieldSheet field={FIELD} ownedHere={false} loinc={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByTestId('result-field-sheet-menu')).toBeNull();
  });
});
```

Run: `cd apps/studio && npx vitest run src/test-catalog/ResultField`
Expected: FAIL with "Cannot find module './ResultFieldsTab'".

- [ ] **Step 4: Write ResultFieldSheet**

Create `apps/studio/src/test-catalog/ResultFieldSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TermPicker } from '@/terminology/TermPicker';
import { linkResultField, unlinkResultField, type ResultField, type TestCatalogOptions } from '@/api';

// One result field and its LOINC link (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md,
// 4.5). Header and section copied from MapCodeSheet.tsx, the LOINC input from TestSheet.tsx.

export function ResultFieldSheet({ field, ownedHere, loinc, onClose, onSaved }: {
  field: ResultField | null;
  /** false when the dictionary came from central. The sheet then only shows the field. */
  ownedHere: boolean;
  /** The LOINC code system when LOINC is loaded here, else null and the code is typed. */
  loinc: TestCatalogOptions['loinc'];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(field?.loinc ?? ''); }, [field]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const wanted = draft.trim();
  return (
    <Sheet open={field !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.resultFieldSheet.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.resultFieldSheet.description')}</SheetDescription>
        </SheetHeader>
        {field && (
          <section>
            <div className="flex items-center justify-between px-6 py-3">
              <div className="text-sm font-medium text-foreground">{t('testCatalog.resultFieldSheet.section')}</div>
              {ownedHere && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="result-field-sheet-menu" aria-label={t('testCatalog.resultFieldSheet.actions')}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      data-testid="result-field-save"
                      disabled={busy || wanted === '' || wanted === field.loinc}
                      onSelect={() => void run(() => linkResultField(field.code, wanted), t('testCatalog.resultFieldSheet.saved', { code: field.code, loinc: wanted }))}
                    >
                      {t('common.save')}
                    </DropdownMenuItem>
                    {field.loinc && (
                      <DropdownMenuItem
                        data-testid="result-field-clear"
                        disabled={busy}
                        onSelect={() => void run(() => unlinkResultField(field.code), t('testCatalog.resultFieldSheet.cleared', { code: field.code }))}
                      >
                        {t('testCatalog.resultFieldSheet.clear')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="border-t border-border" />
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <div className="text-muted-foreground">{t('testCatalog.resultFieldSheet.code')}</div>
              <div className="break-all font-mono text-xs">{field.code}</div>
              <div className="text-muted-foreground">{t('testCatalog.resultFieldSheet.name')}</div>
              <div>{field.display ?? ''}</div>
              <div className="text-muted-foreground">{t('testCatalog.resultFieldSheet.role')}</div>
              <div>{field.role ? t(`testCatalog.resultFields.role.${field.role}`) : ''}</div>
              <div className="text-muted-foreground">{t('testCatalog.resultFieldSheet.units')}</div>
              <div>{field.units ?? ''}</div>
              <div className="text-muted-foreground">{t('testCatalog.resultFieldSheet.loinc')}</div>
              {!ownedHere ? (
                <div>{field.loinc ?? ''}</div>
              ) : loinc ? (
                <TermPicker
                  systemId={loinc.systemId}
                  value={wanted ? { system: loinc.system, code: wanted, display: null } : null}
                  onChange={(v) => setDraft(v?.code ?? '')}
                />
              ) : (
                <div className="flex flex-col gap-1">
                  <Input data-testid="result-field-loinc" value={draft} placeholder="12345-6" disabled={busy} onChange={(e) => setDraft(e.target.value)} />
                  <span className="text-xs text-muted-foreground">{t('testCatalog.resultFieldSheet.loincTyped')}</span>
                </div>
              )}
            </div>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default ResultFieldSheet;
```

The role shows through `testCatalog.resultFields.role.<role>`. The loader only accepts the four roles that block names, so every stored role has a label.

- [ ] **Step 5: Write ResultFieldsTab**

Create `apps/studio/src/test-catalog/ResultFieldsTab.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import {
  applyResultFieldsImport, downloadResultFieldsCsv, listResultFields, previewResultFieldsImport,
  type ResultField, type ResultFieldList, type TestCatalogOptions,
} from '@/api';
import { ResultFieldSheet } from './ResultFieldSheet';
import { ImportMappingsSheet } from './ImportMappingsSheet';

// The Result fields tab of the Test catalog page (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md,
// 4.5). Layout copied from ObservedCodesTab.tsx.

type LoincFilter = 'all' | 'linked' | 'none';
const LOINC_FILTERS: LoincFilter[] = ['all', 'linked', 'none'];
const ROLES = ['result', 'specimen', 'metadata', 'admin'] as const;
const ALL_ROLES = 'all';

export function ResultFieldsTab({ canManage, loinc }: { canManage: boolean; loinc: TestCatalogOptions['loinc'] }): JSX.Element {
  const { t } = useTranslation();
  const [loincFilter, setLoincFilter] = useState<LoincFilter>('all');
  const [role, setRole] = useState<string>(ALL_ROLES);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<ResultFieldList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ResultField | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => { setQ(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  // Only the latest request may write state. A slower earlier response must not overwrite a newer one.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listResultFields({
        q: q || undefined, loinc: loincFilter, role: role === ALL_ROLES ? undefined : role, limit: pageSize, offset: page * pageSize,
      });
      if (mine === latest.current) setData(result);
    } catch (e) {
      if (mine === latest.current) {
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [q, loincFilter, role, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const ownedHere = data?.ownedHere ?? true;
  const canEdit = canManage && ownedHere;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="result-fields-tab">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('testCatalog.resultFields.searchPlaceholder')}
          className="h-8 sm:max-w-xs"
          data-testid="result-fields-search"
        />
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('testCatalog.resultFields.loincFilter')}>
          {LOINC_FILTERS.map((f) => (
            <Button
              key={f}
              variant={loincFilter === f ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              data-testid={`result-fields-loinc-${f}`}
              aria-pressed={loincFilter === f}
              onClick={() => { setLoincFilter(f); setPage(0); }}
            >
              {t(`testCatalog.resultFields.loinc.${f}`)}
            </Button>
          ))}
        </div>
        <Select value={role} onValueChange={(v) => { setRole(v); setPage(0); }}>
          <SelectTrigger className="h-8 sm:w-40" aria-label={t('testCatalog.resultFields.roleFilter')} data-testid="result-fields-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ROLES}>{t('testCatalog.resultFields.role.all')}</SelectItem>
            {ROLES.map((r) => <SelectItem key={r} value={r}>{t(`testCatalog.resultFields.role.${r}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        {canManage && (
          <div className="sm:ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="result-fields-menu-trigger" aria-label={t('testCatalog.resultFields.menuLabel')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Any install can export, a lab that receives central's dictionary included. */}
                <DropdownMenuItem
                  data-testid="result-fields-export"
                  onSelect={() => { downloadResultFieldsCsv().catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); }); }}
                >
                  {t('testCatalog.resultFields.exportAction')}
                </DropdownMenuItem>
                {ownedHere && (
                  <DropdownMenuItem data-testid="result-fields-import" onSelect={() => setImporting(true)}>
                    {t('testCatalog.resultFields.importAction')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {!ownedHere && (
        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground" data-testid="result-fields-central">
          {t('testCatalog.resultFields.fromCentral')}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && error && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">
            {data && !data.loaded ? t('testCatalog.resultFields.notLoaded') : t('testCatalog.resultFields.noMatch')}
          </StripedEmpty>
        )}
        {/* Rendered only when populated: an empty table's header forces intrinsic width and scrolls a
            phone sideways (AGENTS.md section 6). */}
        {!loading && !error && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('testCatalog.resultFields.col.code')}</TableHead>
                <TableHead>{t('testCatalog.resultFields.col.name')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('testCatalog.resultFields.col.role')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('testCatalog.resultFields.col.units')}</TableHead>
                <TableHead>{t('testCatalog.resultFields.col.loinc')}</TableHead>
                {canEdit && <TableHead className="w-12"><span className="sr-only">{t('testCatalog.resultFields.rowActions')}</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((f) => (
                <TableRow key={f.code} data-testid={`result-field-row-${f.code}`}>
                  <TableCell className="font-mono text-xs">{f.code}</TableCell>
                  <TableCell>{f.display ?? ''}</TableCell>
                  <TableCell className="hidden md:table-cell">{f.role ? t(`testCatalog.resultFields.role.${f.role}`) : ''}</TableCell>
                  <TableCell className="hidden md:table-cell">{f.units ?? ''}</TableCell>
                  <TableCell>
                    {f.loinc ? <span className="font-mono text-xs">{f.loinc}</span> : <Badge variant="outline">{t('testCatalog.resultFields.loinc.none')}</Badge>}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                              data-testid={`result-field-actions-${f.code}`}
                              aria-label={t('testCatalog.resultFields.actionsFor', { code: f.code })}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem data-testid={`result-field-link-${f.code}`} onSelect={() => setEditing(f)}>
                              {t('testCatalog.resultFields.linkAction')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <TablePagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
        leftSlot={<span className="text-muted-foreground">{t('testCatalog.resultFields.count', { count: data?.total ?? 0 })}</span>}
      />

      <ResultFieldSheet field={editing} ownedHere={ownedHere} loinc={loinc} onClose={() => setEditing(null)} onSaved={() => { void load(); }} />
      <ImportMappingsSheet
        open={importing}
        onClose={() => setImporting(false)}
        onImported={() => { void load(); }}
        preview={previewResultFieldsImport}
        apply={applyResultFieldsImport}
        description={t('testCatalog.resultFields.importDescription')}
      />
    </div>
  );
}

export default ResultFieldsTab;
```

A loaded dictionary with no filter always has rows, so an empty list with a loaded dictionary means the filters matched nothing.

- [ ] **Step 6: Add the tab to the page**

In `apps/studio/src/pages/TestCatalog.tsx`:

1. Add `import { ResultFieldsTab } from '@/test-catalog/ResultFieldsTab';` after the `ObservedCodesTab` import.
2. Between the two `TabsTrigger`s, add:
   ```tsx
               <TabsTrigger value="result-fields" data-testid="test-catalog-tab-result-fields">{t('testCatalog.tabs.resultFields')}</TabsTrigger>
   ```
3. Between the two `TabsContent`s, add:
   ```tsx
           <TabsContent value="result-fields" className="flex min-h-0 flex-1 flex-col">
             <ResultFieldsTab canManage={canManage} loinc={options.loinc} />
           </TabsContent>
   ```

`TabsContent` already carries `data-[state=inactive]:hidden` from `components/ui/tabs.tsx:53`.

- [ ] **Step 7: Run the studio tests**

Run: `cd apps/studio && npx vitest run src/test-catalog src/pages src/i18n`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `cd apps/studio && npx tsc --noEmit > /tmp/tc-studio.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/test-catalog/ResultFieldsTab.tsx apps/studio/src/test-catalog/ResultFieldsTab.test.tsx apps/studio/src/test-catalog/ResultFieldSheet.tsx apps/studio/src/test-catalog/ResultFieldSheet.test.tsx apps/studio/src/pages/TestCatalog.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Result fields tab with LOINC links"
```

---

### Task 11: Docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/test-catalog.md`, `fr/test-catalog.md`, `pt/test-catalog.md`
- Modify: `apps/web/src/docs/0.1.8/test-catalog.md` (its English, Français and Português sections)
- Modify: `apps/web/src/docs/0.1.8/cli.md` (the `## Test catalog` section in its three languages, and line 549)

**Interfaces:** none.

- [ ] **Step 1: Write the English in-app section**

Append to the end of `apps/studio/src/docs/0.1.8/en/test-catalog.md`, after the Reports subsection:

````markdown
## Mapping lab result codes

A test yields several results, and each lab system names those its own way too. DISA's viral load results come as `HIVVL`, `HIVVC`, `POCVR` and more. Map each result code to the result field it means, and a report can pick the result by what it is.

Result fields come from the site's result dictionary. Import one with `openldr terminology import parameters <file>`. The **Result fields** tab lists every field with its role, units and LOINC code. To link a field to LOINC, open its row's ⋯ menu, choose **Link LOINC**, pick or type the code, then choose **Save** from the sheet's ⋯ menu. **Export CSV** and **Import CSV** in the tab's ⋯ menu link many fields at once, with `code` and `loinc` columns. A blank `loinc` leaves a link as it is. A lab that receives its dictionary from central cannot change the links.

On the **Observed** tab, choose **Results** to list the result codes in the warehouse, with their result count. Map a code from its row's ⋯ menu with **Map to result field**. On a DISA site most result codes are the same as the dictionary's codes. **Map matching codes** in the tab's ⋯ menu maps them all at once. Pick the lab system, check the list, then choose **Map these codes**. It maps only unmapped codes. A code central has mapped, or one that is **Ambiguous**, is left alone.

The result CSV has the columns `system, code, description, results, parameter_code, loinc`. Fill in `parameter_code`, or `loinc` when you know only that.

Results entered in CE need no mapping. They already carry the dictionary's codes, and the warehouse copy maps each field to itself. The same goes for orders taken in CE: each catalog test maps to itself.

A report that counts viral load copies across labs joins `test_map` like this:

```sql
select count(*)
from lab_results l
join test_map tm on tm.level = 'result'
  and tm.source_system = l.observation_system
  and tm.source_code = l.observation_code
where tm.loinc = '20447-9'
```

A content pack can ship result mappings with a `result-mappings` step. Each entry names a lab code and a LOINC code, and the install maps the code to the one result field linked to that LOINC code. A code already mapped here is kept.
````

- [ ] **Step 2: Write the French and Portuguese in-app sections**

Append to the end of `apps/studio/src/docs/0.1.8/fr/test-catalog.md`:

````markdown
## Associer les codes de résultat du laboratoire

Un examen donne plusieurs résultats, et chaque système de laboratoire les nomme aussi à sa façon. Les résultats de charge virale de DISA arrivent sous `HIVVL`, `HIVVC`, `POCVR` et d'autres. Associez chaque code de résultat au champ de résultat qu'il désigne, et un rapport peut choisir le résultat d'après ce qu'il est.

Les champs de résultat viennent du dictionnaire de résultats du site. Importez-en un avec `openldr terminology import parameters <fichier>`. L'onglet **Champs de résultat** liste chaque champ avec son rôle, ses unités et son code LOINC. Pour lier un champ à LOINC, ouvrez le menu ⋯ de sa ligne, choisissez **Lier un LOINC**, choisissez ou saisissez le code, puis **Enregistrer** dans le menu ⋯ du panneau. **Exporter en CSV** et **Importer un CSV**, dans le menu ⋯ de l'onglet, lient plusieurs champs à la fois, avec les colonnes `code` et `loinc`. Un `loinc` vide laisse le lien inchangé. Un laboratoire qui reçoit son dictionnaire du central ne peut pas modifier les liens.

Dans l'onglet **Observés**, choisissez **Résultats** pour lister les codes de résultat de l'entrepôt, avec leur nombre de résultats. Associez un code depuis le menu ⋯ de sa ligne avec **Associer à un champ de résultat**. Sur un site DISA, la plupart des codes de résultat sont identiques aux codes du dictionnaire. **Associer les codes identiques**, dans le menu ⋯ de l'onglet, les associe tous d'un coup. Choisissez le système de laboratoire, vérifiez la liste, puis choisissez **Associer ces codes**. Seuls les codes sans correspondance sont associés. Un code que le central a associé, ou un code **Ambigu**, reste tel quel.

Le CSV des résultats a les colonnes `system, code, description, results, parameter_code, loinc`. Remplissez `parameter_code`, ou `loinc` quand vous ne connaissez que lui.

Les résultats saisis dans CE n'ont pas besoin de correspondance. Ils portent déjà les codes du dictionnaire, et la copie de l'entrepôt associe chaque champ à lui-même. Il en va de même pour les demandes saisies dans CE : chaque test du catalogue est associé à lui-même.

Un rapport qui compte les copies de charge virale entre laboratoires joint `test_map` ainsi :

```sql
select count(*)
from lab_results l
join test_map tm on tm.level = 'result'
  and tm.source_system = l.observation_system
  and tm.source_code = l.observation_code
where tm.loinc = '20447-9'
```

Un pack de contenu peut fournir des correspondances de résultats avec une étape `result-mappings`. Chaque entrée nomme un code de laboratoire et un code LOINC, et l'installation associe le code au seul champ de résultat lié à ce code LOINC. Un code déjà associé ici est conservé.
````

Append to the end of `apps/studio/src/docs/0.1.8/pt/test-catalog.md`:

````markdown
## Associar códigos de resultado do laboratório

Um exame dá vários resultados, e cada sistema de laboratório também os nomeia à sua maneira. Os resultados de carga viral do DISA chegam como `HIVVL`, `HIVVC`, `POCVR` e outros. Associe cada código de resultado ao campo de resultado que significa, e um relatório pode escolher o resultado pelo que ele é.

Os campos de resultado vêm do dicionário de resultados do site. Importe um com `openldr terminology import parameters <ficheiro>`. O separador **Campos de resultado** lista cada campo com a sua função, unidades e código LOINC. Para ligar um campo ao LOINC, abra o menu ⋯ da sua linha, escolha **Ligar LOINC**, escolha ou escreva o código e depois **Guardar** no menu ⋯ do painel. **Exportar CSV** e **Importar CSV**, no menu ⋯ do separador, ligam vários campos de uma vez, com as colunas `code` e `loinc`. Um `loinc` vazio deixa a ligação como está. Um laboratório que recebe o dicionário do central não pode alterar as ligações.

No separador **Observados**, escolha **Resultados** para listar os códigos de resultado do armazém, com o número de resultados. Associe um código no menu ⋯ da sua linha com **Associar a um campo de resultado**. Num site DISA, a maioria dos códigos de resultado é igual aos códigos do dicionário. **Associar códigos iguais**, no menu ⋯ do separador, associa-os todos de uma vez. Escolha o sistema do laboratório, verifique a lista e depois escolha **Associar estes códigos**. Só são associados códigos sem correspondência. Um código que o central associou, ou um código **Ambíguo**, fica como está.

O CSV dos resultados tem as colunas `system, code, description, results, parameter_code, loinc`. Preencha `parameter_code`, ou `loinc` quando só conhece esse.

Os resultados registados no CE não precisam de correspondência. Já trazem os códigos do dicionário, e a cópia do armazém associa cada campo a si próprio. O mesmo vale para os pedidos feitos no CE: cada teste do catálogo é associado a si próprio.

Um relatório que conta cópias de carga viral entre laboratórios junta `test_map` assim:

```sql
select count(*)
from lab_results l
join test_map tm on tm.level = 'result'
  and tm.source_system = l.observation_system
  and tm.source_code = l.observation_code
where tm.loinc = '20447-9'
```

Um pacote de conteúdo pode trazer correspondências de resultados com um passo `result-mappings`. Cada entrada indica um código do laboratório e um código LOINC, e a instalação associa o código ao único campo de resultado ligado a esse código LOINC. Um código já associado aqui é mantido.
````

- [ ] **Step 3: Write the web docs paragraphs**

In `apps/web/src/docs/0.1.8/test-catalog.md`, each language section ends with the paragraph about mapping lab test codes (English line 20 starts "Lab systems name tests their own way"). Add one paragraph after it in each section.

English:

```markdown
Result codes map the same way, to fields of the site's result dictionary. Import a dictionary with `openldr terminology import parameters <file>`. The **Result fields** tab lists each field with its role, units and LOINC code, and links a field to LOINC from its row's ⋯ menu, or many at once by CSV (`code`, `loinc`). On the **Observed** tab, choose **Results** to list the result codes in the warehouse, and map one with **Map to result field**. **Map matching codes** maps every unmapped code of one lab system to the field with the same code, which covers most codes on a DISA site. Results and orders entered in CE need no mapping: the warehouse copy maps each field and each catalog test to itself. A report joins result codes on `tm.level = 'result'`, `tm.source_system = l.observation_system` and `tm.source_code = l.observation_code`, and can filter on `tm.loinc`. A content pack ships result mappings with a `result-mappings` step.
```

Français:

```markdown
Les codes de résultat s'associent de la même façon, aux champs du dictionnaire de résultats du site. Importez un dictionnaire avec `openldr terminology import parameters <fichier>`. L'onglet **Champs de résultat** liste chaque champ avec son rôle, ses unités et son code LOINC, et lie un champ à LOINC depuis le menu ⋯ de sa ligne, ou plusieurs à la fois par CSV (`code`, `loinc`). Dans l'onglet **Observés**, choisissez **Résultats** pour lister les codes de résultat de l'entrepôt, et associez-en un avec **Associer à un champ de résultat**. **Associer les codes identiques** associe chaque code sans correspondance d'un système de laboratoire au champ qui porte le même code, ce qui couvre la plupart des codes sur un site DISA. Les résultats et les demandes saisis dans CE n'ont pas besoin de correspondance : la copie de l'entrepôt associe chaque champ et chaque test du catalogue à lui-même. Un rapport joint les codes de résultat sur `tm.level = 'result'`, `tm.source_system = l.observation_system` et `tm.source_code = l.observation_code`, et peut filtrer sur `tm.loinc`. Un pack de contenu fournit des correspondances de résultats avec une étape `result-mappings`.
```

Português:

```markdown
Os códigos de resultado associam-se da mesma forma, aos campos do dicionário de resultados do site. Importe um dicionário com `openldr terminology import parameters <ficheiro>`. O separador **Campos de resultado** lista cada campo com a sua função, unidades e código LOINC, e liga um campo ao LOINC no menu ⋯ da sua linha, ou vários de uma vez por CSV (`code`, `loinc`). No separador **Observados**, escolha **Resultados** para listar os códigos de resultado do armazém, e associe um com **Associar a um campo de resultado**. **Associar códigos iguais** associa cada código sem correspondência de um sistema do laboratório ao campo com o mesmo código, o que cobre a maioria dos códigos num site DISA. Os resultados e os pedidos registados no CE não precisam de correspondência: a cópia do armazém associa cada campo e cada teste do catálogo a si próprio. Um relatório junta os códigos de resultado em `tm.level = 'result'`, `tm.source_system = l.observation_system` e `tm.source_code = l.observation_code`, e pode filtrar por `tm.loinc`. Um pacote de conteúdo traz correspondências de resultados com um passo `result-mappings`.
```

- [ ] **Step 4: Write the CLI docs**

In `apps/web/src/docs/0.1.8/cli.md`, the `## Test catalog` section has an English, a French and a Portuguese block. Each ends with the `map` bullet list (English ends with "- `map rebuild` shows what the warehouse copy `test_map` would hold. `--apply` writes it."). Add after the bullets of each block.

English:

````markdown
Result codes use the same commands with `--level result`. The target is a result field code:

```sh
openldr test-catalog map list --level result --status unmapped
openldr test-catalog map set urn:openldr:disa HIVVC HIVVL --level result
openldr test-catalog map match urn:openldr:disa
openldr test-catalog map match urn:openldr:disa --apply --force
```

- `--level result` on `map list`, `set`, `clear`, `export` and `import` works on result codes. The result CSV has the columns `system, code, description, results, parameter_code, loinc`.
- `map match <system>` lists every unmapped result code of that lab system that equals a result field code. `--apply --force` maps them. It refuses `--apply` without `--force`.

Link result fields to LOINC:

```sh
openldr test-catalog result-fields list --loinc none
openldr test-catalog result-fields link HIVVL 20447-9
openldr test-catalog result-fields unlink HIVVL --force
openldr test-catalog result-fields export --out result-fields.csv
openldr test-catalog result-fields import result-fields.csv --apply --force
```

- `result-fields list` lists the fields with their role, units and LOINC link. `--loinc` takes `linked`, `none` or `all`, and `--role` takes `result`, `specimen`, `metadata` or `admin`.
- `result-fields unlink` refuses without `--force`. `result-fields import` previews unless `--apply --force` is given. A lab that receives its dictionary from central cannot change links.
- `openldr terminology import parameters <file>` rebuilds `test_map` after it loads the dictionary.
````

Français:

````markdown
Les codes de résultat utilisent les mêmes commandes avec `--level result`. La cible est un code de champ de résultat :

```sh
openldr test-catalog map list --level result --status unmapped
openldr test-catalog map set urn:openldr:disa HIVVC HIVVL --level result
openldr test-catalog map match urn:openldr:disa
openldr test-catalog map match urn:openldr:disa --apply --force
```

- `--level result` sur `map list`, `set`, `clear`, `export` et `import` agit sur les codes de résultat. Le CSV des résultats a les colonnes `system, code, description, results, parameter_code, loinc`.
- `map match <system>` liste chaque code de résultat sans correspondance de ce système de laboratoire qui est égal à un code de champ de résultat. `--apply --force` les associe. Elle refuse `--apply` sans `--force`.

Lier les champs de résultat à LOINC :

```sh
openldr test-catalog result-fields list --loinc none
openldr test-catalog result-fields link HIVVL 20447-9
openldr test-catalog result-fields unlink HIVVL --force
openldr test-catalog result-fields export --out result-fields.csv
openldr test-catalog result-fields import result-fields.csv --apply --force
```

- `result-fields list` liste les champs avec leur rôle, leurs unités et leur lien LOINC. `--loinc` accepte `linked`, `none` ou `all`, et `--role` accepte `result`, `specimen`, `metadata` ou `admin`.
- `result-fields unlink` refuse sans `--force`. `result-fields import` montre un aperçu sauf avec `--apply --force`. Un laboratoire qui reçoit son dictionnaire du central ne peut pas modifier les liens.
- `openldr terminology import parameters <fichier>` reconstruit `test_map` après avoir chargé le dictionnaire.
````

Português:

````markdown
Os códigos de resultado usam os mesmos comandos com `--level result`. O destino é um código de campo de resultado:

```sh
openldr test-catalog map list --level result --status unmapped
openldr test-catalog map set urn:openldr:disa HIVVC HIVVL --level result
openldr test-catalog map match urn:openldr:disa
openldr test-catalog map match urn:openldr:disa --apply --force
```

- `--level result` em `map list`, `set`, `clear`, `export` e `import` trabalha com códigos de resultado. O CSV dos resultados tem as colunas `system, code, description, results, parameter_code, loinc`.
- `map match <system>` lista cada código de resultado sem correspondência desse sistema do laboratório que é igual a um código de campo de resultado. `--apply --force` associa-os. Recusa `--apply` sem `--force`.

Ligar campos de resultado ao LOINC:

```sh
openldr test-catalog result-fields list --loinc none
openldr test-catalog result-fields link HIVVL 20447-9
openldr test-catalog result-fields unlink HIVVL --force
openldr test-catalog result-fields export --out result-fields.csv
openldr test-catalog result-fields import result-fields.csv --apply --force
```

- `result-fields list` lista os campos com a sua função, unidades e ligação LOINC. `--loinc` aceita `linked`, `none` ou `all`, e `--role` aceita `result`, `specimen`, `metadata` ou `admin`.
- `result-fields unlink` recusa sem `--force`. `result-fields import` mostra uma pré-visualização, exceto com `--apply --force`. Um laboratório que recebe o dicionário do central não pode alterar as ligações.
- `openldr terminology import parameters <ficheiro>` reconstrói `test_map` depois de carregar o dicionário.
````

At line 549 (the content pack paragraph), change "For each test-mappings step it lists the test mappings it would map, keep and skip." to "For each test-mappings or result-mappings step it lists the mappings it would map, keep and skip." If the French or Portuguese version of that paragraph names the test-mappings step, add result-mappings there the same way.

- [ ] **Step 5: Run the docs tests**

Run: `cd apps/studio && npx vitest run src/docs`
Run: `cd apps/web && npx vitest run src/docs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/test-catalog.md apps/studio/src/docs/0.1.8/fr/test-catalog.md apps/studio/src/docs/0.1.8/pt/test-catalog.md apps/web/src/docs/0.1.8/test-catalog.md apps/web/src/docs/0.1.8/cli.md
git commit -m "docs: mapping lab result codes to result fields"
```

---

### Task 12: Spec note, gate, live check, changelog

**Files:**
- Modify: `docs/superpowers/specs/2026-10-11-result-field-mapping-design.md`

- [ ] **Step 1: Record the planning changes in the spec**

Append to the spec:

```markdown
## 9. Changes during planning

Each comes from code the design did not account for.

1. The CLI group is `openldr test-catalog result-fields`, not `params`. `openldr test-catalog params <code>` already edits one test's result parameters (`packages/cli/src/program.ts:391-398`).
2. The Observed list leaves out the catalog's own system in Tests mode too. CE's own orders are mapped by self rows, and listing them as Unmapped would invite a mapping the routes refuse.
3. The dictionary import exists only in the CLI, through a context with no warehouse. The CLI opens the app context after the import and rebuilds once. The Result fields empty state names that command.
4. The mapping routes keep the body field `catalogCode` for the target code at both levels, and take an optional `level`.
5. Audit actions stay `test_mapping.*` with `metadata.level`. Map matching codes audits `test_mapping.match`. Result fields audit `result_field.link`, `.unlink` and `.import`.
6. A result-fields CSV preview is refused too on a lab whose dictionary came from central.
7. Last seen on the Results list is the newest `lab_results.created_at`, the time the row reached the warehouse. cdr sends no result time.
8. The rebuild result keeps slice 1's top-level fields for the test level, and adds `results` and `selfRows`. `written` counts every row.
```

Also change section 4.6's CLI block: replace each `openldr test-catalog params ...` line with the matching `openldr test-catalog result-fields ...` line, and section 4.5's "points to the Terminology page's import" with "names `openldr terminology import parameters`".

- [ ] **Step 2: Run the full gate**

Run, in this order, each to its own file:

```bash
pnpm turbo run test --force --concurrency=2 --continue > /tmp/gate-test.txt 2>&1; echo "test exit=$?"
pnpm turbo run typecheck --force --concurrency=2 > /tmp/gate-tc.txt 2>&1; echo "typecheck exit=$?"
pnpm --filter @openldr/server lint > /tmp/gate-lint.txt 2>&1; echo "lint exit=$?"
```

Expected: all three `exit=0`, and `Cached: 0 cached` in both turbo outputs. If a package fails, grep its output for `out of memory`, `VirtualAlloc` and `Test timed out`, and re-run that package alone before treating it as a regression (CLAUDE.md, test gate).

- [ ] **Step 3: Live check on the dev CE**

This needs the work merged to `main`, because `preview_start` serves the main checkout. Ask the operator before merging. Then, on the dev CE:

1. Write a scratch dictionary `zz-dict.json`:
   `[{"code":"ZZVLC","description":"ZZ VL copies","units":"copies/mL","result_role":"result"},{"code":"ZZCD4","description":"ZZ CD4","result_role":"result"},{"code":"ZZMODE","description":"ZZ recency mode","result_role":"metadata"}]`
   Run `node_modules/.bin/tsx packages/cli/src/index.ts terminology import parameters zz-dict.json`. Expect no stale warning. This proves the import triggers a rebuild.
2. Put results in the warehouse: two `lab_results` rows coded `urn:openldr:zzlc` / `ZZVLC`, one `urn:openldr:zzlc` / `ZZCD4`, one `urn:openldr:zzlc` / `ZZPOC`, and one `urn:openldr:default_result` / `ZZVLC` standing in for a bench result. Ingest them as a FHIR bundle if the dev CE's ingest path accepts one. Otherwise insert them into the warehouse with SQL, as slice 1's live check did, and report that the ingest path and bench entry were not exercised.
3. On **Observed**, choose **Results**. Expect `ZZVLC` (2), `ZZCD4` (1) and `ZZPOC` (1), all Unmapped, and no `urn:openldr:default_result` row.
4. Choose **Map matching codes**, pick `urn:openldr:zzlc`. Expect `ZZVLC` and `ZZCD4` in the list, not `ZZPOC`. Apply. Expect both rows Mapped.
5. On **Result fields**, link `ZZVLC` to `20447-9` through the sheet. Export the CSV, set `ZZCD4`'s `loinc` to `24467-3`, import it. Expect the preview to say 1 new, then apply it.
6. Build and sign a scratch content pack with one `result-mappings` step: `{ "system": "urn:openldr:zzlc", "code": "ZZPOC", "loinc": "20447-9" }`. Copy the `dist/` layout of an existing pack as the template, and sign with `node_modules/.bin/tsx packages/cli/src/index.ts artifact pack <dir> --key C:\Users\Fredrick\.openldr\keys\content-publisher\publisher.priv` (memory note `content-packs-marketplace`). Run `market install <dir> --dry-run`. Expect `result mappings: 1 to map, 0 kept, 0 skipped`. Install it.
7. Run the spec's report join from section 4.3 as a custom query on the Query page, with `where tm.loinc = '20447-9'`. Expect 4: the two lab `ZZVLC` rows, `ZZPOC`, and the bench `ZZVLC` row.
8. Run `openldr test-catalog result-fields list --loinc linked` and `openldr test-catalog map list --level result`.
9. Check the Result fields tab, the Results mode of Observed, the match sheet and the LOINC sheet at 375 px with `resize_window`. No sideways page scroll, every action reachable.
10. Clean up: clear the three result mappings, unlink both fields, delete the scratch `ZZ` concepts and the scratch warehouse rows with SQL, and rebuild `test_map`. Audit rows stay, by design.

Report what was checked live and what was not. A central dictionary reaching a lab needs two nodes, and stays an **honest non-proof** unless the operator runs the two-node demo. A real phone is outside what `resize_window` proves. MSSQL and MySQL are not run. The Observed results query is timed only on synthetic Postgres data (spec section 5).

- [ ] **Step 4: Changelog**

After merging to `main`: run `pnpm make:changelog`, check the new entries, and commit `apps/web/src/landing/changelog.json`.

---

## Self-review

Spec coverage, section by section:

| Spec | Task |
|---|---|
| 4.1 Result mappings | 3 (writes), 1 (rebuild reads them) |
| 4.2 Parameter LOINC links | 5 |
| 4.3 `test_map` rows and self rows | 1 |
| 4.4 Rebuild and triggers | 1 (triggers, rebuild), 5 (link changes), 8 (dictionary import) |
| 4.5 Result fields tab | 10 |
| 4.5 Observed Results mode | 2 (server), 9 (studio) |
| 4.5 Map matching codes | 4 (service), 7 (route), 8 (CLI), 9 (sheet) |
| 4.6 CSV and CLI | 3, 5, 8 |
| 4.7 Pack step | 4 (planning), 6 (kind and installer) |
| 4.8 Errors | 3 (self system, unknown field), 5 (central, LOINC shape), 4 and 5 (no dictionary) |
| 5 Measured cost | Done before the plan. No task. |
| 6 Tests | Each task's tests; Task 12 live check |
| 7 Done | UI 9 and 10, CLI 8, docs 11, mobile Task 12 step 3.9, changelog Task 12 step 4 |

Types used across tasks: `MapLevel`, `MAP_TARGET_SYSTEM`, `parseMapLevel` (Task 1); `MatchPlan`, `observedSystems`, `planMatch`, `applyMatch` (Task 4); `ResultField`, `ResultFieldList`, `ResultFieldLinkChange`, `ResultFieldImportReport`, `parseResultFieldQuery`, `createResultFields` (Task 5); `ImportReportLike`, `downloadCsv`, `uploadCsv` (Task 9). Each later task uses the names its producer defined.

Not covered by any test, and said so in Task 12: the ingest path for result codes, bench entry writing a dictionary-coded result, two-node sync of a central dictionary or link, MSSQL and MySQL, and a real phone.
