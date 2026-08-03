# Result Classification (S2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CE know which observation codes are reportable results and which are collection metadata, so a clinical report stops printing the courier's phone number as a lab result.

**Architecture:** DISA's parameter dictionary imports as a CodeSystem whose concepts carry `result_role` (CE's own semantics, authored) alongside `parm_context`/`parm_units`/`reference_citation` (source data, recorded). Intensional ValueSets over `result_role` project to `terminology_codes` through the fan-out machinery merged at `958fe625`. The clinical template excludes only the explicit negatives, so an unclassified code still prints.

**Tech Stack:** TypeScript, Kysely, zod, vitest 2.1.8, pg-mem.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-03-result-classification-s2b-design.md`.
- **Fail-open is structural, not a runtime check.** An unclassified code must be in NO exclusion set, so it prints by construction. Never write "if unknown then show" logic — the positive definition is the mechanism.
- **`result_role` is exactly four values**: `result | specimen | metadata | admin`. An unrecognised role must **throw**, not be skipped — a silently dropped code would land in neither set and vanish from reports. (This is the organism loader's rule verbatim; see `importOrganismDictionary`.)
- **Import, never seed, the dictionary.** PARMDICT is site-specific — one Tanzanian deployment's 1,547 codes. Shipping it as a product default would make every other deployment silently wrong. **The three ValueSets ARE seeded**, because those are CE's own semantics.
- ⚠ **`parm_context` is recorded as data, NOT as a classifier.** Measured: context `-1` holds 638 of 1,547 codes and contains both `COLBY`/`TPD`/`CONNO` (metadata) and `CD4`/`SAST`/`SCRT` (results). Do not build logic on it.
- **Commit trailer rule:** never add a `Co-Authored-By: Claude`/`Codex` trailer.
- Test command: `cd packages/<pkg> && npx vitest run` — the WHOLE package, not a subdirectory. A task in the previous slice left the suite red by scoping its run too narrowly.

## Measured facts this plan is built on

| Fact | Source |
|---|---|
| `LoaderStore` = `upsertConcepts`/`upsertMapElements`/`saveResource`/`saveSystem`/`markSystemChanged` | `packages/terminology/src/loaders/generic.ts:7-17` |
| `markSystemChanged` is called ONCE per system at loader completion, never per batch | same, docblock |
| `ConceptRecord` = `{ system, code, display, status, properties }` | `loaders/organisms.ts:62-68` |
| Loaders are wired in **FOUR** places: type + impl in each of two files | `bootstrap/src/index.ts:346,754`; `bootstrap/src/terminology-context.ts:40,129` |
| CLI import dispatches on `kind` with an `else` that rejects unknown kinds | `packages/cli/src/terminology.ts:31-41`; registered at `cli/src/index.ts:320` |
| Seeded ValueSets in 014 are **extensional** — `compose.include[].concept[]` + a materialized expansion | `db/src/migrations/internal/014_value_sets.ts:77-80` |
| Reference range/units live in PARMDICT's blob, decoded at offsets 126-136 / 214-260 | `cdr-toolchain/packages/disalab/src/lib/DisaGlobal/PARMDICT.ts:40-41` |

⚠ **The intensional-expansion trap.** A migration CANNOT materialize an intensional ValueSet's
expansion: the concepts arrive later, via the import. So the expansion must be **(re)computed by the
import**. Task 4 exists solely for this, and it is the single most likely place to ship a set that
looks configured but expands to nothing.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/terminology/src/loaders/result-parameters.ts` | the loader | Create |
| `packages/terminology/src/loaders/result-parameters.test.ts` | loader tests | Create |
| `packages/terminology/src/loaders/index.ts` | re-export | Modify |
| `packages/bootstrap/src/index.ts` | loader type + impl (2 spots) | Modify |
| `packages/bootstrap/src/terminology-context.ts` | loader type + impl (2 spots) | Modify |
| `packages/cli/src/terminology.ts` | `parameters` import kind | Modify |
| `packages/cli/src/index.ts` | help text for the new kind | Modify |
| `packages/db/src/migrations/internal/069_result_role_valuesets.ts` | the three ValueSets | Create |
| `packages/db/src/migrations/internal/index.ts` | register 069 | Modify |

