# Browsing the test catalog from a Lab order, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** A technician who does not know a test's code opens "Browse all tests" from the Tests field, sees the whole catalog with the tests this lab runs marked, and picks one.

**Architecture:** A read route gated on `forms.view` narrows what `TestCatalog.list` already answers. A sheet in the form runtime lists it, paged and filtered, and writes the chosen coding into the Tests answer the way the picker does. No new storage, no migration, no CLI command.

**Tech Stack:** TypeScript, Fastify, zod, React, vitest (jsdom for the studio).

**Spec:** `docs/superpowers/specs/2026-09-16-browse-tests-design.md`. Its section 3 holds the three decisions the operator settled, including that nothing is seeded.

## Global Constraints

- Work in a git worktree under `.claude/worktrees/`, never the main checkout. Leave `confident-lumiere-666963` and `peaceful-kirch-839cb2` alone.
- Stage by exact path. Never `git add <dir>`. No `Co-Authored-By` trailer.
- Commit only as these steps say. Merge or push only when the operator asks.
- New writing follows the `unslop` skill, code comments and UI copy included: no em dashes, no emoji in headings or bullets.
- Run one test file from its package: `cd <package> && npx vitest run <path> --testTimeout 30000`.
- Typecheck one package: `cd <package> && npx tsc --noEmit -p . > "$TEMP/<name>.txt" 2>&1; echo "exit=$?"`. Never read `$?` through a pipe.
- The gate is `pnpm turbo run typecheck --force --concurrency=4` and `pnpm turbo run test --force --concurrency=4 --continue`, each redirected to a file. A failure is usually a timeout: grep for `Test timed out` and re-run that package alone.
- **No migration.** This slice adds no schema and no seeded row. If you reach for one, stop: the operator settled that nothing is seeded (spec section 3, decision 3).
- **No clinical vocabulary in the studio** (AGENTS.md section 8). The browse sheet names no value set and no code system. The server decides what a catalog test is.
- **UI rules** (AGENTS.md section 5): the browse control is a `⋯` menu item, never a button; the sheet is a `Sheet`; `StripedEmpty` when empty and `LoadingState` while loading, never both; `TablePagination` on the list; shadcn only.
- **Every studio string goes in `en.ts`, `fr.ts` and `pt.ts` together.** The form runtime has no i18n (`FormRuntime.tsx:84-92`), so the sheet takes a copy prop with English defaults and `FormCapture.tsx` supplies the translations, exactly as `TestDetailsField` does.

---

## Facts this plan rests on

Each was read on 2026-09-16 at `16b8b070`.

- **`GET /api/test-catalog` lists the catalog** through `parseCatalogListQuery` and `TestCatalog.list` (`apps/server/src/test-catalog-routes.ts:129-133`), gated on `terminology.view`.
- **`CatalogTest` carries `lab.enabled`**, so "switched on here" needs no new storage.
- **A Lab Technician holds `forms.view` and `forms.submit` only** (`packages/rbac/src/presets.ts:52`).
- **`TestDetailsField` is the copy-prop precedent** (`apps/studio/src/forms-runtime/TestDetailsField.tsx`), and `FormCapture.tsx` already builds one.
- **`FieldRow` already threads per-field props** to `FieldControl`, including `dependsOnValue` and `onRemoveDependsOn` (`apps/studio/src/forms-runtime/FormRuntime.tsx`).
- **The picker writes a coding answer** as `{ system, code, display }` (`ReferencePicker.tsx`), and the Tests field is multi-valued, so its answer is an array of those.

## Where this plan departs from the spec

| Spec says | Plan does | Why |
|---|---|---|
| "a category filter" (4) | The filter offers the categories the rows carry, not a separate lookup | The list already returns each test's category, so a second request would add a round trip for nothing |
| (not specified) | The menu item is hidden when the field is not depended on | Otherwise every reference field in every form grows a menu it cannot use |

## Known effects, not handled here

