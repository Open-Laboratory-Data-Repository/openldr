# Test catalog S2: the Test catalog page, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** A "Test catalog" page in the studio lists the national catalog, adds and edits tests, and lets each lab switch tests on, narrow their specimens and set a local name, with matching `openldr test-catalog` commands for the row actions.

**Architecture:** S1's service in `@openldr/bootstrap` gains three methods: `options()` (the category and specimen choices the save accepts, and the loaded LOINC system), `setEnabled` and `setActive`. `apps/server` serves them as `GET /api/test-catalog/options`, `PUT /:code/enabled` and `PUT /:code/active`. The CLI gets `enable`, `disable`, `retire` and `restore`. The studio page is server-paged with named filters, like `Notifications.tsx`, and copies `Connectors.tsx` and `FieldEditorSheet.tsx` for the toolbar, row menu and sheet.

**Tech Stack:** TypeScript, React, Radix/shadcn, react-i18next, Fastify, zod, commander, vitest (pg-mem for the service, jsdom for the studio).

**Spec:** `docs/superpowers/specs/2026-09-15-test-catalog-design.md`, sections 4.3, 4.6 and 5 (S2). S1's plan, `docs/superpowers/plans/2026-09-15-test-catalog-s1-catalog-data.md`, holds the data decisions this page sits on.

## Global Constraints

- Work in a git worktree under `.claude/worktrees/`, never the main checkout. Leave `.claude/worktrees/peaceful-kirch-839cb2` and `.claude/worktrees/confident-lumiere-666963` alone.
- Stage by exact path. Never `git add <dir>`. No `Co-Authored-By` trailer.
- Commit only as these steps say. Merge or push only when the operator asks.
- New writing follows the `unslop` skill, code comments and UI copy included: no em dashes, no emoji in headings or bullets.
- Run one test file from its package: `cd <package> && npx vitest run <path> --testTimeout 30000`. `pnpm --filter <pkg> test -- <path>` does not filter.
- Typecheck one package: `cd <package> && npx tsc --noEmit -p . > "$TEMP/<name>.txt" 2>&1; echo "exit=$?"`. Never read `$?` through a pipe.
- The gate is `pnpm turbo run typecheck --force --concurrency=4` and `pnpm turbo run test --force --concurrency=4 --continue`, each redirected to a file. Never pipe turbo through `tail`. A failure is usually a timeout: grep for `Test timed out` and re-run that package alone.
- **No migration in S2.** Merging still changes server files, so the dev API restarts under `nodemon`.
- **No clinical vocabulary in code** (AGENTS.md section 8). Categories and specimens come from the options route. The studio never writes the LOINC system URL: the options route returns it.
- **Every studio string goes in `testCatalog` in `en.ts`, `fr.ts` and `pt.ts` together.** `i18n/parity.test.ts` fails on a key one locale lacks. It cannot see a key the code uses and no locale defines, so page tests assert the English text.
- **The Browser pane serves the main checkout**, not the worktree (memory `repo-conventions`). The live UI check and the 375px check run after the merge.

---

## Settled before S2 (operator, 2026-09-15)

1. **LOINC specimen suggestions are deferred.** S1 binds a test's specimens to `urn:openldr:valueset:specimen-type`, which holds four local codes on a default install (`014_value_sets.ts:61`). LOINC's specimen map returns bare SNOMED codes (`apps/studio/src/api.ts`, `SpecimenCode`), so a suggestion could never match there. The operator's install has no LOINC ontology (0 rows in `ontology_specimen_map`, 0 SNOMED concepts, measured 2026-09-15). S3's "take LOINC's single equivalent match" rule hits the same wall and is decided there.
2. **The CLI adds `restore`** beside the spec's `enable`, `disable` and `retire`. Retire is reversible, and a headless central needs the undo.
3. **Viewers get the table only.** Someone with `terminology.view` and not `terminology.manage` sees no row menu and no header menu.

## Where this plan departs from the spec

