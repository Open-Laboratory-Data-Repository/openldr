import { describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFormEntryStore, FormEntryRepeat, type InternalSchema } from '@openldr/db';
import type { FormSchema } from '@openldr/forms';
import type { DataScope } from '@openldr/rbac';
import { createFormEntriesService, EntrySiteError, repeatMessage } from './form-entries';
import { readScopeRegistryRows } from './data-scope';

const NOW = '2026-01-01T00:00:00.000Z';
const REGISTRY = 'urn:openldr:cs:facility-registry';

function field(over: Record<string, unknown>) {
  return {
    fhirPath: null, description: null, fieldType: 'text', required: false, enabled: true,
    cardinality: { min: 0, max: '1' }, section: 'main', ...over,
  };
}

/** A requisition form: a number, a facility field, and a patient name for the summary. */
function orderForm(facility: 'register' | 'free-text' | 'none'): FormSchema {
  const fields: Record<string, unknown>[] = [
    field({ id: 'num', displayLabel: 'Requisition', order: 0, fhirPath: 'ServiceRequest.identifier.value' }),
    field({ id: 'name', displayLabel: 'Patient', order: 2 }),
  ];
  if (facility !== 'none') {
    fields.push(field({
      id: 'fac', displayLabel: 'Facility', fieldType: 'facility', order: 1,
      fhirPath: 'ServiceRequest.requester', fhirDiscriminator: { type: 'Organization' },
      ...(facility === 'register' ? { referenceTarget: REGISTRY } : {}),
    }));
  }
  return {
    id: 'order', name: 'Order', versionLabel: null, fhirVersion: null, fhirResourceType: 'ServiceRequest',
    fhirProfileUrl: null, facilityId: null, fields, sections: [{ id: 'main', label: 'Main', order: 0 }],
    targetPages: [], languages: ['en'], version: 1, active: true, status: 'draft', createdAt: NOW, updatedAt: NOW,
  } as unknown as FormSchema;
}

const limit = (over: Partial<Extract<DataScope, { limited: true }>>): DataScope =>
  ({ limited: true, facilities: [], districts: [], regions: [], ...over });

/** What the void path reads, sends and audits. `records` stands in for the FHIR store. */
interface VoidFakes {
  records: Map<string, Record<string, unknown>>;
  runs: { workflowId: string; source: string; input: any }[];
  audits: { actor: unknown; details: any }[];
  logs: { level: string; obj: any; msg: string }[];
  /** What the next run answers. Left out, the run completes. */
  outcome?: () => unknown;
}

async function world() {
  const fakes: VoidFakes = { records: new Map(), runs: [], audits: [], logs: [] };
  const db = await makeMigratedDb();
  const add = (id: string, code: string, name: string, region: string | null, district: string | null) =>
    db.insertInto('facility_registry').values({
      id, facility_system: 'urn:test:mfl', facility_code: code, name, region, district,
      extras: '{}', source: 'test', created_at: NOW, updated_at: NOW,
    } as never).execute();
  // reg-a and reg-b are in Coast; reg-c is in Lake. reg-c's code is unique, so it projects as its code.
  await add('reg-a', 'A1', 'Site A', 'Coast', 'Kibaha');
  await add('reg-b', 'B1', 'Site B', 'Coast', 'Bagamoyo');
  await add('reg-c', 'C1', 'Site C', 'Lake', 'Mwanza');
  const store = createFormEntryStore(db as unknown as Kysely<InternalSchema>);
  const service = createFormEntriesService({
    store, registryRows: () => readScopeRegistryRows(db as unknown as Kysely<InternalSchema>),
    fhir: {
      get: async (type, id) => {
        if (id === 'broken') throw new Error('db gone');
        const r = fakes.records.get(`${type}/${id}`);
        return r ? (structuredClone(r) as never) : null;
      },
    },
    runner: {
      runAndRecord: async (workflowId, source, input) => {
        fakes.runs.push({ workflowId, source, input });
        if (fakes.outcome) return fakes.outcome() as never;
        return { runId: 'run-1', correlationId: null, status: 'completed', error: null, nodeMeta: {} };
      },
    },
    audit: async (actor, details) => { fakes.audits.push({ actor, details }); },
    logger: {
      warn: (obj: any, msg: string) => { fakes.logs.push({ level: 'warn', obj, msg }); },
      error: (obj: any, msg: string) => { fakes.logs.push({ level: 'error', obj, msg }); },
    } as never,
  });
  return { db, store, service, fakes };
}

/** The coding a register facility field saves: the register concept code. */
const pick = (code: string, display?: string) => ({ system: REGISTRY, code, ...(display ? { display } : {}) });

const user = (dataScope: DataScope, id = 'u1') => ({ id, name: 'Clerk One', dataScope });

async function siteError(p: Promise<unknown>): Promise<EntrySiteError> {
  try { await p; } catch (err) {
    expect(err).toBeInstanceOf(EntrySiteError);
    return err as EntrySiteError;
  }
  throw new Error('expected EntrySiteError, but the entry was written');
}

