# Form builder S7: Suggested codes

**Status:** merged to `main` on 2026-09-14 as `eb80932f`. The checkboxes below were not ticked while the work ran, so they do not show what was done. Git history does.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** Offer codes for a field in the Codes block, each labelled with where it came from, and let an author add one with a click. Adding a code CE lacks also adds it to the terminology, with an Undo.

**Architecture:** A pure module in `@openldr/forms` counts the codes other forms put on a FHIR path and ranks them after a bound set's codes. A new server file adds three routes under `/api/forms/code-suggestions`: one read, and a guarded import and undo that never overwrite or delete a term they did not add. The store gets the four small reads and writes those routes need. In the studio, `CodeSuggestionPanel` sits above the term search in `CodesEditor`. It works out the set URL itself (the field's own set, or FHIR's standard binding from S6), because the server has no `@openldr/fhir` dependency.

**Tech Stack:** TypeScript, vitest, pg-mem, Fastify, React 18, Testing Library, Radix via shadcn `components/ui`.

**Spec:** `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, section 5, S7. Row A7.

## Read this first: state when this plan was written

- Written 2026-09-14 at `main` `f7457f5b`, after S4 merged. **S5 was in progress** in the same checkout, on `feat/form-builder-s5`, with uncommitted edits to `forms-routes.ts`, `forms-routes.test.ts` and `test-helpers.ts`. **S6 had not started.** Run this plan only after S6 is merged; Task 0 checks. S7 edits `CodesEditor.tsx`, `FieldEditorSheet.tsx`, `FormBuilderPage.tsx`, `api.ts`, `app.ts` and the forms docs, which S5 and S6 also touch. If an anchor below is missing, stop and report; do not guess where it went.
- Corlix is at `~/Projects/Repositories/corlix`. Its source for this slice is `apps/desktop/src/main/code-suggestions.ts`, `apps/desktop/src/renderer/lib/codeSuggestions.ts`, `components/form-builder/CodeSuggestionPanel.tsx` and the `forms.suggest.*` strings in its English locale.
- A `pre:edit-write` GateGuard hook blocks the first Edit or Write to each file until you state four facts: the importers, the public names affected, any data files read, and the operator's instruction. Answer it and retry. Its loop and scope warnings are noise.

## RULE 0: each gap, checked 2026-09-14

| Row | The fact that would make it not real | What the code says |
|---|---|---|
| A7 | The builder already suggests codes | `grep -rni suggest apps/studio/src/forms-builder` finds only the path combobox (`MappingEditor.tsx:14`) and the language list (`LanguageControl.tsx:71`). `CodesEditor.tsx` is a chip list and a term search, nothing else |

The spec's plan for the import failed the same check. The operator ruled on 2026-09-14.

1. **`createTerm` would overwrite a curated term.** The spec says adding a code "creates the term through `createTerm`". That route calls `terms.create`, which is an upsert: `onConflict(['system','code']).doUpdateSet(display, status, properties)` (`packages/db/src/terminology-admin-store.ts:734-743`). Importing a code CE already holds would replace its display, status and properties with the suggestion's. Corlix refuses an already-present code instead (`code-suggestions.ts`, `importSuggestedCode`).
2. **`deleteTerm` would let Undo remove any term.** `terms.delete` deletes whatever row matches (`terminology-admin-store.ts:763-769`). An Undo that ran after someone else curated the same code would delete their work. Corlix's undo deletes only rows it created, which it marks with an id prefix.
3. **Both term routes need `terminology.manage`** (`apps/server/src/terminology-admin-routes.ts:162,184`). The spec left open what an author without it sees.

**Rulings:** add guarded import and undo routes: insert only when absent, and delete only a term the builder added. Show a code CE lacks to an author without `terminology.manage`, greyed, with a line saying who can add it.

Two further adaptations follow from the code, not from a ruling:

- **The route cannot leave out the codes already on the field.** The spec puts that filter on the route. The field being edited is an unsaved draft, so the server cannot see its codes. The panel filters them, as corlix's does.
- **The server cannot look up FHIR's standard binding.** `apps/server/package.json` does not depend on `@openldr/fhir`. The panel works out the set URL and sends it as `valueSetUrl`, which the spec's route already takes.

## Flag for the operator before Task 4

**The Binding source suggests a field's answer codes as its own codes.** A field's `code` becomes the Questionnaire item's code (`packages/forms/src/to-questionnaire.ts:135-136`), which extraction uses as the Observation code. A bound set lists the values an answer may take. So on `Patient.gender`, the Binding rows are male, female, other and unknown, offered as codes for the question. Corlix does the same with the field's own set; the spec adds FHIR's standard binding on top. The plan follows the spec. If the operator rules the standard-binding fallback out, delete the `lookupBinding` line in Task 4 Step 5 and the test "falls back to FHIR's standard binding" in Step 1. "Your forms" is not affected: it lists codes other forms put on the field itself.

## Global Constraints

- Match corlix's shipped behavior, except where the spec, the rulings and the adaptations above say otherwise. Add nothing beyond them.
- Codes of a bound set are read as stored, from `valueset_expansions`. Never call `valueSets.expand()` or `expandValueSet`: they recompute and overwrite the stored codes.
- No migration. Form storage does not change. Data entry does not change.
- UI strings are plain English literals, like the rest of `forms-builder`. No i18n keys.
- shadcn components only in new app code. Never a native `<button>`, `<select>`, `<input>` or `<dialog>`.
- Row actions go in a `⋯` `DropdownMenu` (AGENTS.md §5). A suggestion row is itself the add control, like a Library row (`LibraryPane.tsx:99-104`), so it needs no menu.
- `StripedEmpty` for the empty state, `LoadingState` while loading, never stripes for an error (AGENTS.md §5, `VersionHistorySheet.tsx:90-100`).
- Never hardcode clinical vocabulary (AGENTS.md §8). Source code names no codes; tests may.
- Never pipe turbo through `tail`. Never read `$?` through a pipe. Redirect to a file, then echo the exit code.
- No `Co-Authored-By` trailers on commits (AGENTS.md §9).
- Work on branch `feat/form-builder-s7`. Merge to local `main` at the end. Do not push. Do not open a PR.

## Decisions and adaptations, each with its reason

- **Two sources, as the spec says.** Corlix's third source reads a cache of uninstalled marketplace forms. CE has none, and an installed form template becomes an ordinary form.
- **"Your forms" counts forms, not codings.** Corlix counts every coding, so a form that repeats a code on two fields counts twice, while its label says "used in N forms". CE counts each form once, so the number matches the words.
- **Paths are compared resolved.** Corlix compares `fhirPath` strings as they are. CE has two path grammars (`fhir-path.ts:6-12`): the Practitioner sample writes bare paths. `tallyFormCodes` resolves each field's path with its form's resource type, and the panel sends a resolved path.
- **The form being edited is left out** of "Your forms", by `formId`. The spec says "other forms". Its saved copy may be stale next to the draft anyway.
- **Ranking:** binding codes first, then by count, highest first, then by code, then by system. A code in both sources is listed once, as Binding, and carries its count. Ties compare strings by code point, not `localeCompare`, so the order does not depend on the server's locale.
- **Binding codes are active stored codes only**, ordered by code then system. That pair is unique within a set, so the order is stable on Postgres (AGENTS.md §7). Corlix filters `inactive = 0` and orders by code.
- **Binding codes no form uses are capped at 50 in the panel.** The largest held set has 4,000 codes (measured for S6). Without a cap, the panel draws 4,000 rows and pushes every "Your forms" code below them, since binding ranks first. Rows with a count are never hidden. A line says how many were left out and points to the search. Corlix draws them all. This is the one addition beyond corlix; strike it if the operator disagrees.
- **Import tags the term** with `metadata: { addedBy: 'code-suggestion' }`, stored as `properties.meta` (`packProps`, `terminology-admin-store.ts:234-241`). Undo deletes only a term carrying that tag. Corlix marks its rows with an id prefix; CE terms have no id of their own.
- **Import answers 422 for an unknown system and 409 for a code CE holds.** Neither writes. The display defaults to the code, because `TermInput.display` is required. Both routes audit as `term.create` and `term.delete`, like the term routes, with `via: 'code-suggestion'` in the metadata.
- **The read route is gated on `forms.view`**, like the other forms reads. It shows only what that capability can already read: forms, and the terms the ungated term search returns. Import and undo take `terminology.manage`, the term routes' gate.
- **The routes live in their own file**, `code-suggestion-routes.ts`, registered beside the forms routes. `forms-routes.ts` is 400 lines and the S5 session was editing it. Fastify matches the static `code-suggestions` segment before `/api/forms/:id`, whatever the registration order.
- **Undo removes the term and leaves the code on the field**, as corlix does. The notice says what was added to the terminology, and Undo takes back exactly that.
- **After an import, the panel marks the row as held**, and back again after Undo. Corlix leaves the flag stale until the list reloads.
- **A refused import does not add the code to the field**, as in corlix. The pointer to the Terminology page is text, not a link: following a link out of the builder drops the unsaved draft.
- **The empty-state text drops corlix's claim** that SNOMED CT and ICD-11 ship empty. Nobody has checked that for CE.
- **No CLI command.** This is an authoring aid inside the builder, not an admin or maintenance feature (AGENTS.md §6.2).

## File map

| File | Change |
|---|---|
| `packages/forms/src/code-suggestions.ts` + test | new: tally, rank, offer |
| `packages/forms/src/pure.ts`, `index.ts` | export it |
| `packages/forms/src/store.ts` + `store.test.ts` | `listDefinitions` |
| `packages/db/src/terminology-admin-store.ts` + test | `terms.existing`, `terms.createIfAbsent`, `terms.deleteIfAddedBy`, `valueSets.storedCodes` |
| `apps/server/src/code-suggestion-routes.ts` + test | new: the three routes |
| `apps/server/src/app.ts` | register them |
| `docs/HTTP-API.md` | three rows |
| `apps/studio/src/api.ts` | `codeSuggestions`, `importSuggestedCode`, `undoSuggestedCode` |
| `apps/studio/src/forms-builder/field-editor/CodeSuggestionPanel.tsx` + test | new |
| `apps/studio/src/forms-builder/field-editor/CodesEditor.tsx` + test | the panel, above the search |
| `apps/studio/src/forms-builder/FieldEditorSheet.tsx` + test, `FormBuilderPage.tsx` | pass `formId` |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`, `apps/web/src/docs/0.1.8/forms.md` | new section |

