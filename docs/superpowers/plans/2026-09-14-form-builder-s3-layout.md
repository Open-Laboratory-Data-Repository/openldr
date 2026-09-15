# Form builder S3: layout (preview sheet, Library pane, narrow tabs)

**Status:** merged to `main` on 2026-09-14 as `56529531`. The checkboxes below were not ticked while the work ran, so they do not show what was done. Git history does.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** Make CE's form builder layout act like corlix's: Preview moves into a sheet opened from the `⋯` menu, a Library pane on the right lists the FHIR elements the form does not bind yet, and below 980px of workspace the two panes become Form and Library tabs.

**Architecture:** Pure helpers in the studio decide what the Library offers (`libraryEntries.ts`), how an element becomes a field (`fhirTypeMap.ts`, `newFormFields.ts`), and when the workspace is narrow (`useElementWidth.ts`). `LibraryPane.tsx` and `PreviewSheet.tsx` are presentation. `FormBuilderPage.tsx` wires them. `packages/forms` gains `mapsToResource`. Storage does not change. S5 adds the Library's starter-pack group later.

**Tech Stack:** TypeScript, vitest, React 18, Testing Library, Radix via shadcn `components/ui`.

**Spec:** `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, section 5, S3. Rows A8, A10 (FHIR elements half), A11.

## Read this first: state when this plan was written

- Written 2026-09-14 at local `main` `bc63786a`. S1 and S2 are merged to local `main` and not pushed. `main` is ahead of `origin/main`. Do not push.
- S1 added `fieldTree.ts`, `RepeatRow.tsx`, and nesting in `FieldListPane.tsx`. S2 added `DiscriminatorEditor.tsx`, `ReferenceEditor.tsx`, `newFormFields.ts`, the Parts block, and `survey-mode.ts` with `isSurveyForm`.
- Corlix, the app being matched, is at `~/Projects/Repositories/corlix`. Its screenshots of the target behavior are in `apps/desktop/test-output/p14-2-library-pane/` and `p14-3-narrow-tabs/`. Its source for this slice is `components/form-builder/LibraryPane.tsx`, `PaneTabs.tsx`, `lib/libraryEntries.ts`, `lib/fhirTypeMap.ts`, `lib/newFormFields.ts:132-211`, `hooks/useElementWidth.ts`, and `pages/FormBuilderPage.tsx:230-242,1523-1800`.
- A `pre:edit-write` GateGuard hook blocks the first Edit or Write to each file until you state four facts: the importers, the public names affected, any data files read, and the operator's instruction. Answer it and retry. It also prints loop and scope warnings that are noise.

## Global Constraints

- Match corlix's shipped behavior. Add nothing beyond it.
- Storage does not change. Data entry does not change.
- UI strings are plain English literals, like the rest of `forms-builder`. No i18n keys.
- shadcn components only for new UI. Never a native `<button>`, `<select>`, `<input>` or `<dialog>` in new code.
- Sheet actions go in a `⋯` `DropdownMenu`, never loose buttons (AGENTS.md §5).
- Empty state uses `StripedEmpty` (`components/ui/striped-empty.tsx`). Stripes mean empty, never loading.
- Inactive `TabsContent` gets `data-[state=inactive]:hidden` (AGENTS.md §6, the fourth mobile trap).
- Never pipe turbo through `tail`. Never read `$?` through a pipe. Redirect to a file, then echo the exit code.
- No `Co-Authored-By` trailers on commits (AGENTS.md §9).
- Work on branch `feat/form-builder-s3`. Merge to local `main` at the end. Do not push. Do not open a PR.

## Decisions and adaptations, each with its reason

- **Fill example and Reset move into the preview sheet's `⋯` menu.** Corlix shows them as text buttons in the sheet header. AGENTS.md §5 puts sheet actions in a `⋯` menu. This is the same convention fix S5's chooser gets.
- **The Library offers what CE's path table holds.** Corlix parses the FHIR schema. CE uses `fhirPathOptionsFor` (`packages/fhir/src/paths/index.ts:84`). It covers nine resource types. For any other type the Library shows an empty state that says so.
- **Depth:** only paths up to two segments below the resource, matching corlix ("only one level is expanded"). `Location.address.city` is offered. `Patient.contact.address.city` is not.
- **Infrastructure elements are hidden, as in corlix** (`corlix main/fhir-resources.ts:34-37`): `id`, `meta`, `implicitRules`, `language`, `text`, `contained`, `extension` and `modifierExtension`, at any level.
- **Field type from the leaf type.** CE has no FHIR-type-to-field-type map today; grep for one found nothing. So corlix's `fhirTypeToFieldType` is ported. Its BackboneElement test (`/^[A-Z]\w*_[A-Z]\w*$/`) does not fit CE's type names. CE names a backbone type after its resource, as `LocationHoursOfOperation`, `PatientContact` and `SpecimenCollection` (checked in `r4-paths.generated.ts`). So a leaf type that starts with the resource name and is longer is a group.
- **Limit: dates arrive as text.** `@types/fhir` types `date` and `dateTime` as `string`. So `Specimen.receivedTime` has leaf type `string`, and the Library makes it a text field. Corlix makes it a date field. Fixing this needs the generator to keep the FHIR primitive name. That is out of scope; record it.
- **Code options from the label.** Corlix fills a coded field's options from the schema's enum values. CE's table has no enum column, but a coded element's label is the enum: `Location.status` reads `active | suspended | inactive`, `Patient.gender` reads `male | female | other | unknown`. When a `code` leaf's label matches `^[\w-]+( \| [\w-]+)+$`, the new field gets those as options. Otherwise it gets none, and the lint's existing `choice-missing-options` error asks the author for them.
- **Required and cardinality.** CE's table has no min, so a Library field is not required and has `min: 0`. `max` is `'*'` when the element itself repeats (`ownArray`), else `'1'`. A repeating non-group field is `repeatable`, as in corlix `newFormFields.ts:137-160`.
- **No loading state.** The spec asked for `LoadingState` while loading. `fhirPathOptionsFor` is synchronous, so there is nothing to load. S5's pack group is async and adds it then.
- **A field added from the Library stays if the author cancels its editor,** as in corlix, which routes it through `commitDraftAndSelect`. Undo removes it.
- **Narrow means measured and under 980.** Corlix treats a width of 0 as wide (`FormBuilderPage.tsx:242`, `width > 0 && width < 980`). jsdom measures 0, so existing tests keep the wide layout. Tests that need the narrow layout mock the hook.

## File map

| File | Change |
|---|---|
| `packages/forms/src/survey-mode.ts` + test | add `mapsToResource` |
| `apps/studio/src/forms-builder/fhirTypeMap.ts` + test | new: `fieldTypeForLeaf`, `elementDisplayName`, `codeOptionsFromLabel` |
| `apps/studio/src/forms-builder/libraryEntries.ts` + test | new: `libraryElements` |
| `apps/studio/src/forms-builder/newFormFields.ts` + test | add `buildFieldFromElement`, `groupIdForPath` |
| `apps/studio/src/forms-builder/PreviewSheet.tsx` + test | new, replaces `PreviewPane.tsx` and its test |
| `apps/studio/src/forms-builder/BuilderHeader.tsx` + test | `onPreview` and a Preview menu item |
| `apps/studio/src/forms-builder/LibraryPane.tsx` + test | new |
| `apps/studio/src/forms-builder/useElementWidth.ts` | new |
| `apps/studio/src/forms-builder/FormBuilderPage.tsx` + test | wire the sheet, the Library, the tabs |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`, `apps/web/src/docs/0.1.8/forms.md` | new section, changed Preview step |

