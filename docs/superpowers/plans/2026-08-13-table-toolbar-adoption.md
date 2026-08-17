# One filter toolbar, every table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven client-side tables in `apps/studio` adopt the Users page filter toolbar, so every table filters the same way.

**Architecture:** No new components. Each page swaps its bespoke search/Select markup for the existing `data-table` kit: `useTableState` holds filter/sort/column state, `DataTableToolbar` renders the controls, `ActiveFilterChips` renders the chips row, `applyTableState` does the filtering in the browser. Pages fetch all rows already, so nothing server-side changes.

**Tech Stack:** React 18, TypeScript, vitest + @testing-library/react, react-i18next, Tailwind, shadcn/Radix.

**Spec:** `docs/superpowers/specs/2026-08-13-table-toolbar-adoption-design.md`

## Global Constraints

- **shadcn only.** Never a native `<select>`, `<button>`, `<input>` or `<dialog>` (AGENTS.md §5).
- **Actions live in a `⋯` dropdown.** Page-level actions go in the toolbar's `actions` prop. Never a standalone Create/New button (AGENTS.md §5).
- **Every table keeps `TablePagination`.** No exceptions, including short config lists (AGENTS.md §5).
- **i18n is en + fr + pt, always all three.** `apps/studio/src/i18n/parity.test.ts` fails the build on any key present in one locale and missing from another. A missing key renders as literal braces.
- **No `Co-Authored-By` trailers** in commits (AGENTS.md §9).
- **`h-dvh`, never `h-screen`** on anything full-height (AGENTS.md §6).
- **Never claim done without the command and its output** (AGENTS.md §1).
- Test command for every task: `pnpm --filter @openldr/studio exec vitest run <path>`
- Full package gate: `pnpm --filter @openldr/studio test`

---

## File Structure

**Created:**
- `apps/studio/src/components/data-table/expectStandardTableToolbar.ts` — shared test assertion. One responsibility: prove a page rendered the full toolbar *and* the chips container.

**Modified (one page each, independent):**
- `apps/studio/src/pages/Roles.tsx` + `Roles.test.tsx`
- `apps/studio/src/pages/Forms.tsx` + `Forms.test.tsx`
- `apps/studio/src/pages/Activity.tsx` + `Activity.test.tsx`
- `apps/studio/src/pages/settings/Connectors.tsx` (+ new test)
- `apps/studio/src/pages/settings/Sites.tsx` (+ new test)
- `apps/studio/src/pages/settings/DistributedSync.tsx` (+ new test)
- `apps/studio/src/pages/Terminology.tsx` + `Terminology.test.tsx`
- `apps/studio/src/i18n/{en,fr,pt}.ts` — column labels for pages whose headers are hardcoded
- `apps/studio/src/docs/0.1.0/{en,fr,pt}/*.md` — docs describing replaced controls

**Task order is deliberate:** Task 2 (Roles) is the smallest and proves the "add a toolbar where there was none" path. Task 3 (Forms) proves the "replace a search box" path *and* the i18n-keys path. Everything after reuses those two shapes. Terminology is last because it is the hardest.

Pages are independent. They can land one at a time; nothing needs a big-bang merge.

---

## Canonical toolbar block

Every page task pastes this block, substituting only the marked parts. It is copied from the working reference at `apps/studio/src/pages/Users.tsx:155-180`.

```tsx
<DataTableToolbar
  columns={columns}
  filters={table.filters}
  onFiltersChange={table.setFilters}
  sorts={table.sorts}
  onSortsChange={table.setSorts}
  visibleIds={table.visibleIds}
  onVisibleIdsChange={table.setVisibleIds}
  onResetColumns={table.resetColumns}
  onResetAll={() => { table.resetAll(); setSearch(''); }}
  searchValue={search}
  onSearchChange={(v) => { setSearch(v); table.setPage(0); }}
  searchPlaceholder={t('<PAGE>.searchPlaceholder')}   /* SUBSTITUTE */
  actions={/* SUBSTITUTE: the page's existing ⋯ DropdownMenu */}
/>
<ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
```

And the body block:

```tsx
const table = useTableState({ columns, defaultPageSize: 25 });

// Free-text search is applied BEFORE applyTableState, never as a filter rule.
//
// applyTableState folds rules flat, left-to-right (applyTableState.ts:80-92):
// `A AND B OR C` evaluates as `(A AND B) OR C`. Appending a multi-field OR search
// to the rule list therefore discards any active popover filter for rows that match
// only the trailing OR term — a status filter plus a search would silently widen
// the result set. Pre-filtering keeps the semantics `search AND (popover rules)`,
// which is what the operator expects.
const searched = useMemo(() => {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => SEARCH_FIELDS.some((f) => (f(r) ?? '').toLowerCase().includes(q)));
}, [rows, search]);

const view = useMemo(
  () => applyTableState(searched, { filters: table.filters, sorts: table.sorts, page: table.page, pageSize: table.pageSize }, columns, valueGetters),
  [searched, table.filters, table.sorts, table.page, table.pageSize, columns, valueGetters],
);
```

`SEARCH_FIELDS` is a module-level array of accessors naming the columns the page's search
covers — for example `[(f) => f.name, (f) => f.fhirResourceType]`. Keep it outside the component
so it is stable.

**Single-field pages may keep the rule-list form.** `Users.tsx` and `Roles.tsx` append one
`combine: 'and'` rule, which folds correctly. Only multi-field search needs the pre-filter. Use
the pre-filter anyway on new pages — it is uniform and cannot fold wrong.

