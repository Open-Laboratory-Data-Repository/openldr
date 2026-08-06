import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { sql } from 'kysely';

describe('014_facility_location', () => {
  it('round-trips region and district alongside the existing facility columns', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into facilities (id, facility_code, facility_name, region, district)
      values ('facility-BAMAA', 'BAMAA', 'Aga Khan', 'Dar es Salaam', 'Ilala')`.execute(db);
    const rows = await sql<{ region: string; district: string }>`
      select region, district from facilities`.execute(db);
    expect(rows.rows).toEqual([{ region: 'Dar es Salaam', district: 'Ilala' }]);
  });

  it('leaves both columns NULL when a sender supplies neither', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into facilities (id, facility_code, facility_name) values ('facility-BALAB', 'BALAB', 'Bugando')`.execute(db);
    const rows = await sql<{ region: string | null; district: string | null }>`
      select region, district from facilities`.execute(db);
    expect(rows.rows).toEqual([{ region: null, district: null }]);
  });
});
