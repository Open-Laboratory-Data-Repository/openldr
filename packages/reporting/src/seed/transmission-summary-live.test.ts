import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, externalMigrations } from '@openldr/db';
import { SEED_QUERIES } from './report-seeds';

/**
 * The summary band's two queries, driven through a real Postgres.
 *
 * The shape tests in `report-seeds.test.ts` are regexes over SQL text. A query can match every one
 * of them and still count the wrong days, drop the weekend, or disagree with the calendar printed
 * beside it. These run the SQL.
 *
 * Runs only when TARGET_DATABASE_URL points at a live Postgres. It provisions its OWN throwaway
 * database and drops it afterwards, so it never touches the shared dev warehouse.
 *
 * ⛔ pg-mem cannot stand in (AGENTS.md §7). Correlated subqueries, `generate_series`, `distinct on`
 * ordering and `to_char(..., 'IW')` are the pieces under test.
 */
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

// July 2013 starts on a Monday. Working days n1 = 1 Jul, n2 = 2 Jul, ... 23 of them.
// 6 July is a Saturday, which is what makes the calendar and the figures disagree on purpose.
const MONTH = '2013-07';

live('the summary band queries (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_band_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<Record<string, never>>;
  let pool: pg.Pool;

  // ⛔ Mirrors `substituteParams` (packages/dashboards/src/custom-query-run.ts:24): a GLOBAL regex
  // inlining an ESCAPED QUOTED STRING LITERAL, never a bound placeholder. Binding here would test a
  // path no run takes.
  const runQuery = (queryId: string) => async (month: string) => {
    const raw = SEED_QUERIES.find((q) => q.id === queryId)!.sql.postgres;
    const text = raw.replace(/\{\{\s*param\.month\s*\}\}/g, `'${month.replace(/'/g, "''")}'`);
    // `sql.raw` is itself generic; the `sql<T>.raw(...)` shape parses as an instantiation
    // expression followed by a property access, which TS 5.x rejects (TS1477).
    const res = await sql.raw<Record<string, string>>(text).execute(db);
    return res.rows;
  };
  const calendar = runQuery('q-transmission-calendar');
  const summary = runQuery('q-transmission-summary');

  /** One submission: a request carrying its clinical date, and a report naming the laboratory
   *  through the batch. No results and no specimen, the shape most real EID requests have. */
  const seed = async (key: string, lab: string, authoredAt: string): Promise<void> => {
    await db.insertInto('lab_requests' as never).values({
      id: `req-${key}`, request_id: `LAB-${key}`, panel_code: 'HIVPC', batch_id: `batch-${key}`,
      authored_at: authoredAt,
    } as never).execute();
    await db.insertInto('diagnostic_reports' as never).values({
      id: `dr-${key}`, batch_id: `batch-${key}`, performer: `CODE-${key}`, performer_display: lab,
    } as never).execute();
  };

  /** Every cell of the calendar's body, as numbers, blanks dropped. */
  const cells = (rows: Record<string, string>[]): number[] =>
    rows.slice(1).flatMap((r) => ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']
      .map((k) => r[k]).filter((v) => v !== '').map(Number));

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: target.toString() });
    db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    const up = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    expect(up.error).toBeUndefined();

    // Three laboratories, chosen so every figure has a different answer.
    //
    // ⛔ ISO 8601 text CARRYING THE SOURCE OFFSET, the shape the warehouse actually holds. The
    // query slices left(ts, 10) for the day, so an offset-free fixture would prove a string the
    // real data never contains.
    //
    // Busy: submits on Mon 1, Tue 2 and Wed 24 Jul. Last working day is n18, so it is silent 5.
    await seed('busy1', 'Busy Lab', '2013-07-01T08:00:00+03:00');
    await seed('busy2', 'Busy Lab', '2013-07-02T08:00:00+03:00');
    await seed('busy3', 'Busy Lab', '2013-07-24T08:00:00+03:00');
    // Quiet: one submission on Mon 1 Jul, n1, so it is silent 22. Counted by silent10.
    await seed('quiet1', 'Quiet Lab', '2013-07-01T08:00:00+03:00');
    // Weekend: submits ONLY on Sat 6 Jul. It has no working day at all, so it is silent for the
    // whole month, and its arrival appears in the calendar but in no working-day figure.
    await seed('wknd1', 'Weekend Lab', '2013-07-06T09:00:00+03:00');
  });

  afterAll(async () => {
    await db?.destroy();
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.end();
  });

  it('lifts a header row of day initials, Monday first', async () => {
    const rows = await calendar(MONTH);
    expect([rows[0].c1, rows[0].c2, rows[0].c3, rows[0].c4, rows[0].c5, rows[0].c6, rows[0].c7])
      .toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(rows[0].ord).toBe(0);
  });

  it('counts DISTINCT laboratories per calendar day, weekends included', async () => {
    const rows = await calendar(MONTH);
    // Week 27 is 1-7 July. Mon carries Busy and Quiet, Tue carries Busy, Sat carries Weekend.
    const wk27 = rows[1];
    expect(wk27.c1, 'Monday 1 July: two laboratories').toBe('2');
    expect(wk27.c2, 'Tuesday 2 July: one').toBe('1');
    expect(wk27.c3).toBe('0');
    expect(wk27.c6, 'Saturday 6 July: the weekend arrival must appear').toBe('1');
    expect(wk27.c7).toBe('0');
  });

  it('leaves days outside the month blank rather than zero', async () => {
    // 31 July is a Wednesday, so the last row's Thursday onward are not days of this month. A blank
    // and a zero paint the same tint, but they must not be the same VALUE: a later slice that gives
    // the element a third cell state needs the distinction to still be in the data.
    const rows = await calendar(MONTH);
    const last = rows[rows.length - 1];
    expect(last.c3, '31 July is a Wednesday and is in the month').toBe('0');
    expect(last.c4, '1 August is not').toBe('');
    expect(last.c7).toBe('');
  });

  it('agrees with the figures on the busiest day, which is the cross-check between the two', async () => {
    // The one assertion that catches the pivot drifting away from the aggregate. Both queries build
    // their own CTEs; nothing but this says they still describe the same month.
    const [rows, figures] = await Promise.all([calendar(MONTH), summary(MONTH)]);
    expect(Number(figures[0].busiest)).toBe(Math.max(...cells(rows)));
    expect(figures[0].busiest).toBe('2'); // Monday 1 July, Busy and Quiet
  });

  it('returns exactly one row of figures', async () => {
    // A bound keyvalue reads resolved.rows[0] and nothing else, so a second row would vanish.
    expect(await summary(MONTH)).toHaveLength(1);
  });

  it('counts every laboratory that submitted, including the weekend-only one', async () => {
    expect((await summary(MONTH))[0].labs).toBe('3');
  });

  it('keeps the weekend arrival out of the working-day percentage', async () => {
    // 3 laboratories x 23 working days = 69 possible laboratory-days. Filled: Busy on 1, 2 and 24
    // July, Quiet on 1 July. The Saturday arrival is NOT one of them. 4 / 69 = 5.8 per cent.
    // If the weekend day leaked in, this would be 5 / 69 = 7.2.
    expect((await summary(MONTH))[0].pct_lab_days).toBe('5.8');
  });

  it('counts a laboratory silent ten or more working days, and not one silent five', async () => {
    // Quiet last submitted on n1 and Weekend has no working day at all, so both are silent 22 and
    // 23. Busy last submitted on 24 July, n18 of 23, so it is silent 5 and must not be counted.
    expect((await summary(MONTH))[0].silent10).toBe('2');
  });

  it('answers a month with no arrivals with a full calendar and a row of zeros', async () => {
    // An empty month must render a page that says nothing arrived, not fail the run. The guarded
    // division is what stands between those two outcomes.
    const rows = await calendar('2013-02');
    expect(rows.length).toBeGreaterThan(1);
    expect(cells(rows).every((c) => c === 0)).toBe(true);
    expect((await summary('2013-02'))[0])
      .toEqual({ labs: '0', pct_lab_days: '0', busiest: '0', silent10: '0' });
  });

  it('normalises a loose month, so 2013-7 answers exactly like 2013-07', async () => {
    // 'month' is free text with no shape check. A raw left(ts, 7) = '2013-7' matches nothing, and
    // the band would print zeros over a month that was busy.
    expect(await summary('2013-7')).toEqual(await summary(MONTH));
  });
});
