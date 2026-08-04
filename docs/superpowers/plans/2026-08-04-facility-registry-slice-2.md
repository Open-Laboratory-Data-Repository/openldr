# Facility Registry Slice 2 — Hand Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator can create, list, edit and delete a facility through a Facilities page driven by the Facility form.

**Architecture:** Slice 1's `createFacilityRegistryStore` goes onto `AppContext`. A pure `splitFacilityAnswers` in `@openldr/db` turns submitted form answers into core columns plus an `extras` bag, keyed on each field's `apiProperty`. Server routes own that split — the client never decides which answers become indexed columns. The page mirrors `Users.tsx`: load the first published `facilities` form, render it through `FormRuntime`.

**Tech Stack:** TypeScript, Kysely + Postgres, Fastify, React + Vitest + Testing Library, pg-mem for migration tests.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-04-facility-registry-slice-2-design.md`. Read it before Task 1.
- **Never `git add -A`.** This repo directory is shared with concurrent sessions — add exact paths.
- **No `Co-Authored-By` trailer** on any commit.
- **Gate before merge:** `pnpm turbo run typecheck test --force` must be 67/67. Never pipe turbo through `tail`.
- **`apiProperty` names the column.** A field whose `apiProperty` is in `CORE_FACILITY_KEYS` writes that column; anything else — including a field with **no** `apiProperty` — goes to `extras`. Never drop an answer silently.
- **The split is SERVER-side.** The route takes `{ answers, formSchemaId, formVersion }`. The client must not pre-split.
- **UI actions live in a ⋯ `DropdownMenu`** — never standalone or footer buttons. Form fields are a label-left / input-right grid. (Established repo convention.)
- **studio i18n is parity-enforced** (`apps/studio/src/i18n/{en,fr,pt}.ts` + `parity.test.ts`) — a new key needs real fr and pt translations or the suite goes red.
- **Do NOT edit migration 067's `FROZEN_CAPABILITY_KEYS`.** It is frozen by contract. A new capability reaches existing installs by being absent from `capability_introductions`, which makes `seedSystemRoles()` grant it on the next boot.
- **Three similarly-named columns, three meanings, never joined:** `facility_registry.local_code` (authored), `facility_aliases.source_code` (observed, per feed), `facilities.facility_code` (projection of an ingested FHIR identifier, different schema).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/facility-answers.ts` | `CORE_FACILITY_KEYS` + `splitFacilityAnswers`. Pure. |
| `packages/db/src/facility-answers.test.ts` | Split behaviour. |
| `packages/bootstrap/src/index.ts` *(modify)* | Construct the store, put it on `AppContext`. |
| `packages/rbac/src/catalog.ts`, `presets.ts` *(modify)* | `facilities.view` / `facilities.manage`. |
| `apps/server/src/facilities-routes.ts` | Five endpoints, audited, capability-gated. |
| `apps/server/src/facilities-routes.test.ts` | Route behaviour. |
| `packages/forms/src/samples/forms.ts` *(modify)* | Rewrite the Facility form to the required set. |
| `packages/forms/src/page-targets.ts` *(modify)* | facilities `available: true`. |
| `packages/bootstrap/src/seed.ts` *(modify)* | Facility joins `ESSENTIAL_FORM_NAMES`. |
| `packages/db/src/migrations/internal/071_facility_form_target.ts` | Repoint an existing untouched copy. |
| `apps/studio/src/pages/Facilities.tsx` + `FacilityDialog.tsx` | The page. |
| `apps/studio/src/api.ts`, `App.tsx`, `shell/AppShell.tsx`, `i18n/*` *(modify)* | Client, route, nav, strings. |

---

## Task 1: `splitFacilityAnswers`

**Files:**
- Create: `packages/db/src/facility-answers.ts`
- Create: `packages/db/src/facility-answers.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `FacilityRecord` from `./facility-registry-store`.
- Produces: `CORE_FACILITY_KEYS: ReadonlySet<string>`, and
  `splitFacilityAnswers(fields: AnswerField[], answers: Record<string, unknown>): { record: Partial<FacilityRecord>; extras: Record<string, unknown> }`
  where `AnswerField = { id: string; apiProperty?: string | null }`.

⚠ The function takes a **field list**, not a whole `FormSchema`. `@openldr/db` must not depend on `@openldr/forms` (that would invert the dependency direction — forms already depends on db). The caller passes `schema.fields`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/facility-answers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { splitFacilityAnswers, CORE_FACILITY_KEYS } from './facility-answers';

const f = (id: string, apiProperty?: string | null) => ({ id, apiProperty });

describe('splitFacilityAnswers', () => {
  it('routes a known apiProperty to its column', () => {
    const { record, extras } = splitFacilityAnswers(
      [f('a', 'localCode'), f('b', 'name'), f('c', 'region')],
      { a: 'LAB01', b: 'Dodoma Regional Referral', c: 'Dodoma Region' },
    );
    expect(record).toEqual({ localCode: 'LAB01', name: 'Dodoma Regional Referral', region: 'Dodoma Region' });
    expect(extras).toEqual({});
  });

  it('routes an UNKNOWN apiProperty to extras', () => {
    const { record, extras } = splitFacilityAnswers([f('a', 'catchmentPop')], { a: '42000' });
    expect(record).toEqual({});
    expect(extras).toEqual({ catchmentPop: '42000' });
  });

  it('⛔ routes a field with NO apiProperty to extras, keyed by field id — never drops it', () => {
    // The seeded form shipped several fields with no apiProperty at all. Dropping them would lose
    // an operator's typed answer with no error anywhere.
    const { record, extras } = splitFacilityAnswers([f('fld-note')], { 'fld-note': 'closed for renovation' });
    expect(record).toEqual({});
    expect(extras).toEqual({ 'fld-note': 'closed for renovation' });
  });

  it('omits blank and whitespace-only answers from both sides', () => {
    const { record, extras } = splitFacilityAnswers(
      [f('a', 'localCode'), f('b', 'region'), f('c', 'somethingElse')],
      { a: 'LAB01', b: '   ', c: '' },
    );
    expect(record).toEqual({ localCode: 'LAB01' });
    expect(extras).toEqual({});
  });

  it('ignores an answer with no matching field — a stale client cannot inject columns', () => {
    const { record, extras } = splitFacilityAnswers([f('a', 'localCode')], { a: 'LAB01', ghost: 'x' });
    expect(record).toEqual({ localCode: 'LAB01' });
    expect(extras).toEqual({});
  });

  it('coerces latitude and longitude to numbers, and a non-numeric one to null', () => {
    const { record } = splitFacilityAnswers(
      [f('a', 'latitude'), f('b', 'longitude'), f('c', 'localCode')],
      { a: '-2.6', b: 'not-a-number', c: 'LAB01' },
    );
    expect(record.latitude).toBe(-2.6);
    expect(record.longitude).toBeNull();
  });

  it('trims text answers', () => {
    const { record } = splitFacilityAnswers([f('a', 'name')], { a: '  Muhimbili  ' });
    expect(record.name).toBe('Muhimbili');
  });

  it('exposes every writable column as a core key', () => {
    for (const k of ['localCode', 'nationalCode', 'nationalSystem', 'name', 'level', 'ownership',
      'status', 'country', 'zone', 'region', 'district', 'council', 'ward', 'village',
      'addressText', 'phone', 'latitude', 'longitude']) {
      expect(CORE_FACILITY_KEYS.has(k), `${k} missing from CORE_FACILITY_KEYS`).toBe(true);
    }
    // `id`, `extras`, `managedOrigin` and `source` are set by the ROUTE, never by an answer.
    for (const k of ['id', 'extras', 'managedOrigin', 'source']) {
      expect(CORE_FACILITY_KEYS.has(k), `${k} must NOT be settable from a form answer`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --dir packages/db/src facility-answers`
