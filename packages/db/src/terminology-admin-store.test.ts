import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations } from './migrations/internal/index';
import { createTerminologyAdminStore, TerminologyAdminError, type TermMappingInput } from './terminology-admin-store';
import { referenceCapture } from './reference-capture';
import type { InternalSchema } from './schema/internal';

// Same pg-mem migrated-db construction as 012_terminology_admin.test.ts.
// The migration seeds 6 publishers and backfills any existing terminology_concepts rows;
// the test db starts empty of concepts so no coding_systems rows exist at boot.
async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await (migration as { up: (db: Kysely<unknown>) => Promise<void> }).up(db as Kysely<unknown>);
  }
  return db;
}

describe('terminology admin store', () => {
  async function store() {
    const db = await makeMigratedDb();
    return { db, s: createTerminologyAdminStore(db) };
  }

  it('lists the seeded publishers ordered by sort_order', async () => {
    const { s } = await store();
    const pubs = await s.publishers.list();
    expect(pubs[0].name).toBe('System');
    expect(pubs.find((p) => p.name === 'LOINC')?.role).toBe('external');
  });

  it('creates, updates, and deletes a custom publisher', async () => {
    const { s } = await store();
    const p = await s.publishers.create({ name: 'My Lab', role: 'local', icon: '🧪' });
    expect(p.seeded).toBe(false);
    const u = await s.publishers.update(p.id, { name: 'My Lab 2', role: 'external', icon: null });
    expect(u.name).toBe('My Lab 2');
    await s.publishers.delete(p.id);
    expect((await s.publishers.list()).find((x) => x.id === p.id)).toBeUndefined();
  });

  it('refuses to delete a seeded publisher', async () => {
    const { s } = await store();
    const loinc = (await s.publishers.list()).find((p) => p.name === 'LOINC')!;
    await expect(s.publishers.delete(loinc.id)).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('rejects a duplicate code-system url with a conflict', async () => {
    const { s } = await store();
    await s.codingSystems.create({ systemCode: 'A', systemName: 'A', url: 'http://dup.org', active: true, publisherId: null });
    await expect(
      s.codingSystems.create({ systemCode: 'B', systemName: 'B', url: 'http://dup.org', active: true, publisherId: null }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('updates a code system but keeps system_code immutable, and 404s on missing', async () => {
    const { s } = await store();
    const sys = await s.codingSystems.create({ systemCode: 'ORIG', systemName: 'orig', active: true, publisherId: null });
    const u = await s.codingSystems.update(sys.id, { systemCode: 'IGNORED', systemName: 'renamed', url: 'http://u.org', active: false, publisherId: null });
    expect(u.systemCode).toBe('ORIG'); // immutable
    expect(u.systemName).toBe('renamed');
    await expect(s.codingSystems.update('no-such', { systemCode: 'X', systemName: 'X', active: true, publisherId: null })).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('creates a code system and reports deletion impact', async () => {
    const { db, s } = await store();
    const sys = await s.codingSystems.create({ systemCode: 'X', systemName: 'X system', url: 'http://x.org', active: true, publisherId: null });
    await db.insertInto('terminology_concepts').values([
      { system: 'http://x.org', code: 'a', display: 'A', status: null, properties: null },
      { system: 'http://x.org', code: 'b', display: 'B', status: null, properties: null },
    ]).execute();
    const impact = await s.codingSystems.deletionImpact(sys.id);
    expect(impact.termCount).toBe(2);
  });

  it('upserts a coding system by url (idempotent, updates name)', async () => {
    const { s } = await store();
    await s.codingSystems.upsertByUrl({ url: 'http://loinc.org', systemCode: 'LOINC', systemName: 'LOINC v1', publisherId: 'pub-loinc' });
    await s.codingSystems.upsertByUrl({ url: 'http://loinc.org', systemCode: 'LOINC', systemName: 'LOINC v2', publisherId: 'pub-loinc' });
    const rows = (await s.codingSystems.list()).filter((c) => c.url === 'http://loinc.org');
    expect(rows).toHaveLength(1);
    expect(rows[0].systemName).toBe('LOINC v2');
  });

  it('delete(id,{cascade}) removes an upload-created system + its concepts; protects a true seed', async () => {
    const { db, s } = await store();
    // upsertByUrl marks seeded=true (mirrors an uploaded system); give it a concept + an ingest job
    await s.codingSystems.upsertByUrl({ url: 'http://x.test', systemCode: 'X', systemName: 'X', systemVersion: null, publisherId: null });
    const id = (await s.codingSystems.getByUrl('http://x.test'))!.id;
    await db.insertInto('terminology_concepts').values({ system: 'http://x.test', code: 'a', display: 'A', status: 'ACTIVE' } as never).execute();
    await db.insertInto('terminology_ingest_jobs').values({ id: 'j1', system_type: 'loinc', coding_system_id: id, blob_key: 'k/a.zip', version: null, status: 'ready', active_key: null } as never).execute();
    // upload-created (has a job) → cascade delete succeeds and removes concepts
    await s.codingSystems.delete(id, { cascade: true });
    expect(await s.codingSystems.getByUrl('http://x.test')).toBeNull();
    const remaining = await db.selectFrom('terminology_concepts').selectAll().where('system', '=', 'http://x.test').execute();
    expect(remaining).toHaveLength(0);

    // a true seed (seeded, NO ingest job) is protected
    await s.codingSystems.upsertByUrl({ url: 'http://seed.test', systemCode: 'SD', systemName: 'SD', systemVersion: null, publisherId: null });
    const seedId = (await s.codingSystems.getByUrl('http://seed.test'))!.id;
    await expect(s.codingSystems.delete(seedId, { cascade: true })).rejects.toThrow(/system-managed coding system/i);
  });

  describe('codingSystems.getByUrl', () => {
    it('returns the coding system for a known url, null when absent', async () => {
      const { s } = await store();
      expect(await s.codingSystems.getByUrl('http://loinc.org')).toBeNull();
      await s.codingSystems.upsertByUrl({ url: 'http://loinc.org', systemCode: 'LOINC', systemName: 'LOINC', systemVersion: null, publisherId: 'pub-loinc' });
      const cs = await s.codingSystems.getByUrl('http://loinc.org');
      expect(cs?.url).toBe('http://loinc.org');
      expect(cs?.systemCode).toBe('LOINC');
    });
  });

  describe('terms', () => {
    it('creates a term with structured properties and reads them back', async () => {
      const { s } = await store();
      const t = await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: 'Amp', class: 'ABX', unit: null, replacedBy: null, metadata: { rxnorm: '1' } });
      expect(t.shortName).toBe('Amp');
      expect(t.class).toBe('ABX');
      const page = await s.terms.search('http://x', { limit: 10, offset: 0 });
      expect(page.total).toBe(1);
      expect(page.rows[0].metadata).toEqual({ rxnorm: '1' });
      expect(page.rows[0].mappingCount).toBe(0);
    });
    it('updates and deletes a term', async () => {
      const { s } = await store();
      await s.terms.create({ system: 'http://x', code: 'AMP', display: 'A', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      const u = await s.terms.update('http://x', 'AMP', { system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'DRAFT', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      expect(u.display).toBe('Ampicillin');
      expect(u.status).toBe('DRAFT');
      await s.terms.delete('http://x', 'AMP');
      expect((await s.terms.search('http://x', { limit: 10, offset: 0 })).total).toBe(0);
    });
    it('throws not-found on update/delete of a missing term', async () => {
      const { s } = await store();
      await expect(
        s.terms.update('http://x', 'NOPE', { system: 'http://x', code: 'NOPE', display: 'x', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null }),
      ).rejects.toMatchObject({ kind: 'not-found' });
      await expect(s.terms.delete('http://x', 'NOPE')).rejects.toMatchObject({ kind: 'not-found' });
    });
    it('importRows upserts (re-import updates)', async () => {
      const { s } = await store();
      await s.terms.importRows([
        { system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', properties: { class: 'ABX' } },
        { system: 'http://x', code: 'CIP', display: 'Cipro', status: 'ACTIVE', properties: null },
      ]);
      expect((await s.terms.search('http://x', { limit: 10, offset: 0 })).total).toBe(2);
      await s.terms.importRows([{ system: 'http://x', code: 'AMP', display: 'Ampicillin (updated)', status: 'DRAFT', properties: null }]);
      const page = await s.terms.search('http://x', { query: 'amp', limit: 10, offset: 0 });
      expect(page.total).toBe(1);
      expect(page.rows[0].display).toBe('Ampicillin (updated)');
      expect(page.rows[0].status).toBe('DRAFT');
    });
    it('search filters by text and status', async () => {
      const { s } = await store();
      await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      await s.terms.create({ system: 'http://x', code: 'CIP', display: 'Ciprofloxacin', status: 'DRAFT', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      expect((await s.terms.search('http://x', { query: 'cipro', limit: 10, offset: 0 })).rows.map((r) => r.code)).toEqual(['CIP']);
      expect((await s.terms.search('http://x', { statuses: ['ACTIVE'], limit: 10, offset: 0 })).rows.map((r) => r.code)).toEqual(['AMP']);
    });
  });

  describe('termMappings', () => {
    it('creates a mapping, projects into concept_map_elements, and auto-creates a DRAFT target concept', async () => {
      const { db, s } = await store();
      await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://loinc.org', toCode: '101477-8', toDisplay: 'Ampicillin susceptibility', mapType: 'SAME-AS', relationship: null, owner: null, isActive: true });
      expect(res.draftCreated).toBe(true);
      const proj = await db.selectFrom('concept_map_elements').selectAll().where('source_system', '=', 'http://x').where('source_code', '=', 'AMP').execute();
      expect(proj).toHaveLength(1);
      expect(proj[0].target_code).toBe('101477-8');
      expect(proj[0].equivalence).toBe('SAME-AS');
      const draft = await db.selectFrom('terminology_concepts').selectAll().where('system', '=', 'http://loinc.org').where('code', '=', '101477-8').executeTakeFirst();
      expect(draft?.status).toBe('DRAFT');
      expect(await s.termMappings.listOutgoing('http://x', 'AMP')).toHaveLength(1);
      expect(await s.termMappings.listReverse('http://loinc.org', '101477-8')).toHaveLength(1);
    });
    it('does not create a draft when the target concept already exists', async () => {
      const { s } = await store();
      await s.terms.create({ system: 'http://y', code: 'Z', display: 'Zed', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z', toDisplay: 'Zed', mapType: 'RELATED-TO', relationship: null, owner: null, isActive: true });
      expect(res.draftCreated).toBe(false);
    });
    it('delete removes the mapping and its projection', async () => {
      const { db, s } = await store();
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z', toDisplay: null, mapType: 'RELATED-TO', relationship: null, owner: null, isActive: true });
      await s.termMappings.delete(res.mapping.id);
      expect(await db.selectFrom('concept_map_elements').selectAll().where('source_code', '=', 'AMP').execute()).toHaveLength(0);
      expect(await db.selectFrom('term_mappings').selectAll().execute()).toHaveLength(0);
    });
    it('update repoints the projection', async () => {
      const { db, s } = await store();
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z', toDisplay: null, mapType: 'SAME-AS', relationship: null, owner: null, isActive: true });
      await s.termMappings.update(res.mapping.id, { fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z2', toDisplay: 'Z2', mapType: 'NARROWER-THAN', relationship: null, owner: null, isActive: true });
      const proj = await db.selectFrom('concept_map_elements').selectAll().where('source_code', '=', 'AMP').execute();
      expect(proj).toHaveLength(1);
      expect(proj[0].target_code).toBe('Z2');
      expect(proj[0].equivalence).toBe('NARROWER-THAN');
    });
    it('throws not-found on update of a missing mapping', async () => {
      const { s } = await store();
      await expect(
        s.termMappings.update('no-such', { fromSystem: 'http://x', fromCode: 'A', toSystem: 'http://y', toCode: 'B', toDisplay: null, mapType: 'SAME-AS', relationship: null, owner: null, isActive: true }),
      ).rejects.toMatchObject({ kind: 'not-found' });
    });

    // ── facilities-phase-0 Task 11: `saveExclusive` ───────────────────────────────────────────
    //
    // The single-active-mapping writer. Its scope predicate — active AND `to_system` = the input's
    // AND `map_type` = the input's, keyed on `(from_system, from_code)` — is deliberately the same
    // predicate the partial unique index in the NEXT task enforces in the database, so the two
    // agree on what the invariant is rather than each inventing one.
    //
    // ⚠ These tests exercise the store generically (`obs`/`reg` are stand-in system urls). Only
    // ONE caller uses this method today: the terminology mapping routes, and only when the target
    // system is FACILITY_REGISTRY_SYSTEM (apps/server/src/terminology-admin-routes.ts). Nothing
    // here claims the method is facility-specific — the facility scoping lives at that call site.
    const exclusiveInput = (toCode: string, over: Partial<TermMappingInput> = {}): TermMappingInput => ({
      fromSystem: 'obs', fromCode: 'BALAB', toSystem: 'reg', toCode,
      toDisplay: null, mapType: 'SAME-AS', relationship: null, owner: null, isActive: true, ...over,
    });

    it('saveExclusive supersedes the previously active mapping in the same scope', async () => {
      const { db, s } = await store();
      const first = await s.termMappings.saveExclusive(exclusiveInput('L-1'));
      const second = await s.termMappings.saveExclusive(exclusiveInput('L-2'));

      expect(second.superseded).toEqual([first.mapping.id]);
      expect(await db.selectFrom('term_mappings').select(['id', 'to_code', 'is_active']).orderBy('to_code').execute())
        .toEqual([
          { id: first.mapping.id, to_code: 'L-1', is_active: false },
          { id: second.mapping.id, to_code: 'L-2', is_active: true },
        ]);
    });

    // ⛔ A re-save of the SAME target is NOT a conflict and must not be superseded into a second
    // row: two rows naming the same facility resolve identically (see facility-reconcile.ts —
    // ambiguity counts DISTINCT TARGETS, not rows), but they still violate the
    // `(from_system, from_code)` uniqueness the next task's index imposes. So the existing row is
    // reused and rewritten in place: one row, still active, nothing left deactivated behind it.
    it('saveExclusive re-saving the SAME target reuses the row rather than leaving a duplicate', async () => {
      const { db, s } = await store();
      const first = await s.termMappings.saveExclusive(exclusiveInput('L-1'));
      const again = await s.termMappings.saveExclusive(exclusiveInput('L-1', { toDisplay: 'Lab One' }));

      expect(again.mapping.id).toBe(first.mapping.id);
      expect(again.superseded).toEqual([]);
      const rows = await db.selectFrom('term_mappings').select(['id', 'to_code', 'to_display', 'is_active']).execute();
      expect(rows).toEqual([{ id: first.mapping.id, to_code: 'L-1', to_display: 'Lab One', is_active: true }]);
      // The mirror follows too — one element, not one per save.
      expect(await db.selectFrom('concept_map_elements').selectAll().where('source_code', '=', 'BALAB').execute())
        .toHaveLength(1);
    });

    it('saveExclusive supersedes only its OWN (toSystem, mapType) scope', async () => {
      const { db, s } = await store();
      // A different map_type onto the same target system, and a SAME-AS onto a different target
      // system: both are outside the scope this write claims, and neither may be deactivated.
      const otherType = await s.termMappings.create(exclusiveInput('L-9', { mapType: 'RELATED-TO' }));
      const otherSystem = await s.termMappings.create(exclusiveInput('N-9', { toSystem: 'national' }));

      const saved = await s.termMappings.saveExclusive(exclusiveInput('L-1'));

      expect(saved.superseded).toEqual([]);
      // All three stay active: the two out-of-scope rows plus the one this write just created.
      const stillActive = await db.selectFrom('term_mappings').select(['id']).where('is_active', '=', true).execute();
      expect(stillActive.map((r) => r.id).sort())
        .toEqual([otherType.mapping.id, otherSystem.mapping.id, saved.mapping.id].sort());
    });

    // The route's PUT path: the operator edits an EXISTING mapping row. Two competing actives are
    // seeded through the plain `create` writer because that is exactly what a pre-index install can
    // already be holding (and what `reference-apply.ts` can still deliver from central sync).
    it('saveExclusive with an id retargets that row and supersedes the competing active one', async () => {
      const { db, s } = await store();
      const a = await s.termMappings.create(exclusiveInput('L-1'));
      const b = await s.termMappings.create(exclusiveInput('L-2'));

      const saved = await s.termMappings.saveExclusive(exclusiveInput('L-3'), { id: b.mapping.id });

      expect(saved.mapping.id).toBe(b.mapping.id);
      expect(saved.superseded).toEqual([a.mapping.id]);
      expect(await db.selectFrom('term_mappings').select(['id', 'to_code']).where('is_active', '=', true).execute())
        .toEqual([{ id: b.mapping.id, to_code: 'L-3' }]);
    });

    it('saveExclusive throws not-found for an id that does not exist', async () => {
      const { s } = await store();
      await expect(s.termMappings.saveExclusive(exclusiveInput('L-1'), { id: 'no-such' }))
        .rejects.toMatchObject({ kind: 'not-found' });
    });

    // ⛔ An INACTIVE write supersedes nothing: the index the next task adds is scoped to active rows
    // only, so a row being written inactive cannot displace the one active row that satisfies it.
    it('saveExclusive writing an INACTIVE mapping supersedes nothing', async () => {
      const { db, s } = await store();
      const first = await s.termMappings.saveExclusive(exclusiveInput('L-1'));
      const second = await s.termMappings.saveExclusive(exclusiveInput('L-2', { isActive: false }));

      expect(second.superseded).toEqual([]);
      expect(await db.selectFrom('term_mappings').select(['id']).where('is_active', '=', true).execute())
        .toEqual([{ id: first.mapping.id }]);
    });
  });

  describe('valueSets namespace', () => {
    it('saves (insert), expands enumerated concepts, and lists with codeCount', async () => {
      const { s: admin, db } = await store();
      await db.insertInto('terminology_concepts').values([
        { system: 's1', code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null },
        { system: 's1', code: 'B', display: 'Beta', status: 'ACTIVE', properties: null },
      ] as never).execute();

      const saved = await admin.valueSets.save({
        url: 'urn:test:vs', version: null, name: null, title: 'My set', status: 'active',
        experimental: false, description: null, publisherId: 'pub-test',
        compose: { include: [{ system: 's1', concept: [{ code: 'A' }, { code: 'B' }] }] },
      });
      expect(saved.id).toMatch(/^vs-/);

      const list = await admin.valueSets.list('pub-test');
      expect(list).toHaveLength(1);
      expect(list[0]!.codeCount).toBe(2);
      expect(list[0]!.primarySystem).toBe('s1');
    });

    it('updates by url (no duplicate row) and rejects immutable edits', async () => {
      const { s: admin, db } = await store();
      const a = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'v1', status: 'draft', experimental: false, description: null, compose: { include: [] } });
      const b = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'v2', status: 'draft', experimental: false, description: null, compose: { include: [] } });
      expect(b.id).toBe(a.id);
      expect(await admin.valueSets.getByUrl('urn:test:vs')).toMatchObject({ id: a.id });

      await db.updateTable('value_sets').set({ immutable: true }).where('id', '=', a.id).execute();
      await expect(admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'v3', status: 'draft', experimental: false, description: null, compose: { include: [] } }))
        .rejects.toMatchObject({ kind: 'conflict' });
    });

    // Task 4 (S2b) review fix: every @openldr/terminology loader (result-parameters, organisms,
    // whonet, the generic loader) writes `status: null` on imported concepts by design. `termRow`
    // already treats NULL as 'ACTIVE' for display (see the comment there); `vsDeps.listSystemConcepts`
    // and `vsDeps.filterConcepts` used to be the outliers, gating `activeOnly` on `status = 'ACTIVE'`
    // exactly, which silently excluded every loader-fed concept. They now accept NULL too, but a real
    // non-active status (DEPRECATED here) must still be excluded — otherwise there would be no way to
    // retire a concept out of an intensional ValueSet by status.
    it('activeOnly expansion includes NULL-status concepts but still excludes DEPRECATED ones', async () => {
      const { s: admin, db } = await store();
      await db.insertInto('terminology_concepts').values([
        { system: 's1', code: 'A', display: 'Alpha', status: null, properties: JSON.stringify({ result_role: 'result' }) },
        { system: 's1', code: 'B', display: 'Beta', status: 'DEPRECATED', properties: JSON.stringify({ result_role: 'result' }) },
      ] as never).execute();

      // listSystemConcepts path: whole-system include, no concept/filter (mirrors migration 069's
      // 'result-observation' set).
      const wholeSystem = await admin.valueSets.save({
        url: 'urn:test:vs-whole', version: null, name: null, title: 'whole', status: 'active',
        experimental: false, description: null,
        compose: { include: [{ system: 's1' }] },
      });
      const wholeCodes = (await db.selectFrom('valueset_expansions').select('code')
        .where('value_set_id', '=', wholeSystem.id).orderBy('code').execute()).map((c) => c.code);
      expect(wholeCodes).toEqual(['A']);

      // filterConcepts path: property filter (mirrors migration 069's 'reportable-result' set).
      const filtered = await admin.valueSets.save({
        url: 'urn:test:vs-filtered', version: null, name: null, title: 'filtered', status: 'active',
        experimental: false, description: null,
        compose: { include: [{ system: 's1', filter: [{ property: 'result_role', op: '=', value: 'result' }] }] },
      });
      const filteredCodes = (await db.selectFrom('valueset_expansions').select('code')
        .where('value_set_id', '=', filtered.id).orderBy('code').execute()).map((c) => c.code);
      expect(filteredCodes).toEqual(['A']);
    });

    it('duplicates into an editable copy', async () => {
      const { s: admin } = await store();
      const a = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'orig', status: 'active', experimental: false, description: null, compose: { include: [] } });
      const dup = await admin.valueSets.duplicate(a.id);
      expect(dup.id).not.toBe(a.id);
      expect(dup.url).toBe('urn:test:vs-copy');
      expect(dup.immutable).toBe(false);
    });

    it('deletes (cascades the expansion cache)', async () => {
      const { s: admin, db } = await store();
      await db.insertInto('terminology_concepts').values([{ system: 's1', code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null }] as never).execute();
      const a = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 't', status: 'active', experimental: false, description: null, compose: { include: [{ system: 's1', concept: [{ code: 'A' }] }] } });
      await admin.valueSets.delete(a.id);
      await expect(admin.valueSets.get(a.id)).rejects.toMatchObject({ kind: 'not-found' });
      const exp = await db.selectFrom('valueset_expansions').selectAll().where('value_set_id', '=', a.id).execute();
      expect(exp).toHaveLength(0);
    });

    it('throws not-found on get/delete of a missing id', async () => {
      const { s: admin } = await store();
      await expect(admin.valueSets.get('vs-nope')).rejects.toMatchObject({ kind: 'not-found' });
      await expect(admin.valueSets.delete('vs-nope')).rejects.toMatchObject({ kind: 'not-found' });
    });

    it('imports a Corlix compact FHIR ValueSet catalog with cached expansions', async () => {
      const { s: admin, db } = await store();
      const result = await admin.valueSets.importFhirCatalog({
        version: 'R4',
        valueSets: [{
          url: 'http://hl7.org/fhir/ValueSet/administrative-gender',
          version: '4.0.1',
          name: 'AdministrativeGender',
          title: 'AdministrativeGender',
          status: 'active',
          experimental: false,
          description: 'Gender.',
          compose: { include: [{ system: 'http://hl7.org/fhir/administrative-gender' }] },
          expansion: [
            { system: 'http://hl7.org/fhir/administrative-gender', code: 'male', display: 'Male' },
            { system: 'http://hl7.org/fhir/administrative-gender', code: 'female', display: 'Female' },
          ],
          primarySystem: 'http://hl7.org/fhir/administrative-gender',
        }],
        codeSystems: [{
          url: 'http://hl7.org/fhir/administrative-gender',
          name: 'AdministrativeGender',
          title: 'AdministrativeGender',
        }],
      });

      expect(result).toMatchObject({ imported: 1, skipped: 0 });
      const saved = await admin.valueSets.getByUrl('http://hl7.org/fhir/ValueSet/administrative-gender');
      expect(saved).toMatchObject({
        title: 'AdministrativeGender',
        immutable: true,
        category: 'FHIR R4',
        publisherId: 'pub-hl7-fhir',
        codeCount: 2,
        primarySystem: 'http://hl7.org/fhir/administrative-gender',
      });
      const expansions = await db.selectFrom('valueset_expansions').select(['system_url', 'code', 'display']).where('value_set_id', '=', saved!.id).orderBy('code').execute();
      expect(expansions).toEqual([
        { system_url: 'http://hl7.org/fhir/administrative-gender', code: 'female', display: 'Female' },
        { system_url: 'http://hl7.org/fhir/administrative-gender', code: 'male', display: 'Male' },
      ]);
      expect((await admin.codingSystems.list()).find((s) => s.url === 'http://hl7.org/fhir/administrative-gender')).toMatchObject({
        systemName: 'AdministrativeGender',
        active: false,
        publisherId: 'pub-hl7-fhir',
      });

      await expect(admin.valueSets.importFhirCatalog({
        version: 'R4',
        valueSets: [{ url: 'http://hl7.org/fhir/ValueSet/administrative-gender', compose: { include: [] } }],
        codeSystems: [],
      })).resolves.toMatchObject({ imported: 0, skipped: 1 });
    });
  });

  // Distributed sync S3: terminology-metadata writes emit reference_change_log rows when the
  // store is constructed WITH a capture (mirrors the S2 config-store capture pattern).
  describe('reference-change capture', () => {
    async function capturingStore() {
      const db = await makeMigratedDb();
      return { db, s: createTerminologyAdminStore(db, undefined, referenceCapture) };
    }
    const logRows = (db: Kysely<InternalSchema>, entityType: string) =>
      db.selectFrom('reference_change_log').selectAll().where('entity_type', '=', entityType).orderBy('seq').execute();

    it('captures publisher create (upsert), update (upsert), and delete', async () => {
      const { db, s } = await capturingStore();
      const p = await s.publishers.create({ name: 'My Lab', role: 'local', icon: '🧪' });
      let rows = await logRows(db, 'publisher');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entity_id: p.id, op: 'upsert' });
      expect(rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
      const createHash = rows[0].content_hash;

      await s.publishers.update(p.id, { name: 'My Lab 2', role: 'external', icon: null });
      rows = await logRows(db, 'publisher');
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ entity_id: p.id, op: 'upsert' });
      expect(rows[1].content_hash).not.toBe(createHash); // content changed → new hash

      await s.publishers.delete(p.id);
      rows = await logRows(db, 'publisher');
      expect(rows).toHaveLength(3);
      expect(rows[2]).toMatchObject({ entity_id: p.id, op: 'delete', content_hash: null });
    });

    it('is idempotent: re-writing identical publisher content does not append a row', async () => {
      const { db, s } = await capturingStore();
      const p = await s.publishers.create({ name: 'Lab', role: 'local', icon: 'x' });
      await s.publishers.update(p.id, { name: 'Lab', role: 'local', icon: 'x' }); // same content
      expect(await logRows(db, 'publisher')).toHaveLength(1);
    });

    it('captures coding-system create/update/upsertByUrl (upsert) and delete', async () => {
      const { db, s } = await capturingStore();
      const cs = await s.codingSystems.create({ systemCode: 'X', systemName: 'X system', url: 'http://x.org', active: true, publisherId: null });
      let rows = await logRows(db, 'coding_system');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entity_id: cs.id, op: 'upsert' });
      expect(rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
      const createHash = rows[0].content_hash;

      await s.codingSystems.update(cs.id, { systemCode: 'IGNORED', systemName: 'renamed', url: 'http://x2.org', active: false, publisherId: null });
      rows = await logRows(db, 'coding_system');
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ entity_id: cs.id, op: 'upsert' });
      expect(rows[1].content_hash).not.toBe(createHash); // content changed → new hash

      await s.codingSystems.upsertByUrl({ url: 'http://loinc.org', systemCode: 'LOINC', systemName: 'LOINC v1', publisherId: 'pub-loinc' });
      rows = await logRows(db, 'coding_system');
      expect(rows).toHaveLength(3);
      expect(rows[2]).toMatchObject({ op: 'upsert' });
      expect(rows[2].entity_id).toMatch(/^cs-/);

      await s.codingSystems.delete(cs.id);
      rows = await logRows(db, 'coding_system');
      expect(rows).toHaveLength(4);
      expect(rows[3]).toMatchObject({ entity_id: cs.id, op: 'delete', content_hash: null });
    });

    it('captures term-mapping create/update (upsert) and delete', async () => {
      const { db, s } = await capturingStore();
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z', toDisplay: 'Zed', mapType: 'SAME-AS', relationship: null, owner: null, isActive: true });
      let rows = await logRows(db, 'term_mapping');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entity_id: res.mapping.id, op: 'upsert' });
      expect(rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
      const createHash = rows[0].content_hash;

      await s.termMappings.update(res.mapping.id, { fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z2', toDisplay: 'Z2', mapType: 'NARROWER-THAN', relationship: null, owner: null, isActive: true });
      rows = await logRows(db, 'term_mapping');
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ entity_id: res.mapping.id, op: 'upsert' });
      expect(rows[1].content_hash).not.toBe(createHash); // content changed → new hash

      await s.termMappings.delete(res.mapping.id);
      rows = await logRows(db, 'term_mapping');
      expect(rows).toHaveLength(3);
      expect(rows[2]).toMatchObject({ entity_id: res.mapping.id, op: 'delete', content_hash: null });
    });

    // facilities-phase-0 Task 11: the supersede is a real edit to a real row, so it has to reach
    // `reference_change_log` like any other — a deactivation that syncs nowhere would leave a
    // central node still resolving through the mapping this node just retired.
    it('captures BOTH the superseded row and the new one on saveExclusive', async () => {
      const { db, s } = await capturingStore();
      const base: TermMappingInput = {
        fromSystem: 'obs', fromCode: 'BALAB', toSystem: 'reg', toCode: 'L-1',
        toDisplay: null, mapType: 'SAME-AS', relationship: null, owner: null, isActive: true,
      };
      const first = await s.termMappings.saveExclusive(base);
      const second = await s.termMappings.saveExclusive({ ...base, toCode: 'L-2' });

      const rows = await logRows(db, 'term_mapping');
      // create(L-1) … then the supersede of L-1 AND the insert of L-2 — three entries, and the
      // superseded row's own id must be among the last two.
      expect(rows).toHaveLength(3);
      expect(rows.slice(1).map((r) => r.entity_id).sort())
        .toEqual([first.mapping.id, second.mapping.id].sort());
      expect(rows.every((r) => r.op === 'upsert')).toBe(true);
    });

    it('captures term-mapping regardless of owner (not gated on ownership)', async () => {
      const { db, s } = await capturingStore();
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z', toDisplay: 'Zed', mapType: 'SAME-AS', relationship: null, owner: 'some-lab', isActive: true });
      expect(await logRows(db, 'term_mapping')).toHaveLength(1);
      expect((await logRows(db, 'term_mapping'))[0]).toMatchObject({ entity_id: res.mapping.id, op: 'upsert' });
    });

    it('no-capture path: a store built without a capture writes NO reference_change_log rows', async () => {
      const db = await makeMigratedDb();
      const s = createTerminologyAdminStore(db); // no capture
      const p = await s.publishers.create({ name: 'Lab', role: 'local', icon: null });
      await s.publishers.update(p.id, { name: 'Lab2', role: 'local', icon: null });
      await s.codingSystems.create({ systemCode: 'X', systemName: 'X', url: 'http://x.org', active: true, publisherId: null });
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z', toDisplay: null, mapType: 'SAME-AS', relationship: null, owner: null, isActive: true });
      await s.termMappings.delete(res.mapping.id);
      await s.publishers.delete(p.id);
      expect(await db.selectFrom('reference_change_log').selectAll().execute()).toHaveLength(0);
    });
  });
});
