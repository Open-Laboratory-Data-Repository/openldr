import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type HeldReason = 'held' | 'error';

export interface HeldRow {
  copyId: string;
  key: string;
  runId: string;
  reason: HeldReason;
  label: string | null;
  error: string | null;
  heldAt: string;
}

/** A held request with the plugin's own JSON. CE never reads inside `findings` or `check`. */
export interface HeldItem extends HeldRow { findings: unknown; check: unknown }

export interface ImportCheckHeldStore {
  /** Insert or replace by (copyId, key). */
  put(item: Omit<HeldItem, 'heldAt'>): Promise<void>;
  remove(copyId: string, keys: string[]): Promise<void>;
  /** Ordered by key. `total` counts every row that matches the filter, not only the page. */
  list(copyId: string, opts: { reason?: HeldReason; label?: string; offset: number; limit: number }): Promise<{ rows: HeldRow[]; total: number }>;
  get(copyId: string, key: string): Promise<HeldItem | null>;
  /** Delete up to `limit` rows of a copy. 0 means none left. */
  deleteSome(copyId: string, limit: number): Promise<number>;
}

/** Keys per delete statement in `remove`. */
const REMOVE_CHUNK = 1000;

type Stored = {
  copy_id: string; key: string; run_id: string; reason: string; label: string | null; error: string | null;
  held_at: Date | string;
};

function toRow(r: Stored): HeldRow {
  return {
    copyId: r.copy_id,
    key: r.key,
    runId: r.run_id,
    reason: r.reason as HeldReason,
    label: r.label,
    error: r.error,
    heldAt: new Date(r.held_at).toISOString(),
  };
}

export function createImportCheckHeldStore(db: Kysely<InternalSchema>): ImportCheckHeldStore {
  return {
    async put(item) {
      const values = {
        copy_id: item.copyId,
        key: item.key,
        run_id: item.runId,
        reason: item.reason,
        label: item.label,
        error: item.error,
        findings: JSON.stringify(item.findings),
        check: JSON.stringify(item.check),
      };
      await db.insertInto('import_check_held')
        .values(values)
        .onConflict((oc) => oc.columns(['copy_id', 'key']).doUpdateSet((eb) => ({
          run_id: eb.ref('excluded.run_id'),
          reason: eb.ref('excluded.reason'),
          label: eb.ref('excluded.label'),
          error: eb.ref('excluded.error'),
          findings: eb.ref('excluded.findings'),
          check: eb.ref('excluded.check'),
          held_at: new Date(),
        })))
        .execute();
    },

    async remove(copyId, keys) {
      const unique = [...new Set(keys)];
      for (let i = 0; i < unique.length; i += REMOVE_CHUNK) {
        await db.deleteFrom('import_check_held')
          .where('copy_id', '=', copyId).where('key', 'in', unique.slice(i, i + REMOVE_CHUNK))
          .execute();
      }
    },

    async list(copyId, opts) {
      let rowsQ = db.selectFrom('import_check_held')
        .select(['copy_id', 'key', 'run_id', 'reason', 'label', 'error', 'held_at'])
        .where('copy_id', '=', copyId);
      let countQ = db.selectFrom('import_check_held')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('copy_id', '=', copyId);
      if (opts.reason !== undefined) {
        rowsQ = rowsQ.where('reason', '=', opts.reason);
        countQ = countQ.where('reason', '=', opts.reason);
      }
      if (opts.label !== undefined) {
        rowsQ = rowsQ.where('label', '=', opts.label);
        countQ = countQ.where('label', '=', opts.label);
      }
      // Within one copy the key is unique, so this order has no tie.
      const rows = await rowsQ.orderBy('key').limit(opts.limit).offset(opts.offset).execute();
      const count = await countQ.executeTakeFirstOrThrow();
      return { rows: rows.map(toRow), total: Number(count.n) };
    },

    async get(copyId, key) {
      const r = await db.selectFrom('import_check_held')
        .selectAll()
        .where('copy_id', '=', copyId).where('key', '=', key)
        .executeTakeFirst();
      if (!r) return null;
      return { ...toRow(r), findings: r.findings, check: r.check };
    },

    async deleteSome(copyId, limit) {
      // A limit of 0 would answer 0 while rows remain, and 0 means none left.
      if (!Number.isInteger(limit) || limit < 1) throw new Error('deleteSome: limit must be a whole number of 1 or more');
      // Postgres has no DELETE ... LIMIT. Pick the first `limit` keys, unique within a copy, and delete those.
      const picked = await db.selectFrom('import_check_held')
        .select('key')
        .where('copy_id', '=', copyId)
        .orderBy('key')
        .limit(limit)
        .execute();
      let gone = 0;
      for (let i = 0; i < picked.length; i += REMOVE_CHUNK) {
        const res = await db.deleteFrom('import_check_held')
          .where('copy_id', '=', copyId)
          .where('key', 'in', picked.slice(i, i + REMOVE_CHUNK).map((p) => p.key))
          .executeTakeFirst();
        gone += Number(res.numDeletedRows);
      }
      return gone;
    },
  };
}
