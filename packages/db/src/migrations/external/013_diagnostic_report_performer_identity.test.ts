import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { sql } from 'kysely';

describe('013_diagnostic_report_performer_identity', () => {
  it('round-trips performer_display and performer_system alongside the existing performer match key', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into diagnostic_reports (id, performer, performer_display, performer_system)
      values ('dr-1', 'BAMAA', 'Aga Khan', 'urn:openldr:default_fac')`.execute(db);
    const rows = await sql<{ performer: string; performer_display: string; performer_system: string }>`
      select performer, performer_display, performer_system from diagnostic_reports`.execute(db);
    expect(rows.rows).toEqual([
      { performer: 'BAMAA', performer_display: 'Aga Khan', performer_system: 'urn:openldr:default_fac' },
    ]);
  });

  it('leaves both columns NULL when a sender supplies neither', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into diagnostic_reports (id, performer) values ('dr-2', 'Mnazi Mmoja')`.execute(db);
    const rows = await sql<{ performer_display: string | null; performer_system: string | null }>`
      select performer_display, performer_system from diagnostic_reports`.execute(db);
    expect(rows.rows).toEqual([{ performer_display: null, performer_system: null }]);
  });
});
