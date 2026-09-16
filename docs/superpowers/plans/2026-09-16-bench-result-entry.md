# Bench result entry on the Lab order, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** A test chosen on a Lab order lists its result parameters, the operator types a value for each, sees the reference range that matches the patient, and may reject the order or one test with a coded reason. One submit writes the order and one Observation per result.

**Architecture:** A catalog test gains `resultParams`: a list of existing result-parameter concepts, each with a result type and, for numeric ones, reference bands by sex and age. A new route answers which parameters and which matched band apply to the tests chosen for a patient. A new form field type, `testDetails`, depends on the Tests field the way S4's specimen picker does, carries what the operator types, and stores it as nested items on the QuestionnaireResponse. A new extractor turns that answer into Observations. The extractor stays pure: the band it writes as `referenceRange` was chosen by the server and travels inside the answer.

**Tech Stack:** TypeScript, Kysely, pg-mem, Fastify, zod, React, vitest (pg-mem for services and migrations, jsdom for the studio).

**Spec:** `docs/superpowers/specs/2026-09-16-bench-result-entry-design.md`. Its sections 4 to 7 are the contract. Section 3 holds the ten decisions the operator settled, and section 9 says what is deliberately left out.

## Global Constraints

- Work in a git worktree under `.claude/worktrees/`, never the main checkout. Leave `peaceful-kirch-839cb2` and `confident-lumiere-666963` alone.
- Stage by exact path. Never `git add <dir>`. No `Co-Authored-By` trailer.
- Commit only as these steps say. Merge or push only when the operator asks.
- New writing follows the `unslop` skill, code comments and UI copy included: no em dashes, no emoji in headings or bullets.
- Run one test file from its package: `cd <package> && npx vitest run <path> --testTimeout 30000`. `pnpm --filter <pkg> test -- <path>` does not filter.
- Typecheck one package: `cd <package> && npx tsc --noEmit -p . > "$TEMP/<name>.txt" 2>&1; echo "exit=$?"`. Never read `$?` through a pipe.
- The gate is `pnpm turbo run typecheck --force --concurrency=4` and `pnpm turbo run test --force --concurrency=4 --continue`, each redirected to a file. Never pipe turbo through `tail`. A failure is usually a timeout: grep for `Test timed out` and re-run that package alone.
- **Migration 106.** Free on `main` at `c31e80b7` on 2026-09-16, where 105 is the highest. Re-check every local branch, every worktree and the operator's Linux machine before Task 11 and again before merging. If 106 is taken, renumber: `git mv` both files, update `index.ts` (import alias and key, kept last), the manifest in `packages/db/src/migrations/migrations.test.ts`, the `@openldr/db` export, and every comment naming the number.
- **Never migrate a persistent database from the worktree.** The dev API runs under `nodemon` in the main checkout and migrates the dev database on boot. Merge only once the number is final.
- **No clinical vocabulary in code** (AGENTS.md section 8). The studio never names the result-parameter system, the rejection value sets or LOINC. The server decides what a parameter is and which band applies.
- **Every studio string goes in `en.ts`, `fr.ts` and `pt.ts` together.** A missing key renders as literal braces.
- **UI rules** (AGENTS.md section 5): actions in a `⋯` menu, sheets rather than dialogs, label left and input right in `grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`, `StripedEmpty` when empty and `LoadingState` while loading, shadcn only, `TablePagination` on every table.

---

## Settled before this plan (operator, 2026-09-16)

These come from the spec's section 3. They are decisions, not open questions.

1. **Bench entry.** The studio originates results. It is not a correction surface for ingested ones.
2. **A test names its result parameters**, which are existing concepts in `urn:openldr:default_result`.
3. **Ranges band by sex and age.** No per-lab override.
4. **Results are typed in the same session as the order**, and one submit carries both.
5. **No worklist and no way to reopen a submitted order.** A recent-orders strip would show bench orders only while ingested orders are the larger pile.
6. **No verification step.** Every result is final. The per-test flag waits for the worklist slice.
7. **Rejections are coded**, at order level and test level, from two seeded value sets.
8. **Authoring is the Test catalog sheet only.** No import or export columns.
9. **Rejections reach FHIR and stop there.** No warehouse projection.
10. **The storage and rejection shape get a second look after implementation.** The operator asked for this explicitly. Do not widen the design mid-flight to pre-empt it.

## Facts this plan rests on

Each was read on 2026-09-16 at `c31e80b7`.

- **Result parameters already exist** as a code system, `urn:openldr:default_result`, one concept per analyte carrying `parm_units` and `result_role` (`packages/terminology/src/loaders/result-parameters.ts:5-25`). Migration 069 seeds `urn:openldr:valueset:reportable-result`, the parameters whose role is `result` (`069_result_role_valuesets.ts:13-16`).
- **PARMDICT's `reference` is a citation, not bounds** (`result-parameters.ts:21-24`). No reference range exists in CE today.
- **A catalog test's extras live in concept properties**, read by `toTest` (`packages/bootstrap/src/test-catalog.ts:274-292`) and written from `CatalogTestInput` (`:84-95`). `shortName`, `category` and `specimenTypes` all work this way.
- **The field type union is a zod enum** (`packages/forms/src/schema/form-schema.ts:3-9`) and `referenceDependsOn` is already on the schema (`:104`).
- **`extractorsForForm` picks extractors by resource type** (`packages/forms/src/routing.ts:42-48`). `ObservationExtractor` is always included, `ServiceRequestExtractor` only for a requisition.
- **`validateAnswers` switches on `fieldType`** and skips `group` outright (`packages/forms/src/validate-answers.ts:30`).
- **`FieldControl` switches on field type** for rendering, with `reference`, `facility` and `organism` sharing a branch (`apps/studio/src/forms-runtime/FormRuntime.tsx:579-581`), and S4 added `dependsOnValue` to that path.
- **`TestSheet` is one grid with a header `⋯` menu** (`apps/studio/src/test-catalog/TestSheet.tsx:84-115`), and its save posts a whole `CatalogTestInput`.
- **A Lab Technician holds `forms.view` and `forms.submit` only** (`packages/rbac/src/presets.ts:52`), which is why the new read route takes `forms.view`.
- **The warehouse has no rejection column**, and `lab_requests` holds one row per order (`packages/db/src/relational/service-request.ts:13-15`).

## Where this plan departs from the spec

| Spec says | Plan does | Why |
|---|---|---|
| The extractor writes `referenceRange` "from the band that matched" (5) | The band travels inside the `testDetails` answer, and the extractor copies it | The extractor is pure and has no catalog. The server already chose the band when the sheet asked for parameters |
| "Migration seeds two ValueSets" (4) | Migration 106 seeds them and adds the field to the shipped Lab order | Same discipline as 105. One migration per release slice, with the form snapshot frozen in it |
| (not specified) | The parameter picker offers `urn:openldr:valueset:reportable-result` | 069 already seeds exactly the parameters whose role is `result` |
| (not specified) | A rejected test keeps any values already typed, and the extractor ignores them | Rejecting is reversible in the sheet, and losing typed numbers to a mis-click is worse |

## Known effects, not handled here

- **A submitted order cannot be reopened**, so a result typed once cannot be corrected in the studio (decision 5).
- **Rejections are invisible to reports** (decision 9). The docs say so.
- **No verification** (decision 6), so every result is `final` on arrival.
- **A test with no result parameters behaves exactly as today.** Its row opens a sheet with the specimen picker only.
- **Ingested Observations are untouched.** Nothing in this slice reads or rewrites them.
- **Bands are not validated against each other.** Two overlapping bands for one sex and age are allowed, and the first match wins.
- **A response replayed through ingest produces Observations with no `referenceRange`.** The band rides in the extraction context, not in the response, because a FHIR answer has nowhere to carry it. Values, units and codes all survive. The catalog still holds the bands.

---

## What changes

| File | Change |
|---|---|
| `packages/bootstrap/src/result-params.ts` | Create. Types, band matching, parameter validation |
| `packages/bootstrap/src/result-params.test.ts` | Create |
| `packages/bootstrap/src/test-catalog.ts` | `resultParams` on read, write and check; `resultParamsFor` |
| `packages/bootstrap/src/test-catalog.test.ts` | Tests for the above |
| `packages/bootstrap/src/index.ts` | Exports |
| `apps/server/src/test-catalog-routes.ts`, `.test.ts` | `POST /api/test-catalog/result-params`; `resultParams` on the save |
| `packages/cli/src/test-catalog.ts`, `program.ts`, `*.test.ts` | `openldr test-catalog params` |
| `packages/forms/src/schema/form-schema.ts` | `testDetails` field type and its answer schema |
| `packages/forms/src/test-details.ts`, `.test.ts` | Create. The answer shape and its helpers |
| `packages/forms/src/validate-answers.ts`, `.test.ts` | Validate the new answer |
| `packages/forms/src/response.ts`, `capture.test.ts` | Nested items for the new field |
| `packages/forms/src/extract/test-results.ts`, `extraction.test.ts` | Create the extractor |
| `packages/forms/src/extract/extract.ts` | `ExtractionContext.testBands` |
| `apps/server/src/forms-routes.ts`, `.test.ts` | Pass the bands to the extractor |
| `packages/forms/src/routing.ts`, `routing.test.ts` | Register it |
| `apps/studio/src/api.ts`, `api.testCatalog.test.ts` | `catalogResultParams`, `expandValueSetByUrl` |
| `apps/studio/src/pages/FormCapture.tsx`, `.test.tsx` | Translated chrome, and the order-level reject |
| `apps/studio/src/forms-runtime/TestDetailsField.tsx`, `.test.tsx` | Create. The row list |
| `apps/studio/src/forms-runtime/TestDetailSheet.tsx`, `.test.tsx` | Create. Specimen, bands, result inputs |
| `apps/studio/src/forms-runtime/RejectSheet.tsx`, `.test.tsx` | Create. Coded reason, both levels |
| `apps/studio/src/forms-runtime/FormRuntime.tsx`, `.test.tsx` | Render the new field type |
| `apps/studio/src/test-catalog/TestSheet.tsx`, `.test.tsx` | The authoring section |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | New strings |
| `packages/db/src/migrations/internal/106_result_entry.ts`, `.test.ts` | Create. Two ValueSets, the Lab order field |
| `packages/db/src/migrations/internal/index.ts`, `migrations.test.ts`, `packages/db/src/index.ts` | Register 106 |
| `packages/forms/src/samples/forms.ts`, `forms.test.ts` | The shipped Lab order gains the field |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/*.md`, `apps/web/src/docs/0.1.8/*.md` | Docs |

---

### Task 1: the result parameter shape and band matching

**Files:**
- Create: `packages/bootstrap/src/result-params.ts`
- Create: `packages/bootstrap/src/result-params.test.ts`

**Interfaces:**
- Produces: `RESULT_PARAM_VALUE_SET`, `ResultType`, `ResultBand`, `TestResultParam`, `parseResultParams(value: unknown): TestResultParam[]`, `matchBand(bands: ResultBand[], patient: { sex?: string | null; ageYears?: number | null }): ResultBand | null`.

This task is pure. No database, no routes.

- [ ] **Step 1: Write the failing tests**

Create `packages/bootstrap/src/result-params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchBand, parseResultParams, type ResultBand } from './result-params';

const band = (b: Partial<ResultBand>): ResultBand => ({ low: null, high: null, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null, ...b });

describe('result parameters: reading what a test stored', () => {
  it('reads a numeric parameter with its bands', () => {
    expect(parseResultParams([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [{ low: 12, high: 15, unit: 'g/dL', sex: 'female' }] },
    ])).toEqual([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null,
        bands: [{ low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: null, ageHigh: null }] },
    ]);
  });

  it('reads a coded parameter with the value set its answers come from', () => {
    expect(parseResultParams([{ system: 'urn:openldr:default_result', code: 'MRDT', resultType: 'coded', valueSetUrl: 'urn:openldr:valueset:rdt-result' }]))
      .toEqual([{ system: 'urn:openldr:default_result', code: 'MRDT', resultType: 'coded', valueSetUrl: 'urn:openldr:valueset:rdt-result', bands: [] }]);
  });

  it('drops an entry that names no code, and defaults a missing type to text', () => {
    expect(parseResultParams([{ system: 'urn:openldr:default_result' }, { system: 'urn:openldr:default_result', code: 'NOTE' }]))
      .toEqual([{ system: 'urn:openldr:default_result', code: 'NOTE', resultType: 'text', valueSetUrl: null, bands: [] }]);
  });

  it('reads nothing from a value that is not a list', () => {
    expect(parseResultParams(undefined)).toEqual([]);
    expect(parseResultParams('HGB')).toEqual([]);
  });
});

describe('result parameters: which band applies', () => {
  const bands = [
    band({ low: 13, high: 17, sex: 'male', ageLow: 18 }),
    band({ low: 12, high: 15, sex: 'female', ageLow: 18 }),
    band({ low: 11, high: 14, ageLow: 2, ageHigh: 17 }),
    band({ low: 10, high: 13 }),
  ];

  it('takes the band whose sex and age both match', () => {
    expect(matchBand(bands, { sex: 'female', ageYears: 30 })?.high).toBe(15);
    expect(matchBand(bands, { sex: 'male', ageYears: 30 })?.high).toBe(17);
  });

  it('takes a band that names an age window but no sex', () => {
    expect(matchBand(bands, { sex: 'male', ageYears: 9 })?.high).toBe(14);
  });

  it('falls back to the band that names neither', () => {
    expect(matchBand(bands, { sex: null, ageYears: null })?.high).toBe(13);
    expect(matchBand(bands, { sex: 'other', ageYears: 1 })?.high).toBe(13);
  });

  it('counts an age exactly on the low edge as inside, and the high edge as inside', () => {
    expect(matchBand(bands, { sex: 'male', ageYears: 18 })?.high).toBe(17);
    expect(matchBand(bands, { sex: null, ageYears: 17 })?.high).toBe(14);
  });

  it('answers null when nothing matches and there is no catch-all', () => {
    expect(matchBand([band({ low: 1, high: 2, sex: 'male' })], { sex: 'female', ageYears: 20 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/result-params.test.ts --testTimeout 30000`

Expected: FAIL. `./result-params` does not exist.

- [ ] **Step 3: Write the module**

Create `packages/bootstrap/src/result-params.ts`:

```ts
// Bench result entry (docs/superpowers/specs/2026-09-16-bench-result-entry-design.md, 4).
//
// A catalog test names the result parameters it yields. Those are existing concepts in the site
// result-parameter dictionary (urn:openldr:default_result), which already carries each one's units
// and its result_role. Migration 069 seeds the ValueSet of the ones whose role is 'result', which is
// what the authoring picker offers. This module is the shape of that link plus the band rules, kept
// free of the database so both the service and its tests can use it directly.

/** Parameters whose result_role is 'result', seeded by migration 069. The picker offers these. */
export const RESULT_PARAM_VALUE_SET = 'urn:openldr:valueset:reportable-result';

