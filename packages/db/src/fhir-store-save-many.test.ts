import { describe, expect, it } from 'vitest';
import type { KyselyPlugin, RootOperationNode } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore } from './fhir-store';

// Item 16 slice 1: saveMany writes a request's records in one transaction with one wake-up notify.
// pg-mem cannot prove a rollback; fhir-store-save-many.live.test.ts does that on real PostgreSQL.

function countNotifies(): { plugin: KyselyPlugin; count: () => number } {
  let n = 0;
  const plugin: KyselyPlugin = {
    transformQuery({ node }) {
      const raw = node as RootOperationNode & { kind: string; sqlFragments?: readonly string[] };
      if (raw.kind === 'RawNode' && raw.sqlFragments?.join('').includes('pg_notify')) n++;
      return node;
    },
    async transformResult({ result }) { return result; },
  };
  return { plugin, count: () => n };
}

/** Counts the insert statements into fhir.change_log, one per chunk of a save. */
function countChangeLogInserts(): { plugin: KyselyPlugin; count: () => number } {
  let n = 0;
  const plugin: KyselyPlugin = {
    transformQuery({ node }) {
      const q = node as RootOperationNode & { kind: string; into?: { table?: { identifier?: { name?: string } } } };
      if (q.kind === 'InsertQueryNode' && q.into?.table?.identifier?.name === 'change_log') n++;
      return node;
    },
    async transformResult({ result }) { return result; },
  };
  return { plugin, count: () => n };
}

// A chunk of 4 rows, so 9 records cross two chunk boundaries. With the real chunk of 1,000, pg-mem
// took 6 s to save 1,001 records and 13 s to check them again, and over 60 s under the full gate's
// load. The 2,500-record case with the real chunk runs on real PostgreSQL in the live test.
const SMALL_CHUNK = 4;

