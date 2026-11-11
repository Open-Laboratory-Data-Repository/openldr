import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { deleteLayout, listLayouts, saveLayout, layoutInputSchema } from './layout-presets';

async function dbWithRoles(): Promise<Kysely<InternalSchema>> {
  const db = (await makeMigratedDb()) as unknown as Kysely<InternalSchema>;
  // Seeded system roles may exist already; add our own with names that sort predictably.
  await db.insertInto('roles').values([
    { id: 'rb', slug: 'bench', name: 'Bench staff', description: null, is_system: false },
    { id: 'rd', slug: 'data', name: 'Data staff', description: null, is_system: false },
  ] as never).execute();
  return db;
}

const bench = { name: 'Bench', startPage: '/forms', pages: ['/forms', '/patients'], roles: ['bench'] };

describe('layout presets', () => {
  it('creates, lists with roles, and updates a layout', async () => {
    const db = await dbWithRoles();
    const made = await saveLayout(db, null, bench, 'admin');
    expect(made).toMatchObject({ name: 'Bench', startPage: '/forms', pages: ['/forms', '/patients'], roles: ['bench'] });
    const updated = await saveLayout(db, made.id, { ...bench, pages: ['/forms'], startPage: null }, 'admin');
    expect(updated).toMatchObject({ id: made.id, pages: ['/forms'], startPage: null, roles: ['bench'] });
    const { layouts } = await listLayouts(db);
    expect(layouts).toEqual([updated]);
  });

  it('moves a role off its old layout when another layout takes it as default', async () => {
    const db = await dbWithRoles();
    const a = await saveLayout(db, null, bench, 'admin');
    const b = await saveLayout(db, null, { name: 'Data', startPage: '/query', pages: ['/query'], roles: ['bench', 'data'] }, 'admin');
    const { layouts } = await listLayouts(db);
    expect(layouts.find((l) => l.id === a.id)!.roles).toEqual([]);
    expect(layouts.find((l) => l.id === b.id)!.roles.sort()).toEqual(['bench', 'data']);
  });

  it('lists the roles that have a default in Roles page order (system roles first, then by name)', async () => {
    const db = await dbWithRoles();
    await saveLayout(db, null, { ...bench, roles: ['data', 'bench'] }, 'admin');
    const sys = await db.selectFrom('roles').select('slug').where('is_system', '=', true).orderBy('name').executeTakeFirst();
    if (sys) await saveLayout(db, null, { name: 'Admin', startPage: null, pages: ['/users'], roles: [sys.slug] }, 'admin');
    const { roleOrder } = await listLayouts(db);
    expect(roleOrder).toEqual([...(sys ? [sys.slug] : []), 'bench', 'data']);
  });

  it('refuses a duplicate name, an unknown role, and an unknown id', async () => {
    const db = await dbWithRoles();
    await saveLayout(db, null, bench, 'admin');
    await expect(saveLayout(db, null, { ...bench, roles: [] }, 'admin')).rejects.toMatchObject({ code: 'duplicate-name' });
    await expect(saveLayout(db, null, { ...bench, name: 'Other', roles: ['nope'] }, 'admin')).rejects.toMatchObject({ code: 'unknown-role' });
    await expect(saveLayout(db, 'missing', bench, 'admin')).rejects.toMatchObject({ code: 'not-found' });
    await expect(deleteLayout(db, 'missing')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('deleting a layout clears the role defaults that pointed at it', async () => {
    const db = await dbWithRoles();
    const made = await saveLayout(db, null, bench, 'admin');
    expect((await deleteLayout(db, made.id)).name).toBe('Bench');
    expect(await listLayouts(db)).toEqual({ layouts: [], roleOrder: [] });
    expect(await db.selectFrom('role_layout_defaults').selectAll().execute()).toEqual([]);
  });

  it('validates input: studio paths only, 1 to 50 pages, no duplicates', () => {
    expect(layoutInputSchema.safeParse(bench).success).toBe(true);
    expect(layoutInputSchema.safeParse({ ...bench, pages: [] }).success).toBe(false);
    expect(layoutInputSchema.safeParse({ ...bench, pages: ['/forms', '/forms'] }).success).toBe(false);
    expect(layoutInputSchema.safeParse({ ...bench, pages: ['https://evil'] }).success).toBe(false);
    expect(layoutInputSchema.safeParse({ ...bench, startPage: '//evil' }).success).toBe(false);
    expect(layoutInputSchema.safeParse({ ...bench, name: '  ' }).success).toBe(false);
    expect(layoutInputSchema.safeParse({ ...bench, extra: 1 }).success).toBe(false);
    expect(layoutInputSchema.safeParse({ ...bench, pages: Array.from({ length: 51 }, (_, i) => `/p${i}`) }).success).toBe(false);
    // A start page the layout hides would never open (studio only opens sidebar pages).
    expect(layoutInputSchema.safeParse({ ...bench, startPage: '/query' }).success).toBe(false);
    expect(layoutInputSchema.safeParse({ ...bench, startPage: null }).success).toBe(true);
  });
});
