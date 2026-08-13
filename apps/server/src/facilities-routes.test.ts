import { randomUUID, createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import {
  createTerminologyAdminStore, createFacilityRegistryStore, createFacilityJobStore,
  createFacilityRegisterSourceStore,
  DEFAULT_OBSERVED_FACILITY_SYSTEM, FACILITY_REGISTRY_SYSTEM, DEFAULT_LIST_LIMIT, APPLY_PHASE,
} from '@openldr/db';
import { projectRegistryRows } from '@openldr/bootstrap';
import { registerFacilitiesRoutes } from './facilities-routes';
// The over-cap upload test registers the REAL central error handler, as production does, so its 413
// carries the app-wide {error, code, correlationId} contract rather than a bespoke body.
import { registerErrorHandler } from './error-handler';

const FORM_FIELDS = [
  { id: 'f1', apiProperty: 'localCode' },
  { id: 'f2', apiProperty: 'name' },
  { id: 'f3', apiProperty: 'region' },
  { id: 'f4', apiProperty: 'catchmentPop' },
  // `level` is a CONTROLLED field, so a payload that carries f5 reaches `controlledFieldsError`.
  // The baseline `body` below deliberately omits it, which keeps every pre-existing test on the
  // guard's `submitted.length === 0` short-circuit exactly as before.
  { id: 'f5', apiProperty: 'level' },
  // The national pair. Also absent from the baseline `body`, so POST's id derivation stays on its
  // `randomUUID()` branch for every pre-existing test.
  { id: 'f6', apiProperty: 'nationalCode' },
  { id: 'f7', apiProperty: 'nationalSystem' },
];

// A resolvable form whose fields map onto NONE of CORE_FACILITY_KEYS — the "wrong form" case (Q2):
// a Patient form's `formSchemaId`, submitted to the facilities endpoint by mistake or otherwise,
// must not pass just because it resolves and its field list is non-empty.
const PATIENT_FORM_FIELDS = [
  { id: 'p1', apiProperty: 'patientName' },
  { id: 'p2', apiProperty: 'dateOfBirth' },
];

// Task 5 follow-up: a form that maps a field onto a GENERIC core key (`name` — also used by the
// Users page, say) but was never pointed at the facilities page in the builder's target picker.
// `hasCoreField` alone would pass this (it only checks whether ANY field maps to a core column),
// which is exactly the gap `targetsFacilitiesPage` closes — see facilities-routes.ts.
const GENERIC_CORE_FIELD_FORM_FIELDS = [{ id: 'g1', apiProperty: 'name' }];

// Fix 2 regression guard: a form that DOES target facilities (so `targetsFacilitiesPage` passes)
// but maps NONE of its fields onto a CORE_FACILITY_KEYS column — `hasCoreField` must reject this
// independently. Every other `targetPages: ['facilities']` fixture in this file (FORM_FIELDS,
// and form-real-shape below) happens to ALSO carry a core field, so without this fixture and the
// test built on it, stubbing `hasCoreField` to `() => true` would leave every test in this file
// green — see hasCoreField's doc comment in facilities-routes.ts.
const NO_CORE_FIELD_FORM_FIELDS = [{ id: 'n1', apiProperty: 'notes' }];

/** A minimal in-memory `FacilityJobStore` double for `fakeCtx()`, which has no real db to hand
 *  `createFacilityJobStore` (packages/db). It mirrors just enough of the real store's coalescing
 *  contract — one 'queued' job per identity, `enqueue` reports `coalesced: true` rather than
 *  inserting a second one — since the routes' own enqueue calls rely on that to not need any
 *  de-duplication of their own (see facility-job-store.ts's `activeKeyFor` for the real rule).
 *
 *  ⚠ Identity is NOT simply the kind, and a stale version of this comment claimed it was: POST/PUT
 *  also enqueue 'registry-projection' with a `registryId` when a projection fails, and the real
 *  store keys those on `registry-projection:<id>`. Coalescing on the bare kind here would make two
 *  DIFFERENT facilities' retry jobs absorb each other — the second facility silently losing its
 *  repair — which the production store does not do. `activeKey` below mirrors `activeKeyFor` exactly
 *  so a test cannot pass against a coalescing rule the real store does not have. */
function fakeFacilityJobStore() {
  const jobs: any[] = [];
  const activeKey = (kind: string, registryId: string | null) => (
    kind === 'registry-projection' ? `${kind}:${registryId ?? ''}` : kind
  );
  return {
    async enqueue(input: { kind: string; registryId?: string | null; requestedBy?: string | null }) {
      const key = activeKey(input.kind, input.registryId ?? null);
      if (jobs.some((j) => activeKey(j.kind, j.registryId) === key && j.status === 'queued')) {
        return { job: null, coalesced: true };
      }
      const job = {
        id: `fj-${jobs.length}`, kind: input.kind, status: 'queued', attempts: 0,
        lastError: null, registryId: input.registryId ?? null, resultCount: null,
        requestedBy: input.requestedBy ?? null, requestedAt: new Date().toISOString(),
        startedAt: null, finishedAt: null,
      };
      jobs.push(job);
      return { job, coalesced: false };
    },
    async listUnresolved() {
      return jobs.filter((j) => j.status === 'queued' || j.status === 'running');
    },
    __jobs: jobs,
    // Test-only escape hatch: simulates the worker having drained every job enqueued so far, the
    // same way `finish()` would on the real store. Needed because coalescing means a job an EARLIER
    // mutation enqueued is still sitting `queued` when a LATER mutation's own `enqueue` call runs —
    // that later call coalesces onto it (correctly), so a test isolating the later mutation's own
    // enqueue behaviour must first clear the earlier one, or the assertion passes trivially off the
    // earlier job even with the later mutation's enqueue call deleted entirely.
    __resolveAll() {
      for (const j of jobs) j.status = 'done';
    },
  };
}

/** A `ctx.internalDb` double for `fakeCtx()`, which has no real db. `projectRegistryRows`
 *  (packages/bootstrap/src/facility-reconcile.ts) — which POST/PUT call on every mutation — reads
 *  `facility_registry` and `facility_concept_projection` through `ctx.internalDb` on its way, so this
 *  has to answer those reads without crashing.
 *
 *  Every terminal read resolves EMPTY regardless of which table was queried. That is not a shortcut —
 *  it is the TRUTH for this fixture: there is no real `facility_registry`/`facility_concept_projection`
 *  behind it (`fakeCtx()`'s own `facilityRegistry` above is a separate in-memory `rows` array, not a
 *  Kysely table this double can see), so nothing is genuinely projected through it. Nothing FAILS
 *  either, so `projectRegistryRows` reports `true` and these routes answer `projection: 'ok'` — an
 *  honest report of "no failure was observed", not a claim that a concept landed; real projection
 *  outcomes are asserted against a REAL migrated db by `fakeCreateCtx` in the describe blocks below.
 *  Before this double existed, `projectRegistryRows`' own try/catch silently absorbed the `TypeError`
 *  from calling `.selectFrom` on the then-ABSENT `ctx.internalDb`.
 *
 *  ⚠ The ALLOWLIST is deliberate, and narrow on purpose: it is exactly the surface measured as
 *  reachable across this file's tests. A blanket "answer every property with another chain link"
 *  Proxy cannot distinguish a real Kysely call from a typo or a method that does not exist — it would
 *  answer `.wehre(...)` just as cheerfully and hand back an empty result, turning a genuine bug into a
 *  silently passing test. Anything outside the set throws instead; widening it is a one-line change
 *  once a new call is measured.
 *
 *  ⚠ That throw does NOT by itself fail a test on the projection path: `projectRegistryRows` and
 *  `reprojectAfterRegistryDelete` contain their own errors, so it surfaces as their `console.error`
 *  plus `projection: 'queued-for-retry'` rather than as an assertion failure (measured — deleting
 *  `where` from the set below produces exactly that). It is loud, and it moves a wrong call from
 *  "answered plausibly" to "reported", which is the point; a call reaching this double from route
 *  code OUTSIDE that containment would fail the test outright.
 *
 *  `then` is excluded ON PURPOSE and returns `undefined`: without that,
 *  `await`ing an intermediate builder by mistake makes the runtime treat the chain as a thenable and
 *  call it forever, and the test hangs to its timeout rather than failing with a usable message. */
function emptyInternalDb(): any {
  const BUILDER_METHODS = new Set(['selectFrom', 'select', 'where']);
  const chain: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === 'execute') return async () => [];
      if (prop === 'executeTakeFirst') return async () => undefined;
      if (typeof prop === 'symbol') return undefined;
      if (BUILDER_METHODS.has(prop)) return (..._args: any[]) => chain;
      throw new Error(`emptyInternalDb: unexpected Kysely call '${String(prop)}' — see this double's doc comment`);
    },
  });
  return chain;
}

function fakeCtx() {
  const rows: any[] = [];
  const audit: any[] = [];
  // Keyed by form id so a test can submit an id that does NOT resolve (`ctx.forms.get` returns
  // `undefined`), distinct from the happy-path id used by every baseline test.
  //
  // `targetPages` is set at the TOP level of each form object, matching the real
  // `packages/forms/src/store.ts`'s `toDefinition` return shape (an already-parsed array on
  // `FormDefinition.targetPages`, never a JSON string, never nested under `schema`) — the route's
  // `resolveForm`/`targetsFacilitiesPage` read exactly that property. See the "Task 5" test below
  // for a fixture built to look unmistakably like a real store row, not just this shorthand.
  const forms: Record<string, any> = {
    'form-sample-facility': { id: 'form-sample-facility', schema: { fields: FORM_FIELDS }, targetPages: ['facilities'] },
    'form-patient': { id: 'form-patient', schema: { fields: PATIENT_FORM_FIELDS }, targetPages: ['forms'] },
    'form-generic-core-field': {
      id: 'form-generic-core-field',
      schema: { fields: GENERIC_CORE_FIELD_FORM_FIELDS },
      targetPages: ['users'],
    },
    'form-no-core-field': {
      id: 'form-no-core-field',
      schema: { fields: NO_CORE_FIELD_FORM_FIELDS },
      targetPages: ['facilities'],
    },
  };
  // Captures whatever options object actually reached `list()`, so tests can assert on what the
  // route computed rather than merely on the response's statusCode (a fake `list` that discards
  // its argument makes query-param sanitisation tests tautological — see Q1).
  let lastListOptions: any;
  // Same reasoning as lastListOptions, for the Task 3 admin-values endpoint: captures the exact
  // (level, scope) the route computed, so a test can assert the route forwarded a good value
  // AND withheld a bad one, rather than merely reading the HTTP response.
  let lastAdminValuesCall: any;
  return {
    internalDb: emptyInternalDb(),
    audit: { record: async (e: any) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    forms: { get: async (formId: string) => forms[formId] },
    facilityJobs: fakeFacilityJobStore(),
    facilityRegistry: {
      // Task 3: `list()`'s real contract (Task 1) is `{ rows, total }`, not a bare array — this
      // fake must match it or the route's `const { rows, total } = await ...list(...)` destructures
      // `undefined` for both. Filters/health are NOT applied here (this fake exists to prove the
      // ROUTE forwards/sanitises the right options, captured in `lastListOptions` below — the
      // store's OWN filtering/paging SQL is exercised for real in
      // facility-registry-store.test.ts and in the "Task 3: GET /api/facilities paging, search
      // and filters" describe block further down, which uses the real store against a real
      // migrated db).
      list: async (opts?: any) => { lastListOptions = opts; return { rows, total: rows.length }; },
      distinctAdminValues: async (level: any, scope?: any) => {
        lastAdminValuesCall = { level, scope };
        // A small canned, already-ranked/counted response — the STORE's actual ranking/counting/
        // scoping SQL is exercised for real in packages/db/src/facility-registry-store.test.ts;
        // this fake only needs to prove the ROUTE forwards the right level/scope and returns
        // whatever the store hands back.
        return [{ value: 'Dodoma', count: 2 }, { value: 'Kongwa', count: 1 }];
      },
      get: async (id: string) => rows.find((r) => r.id === id),
      upsert: async (rec: any) => {
        const i = rows.findIndex((r) => r.id === rec.id);
        // Mirror the real store's UNIQUE(local_code) constraint (SQLSTATE 23505) so the route's
        // error-mapping (I3) has something real to map.
        const dupe = rows.find((r) => r.id !== rec.id && rec.localCode != null && r.localCode === rec.localCode);
        if (dupe) {
          const err: any = new Error('duplicate key value violates unique constraint "facility_registry_local_code_key"');
          err.code = '23505';
          throw err;
        }
        if (i >= 0) rows[i] = rec; else rows.push(rec);
        return rec;
      },
      remove: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); },
    },
    // Fix 1 (mapping-ux report): POST/PUT now project the written row into FACILITY_REGISTRY_SYSTEM
    // (`projectRegistryRows`). This file's ~100 other POST/PUT tests don't care about that
    // projection at all — a minimal in-memory double (never asserted on here) is enough to keep the
    // route from crashing on `ctx.terminology.admin`; the real projection behaviour is exercised
    // against a REAL TerminologyAdminStore in the dedicated describe block below.
    terminology: {
      admin: {
        codingSystems: {
          upsertByUrl: async () => {},
          getByUrl: async () => ({ id: 'cs-facility-registry', active: true } as any),
        },
        terms: { importRows: async () => ({ imported: 0 }) },
      },
    },
    __rows: rows,
    __audit: audit,
    get __lastListOptions() { return lastListOptions; },
    get __lastAdminValuesCall() { return lastAdminValuesCall; },
  } as any;
}

async function appWith(ctx: any, capabilities: string[] = ['facilities.view', 'facilities.manage']) {
  const app = Fastify();
  app.addHook('onRequest', async (req: any) => { req.user = { id: 'u1', capabilities }; });
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
    // Task 3: the response is now `{ rows, total, limit, offset }`, not a bare array.
    expect(res.json().rows).toHaveLength(1);
  });

  // --- C1: PUT must be able to clear a previously-filled core text field ---------------------

  it('C1: PUT with a blanked field NULLs the column instead of keeping the stale value', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
    expect(ctx.__rows[0].region).toBe('Dodoma Region');

    const cleared = { ...body, answers: { ...body.answers, f3: '' } };
    const res = await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: cleared });
    expect(res.statusCode).toBe(200);
    expect(res.json().region ?? null).toBeNull();
    expect(ctx.__rows[0].region ?? null).toBeNull();
  });

  it('C1: PUT clearing the only identifying code (leaving both codes null) is a 400, not a write', async () => {
    // The facility from `body` only ever has a localCode (the form has no nationalCode field), so
    // blanking f1 would leave BOTH local_code and national_code null — the DB's
    // `facility_registry_has_a_code` CHECK constraint.
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;

    const cleared = { ...body, answers: { ...body.answers, f1: '' } };
    const res = await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: cleared });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/local code|national code/i);
    // Nothing was written — the pre-existing localCode survives.
    expect(ctx.__rows[0].localCode).toBe('LAB01');
  });

  it('C1/I4: PUT that blanks the name is a 400, never a null write (NOT NULL column)', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;

    const cleared = { ...body, answers: { ...body.answers, f2: '' } };
    const res = await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: cleared });
    expect(res.statusCode).toBe(400);
    expect(ctx.__rows[0].name).toBe('Dodoma Regional Referral');
  });

  // --- C2: an unresolvable form must never wipe extras with a silent 200 ----------------------

  it('C2: POST with an unresolvable form is a 400, not a write with everything dropped', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...body, formSchemaId: 'no-such-form' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/form/i);
  });

  it('C2: POST with no formSchemaId at all is a 400 (resolveForm also resolves to [])', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { answers: body.answers },
    });
    expect(res.statusCode).toBe(400);
  });

  it('C2: PUT with an unresolvable form is a 400 and does NOT wipe the existing extras bag', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
    expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });

    const res = await app.inject({
      method: 'PUT', url: `/api/facilities/${id}`,
      payload: { ...body, formSchemaId: 'no-such-form' },
    });
    expect(res.statusCode).toBe(400);
    // The extras bag from the original create must survive untouched.
    expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });
  });

  // --- Q2: a RESOLVABLE but UNRELATED form must never wipe extras with a silent 200 -----------
  // (distinct from C2 above: `fields.length > 0` here, so the empty-field-list guard alone does
  // NOT catch this — the guard checked the wrong invariant.)

  it('Q2: PUT with a resolvable-but-unrelated form (a Patient form) is a 400, not a write that replaces extras', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
    expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });

    const res = await app.inject({
      method: 'PUT', url: `/api/facilities/${id}`,
      payload: { answers: { p1: 'John Doe', p2: '2000-01-01' }, formSchemaId: 'form-patient', formVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/facility/i);
    // C2's exact failure mode — silent data loss behind a 200 — reached through a form that
    // resolves and has fields, unlike the C2 tests above.
    expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });
    expect(ctx.__rows[0].localCode).toBe('LAB01');
    expect(ctx.__audit.map((a: any) => a.action)).toEqual(['facility.create']); // no facility.update was recorded
  });

  it('Q2: POST with a resolvable-but-unrelated form is a 400, not a facility built from another form\'s answers', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { answers: { p1: 'John Doe', p2: '2000-01-01' }, formSchemaId: 'form-patient', formVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/facility/i);
  });

  // --- Task 5 follow-up: `hasCoreField` alone is only a PROXY for "this is the facilities form" —
  // a form that maps a field onto a generic core key (`name`) but was never pointed at the
  // facilities page in the builder must still be rejected. Without `targetsFacilitiesPage`,
  // `hasCoreField` alone would pass GENERIC_CORE_FIELD_FORM_FIELDS (it maps `g1` -> `name`, a real
  // CORE_FACILITY_KEYS entry) and let a holder of `facilities.manage` drive the split with an
  // unrelated form's field list, replacing `extras` on PUT.

  it('Task 5: PUT with a form that maps a generic core key but does not target facilities is a 400, not a write that replaces extras', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
    expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });

    const res = await app.inject({
      method: 'PUT', url: `/api/facilities/${id}`,
      payload: { answers: { g1: 'Hijacked Name' }, formSchemaId: 'form-generic-core-field', formVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/facility/i);
    expect(res.json().error).toMatch(/target/i);
    // The split never ran — extras and the pre-existing name both survive untouched.
    expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });
    expect(ctx.__rows[0].name).toBe('Dodoma Regional Referral');
    expect(ctx.__audit.map((a: any) => a.action)).toEqual(['facility.create']); // no facility.update recorded
  });

  it('Task 5: POST with a form that maps a generic core key but does not target facilities is a 400', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { answers: { g1: 'Hijacked Name' }, formSchemaId: 'form-generic-core-field', formVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/facility/i);
    expect(res.json().error).toMatch(/target/i);
  });

  it('Task 5: the seeded facility form — carrying targetPages exactly as the real store returns it — is accepted', async () => {
    // Deliberately hand-built to look like `packages/forms/src/store.ts`'s `toDefinition` output
    // rather than reusing the `fakeCtx` shorthand: a top-level `targetPages` array (never a JSON
    // string, never nested under `schema`), plus the other fields a real FormDefinition row
    // carries, so this test would catch the route reading the wrong property name.
    const ctx = fakeCtx();
    (ctx.forms as any).get = async (formId: string) => {
      if (formId !== 'form-real-shape') return undefined;
      return {
        id: 'form-real-shape',
        name: 'Facility',
        versionLabel: null,
        fhirResourceType: 'Location',
        fhirVersion: null,
        fhirProfileUrl: null,
        facilityId: null,
        status: 'published',
        active: true,
        schema: { fields: FORM_FIELDS },
        targetPages: ['facilities'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
    };
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...body, formSchemaId: 'form-real-shape' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().localCode).toBe('LAB01');
  });

  // --- Fix 2: hasCoreField's own rejection must still be reachable, distinct from the
  // targetsFacilitiesPage rejection above -----------------------------------------------------

  it('Fix2: POST with a form that targets facilities but maps no field to a core key is a 400 for "no facility fields", not the target-page message', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { answers: { n1: 'some note' }, formSchemaId: 'form-no-core-field', formVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no facility fields/i);
    // Distinguish this from targetsFacilitiesPage's rejection message — this form DOES target
    // facilities, so the failure must be attributed to the field list, not the target page.
    expect(res.json().error).not.toMatch(/target/i);
  });

  it('Fix2: PUT with a form that targets facilities but maps no field to a core key is a 400 for "no facility fields", not a write that replaces extras', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
    expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });

    const res = await app.inject({
      method: 'PUT', url: `/api/facilities/${id}`,
      payload: { answers: { n1: 'some note' }, formSchemaId: 'form-no-core-field', formVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/no facility fields/i);
    expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });
    expect(ctx.__audit.map((a: any) => a.action)).toEqual(['facility.create']); // no facility.update recorded
  });

  // --- Task 1: importer-written `extras` keys the edit form does not map must survive a PUT ---
  // (the CSV importer writes unrecognised columns into `extras` under raw header names —
  // `seedAnswers` on the client only iterates the FORM's fields, so an edit form built before an
  // import never asks about those keys, and a wholesale `extras: extras` assignment on PUT used to
  // drop them silently. See facilities-routes.ts's `mappedExtrasKeys`.)

  describe('Task 1: extras preserved through an edit', () => {
    it('an extras key the submitted form does NOT map survives a PUT untouched', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
      expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });

      // Simulate an importer-written extra under a raw CSV header name — no field in FORM_FIELDS
      // maps to it, so the edit form submitted below never asks about it.
      ctx.__rows[0].extras = { ...ctx.__rows[0].extras, 'Imported Region Code': 'TZ-01' };

      const res = await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: body });
      expect(res.statusCode).toBe(200);
      expect(res.json().extras).toEqual({ catchmentPop: '42000', 'Imported Region Code': 'TZ-01' });
      expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000', 'Imported Region Code': 'TZ-01' });
    });

    it('an extras key the form DOES map is still updated by the submission', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
      expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });

      const updated = { ...body, answers: { ...body.answers, f4: '99000' } };
      const res = await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: updated });
      expect(res.statusCode).toBe(200);
      expect(res.json().extras).toEqual({ catchmentPop: '99000' });
      expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '99000' });
    });

    it('clearing a form-mapped extra still removes it (must not be traded away for the fix above)', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
      expect(ctx.__rows[0].extras).toEqual({ catchmentPop: '42000' });

      const cleared = { ...body, answers: { ...body.answers, f4: '' } };
      const res = await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: cleared });
      expect(res.statusCode).toBe(200);
      expect(res.json().extras).toEqual({});
      expect(ctx.__rows[0].extras).toEqual({});
    });

    it('PUT {answers:{}} no longer wipes unmapped importer keys', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
      ctx.__rows[0].extras = { ...ctx.__rows[0].extras, 'Imported Region Code': 'TZ-01' };

      const res = await app.inject({
        method: 'PUT', url: `/api/facilities/${id}`,
        payload: { answers: {}, formSchemaId: 'form-sample-facility', formVersion: 1 },
      });
      expect(res.statusCode).toBe(200);
      // The unmapped importer key survives untouched even though this submission answered nothing.
      expect(res.json().extras).toEqual({ 'Imported Region Code': 'TZ-01' });
      expect(ctx.__rows[0].extras).toEqual({ 'Imported Region Code': 'TZ-01' });
    });
  });

  // --- I3: ordinary operator input must never produce a raw 500 ------------------------------

  it('I3: a duplicate local code is a 409 with a human message, not a raw 500', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const first = await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...body, answers: { ...body.answers, f2: 'A Different Facility' } },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).not.toMatch(/violates unique constraint/i);
  });

  // --- I4: a facility can never be created with an empty name ---------------------------------

  it('I4: POST with a blank name is a 400, not a row sorted to the top of the register', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...body, answers: { ...body.answers, f2: '' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('I4: POST whose form never maps a name field is a 400', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...body, answers: { f1: 'LAB02', f3: 'Dodoma Region' } },
    });
    expect(res.statusCode).toBe(400);
  });

  // --- Q3: POST and PUT must agree on a non-string name, and neither may write one -----------

  it('Q3: POST with a non-string name is a 400 "name must be text", not the misleading "required"', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...body, answers: { ...body.answers, f2: 42 } },
    });
    expect(res.statusCode).toBe(400);
    // A name WAS supplied — "required" would be a lie. Pin the actual (distinct) message so this
    // test fails if the two error paths drift back apart.
    expect(res.json().error).toBe('name must be text');
  });

  it('Q3: PUT with a non-string name is a 400 and never stores the raw JS value in the text column', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;

    const res = await app.inject({
      method: 'PUT', url: `/api/facilities/${id}`,
      payload: { ...body, answers: { ...body.answers, f2: 42 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('name must be text');
    // Not coerced into the DB as the number 42 — the original string survives.
    expect(ctx.__rows[0].name).toBe('Dodoma Regional Referral');
  });

  // --- I5: capability gating must actually be exercised by the tests -------------------------

  it('I5: a user without facilities.view cannot read', async () => {
    const app = await appWith(fakeCtx(), []);
    const list = await app.inject({ method: 'GET', url: '/api/facilities' });
    expect(list.statusCode).toBe(403);
    const one = await app.inject({ method: 'GET', url: '/api/facilities/whatever' });
    expect(one.statusCode).toBe(403);
  });

  it('I5: a user with facilities.view but not facilities.manage cannot create, update or delete', async () => {
    const ctx = fakeCtx();
    const viewOnly = await appWith(ctx, ['facilities.view']);

    const create = await viewOnly.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(create.statusCode).toBe(403);

    // Seed a row through a fully-privileged app instance sharing the same ctx, so update/delete
    // have something real to act on.
    const manager = await appWith(ctx);
    const id = (await manager.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;

    const update = await viewOnly.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: body });
    expect(update.statusCode).toBe(403);

    const del = await viewOnly.inject({ method: 'DELETE', url: `/api/facilities/${id}` });
    expect(del.statusCode).toBe(403);

    // Nothing a view-only actor attempted actually happened.
    expect(ctx.__rows).toHaveLength(1);
  });

  // --- Minor: bad/adversarial query params must never reach Postgres as a 500 -----------------

  it('ignores a non-numeric limit instead of passing NaN through to the store', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    const res = await app.inject({ method: 'GET', url: '/api/facilities?limit=abc' });
    expect(res.statusCode).toBe(200);
    // Must reach the store as "not specified" (undefined) — never as `Number('abc')` === NaN,
    // which `.limit(NaN)` is not the same thing as "no limit clause" for.
    expect(ctx.__lastListOptions.limit).toBeUndefined();
  });

  it('ignores a non-positive limit', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/facilities?limit=-5' });
    expect(res.statusCode).toBe(200);
    expect(ctx.__lastListOptions.limit).toBeUndefined();
  });

  it('tolerates a repeated limit param (Fastify parses it as an array)', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/facilities?limit=1&limit=2' });
    expect(res.statusCode).toBe(200);
    // `Number(['1','2'])` is NaN — the sanitiser must reject the array outright, not stringify it
    // and not let it through as an array either.
    expect(ctx.__lastListOptions.limit).toBeUndefined();
  });

  it('tolerates a repeated filter param instead of passing an array to the store', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/facilities?region=A&region=B' });
    expect(res.statusCode).toBe(200);
    // Must reach the store as undefined ("not specified") — never as the raw ['A','B'] array,
    // which Kysely's `.where('region', '=', [...])` does not mean "repeated param, take neither".
    expect(ctx.__lastListOptions.region).toBeUndefined();
  });

  // --- Positive direction: a GOOD param must actually reach the store, not just a bad one being
  // dropped. Every test above only proves parseLimit/firstString reject junk; none of them prove a
  // valid value survives the trip — a `parseLimit`/`firstString` stubbed to `() => undefined` would
  // leave the whole suite above green while every request silently fell back to the store's own
  // 200-row default and every filter silently became a no-op behind a 200. That regression is live
  // stakes now, not hypothetical: the studio registry page (Facilities.tsx) pages a 10-15k-row
  // register by sending an explicit `limit` (`PAGE_SIZE`, currently 50) plus whatever filters are
  // active on EVERY load, filter change and page turn — a dropped `limit` or filter would silently
  // widen or narrow what the operator sees with no error and no visual sign anything was wrong.

  it('a valid ?limit reaches the store as the number, not a string', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/facilities?limit=50' });
    expect(res.statusCode).toBe(200);
    expect(ctx.__lastListOptions.limit).toBe(50);
  });

  it('a valid ?region reaches the store as the string', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/facilities?region=Dodoma' });
    expect(res.statusCode).toBe(200);
    expect(ctx.__lastListOptions.region).toBe('Dodoma');
  });

  // --- Task 3: GET /api/facilities returns { rows, total, limit, offset } and forwards paging/
  // search/filters (incl. the new `health` whitelist) to the store --------------------------

  describe('Task 3: GET /api/facilities paging, search and filters', () => {
    it('treats a negative, NaN or repeated offset as absent rather than passing it through', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      for (const bad of ['offset=-1', 'offset=abc', 'offset=1&offset=2']) {
        const res = await app.inject({ method: 'GET', url: `/api/facilities?${bad}` });
        expect(res.statusCode, bad).toBe(200);
        expect(res.json().offset, bad).toBe(0);
      }
    });

    it('accepts offset=0 explicitly', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities?offset=0' });
      expect(res.json().offset).toBe(0);
    });

    it('passes search and the new filters through to the store', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities?q=alpha&health=unmapped&level=dispensary' });
      const body2 = res.json();
      expect(body2.total).toBeTypeOf('number');
      expect(Array.isArray(body2.rows)).toBe(true);
      // Stronger than the response shape alone (this file's established pattern, e.g. "a valid
      // ?region reaches the store" above): prove the route actually FORWARDED the sanitised values,
      // not merely that it didn't crash.
      expect(ctx.__lastListOptions).toMatchObject({ q: 'alpha', health: 'unmapped', level: 'dispensary' });
    });

    // Regression net for the full forwarding contract: the handler reads SIXTEEN keys off `q` and
    // hands them to `ctx.facilityRegistry.list(...)` (q, country, zone, region, district, council,
    // status, level, ownership, nationalSystem, source, managedOrigin, registerState, health, limit,
    // offset — Task 10 added `registerState`). The test above only ever exercised three of them
    // (q/health/level) via `toMatchObject`, which ignores any key not named in the expectation — so
    // `country`, `zone`, `ownership`, `nationalSystem`, `source`, `managedOrigin` and `registerState`
    // had NO regression net: deleting or mistyping any one of their `ownFirstString(q, '…')` lines in
    // the route left every test in this file green. There is also no compile-time guard here (the
    // handler has no return-type annotation), so this test is the ONLY thing pinning the forwarding
    // contract.
    //
    // Every param below is set to a distinct, recognisable value, and the assertion is `toEqual`
    // against a COMPLETE expected object — not `toMatchObject` — specifically so it fails both when a
    // key stops being forwarded (a route line deleted/mistyped) AND when a new key is read off `q`
    // and forwarded without a matching addition here (an extra key makes the actual object no longer
    // deep-equal the expected one). That is the property `toMatchObject` cannot give: it only checks
    // that the listed keys match, so it would stay green even if the route silently stopped
    // forwarding an unlisted key.
    it('passes every filter param the route reads through to the store, not just q/health/level', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const qs = [
        'q=alpha', 'country=country-val', 'zone=zone-val', 'region=region-val', 'district=district-val',
        'council=council-val', 'status=status-val', 'level=level-val', 'ownership=ownership-val',
        'nationalSystem=nationalSystem-val', 'source=source-val', 'managedOrigin=managedOrigin-val',
        'registerState=registerState-val', 'health=unmapped', 'limit=7', 'offset=3',
      ].join('&');
      const res = await app.inject({ method: 'GET', url: `/api/facilities?${qs}` });
      expect(res.statusCode).toBe(200);
      expect(ctx.__lastListOptions).toEqual({
        q: 'alpha',
        country: 'country-val',
        zone: 'zone-val',
        region: 'region-val',
        district: 'district-val',
        council: 'council-val',
        status: 'status-val',
        level: 'level-val',
        ownership: 'ownership-val',
        nationalSystem: 'nationalSystem-val',
        source: 'source-val',
        managedOrigin: 'managedOrigin-val',
        registerState: 'registerState-val',
        health: 'unmapped',
        limit: 7,
        offset: 3,
      });
    });

    it('ignores an unknown health value rather than passing it to the store', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      // 12 seeded rows, directly on the fake's backing array (same pattern the extras tests above
      // use to manipulate `ctx.__rows` directly) — this test only needs a fixed count to check
      // against, not real facility_registry rows.
      for (let i = 0; i < 12; i++) {
        ctx.__rows.push({ id: `seed-${i}`, localCode: `SEED${i}`, name: `Seed Facility ${i}`, source: 'manual', extras: {} });
      }
      const res = await app.inject({ method: 'GET', url: '/api/facilities?health=banana' });
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(12);
      // The real teeth: an unrecognised health string must never reach the store at all — it must
      // be sanitised to `undefined` here, exactly as a bad `limit`/repeated filter param is above.
      expect(ctx.__lastListOptions.health).toBeUndefined();
    });

    it('a valid ?health reaches the store as the sanitised value', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities?health=mapped' });
      expect(res.statusCode).toBe(200);
      expect(ctx.__lastListOptions.health).toBe('mapped');
    });

    it('echoes DEFAULT_LIST_LIMIT (not rows.length) as `limit` when the client sent none', async () => {
      // A short last page (fewer rows than any real page size) must not be mistaken for the page
      // size — see the report's limit-echo decision.
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      ctx.__rows.push({ id: 'only-row', localCode: 'ONLY1', name: 'Only Facility', source: 'manual', extras: {} });
      const res = await app.inject({ method: 'GET', url: '/api/facilities' });
      const body2 = res.json();
      expect(body2.rows).toHaveLength(1);
      expect(body2.limit).toBe(DEFAULT_LIST_LIMIT);
      expect(body2.limit).not.toBe(1);
    });

    it('echoes the client-supplied limit unchanged when one was sent', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities?limit=5' });
      expect(res.json().limit).toBe(5);
    });

    // --- Against a REAL store (facility_registry_store's own list()) — the plain `fakeCtx()`
    // above never actually pages/filters, so only a real db proves `rows`/`total` really reflect
    // limit/offset instead of the fake's rows.length shortcut. ---------------------------------

    it('returns rows, total, limit and offset — a real page cut from a real 12-row register', async () => {
      const internalDb = await makeMigratedDb();
      const ctx = fakeCreateCtx(internalDb);
      const app = await appWith(ctx);
      for (let i = 0; i < 12; i++) {
        await ctx.facilityRegistry.upsert({
          id: randomUUID(), localCode: `LC${String(i).padStart(3, '0')}`, name: `Facility ${String(i).padStart(2, '0')}`,
          source: 'manual',
        });
      }
      const res = await app.inject({ method: 'GET', url: '/api/facilities?limit=5&offset=5' });
      expect(res.statusCode).toBe(200);
      const body2 = res.json();
      expect(body2.rows).toHaveLength(5);
      expect(body2.total).toBe(12);
      expect(body2.limit).toBe(5);
      expect(body2.offset).toBe(5);
    });
  });

  // --- Task 3: GET /api/facilities/admin-values -----------------------------------------------

  describe('GET /api/facilities/admin-values', () => {
    it('returns distinct values ranked by frequency, with counts, for a valid level scoped by a parent', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=district&region=Dodoma' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([{ value: 'Dodoma', count: 2 }, { value: 'Kongwa', count: 1 }]);
      // The route forwarded the requested level and the scope param to the store.
      expect(ctx.__lastAdminValuesCall).toEqual({ level: 'district', scope: { region: 'Dodoma' } });
    });

    it('an absent parent scope reaches the store as an empty scope object, not a "" filter', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=region' });
      expect(res.statusCode).toBe(200);
      expect(ctx.__lastAdminValuesCall).toEqual({ level: 'region', scope: {} });
    });

    it('a blank parent scope is dropped, not forwarded as region=""', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=district&region=' });
      expect(res.statusCode).toBe(200);
      expect(ctx.__lastAdminValuesCall).toEqual({ level: 'district', scope: {} });
    });

    // --- The security requirement: level is a column-injection vector ------------------------

    it('⛔ level=password is rejected with 400 before any query runs (column-injection guard)', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=password' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/level/i);
      // The store was NEVER called — the arbitrary column name never reached a query.
      expect(ctx.__lastAdminValuesCall).toBeUndefined();
    });

    it('⛔ level=id is rejected with 400 (another real column that must never be selectable)', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=id' });
      expect(res.statusCode).toBe(400);
      expect(ctx.__lastAdminValuesCall).toBeUndefined();
    });

    it('⛔ a SQL-fragment level is rejected with 400, not passed through as a raw identifier', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({
        method: 'GET',
        url: `/api/facilities/admin-values?level=${encodeURIComponent('district; drop table facility_registry;--')}`,
      });
      expect(res.statusCode).toBe(400);
      expect(ctx.__lastAdminValuesCall).toBeUndefined();
    });

    it('⛔ a missing level is a 400, not an unfiltered scan of every column', async () => {
      const app = await appWith(fakeCtx());
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values' });
      expect(res.statusCode).toBe(400);
    });

    it('⛔ facility_registry.level (facility TYPE) is NOT one of the four admin columns', async () => {
      // Guards against the naming collision: the query param `level` means "which admin column",
      // and must not be confused with the pre-existing facility_registry.level (facility
      // type/Hospital-Dispensary) column — that column is not in the whitelist either.
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=level' });
      expect(res.statusCode).toBe(400);
      expect(ctx.__lastAdminValuesCall).toBeUndefined();
    });

    it('⛔ country is not offered — Task 4 binds it to a ValueSet instead', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=country' });
      expect(res.statusCode).toBe(400);
      expect(ctx.__lastAdminValuesCall).toBeUndefined();
    });

    // --- Repeated/array query params must never reach the store as arrays --------------------

    it('a repeated ?level cannot reach the store as an array — rejected with 400', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=district&level=region' });
      expect(res.statusCode).toBe(400);
      expect(ctx.__lastAdminValuesCall).toBeUndefined();
    });

    it('a repeated scope param cannot reach the store as an array', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=district&region=A&region=B' });
      expect(res.statusCode).toBe(200);
      // Must reach the store as "not specified" (absent from scope) — never as ['A','B'].
      expect(ctx.__lastAdminValuesCall).toEqual({ level: 'district', scope: {} });
    });

    // --- A scope entry for the requested level itself must never reach the store -------------

    it('a scope query param matching the requested level is dropped, never forwarded as a self-filter', async () => {
      const ctx = fakeCtx();
      const app = await appWith(ctx);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=district&district=Dodoma' });
      expect(res.statusCode).toBe(200);
      expect(ctx.__lastAdminValuesCall).toEqual({ level: 'district', scope: {} });
    });

    // --- Capability gating -----------------------------------------------------------------

    it('is gated on facilities.view — a user without it gets 403', async () => {
      const app = await appWith(fakeCtx(), []);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=district' });
      expect(res.statusCode).toBe(403);
    });

    it('a user with only facilities.view (no facilities.manage) CAN read admin-values', async () => {
      const app = await appWith(fakeCtx(), ['facilities.view']);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/admin-values?level=district' });
      expect(res.statusCode).toBe(200);
    });
  });
});

