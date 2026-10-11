import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDbWithMem } from '../../test-helpers-external';
import { collectCompiledSql } from './compile-test-helpers';
import * as m022 from './022_questionnaire_response_based_on_index';

// Same two harnesses as 017's test. pg-mem's listIndices() checks the index on the emulated
// Postgres. The MySQL and MSSQL statements are checked offline against Kysely's real compilers.
describe('022_questionnaire_response_based_on_index', () => {
  it('creates the based_on_id index after up', async () => {
    const { mem } = await makeMigratedExternalDbWithMem();
    const names = mem.public.getTable('questionnaire_responses').listIndices().map((idx) => idx.name);
    expect(names).toContain('questionnaire_responses_based_on_idx');
  });

  it('down() drops the index', async () => {
    const { mem, db } = await makeMigratedExternalDbWithMem();

    await m022.down(db, 'postgres');

    const names = mem.public.getTable('questionnaire_responses').listIndices().map((idx) => idx.name);
    expect(names).not.toContain('questionnaire_responses_based_on_idx');
  });

  it('up() widens based_on_id on MySQL and MSSQL before indexing it, and not on Postgres', async () => {
    expect(await collectCompiledSql('mysql', (db) => m022.up(db, 'mysql'))).toEqual([
      'alter table `questionnaire_responses` modify column `based_on_id` varchar(255)',
      'create index `questionnaire_responses_based_on_idx` on `questionnaire_responses` (`based_on_id`)',
    ]);
    expect(await collectCompiledSql('mssql', (db) => m022.up(db, 'mssql'))).toEqual([
      'alter table "questionnaire_responses" alter column "based_on_id" varchar(450)',
      'create index "questionnaire_responses_based_on_idx" on "questionnaire_responses" ("based_on_id")',
    ]);
    expect(await collectCompiledSql('postgres', (db) => m022.up(db, 'postgres'))).toEqual([
      'create index "questionnaire_responses_based_on_idx" on "questionnaire_responses" ("based_on_id")',
    ]);
  });

  it('down() calls dropIndex().on() for MySQL and MSSQL, and omits it for Postgres', async () => {
    expect(await collectCompiledSql('mysql', (db) => m022.down(db, 'mysql'))).toEqual([
      'drop index `questionnaire_responses_based_on_idx` on `questionnaire_responses`',
    ]);
    expect(await collectCompiledSql('mssql', (db) => m022.down(db, 'mssql'))).toEqual([
      'drop index "questionnaire_responses_based_on_idx" on "questionnaire_responses"',
    ]);
    expect(await collectCompiledSql('postgres', (db) => m022.down(db, 'postgres'))).toEqual([
      'drop index "questionnaire_responses_based_on_idx"',
    ]);
  });
});
