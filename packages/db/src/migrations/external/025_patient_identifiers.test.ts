import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDbWithMem } from '../../test-helpers-external';
import { collectCompiledSql } from './compile-test-helpers';
import * as m025 from './025_patient_identifiers';

// pg-mem checks the table on emulated Postgres. MySQL and MSSQL are checked offline against Kysely's
// compilers, as in 023's test. Neither proves a real MSSQL or MySQL accepts it.
describe('025_patient_identifiers', () => {
  it('creates patient_identifiers with its columns and both indexes', async () => {
    const { mem } = await makeMigratedExternalDbWithMem();
    const table = mem.public.getTable('patient_identifiers');
    const columns = (table as unknown as { listColumns(): Array<{ id: string }> }).listColumns();
    expect(columns.map((c) => c.id).sort()).toEqual([
      'batch_id', 'created_at', 'id', 'patient_id', 'plugin_id', 'plugin_version', 'source_system',
      'system', 'type_code', 'type_text', 'use', 'value',
    ]);
    const indexes = table.listIndices().map((i) => i.name);
    expect(indexes).toContain('patient_identifiers_patient_idx');
    expect(indexes).toContain('patient_identifiers_system_value_idx');
  });

  it('down() drops the table', async () => {
    const { mem, db } = await makeMigratedExternalDbWithMem();
    await m025.down(db);
    expect(() => mem.public.getTable('patient_identifiers')).toThrow();
  });

  it('uses key-sized columns and utf8mb4 on MySQL, and key-sized columns on MSSQL', async () => {
    const mysql = await collectCompiledSql('mysql', (db) => m025.up(db, 'mysql'));
    expect(mysql[0]).toContain('`value` varchar(255) not null');
    expect(mysql[0]).toContain('`system` varchar(255)');
    expect(mysql[0]).toContain('character set utf8mb4');
    expect(mysql[2]).toBe('create index `patient_identifiers_system_value_idx` on `patient_identifiers` (`system`, `value`)');
    const mssql = await collectCompiledSql('mssql', (db) => m025.up(db, 'mssql'));
    expect(mssql[0]).toContain('"value" varchar(450) not null');
    expect(mssql[2]).toBe('create index "patient_identifiers_system_value_idx" on "patient_identifiers" ("system", "value")');
  });
});
