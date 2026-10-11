import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFhirStore, createTerminologyStore, createTerminologyAdminStore, type ValueSetProjection } from '@openldr/db';
import { createOperations } from '@openldr/terminology';
import { createTestCatalog } from './test-catalog';

async function catalogWithSpy() {
  const db = await makeMigratedDb();
  const fhirStore = createFhirStore(db);
  const store = createTerminologyStore(db, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(r) { const s = await fhirStore.save(r as never); return (s as { id?: string })?.id ?? ''; },
    async registerSystem(url, version, kind, id) { await store.saveSystem(url, version, kind, id); },
    async deleteValueSetResource(url, id) { await fhirStore.delete('ValueSet', id); await db.deleteFrom('terminology_systems').where('url', '=', url).execute(); },
  };
  const admin = createTerminologyAdminStore(db, projection);
  const ops = createOperations({
    getConcept: (s, c) => store.getConcept(s, c), findConcepts: (q) => store.findConcepts(q),
    countConcepts: (q) => store.countConcepts(q), getResourceByUrl: (u) => store.getResourceByUrl(u), translate: (q) => store.translate(q),
  });
  let calls = 0;
  const catalog = createTestCatalog({ db, admin, ops, onChanged: () => { calls += 1; } });
  return { catalog, calls: () => calls };
}

describe('createTestCatalog onChanged', () => {
  it('fires after create, update and setActive, and not after a read', async () => {
    const { catalog, calls } = await catalogWithSpy();
    const options = await catalog.options();
    const category = options.categories[0]?.code ?? null;
    await catalog.create({ code: 'ZZVL', display: 'Viral load', shortName: null, category, specimenTypes: [], loinc: null } as never);
    expect(calls()).toBe(1);
    await catalog.update('ZZVL', { code: 'ZZVL', display: 'HIV viral load', shortName: null, category, specimenTypes: [], loinc: null } as never);
    await catalog.setActive('ZZVL', false);
    expect(calls()).toBe(3);
    await catalog.list({ q: undefined, status: 'all', limit: 25, offset: 0 } as never);
    expect(calls()).toBe(3);
  });
});
