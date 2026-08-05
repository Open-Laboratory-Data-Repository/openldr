import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from './test-helpers';

describe('074_drop_facility_aliases', () => {
  it('removes the facility_aliases table', async () => {
    const db = await makeMigratedDb();
    const { rows } = await sql<{ table_name: string }>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'facility_aliases'`.execute(db);
    expect(rows).toEqual([]);
  });
});
