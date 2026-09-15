# Test catalog S4: the Lab order uses the catalog, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** The Lab order's Tests picker offers this lab's tests (catalog tests switched on here, under local names), its Specimen Type picker narrows to the specimens the chosen tests accept, and a submitted order leads with each test's LOINC coding, then its catalog coding.

**Architecture:** Migration 105 seeds the ValueSet row `urn:openldr:valueset:lab-tests` with an empty stored list and repoints the shipped Lab order at it. `@openldr/bootstrap` works the list out whenever `ops` reads that url, from the catalog and the lab settings, so it is never stale and never synced. A new route answers which specimens the chosen tests accept, and the studio picker offers only those. The order extractor reads each answer's own system and takes an optional map of codings to write in front, which the forms route fills from the catalog's LOINC links.

**Tech Stack:** TypeScript, Kysely, pg-mem, Fastify, zod, React, vitest (pg-mem for services and migrations, jsdom for the studio).

**Spec:** `docs/superpowers/specs/2026-09-15-test-catalog-design.md`, sections 4.5 and 5 (S4). The S1 plan (`...-s1-catalog-data.md`) holds the ValueSet sync finding this slice builds on (its "Open item 1").

## Global Constraints

- Work in a git worktree under `.claude/worktrees/`, never the main checkout. Leave `peaceful-kirch-839cb2` and `confident-lumiere-666963` alone.
- Stage by exact path. Never `git add <dir>`. No `Co-Authored-By` trailer.
- Commit only as these steps say. Merge or push only when the operator asks.
- New writing follows the `unslop` skill, code comments and UI copy included: no em dashes, no emoji in headings or bullets.
- Run one test file from its package: `cd <package> && npx vitest run <path> --testTimeout 30000`. `pnpm --filter <pkg> test -- <path>` does not filter.
- Typecheck one package: `cd <package> && npx tsc --noEmit -p . > "$TEMP/<name>.txt" 2>&1; echo "exit=$?"`. Never read `$?` through a pipe.
- The gate is `pnpm turbo run typecheck --force --concurrency=4` and `pnpm turbo run test --force --concurrency=4 --continue`, each redirected to a file. Never pipe turbo through `tail`. A failure is usually a timeout: grep for `Test timed out` and re-run that package alone.
- **Migration 105.** Free on `main`, `origin/main`, every local branch and all three worktrees on 2026-09-15. Re-check right before merging, including any branch on the operator's Linux machine. If 105 is taken, renumber: `git mv` both files, update `index.ts` (import alias and key, kept last), the manifest in `packages/db/src/migrations/migrations.test.ts`, the `@openldr/db` export, and every comment naming the number.
- **Never migrate a persistent database from the worktree.** The dev API runs under `nodemon` in the main checkout and restarts when a merge changes its files, and it migrates the dev database on boot. Merge only once the number is final.
- **No clinical vocabulary in code** (AGENTS.md section 8). The studio never names the catalog or LOINC urls. The server decides which answers are catalog tests.
- **No new CLI command** (AGENTS.md section 6, item 2). S4 adds no admin, settings or maintenance feature. It changes data entry. `openldr terminology expand urn:openldr:valueset:lab-tests` prints what the Tests field offers, because Task 4 reads the list the same way in the CLI's terminology context.
- **Every studio string goes in `en.ts`, `fr.ts` and `pt.ts` together.** This slice adds none. `FormRuntime` and `ReferencePicker` are schema-driven and carry no i18n (`FormRuntime.tsx:84-92`).
- **The Browser pane serves the main checkout**, so the live UI check runs after the merge. The capture page for the Lab order is under `http://localhost:5173/studio/forms`.

---

## Settled before S4 (operator, 2026-09-15)

1. **The lab's test list is worked out when read.** Migration 105 seeds one ValueSet row the way 069 and 104 do (listed in the builder, `immutable`, no `fhir.change_log` row, so it never syncs), with an empty stored list. When `ops` reads its url, bootstrap builds the list live: the active catalog tests switched on here, each under the lab's local name when it set one. Nothing is rebuilt on change, so nothing can go stale. The rejected option was a stored list rewritten after each of eight triggers across two packages (switch on or off, lab settings, add, edit, retire or restore, import apply, the pull at `packages/bootstrap/src/index.ts:1386`, and the bundle import in `sync-bundle.ts`).
2. **Existing installs are repointed, as the spec says.** Migration 105 rewrites every stored Lab order still carrying the shape 103 shipped. The operator accepted the consequence. No Lab order can be submitted until tests are added to the catalog and switched on. An install with no LOINC loaded loses nothing, because its LOINC picker already finds nothing (spec section 1).

## Facts this plan rests on

Each was read on 2026-09-15 at `57824352`.

- **Reference search sends a `valueSetUrl` field to `ops.expand`** (`packages/forms/src/reference-source.ts:42-53`, `apps/server/src/reference-search-routes.ts:51-57`), and **the submit route checks every coding with `ops.validateCode({ valueSetUrl })`** (`apps/server/src/forms-routes.ts:377-381`, `packages/forms/src/validate-references.ts:83-102`). So a picker-only route would not do. The list must exist for `ops`.
- **`ops` loads a ValueSet with `getResourceByUrl`** (`packages/terminology/src/operations.ts:49-57`), which reads `terminology_systems` and then `fhir.fhir_resources` (`packages/db/src/terminology-store.ts:163-167`). Bootstrap builds `ops` in two places: the app context (`packages/bootstrap/src/index.ts:934-941`) and the CLI's terminology context (`packages/bootstrap/src/terminology-context.ts:120-126`, used by `openldr terminology expand` and `validate`, `packages/cli/src/terminology.ts:66-74`).
- **An include clause with a system and an empty concept list lists the whole system** (`packages/db/src/value-set-expander.ts:53`, `:62`). A lab with nothing switched on must get `{ include: [] }`, never `{ include: [{ system, concept: [] }] }`.
- **The expander keeps a concept entry's own display** (`value-set-expander.ts:56-58`), so local names reach the picker, and `expand`'s filter searches them (`operations.ts:58-63`).
- **`valueSets.save` refuses an immutable set** (`packages/db/src/terminology-admin-store.ts:509-510`). Delete does not check it (`:1154-1159`).
- **The extractor writes every Tests answer as LOINC**, whatever system the answer carries (`packages/forms/src/extract/extract.ts:179-185`), and `ExtractionContext` holds only `subject` and `authored` (`:20-23`). A picked coding keeps its own system in `valueCoding` (`packages/forms/src/answer-value.ts:17-24`).
- **The extractor has three other callers with no catalog**: the workflow form check (`packages/bootstrap/src/form-validate-service.ts:44`), `openldr forms extract` (`packages/cli/src/forms.ts:21`) and the ingest converter (`packages/ingest/src/converters/questionnaire-response.ts:18`). Any new context entry must be optional.
- **The warehouse keeps an order's first coding** as `panel_code`, `panel_system` and `panel_desc` (`packages/db/src/relational/extract.ts:24-31`, `packages/db/src/relational/service-request.ts:13-15`).
- **`referenceDependsOn` is stored but unused**: only the schema (`packages/forms/src/schema/form-schema.ts:104`) and the builder's picker (`apps/studio/src/forms-builder/field-editor/ReferenceEditor.tsx:135-136`) touch it. The docs say so in six places (studio and web `forms.md`, en, fr, pt).
- **The data-entry picker knows only its own field** (`apps/studio/src/forms-runtime/ReferencePicker.tsx:43-100`) and searches only from 2 typed characters (`:83`, `:202`). `FieldRow` has every answer (`FormRuntime.tsx:324-348`) but hands `FieldControl` only its own value (`:408-416`).
- **A Lab Technician holds `forms.view` and `forms.submit` only** (`packages/rbac/src/presets.ts:52`). Reference search is gated on `forms.view` (`reference-search-routes.ts:9`).
- **Existing installs keep their stored Lab order.** Seeding creates a sample form only when no form of that name exists (`packages/bootstrap/src/seed.ts:147-193`). Migrations 100 to 103 repoint stored copies by exact match with a marker for `down()` (`packages/db/src/migrations/internal/103_lab_order_requisition_slot.ts:223-253`).
- **A builder save keeps every field key it does not manage** (`packages/forms/src/normalize.ts:96-105`), so `referenceDependsOn` and `valueSetUrl` survive one.
- **Starter packs are rebuilt from the sample forms on every boot** and carry both `boundValueSet` and `referenceTarget` (`packages/forms/src/samples/starter-packs.ts:16-17`, `:84-85`). They carry no depends-on. `starter-packs.test.ts:50` pins the Tests entry to LOINC.

## Where this plan departs from the spec

| Spec says | Plan does | Why |
|---|---|---|
| The lab ValueSet "is rebuilt when lab settings change and when a central catalog update is applied" (4.2) | Worked out on every read, never rebuilt | Decision 1 |
| "Migration 104 repoints stored copies" (4.5) | Migration 105 | S1 took 104 (S1 plan, open item 3) |
| New route `POST /api/test-catalog/specimens` (4.5), with "`terminology.view` to see the page" (4.6) | The route is gated on `forms.view` | It serves data entry, and a Lab Technician holds no `terminology.view` (`presets.ts:52`). The page's own routes keep their gates |
| "Narrowing applies only when the depends-on field is a catalog test field" (4.5) | The server counts only answers whose system is the catalog's | Same effect, and the studio names no url (AGENTS.md section 8) |
| (not specified) | The narrowed picker lists its specimens on focus, with no 2-character minimum | The narrowed list is a few codes. Typing two letters to see four choices is no help |
| (not specified) | A Tests answer with no system is still written as LOINC | Such an answer predates this slice, and every one of them was LOINC |

## Known effects, not handled in S4

- **No Lab order can be submitted until tests are added and switched on** (decision 2). The docs and the changelog say so.
- **The Terminology page shows the lab list's stored row, which is empty.** Its Expand button reads the stored compose (`terminology-admin-store.ts:1161-1165`). The FHIR `$expand` route, the pickers and `openldr terminology expand` show the live list.
- **Deleting the lab list on the Terminology page is not refused** (`terminology-admin-store.ts:1154-1159`). The Lab order's Tests picker then fails with "ValueSet not found". The category set from 104 has the same exposure.
- **A form built from a starter pack gets the lab list but no depends-on.** Packs have no depends-on column.
- **The workflow form check, `openldr forms extract` and the ingest converter pass no catalog lookup**, so a catalog answer arriving that way gets its catalog coding only, not LOINC in front.
- **A specimen already chosen stays chosen when the tests change** and it is no longer accepted. The submit does not refuse it. Narrowing helps data entry, and the spec defines no server rule.
- **`panel_desc` stays empty for a picked test, as it is today.** The extractor takes a Tests display only from answer options (`extract.ts:183`), and a reference field has none.
- **Two chosen tests linked to the same LOINC code write that coding twice.**
- **An install whose Lab order was edited in the builder keeps its own Tests binding.** 105 leaves such a form alone, and the docs say how to rebind it.

---

## What changes