describe('form entries service: facilityIdsOf', () => {
  it('gives null for a user with no limit', async () => {
    const { db, service } = await world();
    expect(await service.facilityIdsOf({ limited: false })).toBeNull();
    await db.destroy();
  });

  it('turns listed facilities, districts and regions into register row ids, read from the register', async () => {
    const { db, service } = await world();
    expect(await service.facilityIdsOf(limit({ facilities: ['reg-c'] }))).toEqual(['reg-c']);
    expect((await service.facilityIdsOf(limit({ regions: ['Coast'] })))!.sort()).toEqual(['reg-a', 'reg-b']);
    expect(await service.facilityIdsOf(limit({ districts: [{ region: 'Coast', district: 'Bagamoyo' }] }))).toEqual(['reg-b']);
    expect(await service.facilityIdsOf(limit({}))).toEqual([]);
    await db.destroy();
  });
});

describe('form entries service: begin', () => {
  it('writes an active row with the register row id, the number, the summary and who entered it', async () => {
    const { db, service, store } = await world();
    const entry = await service.begin({
      form: { id: 'form-1', schema: orderForm('register') },
      answers: { num: ' CS-0001 ', fac: pick('A1', 'Site A'), name: 'Amina J.' },
      user: user({ limited: false }),
    });
    expect(entry).toMatchObject({
      formId: 'form-1', facilityId: 'reg-a', facilityCode: 'A1', facilityName: 'Site A', entryKey: 'CS-0001',
      enteredBy: 'u1', enteredByName: 'Clerk One', status: 'active', saved: null,
    });
    expect(entry.summary).toContainEqual({ label: 'Patient', value: 'Amina J.' });
    expect(await store.get(entry.id)).toEqual(entry);
    await db.destroy();
  });

  it('keeps the code and name but no row id when the picked code matches no register row', async () => {
    const { db, service } = await world();
    const entry = await service.begin({
      form: { id: 'form-1', schema: orderForm('register') },
      answers: { num: 'CS-1', fac: pick('GONE', 'Old site') },
      user: user({ limited: false }),
    });
    expect(entry).toMatchObject({ facilityId: null, facilityCode: 'GONE', facilityName: 'Old site' });
    await db.destroy();
  });

  it('lets a limited user enter a facility inside the limit, named by district', async () => {
    const { db, service } = await world();
    const entry = await service.begin({
      form: { id: 'form-1', schema: orderForm('register') },
      answers: { num: 'CS-1', fac: pick('B1') },
      user: user(limit({ districts: [{ region: 'Coast', district: 'Bagamoyo' }] })),
    });
    expect(entry.facilityId).toBe('reg-b');
    await db.destroy();
  });

  it('refuses a limited user whose limit names no facility, on any form', async () => {
    const { db, service, store } = await world();
    for (const kind of ['register', 'none'] as const) {
      const err = await siteError(service.begin({
        form: { id: 'form-1', schema: orderForm(kind) }, answers: { num: 'CS-1', fac: pick('A1') }, user: user(limit({})),
      }));
      expect(err.message).toBe('your data limit names no facility, so you cannot enter this form');
      expect(err.reason).toBe('empty-limit');
    }
    // A region with nothing in the register covers no facility either.
    const err = await siteError(service.begin({
      form: { id: 'form-1', schema: orderForm('register') }, answers: { num: 'CS-1', fac: pick('A1') },
      user: user(limit({ regions: ['Nowhere'] })),
    }));
    expect(err.reason).toBe('empty-limit');
    expect((await store.list({ formId: 'form-1', limit: 10, offset: 0 })).total).toBe(0);
    await db.destroy();
  });

  it('refuses a limited user on a form whose facility field is free text', async () => {
    const { db, service, store } = await world();
    const err = await siteError(service.begin({
      form: { id: 'form-1', schema: orderForm('free-text') }, answers: { num: 'CS-1', fac: 'Site A' },
      user: user(limit({ facilities: ['reg-a'] })),
    }));
    expect(err.message).toBe("this form's facility field is free text, so it cannot be used by a user limited to a site");
    expect(err.reason).toBe('free-text-facility');
    expect((await store.list({ formId: 'form-1', limit: 10, offset: 0 })).total).toBe(0);
    await db.destroy();
  });

  it('refuses a limited user naming a facility outside the limit, or naming none, or one not in the register', async () => {
    const { db, service, store } = await world();
    const scope = limit({ facilities: ['reg-a'] });
    for (const fac of [pick('C1'), undefined, pick('GONE')]) {
      const err = await siteError(service.begin({
        form: { id: 'form-1', schema: orderForm('register') }, answers: { num: 'CS-1', ...(fac ? { fac } : {}) }, user: user(scope),
      }));
      expect(err.message).toBe('this entry names a facility outside your limit');
      expect(err.reason).toBe('outside-limit');
    }
    expect((await store.list({ formId: 'form-1', limit: 10, offset: 0 })).total).toBe(0);
    await db.destroy();
  });

  it('lets a limited user enter a form with no facility field, and the entry has no facility', async () => {
    const { db, service } = await world();
    const entry = await service.begin({
      form: { id: 'form-1', schema: orderForm('none') }, answers: { num: 'CS-1' }, user: user(limit({ facilities: ['reg-a'] })),
    });
    expect(entry).toMatchObject({ facilityId: null, facilityCode: null, entryKey: 'CS-1' });
    await db.destroy();
  });

  it('lets an unlimited user enter a free-text facility and keeps the typed name for display', async () => {
    const { db, service } = await world();
    const entry = await service.begin({
      form: { id: 'form-1', schema: orderForm('free-text') }, answers: { num: 'CS-1', fac: ' Kibaha clinic ' }, user: user({ limited: false }),
    });
    expect(entry).toMatchObject({ facilityId: null, facilityCode: null, facilityName: 'Kibaha clinic' });
    await db.destroy();
  });

  it('refuses a repeated number at the same site with FormEntryRepeat, and allows it at another site', async () => {
    const { db, service } = await world();
    const input = { form: { id: 'form-1', schema: orderForm('register') }, answers: { num: 'CS-1', fac: pick('A1') }, user: user({ limited: false }) };
    const first = await service.begin(input);
    await expect(service.begin(input)).rejects.toBeInstanceOf(FormEntryRepeat);
    await expect(service.begin(input)).rejects.toMatchObject({ existing: { id: first.id } });
    const other = await service.begin({ ...input, answers: { num: 'CS-1', fac: pick('B1') } });
    expect(other.facilityId).toBe('reg-b');
    await db.destroy();
  });
});