Expected: FAIL — `Cannot find module './facility-answers'`.

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/facility-answers.ts`:

```typescript
import type { FacilityRecord } from './facility-registry-store';

/**
 * Columns a form answer may write.
 *
 * ⚠ `id`, `extras`, `managedOrigin` and `source` are deliberately ABSENT: they are the route's to
 * set. A form that could set `id` would let a client overwrite an imported row; one that could set
 * `managedOrigin` would let a lab-authored facility masquerade as central-managed and be deleted by
 * the next down-sync.
 */
export const CORE_FACILITY_KEYS: ReadonlySet<string> = new Set([
  'localCode', 'nationalCode', 'nationalSystem', 'name', 'level', 'ownership', 'status',
  'country', 'zone', 'region', 'district', 'council', 'ward', 'village',
  'addressText', 'phone', 'latitude', 'longitude',
]);

const NUMERIC_KEYS: ReadonlySet<string> = new Set(['latitude', 'longitude']);

/** The shape the caller passes — `schema.fields`, narrowed. Deliberately NOT `FormSchema`:
 *  `@openldr/db` must not depend on `@openldr/forms`, which already depends on it. */
export interface AnswerField {
  id: string;
  apiProperty?: string | null;
}

export interface FacilityAnswerSplit {
  record: Partial<FacilityRecord>;
  extras: Record<string, unknown>;
}

/**
 * Split submitted form answers into registry columns and an `extras` bag.
 *
 * A field whose `apiProperty` names a column writes that column; EVERYTHING ELSE goes to `extras`,
 * including a field with no `apiProperty` at all (keyed by its field id). Nothing is silently
 * dropped — the seeded Facility form shipped several fields with no `apiProperty`, and losing an
 * operator's typed answer with no error is the failure this guards.
 *
 * Runs SERVER-side: a client cannot be trusted to decide which answers become indexed columns.
 */
export function splitFacilityAnswers(
  fields: AnswerField[],
  answers: Record<string, unknown>,
): FacilityAnswerSplit {
  const record: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};

  for (const field of fields) {
    if (!Object.hasOwn(answers, field.id)) continue;
    const raw = answers[field.id];
    const key = field.apiProperty ?? '';

    if (CORE_FACILITY_KEYS.has(key)) {
      if (NUMERIC_KEYS.has(key)) {
        const n = Number(String(raw ?? '').trim());
        record[key] = String(raw ?? '').trim() === '' ? null : (Number.isFinite(n) ? n : null);
        continue;
      }
      const text = typeof raw === 'string' ? raw.trim() : raw;
      if (text === '' || text === null || text === undefined) continue; // blank omitted, not stored as ''
      record[key] = text;
      continue;
    }

    const text = typeof raw === 'string' ? raw.trim() : raw;
    if (text === '' || text === null || text === undefined) continue;
    extras[key || field.id] = text;
  }

  return { record: record as Partial<FacilityRecord>, extras };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --dir packages/db/src facility-answers`
Expected: PASS, 8 tests.

- [ ] **Step 5: Export it**

In `packages/db/src/index.ts`, beside the facility-registry-store exports, add:

```typescript
export { splitFacilityAnswers, CORE_FACILITY_KEYS } from './facility-answers';
export type { AnswerField, FacilityAnswerSplit } from './facility-answers';
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p packages/db/tsconfig.json`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/facility-answers.ts packages/db/src/facility-answers.test.ts packages/db/src/index.ts
git commit -m "feat(db): split facility form answers into columns and extras"
```

---

## Task 2: Put the store on AppContext

**Files:**
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `packages/bootstrap/src/index.test.ts`

**Interfaces:**
- Consumes: `createFacilityRegistryStore` from `@openldr/db` (slice 1).
- Produces: `AppContext.facilityRegistry: FacilityRegistryStore`.

- [ ] **Step 1: Find the pinned reference-capture assertion**

Run: `grep -n "referenceCapture" packages/bootstrap/src/index.test.ts`

Read the assertion it prints. It pins the set of stores constructed with the capture binding; Step 4 updates it.

- [ ] **Step 2: Add the import and the type**

In `packages/bootstrap/src/index.ts`, add `createFacilityRegistryStore` and `type FacilityRegistryStore` to the existing `@openldr/db` import list (the long one near the top that already imports `createReportStore` and friends).