// --- Task 5: a facility mutation must ENQUEUE a report-facing dimension rebuild -------------------
// Saving a mapping through the Facilities page used to leave `facility_map` stale until an operator
// found a separate, hidden "rebuild" menu action — reports kept reading the old/raw facility while
// the UI already said "mapped". A rebuild is enqueued (never run inline) because it talks to the
// EXTERNAL warehouse, and an operator's save must not fail because that warehouse hiccuped.

describe('Task 5: facility mutations enqueue a facility-map-rebuild', () => {
  it('enqueues a rebuild after creating a facility', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(res.statusCode).toBe(201);
    const queued = await ctx.facilityJobs.listUnresolved();
    expect(queued.map((j: any) => j.kind)).toContain('facility-map-rebuild');
  });

  it('enqueues a rebuild after updating a facility', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
    // The create above already enqueued a job; coalescing means it is still sitting there, queued,
    // when PUT runs. Resolve it first so the assertion below can only be explained by PUT's OWN
    // enqueue call — see fakeFacilityJobStore's `__resolveAll` doc comment.
    ctx.facilityJobs.__resolveAll();

    const res = await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: body });
    expect(res.statusCode).toBe(200);
    const queued = await ctx.facilityJobs.listUnresolved();
    expect(queued.map((j: any) => j.kind)).toContain('facility-map-rebuild');
  });

  it('enqueues a rebuild after deleting a facility', async () => {
    const ctx = fakeCtx();
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
    // Same reasoning as the update test above — isolate DELETE's own enqueue call from the one
    // CREATE already made.
    ctx.facilityJobs.__resolveAll();

    const res = await app.inject({ method: 'DELETE', url: `/api/facilities/${id}` });
    expect(res.statusCode).toBe(200);
    const queued = await ctx.facilityJobs.listUnresolved();
    expect(queued.map((j: any) => j.kind)).toContain('facility-map-rebuild');
  });
});

// --- Fix 1 (mapping-ux report): creating/updating a facility projects it into FACILITY_REGISTRY_SYSTEM
// immediately — the load-bearing behaviour behind the operator's "Map found nothing to search"
// report. Exercises the REAL `createTerminologyAdminStore`/`createFacilityRegistryStore` against a
// real migrated internal db (pg-mem) — `fakeCtx()`'s in-memory `facilityRegistry`/`terminology`
// doubles above cannot prove a row is actually pickable via `admin.terms.search`, only that the
// route didn't crash.

function fakeCreateCtx(internalDb: any) {
  const audit: any[] = [];
  const forms: Record<string, any> = {
    'form-sample-facility': { id: 'form-sample-facility', schema: { fields: FORM_FIELDS }, targetPages: ['facilities'] },
  };
  return {
    internalDb,
    terminology: { admin: createTerminologyAdminStore(internalDb) },
    audit: { record: async (e: any) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    forms: { get: async (formId: string) => forms[formId] },
    facilityRegistry: createFacilityRegistryStore(internalDb),
    // Real store (not a hand-rolled fake) — this file's POST/PUT/DELETE tests below assert real
    // create/update/delete flows against a real migrated db, and Task 5's enqueue calls need a
    // working `ctx.facilityJobs` the same way they need a working `ctx.facilityRegistry` above.
    facilityJobs: createFacilityJobStore(internalDb),
    __audit: audit,
  } as any;
}

describe('Fix 1: POST/PUT /api/facilities project the row into FACILITY_REGISTRY_SYSTEM', () => {
  // ⛔ THE load-bearing test: an operator who registers a facility and immediately opens
  // TermMappingDialog's search mode (target system FACILITY-REGISTRY) must find it — with NO
  // publish/scan step in between. Before Fix 1 this only happened via an operator manually pressing
  // Publish (`publishRegistryConcepts`), which is exactly the gap the bug report describes.
  it('a facility created via POST is immediately findable via admin.terms.search(FACILITY_REGISTRY_SYSTEM, ...), with no publish step', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(res.statusCode).toBe(201);
    const created = res.json();

    const { rows } = await ctx.terminology.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 10, offset: 0 });
    // The operator-facing code (local_code = 'LAB01', see `body` above), not the row's opaque id.
    expect(rows).toEqual([expect.objectContaining({ code: 'LAB01', display: 'Dodoma Regional Referral' })]);
  });

  it('registers FACILITY_REGISTRY_SYSTEM as an ACTIVE coding_systems row on first create', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);

    await app.inject({ method: 'POST', url: '/api/facilities', payload: body });

    const cs = await ctx.terminology.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);
    expect(cs).not.toBeNull();
    expect(cs!.active).toBe(true);
  });

  it('a rename via PUT updates the projected concept\'s display', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;

    const renamed = { ...body, answers: { ...body.answers, f2: 'Dodoma Regional Referral Hospital' } };
    const res = await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: renamed });
    expect(res.statusCode).toBe(200);

    const { rows } = await ctx.terminology.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 10, offset: 0 });
    // localCode ('LAB01') is unchanged by this rename, so the code stays the same across the update.
    expect(rows).toEqual([expect.objectContaining({ code: 'LAB01', display: 'Dodoma Regional Referral Hospital' })]);
  });

  // ⛔ The projection must never take the facility write down with it.
  it('a projection failure does not prevent the facility from being created', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    ctx.terminology.admin.terms.importRows = async () => { throw new Error('simulated terminology store failure'); };
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(res.statusCode).toBe(201);
    expect(await internalDb.selectFrom('facility_registry').selectAll().execute()).toHaveLength(1);
  });
});

// Task 10 (B1, facility-canonical-identity): `register_state` (migration 081) reaches the wire.
// Against the REAL store (`fakeCreateCtx`, not `fakeCtx`'s in-memory double above) — proving the
// route's own `?registerState=` param genuinely reaches `facility_registry.register_state`
// end-to-end, not just that the fake recorded the option object (already covered by the
// `toEqual` regression net in the "Task 3" describe block above).
describe('Task 10: register_state reaches the wire', () => {
  it('a created facility carries registerState, and the list can filter by it', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);

    const created = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json();
    // A freshly created facility was never claimed by any register — the column's own DEFAULT
    // ('not_registered'), never written by this store's upsert() (see toRow()'s doc comment).
    expect(created.registerState).toBe('not_registered');

    const matches = (await app.inject({ method: 'GET', url: '/api/facilities?registerState=not_registered' })).json();
    expect(matches.rows.map((r: any) => r.id)).toContain(created.id);

    const nonMatches = (await app.inject({ method: 'GET', url: '/api/facilities?registerState=in_register' })).json();
    expect(nonMatches.rows.map((r: any) => r.id)).not.toContain(created.id);
  });
});

// --- A failed projection is durable, and the response says so -------------------------------------
// `projectRegistryRows` never throws (see its doc comment) — a failure was previously invisible: the
// route reported plain success while the facility was silently missing from (or stale in) the mapping
// picker, with nothing recording why. It now RETURNS whether this call's projection landed; the route
// enqueues a `registry-projection` retry job when it did not, and reports
// `projection: 'ok' | 'queued-for-retry'` in the response instead of a truthful-sounding 201/200 that
// hides the gap.
//
// ⚠ The boolean, not `facility_concept_projection`, is the signal — see the rename test below for the
// case that forced it.

describe('POST/PUT report whether this call\'s projection landed', () => {
  it('reports projection ok on the happy path (POST)', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json().projection).toBe('ok');
  });

  // Breaks the TERMINOLOGY STORE the projection depends on, not `projectRegistryRows` itself —
  // stubbing the function under test would prove nothing (see the task brief). `reprojectRegistryRows`
  // calls `admin.terms.importRows` as its first write, before the `facility_concept_projection` link
  // is ever touched (packages/bootstrap/src/facility-reconcile.ts), so breaking it here genuinely
  // reproduces "the inline attempt did not land" rather than simulating the outcome.
  it('enqueues a registry-projection retry and reports queued-for-retry when the inline projection fails (POST)', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    ctx.terminology.admin.terms.importRows = async () => { throw new Error('simulated terminology store failure'); };
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json().projection).toBe('queued-for-retry');

    const jobs = await ctx.facilityJobs.listUnresolved();
    const retries = jobs.filter((j: any) => j.kind === 'registry-projection');
    expect(retries).toHaveLength(1);
    expect(retries[0].registryId).toBe(res.json().id);
  });

  it('⛔ a failed projection still does not fail the facility write (POST)', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    ctx.terminology.admin.terms.importRows = async () => { throw new Error('simulated terminology store failure'); };
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(res.statusCode).toBe(201);
    const rows = await internalDb.selectFrom('facility_registry').selectAll().execute();
    expect(rows).toHaveLength(1);
  });

  it('reports projection ok on the happy path (PUT)', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;

    const res = await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().projection).toBe('ok');
  });

  // The NEVER-projected facility: the terminology store is broken from before the create, so this
  // row has no projected concept at all — a strictly worse state than the stale-name case in the
  // rename test that follows (missing from the picker entirely, not merely showing the old name).
  // Both must report 'queued-for-retry'; they are different enough to pin separately.
  it('enqueues a registry-projection retry and reports queued-for-retry when the inline projection fails (PUT)', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    ctx.terminology.admin.terms.importRows = async () => { throw new Error('simulated terminology store failure'); };
    const app = await appWith(ctx);
    const created = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json();
    expect(created.projection).toBe('queued-for-retry'); // sanity: the create above also failed to project

    // Drain every job the create left behind (its own registry-projection retry, coalesced onto the
    // SAME identity — `registry-projection:<id>`, facility-job-store.ts's `activeKeyFor` — that PUT's
    // own enqueue would target; plus its facility-map-rebuild) through the real store's claim/finish
    // lifecycle. Without this, the PUT assertion below would pass even with PUT's OWN enqueue call
    // deleted entirely: the create's still-queued job already satisfies "one registry-projection job
    // for this id", which proves nothing about the update handler (measured: this test was written
    // without the drain first, and deleting PUT's enqueue call did not fail it — see the report's
    // mutation-testing section). `createFacilityJobStore` (the real store `fakeCreateCtx` wires up
    // here) has no `__resolveAll` escape hatch like the in-memory `fakeFacilityJobStore` double used
    // elsewhere in this file — draining it for real is the only way to isolate PUT's own call.
    for (;;) {
      const job = await ctx.facilityJobs.claimNext();
      if (!job) break;
      await ctx.facilityJobs.finish(job.id, 'done', {});
    }

    const res = await app.inject({ method: 'PUT', url: `/api/facilities/${created.id}`, payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().projection).toBe('queued-for-retry');

    // A FRESH job, not the drained one — proves PUT's own enqueue call, not a leftover from POST.
    const jobs = await ctx.facilityJobs.listUnresolved();
    const retries = jobs.filter((j: any) => j.kind === 'registry-projection' && j.registryId === created.id);
    expect(retries).toHaveLength(1);
  });

  // ⛔ THE ordinary case, and the one the link-table check got wrong: a facility that ALREADY
  // projected successfully at create time is renamed, and the rename's projection fails. The link row
  // from the create is still sitting there, so "does a link exist for this id" answers yes and the
  // response used to claim 'ok' while the projected concept kept the OLD display name forever, with
  // no retry job to repair it. The route now reports what `projectRegistryRows` itself returned about
  // THIS call, so the stale name is both admitted and queued.
  //
  // No job drain needed here, unlike the never-projected test ABOVE: the create SUCCEEDS, so it
  // enqueues no `registry-projection` job at all, and the single job asserted on can only be PUT's.
  it('reports queued-for-retry and enqueues a retry when a rename\'s projection fails after a healthy create', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);
    const created = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json();
    expect(created.projection).toBe('ok'); // sanity: this facility DID project, so a link row exists

    ctx.terminology.admin.terms.importRows = async () => { throw new Error('simulated terminology store failure'); };
    const renamed = { ...body, answers: { ...body.answers, f2: 'Renamed While Broken' } };
    const res = await app.inject({ method: 'PUT', url: `/api/facilities/${created.id}`, payload: renamed });

    expect(res.statusCode).toBe(200);
    expect(res.json().projection).toBe('queued-for-retry');
    const jobs = await ctx.facilityJobs.listUnresolved();
    const retries = jobs.filter((j: any) => j.kind === 'registry-projection' && j.registryId === created.id);
    expect(retries).toHaveLength(1);
    // The concept really is stale — this is what the retry job exists to repair, and what a bare 'ok'
    // would have hidden. (Not a redundant restatement of the field above: it proves the field is
    // reporting a real failure, not merely echoing a flag.)
    const { rows: concepts } = await ctx.terminology.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 10, offset: 0 });
    expect(concepts).toEqual([expect.objectContaining({ code: 'LAB01', display: 'Dodoma Regional Referral' })]);
  });

  // Two facilities failing to project must each get their OWN retry job — the real store keys a
  // 'registry-projection' job on `registry-projection:<registryId>` (facility-job-store.ts's
  // `activeKeyFor`), not on the bare kind, so nothing coalesces the second facility's repair onto the
  // first's and drops it. Run against the REAL store `fakeCreateCtx` wires up, so this pins production
  // behaviour rather than the in-memory double's imitation of it.
  it('queues a separate retry per facility rather than coalescing two facilities onto one job', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    ctx.terminology.admin.terms.importRows = async () => { throw new Error('simulated terminology store failure'); };
    const app = await appWith(ctx);

    const first = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json();
    const second = (await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...body, answers: { ...body.answers, f1: 'LAB02', f2: 'Kongwa District' } },
    })).json();

    const jobs = await ctx.facilityJobs.listUnresolved();
    expect(jobs.filter((j: any) => j.kind === 'registry-projection').map((j: any) => j.registryId).sort())
      .toEqual([first.id, second.id].sort());
  });

  it('⛔ a failed projection still does not fail the facility write (PUT)', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    ctx.terminology.admin.terms.importRows = async () => { throw new Error('simulated terminology store failure'); };
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;

    const renamed = { ...body, answers: { ...body.answers, f2: 'Renamed While Broken' } };
    const res = await app.inject({ method: 'PUT', url: `/api/facilities/${id}`, payload: renamed });
    expect(res.statusCode).toBe(200);
    const row = await internalDb.selectFrom('facility_registry').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.name).toBe('Renamed While Broken');
  });
});

// --- Task 6 (B1, facility-canonical-identity): server-enforced controlled vocabulary on manual
// create/edit. `resolveControlledFields`/`applyControlledFields` (packages/bootstrap/src/facility-
// controlled-fields.ts) already run over every CSV-imported row via `importFacilities`, but manual
// create/edit (this route) applied no valueset at all — an imported row's `status` is always a
// canonical FHIR location-status code (migration 072), a hand-typed one could be anything. These
// tests pin the fix: POST/PUT reuse the SAME resolver and REFUSE (400) a controlled field whose raw
// value is not already canonical — except when that field's value set is not seeded on this
// install, which is reported NOT VALIDATED (passed through unenforced) rather than refused, exactly
// mirroring `resolveControlledFields`'s own contract.
//
// Run against a REAL migrated db (`fakeCreateCtx`, defined above) rather than `fakeCtx()`'s
// hand-rolled admin double: the double has no `valueSets`/`termMappings` at all, and the whole point
// here is proving the route resolves against the REAL seeded value sets from migrations 072/073.

const CONTROLLED_FORM_FIELDS = [
  { id: 'k1', apiProperty: 'localCode' },
  { id: 'k2', apiProperty: 'name' },
  { id: 'k3', apiProperty: 'status' },
  { id: 'k4', apiProperty: 'level' },
  { id: 'k5', apiProperty: 'country' },
];

/** `fakeCreateCtx` above only registers `form-sample-facility` (FORM_FIELDS, no controlled
 *  columns) — this variant additionally serves `form-controlled-fields`, mapping k3/k4/k5 onto
 *  status/level/country so these tests can submit them directly. */
function fakeControlledCtx(internalDb: any) {
  const ctx = fakeCreateCtx(internalDb);
  ctx.forms.get = async (formId: string) => (
    formId === 'form-controlled-fields'
      ? { id: 'form-controlled-fields', schema: { fields: CONTROLLED_FORM_FIELDS }, targetPages: ['facilities'] }
      : undefined
  );
  return ctx;
}

function controlledBody(answers: Record<string, string>) {
  return {
    answers: { k1: 'CF01', k2: 'Controlled Fields Facility', ...answers },
    formSchemaId: 'form-controlled-fields',
    formVersion: 1,
  };
}

