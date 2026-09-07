import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from './schema/internal';
import { createTerminologyAdminStore } from './terminology-admin-store';

// ⛔ WHY THIS FILE CANNOT BE A pg-mem TEST.
//
// The defect is a RACE between two expansions of the same value set. `writeExpansionCache` did a
// bare `delete` followed by a plain `insert`, neither in a transaction and the insert with no
// conflict clause, so two callers could interleave as
//
//     A delete -> B delete -> A insert -> B insert
//
// and the last insert collided with the rows the previous one had just written:
//
//     duplicate key value violates unique constraint "valueset_expansions_pk"
//
// pg-mem runs statements serially and cannot interleave two real transactions, so a pg-mem test
// passes against the BROKEN code: delete-then-insert is fine when nothing runs between the two.
// That is why the sibling assertion in terminology-admin-store.test.ts is a characterisation pin
// and not a reproduction, and why this file exists.
//
// How it was found: the facility import's value-mapping panel fetches its fields in PARALLEL, one
// request per controlled field, and each request expands that field's bound value set. On an
// ordinary import the Level request came back 500 while Status came back fine, which the panel then
// rendered as an empty picker with no explanation. Observed on the live dev server, 2026-09-06.
//
// Gated on INTERNAL_DATABASE_URL exactly like facility-registry-live.test.ts, and it writes only
// under its own marker URL, deleting that marker before and after itself so a run that dies mid-way
// is cleaned up by the next run.
const url = process.env.INTERNAL_DATABASE_URL;
const live = describe.skipIf(!url);

const MARKER = 'urn:openldr:test:vs-expansion-race';
const SYSTEM = 'urn:openldr:test:cs-expansion-race';

live('value set expansion cache (live Postgres — pg-mem cannot interleave two transactions)', () => {
  let db: Kysely<InternalSchema>;

  beforeAll(async () => {
    db = new Kysely<InternalSchema>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url }) }),
    });
    await db.deleteFrom('value_sets').where('url', '=', MARKER).execute();
    await db.deleteFrom('terminology_concepts').where('system', '=', SYSTEM).execute();
    await db.insertInto('terminology_concepts').values(
      Array.from({ length: 40 }, (_, i) => ({
        system: SYSTEM, code: `c${i}`, display: `Concept ${i}`, status: 'ACTIVE',
      })) as never,
    ).execute();
  });

  afterAll(async () => {
    await db.deleteFrom('value_sets').where('url', '=', MARKER).execute();
    await db.deleteFrom('terminology_concepts').where('system', '=', SYSTEM).execute();
    await db.destroy();
  });

  it('⛔ survives two expansions of the same set running at once', async () => {
    const admin = createTerminologyAdminStore(db);
    const vs = await admin.valueSets.save({
      url: MARKER, version: null, name: null, title: 'expansion race', status: 'active',
      experimental: false, description: null,
      compose: { include: [{ system: SYSTEM }] },
    });

    // The panel's own shape: several expansions in flight together, not one after another. Against
    // the bare delete-then-insert this rejects with the duplicate-key error above.
    const results = await Promise.allSettled([
      admin.valueSets.expand(vs.id),
      admin.valueSets.expand(vs.id),
      admin.valueSets.expand(vs.id),
    ]);

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);

    // And the cache is intact afterwards, not half-written by whichever call lost the race.
    const rows = await db.selectFrom('valueset_expansions').select('code')
      .where('value_set_id', '=', vs.id).execute();
    expect(rows).toHaveLength(40);
  });
});
