import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

// pg-mem (like the real Postgres jsonb driver path — see 069_result_role_valuesets.test.ts's
// `compose` handling) hands a jsonb column back already parsed, not as a JSON string. An unguarded
// `JSON.parse(row.target_pages)` blows up (`JSON.parse` stringifies the array first, so `['facilities']`
// becomes the bare word `facilities`, which isn't valid JSON) — verified empirically before writing
// this, since the brief's row shape is a starting point, not a guarantee.
const parseTargetPages = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

const seeded = (over: Record<string, unknown> = {}) => ({
  id: 'form-sample-facility', name: 'Facility', version_label: 'v1',
  fhir_resource_type: 'Location', fhir_version: 'R4', status: 'draft', active: true,
  schema: JSON.stringify({ id: 'sample-facility', fields: [] }),
  target_pages: JSON.stringify(['forms']),
  ...over,
});

describe('071_facility_form_target', () => {
  it('repoints and publishes an untouched seeded Facility form', async () => {
    const db = await makeMigratedDb();
    // Insert BEFORE 071 would have run in a real upgrade; here the table already exists, so write
    // the pre-071 state and re-run 071's up() directly.
    await db.insertInto('form_definitions' as never).values(seeded() as never).execute();
    const m = await import('./071_facility_form_target');
    await m.up(db);
    const row: any = await db.selectFrom('form_definitions').selectAll()
      .where('id', '=', 'form-sample-facility').executeTakeFirstOrThrow();
    expect(parseTargetPages(row.target_pages)).toEqual(['facilities']);
    expect(row.status).toBe('published');
  });

  it('⛔ leaves an EDITED form alone — an operator is never clobbered', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('form_definitions' as never).values(
      seeded({ target_pages: JSON.stringify(['forms']), schema: JSON.stringify({ id: 'sample-facility', fields: [{ id: 'mine' }] }) }) as never,
    ).execute();
    const m = await import('./071_facility_form_target');
    await m.up(db);
    const row: any = await db.selectFrom('form_definitions').selectAll()
      .where('id', '=', 'form-sample-facility').executeTakeFirstOrThrow();
    expect(parseTargetPages(row.target_pages)).toEqual(['forms']);
  });

  it('is a no-op when no seeded form exists', async () => {
    const db = await makeMigratedDb();
    const m = await import('./071_facility_form_target');
    await expect(m.up(db)).resolves.not.toThrow();
  });
});