describe('Task 6: server-enforced controlled vocabulary on manual create/edit', () => {
  it('⛔ refuses a manually created facility whose status is not in the canonical valueset', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(fakeControlledCtx(internalDb));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities', payload: controlledBody({ k3: 'Operating' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/status/i);
  });

  it('accepts a canonical status', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(fakeControlledCtx(internalDb));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities', payload: controlledBody({ k3: 'active' }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('active');
  });

  it('applies the same rule to level and country', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(fakeControlledCtx(internalDb));

    const badLevel = await app.inject({
      method: 'POST', url: '/api/facilities', payload: controlledBody({ k4: 'Not A Real Level' }),
    });
    expect(badLevel.statusCode).toBe(400);
    expect(badLevel.json().error).toMatch(/level/i);

    // A distinct localCode: the level refusal above must not have written a row for CF01 to
    // collide with (that would itself be evidence the refusal didn't actually block the write).
    const badCountry = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: controlledBody({ k1: 'CF02', k5: 'Nowhereland' }),
    });
    expect(badCountry.statusCode).toBe(400);
    expect(badCountry.json().error).toMatch(/country/i);
  });

  it('reports NOT VALIDATED rather than refusing when the valueset is not seeded', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeControlledCtx(internalDb);
    // Simulate an install where migration 072's location-status ValueSet was never seeded.
    // `resolveControlledFields`'s own contract (facility-controlled-fields.ts) reports a field
    // whose value set is absent as `notValidated` and classifies none of its values — the route
    // must mirror that by letting the create through, not refusing an operator's only way to
    // register a facility on that install.
    const real = ctx.terminology.admin.valueSets.getByUrl.bind(ctx.terminology.admin.valueSets);
    ctx.terminology.admin.valueSets.getByUrl = async (url: string) => (
      url === 'urn:openldr:valueset:location-status' ? null : real(url)
    );
    const app = await appWith(ctx);

    const res = await app.inject({
      method: 'POST', url: '/api/facilities', payload: controlledBody({ k3: 'Operating' }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('Operating');
  });

  it('refuses a PUT that edits status to a non-canonical value, without overwriting the existing canonical one', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(fakeControlledCtx(internalDb));
    const created = (await app.inject({
      method: 'POST', url: '/api/facilities', payload: controlledBody({ k3: 'active' }),
    })).json();

    const res = await app.inject({
      method: 'PUT', url: `/api/facilities/${created.id}`,
      payload: controlledBody({ k3: 'Operating' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/status/i);
    const row = await internalDb.selectFrom('facility_registry').selectAll()
      .where('id', '=', created.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('active');
  });

  it('accepts a PUT that edits status to a different canonical value', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(fakeControlledCtx(internalDb));
    const created = (await app.inject({
      method: 'POST', url: '/api/facilities', payload: controlledBody({ k3: 'active' }),
    })).json();

    const res = await app.inject({
      method: 'PUT', url: `/api/facilities/${created.id}`,
      payload: controlledBody({ k3: 'suspended' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('suspended');
  });
});

// --- Task 9: DELETE is the third code-release path, and used to be the only one with no projection
// work at all. It has TWO obligations, in a fixed order around the row removal — see
// `retireRegistryConcepts`/`reprojectAfterRegistryDelete` in packages/bootstrap for why the order is
// forced (the link cascades away with the row; the reprojection reacts to the row being gone).

describe('Task 9: DELETE /api/facilities/:id and the projection', () => {
  it('retires the deleted facility\'s concept rather than leaving a selectable ghost', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
    // Not vacuous: the concept is ACTIVE and pickable before the delete.
    expect((await ctx.terminology.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { statuses: ['ACTIVE'], limit: 10, offset: 0 })).rows
      .map((r: any) => r.code)).toEqual(['LAB01']);

    const res = await app.inject({ method: 'DELETE', url: `/api/facilities/${id}` });
    expect(res.statusCode).toBe(200);

    // Gone from new selection…
    expect((await ctx.terminology.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { statuses: ['ACTIVE'], limit: 10, offset: 0 })).rows)
      .toEqual([]);
    // …but still THERE, so a mapping authored against it still resolves for history.
    const concept = await internalDb.selectFrom('terminology_concepts').selectAll()
      .where('system', '=', FACILITY_REGISTRY_SYSTEM).where('code', '=', 'LAB01').executeTakeFirstOrThrow();
    expect(concept.status).toBe('RETIRED');
  });

  // ⛔ The regression this route was missing entirely. Alpha and Beta collide on 'X', so both park on
  // their ids and the operator's mapping is authored against Beta's id. Deleting Alpha frees 'X', and
  // `resolveObservedFacilities` re-derives preferred codes over the whole registry — so Beta starts
  // resolving through 'X' the moment the DELETE commits, while the mapping still says 'fac-B'. The
  // route must carry the mapping across at that moment, not leave it for the next Scan.
  //
  // Seeded through the real `facilityRegistry` store rather than POSTed, because the facilities form
  // fixture in this file maps no `nationalCode` field — the collision needs one row's local_code to
  // equal another's national_code.
  it('carries the surviving side of a collision, and its mapping, across without a Scan', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);
    const deps = { internalDb, admin: ctx.terminology.admin };

    await ctx.facilityRegistry.upsert({ id: 'fac-A', name: 'Alpha', localCode: 'X', source: 'manual' } as any);
    await ctx.facilityRegistry.upsert({ id: 'fac-B', name: 'Beta', nationalSystem: 'urn:tz:hfr', nationalCode: 'X', source: 'manual' } as any);
    await projectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }, { id: 'fac-B', name: 'Beta' }]);
    // Both parked on their ids — the state the operator authored the mapping in.
    expect((await internalDb.selectFrom('facility_concept_projection').select(['registry_id', 'concept_code']).execute())
      .map((l: any) => l.concept_code).sort()).toEqual(['fac-A', 'fac-B']);
    await ctx.terminology.admin.termMappings.create({
      fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB',
      toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'fac-B', toDisplay: null, mapType: 'SAME-AS', isActive: true,
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/facilities/fac-A' });
    expect(res.statusCode).toBe(200);

    // Beta followed the freed code at the moment the deletion happened…
    expect((await internalDb.selectFrom('facility_concept_projection').select('concept_code')
      .where('registry_id', '=', 'fac-B').executeTakeFirstOrThrow()).concept_code).toBe('X');
    // …and the operator's mapping came with it, so it still names Beta's live concept.
    expect((await internalDb.selectFrom('term_mappings').select(['to_system', 'to_code'])
      .where('from_code', '=', 'BALAB').executeTakeFirstOrThrow()))
      .toEqual({ to_system: FACILITY_REGISTRY_SYSTEM, to_code: 'X' });
    // And Beta is still selectable — the delete's retirement must not have caught it.
    expect((await ctx.terminology.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { statuses: ['ACTIVE'], limit: 10, offset: 0 })).rows
      .map((r: any) => r.code)).toEqual(['X']);
  });

  // ⛔ The FOURTH projection call site, and the last one whose failure was recorded nowhere durable.
  // Same collision as the test above, but the reprojection FAILS: Beta is left on its old parked
  // concept while `resolveObservedFacilities` has already started resolving the freed code, and the
  // DELETE still returns 200. `projectRegistryRows` never throws, so before
  // `reprojectAfterRegistryDelete` reported its outcome the only trace was a `console.error` —
  // directly contradicting this slice's "never only a console.error" acceptance claim.
  it('⛔ enqueues a projection retry for a survivor the delete left stale', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);
    const deps = { internalDb, admin: ctx.terminology.admin };

    await ctx.facilityRegistry.upsert({ id: 'fac-A', name: 'Alpha', localCode: 'X', source: 'manual' } as any);
    await ctx.facilityRegistry.upsert({ id: 'fac-B', name: 'Beta', nationalSystem: 'urn:tz:hfr', nationalCode: 'X', source: 'manual' } as any);
    await projectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }, { id: 'fac-B', name: 'Beta' }]);
    // `ctx.facilityJobs` here is the REAL store (see `fakeCreateCtx`), and the setup above writes
    // through the store/reconcile functions directly rather than through a route — so nothing is
    // queued yet and every job below belongs to the DELETE itself.

    // Break the write the reprojection needs, AFTER the setup above has used it.
    ctx.terminology.admin.terms.importRows = async () => { throw new Error('terminology store unreachable'); };

    const res = await app.inject({ method: 'DELETE', url: '/api/facilities/fac-A' });

    // The deletion still succeeds — a best-effort catch-up must never fail it.
    expect(res.statusCode).toBe(200);
    // …and the survivor's repair is durable and retryable, named per facility.
    const queued = await ctx.facilityJobs.listUnresolved();
    expect(queued.filter((j: any) => j.kind === 'registry-projection').map((j: any) => j.registryId)).toEqual(['fac-B']);
  });

  // Same containment contract as POST/PUT above. `retireRegistryConcepts` THROWS by design (its
  // containment belongs to the caller), so the route has to hold it — and the retirement runs BEFORE
  // the removal, which makes an uncontained throw worse than a 500: it would abort the request before
  // the facility was ever deleted. Broken at `updateTable`, which retirement is the only thing in
  // this request path to use (the registry store's `remove` is a `deleteFrom`).
  it('a retirement failure fails neither the delete nor the response', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/facilities', payload: body })).json().id;
    ctx.internalDb = new Proxy(internalDb, {
      get: (t: any, p) => (p === 'updateTable'
        ? () => { throw new Error('simulated terminology store failure'); }
        : t[p]?.bind?.(t) ?? t[p]),
    });

    const res = await app.inject({ method: 'DELETE', url: `/api/facilities/${id}` });

    expect(res.statusCode).toBe(200);
    expect(await internalDb.selectFrom('facility_registry').selectAll().execute()).toEqual([]);
  });
});

// --- Task 4: POST /api/facilities/import ------------------------------------------------------
// Exercises the REAL `importFacilities` (packages/bootstrap/src/facility-import.ts) against a real
// migrated Kysely db (pg-mem), not the in-memory `fakeCtx().facilityRegistry` used above — that fake
// cannot exercise the store's actual transaction/batch-write path. Mirrors sync-routes.test.ts's
// `fakeAmendCtx` pattern: a real `internalDb`, everything else this route doesn't touch left as a
// minimal stub.

const SYSTEM = 'urn:tz:hfr';
const CSV_HEADER = 'national_code,name,level,ownership,status,country,zone,region,district,council,ward,village,address,phone,latitude,longitude';

function facilityCsv(rows: string[]): string {
  return [CSV_HEADER, ...rows].join('\n') + '\n';
}

/** B1 Task 3: register `url` as a facility register, through the REAL store rather than a
 *  hand-rolled `coding_systems` insert — the routes resolve a submitted `nationalSystem` with that
 *  store's own `getByUrl`, and a fixture spelling the row itself would be free to disagree with what
 *  `getByUrl` actually looks for (it filters on `kind`, see migration 081). */
async function seedRegisterSource(db: any, url: string): Promise<void> {
  await createFacilityRegisterSourceStore(db).create({
    url, name: `Register ${url}`, code: url.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase(),
  });
}

/** Review fix (B1 Task 3): the store's `create` always writes `active: true` and exposes no
 *  deactivate method (Task 9's admin surface for register sources hasn't landed yet), so a test
 *  wanting a deactivated register updates the `coding_systems` row directly — the same row shape
 *  `getByUrl`/`list` both read, so this is a fixture detail, not a divergent path. */
async function deactivateRegisterSource(db: any, url: string): Promise<void> {
  await db.updateTable('coding_systems').set({ active: false }).where('url', '=', url).execute();
}

/** A migrated db with the given register URIs ALREADY REGISTERED — the ordinary setup for every
 *  import/upload test below, since B1 Task 3 made both import doors refuse a `nationalSystem` that
 *  is not a known register source. `makeMigratedDb()` alone seeds no register (nothing in the
 *  migration set does), so a test wanting the REFUSAL uses `makeMigratedDb()` directly. */
async function importDb(systems: string[] = [SYSTEM]): Promise<any> {
  const db = await makeMigratedDb();
  for (const url of systems) await seedRegisterSource(db, url);
  return db;
}

