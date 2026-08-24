# FHIR path validation, Phase 3 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop an operator typing a wrong FHIR path in the first place, by proposing the real elements and showing what each one means.

**Architecture:** The form builder's free-text FHIR Path input becomes a searchable picker over the generated R4 path table, scoped to the form's resource type, with the element's official FHIR definition shown underneath. Free text stays accepted, so a gap in the table never blocks anyone. No new component: the studio already has a free-typing combobox primitive that fits.

**Tech Stack:** React 18, TypeScript 5.7, shadcn and Radix primitives, Tailwind, vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-21-fhir-path-validation-design.md`

**Earlier phases (merged):** `docs/superpowers/plans/2026-08-21-fhir-path-validation.md`, `docs/superpowers/plans/2026-08-21-fhir-path-validation-phase-2.md`

## Global Constraints

- Never add a `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailer. Commit messages carry no agent attribution.
- Commit messages follow conventional commits. `feat`, `fix`, `perf` reach the public changelog; `chore`, `docs`, `test` do not.
- No em dashes anywhere, in code comments, docs, or commit messages. No emoji in headings or bullets.
- Run the full gate with `pnpm turbo run test`. Never pipe turbo through `tail`. A gate failure is usually a timeout: grep for `Test timed out` and rerun that package alone before blaming a change.
- shadcn and the existing `components/ui/` primitives only. Never a native `<select>`, `<button>`, `<input>`, or `<dialog>`.
- Form fields put the label left and the input right: `grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3`. `MappingEditor` already uses exactly this.
- Actions live in a `MoreHorizontal` dropdown, never a standalone button. This plan adds no action, so nothing here should introduce one.
- `h-dvh`, never `h-screen`, on anything full-height.
- Do not hardcode clinical vocabulary. FHIR structural element names are not clinical vocabulary.

## Facts this plan is built on

Every one was measured in the working tree on 2026-08-24, not assumed. Several contradict the Phase 3 outline written on 2026-08-21, which is superseded by this document.

- **A suitable combobox already exists.** `apps/studio/src/components/ui/suggest-combobox.tsx` exports `SuggestCombobox`: it proposes options but never constrains the answer, filters on both option value and option label, has keyboard navigation and full ARIA combobox wiring, and carries loading / ready / error states. Do not build another one.
- **The documented Sheet trap does not apply.** The outline warned that a portalled `PopoverContent` inside a Sheet cannot scroll, because `react-remove-scroll` only permits the Sheet's own subtree. `SuggestCombobox` uses no Popover and no portal; it renders an absolutely positioned listbox with its own `max-h-64 overflow-y-auto` (`suggest-combobox.tsx:131`). Its own doc comment says it avoided the Popover primitive deliberately. The trap belongs to `combobox.tsx`, which this plan does not touch.
- **The bundle cost is already paid.** The generated table ships in the studio bundle today, verified by building the studio and grepping `dist/assets/` for the string `District name (aka county)`, which hits. It arrived through Phase 2's lint rule, which calls `fhirPathsFor` at `packages/forms/src/lint-fhir-path.ts:46`. The main chunk is 5.25 MB and the table is roughly 150 KB of it. **The outline's dynamic-import question is moot; there is no incremental bundle cost to this phase.**
- `apps/studio/src/App.tsx:21` imports `FormBuilderPage` statically. There is no route-level code splitting to hang a dynamic import on anyway.
- **`fhirPathsFor` is not free to repurpose.** Phase 2's depth gate calls it. The picker needs a differently filtered list, so it needs its own accessor.
- **Structural noise is a third of the table.** Of 1596 rows, 497 have `id`, `extension`, or `modifierExtension` as a non-leading segment. Nobody binds a form field to `Location.identifier.id`. Trimmed, the table is 1099 rows: Location 77, DiagnosticReport 67, Organization 79, Practitioner 82, Patient 115, Specimen 124, Encounter 138, ServiceRequest 176, Observation 241.
- **The picker must degrade for 136 resource types.** `apps/studio/src/forms-builder/BuilderHeader.tsx` offers `FHIR_RESOURCE_TYPES`, 145 entries. The table covers 9. For the rest, `fhirPathsFor` returns an empty array.
- `MappingEditor` renders inside `FieldEditorSheet`'s `<Sheet>`, whose `SheetContent` already carries `overflow-y-auto` (`FieldEditorSheet.tsx:93`).
- **`apps/studio` does not depend on `@openldr/fhir`.** Checked `apps/studio/package.json`: no entry. The generated table reaches the studio bundle transitively, through `@openldr/forms/pure` to `lint-fhir-path.ts` to `@openldr/fhir/paths`. Importing it directly needs the dependency added, or pnpm's strict resolution will not find it.
- **`FieldEditorSheetProps` carries no schema and no resource type.** Its props are `field`, `allFields`, `sections`, `languages`, `open`, `onOpenChange`, `onSave`, `onCancel` (`FieldEditorSheet.tsx:37-46`). The prop must be added and threaded from `FormBuilderPage`, which holds `schema` in state.
- **`MappingEditor.test.tsx` already exists.** Extend it and match its existing render helpers; do not create a parallel set.
- `SuggestCombobox` renders exactly one line per option, `labelOf(opt)`, wrapped in `TruncatedText` (`suggest-combobox.tsx:158`). It does not render the value separately.
- The current input's placeholder is `e.g. Patient.name` (`MappingEditor.tsx:58`), which advertises a grammar the shipped Facility form does not use. Canonical is resource-prefixed.