export type ResultType = 'numeric' | 'coded' | 'text';

/** One reference band. A band naming neither sex nor an age window is the catch-all. */
export interface ResultBand {
  low: number | null;
  high: number | null;
  unit: string | null;
  sex: string | null;
  ageLow: number | null;
  ageHigh: number | null;
}

export interface TestResultParam {
  system: string;
  code: string;
  resultType: ResultType;
  /** For a coded parameter, the ValueSet its answers come from. Null for the other types. */
  valueSetUrl: string | null;
  /** Bands, in the order the operator wrote them. Empty for a coded or text parameter. */
  bands: ResultBand[];
}

const RESULT_TYPES: ResultType[] = ['numeric', 'coded', 'text'];

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function toBand(value: unknown): ResultBand | null {
  if (!value || typeof value !== 'object') return null;
  const b = value as Record<string, unknown>;
  return {
    low: num(b.low), high: num(b.high), unit: str(b.unit),
    sex: str(b.sex), ageLow: num(b.ageLow), ageHigh: num(b.ageHigh),
  };
}

/** Read what a test stored. Anything unreadable is dropped rather than failing the whole test. */
export function parseResultParams(value: unknown): TestResultParam[] {
  if (!Array.isArray(value)) return [];
  const out: TestResultParam[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const code = str(e.code);
    const system = str(e.system);
    if (!code || !system) continue;
    const declared = str(e.resultType) as ResultType | null;
    const resultType = declared && RESULT_TYPES.includes(declared) ? declared : 'text';
    const bands = resultType === 'numeric' && Array.isArray(e.bands)
      ? e.bands.map(toBand).filter((b): b is ResultBand => b !== null)
      : [];
    out.push({ system, code, resultType, valueSetUrl: resultType === 'coded' ? str(e.valueSetUrl) : null, bands });
  }
  return out;
}

/**
 * The band that applies to one patient. A band matches when its sex matches, or it names none, and
 * the age falls inside its window, both edges counted as inside. The first match in the stored order
 * wins, so a lab that writes overlapping bands gets the one it wrote first. Null means nothing
 * matched, and the sheet then shows no range rather than a wrong one.
 */
export function matchBand(bands: ResultBand[], patient: { sex?: string | null; ageYears?: number | null }): ResultBand | null {
  const sex = patient.sex ?? null;
  const age = patient.ageYears ?? null;
  for (const band of bands) {
    if (band.sex !== null && band.sex !== sex) continue;
    if (band.ageLow !== null && (age === null || age < band.ageLow)) continue;
    if (band.ageHigh !== null && (age === null || age > band.ageHigh)) continue;
    return band;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/result-params.test.ts --testTimeout 30000`

Expected: PASS, all 9 tests.

Mutation check on the edge rule: change `age < band.ageLow` to `age <= band.ageLow` and re-run. The test "counts an age exactly on the low edge as inside" must FAIL. Restore the line.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/br-t1-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/result-params.ts packages/bootstrap/src/result-params.test.ts
git commit -m "feat(bootstrap): read a test's result parameters and pick the band that fits" -m "A catalog test can name the result parameters it yields, each with a result type and, when numeric, reference bands. A band matches on sex and an age window, both edges inside, and a band naming neither is the catch-all. The first match in the stored order wins. Unreadable entries are dropped rather than failing the test they belong to."
```

---

### Task 2: the catalog stores a test's result parameters

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts` (the `CatalogTest` interface at `:53-65`, `CatalogTestInput` at `:84-95`, `toTest` at `:274-292`, the write path and `checkTest`)
- Modify: `packages/bootstrap/src/test-catalog.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (exports)

**Interfaces:**
- Consumes: `parseResultParams`, `RESULT_PARAM_VALUE_SET`, `TestResultParam` (Task 1).
- Produces: `CatalogTest.resultParams: TestResultParam[]`, `CatalogTestInput.resultParams?: TestResultParam[]`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/bootstrap/src/test-catalog.test.ts`:

```ts
describe('test catalog: result parameters on a test', () => {
  const HGB = { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null,
    bands: [{ low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }] };

  it('keeps the parameters a save writes, bands and all', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    expect((await catalog.get('FBC'))?.resultParams).toEqual([HGB]);
  });

  it('answers an empty list for a test that names none', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'CD4', display: 'CD4 count' });
    expect((await catalog.get('CD4'))?.resultParams).toEqual([]);
  });

  it('clears the parameters when a save sends an empty list, and keeps them when it sends none', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    await catalog.update('FBC', { display: 'Full blood count' });
    expect((await catalog.get('FBC'))?.resultParams).toEqual([HGB]);
    await catalog.update('FBC', { display: 'Full blood count', resultParams: [] });
    expect((await catalog.get('FBC'))?.resultParams).toEqual([]);
  });

  it('refuses a parameter that is not in the reportable-result list', async () => {
    const { catalog } = await buildCatalog();
    await expect(catalog.create({
      code: 'FBC', display: 'Full blood count',
      resultParams: [{ ...HGB, code: 'NOT-A-PARAM' }],
    })).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('refuses a coded parameter that names no value set', async () => {
    const { catalog } = await buildCatalog();
    await expect(catalog.create({
      code: 'MAL', display: 'Malaria RDT',
      resultParams: [{ system: 'urn:openldr:default_result', code: 'MRDT', resultType: 'coded', valueSetUrl: null, bands: [] }],
    })).rejects.toMatchObject({ kind: 'invalid' });
  });
});
```

`buildCatalog` seeds no result parameters, so the refusal test needs the dictionary to exist. Add this helper directly above the new describe block, and call it in the two tests that save a real parameter:

```ts
async function seedResultParams(db: Kysely<InternalSchema>, codes: string[]): Promise<void> {
  for (const code of codes) {
    await db.insertInto('terminology_concepts').values({
      system: 'urn:openldr:default_result', code, display: code, status: 'ACTIVE',
      properties: JSON.stringify({ result_role: 'result' }) as never,
    }).execute();
  }
}
```

Call it as the first line of the three tests that write `HGB` or `MRDT`, passing `built.db` from `buildCatalog`, for example:

```ts
const { db, catalog } = await buildCatalog();
await seedResultParams(db, ['HGB']);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts -t "result parameters on a test" --testTimeout 30000`

Expected: FAIL. `resultParams` is not on the returned test, and no save refuses anything.

- [ ] **Step 3: Store them**

In `packages/bootstrap/src/test-catalog.ts`:

1. Add to the imports:

```ts
import { matchBand, parseResultParams, RESULT_PARAM_VALUE_SET, type ResultBand, type TestResultParam } from './result-params';
```

2. In `CatalogTest`, directly after `specimenTypes`, add:

```ts
  /** The result parameters this test yields, in the order the operator wrote them. */
  resultParams: TestResultParam[];
```

3. In `CatalogTestInput`, directly after `specimenTypes`, add:

```ts
  /** Left out keeps what is stored. An empty list clears it. */
  resultParams?: TestResultParam[];
```

4. In `toTest`, directly after the `specimenTypes` line, add:

```ts
    resultParams: parseResultParams(p.resultParams),
```

5. In `ValidTest`, add `resultParams: TestResultParam[];` after `specimenTypes`.

6. In `checkTest`, after the specimen check, add:

```ts
  // The parameters must be codes the dictionary holds, exactly as a specimen must come from the
  // specimen list. A coded parameter must name the ValueSet its answers come from, or data entry
  // would have nothing to offer.
  const params = parseResultParams(input.resultParams);
  if (input.resultParams !== undefined) {
    for (const param of params) {
      if (!ctx.resultParams.has(param.code)) {
        refuse(`'${param.code}' is not a result parameter`);
      } else if (param.resultType === 'coded' && !param.valueSetUrl) {
        refuse(`'${param.code}' is a coded result and needs a value set`);
      }
    }
  }
```

7. In `CheckContext`, add `resultParams: Set<string>;` and fill it where the other lists are loaded:

```ts
  const resultParams = new Set((await expandEntries(RESULT_PARAM_VALUE_SET)).map((p) => p.code));
```

8. Where the concept's properties are written, carry the parameters through unchanged when the input leaves them out:

```ts
    ...(input.resultParams === undefined ? {} : { resultParams: params }),
```

`refuse`, `expandEntries` and the properties writer already exist. Read the specimen path directly above and follow it line for line.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

- [ ] **Step 5: Export the new names**

In `packages/bootstrap/src/index.ts`, add to the `./test-catalog` export block:

```ts
  type TestResultParam, type ResultBand, type ResultType,
```

and add a new export line beside it:

```ts
export { RESULT_PARAM_VALUE_SET, matchBand, parseResultParams } from './result-params';
```

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/br-t2-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): a catalog test names the result parameters it yields" -m "A test can carry result parameters beside its specimens, each one a code the site dictionary already holds, with a result type and, for numeric ones, reference bands. A save that leaves them out keeps what is stored, an empty list clears them, and a parameter outside the reportable-result list is refused, as a specimen outside the specimen list already is."
```

---

### Task 3: the catalog answers what an order needs to show

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts` (the `TestCatalog` interface, and inside `createTestCatalog`)
- Modify: `packages/bootstrap/src/test-catalog.test.ts`

**Interfaces:**
- Consumes: `matchBand`, `TestResultParam` (Tasks 1 and 2).
- Produces: `TestCatalog.resultParamsFor(tests: Array<{ system: string; code: string }>, patient: { sex?: string | null; ageYears?: number | null }): Promise<TestParamsAnswer[]>` where `TestParamsAnswer = { test: { system: string; code: string }; params: Array<TestResultParam & { unit: string | null; display: string | null; band: ResultBand | null }> }`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/bootstrap/src/test-catalog.test.ts`:

```ts
describe('test catalog: what a result sheet needs', () => {
  const test = (code: string) => ({ system: TEST_CATALOG_SYSTEM, code });
  const HGB = {
    system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null,
    bands: [
      { low: 13, high: 17, unit: 'g/dL', sex: 'male', ageLow: 18, ageHigh: null },
      { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null },
    ],
  };

  it('answers each test its parameters, with the band that fits the patient', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ code: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    const answer = await catalog.resultParamsFor([test('FBC')], { sex: 'female', ageYears: 30 });
    expect(answer).toEqual([{
      test: { system: TEST_CATALOG_SYSTEM, code: 'FBC' },
      params: [{ ...HGB, unit: 'g/dL', display: 'HGB', band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null } }],
    }]);
  });

  it('answers a null band when no band fits, rather than a wrong one', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ code: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    const answer = await catalog.resultParamsFor([test('FBC')], { sex: null, ageYears: null });
    expect(answer[0].params[0].band).toBeNull();
  });

  it('answers an empty parameter list for a test that names none', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'CD4', display: 'CD4 count' });
    expect(await catalog.resultParamsFor([test('CD4')], {})).toEqual([{ test: { system: TEST_CATALOG_SYSTEM, code: 'CD4' }, params: [] }]);
  });

  it('ignores codings that are not catalog tests', async () => {
    const { catalog } = await buildCatalog();
    expect(await catalog.resultParamsFor([{ system: LOINC_SYSTEM, code: '718-7' }], {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts -t "what a result sheet needs" --testTimeout 30000`

Expected: FAIL, with `catalog.resultParamsFor is not a function`.

- [ ] **Step 3: Add the method**

In the `TestCatalog` interface, after `loincCodingsFor`, add:

```ts
  /** Each test's result parameters, with each parameter's unit, display and the band that fits this
   *  patient. Codings outside the catalog are ignored (bench result entry, spec 7). */
  resultParamsFor(
    tests: Array<{ system: string; code: string }>,
    patient: { sex?: string | null; ageYears?: number | null },
  ): Promise<TestParamsAnswer[]>;
```

Directly above the interface, add:

```ts
/** One test's parameters, ready for the sheet to draw. */
export interface TestParamsAnswer {
  test: { system: string; code: string };
  params: Array<TestResultParam & { unit: string | null; display: string | null; band: ResultBand | null }>;
}
```

Inside `createTestCatalog`, directly above `return {`, add:

```ts
  async function resultParamsFor(
    tests: Array<{ system: string; code: string }>,
    patient: { sex?: string | null; ageYears?: number | null },
  ): Promise<TestParamsAnswer[]> {
    const codes = tests.filter((t) => t.system === TEST_CATALOG_SYSTEM).map((t) => t.code);
    if (codes.length === 0) return [];
    const wanted = new Set(codes);
    const found = (await readTests()).filter((t) => wanted.has(t.code));
    const paramCodes = [...new Set(found.flatMap((t) => t.resultParams.map((p) => p.code)))];
    // The dictionary already holds each parameter's units and display, so the sheet never carries them.
    const dictionary = paramCodes.length === 0 ? [] : await db.selectFrom('terminology_concepts')
      .select(['code', 'display', 'properties'])
      .where('system', '=', RESULT_PARAM_SYSTEM_URL)
      .where('code', 'in', paramCodes)
      .execute();
    const unitOf = new Map(dictionary.map((row) => {
      const props = (parseJson(row.properties) ?? {}) as Record<string, unknown>;
      return [row.code, { unit: typeof props.parm_units === 'string' ? props.parm_units : null, display: row.display ?? null }];
    }));
    return codes.map((code) => {
      const test = found.find((t) => t.code === code);
      return {
        test: { system: TEST_CATALOG_SYSTEM, code },
        params: (test?.resultParams ?? []).map((p) => ({
          ...p,
          unit: unitOf.get(p.code)?.unit ?? null,
          display: unitOf.get(p.code)?.display ?? null,
          band: matchBand(p.bands, patient),
        })),
      };
    });
  }
```

Add `resultParamsFor,` to the returned object after `loincCodingsFor,`.

At the top of the file, beside the other constants, add:

```ts
/** The site result-parameter dictionary. Must equal RESULT_PARAM_SYSTEM in @openldr/terminology. */
const RESULT_PARAM_SYSTEM_URL = 'urn:openldr:default_result';
```

`readTests` and `parseJson` already exist (`test-catalog.ts:371`, and the helper `toTest` uses).

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/br-t3-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts
git commit -m "feat(bootstrap): answer an order's tests with their parameters and matched bands" -m "resultParamsFor takes the tests chosen on an order and the patient's sex and age, and answers each test's result parameters with the unit and display the dictionary already holds and the one reference band that fits. A test naming no parameters answers an empty list, and codings that are not catalog tests are ignored."
```

---

### Task 4: the result parameters route

**Files:**
- Modify: `apps/server/src/test-catalog-routes.ts` (after the specimens route, which ends the file)
- Modify: `apps/server/src/test-catalog-routes.test.ts`

**Interfaces:**
- Consumes: `TestCatalog.resultParamsFor` (Task 3).
- Produces: `POST /api/test-catalog/result-params`, body `{ tests: Array<{ system, code }>, patient?: { reference: string } }`, answers `{ tests: TestParamsAnswer[]; rejectReasons: { order: Coding[]; test: Coding[] } }`. Gated on `forms.view`.

The route resolves the patient itself. The studio sends a reference and never a birth date, so no date arithmetic happens in the browser.

It also answers the rejection reasons, expanded. The studio must never name a clinical value set (AGENTS.md section 8), and a reject sheet that fetched them by url would do exactly that.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/test-catalog-routes.test.ts`:

