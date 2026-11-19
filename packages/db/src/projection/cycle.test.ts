import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from '../migrations/internal/test-helpers';
import { makeMigratedExternalDb } from '../test-helpers-external';
import { createFhirStore } from '../fhir-store';
import { createRelationalWriter } from '../relational-writer';
import { createProjectionRunner, reprojectAll, type FetchSafeRows } from './cycle';
import { readCursor } from './cursor';

const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

describe('runProjectionCycle', () => {
  it('projects safe rows to the external store and advances the cursor', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never);

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' }],
      boundary: 100,
      xmax: 200,
    });

    const n = await createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500 }).runCycle();
    expect(n).toBe(1);
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await readCursor(internalDb as never, 'projection')).toBe(1);
    await internalDb.destroy();
    await externalDb.destroy();
  });

  it('deletes the relational row when the canonical resource is gone (tombstone)', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    await relationalWriter.write({ resourceType: 'Patient', id: 'p1' }, {});
    await fhirStore.delete('Patient', 'p1');

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'delete' }],
      boundary: 100,
      xmax: 200,
    });
    await createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500 }).runCycle();
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(0);
    await internalDb.destroy();
    await externalDb.destroy();
  });

  it('carries provenance from the canonical row into the projected row', async () => {
    // The bug this file never caught: applyProjection called write(canonical) with
    // no provenance, and write() defaulted it to {} — so source_system/plugin_id/
    // plugin_version/batch_id were NULL in EVERY projected row, for every producer,
    // silently defeating the batchId design in persist-store-service.ts:11-17.
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save(
      { resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never,
      { sourceSystem: 'cdr', batchId: 'batch-1' },
    );

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' }],
      boundary: 100,
      xmax: 200,
    });
    await createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500 }).runCycle();

    const [row] = await externalDb.selectFrom('patients').selectAll().execute();
    expect(row.source_system).toBe('cdr');
    expect(row.batch_id).toBe('batch-1');
    await internalDb.destroy();
    await externalDb.destroy();
  });

  it('calls onProjected with the resource after a successful write', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never);

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' }],
      boundary: 100,
      xmax: 200,
    });
    const seen: { resourceType: string; id: unknown }[] = [];
    const runner = createProjectionRunner({
      internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500,
      onProjected: async (resourceType, resource) => { seen.push({ resourceType, id: resource.id }); },
    });

    await runner.runCycle();

    expect(seen).toEqual([{ resourceType: 'Patient', id: 'p1' }]);
    await internalDb.destroy();
    await externalDb.destroy();
  });

  it('does not call onProjected on the tombstone (delete) path', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    await relationalWriter.write({ resourceType: 'Patient', id: 'p1' }, {});
    await fhirStore.delete('Patient', 'p1');

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'delete' }],
      boundary: 100,
      xmax: 200,
    });
    let calls = 0;
    const runner = createProjectionRunner({
      internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500,
      onProjected: async () => { calls += 1; },
    });

    await runner.runCycle();

    expect(calls).toBe(0);
    await internalDb.destroy();
    await externalDb.destroy();
  });

  // ⛔ THE trap this hook exists to avoid: a throwing side-effect must never look like a failed
  // clinical apply. The write already landed — assert that directly, not just that runCycle resolved.
  it('swallows an onProjected error without failing the cycle or the clinical write', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never);

    const fetch: FetchSafeRows = async () => ({
      rows: [{ seq: 1, xid: 1, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' }],
      boundary: 100,
      xmax: 200,
    });
    const errors: unknown[] = [];
    const spyLogger = { info() {}, warn() {}, debug() {}, error: (o: unknown) => errors.push(o) } as never;
    const runner = createProjectionRunner({
      internalDb: internalDb as never, fhirStore, relationalWriter, logger: spyLogger, fetch, batchSize: 500,
      onProjected: async () => { throw new Error('facility capture boom'); },
    });

    const n = await runner.runCycle();

    expect(n).toBe(1);
    expect(errors).toHaveLength(1);
    expect(await internalDb.selectFrom('fhir.projection_retries').selectAll().execute()).toHaveLength(0);
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await readCursor(internalDb as never, 'projection')).toBe(1);
    await internalDb.destroy();
    await externalDb.destroy();
  });
});

