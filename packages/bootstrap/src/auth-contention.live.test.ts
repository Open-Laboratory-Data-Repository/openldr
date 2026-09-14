import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createInternalDb, internalMigrations } from '@openldr/db';
import { createUserStore } from '@openldr/users';

const url = process.env.P16_TEST_DATABASE_URL;

describe.skipIf(!url)('authentication user refresh contention', () => {
  it('allows one stale timestamp refresh and preserves disabled status under concurrency', async () => {
    const schema = `p16_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema "${schema}"`);
    const internal = createInternalDb(url!, {
      pool: new pg.Pool({ connectionString: url, max: 20, options: `-c search_path=${schema}` }),
    });

    try {
      await internalMigrations['006_users'].up(internal.db);
      await internal.db.schema.alterTable('users').addColumn('rbac_initialized', 'boolean', c => c.notNull().defaultTo(false)).execute();
      const users = createUserStore(internal.db);
      const user = await users.syncFromClaims({ sub: 'shared-provider-user', preferred_username: 'ada' });
      const stale = new Date(Date.now() - 16 * 60_000);
      await internal.db.updateTable('users').set({ last_login_at: stale, updated_at: stale }).where('id', '=', user.id).execute();

      await sql`create table p16_user_update_count (count integer not null)`.execute(internal.db);
      await sql`insert into p16_user_update_count (count) values (0)`.execute(internal.db);
      await sql.raw(`
        create function p16_count_user_updates() returns trigger as $$
        begin
          perform pg_sleep(0.05);
          new.status := 'disabled';
          update p16_user_update_count set count = count + 1;
          return new;
        end;
        $$ language plpgsql;
        create trigger p16_count_user_updates
          before update on users
          for each row execute function p16_count_user_updates();
      `).execute(internal.db);

      const results = await Promise.all(Array.from({ length: 20 }, () =>
        users.syncFromClaims({ sub: 'shared-provider-user', preferred_username: 'ada' }),
      ));

      expect(results.every(result => result.status === 'disabled')).toBe(true);
      const counter = await sql<{ count: number }>`select count from p16_user_update_count`.execute(internal.db);
      expect(counter.rows[0]?.count).toBe(1);
      const stored = await internal.db.selectFrom('users').select(['status', 'last_login_at']).where('id', '=', user.id).executeTakeFirstOrThrow();
      expect(stored.status).toBe('disabled');
      expect(new Date(stored.last_login_at!).getTime()).toBeGreaterThan(stale.getTime());
    } finally {
      await internal.close();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  }, 30_000);

  it('inserts once without conflict updates during concurrent first login', async () => {
    const schema = `p16_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema "${schema}"`);
    const internal = createInternalDb(url!, {
      pool: new pg.Pool({ connectionString: url, max: 20, options: `-c search_path=${schema}` }),
    });

    try {
      await internalMigrations['006_users'].up(internal.db);
      await internal.db.schema.alterTable('users').addColumn('rbac_initialized', 'boolean', c => c.notNull().defaultTo(false)).execute();
      await sql`create table p16_user_update_count (count integer not null)`.execute(internal.db);
      await sql`insert into p16_user_update_count (count) values (0)`.execute(internal.db);
      await sql.raw(`
        create function p16_delay_user_insert() returns trigger as $$
        begin
          perform pg_sleep(0.20);
          return new;
        end;
        $$ language plpgsql;
        create trigger p16_delay_user_insert
          after insert on users
          for each row execute function p16_delay_user_insert();
        create function p16_count_user_updates() returns trigger as $$
        begin
          perform pg_sleep(0.05);
          update p16_user_update_count set count = count + 1;
          return new;
        end;
        $$ language plpgsql;
        create trigger p16_count_user_updates
          after update on users
          for each row execute function p16_count_user_updates();
      `).execute(internal.db);
      const users = createUserStore(internal.db);

      const results = await Promise.all(Array.from({ length: 20 }, () =>
        users.syncFromClaims({ sub: 'new-shared-provider-user', preferred_username: 'ada' }),
      ));

      expect(new Set(results.map(result => result.id)).size).toBe(1);
      const counter = await sql<{ count: number }>`select count from p16_user_update_count`.execute(internal.db);
      expect(counter.rows[0]?.count).toBe(0);
      const stored = await internal.db.selectFrom('users').select(['subject', 'last_login_at']).execute();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.subject).toBe('new-shared-provider-user');
      expect(stored[0]?.last_login_at).toBeInstanceOf(Date);
    } finally {
      await internal.close();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  }, 30_000);
});