1. Add `| 'resultParamsFor'` to the `Method` type.

2. After the `specimensFor` line in `fakeCtx`, add:

```ts
    resultParamsFor: spy('resultParamsFor', over.resultParamsFor ?? (async () => [
      { test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' },
        params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [], unit: 'g/dL', display: 'Haemoglobin', band: null }] },
    ])),
```

3. Add to the fake context, beside `testCatalog`, a FHIR store the route can read a patient from:

```ts
    fhirStore: { get: async () => ({ resourceType: 'Patient', id: 'p1', gender: 'female', birthDate: '1990-01-01' }) },
```

4. Add these tests inside the `describe` block:

```ts
  it('POST /result-params answers each test its parameters, to anyone who can use forms', async () => {
    const { ctx, calls } = fakeCtx();
    const tests = [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }];
    const res = await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests, patient: { reference: 'Patient/p1' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tests[0].params[0]).toMatchObject({ code: 'HGB', unit: 'g/dL' });
    expect(calls[0].method).toBe('resultParamsFor');
    expect(calls[0].args[0]).toEqual(tests);
  });

  it('resolves the patient itself, and passes sex and age to the catalog', async () => {
    const { ctx, calls } = fakeCtx();
    await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }], patient: { reference: 'Patient/p1' } },
    });
    const patient = calls[0].args[1] as { sex: string | null; ageYears: number | null };
    expect(patient.sex).toBe('female');
    expect(patient.ageYears).toBeGreaterThan(30);
  });

  it('asks with no patient when the order names none, rather than refusing', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0].args[1]).toEqual({ sex: null, ageYears: null });
  });

  it('answers the rejection reasons for both levels, so the studio names no value set', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }] },
    });
    expect(res.json().rejectReasons).toEqual({
      order: [{ system: 'urn:openldr:cs:reject-order', code: 'WRONGPT', display: 'Wrong patient' }],
      test: [{ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }],
    });
  });

  it('POST /result-params needs forms.view, and refuses a body that is not a list of codings', async () => {
    const { ctx, calls } = fakeCtx();
    const terminologyOnly = await appWith(ctx, ['terminology.view', 'terminology.manage'])
      .inject({ method: 'POST', url: '/api/test-catalog/result-params', payload: { tests: [] } });
    expect(terminologyOnly.statusCode).toBe(403);
    const bad = await appWith(ctx, ['forms.view'])
      .inject({ method: 'POST', url: '/api/test-catalog/result-params', payload: { tests: 'FBC' } });
    expect(bad.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: the four new tests FAIL with 404. The others PASS.

- [ ] **Step 3: Add the route**

In `apps/server/src/test-catalog-routes.ts`, beside `specimensInput`, add:

```ts
const resultParamsInput = z.object({
  tests: z.array(coding),
  patient: z.object({ reference: z.string().min(1) }).optional(),
});
```

Directly above `registerTestCatalogRoutes`, add:

```ts
/**
 * The patient's sex and whole years of age, read from the stored Patient. The studio sends a
 * reference only, so no date arithmetic happens in the browser and no birth date travels with a
 * picker answer. A patient that cannot be read gives nulls, and the catalog then answers the
 * catch-all band (bench result entry, spec 7).
 */
async function patientBandKey(ctx: AppContext, reference: string | undefined): Promise<{ sex: string | null; ageYears: number | null }> {
  const id = reference?.split('/')[1];
  if (!id) return { sex: null, ageYears: null };
  const patient = (await ctx.fhirStore.get('Patient', id).catch(() => null)) as { gender?: string; birthDate?: string } | null;
  if (!patient) return { sex: null, ageYears: null };
  const born = patient.birthDate ? new Date(patient.birthDate) : null;
  const ageYears = born && !Number.isNaN(born.getTime())
    ? Math.floor((Date.now() - born.getTime()) / (365.2425 * 24 * 60 * 60 * 1000))
    : null;
  return { sex: patient.gender ?? null, ageYears };
}
```

At the end of `registerTestCatalogRoutes`, after the specimens route, add:

```ts
  // Bench result entry: the parameters each chosen test yields, with the band that fits the patient,
  // and the rejection reasons for both levels. The reasons are expanded here because the studio must
  // never name a clinical value set (AGENTS.md section 8).
  app.post('/api/test-catalog/result-params', FORMS_VIEW, async (req, reply) => {
    const parsed = resultParamsInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const patient = await patientBandKey(ctx, parsed.data.patient?.reference);
    const [tests, order, test] = await Promise.all([
      ctx.testCatalog.resultParamsFor(parsed.data.tests, patient),
      expandReasons(ctx, ORDER_REJECT_VALUE_SET),
      expandReasons(ctx, TEST_REJECT_VALUE_SET),
    ]);
    return reply.send({ tests, rejectReasons: { order, test } });
  });
```

and beside `patientBandKey`:

```ts
/** The reasons one value set offers, as plain codings. An unreadable set answers none, so a reject
 *  sheet opens empty rather than the page failing. */
async function expandReasons(ctx: AppContext, url: string): Promise<Array<{ system: string; code: string; display: string | null }>> {
  const vs = await ctx.terminology.ops.expand(url, { count: 500 }).catch(() => null);
  return (vs?.expansion?.contains ?? []).map((c) => ({ system: c.system ?? '', code: c.code ?? '', display: c.display ?? null }));
}
```

with the two urls declared beside `FORMS_VIEW`, mirroring migration 106:

```ts
// Must equal the urls migration 106 seeds.
const ORDER_REJECT_VALUE_SET = 'urn:openldr:valueset:order-reject-reason';
const TEST_REJECT_VALUE_SET = 'urn:openldr:valueset:test-reject-reason';
```

The route test's fake context needs `terminology: { ops: { expand: async (url: string) => ({ expansion: { contains: url.includes('order') ? [{ system: 'urn:openldr:cs:reject-order', code: 'WRONGPT', display: 'Wrong patient' }] : [{ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }] } }) } }`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/server && npx tsc --noEmit -p . > "$TEMP/br-t4-tc.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src/test-catalog-routes.ts > "$TEMP/br-t4-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` twice.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/test-catalog-routes.ts apps/server/src/test-catalog-routes.test.ts
git commit -m "feat(server): answer which result parameters and ranges an order's tests need" -m "POST /api/test-catalog/result-params takes the tests chosen on an order and the patient reference, reads that patient's sex and age on the server, and answers each test's parameters with the single reference band that fits. It is gated on forms.view, because data entry calls it and a Lab Technician holds no terminology capability."
```

---

### Task 5: the CLI reads and writes a test's parameters

**Files:**
- Modify: `packages/cli/src/test-catalog.ts`
- Modify: `packages/cli/src/program.ts`
- Modify: `packages/cli/src/test-catalog-cli-parsing.test.ts`

**Interfaces:**
- Consumes: `TestCatalog` (Tasks 2 and 3).
- Produces: `openldr test-catalog params <code>` and `openldr test-catalog params <code> --set <file>`.

AGENTS.md section 6 item 2: authoring a catalog test is administration, so it needs a command. Bench entry is data entry and gets none, exactly as S4 got none.

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/src/test-catalog-cli-parsing.test.ts`:

```ts
describe('test-catalog params', () => {
  it('prints one line per parameter, with its type and band count', () => {
    expect(formatResultParams([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null,
        bands: [{ low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }] },
      { system: 'urn:openldr:default_result', code: 'NOTE', resultType: 'text', valueSetUrl: null, bands: [] },
    ])).toBe('HGB  numeric  1 band\nNOTE  text  0 bands');
  });

  it('says so when a test names none', () => {
    expect(formatResultParams([])).toBe('No result parameters.');
  });

  it('reads a set file as a list of parameters', () => {
    expect(readResultParamsFile(JSON.stringify([{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' }])))
      .toEqual([{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [] }]);
  });

  it('refuses a set file that is not a list', () => {
    expect(() => readResultParamsFile('{"code":"HGB"}')).toThrow(/list of result parameters/);
  });
});
```

Add `formatResultParams, readResultParamsFile,` to this file's import from `./test-catalog`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/cli && npx vitest run src/test-catalog-cli-parsing.test.ts --testTimeout 30000`

Expected: FAIL. Neither function exists.

- [ ] **Step 3: Write the two helpers and the command**

In `packages/cli/src/test-catalog.ts`, add:

```ts
/** One line per parameter, the way `list` prints one line per test. */
export function formatResultParams(params: TestResultParam[]): string {
  if (params.length === 0) return 'No result parameters.';
  return params
    .map((p) => `${p.code}  ${p.resultType}  ${p.bands.length} ${p.bands.length === 1 ? 'band' : 'bands'}`)
    .join('\n');
}

/** The --set file: a JSON list of parameters, read through the same parser the service uses. */
export function readResultParamsFile(text: string): TestResultParam[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('expected a list of result parameters');
  return parseResultParams(parsed);
}

export async function runTestCatalogParams(code: string, opts: { set?: string; json: boolean }): Promise<number> {
  const ctx = await createAppContextForCli();
  try {
    if (opts.set) {
      const params = readResultParamsFile(await readFile(opts.set, 'utf8'));
      const test = await ctx.testCatalog.get(code);
      if (!test) { process.stderr.write(`no such test: ${code}\n`); return 1; }
      await ctx.testCatalog.update(code, {
        display: test.display, shortName: test.shortName, category: test.category,
        specimenTypes: test.specimenTypes, loinc: test.loinc, active: test.active, resultParams: params,
      });
      await recordCatalogAudit(ctx, 'cli', code);
    }
    const test = await ctx.testCatalog.get(code);
    if (!test) { process.stderr.write(`no such test: ${code}\n`); return 1; }
    out(opts.json, test.resultParams, formatResultParams(test.resultParams));
    return 0;
  } finally { await ctx.close(); }
}
```

Match the file's existing helpers for `createAppContextForCli`, `out` and the audit call. Read the neighbouring `runTestCatalogList` and copy its shape rather than inventing one.

In `packages/cli/src/program.ts`, beside the other `test-catalog` subcommands, add:

```ts
  testCatalog
    .command('params <code>')
    .description("List a test's result parameters, or replace them from a JSON file")
    .option('--set <file>', 'a JSON list of result parameters to write')
    .option('--json', 'emit JSON', false)
    .action(async (code: string, opts: { set?: string; json: boolean }) => {
      try { process.exitCode = await runTestCatalogParams(code, opts); }
      catch (err) { process.stderr.write(`test-catalog params failed: ${redactError(err)}\n`); process.exitCode = 1; }
    });
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/cli && npx vitest run src/test-catalog-cli-parsing.test.ts src/test-catalog-import.test.ts --testTimeout 30000`

Expected: PASS in both files.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/cli && npx tsc --noEmit -p . > "$TEMP/br-t5-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/test-catalog.ts packages/cli/src/program.ts packages/cli/src/test-catalog-cli-parsing.test.ts
git commit -m "feat(cli): read and write a test's result parameters" -m "openldr test-catalog params <code> prints one line per parameter with its type and band count, and --set replaces them from a JSON file. It calls the same service the route calls, so both doors refuse the same parameters in the same words, and a write is audited as cli."
```

---

### Task 6: the form carries what the bench typed

**Files:**
- Create: `packages/forms/src/test-details.ts`
- Create: `packages/forms/src/test-details.test.ts`
- Modify: `packages/forms/src/schema/form-schema.ts:3-9`
- Modify: `packages/forms/src/validate-answers.ts`, `validate-answers.test.ts`
- Modify: `packages/forms/src/response.ts`, `capture.test.ts`

**Interfaces:**
- Produces: field type `testDetails`; `TestDetail`, `TestDetailsAnswer`, `TypedResult`, `ResultCoding`, `parseTestDetails(value: unknown): TestDetailsAnswer`, `testDetailItems(answer: TestDetailsAnswer): QuestionnaireResponseItem[]`. All of them are exported from `@openldr/forms/pure` as well as the package root, because the studio imports the types and `pure.ts` is its browser-safe entry point (`packages/forms/src/pure.ts`).

- [ ] **Step 1: Write the failing tests**

Create `packages/forms/src/test-details.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseTestDetails, testDetailItems } from './test-details'

const CATALOG = 'urn:openldr:codesystem:test-catalog'
const answer = {
  [`${CATALOG}|FBC`]: {
    specimen: { system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' },
    rejection: null,
    results: [
      { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
        band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null } },
    ],
  },
}

