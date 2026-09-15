# Form builder S1: the field list draws the structure

**Status:** merged to `main` on 2026-09-14 as `5ea7d394`. The checkboxes below were not ticked while the work ran, so they do not show what was done. Git history does.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CE's form builder field list show discriminators, repeat nodes, nested groups and the repeat marker the way corlix does, and make the Questionnaire export say whether a group repeats.

**Architecture:** Pure logic goes in `packages/forms/src/`: `discriminator.ts`, `group-tree.ts` and `group-repeats.ts`. The studio and the exporter share it. The path table in `packages/fhir` gains an `ownArray` column, so `groupRepeats` can read an element's own maximum. The studio field list derives repeat nodes from the flat `fields` array in `forms-builder/fieldTree.ts`. Storage does not change.

**Tech Stack:** TypeScript, zod, vitest, React 18, Testing Library, dnd-kit, Radix via shadcn `components/ui`.

**Spec:** `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, section 5, S1. Rows A1, A4, A12, A16.

## Global Constraints

- Match corlix's shipped behavior. Add nothing beyond it. Corlix lives at `~/Projects/Repositories/corlix`.
- Storage does not change. No migration. The `fields` array keeps its flat shape.
- Data entry does not change. `FormRuntime.tsx` keeps drawing every group once.
- UI strings are plain English literals, like the rest of `forms-builder`. No i18n keys.
- shadcn components only for new UI. Never a native `<button>`, `<select>`, `<input>` or `<dialog>` in new code. Existing native buttons in `SortableFieldRow.tsx` stay as they are.
- Tooltips wrap themselves in their own `TooltipProvider`, as `facilities/MappingRowStatus.tsx` does. Radix tooltips do not open on touch, so every marker also carries an `aria-label`.
- Never pipe turbo through `tail`. Never read `$?` through a pipe.
- No `Co-Authored-By` trailers on commits (AGENTS.md §9).
- Work on branch `feat/form-builder-s1`. Merge to local `main` at the end. Do not push. Do not open a PR.

## Facts checked while writing this plan

- `build-table.ts:123` already computes the element's own array flag as `leaf.isArray`, then folds it into the path-wide `isArray`. So `ownArray` is `leaf.isArray`. The spec's section 10, item 1, is confirmed.
- `from-questionnaire.ts:106-110` recurses into nested groups and never reads `repeats` on a group. So exporting `repeats: false` round-trips cleanly.
- `response.ts:32-45` and `from-response.ts:34-40` recurse into group instances. The spec's section 10, item 2, is tested in Task 3.
- CE's seeded Facility form (`packages/forms/src/samples/forms.ts:52-56`) sets a discriminator but no `fhirValueField`. It gets the discriminator line and no repeat node. Corlix's rule gives the same result.
- `FieldListPane.test.tsx:235-279` asserts nesting through `data-nested="true"` on the child card's parent. Keep that attribute.
- `FieldEditorSheet.test.tsx:268-271` asserts the Group picker is hidden on a group. S1 changes that behavior, so Task 6 replaces this test.
- `FieldEditorSheet.tsx:55` already destructures `fhirResourceType`, so Task 6 can use it directly.

## File map

| File | Change |
|---|---|
| `packages/fhir/src/paths/build-table.ts` | add `ownArray` to `FhirPathRow` |
| `packages/fhir/src/paths/generate.ts` | emit the fifth tuple column |
| `packages/fhir/src/paths/index.ts` | decode `ownArray` into `FhirPathInfo` |
| `packages/fhir/src/paths/r4-paths.generated.ts` | regenerated |
| `packages/fhir/src/paths/build-table.test.ts`, `index.test.ts` | shape updates and new cases |
| `packages/forms/src/discriminator.ts` + test | new |
| `packages/forms/src/group-tree.ts` + test | new |
| `packages/forms/src/group-repeats.ts` + test | new |
| `packages/forms/src/pure.ts`, `index.ts` | export the three modules |
| `packages/forms/src/to-questionnaire.ts` | `repeats` from `groupRepeats` |
| `packages/forms/src/group-repeat.test.ts` | new cases, one title fixed |
| `apps/studio/src/forms-builder/SortableFieldRow.tsx` + test | discriminator line, repeat marker |
| `apps/studio/src/forms-builder/fieldTree.ts` + test | new |
| `apps/studio/src/forms-builder/RepeatRow.tsx` | new |
| `apps/studio/src/forms-builder/FieldListPane.tsx` + test | repeat nodes, nesting at any depth |
| `apps/studio/src/forms-builder/FormBuilderPage.tsx` | pass `fhirResourceType` to the list |
| `apps/studio/src/forms-builder/FieldEditorSheet.tsx` + test | picker on groups, eligible parents, single-instance note |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md` | new section |
| `apps/web/src/docs/0.1.8/forms.md` | new section in all three languages |
| `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md` | correct section 7, item 2 |

---

### Task 0: Branch

- [ ] **Step 1: Create the branch from local main**

```bash
git switch main
git switch -c feat/form-builder-s1
```

Expected: `Switched to a new branch 'feat/form-builder-s1'`.

---

### Task 1: The path table knows an element's own repeat

**Files:**
- Modify: `packages/fhir/src/paths/build-table.ts:4-20,124`
- Modify: `packages/fhir/src/paths/generate.ts:57-68`
- Modify: `packages/fhir/src/paths/index.ts:6-30`
- Regenerate: `packages/fhir/src/paths/r4-paths.generated.ts`
- Test: `packages/fhir/src/paths/build-table.test.ts`, `packages/fhir/src/paths/index.test.ts`

**Interfaces:**
- Produces: `FhirPathInfo.ownArray: boolean` from `@openldr/fhir/paths`. True when the last segment itself repeats. `Location.telecom` is true. `Location.address` is false. `Patient.contact.address` is false, though its `isArray` is true.

- [ ] **Step 1: Write the failing tests**

In `packages/fhir/src/paths/build-table.test.ts`, change the first test's expected object to include `ownArray: false`:

```ts
  it('emits a primitive leaf with the JSDoc first line as its label', () => {
    expect(at(build(), 'Widget.name')).toEqual({
      path: 'Widget.name',
      leafType: 'string',
      isArray: false,
      ownArray: false,
      label: 'Name of the widget',
    });
  });
```

Add this test after `marks a path as an array when ANY segment on the way is an array`:

```ts
  it('marks ownArray only when the last segment itself is an array', () => {
    expect(at(build(), 'Widget.identifier')).toMatchObject({ isArray: true, ownArray: true });
    expect(at(build(), 'Widget.identifier.value')).toMatchObject({ isArray: true, ownArray: false });
    expect(at(build(), 'Widget.period')).toMatchObject({ isArray: false, ownArray: false });
  });
```

In `packages/fhir/src/paths/index.test.ts`, change the first `lookupFhirPath` test's expected object:

```ts
    expect(lookupFhirPath('Location.address.district')).toEqual({
      path: 'Location.address.district',
      resourceType: 'Location',
      leafType: 'string',
      isArray: false,
      ownArray: false,
      label: 'District name (aka county)',
    });
```

Add this test inside the same `describe('lookupFhirPath')` block:

```ts
  it('tells an element that repeats apart from one reached through a repeating parent', () => {
    expect(lookupFhirPath('Location.telecom')).toMatchObject({ isArray: true, ownArray: true });
    expect(lookupFhirPath('Location.address')).toMatchObject({ isArray: false, ownArray: false });
    expect(lookupFhirPath('Patient.contact.address')).toMatchObject({ isArray: true, ownArray: false });
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @openldr/fhir exec vitest run src/paths`
Expected: FAIL. The two `toEqual` tests report a missing `ownArray`, and the new tests report `ownArray: undefined`.

- [ ] **Step 3: Add `ownArray` to the row builder**

