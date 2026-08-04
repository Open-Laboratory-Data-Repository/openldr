import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from '../migrations/internal/test-helpers';
import { makeMigratedExternalDb } from '../test-helpers-external';
import { createFhirStore } from '../fhir-store';
import { createRelationalWriter } from '../relational-writer';
import { createProjectionRunner, type FetchSafeRows } from './cycle';
import { createTerminologyAdminStore, type ValueSetProjection } from '../terminology-admin-store';

const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

// F3: admin.valueSets.delete(id) must make the value set's terminology_codes rows actually
// disappear. Before the fix, both bootstrap ValueSetProjection implementations
// (packages/bootstrap/src/index.ts, packages/bootstrap/src/terminology-context.ts) deleted only
// `terminology_systems` by url — the canonical fhir.fhir_resources ValueSet row survived, so no
// op:'delete' change_log row was ever written, and the projection cycle (which decides
// upsert-vs-delete by whether fhirStore.getWithProvenance still finds the canonical resource) never
// saw a reason to clear the row. This test wires the SAME shape of projection object the two
// bootstrap implementations use (delegating to a real fhirStore.delete('ValueSet', id)) end-to-end
// through admin store -> projection port -> fhirStore -> change_log -> projection cycle ->
// relationalWriter.deleteById, and proves the projected codes are gone afterward.
describe('admin.valueSets.delete reaches the projection (F3)', () => {
  it('deletes the canonical ValueSet resource so the next projection cycle clears its terminology_codes rows', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const fhirStore = createFhirStore(internalDb as never);
    const relationalWriter = createRelationalWriter(externalDb as never, 'postgres');

    const projection: ValueSetProjection = {
      async saveValueSetResource(resource) {
        const saved = await fhirStore.save(resource as never);
        return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
      },
      async registerSystem() {
        // Not exercised by this test — the real implementations project into
        // terminology_systems, orthogonal to what F3 is pinning.
      },
      async deleteValueSetResource(_url, id) {
        // The fix: delete the canonical resource so a real change_log 'delete' row is written.
        await fhirStore.delete('ValueSet', id);
      },
    };

    const admin = createTerminologyAdminStore(internalDb as never, projection);
    const vs = await admin.valueSets.save({
      url: 'urn:test:f3-delete',
      status: 'active',
      compose: { include: [{ system: 'urn:sys', concept: [{ code: 'A', display: 'Alpha' }] }] },
    });

    // Project the save (upsert) so terminology_codes actually holds rows to delete. Feed the fake
    // fetch EVERY change_log row that exists so far (all with a safe xid), not just a single
    // hardcoded `seq: 1` row for our own resource — migration 072 now seeds two of its own
    // fhir.change_log rows ahead of this test (both its ValueSets carry an expansion, so they must
    // be reachable by the projection; see that migration's `seedChangeLogRow`), so a freshly migrated
    // pg-mem db no longer starts change_log empty. planProjection treats any seq in (cursor, maxSeq]
    // that is NOT present in the returned rows as an unconfirmed gap and refuses to advance the
    // cursor past it — a fetch that silently omitted those two real, already-committed rows would
    // manufacture a phantom gap and starve this cycle of any task.
    const allRows = await internalDb
      .selectFrom('fhir.change_log')
      .select(['seq', 'resource_type', 'resource_id', 'op'])
      .orderBy('seq')
      .execute();
    const upsertFetch: FetchSafeRows = async () => ({
      rows: allRows.map((r: { seq: number; resource_type: string; resource_id: string; op: string }) => ({
        seq: Number(r.seq), xid: 1, resource_type: r.resource_type, resource_id: r.resource_id, op: r.op,
      })),
      boundary: 100,
      xmax: 200,
    });
    await createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch: upsertFetch, batchSize: 500 }).runCycle();

    const codeCount = async () =>
      Number(
        (await sql<{ n: string }>`select count(*)::text as n from terminology_codes where value_set_id = ${vs.id}`.execute(externalDb)).rows[0]!.n,
      );
    expect(await codeCount()).toBeGreaterThan(0);

    await admin.valueSets.delete(vs.id);

    // The delete's own change_log row (fetchSafeChangeRows is real-Postgres-only and can't run
    // against the pg-mem test double, so read the seq it actually wrote and feed it through the
    // same fake-fetch shape every other cycle.test.ts case uses).
    const deleteRow = await internalDb
      .selectFrom('fhir.change_log')
      .select('seq')
      .where('resource_id', '=', vs.id)
      .where('resource_type', '=', 'ValueSet')
      .where('op', '=', 'delete')
      .executeTakeFirstOrThrow();

    const deleteFetch: FetchSafeRows = async () => ({
      rows: [{ seq: Number(deleteRow.seq), xid: 2, resource_type: 'ValueSet', resource_id: vs.id, op: 'delete' }],
      boundary: 100,
      xmax: 200,
    });
    await createProjectionRunner({ internalDb: internalDb as never, fhirStore, relationalWriter, logger, fetch: deleteFetch, batchSize: 500 }).runCycle();

    expect(await codeCount()).toBe(0);

    await internalDb.destroy();
    await externalDb.destroy();
  });
});