---

### Task 0: Preconditions and branch

- [ ] **Step 1: S6 is in.** `ls packages/fhir/src/paths/r4-bindings.generated.ts apps/studio/src/forms-builder/valueSetBinding.ts`. Both must list. Then `grep -n "export function lookupBinding" packages/fhir/src/paths/index.ts` must print one line. If any check fails, stop and tell the operator.

- [ ] **Step 2: A clean tree on `main`.** `git status --short` must print nothing, and `git branch --show-current` must print `main`. If another session's work is in the tree, stop and tell the operator; do not stash or commit it.

- [ ] **Step 3: Branch.**

```bash
git switch -c feat/form-builder-s7
```

---

### Task 1: Count, rank and offer suggestions

**Files:**
- Create: `packages/forms/src/code-suggestions.ts`, `code-suggestions.test.ts`
- Modify: `packages/forms/src/pure.ts`, `packages/forms/src/index.ts`

**Interfaces:** Produces, from `@openldr/forms` and `@openldr/forms/pure`:
- `type CodeSuggestionSource = 'binding' | 'your-forms'`
- `interface CodeSuggestion { system: string; code: string; display: string | null; source: CodeSuggestionSource; count?: number; inTerminology: boolean }`
- `interface TalliedCode { system: string; code: string; display: string | null; count: number }`
- `codingKey(system: string, code: string): string`
- `tallyFormCodes(forms: readonly SuggestionForm[], path: string, excludeFormId?: string | null): TalliedCode[]`, where `SuggestionForm = { id: string; fhirResourceType: string | null | undefined; schema: { fields?: readonly Pick<FormField, 'fhirPath' | 'code'>[] } }`
- `rankCodeSuggestions(input: { binding: readonly { system: string; code: string; display: string | null }[]; yourForms: readonly TalliedCode[]; known: ReadonlySet<string> }): CodeSuggestion[]`
- `offerSuggestions(rows: readonly CodeSuggestion[], held: readonly { system: string; code: string }[], limit: number): { shown: CodeSuggestion[]; hidden: number }`

- [ ] **Step 1: Failing test.** Create `packages/forms/src/code-suggestions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FormField } from './schema/form-schema';
import { codingKey, offerSuggestions, rankCodeSuggestions, tallyFormCodes, type CodeSuggestion } from './code-suggestions';

const field = (id: string, fhirPath: string | null, code?: FormField['code']): FormField => ({
  id, fhirPath, displayLabel: id, description: null, fieldType: 'text', required: false, enabled: true,
  order: 0, cardinality: { min: 0, max: '1' }, ...(code ? { code } : {}),
});
const form = (id: string, fhirResourceType: string | null, fields: FormField[]) => ({ id, fhirResourceType, schema: { fields } });

const HB = { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' };
const WBC = { system: 'http://loinc.org', code: '6690-2', display: 'WBC' };

describe('tallyFormCodes', () => {
  it('counts each code once per form, on the same path only', () => {
    const rows = tallyFormCodes([
      form('a', 'Observation', [field('x', 'Observation.code', [HB]), field('y', 'Observation.code', [HB, WBC])]),
      form('b', 'Observation', [field('x', 'Observation.code', [HB])]),
      form('c', 'Observation', [field('x', 'Observation.category', [WBC])]),
    ], 'Observation.code');
    expect(rows).toEqual([{ ...HB, count: 2 }, { ...WBC, count: 1 }]);
  });

  it('matches a bare path through the form resource type', () => {
    expect(tallyFormCodes([form('a', 'Observation', [field('x', 'code', [HB])])], 'Observation.code'))
      .toEqual([{ ...HB, count: 1 }]);
  });

  it('leaves out the form being edited', () => {
    expect(tallyFormCodes([form('a', 'Observation', [field('x', 'Observation.code', [HB])])], 'Observation.code', 'a'))
      .toEqual([]);
  });

  it('keeps the first display it finds, and skips a coding with no code', () => {
    const rows = tallyFormCodes([
      form('a', 'Observation', [field('x', 'Observation.code', [{ system: HB.system, code: HB.code }, { system: HB.system, code: '' }])]),
      form('b', 'Observation', [field('x', 'Observation.code', [HB])]),
    ], 'Observation.code');
    expect(rows).toEqual([{ ...HB, count: 2 }]);
  });

  it('reads a form with no field list as empty', () => {
    expect(tallyFormCodes([{ id: 'a', fhirResourceType: 'Observation', schema: {} }], 'Observation.code')).toEqual([]);
  });
});

describe('rankCodeSuggestions', () => {
  it('puts binding codes first, then your forms by count, and marks the codes CE holds', () => {
    const ranked = rankCodeSuggestions({
      binding: [{ system: 's', code: 'b2', display: 'B2' }, { system: 's', code: 'b1', display: null }],
      yourForms: [
        { system: 's', code: 'f1', display: 'F1', count: 1 },
        { system: 's', code: 'f2', display: 'F2', count: 3 },
        { system: 's', code: 'b2', display: 'from a form', count: 2 },
      ],
      known: new Set([codingKey('s', 'f2')]),
    });
    expect(ranked.map((r) => r.code)).toEqual(['b2', 'b1', 'f2', 'f1']);
    expect(ranked[0]).toEqual({ system: 's', code: 'b2', display: 'B2', source: 'binding', count: 2, inTerminology: false });
    expect(ranked[1]).toEqual({ system: 's', code: 'b1', display: null, source: 'binding', inTerminology: false });
    expect(ranked[2]).toEqual({ system: 's', code: 'f2', display: 'F2', source: 'your-forms', count: 3, inTerminology: true });
  });

  it('breaks a tie on code by system, whatever the input order', () => {
    const ranked = rankCodeSuggestions({
      binding: [],
      yourForms: [{ system: 'z', code: 'c', display: null, count: 1 }, { system: 'a', code: 'c', display: null, count: 1 }],
      known: new Set(),
    });
    expect(ranked.map((r) => r.system)).toEqual(['a', 'z']);
  });

  it('lists a code the binding repeats only once', () => {
    const b = { system: 's', code: 'x', display: 'X' };
    expect(rankCodeSuggestions({ binding: [b, b], yourForms: [], known: new Set() })).toHaveLength(1);
  });
});

describe('offerSuggestions', () => {
  const row = (code: string, source: CodeSuggestion['source'], count?: number): CodeSuggestion => ({
    system: 's', code, display: null, source, ...(count !== undefined ? { count } : {}), inTerminology: true,
  });

  it('leaves out codes already on the field', () => {
    expect(offerSuggestions([row('a', 'binding'), row('b', 'your-forms', 1)], [{ system: 's', code: 'a' }], 50))
      .toEqual({ shown: [row('b', 'your-forms', 1)], hidden: 0 });
  });

  it('caps binding codes no form uses, and never hides a counted code', () => {
    const rows = [row('a', 'binding', 2), row('b', 'binding'), row('c', 'binding'), row('d', 'your-forms', 1)];
    expect(offerSuggestions(rows, [], 1)).toEqual({
      shown: [row('a', 'binding', 2), row('b', 'binding'), row('d', 'your-forms', 1)],
      hidden: 1,
    });
  });
});
```

- [ ] **Step 2: Run, watch it fail.** `pnpm --filter @openldr/forms exec vitest run src/code-suggestions.test.ts`. Expected: fails to resolve `./code-suggestions`.

- [ ] **Step 3: Write `packages/forms/src/code-suggestions.ts`.**

