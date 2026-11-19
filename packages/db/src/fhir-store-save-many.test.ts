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

  // 1,001 records cross one chunk boundary. The 2,500-record case runs on real PostgreSQL in the
  // live test; on pg-mem it took over 60 s under the full gate's load.
  it('a list of 1,001 records saves across a chunk boundary', async () => {
    const db = await makeMigratedDb();
    const store = createFhirStore(db as never);
    const refs = await store.saveMany(Array.from({ length: 1001 }, (_, i) => ({ resourceType: 'Patient', id: `big-${i}` })) as never);
    expect(refs).toHaveLength(1001);
    const n: any = await db.selectFrom('fhir.change_log').select((eb: any) => eb.fn.countAll().as('n')).where('resource_id', 'like', 'big-%').executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(1001);
    await db.destroy();
  }, 60_000);
});
