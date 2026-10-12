import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  DummyDriver, Kysely, MssqlAdapter, MssqlIntrospector, MssqlQueryCompiler, MysqlAdapter, MysqlIntrospector,
  MysqlQueryCompiler,
} from 'kysely';
import { createPatientIndex, neutralOrder, parsePageQuery, parsePatientListQuery } from './patient-index';
import { buildPatientIndexFixture, seedIdentifier, seedPatient, seedRequest, seedResult } from './test-support/patient-index-fixture';

const MPI = 'urn:zm:mpi';
const NRC = 'urn:zm:nrc';
const NOW = () => new Date('2026-10-12T00:00:00Z');
const Q = { q: '', status: 'active' as const, limit: 25, offset: 0 };

async function build() {
  const f = await buildPatientIndexFixture();
  const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', now: NOW, refKey: randomBytes(32) });
  await seedPatient(f.externalDb, { id: 'hl7-111', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05', sex: 'M', guid: 'G-111', phone: '0977', email: 'j@x', org: 'Organization/fac-1' });
  await seedPatient(f.externalDb, { id: 'hl7-222', surname: 'Banda', firstname: 'Ruth', dob: '1985', sex: 'F', guid: 'G-222' });
  await seedPatient(f.externalDb, { id: 'hl7-333', surname: 'Phiri', firstname: 'Old', active: false, replacedBy: 'hl7-111' });
  await seedIdentifier(f.externalDb, 'hl7-111', MPI, 'MPI-0001', 'MPI number');
  await seedIdentifier(f.externalDb, 'hl7-111', NRC, '123456/10/1');
  await seedIdentifier(f.externalDb, 'hl7-222', MPI, 'MPI-0002', 'MPI number');
  await f.externalDb.insertInto('facilities').values({ id: 'fac-1', facility_name: 'Chilenje Clinic' } as never).execute();
  await f.systems.set({ system: MPI, label: 'MPI', listColumn: true, searchable: true });
  return { ...f, index };
}

describe('patient index: list', () => {
  it('lists active patients unmasked, by name, with listed identifiers, facility and request stats', async () => {
    const { externalDb, index } = await build();
    await seedRequest(externalDb, { id: 'r1', patientId: 'hl7-111', authoredAt: '2026-01-02' });
    await seedRequest(externalDb, { id: 'r2', patientId: 'hl7-111', authoredAt: '2026-03-04' });

    const out = await index.list(Q, { unmask: true });

    expect(out.masked).toBe(false);
    expect(out.total).toBe(2);
    expect(out.rows.map((r) => r.id)).toEqual(['hl7-222', 'hl7-111']);
    const john = out.rows[1];
    expect(john).toMatchObject({
      name: 'John Mwanza', sex: 'M', birthDate: '1990-01-05', ageYears: 36,
      identifiers: [{ system: MPI, label: 'MPI', value: 'MPI-0001' }],
      managingFacility: { reference: 'Organization/fac-1', name: 'Chilenje Clinic' },
      active: true, replacedByRef: null, lastRequestAt: '2026-03-04', requestCount: 2,
    });
    expect(typeof john.ref).toBe('string');
  });

  it('masks names, identifiers, birth date and the id', async () => {
    const { index } = await build();
    const out = await index.list(Q, { unmask: false });
    expect(out.masked).toBe(true);
    const john = out.rows.find((r) => r.name === 'J*** M***')!;
    expect(john).toMatchObject({ id: null, birthDate: '1990', ageYears: 36, identifiers: [{ system: MPI, label: 'MPI', value: '•••0001' }] });
    expect(JSON.stringify(out)).not.toMatch(/hl7-|Mwanza|MPI-0001|G-111|1990-01-05/);
  });

  it('finds a patient by any searchable identifier, exactly, masked or not', async () => {
    const { index } = await build();
    for (const unmask of [true, false]) {
      const out = await index.list({ ...Q, q: '123456/10/1' }, { unmask });
      expect(out.rows).toHaveLength(1);
      expect(out.rows[0].ageYears).toBe(36);
    }
    expect((await index.list({ ...Q, q: 'G-222' }, { unmask: false })).total).toBe(1);
  });

  it('gives a masked user nothing for a partial name or partial identifier', async () => {
    const { index } = await build();
    expect((await index.list({ ...Q, q: 'Mwan' }, { unmask: false })).rows).toEqual([]);
    expect((await index.list({ ...Q, q: 'MPI-000' }, { unmask: false })).rows).toEqual([]);
  });

  it('lets an unmasked user search part of a name or patient_guid, case-insensitively', async () => {
    const { index } = await build();
    expect((await index.list({ ...Q, q: 'mwan' }, { unmask: true })).rows.map((r) => r.id)).toEqual(['hl7-111']);
    expect((await index.list({ ...Q, q: 'g-2' }, { unmask: true })).rows.map((r) => r.id)).toEqual(['hl7-222']);
  });

  it('does not match a system marked not searchable', async () => {
    const { systems, index } = await build();
    await systems.set({ system: NRC, label: 'NRC', listColumn: false, searchable: false });
    expect((await index.list({ ...Q, q: '123456/10/1' }, { unmask: true })).rows).toEqual([]);
  });

  it('filters merged and all', async () => {
    const { index } = await build();
    const merged = await index.list({ ...Q, status: 'merged' }, { unmask: true });
    expect(merged.rows.map((r) => r.id)).toEqual(['hl7-333']);
    expect(merged.rows[0].replacedByRef).not.toBeNull();
    expect((await index.list({ ...Q, status: 'all' }, { unmask: true })).total).toBe(3);
  });

  it('pages with a unique tiebreak when names repeat', async () => {
    const { externalDb, index } = await build();
    await seedPatient(externalDb, { id: 'dup-b', surname: 'Same', firstname: 'Name' });
    await seedPatient(externalDb, { id: 'dup-a', surname: 'Same', firstname: 'Name' });
    const ids = (await index.list({ ...Q, q: 'same', limit: 1, offset: 0 }, { unmask: true })).rows.map((r) => r.id);
    const next = (await index.list({ ...Q, q: 'same', limit: 1, offset: 1 }, { unmask: true })).rows.map((r) => r.id);
    expect([...ids, ...next]).toEqual(['dup-a', 'dup-b']);
  });
});

describe('patient index: masked order', () => {
  // A patient id can carry PID-3 (`hl7-{id}`). Ordering a masked list by id would put rows in the
  // order of the full identifier next to their last four characters, so it orders by md5(id).
  it('orders a masked list by md5 of the id, the same way every time', async () => {
    const f = await buildPatientIndexFixture();
    const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', now: NOW, refKey: randomBytes(32) });
    // md5: hl7-001 4612..., hl7-003 5522..., hl7-002 6096..., hl7-004 d2f6...
    for (const [id, first] of [['hl7-001', 'Ada'], ['hl7-002', 'Bea'], ['hl7-003', 'Cid'], ['hl7-004', 'Dan']]) {
      await seedPatient(f.externalDb, { id, firstname: first, surname: 'Zed' });
    }
    const names = async () => (await index.list(Q, { unmask: false })).rows.map((r) => r.name);
    expect(await names()).toEqual(['A*** Z***', 'C*** Z***', 'B*** Z***', 'D*** Z***']);
    expect(await names()).toEqual(await names());
    const page2 = (await index.list({ ...Q, limit: 2, offset: 2 }, { unmask: false })).rows.map((r) => r.name);
    expect(page2).toEqual(['B*** Z***', 'D*** Z***']);
  });

  it('keeps the unmasked order by name', async () => {
    const f = await buildPatientIndexFixture();
    const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', now: NOW, refKey: randomBytes(32) });
    for (const [id, first] of [['hl7-001', 'Ada'], ['hl7-002', 'Bea'], ['hl7-003', 'Cid']]) {
      await seedPatient(f.externalDb, { id, firstname: first, surname: 'Zed' });
    }
    expect((await index.list(Q, { unmask: true })).rows.map((r) => r.id)).toEqual(['hl7-001', 'hl7-002', 'hl7-003']);
  });

  // Offline against Kysely's real compilers, as the external migration tests do. Neither proves a real
  // MySQL or SQL Server accepts it.
  it('compiles the hash for MySQL and SQL Server', () => {
    const compile = (engine: 'mysql' | 'mssql') => {
      const mssql = engine === 'mssql';
      const db = new Kysely<{ patients: { id: string } }>({
        dialect: {
          createAdapter: () => (mssql ? new MssqlAdapter() : new MysqlAdapter()),
          createDriver: () => new DummyDriver(),
          createIntrospector: (k) => (mssql ? new MssqlIntrospector(k) : new MysqlIntrospector(k)),
          createQueryCompiler: () => (mssql ? new MssqlQueryCompiler() : new MysqlQueryCompiler()),
        },
      });
      return db.selectFrom('patients').select('id').orderBy(neutralOrder(engine)).compile().sql;
    };
    expect(compile('mysql')).toBe('select `id` from `patients` order by md5(`id`)');
    expect(compile('mssql')).toBe(`select "id" from "patients" order by convert(varchar(32), hashbytes('MD5', "id"), 2)`);
  });
});

describe('patient index: detail and requests', () => {
  it('returns every identifier, guid, phone and email unmasked', async () => {
    const { index } = await build();
    const ref = (await index.list({ ...Q, q: 'MPI-0001' }, { unmask: true })).rows[0].ref;
    const d = await index.get(ref, { unmask: true });
    expect(d).toMatchObject({ id: 'hl7-111', patientGuid: 'G-111', phone: '0977', email: 'j@x', masked: false });
    expect(d.identifiers).toEqual([
      { system: MPI, label: 'MPI', value: 'MPI-0001' },
      { system: NRC, label: null, value: '123456/10/1' },
    ]);
  });

  it('masks the detail and leaves out phone and email', async () => {
    const { index } = await build();
    const ref = (await index.list({ ...Q, q: 'MPI-0001' }, { unmask: false })).rows[0].ref;
    const d = await index.get(ref, { unmask: false });
    expect(d).toMatchObject({ id: null, patientGuid: '•••-111', phone: null, email: null, masked: true, name: 'J*** M***' });
    expect(d.identifiers.map((i) => i.value)).toEqual(['•••0001', '•••10/1']);
  });

  it('refuses a bad or foreign ref as not found', async () => {
    const { index, externalDb, systems } = await build();
    await expect(index.get('nope', { unmask: true })).rejects.toMatchObject({ kind: 'not-found' });
    const other = createPatientIndex({ externalDb, systems, engine: 'postgres', now: NOW, refKey: randomBytes(32) });
    const foreign = (await other.list(Q, { unmask: true })).rows[0].ref;
    await expect(index.get(foreign, { unmask: true })).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('lists requests newest first, nulls last, with result counts that skip cancelled results', async () => {
    const { externalDb, index } = await build();
    await seedRequest(externalDb, { id: 'r-null', patientId: 'hl7-111', authoredAt: null, panel: 'CD4' });
    await seedRequest(externalDb, { id: 'r-old', patientId: 'hl7-111', authoredAt: '2026-01-02', panel: 'VL', requester: 'Chilenje', status: 'completed' });
    await seedRequest(externalDb, { id: 'r-new', patientId: 'hl7-111', authoredAt: '2026-03-04', panel: 'EID' });
    await seedResult(externalDb, 'o1', 'r-old');
    await seedResult(externalDb, 'o2', 'r-old');
    await seedResult(externalDb, 'o3', 'r-old', 'cancelled');
    const ref = (await index.list({ ...Q, q: 'MPI-0001' }, { unmask: true })).rows[0].ref;

    const out = await index.requests(ref, { limit: 25, offset: 0 });

    expect(out.total).toBe(3);
    expect(out.rows).toEqual([
      { authoredAt: '2026-03-04', panel: 'EID', requester: null, status: null, resultCount: 0 },
      { authoredAt: '2026-01-02', panel: 'VL', requester: 'Chilenje', status: 'completed', resultCount: 2 },
      { authoredAt: null, panel: 'CD4', requester: null, status: null, resultCount: 0 },
    ]);
  });
});

describe('patient index parsers', () => {
  it('parses the list query', () => {
    expect(parsePatientListQuery({})).toEqual({ ok: true, query: { q: '', status: 'active', limit: 25, offset: 0 } });
    expect(parsePatientListQuery({ search: ' x ', status: 'merged', limit: '10', offset: '20' }))
      .toEqual({ ok: true, query: { q: 'x', status: 'merged', limit: 10, offset: 20 } });
    expect(parsePatientListQuery({ status: 'gone' })).toEqual({ ok: false, error: 'status must be active, merged or all' });
    expect(parsePageQuery({ limit: '500' })).toEqual({ ok: false, error: 'limit must be a whole number from 1 to 200' });
  });
});
