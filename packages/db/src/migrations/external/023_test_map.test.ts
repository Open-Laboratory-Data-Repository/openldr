import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDbWithMem } from '../../test-helpers-external';
import { collectCompiledSql } from './compile-test-helpers';
import * as m023 from './023_test_map';

// pg-mem checks the table on emulated Postgres. MySQL and MSSQL are checked offline against Kysely's
// real compilers, as in 022's test. Neither proves a real MSSQL or MySQL accepts it.
describe('023_test_map', () => {
  it('creates test_map with its columns and the source index', async () => {
    const { mem } = await makeMigratedExternalDbWithMem();
    const table = mem.public.getTable('test_map');
    // listColumns() exists at runtime but is missing from pg-mem's IMemoryTable typing.
    const columns = (table as unknown as { listColumns(): Array<{ id: string }> }).listColumns();
    expect(columns.map((c) => c.id).sort()).toEqual(
      ['catalog_code', 'catalog_name', 'category', 'id', 'level', 'loinc', 'source_code', 'source_system', 'updated_at'],
    );
    expect(table.listIndices().map((i) => i.name)).toContain('test_map_source_idx');
  });

  it('down() drops the table', async () => {
    const { mem, db } = await makeMigratedExternalDbWithMem();
    await m023.down(db);
    expect(() => mem.public.getTable('test_map')).toThrow();
  });

  it('uses key-sized columns on MySQL and MSSQL, and utf8mb4 on MySQL', async () => {
    const mysql = await collectCompiledSql('mysql', (db) => m023.up(db, 'mysql'));
    expect(mysql[0]).toContain('`level` varchar(255) not null');
    expect(mysql[0]).toContain('character set utf8mb4');
    expect(mysql[1]).toBe('create index `test_map_source_idx` on `test_map` (`level`, `source_system`, `source_code`)');
    const mssql = await collectCompiledSql('mssql', (db) => m023.up(db, 'mssql'));
    expect(mssql[0]).toContain('"source_code" varchar(450) not null');
    expect(mssql[1]).toBe('create index "test_map_source_idx" on "test_map" ("level", "source_system", "source_code")');
  });
});
