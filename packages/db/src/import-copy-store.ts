import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

export interface CopyRow { detail: string; key: string; seq: number; row: Record<string, unknown> }

/**
 * A set holds more row JSON than the caller allowed. The message holds the set name and the byte
 * count only. A row value is a source value and never goes into an error.
 */
export class CopySetTooLargeError extends Error {
  readonly setName: string;
  /** Bytes of row JSON counted when the read stopped. It is past the limit, and may be below the full size. */
  readonly bytes: number;
  constructor(setName: string, bytes: number, maxBytes: number) {
    super(`copy set ${setName} holds more than ${maxBytes} bytes of rows (counted ${bytes})`);
    this.name = 'CopySetTooLargeError';
    this.setName = setName;
    this.bytes = bytes;
  }
}

export interface ImportCopyStore {
  /** Replace every stored row of these keys in this set with `rows`, in one transaction. */
  replaceKeys(copyId: string, setName: string, keys: string[], rows: CopyRow[]): Promise<void>;
  /** Rows of the given keys, ordered by detail, key, seq. */
  read(copyId: string, setName: string, keys: string[]): Promise<CopyRow[]>;
  /** Up to `limit` distinct keys of a set, in key order, after `after` (null = from the start). */
  listKeys(copyId: string, setName: string, after: string | null, limit: number): Promise<string[]>;
  /** Every row of a set, ordered by detail, key, seq. Throws CopySetTooLargeError past `maxBytes` of row JSON. */
  readSet(copyId: string, setName: string, maxBytes: number): Promise<CopyRow[]>;
  /**
   * Delete up to `limit` rows of a copy. Returns how many went. 0 means the copy is gone.
   * With `setName`, only that set's rows are deleted, and 0 means that set is gone.
   */
  deleteSome(copyId: string, limit: number, setName?: string): Promise<number>;
}

/** Rows per insert statement. Six values a row keeps one statement well under the bind limit. */
const INSERT_CHUNK = 1000;
/** Rows per delete statement in `deleteSome`. Four values a row. */
const DELETE_CHUNK = 1000;
/** Rows per select in `readSet`. */
const READ_CHUNK = 1000;

export function createImportCopyStore(db: Kysely<InternalSchema>): ImportCopyStore {
  return {
    async replaceKeys(copyId, setName, keys, rows) {
      const named = new Set(keys);
      // A row outside `keys` would be added without its old rows being removed first. The message
      // names no key, because a key is a source value.
      if (rows.some((r) => !named.has(r.key))) throw new Error('replaceKeys: a row has a key that is not in keys');
      if (keys.length === 0) return;
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('import_copy_rows')
          .where('copy_id', '=', copyId).where('set_name', '=', setName).where('key', 'in', [...named])
          .execute();
        for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
          await trx.insertInto('import_copy_rows')
            .values(rows.slice(i, i + INSERT_CHUNK).map((r) => ({
              copy_id: copyId,
              set_name: setName,
              detail_name: r.detail,
              key: r.key,
              seq: r.seq,
              row: JSON.stringify(r.row),
            })))
            .execute();
        }
      });
    },

    async read(copyId, setName, keys) {
      if (keys.length === 0) return [];
      const found = await db.selectFrom('import_copy_rows')
        .select(['detail_name', 'key', 'seq', 'row'])
        .where('copy_id', '=', copyId).where('set_name', '=', setName).where('key', 'in', [...new Set(keys)])
        .orderBy('detail_name').orderBy('key').orderBy('seq')
        .execute();
      return found.map((r) => ({ detail: r.detail_name, key: r.key, seq: r.seq, row: r.row }));
    },

    async listKeys(copyId, setName, after, limit) {
      if (!Number.isInteger(limit) || limit < 1) throw new Error('listKeys: limit must be a whole number of 1 or more');
      let q = db.selectFrom('import_copy_rows')
        .select('key')
        .distinct()
        .where('copy_id', '=', copyId).where('set_name', '=', setName);
      if (after !== null) q = q.where('key', '>', after);
      // DISTINCT of one column, ordered by that column: the order is total, so there is no tie.
      const found = await q.orderBy('key').limit(limit).execute();
      return found.map((r) => r.key);
    },

    async readSet(copyId, setName, maxBytes) {
      // Read in chunks after the last (detail, key, seq) seen, so a set that is too large stops
      // early instead of loading whole. The triple with the copy and set is the primary key.
      const out: CopyRow[] = [];
      let bytes = 0;
      let last: { detail: string; key: string; seq: number } | null = null;
      for (;;) {
        let q = db.selectFrom('import_copy_rows')
          .select(['detail_name', 'key', 'seq', 'row'])
          .where('copy_id', '=', copyId).where('set_name', '=', setName);
        if (last !== null) {
          const l = last;
          q = q.where((eb) => eb.or([
            eb('detail_name', '>', l.detail),
            eb.and([eb('detail_name', '=', l.detail), eb('key', '>', l.key)]),
            eb.and([eb('detail_name', '=', l.detail), eb('key', '=', l.key), eb('seq', '>', l.seq)]),
          ]));
        }
        const chunk = await q.orderBy('detail_name').orderBy('key').orderBy('seq').limit(READ_CHUNK).execute();
        for (const r of chunk) {
          bytes += Buffer.byteLength(JSON.stringify(r.row), 'utf8');
          if (bytes > maxBytes) throw new CopySetTooLargeError(setName, bytes, maxBytes);
          out.push({ detail: r.detail_name, key: r.key, seq: r.seq, row: r.row });
        }
        if (chunk.length < READ_CHUNK) return out;
        const tail = chunk[chunk.length - 1]!;
        last = { detail: tail.detail_name, key: tail.key, seq: tail.seq };
      }
    },

    async deleteSome(copyId, limit, setName) {
      // A limit of 0 would answer 0 while rows remain, and 0 means the copy is gone.
      if (!Number.isInteger(limit) || limit < 1) throw new Error('deleteSome: limit must be a whole number of 1 or more');
      // Postgres has no DELETE ... LIMIT. Pick the first `limit` primary keys in primary key order,
      // which is unique, then delete exactly those.
      let pick = db.selectFrom('import_copy_rows')
        .select(['set_name', 'detail_name', 'key', 'seq'])
        .where('copy_id', '=', copyId);
      if (setName !== undefined) pick = pick.where('set_name', '=', setName);
      const picked = await pick
        .orderBy('set_name').orderBy('key').orderBy('detail_name').orderBy('seq')
        .limit(limit)
        .execute();
      let gone = 0;
      for (let i = 0; i < picked.length; i += DELETE_CHUNK) {
        const chunk = picked.slice(i, i + DELETE_CHUNK);
        const res = await db.deleteFrom('import_copy_rows')
          .where('copy_id', '=', copyId)
          .where((eb) => eb.or(chunk.map((p) => eb.and([
            eb('set_name', '=', p.set_name),
            eb('detail_name', '=', p.detail_name),
            eb('key', '=', p.key),
            eb('seq', '=', p.seq),
          ]))))
          .executeTakeFirst();
        gone += Number(res.numDeletedRows);
      }
      return gone;
    },
  };
}
