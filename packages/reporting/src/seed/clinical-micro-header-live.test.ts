import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, externalMigrations } from '@openldr/db';
import { SEED_QUERIES } from './report-seeds';

// The performing-lab resolution is SEMANTIC — a fallback ladder, a join guard and a string
// composition. Task 1's tests are regexes over the SQL text and cannot distinguish "reads right"
// from "returns right": a query can match every pattern and still yield NULL for every row.
//
// Runs only when TARGET_DATABASE_URL points at a live Postgres (the migrated dev target DB); the
// default hermetic `pnpm test` skips it. It provisions its OWN throwaway database, so it never
// touches the shared dev warehouse — same pattern as external/reset-roundtrip-live.test.ts.
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

live('q-clinical-micro-header resolves the performing laboratory (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_perflab_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<Record<string, never>>;

  // `substituteParams` inlines a QUOTED STRING LITERAL, it does not bind a placeholder
  // (packages/dashboards/src/custom-query-run.ts). Mirror that exactly, or this test would prove
  // something the runtime never executes.
  const runFor = async (requestId: string): Promise<Record<string, unknown> | undefined> => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const text = raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'${requestId.replace(/'/g, "''")}'`);
    // `sql.raw` is itself generic (`raw<R = unknown>(anySql: string): RawBuilder<R>`); the
    // `sql<T>.raw(...)` shape in the brief parses as an instantiation expression followed by a
    // property access, which TS 5.x rejects (TS1477). Same runtime behaviour, valid syntax.
    const res = await sql.raw<Record<string, unknown>>(text).execute(db);
    return res.rows[0];
  };

  // One request -> one lab_result -> one specimen -> one diagnostic_report naming `code`.
  const seedRequest = async (
    requestId: string, code: string, display: string | null, sourceSystem: string | null,
  ): Promise<void> => {
    const specimenId = `spec-${requestId}`;
    await db.insertInto('specimens' as never).values({
      id: specimenId, type_text: 'Blood', received_time: '2026-01-02T03:04:05Z',
    } as never).execute();
    await db.insertInto('lab_requests' as never).values({
      id: requestId, request_id: `LAB-${requestId}`, panel_desc: 'Culture',
    } as never).execute();
    await db.insertInto('lab_results' as never).values({
      id: `res-${requestId}`, request_id: requestId, specimen_id: specimenId,
      observation_code: '634-6', text_value: 'Klebsiella pneumoniae',
    } as never).execute();
    await db.insertInto('diagnostic_reports' as never).values({
      id: `dr-${requestId}`, specimen_id: specimenId, performer: code,
      performer_display: display, source_system: sourceSystem,
    } as never).execute();
  };

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString() }) }) });
    const up = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    expect(up.error).toBeUndefined();

    // MAPPED: facility_map resolves the name and the location.
    await db.insertInto('facility_map' as never).values({
      id: 'feed|MAPPED', source_system: 'feed', source_code: 'MAPPED',
      name: 'National Public Health Laboratory', region: 'Dar es Salaam', district: 'Ubungo',
      resolved_via: 'registry',
    } as never).execute();
    // ...and `facilities` disagrees, holding the address lines BAGAE really carries. The curated
    // row must win, or a PO box prints on a clinical report.
    await db.insertInto('facilities' as never).values({
      id: 'fa-mapped', facility_code: 'MAPPED', facility_name: 'NHLQATC', source_system: 'feed',
      region: '2448 Luthuli Street/Sokoine', district: 'P.O.Box 9083',
    } as never).execute();

    // UNMAPPED but located: facility_map row exists with name NULL (what an unmapped facility
    // actually looks like — not a missing row), location comes from `facilities`.
    await db.insertInto('facility_map' as never).values({
      id: 'feed|UNMAPPED', source_system: 'feed', source_code: 'UNMAPPED',
    } as never).execute();
    await db.insertInto('facilities' as never).values({
      id: 'fa-unmapped', facility_code: 'UNMAPPED', facility_name: 'Mnazi Mmoja',
      source_system: 'feed', region: 'Dar es Salaam', district: 'Ilala',
    } as never).execute();

    // REGION-ONLY: no district anywhere, so no stray comma may appear.
    await db.insertInto('facilities' as never).values({
      id: 'fa-regiononly', facility_code: 'REGIONONLY', facility_name: 'Korogwe',
      source_system: 'feed', region: 'Tanga',
    } as never).execute();

    // NULLFEED: the facility_map row was built with '' because the resolver folds NULL -> ''.
    await db.insertInto('facility_map' as never).values({
      id: '|NULLFEED', source_system: '', source_code: 'NULLFEED', name: 'Folded Feed Laboratory',
    } as never).execute();

    // TWINNED: one facility that legitimately arrives as TWO `facilities` rows — `facilities.id` is
    // the raw FHIR resource id and BOTH an Organization and a Location resource project into this
    // table, so they share (source_system, facility_code) but have different ids and
    // source_resource. Different region/district on each row makes a fan-out observable rather than
    // coincidentally identical.
    await db.insertInto('facilities' as never).values({
      id: 'fa-twinned-org', facility_code: 'TWINNED', facility_name: 'Twinned Lab',
      source_system: 'feed', source_resource: 'Organization',
      region: 'Dodoma', district: 'Dodoma Urban',
    } as never).execute();
    await db.insertInto('facilities' as never).values({
      id: 'fa-twinned-loc', facility_code: 'TWINNED', facility_name: 'Twinned Lab',
      source_system: 'feed', source_resource: 'Location',
      region: 'Singida', district: 'Singida Urban',
    } as never).execute();

    await seedRequest('req-mapped', 'MAPPED', 'NHLQATC', 'feed');
    await seedRequest('req-unmapped', 'UNMAPPED', 'Mnazi Mmoja', 'feed');
    await seedRequest('req-regiononly', 'REGIONONLY', 'Korogwe', 'feed');
    await seedRequest('req-nodisplay', 'NODISPLAY', null, 'feed');
    await seedRequest('req-nullfeed', 'NULLFEED', 'Wire Name', null);
    await seedRequest('req-twinned', 'TWINNED', 'Twinned Lab', 'feed');

    // A request whose specimen has NO diagnostic_report at all.
    await db.insertInto('specimens' as never).values({ id: 'spec-bare', type_text: 'Urine' } as never).execute();
    await db.insertInto('lab_requests' as never).values({
      id: 'req-bare', request_id: 'LAB-bare', panel_desc: 'Culture',
    } as never).execute();
    await db.insertInto('lab_results' as never).values({
      id: 'res-bare', request_id: 'req-bare', specimen_id: 'spec-bare', observation_code: '634-6',
    } as never).execute();

    // The real DISA shape — organism on the culture order, susceptibilities on the sensitivity
    // order, both under one lab number sharing one specimen.
    // ⛔ `value_set_url` is what the query joins on, NOT `value_set_id`: the id is minted as
    // `vs-${randomUUID()}` at seed time, so a literal id matches zero rows in a real deployment.
    // Seeding only `value_set_id` here would leave `ast_source` empty and the panel would silently
    // fall back to the culture order — the assertion below would fail for the wrong reason.
    for (const [code, display] of [['S', 'Susceptible'], ['R', 'Resistant']]) {
      await db.insertInto('terminology_codes' as never).values({
        id: `vs-ast-${code}`,
        value_set_id: 'vs-11111111-2222-3333-4444-555555555555',
        value_set_url: 'urn:openldr:valueset:ast-interpretation',
        code,
        display,
      } as never).execute();
    }
    await db.insertInto('specimens' as never).values({
      id: 'spec-split', type_text: 'Stools', received_time: '2026-02-03T04:05:06Z',
    } as never).execute();
    await db.insertInto('lab_requests' as never).values([
      { id: 'split-obr1', request_id: 'LAB-SPLIT', panel_desc: 'MICROBIOLOGY : STOOL' },
      { id: 'split-obr2', request_id: 'LAB-SPLIT', panel_desc: 'Microbiology Sensitivity' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'sp-org', request_id: 'split-obr1', specimen_id: 'spec-split', observation_code: 'ORGS', text_value: 'Shigella flexneri' },
      { id: 'sp-amp', request_id: 'split-obr2', specimen_id: 'spec-split', observation_code: 'AMPIC', observation_desc: 'Ampicillin', coded_value: 'R' },
    ] as never).execute();

    // Culture only — an organism, no susceptibilities. 112 of 117 real micro lab numbers.
    await db.insertInto('specimens' as never).values({ id: 'spec-cult', type_text: 'Urine' } as never).execute();
    await db.insertInto('lab_requests' as never).values([
      { id: 'cult-obr1', request_id: 'LAB-CULT', panel_desc: 'Specimen Collection' },
      { id: 'cult-obr2', request_id: 'LAB-CULT', panel_desc: 'MICROBIOLOGY : URINE' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'cu-org', request_id: 'cult-obr2', specimen_id: 'spec-cult', observation_code: 'ORGS', text_value: 'Escherichia coli' },
    ] as never).execute();

    // POLYMICROBIAL — one lab number, two orders, two genuinely DIFFERENT organisms. The header
    // folds `organism` with max() across the lab number, so without a guard this prints whichever
    // sorts higher and the AST table merges both antibiograms beneath it, with no organism key
    // anywhere. A clinician would read one isolate's susceptibilities and get two.
    await db.insertInto('specimens' as never).values({ id: 'spec-poly', type_text: 'Wound swab' } as never).execute();
    await db.insertInto('lab_requests' as never).values([
      { id: 'poly-obr1', request_id: 'LAB-POLY', panel_desc: 'MICROBIOLOGY : WOUND' },
      { id: 'poly-obr2', request_id: 'LAB-POLY', panel_desc: 'MICROBIOLOGY : WOUND 2' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'po-org1', request_id: 'poly-obr1', specimen_id: 'spec-poly', observation_code: 'ORGS', text_value: 'Staphylococcus aureus' },
      { id: 'po-org2', request_id: 'poly-obr2', specimen_id: 'spec-poly', observation_code: 'ORGS', text_value: 'Pseudomonas aeruginosa' },
    ] as never).execute();

    // AGREEING — two organism-bearing orders naming the SAME organism. 10 of 117 real lab numbers.
    // This must still print: it is one isolate reported twice, not two isolates.
    await db.insertInto('specimens' as never).values({ id: 'spec-agree', type_text: 'Blood' } as never).execute();
    await db.insertInto('lab_requests' as never).values([
      { id: 'agree-obr1', request_id: 'LAB-AGREE', panel_desc: 'MICROBIOLOGY : BLOOD' },
      { id: 'agree-obr2', request_id: 'LAB-AGREE', panel_desc: 'Microbiology Sensitivity' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'ag-org1', request_id: 'agree-obr1', specimen_id: 'spec-agree', observation_code: 'ORGS', text_value: 'Escherichia coli' },
      { id: 'ag-org2', request_id: 'agree-obr2', specimen_id: 'spec-agree', observation_code: 'ORGS', text_value: 'Escherichia coli' },
    ] as never).execute();

    // Chemistry — exists, but no isolate anywhere.
    await db.insertInto('lab_requests' as never).values([
      { id: 'chem-obr1', request_id: 'LAB-CHEM', panel_desc: 'Liver Function' },
    ] as never).execute();
    await db.insertInto('lab_results' as never).values([
      { id: 'ch-alt', request_id: 'chem-obr1', observation_code: 'ALT', abnormal_flag: 'H' },
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

  it('prints the registry name for a MAPPED facility, not the wire acronym', async () => {
    const row = await runFor('req-mapped');
    expect(row?.performing_lab).toBe('National Public Health Laboratory');
  });

  it('prefers the curated location, keeping a PO box off the report', async () => {
    const row = await runFor('req-mapped');
    expect(row?.lab_location).toBe('Ubungo, Dar es Salaam');
  });

  it('falls back to the wire display for an UNMAPPED facility, and locates it from facilities', async () => {
    const row = await runFor('req-unmapped');
    expect(row?.performing_lab).toBe('Mnazi Mmoja');
    expect(row?.lab_location).toBe('Ilala, Dar es Salaam');
  });

  it('renders a region-only location with no stray comma', async () => {
    const row = await runFor('req-regiononly');
    expect(row?.lab_location).toBe('Tanga');
  });

  it('falls all the way back to the bare code rather than printing nothing', async () => {
    const row = await runFor('req-nodisplay');
    expect(row?.performing_lab).toBe('NODISPLAY');
    expect(row?.lab_location).toBeNull();
  });

  it('still resolves a report whose source_system is NULL', async () => {
    // The guard this pins: without coalesce(fo.source_system, ''), NULL = '' is false and this row
    // silently falls back to the wire display instead of resolving.
    const row = await runFor('req-nullfeed');
    expect(row?.performing_lab).toBe('Folded Feed Laboratory');
  });

  it('still returns the patient header when the specimen has no diagnostic report', async () => {
    const row = await runFor('req-bare');
    expect(row).toBeDefined();
    expect(row?.lab_number).toBe('LAB-bare');
    expect(row?.performing_lab).toBeNull();
    expect(row?.lab_location).toBeNull();
  });

  it('returns exactly ONE row — the design binds a single header row', async () => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const res = await sql.raw<Record<string, unknown>>(raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'req-mapped'`)).execute(db);
    expect(res.rows).toHaveLength(1);
  });

  it('stays single-row when one facility arrives as TWO rows', async () => {
    // facilities.id is the raw FHIR resource id and BOTH Organization and Location project into
    // that table, so one facility can legitimately be two rows sharing a (source_system,
    // facility_code) pair. The design binds rows[0] into the panel, the barcode and the QR, so a
    // fan-out would silently render whichever row came first.
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const res = await sql.raw<Record<string, unknown>>(raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'req-twinned'`)).execute(db);
    expect(res.rows).toHaveLength(1);
  });

  it('resolves the LAB NUMBER, returning one row across two orders', async () => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const res = await sql.raw<Record<string, unknown>>(
      raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'LAB-SPLIT'`)).execute(db);
    expect(res.rows).toHaveLength(1);
  });

  it('carries the organism even though it sits on the other order', async () => {
    const row = await runFor('LAB-SPLIT');
    expect(row?.organism).toBe('Shigella flexneri');
    expect(row?.lab_number).toBe('LAB-SPLIT');
    expect(row?.specimen).toBe('Stools');
  });

  it('names the panel that supplied the susceptibilities', async () => {
    const row = await runFor('LAB-SPLIT');
    expect(row?.panel).toBe('Microbiology Sensitivity');
  });

  it('falls back to an organism-bearing order for a culture with no susceptibilities', async () => {
    const row = await runFor('LAB-CULT');
    expect(row?.panel).toBe('MICROBIOLOGY : URINE');
    expect(row?.organism).toBe('Escherichia coli');
  });

  it('returns NO row for a lab number carrying TWO distinct organisms, so two isolates are never merged', async () => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const res = await sql.raw<Record<string, unknown>>(
      raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'LAB-POLY'`)).execute(db);
    expect(res.rows).toHaveLength(0);
  });

  it('still prints when two orders name the SAME organism — one isolate reported twice', async () => {
    const row = await runFor('LAB-AGREE');
    expect(row?.organism).toBe('Escherichia coli');
  });

  it('still prints when the isolate observation carries no value at all', async () => {
    // ⛔ The reason the guard is `<= 1` and not `= 1`. count(distinct) ignores nulls, so `req-bare`
    // — a real 634-6 row with no text_value — counts ZERO distinct organisms. `= 1` would refuse it.
    const row = await runFor('req-bare');
    expect(row).toBeDefined();
    expect(row?.organism).toBeNull();
  });

  it('returns NO row for a lab number with no microbiology, so the PDF is refused', async () => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const res = await sql.raw<Record<string, unknown>>(
      raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'LAB-CHEM'`)).execute(db);
    expect(res.rows).toHaveLength(0);
  });

  it('returns NO row for an unknown identifier', async () => {
    const raw = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    const res = await sql.raw<Record<string, unknown>>(
      raw.replace(/\{\{\s*param\.request\s*\}\}/g, `'NOPE'`)).execute(db);
    expect(res.rows).toHaveLength(0);
  });
});
