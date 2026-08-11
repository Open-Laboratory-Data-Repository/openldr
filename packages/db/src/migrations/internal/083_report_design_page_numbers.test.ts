import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('083_report_design_page_numbers', () => {
  it('adds a nullable page_numbers column that round-trips true, false and null', async () => {
    const db = await makeMigratedDb();

    const base = { pages: JSON.stringify([]), parameters: JSON.stringify([]), margins: null };
    await db.insertInto('report_designs').values([
      { id: 'd-true', name: 'On', page_numbers: true, ...base },
      { id: 'd-false', name: 'Off', page_numbers: false, ...base },
      { id: 'd-null', name: 'Unset', ...base },
    ] as never).execute();

    const rows = await db
      .selectFrom('report_designs')
      .select(['id', 'page_numbers'])
      .orderBy('id')
      .execute();

    expect(rows).toEqual([
      { id: 'd-false', page_numbers: false },
      { id: 'd-null', page_numbers: null },
      { id: 'd-true', page_numbers: true },
    ]);
  });
});
