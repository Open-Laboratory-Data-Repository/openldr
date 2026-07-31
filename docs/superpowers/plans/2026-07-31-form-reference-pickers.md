# Form Reference Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `fieldType: 'reference'` form fields resolve against real data — a searchable picker at capture time and enforced reference integrity at submit — so the Lab order form's Patient and Tests fields stop accepting arbitrary text.

**Architecture:** A pure classifier in `@openldr/forms` decides what a field declares (a ValueSet, a coding system, or an entity type). A field-scoped server endpoint reads the stored form schema, derives the source itself, and dispatches to a coding resolver (terminology) or an entity resolver (the `patients` read model). Studio renders one `ReferencePicker` driven by the kind the server returns. Validation runs in three layers, with the server as the authority.

**Tech Stack:** TypeScript, Zod, Fastify, Kysely, React, vitest, shadcn/ui.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-form-reference-pickers-design.md`. Read it before Task 1.
- **No `Co-Authored-By` trailer on any commit.** The user is sole contributor.
- Studio imports forms helpers from `@openldr/forms/pure` only — never `@openldr/forms`. Anything the browser needs must be added to `packages/forms/src/pure.ts`.
- `validate-references.ts` must **not** be added to `pure.ts` (it takes a store handle).
- Entity resolver queries must run on Postgres, MySQL and MSSQL. Use `lower(col) LIKE lower(?)`; `ilike` is Postgres-only.
- The entity resolver must **not** consult `columnPolicy` — see spec §3 for why.
- `select` / `multiselect` serialization must not change. Their existing tests stay green as proof.
- Run a package's tests with `pnpm --filter <name> exec vitest run <file>`. Never pipe turbo through `tail`.

---

### Task 1: Source classifier

**Files:**
- Create: `packages/forms/src/reference-source.ts`
- Create: `packages/forms/src/reference-source.test.ts`
- Modify: `packages/forms/src/pure.ts:12` (add re-export)
- Modify: `packages/forms/src/index.ts:24` (add re-export)

**Interfaces:**
- Consumes: `FormField` from `./schema/form-schema`.
- Produces: `ReferenceSource`, `ReferenceSourceResult`, `CodingAnswer`, `EntityAnswer`, `resolveReferenceSource(field)`, `isCodingAnswer(v)`, `isEntityAnswer(v)`. Tasks 2, 3, 4, 5, 8, 11, 12 all import from here.

- [ ] **Step 1: Write the failing test**

```ts
// packages/forms/src/reference-source.test.ts
import { describe, expect, it } from 'vitest';
import type { FormField } from './schema/form-schema';
import { isCodingAnswer, isEntityAnswer, resolveReferenceSource } from './reference-source';

const field = (over: Partial<FormField>): FormField => ({
  id: 'f', fhirPath: null, displayLabel: 'F', description: null,
  fieldType: 'reference', required: false, enabled: true, order: 0,
  cardinality: { min: 0, max: '1' }, ...over,
});

describe('resolveReferenceSource', () => {
  it('classifies valueSetUrl as a valueset source', () => {
    expect(resolveReferenceSource(field({ valueSetUrl: 'http://x/vs/orderables' })))
      .toEqual({ ok: true, source: { kind: 'coding', mode: 'valueset', url: 'http://x/vs/orderables' } });
  });

  it('classifies a canonical URL referenceTarget as a codesystem source', () => {
    expect(resolveReferenceSource(field({ referenceTarget: 'http://loinc.org' })))
      .toEqual({ ok: true, source: { kind: 'coding', mode: 'codesystem', system: 'http://loinc.org' } });
  });

  it('classifies a cs-url-* referenceTarget as a codesystem source', () => {
    expect(resolveReferenceSource(field({ referenceTarget: 'cs-url-LOINC' })))
      .toEqual({ ok: true, source: { kind: 'coding', mode: 'codesystem', system: 'cs-url-LOINC' } });
  });

  it('classifies a bare name referenceTarget as an entity source', () => {
    expect(resolveReferenceSource(field({ referenceTarget: 'Patient' })))
      .toEqual({ ok: true, source: { kind: 'entity', target: 'Patient' } });
  });

  it('prefers valueSetUrl when both are set', () => {
    const r = resolveReferenceSource(field({ valueSetUrl: 'http://x/vs', referenceTarget: 'Patient' }));
    expect(r).toEqual({ ok: true, source: { kind: 'coding', mode: 'valueset', url: 'http://x/vs' } });
  });

  it('reports no-source when neither is set', () => {
    expect(resolveReferenceSource(field({}))).toEqual({ ok: false, reason: 'no-source' });
  });

  it('treats blank strings as absent', () => {
    expect(resolveReferenceSource(field({ valueSetUrl: '  ', referenceTarget: '' })))
      .toEqual({ ok: false, reason: 'no-source' });
  });
});

