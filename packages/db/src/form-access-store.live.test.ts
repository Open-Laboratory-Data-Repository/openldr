import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from './schema/internal';
import * as formAccess from './migrations/internal/125_form_access';
import { createFormAccessStore } from './form-access-store';

// Two saves of one form's lists at the same moment must each replace the lists, never merge them
// (roles review FR5). pg-mem runs one statement at a time, so only real PostgreSQL can show this.
// Run with FORM_ACCESS_TEST_DATABASE_URL pointing at a disposable database.
const url = process.env.FORM_ACCESS_TEST_DATABASE_URL;
describe.skipIf(!url)('form access saves on disposable PostgreSQL', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: Kysely<InternalSchema>;
  let schema: string;

  beforeEach(async () => {
    schema = `form_access_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 6 });
    db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool }) });
    // The form row the save locks, and the access table itself.
    await sql`create table form_definitions (id text primary key)`.execute(db);
    await sql`insert into form_definitions (id) values ('f1')`.execute(db);
    await formAccess.up(db as Kysely<unknown>);
  });

  afterEach(async () => {
    await db.destroy();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });

  it('waits for a lock held on the form, so saves of one form take turns', async () => {
    const store = createFormAccessStore(db);
    const holder = await admin.connect();
    try {
      await holder.query(`begin`);
      await holder.query(`select id from ${schema}.form_definitions where id = 'f1' for update`);
      let done = false;
      const save = store.set('f1', { open: ['role-a'], submit: [] }).then(() => { done = true; });
      await new Promise((r) => setTimeout(r, 400));
      expect(done).toBe(false);
      await holder.query(`commit`);
      await save;
      expect(done).toBe(true);
    } finally {
      holder.release();
    }
  });

  it('keeps one of two saves made at once, never both merged', async () => {
    const store = createFormAccessStore(db);
    for (let i = 0; i < 20; i += 1) {
      await store.set('f1', { open: [], submit: [] });
      await Promise.all([store.set('f1', { open: ['role-a'], submit: [] }), store.set('f1', { open: ['role-b'], submit: [] })]);
      const after = await store.get('f1');
      expect([['role-a'], ['role-b']]).toContainEqual(after.open);
    }
  });
});