```ts
import type { FormField } from './schema/form-schema';
import { resolveFhirPath } from './fhir-path';

/**
 * Suggested codes for a field in the form builder (spec S7, row A7). Pure. Ported from corlix
 * `apps/desktop/src/renderer/lib/codeSuggestions.ts` and the counting half of
 * `main/code-suggestions.ts`, with two sources instead of three: a bound ValueSet's stored codes,
 * and the codes other forms put on the same FHIR path.
 */

export type CodeSuggestionSource = 'binding' | 'your-forms';

export interface CodeSuggestion {
  system: string;
  code: string;
  display: string | null;
  source: CodeSuggestionSource;
  /** How many other forms put this code on the path. Absent when none do. */
  count?: number;
  /** Whether CE holds the code as a term. Adding one it lacks writes a term. */
  inTerminology: boolean;
}

export interface TalliedCode {
  system: string;
  code: string;
  display: string | null;
  count: number;
}

export interface SuggestionForm {
  id: string;
  fhirResourceType: string | null | undefined;
  schema: { fields?: readonly Pick<FormField, 'fhirPath' | 'code'>[] };
}

export function codingKey(system: string, code: string): string {
  return `${system}|${code}`;
}

/**
 * Every code other forms put on `path`, with the number of forms that use it. A form counts once
 * per code, however many of its fields carry it, so the number means "used in N forms". Each
 * field's path is resolved with its form's resource type, because CE has bare and prefixed paths
 * (`fhir-path.ts`). `path` must already be resolved.
 */
export function tallyFormCodes(forms: readonly SuggestionForm[], path: string, excludeFormId?: string | null): TalliedCode[] {
  const rows = new Map<string, TalliedCode>();
  for (const form of forms) {
    if (excludeFormId && form.id === excludeFormId) continue;
    const fields = Array.isArray(form.schema?.fields) ? form.schema.fields : [];
    const seen = new Set<string>();
    for (const field of fields) {
      if (resolveFhirPath(field.fhirPath, form.fhirResourceType) !== path) continue;
      for (const c of field.code ?? []) {
        if (!c.system || !c.code) continue;
        const key = codingKey(c.system, c.code);
        let row = rows.get(key);
        if (!row) {
          row = { system: c.system, code: c.code, display: null, count: 0 };
          rows.set(key, row);
        }
        if (!row.display && c.display) row.display = c.display;
        if (!seen.has(key)) {
          seen.add(key);
          row.count += 1;
        }
      }
    }
  }
  return [...rows.values()];
}

/** Code-point order, so the ranking does not change with the server's locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One list, binding codes first, then by count, highest first, then by code, then by system. A
 * code in both sources is listed once, as Binding, with its count. `known` holds `codingKey`s of
 * the codes CE holds as terms.
 */
export function rankCodeSuggestions(input: {
  binding: readonly { system: string; code: string; display: string | null }[];
  yourForms: readonly TalliedCode[];
  known: ReadonlySet<string>;
}): CodeSuggestion[] {
  const tallies = new Map(input.yourForms.map((t) => [codingKey(t.system, t.code), t]));
  const out = new Map<string, CodeSuggestion>();
  for (const b of input.binding) {
    const key = codingKey(b.system, b.code);
    if (out.has(key)) continue;
    const tally = tallies.get(key);
    out.set(key, {
      system: b.system,
      code: b.code,
      display: b.display ?? tally?.display ?? null,
      source: 'binding',
      ...(tally ? { count: tally.count } : {}),
      inTerminology: input.known.has(key),
    });
  }
  for (const t of input.yourForms) {
    const key = codingKey(t.system, t.code);
    if (out.has(key)) continue;
    out.set(key, { system: t.system, code: t.code, display: t.display, source: 'your-forms', count: t.count, inTerminology: input.known.has(key) });
  }
  const rank = (s: CodeSuggestionSource) => (s === 'binding' ? 0 : 1);
  return [...out.values()].sort((a, b) =>
    rank(a.source) - rank(b.source)
    || (b.count ?? 0) - (a.count ?? 0)
    || compare(a.code, b.code)
    || compare(a.system, b.system));
}

/**
 * What the panel draws: the ranked rows minus the codes already on the field, with binding codes
 * no form uses capped at `limit`. A bound set can hold thousands of codes, and binding ranks
 * first, so without the cap they would bury every code your forms use. A row with a count is never
 * hidden. `hidden` is how many were left out.
 */
export function offerSuggestions(
  rows: readonly CodeSuggestion[],
  held: readonly { system: string; code: string }[],
  limit: number,
): { shown: CodeSuggestion[]; hidden: number } {
  const heldKeys = new Set(held.map((c) => codingKey(c.system, c.code)));
  const shown: CodeSuggestion[] = [];
  let uncounted = 0;
  let hidden = 0;
  for (const row of rows) {
    if (heldKeys.has(codingKey(row.system, row.code))) continue;
    if (row.count === undefined) {
      if (uncounted >= limit) {
        hidden += 1;
        continue;
      }
      uncounted += 1;
    }
    shown.push(row);
  }
  return { shown, hidden };
}
```

- [ ] **Step 4: Export.** Add `export * from './code-suggestions';` to `packages/forms/src/pure.ts`, after `export * from './survey-mode';`, and to `packages/forms/src/index.ts` at the same place. The module imports only a type and `fhir-path`, so it is browser-safe.

- [ ] **Step 5: Run, watch it pass.** Same command as Step 2, then `pnpm --filter @openldr/forms typecheck > /tmp/s7-t1-tc.txt 2>&1; echo "exit=$?"`, expecting `exit=0`.

- [ ] **Step 6: Commit.**

```bash
git add packages/forms/src/code-suggestions.ts packages/forms/src/code-suggestions.test.ts packages/forms/src/pure.ts packages/forms/src/index.ts
git commit -m "feat(forms): count, rank and offer suggested codes for a FHIR path"
```

---

### Task 2: The reads and guarded writes the routes need

**Files:**
- Modify: `packages/forms/src/store.ts`, `packages/forms/src/store.test.ts`
- Modify: `packages/db/src/terminology-admin-store.ts`, `packages/db/src/terminology-admin-store.test.ts`

**Interfaces:** Produces:
- `FormStore.listDefinitions(): Promise<FormDefinition[]>`
- `TerminologyAdminStore.terms.existing(pairs: { system: string; code: string }[]): Promise<{ system: string; code: string }[]>`
- `TerminologyAdminStore.terms.createIfAbsent(input: TermInput): Promise<Term | null>`
- `TerminologyAdminStore.terms.deleteIfAddedBy(system: string, code: string, tag: string): Promise<boolean>`
- `TerminologyAdminStore.valueSets.storedCodes(id: string): Promise<ExpandedConcept[]>`

- [ ] **Step 1: Failing forms store test.** In `packages/forms/src/store.test.ts`, inside `describe('createFormStore', …)`, append:

```ts
  it('lists every definition with its schema, for the builder suggested codes', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);
    const input = (name: string) => ({ name, versionLabel: 'v1', fhirResourceType: 'Questionnaire', fhirVersion: 'R4', schema: schema(name), targetPages: ['forms'] });
    const a = await store.create(input('Form A'));
    const b = await store.create(input('Form B'));

    const defs = await store.listDefinitions();
    expect(defs.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
    expect(defs.find((d) => d.id === a.id)?.schema).toEqual(schema('Form A'));
  });
```

`schema(name)` is the file's existing helper; the first test already calls it with a name.

- [ ] **Step 2: Failing terminology store tests.** In `packages/db/src/terminology-admin-store.test.ts`, inside `describe('terms', …)`, append:

```ts
    describe('for the builder suggested codes', () => {
      const base = { status: 'ACTIVE' as const, shortName: null, class: null, unit: null, replacedBy: null };
      const TAG = { addedBy: 'code-suggestion' };

      it('existing returns only the pairs CE holds', async () => {
        const { s } = await store();
        await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', ...base, metadata: null });
        expect(await s.terms.existing([
          { system: 'http://x', code: 'AMP' },
          { system: 'http://x', code: 'GEN' },
          { system: 'http://y', code: 'AMP' },
        ])).toEqual([{ system: 'http://x', code: 'AMP' }]);
        expect(await s.terms.existing([])).toEqual([]);
      });

      it('createIfAbsent adds a missing term with its tag', async () => {
        const { s } = await store();
        const t = await s.terms.createIfAbsent({ system: 'http://x', code: 'GEN', display: 'Gentamicin', ...base, metadata: TAG });
        expect(t).toMatchObject({ system: 'http://x', code: 'GEN', display: 'Gentamicin', status: 'ACTIVE', metadata: TAG });
      });

      it('createIfAbsent never overwrites a curated term', async () => {
        const { s } = await store();
        await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', ...base, metadata: null });
        expect(await s.terms.createIfAbsent({ system: 'http://x', code: 'AMP', display: 'AMP', ...base, metadata: TAG })).toBeNull();
        const { rows } = await s.terms.search('http://x', { limit: 10, offset: 0 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ display: 'Ampicillin', metadata: null });
      });

      it('deleteIfAddedBy deletes only a term carrying the tag', async () => {
        const { s } = await store();
        await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', ...base, metadata: null });
        await s.terms.createIfAbsent({ system: 'http://x', code: 'GEN', display: 'Gentamicin', ...base, metadata: TAG });
        expect(await s.terms.deleteIfAddedBy('http://x', 'AMP', 'code-suggestion')).toBe(false);
        expect(await s.terms.deleteIfAddedBy('http://x', 'NOPE', 'code-suggestion')).toBe(false);
        expect(await s.terms.deleteIfAddedBy('http://x', 'GEN', 'code-suggestion')).toBe(true);
        const { rows } = await s.terms.search('http://x', { limit: 10, offset: 0 });
        expect(rows.map((r) => r.code)).toEqual(['AMP']);
      });
    });
```

Inside `describe('valueSets namespace', …)`, append:

```ts
    it('storedCodes reads the stored active codes in order, and never recomputes', async () => {
      const { s: admin, db } = await store();
      await db.insertInto('terminology_concepts').values([
        { system: 's1', code: 'B', display: 'Beta', status: 'ACTIVE' },
        { system: 's1', code: 'A', display: 'Alpha', status: 'ACTIVE' },
      ] as never).execute();
      const vs = await admin.valueSets.save({
        url: 'urn:test:vs-stored', version: null, name: null, title: 'stored', status: 'active',
        experimental: false, description: null, compose: { include: [{ system: 's1' }] },
      });
      await db.insertInto('valueset_expansions')
        .values({ value_set_id: vs.id, system_url: 's1', code: 'C', display: 'Gone', inactive: true } as never).execute();
      // A term removed after the expansion stays in the stored codes. A recompute would drop it.
      await db.deleteFrom('terminology_concepts').where('system', '=', 's1').where('code', '=', 'B').execute();

      expect(await admin.valueSets.storedCodes(vs.id)).toEqual([
        { system: 's1', code: 'A', display: 'Alpha' },
        { system: 's1', code: 'B', display: 'Beta' },
      ]);
    });
```

`store()` is the file's helper at the top of `describe('terminology admin store', …)`; it returns `{ db, s }`.

- [ ] **Step 3: Run, watch them fail.**

```bash
pnpm --filter @openldr/forms exec vitest run src/store.test.ts
pnpm --filter @openldr/db exec vitest run src/terminology-admin-store.test.ts
```

Expected: `listDefinitions`, `existing`, `createIfAbsent`, `deleteIfAddedBy` and `storedCodes` are not functions.

- [ ] **Step 4: `listDefinitions`.** In `packages/forms/src/store.ts`, after `async function list()`, add:

```ts
  /**
   * Every form definition with its schema. The builder's suggested codes scan them in JavaScript
   * (spec S7). Ordered by id, so two calls return the same order.
   */
  async function listDefinitions(): Promise<FormDefinition[]> {
    const rows = await db.selectFrom('form_definitions').selectAll().orderBy('id').execute();
    return rows.map((r) => toDefinition(r as FormRow));
  }
```

Add `listDefinitions` to the returned object, after `list`:

```ts
  return { get, list, listDefinitions, listPublished, create, update, setStatus, delete: deleteForm, publish, duplicate, restore, listVersions, getVersion };
```

If S5 added names to that object, keep them; add only `listDefinitions`.

- [ ] **Step 5: The terminology interface.** In `packages/db/src/terminology-admin-store.ts`, in the `terms:` block of `interface TerminologyAdminStore`, after `importRows(…)`, add:

```ts
    /** The pairs from `pairs` that CE holds as terms. For the builder's suggested codes. */
    existing(pairs: { system: string; code: string }[]): Promise<{ system: string; code: string }[]>;
    /**
     * Insert a term only when `(system, code)` is absent, and return null when it was already
     * there, without touching that row. `create` is an upsert and would overwrite a curated
     * display, status and properties; the builder's suggested-code import must not.
     */
    createIfAbsent(input: TermInput): Promise<Term | null>;
    /**
     * Delete a term only when its metadata says `addedBy === tag`, and return whether it did. The
     * builder's Undo uses it, so Undo can never remove a term someone else curated.
     */
    deleteIfAddedBy(system: string, code: string, tag: string): Promise<boolean>;
```

In the `valueSets:` block of the interface, after `getByUrl(…)`, add:

```ts
    /**
     * A set's stored active codes, ordered by code then system, which is unique within a set.
     * Reads `valueset_expansions` as they are. `expand` recomputes and overwrites them; this never does.
     */
    storedCodes(id: string): Promise<ExpandedConcept[]>;
```

`ExpandedConcept` is already exported from this file (`export type { ExpandedConcept, VsCompose } from './value-set-expander'`). If the interface cannot see it, add it to the file's existing `import type … from './value-set-expander'`.

- [ ] **Step 6: The terms implementations.** In the `terms:` object of `createTerminologyAdminStore`, after `importRows`, add:

```ts
      async existing(pairs) {
        const bySystem = new Map<string, string[]>();
        for (const p of pairs) {
          const codes = bySystem.get(p.system) ?? [];
          codes.push(p.code);
          bySystem.set(p.system, codes);
        }
        const found: { system: string; code: string }[] = [];
        for (const [system, codes] of bySystem) {
          // Batched: a bound set can hold thousands of codes, past a statement's parameter limit.
          for (let i = 0; i < codes.length; i += 1000) {
            const rows = await db.selectFrom('terminology_concepts').select(['system', 'code'])
              .where('system', '=', system).where('code', 'in', codes.slice(i, i + 1000)).execute();
            found.push(...rows);
          }
        }
        return found;
      },
      async createIfAbsent(input) {
        const props = packProps(input);
        const inserted = await db.insertInto('terminology_concepts').values({
          system: input.system, code: input.code, display: input.display, status: input.status,
          properties: props === null ? null : (JSON.stringify(props) as never),
        }).onConflict((oc) => oc.columns(['system', 'code']).doNothing()).returningAll().executeTakeFirst();
        if (!inserted) return null;
        // Sync S3: one terminology_system signal per concept edit, as `create` does.
        await markTerminologyChanged(db, input.system);
        return termRow(inserted, await mappingCountFor(input.system, input.code));
      },
      async deleteIfAddedBy(system, code, tag) {
        const row = await db.selectFrom('terminology_concepts').select(['properties'])
          .where('system', '=', system).where('code', '=', code).executeTakeFirst();
        if (!row) return false;
        const raw = row.properties as unknown;
        const props = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { meta?: { addedBy?: unknown } } | null;
        if (props?.meta?.addedBy !== tag) return false;
        await db.deleteFrom('terminology_concepts').where('system', '=', system).where('code', '=', code).execute();
        await markTerminologyChanged(db, system);
        return true;
      },
```

`onConflict(…).doNothing()).returningAll().executeTakeFirst()` has a precedent under pg-mem at `packages/db/src/report-store.ts:72`.

- [ ] **Step 7: `storedCodes`.** In the `valueSets:` object, after `getByUrl`, add:

```ts
      async storedCodes(id) {
        const rows = await db.selectFrom('valueset_expansions').select(['system_url', 'code', 'display'])
          .where('value_set_id', '=', id).where('inactive', '=', false)
          .orderBy('code').orderBy('system_url').execute();
        return rows.map((r) => ({ system: r.system_url, code: r.code, display: r.display }));
      },
```

- [ ] **Step 8: Run, watch them pass.** Same commands as Step 3. Then:

```bash
pnpm --filter @openldr/forms typecheck > /tmp/s7-t2-forms-tc.txt 2>&1; echo "exit=$?"
pnpm --filter @openldr/db typecheck > /tmp/s7-t2-db-tc.txt 2>&1; echo "exit=$?"
```

Both must print `exit=0`.

- [ ] **Step 9: Commit.**

```bash
git add packages/forms/src/store.ts packages/forms/src/store.test.ts packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts
git commit -m "feat(db,forms): read forms and stored codes, and add or remove only a term the builder added"
```

---

### Task 3: The routes

**Files:**
- Create: `apps/server/src/code-suggestion-routes.ts`, `code-suggestion-routes.test.ts`
- Modify: `apps/server/src/app.ts`, `docs/HTTP-API.md`

**Interfaces:**
- Consumes: Task 1's `codingKey`, `rankCodeSuggestions`, `tallyFormCodes`; Task 2's store methods.
- Produces: `GET /api/forms/code-suggestions?fhirPath=&valueSetUrl=&formId=` → `200 CodeSuggestion[]`, `400` without `fhirPath`, gated on `forms.view`. `POST /api/forms/code-suggestions/import` body `{ system, code, display? }` → `201 Term`, `422 { error: 'unknown-system' }`, `409 { error: 'already-present' }`. `POST /api/forms/code-suggestions/undo` body `{ system, code }` → `204`, `409 { error: 'not-added-here' }`. Both writes gated on `terminology.manage`. `registerCodeSuggestionRoutes(app, ctx)` and `SUGGESTION_TAG = 'code-suggestion'`.

- [ ] **Step 1: Failing route tests.** Create `apps/server/src/code-suggestion-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerCodeSuggestionRoutes } from './code-suggestion-routes';
import './auth-plugin';

type AuditInput = Parameters<AppContext['audit']['record']>[0];
type FakeTerm = { system: string; code: string; meta?: Record<string, unknown> | null };

const LOINC = 'http://loinc.org';
const AUTHOR = ['forms.view', 'forms.edit'];
const CURATOR = [...AUTHOR, 'terminology.manage'];

function fakeCtx(held: FakeTerm[] = []) {
  const audits: AuditInput[] = [];
  const terms = new Map(held.map((t) => [`${t.system}|${t.code}`, t]));
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    audit: {
      record: async (input: AuditInput) => {
        audits.push(input);
        return { ...input, id: `audit-${audits.length}`, occurredAt: '2026-01-01T00:00:00.000Z' };
      },
    },
    forms: {
      listDefinitions: async () => [
        { id: 'form-a', fhirResourceType: 'Observation', schema: { fields: [
          { id: 'x', fhirPath: 'Observation.code', code: [{ system: LOINC, code: '718-7', display: 'Hemoglobin' }] },
        ] } },
        { id: 'form-b', fhirResourceType: 'Observation', schema: { fields: [
          { id: 'x', fhirPath: 'code', code: [{ system: LOINC, code: '718-7' }, { system: LOINC, code: '6690-2', display: 'WBC' }] },
        ] } },
      ],
    },
    terminology: {
      admin: {
        valueSets: {
          getByUrl: async (url: string) => (url === 'urn:test:vs' ? { id: 'vs-1', url } : null),
          storedCodes: async (id: string) => (id === 'vs-1' ? [{ system: LOINC, code: '2345-7', display: 'Glucose' }] : []),
        },
        codingSystems: {
          getByUrl: async (url: string) => (url === LOINC ? { id: 'cs-loinc', url } : null),
        },
        terms: {
          existing: async (pairs: { system: string; code: string }[]) => pairs.filter((p) => terms.has(`${p.system}|${p.code}`)),
          createIfAbsent: async (input: { system: string; code: string; display: string; status: string; metadata?: Record<string, unknown> | null }) => {
            const key = `${input.system}|${input.code}`;
            if (terms.has(key)) return null;
            terms.set(key, { system: input.system, code: input.code, meta: input.metadata ?? null });
            return { system: input.system, code: input.code, display: input.display, status: input.status, metadata: input.metadata ?? null, mappingCount: 0 };
          },
          deleteIfAddedBy: async (system: string, code: string, tag: string) => {
            const key = `${system}|${code}`;
            if (terms.get(key)?.meta?.addedBy !== tag) return false;
            terms.delete(key);
            return true;
          },
        },
      },
    },
  };
  return { ctx, audits, terms };
}

function appFor(ctx: unknown, capabilities: string[]) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'u1', username: 'author', displayName: null, roles: [], capabilities } as never;
  });
  registerCodeSuggestionRoutes(app, ctx as never);
  return app;
}

describe('GET /api/forms/code-suggestions', () => {
  it('ranks the binding first, then other forms by count, and marks the codes CE lacks', async () => {
    const { ctx } = fakeCtx([{ system: LOINC, code: '718-7' }]);
    const res = await appFor(ctx, AUTHOR).inject({ method: 'GET', url: '/api/forms/code-suggestions?fhirPath=Observation.code&valueSetUrl=urn:test:vs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { system: LOINC, code: '2345-7', display: 'Glucose', source: 'binding', inTerminology: false },
      { system: LOINC, code: '718-7', display: 'Hemoglobin', source: 'your-forms', count: 2, inTerminology: true },
      { system: LOINC, code: '6690-2', display: 'WBC', source: 'your-forms', count: 1, inTerminology: false },
    ]);
  });

  it('leaves out the form being edited', async () => {
    const { ctx } = fakeCtx();
    const res = await appFor(ctx, AUTHOR).inject({ method: 'GET', url: '/api/forms/code-suggestions?fhirPath=Observation.code&formId=form-b' });
    expect(res.json()).toEqual([{ system: LOINC, code: '718-7', display: 'Hemoglobin', source: 'your-forms', count: 1, inTerminology: false }]);
  });

  it('returns an empty list for a set CE lacks and a path no form uses', async () => {
    const { ctx } = fakeCtx();
    const res = await appFor(ctx, AUTHOR).inject({ method: 'GET', url: '/api/forms/code-suggestions?fhirPath=Patient.gender&valueSetUrl=urn:missing' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('refuses a request with no path', async () => {
    const { ctx } = fakeCtx();
    const res = await appFor(ctx, AUTHOR).inject({ method: 'GET', url: '/api/forms/code-suggestions' });
    expect(res.statusCode).toBe(400);
  });

  it('needs forms.view', async () => {
    const { ctx } = fakeCtx();
    const res = await appFor(ctx, []).inject({ method: 'GET', url: '/api/forms/code-suggestions?fhirPath=Observation.code' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/forms/code-suggestions/import', () => {
  const post = (ctx: unknown, caps: string[], payload: unknown) =>
    appFor(ctx, caps).inject({ method: 'POST', url: '/api/forms/code-suggestions/import', payload: payload as never });

  it('adds a missing code, tagged, and audits it', async () => {
    const { ctx, audits, terms } = fakeCtx();
    const res = await post(ctx, CURATOR, { system: LOINC, code: '6690-2', display: 'WBC' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ system: LOINC, code: '6690-2', display: 'WBC', status: 'ACTIVE', metadata: { addedBy: 'code-suggestion' } });
    expect(terms.get(`${LOINC}|6690-2`)?.meta).toEqual({ addedBy: 'code-suggestion' });
    expect(audits).toMatchObject([{ action: 'term.create', entityType: 'term', entityId: '6690-2', metadata: { system: LOINC, via: 'code-suggestion' } }]);
  });

  it('uses the code as the display when none is given', async () => {
    const { ctx } = fakeCtx();
    const res = await post(ctx, CURATOR, { system: LOINC, code: '6690-2' });
    expect(res.json()).toMatchObject({ display: '6690-2' });
  });

  it('refuses a code CE already holds, and writes nothing', async () => {
    const { ctx, audits, terms } = fakeCtx([{ system: LOINC, code: '718-7' }]);
    const res = await post(ctx, CURATOR, { system: LOINC, code: '718-7', display: 'Something else' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'already-present' });
    expect(terms.get(`${LOINC}|718-7`)?.meta).toBeUndefined();
    expect(audits).toEqual([]);
  });

  it('refuses a system CE does not know', async () => {
    const { ctx, terms } = fakeCtx();
    const res = await post(ctx, CURATOR, { system: 'http://unknown.example', code: 'X' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'unknown-system' });
    expect(terms.size).toBe(0);
  });

  it('needs terminology.manage', async () => {
    const { ctx } = fakeCtx();
    expect((await post(ctx, AUTHOR, { system: LOINC, code: '6690-2' })).statusCode).toBe(403);
  });
});

describe('POST /api/forms/code-suggestions/undo', () => {
  const post = (ctx: unknown, caps: string[], payload: unknown) =>
    appFor(ctx, caps).inject({ method: 'POST', url: '/api/forms/code-suggestions/undo', payload: payload as never });

  it('removes a code the builder added, and audits it', async () => {
    const { ctx, audits, terms } = fakeCtx([{ system: LOINC, code: '6690-2', meta: { addedBy: 'code-suggestion' } }]);
    const res = await post(ctx, CURATOR, { system: LOINC, code: '6690-2' });
    expect(res.statusCode).toBe(204);
    expect(terms.has(`${LOINC}|6690-2`)).toBe(false);
    expect(audits).toMatchObject([{ action: 'term.delete', entityType: 'term', entityId: '6690-2', metadata: { system: LOINC, via: 'code-suggestion' } }]);
  });

  it('refuses to remove a term the builder did not add', async () => {
    const { ctx, terms } = fakeCtx([{ system: LOINC, code: '718-7' }]);
    const res = await post(ctx, CURATOR, { system: LOINC, code: '718-7' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not-added-here' });
    expect(terms.has(`${LOINC}|718-7`)).toBe(true);
  });

  it('needs terminology.manage', async () => {
    const { ctx } = fakeCtx([{ system: LOINC, code: '6690-2', meta: { addedBy: 'code-suggestion' } }]);
    expect((await post(ctx, AUTHOR, { system: LOINC, code: '6690-2' })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/server exec vitest run src/code-suggestion-routes.test.ts`. Expected: fails to resolve `./code-suggestion-routes`.

