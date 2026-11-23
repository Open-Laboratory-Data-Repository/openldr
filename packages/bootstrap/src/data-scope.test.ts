import { describe, it, expect } from 'vitest';
import type { DataScope, UserDataScopeStore } from '@openldr/db';
import { DataScopeError, dataScopeChoices, facilityIdsInScope, MAX_SCOPE_PLACES, resolveDataScope, setUserDataScope } from './data-scope';

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
  dataScopes: store,
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

describe('resolveDataScope', () => {
  const registry = [
    { id: 'r1', name: 'Kondoa HC', facility_code: 'FAC-1', region: 'Dodoma', district: 'Kondoa' },
    // Two registers carry the same code: each projects as its own id.
    { id: 'r2', name: 'Arusha HC', facility_code: 'DUP', region: 'Arusha', district: 'Kondoa' },
    { id: 'r3', name: 'Arumeru HC', facility_code: 'DUP', region: 'Arusha', district: 'Arumeru' },
    { id: 'r4', name: 'Dodoma Lab', facility_code: 'LAB-4', region: 'Dodoma', district: 'Chamwino' },
  ];
  const deps = { registryRows: async () => registry };

  it('is undefined for Everything, so no limit is added', async () => {
    expect(await resolveDataScope(deps, { limited: false })).toBeUndefined();
  });

  it('keeps the lists and adds the register codes of every in-scope facility, by id, region or district', async () => {
    const r = await resolveDataScope(deps, { limited: true, facilities: ['r3'], districts: [{ region: 'Arusha', district: 'Kondoa' }], regions: [] });
    expect(r).toEqual({
      registryIds: ['r3'], regions: [], districts: [{ region: 'Arusha', district: 'Kondoa' }],
      registryCodes: ['r2', 'r3'],
    });
    const dodoma = await resolveDataScope(deps, { limited: true, facilities: [], districts: [], regions: ['Dodoma'] });
    expect(dodoma?.registryCodes).toEqual(['FAC-1', 'LAB-4']);
  });

  it('keeps a district to its own region', async () => {
    const r = await resolveDataScope(deps, { limited: true, facilities: [], districts: [{ region: 'Dodoma', district: 'Kondoa' }], regions: [] });
    expect(r?.registryCodes).toEqual(['FAC-1']);
  });

  it('resolves Limited with nothing listed to nothing', async () => {
    expect(await resolveDataScope(deps, { limited: true, facilities: [], districts: [], regions: [] }))
      .toEqual({ registryIds: [], regions: [], districts: [], registryCodes: [] });
  });
});

describe('dataScopeChoices', () => {
  it('lists regions, districts with their region, and facilities, sorted, each once, skipping blanks', () => {
    const rows = [
      { id: 'r2', name: 'B clinic', facility_code: 'B', region: 'Arusha', district: 'Kondoa' },
      { id: 'r1', name: 'A clinic', facility_code: 'A', region: 'Dodoma', district: 'Kondoa' },
      { id: 'r3', name: 'C clinic', facility_code: 'C', region: 'Dodoma', district: 'Kondoa' },
      { id: 'r4', name: 'D clinic', facility_code: 'D', region: null, district: ' ' },
    ];
    expect(dataScopeChoices(rows)).toEqual({
      regions: ['Arusha', 'Dodoma'],
      districts: [{ region: 'Arusha', district: 'Kondoa' }, { region: 'Dodoma', district: 'Kondoa' }],
      facilities: [
        { id: 'r1', name: 'A clinic', region: 'Dodoma', district: 'Kondoa' },
        { id: 'r2', name: 'B clinic', region: 'Arusha', district: 'Kondoa' },
        { id: 'r3', name: 'C clinic', region: 'Dodoma', district: 'Kondoa' },
        { id: 'r4', name: 'D clinic', region: null, district: null },
      ],
    });
  });
});

// Review E1: MSSQL takes at most 2100 bound values. A region of the register can hold over a thousand
// facilities, so only the register codes studio orders really carry are bound, and one limit lists
// at most MAX_SCOPE_PLACES places.
describe('the data limit stays within MSSQL\'s bound values', () => {
  const big = Array.from({ length: 1200 }, (_, i) => ({ id: `r${i}`, name: `HC ${i}`, facility_code: `C${i}`, region: 'Big', district: 'D' }));

  it('binds only the register codes the warehouse uses', async () => {
    const r = await resolveDataScope({ registryRows: async () => big, usedRegistryCodes: async () => ['C7', 'C11', 'NOT-IN-SCOPE'] },
      { limited: true, facilities: [], districts: [], regions: ['Big'] });
    expect(r?.registryCodes).toEqual(['C11', 'C7']);
  });

  it('refuses a limit that lists more than MAX_SCOPE_PLACES places, and saves nothing', async () => {
    const store = memStore();
    const many = Array.from({ length: MAX_SCOPE_PLACES + 1 }, (_, i) => `r${i}`);
    const err = await setUserDataScope({ ...deps(store), facilityRegistry: { async get() { return {}; }, async list() { return { total: 1 }; } } },
      'kc-sub', { limited: true, facilities: many, districts: [], regions: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(DataScopeError);
    expect(err.reason).toBe('too-many');
    expect(store.saved.size).toBe(0);
  });
});

describe('facilityIdsInScope (plugin host ruling 5)', () => {
  const rows = [
    { id: 'FAC-1', name: 'One', facility_code: null, region: 'Dodoma', district: 'Kondoa' },
    { id: 'fac-2', name: 'Two', facility_code: null, region: 'Dodoma', district: 'Chamwino' },
    { id: 'fac-3', name: 'Three', facility_code: null, region: 'Arusha', district: 'Kondoa' },
    { id: 'fac-4', name: 'Four', facility_code: null, region: null, district: null },
  ];
  const limited = (over: Partial<Extract<DataScope, { limited: true }>>): DataScope =>
    ({ limited: true, facilities: [], districts: [], regions: [], ...over });

  it('is * for Everything', () => {
    expect(facilityIdsInScope(rows, { limited: false })).toBe('*');
  });
  it('gives a listed facility, lowercased, even one the register no longer holds', () => {
    expect(facilityIdsInScope(rows, limited({ facilities: ['FAC-4', 'Gone'] }))).toEqual(['fac-4', 'gone']);
  });
  it('gives every facility in a listed district, matched with its region', () => {
    expect(facilityIdsInScope(rows, limited({ districts: [{ region: 'Dodoma', district: 'Kondoa' }] }))).toEqual(['fac-1']);
  });
  it('gives every facility in a listed region, joined with the listed ones', () => {
    expect(facilityIdsInScope(rows, limited({ regions: ['Dodoma'], facilities: ['fac-3'] }))).toEqual(['fac-1', 'fac-2', 'fac-3']);
  });
  it('is an empty list, never *, when the limit covers nothing', () => {
    expect(facilityIdsInScope(rows, limited({}))).toEqual([]);
    expect(facilityIdsInScope(rows, limited({ regions: ['Nowhere'] }))).toEqual([]);
  });
});
