import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createReportDesignStore } from './store';
import type { ReportDesign } from './schema';
import type { ReferenceCapture } from '@openldr/db';

let db: Kysely<any>;
beforeEach(async () => {
  const mem = newDb();
  db = mem.adapters.createKysely();
  await db.schema.createTable('report_designs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('paper', 'text')
    .addColumn('orientation', 'text')
    .addColumn('pages', 'jsonb').addColumn('parameters', 'jsonb')
    .addColumn('margins', 'jsonb')
    .addColumn('page_numbers', 'boolean')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text').execute();
});

function makeDesign(id: string, name: string): ReportDesign {
  return {
    id,
    name,
    paper: 'A4',
    orientation: 'portrait',
    // Fixed, not derived from `id` — the hash tests compare two designs that must differ ONLY in
    // `pageNumbers`, and `hashOf` covers `pages`.
    pages: [{ id: 'p1', elements: [] }],
    parameters: [],
  };
}

describe('ReportDesignStore', () => {
  it('creates, lists, gets, updates, deletes', async () => {
    const store = createReportDesignStore(db);
    const created = await store.create(makeDesign('d1', 'Main'));
    expect(created.name).toBe('Main');
    expect((await store.list()).length).toBe(1);
    expect((await store.get('d1'))?.paper).toBe('A4');

    await store.update('d1', { ...created, name: 'Renamed', orientation: 'landscape' });
    const updated = await store.get('d1');
    expect(updated?.name).toBe('Renamed');
    expect(updated?.orientation).toBe('landscape');

    await store.remove('d1');
    expect(await store.get('d1')).toBeUndefined();
  });

  it('round-trips pages + parameters + margins JSON', async () => {
    const store = createReportDesignStore(db);
    const d = makeDesign('d2', 'Bound');
    d.margins = { top: 40, right: 48, bottom: 40, left: 48 };
    d.parameters = [{ key: 'facility', label: 'Facility', value: 'Ndola' }];
    d.pages = [{
      id: 'd2-p1',
      elements: [{ id: 'e1', kind: 'text', name: 'Title', rect: { x: 1, y: 2, w: 3, h: 4 }, text: 'Hi' }],
    }];
    await store.create(d);
    const got = await store.get('d2');
    expect(got?.margins).toMatchObject({ top: 40, left: 48 });
    expect(got?.parameters[0]).toMatchObject({ key: 'facility', value: 'Ndola' });
    expect(got?.pages[0].elements[0].kind).toBe('text');
  });

  it('create is idempotent on id — the second create returns the existing row', async () => {
    const store = createReportDesignStore(db);
    const first = await store.create(makeDesign('dup', 'First'));
    const second = await store.create(makeDesign('dup', 'Second'));
    expect(second.id).toBe('dup');
    expect(second.name).toBe(first.name);
    expect((await store.list()).length).toBe(1);
  });

  it('round-trips pageNumbers, and reads an unset flag back as undefined not false', async () => {
    const store = createReportDesignStore(db);

    await store.create({ ...makeDesign('pn-on', 'On'), pageNumbers: true });
    expect((await store.get('pn-on'))?.pageNumbers).toBe(true);

    await store.create({ ...makeDesign('pn-off', 'Off'), pageNumbers: false });
    expect((await store.get('pn-off'))?.pageNumbers).toBe(false);

    // Unset must come back `undefined`. `false` would change the design's content hash and
    // re-ship every previously-unflagged design over reference sync (see migration 082).
    await store.create(makeDesign('pn-unset', 'Unset'));
    expect((await store.get('pn-unset'))?.pageNumbers).toBeUndefined();
  });

  it('preserves pageNumbers across an update', async () => {
    const store = createReportDesignStore(db);
    const created = await store.create({ ...makeDesign('pn-upd', 'Upd'), pageNumbers: true });
    await store.update('pn-upd', { ...created, name: 'Renamed' });
    const updated = await store.get('pn-upd');
    expect(updated?.name).toBe('Renamed');
    expect(updated?.pageNumbers).toBe(true);
  });

  // Captures the content hash the store records for each write, which is the only observable
  // surface of the module-private `hashOf`.
  function spyCapture() {
    const hashes: (string | null)[] = [];
    const capture: ReferenceCapture = {
      record: async (_trx, _entityType, _entityId, _op, contentHash) => { hashes.push(contentHash); },
    };
    return { capture, hashes };
  }

  it('hashes an unset pageNumbers identically to an explicitly undefined one', async () => {
    // Pins canonicalJson's undefined-dropping. If that ever changed, every never-flagged design's
    // hash would move and reference sync would re-ship the whole design set.
    const { capture, hashes } = spyCapture();
    const store = createReportDesignStore(db, capture);
    await store.create(makeDesign('h-absent', 'Same'));
    await store.create({ ...makeDesign('h-undef', 'Same'), pageNumbers: undefined });
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('hashes false differently from unset', async () => {
    // This is the property migration 082's nullability rests on: `false` is NOT the same as unset,
    // so a NOT NULL DEFAULT false column would have moved every existing design's hash.
    const { capture, hashes } = spyCapture();
    const store = createReportDesignStore(db, capture);
    await store.create(makeDesign('h-unset', 'Same'));
    await store.create({ ...makeDesign('h-false', 'Same'), pageNumbers: false });
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('hashes true differently from false, so a real toggle propagates', async () => {
    const { capture, hashes } = spyCapture();
    const store = createReportDesignStore(db, capture);
    await store.create({ ...makeDesign('h-off', 'Same'), pageNumbers: false });
    await store.create({ ...makeDesign('h-on', 'Same'), pageNumbers: true });
    expect(hashes[0]).not.toBe(hashes[1]);
  });
});
