import { describe, it, expect } from 'vitest';
import {
  registerLocalSystem, registerValueSetUrl, valueSetForField, addRegisterFacilityType,
  FacilityTypeCollisionError,
} from './facility-register-vocabulary';

const SYSTEM = 'urn:zmb:mfl';
const SHARED_VS = 'urn:openldr:valueset:facility-type';
const LOCAL_SYS = 'urn:openldr:cs:facility-type:local:urn_zmb_mfl';
const LOCAL_VS = 'urn:openldr:valueset:facility-type:urn_zmb_mfl';

/** `valueSets` maps url to the concepts its expansion yields. A url absent from it does not exist. */
function fakeAdmin(valueSets: Record<string, { code: string; display: string | null }[]> = {}) {
  const savedValueSets: any[] = [];
  const savedSystems: any[] = [];
  const createdTerms: any[] = [];
  return {
    savedValueSets, savedSystems, createdTerms, valueSetsByUrl: valueSets,
    valueSets: {
      getByUrl: async (url: string) => (url in valueSets ? { id: url, url } : null),
      expand: async (id: string) => ({ codes: (valueSets[id] ?? []).map((c) => ({ ...c, system: LOCAL_SYS })), total: 0 }),
      save: async (i: any) => { savedValueSets.push(i); valueSets[i.url] = valueSets[i.url] ?? []; return { id: i.url, ...i }; },
    },
    codingSystems: { upsertByUrl: async (i: any) => { savedSystems.push(i); } },
    terms: { create: async (i: any) => { createdTerms.push(i); return i; } },
  } as any;
}

describe('the register-scoped names', () => {
  it('puts a register\'s own concepts in a system the raw values cannot be confused with', () => {
    expect(registerLocalSystem(SYSTEM)).toBe(LOCAL_SYS);
    expect(registerValueSetUrl(SYSTEM)).toBe(LOCAL_VS);
  });
});

describe('valueSetForField', () => {
  it('uses the shared set for a register that has never added anything', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [{ code: 'health-center', display: 'Health Center' }] });
    expect(await valueSetForField(admin, 'level', SYSTEM)).toBe(SHARED_VS);
  });

  it('uses the register\'s own set once it exists', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [], [LOCAL_VS]: [] });
    expect(await valueSetForField(admin, 'level', SYSTEM)).toBe(LOCAL_VS);
  });

  // level is the only field that can grow a register set, so the other two never look for one.
  it('never looks for a register set for status or country', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [] });
    expect(await valueSetForField(admin, 'status', SYSTEM)).toBe('urn:openldr:valueset:location-status');
    expect(await valueSetForField(admin, 'country', SYSTEM)).toBe('urn:openldr:valueset:country');
  });
});

describe('addRegisterFacilityType', () => {
  it('creates the system, the value set and the concept on the first add', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [{ code: 'health-center', display: 'Health Center' }] });

    const res = await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'First-aid stations' });

    expect(res).toEqual({ code: 'first-aid-stations', system: LOCAL_SYS, valueSetUrl: LOCAL_VS });
    expect(admin.savedSystems[0]).toMatchObject({ url: LOCAL_SYS });
    expect(admin.createdTerms[0]).toMatchObject({
      system: LOCAL_SYS, code: 'first-aid-stations', display: 'First-aid stations', status: 'ACTIVE',
    });
  });

  // ⛔ TWO CLAUSES. One clause naming both would expand to their intersection, which is empty.
  // ⛔ NOT A SYSTEM SEED. `upsertByUrl` defaults to `seeded: true`, and a seeded system with no
  // ingest job is permanently undeletable. A live check found the container outliving everything in
  // it: the operator could delete the type they added and the value set, and was then stuck with an
  // empty coding system forever. This system is the operator's, so they can remove it.
  it('creates the register system as not seeded, so an operator can delete it again', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [] });

    await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'First-aid stations' });

    expect(admin.savedSystems[0]).toMatchObject({ url: LOCAL_SYS, seeded: false });
  });

  it('composes the register set as two include clauses, imported set and own system', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [] });

    await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'First-aid stations' });

    expect(admin.savedValueSets[0].compose).toEqual({
      include: [{ valueSet: [SHARED_VS] }, { system: LOCAL_SYS }],
    });
  });

  it('does not rewrite the value set on a later add', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [], [LOCAL_VS]: [] });

    await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'First-aid stations' });

    expect(admin.savedValueSets).toEqual([]);
    expect(admin.createdTerms).toHaveLength(1);
  });

  it('derives the code and never lets the caller choose it', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [] });
    const res = await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: '  Optic   Clinics!! ' });
    expect(res.code).toBe('optic-clinics');
  });

  it('suffixes a code already taken when nothing collides', async () => {
    const admin = fakeAdmin({
      [SHARED_VS]: [],
      [LOCAL_VS]: [{ code: 'optic-clinics', display: null }],
    });

    // Key is `optic clinics`, which nothing claims. The derived slug `optic-clinics` is taken, so
    // the code gets a suffix and the display is free to stand on its own.
    const res = await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'Optic Clinics' });

    expect(res.code).toBe('optic-clinics-2');
  });

  // ⛔ THE SILENT FAILURE THIS GUARD EXISTS FOR. Two concepts whose displays normalise alike poison
  // that key, and BOTH values stop resolving with no error anywhere.
  it('refuses a display that normalises onto one already in the list', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [{ code: 'health-center', display: 'Health Center' }] });

    await expect(addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'Health Centre' }))
      .rejects.toBeInstanceOf(FacilityTypeCollisionError);
  });

  // ⛔ THE CODE HALF OF THE GUARD. `byKey` indexes a concept by its CODE as well as its display, so
  // a display that normalises onto an existing CODE poisons that key just as surely. Dropping this
  // comparison passes every display-only test and still lets the silent failure through.
  it('refuses a display that normalises onto an existing code', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [{ code: 'health-post', display: null }] });

    await expect(addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'Health-Post' }))
      .rejects.toBeInstanceOf(FacilityTypeCollisionError);
  });

  // ⛔ THE MIRROR OF THE DISPLAY GUARD. `codeFor` hyphenates where `normaliseControlledValue` does
  // not, so a display that clears the refusal can still MINT a code whose normalised form is
  // already claimed by another concept's display. That poisons the key from the code side.
  it('suffixes a code whose normalised form an existing display already claims', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [{ code: 'abc', display: 'Widget-Shop' }] });

    const res = await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'Widget Shop' });

    expect(res.code).toBe('widget-shop-2');
  });

  it('names what it collided with, so the operator can map to it instead', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [{ code: 'health-center', display: 'Health Center' }] });

    const err = await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'health centre' })
      .catch((e) => e as FacilityTypeCollisionError) as FacilityTypeCollisionError;

    expect(err.collidesWith).toEqual({ code: 'health-center', display: 'Health Center' });
  });

  it('refuses a display that is only punctuation, because it has no code', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [] });
    await expect(addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: '!!!' }))
      .rejects.toThrow(/needs at least one letter or digit/i);
  });
});
