# FHIR path validation, Phase 2 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a wrong `fhirPath` fail a lint rule, and correct the Facility form's administrative mapping so it passes.

**Architecture:** Four new lint rules in `packages/forms`, built on Phase 1's generated path table and `resolveFhirPath`. Three are generic and live in one new module; the fourth is facility-specific and lives in its own. The Facility sample is corrected and migration 089 repoints installed forms. `openldr forms lint` gives a headless lab the same findings the builder shows.

**Tech Stack:** TypeScript 5.7, zod 3, vitest 2, Kysely, commander, pnpm workspaces, turbo.

**Spec:** `docs/superpowers/specs/2026-08-21-fhir-path-validation-design.md`

**Phase 1 plan (already merged):** `docs/superpowers/plans/2026-08-21-fhir-path-validation.md`

## Global Constraints

- Never add a `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailer. Commit messages carry no agent attribution.
- Commit messages follow conventional commits. `feat`, `fix`, `perf` reach the public changelog; `chore`, `docs`, `test` do not.
- No em dashes anywhere, in code comments, docs, or commit messages. No emoji in headings or bullets.
- Run the full gate with `pnpm turbo run test`. Never pipe turbo through `tail`; it truncates the failure list. A gate failure is usually a timeout, not a regression. Grep for `Test timed out` and rerun that package alone before blaming a change.
- `apps/server` is the only package with real lint.
- Do not hardcode clinical vocabulary. This plan touches FHIR structure and administrative geography only, never codes, organisms, statuses, or value sets.
- Kysely enforces strict numeric migration order. A gap blocks boot. 089 is the next free number, confirmed unclaimed on every local and remote ref on 2026-08-21. **Re-check before Task 3**, because an unmerged branch may have taken it since.
- `packages/db` must never import `@openldr/forms`. The dependency runs the other way. Migration snapshots are frozen copies, never live imports.
- `packages/forms/src/pure.ts` is the browser-safe entry point. Nothing reachable from it may pull in `node:` built-ins or the database engine.

## Facts this plan is built on

Each was measured in the working tree on 2026-08-21 by running the proposed rules over the shipped samples, not assumed.

- **The Facility form trips zero structural rules.** The spec's original list of three structural defects was stale: `identifier.value` now carries a `fhirDiscriminator`, the phone field bound to `telecom.value` was dropped in 087, and `physicalType` on a `reference` field with a `valueSetUrl` is a correct pairing. Its only defect is the administrative ordering.
- **Eleven structural findings exist in the other three samples.** Users has 3 cardinality, Patient has 3 cardinality, Lab order has 4 cardinality and 3 type mismatches. That is why the two structural rules ship at `warning`, decided by the operator on 2026-08-21.
- The three Lab order type mismatches are real: `ServiceRequest.requester` (`Reference`), `.identifier` (`Identifier`), and `.note` (`Annotation`) are each bound to a plain `text` field.
- A `reference` field legitimately binds a `string` leaf (`address.country`), a `code` leaf (`status`), and a `CodeableConcept` leaf (`physicalType`) in the shipped Facility form. Any rule constraining `reference` by leaf type would fire on correct code.
- The current shipped Facility shape is migration **087**'s, ten fields. `FACILITY_FORM_MIGRATION_BOUND_FIELDS` is re-exported from `packages/db/src/index.ts:103` and currently points at 087. `packages/forms/src/samples/forms.test.ts:248` pins the sample against it.
- Region became **optional** in 085 (`required: false`, `cardinality.min: 0`), because the Zambia MFL export has nothing between Province and District.
- `FACILITY_ADMIN_LEVELS` is exported from the browser-safe `@openldr/db/facility-answers` subpath. `apps/studio/src/facilities/useFacilityAdminSuggestions.ts:3` already imports it that way.
- Lint issues reach the operator in two places: a per-field badge whose `title` and `aria-label` are the raw message (`apps/studio/src/forms-builder/SortableFieldRow.tsx:107-115`), and a counts-only summary (`apps/studio/src/forms-builder/LintSummary.tsx`, used at `BuilderHeader.tsx:364`). **No lint message is translated today** and no i18n key exists for any lint code.
- In-app docs live at `apps/studio/src/docs/0.1.0/<locale>/`. `en` has 19 guides; `fr` and `pt` have 2 each. The registry falls back to `en` when a locale file is missing (`apps/studio/src/docs/registry.ts:351`), so the gap renders cleanly rather than breaking.
- CLI commands are registered in `packages/cli/src/program.ts`, not `index.ts`. The `forms` command group is at `program.ts:597`.
- `ctx.forms.get(id)` returns a `FormDefinition` carrying a full `schema: FormSchema`. `ctx.forms.list()` returns summaries without one.

## Scope decision on docs

`AGENTS.md` section 6 item 3 requires in-app docs in en, fr, and pt, because a missing i18n key renders as literal braces. That rule is about `apps/studio/src/i18n/*.ts` keys. These guides are markdown files behind a registry that falls back to `en`.

So this plan documents the four new codes in `en/forms.md` only. It does **not** create `fr/forms.md` and `pt/forms.md`, because those do not exist for 17 of the 19 guides and creating two would be an unrelated translation project. It does **not** add i18n keys for lint messages, because no lint message is translated today and adding that surface is its own slice.

Both omissions are deliberate and are called out again in the definition-of-done table.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/forms/src/lint-fhir-path.ts` | The three generic path rules. One pass over the fields. |
| `packages/forms/src/lint-fhir-path.test.ts` | Its tests. |
| `packages/forms/src/lint-facility-admin.ts` | The facility administrative-order rule. The only lint module that knows a domain. |
| `packages/forms/src/lint-facility-admin.test.ts` | Its tests. |
| `packages/forms/src/lint.ts` | Widens the issue-code union and calls both modules. Stays a coordinator. |
| `packages/forms/src/samples/forms.ts` | The corrected Facility mapping. |
| `packages/forms/src/samples/forms.test.ts` | Repins to 089, adds the all-samples regression and the canonicalisation proof. |
| `packages/db/src/migrations/internal/089_facility_form_canonical_paths.ts` | Repoints installed forms. Exports two frozen prior shapes and the new one. |
| `packages/db/src/migrations/internal/089_facility_form_canonical_paths.test.ts` | Its tests. |
| `packages/db/src/index.ts` | Repoints the snapshot re-export from 087 to 089. |
| `packages/cli/src/forms.ts` | `runFormsLint`. |
| `packages/cli/src/program.ts` | Registers `forms lint`. |
| `packages/cli/src/forms-lint-cli-parsing.test.ts` | Commander parsing test. |
| `apps/studio/src/docs/0.1.0/en/forms.md` | Documents the four codes. |

The three generic rules share one loop over the fields and one call to `resolveFhirPath` plus `lookupFhirPath` per field, so they live together. The facility rule is separated because it is the only one carrying domain knowledge and the only one importing `@openldr/db`.

---

### Task 1: The three generic path rules

**Files:**
- Create: `packages/forms/src/lint-fhir-path.ts`
- Test: `packages/forms/src/lint-fhir-path.test.ts`
- Modify: `packages/forms/src/lint.ts`

**Interfaces:**
- Consumes: `resolveFhirPath(fhirPath, fhirResourceType)` from `./fhir-path`; `lookupFhirPath(path)` and `isKnownFhirResourceType(t)` from `@openldr/fhir/paths`; `FormLintIssue` from `./lint`.
- Produces: `export function lintFhirPaths(form: FormSchema): FormLintIssue[]`

Three codes, added to `FormLintIssue['code']`:

- `unknown-fhir-path`, severity `error`
- `fhir-path-cardinality`, severity `warning`
- `fhir-path-type-mismatch`, severity `warning`

**The gate that stops this becoming a landmine.** `unknown-fhir-path` must stay silent when `isKnownFhirResourceType(form.fhirResourceType)` is false. The path table covers nine resource types. The builder's resource picker offers 145 (`apps/studio/src/forms-builder/BuilderHeader.tsx:44`). Lint errors gate publish. Without this gate, an operator form on any of the other 136 types has every bound field flagged and the form can never be published.

- [ ] **Step 1: Write the failing test**

Create `packages/forms/src/lint-fhir-path.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lintFhirPaths } from './lint-fhir-path';
import type { FormSchema, FormField } from './schema/form-schema';

function field(partial: Partial<FormField> & { id: string }): FormField {
  return {
    displayLabel: partial.id, description: null, fieldType: 'text',
    required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' },
    fhirPath: null, ...partial,
  } as FormField;
}

function form(fhirResourceType: string | null, fields: FormField[]): FormSchema {
  return {
    id: 'f', name: 'F', versionLabel: null, fhirVersion: null, fhirResourceType,
    fhirProfileUrl: null, facilityId: null, fields, sections: [], targetPages: [],
    version: 1, active: true, status: 'draft', createdAt: '', updatedAt: '',
  } as FormSchema;
}

const codes = (issues: ReturnType<typeof lintFhirPaths>): string[] => issues.map((i) => i.code);

describe('unknown-fhir-path', () => {
  it('fires at error severity for a path absent from the table', () => {
    const issues = lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'address.zone' })]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'unknown-fhir-path', severity: 'error', fieldId: 'a' });
  });

  it('accepts a real path', () => {
    expect(codes(lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'address.district' })])))).toEqual([]);
  });

  it('accepts a path already carrying its resource prefix', () => {
    expect(codes(lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'Location.address.district' })])))).toEqual([]);
  });

  it('accepts a path prefixed with a DIFFERENT covered resource type', () => {
    // The shipped Lab order form declares ServiceRequest and binds Specimen.type.
    expect(codes(lintFhirPaths(form('ServiceRequest', [field({ id: 'a', fhirPath: 'Specimen.type' })])))).toEqual([]);
  });

  it('STAYS SILENT for a resource type the table does not cover', () => {
    // The builder offers 145 resource types; the table covers 9. Firing here at error
    // severity would make every form on the other 136 permanently unpublishable.
    expect(codes(lintFhirPaths(form('Condition', [field({ id: 'a', fhirPath: 'onsetDateTime' })])))).toEqual([]);
  });

  it('stays silent for a form with no resource type at all', () => {
    expect(codes(lintFhirPaths(form(null, [field({ id: 'a', fhirPath: 'address.district' })])))).toEqual([]);
  });

  it('ignores a disabled field and a null path', () => {
    const issues = lintFhirPaths(form('Location', [
      field({ id: 'a', fhirPath: 'address.zone', enabled: false }),
      field({ id: 'b', fhirPath: null }),
    ]));
    expect(codes(issues)).toEqual([]);
  });
});

describe('fhir-path-cardinality', () => {
  it('fires at warning severity when the path crosses an array with no discriminator', () => {
    // Location.identifier is Identifier[], so `value` below it is array-reached.
    const issues = lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'identifier.value' })]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'fhir-path-cardinality', severity: 'warning', fieldId: 'a' });
  });

  it('stays silent when a fhirDiscriminator names the element', () => {
    const issues = lintFhirPaths(form('Location', [
      field({ id: 'a', fhirPath: 'identifier.value', fhirDiscriminator: { system: 'urn:x' } }),
    ]));
    expect(codes(issues)).toEqual([]);
  });

  it('stays silent when the path carries a numeric index', () => {
    expect(codes(lintFhirPaths(form('Patient', [field({ id: 'a', fhirPath: 'name.0.given' })])))).toEqual([]);
  });

  it('stays silent for a path with no array segment', () => {
    expect(codes(lintFhirPaths(form('Location', [field({ id: 'a', fhirPath: 'address.district' })])))).toEqual([]);
  });
});

describe('fhir-path-type-mismatch', () => {
  it('fires at warning severity for a text field on a Reference leaf', () => {
    const issues = lintFhirPaths(form('ServiceRequest', [field({ id: 'a', fhirPath: 'subject', fieldType: 'text' })]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'fhir-path-type-mismatch', severity: 'warning', fieldId: 'a' });
  });

  it('does NOT fire for a reference field on any leaf type', () => {
    // All three pairings below are shipped and correct in the Facility form. A rule that
    // constrained `reference` by leaf type would fire on working code.
    const issues = lintFhirPaths(form('Location', [
      field({ id: 'a', fhirPath: 'address.country', fieldType: 'reference' }),  // string leaf
      field({ id: 'b', fhirPath: 'status', fieldType: 'reference' }),           // code leaf
      field({ id: 'c', fhirPath: 'physicalType', fieldType: 'reference' }),     // CodeableConcept leaf
    ]));
    expect(codes(issues)).toEqual([]);
  });

  it('does not fire for a scalar field on a primitive leaf', () => {
    const issues = lintFhirPaths(form('Patient', [
      field({ id: 'a', fhirPath: 'birthDate', fieldType: 'date' }),     // string leaf
      field({ id: 'b', fhirPath: 'gender', fieldType: 'select' }),      // code leaf, select is not scalar-only
      field({ id: 'c', fhirPath: 'active', fieldType: 'boolean' }),     // boolean leaf
    ]));
    expect(codes(issues)).toEqual([]);
  });

  it('reports both codes when a field trips cardinality and type mismatch together', () => {
    // ServiceRequest.identifier is Identifier[] on a text field. Both rules apply.
    const issues = lintFhirPaths(form('ServiceRequest', [field({ id: 'a', fhirPath: 'identifier', fieldType: 'text' })]));
    expect(codes(issues).sort()).toEqual(['fhir-path-cardinality', 'fhir-path-type-mismatch']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/forms test -- lint-fhir-path
```

Expected: FAIL, cannot resolve `./lint-fhir-path`.

- [ ] **Step 3: Write the implementation**

Create `packages/forms/src/lint-fhir-path.ts`:

```ts
import { isKnownFhirResourceType, lookupFhirPath } from '@openldr/fhir/paths';
import { resolveFhirPath } from './fhir-path';
import type { FormLintIssue } from './lint';
import type { FormSchema } from './schema/form-schema';

/**
 * Field types that can only ever write a scalar into the resource.
 *
 * Deliberately excludes `reference`, `select`, `multiselect`, `organism`, `antibiogram`, and
 * `facility`. Those produce a coding or an entity reference, and the shipped Facility form binds
 * a `reference` field to a `string` leaf (`address.country`), a `code` leaf (`status`), AND a
 * `CodeableConcept` leaf (`physicalType`). Constraining them by leaf type would fire on working
 * code. Also excludes `identifier`, which writes a scalar but into a structured element.
 */
