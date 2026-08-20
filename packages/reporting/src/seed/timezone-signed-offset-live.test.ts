import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { isValidIanaZone, paramFormatMessage } from '@openldr/core/pure';

/**
 * Why this file exists.
 *
 * Two guards refuse a signed-offset time zone: `paramFormatMessage`'s
 * `timezone-no-signed-offset` rule for a report RUN PARAMETER, and `isValidIanaZone` for the
 * `lab.timezone` SETTING (`packages/config/src/lab-identity.ts:138`). Every justification either
 * one carries is a MEASUREMENT written into a comment: `+3` means UTC−3, `Etc/GMT+3` means the
 * same, an unrecognised name errors instead of returning wrong rows.
 *
 * A comment cannot fail. If Postgres ever changed how it reads that sign, both guards would
 * quietly become pointless and every comment would still assert they were needed. This file makes
 * the three measurements executable.
 *
 * ⛔ It used to make them through `q-transmission-hvleid`, whose `tz` run parameter the guard
 * protected. That parameter is GONE: `7975cdc5` dropped it when both grids moved to clinical-date
 * bucketing, and `report-seeds.test.ts` now asserts `{{param.tz}}` and `at time zone` appear
 * nowhere in either query and that the declared parameters are exactly `month` and `panels`.
 * Repairing this file's fixture was tried first and does not work: with no zone reaching the SQL
 * every run marks the same day, so `'+3'` and a named UTC+3 zone come back IDENTICAL and the
 * inversion the file exists to show cannot be observed there any more. The measurement is now made
 * against Postgres itself, which is the layer the fact actually belongs to.
 *
 * It therefore seeds nothing, creates no database and writes nothing. Three `select`s and a drop of
 * the throwaway database that used to be provisioned for them.
 *
 * ⛔ pg-mem cannot stand in (AGENTS.md §7). `at time zone` against a zone-NAME string is exactly
 * what is under test, and pg-mem does not implement it.
 *
 * It stays in `@openldr/reporting` because this is where the live-Postgres harness pattern lives.
 * `@openldr/core`, which owns both guards, has no database reach and no `pg` dependency.
 */
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

// 01:30Z, inside the first three hours of a UTC day. That is what makes two zones three hours apart
// disagree about which DAY it was. A mid-afternoon instant is the same calendar day at UTC±3 and
// would leave every assertion below passing with both guards deleted; that mistake was made once
// already in this arc.
const INSTANT = '2026-03-03T01:30:00Z';
const EAST = 'Africa/Dar_es_Salaam';                  // UTC+03:00 all year, no DST.
const MINUS_THREE = 'America/Argentina/Buenos_Aires'; // UTC−03:00 all year, no DST.

live('a signed-offset time zone is read backwards by Postgres (live Postgres)', () => {
  const pool = new pg.Pool({ connectionString: url });

  afterAll(async () => { await pool.end(); });

  /** The calendar DAY `INSTANT` falls on when read in `zone`, the bucket any report would use.
   *  Read-only: one `select`, no table, nothing written. */
  const dayIn = async (zone: string): Promise<string> => {
    const res = await pool.query(
      `select to_char((timestamptz '${INSTANT}' at time zone '${zone.replace(/'/g, "''")}')::date, 'YYYY-MM-DD') as d`,
    );
    return res.rows[0].d as string;
  };

  it("⛔ '+3' lands on a DIFFERENT day than a named UTC+3 zone, and on the day UTC−3 gives", async () => {
    // THE measurement both guards rest on, executed instead of asserted in prose. Postgres reads a
    // bare offset with the POSIX sign convention, so '+3' means UTC−3. Both readings are complete
    // and plausible; nothing anywhere says which of them is six hours out, which is why this has to
    // be refused before a query runs rather than caught after one.
    const east = await dayIn(EAST);
    const plus3 = await dayIn('+3');
    const west = await dayIn(MINUS_THREE);

    expect(east).toBe('2026-03-03');
    expect(plus3).toBe('2026-03-02');

    // Different days, so the inversion is real.
    expect(plus3).not.toBe(east);
    // ...and '+3' lands exactly where a NAMED UTC−3 zone lands. This is the half that names the
    // direction: without it the test only shows the two disagree, not which way round.
    expect(plus3).toBe(west);
  });

  it("⛔ 'Etc/GMT+3' inverts identically, the case the SETTING used to accept", async () => {
    // `Intl.DateTimeFormat` resolves this name, so the setting's IANA check stored it happily until
    // the slice that added `isSignedOffsetZone`. It is a fixed offset wearing an IANA-shaped name,
    // and IANA defines it as UTC−3.
    expect(await dayIn('Etc/GMT+3')).toBe('2026-03-02');
    expect(await dayIn('Etc/GMT+3')).toBe(await dayIn('+3'));
    expect(await dayIn('Etc/GMT+3')).not.toBe(await dayIn(EAST));
  });

  it('⛔ an unrecognised zone RAISES rather than returning a wrong day', async () => {
    // The fact the narrower run-parameter rule rests on. A Windows zone name is refused by the
    // engine at once, with the operator watching, so no wrong number is ever produced, which is
    // why `isSignedOffsetZone` deliberately does NOT widen to "everything the runtime cannot
    // resolve". If this ever started returning a day instead, that decision needs revisiting.
    await expect(dayIn('E. Africa Standard Time')).rejects.toThrow(/not recognized/i);
    await expect(dayIn('Not/A_Zone')).rejects.toThrow(/not recognized/i);
  });

  it('the guards refuse exactly the values measured above as silently wrong', async () => {
    // Ties the live measurement to the code it justifies, in one file. Without this the three tests
    // above would still pass after someone deleted both guards.
    for (const bad of ['+3', 'Etc/GMT+3']) {
      expect(paramFormatMessage('tz', 'timezone-no-signed-offset', bad), `run param ${bad}`).not.toBeNull();
      expect(isValidIanaZone(bad), `setting ${bad}`).toBe(false);
    }
    // ...and the two zones that produced correct, explicable output are both still accepted.
    for (const good of [EAST, MINUS_THREE]) {
      expect(paramFormatMessage('tz', 'timezone-no-signed-offset', good)).toBeNull();
      expect(isValidIanaZone(good)).toBe(true);
    }
    // The LOUD value stays accepted by the run-parameter rule on purpose. The engine owns it.
    expect(paramFormatMessage('tz', 'timezone-no-signed-offset', 'E. Africa Standard Time')).toBeNull();
  });
});
