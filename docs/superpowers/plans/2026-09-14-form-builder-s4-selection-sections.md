# Form builder S4: selection and sections

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** Select many fields and act on them together, drag a field onto a section, and edit a section's visibility rule, as corlix does.

**Architecture:** Pure helpers decide the selection (`selection.ts`), what a bulk action does to the fields (`bulkActions.ts`), and the order the list draws its rows (`listOrder.ts`). `FieldListPane` draws from `listOrder.ts`, and the page walks the same order for Shift-click and for `j` and `k`. New components: `BulkSelectionMenu`, `SectionDropPanel`, `SectionVisibilitySheet`, `VisibilityMarker`. `VisibilityRuleEditor` takes a rule instead of a field, as corlix's does. Storage does not change.

**Tech Stack:** TypeScript, vitest, React 18, Testing Library, dnd-kit, Radix via shadcn `components/ui`.

**Spec:** `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, section 5, S4. Rows B1 with B1b, B2, B5.

## Read this first: state when this plan was written

- Written 2026-09-14 at `main` `5dfbc279`. S1, S2 and S3 are merged and pushed.
- Corlix is at `~/Projects/Repositories/corlix`. Its source for this slice is `apps/desktop/src/renderer/pages/FormBuilderPage.tsx:163-167,470-500,600-648,915-1060,1550-1570,1695-1760,1912-1940`, `components/FieldBulkActionBar.tsx`, `components/SectionDropPanel.tsx`, `components/form-builder/SectionListRow.tsx`, `components/form-builder/FieldRow.tsx:159,273` and `components/VisibilityRuleEditor.tsx:40-54`. Its English strings are under `forms.bulk`, `forms.drop` and `forms.visibility` in `i18n/locales/en.json`.
- A `pre:edit-write` GateGuard hook blocks the first Edit or Write to each file until you state four facts: the importers, the public names affected, any data files read, and the operator's instruction. Answer it and retry. Its loop and scope warnings are noise.
- A separate session is investigating why the studio sometimes reloads onto the Dashboard. If the builder jumps to `/studio/` during the browser checks, that is the known issue. Re-open the builder and carry on.

## RULE 0: each gap, checked 2026-09-14

| Row | The fact that would make it not real | What the code says |
|---|---|---|
| B1 | A multi-select already exists | `selectAll: () => undefined`, `FormBuilderPage.tsx:258`. `FieldListPane` takes one `selectedFieldId`, `FieldListPane.tsx:31` |
| B2 | A drop target already exists | No `useDroppable` anywhere in `apps/studio/src/forms-builder` |
| B5 | Sections can already take a rule in the builder | `SectionsManager.tsx` never reads `visibility`. The schema has it, `packages/forms/src/schema/form-schema.ts:124`. Data entry honours it, `packages/forms/src/visibility.ts:97` |

Three spec claims failed the same check. The operator ruled on each on 2026-09-14.

1. **Shift-click and Ctrl-click cannot work in corlix.** A click that leaves one row selected opens the modal editor, and its overlay blocks the next click. Corlix's own e2e says so and reaches multi-select only through Ctrl+A (`apps/desktop/e2e/screenshots.spec.ts:366-368`). **Ruling:** in CE a Shift-click or Ctrl-click changes the selection and never opens the editor. A plain click works as it does today.
2. **Keyboard shortcuts are not the same in both apps**, as the spec's section 3 claims. `j`, `k`, Enter, Space and Ctrl+D are stubs in CE (`FormBuilderPage.tsx:252-256`), and Ctrl+F looks for an element id nothing has (`FormBuilderPage.tsx:251`; grep finds no `builder-field-search` elsewhere). **Ruling:** wire them in S4.
3. **CE field rows have no branch marker**, so "the same branch marker a field does" has nothing to copy. Corlix draws one on fields and sections (`FieldRow.tsx:273`, `SectionListRow.tsx:55`). **Ruling:** add it to both.

## Global Constraints

- Match corlix's shipped behavior, except where the three rulings above say otherwise. Add nothing beyond it.
- Storage does not change. Data entry does not change.
- UI strings are plain English literals, like the rest of `forms-builder`. No i18n keys.
- shadcn components only in new app code. Never a native `<button>`, `<select>`, `<input>` or `<dialog>`.
- Row, header and sheet actions go in a `⋯` `DropdownMenu` (AGENTS.md §5).
- Sheets, not dialogs. The one Dialog here is the bulk delete confirm, a use AGENTS.md §5 allows.
- Each bulk action is one undo step: one `history.pushHistory()`, then one `setSchema`.
- Never pipe turbo through `tail`. Never read `$?` through a pipe. Redirect to a file, then echo the exit code.
- No `Co-Authored-By` trailers on commits (AGENTS.md §9).
- Work on branch `feat/form-builder-s4`. Merge to local `main` at the end. Do not push. Do not open a PR.

## Decisions and adaptations, each with its reason

- **The editor is its own state.** The page splits today's `selectedId` into `editingId` (the field in the editor) and `selection` (a set plus an anchor). A plain click sets both. A modified click sets only the selection. This is what ruling 1 needs.
- **Closing the editor keeps the selection and the anchor.** Corlix clears both (`FormBuilderPage.tsx:1838`). Kept here so a Shift-click after closing the editor ranges from the field just edited. Without it, ruling 1 still leaves Shift-click with no anchor.
- **List keys act only when the page itself or a row's label has focus.** Before S4 they were stubs, so no control relied on them. Once wired, they would fire from anywhere. ArrowDown in an open select would move the anchor, Enter on a menu item would also open the editor, and Escape that closes a sheet would clear the selection. Undo, redo and Ctrl+F keep working everywhere, as today. Corlix skips only text boxes (`hooks/use-keyboard-shortcuts.ts:11-14`). The narrower rule is needed here because CE keeps the anchor after the editor closes.
- **Space and `d` act on the whole selection when it holds two or more, otherwise on the anchor.** That is corlix, `FormBuilderPage.tsx:988-1008`. `d` on two or more asks first, through the same confirm as the menu's Delete.
- **Toggle enabled uses corlix's majority rule.** When at least half of the unlocked selected fields are on, all of them go off, otherwise all go on (`FormBuilderPage.tsx:628-640`). Locked fields keep their state. Delete keeps locked fields.
- **Space on one field also skips a locked field.** Today `toggleEnabled` does not check `locked`; only the row's checkbox is disabled. Space goes through the bulk helper, which does check.
- **The confirm text is not corlix's.** Corlix says "You can undo (⌘Z) until you save." CE's save does not clear undo, so that would be false here. CE says "This removes them from the form. Locked fields stay. You can undo it with Ctrl+Z."
- **Move to section is flat items, not a submenu.** jsdom cannot open a Radix submenu reliably (`shell/AppShell.settings.test.tsx:62-75` carries a fallback for exactly this), and a phone reads a submenu badly. The items read "Move to (no section)", then "Move to Vitals" for each section.
- **The bulk menu has Clear selection.** Corlix's bar has a clear button (`FieldBulkActionBar.tsx`). It goes in the menu per AGENTS.md §5.
- **Undo and redo clear the selection**, as corlix does (`FormBuilderPage.tsx:923-924`). An undone add would otherwise leave an id in the count that no longer exists.
- **The drop panel stays mounted and folds away when idle,** as corlix's does. Its drop targets then exist before a drag starts. It renders only when the form has sections, per the spec.
- **A drop moves only the dragged field,** even when several are selected. That is corlix, `FormBuilderPage.tsx:488-492`.
- **The section rows' Move up, Move down and Delete buttons move into the new `⋯`.** The spec adds a `⋯` with Edit visibility to each section row. Three loose buttons beside it would break AGENTS.md §5 twice in one row. The operator can strike this; no other task depends on it.
- **The section visibility editor is a Sheet with no actions.** Corlix uses a Dialog with a Done button. Edits apply as they are made, like the section label, so the close control is the only action. Only enabled fields can gate a section, as in corlix `FormBuilderPage.tsx:1932`.
- **`VisibilityRuleEditor` takes `{ rule, candidateFields, onChange }`,** corlix's props. A section is not a field, and today's props need one. The field editor passes every other field, so the "never offers the field itself" test moves to `FieldEditorSheet.test.tsx`.
- **The branch marker says "Conditional"**, corlix's `forms.visibility.marker`.
- **Ctrl+F gets its target.** The field search box gets `id="builder-field-search"`. One attribute, under ruling 2.
- **Phones keep single selection.** A phone has no Shift or Ctrl key. The docs say so. A touch selection mode would be new behavior corlix lacks.

## File map

| File | Change |
|---|---|
| `apps/studio/src/forms-builder/selection.ts` + test | new |
| `apps/studio/src/forms-builder/bulkActions.ts` + test | new |
| `apps/studio/src/forms-builder/listOrder.ts` + test | new, logic moved out of `FieldListPane.tsx` |
| `apps/studio/src/forms-builder/VisibilityMarker.tsx` + test | new |
| `apps/studio/src/forms-builder/field-editor/VisibilityRuleEditor.tsx` + test | props become `rule`, `candidateFields`, `onChange` |
| `apps/studio/src/forms-builder/FieldEditorSheet.tsx` + test | new call to the editor |
| `apps/studio/src/forms-builder/SectionVisibilitySheet.tsx` + test | new |
| `apps/studio/src/forms-builder/SectionsManager.tsx` + test | row `⋯`, marker |
| `apps/studio/src/forms-builder/BulkSelectionMenu.tsx` + test | new |
| `apps/studio/src/forms-builder/SectionDropPanel.tsx` + test | new |
| `apps/studio/src/forms-builder/SortableFieldRow.tsx` + test | marker, anchor, `data-row-label` |
| `apps/studio/src/forms-builder/FieldListPane.tsx` + test | model, search, selection, bulk menu, sheet, drop panel |
| `apps/studio/src/forms-builder/useBuilderKeyboard.ts` + new test | focus rule |
| `apps/studio/src/forms-builder/FormBuilderPage.tsx` + test | selection, bulk actions, keys, drop |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`, `apps/web/src/docs/0.1.8/forms.md` | two new sections |

---

### Task 0: Branch

- [ ] **Step 1**

```bash
git switch main
git switch -c feat/form-builder-s4
```

---

### Task 1: Selection and bulk helpers

**Files:**
- Create: `apps/studio/src/forms-builder/selection.ts`, `selection.test.ts`
- Create: `apps/studio/src/forms-builder/bulkActions.ts`, `bulkActions.test.ts`

