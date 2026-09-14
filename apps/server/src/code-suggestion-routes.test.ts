import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerCodeSuggestionRoutes } from './code-suggestion-routes';
import './auth-plugin';

type AuditInput = Parameters<AppContext['audit']['record']>[0];
type FakeTerm = { system: string; code: string; meta?: Record<string, unknown> | null };

const LOINC = 'http://loinc.org';
const AUTHOR = ['forms.view', 'forms.edit'];
const CURATOR = [...AUTHOR, 'terminology.manage'];

function fakeCtx(held: FakeTerm[] = []) {
  const audits: AuditInput[] = [];
  const terms = new Map(held.map((t) => [`${t.system}|${t.code}`, t]));
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    audit: {
      record: async (input: AuditInput) => {
        audits.push(input);
        return { ...input, id: `audit-${audits.length}`, occurredAt: '2026-01-01T00:00:00.000Z' };
      },
    },
    forms: {
      listDefinitions: async () => [
        { id: 'form-a', fhirResourceType: 'Observation', schema: { fields: [
          { id: 'x', fhirPath: 'Observation.code', code: [{ system: LOINC, code: '718-7', display: 'Hemoglobin' }] },
        ] } },
        { id: 'form-b', fhirResourceType: 'Observation', schema: { fields: [
          { id: 'x', fhirPath: 'code', code: [{ system: LOINC, code: '718-7' }, { system: LOINC, code: '6690-2', display: 'WBC' }] },
        ] } },
      ],
    },
    terminology: {
      admin: {
        valueSets: {
          getByUrl: async (url: string) => (url === 'urn:test:vs' ? { id: 'vs-1', url } : null),
          storedCodes: async (id: string) => (id === 'vs-1' ? [{ system: LOINC, code: '2345-7', display: 'Glucose' }] : []),
        },
        codingSystems: {
          getByUrl: async (url: string) => (url === LOINC ? { id: 'cs-loinc', url } : null),
        },
        terms: {
          existing: async (pairs: { system: string; code: string }[]) => pairs.filter((p) => terms.has(`${p.system}|${p.code}`)),
          createIfAbsent: async (input: { system: string; code: string; display: string; status: string; metadata?: Record<string, unknown> | null }) => {
            const key = `${input.system}|${input.code}`;
            if (terms.has(key)) return null;
            terms.set(key, { system: input.system, code: input.code, meta: input.metadata ?? null });
            return { system: input.system, code: input.code, display: input.display, status: input.status, metadata: input.metadata ?? null, mappingCount: 0 };
          },
          deleteIfAddedBy: async (system: string, code: string, tag: string) => {
            const key = `${system}|${code}`;
            if (terms.get(key)?.meta?.addedBy !== tag) return false;
            terms.delete(key);
            return true;
          },
        },
      },
    },
  };
  return { ctx, audits, terms };
}

function appFor(ctx: unknown, capabilities: string[]) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'u1', username: 'author', displayName: null, roles: [], capabilities } as never;
  });
  registerCodeSuggestionRoutes(app, ctx as never);
  return app;
}

