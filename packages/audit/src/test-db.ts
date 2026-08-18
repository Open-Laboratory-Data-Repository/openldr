import { newDb } from 'pg-mem';
import { Kysely, PostgresDialect } from 'kysely';
import { internalMigrations, type InternalSchema } from '@openldr/db';

// applySorts (packages/db/src/table-query-sql.ts) always appends the resource's tiebreaker
// column to ORDER BY, and audit's tiebreaker is "id" — a text column — so every store.list()
// call, sorted or not, emits `collate "en-US-x-icu"` on that tiebreaker. pgsql-ast-parser
// (pg-mem's SQL parser) has no support for the COLLATE clause at all: a hard syntax error, not
// a semantic gap. packages/db hit the same wall and moved every COLLATE-triggering assertion to
// live-Postgres-only tests (packages/db/src/table-query-collation.live.test.ts) — but that
// package could still cover applySorts offline using a synthetic numeric-column table. Audit
// cannot: its tiebreaker is the resource's real primary key, and that key is unavoidably text.
// Following that route here would leave store.list() with zero offline coverage at all.
//
// Instead: strip the COLLATE fragment from the compiled SQL before it reaches pg-mem's parser.
// This is a pg-mem-only compatibility shim — it never runs against real Postgres — and none of
// this package's assertions depend on locale-aware ordering (they check filter results and
// plain-ASCII column order), so running under pg-mem's byte-order collation instead changes
// nothing they verify. The live tiebreaker proof (store-pagination.live.test.ts) is what
// actually proves COLLATE + the tiebreaker together on a real engine.
const COLLATE_RE = /\s+collate\s+"en-US-x-icu"/gi;

function stripCollate(text: string): string {
  return text.replace(COLLATE_RE, '');
}

/** A pg-mem-backed Kysely instance, migrated, with the audit-only COLLATE shim above applied. */
export async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  const originalQuery = pool.query.bind(pool);
  pool.query = (...args: unknown[]) => {
    if (typeof args[0] === 'string') args[0] = stripCollate(args[0]);
    else if (args[0] && typeof (args[0] as { text?: string }).text === 'string') {
      args[0] = { ...(args[0] as { text: string }), text: stripCollate((args[0] as { text: string }).text) };
    }
    return originalQuery(...(args as Parameters<typeof originalQuery>));
  };
  const db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool }) });
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}