---

### Task 1: The result-parameter loader

**Files:**
- Create: `packages/terminology/src/loaders/result-parameters.ts`
- Test: `packages/terminology/src/loaders/result-parameters.test.ts`
- Modify: `packages/terminology/src/loaders/index.ts`

**Interfaces:**
- Consumes: `LoaderStore`, `LoadResult` from `./generic`; `ConceptRecord` from `@openldr/db`; `OpenLdrError` from `@openldr/core`.
- Produces: `RESULT_PARAM_SYSTEM = 'urn:openldr:default_result'`, `RESULT_ROLES`, `type ResultRole`, `interface ResultParamRow`, `interface ResultParamImportResult extends LoadResult { byRole: Record<string, number>; skipped: number }`, and `importResultParameters(json, store)`. Tasks 2 and 4 rely on these exact names.

⚠ **Read `packages/terminology/src/loaders/organisms.ts` in full first.** This loader is the same
shape and must match its conventions — the empty-code skip, the throw-on-unrecognised-category rule
and its rationale, the single `markSystemChanged` at completion, and the `byType`-style tally.

- [ ] **Step 1: Write the failing test**

Create `packages/terminology/src/loaders/result-parameters.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { importResultParameters, RESULT_PARAM_SYSTEM } from './result-parameters';

const store = () => ({
  upsertConcepts: vi.fn().mockResolvedValue(undefined),
  upsertMapElements: vi.fn().mockResolvedValue(undefined),
  saveResource: vi.fn().mockResolvedValue({ resourceType: 'CodeSystem', id: 'x' }),
  saveSystem: vi.fn().mockResolvedValue(undefined),
  markSystemChanged: vi.fn().mockResolvedValue(undefined),
});

describe('importResultParameters', () => {
  it('projects each row to a concept carrying result_role and the source properties', async () => {
    const s = store();
    const r = await importResultParameters([
      { code: 'CD4', description: 'CD4 Count', context: -1, units: 'cells/uL', reference: '', result_role: 'result' },
      { code: 'COLBY', description: 'Collected By', context: -1, result_role: 'metadata' },
    ], s);
    expect(r.conceptsLoaded).toBe(2);
    expect(r.byRole).toEqual({ result: 1, metadata: 1 });
    expect(s.upsertConcepts).toHaveBeenCalledTimes(1);
    expect(s.upsertConcepts.mock.calls[0][0][0]).toEqual({
      system: RESULT_PARAM_SYSTEM, code: 'CD4', display: 'CD4 Count', status: null,
      properties: { result_role: 'result', parm_context: -1, parm_units: 'cells/uL' },
    });
  });

  it('omits absent source properties rather than storing nulls', async () => {
    const s = store();
    await importResultParameters([{ code: 'X', description: 'X', result_role: 'admin' }], s);
    expect(s.upsertConcepts.mock.calls[0][0][0].properties).toEqual({ result_role: 'admin' });
  });

  it('records the reference citation, which is NOT a range', async () => {
    const s = store();
    await importResultParameters(
      [{ code: 'SAST', description: 'AST', reference: 'Roche Reference Ranges for Adults and Children', result_role: 'result' }], s);
    expect(s.upsertConcepts.mock.calls[0][0][0].properties.reference_citation)
      .toBe('Roche Reference Ranges for Adults and Children');
  });

  it('THROWS on an unrecognised role rather than skipping it', async () => {
    await expect(importResultParameters([{ code: 'X', result_role: 'wat' }], store()))
      .rejects.toThrow(/unrecognised result_role/);
  });

  it('THROWS on a row with no result_role, so nothing is silently unclassified by import', async () => {
    await expect(importResultParameters([{ code: 'X', description: 'X' }], store()))
      .rejects.toThrow(/unrecognised result_role/);
  });

  it('skips a header-ish row with an empty code and reports the count', async () => {
    const s = store();
    const r = await importResultParameters([
      { code: '', description: 'Parameters' },
      { code: 'CD4', description: 'CD4 Count', result_role: 'result' },
    ], s);
    expect(r.skipped).toBe(1);
    expect(r.conceptsLoaded).toBe(1);
  });

  it('signals the system ONCE, after the concepts land', async () => {
    const s = store();
    await importResultParameters([{ code: 'A', result_role: 'result' }, { code: 'B', result_role: 'result' }], s);
    expect(s.markSystemChanged).toHaveBeenCalledTimes(1);
    expect(s.markSystemChanged).toHaveBeenCalledWith(RESULT_PARAM_SYSTEM);
  });

  it('rejects a non-array payload', async () => {
    await expect(importResultParameters({ nope: true }, store())).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/terminology && npx vitest run src/loaders/result-parameters.test.ts`
