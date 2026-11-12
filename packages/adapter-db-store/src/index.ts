import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { probe } from '@openldr/core';
import type { TargetSchema, TargetStorePort } from '@openldr/ports';

const INT8 = 20;
const NUMERIC = 1700;
/** Whole-part digits a JavaScript number always holds exactly. */
const SAFE_WHOLE_DIGITS = 15;

/**
 * Postgres type parsers that read whole numbers (int8, which COUNT(*) returns) and decimals (numeric,
 * which AVG() and ROUND() return) as numbers. The driver's default hands both over as text, so a
 * workflow compared "9" > "18" as text and turned "18" + 1 into "181" (bug 13).
 *
 * A whole number beyond Number.MAX_SAFE_INTEGER stays text, and so does a decimal whose whole part
 * has more than 15 digits, so the part before the point is never rounded. Every other type, text included, goes
 * to the driver's own parser, so a code such as "10234" in a text column stays text.
 *
 * Set per pool (pg's `types` option), not on the global pg.types, so only pools that opt in change.
 */
export const pgNumberTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary'): unknown {
    if (format !== 'binary' && oid === INT8) {
      return (v: string) => { const n = Number(v); return Number.isSafeInteger(n) ? n : v; };
    }
    if (format !== 'binary' && oid === NUMERIC) {
      return (v: string) => {
        // The whole part must stay exact. Fraction digits past a double's precision round, as any
        // decimal does in JavaScript: an average of 2.3333333333333333 reads as 2.3333333333333335.
        const whole = v.replace(/^[-+]/, '').split('.')[0]!.replace(/^0+/, '');
        const n = Number(v);
        return Number.isFinite(n) && whole.length <= SAFE_WHOLE_DIGITS ? n : v;
      };
    }
    return (pg.types.getTypeParser as (oid: number, format?: string) => unknown)(oid, format);
  },
} as const;

export interface DbStoreConfig {
  url: string;
}

export interface DbStoreDeps {
  pool?: pg.Pool;
}

export interface DbStore extends TargetStorePort {
  close(): Promise<void>;
}

export function createDbStore(cfg: DbStoreConfig, deps: DbStoreDeps = {}): DbStore {
  const pool = deps.pool ?? new pg.Pool({ connectionString: cfg.url, types: pgNumberTypes as never });
  const db = new Kysely<TargetSchema>({ dialect: new PostgresDialect({ pool }) });

  return {
    db,
    async transaction(fn) {
      return db.transaction().execute(fn);
    },
    async healthCheck() {
      return probe(async () => {
        await pool.query('select 1');
      });
    },
    async close() {
      await db.destroy();
    },
  };
}