const SCALAR_ONLY_FIELD_TYPES: ReadonlySet<string> = new Set([
  'text', 'number', 'date', 'datetime', 'boolean', 'phone', 'email',
]);

/** Leaf types a scalar field type can legitimately write. Everything else is structured. */
const PRIMITIVE_LEAF_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'code']);

/** A numeric segment anywhere in the path, which pins an array element explicitly. */
const HAS_NUMERIC_SEGMENT = /\.\d+(\.|$)/;

/**
 * The three generic FHIR path rules, in one pass.
 *
 * ⛔ Every rule here is gated on `isKnownFhirResourceType`. The generated path table covers nine
 * resource types; the builder's Resource Type picker offers 145
 * (`apps/studio/src/forms-builder/BuilderHeader.tsx`). `unknown-fhir-path` is an ERROR and lint
 * errors gate publish (`FormBuilderPage.tsx`'s `canPublish={!hasErrors}`), so firing on an
 * uncovered resource type would make an operator's form permanently unpublishable through no
 * fault of theirs. Silence is the correct answer for a type we cannot check.
 */
export function lintFhirPaths(form: FormSchema): FormLintIssue[] {
  const issues: FormLintIssue[] = [];
  const resourceType = form.fhirResourceType;
  if (!resourceType || !isKnownFhirResourceType(resourceType)) return issues;

  for (const field of form.fields) {
    if (!field.enabled || !field.fhirPath) continue;

    const resolved = resolveFhirPath(field.fhirPath, resourceType);
    if (!resolved) continue; // unreachable while resourceType is known, but never guess a prefix

    const info = lookupFhirPath(resolved);
    if (!info) {
      issues.push({
        severity: 'error',
        code: 'unknown-fhir-path',
        message: `Field "${field.id}" binds "${resolved}", which is not an element of ${resourceType} in FHIR R4`,
        fieldId: field.id,
      });
      continue; // no leaf information, so the two rules below cannot be evaluated
    }

    if (info.isArray && !HAS_NUMERIC_SEGMENT.test(resolved) && !field.fhirDiscriminator) {
      issues.push({
        severity: 'warning',
        code: 'fhir-path-cardinality',
        message: `Field "${field.id}" binds "${resolved}", which passes through a repeating element, but names no fhirDiscriminator or index to say which one`,
        fieldId: field.id,
      });
    }

    if (SCALAR_ONLY_FIELD_TYPES.has(field.fieldType) && !PRIMITIVE_LEAF_TYPES.has(info.leafType)) {
      issues.push({
        severity: 'warning',
        code: 'fhir-path-type-mismatch',
        message: `Field "${field.id}" is a ${field.fieldType} but "${resolved}" is a ${info.leafType}, which a plain value cannot fill`,
        fieldId: field.id,
      });
    }
  }

  return issues;
}
```

- [ ] **Step 4: Widen the issue-code union and call the module**

In `packages/forms/src/lint.ts`, add the three codes to the `code` union in `FormLintIssue`, after `'ambiguous-fhir-path'`:

```ts
    | 'ambiguous-fhir-path'
    | 'unknown-fhir-path'
    | 'fhir-path-cardinality'
    | 'fhir-path-type-mismatch';
