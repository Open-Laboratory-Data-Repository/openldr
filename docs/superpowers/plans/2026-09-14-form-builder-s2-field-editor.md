# Form builder S2: the field editor

**Status:** merged to `main` on 2026-09-14 as `dbdfe74d`. The checkboxes below were not ticked while the work ran, so they do not show what was done. Git history does.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CE's field editor act like corlix's: a discriminator editor with All/Any and three operators, Mapping above Codes, a Parts block and "+ Add a named slot", a Reference Configuration block, locked fields, and survey forms that hide the mapping controls.

**Architecture:** The discriminator shape widens in `packages/forms` to a union of the old key/value map and a condition rule. One module, `discriminator.ts`, reads, compares and stores both. The studio gains three editor pieces: `DiscriminatorEditor.tsx`, `ReferenceEditor.tsx` and a Parts block in `FieldEditorSheet.tsx`. It also gains one pure module, `newFormFields.ts`, that builds a new slot or part. Storage keeps the smallest shape that loses nothing, so old forms never change.

**Tech Stack:** TypeScript, zod, vitest, React 18, Testing Library, Radix via shadcn `components/ui`.

**Spec:** `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, section 5, S2. Rows A3, A9, A13, A15, B6, B8.

## Global Constraints

- Match corlix's shipped behavior. Add nothing beyond it. Corlix lives at `~/Projects/Repositories/corlix`.
- Data entry does not change. Nothing new reads a discriminator, `referenceDependsOn` or `referenceSearchable` when a record is saved.
- UI strings are plain English literals, like the rest of `forms-builder`. No i18n keys.
- shadcn components only for new UI. Never a native `<button>`, `<select>`, `<input>` or `<dialog>` in new code.
- Form fields put the label left and the input right: `grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3`.
- Never hardcode clinical vocabulary (AGENTS.md §8). Reference targets come from `ENTITY_TARGETS` and the terminology service.
- Never pipe turbo through `tail`. Never read `$?` through a pipe.
- No `Co-Authored-By` trailers on commits (AGENTS.md §9).
- Work on branch `feat/form-builder-s2`. Merge to local `main` at the end. Do not push. Do not open a PR.

## Decisions taken with the operator on 2026-09-14

- **B8 is the full corlix block.** CE already edited five of the six `reference*` keys, under Mapping, Advanced (`MappingEditor.tsx:232-297`). The spec's verdict "no builder file reads them" was wrong. The operator chose corlix's block anyway: its own section after General, only on `reference` fields, a target dropdown, and a Depends On picker.
- **The target dropdown's options come from CE, not corlix.** Corlix lists `Patient`, `TestDefinition` and `SpecimenType` (`FieldEditor.tsx:59`). CE's reference search resolves one entity, `Patient` (`ENTITY_TARGETS`, `packages/db/src/reference-search.ts:19`). Every other CE target is a code-system URL (`reference-source.ts:24-41`), such as the seeded Lab order form's `http://loinc.org` (`samples/forms.ts:338`). So the dropdown lists `Patient` and every active code system with a URL. A stored value missing from that list is added as an option, so opening the Lab order form never blanks its target.
- **Survey forms hide only the mapping controls:** FHIR Path, API Property and the discriminator editor. CE's Mapping block also holds Observation Extract, which a form needs to be submitted, so the rest of the block stays.

## Facts checked while writing this plan

- Corlix's click on a part while the group has unsaved edits saves those edits, then opens the part (`corlix FormBuilderPage.tsx:577-585`, `commitDraftAndSelect`). This settles the spec's open question.
- Corlix's "+ Add a named slot" and "+ Add a part" push one undo step, insert after the last sibling and open the new field (`FormBuilderPage.tsx:588-601`). The new field stays if the author cancels. Undo removes it.
- Corlix disables a locked field's Enabled checkbox and hides Delete from its row `⋯` menu (`FieldRow.tsx:197,357`). Its editor's Enabled checkbox stays live. CE matches both.
- Ticking "Array element (discriminator)" writes `{ fhirDiscriminator: {}, fhirValueField: 'value' }`. Unticking clears both (`corlix FieldEditor.tsx:594-606`).
- `lint.ts:63` compares `JSON.stringify(f.fhirDiscriminator ?? null)`. After this plan it compares `discriminatorIdentity`. Two things change, and both match corlix. Keys in a different order count as the same discriminator. An empty `{}` counts as no discriminator. Task 1 pins both with tests.
- Nothing in CE reads `referenceDependsOn` or `referenceSearchable` outside the editor (grep over `apps/studio/src`, `packages/forms/src`, `apps/server/src`). The docs say so.
- `referenceMultiple` is read by `isMultiValued` (`reference-source.ts:59-65`). It already worked and keeps working.
- CE's dev database holds 10 active code systems and 494 inactive ones from the FHIR catalog. Offering only active systems keeps the target list short.
- `MappingEditor.test.tsx:173-189` tests `referenceTarget` under Advanced. Task 4 moves those controls, so it replaces those tests.
- CE's `select.tsx` exports `SelectGroup` and `SelectSeparator` but no `SelectLabel`.

## File map

| File | Change |
|---|---|
| `packages/forms/src/schema/form-schema.ts` | discriminator zod union |
| `packages/forms/src/discriminator.ts` + test | normalize, identity, store, label for both shapes |
| `packages/forms/src/lint.ts` + `lint.test.ts` | compare by identity |
| `packages/forms/src/survey-mode.ts` + test | new: `isSurveyForm` |
| `packages/forms/src/reference-source.ts` + test | `REFERENCE_ENTITY_TARGETS` |
| `packages/forms/src/pure.ts`, `index.ts` | export `survey-mode` |
| `apps/studio/src/forms-builder/field-editor/DiscriminatorEditor.tsx` | new |
| `apps/studio/src/forms-builder/field-editor/MappingEditor.tsx` + test | host the discriminator editor, survey mode, Reference leaves Advanced |
| `apps/studio/src/forms-builder/field-editor/ReferenceEditor.tsx` + test | new |
| `apps/studio/src/forms-builder/newFormFields.ts` + test | new: slot and part builders |
| `apps/studio/src/forms-builder/RepeatRow.tsx` | `AddNamedSlotRow` |
| `apps/studio/src/forms-builder/FieldListPane.tsx` + test | "+ Add a named slot" under a repeat |
| `apps/studio/src/forms-builder/FieldEditorSheet.tsx` + test | block order, Reference block, Parts block, survey prop |
| `apps/studio/src/forms-builder/SortableFieldRow.tsx` + test | locked fields |
| `apps/studio/src/forms-builder/FormBuilderPage.tsx` | slot, part and open-field handlers, locked delete guard |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`, `apps/web/src/docs/0.1.8/forms.md` | new section, corrected example steps |

---

### Task 0: Branch

- [ ] **Step 1: Create the branch from local main**

```bash
git switch main
git switch -c feat/form-builder-s2
```

---

### Task 1: The discriminator takes a condition rule

**Files:**
- Modify: `packages/forms/src/schema/form-schema.ts:45-75`
- Modify: `packages/forms/src/discriminator.ts`
- Modify: `packages/forms/src/lint.ts:61-64`
- Test: `packages/forms/src/discriminator.test.ts`, `packages/forms/src/lint.test.ts`

**Interfaces:**
- Produces, from `@openldr/forms/pure`:
  - types `DiscriminatorOp = 'equals' | 'not equals' | 'starts with'`, `DiscriminatorCondition = { el: string; op: DiscriminatorOp; val: string }`, `DiscriminatorRule = { join: 'all' | 'any'; conds: DiscriminatorCondition[] }`, `FieldDiscriminator = Record<string, string> | DiscriminatorRule`
  - `normalizeDiscriminator(d: FieldDiscriminator | undefined): DiscriminatorRule | null`
  - `discriminatorIdentity(d: FieldDiscriminator | undefined): string`
  - `toStoredDiscriminator(rule: DiscriminatorRule): FieldDiscriminator`
  - `discriminatorLabel(d: FieldDiscriminator | undefined): string | null`, now reading both shapes

- [ ] **Step 1: Write the failing tests**

Replace `packages/forms/src/discriminator.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  discriminatorIdentity,
  discriminatorLabel,
  normalizeDiscriminator,
  toStoredDiscriminator,
} from './discriminator';
import { toQuestionnaire } from './to-questionnaire';
import { fromQuestionnaire } from './from-questionnaire';
import { makeField, makeSchema } from './__fixtures__/forms';

describe('discriminatorLabel', () => {
  it('returns null when there is no discriminator', () => {
    expect(discriminatorLabel(undefined)).toBeNull();
  });

  it('returns null for an empty discriminator, so the row skips the line', () => {
    expect(discriminatorLabel({})).toBeNull();
  });

  it('renders one condition as a sentence', () => {
    expect(discriminatorLabel({ system: 'urn:x' })).toBe('system = urn:x');
  });

  it('sorts keys, so one discriminator always reads the same', () => {
    expect(discriminatorLabel({ use: 'work', system: 'phone' })).toBe('system = phone, use = work');
  });

  it('says "or" under Any, because a comma would read as "and"', () => {
    const rule = { join: 'any' as const, conds: [{ el: 'system', op: 'equals' as const, val: 'a' }, { el: 'system', op: 'equals' as const, val: 'b' }] };
    expect(discriminatorLabel(rule)).toBe('system = a or system = b');
  });

  it('spells out the other two operators', () => {
    const rule = { join: 'all' as const, conds: [{ el: 'use', op: 'not equals' as const, val: 'old' }, { el: 'system', op: 'starts with' as const, val: 'urn:x:' }] };
    expect(discriminatorLabel(rule)).toBe('use != old, system starts with urn:x:');
  });
});

describe('normalizeDiscriminator', () => {
  it('is null when there is no discriminator', () => {
    expect(normalizeDiscriminator(undefined)).toBeNull();
  });

  it('reads an empty record as an empty All rule, which is a real state', () => {
    expect(normalizeDiscriminator({})).toEqual({ join: 'all', conds: [] });
  });

  it('reads a record as equality conditions, keys sorted', () => {
    expect(normalizeDiscriminator({ use: 'work', system: 'phone' })).toEqual({
      join: 'all',
      conds: [{ el: 'system', op: 'equals', val: 'phone' }, { el: 'use', op: 'equals', val: 'work' }],
    });
  });

  it('passes a rule through unchanged', () => {
    const rule = { join: 'any' as const, conds: [{ el: 'system', op: 'starts with' as const, val: 'urn:' }] };
    expect(normalizeDiscriminator(rule)).toBe(rule);
  });
});

