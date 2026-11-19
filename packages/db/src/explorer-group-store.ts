import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

/** The Query page branches whose items sit in these groups. Custom Queries has its own tables. */
export const EXPLORER_GROUP_KINDS = ['connector', 'dataset'] as const;
export type ExplorerGroupKind = (typeof EXPLORER_GROUP_KINDS)[number];

export interface ExplorerGroupStore {
  /** Every group of the branch, empty ones too, in name order. */
  listGroups(kind: ExplorerGroupKind): Promise<string[]>;
  /** Which group each placed item sits in. Null: placed in no group on purpose. An item with no
   *  entry was never placed. */
  itemGroups(kind: ExplorerGroupKind): Promise<Record<string, string | null>>;
  /** Makes an empty group. Throws `name already exists`. */
  createGroup(kind: ExplorerGroupKind, name: string): Promise<void>;
  /** Renames a group. With `to` null the group is removed and its items keep no group. A rename onto
   *  a group that exists joins the two. Resolves to how many items the group held. */
  renameGroup(kind: ExplorerGroupKind, from: string, to: string | null): Promise<number>;
  /** Moves an item to a group, or to none. A group that does not exist yet is made. */
  setItemGroup(kind: ExplorerGroupKind, itemId: string, group: string | null): Promise<void>;
  /** Places an item in `group` only if it was never placed. So a pack's dataset starts in a group
   *  named for the pack, and a reinstall keeps where a person moved it since. */
  placeIfUnplaced(kind: ExplorerGroupKind, itemId: string, group: string): Promise<void>;
  /** Forgets an item, when the thing itself is deleted. */
  forgetItem(kind: ExplorerGroupKind, itemId: string): Promise<void>;
}

const G = 'explorer_groups' as const;
const I = 'explorer_group_items' as const;

export function createExplorerGroupStore(db: Kysely<InternalSchema>): ExplorerGroupStore {
  const ensureGroup = async (exec: Kysely<InternalSchema>, kind: string, name: string): Promise<void> => {
    const hit = await exec.selectFrom(G).select('name').where('kind', '=', kind).where('name', '=', name).executeTakeFirst();
    if (!hit) await exec.insertInto(G).values({ kind, name } as never).execute();
  };
  const place = async (exec: Kysely<InternalSchema>, kind: string, itemId: string, group: string | null): Promise<void> => {
    const hit = await exec.selectFrom(I).select('item_id').where('kind', '=', kind).where('item_id', '=', itemId).executeTakeFirst();
    if (hit) await exec.updateTable(I).set({ group_name: group, updated_at: new Date() } as never).where('kind', '=', kind).where('item_id', '=', itemId).execute();
    else await exec.insertInto(I).values({ kind, item_id: itemId, group_name: group } as never).execute();
  };
  return {
    async listGroups(kind) {
      const rows = await db.selectFrom(G).select('name').where('kind', '=', kind).execute();
      return rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
    },
    async itemGroups(kind) {
      const rows = await db.selectFrom(I).select(['item_id', 'group_name']).where('kind', '=', kind).execute();
      return Object.fromEntries(rows.map((r) => [r.item_id, r.group_name ?? null]));
    },
    async createGroup(kind, name) {
      const hit = await db.selectFrom(G).select('name').where('kind', '=', kind).where('name', '=', name).executeTakeFirst();
      if (hit) throw new Error('name already exists');
      await db.insertInto(G).values({ kind, name } as never).execute();
    },
    async renameGroup(kind, from, to) {
      return db.transaction().execute(async (trx) => {
        const held = await trx.selectFrom(I).select('item_id').where('kind', '=', kind).where('group_name', '=', from).execute();
        await trx.deleteFrom(G).where('kind', '=', kind).where('name', '=', from).execute();
        if (to !== null) await ensureGroup(trx, kind, to);
        if (held.length > 0) {
          await trx.updateTable(I).set({ group_name: to, updated_at: new Date() } as never).where('kind', '=', kind).where('group_name', '=', from).execute();
        }
        return held.length;
      });
    },
    async setItemGroup(kind, itemId, group) {
      await db.transaction().execute(async (trx) => {
        if (group !== null) await ensureGroup(trx, kind, group);
        await place(trx, kind, itemId, group);
      });
    },
    async placeIfUnplaced(kind, itemId, group) {
      await db.transaction().execute(async (trx) => {
        const hit = await trx.selectFrom(I).select('item_id').where('kind', '=', kind).where('item_id', '=', itemId).executeTakeFirst();
        if (hit) return;
        await ensureGroup(trx, kind, group);
        await trx.insertInto(I).values({ kind, item_id: itemId, group_name: group } as never).execute();
      });
    },
    async forgetItem(kind, itemId) {
      await db.deleteFrom(I).where('kind', '=', kind).where('item_id', '=', itemId).execute();
    },
  };
}
