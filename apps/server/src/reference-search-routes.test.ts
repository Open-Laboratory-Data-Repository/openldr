import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerReferenceSearchRoutes } from './reference-search-routes';
import './auth-plugin';

const FORM = {
  id: 'form-1',
  schema: {
    id: 'form-1', name: 'Lab order', fields: [
      { id: 'patient',    fieldType: 'reference', displayLabel: 'Patient', referenceTarget: 'Patient' },
      { id: 'tests',      fieldType: 'reference', displayLabel: 'Tests',   referenceTarget: 'ActivityDefinition' },
      { id: 'loinc',      fieldType: 'reference', displayLabel: 'LOINC',   referenceTarget: 'http://loinc.org' },
      { id: 'sourceless', fieldType: 'reference', displayLabel: 'None' },
    ],
  },
};

/** Records the limit the resolver was called with, so the cap can be asserted. */
const calls: { limit: number }[] = [];

function makeApp(capabilities = ['forms.view', 'forms.edit']) {
  calls.length = 0;
  const ctx = {
    forms: { get: async (id: string) => (id === FORM.id ? FORM : null) },
    terminology: {
      ops: { expand: vi.fn() },
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
      search: async (_q: string, limit: number) => {
        calls.push({ limit });
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
});
