import { describe, it, expect } from 'vitest';
import { type Kysely } from 'kysely';
// ⛔ Migrated only as far as this migration's own era. Migration 088 drops `local_code`,
// `national_code` and `national_system`; this migration predates that and reads them. Running
// the FULL list first would test it against a schema that never existed when it shipped.
import { makeMigratedDbUpTo } from './test-helpers';
import type { InternalSchema } from '../../schema/internal';
import { FACILITY_REGISTER_STATE_VS, backfillRegisterState } from './081_facility_source_and_register_state';

describe('081 facility source + register state', () => {
  it('adds kind/jurisdiction/contact to coding_systems', async () => {
    const db = (await makeMigratedDbUpTo('081_facility_source_and_register_state')) as Kysely<InternalSchema>;
    await db.insertInto('coding_systems').values({
      id: 'cs-x', system_code: 'X', system_name: 'X', url: 'urn:x',
      kind: 'facility-register', jurisdiction: 'TZ', contact: 'moh@example.tz',
    } as never).execute();
    const row = await db.selectFrom('coding_systems').selectAll()
      .where('id', '=', 'cs-x').executeTakeFirstOrThrow() as never as
      { kind: string | null; jurisdiction: string | null; contact: string | null };
    expect(row.kind).toBe('facility-register');
    expect(row.jurisdiction).toBe('TZ');
    expect(row.contact).toBe('moh@example.tz');
  });

  it('adds register_state defaulting to not_registered', async () => {
    const db = (await makeMigratedDbUpTo('081_facility_source_and_register_state')) as Kysely<InternalSchema>;
    await db.insertInto('facility_registry').values({
      id: 'f1', name: 'Alpha', local_code: 'L1', source: 'manual',
    } as never).execute();
    const row = await db.selectFrom('facility_registry').select('register_state' as never)
      .where('id', '=', 'f1').executeTakeFirstOrThrow() as { register_state: string };
    expect(row.register_state).toBe('not_registered');
  });

  // ⛔ RESOLUTION of a brief defect (see .superpowers/sdd/b1-task-1-report.md): the brief's original
  // version of this test seeded an imported row and a manual row AFTER makeMigratedDbUpTo('081_facility_source_and_register_state') — but
  // makeMigratedDbUpTo('081_facility_source_and_register_state') runs every migration (including this one) FIRST, so both rows land on the
  // column DEFAULT ('not_registered') and never reach up()'s inline backfill UPDATE. Asserting only
  // the manual row's state (as the brief did) is an assertion that cannot fail: breaking the backfill
  // entirely would leave it green. backfillRegisterState() is exported specifically so this test can
  // invoke the real backfill logic directly, against rows that are demonstrably still at the default
  // beforehand — making the mutation in Step 6 (b1-task-1-report.md) a real, falsifiable check.
  it('backfillRegisterState moves an imported row to in_register and leaves a manual row at not_registered', async () => {
    const db = (await makeMigratedDbUpTo('081_facility_source_and_register_state')) as Kysely<InternalSchema>;
    await db.insertInto('facility_registry').values([
      { id: 'f-imp', name: 'Imported', national_system: 'urn:tz:hfr', national_code: '100', source: 'import' },
      { id: 'f-man', name: 'Manual', local_code: 'L2', source: 'manual' },
    ] as never).execute();

    // Both rows are still at the column DEFAULT here — up()'s backfill already ran, before either
    // row existed. If this assertion ever goes red, the "before" half of the mutation-proof is gone.
    const before = await db.selectFrom('facility_registry')
      .select(['id', 'register_state'] as never).orderBy('id' as never).execute() as
      { id: string; register_state: string }[];
    expect(before.find((r) => r.id === 'f-imp')?.register_state).toBe('not_registered');
    expect(before.find((r) => r.id === 'f-man')?.register_state).toBe('not_registered');

    await backfillRegisterState(db);

    const rows = await db.selectFrom('facility_registry')
      .select(['id', 'register_state'] as never).orderBy('id' as never).execute() as
      { id: string; register_state: string }[];
    expect(rows.find((r) => r.id === 'f-imp')?.register_state).toBe('in_register');
    expect(rows.find((r) => r.id === 'f-man')?.register_state).toBe('not_registered');
  });

  // ⛔ CORRECTION to the brief: its Step 1 test queried a `value_set_codes` table, which does not
  // exist anywhere in this schema (verified: no migration creates it, packages/db/src/schema/
  // internal.ts has no such interface). The real table — the one 072_facility_level_status_
  // valuesets.ts and 069_result_role_valuesets.ts both use — is `valueset_expansions`, keyed by
  // `value_set_id`. Querying the nonexistent table would have failed at the DB driver level, not as
  // a meaningful assertion failure.
  it('seeds the register-state valueset with exactly three codes', async () => {
    const db = (await makeMigratedDbUpTo('081_facility_source_and_register_state')) as Kysely<InternalSchema>;
    const vs = await db.selectFrom('value_sets').selectAll()
      .where('url', '=', FACILITY_REGISTER_STATE_VS).executeTakeFirstOrThrow();
    const codes = await db.selectFrom('valueset_expansions').select('code')
      .where('value_set_id', '=', vs.id).execute();
    expect(codes.map((c) => c.code).sort()).toEqual(['dropped', 'in_register', 'not_registered']);
  });
});