---

### Task 0: Branch

- [ ] **Step 1**

```bash
git switch main
git switch -c feat/form-builder-s3
```

---

### Task 1: `mapsToResource`

**Files:** Modify `packages/forms/src/survey-mode.ts`. Test `packages/forms/src/survey-mode.test.ts`.

**Interfaces:** Produces `mapsToResource(fhirResourceType: string | null | undefined): boolean` from `@openldr/forms/pure`. `survey-mode.ts` is already re-exported from `pure.ts` and `index.ts`.

- [ ] **Step 1: Failing test.** In `survey-mode.test.ts`, change the import to `import { isSurveyForm, mapsToResource } from './survey-mode';` and add:

```ts
describe('mapsToResource', () => {
  it('is true for a resource form', () => {
    expect(mapsToResource('Location')).toBe(true);
  });

  it('is false for no type, a Bundle form and a survey form', () => {
    expect(mapsToResource(null)).toBe(false);
    expect(mapsToResource('Bundle')).toBe(false);
    expect(mapsToResource('Questionnaire')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, watch it fail.** `pnpm --filter @openldr/forms exec vitest run src/survey-mode.test.ts`. Expected: FAIL, `mapsToResource is not a function`.

- [ ] **Step 3: Implement.** Append to `packages/forms/src/survey-mode.ts`:

```ts
/**
 * Whether the form points fields at one FHIR resource. False with no type, for a Bundle form
 * (each section carries its own type) and for a survey. The Library lists elements only when
 * this is true. Ported from corlix `lib/surveyMode.ts`.
 */
export function mapsToResource(fhirResourceType: string | null | undefined): boolean {
  if (!fhirResourceType) return false;
  if (fhirResourceType === 'Bundle') return false;
  return !isSurveyForm(fhirResourceType);
}
```

- [ ] **Step 4: Run, watch it pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git add packages/forms/src/survey-mode.ts packages/forms/src/survey-mode.test.ts && git commit -m "feat(forms): say when a form maps onto one FHIR resource"`

---

### Task 2: What the Library offers, and how an element becomes a field

**Files:**
- Create: `apps/studio/src/forms-builder/fhirTypeMap.ts`, `fhirTypeMap.test.ts`
- Create: `apps/studio/src/forms-builder/libraryEntries.ts`, `libraryEntries.test.ts`
- Modify: `apps/studio/src/forms-builder/newFormFields.ts`, `newFormFields.test.ts`

**Interfaces:**
- Consumes: `fhirPathOptionsFor`, `type FhirPathInfo` from `@openldr/fhir/paths`. `resolveFhirPath` from `@openldr/forms/pure`.
- Produces:
  - `fieldTypeForLeaf(leafType: string, resourceType: string): FieldType`
  - `elementDisplayName(path: string): string`
  - `codeOptionsFromLabel(label: string): { code: string; display: string }[] | null`
  - `libraryElements(resourceType: string | null | undefined, fields: readonly FormField[]): FhirPathInfo[]`
  - `buildFieldFromElement(info: FhirPathInfo, id: string): FormField`
  - `groupIdForPath(fields: readonly FormField[], path: string | null | undefined): string | undefined`