// Item 16: a cycle projects its batch with one bulk write, as the rebuild does, and not one record
// at a time. A batch that fails is tried again one record at a time, so one bad record never holds
// the others back.
describe('runProjectionCycle in bulk (item 16)', () => {
  const rowsFor = (ids: string[]) => ids.map((id, i) => ({ seq: i + 1, xid: 1, resource_type: 'Patient', resource_id: id, op: 'upsert' }));
  async function world() {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const real = createRelationalWriter(externalDb as never, 'postgres');
    const calls = { write: [] as string[], writeMany: [] as string[][], deleteById: [] as string[], order: [] as string[] };
    let failMany = false;
    let failOne: string | null = null;
    const relationalWriter = {
      ...real,
      async write(resource: unknown, provenance: never) {
        const id = (resource as { id: string }).id;
        calls.write.push(id);
        if (failOne === id) throw new Error('warehouse refused this row');
        return real.write(resource, provenance);
      },
      async writeMany(items: Array<{ resource: unknown; provenance: never }>) {
        calls.writeMany.push(items.map((it) => (it.resource as { id: string }).id));
        calls.order.push('writeMany');
        if (failMany) throw new Error('warehouse refused the batch');
        return real.writeMany(items);
      },
      async deleteById(resourceType: string, id: string) { calls.deleteById.push(id); calls.order.push(`delete ${id}`); return real.deleteById(resourceType, id); },
    };
    const run = (ids: string[], onProjected?: (t: string, r: Record<string, unknown>) => Promise<void>) => createProjectionRunner({
      internalDb: internalDb as never, fhirStore, relationalWriter: relationalWriter as never, logger,
      fetch: async () => ({ rows: rowsFor(ids), boundary: 100, xmax: 200 }), batchSize: 500,
      ...(onProjected ? { onProjected } : {}),
    }).runCycle();
    const patients = async () => (await externalDb.selectFrom('patients').select('id').orderBy('id').execute()).map((r) => r.id);
    const done = async () => { await internalDb.destroy(); await externalDb.destroy(); };
    return { internalDb, externalDb, fhirStore, calls, run, patients, done, failMany: (v: boolean) => { failMany = v; }, failOne: (id: string | null) => { failOne = id; } };
  }

  it('a_cycle_writes_its_whole_batch_with_one_bulk_call', async () => {
    const w = await world();
    for (const id of ['p1', 'p2', 'p3']) await w.fhirStore.save({ resourceType: 'Patient', id } as never);
    expect(await w.run(['p1', 'p2', 'p3'])).toBe(3);
    expect(w.calls.writeMany).toEqual([['p1', 'p2', 'p3']]);
    expect(w.calls.write).toEqual([]);
    expect(await w.patients()).toEqual(['p1', 'p2', 'p3']);
    expect(await readCursor(w.internalDb as never, 'projection')).toBe(3);
    await w.done();
  });

  it('a_record_deleted_since_is_removed_and_the_rest_are_written', async () => {
    const w = await world();
    for (const id of ['p1', 'p2']) await w.fhirStore.save({ resourceType: 'Patient', id } as never);
    expect(await w.run(['p1', 'p2'])).toBe(2);
    await w.fhirStore.delete('Patient', 'p1');
    await w.fhirStore.save({ resourceType: 'Patient', id: 'p3' } as never);
    expect(await w.run(['p1', 'p2', 'p3'])).toBe(3);
    expect(w.calls.deleteById).toEqual(['p1']);
    expect(w.calls.writeMany.at(-1)).toEqual(['p2', 'p3']);
    expect(await w.patients()).toEqual(['p2', 'p3']);
    await w.done();
  });

  it('when_the_batch_fails_each_record_is_tried_alone_and_only_the_bad_one_waits', async () => {
    const w = await world();
    for (const id of ['p1', 'p2', 'p3']) await w.fhirStore.save({ resourceType: 'Patient', id } as never);
    w.failMany(true);
    w.failOne('p2');
    // The cycle reports what it projected: two of the three.
    expect(await w.run(['p1', 'p2', 'p3'])).toBe(2);
    expect(w.calls.write).toEqual(['p1', 'p2', 'p3']);
    expect(await w.patients()).toEqual(['p1', 'p3']);
    const waiting = await w.internalDb.selectFrom('fhir.projection_retries').select('resource_id').execute();
    expect(waiting.map((r) => r.resource_id)).toEqual(['p2']);
    // The cursor still moves on: the bad record is kept in the retry list, not behind the cursor.
    expect(await readCursor(w.internalDb as never, 'projection')).toBe(3);
    await w.done();
  });

  it('a_record_that_waited_for_a_retry_is_cleared_once_it_projects', async () => {
    const w = await world();
    await w.fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    await w.internalDb.insertInto('fhir.projection_retries').values({ resource_type: 'Patient', resource_id: 'p1', attempts: 1, next_attempt_at: new Date(Date.now() - 1000) } as never).execute();
    expect(await w.run(['p1'])).toBe(1);
    expect(await w.internalDb.selectFrom('fhir.projection_retries').select('resource_id').execute()).toEqual([]);
    await w.done();
  });

  it('every_arrival_of_every_record_in_the_batch_is_recorded', async () => {
    const w = await world();
    await w.fhirStore.save({ resourceType: 'Patient', id: 'p1', gender: 'male' } as never);
    await w.fhirStore.save({ resourceType: 'Patient', id: 'p1', gender: 'female' } as never);
    await w.fhirStore.save({ resourceType: 'Patient', id: 'p2' } as never);
    await w.run(['p1', 'p2']);
    const events = await w.externalDb.selectFrom('ingest_events' as never).select(['resource_id', 'version'] as never).orderBy('resource_id' as never).orderBy('version' as never).execute() as Array<{ resource_id: string; version: number | string }>;
    expect(events.map((e) => `${e.resource_id}:${Number(e.version)}`)).toEqual(['p1:1', 'p1:2', 'p2:1']);
    await w.done();
  });

  it('deleted_records_are_removed_before_the_batch_is_written', async () => {
    // Two resource types can share one warehouse table by id (Organization and Location). Removing
    // after writing could delete a row the same batch just wrote.
    const w = await world();
    for (const id of ['p1', 'p2']) await w.fhirStore.save({ resourceType: 'Patient', id } as never);
    await w.fhirStore.delete('Patient', 'p1');
    await w.run(['p1', 'p2']);
    expect(w.calls.order).toEqual(['delete p1', 'writeMany']);
    await w.done();
  });

  it('a_cycle_whose_every_record_fails_reports_nothing_projected', async () => {
    // So the worker ends its catch-up and waits for the next tick while the warehouse is down.
    const w = await world();
    await w.fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    w.failMany(true);
    w.failOne('p1');
    expect(await w.run(['p1'])).toBe(0);
    expect((await w.internalDb.selectFrom('fhir.projection_retries').select('resource_id').execute()).map((r) => r.resource_id)).toEqual(['p1']);
    await w.done();
  });

  it('the_hook_runs_once_per_record_after_its_waiting_retry_is_cleared', async () => {
    const w = await world();
    await w.fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    await w.internalDb.insertInto('fhir.projection_retries').values({ resource_type: 'Patient', resource_id: 'p1', attempts: 1, next_attempt_at: new Date(Date.now() - 1000) } as never).execute();
    const waitingAtHook: number[] = [];
    await w.run(['p1'], async () => {
      waitingAtHook.push((await w.internalDb.selectFrom('fhir.projection_retries').select('resource_id').execute()).length);
    });
    expect(waitingAtHook).toEqual([0]);
    await w.done();
  });

  it('when_the_batch_fails_the_hook_still_runs_for_each_record_projected_alone', async () => {
    const w = await world();
    for (const id of ['p1', 'p2', 'p3']) await w.fhirStore.save({ resourceType: 'Patient', id } as never);
    w.failMany(true);
    w.failOne('p2');
    const seen: string[] = [];
    await w.run(['p1', 'p2', 'p3'], async (_t, r) => { seen.push(r.id as string); });
    expect(seen).toEqual(['p1', 'p3']);
    await w.done();
  });

  it('the_hook_is_called_for_each_record_written_in_batch_order', async () => {
    const w = await world();
    for (const id of ['p1', 'p2', 'p3']) await w.fhirStore.save({ resourceType: 'Patient', id } as never);
    const seen: string[] = [];
    await w.run(['p1', 'p2', 'p3'], async (_t, r) => { seen.push(r.id as string); });
    expect(seen).toEqual(['p1', 'p2', 'p3']);
    await w.done();
  });
});