And the table body block:

```tsx
<Table wrapperClassName={view.rows.length > 0 ? 'min-h-0 flex-1' : undefined}>
  <TableHeader className="sticky top-0 z-10 bg-background">
    <TableRow>{table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{c.id === '__actions' ? '' : t(c.labelKey)}</TableHead>)}</TableRow>
  </TableHeader>
  {!loading && view.rows.length > 0 && (
    <TableBody className="[&_tr:last-child]:border-b">
      {view.rows.map((r) => (
        <TableRow key={r.id}>
          {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(r)}</TableCell>)}
        </TableRow>
      ))}
    </TableBody>
  )}
</Table>
```

**Two rules that are easy to get wrong:**

1. `columns` MUST be wrapped in `useMemo`. An unstable array recomputes `defaultVisible`, `visibleColumns` and the `applyTableState` memo on every keystroke.
2. Render `<Table>` only when populated, and gate `wrapperClassName` on having rows. An empty table's header forces intrinsic width and scrolls sideways on mobile; an always-filling wrapper splits the pane 50/50 with the empty state (AGENTS.md §6).

---

## Task 1: Shared toolbar test helper

**Files:**
- Create: `apps/studio/src/components/data-table/expectStandardTableToolbar.ts`
- Test: `apps/studio/src/components/data-table/expectStandardTableToolbar.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces two functions every page task calls:
  - `expectStandardTableToolbar(): void` — throws if the rendered page is missing any of Filter, Sort, Columns, or the chips container.
  - `addFilterViaPopover(value: string): Promise<void>` — opens the Filter popover, adds a rule on the first filterable column, types `value`, clicks Apply. Chips only render once a filter is applied, so every page test needs this before asserting the chips row.

**There is no existing test that drives the Filter popover.** `DataTableToolbar.test.tsx` only asserts the buttons render. So this helper is new work, not a copy — the interaction below was read off `FilterPopover.tsx:141-149,285-296`.

**Why this exists:** the operator chose to keep `ActiveFilterChips` a separate component rather than folding it into the toolbar. Nothing structural then stops a page rendering the toolbar and forgetting the chips. This helper is the substitute guard.

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/components/data-table/expectStandardTableToolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DataTableToolbar } from './DataTableToolbar';
import { ActiveFilterChips } from './ActiveFilterChips';
import { expectStandardTableToolbar } from './expectStandardTableToolbar';
import type { ColumnDef } from './types';

const columns: ColumnDef<{ id: string; name: string }>[] = [
  { id: 'name', labelKey: 'roles.colName', accessor: (r) => r.name, type: 'text', defaultVisible: true },
];

function Harness({ withChips }: { withChips: boolean }) {
  return (
    <div>
      <DataTableToolbar
        columns={columns}
        filters={[]} onFiltersChange={vi.fn()}
        sorts={[]} onSortsChange={vi.fn()}
        visibleIds={['name']} onVisibleIdsChange={vi.fn()}
        onResetColumns={vi.fn()} onResetAll={vi.fn()}
        searchValue="" onSearchChange={vi.fn()} searchPlaceholder="Search"
      />
      {withChips && (
        <ActiveFilterChips
          columns={columns}
          filters={[{ id: 'f1', column: 'name', operator: 'eq', value: 'x', combine: 'and' }]}
          onChange={vi.fn()}
        />
      )}
    </div>
  );
}

/** Stateful harness: filters applied through the popover actually land, so chips appear. */
function LiveHarness() {
  const [filters, setFilters] = useState<FilterRule[]>([]);
  return (
    <div>
      <DataTableToolbar
        columns={columns}
        filters={filters} onFiltersChange={setFilters}
        sorts={[]} onSortsChange={vi.fn()}
        visibleIds={['name']} onVisibleIdsChange={vi.fn()}
        onResetColumns={vi.fn()} onResetAll={vi.fn()}
        searchValue="" onSearchChange={vi.fn()} searchPlaceholder="Search"
      />
      <ActiveFilterChips columns={columns} filters={filters} onChange={setFilters} />
    </div>
  );
}

describe('expectStandardTableToolbar', () => {
  it('passes when the toolbar and the chips container are both rendered', () => {
    render(<Harness withChips />);
    expect(() => expectStandardTableToolbar()).not.toThrow();
  });

  it('fails when the page rendered the toolbar but forgot ActiveFilterChips', () => {
    render(<Harness withChips={false} />);
    expect(() => expectStandardTableToolbar()).toThrow(/ActiveFilterChips/);
  });
});

describe('addFilterViaPopover', () => {
  it('applies a rule through the popover so the chips row appears', async () => {
    render(<LiveHarness />);
    expect(screen.queryByText(/clear all/i)).toBeNull();   // no chips before

    await addFilterViaPopover('acme');

    expect(await screen.findByText(/clear all/i)).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();  // the value shows on the chip
    expectStandardTableToolbar();
  });
});
```

Add the extra imports this needs:

```tsx
import { useState } from 'react';
import { screen } from '@testing-library/react';
import { addFilterViaPopover } from './expectStandardTableToolbar';
import type { FilterRule } from './types';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/components/data-table/expectStandardTableToolbar.test.tsx`
Expected: FAIL — `Failed to resolve import "./expectStandardTableToolbar"`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/studio/src/components/data-table/expectStandardTableToolbar.ts`:

```ts
import { expect } from "vitest";
import { screen } from "@testing-library/react";

