import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, externalMigrations } from '@openldr/db';
import { isValidIanaZone, paramFormatMessage } from '@openldr/core/pure';
import { SEED_QUERIES } from './report-seeds';

/**
 * Why this file exists, separately from `transmission-grid-live.test.ts`.
 *
 * The `tz` guard in `packages/core/src/param-format.ts` refuses a signed offset, and the
 * `lab.timezone` setting now refuses one too. Every justification for both was a MEASUREMENT
 * written into a comment: `+3` means UTC−3, `Etc/GMT+3` means the same, an unrecognised name
 * errors instead of returning wrong rows. No test drove any of it through a warehouse.
 *
 * A comment cannot fail. If Postgres ever changed how it reads that sign, the guard would quietly
 * become pointless and all three comments would still assert it was needed. This file makes the
 * measurement executable, against the SEEDED query the guard protects rather than a bare
 * `select ... at time zone`, so it also proves the inversion survives the whole grid.
 *
 * Runs only when TARGET_DATABASE_URL points at a live Postgres. It provisions its OWN throwaway
 * database and drops it in afterAll, so it never touches the shared dev warehouse — same pattern
 * as `transmission-grid-live.test.ts`.
 *
 * ⛔ pg-mem cannot stand in (AGENTS.md §7). `at time zone` with a zone-name string, the recursive
 * day series and the cross join are exactly the pieces under test.
 */
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

// 1 March 2026 is a Sunday (isodow 7, measured), so the month's working days start
//   2 Mar = n1 = d01,  3 Mar = n2 = d02.
//
// ⛔ The fixture arrival is deliberately at 01:30Z — inside the first 3 hours of a UTC day. That
// is what makes the two zones disagree about which DAY it was. A mid-afternoon arrival is the same
// calendar day at UTC±3 and would leave every assertion below passing with the guard deleted; that
// mistake was already made once in this arc.
const ARRIVAL = '2026-03-03T01:30:00Z';
const EAST = 'Africa/Dar_es_Salaam';           // UTC+03:00 all year, no DST.
const MINUS_THREE = 'America/Argentina/Buenos_Aires'; // UTC−03:00 all year, no DST.
const LAB = 'Midnight Boundary Lab';

// Measured against this fixture (see the report): 2026-03-03 01:30Z casts to
//   Africa/Dar_es_Salaam → 3 Mar → d02        America/Argentina/Buenos_Aires → 2 Mar → d01
const D_EAST = 'd02';
const D_WEST = 'd01';