- **A fresh install browses nothing** (decision 3). The empty state says so and names the Test catalog page.
- **An off test cannot be switched on from here.** The row says it is not offered, and stops.
- **Browsing is only on the Lab order**, because only a field that another field depends on shows the menu.

---

## What changes

| File | Change |
|---|---|
| `apps/server/src/test-catalog-routes.ts`, `.test.ts` | `GET /api/test-catalog/browse` |
| `apps/studio/src/api.ts`, `api.testCatalog.test.ts` | `browseTestCatalog` |
| `apps/studio/src/forms-runtime/BrowseTestsSheet.tsx`, `.test.tsx` | Create |
| `apps/studio/src/forms-runtime/FormRuntime.tsx`, `.test.tsx` | The field's `⋯` menu |
| `apps/studio/src/pages/FormCapture.tsx` | The translated copy |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | New strings |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`, `apps/web/src/docs/0.1.8/forms.md` | Docs |

---

### Task 1: the browse route

**Files:**
- Modify: `apps/server/src/test-catalog-routes.ts` (after the `/specimens` route)
- Modify: `apps/server/src/test-catalog-routes.test.ts`

**Interfaces:**
- Consumes: `parseCatalogListQuery`, `TestCatalog.list`.
- Produces: `GET /api/test-catalog/browse`, answering `{ rows: Array<{ code, display, category, enabled }>, total }`. Gated on `forms.view`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/test-catalog-routes.test.ts`, inside the `describe` block, add:

```ts
  it('GET /browse lists the catalog for anyone who can use forms, marking what this lab runs', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({ method: 'GET', url: '/api/test-catalog/browse?q=viral&limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      rows: [{ code: 'HIVVL', display: 'HIV viral load', category: 'MOL', enabled: false }],
      total: 1,
    });
    expect(calls).toEqual([
      { method: 'list', args: [{ q: 'viral', status: 'active', limit: 10, offset: 0 }] },
    ]);
  });

  it('GET /browse answers nothing a data-entry surface has no business seeing', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['forms.view']).inject({ method: 'GET', url: '/api/test-catalog/browse' });
    const body = res.json() as Record<string, unknown>;
    expect(body.ownedHere).toBeUndefined();
    expect(Object.keys(body.rows as object[]).length).toBe(1);
    expect(Object.keys((body.rows as Record<string, unknown>[])[0])).toEqual(['code', 'display', 'category', 'enabled']);
  });

  it('GET /browse needs forms.view, and refuses a bad filter before the store', async () => {
    const { ctx, calls } = fakeCtx();
    expect((await appWith(ctx, ['terminology.manage']).inject({ method: 'GET', url: '/api/test-catalog/browse' })).statusCode).toBe(403);
    const bad = await appWith(ctx, ['forms.view']).inject({ method: 'GET', url: '/api/test-catalog/browse?status=gone' });
    expect(bad.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
```

`fakeCtx`'s `list` already answers `{ rows: [TEST], total: 1, ownedHere: true }`, and `TEST` carries `category: 'MOL'` and `lab.enabled: false`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: the three new tests FAIL with 404. The others PASS.

- [ ] **Step 3: Add the route**

In `apps/server/src/test-catalog-routes.ts`, after the `/specimens` route, add:

