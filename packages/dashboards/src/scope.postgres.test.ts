import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createRequire } from 'node:module';
import { FACILITY_REGISTRY_SYSTEM } from '@openldr/db';
import { runBuilderQuery } from './compile';
import { getModel } from './models/registry';
import type { ResolvedScope } from './scope';

// Roles part 3: what a limited user counts, on real PostgreSQL (pg-mem has no correlated subqueries).
// Run with SCOPE_TEST_DATABASE_URL pointing at a disposable localhost database.
const url = process.env.SCOPE_TEST_DATABASE_URL;
const pg = createRequire(createRequire(import.meta.url).resolve('@openldr/db'))('pg');
const suite = url ? describe : describe.skip;

suite('the data limit on PostgreSQL', () => {
  let db: Kysely<any>;
  const schema = `scope_${process.pid}`;
  const bounds = { timeoutMs: 5000, rowCap: 1000 };

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url!).hostname)) throw new Error('Use a localhost disposable database');
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` }) }) });
    await sql.raw(`create schema ${schema}`).execute(db);
    await sql`create table facility_map (source_system text, performer_system text, source_code text, registry_id text, region text, district text)`.execute(db);
    await sql`create table lab_requests (id text, request_id text, source_system text, requester_system text, requester_code text, status text, priority text, patient_id text)`.execute(db);
    await sql`create table diagnostic_reports (id text, based_on_id text, source_system text, performer_system text, performer text, status text)`.execute(db);
    await sql`create table lab_results (id text, request_id text, observation_desc text, patient_id text)`.execute(db);
    // Clinic A and lab L are in Dodoma/Kondoa; clinic B is in Arusha/Kondoa (same district name);
    // clinic C is in Arusha/Arumeru.
    await sql`insert into facility_map values
      ('disa', 'urn:x', 'A', 'reg-a', 'Dodoma', 'Kondoa'),
      ('disa', 'urn:x', 'L', 'reg-l', 'Dodoma', 'Kondoa'),
      ('disa', 'urn:x', 'B', 'reg-b', 'Arusha', 'Kondoa'),
      ('disa', 'urn:x', 'C', 'reg-c', 'Arusha', 'Arumeru')`.execute(db);
    await sql`insert into lab_requests values
      ('q1', 'r1', 'disa', 'urn:x', 'A', 'final', 'routine', 'p1'),
      ('q2', 'r2', 'disa', 'urn:x', 'C', 'final', 'stat', 'p2'),
      ('q3', 'r3', 'disa', 'urn:x', 'B', 'final', 'routine', 'p3'),
      ('q4', 'r4', 'disa', null, null, 'final', 'routine', 'p4'),
      ('q5', 'r5', 'studio', ${FACILITY_REGISTRY_SYSTEM}, 'FAC-1', 'final', 'routine', 'p5'),
      ('q6', 'r6', 'studio', ${FACILITY_REGISTRY_SYSTEM}, 'reg-dup', 'final', 'routine', 'p6')`.execute(db);
    // q2 (clinic C) is tested at lab L, twice, so a join would count it twice. q3 at clinic B's own lab.
    await sql`insert into diagnostic_reports values
      ('d1', 'q1', 'disa', 'urn:x', 'L', 'final'),
      ('d2a', 'q2', 'disa', 'urn:x', 'L', 'final'),
      ('d2b', 'q2', 'disa', 'urn:x', 'L', 'final'),
      ('d3', 'q3', 'disa', 'urn:x', 'B', 'final'),
      ('d4', 'q4', 'disa', null, null, 'final')`.execute(db);
    await sql`insert into lab_results values ('o1', 'q1', 'HIV', 'p1'), ('o2', 'q2', 'HIV', 'p2'), ('o3', 'q3', 'HIV', 'p3'), ('o4', 'q4', 'HIV', 'p4'), ('o5', null, 'HIV', 'p9')`.execute(db);
  });
  afterAll(async () => {
    if (db) { await sql.raw(`drop schema ${schema} cascade`).execute(db); await db.destroy(); }
  });

  const none: ResolvedScope = { registryIds: [], regions: [], districts: [], registryCodes: [] };
  const count = async (model: string, scope?: ResolvedScope, extra: object = {}) => {
    const r = await runBuilderQuery(db, getModel(model)!, { mode: 'builder', model, metric: { key: 'count', agg: 'count' }, filters: [], ...extra } as never, undefined, bounds, 'postgres', scope);
    return r.rows[0]!.value;
  };

  it('counts everything with no limit', async () => {
    expect(await count('service_requests')).toBe(6);
    expect(await count('diagnostic_reports')).toBe(5);
    expect(await count('observations')).toBe(5);
  });

  it('counts a request whose requester is in scope, and one tested at an in-scope lab, each once', async () => {
    // Dodoma/Kondoa: q1 (clinic A) and q2 (tested at lab L twice). Not q3 (Arusha's Kondoa).
    const dodoma: ResolvedScope = { ...none, districts: [{ region: 'Dodoma', district: 'Kondoa' }] };
    expect(await count('service_requests', dodoma)).toBe(2);
    expect(await count('diagnostic_reports', dodoma)).toBe(3); // d1, d2a, d2b by their lab
    expect(await count('observations', dodoma)).toBe(2); // o1, o2 through their requests
  });

  it('keeps a district name shared by two regions to the stored region', async () => {
    const arushaKondoa: ResolvedScope = { ...none, districts: [{ region: 'Arusha', district: 'Kondoa' }] };
    expect(await count('service_requests', arushaKondoa)).toBe(1); // q3 only
  });

  it('counts a report by its request\'s requester when its lab is out of scope', async () => {
    const clinicC: ResolvedScope = { ...none, registryIds: ['reg-c'] };
    expect(await count('service_requests', clinicC)).toBe(1); // q2
    expect(await count('diagnostic_reports', clinicC)).toBe(2); // d2a, d2b through q2
  });

  it('hides rows with no known facility, and sees nothing with nothing listed', async () => {
    const all: ResolvedScope = { ...none, regions: ['Dodoma', 'Arusha'] };
    expect(await count('service_requests', all)).toBe(3); // q4 has no facility; studio orders need registry codes
    expect(await count('observations', all)).toBe(3); // o4 and o5 hidden
    expect(await count('service_requests', none)).toBe(0);
  });

  it('matches studio-entered orders only by the register code the picker emitted', async () => {
    expect(await count('service_requests', { ...none, registryCodes: ['FAC-1'] })).toBe(1);
    expect(await count('service_requests', { ...none, registryCodes: ['reg-dup'] })).toBe(1);
    expect(await count('service_requests', { ...none, registryCodes: ['FAC-2'] })).toBe(0);
  });

  it('cannot be widened by an OR filter tree', async () => {
    const clinicA: ResolvedScope = { ...none, registryIds: ['reg-a'] };
    const tree = { filterTree: { kind: 'group', combinator: 'or', children: [
      { kind: 'rule', dimension: 'status', op: 'eq', value: 'final' },
      { kind: 'rule', dimension: 'priority', op: 'eq', value: 'stat' },
    ] } };
    expect(await count('service_requests', undefined, tree)).toBe(6);
    expect(await count('service_requests', clinicA, tree)).toBe(1);
  });
});