- [ ] **Step 3: Write `apps/server/src/code-suggestion-routes.ts`.**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { codingKey, rankCodeSuggestions, tallyFormCodes } from '@openldr/forms';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

/**
 * Suggested codes for a field in the form builder (spec S7, row A7). Ported from corlix
 * `apps/desktop/src/main/code-suggestions.ts`, with two sources instead of three: the stored codes
 * of a ValueSet, and the codes other forms put on the same FHIR path.
 *
 * Import and undo are their own routes because the term routes do the wrong thing here. The term
 * POST is an upsert (`terms.create`), so importing a code CE already holds would overwrite its
 * curated display, status and properties. The term DELETE removes any term, so an Undo could
 * remove one someone else curated. These insert only when absent, and delete only a term they
 * added (operator ruling, 2026-09-14).
 */

/** Marks a term the builder added, in its metadata. Undo deletes only terms that carry it. */
export const SUGGESTION_TAG = 'code-suggestion';

const VIEW = { preHandler: requireCapability('forms.view') };
// Adding a code to the terminology is a terminology change, so it takes the term routes' gate.
const MANAGE = { preHandler: requireCapability('terminology.manage') };

const importInput = z.object({ system: z.string().min(1), code: z.string().min(1), display: z.string().optional() });
const undoInput = z.object({ system: z.string().min(1), code: z.string().min(1) });

export function registerCodeSuggestionRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const admin = ctx.terminology.admin;

  app.get('/api/forms/code-suggestions', VIEW, async (req, reply) => {
    const q = req.query as { fhirPath?: string; valueSetUrl?: string; formId?: string };
    const path = q.fhirPath?.trim();
    if (!path) {
      reply.code(400);
      return { error: 'fhirPath is required' };
    }
    // The panel sends the field's own set, or FHIR's standard binding for the element. The server
    // cannot look that binding up itself: it has no @openldr/fhir dependency.
    const bound = q.valueSetUrl ? await admin.valueSets.getByUrl(q.valueSetUrl) : null;
    const binding = bound ? await admin.valueSets.storedCodes(bound.id) : [];
    const yourForms = tallyFormCodes(await ctx.forms.listDefinitions(), path, q.formId || null);
    const pairs = [...binding, ...yourForms].map((c) => ({ system: c.system, code: c.code }));
    const known = new Set((await admin.terms.existing(pairs)).map((t) => codingKey(t.system, t.code)));
    return rankCodeSuggestions({ binding, yourForms, known });
  });

  app.post('/api/forms/code-suggestions/import', MANAGE, async (req, reply) => {
    const parsed = importInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.message };
    }
    const { system, code, display } = parsed.data;
    if (!(await admin.codingSystems.getByUrl(system))) {
      reply.code(422);
      return { error: 'unknown-system' };
    }
    const term = await admin.terms.createIfAbsent({
      system, code, display: display?.trim() || code, status: 'ACTIVE', metadata: { addedBy: SUGGESTION_TAG },
    });
    if (!term) {
      reply.code(409);
      return { error: 'already-present' };
    }
    await recordAudit(ctx, req, { action: 'term.create', entityType: 'term', entityId: code, before: null, after: term, metadata: { system, via: SUGGESTION_TAG } });
    reply.code(201);
    return term;
  });

  app.post('/api/forms/code-suggestions/undo', MANAGE, async (req, reply) => {
    const parsed = undoInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.message };
    }
    const { system, code } = parsed.data;
    if (!(await admin.terms.deleteIfAddedBy(system, code, SUGGESTION_TAG))) {
      reply.code(409);
      return { error: 'not-added-here' };
    }
    await recordAudit(ctx, req, { action: 'term.delete', entityType: 'term', entityId: code, before: null, after: null, metadata: { system, via: SUGGESTION_TAG } });
    reply.code(204);
    return null;
  });
}
```

- [ ] **Step 4: Register.** In `apps/server/src/app.ts`, import `registerCodeSuggestionRoutes` from `./code-suggestion-routes` beside the `registerFormsRoutes` import, and call `registerCodeSuggestionRoutes(app, ctx);` on the line after `registerFormsRoutes(app, ctx);`.

- [ ] **Step 5: HTTP-API rows.** In `docs/HTTP-API.md`, after the `/api/forms/published` row, add:

```md
| `GET` | `/api/forms/code-suggestions` | Suggested codes for a FHIR path: a ValueSet's stored codes, then codes other forms use there. |
| `POST` | `/api/forms/code-suggestions/import` | Add a suggested code to the terminology, only if absent. Needs `terminology.manage`. |
| `POST` | `/api/forms/code-suggestions/undo` | Remove a code the builder added, and nothing else. Needs `terminology.manage`. |
```

- [ ] **Step 6: Run, watch them pass.** Same command as Step 2. Then:

```bash
pnpm --filter @openldr/server typecheck > /tmp/s7-t3-tc.txt 2>&1; echo "exit=$?"
pnpm --filter @openldr/server lint > /tmp/s7-t3-lint.txt 2>&1; echo "exit=$?"
```

Both must print `exit=0`.

- [ ] **Step 7: Commit.**

```bash
git add apps/server/src/code-suggestion-routes.ts apps/server/src/code-suggestion-routes.test.ts apps/server/src/app.ts docs/HTTP-API.md
git commit -m "feat(server): suggest codes for a FHIR path, and add or undo one without touching curated terms"
```

---

### Task 4: The suggestions panel

**Files:**
- Modify: `apps/studio/src/api.ts`
- Create: `apps/studio/src/forms-builder/field-editor/CodeSuggestionPanel.tsx`, `CodeSuggestionPanel.test.tsx`

**Interfaces:**
- Consumes: Task 1's `CodeSuggestion`, `codingKey`, `offerSuggestions`; S6's `lookupBinding`; `resolveFhirPath` and `isSurveyForm` from `@openldr/forms/pure`.
- Produces, in `api.ts`: `codeSuggestions(p: { fhirPath: string; valueSetUrl?: string | null; formId?: string | null }): Promise<CodeSuggestion[]>`, `type SuggestedCodeImport = { ok: true } | { ok: false; reason: 'unknown-system' | 'already-present' }`, `importSuggestedCode(c: { system: string; code: string; display?: string | null }): Promise<SuggestedCodeImport>`, `undoSuggestedCode(c: { system: string; code: string }): Promise<void>`.
- Produces: `CodeSuggestionPanel({ field, fhirResourceType, formId, onAdd }: { field: FormField; fhirResourceType: string | null; formId: string | null; onAdd: (coding: FormFieldCoding) => void }): JSX.Element | null`.

- [ ] **Step 1: Failing test.** Create `apps/studio/src/forms-builder/field-editor/CodeSuggestionPanel.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CodeSuggestion, FormField } from '@openldr/forms/pure';
import { CodeSuggestionPanel } from './CodeSuggestionPanel';

