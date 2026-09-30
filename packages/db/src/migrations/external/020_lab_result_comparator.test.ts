import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { sql } from 'kysely';

describe('020_lab_result_comparator', () => {
  it('round-trips numeric_comparator on lab_results', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_results (id, numeric_value, numeric_comparator) values ('o-1', 20, '<')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select numeric_value, numeric_comparator from lab_results where id = 'o-1'`.execute(db);
    expect(rows.rows).toEqual([{ numeric_value: 20, numeric_comparator: '<' }]);
  });

  it('reads NULL when a result carries no comparator', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_results (id, numeric_value) values ('o-2', 540)`.execute(db);
    const rows = await sql<Record<string, unknown>>`select numeric_comparator from lab_results where id = 'o-2'`.execute(db);
    expect(rows.rows).toEqual([{ numeric_comparator: null }]);
  });
});
