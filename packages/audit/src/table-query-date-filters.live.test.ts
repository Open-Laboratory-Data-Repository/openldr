import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInternalDb, type InternalDb } from '@openldr/db';
import { createAuditStore, type AuditStore } from './store';

// C2 (fix-wave 2): pg-mem is not Postgres (AGENTS.md §7). Its timestamptz support is partial
// enough that it cannot even cast timestamptz to text — table-query-parity.test.ts's date cases
// prove the day-aware eq/ne/between fix only for the shapes pg-mem can execute, and the
// full-timestamp eq/ne fix (C1) has NO offline proof at all: pg-mem errors on that cast too, which
// is why C1 was found by live measurement in the first place. This file proves both against real
// audit_events, on real Postgres. Needs INTERNAL_DATABASE_URL; a skipped run is not a pass.
// Modelled on store-pagination.live.test.ts's gate and cleanup pattern.
const url = process.env.INTERNAL_DATABASE_URL;
const live = describe.skipIf(!url);

// Unique per run, used only to scope these rows for querying and cleanup — never asserted on
// directly. Isolates this fixture from whatever else lives in the shared `audit_events` table.
const MARKER = `tq-date-filter-scratch-${randomUUID()}`;

// Four rows spanning three calendar days, all UTC — day A has two rows (early morning, one
// millisecond before midnight), day B sits at the exact next midnight (the boundary the
// day-range expansion must include for A's "eq 2026-08-06" and exclude for B's), day C is the
// day before A (excluded from an A-only query, included once the range extends back to it).
const DAY_A_EARLY = new Date('2026-08-06T01:18:19.491Z');
const DAY_A_LATE = new Date('2026-08-06T23:59:59.999Z');
const DAY_B_MIDNIGHT = new Date('2026-08-07T00:00:00.000Z');
const DAY_C = new Date('2026-08-05T12:00:00.000Z');

live('date-column filters match the day-aware and full-timestamp SQL fix, on real audit_events (live Postgres)', () => {
  let internal: InternalDb;
  let store: AuditStore;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    internal = createInternalDb(url!);
    store = createAuditStore(internal.db);

    const rows: [string, Date][] = [
      ['a-early', DAY_A_EARLY],
      ['a-late', DAY_A_LATE],
      ['b-midnight', DAY_B_MIDNIGHT],
      ['c-prev-day', DAY_C],
    ];
    // store.record() always stamps occurred_at = now() — there is no API to set it directly, so
    // record first, then overwrite the stamp. Same technique as store-pagination.live.test.ts's
    // STAMP fixture.
    for (const [key, occurredAt] of rows) {
      const event = await store.record({
        actorType: 'system',
        actorName: 'date-filter-scratch',
        action: 'x.y',
        entityType: MARKER,
        entityId: key,
      });
      ids[key] = event.id;
      await internal.db.updateTable('audit_events').set({ occurred_at: occurredAt }).where('id', '=', event.id).execute();
    }
  });

  afterAll(async () => {
    await internal.db.deleteFrom('audit_events').where('entity_type', '=', MARKER).execute().catch(() => undefined);
    await internal?.close().catch(() => undefined);
  });

  // entityType: MARKER scopes every query below to just these four rows, ANDed with the date
  // filter under test (store.ts's filterExpressions) — real row counts, not a synthetic table.
  it('eq on a bare date matches every row on that day, not just the midnight instant', async () => {
    const rows = await store.list({
      entityType: MARKER,
      filters: [{ column: 'occurredAt', operator: 'eq', value: '2026-08-06', combine: 'and' }],
    });
    expect(rows.map((r) => r.id).sort()).toEqual([ids['a-early']!, ids['a-late']!].sort());
  });

  it('eq on a full timestamp matches only that exact instant (C1)', async () => {
    const rows = await store.list({
      entityType: MARKER,
      filters: [{ column: 'occurredAt', operator: 'eq', value: DAY_A_EARLY.toISOString(), combine: 'and' }],
    });
    expect(rows.map((r) => r.id)).toEqual([ids['a-early']!]);
  });

  it('ne on a bare date excludes every row on that day and keeps the rest', async () => {
    const rows = await store.list({
      entityType: MARKER,
      filters: [{ column: 'occurredAt', operator: 'ne', value: '2026-08-06', combine: 'and' }],
    });
    expect(rows.map((r) => r.id).sort()).toEqual([ids['b-midnight']!, ids['c-prev-day']!].sort());
  });

  it('ne on a full timestamp excludes only that exact instant (C1)', async () => {
    const rows = await store.list({
      entityType: MARKER,
      filters: [{ column: 'occurredAt', operator: 'ne', value: DAY_A_EARLY.toISOString(), combine: 'and' }],
    });
    expect(rows.map((r) => r.id).sort()).toEqual([ids['a-late']!, ids['b-midnight']!, ids['c-prev-day']!].sort());
  });

  it('between with date-only bounds includes the end day in full, up to but not past the next midnight', async () => {
    const rows = await store.list({
      entityType: MARKER,
      filters: [{ column: 'occurredAt', operator: 'between', value: ['2026-08-06', '2026-08-06'], combine: 'and' }],
    });
    expect(rows.map((r) => r.id).sort()).toEqual([ids['a-early']!, ids['a-late']!].sort());
  });

  it('between spanning multiple date-only days includes every day in the range', async () => {
    const rows = await store.list({
      entityType: MARKER,
      filters: [{ column: 'occurredAt', operator: 'between', value: ['2026-08-05', '2026-08-06'], combine: 'and' }],
    });
    expect(rows.map((r) => r.id).sort()).toEqual([ids['a-early']!, ids['a-late']!, ids['c-prev-day']!].sort());
  });
});