Then in the `AppContext` interface, next to `appSettings` / `labIdentity`, add:

```typescript
  /** Curated facility records (slice 1's registry). Capture-aware: registry writes land in
   *  reference_change_log ready for the eventual central→lab down-sync. */
  facilityRegistry: FacilityRegistryStore;
```

- [ ] **Step 3: Construct it and return it**

Find where the other capture-aware stores are constructed (search for `referenceCapture` in `createAppContext`). Beside them add:

```typescript
  const facilityRegistry = createFacilityRegistryStore(internal.db, referenceCapture);
```

Then add `facilityRegistry,` to the object `createAppContext` returns, beside `appSettings`.

- [ ] **Step 4: Update the pinned assertion**

Add the facility registry store to the list the `referenceCapture` assertion in `packages/bootstrap/src/index.test.ts` checks, matching the shape already used for the neighbouring stores.

- [ ] **Step 5: Fix the other AppContext fakes**

⚠ `apps/server` has **two** context fakes and adding an `AppContext` field breaks both silently at typecheck:
- `apps/server/src/test-helpers.ts`
- a local `fakeCtx()` in `apps/server/src/report-designs-routes.test.ts`

Add a stub to each. In `test-helpers.ts`, beside `labIdentity`:

```typescript
    facilityRegistry: {} as never,
```

Run `grep -rn "labIdentity" apps/server/src --include=*.ts` to find any other fake that needs the same.

- [ ] **Step 6: Typecheck both packages**

Run: `npx tsc --noEmit -p packages/bootstrap/tsconfig.json`
Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: no output from either.

- [ ] **Step 7: Run the bootstrap tests**

Run: `npx vitest run --dir packages/bootstrap/src index.test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/index.test.ts apps/server/src/test-helpers.ts apps/server/src/report-designs-routes.test.ts
git commit -m "feat(bootstrap): expose the facility registry store on AppContext"
```

---

## Task 3: Capabilities

**Files:**
- Modify: `packages/rbac/src/catalog.ts`
- Modify: `packages/rbac/src/presets.ts`
- Modify: `packages/rbac/src/catalog.test.ts`

**Interfaces:**
- Produces: capability keys `facilities.view`, `facilities.manage`.

- [ ] **Step 1: Write the failing test**

Append to `packages/rbac/src/catalog.test.ts`:

```typescript
describe('facilities capabilities', () => {
  it('exposes view and manage', () => {
    expect(CAPABILITY_KEYS).toContain('facilities.view');
    expect(CAPABILITY_KEYS).toContain('facilities.manage');
  });

  it('mirrors terminology: manager manages, analyst and auditor only view', () => {
    // Facilities are reference data, exactly like terminology — same shape, same audience.
    const role = (slug: string) => SYSTEM_ROLES.find((r) => r.slug === slug)!;
    expect(role('lab_manager').capabilities).toEqual(expect.arrayContaining(['facilities.view', 'facilities.manage']));
    expect(role('data_analyst').capabilities).toContain('facilities.view');
    expect(role('data_analyst').capabilities).not.toContain('facilities.manage');
    expect(role('system_auditor').capabilities).toContain('facilities.view');
    expect(role('system_auditor').capabilities).not.toContain('facilities.manage');
    // A bench technician fills forms; they do not curate the facility register.
    expect(role('lab_technician').capabilities).not.toContain('facilities.view');
  });
});
```

Add `SYSTEM_ROLES` to the file's imports from `./presets` if it is not already imported.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --dir packages/rbac/src catalog`
Expected: FAIL — `facilities.view` not in `CAPABILITY_KEYS`.

- [ ] **Step 3: Add the catalog entries**

In `packages/rbac/src/catalog.ts`, after the `// Users` block, add:

```typescript
  // Facilities
  { key: 'facilities.view', group: 'facilities', label: 'View facilities', description: 'Open the Facilities workspace and see the facility register.' },
  { key: 'facilities.manage', group: 'facilities', label: 'Manage facilities', description: 'Create, edit and remove facility records.' },
```

- [ ] **Step 4: Add them to the presets**

In `packages/rbac/src/presets.ts`, add `'facilities.view', 'facilities.manage',` to the `MANAGER` array (beside the terminology pair), and `'facilities.view',` to both `ANALYST` and `AUDITOR` (beside `'terminology.view'`). `lab_admin` needs no change — it spreads `CAPABILITY_KEYS`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --dir packages/rbac/src`
Expected: PASS. If a preset snapshot test fails, update it — new capabilities in a preset are the intended change.

- [ ] **Step 6: Confirm you did NOT touch the frozen list**

Run: `git diff --stat packages/db/src/migrations/internal/067_capability_introductions.ts`
Expected: **no output** (the file is unchanged). That list is frozen by contract; the new keys reach existing installs precisely because they are absent from `capability_introductions`, which makes `seedSystemRoles()` grant them on the next boot.

- [ ] **Step 7: Commit**

```bash
git add packages/rbac/src/catalog.ts packages/rbac/src/presets.ts packages/rbac/src/catalog.test.ts
git commit -m "feat(rbac): add facilities.view and facilities.manage capabilities"
```

---

## Task 4: The routes

**Files:**
- Create: `apps/server/src/facilities-routes.ts`
- Create: `apps/server/src/facilities-routes.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `ctx.facilityRegistry` (Task 2), `splitFacilityAnswers` + `CORE_FACILITY_KEYS` (Task 1), capabilities (Task 3).
- Produces: `registerFacilitiesRoutes(app, ctx)`.

- [ ] **Step 1: Read the neighbouring route module**

Read `apps/server/src/report-designs-routes.ts` in full. It is the closest analogue: `requireCapability` preHandlers, `recordAudit` on mutations, zod-validated bodies, 404 on missing. Follow its shape exactly.

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/facilities-routes.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerFacilitiesRoutes } from './facilities-routes';