| Spec says | Plan does | Why |
|---|---|---|
| The sheet suggests specimens from LOINC's map (4.3) | Specimens are picked from CE's specimen-type list only | Decision 1 above |
| "With no LOINC ontology loaded, the sheet says so" (4.3) | The sheet says only whether a LOINC code is searched or typed | Follows from decision 1 |
| Copy the Facilities page (4.3) | Copies `Connectors.tsx` (toolbar menu, row menu, sheet), `Notifications.tsx` (server paging through `translateFilters`) and `FieldEditorSheet.tsx` (the sheet's Save and Cancel menu) | Facilities keeps its own pager and `EmptyState` (`pages/Facilities.tsx:15`, `:54`). AGENTS.md section 5 asks for `TablePagination` and `StripedEmpty` |
| Header menu: Add test, Import from spreadsheet, Export (4.3) | Add test only | Import and export are S3 |
| CLI: enable, disable, retire (4.6) | Adds `restore` | Decision 2 above |
| (not in spec) | `GET /api/test-catalog/options` | The pickers must offer exactly what the save accepts. The studio's `expandValueSet` recomputes a set from CE's terms and overwrites the stored codes (`api.ts:2180-2184`), so it must not feed these pickers |
| (not in spec) | `PUT /:code/enabled` and `PUT /:code/active` | A row action changes one field. `PUT /:code` re-validates every field, so retiring could fail on a LOINC code a later LOINC load no longer holds |
| Search by name or code (4.3) | Search also matches short name and local name | S1's list already searches four fields |
| Empty and loading states go in a `colSpan` cell inside the table (AGENTS.md section 5) | The table renders only when it has rows, and `StripedEmpty` or `LoadingState` fills the pane with `min-h-[16rem]` | AGENTS.md section 6: an empty table's header scrolls sideways on a phone. `Connectors.tsx:373-437` does the same |
| (sorting not specified) | No sort. Every column is `sortable: false` | S1's list orders by code and takes no sort. `Notifications.tsx` does the same |
| Retired tests hidden unless filtered for (4.3) | The Status filter offers Active or Retired, not both | The API's `status=all` stays a CLI option |

## Known effects, not handled in S2

- **Saving the sheet is two requests** at an install that owns the catalog: the test, then this lab's settings. If the second fails after a create, the sheet stays open as an edit of the new test, so saving again does not add it twice.
- **Retire and restore ask no confirmation.** Both are reversible.
- **A LOINC code is searched only when LOINC is loaded here.** Otherwise it is typed, and only its format is checked (S1).
- **The row menu reloads the page after each action**, so the loading state shows briefly.
- **The Terminology page can still edit catalog terms directly** (S1). It shows the LOINC link on its Mappings tab.
- **Bottom-anchored UI:** `TablePagination` sits at the bottom of the page. Headless Chromium cannot see the `vh` versus `dvh` class of bug (AGENTS.md section 6). Only a real phone confirms the pager stays reachable.

---

## What changes

| File | Change |
|---|---|
| `packages/bootstrap/src/test-catalog.ts` | `options`, `setEnabled`, `setActive`, `catalogChangeAction`, option types |
| `packages/bootstrap/src/test-catalog.test.ts` | Tests for the above |
| `packages/bootstrap/src/index.ts` | Export the new names |
| `apps/server/src/test-catalog-routes.ts` | `GET /options`, `PUT /:code/enabled`, `PUT /:code/active` |
| `apps/server/src/test-catalog-routes.test.ts` | Tests for the above |
| `packages/cli/src/test-catalog.ts` | `runTestCatalogChange` |
| `packages/cli/src/test-catalog-change.test.ts` | Create |
| `packages/cli/src/test-catalog-cli-parsing.test.ts` | Parsing tests for the four commands |
| `packages/cli/src/program.ts` | Register `enable`, `disable`, `retire`, `restore` |
| `apps/studio/src/api.ts` | Test catalog client and types |
| `apps/studio/src/api.testCatalog.test.ts` | Create |
| `apps/studio/src/test-catalog/catalogFilters.ts` | Create. `translateFilters` |
| `apps/studio/src/test-catalog/catalogFilters.test.ts` | Create |
| `apps/studio/src/pages/TestCatalog.tsx` | Create. The page |
| `apps/studio/src/pages/TestCatalog.test.tsx` | Create |
| `apps/studio/src/test-catalog/TestSheet.tsx` | Create. The add and edit sheet |
| `apps/studio/src/test-catalog/TestSheet.test.tsx` | Create |
| `apps/studio/src/App.tsx` | Route `/test-catalog` |
| `apps/studio/src/shell/AppShell.tsx` | Sidebar item after Facilities |
| `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` | `nav.testCatalog` and the `testCatalog` namespace |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/test-catalog.md` | Create. The in-app guide |
| `apps/studio/src/docs/registry.ts`, `registry.test.ts` | Register the guide |
| `apps/web/src/docs/0.1.8/test-catalog.md` | Create. The web page, three languages |
| `apps/web/src/docs/content.ts`, `DocsPage.test.tsx` | Title, sidebar entry, test |
| `apps/web/src/docs/0.1.8/cli.md` | The four new commands, three languages |

---

### Task 1: the service's options and row changes

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts`
- Modify: `packages/bootstrap/src/test-catalog.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (the `from './test-catalog'` export block)

**Interfaces:**
- Consumes: S1's `createTestCatalog` internals: `ownedHere`, `get`, `saved`, `notFound`, `refuseUnlessOwned`, `storedConcept`, `loincLoaded`, `RETIRED_STATUS`, `markTerminologyChanged`, `sql`.
- Produces: types `CatalogCategoryOption { code; display: string | null }`, `CatalogSpecimenOption { system; code; display: string | null }`, `CatalogOptions { categories; specimenTypes; loinc: { systemId: string; system: string } | null }`. `TestCatalog.options(): Promise<CatalogOptions>`, `setEnabled(code, enabled: boolean): Promise<CatalogTest>`, `setActive(code, active: boolean): Promise<CatalogTest>`. `catalogChangeAction(field: 'enabled' | 'active', value: boolean): string`.

- [ ] **Step 1: Write the failing tests**

In `packages/bootstrap/src/test-catalog.test.ts`, change the `./test-catalog` import to:

```ts
import {
  createTestCatalog, parseCatalogListQuery, catalogChangeAction, TEST_CATALOG_SYSTEM,
  type CatalogListQuery, type CatalogListResult, type CatalogTestInput,
} from './test-catalog';
```

Append this block at the end of the file:

```ts
describe('test catalog: options and row changes', () => {
  it('offers the categories and specimen types the save accepts, with their names, sorted by name', async () => {
    const { catalog } = await buildCatalog();
    const o = await catalog.options();
    expect(o.categories).toEqual([
      { code: 'CHEM', display: 'Chemistry' },
      { code: 'HAEM', display: 'Haematology' },
      { code: 'MICRO', display: 'Microbiology' },
      { code: 'MOL', display: 'Molecular' },
      { code: 'SERO', display: 'Serology' },
    ]);
    expect(o.specimenTypes).toEqual([
      { system: LOCAL, code: 'BLD', display: 'Blood' },
      { system: LOCAL, code: 'CSF', display: 'CSF' },
      { system: LOCAL, code: 'SPT', display: 'Sputum' },
      { system: LOCAL, code: 'UR', display: 'Urine' },
    ]);
    expect(o.loinc).toBeNull();
  });

  it('names the LOINC system only when LOINC is loaded', async () => {
    const { db, catalog } = await buildCatalog();
    await db.insertInto('coding_systems').values({
      id: 'cs-url-LOINC', system_code: 'LOINC', system_name: 'LOINC', url: LOINC_SYSTEM,
      active: true, publisher_id: 'pub-system', seeded: false,
    } as never).execute();
    expect((await catalog.options()).loinc).toBeNull();
    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    expect((await catalog.options()).loinc).toEqual({ systemId: 'cs-url-LOINC', system: LOINC_SYSTEM });
  });

  it('switches a test on and off and keeps the lab narrowed specimens and local name', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
    await catalog.setLabSettings('HIVVL', { enabled: false, specimenTypes: [UR], localDisplay: 'Viral load' });
    expect((await catalog.setEnabled('HIVVL', true)).lab).toEqual({ enabled: true, specimenTypes: [UR], localDisplay: 'Viral load' });
    expect((await catalog.setEnabled('HIVVL', false)).lab).toEqual({ enabled: false, specimenTypes: [UR], localDisplay: 'Viral load' });
  });

  it('switches on a test the lab has never touched', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'CD4', display: 'CD4 count' });
    expect((await catalog.setEnabled('CD4', true)).lab).toEqual({ enabled: true, specimenTypes: null, localDisplay: null });
  });

  it('still switches a test on after central dropped a specimen the lab had kept', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD] });
    // The lab kept UR, which the catalog no longer lists, as after a later pull from central.
    await db.insertInto('test_catalog_lab_settings')
      .values({ code: 'HIVVL', enabled: false, specimen_types: JSON.stringify([UR]) }).execute();
    expect((await catalog.setEnabled('HIVVL', true)).lab.enabled).toBe(true);
  });

  it('lets a lab that receives central catalog switch tests, and refuses an unknown test', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await markCentral(db);
    expect((await catalog.setEnabled('HIVVL', true)).lab.enabled).toBe(true);
    await expect(catalog.setEnabled('NOPE', true))
      .rejects.toMatchObject({ kind: 'not-found', message: 'Test NOPE is not in the catalog.' });
  });

  it('never signals a sync change for a switch', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    const count = async () => (await db.selectFrom('reference_change_log').select('seq').execute()).length;
    const before = await count();
    await catalog.setEnabled('HIVVL', true);
    expect(await count()).toBe(before);
  });

  it('retires and restores a test and changes nothing else', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
    expect(await catalog.setActive('HIVVL', false))
      .toMatchObject({ active: false, category: 'MOL', specimenTypes: [BLD], loinc: '25836-8' });
    expect((await storedConcept(db, 'HIVVL')).status).toBe('DEPRECATED');
    expect((await catalog.setActive('HIVVL', true)).active).toBe(true);
    expect((await storedConcept(db, 'HIVVL')).status).toBe('ACTIVE');
  });

  it('retires a test whose LOINC code a later LOINC load does not hold', async () => {
    const { db, catalog } = await buildCatalog();
    // With no LOINC loaded, the link stubs a DRAFT 25836-8. Loading LOINC without it makes a full re-save fail.
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
    await db.insertInto('terminology_concepts').values({
      system: LOINC_SYSTEM, code: '2345-7', display: 'Glucose', status: 'ACTIVE', properties: null,
    }).execute();
    await expect(catalog.update('HIVVL', { display: 'HIV viral load', loinc: '25836-8', active: false }))
      .rejects.toMatchObject({ kind: 'invalid' });
    expect((await catalog.setActive('HIVVL', false)).active).toBe(false);
  });

  it('signals one sync change per real status change, and none when nothing changes', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    const generation = async () => Number((await db.selectFrom('terminology_systems').select('generation')
      .where('url', '=', TEST_CATALOG_SYSTEM).executeTakeFirstOrThrow()).generation);
    expect(await generation()).toBe(1);
    await catalog.setActive('HIVVL', true);
    expect(await generation()).toBe(1);
    await catalog.setActive('HIVVL', false);
    expect(await generation()).toBe(2);
  });

  it('refuses to retire an unknown test, or at a lab that receives central catalog', async () => {
    const { db, catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await expect(catalog.setActive('NOPE', false)).rejects.toMatchObject({ kind: 'not-found' });
    await markCentral(db);
    await expect(catalog.setActive('HIVVL', false)).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('names the audit action for each row change', () => {
    expect([
      catalogChangeAction('enabled', true), catalogChangeAction('enabled', false),
      catalogChangeAction('active', false), catalogChangeAction('active', true),
    ]).toEqual(['test_catalog.enable', 'test_catalog.disable', 'test_catalog.retire', 'test_catalog.restore']);
  });
});
```

`LOCAL`, `BLD`, `UR`, `buildCatalog`, `markCentral` and `storedConcept` already exist in this file from S1.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: the new tests FAIL (`catalogChangeAction is not a function`, `catalog.options is not a function`). S1's 27 tests still PASS.

- [ ] **Step 3: Add the types and the audit name**

In `packages/bootstrap/src/test-catalog.ts`, directly below the `LabSettingsInput` interface, add:

```ts
/** A category the sheet can offer. */
export interface CatalogCategoryOption {
  code: string;
  display: string | null;
}

/** A specimen type the sheet can offer. */
export interface CatalogSpecimenOption {
  system: string;
  code: string;
  display: string | null;
}

/** Everything the page's pickers offer, taken from the same ValueSets the save checks against. */
export interface CatalogOptions {
  categories: CatalogCategoryOption[];
  specimenTypes: CatalogSpecimenOption[];
  /** The LOINC code system when LOINC is loaded here, so the sheet can search it. Null otherwise. */
  loinc: { systemId: string; system: string } | null;
}
```

Directly below the `TestCatalogError` class, add:

```ts
/** The audit action for a row change. The route and the CLI both record it, so they must agree. */
export function catalogChangeAction(field: 'enabled' | 'active', value: boolean): string {
  if (field === 'enabled') return value ? 'test_catalog.enable' : 'test_catalog.disable';
  return value ? 'test_catalog.restore' : 'test_catalog.retire';
}
```

Change the `TestCatalog` interface to:

```ts
export interface TestCatalog {
  ownedHere(): Promise<boolean>;
  list(query: CatalogListQuery): Promise<CatalogListResult>;
  get(code: string): Promise<CatalogTest | null>;
  create(input: CatalogTestInput): Promise<CatalogTest>;
  update(code: string, input: CatalogTestInput): Promise<CatalogTest>;
  setLabSettings(code: string, input: LabSettingsInput): Promise<CatalogTest>;
  options(): Promise<CatalogOptions>;
  setEnabled(code: string, enabled: boolean): Promise<CatalogTest>;
  setActive(code: string, active: boolean): Promise<CatalogTest>;
}
```

Directly below the module-level `uniqueCodings` function, add:

```ts
/** Order picker choices by what the operator reads: the name, or the code when there is none. */
function byLabel(a: { code: string; display: string | null }, b: { code: string; display: string | null }): number {
  return (a.display ?? a.code).localeCompare(b.display ?? b.code);
}
```

- [ ] **Step 4: Add the methods**

In `createTestCatalog`, replace the `expandCodes` function with these two:

```ts
  async function expandEntries(url: string): Promise<CatalogSpecimenOption[]> {
    const vs = await deps.ops.expand(url, { count: 100_000 });
    return (vs.expansion?.contains ?? [])
      .map((c) => ({ system: c.system ?? '', code: c.code ?? '', display: c.display ?? null }));
  }

  async function expandCodes(url: string): Promise<SpecimenCoding[]> {
    return (await expandEntries(url)).map(({ system, code }) => ({ system, code }));
  }
```

Directly above `  return {` at the end of `createTestCatalog`, add:

```ts
  async function options(): Promise<CatalogOptions> {
    const [categories, specimenTypes] = await Promise.all([
      expandEntries(TEST_CATEGORY_VALUE_SET),
      expandEntries(SPECIMEN_TYPE_VALUE_SET),
    ]);
    let loinc: CatalogOptions['loinc'] = null;
    if (await loincLoaded()) {
      const row = await db.selectFrom('coding_systems').select('id').where('url', '=', LOINC_SYSTEM).executeTakeFirst();
      if (row) loinc = { systemId: row.id, system: LOINC_SYSTEM };
    }
    return {
      categories: categories.map(({ code, display }) => ({ code, display })).sort(byLabel),
      specimenTypes: specimenTypes.sort(byLabel),
      loinc,
    };
  }

  async function setEnabled(code: string, enabled: boolean): Promise<CatalogTest> {
    // Only the switch changes. The lab's narrowed specimens and local name stay as they are, even when
    // central has since dropped a specimen the lab kept: switching a test on must not fail on a field
    // the operator did not touch. Nothing here signals sync.
    if (!(await storedConcept(code))) throw notFound(code);
    await db.insertInto('test_catalog_lab_settings').values({ code, enabled, updated_at: sql<Date>`now()` })
      .onConflict((oc) => oc.column('code').doUpdateSet({ enabled, updated_at: sql<Date>`now()` }))
      .execute();
    return saved(code);
  }

  async function setActive(code: string, active: boolean): Promise<CatalogTest> {
    await refuseUnlessOwned();
    const test = await get(code);
    if (!test) throw notFound(code);
    // Only the status changes, so retiring never fails on a field it does not touch. No change means
    // no write and no sync signal.
    if (test.active === active) return test;
    await db.updateTable('terminology_concepts')
      .set({ status: active ? 'ACTIVE' : RETIRED_STATUS })
      .where('system', '=', TEST_CATALOG_SYSTEM).where('code', '=', code)
      .execute();
    await markTerminologyChanged(db, TEST_CATALOG_SYSTEM);
    return saved(code);
  }

```

Change the returned object to:

```ts
  return {
    ownedHere,
    list,
    get,
    create,
    update,
    setLabSettings,
    options,
    setEnabled,
    setActive,
  };
```

- [ ] **Step 5: Export the new names**

In `packages/bootstrap/src/index.ts`, change the `from './test-catalog'` export block to:

```ts
export {
  createTestCatalog, parseCatalogListQuery, catalogChangeAction, TestCatalogError,
  TEST_CATALOG_SYSTEM, TEST_CATEGORY_SYSTEM, TEST_CATEGORY_VALUE_SET, SPECIMEN_TYPE_VALUE_SET,
  type TestCatalog, type CatalogTest, type CatalogTestInput, type CatalogListQuery, type CatalogListResult,
  type LabSettingsInput, type SpecimenCoding,
  type CatalogOptions, type CatalogCategoryOption, type CatalogSpecimenOption,
} from './test-catalog';
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: every test PASSES, 39 in all.

- [ ] **Step 7: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s2-t1-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): offer the catalog's picker choices, and switch or retire one test" -m "options returns the categories and specimen types the save checks against, with their names, and the LOINC system when LOINC is loaded, so the page's pickers offer only what a save accepts. setEnabled changes only this lab's switch and never signals sync. setActive retires or restores a test without re-checking its other fields, and signals labs only when the status changes. catalogChangeAction names the audit action the route and the CLI both record."
```

---

### Task 2: the options and row-change routes

**Files:**
- Modify: `apps/server/src/test-catalog-routes.ts`
- Modify: `apps/server/src/test-catalog-routes.test.ts`

**Interfaces:**
- Consumes: Task 1's `options`, `setEnabled`, `setActive`, `catalogChangeAction`, `CatalogOptions`.
- Produces:
  - `GET /api/test-catalog/options` (`terminology.view`): 200 `CatalogOptions`.
  - `PUT /api/test-catalog/:code/enabled` (`terminology.manage`): body `{ enabled: boolean }`. 200 `CatalogTest`. Audit `test_catalog.enable` or `test_catalog.disable`, before `{ enabled }`, after `{ enabled }`.
  - `PUT /api/test-catalog/:code/active` (`terminology.manage`): body `{ active: boolean }`. 200 `CatalogTest`. Audit `test_catalog.retire` or `test_catalog.restore`, before `{ active }`, after `{ active }`.
  - A missing test answers 404, a central-managed retire 409, a bad body 400, all as S1's routes do.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/test-catalog-routes.test.ts`, change the import from `@openldr/bootstrap` to:

```ts
import { TestCatalogError, type AppContext, type CatalogOptions, type CatalogTest } from '@openldr/bootstrap';
```

Below the `TEST` constant, add:

```ts
const OPTIONS: CatalogOptions = {
  categories: [{ code: 'MOL', display: 'Molecular' }],
  specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }],
  loinc: null,
};
```

Change the `fakeCtx` signature line to:

```ts
function fakeCtx(over: Partial<Record<'list' | 'get' | 'create' | 'update' | 'setLabSettings' | 'options' | 'setEnabled' | 'setActive', Impl>> = {}) {
```

and add these three entries at the end of its `testCatalog` object:

```ts
    options: spy('options', over.options ?? (async () => OPTIONS)),
    setEnabled: spy('setEnabled', over.setEnabled ?? (async () => TEST)),
    setActive: spy('setActive', over.setActive ?? (async () => TEST)),
```

Append these tests inside the `describe('test catalog routes', ...)` block, after its last test:

```ts
  it('GET /api/test-catalog/options returns the picker choices and needs terminology.view', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/test-catalog/options' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(OPTIONS);
    expect(calls).toEqual([{ method: 'options', args: [] }]);
    expect((await appWith(ctx, []).inject({ method: 'GET', url: '/api/test-catalog/options' })).statusCode).toBe(403);
  });

  it('PUT /:code/enabled switches a test and audits it as test_catalog.enable', async () => {
    const after = { ...TEST, lab: { ...TEST.lab, enabled: true } };
    const { ctx, calls, audit } = fakeCtx({ setEnabled: async () => after });
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/enabled', payload: { enabled: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(after);
    expect(calls).toEqual([
      { method: 'get', args: ['HIVVL'] },
      { method: 'setEnabled', args: ['HIVVL', true] },
    ]);
    expect(audit).toMatchObject([{
      action: 'test_catalog.enable', entityType: 'test_catalog', entityId: 'HIVVL', before: { enabled: false }, after: { enabled: true },
    }]);
  });

  it('PUT /:code/active retires a test and audits it as test_catalog.retire', async () => {
    const after = { ...TEST, active: false };
    const { ctx, calls, audit } = fakeCtx({ setActive: async () => after });
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/active', payload: { active: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(after);
    expect(calls).toEqual([
      { method: 'get', args: ['HIVVL'] },
      { method: 'setActive', args: ['HIVVL', false] },
    ]);
    expect(audit).toMatchObject([{
      action: 'test_catalog.retire', entityType: 'test_catalog', entityId: 'HIVVL', before: { active: true }, after: { active: false },
    }]);
  });

  it('the row-change routes need terminology.manage and a boolean body', async () => {
    const { ctx, calls } = fakeCtx();
    const viewer = appWith(ctx, ['terminology.view']);
    expect((await viewer.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/enabled', payload: { enabled: true } })).statusCode).toBe(403);
    expect((await viewer.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/active', payload: { active: false } })).statusCode).toBe(403);
    const admin = appWith(ctx);
    expect((await admin.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/enabled', payload: { enabled: 'yes' } })).statusCode).toBe(400);
    expect((await admin.inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/active', payload: {} })).statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('maps a row-change refusal to its status, keeps its words and audits nothing', async () => {
    const { ctx, audit } = fakeCtx({ setActive: async () => { throw new TestCatalogError('central only', 'central-managed'); } });
    const res = await appWith(ctx).inject({ method: 'PUT', url: '/api/test-catalog/HIVVL/active', payload: { active: false } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'central only', kind: 'central-managed' });
    expect(audit).toEqual([]);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: the five new tests FAIL with 404 (no such route). S1's nine still PASS.

- [ ] **Step 3: Add the routes**

In `apps/server/src/test-catalog-routes.ts`, change the `@openldr/bootstrap` import to:

```ts
import { catalogChangeAction, parseCatalogListQuery, TestCatalogError, type AppContext } from '@openldr/bootstrap';
```

Below the `labInput` schema, add:

```ts
const enabledInput = z.object({ enabled: z.boolean() });
const activeInput = z.object({ active: z.boolean() });
```

Inside `registerTestCatalogRoutes`, directly after the `app.get('/api/test-catalog', ...)` route, add:

```ts
  // The page's pickers read this, not a ValueSet expansion, so they offer exactly what a save accepts.
  app.get('/api/test-catalog/options', VIEW, async (_req, reply) => {
    return reply.send(await ctx.testCatalog.options());
  });
```

At the end of `registerTestCatalogRoutes`, after the `PUT /api/test-catalog/:code/lab` route, add:

```ts
  // The page's row actions. Each changes one field; `openldr test-catalog enable | disable | retire |
  // restore` calls the same service methods and records the same audit action.
  app.put('/api/test-catalog/:code/enabled', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = enabledInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = await ctx.testCatalog.get(code);
      const saved = await ctx.testCatalog.setEnabled(code, parsed.data.enabled);
      await recordAudit(ctx, req, {
        action: catalogChangeAction('enabled', parsed.data.enabled), entityType: 'test_catalog', entityId: code,
        before: { enabled: before?.lab.enabled ?? null }, after: { enabled: saved.lab.enabled },
      });
      return reply.send(saved);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.put('/api/test-catalog/:code/active', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = activeInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = await ctx.testCatalog.get(code);
      const saved = await ctx.testCatalog.setActive(code, parsed.data.active);
      await recordAudit(ctx, req, {
        action: catalogChangeAction('active', parsed.data.active), entityType: 'test_catalog', entityId: code,
        before: { active: before?.active ?? null }, after: { active: saved.active },
      });
      return reply.send(saved);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: every test PASSES, 14 in all.

- [ ] **Step 5: Lint and typecheck the server**

```bash
cd apps/server && npx eslint src/test-catalog-routes.ts src/test-catalog-routes.test.ts > "$TEMP/s2-t2-lint.txt" 2>&1; echo "lint exit=$?"
cd apps/server && npx tsc --noEmit -p . > "$TEMP/s2-t2-tc.txt" 2>&1; echo "tsc exit=$?"
```

Expected: both `exit=0`. `apps/server` is the one package with real lint (the `return reply.send` rule).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/test-catalog-routes.ts apps/server/src/test-catalog-routes.test.ts
git commit -m "feat(server): serve the catalog's picker choices and its two row actions" -m "GET /api/test-catalog/options returns the categories, specimen types and loaded LOINC system the page's pickers offer. PUT /:code/enabled switches a test on or off at this lab and PUT /:code/active retires or restores it. Both need terminology.manage, answer a refusal with its own words and kind, and are audited as test_catalog.enable, disable, retire or restore."
```

---

### Task 3: `openldr test-catalog enable | disable | retire | restore`

**Files:**
- Modify: `packages/cli/src/test-catalog.ts`
- Create: `packages/cli/src/test-catalog-change.test.ts`
- Modify: `packages/cli/src/test-catalog-cli-parsing.test.ts`
- Modify: `packages/cli/src/program.ts` (the `./test-catalog` import, and the `test-catalog` group after its `list` command)

**Interfaces:**
- Consumes: Task 1's `setEnabled`, `setActive`, `catalogChangeAction`; `recordAuditEvent` from `@openldr/bootstrap`; `cliActor` from `./cli-actor`.
- Produces: `type TestCatalogChange = 'enable' | 'disable' | 'retire' | 'restore'`; `runTestCatalogChange(change, code, opts: { json: boolean }): Promise<number>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/test-catalog-change.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAppContext: vi.fn(),
  get: vi.fn(),
  setEnabled: vi.fn(),
  setActive: vi.fn(),
  close: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));
vi.mock('./cli-actor', () => ({ cliActor: () => ({ actorType: 'cli', actorId: null, actorName: 'tester' }) }));

// Partial: catalogChangeAction stays real, so the CLI is checked against the route's own audit names.
vi.mock('@openldr/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return {
    createAppContext: mocks.createAppContext,
    recordAuditEvent: mocks.recordAuditEvent,
    parseCatalogListQuery: actual.parseCatalogListQuery,
    catalogChangeAction: actual.catalogChangeAction,
    TestCatalogError: actual.TestCatalogError,
  };
});

