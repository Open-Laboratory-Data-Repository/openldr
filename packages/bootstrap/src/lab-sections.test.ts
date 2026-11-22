import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import {
  createFhirStore, createTerminologyStore, createTerminologyAdminStore,
  type InternalSchema, type ValueSetProjection,
} from '@openldr/db';
import { createOperations } from '@openldr/terminology';
import { createLabSections, LabSectionError } from './lab-sections';
import { LAB_SECTION_SYSTEM, LAB_SECTION_VALUE_SET } from './test-catalog';

// The terminology context bootstrap builds, over a migrated pg-mem db. Mirrors test-catalog.test.ts.
async function build() {
  const db = await makeMigratedDb();
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(resource) {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url, version, kind, resourceId) { await store.saveSystem(url, version, kind, resourceId); },
    async deleteValueSetResource(url, id) {
      await fhirStore.delete('ValueSet', id);
      await db.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const admin = createTerminologyAdminStore(db, projection);
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c),
    findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q),
    getResourceByUrl: (u) => store.getResourceByUrl(u),
    translate: (q) => store.translate(q),
  });
  return { db, ops, sections: createLabSections({ db, admin }) };
}

async function useSection(db: Kysely<InternalSchema>, testCode: string, section: string): Promise<void> {
  await db.insertInto('test_catalog_lab_settings').values({ code: testCode, section } as never).execute();
}

async function refusal(p: Promise<unknown>): Promise<LabSectionError> {
  try { await p; } catch (e) { if (e instanceof LabSectionError) return e; throw e; }
  throw new Error('expected a refusal');
}

describe('lab sections', () => {
  it('starts empty, as migration 137 seeds the list', async () => {
    const { sections } = await build();
    expect(await sections.listSections()).toEqual([]);
  });

  it('adds sections as concepts of the lab section system and lists them by code', async () => {
    const { db, sections } = await build();
    await sections.addSection('micro', 'Microbiology');
    await sections.addSection('haem', '  Haematology  ');
    expect(await sections.listSections()).toEqual([
      { code: 'haem', name: 'Haematology' },
      { code: 'micro', name: 'Microbiology' },
    ]);
    const rows = await db.selectFrom('terminology_concepts').select(['code', 'status'])
      .where('system', '=', LAB_SECTION_SYSTEM).orderBy('code').execute();
    expect(rows).toEqual([{ code: 'haem', status: 'ACTIVE' }, { code: 'micro', status: 'ACTIVE' }]);
  });

  it('makes the lab section value set expand with an added section, with no cache refresh', async () => {
    const { ops, sections } = await build();
    await sections.addSection('haem', 'Haematology');
    const vs = await ops.expand(LAB_SECTION_VALUE_SET, { count: 100 });
    expect(vs.expansion?.contains?.map((c) => [c.system, c.code, c.display])).toEqual([
      [LAB_SECTION_SYSTEM, 'haem', 'Haematology'],
    ]);
    await sections.removeSection('haem');
    expect((await ops.expand(LAB_SECTION_VALUE_SET, { count: 100 })).expansion?.contains ?? []).toEqual([]);
  });

  it('refuses a code that does not match the pattern, and writes nothing', async () => {
    const { sections } = await build();
    for (const code of ['', 'Haem', '1haem', '-haem', 'haem_1', 'h a', 'a'.repeat(41)]) {
      const e = await refusal(sections.addSection(code, 'Name'));
      expect(e.kind, code).toBe('invalid');
      expect(e.message, code).toBe(`section code "${code}" must start with a lowercase letter and have at most 40 lowercase letters, digits or dashes`);
    }
    await sections.addSection('a'.repeat(40), 'Longest code');
    await sections.addSection('h-2', 'Dash and digit');
    expect((await sections.listSections()).map((s) => s.code)).toEqual(['a'.repeat(40), 'h-2']);
  });

  it('refuses a name that is empty after trimming or longer than 100 characters', async () => {
    const { sections } = await build();
    for (const name of ['', '   ', 'x'.repeat(101)]) {
      const e = await refusal(sections.addSection('haem', name));
      expect(e.kind).toBe('invalid');
      expect(e.message).toBe('a section name must be 1 to 100 characters');
    }
    await sections.addSection('haem', 'x'.repeat(100));
    expect(await sections.listSections()).toEqual([{ code: 'haem', name: 'x'.repeat(100) }]);
  });

  it('refuses a code that exists and keeps the stored name', async () => {
    const { sections } = await build();
    await sections.addSection('haem', 'Haematology');
    const e = await refusal(sections.addSection('haem', 'Other'));
    expect(e.kind).toBe('conflict');
    expect(e.message).toBe('section haem already exists');
    expect(await sections.listSections()).toEqual([{ code: 'haem', name: 'Haematology' }]);
  });

  it('removes a section no test uses', async () => {
    const { sections } = await build();
    await sections.addSection('haem', 'Haematology');
    await sections.addSection('micro', 'Microbiology');
    await sections.removeSection('haem');
    expect(await sections.listSections()).toEqual([{ code: 'micro', name: 'Microbiology' }]);
  });

  it('refuses to remove a section a test still uses, and keeps it', async () => {
    const { db, sections } = await build();
    await sections.addSection('haem', 'Haematology');
    await useSection(db, 'HIVVL', 'haem');
    await useSection(db, 'CD4', 'haem');
    const e = await refusal(sections.removeSection('haem'));
    expect(e.kind).toBe('conflict');
    expect(e.message).toBe('section haem is used by 2 tests');
    expect(await sections.listSections()).toEqual([{ code: 'haem', name: 'Haematology' }]);
  });

  it('refuses to remove a section that does not exist', async () => {
    const { sections } = await build();
    const e = await refusal(sections.removeSection('haem'));
    expect(e.kind).toBe('not-found');
    expect(e.message).toBe('no section haem');
  });

  // A lab pulling from a central wipes every local concept of a synced system. The section list is
  // each node's own, so adding or removing a section must log no sync change.
  it('adds and removes sections without writing a sync change row', async () => {
    const { db, sections } = await build();
    const before = await db.selectFrom('reference_change_log').selectAll().execute();
    await sections.addSection('haem', 'Haematology');
    await sections.addSection('micro', 'Microbiology');
    await sections.removeSection('haem');
    const after = await db.selectFrom('reference_change_log').selectAll().execute();
    expect(after).toEqual(before);
    expect(after.filter((r) => r.entity_id === LAB_SECTION_SYSTEM)).toEqual([]);
  });
});