describe('test details answer', () => {
  it('reads a typed value with its unit and the band the server chose', () => {
    expect(parseTestDetails(answer)[`${CATALOG}|FBC`].results[0]).toEqual({
      param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
      band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null },
    })
  })

  it('reads a rejection and drops nothing else', () => {
    const rejected = { [`${CATALOG}|FBC`]: { ...answer[`${CATALOG}|FBC`], rejection: { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' } } }
    const parsed = parseTestDetails(rejected)[`${CATALOG}|FBC`]
    expect(parsed.rejection).toEqual({ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' })
    expect(parsed.results).toHaveLength(1)
  })

  it('reads an empty answer from anything unusable', () => {
    expect(parseTestDetails(undefined)).toEqual({})
    expect(parseTestDetails('FBC')).toEqual({})
  })

  it('writes one nested item per test and one per result', () => {
    expect(testDetailItems(parseTestDetails(answer))).toEqual([
      {
        linkId: `${CATALOG}|FBC`,
        item: [
          { linkId: `${CATALOG}|FBC#specimen`, answer: [{ valueCoding: { system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' } }] },
          { linkId: `${CATALOG}|FBC#urn:openldr:default_result|HGB`, answer: [{ valueQuantity: { value: 11.2, unit: 'g/dL' } }] },
        ],
      },
    ])
  })

  it('writes a coded result as a coding and a text result as a string', () => {
    const mixed = parseTestDetails({
      [`${CATALOG}|MAL`]: { specimen: null, rejection: null, results: [
        { param: { system: 'urn:openldr:default_result', code: 'MRDT' }, resultType: 'coded', value: { system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' } },
        { param: { system: 'urn:openldr:default_result', code: 'NOTE' }, resultType: 'text', value: 'sample clotted' },
      ] },
    })
    expect(testDetailItems(mixed)[0].item).toEqual([
      { linkId: `${CATALOG}|MAL#urn:openldr:default_result|MRDT`, answer: [{ valueCoding: { system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' } }] },
      { linkId: `${CATALOG}|MAL#urn:openldr:default_result|NOTE`, answer: [{ valueString: 'sample clotted' }] },
    ])
  })

  it('writes a rejected test as a coding item and no results', () => {
    const rejected = parseTestDetails({
      [`${CATALOG}|FBC`]: { specimen: null, rejection: { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }, results: [] },
    })
    expect(testDetailItems(rejected)[0].item).toEqual([
      { linkId: `${CATALOG}|FBC#rejection`, answer: [{ valueCoding: { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' } }] },
    ])
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/forms && npx vitest run src/test-details.test.ts --testTimeout 30000`

Expected: FAIL. `./test-details` does not exist.

- [ ] **Step 3: Write the module**

Create `packages/forms/src/test-details.ts`:

```ts
import type { QuestionnaireResponseItem } from 'fhir/r4'

// Bench result entry (docs/superpowers/specs/2026-09-16-bench-result-entry-design.md, 5).
//
// A `testDetails` field holds, for each test chosen on the order, the specimen, an optional coded
// rejection and one value per result parameter. It is keyed by `system|code` of the test so it stays
// aligned with the Tests answer it depends on, the way S4's specimen picker depends on that field.
//
// The band inside each result is the one the SERVER chose when the sheet asked for parameters. It
// travels with the answer so the extractor, which has no catalog, can write it as the Observation's
// referenceRange without asking anything.

export interface ResultCoding { system: string; code: string; display?: string | null }

export interface TypedResult {
  param: { system: string; code: string }
  resultType: 'numeric' | 'coded' | 'text'
  value: number | string | ResultCoding | null
  unit?: string | null
  band?: { low: number | null; high: number | null; unit: string | null; sex: string | null; ageLow: number | null; ageHigh: number | null } | null
}

export interface TestDetail {
  specimen: ResultCoding | null
  rejection: ResultCoding | null
  results: TypedResult[]
}

/** Keyed `system|code` of the test. */
export type TestDetailsAnswer = Record<string, TestDetail>

function coding(value: unknown): ResultCoding | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  if (typeof c.system !== 'string' || typeof c.code !== 'string') return null
  return { system: c.system, code: c.code, ...(typeof c.display === 'string' ? { display: c.display } : {}) }
}

export function parseTestDetails(value: unknown): TestDetailsAnswer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: TestDetailsAnswer = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    const results = Array.isArray(d.results) ? d.results : []
    out[key] = {
      specimen: coding(d.specimen),
      rejection: coding(d.rejection),
      results: results.flatMap((r) => {
        if (!r || typeof r !== 'object') return []
        const entry = r as Record<string, unknown>
        const param = coding({ ...(entry.param as object), display: null })
        if (!param) return []
        const resultType = entry.resultType === 'numeric' || entry.resultType === 'coded' ? entry.resultType : 'text'
        const value = resultType === 'coded' ? coding(entry.value)
          : resultType === 'numeric' ? (typeof entry.value === 'number' ? entry.value : null)
            : (typeof entry.value === 'string' ? entry.value : null)
        const typed: TypedResult = { param: { system: param.system, code: param.code }, resultType, value }
        if (typeof entry.unit === 'string') typed.unit = entry.unit
        if (entry.band && typeof entry.band === 'object') typed.band = entry.band as TypedResult['band']
        return [typed]
      }),
    }
  }
  return out
}

/**
 * The nested QuestionnaireResponse items for this answer: one item per test, holding one child per
 * specimen, rejection or result. A rejected test writes its reason and no results, because a value
 * typed before the rejection is kept in the answer but is not part of the record of what was
 * measured.
 */
export function testDetailItems(answer: TestDetailsAnswer): QuestionnaireResponseItem[] {
  return Object.entries(answer).map(([key, detail]) => {
    const item: QuestionnaireResponseItem[] = []
    if (detail.rejection) {
      item.push({ linkId: `${key}#rejection`, answer: [{ valueCoding: detail.rejection }] })
      return { linkId: key, item }
    }
    if (detail.specimen) item.push({ linkId: `${key}#specimen`, answer: [{ valueCoding: detail.specimen }] })
    for (const result of detail.results) {
      const link = `${key}#${result.param.system}|${result.param.code}`
      if (result.value === null) continue
      if (result.resultType === 'numeric' && typeof result.value === 'number') {
        item.push({ linkId: link, answer: [{ valueQuantity: { value: result.value, ...(result.unit ? { unit: result.unit } : {}) } }] })
      } else if (result.resultType === 'coded' && typeof result.value === 'object') {
        item.push({ linkId: link, answer: [{ valueCoding: result.value as ResultCoding }] })
      } else if (typeof result.value === 'string') {
        item.push({ linkId: link, answer: [{ valueString: result.value }] })
      }
    }
    return { linkId: key, item }
  })
}
```

- [ ] **Step 4: Add the field type and teach the two callers**

In `packages/forms/src/schema/form-schema.ts:3-9`, add `'testDetails',` to the enum, after `'reference'`.

In `packages/forms/src/pure.ts` and `packages/forms/src/index.ts`, add `export * from './test-details';` beside the other re-exports, so the studio can import the types from the browser-safe entry point.

In `packages/forms/src/validate-answers.ts`, directly after the `group` skip (line 30), add:

```ts
    // A testDetails answer is an object keyed by test, not a scalar. Its shape is checked where it
    // is read (test-details.ts), and the values inside it are the bench's own numbers, so there is
    // nothing here to refuse. Required means at least one test has something typed or a rejection.
    if (f.fieldType === 'testDetails') {
      if (f.required) {
        const detail = parseTestDetails(answers[f.id])
        const answered = Object.values(detail).some((d) => d.rejection !== null || d.results.some((r) => r.value !== null))
        if (!answered) errors.push({ fieldId: f.id, message: `${fieldLabel(f)} is required` })
      }
      continue
    }
```

Add its import at the top of that file, and match the file's own `errors.push` shape and label helper rather than the names above if they differ.

In `packages/forms/src/response.ts`, where a field becomes an item, add the branch that uses `testDetailItems` so the nested items reach the QuestionnaireResponse. Follow the `group` branch, which is the only other field type that emits children.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd packages/forms && npx vitest run src/test-details.test.ts src/validate-answers.test.ts src/capture.test.ts src/samples --testTimeout 30000`

Expected: PASS, every test in those files.

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/forms && npx tsc --noEmit -p . > "$TEMP/br-t6-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add packages/forms/src/test-details.ts packages/forms/src/test-details.test.ts packages/forms/src/schema/form-schema.ts packages/forms/src/validate-answers.ts packages/forms/src/response.ts
git commit -m "feat(forms): a field that holds what the bench typed for each test" -m "The new testDetails field type carries, per test chosen on the order, the specimen, an optional coded rejection and one value per result parameter, keyed by the test's own coding. It writes nested QuestionnaireResponse items, so the response stays the whole record of capture. The reference band the server chose travels inside the answer, so the extractor needs no catalog."
```

---

### Task 7: the extractor writes one Observation per result

**Files:**
- Create: `packages/forms/src/extract/test-results.ts`
- Modify: `packages/forms/src/extraction.test.ts`
- Modify: `packages/forms/src/routing.ts:42-48`, `routing.test.ts`

**Files (added when the round trip was settled):**
- Modify: `apps/server/src/forms-routes.ts` (the extraction context, beside S4's `codingBefore`)
- Modify: `apps/server/src/forms-routes.test.ts`

**Interfaces:**
- Consumes: `parseTestDetails`, `TestDetailsAnswer` (Task 6), `ExtractionContext` (S4).
- Produces: `TestResultsExtractor`, added to `extractorsForForm` for a requisition; `ExtractionContext.testBands?: ReadonlyMap<string, ResultBand>`, keyed `testKey#paramSystem|paramCode`.

**The round trip, settled 2026-09-16.** A FHIR `QuestionnaireResponse.item.answer` has nowhere to carry a reference band, and inventing an extension for reference data the catalog already owns is not worth the machinery. So the two halves come from two places:

- **Values come from the response.** The extractor reads the nested items, which means the ingest replay path still produces Observations from a stored response (`packages/ingest/src/converters/questionnaire-response.ts:10-23` passes an empty context).
- **Bands come from the context.** The forms route still holds the raw answers when it builds the extraction context (`apps/server/src/forms-routes.ts:394-404`), exactly where S4 fills `codingBefore`. It puts each typed result's band there.

**The effect, accepted:** a response replayed through ingest yields Observations with no `referenceRange`. The band is reference data, not something the bench typed, and the catalog still holds it. Nothing else changes.

- [ ] **Step 1: Write the failing tests**

Append to `packages/forms/src/extraction.test.ts`:

```ts
describe('TestResultsExtractor (bench result entry)', () => {
  const CATALOG = 'urn:openldr:codesystem:test-catalog'
  const PARAM = 'urn:openldr:default_result'
  const order = () =>
    makeSchema({
      id: 'o', name: 'Order', fhirResourceType: 'ServiceRequest',
      fields: [
        makeField({ id: 'tests', displayLabel: 'Tests', fieldType: 'reference', order: 0, fhirPath: 'ServiceRequest.code', referenceMultiple: true, cardinality: { min: 1, max: '*' } }),
        makeField({ id: 'details', displayLabel: 'Results', fieldType: 'testDetails', order: 1, referenceDependsOn: 'tests' }),
      ],
    })
  const extract = (details: unknown) => {
    const model = order()
    const answers = { tests: [{ system: CATALOG, code: 'FBC' }], details } as never
    return TestResultsExtractor.extract(toQuestionnaireResponse(model, answers), toQuestionnaire(model), ctx)
  }

  it('writes one final Observation per typed result, with the band as its reference range', () => {
    expect(extract({
      [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
        { param: { system: PARAM, code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
          band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null } },
      ] },
    })).toEqual([
      {
        resourceType: 'Observation',
        status: 'final',
        code: { coding: [{ system: PARAM, code: 'HGB' }] },
        subject: { reference: 'Patient/p1' },
        effectiveDateTime: '2026-06-04T00:00:00Z',
        valueQuantity: { value: 11.2, unit: 'g/dL' },
        referenceRange: [{ low: { value: 12, unit: 'g/dL' }, high: { value: 15, unit: 'g/dL' } }],
      },
    ])
  })

  it('writes a coded result and a text result under the right value', () => {
    const out = extract({
      [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
        { param: { system: PARAM, code: 'MRDT' }, resultType: 'coded', value: { system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' } },
        { param: { system: PARAM, code: 'NOTE' }, resultType: 'text', value: 'sample clotted' },
      ] },
    }) as any[]
    expect(out[0].valueCodeableConcept).toEqual({ coding: [{ system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' }] })
    expect(out[1].valueString).toBe('sample clotted')
  })

  it('writes a cancelled Observation carrying the reason for a rejected test, and no values', () => {
    expect(extract({
      [`${CATALOG}|FBC`]: {
        specimen: null,
        rejection: { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' },
        results: [{ param: { system: PARAM, code: 'HGB' }, resultType: 'numeric', value: 11.2 }],
      },
    })).toEqual([
      {
        resourceType: 'Observation',
        status: 'cancelled',
        code: { coding: [{ system: CATALOG, code: 'FBC' }] },
        subject: { reference: 'Patient/p1' },
        effectiveDateTime: '2026-06-04T00:00:00Z',
        dataAbsentReason: { coding: [{ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }] },
      },
    ])
  })

  it('writes nothing for a test with no typed value', () => {
    expect(extract({ [`${CATALOG}|FBC`]: { specimen: { system: 'urn:openldr:cs:local', code: 'BLD' }, rejection: null, results: [] } })).toEqual([])
  })

  it('writes nothing when the form has no testDetails field', () => {
    const model = makeSchema({ id: 'o', name: 'Order', fhirResourceType: 'ServiceRequest', fields: [makeField({ id: 'tests', displayLabel: 'Tests', fieldType: 'reference', order: 0, fhirPath: 'ServiceRequest.code' })] })
    expect(TestResultsExtractor.extract(toQuestionnaireResponse(model, { tests: [] } as never), toQuestionnaire(model), ctx)).toEqual([])
  })

  // The round trip, settled 2026-09-16: values survive a stored response, bands do not.
  it('takes the band from the context, keyed by test and parameter', () => {
    const model = order()
    const answers = { tests: [{ system: CATALOG, code: 'FBC' }], details: {
      [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
        { param: { system: PARAM, code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL' },
      ] },
    } } as never
    const testBands = new Map([[`${CATALOG}|FBC#${PARAM}|HGB`, { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }]])
    const out = TestResultsExtractor.extract(toQuestionnaireResponse(model, answers), toQuestionnaire(model), { ...ctx, testBands }) as any[]
    expect(out[0].referenceRange).toEqual([{ low: { value: 12, unit: 'g/dL' }, high: { value: 15, unit: 'g/dL' } }])
  })

  it('writes the value with no range when the context carries no band, as a replayed response does', () => {
    const model = order()
    const answers = { tests: [{ system: CATALOG, code: 'FBC' }], details: {
      [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
        { param: { system: PARAM, code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL' },
      ] },
    } } as never
    const out = TestResultsExtractor.extract(toQuestionnaireResponse(model, answers), toQuestionnaire(model), ctx) as any[]
    expect(out[0].valueQuantity).toEqual({ value: 11.2, unit: 'g/dL' })
    expect(out[0].referenceRange).toBeUndefined()
  })
})
```

Add `TestResultsExtractor` to this file's import from `./extract/extract` if it is re-exported there, otherwise import it from `./extract/test-results`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/forms && npx vitest run src/extraction.test.ts --testTimeout 30000`

Expected: FAIL. The extractor does not exist. The S4 tests in the same file still PASS.

- [ ] **Step 3: Write the extractor**

Create `packages/forms/src/extract/test-results.ts`:

```ts
import type { FhirResource, Observation, QuestionnaireResponse, Questionnaire } from 'fhir/r4'
import type { FormSchema } from '../schema/form-schema'
import { parseTestDetails, type TestDetail, type TypedResult } from '../test-details'
import type { ExtractionContext, ResourceExtractor } from './extract'

// Bench result entry (docs/superpowers/specs/2026-09-16-bench-result-entry-design.md, 5).
//
// One Observation per typed result, and one cancelled Observation carrying the reason for a rejected
// test. The reference range is the band the SERVER chose when the sheet asked for parameters, which
// travels inside the answer: this extractor has no catalog and must not guess one.

function valueOf(result: TypedResult): Partial<Observation> {
  if (result.resultType === 'numeric' && typeof result.value === 'number') {
    return { valueQuantity: { value: result.value, ...(result.unit ? { unit: result.unit } : {}) } }
  }
  if (result.resultType === 'coded' && result.value && typeof result.value === 'object') {
    return { valueCodeableConcept: { coding: [result.value as never] } }
  }
  if (typeof result.value === 'string') return { valueString: result.value }
  return {}
}

function rangeOf(result: TypedResult, key: string, ctx: ExtractionContext): Partial<Observation> {
  // The band never survives a QuestionnaireResponse answer, so the forms route puts it in the
  // context (settled 2026-09-16). A response replayed through ingest carries no context and so gets
  // no referenceRange, which is correct: the band is reference data the catalog owns, not something
  // the bench typed.
  const band = ctx.testBands?.get(`${key}#${result.param.system}|${result.param.code}`) ?? result.band
  if (!band || (band.low === null && band.high === null)) return {}
  const unit = band.unit ?? result.unit ?? undefined
  return {
    referenceRange: [{
      ...(band.low !== null ? { low: { value: band.low, ...(unit ? { unit } : {}) } } : {}),
      ...(band.high !== null ? { high: { value: band.high, ...(unit ? { unit } : {}) } } : {}),
    }],
  }
}

function observationsFor(key: string, detail: TestDetail, ctx: ExtractionContext): Observation[] {
  const base = {
    resourceType: 'Observation' as const,
    subject: ctx.subject ?? { display: 'Unknown subject' },
    ...(ctx.authored ? { effectiveDateTime: ctx.authored } : {}),
  }
  if (detail.rejection) {
    const [system, code] = key.split('|')
    return [{
      ...base,
      status: 'cancelled',
      code: { coding: [{ system, code }] },
      dataAbsentReason: { coding: [detail.rejection as never] },
    } as Observation]
  }
  return detail.results
    .filter((result) => result.value !== null)
    .map((result) => ({
      ...base,
      status: 'final',
      code: { coding: [{ system: result.param.system, code: result.param.code }] },
      ...valueOf(result),
      ...rangeOf(result, key, ctx),
    }) as Observation)
}

export const TestResultsExtractor: ResourceExtractor = {
  canExtract(model: FormSchema): boolean {
    return model.fields.some((field) => field.fieldType === 'testDetails')
  },
  extract(response: QuestionnaireResponse, _questionnaire: Questionnaire, ctx: ExtractionContext): FhirResource[] {
    const answer = parseTestDetails(readTestDetails(response))
    return Object.entries(answer).flatMap(([key, detail]) => observationsFor(key, detail, ctx))
  },
}

/** Rebuild the answer from the nested items the response carries (test-details.ts writes them). */
function readTestDetails(response: QuestionnaireResponse): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const walk = (items: QuestionnaireResponse['item']): void => {
    for (const item of items ?? []) {
      if (item.linkId.includes('|') && item.item) {
        const detail: { specimen: unknown; rejection: unknown; results: unknown[] } = { specimen: null, rejection: null, results: [] }
        for (const child of item.item) {
          const suffix = child.linkId.slice(item.linkId.length + 1)
          const answer = child.answer?.[0]
          if (suffix === 'specimen') detail.specimen = answer?.valueCoding
          else if (suffix === 'rejection') detail.rejection = answer?.valueCoding
          else if (answer) {
            const [system, code] = suffix.split('|')
            if (answer.valueQuantity !== undefined) {
              detail.results.push({ param: { system, code }, resultType: 'numeric', value: answer.valueQuantity.value, unit: answer.valueQuantity.unit })
            } else if (answer.valueCoding !== undefined) {
              detail.results.push({ param: { system, code }, resultType: 'coded', value: answer.valueCoding })
            } else if (answer.valueString !== undefined) {
              detail.results.push({ param: { system, code }, resultType: 'text', value: answer.valueString })
            }
          }
        }
        out[item.linkId] = detail
      }
      if (item.item) walk(item.item)
    }
  }
  walk(response.item)
  return out
}
```

Add `testBands` to `ExtractionContext` in `packages/forms/src/extract/extract.ts`, beside S4's `codingBefore`:

```ts
  /**
   * For a result coded `testKey#paramSystem|paramCode`, the reference band that applied when it was
   * typed. A QuestionnaireResponse answer has nowhere to carry it, so the forms route supplies it
   * (bench result entry). A replayed response carries none, and the Observation then has no
   * referenceRange.
   */
  testBands?: ReadonlyMap<string, ResultBand>
```

- [ ] **Step 4: The forms route supplies the bands**

In `apps/server/src/forms-routes.ts`, directly after S4's `codingBefore` lines, add:

```ts
    const testBands = testBandsFrom(f.schema, p.data.answers);
    if (testBands.size > 0) extractionContext.testBands = testBands;
```

and beside `catalogCodingsBefore`:

```ts
/**
 * The band each typed result was measured against, keyed the way the extractor reads it. A
 * QuestionnaireResponse answer has nowhere to carry a reference band, so it travels in the
 * extraction context instead (settled 2026-09-16). The bands were chosen by the server when the
 * sheet asked for parameters, so nothing is recomputed here.
 */
function testBandsFrom(schema: FormSchema, answers: Record<string, unknown>): Map<string, ResultBand> {
  const out = new Map<string, ResultBand>();
  for (const field of schema.fields) {
    if (field.fieldType !== 'testDetails') continue;
    for (const [testKey, detail] of Object.entries(parseTestDetails(answers[field.id]))) {
      for (const result of detail.results) {
        if (result.band) out.set(`${testKey}#${result.param.system}|${result.param.code}`, result.band);
      }
    }
  }
  return out;
}
```

Import `parseTestDetails` from `@openldr/forms` and `ResultBand` from `@openldr/bootstrap` at the top of that file.

Add one route test in `apps/server/src/forms-routes.test.ts`, in the shape of S4's LOINC test:

```ts
  it('hands the extractor the band each result was measured against', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: resultOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        details: { 'urn:openldr:codesystem:test-catalog|FBC': { specimen: null, rejection: null, results: [
          { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
            band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null } },
        ] } },
      } },
    });

    expect(res.statusCode).toBe(201);
    const observation = runs[0].body.entry.map((e: any) => e.resource).find((r: any) => r.resourceType === 'Observation');
    expect(observation.valueQuantity).toEqual({ value: 11.2, unit: 'g/dL' });
    expect(observation.referenceRange).toEqual([{ low: { value: 12, unit: 'g/dL' }, high: { value: 15, unit: 'g/dL' } }]);
  });
```

`resultOrderSchema` is `catalogOrderSchema` from S4's tests plus the `testDetails` field, declared beside it.

- [ ] **Step 5: Register it**

In `packages/forms/src/routing.ts:42-48`:

```ts
export function extractorsForForm(model: FormSchema): ResourceExtractor[] {
  const extractors: ResourceExtractor[] = [ObservationExtractor]
  if (domainForResourceType(model.fhirResourceType) === 'requisition') {
    extractors.push(ServiceRequestExtractor, TestResultsExtractor)
  }
  return extractors
}
```

Add its import at the top of that file.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd packages/forms && npx vitest run src/extraction.test.ts src/routing.test.ts src/samples --testTimeout 30000`

Run: `cd apps/server && npx vitest run src/forms-routes.test.ts --testTimeout 30000`

Expected: PASS in both. S4's extractor and route tests do not change.

- [ ] **Step 7: Typecheck both packages, and lint the server**

Run: `cd packages/forms && npx tsc --noEmit -p . > "$TEMP/br-t7-forms.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx tsc --noEmit -p . > "$TEMP/br-t7-server.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src/forms-routes.ts > "$TEMP/br-t7-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` three times.

- [ ] **Step 8: Commit**

```bash
git add packages/forms/src/extract/test-results.ts packages/forms/src/extract/extract.ts packages/forms/src/extraction.test.ts packages/forms/src/routing.ts apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts
git commit -m "feat(forms): write an Observation for each result the bench typed" -m "A new extractor turns a testDetails answer into one final Observation per typed result, carrying the parameter's own coding and the value under the type the parameter declares. A rejected test becomes one cancelled Observation carrying the reason, and any value typed before the rejection is left out. The reference band cannot ride inside a QuestionnaireResponse answer, so the forms route passes it in the extraction context beside the LOINC codings it already passes. A response replayed through ingest keeps its values and loses its ranges, which the catalog still holds."
```

---

### Task 8: the studio asks for parameters and lists the tests

**Files:**
- Modify: `apps/studio/src/api.ts`, `api.testCatalog.test.ts`
- Create: `apps/studio/src/forms-runtime/TestDetailsField.tsx`, `.test.tsx`
- Modify: `apps/studio/src/forms-runtime/FormRuntime.tsx:579-581`, `.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: `POST /api/test-catalog/result-params` (Task 4).
- Produces: `catalogResultParams(tests, patient)` in `@/api`; `TestDetailsField` rendered for `fieldType: 'testDetails'`.

- [ ] **Step 1: Write the failing tests**

In `apps/studio/src/api.testCatalog.test.ts`, add `catalogResultParams,` to the import and append inside the describe block:

```ts
  it('asks which result parameters the chosen tests need', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ tests: [{ test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }, params: [] }] })));
    const tests = [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }];
    expect(await catalogResultParams(tests, { reference: 'Patient/p1' })).toEqual([{ test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }, params: [] }]);
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/result-params', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tests, patient: { reference: 'Patient/p1' } }),
    });
  });
