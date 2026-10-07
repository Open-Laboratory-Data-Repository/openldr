import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import * as m021 from './021_facility_registry';

describe('021_facility_registry', () => {
  it('round-trips a full register row', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into facility_registry
      (id, facility_system, facility_code, name, level, ownership, status, register_state,
       country, zone, region, district, council, ward, village, address_text, phone,
       latitude, longitude, extras, updated_at)
      values ('fac-1', 'urn:openldr:mz:facilities', 'PMC', 'HG Machava', 'H', 'public', 'active',
              'in_register', 'MZ', null, 'Maputo Provincia', 'Matola', null, null, null, null, null,
              -25.9, 32.5, '{"HFStatus":"1"}', '2026-10-07T00:00:00Z')`.execute(db);
    const rows = await sql<Record<string, unknown>>`
      select facility_system, facility_code, name, region, district, register_state, latitude, extras
      from facility_registry`.execute(db);
    expect(rows.rows).toEqual([{
      facility_system: 'urn:openldr:mz:facilities', facility_code: 'PMC', name: 'HG Machava',
      region: 'Maputo Provincia', district: 'Matola', register_state: 'in_register',
      latitude: -25.9, extras: '{"HFStatus":"1"}',
    }]);
  });

  it('allows a row with no register, as the internal table does', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into facility_registry (id, facility_code, name) values ('fac-2', 'L-1', 'Local lab')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select facility_system, updated_at is not null as stamped from facility_registry`.execute(db);
    expect(rows.rows).toEqual([{ facility_system: null, stamped: true }]);
  });

  it('down drops the table', async () => {
    const db = await makeMigratedExternalDb();
    await m021.down(db);
    await expect(sql`select count(*) from facility_registry`.execute(db)).rejects.toThrow();
  });
});