const api = vi.hoisted(() => ({
  codeSuggestions: vi.fn(),
  importSuggestedCode: vi.fn(),
  undoSuggestedCode: vi.fn(),
}));
vi.mock('../../api', () => api);

const auth = vi.hoisted(() => ({ caps: new Set<string>() }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ hasCapability: (c: string) => auth.caps.has(c) }) }));

const LOINC = 'http://loinc.org';
const field = (extra: Partial<FormField> = {}): FormField => ({
  id: 'f', displayLabel: 'Test', fieldType: 'text', required: false, enabled: true, fhirPath: 'Observation.code',
  order: 0, cardinality: { min: 0, max: '1' }, description: null, ...extra,
});
const hb: CodeSuggestion = { system: LOINC, code: '718-7', display: 'Hemoglobin', source: 'your-forms', count: 2, inTerminology: true };
const wbc: CodeSuggestion = { system: LOINC, code: '6690-2', display: 'WBC', source: 'binding', inTerminology: false };

function renderPanel(f: FormField = field(), fhirResourceType: string | null = 'Observation') {
  const onAdd = vi.fn();
  const utils = render(<CodeSuggestionPanel field={f} fhirResourceType={fhirResourceType} formId="form-1" onAdd={onAdd} />);
  return { ...utils, onAdd };
}

beforeEach(() => {
  api.codeSuggestions.mockReset();
  api.importSuggestedCode.mockReset();
  api.undoSuggestedCode.mockReset();
  auth.caps = new Set();
});

describe('CodeSuggestionPanel', () => {
  it('draws nothing for a field with no FHIR path', () => {
    const { container } = renderPanel(field({ fhirPath: null }));
    expect(container.innerHTML).toBe('');
    expect(api.codeSuggestions).not.toHaveBeenCalled();
  });

  it('asks for the resolved path, the field set, and this form', async () => {
    api.codeSuggestions.mockResolvedValue([]);
    renderPanel(field({ fhirPath: 'code', valueSetUrl: 'urn:test:vs' }));
    await waitFor(() => expect(api.codeSuggestions).toHaveBeenCalledWith({ fhirPath: 'Observation.code', valueSetUrl: 'urn:test:vs', formId: 'form-1' }));
  });

  it("falls back to FHIR's standard binding for the element", async () => {
    api.codeSuggestions.mockResolvedValue([]);
    renderPanel(field({ fhirPath: 'Patient.gender' }), 'Patient');
    await waitFor(() => expect(api.codeSuggestions).toHaveBeenCalledWith({
      fhirPath: 'Patient.gender', valueSetUrl: 'http://hl7.org/fhir/ValueSet/administrative-gender', formId: 'form-1',
    }));
  });

  it('says the terminology is thin when nothing is found', async () => {
    api.codeSuggestions.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText(/Your terminology may be thin/)).toBeTruthy();
  });

  it('shows a failed load as an error, not as an empty list', async () => {
    api.codeSuggestions.mockRejectedValue(new Error('load suggested codes failed: 500'));
    renderPanel();
    expect(await screen.findByText('load suggested codes failed: 500')).toBeTruthy();
    expect(screen.queryByText(/thin/)).toBeNull();
  });

  it('labels each row by source and marks a code CE lacks', async () => {
    api.codeSuggestions.mockResolvedValue([wbc, hb]);
    renderPanel();
    const wbcRow = await screen.findByRole('button', { name: /WBC/ });
    expect(wbcRow.textContent).toContain('Binding');
    expect(wbcRow.textContent).toContain('not in your terminology');
    const hbRow = screen.getByRole('button', { name: /Hemoglobin/ });
    expect(hbRow.textContent).toContain('Your forms · 2');
    expect(hbRow.textContent).not.toContain('not in your terminology');
  });

  it('leaves out codes already on the field, and says so when none are left', async () => {
    api.codeSuggestions.mockResolvedValue([hb]);
    renderPanel(field({ code: [{ system: LOINC, code: '718-7' }] }));
    expect(await screen.findByText('Every suggestion for this field is already on it.')).toBeTruthy();
  });

  it('adds a code CE holds without touching the terminology', async () => {
    api.codeSuggestions.mockResolvedValue([hb]);
    const { onAdd } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Hemoglobin/ }));
    expect(onAdd).toHaveBeenCalledWith({ system: LOINC, code: '718-7', display: 'Hemoglobin' });
    expect(api.importSuggestedCode).not.toHaveBeenCalled();
  });

  it('greys a code CE lacks for an author who cannot manage terminology', async () => {
    api.codeSuggestions.mockResolvedValue([wbc]);
    renderPanel();
    const row = await screen.findByRole('button', { name: /WBC/ });
    expect((row as HTMLButtonElement).disabled).toBe(true);
    expect(row.textContent).toContain('Someone who can manage terminology must add this code first.');
  });

  it('imports a code CE lacks, says so, and Undo removes only the term', async () => {
    auth.caps = new Set(['terminology.manage']);
    api.codeSuggestions.mockResolvedValue([wbc]);
    api.importSuggestedCode.mockResolvedValue({ ok: true });
    api.undoSuggestedCode.mockResolvedValue(undefined);
    const { onAdd } = renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /WBC/ }));
    expect(await screen.findByText('Added “WBC” to your terminology.')).toBeTruthy();
    expect(api.importSuggestedCode).toHaveBeenCalledWith({ system: LOINC, code: '6690-2', display: 'WBC' });
    expect(onAdd).toHaveBeenCalledWith({ system: LOINC, code: '6690-2', display: 'WBC' });

    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(api.undoSuggestedCode).toHaveBeenCalledWith({ system: LOINC, code: '6690-2' }));
    await waitFor(() => expect(screen.queryByText(/to your terminology\./)).toBeNull());
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('refuses a code whose system CE does not know, and does not add it', async () => {
    auth.caps = new Set(['terminology.manage']);
    api.codeSuggestions.mockResolvedValue([wbc]);
    api.importSuggestedCode.mockResolvedValue({ ok: false, reason: 'unknown-system' });
    const { onAdd } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /WBC/ }));
    expect(await screen.findByText(/Add the system on the Terminology page first\./)).toBeTruthy();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('adds a code someone else added since the list loaded, with nothing to undo', async () => {
    auth.caps = new Set(['terminology.manage']);
    api.codeSuggestions.mockResolvedValue([wbc]);
    api.importSuggestedCode.mockResolvedValue({ ok: false, reason: 'already-present' });
    const { onAdd } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /WBC/ }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ system: LOINC, code: '6690-2', display: 'WBC' }));
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run, watch it fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/field-editor/CodeSuggestionPanel.test.tsx`. Expected: fails to resolve `./CodeSuggestionPanel`.

- [ ] **Step 3: API calls.** In `apps/studio/src/api.ts`, add `CodeSuggestion` to the type imports from `@openldr/forms/pure`. If the file has no such import yet, add `import type { CodeSuggestion } from '@openldr/forms/pure';` with the other imports. Then, after `deleteTerm`, add:

```ts
/**
 * Suggested codes for a field's FHIR path (spec S7). `valueSetUrl` adds that set's stored codes;
 * `formId` leaves that form out of "Your forms".
 */
export function codeSuggestions(p: { fhirPath: string; valueSetUrl?: string | null; formId?: string | null }): Promise<CodeSuggestion[]> {
  const qs = new URLSearchParams({ fhirPath: p.fhirPath });
  if (p.valueSetUrl) qs.set('valueSetUrl', p.valueSetUrl);
  if (p.formId) qs.set('formId', p.formId);
  return apiGet<CodeSuggestion[]>(`/api/forms/code-suggestions?${qs}`, 'load suggested codes');
}

export type SuggestedCodeImport = { ok: true } | { ok: false; reason: 'unknown-system' | 'already-present' };

/**
 * Add a suggested code to the terminology. The route inserts only when the code is absent, and
 * tags the term so `undoSuggestedCode` can remove it and nothing else. Its two refusals come back
 * as values, because the panel explains each; any other failure throws.
 */
export async function importSuggestedCode(c: { system: string; code: string; display?: string | null }): Promise<SuggestedCodeImport> {
  const res = await authFetch('/api/forms/code-suggestions/import', jbody({ system: c.system, code: c.code, ...(c.display ? { display: c.display } : {}) }, 'POST'));
  if (res.status === 422) return { ok: false, reason: 'unknown-system' };
  if (res.status === 409) return { ok: false, reason: 'already-present' };
  await okJson<Term>(res, 'add suggested code');
  return { ok: true };
}

/** Take back a code `importSuggestedCode` added. The route refuses any other term. */
export async function undoSuggestedCode(c: { system: string; code: string }): Promise<void> {
  const res = await authFetch('/api/forms/code-suggestions/undo', jbody(c, 'POST'));
  if (!res.ok && res.status !== 204) throw new Error(formatApiError('undo suggested code', await errorDetail(res)));
}
```

`jbody`, `okJson`, `apiGet`, `errorDetail`, `formatApiError` and `Term` are all defined above `deleteTerm` in this file.

- [ ] **Step 4: Check the import compiles.** `pnpm --filter @openldr/studio typecheck > /tmp/s7-t4-tc.txt 2>&1; echo "exit=$?"`. It fails only on the missing panel file, which Step 5 writes. Any other error: fix it before going on.

- [ ] **Step 5: Write `CodeSuggestionPanel.tsx`.**

```tsx
import * as React from 'react';
import { Plus, Undo2 } from 'lucide-react';
import { lookupBinding } from '@openldr/fhir/paths';
import {
  codingKey, isSurveyForm, offerSuggestions, resolveFhirPath,
  type CodeSuggestion, type FormField, type FormFieldCoding,
} from '@openldr/forms/pure';
import { useAuth } from '@/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { codeSuggestions, importSuggestedCode, undoSuggestedCode } from '../../api';

