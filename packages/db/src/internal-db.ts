import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from './schema/internal';

export interface InternalDb {
  db: Kysely<InternalSchema>;
  close(): Promise<void>;
  withAccountStatusLock<T>(subject: string, work: (db: Kysely<InternalSchema>) => Promise<T>): Promise<T>;
}

export interface InternalDbDeps {
  pool?: pg.Pool;
  /** Told when a connection the pool holds idle dies, as all of them do when Postgres restarts. The
   *  pool drops that connection and opens a new one for the next query, so there is nothing to
   *  repair here. Absent = the loss is ignored. Either way it no longer ends the process. */
  onConnectionError?: (err: Error) => void;
}

export function createInternalDb(url: string, deps: InternalDbDeps = {}): InternalDb {
  const pool = deps.pool ?? new pg.Pool({ connectionString: url });
  // An emitter with no `error` listener throws, which ended the server whenever Postgres restarted.
  // A stand-in pool in a test may have no events at all.
  if (typeof pool.on === 'function') pool.on('error', (err: Error) => { deps.onConnectionError?.(err); });
  const db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool }) });
  return {
    db, close: () => db.destroy(),
    async withAccountStatusLock(subject, work) {
      const client = await pool.connect();
      let locked = false;
      let discard = true;
      const onError = () => { discard = true; };
      client.on('error', onError);
      try {
        const result = await client.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked", [`openldr:account-status:${subject}`],
        );
        locked = result.rows[0]?.locked === true;
        discard = false;
        if (!locked) {
          const error = new Error('another account status change is in progress; retry the action');
          error.name = 'AccountStatusConflictError';
          throw error;
        }
        // Kysely must neither reserve a second client nor release this one.
        const pinned = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool: {
          connect: async () => ({ query: client.query.bind(client), release() {} }),
          end: async () => {},
        } }) });
        try { return await work(pinned); } finally { await pinned.destroy(); }
      } finally {
        try {
          if (locked) {
            const result = await client.query<{ unlocked: boolean }>(
              "select pg_advisory_unlock(hashtextextended($1, 0)) as unlocked", [`openldr:account-status:${subject}`],
            );
            if (result.rows[0]?.unlocked !== true) throw new Error('account status lock could not be released');
          }
        } catch (error) {
          discard = true;
          throw error;
        } finally {
          client.release(discard);
          client.removeListener('error', onError);
        }
      }
    },
  };
}
