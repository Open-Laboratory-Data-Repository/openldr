import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityRegisterSourceStore } from './facility-register-sources';
import { FACILITY_REGISTER_KIND } from './migrations/internal/081_facility_source_and_register_state';
import type { InternalSchema } from './schema/internal';

const base = { url: 'urn:tz:hfr', name: 'Tanzania HFR', code: 'TZ_HFR' };

describe('createFacilityRegisterSourceStore', () => {
  it('creates a source and reads it back by URL', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    const made = await store.create({ ...base, jurisdiction: 'TZ', version: '2026-Q3' });
    expect(made.url).toBe('urn:tz:hfr');
    const found = await store.getByUrl('urn:tz:hfr');
    expect(found).toMatchObject({ name: 'Tanzania HFR', jurisdiction: 'TZ', version: '2026-Q3', active: true });
  });

  it('⛔ lists ONLY facility registers, never other coding systems', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    await store.create(base);
    // A coding system that is NOT a register — the reason `kind` exists.
    await db.insertInto('coding_systems').values({
      id: 'cs-loinc', system_code: 'LOINC', system_name: 'LOINC', url: 'http://loinc.org',
    } as never).execute();
    const rows = await store.list();
    expect(rows.map((r) => r.url)).toEqual(['urn:tz:hfr']);
  });

  it('refuses a duplicate URL rather than minting a second identity for one register', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    await store.create(base);
    await expect(store.create({ ...base, name: 'Tanzania HFR (again)' })).rejects.toThrow(/already/i);
  });

  // ⛔ Carry-forward 1 (deferred from B1 Task 3, closed here): an EXACT-match pre-check alone ships
  // the original defect through this front door. `idFor` (facility-csv.ts) does not lowercase its
  // hash input; `observedFieldSystem` (facility-controlled-fields.ts) DOES lowercase its slug — so
  // 'urn:tz:hfr' and 'urn:tz:HFR' would each individually pass an exact-match check, each earn their
  // own row, and each later satisfy the import route's own exact-match gate while hashing to
  // DIFFERENT `idFor` identities that share ONE controlled-field namespace.
  it('⛔ refuses a case-insensitive duplicate URL, not just an exact one', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    await store.create(base); // url: 'urn:tz:hfr'
    await expect(store.create({ ...base, url: 'urn:tz:HFR', name: 'Tanzania HFR (upper)' }))
      .rejects.toThrow(/already exists/i);
    // Nothing was written for the refused attempt — one row, not two.
    expect(await store.list({ includeInactive: true })).toHaveLength(1);
  });

  // ⛔ Carry-forward 2 (deferred from B1 Task 3, closed here): `coding_systems_url_uq` (migration
  // 012) is a PLAIN unique index on `url` ALONE, not scoped by `kind` — while `getByUrl` (and the
  // case-insensitive pre-check above) IS scoped to `kind = FACILITY_REGISTER_KIND`. MEASURED: before
  // this fix, a url already used by a NON-register coding system passed the kind-scoped pre-check
  // and reached the insert, which threw a raw, unclassified Postgres 23505 rather than a plain Error
  // a caller (the route) could recognise and map to a 4xx.
  it('⛔ refuses a url already used by a NON-register coding system, as a plain Error rather than a raw 23505', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    await db.insertInto('coding_systems').values({
      id: 'cs-loinc', system_code: 'LOINC', system_name: 'LOINC', url: 'http://loinc.org',
    } as never).execute();
    const store = createFacilityRegisterSourceStore(db);

    let caught: unknown;
    try {
      await store.create({ url: 'http://loinc.org', name: 'Not actually a register', code: 'X' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/already exists/i);
    // Proves the CATCH-AND-TRANSLATE path fired (the pre-check above is scoped to `kind` and cannot
    // see this row at all) rather than the raw driver exception reaching the caller — a real 23505
    // carries a `.code`, and this one must not.
    expect((caught as { code?: unknown }).code).toBeUndefined();
  });

  it('orders by name with a unique tiebreaker', async () => {
    // ⛔ The ids are SEEDED, deterministic, and deliberately in the OPPOSITE order to the inserts —
    // `create()` mints `cs-freg-${randomUUID()}`, and two random ids sharing a name made this a coin
    // flip: with `.orderBy('id','asc')` removed, pg-mem returns its stable scan (= insertion) order,
    // which satisfied `rows[0].id < rows[1].id` on roughly half of all runs. MEASURED. So the rows go
    // in directly, in the shape `create()` writes: `…-zzz` inserted first, `…-aaa` second. If the id
    // tiebreaker is dropped, pg-mem hands back `…-zzz` first and this fails EVERY run, not one in two.
    //
    // pg-mem's scan order being stable is also why this can never prove the tiebreaker is NEEDED — on
    // real Postgres a `system_name`-only ORDER BY across rows sharing a name is what is genuinely
    // non-deterministic. This pins the contract; the store's comment carries the reason.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    const insert = (id: string, url: string, code: string) => db.insertInto('coding_systems').values({
      id, system_code: code, system_name: 'Same', url, active: true, seeded: false,
      kind: FACILITY_REGISTER_KIND,
    } as never).execute();
    await insert('cs-freg-zzz', 'urn:b', 'B');
    await insert('cs-freg-aaa', 'urn:a', 'A');
    const rows = await store.list();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(['cs-freg-aaa', 'cs-freg-zzz']);
    expect(rows.map((r) => r.url)).toEqual(['urn:a', 'urn:b']);
  });

  it('excludes inactive sources unless asked', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    const made = await store.create(base);
    await db.updateTable('coding_systems').set({ active: false } as never)
      .where('id', '=', made.id).execute();
    expect(await store.list()).toHaveLength(0);
    expect(await store.list({ includeInactive: true })).toHaveLength(1);
  });
});
