import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from './schema/internal';
import * as scopes from './migrations/internal/127_user_data_scopes';
import { createUserDataScopeStore } from './user-data-scope-store';

// Two limits saved at once for one user must each replace it and report their own before and after
// (the lessons of roles part 1, review FR5 and FR10), also for a user with no row yet. Only real
// PostgreSQL shows this. Run with USER_DATA_SCOPE_TEST_DATABASE_URL pointing at a disposable database.
const url = process.env.USER_DATA_SCOPE_TEST_DATABASE_URL;
describe.skipIf(!url)('user data scope saves on disposable PostgreSQL', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: Kysely<InternalSchema>;
  let schema: string;

  beforeEach(async () => {
    schema = `user_data_scope_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 6 });
    db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool }) });
    await scopes.up(db as Kysely<unknown>);
  });

  afterEach(async () => {
    await db.destroy();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });

  const a = { limited: true as const, facilities: ['fa'], districts: [], regions: [] };
  const b = { limited: true as const, facilities: [], districts: [{ region: 'R', district: 'D' }], regions: [] };

  it('waits for a lock held on the user\'s row', async () => {
    const store = createUserDataScopeStore(db);
    await store.set('u1', a);
    const holder = await admin.connect();
    try {
      await holder.query('begin');
      await holder.query(`select subject from ${schema}.user_data_scopes where subject = 'u1' for update`);
      let done = false;
      const save = store.set('u1', b).then(() => { done = true; });
      await new Promise((r) => setTimeout(r, 400));
      expect(done).toBe(false);
      await holder.query('commit');
      await save;
      expect(done).toBe(true);
    } finally {
      holder.release();
    }
  });

  it('keeps one of two saves made at once, from no row, and each returns its own before and after', async () => {
    const store = createUserDataScopeStore(db);
    for (let i = 0; i < 20; i += 1) {
      await store.set('u1', { limited: false });
      const [ra, rb] = await Promise.all([store.set('u1', a), store.set('u1', b)]);
      expect(ra.after).toEqual(a);
      expect(rb.after).toEqual(b);
      const befores = [ra.before, rb.before];
      expect(befores).toContainEqual({ limited: false });
      expect(befores.some((x) => JSON.stringify(x) === JSON.stringify(a) || JSON.stringify(x) === JSON.stringify(b))).toBe(true);
      expect([a, b]).toContainEqual(await store.get('u1'));
    }
  });
});
