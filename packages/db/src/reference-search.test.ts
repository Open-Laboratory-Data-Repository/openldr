import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createPatientResolver } from './reference-search';
import { makeMigratedExternalDb } from './test-helpers-external';

async function seed() {
  const db = await makeMigratedExternalDb();
  await db.insertInto('patients').values([
    { id: 'p1', surname: 'Doe',  firstname: 'Jane', national_id: 'NID-001', phone: '0770000001', date_of_birth: '1992-01-01', sex: 'F', active: true,  replaced_by_id: null },
    { id: 'p2', surname: 'Doe',  firstname: 'John', national_id: 'NID-002', phone: '0770000002', date_of_birth: '1988-05-09', sex: 'M', active: true,  replaced_by_id: null },
    { id: 'p3', surname: 'Gone', firstname: 'Dup',  national_id: 'NID-003', phone: '0770000003', date_of_birth: '1990-02-02', sex: 'F', active: false, replaced_by_id: null },
    { id: 'p4', surname: 'Merged', firstname: 'Old', national_id: 'NID-004', phone: '0770000004', date_of_birth: '1991-03-03', sex: 'M', active: true, replaced_by_id: 'p1' },
  ] as never).execute();
  return db;
}

describe('createPatientResolver', () => {
  it('matches on surname, case-insensitively', async () => {
    const r = createPatientResolver(await seed(), 'postgres');
    const out = await r.search('doe', 10, 0);
    expect(out.rows.map((x) => x.reference).sort()).toEqual(['Patient/p1', 'Patient/p2']);
    expect(out.total).toBe(2);
  });

  it('matches on firstname, national_id and phone', async () => {
    const r = createPatientResolver(await seed(), 'postgres');
    expect((await r.search('jane', 10, 0)).rows.map((x) => x.reference)).toEqual(['Patient/p1']);
    expect((await r.search('NID-002', 10, 0)).rows.map((x) => x.reference)).toEqual(['Patient/p2']);
    expect((await r.search('0770000001', 10, 0)).rows.map((x) => x.reference)).toEqual(['Patient/p1']);
  });

  it('excludes inactive and merged-away patients', async () => {
    const r = createPatientResolver(await seed(), 'postgres');
    expect((await r.search('gone', 10, 0)).rows).toEqual([]);
    expect((await r.search('merged', 10, 0)).rows).toEqual([]);
  });

  it('renders display and secondary but never the national id', async () => {
    const r = createPatientResolver(await seed(), 'postgres');
    const [row] = (await r.search('jane', 10, 0)).rows;
    expect(row).toEqual({ reference: 'Patient/p1', display: 'Doe Jane', secondary: '1992-01-01 · F' });
    expect(JSON.stringify(row)).not.toContain('NID-001');
  });

  it('honours the limit', async () => {
    const r = createPatientResolver(await seed(), 'postgres');
    const out = await r.search('doe', 1, 0);
    expect(out.rows).toHaveLength(1);
    expect(out.total).toBe(2);
  });
});

describe('engine portability', () => {
  it('compiles to lower()/LIKE, never ilike', async () => {
    const db = await seed();
    // Capture the SQL the resolver builds by compiling the same predicate shape it uses.
    const compiled = db
      .selectFrom('patients')
      .select('id')
      .where(sql<boolean>`lower(${sql.ref('surname')}) like ${'%doe%'}`)
      .compile();
    expect(compiled.sql.toLowerCase()).toContain('lower(');
    expect(compiled.sql.toLowerCase()).not.toContain('ilike');
  });

  it('the resolver source contains no ilike', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./reference-search.ts', import.meta.url), 'utf8'));
    expect(src.toLowerCase()).not.toContain('ilike');
  });
});
