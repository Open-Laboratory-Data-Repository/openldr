import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { referenceCapture } from '@openldr/db';
import { createReportDesignStore, type ReportDesign } from '@openldr/report-designer';
import { servePull } from './sync-serve';

// servePull reaches ctx.internalDb plus the read store for whichever entity type is under test —
// mirrors the stubCtx pattern in sync-serve-amend.test.ts. `reportDesigns` is a REAL store over the
// same migrated db, not a fake: the published-vs-draft gate is the thing being tested, so a fake
// that returns a canned body would test the fake.
function stubCtx(db: Kysely<any>): any {
  return {
    internalDb: db,
    reportDesigns: createReportDesignStore(db as never),
    logger: { warn() {}, info() {}, error() {} },
  };
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

  it('⛔ serves a DELETE, not the draft body, for a design edited since it was published', async () => {
    // The hazard slice T3 exists to close, by its second route. `reference_change_log` stores only
    // (entity_id, content_hash) — the BODY is read live at pull time (see fetchReferenceBody above).
    // So gating CAPTURE on published does not gate DELIVERY: publish D (log row at seq N), then let
    // autosave write an edit (correctly draft, correctly no new log row), and any lab whose cursor
    // is below N still pulls whatever is in the table right now. A first-time enrolment replays
    // from seq 0, so that is the normal path, not an edge case.
    const db = await makeMigratedDb();
    const designs = createReportDesignStore(db as never, referenceCapture);
    const d: ReportDesign = {
      id: 'rd-leak', name: 'Reviewed', paper: 'A4', orientation: 'portrait', status: 'draft',
      parameters: [], pages: [{ id: 'p1', elements: [] }],
    };
    await designs.create(d);
    await designs.publish('rd-leak');
    await designs.update('rd-leak', { ...d, name: 'Half-finished edit', pages: [{ id: 'p1', elements: [{ id: 'e1', kind: 'text', name: 'WIP', rect: { x: 0, y: 0, w: 10, h: 10 }, text: 'not ready' }] }] });
    expect((await designs.get('rd-leak'))?.status).toBe('draft');

    const { records } = await servePull(stubCtx(db), 0);

    const served = records.filter((r) => String(r.entityType) === 'report_design');
    expect(served).toHaveLength(1);
    expect(served[0].op).toBe('delete');
    expect(served[0].body).toBeUndefined();
  });

  it('serves the design body while it is published', async () => {
    // The other half: gating on status must not break the case the sync exists for.
    const db = await makeMigratedDb();
    const designs = createReportDesignStore(db as never, referenceCapture);
    await designs.create({
      id: 'rd-live', name: 'Live', paper: 'A4', orientation: 'portrait', status: 'draft',
      parameters: [], pages: [{ id: 'p1', elements: [] }],
    });
    await designs.publish('rd-live');

    const { records } = await servePull(stubCtx(db), 0);

    const served = records.filter((r) => String(r.entityType) === 'report_design');
    expect(served).toHaveLength(1);
    expect(served[0].op).toBe('upsert');
    expect((served[0].body as ReportDesign).name).toBe('Live');
  });
});
