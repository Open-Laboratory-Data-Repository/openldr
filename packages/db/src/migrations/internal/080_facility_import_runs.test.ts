import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';

describe('080_facility_import_runs', () => {
  it('creates a run row and defaults its counters', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    await db.insertInto('facility_import_runs').values({
      id: 'fir_1', national_system: 'urn:tz:hfr', source_format: 'csv',
      file_hash: 'abc', byte_size: 10, status: 'previewed', options: {} as never,
    }).execute();
    const row = await db.selectFrom('facility_import_runs').selectAll().executeTakeFirstOrThrow();
    expect(row.processed).toBe(0);
    expect(row.cancel_requested).toBe(false);
    expect(row.previewed_at).toBeNull();
  });

  it('permits many terminal runs for one national_system but only one active', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const base = { national_system: 'urn:tz:hfr', source_format: 'csv', file_hash: 'h', byte_size: 1, options: {} as never };
    await db.insertInto('facility_import_runs').values([
      { ...base, id: 'fir_a', status: 'applied', active_key: null },
      { ...base, id: 'fir_b', status: 'applied', active_key: null },
    ]).execute();
    await db.insertInto('facility_import_runs').values({ ...base, id: 'fir_c', status: 'previewed', active_key: 'urn:tz:hfr' }).execute();
    await expect(
      db.insertInto('facility_import_runs').values({ ...base, id: 'fir_d', status: 'previewed', active_key: 'urn:tz:hfr' }).execute(),
    ).rejects.toThrow();
  });
});
