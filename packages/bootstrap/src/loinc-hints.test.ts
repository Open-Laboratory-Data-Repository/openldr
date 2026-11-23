import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { makeMigratedDb } from '@openldr/db/testing';
import {
  createFhirStore, createOntologyStore, createTerminologyAdminStore, createTerminologyStore,
  type ValueSetProjection,
} from '@openldr/db';
import { buildOntologyDistribution, createOperations, loadLoinc, LOINC_SYSTEM, RESULT_PARAM_SYSTEM, type LoaderStore } from '@openldr/terminology';
import { codeSystemProjection } from './code-system-projection';
import { createResultFields } from './result-fields';
import { createLoincHints } from './loinc-hints';
import { SPECIMEN_TYPE_VALUE_SET, TestCatalogError } from './test-catalog';
import { RESULT_PARAM_VALUE_SET } from './result-params';

// The LOINC fixture the ontology tests build (packages/terminology), with its LoincTable/Loinc.csv.
const FIXTURE = join(__dirname, '..', '..', 'terminology', 'src', 'ontology', 'adapters', '__fixtures__', 'loinc');
const LOCAL = 'urn:openldr:cs:local';
const SNOMED = 'http://snomed.info/sct';

// The terminology context bootstrap builds (index.ts), over a migrated pg-mem db. Mirrors test-catalog.test.ts.
async function build(opts: { loinc?: boolean; ontology?: boolean; failLinks?: number } = {}) {
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
  const ontology = createOntologyStore(db);
  const loaderStore: LoaderStore = {
    upsertConcepts: (r) => store.upsertConcepts(r),
    upsertMapElements: (r) => store.upsertMapElements(r),
    markSystemChanged: async () => {},
    saveResource: (res) => fhirStore.save(res as never),
    saveSystem: async (url, version, kind, id, meta) => {
      await store.saveSystem(url, version, kind, id);
      if (kind === 'CodeSystem') await admin.codingSystems.upsertByUrl(codeSystemProjection(url, version, meta));
    },
  };
  if (opts.loinc !== false) await loadLoinc(FIXTURE, { acceptLicense: true }, loaderStore);
  if (opts.loinc !== false && opts.ontology !== false) {
    const row = await db.selectFrom('coding_systems').select('id').where('url', '=', LOINC_SYSTEM).executeTakeFirstOrThrow();
    await buildOntologyDistribution(row.id, FIXTURE, ontology, () => {});
  }
  const resultFields = createResultFields({ db, admin });
  // A link that fails the first n times, as a store error part way through a call would.
  let failLinks = opts.failLinks ?? 0;
  const flaky = {
    ownedHere: () => resultFields.ownedHere(),
    link: async (code: string, loinc: string) => {
      if (failLinks > 0) { failLinks -= 1; throw new Error('link store down'); }
      return resultFields.link(code, loinc);
    },
  };
  const hints = createLoincHints({ db, admin, ops, ontology, resultFields: flaky });
  return { db, admin, ops, hints, resultFields };
}

async function counts(db: Awaited<ReturnType<typeof build>>['db']) {
  const fields = await db.selectFrom('terminology_concepts').select('code').where('system', '=', RESULT_PARAM_SYSTEM).execute();
  const sets = await db.selectFrom('value_sets').select('url').where('url', 'like', 'urn:openldr:valueset:loinc-answers:%').execute();
  return { fields: fields.map((f) => f.code).sort(), sets: sets.map((s) => s.url).sort() };
}

