import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createTerminologyStore } from './terminology-store';
import { createFhirStore } from './fhir-store';
import { createTerminologyAdminStore, LOCAL_MAP_URL } from './terminology-admin-store';

// Sync S3 / Task B2: prove the mark* calls wired at import-completion emit EXACTLY ONE
// reference_change_log signal per operation (never per batch), and that the lab's curated
// LOCAL_MAP_URL is never signalled.

function systemSignals(db: Awaited<ReturnType<typeof makeMigratedDb>>, entityId: string) {
  return db
    .selectFrom('reference_change_log')
    .selectAll()
    .where('entity_type', '=', 'terminology_system')
    .where('entity_id', '=', entityId)
    .orderBy('seq')
    .execute();
}
function mapSignals(db: Awaited<ReturnType<typeof makeMigratedDb>>, entityId: string) {
  return db
    .selectFrom('reference_change_log')
    .selectAll()
    .where('entity_type', '=', 'concept_map')
    .where('entity_id', '=', entityId)
    .orderBy('seq')
    .execute();
}

describe('terminology change instrumentation (Sync S3 / B2)', () => {
  // Explicit 30s timeout: inserting >1000 rows through pg-mem is slow and contends for CPU under the
  // parallel merge-gate suite; the default 5s is too tight for this data-heavy case.
  it('terms.importRows spanning >1 internal batch emits exactly ONE terminology_system signal', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db as never);
    const system = 'http://example.org/big-cs';
    // 1500 rows > the 1000-row internal batch size: proves the signal is per-operation, not per-batch.
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      system, code: `C${i}`, display: `Concept ${i}`, status: 'ACTIVE', properties: null,
    }));

    const res = await admin.terms.importRows(rows);
    expect(res.imported).toBe(1500);

    const signals = await systemSignals(db, system);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ op: 'upsert', content_hash: '1' });
    await db.destroy();
  }, 30_000);

  it('terms.importRows marks each DISTINCT system once (not one signal for two systems)', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db as never);
    await admin.terms.importRows([
      { system: 'http://a', code: 'x', display: 'X', status: 'ACTIVE', properties: null },
      { system: 'http://b', code: 'y', display: 'Y', status: 'ACTIVE', properties: null },
      { system: 'http://a', code: 'z', display: 'Z', status: 'ACTIVE', properties: null },
    ]);
    expect(await systemSignals(db, 'http://a')).toHaveLength(1);
    expect(await systemSignals(db, 'http://b')).toHaveLength(1);
    await db.destroy();
  });

  // A re-import of what is already stored is not a change. Labs re-download a whole system for every
  // signal, and the facility projection re-imports the full registry on every app-context start.
  it('terms.importRows of rows identical to the stored ones adds no signal', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db as never);
    const system = 'http://example.org/same';
    const rows = [
      { system, code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null },
      { system, code: 'B', display: 'Beta', status: 'ACTIVE', properties: { unit: 'mg', group: 'x' } },
    ];
    await admin.terms.importRows(rows);
    expect(await systemSignals(db, system)).toHaveLength(1);

    const res = await admin.terms.importRows(rows);
    expect(res.imported).toBe(2); // still counts every row it was handed
    expect(await systemSignals(db, system)).toHaveLength(1);
    await db.destroy();
  });

  it('terms.importRows treats the same properties in another key order as unchanged', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db as never);
    const system = 'http://example.org/keys';
    await admin.terms.importRows([
      { system, code: 'A', display: 'Alpha', status: 'ACTIVE', properties: { zeta: 1, alpha: { b: 2, a: [1, 2] } } },
    ]);
    await admin.terms.importRows([
      { system, code: 'A', display: 'Alpha', status: 'ACTIVE', properties: { alpha: { a: [1, 2], b: 2 }, zeta: 1 } },
    ]);
    expect(await systemSignals(db, system)).toHaveLength(1);
    await db.destroy();
  });

  it('terms.importRows signals once when a display, a status, a property or a new code changes', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db as never);
    const system = 'http://example.org/diff';
    const base = [
      { system, code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null },
      { system, code: 'B', display: 'Beta', status: 'ACTIVE', properties: { unit: 'mg' } as Record<string, unknown> | null },
    ];
    await admin.terms.importRows(base);

    await admin.terms.importRows([{ ...base[0], display: 'Alpha v2' }, base[1]]);
    expect(await systemSignals(db, system)).toHaveLength(2);
    await admin.terms.importRows([{ ...base[0], display: 'Alpha v2', status: 'RETIRED' }]);
    expect(await systemSignals(db, system)).toHaveLength(3);
    await admin.terms.importRows([{ ...base[1], properties: { unit: 'g' } }]);
    expect(await systemSignals(db, system)).toHaveLength(4);
    await admin.terms.importRows([{ ...base[1], properties: { unit: 'g' } }, { system, code: 'C', display: 'Gamma', status: 'ACTIVE', properties: null }]);
    expect(await systemSignals(db, system)).toHaveLength(5);

    const stored = await db.selectFrom('terminology_concepts').select(['code', 'display', 'status'])
      .where('system', '=', system).orderBy('code').execute();
    expect(stored).toEqual([
      { code: 'A', display: 'Alpha v2', status: 'RETIRED' },
      { code: 'B', display: 'Beta', status: 'ACTIVE' },
      { code: 'C', display: 'Gamma', status: 'ACTIVE' },
    ]);
    await db.destroy();
  });

  it('terms.importRows signals only the system that had a changed row', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db as never);
    const a = { system: 'http://a', code: 'x', display: 'X', status: 'ACTIVE', properties: null };
    const b = { system: 'http://b', code: 'y', display: 'Y', status: 'ACTIVE', properties: null };
    await admin.terms.importRows([a, b]);
    await admin.terms.importRows([a, { ...b, display: 'Y v2' }]);
    expect(await systemSignals(db, 'http://a')).toHaveLength(1);
    expect(await systemSignals(db, 'http://b')).toHaveLength(2);
    await db.destroy();
  });

  it('terms.update of one concept adds one MORE terminology_system signal for its system', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db as never);
    const system = 'http://example.org/cs';
    await admin.terms.importRows([{ system, code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null }]);
    expect(await systemSignals(db, system)).toHaveLength(1); // import

    await admin.terms.update(system, 'A', { system, code: 'A', display: 'Alpha v2', status: 'ACTIVE' });
    const signals = await systemSignals(db, system);
    expect(signals).toHaveLength(2); // import + update
    expect(signals.map((r) => r.content_hash)).toEqual(['1', '2']);
    await db.destroy();
  });

  it('terms.create and terms.delete each emit one terminology_system signal', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db as never);
    const system = 'http://example.org/cs2';
    await admin.terms.create({ system, code: 'A', display: 'Alpha', status: 'ACTIVE' });
    expect(await systemSignals(db, system)).toHaveLength(1);
    await admin.terms.delete(system, 'A');
    expect(await systemSignals(db, system)).toHaveLength(2);
    await db.destroy();
  });

  it('upsertMapElements on a non-LOCAL map_url emits ONE concept_map signal', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyStore(db as never, createFhirStore(db as never));
    const mapUrl = 'http://example.org/cm';
    await store.upsertMapElements([
      { mapUrl, sourceSystem: 'http://s', sourceCode: 'a', targetSystem: 'http://t', targetCode: 'b', equivalence: 'equal' },
      { mapUrl, sourceSystem: 'http://s', sourceCode: 'c', targetSystem: 'http://t', targetCode: 'd', equivalence: 'equal' },
    ]);
    const signals = await mapSignals(db, mapUrl);
    expect(signals).toHaveLength(1); // one per map_url, not per element
    expect(signals[0]).toMatchObject({ op: 'upsert', content_hash: '1' });
    await db.destroy();
  });

  it('upsertMapElements on LOCAL_MAP_URL emits NO concept_map signal', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyStore(db as never, createFhirStore(db as never));
    await store.upsertMapElements([
      { mapUrl: LOCAL_MAP_URL, sourceSystem: 'http://s', sourceCode: 'a', targetSystem: 'http://t', targetCode: 'b', equivalence: 'equal' },
    ]);
    expect(await mapSignals(db, LOCAL_MAP_URL)).toHaveLength(0);
    await db.destroy();
  });

  it('a curated termMappings.create (writes LOCAL_MAP_URL) emits NO concept_map signal', async () => {
    const db = await makeMigratedDb();
    const admin = createTerminologyAdminStore(db as never);
    await admin.termMappings.create({
      fromSystem: 'http://s', fromCode: 'a', toSystem: 'http://t', toCode: 'b',
      toDisplay: 'B', mapType: 'SAME-AS', isActive: true,
    });
    // LOCAL_MAP_URL is lab-local curation: never signalled as a pullable concept_map.
    expect(await mapSignals(db, LOCAL_MAP_URL)).toHaveLength(0);
    const anyMapSignal = await db
      .selectFrom('reference_change_log')
      .selectAll()
      .where('entity_type', '=', 'concept_map')
      .execute();
    expect(anyMapSignal).toHaveLength(0);
    await db.destroy();
  });
});
