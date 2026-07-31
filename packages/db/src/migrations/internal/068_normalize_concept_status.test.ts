import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { up } from './068_normalize_concept_status';

type Db = Awaited<ReturnType<typeof makeMigratedDb>>;

async function statusOf(db: Db, code: string): Promise<string | null> {
  const r = await db
    .selectFrom('terminology_concepts')
    .select('status')
    .where('code', '=', code)
    .executeTakeFirst();
  return (r as { status: string | null } | undefined)?.status ?? null;
}

async function seed(db: Db, rows: Array<[string, string, string | null]>): Promise<void> {
  for (const [system, code, status] of rows) {
    await db
      .insertInto('terminology_concepts')
      .values({ system, code, display: code, status, properties: null })
      .execute();
  }
}

describe('068_normalize_concept_status', () => {
  // The upgrade hazard: an install that imported SNOMED or RxNorm before the adapters were fixed
  // holds hundreds of thousands of lowercase 'active' rows. filterConcepts gates on
  // `status = 'ACTIVE'`, so every activeOnly ValueSet expansion over those systems returns ZERO
  // rows — silently, as an empty picker rather than an error. The code fix only helps re-imports.
  it('upper-cases already-ingested lower-case statuses', async () => {
    const db = await makeMigratedDb();
    await seed(db, [
      ['http://snomed.info/sct', '119364003', 'active'],
      ['http://www.nlm.nih.gov/research/umls/rxnorm', '1234', 'active'],
    ]);

    await up(db);

    expect(await statusOf(db, '119364003')).toBe('ACTIVE');
    expect(await statusOf(db, '1234')).toBe('ACTIVE');
  });

  // LOINC carries real non-active statuses through from its own STATUS column; those are data,
  // not defects, and must survive with their casing normalised rather than being flattened.
  it('normalises other statuses without collapsing them to ACTIVE', async () => {
    const db = await makeMigratedDb();
    await seed(db, [['http://loinc.org', 'L1', 'deprecated']]);

    await up(db);

    expect(await statusOf(db, 'L1')).toBe('DEPRECATED');
  });

  it('leaves an already-upper-case status untouched', async () => {
    const db = await makeMigratedDb();
    await seed(db, [['http://loinc.org', 'L2', 'ACTIVE']]);

    await up(db);

    expect(await statusOf(db, 'L2')).toBe('ACTIVE');
  });

  // WHONET writes status: null deliberately — the migration must not invent a value.
  it('leaves a null status null', async () => {
    const db = await makeMigratedDb();
    await seed(db, [['http://whonet', 'W1', null]]);

    await up(db);

    expect(await statusOf(db, 'W1')).toBeNull();
  });

  it('is idempotent', async () => {
    const db = await makeMigratedDb();
    await seed(db, [['http://snomed.info/sct', '119364003', 'active']]);

    await up(db);
    await up(db);

    expect(await statusOf(db, '119364003')).toBe('ACTIVE');
  });

  it('is a no-op on an install with no concepts', async () => {
    const db = await makeMigratedDb();
    await expect(up(db)).resolves.toBeUndefined();
  });
});
