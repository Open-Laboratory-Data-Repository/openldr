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

async function world() {
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
  });
  return { db, store, service };
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
