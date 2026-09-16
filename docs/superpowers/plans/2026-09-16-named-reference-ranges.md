# Named reference ranges, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** Each reference range gains a name, and the person entering results picks the range for each parameter, with a warning when the pick does not fit the patient.

**Architecture:** `ResultBand` gains `name`. The catalog service answers, for each range, whether it fits the patient, and both catalog routes send the sex choices with labels in en, fr and pt. The Test catalog editor sets name, sex, age and order. The results sheet shows a range picker per numeric parameter. The forms submit route refuses a range that is not in the catalog.

**Tech Stack:** TypeScript, Fastify, zod, Kysely on pg-mem in tests, React, Radix, vitest (jsdom for the studio).

**Spec:** `docs/superpowers/specs/2026-09-16-named-reference-ranges-design.md`. Sections 3 and 11 hold the operator's decisions.

## Global Constraints

- Work in a git worktree under `.claude/worktrees/`, never the main checkout. Leave `confident-lumiere-666963` and `peaceful-kirch-839cb2` alone.
- Stage by exact path. Never `git add <dir>`. No `Co-Authored-By` trailer.
- Commit only as these steps say. Merge or push only when the operator asks.
- New writing follows the `unslop` skill, code comments, UI copy and error messages included. No em dashes, no emoji in headings or bullets.
- Run one test file from its package: `cd <package> && npx vitest run <path> --testTimeout 30000`.
- Typecheck one package: `cd <package> && npx tsc --noEmit -p . > "$TEMP/<name>.txt" 2>&1; echo "exit=$?"`. Never read `$?` through a pipe.
- The gate is `pnpm turbo run typecheck --force --concurrency=4` and `pnpm turbo run test --force --concurrency=4 --continue`, each redirected to a file. A failure is usually a timeout. Grep for `Test timed out` and re-run that package alone.
- **No migration and no seeding.** Ranges live in the test's stored properties.
- **No clinical vocabulary in the studio** (AGENTS.md section 8). The studio names no sex code. The server sends them.
- **UI rules** (AGENTS.md section 5). Row and parameter actions go in a `⋯` `DropdownMenu`. shadcn only.
- **Every new studio string goes in `en.ts`, `fr.ts` and `pt.ts` together.** The form runtime has no i18n, so the results sheet takes its words through `TestDetailsCopy`, which `FormCapture.tsx` fills.
- **zod strips undeclared keys silently.** Every place that copies a range field by field gets `name`, and a test that fails if it is lost (spec section 6).

---

## Facts this plan rests on

Each was read on 2026-09-16 at `d881d225`.

- `ResultBand`, `toBand`, `parseResultParams` and `matchBand` live in `packages/bootstrap/src/result-params.ts:15-89`, exported at `packages/bootstrap/src/index.ts:1756-1759`.
- `checkTest` validates every catalog write (`packages/bootstrap/src/test-catalog.ts:540-572`). `options()` is at `:704-721`. `resultParamsFor` is at `:982-1014`. `TestParamsAnswer` is at `:217-220`, `CatalogOptions` at `:124-132`.
- The route's `band` zod schema and its transform are at `apps/server/src/test-catalog-routes.ts:27-48`. The result-params route is at `:290-304`.
- `testBandsFrom` copies each result's band on submit (`apps/server/src/forms-routes.ts:92-103`). Reference errors return `{ error: 'invalid answers', errors }` with `{ fieldId, label, reason }` items (`:419-428`).
- The answer's band type is `packages/forms/src/test-details.ts:20`. `parseTestDetails` copies a band object whole (`:62`). The extraction context type is `packages/forms/src/extract/extract.ts:36`. `rangeOf` writes `referenceRange` (`packages/forms/src/extract/test-results.ts:24-36`).
- The CLI's `openldr test-catalog params <code> --set <file>` reads through `parseResultParams` (`packages/cli/src/test-catalog.ts:67-91`).
- The FHIR Patient schema is a `.passthrough()` object whose `gender` is `z.enum(['male', 'female', 'other', 'unknown']).optional()` (`packages/fhir/src/resources/patient.ts:6-22`). `@openldr/bootstrap` already depends on `@openldr/fhir`.
- The Lab Technician holds `forms.view` and `forms.submit` only (`packages/rbac/src/presets.ts:52`), so the results sheet cannot read `GET /api/test-catalog/options` (gated on `terminology.view`).
- The Test catalog editor's range rows are at `apps/studio/src/test-catalog/TestSheet.tsx:300-345`. Its tests open Radix menus with `fireEvent.pointerDown` and an Enter fallback (`TestSheet.test.tsx:46-52`).
- The results sheet is `apps/studio/src/forms-runtime/TestDetailSheet.tsx`. `writeResult` stores `param.band` (`:72-81`).

## Where this plan departs from the spec

| Spec says | Plan does | Why |
|---|---|---|
| "Women 15+" as an example label | "Female 15+", the server's sex label then the age | The label is built from the words the server sends |
| Save checks: duplicate name, crossed edges | Also refuses a sex that is not one of the Patient codes | A range with any other sex can never fit anyone, silently |
| Duplicate names | Compared ignoring case | "Highland" and "highland" look like one choice to the bench |

## Known effects, not handled here

- Existing English literals in `TestDetailSheet.tsx` ("Specimen type", "below 12") stay untranslated. The new words go through copy.
- Existing range fixtures in tests gain `name: null` where they compare whole objects. That is the new shape, not a behaviour change.

---

## What changes

| File | Change |
|---|---|
| `packages/bootstrap/src/result-params.ts`, `.test.ts` | `name`, `BandFit`, `bandFit`, `SexOption`, `SEX_OPTIONS`, `bandInCatalog` |
| `packages/bootstrap/src/index.ts` | Export the new names |
| `packages/cli/src/test-catalog.test.ts` | A set file keeps a range name |
| `packages/bootstrap/src/test-catalog.ts`, `.test.ts` | Save checks, `fits`, `sexes` |
| `apps/server/src/test-catalog-routes.ts`, `.test.ts` | `name` in the zod band, `sexes` on result-params |
| `packages/forms/src/test-details.ts`, `extract/extract.ts`, `extract/test-results.ts` and tests | `name` in the band types, `referenceRange.text` |
| `apps/server/src/forms-routes.ts`, `.test.ts` | Refuse a band not in the catalog |
| `apps/studio/src/api.ts` | Types |
| `apps/studio/src/forms-runtime/rangeLabel.ts`, `.test.ts` | Create |
| `apps/studio/src/test-catalog/TestSheet.tsx`, `.test.tsx` | The range editor |
| `apps/studio/src/forms-runtime/TestDetailSheet.tsx`, `TestDetailsField.tsx` and tests, `pages/FormCapture.tsx` | The range picker |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | New strings |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/{test-catalog,forms}.md`, `apps/web/src/docs/0.1.8/{test-catalog,forms}.md` | Docs |

---

### Task 1: the range shape, fit and sex choices

**Files:**
- Modify: `packages/bootstrap/src/result-params.ts`
- Modify: `packages/bootstrap/src/result-params.test.ts`
- Modify: `packages/bootstrap/src/index.ts:1756-1759`
- Modify: `packages/cli/src/test-catalog.test.ts`

**Interfaces:**
- Produces: `ResultBand.name: string | null`; `type BandFit = 'yes' | 'no' | 'unknown'`; `bandFit(band: ResultBand, patient: { sex?: string | null; ageYears?: number | null }): BandFit`; `interface SexOption { code: string; labels: Record<string, string> }`; `SEX_OPTIONS: SexOption[]`; `bandInCatalog(band: unknown, bands: ResultBand[]): boolean`.

- [ ] **Step 1: Write the failing tests**

In `packages/bootstrap/src/result-params.test.ts`, change the import to:

```ts
import { bandFit, bandInCatalog, matchBand, parseResultParams, SEX_OPTIONS, type ResultBand } from './result-params';
```

Change the `band` helper on line 4 to include a name:

```ts
const band = (b: Partial<ResultBand>): ResultBand => ({ name: null, low: null, high: null, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null, ...b });
```

In the first test, the expected band on line 12 becomes:

```ts
        bands: [{ name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: null, ageHigh: null }] },
```

Append at the end of the file:

```ts
describe('result parameters: a range name', () => {
  it('keeps a name, trimmed, and reads a blank one as none', () => {
    const [param] = parseResultParams([{
      system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric',
      bands: [{ name: '  Highland women ', low: 12, high: 16 }, { name: '   ', low: 11, high: 15 }],
    }]);
    expect(param.bands.map((b) => b.name)).toEqual(['Highland women', null]);
  });
});

describe('result parameters: whether a range fits a patient', () => {
  it('answers yes when sex and age both fit, or the range names neither', () => {
    expect(bandFit(band({ sex: 'female', ageLow: 15 }), { sex: 'female', ageYears: 30 })).toBe('yes');
    expect(bandFit(band({}), { sex: null, ageYears: null })).toBe('yes');
  });

  it('answers no when the sex or the age is outside the range', () => {
    expect(bandFit(band({ sex: 'male' }), { sex: 'female', ageYears: 30 })).toBe('no');
    expect(bandFit(band({ ageLow: 15 }), { sex: 'female', ageYears: 9 })).toBe('no');
    expect(bandFit(band({ ageHigh: 5 }), { sex: 'female', ageYears: 9 })).toBe('no');
  });

  it('answers unknown when the range names a fact the patient record lacks', () => {
    expect(bandFit(band({ sex: 'female' }), { sex: null, ageYears: 30 })).toBe('unknown');
    expect(bandFit(band({ ageLow: 15 }), { sex: 'female', ageYears: null })).toBe('unknown');
  });

  it('answers no over unknown when one fact is missing and the other is outside', () => {
    expect(bandFit(band({ sex: 'male', ageLow: 15 }), { sex: 'female', ageYears: null })).toBe('no');
  });
});

