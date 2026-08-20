import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, externalMigrations } from '@openldr/db';
import zlib from 'node:zlib';
import { renderReportDesignPdf, resolveDesignTables } from '@openldr/report-designer';
import { SEED_DESIGNS, SEED_QUERIES } from './report-seeds';

/** Each physical page's decompressed content stream, found via `/Kids` so page order is the PDF's
 *  own and not an assumption about object emission order.
 *
 *  ⚠ Objects are located with an indexOf scan, NOT a RegExp built from a template literal: a
 *  lone `\s` inside a template literal is only the letter `s`, so the obvious
 *  ``new RegExp(`${id} 0 obj([\s\S]*?)endobj`)`` compiles to `[sS]` and matches almost
 *  nothing. Same class of trap as the `\\b` note in report-seeds.test.ts. */
function pageStreams(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const kids = raw.match(/\/Type\s*\/Pages[\s\S]*?\/Kids\s*\[([^\]]*)\]/)!;
  const objBody = (id: string): string => {
    const at = raw.indexOf(`\n${id} 0 obj`);
    const from = at >= 0 ? at : raw.indexOf(`${id} 0 obj`);
    return raw.slice(from, raw.indexOf('endobj', from));
  };
  return [...kids[1].matchAll(/(\d+) 0 R/g)].map((k) => {
    const cid = objBody(k[1]).match(/\/Contents (\d+) 0 R/)![1];
    const stream = objBody(cid).match(/stream\r?\n([\s\S]*?)\r?\nendstream/)![1];
    return zlib.inflateSync(Buffer.from(stream, 'latin1')).toString('latin1');
  });
}

/** Every text run on one page, with the user-space position pdfkit drew it at.
 *  ⚠ pdfkit splits a run at every kerning pair, so the `<...>` chunks WITHIN one `TJ` array
 *  must be rejoined before comparing — searching for the hex of a whole word silently misses. */
