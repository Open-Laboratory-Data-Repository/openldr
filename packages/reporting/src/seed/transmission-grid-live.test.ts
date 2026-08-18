import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, externalMigrations } from '@openldr/db';
import { SEED_QUERIES } from './report-seeds';

// The transmission grid is SEMANTIC — an attribution path, a civil-timezone day bucket and a
// cross join that must leave gaps in place. The shape tests in report-seeds.test.ts are regexes
// over the SQL text: a query can match every one of them and still put every mark in the wrong
// column, or drop the laboratories the slice exists to show.
//
// Runs only when TARGET_DATABASE_URL points at a live Postgres; the default hermetic `pnpm test`
// skips it. It provisions its OWN throwaway database, so it never touches the shared dev
// warehouse — same pattern as clinical-micro-header-live.test.ts.
//
// pg-mem is not an option here (AGENTS.md §7): no correlated subqueries, and `at time zone` /
// `generate_series` / `string_to_array` are exactly the pieces under test.
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

// March 2026 starts on a Sunday, so its working days are n1 = 2 Mar, n2 = 3 Mar, n3 = 4 Mar, ...
// and it has 22 of them (d23 always blank). February 2026 has exactly 20 (d21..d23 blank).
const EAST = 'Africa/Dar_es_Salaam'; // +03:00 all year, no DST.

