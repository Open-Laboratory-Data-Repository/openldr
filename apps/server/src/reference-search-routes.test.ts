import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerReferenceSearchRoutes } from './reference-search-routes';
import './auth-plugin';

// `status: 'published'` matters: Fix 4 requires the route to 404 on anything else, so the
// fixture must be published for the pre-existing (non-status) tests below to keep passing.
const FORM = {
  id: 'form-1',
  status: 'published',
  schema: {
    id: 'form-1', name: 'Lab order', fields: [
      { id: 'patient',    fieldType: 'reference', displayLabel: 'Patient', referenceTarget: 'Patient' },
      { id: 'tests',      fieldType: 'reference', displayLabel: 'Tests',   referenceTarget: 'ActivityDefinition' },
      { id: 'loinc',      fieldType: 'reference', displayLabel: 'LOINC',   referenceTarget: 'http://loinc.org' },
      { id: 'sourceless', fieldType: 'reference', displayLabel: 'None' },
      { id: 'vaccine',    fieldType: 'reference', displayLabel: 'Vaccine', valueSetUrl: 'http://hl7.org/fhir/ValueSet/vaccine-code' },
    ],
  },
};

// A draft counterpart of FORM, used to prove Fix 4: a field on an unpublished form 404s exactly
// like a missing form would.
const DRAFT_FORM = {
  id: 'form-2',
  status: 'draft',
  schema: {
    id: 'form-2', name: 'Draft form', fields: [
      { id: 'patient', fieldType: 'reference', displayLabel: 'Patient', referenceTarget: 'Patient' },
    ],
  },
};

/** Records the limit the resolver was called with, so the cap can be asserted. */
const calls: { limit: number }[] = [];
/** Records the offset the resolver was called with, so Fix 3's clamping can be asserted. */
const offsets: number[] = [];
/** Reassigned per `makeApp()` call so tests can assert on the instance for that app. */
let opsExpand = vi.fn();

function makeApp(capabilities = ['forms.view', 'forms.edit']) {
  calls.length = 0;
  offsets.length = 0;
  opsExpand = vi.fn();
  const ctx = {
    forms: { get: async (id: string) => (id === FORM.id ? FORM : id === DRAFT_FORM.id ? DRAFT_FORM : null) },
    terminology: {
      ops: { expand: opsExpand },
      admin: {
        terms: {
          search: async () => ({
            rows: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }],
            total: 1,
          }),
        },
      },
    },
  };
  const resolvers = {
    Patient: {
      search: async (_q: string, limit: number, offset: number) => {
        calls.push({ limit });
        offsets.push(offset);
        return { rows: [{ reference: 'Patient/p1', display: 'Doe Jane', secondary: '1992-01-01 · F' }], total: 1 };
      },
    },
  };
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'], capabilities } as never;
  });
  registerReferenceSearchRoutes(app, ctx as never, resolvers as never);
  return app;
}

const url = (fieldId: string, qs: string) => `/api/forms/${FORM.id}/fields/${fieldId}/reference-search?${qs}`;

describe('reference search', () => {
  it('404s for an unknown form', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/api/forms/nope/fields/patient/reference-search?q=doe' });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown field', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('nope', 'q=doe') });
    expect(res.statusCode).toBe(404);
  });

  it('400s for a field that declares no source', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('sourceless', 'q=doe') });
    expect(res.statusCode).toBe(400);
  });

  it('400s for a declared but unregistered entity target', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('tests', 'q=xx') });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('ActivityDefinition');
  });

  it('returns entity rows for a patient-bound field', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('patient', 'q=doe') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'entity', rows: [{ reference: 'Patient/p1' }], total: 1 });
  });

  it('returns coding rows for a codesystem-bound field', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('loinc', 'q=hemo') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'coding', rows: [{ system: 'http://loinc.org', code: '718-7' }] });
  });

  it('returns an empty result for a query under two characters, without hitting a store', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('patient', 'q=d') });
    expect(res.json()).toEqual({ kind: 'entity', rows: [], total: 0 });
    expect(calls).toEqual([]);
  });

  it('caps limit at 50', async () => {
    await makeApp().inject({ method: 'GET', url: url('patient', 'q=doe&limit=500') });
    expect(calls).toEqual([{ limit: 50 }]);
  });

  it('requires forms.edit for preview', async () => {
    const res = await makeApp(['forms.view']).inject({
      method: 'POST', url: '/api/forms/reference-search/preview',
      payload: { field: { id: 'x', fieldType: 'reference', referenceTarget: 'Patient', displayLabel: 'X' }, q: 'doe' },
    });
    expect(res.statusCode).toBe(403);
  });

  // Fix 5: the preview route had only ever been exercised for its 403. This proves the happy
  // path end-to-end — the zod schema accepts the inline field, resolveReferenceSource classifies
  // it, and the entity resolver's rows come back in the documented { kind, rows, total } shape.
  it('returns real rows from the preview route for an inline field', async () => {
    const res = await makeApp().inject({
      method: 'POST', url: '/api/forms/reference-search/preview',
      payload: { field: { id: 'x', fieldType: 'reference', referenceTarget: 'Patient', displayLabel: 'X' }, q: 'doe' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'entity', rows: [{ reference: 'Patient/p1' }], total: 1 });
  });

  // Fix 4: a form that exists but isn't published must 404 exactly like a missing form, so a
  // caller can't tell a draft apart from something that was never there.
  it('404s for a field on a draft (unpublished) form', async () => {
    const res = await makeApp().inject({
      method: 'GET',
      url: `/api/forms/${DRAFT_FORM.id}/fields/patient/reference-search?q=doe`,
    });
    expect(res.statusCode).toBe(404);
  });

  // Fix 3: `?offset=abc` must not become `OFFSET NaN` at the resolver, and must not blow up into
  // a 5xx either — it should behave exactly like an absent offset.
  it('treats a non-numeric offset as 0 instead of forwarding NaN or 5xx-ing', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('patient', 'q=doe&offset=abc') });
    expect(res.statusCode).toBeLessThan(500);
    expect(offsets).toEqual([0]);
  });

  // Coding-path counterpart to the entity-path "under two characters" test above: a valueset-
  // bound field must also skip the store, not just the entity resolver.
  it('returns an empty result for a valueset-bound field under two characters, without hitting the terminology store', async () => {
    const res = await makeApp().inject({ method: 'GET', url: url('vaccine', 'q=d') });
    expect(res.json()).toEqual({ kind: 'coding', rows: [], total: 0 });
    expect(opsExpand).not.toHaveBeenCalled();
  });
});