In `packages/fhir/src/paths/build-table.ts`, add this member to `FhirPathRow` after `isArray`:

```ts
  /**
   * True when the LAST segment itself is an array. `Location.telecom` is true. `Location.address`
   * is false, and so is `Patient.contact.address`, although `contact` repeats. Whether a group
   * holds one instance or many depends on this, not on `isArray`.
   */
  ownArray: boolean;
```

Change the push at line 124 to:

```ts
      rows.push({ path, leafType: leaf.type, isArray, ownArray: leaf.isArray, label: firstDocLine(member) });
```

- [ ] **Step 4: Emit the fifth column**

In `packages/fhir/src/paths/generate.ts`, change the row line inside `renderTable`:

```ts
  const lines = rows.map(
    (r) => `  [${quote(r.path)}, ${quote(r.leafType)}, ${r.isArray ? 1 : 0}, ${r.ownArray ? 1 : 0}, ${quote(r.label)}],`,
  );
```

Change the two type lines in the template:

```ts
/** [path, leafType, isArray, ownArray, label]. isArray is 1 when ANY segment on the path is an array. ownArray is 1 when the last segment is. */
export type R4PathTuple = readonly [path: string, leafType: string, isArray: 0 | 1, ownArray: 0 | 1, label: string];
```

- [ ] **Step 5: Decode it**

In `packages/fhir/src/paths/index.ts`, add to `FhirPathInfo` after `isArray`:

```ts
  /**
   * True when the last segment itself repeats. `Patient.contact.address` has `isArray` true,
   * because `contact` repeats, and `ownArray` false, because each contact has one address.
   */
  ownArray: boolean;
```

Replace `decode`:

```ts
function decode(tuple: R4PathTuple): FhirPathInfo {
  const [path, leafType, isArray, ownArray, label] = tuple;
  return {
    path,
    resourceType: path.slice(0, path.indexOf('.')),
    leafType,
    isArray: isArray === 1,
    ownArray: ownArray === 1,
    label,
  };
}
```

- [ ] **Step 6: Regenerate the table**

Run from the repo root: `pnpm gen:fhir-paths`
Expected: `wrote <N> paths to .../r4-paths.generated.ts`. N matches the row count before, 1596. Only the column is new.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `pnpm --filter @openldr/fhir exec vitest run src/paths`
Expected: PASS, including `is not stale`.

- [ ] **Step 8: Typecheck the package**

Run: `pnpm --filter @openldr/fhir typecheck > /tmp/s1-t1-tc.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 9: Commit**

```bash
git add packages/fhir/src/paths
git commit -m "feat(fhir): record whether a path's own element repeats"
```

---

### Task 2: Pure helpers for discriminators, the group tree and repetition

**Files:**
- Create: `packages/forms/src/discriminator.ts`, `packages/forms/src/discriminator.test.ts`
- Create: `packages/forms/src/group-tree.ts`, `packages/forms/src/group-tree.test.ts`
- Create: `packages/forms/src/group-repeats.ts`, `packages/forms/src/group-repeats.test.ts`
- Modify: `packages/forms/src/pure.ts`, `packages/forms/src/index.ts`

**Interfaces:**
- Consumes: `lookupFhirPath` and `FhirPathInfo.ownArray` from Task 1. `resolveFhirPath` from `packages/forms/src/fhir-path.ts:18`.
- Produces, all exported from `@openldr/forms/pure`:
  - `discriminatorLabel(disc: FormField['fhirDiscriminator']): string | null`
  - `childrenOf(fields: FormField[], groupId: string): FormField[]`
  - `descendantIds(fields: FormField[], groupId: string): Set<string>`
  - `groupDepth(fields: FormField[], fieldId: string): number`
  - `eligibleParents(fields: FormField[], fieldId: string): FormField[]`
  - `groupRepeats(field: FormField, fhirResourceType: string | null | undefined): boolean`

- [ ] **Step 1: Write the failing discriminator test**

Create `packages/forms/src/discriminator.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { discriminatorLabel } from './discriminator';

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
});
```

- [ ] **Step 2: Write the failing group tree test**

Create `packages/forms/src/group-tree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { childrenOf, descendantIds, eligibleParents, groupDepth } from './group-tree';
import { makeField } from './__fixtures__/forms';

const outer = makeField({ id: 'outer', displayLabel: 'Visit', fieldType: 'group', order: 0 });
const inner = makeField({ id: 'inner', displayLabel: 'Symptom', fieldType: 'group', order: 1, groupId: 'outer' });
const leafB = makeField({ id: 'leafB', displayLabel: 'Severity', fieldType: 'text', order: 3, groupId: 'inner' });
const leafA = makeField({ id: 'leafA', displayLabel: 'Duration', fieldType: 'text', order: 2, groupId: 'inner' });
const other = makeField({ id: 'other', displayLabel: 'Other group', fieldType: 'group', order: 4 });
const loose = makeField({ id: 'loose', displayLabel: 'Notes', fieldType: 'text', order: 5 });
const FIELDS = [outer, inner, leafB, leafA, other, loose];

describe('childrenOf', () => {
  it('returns direct children in form order', () => {
    expect(childrenOf(FIELDS, 'inner').map((f) => f.id)).toEqual(['leafA', 'leafB']);
  });
});

describe('descendantIds', () => {
  it('collects every id beneath a group, at any depth', () => {
    expect([...descendantIds(FIELDS, 'outer')].sort()).toEqual(['inner', 'leafA', 'leafB']);
  });

  it('stops on a cycle instead of hanging', () => {
    const a = makeField({ id: 'a', displayLabel: 'A', fieldType: 'group', order: 0, groupId: 'b' });
    const b = makeField({ id: 'b', displayLabel: 'B', fieldType: 'group', order: 1, groupId: 'a' });
    expect([...descendantIds([a, b], 'a')].sort()).toEqual(['a', 'b']);
  });
});

describe('groupDepth', () => {
  it('is 0 at the top level and counts ancestors below it', () => {
    expect(groupDepth(FIELDS, 'outer')).toBe(0);
    expect(groupDepth(FIELDS, 'inner')).toBe(1);
    expect(groupDepth(FIELDS, 'leafA')).toBe(2);
  });

  it('stops on a cycle instead of hanging', () => {
    const a = makeField({ id: 'a', displayLabel: 'A', fieldType: 'group', order: 0, groupId: 'b' });
    const b = makeField({ id: 'b', displayLabel: 'B', fieldType: 'group', order: 1, groupId: 'a' });
    expect(groupDepth([a, b], 'a')).toBe(1);
  });
});

describe('eligibleParents', () => {
  it('offers every group except the field itself and its descendants', () => {
    expect(eligibleParents(FIELDS, 'outer').map((f) => f.id)).toEqual(['other']);
  });

  it('offers only groups', () => {
    expect(eligibleParents(FIELDS, 'loose').map((f) => f.id)).toEqual(['outer', 'inner', 'other']);
  });
});
```

- [ ] **Step 3: Write the failing group repeats test**

Create `packages/forms/src/group-repeats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FormField } from './schema/form-schema';
import { groupRepeats } from './group-repeats';
import { makeField } from './__fixtures__/forms';

const group = (overrides: Partial<FormField> = {}): FormField =>
  makeField({ id: 'g', displayLabel: 'G', fieldType: 'group', order: 0, ...overrides });