```

Add the import at the top of the file:

```ts
import { lintFhirPaths } from './lint-fhir-path';
```

Then, immediately before the final `return issues;` at the end of `lintFormSchema`, add:

```ts
  issues.push(...lintFhirPaths(form));
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/forms test -- lint-fhir-path
pnpm --filter @openldr/forms test -- lint
```

Expected: both pass. The second runs the existing `lint.test.ts` too, which must stay green: the new rules are gated on `fhirResourceType`, and `lint.test.ts`'s fixtures do not set one, so nothing there should newly fire. If something does fire, read it before changing it, because it may be a real finding.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @openldr/forms typecheck
```

Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/forms/src/lint-fhir-path.ts packages/forms/src/lint-fhir-path.test.ts packages/forms/src/lint.ts
git commit -m "feat(forms): lint a field's FHIR path against the R4 element table"
```

---

### Task 2: The facility administrative-order rule

**Files:**
- Create: `packages/forms/src/lint-facility-admin.ts`
- Test: `packages/forms/src/lint-facility-admin.test.ts`
- Modify: `packages/forms/src/lint.ts`

**Interfaces:**
- Consumes: `resolveFhirPath` from `./fhir-path`; `FACILITY_ADMIN_LEVELS` from `@openldr/db/facility-answers`; `FormLintIssue` from `./lint`.
- Produces: `export function lintFacilityAdminOrder(form: FormSchema): FormLintIssue[]`

One code, `facility-admin-order`, severity `error`.

FHIR `Address` nests `country > state > district > city`, widest first. `FACILITY_ADMIN_LEVELS` declares `zone < region < district < council`, widest first (`packages/db/src/facility-answers.ts`, and the key order there is load-bearing, not cosmetic). A field's `apiProperty` is what ties the two together, never its display label, so renaming "Zone" cannot defeat the rule.

**Two things that would break this rule if missed.** A level may carry a `null` path, and after the Phase 2 correction two of the four do. A level may be absent from the form entirely, and Region is optional since 085. Both must be skipped, not reported.

- [ ] **Step 1: Write the failing test**

Create `packages/forms/src/lint-facility-admin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lintFacilityAdminOrder } from './lint-facility-admin';
import type { FormSchema, FormField } from './schema/form-schema';

