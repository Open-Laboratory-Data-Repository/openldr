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
