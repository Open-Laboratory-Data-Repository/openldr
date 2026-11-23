import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { collectCompiledSql } from './compile-test-helpers';
import * as m028 from './028_drop_unauthorised_results';

// pg-mem runs the delete on emulated Postgres. MySQL and MSSQL are checked offline against Kysely's
// compilers. Neither proves a real MySQL or SQL Server accepts it.
describe('028_drop_unauthorised_results', () => {
  const seed = async (db: Awaited<ReturnType<typeof makeMigratedExternalDb>>) => {
    await sql`insert into lab_results (id, status) values
      ('o-final', 'final'), ('o-prelim', 'preliminary'), ('o-reg', 'registered'),
      ('o-cancel', 'cancelled'), ('o-amend', 'amended'), ('o-null', null)`.execute(db);
  };
  const ids = async (db: Awaited<ReturnType<typeof makeMigratedExternalDb>>) =>
    (await sql<{ id: string }>`select id from lab_results order by id`.execute(db)).rows.map((r) => r.id);

  it('deletes only preliminary and registered rows', async () => {
    const db = await makeMigratedExternalDb();
    await seed(db);
    await m028.up(db);
    expect(await ids(db)).toEqual(['o-amend', 'o-cancel', 'o-final', 'o-null']);
    await db.destroy();
  });

  it('is safe to run twice', async () => {
    const db = await makeMigratedExternalDb();
    await seed(db);
    await m028.up(db);
    await m028.up(db);
    expect(await ids(db)).toEqual(['o-amend', 'o-cancel', 'o-final', 'o-null']);
    await db.destroy();
  });

  it('down() changes nothing', async () => {
    const db = await makeMigratedExternalDb();
    await seed(db);
    await m028.down(db);
    expect(await ids(db)).toHaveLength(6);
    await db.destroy();
  });

  it('sends the same SQL on all three engines', async () => {
    const expected = "delete from lab_results where status in ('preliminary', 'registered')";
    for (const engine of ['postgres', 'mysql', 'mssql'] as const) {
      expect(await collectCompiledSql(engine, (db) => m028.up(db))).toEqual([expected]);
    }
  });
});