describe('result parameters: the sex choices', () => {
  it('offers the Patient codes, each with a label in en, fr and pt', () => {
    expect(SEX_OPTIONS.map((s) => s.code)).toEqual(['male', 'female', 'other', 'unknown']);
    for (const s of SEX_OPTIONS) expect(Object.keys(s.labels).sort()).toEqual(['en', 'fr', 'pt']);
  });
});

describe('result parameters: a submitted range against the catalog', () => {
  const stored = [band({ name: 'Highland women', low: 12, high: 16, sex: 'female', ageLow: 15 }), band({ low: 11, high: 16 })];

  it('finds a range that matches field for field, name included', () => {
    expect(bandInCatalog({ name: 'Highland women', low: 12, high: 16, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null }, stored)).toBe(true);
  });

  it('reads a missing name as none, so a range sent before names existed still matches', () => {
    expect(bandInCatalog({ low: 11, high: 16, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }, stored)).toBe(true);
  });

  it('refuses a range the catalog does not hold', () => {
    expect(bandInCatalog({ name: 'Highland women', low: 5, high: 30, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null }, stored)).toBe(false);
    expect(bandInCatalog('not a range', stored)).toBe(false);
  });
});
```

In `packages/cli/src/test-catalog.test.ts`, inside `describe('test-catalog params', ...)`, add after the `reads a set file as a list of parameters` test:

```ts
  it('keeps a range name from a set file', () => {
    const [param] = readResultParamsFile(JSON.stringify([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [{ name: 'Highland women', low: 12, high: 16 }] },
    ]));
    expect(param.bands[0].name).toBe('Highland women');
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/result-params.test.ts --testTimeout 30000`

Expected: FAIL. `bandFit`, `bandInCatalog` and `SEX_OPTIONS` are not exported, and the first test fails on the missing `name`.

Run: `cd packages/cli && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: FAIL on `keeps a range name from a set file`, name `undefined`.

- [ ] **Step 3: Implement**

In `packages/bootstrap/src/result-params.ts`, add at the top, after the header comment:

```ts
import { Patient } from '@openldr/fhir';
```

Replace the `ResultBand` interface with:

```ts
/** One reference band. A band naming neither sex nor an age window is the catch-all. */
export interface ResultBand {
  /** Typed by whoever edits the test, such as "Highland women". Null when the range has no name. */
  name: string | null;
  low: number | null;
  high: number | null;
  unit: string | null;
  sex: string | null;
  ageLow: number | null;
  ageHigh: number | null;
}
```

Replace `toBand` with:

```ts
function toBand(value: unknown): ResultBand | null {
  if (!value || typeof value !== 'object') return null;
  const b = value as Record<string, unknown>;
  return {
    name: str(b.name), low: num(b.low), high: num(b.high), unit: str(b.unit),
    sex: str(b.sex), ageLow: num(b.ageLow), ageHigh: num(b.ageHigh),
  };
}
```

Append at the end of the file:

```ts
/** Whether a range fits one patient. Unknown means the range names a sex or an age the record lacks. */
export type BandFit = 'yes' | 'no' | 'unknown';

export function bandFit(band: ResultBand, patient: { sex?: string | null; ageYears?: number | null }): BandFit {
  const sex = patient.sex ?? null;
  const age = patient.ageYears ?? null;
  let unknown = false;
  if (band.sex !== null) {
    if (sex === null) unknown = true;
    else if (band.sex !== sex) return 'no';
  }
  if (band.ageLow !== null || band.ageHigh !== null) {
    if (age === null) unknown = true;
    else if ((band.ageLow !== null && age < band.ageLow) || (band.ageHigh !== null && age > band.ageHigh)) return 'no';
  }
  return unknown ? 'unknown' : 'yes';
}

/** A sex a range can name, with its label in each language the studio ships. */
export interface SexOption {
  code: string;
  labels: Record<string, string>;
}

// The codes come from the FHIR Patient schema. Only the words for them live here: the operator chose
// to have the server send labels (named reference ranges spec, 11), and no stored data holds them in
// French or Portuguese.
const SEX_LABELS: Record<string, Record<string, string>> = {
  male: { en: 'Male', fr: 'Homme', pt: 'Masculino' },
  female: { en: 'Female', fr: 'Femme', pt: 'Feminino' },
  other: { en: 'Other', fr: 'Autre', pt: 'Outro' },
  unknown: { en: 'Unknown', fr: 'Inconnu', pt: 'Desconhecido' },
};

export const SEX_OPTIONS: SexOption[] = Patient.shape.gender.unwrap().options
  .map((code) => ({ code, labels: SEX_LABELS[code] ?? { en: code } }));

/**
 * True when a range an answer carried is one of the catalog's ranges, field for field. A missing name
 * reads as none, so a range saved before names existed still matches an unnamed one.
 */
export function bandInCatalog(band: unknown, bands: ResultBand[]): boolean {
  const b = toBand(band);
  if (!b) return false;
  return bands.some((c) => c.name === b.name && c.low === b.low && c.high === b.high && c.unit === b.unit
    && c.sex === b.sex && c.ageLow === b.ageLow && c.ageHigh === b.ageHigh);
}
```

In `packages/bootstrap/src/index.ts`, replace the `./result-params` export block with:

```ts
export {
  RESULT_PARAM_VALUE_SET, SEX_OPTIONS, bandFit, bandInCatalog, matchBand, parseResultParams,
  type BandFit, type SexOption, type TestResultParam, type ResultBand, type ResultType,
} from './result-params';
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/result-params.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

Run: `cd packages/cli && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: PASS. The existing `reads a set file` test has no bands, so its expectation does not change.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/result-params.ts packages/bootstrap/src/result-params.test.ts packages/bootstrap/src/index.ts packages/cli/src/test-catalog.test.ts
git commit -m "feat(bootstrap): name a reference range and say whether it fits a patient" -m "A range gains an optional name. bandFit answers yes, no or unknown for one patient, unknown when the range names a sex or age the record lacks. SEX_OPTIONS lists the Patient schema's sex codes with labels in English, French and Portuguese, and bandInCatalog checks a submitted range against the catalog's ranges field for field. A CLI test pins that a params set file keeps the name."
```

---

### Task 2: the catalog service

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts`
- Modify: `packages/bootstrap/src/test-catalog.test.ts`

**Interfaces:**
- Consumes: `bandFit`, `BandFit`, `SEX_OPTIONS`, `SexOption` (Task 1).
- Produces: `CatalogOptions.sexes: SexOption[]`; `TestParamsAnswer.params[i].fits: BandFit[]`, aligned with `bands` by index; save refusals with `kind: 'invalid'`.

- [ ] **Step 1: Write the failing tests**

In `packages/bootstrap/src/test-catalog.test.ts`:

In `describe('test catalog: options and row changes')`, first test, add before `expect(o.loinc).toBeNull();`:

```ts
    expect(o.sexes.map((s) => s.code)).toEqual(['male', 'female', 'other', 'unknown']);
```

In `describe('test catalog: result parameters on a test')`, change `HGB` (line 887-888) so its band carries a name:

```ts
  const HGB = { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null,
    bands: [{ name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }] };
```

Append inside that describe block:

```ts
  const range = (b: object) => ({ name: null, low: null, high: null, unit: null, sex: null, ageLow: null, ageHigh: null, ...b });

  it('keeps a range name through a save', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ code: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ name: 'Highland women', low: 12, high: 16 })] }] });
    expect((await catalog.get('FBC'))?.resultParams[0].bands[0].name).toBe('Highland women');
  });

  it('refuses two ranges with the same name on one parameter, ignoring case', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await expect(catalog.create({
      code: 'FBC', display: 'Full blood count',
      resultParams: [{ ...HGB, bands: [range({ name: 'Highland', low: 12, high: 16 }), range({ name: 'highland', low: 11, high: 15 })] }],
    })).rejects.toMatchObject({ kind: 'invalid', message: 'HGB has two ranges named highland.' });
  });

  it('refuses a range whose low is above its high, or whose age from is above its age to', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await expect(catalog.create({ code: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ low: 16, high: 12 })] }] }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'HGB range 1 has a low above its high.' });
    await expect(catalog.create({ code: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ ageLow: 20, ageHigh: 15 })] }] }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'HGB range 1 has an age from above its age to.' });
  });

  it('refuses a range whose sex is not one of the Patient codes', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await expect(catalog.create({ code: 'FBC', display: 'Full blood count', resultParams: [{ ...HGB, bands: [range({ sex: 'woman' })] }] }))
      .rejects.toMatchObject({ kind: 'invalid', message: 'HGB range 1 names woman, which is not a sex this install knows.' });
  });
```

In `describe('test catalog: what a result sheet needs')`, change the two `HGB` bands (lines 936-937) to include `name: null`:

```ts
      { name: null, low: 13, high: 17, unit: 'g/dL', sex: 'male', ageLow: 18, ageHigh: null },
      { name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null },
```

and change the expected answer in the first test (line 946-949) to:

```ts
    expect(answer).toEqual([{
      test: { system: TEST_CATALOG_SYSTEM, code: 'FBC' },
      params: [{
        ...HGB, unit: 'g/dL', display: 'HGB',
        band: { name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null },
        fits: ['no', 'yes'],
      }],
    }]);
```

Append inside that describe block:

```ts
  it('answers unknown for a range that names a fact the patient record lacks', async () => {
    const { db, catalog } = await buildCatalog();
    await seedResultParams(db, ['HGB']);
    await catalog.create({ code: 'FBC', display: 'Full blood count', resultParams: [HGB] });
    const answer = await catalog.resultParamsFor([test('FBC')], { sex: null, ageYears: null });
    expect(answer[0].params[0].fits).toEqual(['unknown', 'unknown']);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: FAIL. `sexes` is undefined, the saves are not refused, and `fits` is missing.

- [ ] **Step 3: Implement**

In `packages/bootstrap/src/test-catalog.ts`:

Add `bandFit`, `SEX_OPTIONS`, `type BandFit` and `type SexOption` to the existing import from `./result-params`.

In `CatalogOptions`, add after `loinc`:

```ts
  /** The sexes a range may name, with labels, so the studio names no code (named reference ranges). */
  sexes: SexOption[];
```

Replace `TestParamsAnswer` with:

```ts
/** One test's parameters, ready for the sheet to draw. `fits` says, for each band by index, whether
 *  it fits this patient, so the browser never works out an age. */
export interface TestParamsAnswer {
  test: { system: string; code: string };
  params: Array<TestResultParam & { unit: string | null; display: string | null; band: ResultBand | null; fits: BandFit[] }>;
}
```

In `checkTest`, after the coded check inside `for (const param of resultParams ?? [])`, add:

```ts
      // A duplicate name leaves the bench two choices it cannot tell apart. A sex outside the Patient
      // codes can never fit anyone, silently.
      const names = new Set<string>();
      param.bands.forEach((band, i) => {
        const where = `${param.code} range ${i + 1}`;
        if (band.low !== null && band.high !== null && band.low > band.high) throw invalid(`${where} has a low above its high.`);
        if (band.ageLow !== null && band.ageHigh !== null && band.ageLow > band.ageHigh) {
          throw invalid(`${where} has an age from above its age to.`);
        }
        if (band.sex !== null && !SEX_OPTIONS.some((s) => s.code === band.sex)) {
          throw invalid(`${where} names ${band.sex}, which is not a sex this install knows.`);
        }
        if (band.name !== null) {
          const key = band.name.toLowerCase();
          if (names.has(key)) throw invalid(`${param.code} has two ranges named ${key}.`);
          names.add(key);
        }
      });
```

In `options()`, add `sexes: SEX_OPTIONS,` to the returned object, after `loinc`.

In `resultParamsFor`, change the parameter mapping to:

```ts
        params: (test?.resultParams ?? []).map((p) => ({
          ...p,
          unit: unitOf.get(p.code)?.unit ?? null,
          display: unitOf.get(p.code)?.display ?? null,
          band: matchBand(p.bands, patient),
          fits: p.bands.map((b) => bandFit(b, patient)),
        })),
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts src/result-params.test.ts --testTimeout 30000`

Expected: PASS, every test in both files.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/nr-t2-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts
git commit -m "feat(bootstrap): check named ranges on save and answer whether each fits" -m "A catalog save refuses two ranges with the same name on one parameter, a low above its high, an age from above its age to, and a sex outside the Patient codes. The result sheet's answer says for each range whether it fits the patient, and the picker options carry the sex choices with their labels."
```

---

### Task 3: the catalog routes

**Files:**
- Modify: `apps/server/src/test-catalog-routes.ts`
- Modify: `apps/server/src/test-catalog-routes.test.ts`

**Interfaces:**
- Consumes: `SEX_OPTIONS` (Task 1), `CatalogOptions.sexes` (Task 2).
- Produces: `POST /api/test-catalog/result-params` answers `{ tests, rejectReasons, sexes }`. The zod `band` keeps `name`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/test-catalog-routes.test.ts`:

Add `SEX_OPTIONS` to the import from `@openldr/bootstrap`.

In `OPTIONS` (line 15-20), add after `loinc: null,`:

```ts
  sexes: [{ code: 'female', labels: { en: 'Female', fr: 'Femme', pt: 'Feminino' } }],
```

In `carries a test result parameters through a create and an update` (line 361-374), give the band a name:

```ts
      bands: [{ name: 'Highland women', low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }],
```

Append inside the describe block:

```ts
  it('keeps a range with no name as a null name, not a missing key', async () => {
    const { ctx, calls } = fakeCtx();
    await appWith(ctx).inject({
      method: 'POST', url: '/api/test-catalog',
      payload: { code: 'FBC', display: 'FBC', resultParams: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [{ low: 12, high: 15 }] }] },
    });
    const created = calls.find((c) => c.method === 'create');
    expect((created?.args[0] as { resultParams: Array<{ bands: unknown[] }> }).resultParams[0].bands[0]).toEqual({
      name: null, low: 12, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null,
    });
  });

  it('POST /result-params answers the sex choices with their labels, so the studio names no code', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({
      method: 'POST', url: '/api/test-catalog/result-params',
      payload: { tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }] },
    });
    expect(res.json().sexes).toEqual(SEX_OPTIONS);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: FAIL. The named band loses its name through zod, the null-name test finds no `name` key, and `sexes` is undefined.