/**
 * Assert a page adopted the full standard table toolbar.
 *
 * ActiveFilterChips is a sibling of DataTableToolbar, not part of it, so a page can render the
 * toolbar and silently omit the chips row. This helper is the guard against that: every page
 * test calls it. Chips only render when a filter is set, so the caller must set one first.
 */
export function expectStandardTableToolbar(): void {
  expect(screen.getByRole("button", { name: /filter/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /sort/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /columns/i })).toBeInTheDocument();

  const clearAll = screen.queryByText(/clear all/i);
  if (!clearAll) {
    throw new Error(
      "ActiveFilterChips is missing. Render <ActiveFilterChips …/> next to <DataTableToolbar/>, " +
        "and set a filter before calling this helper (chips do not render when no filter is set).",
    );
  }
}

/**
 * Add one filter rule through the Filter popover, exactly as a user would.
 *
 * FilterPopover seeds a new rule with the first filterable column and that type's first valid
 * operator (`FilterPopover.tsx:141-149`), so the caller only supplies the value. Apply closes the
 * popover and lifts the rule to the page, which is what makes the chips row appear.
 */
export async function addFilterViaPopover(value: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /^filter$/i }));
  fireEvent.click(await screen.findByRole("button", { name: /add filter/i }));
  fireEvent.change(await screen.findByLabelText(/enter value/i), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
}
```

Import `fireEvent` alongside `screen` at the top of that file:

```ts
import { fireEvent, screen } from "@testing-library/react";
```

The label strings come from the `table` i18n namespace at `en.ts:23-50` — `filter: 'Filter'`, `addFilter: 'Add filter'`, `enterValue: 'Enter value'`, `apply: 'Apply'`, `clearAll: 'Clear all'`. Tests run in English.

**One caveat to expect:** `addFilterViaPopover` types into the input labelled "Enter value", which `FilterValueInput` renders only for text-ish columns (`FilterPopover.tsx:117-125`). If a page's *first filterable column* is an enum or date, the popover renders a Select or DatePicker instead and `findByLabelText(/enter value/i)` will fail. On those pages, either order `columns` so a text column comes first, or set `filterable: false` on the leading non-text column.

⛔ **Do NOT export this from `index.ts`.** The helper imports `vitest`, which is a
devDependency (`apps/studio/package.json:83`), and production pages import the barrel
(`pages/Users.tsx:16`). Adding it there puts a devDependency into the production module graph.

Tests import it by direct path instead:

```ts
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';
```

`index.ts` is therefore **not** modified by this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/components/data-table/expectStandardTableToolbar.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/components/data-table/expectStandardTableToolbar.ts apps/studio/src/components/data-table/expectStandardTableToolbar.test.tsx
git commit -m "test(studio): shared assertion that a page adopted the full table toolbar"
```

---

## Task 2: Roles adopts the toolbar

**Files:**
- Modify: `apps/studio/src/pages/Roles.tsx`
- Test: `apps/studio/src/pages/Roles.test.tsx`

**Interfaces:**
- Consumes: `expectStandardTableToolbar()` from Task 1.
- Produces: nothing other tasks depend on. This is the reference for the "add a toolbar where there was none" path.

**Context:** `Roles.tsx:29` holds `useState<RoleRecord[]>`. Existing headers at `:89-92` are `roles.colName`, `roles.colDescription`, `roles.colMembers`, plus an empty `w-16` actions head. All three labels are already translated — **no new i18n keys needed**. Roles has no search box today; it gains one.

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/pages/Roles.test.tsx`:

```tsx
it('renders the standard table toolbar and filters rows by name', async () => {
  render(<MemoryRouter><Roles /></MemoryRouter>);
  await screen.findByText('Lab Admin');            // wait for rows

  const search = screen.getByPlaceholderText(/search roles/i);
  fireEvent.change(search, { target: { value: 'zzz-no-such-role' } });
  expect(screen.queryByText('Lab Admin')).not.toBeInTheDocument();

  fireEvent.change(search, { target: { value: '' } });
  expect(await screen.findByText('Lab Admin')).toBeInTheDocument();
});
```

There are no `renderX()` helpers in this repo's page tests — every test inlines
`render(<MemoryRouter><Page /></MemoryRouter>)`. Follow that, and reuse the `vi.mock('@/api', …)`
block already at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/Roles.test.tsx`
Expected: FAIL — `Unable to find an element with the placeholder text: /search roles/i`.

- [ ] **Step 3: Write minimal implementation**

In `apps/studio/src/pages/Roles.tsx`:

Add imports:

```tsx
import { useMemo, useState } from 'react';
import {
  ActiveFilterChips, DataTableToolbar, applyTableState, useTableState, type ColumnDef,
} from '@/components/data-table';
```

Add `const [search, setSearch] = useState('');` alongside the existing state.

Define columns (memoised — see the two rules above):

```tsx
const columns: ColumnDef<RoleRecord>[] = useMemo(() => [
  { id: 'name',        labelKey: 'roles.colName',        accessor: (r) => r.name,        type: 'text',   defaultVisible: true, cellClassName: 'font-medium' },
  { id: 'description', labelKey: 'roles.colDescription', accessor: (r) => r.description, type: 'text',   defaultVisible: true, cellClassName: 'max-w-[24rem] text-muted-foreground' },
  { id: 'memberCount', labelKey: 'roles.colMembers',     accessor: (r) => t('roles.memberCount', { count: r.memberCount }), type: 'number', defaultVisible: true, headClassName: 'w-28', cellClassName: 'text-muted-foreground' },
], [t]);

const valueGetters = useMemo(() => ({
  name: (r: RoleRecord) => r.name,
  description: (r: RoleRecord) => r.description ?? '',
  memberCount: (r: RoleRecord) => r.memberCount,
}), []);
```

