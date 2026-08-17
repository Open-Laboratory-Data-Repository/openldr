import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, externalMigrations } from '@openldr/db';
import { SEED_QUERIES } from './report-seeds';

// Runs only when TARGET_DATABASE_URL points at a live Postgres. The default hermetic `pnpm test`
// skips it. pg-mem cannot stand in: this asserts grouping and EXISTS behaviour over a multi-order
// shape, and pg-mem has no correlated-subquery support (AGENTS.md §7).
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

live('q-clinical-micro-ast resolves a lab number across orders (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_microast_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<Record<string, never>>;

  const runFor = async (param: string): Promise<Record<string, unknown>[]> => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-ast')!.sql.postgres;
    const text = raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'${param.replace(/'/g, "''")}'`);
    const res = await sql.raw<Record<string, unknown>>(text).execute(db);
    return res.rows;
  };

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString() }) }) });
    const up = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    expect(up.error).toBeUndefined();

    // The interpretation value set the query now gates on. `value_set_id` is a random-looking UUID
    // here on purpose — mirrors production, where the seed mints `vs-${randomUUID()}` and only the
    // URL is a stable, known key (RULE 0 finding, 2026-08-17: the query must not key on the id).
    for (const [code, display] of [['S', 'Susceptible'], ['I', 'Intermediate'], ['R', 'Resistant']]) {
      await db.insertInto('terminology_codes' as never).values({
        id: `vs-ast-${code}`,
        value_set_id: 'vs-11111111-2222-3333-4444-555555555555',
        value_set_url: 'urn:openldr:valueset:ast-interpretation',
        code,
        display,
      } as never).execute();
    }

    // LAB-MICRO — the real DISA shape: organism on one order, susceptibilities on another.
    await db.insertInto('specimens' as never).values({ id: 'spec-micro', type_text: 'Stools' } as never).execute();
    await db.insertInto('lab_requests' as never).values([
      { id: 'micro-obr1', request_id: 'LAB-MICRO', panel_code: 'MSTRS', panel_desc: 'MICROBIOLOGY : STOOL' },
      { id: 'micro-obr2', request_id: 'LAB-MICRO', panel_code: 'MSENS', panel_desc: 'Microbiology Sensitivity' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'm-org', request_id: 'micro-obr1', specimen_id: 'spec-micro', observation_code: 'ORGS', text_value: 'Shigella flexneri' },
      { id: 'm-amp', request_id: 'micro-obr2', specimen_id: 'spec-micro', observation_code: 'AMPIC', observation_desc: 'Ampicillin', coded_value: 'R' },
      { id: 'm-cip', request_id: 'micro-obr2', specimen_id: 'spec-micro', observation_code: 'CIPRO', observation_desc: 'Ciprofloxacin', coded_value: 'S' },
      // Microscopy on the culture order: coded, but NOT a susceptibility interpretation.
      { id: 'm-pus', request_id: 'micro-obr1', specimen_id: 'spec-micro', observation_code: 'PUS', observation_desc: 'Pus cells', coded_value: '+++' },
    ] as never).execute();

    // LAB-CHEM — a chemistry lab number. No organism anywhere. abnormal_flag is set, which is what
    // the old `is not null` filter let through.
    await db.insertInto('lab_requests' as never).values([
      { id: 'chem-obr1', request_id: 'LAB-CHEM', panel_code: 'LFT', panel_desc: 'Liver Function' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'c-alt', request_id: 'chem-obr1', observation_code: 'ALT', observation_desc: 'ALT', abnormal_flag: 'H' },
    ] as never).execute();

    // LAB-EQA — an EQA proficiency panel. Real S/I/R values, no isolate. 87% of S/I/R rows in the
    // live warehouse are these, and they are 100% R by design.
    await db.insertInto('lab_requests' as never).values([
      { id: 'eqa-obr1', request_id: 'LAB-EQA', panel_code: 'EQSS1', panel_desc: 'HIV Rapid EQA Test 1' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'e-1', request_id: 'eqa-obr1', observation_code: 'EQSS1', observation_desc: 'A-1', coded_value: 'R' },
    ] as never).execute();
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
    await admin
      .query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName])
      .catch(() => undefined);
    await admin.query(`drop database if exists "${dbName}"`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it('returns the susceptibilities when given the LAB NUMBER, not an order id', async () => {
    const rows = await runFor('LAB-MICRO');
    expect(rows.map((r) => r.test).sort()).toEqual(['Ampicillin', 'Ciprofloxacin']);
  });

  it('still works when given a per-order id', async () => {
    const rows = await runFor('micro-obr2');
    expect(rows.map((r) => r.test).sort()).toEqual(['Ampicillin', 'Ciprofloxacin']);
  });

  it('resolves the interpretation display from terminology', async () => {
    const rows = await runFor('LAB-MICRO');
    const amp = rows.find((r) => r.test === 'Ampicillin');
    expect(amp?.result).toBe('Resistant');
    expect(amp?.status).toBe('abnormal');
  });

  it('leaves microscopy off the susceptibility table', async () => {
    // Pus cells sit on the culture order and are coded. Widening to the lab number would pull them
    // in were it not for the value-set gate.
    const rows = await runFor('LAB-MICRO');
    expect(rows.map((r) => r.test)).not.toContain('Pus cells');
  });

  it('returns nothing for a chemistry lab number', async () => {
    expect(await runFor('LAB-CHEM')).toHaveLength(0);
  });

  it('returns nothing for an EQA panel — S/I/R without an isolate is not a susceptibility', async () => {
    expect(await runFor('LAB-EQA')).toHaveLength(0);
  });
});
