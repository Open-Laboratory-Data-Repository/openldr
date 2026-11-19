import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type HeldReason = 'held' | 'error';

export interface HeldRow {
  copyId: string;
  key: string;
  runId: string;
  reason: HeldReason;
  label: string | null;
  /** The laboratory code the plugin named for the request, or null when it named none. */
  laboratory: string | null;
  error: string | null;
  heldAt: string;
}

/** A held request with the plugin's own JSON. CE never reads inside `findings` or `check`. */
export interface HeldItem extends HeldRow {
  findings: unknown;
  check: unknown;
  /** The values as read of the fields a person may correct, as the plugin sent them, or null. */
  fields: Record<string, string | null> | null;
  /** The check pass that held it, or null when unknown. */
  pass: string | null;
}

/** `finding`: only requests the plugin named this finding code for (demo.4 item 10). */
export interface HeldListOptions { reason?: HeldReason; label?: string; laboratory?: string; finding?: string; offset: number; limit: number }

/** Held filters without the page. */
export type HeldFilterOptions = Pick<HeldListOptions, 'reason' | 'label' | 'laboratory' | 'finding'>;

/** One finding code of a copy's held requests and how many requests carry it. */
export interface HeldCodeCount { code: string; count: number }

/** `listItems` reads by offset, as `list` does, or by key. With `after` (a key, or null for the
 *  start) it returns the rows whose key is greater, `offset` is ignored, and the answer adds `next`.
 *  A page read by key does not move when rows before it are added or removed. */
export type HeldItemsOptions = Omit<HeldListOptions, 'offset'> & ({ offset: number; after?: undefined } | { after: string | null; offset?: number });

/** A page of `listItems`. `next` is there only when the page was read by `after`: the last key of
 *  the page, or null when no row is left past it. */
export interface HeldItemsPage { rows: HeldItem[]; total: number; next?: string | null }

export interface ImportCheckHeldStore {
  /** Insert or replace by (copyId, key). */
  /** `codes`: the finding codes the plugin named for the request. They replace the key's earlier codes. */
  put(item: Omit<HeldItem, 'heldAt' | 'fields' | 'pass'> & { fields?: Record<string, string | null> | null; pass?: string | null; codes?: string[] }): Promise<void>;
  remove(copyId: string, keys: string[]): Promise<void>;
  /** Ordered by key. `total` counts every row that matches the filter, not only the page. */
  list(copyId: string, opts: HeldListOptions): Promise<{ rows: HeldRow[]; total: number }>;
  /** The same rows as `list`, in the same order, each with its `findings` and `check`. Read by key
   *  when `after` is given. */
  listItems(copyId: string, opts: HeldItemsOptions): Promise<HeldItemsPage>;
  get(copyId: string, key: string): Promise<HeldItem | null>;
  /** Delete up to `limit` rows of a copy. 0 means none left. */
  deleteSome(copyId: string, limit: number): Promise<number>;
  /** Each finding code of the copy's held requests that match the filter, with its count, most
   *  first, then by code (demo.4 item 10). `finding` in the filter is ignored. */
  codes(copyId: string, opts: HeldFilterOptions): Promise<HeldCodeCount[]>;
}

/** Keys per delete statement in `remove`. */
const REMOVE_CHUNK = 1000;

type Stored = {
  copy_id: string; key: string; run_id: string; reason: string; label: string | null; laboratory: string | null;
  error: string | null; held_at: Date | string;
};

