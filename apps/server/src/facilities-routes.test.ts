import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import {
  createTerminologyAdminStore, createFacilityRegistryStore,
  DEFAULT_OBSERVED_FACILITY_SYSTEM, FACILITY_REGISTRY_SYSTEM,
} from '@openldr/db';
import { registerFacilitiesRoutes } from './facilities-routes';

const FORM_FIELDS = [
  { id: 'f1', apiProperty: 'localCode' },
  { id: 'f2', apiProperty: 'name' },
  { id: 'f3', apiProperty: 'region' },
  { id: 'f4', apiProperty: 'catchmentPop' },
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
    audit: { record: async (e: any) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    forms: { get: async (formId: string) => forms[formId] },
    facilityRegistry: {
      list: async (opts?: any) => { lastListOptions = opts; return rows; },
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
    expect(res.json()).toHaveLength(1);
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
  // leave the whole suite above green while the studio's `?limit=2000` (FACILITIES_LIST_LIMIT in
  // apps/studio/src/api.ts) silently falls back to the store's own 200-row default and the
  // truncation banner (which compares the returned row count against that same constant) never
  // fires — the exact defect the banner exists to make visible. See the report for the deliberate
  // stub experiment that proves these two tests actually catch that regression.

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

function fakeImportCtx(db: any) {
  const audit: any[] = [];
  return {
    internalDb: db,
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
    __audit: audit,
  } as any;
}

describe('POST /api/facilities/import', () => {
  it('I5: gated on facilities.manage — a facilities.view-only user gets 403', async () => {
    const db = await makeMigratedDb();
    const app = await appWith(fakeImportCtx(db), ['facilities.view']);
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']), nationalSystem: SYSTEM },
    });
    expect(res.statusCode).toBe(403);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('dry-run (no `apply`) returns the full summary and writes nothing', async () => {
    const db = await makeMigratedDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv([
      '100,Dodoma Regional Referral,,,,,,,,,,,,,,',
      ',No Code,,,,,,,,,,,,,,', // missing required national_code -> skipped
    ]);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM } });
    expect(res.statusCode).toBe(200);
    // Every counter always present, even the zero ones — a client must never confuse "0 found"
    // with "not reported".
    expect(res.json()).toEqual({ parsed: 1, skipped: 1, unknownColumns: [], created: 0, updated: 0, duplicates: 0 });
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
    expect(ctx.__audit).toHaveLength(0); // a dry run writes nothing, so it must not audit
  });

  it('apply: true writes and returns created/updated counts', async () => {
    const db = await makeMigratedDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,', '101,Kongwa DDH,,,,,,,,,,,,,,']);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ parsed: 2, created: 2, updated: 0, duplicates: 0 });
    const rows = await db.selectFrom('facility_registry').selectAll().execute();
    expect(rows).toHaveLength(2);
  });

  it('the applied mutation is audited as facility.import', async () => {
    const db = await makeMigratedDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv, nationalSystem: SYSTEM, apply: true } });
    expect(ctx.__audit.map((a: any) => a.action)).toEqual(['facility.import']);
    expect(ctx.__audit[0].entityId).toBe(SYSTEM);
  });

  it('unknown columns are reported, never swallowed, and block the import unless explicitly allowed', async () => {
    const db = await makeMigratedDb();
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
    const db = await makeMigratedDb();
    const ctx = fakeImportCtx(db);
    const app = await appWith(ctx);
    const csv = ['national_code,name,made_up_column', '100,Dodoma Regional Referral,xyz'].join('\n') + '\n';
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv, nationalSystem: SYSTEM, apply: true, allowUnknownColumns: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ unknownColumns: ['made_up_column'], parsed: 1, created: 1 });
    const row = await db.selectFrom('facility_registry').selectAll().executeTakeFirst();
    expect(row?.extras).toEqual({ made_up_column: 'xyz' });
  });

  it('⛔ nationalSystem is required — an omitted value is a 400, never defaulted to a hardcoded register', async () => {
    const db = await makeMigratedDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: facilityCsv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']) },
    });
    expect(res.statusCode).toBe(400);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('a non-string csv body is a clear 400, not a stack trace', async () => {
    const db = await makeMigratedDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv: 12345, nationalSystem: SYSTEM } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('an oversized csv body is rejected with a clear 400, not a stack trace', async () => {
    const db = await makeMigratedDb();
    const app = await appWith(fakeImportCtx(db));
    // Deliberately over any reasonable national-register size (see the route's MAX_IMPORT_CSV_BYTES
    // comment) — content doesn't need to be valid CSV, the size check runs before parsing.
    const oversized = 'a'.repeat(9 * 1024 * 1024);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv: oversized, nationalSystem: SYSTEM } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('⛔ apply is refused above the inline row cap — points the operator at the CLI instead of running a long transaction inline', async () => {
    const db = await makeMigratedDb();
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
    const db = await makeMigratedDb();
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
        const db = await makeMigratedDb();
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
        const db = await makeMigratedDb();
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
      const db = await makeMigratedDb();
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
    const db = await makeMigratedDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({ method: 'POST', url: '/api/facilities/import', payload: { csv: '', nationalSystem: SYSTEM } });
    expect(res.statusCode).toBe(400);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('a whitespace-only csv is a 400, not an all-zero 200', async () => {
    const db = await makeMigratedDb();
    const app = await appWith(fakeImportCtx(db));
    const res = await app.inject({
      method: 'POST', url: '/api/facilities/import',
      payload: { csv: '   \n  \n', nationalSystem: SYSTEM, apply: true },
    });
    expect(res.statusCode).toBe(400);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
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
    __audit: audit,
  } as any;
}

/** Mirrors `packages/bootstrap/src/test-support/facility-reconcile-fixture.ts`'s `seedPerformers`:
 *  one `diagnostic_reports` row per unit of report count, so the routes' own live
 *  `groupBy(['performer', 'source_system'])` aggregate has real rows to count. */
async function seedObservedReports(externalDb: any, pairs: [string, number][]): Promise<void> {
  const rows: { id: string; performer: string; source_system: string }[] = [];
  for (const [performer, count] of pairs) {
    for (let i = 0; i < count; i += 1) {
      rows.push({ id: `dr-${randomUUID()}`, performer, source_system: 'webhook-ingest' });
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

  it('needs no prior scan — resolves straight off the warehouse', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await seedObservedReports(externalDb, [['Dodoma', 5]]);
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));

    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([expect.objectContaining({ sourceCode: 'Dodoma', reportCount: 5, resolvedVia: null })]);
  });

  it('is gated on facilities.view', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb), []);
    const res = await app.inject({ method: 'GET', url: '/api/facilities/observed' });
    expect(res.statusCode).toBe(403);
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

  it('rejects a blank system instead of silently scanning the default one', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb));
    const res = await app.inject({ method: 'POST', url: '/api/facilities/scan-observed', payload: { system: '' } });
    expect(res.statusCode).toBe(400);
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

// --- Task 7: GET /api/facilities/:id/impact -----------------------------------------------------
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
    map_type: 'equivalent',
    relationship: null,
    owner: null,
    is_active: true,
    ...overrides,
  }).execute();
}

describe('Task 7: GET /api/facilities/:id/impact', () => {
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