// Important 5: a JSONL release fixture, mirroring `packages/bootstrap/src/facility-import.test.ts`'s
// own `jsonl`/`rowLine`/`deletionLine` helpers — this file needs its own copy since it exercises the
// ROUTE, not `importFacilities` directly, and has no dependency on that test file.
function jsonl(lines: Record<string, unknown>[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}
const rowLine = (mflId: string, name: string, over: Record<string, unknown> = {}) =>
  ({ type: 'row', mflId, name, ...over });
const deletionLine = (mflId: string) => ({ type: 'deletion', mflId });

function fakeImportCtx(db: any) {
  const audit: any[] = [];
  return {
    internalDb: db,
    // Fix 1 (mapping-ux report): the import route now passes `admin` through to `importFacilities`
    // so a CSV upload projects into FACILITY_REGISTRY_SYSTEM too. Real projection behaviour is
    // exercised for real against `createTerminologyAdminStore` in `packages/bootstrap`'s own
    // facility-import.test.ts — this stub only needs to exist so the route doesn't crash.
    terminology: {
      admin: {
        codingSystems: {
          upsertByUrl: async () => {},
          getByUrl: async () => ({ id: 'cs-facility-registry', active: true } as any),
        },
        terms: { importRows: async () => ({ imported: 0 }) },
        // A2a fix wave A: `importFacilities` now also runs `resolveControlledFields` over the parsed
        // records, which reaches for `valueSets`/`termMappings` — but ONLY for a field some record
        // actually carries a value for, and every CSV in this file leaves level/status/country
        // blank. These stubs exist so that stays a fixture detail rather than a landmine: a future
        // test adding a `level` value gets "no value set seeded on this install" (reported as
        // `notValidated`) instead of a TypeError. Real resolution runs against the real store in
        // packages/bootstrap's facility-import.test.ts.
        valueSets: { getByUrl: async () => null, expand: async () => ({ codes: [], total: 0 }) },
        termMappings: { listOutgoing: async () => [] },
      },
    },
    audit: { record: async (e: any) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    forms: { get: async () => undefined },
    facilityRegistry: {
      list: async () => [],
      get: async () => undefined,
      distinctAdminValues: async () => [],
      upsert: async () => { throw new Error('not used by the import route'); },
      remove: async () => {},
    },
    // Real store (not a hand-rolled fake), same reasoning as `fakeCreateCtx` above: the import
    // route passes `ctx.facilityJobs` straight into `importFacilities`' `deps.facilityJobs`, and
    // an undefined/fake-without-`.enqueue` value would leave that call a permanent silent no-op
    // (it sits behind `if (deps.facilityJobs)`) in every test using this context — including the
    // one below asserting an applied import actually queues a rebuild.
    facilityJobs: createFacilityJobStore(db),
    // A2b Task 3: the upload route streams the request body into `ctx.blob.putStream`. Every other
    // route in this file leaves it untouched, so adding it here costs the existing tests nothing.
    blob: fakeBlobStore(),
    // The upload route's real byte ceiling is read off `ctx.cfg` per request (`bodyLimit` is inert
    // for a passthrough parser — see facilities-routes.ts). The value here is the schema's own
    // default; the over-cap test lowers it, exactly as workflows-routes.test.ts does with
    // `WORKFLOW_FILE_MAX_BYTES`.
    cfg: { FACILITY_IMPORT_MAX_UPLOAD_BYTES: 1_073_741_824 },
    __audit: audit,
  } as any;
}

/** A `BlobStoragePort` double for the upload route.
 *
 *  ⚠ It CONSUMES the stream it is handed, exactly as the real S3 adapter's multipart `Upload` does
 *  (`packages/adapter-s3-bucket/src/index.ts`). That is not incidental: the route pipes the request
 *  body through its hashing transform INTO this call, so a fake that merely recorded the key and
 *  ignored `body` would leave that pipeline unfinished forever — the test would hang to its timeout
 *  rather than fail with a usable message.
 *
 *  It keeps the BYTES, not just the key: "the run's `file_hash` is the sha256 of what was stored" is
 *  the one claim of this route that cannot be checked from the run row alone. */
function fakeBlobStore() {
  const objects = new Map<string, Buffer>();
  return {
    async putStream(key: string, body: AsyncIterable<Buffer | string>) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
    },
    async delete(key: string) { objects.delete(key); },
    __objects: objects,
  };
}

describe('POST /api/facilities/import', () => {
  // --- B1 Task 3: the submitted register must be a REGISTERED one --------------------------------
  //
  // MEASURED before this slice: `nationalSystem` was free text typed into the import sheet and
  // hashed straight into every facility's permanent id (`idFor`, facility-csv.ts). For national code
  // `100`, `HFR` gave `fac-d112c779ad583160` and `hfr` gave `fac-49bce368724fb81a` — two identities
  // for one register — while `observedFieldSystem` (facility-controlled-fields.ts) lowercases its
  // slug, so BOTH shared the single `…:facility-level:hfr` mapping namespace. One register, two
  // identities, one namespace. The fix is not a new normalisation rule: it is that the value can no
  // longer be typed at all — it must name a row in `coding_systems` marked as a facility register.
  it('⛔ refuses an import whose nationalSystem is not a known register source', async () => {
    const db = await makeMigratedDb(); // deliberately unregistered — not `importDb()`
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), nationalSystem: 'HFR' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not a known facility register/i);
    // ⛔ Refused BEFORE anything durable happened: no run row holding the register's `active_key`,
    // and (this being a preview) nothing in the registry either. A gate that answered 400 after
    // minting the run would lock the register out of every later preview.
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('accepts an import naming a registered source by its canonical URI', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), nationalSystem: SYSTEM },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().parsed).toBe(1);
  });

  it('⛔ refuses a CASE VARIANT of a registered URI — the exact fork this slice removes', async () => {
    // `urn:tz:hfr` is registered; `urn:tz:HFR` is not. These two hash to DIFFERENT facility ids
    // (`idFor` does not lowercase) but to the SAME controlled-field namespace (`observedFieldSystem`
    // does), so accepting both is precisely the disagreement measured above. The gate is an EXACT
    // match against the register's stored url — never a case-insensitive or normalising lookup,
    // which would silently adopt one spelling's rows under the other's identity.
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), nationalSystem: 'urn:tz:HFR' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not a known facility register/i);
  });

  // Review fix (B1 Task 3, MINOR finding): `getByUrl` deliberately does not filter on `active` (it
  // stays usable for historical-source lookups elsewhere), so without this check a DEACTIVATED
  // register — one Task 9's import-sheet `Select` will never again offer, since `list()` defaults to
  // active-only — would still pass the gate above and let an import write facilities under it.
  it('⛔ refuses an import naming a DEACTIVATED register, distinctly from an unknown one', async () => {
    const db = await importDb();
    await deactivateRegisterSource(db, SYSTEM);
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), nationalSystem: SYSTEM },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/deactivated/i);
    expect(res.json().error).not.toMatch(/not a known facility register/i);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('I5: gated on facilities.manage — a facilities.view-only user gets 403', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db), ['facilities.view']);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']), nationalSystem: SYSTEM },
    });
    expect(res.statusCode).toBe(403);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('dry-run (no `apply`) returns the full summary and writes nothing', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv([
      '100,Dodoma Regional Referral,,,,,,,,,,,,,,',
      ',No Code,,,,,,,,,,,,,,', // missing required national_code -> skipped
    ]);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
    expect(res.statusCode).toBe(200);
    // Every counter always present, even the zero ones — a client must never confuse "0 found"
    // with "not reported". Task 5: `quarantined`/`duplicateColumns` (Task 4's additions to
    // FacilityImportResult) now reach the response body too.
    // A2a Task 5: the dry run now REPORTS what it would do (`create: 1`) instead of the
    // `created: 0, updated: 0` it used to return before ever consulting the registry (FAC-P1-03);
    // `written` is what a statement actually wrote, and is the only pair that stays zero here.
    expect(res.json()).toEqual({
      parsed: 1, skipped: 1, unknownColumns: [], duplicateColumns: [], columnMapErrors: [], quarantined: [], invalid: [],
      duplicates: 0, blocked: false, blockedReason: null,
      create: 1, changed: 0, unchanged: 0,
      conflict: null, absent: null, deleted: 0,
      samples: {
        create: [{ id: expect.any(String), nationalCode: '100', name: 'Dodoma Regional Referral' }],
        changed: [], conflict: [], absent: [], deleted: [],
      },
      written: { created: 0, updated: 0, retired: 0 },
      // Task 10: a standalone preview (no `apply`) now persists a `facility_import_runs` row and
      // echoes its id, and the registry is empty here — no existing row carries `SYSTEM`, so this
      // import creates a genuinely new register identity.
      runId: expect.any(String), knownNationalSystem: false,
      // A2a fix wave A: release provenance (CSV has no release header, so all three are empty/null)
      // and the controlled-field warnings. Both are EMPTY here rather than populated: this CSV's
      // `level`/`status`/`country` cells are all blank, and `resolveControlledFields` looks up a
      // field's value set only when some record actually carries a value for it — so nothing was
      // classified unmapped and nothing needed validating.
      meta: null, countMismatch: [], releaseVersion: null,
      unmapped: { level: [], status: [], country: [] },
      notValidated: [],
    });
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
    expect(ctx.__audit).toHaveLength(0); // a dry run writes nothing, so it must not audit
  });

  // Task 5: surface Task 4's `quarantined`/`allowMalformedRows` through this route. A row whose
  // field count disagrees with the header's is never mapped to columns (facility-csv.ts) — the
  // route must report its line number/reason verbatim, and `apply` must stay blocked until the
  // operator explicitly opts in with `allowMalformedRows`.
  it('returns quarantined rows with line numbers and applies nothing', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: 'national_code,name\n1,Good\n2,Bad,Extra\n', nationalSystem: SYSTEM, apply: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      written: { created: 0, updated: 0 },
      quarantined: [{ line: 3, reason: 'too_many_fields', raw: '2,Bad,Extra' }],
      // The importer's own verdict, reaching the client. This route's pre-transaction guard reads
      // THIS field rather than rebuilding the predicate, and the Studio sheet reads it off the
      // response for the same reason (see `FacilityImportResult.blocked`).
      blocked: true, blockedReason: 'quarantined-rows',
    });
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
    expect(ctx.__audit).toHaveLength(0); // blocked apply writes nothing, so it must not audit
  });

  // The other block reason, end to end. `parsed` is 0 here — `parseFacilityCsv` returns no records
  // for a duplicate header — so the route's earlier `parsed === 0` short-circuit is what actually
  // returns, and `blocked` is carried on the body regardless. That is the point: the two guards no
  // longer have to agree by coincidence, because only one of them decides.
  it('reports a duplicate-header file as blocked, with no override offered', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: {
        csv: 'national_code,name,name\n1,A,B\n',
        nationalSystem: SYSTEM, apply: true, allowMalformedRows: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      written: { created: 0, updated: 0 }, duplicateColumns: ['name'], blocked: true, blockedReason: 'duplicate-columns',
    });
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
    expect(ctx.__audit).toHaveLength(0);
  });

  it('allowMalformedRows: true applies the well-formed rows despite the quarantined one, and still reports it', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: {
        csv: 'national_code,name\n1,Good\n2,Bad,Extra\n',
        nationalSystem: SYSTEM, apply: true, allowMalformedRows: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      written: { created: 1, updated: 0 },
      quarantined: [{ line: 3, reason: 'too_many_fields' }],
    });
    const rows = await db.selectFrom('facility_registry').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(ctx.__audit).toHaveLength(1); // this apply DID write, so it must be audited
  });

  it('apply: true writes and returns created/updated counts', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,', '101,Kongwa DDH,,,,,,,,,,,,,,']);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ parsed: 2, create: 2, written: { created: 2, updated: 0 }, duplicates: 0 });
    const rows = await db.selectFrom('facility_registry').selectAll().execute();
    expect(rows).toHaveLength(2);
  });

  // Task 5, closing the gap the reviewer found: `fakeImportCtx` above previously had no
  // `facilityJobs` store at all (`ctx.facilityJobs` was `undefined`), so `importFacilities`'s own
  // `if (deps.facilityJobs)` guard made every enqueue call in every import-route test a silent
  // no-op — 120/120 tests stayed green even with `facilityJobs: ctx.facilityJobs` deleted from the
  // route's `deps` object at the top of this describe block's route. This test exercises the real
  // `createFacilityJobStore` now wired into `fakeImportCtx` and is the one that actually pins the
  // wiring: an HTTP CSV upload through this route must leave a `facility-map-rebuild` job queued,
  // the same as a single facility create/update/delete does.
  it('an applied import leaves a facility-map-rebuild job queued', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });
    expect(res.statusCode).toBe(200);
    const queued = await ctx.facilityJobs.listUnresolved();
    expect(queued.map((j: any) => j.kind)).toEqual(['facility-map-rebuild']);
  });

  it('the applied mutation is audited as facility.import', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });
    expect(ctx.__audit.map((a: any) => a.action)).toEqual(['facility.import']);
    expect(ctx.__audit[0].entityId).toBe(SYSTEM);
  });

  // ⛔ Whole-branch Critical 2, browser door. `importFacilities`' `deps.audit` had NO production
  // caller at all: all three deps literals (this route, the CLI, and the background worker's
  // `importDeps` in packages/bootstrap/src/index.ts) omitted it, so every applied import took the
  // `if (!deps.audit)` branch and logged "the per-row write is unaudited". Task 7's whole feature was
  // dead — `GET /api/facilities/:id/history` could never show an import, and the Studio's provenance
  // panel said "Never imported" for a facility imported seconds earlier. The test above cannot see
  // this: a first import CREATES rows, and only CHANGED rows are audited per-facility. This one
  // imports twice, so the second apply has a real change to record.
  it('⛔ a changed row from an applied import is audited as facility.import.row (the per-row audit is wired)', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const created = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']), nationalSystem: SYSTEM, apply: true },
    });
    expect(created.statusCode).toBe(200);

    const renamed = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']), nationalSystem: SYSTEM, apply: true },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().changed).toBe(1);

    const perRow = ctx.__audit.filter((a: any) => a.action === 'facility.import.row');
    expect(perRow).toHaveLength(1);
    // The entityId must be the FACILITY's own id — that is the only thing that makes the event
    // reachable from `GET /api/facilities/:id/history`, which filters on `entity_id`.
    const row = await db.selectFrom('facility_registry').select(['id']).executeTakeFirstOrThrow();
    expect(perRow[0].entityId).toBe(row.id);
    expect(perRow[0].before).toMatchObject({ name: 'Dodoma Regional Referral' });
    expect(perRow[0].after).toMatchObject({ name: 'Dodoma Regional Referral Hospital' });
  });

  it('unknown columns are reported, never swallowed, and block the import unless explicitly allowed', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = ['national_code,name,made_up_column', '100,Dodoma Regional Referral,xyz'].join('\n') + '\n';
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().unknownColumns).toEqual(['made_up_column']);
    expect(res.json().parsed).toBe(0); // the parser blocks the whole file, per facility-csv.ts
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
    expect(ctx.__audit).toHaveLength(0); // nothing was actually written — must not be audited
  });

  it('allowUnknownColumns: true carries the unknown column into extras and still reports it', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = ['national_code,name,made_up_column', '100,Dodoma Regional Referral,xyz'].join('\n') + '\n';
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv, nationalSystem: SYSTEM, apply: true, allowUnknownColumns: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ unknownColumns: ['made_up_column'], parsed: 1, written: { created: 1, updated: 0 } });
    const row = await db.selectFrom('facility_registry').selectAll().executeTakeFirst();
    expect(row?.extras).toEqual({ made_up_column: 'xyz' });
  });

  // ── Task 8b: the wire gap — `columnMap` reaches the route at all ────────────────────────────────
  //
  // `apps/server/src/facilities-routes.ts` had zero occurrences of `columnMap` before this fix: the
  // route's zod schema had no such key, so a client-submitted map was silently STRIPPED and the file
  // parsed as if the operator had never mapped anything — refused here for "unrecognised columns"
  // exactly like the test just above.

  it('⛔ Task 8b: a columnMap lets the import parse a file whose headers are NOT the contract', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    // Neither header spells a contract field on its own — without the map this is exactly the
    // "unrecognised columns" case two tests up (`parsed: 0`, nothing written).
    const csv = ['MFL Code,Facility Name', '100,Dodoma Regional Referral'].join('\n') + '\n';
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: {
        csv, nationalSystem: SYSTEM, apply: true,
        columnMap: { columns: { 'MFL Code': 'national_code', 'Facility Name': 'name' } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      unknownColumns: [], columnMapErrors: [], parsed: 1, written: { created: 1, updated: 0 },
    });
    const row = await db.selectFrom('facility_registry').selectAll().executeTakeFirst();
    expect(row?.national_code).toBe('100');
    expect(row?.name).toBe('Dodoma Regional Referral');
  });

  it('⛔ Task 8b: a bad columnMap (two headers claiming one field) blocks the import and writes nothing', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = ['MFL Code,Alt Code,Facility Name', '100,100b,Dodoma Regional Referral'].join('\n') + '\n';
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: {
        csv, nationalSystem: SYSTEM, apply: true,
        columnMap: {
          // Both headers claim `national_code` — `validateColumnMap`'s `duplicate_target`.
          columns: { 'MFL Code': 'national_code', 'Alt Code': 'national_code', 'Facility Name': 'name' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().blocked).toBe(true);
    expect(res.json().blockedReason).toBe('column-map');
    expect(res.json().columnMapErrors).toEqual([
      { reason: 'duplicate_target', subject: 'Alt Code', target: 'national_code', other: 'MFL Code' },
    ]);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
    expect(ctx.__audit).toHaveLength(0); // nothing was written — must not be audited
  });

  it('⛔ Task 8b: a malformed columnMap (wrong shape) is a 400, not a 500', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: {
        csv: facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), nationalSystem: SYSTEM,
        // `columns` must be a map of strings; a number value is not a valid target.
        columnMap: { columns: { 'MFL Code': 42 } },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('⛔ nationalSystem is required — an omitted value is a 400, never defaulted to a hardcoded register', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']) },
    });
    expect(res.statusCode).toBe(400);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('a non-string csv body is a clear 400, not a stack trace', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv: 12345, nationalSystem: SYSTEM } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('an oversized csv body is rejected with a clear 400, not a stack trace', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    // Deliberately over any reasonable national-register size (see the route's MAX_IMPORT_CSV_BYTES
    // comment) — content doesn't need to be valid CSV, the size check runs before parsing.
    const oversized = 'a'.repeat(9 * 1024 * 1024);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv: oversized, nationalSystem: SYSTEM } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('⛔ apply is refused above the inline row cap — points the operator at the CLI instead of running a long transaction inline', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const rows = Array.from({ length: 2001 }, (_, i) => `${1000 + i},Facility ${i},,,,,,,,,,,,,,`);
    const csv = facilityCsv(rows);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/cli/i);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
    expect(ctx.__audit).toHaveLength(0);
  });

  it('a dry run (no apply) is NOT subject to the inline row cap — a large register can still be previewed', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const rows = Array.from({ length: 2001 }, (_, i) => `${1000 + i},Facility ${i},,,,,,,,,,,,,,`);
    const csv = facilityCsv(rows);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
    expect(res.statusCode).toBe(200);
    expect(res.json().parsed).toBe(2001);
  });

  // --- Blocking fix: a malformed CSV is a 400 carrying csv-parse's own message, never a raw 500 ---
  // `parseFacilityCsv` (via csv-parse/sync, inside `importFacilities`) throws synchronously on
  // malformed input instead of returning a result. Three measured triggers, each exercised on BOTH
  // the dry-run and apply paths (the route calls `importFacilities` once for the preview and, when
  // `apply` is set and under the row cap, a second time for the real write — see isCsvParseError's
  // doc comment in facilities-routes.ts).

  describe('a malformed CSV is a 400 with the parser\'s own message, not a raw 500', () => {
    // An operator upload of a `.json` file by mistake — the parser's first field starts with `{`
    // (or `[`), which csv-parse's quote-scanning treats as an opening quote appearing mid-field.
    const JSON_UPLOAD = '{"name":"A","code":"100"}';
    // A truncated/unterminated quote — routine in a register export that got cut off mid-write.
    const UNTERMINATED_QUOTE = 'national_code,name\n100,"Dodoma Regional\n101,Kongwa\n';
    // A stray `"` inside a facility name that was never meant to open a quoted field.
    const STRAY_QUOTE_IN_NAME = 'national_code,name\n100,St. Mary"s Dispensary\n';

    const triggers: Array<[string, string]> = [
      ['a .json file uploaded by mistake', JSON_UPLOAD],
      ['a truncated/unterminated quote', UNTERMINATED_QUOTE],
      ['a stray quote inside a facility name', STRAY_QUOTE_IN_NAME],
    ];

    for (const [label, csv] of triggers) {
      it(`dry-run: ${label} -> 400 with the parser's message, not 500`, async () => {
        const db = await importDb();
        const ctx = fakeImportCtx(db);
        const app = await appWith(ctx);
        const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
        expect(res.statusCode).toBe(400);
        // The operator-facing message must be csv-parse's own (line/column-bearing) text, not the
        // generic Fastify 500 body ("Internal Server Error") the studio's errorDetail would
        // otherwise surface — see the route's isCsvParseError doc comment.
        expect(res.json().error).toBeTruthy();
        expect(res.json().error).not.toMatch(/internal server error/i);
        expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
        expect(ctx.__audit).toHaveLength(0);
      });

      it(`apply: ${label} -> 400 with the parser's message, not 500, and nothing is written`, async () => {
        const db = await importDb();
        const ctx = fakeImportCtx(db);
        const app = await appWith(ctx);
        const res = await app.inject({
          method: 'POST', url: '/api/facilities/import',
          payload: { csv, nationalSystem: SYSTEM, apply: true },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBeTruthy();
        expect(res.json().error).not.toMatch(/internal server error/i);
        expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
        expect(ctx.__audit).toHaveLength(0);
      });
    }

    // A genuine DB-layer failure must still surface as a 500 (or go through mapFacilityDbError) —
    // the parse-error guard must only recognise csv-parse's own error shapes, never blanket-catch
    // everything importFacilities can throw. Force a real (non-csv-parse) failure on the apply
    // transaction by breaking the db handle after a WELL-FORMED preview has already succeeded, so
    // only the write half is exercised.
    it('⛔ a genuine DB failure during apply is rethrown as a 500, never reclassified as a parse-error 400', async () => {
      const db = await importDb();
      const ctx = fakeImportCtx(db);
      const app = await appWith(ctx);
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const dbError = new Error('simulated connection loss');
      (db as unknown as { transaction: () => never }).transaction = () => { throw dbError; };
      const res = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: SYSTEM, apply: true },
      });
      expect(res.statusCode).toBe(500);
      expect(ctx.__audit).toHaveLength(0);
    });
  });

  // --- Minor fix: an empty or whitespace-only csv is a clear 400, never an all-zero 200 -----------
  // A UI that only checks `res.ok` must not read success from an upload that changed nothing.

  it('an empty csv is a 400, not an all-zero 200', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv: '', nationalSystem: SYSTEM } });
    expect(res.statusCode).toBe(400);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('a whitespace-only csv is a 400, not an all-zero 200', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: '   \n  \n', nationalSystem: SYSTEM, apply: true },
    });
    expect(res.statusCode).toBe(400);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  // --- Task 10: linking a preview to an apply through facility_import_runs -----------------------

  describe('Task 10: preview↔apply linkage and the run store', () => {
    it('a standalone preview persists a run, retrievable via GET .../runs/:id', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(res.statusCode).toBe(200);
      const runId = res.json().runId;
      expect(typeof runId).toBe('string');

      const runRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` });
      expect(runRes.statusCode).toBe(200);
      // Fix wave 1 (Important 3). Complete-object `toEqual`, not a field-by-field `expect(run.x)`
      // per-property check — this route test is the ONLY thing pinning `GET .../runs/:id`'s wire
      // shape (no return-type annotation on the handler), so a field silently dropped or renamed must
      // fail here. `summary` is asserted present but not pinned byte-for-byte — its own shape
      // (`FacilityImportResult`) is already exhaustively pinned by the dry-run complete-object test
      // above ("dry-run (no `apply`) returns the full summary…"); re-pinning it here would just be a
      // second, driftable copy of that same assertion.
      expect(runRes.json()).toEqual({
        id: runId,
        nationalSystem: SYSTEM,
        sourceFormat: 'csv',
        fileHash: createHash('sha256').update(csv, 'utf8').digest('hex'),
        byteSize: Buffer.byteLength(csv, 'utf8'),
        releaseVersion: null,
        releasePublishedAt: null,
        declaredRowCount: null,
        declaredDeletionCount: null,
        status: 'previewed',
        // A2b Task 2 widened `FacilityImportRun` with the worker's columns. Pinned to CONCRETE
        // values, never `expect.anything()`, so this stays the exhaustive wire-shape assertion it was
        // written to be — and what it now also pins is true of an INLINE preview specifically: it
        // stores no file (`blobKey: null`) and no worker has ever claimed it, so it carries no phase,
        // no progress, no cancel request and no `startedAt`.
        blobKey: null,
        phase: null,
        processed: 0,
        total: null,
        previewedAt: expect.any(String),
        summary: expect.any(Object),
        options: { nationalSystem: SYSTEM },
        error: null,
        cancelRequested: false,
        startedAt: null,
        requestedBy: 'u1', // `req.user.id` from `appWith`'s fake `onRequest` hook
        createdAt: expect.any(String),
        finishedAt: null,
      });
    });

    // Self-review question this task's brief asks explicitly: a blocked file still parses (a
    // quarantined row is not a PARSE failure — see the route's own comment above the parse-error
    // try/catch), so the run-creation step runs unconditionally after that try/catch — a preview
    // that turns out blocked persists a run exactly like a clean one does.
    it('a preview persists a run even when the file turns out blocked (quarantined rows)', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = 'national_code,name\n1,Good\n2,Bad,Extra\n';
      const res = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: SYSTEM },
      });
      expect(res.statusCode).toBe(200);
      // Fix wave 1 (Important 3). Complete-object `toEqual` — the brief forbids `toMatchObject` here
      // for the same reason as the sibling GET assertions below: this route test is the ONLY thing
      // pinning the wire shape (no return-type annotation on the handler), and `toMatchObject` would
      // let a field silently vanish from the response without failing.
      const body = res.json();
      expect(body).toEqual({
        parsed: 1, skipped: 0, unknownColumns: [], duplicateColumns: [], columnMapErrors: [],
        quarantined: [{ line: 3, reason: 'too_many_fields', raw: '2,Bad,Extra' }],
        invalid: [], duplicates: 0, blocked: true, blockedReason: 'quarantined-rows',
        create: 1, changed: 0, unchanged: 0, conflict: null, absent: null, deleted: 0,
        samples: {
          create: [{ id: expect.any(String), nationalCode: '1', name: 'Good' }],
          changed: [], conflict: [], absent: [], deleted: [],
        },
        written: { created: 0, updated: 0, retired: 0 },
        runId: expect.any(String), knownNationalSystem: false,
        // A2a fix wave A, same as the dry-run complete-object assertion above: release provenance
        // (none — this is a CSV) and the controlled-field warnings (none — this CSV has only
        // national_code/name columns, so no controlled field carries a value to resolve).
        meta: null, countMismatch: [], releaseVersion: null,
        unmapped: { level: [], status: [], country: [] }, notValidated: [],
      });
      const runId = body.runId;

      const runRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` });
      expect(runRes.statusCode).toBe(200);
      expect(runRes.json()).toEqual({
        id: runId,
        nationalSystem: SYSTEM,
        sourceFormat: 'csv',
        fileHash: createHash('sha256').update(csv, 'utf8').digest('hex'),
        byteSize: Buffer.byteLength(csv, 'utf8'),
        releaseVersion: null,
        releasePublishedAt: null,
        declaredRowCount: null,
        declaredDeletionCount: null,
        status: 'previewed',
        // A2b Task 2 widened `FacilityImportRun` with the worker's columns. Pinned to CONCRETE
        // values, never `expect.anything()`, so this stays the exhaustive wire-shape assertion it was
        // written to be — and what it now also pins is true of an INLINE preview specifically: it
        // stores no file (`blobKey: null`) and no worker has ever claimed it, so it carries no phase,
        // no progress, no cancel request and no `startedAt`.
        blobKey: null,
        phase: null,
        processed: 0,
        total: null,
        previewedAt: expect.any(String),
        summary: expect.any(Object),
        options: { nationalSystem: SYSTEM },
        error: null,
        cancelRequested: false,
        startedAt: null,
        requestedBy: 'u1',
        createdAt: expect.any(String),
        finishedAt: null,
      });
    });

    // Important 5 (whole-branch review): migration 080 provisioned `declared_row_count`,
    // `declared_deletion_count` and `release_published_at`, but nothing ever wrote them — a JSONL
    // release's own header (`preview.meta`, from `parseFacilityRelease`) reached `FacilityImportResult`
    // and was reported back to the CALLER, but `startPreview`'s call in the route never threaded it
    // onto the RUN, so "the release declares 3 rows, we parsed 2" never reached the durable record.
    it('persists a JSONL release\'s declared row/deletion counts and publish date onto the run', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const body = jsonl([
        { type: 'meta', country: 'TZ', version: 'r7', publishedAt: '2026-07-01', rowCount: 3, deletionCount: 1 },
        rowLine('100', 'Alpha'),
        rowLine('200', 'Beta'),
        deletionLine('900'),
      ]);
      const res = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv: body, nationalSystem: SYSTEM, format: 'jsonl' },
      });
      expect(res.statusCode).toBe(200);
      // Declared 3 rows, only 2 parsed — exactly the fact FAC-P1-03 wants recorded.
      expect(res.json().countMismatch).toEqual([{ field: 'rowCount', declared: 3, parsed: 2 }]);
      const runId = res.json().runId;

      const runRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` });
      expect(runRes.statusCode).toBe(200);
      const run = runRes.json();
      expect(run.declaredRowCount).toBe(3);
      expect(run.declaredDeletionCount).toBe(1);
      expect(run.releasePublishedAt).toBe(new Date('2026-07-01').toISOString());
    });

    // A CSV import has no release header at all — `preview.meta` is null (see
    // `importFacilities`' docblock), so all three columns must stay null rather than the route
    // inventing zeros for "not declared".
    it('leaves declared row/deletion counts null for a plain CSV import (no release header)', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const res = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv: facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']), nationalSystem: SYSTEM },
      });
      expect(res.statusCode).toBe(200);
      const runRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${res.json().runId}` });
      expect(runRes.json().declaredRowCount).toBeNull();
      expect(runRes.json().declaredDeletionCount).toBeNull();
      expect(runRes.json().releasePublishedAt).toBeNull();
    });

    it('reports knownNationalSystem: true once the register exists, false for one never seen', async () => {
      const db = await importDb([SYSTEM, 'urn:other:register']);
      const app = await appWith(fakeImportCtx(db));
      // Seeds SYSTEM via an applied import — an apply carrying no `runId` mints no run of its own
      // (see the route's own reasoning), so this cannot collide with the preview below.
      await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv: facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']), nationalSystem: SYSTEM, apply: true },
      });

      const known = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv: facilityCsv(['101,Kongwa DDH,,,,,,,,,,,,,,']), nationalSystem: SYSTEM },
      });
      expect(known.json().knownNationalSystem).toBe(true);

      const unknown = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv: facilityCsv(['200,Somewhere Else,,,,,,,,,,,,,,']), nationalSystem: 'urn:other:register' },
      });
      expect(unknown.json().knownNationalSystem).toBe(false);
    });

    it('an apply carrying its preview\'s runId evaluates conflicts and detects one', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });

      // A fresh preview establishes the watermark…
      const preview = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(preview.statusCode).toBe(200);
      const runId = preview.json().runId;

      // …then the row is touched by something else before the apply carrying that runId arrives.
      //
      // ⛔ `now() + interval`, not plain `now()`: pg-mem's `now()` resolves to real
      // millisecond-precision wall-clock time (measured — two back-to-back `now()` calls land in the
      // SAME millisecond roughly half the time), so a plain `sql\`now()\`` here races the preview's
      // own `completePreview` watermark and intermittently fails to register as a conflict at all
      // under load. A fixed future offset makes "touched after the preview" true unconditionally —
      // see the identical fix (and this same comment) a few tests below.
      await db.updateTable('facility_registry')
        .set({ updated_at: sql`now() + interval '1 second'` }).where('national_code', '=', '100').execute();

      const res = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: SYSTEM, apply: true, runId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().conflict).toBe(1);
      // The default policy is skip, not overwrite — the touched row is left alone.
      expect(res.json().written).toEqual({ created: 0, updated: 0, retired: 0 });
    });

    it('⛔ an apply without a runId reports conflict: null — NOT 0 — because nothing was evaluated', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });

      const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });
      expect(res.statusCode).toBe(200);
      expect(res.json().conflict).toBeNull();
      expect(res.json().runId).toBeNull();
    });

    // A2a: the route forwards `onConflict` through to `importFacilities` rather than dropping it —
    // the mirror image of the default-skip test above (same stale-write setup), asserting the
    // opposite outcome once the request carries the explicit override.
    it('forwards onConflict: overwrite so a conflicting row IS written, still reporting it as conflict', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });

      const preview = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      const runId = preview.json().runId;

      // ⛔ `now() + interval`, not plain `now()`: pg-mem's `now()` resolves to real
      // millisecond-precision wall-clock time (measured — two back-to-back `now()` calls land in the
      // SAME millisecond roughly half the time), so a plain `sql\`now()\`` here races the preview's
      // own `completePreview` watermark and intermittently fails to register as a conflict at all
      // under load. A fixed future offset makes "touched after the preview" true unconditionally.
      await db.updateTable('facility_registry')
        .set({ updated_at: sql`now() + interval '1 second'` }).where('national_code', '=', '100').execute();

      const renamed = facilityCsv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']);
      const res = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv: renamed, nationalSystem: SYSTEM, apply: true, runId, onConflict: 'overwrite' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().conflict).toBe(1);
      expect(res.json().written).toEqual({ created: 0, updated: 1, retired: 0 });

      const row = await db.selectFrom('facility_registry').selectAll().where('national_code', '=', '100').executeTakeFirst();
      expect(row?.name).toBe('Dodoma Regional Referral Hospital');
    });

    it('applying against an unknown runId is a 404, not a silent fall-through to unlinked', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const res = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: SYSTEM, apply: true, runId: 'fir_does-not-exist' },
      });
      expect(res.statusCode).toBe(404);
      expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
    });

    // Fix wave 1 (Important 1) — cross-register corruption. A `runId` minted for one national system
    // must never be allowed to apply against a request naming a DIFFERENT one: that would apply
    // register B's file using register A's `previewedAt` watermark, then call `finishApply` on A's
    // run row — corrupting A's durable history with B's outcome.
    it('⛔ an apply whose runId names a different national system than the request is a 400', async () => {
      const db = await importDb([SYSTEM, 'urn:other:register']);
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const preview = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      const runId = preview.json().runId;

      const other = 'urn:other:register';
      const res = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: other, apply: true, runId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(new RegExp(SYSTEM));
      expect(res.json().error).toMatch(new RegExp(other));
      // A's row must be untouched — no write against B, and the corrupting `finishApply` on A's run
      // never happened either.
      expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
      const runRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` });
      expect(runRes.json().status).toBe('previewed');
    });

    // Fix wave 1 (Important 1) — replay. Resubmitting an already-`applied` runId (an ordinary HTTP
    // retry) must not reuse the stale `previewedAt` watermark to perform a SECOND real write, nor
    // overwrite the first apply's terminal summary with the replay's.
    it('⛔ replaying an already-applied runId is a 409, not a second write', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const preview = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      const runId = preview.json().runId;

      const first = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: SYSTEM, apply: true, runId },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().written).toEqual({ created: 1, updated: 0, retired: 0 });

      const replay = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: SYSTEM, apply: true, runId },
      });
      expect(replay.statusCode).toBe(409);
      expect(replay.json().error).toMatch(/no longer applicable/i);

      // Exactly one row, from the first apply — the replay wrote nothing.
      expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(1);
      // The run's terminal record still reflects the FIRST apply, not the rejected replay.
      const runRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` });
      expect(runRes.json().status).toBe('applied');
    });

    // Fix wave 1 (Important 2). The store `JSON.stringify`s `summary` synchronously inside
    // `finishApply`, so `knownNationalSystem` must be attached to `result` BEFORE that call — this
    // pins that the durable record a reviewer reads back via GET matches what the client received,
    // not the importer's neutral `true` default that predates the route's own computation.
    it('the persisted run summary carries knownNationalSystem, matching what the client received', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const preview = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      const runId = preview.json().runId;

      // A genuinely new register — `importFacilities`'s own un-overridden default is `true`, so a
      // persisted `false` here can only come from the route's assignment actually reaching the store.
      const apply = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: SYSTEM, apply: true, runId },
      });
      expect(apply.statusCode).toBe(200);
      expect(apply.json().knownNationalSystem).toBe(false);

      const runRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` });
      expect((runRes.json().summary as { knownNationalSystem: boolean }).knownNationalSystem).toBe(false);
    });

    // Fix wave 1 (Important 4). This USED TO assert the second preview was a 409 — that was exactly
    // the abandoned-preview lock the finding names: an operator who previews and then simply never
    // applies (closes the sheet, walks away — the most ordinary "changed my mind" path there is)
    // permanently blocked `SYSTEM` from any further preview or runId-less apply, with no cancel path
    // short of a database reset. `startPreview` now supersedes exactly that case (see the route's own
    // comment where the retry lives), so the second preview succeeds instead.
    it('an abandoned preview does not lock the register forever — previewing again supersedes it', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const first = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(first.statusCode).toBe(200);
      const firstRunId = first.json().runId;

      // No apply ever follows for the first run — the operator abandoned it. A second preview for the
      // SAME national system must succeed with a NEW runId, not 409.
      const second = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(second.statusCode).toBe(200);
      const secondRunId = second.json().runId;
      expect(typeof secondRunId).toBe('string');
      expect(secondRunId).not.toBe(firstRunId);

      // The superseded run is retrievable with its terminal state and reason — not silently discarded.
      const firstRunRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${firstRunId}` });
      expect(firstRunRes.json().status).toBe('failed');
      expect(firstRunRes.json().error).toBe('superseded by a newer preview');

      // The new run is a genuine, independently usable preview, not a re-wrapped version of the old one.
      const secondRunRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${secondRunId}` });
      expect(secondRunRes.json().status).toBe('previewed');
    });

    // A2b Task 1. The supersede gate used to read `existing.status !== 'previewed'`, which was
    // correct while `previewed` was the only supersedable state and silently wrong the moment the
    // enum widened: an `awaiting_confirmation` run still holds `active_key`, so the literal
    // comparison would 409 every future preview of that register — the same permanent lock the
    // fix-wave-1 test above closed, reintroduced through a state the line had never heard of.
    //
    // ⚠ The status is set by a DIRECT UPDATE on purpose: no store method mints
    // `awaiting_confirmation` yet (the upload route that will arrives in Task 3), and `active_key`
    // is deliberately left set — that is what makes the second preview's `startPreview` throw and
    // drives execution into the retry branch this test is aiming at.
    it('⛔ supersedes an awaiting_confirmation run — a widened enum must not re-lock the register', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const first = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(first.statusCode).toBe(200);
      const firstRunId = first.json().runId;

      await db.updateTable('facility_import_runs')
        .set({ status: 'awaiting_confirmation' })
        .where('id', '=', firstRunId).execute();
      // The setup itself is asserted: if this ever stopped taking, the test below would pass for the
      // A2a reason (`previewed` is supersedable) and prove nothing about the widened enum.
      const seeded = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${firstRunId}` });
      expect(seeded.json().status).toBe('awaiting_confirmation');
      expect((await db.selectFrom('facility_import_runs').select('active_key')
        .where('id', '=', firstRunId).executeTakeFirstOrThrow()).active_key).toBe(SYSTEM);

      const second = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(second.statusCode).toBe(200);
      expect(second.json().runId).not.toBe(firstRunId);

      const firstRunRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${firstRunId}` });
      expect(firstRunRes.json().status).toBe('failed');
      expect(firstRunRes.json().error).toBe('superseded by a newer preview');
    });

    // A2b Task 1, the apply guard's half of the same defect. `run.status !== 'previewed'` would 409
    // an `awaiting_confirmation` run — a run WITH a completed preview and therefore a trustworthy
    // `previewed_at` watermark — leaving the background path with no way to ever apply.
    it('⛔ applies an awaiting_confirmation run rather than 409ing it as "no longer applicable"', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const preview = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      const runId = preview.json().runId;
      await db.updateTable('facility_import_runs')
        .set({ status: 'awaiting_confirmation' })
        .where('id', '=', runId).execute();
      expect((await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` })).json().status)
        .toBe('awaiting_confirmation');

      const applied = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: SYSTEM, apply: true, runId },
      });
      expect(applied.statusCode).toBe(200);
      expect(applied.json().written).toEqual({ created: 1, updated: 0, retired: 0 });
      expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(1);
      const runRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` });
      expect(runRes.json().status).toBe('applied');
    });

    // A2b Task 1 review fix (b). The old title claimed `only "previewed" is fair game`, which stopped
    // being true when the supersede gate widened to `SUPERSEDABLE_RUN_STATES` — `queued` and
    // `awaiting_confirmation` are fair game too (see the two `awaiting_confirmation` tests above).
    //
    // ⚠ This test does NOT reach the supersede gate, and never did. The apply above goes through
    // `finishApply`, which nulls `active_key` in the same update — so the second preview's
    // `startPreview` pre-check finds no active row, does not throw, and the retry branch holding the
    // gate is never entered. What this pins is the OUTER guarantee (an applied run releases the lock
    // and its terminal record is left untouched), not the gate's terminal→409 branch. That branch is
    // covered by "⛔ 409s a TERMINAL run that is still holding `active_key`…" below, which forces the
    // state the gate would actually have to observe.
    it('an applied run releases the register and its terminal record survives a later preview', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const preview = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      const runId = preview.json().runId;
      const applied = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: SYSTEM, apply: true, runId },
      });
      expect(applied.statusCode).toBe(200);

      // `active_key` was released by the apply above, so a fresh preview is a normal, ordinary
      // success — nothing left over from the applied run to supersede.
      const again = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(again.statusCode).toBe(200);

      // The applied run's terminal record is untouched by the later preview.
      const appliedRunRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` });
      expect(appliedRunRes.json().status).toBe('applied');
      expect(appliedRunRes.json().error).toBeNull();
    });

    // A2b Task 1 review fix (a). The gate's NEGATIVE half — supersede iff SUPERSEDABLE, 409 otherwise
    // — shipped pinned by nothing. The natural route to a terminal run (preview, apply) cannot reach
    // the gate at all: `finishApply` nulls `active_key`, so the next `startPreview` simply succeeds
    // and the retry branch is never entered (see the comment on the test directly above). So the
    // state is constructed directly — the same technique the `awaiting_confirmation` supersede test
    // above uses — leaving `active_key` SET, which is the only thing that makes `startPreview` throw
    // and drives execution into the branch under test.
    //
    // Both cases below are 409s for different reasons: a TERMINAL run is already decided (touching it
    // would re-finish a finished run), a RUNNING run has a live worker (taking it over would race).
    it('⛔ 409s a TERMINAL run that is still holding `active_key` — never supersedes a decided run', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const first = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(first.statusCode).toBe(200);
      const firstRunId = first.json().runId;

      // Status only — `active_key` is deliberately NOT cleared, so this row still holds the lock.
      await db.updateTable('facility_import_runs')
        .set({ status: 'applied' })
        .where('id', '=', firstRunId).execute();
      // The setup is asserted: without both of these the second preview would 200 for a reason that
      // has nothing to do with the gate.
      expect((await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${firstRunId}` })).json().status)
        .toBe('applied');
      expect((await db.selectFrom('facility_import_runs').select('active_key')
        .where('id', '=', firstRunId).executeTakeFirstOrThrow()).active_key).toBe(SYSTEM);

      const second = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(second.statusCode).toBe(409);
      // A2b Task 3 review fix (M3). The shared `takeOverRegister` changed this WIRE-VISIBLE message
      // from the store's `an import is already in progress for "X"` to one that names the run and its
      // state, because the two 409s have very different remedies (clear a stuck decided run vs wait
      // for a live worker). The status code alone pinned neither direction of that change.
      expect(second.json().error).toContain(`import run ${firstRunId} is already applied but still holds`);
      expect(second.json().error).toContain(SYSTEM);

      // The decided run is left exactly as it was — not re-finished as 'failed', not given a
      // supersede reason, and still holding the key it was (wrongly) holding.
      const firstRunRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${firstRunId}` });
      expect(firstRunRes.json().status).toBe('applied');
      expect(firstRunRes.json().error).toBeNull();
    });

    it('⛔ 409s a RUNNING run rather than superseding it — taking over would race a live worker', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const first = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(first.statusCode).toBe(200);
      const firstRunId = first.json().runId;

      // `validating` is exactly what A2b's worker will hold while it is mid-flight, and it holds
      // `active_key` for the whole of that time — so this is the real shape, not an invented one.
      await db.updateTable('facility_import_runs')
        .set({ status: 'validating' })
        .where('id', '=', firstRunId).execute();
      expect((await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${firstRunId}` })).json().status)
        .toBe('validating');
      expect((await db.selectFrom('facility_import_runs').select('active_key')
        .where('id', '=', firstRunId).executeTakeFirstOrThrow()).active_key).toBe(SYSTEM);

      const second = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(second.statusCode).toBe(409);
      // A2b Task 3 review fix (M3), as on the TERMINAL test above: the shared gate's message now
      // names the holder and its live state. This is the "wait for the worker" half of the pair, and
      // it must stay distinguishable from the "clear the stuck run" half.
      expect(second.json().error).toContain(`an import is already in progress for "${SYSTEM}"`);
      expect(second.json().error).toContain(`run ${firstRunId} is validating`);

      // The live run is untouched: still `validating`, still holding its key. A superseding gate
      // would have marked it 'failed' out from under the worker.
      const firstRunRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${firstRunId}` });
      expect(firstRunRes.json().status).toBe('validating');
      expect(firstRunRes.json().error).toBeNull();
      expect((await db.selectFrom('facility_import_runs').select('active_key')
        .where('id', '=', firstRunId).executeTakeFirstOrThrow()).active_key).toBe(SYSTEM);
    });

    it('a failed apply marks its run failed rather than leaving the register locked forever', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
      const preview = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      const runId = preview.json().runId;

      (db as unknown as { transaction: () => never }).transaction = () => { throw new Error('simulated connection loss'); };

      const res = await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv, nationalSystem: SYSTEM, apply: true, runId },
      });
      expect(res.statusCode).toBe(500);

      const runRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` });
      expect(runRes.json().status).toBe('failed');

      // The proof that matters: `active_key` was released, so the SAME national system can be
      // previewed again rather than being locked out by a run nothing will ever finish.
      const again = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
      expect(again.statusCode).toBe(200);
    });
  });

  describe('GET /api/facilities/import/runs', () => {
    it('gated on facilities.view — no capability at all is a 403', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db), []);
      const res = await app.inject({ method: 'GET', url: '/api/facilities/import/runs' });
      expect(res.statusCode).toBe(403);
    });

    it('scopes by nationalSystem and orders newest first', async () => {
      const db = await importDb([SYSTEM, 'urn:other:register']);
      const app = await appWith(fakeImportCtx(db));
      const csvA = facilityCsv(['100,Alpha,,,,,,,,,,,,,,']);
      const csvB = facilityCsv(['200,Beta,,,,,,,,,,,,,,']);

      const a1 = (await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv: csvA, nationalSystem: SYSTEM } })).json();
      // Finishes the first run (by applying it) so a second preview for the SAME system is a normal
      // success rather than superseding an active one — this test is about scoping/ordering, not the
      // abandoned-preview supersede path (see the "an abandoned preview…" test above for that).
      await app.inject({
        method: 'POST', url: '/api/facilities/import',
        payload: { csv: csvA, nationalSystem: SYSTEM, apply: true, runId: a1.runId },
      });
      const a2 = (await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv: csvA, nationalSystem: SYSTEM } })).json();
      // A run for a DIFFERENT national system — must never appear in a SYSTEM-scoped list below.
      await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv: csvB, nationalSystem: 'urn:other:register' } });

      const res = await app.inject({ method: 'GET', url: `/api/facilities/import/runs?nationalSystem=${encodeURIComponent(SYSTEM)}` });
      expect(res.statusCode).toBe(200);
      const { runs } = res.json();
      // Fix wave 1 (Important 3). Complete-object `toEqual` on the FULL list — the previous
      // `runs.map(r => r.id)` / `runs.every(...)` pair only ever checked two of seventeen fields and
      // would stay green even if the route stopped returning, say, `previewedAt` or `requestedBy`
      // entirely.
      const csvAHash = createHash('sha256').update(csvA, 'utf8').digest('hex');
      const csvABytes = Buffer.byteLength(csvA, 'utf8');
      const runShape = {
        nationalSystem: SYSTEM, sourceFormat: 'csv', fileHash: csvAHash, byteSize: csvABytes,
        releaseVersion: null, releasePublishedAt: null, declaredRowCount: null, declaredDeletionCount: null,
        previewedAt: expect.any(String), summary: expect.any(Object), options: { nationalSystem: SYSTEM },
        error: null, requestedBy: 'u1', createdAt: expect.any(String),
        // A2b Task 2's added columns, concrete for the same reason as the `GET .../runs/:id`
        // assertions above: both of these runs came from the INLINE preview path, which stores no
        // file and is never claimed by a worker.
        blobKey: null, phase: null, processed: 0, total: null, cancelRequested: false, startedAt: null,
      };
      expect(runs).toEqual([
        // Newest first: a2, the still-open preview.
        { ...runShape, id: a2.runId, status: 'previewed', finishedAt: null },
        // a1 was applied, so it carries a `finishedAt` and a terminal `status`.
        { ...runShape, id: a1.runId, status: 'applied', finishedAt: expect.any(String) },
      ]);
    });

    it('GET .../runs/:id 404s on an unknown id', async () => {
      const db = await importDb();
      const app = await appWith(fakeImportCtx(db));
      const res = await app.inject({ method: 'GET', url: '/api/facilities/import/runs/nope' });
      expect(res.statusCode).toBe(404);
    });
  });
});

// --- B1 Task 9: GET/POST /api/facilities/import/sources -----------------------------------------
//
// The registers an operator may PICK. GET backs the import sheet's `Select` (Task 9 turns the free-
// text `nationalSystem` box into one); POST is the only way a fresh install ever gets a register to
// offer at all. Both sit on `createFacilityRegisterSourceStore` — the same store `seedRegisterSource`
// above already uses to seed a register for the import-route tests.

describe('GET /api/facilities/import/sources', () => {
  it('lists only facility registers, never other coding systems', async () => {
    const db = await importDb([SYSTEM]);
    // A coding system that is NOT a register — the reason `kind` exists, and must not appear here.
    await db.insertInto('coding_systems').values({
      id: 'cs-loinc', system_code: 'LOINC', system_name: 'LOINC', url: 'http://loinc.org',
    }).execute();
    const app = await appWith(fakeImportCtx(db));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/import/sources' });

    expect(res.statusCode).toBe(200);
    expect(res.json().rows.map((r: any) => r.url)).toEqual([SYSTEM]);
  });

  // Review fix (B1 Task 3)'s deactivated-register gate only has teeth if THIS list — the picklist's
  // own source — never offers a spelling the import routes will then refuse.
  it('excludes a deactivated register — the picklist must never offer a spelling the import routes refuse', async () => {
    const db = await importDb([SYSTEM]);
    await deactivateRegisterSource(db, SYSTEM);
    const app = await appWith(fakeImportCtx(db));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/import/sources' });

    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toEqual([]);
  });

  it('is gated on facilities.view — a user without it gets 403', async () => {
    const db = await importDb([SYSTEM]);
    const app = await appWith(fakeImportCtx(db), []);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/import/sources' });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/facilities/import/sources', () => {
  it('creates a register source that the import route accepts immediately afterward', async () => {
    const db = await makeMigratedDb(); // deliberately unregistered
    const app = await appWith(fakeImportCtx(db));

    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/sources',
      payload: { url: SYSTEM, name: 'Tanzania HFR', code: 'TZ_HFR' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ url: SYSTEM, name: 'Tanzania HFR', code: 'TZ_HFR', active: true });

    // ⛔ THE WHOLE POINT of this route: what it just created is exactly what the import gate accepts.
    const importRes = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), nationalSystem: SYSTEM },
    });
    expect(importRes.statusCode).toBe(200);
    expect(importRes.json().parsed).toBe(1);
  });

  it('is gated on facilities.manage — a facilities.view-only user gets 403 and nothing is created', async () => {
    const db = await makeMigratedDb();
    // The migration set seeds its own coding systems (LOINC etc.) — this counts against THAT
    // baseline rather than asserting an empty table, so it fails honestly if the seed set ever
    // changes instead of asserting a number this test does not actually own.
    const before = await db.selectFrom('coding_systems').selectAll().execute();
    const app = await appWith(fakeImportCtx(db), ['facilities.view']);

    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/sources',
      payload: { url: SYSTEM, name: 'Tanzania HFR', code: 'TZ_HFR' },
    });

    expect(res.statusCode).toBe(403);
    expect(await db.selectFrom('coding_systems').selectAll().execute()).toHaveLength(before.length);
  });

  it('400s on a missing required field', async () => {
    const db = await makeMigratedDb();
    const app = await appWith(fakeImportCtx(db));

    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/sources',
      payload: { url: SYSTEM, name: 'Tanzania HFR' }, // no code
    });

    expect(res.statusCode).toBe(400);
  });

  // ⛔ Carry-forward 1 (deferred from B1 Task 3, closed here): an EXACT-match pre-check alone ships
  // the original defect through this front door — 'urn:tz:hfr' and 'urn:tz:HFR' would each
  // individually pass it, each earn their own row, each satisfy the import route's own exact-match
  // gate, and each hash to a DIFFERENT `idFor` identity while sharing the SAME `observedFieldSystem`
  // namespace (that function lowercases its slug; `idFor` does not — see facilities-routes.ts's own
  // comment on the fork this whole slice exists to close). This is that same fork, arriving through
  // the source route instead of the import route.
  it('⛔ refuses a case-insensitive duplicate of a registered URL, not just an exact one', async () => {
    const db = await importDb([SYSTEM]); // urn:tz:hfr
    const app = await appWith(fakeImportCtx(db));

    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/sources',
      payload: { url: 'urn:tz:HFR', name: 'Tanzania HFR (upper)', code: 'TZ_HFR_2' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already exists/i);
    expect(await createFacilityRegisterSourceStore(db).list({ includeInactive: true })).toHaveLength(1);
  });

  // ⛔ Carry-forward 2 (deferred from B1 Task 3, closed here): `coding_systems_url_uq` (migration
  // 012) is a PLAIN unique index on `url` ALONE, not scoped by `kind` — while the store's own pre-
  // checks (exact AND case-insensitive) ARE scoped to `kind = 'facility-register'`. MEASURED, on
  // REAL POSTGRES ONLY (node-postgres puts a violation's `DETAIL` text on `err.detail`, never on
  // `err.message`): before the store's catch (facility-register-sources.ts) existed, a url already
  // used by a non-register coding system passed the pre-check and threw a raw, unmapped 23505 whose
  // `.message` carried none of the "already exists" wording — a bare 500, not a 4xx.
  //
  // ⛔ THAT "bare 500" claim does NOT reproduce under pg-mem, this test's own engine — MEASURED:
  // pg-mem inlines the constraint violation's DETAIL text straight into `err.message` ("... DETAIL:
  // Key (url)=(http://loinc.org) already exists."), so even with the store's catch disarmed, the
  // RAW driver error's `.message` still matches this route's own `/already exists/i` translator and
  // still comes back 409 — coincidentally right, for the wrong reason. A regex assertion on that
  // shared substring proves nothing about which of the two catches actually fired (confirmed by
  // disarming the store's `isUniqueViolation` branch and re-running this test: it stayed green).
  // The signal that only the STORE's translation can produce is the exact message below — the raw
  // pg-mem error's message is a multi-paragraph SQL dump that does not equal it.
  it('⛔ refuses (409, not 500) a URL already used by a NON-register coding system', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('coding_systems').values({
      id: 'cs-loinc', system_code: 'LOINC', system_name: 'LOINC', url: 'http://loinc.org',
    }).execute();
    const app = await appWith(fakeImportCtx(db));

    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/sources',
      payload: { url: 'http://loinc.org', name: 'Not actually a register', code: 'X' },
    });

    expect(res.statusCode).toBe(409);
    // Exact match, not a `/already exists/i` regex — see the block above for why the regex alone
    // does not discriminate "the store translated this" from "pg-mem's raw driver message happens
    // to contain the same words" under this test's own engine.
    expect(res.json().error).toBe('a coding system already exists for the url "http://loinc.org"');
  });
});

// Task 4 (facility-import-mapping): the offline suggestion engine (Task 2, facility-mapping-
// suggest.ts) exposed over HTTP for BOTH import doors — the inline path already holds the file
// text client-side, the streamed upload path does not (the file is a blob only the server can
// read). One endpoint rather than two mechanisms that would drift.
describe('POST /api/facilities/import/suggest-map', () => {
  it('suggests a column map from a file header row', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/suggest-map',
      payload: { csv: 'MFL Code,Name,Province,Catchment population cso\n1835,X,Western,10\n' },
    });
    expect(res.statusCode).toBe(200);
    const resBody = res.json();
    expect(resBody.headers).toEqual(['MFL Code', 'Name', 'Province', 'Catchment population cso']);
    const byHeader = Object.fromEntries(resBody.columns.map((c: any) => [c.header, c.candidates]));
    expect(byHeader['MFL Code'][0]).toMatchObject({ target: 'national_code' });
    expect(byHeader.Province[0]).toMatchObject({ target: 'zone' });
    expect(byHeader['Catchment population cso']).toEqual([]);
  });

  it('refuses a suggest-map request with no header row', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/suggest-map', payload: { csv: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('is gated on facilities.manage — a facilities.view-only user gets 403', async () => {
    const app = await appWith(fakeCtx(), ['facilities.view']);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/suggest-map',
      payload: { csv: 'Name\nX\n' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/facilities/import/suggest-values', () => {
  it('suggests value mappings from the bound value set', async () => {
    // The real store against a real migrated db (migration 072 seeds location-status), not
    // `fakeCtx()`'s hand-rolled admin double — the whole point of this test is that neither
    // Zambian word resembles active/suspended/inactive closely enough to clear the engine's floor.
    const internalDb = await makeMigratedDb();
    const app = await appWith(fakeCreateCtx(internalDb));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/suggest-values',
      payload: { field: 'status', values: ['Functional', 'Temporarily closure'] },
    });
    expect(res.statusCode).toBe(200);
    const byValue = Object.fromEntries(res.json().values.map((v: any) => [v.value, v.candidates]));
    // Mapping them is a human judgement, and the engine says so by offering nothing.
    expect(byValue.Functional).toEqual([]);
    expect(byValue['Temporarily closure']).toEqual([]);
  });

  it('refuses suggest-values for a field that is not controlled', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/suggest-values',
      payload: { field: 'name', values: ['x'] },
    });
    expect(res.statusCode).toBe(400);
  });

  // A field's value set not seeded on this install mirrors `resolveControlledFields`'s own
  // contract: reported `notValidated`, never a 500 or a refusal.
  it('reports notValidated rather than erroring when the field\'s value set is not seeded', async () => {
    // Same simulated-absence pattern as Task 6's "reports NOT VALIDATED" test above: a real store,
    // with its own `getByUrl` overridden to report the location-status ValueSet absent.
    const internalDb = await makeMigratedDb();
    const ctx = fakeCreateCtx(internalDb);
    ctx.terminology.admin.valueSets.getByUrl = async () => null;
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/suggest-values',
      payload: { field: 'status', values: ['Functional'] },
    });
    expect(res.statusCode).toBe(200);
    const resBody = res.json();
    expect(resBody.notValidated).toBe(true);
    expect(resBody.values).toEqual([{ value: 'Functional', candidates: [] }]);
  });

  it('is gated on facilities.manage — a facilities.view-only user gets 403', async () => {
    const app = await appWith(fakeCtx(), ['facilities.view']);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/suggest-values',
      payload: { field: 'status', values: ['x'] },
    });
    expect(res.statusCode).toBe(403);
  });

  // Whole-branch review, M1: `values` used to be a bare `as { values?: string[] }` cast — it checked
  // `Array.isArray` but never each element's type. `{"field":"status","values":[42]}` reached
  // `suggestValues` -> `rank` -> `normaliseLabel`, which calls `.replace` on the raw value — a
  // TypeError (`.replace is not a function`) that surfaced as an unhandled 500 where a 400 is already
  // the documented refusal for a bad request body.
  it('⛔ refuses a values array with a non-string element as a 400, not a 500', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/suggest-values',
      payload: { field: 'status', values: [42] },
    });
    expect(res.statusCode).toBe(400);
  });
});

// Task 6 (facility-import-mapping): the wizard's value panel writes its raw-string -> canonical-code
// decisions here (Task 5's `saveFacilityValueMappings`). Real store, real migrated db (like
// suggest-values above) — the whole point is proving these decisions land against the REAL seeded
// location-status value set (migration 072), not a hand-rolled double.
describe('POST /api/facilities/import/value-mappings', () => {
  it('writes value mappings and audits them', async () => {
    const internalDb = await importDb([SYSTEM]);
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);

    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/value-mappings',
      payload: {
        nationalSystem: SYSTEM,
        mappings: [{ field: 'status', rawValue: 'Operating', toCode: 'active' }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().written).toBe(1);
    expect(ctx.__audit.map((a: any) => a.action)).toEqual(['facility.value-mapping']);
  });

  it('refuses a nationalSystem that names no registered source', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(fakeCreateCtx(internalDb));

    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/value-mappings',
      payload: { nationalSystem: 'typed by hand', mappings: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('is gated on facilities.manage — a facilities.view-only user gets 403', async () => {
    const internalDb = await importDb([SYSTEM]);
    const app = await appWith(fakeCreateCtx(internalDb), ['facilities.view']);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/value-mappings',
      payload: { nationalSystem: SYSTEM, mappings: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  // Mirrors saveFacilityValueMappings' own "refuses a target that is not in the field value set"
  // test (facility-value-mappings.test.ts) — proving the route surfaces that refusal as a 400 with
  // the store's own message, rather than a bare 500, and audits nothing when it's refused.
  it('refuses a toCode that is not in the field value set, and writes/audits nothing', async () => {
    const internalDb = await importDb([SYSTEM]);
    const ctx = fakeCreateCtx(internalDb);
    const app = await appWith(ctx);

    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import/value-mappings',
      payload: {
        nationalSystem: SYSTEM,
        mappings: [{ field: 'status', rawValue: 'Operating', toCode: 'not-a-real-code' }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(ctx.__audit).toHaveLength(0);
  });
});

// --- A2b Task 3: POST /api/facilities/import/upload -------------------------------------------
//
// The upload END of the background import: the file goes to blob storage and a `queued` run is
// minted for the worker (Task 4) to claim. Everything here is about what the REQUEST leaves behind —
// the stored object, the run row, and what happens to whatever run already held the register — since
// nothing consumes any of it yet.

const UPLOAD_HEADERS = { 'content-type': 'application/octet-stream' };

function uploadUrl(params: Record<string, string>): string {
  return `/api/facilities/import/upload?${new URLSearchParams(params).toString()}`;
}

/** The single object this request stored, key and bytes. Fails loudly rather than returning
 *  `undefined` when the count is not 1 — several tests below assert "nothing more was stored", and a
 *  helper that silently picked the first of two would hide exactly that. */
function onlyStoredObject(ctx: any): { key: string; bytes: Buffer } {
  const entries = [...ctx.blob.__objects.entries()] as [string, Buffer][];
  expect(entries).toHaveLength(1);
  return { key: entries[0][0], bytes: entries[0][1] };
}

describe('POST /api/facilities/import/upload', () => {
  it('gated on facilities.manage — a facilities.view-only user gets 403 and nothing is stored', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx, ['facilities.view']);
    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(res.statusCode).toBe(403);
    expect(ctx.blob.__objects.size).toBe(0);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
  });

  it('streams the file to the blob store and mints a `queued` run carrying its key, hash and size', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);

    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', releaseVersion: 'r7' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(csv, 'utf8'),
    });

    // 202, not 201: the register has NOT been imported, or even read — a worker will do that. The
    // body is the runId and nothing else, so a client cannot mistake this for a preview result.
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ runId: expect.any(String) });
    const runId = res.json().runId;

    // ⛔ The stored object is the file, byte for byte. Without this the hash assertion below could be
    // satisfied by hashing something that was never uploaded.
    const stored = onlyStoredObject(ctx);
    expect(stored.bytes.toString('utf8')).toBe(csv);
    expect(stored.key).toMatch(/^facility-import\/[a-z0-9-]+\/[0-9a-f-]{36}\.csv$/);

    const runRes = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` });
    expect(runRes.statusCode).toBe(200);
    // Complete-object `toEqual` with CONCRETE values, matching the sibling `GET .../runs/:id`
    // assertions above: this is the only thing pinning what an UPLOADED run looks like, and every
    // field that differs from an inline preview's row (blobKey, status, previewedAt, summary) is a
    // field a reader will rely on.
    expect(runRes.json()).toEqual({
      id: runId,
      nationalSystem: SYSTEM,
      sourceFormat: 'csv',
      // The link between the run and the bytes — the same key the blob store actually received.
      blobKey: stored.key,
      // ⛔ The hash of the STORED bytes, computed as they streamed past. Mutating the route's digest
      // to a constant must fail here.
      fileHash: createHash('sha256').update(csv, 'utf8').digest('hex'),
      byteSize: Buffer.byteLength(csv, 'utf8'),
      releaseVersion: 'r7',
      // ⛔ NOT EVALUATED, never zero: nothing has read the file yet, so the release header's own
      // declarations are unknown — only the worker can fill these in (see `startUpload`'s comment).
      releasePublishedAt: null,
      declaredRowCount: null,
      declaredDeletionCount: null,
      status: 'queued',
      phase: null,
      processed: 0,
      total: null,
      previewedAt: null,
      summary: null,
      options: { nationalSystem: SYSTEM },
      error: null,
      cancelRequested: false,
      requestedBy: 'u1', // `req.user.id` from `appWith`'s fake `onRequest` hook
      createdAt: expect.any(String),
      startedAt: null,
      finishedAt: null,
    });
  });

  // ⛔ THE DECLARATION HAS TO REACH THE RUN, or the background door cannot express two-tier
  // retirement at all. `absent` is classified during the VALIDATE phase off `run.options` (the
  // worker's `validateOptions` spreads them into `importFacilities`), so a `completeRelease` that
  // stopped at this route would leave every background validate reporting `absent: null` — NOT
  // EVALUATED — no matter what the file is. The inline route is capped at `MAX_INLINE_APPLY_ROWS`,
  // so without this a national complete release could get absence-retirement through the CLI alone.
  it('records a declared complete release in the run\'s options, where the validate phase reads it', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST',
      url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', completeRelease: 'true' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(res.statusCode).toBe(202);
    const run = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${res.json().runId}` })).json();
    // ⛔ Exact object. The sibling test above pins that an upload WITHOUT this parameter stores
    // `{ nationalSystem }` and nothing else, so the two together say the key is present exactly when
    // the operator declared it — and neither the operator's import options (`onAbsent`, the
    // `allow*` family) nor anything else the confirm step owns has leaked in here.
    expect(run.options).toEqual({ nationalSystem: SYSTEM, completeRelease: true });
  });

  // ⛔ `'false'` IS NOT `false`-y ON A QUERY STRING. A `!!ownFirstString(...)` here would read the
  // literal text 'false' as a declaration the operator explicitly declined to make — and a
  // declaration is the thing that lets an absence be counted at all.
  it('an explicitly declined complete release is recorded as declined, never as declared', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST',
      url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', completeRelease: 'false' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(res.statusCode).toBe(202);
    const run = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${res.json().runId}` })).json();
    expect(run.options).toEqual({ nationalSystem: SYSTEM, completeRelease: false });
  });

  // ── Task 8b: the upload door's own columnMap wire gap ────────────────────────────────────────────
  //
  // This route has no multipart body — the request body IS the file (`isReadableBody`) — so the map
  // rides the query string JSON-encoded, exactly like `completeRelease`/`allowUnknownColumns` above.
  // It belongs to the UPLOAD, not the confirm: the worker's VALIDATE phase is what turns this file
  // into the summary an operator reviews, so a map arriving only at confirm time would let an
  // operator confirm a summary the apply then contradicts.

  it('records a columnMap sent on the query string in the run\'s options, where the validate phase reads it', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const columnMap = { columns: { 'MFL Code': 'national_code', 'Facility Name': 'name' } };
    const res = await app.inject({
      method: 'POST',
      url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', columnMap: JSON.stringify(columnMap) }),
      headers: UPLOAD_HEADERS,
      payload: Buffer.from(['MFL Code,Facility Name', '100,Alpha'].join('\n') + '\n', 'utf8'),
    });
    expect(res.statusCode).toBe(202);
    const run = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${res.json().runId}` })).json();
    expect(run.options).toEqual({ nationalSystem: SYSTEM, columnMap });
  });

  it('refuses a columnMap that is not valid JSON, before the transfer', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST',
      url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', columnMap: '{not json' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(res.statusCode).toBe(400);
    expect(ctx.blob.__objects.size).toBe(0);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
  });

  it('refuses a columnMap of the wrong shape, before the transfer', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST',
      url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', columnMap: JSON.stringify({ columns: 'nope' }) }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(res.statusCode).toBe(400);
    expect(ctx.blob.__objects.size).toBe(0);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
  });

  it('refuses a completeRelease that is neither "true" nor "false", rather than guessing at it', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST',
      url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', completeRelease: 'yes' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(res.statusCode).toBe(400);
    // Refused BEFORE the transfer, like every other parameter check on this route: a rejected upload
    // must not first cost a register's worth of bandwidth or leave an object behind.
    expect(ctx.blob.__objects.size).toBe(0);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
  });

  it('audits the upload with the run it minted', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Alpha,,,,,,,,,,,,,,']);
    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(csv, 'utf8'),
    });
    expect(res.statusCode).toBe(202);
    expect(ctx.__audit).toHaveLength(1);
    expect(ctx.__audit[0]).toMatchObject({
      action: 'facility.import.uploaded',
      entityType: 'facility',
      entityId: SYSTEM,
      metadata: {
        runId: res.json().runId,
        nationalSystem: SYSTEM,
        sourceFormat: 'csv',
        blobKey: onlyStoredObject(ctx).key,
        byteSize: Buffer.byteLength(csv, 'utf8'),
      },
    });
  });

  // ⛔ THE PRODUCT POINT OF A2b. `MAX_INLINE_APPLY_ROWS` (2000) bounds `POST /api/facilities/import`
  // and must keep doing so — that route holds an HTTP request open for the whole apply. This path
  // holds one open for nothing but the transfer, so a national register must go through it. A cap
  // re-applied here (or the two routes "unified") fails this test.
  it('⛔ accepts a register far ABOVE the inline apply cap — that cap bounds the inline route only', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const rows = Array.from({ length: 2500 }, (_, i) => `${1000 + i},Facility ${i},,,,,,,,,,,,,,`);
    const csv = facilityCsv(rows);

    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(csv, 'utf8'),
    });

    expect(res.statusCode).toBe(202);
    const stored = onlyStoredObject(ctx);
    expect(stored.bytes.toString('utf8')).toBe(csv);
    const run = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${res.json().runId}` })).json();
    expect(run.byteSize).toBe(Buffer.byteLength(csv, 'utf8'));
    expect(run.fileHash).toBe(createHash('sha256').update(csv, 'utf8').digest('hex'));
  });

  it('a JSONL upload is stored under a .jsonl key and recorded as sourceFormat jsonl', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const body = jsonl([rowLine('100', 'Alpha'), rowLine('200', 'Beta')]);

    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'jsonl' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(body, 'utf8'),
    });

    expect(res.statusCode).toBe(202);
    expect(onlyStoredObject(ctx).key).toMatch(/\.jsonl$/);
    const run = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${res.json().runId}` })).json();
    expect(run.sourceFormat).toBe('jsonl');
  });

  // The same abandoned-register rule the inline preview route already follows, reached through the
  // upload: an operator who uploads and never confirms must not lock the register for good.
  it('supersedes an awaiting_confirmation run rather than refusing the new upload', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Alpha,,,,,,,,,,,,,,']);
    const first = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(csv, 'utf8'),
    });
    expect(first.statusCode).toBe(202);
    const firstRunId = first.json().runId;

    // ⚠ Set by a DIRECT UPDATE: nothing mints `awaiting_confirmation` until the worker lands in Task
    // 4, and `active_key` is deliberately left SET — that is what makes this run the holder the gate
    // has to decide about. Asserted, so a setup that stopped taking cannot leave the test green for
    // the uninteresting reason that the register was free all along.
    await db.updateTable('facility_import_runs').set({ status: 'awaiting_confirmation' })
      .where('id', '=', firstRunId).execute();
    expect((await db.selectFrom('facility_import_runs').select(['status', 'active_key'])
      .where('id', '=', firstRunId).executeTakeFirstOrThrow()))
      .toEqual({ status: 'awaiting_confirmation', active_key: SYSTEM });

    const second = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(csv, 'utf8'),
    });

    expect(second.statusCode).toBe(202);
    expect(second.json().runId).not.toBe(firstRunId);
    // The superseded run keeps its record and says why it ended — not silently discarded.
    const firstRun = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${firstRunId}` })).json();
    expect(firstRun.status).toBe('failed');
    expect(firstRun.error).toBe('superseded by a newer upload');
    const secondRun = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${second.json().runId}` })).json();
    expect(secondRun.status).toBe('queued');
  });

  it('⛔ 409s while a run is `validating` — taking the register over would race a live worker', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Alpha,,,,,,,,,,,,,,']);
    const first = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(csv, 'utf8'),
    });
    expect(first.statusCode).toBe(202);
    const firstRunId = first.json().runId;

    await db.updateTable('facility_import_runs').set({ status: 'validating' })
      .where('id', '=', firstRunId).execute();
    expect((await db.selectFrom('facility_import_runs').select(['status', 'active_key'])
      .where('id', '=', firstRunId).executeTakeFirstOrThrow()))
      .toEqual({ status: 'validating', active_key: SYSTEM });

    const second = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(csv, 'utf8'),
    });

    expect(second.statusCode).toBe(409);
    // The message names the live run's state, so an operator can tell "a worker is busy" from "a
    // decided run is stuck holding the register" — two 409s with very different remedies.
    expect(second.json().error).toContain('validating');
    // The live run is untouched: still `validating`, still holding its key.
    expect((await db.selectFrom('facility_import_runs').select(['status', 'active_key', 'error'])
      .where('id', '=', firstRunId).executeTakeFirstOrThrow()))
      .toEqual({ status: 'validating', active_key: SYSTEM, error: null });
    // ⛔ And NOTHING was streamed for the refused request — the gate runs BEFORE the transfer, so a
    // refused upload does not cost a national register's worth of bandwidth or leave an orphan
    // object behind. Only the first upload's object exists.
    expect(ctx.blob.__objects.size).toBe(1);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(1);
  });

  it('a non-stream body is a clear 400, not a crash or a 415', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      payload: { csv: 'national_code,name\n100,Alpha\n' }, // JSON body — the inline route's shape
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/stream/i);
    expect(ctx.blob.__objects.size).toBe(0);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
  });

  // An empty file must not mint a run: the run would hold `active_key` — locking the register out of
  // the next, real upload — until a worker got round to reporting that there was nothing in it.
  it('refuses an empty upload (400) and leaves neither a run nor a stored object behind', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);

    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.alloc(0),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/empty/i);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
    // The (zero-byte) object the transfer created is cleaned up — `delete` on the store double
    // removes the key, so an uncleaned one would show up here.
    expect(ctx.blob.__objects.size).toBe(0);

    // …and the register is still free: a real upload right after it succeeds.
    const after = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(after.statusCode).toBe(202);
  });

  it('refuses a missing nationalSystem and an unknown format (400) before storing anything', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const payload = Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8');

    const noSystem = await app.inject({
      method: 'POST', url: uploadUrl({ format: 'csv' }), headers: UPLOAD_HEADERS, payload,
    });
    expect(noSystem.statusCode).toBe(400);
    expect(noSystem.json().error).toMatch(/nationalSystem/);

    const badFormat = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'xlsx' }),
      headers: UPLOAD_HEADERS, payload,
    });
    expect(badFormat.statusCode).toBe(400);
    expect(badFormat.json().error).toMatch(/format/);

    expect(ctx.blob.__objects.size).toBe(0);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
  });

  // ⛔ BOTH IMPORT DOORS ARE GATED. The inline route's own version of this test is above; this is
  // the streaming one. They are separate handlers with separate parameter parsing (JSON body vs
  // query string), and the predecessor slice's cautionary tale — twice over — is two doors that
  // disagree. An ungated upload would hand the worker a typed-in register and re-open the fork at
  // exactly the scale this path exists for (a full national register).
  it('⛔ refuses an upload whose nationalSystem is not a known register source, before storing anything', async () => {
    const db = await makeMigratedDb(); // deliberately unregistered
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);

    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: 'HFR', format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not a known facility register/i);
    // ⛔ BEFORE the transfer, not after it: a refused upload must not first cost a national
    // register's worth of bandwidth and leave an orphan object (or a `queued` run) behind.
    expect(ctx.blob.__objects.size).toBe(0);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
  });

  // Review fix (B1 Task 3, MINOR finding): the SAME deactivated-register refusal as the inline
  // route's version of this test above — `getByUrl` does not filter on `active`, so this door needs
  // its own check too. BEFORE the transfer, like the unknown-register refusal it sits beside.
  it('⛔ refuses an upload naming a DEACTIVATED register, before storing anything', async () => {
    const db = await importDb();
    await deactivateRegisterSource(db, SYSTEM);
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);

    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/deactivated/i);
    expect(res.json().error).not.toMatch(/not a known facility register/i);
    expect(ctx.blob.__objects.size).toBe(0);
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
  });

  // --- A2b Task 3 review fix (I1): a sink that fails WITHOUT draining ---------------------------
  //
  // ⚠ `fakeBlobStore` deliberately DRAINS (as the real S3 multipart `Upload` does on the happy
  // path). This double is the FAILURE shape that one cannot express: `Upload.done()` rejecting on a
  // bad bucket or bad credentials while its chunk generator stops consuming. Nothing then reads the
  // hashing transform, so `pipeline(req.body, hashing)` is parked on backpressure with a source that
  // will never drain.
  //
  // TWO distinct regressions are pinned here, because the fix has two halves — and each was
  // demonstrated by mutating the route and watching THIS test go red:
  //
  //  1. THE ANSWER. Awaiting BOTH sides (`Promise.allSettled`, which this route used to do) instead
  //     of `Promise.all` fails this test — the sink's rejection escapes the handler instead of
  //     becoming a 500. (The over-cap test below is the one where a reintroduced `allSettled` HANGS
  //     outright; see its own note.) The 5s budget is a guard for this family of failures generally,
  //     since a stream that never settles stalls the suite rather than failing it.
  //  2. THE TEARDOWN, asserted directly on the transform the route handed the store (`handed`
  //     below). `Promise.all` answers without waiting, so a leaked pipeline is INVISIBLE in the
  //     response — the transform being `destroyed` is the only observable trace of
  //     `stored.catch(e => hashing.destroy(e))`. Replacing that line with a no-op leaves this
  //     request answering 500 exactly as before while the request stream and the transform are held
  //     for the life of the process (Fastify sets no `requestTimeout` — see app.ts).
  it('⛔ fails fast (500) when the blob store rejects WITHOUT draining, and tears the transfer down', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const deleted: string[] = [];
    // The hashing transform the route pipes into — captured, then abandoned unread.
    let handed: { destroyed: boolean } | null = null;
    ctx.blob = {
      // Rejects promptly and never touches `body` — the stream is left with nobody reading it.
      async putStream(_key: string, body: { destroyed: boolean }) {
        handed = body;
        throw new Error('simulated blob store failure: no such bucket');
      },
      async delete(key: string) { deleted.push(key); },
      __objects: new Map<string, Buffer>(),
    };
    const app = await appWith(ctx);

    // ⛔ Comfortably above the transform's 16 KiB default highWaterMark, so the pipeline is genuinely
    // under backpressure when the sink gives up. A payload that fits in one buffer would complete on
    // its own and prove nothing.
    const csv = facilityCsv(Array.from({ length: 20_000 }, (_, i) => `${1000 + i},Facility ${i},,,,,,,,,,,,,,`));
    expect(Buffer.byteLength(csv, 'utf8')).toBeGreaterThan(512 * 1024);

    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(csv, 'utf8'),
    });

    expect(res.statusCode).toBe(500);
    // ⛔ Regression 2: the abandoned transform was torn down rather than left parked forever.
    expect(handed).not.toBeNull();
    expect(handed!.destroyed).toBe(true);
    // The transfer failed, so nothing is queued and the (possibly partial) object is discarded —
    // `discardBlob` ran, which is the cleanup path an unresolved await never reaches at all.
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
    expect(deleted).toEqual([expect.stringMatching(/^facility-import\//)]);
    // And the register is not left locked by the failure: the next upload succeeds.
    ctx.blob = fakeBlobStore();
    const after = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(after.statusCode).toBe(202);
  }, 5000);

  // --- A2b Task 3 review fix (I2): the upload's real byte ceiling ------------------------------
  //
  // `bodyLimit` is INERT for this route (measured against fastify@5.8.5: `rawBody`, the only place
  // the limit is consulted, runs solely for `asString`/`asBuffer` parsers — a passthrough parser
  // bypasses it entirely). The ceiling that actually binds is the running byte count inside the
  // hashing transform, against `ctx.cfg.FACILITY_IMPORT_MAX_UPLOAD_BYTES`. Lowered here rather than
  // pushed past 1 GiB, exactly as `workflows-routes.test.ts` does with `WORKFLOW_FILE_MAX_BYTES`.
  //
  // Registers the REAL central error handler, as production does, so the over-cap answer is the
  // app-wide `{error, code, correlationId}` contract rather than a body only this route emits.
  //
  // ⛔ EXPLICIT 8s BUDGET, because the regression here is a HANG rather than a wrong answer. MEASURED
  // by mutating the route back to `Promise.allSettled`: `pipeline`'s promise never settles once the
  // transform errors against a Fastify request stream (`req.body.destroyed` is still false a second
  // later), so the handler never returns and this test times out instead of failing on an assertion.
  // Without a budget it would stall the suite at whatever global timeout is in force.
  it('⛔ 413s an upload over `FACILITY_IMPORT_MAX_UPLOAD_BYTES` and stores no run', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    ctx.cfg.FACILITY_IMPORT_MAX_UPLOAD_BYTES = 2;
    // ⚠ A store that REPLACES the stream's error with its own, as the real adapter does: it wraps
    // `@aws-sdk/lib-storage`'s `Upload`, whose `done()` rejects with an SDK abort error rather than
    // the transform's. Both sides of the transfer therefore fail with DIFFERENT errors, and the one
    // that wins the race would otherwise decide the status code — 413 or 500 at random. This is what
    // pins the route's `throw overCap ?? err`; with `throw err` this test sees a 500.
    const objects = ctx.blob.__objects as Map<string, Buffer>;
    ctx.blob = {
      async putStream(key: string, body: AsyncIterable<Buffer | string>) {
        const chunks: Buffer[] = [];
        try {
          for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        } catch {
          throw new Error('simulated S3 multipart upload aborted');
        }
        objects.set(key, Buffer.concat(chunks));
      },
      async delete(key: string) { objects.delete(key); },
      __objects: objects,
    };
    const app = Fastify({ logger: false });
    registerErrorHandler(app as any);
    app.addHook('onRequest', async (req: any) => { req.user = { id: 'u1', capabilities: ['facilities.view', 'facilities.manage'] }; });
    registerFacilitiesRoutes(app as any, ctx);
    await app.ready();

    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });

    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'SY0413' });
    expect(res.json().error).toContain('2-byte upload limit');
    expect(res.json().correlationId).toBeTruthy();
    // Nothing queued, and the partial object is discarded — an over-cap upload must not leave the
    // register holding `active_key` or an orphan in the bucket.
    expect(await db.selectFrom('facility_import_runs').selectAll().execute()).toHaveLength(0);
    expect(ctx.blob.__objects.size).toBe(0);

    // ⛔ And the ceiling is a CEILING, not a blanket refusal: raise it and the same file goes
    // through. Without this, `return reply.code(413)` unconditionally would pass the assertions above.
    ctx.cfg.FACILITY_IMPORT_MAX_UPLOAD_BYTES = 1_073_741_824;
    const after = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(after.statusCode).toBe(202);
  }, 8000);

  // --- A2b Task 3 review fix (M4): the gate's `!superseded` re-read branch ----------------------
  //
  // The store's CAS is pinned in packages/db, but the ROUTE-level consequence of losing it is new
  // behaviour on the shared `takeOverRegister` path: "the CAS lost AND the holder has since moved
  // TERMINAL (so it released `active_key` on its way) ⇒ the register really is free, proceed" — as
  // opposed to the unconditional 409 this branch used to answer.
  //
  // ⚠ The race is forced, not waited for. `ctx.internalDb` is swapped for a proxy that, immediately
  // after the gate's own `active_key` lookup resolves, applies exactly what a terminal writer applies
  // (status → `applied`, `active_key` → NULL). The route's `importRuns` store was built from the RAW
  // db at registration, so only the gate's SELECT is intercepted — `supersede`'s CAS then runs
  // against the real, already-moved row and matches nothing, which is the branch under test.
  it('⛔ proceeds when the supersede CAS loses to a holder that moved TERMINAL — the register is free', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Alpha,,,,,,,,,,,,,,']);

    const first = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(csv, 'utf8'),
    });
    expect(first.statusCode).toBe(202);
    const firstRunId = first.json().runId;

    // A SUPERSEDABLE holder — otherwise the gate refuses before it ever reaches the CAS.
    await db.updateTable('facility_import_runs').set({ status: 'awaiting_confirmation' })
      .where('id', '=', firstRunId).execute();
    expect((await db.selectFrom('facility_import_runs').select(['status', 'active_key'])
      .where('id', '=', firstRunId).executeTakeFirstOrThrow()))
      .toEqual({ status: 'awaiting_confirmation', active_key: SYSTEM });

    const rawDb = db;
    let raced = false;
    const wrapBuilder = (qb: any): any => new Proxy(qb, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        if (prop === 'executeTakeFirst') {
          return async (...args: any[]) => {
            const out = await value.apply(target, args);
            if (!raced) {
              raced = true;
              // Precisely what `finishApply`/`finish`/`supersede`/`failStaleRunning` all do on their
              // way out: a terminal status AND the key released. Nothing holds the register now.
              await rawDb.updateTable('facility_import_runs')
                .set({ status: 'applied', active_key: null } as never)
                .where('id', '=', firstRunId).execute();
            }
            return out;
          };
        }
        return (...args: any[]) => {
          const next = value.apply(target, args);
          return next && typeof next === 'object' && typeof next.executeTakeFirst === 'function' ? wrapBuilder(next) : next;
        };
      },
    });
    ctx.internalDb = new Proxy(rawDb, {
      get(target, prop, receiver) {
        if (prop !== 'selectFrom') {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        }
        return (table: string) => {
          const qb = target.selectFrom(table);
          return table === 'facility_import_runs' && !raced ? wrapBuilder(qb) : qb;
        };
      },
    });

    const second = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(csv, 'utf8'),
    });

    // The setup fired — without this the test could pass for the ordinary "register was free" reason.
    expect(raced).toBe(true);
    // ⛔ 202, not 409: the holder released the key on its way terminal, so refusing would lock an
    // operator out of a register nobody holds.
    expect(second.statusCode).toBe(202);
    expect(second.json().runId).not.toBe(firstRunId);

    // ⛔ And the CAS genuinely LOST: the decided run was NOT re-finished as 'failed' and carries no
    // supersede reason. If `supersede` had won, `error` would read 'superseded by a newer upload'.
    expect((await db.selectFrom('facility_import_runs').select(['status', 'error', 'active_key'])
      .where('id', '=', firstRunId).executeTakeFirstOrThrow()))
      .toEqual({ status: 'applied', error: null, active_key: null });
    const secondRun = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${second.json().runId}` })).json();
    expect(secondRun.status).toBe('queued');
    expect(secondRun.nationalSystem).toBe(SYSTEM);
  });
});