```

Create `apps/studio/src/forms-runtime/TestDetailsField.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api', () => ({ catalogResultParams: vi.fn() }));
import { catalogResultParams } from '@/api';
import { TestDetailsField } from './TestDetailsField';

const CATALOG = 'urn:openldr:codesystem:test-catalog';
const tests = [
  { system: CATALOG, code: 'FBC', display: 'Full blood count' },
  { system: CATALOG, code: 'CD4', display: 'CD4 count' },
];

beforeEach(() => {
  vi.mocked(catalogResultParams).mockReset();
  vi.mocked(catalogResultParams).mockResolvedValue([
    { test: { system: CATALOG, code: 'FBC' }, params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [], unit: 'g/dL', display: 'Haemoglobin', band: null }] },
    { test: { system: CATALOG, code: 'CD4' }, params: [] },
  ]);
});

describe('TestDetailsField', () => {
  it('lists a row per chosen test, with its code and name', async () => {
    render(<TestDetailsField tests={tests} value={{}} onChange={() => {}} patient={null} />);
    await waitFor(() => expect(screen.getByText('Full blood count')).toBeInTheDocument());
    expect(screen.getByText('FBC')).toBeInTheDocument();
    expect(screen.getByText('CD4 count')).toBeInTheDocument();
  });

  it('asks the server once for the chosen tests', async () => {
    render(<TestDetailsField tests={tests} value={{}} onChange={() => {}} patient={{ reference: 'Patient/p1' }} />);
    await waitFor(() => expect(catalogResultParams).toHaveBeenCalledWith(
      [{ system: CATALOG, code: 'FBC' }, { system: CATALOG, code: 'CD4' }], { reference: 'Patient/p1' },
    ));
    expect(catalogResultParams).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when no test is chosen, and asks nothing', () => {
    render(<TestDetailsField tests={[]} value={{}} onChange={() => {}} patient={null} />);
    expect(screen.getByText(/no tests chosen/i)).toBeInTheDocument();
    expect(catalogResultParams).not.toHaveBeenCalled();
  });

  it('shows a rejected test as rejected, with its reason', async () => {
    const value = { [`${CATALOG}|FBC`]: { specimen: null, rejection: { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }, results: [] } };
    render(<TestDetailsField tests={tests} value={value} onChange={() => {}} patient={null} />);
    await waitFor(() => expect(screen.getByText('Haemolysed')).toBeInTheDocument());
  });

  it('removes a test through its row menu', async () => {
    const onRemoveTest = vi.fn();
    const user = userEvent.setup();
    render(<TestDetailsField tests={tests} value={{}} onChange={() => {}} onRemoveTest={onRemoveTest} patient={null} />);
    await waitFor(() => expect(screen.getByText('Full blood count')).toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: /actions/i })[0]);
    await user.click(await screen.findByText(/remove/i));
    expect(onRemoveTest).toHaveBeenCalledWith({ system: CATALOG, code: 'FBC' });
  });

  it('takes its chrome copy from the caller, and falls back to English', async () => {
    render(<TestDetailsField tests={[]} value={{}} onChange={() => {}} onRemoveTest={() => {}} patient={null} copy={{ empty: 'Aucun examen choisi' }} />);
    expect(screen.getByText('Aucun examen choisi')).toBeInTheDocument();
  });
});
```

Every other test in this file passes `onRemoveTest={() => {}}` as well.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/api.testCatalog.test.ts src/forms-runtime/TestDetailsField.test.tsx --testTimeout 30000`

Expected: FAIL. `catalogResultParams` is not a function, and the component does not exist.

- [ ] **Step 3: Add the client**

In `apps/studio/src/api.ts`, directly after `catalogSpecimensFor`, add:

```ts
/** The result parameters each chosen test needs, with the reference band that fits this patient.
 *  The server reads the patient itself, so no birth date travels from the browser. */
export const catalogResultParams = (
  tests: { system: string; code: string }[],
  patient: { reference: string } | null,
): Promise<CatalogTestParams[]> =>
  authFetch('/api/test-catalog/result-params', jbody({ tests, ...(patient ? { patient } : {}) }, 'POST'))
    .then((r) => okJson<{ tests: CatalogTestParams[] }>(r, 'read result parameters'))
    .then((b) => b.tests);
```

and beside the other catalog types in that file:

```ts
export interface CatalogResultBand { low: number | null; high: number | null; unit: string | null; sex: string | null; ageLow: number | null; ageHigh: number | null }
export interface CatalogResultParam {
  system: string; code: string; resultType: 'numeric' | 'coded' | 'text'; valueSetUrl: string | null;
  bands: CatalogResultBand[]; unit: string | null; display: string | null; band: CatalogResultBand | null;
}
export interface CatalogTestParams { test: { system: string; code: string }; params: CatalogResultParam[] }
```

- [ ] **Step 4: Write the row list**