describe('form entries service: a form with two facility fields', () => {
  /** The order form with a second register facility field after the first. */
  function twoFacilities(): FormSchema {
    const base = orderForm('register') as unknown as { fields: Record<string, unknown>[] };
    return {
      ...base,
      fields: [...base.fields, field({
        id: 'fac2', displayLabel: 'Second facility', fieldType: 'facility', order: 3,
        fhirPath: 'ServiceRequest.requester', fhirDiscriminator: { type: 'Organization' }, referenceTarget: REGISTRY,
      })],
    } as unknown as FormSchema;
  }

  it('refuses a limited user when the second field names a facility outside the limit', async () => {
    const { db, service, store } = await world();
    const err = await siteError(service.begin({
      form: { id: 'form-1', schema: twoFacilities() },
      answers: { num: 'CS-1', fac: pick('A1'), fac2: pick('C1') },
      user: user(limit({ facilities: ['reg-a'] })),
    }));
    expect(err.message).toBe('this entry names a facility outside your limit');
    expect((await store.list({ formId: 'form-1', limit: 10, offset: 0 })).total).toBe(0);
    await db.destroy();
  });

  it('refuses a limited user when the second field is typed into, even with the first inside the limit', async () => {
    const { db, service } = await world();
    const err = await siteError(service.begin({
      form: { id: 'form-1', schema: twoFacilities() },
      answers: { num: 'CS-1', fac: pick('A1'), fac2: 'Somewhere else' },
      user: user(limit({ facilities: ['reg-a'] })),
    }));
    expect(err.reason).toBe('outside-limit');
    await db.destroy();
  });

  it('lets a limited user through when both fields are inside the limit', async () => {
    const { db, service } = await world();
    const entry = await service.begin({
      form: { id: 'form-1', schema: twoFacilities() },
      answers: { num: 'CS-1', fac: pick('A1'), fac2: pick('B1') },
      user: user(limit({ regions: ['Coast'] })),
    });
    expect(entry.facilityId).toBe('reg-b');
    await db.destroy();
  });

  it('leaves an unlimited user alone, and the entry names the facility the order carries: the last answered', async () => {
    const { db, service } = await world();
    const entry = await service.begin({
      form: { id: 'form-1', schema: twoFacilities() },
      answers: { num: 'CS-1', fac: pick('A1', 'Site A'), fac2: pick('C1', 'Site C') },
      user: user({ limited: false }),
    });
    expect(entry).toMatchObject({ facilityId: 'reg-c', facilityCode: 'C1', facilityName: 'Site C' });
    await db.destroy();
  });
});

describe('form entries service: a form with two requisition number fields', () => {
  function twoNumbers(): FormSchema {
    const base = orderForm('register') as unknown as { fields: Record<string, unknown>[] };
    return {
      ...base,
      fields: [...base.fields, field({ id: 'num2', displayLabel: 'Second number', order: 3, fhirPath: 'ServiceRequest.identifier' })],
    } as unknown as FormSchema;
  }

  it('keys the entry on the number the order carries, and refuses that number again', async () => {
    const { db, service } = await world();
    const input = { form: { id: 'form-1', schema: twoNumbers() }, answers: { num: 'CS-1', num2: 'CS-2', fac: pick('A1') }, user: user({ limited: false }) };
    const entry = await service.begin(input);
    expect(entry.entryKey).toBe('CS-2');
    // A different first number does not dodge the check: the order carries CS-2 again.
    await expect(service.begin({ ...input, answers: { num: 'CS-9', num2: 'CS-2', fac: pick('A1') } })).rejects.toBeInstanceOf(FormEntryRepeat);
    await db.destroy();
  });
});

