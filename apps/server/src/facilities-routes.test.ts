import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
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
  };
  // Captures whatever options object actually reached `list()`, so tests can assert on what the
  // route computed rather than merely on the response's statusCode (a fake `list` that discards
  // its argument makes query-param sanitisation tests tautological — see Q1).
  let lastListOptions: any;
  return {
    audit: { record: async (e: any) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    forms: { get: async (formId: string) => forms[formId] },
    facilityRegistry: {
      list: async (opts?: any) => { lastListOptions = opts; return rows; },
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

  it('C2: POST with no formSchemaId at all is a 400 (fieldsOf also resolves to [])', async () => {
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
});