describe('answer guards', () => {
  it('recognises a coding answer', () => {
    expect(isCodingAnswer({ system: 's', code: 'c', display: null })).toBe(true);
    expect(isCodingAnswer({ reference: 'Patient/1', display: null })).toBe(false);
    expect(isCodingAnswer('plain')).toBe(false);
  });

  it('recognises an entity answer', () => {
    expect(isEntityAnswer({ reference: 'Patient/1', display: 'X' })).toBe(true);
    expect(isEntityAnswer({ system: 's', code: 'c', display: null })).toBe(false);
    expect(isEntityAnswer(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/forms exec vitest run src/reference-source.test.ts`
Expected: FAIL — `Failed to resolve import "./reference-source"`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/forms/src/reference-source.ts
import type { FormField } from './schema/form-schema';

/** What a reference field searches. Declared by the field; existence checked server-side. */
export type ReferenceSource =
  | { kind: 'coding'; mode: 'valueset'; url: string }
  | { kind: 'coding'; mode: 'codesystem'; system: string }
  | { kind: 'entity'; target: string };

export type ReferenceSourceResult =
  | { ok: true; source: ReferenceSource }
  | { ok: false; reason: 'no-source' };

/** A resolved coding answer (ValueSet / CodeSystem picker). */
export interface CodingAnswer { system: string; code: string; display: string | null }
/** A resolved entity answer (Patient and friends). */
export interface EntityAnswer { reference: string; display: string | null }

const trimmed = (v: string | undefined): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
};

/** True for identifiers that name a coding system rather than an entity type. */
function isCodingSystemId(target: string): boolean {
  return /^https?:\/\//i.test(target) || /^urn:/i.test(target) || target.startsWith('cs-url-');
}

/**
 * Classify what a field declares. Pure, synchronous, browser-safe — it does NOT
 * check that the declared source exists. The server does that at search time, so a
 * form binding to a not-yet-installed terminology system stays publishable.
 */
export function resolveReferenceSource(field: FormField): ReferenceSourceResult {
  const url = trimmed(field.valueSetUrl);
  if (url) return { ok: true, source: { kind: 'coding', mode: 'valueset', url } };

  const target = trimmed(field.referenceTarget);
  if (target) {
    return isCodingSystemId(target)
      ? { ok: true, source: { kind: 'coding', mode: 'codesystem', system: target } }
      : { ok: true, source: { kind: 'entity', target } };
  }
  return { ok: false, reason: 'no-source' };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isCodingAnswer(v: unknown): v is CodingAnswer {
  return isRecord(v) && typeof v.system === 'string' && typeof v.code === 'string';
}

export function isEntityAnswer(v: unknown): v is EntityAnswer {
  return isRecord(v) && typeof v.reference === 'string';
}

/** Field types that carry a reference-family answer. */
export const REFERENCE_FIELD_TYPES = ['reference', 'facility', 'organism', 'antibiogram'] as const;

export function isReferenceFieldType(t: string): boolean {
  return (REFERENCE_FIELD_TYPES as readonly string[]).includes(t);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/forms exec vitest run src/reference-source.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Export from BOTH entry points**

The browser needs it (lint, the picker) and so does the server (the search routes), and the two entries are maintained separately — `pure.ts` is not a subset re-exported by `index.ts`.

In `packages/forms/src/pure.ts`, add after the `validate-answers` line:

```ts
export * from './reference-source';
```

In `packages/forms/src/index.ts`, add the identical line after its own `validate-answers` line. Omitting this one breaks Task 8, which imports `resolveReferenceSource` from `@openldr/forms`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @openldr/forms exec tsc --noEmit`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add packages/forms/src/reference-source.ts packages/forms/src/reference-source.test.ts packages/forms/src/pure.ts packages/forms/src/index.ts
git commit -m "feat(forms): classify what a reference field declares"
```

---

### Task 2: Lint rules for reference sources

**Files:**
- Modify: `packages/forms/src/lint.ts:8-17` (add codes), `:30-84` (add checks)
- Modify: `packages/forms/src/lint.test.ts`

**Interfaces:**
- Consumes: `resolveReferenceSource`, `isReferenceFieldType` from Task 1.
- Produces: lint codes `'reference-missing-source'` and `'reference-ambiguous-source'`.

- [ ] **Step 1: Write the failing test**

Append to `packages/forms/src/lint.test.ts`:

```ts
describe('reference source lint', () => {
  const base = {
    id: 'form-1', name: 'F', versionLabel: null, fhirVersion: 'R4' as const,
    fhirResourceType: null, fhirProfileUrl: null, facilityId: null,
    targetPages: [], sections: [], version: 1, active: true,
    status: 'draft' as const, createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
  };
  const refField = (over: Record<string, unknown>) => ({
    id: 'r', fhirPath: null, displayLabel: 'R', description: null,
    fieldType: 'reference' as const, required: false, enabled: true, order: 0,
    cardinality: { min: 0, max: '1' }, ...over,
  });

  it('errors when a reference field declares no source', () => {
    const issues = lintFormSchema({ ...base, fields: [refField({})] } as never);
    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'reference-missing-source', fieldId: 'r',
    }));
  });

  it('accepts a reference field with a referenceTarget', () => {
    const issues = lintFormSchema({ ...base, fields: [refField({ referenceTarget: 'Patient' })] } as never);
    expect(issues.filter((i) => i.code === 'reference-missing-source')).toEqual([]);
  });

  it('warns when both valueSetUrl and referenceTarget are set', () => {
    const issues = lintFormSchema({
      ...base, fields: [refField({ valueSetUrl: 'http://x/vs', referenceTarget: 'Patient' })],
    } as never);
    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'warning', code: 'reference-ambiguous-source', fieldId: 'r',
    }));
  });

  it('warns rather than errors for a sourceless facility field', () => {
    const issues = lintFormSchema({
      ...base, fields: [refField({ fieldType: 'facility' })],
    } as never);
    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'warning', code: 'reference-missing-source', fieldId: 'r',
    }));
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/forms exec vitest run src/lint.test.ts`
Expected: FAIL — the new `describe` block fails; existing tests still pass

- [ ] **Step 3: Add the lint codes**

In `packages/forms/src/lint.ts`, extend the `code` union (currently ending `| 'target-contract-violation'`):

```ts
    | 'target-contract-violation'
    | 'reference-missing-source'
    | 'reference-ambiguous-source';
```

Add the import at the top, after the `page-targets` import:

```ts
import { isReferenceFieldType, resolveReferenceSource } from './reference-source';
```

- [ ] **Step 4: Add the checks**

In `lintFormSchema`, inside the `for (const field of form.fields)` loop, immediately after the `select/multiselect missing options` block:

```ts
    // reference-family source declaration. `reference` is an error (it has no usable
    // fallback); facility/organism/antibiogram warn, because they degrade to a text
    // input rather than becoming unusable.
    if (isReferenceFieldType(field.fieldType)) {
      const resolved = resolveReferenceSource(field);
      if (!resolved.ok) {
        issues.push({
          severity: field.fieldType === 'reference' ? 'error' : 'warning',
          code: 'reference-missing-source',
          message: `Field "${field.id}" is a ${field.fieldType} but declares neither valueSetUrl nor referenceTarget`,
          fieldId: field.id,
        });
      } else if (field.valueSetUrl && field.referenceTarget) {
        issues.push({
          severity: 'warning',
          code: 'reference-ambiguous-source',
          message: `Field "${field.id}" sets both valueSetUrl and referenceTarget; valueSetUrl wins`,
          fieldId: field.id,
        });
      }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/forms exec vitest run src/lint.test.ts`
Expected: PASS — including all pre-existing lint tests

- [ ] **Step 6: Commit**

```bash
git add packages/forms/src/lint.ts packages/forms/src/lint.test.ts
git commit -m "feat(forms): lint reference fields that declare no source"
```

---

### Task 3: Serialize resolved reference answers

**Files:**
- Modify: `packages/forms/src/answer-value.ts:10-44`
- Modify: `packages/forms/src/answer-value.test.ts` (create if absent)

**Interfaces:**
- Consumes: `isCodingAnswer`, `isEntityAnswer` from Task 1.
- Produces: `toAnswer` / `fromAnswer` handling object-shaped values. Task 9 relies on the QR carrying `system` and `display`.

- [ ] **Step 1: Write the failing test**

Create or append to `packages/forms/src/answer-value.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FormField } from './schema/form-schema';
import { fromAnswer, toAnswer } from './answer-value';

const field = (over: Partial<FormField>): FormField => ({
  id: 'f', fhirPath: null, displayLabel: 'F', description: null,
  fieldType: 'reference', required: false, enabled: true, order: 0,
  cardinality: { min: 0, max: '1' }, ...over,
});

describe('toAnswer — reference answers', () => {
  it('serializes a coding answer with its system and display', () => {
    expect(toAnswer(field({}), { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }))
      .toEqual({ valueCoding: { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' } });
  });

  it('omits display when null', () => {
    expect(toAnswer(field({}), { system: 'http://loinc.org', code: '718-7', display: null }))
      .toEqual({ valueCoding: { system: 'http://loinc.org', code: '718-7' } });
  });

  it('serializes an entity answer with its display', () => {
    expect(toAnswer(field({}), { reference: 'Patient/p1', display: 'Doe Jane' }))
      .toEqual({ valueReference: { reference: 'Patient/p1', display: 'Doe Jane' } });
  });

  it('keeps the legacy bare-string mapping for reference and facility', () => {
    expect(toAnswer(field({}), 'Patient/p1')).toEqual({ valueReference: { reference: 'Patient/p1' } });
    expect(toAnswer(field({ fieldType: 'facility' }), 'Organization/o1'))
      .toEqual({ valueReference: { reference: 'Organization/o1' } });
  });

  it('keeps the legacy bare-string mapping for organism and antibiogram', () => {
    expect(toAnswer(field({ fieldType: 'organism' }), 'E. coli')).toEqual({ valueString: 'E. coli' });
    expect(toAnswer(field({ fieldType: 'antibiogram' }), 'AMP-R')).toEqual({ valueString: 'AMP-R' });
  });

  it('leaves select and multiselect untouched', () => {
    expect(toAnswer(field({ fieldType: 'select' }), 'routine')).toEqual({ valueCoding: { code: 'routine' } });
    expect(toAnswer(field({ fieldType: 'multiselect' }), 'a')).toEqual({ valueCoding: { code: 'a' } });
  });
});

describe('fromAnswer', () => {
  it('reconstructs a coding answer when a system is present', () => {
    expect(fromAnswer({ valueCoding: { system: 'http://loinc.org', code: '718-7', display: 'Hb' } }))
      .toEqual({ system: 'http://loinc.org', code: '718-7', display: 'Hb' });
  });

  it('returns a bare code when no system is present, so select still round-trips', () => {
    expect(fromAnswer({ valueCoding: { code: 'routine' } })).toBe('routine');
  });

  it('reconstructs an entity answer when a display is present', () => {
    expect(fromAnswer({ valueReference: { reference: 'Patient/p1', display: 'Doe Jane' } }))
      .toEqual({ reference: 'Patient/p1', display: 'Doe Jane' });
  });

  it('returns a bare reference when no display is present, so legacy answers still round-trip', () => {
    expect(fromAnswer({ valueReference: { reference: 'Patient/123' } })).toBe('Patient/123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/forms exec vitest run src/answer-value.test.ts`
Expected: FAIL — coding answers currently serialize via `String(value)` into `valueReference`

- [ ] **Step 3: Rewrite `toAnswer` and `fromAnswer`**

Replace the body of `packages/forms/src/answer-value.ts` below the imports with:

```ts
import { isCodingAnswer, isEntityAnswer } from './reference-source'

/** Filled-in form values, keyed by field id (the app's `values` shape). */
export type AnswerState = Record<string, unknown>

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === ''

/** Encode a single scalar value as a QuestionnaireResponse answer, by field type. */
export function toAnswer(field: FormField, value: unknown): QuestionnaireResponseItemAnswer | null {
  if (isEmpty(value)) return null

  // Object-shaped answers are produced only by a resolved reference picker. They are
  // dispatched on shape, not field type, so every legacy bare-string mapping below is
  // preserved exactly — including valueString for organism/antibiogram.
  if (isCodingAnswer(value)) {
    return {
      valueCoding: {
        system: value.system,
        code: value.code,
        ...(value.display ? { display: value.display } : {}),
      },
    }
  }
  if (isEntityAnswer(value)) {
    return {
      valueReference: {
        reference: value.reference,
        ...(value.display ? { display: value.display } : {}),
      },
    }
  }

  switch (field.fieldType) {
    case 'number':
      return { valueDecimal: Number(value) }
    case 'boolean':
      return { valueBoolean: Boolean(value) }
    case 'date':
      return { valueDate: String(value) }
    case 'datetime':
      return { valueDateTime: String(value) }
    case 'select':
    case 'multiselect':
      return { valueCoding: { code: String(value) } }
    case 'reference':
    case 'facility':
      return { valueReference: { reference: String(value) } }
    default:
      // text, phone, email, identifier, address, attachment, organism, antibiogram, group
      return { valueString: String(value) }
  }
}

/** Decode a QuestionnaireResponse answer back to a raw value (by which value[x] is present). */
export function fromAnswer(answer: QuestionnaireResponseItemAnswer): unknown {
  if (answer.valueDecimal !== undefined) return answer.valueDecimal
  if (answer.valueInteger !== undefined) return answer.valueInteger
  if (answer.valueBoolean !== undefined) return answer.valueBoolean
  if (answer.valueDate !== undefined) return answer.valueDate
  if (answer.valueDateTime !== undefined) return answer.valueDateTime
  if (answer.valueCoding !== undefined) {
    // A system is the discriminator: select/multiselect write a bare code and must keep
    // decoding to a string, or every existing select round-trip breaks.
    return answer.valueCoding.system
      ? { system: answer.valueCoding.system, code: answer.valueCoding.code ?? '', display: answer.valueCoding.display ?? null }
      : answer.valueCoding.code ?? ''
  }
  if (answer.valueReference !== undefined) {
    // Display is the discriminator here, mirroring the system check above: a legacy bare
    // reference has none and must keep decoding to a string, or the existing round-trip
    // test at answer-value.test.ts:166 breaks.
    return answer.valueReference.display
      ? { reference: answer.valueReference.reference ?? '', display: answer.valueReference.display }
      : answer.valueReference.reference ?? ''
  }
  if (answer.valueString !== undefined) return answer.valueString
  return undefined
}
```

Keep the existing `import type { FormField } ...` and `import type { QuestionnaireResponseItemAnswer } ...` lines at the top.

- [ ] **Step 4: Run the package's full suite**

Run: `pnpm --filter @openldr/forms exec vitest run`
Expected: PASS with **no existing assertion edited**.

`answer-value.test.ts` already contains two legacy reference tests — `encodes reference as valueReference` (line ~71) and `reference: round-trips as reference string` (line ~166). Both must keep passing untouched: the first exercises `toAnswer`'s bare-string path, the second the display-absent decode rule. If either fails, the legacy path regressed — fix the implementation, do not edit the assertion. `round-trip.test.ts` and `to-questionnaire.test.ts` also exercise `fromAnswer`.

- [ ] **Step 5: Commit**

```bash
git add packages/forms/src/answer-value.ts packages/forms/src/answer-value.test.ts
git commit -m "feat(forms): carry system and display through reference answers"
```

---

### Task 4: Shape validation in validateAnswers

**Files:**
- Modify: `packages/forms/src/validate-answers.ts:25-60`
- Modify: `packages/forms/src/validate-answers.test.ts`

**Interfaces:**
- Consumes: `isCodingAnswer`, `isEntityAnswer`, `isReferenceFieldType` from Task 1.
- Produces: `validateAnswers` unchanged in signature — still pure and synchronous.

- [ ] **Step 1: Write the failing test**

Append to `packages/forms/src/validate-answers.test.ts`:

```ts
describe('reference shape validation', () => {
  const model = (over: Record<string, unknown> = {}) => ({
    id: 'm', name: 'M', versionLabel: null, fhirVersion: 'R4',
    fhirResourceType: null, fhirProfileUrl: null, facilityId: null,
    targetPages: [], sections: [], version: 1, active: true, status: 'draft',
    createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
    fields: [{
      id: 'p', fhirPath: null, displayLabel: 'Patient', description: null,
      fieldType: 'reference', required: false, enabled: true, order: 0,
      cardinality: { min: 0, max: '1' }, referenceTarget: 'Patient', ...over,
    }],
  }) as never;

  it('rejects a bare string in a reference field', () => {
    expect(validateAnswers(model(), { p: 'asdf' })).toEqual([
      { fieldId: 'p', label: 'Patient', reason: 'must be selected from the list' },
    ]);
  });

  it('rejects an object missing both code and reference', () => {
    expect(validateAnswers(model(), { p: { display: 'Doe Jane' } })).toEqual([
      { fieldId: 'p', label: 'Patient', reason: 'must be selected from the list' },
    ]);
  });

  it('accepts a resolved entity answer', () => {
    expect(validateAnswers(model(), { p: { reference: 'Patient/p1', display: 'Doe Jane' } })).toEqual([]);
  });

  it('accepts a resolved coding answer', () => {
    expect(validateAnswers(model(), { p: { system: 'http://loinc.org', code: '718-7', display: 'Hb' } })).toEqual([]);
  });

  it('checks every element of a multi-valued reference field', () => {
    expect(validateAnswers(model({ repeatable: true, cardinality: { min: 0, max: '*' } }), {
      p: [{ reference: 'Patient/p1', display: null }, 'asdf'],
    })).toEqual([
      { fieldId: 'p', label: 'Patient', reason: 'must be selected from the list' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/forms exec vitest run src/validate-answers.test.ts`
Expected: FAIL — the new block returns `[]` for every case

- [ ] **Step 3: Add the branch**

In `packages/forms/src/validate-answers.ts`, add to the imports:

```ts
import { isCodingAnswer, isEntityAnswer, isReferenceFieldType } from './reference-source';
```

Then inside the `for (const f of model.fields)` loop, insert this as the **first** branch of the type dispatch — before the `select/multiselect` check:

```ts
    if (isReferenceFieldType(f.fieldType)) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (!isCodingAnswer(v) && !isEntityAnswer(v)) {
          push('must be selected from the list');
          break;
        }
      }
    } else if (f.fieldType === 'select' || f.fieldType === 'multiselect') {
```

and change the existing `if (f.fieldType === 'select' || f.fieldType === 'multiselect') {` line into the `} else if (...) {` shown above, so the chain stays exclusive.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/forms exec vitest run src/validate-answers.test.ts`
Expected: PASS — including the pre-existing cases

- [ ] **Step 5: Confirm the workflow caller is unaffected**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/form-validate-service.test.ts`
Expected: PASS with no changes to that file — `validateAnswers` kept its signature.

- [ ] **Step 6: Commit**

```bash
git add packages/forms/src/validate-answers.ts packages/forms/src/validate-answers.test.ts
git commit -m "feat(forms): reject unresolved values in reference fields"
```

---

### Task 5: Reference existence validation

**Files:**
- Create: `packages/forms/src/validate-references.ts`
- Create: `packages/forms/src/validate-references.test.ts`
- Modify: `packages/forms/src/index.ts` (add re-export — **not** `pure.ts`)

**Interfaces:**
- Consumes: `AnswerError` from `./validate-answers`; `resolveReferenceSource`, `isCodingAnswer`, `isEntityAnswer`, `isReferenceFieldType` from Task 1.
- Produces: `ReferenceValidationDeps`, `validateReferences(model, answers, deps): Promise<AnswerError[]>`. Task 9 calls it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/forms/src/validate-references.test.ts
import { describe, expect, it } from 'vitest';
import { validateReferences, type ReferenceValidationDeps } from './validate-references';

const model = (over: Record<string, unknown> = {}) => ({
  id: 'm', name: 'M', versionLabel: null, fhirVersion: 'R4',
  fhirResourceType: null, fhirProfileUrl: null, facilityId: null,
  targetPages: [], sections: [], version: 1, active: true, status: 'draft',
  createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
  fields: [{
    id: 'p', fhirPath: null, displayLabel: 'Patient', description: null,
    fieldType: 'reference', required: false, enabled: true, order: 0,
    cardinality: { min: 0, max: '1' }, referenceTarget: 'Patient', ...over,
  }],
}) as never;

const deps = (over: Partial<ReferenceValidationDeps> = {}): ReferenceValidationDeps => ({
  validateCode: async () => ({ result: true, message: 'ok' }),
  exists: async () => true,
  ...over,
});

describe('validateReferences', () => {
  it('accepts an entity answer that exists', async () => {
    expect(await validateReferences(model(), { p: { reference: 'Patient/p1', display: null } }, deps()))
      .toEqual([]);
  });

  it('rejects an entity answer that does not exist', async () => {
    const errors = await validateReferences(
      model(), { p: { reference: 'Patient/ghost', display: null } }, deps({ exists: async () => false }),
    );
    expect(errors).toEqual([{ fieldId: 'p', label: 'Patient', reason: 'Patient/ghost does not exist' }]);
  });

  it('rejects a malformed reference string', async () => {
    const errors = await validateReferences(model(), { p: { reference: 'nope', display: null } }, deps());
    expect(errors).toEqual([{ fieldId: 'p', label: 'Patient', reason: "'nope' is not a valid reference" }]);
  });

  it('rejects a coding outside its ValueSet', async () => {
    const errors = await validateReferences(
      model({ referenceTarget: undefined, valueSetUrl: 'http://x/vs' }),
      { p: { system: 'http://loinc.org', code: 'bad', display: null } },
      deps({ validateCode: async () => ({ result: false, message: 'bad not in http://x/vs' }) }),
    );
    expect(errors).toEqual([{ fieldId: 'p', label: 'Patient', reason: 'bad not in http://x/vs' }]);
  });

  it('reports a terminology failure as a field error rather than throwing', async () => {
    const errors = await validateReferences(
      model({ referenceTarget: 'http://loinc.org' }),
      { p: { system: 'http://loinc.org', code: '718-7', display: null } },
      deps({ validateCode: async () => { throw new Error('terminology unreachable'); } }),
    );
    expect(errors).toEqual([{ fieldId: 'p', label: 'Patient', reason: 'could not be checked: terminology unreachable' }]);
  });

  it('ignores empty and non-reference fields', async () => {
    expect(await validateReferences(model(), {}, deps())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/forms exec vitest run src/validate-references.test.ts`
Expected: FAIL — `Failed to resolve import "./validate-references"`

- [ ] **Step 3: Write the implementation**

```ts
// packages/forms/src/validate-references.ts
import type { FormSchema } from './schema/form-schema';
import type { AnswerState } from './answer-value';
import type { AnswerError } from './validate-answers';
import { isCodingAnswer, isEntityAnswer, isReferenceFieldType, resolveReferenceSource } from './reference-source';

/** I/O this validator needs. Injected so the module stays free of store and HTTP handles. */
export interface ReferenceValidationDeps {
  validateCode(input: { valueSetUrl: string; code: string; system?: string } | { system: string; code: string }): Promise<{ result: boolean; message: string }>;
  exists(resourceType: string, id: string): Promise<boolean>;
}

const REFERENCE_RE = /^([A-Za-z]+)\/(.+)$/;

/**
 * Check that resolved reference answers point at things that exist. Async and I/O-bound,
 * deliberately separate from the pure `validateAnswers` — see the spec, §5. Never throws:
 * an unreachable dependency becomes a field error, because silently accepting an
 * unverifiable reference is the failure mode this whole feature exists to remove.
 */
export async function validateReferences(
  model: FormSchema,
  answers: AnswerState,
  deps: ReferenceValidationDeps,
): Promise<AnswerError[]> {
  const errors: AnswerError[] = [];

  for (const f of model.fields) {
    if (f.enabled === false) continue;
    if (!isReferenceFieldType(f.fieldType)) continue;

    const raw = answers[f.id];
    if (raw === undefined || raw === null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    const push = (reason: string): void => { errors.push({ fieldId: f.id, label: f.displayLabel, reason }); };

    const resolved = resolveReferenceSource(f);

    for (const v of values) {
      if (isEntityAnswer(v)) {
        const m = REFERENCE_RE.exec(v.reference);
        if (!m) { push(`'${v.reference}' is not a valid reference`); continue; }
        try {
          if (!(await deps.exists(m[1]!, m[2]!))) push(`${v.reference} does not exist`);
        } catch (e) {
          push(`could not be checked: ${e instanceof Error ? e.message : String(e)}`);
        }
        continue;
      }

      if (isCodingAnswer(v)) {
        if (!resolved.ok || resolved.source.kind !== 'coding') continue;
        const input = resolved.source.mode === 'valueset'
          ? { valueSetUrl: resolved.source.url, code: v.code, system: v.system }
          : { system: v.system, code: v.code };
        try {
          const r = await deps.validateCode(input);
          if (!r.result) push(r.message);
        } catch (e) {
          push(`could not be checked: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // Non-object values are `validateAnswers`' job (Task 4), not this one.
    }
  }

  return errors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/forms exec vitest run src/validate-references.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Export from the server entry only**

In `packages/forms/src/index.ts`, add:

```ts
export * from './validate-references';
```

Do **not** add it to `pure.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/forms/src/validate-references.ts packages/forms/src/validate-references.test.ts packages/forms/src/index.ts
git commit -m "feat(forms): verify reference answers point at things that exist"
```

---

### Task 6: Text filter on ValueSet $expand

**Files:**
- Modify: `packages/terminology/src/operations.ts:10` (ExpandOptions), `:55-62` (expand)
- Modify: `packages/terminology/src/operations.test.ts`
- Modify: `apps/server/src/terminology-routes.ts:25-31`

**Interfaces:**
- Produces: `ExpandOptions.filter?: string`. Task 8's coding resolver passes it.

- [ ] **Step 1: Write the failing test**

Append to `packages/terminology/src/operations.test.ts`. It already defines `memSource(concepts, resources)` and imports `createOperations` — reuse both:

```ts
describe('expand filter', () => {
  const panel: ConceptRecord[] = [
    { system: 'http://loinc.org', code: '718-7',  display: 'Hemoglobin', status: 'ACTIVE', properties: null },
    { system: 'http://loinc.org', code: '2345-7', display: 'Glucose',    status: 'ACTIVE', properties: null },
  ];
  const vsResource = {
    resourceType: 'ValueSet', url: 'http://x/vs',
    compose: { include: [{ system: 'http://loinc.org' }] },
  };
  const ops = createOperations(memSource(panel, { 'http://x/vs': vsResource }));

  it('matches on display, case-insensitively', async () => {
    const vs = await ops.expand('http://x/vs', { filter: 'hemo' });
    expect(vs.expansion?.contains?.map((c) => c.display)).toEqual(['Hemoglobin']);
  });

  it('matches on code', async () => {
    const vs = await ops.expand('http://x/vs', { filter: '2345-7' });
    expect(vs.expansion?.contains?.map((c) => c.code)).toEqual(['2345-7']);
  });

  it('reports the filtered total, not the unfiltered one', async () => {
    expect((await ops.expand('http://x/vs', { filter: 'hemo' })).expansion?.total).toBe(1);
  });

  it('returns everything when no filter is given', async () => {
    expect((await ops.expand('http://x/vs', {})).expansion?.contains).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/terminology exec vitest run src/operations.test.ts`
Expected: FAIL — `filter` is not in `ExpandOptions`, so all codes come back

- [ ] **Step 3: Implement the filter**

In `packages/terminology/src/operations.ts`, change `ExpandOptions`:

```ts
export interface ExpandOptions { count?: number; offset?: number; filter?: string }
```

and replace the body of `expand`:

```ts
  async function expand(url: string, opts: ExpandOptions): Promise<ValueSet> {
    const vs = await loadValueSet(url);
    const { codes, total } = await expandCompose((vs.compose ?? { include: [] }) as VsCompose, makeDeps(source), { seedUrls: [url] });
    // FHIR $expand `filter`: a case-insensitive substring over code and display. Applied
    // before paging so `total` reflects the filtered set, which is what a type-ahead needs.
    const needle = opts.filter?.trim().toLowerCase();
    const matched = needle
      ? codes.filter((c) => c.code.toLowerCase().includes(needle) || (c.display ?? '').toLowerCase().includes(needle))
      : codes;
    const count = opts.count ?? 100;
    const offset = opts.offset ?? 0;
    const page = matched.slice(offset, offset + count);
    return {
      ...vs,
      expansion: {
        total: needle ? matched.length : total,
        offset,
        contains: page.map((c) => ({ system: c.system, code: c.code, display: c.display ?? undefined })),
      },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/terminology exec vitest run src/operations.test.ts`
Expected: PASS

- [ ] **Step 5: Pass the param through the route**

In `apps/server/src/terminology-routes.ts`, replace the `$expand` handler body:

```ts
  app.get('/api/terminology/ValueSet/$expand', async (req, reply) => {
    const { url, count, offset, filter } = req.query as { url?: string; count?: string; offset?: string; filter?: string };
    if (!url) { reply.code(400); return { error: 'url required' }; }
    try {
      return await ops.expand(url, {
        count: count ? Number(count) : undefined,
        offset: offset ? Number(offset) : undefined,
        filter,
      });
    } catch (err) { return mapErr(err, reply); }
  });
```

- [ ] **Step 6: Typecheck both packages**

Run: `pnpm --filter @openldr/terminology exec tsc --noEmit && pnpm --filter @openldr/server exec tsc --noEmit`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add packages/terminology/src/operations.ts packages/terminology/src/operations.test.ts apps/server/src/terminology-routes.ts
git commit -m "feat(terminology): add filter to ValueSet \$expand"
```

---

### Task 7: Patient entity resolver

**Files:**
- Create: `packages/db/src/reference-search.ts`
- Create: `packages/db/src/reference-search.test.ts`
- Modify: `packages/db/src/index.ts` (add re-export)

**Interfaces:**
- Consumes: `ExternalSchema` from `./schema/external`; the `engine` value already threaded beside the target store.
- Produces: `EntityRow`, `EntitySearchResult`, `EntitySearchResolver`, `createPatientResolver(db, engine)`, `ENTITY_TARGETS`. Task 8 consumes all of these.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/reference-search.test.ts
import { describe, expect, it } from 'vitest';
import { createPatientResolver } from './reference-search';
import { makeMigratedExternalDb } from './test-helpers-external';

async function seed() {
  const db = await makeMigratedExternalDb();
  await db.insertInto('patients').values([
    { id: 'p1', surname: 'Doe',  firstname: 'Jane', national_id: 'NID-001', phone: '0770000001', date_of_birth: '1992-01-01', sex: 'F', active: true,  replaced_by_id: null },
    { id: 'p2', surname: 'Doe',  firstname: 'John', national_id: 'NID-002', phone: '0770000002', date_of_birth: '1988-05-09', sex: 'M', active: true,  replaced_by_id: null },
    { id: 'p3', surname: 'Gone', firstname: 'Dup',  national_id: 'NID-003', phone: '0770000003', date_of_birth: '1990-02-02', sex: 'F', active: false, replaced_by_id: null },
    { id: 'p4', surname: 'Merged', firstname: 'Old', national_id: 'NID-004', phone: '0770000004', date_of_birth: '1991-03-03', sex: 'M', active: true, replaced_by_id: 'p1' },
  ] as never).execute();
  return db;
}

describe('createPatientResolver', () => {
  it('matches on surname, case-insensitively', async () => {
    const r = createPatientResolver(await seed(), 'postgres');
    const out = await r.search('doe', 10, 0);
    expect(out.rows.map((x) => x.reference).sort()).toEqual(['Patient/p1', 'Patient/p2']);
    expect(out.total).toBe(2);
  });

  it('matches on firstname, national_id and phone', async () => {
    const r = createPatientResolver(await seed(), 'postgres');
    expect((await r.search('jane', 10, 0)).rows.map((x) => x.reference)).toEqual(['Patient/p1']);
    expect((await r.search('NID-002', 10, 0)).rows.map((x) => x.reference)).toEqual(['Patient/p2']);
    expect((await r.search('0770000001', 10, 0)).rows.map((x) => x.reference)).toEqual(['Patient/p1']);
  });

  it('excludes inactive and merged-away patients', async () => {
    const r = createPatientResolver(await seed(), 'postgres');
    expect((await r.search('gone', 10, 0)).rows).toEqual([]);
    expect((await r.search('merged', 10, 0)).rows).toEqual([]);
  });

  it('renders display and secondary but never the national id', async () => {
    const r = createPatientResolver(await seed(), 'postgres');
    const [row] = (await r.search('jane', 10, 0)).rows;
    expect(row).toEqual({ reference: 'Patient/p1', display: 'Doe Jane', secondary: '1992-01-01 · F' });
    expect(JSON.stringify(row)).not.toContain('NID-001');
  });

  it('honours the limit', async () => {
    const r = createPatientResolver(await seed(), 'postgres');
    const out = await r.search('doe', 1, 0);
    expect(out.rows).toHaveLength(1);
    expect(out.total).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/reference-search.test.ts`
Expected: FAIL — `Failed to resolve import "./reference-search"`

- [ ] **Step 3: Write the implementation**

```ts
// packages/db/src/reference-search.ts
import { sql, type Kysely } from 'kysely';
import type { ExternalSchema } from './schema/external';

/** A row a reference picker can render for an entity source. */
export interface EntityRow {
  reference: string;
  display: string;
  /** Disambiguating detail. Never carries an identifier the searcher didn't already have. */
  secondary: string | null;
}

export interface EntitySearchResult { rows: EntityRow[]; total: number }

export interface EntitySearchResolver {
  search(q: string, limit: number, offset: number): Promise<EntitySearchResult>;
}

/** Entity targets a form field may bind to. Extend as resolvers are added. */
export const ENTITY_TARGETS = ['Patient'] as const;

type Engine = 'postgres' | 'mysql' | 'mssql';

/**
 * Search the `patients` read model.
 *
 * Deliberately does NOT consult columnPolicy: that policy governs analytics exposure and
 * denies every column here, which would make the picker return nothing. See the spec, §3.
 * `national_id` is searchable but never rendered, so an ID is not disclosed to someone who
 * did not already know it.
 */
export function createPatientResolver(db: Kysely<ExternalSchema>, _engine: Engine): EntitySearchResolver {
  const SEARCH_COLUMNS = ['surname', 'firstname', 'national_id', 'patient_guid', 'phone'] as const;

  return {
    async search(q, limit, offset) {
      const needle = `%${q.trim().toLowerCase()}%`;

      // lower(col) LIKE lower(?) holds on Postgres, MySQL and MSSQL alike. The Postgres-only
      // case-insensitive operator does not — and Step 5's guard test forbids its name
      // appearing anywhere in this file, comments included.
      const base = db
        .selectFrom('patients')
        .where('active', '=', true)
        .where('replaced_by_id', 'is', null)
        .where((eb) =>
          eb.or(SEARCH_COLUMNS.map((c) => sql<boolean>`lower(${sql.ref(c)}) like ${needle}`)),
        );

      const rows = await base
        .select(['id', 'surname', 'firstname', 'date_of_birth', 'sex'])
        .orderBy('surname')
        .orderBy('firstname')
        .limit(limit)
        .offset(offset)
        .execute();

      const counted = await base
        .select((eb) => eb.fn.countAll<string | number>().as('n'))
        .executeTakeFirst();

      return {
        rows: rows.map((r) => ({
          reference: `Patient/${String(r.id)}`,
          display: [r.surname, r.firstname].filter(Boolean).join(' ') || String(r.id),
          secondary: [r.date_of_birth, r.sex].filter(Boolean).join(' · ') || null,
        })),
        total: Number(counted?.n ?? 0),
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/db exec vitest run src/reference-search.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Guard portability at the SQL level**

`makeMigratedExternalDb` is pg-mem — Postgres only — so the tests above cannot prove MySQL/MSSQL behaviour. Assert the property that actually breaks portability instead, by inspecting the compiled SQL. Append to the test file:

```ts
import { sql } from 'kysely';

describe('engine portability', () => {
  it('compiles to lower()/LIKE, never ilike', async () => {
    const db = await seed();
    // Capture the SQL the resolver builds by compiling the same predicate shape it uses.
    const compiled = db
      .selectFrom('patients')
      .select('id')
      .where(sql<boolean>`lower(${sql.ref('surname')}) like ${'%doe%'}`)
      .compile();
    expect(compiled.sql.toLowerCase()).toContain('lower(');
    expect(compiled.sql.toLowerCase()).not.toContain('ilike');
  });

  it('the resolver source contains no ilike', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./reference-search.ts', import.meta.url), 'utf8'));
    expect(src.toLowerCase()).not.toContain('ilike');
  });
});
```

Real cross-engine coverage belongs with the live-container suites (see `packages/db/src/migrations/external/reset-roundtrip-live.test.ts` for how those gate). Note in the commit message that MySQL/MSSQL are covered by construction, not by execution.

- [ ] **Step 6: Export it**

In `packages/db/src/index.ts`, add:

```ts
export * from './reference-search';
```

- [ ] **Step 7: Run the package suite and commit**

Run: `pnpm --filter @openldr/db exec vitest run`
Expected: PASS

```bash
git add packages/db/src/reference-search.ts packages/db/src/reference-search.test.ts packages/db/src/index.ts
git commit -m "feat(db): search the patients read model for reference pickers"
```

---

### Task 8: Reference-search endpoints

**Files:**
- Create: `apps/server/src/reference-search-routes.ts`
- Create: `apps/server/src/reference-search-routes.test.ts`
- Modify: `apps/server/src/app.ts` (register the routes — match how `registerFormsRoutes` is registered)

**Interfaces:**
- Consumes: `resolveReferenceSource` (Task 1), `createPatientResolver` / `ENTITY_TARGETS` (Task 7), `ops.expand` with `filter` (Task 6), `ctx.terminology.admin.terms.search`, `ctx.forms.get`.
- Produces: `GET /api/forms/:formId/fields/:fieldId/reference-search` and `POST /api/forms/reference-search/preview`, both returning `{ kind, rows, total }`. Task 10 calls them.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/reference-search-routes.test.ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerReferenceSearchRoutes } from './reference-search-routes';
import './auth-plugin';

const FORM = {
  id: 'form-1',
  schema: {
    id: 'form-1', name: 'Lab order', fields: [
      { id: 'patient',    fieldType: 'reference', displayLabel: 'Patient', referenceTarget: 'Patient' },
      { id: 'tests',      fieldType: 'reference', displayLabel: 'Tests',   referenceTarget: 'ActivityDefinition' },
      { id: 'loinc',      fieldType: 'reference', displayLabel: 'LOINC',   referenceTarget: 'http://loinc.org' },
      { id: 'sourceless', fieldType: 'reference', displayLabel: 'None' },
    ],
  },
};

/** Records the limit the resolver was called with, so the cap can be asserted. */
const calls: { limit: number }[] = [];

function makeApp(capabilities = ['forms.view', 'forms.edit']) {
  calls.length = 0;
  const ctx = {
    forms: { get: async (id: string) => (id === FORM.id ? FORM : null) },
    terminology: {
      ops: { expand: vi.fn() },
      admin: {
        terms: {
          search: async () => ({
            rows: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }],
            total: 1,
          }),
        },
      },
    },
  };
  const resolvers = {
    Patient: {
      search: async (_q: string, limit: number) => {
        calls.push({ limit });
        return { rows: [{ reference: 'Patient/p1', display: 'Doe Jane', secondary: '1992-01-01 · F' }], total: 1 };
      },
    },
  };
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'], capabilities } as never;
  });
  registerReferenceSearchRoutes(app, ctx as never, resolvers as never);
  return app;
}

const url = (fieldId: string, qs: string) => `/api/forms/${FORM.id}/fields/${fieldId}/reference-search?${qs}`;

describe('reference search', () => {
  it('404s for an unknown form', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/api/forms/nope/fields/patient/reference-search?q=doe' });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown field', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('nope', 'q=doe') });
    expect(res.statusCode).toBe(404);
  });

  it('400s for a field that declares no source', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('sourceless', 'q=doe') });
    expect(res.statusCode).toBe(400);
  });

  it('400s for a declared but unregistered entity target', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('tests', 'q=xx') });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('ActivityDefinition');
  });

  it('returns entity rows for a patient-bound field', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('patient', 'q=doe') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'entity', rows: [{ reference: 'Patient/p1' }], total: 1 });
  });

  it('returns coding rows for a codesystem-bound field', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('loinc', 'q=hemo') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'coding', rows: [{ system: 'http://loinc.org', code: '718-7' }] });
  });

  it('returns an empty result for a query under two characters, without hitting a store', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('patient', 'q=d') });
    expect(res.json()).toEqual({ kind: 'entity', rows: [], total: 0 });
    expect(calls).toEqual([]);
  });

  it('caps limit at 50', async () => {
    await makeApp().inject({ method: 'GET', url: url('patient', 'q=doe&limit=500') });
    expect(calls).toEqual([{ limit: 50 }]);
  });

  it('requires forms.edit for preview', async () => {
    const res = await makeApp(['forms.view']).inject({
      method: 'POST', url: '/api/forms/reference-search/preview',
      payload: { field: { id: 'x', fieldType: 'reference', referenceTarget: 'Patient', displayLabel: 'X' }, q: 'doe' },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server exec vitest run src/reference-search-routes.test.ts`
Expected: FAIL — routes not registered

- [ ] **Step 3: Write the routes**

```ts
// apps/server/src/reference-search-routes.ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { resolveReferenceSource, type FormField, type ReferenceSource } from '@openldr/forms';
import { ENTITY_TARGETS, type EntitySearchResolver } from '@openldr/db';
import { z } from 'zod';
import { requireCapability } from './rbac';

const VIEW = { preHandler: requireCapability('forms.view') };
const MANAGE = { preHandler: requireCapability('forms.edit') };

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MIN_QUERY = 2;

const previewInput = z.object({
  field: z.record(z.unknown()),
  q: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

export interface ReferenceSearchRow { [k: string]: unknown }
export interface ReferenceSearchResponse { kind: 'coding' | 'entity'; rows: ReferenceSearchRow[]; total: number }

export function registerReferenceSearchRoutes(
  app: FastifyInstance<any, any, any, any>,
  ctx: AppContext,
  entityResolvers: Record<string, EntitySearchResolver>,
): void {
  async function run(
    source: ReferenceSource, q: string, limit: number, offset: number, reply: FastifyReply,
  ): Promise<ReferenceSearchResponse | { error: string }> {
    if (source.kind === 'entity') {
      const resolver = entityResolvers[source.target];
      if (!resolver) {
        reply.code(400);
        return { error: `no resolver registered for entity target '${source.target}' (known: ${ENTITY_TARGETS.join(', ')})` };
      }
      if (q.length < MIN_QUERY) return { kind: 'entity', rows: [], total: 0 };
      const out = await resolver.search(q, limit, offset);
      return { kind: 'entity', rows: out.rows, total: out.total };
    }

    if (q.length < MIN_QUERY) return { kind: 'coding', rows: [], total: 0 };

    if (source.mode === 'valueset') {
      const vs = await ctx.terminology.ops.expand(source.url, { filter: q, count: limit, offset });
      return {
        kind: 'coding',
        rows: (vs.expansion?.contains ?? []).map((c) => ({ system: c.system ?? '', code: c.code ?? '', display: c.display ?? null })),
        total: vs.expansion?.total ?? 0,
      };
    }

    const found = await ctx.terminology.admin.terms.search(source.system, { query: q, limit, offset });
    return {
      kind: 'coding',
      rows: found.rows.map((r) => ({ system: r.system, code: r.code, display: r.display })),
      total: found.total,
    };
  }

  function clampLimit(raw: string | number | undefined): number {
    const n = Number(raw ?? DEFAULT_LIMIT);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.trunc(n), MAX_LIMIT);
  }

  // Search is scoped to a FIELD, not to a target: the server derives the source from the
  // stored schema, so a caller cannot search patients unless a form declares a
  // patient-bound field.
  app.get('/api/forms/:formId/fields/:fieldId/reference-search', VIEW, async (req, reply) => {
    const { formId, fieldId } = req.params as { formId: string; fieldId: string };
    const form = await ctx.forms.get(formId);
    if (!form) { reply.code(404); return { error: 'form not found' }; }

    const fields = ((form.schema as { fields?: FormField[] }).fields ?? []);
    const field = fields.find((f) => f.id === fieldId);
    if (!field) { reply.code(404); return { error: 'field not found' }; }

    const resolved = resolveReferenceSource(field);
    if (!resolved.ok) { reply.code(400); return { error: `field '${fieldId}' declares no reference source` }; }

    const query = req.query as { q?: string; limit?: string; offset?: string };
    try {
      return await run(resolved.source, (query.q ?? '').trim(), clampLimit(query.limit), Number(query.offset ?? 0), reply);
    } catch (e) {
      reply.code(400);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  // The builder previews unsaved schemas, so this one takes the field inline. Gated on
  // forms.edit — it is the only path that can search a source no stored form declares.
  app.post('/api/forms/reference-search/preview', MANAGE, async (req, reply) => {
    const parsed = previewInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }

    const resolved = resolveReferenceSource(parsed.data.field as unknown as FormField);
    if (!resolved.ok) { reply.code(400); return { error: 'field declares no reference source' }; }

    try {
      return await run(resolved.source, (parsed.data.q ?? '').trim(), clampLimit(parsed.data.limit), parsed.data.offset ?? 0, reply);
    } catch (e) {
      reply.code(400);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}
```

- [ ] **Step 4: Register the routes**

In `apps/server/src/app.ts`, next to the existing `registerFormsRoutes(app, ctx)` call:

```ts
registerReferenceSearchRoutes(app, ctx, {
  Patient: createPatientResolver(ctx.store.db as never, ctx.targetEngine ?? 'postgres'),
});
```

If `AppContext` does not already expose the target engine, read it the same way `createRelationalWriter(externalDb, engine)` does in `packages/bootstrap/src/index.ts` and thread it through rather than defaulting silently.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server exec vitest run src/reference-search-routes.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/reference-search-routes.ts apps/server/src/reference-search-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add field-scoped reference search"
```

---

### Task 9: Enforce validation on submit

**Files:**
- Modify: `apps/server/src/forms-routes.ts:252-272`
- Modify: `apps/server/src/forms-routes.test.ts:257-265`

**Interfaces:**
- Consumes: `validateAnswers` (Task 4), `validateReferences` (Task 5), `ctx.fhirStore.exists`, `ctx.terminology.ops.validateCode`.

- [ ] **Step 1: Rewrite the existing assertion**

In `apps/server/src/forms-routes.test.ts`, replace the `emptyResponse` block (currently asserting 201 for `answers: {}`):

```ts
    // A required field that is absent must be rejected. This previously returned 201 —
    // the assertion encoded the bug that reference pickers exist to fix.
    const emptyResponse = await app.inject({ method: 'POST', url: `/api/forms/${id}/responses`, payload: { answers: {} } });
    expect(emptyResponse.statusCode).toBe(400);
    expect(emptyResponse.json().errors).toContainEqual(
      expect.objectContaining({ fieldId: 'patientId', reason: 'required' }),
    );
```

If `sampleSchema` in that file has no required field, mark one required so the assertion is meaningful, and leave a comment saying why.

- [ ] **Step 2: Add a reference-rejection test**

```ts
  it('rejects an unresolved reference answer', async () => {
    const app = authedApp(fakeCtx());
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Order', schema: referenceSchema, targetPages: ['forms'] },
    });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`, payload: { answers: { patient: 'asdf' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toContainEqual(
      expect.objectContaining({ fieldId: 'patient', reason: 'must be selected from the list' }),
    );
  });
```

Define `referenceSchema` alongside `sampleSchema` with one `reference` field `patient`, `required: true`, `referenceTarget: 'Patient'`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @openldr/server exec vitest run src/forms-routes.test.ts`
Expected: FAIL — both new assertions get 201

- [ ] **Step 4: Wire both validators into the route**

In `apps/server/src/forms-routes.ts`, extend the import on line 6:

```ts
import { toQuestionnaire, toQuestionnaireResponse, validateAnswers, validateReferences } from '@openldr/forms';
```

Replace the body of the responses handler between the `if (!f)` block and `reply.code(201)`:

```ts
    // Validation runs here and nowhere else on this path: `validateAnswers` is pure and
    // catches shape/required/options; `validateReferences` does the I/O-bound existence
    // checks. Before this, the route validated nothing at all.
    const shapeErrors = validateAnswers(f.schema as never, p.data.answers as never);
    if (shapeErrors.length > 0) {
      reply.code(400);
      return { error: 'invalid answers', errors: shapeErrors };
    }

    const referenceErrors = await validateReferences(f.schema as never, p.data.answers as never, {
      validateCode: (input) => ctx.terminology.ops.validateCode(input),
      exists: (resourceType, id) => ctx.fhirStore.exists(resourceType, id),
    });
    if (referenceErrors.length > 0) {
      reply.code(400);
      return { error: 'invalid answers', errors: referenceErrors };
    }

    try {
      const response = toQuestionnaireResponse(f.schema, p.data.answers as never);
```

leaving the existing `recordAudit` / `reply.code(201)` / `catch` block below unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server exec vitest run src/forms-routes.test.ts`
Expected: PASS — including the audit-ordering test, which still expects `form.response.submit` only for accepted submissions

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts
git commit -m "fix(server): validate form answers on submit"
```

---

### Task 10: Studio API client

**Files:**
- Modify: `apps/studio/src/api.ts` (append near `submitFormResponse`, ~line 773)

**Interfaces:**
- Produces: `ReferenceSearchResponse`, `CodingRow`, `EntityRow`, `referenceSearch(...)`, `referenceSearchPreview(...)`. Task 11 calls these.

- [ ] **Step 1: Add the client functions**

```ts
// ── Reference search (form reference pickers) ────────────────────────────────
export interface CodingRow { system: string; code: string; display: string | null }
export interface EntityRow { reference: string; display: string; secondary: string | null }
export type ReferenceSearchResponse =
  | { kind: 'coding'; rows: CodingRow[]; total: number }
  | { kind: 'entity'; rows: EntityRow[]; total: number };

export const referenceSearch = (
  formId: string, fieldId: string, p: { q: string; limit?: number; offset?: number },
): Promise<ReferenceSearchResponse> => {
  const qs = new URLSearchParams({ q: p.q, limit: String(p.limit ?? 20), offset: String(p.offset ?? 0) });
  return authFetch(
    `/api/forms/${encodeURIComponent(formId)}/fields/${encodeURIComponent(fieldId)}/reference-search?${qs}`,
  ).then((r) => okJson<ReferenceSearchResponse>(r, 'reference search'));
};

/** Builder-only: search against an unsaved field. Requires forms.edit. */
export const referenceSearchPreview = (
  field: unknown, p: { q: string; limit?: number },
): Promise<ReferenceSearchResponse> =>
  authFetch('/api/forms/reference-search/preview', jbody({ field, q: p.q, limit: p.limit ?? 20 }, 'POST'))
    .then((r) => okJson<ReferenceSearchResponse>(r, 'reference search preview'));
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/api.ts
git commit -m "feat(studio): add reference-search api client"
```

---

### Task 11: ReferencePicker component

**Files:**
- Create: `apps/studio/src/forms-runtime/ReferencePicker.tsx`
- Create: `apps/studio/src/forms-runtime/ReferencePicker.test.tsx`

**Interfaces:**
- Consumes: `referenceSearch`, `referenceSearchPreview`, row types (Task 10); `CodingAnswer`, `EntityAnswer` (Task 1).
- Produces: `<ReferencePicker field formId multiple value onChange />` where `value` is `CodingAnswer | EntityAnswer | Array<…> | null`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/studio/src/forms-runtime/ReferencePicker.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReferencePicker } from './ReferencePicker';

vi.mock('@/api', () => ({
  referenceSearch: vi.fn(),
  referenceSearchPreview: vi.fn(),
}));
import { referenceSearch } from '@/api';

const field = { id: 'patient', displayLabel: 'Patient', fieldType: 'reference', referenceTarget: 'Patient' } as never;
const entityResult = {
  kind: 'entity' as const,
  rows: [{ reference: 'Patient/p1', display: 'Doe Jane', secondary: '1992-01-01 · F' }],
  total: 1,
};

beforeEach(() => { vi.mocked(referenceSearch).mockReset(); });

describe('ReferencePicker', () => {
  it('searches after the debounce and renders display plus secondary', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={() => {}} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await waitFor(() => expect(screen.getByText('Doe Jane')).toBeInTheDocument());
    expect(screen.getByText('1992-01-01 · F')).toBeInTheDocument();
  });

  it('coalesces keystrokes into a single request', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={() => {}} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await waitFor(() => expect(referenceSearch).toHaveBeenCalledTimes(1));
  });

  it('emits the selected row', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={onChange} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await user.click(await screen.findByText('Doe Jane'));
    expect(onChange).toHaveBeenCalledWith({ reference: 'Patient/p1', display: 'Doe Jane' });
  });

  it('selects with the keyboard', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={onChange} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await screen.findByText('Doe Jane');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith({ reference: 'Patient/p1', display: 'Doe Jane' });
  });

  it('clears a selection', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ReferencePicker field={field} formId="f1" multiple={false}
        value={{ reference: 'Patient/p1', display: 'Doe Jane' }} onChange={onChange} />,
    );
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders one chip per value when multiple', () => {
    render(
      <ReferencePicker field={field} formId="f1" multiple
        value={[{ reference: 'Patient/p1', display: 'Doe Jane' }, { reference: 'Patient/p2', display: 'Doe John' }]}
        onChange={() => {}} />,
    );
    expect(screen.getByText('Doe Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe John')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    vi.mocked(referenceSearch).mockResolvedValue({ kind: 'entity', rows: [], total: 0 });
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(await screen.findByText(/no matches/i)).toBeInTheDocument();
  });

  it('shows an error row when the search fails', async () => {
    vi.mocked(referenceSearch).mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'doe');
    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-runtime/ReferencePicker.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// apps/studio/src/forms-runtime/ReferencePicker.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodingAnswer, EntityAnswer, FormField } from '@openldr/forms/pure';
import { referenceSearch, referenceSearchPreview, type ReferenceSearchResponse } from '@/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';

export type ReferenceValue = CodingAnswer | EntityAnswer;

interface Row { key: string; display: string; secondary: string | null; value: ReferenceValue }

function toRows(res: ReferenceSearchResponse): Row[] {
  return res.kind === 'entity'
    ? res.rows.map((r) => ({
        key: r.reference, display: r.display, secondary: r.secondary,
        value: { reference: r.reference, display: r.display },
      }))
    : res.rows.map((r) => ({
        key: `${r.system}|${r.code}`, display: r.display ?? r.code, secondary: r.code,
        value: { system: r.system, code: r.code, display: r.display },
      }));
}

const labelOf = (v: ReferenceValue): string =>
  v.display ?? ('reference' in v ? v.reference : v.code);
const keyOf = (v: ReferenceValue): string =>
  'reference' in v ? v.reference : `${v.system}|${v.code}`;

export function ReferencePicker({ field, formId, multiple, value, onChange }: {
  field: FormField;
  /** Omitted in the builder preview, which searches an unsaved field instead. */
  formId?: string;
  multiple: boolean;
  value: ReferenceValue | ReferenceValue[] | null;
  onChange: (v: ReferenceValue | ReferenceValue[] | null) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const selected: ReferenceValue[] = value == null ? [] : Array.isArray(value) ? value : [value];

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) { setRows([]); setError(null); return; }
    setBusy(true); setError(null);
    try {
      const res = formId
        ? await referenceSearch(formId, field.id, { q: trimmed })
        : await referenceSearchPreview(field, { q: trimmed });
      setRows(toRows(res));
      setActive(-1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [field, formId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(query); }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const pick = (row: Row): void => {
    if (multiple) {
      if (!selected.some((s) => keyOf(s) === keyOf(row.value))) onChange([...selected, row.value]);
    } else {
      onChange(row.value);
    }
    setQuery(''); setRows([]); setOpen(false); setActive(-1);
  };

  const remove = (v: ReferenceValue): void => {
    const next = selected.filter((s) => keyOf(s) !== keyOf(v));
    onChange(multiple ? (next.length > 0 ? next : null) : null);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && active >= 0 && rows[active]) { e.preventDefault(); pick(rows[active]!); }
  };

  const showSingleSelected = !multiple && selected.length > 0;

  return (
    <div ref={containerRef} className="relative">
      {selected.length > 0 && (
        <div className={multiple ? 'mb-1 flex flex-wrap gap-1' : 'flex items-center justify-between rounded-md border border-input px-3 py-2'}>
          {selected.map((v) => (
            <span
              key={keyOf(v)}
              className={multiple
                ? 'inline-flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-xs'
                : 'text-sm'}
            >
              <TruncatedText text={labelOf(v)} className="min-w-0" />
              <Button
                type="button" variant="ghost" size="icon"
                aria-label={`Clear ${labelOf(v)}`}
                className="h-5 w-5 shrink-0"
                onClick={() => remove(v)}
              >
                ×
              </Button>
            </span>
          ))}
        </div>
      )}

      {!showSingleSelected && (
        <Input
          role="combobox"
          aria-expanded={open}
          aria-controls={`${field.id}-reference-listbox`}
          id={field.id}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={field.placeholder ?? 'Search…'}
          className="h-9 text-sm"
        />
      )}

      {open && query.trim().length >= 2 && (
        <div
          id={`${field.id}-reference-listbox`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {busy && <div className="px-3 py-3 text-xs text-muted-foreground">Searching…</div>}
          {error && <div className="px-3 py-3 text-xs text-destructive" role="alert">{error}</div>}
          {!busy && !error && rows.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">No matches</div>
          )}
          {!error && rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              role="option"
              aria-selected={i === active}
              onClick={() => pick(r)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${i === active ? 'bg-accent' : ''}`}
            >
              <TruncatedText text={r.display} className="min-w-0 text-foreground" />
              {r.secondary && <span className="text-xs text-muted-foreground">{r.secondary}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-runtime/ReferencePicker.test.tsx`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/forms-runtime/ReferencePicker.tsx apps/studio/src/forms-runtime/ReferencePicker.test.tsx
git commit -m "feat(studio): add ReferencePicker"
```

---

### Task 12: Wire the picker into FormRuntime

**Files:**
- Modify: `apps/studio/src/forms-runtime/FormRuntime.tsx:114-127` (thread `formId`), `:261-270` and `:379-394` (the stub branch)
- Modify: `apps/studio/src/forms-runtime/runtime.ts:21-70` (client reference validation)
- Modify: `apps/studio/src/forms-runtime/runtime.test.ts`

**Interfaces:**
- Consumes: `ReferencePicker` (Task 11), `resolveReferenceSource`, `isCodingAnswer`, `isEntityAnswer`, `isReferenceFieldType` (Task 1).

- [ ] **Step 1: Write the failing validation test**

Append to `apps/studio/src/forms-runtime/runtime.test.ts`:

```ts
describe('reference validation', () => {
  const schema = (over: Record<string, unknown> = {}) => ({
    id: 's', name: 'S', sections: [], fields: [{
      id: 'patient', fhirPath: null, displayLabel: 'Patient', description: null,
      fieldType: 'reference', required: true, enabled: true, order: 0,
      cardinality: { min: 0, max: '1' }, referenceTarget: 'Patient', ...over,
    }],
  }) as never;

  it('rejects a bare string', () => {
    expect(validate(schema(), { patient: 'asdf' }))
      .toEqual({ patient: 'select a value from the list' });
  });

  it('accepts a resolved entity answer', () => {
    expect(validate(schema(), { patient: { reference: 'Patient/p1', display: 'Doe Jane' } })).toEqual({});
  });

  it('still reports a missing required reference', () => {
    expect(validate(schema(), {})).toEqual({ patient: 'field patient is required' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-runtime/runtime.test.ts`
Expected: FAIL — the bare-string case returns `{}`

- [ ] **Step 3: Add the client validation branch**

In `apps/studio/src/forms-runtime/runtime.ts`, extend the import on line 1:

```ts
import { isCodingAnswer, isEntityAnswer, isReferenceFieldType, visibleFieldIds as libVisibleFieldIds } from '@openldr/forms/pure';
```

and inside `validate`'s field loop, after the `required` check and before the numeric-constraints block:

```ts
    // A reference answer must be an object the picker produced. A bare string means the
    // user typed into a stub input, which is exactly what this feature removes.
    if (isReferenceFieldType(field.fieldType) && values.length > 0) {
      if (values.some((v) => !isCodingAnswer(v) && !isEntityAnswer(v))) {
        errors[field.id] = 'select a value from the list';
        continue;
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-runtime/runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Render the picker**

In `apps/studio/src/forms-runtime/FormRuntime.tsx`:

Add the imports:

```ts
import { resolveReferenceSource } from '@openldr/forms/pure';
import { ReferencePicker, type ReferenceValue } from './ReferencePicker';
```

Add `formId` to `FieldControl`'s props and thread it from `FormRuntime` → `renderFieldRows` → `FieldRow` → `FieldControl` (each already passes `field`, `schema` and `answers`, so add `formId?: string` beside them and pass the component's existing `formId` prop down).

Replace the stub-types case:

```tsx
    // reference always uses the picker. facility/organism/antibiogram use it only when the
    // field actually declares a source; otherwise they keep the historical text input.
    case 'reference':
    case 'facility':
    case 'organism':
    case 'antibiogram': {
      const resolved = resolveReferenceSource(field);
      if (field.fieldType === 'reference' || resolved.ok) {
        const multiple = field.referenceMultiple === true
          || field.repeatable === true
          || (field.cardinality?.max !== undefined && field.cardinality.max !== '1');
        return (
          <ReferencePicker
            field={field}
            formId={formId}
            multiple={multiple}
            value={(value ?? null) as ReferenceValue | ReferenceValue[] | null}
            onChange={(v) => onChange(v)}
          />
        );
      }
      return (
        <Input
          id={field.id}
          type="text"
          value={value != null ? String(value) : ''}
          placeholder={field.placeholder ?? `Search ${field.fieldType}...`}
          onChange={(e) => onChange(e.target.value || undefined)}
          aria-label={label}
          required={field.required}
        />
      );
    }
```

- [ ] **Step 6: Run the studio suite**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-runtime`
Expected: PASS. `FormCapture.test.tsx` renders the Lab order shape — if it asserts on a textbox for Patient, update it to the combobox role and note why.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/forms-runtime/FormRuntime.tsx apps/studio/src/forms-runtime/runtime.ts apps/studio/src/forms-runtime/runtime.test.ts
git commit -m "feat(studio): render reference fields with the picker"
```

---

### Task 13: Correct the Lab order sample

**Files:**
- Modify: `packages/forms/src/samples/forms.ts:306-319`
- Modify: `packages/forms/src/samples/forms.test.ts`

**Interfaces:**
- Consumes: everything above. This is the acceptance proof.

- [ ] **Step 1: Write the failing test**

Append to `packages/forms/src/samples/forms.test.ts`:

```ts
import { resolveReferenceSource } from '../reference-source';

describe('Lab order reference fields', () => {
  const labOrder = sampleForms.find((f) => f.name === 'Lab order')!;
  const field = (id: string) => labOrder.fields.find((f) => f.id === id)!;

  it('binds patient to the Patient entity', () => {
    expect(resolveReferenceSource(field('patient')))
      .toEqual({ ok: true, source: { kind: 'entity', target: 'Patient' } });
  });

  it('binds tests to a coding system rather than an unregistered entity', () => {
    const r = resolveReferenceSource(field('tests'));
    expect(r.ok).toBe(true);
    expect(r.ok && r.source.kind).toBe('coding');
  });

  it('allows more than one test per order', () => {
    expect(field('tests').cardinality.max).not.toBe('1');
  });
});
```

`sampleForms` is already imported at the top of that file. The Lab order sample is the `orderForm` entry inside it; it is not exported individually, hence the lookup by name.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/forms exec vitest run src/samples/forms.test.ts`
Expected: FAIL — `tests` resolves to `{ kind: 'entity', target: 'ActivityDefinition' }` and `max` is `'1'`

- [ ] **Step 3: Correct the sample**

In `packages/forms/src/samples/forms.ts`, change the `tests` field:

```ts
    {
      id: 'tests',
      fhirPath: 'ServiceRequest.code',
      displayLabel: 'Tests',
      description: null,
      fieldType: 'reference',
      required: true,
      enabled: true,
      order: 1,
      // A lab order carries several tests. LOINC is the orderable vocabulary; a site with a
      // curated panel list can point this field at a ValueSet instead, which wins over
      // referenceTarget.
      cardinality: { min: 1, max: '*' },
      referenceMultiple: true,
      section: 'order',
      referenceTarget: 'http://loinc.org',
      placeholder: 'Search tests…',
    },
```

Leave the `patient` field unchanged — `referenceTarget: 'Patient'` already resolves to the registered entity.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/forms exec vitest run src/samples/forms.test.ts`
Expected: PASS, including the existing lint assertion over the samples

- [ ] **Step 5: Run the full gate**

Run: `pnpm turbo run typecheck test --force`
Expected: all packages pass. If a failure mentions `Test timed out`, it is a known flake — re-run that package alone before treating it as a regression.

- [ ] **Step 6: Commit**

```bash
git add packages/forms/src/samples/forms.ts packages/forms/src/samples/forms.test.ts
git commit -m "fix(forms): bind Lab order tests to LOINC and allow several per order"
```

---

## Verification

After Task 13, confirm the original complaint is fixed against a running app:

1. Start the API (`cd apps/server && node dev.mjs`) and studio; open the Lab order form.
2. Type `asdf` into Patient. No dropdown selection is possible, and submitting reports "select a value from the list" rather than accepting it.
3. Type a seeded patient's surname. A row appears showing name over date-of-birth · sex, with no national ID rendered.
4. Select it, add two tests, submit. The request succeeds.
5. `curl` a submission with `{"answers":{"patient":"asdf"}}` directly. It returns 400, proving the client is not the only thing enforcing this.
