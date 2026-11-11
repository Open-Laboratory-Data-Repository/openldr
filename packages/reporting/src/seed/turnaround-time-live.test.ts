import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, externalMigrations } from '@openldr/db';
import { SEED_QUERIES } from './report-seeds';

// Runs the shipped Postgres SQL against a throwaway database on TARGET_DATABASE_URL.
// Skipped when that variable is unset, like the other *-live tests here.
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

live('q-turnaround-time times each report from its own specimen (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_tat_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<Record<string, never>>;

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString() }) }) });
    const up = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    expect(up.error).toBeUndefined();
    // One patient, two viral loads a month apart. Each report is issued 24 hours after its own
    // specimen arrived.
    await db.insertInto('specimens' as never).values([
      { id: 'sp-sep', patient_id: 'p1', received_time: '2026-09-01T08:00:00Z' },
      { id: 'sp-oct', patient_id: 'p1', received_time: '2026-10-01T08:00:00Z' },
    ] as never).execute();
    await db.insertInto('diagnostic_reports' as never).values([
      { id: 'dr-sep', patient_id: 'p1', specimen_id: 'sp-sep', code_text: 'HIV viral load', issued: '2026-09-02T08:00:00Z' },
      { id: 'dr-oct', patient_id: 'p1', specimen_id: 'sp-oct', code_text: 'HIV viral load', issued: '2026-10-02T08:00:00Z' },
    ] as never).execute();
  });

  afterAll(async () => {
    await db?.destroy();
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.end();
  });

  it('reads 24 hours for both reports, not a month for the second', async () => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-turnaround-time')!.sql.postgres;
    const text = raw
      .replace(/\{\{\s*param\.from\s*\}\}/g, `'2026-09-01'`)
      .replace(/\{\{\s*param\.to\s*\}\}/g, `'2026-10-31'`)
      .replace(/\{\{\s*param\.facility\s*\}\}/g, `''`);
    const rows = (await sql.raw<Record<string, unknown>>(text).execute(db)).rows;
    expect(rows).toEqual([{ test: 'HIV viral load', count: 2, avgHours: 24, minHours: 24, maxHours: 24 }]);
  });
});