Note `memberCount` is `type: 'number'` — its accessor renders a translated string, but the *filter* must compare the raw number, which is what `valueGetters` supplies.

Leave the existing per-row `⋯` actions cell exactly as it is. Do not move it into `columns`; Roles renders it as a trailing `<TableCell>` already.

Add the state and view, then the canonical toolbar block with `searchPlaceholder={t('roles.searchPlaceholder')}` and `<SEARCH_COLUMN>` = `'name'`, and the page's existing `⋯` menu in `actions`.

Add the three locale keys — `roles.searchPlaceholder`:
- `en.ts`: `searchPlaceholder: 'Search roles'`
- `fr.ts`: `searchPlaceholder: 'Rechercher des rôles'`
- `pt.ts`: `searchPlaceholder: 'Pesquisar funções'`

Keep `TablePagination` wired to `table.page` / `table.pageSize` / `view.total`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/Roles.test.tsx src/i18n/parity.test.ts`
Expected: PASS. `parity.test.ts` proves the key landed in all three locales.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/pages/Roles.tsx apps/studio/src/pages/Roles.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Roles adopts the standard table toolbar"
```

---

## Task 3: Forms adopts the toolbar, and its headers get translated

**Files:**
- Modify: `apps/studio/src/pages/Forms.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`
- Test: `apps/studio/src/pages/Forms.test.tsx`

**Interfaces:**
- Consumes: `expectStandardTableToolbar()` from Task 1.
- Produces: the `forms.col*` i18n keys. This is the reference for the "replace a search box + create i18n keys" path.

**Context:** `Forms.tsx:74` holds `useState<FormSummary[]>`. **All nine headers at `:240-247` are hardcoded English** — `Name`, `FHIR type`, `Fields`, `Version`, `Status`, `Active`, `Updated`, plus an empty actions head. `ColumnDef.labelKey` requires i18n keys, so they must be created. The existing search box at `:192` filters name + `fhirResourceType` (`:100`) and is replaced by the toolbar search.

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/pages/Forms.test.tsx`:

```tsx
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';

it('renders the standard table toolbar with the chips row', async () => {
  render(<MemoryRouter><Forms /></MemoryRouter>);
  await screen.findByText(/lab order/i);           // wait for rows

  await addFilterViaPopover('lab');
  expectStandardTableToolbar();
});

it('filters rows by the search box', async () => {
  render(<MemoryRouter><Forms /></MemoryRouter>);
  await screen.findByText(/lab order/i);

  fireEvent.change(screen.getByPlaceholderText(/search forms/i), { target: { value: 'zzz-no-such-form' } });
  expect(screen.queryByText(/lab order/i)).not.toBeInTheDocument();
});
```

Replace `/lab order/i` with a form name the existing mocks in this file actually return.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/Forms.test.tsx`
Expected: FAIL — no button named `/filter/i`.

- [ ] **Step 3: Write minimal implementation**

Add the i18n keys under the existing `forms` namespace in all three locales:

```ts
// en.ts
colName: 'Name', colFhirType: 'FHIR type', colFields: 'Fields',
colVersion: 'Version', colStatus: 'Status', colActive: 'Active', colUpdated: 'Updated',
searchPlaceholder: 'Search forms or FHIR type',
```

```ts
// fr.ts
colName: 'Nom', colFhirType: 'Type FHIR', colFields: 'Champs',
colVersion: 'Version', colStatus: 'Statut', colActive: 'Actif', colUpdated: 'Mis à jour',
searchPlaceholder: 'Rechercher des formulaires ou un type FHIR',
```

```ts
// pt.ts
colName: 'Nome', colFhirType: 'Tipo FHIR', colFields: 'Campos',
colVersion: 'Versão', colStatus: 'Estado', colActive: 'Ativo', colUpdated: 'Atualizado',
searchPlaceholder: 'Pesquisar formulários ou tipo FHIR',
```

Define columns in `Forms.tsx`:

```tsx
const columns: ColumnDef<FormSummary>[] = useMemo(() => [
  { id: 'name',             labelKey: 'forms.colName',     accessor: (f) => f.name,                         type: 'text',   defaultVisible: true },
  { id: 'fhirResourceType', labelKey: 'forms.colFhirType', accessor: (f) => f.fhirResourceType ?? '-',      type: 'text',   defaultVisible: true },
  { id: 'fieldCount',       labelKey: 'forms.colFields',   accessor: (f) => f.fieldCount,                   type: 'number', defaultVisible: true, cellClassName: 'text-muted-foreground' },
  { id: 'versionLabel',     labelKey: 'forms.colVersion',  accessor: (f) => f.versionLabel || '-',          type: 'text',   defaultVisible: true, cellClassName: 'text-muted-foreground' },
  { id: 'status',           labelKey: 'forms.colStatus',   accessor: (f) => <StatusBadge status={f.status} />, type: 'enum', defaultVisible: true,
    enumOptions: [{ value: 'draft', label: 'draft' }, { value: 'published', label: 'published' }] },
  { id: 'active',           labelKey: 'forms.colActive',   accessor: (f) => f.active ? <Badge variant="secondary">Active</Badge> : <span className="text-muted-foreground">Inactive</span>, type: 'enum', defaultVisible: true,
    enumOptions: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] },
  { id: 'updatedAt',        labelKey: 'forms.colUpdated',  accessor: (f) => formatDate(f.updatedAt),        type: 'date',   defaultVisible: true, cellClassName: 'text-xs text-muted-foreground' },
], []);

const valueGetters = useMemo(() => ({
  name: (f: FormSummary) => f.name,
  fhirResourceType: (f: FormSummary) => f.fhirResourceType ?? '',
  fieldCount: (f: FormSummary) => f.fieldCount,
  versionLabel: (f: FormSummary) => f.versionLabel ?? '',
  status: (f: FormSummary) => f.status,
  active: (f: FormSummary) => String(f.active),
  updatedAt: (f: FormSummary) => f.updatedAt ?? '',
}), []);
```

