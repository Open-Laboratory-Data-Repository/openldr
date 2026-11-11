import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { InternalSchema } from '@openldr/db';
import { studioPathSchema } from './user-preferences';

// Named studio layouts (migration 114): which sidebar pages show and which page opens first. An
// admin makes them and picks one per role as the default. Shared by the /api/layouts routes and the
// `openldr layouts` CLI. A layout only hides pages in studio; it never grants one.

export interface LayoutPreset {
  id: string;
  name: string;
  startPage: string | null;
  pages: string[];
  /** Slugs of the roles that use this layout as their default. */
  roles: string[];
}

export interface LayoutList {
  layouts: LayoutPreset[];
  /** Slugs of the roles that have a default, in the order the Roles page lists roles. A user with
   *  several roles gets the default of the first one in this list. */
  roleOrder: string[];
}

export const layoutInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  startPage: studioPathSchema.nullable(),
  pages: z.array(studioPathSchema).min(1).max(50)
    .refine((p) => new Set(p).size === p.length, { message: 'a page is listed twice' }),
  roles: z.array(z.string().min(1).max(100)).max(100),
}).strict()
  // Studio only opens a start page that is in the sidebar, so one the layout hides would never open.
  .refine((l) => l.startPage === null || l.pages.includes(l.startPage), { message: 'the start page must be one of the pages' });
export type LayoutInput = z.infer<typeof layoutInputSchema>;

export class LayoutError extends Error {
  constructor(public readonly code: 'not-found' | 'duplicate-name' | 'unknown-role' | 'conflict', message: string) { super(message); }
}

/** A Postgres unique violation (23505) from two saves at the same instant, as a LayoutError: the
 *  layout name index means the name is taken; anything else (one default per role) means another
 *  save got there first. Null for any other error, which then propagates as it is. */
export function layoutErrorFromDb(err: unknown): LayoutError | null {
  const e = err as { code?: unknown; constraint?: unknown } | null;
  if (!e || e.code !== '23505') return null;
  return String(e.constraint ?? '').includes('name')
    ? new LayoutError('duplicate-name', 'a layout with this name already exists')
    : new LayoutError('conflict', 'another change to layouts was saved at the same time; try again');
}

/** A stored `pages` value. Anything that is not a list of studio paths is dropped, not thrown on. */
function parsePages(raw: unknown): string[] {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is string => studioPathSchema.safeParse(p).success);
}

export async function listLayouts(db: Kysely<InternalSchema>): Promise<LayoutList> {
  const rows = await db.selectFrom('layout_presets').select(['id', 'name', 'start_page', 'pages']).orderBy('name').orderBy('id').execute();
  // Roles page order: system roles first, then by name (role-store.ts list), slug to break ties.
  const defaults = await db.selectFrom('role_layout_defaults')
    .innerJoin('roles', 'roles.id', 'role_layout_defaults.role_id')
    .select(['roles.slug', 'role_layout_defaults.layout_id'])
    .orderBy('roles.is_system', 'desc').orderBy('roles.name').orderBy('roles.slug')
    .execute();
  return {
    layouts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      startPage: r.start_page,
      pages: parsePages(r.pages),
      roles: defaults.filter((d) => d.layout_id === r.id).map((d) => d.slug),
    })),
    roleOrder: defaults.map((d) => d.slug),
  };
}

/** Create (id null) or replace a layout. Its `roles` become exactly the roles that default to it;
 *  a role that defaulted to another layout moves here. One transaction. */
export async function saveLayout(db: Kysely<InternalSchema>, id: string | null, raw: LayoutInput, actor: string | null): Promise<LayoutPreset> {
  const input = layoutInputSchema.parse(raw);
  const layoutId = await db.transaction().execute(async (trx) => {
    if (id !== null && !(await trx.selectFrom('layout_presets').select('id').where('id', '=', id).executeTakeFirst())) {
      throw new LayoutError('not-found', `layout ${id} not found`);
    }
    const clash = await trx.selectFrom('layout_presets').select('id').where('name', '=', input.name).executeTakeFirst();
    if (clash && clash.id !== id) throw new LayoutError('duplicate-name', `a layout named ${input.name} already exists`);
    const roleRows = input.roles.length
      ? await trx.selectFrom('roles').select(['id', 'slug']).where('slug', 'in', input.roles).execute()
      : [];
    const missing = input.roles.filter((slug) => !roleRows.some((r) => r.slug === slug));
    if (missing.length) throw new LayoutError('unknown-role', `no role ${missing.join(', ')}`);

    const values = { name: input.name, start_page: input.startPage, pages: JSON.stringify(input.pages) as never, updated_by: actor, updated_at: new Date() };
    const lid = id ?? randomUUID();
    if (id === null) await trx.insertInto('layout_presets').values({ id: lid, ...values }).execute();
    else await trx.updateTable('layout_presets').set(values).where('id', '=', lid).execute();

    await trx.deleteFrom('role_layout_defaults').where('layout_id', '=', lid).execute();
    const roleIds = roleRows.map((r) => r.id);
    if (roleIds.length) {
      await trx.deleteFrom('role_layout_defaults').where('role_id', 'in', roleIds).execute();
      await trx.insertInto('role_layout_defaults').values(roleIds.map((role_id) => ({ role_id, layout_id: lid }))).execute();
    }
    return lid;
  }).catch((err: unknown) => { throw layoutErrorFromDb(err) ?? err; });
  return (await listLayouts(db)).layouts.find((l) => l.id === layoutId)!;
}

/** Delete a layout. Its role defaults go with it (foreign key cascade). Returns what was deleted,
 *  for the audit row. A user who picked it falls back to their role default in studio. */
export async function deleteLayout(db: Kysely<InternalSchema>, id: string): Promise<LayoutPreset> {
  const existing = (await listLayouts(db)).layouts.find((l) => l.id === id);
  if (!existing) throw new LayoutError('not-found', `layout ${id} not found`);
  await db.deleteFrom('role_layout_defaults').where('layout_id', '=', id).execute();
  await db.deleteFrom('layout_presets').where('id', '=', id).execute();
  return existing;
}
