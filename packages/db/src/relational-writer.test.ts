import { describe, expect, it } from 'vitest';
import { makeMigratedExternalDb } from './test-helpers-external';
import { createRelationalWriter } from './relational-writer';
import { sql } from 'kysely';

describe('relational-writer', () => {
  it('writes/upserts a resource into its table and deletes by id', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');

    expect(await w.write({ resourceType: 'Patient', id: 'p1', name: [{ family: 'A' }] }, {})).toBe('written');
    expect(await db.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    await w.write({ resourceType: 'Patient', id: 'p1', name: [{ family: 'B' }] }, {});
    const rows = await db.selectFrom('patients').select(['id', 'surname']).execute();
    expect(rows).toEqual([{ id: 'p1', surname: 'B' }]);
    expect(await w.write({ resourceType: 'Bundle', id: 'b1' }, {})).toBe('skipped');
    await w.deleteById('Patient', 'p1');
    expect(await db.selectFrom('patients').selectAll().execute()).toHaveLength(0);
    await w.deleteById('Bundle', 'x');
    await db.destroy();
  });

  it('writeMany groups by table and returns per-item results', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    const results = await w.writeMany([
      { resource: { resourceType: 'Patient', id: 'p1' }, provenance: {} },
      { resource: { resourceType: 'Bundle', id: 'b1' }, provenance: {} },
      { resource: { resourceType: 'Observation', id: 'o1', code: { coding: [{ code: 'x' }] } }, provenance: {} },
    ]);
    expect(results).toEqual(['written', 'skipped', 'written']);
    expect(await db.selectFrom('patients').selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom('lab_results').selectAll().execute()).toHaveLength(1);
    await db.destroy();
  });
});

const codes = (db: any) =>
  sql<{ code: string }>`select code from terminology_codes order by code`.execute(db)
    .then((r: any) => r.rows.map((x: any) => x.code));

const vs = (id: string, cs: string[]) => ({
  resourceType: 'ValueSet', id, url: `urn:test:${id}`,
  expansion: { contains: cs.map((c) => ({ system: 'sys', code: c, display: c })) },
});

describe('scoped projection', () => {
  it('drops the codes a shrinking value set no longer contains', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write(vs('vs1', ['A', 'B', 'C']), {});
    expect(await codes(db)).toEqual(['A', 'B', 'C']);
    await w.write(vs('vs1', ['A', 'C']), {});
    expect(await codes(db)).toEqual(['A', 'C']); // B is GONE, not merely stale
    await db.destroy();
  });

  it('does not let one value set delete another value set rows', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write(vs('vs1', ['A']), {});
    await w.write(vs('vs2', ['B']), {});
    expect(await codes(db)).toEqual(['A', 'B']);
    await db.destroy();
  });

  // Not in the brief verbatim — added because the brief's own cross-contamination test above calls
  // w.write() twice, which never touches writeMany's `scoped`/`unscoped` split at all, so mutating
  // that split's guard (removing `if (p.scope) { scoped.push(p); return; }`) left every prior test
  // green: two FRESH value sets batched together don't corrupt each other under that mutation
  // either, because the buggy path is a plain (non-deleting) upsert — nothing to delete yet, so
  // nothing is lost. The mutation only becomes observable when a SHRINKING scoped write is batched
  // alongside a sibling: without the guard, the shrink's delete-then-insert never runs, so its
  // stale row silently survives. This is the test that actually exercises the code the brief's
  // Step 5 mutation #2 targets — two scoped resources sharing one writeMany() batch.
  it('writeMany still replaces (not merely upserts) a scoped resource batched with a sibling', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write(vs('vs1', ['A', 'B']), {});
    await w.writeMany([
      { resource: vs('vs1', ['A']), provenance: {} }, // vs1 shrinks to just A
      { resource: vs('vs2', ['C']), provenance: {} }, // new sibling, same batch
    ]);
    expect(await codes(db)).toEqual(['A', 'C']); // B is GONE even though it arrived via writeMany
    await db.destroy();
  });

  it('clears every row of a value set when the resource is deleted', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write(vs('vs1', ['A', 'B']), {});
    await w.deleteById('ValueSet', 'vs1');
    expect(await codes(db)).toEqual([]);
    await db.destroy();
  });

  it('leaves fact-table writes exactly as they were', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write({ resourceType: 'Patient', id: 'p1', gender: 'male' }, {});
    await w.write({ resourceType: 'Patient', id: 'p2', gender: 'female' }, {});
    const rows = (await sql<{ id: string }>`select id from patients order by id`.execute(db)).rows;
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2']); // no scope ⇒ no deletion of p1
    await db.destroy();
  });
});