`status` and `active` are `type: 'enum'` so the popover offers a picker, not free text. `active` is a boolean, so its `valueGetter` stringifies it — matching how Users handles `enabled` at `Users.tsx:131`.

Confirm the real `status` values before writing `enumOptions`. Run:

```bash
rg -n "status" apps/studio/src/pages/Forms.tsx | rg -i "draft|published|retired" | head
```

Use whatever that prints. Do not invent statuses — AGENTS.md §8 forbids inlining vocabulary that belongs to data.

Delete the hardcoded `<TableHead>` list at `:240-247` and the bespoke search input at `:192`, then paste the canonical blocks with `<SEARCH_COLUMN>` = `'name'`. The existing `.filter()` at `:100` also matched `fhirResourceType`; to preserve that, keep two search rules:

```tsx
const SEARCH_FIELDS = [(f: FormSummary) => f.name, (f: FormSummary) => f.fhirResourceType ?? ''];
```

then use the canonical pre-filter block. Do NOT append search as OR rules — see the canonical
block's comment for why that folds wrong against an active popover filter.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/Forms.test.tsx src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/pages/Forms.tsx apps/studio/src/pages/Forms.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Forms adopts the standard table toolbar and translates its headers"
```

---

## Task 4: Activity adopts the toolbar

**Files:**
- Modify: `apps/studio/src/pages/Activity.tsx`
- Test: `apps/studio/src/pages/Activity.test.tsx`

**Interfaces:**
- Consumes: `expectStandardTableToolbar()` from Task 1.
- Produces: nothing other tasks depend on.

**Context:** `Activity.tsx:136` holds `useState<RecentPayload[]>`. Headers at `:214-218` are already translated: `activity.colPayload`, `activity.colSource`, `activity.colStarted`, `activity.colStage`, `activity.colStatus`. The search input is at `:190` with placeholder `activity.searchPlaceholder` — **that key already exists**, so no new i18n keys unless a column label is missing.

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/pages/Activity.test.tsx`:

```tsx
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';

it('renders the standard table toolbar with the chips row', async () => {
  render(<MemoryRouter><Activity /></MemoryRouter>);
  await screen.findByRole('table');        // wait for rows

  await addFilterViaPopover('x');
  expectStandardTableToolbar();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/Activity.test.tsx`
Expected: FAIL — no button named `/filter/i`.

- [ ] **Step 3: Write minimal implementation**

```tsx
const columns: ColumnDef<RecentPayload>[] = useMemo(() => [
  { id: 'payload', labelKey: 'activity.colPayload', accessor: (p) => p.id,        type: 'text', defaultVisible: true },
  { id: 'source',  labelKey: 'activity.colSource',  accessor: (p) => p.source,    type: 'text', defaultVisible: true, headClassName: 'w-44 text-xs uppercase' },
  { id: 'started', labelKey: 'activity.colStarted', accessor: (p) => p.startedAt, type: 'date', defaultVisible: true, headClassName: 'w-48 text-xs uppercase' },
  { id: 'stage',   labelKey: 'activity.colStage',   accessor: (p) => p.stage,     type: 'text', defaultVisible: true, headClassName: 'w-44 text-xs uppercase' },
  { id: 'status',  labelKey: 'activity.colStatus',  accessor: (p) => p.status,    type: 'enum', defaultVisible: true, headClassName: 'w-28 text-xs uppercase' },
], []);
```

**Before writing this, read the real `RecentPayload` field names** — the accessors above assume `id`, `source`, `startedAt`, `stage`, `status`:

```bash
rg -n "interface RecentPayload" -A 12 apps/studio/src/
```

Correct the accessors to the actual field names. Build `enumOptions` for `status` from the values the page already renders; do not invent them.

Add matching `valueGetters`, replace the search input at `:190`, and paste the canonical blocks with `<SEARCH_COLUMN>` = `'payload'`. Preserve the existing `⋯`/refresh control by moving it into `actions`. The stage legend at `:57` is not a filter — leave it alone.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/Activity.test.tsx src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/pages/Activity.tsx apps/studio/src/pages/Activity.test.tsx
git commit -m "feat(studio): Activity adopts the standard table toolbar"
```

---

## Task 5: Connectors adopts the toolbar

**Files:**
- Modify: `apps/studio/src/pages/settings/Connectors.tsx`
- Test: `apps/studio/src/pages/settings/Connectors.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `expectStandardTableToolbar()` from Task 1.
- Produces: nothing other tasks depend on.

**Context:** `Connectors.tsx:139` holds `useState<Connector[]>`. Headers at `:290-294` are translated: `settings.connectors.colName`, `colType`, `colHost`, `colEnabled`, `colActions`. No search box today — it gains one. This page is the repo's reference for the header `⋯` menu (AGENTS.md §5), so preserve that menu exactly, moved into `actions`.

- [ ] **Step 1: Write the failing test**