Expected: FAIL — `./result-parameters` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/terminology/src/loaders/result-parameters.ts`:

```ts
import { OpenLdrError } from '@openldr/core';
import type { ConceptRecord } from '@openldr/db';
import type { LoaderStore, LoadResult } from './generic';

/** The canonical system for a DISA-style site RESULT/parameter dictionary (PARMDICT). */
export const RESULT_PARAM_SYSTEM = 'urn:openldr:default_result';

/** What a code IS, in CE's terms. Four roles rather than a boolean because the clinical template
 *  needs them separately: `result` fills the results table, `specimen` fills the Sample Information
 *  panel, `metadata`/`admin` appear nowhere. */
export const RESULT_ROLES = ['result', 'specimen', 'metadata', 'admin'] as const;
export type ResultRole = (typeof RESULT_ROLES)[number];

/** One row of a PARMDICT export. `context`/`units`/`reference` are DISA's; `result_role` is CE's. */
export interface ResultParamRow {
  code: string;
  description?: string | null;
  /** PARMDICT.CONTEXT. ⚠ Recorded as data ONLY — measured NOT to separate result from metadata
   *  (context -1 holds 638/1547 codes and contains both classes). Never classify on it. */
  context?: number | null;
  units?: string | null;
  /** PARMDICT.REFERENCE. ⚠ A CITATION ("Roche Reference Ranges for Adults and Children"), never a
   *  numeric range — verified against the live dictionary. Do not parse it as bounds. */
  reference?: string | null;
  result_role?: string | null;
}

export interface ResultParamImportResult extends LoadResult {
  byRole: Record<string, number>;
  skipped: number;
}

/**
 * Import a site's result-parameter dictionary as a CodeSystem whose concepts carry `result_role`.
 *
 * Deliberately NOT seeded into CE: PARMDICT is SITE-SPECIFIC (one Tanzanian deployment's 1,547
 * codes). Shipping one site's vocabulary as a product default would make every other deployment
 * silently wrong — the same reasoning as the organism dictionary.
 */
