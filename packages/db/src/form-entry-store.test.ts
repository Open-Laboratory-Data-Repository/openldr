import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFormEntryStore, FormEntryRepeat, type NewFormEntry } from './form-entry-store';

async function world() {
  const db = await makeMigratedDb();
  return { db, store: createFormEntryStore(db as never) };
}

function entry(over: Partial<NewFormEntry> = {}): NewFormEntry {
  return {
    formId: 'form-1', facilityId: 'fac-1', facilityCode: 'F1', facilityName: 'Site one',
    entryKey: 'REQ-1', summary: [{ label: 'Patient', value: 'A' }],
    enteredBy: 'user-1', enteredByName: 'Clerk One', ...over,
  };
}

async function repeatOf(p: Promise<unknown>): Promise<FormEntryRepeat> {
  try { await p; } catch (err) {
    expect(err).toBeInstanceOf(FormEntryRepeat);
    return err as FormEntryRepeat;
  }
  throw new Error('expected FormEntryRepeat, but the entry saved');
}

describe('form entry store: one row per saved submission (migration 136)', () => {
  it('create_then_get_returns_the_entry', async () => {
    const { db, store } = await world();
    const made = await store.create(entry());
    expect(made).toMatchObject({
      formId: 'form-1', facilityId: 'fac-1', facilityCode: 'F1', facilityName: 'Site one',
      entryKey: 'REQ-1', summary: [{ label: 'Patient', value: 'A' }],
      enteredBy: 'user-1', enteredByName: 'Clerk One', status: 'active',
      statusBy: null, statusAt: null, statusReason: null, saved: null,
    });
    expect(typeof made.id).toBe('string');
    expect(Number.isNaN(Date.parse(made.enteredAt))).toBe(false);
    expect(await store.get(made.id)).toEqual(made);
    expect(await store.get('missing')).toBeNull();
    await db.destroy();
  });

  it('a_second_active_entry_with_the_same_form_facility_and_key_throws_the_repeat_carrying_the_first', async () => {
    const { db, store } = await world();
    const first = await store.create(entry());
    const err = await repeatOf(store.create(entry({ enteredBy: 'user-2', enteredByName: 'Clerk Two' })));
    expect(err.existing).toEqual(first);
    expect((await store.list({ formId: 'form-1', limit: 10, offset: 0 })).total).toBe(1);
    await db.destroy();
  });

  it('the_same_key_with_no_facility_repeats_too', async () => {
    const { db, store } = await world();
    const first = await store.create(entry({ facilityId: null, facilityCode: null, facilityName: null }));
    const err = await repeatOf(store.create(entry({ facilityId: null, facilityCode: null, facilityName: null })));
    expect(err.existing.id).toBe(first.id);
    await db.destroy();
  });

  it('the_same_key_at_another_facility_saves', async () => {
    const { db, store } = await world();
    await store.create(entry());
    await expect(store.create(entry({ facilityId: 'fac-2' }))).resolves.toMatchObject({ facilityId: 'fac-2' });
    await db.destroy();
  });

  it('the_same_key_on_another_form_saves', async () => {
    const { db, store } = await world();
    await store.create(entry());
    await expect(store.create(entry({ formId: 'form-2' }))).resolves.toMatchObject({ formId: 'form-2' });
    await db.destroy();
  });

  it('a_null_key_never_repeats', async () => {
    const { db, store } = await world();
    await store.create(entry({ entryKey: null }));
    await expect(store.create(entry({ entryKey: null }))).resolves.toMatchObject({ entryKey: null });
    await db.destroy();
  });

  it('after_void_the_key_saves_again', async () => {
    const { db, store } = await world();
    const first = await store.create(entry());
    const voided = await store.void(first.id, { id: 'user-9', reason: 'typed the wrong number' });
    expect(voided).toMatchObject({ status: 'entered-in-error', statusBy: 'user-9', statusReason: 'typed the wrong number' });
    expect(voided?.statusAt).toBeTruthy();
    const second = await store.create(entry());
    expect(second.status).toBe('active');
    const err = await repeatOf(store.create(entry()));
    expect(err.existing.id).toBe(second.id);
    await db.destroy();
  });

  it('two_creates_at_once_save_one_and_refuse_the_other_with_the_saved_one', async () => {
    const { db, store } = await world();
    const results = await Promise.allSettled([store.create(entry()), store.create(entry({ enteredBy: 'user-2' }))]);
    const saved = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof store.create>>> => r.status === 'fulfilled');
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(saved).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reason).toBeInstanceOf(FormEntryRepeat);
    expect((refused[0]!.reason as FormEntryRepeat).existing.id).toBe(saved[0]!.value.id);
    await db.destroy();
  });

  it('an_incomplete_entry_still_blocks_the_key', async () => {
    const { db, store } = await world();
    const first = await store.create(entry());
    const marked = await store.setSaved(first.id, { responseId: 'qr-1', resources: [] }, 'incomplete');
    expect(marked).toMatchObject({ status: 'incomplete', saved: { responseId: 'qr-1', resources: [] } });
    const err = await repeatOf(store.create(entry()));
    expect(err.existing.id).toBe(first.id);
    expect(err.existing.status).toBe('incomplete');
    await db.destroy();
  });

  it('setSaved_records_the_saved_ids', async () => {
    const { db, store } = await world();
    const first = await store.create(entry());
    const saved = { responseId: 'qr-1', resources: [{ resourceType: 'ServiceRequest', id: 'sr-1' }] };
    expect(await store.setSaved(first.id, saved, 'active')).toMatchObject({ status: 'active', saved });
    expect((await store.get(first.id))?.saved).toEqual(saved);
    await db.destroy();
  });

  it('remove_deletes_the_row_and_frees_the_key', async () => {
    const { db, store } = await world();
    const first = await store.create(entry());
    await store.remove(first.id);
    expect(await store.get(first.id)).toBeNull();
    await expect(store.create(entry())).resolves.toMatchObject({ status: 'active' });
    await db.destroy();
  });

  it('list_orders_newest_first_with_id_as_tiebreaker', async () => {
    const { db, store } = await world();
    const a = await store.create(entry({ entryKey: 'A' }));
    const b = await store.create(entry({ entryKey: 'B' }));
    const c = await store.create(entry({ entryKey: 'C' }));
    // Give a and c the same time, older than b, so only the id decides between them.
    await db.updateTable('form_entries').set({ entered_at: '2026-01-01T00:00:00.000Z' })
      .where('id', 'in', [a.id, c.id]).execute();
    await db.updateTable('form_entries').set({ entered_at: '2026-02-01T00:00:00.000Z' })
      .where('id', '=', b.id).execute();
    const tied = [a.id, c.id].sort().reverse();
    const page = await store.list({ formId: 'form-1', limit: 10, offset: 0 });
    expect(page.entries.map((e) => e.id)).toEqual([b.id, ...tied]);
    expect(page.total).toBe(3);
    const second = await store.list({ formId: 'form-1', limit: 1, offset: 1 });
    expect(second.entries.map((e) => e.id)).toEqual([tied[0]]);
    expect(second.total).toBe(3);
    await db.destroy();
  });

  it('list_keeps_to_one_form', async () => {
    const { db, store } = await world();
    await store.create(entry());
    await store.create(entry({ formId: 'form-2' }));
    const page = await store.list({ formId: 'form-2', limit: 10, offset: 0 });
    expect(page.entries.map((e) => e.formId)).toEqual(['form-2']);
    expect(page.total).toBe(1);
    await db.destroy();
  });

  it('list_matches_facility_ids_or_entered_by_when_both_are_set', async () => {
    const { db, store } = await world();
    const mine = await store.create(entry({ entryKey: 'M', facilityId: 'fac-9', enteredBy: 'me' }));
    const site = await store.create(entry({ entryKey: 'S', facilityId: 'fac-1', enteredBy: 'other' }));
    const noSite = await store.create(entry({ entryKey: 'N', facilityId: null, enteredBy: 'me' }));
    await store.create(entry({ entryKey: 'X', facilityId: 'fac-9', enteredBy: 'other' }));
    await store.create(entry({ entryKey: 'Y', facilityId: null, enteredBy: 'other' }));
    const both = await store.list({ formId: 'form-1', facilityIds: ['fac-1'], orEnteredBy: 'me', limit: 10, offset: 0 });
    expect(new Set(both.entries.map((e) => e.id))).toEqual(new Set([mine.id, site.id, noSite.id]));
    expect(both.total).toBe(3);
    const sitesOnly = await store.list({ formId: 'form-1', facilityIds: ['fac-1'], limit: 10, offset: 0 });
    expect(sitesOnly.entries.map((e) => e.id)).toEqual([site.id]);
    const none = await store.list({ formId: 'form-1', facilityIds: [], limit: 10, offset: 0 });
    expect(none.total).toBe(0);
    const noneButMine = await store.list({ formId: 'form-1', facilityIds: [], orEnteredBy: 'me', limit: 10, offset: 0 });
    expect(new Set(noneButMine.entries.map((e) => e.id))).toEqual(new Set([mine.id, noSite.id]));
    await db.destroy();
  });

  it('list_filters_by_status_entered_by_and_key_prefix', async () => {
    const { db, store } = await world();
    const a = await store.create(entry({ entryKey: 'abc-1', enteredBy: 'u1' }));
    const b = await store.create(entry({ entryKey: 'ABD-2', enteredBy: 'u2' }));
    await store.create(entry({ entryKey: 'zab-3', enteredBy: 'u1' }));
    await store.void(b.id, { id: 'u9', reason: 'wrong' });
    const ids = async (f: object) => (await store.list({ formId: 'form-1', limit: 10, offset: 0, ...f })).entries.map((e) => e.id);
    expect(new Set(await ids({ search: 'ab' }))).toEqual(new Set([a.id, b.id]));
    expect(await ids({ search: 'AB', status: 'entered-in-error' })).toEqual([b.id]);
    expect(await ids({ search: 'ab', enteredBy: 'u1' })).toEqual([a.id]);
    expect(await ids({ search: 'b' })).toEqual([]);
    await db.destroy();
  });

  it('void_on_a_voided_entry_returns_null', async () => {
    const { db, store } = await world();
    const first = await store.create(entry());
    const once = await store.void(first.id, { id: 'u9', reason: 'wrong' });
    expect(await store.void(first.id, { id: 'u8', reason: 'again' })).toBeNull();
    expect(await store.get(first.id)).toEqual(once);
    await db.destroy();
  });
});