function textRuns(content: string): { x: number; y: number; text: string }[] {
  const runs = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\n\/F\d+ [\d.]+ Tf\n\[(.*?)\]\s*TJ/g;
  return [...content.matchAll(runs)].map((m) => ({
    x: parseFloat(m[1]),
    y: parseFloat(m[2]),
    text: [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''),
  }));
}

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
  const runQuery = (queryId: string) => async (p: { month: string; panels: string; tz?: string }) => {
    const raw = SEED_QUERIES.find((q) => q.id === queryId)!.sql.postgres;
    const text = raw
      .replace(/\{\{\s*param\.month\s*\}\}/g, `'${p.month.replace(/'/g, "''")}'`)
      .replace(/\{\{\s*param\.panels\s*\}\}/g, `'${p.panels.replace(/'/g, "''")}'`)
      .replace(/\{\{\s*param\.tz\s*\}\}/g, `'${(p.tz ?? 'UTC').replace(/'/g, "''")}'`);
    // `sql.raw` is itself generic; the `sql<T>.raw(...)` shape parses as an instantiation
    // expression followed by a property access, which TS 5.x rejects (TS1477).
    const res = await sql.raw<Record<string, string>>(text).execute(db);
    return res.rows;
  };
  const runFor = runQuery('q-transmission-hvleid');
  const runForOther = runQuery('q-transmission-other');

  // One submission: a batch carrying a lab_request and a diagnostic_report naming the
  // laboratory. Deliberately NO lab_results and NO specimen — that is the shape 548 of 550 real
  // EID requests have, and the shape the specimen route cannot see.
  //
  // The panel codes below are TEST FIXTURE DATA, not product vocabulary: the queries themselves
  // carry no code at all (AGENTS.md §8), the list arrives as {{param.panels}}.
  //
  // `labName`, `panelCode` and `performer` are nullable so the two fallback branches added beyond
  // the brief — the '(unknown)' lab name and the coalesced NULL panel — can actually be reached.
  //
  // ⛔ FIXED 2026-08-20: this helper wrote only ingest_events.recorded_at, a column `arrivals`
  // stopped reading when commit 658d2897 moved the grid onto the clinical-date ladder
  // (authored_at, then result_timestamp, then issued). From that commit until now every test built
  // on this helper matched ZERO rows and failed silently -- silently because this whole file only
  // runs with TARGET_DATABASE_URL set, which no CI job sets, so nothing ever reported it red. Now
  // writes `authored_at`, the ladder's first (and, for a registration-only submission, only) rung,
  // exactly the shape this helper's own comment already claimed to build. The ingest_events insert
  // is gone with it: `arrivals` never reads that table, so keeping the write was dead weight that
  // could go stale again unnoticed, the same way this one did.
  const seedSubmission = async (
    key: string, labName: string | null, panelCode: string | null, authoredAt: string,
    performer: string | null = `CODE-${key}`,
  ): Promise<void> => {
    const batchId = `batch-${key}`;
    await db.insertInto('lab_requests' as never).values({
      id: `req-${key}`, request_id: `LAB-${key}`, panel_code: panelCode, batch_id: batchId,
      authored_at: authoredAt,
    } as never).execute();
    await db.insertInto('diagnostic_reports' as never).values({
      id: `dr-${key}`, batch_id: batchId, performer, performer_display: labName,
    } as never).execute();
  };

  // The three CLINICAL timestamps the grid now buckets on, seeded one row at a time. A submission
  // is not one shape any more: a request may be registered in one month and resulted in the next,
  // so each test builds exactly the rows its case needs.
  //
  // ⛔ ISO 8601 text CARRYING THE SOURCE OFFSET, the shape the warehouse actually holds. The query
  // compares left(ts, 7) to the month and slices left(ts, 10) for the day, so an offset-free
  // fixture would prove a string the real data never contains.
  const seedRequest = async (r: {
    id: string; batchId: string; panel: string | null; authoredAt: string | null;
  }): Promise<void> => {
    await db.insertInto('lab_requests' as never).values({
      id: r.id, request_id: r.id, panel_code: r.panel, batch_id: r.batchId, authored_at: r.authoredAt,
    } as never).execute();
  };

  // `performer` with no `performer_display` and no facility_map row, so `lab` falls through to the
  // performer code and the test can name the laboratory it asserts on.
  const seedReport = async (r: {
    id: string; basedOnId: string; batchId: string; performer: string; issued: string | null;
  }): Promise<void> => {
    await db.insertInto('diagnostic_reports' as never).values({
      id: r.id, based_on_id: r.basedOnId, batch_id: r.batchId, performer: r.performer, issued: r.issued,
    } as never).execute();
  };

  const seedResult = async (r: {
    id: string; requestId: string; resultTimestamp: string;
  }): Promise<void> => {
    await db.insertInto('lab_results' as never).values({
      id: r.id, request_id: r.requestId, result_timestamp: r.resultTimestamp,
    } as never).execute();
  };

  /** Every day cell on one row, d01..d23, in column order. */
  const dayCells = (row: Record<string, string>): string[] =>
    Object.keys(row).filter((k) => /^d\d\d$/.test(k)).sort().map((k) => row[k]);

  /** The invariant the clinical-date ladder actually establishes: a request marks ONE day in the
   *  month, at its highest-priority in-month timestamp. Asserting a single adjacent blank cell
   *  only pins an off-by-one; this pins the whole row, so a second mark anywhere fails. */
  const marksExactlyOneDay = (row: Record<string, string>, day: string): void => {
    expect(row[day], `expected the mark on ${day}`).toBe('1');
    expect(dayCells(row).filter((c) => c === '1'), `${row.lab} marked more than one day`).toEqual(['1']);
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

    // No registry row, no display name, no performer code — every source of a laboratory name is
    // null. Without the '(unknown)' fallback this row's `lab` is NULL, the grid join never matches
    // it, and it renders as a blank name with 23 blank cells. 3 Mar 2026 = n2 = d02.
    await seedSubmission('noname', null, 'HIVPC', '2026-03-03T08:00:00Z', null);

    // A request with NO panel code. Without coalesce(panel_code, '') the `not in` predicate is NULL
    // for this row and it vanishes from BOTH grids — the partition would silently lose it.
    await seedSubmission('nopanel', 'No Panel Lab', null, '2026-03-03T08:00:00Z');

    // A panel code with an INNER SPACE. This is the Postgres half of the case that separates a
    // per-element trim from a whole-parameter space strip: called with panels 'A, BB CC', a correct
    // split yields the element 'BB CC' and matches, while stripping every space from the list first
    // yields 'BBCC' and silently sends this request to the other grid.
    await seedSubmission('spacecode', 'Inner Space Lab', 'BB CC', '2026-03-03T08:00:00Z');

    // The 18x fan-out `distinct` collapses: one batch, several diagnostic_reports rows, one
    // performer. ⚠ No test here can catch a lost `distinct` — max() folds the duplicates, so the
    // grid reads identically either way, which is why the test below was renamed off that claim.
    // The fixture stays because it makes every other assertion run against the FANNED-OUT shape
    // real data has, instead of the one-report-per-batch shape none of it has.
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

  // ⛔ A test lived here asserting that a 21:00Z arrival re-buckets into the NEXT day at +03.
  // Commit 658d2897 removed that behaviour deliberately: the grid now buckets on the source's
  // own clinical date text, with no zone conversion anywhere, and the report dropped its time
  // zone parameter in the same change. The test survived only because this file needs a live
  // database and skips without one, so nobody ran it for months.
  //
  // The 'Late Evening Lab' fixture seeded at 2026-03-03T21:00:00Z is KEPT. Nothing asserts it
  // today. It is the boundary case, and the day somebody reintroduces any zone handling it is
  // the fixture that catches it.

  it('leaves trailing columns blank in a short month rather than shifting cells left', async () => {
    // February 2026 has 20 working days. d21..d23 must be empty and d01 must still be the 2nd.
    const rows = await runFor({ month: '2026-02', panels: 'HIVPC', tz: 'UTC' });
    const dates = rows.find((r) => r.lab === '(dates)')!;
    expect(dates.d21).toBe('');
    expect(dates.d22).toBe('');
    expect(dates.d23).toBe('');
    // TWO LINES, day over month: the design's `headerRow` draws a header cell's newlines stacked,
    // and `columnWidths` then measures "Feb" rather than "2 Feb" — which is what leaves the
    // laboratory column enough width to print a real name.
    expect(dates.d01).toBe('2\nFeb');
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

  it("writes exactly '1' in an arrival cell and leaves a silent day empty", async () => {
    // NOT a test of the `distinct` in `arrivals`: max() folds duplicates, so this passes with or
    // without it. What it does pin is the cell VALUE — a mark, never a count, and never a run of
    // marks from the batch's several diagnostic_reports rows.
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const lab = rows.find((r) => r.lab === 'Registration Only Lab')!;
    expect(lab.d02).toBe('1');
    expect(lab.d01).toBe('');
  });

  it('renders 23 day columns and no more, on every row', async () => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      const keys = Object.keys(row).filter((k) => /^d\d\d$/.test(k));
      expect(keys, `row ${row.lab}`).toHaveLength(23);
      expect(keys, `row ${row.lab}`).toContain('d23');
      expect(keys, `row ${row.lab}`).not.toContain('d24');
    }
  });

  it('gives each laboratory a unique ord from 2, alphabetically', async () => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const labRows = rows.filter((r) => r.lab !== '(dates)' && r.lab !== '(week)');
    const ords = labRows.map((r) => Number(r.ord)).sort((a, b) => a - b);
    expect(new Set(ords).size, 'ord repeats across laboratories').toBe(ords.length);
    expect(Math.min(...ords)).toBe(2);
    const byName = [...labRows].sort((a, b) => a.lab.localeCompare(b.lab));
    expect(labRows.map((r) => r.lab)).toEqual(byName.map((r) => r.lab));
  });

  it('carries a week-token row at ord = 1, whose value changes across a week boundary', async () => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const week = rows.find((r) => r.lab === '(week)');
    expect(week, 'the week-token row is missing').toBeDefined();
    // 2 March 2026 (d01) is a Monday and 6 March (d05) is a Friday, same week; 9 March (d06) is
    // the following Monday. The token must change there and only there among d01..d06.
    expect(week!.d01).toBe(week!.d05);
    expect(week!.d06).not.toBe(week!.d01);
  });

  it('computes days as the count of marked working days, and silent against the last one', async () => {
    // Registration Only Lab (fixture, beforeAll) marks exactly d02 in March 2026 and nothing else.
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const lab = rows.find((r) => r.lab === 'Registration Only Lab')!;
    expect(lab.days).toBe('1');
    // March 2026 has 22 working days (starts on a Sunday, see the file header comment). Silent
    // since d02 (n=2) as at the month's last working day (n=22) is 22 - 2 = 20.
    expect(lab.silent).toBe('20');
  });

  it("names a laboratory '(unknown)' when the registry, the display name and the code are all null", async () => {
    // Beyond the brief, so it needs its own fixture: without the fallback `lab` is NULL, the grid
    // join never matches, and the laboratory renders as a blank name with 23 blank cells.
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const unknown = rows.find((r) => r.lab === '(unknown)');
    expect(unknown, 'a nameless laboratory must still get a row').toBeDefined();
    expect(unknown!.d02).toBe('1');
  });

  it('trims each panel element on its own, so a code with an inner space still matches', async () => {
    // The Postgres half of the case that motivated replacing MySQL's find_in_set. The list has a
    // space after the comma AND a space inside the second code, so only a per-element trim can get
    // both right. Proves the semantics on the one engine that runs here; MySQL stays unproven.
    const hv = await runFor({ month: '2026-03', panels: 'A, BB CC', tz: 'UTC' });
    const ot = await runForOther({ month: '2026-03', panels: 'A, BB CC', tz: 'UTC' });
    expect(hv.some((r) => r.lab === 'Inner Space Lab')).toBe(true);
    expect(ot.some((r) => r.lab === 'Inner Space Lab')).toBe(false);
  });

  it('puts a request with NO panel code in the Other grid, not in neither', async () => {
    // Beyond the brief, so it needs its own fixture. `null not in (...)` is NULL, so without
    // coalesce(panel_code, '') this laboratory disappears from both grids and the partition leaks.
    const hv = await runFor({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    const ot = await runForOther({ month: '2026-03', panels: 'HIVPC', tz: 'UTC' });
    expect(hv.some((r) => r.lab === 'No Panel Lab')).toBe(false);
    expect(ot.some((r) => r.lab === 'No Panel Lab')).toBe(true);
  });

  // ------------------------------------------------------------------------------------------
  // Clinical-date bucketing: registered, then tested, then authorised
  // ------------------------------------------------------------------------------------------
  //
  // 1 April 2013 was a Monday, so the working days run d01 = Mon 1, d02 = Tue 2, d03 = Wed 3,
  // d04 = Thu 4, d05 = Fri 5, d06 = Mon 8, d07 = Tue 9. Confirmed against the calendar.

  it('falls through to the result date when registration sits outside the month', async () => {
    // Registered in March, resulted in April. The April grid must mark 2 April.
    await seedRequest({ id: 'r1-obr1', batchId: 'b1', panel: 'HIVVL',
      authoredAt: '2013-03-28T09:00:00+03:00' });
    await seedReport({ id: 'dr1', basedOnId: 'r1-obr1', batchId: 'b1', performer: 'LAB-A',
      issued: null });
    await seedResult({ id: 'o1', requestId: 'r1-obr1',
      resultTimestamp: '2013-04-02T11:00:00+03:00' });

    const rows = await runFor({ month: '2013-04', panels: 'HIVVL' });

    const lab = rows.find((r) => r.lab === 'LAB-A')!;
    marksExactlyOneDay(lab, 'd02');
    expect(lab.d01).toBe('');
  });

  it('marks one day per request per month, at the highest-priority in-month date', async () => {
    // Registered AND authorised inside the same month. Only registration marks.
    await seedRequest({ id: 'r2-obr1', batchId: 'b2', panel: 'HIVVL',
      authoredAt: '2013-04-03T09:00:00+03:00' });
    await seedReport({ id: 'dr2', basedOnId: 'r2-obr1', batchId: 'b2', performer: 'LAB-B',
      issued: '2013-04-09T16:00:00+03:00' });

    const rows = await runFor({ month: '2013-04', panels: 'HIVVL' });

    const lab = rows.find((r) => r.lab === 'LAB-B')!;
    marksExactlyOneDay(lab, 'd03');
    expect(lab.d07, 'the authorisation date must not mark a second day').toBe('');
  });

  it('falls all the way through to the authorisation date', async () => {
    // Registered in March, never resulted, authorised on 4 April. The third step is the only one
    // left. It is not a rare path: for 2017-08 it resolves 194 of 2,376 in-gate requests across
    // all panels, and 118 of 905 for a four-code HVL/EID list. Measured 2026-08-19.
    await seedRequest({ id: 'r3-obr1', batchId: 'b3', panel: 'HIVVL',
      authoredAt: '2013-03-29T09:00:00+03:00' });
    await seedReport({ id: 'dr3', basedOnId: 'r3-obr1', batchId: 'b3', performer: 'LAB-C',
      issued: '2013-04-04T16:00:00+03:00' });

    const rows = await runFor({ month: '2013-04', panels: 'HIVVL' });

    const lab = rows.find((r) => r.lab === 'LAB-C')!;
    marksExactlyOneDay(lab, 'd04');
  });

  it('⛔ answers a loose month exactly like a strict one, rather than emptying the grid', async () => {
    // 'month' is free text: custom-query-run.ts:14 validates only daterange, and
    // RunParamsSheet.tsx:53 renders a plain input. So '2013-4' reaches the SQL.
    //
    // ⛔ This is the failure mode the string comparison introduced. cast('2013-4' || '-01') still
    // parses to 2013-04-01, so `days` builds a correct April header and the date row renders
    // perfectly, but a raw left(ts, 7) = '2013-4' matches nothing. The report then prints a right
    // header above ZERO laboratories and a reader concludes nobody transmitted all month. Silent,
    // and the same class of wrong answer this whole slice exists to remove.
    const strict = await runFor({ month: '2013-04', panels: 'HIVVL' });
    const loose = await runFor({ month: '2013-4', panels: 'HIVVL' });

    expect(loose).toEqual(strict);
    // ...and not vacuously equal because both came back empty.
    expect(loose.some((r) => r.lab === 'LAB-A')).toBe(true);
  });

  it('⛔ partitions the month between the two grids, on every rung of the ladder', async () => {
    // The two grids must DIVIDE the month's requests: one grid each, never both, never neither.
    //
    // ⛔ Every rung is tested, not just registration. A request reaches `arrivals` through a
    // different branch of the coalesce depending on which timestamp is the first one in the month,
    // so a panel predicate that only bit on the registration branch would still pass a one-rung
    // test. Each rung gets a matching pair: same dates, one panel inside the list and one outside.
    //
    // 3 June 2013 was a Monday, so the working days run d01 = Mon 3, d02 = Tue 4, d03 = Wed 5.
    // Confirmed against the calendar. Nothing else in this file seeds June 2013.
    const rungs = [
      // Registered in June. The first rung answers and the other two are never consulted.
      { key: 'reg', authored: '2013-06-03T09:00:00+03:00', result: null, issued: null, day: 'd01' },
      // Registered in May, resulted in June. The second rung answers.
      { key: 'res', authored: '2013-05-29T09:00:00+03:00', result: '2013-06-04T11:00:00+03:00', issued: null, day: 'd02' },
      // Registered in May, never resulted, authorised in June. The third rung answers.
      { key: 'iss', authored: '2013-05-29T09:00:00+03:00', result: null, issued: '2013-06-05T16:00:00+03:00', day: 'd03' },
    ] as const;

    for (const r of rungs) {
      for (const side of ['in', 'out'] as const) {
        const id = `p-${r.key}-${side}`;
        const batchId = `pb-${r.key}-${side}`;
        // Fixture panel codes, not product vocabulary (AGENTS.md §8): the SQL carries none, the
        // list arrives as {{param.panels}}. 'in' is on the list below, 'out' is not.
        await seedRequest({ id, batchId, panel: side === 'in' ? 'HIVVL' : 'CHEM', authoredAt: r.authored });
        await seedReport({ id: `pdr-${r.key}-${side}`, basedOnId: id, batchId,
          performer: `PLAB-${r.key}-${side}`, issued: r.issued });
        if (r.result) await seedResult({ id: `po-${r.key}-${side}`, requestId: id, resultTimestamp: r.result });
      }
    }

    const hv = await runFor({ month: '2013-06', panels: 'HIVVL' });
    const ot = await runForOther({ month: '2013-06', panels: 'HIVVL' });

    for (const r of rungs) {
      const inLab = `PLAB-${r.key}-in`;
      const outLab = `PLAB-${r.key}-out`;

      const onList = hv.find((x) => x.lab === inLab);
      expect(onList, `${inLab} is missing from the HVL/EID grid`).toBeDefined();
      marksExactlyOneDay(onList!, r.day);
      expect(ot.some((x) => x.lab === inLab), `${inLab} leaked into the Other grid too`).toBe(false);

      const offList = ot.find((x) => x.lab === outLab);
      expect(offList, `${outLab} fell out of BOTH grids`).toBeDefined();
      marksExactlyOneDay(offList!, r.day);
      expect(hv.some((x) => x.lab === outLab), `${outLab} leaked into the HVL/EID grid too`).toBe(false);
    }
  });

  // ------------------------------------------------------------------------------------------
  // The whole round trip: live SQL -> sortBy -> renderer -> PDF
  // ------------------------------------------------------------------------------------------

  it('⛔ carries the two-line date from live Postgres all the way onto the page', async () => {
    // Every other test in this file stops at the query, and every test in report-seeds.test.ts is
    // a regex over SQL text. Neither can see the join this task actually rests on: that `chr(10)`
    // survives the pg driver, that `headerRow` splits it back into two lines, and that
    // `columnWidths` then measures the WIDER LINE rather than the concatenation. If any link
    // breaks, the dates draw on one line and every laboratory name goes back under an ellipsis —
    // with the entire hermetic suite green.
    const design = SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;

    // ⛔ Through the REAL `resolveDesignTables`, not a hand-rolled sort. Re-implementing
    // `[...rows].sort(byOrd)` here would never read the element's own `sortBy`, so deleting it from
    // the seeded design would leave this test green while the page it renders was wrong — the exact
    // shape of blindness this whole task keeps finding.
    const runForDesign = async (queryId: string, values: Record<string, unknown>) => {
      const rows = await runQuery(queryId)(values as { month: string; panels: string; tz: string });
      // ⛔ REVERSED on the way in. Postgres happens to return the union's ord=0 row first, so a
      // faithful pass-through leaves `sortBy` with nothing to do and this test stays green with it
      // deleted - measured. Handing the rows back in the wrong order is what makes the element's
      // own `sortBy: 'ord'` load-bearing here, which is the whole reason it exists: the runner wraps
      // every query in a derived table and MySQL may discard the inner ORDER BY.
      return { columns: Object.keys(rows[0]).map((k) => ({ key: k, label: k })), rows: [...rows].reverse() };
    };
    const resolved = await resolveDesignTables(
      design, { month: '2026-03', panels: 'HIVPC', tz: 'UTC' }, runForDesign);

    const buf = await renderReportDesignPdf(design, resolved, {
      now: new Date('2026-03-31T09:00:00Z'),
      values: { month: '2026-03', panels: 'HIVPC', tz: 'UTC' },
    });

    const page1 = pageStreams(buf)[0];
    const drawn = textRuns(page1);
    const headY = drawn.find((r) => r.text === 'Laboratory')!.y;
    const line1 = drawn.filter((r) => r.y === headY).sort((a, b) => a.x - b.x);
    const line2 = drawn.filter((r) => r.y === headY - 8).sort((a, b) => a.x - b.x);

    // March 2026 starts on a Sunday: 22 working days, so d23 is blank and draws nothing. These are
    // CALENDAR day numbers with the weekends missing, not 1..22 — which is the point of the first
    // header line, and something a `String(i + 1)` slot label could never say.
    expect(line1.map((r) => r.text)).toEqual(['Laboratory',
      '2', '3', '4', '5', '6', '9', '10', '11', '12', '13', '16', '17', '18', '19', '20',
      '23', '24', '25', '26', '27', '30', '31']);
    expect(line2.map((r) => r.text)).toEqual(Array(22).fill('Mar'));

    // ⛔ The measurement, taken off the real page. The gain lands in the LABORATORY column, and
    // that is the number to assert. Measured on this fixture by running it both ways:
    //
    //   one-line `2 Mar` header : laboratory column  76.02pt, day column 27.77pt
    //   stacked  `2` / `Mar`    : laboratory column 102.95pt, day column 29.33pt
    //
    // ⚠ The day columns come out slightly WIDER stacked, not narrower. These fixture laboratory
    // names are short, so the day columns were never the starved ones here and the proportional
    // allocation simply hands the freed width around. Asserting "the day column shrank" would be
    // wrong on this data and would have failed for the right reason on the wrong claim.
    const xs = line1.map((r) => r.x);
    expect(xs[1] - xs[0]).toBeGreaterThan(90);

    // ⛔ Nothing on the page was ellipsized. The comparison is against BYTE 0x85, not U+2026:
    // pdfkit writes the ellipsis in WinAnsiEncoding, where it is 0x85, and the latin1 decode in
    // `textRuns` turns that into U+0085. Measured - a run cut at width 60pt comes back as
    // codes 97,32,118,101,114,121,133. An assertion against U+2026 can NEVER fire, which is what
    // this one did before review: a page with every laboratory name cut still passed it.
    expect(drawn.map((r) => r.text).join('')).not.toContain(String.fromCharCode(0x85));
    expect(drawn.map((r) => r.text)).not.toContain('(dates)');
    expect(drawn.map((r) => r.text)).not.toContain('ord');
  });

  // ⛔ KNOWN GAP, not fixed in this slice (2a). 'rt-transmission-grid' is a `table` element with
  // `headerRow: true`. `bodyRowsFor` (report-designer/src/render/draw.ts:352-355) lifts EXACTLY
  // ONE row into the header band, `rowsFor(...).slice(1)`, never `.slice(2)`. This slice's query
  // now emits TWO synthetic rows. Only ord=0 (the dates) is lifted; ord=1 (the week tokens) prints
  // as an ordinary body row: a fake laboratory named '(week)' with week numbers where marks used
  // to be, above every real laboratory, on both grids. Fixing it means replacing this design with
  // a `cellgrid` one, which is out of scope here ("no design change", slice 2a's own brief).
  // DELETE THIS TEST in slice 2b (docs/superpowers/plans/2026-08-20-transmission-design-slice2b.md),
  // whose own goal statement says so explicitly: "Delete the characterization test that slice 2a
  // added to pin the week-token-row regression, because this slice is what fixes it." Until slice
  // 2b lands, this test PINS the current, real, interim behaviour so it is a documented fact
  // rather than a silent regression. A future reader must NOT read this as desired behaviour.
  it('⛔ KNOWN GAP: the unmodified rt-transmission-grid table shows the week-token row as a body row', async () => {
    const design = SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;
    const runForDesign = async (queryId: string, values: Record<string, unknown>) => {
      const rows = await runQuery(queryId)(values as { month: string; panels: string; tz: string });
      return { columns: Object.keys(rows[0]).map((k) => ({ key: k, label: k })), rows: [...rows].reverse() };
    };
    const resolved = await resolveDesignTables(
      design, { month: '2026-03', panels: 'HIVPC', tz: 'UTC' }, runForDesign);
    const buf = await renderReportDesignPdf(design, resolved, {
      now: new Date('2026-03-31T09:00:00Z'),
      values: { month: '2026-03', panels: 'HIVPC', tz: 'UTC' },
    });
    const page1 = pageStreams(buf)[0];
    const drawn = textRuns(page1);
    expect(drawn.map((r) => r.text), 'the week-token row no longer leaks into the body: check whether the design was fixed and this test should be deleted').toContain('(week)');
  });

  // ⛔ DELETED: 'returns an EMPTY HVL/EID grid and a FULL Other grid when the panel list is empty'.
  //
  // It asserted a state the product cannot be in. Both queries declare `panels` as
  // `required: true`, and `substituteParams` throws `required parameter: panels` on '' or null
  // before any SQL is built (packages/dashboards/src/custom-query-run.ts:33). A blank panel list
  // is an ERROR on every real run, never an empty grid.
  //
  // It passed only because `runQuery` above mirrors the SUBSTITUTION and not the guard — it does
  // a regex replace and never calls the required-param check. So the test proved a branch of SQL
  // that no run reaches, using a substitution path no run takes.
  //
  // The guard itself is asserted where the guard actually lives, hermetically:
  // packages/bootstrap/src/seed-queries-select-gate.test.ts.
});