describe('createProjectionRunner (stateful gaps across cycles)', () => {
  it('carries pendingGaps across runCycle() calls: a fresh gap blocks, then confirms once the boundary advances', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    // Canonical resources so applyProjection's fhirStore.get('Patient', ...) returns them.
    await fhirStore.save({ resourceType: 'Patient', id: 'a', name: [{ family: 'A' }] } as never);
    await fhirStore.save({ resourceType: 'Patient', id: 'b', name: [{ family: 'B' }] } as never);

    // A stateful fake fetch: on call #1 seq 1 is an ABSENT gap (only seq 2 visible) with the oldest
    // running txn (boundary=50) below the recorded x0 (xmax=100) → the gap is unconfirmed and blocks.
    // On call #2 the boundary has advanced to 150 (>= x0=100) → the gap is confirmed rolled back, so
    // the runner can safely advance past it and project seq 2. This only works if pendingGaps (the
    // seq→x0 map) survived from cycle #1 to cycle #2 inside the same runner instance.
    let call = 0;
    const fetch: FetchSafeRows = async () => {
      call += 1;
      if (call === 1) {
        // seq 1 missing (gap), seq 2 = Patient 'b'; boundary below x0 → gap unconfirmed.
        return { rows: [{ seq: 2, xid: 10, resource_type: 'Patient', resource_id: 'b', op: 'upsert' }], boundary: 50, xmax: 100 };
      }
      // Same visible row; boundary now >= the x0 (100) stamped on cycle #1 → gap confirmed rolled back.
      return { rows: [{ seq: 2, xid: 10, resource_type: 'Patient', resource_id: 'b', op: 'upsert' }], boundary: 150, xmax: 200 };
    };

    const runner = createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch, batchSize: 500 });

    // Cycle #1: blocked before the gap at seq 1 → cursor stays 0, nothing projected.
    const n1 = await runner.runCycle();
    expect(n1).toBe(0);
    expect(await readCursor(internalDb as never, 'projection')).toBe(0);
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(0);

    // Cycle #2: carried gap now confirmed rolled back → cursor advances to 2 and 'b' projects.
    const n2 = await runner.runCycle();
    expect(n2).toBe(1);
    expect(await readCursor(internalDb as never, 'projection')).toBe(2);
    const patients = await externalDb.selectFrom('patients').selectAll().execute();
    expect(patients).toHaveLength(1);
    expect((patients[0] as { id: string }).id).toBe('b');

    await internalDb.destroy();
    await externalDb.destroy();
  });
});

