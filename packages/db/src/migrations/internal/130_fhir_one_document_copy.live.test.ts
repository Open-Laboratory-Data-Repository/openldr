import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createMigrator } from '../../migrator';
import { internalMigrations } from './index';
import { createFhirStore } from '../../fhir-store';

// Item 16: each document is stored once. Before migration 130 the current version of a record
// sat in fhir.fhir_resources and again in fhir.resource_history. After it, fhir.fhir_resources is a
// view: the slim table fhir.fhir_current joined to the history row of the current version.
// This needs real PostgreSQL (pg-mem cannot drop a view, and the proof is about real rows).
// FHIR_SAVE_TEST_DATABASE_URL points at a server's maintenance database.
const url = process.env.FHIR_SAVE_TEST_DATABASE_URL;
const BEFORE = '129_resource_history_content_hash';

describe.skipIf(!url)('migration 130: one copy of each document', () => {
  const name = `fhir_once_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Client;
  let db: Kysely<any>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString(), max: 4 }) }) });
    const r = await createMigrator(db, internalMigrations).migrateTo(BEFORE);
    if (r.error) throw r.error;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    await admin?.query(`drop database if exists ${name} with (force)`);
    await admin?.end();
  });

  const readers = async () => (await sql<any>`select resource_type, id, version::int as version, version_id, resource::text as resource, source_system, plugin_id, plugin_version, batch_id, created_at, updated_at
    from fhir.fhir_resources order by resource_type, id`.execute(db)).rows;
  const kind = async (rel: string) => (await sql<{ k: string }>`select c.relkind as k from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fhir' and c.relname = ${rel}`.execute(db)).rows[0]?.k;

  it('readers see the same current records before and after, and each document is stored once', async () => {
    // Records as an install holds them before the migration.
    await sql`insert into app_settings (key, value) values ('sync.site_id', 'lab-a')`.execute(db);
    // 1. Saved the normal way at that version of the code: a current row and its history row, the same document.
    await sql`insert into fhir.fhir_resources (resource_type, id, version, version_id, resource, batch_id) values ('Patient', 'normal', 2, '2', '{"resourceType":"Patient","id":"normal","gender":"female","meta":{"versionId":"2"}}', 'run-1')`.execute(db);
    await sql`insert into fhir.resource_history (resource_type, id, version, op, resource, content_hash) values
      ('Patient', 'normal', 1, 'upsert', '{"resourceType":"Patient","id":"normal","gender":"male","meta":{"versionId":"1"}}', 'h1'),
      ('Patient', 'normal', 2, 'upsert', '{"resourceType":"Patient","id":"normal","gender":"female","meta":{"versionId":"2"}}', 'h2')`.execute(db);
    // 2. Seeded straight into the current table by an older migration: no history row at all.
    await sql`insert into fhir.fhir_resources (resource_type, id, version, version_id, resource) values ('ValueSet', 'seeded', 1, '1', '{"resourceType":"ValueSet","id":"seeded","status":"active"}')`.execute(db);
    // 3. A history row for the current version that holds another document.
    await sql`insert into fhir.fhir_resources (resource_type, id, version, version_id, resource) values ('Patient', 'differs', 1, '1', '{"resourceType":"Patient","id":"differs","gender":"other"}')`.execute(db);
    await sql`insert into fhir.resource_history (resource_type, id, version, op, resource, content_hash) values ('Patient', 'differs', 1, 'upsert', '{"resourceType":"Patient","id":"differs","gender":"unknown"}', 'stale')`.execute(db);
    // 5. A current row whose history row at that version is a deletion marker with no document.
    //    Nothing writes this, but the view must never show a current record with no document.
    await sql`insert into fhir.fhir_resources (resource_type, id, version, version_id, resource) values ('Patient', 'marker', 2, '2', '{"resourceType":"Patient","id":"marker","gender":"male"}')`.execute(db);
    await sql`insert into fhir.resource_history (resource_type, id, version, op, resource) values ('Patient', 'marker', 2, 'delete', null)`.execute(db);
    // 4. Deleted: history only, no current row.
    await sql`insert into fhir.resource_history (resource_type, id, version, op, resource) values ('Patient', 'gone', 1, 'upsert', '{"resourceType":"Patient","id":"gone"}'), ('Patient', 'gone', 2, 'delete', null)`.execute(db);

    const before = await readers();
    expect(await kind('fhir_resources')).toBe('r');

    const up = await createMigrator(db, internalMigrations).migrateToLatest();
    if (up.error) throw up.error;

    // The same rows, column for column, the timestamps included.
    expect(await readers()).toEqual(before);
    expect(await kind('fhir_resources')).toBe('v');
    expect(await kind('fhir_current')).toBe('r');
    const columns = (await sql<{ c: string }>`select column_name as c from information_schema.columns where table_schema = 'fhir' and table_name = 'fhir_current' order by 1`.execute(db)).rows.map((r) => r.c);
    expect(columns).not.toContain('resource');
    // Every current record now has the history row the view reads.
    const missing = (await sql<{ n: number }>`select count(*)::int as n from fhir.fhir_current c left join fhir.resource_history h on h.resource_type = c.resource_type and h.id = c.id and h.version = c.version where h.id is null`.execute(db)).rows[0].n;
    expect(missing).toBe(0);
    // Where the two differed, the current document won, and its stale hash is gone.
    const fixed = (await sql<any>`select resource ->> 'gender' as gender, content_hash from fhir.resource_history where id = 'differs'`.execute(db)).rows[0];
    expect(fixed).toEqual({ gender: 'other', content_hash: null });
    expect((await sql<any>`select op, resource ->> 'gender' as gender, content_hash from fhir.resource_history where id = 'marker'`.execute(db)).rows[0])
      .toEqual({ op: 'upsert', gender: 'male', content_hash: null });
    expect((await sql<{ n: number }>`select count(*)::int as n from fhir.fhir_resources where resource is null`.execute(db)).rows[0].n).toBe(0);
    // Older versions and a deleted record's history are untouched.
    expect((await sql<any>`select version::int as v, op, content_hash from fhir.resource_history where id in ('normal', 'gone') order by id, version`.execute(db)).rows)
      .toEqual([{ v: 1, op: 'upsert', content_hash: null }, { v: 2, op: 'delete', content_hash: null }, { v: 1, op: 'upsert', content_hash: 'h1' }, { v: 2, op: 'upsert', content_hash: 'h2' }]);
  }, 120_000);

  it('the store saves, reads, skips and deletes through the new shape', async () => {
    const store = createFhirStore(db as never);
    const p = { resourceType: 'Patient', id: 'after-1', name: [{ family: 'A' }] };
    expect((await store.saveMany([p] as never, { batchId: 'b1' }))[0].version).toBe(1);
    expect(((await store.get('Patient', 'after-1')) as any).name[0].family).toBe('A');
    expect(await store.exists('Patient', 'after-1')).toBe(true);
    expect((await store.getWithProvenance('Patient', 'after-1'))!.provenance.batchId).toBe('b1');
    expect((await store.saveMany([{ ...p }] as never, { batchId: 'b2' }, { skipUnchanged: true }))[0].version).toBe(1);
    expect((await store.saveMany([{ ...p, gender: 'male' }] as never, { batchId: 'b3' }))[0].version).toBe(2);
    expect(((await store.get('Patient', 'after-1')) as any).gender).toBe('male');
    // A record from before the migration takes its next version.
    expect((await store.saveMany([{ resourceType: 'Patient', id: 'normal', gender: 'male' }] as never))[0].version).toBe(3);
    // The document is held once: the current table has no copy of it.
    const sizes = (await sql<any>`select (select count(*) from fhir.resource_history where id = 'after-1')::int as history, (select count(*) from fhir.fhir_current where id = 'after-1')::int as current`.execute(db)).rows[0];
    expect(sizes).toEqual({ history: 2, current: 1 });
    await store.delete('Patient', 'after-1');
    expect(await store.get('Patient', 'after-1')).toBeNull();
    expect(await store.exists('Patient', 'after-1')).toBe(false);
  }, 60_000);

  it('going down brings the table back with the same rows, and up again works', async () => {
    const before = await readers();
    const migrator = createMigrator(db, internalMigrations);
    const down = await migrator.migrateTo(BEFORE);
    if (down.error) throw down.error;
    expect(await kind('fhir_resources')).toBe('r');
    expect(await kind('fhir_current')).toBeUndefined();
    expect(await readers()).toEqual(before);
    const up = await migrator.migrateToLatest();
    if (up.error) throw up.error;
    expect(await kind('fhir_resources')).toBe('v');
    expect(await readers()).toEqual(before);
  }, 120_000);
});
