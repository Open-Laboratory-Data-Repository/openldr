import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { formAccess } from '@openldr/bootstrap';
import type { FormAccess, FormAccessStore } from '@openldr/db';
import { registerFormsRoutes } from './forms-routes';

// Design 2026-11-18-roles-scope, part 1: which roles may open and submit each form.
function memStore(lists: Record<string, FormAccess>): FormAccessStore {
  return {
    async get(id) { return lists[id] ?? { open: [], submit: [] }; },
    async set(id, a) { lists[id] = { open: [...a.open].sort(), submit: [...a.submit].sort() }; },
    async forForms(ids) { return new Map(ids.filter((id) => lists[id]).map((id) => [id, lists[id]!])); },
    async removeRole() {},
  };
}
const schema = { id: 'x', title: 'Form', fields: [] };
const form = (id: string) => ({ id, name: id, status: 'published', schema });

function app(user: { capabilities: string[]; roleIds: string[] }) {
  const lists: Record<string, FormAccess> = { tracking: { open: ['r-clerk'], submit: [] } };
  const store = memStore(lists);
  const audit = { record: vi.fn(async () => {}) };
  const ctx = {
    forms: {
      list: async () => [form('open'), form('tracking')],
      listPublished: async () => [form('open'), form('tracking')],
      get: async (id: string) => (id === 'open' || id === 'tracking' ? form(id) : null),
      listVersions: async () => [],
    },
    formAccessStore: store,
    formAccess: formAccess({ access: store }),
    roles: {
      get: async (id: string) => (id.startsWith('r-') ? { id } : null),
      list: async () => ['r-clerk', 'r-lead', 'r-nurse', 'r-tech'].map((id) => ({ id, slug: id, name: `Name ${id}` })),
    },
    audit,
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  };
  const a = Fastify();
  a.addHook('onRequest', async (req) => { req.user = { id: 'u1', username: 'u', displayName: null, roles: [], ...user } as never; });
  registerFormsRoutes(a, ctx as never);
  return { a, lists, audit };
}
const viewer = { capabilities: ['forms.view', 'forms.submit'], roleIds: ['r-viewer'] };
const clerk = { capabilities: ['forms.view', 'forms.submit'], roleIds: ['r-clerk'] };
const editor = { capabilities: ['forms.view', 'forms.edit'], roleIds: ['r-editor'] };
// The shipped Lab Manager: forms.edit and forms.submit, but no roles.view (Codex review FR1, FR2).
const manager = { capabilities: ['forms.view', 'forms.submit', 'forms.edit', 'forms.publish'], roleIds: ['r-manager'] };

describe('form access on the form routes', () => {
  it('lists only the forms a person may open, and every form to an editor', async () => {
    const ids = async (u: typeof viewer, url: string) => (await app(u).a.inject({ url })).json().map((f: { id: string }) => f.id);
    expect(await ids(viewer, '/api/forms')).toEqual(['open']);
    expect(await ids(viewer, '/api/forms/published')).toEqual(['open']);
    expect(await ids(clerk, '/api/forms/published')).toEqual(['open', 'tracking']);
    expect(await ids(editor, '/api/forms')).toEqual(['open', 'tracking']);
  });

  it('answers 404 for a form a person may not open, on every read of it', async () => {
    const { a } = app(viewer);
    for (const url of ['/api/forms/tracking', '/api/forms/tracking/questionnaire', '/api/forms/tracking/versions']) {
      expect((await a.inject({ url })).statusCode, url).toBe(404);
    }
    expect((await app(clerk).a.inject({ url: '/api/forms/tracking' })).statusCode).toBe(200);
  });

  it('refuses a submission from a person who may not submit the form', async () => {
    const res = await app(viewer).a.inject({ method: 'POST', url: '/api/forms/tracking/responses', payload: { answers: {} } });
    expect(res.statusCode).toBe(403);
  });

  it('lets an editor read and set the lists, refuses unknown roles, and audits the change', async () => {
    const { a, lists, audit } = app(editor);
    expect((await a.inject({ url: '/api/forms/tracking/access' })).json()).toMatchObject({ open: ['r-clerk'], submit: [] });
    const put = await a.inject({ method: 'PUT', url: '/api/forms/tracking/access', payload: { open: ['r-clerk', 'r-lead'], submit: ['r-lead'] } });
    expect(put.statusCode).toBe(200);
    expect(lists.tracking).toEqual({ open: ['r-clerk', 'r-lead'], submit: ['r-lead'] });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'form.access.set', entityId: 'tracking' }));
    const bad = await a.inject({ method: 'PUT', url: '/api/forms/tracking/access', payload: { open: ['no-such-role'], submit: [] } });
    expect(bad.statusCode).toBe(400);
    expect((await app(viewer).a.inject({ method: 'PUT', url: '/api/forms/tracking/access', payload: { open: [], submit: [] } })).statusCode).toBe(403);
  });

  it('refuses a submission from an editor whose roles the lists leave out (FR1)', async () => {
    const res = await app(manager).a.inject({ method: 'POST', url: '/api/forms/tracking/responses', payload: { answers: {} } });
    expect(res.statusCode).toBe(403);
  });

  it('names every role with the lists, so an editor without roles.view can pick them (FR2)', async () => {
    const body = (await app(manager).a.inject({ url: '/api/forms/tracking/access' })).json();
    expect(body.roles).toContainEqual({ id: 'r-clerk', slug: 'r-clerk', name: 'Name r-clerk' });
    expect(body.roles).toHaveLength(4);
  });
});