export async function importResultParameters(json: unknown, store: LoaderStore): Promise<ResultParamImportResult> {
  if (!Array.isArray(json)) {
    throw new OpenLdrError('result parameter dictionary must be a JSON array of { code, description, result_role }');
  }
  const rows = json as ResultParamRow[];
  const byRole: Record<string, number> = {};
  const concepts: ConceptRecord[] = [];
  let skipped = 0;

  for (const r of rows) {
    // A header-ish row with no code is not addressable and would collide on (system, code).
    if (!r.code) { skipped += 1; continue; }
    const role = r.result_role ?? null;
    if (!role || !(RESULT_ROLES as readonly string[]).includes(role)) {
      // Fail LOUD, exactly as the organism loader does. A silent skip would leave the code in
      // neither ValueSet — which fail-open would then render, but with no record that nobody had
      // ever classified it. An import is the one moment we can demand an answer.
      throw new OpenLdrError(
        `result code '${r.code}' has unrecognised result_role ${JSON.stringify(role)} — expected one of ${RESULT_ROLES.join(', ')}`,
      );
    }
    byRole[role] = (byRole[role] ?? 0) + 1;
    const properties: Record<string, unknown> = { result_role: role };
    if (r.context !== undefined && r.context !== null) properties.parm_context = r.context;
    if (r.units) properties.parm_units = r.units;
    if (r.reference) properties.reference_citation = r.reference;
    concepts.push({
      system: RESULT_PARAM_SYSTEM,
      code: r.code,
      display: r.description ?? null,
      status: null,
      properties,
    });
  }

  if (concepts.length === 0) throw new OpenLdrError('result parameter dictionary contained no usable codes');

  await store.upsertConcepts(concepts);
  // One signal for the whole system, after every concept has landed (LoaderStore's contract).
  await store.markSystemChanged(RESULT_PARAM_SYSTEM);

  return {
    system: RESULT_PARAM_SYSTEM,
    conceptsLoaded: concepts.length,
    resourceUrl: RESULT_PARAM_SYSTEM,
    byRole,
    skipped,
  };
}
```

Add to `packages/terminology/src/loaders/index.ts`:

```ts
export * from './result-parameters';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/terminology && npx vitest run`
Expected: PASS — the eight new cases plus every pre-existing terminology test.

- [ ] **Step 5: Commit**

```bash
git add packages/terminology/src/loaders/result-parameters.ts packages/terminology/src/loaders/result-parameters.test.ts packages/terminology/src/loaders/index.ts
git commit -m "feat(terminology): import a result-parameter dictionary with result roles"
```

---

### Task 2: Wire the loader into bootstrap and the CLI

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (line ~78 import, ~346 type, ~754 impl)
- Modify: `packages/bootstrap/src/terminology-context.ts` (line ~5 import, ~40 type, ~129 impl)
- Modify: `packages/cli/src/terminology.ts:31-41`
- Modify: `packages/cli/src/index.ts:320`
- Test: `packages/cli/src/terminology.test.ts` (check the real filename first)

**Interfaces:**
- Consumes: `importResultParameters`, `ResultParamImportResult` (Task 1).
- Produces: `ctx.loaders.parameters(json)` on both contexts, and CLI `openldr terminology import parameters <path>`.

⚠ **FOUR edit points, and they must stay in lockstep.** `bootstrap/src/index.ts` and
`bootstrap/src/terminology-context.ts` EACH declare the `loaders:` object twice — once as a TYPE and
once as the implementation. A previous slice was bitten by exactly this pair drifting. Read all four
before editing, and change all four.

- [ ] **Step 1: Write the failing test**

Extend the CLI terminology test (read the file first and follow its mocking idiom — it mocks the
context, as `data-exposure.test.ts` does):

```ts
it('routes the parameters kind to the loader and records an audit event', async () => {
  const loaded = { system: 'urn:openldr:default_result', conceptsLoaded: 2, resourceUrl: 'urn:openldr:default_result', byRole: { result: 1, metadata: 1 }, skipped: 0 };
  // …arrange the mocked ctx so ctx.loaders.parameters resolves to `loaded`…
  const code = await runTerminologyImport('parameters', fixturePath, { json: true });
  expect(code).toBe(0);
  expect(ctx.loaders.parameters).toHaveBeenCalledTimes(1);
});

it('still rejects an unknown import kind', async () => {
  expect(await runTerminologyImport('nonsense', fixturePath, { json: false })).toBe(1);
});
```

⚠ The arrange block is a SKETCH — follow the file's real helpers rather than inventing new ones.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run`
Expected: FAIL — `unknown import kind 'parameters'`.