```ts
  // Browsing the catalog from a Lab order (docs/superpowers/specs/2026-09-16-browse-tests-design.md).
  // Gated on forms.view, and narrowed: a data-entry surface sees what a test is and whether this lab
  // runs it, never the management data GET /api/test-catalog answers.
  app.get('/api/test-catalog/browse', FORMS_VIEW, async (req, reply) => {
    const parsed = parseCatalogListQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const result = await ctx.testCatalog.list(parsed.query);
    return reply.send({
      rows: result.rows.map((t) => ({ code: t.code, display: t.display, category: t.category, enabled: t.lab.enabled })),
      total: result.total,
    });
  });
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/server && npx tsc --noEmit -p . > "$TEMP/bt-t1-tc.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src/test-catalog-routes.ts > "$TEMP/bt-t1-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` twice.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/test-catalog-routes.ts apps/server/src/test-catalog-routes.test.ts
git commit -m "feat(server): list the catalog for a Lab order to browse" -m "GET /api/test-catalog/browse answers the catalog with the same filters and paging the Test catalog page uses, narrowed to what a test is and whether this lab runs it. It is gated on forms.view, because data entry calls it and a Lab Technician holds no terminology capability, and it answers none of the management data the terminology-gated list returns."
```

---

### Task 2: the studio client

**Files:**
- Modify: `apps/studio/src/api.ts` (after `catalogResultParams`)
- Modify: `apps/studio/src/api.testCatalog.test.ts`

**Interfaces:**
- Produces: `browseTestCatalog(params): Promise<{ rows: BrowseTest[]; total: number }>` where `BrowseTest = { code: string; display: string; category: string | null; enabled: boolean }`.

- [ ] **Step 1: Write the failing tests**

Append inside the describe block in `apps/studio/src/api.testCatalog.test.ts`:

```ts
  it('browses the catalog with only the filters that are set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ rows: [], total: 0 })));
    await browseTestCatalog({ q: 'vir', category: 'MOL', limit: 25, offset: 50 });
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/browse?q=vir&category=MOL&limit=25&offset=50');
  });

  it('browses with no filters at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ rows: [], total: 0 })));
    await browseTestCatalog({});
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/browse');
  });

  it('answers the rows and the total as given', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ rows: [{ code: 'HIVVL', display: 'HIV viral load', category: 'MOL', enabled: true }], total: 1 })));
    expect(await browseTestCatalog({})).toEqual({ rows: [{ code: 'HIVVL', display: 'HIV viral load', category: 'MOL', enabled: true }], total: 1 });
  });
```

Add `browseTestCatalog,` to this file's import from `./api`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/api.testCatalog.test.ts --testTimeout 30000`

Expected: FAIL, `browseTestCatalog is not a function`.

- [ ] **Step 3: Add the client**

In `apps/studio/src/api.ts`, directly after `catalogResultParams`, add:

```ts
export interface BrowseTest { code: string; display: string; category: string | null; enabled: boolean }

/** The catalog as a Lab order browses it: what a test is, and whether this lab runs it. Only the
 *  filters that are set are sent, as listTestCatalog does. */
export const browseTestCatalog = (
  p: { q?: string; category?: string; limit?: number; offset?: number },
): Promise<{ rows: BrowseTest[]; total: number }> => {
  const qs = new URLSearchParams();
  if (p.q) qs.set('q', p.q);
  if (p.category) qs.set('category', p.category);
  if (p.limit !== undefined) qs.set('limit', String(p.limit));
  if (p.offset !== undefined) qs.set('offset', String(p.offset));
  const query = qs.toString();
  return authFetch(`/api/test-catalog/browse${query ? `?${query}` : ''}`)
    .then((r) => okJson<{ rows: BrowseTest[]; total: number }>(r, 'browse tests'));
};
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/api.testCatalog.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.testCatalog.test.ts
git commit -m "feat(studio): read the catalog for browsing" -m "browseTestCatalog asks the forms-gated browse route for a page of the catalog, sending only the filters that are set, and answers the rows and the total unchanged."
```

---

### Task 3: the browse sheet

**Files:**
- Create: `apps/studio/src/forms-runtime/BrowseTestsSheet.tsx`
- Create: `apps/studio/src/forms-runtime/BrowseTestsSheet.test.tsx`

**Interfaces:**
- Consumes: `browseTestCatalog`, `BrowseTest` (Task 2).
- Produces: `BrowseTestsSheet` with props `{ system, onPick, onClose, copy? }`, and `BrowseTestsCopy`.

`system` is the coding system the picked test belongs to, handed down by the caller, so this component names no vocabulary.

- [ ] **Step 1: Write the failing tests**