If `Connectors.test.tsx` does not exist, create it. Copy the `vi.mock('@/api', …)` setup and the render wrapper from `src/pages/Users.test.tsx` — that file is the working reference for mocking the api layer and providing the i18n and router context.

```tsx
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';

it('renders the standard table toolbar with the chips row', async () => {
  render(<MemoryRouter><Connectors /></MemoryRouter>);
  await screen.findByRole('table');        // wait for rows

  await addFilterViaPopover('x');
  expectStandardTableToolbar();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/Connectors.test.tsx`
Expected: FAIL — no button named `/filter/i`.

- [ ] **Step 3: Write minimal implementation**

```tsx
const columns: ColumnDef<Connector>[] = useMemo(() => [
  { id: 'name',    labelKey: 'settings.connectors.colName',    accessor: (c) => c.name, type: 'text', defaultVisible: true },
  { id: 'type',    labelKey: 'settings.connectors.colType',    accessor: (c) => c.type, type: 'enum', defaultVisible: true },
  { id: 'host',    labelKey: 'settings.connectors.colHost',    accessor: (c) => c.host, type: 'text', defaultVisible: true },
  { id: 'enabled', labelKey: 'settings.connectors.colEnabled', accessor: (c) => String(c.enabled), type: 'enum', defaultVisible: true,
    enumOptions: [{ value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }] },
], []);
```

**Read the real `Connector` type first** and correct field names plus the `type` enum options:

```bash
rg -n "type Connector" -A 15 apps/studio/src/api.ts
```

Add `settings.connectors.searchPlaceholder` to all three locales (`'Search connectors'` / `'Rechercher des connecteurs'` / `'Pesquisar conectores'`), then paste the canonical blocks with `<SEARCH_COLUMN>` = `'name'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/Connectors.test.tsx src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/pages/settings/Connectors.tsx apps/studio/src/pages/settings/Connectors.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Connectors adopts the standard table toolbar"
```

---

## Task 6: Sites adopts the toolbar

**Files:**
- Modify: `apps/studio/src/pages/settings/Sites.tsx`
- Test: `apps/studio/src/pages/settings/Sites.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `expectStandardTableToolbar()` from Task 1.
- Produces: nothing other tasks depend on.

**Context:** `Sites.tsx:34` holds `useState<SyncSiteRow[]>`. Headers at `:144-149` are translated: `sites.siteId`, `sites.name`, `sites.clientId`, `sites.status`, `sites.enrolledAt`, plus an empty `w-16` actions head. No search box today.

- [ ] **Step 1: Write the failing test**

Create or extend `Sites.test.tsx`, copying the api-mock and render wrapper from `src/pages/Users.test.tsx`:

```tsx
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';

it('renders the standard table toolbar with the chips row', async () => {
  render(<MemoryRouter><Sites /></MemoryRouter>);
  await screen.findByRole('table');

  await addFilterViaPopover('x');
  expectStandardTableToolbar();
});
```

`siteId` is the first column and is text, so the popover's value input is the plain "Enter value" box — the helper's precondition holds here.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/Sites.test.tsx`
Expected: FAIL — no button named `/filter/i`.

- [ ] **Step 3: Write minimal implementation**

```tsx
const columns: ColumnDef<SyncSiteRow>[] = useMemo(() => [
  { id: 'siteId',     labelKey: 'sites.siteId',     accessor: (s) => s.siteId,     type: 'text', defaultVisible: true },
  { id: 'name',       labelKey: 'sites.name',       accessor: (s) => s.name,       type: 'text', defaultVisible: true },
  { id: 'clientId',   labelKey: 'sites.clientId',   accessor: (s) => s.clientId,   type: 'text', defaultVisible: true },
  { id: 'status',     labelKey: 'sites.status',     accessor: (s) => s.status,     type: 'enum', defaultVisible: true, headClassName: 'w-24' },
  { id: 'enrolledAt', labelKey: 'sites.enrolledAt', accessor: (s) => s.enrolledAt, type: 'date', defaultVisible: true, headClassName: 'w-40' },
], []);
```

**Read the real `SyncSiteRow` type first** and correct field names plus the `status` enum options:

```bash
rg -n "SyncSiteRow" -A 12 apps/studio/src/api.ts
```

Add `sites.searchPlaceholder` to all three locales (`'Search sites'` / `'Rechercher des sites'` / `'Pesquisar sites'`), then paste the canonical blocks with `<SEARCH_COLUMN>` = `'name'`. Keep the existing per-row `⋯` cell.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/Sites.test.tsx src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/pages/settings/Sites.tsx apps/studio/src/pages/settings/Sites.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Sites adopts the standard table toolbar"
```

---

## Task 7: DistributedSync sync-activity table adopts the toolbar

**Files:**
- Modify: `apps/studio/src/pages/settings/DistributedSync.tsx`
- Test: `apps/studio/src/pages/settings/DistributedSync.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `expectStandardTableToolbar()` from Task 1.
- Produces: nothing other tasks depend on.

**Context:** this page is mostly a settings form. Only the **sync activity table** is in scope. Its headers at `:392-396` are translated: `settings.sync.cols.direction`, `event`, `records`, `detail`, `time`. Its search box is at `:196`, filtering `direction`, `event` and `error`.

**Do not touch the `<Select>` at `:265`** — that is the sync-mode config field, not a filter.

- [ ] **Step 1: Write the failing test**

Create or extend `DistributedSync.test.tsx`, copying the api-mock and render wrapper from `src/pages/Users.test.tsx`:

