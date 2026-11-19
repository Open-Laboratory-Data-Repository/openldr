import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from './schema/internal';
import * as held from './migrations/internal/119_import_check_held';
import * as corrections from './migrations/internal/124_import_check_corrections';
import * as codes from './migrations/internal/128_import_check_held_codes';
import { createImportCheckHeldStore } from './import-check-held-store';

// demo.4 item 10: the Held back filter by finding code and its counts use a subquery and a group by
// that pg-mem accepts loosely. Only real PostgreSQL proves the SQL. Run with
// HELD_CODES_TEST_DATABASE_URL pointing at a disposable database.
const url = process.env.HELD_CODES_TEST_DATABASE_URL;
describe.skipIf(!url)('held finding codes on disposable PostgreSQL', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: Kysely<InternalSchema>;
  let schema: string;

  beforeEach(async () => {
    schema = `held_codes_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool }) });
    for (const m of [held, corrections, codes]) await m.up(db as Kysely<unknown>);
  });

  afterEach(async () => {
    await db.destroy();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });

  it('filters, pages by key and counts by code, and the codes go with their row', async () => {
    const store = createImportCheckHeldStore(db);
    const item = (key: string, over: Record<string, unknown> = {}) => ({
      copyId: 'c1', key, runId: 'r1', reason: 'held' as const, label: null, laboratory: null, error: null, findings: [], check: null, ...over,
    });
    await store.put(item('A', { laboratory: 'L1', codes: ['specimen_missing'] }));
    await store.put(item('B', { laboratory: 'L1', codes: ['specimen_missing', 'record_has_no_observations'] }));
    await store.put(item('C', { laboratory: 'L2', codes: ['record_has_no_observations'] }));
    expect((await store.list('c1', { finding: 'specimen_missing', offset: 0, limit: 10 })).rows.map((r) => r.key)).toEqual(['A', 'B']);
    expect((await store.listItems('c1', { finding: 'specimen_missing', after: 'A', limit: 10 })).rows.map((r) => r.key)).toEqual(['B']);
    expect(await store.codes('c1', { laboratory: 'L1' })).toEqual([{ code: 'specimen_missing', count: 2 }, { code: 'record_has_no_observations', count: 1 }]);
    await store.remove('c1', ['B']);
    expect(await store.codes('c1', {})).toEqual([{ code: 'record_has_no_observations', count: 1 }, { code: 'specimen_missing', count: 1 }]);
  });
});