function field(id: string, apiProperty: string, fhirPath: string | null): FormField {
  return {
    id, apiProperty, fhirPath, displayLabel: id, description: null, fieldType: 'suggest',
    required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' },
  } as FormField;
}

function form(fields: FormField[]): FormSchema {
  return {
    id: 'f', name: 'Facility', versionLabel: null, fhirVersion: null, fhirResourceType: 'Location',
    fhirProfileUrl: null, facilityId: null, fields, sections: [], targetPages: ['facilities'],
    version: 1, active: true, status: 'draft', createdAt: '', updatedAt: '',
  } as FormSchema;
}

describe('facility-admin-order', () => {
  it('fires when a wider level binds a narrower Address element', () => {
    // The shipped bug: Zone (widest) on address.district, Region (narrower) on address.state.
    const issues = lintFacilityAdminOrder(form([
      field('z', 'zone', 'address.district'),
      field('r', 'region', 'address.state'),
      field('d', 'district', 'address.city'),
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'facility-admin-order', severity: 'error' });
    expect(issues[0]!.message).toContain('zone');
    expect(issues[0]!.message).toContain('region');
  });

  it('accepts the corrected mapping, where two levels carry no path at all', () => {
    const issues = lintFacilityAdminOrder(form([
      field('z', 'zone', null),
      field('r', 'region', 'Location.address.state'),
      field('d', 'district', 'Location.address.district'),
      field('c', 'council', null),
    ]));
    expect(issues).toEqual([]);
  });

  it('accepts a form where an optional level is absent entirely', () => {
    // Region became optional in 085; the Zambia MFL has nothing between Province and District.
    const issues = lintFacilityAdminOrder(form([
      field('z', 'zone', null),
      field('d', 'district', 'Location.address.district'),
    ]));
    expect(issues).toEqual([]);
  });

  it('ignores a level bound to something that is not an Address element', () => {
    const issues = lintFacilityAdminOrder(form([
      field('z', 'zone', 'Location.name'),
      field('r', 'region', 'Location.address.state'),
    ]));
    expect(issues).toEqual([]);
  });

  it('ignores a disabled field', () => {
    const bad = field('z', 'zone', 'address.district');
    const issues = lintFacilityAdminOrder(form([
      { ...bad, enabled: false },
      field('r', 'region', 'address.state'),
    ]));
    expect(issues).toEqual([]);
  });

  it('does nothing for a form that carries no admin levels', () => {
    expect(lintFacilityAdminOrder(form([field('n', 'name', 'Location.name')]))).toEqual([]);
  });

  it('keys on apiProperty, not the display label', () => {
    const relabelled = { ...field('z', 'zone', 'address.district'), displayLabel: 'Provincia' };
    const issues = lintFacilityAdminOrder(form([relabelled, field('r', 'region', 'address.state')]));
    expect(issues).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/forms test -- lint-facility-admin
```

Expected: FAIL, cannot resolve `./lint-facility-admin`.

- [ ] **Step 3: Write the implementation**

Create `packages/forms/src/lint-facility-admin.ts`:

```ts
import { FACILITY_ADMIN_LEVELS } from '@openldr/db/facility-answers';
import { resolveFhirPath } from './fhir-path';
import type { FormLintIssue } from './lint';
import type { FormSchema } from './schema/form-schema';

/**
 * FHIR Address administrative elements, widest first.
 *
 * `country > state > district > city` is the R4 nesting: `state` is "sub-unit of a country",
 * `district` is "district name (aka county)", and `city` is "city, town, suburb, village or other
 * community". This is structural FHIR vocabulary, not clinical vocabulary.
 */
const ADDRESS_ORDER: readonly string[] = [
  'address.country',
  'address.state',
  'address.district',
  'address.city',
];

/** Strip the resource prefix a canonical path carries, so `Location.address.state` ranks. */
function addressRank(resolvedPath: string): number {
  const tail = resolvedPath.slice(resolvedPath.indexOf('.') + 1);
  return ADDRESS_ORDER.indexOf(tail);
}

/**
 * The four cascading facility admin levels must bind Address elements in the same containment
 * order the levels themselves declare.
 *
 * `FACILITY_ADMIN_LEVELS` is `zone < region < district < council`, widest first, and its key order
 * is load-bearing (see the comment on `FACILITY_ADMIN_LEVEL_SET` in
 * `packages/db/src/facility-answers.ts`). Reading it from there rather than restating it keeps one
 * source for the order.
 *
 * Keys on `apiProperty`, never on `displayLabel`. An operator who renames Zone must not be able to
 * defeat the check.
 *
 * ⛔ A level with a `null` path is SKIPPED, not reported. After the Phase 2 correction, Zone and
 * Council both carry `null` because no standard Address element fits them. A rule that required
 * every level to be bound would fail the very form it was written to protect. A level missing from
 * the form entirely is skipped for the same reason: Region is optional since migration 085.
 */
export function lintFacilityAdminOrder(form: FormSchema): FormLintIssue[] {
  const ranked: { level: string; fieldId: string; rank: number }[] = [];

  for (const level of FACILITY_ADMIN_LEVELS) {
    const field = form.fields.find((f) => f.enabled && f.apiProperty === level);
    if (!field || !field.fhirPath) continue;
    const resolved = resolveFhirPath(field.fhirPath, form.fhirResourceType);
    if (!resolved) continue;
    const rank = addressRank(resolved);
    if (rank === -1) continue; // bound to something outside Address; not this rule's business
    ranked.push({ level, fieldId: field.id, rank });
  }

  const issues: FormLintIssue[] = [];
  for (let i = 1; i < ranked.length; i++) {
    const previous = ranked[i - 1]!;
    const current = ranked[i]!;
    if (current.rank > previous.rank) continue;
    issues.push({
      severity: 'error',
      code: 'facility-admin-order',
      message: `Administrative levels are bound out of order: "${previous.level}" is wider than "${current.level}" but binds ${ADDRESS_ORDER[previous.rank]}, which FHIR nests inside ${ADDRESS_ORDER[current.rank]}`,
      fieldId: current.fieldId,
    });
  }

  return issues;
}
```

- [ ] **Step 4: Wire it in**

In `packages/forms/src/lint.ts`, add `'facility-admin-order'` to the `code` union:

```ts
    | 'fhir-path-type-mismatch'
    | 'facility-admin-order';
```

Add the import:

```ts
import { lintFacilityAdminOrder } from './lint-facility-admin';
```

And next to the `lintFhirPaths` call added in Task 1, before the final `return issues;`:

```ts
  issues.push(...lintFacilityAdminOrder(form));
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/forms test -- lint-facility-admin
pnpm --filter @openldr/forms test
```

Expected: the first passes. The second is the whole package and **is expected to fail** on `samples/forms.test.ts`, because the shipped Facility sample still carries the out-of-order mapping this rule now catches at error severity. That failure is the rule working. Tasks 3 and 4 correct the data.

Record the exact failure in your report. Do not correct the sample here; that is Task 4, and it is coupled to migration 089.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm --filter @openldr/forms typecheck
```

Expected: no output, exit 0.

```bash
git add packages/forms/src/lint-facility-admin.ts packages/forms/src/lint-facility-admin.test.ts packages/forms/src/lint.ts
git commit -m "feat(forms): catch facility admin levels bound out of containment order"
```

---

### Task 3: Migration 089

**Files:**
- Create: `packages/db/src/migrations/internal/089_facility_form_canonical_paths.ts`
- Test: `packages/db/src/migrations/internal/089_facility_form_canonical_paths.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2. This task is pure `packages/db`.
- Produces:
  - `export const PREV_BOUND_FIELDS_SNAPSHOT: readonly unknown[]` (087's shape, frozen copy)
  - `export const PREV_CANONICALISED_SNAPSHOT: readonly unknown[]` (087's shape with prefixed paths)
  - `export const BOUND_FIELDS_SNAPSHOT: readonly unknown[]` (the corrected shape)
  - `export async function up(db)`, `export async function down(db)`

**Re-check the migration number before you start.** A gap blocks boot and pg-mem cannot catch it:

```bash
ls packages/db/src/migrations/internal/ | grep -E "^(088|089|090)"
git log --all --oneline -- 'packages/db/src/migrations/internal/089*'
```

If anything other than `088_facility_drop_old_codes` appears, stop and report. Do not renumber on your own.

**Why two prior shapes.** Phase 1 shipped `normalize.ts` canonicalisation. The next time an operator opens the Facility form in the builder and saves it, every path gains its `Location.` prefix. An install in that state carries neither 087's shape nor the corrected one. Matching only 087's shape would skip those installs silently, leaving Zone bound to `Location.address.district` forever, and Task 2's rule then makes their form unpublishable. This is the failure the phase split was built to prevent, and it was introduced by the split itself.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/internal/089_facility_form_canonical_paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  BOUND_FIELDS_SNAPSHOT,
  PREV_BOUND_FIELDS_SNAPSHOT,
  PREV_CANONICALISED_SNAPSHOT,
  up,
  down,
} from './089_facility_form_canonical_paths';
// Imported to PROVE this migration's frozen copy still matches what 087 actually shipped.
// 087's own test does the same against 085. The migration itself must never import it.
import { BOUND_FIELDS_SNAPSHOT as SHIPPED_087 } from './087_facility_form_one_code';

async function seedFacilityForm(db: any, fields: readonly unknown[]): Promise<void> {
  await db.insertInto('form_definitions').values({
    id: 'form-sample-facility', name: 'Facility', status: 'published', active: true,
    target_pages: JSON.stringify(['facilities']),
    schema: JSON.stringify({ id: 'form-sample-facility', name: 'Facility', fields, targetPages: ['facilities'] }),
  } as never).execute();
}

async function readFields(db: any): Promise<unknown> {
  const row = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Facility').executeTakeFirst();
  const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
  return schema.fields;
}

describe('089 facility form canonical paths', () => {
  it('repoints an install still carrying 087 shape', async () => {
    const db = await makeMigratedDb();
    await db.deleteFrom('form_definitions').where('name', '=', 'Facility').execute();
    await seedFacilityForm(db, PREV_BOUND_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(BOUND_FIELDS_SNAPSHOT);
  });

  it('repoints an install whose operator already saved the form since Phase 1', async () => {
    // normalize.ts prefixes every path on the next builder save. Without this shape in the
    // guard, such an install is skipped and keeps Zone on Location.address.district forever.
    const db = await makeMigratedDb();
    await db.deleteFrom('form_definitions').where('name', '=', 'Facility').execute();
    await seedFacilityForm(db, PREV_CANONICALISED_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(BOUND_FIELDS_SNAPSHOT);
  });

  it("leaves an operator's own edit alone", async () => {
    const db = await makeMigratedDb();
    await db.deleteFrom('form_definitions').where('name', '=', 'Facility').execute();
    const edited = (PREV_BOUND_FIELDS_SNAPSHOT as any[]).map((f, i) =>
      i === 0 ? { ...f, displayLabel: 'Register' } : f,
    );
    await seedFacilityForm(db, edited);
    await up(db);
    expect(await readFields(db)).toEqual(edited);
  });

  it('leaves an already-corrected row alone', async () => {
    const db = await makeMigratedDb();
    await db.deleteFrom('form_definitions').where('name', '=', 'Facility').execute();
    await seedFacilityForm(db, BOUND_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(BOUND_FIELDS_SNAPSHOT);
  });

  it('down() restores exactly the shape up() found, for both prior shapes', async () => {
    for (const prior of [PREV_BOUND_FIELDS_SNAPSHOT, PREV_CANONICALISED_SNAPSHOT]) {
      const db = await makeMigratedDb();
      await db.deleteFrom('form_definitions').where('name', '=', 'Facility').execute();
      await seedFacilityForm(db, prior);
      await up(db);
      await down(db);
      expect(await readFields(db)).toEqual(prior);
    }
  });

  it('the corrected snapshot binds Zone and Council to nothing, and District to address.district', () => {
    const by = (id: string) => (BOUND_FIELDS_SNAPSHOT as any[]).find((f) => f.id === id);
    expect(by('fld-fac-zone').fhirPath).toBeNull();
    expect(by('fld-fac-council').fhirPath).toBeNull();
    expect(by('fld-fac-region').fhirPath).toBe('Location.address.state');
    expect(by('fld-fac-district').fhirPath).toBe('Location.address.district');
    expect((BOUND_FIELDS_SNAPSHOT as any[]).some((f) => f.fhirPath === 'Location.address.city')).toBe(false);
  });

  it('the two prior snapshots differ only in their fhirPath values', () => {
    const strip = (fields: readonly unknown[]) =>
      (fields as any[]).map(({ fhirPath, ...rest }) => rest);
    expect(strip(PREV_CANONICALISED_SNAPSHOT)).toEqual(strip(PREV_BOUND_FIELDS_SNAPSHOT));
  });

  it("the frozen copy of 087's shape still matches what 087 actually shipped", () => {
    // The migration must NOT import 087. This test may, and it is what catches the frozen
    // copy being transcribed wrong. Same discipline as 087's own test against 085.
    expect(PREV_BOUND_FIELDS_SNAPSHOT).toEqual(SHIPPED_087);
  });
});
```

Note the helper import: `from './test-helpers'`, a sibling of the migration files. That is what `087_facility_form_one_code.test.ts:2` uses. 087's test also carries a `parseJson` guard because pg-mem hands `jsonb` back already parsed, which is why `readFields` above checks `typeof row.schema === 'string'` before parsing.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/db test -- 089
```

Expected: FAIL, cannot resolve `./089_facility_form_canonical_paths`.

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/internal/089_facility_form_canonical_paths.ts`.

Follow `087_facility_form_one_code.ts` for structure: the same `MARKER_KEY` discipline, the same `stableStringify`/`sortValue` helpers copied rather than imported, the same "match by name, bail if ambiguous" guard.

`PREV_BOUND_FIELDS_SNAPSHOT` is a verbatim frozen copy of 087's exported `BOUND_FIELDS_SNAPSHOT`. Copy it, do not import it: a migration is a frozen snapshot of one release and must not live-track another file.

`PREV_CANONICALISED_SNAPSHOT` is that same array with every non-null `fhirPath` prefixed `Location.` and every null left null. Concretely: `identifier.value` becomes `Location.identifier.value`, `name` becomes `Location.name`, `address.country` becomes `Location.address.country`, `address.district` becomes `Location.address.district`, `address.state` becomes `Location.address.state`, `address.city` becomes `Location.address.city`, `status` becomes `Location.status`, `physicalType` becomes `Location.physicalType`. `fld-fac-system` and `fld-fac-council` keep `fhirPath: null`.

`BOUND_FIELDS_SNAPSHOT` is the corrected shape. Every property other than `fhirPath` is identical to 087's, including `required`, `order`, `cardinality`, `apiProperty`, `valueSetUrl`, and `fhirDiscriminator`. Only these paths change:

| Field id | 087 | 089 |
|---|---|---|
| `fld-fac-system` | `null` | `null` |
| `fld-fac-code` | `identifier.value` | `Location.identifier.value` |
| `fld-fac-name` | `name` | `Location.name` |
| `fld-fac-country` | `address.country` | `Location.address.country` |
| `fld-fac-zone` | `address.district` | `null` |
| `fld-fac-region` | `address.state` | `Location.address.state` |
| `fld-fac-district` | `address.city` | `Location.address.district` |
| `fld-fac-council` | `null` | `null` |
| `fld-fac-status` | `status` | `Location.status` |
| `fld-fac-level` | `physicalType` | `Location.physicalType` |

`up()` matches the stored `schema.fields` against **both** prior snapshots by `stableStringify` equality, and rewrites only on a match. The marker records which prior shape was found so `down()` restores that one, not the other. Use marker key `'__migration089'` and this marker shape:

```ts
interface Migration089Marker {
  prevFields: readonly unknown[];
}
```

Give the file a header comment explaining, in plain words: why two prior shapes exist, that Zone and Council deliberately carry no path, and that `address.city` is reserved for Ward. Cite `docs/superpowers/specs/2026-08-21-fhir-path-validation-design.md`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/db test -- 089
```

Expected: all 7 pass.

- [ ] **Step 5: Run the whole db package**

```bash
pnpm --filter @openldr/db test
```

Expected: green. Every test in the migrations directory calls the migrated-db helper, which runs every migration including this one, so a mistake here surfaces broadly.

- [ ] **Step 6: Verify on a real boot**

pg-mem cannot catch a migration numbering gap. This is the only check that can.

```bash
pnpm openldr db reset
```

Expected: completes without error. Report the actual output.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/089_facility_form_canonical_paths.ts packages/db/src/migrations/internal/089_facility_form_canonical_paths.test.ts
git commit -m "feat(db): repoint installed facility forms onto corrected FHIR paths"
```

---

### Task 4: Correct the sample and repoint the pin

**Files:**
- Modify: `packages/forms/src/samples/forms.ts`
- Modify: `packages/forms/src/samples/forms.test.ts`
- Modify: `packages/db/src/index.ts:103`

**Interfaces:**
- Consumes: `BOUND_FIELDS_SNAPSHOT` and `PREV_BOUND_FIELDS_SNAPSHOT` from Task 3's migration; `lintFormSchema` from Tasks 1 and 2.
- Produces: nothing new. `FACILITY_FORM_MIGRATION_BOUND_FIELDS` now resolves to 089's snapshot.

The sample edit and the export repoint must land in **one commit**. `forms.test.ts:248` asserts the sample equals `FACILITY_FORM_MIGRATION_BOUND_FIELDS`. Change either alone and that test fails.

- [ ] **Step 1: Write the failing tests**

Add to `packages/forms/src/samples/forms.test.ts`. It already imports `FACILITY_FORM_MIGRATION_BOUND_FIELDS` from `@openldr/db` at line 7; add `FACILITY_FORM_MIGRATION_PREV_BOUND_FIELDS` to that same import, and add `normalizeFormSchema` from `../normalize` and `lintFormSchema` from `../lint`.

```ts
describe('every shipped sample passes the FHIR path rules', () => {
  it('no sample form produces a lint ERROR', () => {
    for (const form of sampleForms) {
      const errors = lintFormSchema(form).filter((i) => i.severity === 'error');
      expect(errors, `${form.name}: ${errors.map((e) => e.message).join('; ')}`).toEqual([]);
    }
  });

  it('the Facility form produces no findings of any severity', () => {
    const facility = sampleForms.find((f) => f.name === 'Facility')!;
    expect(lintFormSchema(facility)).toEqual([]);
  });

  // The three other samples carry 11 known warnings. This pins the count so a future edit that
  // adds a twelfth has to say so out loud. See the spec's "Two defect classes" section for what
  // each one is and why they are warnings rather than errors.
  it('the other samples carry exactly the 11 known structural warnings', () => {
    const warnings = sampleForms
      .filter((f) => f.name !== 'Facility')
      .flatMap((f) => lintFormSchema(f).filter((i) => i.severity === 'warning'))
      .filter((i) => i.code === 'fhir-path-cardinality' || i.code === 'fhir-path-type-mismatch');
    expect(warnings).toHaveLength(11);
  });
});

describe('migration 089 canonicalised guard', () => {
  // ⛔ This is the test that proves migration 089's SECOND prior shape is real. The migration
  // hand-writes what it believes a post-Phase-1 builder save produces. Only running the real
  // normaliser can confirm that belief, and packages/db cannot import @openldr/forms to do it.
  // This package can import both, so the proof lives here.
  it('normalizing the 087 shape produces exactly the shape 089 expects to find', () => {
    const normalized = normalizeFormSchema({
      id: 'form-sample-facility',
      name: 'Facility',
      fhirResourceType: 'Location',
      targetPages: ['facilities'],
      fields: FACILITY_FORM_MIGRATION_PREV_BOUND_FIELDS,
    });
    const paths = normalized.fields.map((f) => f.fhirPath);
    expect(paths).toEqual([
      null,
      'Location.identifier.value',
      'Location.name',
      'Location.address.country',
      'Location.address.district',
      'Location.address.state',
      'Location.address.city',
      null,
      'Location.status',
      'Location.physicalType',
    ]);
  });
});
```

- [ ] **Step 2: Export the prior snapshot from packages/db**

In `packages/db/src/index.ts`, change line 103 from pointing at 087 to pointing at 089, and add the prior-shape export beside it:

```ts
export { BOUND_FIELDS_SNAPSHOT as FACILITY_FORM_MIGRATION_BOUND_FIELDS } from './migrations/internal/089_facility_form_canonical_paths';
export { PREV_BOUND_FIELDS_SNAPSHOT as FACILITY_FORM_MIGRATION_PREV_BOUND_FIELDS } from './migrations/internal/089_facility_form_canonical_paths';
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/forms test -- samples
```

Expected: FAIL. The pin at line 248 now compares the old sample against 089's corrected snapshot, and the new lint assertions fail on `facility-admin-order`.

- [ ] **Step 4: Correct the sample**

In `packages/forms/src/samples/forms.ts`, change only the `fhirPath` values on the Facility form's fields, exactly as in Task 3's table. Every other property stays as it is.

Replace the comment on `fld-fac-council` that says no standard element fits, so it now also covers Zone and names what `address.city` is held back for. Write it in the file's existing voice, and add the same note on `fld-fac-zone`:

> Zone and Council both carry `fhirPath: null`. FHIR `Address` has four administrative slots and this registry has six tiers, so two get none. `address.city` means a settlement ("city, town, suburb, village or other community") and is deliberately left free for Ward, which `facility_registry` already stores. Both unmapped tiers export honestly only through `Location.partOf`. See `docs/superpowers/specs/2026-08-21-fhir-path-validation-design.md`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/forms test -- samples
pnpm --filter @openldr/forms test
pnpm --filter @openldr/db test
```

Expected: all green. This is the point at which Task 2's deliberate failure clears.

If the 11-warning count assertion fails, read the actual list before changing the number. A different count means either a rule is firing where it should not, or a sample changed.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm turbo run typecheck
```

Expected: green across all packages. `apps/studio` and `apps/server` both consume these exports.

```bash
git add packages/forms/src/samples/forms.ts packages/forms/src/samples/forms.test.ts packages/db/src/index.ts
git commit -m "fix(forms): bind facility admin levels to the right FHIR Address elements"
```

---

### Task 5: The CLI command

**Files:**
- Modify: `packages/cli/src/forms.ts`
- Modify: `packages/cli/src/program.ts:597-600`
- Test: `packages/cli/src/forms-lint-cli-parsing.test.ts`

**Interfaces:**
- Consumes: `lintFormSchema` from `@openldr/forms`.
- Produces: `export async function runFormsLint(id: string | undefined, opts: { json: boolean }): Promise<number>`

Labs run headless, so an operator who cannot open the builder still needs to see these findings. This is `AGENTS.md` section 6 item 2.

Exit code is the contract: `0` when no errors, `1` when any finding has severity `error`. Warnings alone exit `0`, matching the builder, where warnings do not gate publish.

- [ ] **Step 1: Write the failing parsing test**

Create `packages/cli/src/forms-lint-cli-parsing.test.ts`, following `packages/cli/src/facilities-list-cli-parsing.test.ts` exactly, including its "fresh `Command` per test" discipline (commander retains parsed option values across `parseAsync` calls on one instance, which order-couples tests that share it).

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program';

const mocks = vi.hoisted(() => ({ runFormsLint: vi.fn().mockResolvedValue(0) }));

vi.mock('./forms', () => ({
  runFormsLint: mocks.runFormsLint,
  runFormsList: vi.fn().mockResolvedValue(0),
  runFormsExtract: vi.fn().mockReturnValue({ resourceTypes: [], invalidCount: 0, bundle: {} }),
}));

describe('forms lint, commander parsing path', () => {
  beforeEach(() => { mocks.runFormsLint.mockClear(); });

  it('passes undefined for the id when none is given', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'forms', 'lint']);
    expect(mocks.runFormsLint).toHaveBeenCalledWith(undefined, expect.objectContaining({ json: false }));
  });

  it('passes the id through when one is given', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'forms', 'lint', 'form-sample-facility']);
    expect(mocks.runFormsLint).toHaveBeenCalledWith('form-sample-facility', expect.objectContaining({ json: false }));
  });

  it('carries --json', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'forms', 'lint', '--json']);
    expect(mocks.runFormsLint).toHaveBeenCalledWith(undefined, expect.objectContaining({ json: true }));
  });
});
```

`buildProgram` is exported from `packages/cli/src/program.ts:40`. `program.ts:8` currently imports `runFormsExtract` and `runFormsList` from `./forms`, so the module mock above must keep providing both or the sibling commands break at registration time.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/cli test -- forms-lint-cli-parsing
```