describe('fhirStore.saveMany', () => {
  it('saves each record in order; one id twice gets versions 1 then 2', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    const refs = await store.saveMany([
      { resourceType: 'Patient', id: 'p1' },
      { resourceType: 'Observation', id: 'o1', status: 'final', code: { text: 'x' } },
      { resourceType: 'Patient', id: 'p1', gender: 'male' },
    ] as never, { batchId: 'b1', pluginId: 'cdr-source', pluginVersion: '0.1.4' });
    expect(refs.map((r) => [r.id, r.version])).toEqual([['p1', 1], ['o1', 1], ['p1', 2]]);
    const log = await db.selectFrom('fhir.change_log').select(['resource_id', 'version']).where('resource_id', 'in', ['p1', 'o1']).orderBy('seq').execute();
    expect(log.map((r: any) => [r.resource_id, Number(r.version)])).toEqual([['p1', 1], ['o1', 1], ['p1', 2]]);
    const row = await db.selectFrom('fhir.fhir_resources').selectAll().where('id', '=', 'p1').executeTakeFirstOrThrow();
    expect(Number(row.version)).toBe(2);
    expect(row.batch_id).toBe('b1');
    expect(row.plugin_version).toBe('0.1.4');
    await db.destroy();
  });

  // A plugin save names its plugin. The owner check then runs inside the save's own transaction,
  // so no other writer can take a record over between the check and the write.
  it('ownedBy refuses a record another writer holds, and saves none of the list', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    await store.saveMany([{ resourceType: 'Patient', id: 'p1' }] as never, { sourceSystem: 'ingest' });
    await store.saveMany([{ resourceType: 'Patient', id: 'p2' }] as never, { pluginId: 'lab' });

    await expect(store.saveMany([
      { resourceType: 'Patient', id: 'p2', gender: 'male' },
      { resourceType: 'Patient', id: 'p1', gender: 'male' },
    ] as never, { pluginId: 'lab' }, { ownedBy: 'lab' })).rejects.toMatchObject({ name: 'FhirOwnershipError', resourceType: 'Patient', id: 'p1' });

    const rows = await db.selectFrom('fhir.fhir_resources').select(['id', 'version']).where('id', 'in', ['p1', 'p2']).orderBy('id').execute();
    expect(rows.map((r: any) => [r.id, Number(r.version)])).toEqual([['p1', 1], ['p2', 1]]);
    await db.destroy();
  });

  it('ownedBy saves new records and records the same plugin wrote', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    await store.saveMany([{ resourceType: 'Patient', id: 'p2' }] as never, { pluginId: 'lab' });
    const refs = await store.saveMany([
      { resourceType: 'Patient', id: 'p2', gender: 'male' },
      { resourceType: 'Patient', id: 'p9' },
    ] as never, { pluginId: 'lab' }, { ownedBy: 'lab' });
    expect(refs.map((r) => [r.id, r.version])).toEqual([['p2', 2], ['p9', 1]]);
    await db.destroy();
  });

  it('sends one notify per call, not one per record', async () => {
    const db = await makeMigratedDb();
    const n = countNotifies();
    const store = createFhirStore(db.withPlugin(n.plugin) as never);
    await store.saveMany([
      { resourceType: 'Patient', id: 'p1' },
      { resourceType: 'Patient', id: 'p2' },
      { resourceType: 'Patient', id: 'p3' },
    ] as never);
    expect(n.count()).toBe(1);
    await db.destroy();
  });

  it('an empty list writes nothing and sends no notify', async () => {
    const db = await makeMigratedDb();
    const n = countNotifies();
    const store = createFhirStore(db.withPlugin(n.plugin) as never);
    const before = (await db.selectFrom('fhir.change_log').select('seq').execute()).length;
    expect(await store.saveMany([])).toEqual([]);
    expect(n.count()).toBe(0);
    expect((await db.selectFrom('fhir.change_log').select('seq').execute()).length).toBe(before);
    await db.destroy();
  });

  it('save() still returns one ref and writes one version', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    const ref = await store.save({ resourceType: 'Patient', id: 'p9' } as never);
    expect(ref).toEqual({ resourceType: 'Patient', id: 'p9', version: 1 });
    await db.destroy();
  });

  // Slice 2a: the list is written with a few multi-row statements. These pin what must not change.
  it('one key three times, others between: every version in order, canonical row holds the last', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    const refs = await store.saveMany([
      { resourceType: 'Patient', id: 'k', gender: 'male' },
      { resourceType: 'Patient', id: 'other1' },
      { resourceType: 'Patient', id: 'k', gender: 'female' },
      { resourceType: 'Observation', id: 'k', status: 'final', code: { text: 'same id, other type' } },
      { resourceType: 'Patient', id: 'k', gender: 'unknown' },
    ] as never);
    expect(refs.map((r) => [r.resourceType, r.id, r.version])).toEqual([
      ['Patient', 'k', 1], ['Patient', 'other1', 1], ['Patient', 'k', 2], ['Observation', 'k', 1], ['Patient', 'k', 3],
    ]);
    const hist = await db.selectFrom('fhir.resource_history').select(['resource_type', 'version', 'resource']).where('id', '=', 'k').where('resource_type', '=', 'Patient').orderBy('version').execute();
    expect(hist.map((h: any) => [Number(h.version), h.resource.gender, h.resource.meta.versionId])).toEqual([[1, 'male', '1'], [2, 'female', '2'], [3, 'unknown', '3']]);
    const log = await db.selectFrom('fhir.change_log').select(['resource_type', 'resource_id', 'version']).where('resource_id', 'in', ['k', 'other1']).orderBy('seq').execute();
    expect(log.map((r: any) => [r.resource_type, r.resource_id, Number(r.version)])).toEqual([
      ['Patient', 'k', 1], ['Patient', 'other1', 1], ['Patient', 'k', 2], ['Observation', 'k', 1], ['Patient', 'k', 3],
    ]);
    const canon = await db.selectFrom('fhir.fhir_resources').selectAll().where('id', '=', 'k').where('resource_type', '=', 'Patient').executeTakeFirstOrThrow();
    expect([Number(canon.version), canon.version_id, canon.resource.gender, canon.resource.meta.versionId]).toEqual([3, '3', 'unknown', '3']);
    await db.destroy();
  });

  it('resources without ids get ids, and each ref matches its stored row', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    const refs = await store.saveMany([{ resourceType: 'Patient', gender: 'male' }, { resourceType: 'Patient', gender: 'female' }] as never);
    expect(refs[0].id).not.toBe(refs[1].id);
    for (const [i, g] of [[0, 'male'], [1, 'female']] as const) {
      const row = await db.selectFrom('fhir.fhir_resources').select('resource').where('id', '=', refs[i].id).executeTakeFirstOrThrow();
      expect(row.resource.gender).toBe(g);
      expect(row.resource.id).toBe(refs[i].id);
    }
    await db.destroy();
  });

  it('a key with stored versions continues from them, and provenance follows the last save', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    await store.save({ resourceType: 'Patient', id: 'c1' } as never, { batchId: 'old' });
    await store.save({ resourceType: 'Patient', id: 'c1' } as never, { batchId: 'old' });
    const refs = await store.saveMany([{ resourceType: 'Patient', id: 'c1' }, { resourceType: 'Patient', id: 'c2' }] as never, { batchId: 'new', sourceSystem: 's' });
    expect(refs.map((r) => r.version)).toEqual([3, 1]);
    const row = await db.selectFrom('fhir.fhir_resources').selectAll().where('id', '=', 'c1').executeTakeFirstOrThrow();
    expect([Number(row.version), row.batch_id, row.source_system]).toEqual([3, 'new', 's']);
    await db.destroy();
  });

  it('a list stores the same content, meta, hash and provenance as single saves', async () => {
    const list = [
      { resourceType: 'Patient', id: 'e1', gender: 'male', meta: { tag: [{ code: 't' }], versionId: 'stale' } },
      { resourceType: 'Observation', id: 'e2', status: 'final', code: { text: 'x' } },
      { resourceType: 'Patient', id: 'e1', gender: 'female' },
    ];
    const prov = { batchId: 'b', pluginId: 'p', pluginVersion: '1', sourceSystem: 's' };
    const dump = async (db: any) => {
      const strip = (r: any) => ({ ...r, meta: { ...r.meta, lastUpdated: 'x' } });
      const canon = await db.selectFrom('fhir.fhir_resources').select(['resource_type', 'id', 'version', 'version_id', 'resource', 'source_system', 'plugin_id', 'plugin_version', 'batch_id']).where('id', 'in', ['e1', 'e2']).orderBy('id').execute();
      const hist = await db.selectFrom('fhir.resource_history').select(['resource_type', 'id', 'version', 'op', 'resource']).where('id', 'in', ['e1', 'e2']).orderBy('id').orderBy('version').execute();
      const log = await db.selectFrom('fhir.change_log').select(['resource_type', 'resource_id', 'version', 'op', 'content_hash', 'site_id']).where('resource_id', 'in', ['e1', 'e2']).orderBy('seq').execute();
      return JSON.parse(JSON.stringify({
        canon: canon.map((c: any) => ({ ...c, version: Number(c.version), resource: strip(c.resource) })),
        hist: hist.map((h: any) => ({ ...h, version: Number(h.version), resource: strip(h.resource) })),
        log: log.map((l: any) => ({ ...l, version: Number(l.version) })),
      }));
    };
    const a = await makeMigratedDb();
    const sa = createFhirStore(a as never);
    for (const r of list) await sa.save(r as never, prov);
    const b = await makeMigratedDb();
    await createFhirStore(b as never).saveMany(list as never, prov);
    expect(await dump(b)).toEqual(await dump(a));
    await a.destroy();
    await b.destroy();
  });

  it('a list longer than one chunk saves across the chunk boundaries', async () => {
    const db = await makeMigratedDb();
    const inserts = countChangeLogInserts();
    const store = createFhirStore(db.withPlugin(inserts.plugin) as never, { saveChunk: SMALL_CHUNK });
    const refs = await store.saveMany(Array.from({ length: 9 }, (_, i) => ({ resourceType: 'Patient', id: `big-${i}` })) as never);
    expect(refs).toHaveLength(9);
    expect(inserts.count()).toBe(3);
    const n: any = await db.selectFrom('fhir.change_log').select((eb: any) => eb.fn.countAll().as('n')).where('resource_id', 'like', 'big-%').executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(9);
    await db.destroy();
  });
});