Create `apps/studio/src/forms-runtime/BrowseTestsSheet.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api', () => ({ browseTestCatalog: vi.fn() }));
import { browseTestCatalog } from '@/api';
import { BrowseTestsSheet } from './BrowseTestsSheet';

const CATALOG = 'urn:openldr:codesystem:test-catalog';
const rows = [
  { code: 'HIVVL', display: 'HIV viral load', category: 'MOL', enabled: true },
  { code: 'CD4', display: 'CD4 count', category: 'HAEM', enabled: false },
];

beforeEach(() => {
  vi.mocked(browseTestCatalog).mockReset();
  vi.mocked(browseTestCatalog).mockResolvedValue({ rows, total: 2 });
});

describe('BrowseTestsSheet', () => {
  it('lists every test, with its code and category', async () => {
    render(<BrowseTestsSheet system={CATALOG} onPick={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('HIV viral load')).toBeInTheDocument();
    expect(screen.getByText('CD4 count')).toBeInTheDocument();
    expect(screen.getByText('MOL')).toBeInTheDocument();
  });

  it('marks a test this lab does not run, and refuses to pick it', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<BrowseTestsSheet system={CATALOG} onPick={onPick} onClose={() => {}} />);
    await screen.findByText('CD4 count');
    expect(screen.getByText(/not offered/i)).toBeInTheDocument();
    await user.click(screen.getByText('CD4 count'));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('picks an offered test as a coding, and closes', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<BrowseTestsSheet system={CATALOG} onPick={onPick} onClose={onClose} />);
    await user.click(await screen.findByText('HIV viral load'));
    expect(onPick).toHaveBeenCalledWith({ system: CATALOG, code: 'HIVVL', display: 'HIV viral load' });
    expect(onClose).toHaveBeenCalled();
  });

  it('asks the server again when the search changes', async () => {
    const user = userEvent.setup();
    render(<BrowseTestsSheet system={CATALOG} onPick={() => {}} onClose={() => {}} />);
    await screen.findByText('HIV viral load');
    await user.type(screen.getByRole('searchbox'), 'vir');
    await waitFor(() => expect(browseTestCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'vir' })));
  });

  it('filters by a category the rows carry', async () => {
    const user = userEvent.setup();
    render(<BrowseTestsSheet system={CATALOG} onPick={() => {}} onClose={() => {}} />);
    await screen.findByText('HIV viral load');
    await user.click(screen.getByLabelText(/category/i));
    await user.click(await screen.findByText('MOL'));
    await waitFor(() => expect(browseTestCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'MOL' })));
  });

  it('shows the empty state when this install holds no tests', async () => {
    vi.mocked(browseTestCatalog).mockResolvedValue({ rows: [], total: 0 });
    render(<BrowseTestsSheet system={CATALOG} onPick={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/no tests are loaded/i)).toBeInTheDocument();
  });

  it('takes its copy from the caller, and falls back to English', async () => {
    vi.mocked(browseTestCatalog).mockResolvedValue({ rows: [], total: 0 });
    render(<BrowseTestsSheet system={CATALOG} onPick={() => {}} onClose={() => {}} copy={{ empty: 'Aucun examen chargé' }} />);
    expect(await screen.findByText('Aucun examen chargé')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/forms-runtime/BrowseTestsSheet.test.tsx --testTimeout 30000`

Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the sheet**

Create `apps/studio/src/forms-runtime/BrowseTestsSheet.tsx`. Copy `TestDetailSheet.tsx` for the sheet
shell and `TestDetailsField.tsx` for the copy prop, and follow `pages/TestCatalog.tsx` for the search
and category filter. It holds:

- state for `q`, `category`, `page`, `rows`, `total`, `busy`,
- one effect keyed on `q`, `category` and `page` that calls `browseTestCatalog` with a 250 ms
  debounce, and skips the call when the text is unchanged (the S2 trap: a debounce that does not skip
  resets the page an operator just moved to),
- `LoadingState` while the first page is in flight, `StripedEmpty` when the answer is empty, never
  both,