describe('groupRepeats', () => {
  it('is false for a field that is not a group', () => {
    expect(groupRepeats(makeField({ id: 'x', displayLabel: 'X', fieldType: 'text', order: 0 }), 'Location')).toBe(false);
  });

  it('repeats when unbound and uncapped, which every existing group is', () => {
    expect(groupRepeats(group(), null)).toBe(true);
  });

  it('ignores the default cardinality, which picking "group" never changes', () => {
    expect(groupRepeats(group({ cardinality: { min: 0, max: '1' } }), 'Location')).toBe(true);
  });

  it('holds one when the author capped it at one instance', () => {
    expect(groupRepeats(group({ maxItems: 1 }), null)).toBe(false);
  });

  it('holds one when bound to an element that holds one', () => {
    expect(groupRepeats(group({ fhirPath: 'Location.address' }), 'Location')).toBe(false);
  });

  it('resolves a bare path against the form resource type', () => {
    expect(groupRepeats(group({ fhirPath: 'address' }), 'Location')).toBe(false);
  });

  it('repeats when bound to an element that repeats', () => {
    expect(groupRepeats(group({ fhirPath: 'Location.telecom' }), 'Location')).toBe(true);
  });

  it('reads the element own maximum, not whether a parent repeats', () => {
    expect(groupRepeats(group({ fhirPath: 'Patient.contact.address' }), 'Patient')).toBe(false);
  });

  it('repeats when the path is not in the table, as an unbound group does', () => {
    expect(groupRepeats(group({ fhirPath: 'Questionnaire.item' }), 'Questionnaire')).toBe(true);
  });
});
```

- [ ] **Step 4: Run the three tests and watch them fail**

Run: `pnpm --filter @openldr/forms exec vitest run src/discriminator.test.ts src/group-tree.test.ts src/group-repeats.test.ts`
Expected: FAIL with "Failed to resolve import" for all three modules.

- [ ] **Step 5: Write `discriminator.ts`**

Create `packages/forms/src/discriminator.ts`:

```ts
import type { FormField } from './schema/form-schema';

/**
 * A field's `fhirDiscriminator` as one short line for the field row, for example
 * `system = urn:x`.
 *
 * Two fields bound to `Location.identifier.value` are the same text on screen. The discriminator
 * is the only thing telling them apart, and until this line existed it was invisible in CE.
 * Keys are sorted, so one discriminator always reads the same whatever order it was written in.
 * Returns null when there is nothing to show, so the caller skips the line.
 *
 * Ported from corlix `apps/desktop/src/renderer/lib/discriminatorLabel.ts`. Slice S2 adds the
 * All/Any rule shape.
 */
export function discriminatorLabel(disc: FormField['fhirDiscriminator']): string | null {
  if (!disc) return null;
  const keys = Object.keys(disc).sort();
  if (keys.length === 0) return null;
  return keys.map((key) => `${key} = ${disc[key]}`).join(', ');
}
```

- [ ] **Step 6: Write `group-tree.ts`**

Create `packages/forms/src/group-tree.ts`:

```ts
import type { FormField } from './schema/form-schema';

/**
 * Structure of the `groupId` chain, in one place.
 *
 * `groupId` is a single parent reference on a flat array, so it already expresses a tree of any
 * depth. It does not guarantee the shape is a tree: an imported Questionnaire can carry anything.
 * So every traversal here is cycle-safe. A hang in the builder is worse than a wrong answer.
 *
 * Ported from corlix `apps/desktop/src/renderer/lib/groupTree.ts`.
 */

/** Direct children of one group, in form order. */
export function childrenOf(fields: FormField[], groupId: string): FormField[] {
  return fields.filter((f) => f.groupId === groupId).slice().sort((a, b) => a.order - b.order);
}

