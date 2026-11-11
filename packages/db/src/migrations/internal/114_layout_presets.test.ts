import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { sql, type Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { up, down } from './114_layout_presets';

async function withRoles(): Promise<Kysely<InternalSchema>> {
  const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
  await db.schema.createTable('roles').addColumn('id', 'text', (c) => c.primaryKey()).addColumn('slug', 'text').addColumn('name', 'text').execute();
  await db.insertInto('roles').values([{ id: 'r1', slug: 'lab_technician', name: 'Lab technician' }, { id: 'r2', slug: 'lab_admin', name: 'Lab admin' }] as never).execute();
  return db;
}

describe('114_layout_presets', () => {
  it('stores layouts with a unique name, one default per role, and cascades deletes', async () => {
    const db = await withRoles();
    try {
      await up(db as unknown as Kysely<unknown>);
      await db.insertInto('layout_presets').values({ id: 'l1', name: 'Bench', start_page: '/forms', pages: JSON.stringify(['/forms', '/patients']) as never, updated_by: 'admin' }).execute();
      await db.insertInto('layout_presets').values({ id: 'l2', name: 'Data', start_page: null, pages: JSON.stringify(['/query']) as never, updated_by: null }).execute();
      await expect(db.insertInto('layout_presets').values({ id: 'l3', name: 'Bench', start_page: null, pages: '[]' as never, updated_by: null }).execute()).rejects.toThrow();

      const row = await db.selectFrom('layout_presets').selectAll().where('id', '=', 'l1').executeTakeFirstOrThrow();
      expect(row.pages).toEqual(['/forms', '/patients']);
      expect(row.updated_at).toBeInstanceOf(Date);

      await db.insertInto('role_layout_defaults').values([{ role_id: 'r1', layout_id: 'l1' }, { role_id: 'r2', layout_id: 'l2' }]).execute();
      // One default per role.
      await expect(db.insertInto('role_layout_defaults').values({ role_id: 'r1', layout_id: 'l2' }).execute()).rejects.toThrow();
      // Deleting a layout clears the defaults that point at it.
      await db.deleteFrom('layout_presets').where('id', '=', 'l1').execute();
      expect((await db.selectFrom('role_layout_defaults').selectAll().execute()).map((r) => r.role_id)).toEqual(['r2']);
      // Deleting a role clears its default.
      await db.deleteFrom('roles').where('id', '=', 'r2').execute();
      expect(await db.selectFrom('role_layout_defaults').selectAll().execute()).toEqual([]);

      await down(db as unknown as Kysely<unknown>);
      await expect(sql`select 1 from layout_presets`.execute(db)).rejects.toThrow();
      await expect(sql`select 1 from role_layout_defaults`.execute(db)).rejects.toThrow();
    } finally { await db.destroy(); }
  });
});