// Item 16: which path a store saves with. pg-mem cannot run the set-based statement.
describe('fhirStore.saveMany: choosing the save path', () => {
  it('a_database_that_cannot_run_the_statement_gets_the_row_path_and_is_asked_once', async () => {
    let probes = 0;
    const db = (await makeMigratedDb()).withPlugin({
      transformQuery({ node }: { node: RootOperationNode & { kind: string; sqlFragments?: readonly string[] } }) {
        if (node.kind === 'RawNode' && node.sqlFragments?.join('').includes('with ordinality')) probes++;
        return node;
      },
      async transformResult({ result }: { result: unknown }) { return result; },
    } as never);
    const store = createFhirStore(db as never);
    await store.saveMany([{ resourceType: 'Patient', id: 'c1' }] as never);
    await store.saveMany([{ resourceType: 'Patient', id: 'c2' }] as never);
    expect(probes).toBe(1);
    expect((await db.selectFrom('fhir.resource_history').select('id').where('id', 'in', ['c1', 'c2']).execute()).length).toBe(2);
    await db.destroy();
  });

  it('a_failure_that_is_not_about_the_statement_is_not_remembered', async () => {
    let probes = 0;
    let down = true;
    const db = (await makeMigratedDb()).withPlugin({
      transformQuery({ node }: { node: RootOperationNode & { kind: string; sqlFragments?: readonly string[] } }) {
        if (node.kind === 'RawNode' && node.sqlFragments?.join('').includes('with ordinality')) {
          probes++;
          // As a dropped connection: nothing to do with what the database can run.
          if (down) throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
        }
        return node;
      },
      async transformResult({ result }: { result: unknown }) { return result; },
    } as never);
    const store = createFhirStore(db as never);
    await store.saveMany([{ resourceType: 'Patient', id: 'd1' }] as never);
    down = false;
    await store.saveMany([{ resourceType: 'Patient', id: 'd2' }] as never);
    await store.saveMany([{ resourceType: 'Patient', id: 'd3' }] as never);
    // Asked again after the failure, then settled: pg-mem cannot run it, so twice in all.
    expect(probes).toBe(2);
    expect((await db.selectFrom('fhir.resource_history').select('id').where('id', 'in', ['d1', 'd2', 'd3']).execute()).length).toBe(3);
    await db.destroy();
  });
});

