import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from './schema/internal';
import * as dashboardAccess from './migrations/internal/126_dashboard_access';
import { createDashboardAccessStore } from './dashboard-access-store';

// Two shares of one dashboard saved at once must each replace the list and report their own before
// and after (the lessons of roles part 1, review FR5 and FR10). Only real PostgreSQL shows this.
// Run with DASHBOARD_ACCESS_TEST_DATABASE_URL pointing at a disposable database.
const url = process.env.DASHBOARD_ACCESS_TEST_DATABASE_URL;
describe.skipIf(!url)('dashboard share saves on disposable PostgreSQL', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: Kysely<InternalSchema>;
  let schema: string;

  beforeEach(async () => {
    schema = `dashboard_access_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 6 });
    db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool }) });
    await sql`create table dashboards (id text primary key)`.execute(db);
    await sql`insert into dashboards (id) values ('d1')`.execute(db);
    await dashboardAccess.up(db as Kysely<unknown>);
  });

  afterEach(async () => {
    await db.destroy();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });

  it('waits for a lock held on the dashboard', async () => {
    const store = createDashboardAccessStore(db);
    const holder = await admin.connect();
    try {
      await holder.query('begin');
      await holder.query(`select id from ${schema}.dashboards where id = 'd1' for update`);
      let done = false;
      const save = store.set('d1', ['role-a']).then(() => { done = true; });
      await new Promise((r) => setTimeout(r, 400));
      expect(done).toBe(false);
      await holder.query('commit');
      await save;
      expect(done).toBe(true);
    } finally {
      holder.release();
    }
  });

  it('keeps one of two saves made at once, and each returns its own before and after', async () => {
    const store = createDashboardAccessStore(db);
    for (let i = 0; i < 20; i += 1) {
      await store.set('d1', []);
      const [a, b] = await Promise.all([store.set('d1', ['role-a']), store.set('d1', ['role-b'])]);
      expect(a.after).toEqual(['role-a']);
      expect(b.after).toEqual(['role-b']);
      expect([a.before, b.before].sort()).toEqual([[], a.before.length ? ['role-b'] : ['role-a']].sort());
      expect([['role-a'], ['role-b']]).toContainEqual(await store.get('d1'));
    }
  });
});