| File | Change |
|---|---|
| `packages/db/src/migrations/internal/105_lab_order_test_catalog.ts` | Create. Seed the lab list's row, repoint the Lab order |
| `packages/db/src/migrations/internal/105_lab_order_test_catalog.test.ts` | Create |
| `packages/db/src/migrations/internal/index.ts` | Register 105 |
| `packages/db/src/migrations/migrations.test.ts` | Manifest |
| `packages/db/src/index.ts` | Export 105's snapshot for the forms pin |
| `packages/forms/src/extract/extract.ts` | Read each Tests answer's system; `codingBefore` |
| `packages/forms/src/extraction.test.ts` | Extractor tests |
| `packages/forms/src/samples/forms.ts` | Tests binds the lab list; Specimen Type depends on Tests |
| `packages/forms/src/samples/forms.test.ts` | Pins against 105 |
| `packages/forms/src/samples/starter-packs.ts`, `starter-packs.test.ts` | Tests rationale, pack version, pin |
| `packages/bootstrap/src/test-catalog.ts` | `LAB_TESTS_VALUE_SET`, `labTestsCompose`, `withLabTestsList`, `specimensFor`, `loincCodingsFor` |
| `packages/bootstrap/src/test-catalog.test.ts` | Tests for the above |
| `packages/bootstrap/src/index.ts`, `terminology-context.ts` | Read the lab list through `withLabTestsList`; exports |
| `apps/server/src/test-catalog-routes.ts`, `.test.ts` | `POST /api/test-catalog/specimens` |
| `apps/server/src/forms-routes.ts`, `.test.ts` | Hand the extractor the LOINC codings |
| `apps/studio/src/api.ts`, `api.testCatalog.test.ts` | `catalogSpecimensFor` |
| `apps/studio/src/forms-runtime/ReferencePicker.tsx`, `.test.tsx` | Narrowing |
| `apps/studio/src/forms-runtime/FormRuntime.tsx`, `.test.tsx` | Pass the depends-on answer |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`, `test-catalog.md` | Depends On, and the Lab order |
| `apps/web/src/docs/0.1.8/forms.md`, `test-catalog.md` | The same, three languages |

---

### Task 1: migration 105 seeds the lab list and repoints the Lab order

**Files:**
- Create: `packages/db/src/migrations/internal/105_lab_order_test_catalog.ts`
- Create: `packages/db/src/migrations/internal/105_lab_order_test_catalog.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts:105` and `:212`
- Modify: `packages/db/src/migrations/migrations.test.ts:7`
- Modify: `packages/db/src/index.ts:113-115`

**Interfaces:**
- Produces: `LAB_TESTS_VALUE_SET = 'urn:openldr:valueset:lab-tests'`, `LAB_ORDER_PREV_FIELDS_SNAPSHOT` (103's shipped fields, frozen), `LAB_ORDER_CATALOG_FIELDS_SNAPSHOT` (this release's fields), `up`, `down`. `@openldr/db` exports `LAB_ORDER_FORM_MIGRATION_CATALOG_FIELDS` (Task 3 pins the sample against it). The ValueSet row: id `vs-lab-tests`, `immutable: true`, compose `{ include: [] }`.

The approach copies 103 (`103_lab_order_requisition_slot.ts`) for the form and 104 (`104_test_catalog.ts:68-91`, `:94-98`) for the ValueSet.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/migrations/internal/105_lab_order_test_catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  LAB_ORDER_CATALOG_FIELDS_SNAPSHOT,
  LAB_ORDER_PREV_FIELDS_SNAPSHOT,
  LAB_TESTS_VALUE_SET,
  up,
  down,
} from './105_lab_order_test_catalog';
// Imported to PROVE this migration's frozen copy still matches what 103 actually shipped.
// The migration itself must never import it.
import { LAB_ORDER_BOUND_FIELDS_SNAPSHOT as SHIPPED_103 } from './103_lab_order_requisition_slot';

async function seedOrderForm(db: any, fields: readonly unknown[], id = 'form-sample-order'): Promise<void> {
  await db.insertInto('form_definitions').values({
    id, name: 'Lab order', status: 'published', active: true,
    target_pages: JSON.stringify(['forms']),
    schema: JSON.stringify({ id, name: 'Lab order', fields, targetPages: ['forms'] }),
  } as never).execute();
}

async function readFields(db: any): Promise<unknown> {
  const row = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').executeTakeFirst();
  const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
  return schema.fields;
}

async function freshDb(): Promise<any> {
  const db = await makeMigratedDb();
  await db.deleteFrom('form_definitions').where('name', '=', 'Lab order').execute();
  return db;
}

const byId = (fields: readonly unknown[], id: string) => (fields as any[]).find((f) => f.id === id);
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

describe('105 lab order test catalog', () => {
  it("rebinds an install still carrying 103's Lab order to the lab's test list", async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_CATALOG_FIELDS_SNAPSHOT);
  });

  it("leaves an operator's own edit alone", async () => {
    const db = await freshDb();
    const edited = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as any[]).map((f) => (f.id === 'tests' ? { ...f, displayLabel: 'Ordered tests' } : f));
    await seedOrderForm(db, edited);
    await up(db);
    expect(await readFields(db)).toEqual(edited);
  });

  it('leaves an already-migrated row alone, so a second run changes nothing', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_CATALOG_FIELDS_SNAPSHOT);
    await up(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_CATALOG_FIELDS_SNAPSHOT);
  });

  it('does not guess when two forms share the name', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-a');
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-b');
    await up(db);
    const rows = await db.selectFrom('form_definitions').select('schema').where('name', '=', 'Lab order').execute();
    for (const row of rows) expect(json(row.schema).fields).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
  });

  it('down() restores exactly the shape up() found', async () => {
    const db = await freshDb();
    await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    await up(db);
    await down(db);
    expect(await readFields(db)).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
  });

  it('binds tests to the lab list and makes the specimen type depend on it, and changes nothing else', () => {
    const tests = byId(LAB_ORDER_CATALOG_FIELDS_SNAPSHOT, 'tests');
    expect(tests).toMatchObject({ valueSetUrl: 'urn:openldr:valueset:lab-tests', referenceMultiple: true, fhirPath: 'ServiceRequest.code' });
    expect(tests).not.toHaveProperty('referenceTarget');
    expect(byId(LAB_ORDER_CATALOG_FIELDS_SNAPSHOT, 'fld-ord-specimen-type'))
      .toMatchObject({ referenceDependsOn: 'tests', valueSetUrl: 'urn:openldr:valueset:specimen-type' });
    const others = (fields: readonly unknown[]) => (fields as any[]).filter((f) => f.id !== 'tests' && f.id !== 'fld-ord-specimen-type');
    expect(others(LAB_ORDER_CATALOG_FIELDS_SNAPSHOT)).toEqual(others(LAB_ORDER_PREV_FIELDS_SNAPSHOT));
  });

  it("the frozen copy of 103's Lab order shape still matches what 103 actually shipped", () => {
    expect(LAB_ORDER_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_103);
  });

  it('registers the lab test list, immutable, with an empty stored list and no fhir.change_log row', async () => {
    const db = await makeMigratedDb();
    const vs = await db.selectFrom('value_sets').select(['id', 'immutable', 'compose'])
      .where('url', '=', LAB_TESTS_VALUE_SET).executeTakeFirstOrThrow();
    expect({ id: vs.id, immutable: vs.immutable, compose: json(vs.compose) })
      .toEqual({ id: 'vs-lab-tests', immutable: true, compose: { include: [] } });
    expect(await db.selectFrom('terminology_systems').select(['kind', 'resource_id']).where('url', '=', LAB_TESTS_VALUE_SET).executeTakeFirstOrThrow())
      .toEqual({ kind: 'ValueSet', resource_id: 'vs-lab-tests' });
    expect(await db.selectFrom('fhir.fhir_resources').select('id').where('resource_type', '=', 'ValueSet').where('id', '=', 'vs-lab-tests').execute())
      .toHaveLength(1);
    expect(await db.selectFrom('fhir.change_log').select('seq').where('resource_type', '=', 'ValueSet').where('resource_id', '=', 'vs-lab-tests').execute())
      .toEqual([]);
  });

  it('down removes the lab test list', async () => {
    const db = await makeMigratedDb();
    await down(db);
    expect(await db.selectFrom('value_sets').select('id').where('url', '=', LAB_TESTS_VALUE_SET).execute()).toEqual([]);
    expect(await db.selectFrom('terminology_systems').select('url').where('url', '=', LAB_TESTS_VALUE_SET).execute()).toEqual([]);
    expect(await db.selectFrom('fhir.fhir_resources').select('id').where('id', '=', 'vs-lab-tests').execute()).toEqual([]);
  });
});
```

The harness copies `103_lab_order_requisition_slot.test.ts:13-33`. The ValueSet assertions copy `104_test_catalog.test.ts:29-40` and `:63-70`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/db && npx vitest run src/migrations/internal/105_lab_order_test_catalog.test.ts --testTimeout 30000`

Expected: FAIL. `./105_lab_order_test_catalog` does not exist.

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/internal/105_lab_order_test_catalog.ts`:

```ts
import { type Kysely } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import type { VsCompose } from '../../value-set-expander';

// Test catalog S4 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.5). Two changes.
//
// 1. The lab's test list, `urn:openldr:valueset:lab-tests`, seeded the way 069 and 104 seed their
//    sets: the value_sets row, the canonical FHIR row and the terminology_systems registration, and no
//    fhir.change_log row, so it never syncs. Its stored list is empty on purpose. ops works the real
//    list out when it reads this url: the active catalog tests switched on here, under this lab's
//    local names (withLabTestsList, packages/bootstrap/src/test-catalog.ts). `immutable` stops the
//    Terminology page re-saving it through valueSets.save, which would write a change_log row.
//
// 2. The shipped Lab order's Tests field binds that list instead of the whole of LOINC, and its
//    Specimen Type field depends on Tests, so data entry narrows the specimens. Same exact-match,
//    marker and down() discipline as 100 to 103: only a row still carrying 103's shape is rewritten.
//
// Values are inlined, not imported: a migration is a frozen record, and packages/db must not depend
// on @openldr/forms or @openldr/bootstrap. LAB_TESTS_VALUE_SET must stay equal to the constant of the
// same name in packages/bootstrap/src/test-catalog.ts.
export const LAB_TESTS_VALUE_SET = 'urn:openldr:valueset:lab-tests';
const LAB_TESTS_VS_ID = 'vs-lab-tests';
const LAB_TESTS_VS_TITLE = "This lab's tests";
const LAB_TESTS_VS_DESCRIPTION =
  'The catalog tests switched on at this lab, under its local names. Worked out when read, so the stored list is empty.';
const PUBLISHER_ID = 'pub-system';
const EMPTY_COMPOSE: VsCompose = { include: [] };

/** 103's shipped Lab order shape, copied verbatim, not imported. A migration is a frozen snapshot
 *  of one release and must not live-track another file. */
export const LAB_ORDER_PREV_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    id: "patient",
    fhirPath: "ServiceRequest.subject",
    displayLabel: "Patient",
    description: null,
    fieldType: "reference",
    required: true,
    enabled: true,
    order: 0,
    cardinality: { min: 0, max: "1" },
    section: "patient",
    referenceTarget: "Patient",
    placeholder: "Search by name, ID, or phone…"
  },
  {
    id: "tests",
    fhirPath: "ServiceRequest.code",
    displayLabel: "Tests",
    description: null,
    fieldType: "reference",
    required: true,
    enabled: true,
    order: 1,
    cardinality: { min: 1, max: "*" },
    referenceMultiple: true,
    section: "order",
    referenceTarget: "http://loinc.org",
    placeholder: "Search tests…"
  },
  {
    id: "fld-ord-priority",
    fhirPath: "ServiceRequest.priority",
    displayLabel: "Priority",
    description: null,
    fieldType: "select",
    required: true,
    enabled: true,
    order: 2,
    cardinality: { min: 0, max: "1" },
    section: "order",
    valueSetOptions: [
      { code: "routine", display: "Routine" },
      { code: "urgent", display: "Urgent" },
      { code: "asap", display: "ASAP" },
      { code: "stat", display: "STAT" }
    ]
  },
  {
    id: "fld-ord-ward",
    fhirPath: "ServiceRequest.locationCode.0",
    displayLabel: "Ward / Department",
    description: null,
    fieldType: "select",
    required: false,
    enabled: true,
    order: 3,
    cardinality: { min: 0, max: "1" },
    section: "order",
    valueSetOptions: [
      { code: "opd", display: "OPD" },
      { code: "ipd", display: "IPD" },
      { code: "icu", display: "ICU" }
    ]
  },
  {
    id: "fld-ord-clinician",
    fhirPath: "ServiceRequest.requester",
    displayLabel: "Requesting Clinician",
    description: null,
    fieldType: "text",
    required: false,
    enabled: true,
    order: 4,
    cardinality: { min: 0, max: "1" },
    section: "order",
    placeholder: "Dr. …"
  },
  {
    id: "fld-ord-ref-number",
    fhirPath: "ServiceRequest.identifier.value",
    fhirDiscriminator: { system: "urn:openldr:order:requisition" },
    fhirValueField: "value",
    displayLabel: "Reference Number",
    description: "External requisition number",
    fieldType: "text",
    required: false,
    enabled: true,
    order: 5,
    cardinality: { min: 0, max: "1" },
    section: "order",
    placeholder: "REF-…"
  },
  {
    id: "fld-ord-notes",
    fhirPath: "ServiceRequest.note.0.text",
    displayLabel: "Clinical Notes",
    description: "Clinical context, suspected diagnosis…",
    fieldType: "text",
    required: false,
    enabled: true,
    order: 6,
    cardinality: { min: 0, max: "1" },
    section: "order"
  },
  {
    id: "fld-ord-ref-facility",
    fhirPath: "ServiceRequest.performer",
    displayLabel: "Referring Facility",
    description: null,
    fieldType: "facility",
    required: false,
    enabled: true,
    order: 7,
    cardinality: { min: 0, max: "1" },
    section: "order",
    placeholder: "Search facilities by name or MFL ID…"
  },
  {
    id: "fld-ord-specimen-type",
    fhirPath: "Specimen.type",
    displayLabel: "Specimen Type",
    description: null,
    fieldType: "reference",
    required: true,
    enabled: true,
    order: 8,
    cardinality: { min: 1, max: "1" },
    section: "specimen",
    valueSetUrl: "urn:openldr:valueset:specimen-type",
    placeholder: "Search specimen types…"
  }
];

/** The Lab order this release ships. Exported so packages/forms/src/samples/forms.test.ts can pin the
 *  CURRENT sample against it. */
export const LAB_ORDER_CATALOG_FIELDS_SNAPSHOT: readonly unknown[] = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[]).map(
  (f) => {
    if (f.id === 'tests') {
      const { referenceTarget: _loinc, ...rest } = f;
      return { ...rest, valueSetUrl: LAB_TESTS_VALUE_SET };
    }
    if (f.id === 'fld-ord-specimen-type') return { ...f, referenceDependsOn: 'tests' };
    return f;
  },
);

/** Mirrors 071 to 103's MARKER_KEY discipline. */
const MARKER_KEY = '__migration105';

interface Migration105Marker {
  prevFields: readonly unknown[];
}

async function seedLabTestsList(seedDb: Kysely<any>): Promise<void> {
  // Written the way 104 writes the category set (104_test_catalog.ts:74-91), but immutable.
  await seedDb.insertInto('value_sets').values({
    id: LAB_TESTS_VS_ID, url: LAB_TESTS_VALUE_SET, version: null, name: 'lab-tests',
    title: LAB_TESTS_VS_TITLE, status: 'active', experimental: false, description: LAB_TESTS_VS_DESCRIPTION,
    compose: JSON.stringify(EMPTY_COMPOSE) as never,
    immutable: true, category: null, publisher_id: PUBLISHER_ID, expanded_at: null,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

  const resource = valueSetToFhirResource({
    id: LAB_TESTS_VS_ID, url: LAB_TESTS_VALUE_SET, status: 'active', experimental: false, version: null,
    name: 'lab-tests', title: LAB_TESTS_VS_TITLE, description: LAB_TESTS_VS_DESCRIPTION, compose: EMPTY_COMPOSE,
  });
  await seedDb.insertInto('fhir.fhir_resources').values({
    id: LAB_TESTS_VS_ID, resource_type: 'ValueSet', resource: JSON.stringify(resource),
  } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();

  await seedDb.insertInto('terminology_systems').values({
    url: LAB_TESTS_VALUE_SET, version: null, kind: 'ValueSet', resource_id: LAB_TESTS_VS_ID,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
}

async function rebindLabOrder(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous: never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Only rewrites a row that exactly matches 103's shape. A builder save leaves that shape unchanged
  // (forms.test.ts proves it). Anything else, already rewritten or an operator's own edit, is left alone.
  if (stableStringify(fields) !== stableStringify(LAB_ORDER_PREV_FIELDS_SNAPSHOT)) return;

  const marker: Migration105Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: LAB_ORDER_CATALOG_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function unbindLabOrder(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration105Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await seedLabTestsList(seedDb);
  await rebindLabOrder(seedDb);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await unbindLabOrder(seedDb);
  await seedDb.deleteFrom('terminology_systems').where('url', '=', LAB_TESTS_VALUE_SET).execute();
  await seedDb.deleteFrom('fhir.fhir_resources').where('resource_type', '=', 'ValueSet').where('id', '=', LAB_TESTS_VS_ID).execute();
  await seedDb.deleteFrom('value_sets').where('url', '=', LAB_TESTS_VALUE_SET).execute();
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 071 to 103, not
 *  imported: importing a private helper across migration files would couple two frozen snapshots. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}
```

`LAB_ORDER_PREV_FIELDS_SNAPSHOT` is 103's `LAB_ORDER_PREV_FIELDS_SNAPSHOT` (`103_lab_order_requisition_slot.ts:22-200`) with `fld-ord-ref-number` rewritten as 103's `LAB_ORDER_BOUND_FIELDS_SNAPSHOT` does (`:204-214`). The test "the frozen copy of 103's Lab order shape" proves the literal. If it fails, fix the literal, never the test.

- [ ] **Step 4: Register 105**

In `packages/db/src/migrations/internal/index.ts`, after `import * as m104 from './104_test_catalog';` (line 105) add:

```ts
import * as m105 from './105_lab_order_test_catalog';
```

and after `'104_test_catalog': { up: m104.up, down: m104.down },` (line 212) add:

```ts
  '105_lab_order_test_catalog': { up: m105.up, down: m105.down },
```

In `packages/db/src/migrations/migrations.test.ts:7`, change the end of the manifest from `'104_test_catalog']);` to `'104_test_catalog', '105_lab_order_test_catalog']);`.

In `packages/db/src/index.ts`, after line 115 (`export { LAB_ORDER_PREV_FIELDS_SNAPSHOT as LAB_ORDER_FORM_MIGRATION_PREV_FIELDS } from ...102...`) add:

```ts
export { LAB_ORDER_CATALOG_FIELDS_SNAPSHOT as LAB_ORDER_FORM_MIGRATION_CATALOG_FIELDS } from './migrations/internal/105_lab_order_test_catalog';
```

Keep the three existing Lab order exports. Task 3's builder-save test still uses 103's shape as a prior shape.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd packages/db && npx vitest run src/migrations/internal/105_lab_order_test_catalog.test.ts src/migrations/internal/103_lab_order_requisition_slot.test.ts src/migrations/internal/104_test_catalog.test.ts src/migrations/migrations.test.ts --testTimeout 30000`

Expected: PASS, every test in the four files. 103's tests still pass: its `up` runs on a fresh copy it seeds itself.

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/db && npx tsc --noEmit -p . > "$TEMP/s4-t1-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/105_lab_order_test_catalog.ts packages/db/src/migrations/internal/105_lab_order_test_catalog.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/index.ts
git commit -m "feat(db): seed the lab test list and point the Lab order at it" -m "Migration 105 seeds urn:openldr:valueset:lab-tests the way 104 seeds the category set, with no change_log row so it never syncs, immutable, and an empty stored list: bootstrap works the real list out when it is read. It repoints the shipped Lab order: Tests binds that list instead of LOINC, and Specimen Type depends on Tests. Only a form still carrying 103's shape is rewritten, and down() restores it."
```

---

### Task 2: the order extractor reads each test's own system

**Files:**
- Modify: `packages/forms/src/extract/extract.ts:20-23` and `:176-186`
- Modify: `packages/forms/src/extraction.test.ts`

**Interfaces:**
- Produces: `ExtractionContext.codingBefore?: ReadonlyMap<string, Coding>`, keyed `system|code` of a Tests answer, holding the coding to write in front of it. Task 7 fills it.

- [ ] **Step 1: Write the failing tests**

Append to `packages/forms/src/extraction.test.ts`:

```ts
describe('ServiceRequestExtractor tests codings (test catalog S4)', () => {
  const CATALOG = 'urn:openldr:codesystem:test-catalog'
  const order = (fieldType: 'reference' | 'text') =>
    makeSchema({
      id: 'o', name: 'Order', fhirResourceType: 'ServiceRequest',
      fields: [makeField({
        id: 'tests', displayLabel: 'Tests', fieldType, order: 0, fhirPath: 'ServiceRequest.code',
        ...(fieldType === 'reference' ? { referenceMultiple: true, cardinality: { min: 1, max: '*' } } : {}),
      })],
    })
  const codings = (model: ReturnType<typeof order>, answers: Record<string, unknown>, extra: object = {}) =>
    (ServiceRequestExtractor.extract(toQuestionnaireResponse(model, answers as never), toQuestionnaire(model), { ...ctx, ...extra })[0] as any).code?.coding

  it('writes a catalog test under its own system, not as LOINC', () => {
    expect(codings(order('reference'), { tests: [{ system: CATALOG, code: 'HIVVL', display: 'Viral load' }] }))
      .toEqual([{ system: CATALOG, code: 'HIVVL' }])
  })

  it('writes the coding the context names in front of the test, test by test', () => {
    const codingBefore = new Map([[`${CATALOG}|HIVVL`, { system: 'http://loinc.org', code: '25836-8' }]])
    expect(codings(order('reference'), {
      tests: [{ system: CATALOG, code: 'HIVVL', display: 'Viral load' }, { system: CATALOG, code: 'CD4', display: 'CD4 count' }],
    }, { codingBefore })).toEqual([
      { system: 'http://loinc.org', code: '25836-8' },
      { system: CATALOG, code: 'HIVVL' },
      { system: CATALOG, code: 'CD4' },
    ])
  })

  it('keeps a LOINC answer as LOINC, and an answer that names no system as LOINC', () => {
    expect(codings(order('reference'), { tests: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] }))
      .toEqual([{ system: 'http://loinc.org', code: '718-7' }])
    expect(codings(order('text'), { tests: '718-7' })).toEqual([{ system: 'http://loinc.org', code: '718-7' }])
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/forms && npx vitest run src/extraction.test.ts --testTimeout 30000`

Expected: the first two new tests FAIL. The catalog coding comes out as `{ system: 'http://loinc.org', code: 'HIVVL' }`, and no coding is written in front. The third PASSES already: it pins today's LOINC behaviour.