Create `apps/studio/src/forms-runtime/TestDetailsField.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { catalogResultParams, type CatalogResultParam, type CatalogTestParams } from '@/api';
import type { CodingAnswer } from '@openldr/forms/pure';
import type { TestDetail, TestDetailsAnswer } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { TestDetailSheet } from './TestDetailSheet';
import { RejectSheet, type RejectReason } from './RejectSheet';

/**
 * Chrome copy. FormRuntime is schema-driven and has no i18n of its own (FormRuntime.tsx:84-92), so
 * the caller that does have one supplies these. Every key falls back to English.
 */
export interface TestDetailsCopy {
  empty?: string;
  loading?: string;
  open?: string;
  reject?: string;
  remove?: string;
  noSpecimen?: string;
  rejected?: string;
}

const EN: Required<TestDetailsCopy> = {
  empty: 'No tests chosen yet.',
  loading: 'Reading the tests',
  open: 'Open',
  reject: 'Reject with reason',
  remove: 'Remove from order',
  noSpecimen: 'Specimen type not set',
  rejected: 'Rejected',
};

const keyOf = (c: { system: string; code: string }): string => `${c.system}|${c.code}`;
const EMPTY_DETAIL: TestDetail = { specimen: null, rejection: null, results: [] };

export function TestDetailsField({ tests, value, onChange, onRemoveTest, patient, copy }: {
  tests: CodingAnswer[];
  value: TestDetailsAnswer;
  onChange: (value: TestDetailsAnswer) => void;
  /** Removing a test drops it from the Tests answer too, which this field does not own. */
  onRemoveTest: (test: { system: string; code: string }) => void;
  patient: { reference: string } | null;
  copy?: TestDetailsCopy;
}): JSX.Element {
  const t = { ...EN, ...(copy ?? {}) };
  const [params, setParams] = useState<CatalogTestParams[]>([]);
  const [reasons, setReasons] = useState<{ order: RejectReason[]; test: RejectReason[] }>({ order: [], test: [] });
  const [busy, setBusy] = useState(false);
  const [openTest, setOpenTest] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);

  // Keyed on the chosen codes, not the array, which is new on every render. Same shape as the
  // narrowing effect S4 added to ReferencePicker.
  const testsKey = tests.map(keyOf).join('\n');
  useEffect(() => {
    if (!testsKey) { setParams([]); return; }
    let cancelled = false;
    setBusy(true);
    catalogResultParams(tests.map(({ system, code }) => ({ system, code })), patient)
      .then((answer) => { if (!cancelled) { setParams(answer.tests); setReasons(answer.rejectReasons); } })
      .catch(() => { if (!cancelled) setParams([]); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testsKey, patient?.reference]);

  if (tests.length === 0) return <StripedEmpty className="min-h-[8rem]"><span className="text-sm text-muted-foreground">{t.empty}</span></StripedEmpty>;
  if (busy) return <LoadingState className="min-h-[8rem]" label={t.loading} />;

  const paramsFor = (test: CodingAnswer): CatalogResultParam[] =>
    params.find((p) => keyOf(p.test) === keyOf(test))?.params ?? [];
  const detailFor = (test: CodingAnswer): TestDetail => value[keyOf(test)] ?? EMPTY_DETAIL;
  const write = (test: CodingAnswer, detail: TestDetail): void => onChange({ ...value, [keyOf(test)]: detail });

  const stateLine = (test: CodingAnswer): string => {
    const detail = detailFor(test);
    if (detail.rejection) return `${t.rejected}: ${detail.rejection.display ?? detail.rejection.code}`;
    return detail.specimen ? (detail.specimen.display ?? detail.specimen.code) : t.noSpecimen;
  };

  const open = tests.find((test) => keyOf(test) === openTest);
  const reject = tests.find((test) => keyOf(test) === rejecting);

  return (
    <div className="rounded-md border border-border">
      {tests.map((test) => (
        <div key={keyOf(test)} className="flex items-start gap-3 border-b border-border p-3 last:border-b-0">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenTest(keyOf(test))}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs">{test.code}</span>
              <span className="text-sm font-medium">{test.display ?? test.code}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{stateLine(test)}</div>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${test.display ?? test.code}`}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setOpenTest(keyOf(test))}>{t.open}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRejecting(keyOf(test))}>{t.reject}</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onRemoveTest({ system: test.system, code: test.code })}>
                {t.remove}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}

      {open && (
        <TestDetailSheet
          test={open}
          params={paramsFor(open)}
          detail={detailFor(open)}
          onChange={(detail) => write(open, detail)}
          onClose={() => setOpenTest(null)}
        />
      )}
      {reject && (
        <RejectSheet
          level="test"
          reasons={reasons.test}
          onReject={(reason) => { write(reject, { ...detailFor(reject), rejection: reason }); setRejecting(null); }}
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  );
}
```

`TestDetail` and `TestDetailsAnswer` come from `@openldr/forms/pure`, so add them to that entry point's exports in Task 6 if they are not already there.

- [ ] **Step 5: Render it from the runtime**

In `apps/studio/src/forms-runtime/FormRuntime.tsx`, add a case to `FieldControl` beside the reference case:

```tsx
      case 'testDetails':
        return (
          <TestDetailsField
            tests={codingsIn(dependsOnValue)}
            value={(value ?? {}) as TestDetailsAnswer}
            onChange={(v) => onChange(v)}
            onRemoveTest={(test) => onRemoveDependsOn?.(test)}
            patient={patient ?? null}
            copy={testDetailsCopy}
          />
        );
```

`FieldControl` gains three props for this, threaded from `FieldRow` exactly as `dependsOnValue` is: `onRemoveDependsOn?: (coding: { system: string; code: string }) => void`, `patient?: { reference: string } | null`, and `testDetailsCopy?: TestDetailsCopy`.

In `FieldRow`, pass them:

```tsx
          onRemoveDependsOn={field.referenceDependsOn
            ? (coding) => {
                const current = Array.isArray(answers[field.referenceDependsOn!]) ? (answers[field.referenceDependsOn!] as CodingAnswer[]) : [];
                onChange(field.referenceDependsOn!, current.filter((c) => c.system !== coding.system || c.code !== coding.code));
              }
            : undefined}
          patient={subjectAnswer(schema, answers)}
          testDetailsCopy={testDetailsCopy}
```

and beside `FieldControl` in the same file:

```tsx
/** The answer of the field bound to ServiceRequest.subject, as a reference the server can read. */
function subjectAnswer(schema: FormSchema, answers: RuntimeAnswers): { reference: string } | null {
  const field = schema.fields.find((f) => f.fhirPath === 'ServiceRequest.subject');
  const value = field ? answers[field.id] : undefined;
  return isEntityAnswer(value) ? { reference: value.reference } : null;
}
```

`FormRuntime` itself takes `testDetailsCopy?: TestDetailsCopy` beside `suggestCopy`, with the same doc comment reasoning: the runtime has no i18n, so the caller supplies the chrome.

- [ ] **Step 6: Translate the chrome at the caller**

`FormCapture.tsx` is the page with an i18n context, so it builds the copy and passes it down:

```tsx
  const testDetailsCopy = {
    empty: t('capture.tests.empty'),
    loading: t('capture.tests.loading'),
    open: t('capture.tests.open'),
    reject: t('capture.tests.reject'),
    remove: t('capture.tests.remove'),
    noSpecimen: t('capture.tests.noSpecimen'),
    rejected: t('capture.tests.rejected'),
  };
```

Add those seven keys to `en.ts`, `fr.ts` and `pt.ts` together. A missing key renders as literal braces, so all three land in this commit. The English values are the defaults in `TestDetailsField`, so the field still reads correctly anywhere that passes no copy, such as the builder preview.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/api.testCatalog.test.ts src/forms-runtime --testTimeout 30000`

Expected: PASS, every test in those files.

- [ ] **Step 8: Typecheck the package**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/br-t8-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.testCatalog.test.ts apps/studio/src/forms-runtime/TestDetailsField.tsx apps/studio/src/forms-runtime/TestDetailsField.test.tsx apps/studio/src/forms-runtime/FormRuntime.tsx apps/studio/src/forms-runtime/FormRuntime.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): list each test chosen on an order, with its state" -m "A testDetails field renders one row per chosen test, showing its code, name, category when mapped, and whether a specimen is set or the test was rejected. It asks the server once for the parameters and bands the chosen tests need, and every row action lives in its own dots menu."
```

---

### Task 9: the result sheet

**Files:**
- Create: `apps/studio/src/forms-runtime/TestDetailSheet.tsx`, `.test.tsx`
- Create: `apps/studio/src/forms-runtime/RejectSheet.tsx`, `.test.tsx`
- Modify: `apps/studio/src/forms-runtime/TestDetailsField.tsx`, `.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: `CatalogResultParam`, `catalogSpecimensFor` (S4), `TestDetailsAnswer` (Task 6).
- Produces: `TestDetailSheet`, `RejectSheet`.

- [ ] **Step 1: Write the failing tests**

Create `apps/studio/src/forms-runtime/TestDetailSheet.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api', () => ({ catalogSpecimensFor: vi.fn(), expandValueSetByUrl: vi.fn() }));
import { catalogSpecimensFor, expandValueSetByUrl } from '@/api';
import { TestDetailSheet } from './TestDetailSheet';

const test = { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC', display: 'Full blood count' };
const numeric = { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null, bands: [], unit: 'g/dL', display: 'Haemoglobin',
  band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null } };
const coded = { system: 'urn:openldr:default_result', code: 'MRDT', resultType: 'coded' as const, valueSetUrl: 'urn:openldr:valueset:rdt', bands: [], unit: null, display: 'Malaria RDT', band: null };
const text = { system: 'urn:openldr:default_result', code: 'NOTE', resultType: 'text' as const, valueSetUrl: null, bands: [], unit: null, display: 'Note', band: null };

beforeEach(() => {
  vi.mocked(catalogSpecimensFor).mockReset();
  vi.mocked(catalogSpecimensFor).mockResolvedValue([{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }]);
  vi.mocked(expandValueSetByUrl).mockReset();
  vi.mocked(expandValueSetByUrl).mockResolvedValue([{ system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' }]);
});

describe('TestDetailSheet', () => {
  const detail = { specimen: null, rejection: null, results: [] };

  it('shows one input per result parameter, by type', async () => {
    render(<TestDetailSheet test={test} params={[numeric, coded, text]} detail={detail} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Haemoglobin')).toBeInTheDocument());
    expect(screen.getByLabelText('Malaria RDT')).toBeInTheDocument();
    expect(screen.getByLabelText('Note')).toBeInTheDocument();
  });

  it('shows the matched band as text, and the unit beside the input', async () => {
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('12 to 15 g/dL')).toBeInTheDocument());
  });

  it('flags a value outside the band without refusing it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} onChange={onChange} onClose={() => {}} />);
    await user.type(screen.getByLabelText('Haemoglobin'), '11.2');
    await waitFor(() => expect(screen.getByText(/below 12/i)).toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
  });

  it('shows no flag for a value inside the band', async () => {
    const user = userEvent.setup();
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} onChange={() => {}} onClose={() => {}} />);
    await user.type(screen.getByLabelText('Haemoglobin'), '13');
    await waitFor(() => expect(screen.queryByText(/below|above/i)).toBeNull());
  });

  it('shows no range line when no band matched', async () => {
    render(<TestDetailSheet test={test} params={[{ ...numeric, band: null }]} detail={detail} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Haemoglobin')).toBeInTheDocument());
    expect(screen.queryByText(/to .* g\/dL/)).toBeNull();
  });

  it('offers only the specimens the chosen test accepts', async () => {
    render(<TestDetailSheet test={test} params={[]} detail={detail} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(catalogSpecimensFor).toHaveBeenCalledWith([{ system: test.system, code: test.code }]));
  });
});
```

Create `apps/studio/src/forms-runtime/RejectSheet.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RejectSheet } from './RejectSheet';

const reasons = [
  { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' },
  { system: 'urn:openldr:cs:reject-test', code: 'QNS', display: 'Insufficient volume' },
];

describe('RejectSheet', () => {
  it('offers the reasons it was given, and names no value set of its own', async () => {
    render(<RejectSheet level="test" reasons={reasons} onReject={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('Haemolysed')).toBeInTheDocument();
    expect(screen.getByText('Insufficient volume')).toBeInTheDocument();
  });

  it('hands back the chosen reason as a coding', async () => {
    const onReject = vi.fn();
    const user = userEvent.setup();
    render(<RejectSheet level="test" reasons={reasons} onReject={onReject} onClose={() => {}} />);
    await user.click(await screen.findByText('Haemolysed'));
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(onReject).toHaveBeenCalledWith({ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' });
  });

  it('refuses to reject with no reason chosen', async () => {
    const onReject = vi.fn();
    const user = userEvent.setup();
    render(<RejectSheet level="test" reasons={reasons} onReject={onReject} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(onReject).not.toHaveBeenCalled();
    expect(screen.getByText(/choose a reason/i)).toBeInTheDocument();
  });

  it('clears the message as soon as a reason is chosen', async () => {
    const user = userEvent.setup();
    render(<RejectSheet level="test" reasons={reasons} onReject={() => {}} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    await user.click(screen.getByText('Haemolysed'));
    expect(screen.queryByText(/choose a reason/i)).toBeNull();
  });

  it('shows an empty state when the server offered no reasons', () => {
    render(<RejectSheet level="order" reasons={[]} onReject={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/no reasons/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/forms-runtime/TestDetailSheet.test.tsx src/forms-runtime/RejectSheet.test.tsx --testTimeout 30000`

Expected: FAIL. Neither component exists.

- [ ] **Step 3: Write the reject sheet**

Create `apps/studio/src/forms-runtime/RejectSheet.tsx`:

```tsx
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { cn } from '@/lib/utils';

export interface RejectReason { system: string; code: string; display: string | null }

/**
 * The reasons arrive as a prop, expanded by the server (test-catalog-routes.ts). This component
 * names no value set: the studio must never carry clinical vocabulary (AGENTS.md section 8).
 */
export function RejectSheet({ level, reasons, onReject, onClose, copy }: {
  level: 'order' | 'test';
  reasons: RejectReason[];
  onReject: (reason: RejectReason) => void;
  onClose: () => void;
  copy?: { title?: string; hint?: string; reject?: string; none?: string; choose?: string };
}): JSX.Element {
  const t = {
    title: level === 'order' ? 'Reject this order' : 'Reject this test',
    hint: 'The reason is stored with the order and reaches the lab record.',
    reject: 'Reject',
    none: 'No reasons are configured.',
    choose: 'Choose a reason first',
    ...(copy ?? {}),
  };
  const [chosen, setChosen] = useState<RejectReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="flex flex-row items-start justify-between gap-3 p-6 pb-4">
          <div>
            <SheetTitle>{t.title}</SheetTitle>
            <SheetDescription>{t.hint}</SheetDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Reject actions"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => { if (!chosen) { setError(t.choose); return; } onReject(chosen); }}
              >
                {t.reject}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SheetHeader>

        <div className="px-6 pb-6">
          {reasons.length === 0 ? (
            <StripedEmpty className="min-h-[8rem]"><span className="text-sm text-muted-foreground">{t.none}</span></StripedEmpty>
          ) : (
            <div className="rounded-md border border-border">
              {reasons.map((reason) => (
                <button
                  key={`${reason.system}|${reason.code}`}
                  type="button"
                  className={cn('block w-full border-b border-border p-3 text-left text-sm last:border-b-0 hover:bg-accent',
                    chosen?.code === reason.code && 'bg-accent')}
                  onClick={() => { setChosen(reason); setError(null); }}
                >
                  <span>{reason.display ?? reason.code}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{reason.code}</span>
                </button>
              ))}
            </div>
          )}
          {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
          <Button className="mt-4" variant="outline" onClick={() => { if (!chosen) { setError(t.choose); return; } onReject(chosen); }}>
            {t.reject}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

The header menu carries the action per AGENTS.md section 5. The button below it is the same action, kept because a reject sheet with one action and no visible control reads as broken on a phone; the operator approved the same shape for the import wizard in S3.

- [ ] **Step 4: Write the result sheet**

Create `apps/studio/src/forms-runtime/TestDetailSheet.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { catalogSpecimensFor, expandValueSetByUrl, type CatalogResultParam } from '@/api';
import type { CodingAnswer } from '@openldr/forms/pure';
import type { ResultCoding, TestDetail, TypedResult } from '@openldr/forms/pure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';

