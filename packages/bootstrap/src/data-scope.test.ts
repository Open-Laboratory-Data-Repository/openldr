import { describe, it, expect } from 'vitest';
import type { DataScope, UserDataScopeStore } from '@openldr/db';
import { DataScopeError, setUserDataScope } from './data-scope';

// Design 2026-11-18-roles-scope, part 3: the one setter the route and the CLI call.
function memStore(): UserDataScopeStore & { saved: Map<string, DataScope> } {
  const saved = new Map<string, DataScope>();
  return {
    saved,
    async get(s) { return saved.get(s) ?? { limited: false }; },
    async set(s, scope) { const before = saved.get(s) ?? { limited: false }; saved.set(s, scope); return { before, after: scope }; },
  };
}
const facilities = [
  { id: 'f1', region: 'Dodoma', district: 'Kondoa' },
  { id: 'f2', region: 'Arusha', district: 'Kondoa' },
];
const deps = (store = memStore()) => ({
  scopes: store,
  users: {
    async get(id: string) { return id === 'local-1' ? { id } : undefined; },
    async getBySubject(s: string) { return s === 'kc-sub' ? { id: 'u2' } : undefined; },
  },
  roles: { async rolesForUser(s: string) { return s === 'role-only' ? [{ id: 'r1' }] : []; } },
  facilityRegistry: {
    async get(id: string) { return facilities.find((f) => f.id === id); },
    async list(o: { region?: string; district?: string }) {
      const rows = facilities.filter((f) => (!o.region || f.region === o.region) && (!o.district || f.district === o.district));
      return { rows, total: rows.length };
    },
  },
});

describe('setUserDataScope', () => {
  it('saves a limit checked against the register and returns the store\'s before and after', async () => {
    const store = memStore();
    const scope: DataScope = { limited: true, facilities: ['f1'], districts: [{ region: 'Arusha', district: 'Kondoa' }], regions: ['Dodoma'] };
    expect(await setUserDataScope(deps(store), 'kc-sub', scope)).toEqual({ before: { limited: false }, after: scope });
    expect(store.saved.get('kc-sub')).toEqual(scope);
  });

  it('accepts a local user by id, a signed-in subject, and a subject that holds roles', async () => {
    for (const s of ['local-1', 'kc-sub', 'role-only']) {
      await expect(setUserDataScope(deps(), s, { limited: false })).resolves.toBeDefined();
    }
  });

  it('refuses a user nobody knows', async () => {
    await expect(setUserDataScope(deps(), 'ghost', { limited: false })).rejects.toMatchObject({ reason: 'no-user' });
  });

  it('refuses a facility, region or district the register does not have, and saves nothing', async () => {
    const store = memStore();
    const bad: DataScope[] = [
      { limited: true, facilities: ['nope'], districts: [], regions: [] },
      { limited: true, facilities: [], districts: [], regions: ['Nowhere'] },
      { limited: true, facilities: [], districts: [{ region: 'Dodoma', district: 'Arumeru' }], regions: [] },
    ];
    for (const scope of bad) {
      const err = await setUserDataScope(deps(store), 'kc-sub', scope).catch((e) => e);
      expect(err).toBeInstanceOf(DataScopeError);
      expect(err.reason).toBe('not-in-register');
    }
    expect(store.saved.size).toBe(0);
  });

  it('saves Limited with nothing listed, which sees nothing', async () => {
    const r = await setUserDataScope(deps(), 'kc-sub', { limited: true, facilities: [], districts: [], regions: [] });
    expect(r.after).toEqual({ limited: true, facilities: [], districts: [], regions: [] });
  });
});