- [ ] **Step 3: Read the answer's system, and write the coding in front**

In `packages/forms/src/extract/extract.ts`, replace the `ExtractionContext` interface (lines 20-23) with:

```ts
/** Context the extractors need but the form can't supply (e.g. the encounter's subject). */
export interface ExtractionContext {
  subject?: Reference
  authored?: string
  /**
   * For an order's test answer coded `system|code`, a coding to write in front of the answer's own.
   * The forms route fills it from the test catalog's LOINC links (test catalog S4), so an order still
   * leads with LOINC and the warehouse, which keeps the first coding, keeps matching. Other callers
   * leave it out.
   */
  codingBefore?: ReadonlyMap<string, Coding>
}
```

Replace the `ServiceRequest.code` branch (lines 176-187) with:

```ts
      // The ordered test(s) → ServiceRequest.code. An answer carries its own system: a catalog test
      // since the Lab order moved to the lab's test list (test catalog S4), LOINC before that. An answer
      // naming no system predates both and was always LOINC. Display comes from the Questionnaire
      // answerOption.
      if (path === 'ServiceRequest.code') {
        for (const answer of item.answer ?? []) {
          const code = answer.valueCoding?.code ?? answer.valueString
          if (!code) continue
          const system = answer.valueCoding?.system || LOINC
          const display = meta?.answerOptions?.find((o) => o.code === code)?.display
          const before = ctx.codingBefore?.get(`${system}|${code}`)
          if (before) codings.push(before)
          codings.push({ system, code, ...(display ? { display } : {}) })
        }
        return
      }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/forms && npx vitest run src/extraction.test.ts src/samples/forms.test.ts src/routing.test.ts --testTimeout 30000`

Expected: PASS, every test in the three files. The existing requisition and 102/103 extraction tests do not change.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/forms && npx tsc --noEmit -p . > "$TEMP/s4-t2-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/forms/src/extract/extract.ts packages/forms/src/extraction.test.ts
git commit -m "fix(forms): write an ordered test under its own coding system" -m "The ServiceRequest extractor labelled every ordered test as LOINC, whatever system the answer carried. It now reads the answer's system, and an answer that names none is still written as LOINC. An optional codingBefore map in the extraction context names a coding to write in front of a test, so the forms route can put a catalog test's LOINC code first. Callers that pass no map are unchanged."
```

---

### Task 3: the shipped Lab order binds the lab list

**Files:**
- Modify: `packages/forms/src/samples/forms.ts:343-360` and `:452-484`
- Modify: `packages/forms/src/samples/forms.test.ts:9-23`, `:74-78`, `:317-336`
- Modify: `packages/forms/src/samples/starter-packs.ts:17` and `:61`
- Modify: `packages/forms/src/samples/starter-packs.test.ts:50`

**Interfaces:**
- Consumes: `LAB_ORDER_FORM_MIGRATION_CATALOG_FIELDS` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `packages/forms/src/samples/forms.test.ts`:

1. Add `LAB_ORDER_FORM_MIGRATION_CATALOG_FIELDS,` to the `@openldr/db` import, after `LAB_ORDER_FORM_MIGRATION_BOUND_FIELDS,` (line 20).

2. Replace the test `binds tests to a coding system rather than an unregistered entity` (lines 74-78) with:

```ts
  it("binds tests to this lab's test list", () => {
    expect(resolveReferenceSource(field('tests')))
      .toEqual({ ok: true, source: { kind: 'coding', mode: 'valueset', url: 'urn:openldr:valueset:lab-tests' } });
  });

  it('narrows the specimen type by the chosen tests', () => {
    expect(field('fld-ord-specimen-type').referenceDependsOn).toBe('tests');
  });
```

3. Replace the test `matches migration 103's frozen BOUND_FIELDS snapshot exactly` (lines 321-323) with:

```ts
  it("matches migration 105's frozen CATALOG_FIELDS snapshot exactly", () => {
    expect(order().fields).toEqual(LAB_ORDER_FORM_MIGRATION_CATALOG_FIELDS);
  });

  it('tests and specimen type trip no rule', () => {
    const ids = ['tests', 'fld-ord-specimen-type'];
    expect(lintFormSchema(order()).filter((i) => ids.includes(i.fieldId ?? ''))).toEqual([]);
  });
```

4. In the test `a builder save leaves both prior Lab order shapes unchanged` (lines 330-335), change the list to include 103's shape and 105's:

```ts
    for (const prior of [
      LAB_ORDER_FORM_MIGRATION_PREV_FIELDS, LAB_ORDER_FORM_MIGRATION_PREV_REQUISITION,
      LAB_ORDER_FORM_MIGRATION_BOUND_FIELDS, LAB_ORDER_FORM_MIGRATION_CATALOG_FIELDS,
    ]) {
```

105 rewrites only a row that exactly matches 103's shape, so this proves a builder save cannot move a stored form off it.

In `packages/forms/src/samples/starter-packs.test.ts`, replace line 50 with:

```ts
    expect(entry('pack-service-request', 'Tests')).toMatchObject({
      boundValueSet: 'urn:openldr:valueset:lab-tests', referenceTarget: null, referenceMultiple: true,
    });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/forms && npx vitest run src/samples/forms.test.ts src/samples/starter-packs.test.ts --testTimeout 30000`

Expected: FAIL. The sample still binds LOINC: `binds tests to this lab's test list`, `narrows the specimen type`, `matches migration 105's` and the starter pack's Tests entry fail. The rest PASS.

- [ ] **Step 3: Bind the sample**

In `packages/forms/src/samples/forms.ts`, replace the Tests field (lines 343-360) with:

```ts
    {
      id: 'tests',
      fhirPath: 'ServiceRequest.code',
      displayLabel: 'Tests',
      description: null,
      fieldType: 'reference',
      required: true,
      enabled: true,
      order: 1,
      // A lab order carries several tests, chosen from this lab's test list: the catalog tests switched
      // on here, under their local names (test catalog S4, migration 105). The list is worked out when
      // read (packages/bootstrap/src/test-catalog.ts), and an order still leads with each test's LOINC
      // code when it has one (packages/forms/src/extract/extract.ts).
      cardinality: { min: 1, max: '*' },
      referenceMultiple: true,
      section: 'order',
      valueSetUrl: 'urn:openldr:valueset:lab-tests',
      placeholder: 'Search tests…',
    },
```

In the Specimen Type field, directly after `valueSetUrl: 'urn:openldr:valueset:specimen-type',` (line 482) add:

```ts
      // Offers only the specimens at least one chosen test accepts, by this lab's lists (test catalog
      // S4). With no tests chosen, or none that lists specimens, it offers the whole list.
      referenceDependsOn: 'tests',
```

In `packages/forms/src/samples/starter-packs.ts`, change line 17 to `export const STARTER_PACK_VERSION = '2';` (its own comment asks for a bump when a pack changes) and the `tests` rationale (line 61) to:

```ts
  tests: "What the lab is asked to run, from this lab's test list. An order can hold several.",
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/forms && npx vitest run src/samples src/capture.test.ts src/validate-answers.test.ts src/lint.test.ts src/extraction.test.ts --testTimeout 30000`

Expected: PASS, every test in those files. `capture.test.ts:80` round-trips LOINC codings on the Tests field; it checks shape only and still passes.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/forms && npx tsc --noEmit -p . > "$TEMP/s4-t3-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/forms/src/samples/forms.ts packages/forms/src/samples/forms.test.ts packages/forms/src/samples/starter-packs.ts packages/forms/src/samples/starter-packs.test.ts
git commit -m "feat(forms): the shipped Lab order orders from this lab's test list" -m "The sample Lab order's Tests field binds urn:openldr:valueset:lab-tests instead of all of LOINC, and its Specimen Type field depends on Tests. The sample now matches migration 105's snapshot, and a builder save keeps 103's shape and 105's, so 105's exact match holds. The Lab order starter pack follows, with its version bumped."
```

---

### Task 4: bootstrap works the lab list out when it is read

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts:2-4`, after `:32`, and before `createTestCatalog` (`:359`)
- Modify: `packages/bootstrap/src/index.ts:70`, `:938`, `:1746-1754`
- Modify: `packages/bootstrap/src/terminology-context.ts:124`
- Modify: `packages/bootstrap/src/test-catalog.test.ts`

**Interfaces:**
- Produces: `LAB_TESTS_VALUE_SET`; `labTestsCompose(db): Promise<VsCompose>`; `withLabTestsList(db, getResourceByUrl): (url: string) => Promise<unknown | null>`.

- [ ] **Step 1: Write the failing tests**

In `packages/bootstrap/src/test-catalog.test.ts`:

1. Change the `@openldr/terminology` import (line 8) to:

```ts
import { createOperations, LOINC_SYSTEM, type Operations } from '@openldr/terminology';
```

2. Add `LAB_TESTS_VALUE_SET, TEST_CATEGORY_VALUE_SET, withLabTestsList,` to the import from `./test-catalog` (lines 10-13).

3. Append at the end of the file:

```ts
// The lab list is read through withLabTestsList, as bootstrap builds ops (index.ts, terminology-context.ts).
async function buildWithLabList() {
  const built = await buildCatalog();
  const store = createTerminologyStore(built.db, createFhirStore(built.db));
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c),
    findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q),
    getResourceByUrl: withLabTestsList(built.db, (u) => store.getResourceByUrl(u)),
    translate: (q) => store.translate(q),
  });
  return { ...built, ops };
}

async function labList(ops: Operations, filter?: string): Promise<Array<[string, string | undefined]>> {
  const vs = await ops.expand(LAB_TESTS_VALUE_SET, { count: 100, ...(filter ? { filter } : {}) });
  return (vs.expansion?.contains ?? []).map((c) => [c.code ?? '', c.display]);
}

describe('test catalog: the lab test list', () => {
  it('lists nothing, not the whole catalog, when no test is switched on here', async () => {
    const { catalog, ops } = await buildWithLabList();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await catalog.create({ code: 'CD4', display: 'CD4 count' });
    expect(await labList(ops)).toEqual([]);
  });

  it('lists the active tests switched on here, under the local name when there is one', async () => {
    const { catalog, ops } = await buildWithLabList();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await catalog.create({ code: 'CD4', display: 'CD4 count' });
    await catalog.create({ code: 'GLU', display: 'Glucose' });
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
    await catalog.setEnabled('CD4', true);
    expect(await labList(ops)).toEqual([['CD4', 'CD4 count'], ['HIVVL', 'Viral load']]);
  });

  it('drops a retired test, even while it stays switched on', async () => {
    const { catalog, ops } = await buildWithLabList();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await catalog.setEnabled('HIVVL', true);
    await catalog.setActive('HIVVL', false);
    expect(await labList(ops)).toEqual([]);
  });

  it('searches the local name, and the submit check accepts only listed tests', async () => {
    const { catalog, ops } = await buildWithLabList();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load' });
    await catalog.create({ code: 'GLU', display: 'Glucose' });
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
    expect(await labList(ops, 'viral')).toEqual([['HIVVL', 'Viral load']]);
    const check = (code: string) => ops.validateCode({ valueSetUrl: LAB_TESTS_VALUE_SET, code, system: TEST_CATALOG_SYSTEM });
    expect((await check('HIVVL')).result).toBe(true);
    expect((await check('GLU')).result).toBe(false);
  });

  it('keeps a test switched on here through a pull from central', async () => {
    const { db, catalog, ops } = await buildWithLabList();
    const central = [{ code: 'HIVVL', display: 'HIV viral load', status: 'ACTIVE', properties: null }];
    const bulk = createTerminologyBulkSync({
      labDb: db,
      fetchConceptsPage: async () => ({ concepts: central, nextCode: null }),
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
      getToken: async () => 'token',
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    await bulk.syncSystem(TEST_CATALOG_SYSTEM, { kind: 'CodeSystem', generation: 1 });
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: null, localDisplay: 'Viral load' });
    await bulk.syncSystem(TEST_CATALOG_SYSTEM, { kind: 'CodeSystem', generation: 2 });
    expect(await labList(ops)).toEqual([['HIVVL', 'Viral load']]);
  });

  it('reads every other url exactly as stored', async () => {
    const { ops } = await buildWithLabList();
    const categories = (await ops.expand(TEST_CATEGORY_VALUE_SET, { count: 100 })).expansion?.contains?.map((c) => c.code);
    expect(categories).toEqual(expect.arrayContaining(['CHEM', 'HAEM', 'MICRO', 'MOL', 'SERO']));
  });
});
```

