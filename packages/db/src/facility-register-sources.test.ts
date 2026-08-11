import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityRegisterSourceStore } from './facility-register-sources';
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

  it('orders by name with a unique tiebreaker', async () => {
    // pg-mem's scan order is STABLE and can never reveal a missing tiebreaker, so this asserts the
    // ordered contract on rows sharing a name; the tiebreaker is what makes it deterministic on
    // real Postgres.
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityRegisterSourceStore(db);
    await store.create({ url: 'urn:b', name: 'Same', code: 'B' });
    await store.create({ url: 'urn:a', name: 'Same', code: 'A' });
    const rows = await store.list();
    expect(rows).toHaveLength(2);
    expect(rows[0].id < rows[1].id).toBe(true);
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
