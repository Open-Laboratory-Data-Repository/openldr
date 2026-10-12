import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { sql } from 'kysely';

describe('024_lab_result_status', () => {
  it('round-trips status and the missing-value reason on lab_results', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_results (id, status, data_absent_code, data_absent_reason) values ('o-1', 'cancelled', 'HAEM', 'Haemolysed')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select status, data_absent_code, data_absent_reason from lab_results where id = 'o-1'`.execute(db);
    expect(rows.rows).toEqual([{ status: 'cancelled', data_absent_code: 'HAEM', data_absent_reason: 'Haemolysed' }]);
  });

  it('reads NULL for a row written without them', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_results (id, numeric_value) values ('o-2', 540)`.execute(db);
    const rows = await sql<Record<string, unknown>>`select status, data_absent_code, data_absent_reason from lab_results where id = 'o-2'`.execute(db);
    expect(rows.rows).toEqual([{ status: null, data_absent_code: null, data_absent_reason: null }]);
  });
});