The pull setup copies `test-catalog.test.ts:390-402`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts -t "the lab test list" --testTimeout 30000`

Expected: FAIL, with `withLabTestsList is not a function`. The file's other tests are skipped by `-t`.

- [ ] **Step 3: Work the list out**

In `packages/bootstrap/src/test-catalog.ts`:

1. Add `type VsCompose` to the `@openldr/db` import (lines 2-4):

```ts
import {
  markTerminologyChanged, type InternalSchema, type TerminologyAdminStore, type TermMapping, type TermMappingInput,
  type VsCompose,
} from '@openldr/db';
```

2. Directly below `export const SPECIMEN_TYPE_VALUE_SET = ...` (line 32) add:

```ts
/** The lab's test list, which the Lab order's Tests field binds. Must equal LAB_TESTS_VALUE_SET in
 *  migration 105, which seeds its row. */
export const LAB_TESTS_VALUE_SET = 'urn:openldr:valueset:lab-tests';
```

3. Directly above `export function createTestCatalog` (line 359) add:

```ts
/**
 * The lab's test list as a ValueSet compose: the active catalog tests switched on here, each under the
 * lab's local name when it set one. Worked out on every read, so it is never stale and never stored
 * (test catalog S4, decision 1). With nothing switched on it is `{ include: [] }`: an include of the
 * catalog system with no concepts would list the whole catalog (packages/db/src/value-set-expander.ts:53-62).
 */
export async function labTestsCompose(db: Kysely<InternalSchema>): Promise<VsCompose> {
  const rows = await db.selectFrom('terminology_concepts as c')
    .innerJoin('test_catalog_lab_settings as l', 'l.code', 'c.code')
    .select(['c.code as code', 'c.display as display', 'l.local_display as localDisplay'])
    .where('c.system', '=', TEST_CATALOG_SYSTEM)
    .where('l.enabled', '=', true)
    // NULL counts as ACTIVE, as toTest reads it.
    .where((eb) => eb.or([eb('c.status', '=', 'ACTIVE'), eb('c.status', 'is', null)]))
    .orderBy('c.code')
    .execute();
  if (rows.length === 0) return { include: [] };
  return {
    include: [{
      system: TEST_CATALOG_SYSTEM,
      concept: rows.map((r) => ({ code: r.code, display: r.localDisplay ?? r.display ?? r.code })),
    }],
  };
}

/**
 * Wrap a terminology source's getResourceByUrl so the lab's test list is worked out when read. Only
 * that url changes, and only when migration 105's row exists: the stored resource keeps its id and
 * title, and its compose is replaced. Both places bootstrap builds ops use this (index.ts and
 * terminology-context.ts), so the pickers, the submit check and `openldr terminology expand` agree.
 */
export function withLabTestsList(
  db: Kysely<InternalSchema>,
  getResourceByUrl: (url: string) => Promise<unknown | null>,
): (url: string) => Promise<unknown | null> {
  return async (url) => {
    const stored = await getResourceByUrl(url);
    if (url !== LAB_TESTS_VALUE_SET || !stored || typeof stored !== 'object') return stored;
    return { ...(stored as Record<string, unknown>), compose: await labTestsCompose(db) };
  };
}
```

SKETCH, verify when run: pg-mem must accept the aliased inner join with an `is null` branch. If it refuses, report the error before changing the query shape.

- [ ] **Step 4: Read ops through it, in both places**

In `packages/bootstrap/src/index.ts`, change the import at line 70 to:

```ts
import { createTestCatalog, withLabTestsList, type TestCatalog } from './test-catalog';
```

and the `getResourceByUrl` line of the app context's `createOperations` (line 938) to:

```ts
      getResourceByUrl: withLabTestsList(termDb, (u) => termStore.getResourceByUrl(u)),
```

In `packages/bootstrap/src/terminology-context.ts`, add the import:

```ts
import { withLabTestsList } from './test-catalog';
```

and change line 124 to:

```ts
    getResourceByUrl: withLabTestsList(db, (u) => store.getResourceByUrl(u)),
```

In `packages/bootstrap/src/index.ts`, add `LAB_TESTS_VALUE_SET, labTestsCompose, withLabTestsList,` to the `./test-catalog` export block (line 1748, after `SPECIMEN_TYPE_VALUE_SET,`).

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: PASS, every test in the file, the six new ones included.

Mutation check on the load-bearing test: change `if (rows.length === 0) return { include: [] };` to return `{ include: [{ system: TEST_CATALOG_SYSTEM, concept: [] }] }` and re-run `-t "lists nothing"`. It must FAIL, listing both tests. Restore the line.

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s4-t4-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts packages/bootstrap/src/index.ts packages/bootstrap/src/terminology-context.ts
git commit -m "feat(bootstrap): work the lab test list out when it is read" -m "When ops reads urn:openldr:valueset:lab-tests, it now lists the active catalog tests switched on at this lab, under the lab's local names, straight from the catalog and the lab settings. Nothing is stored or rebuilt, so the list cannot go stale, and a pull from central keeps the lab's switch-ons. With nothing switched on the list is empty, not the whole catalog. Both places bootstrap builds ops read it the same way."
```

---

### Task 5: the catalog answers an order's specimens and LOINC codes

**Files:**
- Modify: `packages/bootstrap/src/test-catalog.ts` (the `TestCatalog` interface at `:197-210`, and inside `createTestCatalog`)
- Modify: `packages/bootstrap/src/test-catalog.test.ts`

**Interfaces:**
- Produces: `TestCatalog.specimensFor(tests: Array<{ system: string; code: string }>): Promise<CatalogSpecimenOption[]>` and `TestCatalog.loincCodingsFor(tests: Array<{ system: string; code: string }>): Promise<Map<string, { system: string; code: string }>>`, keyed `system|code` of the test.

- [ ] **Step 1: Write the failing tests**

Append to `packages/bootstrap/src/test-catalog.test.ts`:

```ts
describe('test catalog: what an order needs', () => {
  const test = (code: string) => ({ system: TEST_CATALOG_SYSTEM, code });

  it('offers the specimens at least one chosen test accepts, by this lab narrower list', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', specimenTypes: [BLD, UR] });
    await catalog.create({ code: 'GLU', display: 'Glucose', specimenTypes: [BLD, CSF] });
    await catalog.setLabSettings('HIVVL', { enabled: true, specimenTypes: [UR], localDisplay: null });
    expect(await catalog.specimensFor([test('HIVVL'), test('GLU')])).toEqual([
      { system: LOCAL, code: 'BLD', display: 'Blood' },
      { system: LOCAL, code: 'CSF', display: 'CSF' },
      { system: LOCAL, code: 'UR', display: 'Urine' },
    ]);
    expect(await catalog.specimensFor([test('HIVVL')])).toEqual([{ system: LOCAL, code: 'UR', display: 'Urine' }]);
  });

  it('offers nothing to narrow by for codings outside the catalog, or tests with no specimens', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'CD4', display: 'CD4 count' });
    expect(await catalog.specimensFor([{ system: LOINC_SYSTEM, code: '718-7' }])).toEqual([]);
    expect(await catalog.specimensFor([test('CD4'), test('NOPE')])).toEqual([]);
  });

  it('names each catalog test LOINC coding, for tests with an active link only', async () => {
    const { catalog } = await buildCatalog();
    await catalog.create({ code: 'HIVVL', display: 'HIV viral load', loinc: '25836-8' });
    await catalog.create({ code: 'CD4', display: 'CD4 count' });
    await catalog.create({ code: 'GLU', display: 'Glucose', loinc: '2345-7' });
    await catalog.update('GLU', { display: 'Glucose', loinc: null });
    const found = await catalog.loincCodingsFor([test('HIVVL'), test('CD4'), test('GLU'), { system: LOINC_SYSTEM, code: '718-7' }]);
    expect([...found]).toEqual([[`${TEST_CATALOG_SYSTEM}|HIVVL`, { system: LOINC_SYSTEM, code: '25836-8' }]]);
  });
});
```

The specimen displays are the seeded ValueSet's (migration 014): Blood, CSF, Sputum, Urine. The list is sorted by display, as `options()` sorts it.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts -t "what an order needs" --testTimeout 30000`

Expected: FAIL, with `catalog.specimensFor is not a function` and `catalog.loincCodingsFor is not a function`.

- [ ] **Step 3: Add the two methods**

In the `TestCatalog` interface, after `exportCsv(): Promise<string>;` (line 209) add:

```ts
  /** The specimens at least one of these tests accepts, by this lab's lists. Codings outside the
   *  catalog are ignored. Empty means there is nothing to narrow by (test catalog S4). */
  specimensFor(tests: Array<{ system: string; code: string }>): Promise<CatalogSpecimenOption[]>;
  /** Each catalog test's LOINC coding, keyed `system|code` of the test, for tests with an active link. */
  loincCodingsFor(tests: Array<{ system: string; code: string }>): Promise<Map<string, { system: string; code: string }>>;
```

Inside `createTestCatalog`, directly above `return {`, add:

```ts
  async function specimensFor(tests: Array<{ system: string; code: string }>): Promise<CatalogSpecimenOption[]> {
    const codes = new Set(tests.filter((t) => t.system === TEST_CATALOG_SYSTEM).map((t) => t.code));
    if (codes.size === 0) return [];
    // The lab's narrower list when it set one, else the catalog's (spec 4.5).
    const accepted = new Set((await readTests())
      .filter((t) => codes.has(t.code))
      .flatMap((t) => (t.lab.specimenTypes ?? t.specimenTypes).map(codingKey)));
    if (accepted.size === 0) return [];
    // Only what the specimen picker offers can be submitted, so a specimen since dropped from that
    // list is left out.
    return (await expandEntries(SPECIMEN_TYPE_VALUE_SET)).filter((s) => accepted.has(codingKey(s))).sort(byLabel);
  }

  async function loincCodingsFor(tests: Array<{ system: string; code: string }>): Promise<Map<string, { system: string; code: string }>> {
    const codes = [...new Set(tests.filter((t) => t.system === TEST_CATALOG_SYSTEM).map((t) => t.code))];
    if (codes.length === 0) return new Map();
    const links = await db.selectFrom('term_mappings').select(['from_code', 'to_code'])
      .where('from_system', '=', TEST_CATALOG_SYSTEM)
      .where('from_code', 'in', codes)
      .where('to_system', '=', LOINC_SYSTEM)
      .where('map_type', '=', LOINC_MAP_TYPE)
      .where('is_active', '=', true)
      .execute();
    return new Map(links.map((l) => [`${TEST_CATALOG_SYSTEM}|${l.from_code}`, { system: LOINC_SYSTEM, code: l.to_code }]));
  }
```