// Item 16: a check save skips a record whose content is the latest stored content.
describe('fhirStore.saveMany with skipUnchanged', () => {
  const versions = async (db: Awaited<ReturnType<typeof makeMigratedDb>>, id: string) =>
    (await db.selectFrom('fhir.resource_history').select(['version', 'op']).where('id', '=', id).orderBy('version').execute()).map((r) => `${Number(r.version)}:${r.op}`);
  const changes = async (db: Awaited<ReturnType<typeof makeMigratedDb>>, id: string) =>
    (await db.selectFrom('fhir.change_log').select('version').where('resource_id', '=', id).execute()).length;
  const p1 = { resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] };
  const org = { resourceType: 'Organization', id: 'lab-1', name: 'Lab one' };

  it('a_record_whose_content_is_the_stored_content_is_not_written_again', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    await store.saveMany([p1] as never);
    const refs = await store.saveMany([{ ...p1 }] as never, {}, { skipUnchanged: true });
    expect(refs).toEqual([{ resourceType: 'Patient', id: 'p1', version: 1 }]);
    expect(await versions(db, 'p1')).toEqual(['1:upsert']);
    expect(await changes(db, 'p1')).toBe(1);
    await db.destroy();
  });

  it('a_changed_record_is_saved_and_the_unchanged_one_beside_it_is_skipped', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    await store.saveMany([org, p1] as never);
    const refs = await store.saveMany([{ ...org }, { ...p1, name: [{ family: 'B' }] }] as never, {}, { skipUnchanged: true });
    expect(refs).toEqual([{ resourceType: 'Organization', id: 'lab-1', version: 1 }, { resourceType: 'Patient', id: 'p1', version: 2 }]);
    expect(await versions(db, 'lab-1')).toEqual(['1:upsert']);
    expect(await versions(db, 'p1')).toEqual(['1:upsert', '2:upsert']);
    expect(((await store.get('Patient', 'p1')) as unknown as { name: Array<{ family: string }> }).name[0].family).toBe('B');
    await db.destroy();
  });

  it('without_skipUnchanged_an_identical_save_still_makes_a_version', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    await store.saveMany([p1] as never);
    await store.saveMany([{ ...p1 }] as never);
    await store.saveMany([{ ...p1 }] as never, {}, { skipUnchanged: false });
    expect(await versions(db, 'p1')).toEqual(['1:upsert', '2:upsert', '3:upsert']);
    await db.destroy();
  });

  it('a_record_deleted_since_is_saved_again', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    await store.saveMany([p1] as never);
    await store.delete('Patient', 'p1');
    const refs = await store.saveMany([{ ...p1 }] as never, {}, { skipUnchanged: true });
    expect(refs[0].version).toBe(3);
    expect(await versions(db, 'p1')).toEqual(['1:upsert', '2:delete', '3:upsert']);
    expect(await store.get('Patient', 'p1')).not.toBeNull();
    await db.destroy();
  });

  it('a_version_stored_without_a_hash_is_never_skipped', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    await store.saveMany([p1] as never);
    // As a row from before the hash column, or one written by an amendment or by sync.
    await db.updateTable('fhir.resource_history').set({ content_hash: null }).where('id', '=', 'p1').execute();
    await store.saveMany([{ ...p1 }] as never, {}, { skipUnchanged: true });
    expect(await versions(db, 'p1')).toEqual(['1:upsert', '2:upsert']);
    // The version just written has its hash, so the next identical save is skipped.
    await store.saveMany([{ ...p1 }] as never, {}, { skipUnchanged: true });
    expect(await versions(db, 'p1')).toEqual(['1:upsert', '2:upsert']);
    await db.destroy();
  });

  it('the_same_record_twice_in_one_call_is_written_once_and_A_B_A_three_times', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    const refs = await store.saveMany([p1, { ...p1 }] as never, {}, { skipUnchanged: true });
    expect(refs.map((r) => r.version)).toEqual([1, 1]);
    expect(await versions(db, 'p1')).toEqual(['1:upsert']);
    const b = { ...p1, name: [{ family: 'B' }] };
    const again = await store.saveMany([{ ...p1 }, b, { ...p1 }] as never, {}, { skipUnchanged: true });
    expect(again.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(await versions(db, 'p1')).toEqual(['1:upsert', '2:upsert', '3:upsert']);
    expect(((await store.get('Patient', 'p1')) as unknown as { name: Array<{ family: string }> }).name[0].family).toBe('A');
    await db.destroy();
  });

  it('an_amended_record_is_never_skipped', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    // An amendment needs a record owned by a lab site, so this install has one.
    await db.insertInto('app_settings').values({ key: 'sync.site_id', value: 'lab-a' } as never).execute();
    const obs = { resourceType: 'Observation', id: 'obs-1', status: 'final', code: { text: 'Hb' }, valueString: 'first' };
    await store.saveMany([obs] as never);
    await store.amend({ resourceType: 'Observation', id: 'obs-1', status: 'amended', patch: { valueString: 'corrected' }, agent: 'central-reviewer', reason: 'value re-validated' });
    // The check sends the content it sent before. The stored record is now the amended one, so this is a change.
    const refs = await store.saveMany([{ ...obs }] as never, {}, { skipUnchanged: true });
    expect(refs[0].version).toBe(3);
    expect(await versions(db, 'obs-1')).toEqual(['1:upsert', '2:upsert', '3:upsert']);
    expect(((await store.get('Observation', 'obs-1')) as unknown as { valueString: string }).valueString).toBe('first');
    await db.destroy();
  });

  it('a_record_changed_by_sync_since_is_never_skipped', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    await store.saveMany([p1] as never);
    await store.applyRemote({ resourceType: 'Patient', id: 'p1', version: 2, op: 'upsert', siteId: 'lab-a', resource: { ...p1, name: [{ family: 'Remote' }] } as never });
    const refs = await store.saveMany([{ ...p1 }] as never, {}, { skipUnchanged: true });
    expect(refs[0].version).toBe(3);
    expect(await versions(db, 'p1')).toEqual(['1:upsert', '2:upsert', '3:upsert']);
    await db.destroy();
  });

  it('the_skip_lookup_works_across_a_chunk_boundary', async () => {
    const db = await makeMigratedDb();
    const inserts = countChangeLogInserts();
    const store = createFhirStore(db.withPlugin(inserts.plugin) as never, { saveChunk: SMALL_CHUNK });
    const many = Array.from({ length: 9 }, (_, i) => ({ resourceType: 'Patient', id: `m${i}`, gender: 'male' }));
    await store.saveMany(many as never);
    expect(inserts.count()).toBe(3);
    // All 9 again, with the first and the last changed: one in the first chunk, one in the last.
    const again = many.map((r, i) => (i === 0 || i === 8 ? { ...r, gender: 'female' } : { ...r }));
    const refs = await store.saveMany(again as never, {}, { skipUnchanged: true });
    expect(refs.filter((r) => r.version === 2).map((r) => r.id)).toEqual(['m0', 'm8']);
    expect(refs.filter((r) => r.version === 1)).toHaveLength(7);
    const rows = await db.selectFrom('fhir.resource_history').select('id').where('id', 'like', 'm%').where('version', '=', 2).execute();
    expect(rows.map((r) => r.id).sort()).toEqual(['m0', 'm8']);
    await db.destroy();
  });

  it('a_call_that_skips_everything_writes_nothing_and_sends_no_wake_up', async () => {
    const counter = countNotifies();
    const db = (await makeMigratedDb()).withPlugin(counter.plugin);
    const store = createFhirStore(db as never);
    await store.saveMany([org, p1] as never, { batchId: 'first' });
    const before = counter.count();
    await store.saveMany([{ ...org }, { ...p1 }] as never, { batchId: 'second' }, { skipUnchanged: true });
    expect(counter.count()).toBe(before);
    // Migrations seed a few records of their own, so count only these two.
    expect((await db.selectFrom('fhir.change_log').select('seq').where('resource_id', 'in', ['lab-1', 'p1']).execute()).length).toBe(2);
    // The stored row keeps the run that wrote it.
    expect((await store.getWithProvenance('Patient', 'p1'))!.provenance.batchId).toBe('first');
    await db.destroy();
  });
});