- [ ] **Step 3: Write minimal implementation**

In BOTH bootstrap files, add `importResultParameters` / `type ResultParamImportResult` to the
existing `@openldr/terminology` import, add to the `loaders` TYPE:

```ts
      parameters: (json: unknown) => Promise<ResultParamImportResult>;
```

and to the `loaders` IMPLEMENTATION, beside `organisms`:

```ts
      parameters: (json) => importResultParameters(json, loaderStore),
```

In `packages/cli/src/terminology.ts`, add a branch beside the `organisms` one at line 31, mirroring
its shape exactly (including the audit event — read the `organisms` branch and match it):

```ts
    } else if (kind === 'parameters') {
      const r = await ctx.loaders.parameters(JSON.parse(readFileSync(path, 'utf8')));
      // …match the organisms branch's output + recordAuditEvent shape…
```

Update the `else` message and the `.description(...)` at `cli/src/index.ts:320` to include
`parameters` in the kind list.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run` and `cd packages/bootstrap && npx vitest run`
Expected: PASS both.

- [ ] **Step 5: Typecheck across packages**

Run: `pnpm turbo run typecheck --force`
Expected: clean. This widens an interface declared in two packages; vitest strips types and will not see a break. `@openldr/cli#build` fails on Windows for an unrelated esbuild reason and is NOT part of this gate.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/terminology-context.ts packages/cli/src/terminology.ts packages/cli/src/index.ts packages/cli/src/terminology.test.ts
git commit -m "feat(cli): add terminology import parameters"
```

---

### Task 3: Seed the three ValueSets

**Files:**
- Create: `packages/db/src/migrations/internal/069_result_role_valuesets.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Test: `packages/db/src/migrations/internal/069_result_role_valuesets.test.ts`

**Interfaces:**
- Produces: ValueSets at `urn:openldr:valueset:result-observation`, `:reportable-result`, `:non-reportable`.

⚠ **Read `packages/db/src/migrations/internal/014_value_sets.ts` in full first.** It is the pattern
for seeding a ValueSet (publisher id, `value_sets` row, `compose` JSON, `onConflict` guard). But note
the difference: 014's seeds are **extensional** (`compose.include[].concept[]`); two of these three
are **intensional** (`compose.include[].filter[]`), and their expansion CANNOT be materialized here —
the concepts arrive later via Task 1's import. Task 4 recomputes it.

⚠ **Check the real next migration number** — `069` assumes 068 is the highest. Run
`ls packages/db/src/migrations/internal/` and use the actual next number. `migrations.test.ts`
asserts the full ordered key list, so it must be updated too.

**The compose shapes:**

```ts
// reportable: one filter clause.
{ include: [{ system: RESULT_PARAM_SYSTEM, filter: [{ property: 'result_role', op: '=', value: 'result' }] }] }

// non-reportable: TWO include clauses, which UNION.
// ⚠ NOT one clause with two filters — filters WITHIN a clause intersect, which would yield the
// empty set (no concept is both 'metadata' and 'admin'). Verified: filterConcepts honours only
// filters[0] and op '=' anyway.
// ⚠ `specimen` is deliberately ABSENT: it is displayed, just in a different band of the report.
{ include: [
  { system: RESULT_PARAM_SYSTEM, filter: [{ property: 'result_role', op: '=', value: 'metadata' }] },
  { system: RESULT_PARAM_SYSTEM, filter: [{ property: 'result_role', op: '=', value: 'admin' }] },
] }
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from '../../test-helpers';   // ⚠ verify the real helper name

describe('069 result-role value sets', () => {
  it('seeds the three value sets with the right compose shapes', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('value_sets').select(['url', 'compose'])
      .where('url', 'like', 'urn:openldr:valueset:%re%').execute();
    const byUrl = new Map(rows.map((r) => [r.url, typeof r.compose === 'string' ? JSON.parse(r.compose) : r.compose]));

    expect(byUrl.get('urn:openldr:valueset:reportable-result').include).toHaveLength(1);
    // The union that makes fail-open work: two clauses, not one clause with two filters.
    expect(byUrl.get('urn:openldr:valueset:non-reportable').include).toHaveLength(2);
    expect(byUrl.get('urn:openldr:valueset:non-reportable').include.map((i: any) => i.filter[0].value))
      .toEqual(['metadata', 'admin']);
    await db.destroy();
  });

  it('does not include `specimen` in the non-reportable set', async () => {
    const db = await makeMigratedDb();
    const row = await db.selectFrom('value_sets').select('compose')
      .where('url', '=', 'urn:openldr:valueset:non-reportable').executeTakeFirstOrThrow();
    expect(JSON.stringify(row.compose)).not.toContain('specimen');
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run src/migrations/internal/`
Expected: FAIL — the value sets do not exist.

