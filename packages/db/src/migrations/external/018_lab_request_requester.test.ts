import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { sql } from 'kysely';

describe('018_lab_request_requester', () => {
  it('round-trips the requesting facility on a lab request', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_requests (id, request_id, requester_code, requester_system, requester_display)
      values ('sr-1', 'TDS0012345', 'IBPAA', 'urn:openldr:default_fac', 'KCMC')`.execute(db);
    const rows = await sql<{ requester_code: string; requester_system: string; requester_display: string }>`
      select requester_code, requester_system, requester_display from lab_requests`.execute(db);
    expect(rows.rows).toEqual([{ requester_code: 'IBPAA', requester_system: 'urn:openldr:default_fac', requester_display: 'KCMC' }]);
  });

  it('leaves all three NULL when a request names no facility', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_requests (id, request_id) values ('sr-2', 'TDS0012346')`.execute(db);
    const rows = await sql<{ requester_code: null; requester_system: null; requester_display: null }>`
      select requester_code, requester_system, requester_display from lab_requests`.execute(db);
    expect(rows.rows).toEqual([{ requester_code: null, requester_system: null, requester_display: null }]);
  });
});