/** Binding codes no form uses are capped here. A bound set can hold 4,000; the search finds the rest. */
const UNCOUNTED_LIMIT = 50;

/**
 * Codes worth putting on this field, each labelled with where it came from (spec S7, row A7).
 * Ported from corlix `components/form-builder/CodeSuggestionPanel.tsx`.
 *
 * Two things it must not do. It must not imply a code does not exist when CE's terminology is only
 * thin, so an empty list says so. And it must not quietly grow the terminology: adding a code CE
 * lacks writes a term, so the panel says it did and offers Undo. Only a user who may manage
 * terminology can do that; anyone else sees such a code greyed (operator ruling, 2026-09-14).
 */
export function CodeSuggestionPanel({ field, fhirResourceType, formId, onAdd }: {
  field: FormField;
  fhirResourceType: string | null;
  formId: string | null;
  onAdd: (coding: FormFieldCoding) => void;
}): JSX.Element | null {
  const { hasCapability } = useAuth();
  const canManage = hasCapability('terminology.manage');
  const path = resolveFhirPath(field.fhirPath, fhirResourceType);
  // The field's own set wins. Otherwise FHIR's standard binding for the element, from S6. A survey
  // maps to no resource, so it has none.
  const valueSetUrl = field.valueSetUrl ?? (isSurveyForm(fhirResourceType) ? null : lookupBinding(path)?.valueSet ?? null);

  const [rows, setRows] = React.useState<CodeSuggestion[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState<{ system: string; code: string; label: string } | null>(null);

  React.useEffect(() => {
    if (!path) return;
    let alive = true;
    setRows(null);
    setLoadError(null);
    void (async () => {
      try {
        const found = await codeSuggestions({ fhirPath: path, valueSetUrl, formId });
        if (alive) setRows(found);
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [path, valueSetUrl, formId]);

  if (!path) return null;

  const coding = (s: CodeSuggestion): FormFieldCoding => ({ system: s.system, code: s.code, ...(s.display ? { display: s.display } : {}) });
  const markHeld = (target: { system: string; code: string }, inTerminology: boolean) =>
    setRows((prev) => prev?.map((r) => (r.system === target.system && r.code === target.code ? { ...r, inTerminology } : r)) ?? prev);

  async function accept(s: CodeSuggestion): Promise<void> {
    setNotice(null);
    if (s.inTerminology) {
      onAdd(coding(s));
      return;
    }
    try {
      const result = await importSuggestedCode({ system: s.system, code: s.code, display: s.display });
      if (!result.ok && result.reason === 'unknown-system') {
        setNotice('That code belongs to a coding system this installation does not have. Add the system on the Terminology page first.');
        return;
      }
      // 'already-present' means someone added the code since the list loaded. It is real, so it
      // goes on the field, with nothing to undo.
      markHeld(s, true);
      if (result.ok) setAdded({ system: s.system, code: s.code, label: s.display ?? s.code });
      onAdd(coding(s));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function undo(): Promise<void> {
    if (!added) return;
    try {
      await undoSuggestedCode({ system: added.system, code: added.code });
      markHeld(added, false);
      setAdded(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  const { shown, hidden } = offerSuggestions(rows ?? [], field.code ?? [], UNCOUNTED_LIMIT);

  return (
    <div className="space-y-1.5 py-3">
      <div className="text-xs font-medium text-muted-foreground">Suggested codes</div>

      {loadError ? (
        <p className="text-xs text-destructive">{loadError}</p>
      ) : rows === null ? (
        <LoadingState label="Looking for suggestions…" className="min-h-[4rem] rounded-md" />
      ) : rows.length === 0 ? (
        // Nothing found means the terminology is thin, not that no code exists.
        <StripedEmpty className="min-h-[4rem] rounded-md px-3 py-2">
          No suggestions yet. Your terminology may be thin rather than complete. Add codes on the Terminology page, or search below.
        </StripedEmpty>
      ) : shown.length === 0 ? (
        // Everything found is already on the field. That is a success, so no advice about the terminology.
        <p className="text-xs text-muted-foreground">Every suggestion for this field is already on it.</p>
      ) : (
        <div>
          {shown.map((s) => {
            const blocked = !s.inTerminology && !canManage;
            return (
              <Button
                key={codingKey(s.system, s.code)}
                type="button"
                variant="ghost"
                disabled={blocked}
                onClick={() => void accept(s)}
                className="group mb-0.5 h-auto w-full items-start justify-start gap-2 whitespace-normal px-2 py-1.5 text-left font-normal"
              >
                <span className="mt-0.5 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground group-hover:border-primary group-hover:text-primary">
                  <Plus className="h-2.5 w-2.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-foreground">{s.display ?? s.code}</span>
                    {s.source === 'binding' && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Binding</Badge>}
                    {s.count !== undefined && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{`Your forms · ${s.count}`}</Badge>}
                    {!s.inTerminology && <span className="text-[10px] text-primary">not in your terminology</span>}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">{`${s.code} · ${s.system}`}</span>
                  {blocked && (
                    <span className="block text-[10px] text-muted-foreground">Someone who can manage terminology must add this code first.</span>
                  )}
                </span>
              </Button>
            );
          })}
          {hidden > 0 && (
            <p className="px-2 pt-1 text-[11px] text-muted-foreground">{`${hidden} more codes from the binding. Search below to find one.`}</p>
          )}
        </div>
      )}

      {notice && <p className="text-xs text-destructive">{notice}</p>}

      {added && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
          <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">{`Added “${added.label}” to your terminology.`}</span>
          <Button type="button" variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => void undo()}>
            <Undo2 className="mr-1 h-3 w-3" />
            Undo
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run, watch it pass.** Same command as Step 2, then the studio typecheck again, expecting `exit=0`.

- [ ] **Step 7: Commit.**

```bash
git add apps/studio/src/api.ts apps/studio/src/forms-builder/field-editor/CodeSuggestionPanel.tsx apps/studio/src/forms-builder/field-editor/CodeSuggestionPanel.test.tsx
git commit -m "feat(studio): list suggested codes, labelled by source, with an undoable import"
```

---

### Task 5: The panel in the Codes block

**Files:**
- Modify: `apps/studio/src/forms-builder/field-editor/CodesEditor.tsx`, `CodesEditor.test.tsx`
- Modify: `apps/studio/src/forms-builder/FieldEditorSheet.tsx`, `FieldEditorSheet.test.tsx`
- Modify: `apps/studio/src/forms-builder/FormBuilderPage.tsx`

**Interfaces:** Consumes Task 4's `CodeSuggestionPanel` and `codeSuggestions`. Produces `CodesEditorProps.fhirResourceType?: string | null`, `CodesEditorProps.formId?: string | null`, `FieldEditorSheetProps.formId?: string | null`.

- [ ] **Step 1: Failing CodesEditor tests.** In `CodesEditor.test.tsx`, beside the existing `TermPicker` mock, add:

```tsx
// The panel has its own tests. Here it stands in for a suggestion being taken.
vi.mock('./CodeSuggestionPanel', () => ({
  CodeSuggestionPanel: ({ onAdd }: { onAdd: (c: { system: string; code: string; display?: string }) => void }) => (
    <button type="button" onClick={() => onAdd({ system: 'http://loinc.org', code: '6690-2', display: 'WBC' })}>
      Take suggestion
    </button>
  ),
}));
```

Append inside the `describe`:

```tsx
  it('appends a suggested code to the field', () => {
    const onUpdate = vi.fn();
    render(<CodesEditor field={{ ...BASE_FIELD, code: [{ system: 'http://loinc.org', code: '718-7' }] }} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText('Take suggestion'));
    expect(onUpdate).toHaveBeenCalledWith({
      code: [{ system: 'http://loinc.org', code: '718-7' }, { system: 'http://loinc.org', code: '6690-2', display: 'WBC' }],
    });
  });

  it('never adds a suggested code twice', () => {
    const onUpdate = vi.fn();
    render(<CodesEditor field={{ ...BASE_FIELD, code: [{ system: 'http://loinc.org', code: '6690-2' }] }} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText('Take suggestion'));
    expect(onUpdate).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Failing FieldEditorSheet test.** In `FieldEditorSheet.test.tsx`, add `codeSuggestions: vi.fn(async () => []),` to the `vi.mock('../api', …)` override, beside `listCodingSystems`. Add `waitFor` to the `@testing-library/react` import and `import * as api from '../api';` below the imports. Append inside the top `describe`:

```tsx
  it('asks for suggested codes with the resolved path and the form id', async () => {
    renderSheet({ field: { ...BASE_FIELD, fhirPath: 'name' }, formId: 'form-1' });
    await waitFor(() => expect(vi.mocked(api.codeSuggestions)).toHaveBeenCalledWith({
      fhirPath: 'Location.name', valueSetUrl: null, formId: 'form-1',
    }));
  });
```

`renderSheet` passes `fhirResourceType="Location"`; FHIR binds no set to `Location.name`.

- [ ] **Step 3: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/field-editor/CodesEditor.test.tsx src/forms-builder/FieldEditorSheet.test.tsx`. Expected: "Take suggestion" is not found, and `formId` is not a prop.

- [ ] **Step 4: CodesEditor.** In `CodesEditor.tsx`:
- Import `CodeSuggestionPanel` from `./CodeSuggestionPanel`.
- Add two props to `CodesEditorProps`:

```tsx
  /** The form's resource type. Resolves a bare path for the suggestions. */
  fhirResourceType?: string | null;
  /** The saved form's id, left out of "Your forms". Null for a form never saved. */
  formId?: string | null;
```

- Take them in the signature: `export function CodesEditor({ field, onUpdate, fhirResourceType = null, formId = null }: CodesEditorProps): JSX.Element {`.
- Add one paragraph to the component's doc comment: "Above the term search, `CodeSuggestionPanel` offers codes from the field's ValueSet and from other forms on the same path (spec S7)."
- After `const [pickerValue, …]`, add:

```tsx
  // A suggestion can land after an await, by which time the author may have added another code.
  // Read the latest list, not the one this render closed over.
  const codesRef = React.useRef(codes);
  codesRef.current = codes;

  function addSuggested(coding: FormFieldCoding): void {
    const current = codesRef.current;
    if (current.some((c) => c.system === coding.system && c.code === coding.code)) return;
    onUpdate({ code: [...current, coding] });
  }
```

- Between the chip list and the `{/* Add a new coding */}` block, add:

```tsx
      <CodeSuggestionPanel field={field} fhirResourceType={fhirResourceType} formId={formId} onAdd={addSuggested} />
```

- [ ] **Step 5: FieldEditorSheet and the page.** In `FieldEditorSheet.tsx`, add to `FieldEditorSheetProps`, after `fhirResourceType`:

```tsx
  /** The saved form's id, so suggested codes leave this form out. Null for a form never saved. */
  formId?: string | null;
```

Take `formId = null` in the destructured props, and change the Codes line to:

```tsx
          <CodesEditor field={activeDraft} onUpdate={patchDraft} fhirResourceType={fhirResourceType} formId={formId} />
```

In `FormBuilderPage.tsx`, in the `<FieldEditorSheet` element, add `formId={formId}` after `fhirResourceType={…}`. `formId` is the page's existing state (`const [formId, setFormId] = useState<string | null>(id ?? null);`).

- [ ] **Step 6: Run, watch them pass.** Same command as Step 3. Then the whole builder suite and the typecheck:

```bash
pnpm --filter @openldr/studio exec vitest run src/forms-builder > /tmp/s7-t5-test.txt 2>&1; echo "exit=$?"
pnpm --filter @openldr/studio typecheck > /tmp/s7-t5-tc.txt 2>&1; echo "exit=$?"
```

Both must print `exit=0`. If a test whose `../api` mock is a full factory now logs a missing `codeSuggestions` export, add `codeSuggestions: vi.fn(async () => [])` to that factory. The panel catches the error either way; the mock keeps the output clean.

- [ ] **Step 7: Commit.**

```bash
git add apps/studio/src/forms-builder/field-editor/CodesEditor.tsx apps/studio/src/forms-builder/field-editor/CodesEditor.test.tsx apps/studio/src/forms-builder/FieldEditorSheet.tsx apps/studio/src/forms-builder/FieldEditorSheet.test.tsx apps/studio/src/forms-builder/FormBuilderPage.tsx
git commit -m "feat(studio): suggest codes above the term search in the Codes block"
```

Add any test file Step 6 touched to the same commit.

---

### Task 6: Docs

**Files:** `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md` and `apps/web/src/docs/0.1.8/forms.md`.

- [ ] **Step 1: English.** In `en/forms.md`, insert this section directly after the `## Options and ValueSets` section that S6 added. If that section is missing, stop and report.

```md
## Suggested codes

- For a field with a FHIR path, the Codes block lists **Suggested codes** above the term search.
- A **Binding** code comes from the field's ValueSet, or from the set FHIR binds the element to. **Your forms · N** means N other forms put that code on the same path.
- Click a row to put the code on the field.
- **not in your terminology** marks a code CE does not hold. Adding it also adds it to your terminology, and the panel says so, with **Undo**. Undo removes it from your terminology; the code stays on the field.
- Only a user who can manage terminology can add such a code. Other authors see it greyed.
- A code from a coding system CE does not have is refused. Add the system on the Terminology page first.
- An empty list means your terminology is thin, not that no code exists. Search below, or add codes on the Terminology page.
- When a set holds many codes, the panel shows 50 that no form uses, and says how many more there are.
```

- [ ] **Step 2: French and Portuguese.** Translate the section into `fr/forms.md` and `pt/forms.md`, directly after the section S6 added there. Keep UI labels in English, as those files already do: **Suggested codes**, **Binding**, **Your forms · N**, **not in your terminology**, **Undo**. Keep the same number of bullets as the English.

- [ ] **Step 3: Web.** In `apps/web/src/docs/0.1.8/forms.md`, add each language's section directly after that language's S6 section, with a `###` heading.

- [ ] **Step 4: Run the docs tests.** `pnpm --filter @openldr/studio exec vitest run src/docs` and `pnpm --filter @openldr/web exec vitest run`. Expected: PASS for both.

- [ ] **Step 5: Commit.** `git commit -m "docs(forms): describe suggested codes and the undoable import"`

---

### Task 7: Verify, merge, changelog

- [ ] **Step 1: Gates and lint on the branch.**

```bash
pnpm turbo run test --force > /tmp/s7-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s7-tc.txt 2>&1; echo "exit=$?"
pnpm --filter @openldr/server lint > /tmp/s7-lint.txt 2>&1; echo "exit=$?"
```

All three must print `exit=0`. Read each turbo `Tasks:` line: turbo stops at the first failure, so a short count means packages did not run. On a test failure, run `grep -n "Test timed out\|Unhandled Errors" /tmp/s7-test.txt` first, and re-run that package alone.

- [ ] **Step 2: A real boot, and throwaway data.** `preview_start` the `api` configuration, then `studio`. `preview_logs` for the `api` must show no error. The operator signs in; never type credentials. In the studio tab:

```js
const api = await import('/studio/src/api.ts');
const LOCAL = 'urn:openldr:cs:local';
const field = (id, code) => ({ id, fhirPath: 'Observation.code', displayLabel: id, description: null, fieldType: 'text', required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, section: 'main', code });
const schema = (name, fields) => ({ id: name, name, versionLabel: null, fhirVersion: 'R4', fhirResourceType: 'Observation', fhirProfileUrl: null, facilityId: null, fields, sections: [{ id: 'main', label: 'Main', order: 0 }], targetPages: [] });
const one = { system: LOCAL, code: 'S7-CHECK-1', display: 'S7 check one' };
const two = { system: 'urn:s7:unknown', code: 'S7-CHECK-2', display: 'S7 check two' };
const a = await api.createForm({ name: 'S7 check A', fhirResourceType: 'Observation', fhirVersion: 'R4', schema: schema('S7 check A', [field('x', [one])]) });
const b = await api.createForm({ name: 'S7 check B', fhirResourceType: 'Observation', fhirVersion: 'R4', schema: schema('S7 check B', [field('x', [one, two])]) });
({ a: a.id, b: b.id, held: (await api.searchTerms(LOCAL, { q: 'S7-CHECK' })).total });
```

Expected: two ids, and `held: 0`. The codes are throwaway, not clinical, and are removed in Step 5.

- [ ] **Step 3: Browser, desktop.** `resize_window` to 1600x900. On a new `Observation` form, add a field, set FHIR Path `Observation.code`, and open its Codes block. Check:

- `read_network_requests` for `code-suggestions`: the response is an array, not `{ error: 'not found' }`. That proves `/api/forms/:id` did not take the path. Report its time.
- "Suggested codes" lists "S7 check one" with `Your forms · 2` and "not in your terminology", and "S7 check two" with `Your forms · 1`.
- Click "S7 check one". The chip appears, and the panel shows `Added “S7 check one” to your terminology.` with Undo. `api.searchTerms(LOCAL, { q: 'S7-CHECK' })` returns one row, whose `metadata` is `{ addedBy: 'code-suggestion' }`.
- Click Undo. The notice goes, the chip stays, and the same search returns `total: 0`.
- Click "S7 check two". The panel says to add the system on the Terminology page, and no chip appears.
- Open the saved form "S7 check A" in the builder, and its field's Codes block. "S7 check one" is already on the field, so the panel lists only "S7 check two", with `Your forms · 1`: form A is left out of its own count.
- On a new `Patient` form, a field on `Patient.gender` lists the four administrative-gender codes with a Binding badge. Do not click them: that would add terms to the FHIR catalog's system.

HONEST NON-PROOF: the operator's account holds `terminology.manage`, so the greyed rows are proven only by the panel test. Signing in as an author without it would prove them in the browser.

- [ ] **Step 4: Phone.** `resize_window` preset `mobile` and reload. Open the field editor on the `Observation.code` field. The suggestion rows wrap inside the sheet, and nothing scrolls sideways (`document.documentElement.scrollWidth === innerWidth`). Reset with preset `desktop`. Nothing in S7 is anchored to the bottom edge.

- [ ] **Step 5: Clean up.** `await api.deleteForm(a.id); await api.deleteForm(b.id);` and delete any other throwaway form. Confirm `api.searchTerms(LOCAL, { q: 'S7-CHECK' })` still returns `total: 0`. Stop both servers before the gates on `main`.

- [ ] **Step 6: Merge, gates on main, changelog.**

```bash
git switch main
git merge --no-ff feat/form-builder-s7 -m "Merge branch 'feat/form-builder-s7'"
pnpm turbo run test --force > /tmp/s7-main-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s7-main-tc.txt 2>&1; echo "exit=$?"
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog after form builder S7 merge"
git branch -d feat/form-builder-s7
```

Both gates must print `exit=0` before the changelog commit. Do not push.

- [ ] **Step 7: Report.** The commits, every gate and lint result with the command and exit code, the route's response time, screenshots, the HONEST NON-PROOF line, anything that was stopped rather than fixed, and a plain line that nothing in S7 is bottom-anchored.

---

## Side list (not S7 work)

- **The Binding source suggests answer codes as question codes**, unless the operator rules on the flag above before Task 4.
- **`GET /api/terminology/valuesets/:id/expand` needs no capability, and it rewrites the stored codes** (`terminology-admin-routes.ts:407-412`, `terminology-admin-store.ts:1017-1021`). Carried from S6. A task chip for it exists.
- **The term routes' POST is an upsert.** Anyone with `terminology.manage` who creates a term that already exists overwrites it without a warning, from the Terminology page too. S7 goes around it; it does not fix it.
- **Carried from S3 to S6:** the Library search emptying at 980px, the `dhis2-sink-ui` teardown error, the data-entry step, the Lab order seed drift, the narrow condition inputs at 375px, `LoadingState`'s stripes, the Orders page's id keys, corlix's "Allow custom value" checkbox, and the export route's unordered rows.