**Interfaces:** Produces, for Tasks 5 to 7:
- `interface FieldSelection { ids: ReadonlySet<string>; anchor: string | null }`
- `NO_SELECTION: FieldSelection`
- `selectOnly(id: string): FieldSelection`
- `interface ClickModifiers { range: boolean; toggle: boolean }`
- `clickSelection(current: FieldSelection, id: string, order: readonly string[], mods: ClickModifiers): FieldSelection`
- `selectAllRows(current: FieldSelection, order: readonly string[]): FieldSelection`
- `moveAnchor(current: FieldSelection, order: readonly string[], delta: 1 | -1): FieldSelection`
- `withoutRows(current: FieldSelection, gone: ReadonlySet<string>): FieldSelection`
- `moveFieldsToSection(fields: readonly FormField[], ids: ReadonlySet<string>, sectionId: string | undefined): FormField[]`
- `toggleFieldsEnabled(fields: readonly FormField[], ids: ReadonlySet<string>): FormField[]`
- `deleteFields(fields: readonly FormField[], ids: ReadonlySet<string>): FormField[]`

- [ ] **Step 1: Failing tests.** Create `selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NO_SELECTION, clickSelection, moveAnchor, selectAllRows, selectOnly, withoutRows } from './selection';

const ORDER = ['a', 'b', 'c', 'd'];
const plain = { range: false, toggle: false };
const shift = { range: true, toggle: false };
const ctrl = { range: false, toggle: true };
const ids = (s: { ids: ReadonlySet<string> }) => [...s.ids].sort();

describe('clickSelection', () => {
  it('a plain click selects the row alone and anchors it', () => {
    const next = clickSelection({ ids: new Set(['a', 'b']), anchor: 'a' }, 'c', ORDER, plain);
    expect(ids(next)).toEqual(['c']);
    expect(next.anchor).toBe('c');
  });

  it('Shift-click selects from the anchor to the row, either way, and keeps the anchor', () => {
    expect(ids(clickSelection(selectOnly('b'), 'd', ORDER, shift))).toEqual(['b', 'c', 'd']);
    const up = clickSelection(selectOnly('c'), 'a', ORDER, shift);
    expect(ids(up)).toEqual(['a', 'b', 'c']);
    expect(up.anchor).toBe('c');
  });

  it('Shift-click with no anchor selects the row alone, as corlix does', () => {
    expect(clickSelection(NO_SELECTION, 'b', ORDER, shift)).toEqual(selectOnly('b'));
  });

  it('Shift-click on a row that is not drawn changes nothing', () => {
    const current = selectOnly('a');
    expect(clickSelection(current, 'hidden', ORDER, shift)).toBe(current);
  });

  it('Ctrl-click adds or removes the row and anchors it', () => {
    const added = clickSelection(selectOnly('a'), 'c', ORDER, ctrl);
    expect(ids(added)).toEqual(['a', 'c']);
    expect(added.anchor).toBe('c');
    expect(ids(clickSelection(added, 'a', ORDER, ctrl))).toEqual(['c']);
  });
});

describe('selectAllRows', () => {
  it('selects every drawn row and keeps the anchor', () => {
    const next = selectAllRows(selectOnly('b'), ORDER);
    expect(ids(next)).toEqual(ORDER);
    expect(next.anchor).toBe('b');
  });
});

describe('moveAnchor', () => {
  it('starts at the top going down and the bottom going up', () => {
    expect(moveAnchor(NO_SELECTION, ORDER, 1)).toEqual(selectOnly('a'));
    expect(moveAnchor(NO_SELECTION, ORDER, -1)).toEqual(selectOnly('d'));
  });

  it('moves one row and wraps at the ends', () => {
    expect(moveAnchor(selectOnly('b'), ORDER, 1)).toEqual(selectOnly('c'));
    expect(moveAnchor(selectOnly('d'), ORDER, 1)).toEqual(selectOnly('a'));
    expect(moveAnchor(selectOnly('a'), ORDER, -1)).toEqual(selectOnly('d'));
  });

  it('does nothing on an empty list', () => {
    expect(moveAnchor(NO_SELECTION, [], 1)).toBe(NO_SELECTION);
  });
});

describe('withoutRows', () => {
  it('drops the rows and clears the anchor only when it went too', () => {
    const current = { ids: new Set(['a', 'b', 'c']), anchor: 'b' };
    expect(withoutRows(current, new Set(['c']))).toEqual({ ids: new Set(['a', 'b']), anchor: 'b' });
    expect(withoutRows(current, new Set(['b'])).anchor).toBeNull();
  });
});
```

Create `bulkActions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FormField } from '@openldr/forms/pure';
import { deleteFields, moveFieldsToSection, toggleFieldsEnabled } from './bulkActions';

const f = (id: string, extra: Partial<FormField> = {}): FormField => ({
  id, displayLabel: id, fieldType: 'text', required: false, enabled: true, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null, ...extra,
});

describe('moveFieldsToSection', () => {
  it('moves the chosen fields into a section, or out of every section', () => {
    const fields = [f('a'), f('b', { section: 'old' }), f('c')];
    const moved = moveFieldsToSection(fields, new Set(['a', 'b']), 'vitals');
    expect(moved.map((x) => x.section)).toEqual(['vitals', 'vitals', undefined]);
    expect(moveFieldsToSection(moved, new Set(['a']), undefined)[0].section).toBeUndefined();
  });
});

describe('toggleFieldsEnabled', () => {
  it('switches all off when at least half are on', () => {
    const fields = [f('a'), f('b', { enabled: false })];
    expect(toggleFieldsEnabled(fields, new Set(['a', 'b'])).map((x) => x.enabled)).toEqual([false, false]);
  });

  it('switches all on when fewer than half are on', () => {
    const fields = [f('a'), f('b', { enabled: false }), f('c', { enabled: false })];
    expect(toggleFieldsEnabled(fields, new Set(['a', 'b', 'c'])).map((x) => x.enabled)).toEqual([true, true, true]);
  });

  it('toggles a single field', () => {
    expect(toggleFieldsEnabled([f('a')], new Set(['a']))[0].enabled).toBe(false);
    expect(toggleFieldsEnabled([f('a', { enabled: false })], new Set(['a']))[0].enabled).toBe(true);
  });

  it('leaves a locked field and fields outside the choice alone', () => {
    const fields = [f('a'), f('b', { locked: true }), f('c')];
    expect(toggleFieldsEnabled(fields, new Set(['a', 'b'])).map((x) => x.enabled)).toEqual([false, true, true]);
  });
});

describe('deleteFields', () => {
  it('removes the chosen fields and keeps a locked one', () => {
    const fields = [f('a'), f('b', { locked: true }), f('c')];
    expect(deleteFields(fields, new Set(['a', 'b'])).map((x) => x.id)).toEqual(['b', 'c']);
  });
});
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/selection.test.ts src/forms-builder/bulkActions.test.ts`. Expected: both files fail to resolve their module.

- [ ] **Step 3: Write `selection.ts`.**

```ts
/**
 * Which rows of the field list are selected, and the anchor: the row Shift-click ranges from and
 * `j` and `k` move. Pure. Ported from corlix `pages/FormBuilderPage.tsx:163-164,927-944,1726-1752`.
 */
export interface FieldSelection {
  ids: ReadonlySet<string>;
  anchor: string | null;
}

export const NO_SELECTION: FieldSelection = { ids: new Set<string>(), anchor: null };

export function selectOnly(id: string): FieldSelection {
  return { ids: new Set([id]), anchor: id };
}

export interface ClickModifiers {
  /** Shift was held. */
  range: boolean;
  /** Ctrl or Cmd was held. */
  toggle: boolean;
}

/**
 * The selection after a click on row `id`. `order` is every drawn row, top to bottom.
 *
 * Shift-click selects the rows between the anchor and the clicked row, and keeps the anchor. With no
 * anchor it falls through, as corlix does. When either row is not drawn, nothing changes. Ctrl or
 * Cmd-click adds or removes the row and anchors it. A plain click selects the row alone.
 */
export function clickSelection(
  current: FieldSelection,
  id: string,
  order: readonly string[],
  mods: ClickModifiers,
): FieldSelection {
  if (mods.range && current.anchor) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(id);
    if (from === -1 || to === -1) return current;
    const [lo, hi] = from < to ? [from, to] : [to, from];
    return { ids: new Set(order.slice(lo, hi + 1)), anchor: current.anchor };
  }
  if (mods.toggle) {
    const ids = new Set(current.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { ids, anchor: id };
  }
  return selectOnly(id);
}

/** Ctrl or Cmd-A: every drawn row. The anchor stays where it was, as in corlix. */
export function selectAllRows(current: FieldSelection, order: readonly string[]): FieldSelection {
  return { ids: new Set(order), anchor: current.anchor };
}

/** `j` and `k`: the anchor moves one row, wrapping at the ends, and becomes the only selected row. */
export function moveAnchor(current: FieldSelection, order: readonly string[], delta: 1 | -1): FieldSelection {
  if (order.length === 0) return current;
  const at = current.anchor ? order.indexOf(current.anchor) : -1;
  const next = at === -1 ? (delta === 1 ? 0 : order.length - 1) : (at + delta + order.length) % order.length;
  return selectOnly(order[next]);
}

/** The selection without some rows, after a delete. The anchor clears only when it went too. */
export function withoutRows(current: FieldSelection, gone: ReadonlySet<string>): FieldSelection {
  return {
    ids: new Set([...current.ids].filter((id) => !gone.has(id))),
    anchor: current.anchor && gone.has(current.anchor) ? null : current.anchor,
  };
}
```

- [ ] **Step 4: Write `bulkActions.ts`.**

```ts
import type { FormField } from '@openldr/forms/pure';

/**
 * What a bulk action does to the fields. Pure: each returns the new array, and the page makes each
 * call one undo step. Ported from corlix `pages/FormBuilderPage.tsx:620-648`.
 */

/** Each chosen field moves into one section, or out of every section when `sectionId` is undefined. */
export function moveFieldsToSection(
  fields: readonly FormField[],
  ids: ReadonlySet<string>,
  sectionId: string | undefined,
): FormField[] {
  return fields.map((f) => (ids.has(f.id) ? { ...f, section: sectionId } : f));
}

/**
 * Switch the chosen fields together, by corlix's majority rule: when at least half of the unlocked
 * ones are on, all of them go off, otherwise all go on. A locked field keeps its state.
 */
export function toggleFieldsEnabled(fields: readonly FormField[], ids: ReadonlySet<string>): FormField[] {
  const targets = fields.filter((f) => ids.has(f.id) && !f.locked);
  if (targets.length === 0) return [...fields];
  const onCount = targets.filter((f) => f.enabled).length;
  const next = onCount < targets.length / 2;
  const targetIds = new Set(targets.map((f) => f.id));
  return fields.map((f) => (targetIds.has(f.id) ? { ...f, enabled: next } : f));
}

/** Remove the chosen fields. A locked field stays, as it does for the single Delete. */
export function deleteFields(fields: readonly FormField[], ids: ReadonlySet<string>): FormField[] {
  return fields.filter((f) => !ids.has(f.id) || f.locked);
}
```

- [ ] **Step 5: Run, watch them pass.** Same command as Step 2. Expected: PASS.

- [ ] **Step 6: Commit.** `git add` the four files, then `git commit -m "feat(studio): decide what a multi-select and a bulk action do"`

