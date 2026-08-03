import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('069 result-role value sets', () => {
  it('seeds the dictionary-scope value set as a whole-system include (no filter, no concept)', async () => {
    const db = await makeMigratedDb();
    const row = await db.selectFrom('value_sets').select('compose')
      .where('url', '=', 'urn:openldr:valueset:result-observation').executeTakeFirstOrThrow();
    const compose = typeof row.compose === 'string' ? JSON.parse(row.compose) : row.compose;
    expect(compose.include).toHaveLength(1);
    expect(compose.include[0]).toEqual({ system: 'urn:openldr:default_result' });
    await db.destroy();
  });

  it('seeds the three value sets with the right compose shapes', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('value_sets').select(['url', 'compose'])
      .where('url', 'like', 'urn:openldr:valueset:%re%').execute();
    const byUrl = new Map(rows.map((r) => [r.url, typeof r.compose === 'string' ? JSON.parse(r.compose) : r.compose]));

    expect(byUrl.get('urn:openldr:valueset:reportable-result').include).toHaveLength(1);
    expect(byUrl.get('urn:openldr:valueset:reportable-result').include[0].filter[0])
      .toEqual({ property: 'result_role', op: '=', value: 'result' });

    // The union that makes fail-open work: two clauses, not one clause with two filters.
    expect(byUrl.get('urn:openldr:valueset:non-reportable').include).toHaveLength(2);
    expect(byUrl.get('urn:openldr:valueset:non-reportable').include.map((i: any) => i.filter[0].value))
      .toEqual(['metadata', 'admin']);
    await db.destroy();
  });

  it('does not include `specimen` in the non-reportable set', async () => {
    const db = await makeMigratedDb();
    const row = await db.selectFrom('value_sets').select('compose')
      .where('url', '=', 'urn:openldr:valueset:non-reportable').executeTakeFirstOrThrow();
    expect(JSON.stringify(row.compose)).not.toContain('specimen');
    await db.destroy();
  });

  it('does not materialize an expansion for any of the three (concepts arrive later, via import)', async () => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('value_sets').select(['id', 'expanded_at'])
      .where('url', 'in', [
        'urn:openldr:valueset:result-observation',
        'urn:openldr:valueset:reportable-result',
        'urn:openldr:valueset:non-reportable',
      ]).execute();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.expanded_at).toBeNull();
      const expansions = await db.selectFrom('valueset_expansions').selectAll()
        .where('value_set_id', '=', r.id).execute();
      expect(expansions).toHaveLength(0);
    }
    await db.destroy();
  });

  it('is idempotent across a re-run of up()', async () => {
    const db = await makeMigratedDb();
    const before = await db.selectFrom('value_sets')
      .select('url').where('url', 'like', 'urn:openldr:valueset:%').execute();
    // internalMigrations.up() already ran once via makeMigratedDb(); re-running the same up()
    // directly must not throw or duplicate rows (onConflict doNothing on url).
    const { internalMigrations } = await import('./index');
    await internalMigrations['069_result_role_valuesets']!.up(db as never);
    const after = await db.selectFrom('value_sets')
      .select('url').where('url', 'like', 'urn:openldr:valueset:%').execute();
    expect(after.length).toBe(before.length);
    await db.destroy();
  });
});