describe('discriminatorIdentity', () => {
  it('gives a record and the rule that means the same thing one identity', () => {
    const rule = { join: 'all' as const, conds: [{ el: 'system', op: 'equals' as const, val: 'x' }] };
    expect(discriminatorIdentity({ system: 'x' })).toBe(discriminatorIdentity(rule));
  });

  it('ignores key order', () => {
    expect(discriminatorIdentity({ a: '1', b: '2' })).toBe(discriminatorIdentity({ b: '2', a: '1' }));
  });

  it('tells All from Any over the same conditions', () => {
    const conds = [{ el: 'system', op: 'equals' as const, val: 'a' }, { el: 'system', op: 'equals' as const, val: 'b' }];
    expect(discriminatorIdentity({ join: 'all', conds })).not.toBe(discriminatorIdentity({ join: 'any', conds }));
  });

  it('keys no discriminator and an empty one alike', () => {
    expect(discriminatorIdentity(undefined)).toBe('');
    expect(discriminatorIdentity({})).toBe('');
  });
});

describe('toStoredDiscriminator', () => {
  const eq = (el: string, val: string) => ({ el, op: 'equals' as const, val });

  it('stores plain equality under All as the old record', () => {
    expect(toStoredDiscriminator({ join: 'all', conds: [eq('system', 'x'), eq('use', 'w')] })).toEqual({ system: 'x', use: 'w' });
  });

  it('keeps a rule for Any', () => {
    const rule = { join: 'any' as const, conds: [eq('system', 'x')] };
    expect(toStoredDiscriminator(rule)).toBe(rule);
  });

  it('keeps a rule for an operator a record cannot say', () => {
    const rule = { join: 'all' as const, conds: [{ el: 'system', op: 'starts with' as const, val: 'urn:' }] };
    expect(toStoredDiscriminator(rule)).toBe(rule);
  });

  it('keeps a rule when two conditions share an element, which a record would collapse', () => {
    const rule = { join: 'all' as const, conds: [eq('system', 'a'), eq('system', 'b')] };
    expect(toStoredDiscriminator(rule)).toBe(rule);
  });

  it('keeps a rule when a record would reorder the rows under the author', () => {
    const rule = { join: 'all' as const, conds: [eq('use', 'w'), eq('system', 'x')] };
    expect(toStoredDiscriminator(rule)).toBe(rule);
  });
});