Expected: FAIL, `forms lint` is not a known command.

- [ ] **Step 3: Write the runner**

Add to `packages/cli/src/forms.ts`, after `runFormsList`:

```ts
/**
 * Lint one form, or every form when no id is given.
 *
 * Exit code mirrors the builder's publish gate: errors block, warnings do not
 * (`canPublish={!hasErrors}` in apps/studio/src/forms-builder/FormBuilderPage.tsx). A lab running
 * headless has no other way to see these findings.
 */
export async function runFormsLint(id: string | undefined, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const targets = id
      ? [await ctx.forms.get(id)].filter((f): f is NonNullable<typeof f> => f !== null)
      : await Promise.all((await ctx.forms.list()).map((s) => ctx.forms.get(s.id)))
          .then((forms) => forms.filter((f): f is NonNullable<typeof f> => f !== null));

    if (id && targets.length === 0) {
      process.stderr.write(`no form with id ${id}\n`);
      return 1;
    }

    const results = targets.map((form) => ({
      id: form.id,
      name: form.name,
      issues: lintFormSchema(form.schema),
    }));

    if (opts.json) {
      process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    } else {
      const lines: string[] = [];
      for (const result of results) {
        for (const issue of result.issues) {
          lines.push(`${result.name}\t${issue.severity}\t${issue.code}\t${issue.fieldId ?? issue.sectionId ?? ''}\t${issue.message}`);
        }
      }
      process.stdout.write((lines.length ? lines.join('\n') : '(no findings)') + '\n');
    }

    return results.some((r) => r.issues.some((i) => i.severity === 'error')) ? 1 : 0;
  } finally {
    await ctx.close();
  }
}
```