Add `specimensFor,` and `loincCodingsFor,` to the returned object, after `exportCsv,`.

`readTests`, `expandEntries`, `codingKey` and `byLabel` already exist (`test-catalog.ts:371`, `:439`, `:336`, `:355`).

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/bootstrap && npx vitest run src/test-catalog.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

- [ ] **Step 5: Typecheck the package**

Run: `cd packages/bootstrap && npx tsc --noEmit -p . > "$TEMP/s4-t5-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/test-catalog.ts packages/bootstrap/src/test-catalog.test.ts
git commit -m "feat(bootstrap): tell an order which specimens and LOINC codes its tests have" -m "specimensFor answers the specimens at least one chosen catalog test accepts, using the lab's narrower list where it set one, limited to what the specimen picker offers. loincCodingsFor answers each chosen catalog test's active LOINC link. Both ignore codings that are not catalog tests."
```

---

### Task 6: the specimens route

**Files:**
- Modify: `apps/server/src/test-catalog-routes.ts:15` and after `:198`
- Modify: `apps/server/src/test-catalog-routes.test.ts:28-29`, `:49`, and before `:331`

**Interfaces:**
- Consumes: `TestCatalog.specimensFor` (Task 5).
- Produces: `POST /api/test-catalog/specimens`, body `{ tests: Array<{ system, code }> }`, answers `{ specimens: CatalogSpecimenOption[] }`. Gated on `forms.view`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/test-catalog-routes.test.ts`:

1. Add `| 'specimensFor'` to the `Method` type (lines 28-29).

2. After `exportCsv: spy(...)` (line 49) add:

```ts
    specimensFor: spy('specimensFor', over.specimensFor ?? (async () => [{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }])),
```

3. Inside the `describe` block, after its last test, add:

```ts
  it('POST /specimens answers the specimens for the chosen tests, to anyone who can use forms', async () => {
    const { ctx, calls } = fakeCtx();
    const tests = [{ system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL' }];
    const res = await appWith(ctx, ['forms.view']).inject({ method: 'POST', url: '/api/test-catalog/specimens', payload: { tests } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ specimens: [{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }] });
    expect(calls).toEqual([{ method: 'specimensFor', args: [tests] }]);
  });

  it('POST /specimens needs forms.view, and refuses a body that is not a list of codings', async () => {
    const { ctx, calls } = fakeCtx();
    const terminologyOnly = await appWith(ctx, ['terminology.view', 'terminology.manage'])
      .inject({ method: 'POST', url: '/api/test-catalog/specimens', payload: { tests: [] } });
    expect(terminologyOnly.statusCode).toBe(403);
    const bad = await appWith(ctx, ['forms.view']).inject({ method: 'POST', url: '/api/test-catalog/specimens', payload: { tests: 'HIVVL' } });
    expect(bad.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: the two new tests FAIL with 404. The others PASS.

- [ ] **Step 3: Add the route**

In `apps/server/src/test-catalog-routes.ts`, directly after `const IMPORT_STEP = ...` (line 15) add:

```ts
// Data entry narrows the Lab order's specimen picker through the specimens route, and a Lab Technician
// holds forms.view and forms.submit only (packages/rbac/src/presets.ts:52). So that route takes the gate
// reference search takes (reference-search-routes.ts:9), not terminology.view.
const FORMS_VIEW = { preHandler: requireCapability('forms.view') };
```

Directly after `const activeInput = z.object({ active: z.boolean() });` add:

```ts
const specimensInput = z.object({ tests: z.array(coding) });
```

At the end of `registerTestCatalogRoutes`, after the `/export` route, add:

```ts
  // Test catalog S4: the specimens the chosen tests accept, for the Lab order's specimen picker (spec 4.5).
  app.post('/api/test-catalog/specimens', FORMS_VIEW, async (req, reply) => {
    const parsed = specimensInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.send({ specimens: await ctx.testCatalog.specimensFor(parsed.data.tests) });
  });
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/server && npx vitest run src/test-catalog-routes.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/server && npx tsc --noEmit -p . > "$TEMP/s4-t6-tc.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src/test-catalog-routes.ts > "$TEMP/s4-t6-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` twice.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/test-catalog-routes.ts apps/server/src/test-catalog-routes.test.ts
git commit -m "feat(server): answer which specimens the chosen tests accept" -m "POST /api/test-catalog/specimens takes the tests chosen on an order and answers the specimens at least one of them accepts, by this lab's lists. It is gated on forms.view, because data entry calls it and a Lab Technician holds no terminology capability."
```

---

### Task 7: a submitted order leads with LOINC

**Files:**
- Modify: `apps/server/src/forms-routes.ts:4`, `:7`, after `:61`, and `:398`
- Modify: `apps/server/src/forms-routes.test.ts`

**Interfaces:**
- Consumes: `ExtractionContext.codingBefore` (Task 2), `TestCatalog.loincCodingsFor` (Task 5), `TEST_CATALOG_SYSTEM`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/forms-routes.test.ts`, directly after the `referenceSchema` constant (it ends at line 152), add:

```ts
// Test catalog S4: a Lab order whose Tests field binds this lab's test list.
const catalogOrderSchema = {
  ...referenceSchema,
  id: 'catalog-order',
  fields: [
    ...referenceSchema.fields,
    {
      id: 'tests',
      fhirPath: 'ServiceRequest.code',
      displayLabel: 'Tests',
      description: null,
      fieldType: 'reference' as const,
      required: true,
      enabled: true,
      order: 1,
      cardinality: { min: 1, max: '*' },
      referenceMultiple: true,
      section: 'main',
      valueSetUrl: 'urn:openldr:valueset:lab-tests',
    },
  ],
} satisfies FormInput['schema'];
```

Inside `describe('forms routes', ...)`, after the test `falls back to the extractor default when no field is bound to ServiceRequest.subject`, add:

```ts
  it('writes each catalog test LOINC coding in front of it on the derived ServiceRequest', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    const asked: unknown[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    (ctx as any).testCatalog = {
      loincCodingsFor: async (tests: unknown) => {
        asked.push(tests);
        return new Map([['urn:openldr:codesystem:test-catalog|HIVVL', { system: 'http://loinc.org', code: '25836-8' }]]);
      },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: catalogOrderSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [
          { system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL', display: 'Viral load' },
          { system: 'urn:openldr:codesystem:test-catalog', code: 'CD4', display: 'CD4 count' },
        ],
      } },
    });

    expect(res.statusCode).toBe(201);
    expect(asked).toEqual([[
      { system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL' },
      { system: 'urn:openldr:codesystem:test-catalog', code: 'CD4' },
    ]]);
    const serviceRequest = runs[0].body.entry.map((e: any) => e.resource).find((r: any) => r.resourceType === 'ServiceRequest');
    expect(serviceRequest.code.coding).toEqual([
      { system: 'http://loinc.org', code: '25836-8' },
      { system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL' },
      { system: 'urn:openldr:codesystem:test-catalog', code: 'CD4' },
    ]);
  });

  it('does not ask the catalog when no answer is a catalog test', async () => {
    const ctx = fakeCtx();
    (ctx as any).testCatalog = { loincCodingsFor: async () => { throw new Error('the catalog was asked'); } };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: referenceSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });
    expect(res.statusCode).toBe(201);
  });
```

The shape copies `forms-routes.test.ts:931-957`. The fake `validateCode` answers `result: true` by default (`:217`), so the Tests answers pass the reference check.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/server && npx vitest run src/forms-routes.test.ts --testTimeout 30000`

Expected: the first new test FAILS. `asked` is empty, and the coding list lacks the LOINC coding in front. The second PASSES already: the route does not ask the catalog yet.

- [ ] **Step 3: Hand the extractor the LOINC codings**

In `apps/server/src/forms-routes.ts`:

1. Change line 4 to:

```ts
import { TEST_CATALOG_SYSTEM, type AppContext } from '@openldr/bootstrap';
```

2. Add `isCodingAnswer` to the `@openldr/forms` import on line 7, after `isEntityAnswer,`.

3. Directly after `extractionContextFor` (it ends at line 61) add:

```ts
/** The Corlix fhir-path a Lab order binds its tests to. */
const ORDER_CODE_FHIR_PATH = 'ServiceRequest.code';

/**
 * For each catalog test on the order, the LOINC coding the extractor writes in front of it (test
 * catalog S4, spec 4.5). The warehouse keeps an order's first coding (packages/db/src/relational/extract.ts),
 * so a LOINC-linked test still lands as LOINC. The catalog is asked only when an answer is a catalog test.
 */
async function catalogCodingsBefore(
  ctx: AppContext, schema: FormSchema, answers: Record<string, unknown>,
): Promise<ExtractionContext['codingBefore']> {
  const tests: Array<{ system: string; code: string }> = [];
  for (const field of schema.fields) {
    if (field.fhirPath !== ORDER_CODE_FHIR_PATH) continue;
    const value = answers[field.id];
    for (const v of Array.isArray(value) ? value : [value]) {
      if (isCodingAnswer(v) && v.system === TEST_CATALOG_SYSTEM) tests.push({ system: v.system, code: v.code });
    }
  }
  if (tests.length === 0) return undefined;
  return ctx.testCatalog.loincCodingsFor(tests);
}
```

4. Directly after `const extractionContext = extractionContextFor(f.schema, p.data.answers, submittedAt);` (line 398) add:

```ts
    const codingBefore = await catalogCodingsBefore(ctx, f.schema, p.data.answers);
    if (codingBefore) extractionContext.codingBefore = codingBefore;
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/server && npx vitest run src/forms-routes.test.ts --testTimeout 30000`

Expected: PASS, every test in the file.

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/server && npx tsc --noEmit -p . > "$TEMP/s4-t7-tc.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src/forms-routes.ts > "$TEMP/s4-t7-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` twice.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts
git commit -m "feat(server): lead a submitted order with each test's LOINC code" -m "When a form's ServiceRequest.code answers are catalog tests, the forms route asks the catalog for their LOINC links and hands them to the extractor, which writes each LOINC coding in front of its catalog coding. The warehouse keeps the first coding, so a LOINC-linked test still lands as LOINC and existing reports keep matching. The catalog is not asked when no answer is a catalog test."
```

---

### Task 8: the specimen picker narrows to the chosen tests

**Files:**
- Modify: `apps/studio/src/api.ts` (after `downloadTestCatalogCsv`, which ends at `:2536`)
- Modify: `apps/studio/src/api.testCatalog.test.ts`
- Modify: `apps/studio/src/forms-runtime/ReferencePicker.tsx:2-3`, `:23`, `:43-100`, `:202`
- Modify: `apps/studio/src/forms-runtime/ReferencePicker.test.tsx:20-35`
- Modify: `apps/studio/src/forms-runtime/FormRuntime.tsx:408-416`, `:425-441`, `:584-591`
- Modify: `apps/studio/src/forms-runtime/FormRuntime.test.tsx:5-16`

**Interfaces:**
- Consumes: `POST /api/test-catalog/specimens` (Task 6).
- Produces: `catalogSpecimensFor(tests)` in `@/api`; `ReferencePicker`'s optional prop `dependsOnValue?: unknown`.

- [ ] **Step 1: Write the failing tests**

In `apps/studio/src/api.testCatalog.test.ts`, add `catalogSpecimensFor,` to the import from `./api`, and append inside its `describe` block:

```ts
  it('asks which specimens the chosen tests accept', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ specimens: [{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }] })));
    const tests = [{ system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL' }];
    expect(await catalogSpecimensFor(tests)).toEqual([{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }]);
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/specimens', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tests }),
    });
  });