/** Every id beneath a group, at any depth. Stops on a cycle. */
export function descendantIds(fields: FormField[], groupId: string): Set<string> {
  const seen = new Set<string>();
  const walk = (id: string): void => {
    for (const child of childrenOf(fields, id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      walk(child.id);
    }
  };
  walk(groupId);
  return seen;
}

/** How many ancestors a field has. 0 is top level. Stops on a cycle. */
export function groupDepth(fields: FormField[], fieldId: string): number {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const seen = new Set<string>([fieldId]);
  let depth = 0;
  let current = byId.get(fieldId)?.groupId;
  while (current && byId.has(current)) {
    if (seen.has(current)) break;
    seen.add(current);
    depth += 1;
    current = byId.get(current)?.groupId;
  }
  return depth;
}

/**
 * Groups this field may be parented to: every group except itself and its own descendants.
 * Excluding descendants is what stops the Group picker building a loop.
 */
export function eligibleParents(fields: FormField[], fieldId: string): FormField[] {
  const banned = descendantIds(fields, fieldId);
  banned.add(fieldId);
  return fields.filter((f) => f.fieldType === 'group' && !banned.has(f.id));
}
```

- [ ] **Step 7: Write `group-repeats.ts`**

Create `packages/forms/src/group-repeats.ts`:

```ts
import { lookupFhirPath } from '@openldr/fhir/paths';
import { resolveFhirPath } from './fhir-path';
import type { FormField } from './schema/form-schema';

/** Every `.<digits>` segment, the same pattern `lint-fhir-path.ts` strips to find an element. */
const NUMERIC_SEGMENT = /\.\d+(?=\.|$)/g;

/**
 * Does this group hold many instances, or exactly one?
 *
 * The exporter and the builder row both need the same answer, so it is derived here once.
 * Before this, `toQuestionnaire` wrote `repeats: true` for every group, so a one-instance element
 * such as `Location.address` could not be a group without exporting a falsehood.
 *
 * Two signals count, and nothing else does:
 *
 * - the author capped the group with `maxItems: 1`
 * - the group is bound to an element whose own maximum is 1
 *
 * The second reads the path table's `ownArray`, never the field's own `cardinality`. The default
 * cardinality is `{min: 0, max: '1'}` and picking `group` in the type dropdown never changes it, so
 * trusting it would convert every group ever authored. An unbound group, or one bound to a path
 * the table does not cover, keeps repeating.
 *
 * Returns false for a field that is not a group. A scalar field's repetition is `repeatable`.
 *
 * Ported from corlix `packages/fhir-forms/src/groupRepeats.ts`, which can trust `cardinality`
 * because corlix's path picker copies it from the element. CE's picker does not.
 */
export function groupRepeats(field: FormField, fhirResourceType: string | null | undefined): boolean {
  if (field.fieldType !== 'group') return false;
  if (field.maxItems === 1) return false;
  const resolved = resolveFhirPath(field.fhirPath, fhirResourceType);
  if (resolved) {
    const info = lookupFhirPath(resolved.replace(NUMERIC_SEGMENT, ''));
    if (info && !info.ownArray) return false;
  }
  return true;
}
```

- [ ] **Step 8: Export the modules**

In `packages/forms/src/pure.ts`, add after `export * from './fhir-path';`:

```ts
export * from './discriminator';
export * from './group-tree';
export * from './group-repeats';
```

In `packages/forms/src/index.ts`, add the same three lines after `export * from './fhir-path';` at line 19.

- [ ] **Step 9: Run the tests and watch them pass**

Run: `pnpm --filter @openldr/forms exec vitest run src/discriminator.test.ts src/group-tree.test.ts src/group-repeats.test.ts`
Expected: PASS, 20 tests: 4 discriminator, 7 group tree, 9 group repeats.

If `Patient.contact.address` or `Location.telecom` fails, open `r4-paths.generated.ts`, read the row, and stop. Do not change the test to fit. Report what the row says.

- [ ] **Step 10: Commit**

```bash
git add packages/forms/src/discriminator.ts packages/forms/src/discriminator.test.ts \
  packages/forms/src/group-tree.ts packages/forms/src/group-tree.test.ts \
  packages/forms/src/group-repeats.ts packages/forms/src/group-repeats.test.ts \
  packages/forms/src/pure.ts packages/forms/src/index.ts
git commit -m "feat(forms): helpers for discriminator labels, the group tree and repetition"
```

---

### Task 3: The export says whether a group repeats

**Files:**
- Modify: `packages/forms/src/to-questionnaire.ts:100-116,165-211`
- Test: `packages/forms/src/group-repeat.test.ts`

**Interfaces:**
- Consumes: `groupRepeats(field, fhirResourceType)` from Task 2.
- Produces: no new exports. `toQuestionnaire` now writes `repeats: false` on a group that holds one.

- [ ] **Step 1: Write the failing tests**

In `packages/forms/src/group-repeat.test.ts`, rename the existing group test title from
`'nests group children, always repeats, carries the instance floor'` to
`'nests group children, repeats when unbound, carries the instance floor'`. Its body stays.

Add these imports at the top:

```ts
import { toQuestionnaireResponse } from './response'
import { fromQuestionnaireResponse } from './from-response'
```

Add these blocks after the `toQuestionnaire — group` block:

```ts
describe('toQuestionnaire, a group that holds one', () => {
  it('writes repeats: false when bound to an element that holds one', () => {
    const q = toQuestionnaire(
      makeSchema({
        id: 'f',
        name: 'F',
        fhirResourceType: 'Location',
        fields: [
          makeField({ id: 'addr', displayLabel: 'Address', fieldType: 'group', order: 0, fhirPath: 'Location.address' }),
          makeField({ id: 'city', displayLabel: 'City', fieldType: 'text', order: 1, groupId: 'addr', fhirPath: 'Location.address.city' }),
        ],
      }),
    )
    expect(q.item![0].repeats).toBe(false)
  })

  it('writes repeats: false when capped at one instance', () => {
    const q = toQuestionnaire(
      makeSchema({
        id: 'f',
        name: 'F',
        fields: [makeField({ id: 'g', displayLabel: 'G', fieldType: 'group', order: 0, maxItems: 1 })],
      }),
    )
    expect(q.item![0].repeats).toBe(false)
  })

  it('writes repeats: true when bound to an element that repeats', () => {
    const q = toQuestionnaire(
      makeSchema({
        id: 'f',
        name: 'F',
        fhirResourceType: 'Location',
        fields: [makeField({ id: 'tel', displayLabel: 'Contact', fieldType: 'group', order: 0, fhirPath: 'Location.telecom' })],
      }),
    )
    expect(q.item![0].repeats).toBe(true)
  })

  it('reads a bare path against the section resource type in a bundle form', () => {
    const q = toQuestionnaire(
      makeSchema({
        id: 'f',
        name: 'F',
        sections: [{ id: 's', label: 'Site', order: 0, fhirResourceType: 'Location' }],
        fields: [makeField({ id: 'addr', displayLabel: 'Address', fieldType: 'group', order: 0, section: 's', fhirPath: 'address' })],
      }),
    )
    expect(q.item![0].item![0].repeats).toBe(false)
  })
})

describe('nested groups', () => {
  const nested = makeSchema({
    id: 'f',
    name: 'Nested',
    fields: [
      makeField({ id: 'visit', displayLabel: 'Visit', fieldType: 'group', order: 0 }),
      makeField({ id: 'symptom', displayLabel: 'Symptom', fieldType: 'group', order: 1, groupId: 'visit' }),
      makeField({ id: 'detail', displayLabel: 'Detail', fieldType: 'group', order: 2, groupId: 'symptom' }),
      makeField({ id: 'duration', displayLabel: 'Duration', fieldType: 'text', order: 3, groupId: 'detail' }),
    ],
  })

  it('round-trips a group three levels deep through the Questionnaire adapters', () => {
    expect(definitionOf(fromQuestionnaire(toQuestionnaire(nested)))).toEqual(definitionOf(nested))
  })

  it('round-trips nested group answers through the response adapters', () => {
    const answers = { visit: [{ symptom: [{ detail: [{ duration: '3 days' }] }] }] }
    const q = toQuestionnaire(nested)
    expect(fromQuestionnaireResponse(toQuestionnaireResponse(nested, answers), q)).toEqual(answers)
  })
})
```

- [ ] **Step 2: Run the tests and watch the right ones fail**

Run: `pnpm --filter @openldr/forms exec vitest run src/group-repeat.test.ts`
Expected: the three `repeats: false` tests FAIL, because the export still writes `true`. The `repeats: true` test passes. Both nested tests should already pass, because the adapters recurse.

**If a nested test fails, stop.** That is a defect in shipped code, outside S1. Report the failure with its output and do not fix it in this slice.

- [ ] **Step 3: Derive `repeats` in the exporter**

In `packages/forms/src/to-questionnaire.ts`, add to the imports:

```ts
import { groupRepeats } from './group-repeats'
```

Change `buildItem` so it takes the resource type and uses it:

```ts
/** Serialize a FormField (scalar or group) to a Questionnaire item, recursing into group children. */
function buildItem(
  field: FormField,
  childrenByGroup: Map<string, FormField[]>,
  fhirResourceType: string | null | undefined,
): QuestionnaireItem {
  if (field.fieldType === 'group') {
    const children = (childrenByGroup.get(field.id) ?? []).slice().sort((a, b) => a.order - b.order)
    const item: QuestionnaireItem = {
      linkId: field.id,
      text: field.displayLabel,
      type: 'group',
      // Derived: a group bound to a one-instance element, or capped at one, holds one.
      repeats: groupRepeats(field, fhirResourceType),
      item: children.map((child) => buildItem(child, childrenByGroup, fhirResourceType)),
    }
```

The rest of the group branch and the scalar branch stay the same.

In `toQuestionnaire`, pass the resource type at both call sites:

```ts
  for (const section of [...model.sections].sort((a, b) => a.order - b.order)) {
    const sectionFields = topLevel.filter((f) => f.section === section.id).sort((a, b) => a.order - b.order)
    const sectionType = section.fhirResourceType ?? model.fhirResourceType
    items.push(sectionToItem(section, sectionFields.map((f) => buildItem(f, childrenByGroup, sectionType))))
  }

  const unsectioned = topLevel
    .filter((f) => !f.section || !sectionIds.has(f.section))
    .sort((a, b) => a.order - b.order)
  for (const field of unsectioned) items.push(buildItem(field, childrenByGroup, model.fhirResourceType))
```

In the doc comment on `toQuestionnaire`, replace
`` `groupId` children and always repeat; repeatable scalars set `repeats`. `` with
`` `groupId` children and repeat unless `groupRepeats` says they hold one; repeatable scalars set `repeats`. ``

- [ ] **Step 4: Run the package tests and watch them pass**

Run: `pnpm --filter @openldr/forms exec vitest run`
Expected: PASS for the whole package, including `round-trip.test.ts` and `to-questionnaire.test.ts`.

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @openldr/forms typecheck > /tmp/s1-t3-tc.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/forms/src/to-questionnaire.ts packages/forms/src/group-repeat.test.ts
git commit -m "fix(forms): export a one-instance group as not repeating"
```

---

### Task 4: The row shows the discriminator and the repeat marker

**Files:**
- Modify: `apps/studio/src/forms-builder/SortableFieldRow.tsx`
- Test: `apps/studio/src/forms-builder/SortableFieldRow.test.tsx`

**Interfaces:**
- Consumes: `discriminatorLabel` from Task 2.
- Produces: `SortableFieldRowProps.repeats?: boolean`. When true on a group, the row shows the repeat marker. The list computes it in Task 5.

The marker's text is one wording change from corlix. Corlix labels a repeating group's marker "Group", which reads oddly beside the `group` type badge. CE uses "Repeating group". A repeatable field reads "Repeats", as in corlix. The operator can veto this in review.

Corlix shows the marker on a repeatable scalar field too (`FieldRow.tsx:286`, `field.repeatable || groupRepeats(field)`). CE does the same.

- [ ] **Step 1: Write the failing tests**

Add to the `describe('SortableFieldRow')` block in `apps/studio/src/forms-builder/SortableFieldRow.test.tsx`:

```tsx
  it('prints the discriminator under the path', () => {
    renderRow({ field: { ...FIELD, fhirPath: 'Location.identifier.value', fhirDiscriminator: { system: 'urn:x' } } });
    expect(screen.getByText('system = urn:x')).toBeTruthy();
  });

  it('prints no discriminator line when the field has none', () => {
    renderRow();
    expect(screen.queryByText(/ = /)).toBeNull();
  });

  it('marks a group that holds many', () => {
    renderRow({ field: { ...FIELD, fieldType: 'group' }, repeats: true });
    expect(screen.getByRole('img', { name: 'Repeating group' })).toBeTruthy();
  });

  it('does not mark a group that holds one', () => {
    renderRow({ field: { ...FIELD, fieldType: 'group' }, repeats: false });
    expect(screen.queryByRole('img', { name: 'Repeating group' })).toBeNull();
  });

  it('marks a repeatable field', () => {
    renderRow({ field: { ...FIELD, repeatable: true } });
    expect(screen.getByRole('img', { name: 'Repeats' })).toBeTruthy();
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder/SortableFieldRow.test.tsx`
Expected: FAIL on the discriminator line and the three marker tests. `repeats` is also a type error until Step 3. Vitest does not typecheck, so it reports only the missing elements.

- [ ] **Step 3: Implement**

In `apps/studio/src/forms-builder/SortableFieldRow.tsx`:

Change the lucide import and add two imports:

```tsx
import { GripVertical, MoreHorizontal, Repeat } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { discriminatorLabel } from '@openldr/forms/pure';
```

Add to `SortableFieldRowProps`:

```tsx
  /** True when this group holds many instances. The list derives it with `groupRepeats`. */
  repeats?: boolean;
```

Add `repeats = false,` to the destructured props.

Before the `return`, add:

```tsx
  const discLabel = discriminatorLabel(field.fhirDiscriminator);
  const showRepeat = field.fieldType === 'group' ? repeats : field.repeatable === true;
  const repeatText = field.fieldType === 'group' ? 'Repeating group' : 'Repeats';
```

Inside the label `<button>`, after the `field.fhirPath` `TruncatedText`, add the line. It wraps rather than truncating, because the value is the part that tells two slots apart:

```tsx
        {discLabel && (
          <span className="block break-all font-mono text-[10px] leading-4 text-primary">
            {discLabel}
          </span>
        )}
```

Between the lint marker and the type badge, add the marker:

```tsx
      {/* Claims the field holds many. A group bound to a one-instance element holds one, so it
          must not carry the marker. Radix tooltips do not open on touch, hence the aria-label. */}
      {showRepeat && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="img"
                aria-label={repeatText}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
              >
                <Repeat className="h-3 w-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{repeatText}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
```

- [ ] **Step 4: Run and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder/SortableFieldRow.test.tsx`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/forms-builder/SortableFieldRow.tsx apps/studio/src/forms-builder/SortableFieldRow.test.tsx
git commit -m "feat(studio): show the discriminator and repeat marker on a field row"
```

---

### Task 5: The list draws repeat nodes and nests groups to any depth

**Files:**
- Create: `apps/studio/src/forms-builder/fieldTree.ts`, `apps/studio/src/forms-builder/fieldTree.test.ts`
- Create: `apps/studio/src/forms-builder/RepeatRow.tsx`
- Modify: `apps/studio/src/forms-builder/FieldListPane.tsx`
- Modify: `apps/studio/src/forms-builder/FormBuilderPage.tsx:353-372`
- Test: `apps/studio/src/forms-builder/FieldListPane.test.tsx`

**Interfaces:**
- Consumes: `groupRepeats` from Task 2. `SortableFieldRowProps.repeats` from Task 4.
- Produces:
  - `arrayPathOf(field: FormField): string | null`
  - `buildFieldTree(fields: FormField[]): TreeNode[]`, where `TreeNode = { kind: 'field'; field } | { kind: 'repeat'; path; label; slots }`
  - `RepeatRow({ node }: { node: RepeatNode })`
  - `FieldListPaneProps.fhirResourceType?: string | null`
  - S2's "+ Add a named slot" attaches under `RepeatRow`'s slots. S4's range selection will need a `flattenTree`. It is not written here, because nothing in S1 uses it.

- [ ] **Step 1: Write the failing tree test**

Create `apps/studio/src/forms-builder/fieldTree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FormField } from '@openldr/forms/pure';
import { arrayPathOf, buildFieldTree } from './fieldTree';

function field(overrides: Partial<FormField> & Pick<FormField, 'id' | 'order'>): FormField {
  return {
    displayLabel: overrides.id,
    fieldType: 'text',
    required: false,
    enabled: true,
    fhirPath: null,
    cardinality: { min: 0, max: '1' },
    description: null,
    ...overrides,
  };
}

const slot = (id: string, order: number, system: string) =>
  field({ id, order, fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system } });

describe('arrayPathOf', () => {
  it('strips the value field from the path of a slot', () => {
    expect(arrayPathOf(slot('a', 0, 'urn:a'))).toBe('Location.identifier');
  });

  it('is null without a discriminator', () => {
    expect(arrayPathOf(field({ id: 'a', order: 0, fhirPath: 'Location.identifier.value', fhirValueField: 'value' }))).toBeNull();
  });

  it('is null without a value field', () => {
    expect(arrayPathOf(field({ id: 'a', order: 0, fhirPath: 'Location.identifier.value', fhirDiscriminator: { system: 'x' } }))).toBeNull();
  });

  it('is null when the path does not end in the value field', () => {
    expect(arrayPathOf(field({ id: 'a', order: 0, fhirPath: 'Location.identifier.system', fhirValueField: 'value', fhirDiscriminator: { system: 'x' } }))).toBeNull();
  });
});

describe('buildFieldTree', () => {
  it('draws slots of one list under a single repeat node', () => {
    const nodes = buildFieldTree([slot('local', 1, 'urn:local'), slot('mfl', 2, 'urn:mfl')]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'repeat', path: 'Location.identifier', label: 'identifier' });
    expect(nodes[0].kind === 'repeat' && nodes[0].slots.map((s) => s.id)).toEqual(['local', 'mfl']);
  });

  it('puts the repeat where its first slot sits, so nothing reorders', () => {
    const nodes = buildFieldTree([
      field({ id: 'name', order: 0 }),
      slot('local', 1, 'urn:local'),
      field({ id: 'status', order: 2 }),
      slot('mfl', 3, 'urn:mfl'),
    ]);
    expect(nodes.map((n) => (n.kind === 'field' ? n.field.id : n.path))).toEqual(['name', 'Location.identifier', 'status']);
  });

  it('leaves a group child alone, because groupId already nests it', () => {
    const child = { ...slot('local', 1, 'urn:local'), groupId: 'g' };
    const nodes = buildFieldTree([child]);
    expect(nodes).toEqual([{ kind: 'field', field: child }]);
  });
});
```

- [ ] **Step 2: Write the failing list tests**

Add these tests at the end of the `describe('FieldListPane')` block in `apps/studio/src/forms-builder/FieldListPane.test.tsx`:

```tsx
  // ── Repeat nodes and deep nesting ────────────────────────────────────────────

  const base = (overrides: Partial<FormField> & Pick<FormField, 'id' | 'displayLabel' | 'order'>): FormField => ({
    fieldType: 'text',
    required: false,
    enabled: true,
    fhirPath: null,
    cardinality: { min: 0, max: '1' },
    description: null,
    ...overrides,
  });

  it('draws two slots of one list under a repeat header', () => {
    renderPane({
      sections: [],
      fields: [
        base({ id: 'local', displayLabel: 'Local ID', order: 0, fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system: 'urn:local' } }),
        base({ id: 'mfl', displayLabel: 'MFL ID', order: 1, fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system: 'urn:mfl' } }),
      ],
    });
    expect(screen.getByText('identifier')).toBeTruthy();
    expect(screen.getByText('Location.identifier')).toBeTruthy();
    expect(screen.getByText('2 slots')).toBeTruthy();
    const slotCard = screen.getByText('MFL ID').closest('[data-sortable-card]');
    expect(slotCard?.parentElement?.getAttribute('data-nested')).toBe('true');
  });

  it('draws no repeat header for a field with a discriminator but no value field', () => {
    renderPane({
      sections: [],
      fields: [base({ id: 'code', displayLabel: 'Facility code', order: 0, fhirPath: 'Location.identifier.value', fhirDiscriminator: { system: 'urn:x' } })],
    });
    expect(screen.queryByText(/slots?$/)).toBeNull();
    expect(screen.getByText('system = urn:x')).toBeTruthy();
  });

  it('nests a group inside a group inside a group', () => {
    renderPane({
      sections: [],
      fields: [
        base({ id: 'visit', displayLabel: 'Visit', fieldType: 'group', order: 0 }),
        base({ id: 'symptom', displayLabel: 'Symptom', fieldType: 'group', order: 1, groupId: 'visit' }),
        base({ id: 'duration', displayLabel: 'Duration', order: 2, groupId: 'symptom' }),
      ],
    });
    const leaf = screen.getByText('Duration').closest('[data-sortable-card]');
    const innerWrapper = leaf?.parentElement;
    expect(innerWrapper?.getAttribute('data-nested')).toBe('true');
    const outerWrapper = innerWrapper?.parentElement?.closest('[data-nested="true"]');
    expect(outerWrapper).toBeTruthy();
    expect(outerWrapper?.contains(screen.getByText('Symptom'))).toBe(true);
  });

  it('marks a group bound to a repeating element, and not one bound to a single element', () => {
    renderPane({
      sections: [],
      fhirResourceType: 'Location',
      fields: [
        base({ id: 'tel', displayLabel: 'Contacts', fieldType: 'group', order: 0, fhirPath: 'Location.telecom' }),
        base({ id: 'addr', displayLabel: 'Address', fieldType: 'group', order: 1, fhirPath: 'Location.address' }),
      ],
    });
    expect(screen.getAllByRole('img', { name: 'Repeating group' })).toHaveLength(1);
    const telCard = screen.getByText('Contacts').closest('[data-sortable-card]');
    expect(telCard?.querySelector('[aria-label="Repeating group"]')).toBeTruthy();
  });
```

- [ ] **Step 3: Run both files and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder/fieldTree.test.ts src/forms-builder/FieldListPane.test.tsx`
Expected: `fieldTree.test.ts` fails to resolve `./fieldTree`. The four new list tests FAIL. The existing list tests still pass.

- [ ] **Step 4: Write `fieldTree.ts`**

Create `apps/studio/src/forms-builder/fieldTree.ts`:

```ts
import type { FormField } from '@openldr/forms/pure';

/**
 * How the field list is drawn, without changing how it is stored.
 *
 * CE stores a repeating FHIR element as loose sibling fields that share a `fhirPath` and are
 * told apart by `fhirDiscriminator`. The list therefore says "two fields" where FHIR says "one
 * list, two slots". This draws the list. Nothing here writes, and `fields` keeps its flat shape.
 *
 * Ported from corlix `apps/desktop/src/renderer/lib/fieldTree.ts`.
 */

export interface FieldNode {
  kind: 'field';
  field: FormField;
}

export interface RepeatNode {
  kind: 'repeat';
  /** The list path, for example `Location.identifier`. Also the node's identity. */
  path: string;
  /** Last segment of the path. Derived, because nothing stores a list label. */
  label: string;
  slots: FormField[];
}

export type TreeNode = FieldNode | RepeatNode;

/**
 * The list a discriminated field is a slot of, or null when it is not one.
 *
 * Both a discriminator and a value field are required, matching corlix: its renderer takes the
 * list branch only when both are set, so a field missing either is not a slot.
 */
export function arrayPathOf(field: FormField): string | null {
  if (!field.fhirDiscriminator || !field.fhirValueField || !field.fhirPath) return null;
  const suffix = `.${field.fhirValueField}`;
  if (!field.fhirPath.endsWith(suffix)) return null;
  return field.fhirPath.slice(0, -suffix.length);
}

/**
 * Group slots of one list under a repeat node, leaving everything else alone.
 *
 * A repeat takes the position of its first slot, so the list does not reorder under the reader.
 * Group children are skipped: `groupId` already nests them, and hoisting one into a repeat would
 * nest it twice.
 */
export function buildFieldTree(fields: FormField[]): TreeNode[] {
  const ordered = [...fields].sort((a, b) => a.order - b.order);
  const nodes: TreeNode[] = [];
  const repeats = new Map<string, RepeatNode>();

  for (const field of ordered) {
    const path = field.groupId ? null : arrayPathOf(field);
    if (!path) {
      nodes.push({ kind: 'field', field });
      continue;
    }
    const existing = repeats.get(path);
    if (existing) {
      existing.slots.push(field);
      continue;
    }
    const node: RepeatNode = { kind: 'repeat', path, label: path.split('.').pop() ?? path, slots: [field] };
    repeats.set(path, node);
    nodes.push(node);
  }

  return nodes;
}
```

- [ ] **Step 5: Write `RepeatRow.tsx`**

Create `apps/studio/src/forms-builder/RepeatRow.tsx`:

```tsx
import { Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TruncatedText } from '@/components/ui/truncated-text';
import type { RepeatNode } from './fieldTree';

/**
 * The header of a repeating FHIR element. Its slots are drawn beneath it by the list.
 *
 * Derived, not stored: it has no id, it cannot be dragged, it has no ⋯ menu and there is nothing
 * to delete. What it buys is that `Location.identifier` reads as one list with two named slots,
 * not two unrelated fields that happen to share a path.
 */
export function RepeatRow({ node }: { node: RepeatNode }): JSX.Element {
  const count = node.slots.length;
  return (
    <div className="flex items-center gap-2 px-1 py-1.5">
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
      >
        <Repeat className="h-3 w-3" />
      </span>
      <div className="min-w-0">
        <TruncatedText as="span" text={node.label} className="block text-sm font-medium text-foreground" />
        <TruncatedText as="span" text={node.path} className="block font-mono text-[10px] text-muted-foreground" />
      </div>
      <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
        {count === 1 ? '1 slot' : `${count} slots`}
      </Badge>
    </div>
  );
}
```

- [ ] **Step 6: Rewrite the list rendering**

In `apps/studio/src/forms-builder/FieldListPane.tsx`:

Add imports:

```tsx
import { groupRepeats } from '@openldr/forms/pure';
import { buildFieldTree, type TreeNode } from './fieldTree';
import { RepeatRow } from './RepeatRow';
```

Add to `FieldListPaneProps`, and `fhirResourceType = null,` to the destructured props:

```tsx
  /** The form's resource type. A group's "holds one or many" reads its bound path against it. */
  fhirResourceType?: string | null;
```

Delete the `childFieldIds` memo at lines 90-97. Nothing uses it after this step.

Replace `issueForField` and add two render helpers after it:

```tsx
  function issueForField(fieldId: string): FormLintIssue | undefined {
    return issues.find((i) => i.fieldId === fieldId);
  }

  /**
   * One field, then its group children at any depth. A group's parts hang off a dashed guide;
   * a repeat's slots (below) hang off a solid one, so the two kinds of nesting do not read alike.
   */
  function renderField(field: FormField): React.ReactNode {
    const children = field.fieldType === 'group' ? childrenByGroup.get(field.id) ?? [] : [];
    return (
      <React.Fragment key={field.id}>
        <SortableFieldRow
          field={field}
          selected={field.id === selectedFieldId}
          lintIssue={issueForField(field.id)}
          repeats={groupRepeats(field, fhirResourceType)}
          onSelect={onSelect}
          onToggleEnabled={onToggleEnabled}
          onToggleRequired={onToggleRequired}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
        {children.length > 0 && (
          <div data-nested="true" className="ml-3 space-y-1.5 border-l-2 border-dashed border-border pl-3">
            {children.map((child) => renderField(child))}
          </div>
        )}
      </React.Fragment>
    );
  }

  function renderNode(node: TreeNode): React.ReactNode {
    if (node.kind === 'field') return renderField(node.field);
    return (
      <div key={`repeat:${node.path}`}>
        <RepeatRow node={node} />
        <div data-nested="true" className="ml-3 space-y-1.5 border-l-2 border-border pl-3">
          {node.slots.map((slot) => renderField(slot))}
        </div>
      </div>
    );
  }
```

Replace the sectioned branch's inner list, lines 240-275, with:

```tsx
                  <div className="space-y-1.5">
                    {buildFieldTree(fieldList).map(renderNode)}
                  </div>
```

Replace the unsectioned branch, lines 278-315, with:

```tsx
              // No sections: flat list of top-level nodes; children render under their group.
              <div className="space-y-1.5">{buildFieldTree(topLevelVisible).map(renderNode)}</div>
```

The `SortableContext` `items` stay `visibleFields.map((f) => f.id)`, so every row, slots included, still reorders.

- [ ] **Step 7: Pass the resource type from the page**

In `apps/studio/src/forms-builder/FormBuilderPage.tsx`, add this prop to `<FieldListPane>` after `fields={schema.fields}`:

```tsx
              fhirResourceType={schema.fhirResourceType ?? null}
```

- [ ] **Step 8: Run and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder`
Expected: PASS for every file in `forms-builder`, including the existing nesting test at `FieldListPane.test.tsx:235`.

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/forms-builder/fieldTree.ts apps/studio/src/forms-builder/fieldTree.test.ts \
  apps/studio/src/forms-builder/RepeatRow.tsx apps/studio/src/forms-builder/FieldListPane.tsx \
  apps/studio/src/forms-builder/FieldListPane.test.tsx apps/studio/src/forms-builder/FormBuilderPage.tsx
git commit -m "feat(studio): draw repeat nodes and groups at any depth in the field list"
```

---

### Task 6: A group can go inside a group

**Files:**
- Modify: `apps/studio/src/forms-builder/FieldEditorSheet.tsx:89-92,184-214`
- Test: `apps/studio/src/forms-builder/FieldEditorSheet.test.tsx:243-272`

**Interfaces:**
- Consumes: `eligibleParents`, `groupRepeats` from Task 2. `fhirResourceType`, already destructured at `FieldEditorSheet.tsx:55`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Replace the old test and add new ones**

In `apps/studio/src/forms-builder/FieldEditorSheet.test.tsx`, delete the test
`'does not show Group Select when field is a group type'` (lines 268-271). It asserts the old behavior.

Add these tests inside `describe('Group Select')`:

```tsx
    it('shows the Group picker on a group, so a group can go inside another', () => {
      const other: FormField = { ...GROUP_FIELD, id: 'g-2', displayLabel: 'Visit', order: 2 };
      renderSheet({ field: GROUP_FIELD, allFields: [BASE_FIELD, GROUP_FIELD, other] });
      fireEvent.click(screen.getByRole('combobox', { name: /group/i }));
      expect(screen.getByRole('option', { name: 'Visit' })).toBeTruthy();
    });

    it('never offers a group itself or anything inside it', () => {
      const child: FormField = { ...GROUP_FIELD, id: 'g-child', displayLabel: 'Inner', order: 2, groupId: 'g-1' };
      const other: FormField = { ...GROUP_FIELD, id: 'g-2', displayLabel: 'Visit', order: 3 };
      renderSheet({ field: GROUP_FIELD, allFields: [GROUP_FIELD, child, other] });
      fireEvent.click(screen.getByRole('combobox', { name: /group/i }));
      expect(screen.queryByRole('option', { name: 'Inner' })).toBeNull();
      expect(screen.queryByRole('option', { name: 'Demographics' })).toBeNull();
      expect(screen.getByRole('option', { name: 'Visit' })).toBeTruthy();
    });

    it('notes a group that holds a single instance', () => {
      renderSheet({ field: { ...GROUP_FIELD, maxItems: 1 } });
      expect(screen.getByText('This group holds a single instance, so data entry shows no add control.')).toBeTruthy();
    });

    it('has no single-instance note on a group that holds many', () => {
      renderSheet({ field: GROUP_FIELD });
      expect(screen.queryByText(/holds a single instance/)).toBeNull();
    });
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder/FieldEditorSheet.test.tsx`
Expected: the four new tests FAIL. The picker is hidden on a group and the note does not exist.

- [ ] **Step 3: Implement**

In `apps/studio/src/forms-builder/FieldEditorSheet.tsx`:

Add to the imports:

```tsx
import { eligibleParents, groupRepeats } from '@openldr/forms/pure';
```

Replace lines 90-92:

```tsx
  // Every group except this field and its own descendants, so the picker cannot build a loop.
  const groupFields = eligibleParents(allFields, activeDraft.id);
```

Replace the block from `{/* Group (hidden when the field itself is a group) */}` to its closing `)}` (lines 184-214) with:

```tsx
            {/* Group. A group can sit inside another group, to any depth. */}
            <Label htmlFor="field-group-trigger" className="whitespace-nowrap">
              Group
            </Label>
            <div className="flex flex-col gap-1">
              <Select
                value={activeDraft.groupId ?? '__none'}
                onValueChange={(v) =>
                  patchDraft({ groupId: v === '__none' ? undefined : v })
                }
              >
                <SelectTrigger id="field-group-trigger" aria-label="Group">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No group</SelectItem>
                  {groupFields.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.displayLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Nest this field under a Group field. Create one by setting a field&apos;s Type to Group.
              </p>
              {activeDraft.fieldType === 'group' && !groupRepeats(activeDraft, fhirResourceType) && (
                <p className="text-xs text-muted-foreground">
                  This group holds a single instance, so data entry shows no add control.
                </p>
              )}
            </div>
```

- [ ] **Step 4: Run and watch them pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/forms-builder`
Expected: PASS for every file in `forms-builder`.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/forms-builder/FieldEditorSheet.tsx apps/studio/src/forms-builder/FieldEditorSheet.test.tsx
git commit -m "feat(studio): let a group sit inside another group"
```

---

### Task 7: Docs, and the spec correction

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/forms.md`, `fr/forms.md`, `pt/forms.md`
- Modify: `apps/web/src/docs/0.1.8/forms.md`
- Modify: `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, section 7, item 2

- [ ] **Step 1: English in-app doc**

In `apps/studio/src/docs/0.1.8/en/forms.md`, insert this section before `## Expected result`:

```md
## How the field list shows structure

- **Which entry of a list a field fills.** A field bound to one entry of a FHIR list shows a second line under its path, such as `system = urn:x`. Two fields on `Location.identifier.value` differ only by this line.
- **Slots of one list.** Fields that share a list and have both a discriminator and a value field sit under one header. The header shows the list name, its path, and how many slots it has. The list draws it from the fields, so it cannot be dragged or deleted.
- **Groups inside groups.** Set a group's **Group** to put it inside another group, to any depth. The picker never offers the group itself or anything already inside it.
- **The repeat icon.** A field that takes more than one answer, or a group that holds many entries, shows a repeat icon. A group holds one entry when it is bound to an element that holds one, such as `Location.address`, or when **Max Items** is 1. The Questionnaire export marks such a group as not repeating.
- Data entry still shows every group once. Adding more entries to a group during data entry comes in a later release.
```

- [ ] **Step 2: French in-app doc**

In `apps/studio/src/docs/0.1.8/fr/forms.md`, insert this section before `## Exemple : soumettre une demande de laboratoire`:

```md
## Structure de la liste des champs

- **L'entrée d'une liste remplie par un champ.** Un champ lié à une entrée d'une liste FHIR affiche une deuxième ligne sous son chemin, par exemple `system = urn:x`. Deux champs sur `Location.identifier.value` ne diffèrent que par cette ligne.
- **Emplacements d'une même liste.** Les champs qui partagent une liste et ont un discriminateur et un champ de valeur sont réunis sous un en-tête. L'en-tête indique le nom de la liste, son chemin et le nombre d'emplacements. La liste le déduit des champs : on ne peut ni le déplacer ni le supprimer.
- **Groupes imbriqués.** Définissez le **Group** d'un groupe pour le placer dans un autre groupe, à n'importe quelle profondeur. Le sélecteur ne propose jamais le groupe lui-même ni ce qu'il contient déjà.
- **L'icône de répétition.** Un champ qui accepte plusieurs réponses, ou un groupe qui contient plusieurs entrées, affiche une icône de répétition. Un groupe contient une seule entrée s'il est lié à un élément unique, comme `Location.address`, ou si **Max Items** vaut 1. L'export Questionnaire marque alors ce groupe comme non répétable.
- La saisie affiche encore chaque groupe une seule fois. L'ajout d'entrées à un groupe pendant la saisie arrivera dans une version ultérieure.
```

- [ ] **Step 3: Portuguese in-app doc**

In `apps/studio/src/docs/0.1.8/pt/forms.md`, insert this section before `## Exemplo: enviar um pedido de laboratório`:

```md
## Estrutura da lista de campos

- **Qual entrada de uma lista um campo preenche.** Um campo ligado a uma entrada de uma lista FHIR mostra uma segunda linha sob o seu caminho, por exemplo `system = urn:x`. Dois campos em `Location.identifier.value` diferem apenas por esta linha.
- **Posições de uma mesma lista.** Os campos que partilham uma lista e têm um discriminador e um campo de valor ficam sob um cabeçalho. O cabeçalho mostra o nome da lista, o seu caminho e quantas posições tem. A lista deduz o cabeçalho dos campos, por isso não pode ser arrastado nem eliminado.
- **Grupos dentro de grupos.** Defina o **Group** de um grupo para o colocar dentro de outro grupo, a qualquer profundidade. O seletor nunca oferece o próprio grupo nem o que já está dentro dele.
- **O ícone de repetição.** Um campo que aceita mais de uma resposta, ou um grupo que contém várias entradas, mostra um ícone de repetição. Um grupo contém uma só entrada quando está ligado a um elemento único, como `Location.address`, ou quando **Max Items** é 1. A exportação Questionnaire marca esse grupo como não repetível.
- A introdução de dados ainda mostra cada grupo uma vez. Adicionar entradas a um grupo durante a introdução de dados chega numa versão posterior.
```

- [ ] **Step 4: Web doc, all three languages**

In `apps/web/src/docs/0.1.8/forms.md`, add a level-3 section at the end of each language block. Use the text from Steps 1 to 3 with `###` in place of `##`:

- `### How the field list shows structure`, placed before `## Français`
- `### Structure de la liste des champs`, placed before `## Português`
- `### Estrutura da lista de campos`, placed at the end of the file

- [ ] **Step 5: Correct the spec**

In `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, section 7, replace item 2 with:

```md
2. `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md` and `apps/web/src/docs/0.1.8/forms.md`
   are updated. The web doc holds all three languages in one file, under `## English`,
   `## Français` and `## Português`, so each gets its own section.
```

- [ ] **Step 6: Run the docs tests**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs`
Expected: PASS. `validation.test.ts` checks links and images in the English corpus. The new sections add neither.

Run: `pnpm --filter @openldr/web exec vitest run`
Expected: PASS. If the web package has no docs test, record that in the report.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/docs/0.1.8 apps/web/src/docs/0.1.8/forms.md docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md
git commit -m "docs(forms): describe how the field list shows structure"
```

---

### Task 8: Verify, merge, changelog

**Files:** none changed, except `apps/web/src/landing/changelog.json` in Step 7.

- [ ] **Step 1: Full test gate**

Run from the repo root: `pnpm turbo run test --force > /tmp/s1-test.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. If not, run `grep -n "Test timed out" /tmp/s1-test.txt` first. A timeout is usually not a regression: re-run that package alone before blaming a change.

- [ ] **Step 2: Full typecheck gate**

Run: `pnpm turbo run typecheck --force > /tmp/s1-tc.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 3: Check it in the browser, desktop width**

Start the dev server with `preview_start` from `.claude/launch.json`. Sign in, open **Forms**, and open the seeded Facility form. Check:

- The Facility code row shows `system = <national system URI>` in the accent colour under `Location.identifier.value`.
- No repeat header appears, because that field has no value field.

Then build a throwaway test form with resource type `Location`:

- Two text fields on `Location.identifier.value`, each with a value field of `value` and different discriminators. The editor for these arrives in S2, so set them through the forms API with `updateForm`. Expected: one `identifier` header with `2 slots` and the discriminator lines.
- A group bound to `Location.telecom` has the repeat icon. A group bound to `Location.address` does not.
- Open the `Location.address` group's editor. Expected: the single-instance note, and a Group picker.
- Put group B inside group A, then open A. Expected: A's picker does not list B.
- Export the Questionnaire. Expected: `repeats: false` on the address group.

Compare the list against corlix's `apps/desktop/test-output/p13-1/01-field-list.png` and `p15-3-recursive-nesting/05-builder-tree.png`. Take a screenshot for the report.

- [ ] **Step 4: Check it at 375x812**

`resize_window` preset `mobile`, reload, repeat the list checks. Expected:

- The discriminator line wraps rather than overflowing.
- Three levels of nesting do not scroll the page sideways.
- The repeat icon has its aria-label. Radix tooltips do not open on touch, so the tooltip itself is not checked.

Reset with preset `desktop`. Nothing in S1 is anchored to the bottom edge.

Delete the throwaway form.

- [ ] **Step 5: Merge to local main**

```bash
git switch main
git merge --no-ff feat/form-builder-s1 -m "Merge branch 'feat/form-builder-s1'"
```

- [ ] **Step 6: Re-run both gates on main**

Run: `pnpm turbo run test --force > /tmp/s1-main-test.txt 2>&1; echo "exit=$?"` then
`pnpm turbo run typecheck --force > /tmp/s1-main-tc.txt 2>&1; echo "exit=$?"`
Expected: both `exit=0`.

- [ ] **Step 7: Changelog**

```bash
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog after form builder S1 merge"
```

- [ ] **Step 8: Report**

Report to the operator:
- The commits on `main`.
- Both gate results, with the command and the exit code.
- The screenshots.
- What only a real phone could confirm. For S1 nothing is bottom-anchored, so say so.
- Anything that failed and was stopped rather than fixed, especially Task 3's nested round trip.

Do not push.

---

## Notes for later slices, found while writing this plan

- **For the data-entry step, not S1.** `FormRuntime.tsx:351-372` passes the flat `answers` object to a group's children, so a child's answer seems to land at `answers[child.id]`. `toQuestionnaireResponse` reads a group's answers as a list of instance objects at `answers[group.id]` (`response.ts:41`). If both are true, answers inside a group never reach the response. Unverified. Check it first in the data-entry spec.
- **S2** adds "+ Add a named slot" under `RepeatRow`'s slots and extends `discriminatorLabel` for the All/Any rule.
- **S4** needs `flattenTree` in `fieldTree.ts` for Shift-range selection. Corlix's version is at `apps/desktop/src/renderer/lib/fieldTree.ts:79-86`.