function fakeCtx() {
  const rows: any[] = [];
  const audit: any[] = [];
  return {
    audit: { record: async (e: any) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    forms: { get: async () => ({ id: 'form-sample-facility', schema: { fields: [
      { id: 'f1', apiProperty: 'localCode' },
      { id: 'f2', apiProperty: 'name' },
      { id: 'f3', apiProperty: 'region' },
      { id: 'f4', apiProperty: 'catchmentPop' },
    ] } }) },
    facilityRegistry: {
      list: async () => rows,
      get: async (id: string) => rows.find((r) => r.id === id),
      upsert: async (rec: any) => { const i = rows.findIndex((r) => r.id === rec.id); if (i >= 0) rows[i] = rec; else rows.push(rec); return rec; },
      remove: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); },
    },
    __rows: rows,
    __audit: audit,
  } as any;
}

async function appWith(ctx: any) {
  const app = Fastify();
  app.addHook('onRequest', async (req: any) => { req.user = { id: 'u1', capabilities: ['facilities.view', 'facilities.manage'] }; });
  registerFacilitiesRoutes(app as any, ctx);
  await app.ready();
  return app;
}

const body = {
  answers: { f1: 'LAB01', f2: 'Dodoma Regional Referral', f3: 'Dodoma Region', f4: '42000' },
  formSchemaId: 'form-sample-facility',
  formVersion: 1,
};

