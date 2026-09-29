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

  // A ValueSet arriving with no `expansion` still carries a scope, and that scope must DELETE
  // every row it previously owned — "no expansion" means "this value set now contributes nothing",
  // not "leave the old rows alone". Unpinned before this test: adding
  // `if (p.rows.length === 0) return;` to relational-writer.ts's replaceScope (an "optimization"
  // that skips the delete-then-insert transaction when there's nothing to insert) left all other
  // tests in this suite green while silently reverting this semantic.
  it('clears prior rows when the same value set id is re-written with no expansion', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write(vs('vs1', ['A', 'B']), {});
    expect(await codes(db)).toEqual(['A', 'B']);
    await w.write({ resourceType: 'ValueSet', id: 'vs1', url: 'urn:test:vs1' }, {}); // no expansion
    expect(await codes(db)).toEqual([]);
    await db.destroy();
  });

  // Every other test here reads back only `code`, so a regression that dropped `display` or nulled
  // `value_set_url` — or even scrambled `id` — would be invisible: `replaceScope` deletes the scope
  // before inserting, so even a non-deterministic id would keep prior tests green (nothing stale
  // survives to collide with). This test reads the FULL row the writer actually persisted.
  it('projects the full row mapping into the database — id, value_set_id, value_set_url, system, code, display', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as any);
    await w.write(
      {
        resourceType: 'ValueSet', id: 'vs-full', url: 'urn:test:vs-full',
        expansion: { contains: [{ system: 'urn:openldr:cs:local', code: 'M', display: 'Male' }] },
      },
      {},
    );
    const rows = (
      await sql<{
        id: string; value_set_id: string; value_set_url: string; system: string; code: string; display: string;
      }>`select id, value_set_id, value_set_url, system, code, display from terminology_codes`.execute(db)
    ).rows;
    expect(rows).toEqual([{
      id: 'vs-full|urn:openldr:cs:local|M',
      value_set_id: 'vs-full',
      value_set_url: 'urn:test:vs-full',
      system: 'urn:openldr:cs:local',
      code: 'M',
      display: 'Male',
    }]);
    await db.destroy();
  });
});

const sr = (attrs: { code: string; value: string }[]) => ({
  resourceType: 'ServiceRequest', id: 'sr-1', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' },
  extension: attrs.map((a) => ({
    url: 'urn:openldr:ext:request-attribute',
    extension: [
      { url: 'code', valueCoding: { system: 'urn:openldr:cs:request-attribute', code: a.code } },
      { url: 'value', valueString: a.value },
    ],
  })),
});

describe('rows a resource owns in other tables', () => {
  it('writes a request row and its attribute rows', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    await w.write(sr([{ code: 'therapy', value: 'ART' }]), {});
    expect(await db.selectFrom('lab_requests').select('id').execute()).toEqual([{ id: 'sr-1' }]);
    expect(await db.selectFrom('lab_request_attributes').select(['lab_request_id', 'code', 'value_text']).execute())
      .toEqual([{ lab_request_id: 'sr-1', code: 'therapy', value_text: 'ART' }]);
    await db.destroy();
  });

  it('replaces the attribute set on a re-send, including down to none', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    await w.write(sr([{ code: 'therapy', value: 'ART' }, { code: 'vendor-code', value: 'DISA' }]), {});
    await w.write(sr([{ code: 'therapy', value: 'ART2' }]), {});
    expect(await db.selectFrom('lab_request_attributes').select(['code', 'value_text']).execute())
      .toEqual([{ code: 'therapy', value_text: 'ART2' }]);
    await w.write(sr([]), {});
    expect(await db.selectFrom('lab_request_attributes').selectAll().execute()).toEqual([]);
    await db.destroy();
  });

  it("writeMany keeps each request's attributes separate", async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    const a = sr([{ code: 'therapy', value: 'A' }]);
    const b = { ...sr([{ code: 'therapy', value: 'B' }]), id: 'sr-2' };
    await w.writeMany([{ resource: a, provenance: {} }, { resource: b, provenance: {} }]);
    const rows = await db.selectFrom('lab_request_attributes').select(['lab_request_id', 'value_text']).orderBy('lab_request_id').execute();
    expect(rows).toEqual([{ lab_request_id: 'sr-1', value_text: 'A' }, { lab_request_id: 'sr-2', value_text: 'B' }]);
    await db.destroy();
  });

  // R2: two versions of the SAME ServiceRequest land in one writeMany batch. Version 1's dropped
  // attribute (vendor-code) must not linger, and Postgres would error on two ON CONFLICT targets
  // for the same id in one statement anyway. Keep only the LAST item's owned rows for that scope.
  it('writeMany keeps only the last version\'s owned rows when a batch repeats an id', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    const v1 = sr([{ code: 'therapy', value: 'ART' }, { code: 'vendor-code', value: 'DISA' }]);
    const v2 = sr([{ code: 'therapy', value: 'ART' }]);
    await w.writeMany([{ resource: v1, provenance: {} }, { resource: v2, provenance: {} }]);
    const rows = await db.selectFrom('lab_request_attributes').select(['code', 'value_text']).execute();
    expect(rows).toEqual([{ code: 'therapy', value_text: 'ART' }]);
    await db.destroy();
  });

  it('deleteById removes the request and its attributes', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    await w.write(sr([{ code: 'therapy', value: 'ART' }]), {});
    await w.deleteById('ServiceRequest', 'sr-1');
    expect(await db.selectFrom('lab_requests').selectAll().execute()).toEqual([]);
    expect(await db.selectFrom('lab_request_attributes').selectAll().execute()).toEqual([]);
    await db.destroy();
  });
});
