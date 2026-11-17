import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDbWithMem } from '../../test-helpers-external';
import { collectCompiledSql } from './compile-test-helpers';
import * as m027 from './027_lab_request_age_estimate';

// pg-mem checks the column on emulated Postgres. MySQL and MSSQL are checked offline against Kysely's
// compilers. Neither proves a real MySQL or SQL Server accepts it.
describe('027_lab_request_age_estimate', () => {
  const columnsOf = (mem: Awaited<ReturnType<typeof makeMigratedExternalDbWithMem>>['mem']) =>
    (mem.public.getTable('lab_requests') as unknown as { listColumns(): Array<{ id: string }> }).listColumns().map((c) => c.id);

  it('adds a nullable age_days_estimated to lab_requests', async () => {
    const { mem } = await makeMigratedExternalDbWithMem();
    expect(columnsOf(mem)).toContain('age_days_estimated');
  });

  it('down() drops the column', async () => {
    const { mem, db } = await makeMigratedExternalDbWithMem();
    await m027.down(db);
    expect(columnsOf(mem)).not.toContain('age_days_estimated');
  });

  it('uses boolean on MySQL and bit on MSSQL', async () => {
    expect((await collectCompiledSql('mysql', (db) => m027.up(db, 'mysql')))[0]).toBe('alter table `lab_requests` add column `age_days_estimated` boolean');
    expect((await collectCompiledSql('mssql', (db) => m027.up(db, 'mssql')))[0]).toBe('alter table "lab_requests" add "age_days_estimated" bit');
  });
});