describe('export round trip', () => {
  it('carries a rule discriminator through the Questionnaire', () => {
    const rule = { join: 'any' as const, conds: [{ el: 'system', op: 'starts with' as const, val: 'urn:x:' }] };
    const schema = makeSchema({
      id: 'f',
      name: 'F',
      fields: [makeField({ id: 'id1', displayLabel: 'ID', fieldType: 'text', order: 0, fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: rule })],
    });
    expect(fromQuestionnaire(toQuestionnaire(schema)).fields[0].fhirDiscriminator).toEqual(rule);
  });
});
```

Add these tests at the end of the `describe('ambiguous-fhir-path')` block in `packages/forms/src/lint.test.ts`:

```ts
  it('flags key order as the same discriminator', () => {
    const issues = lintFormSchema(form([
      field({ id: 'a', fhirDiscriminator: { system: 'x', use: 'w' } }),
      field({ id: 'b', fhirDiscriminator: { use: 'w', system: 'x' } }),
    ]));
    expect(issues.filter((i) => i.code === 'ambiguous-fhir-path')).toHaveLength(2);
  });

  it('flags an empty discriminator beside none, since both name no element', () => {
    const issues = lintFormSchema(form([field({ id: 'a', fhirDiscriminator: {} }), field({ id: 'b' })]));
    expect(issues.filter((i) => i.code === 'ambiguous-fhir-path')).toHaveLength(2);
  });

  it('accepts two slots told apart by an Any rule and a record', () => {
    const issues = lintFormSchema(form([
      field({ id: 'a', fhirDiscriminator: { system: 'x' } }),
      field({ id: 'b', fhirDiscriminator: { join: 'any', conds: [{ el: 'system', op: 'equals', val: 'y' }, { el: 'system', op: 'equals', val: 'z' }] } }),
    ]));
    expect(issues.filter((i) => i.code === 'ambiguous-fhir-path')).toEqual([]);
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @openldr/forms exec vitest run src/discriminator.test.ts src/lint.test.ts`
Expected: FAIL. The imports `normalizeDiscriminator`, `discriminatorIdentity` and `toStoredDiscriminator` are undefined. The two rule-label tests fail. The first two new lint tests fail, because `JSON.stringify` still tells `{system, use}` from `{use, system}`, and `{}` from none. The third may pass already.

- [ ] **Step 3: Widen the schema**

In `packages/forms/src/schema/form-schema.ts`, add this block before `export const FormField` (after `VisibilityRule`):

```ts
/**
 * Which element of a repeating FHIR list a field fills.
 *
 * Two shapes. The old key/value map means "every key equals its value". The rule adds `any` and two
 * more operators. Storage keeps the map whenever it says the same thing, so old forms never change.
 * Read, compare and store through `discriminator.ts`; nothing should interpret either shape by hand.
 */
export const DiscriminatorOp = z.enum(['equals', 'not equals', 'starts with']);
export type DiscriminatorOp = z.infer<typeof DiscriminatorOp>;

export const DiscriminatorCondition = z.object({ el: z.string(), op: DiscriminatorOp, val: z.string() });
export type DiscriminatorCondition = z.infer<typeof DiscriminatorCondition>;

export const DiscriminatorRule = z.object({ join: z.enum(['all', 'any']), conds: z.array(DiscriminatorCondition) });
export type DiscriminatorRule = z.infer<typeof DiscriminatorRule>;

// The rule is tried first: a map needs every value to be a string, so a rule never parses as a map.
export const FieldDiscriminator = z.union([DiscriminatorRule, z.record(z.string())]);
export type FieldDiscriminator = z.infer<typeof FieldDiscriminator>;
```

Change the `fhirDiscriminator` line inside `FormField`:

```ts
  fhirDiscriminator: FieldDiscriminator.optional(),
```

- [ ] **Step 4: Rewrite `discriminator.ts`**

Replace `packages/forms/src/discriminator.ts` with:

```ts
import type { DiscriminatorCondition, DiscriminatorRule, FieldDiscriminator } from './schema/form-schema';

/**
 * One place that reads a field's `fhirDiscriminator`, in either shape.
 *
 * Ported from corlix `apps/desktop/src/renderer/lib/discriminator.ts` and `discriminatorLabel.ts`.
 * Corlix also has `matchesDiscriminator` and `discriminatorSeed`, which pick and create a list entry
 * when a record is saved. CE does not read the discriminator on save yet, so they are not ported.
 */

function isRule(d: FieldDiscriminator): d is DiscriminatorRule {
  return Array.isArray((d as DiscriminatorRule).conds);
}

/**
 * Either shape as a condition list. Null only when there is no discriminator at all, which differs
 * from an empty one: ticking the editor's checkbox writes `{}`. Keys are sorted, so one
 * discriminator always normalises the same however it was written.
 */
export function normalizeDiscriminator(d: FieldDiscriminator | undefined): DiscriminatorRule | null {
  if (!d) return null;
  if (isRule(d)) return d;
  return {
    join: 'all',
    conds: Object.keys(d).sort().map((el) => ({ el, op: 'equals' as const, val: d[el] })),
  };
}

/**
 * A stable key for "which list entry does this discriminator mean". A map and the rule that means
 * the same thing get one key, so both on one path is a duplicate. The join is part of the key:
 * `all` and `any` over the same conditions are different questions. No discriminator and an empty
 * one both key as the empty string, because neither names an entry.
 */
export function discriminatorIdentity(d: FieldDiscriminator | undefined): string {
  const rule = normalizeDiscriminator(d);
  if (!rule || rule.conds.length === 0) return '';
  const conds = rule.conds
    .map((c) => `${c.el}${c.op === 'equals' ? '=' : `|${c.op}|`}${c.val}`)
    .sort()
    .join('&');
  return rule.join === 'any' ? `any(${conds})` : conds;
}

/**
 * What the editor writes after the author changes a condition.
 *
 * A rule a map can express is stored as a map, so opening an old form and changing nothing leaves
 * it byte-identical. The rule is kept for `any`, for an operator beyond equality, for two conditions
 * on one element (a map would drop one), and when a map would reorder the rows under the author's
 * cursor. Corlix found that last case by driving the editor: a new blank row sorted to the top.
 */
export function toStoredDiscriminator(rule: DiscriminatorRule): FieldDiscriminator {
  if (rule.join === 'any') return rule;
  if (rule.conds.some((c) => c.op !== 'equals')) return rule;
  const els = rule.conds.map((c) => c.el);
  if (new Set(els).size !== els.length) return rule;
  const sorted = [...els].sort();
  if (els.some((el, i) => el !== sorted[i])) return rule;
  const record: Record<string, string> = {};
  for (const c of rule.conds) record[c.el] = c.val;
  return record;
}

function condText(c: DiscriminatorCondition): string {
  switch (c.op) {
    case 'equals':
      return `${c.el} = ${c.val}`;
    case 'not equals':
      return `${c.el} != ${c.val}`;
    case 'starts with':
      // Spelled out: no symbol for this reads unambiguously at 10px.
      return `${c.el} starts with ${c.val}`;
  }
}

/**
 * A field's discriminator as one short line for the field row, for example `system = urn:x`.
 * Two fields bound to `Location.identifier.value` are the same text on screen, and this line is
 * the only thing telling them apart. Null when there is nothing to show, so the row skips the line.
 * `all` joins with a comma; `any` says "or", because a comma would read as "and".
 */
export function discriminatorLabel(d: FieldDiscriminator | undefined): string | null {
  const rule = normalizeDiscriminator(d);
  if (!rule || rule.conds.length === 0) return null;
  return rule.conds.map(condText).join(rule.join === 'any' ? ' or ' : ', ');
}
```

- [ ] **Step 5: Compare by identity in the lint**

In `packages/forms/src/lint.ts`, add the import:

```ts
import { discriminatorIdentity } from './discriminator';
```

Replace lines 61-64:

```ts
    // A discriminator only disambiguates if the fields' discriminators actually DIFFER; two fields
    // carrying the same `{system: X}` are just as ambiguous as two carrying none. Identity, not
    // JSON: key order and the two stored shapes must not make one discriminator look like two.
    const keys = fields.map((f) => discriminatorIdentity(f.fhirDiscriminator));
    if (new Set(keys).size === fields.length) continue;
```

- [ ] **Step 6: Run and watch them pass**

Run: `pnpm --filter @openldr/forms exec vitest run`
Expected: PASS for the whole package, including `lint.test.ts`, `round-trip.test.ts` and the S1 tests.

- [ ] **Step 7: Typecheck the packages that read `FormField`**

Run: `pnpm --filter @openldr/forms typecheck > /tmp/s2-t1-forms.txt 2>&1; echo "exit=$?"`
Run: `pnpm --filter @openldr/studio typecheck > /tmp/s2-t1-studio.txt 2>&1; echo "exit=$?"`
Run: `pnpm --filter @openldr/server typecheck > /tmp/s2-t1-server.txt 2>&1; echo "exit=$?"`
Expected: `exit=0` for all three. If one fails on `fhirDiscriminator` being indexed as a map, route that read through `normalizeDiscriminator` rather than casting.

- [ ] **Step 8: Commit**

```bash
git add packages/forms/src/schema/form-schema.ts packages/forms/src/discriminator.ts \
  packages/forms/src/discriminator.test.ts packages/forms/src/lint.ts packages/forms/src/lint.test.ts
git commit -m "feat(forms): let a discriminator say any, not equals and starts with"
```

---

### Task 2: Survey mode and the reference entity list

**Files:**
- Create: `packages/forms/src/survey-mode.ts`, `packages/forms/src/survey-mode.test.ts`
- Modify: `packages/forms/src/reference-source.ts`
- Test: `packages/forms/src/reference-source.test.ts`
- Modify: `packages/forms/src/pure.ts`, `packages/forms/src/index.ts`

**Interfaces:**
- Produces, from `@openldr/forms/pure`:
  - `isSurveyForm(fhirResourceType: string | null | undefined): boolean`
  - `REFERENCE_ENTITY_TARGETS: readonly string[]`, today `['Patient']`

`mapsToResource` from corlix's `surveyMode.ts` is not ported here. Only S3's Library needs it.

- [ ] **Step 1: Write the failing tests**

Create `packages/forms/src/survey-mode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isSurveyForm } from './survey-mode';

describe('isSurveyForm', () => {
  it('is true for a Questionnaire form', () => {
    expect(isSurveyForm('Questionnaire')).toBe(true);
  });

  it('is false for a resource form, and for no type at all', () => {
    expect(isSurveyForm('Location')).toBe(false);
    expect(isSurveyForm(null)).toBe(false);
    expect(isSurveyForm(undefined)).toBe(false);
  });
});
```

Add to `packages/forms/src/reference-source.test.ts`, with its imports at the top of the file:

```ts
import { ENTITY_TARGETS } from '@openldr/db';
import { REFERENCE_ENTITY_TARGETS } from './reference-source';

describe('REFERENCE_ENTITY_TARGETS', () => {
  it('lists exactly the entities the server can search, so the builder never offers one that fails', () => {
    expect([...REFERENCE_ENTITY_TARGETS]).toEqual([...ENTITY_TARGETS]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @openldr/forms exec vitest run src/survey-mode.test.ts src/reference-source.test.ts`
Expected: FAIL. `./survey-mode` does not resolve and `REFERENCE_ENTITY_TARGETS` is undefined.

- [ ] **Step 3: Implement**

Create `packages/forms/src/survey-mode.ts`:

```ts
/**
 * A form whose resource type is `Questionnaire` IS a questionnaire, not a mapping onto one. It has
 * no resource to point a field at, so the editor hides the mapping controls. Named once here so
 * the editor and, from S3, the Library ask the same question.
 *
 * Ported from corlix `apps/desktop/src/renderer/lib/surveyMode.ts`.
 */
export function isSurveyForm(fhirResourceType: string | null | undefined): boolean {
  return fhirResourceType === 'Questionnaire';
}
```

In `packages/forms/src/reference-source.ts`, add after the `ReferenceSourceResult` type:

```ts
/**
 * The entity types a reference field can search, for the builder's target dropdown.
 *
 * Mirrors `ENTITY_TARGETS` in `@openldr/db` (`reference-search.ts`), which the server resolves.
 * This package's browser entry cannot import `@openldr/db`, so a test pins the two lists equal.
 * Every other target is a code-system URL, offered from the terminology service.
 */
export const REFERENCE_ENTITY_TARGETS: readonly string[] = ['Patient'];
```

In `packages/forms/src/pure.ts` and `packages/forms/src/index.ts`, add after `export * from './group-repeats';`:

```ts
export * from './survey-mode';
```

- [ ] **Step 4: Run and watch them pass**

Run: `pnpm --filter @openldr/forms exec vitest run src/survey-mode.test.ts src/reference-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/forms/src/survey-mode.ts packages/forms/src/survey-mode.test.ts \
  packages/forms/src/reference-source.ts packages/forms/src/reference-source.test.ts \
  packages/forms/src/pure.ts packages/forms/src/index.ts
git commit -m "feat(forms): name survey forms and the searchable reference entities"
```

---

### Task 3: The discriminator editor, and survey forms hide mapping

**Files:**
- Create: `apps/studio/src/forms-builder/field-editor/DiscriminatorEditor.tsx`
- Modify: `apps/studio/src/forms-builder/field-editor/MappingEditor.tsx`
- Test: `apps/studio/src/forms-builder/field-editor/MappingEditor.test.tsx`

**Interfaces:**
- Consumes: `normalizeDiscriminator`, `toStoredDiscriminator` and the discriminator types from Task 1.
- Produces:
  - `DiscriminatorEditor({ field, onUpdate })`
  - `MappingEditorProps.surveyMode?: boolean`. When true, FHIR Path, the discriminator editor and API Property are hidden.

- [ ] **Step 1: Write the failing tests**

Add to `apps/studio/src/forms-builder/field-editor/MappingEditor.test.tsx`. First change `Harness` and `renderEditor` so a test can pass `surveyMode`:

```tsx
function Harness({
  field,
  fhirResourceType,
  surveyMode,
  onUpdate,
}: {
  field: FormField;
  fhirResourceType: string | null;
  surveyMode?: boolean;
  onUpdate: (patch: Partial<FormField>) => void;
}) {
  const [current, setCurrent] = useState(field);
  return (
    <MappingEditor
      field={current}
      fhirResourceType={fhirResourceType}
      surveyMode={surveyMode}
      onUpdate={(patch) => {
        onUpdate(patch);
        setCurrent((f) => ({ ...f, ...patch }));
      }}
    />
  );
}

function renderEditor(overrides: Partial<FormField> = {}, fhirResourceType: string | null = 'Location', surveyMode = false) {
  const onUpdate = vi.fn();
  const field = { ...BASE_FIELD, ...overrides };
  const utils = render(
    <Harness field={field} fhirResourceType={fhirResourceType} surveyMode={surveyMode} onUpdate={onUpdate} />,
  );
  return { ...utils, onUpdate };
}
```

Then add this block inside `describe('MappingEditor')`:

```tsx
  describe('discriminator editor', () => {
    const slot = { fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system: 'urn:x' } };

    it('shows no criteria until the box is ticked', () => {
      renderEditor();
      expect(screen.queryByText('Match criteria')).toBeNull();
    });

    it('ticking the box writes an empty discriminator and the value field', () => {
      const { onUpdate } = renderEditor();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Array element (discriminator)' }));
      expect(onUpdate).toHaveBeenCalledWith({ fhirDiscriminator: {}, fhirValueField: 'value' });
    });

    it('unticking clears both', () => {
      const { onUpdate } = renderEditor(slot);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Array element (discriminator)' }));
      expect(onUpdate).toHaveBeenCalledWith({ fhirDiscriminator: undefined, fhirValueField: undefined });
    });

    it('shows a stored map as one condition row', () => {
      renderEditor(slot);
      expect((screen.getByRole('textbox', { name: 'Condition 1 element' }) as HTMLInputElement).value).toBe('system');
      expect((screen.getByRole('textbox', { name: 'Condition 1 value' }) as HTMLInputElement).value).toBe('urn:x');
    });

    it('stores a plain equality edit as the old map', () => {
      const { onUpdate } = renderEditor(slot);
      fireEvent.change(screen.getByRole('textbox', { name: 'Condition 1 value' }), { target: { value: 'urn:y' } });
      expect(onUpdate).toHaveBeenLastCalledWith({ fhirDiscriminator: { system: 'urn:y' } });
    });

    it('hides All and Any at one condition and shows them at two', () => {
      renderEditor(slot);
      expect(screen.queryByRole('button', { name: 'Any' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '+ Add condition' }));
      expect(screen.getByRole('button', { name: 'Any' })).toBeTruthy();
    });

    it('choosing Any stores a rule', () => {
      const { onUpdate } = renderEditor({ ...slot, fhirDiscriminator: { system: 'a', use: 'b' } });
      fireEvent.click(screen.getByRole('button', { name: 'Any' }));
      expect(onUpdate).toHaveBeenLastCalledWith({
        fhirDiscriminator: {
          join: 'any',
          conds: [{ el: 'system', op: 'equals', val: 'a' }, { el: 'use', op: 'equals', val: 'b' }],
        },
      });
    });

    it('choosing starts with stores a rule', () => {
      const { onUpdate } = renderEditor(slot);
      fireEvent.click(screen.getByRole('combobox', { name: 'Condition 1 operator' }));
      fireEvent.click(screen.getByText('starts with'));
      expect(onUpdate).toHaveBeenLastCalledWith({
        fhirDiscriminator: { join: 'all', conds: [{ el: 'system', op: 'starts with', val: 'urn:x' }] },
      });
    });

    it('removes a condition', () => {
      const { onUpdate } = renderEditor({ ...slot, fhirDiscriminator: { system: 'a', use: 'b' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove condition' })[1]);
      expect(onUpdate).toHaveBeenLastCalledWith({ fhirDiscriminator: { system: 'a' } });
    });

    it('edits the value field', () => {
      const { onUpdate } = renderEditor(slot);
      fireEvent.change(screen.getByRole('textbox', { name: 'Value Field' }), { target: { value: 'code' } });
      expect(onUpdate).toHaveBeenLastCalledWith({ fhirValueField: 'code' });
    });
  });

  describe('survey mode', () => {
    it('hides FHIR Path, API Property and the discriminator, and keeps Observation Extract', () => {
      renderEditor({}, 'Questionnaire', true);
      expect(screen.queryByText('FHIR Path')).toBeNull();
      expect(screen.queryByRole('textbox', { name: /api property/i })).toBeNull();
      expect(screen.queryByRole('checkbox', { name: 'Array element (discriminator)' })).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'Observation Extract' })).toBeTruthy();
    });
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder/field-editor/MappingEditor.test.tsx`
Expected: FAIL. The new discriminator tests find no checkbox, and the survey test still finds FHIR Path. "Shows no criteria until the box is ticked" may pass already.

- [ ] **Step 3: Write `DiscriminatorEditor.tsx`**

Create `apps/studio/src/forms-builder/field-editor/DiscriminatorEditor.tsx`:

```tsx
import { X } from 'lucide-react';
import {
  normalizeDiscriminator,
  toStoredDiscriminator,
  type DiscriminatorCondition,
  type DiscriminatorOp,
  type DiscriminatorRule,
  type FormField,
} from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const OPS: { value: DiscriminatorOp; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not equals', label: 'not equals' },
  { value: 'starts with', label: 'starts with' },
];

export interface DiscriminatorEditorProps {
  field: FormField;
  onUpdate: (patch: Partial<FormField>) => void;
}

/**
 * Which entry of a repeating FHIR list the field fills: a list of conditions, each an element, an
 * operator and a value. Ported from corlix `FieldEditor.tsx:594-716`.
 *
 * Every edit goes through `toStoredDiscriminator`, so a rule the old map can express is stored as
 * the map and an old form opened and left alone stays byte-identical.
 */
export function DiscriminatorEditor({ field, onUpdate }: DiscriminatorEditorProps): JSX.Element {
  const rule: DiscriminatorRule = normalizeDiscriminator(field.fhirDiscriminator) ?? { join: 'all', conds: [] };
  const writeRule = (next: DiscriminatorRule) => onUpdate({ fhirDiscriminator: toStoredDiscriminator(next) });
  const writeCond = (i: number, patch: Partial<DiscriminatorCondition>) =>
    writeRule({ ...rule, conds: rule.conds.map((c, k) => (k === i ? { ...c, ...patch } : c)) });

  return (
    <div className="col-span-2 space-y-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id="mapping-array-element"
          aria-label="Array element (discriminator)"
          checked={!!field.fhirDiscriminator}
          onCheckedChange={(checked) =>
            onUpdate(
              checked
                ? { fhirDiscriminator: {}, fhirValueField: 'value' }
                : { fhirDiscriminator: undefined, fhirValueField: undefined },
            )
          }
        />
        <Label htmlFor="mapping-array-element" className="text-xs">
          Array element (discriminator)
        </Label>
      </div>

      {field.fhirDiscriminator && (
        <div className="min-w-0 space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Match criteria</span>
            {/* The join decides nothing with one condition, so it is not asked until there are two. */}
            {rule.conds.length > 1 && (
              <div className="ml-auto inline-flex shrink-0 overflow-hidden rounded border border-border">
                {(['all', 'any'] as const).map((join) => (
                  <Button
                    key={join}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={rule.join === join}
                    className={`h-6 rounded-none px-2 text-[10px] ${
                      rule.join === join ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
                    }`}
                    onClick={() => writeRule({ ...rule, join })}
                  >
                    {join === 'all' ? 'All' : 'Any'}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {rule.conds.map((cond, i) => (
            <div key={i} className="flex min-w-0 flex-wrap items-center gap-1 sm:flex-nowrap">
              <Input
                aria-label={`Condition ${i + 1} element`}
                className="h-7 min-w-0 flex-1 text-xs"
                placeholder="element"
                value={cond.el}
                onChange={(e) => writeCond(i, { el: e.target.value })}
              />
              <Select value={cond.op} onValueChange={(v) => writeCond(i, { op: v as DiscriminatorOp })}>
                <SelectTrigger aria-label={`Condition ${i + 1} operator`} className="h-7 w-[104px] shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPS.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={`Condition ${i + 1} value`}
                className="h-7 min-w-0 flex-1 text-xs"
                placeholder="value"
                value={cond.val}
                onChange={(e) => writeCond(i, { val: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove condition"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => writeRule({ ...rule, conds: rule.conds.filter((_, k) => k !== i) })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-full border-dashed text-[11px] font-normal text-primary"
            onClick={() => writeRule({ ...rule, conds: [...rule.conds, { el: '', op: 'equals', val: '' }] })}
          >
            + Add condition
          </Button>

          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4">
            <Label htmlFor="mapping-value-field" className="whitespace-nowrap text-xs">
              Value Field
            </Label>
            <Input
              id="mapping-value-field"
              aria-label="Value Field"
              className="h-7 font-mono text-xs"
              value={field.fhirValueField ?? ''}
              onChange={(e) => onUpdate({ fhirValueField: e.target.value || undefined })}
              placeholder="e.g. value"
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Host it in `MappingEditor.tsx`, and add survey mode**

In `apps/studio/src/forms-builder/field-editor/MappingEditor.tsx`:

Add the import:

```tsx
import { DiscriminatorEditor } from './DiscriminatorEditor';
```

Add to `MappingEditorProps`:

```tsx
  /**
   * True on a Questionnaire form. A survey question points at no resource, so FHIR Path, the
   * discriminator and API Property are hidden. Observation Extract and the rest stay: CE needs
   * Observation Extract to submit a form at all.
   */
  surveyMode?: boolean;
```

Change the signature to `export function MappingEditor({ field, fhirResourceType, surveyMode = false, onUpdate }: MappingEditorProps): JSX.Element {`.

Wrap the FHIR Path label and its `<div className="min-w-0">` block, and the API Property label and input, in one `{!surveyMode && (<> … </>)}`. Place the discriminator editor between them, so the grid reads FHIR Path, discriminator, API Property:

```tsx
          {!surveyMode && (
            <>
              {/* FHIR Path: the existing Label and <div className="min-w-0"> block, unchanged */}
              <DiscriminatorEditor field={field} onUpdate={onUpdate} />
              {/* API Property: the existing Label and Input, unchanged */}
            </>
          )}
```

Keep the existing FHIR Path and API Property JSX exactly as it is. Only move it inside the fragment.

- [ ] **Step 5: Run and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder/field-editor/MappingEditor.test.tsx`
Expected: PASS, the whole file.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/forms-builder/field-editor/DiscriminatorEditor.tsx \
  apps/studio/src/forms-builder/field-editor/MappingEditor.tsx \
  apps/studio/src/forms-builder/field-editor/MappingEditor.test.tsx
git commit -m "feat(studio): edit a discriminator, and hide mapping on a survey form"
```

---

### Task 4: The Reference Configuration block, and Mapping above Codes

**Files:**
- Create: `apps/studio/src/forms-builder/field-editor/ReferenceEditor.tsx`, `ReferenceEditor.test.tsx`
- Modify: `apps/studio/src/forms-builder/field-editor/MappingEditor.tsx:232-297`
- Modify: `apps/studio/src/forms-builder/field-editor/MappingEditor.test.tsx:173-189`
- Modify: `apps/studio/src/forms-builder/FieldEditorSheet.tsx:276-332`
- Test: `apps/studio/src/forms-builder/FieldEditorSheet.test.tsx`

**Interfaces:**
- Consumes: `REFERENCE_ENTITY_TARGETS` and `isSurveyForm` from Task 2. `listCodingSystems` and `CodingSystem` from `apps/studio/src/api.ts:2037,2093`.
- Produces: `ReferenceEditor({ field, allFields, onUpdate })`.

- [ ] **Step 1: Write the failing Reference tests**

Create `apps/studio/src/forms-builder/field-editor/ReferenceEditor.test.tsx`:

```tsx
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField } from '@openldr/forms/pure';

vi.mock('../../api', () => ({
  listCodingSystems: vi.fn(async () => [
    { id: 'cs-1', systemCode: 'LOINC', systemName: 'LOINC', url: 'http://loinc.org', systemVersion: null, description: null, active: true, publisherId: null, seeded: true },
    { id: 'cs-2', systemCode: 'OLD', systemName: 'Old', url: 'urn:old', systemVersion: null, description: null, active: false, publisherId: null, seeded: true },
    { id: 'cs-3', systemCode: 'NOURL', systemName: 'No URL', url: null, systemVersion: null, description: null, active: true, publisherId: null, seeded: false },
  ]),
}));

import { ReferenceEditor } from './ReferenceEditor';

const REF: FormField = {
  id: 'tests', displayLabel: 'Tests', fieldType: 'reference', required: false, enabled: true,
  fhirPath: null, order: 0, cardinality: { min: 0, max: '1' }, description: null,
};
const OTHER: FormField = { ...REF, id: 'patient', displayLabel: 'Patient', order: 1 };

function Harness({ field, onUpdate }: { field: FormField; onUpdate: (p: Partial<FormField>) => void }) {
  const [current, setCurrent] = useState(field);
  return (
    <ReferenceEditor
      field={current}
      allFields={[current, OTHER]}
      onUpdate={(patch) => { onUpdate(patch); setCurrent((f) => ({ ...f, ...patch })); }}
    />
  );
}

function renderRef(overrides: Partial<FormField> = {}) {
  const onUpdate = vi.fn();
  render(<Harness field={{ ...REF, ...overrides }} onUpdate={onUpdate} />);
  return { onUpdate };
}

describe('ReferenceEditor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers Patient and active code systems that have a URL, and nothing else', async () => {
    renderRef();
    fireEvent.click(screen.getByRole('combobox', { name: 'Target' }));
    expect(await screen.findByRole('option', { name: 'LOINC · http://loinc.org' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Patient' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /urn:old/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /No URL/ })).toBeNull();
  });

  it('keeps a stored target the list does not know, so opening the field never blanks it', async () => {
    renderRef({ referenceTarget: 'urn:custom:system' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Target' }));
    expect(await screen.findByRole('option', { name: 'urn:custom:system' })).toBeTruthy();
  });

  it('writes the picked target', async () => {
    const { onUpdate } = renderRef();
    fireEvent.click(screen.getByRole('combobox', { name: 'Target' }));
    fireEvent.click(await screen.findByRole('option', { name: 'LOINC · http://loinc.org' }));
    expect(onUpdate).toHaveBeenCalledWith({ referenceTarget: 'http://loinc.org' });
  });

  it('offers every other field for Depends On, and None clears it', () => {
    const { onUpdate } = renderRef({ referenceDependsOn: 'patient' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Depends On' }));
    expect(screen.queryByRole('option', { name: 'Tests (tests)' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    expect(onUpdate).toHaveBeenCalledWith({ referenceDependsOn: undefined });
  });

  it('shows Searchable ticked when it was never set, as corlix does', () => {
    renderRef();
    expect(screen.getByRole('checkbox', { name: 'Searchable' }).getAttribute('data-state')).toBe('checked');
  });

  it('edits the display and value fields', () => {
    const { onUpdate } = renderRef();
    fireEvent.change(screen.getByRole('textbox', { name: 'Display Field' }), { target: { value: 'name' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Value Field' }), { target: { value: 'id' } });
    expect(onUpdate).toHaveBeenCalledWith({ referenceDisplayField: 'name' });
    expect(onUpdate).toHaveBeenCalledWith({ referenceValueField: 'id' });
  });
});
```

- [ ] **Step 2: Write the failing sheet tests**

Add to `apps/studio/src/forms-builder/FieldEditorSheet.test.tsx`, before its first `describe`:

```tsx
// Keep the real module and override one function: other editor parts import other api calls,
// and a factory that returned only this one would break them.
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listCodingSystems: vi.fn(async () => []),
}));
```

Add this `describe` inside `describe('FieldEditorSheet')`:

```tsx
  describe('block order', () => {
    const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

    it('puts Mapping above Codes', () => {
      renderSheet();
      expect(headings()).toEqual(['General', 'Mapping', 'Codes', 'Translations', 'Visibility']);
    });

    it('gives a reference field its own Reference Configuration block after General', () => {
      renderSheet({ field: { ...BASE_FIELD, fieldType: 'reference' } });
      expect(headings()).toEqual(['General', 'Reference Configuration', 'Mapping', 'Codes', 'Translations', 'Visibility']);
    });
  });

  it('hides the mapping controls on a survey form', () => {
    renderSheet({ fhirResourceType: 'Questionnaire' });
    expect(screen.queryByText('FHIR Path')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Observation Extract' })).toBeTruthy();
  });
```

- [ ] **Step 3: Run and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder/field-editor/ReferenceEditor.test.tsx src/forms-builder/FieldEditorSheet.test.tsx`
Expected: `ReferenceEditor.test.tsx` fails to resolve `./ReferenceEditor`. The block-order tests fail, because Mapping is still below Translations. The survey test fails, because the sheet does not pass `surveyMode`.

- [ ] **Step 4: Write `ReferenceEditor.tsx`**

Create `apps/studio/src/forms-builder/field-editor/ReferenceEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { REFERENCE_ENTITY_TARGETS, type FormField } from '@openldr/forms/pure';
import { listCodingSystems, type CodingSystem } from '../../api';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ReferenceEditorProps {
  field: FormField;
  allFields: FormField[];
  onUpdate: (patch: Partial<FormField>) => void;
}

/**
 * The Reference Configuration block, shown only on a `reference` field. Corlix's shape
 * (`FieldEditor.tsx:312-398`) with CE's targets.
 *
 * Corlix's target list names corlix's own entities. CE's reference search resolves `Patient` and
 * code-system URLs (`reference-source.ts`), and the seeded Lab order form targets
 * `http://loinc.org`. So the list is the searchable entities plus the active code systems that have
 * a URL. A stored value the list does not know is added as an option, so opening a field never
 * blanks its target.
 *
 * Depends On and Searchable are stored and exported. CE's data entry does not read them yet.
 */
export function ReferenceEditor({ field, allFields, onUpdate }: ReferenceEditorProps): JSX.Element {
  const [systems, setSystems] = useState<CodingSystem[]>([]);

  useEffect(() => {
    let alive = true;
    void listCodingSystems()
      .then((rows) => { if (alive) setSystems(rows); })
      .catch(() => { /* the code-system half is a convenience; entity targets still work */ });
    return () => { alive = false; };
  }, []);

  const codeSystems = systems
    .filter((s) => s.active && s.url)
    .map((s) => ({ value: s.url as string, label: `${s.systemCode} · ${s.url}` }));
  const current = field.referenceTarget ?? '';
  const known = new Set<string>([...REFERENCE_ENTITY_TARGETS, ...codeSystems.map((o) => o.value)]);
  const others = allFields.filter((f) => f.id !== field.id);

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4">
      <Label htmlFor="ref-target" className="whitespace-nowrap">Target</Label>
      <Select value={current} onValueChange={(v) => onUpdate({ referenceTarget: v })}>
        <SelectTrigger id="ref-target" aria-label="Target">
          <SelectValue placeholder="Select target..." />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {REFERENCE_ENTITY_TARGETS.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectGroup>
          {codeSystems.length > 0 && <SelectSeparator />}
          <SelectGroup>
            {codeSystems.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectGroup>
          {current && !known.has(current) && (
            <>
              <SelectSeparator />
              <SelectItem value={current}>{current}</SelectItem>
            </>
          )}
        </SelectContent>
      </Select>

      <Label htmlFor="ref-display-field" className="whitespace-nowrap">Display Field</Label>
      <Input
        id="ref-display-field"
        aria-label="Display Field"
        value={field.referenceDisplayField ?? ''}
        onChange={(e) => onUpdate({ referenceDisplayField: e.target.value || undefined })}
        placeholder="displayName"
      />

      <Label htmlFor="ref-value-field" className="whitespace-nowrap">Value Field</Label>
      <Input
        id="ref-value-field"
        aria-label="Value Field"
        value={field.referenceValueField ?? ''}
        onChange={(e) => onUpdate({ referenceValueField: e.target.value || undefined })}
        placeholder="id"
      />

      <Label htmlFor="ref-depends-on" className="whitespace-nowrap">Depends On</Label>
      <Select
        value={field.referenceDependsOn ?? '__none'}
        onValueChange={(v) => onUpdate({ referenceDependsOn: v === '__none' ? undefined : v })}
      >
        <SelectTrigger id="ref-depends-on" aria-label="Depends On">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">None</SelectItem>
          {others.map((f) => (
            <SelectItem key={f.id} value={f.id}>{`${f.displayLabel} (${f.id})`}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="col-span-2 flex items-center gap-6 pt-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="ref-multiple"
            aria-label="Multiple"
            checked={field.referenceMultiple ?? false}
            onCheckedChange={(checked) => onUpdate({ referenceMultiple: !!checked })}
          />
          <Label htmlFor="ref-multiple" className="text-xs">Multiple</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="ref-searchable"
            aria-label="Searchable"
            checked={field.referenceSearchable ?? true}
            onCheckedChange={(checked) => onUpdate({ referenceSearchable: !!checked })}
          />
          <Label htmlFor="ref-searchable" className="text-xs">Searchable</Label>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Take Reference out of Advanced**

In `apps/studio/src/forms-builder/field-editor/MappingEditor.tsx`, delete the block from `{/* ── Reference config ─────────────────────────────── */}` through the closing `</div>` of the Multiple and Searchable row (lines 232-297). Constraints, Repetition and Notes stay.

In `apps/studio/src/forms-builder/field-editor/MappingEditor.test.tsx`, delete `describe('referenceTarget input', …)` (lines 173-189). `ReferenceEditor.test.tsx` covers those controls now.

- [ ] **Step 6: Reorder the sheet's blocks and add the Reference block**

In `apps/studio/src/forms-builder/FieldEditorSheet.tsx`:

Add the import:

```tsx
import { ReferenceEditor } from './field-editor/ReferenceEditor';
```

and add `isSurveyForm` to the `@openldr/forms/pure` import.

After the General `</section>`, the body must read, in order: Reference Configuration (only for `reference`), Options (unchanged), Mapping, Codes, Translations, Visibility. Insert this before the Options block:

```tsx
        {/* ── Reference Configuration (reference fields only) ────── */}
        {activeDraft.fieldType === 'reference' && (
          <>
            <div className="border-t border-border" />
            <div className="px-6 py-3">
              <h3 className="text-sm font-medium text-foreground">Reference Configuration</h3>
            </div>
            <div className="border-t border-border" />
            <div className="px-6 py-2">
              <ReferenceEditor field={activeDraft} allFields={allFields} onUpdate={patchDraft} />
            </div>
          </>
        )}
```

Move the whole Mapping block (its divider, heading and `MappingEditor`) from after Translations to directly after Options, and pass `surveyMode`:

```tsx
          <MappingEditor
            field={activeDraft}
            fhirResourceType={fhirResourceType}
            surveyMode={isSurveyForm(fhirResourceType)}
            onUpdate={patchDraft}
          />
```

- [ ] **Step 7: Run and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder`
Expected: PASS for every file in `forms-builder`.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/forms-builder/field-editor/ReferenceEditor.tsx \
  apps/studio/src/forms-builder/field-editor/ReferenceEditor.test.tsx \
  apps/studio/src/forms-builder/field-editor/MappingEditor.tsx \
  apps/studio/src/forms-builder/field-editor/MappingEditor.test.tsx \
  apps/studio/src/forms-builder/FieldEditorSheet.tsx apps/studio/src/forms-builder/FieldEditorSheet.test.tsx
git commit -m "feat(studio): a Reference Configuration block, and Mapping above Codes"
```

---

### Task 5: Add a slot, add a part

**Files:**
- Create: `apps/studio/src/forms-builder/newFormFields.ts`, `newFormFields.test.ts`
- Modify: `apps/studio/src/forms-builder/RepeatRow.tsx`
- Modify: `apps/studio/src/forms-builder/FieldListPane.tsx`
- Modify: `apps/studio/src/forms-builder/FieldEditorSheet.tsx`
- Modify: `apps/studio/src/forms-builder/FormBuilderPage.tsx`
- Test: `FieldListPane.test.tsx`, `FieldEditorSheet.test.tsx`

**Interfaces:**
- Consumes: `RepeatNode` from S1's `fieldTree.ts`. `normalizeDiscriminator`, `toStoredDiscriminator` and `childrenOf` from `@openldr/forms/pure`. `makeUniqueFieldId` and `slugify` from `builderModel.ts`.
- Produces:
  - `buildNamedSlot(node: RepeatNode, id: string, label: string): FormField`
  - `buildGroupPart(group: FormField, id: string, label: string): FormField`
  - `insertFieldAfter(fields: readonly FormField[], anchorId: string, field: FormField): FormField[]`, which renumbers `order`
  - `lastPartIdOf(fields: readonly FormField[], groupId: string): string`
  - `AddNamedSlotRow({ onAdd })`
  - `FieldListPaneProps.onAddSlot?: (node: RepeatNode) => void`
  - `FieldEditorSheetProps.onOpenField?: (id: string, draft: FormField) => void` and `onAddPart?: (draft: FormField) => void`

- [ ] **Step 1: Write the failing builder tests**

Create `apps/studio/src/forms-builder/newFormFields.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FormField } from '@openldr/forms/pure';
import type { RepeatNode } from './fieldTree';
import { buildGroupPart, buildNamedSlot, insertFieldAfter, lastPartIdOf } from './newFormFields';

const f = (o: Partial<FormField> & Pick<FormField, 'id' | 'order'>): FormField => ({
  displayLabel: o.id, fieldType: 'text', required: false, enabled: true, fhirPath: null,
  cardinality: { min: 0, max: '1' }, description: null, ...o,
});

const mfl = f({
  id: 'mfl', order: 1, fieldType: 'identifier', section: 's', fhirPath: 'Location.identifier.value',
  fhirValueField: 'value', fhirDiscriminator: { system: 'urn:mfl' }, apiProperty: 'mflId',
  code: [{ system: 'http://loinc.org', code: 'x' }], translations: { fr: { label: 'MFL' } },
});
const node: RepeatNode = { kind: 'repeat', path: 'Location.identifier', label: 'identifier', slots: [f({ id: 'local', order: 0 }), mfl] };

describe('buildNamedSlot', () => {
  it('copies the last slot shape with the discriminator values blank', () => {
    const slot = buildNamedSlot(node, 'new-slot', 'New slot');
    expect(slot).toMatchObject({
      id: 'new-slot', displayLabel: 'New slot', fieldType: 'identifier', section: 's',
      fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system: '' },
    });
  });

  it('leaves the API property, codes and translations behind', () => {
    const slot = buildNamedSlot(node, 'new-slot', 'New slot');
    expect(slot.apiProperty).toBeUndefined();
    expect(slot.code).toBeUndefined();
    expect(slot.translations).toBeUndefined();
  });

  it('keeps an Any join and each element once', () => {
    const anyNode: RepeatNode = { ...node, slots: [f({ id: 'a', order: 0, fhirPath: 'Location.telecom.value', fhirValueField: 'value',
      fhirDiscriminator: { join: 'any', conds: [{ el: 'system', op: 'equals', val: 'a' }, { el: 'system', op: 'equals', val: 'b' }] } })] };
    expect(buildNamedSlot(anyNode, 's', 'S').fhirDiscriminator).toEqual({ join: 'any', conds: [{ el: 'system', op: 'equals', val: '' }] });
  });
});

describe('buildGroupPart', () => {
  it('parents a blank text field on the group, with no path and no section', () => {
    const group = f({ id: 'addr', order: 3, fieldType: 'group', section: 's', fhirPath: 'Location.address' });
    expect(buildGroupPart(group, 'new-part', 'New part')).toEqual({
      id: 'new-part', displayLabel: 'New part', description: null, fieldType: 'text', required: false,
      enabled: true, order: 3, cardinality: { min: 0, max: '1' }, groupId: 'addr', fhirPath: null,
    });
  });
});

describe('insertFieldAfter and lastPartIdOf', () => {
  it('inserts after the anchor and renumbers order', () => {
    const out = insertFieldAfter([f({ id: 'a', order: 0 }), f({ id: 'b', order: 1 })], 'a', f({ id: 'x', order: 99 }));
    expect(out.map((x) => [x.id, x.order])).toEqual([['a', 0], ['x', 1], ['b', 2]]);
  });

  it('names the last part, or the group itself while it has none', () => {
    const fields = [f({ id: 'g', order: 0, fieldType: 'group' }), f({ id: 'p1', order: 1, groupId: 'g' }), f({ id: 'p2', order: 2, groupId: 'g' })];
    expect(lastPartIdOf(fields, 'g')).toBe('p2');
    expect(lastPartIdOf([fields[0]], 'g')).toBe('g');
  });
});
```

- [ ] **Step 2: Write the failing list and sheet tests**

Add to `FieldListPane.test.tsx`, inside `describe('FieldListPane')`, after the S1 repeat tests (the `base` helper already exists there):

```tsx
  it('offers "+ Add a named slot" under a repeat and passes the node', () => {
    const onAddSlot = vi.fn();
    renderPane({
      sections: [],
      onAddSlot,
      fields: [
        base({ id: 'local', displayLabel: 'Local ID', order: 0, fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system: 'a' } }),
        base({ id: 'mfl', displayLabel: 'MFL ID', order: 1, fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system: 'b' } }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add a named slot' }));
    expect(onAddSlot).toHaveBeenCalledWith(expect.objectContaining({ kind: 'repeat', path: 'Location.identifier' }));
  });
```

Add to `FieldEditorSheet.test.tsx`, inside `describe('FieldEditorSheet')`:

```tsx
  describe('Parts block', () => {
    const PART: FormField = { ...BASE_FIELD, id: 'p-1', displayLabel: 'City', groupId: 'g-1', fhirPath: 'Location.address.city', order: 2 };

    it('lists a group parts', () => {
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD, PART] });
      expect(screen.getByRole('button', { name: /City/ })).toBeTruthy();
    });

    it('says when a group has no parts', () => {
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD] });
      expect(screen.getByText('No parts yet.')).toBeTruthy();
    });

    it('opens a part and hands over the group draft, unsaved edits included', () => {
      const onOpenField = vi.fn();
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD, PART], onOpenField });
      fireEvent.change(screen.getByRole('textbox', { name: 'Display Label' }), { target: { value: 'Address block' } });
      fireEvent.click(screen.getByRole('button', { name: /City/ }));
      expect(onOpenField).toHaveBeenCalledWith('p-1', expect.objectContaining({ id: 'g-1', displayLabel: 'Address block' }));
    });

    it('adds a part with the group draft', () => {
      const onAddPart = vi.fn();
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD], onAddPart });
      fireEvent.click(screen.getByRole('button', { name: '+ Add a part' }));
      expect(onAddPart).toHaveBeenCalledWith(expect.objectContaining({ id: 'g-1' }));
    });

    it('sits after Mapping', () => {
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD] });
      const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
      expect(headings.indexOf('Parts')).toBe(headings.indexOf('Mapping') + 1);
    });
  });
```

- [ ] **Step 3: Run and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder/newFormFields.test.ts src/forms-builder/FieldListPane.test.tsx src/forms-builder/FieldEditorSheet.test.tsx`
Expected: `newFormFields.test.ts` fails to resolve. The slot button and Parts block tests FAIL.

- [ ] **Step 4: Write `newFormFields.ts`**

Create `apps/studio/src/forms-builder/newFormFields.ts`:

```ts
import { normalizeDiscriminator, toStoredDiscriminator, type FormField } from '@openldr/forms/pure';
import type { RepeatNode } from './fieldTree';

/**
 * Builders for a field made from the structure it belongs to. Pure. Ported from corlix
 * `apps/desktop/src/renderer/lib/newFormFields.ts`.
 */

/**
 * Another slot of one repeating list, shaped like the slot above it: same path, value field, type
 * and discriminator elements, with the values blank. The API property, codes, ValueSet binding and
 * translations belong to the slot already written, so they stay behind. Two blank slots correctly
 * trip the duplicate-path lint: with the same blank values they really are the same slot.
 */
export function buildNamedSlot(node: RepeatNode, id: string, label: string): FormField {
  const template = node.slots[node.slots.length - 1];
  const rule = normalizeDiscriminator(template.fhirDiscriminator);
  const seen = new Set<string>();
  const conds = (rule?.conds ?? [])
    .filter((c) => (seen.has(c.el) ? false : (seen.add(c.el), true)))
    .map((c) => ({ el: c.el, op: 'equals' as const, val: '' }));
  return {
    id,
    displayLabel: label,
    description: null,
    fieldType: template.fieldType,
    required: false,
    enabled: true,
    order: template.order,
    cardinality: { min: 0, max: '1' },
    section: template.section,
    fhirPath: template.fhirPath,
    fhirValueField: template.fhirValueField,
    fhirDiscriminator: toStoredDiscriminator({
      join: rule?.join ?? 'all',
      // An empty template seeds one blank row, as the editor's own "+ Add condition" does.
      conds: conds.length > 0 ? conds : [{ el: '', op: 'equals', val: '' }],
    }),
  };
}

/**
 * A new part of a group. The FHIR path is left empty on purpose: guessing a child element name
 * would ship a mapping that looks valid and points at nothing. No section: a part sits wherever
 * its group sits.
 */
export function buildGroupPart(group: FormField, id: string, label: string): FormField {
  return {
    id,
    displayLabel: label,
    description: null,
    fieldType: 'text',
    required: false,
    enabled: true,
    order: group.order,
    cardinality: { min: 0, max: '1' },
    groupId: group.id,
    fhirPath: null,
  };
}

/** Insert `field` after `anchorId` in form order, then renumber `order` from 0. */
export function insertFieldAfter(fields: readonly FormField[], anchorId: string, field: FormField): FormField[] {
  const ordered = [...fields].sort((a, b) => a.order - b.order);
  const at = ordered.findIndex((f) => f.id === anchorId);
  const inserted = at === -1 ? [...ordered, field] : [...ordered.slice(0, at + 1), field, ...ordered.slice(at + 1)];
  return inserted.map((f, index) => ({ ...f, order: index }));
}

/** The id a new part goes after: the group's last child, or the group itself while it has none. */
export function lastPartIdOf(fields: readonly FormField[], groupId: string): string {
  const parts = fields.filter((f) => f.groupId === groupId).sort((a, b) => a.order - b.order);
  return parts.length > 0 ? parts[parts.length - 1].id : groupId;
}
```

- [ ] **Step 5: The slot button**

In `apps/studio/src/forms-builder/RepeatRow.tsx`, add the import `import { Button } from '@/components/ui/button';` and append:

```tsx
/**
 * The footer of a repeating list: one click makes another named slot. It belongs to one list, so
 * it sits under that list's slots rather than in a page menu, as in corlix `RepeatRow.tsx`.
 */
export function AddNamedSlotRow({ onAdd }: { onAdd: () => void }): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onAdd}
      className="h-auto w-full justify-start rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-normal text-muted-foreground hover:border-primary hover:bg-transparent hover:text-primary"
    >
      + Add a named slot
    </Button>
  );
}
```

In `apps/studio/src/forms-builder/FieldListPane.tsx`:
- Import `AddNamedSlotRow` from `./RepeatRow` and `type RepeatNode` from `./fieldTree`.
- Add to `FieldListPaneProps`: `onAddSlot?: (node: RepeatNode) => void;` and destructure it.
- In `renderNode`'s repeat branch, after `{node.slots.map((slot) => renderField(slot))}`, add:

```tsx
          {onAddSlot && <AddNamedSlotRow onAdd={() => onAddSlot(node)} />}
```

- [ ] **Step 6: The Parts block**

In `apps/studio/src/forms-builder/FieldEditorSheet.tsx`:
- Add `childrenOf` to the `@openldr/forms/pure` import.
- Add to `FieldEditorSheetProps`:

```tsx
  /** Open another field. The page saves this sheet's draft first, as corlix does. */
  onOpenField?: (id: string, draft: FormField) => void;
  /** Add a part to this group. The page saves the draft first, then opens the new part. */
  onAddPart?: (draft: FormField) => void;
```

- Destructure both. After the Mapping block, insert:

```tsx
        {/* ── Parts (groups only). After Mapping: both answer "what does this node hold". ── */}
        {activeDraft.fieldType === 'group' && (
          <>
            <div className="border-t border-border" />
            <div className="flex items-baseline gap-2 px-6 py-3">
              <h3 className="text-sm font-medium text-foreground">Parts</h3>
              <span className="text-[11px] text-muted-foreground">click one to edit it</span>
            </div>
            <div className="border-t border-border" />
            <div className="space-y-1 px-6 py-4">
              {childrenOf(allFields, activeDraft.id).length === 0 ? (
                <p className="pb-1 text-xs text-muted-foreground">No parts yet.</p>
              ) : (
                childrenOf(allFields, activeDraft.id).map((part) => (
                  <Button
                    key={part.id}
                    type="button"
                    variant="outline"
                    onClick={() => draft && onOpenField?.(part.id, draft)}
                    className="flex h-auto w-full items-center justify-start gap-2 px-2 py-1.5 text-left font-normal hover:border-primary"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-foreground">
                        {part.displayLabel}
                        {part.required && <span className="text-destructive">*</span>}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {part.fhirPath ?? 'no FHIR path yet'}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 rounded-full border border-border px-2 text-[10px] text-muted-foreground">
                      {part.fieldType}
                    </span>
                  </Button>
                ))
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => draft && onAddPart?.(draft)}
                className="h-7 w-full border-dashed text-[11px] font-normal text-primary"
              >
                + Add a part
              </Button>
            </div>
          </>
        )}
```

- [ ] **Step 7: The page handlers**

In `apps/studio/src/forms-builder/FormBuilderPage.tsx`:
- Change the builderModel import to `import { createDefaultFormSchema, makeUniqueFieldId, newField, slugify } from './builderModel';`.
- Add `import { buildGroupPart, buildNamedSlot, insertFieldAfter, lastPartIdOf } from './newFormFields';` and `import type { RepeatNode } from './fieldTree';`.
- Add after `reorderFields`:

```tsx
  /** A fresh id for a field made from the structure, unique on the form. */
  const freshId = (label: string) => makeUniqueFieldId(slugify(label), new Set(schema.fields.map((f) => f.id)));

  /** Another slot of a repeating list. One undo step; the new slot opens. It stays on Cancel, as in corlix. */
  const addNamedSlot = (node: RepeatNode) => {
    history.pushHistory();
    const slot = buildNamedSlot(node, freshId('New slot'), 'New slot');
    const anchor = node.slots[node.slots.length - 1].id;
    setSchema((prev) => ({ ...prev, fields: insertFieldAfter(prev.fields, anchor, slot) }));
    setPendingNewFieldId(null);
    setSelectedId(slot.id);
  };

  /** Save the open field's edits, then open another. Corlix `FormBuilderPage.tsx:577-585`. */
  const openField = (id: string, draft: FormField) => {
    history.recordEdit();
    setSchema((prev) => ({ ...prev, fields: prev.fields.map((f) => (f.id === draft.id ? draft : f)) }));
    setPendingNewFieldId(null);
    setSelectedId(id);
  };

  /** Save the group's edits, add a part after its last part, and open the part. One undo step. */
  const addGroupPart = (draft: FormField) => {
    history.pushHistory();
    const part = buildGroupPart(draft, freshId('New part'), 'New part');
    setSchema((prev) => {
      const committed = prev.fields.map((f) => (f.id === draft.id ? draft : f));
      return { ...prev, fields: insertFieldAfter(committed, lastPartIdOf(committed, draft.id), part) };
    });
    setPendingNewFieldId(null);
    setSelectedId(part.id);
  };
```

- Pass `onAddSlot={addNamedSlot}` to `<FieldListPane>`, and `onOpenField={openField}` and `onAddPart={addGroupPart}` to `<FieldEditorSheet>`.

- [ ] **Step 8: Run and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder`
Expected: PASS for every file in `forms-builder`.

- [ ] **Step 9: Typecheck the studio**

Run: `pnpm --filter @openldr/studio typecheck > /tmp/s2-t5-tc.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 10: Commit**

```bash
git add apps/studio/src/forms-builder/newFormFields.ts apps/studio/src/forms-builder/newFormFields.test.ts \
  apps/studio/src/forms-builder/RepeatRow.tsx apps/studio/src/forms-builder/FieldListPane.tsx \
  apps/studio/src/forms-builder/FieldListPane.test.tsx apps/studio/src/forms-builder/FieldEditorSheet.tsx \
  apps/studio/src/forms-builder/FieldEditorSheet.test.tsx apps/studio/src/forms-builder/FormBuilderPage.tsx
git commit -m "feat(studio): add a named slot or a group part from the structure"
```

---

### Task 6: Locked fields

**Files:**
- Modify: `apps/studio/src/forms-builder/SortableFieldRow.tsx`
- Modify: `apps/studio/src/forms-builder/FormBuilderPage.tsx:128-132`
- Test: `apps/studio/src/forms-builder/SortableFieldRow.test.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests**

Add to `describe('SortableFieldRow')` in `SortableFieldRow.test.tsx`:

```tsx
  it('disables the Enabled box on a locked field', () => {
    renderRow({ field: { ...FIELD, locked: true } });
    expect((screen.getByLabelText(`Toggle enabled for ${FIELD.displayLabel}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers no Delete on a locked field', () => {
    renderRow({ field: { ...FIELD, locked: true } });
    const trigger = screen.getByLabelText(`Actions for ${FIELD.displayLabel}`);
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Duplicate')) fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByText('Duplicate')).toBeTruthy();
    expect(screen.queryByText('Delete')).toBeNull();
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder/SortableFieldRow.test.tsx`
Expected: both new tests FAIL.

- [ ] **Step 3: Implement**

In `SortableFieldRow.tsx`, add `disabled={field.locked}` to the Enabled `Checkbox`, and wrap the `DropdownMenuSeparator` and the Delete `DropdownMenuItem` in `{!field.locked && (<> … </>)}`.

In `FormBuilderPage.tsx`, make `deleteField` refuse a locked field, so the `d` shortcut skips it too:

```tsx
  const deleteField = (fieldId: string) => {
    // Locked marks a field the form cannot work without. Corlix `FormBuilderPage.tsx:606`.
    if (schema.fields.find((f) => f.id === fieldId)?.locked) return;
    history.pushHistory();
    setSchema((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== fieldId) }));
    if (selectedId === fieldId) setSelectedId(null);
  };
```

- [ ] **Step 4: Run and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/forms-builder/SortableFieldRow.tsx apps/studio/src/forms-builder/SortableFieldRow.test.tsx \
  apps/studio/src/forms-builder/FormBuilderPage.tsx
git commit -m "feat(studio): a locked field cannot be switched off or deleted"
```

---

### Task 7: Docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/forms.md`, `fr/forms.md`, `pt/forms.md`
- Modify: `apps/web/src/docs/0.1.8/forms.md`

- [ ] **Step 1: English in-app doc, new section**

In `apps/studio/src/docs/0.1.8/en/forms.md`, insert after the `## How the field list shows structure` section, before `## Expected result`:

```md
## Editing a field

- **Which entry of a list.** Under Mapping, tick **Array element (discriminator)**. Each condition is an element, an operator, and a value, such as `system` `equals` `urn:x`. The operators are `equals`, `not equals`, and `starts with`. With two or more conditions, choose **All** when every condition must hold, or **Any** when one is enough. **Value Field** names the element that holds the answer, usually `value`.
- A discriminator is used by the form checks and the Questionnaire export. Data entry does not use it yet.
- **Another slot.** Under the last slot of a list, **+ Add a named slot** adds a copy with the same path, value field, and type, and blank discriminator values. The API property, codes, and translations are left blank.
- **Parts of a group.** A group's editor lists its parts after Mapping. Click one to edit it. Your unsaved changes to the group are saved first. **+ Add a part** adds a field inside the group with no FHIR path.
- **Reference fields.** A reference field has a **Reference Configuration** block after General. **Target** is `Patient` or an active code system. **Depends On** and **Searchable** are saved and exported, but data entry does not use them yet.
- **Locked fields.** A locked field cannot be switched off or deleted from the field list. You can still relabel, reorder, and translate it.
- **Survey forms.** When the form's Resource Type is `Questionnaire`, the editor hides FHIR Path, API Property, and the discriminator. Observation Extract and the other settings stay.
```

- [ ] **Step 2: English example steps**

In the same file, replace steps 3 and 4 of the lab request example:

```md
3. Add an enabled, required reference field labeled Patient. In **Reference Configuration**, set Target to Patient. Under Mapping, set FHIR Path to ServiceRequest.subject.
4. Add an enabled, required reference field labeled Tests. In **Reference Configuration**, set Target to the installed LOINC system, http://loinc.org. Set FHIR Path to ServiceRequest.code. Choose codes through the terminology picker; do not enter a made-up code.
```

- [ ] **Step 3: French in-app doc**

In `apps/studio/src/docs/0.1.8/fr/forms.md`, insert after `## Structure de la liste des champs`, before `## Exemple : soumettre une demande de laboratoire`:

```md
## Modifier un champ

- **L'entrée d'une liste.** Sous Mapping, cochez **Array element (discriminator)**. Chaque condition est un élément, un opérateur et une valeur, par exemple `system` `equals` `urn:x`. Les opérateurs sont `equals`, `not equals` et `starts with`. À partir de deux conditions, choisissez **All** si toutes doivent être vraies, ou **Any** si une seule suffit. **Value Field** désigne l'élément qui porte la réponse, en général `value`.
- Le discriminateur sert aux contrôles du formulaire et à l'export Questionnaire. La saisie ne l'utilise pas encore.
- **Un autre emplacement.** Sous le dernier emplacement d'une liste, **+ Add a named slot** ajoute une copie avec le même chemin, le même champ de valeur et le même type, et des valeurs de discriminateur vides. La propriété API, les codes et les traductions restent vides.
- **Parties d'un groupe.** L'éditeur d'un groupe liste ses parties après Mapping. Cliquez sur une partie pour la modifier. Vos modifications non enregistrées du groupe sont d'abord enregistrées. **+ Add a part** ajoute un champ dans le groupe, sans chemin FHIR.
- **Champs reference.** Un champ reference a un bloc **Reference Configuration** après General. **Target** vaut `Patient` ou un système de codes actif. **Depends On** et **Searchable** sont enregistrés et exportés, mais la saisie ne les utilise pas encore.
- **Champs verrouillés.** Un champ verrouillé ne peut être ni désactivé ni supprimé depuis la liste. Vous pouvez encore le renommer, le déplacer et le traduire.
- **Formulaires d'enquête.** Si le Resource Type du formulaire est `Questionnaire`, l'éditeur masque FHIR Path, API Property et le discriminateur. Observation Extract et les autres réglages restent.
```

Replace steps 3 and 4 of its example:

```md
3. Ajoutez un champ reference actif et obligatoire, nommé Patient. Dans **Reference Configuration**, définissez Target sur Patient. Sous Mapping, définissez FHIR Path sur ServiceRequest.subject.
4. Ajoutez un champ reference actif et obligatoire, nommé Tests. Dans **Reference Configuration**, définissez Target sur le système LOINC installé, http://loinc.org, et FHIR Path sur ServiceRequest.code. Sélectionnez les codes dans la terminologie, sans inventer de code.
```

- [ ] **Step 4: Portuguese in-app doc**

In `apps/studio/src/docs/0.1.8/pt/forms.md`, insert after `## Estrutura da lista de campos`, before `## Exemplo: enviar um pedido de laboratório`:

```md
## Editar um campo

- **Qual entrada de uma lista.** Em Mapping, marque **Array element (discriminator)**. Cada condição é um elemento, um operador e um valor, por exemplo `system` `equals` `urn:x`. Os operadores são `equals`, `not equals` e `starts with`. Com duas ou mais condições, escolha **All** quando todas têm de se cumprir, ou **Any** quando basta uma. **Value Field** indica o elemento que guarda a resposta, normalmente `value`.
- O discriminador é usado pelas verificações do formulário e pela exportação Questionnaire. A introdução de dados ainda não o usa.
- **Outra posição.** Sob a última posição de uma lista, **+ Add a named slot** acrescenta uma cópia com o mesmo caminho, o mesmo campo de valor e o mesmo tipo, e valores de discriminador em branco. A propriedade API, os códigos e as traduções ficam em branco.
- **Partes de um grupo.** O editor de um grupo lista as suas partes depois de Mapping. Clique numa parte para a editar. As alterações do grupo ainda não guardadas são guardadas primeiro. **+ Add a part** acrescenta um campo dentro do grupo, sem caminho FHIR.
- **Campos reference.** Um campo reference tem um bloco **Reference Configuration** depois de General. **Target** é `Patient` ou um sistema de códigos ativo. **Depends On** e **Searchable** são guardados e exportados, mas a introdução de dados ainda não os usa.
- **Campos bloqueados.** Um campo bloqueado não pode ser desativado nem eliminado a partir da lista. Pode ainda mudar o rótulo, a ordem e a tradução.
- **Formulários de inquérito.** Quando o Resource Type do formulário é `Questionnaire`, o editor esconde FHIR Path, API Property e o discriminador. Observation Extract e as outras definições mantêm-se.
```

Replace steps 3 and 4 of its example:

```md
3. Adicione um campo reference ativo e obrigatório, com o rótulo Patient. Em **Reference Configuration**, defina Target como Patient. Em Mapping, defina FHIR Path como ServiceRequest.subject.
4. Adicione um campo reference ativo e obrigatório, com o rótulo Tests. Em **Reference Configuration**, defina Target como o sistema LOINC instalado, http://loinc.org, e FHIR Path como ServiceRequest.code. Selecione códigos na terminologia, sem inventar códigos.
```

- [ ] **Step 5: Web doc, all three languages**

In `apps/web/src/docs/0.1.8/forms.md`:
- In each language block, replace steps 3 and 4 of the example with the text from Steps 2, 3 and 4 above.
- After each language's S1 section (`### How the field list shows structure`, `### Structure de la liste des champs`, `### Estrutura da lista de campos`), add the matching section from Steps 1, 3 and 4 with `###` in place of `##`.

- [ ] **Step 6: Run the docs tests**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs` then `pnpm --filter @openldr/web exec vitest run`
Expected: PASS for both.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/docs/0.1.8 apps/web/src/docs/0.1.8/forms.md
git commit -m "docs(forms): describe editing a field, and the Reference Configuration block"
```

---

### Task 8: Verify, merge, changelog

- [ ] **Step 1: Full test gate**

Run: `pnpm turbo run test --force > /tmp/s2-test.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. On failure, `grep -n "Test timed out" /tmp/s2-test.txt` first, and re-run that package alone.

- [ ] **Step 2: Full typecheck gate**

Run: `pnpm turbo run typecheck --force > /tmp/s2-tc.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 3: Check it in the browser, desktop**

Start `api` and `studio` with `preview_start`. The operator signs in; never type credentials. Build a throwaway `Location` form through `createForm`, as S1 did, with a full schema envelope: `id`, `version`, `status`, `active`, `createdAt`, `updatedAt`, `versionLabel`, `facilityId`, `fhirProfileUrl`. Give it two identifier slots, an address group with one part, a reference field, and a locked field. Open `/studio/forms/<id>/builder` and check:

- A slot's editor: the discriminator box shows its condition. Change the value and save: the row line updates. Add a second condition: All and Any appear. Choose Any: the row reads `… or …`.
- "+ Add a named slot" under the list adds `New slot` with `system = ` blank and opens it. Cancel keeps it. Undo removes it.
- The address group's editor: Parts lists the part after Mapping. Change the group label, then click the part. The part opens, and the list shows the new group label.
- "+ Add a part" adds `New part` inside the group and opens it.
- The reference field: Reference Configuration sits after General. Target lists Patient and the active code systems. The seeded Lab order form's Tests field still shows `http://loinc.org`.
- The locked field: its Enabled box is disabled, its `⋯` menu has no Delete, and `d` does nothing.
- Switch the resource type to `Questionnaire`: FHIR Path, API Property and the discriminator disappear, and Observation Extract stays.
- Block order on a plain field: General, Mapping, Codes, Translations, Visibility.

- [ ] **Step 4: Check it at 375x812**

`resize_window` preset `mobile`, reload. Open the slot editor: the condition row wraps instead of overflowing, and the page does not scroll sideways. Open the Reference block: the Target dropdown fits. Reset with preset `desktop`. Nothing in S2 is anchored to the bottom edge.

Delete the throwaway form. Stop both servers before the gates on `main`.

- [ ] **Step 5: Merge, re-run both gates on main, changelog**

```bash
git switch main
git merge --no-ff feat/form-builder-s2 -m "Merge branch 'feat/form-builder-s2'"
pnpm turbo run test --force > /tmp/s2-main-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s2-main-tc.txt 2>&1; echo "exit=$?"
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog after form builder S2 merge"
git branch -d feat/form-builder-s2
```

Both gates must print `exit=0` before the changelog commit. Do not push.

- [ ] **Step 6: Report**

The commits, both gate results with command and exit code, screenshots, anything that failed and was stopped, and a plain statement that nothing in S2 is bottom-anchored.

---

## Notes for later slices, found while writing this plan

- **Data-entry step.** Corlix's `matchesDiscriminator` and `discriminatorSeed` (`lib/discriminator.ts`) are what saving through the discriminator needs. `referenceDependsOn` and `referenceSearchable` need a data-entry reader before their controls do anything.
- **S3.** Port `mapsToResource` into `survey-mode.ts` for the Library.
- **S4.** Bulk Toggle enabled and Delete must skip locked fields (corlix `FormBuilderPage.tsx:632,644`).
- **Side list.** Corlix's editor leaves a locked field's own Enabled checkbox live, while its row disables it. CE copies that. It may be a corlix gap, not a design choice.