Add `lintFormSchema` to the existing `@openldr/forms` import at the top of the file.

- [ ] **Step 4: Register the command**

In `packages/cli/src/program.ts`, add `runFormsLint` to the import on line 8, then add this subcommand directly after the `forms list` registration:

```ts
  forms
    .command('lint [id]')
    .description('Report FHIR path and structure findings for one form, or every form')
    .option('--json', 'emit JSON', false)
    .action(async (id: string | undefined, opts: { json: boolean }) => {
      try { process.exitCode = await runFormsLint(id, opts); }
      catch (err) { process.stderr.write(`forms lint failed: ${redactError(err)}\n`); process.exitCode = 1; }
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/cli test -- forms-lint-cli-parsing
pnpm --filter @openldr/cli test
```

Expected: both green.

- [ ] **Step 6: Verify against a real database**

```bash
pnpm openldr forms lint
```

Expected: exit 0, and output listing the 11 warnings across the Users, Patient, and Lab order forms with no Facility findings. Paste the real output into your report. If the Facility form appears, Task 4 did not land correctly.

```bash
pnpm openldr forms lint --json
```

Expected: valid JSON.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm --filter @openldr/cli typecheck
```

```bash
git add packages/cli/src/forms.ts packages/cli/src/program.ts packages/cli/src/forms-lint-cli-parsing.test.ts
git commit -m "feat(cli): report form FHIR path findings from openldr forms lint"
```

---

### Task 6: Document the codes

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/forms.md`

