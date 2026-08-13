# Manual National Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator register a facility by hand against a national register, keyed the same way
the CSV importer keys it, and make the Edit sheet usable on an imported facility.

**Architecture:** Every PUT-side guard is rewritten to key off *what this submission changed*, not
*what it submitted* — the studio sheet resubmits every field on every edit, which is what disarmed
the existing submitted-only scoping. POST derives the row id from the register and national code when
both are present, gated by the same register check every import door already uses, and refuses a
collision instead of reaching an `onConflict … doUpdateSet` upsert. Migration 085 relaxes the two
required markers the import path cannot satisfy and adds the two fields that make manual national
registration possible at all.

**Tech Stack:** TypeScript, Fastify, Kysely, Zod, Vitest, React 18 + shadcn/Radix, pg-mem (internal
migration tests), Postgres.

## Global Constraints

- **Task 2 MUST land before Task 5.** Task 5 makes the server enforce required. Task 2 is what stops
  `localCode` and `region` being required. In the other order, every imported facility becomes
  uneditable — the exact trap named in the audit.
- Migration number is **085**. 084 is the highest on `main`; `origin/claude/cdr-turnaround-fix-2hzjh8`
  adds none past it. **Re-check before writing it** — a gap blocks boot and pg-mem cannot catch it.
- Never add a `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailer. The operator is the sole
  contributor.
- `apps/server` is the only package with real lint. It enforces `return`/`await` on `reply.send`.
- Full gate is `pnpm turbo run test`. **Never pipe turbo through `tail`** — it truncates the failure
  list. A gate failure is usually a timeout: grep for `Test timed out` and re-run that package alone.
- pg-mem is not Postgres. It cannot demonstrate the partial unique index on
  `(national_system, national_code)`. Any claim about collision behaviour needs real Postgres or it
  is unproven.
- Actions in `apps/studio` go in a `⋯` `DropdownMenu`. Form fields are label-left / input-right.
- Commit after every task. Do not push and do not open a PR unless asked.

---

## File Structure

**Modified:**
- `apps/server/src/facilities-routes.ts` — POST id derivation, three PUT guards, one shared
  `changedCoreKeys` helper.
- `apps/server/src/facilities-routes.test.ts` — route tests for all of the above.
- `packages/forms/src/samples/forms.ts` — the Facility sample form, kept in lockstep with 085.
- `packages/forms/src/samples/forms.test.ts` — pins the sample against 085's snapshot.
- `apps/studio/src/facilities/FacilityDialog.tsx` — feed register sources to the national-system
  field's suggestions.
- `apps/studio/src/docs/0.1.0/en/facilities.md`, `apps/web/src/docs/0.1.0/facilities.md`.

**Created:**
- `packages/db/src/migrations/internal/085_facility_national_code_field.ts`
- `packages/db/src/migrations/internal/085_facility_national_code_field.test.ts`

---

### Task 1: PUT checks a controlled field only when it changed

Closes F3. The guard at `facilities-routes.ts:585` was written to check only fields the caller
submitted, so an unrelated edit would not be blocked by an old value. The studio sheet defeats that:
`seedAnswers` loads every field off the facility and `handleSubmit` posts them all back, so `level`
counts as submitted on every edit. Compare against `before` instead.

**Files:**
- Modify: `apps/server/src/facilities-routes.ts:585-604` (the guard), `:1334` (the PUT call site)
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Produces: `changedCoreKeys(record: Partial<FacilityRecord>, before: FacilityRecord): Set<string>` —
  used again by Tasks 3 and 5.
- Produces: `controlledFieldsError(ctx, record, before?)` — the third parameter is new and optional.
  POST calls it with two arguments, unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/facilities-routes.test.ts`, inside the top-level
`describe('facilities routes', ...)`. `fakeCtx()`'s terminology double answers `getByUrl` with a
value set, so the guard's expansion path runs; extend that double locally in this describe block so
`level` has a canonical expansion that `Health Centre` is not in.

```ts
describe('Task 1: an unchanged controlled value does not block an edit', () => {
  // A ctx whose `level` value set expands to exactly one canonical code, so any other string is
  // `unmapped` — the same state an imported facility is in before its vocabulary is mapped.
  function ctxWithLevelValueSet() {
    const ctx = fakeCtx();
    ctx.terminology.admin.valueSets = {
      getByUrl: async () => ({ id: 'vs-level' }),
      expand: async () => ({ codes: [{ code: 'health-center' }] }),
    };
    ctx.terminology.admin.termMappings = { listOutgoing: async () => [] };
    return ctx;
  }

  const importedBody = {
    answers: { f1: 'LAB01', f2: 'Commando Urban', f3: 'Copperbelt', f5: 'Health Centre' },
    formSchemaId: 'form-sample-facility',
    formVersion: 1,
  };

  it('lets an edit through when the raw level is resubmitted unchanged', async () => {
    const ctx = ctxWithLevelValueSet();
    const app = await appWith(ctx);
    // Seed the row directly: POST would refuse the raw level, which is the point of this test.
    ctx.__rows.push({
      id: 'fac-1', localCode: 'LAB01', name: 'Commando Urban', region: 'Copperbelt',
      level: 'Health Centre', extras: {}, source: 'import',
    });
    const res = await app.inject({
      method: 'PUT', url: '/api/facilities/fac-1',
      payload: { ...importedBody, answers: { ...importedBody.answers, f2: 'Commando Urban Clinic' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Commando Urban Clinic');
    expect(res.json().level).toBe('Health Centre');
  });

  it('still refuses when the edit CHANGES the level to another unrecognised value', async () => {
    const ctx = ctxWithLevelValueSet();
    const app = await appWith(ctx);
    ctx.__rows.push({
      id: 'fac-1', localCode: 'LAB01', name: 'Commando Urban', region: 'Copperbelt',
      level: 'Health Centre', extras: {}, source: 'import',
    });
    const res = await app.inject({
      method: 'PUT', url: '/api/facilities/fac-1',
      payload: { ...importedBody, answers: { ...importedBody.answers, f5: 'District Hospital' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("level 'District Hospital'");
  });
});
```

