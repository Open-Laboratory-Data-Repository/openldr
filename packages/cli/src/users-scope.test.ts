import { describe, it, expect, vi, beforeEach } from 'vitest';

// `openldr users scope` (roles part 3). The setter is the real bootstrap function the route uses,
// against in-memory stores.
const mocks = vi.hoisted(() => ({
  saved: new Map<string, unknown>(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/bootstrap', async () => {
  const scope = await vi.importActual<typeof import('../../bootstrap/src/data-scope')>('../../bootstrap/src/data-scope');
  const registry = [
    { id: 'f1', name: 'Kondoa HC', facility_code: 'K', region: 'Dodoma', district: 'Kondoa' },
    { id: 'f2', name: 'Arusha HC', facility_code: 'A', region: 'Arusha', district: 'Arumeru' },
  ];
  return {
    setUserDataScope: scope.setUserDataScope,
    DataScopeError: scope.DataScopeError,
    readScopeRegistryRows: async () => registry,
    recordAuditEvent: mocks.recordAuditEvent,
    createAppContext: async () => ({
      internalDb: {},
      dataScopes: {
        async get(s: string) { return mocks.saved.get(s) ?? { limited: false }; },
        async set(s: string, v: unknown) { const before = mocks.saved.get(s) ?? { limited: false }; mocks.saved.set(s, v); return { before, after: v }; },
      },
      users: { async get(id: string) { return id === 'u1' ? { id } : undefined; }, async getBySubject(s: string) { return s === 'sub-1' ? { id: 'u1' } : undefined; } },
      roles: { async rolesForUser() { return []; } },
      facilityRegistry: {
        async get(id: string) { return registry.find((f) => f.id === id); },
        async list(o: { region?: string; district?: string }) {
          const rows = registry.filter((f) => (!o.region || f.region === o.region) && (!o.district || f.district === o.district));
          return { rows, total: rows.length };
        },
      },
      close: async () => {},
    }),
  };
});
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runUsersScope } from './users-scope';

const out = () => vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');
const err = () => vi.mocked(process.stderr.write).mock.calls.map((c) => String(c[0])).join('');
const base = { json: false, all: false, force: false };

describe('runUsersScope', () => {
  beforeEach(() => {
    mocks.saved.clear();
    mocks.recordAuditEvent.mockReset();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('shows Everything for a user with no limit', async () => {
    expect(await runUsersScope('sub-1', base)).toBe(0);
    expect(out()).toBe('sub-1: everything\n');
  });

  it('refuses to set a limit without --force, and saves nothing', async () => {
    expect(await runUsersScope('sub-1', { ...base, region: 'Dodoma' })).toBe(1);
    expect(err()).toMatch(/--force/);
    expect(mocks.saved.size).toBe(0);
  });

  it('sets a limit from facilities, districts and regions, audits it as the cli, and shows it by name', async () => {
    const code = await runUsersScope('sub-1', { ...base, force: true, facility: 'f1', district: 'Arusha/Arumeru', region: 'Dodoma' });
    expect(code).toBe(0);
    expect(mocks.saved.get('sub-1')).toEqual({ limited: true, facilities: ['f1'], districts: [{ region: 'Arusha', district: 'Arumeru' }], regions: ['Dodoma'] });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorType: 'cli' }), expect.objectContaining({
      action: 'user.data_scope.set', entityType: 'user', entityId: 'sub-1',
      before: { limited: false }, after: { limited: true, facilities: ['f1'], districts: [{ region: 'Arusha', district: 'Arumeru' }], regions: ['Dodoma'] },
    }));
    expect(out()).toBe('sub-1: limited to regions Dodoma; districts Arumeru (Arusha); facilities Kondoa HC (f1)\n');
  });

  it('--all sets Everything again without --force', async () => {
    mocks.saved.set('sub-1', { limited: true, facilities: ['f1'], districts: [], regions: [] });
    expect(await runUsersScope('sub-1', { ...base, all: true })).toBe(0);
    expect(mocks.saved.get('sub-1')).toEqual({ limited: false });
  });

  it('refuses --all with a list, a malformed district, a place not in the register, and an unknown user', async () => {
    expect(await runUsersScope('sub-1', { ...base, all: true, region: 'Dodoma' })).toBe(1);
    expect(await runUsersScope('sub-1', { ...base, force: true, district: 'Kondoa' })).toBe(1);
    expect(await runUsersScope('sub-1', { ...base, force: true, region: 'Nowhere' })).toBe(1);
    expect(await runUsersScope('ghost', { ...base, force: true, region: 'Dodoma' })).toBe(1);
    expect(err()).toMatch(/Region\/District/);
    expect(err()).toMatch(/Nowhere/);
    expect(err()).toMatch(/no user ghost/);
    expect(mocks.saved.size).toBe(0);
  });

  it('emits JSON', async () => {
    expect(await runUsersScope('sub-1', { ...base, json: true })).toBe(0);
    expect(JSON.parse(out())).toEqual({ subject: 'sub-1', dataScope: { limited: false } });
  });

  // Review C1: the CLI sets Limited with nothing listed, as the Users sheet can.
  it('--none sets Limited with nothing listed, needs --force, and refuses a list or --all beside it', async () => {
    expect(await runUsersScope('sub-1', { ...base, none: true })).toBe(1);
    expect(mocks.saved.size).toBe(0);
    expect(await runUsersScope('sub-1', { ...base, none: true, force: true, region: 'Dodoma' })).toBe(1);
    expect(await runUsersScope('sub-1', { ...base, none: true, all: true, force: true })).toBe(1);
    expect(mocks.saved.size).toBe(0);
    expect(await runUsersScope('sub-1', { ...base, none: true, force: true })).toBe(0);
    expect(mocks.saved.get('sub-1')).toEqual({ limited: true, facilities: [], districts: [], regions: [] });
    expect(out()).toContain('sub-1: limited, with nothing listed, so no dashboard numbers');
  });
});