live('the transmission grid queries (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_tgrid_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<Record<string, never>>;
  let pool: pg.Pool;

  // ⛔ `substituteParams` inlines an ESCAPED QUOTED STRING LITERAL via a global regex; it does not
  // bind a placeholder (packages/dashboards/src/custom-query-run.ts:37). Mirror that exactly, or
  // this test proves something the runtime never executes. Global, because {{param.tz}} and
  // {{param.month}} each appear several times in one query.
  const runQuery = (queryId: string) => async (p: { month: string; panels: string; tz: string }) => {
    const raw = SEED_QUERIES.find((q) => q.id === queryId)!.sql.postgres;
    const text = raw
      .replace(/\{\{\s*param\.month\s*\}\}/g, `'${p.month.replace(/'/g, "''")}'`)
      .replace(/\{\{\s*param\.panels\s*\}\}/g, `'${p.panels.replace(/'/g, "''")}'`)
      .replace(/\{\{\s*param\.tz\s*\}\}/g, `'${p.tz.replace(/'/g, "''")}'`);
    // `sql.raw` is itself generic; the `sql<T>.raw(...)` shape parses as an instantiation
    // expression followed by a property access, which TS 5.x rejects (TS1477).
    const res = await sql.raw<Record<string, string>>(text).execute(db);
    return res.rows;
  };
  const runFor = runQuery('q-transmission-hvleid');
  const runForOther = runQuery('q-transmission-other');

  // One submission: a batch carrying a ServiceRequest arrival, a lab_request and a
  // diagnostic_report naming the laboratory. Deliberately NO lab_results and NO specimen — that is
  // the shape 548 of 550 real EID requests have, and the shape the specimen route cannot see.
  //
  // The panel codes below are TEST FIXTURE DATA, not product vocabulary: the queries themselves
  // carry no code at all (AGENTS.md §8), the list arrives as {{param.panels}}.
  const seedSubmission = async (
    key: string, labName: string, panelCode: string, recordedAt: string,
  ): Promise<void> => {
    const batchId = `batch-${key}`;
    await db.insertInto('lab_requests' as never).values({
      id: `req-${key}`, request_id: `LAB-${key}`, panel_code: panelCode, batch_id: batchId,
    } as never).execute();
    await db.insertInto('diagnostic_reports' as never).values({
      id: `dr-${key}`, batch_id: batchId, performer: `CODE-${key}`, performer_display: labName,
    } as never).execute();
    await db.insertInto('ingest_events' as never).values({
      resource_type: 'ServiceRequest', resource_id: `req-${key}`, version: 1, recorded_at: recordedAt,
    } as never).execute();
  };

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: target.toString() });
    db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    const up = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    expect(up.error).toBeUndefined();

    // ⛔ THE fixture for this slice: a registration with no results anywhere. 3 Mar 2026 = n2 = d02.
    await seedSubmission('regonly', 'Registration Only Lab', 'HIVPC', '2026-03-03T08:00:00Z');

    // 3 Mar 21:00Z is 4 Mar 00:00 at +03 — a whole evening that lands on the NEXT working day.
    await seedSubmission('evening', 'Late Evening Lab', 'HIVPC', '2026-03-03T21:00:00Z');

    // A non-HVL/EID panel, so the two grids can be shown to partition the month.
    await seedSubmission('chem', 'Chemistry Lab', 'CHEM', '2026-03-03T08:00:00Z');

    // C2: submitted ONLY outside March. Must not appear in a March grid AT ALL — not even blank.
    // ⛔ The dates are chosen to sit INSIDE the two-day widening on each side (27 Feb is 2 days
    // before 1 March, 1 April is 1 day after 31 March). A fixture further out would be excluded by
    // the sargable bound alone and this test would pass with the exact month bound deleted —
    // verified by mutation, see the task report.
    await seedSubmission('feblab', 'February Only Lab', 'HIVPC', '2026-02-27T08:00:00Z');
    await seedSubmission('aprlab', 'April Only Lab', 'HIVPC', '2026-04-01T08:00:00Z');

    // The laboratory NAME comes from facility_map when it resolves — the left join folds a NULL
    // source_system/performer_system to '' on the report side, so the map row must carry ''.
    await db.insertInto('facility_map' as never).values({
      id: '|CODE-mapped', source_system: '', performer_system: '', source_code: 'CODE-mapped',
      name: 'Mapped Registry Lab',
    } as never).execute();
    await seedSubmission('mapped', 'Wire Name Nobody Wants', 'HIVPC', '2026-03-02T08:00:00Z');

    // The 15x fan-out C1's `distinct` collapses: one batch, several diagnostic_reports rows, one
    // performer. Without `distinct` the grid still reads right (max() folds duplicates) — this
    // fixture is here so a future edit that changes the FOLD is caught, not just the row count.
    for (let i = 2; i <= 4; i++) {
      await db.insertInto('diagnostic_reports' as never).values({
        id: `dr-regonly-${i}`, batch_id: 'batch-regonly',
        performer: 'CODE-regonly', performer_display: 'Registration Only Lab',
      } as never).execute();
    }
  });

  afterAll(async () => {
    await db?.destroy();
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.end();
  });

  it('⛔ fills a cell for a laboratory that submitted ONLY a registration — no results anywhere', async () => {
    // THE test for this slice. 548 of 550 EID requests in the real warehouse have no lab_results.
    // Attributing through the specimen would leave this cell empty and the EID grid nearly blank.
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: EAST });
    const lab = rows.find((r) => r.lab === 'Registration Only Lab');
    expect(lab, 'a registration-only submission must still register').toBeDefined();
    expect(lab!.d02).not.toBe('');
  });

  it('buckets an arrival at 21:00Z into the NEXT day at +03', async () => {
    // The whole reason lab.timezone exists. Assert BOTH sides or this proves nothing.
    const east = await runFor({ month: '2026-03', panels: 'HIVPC', tz: EAST });
    const utc = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const e = east.find((r) => r.lab === 'Late Evening Lab')!;
    const u = utc.find((r) => r.lab === 'Late Evening Lab')!;
    expect(e.d03).not.toBe('');   // 3 March 21:00Z is 4 March 00:00 at +03, and 4 March is n3
    expect(u.d02).not.toBe('');   // ...and still 3 March in UTC, which is n2
    expect(e.d02).toBe('');
  });

  it('leaves trailing columns blank in a short month rather than shifting cells left', async () => {
    // February 2026 has 20 working days. d21..d23 must be empty and d01 must still be the 2nd.
    const rows = await runFor({ month: '2026-02', panels: 'HIVPC', tz: 'UTC' });
    const dates = rows.find((r) => r.lab === '(dates)')!;
    expect(dates.d21).toBe('');
    expect(dates.d22).toBe('');
    expect(dates.d23).toBe('');
    expect(dates.d01).toBe('2 Feb');
  });

  it('puts the date row first, whatever the laboratory names sort like', async () => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    expect(rows[0].lab).toBe('(dates)');
  });

  it('HVL/EID and Other partition the arrivals — none in both, none in neither', async () => {
    const hv = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const ot = await runForOther({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    // The registration-only lab submitted HIVPC only, so it appears in one grid and not the other.
    expect(hv.some((r) => r.lab === 'Registration Only Lab')).toBe(true);
    expect(ot.some((r) => r.lab === 'Registration Only Lab')).toBe(false);
    // ...and the chemistry lab is the mirror image, so neither grid is simply empty.
    expect(ot.some((r) => r.lab === 'Chemistry Lab')).toBe(true);
    expect(hv.some((r) => r.lab === 'Chemistry Lab')).toBe(false);
  });

  it('⛔ omits a laboratory that submitted only OUTSIDE the month — no blank row', async () => {
    // C2. Without a month bound inside `arrivals`, `labs` is "every laboratory that ever
    // submitted" and February Only Lab draws an all-blank row across the March grid, reading as
    // "transmitted nothing in March" when the truth is "was not in scope in March".
    const march = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    expect(march.some((r) => r.lab === 'February Only Lab')).toBe(false);
    expect(march.some((r) => r.lab === 'April Only Lab')).toBe(false);
    // ...and each IS there in its own month, so the assertions above are not passing by accident.
    const feb = await runFor({ month: '2026-02', panels: 'HIVPC', tz: 'UTC' });
    expect(feb.some((r) => r.lab === 'February Only Lab')).toBe(true);
    const apr = await runFor({ month: '2026-04', panels: 'HIVPC', tz: 'UTC' });
    expect(apr.some((r) => r.lab === 'April Only Lab')).toBe(true);
  });

  it('names the laboratory from facility_map when it resolves, not from the wire', async () => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    expect(rows.some((r) => r.lab === 'Mapped Registry Lab')).toBe(true);
    expect(rows.some((r) => r.lab === 'Wire Name Nobody Wants')).toBe(false);
  });

  it('marks one cell per laboratory-day however many reports the batch carries', async () => {
    // C1: the batch join fans out (up to 15x on real data). One batch = one performer, so the
    // fan-out must not leak into the grid as anything other than a single Y.
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const lab = rows.find((r) => r.lab === 'Registration Only Lab')!;
    expect(lab.d02).toBe('Y');
    expect(lab.d01).toBe('');
  });

  it('renders 23 day columns and no more, for every row', async () => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const keys = Object.keys(rows[0]).filter((k) => /^d\d\d$/.test(k));
    expect(keys).toHaveLength(23);
    expect(keys).toContain('d23');
    expect(keys).not.toContain('d24');
  });

  it('returns an EMPTY HVL/EID grid and a FULL Other grid when the panel list is empty', async () => {
    // Deliberate, and stated in the query comment: an unconfigured panel list must not silently
    // report every test as HVL/EID.
    const hv = await runFor({ month: '2026-03', panels: '', tz: 'UTC' });
    const ot = await runForOther({ month: '2026-03', panels: '', tz: 'UTC' });
    expect(hv.filter((r) => r.lab !== '(dates)')).toHaveLength(0);
    expect(ot.some((r) => r.lab === 'Registration Only Lab')).toBe(true);
    expect(ot.some((r) => r.lab === 'Chemistry Lab')).toBe(true);
  });
});