---

## Design decision: where the definition appears

`SuggestCombobox` shows one line per option and filters on value **and** label. That gives two places the definition can help, and they need different strings.

**In the list**, each option's label is the path and the definition joined by two spaces:
`Location.address.district  District name (aka county)`.
Path first, so truncation eats the definition rather than the path. This also makes the list searchable by meaning: an operator who thinks "county" finds `address.district` even though the path never says county. That search behaviour is the single most valuable thing this phase adds, because it is what the original bug needed and did not have.

**Under the input**, the current value's definition alone, in muted text, matching the spec's wording.

`SuggestCombobox` is not modified. It is a shared primitive that `FormRuntime` also uses, and widening it to a two-line option would change every `suggest` field in the app.

**Known limitation, stated up front:** the under-input hint reflects the committed value, not the option the operator is currently arrowing over. `SuggestCombobox` does not expose its active index. The list label carries the definition too, which is what makes this acceptable rather than a gap.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/fhir/src/paths/index.ts` | Adds `fhirPathOptionsFor`, the picker-facing accessor that trims structural noise. |
| `packages/fhir/src/paths/index.test.ts` | Its tests. |
| `apps/studio/src/forms-builder/field-editor/MappingEditor.tsx` | Swaps the free-text input for the picker, adds the definition hint, fixes the placeholder. |
| `apps/studio/src/forms-builder/field-editor/MappingEditor.test.tsx` | Its tests. |

Four files. The accessor lives in `packages/fhir` beside `fhirPathsFor` rather than in the studio, so the noise list has one home and the lint rules and the picker cannot drift apart on what counts as a bindable element.

---

### Task 1: The picker-facing accessor

**Files:**
- Modify: `packages/fhir/src/paths/index.ts`
- Test: `packages/fhir/src/paths/index.test.ts`

**Interfaces:**
- Consumes: `R4_PATHS`, `fhirPathsFor`, `FhirPathInfo`, all already in that module.
- Produces: `export function fhirPathOptionsFor(resourceType: string): FhirPathInfo[]`

Same shape as `fhirPathsFor`, minus rows whose path contains `id`, `extension`, or `modifierExtension` as a non-leading segment.

**Do not change `fhirPathsFor`.** Phase 2's depth gate calls it at `packages/forms/src/lint-fhir-path.ts:46`, and a path bound to `Location.identifier.id` must stay **valid** even though nobody should be offered it. Trimming the lint view would make `unknown-fhir-path` fire at publish-blocking severity on a path that is real.

- [ ] **Step 1: Write the failing test**

Append to `packages/fhir/src/paths/index.test.ts`:

```ts
describe('fhirPathOptionsFor', () => {
  it('drops structural noise that nobody binds a form field to', () => {
    const paths = fhirPathOptionsFor('Location').map((r) => r.path);
    expect(paths).not.toContain('Location.identifier.id');
    expect(paths).not.toContain('Location.extension');
    expect(paths).not.toContain('Location.address.extension');
  });

  it('keeps every real element, including the ones this whole workstream is about', () => {
    const paths = fhirPathOptionsFor('Location').map((r) => r.path);
    expect(paths).toContain('Location.address.district');
    expect(paths).toContain('Location.address.state');
    expect(paths).toContain('Location.address.city');
    expect(paths).toContain('Location.physicalType');
    expect(paths).toContain('Location.identifier.value');
  });

  it('keeps a leading segment that happens to share a noise name', () => {
    // `Patient.identifier` is a real element. Only NON-LEADING id/extension segments are noise.
    expect(fhirPathOptionsFor('Patient').map((r) => r.path)).toContain('Patient.identifier');
  });

  it('trims about a third of the table, and leaves a list a person can browse', () => {
    // Measured 2026-08-24: 1596 rows total, 1099 after trimming, Location 77.
    expect(fhirPathOptionsFor('Location')).toHaveLength(77);
    expect(fhirPathOptionsFor('Observation').length).toBeGreaterThan(200);
  });

  it('carries the definition, which is the point of the picker', () => {
    const district = fhirPathOptionsFor('Location').find((r) => r.path === 'Location.address.district');
    expect(district?.label).toBe('District name (aka county)');
  });

  it('returns an empty array for a resource type the table does not cover', () => {
    // The builder offers 145 resource types; the table covers 9. The picker must degrade.
    expect(fhirPathOptionsFor('Condition')).toEqual([]);
  });

  it('never returns more than fhirPathsFor, which stays untrimmed for the lint rules', () => {
    expect(fhirPathOptionsFor('Location').length).toBeLessThan(fhirPathsFor('Location').length);
    expect(fhirPathsFor('Location').map((r) => r.path)).toContain('Location.identifier.id');
  });
});
```

Add `fhirPathOptionsFor` to the existing import from `./index` at the top of that file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/fhir test -- paths/index
```

