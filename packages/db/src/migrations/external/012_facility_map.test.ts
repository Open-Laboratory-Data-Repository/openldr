import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { sql } from 'kysely';

describe('012_facility_map', () => {
  it('creates facility_map and round-trips a resolved row', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into facility_map
      (id, source_system, source_code, registry_id, local_code, name, resolved_via)
      values ('webhook-ingest|Dodoma', 'webhook-ingest', 'Dodoma', 'fac-1', 'DOD',
              'Dodoma Regional Referral Hospital', 'registry')`.execute(db);
    const rows = await sql<{ name: string; source_code: string; local_code: string }>`
      select name, source_code, local_code from facility_map`.execute(db);
    expect(rows.rows).toEqual([
      { name: 'Dodoma Regional Referral Hospital', source_code: 'Dodoma', local_code: 'DOD' },
    ]);
  });

  it('round-trips an unmapped row with registry_id and name left NULL', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into facility_map
      (id, source_system, source_code)
      values ('webhook-ingest|Unmapped Clinic', 'webhook-ingest', 'Unmapped Clinic')`.execute(db);
    const rows = await sql<{ registry_id: string | null; local_code: string | null; name: string | null; resolved_via: string | null }>`
      select registry_id, local_code, name, resolved_via from facility_map`.execute(db);
    expect(rows.rows).toEqual([
      { registry_id: null, local_code: null, name: null, resolved_via: null },
    ]);
  });
});
