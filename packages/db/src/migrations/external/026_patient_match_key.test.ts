import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDbWithMem } from '../../test-helpers-external';
import { collectCompiledSql } from './compile-test-helpers';
import * as m026 from './026_patient_match_key';

// pg-mem checks the column on emulated Postgres. MySQL and MSSQL are checked offline against Kysely's
// compilers. Neither proves a real MySQL or SQL Server accepts it.
describe('026_patient_match_key', () => {
  it('adds match_key to patients with an index', async () => {
    const { mem } = await makeMigratedExternalDbWithMem();
    const table = mem.public.getTable('patients');
    const columns = (table as unknown as { listColumns(): Array<{ id: string }> }).listColumns().map((c) => c.id);
    expect(columns).toContain('match_key');
    expect(table.listIndices().map((i) => i.name)).toContain('patients_match_key_idx');
  });

  it('down() drops the column', async () => {
    const { mem, db } = await makeMigratedExternalDbWithMem();
    await m026.down(db);
    const columns = (mem.public.getTable('patients') as unknown as { listColumns(): Array<{ id: string }> }).listColumns().map((c) => c.id);
    expect(columns).not.toContain('match_key');
  });

  it('uses a key-sized column on MySQL and MSSQL', async () => {
    const mysql = await collectCompiledSql('mysql', (db) => m026.up(db, 'mysql'));
    expect(mysql[0]).toBe('alter table `patients` add column `match_key` varchar(255)');
    expect(mysql[1]).toBe('create index `patients_match_key_idx` on `patients` (`match_key`)');
    const mssql = await collectCompiledSql('mssql', (db) => m026.up(db, 'mssql'));
    expect(mssql[0]).toBe('alter table "patients" add "match_key" varchar(450)');
    expect(mssql[1]).toBe('create index "patients_match_key_idx" on "patients" ("match_key")');
  });

  it('down() drops the index with ON for MySQL and MSSQL, without it for Postgres', async () => {
    expect((await collectCompiledSql('mysql', (db) => m026.down(db, 'mysql')))[0]).toBe('drop index `patients_match_key_idx` on `patients`');
    expect((await collectCompiledSql('mssql', (db) => m026.down(db, 'mssql')))[0]).toBe('drop index "patients_match_key_idx" on "patients"');
    expect((await collectCompiledSql('postgres', (db) => m026.down(db, 'postgres')))[0]).toBe('drop index "patients_match_key_idx"');
  });
});
