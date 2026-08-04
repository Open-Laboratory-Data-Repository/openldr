import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerFacilitiesRoutes } from './facilities-routes';

const FORM_FIELDS = [
  { id: 'f1', apiProperty: 'localCode' },
  { id: 'f2', apiProperty: 'name' },
  { id: 'f3', apiProperty: 'region' },
  { id: 'f4', apiProperty: 'catchmentPop' },
];

function fakeCtx() {
  const rows: any[] = [];
  const audit: any[] = [];
  // Keyed by form id so a test can submit an id that does NOT resolve (`ctx.forms.get` returns
  // `undefined`), distinct from the happy-path id used by every baseline test.
  const forms: Record<string, any> = {
    'form-sample-facility': { id: 'form-sample-facility', schema: { fields: FORM_FIELDS } },
  };
  return {
    audit: { record: async (e: any) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    forms: { get: async (formId: string) => forms[formId] },
    facilityRegistry: {
      list: async () => rows,
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
  });

  it('ignores a non-positive limit', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/facilities?limit=-5' });
    expect(res.statusCode).toBe(200);
  });

  it('tolerates a repeated limit param (Fastify parses it as an array)', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/facilities?limit=1&limit=2' });
    expect(res.statusCode).toBe(200);
  });

  it('tolerates a repeated filter param instead of passing an array to the store', async () => {
    const app = await appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/facilities?region=A&region=B' });
    expect(res.statusCode).toBe(200);
  });
});
