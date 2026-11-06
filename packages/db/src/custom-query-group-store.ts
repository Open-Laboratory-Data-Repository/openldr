import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

/** A named group of custom queries on the Query page. Local to this install, never synced. */
export interface CustomQueryGroup {
  id: string;
  name: string;
}

export interface CustomQueryGroupStore {
  list(): Promise<CustomQueryGroup[]>;
  get(id: string): Promise<CustomQueryGroup | null>;
  getByName(name: string): Promise<CustomQueryGroup | null>;
  create(g: CustomQueryGroup): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  /** Deletes the group. Its queries stay and move out of any group. */
  remove(id: string): Promise<void>;
}

export function createCustomQueryGroupStore(db: Kysely<InternalSchema>): CustomQueryGroupStore {
  return {
    async list() {
      // Name is unique, so it is a full tiebreaker on its own.
      return db.selectFrom('custom_query_groups').select(['id', 'name']).orderBy('name', 'asc').execute();
    },
    async get(id) {
      return (await db.selectFrom('custom_query_groups').select(['id', 'name']).where('id', '=', id).executeTakeFirst()) ?? null;
    },
    async getByName(name) {
      return (await db.selectFrom('custom_query_groups').select(['id', 'name']).where('name', '=', name).executeTakeFirst()) ?? null;
    },
    async create(g) {
      await db.insertInto('custom_query_groups').values({ id: g.id, name: g.name }).execute();
    },
    async rename(id, name) {
      await db.updateTable('custom_query_groups').set({ name }).where('id', '=', id).execute();
    },
    async remove(id) {
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('custom_queries').set({ group_id: null }).where('group_id', '=', id).execute();
        await trx.deleteFrom('custom_query_groups').where('id', '=', id).execute();
      });
    },
  };
}
