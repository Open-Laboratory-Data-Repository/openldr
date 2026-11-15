import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface PluginDataEntry {
  collection: string;
  key: string;
  doc: unknown;
  updatedAt: Date;
}

export interface PluginDataListOptions {
  /** Equality match on a single top-level field of the stored doc. */
  where?: { field: string; eq: unknown };
  /** Cap the number of returned rows. */
  limit?: number;
}

export interface PluginDataStore {
  get(pluginId: string, collection: string, key: string): Promise<unknown | null>;
  put(pluginId: string, collection: string, key: string, doc: unknown): Promise<void>;
  /**
   * Write `doc` only if the stored document is as the caller last saw it. With `null`: only when
   * no document exists. With a number: only when the stored document's `rev` field equals it.
   * Returns whether it wrote. Each case is one statement, so no other write can land between the
   * check and the write.
   */
  putIfRev(pluginId: string, collection: string, key: string, doc: unknown, expectedRev: number | null): Promise<boolean>;
  delete(pluginId: string, collection: string, key: string): Promise<void>;
  list(pluginId: string, collection: string, opts?: PluginDataListOptions): Promise<PluginDataEntry[]>;
  /** Remove an entire plugin namespace (uninstall). */
  purge(pluginId: string): Promise<void>;
}

export function createPluginDataStore(db: Kysely<InternalSchema>): PluginDataStore {
  return {
    async get(pluginId, collection, key) {
      const r = await db.selectFrom('plugin_data').select('doc')
        .where('plugin_id', '=', pluginId).where('collection', '=', collection).where('key', '=', key)
        .executeTakeFirst();
      return r ? (r.doc as unknown) : null;
    },

    async put(pluginId, collection, key, doc) {
      await db.insertInto('plugin_data')
        .values({ plugin_id: pluginId, collection, key, doc: doc as never, updated_at: sql`now()` as never })
        .onConflict((oc) => oc.columns(['plugin_id', 'collection', 'key']).doUpdateSet({ doc: doc as never, updated_at: sql`now()` as never }))
        .execute();
    },

    async putIfRev(pluginId, collection, key, doc, expectedRev) {
      if (expectedRev === null) {
        // One statement with two guards. On Postgres, ON CONFLICT DO NOTHING turns a racing insert
        // into no row, and RETURNING then reports nothing. pg-mem keeps the old row on a conflict
        // but still reports one back, so the NOT EXISTS is what makes its answer true.
        const inserted = await sql<{ key: string }>`
          INSERT INTO plugin_data (plugin_id, collection, key, doc, updated_at)
          SELECT ${pluginId}, ${collection}, ${key}, ${JSON.stringify(doc)}::jsonb, now()
          WHERE NOT EXISTS (
            SELECT 1 FROM plugin_data WHERE plugin_id = ${pluginId} AND collection = ${collection} AND key = ${key}
          )
          ON CONFLICT (plugin_id, collection, key) DO NOTHING
          RETURNING key`.execute(db);
        return inserted.rows.length === 1;
      }
      if (!Number.isSafeInteger(expectedRev)) throw new Error('putIfRev: expectedRev must be a whole number or null');
      // `->>` gives the stored rev as text, so it is compared with the expected rev as text.
      const updated = await db.updateTable('plugin_data')
        .set({ doc: doc as never, updated_at: sql`now()` as never })
        .where('plugin_id', '=', pluginId).where('collection', '=', collection).where('key', '=', key)
        .where(sql`doc ->> 'rev'`, '=', String(expectedRev))
        .returning('key')
        .execute();
      return updated.length === 1;
    },

    async delete(pluginId, collection, key) {
      await db.deleteFrom('plugin_data')
        .where('plugin_id', '=', pluginId).where('collection', '=', collection).where('key', '=', key)
        .execute();
    },

    async list(pluginId, collection, opts) {
      let q = db.selectFrom('plugin_data').select(['collection', 'key', 'doc', 'updated_at'])
        .where('plugin_id', '=', pluginId).where('collection', '=', collection);
      if (opts?.where) {
        const field = opts.where.field;
        if (!/^[A-Za-z0-9_]+$/.test(field)) throw new Error('invalid filter field');
        q = q.where(sql`doc ->> ${field}`, '=', String(opts.where.eq));
      }
      q = q.orderBy('key');
      if (opts?.limit !== undefined) q = q.limit(opts.limit);
      const rows = await q.execute();
      return rows.map((r) => ({ collection: r.collection, key: r.key, doc: r.doc as unknown, updatedAt: r.updated_at }));
    },

    async purge(pluginId) {
      await db.deleteFrom('plugin_data').where('plugin_id', '=', pluginId).execute();
    },
  };
}
