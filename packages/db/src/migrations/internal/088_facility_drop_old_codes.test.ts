import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from './test-helpers';

const row = (over: Record<string, unknown>) => ({ name: 'A', source: 'manual', ...over });

describe('088_facility_drop_old_codes', () => {
  it('the deprecated columns are gone', async () => {
    const db = await makeMigratedDb();
    const cols = await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_name = 'facility_registry'`.execute(db);
    const names = cols.rows.map((r) => r.column_name);
    expect(names).not.toContain('local_code');
    expect(names).not.toContain('national_code');
    expect(names).not.toContain('national_system');
    expect(names).toContain('facility_code');
    expect(names).toContain('facility_system');
    await db.destroy();
  });

  it('a row can be written with the new pair alone', async () => {
    // The old `facility_registry_has_a_code` CHECK refused exactly this — it asserted a value in
    // columns that no longer exist. Measured during the live check: an insert carrying only the new
    // pair was refused with 23514 while that constraint was still in force.
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never)
      .values(row({ id: 'f1', facility_system: 'urn:zm:mfl', facility_code: '1835' }) as never).execute();
    const r: any = await (db as any).selectFrom('facility_registry').selectAll()
      .where('id', '=', 'f1').executeTakeFirstOrThrow();
    expect(r.facility_code).toBe('1835');
    await db.destroy();
  });

  it('⛔ refuses two facilities sharing a code within one register', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never)
      .values(row({ id: 'f1', facility_system: 'urn:zm:mfl', facility_code: '1835' }) as never).execute();
    await expect(
      db.insertInto('facility_registry' as never)
        .values(row({ id: 'f2', facility_system: 'urn:zm:mfl', facility_code: '1835' }) as never).execute(),
    ).rejects.toThrow();
    await db.destroy();
  });

  it('allows the same code under a DIFFERENT register', async () => {
    // `facility_code` is unique per register, never globally — two national lists can and do use the
    // same numbering.
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never)
      .values(row({ id: 'f1', facility_system: 'urn:zm:mfl', facility_code: '1835' }) as never).execute();
    await db.insertInto('facility_registry' as never)
      .values(row({ id: 'f2', facility_system: 'urn:tz:hfr', facility_code: '1835' }) as never).execute();
    const n = await db.selectFrom('facility_registry' as never).selectAll().execute();
    expect(n).toHaveLength(2);
    await db.destroy();
  });

  it('⛔ still refuses two REGISTERLESS facilities sharing a code', async () => {
    // `local_code` carried its own UNIQUE constraint, and dropping the column would have taken that
    // guarantee with it — a partial index over the registerless rows replaces it.
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never)
      .values(row({ id: 'f1', facility_code: 'LAB01' }) as never).execute();
    await expect(
      db.insertInto('facility_registry' as never)
        .values(row({ id: 'f2', facility_code: 'LAB01' }) as never).execute(),
    ).rejects.toThrow();
    await db.destroy();
  });

  it('refuses a facility with no code at all', async () => {
    const db = await makeMigratedDb();
    await expect(
      db.insertInto('facility_registry' as never).values(row({ id: 'f1' }) as never).execute(),
    ).rejects.toThrow();
    await db.destroy();
  });
});