Expected: FAIL, `fhirPathOptionsFor is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `packages/fhir/src/paths/index.ts`, after `fhirPathsFor`:

```ts
/**
 * Segments that are FHIR plumbing rather than something a form field binds to.
 *
 * Only meaningful in a NON-LEADING position. `Patient.identifier` is a real element; nobody binds
 * to `Patient.identifier.id`.
 */
const STRUCTURAL_SEGMENTS: ReadonlySet<string> = new Set(['id', 'extension', 'modifierExtension']);

function isStructuralNoise(path: string): boolean {
  return path.split('.').some((segment, index) => index > 0 && STRUCTURAL_SEGMENTS.has(segment));
}

/**
 * The paths to OFFER a person in a picker, as opposed to the paths that are VALID.
 *
 * Separate from `fhirPathsFor` on purpose. That one feeds the lint rules, which must keep treating
 * `Location.identifier.id` as a real element: `unknown-fhir-path` is a publish-blocking error, so
 * trimming its view would reject a path that genuinely exists. This one feeds the builder's
 * picker, where the same row is noise. Measured 2026-08-24: 497 of 1596 rows are trimmed here.
 */
export function fhirPathOptionsFor(resourceType: string): FhirPathInfo[] {
  return fhirPathsFor(resourceType).filter((info) => !isStructuralNoise(info.path));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/fhir test -- paths/index
```

Expected: PASS. If the Location count is not 77, do not edit the expectation. Re-derive it and report, because it means the generated table changed.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @openldr/fhir typecheck
```

```bash
git add packages/fhir/src/paths/index.ts packages/fhir/src/paths/index.test.ts
git commit -m "feat(fhir): offer only bindable FHIR paths to a picker"
```

---

### Task 2: The picker in the form builder

**Files:**
- Modify: `apps/studio/src/forms-builder/field-editor/MappingEditor.tsx`
- Test: `apps/studio/src/forms-builder/field-editor/MappingEditor.test.tsx`

**Interfaces:**
- Consumes: `fhirPathOptionsFor` from `@openldr/fhir/paths` (Task 1); `SuggestCombobox` from `@/components/ui/suggest-combobox`.
- Produces: `MappingEditor` gains a required `fhirResourceType: string | null` prop.

`MappingEditor` currently takes `{ field, onUpdate }`. It has no access to the form's resource type, and the picker cannot scope itself without one. Add the prop and thread it from the caller.

**Everything else in `MappingEditor` stays as it is.** API Property, Observation Extract, Value Set URL, Binding Strength, and the whole Advanced section are untouched.

- [ ] **Step 1: Add the workspace dependency**

`apps/studio` does not currently depend on `@openldr/fhir`. The table reaches its bundle transitively today, but a direct import needs a direct dependency under pnpm.

```bash
pnpm --filter @openldr/studio add @openldr/fhir@workspace:*
```

Confirm `apps/studio/package.json` gained `"@openldr/fhir": "workspace:*"` under `dependencies`.

- [ ] **Step 2: Write the failing tests**

`apps/studio/src/forms-builder/field-editor/MappingEditor.test.tsx` already exists. **Extend it.** Reuse whatever render helper it already defines rather than adding a second one, and adapt the helper below to match its existing shape. Every existing test in that file must keep passing; if one breaks, it is because the new required prop changed the render, and the fix is to supply the prop, never to delete the test.

```tsx
const baseField = {
  id: 'f1', fhirPath: null, displayLabel: 'Zone', description: null, fieldType: 'suggest',
  required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' },
} as FormField;

function renderEditor(overrides: Partial<FormField> = {}, resourceType: string | null = 'Location') {
  const onUpdate = vi.fn();
  render(<MappingEditor field={{ ...baseField, ...overrides }} fhirResourceType={resourceType} onUpdate={onUpdate} />);
  return { onUpdate };
}

describe('MappingEditor FHIR path picker', () => {
  it('offers the real elements of the form resource type when the operator types', async () => {
    renderEditor();
    const input = screen.getByLabelText('FHIR Path');
    await userEvent.type(input, 'address.dist');
    expect(await screen.findByRole('option', { name: /Location\.address\.district/ })).toBeInTheDocument();
  });

  it('finds an element by what it MEANS, not only by its path', async () => {
    // This is the case the whole workstream exists for. Someone thinking "county" must be able
    // to find address.district, whose path never contains that word.
    renderEditor();
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'county');
    expect(await screen.findByRole('option', { name: /Location\.address\.district/ })).toBeInTheDocument();
  });

  it('commits the path alone when an option is picked, not the label', async () => {
    const { onUpdate } = renderEditor();
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'address.dist');
    await userEvent.click(await screen.findByRole('option', { name: /Location\.address\.district/ }));
    expect(onUpdate).toHaveBeenCalledWith({ fhirPath: 'Location.address.district' });
  });

  it('shows the official definition under the input for the current value', () => {
    renderEditor({ fhirPath: 'Location.address.district' });
    expect(screen.getByText('District name (aka county)')).toBeInTheDocument();
  });

  it('shows no definition for a path the table does not know', () => {
    renderEditor({ fhirPath: 'Location.address.zone' });
    expect(screen.queryByTestId('fhir-path-definition')).not.toBeInTheDocument();
  });

  it('still accepts free text, so a gap in the table never blocks anyone', async () => {
    const { onUpdate } = renderEditor();
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'Location.address.zone');
    expect(onUpdate).toHaveBeenLastCalledWith({ fhirPath: 'Location.address.zone' });
  });

  it('clears the path to null when the box is emptied', async () => {
    const { onUpdate } = renderEditor({ fhirPath: 'Location.name' });
    await userEvent.clear(screen.getByLabelText('FHIR Path'));
    expect(onUpdate).toHaveBeenLastCalledWith({ fhirPath: null });
  });

  it('degrades to a plain free-text field for an uncovered resource type', async () => {
    // The builder offers 145 resource types and the table covers 9. An empty picker must not
    // look broken, and must never stop someone typing.
    const { onUpdate } = renderEditor({}, 'Condition');
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'onsetDateTime');
    expect(onUpdate).toHaveBeenLastCalledWith({ fhirPath: 'onsetDateTime' });
  });

  it('degrades the same way when the form declares no resource type at all', async () => {
    const { onUpdate } = renderEditor({}, null);
    await userEvent.type(screen.getByLabelText('FHIR Path'), 'name');
    expect(onUpdate).toHaveBeenLastCalledWith({ fhirPath: 'name' });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/studio test -- MappingEditor
```

Expected: FAIL. `MappingEditor` takes no `fhirResourceType`, and the input is a plain `Input` with no options.

- [ ] **Step 4: Widen the props**

In `MappingEditor.tsx`, change:

```tsx
export interface MappingEditorProps {
  field: FormField;
  onUpdate: (patch: Partial<FormField>) => void;
}
```

to:

```tsx
export interface MappingEditorProps {
  field: FormField;
  /**
   * The form's `fhirResourceType`, which scopes the path picker. Null, or any of the 136 resource
   * types the generated table does not cover, degrades the picker to a plain free-text box rather
   * than showing an empty list that looks broken.
   */
  fhirResourceType: string | null;
  onUpdate: (patch: Partial<FormField>) => void;
}
```

and add `fhirResourceType` to the destructured parameters.

- [ ] **Step 5: Replace the input with the picker**

Add the imports:

```tsx
import { SuggestCombobox } from '@/components/ui/suggest-combobox';
import { fhirPathOptionsFor, lookupFhirPath } from '@openldr/fhir/paths';
```

Inside the component, before the return:

```tsx
  // Two spaces, not a dash: the path must survive truncation, and the label is what
  // SuggestCombobox both DISPLAYS and SEARCHES. Searching by definition is the point, because
  // an operator thinking "county" will not type "district".
  const pathOptions = React.useMemo(
    () => fhirPathOptionsFor(fhirResourceType ?? ''),
    [fhirResourceType],
  );
  const pathLabels = React.useMemo(() => {
    const labels: Record<string, string> = {};
    for (const option of pathOptions) {
      labels[option.path] = option.label ? `${option.path}  ${option.label}` : option.path;
    }
    return labels;
  }, [pathOptions]);

  const currentDefinition = field.fhirPath ? lookupFhirPath(field.fhirPath)?.label ?? null : null;
```

Replace the FHIR Path `<Input>` block with:

```tsx
          {/* FHIR Path */}
          <Label htmlFor="mapping-fhir-path" className="whitespace-nowrap">
            FHIR Path
          </Label>
          <div className="min-w-0">
            <SuggestCombobox
              id="mapping-fhir-path"
              label="FHIR Path"
              value={field.fhirPath ?? ''}
              onChange={(next) => onUpdate({ fhirPath: next || null })}
              options={pathOptions.map((option) => option.path)}
              optionLabels={pathLabels}
              placeholder={fhirResourceType ? `e.g. ${fhirResourceType}.name` : 'e.g. Patient.name'}
              noSuggestionsLabel="No matching element in FHIR R4"
            />
            {currentDefinition && (
              <p data-testid="fhir-path-definition" className="mt-1 text-xs text-muted-foreground">
                {currentDefinition}
              </p>
            )}
          </div>
```

The placeholder now names the form's own resource type instead of always saying `Patient.name`, which advertised a grammar the shipped Facility form does not use.

Wrapping in `<div className="min-w-0">` keeps the two-column grid intact: the grid's second track is `minmax(0,1fr)` and the combobox positions its listbox against its own wrapper.

- [ ] **Step 6: Thread the prop from the caller**

`FieldEditorSheetProps` carries no schema and no resource type today, so this is two edits, not one.

In `FieldEditorSheet.tsx`, add to `FieldEditorSheetProps`:

```tsx
  /** The form's FHIR resource type, forwarded to MappingEditor to scope its path picker. */
  fhirResourceType: string | null;
```

Add `fhirResourceType` to the destructured parameters and pass it to `<MappingEditor>`.

In `FormBuilderPage.tsx`, pass `fhirResourceType={schema.fhirResourceType}` to `<FieldEditorSheet>`. That component holds `schema` in state already.

`FieldEditorSheet.test.tsx` and `FormBuilderPage.test.tsx` will need the new required prop supplied wherever they render these components.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/studio test -- MappingEditor
pnpm --filter @openldr/studio test -- FieldEditorSheet
pnpm --filter @openldr/studio test -- FormBuilderPage
```

Expected: all pass. The second and third catch a prop threaded wrongly.

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm --filter @openldr/studio typecheck
```

```bash
git add apps/studio/src/forms-builder/field-editor/MappingEditor.tsx apps/studio/src/forms-builder/field-editor/MappingEditor.test.tsx apps/studio/src/forms-builder/FieldEditorSheet.tsx apps/studio/src/forms-builder/FormBuilderPage.tsx
git commit -m "feat(studio): pick a FHIR path from the real R4 elements, with its definition"
```

Adjust the staged paths to whatever you actually changed in step 6.

---

### Task 3: Verify it in the running app, including on a phone

**Files:** none. This task changes no code.

Screenshots and observed behaviour are the deliverable. If something is wrong, report it rather than fixing it here; a fix gets its own commit and its own review.

- [ ] **Step 1: Start the studio**

Use the browser preview tooling, not a raw shell command. If `.claude/launch.json` has no studio entry, create one for the studio dev server.

- [ ] **Step 2: Exercise the picker on the Facility form**

Open the forms builder for the Facility form, open a field, and confirm:

- Typing `address` proposes the real `Location.address.*` elements
- Typing `county` proposes `Location.address.district`, which is the case this workstream exists for
- Picking an option stores the path alone, and the definition appears underneath
- Typing something absent from the table is still accepted

Capture a screenshot with the list open.

- [ ] **Step 3: Confirm the listbox scrolls inside the Sheet**

This is the one interaction the Phase 3 outline predicted would break. `SuggestCombobox` uses no portal, so it is expected to work, but expected is not verified.

Open the field editor sheet, open the picker on a resource type with a long list (Observation has 241 options), and confirm the listbox scrolls on its own and the sheet behind it does not fight it.

- [ ] **Step 4: Mobile**

Resize to 375x812, reload so any load-time device gates re-run, and repeat step 2. Confirm the listbox is reachable, the input does not overflow the grid, and the definition wraps rather than pushing the layout wide.

Capture a screenshot.

- [ ] **Step 5: Say what a headless browser cannot prove**

Headless Chromium has no retractable URL bar, so `100vh` and `100dvh` measure the same and every bottom-edge check passes either way. If any part of what you verified sits against the bottom edge, say plainly that only a real phone can confirm it, and do not report it as verified.

- [ ] **Step 6: Write the findings**

Report the observed behaviour for each step, attach the screenshots, and list anything that looked wrong. Do not commit; this task has no code.

---

### Task 4: Gate and changelog

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run test --concurrency=4 --force
```

Do not pipe through `tail`. If something fails, grep for `Test timed out` and rerun that package alone before blaming a change. `@openldr/sync` and `@openldr/bootstrap` have both timed out under load on this machine recently and passed in isolation.

- [ ] **Step 2: Typecheck the workspace**

```bash
pnpm turbo run typecheck
```

- [ ] **Step 3: Stop and report**

The merge is the operator's decision, and `pnpm make:changelog` reads git history so it cannot run correctly before it. Report the gate result and stop.

- [ ] **Step 4: After the merge, regenerate the changelog**

```bash
pnpm make:changelog
```

```bash
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
```

---

## Definition of done, per `AGENTS.md` section 6

| | Covered by |
|---|---|
| UI | Tasks 2 and 3. |
| CLI parity | Not applicable. This phase adds no operator capability, only an easier way to enter a value `openldr forms lint` already checks. |
| Docs, en/fr/pt | Not applicable. `en/forms.md` already documents the four lint codes, and this phase adds no new code or concept. If the picker changes what the guide's screenshots show, that is a docs-screenshot pass, not this slice. |
| Mobile view | Task 3 step 4, at 375x812. |
| Landing changelog | Task 4 step 4, after the merge. |

## What this phase does not prove

- **That the definition is visible while browsing.** The under-input hint reflects the committed value, not the option under the cursor. `SuggestCombobox` does not expose its active index, and widening that shared primitive would change every `suggest` field in the app. The list label carries the definition too, which is the mitigation.
- **That the picker helps on the 136 uncovered resource types.** It degrades to the free-text box those forms have today. Widening the table is a generator change: 145 types at depth 3 is roughly 25,000 rows and 2.4 MB, so it is a deliberate non-goal.
- **That a real phone behaves like the 375x812 emulation.** See Task 3 step 5.
- **That an operator now maps correctly.** This makes the right answer easier to find and the wrong one visible. Phase 2's rules are what actually reject a wrong path.