describe('form entries service: finish', () => {
  const saved = { responseId: 'qr-1', resources: [{ resourceType: 'ServiceRequest', id: 'sr-1' }] };

  async function begun() {
    const w = await world();
    const entry = await w.service.begin({
      form: { id: 'form-1', schema: orderForm('register') }, answers: { num: 'CS-1', fac: pick('A1') }, user: user({ limited: false }),
    });
    return { ...w, entry };
  }

  it('a completed save leaves the row active, with what it saved', async () => {
    const { db, service, entry } = await begun();
    const after = await service.finish(entry.id, { ok: true, stored: saved });
    expect(after).toMatchObject({ id: entry.id, status: 'active', saved });
    await db.destroy();
  });

  it('a failed save that stored nothing removes the row, and the number is free again', async () => {
    const { db, service, store, entry } = await begun();
    expect(await service.finish(entry.id, { ok: false, stored: { responseId: null, resources: [] } })).toBeNull();
    expect(await store.get(entry.id)).toBeNull();
    const again = await service.begin({
      form: { id: 'form-1', schema: orderForm('register') }, answers: { num: 'CS-1', fac: pick('A1') }, user: user({ limited: false }),
    });
    expect(again.status).toBe('active');
    await db.destroy();
  });

  it('a failed save that stored something leaves the row incomplete, and it still holds the number', async () => {
    const { db, service, entry } = await begun();
    const after = await service.finish(entry.id, { ok: false, stored: saved });
    expect(after).toMatchObject({ status: 'incomplete', saved });
    await expect(service.begin({
      form: { id: 'form-1', schema: orderForm('register') }, answers: { num: 'CS-1', fac: pick('A1') }, user: user({ limited: false }),
    })).rejects.toBeInstanceOf(FormEntryRepeat);
    await db.destroy();
  });

  it('a failed save known to have stored something, with no ids found, still leaves the row incomplete', async () => {
    const { db, service, entry } = await begun();
    const after = await service.finish(entry.id, { ok: false, stored: { responseId: null, resources: [] }, somethingStored: true });
    expect(after).toMatchObject({ status: 'incomplete', saved: { responseId: null, resources: [] } });
    await db.destroy();
  });
});

describe('repeatMessage', () => {
  const entry = { entryKey: 'CS-0001', enteredAt: '2026-11-22T10:50:00.000Z', enteredByName: 'aisha' };

  it('says the number, the date, the time and who, in UTC when no zone is set', () => {
    expect(repeatMessage(entry)).toBe('CS-0001 was already entered on 22 Nov 2026 at 10:50 by aisha.');
  });

  it('uses the lab time zone when one is set, and falls back to UTC for a bad one', () => {
    expect(repeatMessage(entry, 'Africa/Dar_es_Salaam')).toBe('CS-0001 was already entered on 22 Nov 2026 at 13:50 by aisha.');
    expect(repeatMessage(entry, 'Not/AZone')).toBe('CS-0001 was already entered on 22 Nov 2026 at 10:50 by aisha.');
  });

  it('does not end on two full stops when the name ends with one', () => {
    expect(repeatMessage({ ...entry, enteredByName: 'Aisha M.' })).toBe('CS-0001 was already entered on 22 Nov 2026 at 10:50 by Aisha M.');
  });
});

