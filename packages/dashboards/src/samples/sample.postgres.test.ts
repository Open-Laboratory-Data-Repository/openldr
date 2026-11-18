import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createRequire } from 'node:module';
import { runBuilderQuery } from '../compile';
import { runSqlQuery } from '../sql-runner';
import { applyTemplate, resolveValues } from '../template';
import { bindQuery } from '../bind';
import { getModel } from '../models/registry';
import { SAMPLE_DASHBOARD } from './index';
import oldBoard from './__fixtures__/openldr-general-sql.json';
import type { ResolvedScope } from '../scope';

// Roles part 3: the sample rebuilt as builder widgets must give unlimited users the numbers its SQL
// tiles gave, on the same warehouse and the same filter values. Run with SAMPLE_TEST_DATABASE_URL
// pointing at a disposable localhost database.
const url = process.env.SAMPLE_TEST_DATABASE_URL;
const pg = createRequire(createRequire(import.meta.url).resolve('@openldr/db'))('pg');
const suite = url ? describe : describe.skip;
const bounds = { timeoutMs: 5000, rowCap: 1000 };

suite('the rebuilt sample dashboard on PostgreSQL', () => {
  let db: Kysely<any>;
  const schema = `sample_${process.pid}`;

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url!).hostname)) throw new Error('Use a localhost disposable database');
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` }) }) });
    await sql.raw(`create schema ${schema}`).execute(db);
    await sql`create table lab_requests (id text primary key, request_id text, patient_id text, panel_desc text, status text, priority text, authored_at text,
      source_system text, requester_system text, requester_code text)`.execute(db);
    await sql`create table lab_results (id text, request_id text, status text, result_timestamp text, abnormal_flag text, numeric_value numeric,
      observation_desc text, patient_id text, specimen_id text)`.execute(db);
    await sql`create table diagnostic_reports (id text, status text, issued text, based_on_id text, source_system text, performer_system text, performer text)`.execute(db);
    await sql`create table specimens (id text, received_time text)`.execute(db);
    await sql`create table facility_map (source_system text, performer_system text, source_code text, registry_id text, region text, district text)`.execute(db);
    await sql`insert into facility_map values ('disa', 'urn:x', 'A', 'reg-a', 'Dodoma', 'Kondoa')`.execute(db);
    // Request ids differ from their business ids, as for every source but DISA, so the results-to-
    // request join is tested. 31 Jan entries carry a time, so the end day is tested.
    await sql`insert into lab_requests values
      ('q1', 'R-1', 'p1', 'HIV', 'final', 'routine', '2024-01-30T08:00:00+03:00', 'disa', 'urn:x', 'A'),
      ('q2', 'R-2', 'p1', 'HIV', 'final', 'stat', '2024-01-31T09:15:00+03:00', 'disa', 'urn:x', 'B'),
      ('q3', 'R-3', 'p2', 'TB', null, 'stat', '2024-01-31T23:59:00+03:00', 'disa', 'urn:x', 'A'),
      ('q4', 'R-4', 'p3', null, 'cancelled', null, '2024-02-01T00:10:00+03:00', 'disa', 'urn:x', 'B'),
      ('q5', 'R-5', 'p4', 'TB', 'active', 'routine', '2024-02-02T10:00:00+03:00', 'disa', 'urn:x', 'A')`.execute(db);
    await sql`insert into lab_results values
      ('o1', 'q1', 'final', '2024-01-30T12:00:00+03:00', 'H', 10.5, 'CD4', 'p1', null),
      ('o2', 'q1', 'cancelled', '2024-01-30T12:00:00+03:00', null, null, 'CD4', 'p1', null),
      ('o3', 'q2', null, '2024-01-31T18:00:00+03:00', 'L', 3.25, 'VL', 'p1', null),
      ('o4', 'q3', 'final', '2024-01-31T20:00:00+03:00', 'N', 7, 'VL', 'p2', null),
      ('o5', 'q5', 'amended', '2024-02-02T11:00:00+03:00', 'AA', 2.333, null, 'p4', null),
      ('o6', null, 'final', '2024-02-02T11:00:00+03:00', 'HH', 1, 'CD4', null, null)`.execute(db);
    await sql`insert into diagnostic_reports values
      ('d1', 'final', '2024-01-30', 'q1', 'disa', 'urn:x', 'L'),
      ('d2', 'amended', '2024-01-31', 'q2', 'disa', 'urn:x', 'L'),
      ('d3', 'preliminary', null, 'q3', 'disa', 'urn:x', 'L')`.execute(db);
    await sql`insert into specimens values ('s1', '2024-01-30')`.execute(db);
  });
  afterAll(async () => {
    if (db) { await sql.raw(`drop schema ${schema} cascade`).execute(db); await db.destroy(); }
  });

  const oldWidget = (id: string) => (oldBoard as { widgets: Array<{ id: string; query: any }> }).widgets.find((w) => w.id === id)!;
  const newWidget = (id: string) => SAMPLE_DASHBOARD.widgets.find((w) => w.id === id)!;
  const runOld = async (id: string, fv: Record<string, unknown>) => {
    const q = bindQuery(oldWidget(id).query, fv) as { sql: string; values?: Record<string, unknown> };
    return runSqlQuery(db, applyTemplate(q.sql, resolveValues(q.values ?? {}), 'postgres'), bounds, 'postgres');
  };
  const runNew = async (id: string, fv: Record<string, unknown>, scope?: ResolvedScope) => {
    const q = bindQuery(newWidget(id).query, fv) as any;
    return runBuilderQuery(db, getModel(q.model)!, q, undefined, bounds, 'postgres', scope);
  };
  // Rows as label -> numbers. A SQL null label is the builder's '(none)'. Numbers compare as numbers.
  const shape = (rows: Array<Record<string, unknown>>, keys: string[]) => Object.fromEntries(
    rows.map((r) => [r.label === null || r.label === undefined ? '(none)' : String(r.label), keys.map((k) => Number(r[k]))]),
  );

  const FILTERS: Array<Record<string, unknown>> = [
    {},
    { period: { from: '2024-01-30', to: '2024-01-31' } },
    { test: 'HIV' },
    { test: 'TB', priority: 'stat' },
    { period: { from: '2024-01-31', to: '2024-02-02' }, test: 'TB' },
  ];
  const REBUILT = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's10', 's11', 's12'];

  it('rebuilds eleven tiles and keeps the funnel and the table as SQL', () => {
    expect(SAMPLE_DASHBOARD.widgets.filter((w) => w.query.mode === 'builder').map((w) => w.id).sort()).toEqual([...REBUILT].sort());
  });

  for (const id of REBUILT) {
    it(`tile ${id} gives the numbers its SQL gave, for every filter set`, async () => {
      const keys = id === 's12' ? ['x', 'y'] : ['value'];
      for (const fv of FILTERS) {
        const before = shape((await runOld(id, fv)).rows, keys);
        const after = shape((await runNew(id, fv)).rows, keys);
        const single = ['s1', 's2', 's3', 's4', 's10'].includes(id);
        if (single) expect(Object.values(after), `${id} ${JSON.stringify(fv)}`).toEqual(Object.values(before));
        else expect(after, `${id} ${JSON.stringify(fv)}`).toEqual(before);
      }
    });
  }

  it('counts only in-scope rows for a limited user', async () => {
    const clinicA: ResolvedScope = { registryIds: ['reg-a'], regions: [], districts: [], registryCodes: [] };
    expect((await runNew('s1', {}, clinicA)).rows[0]!.value).toBe(3); // q1, q3, q5
    expect((await runNew('s3', {}, clinicA)).rows[0]!.value).toBe(3); // o1, o4, o5: not cancelled, through their request
  });
});
