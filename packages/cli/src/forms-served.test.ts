import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Served CLI reads obey each form's open list, as the form routes do (roles review FR4). The
// checks are the real bootstrap functions, against in-memory stores.
const mocks = vi.hoisted(() => ({
  user: { capabilities: ['forms.view'], roleIds: ['r-viewer'] },
}));

vi.mock('@openldr/bootstrap', async () => {
  const real = await vi.importActual<typeof import('../../bootstrap/src/form-access')>('../../bootstrap/src/form-access');
  const lists: Record<string, { open: string[]; submit: string[] }> = { tracking: { open: ['r-clerk'], submit: [] } };
  const store = {
    async get(id: string) { return lists[id] ?? { open: [], submit: [] }; },
    async forForms(ids: string[]) { return new Map(ids.filter((id) => lists[id]).map((id) => [id, lists[id]!])); },
  };
  const form = (id: string) => ({ id, name: id, status: 'published', active: true, fhirResourceType: null, fieldCount: 0, versionLabel: null, schema: { fields: [], sections: [], targetPages: [] } });
  return {
    formUserOf: real.formUserOf,
    recordAuditEvent: vi.fn(),
    createAppContext: async () => ({
      forms: {
        async list() { return [form('open'), form('tracking')]; },
        async get(id: string) { return id === 'open' || id === 'tracking' ? form(id) : null; },
        async listVersions() { return [{ version: 1, versionLabel: 'v1', publishedAt: '2026-01-01T00:00:00.000Z' }]; },
      },
      users: { async get(id: string) { return id === 'u1' ? { id: 'u1', subject: null } : null; } },
      roles: {
        async resolveCapabilities() { return mocks.user.capabilities; },
        async rolesForUser() { return mocks.user.roleIds.map((id) => ({ id })); },
      },
      formAccess: real.formAccess({ access: store as never }),
      close: async () => {},
    }),
  };
});
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runFormsList, runFormsLint, runFormsVersions } from './forms';
import { resetServedHandoffForTests, setServedHandoff } from './served';

const out = () => vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');

function serve() {
  setServedHandoff({ path: 'forms list', argv: [], caller: { id: 'u1', username: 'ada', displayName: null, keyName: null }, runDir: '/tmp/x', keptDirs: [] });
}

describe('served form reads', () => {
  beforeEach(() => {
    mocks.user = { capabilities: ['forms.view'], roleIds: ['r-viewer'] };
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => resetServedHandoffForTests());

  it('lists only the forms the caller may open', async () => {
    serve();
    expect(await runFormsList({ json: true })).toBe(0);
    expect(JSON.parse(out()).map((f: { id: string }) => f.id)).toEqual(['open']);
  });

  it('answers no form for one the caller may not open, on versions and lint', async () => {
    serve();
    expect(await runFormsVersions('tracking', { json: true })).toBe(1);
    expect(await runFormsLint('tracking', { json: true })).toBe(1);
    expect(out()).not.toContain('tracking');
  });

  it('lints only the forms the caller may open when no id is given', async () => {
    serve();
    await runFormsLint(undefined, { json: true });
    expect(JSON.parse(out()).map((r: { id: string }) => r.id)).toEqual(['open']);
  });

  it('shows every form to a listed role, an editor, and a local run', async () => {
    mocks.user = { capabilities: ['forms.view'], roleIds: ['r-clerk'] };
    serve();
    await runFormsList({ json: true });
    expect(JSON.parse(out()).map((f: { id: string }) => f.id)).toEqual(['open', 'tracking']);
    resetServedHandoffForTests();
    vi.mocked(process.stdout.write).mockClear();
    mocks.user = { capabilities: ['forms.view', 'forms.edit'], roleIds: [] };
    serve();
    await runFormsList({ json: true });
    expect(JSON.parse(out()).map((f: { id: string }) => f.id)).toEqual(['open', 'tracking']);
    resetServedHandoffForTests();
    vi.mocked(process.stdout.write).mockClear();
    mocks.user = { capabilities: [], roleIds: [] };
    await runFormsList({ json: true });
    expect(JSON.parse(out()).map((f: { id: string }) => f.id)).toEqual(['open', 'tracking']);
  });
});