- [ ] **Step 3: Implement**

In `apps/server/src/test-catalog-routes.ts`:

Add `SEX_OPTIONS` to the import from `@openldr/bootstrap`.

Replace the `band` schema with:

```ts
// A reference band. Every edge is optional: a band naming neither sex nor age is the catch-all. The
// name must be declared here, or zod drops it before the service sees it.
const band = z.object({
  name: z.string().nullish(),
  low: z.number().nullish(), high: z.number().nullish(), unit: z.string().nullish(),
  sex: z.string().nullish(), ageLow: z.number().nullish(), ageHigh: z.number().nullish(),
});
```

In `resultParam`'s transform, replace the band mapping with:

```ts
  bands: (p.bands ?? []).map((b) => ({
    name: b.name ?? null,
    low: b.low ?? null, high: b.high ?? null, unit: b.unit ?? null,
    sex: b.sex ?? null, ageLow: b.ageLow ?? null, ageHigh: b.ageHigh ?? null,
  })),
```

In the result-params route, replace the reply with:

```ts
    // The results sheet cannot read the options route (terminology.view), so the sex labels come here too.
    return reply.send({ tests, rejectReasons: { order, test }, sexes: SEX_OPTIONS });
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/server && npx tsc --noEmit -p . > "$TEMP/nr-t3-tc.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src/test-catalog-routes.ts > "$TEMP/nr-t3-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` twice.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/test-catalog-routes.ts apps/server/src/test-catalog-routes.test.ts
git commit -m "feat(server): carry range names and send the sex choices to the results sheet" -m "The catalog route's band schema declares name, so zod no longer drops it between the sheet and the service. The result-params route answers the sex choices with their labels, because a Lab Technician cannot read the options route."
```

---

### Task 4: the answer and the Observation

**Files:**
- Modify: `packages/forms/src/test-details.ts:20`
- Modify: `packages/forms/src/extract/extract.ts:36`
- Modify: `packages/forms/src/extract/test-results.ts:24-36`
- Modify: `packages/forms/src/test-details.test.ts`
- Modify: `packages/forms/src/extraction.test.ts`

**Interfaces:**
- Produces: `TypedResult.band.name?: string | null`; `ExtractionContext.testBands` values carry `name?: string | null`; a named band writes `referenceRange[0].text`.

- [ ] **Step 1: Write the failing tests**

In `packages/forms/src/test-details.test.ts`, append inside `describe('test details answer', ...)`:

```ts
  it('keeps the name of the range the bench picked', () => {
    const named = { [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
      { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
        band: { name: 'Highland women', low: 12, high: 16, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null } },
    ] } }
    expect(parseTestDetails(named)[`${CATALOG}|FBC`].results[0].band?.name).toBe('Highland women')
  })
