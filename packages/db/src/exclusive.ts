import { type Kysely, sql } from 'kysely';

/** Another process holds the name, and the wait ran out. Nothing was done. */
export class ExclusiveBusy extends Error {
  constructor(readonly lockName: string) {
    super(`busy: ${lockName}`);
    this.name = 'ExclusiveBusy';
  }
}

/**
 * Runs `work` while no other process on this database runs work of the same name. For changes to
 * something outside the database, such as a file, that the server and a CLI command can both make.
 *
 * It holds a PostgreSQL advisory lock for the length of one transaction. PostgreSQL owns the lock:
 * a holder that stops loses its connection and the lock goes with it, so there is no lock file to
 * go stale and nothing to clean up. A holder that is only slow keeps it. The wait is at most
 * `waitMs`, then ExclusiveBusy.
 *
 * `work` does not get the transaction and must not need it. The name is hashed to 64 bits.
 * pg-mem has no advisory locks: exclusive.live.test.ts proves this on real PostgreSQL.
 */
export async function runExclusive<T>(db: Kysely<any>, name: string, waitMs: number, work: () => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    // `true` makes the limit local to this transaction, so the pooled connection is not changed.
    await sql`select set_config('lock_timeout', ${String(Math.max(1, Math.round(waitMs)))}, true)`.execute(trx);
    try {
      await sql`select pg_advisory_xact_lock(hashtextextended(${name}, 0))`.execute(trx);
    } catch (err) {
      // 55P03: lock_not_available, which is what a lock_timeout raises.
      if ((err as { code?: string }).code === '55P03') throw new ExclusiveBusy(name);
      throw err;
    }
    return work();
  });
}