- [ ] **Step 3: Write minimal implementation**

Write the migration following 014's shape. **Show the whole file in your report** — this plan does
not reproduce 014's publisher/`onConflict` boilerplate because it must be copied from the real file,
not from here. Register it in `migrations/internal/index.ts` and update the ordered key list in
`packages/db/src/migrations/migrations.test.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run`
Expected: PASS, whole package.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/ packages/db/src/migrations/migrations.test.ts
git commit -m "feat(db): seed the result-role value sets"
```

---

### Task 4: Recompute the intensional expansion on import

**Files:**
- Modify: `packages/bootstrap/src/index.ts` and/or `packages/bootstrap/src/terminology-context.ts` — wherever the loader store is built
- Test: alongside whichever file you change

**Interfaces:**
- Consumes: Task 1's loader, Task 3's ValueSets.

**Why this task is the crux.** A migration cannot materialize an intensional ValueSet's expansion —
its concepts arrive later, via the import. So after `importResultParameters` completes, the two
intensional sets must be **re-expanded**, or they stay empty, project nothing to
`terminology_codes`, and the whole slice looks configured while doing nothing.

The machinery exists: `terminology-admin-store` exposes `valueSets.save/expand/importFhir`,
`filterConcepts`, and `resolveValueSetCompose`. ⚠ `applyConceptFilter` compiles to
`where(sql\`properties->>${name}\`, '=', value)`, and `filterConcepts` honours **only `filters[0]`
and op `'='`** — which the Task 3 compose shapes are built for.

⚠ **Read `packages/db/src/terminology-admin-store.ts` before writing anything here**, and find how
`refreshCacheAndProject` (or its equivalent) turns a saved ValueSet into a projected FHIR resource.
That is the path this must join, so the re-expansion also reaches `terminology_codes`.

- [ ] **Step 1: Write the failing test**

An integration test: import two parameters (one `result`, one `metadata`) against a migrated DB, then
assert the `non-reportable` ValueSet's expansion contains the metadata code and NOT the result code.

```ts
it('re-expands the intensional sets after an import, so they are not empty', async () => {
  // …migrate, build the loader store, run importResultParameters with:
  //   [{ code: 'CD4', description: 'CD4 Count', result_role: 'result' },
  //    { code: 'COLBY', description: 'Collected By', result_role: 'metadata' }]
  // then read the non-reportable ValueSet's materialized expansion.
  expect(codesIn('urn:openldr:valueset:non-reportable')).toEqual(['COLBY']);
  expect(codesIn('urn:openldr:valueset:reportable-result')).toEqual(['CD4']);
});
```

⚠ This block is a SKETCH of the ASSERTIONS, which are exact; the arrange half depends on how the
loader store is constructed in the file you choose. Build it from the real code.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — both expansions empty.

- [ ] **Step 3: Write minimal implementation**

Re-expand the ValueSets whose compose references `RESULT_PARAM_SYSTEM` after the import completes.
**Do not hardcode the three URLs** if the store can find sets by system — read it and prefer the
general path. If it cannot, name the URLs in one exported constant, not inline at two call sites.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/bootstrap && npx vitest run`

- [ ] **Step 5: Mutation-check**

Remove the re-expansion call. The test MUST go red with empty expansions. Restore. If it stays green
the test is not reaching the expansion and must be rewritten — this is the assertion the whole slice
rests on.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(bootstrap): re-expand result-role value sets after a parameter import"
```

---

### Task 5: Whole-slice verification

**Files:** none modified.

- [ ] **Step 1: Gate**

Run: `pnpm turbo run typecheck test --force`
⚠ Do NOT pipe turbo through `tail` — it discards the failure detail. Redirect to a file instead.
Expected: clean. On failure, grep for `Test timed out` and re-run the package alone before blaming this change ([[test-gate-flakiness-timeouts]]).

- [ ] **Step 2: Live verify against the dev stack**

The dev warehouse holds 84 distinct observation codes, of which `TPCON`/`COLBY`/`COLST`/`TPD`/`CONNO`/`INSTR` (2,685 rows) are metadata.

1. Build a parameter JSON for the codes actually present (`select distinct observation_code, observation_desc from lab_results`), classifying at minimum those six as `metadata` and the chemistry/micro codes as `result`.
2. `openldr terminology import parameters <file>` — confirm the reported `byRole` tally.
3. `openldr terminology reproject` (from the previous slice), then confirm in the warehouse:
   `select value_set_id, count(*) from terminology_codes group by 1` shows the non-reportable set populated.
4. **Fail-open check:** leave one observed code OUT of the import entirely. Confirm it is absent from the non-reportable set, i.e. it would still print.

Record the real numbers. ⚠ This is the step that catches an intensional set that expands to nothing — the failure Task 4 exists to prevent, and one no unit test at this scale can see.

- [ ] **Step 3: Report; commit nothing**

---

## Self-Review

**Spec coverage.** §2 D1 (CodeSystem property + ValueSet) → Tasks 1, 3. D2 (fail-open) → Task 3's compose shapes and Task 5 Step 2.4; it is structural, so no task implements a runtime check. D3 (import the dictionary, author the roles) → Task 1, with `result_role` supplied in the import payload so an operator bulk-authors via a file rather than 84 UI edits. §3's four properties → Task 1. §3's three ValueSets → Task 3. §4 (reaching a report) → **NOT in this plan**, see below.

**Placeholder scan.** Three steps are marked SKETCH rather than fabricated: Task 2 Step 1's arrange block, Task 3 Step 3's migration body (must be copied from real 014 boilerplate), and Task 4 Step 1's arrange half. Task 3 also flags that `069` is an assumption to verify. Task 4's assertions are exact even though its arrange is not.

**Type consistency.** `RESULT_PARAM_SYSTEM`, `RESULT_ROLES`, `ResultRole`, `ResultParamRow`, `ResultParamImportResult`, `importResultParameters`, `result_role`, `parm_context`, `parm_units`, `reference_citation`, and `ctx.loaders.parameters` are spelled identically in Tasks 1, 2, 4 and 5.

## Not in this plan

**The report join.** Nothing yet *uses* the exclusion set — the clinical template is S6, and wiring
the join into a report before a template exists would be building a consumer with no consumer. This
plan ends when the non-reportable set is populated and projected into `terminology_codes`, verifiable
by the SQL in Task 5.

Also out: reference ranges (S2a — and note the spec's open thread on `SIHiRange`/`SILoRange`, which
must be checked before S2a starts), the units mojibake (S2c — needs the CP437-vs-CP850 discriminating
byte measured first), and whether `terminology_codes` should become joinable in the widget builder
(§4 of the spec flags it; it belongs with the first real reader).
