import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely, sql } from 'kysely';
import { newDb } from 'pg-mem';
import { createReportDesignStore } from './store';
import { ReportDesignSchema } from './schema';
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
    // Mirrors migration 042's `notNull().defaultTo(sql`now()`)` — needed so a DB-stamped timestamp is
    // actually present to assert on (no earlier test in this file read createdAt/updatedAt).
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`)).execute();
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
    // re-ship every previously-unflagged design over reference sync (see migration 083).
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
    // This is the property migration 083's nullability rests on: `false` is NOT the same as unset,
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

  // Finding 3 (final whole-branch review of T1): the spec's recurrence guard requires proving
  // hashOf's coverage per field, not just for pageNumbers. Without this, a future field dropped from
  // hashOf alone (it still persists via toRow/fromRow, it just never syncs) would pass every other
  // test in this file. `id`, `createdAt` and `updatedAt` are deliberately NOT hashed and must not
  // appear in this table. A new hashed field is a one-line addition here.
  const HASHED_FIELD_MUTATIONS: Array<[string, (d: ReportDesign) => ReportDesign]> = [
    ['name', (d) => ({ ...d, name: 'Different Name' })],
    ['paper', (d) => ({ ...d, paper: 'Letter' })],
    ['orientation', (d) => ({ ...d, orientation: 'landscape' })],
    ['pages', (d) => ({ ...d, pages: [{ id: 'other-page', elements: [] }] })],
    ['parameters', (d) => ({ ...d, parameters: [{ key: 'k', label: 'K' }] })],
    ['margins', (d) => ({ ...d, margins: { top: 1, right: 2, bottom: 3, left: 4 } })],
    ['pageNumbers', (d) => ({ ...d, pageNumbers: true })],
  ];

  it('hashOf changes when any individually-hashed field is mutated', async () => {
    for (const [field, mutate] of HASHED_FIELD_MUTATIONS) {
      const { capture, hashes } = spyCapture();
      const store = createReportDesignStore(db, capture);
      const baseline = makeDesign(`hf-${field}-base`, 'Baseline');
      const mutated = mutate(makeDesign(`hf-${field}-mut`, 'Baseline'));
      await store.create(baseline);
      await store.create(mutated);
      expect(hashes[1], `hashOf did not change when '${field}' was mutated`).not.toBe(hashes[0]);
    }
  });
});

// The defect this slice fixes was "a field nobody remembered". A fixture alone cannot catch the
// next one, because a new field is simply absent from it and everything still passes. The tripwire
// is what forces the fixture to grow.
const KNOWN_TOP_LEVEL_FIELDS = [
  'id', 'name', 'paper', 'orientation', 'pages', 'parameters', 'margins', 'pageNumbers',
  'createdAt', 'updatedAt',
] as const;

describe('ReportDesign round-trip completeness', () => {
  it('has no top-level schema field the store has not been taught about', () => {
    // FAILING HERE? You added a field to ReportDesignSchema. Do all four:
    //   1. persist it in `toRow` and read it in `fromRow` (packages/report-designer/src/store.ts),
    //      adding a column via a migration if it is not inside the `pages` jsonb blob;
    //   2. add it to `hashOf`, or it will never sync;
    //   3. add it to KNOWN_TOP_LEVEL_FIELDS and to EVERY_FIELD below, with a non-default value;
    //   4. add it to `reportDesignRow` in packages/db/src/reference-apply.ts, or it will persist on
    //      this side but a design pulled from central will never carry it to a lab (this is exactly
    //      the gap the final whole-branch review of slice T1 found: the field was in `hashOf` but
    //      not in the lab-side applier, so the hash moved and the value still never arrived).
    expect(Object.keys(ReportDesignSchema.shape).sort()).toEqual([...KNOWN_TOP_LEVEL_FIELDS].sort());
  });

  it('round-trips every persisted field at a non-default value', async () => {
    const EVERY_FIELD: ReportDesign = {
      id: 'full',
      name: 'Every field set',
      paper: 'Letter',
      orientation: 'landscape',
      margins: { top: 11, right: 22, bottom: 33, left: 44 },
      parameters: [{ key: 'facility', label: 'Facility', type: 'select', required: true, value: 'Ndola' }],
      pages: [{
        id: 'full-p1',
        elements: [{ id: 'e1', kind: 'text', name: 'Title', rect: { x: 1, y: 2, w: 3, h: 4 }, text: 'Hi' }],
      }],
      pageNumbers: true,
    };

    // The KNOWN_TOP_LEVEL_FIELDS tripwire above only checks the schema's key SET. A new field can be
    // added there alone and the array-equality check passes without EVERY_FIELD (or toRow/fromRow/
    // hashOf) ever being touched, because every field added to this schema so far — margins,
    // pageNumbers, createdAt, updatedAt — has been optional, so the ReportDesign type annotation on
    // EVERY_FIELD does not force the compiler to catch the omission either. This assertion makes
    // fixture completeness an actual check instead of a comment three lines above asking nicely.
    expect(Object.keys(EVERY_FIELD).sort())
      .toEqual(KNOWN_TOP_LEVEL_FIELDS.filter((f) => f !== 'createdAt' && f !== 'updatedAt').sort());

    const store = createReportDesignStore(db);
    await store.create(EVERY_FIELD);
    const got = await store.get('full');
    expect(got).toBeDefined();

    // `createdAt`/`updatedAt` are stamped by the database, not round-tripped from the input.
    const { createdAt, updatedAt, ...persisted } = got!;
    expect(createdAt).toBeDefined();
    expect(updatedAt).toBeDefined();
    expect(persisted).toEqual(EVERY_FIELD);
  });

  it('reads back a design whose image source would be refused on save', async () => {
    // ⛔ Regression guard for the image rule's placement. The rule that rejects an https image
    // source lives at the API's write boundary, NOT in ReportDesignSchema — because `fromRow`
    // parses every stored design through that schema. If it ever migrates into the schema, a row
    // written before the rule existed becomes permanently unopenable and this test fails.
    const store = createReportDesignStore(db);
    const d = makeDesign('img', 'Has a URL image');
    d.pages = [{ id: 'p1', elements: [{ id: 'logo', kind: 'image', name: 'Logo', rect: { x: 0, y: 0, w: 10, h: 10 }, src: 'https://example.org/logo.png' }] }];
    await store.create(d);

    const got = await store.get('img');
    expect(got).toBeDefined();
    expect(got?.pages[0].elements[0].src).toBe('https://example.org/logo.png');
  });
});
