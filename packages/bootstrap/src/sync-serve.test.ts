import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { servePull } from './sync-serve';

// servePull's window scan only touches ctx.internalDb for this case (the suspended-type guard fires
// before fetchReferenceBody, so none of the store/settings deps on AppContext are exercised) —
// mirrors the stubCtx pattern in sync-serve-amend.test.ts.
function stubCtx(db: Kysely<any>): any {
  return { internalDb: db, logger: { warn() {}, info() {}, error() {} } };
}

describe('servePull', () => {
  it('emits NO record for a legacy facility_registry change_log row — not even a delete', async () => {
    // A row logged before the entity type was suspended. Before this fix, fetchReferenceBody had no
    // case for it, returned null, and sync-serve.ts's servePull loop turned it into a DELETE
    // instruction the lab would apply against a table central never served it a row for.
    const db = await makeMigratedDb();
    await db.insertInto('reference_change_log').values({
      entity_type: 'facility_registry', entity_id: 'fac-legacy', op: 'upsert', content_hash: 'h',
    } as never).execute();

    const { records } = await servePull(stubCtx(db), 0);

    expect(records.filter((r) => String(r.entityType) === 'facility_registry')).toEqual([]);
  });
});
