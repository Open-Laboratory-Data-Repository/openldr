import { describe, it, expect } from 'vitest';
import { PATIENT_IDENTIFIER_SYSTEM, PatientIndexError, parseSystemInput, parseSystemListQuery } from './patient-identifier-systems';
import { buildPatientIndexFixture, seedIdentifier, seedPatient } from './test-support/patient-index-fixture';

const MPI = 'urn:zm:mpi';
const NRC = 'urn:zm:nrc';

describe('patient identifier systems', () => {
  it('lists every system seen, with its patient count and the source type text as label', async () => {
    const { externalDb, systems } = await buildPatientIndexFixture();
    await seedPatient(externalDb, { id: 'p1' });
    await seedPatient(externalDb, { id: 'p2' });
    await seedIdentifier(externalDb, 'p1', MPI, 'M1', 'MPI number');
    await seedIdentifier(externalDb, 'p2', MPI, 'M2', 'MPI number');
    await seedIdentifier(externalDb, 'p1', NRC, 'N1');
    await seedIdentifier(externalDb, 'p2', null, 'F-9');

    const out = await systems.list({ limit: 25, offset: 0 });

    expect(out.ownedHere).toBe(true);
    expect(out.total).toBe(3);
    expect(out.rows).toEqual([
      { system: null, label: null, labelSource: 'none', patientCount: 1, listColumn: false, searchable: true },
      { system: MPI, label: 'MPI number', labelSource: 'source', patientCount: 2, listColumn: false, searchable: true },
      { system: NRC, label: null, labelSource: 'none', patientCount: 1, listColumn: false, searchable: true },
    ]);
  });

  it('saves an operator label and both flags, and the operator label wins over the source text', async () => {
    const { externalDb, internalDb, systems } = await buildPatientIndexFixture();
    await seedPatient(externalDb, { id: 'p1' });
    await seedIdentifier(externalDb, 'p1', MPI, 'M1', 'MPI number');

    const saved = await systems.set({ system: MPI, label: 'MPI', listColumn: true, searchable: false });

    expect(saved).toEqual({ system: MPI, label: 'MPI', labelSource: 'operator', patientCount: 1, listColumn: true, searchable: false });
    const concept = await internalDb.selectFrom('terminology_concepts').select(['code', 'display', 'properties'])
      .where('system', '=', PATIENT_IDENTIFIER_SYSTEM).executeTakeFirstOrThrow();
    expect(concept.code).toBe(MPI);
    expect(concept.display).toBe('MPI');
    const props = typeof concept.properties === 'string' ? JSON.parse(concept.properties) : concept.properties;
    expect(props).toEqual({ listColumn: true, searchable: false });
    expect((await systems.settings()).get(MPI)).toEqual({ label: 'MPI', labelSource: 'operator', listColumn: true, searchable: false });
  });

  it('keeps property keys it does not manage', async () => {
    const { internalDb, systems } = await buildPatientIndexFixture();
    await systems.set({ system: MPI, label: 'MPI', listColumn: false, searchable: true });
    await internalDb.updateTable('terminology_concepts')
      .set({ properties: JSON.stringify({ listColumn: false, searchable: true, note: 'keep me' }) as never })
      .where('system', '=', PATIENT_IDENTIFIER_SYSTEM).execute();
    await systems.set({ system: MPI, label: 'MPI 2', listColumn: true, searchable: true });
    const concept = await internalDb.selectFrom('terminology_concepts').select('properties')
      .where('system', '=', PATIENT_IDENTIFIER_SYSTEM).executeTakeFirstOrThrow();
    const props = typeof concept.properties === 'string' ? JSON.parse(concept.properties) : concept.properties;
    expect(props).toEqual({ listColumn: true, searchable: true, note: 'keep me' });
  });

  it('clears the operator label with null and falls back to the source text', async () => {
    const { externalDb, systems } = await buildPatientIndexFixture();
    await seedPatient(externalDb, { id: 'p1' });
    await seedIdentifier(externalDb, 'p1', MPI, 'M1', 'MPI number');
    await systems.set({ system: MPI, label: 'MPI', listColumn: false, searchable: true });
    const cleared = await systems.set({ system: MPI, label: null, listColumn: false, searchable: true });
    expect([cleared.label, cleared.labelSource]).toEqual(['MPI number', 'source']);
  });

  it('refuses an edit when central owns the label system', async () => {
    const { internalDb, systems } = await buildPatientIndexFixture();
    await internalDb.insertInto('terminology_systems').values({
      url: PATIENT_IDENTIFIER_SYSTEM, version: null, kind: 'CodeSystem', resource_id: '', generation: 1, managed_origin: 'central',
    } as never).execute();
    expect(await systems.ownedHere()).toBe(false);
    await expect(systems.set({ system: MPI, label: 'MPI', listColumn: false, searchable: true }))
      .rejects.toMatchObject({ kind: 'central-managed' });
    expect((await systems.list({ limit: 25, offset: 0 })).ownedHere).toBe(false);
  });

  it('pages with a stable order', async () => {
    const { externalDb, systems } = await buildPatientIndexFixture();
    await seedPatient(externalDb, { id: 'p1' });
    for (const s of ['urn:c', 'urn:a', 'urn:b']) await seedIdentifier(externalDb, 'p1', s, 'v');
    const page = await systems.list({ limit: 2, offset: 1 });
    expect([page.total, page.rows.map((r) => r.system)]).toEqual([3, ['urn:b', 'urn:c']]);
  });
});

describe('patient identifier system parsers', () => {
  it('parses the list query with defaults and bounds', () => {
    expect(parseSystemListQuery({})).toEqual({ ok: true, query: { limit: 25, offset: 0 } });
    expect(parseSystemListQuery({ limit: '0' })).toEqual({ ok: false, error: 'limit must be a whole number from 1 to 200' });
    expect(parseSystemListQuery({ offset: '-1' })).toEqual({ ok: false, error: 'offset must be a whole number from 0' });
  });

  it('parses the input, trims the label and turns an empty label into null', () => {
    expect(parseSystemInput({ system: ' urn:zm:mpi ', label: '  ', listColumn: true, searchable: false }))
      .toEqual({ ok: true, input: { system: 'urn:zm:mpi', label: null, listColumn: true, searchable: false } });
    expect(parseSystemInput({ system: '', label: 'x', listColumn: true, searchable: true }))
      .toEqual({ ok: false, error: 'system is required' });
    expect(parseSystemInput({ system: 'urn:x', label: 'x', listColumn: 'yes', searchable: true }))
      .toEqual({ ok: false, error: 'listColumn and searchable must be true or false' });
  });

  it('PatientIndexError carries its kind', () => {
    expect(new PatientIndexError('no', 'not-found').kind).toBe('not-found');
  });
});