No `fr` or `pt` file is created. Those locales carry 2 of the 19 guides and the registry falls back to `en` (`apps/studio/src/docs/registry.ts:351`), so the gap renders cleanly. Creating two translations of this guide is an unrelated project.

- [ ] **Step 1: Read the guide first**

```bash
cat apps/studio/src/docs/0.1.0/en/forms.md
```

Match its heading depth, voice, and list style. Do not restructure it.

- [ ] **Step 2: Add the section**

Add a section near the existing troubleshooting material. Content, in the guide's own voice:

- The builder checks each field's FHIR path against the FHIR R4 element list, and shows a badge on any field with a finding.
- Errors block publishing. Warnings do not.
- `unknown-fhir-path` (error): the path is not an element of the form's FHIR resource type. Usually a typo. Only checked for resource types the built-in element list covers; a form on any other type is not path-checked at all.
- `facility-admin-order` (error): the facility administrative levels are bound to FHIR address parts in the wrong order, for example Zone bound to a part that FHIR nests inside the one Region is bound to.
- `fhir-path-cardinality` (warning): the path passes through an element that can repeat, and nothing says which one to use. Set a FHIR discriminator on the field to resolve it.
- `fhir-path-type-mismatch` (warning): a plain input is bound to a structured FHIR element that a single value cannot fill. Change the field type, or bind a more specific path.
- Operators running without the studio can get the same findings from `openldr forms lint`, which exits non-zero when any error is present.