describe('form entries service: list and get', () => {
  /** Entries on form-1: one at site A by u1, one at site B by u2, one at site C by u1, one with no
   *  facility by u2. Written straight to the store, as begin would leave them. */
  async function seeded() {
    const w = await world();
    const add = (facilityId: string | null, entryKey: string, enteredBy: string) => w.store.create({
      formId: 'form-1', facilityId, facilityCode: null, facilityName: null, entryKey, summary: [],
      enteredBy, enteredByName: enteredBy,
    });
    const a = await add('reg-a', 'CS-A', 'u1');
    const b = await add('reg-b', 'CS-B', 'u2');
    const c = await add('reg-c', 'CS-C', 'u1');
    const none = await add(null, 'CS-N', 'u2');
    await w.store.create({ formId: 'form-2', facilityId: 'reg-a', facilityCode: null, facilityName: null, entryKey: 'X', summary: [], enteredBy: 'u1', enteredByName: 'u1' });
    return { ...w, a, b, c, none };
  }
  const keys = (r: { entries: { entryKey: string | null }[] }) => r.entries.map((e) => e.entryKey).sort();
  const page = { limit: 25, offset: 0 };

  it('shows an unlimited user every entry of the form, and only that form', async () => {
    const { db, service } = await seeded();
    const r = await service.list({ formId: 'form-1', user: { id: 'u9', dataScope: { limited: false } }, ...page });
    expect(keys(r)).toEqual(['CS-A', 'CS-B', 'CS-C', 'CS-N']);
    expect(r.total).toBe(4);
    await db.destroy();
  });

  it('shows a limited user the entries inside the limit and the ones they made, nothing else', async () => {
    const { db, service } = await seeded();
    // u2 limited to site A: site A's entry, and u2's own site B and no-facility entries.
    const r = await service.list({ formId: 'form-1', user: { id: 'u2', dataScope: limit({ facilities: ['reg-a'] }) }, ...page });
    expect(keys(r)).toEqual(['CS-A', 'CS-B', 'CS-N']);
    expect(r.total).toBe(3);
    // u3 limited to site B by district: site B only.
    const d = await service.list({ formId: 'form-1', user: { id: 'u3', dataScope: limit({ districts: [{ region: 'Coast', district: 'Bagamoyo' }] }) }, ...page });
    expect(keys(d)).toEqual(['CS-B']);
    await db.destroy();
  });

  it('shows a limited user whose limit covers no facility only their own entries', async () => {
    const { db, service } = await seeded();
    expect(keys(await service.list({ formId: 'form-1', user: { id: 'u1', dataScope: limit({}) }, ...page }))).toEqual(['CS-A', 'CS-C']);
    expect(keys(await service.list({ formId: 'form-1', user: { id: 'u9', dataScope: limit({ regions: ['Nowhere'] }) }, ...page }))).toEqual([]);
    await db.destroy();
  });

  it('a filter for another person or site never widens what a limited user sees', async () => {
    const { db, service } = await seeded();
    const scope = limit({ facilities: ['reg-a'] });
    // u3 asks for u1's entries: only u1's entry at site A, never site C.
    expect(keys(await service.list({ formId: 'form-1', user: { id: 'u3', dataScope: scope }, enteredBy: 'u1', ...page }))).toEqual(['CS-A']);
    expect(keys(await service.list({ formId: 'form-1', user: { id: 'u3', dataScope: scope }, search: 'CS-C', ...page }))).toEqual([]);
    await db.destroy();
  });

  it('passes status, person, search and paging through', async () => {
    const { db, service, store, b } = await seeded();
    await store.void(b.id, { id: 'u9', reason: 'typo' });
    const all = { id: 'u9', dataScope: { limited: false } as DataScope };
    expect(keys(await service.list({ formId: 'form-1', user: all, status: 'entered-in-error', ...page }))).toEqual(['CS-B']);
    expect(keys(await service.list({ formId: 'form-1', user: all, enteredBy: 'u1', ...page }))).toEqual(['CS-A', 'CS-C']);
    expect(keys(await service.list({ formId: 'form-1', user: all, search: 'cs-n', ...page }))).toEqual(['CS-N']);
    const p = await service.list({ formId: 'form-1', user: all, limit: 1, offset: 1 });
    expect(p.entries).toHaveLength(1);
    expect(p.total).toBe(4);
    await db.destroy();
  });

  it('get gives a limited user an entry inside the limit or their own, and null for any other', async () => {
    const { db, service, a, b, c, none } = await seeded();
    const u2 = { id: 'u2', dataScope: limit({ facilities: ['reg-a'] }) };
    expect((await service.get(a.id, u2))?.id).toBe(a.id);
    expect((await service.get(b.id, u2))?.id).toBe(b.id);
    expect((await service.get(none.id, u2))?.id).toBe(none.id);
    expect(await service.get(c.id, u2)).toBeNull();
    expect(await service.get(c.id, { id: 'u2', dataScope: limit({}) })).toBeNull();
    expect((await service.get(c.id, { id: 'u9', dataScope: { limited: false } }))?.id).toBe(c.id);
    expect(await service.get('no-such-entry', { id: 'u9', dataScope: { limited: false } })).toBeNull();
    await db.destroy();
  });
});

describe('form entries service: context', () => {
  it('gives no facility and no choices to an unlimited user', async () => {
    const { db, service } = await world();
    expect(await service.context({ id: 'u1', dataScope: { limited: false } }))
      .toEqual({ facility: null, locked: false, choices: null });
    await db.destroy();
  });

  it('locks a limit that covers one facility, with the code the picker saves', async () => {
    const { db, service } = await world();
    const ctx = await service.context({ id: 'u1', dataScope: limit({ districts: [{ region: 'Coast', district: 'Kibaha' }] }) });
    expect(ctx).toEqual({ facility: { id: 'reg-a', code: 'A1', name: 'Site A' }, locked: true, choices: [{ id: 'reg-a', code: 'A1', name: 'Site A' }] });
    await db.destroy();
  });

  it('offers the facilities of a limit that covers several, by name, unlocked', async () => {
    const { db, service } = await world();
    expect(await service.context({ id: 'u1', dataScope: limit({ regions: ['Coast'], facilities: ['reg-c'] }) })).toEqual({
      facility: null, locked: false,
      choices: [{ id: 'reg-a', code: 'A1', name: 'Site A' }, { id: 'reg-b', code: 'B1', name: 'Site B' }, { id: 'reg-c', code: 'C1', name: 'Site C' }],
    });
    await db.destroy();
  });

  it('gives an empty list to a limited user whose limit covers nothing', async () => {
    const { db, service } = await world();
    expect(await service.context({ id: 'u1', dataScope: limit({ regions: ['Nowhere'] }) }))
      .toEqual({ facility: null, locked: false, choices: [] });
    await db.destroy();
  });

  it('gives the code the register maps a row to, which is the row id when two rows share a code', async () => {
    const { db, service } = await world();
    await db.insertInto('facility_registry').values({
      id: 'reg-d', facility_system: 'urn:test:other', facility_code: 'A1', name: 'Site D', region: 'Lake', district: 'Mwanza',
      extras: '{}', source: 'test', created_at: NOW, updated_at: NOW,
    } as never).execute();
    const ctx = await service.context({ id: 'u1', dataScope: limit({ facilities: ['reg-a'] }) });
    expect(ctx.facility).toEqual({ id: 'reg-a', code: 'reg-a', name: 'Site A' });
    await db.destroy();
  });
});

