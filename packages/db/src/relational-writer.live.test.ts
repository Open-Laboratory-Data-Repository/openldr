import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { createMigrator } from './migrator';
import { externalMigrations } from './migrations/external/index';
import { createRelationalWriter } from './relational-writer';

// Item 16: a projection batch is written in one warehouse transaction. pg-mem does not undo a
// failed transaction, so that a failed batch leaves no row behind can only be shown on real
// PostgreSQL. FHIR_SAVE_TEST_DATABASE_URL points at a server's maintenance database, as for
// fhir-store-save-set.live.test.ts.
const url = process.env.FHIR_SAVE_TEST_DATABASE_URL;

describe.skipIf(!url)('relational writer: atomically, on real PostgreSQL', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: Kysely<any>;
  const name = `relwriter_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: target.toString(), max: 4 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    const r = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    if (r.error) throw r.error;
  });

  afterAll(async () => {
    await db?.destroy();
    await admin?.query(`drop database if exists ${name} with (force)`);
    await admin?.end();
  });

  const patients = async () => (await db.selectFrom('patients').select('id').orderBy('id').execute()).map((r) => r.id);

  it('a_callback_that_throws_leaves_none_of_its_writes', async () => {
    const w = createRelationalWriter(db as never, 'postgres');
    await expect(w.atomically!(async (tx) => {
      await tx.writeMany([
        { resource: { resourceType: 'Patient', id: 'p1' }, provenance: {} },
        { resource: { resourceType: 'Patient', id: 'p2' }, provenance: {} },
      ]);
      await tx.writeIngestEvents([{ resource_type: 'Patient', resource_id: 'p1', version: 1, recorded_at: new Date('2026-01-01T00:00:00Z') }]);
      throw new Error('a later write refused');
    })).rejects.toThrow('a later write refused');
    expect(await patients()).toEqual([]);
    expect(await db.selectFrom('ingest_events').selectAll().execute()).toHaveLength(0);
  });

  it('a_callback_that_returns_keeps_all_of_its_writes', async () => {
    const w = createRelationalWriter(db as never, 'postgres');
    await w.atomically!(async (tx) => {
      await tx.writeMany([{ resource: { resourceType: 'Patient', id: 'p1' }, provenance: {} }]);
      await tx.write({ resourceType: 'Patient', id: 'p2' }, {});
      await tx.writeIngestEvents([{ resource_type: 'Patient', resource_id: 'p1', version: 1, recorded_at: new Date('2026-01-01T00:00:00Z') }]);
    });
    expect(await patients()).toEqual(['p1', 'p2']);
    expect(await db.selectFrom('ingest_events').selectAll().execute()).toHaveLength(1);
  });
});