import { TestCatalogError } from '@openldr/bootstrap';
import { runTestCatalogChange } from './test-catalog';

const TEST = {
  code: 'HIVVL', display: 'HIV viral load', shortName: null, category: 'MOL', specimenTypes: [], loinc: null,
  active: true, lab: { enabled: false, specimenTypes: null, localDisplay: null },
};

describe('openldr test-catalog enable | disable | retire | restore', () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    mocks.get.mockResolvedValue(TEST);
    mocks.close.mockResolvedValue(undefined);
    mocks.createAppContext.mockResolvedValue({
      testCatalog: { get: mocks.get, setEnabled: mocks.setEnabled, setActive: mocks.setActive },
      close: mocks.close,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it('enable switches the test on and audits it as the CLI', async () => {
    mocks.setEnabled.mockResolvedValue({ ...TEST, lab: { ...TEST.lab, enabled: true } });
    expect(await runTestCatalogChange('enable', 'HIVVL', { json: false })).toBe(0);
    expect(mocks.setEnabled).toHaveBeenCalledWith('HIVVL', true);
    expect(out.join('')).toBe('HIVVL is now on at this lab.\n');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      { actorType: 'cli', actorId: null, actorName: 'tester' },
      { action: 'test_catalog.enable', entityType: 'test_catalog', entityId: 'HIVVL', before: { enabled: false }, after: { enabled: true } },
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('disable, retire and restore call the matching method and record the matching action', async () => {
    mocks.setEnabled.mockResolvedValue(TEST);
    mocks.setActive.mockImplementation(async (_code: string, active: boolean) => ({ ...TEST, active }));
    const cases: Array<['disable' | 'retire' | 'restore', string, string]> = [
      ['disable', 'test_catalog.disable', 'HIVVL is now off at this lab.\n'],
      ['retire', 'test_catalog.retire', 'HIVVL is retired.\n'],
      ['restore', 'test_catalog.restore', 'HIVVL is active again.\n'],
    ];
    for (const [change, action, line] of cases) {
      out.length = 0;
      mocks.recordAuditEvent.mockClear();
      expect(await runTestCatalogChange(change, 'HIVVL', { json: false })).toBe(0);
      expect(out.join('')).toBe(line);
      expect(mocks.recordAuditEvent.mock.calls[0][2]).toMatchObject({ action });
    }
    expect(mocks.setEnabled).toHaveBeenCalledWith('HIVVL', false);
    expect(mocks.setActive.mock.calls).toEqual([['HIVVL', false], ['HIVVL', true]]);
  });

  it('prints the changed test as JSON with --json', async () => {
    mocks.setActive.mockResolvedValue({ ...TEST, active: false });
    await runTestCatalogChange('retire', 'HIVVL', { json: true });
    expect(JSON.parse(out.join(''))).toEqual({ ...TEST, active: false });
  });

  it('reports a refusal in the service words, audits nothing and still closes the context', async () => {
    mocks.setActive.mockRejectedValue(new TestCatalogError('This catalog comes from central.', 'central-managed'));
    expect(await runTestCatalogChange('retire', 'HIVVL', { json: false })).toBe(1);
    expect(err.join('')).toBe('test-catalog retire failed: This catalog comes from central.\n');
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
```

In `packages/cli/src/test-catalog-cli-parsing.test.ts`, replace the `mocks` and `vi.mock` lines with:

```ts
const mocks = vi.hoisted(() => ({
  runTestCatalogList: vi.fn().mockResolvedValue(0),
  runTestCatalogChange: vi.fn().mockResolvedValue(0),
}));

vi.mock('./test-catalog', () => ({
  runTestCatalogList: mocks.runTestCatalogList,
  runTestCatalogChange: mocks.runTestCatalogChange,
}));
```

change its `beforeEach` body to:

```ts
    mocks.runTestCatalogList.mockClear();
    mocks.runTestCatalogChange.mockClear();
```

and add this test inside its `describe`:

```ts
  it('hands enable, disable, retire and restore their code and --json', async () => {
    for (const change of ['enable', 'disable', 'retire', 'restore'] as const) {
      mocks.runTestCatalogChange.mockClear();
      await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', change, 'HIVVL', '--json']);
      expect(mocks.runTestCatalogChange).toHaveBeenCalledWith(change, 'HIVVL', { json: true });
    }
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/cli && npx vitest run src/test-catalog-change.test.ts src/test-catalog-cli-parsing.test.ts --testTimeout 30000`

Expected: FAIL. `runTestCatalogChange` does not exist, and commander answers `unknown command 'enable'`.

- [ ] **Step 3: Write the command**

In `packages/cli/src/test-catalog.ts`, change the two import lines at the top to:

```ts
import { loadConfig } from '@openldr/config';
import { catalogChangeAction, createAppContext, parseCatalogListQuery, recordAuditEvent } from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';
```

Append at the end of the file:

```ts
export type TestCatalogChange = 'enable' | 'disable' | 'retire' | 'restore';

const CHANGES: Record<TestCatalogChange, { field: 'enabled' | 'active'; value: boolean; done: string }> = {
  enable: { field: 'enabled', value: true, done: 'is now on at this lab' },
  disable: { field: 'enabled', value: false, done: 'is now off at this lab' },
  retire: { field: 'active', value: false, done: 'is retired' },
  restore: { field: 'active', value: true, done: 'is active again' },
};

/** `openldr test-catalog enable | disable | retire | restore <code>`: the CLI door to the page's row
 *  actions, PUT /api/test-catalog/:code/enabled and /active. It calls the same service methods and
 *  records the same audit action, as the CLI actor. Retire is reversible, so none takes --force. */
export async function runTestCatalogChange(change: TestCatalogChange, code: string, opts: { json: boolean }): Promise<number> {
  const { field, value, done } = CHANGES[change];
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.testCatalog.get(code);
    const after = field === 'enabled'
      ? await ctx.testCatalog.setEnabled(code, value)
      : await ctx.testCatalog.setActive(code, value);
    await recordAuditEvent(ctx, cliActor(), {
      action: catalogChangeAction(field, value), entityType: 'test_catalog', entityId: code,
      before: field === 'enabled' ? { enabled: before?.lab.enabled ?? null } : { active: before?.active ?? null },
      after: field === 'enabled' ? { enabled: after.lab.enabled } : { active: after.active },
    });
    process.stdout.write(opts.json ? JSON.stringify(after, null, 2) + '\n' : `${code} ${done}.\n`);
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`test-catalog ${change} failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}
```

In `packages/cli/src/program.ts`, change the `./test-catalog` import to:

```ts
import { runTestCatalogList, runTestCatalogChange, type TestCatalogListOpts } from './test-catalog';
```

Directly after the `test-catalog list` command's `.action(...)` call, and before `const facilities = program.command('facilities')`, add:

```ts
  // Test catalog S2: the CLI doors for the page's row actions. Retire is reversible (restore undoes
  // it), so none of these takes --force.
  const testCatalogChanges = [
    ['enable', 'Switch a test on at this lab'],
    ['disable', 'Switch a test off at this lab'],
    ['retire', 'Retire a test (only where this install owns the catalog)'],
    ['restore', 'Undo a retire'],
  ] as const;
  for (const [change, description] of testCatalogChanges) {
    testCatalog
      .command(`${change} <code>`)
      .description(description)
      .option('--json', 'emit JSON', false)
      .action(async (code: string, opts: { json: boolean }) => {
        process.exitCode = await runTestCatalogChange(change, code, opts);
      });
  }

```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/cli && npx vitest run src/test-catalog.test.ts src/test-catalog-change.test.ts src/test-catalog-cli-parsing.test.ts --testTimeout 30000`

Expected: PASS, all three files. S1's `test-catalog.test.ts` is in the run because its `@openldr/bootstrap` mock does not list the new imports; it must still pass.

- [ ] **Step 5: Typecheck the CLI**

Run: `cd packages/cli && npx tsc --noEmit -p . > "$TEMP/s2-t3-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/test-catalog.ts packages/cli/src/test-catalog-change.test.ts packages/cli/src/test-catalog-cli-parsing.test.ts packages/cli/src/program.ts
git commit -m "feat(cli): switch catalog tests on or off, and retire or restore them" -m "openldr test-catalog enable, disable, retire and restore call the same service methods as the page's row menu and record the same audit actions, as the CLI actor. Retire is reversible, so none takes --force. A refusal prints the service's own words."
```

---

### Task 4: the studio's test catalog client

**Files:**
- Modify: `apps/studio/src/api.ts` (a new section directly above the `// ── Marketplace (SP-4)` comment)
- Create: `apps/studio/src/api.testCatalog.test.ts`

**Interfaces:**
- Consumes: the routes from S1 and Task 2. `authFetch`, `apiGet`, `jbody` and `okJson`, already defined earlier in `api.ts`.
- Produces: types `CatalogSpecimenCoding`, `CatalogTest`, `TestCatalogListResult`, `TestCatalogListParams`, `CatalogTestInput`, `CatalogLabSettingsInput`, `TestCatalogOptions`; functions `listTestCatalog(p?)`, `getTestCatalogOptions()`, `createCatalogTest(input)`, `updateCatalogTest(code, input)`, `setCatalogLabSettings(code, input)`, `setCatalogTestEnabled(code, enabled)`, `setCatalogTestActive(code, active)`. The types mirror `@openldr/bootstrap`'s; the studio does not import server packages.

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/api.testCatalog.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTestCatalogOptions, listTestCatalog, setCatalogTestActive, setCatalogTestEnabled, updateCatalogTest,
} from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('test catalog api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ rows: [], total: 0, ownedHere: true })));
  });

  it('sends only the filters that are set', async () => {
    await listTestCatalog({ q: 'viral', category: 'MOL', loinc: undefined, enabled: 'on', limit: 25, offset: 50 });
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog?q=viral&category=MOL&enabled=on&limit=25&offset=50');
  });

  it('asks for the plain list when no filter is set', async () => {
    await listTestCatalog();
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog');
  });

  it('reads the picker choices', async () => {
    await getTestCatalogOptions();
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/options');
  });

  it('encodes the code and sends one boolean for a row change', async () => {
    await setCatalogTestEnabled('HIV VL', true);
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/HIV%20VL/enabled', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    await setCatalogTestActive('HIVVL', false);
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/HIVVL/active', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: false }),
    });
  });

  it('carries the server refusal words into the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Test HIVVL is not in the catalog.', kind: 'not-found' }, 404)));
    await expect(updateCatalogTest('HIVVL', { display: 'x' })).rejects.toThrow('save test failed: Test HIVVL is not in the catalog.');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/studio && npx vitest run src/api.testCatalog.test.ts --testTimeout 30000`

Expected: FAIL. `listTestCatalog` and the rest are not exported.

- [ ] **Step 3: Write the client**

In `apps/studio/src/api.ts`, directly above the line `// ── Marketplace (SP-4) ─────`, add:

```ts
// ── Test catalog (test catalog S1 and S2) ──────────────────────────────────────
// These types mirror @openldr/bootstrap's test-catalog.ts. The routes are apps/server/src/test-catalog-routes.ts.
export interface CatalogSpecimenCoding { system: string; code: string }
export interface CatalogTest {
  code: string;
  display: string;
  shortName: string | null;
  category: string | null;
  specimenTypes: CatalogSpecimenCoding[];
  loinc: string | null;
  /** false when the test is retired. */
  active: boolean;
  /** This install's own settings. specimenTypes null means "use the catalog's list". */
  lab: { enabled: boolean; specimenTypes: CatalogSpecimenCoding[] | null; localDisplay: string | null };
}
export interface TestCatalogListResult { rows: CatalogTest[]; total: number; ownedHere: boolean }
export interface TestCatalogListParams {
  q?: string;
  category?: string;
  loinc?: 'linked' | 'none';
  enabled?: 'on' | 'off';
  status?: 'active' | 'retired' | 'all';
  limit?: number;
  offset?: number;
}
export interface CatalogTestInput {
  code?: string | null;
  display: string;
  shortName?: string | null;
  category?: string | null;
  specimenTypes?: CatalogSpecimenCoding[];
  loinc?: string | null;
  active?: boolean;
}
export interface CatalogLabSettingsInput {
  enabled: boolean;
  specimenTypes: CatalogSpecimenCoding[] | null;
  localDisplay: string | null;
}
export interface TestCatalogOptions {
  categories: { code: string; display: string | null }[];
  specimenTypes: { system: string; code: string; display: string | null }[];
  /** The loaded LOINC code system, or null when LOINC is not loaded here. */
  loinc: { systemId: string; system: string } | null;
}

export function listTestCatalog(p: TestCatalogListParams = {}): Promise<TestCatalogListResult> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return apiGet<TestCatalogListResult>(`/api/test-catalog${s ? `?${s}` : ''}`, 'list tests');
}
export const getTestCatalogOptions = (): Promise<TestCatalogOptions> =>
  apiGet<TestCatalogOptions>('/api/test-catalog/options', 'load test catalog choices');
const catalogTestPath = (code: string, rest = ''): string => `/api/test-catalog/${encodeURIComponent(code)}${rest}`;
export const createCatalogTest = (i: CatalogTestInput): Promise<CatalogTest> =>
  authFetch('/api/test-catalog', jbody(i, 'POST')).then((r) => okJson<CatalogTest>(r, 'add test'));
export const updateCatalogTest = (code: string, i: CatalogTestInput): Promise<CatalogTest> =>
  authFetch(catalogTestPath(code), jbody(i, 'PUT')).then((r) => okJson<CatalogTest>(r, 'save test'));
export const setCatalogLabSettings = (code: string, i: CatalogLabSettingsInput): Promise<CatalogTest> =>
  authFetch(catalogTestPath(code, '/lab'), jbody(i, 'PUT')).then((r) => okJson<CatalogTest>(r, 'save lab settings'));
export const setCatalogTestEnabled = (code: string, enabled: boolean): Promise<CatalogTest> =>
  authFetch(catalogTestPath(code, '/enabled'), jbody({ enabled }, 'PUT')).then((r) => okJson<CatalogTest>(r, 'switch test'));
export const setCatalogTestActive = (code: string, active: boolean): Promise<CatalogTest> =>
  authFetch(catalogTestPath(code, '/active'), jbody({ active }, 'PUT'))
    .then((r) => okJson<CatalogTest>(r, active ? 'restore test' : 'retire test'));

```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd apps/studio && npx vitest run src/api.testCatalog.test.ts --testTimeout 30000`

Expected: PASS, five tests.

- [ ] **Step 5: Typecheck the studio**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/s2-t4-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.testCatalog.test.ts
git commit -m "chore(studio): add the test catalog API client"
```

---

### Task 5: the page, its table and its row actions

**Files:**
- Create: `apps/studio/src/test-catalog/catalogFilters.ts`
- Create: `apps/studio/src/test-catalog/catalogFilters.test.ts`
- Create: `apps/studio/src/pages/TestCatalog.tsx`
- Create: `apps/studio/src/pages/TestCatalog.test.tsx`
- Modify: `apps/studio/src/App.tsx` (import, and a route after `/facilities`)
- Modify: `apps/studio/src/shell/AppShell.tsx` (the `lucide-react` import, and a `NAV` entry after `/facilities`)
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (`nav.testCatalog`, and a `testCatalog` namespace directly above `  nav: {`)

**Interfaces:**
- Consumes: Task 4's client. `DataTableToolbar`, `ActiveFilterChips`, `useTableState`, `ColumnDef`, `FilterRule` from `@/components/data-table`.
- Produces: `translateFilters(filters: FilterRule[]): CatalogFilterParams`; page component `TestCatalog`; route `/test-catalog` gated on `terminology.view`. Task 6 adds the sheet, the header "Add test" item and the row "Edit" item to this page.

This task copies three siblings (AGENTS.md section 5): `pages/settings/Connectors.tsx` for the toolbar's `actions` slot, the row `⋯` menu and gating the table on rows; `pages/Notifications.tsx` for server paging through `translateFilters`; and the `min-h-[16rem]` empty and loading states. Test helpers copy `pages/settings/Connectors.test.tsx` (opening a Radix menu in jsdom) and `pages/settings/DistributedSync.test.tsx` (an enum-first filter popover).

- [ ] **Step 1: Write the failing filter test**

Create `apps/studio/src/test-catalog/catalogFilters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FilterRule } from '@/components/data-table';
import { translateFilters } from './catalogFilters';

const rule = (column: string, value: unknown, operator = 'eq'): FilterRule =>
  ({ id: `${column}-${String(value)}`, column, operator, value, combine: 'and' }) as FilterRule;

describe('translateFilters', () => {
  it('maps each filter column to its named API parameter', () => {
    expect(translateFilters([rule('category', 'MOL'), rule('loinc', 'none'), rule('enabled', 'on'), rule('status', 'retired')]))
      .toEqual({ category: 'MOL', loinc: 'none', enabled: 'on', status: 'retired' });
  });

  it('drops what the API cannot express', () => {
    expect(translateFilters([rule('category', 'MOL', 'ne'), rule('loinc', 'maybe'), rule('code', 'X'), rule('enabled', '')]))
      .toEqual({});
  });

  it('lets a later rule on the same column win', () => {
    expect(translateFilters([rule('enabled', 'on'), rule('enabled', 'off')])).toEqual({ enabled: 'off' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/studio && npx vitest run src/test-catalog/catalogFilters.test.ts --testTimeout 30000`

Expected: FAIL. `./catalogFilters` does not exist.

- [ ] **Step 3: Write the filter helper**

Create `apps/studio/src/test-catalog/catalogFilters.ts`:

```ts
import type { FilterRule } from '@/components/data-table';
import type { TestCatalogListParams } from '@/api';

export type CatalogFilterParams = Pick<TestCatalogListParams, 'category' | 'loinc' | 'enabled' | 'status'>;

/**
 * Turn the toolbar's filter rules into GET /api/test-catalog's named parameters, as Notifications.tsx
 * does for its API. Each filterable column offers only `eq`. A rule the API cannot express is dropped,
 * and a later rule on the same column wins.
 */
export function translateFilters(filters: FilterRule[]): CatalogFilterParams {
  const params: CatalogFilterParams = {};
  for (const f of filters) {
    if (f.operator !== 'eq' || typeof f.value !== 'string' || !f.value) continue;
    if (f.column === 'category') params.category = f.value;
    else if (f.column === 'loinc' && (f.value === 'linked' || f.value === 'none')) params.loinc = f.value;
    else if (f.column === 'enabled' && (f.value === 'on' || f.value === 'off')) params.enabled = f.value;
    else if (f.column === 'status' && (f.value === 'active' || f.value === 'retired')) params.status = f.value;
  }
  return params;
}
```

Run: `cd apps/studio && npx vitest run src/test-catalog/catalogFilters.test.ts --testTimeout 30000`

Expected: PASS, three tests.

- [ ] **Step 4: Add the page's strings**

In `apps/studio/src/i18n/en.ts`, after the `nav` line `    facilities: 'Facilities',` add `    testCatalog: 'Test catalog',`, and directly above `  nav: {` add:

```ts
  testCatalog: {
    title: 'Test catalog',
    searchPlaceholder: 'Search code or name',
    menuLabel: 'Test catalog actions',
    rowActions: 'Actions',
    actionsFor: 'Actions for {{code}}',
    fromCentral: 'This catalog comes from central. You can switch tests on or off at this lab, narrow their specimens and set a local name.',
    empty: 'No tests in the catalog yet.',
    noMatch: 'No tests match.',
    count_one: '{{count}} test',
    count_other: '{{count}} tests',
    none: 'None',
    thisLab: 'This lab: {{value}}',
    noLoinc: 'No LOINC',
    loincLinked: 'Has LOINC',
    on: 'On',
    off: 'Off',
    active: 'Active',
    retired: 'Retired',
    switchOn: 'Switch on at this lab',
    switchOff: 'Switch off at this lab',
    retire: 'Retire',
    restore: 'Restore',
    switchedOn: '{{code}} is on at this lab.',
    switchedOff: '{{code}} is off at this lab.',
    retiredToast: '{{code}} is retired.',
    restoredToast: '{{code}} is active again.',
    col: {
      code: 'Code',
      name: 'Name',
      category: 'Category',
      specimens: 'Specimen types',
      loinc: 'LOINC',
      enabled: 'On at this lab',
      status: 'Status',
    },
  },
```

In `apps/studio/src/i18n/fr.ts`, after `    facilities: 'Établissements',` add `    testCatalog: 'Catalogue des examens',`, and directly above `  nav: {` add:

```ts
  testCatalog: {
    title: 'Catalogue des examens',
    searchPlaceholder: 'Rechercher un code ou un nom',
    menuLabel: 'Actions du catalogue des examens',
    rowActions: 'Actions',
    actionsFor: 'Actions pour {{code}}',
    fromCentral: 'Ce catalogue vient du site central. Vous pouvez activer ou désactiver les examens dans ce laboratoire, restreindre leurs prélèvements et définir un nom local.',
    empty: 'Le catalogue ne contient encore aucun examen.',
    noMatch: 'Aucun examen ne correspond.',
    count_one: '{{count}} examen',
    count_other: '{{count}} examens',
    none: 'Aucun',
    thisLab: 'Ce laboratoire : {{value}}',
    noLoinc: 'Sans LOINC',
    loincLinked: 'Avec LOINC',
    on: 'Activé',
    off: 'Désactivé',
    active: 'Actif',
    retired: 'Retiré',
    switchOn: 'Activer dans ce laboratoire',
    switchOff: 'Désactiver dans ce laboratoire',
    retire: 'Retirer',
    restore: 'Rétablir',
    switchedOn: '{{code}} est activé dans ce laboratoire.',
    switchedOff: '{{code}} est désactivé dans ce laboratoire.',
    retiredToast: '{{code}} est retiré.',
    restoredToast: '{{code}} est de nouveau actif.',
    col: {
      code: 'Code',
      name: 'Nom',
      category: 'Catégorie',
      specimens: 'Types de prélèvement',
      loinc: 'LOINC',
      enabled: 'Activé ici',
      status: 'Statut',
    },
  },
```

In `apps/studio/src/i18n/pt.ts`, after `    facilities: 'Unidades',` add `    testCatalog: 'Catálogo de exames',`, and directly above `  nav: {` add:

```ts
  testCatalog: {
    title: 'Catálogo de exames',
    searchPlaceholder: 'Pesquisar código ou nome',
    menuLabel: 'Ações do catálogo de exames',
    rowActions: 'Ações',
    actionsFor: 'Ações para {{code}}',
    fromCentral: 'Este catálogo vem do nível central. Pode ativar ou desativar exames neste laboratório, restringir as suas amostras e definir um nome local.',
    empty: 'O catálogo ainda não tem exames.',
    noMatch: 'Nenhum exame corresponde.',
    count_one: '{{count}} exame',
    count_other: '{{count}} exames',
    none: 'Nenhum',
    thisLab: 'Este laboratório: {{value}}',
    noLoinc: 'Sem LOINC',
    loincLinked: 'Com LOINC',
    on: 'Ativado',
    off: 'Desativado',
    active: 'Ativo',
    retired: 'Retirado',
    switchOn: 'Ativar neste laboratório',
    switchOff: 'Desativar neste laboratório',
    retire: 'Retirar',
    restore: 'Repor',
    switchedOn: '{{code}} está ativado neste laboratório.',
    switchedOff: '{{code}} está desativado neste laboratório.',
    retiredToast: '{{code}} foi retirado.',
    restoredToast: '{{code}} está novamente ativo.',
    col: {
      code: 'Código',
      name: 'Nome',
      category: 'Categoria',
      specimens: 'Tipos de amostra',
      loinc: 'LOINC',
      enabled: 'Ativado aqui',
      status: 'Estado',
    },
  },
```

Run: `cd apps/studio && npx vitest run src/i18n/parity.test.ts --testTimeout 30000`

Expected: PASS. A failure names the key one locale lacks.

- [ ] **Step 5: Write the failing page tests**

Create `apps/studio/src/pages/TestCatalog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const caps = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] },
    loading: false,
    hasCapability: (c: string) => caps.set.has(c),
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    listTestCatalog: vi.fn(),
    getTestCatalogOptions: vi.fn(),
    setCatalogTestEnabled: vi.fn(),
    setCatalogTestActive: vi.fn(),
    // AppShell's notification bell and plugin menu call these on mount (see Notifications.test.tsx).
    listNotifications: vi.fn(async () => ({ notifications: [], unreadCount: 0, total: 0 })),
    listPluginUis: vi.fn(async () => []),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';
import { TestCatalog } from './TestCatalog';

const LOCAL = 'urn:openldr:cs:local';
const OPTIONS: api.TestCatalogOptions = {
  categories: [{ code: 'CHEM', display: 'Chemistry' }, { code: 'MOL', display: 'Molecular' }],
  specimenTypes: [{ system: LOCAL, code: 'BLD', display: 'Blood' }, { system: LOCAL, code: 'UR', display: 'Urine' }],
  loinc: null,
};
const HIVVL: api.CatalogTest = {
  code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
  specimenTypes: [{ system: LOCAL, code: 'BLD' }, { system: LOCAL, code: 'UR' }], loinc: '25836-8', active: true,
  lab: { enabled: true, specimenTypes: [{ system: LOCAL, code: 'UR' }], localDisplay: 'Viral load' },
};
const CD4: api.CatalogTest = {
  code: 'CD4', display: 'CD4 count', shortName: null, category: null, specimenTypes: [], loinc: null, active: true,
  lab: { enabled: false, specimenTypes: null, localDisplay: null },
};

function renderPage() {
  return render(<MemoryRouter><TestCatalog /></MemoryRouter>);
}

// Radix menus open on pointerDown in jsdom, with Enter as the fallback (as in Connectors.test.tsx).
function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

// The first filterable column, Category, is an enum, so the popover shows a Select rather than the
// text box the shared addFilterViaPopover helper types into (as in DistributedSync.test.tsx).
async function addEnumFilterViaPopover(optionName: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /^filter$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /add filter/i }));
  fireEvent.keyDown(await screen.findByLabelText(/pick value/i), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
  fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  caps.set = new Set(['terminology.view', 'terminology.manage']);
  vi.mocked(api.getTestCatalogOptions).mockResolvedValue(OPTIONS);
  vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [HIVVL, CD4], total: 2, ownedHere: true });
});

describe('Test catalog page', () => {
  it('lists each test with its category, specimens, LOINC and switch, and this lab narrower choices', async () => {
    renderPage();
    const row = await screen.findByTestId('test-row-HIVVL');
    expect(within(row).getByText('HIV viral load')).toBeInTheDocument();
    expect(within(row).getByText('This lab: Viral load')).toBeInTheDocument();
    expect(within(row).getByText('Molecular')).toBeInTheDocument();
    expect(within(row).getByText('Blood, Urine')).toBeInTheDocument();
    expect(within(row).getByText('This lab: Urine')).toBeInTheDocument();
    expect(within(row).getByText('25836-8')).toBeInTheDocument();
    expect(within(row).getByText('On')).toBeInTheDocument();
    const cd4 = screen.getByTestId('test-row-CD4');
    expect(within(cd4).getByText('No LOINC')).toBeInTheDocument();
    expect(within(cd4).getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('2 tests')).toBeInTheDocument();
    expect(api.listTestCatalog).toHaveBeenCalledWith({ q: undefined, limit: 25, offset: 0 });
  });

  it('filters by category through the standard toolbar', async () => {
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    await addEnumFilterViaPopover(/molecular/i);
    await waitFor(() => expect(api.listTestCatalog).toHaveBeenLastCalledWith({ q: undefined, category: 'MOL', limit: 25, offset: 0 }));
    expectStandardTableToolbar();
  });

  it('searches on the server after a pause in typing', async () => {
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    fireEvent.change(screen.getByPlaceholderText('Search code or name'), { target: { value: ' viral ' } });
    await waitFor(() => expect(api.listTestCatalog).toHaveBeenLastCalledWith({ q: 'viral', limit: 25, offset: 0 }));
  });

  it('shows the striped empty state, and no table header, when there are no tests', async () => {
    vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [], total: 0, ownedHere: true });
    renderPage();
    expect(await screen.findByText('No tests in the catalog yet.')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader')).toBeNull();
  });

  it('pages through the server', async () => {
    vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [HIVVL], total: 30, ownedHere: true });
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(api.listTestCatalog).toHaveBeenLastCalledWith({ q: undefined, limit: 25, offset: 25 }));
  });

  it('switches a test on from the row menu, then reloads', async () => {
    vi.mocked(api.setCatalogTestEnabled).mockResolvedValue({ ...CD4, lab: { ...CD4.lab, enabled: true } });
    renderPage();
    await screen.findByTestId('test-row-CD4');
    openMenu('test-actions-CD4');
    fireEvent.click(await screen.findByTestId('test-switch-CD4'));
    await waitFor(() => expect(api.setCatalogTestEnabled).toHaveBeenCalledWith('CD4', true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('CD4 is on at this lab.'));
    await waitFor(() => expect(api.listTestCatalog).toHaveBeenCalledTimes(2));
  });

  it('retires a test from the row menu', async () => {
    vi.mocked(api.setCatalogTestActive).mockResolvedValue({ ...HIVVL, active: false });
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-actions-HIVVL');
    fireEvent.click(await screen.findByTestId('test-retire-HIVVL'));
    await waitFor(() => expect(api.setCatalogTestActive).toHaveBeenCalledWith('HIVVL', false));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('HIVVL is retired.'));
  });

  it('shows a refusal from a row action', async () => {
    vi.mocked(api.setCatalogTestActive).mockRejectedValue(new Error('retire test failed: central only'));
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-actions-HIVVL');
    fireEvent.click(await screen.findByTestId('test-retire-HIVVL'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('retire test failed: central only'));
  });

  it('says the catalog came from central, and offers no retire there', async () => {
    vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [HIVVL], total: 1, ownedHere: false });
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    expect(screen.getByText(/This catalog comes from central/)).toBeInTheDocument();
    openMenu('test-actions-HIVVL');
    expect(await screen.findByTestId('test-switch-HIVVL')).toBeInTheDocument();
    expect(screen.queryByTestId('test-retire-HIVVL')).toBeNull();
  });

  it('gives a viewer the table without any menu', async () => {
    caps.set = new Set(['terminology.view']);
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    expect(screen.queryByTestId('test-actions-HIVVL')).toBeNull();
    expect(screen.queryByTestId('test-catalog-menu-trigger')).toBeNull();
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/pages/TestCatalog.test.tsx --testTimeout 30000`

Expected: FAIL. `./TestCatalog` does not exist.

- [ ] **Step 7: Write the page**

Create `apps/studio/src/pages/TestCatalog.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ActiveFilterChips, DataTableToolbar, useTableState, type ColumnDef } from '@/components/data-table';
import { useAuth } from '@/auth/AuthProvider';
import {
  getTestCatalogOptions, listTestCatalog, setCatalogTestActive, setCatalogTestEnabled,
  type CatalogTest, type TestCatalogOptions,
} from '@/api';
import { translateFilters } from '@/test-catalog/catalogFilters';

// Test catalog S2 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.3). Server-paged with
// named filters, as Notifications.tsx is. The toolbar menu, row menu and empty state copy
// Connectors.tsx (AGENTS.md section 5). Facilities.tsx is not copied: it keeps its own pager and
// EmptyState.

const SEARCH_DEBOUNCE_MS = 250;
const NO_OPTIONS: TestCatalogOptions = { categories: [], specimenTypes: [], loinc: null };

function codingKey(c: { system: string; code: string }): string {
  return `${c.system}|${c.code}`;
}

export function TestCatalog() {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  const canManage = hasCapability('terminology.manage');

  const [options, setOptions] = useState<TestCatalogOptions>(NO_OPTIONS);
  const [rows, setRows] = useState<CatalogTest[]>([]);
  const [total, setTotal] = useState(0);
  const [ownedHere, setOwnedHere] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    getTestCatalogOptions()
      .then(setOptions)
      .catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); });
  }, []);

  const categoryLabel = useMemo(
    () => new Map(options.categories.map((c) => [c.code, c.display ?? c.code])),
    [options],
  );
  const specimenLabel = useMemo(
    () => new Map(options.specimenTypes.map((s) => [codingKey(s), s.display ?? s.code])),
    [options],
  );
  const specimenNames = useCallback(
    (list: { system: string; code: string }[]) => list.map((s) => specimenLabel.get(codingKey(s)) ?? s.code).join(', '),
    [specimenLabel],
  );

  // Every column is sortable: false, because the API orders by code and takes no sort. The four
  // filterable columns offer only `eq`, which translateFilters turns into named parameters.
  const columns = useMemo<ColumnDef<CatalogTest>[]>(() => [
    {
      id: 'code', labelKey: 'testCatalog.col.code', type: 'text', defaultVisible: true, filterable: false, sortable: false,
      cellClassName: 'font-mono text-xs', accessor: (r) => r.code,
    },
    {
      id: 'name', labelKey: 'testCatalog.col.name', type: 'text', defaultVisible: true, filterable: false, sortable: false,
      accessor: (r) => (
        <div className="flex flex-col">
          <span className="flex items-center gap-2">
            {r.display}
            {!r.active && <Badge variant="outline">{t('testCatalog.retired')}</Badge>}
          </span>
          {r.lab.localDisplay && (
            <span className="text-xs text-muted-foreground">{t('testCatalog.thisLab', { value: r.lab.localDisplay })}</span>
          )}
        </div>
      ),
    },
    {
      id: 'category', labelKey: 'testCatalog.col.category', type: 'enum', defaultVisible: true, sortable: false,
      operators: ['eq'],
      enumOptions: options.categories.map((c) => ({ value: c.code, label: c.display ?? c.code })),
      accessor: (r) => (r.category ? categoryLabel.get(r.category) ?? r.category : t('testCatalog.none')),
    },
    {
      id: 'specimens', labelKey: 'testCatalog.col.specimens', type: 'text', defaultVisible: true, filterable: false,
      sortable: false,
      accessor: (r) => (
        <div className="flex flex-col">
          <span>{r.specimenTypes.length ? specimenNames(r.specimenTypes) : t('testCatalog.none')}</span>
          {r.lab.specimenTypes && (
            <span className="text-xs text-muted-foreground">{t('testCatalog.thisLab', { value: specimenNames(r.lab.specimenTypes) })}</span>
          )}
        </div>
      ),
    },
    {
      id: 'loinc', labelKey: 'testCatalog.col.loinc', type: 'enum', defaultVisible: true, sortable: false, operators: ['eq'],
      enumOptions: [
        { value: 'linked', labelKey: 'testCatalog.loincLinked' },
        { value: 'none', labelKey: 'testCatalog.noLoinc' },
      ],
      accessor: (r) => (r.loinc
        ? <span className="font-mono text-xs">{r.loinc}</span>
        : <Badge variant="outline">{t('testCatalog.noLoinc')}</Badge>),
    },
    {
      id: 'enabled', labelKey: 'testCatalog.col.enabled', type: 'enum', defaultVisible: true, sortable: false,
      operators: ['eq'],
      enumOptions: [{ value: 'on', labelKey: 'testCatalog.on' }, { value: 'off', labelKey: 'testCatalog.off' }],
      accessor: (r) => (r.lab.enabled ? t('testCatalog.on') : t('testCatalog.off')),
    },
    {
      id: 'status', labelKey: 'testCatalog.col.status', type: 'enum', defaultVisible: false, sortable: false,
      operators: ['eq'],
      enumOptions: [{ value: 'active', labelKey: 'testCatalog.active' }, { value: 'retired', labelKey: 'testCatalog.retired' }],
      accessor: (r) => (r.active ? t('testCatalog.active') : t('testCatalog.retired')),
    },
  ], [t, options, categoryLabel, specimenNames]);

  const table = useTableState({ columns, defaultPageSize: 25 });
  const { setPage } = table;

  // The search waits for a pause in typing before it asks the server, and goes back to page one.
  // An unchanged search sets no timer, so it never resets a page the operator just moved to.
  useEffect(() => {
    const next = search.trim();
    if (next === q) return undefined;
    const timer = setTimeout(() => { setQ(next); setPage(0); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q, setPage]);

  const filters = useMemo(() => translateFilters(table.filters), [table.filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listTestCatalog({
        q: q || undefined, ...filters, limit: table.pageSize, offset: table.page * table.pageSize,
      });
      setRows(result.rows);
      setTotal(result.total);
      setOwnedHere(result.ownedHere);
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, filters, table.page, table.pageSize]);

  useEffect(() => { void load(); }, [load]);

  const runRowAction = useCallback(async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  const hasFilters = q !== '' || table.filters.length > 0;

  return (
    <AppShell title={t('testCatalog.title')} fullBleed>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="test-catalog-page">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:gap-2 sm:py-2">
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
            onSearchChange={setSearch}
            searchPlaceholder={t('testCatalog.searchPlaceholder')}
          />
          <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
          {!ownedHere && <div className="text-xs text-muted-foreground">{t('testCatalog.fromCentral')}</div>}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
          {!loading && error && (
            <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
          )}
          {!loading && !error && rows.length === 0 && (
            <StripedEmpty className="min-h-[16rem] flex-1">
              {hasFilters ? t('testCatalog.noMatch') : t('testCatalog.empty')}
            </StripedEmpty>
          )}
          {/* Rendered only when populated: an empty table's header cells force intrinsic width and
              scroll the pane sideways on a phone (AGENTS.md section 6). The table's own wrapper
              scrolls sideways when the columns do not fit. */}
          {!loading && !error && rows.length > 0 && (
            <Table wrapperClassName="min-h-0 flex-1">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
                  {canManage && (
                    <TableHead className="w-12"><span className="sr-only">{t('testCatalog.rowActions')}</span></TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b">
                {rows.map((r) => (
                  <TableRow key={r.code} data-testid={`test-row-${r.code}`}>
                    {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(r)}</TableCell>)}
                    {canManage && (
                      <TableCell>
                        <div className="flex items-center justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                                data-testid={`test-actions-${r.code}`}
                                aria-label={t('testCatalog.actionsFor', { code: r.code })}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                data-testid={`test-switch-${r.code}`}
                                onSelect={() => void runRowAction(
                                  () => setCatalogTestEnabled(r.code, !r.lab.enabled),
                                  t(r.lab.enabled ? 'testCatalog.switchedOff' : 'testCatalog.switchedOn', { code: r.code }),
                                )}
                              >
                                {r.lab.enabled ? t('testCatalog.switchOff') : t('testCatalog.switchOn')}
                              </DropdownMenuItem>
                              {ownedHere && (
                                <DropdownMenuItem
                                  data-testid={`test-retire-${r.code}`}
                                  onSelect={() => void runRowAction(
                                    () => setCatalogTestActive(r.code, !r.active),
                                    t(r.active ? 'testCatalog.retiredToast' : 'testCatalog.restoredToast', { code: r.code }),
                                  )}
                                >
                                  {r.active ? t('testCatalog.retire') : t('testCatalog.restore')}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          leftSlot={<span className="text-muted-foreground">{t('testCatalog.count', { count: total })}</span>}
        />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 8: Add the route and the sidebar item**

In `apps/studio/src/App.tsx`, after `import { Facilities } from './pages/Facilities';` add:

```tsx
import { TestCatalog } from './pages/TestCatalog';
```

and after the `/facilities` route add:

```tsx
      <Route path="/test-catalog" element={<RequireCapability cap="terminology.view"><TestCatalog /></RequireCapability>} />
```

In `apps/studio/src/shell/AppShell.tsx`, add `FlaskConical` to the `lucide-react` import list (after `Building2,`), and after the `NAV` entry for `/facilities` add:

```ts
  { to: '/test-catalog', labelKey: 'nav.testCatalog', end: false, icon: FlaskConical, caps: ['terminology.view'] },
```

- [ ] **Step 9: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/pages/TestCatalog.test.tsx src/test-catalog/catalogFilters.test.ts src/i18n/parity.test.ts --testTimeout 30000`

Expected: PASS, all three files.

- [ ] **Step 10: Typecheck the studio**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/s2-t5-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 11: Commit**

```bash
git add apps/studio/src/test-catalog/catalogFilters.ts apps/studio/src/test-catalog/catalogFilters.test.ts apps/studio/src/pages/TestCatalog.tsx apps/studio/src/pages/TestCatalog.test.tsx apps/studio/src/App.tsx apps/studio/src/shell/AppShell.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): add the Test catalog page" -m "A Test catalog item beside Facilities lists the national catalog, paged on the server, with its category, specimen types, LOINC code or a No LOINC badge, and whether this lab runs each test. Search, and filters for category, LOINC, the switch and status, use the shared toolbar. The row menu switches a test on or off at this lab, and retires or restores it where this install owns the catalog. Viewers see the table only."
```

---

### Task 6: the add and edit sheet

**Files:**
- Create: `apps/studio/src/test-catalog/TestSheet.tsx`
- Create: `apps/studio/src/test-catalog/TestSheet.test.tsx`
- Modify: `apps/studio/src/pages/TestCatalog.tsx` (header menu, row Edit item, the sheet)
- Modify: `apps/studio/src/pages/TestCatalog.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (`testCatalog.add`, `testCatalog.edit`, `testCatalog.sheet`)

**Interfaces:**
- Consumes: Task 4's `createCatalogTest`, `updateCatalogTest`, `setCatalogLabSettings`, `TestCatalogOptions`. `TermPicker` from `@/terminology/TermPicker` (props `value`, `onChange`, `systemId`; its search box is a combobox named "Search terms").
- Produces: `TestSheet` with props `{ target: TestSheetTarget | null; options: TestCatalogOptions; ownedHere: boolean; onClose(): void; onSaved(): void }`, and `type TestSheetTarget = { kind: 'create' } | { kind: 'edit'; test: CatalogTest }`.

The sheet copies `forms-builder/FieldEditorSheet.tsx`: Save and Cancel in a `⋯` on the first section's title row, clear of the sheet's close button (memory `ui-sheets-not-dialogs`), and a `grid-cols-[auto_minmax(0,1fr)]` form with labels left. The specimen lists copy `components/data-table/ColumnPickerPopover.tsx:61-71` (a `label` row holding a `Checkbox`). They are inline, not portalled, because portalled popover content inside a sheet cannot scroll (AGENTS.md section 6). No `<p>` or `<h3>`: the studio has no Tailwind reset, so those keep their browser margins (memory `studio-no-tailwind-preflight`).

- [ ] **Step 1: Write the failing sheet tests**

Create `apps/studio/src/test-catalog/TestSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, createCatalogTest: vi.fn(), updateCatalogTest: vi.fn(), setCatalogLabSettings: vi.fn() };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { TestSheet, type TestSheetTarget } from './TestSheet';

const LOCAL = 'urn:openldr:cs:local';
const BLD = { system: LOCAL, code: 'BLD' };
const UR = { system: LOCAL, code: 'UR' };
const OPTIONS: api.TestCatalogOptions = {
  categories: [{ code: 'CHEM', display: 'Chemistry' }, { code: 'MOL', display: 'Molecular' }],
  specimenTypes: [{ ...BLD, display: 'Blood' }, { ...UR, display: 'Urine' }],
  loinc: null,
};
const HIVVL: api.CatalogTest = {
  code: 'HIVVL', display: 'HIV viral load', shortName: null, category: 'MOL', specimenTypes: [BLD, UR],
  loinc: '25836-8', active: true, lab: { enabled: false, specimenTypes: null, localDisplay: null },
};

function renderSheet(props: { target?: TestSheetTarget; options?: api.TestCatalogOptions; ownedHere?: boolean } = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <TestSheet
      target={props.target ?? { kind: 'create' }}
      options={props.options ?? OPTIONS}
      ownedHere={props.ownedHere ?? true}
      onSaved={onSaved}
      onClose={onClose}
    />,
  );
  return { onSaved, onClose };
}

// The sheet's Save lives behind its ⋯ menu. Radix menus open on pointerDown in jsdom, with Enter as
// the fallback (as in Connectors.test.tsx).
async function save() {
  const trigger = screen.getByTestId('test-sheet-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByTestId('test-sheet-save');
  await act(async () => { fireEvent.click(item); });
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
}

// Radix Select opens from the keyboard in jsdom.
async function pickCategory(name: RegExp) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Category' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TestSheet', () => {
  it('adds a test with its catalog fields, and leaves this lab settings alone when untouched', async () => {
    vi.mocked(api.createCatalogTest).mockResolvedValue({ ...HIVVL, shortName: 'VL', specimenTypes: [BLD] });
    const { onSaved, onClose } = renderSheet();
    type('Code', 'HIVVL');
    type('Name', 'HIV viral load');
    type('Short name', 'VL');
    await pickCategory(/molecular/i);
    type('LOINC code', '25836-8');
    fireEvent.click(screen.getByTestId('specimen-BLD'));
    await save();
    expect(api.createCatalogTest).toHaveBeenCalledWith({
      code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL', specimenTypes: [BLD],
      loinc: '25836-8', active: true,
    });
    expect(api.setCatalogLabSettings).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('HIVVL saved.');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches the new test on at this lab in the same save', async () => {
    vi.mocked(api.createCatalogTest).mockResolvedValue({ ...HIVVL, specimenTypes: [], loinc: null });
    vi.mocked(api.setCatalogLabSettings)
      .mockResolvedValue({ ...HIVVL, lab: { enabled: true, specimenTypes: null, localDisplay: 'Viral load' } });
    renderSheet();
    type('Code', 'HIVVL');
    type('Name', 'HIV viral load');
    fireEvent.click(screen.getByRole('switch', { name: 'On at this lab' }));
    type('Local name', 'Viral load');
    await save();
    expect(api.createCatalogTest).toHaveBeenCalledTimes(1);
    expect(api.setCatalogLabSettings).toHaveBeenCalledWith('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
  });

  it('stays open as an edit when the lab step fails, so saving again does not add the test twice', async () => {
    vi.mocked(api.createCatalogTest).mockResolvedValue({ ...HIVVL, specimenTypes: [], loinc: null });
    vi.mocked(api.updateCatalogTest).mockResolvedValue({ ...HIVVL, specimenTypes: [], loinc: null });
    vi.mocked(api.setCatalogLabSettings)
      .mockRejectedValueOnce(new Error('save lab settings failed: 500'))
      .mockResolvedValueOnce({ ...HIVVL, lab: { enabled: true, specimenTypes: null, localDisplay: null } });
    const { onClose } = renderSheet();
    type('Code', 'HIVVL');
    type('Name', 'HIV viral load');
    fireEvent.click(screen.getByRole('switch', { name: 'On at this lab' }));
    await save();
    expect(toast.error).toHaveBeenCalledWith('save lab settings failed: 500');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Edit test' })).toBeInTheDocument();
    await save();
    expect(api.createCatalogTest).toHaveBeenCalledTimes(1);
    expect(api.updateCatalogTest).toHaveBeenCalledWith('HIVVL', expect.objectContaining({ display: 'HIV viral load' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('edits a test without letting its code change', async () => {
    vi.mocked(api.updateCatalogTest).mockResolvedValue({ ...HIVVL, display: 'HIV-1 viral load' });
    renderSheet({ target: { kind: 'edit', test: HIVVL } });
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull();
    expect(screen.getByText('HIVVL')).toBeInTheDocument();
    type('Name', 'HIV-1 viral load');
    fireEvent.click(screen.getByRole('switch', { name: 'Active' }));
    await save();
    expect(api.updateCatalogTest).toHaveBeenCalledWith('HIVVL', {
      display: 'HIV-1 viral load', shortName: null, category: 'MOL', specimenTypes: [BLD, UR], loinc: '25836-8', active: false,
    });
    expect(api.setCatalogLabSettings).not.toHaveBeenCalled();
  });

  it('at a lab that receives central catalog, shows central fields as text and saves only this lab settings', async () => {
    vi.mocked(api.setCatalogLabSettings)
      .mockResolvedValue({ ...HIVVL, lab: { enabled: false, specimenTypes: [BLD], localDisplay: null } });
    renderSheet({ target: { kind: 'edit', test: HIVVL }, ownedHere: false });
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(screen.getByText('HIV viral load')).toBeInTheDocument();
    expect(screen.getByText('Blood, Urine')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lab-specimen-UR'));
    await save();
    expect(api.updateCatalogTest).not.toHaveBeenCalled();
    expect(api.setCatalogLabSettings).toHaveBeenCalledWith('HIVVL', { enabled: false, specimenTypes: [BLD], localDisplay: null });
  });

  it('types a LOINC code, and says only its format is checked, when LOINC is not loaded here', () => {
    renderSheet();
    expect(screen.getByRole('textbox', { name: 'LOINC code' })).toBeInTheDocument();
    expect(screen.getByText('LOINC is not loaded here, so only the format is checked.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Search terms' })).toBeNull();
  });

  it('searches LOINC when it is loaded here', () => {
    renderSheet({ options: { ...OPTIONS, loinc: { systemId: 'cs-url-LOINC', system: 'http://loinc.org' } } });
    expect(screen.getByRole('combobox', { name: 'Search terms' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'LOINC code' })).toBeNull();
  });

  it('shows a server refusal and stays open', async () => {
    vi.mocked(api.createCatalogTest).mockRejectedValue(new Error('add test failed: Test HIVVL is already in the catalog.'));
    const { onClose } = renderSheet();
    type('Code', 'HIVVL');
    type('Name', 'HIV viral load');
    await save();
    expect(toast.error).toHaveBeenCalledWith('add test failed: Test HIVVL is already in the catalog.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/test-catalog/TestSheet.test.tsx --testTimeout 30000`

Expected: FAIL. `./TestSheet` does not exist.

- [ ] **Step 3: Add the sheet's strings**

In each locale, inside the `testCatalog` object Task 5 added, directly after its `restoredToast` line, add the lines below.

`apps/studio/src/i18n/en.ts`:

```ts
    add: 'Add test',
    edit: 'Edit',
    sheet: {
      addTitle: 'Add test',
      editTitle: 'Edit test',
      description: "A test in the national catalog, and this lab's own settings for it.",
      actions: 'Test actions',
      catalog: 'Catalog',
      thisLab: 'This lab',
      code: 'Code',
      codeHint: 'Leave it empty to use the LOINC code. A code cannot change once saved.',
      name: 'Name',
      shortName: 'Short name',
      category: 'Category',
      noCategory: 'No category',
      loinc: 'LOINC code',
      loincTyped: 'LOINC is not loaded here, so only the format is checked.',
      specimens: 'Specimen types',
      noSpecimens: 'The catalog lists no specimens for this test.',
      active: 'Active',
      enabled: 'On at this lab',
      labSpecimens: 'Specimens this lab takes',
      localName: 'Local name',
      saved: '{{code}} saved.',
    },
```

`apps/studio/src/i18n/fr.ts`:

```ts
    add: 'Ajouter un examen',
    edit: 'Modifier',
    sheet: {
      addTitle: 'Ajouter un examen',
      editTitle: "Modifier l'examen",
      description: 'Un examen du catalogue national, et les réglages propres à ce laboratoire.',
      actions: "Actions de l'examen",
      catalog: 'Catalogue',
      thisLab: 'Ce laboratoire',
      code: 'Code',
      codeHint: "Laissez vide pour utiliser le code LOINC. Un code ne change plus après l'enregistrement.",
      name: 'Nom',
      shortName: 'Nom court',
      category: 'Catégorie',
      noCategory: 'Aucune catégorie',
      loinc: 'Code LOINC',
      loincTyped: "LOINC n'est pas chargé ici, seul le format est vérifié.",
      specimens: 'Types de prélèvement',
      noSpecimens: 'Le catalogue ne liste aucun prélèvement pour cet examen.',
      active: 'Actif',
      enabled: 'Activé dans ce laboratoire',
      labSpecimens: 'Prélèvements acceptés ici',
      localName: 'Nom local',
      saved: '{{code}} enregistré.',
    },
```

`apps/studio/src/i18n/pt.ts`:

```ts
    add: 'Adicionar exame',
    edit: 'Editar',
    sheet: {
      addTitle: 'Adicionar exame',
      editTitle: 'Editar exame',
      description: 'Um exame do catálogo nacional, e as definições próprias deste laboratório.',
      actions: 'Ações do exame',
      catalog: 'Catálogo',
      thisLab: 'Este laboratório',
      code: 'Código',
      codeHint: 'Deixe vazio para usar o código LOINC. Um código não muda depois de guardado.',
      name: 'Nome',
      shortName: 'Nome curto',
      category: 'Categoria',
      noCategory: 'Sem categoria',
      loinc: 'Código LOINC',
      loincTyped: 'O LOINC não está carregado aqui, por isso só o formato é verificado.',
      specimens: 'Tipos de amostra',
      noSpecimens: 'O catálogo não indica amostras para este exame.',
      active: 'Ativo',
      enabled: 'Ativado neste laboratório',
      labSpecimens: 'Amostras aceites aqui',
      localName: 'Nome local',
      saved: '{{code}} guardado.',
    },
```

- [ ] **Step 4: Write the sheet**

Create `apps/studio/src/test-catalog/TestSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TermPicker } from '@/terminology/TermPicker';
import {
  createCatalogTest, setCatalogLabSettings, updateCatalogTest,
  type CatalogLabSettingsInput, type CatalogSpecimenCoding, type CatalogTest, type CatalogTestInput,
  type TestCatalogOptions,
} from '@/api';

// Test catalog S2 (spec 4.3): add or edit one test, and this lab's own settings for it. Copies
// forms-builder/FieldEditorSheet.tsx (AGENTS.md section 5).

export type TestSheetTarget = { kind: 'create' } | { kind: 'edit'; test: CatalogTest };

/** Radix Select cannot hold an empty value, so "no category" is this sentinel in the picker only. */
const NO_CATEGORY = '__none__';

interface Draft {
  code: string;
  display: string;
  shortName: string;
  category: string;
  loinc: string;
  specimens: CatalogSpecimenCoding[];
  active: boolean;
  labEnabled: boolean;
  /** null means every catalog specimen. */
  labSpecimens: CatalogSpecimenCoding[] | null;
  localDisplay: string;
}

function sameCoding(a: CatalogSpecimenCoding, b: CatalogSpecimenCoding): boolean {
  return a.system === b.system && a.code === b.code;
}

function toggle(list: CatalogSpecimenCoding[], item: CatalogSpecimenCoding, on: boolean): CatalogSpecimenCoding[] {
  const without = list.filter((s) => !sameCoding(s, item));
  return on ? [...without, { system: item.system, code: item.code }] : without;
}

function draftFrom(test: CatalogTest | null): Draft {
  return {
    code: test?.code ?? '',
    display: test?.display ?? '',
    shortName: test?.shortName ?? '',
    category: test?.category ?? '',
    loinc: test?.loinc ?? '',
    specimens: test?.specimenTypes ?? [],
    active: test?.active ?? true,
    labEnabled: test?.lab.enabled ?? false,
    labSpecimens: test?.lab.specimenTypes ?? null,
    localDisplay: test?.lab.localDisplay ?? '',
  };
}

/** This lab's settings from the draft, against the test's saved catalog list. Every catalog specimen
 *  ticked is sent as null, "use the catalog's list", so a specimen central adds later reaches this lab. */
function labInput(d: Draft, offered: CatalogSpecimenCoding[]): CatalogLabSettingsInput {
  const kept = d.labSpecimens === null ? null : offered.filter((s) => d.labSpecimens!.some((k) => sameCoding(k, s)));
  return {
    enabled: d.labEnabled,
    specimenTypes: kept === null || kept.length === offered.length ? null : kept,
    localDisplay: d.localDisplay.trim() || null,
  };
}

function sameLab(a: CatalogLabSettingsInput, b: CatalogTest['lab']): boolean {
  const key = (l: CatalogSpecimenCoding[] | null) => (l === null ? null : l.map((s) => `${s.system}|${s.code}`).sort().join(','));
  return a.enabled === b.enabled && a.localDisplay === b.localDisplay && key(a.specimenTypes) === key(b.specimenTypes);
}

export function TestSheet({ target, options, ownedHere, onClose, onSaved }: {
  target: TestSheetTarget | null;
  options: TestCatalogOptions;
  ownedHere: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null));
  // The test as last saved. A create that went through sets it, so saving again edits instead of
  // adding the test twice.
  const [saved, setSaved] = useState<CatalogTest | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const test = target?.kind === 'edit' ? target.test : null;
    setDraft(draftFrom(test));
    setSaved(test);
  }, [target]);

  const isNew = saved === null;
  // The lab chooses from the catalog list being edited here, or from central's list at a lab.
  const offered = ownedHere ? draft.specimens : saved?.specimenTypes ?? [];
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const specimenName = (s: CatalogSpecimenCoding) => options.specimenTypes.find((o) => sameCoding(o, s))?.display ?? s.code;
  const labTakes = (s: CatalogSpecimenCoding) => draft.labSpecimens === null || draft.labSpecimens.some((k) => sameCoding(k, s));
  const text = (value: string | null | undefined) => <div className="text-sm">{value || t('testCatalog.none')}</div>;

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      let test = saved;
      if (ownedHere) {
        const input: CatalogTestInput = {
          display: draft.display,
          shortName: draft.shortName.trim() || null,
          category: draft.category || null,
          specimenTypes: draft.specimens,
          loinc: draft.loinc.trim() || null,
          active: draft.active,
        };
        test = test
          ? await updateCatalogTest(test.code, input)
          : await createCatalogTest({ ...input, code: draft.code.trim() || null });
        setSaved(test);
      }
      if (!test) return;
      const lab = labInput(draft, test.specimenTypes);
      if (!sameLab(lab, test.lab)) test = await setCatalogLabSettings(test.code, lab);
      toast.success(t('testCatalog.sheet.saved', { code: test.code }));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Full width on a phone: the base sheet stops at 90vw. */}
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{isNew ? t('testCatalog.sheet.addTitle') : t('testCatalog.sheet.editTitle')}</SheetTitle>
          <SheetDescription>{t('testCatalog.sheet.description')}</SheetDescription>
        </SheetHeader>

        <section>
          {/* Save and Cancel sit on the first section's title row, as in FieldEditorSheet.tsx, clear of
              the sheet's own close button. */}
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t('testCatalog.sheet.catalog')}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  data-testid="test-sheet-menu" aria-label={t('testCatalog.sheet.actions')}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="test-sheet-save"
                  disabled={busy || (ownedHere && !draft.display.trim())}
                  onSelect={() => void save()}
                >
                  {t('common.save')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="test-sheet-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            {ownedHere && isNew ? (
              <>
                <Label htmlFor="test-code" className="whitespace-nowrap">{t('testCatalog.sheet.code')}</Label>
                <div className="flex flex-col gap-1">
                  <Input id="test-code" value={draft.code} onChange={(e) => set({ code: e.target.value })} />
                  <span className="text-xs text-muted-foreground">{t('testCatalog.sheet.codeHint')}</span>
                </div>
              </>
            ) : (
              <>
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.code')}</Label>
                <div className="font-mono text-xs">{saved?.code}</div>
              </>
            )}

            {ownedHere ? (
              <>
                <Label htmlFor="test-name" className="whitespace-nowrap">{t('testCatalog.sheet.name')}</Label>
                <Input id="test-name" value={draft.display} onChange={(e) => set({ display: e.target.value })} />

                <Label htmlFor="test-short-name" className="whitespace-nowrap">{t('testCatalog.sheet.shortName')}</Label>
                <Input id="test-short-name" value={draft.shortName} onChange={(e) => set({ shortName: e.target.value })} />

                <Label htmlFor="test-category" className="whitespace-nowrap">{t('testCatalog.sheet.category')}</Label>
                <Select
                  value={draft.category || NO_CATEGORY}
                  onValueChange={(v) => set({ category: v === NO_CATEGORY ? '' : v })}
                >
                  <SelectTrigger id="test-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>{t('testCatalog.sheet.noCategory')}</SelectItem>
                    {options.categories.map((c) => <SelectItem key={c.code} value={c.code}>{c.display ?? c.code}</SelectItem>)}
                  </SelectContent>
                </Select>

                <Label htmlFor={options.loinc ? undefined : 'test-loinc'} className="whitespace-nowrap">
                  {t('testCatalog.sheet.loinc')}
                </Label>
                {options.loinc ? (
                  <TermPicker
                    systemId={options.loinc.systemId}
                    value={draft.loinc ? { system: options.loinc.system, code: draft.loinc, display: null } : null}
                    onChange={(v) => set({ loinc: v?.code ?? '' })}
                  />
                ) : (
                  <div className="flex flex-col gap-1">
                    <Input id="test-loinc" value={draft.loinc} placeholder="12345-6" onChange={(e) => set({ loinc: e.target.value })} />
                    <span className="text-xs text-muted-foreground">{t('testCatalog.sheet.loincTyped')}</span>
                  </div>
                )}

                <Label className="self-start whitespace-nowrap pt-1.5">{t('testCatalog.sheet.specimens')}</Label>
                <div className="flex max-h-48 flex-col overflow-y-auto">
                  {options.specimenTypes.map((s) => (
                    <label
                      key={`${s.system}|${s.code}`}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                    >
                      <Checkbox
                        data-testid={`specimen-${s.code}`}
                        checked={draft.specimens.some((k) => sameCoding(k, s))}
                        onCheckedChange={(c) => set({ specimens: toggle(draft.specimens, s, !!c) })}
                      />
                      <span className="flex-1 text-foreground">{s.display ?? s.code}</span>
                    </label>
                  ))}
                </div>

                {!isNew && (
                  <>
                    <Label htmlFor="test-active" className="whitespace-nowrap">{t('testCatalog.sheet.active')}</Label>
                    <Switch id="test-active" checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
                  </>
                )}
              </>
            ) : (
              <>
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.name')}</Label>
                {text(saved?.display)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.shortName')}</Label>
                {text(saved?.shortName)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.category')}</Label>
                {text(saved?.category ? options.categories.find((c) => c.code === saved.category)?.display ?? saved.category : null)}
                <Label className="whitespace-nowrap">{t('testCatalog.sheet.loinc')}</Label>
                {text(saved?.loinc)}
                <Label className="self-start whitespace-nowrap">{t('testCatalog.sheet.specimens')}</Label>
                {text((saved?.specimenTypes ?? []).map(specimenName).join(', '))}
              </>
            )}
          </div>
        </section>

        <section>
          <div className="border-t border-border" />
          <div className="px-6 py-3 text-sm font-medium text-foreground">{t('testCatalog.sheet.thisLab')}</div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="test-enabled" className="whitespace-nowrap">{t('testCatalog.sheet.enabled')}</Label>
            <Switch id="test-enabled" checked={draft.labEnabled} onCheckedChange={(v) => set({ labEnabled: v })} />

            <Label className="self-start whitespace-nowrap pt-1.5">{t('testCatalog.sheet.labSpecimens')}</Label>
            {offered.length === 0 ? (
              <div className="text-muted-foreground">{t('testCatalog.sheet.noSpecimens')}</div>
            ) : (
              <div className="flex max-h-48 flex-col overflow-y-auto">
                {offered.map((s) => (
                  <label
                    key={`${s.system}|${s.code}`}
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                  >
                    <Checkbox
                      data-testid={`lab-specimen-${s.code}`}
                      checked={labTakes(s)}
                      onCheckedChange={(c) => set({ labSpecimens: toggle(draft.labSpecimens ?? offered, s, !!c) })}
                    />
                    <span className="flex-1 text-foreground">{specimenName(s)}</span>
                  </label>
                ))}
              </div>
            )}

            <Label htmlFor="test-local-name" className="whitespace-nowrap">{t('testCatalog.sheet.localName')}</Label>
            <Input id="test-local-name" value={draft.localDisplay} onChange={(e) => set({ localDisplay: e.target.value })} />
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Run the sheet tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/test-catalog/TestSheet.test.tsx --testTimeout 30000`

Expected: PASS, eight tests.

- [ ] **Step 6: Write the failing page tests for the sheet**

In `apps/studio/src/pages/TestCatalog.test.tsx`, append inside `describe('Test catalog page', ...)`:

```tsx
  it('opens the add sheet from the header menu', async () => {
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-catalog-menu-trigger');
    fireEvent.click(await screen.findByTestId('add-test'));
    expect(await screen.findByRole('heading', { name: 'Add test' })).toBeInTheDocument();
  });

  it('opens the edit sheet for a row', async () => {
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    openMenu('test-actions-HIVVL');
    fireEvent.click(await screen.findByTestId('test-edit-HIVVL'));
    expect(await screen.findByRole('heading', { name: 'Edit test' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('HIV viral load');
  });

  it('offers no Add test when the catalog came from central', async () => {
    vi.mocked(api.listTestCatalog).mockResolvedValue({ rows: [HIVVL], total: 1, ownedHere: false });
    renderPage();
    await screen.findByTestId('test-row-HIVVL');
    expect(screen.queryByTestId('test-catalog-menu-trigger')).toBeNull();
  });
```

Run: `cd apps/studio && npx vitest run src/pages/TestCatalog.test.tsx --testTimeout 30000`

Expected: the first two new tests FAIL (no `test-catalog-menu-trigger`, no `test-edit-HIVVL`). The third passes already; it guards the wiring below.

- [ ] **Step 7: Wire the sheet into the page**

In `apps/studio/src/pages/TestCatalog.tsx`:

Below the `import { translateFilters } ...` line add:

```tsx
import { TestSheet, type TestSheetTarget } from '@/test-catalog/TestSheet';
```

Below `const [q, setQ] = useState('');` add:

```tsx
  const [sheet, setSheet] = useState<TestSheetTarget | null>(null);
```

In `<DataTableToolbar ... />`, after `searchPlaceholder={t('testCatalog.searchPlaceholder')}` add:

```tsx
            actions={canManage && ownedHere ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8"
                    data-testid="test-catalog-menu-trigger" aria-label={t('testCatalog.menuLabel')}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem data-testid="add-test" onSelect={() => setSheet({ kind: 'create' })}>
                    {t('testCatalog.add')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : undefined}
```

In the row menu, directly after `<DropdownMenuContent align="end">` and before the `test-switch-` item, add:

```tsx
                              <DropdownMenuItem data-testid={`test-edit-${r.code}`} onSelect={() => setSheet({ kind: 'edit', test: r })}>
                                {t('testCatalog.edit')}
                              </DropdownMenuItem>
```

Directly above the closing `</div>` that follows `<TablePagination ... />`, add:

```tsx
        <TestSheet
          target={sheet}
          options={options}
          ownedHere={ownedHere}
          onClose={() => setSheet(null)}
          onSaved={() => { void load(); }}
        />
```

- [ ] **Step 8: Run the studio tests for this slice**

Run: `cd apps/studio && npx vitest run src/pages/TestCatalog.test.tsx src/test-catalog src/i18n/parity.test.ts src/api.testCatalog.test.ts --testTimeout 30000`

Expected: PASS, every file.

- [ ] **Step 9: Typecheck the studio**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/s2-t6-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 10: Commit**

```bash
git add apps/studio/src/test-catalog/TestSheet.tsx apps/studio/src/test-catalog/TestSheet.test.tsx apps/studio/src/pages/TestCatalog.tsx apps/studio/src/pages/TestCatalog.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): add and edit catalog tests in a sheet" -m "Add test in the page's menu and Edit in each row open one sheet. Where this install owns the catalog it edits the code (fixed once saved), name, short name, category, LOINC code and specimen types, and retires or restores the test. At a lab that receives central's catalog those fields show as text. Everywhere, the sheet switches the test on at this lab, narrows its specimens and sets a local name. LOINC is searched when it is loaded here and typed otherwise."
```

---

### Task 7: docs

**Files:**
- Create: `apps/studio/src/docs/0.1.8/en/test-catalog.md`, `fr/test-catalog.md`, `pt/test-catalog.md`
- Modify: `apps/studio/src/docs/registry.ts` (a guide after `facilities`)
- Modify: `apps/studio/src/docs/registry.test.ts` (the order list and the relationships)
- Create: `apps/web/src/docs/0.1.8/test-catalog.md`
- Modify: `apps/web/src/docs/content.ts` (`TITLES` and `NAV`)
- Modify: `apps/web/src/docs/DocsPage.test.tsx`
- Modify: `apps/web/src/docs/0.1.8/cli.md` (the `test-catalog` row and the Test catalog section)

**Interfaces:** none.

- [ ] **Step 1: Write the failing docs tests**

In `apps/studio/src/docs/registry.test.ts`, in the test `defines the approved guides in navigation order`, add `'test-catalog',` after `'facilities',`. In the test `defines the approved related-guide relationships`, add after the `facilities:` line:

```ts
      'test-catalog': ['terminology', 'facilities'],
```

In `apps/web/src/docs/DocsPage.test.tsx`, add inside `describe('DocsPage', ...)`:

```tsx
  it('renders the test catalog guide from its navigation entry in all three languages', () => {
    renderDocs('/docs/test-catalog');

    expect(screen.getByRole('heading', { level: 1, name: 'Test catalog' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Test catalog' })).toHaveAttribute('aria-current', 'page');
    for (const name of ['English', 'Français', 'Português']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
  });
```

Run: `cd apps/studio && npx vitest run src/docs --testTimeout 30000` and `cd apps/web && npx vitest run src/docs --testTimeout 30000`

Expected: FAIL in both. The registry has no `test-catalog` guide, and the web docs have no such page.

- [ ] **Step 2: Write the in-app guide**

Create `apps/studio/src/docs/0.1.8/en/test-catalog.md`:

```markdown
# Test catalog

The test catalog is the national list of tests. Each test has a code, a name, a category, the specimen types it accepts and, when it has one, a LOINC code. A test with no LOINC code shows **No LOINC**.

Open **Test catalog** in the sidebar. You need the Terminology view permission to see it, and Terminology manage to change anything.

## Who changes what

An install that did not receive its catalog from central owns it. There you can add tests, edit them, and retire or restore them. A standalone lab is its own central.

A lab that receives the catalog from central cannot change its tests. The page says so above the table. The lab can still switch tests on or off, narrow their specimens and set a local name. Sync never sends these settings back.

## Finding tests

Search matches the code, name, short name and local name. Use **Filter** for category, LOINC, **On at this lab** and status. Retired tests are hidden unless you filter for them.

## Adding and editing a test

1. Choose **Add test** from the ⋯ menu, or **Edit** from a row's ⋯ menu.
2. Enter the code. Leave it empty to use the LOINC code. A code cannot change once saved.
3. Enter the name, and a short name if you want one.
4. Pick a category, and tick the specimen types the test accepts.
5. Enter the LOINC code. When LOINC is loaded here you search it. Otherwise you type it, and only its format is checked.
6. Under **This lab**, switch the test on, untick any specimen this lab does not take, and set a local name.
7. Choose **Save** from the ⋯ menu at the top of the sheet.

Specimen types come from CE's specimen-type list. Categories come from **Test categories** on the Terminology page.

## Row actions

The ⋯ menu on each row switches the test on or off at this lab. Where this install owns the catalog, it also retires or restores the test. Retiring is reversible, so it asks no confirmation.

From the command line: `openldr test-catalog enable`, `disable`, `retire` or `restore`, followed by the code.
```

Create `apps/studio/src/docs/0.1.8/fr/test-catalog.md`:

```markdown
# Catalogue des examens

Le catalogue des examens est la liste nationale des examens. Chaque examen a un code, un nom, une catégorie, les types de prélèvement qu'il accepte et, s'il en a un, un code LOINC. Un examen sans code LOINC affiche **Sans LOINC**.

Ouvrez **Catalogue des examens** dans la barre latérale. Il faut la permission de consulter la Terminologie pour le voir, et celle de la gérer pour modifier quoi que ce soit.

## Qui modifie quoi

Une installation qui n'a pas reçu son catalogue du site central en est propriétaire. Elle peut ajouter des examens, les modifier, les retirer et les rétablir. Un laboratoire autonome est son propre site central.

Un laboratoire qui reçoit le catalogue du site central ne peut pas modifier ses examens. La page l'indique au-dessus du tableau. Le laboratoire peut toujours activer ou désactiver des examens, restreindre leurs prélèvements et définir un nom local. La synchronisation ne renvoie jamais ces réglages.

## Trouver des examens

La recherche porte sur le code, le nom, le nom court et le nom local. Utilisez **Filtrer** pour la catégorie, LOINC, **Activé ici** et le statut. Les examens retirés sont masqués, sauf si vous filtrez sur eux.

## Ajouter et modifier un examen

1. Choisissez **Ajouter un examen** dans le menu ⋯, ou **Modifier** dans le menu ⋯ d'une ligne.
2. Saisissez le code. Laissez-le vide pour utiliser le code LOINC. Un code ne change plus après l'enregistrement.
3. Saisissez le nom, et un nom court si vous le souhaitez.
4. Choisissez une catégorie et cochez les types de prélèvement que l'examen accepte.
5. Saisissez le code LOINC. Si LOINC est chargé ici, vous le recherchez. Sinon vous le tapez, et seul son format est vérifié.
6. Sous **Ce laboratoire**, activez l'examen, décochez les prélèvements que ce laboratoire ne prend pas et définissez un nom local.
7. Choisissez **Enregistrer** dans le menu ⋯ en haut du panneau.

Les types de prélèvement viennent de la liste des types de prélèvement de CE. Les catégories viennent de **Test categories** sur la page Terminologie.

## Actions sur une ligne

Le menu ⋯ de chaque ligne active ou désactive l'examen dans ce laboratoire. Si cette installation est propriétaire du catalogue, il retire ou rétablit aussi l'examen. Le retrait est réversible, il ne demande donc pas de confirmation.

En ligne de commande : `openldr test-catalog enable`, `disable`, `retire` ou `restore`, suivi du code.
```

Create `apps/studio/src/docs/0.1.8/pt/test-catalog.md`:

```markdown
# Catálogo de exames

O catálogo de exames é a lista nacional de exames. Cada exame tem um código, um nome, uma categoria, os tipos de amostra que aceita e, quando o tem, um código LOINC. Um exame sem código LOINC mostra **Sem LOINC**.

Abra **Catálogo de exames** na barra lateral. Precisa da permissão de ver a Terminologia para o ver, e da permissão de a gerir para alterar qualquer coisa.

## Quem altera o quê

Uma instalação que não recebeu o catálogo do nível central é dona dele. Aí pode adicionar exames, editá-los, retirá-los e repô-los. Um laboratório independente é o seu próprio nível central.

Um laboratório que recebe o catálogo do nível central não pode alterar os seus exames. A página indica-o acima da tabela. O laboratório pode sempre ativar ou desativar exames, restringir as suas amostras e definir um nome local. A sincronização nunca envia essas definições de volta.

## Encontrar exames

A pesquisa abrange o código, o nome, o nome curto e o nome local. Use **Filtrar** para a categoria, o LOINC, **Ativado aqui** e o estado. Os exames retirados ficam ocultos, exceto se filtrar por eles.

## Adicionar e editar um exame

1. Escolha **Adicionar exame** no menu ⋯, ou **Editar** no menu ⋯ de uma linha.
2. Introduza o código. Deixe-o vazio para usar o código LOINC. Um código não muda depois de guardado.
3. Introduza o nome, e um nome curto se quiser.
4. Escolha uma categoria e marque os tipos de amostra que o exame aceita.
5. Introduza o código LOINC. Quando o LOINC está carregado aqui, pesquisa-o. Caso contrário escreve-o, e só o formato é verificado.
6. Em **Este laboratório**, ative o exame, desmarque as amostras que este laboratório não aceita e defina um nome local.
7. Escolha **Guardar** no menu ⋯ no topo do painel.

Os tipos de amostra vêm da lista de tipos de amostra do CE. As categorias vêm de **Test categories** na página Terminologia.

## Ações numa linha

O menu ⋯ de cada linha ativa ou desativa o exame neste laboratório. Quando esta instalação é dona do catálogo, também retira ou repõe o exame. Retirar é reversível, por isso não pede confirmação.

Na linha de comandos: `openldr test-catalog enable`, `disable`, `retire` ou `restore`, seguido do código.
```

Step 7 of each guide names the sheet's Save item exactly as `common.save` spells it: Save, Enregistrer, Guardar. The Filter button is `table.filter`: Filter, Filtrer, Filtrar.

In `apps/studio/src/docs/registry.ts`, directly after the `facilities` guide object (the one with `slug: 'facilities'`), add:

```ts
  {
    slug: 'test-catalog',
    title: 'Test catalog',
    group: 'data-design',
    summary: 'Keep the national list of tests, and choose which of them this lab runs.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: [],
    estimatedMinutes: 8,
    difficulty: 'intermediate',
    relatedSlugs: ['terminology', 'facilities'],
    screenshotNames: [],
    status: 'published',
  },
```

- [ ] **Step 3: Write the web page**

Create `apps/web/src/docs/0.1.8/test-catalog.md`:

```markdown
# Test catalog

## English

The **Test catalog** page lists the national list of tests: code, name, category, specimen types, LOINC code (or **No LOINC**) and whether this lab runs each test. You need Terminology view to open it and Terminology manage to change anything.

An install that did not receive its catalog from central owns it, and can add, edit, retire and restore tests. A lab that receives the catalog from central cannot change its tests. It can switch tests on or off, narrow their specimens and set a local name. Sync never sends those settings.

Add a test from the page's ⋯ menu, and edit one from its row's ⋯ menu. The same row menu switches a test on or off at this lab, and retires or restores it. Search matches the code, name, short name and local name. Filter by category, LOINC, on or off, and status. Retired tests are hidden unless you filter for them.

A LOINC code is searched when LOINC is loaded on this install. Otherwise it is typed, and only its format is checked. Specimen types come from CE's specimen-type list, and categories from **Test categories** on the Terminology page.

## Français

La page **Catalogue des examens** présente la liste nationale des examens : code, nom, catégorie, types de prélèvement, code LOINC (ou **Sans LOINC**) et si ce laboratoire réalise chaque examen. Il faut la permission de consulter la Terminologie pour l'ouvrir, et celle de la gérer pour modifier quoi que ce soit.

Une installation qui n'a pas reçu son catalogue du site central en est propriétaire et peut ajouter, modifier, retirer et rétablir des examens. Un laboratoire qui reçoit le catalogue du site central ne peut pas modifier ses examens. Il peut activer ou désactiver des examens, restreindre leurs prélèvements et définir un nom local. La synchronisation n'envoie jamais ces réglages.

Ajoutez un examen depuis le menu ⋯ de la page, et modifiez-en un depuis le menu ⋯ de sa ligne. Ce même menu active ou désactive un examen dans ce laboratoire, et le retire ou le rétablit. La recherche porte sur le code, le nom, le nom court et le nom local. Filtrez par catégorie, LOINC, activé ou non, et statut. Les examens retirés sont masqués, sauf si vous filtrez sur eux.

Un code LOINC est recherché quand LOINC est chargé sur cette installation. Sinon il est saisi, et seul son format est vérifié. Les types de prélèvement viennent de la liste des types de prélèvement de CE, et les catégories de **Test categories** sur la page Terminologie.

## Português

A página **Catálogo de exames** mostra a lista nacional de exames: código, nome, categoria, tipos de amostra, código LOINC (ou **Sem LOINC**) e se este laboratório realiza cada exame. Precisa da permissão de ver a Terminologia para a abrir, e da permissão de a gerir para alterar qualquer coisa.

Uma instalação que não recebeu o catálogo do nível central é dona dele, e pode adicionar, editar, retirar e repor exames. Um laboratório que recebe o catálogo do nível central não pode alterar os seus exames. Pode ativar ou desativar exames, restringir as suas amostras e definir um nome local. A sincronização nunca envia essas definições.

Adicione um exame no menu ⋯ da página, e edite-o no menu ⋯ da sua linha. Esse mesmo menu ativa ou desativa um exame neste laboratório, e retira-o ou repõe-no. A pesquisa abrange o código, o nome, o nome curto e o nome local. Filtre por categoria, LOINC, ativado ou não, e estado. Os exames retirados ficam ocultos, exceto se filtrar por eles.

Um código LOINC é pesquisado quando o LOINC está carregado nesta instalação. Caso contrário é escrito, e só o formato é verificado. Os tipos de amostra vêm da lista de tipos de amostra do CE, e as categorias de **Test categories** na página Terminologia.
```

In `apps/web/src/docs/content.ts`, in `TITLES` after `  facilities: 'Facilities',` add `  'test-catalog': 'Test catalog',`, and in `NAV` after `  { slug: 'facilities' },` add `  { slug: 'test-catalog' },`.

- [ ] **Step 4: Add the four commands to the CLI page**

In `apps/web/src/docs/0.1.8/cli.md`, change the `test-catalog` row of the Command groups table to:

```markdown
| `test-catalog` | The national test catalog: `list` the tests, `enable` or `disable` one at this lab, and `retire` or `restore` one where this install owns the catalog. |
```

Directly after the English paragraph that starts `Retired tests are hidden unless you pass`, add:

````markdown

Switch a test on or off at this lab, or retire and restore it, by code:

```sh
openldr test-catalog enable HIVVL
openldr test-catalog retire HIVVL --json
```

`enable` and `disable` work on any install. `retire` and `restore` work only where this install owns the catalog. Retiring is reversible, so none of them takes `--force`. Each is recorded in the audit log as the CLI user.
````

Directly after the French paragraph that starts `Les examens retirés sont masqués`, add:

````markdown

Activer ou désactiver un examen dans ce laboratoire, ou le retirer et le rétablir, par son code :

```sh
openldr test-catalog enable HIVVL
openldr test-catalog retire HIVVL --json
```

`enable` et `disable` fonctionnent sur toute installation. `retire` et `restore` ne fonctionnent que si cette installation est propriétaire du catalogue. Le retrait est réversible, aucune de ces commandes ne prend donc `--force`. Chacune est inscrite au journal d'audit au nom de l'utilisateur de la CLI.
````

Directly after the Portuguese paragraph that starts `Os exames retirados ficam ocultos`, add:

````markdown

Ativar ou desativar um exame neste laboratório, ou retirá-lo e repô-lo, pelo código:

```sh
openldr test-catalog enable HIVVL
openldr test-catalog retire HIVVL --json
```

`enable` e `disable` funcionam em qualquer instalação. `retire` e `restore` só funcionam quando esta instalação é dona do catálogo. Retirar é reversível, por isso nenhum destes comandos aceita `--force`. Cada um fica no registo de auditoria em nome do utilizador da CLI.
````

- [ ] **Step 5: Run the docs tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/docs --testTimeout 30000` and `cd apps/web && npx vitest run src/docs --testTimeout 30000`

Expected: PASS, both. A validation failure in the studio run names the broken link or undeclared image.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/test-catalog.md apps/studio/src/docs/0.1.8/fr/test-catalog.md apps/studio/src/docs/0.1.8/pt/test-catalog.md apps/studio/src/docs/registry.ts apps/studio/src/docs/registry.test.ts apps/web/src/docs/0.1.8/test-catalog.md apps/web/src/docs/content.ts apps/web/src/docs/DocsPage.test.tsx apps/web/src/docs/0.1.8/cli.md
git commit -m "docs(test-catalog): document the Test catalog page and its row commands"
```

---

### Task 8: gate, and report

**Files:** none.

- [ ] **Step 1: Run the full forced gate**

From the worktree root:

```bash
pnpm turbo run typecheck --force --concurrency=4 > "$TEMP/s2-tc.txt" 2>&1; echo "typecheck exit=$?"
pnpm turbo run test --force --concurrency=4 --continue > "$TEMP/s2-test.txt" 2>&1; echo "test exit=$?"
grep -E "Tasks:|Failed:|Cached:|Test timed out" "$TEMP/s2-tc.txt" "$TEMP/s2-test.txt"
```

Expected: both exit 0, `36 successful, 36 total` and `35 successful, 35 total`, `0 cached` in both. A failure outside this plan's files is most likely a timeout: re-run that package alone before reading anything into it. Ask before changing a test outside this plan.

- [ ] **Step 2: Confirm the branch adds no migration**

```bash
git diff --stat main...HEAD -- packages/db/src/migrations/
```

Expected: no output.

- [ ] **Step 3: Report, and ask before merging**

Tell the operator what each layer proves:

- **Service tests (pg-mem):** the options offered, the switch keeping the lab's other settings and never signalling sync, retire and restore changing only the status and signalling once per real change, and the refusals. pg-mem is not Postgres.
- **Route tests:** the wire shape, permissions, body checks, error mapping and audit rows of the three new routes, over a fake service.
- **CLI tests:** the four commands, their audit rows as the CLI actor, their output and refusals, over a fake context. Parsing tests prove commander hands each command its code and `--json`.
- **Studio tests (jsdom):** the client's requests; the page's rows, filter, search, paging, empty state, row actions and permissions; the sheet's create, edit, lab-only and failure paths. They mock the API, so they do not prove the server.
- **HONEST NON-PROOF:** the page against the running API, the 375px layout, and a real phone. After a merge the dev API restarts. Then, with the operator's go-ahead: open `/test-catalog` in the Browser pane (it serves the main checkout), check the empty state, add a scratch test through the sheet, switch it on, retire and restore it, and read the table at 375x812 with `resize_window` (the table scrolls sideways inside its own frame, the sheet fills the width). Only a real phone can confirm the pager at the bottom stays reachable. Remove the scratch test afterwards as the S1 live check did: delete its LOINC mapping and the term through their routes, then its `test_catalog_lab_settings` row and any DRAFT LOINC stub with psql. Ask before creating it.

Merge, changelog (`pnpm make:changelog` after merging, per AGENTS.md section 6) and push only when the operator asks.
