import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

/** A dataset a content pack defines: one SELECT whose result CE keeps as the warehouse table
 *  `dataset.<name>`. The fields from `builtAtSeq` on describe its last build that worked. */
export interface WarehouseDataset {
  name: string;
  /** The pack's id, without its version, so a new version of the pack replaces its own datasets. */
  ownerPack: string;
  sql: string;
  /** Each entry is the columns of one plain index. */
  indexes: string[][];
  /** Where the pack listed it. Datasets build in this order, so one can read another before it. */
  position: number;
  /** The newest change number the warehouse held when the last build started. Null before a build. */
  builtAtSeq: number | null;
  builtAt: string | null;
  buildMs: number | null;
  rowCount: number | null;
  /** Why the newest build failed. Null once a build works. The table of the last good build stays. */
  lastError: string | null;
}

export interface WarehouseDatasetDef { name: string; sql: string; indexes?: string[][] }

export interface WarehouseDatasetStore {
  /** Ordered by owner pack, then the pack's own order. */
  list(): Promise<WarehouseDataset[]>;
  get(name: string): Promise<WarehouseDataset | undefined>;
  /** Makes `defs`, in order, the datasets `ownerPack` owns. One it no longer lists is removed. One
   *  whose SQL and indexes did not change keeps its last build. A changed one loses it, so it shows
   *  as never built. Throws `dataset <name> belongs to <pack>` when another pack owns a name, and
   *  then writes nothing. */
  replaceForPack(ownerPack: string, defs: WarehouseDatasetDef[]): Promise<void>;
  markBuilt(name: string, built: { seq: number; ms: number; rows: number }): Promise<void>;
  markFailed(name: string, error: string): Promise<void>;
  remove(name: string): Promise<void>;
}

const T = 'warehouse_datasets' as const;

function fromRow(r: Record<string, unknown>): WarehouseDataset {
  // jsonb comes back parsed on PostgreSQL and as text on pg-mem. bigint comes back as text.
  const indexes = typeof r.indexes === 'string' ? JSON.parse(r.indexes) : (r.indexes ?? []);
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    name: String(r.name), ownerPack: String(r.owner_pack), sql: String(r.sql), indexes: indexes as string[][],
    position: Number(r.position),
    builtAtSeq: num(r.built_at_seq),
    builtAt: r.built_at ? new Date(r.built_at as string | number | Date).toISOString() : null,
    buildMs: num(r.build_ms), rowCount: num(r.row_count),
    lastError: (r.last_error as string | null) ?? null,
  };
}

export function createWarehouseDatasetStore(db: Kysely<InternalSchema>): WarehouseDatasetStore {
  const store: WarehouseDatasetStore = {
    async list() {
      const rows = await db.selectFrom(T).selectAll().orderBy('owner_pack').orderBy('position').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(name) {
      const r = await db.selectFrom(T).selectAll().where('name', '=', name).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async replaceForPack(ownerPack, defs) {
      await db.transaction().execute(async (trx) => {
        const existing = (await trx.selectFrom(T).selectAll().execute()).map((r) => fromRow(r as Record<string, unknown>));
        const byName = new Map(existing.map((d) => [d.name, d]));
        for (const def of defs) {
          const other = byName.get(def.name);
          if (other && other.ownerPack !== ownerPack) throw new Error(`dataset ${def.name} belongs to ${other.ownerPack}`);
        }
        const listed = new Set(defs.map((d) => d.name));
        for (const d of existing) {
          if (d.ownerPack === ownerPack && !listed.has(d.name)) await trx.deleteFrom(T).where('name', '=', d.name).execute();
        }
        for (const [position, def] of defs.entries()) {
          const indexes = JSON.stringify(def.indexes ?? []);
          const before = byName.get(def.name);
          if (!before) {
            await trx.insertInto(T).values({ name: def.name, owner_pack: ownerPack, sql: def.sql, indexes, position } as never).execute();
          } else if (before.sql === def.sql && JSON.stringify(before.indexes) === indexes) {
            await trx.updateTable(T).set({ position, updated_at: new Date() } as never).where('name', '=', def.name).execute();
          } else {
            await trx.updateTable(T).set({
              sql: def.sql, indexes, position, built_at_seq: null, built_at: null, build_ms: null, row_count: null, last_error: null, updated_at: new Date(),
            } as never).where('name', '=', def.name).execute();
          }
        }
      });
    },
    async markBuilt(name, built) {
      await db.updateTable(T).set({
        built_at_seq: built.seq, built_at: new Date(), build_ms: Math.round(built.ms), row_count: built.rows, last_error: null, updated_at: new Date(),
      } as never).where('name', '=', name).execute();
    },
    async markFailed(name, error) {
      await db.updateTable(T).set({ last_error: error, updated_at: new Date() } as never).where('name', '=', name).execute();
    },
    async remove(name) {
      await db.deleteFrom(T).where('name', '=', name).execute();
    },
  };
  return store;
}