---

### Task 2: The list's layout in one module

**Files:**
- Create: `apps/studio/src/forms-builder/listOrder.ts`, `listOrder.test.ts`
- Modify: `apps/studio/src/forms-builder/FieldListPane.tsx`

**Interfaces:**
- Consumes: `buildFieldTree` from `./fieldTree`.
- Produces: `matchesFieldSearch(field, query): boolean`, `interface SectionBucket`, `interface FieldListModel`, `buildFieldListModel(fields, sections, query): FieldListModel`, `drawnOrder(model): string[]`. `FieldListPane` gains optional `searchText?: string` and `onSearchTextChange?: (text: string) => void`.

This task moves logic and changes no behavior, so `FieldListPane.test.tsx` must pass unchanged at the end of it.

- [ ] **Step 1: Failing test.** Create `listOrder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FormField, FormSection } from '@openldr/forms/pure';
import { buildFieldListModel, drawnOrder, matchesFieldSearch } from './listOrder';

const f = (id: string, order: number, extra: Partial<FormField> = {}): FormField => ({
  id, displayLabel: id, fieldType: 'text', required: false, enabled: true, fhirPath: null,
  order, cardinality: { min: 0, max: '1' }, description: null, ...extra,
});
const slot = (id: string, order: number, system: string) =>
  f(id, order, { fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system } });

describe('matchesFieldSearch', () => {
  it('matches the label or the path, ignoring case, and everything on an empty query', () => {
    const field = f('Patient name', 0, { fhirPath: 'Patient.name' });
    expect(matchesFieldSearch(field, 'PATIENT')).toBe(true);
    expect(matchesFieldSearch(field, 'patient.na')).toBe(true);
    expect(matchesFieldSearch(field, 'zzz')).toBe(false);
    expect(matchesFieldSearch(field, '  ')).toBe(true);
  });
});

describe('drawnOrder', () => {
  it('puts group children under their group and a repeat at its first slot', () => {
    const fields = [
      f('g', 0, { fieldType: 'group' }), f('c1', 1, { groupId: 'g' }), f('c2', 2, { groupId: 'g' }),
      slot('s1', 3, 'a'), f('x', 4), slot('s2', 5, 'b'),
    ];
    expect(drawnOrder(buildFieldListModel(fields, [], ''))).toEqual(['g', 'c1', 'c2', 's1', 's2', 'x']);
  });

  it('follows section order, puts the unsectioned last and skips empty sections', () => {
    const sections: FormSection[] = [
      { id: 'one', label: 'One', order: 0 }, { id: 'two', label: 'Two', order: 1 }, { id: 'empty', label: 'Empty', order: 2 },
    ];
    const fields = [f('a', 0, { section: 'two' }), f('b', 1), f('c', 2, { section: 'one' })];
    const model = buildFieldListModel(fields, sections, '');
    expect(model.buckets.map((b) => b.label)).toEqual(['One', 'Two', 'No section']);
    expect(drawnOrder(model)).toEqual(['c', 'a', 'b']);
  });

  it('draws without headers, in plain order, when no sections exist and fields use one section id', () => {
    const model = buildFieldListModel([f('a', 0, { section: 'x' }), f('b', 1), f('c', 2, { section: 'x' })], [], '');
    expect(model.showSectionHeaders).toBe(false);
    expect(drawnOrder(model)).toEqual(['a', 'b', 'c']);
  });

  it('hides a child whose group the search leaves out, as the list does', () => {
    const fields = [f('g', 0, { fieldType: 'group' }), f('c1', 1, { groupId: 'g' })];
    expect(drawnOrder(buildFieldListModel(fields, [], 'c1'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, watch it fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/listOrder.test.ts`. Expected: fails to resolve `./listOrder`.

- [ ] **Step 3: Write `listOrder.ts`.** It is `FieldListPane.tsx:81-153` and `:209-218` moved out, with the search as an argument.

```ts
import type { FormField, FormSection } from '@openldr/forms/pure';
import { buildFieldTree } from './fieldTree';

/**
 * How the field list lays out its rows, in one place. The list draws from it, and the page walks
 * `drawnOrder` for Shift-click ranges and for `j` and `k`, so a key moves through the rows on screen.
 * Moved out of `FieldListPane.tsx` unchanged, apart from the search arriving as an argument.
 */

export interface SectionBucket {
  /** Null is the "No section" bucket. */
  sectionId: string | null;
  label: string;
  /** The bucket's top-level rows. Group children hang off their group instead. */
  fields: FormField[];
}

export interface FieldListModel {
  /** Every field the search keeps, sorted by order, group children included. */
  visible: FormField[];
  /** The visible children of each group, in order. */
  childrenByGroup: Map<string, FormField[]>;
  /** False when the list draws without headers. There is then one bucket, holding every top-level row. */
  showSectionHeaders: boolean;
  buckets: SectionBucket[];
}

/** Whether a field matches the list search: its label or FHIR path contains the query. */
export function matchesFieldSearch(field: FormField, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return field.displayLabel.toLowerCase().includes(q) || (field.fhirPath?.toLowerCase().includes(q) ?? false);
}

export function buildFieldListModel(
  fields: readonly FormField[],
  sections: readonly FormSection[],
  query: string,
): FieldListModel {
  const visible = fields.filter((f) => matchesFieldSearch(f, query)).sort((a, b) => a.order - b.order);
  const topLevel = visible.filter((f) => !f.groupId);

  const childrenByGroup = new Map<string, FormField[]>();
  for (const f of visible) {
    if (!f.groupId) continue;
    const list = childrenByGroup.get(f.groupId) ?? [];
    list.push(f);
    childrenByGroup.set(f.groupId, list);
  }

  // Headers show when the form defines sections, or when its fields use more than one section id.
  const distinct = new Set(fields.flatMap((f) => (f.section ? [f.section] : [])));
  const showSectionHeaders = sections.length > 0 || distinct.size > 1;
  if (!showSectionHeaders) {
    return { visible, childrenByGroup, showSectionHeaders, buckets: [{ sectionId: null, label: '', fields: topLevel }] };
  }

  const labels = new Map(sections.map((s) => [s.id, s.label]));
  const orderedIds: Array<string | null> = [...sections].sort((a, b) => a.order - b.order).map((s) => s.id);
  for (const f of topLevel) {
    if (f.section && !orderedIds.includes(f.section)) orderedIds.push(f.section);
  }
  if (topLevel.some((f) => !f.section)) orderedIds.push(null);

  const buckets: SectionBucket[] = [];
  for (const sectionId of orderedIds) {
    const bucketFields = topLevel.filter((f) => (sectionId === null ? !f.section : f.section === sectionId));
    if (bucketFields.length === 0) continue;
    const label = sectionId === null ? 'No section' : (labels.get(sectionId) ?? sectionId);
    buckets.push({ sectionId, label, fields: bucketFields });
  }
  return { visible, childrenByGroup, showSectionHeaders, buckets };
}

/** Row ids in the order the list draws them, top to bottom. */
export function drawnOrder(model: FieldListModel): string[] {
  const out: string[] = [];
  const walk = (field: FormField) => {
    out.push(field.id);
    if (field.fieldType !== 'group') return;
    for (const child of model.childrenByGroup.get(field.id) ?? []) walk(child);
  };
  for (const bucket of model.buckets) {
    for (const node of buildFieldTree(bucket.fields)) {
      if (node.kind === 'field') walk(node.field);
      else node.slots.forEach(walk);
    }
  }
  return out;
}
```

- [ ] **Step 4: Make `FieldListPane` draw from it.** In `FieldListPane.tsx`:
- Add `import { buildFieldListModel } from './listOrder';`.
- Add to `FieldListPaneProps`:

```ts
  /** The list search, when the page drives it. The list keeps its own when these are absent. */
  searchText?: string;
  onSearchTextChange?: (text: string) => void;
```

- Destructure `searchText` and `onSearchTextChange`.
- Replace `const [searchText, setSearchText] = useState('');` with:

```ts
  const [localSearch, setLocalSearch] = useState('');
  const search = searchText ?? localSearch;
  const setSearch = onSearchTextChange ?? setLocalSearch;
```

- Delete `sectionLabelMap`, `visibleFields`, `topLevelVisible`, `childrenByGroup`, `sectionGroups`, `distinctSections` and `showSectionHeaders`. Keep `enabledCount`. Add:

```ts
  const model = useMemo(() => buildFieldListModel(fields, sections, search), [fields, sections, search]);
```

- In `renderField`, change `childrenByGroup.get(field.id)` to `model.childrenByGroup.get(field.id)`.
- On the search `Input`, set `value={search}` and `onChange={(e) => setSearch(e.target.value)}`.
- `SortableContext` gets `items={model.visible.map((f) => f.id)}`.
- The body becomes:

```tsx
            {model.showSectionHeaders ? (
              model.buckets.map(({ sectionId, label, fields: fieldList }) => (
                <div key={sectionId ?? '__no_section__'}>
                  <div className="px-1 py-1 mt-1 first:mt-0">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {label}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {buildFieldTree(fieldList).map(renderNode)}
                  </div>
                </div>
              ))
            ) : (
              // No sections: top-level nodes; children render under their group.
              <div className="space-y-1.5">{buildFieldTree(model.buckets[0]?.fields ?? []).map(renderNode)}</div>
            )}
```

- [ ] **Step 5: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`. Expected: PASS, with `FieldListPane.test.tsx` unchanged. Then `pnpm --filter @openldr/studio typecheck > /tmp/s4-t2-tc.txt 2>&1; echo "exit=$?"`, expecting `exit=0`.

- [ ] **Step 6: Commit.** `git commit -m "refactor(studio): lay out the field list from one module the page can walk"`

---

### Task 3: The rule editor takes a rule, and a Conditional marker

**Files:**
- Modify: `apps/studio/src/forms-builder/field-editor/VisibilityRuleEditor.tsx`, and replace `VisibilityRuleEditor.test.tsx`
- Modify: `apps/studio/src/forms-builder/FieldEditorSheet.tsx:401-405` and `FieldEditorSheet.test.tsx`
- Create: `apps/studio/src/forms-builder/VisibilityMarker.tsx`, `VisibilityMarker.test.tsx`
- Modify: `apps/studio/src/forms-builder/SortableFieldRow.tsx` and its test

**Interfaces:** Produces `VisibilityRuleEditor({ rule, candidateFields, onChange })` with `onChange: (rule: VisibilityRule | undefined) => void`, and `VisibilityMarker({ rule }: { rule: VisibilityRule | undefined })`.

- [ ] **Step 1: Failing tests.** Replace `VisibilityRuleEditor.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField, VisibilityRule } from '@openldr/forms/pure';
import { VisibilityRuleEditor } from './VisibilityRuleEditor';

const field = (id: string, displayLabel: string): FormField => ({
  id, displayLabel, fieldType: 'text', required: false, enabled: true, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
});
const SEX = field('sex', 'Sex');
const DOB = field('dob', 'Date of Birth');

