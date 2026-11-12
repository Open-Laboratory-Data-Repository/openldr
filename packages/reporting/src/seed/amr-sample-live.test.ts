import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator, createRelationalWriter, externalMigrations } from '@openldr/db';
import { SEED_QUERIES } from './report-seeds';

// Bug 10: the sample file the guides load has no microbiology, so every AMR report came back empty
// for anyone who followed the guide. The microbiology sample is a second file, so the numbers the
// guides already quote from the first one do not move.
const FILE = new URL('../../../../apps/web/public/docs-samples/openldr-sample-microbiology.json', import.meta.url);

type Res = { resourceType: string; id: string; [k: string]: unknown };
const bundle = () => JSON.parse(readFileSync(FILE, 'utf8')) as { resourceType: string; entry: { resource: Res }[] };
const resources = () => bundle().entry.map((e) => e.resource);
const ofType = (t: string) => resources().filter((r) => r.resourceType === t);
const code = (r: Res) => ((r.code as { coding?: { code?: string }[] })?.coding?.[0]?.code);
const flag = (r: Res) => ((r.interpretation as { coding?: { code?: string }[] }[] | undefined)?.[0]?.coding?.[0]?.code);

describe('the microbiology sample file', () => {
  it('is a transaction bundle', () => {
    expect(bundle()).toMatchObject({ resourceType: 'Bundle', type: 'transaction' });
  });

  it('has an organism on each culture and S, I and R results on the same specimen', () => {
    const organisms = ofType('Observation').filter((o) => code(o) === '634-6');
    expect(organisms.length).toBeGreaterThanOrEqual(30);
    const flags = new Set(ofType('Observation').map(flag));
    for (const f of ['S', 'I', 'R']) expect(flags.has(f)).toBe(true);
    const withAst = new Set(ofType('Observation').filter((o) => ['S', 'I', 'R'].includes(flag(o) ?? '')).map((o) => JSON.stringify(o.specimen)));
    for (const o of organisms) expect(withAst.has(JSON.stringify(o.specimen))).toBe(true);
  });

  it('marks specimens inpatient or outpatient, and repeats some patients so first isolates differ', () => {
    const origins = new Set(ofType('Specimen').map((s) => (s.extension as { valueCode?: string }[] | undefined)?.[0]?.valueCode));
    expect(origins).toEqual(new Set(['inpatient', 'outpatient']));
    const organisms = ofType('Observation').filter((o) => code(o) === '634-6');
    const patients = new Set(organisms.map((o) => JSON.stringify(o.subject)));
    expect(patients.size).toBeLessThan(organisms.length);
  });
});

const url = process.env.TARGET_DATABASE_URL;
describe.skipIf(!url)('the AMR reports over the microbiology sample (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_amr_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<any>;

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString() }) }) });
    const up = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
    expect(up.error).toBeUndefined();
    // The same projection the warehouse writer runs on ingest.
    await createRelationalWriter(db).writeMany(resources().map((resource) => ({ resource, provenance: {} })));
    // The AST interpretation value set every install seeds (bootstrap/src/seed.ts) and publishes to
    // the warehouse. The clinical AST report keeps only results whose code is in it.
    for (const [c, display] of [['S', 'Susceptible'], ['I', 'Intermediate'], ['R', 'Resistant']]) {
      await db.insertInto('terminology_codes').values({
        id: `vs-ast-${c}`, value_set_id: 'vs-ast', value_set_url: 'urn:openldr:valueset:ast-interpretation', code: c, display,
      }).execute();
    }
  });

  afterAll(async () => {
    await db?.destroy();
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.end();
  });

  const run = async (id: string, values: Record<string, string>) => {
    let text = SEED_QUERIES.find((q) => q.id === id)!.sql.postgres;
    for (const [k, v] of Object.entries(values)) text = text.replace(new RegExp(`\\{\\{\\s*param\\.${k}\\s*\\}\\}`, 'g'), `'${v}'`);
    return (await sql.raw<Record<string, unknown>>(text).execute(db)).rows;
  };
  const window = { from: '2026-09-01', to: '2026-10-31' };

  it.each([
    ['q-amr-resistance', { ...window, facility: '' }],
    ['q-amr-facility-summary', window],
    ['q-amr-glass-ris', { ...window, country: '', year: '' }],
    ['q-amr-first-isolate-summary', window],
    ['q-amr-antibiogram', window],
  ])('%s returns rows', async (id, values) => {
    expect((await run(id, values)).length).toBeGreaterThan(0);
  });

  it('the resistance report lists the sample antibiotics, with some resistance', async () => {
    const rows = await run('q-amr-resistance', { ...window, facility: '' });
    // The numbers the Reports guide quotes. Regenerating the sample changes them, and this says so.
    expect(rows).toHaveLength(10);
    expect(rows.find((r) => r.antibiotic === 'Ciprofloxacin')).toEqual({ antibiotic: 'Ciprofloxacin', tested: 48, r: 13, i: 4, s: 31, percentR: 27.1 });
    expect(rows.find((r) => r.antibiotic === 'Vancomycin')).toMatchObject({ tested: 11, r: 0 });
  });

  it('the clinical microbiology reports fill for one culture order', async () => {
    const order = ofType('ServiceRequest')[0]!;
    const number = (order.identifier as { value: string }[])[0]!.value;
    expect((await run('q-clinical-micro-header', { request: number })).length).toBeGreaterThan(0);
    expect((await run('q-clinical-micro-ast', { request: number })).length).toBeGreaterThan(0);
  });
});