- [ ] **Step 1: Failing tests.** Create `fhirTypeMap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { codeOptionsFromLabel, elementDisplayName, fieldTypeForLeaf } from './fhirTypeMap';

describe('fieldTypeForLeaf', () => {
  it('maps the primitives and common datatypes, as corlix does', () => {
    expect(fieldTypeForLeaf('string', 'Location')).toBe('text');
    expect(fieldTypeForLeaf('number', 'Location')).toBe('number');
    expect(fieldTypeForLeaf('boolean', 'Location')).toBe('boolean');
    expect(fieldTypeForLeaf('code', 'Location')).toBe('select');
    expect(fieldTypeForLeaf('CodeableConcept', 'Location')).toBe('select');
    expect(fieldTypeForLeaf('Reference', 'Location')).toBe('reference');
    expect(fieldTypeForLeaf('Identifier', 'Location')).toBe('identifier');
    expect(fieldTypeForLeaf('Address', 'Location')).toBe('address');
    expect(fieldTypeForLeaf('ContactPoint', 'Location')).toBe('phone');
    expect(fieldTypeForLeaf('Attachment', 'Location')).toBe('attachment');
  });

  it('makes a group of a BackboneElement, named after its resource', () => {
    expect(fieldTypeForLeaf('LocationHoursOfOperation', 'Location')).toBe('group');
    expect(fieldTypeForLeaf('PatientContact', 'Patient')).toBe('group');
  });

  it('falls back to text for a datatype it does not map', () => {
    expect(fieldTypeForLeaf('HumanName', 'Patient')).toBe('text');
    expect(fieldTypeForLeaf('Period', 'Location')).toBe('text');
  });
});

describe('elementDisplayName', () => {
  it('names an element from its last path segment, camelCase split', () => {
    expect(elementDisplayName('Location.hoursOfOperation')).toBe('Hours of operation');
    expect(elementDisplayName('Location.address.city')).toBe('City');
  });
});

describe('codeOptionsFromLabel', () => {
  it('reads a coded element label as its options', () => {
    expect(codeOptionsFromLabel('active | suspended | inactive')).toEqual([
      { code: 'active', display: 'active' },
      { code: 'suspended', display: 'suspended' },
      { code: 'inactive', display: 'inactive' },
    ]);
  });

  it('is null for an ordinary label', () => {
    expect(codeOptionsFromLabel('Physical location')).toBeNull();
  });
});
```

Create `libraryEntries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FormField } from '@openldr/forms/pure';
import { libraryElements } from './libraryEntries';

const field = (id: string, fhirPath: string | null): FormField => ({
  id, displayLabel: id, fieldType: 'text', required: false, enabled: true, fhirPath,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
});

describe('libraryElements', () => {
  const paths = (rt: string | null, fields: FormField[] = []) => libraryElements(rt, fields).map((e) => e.path);

  it('offers the resource elements down to two segments', () => {
    expect(paths('Location')).toContain('Location.address');
    expect(paths('Location')).toContain('Location.address.city');
    expect(paths('Patient')).toContain('Patient.contact.address');
    expect(paths('Patient')).not.toContain('Patient.contact.address.city');
  });

  it('hides infrastructure, at any level, as corlix does', () => {
    const offered = paths('Location');
    for (const hidden of ['Location.meta', 'Location.text', 'Location.contained', 'Location.implicitRules', 'Location.language']) {
      expect(offered).not.toContain(hidden);
    }
    expect(offered.some((p) => /\.(id|extension|modifierExtension)(\.|$)/.test(p))).toBe(false);
  });

  it('drops a path any field already binds, disabled fields included, bare paths too', () => {
    const disabled = { ...field('b', 'Location.address.city'), enabled: false };
    const offered = paths('Location', [field('a', 'name'), disabled]);
    expect(offered).not.toContain('Location.name');
    expect(offered).not.toContain('Location.address.city');
    expect(offered).toContain('Location.address.district');
  });

  it('offers nothing with no type, or a type the table does not cover', () => {
    expect(paths(null)).toEqual([]);
    expect(paths('Questionnaire')).toEqual([]);
  });
});
```