// --- A2b Task 5: POST /api/facilities/import/runs/:id/confirm ----------------------------------
//
// The operator's decision, and the ONLY writer of `APPLY_PHASE.from` — the state the worker's apply
// phase claims from. Everything here is about what the REQUEST leaves on the run row, since the
// worker that reads it lives in @openldr/bootstrap (its own suite covers the apply itself).

/** Put an uploaded run where the worker's validate phase would have left it: parked for the
 *  operator, with a watermark and a summary. A DIRECT UPDATE, mirroring `completeValidation` —
 *  apps/server does not run the worker, and a route test that did would be testing the worker. */
async function parkForConfirmation(db: any, runId: string, summary: Record<string, unknown>) {
  await db.updateTable('facility_import_runs')
    .set({ status: 'awaiting_confirmation', previewed_at: sql`now()`, summary: JSON.stringify(summary) })
    .where('id', '=', runId).execute();
  // Asserted, so a setup that stopped taking cannot leave a test green for the uninteresting reason
  // that the run was never parked at all.
  expect(await db.selectFrom('facility_import_runs').select(['status', 'active_key'])
    .where('id', '=', runId).executeTakeFirstOrThrow())
    .toEqual({ status: 'awaiting_confirmation', active_key: SYSTEM });
}

/** Upload a register and park its run — the state an operator confirms from. */
async function uploadAndPark(app: any, db: any, summary: Record<string, unknown> = { blocked: false, blockedReason: null }) {
  const res = await app.inject({
    method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv' }),
    headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
  });
  expect(res.statusCode).toBe(202);
  const runId = res.json().runId as string;
  await parkForConfirmation(db, runId, summary);
  return runId;
}

