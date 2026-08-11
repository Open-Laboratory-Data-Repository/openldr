import { describe, expect, it } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations } from './index';

/** Runs migrations in order, pausing before 084 so a pre-existing design row can be inserted —
 *  which is the only way to test the backfill. */
async function migrateWithLegacyRow(): Promise<Kysely<any>> {
  const db = newDb().adapters.createKysely() as Kysely<any>;
  for (const [name, migration] of Object.entries(internalMigrations)) {
    if (name === '084_report_design_versions') {
      await db.insertInto('report_designs').values({
        id: 'legacy', name: 'Already live',
        pages: JSON.stringify([]), parameters: JSON.stringify([]), margins: null,
      } as never).execute();
    }
    await migration.up(db);
  }
  return db;
}

describe('084_report_design_versions', () => {
  it('backfills an existing design to published, not draft', async () => {
    // ⛔ Existing designs are live and already mirrored by labs. Left as 'draft', capture never
    // fires for them again and every lab's copy freezes silently and permanently.
    const db = await migrateWithLegacyRow();
    const row = await db.selectFrom('report_designs').select(['id', 'status']).where('id', '=', 'legacy').executeTakeFirst();
    expect(row).toEqual({ id: 'legacy', status: 'published' });
  });

  it('defaults a NEW design to draft', async () => {
    const db = await migrateWithLegacyRow();
    await db.insertInto('report_designs').values({
      id: 'fresh', name: 'New', pages: JSON.stringify([]), parameters: JSON.stringify([]), margins: null,
    } as never).execute();
    const row = await db.selectFrom('report_designs').select(['status']).where('id', '=', 'fresh').executeTakeFirst();
    expect(row).toEqual({ status: 'draft' });
  });

  it('creates report_design_versions and round-trips a snapshot', async () => {
    const db = await migrateWithLegacyRow();
    await db.insertInto('report_design_versions').values({
      id: 'rdv-1', design_id: 'legacy', version: 1, name: 'Already live',
      paper: 'A4', orientation: 'portrait',
      pages: JSON.stringify([]), parameters: JSON.stringify([]), margins: null,
      page_numbers: true, published_by: 'u1',
    } as never).execute();

    const rows = await db.selectFrom('report_design_versions')
      .select(['design_id', 'version', 'page_numbers', 'published_by']).execute();
    expect(rows).toEqual([{ design_id: 'legacy', version: 1, page_numbers: true, published_by: 'u1' }]);
  });
});