Extend `newFormFields.test.ts`. Add `buildFieldFromElement, groupIdForPath` to its existing `./newFormFields` import, add `import { lookupFhirPath } from '@openldr/fhir/paths';`, and append (the file's `f` helper already exists):

```ts
describe('buildFieldFromElement', () => {
  const info = (p: string) => lookupFhirPath(p)!;

  it('builds a field named from the path, typed from the leaf, not required', () => {
    expect(buildFieldFromElement(info('Location.name'), 'name')).toMatchObject({
      id: 'name', fhirPath: 'Location.name', displayLabel: 'Name', fieldType: 'text', required: false,
      cardinality: { min: 0, max: '1' },
    });
  });

  it('marks an element that repeats as repeatable', () => {
    const field = buildFieldFromElement(info('Location.alias'), 'alias');
    expect(field.repeatable).toBe(true);
    expect(field.cardinality).toEqual({ min: 0, max: '*' });
  });

  it('makes a BackboneElement a group, never repeatable', () => {
    const field = buildFieldFromElement(info('Location.hoursOfOperation'), 'hours');
    expect(field.fieldType).toBe('group');
    expect(field.repeatable).toBeUndefined();
  });

  it('fills a coded element options from its label', () => {
    expect(buildFieldFromElement(info('Location.status'), 'status').valueSetOptions?.map((o) => o.code))
      .toEqual(['active', 'suspended', 'inactive']);
  });
});

describe('groupIdForPath', () => {
  it('finds the group bound to the immediate parent path, and nothing further up', () => {
    const fields = [f({ id: 'addr', order: 0, fieldType: 'group', fhirPath: 'Location.address' })];
    expect(groupIdForPath(fields, 'Location.address.city')).toBe('addr');
    expect(groupIdForPath(fields, 'Location.address.city.text')).toBeUndefined();
    expect(groupIdForPath(fields, 'Location.name')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/fhirTypeMap.test.ts src/forms-builder/libraryEntries.test.ts src/forms-builder/newFormFields.test.ts`. Expected: two files fail to resolve, and the new `newFormFields` tests fail on missing exports.

If `Location.alias` or `Location.status` is not in the table, stop and read `r4-paths.generated.ts`. Do not change the test to fit.

- [ ] **Step 3: Implement `fhirTypeMap.ts`.**

```ts
import type { FieldType } from '@openldr/forms/pure';

/**
 * A FHIR leaf type as a builder field type. Ported from corlix `lib/fhirTypeMap.ts`.
 *
 * CE's path table keeps the TypeScript type from `@types/fhir`, so every string-like primitive
 * (date, dateTime, uri, id and the rest) arrives as `string` and becomes text. Corlix reads the
 * FHIR primitive name and makes dates date fields; CE cannot until the generator keeps that name.
 */
const TYPE_MAP: Record<string, FieldType> = {
  string: 'text',
  number: 'number',
  boolean: 'boolean',
  code: 'select',
  CodeableConcept: 'select',
  Coding: 'select',
  Reference: 'reference',
  Identifier: 'identifier',
  Address: 'address',
  ContactPoint: 'phone',
  Attachment: 'attachment',
};

/**
 * A BackboneElement holds named sub-fields, so a group is the only type that fits. `@types/fhir`
 * names one after its resource (`LocationHoursOfOperation`, `PatientContact`), which is how it is
 * told apart from a shared datatype such as `HumanName`.
 */
export function fieldTypeForLeaf(leafType: string, resourceType: string): FieldType {
  const mapped = TYPE_MAP[leafType];
  if (mapped) return mapped;
  if (leafType.startsWith(resourceType) && leafType.length > resourceType.length) return 'group';
  return 'text';
}

/** A short name for an element: its last path segment with camelCase split into words. */
export function elementDisplayName(path: string): string {
  const segment = path.split('.').pop() ?? path;
  const words = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A coded element's label in `@types/fhir` is its enum, `active | suspended | inactive`. Read it as
 * options, as corlix reads the schema's enum values. Null when the label is ordinary prose.
 */
export function codeOptionsFromLabel(label: string): { code: string; display: string }[] | null {
  if (!/^[\w-]+( \| [\w-]+)+$/.test(label.trim())) return null;
  return label.split('|').map((part) => part.trim()).map((code) => ({ code, display: code }));
}
```

- [ ] **Step 4: Implement `libraryEntries.ts`.**

```ts
import { fhirPathOptionsFor, type FhirPathInfo } from '@openldr/fhir/paths';
import { resolveFhirPath, type FormField } from '@openldr/forms/pure';

/** Segments below the resource the Library offers. Corlix expands one level of a complex type. */
export const LIBRARY_MAX_DEPTH = 2;

/** FHIR plumbing corlix never offers (`main/fhir-resources.ts:34-37`), at any level. */
const INFRASTRUCTURE = new Set(['id', 'meta', 'implicitRules', 'language', 'text', 'contained', 'extension', 'modifierExtension']);

/**
 * The elements of the form's resource type that no field binds yet. A disabled field still binds
 * its path, because disabling keeps the field on the form. Ported from corlix `lib/libraryEntries.ts`.
 */
export function libraryElements(resourceType: string | null | undefined, fields: readonly FormField[]): FhirPathInfo[] {
  if (!resourceType) return [];
  const bound = new Set<string>();
  for (const f of fields) {
    const resolved = resolveFhirPath(f.fhirPath, resourceType);
    if (resolved) bound.add(resolved);
  }
  return fhirPathOptionsFor(resourceType).filter((e) => {
    const segments = e.path.split('.').slice(1);
    return segments.length <= LIBRARY_MAX_DEPTH && !segments.some((s) => INFRASTRUCTURE.has(s)) && !bound.has(e.path);
  });
}
```

- [ ] **Step 5: Extend `newFormFields.ts`.** Add the imports `import type { FhirPathInfo } from '@openldr/fhir/paths';` and `import { codeOptionsFromLabel, elementDisplayName, fieldTypeForLeaf } from './fhirTypeMap';`, then append:

```ts
/**
 * A field bound to one FHIR element, for the Library. Everything comes from the path table: the
 * path, the name, the type and whether the element repeats. No API property is guessed, and the
 * field is not required, because CE's table has no minimum. Ported from corlix `newFormFields.ts:132`.
 */
export function buildFieldFromElement(info: FhirPathInfo, id: string): FormField {
  const fieldType = fieldTypeForLeaf(info.leafType, info.resourceType);
  const field: FormField = {
    id,
    fhirPath: info.path,
    displayLabel: elementDisplayName(info.path),
    description: null,
    fieldType,
    required: false,
    enabled: true,
    order: 0,
    cardinality: { min: 0, max: info.ownArray ? '*' : '1' },
  };
  // A group's repetition comes from `groupRepeats`, so `repeatable` on one would be dead state.
  if (info.ownArray && fieldType !== 'group') field.repeatable = true;
  if (info.leafType === 'code') {
    const options = codeOptionsFromLabel(info.label);
    if (options) field.valueSetOptions = options;
  }
  return field;
}

/**
 * The group a field at `path` belongs inside, when the form has one bound to the immediate parent
 * path. Only the immediate parent: a group on `Location.address` adopts `Location.address.city` and
 * not `Location.address.city.text`. Ported from corlix `newFormFields.ts:202`.
 */
export function groupIdForPath(fields: readonly FormField[], path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const cut = path.lastIndexOf('.');
  if (cut === -1) return undefined;
  const parentPath = path.slice(0, cut);
  return fields.find((f) => f.fieldType === 'group' && f.fhirPath === parentPath)?.id;
}
```

- [ ] **Step 6: Run, watch them pass.** Same command as Step 2. Expected: PASS.

- [ ] **Step 7: Commit.** `git add` the six files, then `git commit -m "feat(studio): decide what the Library offers and how an element becomes a field"`

---

### Task 3: Preview becomes a sheet

**Files:**
- Create: `apps/studio/src/forms-builder/PreviewSheet.tsx`, `PreviewSheet.test.tsx`
- Delete: `apps/studio/src/forms-builder/PreviewPane.tsx`, `PreviewPane.test.tsx`
- Modify: `BuilderHeader.tsx` and its test, `FormBuilderPage.tsx` and its test

**Interfaces:** Produces `PreviewSheet({ schema, open, onOpenChange })` and `BuilderHeaderProps.onPreview: () => void`.

- [ ] **Step 1: Failing tests.** Create `PreviewSheet.test.tsx`. Copy the `schema` fixture from `PreviewPane.test.tsx` lines 6-47 verbatim, then:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FormSchema } from '@/forms-runtime/types';
import { PreviewSheet } from './PreviewSheet';

// const schema: FormSchema = { … copied from PreviewPane.test.tsx lines 6-47 … };

function renderOpen() {
  return render(<PreviewSheet schema={schema} open onOpenChange={() => {}} />);
}