describe('facilities routes', () => {
  it('creates a facility, splitting answers into columns and extras', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created).toMatchObject({
      localCode: 'LAB01', name: 'Dodoma Regional Referral', region: 'Dodoma Region', source: 'manual',
    });
    expect(created.extras).toEqual({ catchmentPop: '42000' });
    // managed_origin stays lab-local: only the sync applier stamps 'central'.
    expect(created.managedOrigin ?? null).toBeNull();
  });

  it('⛔ IGNORES a client-supplied id and generates its own', async () => {
    // The CSV parser derives ids deterministically from sha256(nationalSystem|nationalCode). A
    // client that could choose an id could overwrite an imported row.
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: { ...body, id: 'fac-attacker' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).not.toBe('fac-attacker');
  });

  it('audits create, update and delete', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
    await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: body });
    await app.inject({ method: 'DELETE', url: `/api/facilities/${id}` });
    expect(ctx.__audit.map((a: any) => a.action)).toEqual(['facility.create', 'facility.update', 'facility.delete']);
  });

  it('rejects a body with no answers', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: { formSchemaId: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('404s on an unknown id', async () => {
    const app = await appWith(fakeCtx());
    expect((await app.inject({ method: 'GET', url: '/api/facilities/nope' })).statusCode).toBe(404);
  });

  it('lists what was created', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    const res = await app.inject({ method: 'GET', url: '/api/facilities' });
    expect(res.json()).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/server && npx vitest run src/facilities-routes`
Expected: FAIL — `Cannot find module './facilities-routes'`.

- [ ] **Step 4: Write the routes**

Create `apps/server/src/facilities-routes.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { splitFacilityAnswers } from '@openldr/db';
import { requireCapability } from './rbac';
import { recordAudit } from './audit-helper';

const VIEW = { preHandler: requireCapability('facilities.view') };
const MANAGE = { preHandler: requireCapability('facilities.manage') };

// The client submits ANSWERS, never a pre-split record: deciding which answers become indexed
// columns is the server's call, and duplicating the core-key list client-side would let the two
// drift. `id` is deliberately absent — see the POST handler.
const SubmitSchema = z.object({
  answers: z.record(z.unknown()),
  formSchemaId: z.string().nullish(),
  formVersion: z.number().nullish(),
});

/** Resolve the submitted form's field list so `apiProperty` can be read per answer. */
async function fieldsOf(ctx: AppContext, formSchemaId: string | null | undefined): Promise<{ id: string; apiProperty?: string | null }[]> {
  if (!formSchemaId) return [];
  const def = await ctx.forms.get(formSchemaId);
  const schema = def?.schema as { fields?: { id: string; apiProperty?: string | null }[] } | undefined;
  return schema?.fields ?? [];
}

export function registerFacilitiesRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/facilities', VIEW, async (req) => {
    const q = req.query as { region?: string; district?: string; council?: string; status?: string; limit?: string };
    return ctx.facilityRegistry.list({
      region: q.region, district: q.district, council: q.council, status: q.status,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });

  app.get('/api/facilities/:id', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = await ctx.facilityRegistry.get(id);
    if (!rec) { reply.code(404); return { error: 'not found' }; }
    return rec;
  });

  app.post('/api/facilities', MANAGE, async (req, reply) => {
    const p = SubmitSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const fields = await fieldsOf(ctx, p.data.formSchemaId);
    const { record, extras } = splitFacilityAnswers(fields, p.data.answers);

    // ⛔ The id is ALWAYS generated here. The CSV importer derives ids deterministically from
    // sha256(nationalSystem|nationalCode), so a client-chosen id could collide with an imported
    // row and silently overwrite it.
    const created = await ctx.facilityRegistry.upsert({
      ...record,
      id: randomUUID(),
      name: String(record.name ?? ''),
      extras,
      // Lab-authored: managedOrigin stays NULL. Only the sync applier stamps 'central'.
      source: 'manual',
    } as never);

    await recordAudit(ctx, req, { action: 'facility.create', entityType: 'facility', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
  });

  app.put('/api/facilities/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = SubmitSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const before = await ctx.facilityRegistry.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }

    const fields = await fieldsOf(ctx, p.data.formSchemaId);
    const { record, extras } = splitFacilityAnswers(fields, p.data.answers);

    const after = await ctx.facilityRegistry.upsert({
      ...before, ...record, id, name: String(record.name ?? before.name), extras,
      // An edit never changes who manages the row.
      managedOrigin: before.managedOrigin, source: before.source,
    } as never);

    await recordAudit(ctx, req, { action: 'facility.update', entityType: 'facility', entityId: id, before, after });
    return after;
  });

  app.delete('/api/facilities/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.facilityRegistry.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    await ctx.facilityRegistry.remove(id);
    await recordAudit(ctx, req, { action: 'facility.delete', entityType: 'facility', entityId: id, before, after: null });
    return { ok: true };
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/server && npx vitest run src/facilities-routes`
Expected: PASS, 6 tests.

⚠ If `recordAudit` or `requireCapability` need a shape the fake context does not provide, extend `fakeCtx()` — do not weaken the assertions.

- [ ] **Step 6: Register the routes**

In `apps/server/src/app.ts`, find where `registerReportDesignRoutes` is called and add the same shape beside it:

```typescript
  registerFacilitiesRoutes(app, ctx);
```

plus the import at the top.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): facilities CRUD routes with a server-side answer split"
```

---

## Task 5: The form, the page target, and delivery

**Files:**
- Modify: `packages/forms/src/samples/forms.ts`
- Modify: `packages/forms/src/page-targets.ts`
- Modify: `packages/bootstrap/src/seed.ts`
- Create: `packages/db/src/migrations/internal/071_facility_form_target.ts`
- Create: `packages/db/src/migrations/internal/071_facility_form_target.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`
- Create/modify: `packages/forms/src/samples/forms.test.ts` (create if absent)

**Interfaces:**
- Produces: a published `facilities`-targeting Facility form whose every field carries an `apiProperty`.

- [ ] **Step 1: Write the failing seed test**

Create or append to `packages/forms/src/samples/forms.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sampleForms } from './forms';
import { PAGE_TARGETS } from '../page-targets';

const facility = () => sampleForms.find((f) => f.name === 'Facility')!;

describe('the seeded Facility form', () => {
  it('targets the facilities page', () => {
    expect(facility().targetPages).toEqual(['facilities']);
  });

  it('⛔ gives EVERY field an apiProperty', () => {
    // Under the Users pattern a field with no apiProperty falls into `extras`. Several fields
    // shipped without one, which would have put region/district/status/level in a jsonb bag —
    // unindexed and unjoinable, defeating the reason they are columns.
    const missing = facility().fields.filter((f) => !f.apiProperty).map((f) => f.id);
    expect(missing, `fields with no apiProperty: ${missing.join(', ')}`).toEqual([]);
  });

  it('carries exactly the agreed required set', () => {
    expect(facility().fields.map((f) => f.apiProperty).sort()).toEqual(
      ['country', 'district', 'level', 'localCode', 'name', 'region', 'status', 'zone'].sort(),
    );
  });

  it('marks the required fields required', () => {
    const required = facility().fields.filter((f) => f.required).map((f) => f.apiProperty).sort();
    expect(required).toEqual(['country', 'district', 'level', 'localCode', 'name', 'region', 'status', 'zone'].sort());
  });

  it('offers facilities as a page target, requiring the DB-required pair', () => {
    const t = PAGE_TARGETS.find((p) => p.id === 'facilities')!;
    expect(t.available).toBe(true);
    expect(t.requiredKeys.sort()).toEqual(['localCode', 'name']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --dir packages/forms/src samples/forms`
Expected: FAIL — `targetPages` is `['forms']`.

- [ ] **Step 3: Rewrite the Facility form**

In `packages/forms/src/samples/forms.ts`, replace the `facilityForm` fields array with exactly these eight, keeping the surrounding object (`id: 'sample-facility'`, `name: 'Facility'`, `fhirResourceType: 'Location'`) and setting `targetPages: ['facilities']`:

```typescript
  fields: [
    {
      id: 'fld-fac-local-code', fhirPath: 'identifier.value',
      fhirDiscriminator: { system: LOCAL_FACILITY_SYSTEM },
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
      fieldType: 'text', required: true, enabled: true, order: 2,
      cardinality: { min: 1, max: '1' }, apiProperty: 'country',
    },
    {
      id: 'fld-fac-zone', fhirPath: 'address.district', displayLabel: 'Zone', description: null,
      fieldType: 'text', required: true, enabled: true, order: 3,
      cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
    },
    {
      id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null,
      fieldType: 'text', required: true, enabled: true, order: 4,
      cardinality: { min: 1, max: '1' }, apiProperty: 'region',
    },
    {
      id: 'fld-fac-district', fhirPath: 'address.city', displayLabel: 'District', description: null,
      fieldType: 'text', required: true, enabled: true, order: 5,
      cardinality: { min: 1, max: '1' }, apiProperty: 'district',
    },
    // ⚠ status and level stay FREE TEXT. Baking in "Operating/Closed" would inline a vocabulary
    // into source; the field type supports `valueSetUrl`, so binding a ValueSet later is a form
    // edit rather than a code change.
    {
      id: 'fld-fac-status', fhirPath: 'status', displayLabel: 'Status', description: null,
      fieldType: 'text', required: true, enabled: true, order: 6,
      cardinality: { min: 1, max: '1' }, apiProperty: 'status',
    },
    {
      id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null,
      fieldType: 'text', required: true, enabled: true, order: 7,
      cardinality: { min: 1, max: '1' }, apiProperty: 'level',
    },
  ],
```

⚠ `NATIONAL_FACILITY_SYSTEM` becomes unused once the MFL field is gone. Keep the exported constant (the registry design references it) but remove the now-dangling import usage if the linter complains.

- [ ] **Step 4: Flip the page target**

In `packages/forms/src/page-targets.ts`, change the facilities entry to:

```typescript
  { id: 'facilities', label: 'Facilities', match: 'apiProperty', requiredKeys: ['localCode', 'name'], available: true },
```

and update the comment above the array, which currently lists facilities among the pages that "don't exist".

- [ ] **Step 5: Make the form essential**

In `packages/bootstrap/src/seed.ts`, add a `FACILITY_FORM_NAME` constant beside `USERS_FORM_NAME` and include it in `ESSENTIAL_FORM_NAMES`:

```typescript
const FACILITY_FORM_NAME = 'Facility';
...
const ESSENTIAL_FORM_NAMES = new Set<string>([USERS_FORM_NAME, ORDER_FORM_NAME, FACILITY_FORM_NAME]);
```

Update the docblock above it — it currently says the essentials are "the Users-page form and the Lab order form".

- [ ] **Step 6: Run the seed tests**

Run: `npx vitest run --dir packages/forms/src samples/forms`
Expected: PASS, 5 tests.

Run: `npx vitest run --dir packages/forms/src` and `npx vitest run --dir packages/bootstrap/src seed`
Expected: PASS. ⚠ The lint suite includes the `ambiguous-fhir-path` rule added earlier — the rewritten form has only ONE `identifier.value` field now, so it must stay clean.

- [ ] **Step 7: Write the failing migration test**

Create `packages/db/src/migrations/internal/071_facility_form_target.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

const seeded = (over: Record<string, unknown> = {}) => ({
  id: 'form-sample-facility', name: 'Facility', version_label: 'v1',
  fhir_resource_type: 'Location', fhir_version: 'R4', status: 'draft', active: true,
  schema: JSON.stringify({ id: 'sample-facility', fields: [] }),
  target_pages: JSON.stringify(['forms']),
  ...over,
});

describe('071_facility_form_target', () => {
  it('repoints and publishes an untouched seeded Facility form', async () => {
    const db = await makeMigratedDb();
    // Insert BEFORE 071 would have run in a real upgrade; here the table already exists, so write
    // the pre-071 state and re-run 071's up() directly.
    await db.insertInto('form_definitions' as never).values(seeded() as never).execute();
    const m = await import('./071_facility_form_target');
    await m.up(db);
    const row: any = await db.selectFrom('form_definitions' as never).selectAll()
      .where('id', '=', 'form-sample-facility').executeTakeFirstOrThrow();
    expect(JSON.parse(row.target_pages)).toEqual(['facilities']);
    expect(row.status).toBe('published');
  });

  it('⛔ leaves an EDITED form alone — an operator is never clobbered', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seeded({ target_pages: JSON.stringify(['forms']), schema: JSON.stringify({ id: 'sample-facility', fields: [{ id: 'mine' }] }) }) as never,
    ).execute();
    const m = await import('./071_facility_form_target');
    await m.up(db);
    const row: any = await db.selectFrom('form_definitions' as never).selectAll()
      .where('id', '=', 'form-sample-facility').executeTakeFirstOrThrow();
    expect(JSON.parse(row.target_pages)).toEqual(['forms']);
  });

  it('is a no-op when no seeded form exists', async () => {
    const db = await makeMigratedDb();
    const m = await import('./071_facility_form_target');
    await expect(m.up(db)).resolves.not.toThrow();
  });
});
```

⚠ Before writing the migration, run `grep -n "form_definitions" packages/db/src/schema/internal.ts` and confirm the real column names (`target_pages`, `status`, `schema`). Adjust the test's inserted row to match the actual table — the shape above is the expected one, not a guess to be trusted blindly.

- [ ] **Step 8: Write the migration**

Create `packages/db/src/migrations/internal/071_facility_form_target.ts`:

```typescript
import type { Kysely } from 'kysely';

// Facility registry slice 2: repoint an EXISTING install's seeded Facility form at the new
// Facilities page.
//
// Seeded forms are create-if-absent, deduped by NAME (`upsertPublishedForms`) and their schema is
// NEVER re-snapshotted, so editing the sample reaches fresh installs only. Without this migration an
// install that already carries the old draft would show an empty Facilities page forever.
//
// ⚠ It only touches a form that still looks UNTOUCHED — same id, still targeting ['forms'], and
// with no fields of its own. An operator who has already edited the form keeps it exactly as-is and
// sees the page's "no published facilities form" empty state instead. Silently rewriting their work
// would be worse than an empty page.
const SEEDED_ID = 'form-sample-facility';

export async function up(db: Kysely<any>): Promise<void> {
  const row = await db
    .selectFrom('form_definitions')
    .select(['id', 'target_pages', 'schema'])
    .where('id', '=', SEEDED_ID)
    .executeTakeFirst();
  if (!row) return; // never seeded here — nothing to repoint

  const targets = typeof row.target_pages === 'string' ? JSON.parse(row.target_pages) : row.target_pages;
  if (!Array.isArray(targets) || targets.length !== 1 || targets[0] !== 'forms') return; // already moved or customised

  const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
  const fields = (schema as { fields?: unknown[] })?.fields ?? [];
  // The shipped seed's fields all carry ids beginning `fld-fac-`; anything else means the operator
  // authored their own and must not be touched.
  const untouched = Array.isArray(fields) && fields.every((f) => String((f as { id?: string }).id ?? '').startsWith('fld-fac-'));
  if (!untouched) return;

  await db
    .updateTable('form_definitions')
    .set({ target_pages: JSON.stringify(['facilities']), status: 'published' } as never)
    .where('id', '=', SEEDED_ID)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('form_definitions')
    .set({ target_pages: JSON.stringify(['forms']) } as never)
    .where('id', '=', SEEDED_ID)
    .execute();
}
```

- [ ] **Step 9: Register the migration and update the pinned list**

Add `071_facility_form_target` to `packages/db/src/migrations/internal/index.ts`, following the `070_facility_registry` entry.

⚠ Then append `'071_facility_form_target'` to the expected array in `packages/db/src/migrations/migrations.test.ts` — that test asserts the exact ordered migration list and lives one directory ABOVE `migrations/internal/`, so a `--dir .../internal` test run will NOT catch it. This exact miss broke the gate in slice 1.

- [ ] **Step 10: Run the migration tests**

Run: `npx vitest run --dir packages/db/src/migrations`
Expected: PASS, including the migration-list assertion.

- [ ] **Step 11: Commit**

```bash
git add packages/forms/src/samples/forms.ts packages/forms/src/samples/forms.test.ts packages/forms/src/page-targets.ts packages/bootstrap/src/seed.ts packages/db/src/migrations/internal/071_facility_form_target.ts packages/db/src/migrations/internal/071_facility_form_target.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(forms): point the Facility form at the Facilities page and make it essential"
```

---

## Task 6: The Facilities page

**Files:**
- Create: `apps/studio/src/pages/Facilities.tsx`
- Create: `apps/studio/src/pages/Facilities.test.tsx`
- Create: `apps/studio/src/facilities/FacilityDialog.tsx`
- Modify: `apps/studio/src/api.ts`, `apps/studio/src/App.tsx`, `apps/studio/src/shell/AppShell.tsx`, `apps/studio/src/i18n/{en,fr,pt}.ts`

**Interfaces:**
- Consumes: the routes from Task 4.
- Produces: the `/facilities` page.

- [ ] **Step 1: Read the page being mirrored**

Read `apps/studio/src/pages/Users.tsx` and `apps/studio/src/users/UserDialog.tsx` in full. The dialog's form-loading block is the part to copy: `listPublishedForms(page)` → first summary → `getForm(summary.id)` → `FormSchemaZ.safeParse` → `FormRuntime`.

⚠ `def.id` (the form-DEFINITION id) is what downstream calls need — `schema.id` is the schema's own slug and 404s. `UserDialog` documents this; do not repeat the mistake.

- [ ] **Step 2: Add the API client**

In `apps/studio/src/api.ts`, beside the other resource clients, add:

```typescript
export interface Facility {
  id: string;
  localCode: string | null;
  nationalCode: string | null;
  name: string;
  level: string | null;
  status: string | null;
  country: string | null;
  zone: string | null;
  region: string | null;
  district: string | null;
  extras?: Record<string, unknown>;
}

export interface FacilitySubmit {
  answers: Record<string, unknown>;
  formSchemaId: string | null;
  formVersion: number | null;
}

export const listFacilities = (): Promise<Facility[]> =>
  authFetch('/api/facilities').then((r) => okJson<Facility[]>(r, 'list facilities'));

export const createFacility = (body: FacilitySubmit): Promise<Facility> =>
  authFetch('/api/facilities', jbody(body, 'POST')).then((r) => okJson<Facility>(r, 'create facility'));

export const updateFacility = (id: string, body: FacilitySubmit): Promise<Facility> =>
  authFetch(`/api/facilities/${encodeURIComponent(id)}`, jbody(body, 'PUT')).then((r) => okJson<Facility>(r, 'update facility'));

export const deleteFacility = (id: string): Promise<void> =>
  apiDelete(`/api/facilities/${encodeURIComponent(id)}`);
```

⚠ Confirm `apiDelete` is the helper name used by the neighbouring delete clients — `grep -n "apiDelete" apps/studio/src/api.ts`. If it differs, follow the existing one.

- [ ] **Step 3: Write the failing page test**

Create `apps/studio/src/pages/Facilities.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Facilities } from './Facilities';

vi.mock('@/api', () => ({
  listFacilities: vi.fn(async () => []),
  createFacility: vi.fn(),
  updateFacility: vi.fn(),
  deleteFacility: vi.fn(),
  listPublishedForms: vi.fn(async () => []),
  getForm: vi.fn(),
}));

import { listFacilities, listPublishedForms } from '@/api';

const show = () => render(<MemoryRouter><Facilities /></MemoryRouter>);

describe('Facilities page', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('⛔ distinguishes "no published form" from "no facilities yet"', async () => {
    // Three gates can each independently leave this page empty (page target unavailable, form not
    // targeting facilities, form still a draft). One merged "nothing here" message is how they stay
    // invisible — so the no-form case must name its own cause and point at the builder.
    (listFacilities as never as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listPublishedForms as never as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    show();
    await waitFor(() => expect(screen.getByText(/no facility form/i)).toBeInTheDocument());
  });

  it('shows the add action when a published form exists and there are no facilities', async () => {
    (listFacilities as never as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listPublishedForms as never as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'form-sample-facility', name: 'Facility' }]);
    show();
    await waitFor(() => expect(screen.getByText(/no facilities yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/no facility form/i)).not.toBeInTheDocument();
  });

  it('lists facilities with their code, name and region', async () => {
    (listPublishedForms as never as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'form-sample-facility', name: 'Facility' }]);
    (listFacilities as never as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', localCode: 'LAB01', nationalCode: null, name: 'Dodoma Regional Referral', level: 'Hospital', status: 'Operating', country: 'TZ', zone: 'Central', region: 'Dodoma Region', district: 'Dodoma' },
    ]);
    show();
    await waitFor(() => expect(screen.getByText('Dodoma Regional Referral')).toBeInTheDocument());
    expect(screen.getByText('LAB01')).toBeInTheDocument();
    expect(screen.getByText('Dodoma Region')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd apps/studio && npx vitest run src/pages/Facilities`
Expected: FAIL — `Cannot find module './Facilities'`.

- [ ] **Step 5: Write the page**

Create `apps/studio/src/pages/Facilities.tsx`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { MoreHorizontal, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { listFacilities, deleteFacility, listPublishedForms, type Facility } from '@/api';
import { FacilityDialog } from '@/facilities/FacilityDialog';

export function Facilities(): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasForm, setHasForm] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<Facility | null | undefined>(undefined); // undefined = closed
  const [confirming, setConfirming] = useState<Facility | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listFacilities());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // Whether a published facilities form exists is a DIFFERENT empty state from having no
  // facilities, and merging them hides a misconfiguration behind an innocuous message.
  useEffect(() => {
    let cancelled = false;
    void listPublishedForms('facilities')
      .then((forms) => { if (!cancelled) setHasForm(forms.length > 0); })
      .catch(() => { if (!cancelled) setHasForm(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading || hasForm === null) return <LoadingState />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">{t('facilities.title')}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('facilities.actions')}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!hasForm} onSelect={() => setEditing(null)}>
              {t('facilities.add')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {!hasForm ? (
        <EmptyState icon={Building2} title={t('facilities.noForm')} description={t('facilities.noFormHelp')}>
          <Link to="/forms" className="text-xs underline">{t('facilities.openForms')}</Link>
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={Building2} title={t('facilities.empty')} description={t('facilities.emptyHelp')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('facilities.code')}</TableHead>
              <TableHead>{t('facilities.name')}</TableHead>
              <TableHead>{t('facilities.region')}</TableHead>
              <TableHead>{t('facilities.district')}</TableHead>
              <TableHead>{t('facilities.status')}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="text-xs">{f.localCode ?? f.nationalCode ?? '—'}</TableCell>
                <TableCell className="text-xs">{f.name}</TableCell>
                <TableCell className="text-xs">{f.region ?? '—'}</TableCell>
                <TableCell className="text-xs">{f.district ?? '—'}</TableCell>
                <TableCell className="text-xs">{f.status ?? '—'}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`${t('facilities.actions')} ${f.name}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(f)}>{t('common.edit')}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setConfirming(f)}>{t('common.delete')}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing !== undefined && (
        <FacilityDialog
          open
          facility={editing}
          onOpenChange={(o) => { if (!o) setEditing(undefined); }}
          onSaved={() => { setEditing(undefined); void reload(); }}
        />
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => { if (!o) setConfirming(null); }}
        title={t('facilities.deleteTitle')}
        description={t('facilities.deleteBody', { name: confirming?.name ?? '' })}
        onConfirm={async () => {
          if (confirming) await deleteFacility(confirming.id);
          setConfirming(null);
          void reload();
        }}
      />
    </div>
  );
}

export default Facilities;
```

⚠ `EmptyState` and `ConfirmDialog` prop names must match the real components — read `apps/studio/src/components/ui/empty-state.tsx` and `confirm-dialog.tsx` and adjust the calls above to their actual signatures rather than assuming.

- [ ] **Step 6: Write the dialog**

Create `apps/studio/src/facilities/FacilityDialog.tsx`, following `apps/studio/src/users/UserDialog.tsx`'s structure: load the first published `facilities` form, `FormSchemaZ.safeParse` it, render `<FormRuntime>`, and on submit call `createFacility` or `updateFacility` with `{ answers, formSchemaId: def.id, formVersion }`.

Seed answers when editing by mapping each field's `apiProperty` back to the facility's value:

```typescript
function seedAnswers(schema: FormSchema, facility: Facility): RuntimeAnswers {
  const answers: RuntimeAnswers = {};
  const asRecord = facility as unknown as Record<string, unknown>;
  for (const field of schema.fields) {
    const ap = field.apiProperty;
    if (!ap) continue;
    // Core columns live on the facility itself; everything else was routed to `extras`.
    const value = Object.hasOwn(asRecord, ap) ? asRecord[ap] : facility.extras?.[ap];
    if (value !== undefined && value !== null && value !== '') answers[field.id] = value;
  }
  return answers;
}
```

- [ ] **Step 7: Run the page tests**

Run: `cd apps/studio && npx vitest run src/pages/Facilities`
Expected: PASS, 3 tests.

- [ ] **Step 8: Route, nav and i18n**

In `apps/studio/src/App.tsx`, add the route beside the other top-level pages:

```typescript
<Route path="/facilities" element={<RequireCapability cap="facilities.view"><Facilities /></RequireCapability>} />
```

In `apps/studio/src/shell/AppShell.tsx`, add the nav entry after the Terminology one:

```typescript
  { to: '/facilities', labelKey: 'nav.facilities', end: false, icon: Building2, caps: ['facilities.view'] },
```

Add every `facilities.*` and `nav.facilities` key to all three of `apps/studio/src/i18n/{en,fr,pt}.ts` with REAL fr and pt translations (parity is enforced). Keys needed: `nav.facilities`, `facilities.title`, `.actions`, `.add`, `.code`, `.name`, `.region`, `.district`, `.status`, `.empty`, `.emptyHelp`, `.noForm`, `.noFormHelp`, `.openForms`, `.deleteTitle`, `.deleteBody`, plus `common.edit`/`common.delete` if they do not already exist.

⚠ Do NOT put `{{...}}` token syntax inside a translated string as example text — i18next parses it as an interpolation and renders an empty gap. (This shipped twice already.)

- [ ] **Step 9: Run the studio suite**

Run: `cd apps/studio && npx vitest run src/pages/Facilities src/i18n src/shell`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/studio/src/pages/Facilities.tsx apps/studio/src/pages/Facilities.test.tsx apps/studio/src/facilities/FacilityDialog.tsx apps/studio/src/api.ts apps/studio/src/App.tsx apps/studio/src/shell/AppShell.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Facilities page driven by the Facility form"
```

---

## Task 7: Gate and merge

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 67 successful, 67 total`.

⚠ If a package you did not touch fails, run it alone before blaming this work — parallel-turbo flakes are documented. `grep 'Test timed out'` distinguishes a timeout from a real failure. In slice 1 a studio `ReferencePicker` test flaked exactly this way.

- [ ] **Step 2: Merge**

```bash
git checkout main
git merge --no-ff slice/facility-registry-slice-2 -m "Merge: facility registry slice 2 (hand entry)"
git branch -d slice/facility-registry-slice-2
```

- [ ] **Step 3: Report what is NOT done**

Still missing after this slice, and none of it should be claimed: reconciliation of the 23 observed `performer` strings, the entity resolver so a lab order can reference a facility, the CLI import, `upsertByNationalCode`, and sync serve/apply. Also note that `nationalCode` is deliberately absent from the form, so a hand-entered facility cannot yet be linked to the national register from the UI.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 wiring the store | Task 2 |
| §4 the split | Task 1 |
| §5 routes + capabilities | Tasks 3, 4 |
| §6 form, page target, delivery migration | Task 5 |
| §7 the page + its two empty states | Task 6 |
| §8 testing | each task's own tests |

**Deliberately deferred:** everything in spec §9, restated in Task 7 Step 3.

**Type consistency:** `splitFacilityAnswers(fields, answers)` is positional and takes a field LIST (not a `FormSchema`) in Task 1's definition, Task 4's call, and both test suites. `Facility` in the studio client mirrors the columns the routes return. `apiProperty` values in Task 5's form exactly match `CORE_FACILITY_KEYS` from Task 1 — `localCode`, `name`, `country`, `zone`, `region`, `district`, `status`, `level`.

**Known plan risk:** Task 6's `EmptyState` / `ConfirmDialog` / `FormRuntime` prop shapes are written from their usage in `Users.tsx`, not from the component definitions. Each step that uses them says to read the real component first and adjust. That is the most likely place an implementer needs to deviate.
