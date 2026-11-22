import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type PackItemKind = 'role' | 'layout' | 'form';

/** One thing a content pack made. `key` is its name inside the pack, `itemId` the id of the row. */
export interface PackItem { packId: string; kind: PackItemKind; key: string; itemId: string }

export interface PackItemStore {
  /** Every item the pack made, ordered by kind, then key. */
  list(packId: string): Promise<PackItem[]>;
  /** Which pack made each item of this kind: item id to pack id. */
  owners(kind: PackItemKind): Promise<Map<string, string>>;
  /** Records an item. A row with the same pack, kind and key is replaced. Throws when another pack
   *  already holds the same item id for this kind. */
  put(item: PackItem): Promise<void>;
  /** Forgets one item of a pack. */
  remove(packId: string, kind: PackItemKind, key: string): Promise<void>;
}

const T = 'content_pack_items' as const;

export function createPackItemStore(db: Kysely<InternalSchema>): PackItemStore {
  return {
    async list(packId) {
      const rows = await db.selectFrom(T).select(['pack_id', 'kind', 'key', 'item_id'])
        .where('pack_id', '=', packId).orderBy('kind').orderBy('key').execute();
      return rows.map((r) => ({ packId: r.pack_id, kind: r.kind as PackItemKind, key: r.key, itemId: r.item_id }));
    },
    async owners(kind) {
      const rows = await db.selectFrom(T).select(['item_id', 'pack_id']).where('kind', '=', kind).execute();
      return new Map(rows.map((r) => [r.item_id, r.pack_id]));
    },
    async put(item) {
      await db.insertInto(T)
        .values({ pack_id: item.packId, kind: item.kind, key: item.key, item_id: item.itemId })
        .onConflict((oc) => oc.columns(['pack_id', 'kind', 'key']).doUpdateSet({ item_id: item.itemId }))
        .execute();
    },
    async remove(packId, kind, key) {
      await db.deleteFrom(T).where('pack_id', '=', packId).where('kind', '=', kind).where('key', '=', key).execute();
    },
  };
}