- [ ] **Step 3: Verify the docs still validate**

```bash
pnpm --filter @openldr/studio test -- docs
```

Expected: green. `apps/studio/src/docs/validation.test.ts` and `search.test.ts` both read these files.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs/0.1.0/en/forms.md
git commit -m "docs(forms): document the four FHIR path lint codes"
```

---

### Task 7: Gate and changelog

**Files:**
- Modify: `apps/web/src/landing/changelog.json`

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run test --concurrency=4 --force
```

Expected: every package passes. Do not pipe through `tail`. `--force` disables the cache, because a cached green run proves nothing about behaviour under load.

If something fails, grep for `Test timed out` first and rerun that package alone before blaming a change.

- [ ] **Step 2: Typecheck the workspace**

```bash
pnpm turbo run typecheck
```

- [ ] **Step 3: Verify on a real boot**

```bash
pnpm openldr db reset
pnpm openldr forms lint
```

Expected: reset completes, and lint exits 0 with only the 11 known warnings.

- [ ] **Step 4: Merge to local main**

Stop here and report. The merge is the operator's decision, and `make:changelog` reads git history so it cannot run correctly before it.

- [ ] **Step 5: Regenerate the changelog, after the merge**

```bash
pnpm make:changelog
```

- [ ] **Step 6: Commit the changelog**

```bash
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
```

---

## Definition of done, per `AGENTS.md` section 6

| | Covered by |
|---|---|
| UI | Tasks 1, 2, and 4. The builder already renders lint issues as a per-field badge and a header count; the new codes flow through unchanged. No new component. |
| CLI parity | Task 5, `openldr forms lint`. |
| Docs, en/fr/pt | Task 6, `en` only. **Deliberate gap:** `fr` and `pt` carry 2 of the 19 guides and the registry falls back to `en`. Translating this guide is its own slice. |
| Mobile view | Not applicable. No new UI surface; the badge and header already exist and are unchanged. |
| Landing changelog | Task 7, steps 5 and 6. |

**A second deliberate gap.** Lint messages are English strings built in `lint.ts` and rendered raw into the badge's `title` and `aria-label`. No lint message is translated today and no i18n key exists for any code. This plan does not add that surface. Doing it properly means keying every message, including the eight that already exist, which is a slice of its own.

## What this phase does not prove

- **That any of the 11 warnings gets fixed.** They become visible and stay visible. Fixing them needs a `fhirDiscriminator` convention for `HumanName` and `ContactPoint` that nobody has designed, and a re-typing of three Lab order fields.
- **That the corrected Facility mapping round-trips to a real FHIR consumer.** Nothing exports a `Location` yet. That gap closes with the export slice.
- **That `fhir-path-type-mismatch` catches every type error.** It is deliberately narrow, firing only for scalar-only field types on non-primitive leaves. A `select` bound to a `Reference` is a real error it will not catch, and that is the price of never firing on the shipped `reference` bindings.
- **Migration 089 on a real Postgres upgrade path.** Task 3 step 6 and Task 7 step 3 run `db reset`, which is a fresh install, not an upgrade over an existing 087-era database. Proving the upgrade needs a database that predates 089. If one is available, run it; if not, write **HONEST NON-PROOF** in the report and say so.