- a `Table` of rows with `TablePagination` below it, rendered only when there are rows (an empty
  table's header forces intrinsic width and scrolls sideways at 375px),
- a row that is `enabled: false` rendered inert, with a short marker from the copy,
- an offered row calling `onPick({ system, code, display })` then `onClose()`.

The category filter offers the categories present in the current rows, plus an "any" entry. The sheet
names no code system: `system` arrives as a prop.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/forms-runtime/BrowseTestsSheet.test.tsx --testTimeout 30000`

Expected: PASS, all seven.

- [ ] **Step 5: Typecheck the package**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/bt-t3-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/forms-runtime/BrowseTestsSheet.tsx apps/studio/src/forms-runtime/BrowseTestsSheet.test.tsx
git commit -m "feat(studio): a sheet for browsing the whole test catalog" -m "The sheet lists the catalog a page at a time, searchable by code or name and filterable by the categories the rows carry. A test this lab does not run is marked and cannot be picked, because the submit check would refuse it later. Picking an offered test answers its coding. The coding system arrives as a prop, so the sheet names no vocabulary."
```

---

### Task 4: the field's menu, and the translated copy

**Files:**
- Modify: `apps/studio/src/forms-runtime/FormRuntime.tsx`
- Modify: `apps/studio/src/forms-runtime/FormRuntime.test.tsx`
- Modify: `apps/studio/src/pages/FormCapture.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: `BrowseTestsSheet` (Task 3).

- [ ] **Step 1: Write the failing tests**

Append inside the main describe block of `apps/studio/src/forms-runtime/FormRuntime.test.tsx`:

```tsx
  it('offers Browse all tests on a field another field depends on', async () => {
    const user = userEvent.setup();
    render(<FormRuntime schema={orderSchema} formDefinitionId="f1" onSubmit={() => {}} />);
    await user.click(screen.getByRole('button', { name: /tests actions/i }));
    expect(await screen.findByText(/browse all tests/i)).toBeInTheDocument();
  });

  it('offers no such menu on an ordinary reference field', () => {
    render(<FormRuntime schema={refSchema} formDefinitionId="f1" onSubmit={() => {}} />);
    expect(screen.queryByRole('button', { name: /actions/i })).toBeNull();
  });

  it('adds the browsed test to the answer, beside what is already chosen', async () => {
    const user = userEvent.setup();
    const onAnswersChange = vi.fn();
    render(<FormRuntime schema={orderSchema} formDefinitionId="f1" onSubmit={() => {}} onAnswersChange={onAnswersChange} />);
    await user.click(screen.getByRole('button', { name: /tests actions/i }));
    await user.click(await screen.findByText(/browse all tests/i));
    await user.click(await screen.findByText('HIV viral load'));
    await waitFor(() => expect(onAnswersChange).toHaveBeenCalledWith(expect.objectContaining({
      tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL', display: 'HIV viral load' }],
    })));
  });
```

`orderSchema` is the two-field schema this file already declares for the depends-on test (a `tests`
reference field and a `testDetails` field that depends on it). Mock `browseTestCatalog` in this
file's `@/api` mock, answering one enabled row.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/forms-runtime/FormRuntime.test.tsx --testTimeout 30000`

Expected: the three new tests FAIL. No menu exists.

- [ ] **Step 3: Add the menu**

In `FieldRow`, beside the label, render a `MoreHorizontal` `DropdownMenu` when this field is depended
on by another field:

```tsx
  const dependedOn = schema.fields.some((f) => f.referenceDependsOn === field.id);
```

The menu's single item opens `BrowseTestsSheet`, whose `system` comes from the codings already in the
answer, or from the first row the sheet lists when the answer is empty. Picking appends the coding to
this field's answer, keeping what is already chosen, through the `onChange` the row already has.

`FormRuntime` takes `browseCopy?: BrowseTestsCopy` beside `testDetailsCopy`, with the same doc comment
reasoning: the runtime has no i18n.

- [ ] **Step 4: Translate the chrome**

In `FormCapture.tsx`, build `browseCopy` from `t('forms.browse*')` and pass it down, beside the
`testDetailsCopy` it already builds. Add the keys to `en.ts`, `fr.ts` and `pt.ts` together: the menu
item, the sheet title, the search placeholder, the category label, the any-category entry, the
not-offered marker, the empty state and the loading label.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/forms-runtime src/pages/FormCapture.test.tsx --testTimeout 30000`

Expected: PASS, every test in those files.

- [ ] **Step 6: Typecheck the package**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/bt-t4-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/forms-runtime/FormRuntime.tsx apps/studio/src/forms-runtime/FormRuntime.test.tsx apps/studio/src/pages/FormCapture.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): browse the catalog from the Tests field" -m "A reference field that another field depends on gains a dots menu holding Browse all tests, which opens the catalog sheet. Picking there adds the test beside whatever is already chosen. Only such a field shows the menu, so an ordinary reference field is unchanged, and the runtime still names no value set. The capture page supplies the translations, because the runtime has no i18n of its own."
```

---

### Task 5: docs, gate and report

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`
- Modify: `apps/web/src/docs/0.1.8/forms.md`

- [ ] **Step 1: Write the docs**

Add to each language, in the Lab order section: the Tests field searches as you type, and its `⋯`
menu opens the whole catalog, where a test this lab does not run is marked and cannot be picked. Say
plainly that an install with no catalog loaded browses nothing, and name the Test catalog page as
where tests come from.

- [ ] **Step 2: Run the docs tests**

Run: `cd apps/studio && npx vitest run src/docs --testTimeout 30000`

Run: `cd apps/web && npx vitest run src/docs --testTimeout 30000`

Expected: PASS in both.

- [ ] **Step 3: Check the added lines for em dashes**

Run: `git diff -- apps/studio/src/docs apps/web/src/docs | grep '^+' | grep -c $'\xe2\x80\x94'`

Expected: `0`.

- [ ] **Step 4: Commit the docs**

```bash
git add apps/studio/src/docs/0.1.8/en/forms.md apps/studio/src/docs/0.1.8/fr/forms.md apps/studio/src/docs/0.1.8/pt/forms.md apps/web/src/docs/0.1.8/forms.md
git commit -m "docs(forms): browsing the catalog from a Lab order" -m "The in-app guide and the web page, in English, French and Portuguese, say that the Tests field can open the whole catalog, that a test this lab does not run is marked and cannot be picked, and that an install with no catalog loaded browses nothing."
```

- [ ] **Step 5: Run the forced gate**

Run: `pnpm turbo run typecheck --force --concurrency=4 > "$TEMP/bt-gate-tc.txt" 2>&1; echo "exit=$?"`

Run: `pnpm turbo run test --force --concurrency=4 --continue > "$TEMP/bt-gate-test.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src > "$TEMP/bt-gate-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` three times. On a test failure, grep for `Test timed out`, then re-run that package alone before blaming a change.

- [ ] **Step 6: Report, then stop**

Report to the operator:

1. The gate's three exit codes and each package's test count.
2. What each layer proves:
   - Route tests: the wire shape, the `forms.view` gate, that a terminology-only role is refused, and that management data is not answered.
   - Client tests: only the filters that are set are sent.
   - Sheet tests: rows and their marker, an off test that cannot be picked, a pick answering a coding, search and category reaching the server, and the empty state.
   - Runtime tests: the menu appears only on a depended-on field, and a browsed test joins the answer.
3. **HONEST NON-PROOF**, each with what would prove it:
   - Browsing a real catalog. This dev database holds no tests, by the operator's decision, so the live check can only show the empty state unless tests are imported first.
   - The sheet at 375px on a real phone.
   - Paging a catalog of thousands.
4. Anything skipped or changed from this plan, and why.

Then ask the operator before merging, pushing, or running a live check. After a merge to `main`, run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json` (AGENTS.md section 6, item 5).