/** The stored values as read: jsonb comes back parsed on Postgres and may come back as text elsewhere. */
function fieldsOf(v: unknown): Record<string, string | null> | null {
  if (v === null || v === undefined) return null;
  return (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, string | null>;
}

function toRow(r: Stored): HeldRow {
  return {
    copyId: r.copy_id,
    key: r.key,
    runId: r.run_id,
    reason: r.reason as HeldReason,
    label: r.label,
    laboratory: r.laboratory,
    error: r.error,
    heldAt: new Date(r.held_at).toISOString(),
  };
}

export function createImportCheckHeldStore(db: Kysely<InternalSchema>): ImportCheckHeldStore {
  /** The rows of a copy that match the filter. */
  function matching(copyId: string, opts: HeldFilterOptions) {
    let q = db.selectFrom('import_check_held').where('copy_id', '=', copyId);
    if (opts.reason !== undefined) q = q.where('reason', '=', opts.reason);
    if (opts.label !== undefined) q = q.where('label', '=', opts.label);
    if (opts.laboratory !== undefined) q = q.where('laboratory', '=', opts.laboratory);
    if (opts.finding !== undefined) {
      const finding = opts.finding;
      q = q.where('key', 'in', db.selectFrom('import_check_held_codes').select('key').where('copy_id', '=', copyId).where('code', '=', finding));
    }
    return q;
  }

  /** The codes of these keys of a copy go. Chunked as `remove` is. */
  async function dropCodes(copyId: string, keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += REMOVE_CHUNK) {
      await db.deleteFrom('import_check_held_codes')
        .where('copy_id', '=', copyId).where('key', 'in', keys.slice(i, i + REMOVE_CHUNK))
        .execute();
    }
  }

  /** One page of the matching rows. Within one copy the key is unique, so this order has no tie. */
  function page<C extends 'copy_id' | 'key' | 'run_id' | 'reason' | 'label' | 'laboratory' | 'error' | 'held_at' | 'findings' | 'check' | 'fields' | 'pass'>(
    copyId: string, opts: HeldListOptions, columns: C[],
  ) {
    return matching(copyId, opts).select(columns).orderBy('key').limit(opts.limit).offset(opts.offset).execute();
  }

  /** Every matching row, not only the page. */
  async function count(copyId: string, opts: HeldFilterOptions): Promise<number> {
    const r = await matching(copyId, opts).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  return {
    async put(item) {
      const values = {
        copy_id: item.copyId,
        key: item.key,
        run_id: item.runId,
        reason: item.reason,
        label: item.label,
        laboratory: item.laboratory,
        error: item.error,
        findings: JSON.stringify(item.findings),
        check: JSON.stringify(item.check),
        fields: item.fields ? JSON.stringify(item.fields) : null,
        pass: item.pass ?? null,
      };
      await db.insertInto('import_check_held')
        .values(values)
        .onConflict((oc) => oc.columns(['copy_id', 'key']).doUpdateSet((eb) => ({
          run_id: eb.ref('excluded.run_id'),
          reason: eb.ref('excluded.reason'),
          label: eb.ref('excluded.label'),
          laboratory: eb.ref('excluded.laboratory'),
          error: eb.ref('excluded.error'),
          findings: eb.ref('excluded.findings'),
          check: eb.ref('excluded.check'),
          fields: eb.ref('excluded.fields'),
          pass: eb.ref('excluded.pass'),
          held_at: new Date(),
        })))
        .execute();
      // The codes follow the row: the earlier ones go, these come in (demo.4 item 10).
      await dropCodes(item.copyId, [item.key]);
      const codes = [...new Set(item.codes ?? [])];
      if (codes.length > 0) {
        await db.insertInto('import_check_held_codes').values(codes.map((code) => ({ copy_id: item.copyId, key: item.key, code }))).execute();
      }
    },

    async remove(copyId, keys) {
      const unique = [...new Set(keys)];
      await dropCodes(copyId, unique);
      for (let i = 0; i < unique.length; i += REMOVE_CHUNK) {
        await db.deleteFrom('import_check_held')
          .where('copy_id', '=', copyId).where('key', 'in', unique.slice(i, i + REMOVE_CHUNK))
          .execute();
      }
    },

    async list(copyId, opts) {
      const rows = await page(copyId, opts, ['copy_id', 'key', 'run_id', 'reason', 'label', 'laboratory', 'error', 'held_at']);
      return { rows: rows.map(toRow), total: await count(copyId, opts) };
    },

    async listItems(copyId, opts) {
      const columns = ['copy_id', 'key', 'run_id', 'reason', 'label', 'laboratory', 'error', 'held_at', 'findings', 'check', 'fields', 'pass'] as const;
      const toItem = (r: Stored & { findings: unknown; check: unknown; fields: unknown; pass: string | null }): HeldItem => ({ ...toRow(r), findings: r.findings, check: r.check, fields: fieldsOf(r.fields), pass: r.pass ?? null });
      if (opts.after === undefined) {
        const rows = await page(copyId, opts, [...columns]);
        return { rows: rows.map(toItem), total: await count(copyId, opts) };
      }
      // By key: one row more than the page, so the last page is known without another call.
      let q = matching(copyId, opts);
      if (opts.after !== null) q = q.where('key', '>', opts.after);
      const got = await q.select([...columns]).orderBy('key').limit(opts.limit + 1).execute();
      const rows = got.slice(0, opts.limit).map(toItem);
      const next = got.length > opts.limit && rows.length > 0 ? rows[rows.length - 1]!.key : null;
      return { rows, total: await count(copyId, opts), next };
    },

    async get(copyId, key) {
      const r = await db.selectFrom('import_check_held')
        .selectAll()
        .where('copy_id', '=', copyId).where('key', '=', key)
        .executeTakeFirst();
      if (!r) return null;
      return { ...toRow(r), findings: r.findings, check: r.check, fields: fieldsOf(r.fields), pass: r.pass ?? null };
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
      await dropCodes(copyId, picked.map((p) => p.key));
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

    async codes(copyId, opts) {
      const { finding: _ignored, ...filters } = opts;
      const rows = await db.selectFrom('import_check_held_codes')
        .select(['code', (eb) => eb.fn.countAll<number>().as('n')])
        .where('copy_id', '=', copyId)
        .where('key', 'in', matching(copyId, filters).select('key'))
        .groupBy('code')
        .execute();
      return rows.map((r) => ({ code: r.code, count: Number(r.n) }))
        .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    },
  };
}