describe('form entries service: voidEntry', () => {
  const actor = { actorType: 'user' as const, actorId: 'u9', actorName: 'manager' };
  const everyone = { id: 'u9', dataScope: { limited: false } as DataScope };

  /** An entry settled as `status`, with these saved records held by the fake FHIR store. */
  async function settled(w: Awaited<ReturnType<typeof world>>, key: string, status: 'active' | 'incomplete', resources: { resourceType: string; id: string }[], responseId: string | null) {
    const e = await w.store.create({
      formId: 'form-1', facilityId: 'reg-a', facilityCode: 'A1', facilityName: 'Site A', entryKey: key,
      summary: [], enteredBy: 'u1', enteredByName: 'Clerk One',
    });
    return w.store.setSaved(e.id, { responseId, resources }, status);
  }
  const hold = (w: Awaited<ReturnType<typeof world>>, resourceType: string, id: string, status?: string) =>
    w.fakes.records.set(`${resourceType}/${id}`, { resourceType, id, ...(status ? { status } : {}), note: 'kept' });

  it('marks the row and re-saves every record as entered-in-error in one bundle', async () => {
    const w = await world();
    hold(w, 'QuestionnaireResponse', 'qr-1', 'completed');
    hold(w, 'ServiceRequest', 'sr-1', 'active');
    hold(w, 'Specimen', 'sp-1');
    hold(w, 'Observation', 'ob-1', 'final');
    hold(w, 'DiagnosticReport', 'dr-1', 'final');
    const e = await settled(w, 'CS-1', 'active', [
      { resourceType: 'ServiceRequest', id: 'sr-1' }, { resourceType: 'Specimen', id: 'sp-1' },
      { resourceType: 'Observation', id: 'ob-1' }, { resourceType: 'DiagnosticReport', id: 'dr-1' },
    ], 'qr-1');

    const r = await w.service.voidEntry({ entryId: e.id, reason: '  typed the wrong number  ', user: everyone, actor });
    if (typeof r === 'string') throw new Error(r);
    expect(r.entry).toMatchObject({ id: e.id, status: 'entered-in-error', statusBy: 'u9', statusReason: 'typed the wrong number' });
    expect(r).toMatchObject({ resaved: 5, skipped: 0 });
    expect(r.warning).toBeUndefined();

    expect(w.fakes.runs).toHaveLength(1);
    const run = w.fakes.runs[0]!;
    expect(run.workflowId).toBe('wf-ingest');
    expect(run.source).toBe('form');
    expect(run.input).toMatchObject({ method: 'POST', headers: {}, query: {}, __provenance: { sourceSystem: 'form-capture' } });
    expect(run.input.body).toMatchObject({ resourceType: 'Bundle', type: 'transaction' });
    const sent = run.input.body.entry as { resource: Record<string, unknown>; request: { method: string; url: string } }[];
    expect(sent.map((x) => x.request)).toEqual([
      { method: 'PUT', url: 'QuestionnaireResponse/qr-1' }, { method: 'PUT', url: 'ServiceRequest/sr-1' },
      { method: 'PUT', url: 'Specimen/sp-1' }, { method: 'PUT', url: 'Observation/ob-1' }, { method: 'PUT', url: 'DiagnosticReport/dr-1' },
    ]);
    // Only the status changes; the rest of each record is sent as stored.
    for (const x of sent) expect(x.resource).toMatchObject({ status: 'entered-in-error', note: 'kept' });
    await w.db.destroy();
  });

  it('audits form.entry.void with the row before and after and what was re-saved', async () => {
    const w = await world();
    hold(w, 'ServiceRequest', 'sr-1', 'active');
    const e = await settled(w, 'CS-1', 'active', [{ resourceType: 'ServiceRequest', id: 'sr-1' }], null);
    await w.service.voidEntry({ entryId: e.id, reason: 'typo', user: everyone, actor });
    expect(w.fakes.audits).toHaveLength(1);
    const a = w.fakes.audits[0]!;
    expect(a.actor).toEqual(actor);
    expect(a.details).toMatchObject({
      action: 'form.entry.void', entityType: 'form-entry', entityId: e.id,
      before: { id: e.id, status: 'active' }, after: { id: e.id, status: 'entered-in-error' },
      metadata: { reason: 'typo', resaved: 1, skipped: 0 },
    });
    expect(a.details.metadata).not.toHaveProperty('warning');
    await w.db.destroy();
  });

  it('skips and counts a record it cannot read, and a type whose status cannot be entered-in-error', async () => {
    const w = await world();
    hold(w, 'ServiceRequest', 'sr-1', 'active');
    hold(w, 'Patient', 'pt-1');
    const e = await settled(w, 'CS-1', 'active', [
      { resourceType: 'ServiceRequest', id: 'sr-1' }, { resourceType: 'Specimen', id: 'gone' },
      { resourceType: 'Observation', id: 'broken' }, { resourceType: 'Patient', id: 'pt-1' },
    ], 'qr-missing');
    const r = await w.service.voidEntry({ entryId: e.id, reason: 'typo', user: everyone, actor });
    if (typeof r === 'string') throw new Error(r);
    expect(r).toMatchObject({ resaved: 1, skipped: 4 });
    const sent = w.fakes.runs[0]!.input.body.entry as { request: { url: string } }[];
    expect(sent.map((x) => x.request.url)).toEqual(['ServiceRequest/sr-1']);
    await w.db.destroy();
  });

  it('keeps the row voided and says so when the re-save does not complete', async () => {
    for (const outcome of [
      () => ({ runId: 'run-2', correlationId: null, status: 'failed', error: 'boom', nodeMeta: {} }),
      () => null,
      () => ({ runId: 'run-3', correlationId: null, status: 'completed', error: null, nodeMeta: {}, held: { count: 1, reasons: ['no map'] } }),
      () => { throw new Error('run store down'); },
    ]) {
      const w = await world();
      w.fakes.outcome = outcome;
      hold(w, 'ServiceRequest', 'sr-1', 'active');
      const e = await settled(w, 'CS-1', 'active', [{ resourceType: 'ServiceRequest', id: 'sr-1' }], null);
      const r = await w.service.voidEntry({ entryId: e.id, reason: 'typo', user: everyone, actor });
      if (typeof r === 'string') throw new Error(r);
      expect(r.entry.status).toBe('entered-in-error');
      expect(r.resaved).toBe(0);
      expect(r.skipped).toBe(0);
      expect(r.warning).toMatch(/not updated/);
      expect((await w.store.get(e.id))!.status).toBe('entered-in-error');
      expect(w.fakes.audits[0]!.details.metadata).toMatchObject({ resaved: 0, warning: r.warning });
      await w.db.destroy();
    }
  });

  it('logs a record it cannot read and a run that throws, with the entry id', async () => {
    const w = await world();
    w.fakes.outcome = () => { throw new Error('run store down'); };
    hold(w, 'ServiceRequest', 'sr-1', 'active');
    const e = await settled(w, 'CS-1', 'active', [{ resourceType: 'ServiceRequest', id: 'sr-1' }, { resourceType: 'Observation', id: 'broken' }], null);
    await w.service.voidEntry({ entryId: e.id, reason: 'typo', user: everyone, actor });
    expect(w.fakes.logs.map((l) => [l.obj.entryId, l.obj.err?.message])).toEqual([[e.id, 'db gone'], [e.id, 'run store down']]);
    await w.db.destroy();
  });

  it('warns when an active entry does not know its records, and still marks it', async () => {
    const w = await world();
    // A completed save whose settle failed, or a save still running: active, with nothing recorded.
    const e = await w.store.create({
      formId: 'form-1', facilityId: 'reg-a', facilityCode: 'A1', facilityName: 'Site A', entryKey: 'CS-1',
      summary: [], enteredBy: 'u1', enteredByName: 'Clerk One',
    });
    const r = await w.service.voidEntry({ entryId: e.id, reason: 'typo', user: everyone, actor });
    if (typeof r === 'string') throw new Error(r);
    expect(r.entry.status).toBe('entered-in-error');
    expect(r).toMatchObject({ resaved: 0, skipped: 0 });
    expect(r.warning).toMatch(/records this entry made are not known, so they were not marked/);
    expect(w.fakes.runs).toHaveLength(0);
    expect(w.fakes.audits[0]!.details.metadata).toMatchObject({ warning: r.warning });
    await w.db.destroy();
  });

  it('a save that settles after the void keeps the entry voided and marks the records it stored', async () => {
    for (const ok of [true, false]) {
      const w = await world();
      const answers = { num: 'CS-1', fac: pick('A1', 'Site A') };
      const begun = await w.service.begin({ form: { id: 'form-1', schema: orderForm('register') }, answers, user: user({ limited: false }) });
      // Voided while the save runs: nothing is known yet.
      const v = await w.service.voidEntry({ entryId: begun.id, reason: 'typo', user: everyone, actor });
      expect(v).toMatchObject({ resaved: 0, warning: expect.stringMatching(/not known/) });

      hold(w, 'QuestionnaireResponse', 'qr-1', 'completed');
      hold(w, 'ServiceRequest', 'sr-1', 'active');
      const stored = { responseId: 'qr-1', resources: [{ resourceType: 'ServiceRequest', id: 'sr-1' }] };
      const after = await w.service.finish(begun.id, { ok, stored });
      expect(after, String(ok)).toMatchObject({ status: 'entered-in-error', statusReason: 'typo', saved: stored });
      expect((await w.store.get(begun.id))!.status).toBe('entered-in-error');
      expect(w.fakes.runs, String(ok)).toHaveLength(1);
      const sent = w.fakes.runs[0]!.input.body.entry as { resource: { status: string }; request: { url: string } }[];
      expect(sent.map((x) => [x.request.url, x.resource.status])).toEqual([
        ['QuestionnaireResponse/qr-1', 'entered-in-error'], ['ServiceRequest/sr-1', 'entered-in-error'],
      ]);
      expect(w.fakes.runs[0]!.input.__provenance).toEqual({ sourceSystem: 'form-capture' });
      await w.db.destroy();
    }
  });

  it('a voided entry whose late save stored nothing keeps its row', async () => {
    const w = await world();
    const begun = await w.service.begin({ form: { id: 'form-1', schema: orderForm('register') }, answers: { num: 'CS-1', fac: pick('A1') }, user: user({ limited: false }) });
    await w.service.voidEntry({ entryId: begun.id, reason: 'typo', user: everyone, actor });
    await w.service.finish(begun.id, { ok: false, stored: { responseId: null, resources: [] } });
    expect((await w.store.get(begun.id))!.status).toBe('entered-in-error');
    expect(w.fakes.runs).toHaveLength(0);
    await w.db.destroy();
  });

  it('answers already-void for an entry already marked, and changes nothing more', async () => {
    const w = await world();
    const e = await settled(w, 'CS-1', 'active', [], null);
    expect(typeof (await w.service.voidEntry({ entryId: e.id, reason: 'first', user: everyone, actor }))).toBe('object');
    expect(await w.service.voidEntry({ entryId: e.id, reason: 'second', user: everyone, actor })).toBe('already-void');
    expect((await w.store.get(e.id))!.statusReason).toBe('first');
    expect(w.fakes.audits).toHaveLength(1);
    await w.db.destroy();
  });

  it('voids an incomplete entry with no saved records without sending anything', async () => {
    const w = await world();
    const e = await settled(w, 'CS-1', 'incomplete', [], null);
    const r = await w.service.voidEntry({ entryId: e.id, reason: 'never finished', user: everyone, actor });
    expect(r).toMatchObject({ entry: { status: 'entered-in-error' }, resaved: 0, skipped: 0 });
    expect((r as { warning?: string }).warning).toBeUndefined();
    expect(w.fakes.runs).toHaveLength(0);
    await w.db.destroy();
  });

  it('answers not-found for a missing entry or one the user may not see, and leaves it alone', async () => {
    const w = await world();
    const e = await settled(w, 'CS-1', 'active', [], null);
    const outside = { id: 'u2', dataScope: limit({ facilities: ['reg-b'] }) };
    expect(await w.service.voidEntry({ entryId: e.id, reason: 'typo', user: outside, actor })).toBe('not-found');
    expect(await w.service.voidEntry({ entryId: 'no-such', reason: 'typo', user: everyone, actor })).toBe('not-found');
    expect((await w.store.get(e.id))!.status).toBe('active');
    expect(w.fakes.audits).toHaveLength(0);
    await w.db.destroy();
  });

  it('frees the number: the same requisition at the same site can be entered again', async () => {
    const w = await world();
    const answers = { num: 'CS-9', fac: pick('A1', 'Site A') };
    const first = await w.service.begin({ form: { id: 'form-1', schema: orderForm('register') }, answers, user: user({ limited: false }) });
    await expect(w.service.begin({ form: { id: 'form-1', schema: orderForm('register') }, answers, user: user({ limited: false }) }))
      .rejects.toBeInstanceOf(FormEntryRepeat);
    await w.service.voidEntry({ entryId: first.id, reason: 'typo', user: everyone, actor });
    const again = await w.service.begin({ form: { id: 'form-1', schema: orderForm('register') }, answers, user: user({ limited: false }) });
    expect(again.id).not.toBe(first.id);
    await w.db.destroy();
  });

  it('refuses an empty or too long reason before touching the row', async () => {
    const w = await world();
    const e = await settled(w, 'CS-1', 'active', [], null);
    await expect(w.service.voidEntry({ entryId: e.id, reason: '   ', user: everyone, actor })).rejects.toThrow(/reason/);
    await expect(w.service.voidEntry({ entryId: e.id, reason: 'x'.repeat(501), user: everyone, actor })).rejects.toThrow(/reason/);
    expect((await w.store.get(e.id))!.status).toBe('active');
    await w.db.destroy();
  });
});