describe('GET /api/forms/code-suggestions', () => {
  it('ranks the codes other forms use first, by count, then the binding, and marks the codes CE lacks', async () => {
    const { ctx } = fakeCtx([{ system: LOINC, code: '718-7' }]);
    const res = await appFor(ctx, AUTHOR).inject({ method: 'GET', url: '/api/forms/code-suggestions?fhirPath=Observation.code&valueSetUrl=urn:test:vs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { system: LOINC, code: '718-7', display: 'Hemoglobin', source: 'your-forms', count: 2, inTerminology: true },
      { system: LOINC, code: '6690-2', display: 'WBC', source: 'your-forms', count: 1, inTerminology: false },
      { system: LOINC, code: '2345-7', display: 'Glucose', source: 'binding', inTerminology: false },
    ]);
  });

  it('leaves out the form being edited', async () => {
    const { ctx } = fakeCtx();
    const res = await appFor(ctx, AUTHOR).inject({ method: 'GET', url: '/api/forms/code-suggestions?fhirPath=Observation.code&formId=form-b' });
    expect(res.json()).toEqual([{ system: LOINC, code: '718-7', display: 'Hemoglobin', source: 'your-forms', count: 1, inTerminology: false }]);
  });

  it('returns an empty list for a set CE lacks and a path no form uses', async () => {
    const { ctx } = fakeCtx();
    const res = await appFor(ctx, AUTHOR).inject({ method: 'GET', url: '/api/forms/code-suggestions?fhirPath=Patient.gender&valueSetUrl=urn:missing' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('refuses a request with no path', async () => {
    const { ctx } = fakeCtx();
    const res = await appFor(ctx, AUTHOR).inject({ method: 'GET', url: '/api/forms/code-suggestions' });
    expect(res.statusCode).toBe(400);
  });

  it('needs forms.view', async () => {
    const { ctx } = fakeCtx();
    const res = await appFor(ctx, []).inject({ method: 'GET', url: '/api/forms/code-suggestions?fhirPath=Observation.code' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/forms/code-suggestions/import', () => {
  const post = (ctx: unknown, caps: string[], payload: unknown) =>
    appFor(ctx, caps).inject({ method: 'POST', url: '/api/forms/code-suggestions/import', payload: payload as never });

  it('adds a missing code, tagged, and audits it', async () => {
    const { ctx, audits, terms } = fakeCtx();
    const res = await post(ctx, CURATOR, { system: LOINC, code: '6690-2', display: 'WBC' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ system: LOINC, code: '6690-2', display: 'WBC', status: 'ACTIVE', metadata: { addedBy: 'code-suggestion' } });
    expect(terms.get(`${LOINC}|6690-2`)?.meta).toEqual({ addedBy: 'code-suggestion' });
    expect(audits).toMatchObject([{ action: 'term.create', entityType: 'term', entityId: '6690-2', metadata: { system: LOINC, via: 'code-suggestion' } }]);
  });

  it('uses the code as the display when none is given', async () => {
    const { ctx } = fakeCtx();
    const res = await post(ctx, CURATOR, { system: LOINC, code: '6690-2' });
    expect(res.json()).toMatchObject({ display: '6690-2' });
  });

  it('refuses a code CE already holds, and writes nothing', async () => {
    const { ctx, audits, terms } = fakeCtx([{ system: LOINC, code: '718-7' }]);
    const res = await post(ctx, CURATOR, { system: LOINC, code: '718-7', display: 'Something else' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'already-present' });
    expect(terms.get(`${LOINC}|718-7`)?.meta).toBeUndefined();
    expect(audits).toEqual([]);
  });

  it('refuses a system CE does not know', async () => {
    const { ctx, terms } = fakeCtx();
    const res = await post(ctx, CURATOR, { system: 'http://unknown.example', code: 'X' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'unknown-system' });
    expect(terms.size).toBe(0);
  });

  it('needs terminology.manage', async () => {
    const { ctx } = fakeCtx();
    expect((await post(ctx, AUTHOR, { system: LOINC, code: '6690-2' })).statusCode).toBe(403);
  });
});

describe('POST /api/forms/code-suggestions/undo', () => {
  const post = (ctx: unknown, caps: string[], payload: unknown) =>
    appFor(ctx, caps).inject({ method: 'POST', url: '/api/forms/code-suggestions/undo', payload: payload as never });

  it('removes a code the builder added, and audits it', async () => {
    const { ctx, audits, terms } = fakeCtx([{ system: LOINC, code: '6690-2', meta: { addedBy: 'code-suggestion' } }]);
    const res = await post(ctx, CURATOR, { system: LOINC, code: '6690-2' });
    expect(res.statusCode).toBe(204);
    expect(terms.has(`${LOINC}|6690-2`)).toBe(false);
    expect(audits).toMatchObject([{ action: 'term.delete', entityType: 'term', entityId: '6690-2', metadata: { system: LOINC, via: 'code-suggestion' } }]);
  });

  it('refuses to remove a term the builder did not add', async () => {
    const { ctx, terms } = fakeCtx([{ system: LOINC, code: '718-7' }]);
    const res = await post(ctx, CURATOR, { system: LOINC, code: '718-7' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not-added-here' });
    expect(terms.has(`${LOINC}|718-7`)).toBe(true);
  });

  it('needs terminology.manage', async () => {
    const { ctx } = fakeCtx([{ system: LOINC, code: '6690-2', meta: { addedBy: 'code-suggestion' } }]);
    expect((await post(ctx, AUTHOR, { system: LOINC, code: '6690-2' })).statusCode).toBe(403);
  });
});