const keyOf = (c: { system: string; code: string }): string => `${c.system}|${c.code}`;

/** "12 to 15 g/dL", "12 or more g/dL", "up to 15 g/dL". Null when no band matched this patient. */
function bandText(param: CatalogResultParam): string | null {
  const band = param.band;
  if (!band || (band.low === null && band.high === null)) return null;
  const unit = band.unit ?? param.unit ?? '';
  const range = band.low !== null && band.high !== null ? `${band.low} to ${band.high}`
    : band.low !== null ? `${band.low} or more` : `up to ${band.high}`;
  return unit ? `${range} ${unit}` : range;
}

/** The flag beside a numeric input. Never refuses the value: the bench decides, not the band. */
function flagFor(param: CatalogResultParam, value: number | null): string | null {
  const band = param.band;
  if (!band || value === null) return null;
  if (band.low !== null && value < band.low) return `below ${band.low}`;
  if (band.high !== null && value > band.high) return `above ${band.high}`;
  return null;
}

export function TestDetailSheet({ test, params, detail, onChange, onClose }: {
  test: CodingAnswer;
  params: CatalogResultParam[];
  detail: TestDetail;
  onChange: (detail: TestDetail) => void;
  onClose: () => void;
}): JSX.Element {
  const [specimens, setSpecimens] = useState<ResultCoding[]>([]);
  const [codedOptions, setCodedOptions] = useState<Record<string, ResultCoding[]>>({});

  useEffect(() => {
    let cancelled = false;
    catalogSpecimensFor([{ system: test.system, code: test.code }])
      .then((rows) => { if (!cancelled) setSpecimens(rows); })
      .catch(() => { if (!cancelled) setSpecimens([]); });
    return () => { cancelled = true; };
  }, [test.system, test.code]);

  // A coded parameter names the ValueSet its answers come from, and the server put that url in the
  // parameter. The studio still names no vocabulary of its own.
  const codedUrls = useMemo(
    () => params.filter((p) => p.resultType === 'coded' && p.valueSetUrl).map((p) => [keyOf(p), p.valueSetUrl!] as const),
    [params],
  );
  useEffect(() => {
    let cancelled = false;
    Promise.all(codedUrls.map(async ([key, url]) => [key, await expandValueSetByUrl(url).catch(() => [])] as const))
      .then((pairs) => { if (!cancelled) setCodedOptions(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [codedUrls]);

  const resultFor = (param: CatalogResultParam): TypedResult | undefined =>
    detail.results.find((r) => keyOf(r.param) === keyOf(param));

  const writeResult = (param: CatalogResultParam, value: TypedResult['value']): void => {
    const next: TypedResult = {
      param: { system: param.system, code: param.code },
      resultType: param.resultType,
      value,
      ...(param.unit ? { unit: param.unit } : {}),
      ...(param.band ? { band: param.band } : {}),
    };
    const others = detail.results.filter((r) => keyOf(r.param) !== keyOf(param));
    onChange({ ...detail, results: [...others, next] });
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs">{test.code}</span>
            <span>{test.display ?? test.code}</span>
          </SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 px-6 pb-6">
          <Label htmlFor="specimen-type">Specimen type</Label>
          <Select
            value={detail.specimen ? keyOf(detail.specimen) : undefined}
            onValueChange={(v) => onChange({ ...detail, specimen: specimens.find((s) => keyOf(s) === v) ?? null })}
          >
            <SelectTrigger id="specimen-type"><SelectValue placeholder="Choose a specimen" /></SelectTrigger>
            <SelectContent>
              {specimens.map((s) => <SelectItem key={keyOf(s)} value={keyOf(s)}>{s.display ?? s.code}</SelectItem>)}
            </SelectContent>
          </Select>

          {params.map((param) => {
            const current = resultFor(param);
            const label = param.display ?? param.code;
            const range = bandText(param);
            if (param.resultType === 'numeric') {
              const typed = typeof current?.value === 'number' ? current.value : null;
              const flag = flagFor(param, typed);
              return (
                <div key={keyOf(param)} className="col-span-2 grid grid-cols-[auto_1fr] items-center gap-x-4">
                  <Label htmlFor={keyOf(param)}>{label}</Label>
                  <div>
                    <div className="flex items-center gap-2">
                      <Input
                        id={keyOf(param)}
                        inputMode="decimal"
                        className="w-32"
                        value={typed === null ? '' : String(typed)}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const next = raw === '' ? null : Number(raw);
                          writeResult(param, next !== null && Number.isFinite(next) ? next : null);
                        }}
                      />
                      {param.unit && <span className="text-sm text-muted-foreground">{param.unit}</span>}
                      {flag && <span className="rounded bg-warning/15 px-1.5 py-0.5 text-xs text-warning-foreground">{flag}</span>}
                    </div>
                    {range && <p className="mt-1 text-xs text-muted-foreground">{range}</p>}
                  </div>
                </div>
              );
            }
            if (param.resultType === 'coded') {
              const options = codedOptions[keyOf(param)] ?? [];
              const chosen = current?.value && typeof current.value === 'object' ? keyOf(current.value as ResultCoding) : undefined;
              return (
                <div key={keyOf(param)} className="col-span-2 grid grid-cols-[auto_1fr] items-center gap-x-4">
                  <Label htmlFor={keyOf(param)}>{label}</Label>
                  <Select value={chosen} onValueChange={(v) => writeResult(param, options.find((o) => keyOf(o) === v) ?? null)}>
                    <SelectTrigger id={keyOf(param)}><SelectValue placeholder="Choose a result" /></SelectTrigger>
                    <SelectContent>
                      {options.map((o) => <SelectItem key={keyOf(o)} value={keyOf(o)}>{o.display ?? o.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              );
            }
            return (
              <div key={keyOf(param)} className="col-span-2 grid grid-cols-[auto_1fr] items-start gap-x-4">
                <Label htmlFor={keyOf(param)}>{label}</Label>
                <Textarea
                  id={keyOf(param)}
                  rows={2}
                  value={typeof current?.value === 'string' ? current.value : ''}
                  onChange={(e) => writeResult(param, e.target.value === '' ? null : e.target.value)}
                />
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

Add the client this needs to `apps/studio/src/api.ts`, beside `catalogResultParams`:

```ts
/** Expand a ValueSet by url, through the FHIR operation (apps/server/src/terminology-routes.ts:25).
 *  The url always comes from the server, never from a literal in the studio. */
export const expandValueSetByUrl = (url: string): Promise<{ system: string; code: string; display: string | null }[]> =>
  authFetch(`/api/terminology/ValueSet/$expand?url=${encodeURIComponent(url)}&count=500`)
    .then((r) => okJson<{ expansion?: { contains?: { system?: string; code?: string; display?: string }[] } }>(r, 'expand value set'))
    .then((vs) => (vs.expansion?.contains ?? []).map((c) => ({ system: c.system ?? '', code: c.code ?? '', display: c.display ?? null })));
```

Add a test for it in `api.testCatalog.test.ts` in the same shape as the others: it calls that url with the url encoded, and maps the expansion to codings.

The sheet's tests mock `@/api` with both `catalogSpecimensFor` and `expandValueSetByUrl`.

- [ ] **Step 5: Wire both into the row list**

In `TestDetailsField.tsx` the wiring is already written in Task 8: the row opens `TestDetailSheet`, and the row menu's reject opens `RejectSheet` at test level with `reasons.test`. Rejecting writes the coding into that test's detail and clears nothing the operator typed, so a mis-click loses no numbers.

The order-level reject belongs to the page, not this field. `FormCapture.tsx` opens `RejectSheet` at order level from its header `⋯` menu with `reasons.order`, and writes the coding into the form's own order-rejection answer.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/forms-runtime --testTimeout 30000`

Expected: PASS, every test in the folder.

- [ ] **Step 7: Typecheck the package**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/br-t9-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 8: Check the sheet at 375px**

Use `resize_window` at 375x812 against the built preview once this merges. In this task, assert instead that the parameter grid wraps: a test that renders six parameters and checks the sheet's own container has no `min-width` beyond the viewport. Note in the report that only a real phone can confirm the bottom edge.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/forms-runtime/TestDetailSheet.tsx apps/studio/src/forms-runtime/TestDetailSheet.test.tsx apps/studio/src/forms-runtime/RejectSheet.tsx apps/studio/src/forms-runtime/RejectSheet.test.tsx apps/studio/src/forms-runtime/TestDetailsField.tsx apps/studio/src/forms-runtime/TestDetailsField.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): type a result for each test, with its range in view" -m "Opening a test shows a sheet with the specimen picker, the reference range the server matched to this patient, and one input per result parameter drawn from its type. A value outside the range is flagged beside the input and never refused. Rejecting asks for a coded reason, at test level from the row and at order level from the page."
```

---

### Task 10: authoring parameters on the Test catalog page

**Files:**
- Modify: `apps/studio/src/test-catalog/TestSheet.tsx`, `.test.tsx`
- Modify: `apps/studio/src/api.ts` (the save type gains `resultParams`)
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: `PUT /api/test-catalog/:code` with `resultParams` (Task 4), `RESULT_PARAM_VALUE_SET` through the picker.

- [ ] **Step 1: Write the failing tests**

Append to `apps/studio/src/test-catalog/TestSheet.test.tsx`:

```tsx
describe('TestSheet: result parameters', () => {
  it('lists the parameters a test already names, with their type', async () => {
    renderSheet({ test: { ...TEST, resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [] }] } });
    expect(await screen.findByText('HGB')).toBeInTheDocument();
    expect(screen.getByText('numeric')).toBeInTheDocument();
  });

  it('shows nothing but the add action when a test names none', async () => {
    renderSheet({ test: { ...TEST, resultParams: [] } });
    expect(await screen.findByText(/no result parameters/i)).toBeInTheDocument();
  });

  it('saves a parameter the operator added', async () => {
    const user = userEvent.setup();
    const { saved } = renderSheet({ test: { ...TEST, resultParams: [] } });
    await user.click(await screen.findByRole('button', { name: /add result parameter/i }));
    await user.click(await screen.findByText('HGB'));
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(saved[0].resultParams).toEqual([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [] },
    ]));
  });

  it('adds a band to a numeric parameter and keeps its order', async () => {
    const user = userEvent.setup();
    const { saved } = renderSheet({ test: { ...TEST, resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [] }] } });
    await user.click(await screen.findByRole('button', { name: /add band/i }));
    await user.type(screen.getByLabelText(/low/i), '12');
    await user.type(screen.getByLabelText(/high/i), '15');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(saved[0].resultParams[0].bands).toEqual([
      { low: 12, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null },
    ]));
  });

  it('removes a parameter through its row menu', async () => {
    const user = userEvent.setup();
    const { saved } = renderSheet({ test: { ...TEST, resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [] }] } });
    await user.click(screen.getByRole('button', { name: /parameter actions/i }));
    await user.click(await screen.findByText(/remove/i));
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(saved[0].resultParams).toEqual([]));
  });
});
```

Extend the file's `renderSheet` helper to record what `updateCatalogTest` was called with, if it does not already, and to mock the parameter picker's options.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/test-catalog/TestSheet.test.tsx --testTimeout 30000`

Expected: FAIL. The section does not exist.

- [ ] **Step 3: Extend the options payload**

The picker must not name the result-parameter value set, so the server offers its codes the way it already offers categories and specimens. In `packages/bootstrap/src/test-catalog.ts`, add to `CatalogOptions`:

```ts
  /** The result parameters a test may name, from the ValueSet migration 069 seeds. */
  resultParams: CatalogSpecimenOption[];
```

and fill it inside `options()` beside the other two:

```ts
    resultParams: await expandEntries(RESULT_PARAM_VALUE_SET),
```

Add one route test asserting `GET /api/test-catalog/options` carries them, in the shape the file's other options test uses.

- [ ] **Step 4: Add the section**

In `apps/studio/src/test-catalog/TestSheet.tsx`, add this block inside the existing grid, below the specimen rows. Each row spans both columns, because a table inside a two-column grid otherwise inherits the `auto` track's width, which is the misalignment trap S2 hit.

```tsx
        <div className="col-span-2 mt-2 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('testCatalog.resultParams.title')}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('testCatalog.resultParams.actions')}><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setPickingParam(true)}>{t('testCatalog.resultParams.add')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {draft.resultParams.length === 0 ? (
            <StripedEmpty className="mt-2 min-h-[6rem]">
              <span className="text-sm text-muted-foreground">{t('testCatalog.resultParams.none')}</span>
            </StripedEmpty>
          ) : (
            <div className="mt-2 rounded-md border border-border">
              {draft.resultParams.map((param, index) => (
                <div key={`${param.system}|${param.code}`} className="border-b border-border p-3 last:border-b-0">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{param.code}</span>
                        <span className="text-sm">{paramName(param.code)}</span>
                        <span className="text-xs text-muted-foreground">{param.resultType}</span>
                      </div>
                    </div>
                    <Select
                      value={param.resultType}
                      onValueChange={(v) => setParam(index, { ...param, resultType: v as CatalogResultParam['resultType'], bands: v === 'numeric' ? param.bands : [] })}
                    >
                      <SelectTrigger className="w-32" aria-label={t('testCatalog.resultParams.type')}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="numeric">numeric</SelectItem>
                        <SelectItem value="coded">coded</SelectItem>
                        <SelectItem value="text">text</SelectItem>
                      </SelectContent>
                    </Select>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={t('testCatalog.resultParams.rowActions')}><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {param.resultType === 'numeric' && (
                          <DropdownMenuItem onClick={() => setParam(index, { ...param, bands: [...param.bands, EMPTY_BAND] })}>
                            {t('testCatalog.resultParams.addBand')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDraft({ ...draft, resultParams: draft.resultParams.filter((_, i) => i !== index) })}
                        >
                          {t('testCatalog.resultParams.remove')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {param.resultType === 'numeric' && param.bands.length > 0 && (
                    <Table className="mt-2">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('testCatalog.resultParams.low')}</TableHead>
                          <TableHead>{t('testCatalog.resultParams.high')}</TableHead>
                          <TableHead>{t('testCatalog.resultParams.unit')}</TableHead>
                          <TableHead>{t('testCatalog.resultParams.sex')}</TableHead>
                          <TableHead>{t('testCatalog.resultParams.ageFrom')}</TableHead>
                          <TableHead>{t('testCatalog.resultParams.ageTo')}</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {param.bands.slice(bandPage * BANDS_PER_PAGE, bandPage * BANDS_PER_PAGE + BANDS_PER_PAGE).map((band, bandIndex) => (
                          <TableRow key={bandIndex}>
                            {(['low', 'high'] as const).map((edge) => (
                              <TableCell key={edge}>
                                <Input
                                  className="w-20"
                                  aria-label={t(`testCatalog.resultParams.${edge}`)}
                                  value={band[edge] === null ? '' : String(band[edge])}
                                  onChange={(e) => setBand(index, bandIndex, { ...band, [edge]: e.target.value === '' ? null : Number(e.target.value) })}
                                />
                              </TableCell>
                            ))}
                            <TableCell>
                              <Input className="w-20" aria-label={t('testCatalog.resultParams.unit')} value={band.unit ?? ''}
                                onChange={(e) => setBand(index, bandIndex, { ...band, unit: e.target.value || null })} />
                            </TableCell>
                            <TableCell>
                              <Select value={band.sex ?? 'any'} onValueChange={(v) => setBand(index, bandIndex, { ...band, sex: v === 'any' ? null : v })}>
                                <SelectTrigger className="w-28" aria-label={t('testCatalog.resultParams.sex')}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="any">{t('testCatalog.resultParams.anySex')}</SelectItem>
                                  <SelectItem value="female">female</SelectItem>
                                  <SelectItem value="male">male</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            {(['ageLow', 'ageHigh'] as const).map((edge) => (
                              <TableCell key={edge}>
                                <Input
                                  className="w-20"
                                  aria-label={t(edge === 'ageLow' ? 'testCatalog.resultParams.ageFrom' : 'testCatalog.resultParams.ageTo')}
                                  value={band[edge] === null ? '' : String(band[edge])}
                                  onChange={(e) => setBand(index, bandIndex, { ...band, [edge]: e.target.value === '' ? null : Number(e.target.value) })}
                                />
                              </TableCell>
                            ))}
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" aria-label={t('testCatalog.resultParams.removeBand')}
                                onClick={() => setParam(index, { ...param, bands: param.bands.filter((_, i) => i !== bandIndex) })}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {param.resultType === 'numeric' && param.bands.length > BANDS_PER_PAGE && (
                    <TablePagination
                      page={bandPage}
                      pageSize={BANDS_PER_PAGE}
                      total={param.bands.length}
                      onPageChange={setBandPage}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
```

with these beside the file's other helpers:

```tsx
const BANDS_PER_PAGE = 5;
const EMPTY_BAND = { low: null, high: null, unit: null, sex: null, ageLow: null, ageHigh: null };

  const paramName = (code: string): string => options.resultParams.find((p) => p.code === code)?.display ?? code;
  const setParam = (index: number, next: CatalogResultParam): void =>
    setDraft({ ...draft, resultParams: draft.resultParams.map((p, i) => (i === index ? next : p)) });
  const setBand = (paramIndex: number, bandIndex: number, next: CatalogResultBand): void => {
    const param = draft.resultParams[paramIndex];
    setParam(paramIndex, { ...param, bands: param.bands.map((b, i) => (i === bandIndex ? next : b)) });
  };
```

`toDraft` gains `resultParams: test?.resultParams ?? []`, and the `testInput` builder gains `resultParams: draft.resultParams`. `pickingParam` opens a small picker over `options.resultParams` that appends `{ system, code, resultType: 'numeric', valueSetUrl: null, bands: [] }`. Follow the specimen picker directly above it.

Match `TablePagination`'s real prop names from `components/ui/table-pagination.tsx` rather than the names above if they differ.

- [ ] **Step 5: Add the strings**

Add the `testCatalog.resultParams.*` keys used above to `en.ts`, `fr.ts` and `pt.ts` together: title, actions, rowActions, add, none, type, addBand, removeBand, remove, low, high, unit, sex, anySex, ageFrom, ageTo. This page has its own i18n context, unlike the form runtime, so the strings live in the files rather than in a copy prop.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/test-catalog --testTimeout 30000`

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: PASS in all three. The options payload changed, so the server and bootstrap tests run here too.

- [ ] **Step 7: Typecheck the three packages**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/br-t10-studio.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx tsc --noEmit -p . > "$TEMP/br-t10-server.txt" 2>&1; echo "exit=$?"`

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/br-t10-bootstrap.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` three times.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/test-catalog/TestSheet.tsx apps/studio/src/test-catalog/TestSheet.test.tsx apps/studio/src/api.ts apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts apps/server/src/test-catalog-routes.test.ts
git commit -m "feat(studio): name a test's result parameters and their reference bands" -m "The test sheet gains a result parameters section: each parameter with its type, chosen from the dictionary the server offers, and for a numeric one a table of reference bands by sex and age. Every action lives in a dots menu, and the bands table is paginated like every other table on the page."
```

---

### Task 11: migration 106 seeds the reasons and gives the Lab order its field

**Files:**
- Create: `packages/db/src/migrations/internal/106_result_entry.ts`, `.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `migrations.test.ts`, `packages/db/src/index.ts`
- Modify: `packages/forms/src/samples/forms.ts`, `forms.test.ts`

**Interfaces:**
- Produces: `ORDER_REJECT_VALUE_SET`, `TEST_REJECT_VALUE_SET`, `LAB_ORDER_RESULTS_FIELDS_SNAPSHOT`, `up`, `down`. `@openldr/db` exports `LAB_ORDER_FORM_MIGRATION_RESULT_FIELDS`.

**Re-check the number first.** Run the check from the global constraints. If 106 is taken, renumber before writing a line.

The approach copies 105 (`105_lab_order_test_catalog.ts`) exactly: the two ValueSets are seeded the way it seeds the lab test list, with no `fhir.change_log` row, and the Lab order is rewritten only when it still matches 105's shape, with a marker for `down()`.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/migrations/internal/106_result_entry.test.ts`, copying the structure of `105_lab_order_test_catalog.test.ts` (its harness is at `:13-34`) and changing:

- `LAB_ORDER_PREV_FIELDS_SNAPSHOT` is 105's `LAB_ORDER_CATALOG_FIELDS_SNAPSHOT`, and the test "the frozen copy still matches what 105 shipped" imports it from `./105_lab_order_test_catalog` to prove the literal.
- `LAB_ORDER_RESULTS_FIELDS_SNAPSHOT` adds one field after `tests`: `{ id: 'fld-ord-results', fieldType: 'testDetails', referenceDependsOn: 'tests', displayLabel: 'Results', required: false, enabled: true, order: 2, section: 'order', cardinality: { min: 0, max: '1' }, description: null }`, with every later field's `order` shifted by one.
- Both new ValueSets are asserted the way 105 asserts its own row: `immutable: false` (an operator may add a local reason), a `terminology_systems` registration, a canonical FHIR row, and no `fhir.change_log` row.
- `down()` removes both ValueSets and restores the form.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/db && npx vitest run src/migrations/internal/106_result_entry.test.ts --testTimeout 30000`

Expected: FAIL. `./106_result_entry` does not exist.

- [ ] **Step 3: Write the migration**

Copy `105_lab_order_test_catalog.ts` wholesale and change: the two ValueSet seeds (`urn:openldr:valueset:order-reject-reason` and `urn:openldr:valueset:test-reject-reason`, each with a small concept list the lab can extend), the frozen previous snapshot (105's current shape), the new snapshot with the results field, and `MARKER_KEY = '__migration106'`.

Seed each reason system's concepts in the same migration, the way 104 seeds its five categories. The starting lists are short and the operator can add to them on the Terminology page: for an order, wrong patient, unlabelled specimen and duplicate request; for a test, haemolysed, insufficient volume, clotted and wrong container.

- [ ] **Step 4: Register 106**

In `packages/db/src/migrations/internal/index.ts`, add the import after 105's and the entry after `'105_lab_order_test_catalog'`, kept last. In `migrations.test.ts:7`, add `'106_result_entry'` to the end of the manifest. In `packages/db/src/index.ts`, export the new snapshot as `LAB_ORDER_FORM_MIGRATION_RESULT_FIELDS`, keeping the four existing Lab order exports.

- [ ] **Step 5: Give the sample the same field**

In `packages/forms/src/samples/forms.ts`, add the results field to the Lab order directly after Tests, and shift the later fields' `order`. In `forms.test.ts`, repoint the snapshot test to `LAB_ORDER_FORM_MIGRATION_RESULT_FIELDS` and add 105's shape to the list in the builder-save test, so it now covers five prior shapes.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd packages/db && npx vitest run src/migrations/internal/105_lab_order_test_catalog.test.ts src/migrations/internal/106_result_entry.test.ts src/migrations/migrations.test.ts --testTimeout 30000`

Run: `cd packages/forms && npx vitest run src/samples --testTimeout 30000`

Expected: PASS in both.

- [ ] **Step 7: Typecheck both packages**

Run: `cd packages/db && npx tsc --noEmit -p . > "$TEMP/br-t11-db.txt" 2>&1; echo "exit=$?"`

Run: `cd packages/forms && npx tsc --noEmit -p . > "$TEMP/br-t11-forms.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` twice.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/internal/106_result_entry.ts packages/db/src/migrations/internal/106_result_entry.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/index.ts packages/forms/src/samples/forms.ts packages/forms/src/samples/forms.test.ts
git commit -m "feat(db): seed the rejection reasons and give the Lab order its results field" -m "Migration 106 seeds one value set of order rejection reasons and one of test rejection reasons, both the way 104 and 105 seed theirs, with no change_log row so neither syncs. It adds the results field to the shipped Lab order, rewriting only a form that still carries 105's shape, and down() restores it. The sample form follows, so it matches the migration's snapshot exactly."
```

---

### Task 12: docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/test-catalog.md`
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`
- Modify: `apps/web/src/docs/0.1.8/test-catalog.md`, `forms.md`

No new docs test. Every page exists, and `src/docs` in each app already checks they render.

- [ ] **Step 1: The in-app test catalog guide**

Append a "Result parameters" section to each of the three studio pages, saying: a test can name the parameters it yields; the parameters come from this install's result dictionary; a numeric parameter can carry reference bands by sex and age, and the band that fits the patient is the one the bench sees; a test that names none still works and asks only for a specimen.

- [ ] **Step 2: The in-app forms guide**

Add to each language: the Lab order now lists each chosen test, a test opens for its specimen and results, a test or the whole order can be rejected with a reason, and a rejected test is recorded but does not yet appear in reports.

- [ ] **Step 3: The web pages**

Add one paragraph per language to both web pages, saying the same in one paragraph each.

- [ ] **Step 4: Run the docs tests**

Run: `cd apps/studio && npx vitest run src/docs --testTimeout 30000`

Run: `cd apps/web && npx vitest run src/docs --testTimeout 30000`

Expected: PASS in both.

- [ ] **Step 5: Check the added lines for em dashes**

Run: `git diff -- apps/studio/src/docs apps/web/src/docs | grep '^+' | grep -c $'\xe2\x80\x94'`

Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/test-catalog.md apps/studio/src/docs/0.1.8/fr/test-catalog.md apps/studio/src/docs/0.1.8/pt/test-catalog.md apps/studio/src/docs/0.1.8/en/forms.md apps/studio/src/docs/0.1.8/fr/forms.md apps/studio/src/docs/0.1.8/pt/forms.md apps/web/src/docs/0.1.8/test-catalog.md apps/web/src/docs/0.1.8/forms.md
git commit -m "docs(results): document result parameters and bench entry" -m "The in-app guide and the web pages, in English, French and Portuguese, say that a test can name the result parameters it yields, that a numeric parameter carries reference bands by sex and age, that the bench types a result per parameter on the order, and that a rejected test is recorded with its reason but does not yet reach reports."
```

---

### Task 13: gate and report

**Files:** none changed.

- [ ] **Step 1: Re-check the migration number**

Run: `git fetch origin --prune; for b in $(git branch -a --format='%(refname:short)' | grep -v HEAD); do git ls-tree -r --name-only $b -- packages/db/src/migrations/internal/ | grep -E '/10[6-9]_' | sed "s|^|$b: |"; done`

Expected: only this branch's `106_result_entry.*`. Ask the operator whether a branch on the Linux machine claims 106.

- [ ] **Step 2: Run the forced gate**

Run: `pnpm turbo run typecheck --force --concurrency=4 > "$TEMP/br-gate-tc.txt" 2>&1; echo "exit=$?"`

Run: `pnpm turbo run test --force --concurrency=4 --continue > "$TEMP/br-gate-test.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src > "$TEMP/br-gate-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` three times. On a test failure, grep for `Test timed out` and `FAIL`, then re-run that package alone before blaming a change.

- [ ] **Step 3: Report, then stop**

Report to the operator:

1. The gate's three exit codes and each package's test count.
2. What each layer proves:
   - `result-params.test.ts` (pure): band matching by sex, age and both edges, and the catch-all. Not the database.
   - `test-catalog.test.ts` (pg-mem): parameters stored, cleared and refused; each test answered with its parameters, units and matched band.
   - `test-details.test.ts` and `extraction.test.ts` (pure): the answer shape, the nested response items, one Observation per typed result with its range, and a cancelled Observation for a rejected test.
   - Route tests: both wire shapes, both gates, and that the server reads the patient itself.
   - Studio tests: the row list, the sheet's three input types, the out-of-band flag, both rejection paths, and the authoring section.
   - `106_result_entry.test.ts` (pg-mem): both value sets seeded without a change_log row, the Lab order rewritten by exact match, the marker and `down()`. Not boot order: check `kysely_migration` after a real boot.
3. **HONEST NON-PROOF**, each with what would prove it:
   - A bench typing a real result, and reading the Observations back. The live check after merging would.
   - Migration 106 on a real Postgres boot against a stored Lab order.
   - The sheet at 375px on a real phone.
   - `openldr test-catalog params` against Postgres.
   - That a response replayed through ingest still yields the right Observations, minus their ranges. The route tests cover the bench path only.
   - The live check needs `AUTH_DEV_BYPASS`, the dev servers, and scratch tests and parameters switched on. Say so before starting it.
4. Anything skipped or changed from this plan, and why.

Then ask the operator before merging, pushing, or running the live check. After a merge to `main`, run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json` (AGENTS.md section 6, item 5).
