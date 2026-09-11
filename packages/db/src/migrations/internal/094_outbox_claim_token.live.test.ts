import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import * as outbox from './002_outbox';
import * as ownership from './094_outbox_claim_token';

const url = process.env.QUEUE_TEST_DATABASE_URL;
describe.skipIf(!url)('outbox claim token migration on isolated Postgres', () => {
  it('preserves pending and processing rows through upgrade and rollback', async () => {
    const schema = `queue_migration_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` }) }) });
    try {
      await outbox.up(db);
      await sql`insert into outbox_events(id,type,payload,status) values ('pending','test','{}','pending'), ('running','test','{}','processing')`.execute(db);
      await ownership.up(db);
      expect((await sql`select id, status, claim_token from outbox_events order by id`.execute(db)).rows).toEqual([
        { id: 'pending', status: 'pending', claim_token: null },
        { id: 'running', status: 'processing', claim_token: null },
      ]);
      await ownership.down(db);
      expect((await sql`select count(*)::int as count from outbox_events`.execute(db)).rows).toEqual([{ count: 2 }]);
    } finally {
      await db.destroy();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  });
});