function renderEditor(rule?: VisibilityRule, candidateFields: FormField[] = [SEX, DOB]) {
  const onChange = vi.fn();
  render(<VisibilityRuleEditor rule={rule} candidateFields={candidateFields} onChange={onChange} />);
  return { onChange };
}

const IS_SET: VisibilityRule = { combinator: 'all', conditions: [{ fieldId: 'sex', operator: 'isNotEmpty' }] };
const EQUALS: VisibilityRule = { combinator: 'all', conditions: [{ fieldId: 'sex', operator: 'equals', value: '' }] };

describe('VisibilityRuleEditor', () => {
  it('offers all and any', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('combobox', { name: /combinator/i }));
    expect(screen.getAllByText('all').length).toBeGreaterThan(0);
    expect(screen.getAllByText('any').length).toBeGreaterThan(0);
  });

  it('Add condition starts a rule on the first candidate', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith({ combinator: 'all', conditions: [{ fieldId: 'sex', operator: 'isNotEmpty' }] });
  });

  it('offers only the candidate fields', () => {
    renderEditor(IS_SET, [SEX]);
    fireEvent.click(screen.getByRole('combobox', { name: /controlling field/i }));
    expect(screen.queryAllByRole('option', { name: 'Date of Birth' })).toHaveLength(0);
  });

  it('changes the controlling field', () => {
    const { onChange } = renderEditor(IS_SET);
    fireEvent.click(screen.getByRole('combobox', { name: /controlling field/i }));
    fireEvent.click(screen.getByText('Date of Birth'));
    expect((onChange.mock.calls[0][0] as VisibilityRule).conditions[0].fieldId).toBe('dob');
  });

  it('changes the operator', () => {
    const { onChange } = renderEditor(IS_SET);
    fireEvent.click(screen.getByRole('combobox', { name: /operator/i }));
    fireEvent.click(screen.getByText('equals'));
    expect((onChange.mock.calls[0][0] as VisibilityRule).conditions[0].operator).toBe('equals');
  });

  it('hides the value box for isEmpty and isNotEmpty', () => {
    renderEditor(IS_SET);
    expect(screen.queryByRole('textbox', { name: /value/i })).toBeNull();
  });

  it('changes the value', () => {
    const { onChange } = renderEditor(EQUALS);
    fireEvent.change(screen.getByRole('textbox', { name: /value/i }), { target: { value: 'male' } });
    expect((onChange.mock.calls[0][0] as VisibilityRule).conditions[0].value).toBe('male');
  });

  it('removing the last condition clears the rule', () => {
    const { onChange } = renderEditor(IS_SET);
    fireEvent.click(screen.getByRole('button', { name: /remove condition/i }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
```

Append inside the outer `describe('FieldEditorSheet', …)` in `FieldEditorSheet.test.tsx`:

```tsx
  it('never offers the field itself as a visibility condition', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    fireEvent.click(screen.getByRole('combobox', { name: /controlling field/i }));
    expect(screen.queryAllByRole('option', { name: 'Patient name' })).toHaveLength(0);
    expect(screen.getAllByRole('option', { name: 'Demographics' }).length).toBeGreaterThan(0);
  });
```

Create `VisibilityMarker.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisibilityMarker } from './VisibilityMarker';

describe('VisibilityMarker', () => {
  it('marks a rule with conditions as Conditional', () => {
    render(<VisibilityMarker rule={{ combinator: 'all', conditions: [{ fieldId: 'x', operator: 'isNotEmpty' }] }} />);
    expect(screen.getByRole('img', { name: 'Conditional' })).toBeTruthy();
  });

  it('draws nothing with no rule or an empty one', () => {
    const { container, rerender } = render(<VisibilityMarker rule={undefined} />);
    expect(container.firstChild).toBeNull();
    rerender(<VisibilityMarker rule={{ combinator: 'all', conditions: [] }} />);
    expect(container.firstChild).toBeNull();
  });
});
```

In `SortableFieldRow.test.tsx`, add:

```tsx
  it('shows the Conditional marker on a field with a visibility rule', () => {
    renderRow({ field: { ...FIELD, visibility: { combinator: 'all', conditions: [{ fieldId: 'x', operator: 'isNotEmpty' }] } } });
    expect(screen.getByRole('img', { name: 'Conditional' })).toBeTruthy();
  });
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/field-editor/VisibilityRuleEditor.test.tsx src/forms-builder/FieldEditorSheet.test.tsx src/forms-builder/VisibilityMarker.test.tsx src/forms-builder/SortableFieldRow.test.tsx`.

- [ ] **Step 3: Change the editor's props.** In `VisibilityRuleEditor.tsx`, replace `VisibilityRuleEditorProps`, the function head, and the old `candidateFields`, `rule`, `combinator`, `conditions` and `emit` lines with:

```tsx
export interface VisibilityRuleEditorProps {
  rule: VisibilityRule | undefined;
  /** The fields a condition can read. The caller leaves out the field being edited. */
  candidateFields: FormField[];
  onChange: (rule: VisibilityRule | undefined) => void;
}

/** A visibility rule for a field or a section. Corlix's props, `components/VisibilityRuleEditor.tsx:40-48`. */
export function VisibilityRuleEditor({
  rule,
  candidateFields,
  onChange,
}: VisibilityRuleEditorProps): JSX.Element {
  const combinator = rule?.combinator ?? 'all';
  const conditions = rule?.conditions ?? [];

  const emit = (next: VisibilityCondition[], comb: 'all' | 'any' = combinator) => {
    onChange(next.length === 0 ? undefined : { combinator: comb, conditions: next });
  };
```

The rest of the file does not change.

In `FieldEditorSheet.tsx`, replace the `<VisibilityRuleEditor … />` call with:

```tsx
          <VisibilityRuleEditor
            rule={activeDraft.visibility}
            candidateFields={allFields.filter((f) => f.id !== activeDraft.id)}
            onChange={(visibility) => patchDraft({ visibility })}
          />
```

- [ ] **Step 4: Write `VisibilityMarker.tsx`.**

```tsx
import { GitBranch } from 'lucide-react';
import type { VisibilityRule } from '@openldr/forms/pure';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Marks a field or section that shows only when its conditions hold. Corlix draws it on field rows
 * (`FieldRow.tsx:273`) and section rows (`SectionListRow.tsx:55`). Radix tooltips do not open on
 * touch, hence the aria-label, as on the repeat marker.
 */
export function VisibilityMarker({ rule }: { rule: VisibilityRule | undefined }): JSX.Element | null {
  if (!rule || rule.conditions.length === 0) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label="Conditional"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
          >
            <GitBranch className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Conditional</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

In `SortableFieldRow.tsx`, import it and render `<VisibilityMarker rule={field.visibility} />` directly after the lint marker block, before the repeat marker.

- [ ] **Step 5: Run, watch them pass.** Same command as Step 2, then `pnpm --filter @openldr/studio exec vitest run src/forms-builder`. Expected: PASS.

- [ ] **Step 6: Commit.** `git commit -m "feat(studio): mark a field that shows only under conditions"`

---

### Task 4: Section visibility

**Files:**
- Modify: `apps/studio/src/forms-builder/SectionsManager.tsx` and its test
- Create: `apps/studio/src/forms-builder/SectionVisibilitySheet.tsx`, `SectionVisibilitySheet.test.tsx`
- Modify: `apps/studio/src/forms-builder/FieldListPane.tsx` and its test

**Interfaces:**
- Consumes: `VisibilityRuleEditor`, `VisibilityMarker` from Task 3.
- Produces: `SectionsManagerProps.onEditVisibility?: (sectionId: string) => void`. `SectionVisibilitySheet({ section, fields, onChange, onOpenChange })`, where `onChange: (sectionId: string, rule: VisibilityRule | undefined) => void`.

- [ ] **Step 1: Failing tests.** In `SectionsManager.test.tsx`, add after `renderManager`:

```tsx
function openRowMenu(label: string) {
  const trigger = screen.getByRole('button', { name: `Actions for section ${label}` });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
}
```

Replace the four tests from `'deletes the section and calls onFieldsClearSection when delete is clicked'` to the end of the file with:

```tsx
  it('deletes the section from its ⋯ menu and clears it from the fields', () => {
    const { onChange, onFieldsClearSection } = renderManager();
    openRowMenu('Main');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections).toHaveLength(0);
    expect(onFieldsClearSection).toHaveBeenCalledWith('main');
  });

  it('moves a section down from its ⋯ menu', () => {
    const second: FormSection = { id: 'extra', label: 'Extra', order: 1 };
    const { onChange } = renderManager([MAIN, second]);
    openRowMenu('Main');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections.map((s) => [s.id, s.order])).toEqual([['extra', 0], ['main', 1]]);
  });

  it('moves a section up from its ⋯ menu', () => {
    const second: FormSection = { id: 'extra', label: 'Extra', order: 1 };
    const { onChange } = renderManager([MAIN, second]);
    openRowMenu('Extra');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections.find((s) => s.id === 'extra')!.order).toBe(0);
  });

  it('disables Move up on the first section and Move down on the last', () => {
    renderManager([MAIN, { id: 'extra', label: 'Extra', order: 1 }]);
    openRowMenu('Main');
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('data-disabled');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    openRowMenu('Extra');
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toHaveAttribute('data-disabled');
  });

  it('hands Edit visibility back with the section id', () => {
    const onEditVisibility = vi.fn();
    render(<SectionsManager sections={[MAIN]} onChange={vi.fn()} onFieldsClearSection={vi.fn()} onEditVisibility={onEditVisibility} />);
    openRowMenu('Main');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit visibility' }));
    expect(onEditVisibility).toHaveBeenCalledWith('main');
  });

  it('marks a section that has a rule', () => {
    renderManager([{ ...MAIN, visibility: { combinator: 'all', conditions: [{ fieldId: 'x', operator: 'isNotEmpty' }] } }]);
    expect(screen.getByRole('img', { name: 'Conditional' })).toBeTruthy();
  });
});
```

Create `SectionVisibilitySheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField, FormSection } from '@openldr/forms/pure';
import { SectionVisibilitySheet } from './SectionVisibilitySheet';

const field = (id: string, displayLabel: string, enabled = true): FormField => ({
  id, displayLabel, fieldType: 'text', required: false, enabled, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
});
const VITALS: FormSection = { id: 'vitals', label: 'Vitals', order: 0 };

describe('SectionVisibilitySheet', () => {
  it('is titled Visibility and names the section', () => {
    render(<SectionVisibilitySheet section={VITALS} fields={[]} onChange={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Visibility' })).toHaveTextContent('Show Vitals only when');
  });

  it('builds the rule from enabled fields only', () => {
    const onChange = vi.fn();
    render(
      <SectionVisibilitySheet
        section={VITALS}
        fields={[field('notes', 'Notes', false), field('fever', 'Fever')]}
        onChange={onChange}
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith('vitals', { combinator: 'all', conditions: [{ fieldId: 'fever', operator: 'isNotEmpty' }] });
  });

  it('renders nothing with no section', () => {
    render(<SectionVisibilitySheet section={null} fields={[]} onChange={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```

In `FieldListPane.test.tsx`, add:

```tsx
  it('Edit visibility on a section opens a sheet that writes the rule to the section', () => {
    const { onSectionsChange } = renderPane();
    fireEvent.click(screen.getByRole('button', { name: /Sections \(2\)/ }));
    const trigger = screen.getByRole('button', { name: 'Actions for section Main Section' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit visibility' }));
    expect(screen.getByRole('dialog', { name: 'Visibility' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    const [sections] = onSectionsChange.mock.calls[0] as [FormSection[]];
    expect(sections.find((s) => s.id === 'main')!.visibility?.conditions[0].fieldId).toBe('f-1');
  });
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/SectionsManager.test.tsx src/forms-builder/SectionVisibilitySheet.test.tsx src/forms-builder/FieldListPane.test.tsx`.

- [ ] **Step 3: The section row menu.** In `SectionsManager.tsx`:
- Replace the `ChevronUp, ChevronDown, Trash2` import with `import { MoreHorizontal } from 'lucide-react';`. Import `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`, `DropdownMenuTrigger` from `@/components/ui/dropdown-menu`, and `VisibilityMarker` from `./VisibilityMarker`.
- Add `onEditVisibility?: (sectionId: string) => void;` to the props and destructure it.
- Replace the three buttons in each row with:

```tsx
            <VisibilityMarker rule={section.visibility} />

            {/* Every row action in one ⋯, per AGENTS.md §5. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  aria-label={`Actions for section ${section.label}`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEditVisibility && (
                  <DropdownMenuItem onSelect={() => onEditVisibility(section.id)}>Edit visibility</DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={index === 0} onSelect={() => handleMove(index, 'up')}>
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === sorted.length - 1} onSelect={() => handleMove(index, 'down')}>
                  Move down
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => handleDelete(section.id)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
```

- [ ] **Step 4: Write `SectionVisibilitySheet.tsx`.**

```tsx
import type { FormField, FormSection, VisibilityRule } from '@openldr/forms/pure';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { VisibilityRuleEditor } from './field-editor/VisibilityRuleEditor';

/**
 * A section's visibility rule. Data entry already honours it (`packages/forms/src/visibility.ts:97`),
 * so this is the builder's missing piece. Edits apply as they are made, like the section label, so
 * the sheet has no actions and its close control is the only one. Corlix uses a Dialog with a Done
 * button; AGENTS.md §5 wants a Sheet. Only enabled fields can gate a section, as in corlix
 * `FormBuilderPage.tsx:1932`.
 */
export function SectionVisibilitySheet({
  section,
  fields,
  onChange,
  onOpenChange,
}: {
  section: FormSection | null;
  fields: FormField[];
  onChange: (sectionId: string, rule: VisibilityRule | undefined) => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Sheet open={section !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>Visibility</SheetTitle>
          <SheetDescription>
            {section
              ? `Show ${section.label} only when conditions on other fields are met. No conditions means always visible.`
              : ''}
          </SheetDescription>
        </SheetHeader>
        {section && (
          <div className="px-6">
            <VisibilityRuleEditor
              rule={section.visibility}
              candidateFields={fields.filter((f) => f.enabled)}
              onChange={(rule) => onChange(section.id, rule)}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Wire it in `FieldListPane`.** Import `SectionVisibilitySheet`. Add:

```ts
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [visibilitySectionId, setVisibilitySectionId] = useState<string | null>(null);
```

- Give the Sections `Popover` `open={sectionsOpen}` and `onOpenChange={setSectionsOpen}`.
- Pass `SectionsManager` `onEditVisibility={(id) => { setSectionsOpen(false); setVisibilitySectionId(id); }}`. The popover closes first. The sheet must live outside it: when the popover closes, its content unmounts, and a sheet inside would go with it.
- After the field list `div`, still inside the root `div`, render:

```tsx
      <SectionVisibilitySheet
        section={sections.find((s) => s.id === visibilitySectionId) ?? null}
        fields={fields}
        onChange={(id, rule) =>
          onSectionsChange?.(sections.map((s) => (s.id === id ? { ...s, visibility: rule } : s)))
        }
        onOpenChange={(open) => { if (!open) setVisibilitySectionId(null); }}
      />
```

`onSectionsChange` reaches the page's `updateSchema`, which records history as the section label does.

- [ ] **Step 6: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`. Expected: PASS.

- [ ] **Step 7: Commit.** `git commit -m "feat(studio): edit a section's visibility rule from its ⋯ menu"`

---

### Task 5: Select many fields

**Files:**
- Create: `apps/studio/src/forms-builder/BulkSelectionMenu.tsx`, `BulkSelectionMenu.test.tsx`
- Modify: `SortableFieldRow.tsx` and its test, `FieldListPane.tsx` and its test, `FormBuilderPage.tsx` and its test

**Interfaces:**
- Consumes: Task 1's selection and bulk helpers, Task 2's `buildFieldListModel` and `drawnOrder`.
- Produces: `FieldListPaneProps` loses `selectedFieldId` and gains `selectedIds: ReadonlySet<string>`, `anchorId?: string | null`, `onBulkMove?`, `onBulkToggleEnabled?`, `onBulkDelete?`, `onClearSelection?`. `SortableFieldRowProps.anchor?: boolean`. `BulkSelectionMenu({ count, sections, onMove, onToggleEnabled, onDelete, onClear })`. In the page: `editingId`, `selection`, `searchText`, `listOrder`, `openEditor`, `handleRowClick`, `bulkMove`, `bulkToggle`, `bulkDelete`, `confirmBulkDeleteOpen`.

- [ ] **Step 1: Failing tests.** Create `BulkSelectionMenu.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkSelectionMenu } from './BulkSelectionMenu';

function setup() {
  const props = { onMove: vi.fn(), onToggleEnabled: vi.fn(), onDelete: vi.fn(), onClear: vi.fn() };
  render(<BulkSelectionMenu count={3} sections={[{ id: 'vitals', label: 'Vitals', order: 0 }]} {...props} />);
  const trigger = screen.getByRole('button', { name: 'Selection actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
  return props;
}

describe('BulkSelectionMenu', () => {
  it('shows the count', () => {
    setup();
    expect(screen.getByText('3 selected')).toBeTruthy();
  });

  it('moves to a section', () => {
    const { onMove } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Vitals' }));
    expect(onMove).toHaveBeenCalledWith('vitals');
  });

  it('moves out of every section', () => {
    const { onMove } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to (no section)' }));
    expect(onMove).toHaveBeenCalledWith(undefined);
  });

  it('hands back Toggle enabled', () => {
    const { onToggleEnabled } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Toggle enabled' }));
    expect(onToggleEnabled).toHaveBeenCalled();
  });

  it('hands back Delete', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('hands back Clear selection', () => {
    const { onClear } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalled();
  });
});
```

In `SortableFieldRow.test.tsx`, add:

```tsx
  it('marks the anchor row with a left rule', () => {
    renderRow({ anchor: true });
    expect(screen.getByText('Patient name').closest('[data-sortable-card]')?.className).toContain('border-l-primary');
  });
```

In `FieldListPane.test.tsx`: change `selectedFieldId={null}` in `renderPane` to `selectedIds={new Set<string>()}`. Change the test `'applies selected styling when selectedFieldId matches'` to call `renderPane({ selectedIds: new Set(['f-1']) })`. Add:

```tsx
  it('shows the count and a selection menu once two fields are selected', () => {
    renderPane({ selectedIds: new Set(['f-1', 'f-2']) });
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Selection actions' })).toBeTruthy();
    expect(screen.queryByText('3 fields (2 enabled)')).toBeNull();
  });

  it('keeps the field count with one field selected', () => {
    renderPane({ selectedIds: new Set(['f-1']) });
    expect(screen.getByText('3 fields (2 enabled)')).toBeTruthy();
  });
```

In `FormBuilderPage.test.tsx`: add `within` to the Testing Library import, and add `import type { FormField, FormSection } from '@openldr/forms/pure';`. Add these helpers after `renderBuilderAs`:

```tsx
const field = (id: string, displayLabel: string, order: number, extra: Partial<FormField> = {}): FormField => ({
  id, displayLabel, fieldType: 'text', required: false, enabled: true, fhirPath: null,
  order, cardinality: { min: 0, max: '1' }, description: null, ...extra,
});
const THREE = [field('a', 'Alpha', 0), field('b', 'Bravo', 1), field('c', 'Charlie', 2)];

/** Load the builder on a stored form holding these fields and sections. */
async function renderBuilderWith(fields: FormField[], sections: FormSection[] = []) {
  const base = makeFormDef();
  vi.spyOn(api, 'getForm').mockResolvedValue(
    makeFormDef({ schema: { ...base.schema, fields, sections } }) as never,
  );
  vi.spyOn(api, 'listFormVersions').mockResolvedValue([]);
  render(
    <MemoryRouter initialEntries={['/forms/form-1/builder']}>
      <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('button', { name: `Edit field ${fields[0].displayLabel}` });
}

const row = (label: string) => screen.getByRole('button', { name: `Edit field ${label}` });

/** How many rows are switched on, read from their checkboxes. The header shows a count only with one or no row selected. */
const enabledRows = () =>
  screen
    .getAllByRole('checkbox', { name: /^Toggle enabled for / })
    .filter((c) => c.getAttribute('aria-checked') === 'true').length;

function openSelectionMenu() {
  const trigger = screen.getByRole('button', { name: 'Selection actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
}
```

And these tests:

```tsx
  it('a plain click opens the editor for that field', async () => {
    await renderBuilderWith(THREE);
    fireEvent.click(row('Bravo'));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Bravo');
  });

  it('Ctrl-click then Shift-click selects a range, and neither opens the editor', async () => {
    await renderBuilderWith(THREE);
    fireEvent.click(row('Alpha'), { ctrlKey: true });
    fireEvent.click(row('Charlie'), { shiftKey: true });
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Ctrl-click adds a field and takes it out again', async () => {
    await renderBuilderWith(THREE);
    fireEvent.click(row('Alpha'), { ctrlKey: true });
    fireEvent.click(row('Bravo'), { ctrlKey: true });
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(row('Bravo'), { ctrlKey: true });
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('Toggle enabled switches the selection off together, as one undo step', async () => {
    await renderBuilderWith(THREE);
    fireEvent.click(row('Alpha'), { ctrlKey: true });
    fireEvent.click(row('Charlie'), { shiftKey: true });
    openSelectionMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Toggle enabled' }));
    expect(enabledRows()).toBe(0);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(enabledRows()).toBe(3);
  });

  it('Move to a section moves the whole selection', async () => {
    await renderBuilderWith(THREE, [{ id: 'vitals', label: 'Vitals', order: 0 }]);
    fireEvent.click(row('Alpha'), { ctrlKey: true });
    fireEvent.click(row('Charlie'), { shiftKey: true });
    openSelectionMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Vitals' }));
    expect(screen.queryByText('No section')).toBeNull();
    expect(screen.getAllByText('vitals')).toHaveLength(3);
  });

  it('Delete asks first, then removes the selection and keeps a locked field', async () => {
    await renderBuilderWith([field('a', 'Alpha', 0), field('b', 'Bravo', 1, { locked: true }), field('c', 'Charlie', 2)]);
    fireEvent.click(row('Alpha'), { ctrlKey: true });
    fireEvent.click(row('Charlie'), { shiftKey: true });
    openSelectionMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Delete 3 fields?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('1 fields (1 enabled)')).toBeInTheDocument();
    expect(row('Bravo')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/BulkSelectionMenu.test.tsx src/forms-builder/SortableFieldRow.test.tsx src/forms-builder/FieldListPane.test.tsx src/forms-builder/FormBuilderPage.test.tsx`.

- [ ] **Step 3: Write `BulkSelectionMenu.tsx`.**

```tsx
import { MoreHorizontal } from 'lucide-react';
import type { FormSection } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The list header while two or more fields are selected: the count and one ⋯ menu. Corlix shows
 * standalone buttons here (`components/FieldBulkActionBar.tsx`); AGENTS.md §5 puts them in the menu.
 * The move targets are flat items, not a submenu, which jsdom cannot open reliably and a phone reads
 * badly.
 */
export function BulkSelectionMenu({
  count,
  sections,
  onMove,
  onToggleEnabled,
  onDelete,
  onClear,
}: {
  count: number;
  sections: FormSection[];
  onMove: (sectionId: string | undefined) => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <p className="text-xs font-medium text-foreground">{`${count} selected`}</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Selection actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onMove(undefined)}>Move to (no section)</DropdownMenuItem>
          {sections.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => onMove(s.id)}>{`Move to ${s.label}`}</DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onToggleEnabled()}>Toggle enabled</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete()}>
            Delete
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onClear()}>Clear selection</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 4: The row.** In `SortableFieldRow.tsx`, add `/** The row Shift-click ranges from and j and k move. */ anchor?: boolean;` to the props, destructure it with default `false`, and append `${anchor ? 'border-l-2 border-l-primary' : ''}` to the card's class string. That is corlix `FieldRow.tsx:159`.

- [ ] **Step 5: The list.** In `FieldListPane.tsx`:
- Import `BulkSelectionMenu`.
- In `FieldListPaneProps`, replace `selectedFieldId: string | null;` with:

```ts
  /** The selected rows. Two or more turn the header into the selection menu. */
  selectedIds: ReadonlySet<string>;
  /** The row Shift-click ranges from and j and k move. */
  anchorId?: string | null;
  onBulkMove?: (sectionId: string | undefined) => void;
  onBulkToggleEnabled?: () => void;
  onBulkDelete?: () => void;
  onClearSelection?: () => void;
```

- Destructure them, with `anchorId = null`.
- Add `const sortedSections = useMemo(() => [...sections].sort((a, b) => a.order - b.order), [sections]);`.
- In `renderField`, pass `selected={selectedIds.has(field.id)}` and `anchor={field.id === anchorId}`.
- Replace the counter `<p>` with:

```tsx
        <div className="flex min-h-7 items-center">
          {selectedIds.size >= 2 ? (
            <BulkSelectionMenu
              count={selectedIds.size}
              sections={sortedSections}
              onMove={(sectionId) => onBulkMove?.(sectionId)}
              onToggleEnabled={() => onBulkToggleEnabled?.()}
              onDelete={() => onBulkDelete?.()}
              onClear={() => onClearSelection?.()}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {fields.length} fields ({enabledCount} enabled)
            </p>
          )}
        </div>
```

- [ ] **Step 6: The page.** In `FormBuilderPage.tsx`:
- Change the React import to `import { type MouseEvent, useEffect, useMemo, useState } from 'react';`. Add:

```ts
import { NO_SELECTION, clickSelection, selectOnly, withoutRows, type FieldSelection } from './selection';
import { deleteFields, moveFieldsToSection, toggleFieldsEnabled } from './bulkActions';
import { buildFieldListModel, drawnOrder } from './listOrder';
```

- Replace `const [selectedId, setSelectedId] = useState<string | null>(null);` with:

```ts
  /** The field open in the editor. A plain click sets it; a Shift or Ctrl-click does not. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selection, setSelection] = useState<FieldSelection>(NO_SELECTION);
  const [searchText, setSearchText] = useState('');
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);
```

- In `selectedField`, use `editingId` in place of `selectedId`, in the find and the dependency list.
- Below `selectedField`, add:

```ts
  /** Row ids in the order the list draws them. Shift-click ranges and j and k walk this. */
  const listOrder = useMemo(
    () => drawnOrder(buildFieldListModel(schema.fields, schema.sections, searchText)),
    [schema.fields, schema.sections, searchText],
  );

  /** Select one field and open its editor. */
  const openEditor = (id: string) => {
    setSelection(selectOnly(id));
    setEditingId(id);
  };
```

- Replace each use of the old state:

| Where | Was | Becomes |
|---|---|---|
| `addField` | `setSelectedId(field.id);` | `openEditor(field.id);` |
| `handleSheetSave` | `setSelectedId(null);` | `setEditingId(null);` |
| `handleSheetCancel` | `pendingNewFieldId === selectedId` | `pendingNewFieldId === editingId` |
| `handleSheetCancel`, inside the `if`, after `setSchema` | nothing | `const gone = pendingNewFieldId; setSelection((s) => withoutRows(s, new Set([gone])));` |
| `handleSheetCancel`, last line | `setSelectedId(null);` | `setEditingId(null);` |
| `deleteField` | `if (selectedId === fieldId) setSelectedId(null);` | `if (editingId === fieldId) setEditingId(null);` then `setSelection((s) => withoutRows(s, new Set([fieldId])));` |
| `duplicateField` | `setSelectedId(copy.id);` | `openEditor(copy.id);` |
| `addNamedSlot` | `setSelectedId(slot.id);` | `openEditor(slot.id);` |
| `openField` | `setSelectedId(id);` | `openEditor(id);` |
| `addGroupPart` | `setSelectedId(part.id);` | `openEditor(part.id);` |
| `addFromLibrary` | `setSelectedId(field.id);` | `openEditor(field.id);` |
| `useBuilderKeyboard` | `remove: () => { if (selectedId) deleteField(selectedId); },` | `remove: () => { if (editingId) deleteField(editingId); },` (Task 6 replaces it) |
| `useBuilderKeyboard` | `clear: () => setSelectedId(null),` | `clear: () => setEditingId(null),` (Task 6 replaces it) |
| `FieldEditorSheet` | `open={selectedId !== null}` | `open={editingId !== null}` |

- Change `applyHistory` to clear the selection, as corlix does:

```ts
  const applyHistory = (next: FormSchema | null) => {
    if (!next) return;
    setSchema(next);
    setSelection(NO_SELECTION);
  };
```

- After `addFromLibrary`, add:

```ts
  /**
   * A click on a row. Only a plain click opens the editor. A Shift or Ctrl-click that opened it would
   * put the editor's overlay over the list, and no second row could be clicked. Corlix has exactly
   * that problem; its own e2e says so (`apps/desktop/e2e/screenshots.spec.ts:366`).
   */
  const handleRowClick = (field: FormField, e: MouseEvent) => {
    const mods = { range: e.shiftKey, toggle: e.metaKey || e.ctrlKey };
    setSelection((s) => clickSelection(s, field.id, listOrder, mods));
    if (!mods.range && !mods.toggle) setEditingId(field.id);
  };

  /** Move the selection to a section, or out of every section. One undo step. */
  const bulkMove = (sectionId: string | undefined) => {
    if (selection.ids.size === 0) return;
    history.pushHistory();
    const ids = selection.ids;
    setSchema((prev) => ({ ...prev, fields: moveFieldsToSection(prev.fields, ids, sectionId) }));
  };

  /** Switch a set of fields on or off together. One undo step. Locked fields keep their state. */
  const bulkToggle = (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    history.pushHistory();
    setSchema((prev) => ({ ...prev, fields: toggleFieldsEnabled(prev.fields, ids) }));
  };

  /** Delete the selection, after the confirm. One undo step. Locked fields stay. */
  const bulkDelete = () => {
    history.pushHistory();
    const ids = selection.ids;
    setSchema((prev) => ({ ...prev, fields: deleteFields(prev.fields, ids) }));
    if (editingId && ids.has(editingId)) setEditingId(null);
    setSelection(NO_SELECTION);
  };
```

- In the `FieldListPane` element built in `listPane`, replace `selectedFieldId={selectedId}` and `onSelect={(f) => setSelectedId(f.id)}` with:

```tsx
        selectedIds={selection.ids}
        anchorId={selection.anchor}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        onSelect={handleRowClick}
        onBulkMove={bulkMove}
        onBulkToggleEnabled={() => bulkToggle(selection.ids)}
        onBulkDelete={() => setConfirmBulkDeleteOpen(true)}
        onClearSelection={() => setSelection(NO_SELECTION)}
```

- Next to the existing `ConfirmDialog`, add:

```tsx
      {/* A confirm prompt, which AGENTS.md §5 allows as a Dialog. */}
      <ConfirmDialog
        open={confirmBulkDeleteOpen}
        onOpenChange={setConfirmBulkDeleteOpen}
        title={`Delete ${selection.ids.size} fields?`}
        description="This removes them from the form. Locked fields stay. You can undo it with Ctrl+Z."
        confirmLabel="Delete"
        destructive
        onConfirm={bulkDelete}
      />
```

- [ ] **Step 7: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`, then `pnpm --filter @openldr/studio typecheck > /tmp/s4-t5-tc.txt 2>&1; echo "exit=$?"`, expecting `exit=0`. Then `grep -n "selectedId" apps/studio/src/forms-builder/FormBuilderPage.tsx` must print nothing.

- [ ] **Step 8: Commit.** `git commit -m "feat(studio): select many fields and act on them from one ⋯ menu"`

---

### Task 6: The list keys

**Files:**
- Modify: `apps/studio/src/forms-builder/useBuilderKeyboard.ts`; create `useBuilderKeyboard.test.tsx`
- Modify: `SortableFieldRow.tsx`, `FieldListPane.tsx`, `FormBuilderPage.tsx` and its test

**Interfaces:** Consumes `moveAnchor`, `selectAllRows` from Task 1, and `bulkToggle`, `openEditor`, `listOrder` from Task 5. The row label carries `data-row-label`. The field search box carries `id="builder-field-search"`.

- [ ] **Step 1: Failing tests.** Create `useBuilderKeyboard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useBuilderKeyboard, type BuilderKeyboardHandlers } from './useBuilderKeyboard';

function Harness({ handlers }: { handlers: BuilderKeyboardHandlers }) {
  useBuilderKeyboard(handlers);
  return (
    <div>
      <input aria-label="box" />
      <button type="button" data-row-label>row</button>
      <button type="button">other</button>
      <div role="dialog"><button type="button">inside</button></div>
    </div>
  );
}

function setup() {
  const handlers: BuilderKeyboardHandlers = {
    focusSearch: vi.fn(), next: vi.fn(), previous: vi.fn(), open: vi.fn(), toggle: vi.fn(),
    duplicate: vi.fn(), remove: vi.fn(), selectAll: vi.fn(), undo: vi.fn(), redo: vi.fn(), clear: vi.fn(),
  };
  return { ...render(<Harness handlers={handlers} />), handlers };
}

describe('useBuilderKeyboard', () => {
  it('runs the list keys when the page has focus', () => {
    const { handlers } = setup();
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(handlers.next).toHaveBeenCalled();
    expect(handlers.selectAll).toHaveBeenCalled();
    expect(handlers.clear).toHaveBeenCalled();
  });

  it('runs them from a row label', () => {
    const { handlers, getByText } = setup();
    fireEvent.keyDown(getByText('row'), { key: 'd' });
    expect(handlers.remove).toHaveBeenCalled();
  });

  it('leaves them to a text box, another control, or anything in a dialog', () => {
    const { handlers, getByLabelText, getByText } = setup();
    fireEvent.keyDown(getByLabelText('box'), { key: 'j' });
    fireEvent.keyDown(getByText('other'), { key: 'Enter' });
    fireEvent.keyDown(getByText('inside'), { key: 'Escape' });
    expect(handlers.next).not.toHaveBeenCalled();
    expect(handlers.open).not.toHaveBeenCalled();
    expect(handlers.clear).not.toHaveBeenCalled();
  });

  it('keeps undo and Ctrl+F working from a text box', () => {
    const { handlers, getByLabelText } = setup();
    fireEvent.keyDown(getByLabelText('box'), { key: 'z', ctrlKey: true });
    fireEvent.keyDown(getByLabelText('box'), { key: 'f', ctrlKey: true });
    expect(handlers.undo).toHaveBeenCalled();
    expect(handlers.focusSearch).toHaveBeenCalled();
  });
});
```

In `FormBuilderPage.test.tsx`, add:

```tsx
  it('j and k move the anchor and Enter opens it', async () => {
    await renderBuilderWith(THREE);
    for (const key of ['j', 'j', 'j', 'k']) fireEvent.keyDown(document.body, { key });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(await screen.findByRole('dialog')).toHaveTextContent('Bravo');
  });

  it('Space switches the anchor off and d deletes it', async () => {
    await renderBuilderWith(THREE);
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(screen.getByText('3 fields (2 enabled)')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(screen.getByText('2 fields (2 enabled)')).toBeInTheDocument();
  });

  it('Space leaves a locked anchor alone', async () => {
    await renderBuilderWith([field('a', 'Alpha', 0, { locked: true })]);
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(screen.getByText('1 fields (1 enabled)')).toBeInTheDocument();
  });

  it('Ctrl+A selects every row, Space and d act on all of them, and Escape clears', async () => {
    await renderBuilderWith(THREE);
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(enabledRows()).toBe(0);
    fireEvent.keyDown(document.body, { key: 'd' });
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Delete 3 fields?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText('3 selected')).toBeNull();
  });

  it('Ctrl+D duplicates the anchor', async () => {
    await renderBuilderWith(THREE);
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true });
    expect(await screen.findByRole('dialog')).toHaveTextContent('Alpha (copy)');
  });

  it('Ctrl+F puts the cursor in the field search', async () => {
    await renderBuilderWith(THREE);
    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search fields' }));
  });
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/useBuilderKeyboard.test.tsx src/forms-builder/FormBuilderPage.test.tsx`.

- [ ] **Step 3: The focus rule.** In `useBuilderKeyboard.ts`, replace `isTypingTarget` with:

```ts
/**
 * The list keys act only when the page itself has focus, or a row's label does. Before S4 they did
 * nothing, so no control relied on reaching them. Now they do things, so a key pressed in a text box,
 * an open menu, a select, a sheet or on any other control belongs to that control. Otherwise
 * ArrowDown in a select would move the list's anchor, and Escape that closes a sheet would clear the
 * selection.
 */
function isListFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target === document.body) return true;
  return target.hasAttribute('data-row-label');
}
```

and change `if (isTypingTarget(event.target)) return;` to `if (!isListFocus(event.target)) return;`. The Ctrl+F, undo and redo lines above it do not change.

- [ ] **Step 4: The targets.** In `SortableFieldRow.tsx`, add `data-row-label` to the label `<button>`. In `FieldListPane.tsx`, add `id="builder-field-search"` to the field search `Input`.

- [ ] **Step 5: The handlers.** In `FormBuilderPage.tsx`, add `moveAnchor` and `selectAllRows` to the `./selection` import, and replace the handler object passed to `useBuilderKeyboard` with:

```ts
  useBuilderKeyboard({
    focusSearch: () => document.getElementById('builder-field-search')?.focus(),
    next: () => setSelection((s) => moveAnchor(s, listOrder, 1)),
    previous: () => setSelection((s) => moveAnchor(s, listOrder, -1)),
    open: () => { if (selection.anchor) openEditor(selection.anchor); },
    // Space and d act on the whole selection when it holds two or more, else on the anchor.
    // Corlix `FormBuilderPage.tsx:988-1008`.
    toggle: () => bulkToggle(selection.ids.size >= 2 ? selection.ids : new Set(selection.anchor ? [selection.anchor] : [])),
    duplicate: () => { if (selection.anchor) duplicateField(selection.anchor); },
    remove: () => {
      if (selection.ids.size >= 2) setConfirmBulkDeleteOpen(true);
      else if (selection.anchor) deleteField(selection.anchor);
    },
    selectAll: () => setSelection((s) => selectAllRows(s, listOrder)),
    undo: () => applyHistory(history.undo()),
    redo: () => applyHistory(history.redo()),
    clear: () => setSelection(NO_SELECTION),
  });
```

The handlers only call these functions when a key is pressed, so declaration order inside the component does not matter. Keep the call where it is.

- [ ] **Step 6: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`, then the studio typecheck, expecting `exit=0`.

- [ ] **Step 7: Commit.** `git commit -m "feat(studio): wire the field list keys to the selection"`

---

### Task 7: Drag a field onto a section

**Files:**
- Create: `apps/studio/src/forms-builder/SectionDropPanel.tsx`, `SectionDropPanel.test.tsx`
- Modify: `FieldListPane.tsx` and its test, `FormBuilderPage.tsx`

**Interfaces:** Produces `sectionDropTargetId(sectionId: string | undefined): string`, `parseSectionDropTargetId(overId: string): string | undefined | null`, `type DropAction`, `dropAction(activeId: string, overId: string | null): DropAction | null`, `SectionDropPanel({ visible, sections, fieldCountBySection, unsectionedCount })`, and `FieldListPaneProps.onMoveToSection?: (fieldId: string, sectionId: string | undefined) => void`.

- [ ] **Step 1: Failing tests.** Create `SectionDropPanel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SectionDropPanel, dropAction, parseSectionDropTargetId, sectionDropTargetId } from './SectionDropPanel';

describe('section drop targets', () => {
  it('round-trips a section id and the no-section bucket', () => {
    expect(parseSectionDropTargetId(sectionDropTargetId('vitals'))).toBe('vitals');
    expect(parseSectionDropTargetId(sectionDropTargetId(undefined))).toBeUndefined();
    expect(parseSectionDropTargetId('field-1')).toBeNull();
  });
});

describe('dropAction', () => {
  it('reassigns on a section target, reorders on a field, and does nothing otherwise', () => {
    expect(dropAction('a', sectionDropTargetId('vitals'))).toEqual({ kind: 'section', fieldId: 'a', sectionId: 'vitals' });
    expect(dropAction('a', sectionDropTargetId(undefined))).toEqual({ kind: 'section', fieldId: 'a', sectionId: undefined });
    expect(dropAction('a', 'b')).toEqual({ kind: 'reorder', activeId: 'a', overId: 'b' });
    expect(dropAction('a', 'a')).toBeNull();
    expect(dropAction('a', null)).toBeNull();
  });
});

describe('SectionDropPanel', () => {
  const renderPanel = (visible: boolean) =>
    render(
      <DndContext>
        <SectionDropPanel
          visible={visible}
          sections={[{ id: 'vitals', label: 'Vitals', order: 0 }]}
          fieldCountBySection={{ vitals: 2 }}
          unsectionedCount={1}
        />
      </DndContext>,
    );

  it('lists (no section) and each section with a count', () => {
    renderPanel(true);
    expect(screen.getByText('Drop on a section to reassign')).toBeTruthy();
    expect(screen.getByText('(no section)')).toBeTruthy();
    expect(screen.getByText('Vitals').nextSibling?.textContent).toBe('2');
  });

  it('is hidden from assistive tech while no drag is on', () => {
    renderPanel(false);
    expect(screen.getByText('Drop on a section to reassign').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true');
  });
});
```

In `FieldListPane.test.tsx`, add:

```tsx
  it('keeps the section drop panel folded until a drag starts', () => {
    renderPane();
    expect(screen.getByText('Drop on a section to reassign').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('has no drop panel on a form without sections', () => {
    renderPane({ sections: [] });
    expect(screen.queryByText('Drop on a section to reassign')).toBeNull();
  });
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/SectionDropPanel.test.tsx src/forms-builder/FieldListPane.test.tsx`.

- [ ] **Step 3: Write `SectionDropPanel.tsx`.**

```tsx
import { useDroppable } from '@dnd-kit/core';
import type { FormSection } from '@openldr/forms/pure';

const TARGET_PREFIX = 'section-target:';
const NO_SECTION_KEY = '__none__';

/** The drop target id for a section, or for "(no section)" when `sectionId` is undefined. */
export const sectionDropTargetId = (sectionId: string | undefined): string =>
  TARGET_PREFIX + (sectionId ?? NO_SECTION_KEY);

/**
 * Null when `overId` is not a section target, which means a field, for a reorder. Undefined for
 * "(no section)". Otherwise the section id. Ported from corlix `components/SectionDropPanel.tsx`.
 */
export function parseSectionDropTargetId(overId: string): string | undefined | null {
  if (!overId.startsWith(TARGET_PREFIX)) return null;
  const id = overId.slice(TARGET_PREFIX.length);
  return id === NO_SECTION_KEY ? undefined : id;
}

export type DropAction =
  | { kind: 'section'; fieldId: string; sectionId: string | undefined }
  | { kind: 'reorder'; activeId: string; overId: string };

/** What a drop does. Only the dragged field moves, as in corlix `pages/FormBuilderPage.tsx:481-500`. */
export function dropAction(activeId: string, overId: string | null): DropAction | null {
  if (!overId) return null;
  const sectionId = parseSectionDropTargetId(overId);
  if (sectionId !== null) return { kind: 'section', fieldId: activeId, sectionId };
  if (activeId === overId) return null;
  return { kind: 'reorder', activeId, overId };
}

function DropRow({ id, label, count }: { id: string; label: string; count: number }): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center justify-between rounded-md border border-dashed px-3 py-1.5 text-xs transition-colors ${
        isOver ? 'border-primary bg-primary/10 ring-2 ring-primary/60' : 'border-border bg-background/40'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="text-[10px] text-muted-foreground">{count}</span>
    </div>
  );
}

/**
 * While a field is dragged, the sections it can land on, at the top of the list. It stays mounted
 * and folds away when idle, as corlix's does, so its drop targets exist before a drag starts.
 */
export function SectionDropPanel({
  visible,
  sections,
  fieldCountBySection,
  unsectionedCount,
}: {
  visible: boolean;
  sections: FormSection[];
  fieldCountBySection: Record<string, number>;
  unsectionedCount: number;
}): JSX.Element {
  return (
    <div
      aria-hidden={!visible}
      className={`mb-3 overflow-hidden transition-all duration-150 ease-out ${
        visible ? 'max-h-72 translate-y-0 opacity-100' : 'max-h-0 -translate-y-2 opacity-0'
      }`}
    >
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Drop on a section to reassign</p>
      <div className="space-y-1.5">
        <DropRow id={sectionDropTargetId(undefined)} label="(no section)" count={unsectionedCount} />
        {sections.map((s) => (
          <DropRow key={s.id} id={sectionDropTargetId(s.id)} label={s.label} count={fieldCountBySection[s.id] ?? 0} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: The list.** In `FieldListPane.tsx`:
- Import `SectionDropPanel` and `dropAction` from `./SectionDropPanel`.
- Add `/** Drop a dragged field on a section, or on "(no section)" with undefined. */ onMoveToSection?: (fieldId: string, sectionId: string | undefined) => void;` to the props and destructure it.
- Add:

```ts
  const [dragging, setDragging] = useState(false);
  const fieldCountBySection = useMemo(() => {
    const out: Record<string, number> = {};
    for (const f of fields) if (f.section) out[f.section] = (out[f.section] ?? 0) + 1;
    return out;
  }, [fields]);
  const unsectionedCount = fields.filter((f) => !f.section).length;
```

- Replace `handleDragEnd` with:

```ts
  function handleDragEnd(event: DragEndEvent) {
    setDragging(false);
    const action = dropAction(String(event.active.id), event.over ? String(event.over.id) : null);
    if (!action) return;
    if (action.kind === 'section') onMoveToSection?.(action.fieldId, action.sectionId);
    else onReorder(action.activeId, action.overId);
  }
```

- Give `DndContext` `onDragStart={() => setDragging(true)}` and `onDragCancel={() => setDragging(false)}`.
- As its first child, before `SortableContext`:

```tsx
          {sections.length > 0 && (
            <SectionDropPanel
              visible={dragging}
              sections={sortedSections}
              fieldCountBySection={fieldCountBySection}
              unsectionedCount={unsectionedCount}
            />
          )}
```

- [ ] **Step 5: The page.** In `FormBuilderPage.tsx`, after `bulkDelete`, add:

```ts
  /** A field dropped on a section moves into it. One undo step. */
  const moveDroppedField = (fieldId: string, sectionId: string | undefined) => {
    history.pushHistory();
    setSchema((prev) => ({ ...prev, fields: moveFieldsToSection(prev.fields, new Set([fieldId]), sectionId) }));
  };
```

and pass `onMoveToSection={moveDroppedField}` to `FieldListPane`.

- [ ] **Step 6: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`, then the studio typecheck, expecting `exit=0`.

jsdom cannot drag, so no test drives a real drop. `dropAction` is tested, and so is the panel. The drop itself is checked in the browser in Task 9.

- [ ] **Step 7: Commit.** `git commit -m "feat(studio): drop a dragged field on a section to move it there"`

---

### Task 8: Docs

**Files:** `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md` and `apps/web/src/docs/0.1.8/forms.md`.

- [ ] **Step 1: English.** In `en/forms.md`, insert after the `## The Library` section:

```md
## Working with many fields

- Click a field to open its editor. Shift-click selects every field from the last one you clicked to this one. Ctrl-click (Cmd-click on a Mac) adds or removes one field. Neither opens the editor.
- Ctrl+A (Cmd+A) selects every field the list shows. Escape clears the selection.
- With two or more selected, the list header shows how many, and its ⋯ menu moves them to a section, switches them on or off, or deletes them. Delete asks first. Each is one undo step.
- Toggle enabled switches them all off when at least half are on, and all on otherwise. It skips locked fields, and so does Delete.
- When no box or menu has focus: j and k (or the arrow keys) move down and up the list, Enter opens the field, Space switches it on or off, d deletes it, and Ctrl+D duplicates it. With two or more selected, Space and d act on all of them. Ctrl+F jumps to the field search.
- A phone has no Shift or Ctrl key, so on a phone you select one field at a time.

## Sections

- Drag a field by its handle. While you drag, a panel at the top of the list shows (no section) and each section, with how many fields it has. Drop the field on one to move it there. The panel only appears when the form has sections.
- In the Sections list, each section's ⋯ menu has Edit visibility, Move up, Move down and Delete.
- Edit visibility opens the same rule editor a field has. Only enabled fields can be used in a condition. Data entry hides the section while its rule is not met.
- A field or section with a visibility rule shows a branch icon.
```

- [ ] **Step 2: French and Portuguese.** Translate both sections into `fr/forms.md` and `pt/forms.md`, inserted after `## Le volet Library` and `## O painel Library`. Keep UI labels in English, as those files already do: **Edit visibility**, **Move up**, **Move down**, **Delete**, **Toggle enabled**, **(no section)**. Keep the same number of bullets as the English.

- [ ] **Step 3: Web.** In `apps/web/src/docs/0.1.8/forms.md`, add each language's two sections after that language's `### The Library`, `### Le volet Library` and `### O painel Library`, with `###` headings.

- [ ] **Step 4: Run the docs tests.** `pnpm --filter @openldr/studio exec vitest run src/docs` and `pnpm --filter @openldr/web exec vitest run`. Expected: PASS for both.

- [ ] **Step 5: Commit.** `git commit -m "docs(forms): describe selecting many fields, section drops and section visibility"`

---

### Task 9: Verify, merge, changelog

- [ ] **Step 1: Both gates on the branch.**

```bash
pnpm turbo run test --force > /tmp/s4-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s4-tc.txt 2>&1; echo "exit=$?"
```

Both must print `exit=0`. Read the `Tasks:` line of each: turbo stops at the first failure, so a short count means packages did not run. On a test failure, run `grep -n "Test timed out\|Unhandled Errors" /tmp/s4-test.txt` first, and re-run that package alone.

- [ ] **Step 2: Browser, desktop.** `preview_start` the `api` and `studio` configurations. The builder is `http://localhost:5173/studio/forms/<id>/builder`. The operator signs in; never type credentials. The Browser pane is about 800px wide, so `resize_window` to 1600x900 for the desktop checks.

Make a throwaway `Location` form through the studio's API module in the page, as S3 did (`await import('/studio/src/api.ts')`, `createForm`, then `updateForm` with `schema.id` set to the new id). Give it two sections, `vitals` and `admin`, and five fields: three in no section, one in `vitals`, and one `locked: true`. Check:

- A plain click opens the editor. Close it with Escape. Shift-click a field three rows down: the rows between are selected, the header reads "N selected", and no editor opens.
- Ctrl-click adds and removes one row.
- The header's `⋯` has Move to (no section), Move to each section, Toggle enabled, Delete and Clear selection. Toggle enabled then Ctrl+Z restores every field in one step. Delete asks first, and the locked field stays.
- Click the page body so no control has focus. `j`, `k`, Enter, Space, `d`, Ctrl+D, Ctrl+A, Escape and Ctrl+F each do what the docs say.
- Focus a row's label with Tab, then press Space. The field switches on or off and the editor does not open. If the editor opens too, the button's own click is firing as well. Stop and report it rather than guess at a fix.
- Open the FHIR Version select and press ArrowDown: the list anchor does not move. Open a row's `⋯` and press Enter on an item: only that item runs.
- Drag a field by its handle. The panel "Drop on a section to reassign" unfolds at the top with (no section), Vitals and Admin and their counts. Drop on Admin: the field moves there. Ctrl+Z moves it back.
- In the Sections popover, a section's `⋯` has Edit visibility, Move up, Move down and Delete. Edit visibility opens a right sheet titled Visibility. Add a condition. The section row shows the branch icon, and so does a field given a rule in its editor.

Compare against corlix screenshots in `~/Projects/Repositories/corlix/apps/desktop/test-output/` where one exists. The screenshots spec takes `form-builder-bulk-action-bar`.

- [ ] **Step 3: Phone.** `resize_window` preset `mobile` and reload. A plain tap opens the editor. Nothing scrolls sideways (`document.documentElement.scrollWidth === innerWidth`). Open the Visibility sheet and add a condition: the row's controls are narrow at this width, as in the field editor (S2's side list). Note it; do not fix it. Reset with preset `desktop`. Nothing in S4 is anchored to the bottom edge.

Delete the throwaway form with `api.deleteForm(id)`. Stop both servers before the gates on `main`.

- [ ] **Step 4: Merge, gates on main, changelog.**

```bash
git switch main
git merge --no-ff feat/form-builder-s4 -m "Merge branch 'feat/form-builder-s4'"
pnpm turbo run test --force > /tmp/s4-main-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s4-main-tc.txt 2>&1; echo "exit=$?"
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog after form builder S4 merge"
git branch -d feat/form-builder-s4
```

Both gates must print `exit=0` before the changelog commit. Do not push.

- [ ] **Step 5: Report.** The commits, both gate results with the command and exit code, screenshots, anything that was stopped rather than fixed, and a plain line that nothing in S4 is bottom-anchored.

---

## Side list (not S4 work)

- **Enter or Space on a focused plain button** does the button's own thing and nothing else, under the focus rule. Corlix's hook would also run the list key. CE's is narrower on purpose. Recorded so nobody reads it as a gap.
- **The spec's section 3 says keyboard shortcuts are the same in both apps.** They were not, as ruling 2 records. Correct the spec when S4 lands.
- **Carried from S3:** the studio sometimes reloads onto the Dashboard (a separate session is on it); the Library search box empties when the workspace crosses 980px; `dhis2-sink-ui`'s `main.test.tsx` can throw `cancelAnimationFrame is not defined` after teardown under load.
- **Carried from S1 and S2:** the data-entry step, `ValueSetBuilder.tsx:103`'s `expandValueSet`, the seed drift in the Lab order form, and the narrow discriminator inputs at 375px.