function clickMenu(item: string) {
  const trigger = screen.getByLabelText('Preview actions');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText(item)) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByText(item));
}

describe('PreviewSheet', () => {
  it('is titled Preview', () => {
    renderOpen();
    expect(screen.getByRole('dialog', { name: 'Preview' })).toBeTruthy();
  });

  it('renders the Patient name field label', () => {
    renderOpen();
    expect(screen.getByText('Patient name')).toBeTruthy();
  });

  it('Fill example in the menu populates the Patient name input', () => {
    renderOpen();
    clickMenu('Fill example');
    expect((screen.getByLabelText('Patient name') as HTMLInputElement).value).toBe('Example');
  });

  it('Reset in the menu clears it', () => {
    renderOpen();
    clickMenu('Fill example');
    clickMenu('Reset');
    expect((screen.getByLabelText('Patient name') as HTMLInputElement).value).toBe('');
  });

  it('shows the Required marker for the required field', () => {
    renderOpen();
    expect(screen.getByLabelText('Required').textContent).toBe('!');
  });

  it('renders nothing when closed', () => {
    render(<PreviewSheet schema={schema} open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText('Patient name')).toBeNull();
  });
});
```

Replace the `// const schema …` comment line with the copied fixture.

In `BuilderHeader.test.tsx`, extend `renderHeader` (line 25): add `const onPreview = vi.fn();` beside `const onAddField = vi.fn();` (line 33), pass `onPreview={onPreview}` beside `onAddField={onAddField}` (line 49), and add `onPreview` to the returned object (line 57). Then add next to `'calls onAddField when "Add field" is clicked'` (line 213):

```tsx
    it('calls onPreview when "Preview" is clicked', () => {
      const { onPreview } = renderHeader();
      openMenuAndClick('Builder actions', 'Preview');
      expect(onPreview).toHaveBeenCalled();
    });
```

In `FormBuilderPage.test.tsx`, replace the test `'renders the Preview pane alongside the field list'` (line 77) with:

```tsx
  it('opens Preview from the ⋯ menu as a sheet', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeNull();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Preview'));
    expect(await screen.findByRole('dialog', { name: 'Preview' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/PreviewSheet.test.tsx src/forms-builder/BuilderHeader.test.tsx src/forms-builder/FormBuilderPage.test.tsx`.

- [ ] **Step 3: Write `PreviewSheet.tsx`.**

```tsx
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import { makeExampleAnswers } from '@/forms-runtime/example';
import type { FormSchema, RuntimeAnswers } from '@/forms-runtime/types';

/**
 * The form as data entry will draw it, over the builder. Corlix P14.1 moved its preview from a split
 * pane into a sheet, so every width gets one; CE's pane was hidden on phones. Fill example and Reset
 * sit in the sheet's ⋯ menu, per AGENTS.md §5, where corlix shows them as header buttons.
 */
export function PreviewSheet({ schema, open, onOpenChange }: { schema: FormSchema; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [answers, setAnswers] = useState<RuntimeAnswers>({});
  const [remountKey, setRemountKey] = useState(0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-6 py-3 pr-12">
          <div>
            <SheetTitle>Preview</SheetTitle>
            <SheetDescription className="sr-only">The form as data entry will draw it.</SheetDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Preview actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => { setAnswers(makeExampleAnswers(schema)); setRemountKey((k) => k + 1); }}>
                Fill example
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setAnswers({}); setRemountKey((k) => k + 1); }}>
                Reset
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FormRuntime
            key={remountKey}
            schema={schema}
            // The builder previews an UNSAVED schema, so reference fields must search the field
            // descriptor through the forms.edit-gated preview endpoint rather than a stored form.
            preview
            footer={null}
            onSubmit={() => {}}
            initialAnswers={answers}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

`pr-12` keeps the `⋯` clear of the sheet's own close control in the top-right corner. Confirm with a screenshot in Task 7.

- [ ] **Step 4: Header menu item.** In `BuilderHeader.tsx`, add `onPreview: () => void;` to `BuilderHeaderProps` and destructure it. Add `<DropdownMenuItem onSelect={() => onPreview()}>Preview</DropdownMenuItem>` directly after the "Add field" item.

- [ ] **Step 5: Page.** In `FormBuilderPage.tsx`:
- Replace `import { PreviewPane } from './PreviewPane';` with `import { PreviewSheet } from './PreviewSheet';`.
- Add `const [previewOpen, setPreviewOpen] = useState(false);`.
- Pass `onPreview={() => setPreviewOpen(true)}` to `<BuilderHeader>`.
- Delete the `{/* Right: PreviewPane … */}` div and its contents.
- Change the list pane wrapper's class from `flex w-full shrink-0 flex-col overflow-hidden border-r border-border md:w-[26rem]` to `flex min-w-0 flex-1 flex-col overflow-hidden`.
- Render `<PreviewSheet schema={schema} open={previewOpen} onOpenChange={setPreviewOpen} />` next to `<FieldEditorSheet>`.
- Reword the comment above the two-pane body: the preview is a sheet now, so phones get one too.

- [ ] **Step 6: Delete the old pane.** `git rm apps/studio/src/forms-builder/PreviewPane.tsx apps/studio/src/forms-builder/PreviewPane.test.tsx`. Then `grep -rn "PreviewPane" apps/studio/src` must print nothing.

- [ ] **Step 7: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`. Expected: PASS.

- [ ] **Step 8: Commit.** `git commit -m "feat(studio): open the form preview as a sheet from the page menu"`

---

### Task 4: The Library pane

**Files:**
- Create: `apps/studio/src/forms-builder/LibraryPane.tsx`, `LibraryPane.test.tsx`
- Modify: `apps/studio/src/forms-builder/FormBuilderPage.tsx` and its test

**Interfaces:**
- Consumes: `libraryElements`, `buildFieldFromElement`, `groupIdForPath`, `insertFieldAfter`, `lastPartIdOf`, `elementDisplayName`, `isSurveyForm`, `mapsToResource`, `isKnownFhirResourceType`.
- Produces: `LibraryPane({ resourceType, elements, showHeader?, fullWidth?, onAddElement })`.