```

In `packages/forms/src/extraction.test.ts`, append inside the describe block that holds `writes one final Observation per typed result, with the band as its reference range`:

```ts
  it('writes the range name as the reference range text', () => {
    const named = { name: 'Highland women', low: 12, high: 16, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null }
    const out = extract({
      [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
        { param: { system: PARAM, code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL', band: named },
      ] },
    }, { testBands: new Map([[`${CATALOG}|FBC#${PARAM}|HGB`, named]]) }) as any[]
    expect(out[0].referenceRange).toEqual([{ low: { value: 12, unit: 'g/dL' }, high: { value: 16, unit: 'g/dL' }, text: 'Highland women' }])
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/forms && npx vitest run src/test-details.test.ts src/extraction.test.ts --testTimeout 30000`

Expected: the parse test PASSES already, because `parseTestDetails` copies the band whole. That is the proof the answer keeps the name. The extraction test FAILS, with no `text`. If the typecheck in Step 5 flags `name` on the band literal, that is the type half of this task.

- [ ] **Step 3: Implement**

In `packages/forms/src/test-details.ts`, replace the `band` line in `TypedResult` with:

```ts
  band?: { name?: string | null; low: number | null; high: number | null; unit: string | null; sex: string | null; ageLow: number | null; ageHigh: number | null } | null
```

In `packages/forms/src/extract/extract.ts`, replace the `testBands` line with:

```ts
  testBands?: ReadonlyMap<string, { name?: string | null; low: number | null; high: number | null; unit: string | null; sex: string | null; ageLow: number | null; ageHigh: number | null }>
```

In `packages/forms/src/extract/test-results.ts`, replace the `return` in `rangeOf` with:

```ts
  return {
    referenceRange: [{
      ...(band.low !== null ? { low: { value: band.low, ...(unit ? { unit } : {}) } } : {}),
      ...(band.high !== null ? { high: { value: band.high, ...(unit ? { unit } : {}) } } : {}),
      // The name the bench picked by, so the record says which range was used.
      ...(band.name ? { text: band.name } : {}),
    }],
  }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/forms && npx vitest run src/test-details.test.ts src/extraction.test.ts --testTimeout 30000`

Expected: PASS, every test in both files.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/forms && npx tsc --noEmit -p . > "$TEMP/nr-t4-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/forms/src/test-details.ts packages/forms/src/extract/extract.ts packages/forms/src/extract/test-results.ts packages/forms/src/test-details.test.ts packages/forms/src/extraction.test.ts
git commit -m "feat(forms): record which named range a result was measured against" -m "A typed result's band may carry the range name, and the extractor writes it as the Observation's reference range text."
```

---

### Task 5: refuse a range the catalog does not hold

**Files:**
- Modify: `apps/server/src/forms-routes.ts`
- Modify: `apps/server/src/forms-routes.test.ts`

**Interfaces:**
- Consumes: `bandInCatalog` (Task 1), `TestCatalog.resultParamsFor` (Task 2).
- Produces: `POST /api/forms/:id/responses` answers 400 `{ error: 'invalid answers', errors: [{ fieldId, label, reason }] }` for a band not in the catalog.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/forms-routes.test.ts`, in `hands the extractor the band each result was measured against` (line 1079), replace the `testCatalog` fake on line 1087 with one that also holds the range:

```ts
    // The order carries catalog tests, so S4's LOINC lookup runs too, and the submit checks the band.
    (ctx as any).testCatalog = {
      loincCodingsFor: async () => new Map(),
      resultParamsFor: async () => [{
        test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' },
        params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, unit: 'g/dL', display: 'HGB', band: null, fits: [],
          bands: [{ name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }] }],
      }],
    };
```

Append after that test:

```ts
  it('refuses a result whose range the catalog does not hold, and stores nothing', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    (ctx as any).testCatalog = {
      loincCodingsFor: async () => new Map(),
      resultParamsFor: async () => [{
        test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' },
        params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, unit: 'g/dL', display: 'HGB', band: null, fits: [],
          bands: [{ name: 'Highland women', low: 12, high: 16, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null }] }],
      }],
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
            band: { name: 'Highland women', low: 5, high: 30, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null } },
        ] } },
      } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'invalid answers',
      errors: [{ fieldId: 'details', label: 'Results', reason: 'The reference ranges for HGB on FBC changed. Reopen the test and pick a range again.' }],
    });
    expect(runs).toEqual([]);
  });

  it('accepts a named range the catalog holds, and writes its name', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    const named = { name: 'Highland women', low: 12, high: 16, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null };
    (ctx as any).testCatalog = {
      loincCodingsFor: async () => new Map(),
      resultParamsFor: async () => [{
        test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' },
        params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, unit: 'g/dL', display: 'HGB', band: null, fits: [], bands: [named] }],
      }],
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: resultOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        details: { 'urn:openldr:codesystem:test-catalog|FBC': { specimen: null, rejection: null, results: [
          { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL', band: named },
        ] } },
      } },
    });

    expect(res.statusCode).toBe(201);
    const observation = runs[0].body.entry.map((e: any) => e.resource).find((r: any) => r.resourceType === 'Observation');
    expect(observation.referenceRange[0].text).toBe('Highland women');
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/server && npx vitest run src/forms-routes.test.ts --testTimeout 30000`

Expected: `refuses a result whose range the catalog does not hold` FAILS with 201. The other two PASS.

- [ ] **Step 3: Implement**

In `apps/server/src/forms-routes.ts`, add `bandInCatalog` to the import from `@openldr/bootstrap`.

After `testBandsFrom`, add:

```ts
/**
 * Each typed result's band, checked against the ranges the catalog holds for that test and parameter
 * (named reference ranges spec, 5). The sheet sends the range the bench picked, so without this an
 * edited request could store a range the catalog never had. Asks the catalog only when a result
 * carries a band.
 */
async function catalogBandErrors(
  ctx: AppContext, schema: FormSchema, answers: Record<string, unknown>,
): Promise<Array<{ fieldId: string; label: string; reason: string }>> {
  const checks: Array<{ fieldId: string; label: string; testKey: string; param: { system: string; code: string }; band: unknown }> = [];
  for (const field of schema.fields) {
    if (field.fieldType !== 'testDetails') continue;
    for (const [testKey, detail] of Object.entries(parseTestDetails(answers[field.id]))) {
      for (const result of detail.results) {
        if (result.band) checks.push({ fieldId: field.id, label: field.displayLabel, testKey, param: result.param, band: result.band });
      }
    }
  }
  if (checks.length === 0) return [];
  const tests = [...new Set(checks.map((c) => c.testKey))].map((key) => {
    const cut = key.lastIndexOf('|');
    return { system: key.slice(0, cut), code: key.slice(cut + 1) };
  });
  const held = await ctx.testCatalog.resultParamsFor(tests, {});
  return checks
    .filter((c) => {
      const bands = held.find((t) => `${t.test.system}|${t.test.code}` === c.testKey)
        ?.params.find((p) => p.system === c.param.system && p.code === c.param.code)?.bands ?? [];
      return !bandInCatalog(c.band, bands);
    })
    .map((c) => ({
      fieldId: c.fieldId,
      label: c.label,
      reason: `The reference ranges for ${c.param.code} on ${c.testKey.slice(c.testKey.lastIndexOf('|') + 1)} changed. Reopen the test and pick a range again.`,
    }));
}
```

In the submit route, directly after the `referenceErrors` block, add:

```ts
    const bandErrors = await catalogBandErrors(ctx, f.schema, p.data.answers);
    if (bandErrors.length > 0) {
      reply.code(400);
      return { error: 'invalid answers', errors: bandErrors };
    }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/server && npx vitest run src/forms-routes.test.ts --testTimeout 30000`

Expected: PASS, every test in the file. `does not ask the catalog when no answer is a catalog test` still passes, because no result carries a band.

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/server && npx tsc --noEmit -p . > "$TEMP/nr-t5-tc.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src/forms-routes.ts > "$TEMP/nr-t5-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` twice.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts
git commit -m "feat(server): refuse a result whose range is not in the catalog" -m "The results sheet now sends the range the bench picked. Before extraction the forms route checks each typed result's range against the catalog's ranges for that test and parameter, field by field, and refuses the order with a message asking the bench to reopen the test. A named range the catalog holds is accepted and its name reaches the Observation."
```

---

### Task 6: the studio types and range labels

**Files:**
- Modify: `apps/studio/src/api.ts:2458-2466` and `:2552-2568`
- Create: `apps/studio/src/forms-runtime/rangeLabel.ts`
- Create: `apps/studio/src/forms-runtime/rangeLabel.test.ts`
- Modify: `apps/studio/src/pages/TestCatalog.tsx:31`, `apps/studio/src/pages/TestCatalog.test.tsx:36-41`, `apps/studio/src/test-catalog/ImportCatalogSheet.test.tsx:16-21`, `apps/studio/src/test-catalog/TestSheet.test.tsx:18-23`

**Interfaces:**
- Produces: `CatalogResultBand.name: string | null`; `CatalogSexOption { code: string; labels: Record<string, string> }`; `TestCatalogOptions.sexes`; `CatalogResultParam.fits: CatalogBandFit[]`; `CatalogResultParamsAnswer.sexes`; `RangeCopy`, `RANGE_EN`, `sexLabel(option, language)`, `criteriaLabel(band, sexes, copy)`, `rangeLabel(band, sexes, copy)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/studio/src/forms-runtime/rangeLabel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { criteriaLabel, rangeLabel, RANGE_EN, sexLabel } from './rangeLabel';

const sexes = [{ code: 'female', labels: { en: 'Female', fr: 'Femme', pt: 'Feminino' } }];
const band = (b: object) => ({ name: null, low: 12, high: 16, unit: null, sex: null, ageLow: null, ageHigh: null, ...b });