describe('getWithProvenance', () => {
  it('returns the resource alongside its stored provenance', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    await fhirStore.save(
      { resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never,
      { sourceSystem: 'cdr', batchId: 'batch-1', pluginId: 'plug', pluginVersion: '1.2.3' },
    );

    const found = await fhirStore.getWithProvenance('Patient', 'p1');
    expect(found).not.toBeNull();
    expect((found!.resource as unknown as { id: string }).id).toBe('p1');
    expect(found!.provenance).toEqual({
      sourceSystem: 'cdr', batchId: 'batch-1', pluginId: 'plug', pluginVersion: '1.2.3',
    });
    await internalDb.destroy();
  });

  it('returns an empty provenance (not undefined) when the columns are NULL', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    await fhirStore.save({ resourceType: 'Patient', id: 'p2' } as never);

    const found = await fhirStore.getWithProvenance('Patient', 'p2');
    expect(found).not.toBeNull();
    expect(found!.provenance).toEqual({});
    await internalDb.destroy();
  });

  it('returns null for a missing resource', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    expect(await fhirStore.getWithProvenance('Patient', 'nope')).toBeNull();
    await internalDb.destroy();
  });

  it('leaves get() unchanged — terminology-store.ts:161 depends on the bare resource', async () => {
    const internalDb = await makeMigratedDb();
    const fhirStore = createFhirStore(internalDb as never);
    await fhirStore.save({ resourceType: 'Patient', id: 'p3' } as never, { sourceSystem: 'cdr' });
    const r = await fhirStore.get('Patient', 'p3');
    expect((r as { resourceType: string }).resourceType).toBe('Patient');
    expect((r as Record<string, unknown>).provenance).toBeUndefined();
    await internalDb.destroy();
  });
});