```tsx
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';

it('renders the standard table toolbar on the sync activity table', async () => {
  render(<MemoryRouter><DistributedSync /></MemoryRouter>);
  await screen.findByRole('table');        // the sync activity table

  await addFilterViaPopover('x');
  expectStandardTableToolbar();
});
```

⚠ **`direction` is the first column and is `type: 'enum'`.** The popover will render a Select, not the "Enter value" input, so `addFilterViaPopover` fails as written. Order `event` (text) first in the `columns` array, or set `filterable: false` on `direction`. This is the caveat named in Task 1.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/DistributedSync.test.tsx`
Expected: FAIL — no button named `/filter/i`.

- [ ] **Step 3: Write minimal implementation**

Derive the row type from the existing state rather than inventing a name:

```tsx
type SyncActivityRow = (typeof syncActivity)[number];

const columns: ColumnDef<SyncActivityRow>[] = useMemo(() => [
  { id: 'direction', labelKey: 'settings.sync.cols.direction', accessor: (a) => a.direction, type: 'enum',   defaultVisible: true, headClassName: 'w-24 text-xs uppercase' },
  { id: 'event',     labelKey: 'settings.sync.cols.event',     accessor: (a) => a.event,     type: 'text',   defaultVisible: true, headClassName: 'w-32 text-xs uppercase' },
  { id: 'records',   labelKey: 'settings.sync.cols.records',   accessor: (a) => a.records,   type: 'number', defaultVisible: true, headClassName: 'w-24 text-right text-xs uppercase' },
  { id: 'detail',    labelKey: 'settings.sync.cols.detail',    accessor: (a) => a.error ?? '', type: 'text', defaultVisible: true, headClassName: 'text-xs uppercase' },
  { id: 'time',      labelKey: 'settings.sync.cols.time',      accessor: (a) => a.time,      type: 'date',   defaultVisible: true, headClassName: 'w-44 text-xs uppercase' },
], []);
```

Confirm the field names against the real rows before committing — the `detail` and `time` accessors are the least certain:

```bash
rg -n "syncActivity" -B 3 -A 10 apps/studio/src/pages/settings/DistributedSync.tsx | head -40
```

Replace the search box at `:196` and the `filtered` memo at `:196-204` with the canonical blocks. The old search matched three fields, so keep three search rules combined with `or`, following the two-rule pattern shown in Task 3. Add `settings.sync.searchPlaceholder` to all three locales.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/DistributedSync.test.tsx src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/pages/settings/DistributedSync.tsx apps/studio/src/pages/settings/DistributedSync.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): DistributedSync activity table adopts the standard table toolbar"
```

---

## Task 8: Terminology value sets table adopts the toolbar

**Files:**
- Modify: `apps/studio/src/pages/Terminology.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`
- Test: `apps/studio/src/pages/Terminology.test.tsx`

**Interfaces:**
- Consumes: `expectStandardTableToolbar()` from Task 1.
- Produces: nothing other tasks depend on.

**This is the hardest task. If it fights, stop and split it out rather than dragging the slice.**

**Context, all verified:**
- Scope is the **value sets table only**. The page has a rail and several nested tables across tabs; the others stay as they are.
- The code-system `<Select>` is at `:876`, the search input at `:882`. Both are replaced.
- Both strings are **hardcoded English** — `"Filter by code system"` and `"Search value sets..."`. Same defect fixed in `faa7d56f`.
- The filtering logic is at `:212-217`: `vsSystem` (defaulting to `'__all__'`) plus a search over `title`, `url` and `name`.
- **The code-system options are derived from data** at `:218` — `vsSystemOptions`, deduped `primarySystem` values. `ColumnDef.enumOptions` is a static array, so this needs a `useMemo` and the `columns` array must depend on it.

- [ ] **Step 1: Write the failing test**

Add to `Terminology.test.tsx`:

```tsx
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';

it('renders the standard table toolbar on the value sets table', async () => {
  render(<MemoryRouter><Terminology /></MemoryRouter>);
  // navigate to a publisher section that has value sets, using whatever
  // interaction the neighbouring tests in this file already use
  await screen.findByRole('table');

  await addFilterViaPopover('x');
  expectStandardTableToolbar();
});
```

`title` is the first column and is text, so the "Enter value" input is what renders.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/Terminology.test.tsx`
Expected: FAIL — no button named `/filter/i`.

- [ ] **Step 3: Write minimal implementation**

Add i18n keys under the `terminology` namespace in all three locales:

```ts
// en.ts
vsSearchPlaceholder: 'Search value sets',
vsColTitle: 'Title', vsColUrl: 'URL', vsColSystem: 'Code system',
```

```ts
// fr.ts
vsSearchPlaceholder: 'Rechercher des jeux de valeurs',
vsColTitle: 'Titre', vsColUrl: 'URL', vsColSystem: 'Système de codes',
```

```ts
// pt.ts
vsSearchPlaceholder: 'Pesquisar conjuntos de valores',
vsColTitle: 'Título', vsColUrl: 'URL', vsColSystem: 'Sistema de códigos',
```

Build the derived enum options and the memoised columns:

```tsx
const vsSystemOptions = useMemo(
  () => Array.from(new Set((activeSection?.valueSets ?? []).map((v) => v.primarySystem).filter((s): s is string => !!s))),
  [activeSection],
);

