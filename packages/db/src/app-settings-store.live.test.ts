import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createAppSettingsStore } from './app-settings-store';

// `update` relies on a row lock and on a key conflict between two transactions. pg-mem runs one
// statement at a time and shows neither, so it is proved here on real PostgreSQL. Two stores with
// their own pools stand for the server and a CLI command. FHIR_SAVE_TEST_DATABASE_URL points at a
// server's maintenance database, as for relational-writer.live.test.ts.
const url = process.env.FHIR_SAVE_TEST_DATABASE_URL;

describe.skipIf(!url)('app settings update from two processes, on real PostgreSQL', () => {
  let admin: pg.Client;
  const dbs: Kysely<any>[] = [];
  const dbName = `app_settings_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    for (let i = 0; i < 2; i++) dbs.push(new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString(), max: 5 }) }) }));
    // Only the one table the store reads, with the columns of the real one.
    await sql`create table app_settings (key text primary key, value text not null, updated_at timestamptz not null default now(), updated_by text)`.execute(dbs[0]!);
  });

  afterAll(async () => {
    for (const db of dbs) await db.destroy();
    await admin?.query(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
  });

  const adder = (db: Kysely<any>, key: string) => (host: string) =>
    createAppSettingsStore(db).update(key, (old) => JSON.stringify([...(old ? (JSON.parse(old) as string[]) : []), host]), null);

  it('keeps every change when two processes add to a key that is not there yet', async () => {
    const [a, b] = [adder(dbs[0]!, 'fresh'), adder(dbs[1]!, 'fresh')];
    await Promise.all([a('one'), b('two')]);
    const row = await createAppSettingsStore(dbs[0]!).get('fresh');
    expect((JSON.parse(row!.value) as string[]).sort()).toEqual(['one', 'two']);
  });

  it('keeps every change when many are made at once to a key that is there', async () => {
    const [a, b] = [adder(dbs[0]!, 'busy'), adder(dbs[1]!, 'busy')];
    await a('start');
    const hosts = Array.from({ length: 20 }, (_, i) => `h${i}`);
    await Promise.all(hosts.map((h, i) => (i % 2 === 0 ? a : b)(h)));
    const row = await createAppSettingsStore(dbs[1]!).get('busy');
    expect((JSON.parse(row!.value) as string[]).sort()).toEqual(['start', ...hosts].sort());
  });

  it('keeps every change when many processes make the same new key at once', async () => {
    for (let round = 0; round < 5; round++) {
      const key = `race${round}`;
      const hosts = Array.from({ length: 6 }, (_, i) => `h${i}`);
      await Promise.all(hosts.map((h, i) => adder(dbs[i % 2]!, key)(h)));
      const row = await createAppSettingsStore(dbs[0]!).get(key);
      expect((JSON.parse(row!.value) as string[]).sort()).toEqual(hosts);
    }
  });
});
