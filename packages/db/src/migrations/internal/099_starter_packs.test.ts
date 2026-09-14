import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { up, down } from './099_starter_packs';

describe('starter packs migration', () => {
  it('stores a pack and its entries, allows an entry with no path, and refuses a repeated position', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    try {
      await up(db as unknown as Kysely<unknown>);
      await db.insertInto('starter_packs').values({ id: 'p', resource_type: 'Location', name: 'Facility', version: '1', seeded: true }).execute();
      await db.insertInto('starter_pack_entries').values({ pack_id: 'p', ord: 0, fhir_path: null, label: 'Zone', rationale: 'r' }).execute();
      await expect(
        db.insertInto('starter_pack_entries').values({ pack_id: 'p', ord: 0, fhir_path: 'Location.name', label: 'Name', rationale: 'r' }).execute(),
      ).rejects.toThrow();
      const [row] = await db.selectFrom('starter_pack_entries').selectAll().execute();
      expect(row).toMatchObject({ fhir_path: null, required: false, locked: false, default_on: true, reference_multiple: false });
      await down(db as unknown as Kysely<unknown>);
      await expect(db.selectFrom('starter_packs').selectAll().execute()).rejects.toThrow();
    } finally {
      await db.destroy();
    }
  });
});