describe('reprojectAll', () => {
  it('rebuilds the read-model from canonical and sets the cursor to max seq', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save({ resourceType: 'Patient', id: 'p1' } as never);
    await fhirStore.save({ resourceType: 'Observation', id: 'o1', status: 'final', code: { text: 'x' } } as never);

    const n = await reprojectAll({ internalDb: internalDb as never, relationalWriter });
    expect(n.projected).toBeGreaterThanOrEqual(2);
    // The ledger count is reported separately and is NOT the resource count: Patient and Observation
    // are both ledger types and each was saved once, so exactly two arrivals — while `projected`
    // also counts the ValueSets the internal migrations seed. Two different units.
    expect(n.arrivals).toBe(2);
    expect(await externalDb.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await externalDb.selectFrom('lab_results').selectAll().execute()).toHaveLength(1);

    // cursor set to current max change_log seq so steady-state tailing won't re-project
    const maxRow = await internalDb.selectFrom('fhir.change_log').select((eb: any) => eb.fn.max('seq').as('m')).executeTakeFirst();
    expect(await readCursor(internalDb as never, 'projection')).toBe(Number((maxRow as any).m));

    await internalDb.destroy();
    await externalDb.destroy();
  });

  it('carries provenance from the canonical rows into the rebuilt rows', async () => {
    // reprojectAll is the REPAIR path. It selected only `resource`, so a full
    // rebuild wrote NULL provenance for every row — meaning nothing could ever
    // populate provenance on an existing row. Same bug as the deferred path.
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');
    await fhirStore.save(
      { resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] } as never,
      { sourceSystem: 'cdr', batchId: 'batch-1' },
    );

    await reprojectAll({ internalDb: internalDb as never, relationalWriter });

    const [row] = await externalDb.selectFrom('patients').selectAll().execute();
    expect(row.source_system).toBe('cdr');
    expect(row.batch_id).toBe('batch-1');
    await internalDb.destroy();
    await externalDb.destroy();
  });

  // reprojectAll pages fhir_resources (1,000 at a time) straight into writeMany, unlike the
  // deferred cycle which projects one resource per apply. If that paged batch ever let a scoped
  // resource's delete-then-insert be skipped or merged with a sibling's, one value set's rebuild
  // would erase the other's rows. writeMany already applies scoped resources individually
  // (relational-writer.test.ts: "writeMany still replaces ... a scoped resource batched with a
  // sibling"), so this pins that the same guarantee survives reprojectAll's own batching.
  it('rebuilds two value sets in one batch without either erasing the other', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');

    const mk = (id: string, code: string) => ({
      resourceType: 'ValueSet', id, url: `urn:test:${id}`,
      expansion: { contains: [{ system: 'sys', code, display: code }] },
    });
    for (const r of [mk('vs1', 'A'), mk('vs2', 'B')]) {
      await internalDb.insertInto('fhir.fhir_resources')
        .values({ resource_type: 'ValueSet', id: r.id, version: 1, version_id: '1', resource: JSON.stringify(r) } as never)
        .execute();
    }

    // Pre-seed a STALE row under vs1's scope in the external warehouse that the canonical fhir_resources
    // row above no longer contains. A correct rebuild's delete-then-insert must remove it; only asserting
    // that 'A' and 'B' are present (without this) would pass even if the rebuild degenerated into a plain
    // upsert that never prunes stale rows — see Step 4's mutation check.
    await relationalWriter.write(mk('vs1', 'STALE'), {});

    await reprojectAll({ internalDb: internalDb as never, relationalWriter });

    // internalDb's migrations seed several builtin ValueSets (specimen type, result flags, etc.)
    // directly into fhir.fhir_resources, and reprojectAll rebuilds ALL of them — so scope the read
    // to our two test value sets rather than asserting on the whole terminology_codes table.
    const ourCodes = async () =>
      (await sql<{ code: string }>`select code from terminology_codes where value_set_id in ('vs1', 'vs2') order by code`.execute(externalDb)).rows.map((r) => r.code);
    expect(await ourCodes()).toEqual(['A', 'B']);

    // Determinism guard: the composite id is deterministic, so a second rebuild must UPDATE the
    // dimension in place rather than duplicate it.
    const totalBefore = (await sql`select count(*) as n from terminology_codes`.execute(externalDb)).rows[0] as { n: number | string };
    await reprojectAll({ internalDb: internalDb as never, relationalWriter });
    expect(await ourCodes()).toEqual(['A', 'B']);
    const totalAfter = (await sql`select count(*) as n from terminology_codes`.execute(externalDb)).rows[0] as { n: number | string };
    expect(Number(totalAfter.n)).toBe(Number(totalBefore.n));

    await internalDb.destroy();
    await externalDb.destroy();
  });
});
