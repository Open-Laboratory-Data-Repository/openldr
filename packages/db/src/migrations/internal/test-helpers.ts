import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import type { IMemoryDb } from 'pg-mem';
import { internalMigrations } from './index';

// pg-mem does not support the regex operator (!~) used by Kysely's Migrator introspection.
// We run each migration's up() function directly in order — same structure used by
// packages/dashboards/src/store.test.ts and other pg-mem tests in this repo.
export async function makeMigratedDb(): Promise<Kysely<any>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}

/**
 * A database migrated only as far as `stopAfter` (inclusive).
 *
 * ⛔ For testing a HISTORICAL migration against the schema it actually ran on. Migration 082 reads
 * `national_system`/`national_code`; migration 088 drops them. On a real install 082 runs first and
 * sees them — but `makeMigratedDb()` runs the whole list, so a test that then re-invokes 082's `up()`
 * is running it against a schema that never existed when it shipped, and fails for a reason the
 * migration is not responsible for.
 *
 * Use this ONLY for that case. A test of current behaviour should migrate fully.
 */
export async function makeMigratedDbUpTo(stopAfter: string): Promise<Kysely<any>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  let found = false;
  for (const [name, migration] of Object.entries(internalMigrations)) {
    await migration.up(db);
    if (name === stopAfter) { found = true; break; }
  }
  if (!found) throw new Error(`makeMigratedDbUpTo: no migration named "${stopAfter}"`);
  return db;
}

/** `makeMigratedDbUpTo` with the `IMemoryDb` handle, for the historical-migration tests that also
 *  need `mem.public.interceptQueries` (e.g. 082's chunking assertions). */
export async function makeMigratedDbWithMemUpTo(stopAfter: string): Promise<{ db: Kysely<any>; mem: IMemoryDb }> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  let found = false;
  for (const [name, migration] of Object.entries(internalMigrations)) {
    await migration.up(db);
    if (name === stopAfter) { found = true; break; }
  }
  if (!found) throw new Error(`makeMigratedDbWithMemUpTo: no migration named "${stopAfter}"`);
  return { db, mem };
}

// Same as `makeMigratedDb`, but also returns the underlying `IMemoryDb` handle. `makeMigratedDb`
// itself is used by ~140 test files as a plain `Kysely<any>` factory, so its signature is left
// alone; this sibling exists only for the handful of tests that need `mem.public.interceptQueries`
// to stage a race (e.g. stealing a row between a SELECT and its guarded UPDATE).
export async function makeMigratedDbWithMem(): Promise<{ db: Kysely<any>; mem: IMemoryDb }> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return { db, mem };
}