const columns: ColumnDef<ValueSetRow>[] = useMemo(() => [
  { id: 'title',         labelKey: 'terminology.vsColTitle',  accessor: (v) => v.title ?? v.name ?? v.url, type: 'text', defaultVisible: true },
  { id: 'url',           labelKey: 'terminology.vsColUrl',    accessor: (v) => v.url,                      type: 'text', defaultVisible: true, cellClassName: 'font-mono text-xs' },
  { id: 'primarySystem', labelKey: 'terminology.vsColSystem', accessor: (v) => systemLabel(v.primarySystem ?? ''), type: 'enum', defaultVisible: true,
    enumOptions: vsSystemOptions.map((s) => ({ value: s, label: systemLabel(s) })) },
], [vsSystemOptions, systemLabel]);
```

`columns` depends on `vsSystemOptions`, which is the whole point — miss it and the options go stale when the section changes.

`systemLabel` is defined at `:219`. If it is not already stable, wrap it in `useCallback` so the `columns` memo does not thrash.

Replace the type name `ValueSetRow` with the real element type of `activeSection.valueSets`. Read it first:

```bash
rg -n "valueSets" -B 5 apps/studio/src/api.ts | head -30
```

Delete the `<Select>` at `:876`, the search `<Input>` at `:882`, and the `filteredValueSets` memo at `:212-217`. Paste the canonical blocks with `searchPlaceholder={t('terminology.vsSearchPlaceholder')}` and `<SEARCH_COLUMN>` = `'title'`. The old search also matched `url` and `name`, so keep three `or`-combined search rules as in Task 3.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/Terminology.test.tsx src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/pages/Terminology.tsx apps/studio/src/pages/Terminology.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Terminology value sets adopt the standard table toolbar"
```

---

## Task 9: Docs describe the toolbar, in three languages

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/{en,fr,pt}/connectors.md`
- Modify: any other doc naming a control this slice replaced
- Modify: `apps/web/src/docs/0.1.0/*.md` where the same prose appears

**Interfaces:**
- Consumes: the finished UI from Tasks 2-8.
- Produces: nothing.

A feature is not done when the UI works — docs in en, fr and pt are part of the same task (AGENTS.md §6).

- [ ] **Step 1: Find every doc naming a replaced control**

```bash
rg -iln "search box|filter by|dropdown|search field" apps/studio/src/docs apps/web/src/docs
```

- [ ] **Step 2: Read each hit and decide**

Only prose describing a control this slice changed needs editing. A doc mentioning "filter" generically does not.

- [ ] **Step 3: Update the prose in all three locales**

Describe the shared pattern once: search, Filter with a count badge, Sort, Columns, Reset, and removable chips beneath. Keep each locale's existing voice.

- [ ] **Step 4: Verify no locale was missed**

```bash
for l in en fr pt; do echo "== $l"; rg -c "Filter" apps/studio/src/docs/0.1.0/$l/connectors.md; done
```
Expected: a comparable count in all three. A missing locale ships a visibly broken page.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/docs apps/web/src/docs
git commit -m "docs(studio): describe the standard table toolbar in en, fr and pt"
```

---

## Task 10: Full gate and mobile verification

**Files:** none modified unless a defect is found.

**Interfaces:**
- Consumes: Tasks 1-9.
- Produces: the evidence needed to call this slice done.

- [ ] **Step 1: Run the full studio suite**

Run: `pnpm --filter @openldr/studio test`
Expected: all files pass. Baseline before this slice was 200 files / 1506 tests.

If it fails, grep the output for `Test timed out` first and re-run that file alone. A gate failure here is usually a timeout, not a regression (AGENTS.md, CLAUDE.md test gate).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: no output from `tsc --noEmit`.

- [ ] **Step 3: Start the app and look at every changed page**

Use `preview_start`, then visit Roles, Forms, Activity, Terminology, Connectors, Sites and DistributedSync. Confirm each shows the same toolbar and that a filter produces a chip.

This is the step the tests cannot do. Component tests prove the toolbar renders; only the browser proves the seven pages look like one app, which is the entire point of the slice.

- [ ] **Step 4: Check mobile at 375×812**

Use `resize_window` at 375×812 on each changed page. Check: the toolbar wraps rather than overflowing, the chips row wraps, tap targets are reachable, and no page scrolls sideways.

Watch for the two `Table` traps (AGENTS.md §6): the scroll wrapper needs `wrapperClassName="min-h-0 flex-1"` with a flex-column parent and the fill gated on having rows; and an empty table's header forces intrinsic width, so `<Table>` must render only when populated.

- [ ] **Step 5: State plainly what was not proven**

Headless Chromium has no retractable URL bar, so `100vh` and `100dvh` measure identically and every bottom-edge check passes either way. If any change touched bottom-anchored UI, say that only a real phone can confirm it. Do not report it verified (AGENTS.md §6).

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix(studio): mobile layout corrections for the standard table toolbar"
```

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: the seven pages are Tasks 2-8, the drift guard is Task 1, i18n is folded into each page task and gated by `parity.test.ts`, docs are Task 9, mobile and the full gate are Task 10. The spec's "no page gets a default filter" is honoured — no task sets `defaultFilters`.

**Three places where the plan says "read the real type first."** Tasks 4, 5, 6, 7 and 8 give concrete `ColumnDef` arrays, but the accessor field names for `RecentPayload`, `Connector`, `SyncSiteRow`, the sync-activity row and the value-set row were not read during planning. Each task carries the exact `rg` command to confirm them. This is deliberate: inventing field names would be worse than naming the check.

**Enum options are never invented.** Every `enumOptions` either comes from data (Terminology) or carries an instruction to read the real values first. AGENTS.md §8 forbids inlining vocabulary that belongs to data.