- [ ] **Step 1: Failing tests.** Create `LibraryPane.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lookupFhirPath } from '@openldr/fhir/paths';
import { LibraryPane } from './LibraryPane';

const els = ['Location.name', 'Location.address.city', 'Location.status'].map((p) => lookupFhirPath(p)!);

describe('LibraryPane', () => {
  it('lists each element by name and path under "All Location elements"', () => {
    render(<LibraryPane resourceType="Location" elements={els} onAddElement={vi.fn()} />);
    expect(screen.getByText('All Location elements')).toBeTruthy();
    expect(screen.getByText('Location.address.city')).toBeTruthy();
    expect(screen.getByText('City')).toBeTruthy();
  });

  it('filters by name and by path', () => {
    render(<LibraryPane resourceType="Location" elements={els} onAddElement={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search the library' }), { target: { value: 'status' } });
    expect(screen.queryByText('Location.name')).toBeNull();
    expect(screen.getByText('Location.status')).toBeTruthy();
  });

  it('says so when a search matches nothing', () => {
    render(<LibraryPane resourceType="Location" elements={els} onAddElement={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search the library' }), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing in the library matches "zzz".')).toBeTruthy();
  });

  it('hands a clicked element back', () => {
    const onAddElement = vi.fn();
    render(<LibraryPane resourceType="Location" elements={els} onAddElement={onAddElement} />);
    fireEvent.click(screen.getByRole('button', { name: /Location\.status/ }));
    expect(onAddElement).toHaveBeenCalledWith(els[2]);
  });

  it('says every element is on the form when none is left', () => {
    render(<LibraryPane resourceType="Location" elements={[]} onAddElement={vi.fn()} />);
    expect(screen.getByText('Every element is on the form.')).toBeTruthy();
  });

  it('says there is no element list for a type the table does not cover', () => {
    render(<LibraryPane resourceType="Encounter2" elements={[]} onAddElement={vi.fn()} />);
    expect(screen.getByText('The library has no element list for Encounter2.')).toBeTruthy();
  });

  it('asks for a resource type when there is none', () => {
    render(<LibraryPane resourceType={null} elements={[]} onAddElement={vi.fn()} />);
    expect(screen.getByText('Pick a resource type and the library will list what this form could hold.')).toBeTruthy();
  });
});
```

In `FormBuilderPage.test.tsx`, add this helper after `openFieldMenu`:

```tsx
/** Load the builder on a stored form of the given resource type, with no fields. */
function renderBuilderAs(fhirResourceType: string) {
  const base = makeFormDef();
  vi.spyOn(api, 'getForm').mockResolvedValue(
    makeFormDef({ fhirResourceType, schema: { ...base.schema, fhirResourceType } }) as never,
  );
  vi.spyOn(api, 'listFormVersions').mockResolvedValue([]);
  return render(
    <MemoryRouter initialEntries={['/forms/form-1/builder']}>
      <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
    </MemoryRouter>,
  );
}
```

and these tests:

```tsx
  it('shows the Library beside the list and adds a clicked element as a field', async () => {
    renderBuilderAs('Location');
    expect(await screen.findByText('All Location elements')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Location\.alias/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Alias');
  });

  it('shows no Library on a survey form', async () => {
    renderBuilderAs('Questionnaire');
    await screen.findByLabelText('Form name');
    expect(screen.queryByText(/^All .* elements$/)).toBeNull();
  });
```

- [ ] **Step 2: Run, watch them fail.**

- [ ] **Step 3: Write `LibraryPane.tsx`.** Port corlix `components/form-builder/LibraryPane.tsx` without the pack group, which S5 adds:
- An `aside` with `w-[21rem] shrink-0 border-l border-border` when not `fullWidth`, else `min-w-0 flex-1`. It is `flex min-h-0 flex-col overflow-hidden`.
- An optional header (`showHeader`, default `true`): uppercase `Library` at `text-[11px]`, `h-[38px]`, bottom border.
- A scrolling body. When `!resourceType`, show only the note `Pick a resource type and the library will list what this form could hold.`
- Otherwise:
  - A search `Input` with `aria-label="Search the library"`, placeholder `Search the library…`, and a `Search` icon. It filters on `elementDisplayName(e.path)`, `e.path` and `e.label`, all case-insensitive.
  - A group header `All {resourceType} elements` with a mono count, and the note `Everything the FHIR schema defines on {resourceType}. No pack has an opinion about these.`
  - One row per element: a shadcn `Button variant="ghost"` holding a `Plus` icon, the name (`elementDisplayName`) and the mono path. Its accessible name then contains the path.
  - When `elements` is empty, a `StripedEmpty` with `min-h-[8rem]`. It holds `Every element is on the form.`, or `The library has no element list for {resourceType}.` when `!isKnownFhirResourceType(resourceType)`.
  - When a search matches nothing: `Nothing in the library matches "{query}".`

- [ ] **Step 4: Wire it into the page.** In `FormBuilderPage.tsx`, add the imports (`useMemo` is already imported):

```tsx
import type { FhirPathInfo } from '@openldr/fhir/paths';
import { isSurveyForm, mapsToResource } from '@openldr/forms/pure';
import { LibraryPane } from './LibraryPane';
import { libraryElements } from './libraryEntries';
import { elementDisplayName } from './fhirTypeMap';
```

Add `buildFieldFromElement` and `groupIdForPath` to the existing `./newFormFields` import. Then, after `addGroupPart`:

```tsx
  const survey = isSurveyForm(schema.fhirResourceType);
  const elements = useMemo(
    () => (mapsToResource(schema.fhirResourceType) ? libraryElements(schema.fhirResourceType, schema.fields) : []),
    [schema.fhirResourceType, schema.fields],
  );

  /** A Library element becomes a field, inside its parent group when that group is on the form. One undo step. */
  const addFromLibrary = (info: FhirPathInfo) => {
    history.pushHistory();
    const field = buildFieldFromElement(info, freshId(elementDisplayName(info.path)));
    const groupId = groupIdForPath(schema.fields, info.path);
    setSchema((prev) => {
      if (groupId) {
        return { ...prev, fields: insertFieldAfter(prev.fields, lastPartIdOf(prev.fields, groupId), { ...field, groupId }) };
      }
      const nextOrder = prev.fields.reduce((max, f) => Math.max(max, f.order), -1) + 1;
      return { ...prev, fields: [...prev.fields, { ...field, order: nextOrder }] };
    });
    setPendingNewFieldId(null);
    setSelectedId(field.id);
  };
```

Inside the two-pane body, after the list pane, render:

```tsx
          {!survey && (
            <LibraryPane
              resourceType={schema.fhirResourceType ?? null}
              elements={elements}
              onAddElement={addFromLibrary}
            />
          )}
```

- [ ] **Step 5: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`. Then `pnpm --filter @openldr/studio typecheck > /tmp/s3-t4-tc.txt 2>&1; echo "exit=$?"`, expecting `exit=0`.

- [ ] **Step 6: Commit.** `git commit -m "feat(studio): a Library pane that lists what the form does not have yet"`

---

### Task 5: Form and Library become tabs on a narrow workspace

**Files:**
- Create: `apps/studio/src/forms-builder/useElementWidth.ts`
- Modify: `apps/studio/src/forms-builder/FormBuilderPage.tsx` and its test

**Interfaces:** Produces `useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number]` and `NARROW_WORKSPACE_PX = 980`.

- [ ] **Step 1: Failing tests.** In `FormBuilderPage.test.tsx`, near the top, next to the `sonner` mock:

```tsx
const width = { value: 0 };
vi.mock('./useElementWidth', () => ({
  NARROW_WORKSPACE_PX: 980,
  useElementWidth: () => [() => {}, width.value],
}));
```

In the existing `beforeEach`, add `width.value = 0;`. jsdom measures nothing, and corlix treats 0 as wide, so the other tests keep the side-by-side layout. Then add:

```tsx
  it('shows both panes side by side on a wide workspace', async () => {
    width.value = 1400;
    renderBuilderAs('Location');
    expect(await screen.findByText('All Location elements')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Library/ })).toBeNull();
  });

  it('becomes Form and Library tabs below 980px, opening on Form', async () => {
    width.value = 700;
    renderBuilderAs('Location');
    const formTab = await screen.findByRole('tab', { name: /Form/ });
    expect(formTab.getAttribute('data-state')).toBe('active');
    expect(screen.queryByText('All Location elements')).toBeNull();
  });

  it('switches back to Form after adding from the Library tab', async () => {
    width.value = 700;
    renderBuilderAs('Location');
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Library/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Location\.alias/ }));
    expect(screen.getByRole('tab', { name: /Form/ }).getAttribute('data-state')).toBe('active');
  });
```

Radix `TabsTrigger` activates on `mouseDown` in jsdom. If it does not, look at how `pages/Facilities.tsx`'s tests switch tabs and copy that.

- [ ] **Step 2: Run, watch them fail.**

- [ ] **Step 3: Write `useElementWidth.ts`.** Port corlix `hooks/useElementWidth.ts` verbatim. It is 20 lines: a state for the node, a state for the width, and a `ResizeObserver` in an effect with a `clientWidth` fallback when `ResizeObserver` is missing. Add this above it:

```ts
/**
 * Below this workspace width the Form and Library panes become tabs. Corlix measures the two-pane
 * area, not the viewport: the sidebar is already subtracted, so collapsing it can bring the panes back.
 */
export const NARROW_WORKSPACE_PX = 980;
```

- [ ] **Step 4: Page.** In `FormBuilderPage.tsx`:
- Import `useElementWidth` and `NARROW_WORKSPACE_PX`, and `Tabs`, `TabsContent`, `TabsList` and `TabsTrigger` from `@/components/ui/tabs`.
- Add `const [workspaceRef, workspaceWidth] = useElementWidth<HTMLDivElement>();`, then `const narrow = workspaceWidth > 0 && workspaceWidth < NARROW_WORKSPACE_PX;`, the same test as corlix `FormBuilderPage.tsx:242`.
- Add `const [pane, setPane] = useState<'form' | 'library'>('form');`.
- Put `ref={workspaceRef}` on the two-pane body div.
- When `narrow && !survey`, render the body as `Tabs value={pane} onValueChange={(v) => setPane(v as 'form' | 'library')}` with `className="flex min-h-0 flex-1 flex-col"`. Give it a `TabsList className="shrink-0 px-4"` holding two `TabsTrigger`s, `Form` and `Library`, each with a small mono count badge: `schema.fields.length` and `elements.length`. This copies `workflows/components/panels/run-history-drawer.tsx:137-146`. The unpadded body lets the list's bottom rule reach both edges.
- The Form `TabsContent` holds the list pane with `forceMount`. Corlix hides the list rather than unmounting it, so its scroll, drag context and search text survive a tab switch. The Library `TabsContent` holds `<LibraryPane … showHeader={false} fullWidth />`. Both get `className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"`.
- When not narrow, keep Task 4's side-by-side layout.
- In `addFromLibrary`, add `setPane('form');`, so the new field is not hidden behind the Library tab.

- [ ] **Step 5: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`, then the studio typecheck, expecting `exit=0`.

- [ ] **Step 6: Commit.** `git commit -m "feat(studio): Form and Library become tabs on a narrow workspace"`

---

### Task 6: Docs

**Files:** `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md` and `apps/web/src/docs/0.1.8/forms.md`.

- [ ] **Step 1: English.** In `en/forms.md`, replace step 13 with:

```md
13. Open **Preview** from the ⋯ menu to test the form before publishing. It opens as a sheet over the builder, on a phone too. **Fill example** and **Reset** are in the sheet's ⋯ menu. Preview shows exactly what a user sees, so a disabled field does not appear there either.
```

Insert this section after `## Editing a field`:

