import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedExternalDb } from '../../test-helpers-external';

describe('011 terminology_codes', () => {
  it('creates a table that accepts a projected concept row', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into terminology_codes (id, value_set_id, value_set_url, system, code, display)
              values ('vs1|sys|M','vs1','urn:openldr:valueset:biological-sex','sys','M','Male')`.execute(db);
    const rows = (await sql<{ code: string }>`select code from terminology_codes`.execute(db)).rows;
    expect(rows).toEqual([{ code: 'M' }]);
    await db.destroy();
  });

  it('rejects a duplicate id, so upsert-on-id is well defined', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into terminology_codes (id, value_set_id, system, code) values ('dup','vs1','sys','A')`.execute(db);
    await expect(
      sql`insert into terminology_codes (id, value_set_id, system, code) values ('dup','vs1','sys','A')`.execute(db),
    ).rejects.toThrow();
    await db.destroy();
  });
});