const confirmUrl = (runId: string) => `/api/facilities/import/runs/${runId}/confirm`;

describe('POST /api/facilities/import/runs/:id/confirm', () => {
  it('gated on facilities.manage — a facilities.view-only user gets 403 and the run is untouched', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const manageApp = await appWith(ctx);
    const runId = await uploadAndPark(manageApp, db);

    const viewApp = await appWith(ctx, ['facilities.view']);
    const res = await viewApp.inject({ method: 'POST', url: confirmUrl(runId), payload: {} });

    expect(res.statusCode).toBe(403);
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe('awaiting_confirmation');
  });

  it('confirms a parked run onto the apply queue, merging the operator\'s choices into its options', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const runId = await uploadAndPark(app, db);

    const res = await app.inject({
      method: 'POST', url: confirmUrl(runId),
      payload: {
        onDeleted: 'report', onAbsent: 'retire', onConflict: 'overwrite',
        allowUnknownColumns: true, allowMalformedRows: true, allowInvalidCoordinates: true,
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ runId, status: APPLY_PHASE.from });

    const run = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` })).json();
    // ⛔ `APPLY_PHASE.from`, the state the worker claims — NOT `awaiting_confirmation`, which no
    // worker claims. This transition IS the authorisation: nothing else writes this state.
    expect(run.status).toBe(APPLY_PHASE.from);
    // ⛔ The upload's own `{ nationalSystem }` survives the merge — it is the register identity
    // `active_key` locks on, and losing it would import under a register this run does not own.
    expect(run.options).toEqual({
      nationalSystem: SYSTEM,
      onDeleted: 'report', onAbsent: 'retire', onConflict: 'overwrite',
      allowUnknownColumns: true, allowMalformedRows: true, allowInvalidCoordinates: true,
    });
    // The validate's watermark survives, and the register is still held: the apply has not run yet.
    expect(run.previewedAt).toEqual(expect.any(String));
    expect((await db.selectFrom('facility_import_runs').select('active_key')
      .where('id', '=', runId).executeTakeFirstOrThrow()).active_key).toBe(SYSTEM);
  });

  it('records only the choices the operator actually made — an omitted option is not invented', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const runId = await uploadAndPark(app, db);

    const res = await app.inject({ method: 'POST', url: confirmUrl(runId), payload: { onConflict: 'skip' } });

    expect(res.statusCode).toBe(202);
    const run = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` })).json();
    // ⛔ No `allowMalformedRows: false` etc. A durable record must not carry a decision nobody made —
    // `importFacilities` already defaults every one of these, and `onConflict` defaults to `'skip'`.
    //
    // ⚠ What actually holds this is `ConfirmSchema` keeping every key `.optional()` and never
    // `.default(...)`: MEASURED, zod omits an unsent optional key from its output entirely rather
    // than setting it `undefined` (a filter in the route on `!== undefined` was written on the
    // opposite belief and proved to be dead code — mutating it away changed nothing). Mutating one
    // key to `.optional().default(false)` DOES fail this test, which is the regression it guards.
    expect(run.options).toEqual({ nationalSystem: SYSTEM, onConflict: 'skip' });
  });

  // ── Task 8b: a confirmed run applies with the SAME columnMap it was validated with ─────────────
  //
  // `columnMap` is PARSE-CHANGING — the same family as `allowUnknownColumns`/`allowInvalidCoordinates`
  // below — so it belongs to the UPLOAD, not this route. `ConfirmSchema` has no `columnMap` key at
  // all (see its own doc comment), so a value the operator's client sends here is silently stripped by
  // zod and can never overwrite what the upload already stored — proving the guarantee holds by
  // construction, not by a runtime comparison.

  it('⛔ Task 8b: the map set at upload survives a confirm untouched — ConfirmSchema cannot carry one', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const columnMap = { columns: { 'MFL Code': 'national_code', 'Facility Name': 'name' } };
    const uploadRes = await app.inject({
      method: 'POST',
      url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', columnMap: JSON.stringify(columnMap) }),
      headers: UPLOAD_HEADERS,
      payload: Buffer.from(['MFL Code,Facility Name', '100,Alpha'].join('\n') + '\n', 'utf8'),
    });
    expect(uploadRes.statusCode).toBe(202);
    const runId = uploadRes.json().runId as string;
    await parkForConfirmation(db, runId, { blocked: false, blockedReason: null, unknownColumns: [], invalid: [], parsed: 1 });

    // The client also sends `columnMap` in the confirm body (mirroring the studio wizard's own
    // `confirmOptionsFor`) — it must have NO EFFECT: the map that governs is the one the validate
    // already ran with, never a second copy handed over at confirm time.
    const res = await app.inject({
      method: 'POST', url: confirmUrl(runId),
      payload: { onConflict: 'skip', columnMap: { columns: { 'Facility Name': 'national_code', 'MFL Code': 'name' } } },
    });
    expect(res.statusCode).toBe(202);

    const run = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` })).json();
    // The upload's own map, unchanged — never the different one the confirm body tried to carry.
    expect(run.options).toEqual({ nationalSystem: SYSTEM, columnMap, onConflict: 'skip' });
  });

  // ── Whole-branch review I2: an override that changes how the file PARSES ──────────────────────
  //
  // `allowUnknownColumns`/`allowInvalidCoordinates` reach `parseFacilityCsv` directly, so they decide
  // which rows become records. The summary the operator is confirming was computed by a validate that
  // ran WITHOUT them, and nothing between this route and the apply re-validates or re-shows anything
  // — so accepting one here authorises a write over a record set nobody reviewed.

  it('⛔ refuses a confirm carrying allowUnknownColumns when the validated summary was computed without it', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    // The validate FOUND an unrecognised column — so the override has something to act on, and
    // ticking it now would make the apply parse a file that produced no records at all.
    const runId = await uploadAndPark(app, db, {
      blocked: false, blockedReason: null, unknownColumns: ['mystery_col'], invalid: [],
      parsed: 0, absent: null,
    });

    const res = await app.inject({
      method: 'POST', url: confirmUrl(runId), payload: { allowUnknownColumns: true },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/allowUnknownColumns/);
    // ⛔ And NOTHING was written: a refused confirm must leave the run confirmable, not consume it.
    const row = await db.selectFrom('facility_import_runs').select(['status', 'options', 'active_key'])
      .where('id', '=', runId).executeTakeFirstOrThrow();
    expect(row.status).toBe('awaiting_confirmation');
    expect(row.options).toEqual({ nationalSystem: SYSTEM });
    expect(row.active_key).toBe(SYSTEM);
  });

  it('⛔ THE RETIREMENT CASE: allowUnknownColumns + onAbsent:retire cannot be authorised against a summary that measured absent: null', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    // Exactly what a `completeRelease=true` upload of a file with one unrecognised column validates
    // to: no rows parsed, absence NOT EVALUATED — and it still PARKS, because unknown columns set no
    // `blockedReason`, so the blocked gate lets it through.
    const runId = await uploadAndPark(app, db, {
      blocked: false, blockedReason: null, unknownColumns: ['mystery_col'], invalid: [],
      parsed: 0, absent: null,
    });

    const res = await app.inject({
      method: 'POST', url: confirmUrl(runId),
      payload: { allowUnknownColumns: true, onAbsent: 'retire' },
    });

    expect(res.statusCode).toBe(409);
    // The apply never reaches the queue, so the retirement it would have computed never happens.
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe('awaiting_confirmation');
  });

  it('⛔ …and the same refusal for allowInvalidCoordinates when the file had invalid rows', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const runId = await uploadAndPark(app, db, {
      blocked: false, blockedReason: null, unknownColumns: [],
      invalid: [{ line: 2, message: 'latitude out of range' }],
    });

    const res = await app.inject({
      method: 'POST', url: confirmUrl(runId), payload: { allowInvalidCoordinates: true },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/allowInvalidCoordinates/);
  });

  // ── …and the half of that gate the FORMAT decides ────────────────────────────────────────────
  //
  // ⛔ `allowUnknownColumns` is a documented NO-OP for JSONL — `parseFacilityRelease` never reads
  // `opts.allowUnknownColumns` at all (packages/terminology/src/facility-release.ts), because a
  // self-describing line cannot shift another field the way an unrecognised CSV header can — while
  // it still REPORTS `unknownColumns`. A blind gate therefore refused a JSONL confirm over a flag
  // that provably cannot change the parse, and the 409 then told the operator to re-upload with it.
  //
  // The next two tests are a PAIR over the SAME summary, which is what makes either of them mean
  // anything: change the gate's `run.sourceFormat` term and one of them fails.

  /** Upload a JSONL release carrying an unrecognised field, and park it with `summary`. */
  async function uploadJsonlAndPark(app: any, db: any, summary: Record<string, unknown>) {
    const res = await app.inject({
      method: 'POST', url: uploadUrl({ nationalSystem: SYSTEM, format: 'jsonl' }),
      headers: UPLOAD_HEADERS,
      payload: Buffer.from(jsonl([rowLine('100', 'Alpha', { ward_code: 'W1' })]), 'utf8'),
    });
    expect(res.statusCode).toBe(202);
    const runId = res.json().runId as string;
    // The run really did record the format the gate reads — otherwise this test would pass for the
    // uninteresting reason that the upload stored 'csv' and the summary happened not to be in play.
    expect((await db.selectFrom('facility_import_runs').select('source_format')
      .where('id', '=', runId).executeTakeFirstOrThrow()).source_format).toBe('jsonl');
    await parkForConfirmation(db, runId, summary);
    return runId;
  }

  /** The one summary both halves of the pair are confirmed against. */
  const UNKNOWN_COLUMN_SUMMARY = {
    blocked: false, blockedReason: null, unknownColumns: ['ward_code'], invalid: [], parsed: 1,
  };

  it('⛔ a JSONL run IS confirmable with allowUnknownColumns — that flag cannot change a JSONL parse', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const runId = await uploadJsonlAndPark(app, db, UNKNOWN_COLUMN_SUMMARY);

    const res = await app.inject({
      method: 'POST', url: confirmUrl(runId), payload: { allowUnknownColumns: true },
    });

    expect(res.statusCode).toBe(202);
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe(APPLY_PHASE.from);
  });

  it('⛔ …while the CSV twin of that EXACT summary is still refused — the format is the only difference', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const runId = await uploadAndPark(app, db, UNKNOWN_COLUMN_SUMMARY);

    const res = await app.inject({
      method: 'POST', url: confirmUrl(runId), payload: { allowUnknownColumns: true },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/allowUnknownColumns/);
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe('awaiting_confirmation');
  });

  it('⛔ and the exemption is `allowUnknownColumns` ALONE: a JSONL run still refuses allowInvalidCoordinates', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    // Both parsers honour `allowInvalidCoordinates` — facility-release.ts's `row` branch drops a bad
    // coordinate exactly as facility-csv.ts does — so it changes a JSONL parse and stays in play.
    const runId = await uploadJsonlAndPark(app, db, {
      blocked: false, blockedReason: null, unknownColumns: [],
      invalid: [{ line: 1, field: 'latitude', raw: '999' }], parsed: 0,
    });

    const res = await app.inject({
      method: 'POST', url: confirmUrl(runId), payload: { allowInvalidCoordinates: true },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/allowInvalidCoordinates/);
  });

  it('accepts the same override when the UPLOAD already declared it — the validate ran with it', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    // The upload takes the parse-changing overrides, because it is the request that precedes the
    // classification. This is the path the refusal above points the operator at.
    const up = await app.inject({
      method: 'POST',
      url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', allowUnknownColumns: 'true' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(up.statusCode).toBe(202);
    const runId = up.json().runId as string;
    // ⛔ Recorded on the RUN, which is what makes the worker's validate run with it — a flag the
    // upload accepted and did not store would change nothing at all.
    expect((await db.selectFrom('facility_import_runs').select('options')
      .where('id', '=', runId).executeTakeFirstOrThrow()).options)
      .toEqual({ nationalSystem: SYSTEM, allowUnknownColumns: true });

    await parkForConfirmation(db, runId, {
      blocked: false, blockedReason: null, unknownColumns: ['mystery_col'], invalid: [],
    });
    const res = await app.inject({
      method: 'POST', url: confirmUrl(runId), payload: { allowUnknownColumns: true },
    });

    // The summary under review was computed WITH the override, so confirming with it changes nothing.
    expect(res.statusCode).toBe(202);
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe(APPLY_PHASE.from);
  });

  it('⛔ …and refuses DROPPING an override the validate ran with — narrowing the parse is a change too', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const up = await app.inject({
      method: 'POST',
      url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', allowUnknownColumns: 'true' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    const runId = up.json().runId as string;
    await parkForConfirmation(db, runId, {
      blocked: false, blockedReason: null, unknownColumns: ['mystery_col'], invalid: [],
    });

    const res = await app.inject({
      method: 'POST', url: confirmUrl(runId), payload: { allowUnknownColumns: false },
    });

    expect(res.statusCode).toBe(409);
  });

  it('rejects a non-boolean parse override on the upload rather than silently ignoring it', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({
      method: 'POST',
      url: uploadUrl({ nationalSystem: SYSTEM, format: 'csv', allowInvalidCoordinates: 'yes' }),
      headers: UPLOAD_HEADERS, payload: Buffer.from(facilityCsv(['100,Alpha,,,,,,,,,,,,,,']), 'utf8'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/allowInvalidCoordinates/);
    // Refused before the transfer, so no run was minted and the register is untouched.
    expect(await db.selectFrom('facility_import_runs').select('id').execute()).toEqual([]);
  });

  it('audits the confirm with the operator who made it', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const runId = await uploadAndPark(app, db);
    ctx.__audit.length = 0; // drop the upload's own entry

    await app.inject({ method: 'POST', url: confirmUrl(runId), payload: { onConflict: 'overwrite' } });

    expect(ctx.__audit).toHaveLength(1);
    expect(ctx.__audit[0]).toMatchObject({
      action: 'facility.import.confirmed',
      entityType: 'facility',
      entityId: SYSTEM,
      // ⛔ The confirming actor, recorded HERE because it is the only place it is known: the run row
      // carries `requested_by` (whoever uploaded) and no column for whoever confirmed, and the
      // worker's own `facility.import` entry is written by the system, not by a request.
      actorId: 'u1',
      metadata: { runId, nationalSystem: SYSTEM, options: { nationalSystem: SYSTEM, onConflict: 'overwrite' } },
    });
  });

  it('404s an unknown run id', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({ method: 'POST', url: confirmUrl('fir_does-not-exist'), payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('⛔ 409s a run that is already applied — a confirm must not re-queue a decided run', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const runId = await uploadAndPark(app, db);
    await db.updateTable('facility_import_runs')
      .set({ status: 'applied', active_key: null }).where('id', '=', runId).execute();

    const res = await app.inject({ method: 'POST', url: confirmUrl(runId), payload: {} });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/no longer applicable/i);
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe('applied');
  });

  it('⛔ 409s a SECOND confirm of the same run — one confirm, one apply', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const runId = await uploadAndPark(app, db);

    expect((await app.inject({ method: 'POST', url: confirmUrl(runId), payload: {} })).statusCode).toBe(202);
    const second = await app.inject({ method: 'POST', url: confirmUrl(runId), payload: { onConflict: 'overwrite' } });

    expect(second.statusCode).toBe(409);
    // And the first confirm's options were not overwritten by the refused one.
    const run = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` })).json();
    expect(run.options).toEqual({ nationalSystem: SYSTEM });
  });

  it('⛔ 409s a BLOCKED file — a register with duplicate headers is never applied', async () => {
    // ⛔ READ off the stored summary (`blocked`/`blockedReason`, what `importFacilities` reported at
    // validate), never re-derived. Task 4 pins that a blocked file still PARKS — the operator is
    // entitled to see the reconciliation result — so this route is what must refuse to apply it.
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const runId = await uploadAndPark(app, db, { blocked: true, blockedReason: 'duplicate-columns' });

    const res = await app.inject({ method: 'POST', url: confirmUrl(runId), payload: { allowMalformedRows: true } });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/duplicate-columns/);
    // ⛔ Still parked, NOT queued for apply — and `allowMalformedRows` does not unblock this reason
    // (there is no override for duplicate headers: which of two identically-named columns wins is a
    // guess about master data).
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe('awaiting_confirmation');
  });

  it('⛔ 409s a quarantined-rows file until the operator supplies the override, then confirms it', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const runId = await uploadAndPark(app, db, { blocked: true, blockedReason: 'quarantined-rows' });

    const refused = await app.inject({ method: 'POST', url: confirmUrl(runId), payload: {} });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/allowMalformedRows/);

    // ⛔ The other half, or `return reply.code(409)` unconditionally would pass the assertion above:
    // this reason DOES have an override, and the confirm is what carries it.
    const accepted = await app.inject({ method: 'POST', url: confirmUrl(runId), payload: { allowMalformedRows: true } });
    expect(accepted.statusCode).toBe(202);
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe(APPLY_PHASE.from);
  });

  it('⛔ 409s a run with no stored file — an inline preview cannot be applied by the worker', async () => {
    // `isApplicable` admits `previewed`, the state the INLINE A2a preview mints — and that run has no
    // `blob_key` (it carried its CSV in the request body and never stored it). Confirming one would
    // hand the worker a run it can only fail, while taking the run out of the state the inline apply
    // route needs it in. A different question from the status guard, so it is asked separately.
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Alpha,,,,,,,,,,,,,,']);
    const preview = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
    const runId = preview.json().runId;

    const res = await app.inject({ method: 'POST', url: confirmUrl(runId), payload: {} });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/no stored file/i);
    // Untouched — the inline apply route can still finish this run with its `runId`.
    const run = (await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}` })).json();
    expect(run.status).toBe('previewed');
  });

  it('rejects an unknown option value (400) before touching the run', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const runId = await uploadAndPark(app, db);

    const res = await app.inject({ method: 'POST', url: confirmUrl(runId), payload: { onConflict: 'merge' } });

    expect(res.statusCode).toBe(400);
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe('awaiting_confirmation');
  });
});

const cancelUrl = (runId: string) => `/api/facilities/import/runs/${runId}/cancel`;

// A2b Task 6. The cancel surface, and the whole of it is about NOT overstating what happened.
describe('POST /api/facilities/import/runs/:id/cancel', () => {
  it('gated on facilities.manage — a facilities.view-only user gets 403 and the run is untouched', async () => {
    const db = await importDb();
    const ctx = fakeImportCtx(db);
    const manageApp = await appWith(ctx);
    const runId = await uploadAndPark(manageApp, db);

    const viewApp = await appWith(ctx, ['facilities.view']);
    const res = await viewApp.inject({ method: 'POST', url: cancelUrl(runId), payload: {} });

    expect(res.statusCode).toBe(403);
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe('awaiting_confirmation');
  });

  it('⛔ cancels a PARKED run outright and says so — it is not merely "requested"', async () => {
    // The Task 4/5 carry-forward, closed. No worker claims `awaiting_confirmation`, so a flag set on
    // it would never be read: the operator would be told their import had been asked to stop while
    // the register stayed locked forever behind a run nothing would look at again.
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const runId = await uploadAndPark(app, db);

    const res = await app.inject({ method: 'POST', url: cancelUrl(runId), payload: {} });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ runId, outcome: 'cancelled' });
    const stored = await db.selectFrom('facility_import_runs')
      .select(['status', 'active_key', 'cancel_requested'])
      .where('id', '=', runId).executeTakeFirstOrThrow();
    expect(stored.status).toBe('cancelled');
    // The register is genuinely free — this is what "cancelled" has to mean to be worth saying.
    expect(stored.active_key).toBeNull();
    // The flag path was not taken: nothing is left waiting to be observed by nobody.
    expect(stored.cancel_requested).toBe(false);
  });

  it('⛔ only REQUESTS a cancel on a run a worker is mid-flight on, and does not claim it stopped', async () => {
    // 202 and `requested`, deliberately NOT 200/`cancelled`. The flag cannot interrupt the running
    // transaction, so the run may still finish `applied` — and reporting a cancellation that has not
    // happened is the one thing this surface must never do.
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const runId = await uploadAndPark(app, db);
    await db.updateTable('facility_import_runs').set({ status: 'validating' } as never)
      .where('id', '=', runId).execute();

    const res = await app.inject({ method: 'POST', url: cancelUrl(runId), payload: {} });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ runId, outcome: 'requested' });
    const stored = await db.selectFrom('facility_import_runs')
      .select(['status', 'active_key', 'cancel_requested'])
      .where('id', '=', runId).executeTakeFirstOrThrow();
    // Untouched apart from the flag: the worker owns this run until it observes it.
    expect(stored.status).toBe('validating');
    expect(stored.active_key).toBe(SYSTEM);
    expect(stored.cancel_requested).toBe(true);
  });

  it('409s a run that already finished, rather than reporting a false success', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));
    const runId = await uploadAndPark(app, db);
    await db.updateTable('facility_import_runs')
      .set({ status: 'applied', active_key: null } as never)
      .where('id', '=', runId).execute();

    const res = await app.inject({ method: 'POST', url: cancelUrl(runId), payload: {} });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already/i);
    // ⛔ An applied run STAYS applied. A cancel arriving after the write must never rewrite the
    // record of a register that really was imported.
    expect((await db.selectFrom('facility_import_runs').select('status')
      .where('id', '=', runId).executeTakeFirstOrThrow()).status).toBe('applied');
  });

  it('404s an unknown run', async () => {
    const db = await importDb();
    const app = await appWith(fakeImportCtx(db));

    const res = await app.inject({ method: 'POST', url: cancelUrl('fir_nope'), payload: {} });

    expect(res.statusCode).toBe(404);
  });
});

// --- Task 6: GET /api/facilities/observed, POST /scan-observed, POST /publish -----------------
// Exercises the REAL scanObservedFacilities/resolveObservedFacilities/publishFacilityMap
// (packages/bootstrap/src/facility-reconcile.ts) against REAL migrated internal AND external
// (warehouse) pg-mem dbs — the fake `fakeCtx().facilityRegistry` used above has no `diagnostic_reports`
// table for these to read, and a hand-rolled fake Kysely double for two independent group-by
// aggregates would be more code (and less trustworthy) than the real thing. Mirrors
// `fakeImportCtx`'s "real migrated db, everything else this route doesn't touch stays a minimal
// stub" pattern immediately above, extended with a second (external/warehouse) migrated db and the
// REAL `TerminologyAdminStore` (`createTerminologyAdminStore`) — the concrete store type
// `ReconcileDeps.admin` requires, which the CSV-import fixture above never needed to construct.
//
// `@openldr/db`'s package.json only exported `./testing` (INTERNAL db) before this task; a
// `./testing-external` subpath was added pointing at the pre-existing (but previously unexported)
// `packages/db/src/test-helpers-external.ts`, so this file can build a migrated external db the
// same way `packages/bootstrap/src/test-support/facility-reconcile-fixture.ts` already does for
// bootstrap's own tests, without a second from-scratch reimplementation of the pg-mem
// migration-runner in this file (a deep relative import of that fixture from apps/server is not
// reachable through @openldr/bootstrap's package.json exports map, which only publishes `.`).

function fakeReconcileCtx(internalDb: any, externalDb: any) {
  const audit: any[] = [];
  return {
    internalDb,
    store: { db: externalDb },
    terminology: { admin: createTerminologyAdminStore(internalDb) },
    audit: { record: async (e: any) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    forms: { get: async () => undefined },
    facilityRegistry: {
      list: async () => [],
      get: async () => undefined,
      distinctAdminValues: async () => [],
      upsert: async () => { throw new Error('not used by the observed-facility routes'); },
      remove: async () => {},
    },
    // `impactCtx` (Task 7, below) swaps in the real `facilityRegistry` and reaches DELETE — Task 5's
    // enqueue call there needs a working store, same reasoning as `fakeCreateCtx` above.
    facilityJobs: createFacilityJobStore(internalDb),
    __audit: audit,
  } as any;
}

/** Mirrors `packages/bootstrap/src/test-support/facility-reconcile-fixture.ts`'s `seedPerformers`:
 *  one `diagnostic_reports` row per unit of report count, so the routes' own live
 *  `groupBy(['performer', 'source_system'])` aggregate has real rows to count. */
async function seedObservedReports(
  externalDb: any,
  pairs: [string, number][],
  opts: { performerDisplay?: string | null } = {},
): Promise<void> {
  const rows: { id: string; performer: string; source_system: string; performer_display: string | null }[] = [];
  for (const [performer, count] of pairs) {
    for (let i = 0; i < count; i += 1) {
      rows.push({ id: `dr-${randomUUID()}`, performer, source_system: 'webhook-ingest', performer_display: opts.performerDisplay ?? null });
    }
  }
  if (rows.length === 0) return;
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    await externalDb.insertInto('diagnostic_reports').values(rows.slice(i, i + batchSize)).execute();
  }
}

describe('Task 6: GET /api/facilities/observed', () => {
  it('lists observed facilities ordered by report count desc, with reportCount on each row', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    // Seeded LOWER-count-first (Kibondo, then Dodoma): pg-mem's unordered `group by` happens to
    // come back in roughly insertion order, so seeding highest-count-first would let this test pass
    // even with the route's `.sort()` deleted entirely (proven by a deliberate mutation experiment
    // — see the task report). Seeding the smaller count first means an unsorted result would read
    // ['Kibondo', 'Dodoma'] — the OPPOSITE of what's asserted below — so this only passes because
    // the route actually sorts by reportCount desc.
    await seedObservedReports(externalDb, [['Kibondo', 99], ['Dodoma', 247]]);
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Pinned ordering (Kibondo has fewer reports than Dodoma): fails if the sort is removed or
    // reversed, not just if reportCount happens to be present.
    expect(body.map((r: any) => r.sourceCode)).toEqual(['Dodoma', 'Kibondo']);
    expect(body[0].reportCount).toBe(247);
    expect(body[1].reportCount).toBe(99);
  });

  // `DisaGlobal.dbo.LOCNDIC4` holds five distinct facility codes whose display is all exactly
  // "Aga Khan" — the route must surface that display alongside the code so the operator does not
  // see five identical, opaque codes.
  it('returns the observed display (performer_display) alongside the observed code', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['BAMAA', 1]], { performerDisplay: 'Aga Khan' });
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([expect.objectContaining({ sourceCode: 'BAMAA', sourceDisplay: 'Aga Khan' })]);
  });

  it('reports sourceDisplay as null when the source never supplied one', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['Dodoma', 1]]);
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.json()).toEqual([expect.objectContaining({ sourceCode: 'Dodoma', sourceDisplay: null })]);
  });

  it('needs no prior scan — resolves straight off the warehouse', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['Dodoma', 5]]);
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([expect.objectContaining({ sourceCode: 'Dodoma', reportCount: 5, resolvedVia: null })]);
  });

  // Task 11 (whole-branch review, Fix 2 / triaged Minor M4-4): `relational-writer.ts` documents that
  // the deferred projection wrote NULL `source_system`/`batch_id` into every row for months, so a
  // legacy warehouse row with a NULL `source_system` is expected, not hypothetical.
  // `resolveObservedFacilities` normalises that NULL to `''` (`sourceSystem: o.source_system ?? ''`),
  // but this route used to build its count map with a raw template literal
  // (`` `${c.source_system}|${c.performer}` ``), which stringifies NULL to the literal string
  // `"null"` — a miss against the `''`-keyed resolved row (`` `${r.sourceSystem}|${r.sourceCode}` ``
  // reads `"|Dodoma"` vs the stored `"null|Dodoma"`), landing exactly on the reason this surface
  // exists: impact ordering by report count.
  it('reports the true reportCount for an observed row with a NULL source_system', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const rows = Array.from({ length: 5 }, () => ({ id: `dr-${randomUUID()}`, performer: 'Dodoma', source_system: null }));
    await externalDb.insertInto('diagnostic_reports').values(rows as any).execute();
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([expect.objectContaining({ sourceCode: 'Dodoma', reportCount: 5 })]);
  });

  // Review finding: `resolveObservedFacilities` used to return one row per raw SQL group, grouped by
  // all of (performer, performer_display, performer_system, source_system) — so a performer whose
  // display changed mid-rollout (the renamed-facility case) produced TWO resolved rows for the same
  // code, and each duplicate received the SAME full `reportCount` from this route's 2-column
  // (performer, source_system) count map, doubling what the operator sees. Fixed upstream in
  // `resolveObservedFacilities` (folds to one row per (system, code) before this route ever sees it);
  // pinned here at the route boundary since that is the observable surface the finding named.
  it('reports ONE row with the combined reportCount for a performer whose display changed mid-rollout, not a duplicated row', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['BAMAA', 3]], { performerDisplay: 'Aga Khan (old)' });
    await seedObservedReports(externalDb, [['BAMAA', 5]], { performerDisplay: 'Aga Khan (new)' });
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(200);
    const rows = res.json().filter((r: any) => r.sourceCode === 'BAMAA');
    expect(rows).toHaveLength(1);
    expect(rows[0].reportCount).toBe(8);
  });

  // Task 11 (whole-branch review round 2, Fix 1): this route USED to compute its own
  // `diagnostic_reports` count query, grouped by `(performer, source_system)` — 2 columns, omitting
  // `performer_system` — and join it back onto the resolved rows by `${sourceSystem}|${sourceCode}`.
  // `resolveObservedFacilities` folds by (resolved system, code), where the resolved system prefers
  // the wire's `performer_system` over a `source_system`-derived default — so two feeds sharing the
  // SAME wire `performer_system` but differing `source_system` fold into ONE `ResolvedFacility`
  // carrying only the WINNING representative's `sourceSystem`. The route's own count query, still
  // split by the LOSING feed's raw `source_system`, could never fully match that folded row, silently
  // dropping one feed's contribution. Fixed by reading `reportCount` straight off the already-folded
  // `ResolvedFacility` (which sums both feeds) instead of re-deriving a second, differently-keyed count.
  it('reports the SUMMED reportCount for two feeds sharing a wire performer_system but differing source_system', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const wireSystem = 'urn:openldr:cdr:LOCNDIC4';
    const rowsA = Array.from({ length: 3 }, () => ({
      id: `dr-${randomUUID()}`, performer: 'NHL-01', source_system: 'feed-a', performer_system: wireSystem,
    }));
    const rowsB = Array.from({ length: 5 }, () => ({
      id: `dr-${randomUUID()}`, performer: 'NHL-01', source_system: 'feed-b', performer_system: wireSystem,
    }));
    await externalDb.insertInto('diagnostic_reports').values([...rowsA, ...rowsB] as any).execute();
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(200);
    const rows = res.json().filter((r: any) => r.sourceCode === 'NHL-01');
    expect(rows).toHaveLength(1);
    expect(rows[0].reportCount).toBe(8); // 3 + 5, not just the winning feed's count
  });

  it('is gated on facilities.view', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb), []);
    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(403);
  });

  // ⛔ THE bug report, end to end: an operator mapped BALAB to ITSELF (target system =
  // urn:openldr:default_fac, same code) via TermMappingDialog. The old classification treated
  // "anything that is not the registry system" as automatically a national-register route, so this
  // self-mapping was looked up in `byNational`, found nothing, and reported `targetMissing` — a
  // lie, since nothing was ever missing. Fix 1's `nonFacilityTarget` is the honest state.
  it('reports a self-mapping as nonFacilityTarget, not targetMissing (the reported bug)', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['BALAB', 6]]);
    await internalDb.insertInto('term_mappings').values({
      id: `tm-${randomUUID()}`,
      from_system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      from_code: 'BALAB',
      to_system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      to_code: 'BALAB',
      to_display: null,
      // ⛔ 'SAME-AS', not the 'equivalent' this fixture used to write. `map_type` is a free-text
      // NOT NULL column with no CHECK, so 'equivalent' inserted fine — but it is a FHIR ConceptMap
      // `equivalence` value, not one of the five `MapType`s `TermMappingDialog` can produce, and
      // this test's whole premise is a mapping an operator authored through that dialog. Task 10
      // made `resolveObservedFacilities` resolve only through `SAME-AS`, so the unrealistic value
      // silently stopped exercising the self-mapping path this test exists to pin.
      map_type: 'SAME-AS',
      relationship: null,
      owner: null,
      is_active: true,
    }).execute();
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(200);
    const row = res.json().find((r: any) => r.sourceCode === 'BALAB');
    expect(row.targetMissing).toBe(false);
    expect(row.nonFacilityTarget).toBe(true);
    expect(row.resolvedVia).toBeNull();
  });

  // Task 10, end to end: two competing ACTIVE SAME-AS mappings resolve to NOTHING and the row is
  // reported `ambiguous`. Worth a route-level test on top of the bootstrap one because this route
  // is what the Observed tab actually branches on — the field has to survive the route's sort and
  // JSON serialisation, not merely exist on `ResolvedFacility`.
  it('reports two competing SAME-AS mappings as ambiguous, resolving neither', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['BALAB', 6]]);
    await createFacilityRegistryStore(internalDb).upsert({ id: 'fac-A', name: 'Alpha', localCode: 'L-1', source: 'manual' });
    await createFacilityRegistryStore(internalDb).upsert({ id: 'fac-B', name: 'Beta', localCode: 'L-2', source: 'manual' });
    // ⛔ Migration 078 added a partial unique index that makes this state UNREACHABLE through the
    // database, which is the point of it — so the index has to come off before the state can be
    // constructed at all. The resolver's `ambiguous` verdict is still worth pinning as defence in
    // depth: an install restored from a dump older than 078, or any future writer that bypasses the
    // index, must still resolve to nothing rather than confidently pick one of the two.
    await sql`drop index term_mappings_one_active_facility_resolution`.execute(internalDb);
    for (const toCode of ['L-1', 'L-2']) {
      await internalDb.insertInto('term_mappings').values({
        id: `tm-${randomUUID()}`,
        from_system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
        from_code: 'BALAB',
        to_system: FACILITY_REGISTRY_SYSTEM,
        to_code: toCode,
        to_display: null,
        map_type: 'SAME-AS',
        relationship: null,
        owner: null,
        is_active: true,
      }).execute();
    }
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(200);
    const row = res.json().find((r: any) => r.sourceCode === 'BALAB');
    expect(row.ambiguous).toBe(true);
    expect(row.registryId).toBeNull();
    expect(row.resolvedVia).toBeNull();
    expect(row.targetMissing).toBe(false);
    expect(row.nonFacilityTarget).toBe(false);
  });

  // ⚠ Route-ordering regression guard: `/api/facilities/:id` is ALSO gated on `facilities.view` and
  // ALSO returns a 4xx for an id it can't find, so a `facilities.view`-only caller getting SOME 4xx
  // out of `/api/facilities/observed` is not, by itself, proof this route (rather than the `:id`
  // fallback reading "observed" as an id) was reached — the test above would pass either way. This
  // one distinguishes them: only the REAL route returns 200 with an array body; the `:id` fallback
  // (were `/observed` registered after it) would 404 with `{ error: 'not found' }` instead, since
  // `fakeReconcileCtx`'s `facilityRegistry.get` always resolves to `undefined`.
  it('⚠ a facilities.view-only caller reaches the real route, not the /:id fallback reading "observed" as an id', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb), ['facilities.view']);
    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe('Task 6: POST /api/facilities/scan-observed', () => {
  it('refuses the scan without facilities.manage', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb), ['facilities.view']);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/scan-observed', payload: { apply: true } });
    expect(res.statusCode).toBe(403);
  });

  it('dry-runs the scan by default: reports counts but writes NOTHING and does not audit', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['Dodoma', 3]]);
    const ctx = fakeReconcileCtx(internalDb, externalDb);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities/scan-observed', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBeGreaterThan(0);
    // Proof of "nothing written", not just "counts came back": no `Dodoma` concept lands under the
    // observed-facility system (the migrated internal db seeds its OWN unrelated terminology, e.g.
    // default organisms/parameters — an unscoped `selectAll` count would be nonzero regardless of
    // this route, so the assertion is scoped to the system this scan would have written to) and the
    // observed-facility coding_systems row was never registered.
    expect(
      await internalDb.selectFrom('terminology_concepts').where('system', '=', 'urn:openldr:default_fac').selectAll().execute(),
    ).toHaveLength(0);
    expect(await internalDb.selectFrom('coding_systems').where('url', '=', 'urn:openldr:default_fac').selectAll().execute()).toHaveLength(0);
    expect(ctx.__audit).toHaveLength(0);
  });

  it('apply: true writes concepts and audits facility.scan (never on the dry run above)', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['Dodoma', 3]]);
    const ctx = fakeReconcileCtx(internalDb, externalDb);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities/scan-observed', payload: { apply: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ discovered: 1, created: 1, systemRegistered: true });
    expect(await internalDb.selectFrom('terminology_concepts').where('code', '=', 'Dodoma').selectAll().execute()).toHaveLength(1);
    expect(ctx.__audit.map((a: any) => a.action)).toEqual(['facility.scan']);
  });

  // ⛔ PINS THE ONE ROUTE BY WHICH A MASS MAPPING REWRITE BECOMES VISIBLE TO AN OPERATOR. A scan
  // republishes the registry projection, and that reprojection can move a facility's concept code and
  // rewrite every `term_mappings` row pointing at the old one — underneath whoever authored them,
  // with no UI anywhere reporting it. `ScanResult.registryCodeChanges` counts those moves and this
  // audit entry is where they are kept; before it, the only trace was a `console.warn`.
  //
  // Both entries are asserted, not just the second: a field that is ALWAYS whatever the last scan
  // happened to produce would satisfy a single-value check, and "0 when nothing moved" is what makes
  // the 1 mean something.
  it('records how many registry codes the scan moved in the facility.scan audit entry', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['Dodoma', 1]]);
    const ctx = fakeReconcileCtx(internalDb, externalDb);
    const app = await appWith(ctx);
    await internalDb.insertInto('facility_registry')
      .values({ id: 'fac-1', name: 'Alpha Clinic', local_code: 'OLD-1', source: 'manual' }).execute();

    // First scan projects fac-1 as 'OLD-1' and records the link it will later be compared against.
    await app.inject({ method: 'POST', url: '/api/facilities/scan-observed', payload: { apply: true } });
    // The code changes without this route being involved — a national import, an out-of-band
    // correction. Exactly the case where nobody would otherwise know their mappings just moved.
    await internalDb.updateTable('facility_registry').set({ local_code: 'NEW-1' }).where('id', '=', 'fac-1').execute();

    const res = await app.inject({ method: 'POST', url: '/api/facilities/scan-observed', payload: { apply: true } });

    expect(res.statusCode).toBe(200);
    expect(res.json().registryCodeChanges).toBe(1);
    const scans = ctx.__audit.filter((a: any) => a.action === 'facility.scan');
    expect(scans.map((a: any) => a.metadata.result.registryCodeChanges)).toEqual([0, 1]);
  });

  // Task 9b: `system` (a caller-chosen destination) is gone from this route's body — scan now
  // derives a coding system PER ROW from `source_system`, so an unknown field like `system` is
  // simply stripped by zod rather than meaning anything. This is the direct replacement for the
  // pre-Task-9b "rejects a blank system" test, which pinned a validation rule on a field this route
  // no longer has.
  it('scans every feed at once — a second, non-default feed resolves through its OWN system', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const rows = [
      { id: `dr-${randomUUID()}`, performer: 'NHL-01', source_system: 'feed-a' },
      { id: `dr-${randomUUID()}`, performer: 'NHL-01', source_system: 'feed-b' },
    ];
    await externalDb.insertInto('diagnostic_reports').values(rows).execute();
    const ctx = fakeReconcileCtx(internalDb, externalDb);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities/scan-observed', payload: { apply: true } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ discovered: 2, created: 2, systemRegistered: true });
    expect(
      await internalDb.selectFrom('coding_systems').where('url', '=', 'urn:openldr:fac_feed_a').selectAll().execute(),
    ).toHaveLength(1);
    expect(
      await internalDb.selectFrom('coding_systems').where('url', '=', 'urn:openldr:fac_feed_b').selectAll().execute(),
    ).toHaveLength(1);
  });
});

describe('Task 6: POST /api/facilities/publish', () => {
  it('refuses publish without facilities.manage', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb), ['facilities.view']);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/publish', payload: { apply: true } });
    expect(res.statusCode).toBe(403);
  });

  it('dry-runs by default: reports the summary but writes NOTHING to facility_map and does not audit', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['Dodoma', 3]]);
    const ctx = fakeReconcileCtx(internalDb, externalDb);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities/publish', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ written: 1, resolved: 0, unmapped: 1, targetMissing: 0 });
    expect(await externalDb.selectFrom('facility_map').selectAll().execute()).toHaveLength(0);
    expect(ctx.__audit).toHaveLength(0);
  });

  it('apply: true rebuilds facility_map and audits facility.publish (never on the dry run above)', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['Dodoma', 3]]);
    const ctx = fakeReconcileCtx(internalDb, externalDb);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities/publish', payload: { apply: true } });
    expect(res.statusCode).toBe(200);
    const rows = await externalDb.selectFrom('facility_map').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].source_code).toBe('Dodoma');
    expect(ctx.__audit.map((a: any) => a.action)).toEqual(['facility.publish']);
  });

  it('a second apply REPLACES facility_map rather than appending (delete-then-insert)', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['Dodoma', 1]]);
    const ctx = fakeReconcileCtx(internalDb, externalDb);
    const app = await appWith(ctx);

    await app.inject({ method: 'POST', url: '/api/facilities/publish', payload: { apply: true } });
    await app.inject({ method: 'POST', url: '/api/facilities/publish', payload: { apply: true } });
    expect(await externalDb.selectFrom('facility_map').selectAll().execute()).toHaveLength(1);
  });
});

// --- GET /api/facilities/:id/impact ---------------------------------------------------------------
// Reuses Task 6's harness (`fakeReconcileCtx`, `seedObservedReports`) rather than inventing a second
// one — the only addition is swapping in the REAL `createFacilityRegistryStore` for
// `ctx.facilityRegistry`, so `GET .../impact` and `DELETE .../:id` exercise the real store's
// `get`/`remove` against a real migrated `facility_registry` table (`fakeReconcileCtx`'s own
// `facilityRegistry` stub always resolves `get` to `undefined`, which is fine for the observed/scan/
// publish routes above — none of them touch it — but this task's route reads `nationalSystem`/
// `nationalCode` off it directly).

function impactCtx(internalDb: any, externalDb: any) {
  const ctx = fakeReconcileCtx(internalDb, externalDb);
  ctx.facilityRegistry = createFacilityRegistryStore(internalDb);
  return ctx;
}

/** Insert one `term_mappings` row directly — mirrors this file's existing pattern of hitting the
 *  migrated db directly for setup the store interfaces don't expose (see e.g. `seedObservedReports`
 *  above). Defaults to the registry-route mapping the main tests below need; callers override
 *  whichever columns make theirs a national-route (or otherwise distinct) mapping. */
async function seedMapping(internalDb: any, overrides: Record<string, unknown> = {}): Promise<void> {
  await internalDb.insertInto('term_mappings').values({
    id: `tm-${randomUUID()}`,
    from_system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
    from_code: 'Dodoma',
    to_system: FACILITY_REGISTRY_SYSTEM,
    to_code: 'fac-1',
    to_display: 'Dodoma Regional Referral',
    // 'SAME-AS' — the only semantic Task 10's resolver treats as a facility equivalence. See the
    // note on the self-mapping fixture above for why 'equivalent' was wrong here even before that.
    map_type: 'SAME-AS',
    relationship: null,
    owner: null,
    is_active: true,
    ...overrides,
  }).execute();
}

describe('GET /api/facilities/:id/impact', () => {
  it('reports how many observed codes and reports a facility affects', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const ctx = impactCtx(internalDb, externalDb);
    await ctx.facilityRegistry.upsert({ id: 'fac-1', name: 'Dodoma Regional Referral', localCode: 'LAB01', source: 'manual' });
    await seedMapping(internalDb);
    await seedObservedReports(externalDb, [['Dodoma', 247]]);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/impact' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mappingCount: 1, reportCount: 247 });
  });

  it('leaves the mapping in place when the facility is deleted', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const ctx = impactCtx(internalDb, externalDb);
    await ctx.facilityRegistry.upsert({ id: 'fac-1', name: 'Dodoma Regional Referral', localCode: 'LAB01', source: 'manual' });
    await seedMapping(internalDb);
    await seedObservedReports(externalDb, [['Dodoma', 247]]);
    const app = await appWith(ctx);

    const del = await app.inject({ method: 'DELETE', url: '/api/facilities/fac-1' });
    expect(del.statusCode).toBe(200);

    // The mapping row itself is untouched by the delete — proof beyond the 200 status code.
    const survivingMappings = await internalDb.selectFrom('term_mappings').selectAll().where('to_code', '=', 'fac-1').execute();
    expect(survivingMappings).toHaveLength(1);

    const observed = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    const row = observed.json().find((r: { sourceCode: string }) => r.sourceCode === 'Dodoma');
    expect(row.targetMissing).toBe(true);
    expect(row.name).toBeNull();
  });

  it('counts both the registry-route and the national-route mapping, summing report counts across both', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const ctx = impactCtx(internalDb, externalDb);
    await ctx.facilityRegistry.upsert({
      id: 'fac-1', name: 'Dodoma Regional Referral', localCode: 'LAB01',
      nationalSystem: 'urn:tz:hfr', nationalCode: '100', source: 'manual',
    });
    await seedMapping(internalDb);
    await seedMapping(internalDb, { from_code: 'DDM', to_system: 'urn:tz:hfr', to_code: '100' });
    await seedObservedReports(externalDb, [['Dodoma', 100], ['DDM', 50]]);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/impact' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mappingCount: 2, reportCount: 150 });
  });

  // A deactivated mapping still shows up as `targetMissing` on the observed list (Task 4's
  // `resolveObservedFacilities` filters on `is_active = true` — see
  // packages/bootstrap/src/facility-reconcile.ts:222-223) and a delete does not touch it either way,
  // so it contributes NOTHING to the impact preview. Assert exact zeros, not merely "fewer than an
  // active mapping would report" — a partial fix (e.g. filtering only one of the two queries, or a
  // typo'd column) could still leave a nonzero count here.
  it('ignores a deactivated mapping entirely: mappingCount and reportCount are both exactly 0', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const ctx = impactCtx(internalDb, externalDb);
    await ctx.facilityRegistry.upsert({ id: 'fac-1', name: 'Dodoma Regional Referral', localCode: 'LAB01', source: 'manual' });
    await seedMapping(internalDb, { is_active: false });
    await seedObservedReports(externalDb, [['Dodoma', 247]]);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/impact' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mappingCount: 0, reportCount: 0 });
  });

  // Proves the filter is actually APPLIED (as opposed to, say, the whole query being broken and
  // returning nothing regardless of `is_active`): one active + one inactive mapping for the same
  // facility/observed-code pair must count exactly the active one.
  it('counts only the active mapping when one active and one inactive mapping both target the facility', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const ctx = impactCtx(internalDb, externalDb);
    await ctx.facilityRegistry.upsert({ id: 'fac-1', name: 'Dodoma Regional Referral', localCode: 'LAB01', source: 'manual' });
    await seedMapping(internalDb, { from_code: 'Dodoma', is_active: true });
    await seedMapping(internalDb, { from_code: 'DDM-OLD', is_active: false });
    await seedObservedReports(externalDb, [['Dodoma', 247], ['DDM-OLD', 999]]);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/impact' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mappingCount: 1, reportCount: 247 });
  });

  // A facility with no national code has NO national-route mappings, by construction — proven here
  // against the specific bug the brief calls out: a mapping row that happens to carry an
  // empty-string `to_system`/`to_code` (a plausible pathological row, since `to_code` is only
  // NOT NULL, not "non-blank") must never be picked up just because a naive implementation coerced
  // the facility's absent `nationalCode` to `''` (e.g. `facility.nationalCode ?? ''`) instead of
  // skipping the national-route query outright. A route built that way would wrongly report
  // mappingCount: 1 / reportCount: 500 here; the guarded route reports zero.
  it('a facility with no national code never matches an empty-string national mapping (NULL/blank-safety)', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const ctx = impactCtx(internalDb, externalDb);
    await ctx.facilityRegistry.upsert({ id: 'fac-1', name: 'Dodoma Regional Referral', localCode: 'LAB01', source: 'manual' });
    await seedMapping(internalDb, { from_code: 'Rogue', to_system: '', to_code: '', to_display: null });
    await seedObservedReports(externalDb, [['Rogue', 500]]);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/impact' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mappingCount: 0, reportCount: 0 });
  });

  it('404s on an unknown id', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const app = await appWith(impactCtx(internalDb, externalDb));
    const res = await app.inject({ method: 'GET', url: '/api/facilities/nope/impact' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('is gated on facilities.view — a user without it gets 403', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const app = await appWith(impactCtx(internalDb, externalDb), []);
    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/impact' });
    expect(res.statusCode).toBe(403);
  });

  it('a user with only facilities.view (no facilities.manage) CAN read the impact counts', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const ctx = impactCtx(internalDb, externalDb);
    await ctx.facilityRegistry.upsert({ id: 'fac-1', name: 'Dodoma Regional Referral', localCode: 'LAB01', source: 'manual' });
    const app = await appWith(ctx, ['facilities.view']);
    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/impact' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mappingCount: 0, reportCount: 0 });
  });

  // --- Route-ordering verification (this task's own ambiguity to resolve, not inherited from Task 6):
  // `/api/facilities/:id/impact` has a DIFFERENT segment count from `/api/facilities/:id`
  // (`/api/facilities/observed` in Task 6 had the SAME segment count as `/api/facilities/:id`, which
  // is why THAT route needed to be registered first). A same-segment-count collision is not possible
  // here regardless of registration order, but rather than trust that, this proves both routes are
  // independently reachable — including the adversarial case of a facility whose id is literally the
  // string "impact", which a shadowing bug would most plausibly misroute.

  it('⚠ a facility literally named "impact" is still reachable via GET /api/facilities/:id, not swallowed by the /impact suffix route', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const ctx = impactCtx(internalDb, externalDb);
    await ctx.facilityRegistry.upsert({ id: 'impact', name: 'A Facility Named Impact', localCode: 'IMP01', source: 'manual' });
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/impact' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'impact', name: 'A Facility Named Impact' });
  });

  it('⚠ GET /api/facilities/:id/impact returns the impact shape, not the plain facility record', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const ctx = impactCtx(internalDb, externalDb);
    await ctx.facilityRegistry.upsert({ id: 'fac-1', name: 'Dodoma Regional Referral', localCode: 'LAB01', source: 'manual' });
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/impact' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ mappingCount: 0, reportCount: 0 });
    // The plain facility record carries `name`/`localCode` — proof this is the impact route's own
    // response shape, not the `:id` route's record leaking through.
    expect(body.name).toBeUndefined();
    expect(body.localCode).toBeUndefined();
  });
});

// ── Task 8 (B1, facility-canonical-identity): GET /api/facilities/:id/history ───────────────────
//
// A read model only, over `audit_events` rows POST/PUT (facility.create/facility.update) and
// Task 7's per-row import audit (facility.import.row) already write — no new table, no second
// capture path, nothing seeded here that the route itself doesn't also read.

/** Inserts `audit_events` rows directly (no store interface exposes writing an arbitrary
 *  `occurred_at`/`id`, and this describe block needs both under its own control).
 *
 *  ⚠ Every row in one call shares the SAME literal `occurred_at` — never `new Date()` per row.
 *  pg-mem's `now()` is real millisecond wall-clock and collides on roughly half of consecutive
 *  calls (measured this slice), so relying on distinct auto-timestamps would make the ordering
 *  test pass or fail by luck. Forcing an exact collision means the only way "newest first" can
 *  come back right is the route's `id desc` tiebreaker actually running.
 *
 *  `id`s are ORDERED strings the caller chooses (`evt-1`, `evt-2`, ...), not `randomUUID()` — a
 *  random id would make "which id sorts last" a coin flip, exactly the trap this slice's brief
 *  warns about. */
async function seedFacilityHistory(
  internalDb: any,
  entries: { id: string; action: string; entityId: string; before: unknown; after: unknown }[],
): Promise<void> {
  const occurredAt = new Date('2026-01-01T00:00:00.000Z');
  for (const e of entries) {
    await internalDb.insertInto('audit_events').values({
      id: e.id,
      occurred_at: occurredAt,
      actor_type: 'user',
      actor_id: 'u1',
      actor_name: 'Alice',
      action: e.action,
      entity_type: 'facility',
      entity_id: e.entityId,
      before: (e.before ?? null) as never,
      after: (e.after ?? null) as never,
      metadata: null as never,
    }).execute();
  }
}

describe('Task 8: GET /api/facilities/:id/history', () => {
  it('returns a facility\'s create/update events, newest first', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeReconcileCtx(internalDb, null);
    // 'evt-2' must win the tiebreak over 'evt-1' — see seedFacilityHistory's doc comment on why
    // both rows sharing one `occurred_at` makes that the ONLY thing `id desc` can be proven by.
    await seedFacilityHistory(internalDb, [
      { id: 'evt-1', action: 'facility.create', entityId: 'fac-1', before: null, after: { id: 'fac-1', name: 'Dodoma RRH' } },
      { id: 'evt-2', action: 'facility.update', entityId: 'fac-1', before: { name: 'Dodoma RRH' }, after: { name: 'Dodoma Regional Referral' } },
    ]);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/history' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      rows: [
        {
          occurredAt: '2026-01-01T00:00:00.000Z', actorName: 'Alice', action: 'facility.update',
          before: { name: 'Dodoma RRH' }, after: { name: 'Dodoma Regional Referral' },
        },
        {
          occurredAt: '2026-01-01T00:00:00.000Z', actorName: 'Alice', action: 'facility.create',
          before: null, after: { id: 'fac-1', name: 'Dodoma RRH' },
        },
      ],
    });
  });

  it('excludes other facilities\' events', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = fakeReconcileCtx(internalDb, null);
    await seedFacilityHistory(internalDb, [
      { id: 'evt-1', action: 'facility.create', entityId: 'fac-1', before: null, after: { id: 'fac-1' } },
      { id: 'evt-2', action: 'facility.create', entityId: 'fac-2', before: null, after: { id: 'fac-2' } },
    ]);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/history' });

    expect(res.statusCode).toBe(200);
    const { rows } = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toEqual({ id: 'fac-1' });
  });

  it('is gated on facilities.view — a user without it gets 403', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(fakeReconcileCtx(internalDb, null), []);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/fac-1/history' });

    expect(res.statusCode).toBe(403);
  });

  // The reason, not just the rule: a deleted facility's history is still meaningful — it is how an
  // operator finds out a facility once existed and what happened to it — so an id `facilityRegistry`
  // no longer (or never did) resolve must not 404 here, unlike GET /api/facilities/:id itself.
  it('returns an empty array, not 404, for an unknown facility id', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(fakeReconcileCtx(internalDb, null));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/does-not-exist/history' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rows: [] });
  });
});

// ── Task 13: GET /api/facilities/mapping-conflicts ──────────────────────────────────────────────
//
// `facility_mapping_conflicts` is written once, by migration 078, when it closed "one active
// SAME-AS resolution per observed facility key" at the database and had to clear the pre-existing
// violations standing in the index's way. Until this route it had NO reader at all: for the
// 'duplicate' kind the migration DEACTIVATED an operator's competing mappings and left the only
// record of having done so in a table nothing could show them. ('unsupported_map_type' rows were
// recorded but never deactivated — they do not violate the index; the record only explains why the
// resolver already refuses them.)
//
// `store.db` is `null` in these tests, deliberately: this route reads `ctx.internalDb` only — it
// never builds `reconcileDeps` and never touches the warehouse — so constructing a migrated
// external db here would be several seconds per test buying nothing. A regression that made the
// route reach for the external handle would throw rather than pass quietly.
function conflictsCtx(internalDb: any) {
  return fakeReconcileCtx(internalDb, null);
}

/** Insert one `facility_mapping_conflicts` row directly, the same way `seedMapping` above hits the
 *  migrated db for setup no store interface exposes. Defaults to the 'duplicate' kind (competing
 *  DISTINCT targets — see migration 078's docblock for why that name is acknowledged as poor). */
async function seedConflict(internalDb: any, overrides: Record<string, unknown> = {}): Promise<void> {
  await internalDb.insertInto('facility_mapping_conflicts').values({
    from_system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
    from_code: 'BALAB',
    kind: 'duplicate',
    mapping_ids: JSON.stringify(['tm-1', 'tm-2']),
    detail: JSON.stringify([{ id: 'tm-1', toCode: 'fac-A' }, { id: 'tm-2', toCode: 'fac-B' }]),
    ...overrides,
  }).execute();
}

describe('Task 13: GET /api/facilities/mapping-conflicts', () => {
  it('lists unresolved mapping conflicts for review, in camelCase', async () => {
    const internalDb = await makeMigratedDb();
    await seedConflict(internalDb);
    const app = await appWith(conflictsCtx(internalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/mapping-conflicts' });

    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM,
      fromCode: 'BALAB',
      kind: 'duplicate',
      mappingIds: ['tm-1', 'tm-2'],
    });
    // `detail` is what tells the operator WHICH facilities were competing — the whole reason a
    // 'duplicate' row is actionable rather than just alarming. Dropping it would leave them a
    // conflict with no way to see what to choose between.
    expect(rows[0].detail).toEqual([{ id: 'tm-1', toCode: 'fac-A' }, { id: 'tm-2', toCode: 'fac-B' }]);
  });

  it('carries the unsupported_map_type kind through too, not just duplicates', async () => {
    const internalDb = await makeMigratedDb();
    await seedConflict(internalDb, {
      from_code: 'X-RAY',
      kind: 'unsupported_map_type',
      mapping_ids: JSON.stringify(['tm-9']),
      detail: JSON.stringify({ mapType: 'RELATED-TO', toCode: 'fac-A' }),
    });
    const app = await appWith(conflictsCtx(internalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/mapping-conflicts' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject([{ fromCode: 'X-RAY', kind: 'unsupported_map_type', mappingIds: ['tm-9'] }]);
  });

  // The listing exists to be a QUEUE — a settled conflict must leave it, or an operator can never
  // tell what still needs them. `resolved_at` is the only signal of that (078 writes it NULL for
  // every row it records).
  it('excludes a settled conflict (resolved_at set)', async () => {
    const internalDb = await makeMigratedDb();
    await seedConflict(internalDb, { from_code: 'SETTLED', resolved_at: new Date() });
    await seedConflict(internalDb, { from_code: 'STILL-OPEN' });
    const app = await appWith(conflictsCtx(internalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/mapping-conflicts' });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((r: any) => r.fromCode)).toEqual(['STILL-OPEN']);
  });

  it('returns an empty list on a clean install (no conflicts recorded)', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(conflictsCtx(internalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/mapping-conflicts' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  // Gated on facilities.manage, not facilities.view: the queue names an operator's own mappings and
  // exists only to drive a WRITE (settle the conflict by removing one of them).
  it('is gated on facilities.manage — facilities.view alone gets 403', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(conflictsCtx(internalDb), ['facilities.view']);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/mapping-conflicts' });

    expect(res.statusCode).toBe(403);
  });

  // ⛔ This test does NOT pin registration order, and must not be described as if it did. Measured:
  // moving the route's registration below `/api/facilities/:id` leaves this test — and every other
  // one in this block — green, because Fastify's router (find-my-way) always prefers a STATIC
  // segment over a parametric one regardless of the order the two were registered in.
  //
  // What it DOES pin is the resulting behaviour, with the shadowing case made as tempting as
  // possible: a real facility whose id IS the literal string still does not divert this URL to the
  // `:id` handler. The trade-off, recorded rather than pretended away — that facility is then
  // unreachable through `GET /api/facilities/:id`. Harmless: `facility_registry.id` is either a
  // generated UUID (POST) or a sha256-derived hex digest (CSV import), so no real row carries it.
  it('⚠ resolves to the conflicts list, not the :id route, even with a facility of that literal id', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const ctx = impactCtx(internalDb, externalDb); // needs a REAL facilityRegistry for the :id lookup
    await ctx.facilityRegistry.upsert({ id: 'mapping-conflicts', name: 'Oddly Named', localCode: 'ODD01', source: 'manual' });
    await seedConflict(internalDb);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/mapping-conflicts' });

    expect(res.statusCode).toBe(200);
    // The conflicts list, NOT the facility record — a shadowed route would return `{ id, name }`.
    expect(res.json()).toMatchObject([{ fromCode: 'BALAB', kind: 'duplicate' }]);
  });
});

// ── Task 10: GET /api/facilities/health and POST /api/facilities/jobs/:id/retry ────────────────
//
// Exposes Task 9's `facilityHealth` (packages/bootstrap/src/facility-health.ts) and a manual retry
// for a failed facility job — until now `ctx.facilityJobs` had no HTTP surface at all, so an
// operator could not see whether the report-facing dimension had caught up with a mapping change,
// nor retry a failed rebuild without shell access to the database.
//
// `jobsCtx` reuses `fakeReconcileCtx` (same as `conflictsCtx` above) so `ctx.facilityJobs` is a REAL
// `createFacilityJobStore(internalDb)` against a real migrated db — a hand-rolled in-memory double
// would make enqueue/claim/finish/retry silent no-ops and prove nothing (see this file's other
// describe blocks for the same reasoning).
function jobsCtx(internalDb: any) {
  return fakeReconcileCtx(internalDb, null);
}

describe('Task 10: GET /api/facilities/health', () => {
  it('returns the dimension state', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(jobsCtx(internalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json().reportDimension).toMatchObject({ state: expect.any(String) });
  });

  it('is gated on facilities.view', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(jobsCtx(internalDb), []);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/health' });

    expect(res.statusCode).toBe(403);
  });

  it('a user with only facilities.view (no facilities.manage) CAN read health', async () => {
    const internalDb = await makeMigratedDb();
    const app = await appWith(jobsCtx(internalDb), ['facilities.view']);

    const res = await app.inject({ method: 'GET', url: '/api/facilities/health' });

    expect(res.statusCode).toBe(200);
  });
});

describe('Task 10: POST /api/facilities/jobs/:id/retry', () => {
  it('re-queues a failed job', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = jobsCtx(internalDb);
    const app = await appWith(ctx);

    await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild' });
    const claimed = await ctx.facilityJobs.claimNext();
    await ctx.facilityJobs.finish(claimed!.id, 'failed', { error: 'boom' });

    const res = await app.inject({ method: 'POST', url: `/api/facilities/jobs/${claimed!.id}/retry` });

    expect(res.statusCode).toBe(200);
    expect((await ctx.facilityJobs.latest('facility-map-rebuild'))?.status).toBe('queued');
  });

  it('is gated on facilities.manage', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = jobsCtx(internalDb);
    const viewOnly = await appWith(ctx, ['facilities.view']);

    await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild' });
    const claimed = await ctx.facilityJobs.claimNext();
    await ctx.facilityJobs.finish(claimed!.id, 'failed', { error: 'boom' });

    const res = await viewOnly.inject({ method: 'POST', url: `/api/facilities/jobs/${claimed!.id}/retry` });

    expect(res.statusCode).toBe(403);
    // Nothing changed — a rejected request must not have re-queued the job anyway.
    expect((await ctx.facilityJobs.latest('facility-map-rebuild'))?.status).toBe('failed');
    expect(ctx.__audit).toHaveLength(0); // a rejected request must not audit either
  });

  // Deliberate: `FacilityJobStore.retry` is itself a silent no-op on an unknown id (see
  // facility-job-store.ts) — it has to look up the row to decide, exactly as `GET
  // /api/facilities/:id` and `PUT /api/facilities/:id` already do for an unknown facility id, so a
  // typo'd or already-purged job id gets a real 404 instead of a misleading 200.
  it('a retry of an unknown job id is a 404, not a false-positive 200', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = jobsCtx(internalDb);
    const app = await appWith(ctx);

    const res = await app.inject({ method: 'POST', url: '/api/facilities/jobs/fj_does-not-exist/retry' });

    expect(res.statusCode).toBe(404);
    expect(ctx.__audit).toHaveLength(0); // nothing was retried — must not be audited
  });

  // Pins the operator-vs-worker distinction documented on `ctx.facilityJobs.retry` (facility-job-
  // store.ts): the route must call `retry`, which resets a spent `attempts` budget to 0, NEVER
  // `retryPreservingAttempts` (the worker's own automatic retry, which deliberately leaves `attempts`
  // alone so ITS loop stays bounded). Swap the two in the route and every other test in this describe
  // block still passes — none of them drive `attempts` high enough to tell the difference — because a
  // fresh/lightly-failed job's `attempts` is already low, so "preserved" and "reset to 0" look the
  // same. This test exhausts the budget first so the two methods diverge: an operator who fixed the
  // underlying cause and clicked Retry on a job that failed 5 times must not stay locked out.
  it('an operator retry resets a spent attempt budget to 0, re-queuing a job at its retry limit', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = jobsCtx(internalDb);
    const app = await appWith(ctx);

    await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild' });
    const claimed = await ctx.facilityJobs.claimNext();
    await ctx.facilityJobs.finish(claimed!.id, 'failed', { error: 'boom' });
    // Simulate the worker having spent the job's whole retry budget — a real run gets here through
    // repeated claimNext/finish('failed') cycles (see facility-job-worker.ts); set `attempts` directly
    // rather than looping, since the exhausted STATE is what this test needs, not how it was reached.
    await internalDb.updateTable('facility_jobs').set({ attempts: 5 }).where('id', '=', claimed!.id).execute();

    const res = await app.inject({ method: 'POST', url: `/api/facilities/jobs/${claimed!.id}/retry` });

    expect(res.statusCode).toBe(200);
    const after = await ctx.facilityJobs.latest('facility-map-rebuild');
    expect(after?.status).toBe('queued');
    expect(after?.attempts).toBe(0);
  });

  // ⛔ The Retry button's own worst case, and the one that used to wedge the whole mechanism.
  // Re-queueing a RUNNING job re-arms its `active_key` while the run is still in flight; that run's
  // `finish()` then writes a terminal status, so the operator's retry evaporates — and, before
  // `finish` learned to release the key, the identity stayed held by a row that could never run
  // again, so EVERY later facility mutation coalesced onto it and reported success while the
  // dimension was never rebuilt. Answering 409 is what makes the refusal visible instead of a 200
  // that did nothing.
  it('⛔ refuses to retry a RUNNING job with a 409 rather than silently discarding the request', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = jobsCtx(internalDb);
    const app = await appWith(ctx);

    await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild' });
    const claimed = await ctx.facilityJobs.claimNext();
    expect(claimed!.status).toBe('running');

    const res = await app.inject({ method: 'POST', url: `/api/facilities/jobs/${claimed!.id}/retry` });

    expect(res.statusCode).toBe(409);
    // Untouched, and NOT audited — nothing changed, so there is nothing to attribute.
    expect(await ctx.facilityJobs.latest('facility-map-rebuild')).toMatchObject({ status: 'running', attempts: 1 });
    expect(ctx.__audit).toHaveLength(0);

    // And the mechanism is still live: the running job's identity was never re-armed, so the very
    // next facility mutation gets a job of its own instead of coalescing onto a dead row.
    expect((await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild' })).coalesced).toBe(false);
  });

  it('audits the retry as facility.job.retry, with the job\'s before/after state', async () => {
    const internalDb = await makeMigratedDb();
    const ctx = jobsCtx(internalDb);
    const app = await appWith(ctx);

    await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild' });
    const claimed = await ctx.facilityJobs.claimNext();
    await ctx.facilityJobs.finish(claimed!.id, 'failed', { error: 'boom' });

    const res = await app.inject({ method: 'POST', url: `/api/facilities/jobs/${claimed!.id}/retry` });

    expect(res.statusCode).toBe(200);
    expect(ctx.__audit.map((a: any) => a.action)).toEqual(['facility.job.retry']);
    expect(ctx.__audit[0]).toMatchObject({
      entityType: 'facility_job',
      entityId: claimed!.id,
      before: { status: 'failed' },
      after: { status: 'queued', attempts: 0 },
    });
  });
});

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
    // Seeded directly rather than through POST: POST would refuse the raw level, which is the very
    // asymmetry between the import door and the edit door that this test exists for.
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
    // The row must be untouched — a refusal that still wrote would be worse than no refusal.
    expect(ctx.__rows[0].nationalCode).toBe('100');
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
    expect(ctx.__rows[0].nationalSystem).toBe('urn:openldr:facility-register:mfl');
  });

  it('refuses an edit that BLANKS the national code, rather than nulling the row\'s identity', async () => {
    const ctx = fakeCtx();
    // A local code so the has-a-code CHECK is satisfied and this reaches the identity guard rather
    // than being refused earlier for a different reason.
    ctx.__rows.push({ ...seeded, localCode: 'LAB01' });
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'PUT', url: '/api/facilities/fac-1',
      payload: editBody({ f1: 'LAB01', f2: 'Commando Urban', f6: '', f7: 'urn:openldr:facility-register:mfl' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('national code cannot be changed');
    expect(ctx.__rows[0].nationalCode).toBe('100');
  });

  it('leaves a facility with NO national code editable — there is no identity to move', async () => {
    const ctx = fakeCtx();
    ctx.__rows.push({
      id: 'fac-2', localCode: 'LAB01', nationalSystem: null, nationalCode: null,
      name: 'Bahebe Health Laboratory', extras: {}, source: 'manual',
    });
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'PUT', url: '/api/facilities/fac-2',
      payload: editBody({ f1: 'LAB01', f2: 'Bahebe Health Lab' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Bahebe Health Lab');
  });
});

describe('Task 4: a manual create keys the same way an import does', () => {
  const MFL = 'urn:openldr:facility-register:mfl';

  // `registerSources` is built over ctx.internalDb at route registration, and `fakeCtx`'s
  // internalDb is a narrow Proxy that cannot answer a real query. Inject the store instead — this
  // suite is about the ROUTE's derivation and gate; the store's own SQL is covered in packages/db.
  function ctxWithRegister() {
    const ctx = fakeCtx();
    ctx.__registerSources = {
      getByUrl: async (url: string) => (url === MFL ? { url, name: 'MFL', active: true } : undefined),
    };
    return ctx;
  }

  const nationalBody = {
    answers: { f2: 'Commando Urban', f6: '100', f7: MFL },
    formSchemaId: 'form-sample-facility',
    formVersion: 1,
  };

  const derivedId = (system: string, code: string) =>
    `fac-${createHash('sha256').update(`${system}|${code}`).digest('hex').slice(0, 16)}`;

  it('derives the id from the register and national code, exactly as the importer does', async () => {
    const ctx = ctxWithRegister();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: nationalBody });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(derivedId(MFL, '100'));
  });

  it('keeps a random id when there is no national code — nothing to hash', async () => {
    const ctx = ctxWithRegister();
    const app = await appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/facilities', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).not.toMatch(/^fac-/);
  });

  it('keeps a random id when a register is named but no code is given', async () => {
    // Mirrors migration 082's own rule: a row carrying a register but no national code keeps its
    // id, because `idFor` has nothing to hash and re-deriving would invent an identity.
    const ctx = ctxWithRegister();
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...nationalBody, answers: { f1: 'LAB01', f2: 'Commando Urban', f7: MFL } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).not.toMatch(/^fac-/);
  });

  it('refuses an unregistered register instead of hashing a typed label into a permanent id', async () => {
    const ctx = ctxWithRegister();
    const app = await appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...nationalBody, answers: { ...nationalBody.answers, f7: 'MFL' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('is not a known facility register');
    expect(ctx.__rows).toHaveLength(0);
  });

  it('⛔ refuses rather than OVERWRITING a facility already under that national code', async () => {
    // `facilityRegistry.upsert` is onConflict(id).doUpdateSet (packages/db/facility-registry-store.ts).
    // With a DERIVED id, a create that reached it would silently replace an imported facility —
    // no error, and no record of what was lost. This is the test that pins the refusal.
    const ctx = ctxWithRegister();
    const app = await appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/facilities', payload: nationalBody });
    const res = await app.inject({
      method: 'POST', url: '/api/facilities',
      payload: { ...nationalBody, answers: { ...nationalBody.answers, f2: 'A different name' } },
    });
    expect(res.statusCode).toBe(409);
    expect(ctx.__rows).toHaveLength(1);
    expect(ctx.__rows[0].name).toBe('Commando Urban');
  });
});
