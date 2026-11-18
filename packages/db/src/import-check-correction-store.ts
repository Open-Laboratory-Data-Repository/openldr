import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

/** One field a person corrected in a held request (design 2026-11-18-held-corrections). */
export interface Correction {
  copyId: string;
  key: string;
  field: string;
  /** The value to use. Null clears the field. */
  value: string | null;
  /** The value as read, which this one replaces. */
  original: string | null;
  reason: string;
  correctedBy: string;
  correctedAt: string;
}

export interface ImportCheckCorrectionStore {
  /** Insert or replace by (copyId, key, field). */
  put(c: Omit<Correction, 'correctedAt'> & { correctedAt: Date }): Promise<void>;
  /** The corrections of the given keys, each key's ordered by field. A key with none is absent. */
  listFor(copyId: string, keys: string[]): Promise<Map<string, Correction[]>>;
  remove(copyId: string, keys: string[]): Promise<void>;
  /** Delete up to `limit` keys' corrections of a copy. Answers the rows deleted; 0 means none left. */
  deleteSome(copyId: string, limit: number): Promise<number>;
  /** Stores corrections only while their check run still holds this correction's claim (design
   *  2026-11-18-held-corrections, review H17). In one transaction it locks the run's row in
   *  `plugin_data`, checks that `correcting.token` is `token`, that `correcting.until` is after
   *  `nowMs`, and that the run's status is not one of `liveStatuses`, and only then writes. A check
   *  is queued by updating that same row, so the two are ordered by the database. False: nothing
   *  was written. */
  putUnderClaim(claim: { pluginId: string; collection: string; runKey: string; token: string; nowMs: number; liveStatuses: string[] },
    rows: Array<Omit<Correction, 'correctedAt'> & { correctedAt: Date }>): Promise<boolean>;
}

/** Keys per statement. */
const CHUNK = 1000;

export function createImportCheckCorrectionStore(db: Kysely<InternalSchema>): ImportCheckCorrectionStore {
  return {
    async put(c) {
      await db.insertInto('import_check_corrections')
        .values({
          copy_id: c.copyId, key: c.key, field: c.field, value: c.value, original: c.original,
          reason: c.reason, corrected_by: c.correctedBy, corrected_at: c.correctedAt,
        })
        .onConflict((oc) => oc.columns(['copy_id', 'key', 'field']).doUpdateSet((eb) => ({
          value: eb.ref('excluded.value'),
          original: eb.ref('excluded.original'),
          reason: eb.ref('excluded.reason'),
          corrected_by: eb.ref('excluded.corrected_by'),
          corrected_at: eb.ref('excluded.corrected_at'),
        })))
        .execute();
    },

    async listFor(copyId, keys) {
      const out = new Map<string, Correction[]>();
      const unique = [...new Set(keys)];
      for (let i = 0; i < unique.length; i += CHUNK) {
        const rows = await db.selectFrom('import_check_corrections').selectAll()
          .where('copy_id', '=', copyId).where('key', 'in', unique.slice(i, i + CHUNK))
          .orderBy('key').orderBy('field')
          .execute();
        for (const r of rows) {
          const list = out.get(r.key) ?? [];
          list.push({
            copyId: r.copy_id, key: r.key, field: r.field, value: r.value, original: r.original, reason: r.reason,
            correctedBy: r.corrected_by, correctedAt: new Date(r.corrected_at).toISOString(),
          });
          out.set(r.key, list);
        }
      }
      return out;
    },

    async remove(copyId, keys) {
      const unique = [...new Set(keys)];
      for (let i = 0; i < unique.length; i += CHUNK) {
        await db.deleteFrom('import_check_corrections')
          .where('copy_id', '=', copyId).where('key', 'in', unique.slice(i, i + CHUNK))
          .execute();
      }
    },

    async putUnderClaim(claim, rows) {
      return db.transaction().execute(async (trx) => {
        const run = await trx.selectFrom('plugin_data').select('doc')
          .where('plugin_id', '=', claim.pluginId).where('collection', '=', claim.collection).where('key', '=', claim.runKey)
          .forUpdate().executeTakeFirst();
        const doc = (typeof run?.doc === 'string' ? JSON.parse(run.doc) : run?.doc) as
          { status?: string; correcting?: { token?: string; until?: string } } | undefined;
        const held = doc?.correcting?.token === claim.token
          && Date.parse(doc.correcting.until ?? '') > claim.nowMs
          && !claim.liveStatuses.includes(doc.status ?? '');
        if (!held) return false;
        for (const c of rows) {
          await trx.insertInto('import_check_corrections')
            .values({
              copy_id: c.copyId, key: c.key, field: c.field, value: c.value, original: c.original,
              reason: c.reason, corrected_by: c.correctedBy, corrected_at: c.correctedAt,
            })
            .onConflict((oc) => oc.columns(['copy_id', 'key', 'field']).doUpdateSet((eb) => ({
              value: eb.ref('excluded.value'), original: eb.ref('excluded.original'), reason: eb.ref('excluded.reason'),
              corrected_by: eb.ref('excluded.corrected_by'), corrected_at: eb.ref('excluded.corrected_at'),
            })))
            .execute();
        }
        return true;
      });
    },

    async deleteSome(copyId, limit) {
      if (!Number.isInteger(limit) || limit < 1) throw new Error('deleteSome: limit must be a whole number of 1 or more');
      // Postgres has no DELETE ... LIMIT. Pick the first `limit` keys and delete theirs.
      const picked = await db.selectFrom('import_check_corrections').select('key').distinct()
        .where('copy_id', '=', copyId).orderBy('key').limit(limit).execute();
      if (picked.length === 0) return 0;
      const res = await db.deleteFrom('import_check_corrections')
        .where('copy_id', '=', copyId).where('key', 'in', picked.map((p) => p.key))
        .executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}