```

In `apps/studio/src/forms-runtime/ReferencePicker.test.tsx`, replace the mock and its import (lines 20-24) with:

```ts
vi.mock('@/api', () => ({
  referenceSearch: vi.fn(),
  referenceSearchPreview: vi.fn(),
  catalogSpecimensFor: vi.fn(),
}));
import { catalogSpecimensFor, referenceSearch, referenceSearchPreview } from '@/api';
```

add `vi.mocked(catalogSpecimensFor).mockReset();` to the `beforeEach` (lines 33-36), and append:

```tsx
describe('ReferencePicker: narrowed by the chosen tests (test catalog S4)', () => {
  const specimenField = {
    id: 'fld-ord-specimen-type', displayLabel: 'Specimen Type', fieldType: 'reference',
    valueSetUrl: 'urn:openldr:valueset:specimen-type', referenceDependsOn: 'tests',
  } as never;
  const chosen = [{ system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL', display: 'Viral load' }];
  const accepted = [
    { system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' },
    { system: 'urn:openldr:cs:local', code: 'UR', display: 'Urine' },
  ];

  it('offers only the specimens the chosen tests accept, without searching the whole list', async () => {
    vi.mocked(catalogSpecimensFor).mockResolvedValue(accepted);
    const user = userEvent.setup();
    render(<ReferencePicker field={specimenField} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} dependsOnValue={chosen} />);

    await waitFor(() => expect(catalogSpecimensFor).toHaveBeenCalledWith([{ system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL' }]));
    await user.click(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getByText('Urine')).toBeInTheDocument());
    expect(screen.getByText('Blood')).toBeInTheDocument();

    await user.type(screen.getByRole('combobox'), 'ur');
    await waitFor(() => expect(screen.queryByText('Blood')).toBeNull());
    expect(screen.getByText('Urine')).toBeInTheDocument();
    expect(referenceSearch).not.toHaveBeenCalled();
  });

  it('searches as before when the chosen tests give nothing to narrow by', async () => {
    vi.mocked(catalogSpecimensFor).mockResolvedValue([]);
    vi.mocked(referenceSearch).mockResolvedValue({ kind: 'coding', rows: [{ system: 'urn:openldr:cs:local', code: 'CSF', display: 'CSF' }], total: 1 });
    const user = userEvent.setup();
    render(<ReferencePicker field={specimenField} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} dependsOnValue={chosen} />);

    await waitFor(() => expect(catalogSpecimensFor).toHaveBeenCalledTimes(1));
    await user.type(screen.getByRole('combobox'), 'cs');
    await waitFor(() => expect(referenceSearch).toHaveBeenCalledWith('f1', 'fld-ord-specimen-type', { q: 'cs' }));
  });

  it('does not ask to narrow when nothing is chosen', () => {
    render(<ReferencePicker field={specimenField} formDefinitionId="f1" multiple={false} value={null} onChange={() => {}} dependsOnValue={undefined} />);
    expect(catalogSpecimensFor).not.toHaveBeenCalled();
  });
});
```

In `apps/studio/src/forms-runtime/FormRuntime.test.tsx`, replace the mock and its import (lines 5-9) with:

```ts
vi.mock('@/api', () => ({
  referenceSearch: vi.fn(),
  referenceSearchPreview: vi.fn(),
  catalogSpecimensFor: vi.fn(),
}));
import { catalogSpecimensFor, referenceSearch, referenceSearchPreview } from '@/api';
```

add `vi.mocked(catalogSpecimensFor).mockReset();` to the `beforeEach` (lines 13-16), and append inside the file's main `describe` block:

```tsx
  it('hands a depends-on field the answer it depends on, so its picker can narrow', async () => {
    vi.mocked(catalogSpecimensFor).mockResolvedValue([]);
    const orderSchema = {
      ...schema,
      fields: [
        {
          id: 'tests', fhirPath: 'ServiceRequest.code', displayLabel: 'Tests', description: null, fieldType: 'reference',
          required: true, enabled: true, order: 1, cardinality: { min: 1, max: '*' }, referenceMultiple: true,
          valueSetUrl: 'urn:openldr:valueset:lab-tests',
        },
        {
          id: 'specimen', fhirPath: 'Specimen.type', displayLabel: 'Specimen Type', description: null, fieldType: 'reference',
          required: true, enabled: true, order: 2, cardinality: { min: 1, max: '1' },
          valueSetUrl: 'urn:openldr:valueset:specimen-type', referenceDependsOn: 'tests',
        },
      ],
    } as FormSchema;
    const chosen = [{ system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL', display: 'Viral load' }];
    render(<FormRuntime schema={orderSchema} formDefinitionId="f1" initialAnswers={{ tests: chosen }} onSubmit={() => {}} />);
    await waitFor(() => expect(catalogSpecimensFor).toHaveBeenCalledWith([{ system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL' }]));
    expect(catalogSpecimensFor).toHaveBeenCalledTimes(1);
  });
```

SKETCH, verify when run: the two narrowing tests depend on the picker listing rows on focus once `narrowTo` is set, through the debounce effect. If the first test times out on `getByText('Urine')`, stop and report the output. Do not add a `{ timeout }` (the file's header, lines 6-18, explains why that lowers the budget).

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/api.testCatalog.test.ts src/forms-runtime/ReferencePicker.test.tsx src/forms-runtime/FormRuntime.test.tsx --testTimeout 30000`

Expected: the client test FAILS (`catalogSpecimensFor is not a function`). The first two narrowing tests and the FormRuntime test FAIL because `catalogSpecimensFor` is never called. `does not ask to narrow when nothing is chosen` PASSES already, and every existing test PASSES.

- [ ] **Step 3: Add the client**

In `apps/studio/src/api.ts`, directly after `downloadTestCatalogCsv` (line 2536) add:

```ts
/** The specimens at least one of these tests accepts, by this lab's lists (test catalog S4). The server
 *  ignores codings that are not catalog tests, so an empty list means the picker does not narrow. */
export const catalogSpecimensFor = (
  tests: { system: string; code: string }[],
): Promise<{ system: string; code: string; display: string | null }[]> =>
  authFetch('/api/test-catalog/specimens', jbody({ tests }, 'POST'))
    .then((r) => okJson<{ specimens: { system: string; code: string; display: string | null }[] }>(r, 'narrow specimens'))
    .then((b) => b.specimens);
```

- [ ] **Step 4: Narrow the picker**

In `apps/studio/src/forms-runtime/ReferencePicker.tsx`:

1. Change lines 2-3 to:

```ts
import { isCodingAnswer, type CodingAnswer, type EntityAnswer, type FormField } from '@openldr/forms/pure';
import { catalogSpecimensFor, referenceSearch, referenceSearchPreview, type ReferenceSearchResponse } from '@/api';
```

2. Directly after `toRows` (it ends at line 23) add:

```ts
function codingRow(c: { system: string; code: string; display: string | null }): Row {
  return { key: `${c.system}|${c.code}`, display: c.display ?? c.code, secondary: c.code, value: { system: c.system, code: c.code, display: c.display } };
}

/** The coding answers in a field's value, one or many. */
function codingsIn(value: unknown): CodingAnswer[] {
  return (Array.isArray(value) ? value : [value]).filter(isCodingAnswer);
}
```

3. Add the prop. Change the destructuring on line 43 to include `dependsOnValue`:

```ts
export function ReferencePicker({ field, formDefinitionId, preview = false, multiple, value, onChange, dependsOnValue }: {
```

and add to the props type, after `onChange: ...` (line 61):

```ts
  /**
   * The answer of the field this one depends on (`referenceDependsOn`). When it holds catalog tests,
   * the picker offers only the specimens at least one of them accepts (test catalog S4).
   */
  dependsOnValue?: unknown;
```

4. After `const requestIdRef = useRef(0);` (line 71) add:

```ts
  // Test catalog S4: a field that depends on the order's tests offers only the specimens at least one
  // chosen test accepts. The server decides which answers are catalog tests. An empty answer, or a
  // failed request, means no narrowing, so the picker never ends up offering nothing.
  const [narrowTo, setNarrowTo] = useState<Row[] | null>(null);
  const dependsOn = codingsIn(dependsOnValue);
  const dependsOnKey = dependsOn.map((c) => `${c.system}|${c.code}`).join('\n');
  useEffect(() => {
    if (!dependsOnKey) { setNarrowTo(null); return; }
    let cancelled = false;
    catalogSpecimensFor(dependsOn.map(({ system, code }) => ({ system, code })))
      .then((rows) => { if (!cancelled) setNarrowTo(rows.length > 0 ? rows.map(codingRow) : null); })
      .catch(() => { if (!cancelled) setNarrowTo(null); });
    return () => { cancelled = true; };
    // Keyed on the chosen codes, not on the answer object, which is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependsOnKey]);
```

5. In `search` (lines 80-100), directly after `if (unavailable) return;` add:

```ts
    if (narrowTo) {
      // The narrowed list is a few codes, so it is filtered here, from the first keystroke.
      const needle = q.trim().toLowerCase();
      setRows(needle
        ? narrowTo.filter((r) => r.display.toLowerCase().includes(needle) || (r.secondary ?? '').toLowerCase().includes(needle))
        : narrowTo);
      setError(null);
      setActive(-1);
      return;
    }
```

and change its dependency list from `[field, formDefinitionId, preview, unavailable]` to `[field, formDefinitionId, preview, unavailable, narrowTo]`.

6. Change the listbox condition (line 202) from `{open && query.trim().length >= 2 && (` to:

```tsx
      {open && (narrowTo !== null || query.trim().length >= 2) && (
```

- [ ] **Step 5: Pass the depends-on answer down**

In `apps/studio/src/forms-runtime/FormRuntime.tsx`:

1. In `FieldRow`'s `<FieldControl ... />` (lines 408-416), add after `onChange={(v) => onChange(field.id, v)}`:

```tsx
          dependsOnValue={field.referenceDependsOn ? answers[field.referenceDependsOn] : undefined}
```

2. In `FieldControl`'s parameters (lines 425-441), add `dependsOnValue,` to the destructuring and `dependsOnValue?: unknown;` to its type.

3. In the `<ReferencePicker ... />` of the reference case (lines 584-591), add after `onChange={(v) => onChange(v)}`:

```tsx
            dependsOnValue={dependsOnValue}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd apps/studio && npx vitest run src/api.testCatalog.test.ts src/forms-runtime --testTimeout 30000`

Expected: PASS, every test in those files.

- [ ] **Step 7: Typecheck the package**

Run: `cd apps/studio && npx tsc --noEmit -p . > "$TEMP/s4-t8-tc.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0`.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.testCatalog.test.ts apps/studio/src/forms-runtime/ReferencePicker.tsx apps/studio/src/forms-runtime/ReferencePicker.test.tsx apps/studio/src/forms-runtime/FormRuntime.tsx apps/studio/src/forms-runtime/FormRuntime.test.tsx
git commit -m "feat(studio): narrow the specimen picker to the tests chosen on an order" -m "A reference field whose Depends On names another field now receives that field's answer. When the answer holds catalog tests, the picker asks the server which specimens they accept and offers only those, listed on focus and filtered as the operator types. With no tests chosen, none that lists specimens, or a failed request, it searches the whole list as before."
```

---

### Task 9: docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/forms.md:65`, `fr/forms.md:26`, `pt/forms.md:26`
- Modify: `apps/web/src/docs/0.1.8/forms.md:44`, `:146`, `:247`
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/test-catalog.md` (append)
- Modify: `apps/web/src/docs/0.1.8/test-catalog.md` (after `:13`, `:25`, `:37`)

No new docs test. Every page exists, and `src/docs` in each app already checks they render.

- [ ] **Step 1: Depends On is used now**

The same sentence appears in the studio and web `forms.md` for each language. Replace it in both files.

English (studio `en/forms.md:65`, web `forms.md:44`): replace

> **Depends On** and **Searchable** are saved and exported, but data entry does not use them yet.

with

> **Searchable** is saved and exported, but data entry does not use it yet. **Depends On** is used in one case: a field that depends on a Tests field bound to this lab's test list offers only the specimens the chosen tests accept (see Test catalog). Any other **Depends On** setting is saved but not used.

French (studio `fr/forms.md:26`, web `forms.md:146`): replace

> **Depends On** et **Searchable** sont enregistrés et exportés, mais la saisie ne les utilise pas encore.

with

> **Searchable** est enregistré et exporté, mais la saisie ne l'utilise pas encore. **Depends On** sert dans un seul cas : un champ qui dépend d'un champ Tests lié à la liste des examens de ce laboratoire ne propose que les prélèvements acceptés par les examens choisis (voir Catalogue des examens). Tout autre réglage **Depends On** est enregistré mais pas utilisé.

Portuguese (studio `pt/forms.md:26`, web `forms.md:247`): replace

> **Depends On** e **Searchable** são guardados e exportados, mas a introdução de dados ainda não os usa.

with

> **Searchable** é guardado e exportado, mas a introdução de dados ainda não o usa. **Depends On** é usado num só caso: um campo que depende de um campo Tests ligado à lista de exames deste laboratório só oferece as amostras aceites pelos exames escolhidos (ver Catálogo de exames). Qualquer outra definição **Depends On** é guardada mas não usada.

- [ ] **Step 2: The in-app guides**

Append to `apps/studio/src/docs/0.1.8/en/test-catalog.md`:

```markdown

## The Lab order

The Lab order's **Tests** field lists this lab's tests: the catalog tests switched on here, under the local name when one is set. A retired test drops off the list. Switch tests on before anyone takes an order: the field is required, so an empty list lets no order through.

The **Specimen Type** field then offers only the specimens at least one chosen test accepts, using this lab's narrower list where it set one. With no tests chosen, or none that lists specimens, it offers the whole specimen list as before.

A submitted order lists each test's LOINC code first, when the test has one, and then its catalog code. Reports that read an order's first code keep matching LOINC. A test with no LOINC code is sent under its catalog code.

An install whose Lab order was edited in the form builder keeps its own Tests field. To use this list, set the field's value set to `urn:openldr:valueset:lab-tests` in the builder. From the command line, `openldr terminology expand urn:openldr:valueset:lab-tests` prints the list the Tests field offers.
```

Append to `apps/studio/src/docs/0.1.8/fr/test-catalog.md`:

```markdown

## La demande d'examens

Le champ **Tests** de la demande d'examens liste les examens de ce laboratoire : les examens du catalogue activés ici, sous le nom local s'il y en a un. Un examen retiré quitte la liste. Activez des examens avant toute demande : le champ est obligatoire, et une liste vide ne laisse passer aucune demande.

Le champ **Specimen Type** ne propose alors que les prélèvements acceptés par au moins un examen choisi, selon la liste plus courte de ce laboratoire s'il en a fixé une. Sans examen choisi, ou si aucun ne liste de prélèvements, il propose toute la liste des prélèvements, comme avant.

Une demande envoyée donne d'abord le code LOINC de chaque examen, s'il en a un, puis son code du catalogue. Les rapports qui lisent le premier code d'une demande continuent de trouver LOINC. Un examen sans code LOINC est envoyé sous son code du catalogue.

Une installation dont la demande d'examens a été modifiée dans l'éditeur de formulaires garde son propre champ Tests. Pour utiliser cette liste, choisissez le jeu de valeurs `urn:openldr:valueset:lab-tests` pour ce champ dans l'éditeur. En ligne de commande, `openldr terminology expand urn:openldr:valueset:lab-tests` affiche la liste que propose le champ Tests.
```

Append to `apps/studio/src/docs/0.1.8/pt/test-catalog.md`:

```markdown

## O pedido de exames

O campo **Tests** do pedido de exames lista os exames deste laboratório: os exames do catálogo ativados aqui, com o nome local quando existe. Um exame retirado sai da lista. Ative exames antes de qualquer pedido: o campo é obrigatório, e uma lista vazia não deixa passar nenhum pedido.

O campo **Specimen Type** oferece então só as amostras aceites por pelo menos um exame escolhido, pela lista mais curta deste laboratório quando a definiu. Sem exames escolhidos, ou se nenhum lista amostras, oferece toda a lista de amostras, como antes.

Um pedido enviado indica primeiro o código LOINC de cada exame, quando o tem, e depois o código do catálogo. Os relatórios que leem o primeiro código de um pedido continuam a encontrar LOINC. Um exame sem código LOINC é enviado com o código do catálogo.

Uma instalação cujo pedido de exames foi alterado no editor de formulários mantém o seu próprio campo Tests. Para usar esta lista, escolha o conjunto de valores `urn:openldr:valueset:lab-tests` para esse campo no editor. Na linha de comandos, `openldr terminology expand urn:openldr:valueset:lab-tests` mostra a lista que o campo Tests oferece.
```

- [ ] **Step 3: The web page**

In `apps/web/src/docs/0.1.8/test-catalog.md`, add a paragraph after each language's import paragraph.

After the English paragraph that starts `Import a national list` (line 13):

```markdown

The Lab order's Tests field lists the catalog tests switched on at this lab, under their local names, and its Specimen Type field offers only the specimens the chosen tests accept. A submitted order lists each test's LOINC code first, then its catalog code, so reports that read an order's first code keep matching LOINC. Switch tests on before taking orders: an empty list lets no order through.
```

After the French paragraph that starts `Importez une liste nationale` (line 25):

```markdown

Le champ Tests de la demande d'examens liste les examens du catalogue activés dans ce laboratoire, sous leurs noms locaux, et son champ Specimen Type ne propose que les prélèvements acceptés par les examens choisis. Une demande envoyée donne d'abord le code LOINC de chaque examen, puis son code du catalogue, pour que les rapports qui lisent le premier code d'une demande trouvent toujours LOINC. Activez des examens avant de prendre des demandes : une liste vide ne laisse passer aucune demande.
```

After the Portuguese paragraph that starts `Importe uma lista nacional` (line 37):

```markdown

O campo Tests do pedido de exames lista os exames do catálogo ativados neste laboratório, com os nomes locais, e o campo Specimen Type só oferece as amostras aceites pelos exames escolhidos. Um pedido enviado indica primeiro o código LOINC de cada exame e depois o código do catálogo, para que os relatórios que leem o primeiro código de um pedido continuem a encontrar LOINC. Ative exames antes de receber pedidos: uma lista vazia não deixa passar nenhum pedido.
```

- [ ] **Step 4: Run the docs tests**

Run: `cd apps/studio && npx vitest run src/docs --testTimeout 30000`

Run: `cd apps/web && npx vitest run src/docs --testTimeout 30000`

Expected: PASS in both.

- [ ] **Step 5: Check the added lines for em dashes**

Run: `git diff -- apps/studio/src/docs apps/web/src/docs | grep '^+' | grep -c $'\xe2\x80\x94'`

Expected: `0`. The byte escape is the em dash (U+2014). The files already hold em dashes of their own, so check the diff, not the files.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/forms.md apps/studio/src/docs/0.1.8/fr/forms.md apps/studio/src/docs/0.1.8/pt/forms.md apps/web/src/docs/0.1.8/forms.md apps/studio/src/docs/0.1.8/en/test-catalog.md apps/studio/src/docs/0.1.8/fr/test-catalog.md apps/studio/src/docs/0.1.8/pt/test-catalog.md apps/web/src/docs/0.1.8/test-catalog.md
git commit -m "docs(test-catalog): document the Lab order ordering from the catalog" -m "The in-app guide and the web page, in English, French and Portuguese, say that the Lab order's Tests field lists the tests switched on at this lab, that the specimen picker narrows to the chosen tests, that an order leads with LOINC, and that tests must be switched on before orders can be taken. The forms docs now say Depends On is used for that one case."
```

---

### Task 10: gate and report

**Files:** none changed.

- [ ] **Step 1: Re-check the migration number**

Run: `git fetch origin --prune; for b in $(git branch -a --format='%(refname:short)' | grep -v HEAD); do git ls-tree -r --name-only $b -- packages/db/src/migrations/internal/ | grep -E '/10[5-9]_' | sed "s|^|$b: |"; done`

Expected: only this branch's `105_lab_order_test_catalog.*`. Also ask the operator whether a branch on the Linux machine claims 105.

- [ ] **Step 2: Run the forced gate**

Run: `pnpm turbo run typecheck --force --concurrency=4 > "$TEMP/s4-gate-tc.txt" 2>&1; echo "exit=$?"`

Run: `pnpm turbo run test --force --concurrency=4 --continue > "$TEMP/s4-gate-test.txt" 2>&1; echo "exit=$?"`

Run: `cd apps/server && npx eslint src > "$TEMP/s4-gate-lint.txt" 2>&1; echo "exit=$?"`

Expected: `exit=0` three times. On a test failure, grep `$TEMP/s4-gate-test.txt` for `Test timed out` and `FAIL`, then re-run that package alone before blaming a change.

- [ ] **Step 3: Report, then stop**

Report to the operator:

1. The gate's three exit codes, and each package's test count from the turbo summary.
2. What each layer proves:
   - `105_lab_order_test_catalog.test.ts` (pg-mem): the lab list's row (immutable, empty, no change_log row), the Lab order rewrite by exact match, the marker and `down()`. Not boot order: check `kysely_migration` after a real boot.
   - `extraction.test.ts`: an ordered test keeps its own system, the context's coding goes in front, and old LOINC answers are unchanged. Pure.
   - `forms.test.ts`, `starter-packs.test.ts`: the sample equals 105's snapshot, a builder save keeps both shapes, and the pack follows.
   - `test-catalog.test.ts` (pg-mem): the lab list worked out when read (switched on, active, local names, empty when nothing is on, kept through a pull), the submit check against it, the specimen union, the LOINC codings.
   - Route tests: the specimens route's wire shape and its `forms.view` gate, and a submitted order leading with LOINC.
   - Studio tests: the client call, the picker narrowing and falling back, and `FormRuntime` handing the answer down.
3. **HONEST NON-PROOF**, each with what would prove it:
   - The whole Lab order in a browser: switch tests on, pick them, see the specimens narrow, submit, and read `lab_requests.panel_code`. The live check after merging would.
   - The picker at 375px. The live check would. A real phone was not used.
   - Migration 105 on a real Postgres boot, against a stored Lab order. The dev database's own boot after the merge would.
   - `openldr terminology expand urn:openldr:valueset:lab-tests` against Postgres.
   - The live check needs `AUTH_DEV_BYPASS`, the dev servers, and scratch tests switched on. Say so before starting it.
4. Anything skipped or changed from this plan, and why.

Then ask the operator before merging, pushing, or running the live check. After a merge to `main`, run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json` (AGENTS.md section 6, item 5).
