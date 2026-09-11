import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from '@openldr/db';
import * as migration from '../../db/src/migrations/internal/098_auth_issuer_binding';
import { bindAuthIssuer } from './auth-issuer-binding';

const url = process.env.P09_TEST_DATABASE_URL;
describe.skipIf(!url)('issuer binding on disposable PostgreSQL', () => {
  it('allows only one of two concurrently configured issuers and persists across connections', async () => {
    const schema = `p09_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    const connect = () => new Kysely<InternalSchema>({ dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` }),
    }) });
    const a = connect();
    const b = connect();
    try {
      await migration.up(a as Kysely<unknown>);
      const results = await Promise.allSettled([
        bindAuthIssuer(a, 'https://first.example'), bindAuthIssuer(b, 'https://second.example'),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      const winner = await a.selectFrom('auth_issuer_binding').selectAll().executeTakeFirstOrThrow();
      await bindAuthIssuer(b, winner.issuer);
      await expect(bindAuthIssuer(b, `${winner.issuer}/different`)).rejects.toThrow(/issuer.*bound/i);
      expect(await b.selectFrom('auth_issuer_binding').selectAll().execute()).toEqual([winner]);
    } finally {
      await Promise.all([a.destroy(), b.destroy()]);
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  });
});
