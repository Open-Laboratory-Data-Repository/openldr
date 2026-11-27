import { type Kysely, sql } from 'kysely';
import { canonicalHash } from '@openldr/core';
import type { InternalSchema } from './schema/internal';
import { type ReferenceCapture, CENTER_OWNED_SETTING_KEYS } from './reference-capture';

export interface AppSettingRecord {
  key: string;
  value: string;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface AppSettingStore {
  get(key: string): Promise<AppSettingRecord | null>;
  getAll(): Promise<AppSettingRecord[]>;
  set(key: string, value: string, updatedBy: string | null): Promise<void>;
}

/** Kept apart from AppSettingStore, so the many stand-ins for that one need not grow a method only one caller uses. */
export interface AppSettingUpdater {
  /**
   * Reads a value, changes it and stores it, as one step that two processes cannot interleave.
   * `change` gets the stored value, or null when the key is not there, and returns the new one.
   * When it throws, nothing is stored. It can be called twice when two processes make the key at
   * the same moment, so it must only work out the new value. For a value that holds a list, where a plain get and set
   * from two processes would lose one of the two changes.
   */
  update(key: string, change: (old: string | null) => string, updatedBy: string | null): Promise<void>;
}

export function createAppSettingsStore(db: Kysely<InternalSchema>, capture?: ReferenceCapture): AppSettingStore & AppSettingUpdater {
  const toRecord = (r: { key: string; value: string; updated_at: Date; updated_by: string | null }): AppSettingRecord => ({
    key: r.key,
    value: r.value,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  });
  // Only center-owned keys propagate to labs. No settings-delete path exists today; a future
  // delete should capture ('setting', key, 'delete', null) for allowlisted keys.
  const captured = async (trx: Parameters<ReferenceCapture['record']>[0], key: string, value: string): Promise<void> => {
    if (capture && CENTER_OWNED_SETTING_KEYS.has(key)) await capture.record(trx, 'setting', key, 'upsert', canonicalHash(value));
  };
  return {
    async get(key) {
      const r = await db.selectFrom('app_settings').selectAll().where('key', '=', key).executeTakeFirst();
      return r ? toRecord(r) : null;
    },
    async getAll() {
      const rows = await db.selectFrom('app_settings').selectAll().orderBy('key').execute();
      return rows.map(toRecord);
    },
    async set(key, value, updatedBy) {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('app_settings')
          .values({ key, value, updated_by: updatedBy, updated_at: sql`now()` as never })
          .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_by: updatedBy, updated_at: sql`now()` as never }))
          .execute();
        await captured(trx, key, value);
      });
    },
    async update(key, change, updatedBy) {
      const once = (): Promise<void> =>
        db.transaction().execute(async (trx) => {
          // The lock holds a second process here until this one commits.
          const row = await trx.selectFrom('app_settings').select('value').where('key', '=', key).forUpdate().executeTakeFirst();
          const value = change(row ? row.value : null);
          if (row) {
            await trx.updateTable('app_settings').set({ value, updated_by: updatedBy, updated_at: sql`now()` as never }).where('key', '=', key).execute();
          } else {
            // A row that is not there cannot be locked. If another process makes it first, this
            // insert fails on the key and the whole step runs again, now with a row to lock.
            await trx.insertInto('app_settings').values({ key, value, updated_by: updatedBy, updated_at: sql`now()` as never }).execute();
          }
          await captured(trx, key, value);
        });
      try {
        await once();
      } catch (err) {
        if ((err as { code?: string }).code !== '23505') throw err;
        await once();
      }
    },
  };
}