describe('range labels', () => {
  it('uses the name when the range has one', () => {
    expect(rangeLabel(band({ name: 'Highland women', sex: 'female' }), sexes, RANGE_EN)).toBe('Highland women');
  });

  it('labels an unnamed range from its sex and age', () => {
    expect(rangeLabel(band({ sex: 'female', ageLow: 15 }), sexes, RANGE_EN)).toBe('Female 15+');
    expect(rangeLabel(band({ ageHigh: 5 }), sexes, RANGE_EN)).toBe('up to 5');
    expect(rangeLabel(band({ ageLow: 2, ageHigh: 17 }), sexes, RANGE_EN)).toBe('2 to 17');
    expect(rangeLabel(band({}), sexes, RANGE_EN)).toBe('Anyone');
  });

  it('describes who a range is for without its name, for the warning', () => {
    expect(criteriaLabel(band({ name: 'Highland women', sex: 'female', ageLow: 15 }), sexes, RANGE_EN)).toBe('Female 15+');
  });

  it('takes the sex label in the page language, then English, then the code', () => {
    expect(sexLabel(sexes[0], 'fr')).toBe('Femme');
    expect(sexLabel(sexes[0], 'pt-BR')).toBe('Feminino');
    expect(sexLabel({ code: 'other', labels: { en: 'Other' } }, 'fr')).toBe('Other');
    expect(sexLabel({ code: 'other', labels: {} }, 'fr')).toBe('other');
    expect(rangeLabel(band({ sex: 'female' }), sexes, { ...RANGE_EN, language: 'fr' })).toBe('Femme');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/studio && npx vitest run src/forms-runtime/rangeLabel.test.ts --testTimeout 30000`

Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement**

In `apps/studio/src/api.ts`:

Add to `TestCatalogOptions`, after `loinc`:

```ts
  /** The sexes a range may name, with labels by language, so the studio names no code. */
  sexes: CatalogSexOption[];
```

Replace `CatalogResultBand` and `CatalogResultParam` with:

```ts
export interface CatalogResultBand { name: string | null; low: number | null; high: number | null; unit: string | null; sex: string | null; ageLow: number | null; ageHigh: number | null }
export interface CatalogSexOption { code: string; labels: Record<string, string> }
/** Whether a range fits the patient on the order. Unknown means the record lacks the sex or age it names. */
export type CatalogBandFit = 'yes' | 'no' | 'unknown';
export interface CatalogResultParam {
  system: string; code: string; resultType: 'numeric' | 'coded' | 'text'; valueSetUrl: string | null;
  bands: CatalogResultBand[]; unit: string | null; display: string | null; band: CatalogResultBand | null;
  /** For each band, by index. */
  fits: CatalogBandFit[];
}
```

In `CatalogResultParamsAnswer`, add after `rejectReasons`:

```ts
  sexes: CatalogSexOption[];
```

Create `apps/studio/src/forms-runtime/rangeLabel.ts`:

```ts
import type { CatalogResultBand, CatalogSexOption } from '@/api';

/** Words for a range. The form runtime has no i18n, so the capture page fills these (see TestDetailsField). */
export interface RangeCopy {
  /** The page language, such as "fr". Picks the server's sex label. */
  language?: string;
  range?: string;
  chooseRange?: string;
  /** "{label}" is replaced with who the range is for. */
  misfit?: string;
  anyone?: string;
  ageFrom?: string;
  ageTo?: string;
  ageBetween?: string;
}

export const RANGE_EN: Required<RangeCopy> = {
  language: 'en',
  range: 'Range',
  chooseRange: 'Choose a range',
  misfit: 'This range is for {label}',
  anyone: 'Anyone',
  ageFrom: '{from}+',
  ageTo: 'up to {to}',
  ageBetween: '{from} to {to}',
};

/** The server's label in this language, then its base language, then English, then the code. */
export function sexLabel(option: CatalogSexOption, language: string): string {
  return option.labels[language] ?? option.labels[language.split('-')[0]] ?? option.labels.en ?? option.code;
}

/** Who a range is for, from its sex and age, such as "Female 15+". Ignores the name. */
export function criteriaLabel(band: CatalogResultBand, sexes: CatalogSexOption[], copy: RangeCopy): string {
  const c = { ...RANGE_EN, ...copy };
  const option = band.sex ? sexes.find((s) => s.code === band.sex) : undefined;
  const sex = band.sex ? (option ? sexLabel(option, c.language) : band.sex) : null;
  const age = band.ageLow !== null && band.ageHigh !== null
    ? c.ageBetween.replace('{from}', String(band.ageLow)).replace('{to}', String(band.ageHigh))
    : band.ageLow !== null ? c.ageFrom.replace('{from}', String(band.ageLow))
      : band.ageHigh !== null ? c.ageTo.replace('{to}', String(band.ageHigh)) : null;
  return [sex, age].filter(Boolean).join(' ') || c.anyone;
}

/** What the picker shows: the range's name, or who it is for when it has none. */
export function rangeLabel(band: CatalogResultBand, sexes: CatalogSexOption[], copy: RangeCopy): string {
  return band.name ?? criteriaLabel(band, sexes, copy);
}
```

Add `sexes: []` to each `TestCatalogOptions` literal:
- `apps/studio/src/pages/TestCatalog.tsx:31`: `const NO_OPTIONS: TestCatalogOptions = { categories: [], specimenTypes: [], resultParams: [], loinc: null, sexes: [] };`
- `apps/studio/src/pages/TestCatalog.test.tsx`, `apps/studio/src/test-catalog/ImportCatalogSheet.test.tsx`: add `sexes: [],` after `loinc: null,` in `OPTIONS`.
- `apps/studio/src/test-catalog/TestSheet.test.tsx`: add after `loinc: null,` in `OPTIONS`:

```ts
  sexes: [{ code: 'female', labels: { en: 'Female', fr: 'Femme', pt: 'Feminino' } }, { code: 'male', labels: { en: 'Male', fr: 'Homme', pt: 'Masculino' } }],
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/forms-runtime/rangeLabel.test.ts --testTimeout 30000`

Expected: PASS, all four.

- [ ] **Step 5: Typecheck the package, and list what the new required fields break**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/nr-t6-tc.txt" 2>&1; echo "exit=$?"`

Expected: a non-zero exit whose errors are all in `TestDetailSheet.test.tsx`, `TestDetailsField.test.tsx` or `api.testCatalog.test.ts`, on fixtures that lack `fits`, `name` or `sexes`. Task 8 fixes those files. An error in any other file means a literal this plan missed, so stop and report it.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/forms-runtime/rangeLabel.ts apps/studio/src/forms-runtime/rangeLabel.test.ts apps/studio/src/pages/TestCatalog.tsx apps/studio/src/pages/TestCatalog.test.tsx apps/studio/src/test-catalog/ImportCatalogSheet.test.tsx apps/studio/src/test-catalog/TestSheet.test.tsx
git commit -m "feat(studio): label a range by its name, or by who it is for" -m "The studio's catalog types gain range names, whether each range fits, and the sex choices the server sends. rangeLabel shows a range's name, or builds one from the server's sex label in the page language and the age window, such as Female 15+."
```

---

### Task 7: the range editor on the Test catalog page

**Files:**
- Modify: `apps/studio/src/test-catalog/TestSheet.tsx`
- Modify: `apps/studio/src/test-catalog/TestSheet.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: `TestCatalogOptions.sexes`, `CatalogResultBand.name` (Task 6), `sexLabel` (Task 6).

- [ ] **Step 1: Write the failing tests**

In `apps/studio/src/test-catalog/TestSheet.test.tsx`, add after the `save()` helper:

```ts
async function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  await screen.findByRole('menu');
}

async function addBand(code: string) {
  await openMenu(`param-menu-${code}`);
  await act(async () => { fireEvent.click(await screen.findByTestId(`add-band-${code}`)); });
}
```

Replace the test `saves a band the operator typed` with:

```ts
  it('saves a band the operator typed', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    renderSheet({ target: { kind: 'edit', test: withParam } });
    await addBand('HGB');
    fireEvent.change(screen.getByLabelText(/low for HGB band 1/i), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/high for HGB band 1/i), { target: { value: '15' } });
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands).toEqual([
      { name: null, low: 12, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null },
    ]);
  });

  it('saves a range name, sex and age the operator set', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue(withParam);
    renderSheet({ target: { kind: 'edit', test: withParam } });
    await addBand('HGB');
    fireEvent.change(screen.getByLabelText(/name for HGB band 1/i), { target: { value: 'Highland women' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: /sex for HGB band 1/i }), { key: 'ArrowDown' });
    await act(async () => { fireEvent.click(await screen.findByRole('option', { name: 'Female' })); });
    fireEvent.change(screen.getByLabelText(/age from for HGB band 1/i), { target: { value: '15' } });
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands).toEqual([
      { name: 'Highland women', low: null, high: null, unit: null, sex: 'female', ageLow: 15, ageHigh: null },
    ]);
  });

  it('moves a range up, and removes one, from the range menu', async () => {
    const twoBands: api.CatalogTest = { ...withParam, resultParams: [{ ...withParam.resultParams[0], bands: [
      { name: 'Lowland', low: 11, high: 15, unit: null, sex: null, ageLow: null, ageHigh: null },
      { name: 'Highland', low: 12, high: 16, unit: null, sex: null, ageLow: null, ageHigh: null },
    ] }] };
    vi.mocked(api.updateCatalogTest).mockResolvedValue(twoBands);
    renderSheet({ target: { kind: 'edit', test: twoBands } });
    await openMenu('band-menu-HGB-2');
    await act(async () => { fireEvent.click(await screen.findByTestId('band-up-HGB-2')); });
    await openMenu('band-menu-HGB-2');
    await act(async () => { fireEvent.click(await screen.findByTestId('band-remove-HGB-2')); });
    await save();
    expect(vi.mocked(api.updateCatalogTest).mock.calls[0][1].resultParams?.[0].bands.map((b) => b.name)).toEqual(['Highland']);
  });
```

`withParam` (`TestSheet.test.tsx:185-188`) names HGB with no ranges, so the added range is range 1.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/test-catalog/TestSheet.test.tsx --testTimeout 30000`

Expected: the three tests FAIL. No `param-menu-HGB` exists.

- [ ] **Step 3: Implement**

In `apps/studio/src/test-catalog/TestSheet.tsx`:

Add `type CatalogResultBand` to the import from `@/api`, and add:

```ts
import { sexLabel } from '@/forms-runtime/rangeLabel';
```

Replace `EMPTY_BAND` with:

```ts
const EMPTY_BAND: CatalogResultBand = { name: null, low: null, high: null, unit: null, sex: null, ageLow: null, ageHigh: null };
/** Radix Select cannot hold an empty value, so "any sex" is this sentinel in the picker only. */
const ANY_SEX = '__any__';
```

Change `const { t } = useTranslation();` to `const { t, i18n } = useTranslation();`.

Replace the `{chosen.resultType === 'numeric' ? ( <Button ... Add band ...> ) : null}` block (lines 300-309) with:

```tsx
                              {chosen.resultType === 'numeric' ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost" size="icon" className="h-8 w-8"
                                      data-testid={`param-menu-${p.code}`}
                                      aria-label={t('testCatalog.sheet.paramActions', { code: p.code })}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      data-testid={`add-band-${p.code}`}
                                      onSelect={() => set({ resultParams: setParam(draft.resultParams, p.code, { ...chosen, bands: [...chosen.bands, EMPTY_BAND] }) })}
                                    >
                                      {t('testCatalog.sheet.addBand')}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
```

Replace the `{chosen.resultType === 'numeric' && chosen.bands.map((band, i) => ( ... ))}` block (lines 311-345) with:

```tsx
                            {chosen.resultType === 'numeric' && chosen.bands.map((band, i) => {
                              const n = i + 1;
                              const writeBands = (bands: CatalogResultBand[]) => set({ resultParams: setParam(draft.resultParams, p.code, { ...chosen, bands }) });
                              const setBand = (patch: Partial<CatalogResultBand>) => writeBands(chosen.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
                              const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));
                              const move = (by: number) => {
                                const next = [...chosen.bands];
                                [next[i], next[i + by]] = [next[i + by], next[i]];
                                writeBands(next);
                              };
                              return (
                                <div key={i} className="flex flex-wrap items-center gap-1.5">
                                  <Input
                                    className="h-8 w-40"
                                    aria-label={t('testCatalog.sheet.bandNameFor', { code: p.code, n })}
                                    placeholder={t('testCatalog.sheet.bandName')}
                                    value={band.name ?? ''}
                                    onChange={(e) => setBand({ name: e.target.value === '' ? null : e.target.value })}
                                  />
                                  {(['low', 'high'] as const).map((edge) => (
                                    <Input
                                      key={edge}
                                      className="h-8 w-20"
                                      aria-label={`${edge} for ${p.code} band ${n}`}
                                      value={band[edge] === null ? '' : String(band[edge])}
                                      onChange={(e) => setBand({ [edge]: numberOrNull(e.target.value) })}
                                    />
                                  ))}
                                  <Input
                                    className="h-8 w-20"
                                    aria-label={`unit for ${p.code} band ${n}`}
                                    placeholder={t('testCatalog.sheet.bandUnit')}
                                    value={band.unit ?? ''}
                                    onChange={(e) => setBand({ unit: e.target.value || null })}
                                  />
                                  <Select value={band.sex ?? ANY_SEX} onValueChange={(v) => setBand({ sex: v === ANY_SEX ? null : v })}>
                                    <SelectTrigger className="h-8 w-32" aria-label={t('testCatalog.sheet.bandSexFor', { code: p.code, n })}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={ANY_SEX}>{t('testCatalog.sheet.bandAnySex')}</SelectItem>
                                      {options.sexes.map((s) => <SelectItem key={s.code} value={s.code}>{sexLabel(s, i18n.language)}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                  {(['ageLow', 'ageHigh'] as const).map((edge) => (
                                    <Input
                                      key={edge}
                                      className="h-8 w-20"
                                      aria-label={t(edge === 'ageLow' ? 'testCatalog.sheet.bandAgeFromFor' : 'testCatalog.sheet.bandAgeToFor', { code: p.code, n })}
                                      placeholder={t(edge === 'ageLow' ? 'testCatalog.sheet.bandAgeFrom' : 'testCatalog.sheet.bandAgeTo')}
                                      value={band[edge] === null ? '' : String(band[edge])}
                                      onChange={(e) => setBand({ [edge]: numberOrNull(e.target.value) })}
                                    />
                                  ))}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost" size="icon" className="h-8 w-8"
                                        data-testid={`band-menu-${p.code}-${n}`}
                                        aria-label={t('testCatalog.sheet.bandActions', { code: p.code, n })}
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem data-testid={`band-up-${p.code}-${n}`} disabled={i === 0} onSelect={() => move(-1)}>
                                        {t('testCatalog.sheet.moveUp')}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem data-testid={`band-down-${p.code}-${n}`} disabled={i === chosen.bands.length - 1} onSelect={() => move(1)}>
                                        {t('testCatalog.sheet.moveDown')}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        data-testid={`band-remove-${p.code}-${n}`}
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() => writeBands(chosen.bands.filter((_, j) => j !== i))}
                                      >
                                        {t('testCatalog.sheet.removeBand')}
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              );
                            })}
```

In `apps/studio/src/i18n/en.ts`, in `testCatalog.sheet`, after `bandUnit`, add:

```ts
    bandName: 'name',
    bandNameFor: 'name for {{code}} band {{n}}',
    bandSexFor: 'sex for {{code}} band {{n}}',
    bandAnySex: 'any sex',
    bandAgeFrom: 'age from',
    bandAgeTo: 'age to',
    bandAgeFromFor: 'age from for {{code}} band {{n}}',
    bandAgeToFor: 'age to for {{code}} band {{n}}',
    bandActions: 'Actions for {{code}} band {{n}}',
    paramActions: 'Actions for {{code}}',
    moveUp: 'Move up',
    moveDown: 'Move down',
```

In `fr.ts`, same place:

```ts
    bandName: 'nom',
    bandNameFor: 'nom pour {{code}} intervalle {{n}}',
    bandSexFor: 'sexe pour {{code}} intervalle {{n}}',
    bandAnySex: 'tout sexe',
    bandAgeFrom: 'âge de',
    bandAgeTo: 'âge à',
    bandAgeFromFor: 'âge de pour {{code}} intervalle {{n}}',
    bandAgeToFor: 'âge à pour {{code}} intervalle {{n}}',
    bandActions: 'Actions pour {{code}} intervalle {{n}}',
    paramActions: 'Actions pour {{code}}',
    moveUp: 'Monter',
    moveDown: 'Descendre',
```

In `pt.ts`, same place:

```ts
    bandName: 'nome',
    bandNameFor: 'nome para {{code}} intervalo {{n}}',
    bandSexFor: 'sexo para {{code}} intervalo {{n}}',
    bandAnySex: 'qualquer sexo',
    bandAgeFrom: 'idade de',
    bandAgeTo: 'idade até',
    bandAgeFromFor: 'idade de para {{code}} intervalo {{n}}',
    bandAgeToFor: 'idade até para {{code}} intervalo {{n}}',
    bandActions: 'Ações para {{code}} intervalo {{n}}',
    paramActions: 'Ações para {{code}}',
    moveUp: 'Subir',
    moveDown: 'Descer',
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/test-catalog src/i18n --testTimeout 30000`

Expected: PASS, every test in those folders, the i18n parity test included.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/test-catalog/TestSheet.tsx apps/studio/src/test-catalog/TestSheet.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): name a range and set its sex, age and order in the test sheet" -m "Each range row gains a name, a sex from the choices the server sends, and an age window. Moving a range up or down and removing it live in the row's dots menu, and adding a range lives in the parameter's dots menu, replacing the standalone buttons."
```

---

### Task 8: the range picker on the results sheet

**Files:**
- Modify: `apps/studio/src/forms-runtime/TestDetailSheet.tsx`
- Modify: `apps/studio/src/forms-runtime/TestDetailSheet.test.tsx`
- Modify: `apps/studio/src/forms-runtime/TestDetailsField.tsx`
- Modify: `apps/studio/src/forms-runtime/TestDetailsField.test.tsx`
- Modify: `apps/studio/src/api.testCatalog.test.ts`

**Interfaces:**
- Consumes: `CatalogResultParam.fits`, `CatalogResultParamsAnswer.sexes`, `RangeCopy`, `RANGE_EN`, `rangeLabel`, `criteriaLabel` (Task 6).
- Produces: `TestDetailSheet` props gain `sexes: CatalogSexOption[]` and `copy?: RangeCopy`. `TestDetailsCopy` extends `RangeCopy`.

- [ ] **Step 1: Write the failing tests**

In `apps/studio/src/forms-runtime/TestDetailSheet.test.tsx`:

Replace the `numeric`, `coded` and `text` fixtures with:

```ts
const HIGHLAND = { name: 'Highland women', low: 13, high: 17, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null };
const LOWLAND = { name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null };
const MEN = { name: null, low: 13.5, high: 17.5, unit: 'g/dL', sex: 'male', ageLow: 15, ageHigh: null };
const numeric = {
  system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' as const, valueSetUrl: null,
  bands: [LOWLAND, HIGHLAND, MEN], fits: ['yes', 'yes', 'no'] as Array<'yes' | 'no' | 'unknown'>,
  unit: 'g/dL', display: 'Haemoglobin', band: LOWLAND,
};
const coded = {
  system: 'urn:openldr:default_result', code: 'MRDT', resultType: 'coded' as const, valueSetUrl: 'urn:openldr:valueset:rdt',
  bands: [], fits: [], unit: null, display: 'Malaria RDT', band: null,
};
const text = {
  system: 'urn:openldr:default_result', code: 'NOTE', resultType: 'text' as const, valueSetUrl: null,
  bands: [], fits: [], unit: null, display: 'Note', band: null,
};
const sexes = [
  { code: 'female', labels: { en: 'Female', fr: 'Femme', pt: 'Feminino' } },
  { code: 'male', labels: { en: 'Male', fr: 'Homme', pt: 'Masculino' } },
];
```

Add `sexes={sexes}` to every `<TestDetailSheet ... />` render in the file.

Append inside `describe('TestDetailSheet', ...)`:

```ts
  it('starts the range picker on the range the server matched, and lists every range by name or label', async () => {
    const user = userEvent.setup();
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    const picker = await screen.findByRole('combobox', { name: /range haemoglobin/i });
    expect(picker).toHaveTextContent('Female 18+');
    await user.click(picker);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Female 18+', 'Highland women', 'Male 15+']);
  });

  it('writes the picked range, name included, and flags the value against it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 12.5, unit: 'g/dL', band: LOWLAND },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={onChange} onClose={() => {}} />);
    await user.click(await screen.findByRole('combobox', { name: /range haemoglobin/i }));
    await user.click(await screen.findByRole('option', { name: 'Highland women' }));
    const written = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(written.results[0].band).toEqual(HIGHLAND);
    expect(written.results[0].value).toBe(12.5);
  });

  it('flags against the range already picked, not the one the server matched', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 12.5, unit: 'g/dL', band: HIGHLAND },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('below 13')).toBeInTheDocument();
    expect(screen.getByText('13 to 17 g/dL')).toBeInTheDocument();
  });

  it('warns when the picked range does not fit the patient, and allows it', async () => {
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 14, unit: 'g/dL', band: MEN },
    ] };
    render(<TestDetailSheet test={test} params={[numeric]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('This range is for Male 15+')).toBeInTheDocument();
    expect(screen.getByLabelText('Haemoglobin')).toHaveValue('14');
  });

  it('stays quiet about a range whose fit is unknown', async () => {
    const unknown = { ...numeric, fits: ['unknown', 'unknown', 'unknown'] as Array<'yes' | 'no' | 'unknown'>, band: null };
    const typed = { specimen: null, rejection: null, results: [
      { param: { system: numeric.system, code: 'HGB' }, resultType: 'numeric' as const, value: 14, unit: 'g/dL', band: MEN },
    ] };
    render(<TestDetailSheet test={test} params={[unknown]} detail={typed} sexes={sexes} onChange={() => {}} onClose={() => {}} />);
    await screen.findByLabelText('Haemoglobin');
    expect(screen.queryByText(/this range is for/i)).toBeNull();
  });

  it('takes its range words from the caller', async () => {
    render(<TestDetailSheet test={test} params={[numeric]} detail={detail} sexes={sexes} copy={{ language: 'fr', range: 'Intervalle', ageFrom: 'dès {from} ans' }} onChange={() => {}} onClose={() => {}} />);
    expect(await screen.findByRole('combobox', { name: /intervalle haemoglobin/i })).toHaveTextContent('Femme dès 18 ans');
  });
```

The existing test `shows the matched band as text, and the unit beside the input` expects `12 to 15 g/dL`. It still holds, because `LOWLAND` keeps those bounds.

In `apps/studio/src/forms-runtime/TestDetailsField.test.tsx`, in the `catalogResultParams` mock, give the HGB parameter `fits: []` and add `sexes: []` after `rejectReasons`.

In `apps/studio/src/api.testCatalog.test.ts`, wherever a `catalogResultParams` answer is built or expected (lines 96 and 108), add `sexes: []` beside `rejectReasons`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/forms-runtime/TestDetailSheet.test.tsx --testTimeout 30000`

Expected: the six new tests FAIL. No range picker exists.

- [ ] **Step 3: Implement**

In `apps/studio/src/forms-runtime/TestDetailSheet.tsx`:

Change the `@/api` import to:

```ts
import { catalogSpecimensFor, expandValueSetByUrl, type CatalogResultBand, type CatalogResultParam, type CatalogSexOption } from '@/api';
```

and add:

```ts
import { criteriaLabel, RANGE_EN, rangeLabel, type RangeCopy } from './rangeLabel';
```

Replace `bandText` and `flagFor` with versions that take the picked band:

```ts
/** "12 to 15 g/dL", "12 or more g/dL", "up to 15 g/dL". Null when no range is picked. */
function bandText(band: CatalogResultBand | null, unitOfParam: string | null): string | null {
  if (!band || (band.low === null && band.high === null)) return null;
  const unit = band.unit ?? unitOfParam ?? '';
  const range = band.low !== null && band.high !== null
    ? `${band.low} to ${band.high}`
    : band.low !== null ? `${band.low} or more` : `up to ${band.high}`;
  return unit ? `${range} ${unit}` : range;
}

/** The flag beside a numeric input. Never refuses the value: the bench decides, not the band. */
function flagFor(band: CatalogResultBand | null, value: number | null): string | null {
  if (!band || value === null) return null;
  if (band.low !== null && value < band.low) return `below ${band.low}`;
  if (band.high !== null && value > band.high) return `above ${band.high}`;
  return null;
}

const sameBand = (a: CatalogResultBand, b: { name?: string | null } & Omit<CatalogResultBand, 'name'>): boolean =>
  a.name === (b.name ?? null) && a.low === b.low && a.high === b.high && a.unit === b.unit
  && a.sex === b.sex && a.ageLow === b.ageLow && a.ageHigh === b.ageHigh;
```

Change the component signature to:

```ts
export function TestDetailSheet({ test, params, detail, sexes, copy, onChange, onClose }: {
  test: CodingAnswer;
  params: CatalogResultParam[];
  detail: TestDetail;
  /** The sex choices the server sent, for labelling unnamed ranges. */
  sexes: CatalogSexOption[];
  /** Range words. The runtime has no i18n (TestDetailsField). */
  copy?: RangeCopy;
  onChange: (detail: TestDetail) => void;
  onClose: () => void;
}): JSX.Element {
  const words = { ...RANGE_EN, ...(copy ?? {}) };
```

Replace `writeResult` with:

```ts
  const writeResult = (param: CatalogResultParam, value: TypedResult['value'], band: CatalogResultBand | null): void => {
    const next: TypedResult = {
      param: { system: param.system, code: param.code },
      resultType: param.resultType,
      value,
      ...(param.unit ? { unit: param.unit } : {}),
      ...(band ? { band } : {}),
    };
    const others = detail.results.filter((r) => keyOf(r.param) !== keyOf(param));
    onChange({ ...detail, results: [...others, next] });
  };

  /** The range the bench picked for this parameter, or the one the server matched when none is picked yet. */
  const pickedIndex = (param: CatalogResultParam, current: TypedResult | undefined): number => {
    const chosen = current?.band ?? param.band;
    return chosen ? param.bands.findIndex((b) => sameBand(b, chosen)) : -1;
  };
```

In the `coded` and `text` branches, change each `writeResult(param, X)` call to `writeResult(param, X, null)`.

Replace the numeric branch with:

```tsx
            if (param.resultType === 'numeric') {
              const typed = typeof current?.value === 'number' ? current.value : null;
              const index = pickedIndex(param, current);
              const band = index >= 0 ? param.bands[index] : null;
              const flag = flagFor(band, typed);
              const range = bandText(band, param.unit);
              const misfit = band !== null && param.fits[index] === 'no';
              const hasLine = param.bands.length > 0;
              return (
                // A fragment, not a nested grid: every label shares the sheet's one label column, so the
                // inputs line up.
                <Fragment key={keyOf(param)}>
                  <Label htmlFor={keyOf(param)} className={hasLine ? TOP_LABEL : undefined}>{label}</Label>
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
                          writeResult(param, next !== null && Number.isFinite(next) ? next : null, band);
                        }}
                      />
                      {param.unit ? <span className="text-sm text-muted-foreground">{param.unit}</span> : null}
                      {flag ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700">{flag}</span> : null}
                    </div>
                    {hasLine ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Select
                          value={index >= 0 ? String(index) : undefined}
                          onValueChange={(v) => writeResult(param, typed, param.bands[Number(v)] ?? null)}
                        >
                          <SelectTrigger className="h-8 w-48" aria-label={`${words.range} ${label}`}>
                            <SelectValue placeholder={words.chooseRange} />
                          </SelectTrigger>
                          <SelectContent>
                            {param.bands.map((b, i) => <SelectItem key={i} value={String(i)}>{rangeLabel(b, sexes, words)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {/* A span, not a <p>, because the studio has no CSS reset and a <p> keeps a 1em margin. */}
                        {range ? <span className="text-xs text-muted-foreground">{range}</span> : null}
                      </div>
                    ) : null}
                    {misfit && band ? (
                      <div className="mt-1 text-xs text-amber-700">{words.misfit.replace('{label}', criteriaLabel(band, sexes, words))}</div>
                    ) : null}
                  </div>
                </Fragment>
              );
            }
```

In `apps/studio/src/forms-runtime/TestDetailsField.tsx`:

Add `type CatalogSexOption` to the `@/api` import, and add:

```ts
import type { RangeCopy } from './rangeLabel';
```

Change `export interface TestDetailsCopy {` to `export interface TestDetailsCopy extends RangeCopy {`.

Add beside the other state:

```ts
  const [sexes, setSexes] = useState<CatalogSexOption[]>([]);
```

In the effect's `.then`, set the sexes too:

```ts
      .then((answer) => { if (!cancelled) { setParams(answer.tests); setReasons(answer.rejectReasons); setSexes(answer.sexes); } })
```

Pass the new props to the sheet:

```tsx
        <TestDetailSheet
          test={open}
          params={paramsFor(open)}
          detail={detailFor(open)}
          sexes={sexes}
          copy={copy}
          onChange={(detail) => write(open, detail)}
          onClose={() => setOpenTest(null)}
        />
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/forms-runtime src/api.testCatalog.test.ts --testTimeout 30000`

Expected: PASS, every test.

- [ ] **Step 5: Typecheck the package**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/nr-t8-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/forms-runtime/TestDetailSheet.tsx apps/studio/src/forms-runtime/TestDetailSheet.test.tsx apps/studio/src/forms-runtime/TestDetailsField.tsx apps/studio/src/forms-runtime/TestDetailsField.test.tsx apps/studio/src/api.testCatalog.test.ts
git commit -m "feat(studio): pick the reference range for each result" -m "A numeric parameter with ranges gets a picker listing every range by name, or by who it is for. It starts on the range the server matched. Picking stores that range with the result, the flag and range text follow it, and a range that does not fit the patient shows a warning but stays picked. A fit the server could not work out shows nothing."
```

---

### Task 9: the translated range words

**Files:**
- Modify: `apps/studio/src/pages/FormCapture.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: `TestDetailsCopy extends RangeCopy` (Task 8).

- [ ] **Step 1: Know what guards this task**

No test reads the copy `FormCapture.tsx` hands `FormRuntime`: `FormCapture.test.tsx` never inspects `FormRuntime`'s props, and adding a mock of the runtime to check a literal object is more than this needs. The runtime half is already pinned, because `FormRuntime.test.tsx` fails if `testDetailsCopy` stops reaching the results field. The i18n parity test (`src/i18n/parity.test.ts`) fails if a key lands in one language only. What stays unproven is that the page passes these seven keys. Say so in the report, and cover it in the live check.

- [ ] **Step 2: Implement**

In `apps/studio/src/pages/FormCapture.tsx`, change `const { t } = useTranslation();` to `const { t, i18n } = useTranslation();`, and add to the `testDetailsCopy` object, after `rejected`:

```tsx
                language: i18n.language,
                range: t('forms.range'),
                chooseRange: t('forms.rangeChoose'),
                misfit: t('forms.rangeMisfit'),
                anyone: t('forms.rangeAnyone'),
                ageFrom: t('forms.rangeAgeFrom'),
                ageTo: t('forms.rangeAgeTo'),
                ageBetween: t('forms.rangeAgeBetween'),
```

In `en.ts`, in `forms`, after `testsRejected`:

```ts
    range: 'Range',
    rangeChoose: 'Choose a range',
    rangeMisfit: 'This range is for {label}',
    rangeAnyone: 'Anyone',
    rangeAgeFrom: '{from}+',
    rangeAgeTo: 'up to {to}',
    rangeAgeBetween: '{from} to {to}',
```

In `fr.ts`, same place:

```ts
    range: 'Intervalle',
    rangeChoose: 'Choisir un intervalle',
    rangeMisfit: 'Cet intervalle est pour {label}',
    rangeAnyone: 'Tout le monde',
    rangeAgeFrom: '{from} ans et plus',
    rangeAgeTo: "jusqu'à {to} ans",
    rangeAgeBetween: '{from} à {to} ans',
```

In `pt.ts`, same place:

```ts
    range: 'Intervalo',
    rangeChoose: 'Escolher um intervalo',
    rangeMisfit: 'Este intervalo é para {label}',
    rangeAnyone: 'Todos',
    rangeAgeFrom: '{from} anos ou mais',
    rangeAgeTo: 'até {to} anos',
    rangeAgeBetween: '{from} a {to} anos',
```

The single braces are not i18next interpolation, so they pass through for `rangeLabel` to replace.

- [ ] **Step 3: Run the tests**

Run: `cd apps/studio && npx vitest run src/pages/FormCapture.test.tsx src/i18n --testTimeout 30000`

Expected: PASS.

- [ ] **Step 4: Typecheck the package**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/nr-t9-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/pages/FormCapture.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): translate the range picker on the capture page" -m "The capture page hands the results sheet its range words and the page language, in English, French and Portuguese, so an unnamed range reads Femme 15 ans et plus in French."
```


---

### Task 10: docs, gate and report

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/test-catalog.md` (the "Result parameters" paragraph on bands, line 67)
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md` (the results section, lines 231-235 in en, 111-115 in fr and pt)
- Modify: `apps/web/src/docs/0.1.8/test-catalog.md` (lines 18, 35, 51)
- Modify: `apps/web/src/docs/0.1.8/forms.md` (lines 106, 212, 317)

- [ ] **Step 1: Write the docs**

In each `test-catalog.md`, replace the paragraph on bands with one saying: a numeric parameter can carry reference ranges; each range has a low, a high, a unit, an optional name such as Highland women, and may name a sex and an age window; the range row's `⋯` menu moves it up, moves it down or removes it, and the parameter's `⋯` menu adds one; order decides which range starts selected at the bench; two ranges on one parameter cannot share a name.

In each studio `forms.md` results section, after the paragraph on the flag, add one saying: each numeric result has a range picker listing every range by name, or by who it is for; it starts on the range that fits the patient; picking a range that does not fit shows a warning and is allowed; the flag follows the picked range; if the ranges changed after the test was opened, the order is refused until the test is reopened.

In the web `test-catalog.md` and `forms.md`, add one sentence in each language beside the existing sentence on bands or on the results row, saying ranges can be named and the bench picks the range for each result.

- [ ] **Step 2: Run the docs tests**

Run: `cd apps/studio && npx vitest run src/docs --testTimeout 30000`

Run: `cd apps/web && npx vitest run src/docs --testTimeout 30000`

Expected: PASS in both.

- [ ] **Step 3: Check the added lines for em dashes**

Run: `git diff -- apps/studio/src/docs apps/web/src/docs | grep '^+' | grep -c $'\xe2\x80\x94'`

Expected: `0`.

- [ ] **Step 4: Commit the docs**

```bash
git add apps/studio/src/docs/0.1.8/en/test-catalog.md apps/studio/src/docs/0.1.8/fr/test-catalog.md apps/studio/src/docs/0.1.8/pt/test-catalog.md apps/studio/src/docs/0.1.8/en/forms.md apps/studio/src/docs/0.1.8/fr/forms.md apps/studio/src/docs/0.1.8/pt/forms.md apps/web/src/docs/0.1.8/test-catalog.md apps/web/src/docs/0.1.8/forms.md
git commit -m "docs(forms): named reference ranges and picking them at the bench" -m "The in-app guides and the web pages, in English, French and Portuguese, say how to name a range and set its sex, age and order, and how the bench picks the range for each result."
```

- [ ] **Step 5: Run the forced gate**

Run: `pnpm turbo run typecheck --force --concurrency=4 > "$TEMP/nr-gate-tc.txt" 2>&1; echo "exit=$?"`

Run: `pnpm turbo run test --force --concurrency=4 --continue > "$TEMP/nr-gate-test.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src > "$TEMP/nr-gate-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` three times. On a test failure, grep for `Test timed out`, then re-run that package alone before blaming a change.

- [ ] **Step 6: Report, then stop**

Report to the operator:

1. The gate's three exit codes and each changed package's test count.
2. What each layer proves:
   - Bootstrap: a name survives parse and save, fit answers yes, no and unknown, the save refusals, the sex choices.
   - Route: zod keeps the name and a null name, result-params sends the sex choices.
   - Forms: the answer keeps the name, the Observation gets `referenceRange.text`.
   - Forms route: a range not in the catalog refuses the order and stores nothing, a held named range is accepted.
   - CLI: a params set file keeps the name.
   - Studio: labels, the editor's name, sex, age, move and remove, the picker's start, pick, flag, warning, quiet unknown and translated words.
3. **HONEST NON-PROOF**, each with what would prove it:
   - A live submit on the dev database reaching a stored Observation with `referenceRange.text`. The demo HGB ranges carry sex and age already, so naming one in the Test catalog sheet and submitting an order would prove it.
   - The editor row and picker at 375px on a real phone.
   - A central install syncing named ranges to a lab.
4. Anything skipped or changed from this plan, and why. Task 9 adds no test of the page's copy, by design.

Then ask the operator before merging, pushing, or running a live check. After a merge to `main`, run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json` (AGENTS.md section 6, item 5).