live('a signed-offset time zone silently inverts the transmission grid (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_tgridtz_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<Record<string, never>>;
  let pool: pg.Pool;

  // ⛔ Mirrors `substituteParams` (packages/dashboards/src/custom-query-run.ts:37): a GLOBAL regex
  // inlining an ESCAPED QUOTED STRING LITERAL, never a bound placeholder. Copied deliberately from
  // `transmission-grid-live.test.ts` rather than re-derived — binding a parameter here would test a
  // path no run takes, and `at time zone $1` does not even mean the same thing to Postgres.
  // Global, because {{param.tz}} and {{param.month}} each appear several times in one query.
  const runFor = async (p: { month: string; panels: string; tz: string }) => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-transmission-hvleid')!.sql.postgres;
    const text = raw
      .replace(/\{\{\s*param\.month\s*\}\}/g, `'${p.month.replace(/'/g, "''")}'`)
      .replace(/\{\{\s*param\.panels\s*\}\}/g, `'${p.panels.replace(/'/g, "''")}'`)
      .replace(/\{\{\s*param\.tz\s*\}\}/g, `'${p.tz.replace(/'/g, "''")}'`);
    // `sql.raw` is itself generic; the `sql<T>.raw(...)` shape parses as an instantiation
    // expression followed by a property access, which TS 5.x rejects (TS1477).
    const res = await sql.raw<Record<string, string>>(text).execute(db);
    return res.rows;
  };

  /** The one fixture laboratory's row, for a given zone. */
  const rowFor = async (tz: string) => {
    const rows = await runFor({ month: '2026-03', panels: 'HIVPC', tz });
    const row = rows.find((r) => r.lab === LAB);
    expect(row, `the fixture laboratory must appear in the grid for tz=${tz}`).toBeDefined();
    return row!;
  };

  /** Which day columns carry a mark. One entry, always, for this single-arrival fixture. */
  const markedDays = (row: Record<string, string>): string[] =>
    Object.keys(row).filter((k) => /^d\d\d$/.test(k) && row[k] !== '').sort();

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: target.toString() });
    db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    const up = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    expect(up.error).toBeUndefined();

    // One submission, one arrival. The panel code is TEST FIXTURE DATA, not product vocabulary —
    // the query carries no code at all (AGENTS.md §8); the list arrives as {{param.panels}}.
    await db.insertInto('lab_requests' as never).values({
      id: 'req-tz', request_id: 'LAB-tz', panel_code: 'HIVPC', batch_id: 'batch-tz',
    } as never).execute();
    await db.insertInto('diagnostic_reports' as never).values({
      id: 'dr-tz', batch_id: 'batch-tz', performer: 'CODE-tz', performer_display: LAB,
    } as never).execute();
    await db.insertInto('ingest_events' as never).values({
      resource_type: 'ServiceRequest', resource_id: 'req-tz', version: 1, recorded_at: ARRIVAL,
    } as never).execute();
  });

  afterAll(async () => {
    await db?.destroy();
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.end();
  });

  it("⛔ '+3' marks a DIFFERENT day than a named UTC+3 zone, and the day UTC−3 would give", async () => {
    // THE measurement the whole guard rests on, executed instead of asserted in prose.
    //
    // Postgres reads a bare offset with the POSIX sign convention, so '+3' means UTC−3. Both runs
    // return a complete, plausible grid with exactly one mark. Nothing on the page says which of
    // them is six hours out — which is why this has to be refused before the query runs.
    const east = await rowFor(EAST);
    const plus3 = await rowFor('+3');
    const west = await rowFor(MINUS_THREE);

    expect(markedDays(east)).toEqual([D_EAST]);
    expect(markedDays(plus3)).toEqual([D_WEST]);

    // Different days — the inversion is real and visible in the report's own output.
    expect(markedDays(plus3)).not.toEqual(markedDays(east));

    // ...and '+3' lands exactly where a NAMED UTC−3 zone lands. This is the half that names the
    // direction: without it the test only shows the two disagree, not which way round.
    expect(markedDays(plus3)).toEqual(markedDays(west));

    // Both runs are otherwise a normal, complete grid. The defect is silent, not partial.
    expect(plus3.lab).toBe(LAB);
    expect(Object.keys(plus3).filter((k) => /^d\d\d$/.test(k))).toHaveLength(23);
  });

  it("⛔ 'Etc/GMT+3' inverts identically — the case the SETTING used to accept", async () => {
    // `Intl.DateTimeFormat` resolves this name, so the setting's IANA check stored it happily until
    // this slice. It is a fixed offset wearing an IANA-shaped name, and IANA defines it as UTC−3.
    const etc = await rowFor('Etc/GMT+3');
    const plus3 = await rowFor('+3');
    const east = await rowFor(EAST);

    expect(markedDays(etc)).toEqual([D_WEST]);
    expect(markedDays(etc)).toEqual(markedDays(plus3));
    expect(markedDays(etc)).not.toEqual(markedDays(east));
  });

  it("⛔ an unrecognised zone RAISES rather than returning wrong rows", async () => {
    // The fact the narrow run-parameter rule rests on, and until now the only one asserted purely
    // in prose. A Windows zone name is refused by the engine at once, with the operator watching,
    // so no wrong number is ever produced — which is why `isSignedOffsetZone` deliberately does NOT
    // widen to "everything the runtime cannot resolve". If this ever started returning rows
    // instead, that whole decision would need revisiting.
    await expect(rowFor('E. Africa Standard Time')).rejects.toThrow(/not recognized/i);
    await expect(rowFor('Not/A_Zone')).rejects.toThrow(/not recognized/i);
  });

  it('the guards refuse exactly the values measured above as silently wrong', async () => {
    // Ties the live measurement to the code it justifies, in one file. Without this the three
    // tests above would still pass after someone deleted the guard.
    for (const bad of ['+3', 'Etc/GMT+3']) {
      expect(paramFormatMessage('tz', 'timezone-no-signed-offset', bad), `run param ${bad}`).not.toBeNull();
      expect(isValidIanaZone(bad), `setting ${bad}`).toBe(false);
    }
    // ...and the two zones that produced correct, explicable output are both still accepted.
    for (const good of [EAST, MINUS_THREE]) {
      expect(paramFormatMessage('tz', 'timezone-no-signed-offset', good)).toBeNull();
      expect(isValidIanaZone(good)).toBe(true);
    }
    // The LOUD value stays accepted by the run-parameter rule on purpose — the engine owns it.
    expect(paramFormatMessage('tz', 'timezone-no-signed-offset', 'E. Africa Standard Time')).toBeNull();
  });
});