`FORM_FIELDS` has no field mapping `level`. Add one at the top of the file so these payloads reach
the column:

```ts
const FORM_FIELDS = [
  { id: 'f1', apiProperty: 'localCode' },
  { id: 'f2', apiProperty: 'name' },
  { id: 'f3', apiProperty: 'region' },
  { id: 'f4', apiProperty: 'catchmentPop' },
  { id: 'f5', apiProperty: 'level' },
];
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/server test -- facilities-routes.test.ts -t "Task 1"
```

Expected: the first test FAILS with 400 and `level 'Health Centre' is not a recognised canonical
level value`. The second PASSES already (it is the guard's existing behaviour) — that is correct, it
is the regression pin.

- [ ] **Step 3: Add the shared helper**

Insert immediately above `controlledFieldsError` in `apps/server/src/facilities-routes.ts`:

```ts
/**
 * Core columns whose submitted value DIFFERS from what is already stored.
 *
 * ⛔ Every PUT-side guard below keys off THIS, never off mere presence. The Edit sheet seeds every
 * field off the facility (`seedAnswers`, apps/studio/src/facilities/FacilityDialog.tsx) and posts
 * them all back on Save, so "the caller submitted it" is true of every field on every edit. That is
 * what disarmed the submitted-only scoping `controlledFieldsError` was originally written with: a
 * value the operator never touched was indistinguishable from one they had just typed.
 *
 * `undefined` means the submission carried no answer for that field at all and is never a change —
 * a deliberate BLANK arrives through `clearedCoreKeys`, not here. Empty string and null normalise
 * together so a blanked-then-restored field does not read as changed.
 *
 * ⚠ `latitude`/`longitude` are numbers here and may be strings off the driver, so they can read as
 * changed when they are not. Harmless: no caller of this function guards a numeric column.
 */
function changedCoreKeys(record: Partial<FacilityRecord>, before: FacilityRecord): Set<string> {
  const norm = (v: unknown) => (v === null || v === undefined || v === '' ? null : v);
  const stored = before as unknown as Record<string, unknown>;
  const submitted = record as Record<string, unknown>;
  const changed = new Set<string>();
  for (const key of Object.keys(submitted)) {
    if (!CORE_FACILITY_KEYS.has(key)) continue;
    if (submitted[key] === undefined) continue;
    if (norm(submitted[key]) !== norm(stored[key])) changed.add(key);
  }
  return changed;
}
```

- [ ] **Step 4: Scope the guard to changed fields**

Replace the signature and the `submitted` filter in `controlledFieldsError`:

```ts
async function controlledFieldsError(
  ctx: AppContext, record: Partial<FacilityRecord>, before?: FacilityRecord,
): Promise<{ error: string } | undefined> {
  // POST passes no `before` — there is nothing to have changed FROM, so every submitted value is
  // checked. PUT passes one, and only a value this submission actually moved is checked; see
  // `changedCoreKeys` for why presence is not a usable signal from the studio client.
  const changed = before ? changedCoreKeys(record, before) : null;
  const submitted = CONTROLLED_FIELDS.filter(
    (field) => typeof record[field] === 'string' && (record[field] as string).length > 0
      && (changed === null || changed.has(field)),
  );
  if (submitted.length === 0) return undefined;
```

Leave the rest of the function untouched. Then update the PUT call site at `:1334`:

```ts
    const controlledErr = await controlledFieldsError(ctx, record, before);
```

Rewrite the stale comment above that call — it currently claims the check is scoped to what the
submission sets, which was never true from this client:

```ts
    // Task 6 (B1), rescoped: only a level/status/country this submission actually CHANGED is
    // checked. The sheet resubmits every field it seeded, so scoping on "submitted" checked every
    // value on every edit — which made an imported facility carrying an unmapped raw value
    // uneditable until that value was mapped, and mapping is optional by design.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/server test -- facilities-routes.test.ts
```

Expected: both Task 1 tests PASS, and every pre-existing test in the file still passes.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "fix(facilities): the vocabulary guard checks only what an edit changed"
```

---

### Task 2: Migration 085 — relax the two required markers, add the national code fields

Closes F1 and the client half of F2. Follows 071/072/073's shape-matching discipline exactly: rewrite
only a form row that deep-equals 073's snapshot, so a form an operator has edited is never touched.

**Files:**
- Create: `packages/db/src/migrations/internal/085_facility_national_code_field.ts`
- Create: `packages/db/src/migrations/internal/085_facility_national_code_field.test.ts`
- Modify: `packages/forms/src/samples/forms.ts:28-` (the Facility sample's `fields`)
- Modify: `packages/forms/src/samples/forms.test.ts:160-176`

**Interfaces:**
- Produces: `export const BOUND_FIELDS_SNAPSHOT: readonly unknown[]` — the 11-field Facility form.
  `packages/forms/src/samples/forms.test.ts` pins the sample against it.

- [ ] **Step 1: Confirm 085 is still free**

```bash
ls packages/db/src/migrations/internal/ | grep -E '^08[4-9]_' | grep -v test
```

Expected: `084_report_design_versions.ts` and nothing higher. If anything else appears, use the next
free number and rename the files and the test's `describe` accordingly.

- [ ] **Step 2: Write the failing migration test**

Create `packages/db/src/migrations/internal/085_facility_national_code_field.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('085_facility_national_code_field', () => {
  it('makes the local code and region optional and adds the two national fields', async () => {
    const db = await makeMigratedDb();
    const row = await db
      .selectFrom('form_definitions' as never)
      .select(['schema'] as never)
      .where('name' as never, '=', 'Facility')
      .executeTakeFirstOrThrow();
    const schema = typeof (row as any).schema === 'string' ? JSON.parse((row as any).schema) : (row as any).schema;
    const byId = Object.fromEntries(schema.fields.map((f: any) => [f.id, f]));

    expect(byId['fld-fac-local-code'].required).toBe(false);
    expect(byId['fld-fac-local-code'].displayLabel).toBe('Local code');
    expect(byId['fld-fac-local-code'].cardinality.min).toBe(0);
    expect(byId['fld-fac-region'].required).toBe(false);
    expect(byId['fld-fac-region'].cardinality.min).toBe(0);

    expect(byId['fld-fac-national-code'].apiProperty).toBe('nationalCode');
    expect(byId['fld-fac-national-code'].required).toBe(false);
    expect(byId['fld-fac-national-system'].apiProperty).toBe('nationalSystem');
    expect(byId['fld-fac-national-system'].required).toBe(false);
  });

  it('leaves a form an operator has edited alone', async () => {
    const db = await makeMigratedDb();
    // Simulate an operator edit by writing a shape that matches no snapshot, then re-running up().
    const edited = { fields: [{ id: 'fld-fac-name', displayLabel: 'Facility name' }] };
    await db
      .updateTable('form_definitions' as never)
      .set({ schema: JSON.stringify(edited) } as never)
      .where('name' as never, '=', 'Facility')
      .execute();
    const { up } = await import('./085_facility_national_code_field');
    await up(db as never);
    const row = await db
      .selectFrom('form_definitions' as never)
      .select(['schema'] as never)
      .where('name' as never, '=', 'Facility')
      .executeTakeFirstOrThrow();
    const schema = typeof (row as any).schema === 'string' ? JSON.parse((row as any).schema) : (row as any).schema;
    expect(schema.fields).toHaveLength(1);
    expect(schema.fields[0].displayLabel).toBe('Facility name');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm --filter @openldr/db test -- 085_facility_national_code_field
```

Expected: FAIL — the module does not exist (`Cannot find module './085_facility_national_code_field'`).

- [ ] **Step 4: Write the migration**

Create `packages/db/src/migrations/internal/085_facility_national_code_field.ts`:

```ts
import { type Kysely } from 'kysely';

// Facility form: the national code becomes enterable, and the two markers the CSV import path can
// never satisfy stop being required.
//
// `local_code` is OURS and `national_code` is THEIRS (packages/db/src/facility-registry-store.ts).
// A CSV import writes only the national one, so a form that required the local one — and labelled it
// with the generic name "Facility code" — meant an imported facility could not be saved from the
// sheet at all, while the Facilities table beside it showed a code via `localCode ?? nationalCode`.
// `region` goes the same way for the same reason: a register with no tier between province and
// district cannot supply one.
//
// Field literals are INLINED, not imported from @openldr/forms — packages/db must not depend on it
// (@openldr/forms already depends on packages/db). Same reasoning as 071's NEW_FIELDS and 073's
// COUNTRY_FIELD.

/** 073's shipped shape, copied verbatim — not imported from that module. Copied for the same reason
 *  073 copied 072's: nothing here may depend on another migration's array staying frozen. */
const PREV_BOUND_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    id: 'fld-fac-local-code', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:local' },
    displayLabel: 'Facility code', description: null, fieldType: 'identifier',
    required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' },
    apiProperty: 'localCode',
  },
  {
    id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 1,
    cardinality: { min: 1, max: '1' }, apiProperty: 'name',
  },
  {
    id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 2,
    cardinality: { min: 1, max: '1' }, apiProperty: 'country',
    valueSetUrl: 'urn:openldr:valueset:country',
  },
  {
    id: 'fld-fac-zone', fhirPath: 'address.district', displayLabel: 'Zone', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 3,
    cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
  },
  {
    id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 4,
    cardinality: { min: 1, max: '1' }, apiProperty: 'region',
  },
  {
    id: 'fld-fac-district', fhirPath: 'address.city', displayLabel: 'District', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 5,
    cardinality: { min: 1, max: '1' }, apiProperty: 'district',
  },
  {
    id: 'fld-fac-council', fhirPath: null, displayLabel: 'Council', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 6,
    cardinality: { min: 0, max: '1' }, apiProperty: 'council',
  },
  {
    id: 'fld-fac-status', fhirPath: 'status', displayLabel: 'Status', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 7,
    cardinality: { min: 1, max: '1' }, apiProperty: 'status',
    valueSetUrl: 'urn:openldr:valueset:location-status',
  },
  {
    id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 8,
    cardinality: { min: 1, max: '1' }, apiProperty: 'level',
    valueSetUrl: 'urn:openldr:valueset:facility-type',
  },
];

/** The 11-field Facility form this release ships. Exported so
 *  `packages/forms/src/samples/forms.test.ts` can pin the sample against it, as it already does for
 *  071/072/073. */
export const BOUND_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    // THEIRS, and the row's key material: `id = fac-sha256(nationalSystem|nationalCode)`
    // (packages/terminology/src/facility-csv.ts). Optional, because a lab-only facility never has
    // one. `urn:openldr:facility:national` is the discriminator 071's MFL ID field already used.
    id: 'fld-fac-national-code', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:national' },
    displayLabel: 'National code', description: null, fieldType: 'identifier',
    required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' },
    apiProperty: 'nationalCode',
  },
  {
    // `suggest`, fed by the install's registered facility registers (the studio wires that fetch).
    // Free entry is NOT the gate: POST resolves this through `resolveFacilityRegisterForImport` and
    // refuses an unregistered or deactivated register. `fhirPath: null` for the same reason
    // 073's council field carries one — no standard R4 Address or identifier element fits, and the
    // `ambiguous-fhir-path` lint rule skips falsy paths.
    id: 'fld-fac-national-system', fhirPath: null,
    displayLabel: 'Facility register', description: null, fieldType: 'suggest',
    required: false, enabled: true, order: 1, cardinality: { min: 0, max: '1' },
    apiProperty: 'nationalSystem',
  },
  {
    // Relabelled from "Facility code" and no longer required. The generic label is what made this
    // read as the same thing the Facilities table's CODE column shows, which falls back
    // `localCode ?? nationalCode`.
    id: 'fld-fac-local-code', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:local' },
    displayLabel: 'Local code', description: null, fieldType: 'identifier',
    required: false, enabled: true, order: 2, cardinality: { min: 0, max: '1' },
    apiProperty: 'localCode',
  },
  {
    id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 3,
    cardinality: { min: 1, max: '1' }, apiProperty: 'name',
  },
  {
    id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 4,
    cardinality: { min: 1, max: '1' }, apiProperty: 'country',
    valueSetUrl: 'urn:openldr:valueset:country',
  },
  {
    id: 'fld-fac-zone', fhirPath: 'address.district', displayLabel: 'Zone', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 5,
    cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
  },
  {
    // Optional: a register with no tier between province and district cannot supply one, and 3788
    // of 3788 rows in the Zambia MFL export have none.
    id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 6,
    cardinality: { min: 0, max: '1' }, apiProperty: 'region',
  },
  {
    id: 'fld-fac-district', fhirPath: 'address.city', displayLabel: 'District', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 7,
    cardinality: { min: 1, max: '1' }, apiProperty: 'district',
  },
  {
    id: 'fld-fac-council', fhirPath: null, displayLabel: 'Council', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 8,
    cardinality: { min: 0, max: '1' }, apiProperty: 'council',
  },
  {
    id: 'fld-fac-status', fhirPath: 'status', displayLabel: 'Status', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 9,
    cardinality: { min: 1, max: '1' }, apiProperty: 'status',
    valueSetUrl: 'urn:openldr:valueset:location-status',
  },
  {
    id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 10,
    cardinality: { min: 1, max: '1' }, apiProperty: 'level',
    valueSetUrl: 'urn:openldr:valueset:facility-type',
  },
];

/** Mirrors 071/072/073's MARKER_KEY discipline: a fresh install seeded after this release lands on
 *  exactly BOUND_FIELDS_SNAPSHOT too, content-identical to a row up() just rewrote, so down() needs
 *  a marker rather than a heuristic to tell them apart. */
const MARKER_KEY = '__migration085';

interface Migration085Marker {
  prevFields: readonly unknown[];
}

async function repointForm(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb
    .selectFrom('form_definitions')
    .select(['id', 'schema'])
    .where('name', '=', 'Facility')
    .execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous — never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Only rewrites a row that exactly matches 073's shipped shape. Anything else — already rewritten
  // by this migration, an operator's own edit, or a row that never reached 073's shape — is left
  // alone. Same discipline as 071/072/073.
  if (stableStringify(fields) !== stableStringify(PREV_BOUND_FIELDS_SNAPSHOT)) return;

  const marker: Migration085Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: BOUND_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };

  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function unrepointForm(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Facility').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration085Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await repointForm(db as Kysely<any>);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await unrepointForm(db as Kysely<any>);
}

/** Order-preserving, object-key-order-insensitive deep equality — copied from 071/072/073, not
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

- [ ] **Step 5: Run the migration test to verify it passes**

```bash
pnpm --filter @openldr/db test -- 085_facility_national_code_field
```

Expected: both tests PASS.

- [ ] **Step 6: Bring the sample form into lockstep**

`packages/forms/src/samples/forms.ts` seeds a fresh install and must land on exactly
`BOUND_FIELDS_SNAPSHOT`. Rewrite the Facility sample's `fields` array to the 11 fields above, in the
same order, keeping the file's existing `LOCAL_FACILITY_SYSTEM` constant for the local-code
discriminator and adding a sibling for the national one:

```ts
export const LOCAL_FACILITY_SYSTEM = 'urn:openldr:facility:local';
export const NATIONAL_FACILITY_SYSTEM = 'urn:openldr:facility:national';
```

Use `NATIONAL_FACILITY_SYSTEM` in `fld-fac-national-code`'s `fhirDiscriminator`, and
`LOCAL_FACILITY_SYSTEM` in `fld-fac-local-code`'s, exactly as the file does today. Every other
property must match the snapshot character for character — that lockstep is what
`forms.test.ts` pins.

- [ ] **Step 7: Update the sample's pins**

In `packages/forms/src/samples/forms.test.ts`, the admin-chain test at `:167-174` asserts
`required === true` for region. Split it:

```ts
  it('binds the admin-chain fields to `suggest`, not free text or a ValueSet', () => {
    for (const id of ['fld-fac-zone', 'fld-fac-region', 'fld-fac-district']) {
      const f = facility().fields.find((x) => x.id === id)!;
      expect(f.fieldType, `${id}.fieldType`).toBe('suggest');
      expect(f.valueSetUrl, `${id}.valueSetUrl`).toBeUndefined();
    }
  });

  it('leaves region OPTIONAL — a register with no tier between province and district has none', () => {
    const region = facility().fields.find((f) => f.id === 'fld-fac-region')!;
    expect(region.required).toBe(false);
    for (const id of ['fld-fac-zone', 'fld-fac-district']) {
      expect(facility().fields.find((f) => f.id === id)!.required, `${id}.required`).toBe(true);
    }
  });

  it('offers both codes, neither required, with the national one first', () => {
    const fields = facility().fields;
    const national = fields.find((f) => f.id === 'fld-fac-national-code')!;
    const local = fields.find((f) => f.id === 'fld-fac-local-code')!;
    expect(national.apiProperty).toBe('nationalCode');
    expect(national.required).toBe(false);
    expect(local.apiProperty).toBe('localCode');
    expect(local.displayLabel).toBe('Local code');
    expect(local.required).toBe(false);
    expect(national.order).toBeLessThan(local.order);
  });
```

- [ ] **Step 8: Run both packages' tests**

```bash
pnpm --filter @openldr/forms test && pnpm --filter @openldr/db test -- 085_facility_national_code_field
```

Expected: PASS. If `forms.test.ts` has another snapshot pin that now fails, it is comparing against
073's array — repoint it at 085's `BOUND_FIELDS_SNAPSHOT` import, do not weaken the assertion.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/migrations/internal/085_facility_national_code_field.ts packages/db/src/migrations/internal/085_facility_national_code_field.test.ts packages/forms/src/samples/forms.ts packages/forms/src/samples/forms.test.ts
git commit -m "feat(facilities): the Facility form carries the national code, and stops requiring what an import cannot supply"
```

---

### Task 3: PUT refuses a change to the national code or its register

The national code is the row's key material. PUT updates by id and does not re-derive it, so an edit
that moved either value would leave the row filed under an id its own code no longer produces.

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` — PUT handler, after the has-a-code check at `:1325`
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `changedCoreKeys` from Task 1.

- [ ] **Step 1: Write the failing tests**

```ts
describe('Task 3: national identity is immutable on an edit', () => {
  const seeded = {
    id: 'fac-1', localCode: null, nationalSystem: 'urn:openldr:facility-register:mfl',
    nationalCode: '100', name: 'Commando Urban', extras: {}, source: 'import',
  };
  const editBody = (answers: Record<string, unknown>) => ({
    answers, formSchemaId: 'form-sample-facility', formVersion: 1,
  });

  it('allows an edit that resubmits the same national code', async () => {
    const ctx = fakeCtx();
    ctx.__rows.push({ ...seeded });
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'PUT', url: '/api/facilities/fac-1',
      payload: editBody({ f2: 'Commando Urban Clinic', f6: '100', f7: 'urn:openldr:facility-register:mfl' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Commando Urban Clinic');
  });

  it('refuses an edit that changes the national code', async () => {
    const ctx = fakeCtx();
    ctx.__rows.push({ ...seeded });
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'PUT', url: '/api/facilities/fac-1',
      payload: editBody({ f2: 'Commando Urban', f6: '200', f7: 'urn:openldr:facility-register:mfl' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('national code cannot be changed');
  });

  it('refuses an edit that changes the register', async () => {
    const ctx = fakeCtx();
    ctx.__rows.push({ ...seeded });
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'PUT', url: '/api/facilities/fac-1',
      payload: editBody({ f2: 'Commando Urban', f6: '100', f7: 'urn:openldr:facility-register:other' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('facility register cannot be changed');
  });
});
```

Extend `FORM_FIELDS` so these answers reach the columns:

```ts
  { id: 'f6', apiProperty: 'nationalCode' },
  { id: 'f7', apiProperty: 'nationalSystem' },
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @openldr/server test -- facilities-routes.test.ts -t "Task 3"
```

Expected: the first PASSES, the second and third FAIL with 200 instead of 400.

- [ ] **Step 3: Add the guard**

In the PUT handler, immediately after the `facility_registry_has_a_code` check that ends at `:1328`:

```ts
    // The national code and its register are this row's identity: the importer derives
    // `id = fac-sha256(nationalSystem|nationalCode)` (`idFor`, packages/terminology/src/facility-csv.ts)
    // and this handler updates BY id without re-deriving it. An edit that moved either value would
    // leave the row filed under an id its own code no longer produces — the next import of that
    // register would not find it, and would either collide on
    // `facility_registry_national_unique` or insert a second row for the same facility.
    //
    // Re-keying a live row is deliberately NOT attempted here: `facility_map.registry_id`,
    // `facility_concept_projection`, and any mapping authored against the projected code all point
    // at the id. That is its own slice. The accepted cost is that a facility created without a
    // national code can never acquire one — it must be deleted and recreated.
    const identityChanged = changedCoreKeys(record, before);
    if (identityChanged.has('nationalCode') || cleared.has('nationalCode')) {
      reply.code(400);
      return { error: "a facility's national code cannot be changed on an existing facility; it is part of the facility's identity" };
    }
    if (identityChanged.has('nationalSystem') || cleared.has('nationalSystem')) {
      reply.code(400);
      return { error: "a facility's facility register cannot be changed on an existing facility; it is part of the facility's identity" };
    }
```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm --filter @openldr/server test -- facilities-routes.test.ts
```

Expected: all three Task 3 tests PASS, no pre-existing test regresses.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "fix(facilities): an edit cannot move a facility's national code or register"
```

---

### Task 4: POST derives the id from the register and national code

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` — imports, POST handler at `:1204-1216`
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `idFor(nationalSystem: string, nationalCode: string): string` from `@openldr/terminology`
  (already a direct dependency of `apps/server`), and `registerSources` /
  `resolveFacilityRegisterForImport`, both already in scope at `facilities-routes.ts:694`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('Task 4: a manual create keys the same way an import does', () => {
  function ctxWithRegister() {
    const ctx = fakeCtx();
    // `registerSources` is built over ctx.internalDb at route registration. Answer its lookup
    // directly rather than through the Kysely double — this test is about the ROUTE's derivation,
    // and the store's own SQL is covered in packages/db.
    ctx.__registerSources = {
      getByUrl: async (url: string) =>
        (url === 'urn:openldr:facility-register:mfl' ? { url, name: 'MFL', active: true } : undefined),
    };
    return ctx;
  }

  const nationalBody = {
    answers: { f2: 'Commando Urban', f6: '100', f7: 'urn:openldr:facility-register:mfl' },
    formSchemaId: 'form-sample-facility',
    formVersion: 1,
  };

  it('derives the id from the register and national code', async () => {
    const ctx = ctxWithRegister();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: nationalBody });
    expect(res.statusCode).toBe(201);
    const expected = `fac-${createHash('sha256')
      .update('urn:openldr:facility-register:mfl|100').digest('hex').slice(0, 16)}`;
    expect(res.json().id).toBe(expected);
  });

  it('keeps a random id when there is no national code', async () => {
    const ctx = ctxWithRegister();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).not.toMatch(/^fac-/);
  });

  it('refuses an unregistered register instead of hashing it', async () => {
    const ctx = ctxWithRegister();
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...nationalBody, answers: { ...nationalBody.answers, f7: 'MFL' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('is not a known facility register');
  });

  it('refuses rather than overwriting a facility already under that national code', async () => {
    const ctx = ctxWithRegister();
    const app = await appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/facilities', payload: nationalBody });
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...nationalBody, answers: { ...nationalBody.answers, f2: 'A different name' } },
    });
    expect(res.statusCode).toBe(409);
    // The first row must survive intact — `upsert` is onConflict-doUpdateSet, so a create that
    // reached it would silently replace an imported facility.
    expect(ctx.__rows).toHaveLength(1);
    expect(ctx.__rows[0].name).toBe('Commando Urban');
  });
});
```

`appWith` must let a test supply the register-source store. Change it and the route registration to
accept one, defaulting to the real store:

```ts
async function appWith(ctx: any, capabilities: string[] = ['facilities.view', 'facilities.manage']) {
  const app = Fastify();
  app.addHook('onRequest', async (req: any) => { req.user = { id: 'u1', capabilities }; });
  registerFacilitiesRoutes(app as any, ctx);
  await app.ready();
  return app;
}
```

stays as-is; instead have the route prefer an injected store. In `facilities-routes.ts:694`:

```ts
  // ⛔ `ctx.__registerSources` is a TEST SEAM, not a production path: `fakeCtx()` has no real db for
  // `createFacilityRegisterSourceStore` to close over (its `internalDb` is a narrow allow-listed
  // Proxy). Production always takes the real store.
  const registerSources = (ctx as any).__registerSources ?? createFacilityRegisterSourceStore(ctx.internalDb);
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @openldr/server test -- facilities-routes.test.ts -t "Task 4"
```

Expected: the first, third and fourth FAIL. The second PASSES already.

- [ ] **Step 3: Import `idFor`**

Add to the `@openldr/terminology` import block at the top of `facilities-routes.ts` (create the block
if the file does not already import from that package):

```ts
import { idFor } from '@openldr/terminology';
```

- [ ] **Step 4: Derive the id in POST**

Replace the `created = await ctx.facilityRegistry.upsert({...})` block at `:1204-1216`:

```ts
    // ⛔ The id is server-derived, never client-chosen. When this facility names a register AND a
    // code within it, it is derived by the SAME function the CSV importer uses
    // (`idFor`, packages/terminology/src/facility-csv.ts) — otherwise the same facility exists
    // twice, once hand-entered under a random id and once imported under the derived one. Migration
    // 082's `planMoves` already re-keyed the manual rows that predate this and states the rule; this
    // is that rule applied at the door instead of once, in a migration that will never run again.
    //
    // No national code means nothing to hash, so the random id stands — the same case 082 leaves
    // alone rather than inventing an identity for.
    const nationalSystem = typeof record.nationalSystem === 'string' ? record.nationalSystem.trim() : '';
    const nationalCode = typeof record.nationalCode === 'string' ? record.nationalCode.trim() : '';
    let id = randomUUID();
    if (nationalSystem && nationalCode) {
      // The same gate every import door already applies, for the same reason: a typed register
      // label hashes a second permanent identity for one register. See
      // `resolveFacilityRegisterForImport` (@openldr/db) for the defect it closes.
      const register = await resolveFacilityRegisterForImport(registerSources, nationalSystem);
      if (!register.ok) { reply.code(400); return { error: register.error }; }
      id = idFor(nationalSystem, nationalCode);
      // ⛔ `facilityRegistry.upsert` is `onConflict('id').doUpdateSet(...)`
      // (packages/db/src/facility-registry-store.ts). With a DERIVED id, a create that reached it
      // would silently overwrite an imported facility — no error, no record of what was lost. A
      // create must never do that, so the collision is refused here.
      if (await ctx.facilityRegistry.get(id)) {
        reply.code(409);
        return { error: 'a facility with that national code already exists in this register' };
      }
    }

    // Only the write itself is guarded — an error from `recordAudit` below must never be mapped
    // as if it came from `upsert` (e.g. a 23505 from the audit table mis-reported to the client as
    // "a facility with that local code already exists" after the facility row already committed).
    let created;
    try {
      created = await ctx.facilityRegistry.upsert({
        ...record,
        id,
        name,
        extras,
        // Lab-authored: managedOrigin stays NULL. Only the sync applier stamps 'central'.
        source: 'manual',
      } as never);
```

Leave the `catch`/`mapFacilityDbError` and everything below it unchanged.

- [ ] **Step 5: Run to verify they pass**

```bash
pnpm --filter @openldr/server test -- facilities-routes.test.ts && pnpm --filter @openldr/server lint
```

Expected: every Task 4 test PASSES, no pre-existing test regresses, lint clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): a manual create keys on the register and national code"
```

---

### Task 5: The route enforces required — all of it on create, only what changed on edit

Closes F2a. **Do not start this before Task 2 is committed.** Task 2 is what stops `localCode` and
`region` being required; without it this makes every imported facility uneditable.

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` — POST after the has-a-code check, PUT after the
  identity guard from Task 3
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `validateAnswers(model: FormSchema, answers: AnswerState): AnswerError[]` from
  `@openldr/forms`, where `AnswerError` is `{ fieldId: string; label: string; reason: string }`.
- Consumes: `changedCoreKeys` from Task 1.

- [ ] **Step 1: Write the failing tests**

```ts
describe('Task 5: required is enforced on the route', () => {
  // `resolveForm` returns only `{ fields, targetPages }`, so the route needs the full form to hand
  // `validateAnswers`. This fixture gives the sample form a required field the payloads can omit.
  function ctxWithRequiredName() {
    const ctx = fakeCtx();
    ctx.forms.get = async (formId: string) => (formId === 'form-sample-facility'
      ? {
        id: 'form-sample-facility',
        targetPages: ['facilities'],
        schema: {
          id: 's', name: 'Facility', sections: [], fields: [
            { id: 'f1', displayLabel: 'Local code', fieldType: 'identifier', required: false, enabled: true, order: 0, apiProperty: 'localCode', fhirPath: null, description: null, cardinality: { min: 0, max: '1' } },
            { id: 'f2', displayLabel: 'Name', fieldType: 'text', required: true, enabled: true, order: 1, apiProperty: 'name', fhirPath: null, description: null, cardinality: { min: 1, max: '1' } },
            { id: 'f3', displayLabel: 'Region', fieldType: 'text', required: true, enabled: true, order: 2, apiProperty: 'region', fhirPath: null, description: null, cardinality: { min: 1, max: '1' } },
          ],
        },
      }
      : undefined);
    return ctx;
  }

  it('refuses a create that omits a required field', async () => {
    const ctx = ctxWithRequiredName();
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { answers: { f1: 'LAB01', f2: 'Commando Urban' }, formSchemaId: 'form-sample-facility', formVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Region');
  });

  it('lets an edit through when the missing required field is one this submission did not touch', async () => {
    const ctx = ctxWithRequiredName();
    ctx.__rows.push({ id: 'fac-1', localCode: 'LAB01', name: 'Commando Urban', region: null, extras: {}, source: 'import' });
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'PUT', url: '/api/facilities/fac-1',
      payload: { answers: { f1: 'LAB01', f2: 'Commando Urban Clinic' }, formSchemaId: 'form-sample-facility', formVersion: 1 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses an edit that BLANKS a required field', async () => {
    const ctx = ctxWithRequiredName();
    ctx.__rows.push({ id: 'fac-1', localCode: 'LAB01', name: 'Commando Urban', region: 'Copperbelt', extras: {}, source: 'import' });
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'PUT', url: '/api/facilities/fac-1',
      payload: { answers: { f1: 'LAB01', f2: 'Commando Urban', f3: '' }, formSchemaId: 'form-sample-facility', formVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Region');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @openldr/server test -- facilities-routes.test.ts -t "Task 5"
```

Expected: the first and third FAIL with 200 or 201. The second PASSES already.

- [ ] **Step 3: Have `resolveForm` return the full schema**

`validateAnswers` needs the whole `FormSchema`, not just the field list. Widen `ResolvedForm` and
`resolveForm` in `facilities-routes.ts:317-330`:

```ts
type ResolvedForm = { fields: FieldRef[]; targetPages: unknown; schema: unknown };
```

and in `resolveForm`'s return:

```ts
  return { fields: schema?.fields ?? [], targetPages: def.targetPages ?? null, schema: schema ?? null };
```

Update both destructurings (POST at `:1168`, PUT at `:1285`) to `const { fields, targetPages, schema: formSchema } = ...`.

- [ ] **Step 4: Add the shared required check**

Insert below `changedCoreKeys`:

```ts
/**
 * Required-field refusal, shared by POST and PUT.
 *
 * `changedFieldIds` is `null` on POST — a create must be complete, so every required field is
 * checked. On PUT it is the set of FIELD ids whose core column this submission changed or cleared:
 * an imported facility with a pre-existing gap stays editable, but the operator cannot blank a
 * required field. The Edit sheet resubmits every field it seeded, so checking the whole form on
 * every edit would block an unrelated change on a value the import never supplied.
 *
 * ⚠ `validateAnswers` (@openldr/forms) has NO visibility check, unlike the studio's own `validate`
 * (apps/studio/src/forms-runtime/runtime.ts:33, which skips hidden fields). On a form carrying a
 * visibility rule this route therefore enforces required on a field the client never did. The
 * shipped Facility form has no visibility rules, so this is inert today and live the moment an
 * operator adds one.
 */
function requiredFieldsError(
  formSchema: unknown, answers: Record<string, unknown>, changedFieldIds: Set<string> | null,
): { error: string } | undefined {
  // `as never` matches `apps/server/src/forms-routes.ts:321`, the only other caller of this
  // function in the codebase — that route hands `validateAnswers` a stored schema the same way,
  // without re-parsing it. One convention, not two.
  const errors = validateAnswers(formSchema as never, answers as never)
    .filter((e) => e.reason === 'required')
    .filter((e) => changedFieldIds === null || changedFieldIds.has(e.fieldId));
  if (errors.length === 0) return undefined;
  return { error: `${errors.map((e) => e.label).join(', ')} ${errors.length === 1 ? 'is' : 'are'} required` };
}
```

Add the import at the top of the file, matching `forms-routes.ts:7`:

```ts
import { validateAnswers } from '@openldr/forms';
```

- [ ] **Step 5: Call it from POST**

Immediately after POST's `a facility must have a local code or a national code` check:

```ts
    const requiredErr = requiredFieldsError(formSchema, p.data.answers, null);
    if (requiredErr) { reply.code(400); return requiredErr; }
```

- [ ] **Step 6: Call it from PUT**

Immediately after Task 3's identity guard:

```ts
    // Only what this submission moved. `identityChanged` (above) is keyed on COLUMN names;
    // `validateAnswers` reports FIELD ids, so map through the submitted form's own field list rather
    // than assuming the two are spelled the same.
    const changedFieldIds = new Set(
      fields
        .filter((f) => {
          const key = f.apiProperty ?? '';
          return identityChanged.has(key) || cleared.has(key);
        })
        .map((f) => f.id),
    );
    const requiredErr = requiredFieldsError(formSchema, p.data.answers, changedFieldIds);
    if (requiredErr) { reply.code(400); return requiredErr; }
```

- [ ] **Step 7: Run to verify they pass**

```bash
pnpm --filter @openldr/server test -- facilities-routes.test.ts && pnpm --filter @openldr/server lint
```

Expected: all three Task 5 tests PASS, no pre-existing test regresses, lint clean.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): the route enforces required — fully on create, on what changed on edit"
```

---

### Task 6: The sheet suggests the install's registered facility registers

`FacilityDialog` already fetches `listFacilityImportSources()` for the provenance panel. Feed that
same list to the new `fld-fac-national-system` field rather than adding a second fetch.

**Files:**
- Modify: `apps/studio/src/facilities/FacilityDialog.tsx:110`, `:122-143`
- Test: none new — this is wiring over an existing fetch, covered by the live check in Task 8. Say so
  rather than writing a test that asserts a prop was passed.

**Interfaces:**
- Consumes: `useFacilityAdminSuggestions(schema, remountKey)` returning `{ suggestions, reportAnswers }`,
  where `suggestions` is keyed by field id.

- [ ] **Step 1: Move the register-source fetch out of the edit-only effect**

The effect at `:125-143` returns early when `!isEdit`, so a CREATE never fetches the sources. Split
the register-source fetch into its own effect that runs whenever the sheet is open:

```ts
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listFacilityImportSources()
      .then((sources) => { if (!cancelled) setRegisterSources(sources); })
      .catch(() => { if (!cancelled) setRegisterSources([]); });
    return () => { cancelled = true; };
  }, [open]);
```

and delete the two `listFacilityImportSources()` lines from the existing effect, leaving its
`getFacilityHistory` call and its `!isEdit` early return alone.

- [ ] **Step 2: Merge the register options into the field suggestions**

Below the `useFacilityAdminSuggestions` call at `:110`:

```ts
  // The national-system field names a REGISTERED facility register by canonical URI. POST refuses an
  // unregistered or deactivated one (`resolveFacilityRegisterForImport`, server-side), so this list
  // is convenience, not the gate — which is why a `suggest` field (free entry allowed) is correct
  // here and a hard picklist would only move the refusal earlier without making it any softer.
  // ⚠ `SuggestionState.options` is `string[]` (apps/studio/src/forms-runtime/types.ts:13) — the
  // list carries VALUES, not value/label pairs. So this field offers each register's canonical URI
  // and not its friendly name. That is honest (the URI is what gets stored, and what the server
  // matches exactly) but it is not pretty. Showing a name would mean widening `SuggestionState`
  // and `SuggestCombobox` to carry labels, which is not in this plan.
  const suggestionsWithRegisters: FieldSuggestions = {
    ...fieldSuggestions,
    'fld-fac-national-system': {
      status: 'ready',
      options: registerSources.map((s) => s.url),
    },
  };
```

Add `FieldSuggestions` to the existing `@/forms-runtime/types` type import at the top of the file.

Pass `suggestionsWithRegisters` to `FormRuntime`'s `fieldSuggestions` prop instead of
`fieldSuggestions`.

- [ ] **Step 3: Typecheck and run the studio tests**

```bash
pnpm --filter @openldr/studio typecheck && pnpm --filter @openldr/studio test
```

Expected: clean, and no existing FacilityDialog test regresses.

- [ ] **Step 4: Check the sheet at phone width**

Start the dev stack, open a facility, and resize to 375×812. Confirm the two new rows keep the
label-left / input-right grid and do not force horizontal scroll. Nothing here is bottom-anchored, so
the `vh`-vs-`dvh` blind spot does not apply — if that changes, say only a real phone can confirm it.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/facilities/FacilityDialog.tsx
git commit -m "feat(facilities): the sheet suggests this install's registered facility registers"
```

---

### Task 7: Documentation

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/facilities.md`
- Modify: `apps/web/src/docs/0.1.0/facilities.md`

Only `en/` exists on disk. `apps/studio/src/docs/registry.ts:344` falls back to English for `fr` and
`pt`, so there are no other files to update. Translating the doc set is real work and a separate
slice.

- [ ] **Step 1: Read both files**

```bash
cat apps/studio/src/docs/0.1.0/en/facilities.md apps/web/src/docs/0.1.0/facilities.md
```

- [ ] **Step 2: Add a "Registering a facility by hand" section to each**

Match each file's existing heading level and voice. Cover exactly these four points:

1. The registry holds two codes. The **national code** is the one the master facility list carries.
   The **local code** is the lab's own, and is optional.
2. To register a facility that exists in the national list, enter its **National code** and pick its
   **Facility register**. The facility is then filed under the same identity a CSV import of that
   register would give it, so a later import updates it instead of creating a second row.
3. The register must already exist on this install. An unknown or deactivated one is refused.
4. **The national code and the register cannot be changed afterwards** — they are part of the
   facility's identity. A facility created without a national code cannot acquire one; delete it and
   register it again.

- [ ] **Step 3: Run the docs validation tests**

```bash
pnpm --filter @openldr/studio test -- docs && pnpm --filter @openldr/web test
```

Expected: PASS. `apps/studio/src/docs/validation.test.ts` checks doc structure; if it pins a heading
list, add the new section to that pin rather than weakening it.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs/0.1.0/en/facilities.md apps/web/src/docs/0.1.0/facilities.md
git commit -m "docs(facilities): registering a facility against a national register"
```

---

### Task 8: Full gate and live verification

**Files:** none — this task produces evidence, not code.

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run test
```

Do not pipe it through `tail`. If it fails, grep the output for `Test timed out` first and re-run
that package alone before blaming a change.

- [ ] **Step 2: Re-import the Zambia file against a dev stack**

Import the 3788-row Zambia MFL export, open any imported facility, and press Save without changing
anything. Record the status code.

Expected: it saves. Before this slice it was blocked twice — client-side on two required markers, and
server-side on `level 'Health Centre' is not a recognised canonical level value`.

- [ ] **Step 3: Register one by hand and re-import**

Register a facility manually against the same register, with a national code that also appears in the
CSV. Then re-import the CSV.

Expected: the import UPDATES that row. It must not insert a second one, and must not fail on
`facility_registry_national_unique`.

- [ ] **Step 4: Confirm the collision refusal on real Postgres**

Register a facility by hand against a register and national code that already exists.

Expected: 409, and the existing row is unchanged. **This is the step pg-mem cannot prove** — the
partial unique index on `(national_system, national_code)` and `upsert`'s
`onConflict … doUpdateSet` only behave truthfully on real Postgres. If this step is skipped, write
**HONEST NON-PROOF** in the report and say the overwrite path is untested.

- [ ] **Step 5: Report**

State, per step, the command and its output. Name anything skipped and why. Do not write "done" or
"working" without the output beside it.

---

## Not in this plan

Each of these was considered and left out. Named here so a later reader does not mistake absence for
oversight.

- **Re-keying an existing row.** Task 3 refuses the edit instead. The cost — a facility created
  without a national code can never acquire one — is stated in the spec and in Task 3's own comment.
- **A `facilities create` CLI command.** None exists; the CLI has import, import-run, import-sources
  and scan. §6's parity rule covers admin, settings, danger-zone and maintenance surfaces.
- **A read-only field type in the forms engine.** Rejected in the spec: new capability, inherited by
  every form.
- **"Last import — Never imported" on a facility that was imported.** Already open as I2 in the
  canonical-identity notes.
- **Zone/Region/District/Council labels are fixed i18n keys**, so a Zambian operator maps Province
  onto "Zone" and still reads "Zone". Deferred by operator decision on 2026-08-12.
- **Translating the doc set into fr and pt.** No fr/pt doc files exist for any page.