```md
## The Library

- The pane on the right lists the FHIR elements of the form's resource type that no field uses yet. Click one to add it as a field; its editor opens.
- A field added this way is named from the element and typed from it. Coded elements become a select, with options when the element lists its codes. Dates arrive as text fields; change the type in the editor.
- An element inside a group that is already on the form goes into that group.
- Search filters by name and path. The list goes two levels deep, such as `Location.address.city`.
- A survey form has no Library.
- When the builder is narrower than 980 pixels, Form and Library become tabs. Adding from the Library switches back to Form. Collapsing the sidebar can bring both panes back.
```

- [ ] **Step 2: French and Portuguese.** Translate the new step 13 and the section into `fr/forms.md` and `pt/forms.md`, inserted after `## Modifier un champ` and `## Editar um campo`. The fr and pt files have no step 13, so add only the section. Keep UI labels in English, as those files already do: **Preview**, **Fill example**, **Reset**, **Library**, **Form**. Keep the same number of bullets as the English.

- [ ] **Step 3: Web.** In `apps/web/src/docs/0.1.8/forms.md`, add each language's section after that language's `### Editing a field`, `### Modifier un champ` and `### Editar um campo`, with `###` headings.

- [ ] **Step 4: Run the docs tests.** `pnpm --filter @openldr/studio exec vitest run src/docs` and `pnpm --filter @openldr/web exec vitest run`. Expected: PASS for both.

- [ ] **Step 5: Commit.** `git commit -m "docs(forms): describe the preview sheet, the Library and the narrow tabs"`

---

### Task 7: Verify, merge, changelog

- [ ] **Step 1: Both gates on the branch.**

```bash
pnpm turbo run test --force > /tmp/s3-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s3-tc.txt 2>&1; echo "exit=$?"
```

Both must print `exit=0`. On a test failure, run `grep -n "Test timed out" /tmp/s3-test.txt` first, and re-run that package alone.

- [ ] **Step 2: Browser, desktop.** `preview_start` the `api` and `studio` configurations from `.claude/launch.json`. The studio's base path is `/studio/`, so the forms list is `http://localhost:5173/studio/forms`. The operator signs in; never type credentials. If the tab is already signed in, carry on.

Make a throwaway `Location` form through the studio's own API module in the page, as S1 and S2 did:

```js
const api = await import('/studio/src/api.ts');
```

The schema must carry the full envelope, or data entry reports "Form schema is invalid": `id`, `name`, `versionLabel`, `fhirVersion`, `fhirResourceType`, `fhirProfileUrl`, `facilityId`, `version`, `active`, `status`, `createdAt`, `updatedAt`, `fields`, `sections`, `targetPages`. Call `createForm`, then `updateForm` with `schema.id` set to the returned id. Give it one group bound to `Location.address`. Open `/studio/forms/<id>/builder` and check:

- The Library sits on the right under "All Location elements". Its count drops by one each time an element is added.
- Clicking `Location.alias` adds a repeatable "Alias" field and opens its editor. Cancel keeps it. Undo removes it.
- Clicking `Location.address.city` puts "City" inside the address group.
- Clicking `Location.status` makes a select with `active`, `suspended` and `inactive`.
- Searching "addr" narrows the list.
- The page `⋯` menu has Preview. It opens a right sheet whose `⋯` has Fill example and Reset, clear of the close control. Escape closes it.
- Switching the form to `Questionnaire` through the API and reloading shows no Library.

Compare against corlix `apps/desktop/test-output/p14-2-library-pane/01-library.png` and `p14-3-narrow-tabs/`.

- [ ] **Step 3: Narrow and phone.** `resize_window` to 900x800. The workspace is under 980, so the tabs show, opening on Form. Add something from the Library tab; it switches back to Form. Then use preset `mobile` (375x812) and reload. The tabs show, nothing scrolls sideways (`document.documentElement.scrollWidth === innerWidth`), and Preview opens full width. Reset with preset `desktop`. Nothing in S3 is anchored to the bottom edge.

Delete the throwaway form with `api.deleteForm(id)`. Stop both servers before the gates on `main`.

- [ ] **Step 4: Merge, gates on main, changelog.**

```bash
git switch main
git merge --no-ff feat/form-builder-s3 -m "Merge branch 'feat/form-builder-s3'"
pnpm turbo run test --force > /tmp/s3-main-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s3-main-tc.txt 2>&1; echo "exit=$?"
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog after form builder S3 merge"
git branch -d feat/form-builder-s3
```

Both gates must print `exit=0` before the changelog commit. Do not push.

- [ ] **Step 5: Report.** The commits, both gate results with the command and exit code, screenshots, anything that was stopped rather than fixed, and a plain line that nothing in S3 is bottom-anchored.

---

## Side list carried from S1 and S2 (not S3 work)

- **Data-entry step.** CE's `FormRuntime` seems to store a group's child answers flat, while `toQuestionnaireResponse` reads them as a list of instances at `answers[group.id]` (`response.ts:41`). Unverified. Corlix's `matchesDiscriminator` and `discriminatorSeed`, and a reader for `referenceDependsOn` and `referenceSearchable`, belong there too.
- **Terminology.** `terminology/ValueSetBuilder.tsx:103` calls the recomputing `expandValueSet` for its preview. It may wipe a seeded FHIR set's stored codes. Unverified.
- **Seed drift.** The dev database's Lab order form targets `ActivityDefinition` and `SpecimenDefinition`, which CE's reference search cannot resolve (`ENTITY_TARGETS` is `['Patient']`). `samples/forms.ts:338` says `http://loinc.org`. Check which installs carry the old targets.
- **Once, during S2's browser checks,** the builder jumped to the Dashboard with no Vite reload logged. The guess is a sign-in refresh. Not reproduced.
- **Phone:** the discriminator condition inputs are narrow at 375px and clip their text. Corlix's row has the same shape.