describe('loincHints', () => {
  it('answers null when LOINC is not loaded, or LOINC is loaded without its ontology', async () => {
    expect(await (await build({ loinc: false })).hints.hints('2093-3')).toBeNull();
    expect(await (await build({ ontology: false })).hints.hints('2093-3')).toBeNull();
  });

  it('refuses a code that is not shaped like LOINC, and one that is not loaded', async () => {
    const { hints } = await build();
    await expect(hints.hints('abc')).rejects.toMatchObject({ kind: 'invalid' });
    await expect(hints.hints('9999-9')).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('gives a numeric test its name, class, category and example unit', async () => {
    const { hints } = await build();
    expect(await hints.hints('2093-3')).toEqual({
      code: '2093-3',
      display: 'Cholesterol [Mass/volume] in Serum or Plasma',
      class: 'CHEM',
      categorySuggestion: { code: 'CHEM', display: 'Chemistry' },
      unit: 'mg/dL',
      resultType: 'numeric',
      specimens: [],
      answers: [],
      panelMembers: [],
    });
  });

  it('suggests a category only when the test-category value set holds the class', async () => {
    const { hints } = await build();
    const semen = await hints.hints('32789-0');
    expect(semen?.class).toBe('SPEC');
    expect(semen?.categorySuggestion).toBeNull();
    const panel = await hints.hints('24331-1');
    expect(panel?.class).toBe('PANEL.CHEM');
    expect(panel?.categorySuggestion).toBeNull();
  });

  it('gives a coded test LOINC\'s answers in LOINC\'s order, and a panel its members', async () => {
    const { hints } = await build();
    const semen = await hints.hints('32789-0');
    expect(semen?.resultType).toBe('coded');
    expect(semen?.answers).toEqual([{ code: 'LA2', display: 'Clear' }, { code: 'LA1', display: 'Cloudy' }]);
    expect((await hints.hints('24331-1'))?.panelMembers).toEqual([
      { code: '2093-3', display: 'Cholesterol', required: true },
      { code: '2571-8', display: 'Triglyceride', required: false },
    ]);
  });

  it('shows SNOMED specimens as text until the lab maps a specimen type', async () => {
    const { hints } = await build();
    expect((await hints.hints('6429-5'))?.specimens).toEqual([
      { snomed: '119297000', display: null, equivalence: 'equivalent', specimenType: null, tick: false },
      { snomed: '122555007', display: null, equivalence: 'narrower', specimenType: null, tick: false },
    ]);
  });

  it('matches BLD through the local map and ticks it, as the one equivalent match', async () => {
    const { hints, admin } = await build();
    await admin.termMappings.create({ fromSystem: LOCAL, fromCode: 'BLD', toSystem: SNOMED, toCode: '119297000', toDisplay: null, mapType: 'SAME-AS', isActive: true });
    const specimens = (await hints.hints('6429-5'))?.specimens;
    expect(specimens?.[0]).toEqual({
      snomed: '119297000', display: null, equivalence: 'equivalent',
      specimenType: { system: LOCAL, code: 'BLD', display: 'Blood' }, tick: true,
    });
    expect(specimens?.[1]).toMatchObject({ snomed: '122555007', specimenType: null, tick: false });
  });

  it('suggests several matches and ticks none', async () => {
    const { hints, admin } = await build();
    await admin.termMappings.create({ fromSystem: LOCAL, fromCode: 'BLD', toSystem: SNOMED, toCode: '119297000', toDisplay: null, mapType: 'SAME-AS', isActive: true });
    // A specimen type whose own code is the SNOMED code matches too.
    const vs = await admin.valueSets.getByUrl(SPECIMEN_TYPE_VALUE_SET);
    const full = await admin.valueSets.get(vs!.id);
    await admin.valueSets.save({ ...full, compose: { include: [...(full.compose.include ?? []), { system: SNOMED, concept: [{ code: '122555007', display: 'Venous blood' }] }] } });
    const specimens = (await hints.hints('6429-5'))?.specimens ?? [];
    expect(specimens.filter((s) => s.specimenType !== null).map((s) => s.specimenType?.code)).toEqual(['BLD', '122555007']);
    expect(specimens.some((s) => s.tick)).toBe(false);
  });

  it('suggests but does not tick a match through a local map that is only related', async () => {
    const { hints, admin } = await build();
    await admin.termMappings.create({ fromSystem: LOCAL, fromCode: 'BLD', toSystem: SNOMED, toCode: '119297000', toDisplay: null, mapType: 'RELATED-TO', isActive: true });
    const specimens = (await hints.hints('6429-5'))?.specimens ?? [];
    expect(specimens[0]).toMatchObject({ snomed: '119297000', specimenType: { code: 'BLD' }, tick: false });
  });

  it('ticks nothing when the one match is not equivalent', async () => {
    const { hints, admin } = await build();
    await admin.termMappings.create({ fromSystem: LOCAL, fromCode: 'BLD', toSystem: SNOMED, toCode: '122555007', toDisplay: null, mapType: 'SAME-AS', isActive: true });
    const specimens = (await hints.hints('6429-5'))?.specimens ?? [];
    expect(specimens.filter((s) => s.specimenType !== null)).toHaveLength(1);
    expect(specimens.some((s) => s.tick)).toBe(false);
  });
});

describe('resultFieldsFromLoinc', () => {
  it('makes a numeric field with LOINC\'s code, name and unit, linked to LOINC and offered to tests', async () => {
    const { hints, db, ops } = await build();
    const answer = await hints.resultFieldsFromLoinc(['2093-3']);
    expect(answer).toEqual({
      params: [{ system: RESULT_PARAM_SYSTEM, code: '2093-3', resultType: 'numeric', valueSetUrl: null, bands: [] }],
      created: ['2093-3'], reused: [], valueSetsCreated: [],
    });
    const row = await db.selectFrom('terminology_concepts').select(['display', 'properties'])
      .where('system', '=', RESULT_PARAM_SYSTEM).where('code', '=', '2093-3').executeTakeFirstOrThrow();
    const props = typeof row.properties === 'string' ? JSON.parse(row.properties) : row.properties;
    expect([row.display, props]).toEqual(['Cholesterol [Mass/volume] in Serum or Plasma', { result_role: 'result', parm_units: 'mg/dL' }]);
    const link = await db.selectFrom('term_mappings').select('to_code').where('from_system', '=', RESULT_PARAM_SYSTEM)
      .where('from_code', '=', '2093-3').where('is_active', '=', true).executeTakeFirstOrThrow();
    expect(link.to_code).toBe('2093-3');
    const offered = await ops.expand(RESULT_PARAM_VALUE_SET, { count: 100 });
    expect(offered.expansion?.contains?.map((c) => c.code)).toContain('2093-3');
  });

  it('makes a coded field with an answer set of LOINC answer codes under http://loinc.org', async () => {
    const { hints, ops } = await build();
    const answer = await hints.resultFieldsFromLoinc(['32789-0']);
    expect(answer.params).toEqual([{
      system: RESULT_PARAM_SYSTEM, code: '32789-0', resultType: 'coded',
      valueSetUrl: 'urn:openldr:valueset:loinc-answers:32789-0', bands: [],
    }]);
    expect(answer.valueSetsCreated).toEqual(['urn:openldr:valueset:loinc-answers:32789-0']);
    const vs = await ops.expand('urn:openldr:valueset:loinc-answers:32789-0', { count: 100 });
    expect(vs.expansion?.contains).toEqual([
      { system: LOINC_SYSTEM, code: 'LA2', display: 'Clear' },
      { system: LOINC_SYSTEM, code: 'LA1', display: 'Cloudy' },
    ]);
  });

  it('fills from a panel in LOINC\'s order, and a second fill makes nothing new', async () => {
    const { hints, db } = await build();
    const first = await hints.resultFieldsFromLoinc(['24331-1'], { panel: true });
    expect(first.params.map((p) => p.code)).toEqual(['2093-3', '2571-8']);
    expect(first.created).toEqual(['2093-3', '2571-8']);
    const before = await counts(db);
    const second = await hints.resultFieldsFromLoinc(['24331-1'], { panel: true });
    expect(second).toEqual({ params: first.params, created: [], reused: ['2093-3', '2571-8'], valueSetsCreated: [] });
    expect(await counts(db)).toEqual(before);
    expect(before.fields).toEqual(['2093-3', '2571-8']);
  });

  it('makes a coded field\'s answer set once, however often it is asked for', async () => {
    const { hints, db } = await build();
    await hints.resultFieldsFromLoinc(['32789-0']);
    const again = await hints.resultFieldsFromLoinc(['32789-0', '32789-0']);
    expect(again.params).toHaveLength(1);
    expect([again.created, again.reused, again.valueSetsCreated]).toEqual([[], ['32789-0'], []]);
    expect(await counts(db)).toEqual({ fields: ['32789-0'], sets: ['urn:openldr:valueset:loinc-answers:32789-0'] });
  });

  it('uses a field already linked to the LOINC code rather than making one', async () => {
    const { hints, db, resultFields } = await build();
    await db.insertInto('terminology_concepts').values({
      system: RESULT_PARAM_SYSTEM, code: 'CHOL', display: 'Cholesterol', status: 'ACTIVE',
      properties: JSON.stringify({ result_role: 'result', parm_units: 'mmol/L' }) as never,
    }).execute();
    await resultFields.link('CHOL', '2093-3');
    const answer = await hints.resultFieldsFromLoinc(['2093-3']);
    expect([answer.params.map((p) => p.code), answer.created, answer.reused]).toEqual([['CHOL'], [], ['CHOL']]);
    expect((await counts(db)).fields).toEqual(['CHOL']);
  });

  it('refuses without LOINC, a code that is not a panel with --panel, and a central dictionary', async () => {
    await expect((await build({ ontology: false })).hints.resultFieldsFromLoinc(['2093-3'])).rejects.toMatchObject({ kind: 'invalid' });
    const { hints, db } = await build();
    await expect(hints.resultFieldsFromLoinc(['2093-3'], { panel: true })).rejects.toThrow(/not a panel/);
    await expect(hints.resultFieldsFromLoinc([])).rejects.toBeInstanceOf(TestCatalogError);
    await db.insertInto('terminology_systems')
      .values({ url: RESULT_PARAM_SYSTEM, version: null, kind: 'CodeSystem', resource_id: '', managed_origin: 'central' })
      .onConflict((oc) => oc.column('url').doUpdateSet({ managed_origin: 'central' })).execute();
    await expect(hints.resultFieldsFromLoinc(['2093-3'])).rejects.toMatchObject({ kind: 'central-managed' });
    expect((await counts(db)).fields).toEqual([]);
  });

  it('a call that stops before the link is saved is completed by a re-run', async () => {
    const { hints, db } = await build({ failLinks: 1 });
    await expect(hints.resultFieldsFromLoinc(['32789-0'])).rejects.toThrow('link store down');
    // The field was written, its link and answer set were not.
    expect(await counts(db)).toEqual({ fields: ['32789-0'], sets: [] });
    const again = await hints.resultFieldsFromLoinc(['32789-0']);
    expect([again.created, again.reused, again.valueSetsCreated]).toEqual([[], ['32789-0'], ['urn:openldr:valueset:loinc-answers:32789-0']]);
    const link = await db.selectFrom('term_mappings').select('to_code').where('from_system', '=', RESULT_PARAM_SYSTEM)
      .where('from_code', '=', '32789-0').where('is_active', '=', true).executeTakeFirst();
    expect(link?.to_code).toBe('32789-0');
  });

  it('refuses a field of another role, or a retired one, naming it, and writes nothing', async () => {
    const { hints, db } = await build();
    await db.insertInto('terminology_concepts').values([
      { system: RESULT_PARAM_SYSTEM, code: '2093-3', display: 'Cholesterol', status: 'ACTIVE', properties: JSON.stringify({ result_role: 'metadata' }) as never },
      { system: RESULT_PARAM_SYSTEM, code: '2571-8', display: 'Triglyceride', status: 'DEPRECATED', properties: JSON.stringify({ result_role: 'result' }) as never },
    ]).execute();
    await expect(hints.resultFieldsFromLoinc(['2093-3'])).rejects.toThrow('result field 2093-3 stands for LOINC 2093-3 but its role is metadata, not result');
    await expect(hints.resultFieldsFromLoinc(['2571-8'])).rejects.toThrow('result field 2571-8 stands for LOINC 2571-8 but is retired (DEPRECATED)');
    await expect(hints.resultFieldsFromLoinc(['32789-0', '2571-8'])).rejects.toMatchObject({ kind: 'invalid' });
    expect(await counts(db)).toEqual({ fields: ['2093-3', '2571-8'], sets: [] });
    const links = await db.selectFrom('term_mappings').select('from_code').where('from_system', '=', RESULT_PARAM_SYSTEM).execute();
    expect(links).toEqual([]);
  });
});

describe('a result field added by hand', () => {
  it('is offered to the test picker at once', async () => {
    const { resultFields, ops } = await build({ loinc: false });
    await resultFields.create({ display: 'Haemoglobin A1c', units: 'mmol/mol' });
    const offered = await ops.expand(RESULT_PARAM_VALUE_SET, { count: 100 });
    expect(offered.expansion?.contains?.map((c) => c.code)).toContain('HAEMOGLOBIN_A1C');
  });
});
