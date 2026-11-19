import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createMigrator } from './migrator';
import { internalMigrations } from './migrations/internal/index';
import { createFhirStore, type FhirStore } from './fhir-store';

// Item 16: on real PostgreSQL a save is one set-based statement. pg-mem cannot run that statement,
// so the unit tests exercise the row-by-row path. This file is the proof that the two paths store
// the same rows: every scenario runs through both, each in its own fresh database, and the three
// tables and the returned refs are compared. FHIR_SAVE_TEST_DATABASE_URL points at a server's
// maintenance database, as for fhir-store-save-many.live.test.ts.
const url = process.env.FHIR_SAVE_TEST_DATABASE_URL;

type Db = Kysely<any>;
interface World { name: string; pool: pg.Pool; db: Db; store: FhirStore }

describe.skipIf(!url)('saveMany: the set-based statement stores what the row path stores', () => {
  let admin: pg.Client;
  const worlds: World[] = [];

  async function world(mode: 'rows' | 'set'): Promise<World> {
    const name = `fhir_set_${mode}_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`create database ${name}`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: target.toString(), max: 4 });
    const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    const r = await createMigrator(db, internalMigrations).migrateToLatest();
    if (r.error) throw r.error;
    await db.insertInto('app_settings').values({ key: 'sync.site_id', value: 'lab-a' }).execute();
    const w = { name, pool, db, store: createFhirStore(db as never, { saveMode: mode }) };
    worlds.push(w);
    return w;
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
  }, 120_000);

  afterAll(async () => {
    for (const w of worlds) {
      await w.db.destroy();
      await admin.query(`drop database if exists ${w.name} with (force)`);
    }
    await admin?.end();
  });

  /** Everything a save leaves behind, without the clock: the stamp time and the row times. */
  async function dump(db: Db) {
    const history = (await sql<any>`select resource_type, id, version::int as version, op, content_hash, (resource #- '{meta,lastUpdated}')::text as resource
      from fhir.resource_history where id not like 'vs-%' order by resource_type, id, version`.execute(db)).rows;
    const current = (await sql<any>`select resource_type, id, version::int as version, version_id, (resource #- '{meta,lastUpdated}')::text as resource, source_system, plugin_id, plugin_version, batch_id
      from fhir.fhir_resources where id not like 'vs-%' order by resource_type, id`.execute(db)).rows;
    const changes = (await sql<any>`select resource_type, resource_id, version::int as version, op, content_hash, site_id
      from fhir.change_log where resource_id not like 'vs-%' order by seq`.execute(db)).rows;
    const stamped = (await sql<any>`select count(*)::int as n from fhir.resource_history where op = 'upsert' and id not like 'vs-%'
      and (resource -> 'meta' ->> 'lastUpdated') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'`.execute(db)).rows[0].n;
    return { history, current, changes, badStamps: stamped };
  }

  const p = (id: string, over: Record<string, unknown> = {}) => ({ resourceType: 'Patient', id, name: [{ family: 'A' }], ...over });
  const obs = (id: string, value: unknown) => ({ resourceType: 'Observation', id, status: 'final', code: { text: 'Hb' }, valueQuantity: { value, unit: 'g/dL' } });

  /** The same calls, in the same order, on any store. Returns what each call returned. */
  async function scenario(store: FhirStore) {
    const out: unknown[] = [];
    const prov = { batchId: 'run-1', pluginId: 'plug', pluginVersion: '0.1.4', sourceSystem: 'src' };
    // New records of several types, one carrying its own meta.
    out.push(await store.saveMany([p('p1'), p('p2', { meta: { profile: ['x'], source: 'lab' } }), obs('o1', 4.2), { resourceType: 'Organization', id: 'lab-1', name: 'Lab one' }] as never, prov));
    // One id twice in a call, then again: versions 2 and 3.
    out.push(await store.saveMany([p('p1', { gender: 'male' }), p('p1', { gender: 'female' })] as never, prov));
    // An identical save without the skip still makes a version.
    out.push(await store.saveMany([p('p2', { meta: { profile: ['x'], source: 'lab' } })] as never, prov));
    // With the skip: the unchanged one is skipped, the changed one saved, a new one saved.
    out.push(await store.saveMany([{ resourceType: 'Organization', id: 'lab-1', name: 'Lab one' }, obs('o1', 4.3), p('p3')] as never, { ...prov, batchId: 'run-2' }, { skipUnchanged: true }));
    // With the skip, in one call: same twice, then A B A, then a record equal to the stored one twice.
    out.push(await store.saveMany([p('p4'), p('p4')] as never, prov, { skipUnchanged: true }));
    out.push(await store.saveMany([p('p4'), p('p4', { gender: 'male' }), p('p4')] as never, prov, { skipUnchanged: true }));
    out.push(await store.saveMany([p('p3'), p('p3')] as never, prov, { skipUnchanged: true }));
    // Deleted since: saved again even with the skip.
    await store.delete('Patient', 'p2');
    out.push(await store.saveMany([p('p2', { meta: { profile: ['x'], source: 'lab' } })] as never, prov, { skipUnchanged: true }));
    // A call that skips everything.
    out.push(await store.saveMany([p('p3'), { resourceType: 'Organization', id: 'lab-1', name: 'Lab one' }] as never, prov, { skipUnchanged: true }));
    // Numbers as written, and a wide list.
    out.push(await store.saveMany([obs('o2', 4.20), obs('o3', 12345678901234567890), obs('o4', 1e-7)] as never, prov));
    const many = Array.from({ length: 1203 }, (_, i) => p(`m${i}`, { gender: i % 2 ? 'male' : 'female' }));
    out.push((await store.saveMany(many as never, prov)).length);
    out.push((await store.saveMany(many.map((r, i) => (i % 100 === 0 ? { ...r, gender: 'other' } : r)) as never, prov, { skipUnchanged: true })).filter((r) => r.version === 2).length);
    out.push(await store.saveMany([] as never, prov));
    return out;
  }

  it('every scenario leaves the same three tables and returns the same refs', async () => {
    const rows = await world('rows');
    const set = await world('set');
    const fromRows = await scenario(rows.store);
    const fromSet = await scenario(set.store);
    expect(fromSet).toEqual(fromRows);
    const a = await dump(rows.db);
    const b = await dump(set.db);
    expect(b.history).toEqual(a.history);
    expect(b.current).toEqual(a.current);
    expect(b.changes).toEqual(a.changes);
    expect(a.badStamps).toBe(0);
    expect(b.badStamps).toBe(0);
    expect(a.history.length).toBeGreaterThan(1200);
  }, 180_000);

  it('auto picks the set-based statement on PostgreSQL', async () => {
    const w = await world('set');
    const auto = createFhirStore(w.db as never);
    const seen: string[] = [];
    const spy = createFhirStore(w.db.withPlugin({
      transformQuery({ node }: { node: any }) { if (node.kind === 'RawNode') seen.push((node.sqlFragments ?? []).join('?')); return node; },
      async transformResult({ result }: { result: any }) { return result; },
    } as never) as never);
    await auto.saveMany([p('auto-1')] as never);
    await spy.saveMany([p('auto-2')] as never);
    expect(seen.some((q) => q.includes('unnest') && q.includes('fhir.resource_history'))).toBe(true);
    expect((await w.db.selectFrom('fhir.resource_history').select('id').where('id', 'in', ['auto-1', 'auto-2']).execute()).length).toBe(2);
  }, 60_000);

  it('change rows take their numbers in input order, after the history row exists', async () => {
    const w = await world('set');
    const ids = Array.from({ length: 300 }, (_, i) => `ord-${String(i).padStart(3, '0')}`).reverse();
    await w.store.saveMany(ids.map((id) => p(id)) as never);
    const rows = await w.db.selectFrom('fhir.change_log').select(['resource_id']).where('resource_id', 'like', 'ord-%').orderBy('seq').execute();
    expect(rows.map((r) => r.resource_id)).toEqual(ids);
  }, 60_000);

  it('a refusal on one record of a call saves none of the call', async () => {
    const w = await world('set');
    await sql`alter table fhir.resource_history add constraint no_poison check (id <> 'poison')`.execute(w.db);
    await expect(w.store.saveMany([p('ok-1'), p('poison'), p('ok-2')] as never)).rejects.toThrow();
    expect((await w.db.selectFrom('fhir.fhir_resources').select('id').where('id', 'in', ['ok-1', 'poison', 'ok-2']).execute()).length).toBe(0);
    expect((await w.db.selectFrom('fhir.change_log').select('seq').where('resource_id', 'in', ['ok-1', 'poison', 'ok-2']).execute()).length).toBe(0);
  }, 60_000);

  it('a writer that loses the race for a version gets 23505 and leaves nothing of its call', async () => {
    const w = await world('set');
    // Another transaction has written version 1 of the shared key and has not committed yet.
    const other = await w.pool.connect();
    try {
      await other.query('begin');
      await other.query(`insert into fhir.resource_history (resource_type, id, version, op, resource) values ('Patient', 'race', 1, 'upsert', '{"resourceType":"Patient","id":"race"}')`);
      const mine = w.store.saveMany([p('race-own'), p('race')] as never).then(() => ({ ok: true as const }), (e: { code?: string }) => ({ ok: false as const, code: e.code }));
      // The save now waits on the other transaction's uncommitted history row.
      await new Promise((r) => setTimeout(r, 300));
      await other.query('commit');
      expect(await mine).toEqual({ ok: false, code: '23505' });
    } finally {
      other.release();
    }
    expect((await w.db.selectFrom('fhir.fhir_resources').select('id').where('id', 'in', ['race-own', 'race']).execute()).length).toBe(0);
    expect((await w.db.selectFrom('fhir.change_log').select('seq').where('resource_id', 'in', ['race-own', 'race']).execute()).length).toBe(0);
    expect((await w.db.selectFrom('fhir.resource_history').select('id').where('id', '=', 'race-own').execute()).length).toBe(0);
  }, 60_000);

  it('a meta that is not an object is replaced, as the row path does', async () => {
    const rows = await world('rows');
    const set = await world('set');
    for (const w of [rows, set]) await w.store.saveMany([{ resourceType: 'Patient', id: 'odd-meta', meta: null }] as never);
    expect((await dump(set.db)).history).toEqual((await dump(rows.db)).history);
  }, 120_000);
});
