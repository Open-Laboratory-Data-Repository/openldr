import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { advanceCursor, createFhirStore } from '@openldr/db';
import { createWarehouseStatusReader, readWarehouseReading, withRate, type WarehouseReading } from './warehouse-status';

const reading = (at: string, head: number, cursor: number): WarehouseReading =>
  ({ head, cursor, behind: head - cursor, waitingRetry: 0, oldestWaitingAt: null, readAt: at });

describe('warehouse status: one reading', () => {
  it('a_warehouse_whose_cursor_is_at_the_newest_change_is_up_to_date', async () => {
    const db = await makeMigratedDb();
    // A new database already holds the changes its migrations seeded.
    const first = await readWarehouseReading(db as never);
    expect(first.behind).toBe(first.head - first.cursor);
    await advanceCursor(db as never, 'projection', first.head);
    expect(await readWarehouseReading(db as never)).toMatchObject({ behind: 0, waitingRetry: 0, oldestWaitingAt: null });
    await db.destroy();
  });

  it('counts_the_changes_saved_since_the_warehouse_cursor', async () => {
    const db = await makeMigratedDb();
    const before = await readWarehouseReading(db as never);
    await advanceCursor(db as never, 'projection', before.head);
    const store = createFhirStore(db as never);
    for (const id of ['p1', 'p2', 'p3']) await store.save({ resourceType: 'Patient', id } as never);
    const r = await readWarehouseReading(db as never, () => new Date('2026-11-19T10:00:00Z'));
    expect(r.behind).toBe(3);
    expect(r.cursor).toBe(before.head);
    expect(r.oldestWaitingAt).not.toBeNull();
    expect(r.readAt).toBe('2026-11-19T10:00:00.000Z');
    await advanceCursor(db as never, 'projection', r.head);
    expect((await readWarehouseReading(db as never)).behind).toBe(0);
    await db.destroy();
  });

  it('counts_the_records_that_wait_for_another_try', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('fhir.projection_retries' as never).values({ resource_type: 'Patient', resource_id: 'p1', attempts: 1, next_attempt_at: new Date() } as never).execute();
    expect((await readWarehouseReading(db as never)).waitingRetry).toBe(1);
    await db.destroy();
  });
});

describe('warehouse status: the rate between two readings', () => {
  it('one_reading_gives_no_rate', () => {
    expect(withRate(null, reading('2026-11-19T10:00:00Z', 1000, 400))).toMatchObject({ appliedPerSecond: null, secondsLeft: null, fallingBehind: false });
  });

  it('a_closing_gap_gives_the_time_left', () => {
    // 10 s apart: the warehouse took 5,000 changes and nothing new was saved. 15,000 left at 500 a second.
    const s = withRate(reading('2026-11-19T10:00:00Z', 40000, 20000), reading('2026-11-19T10:00:10Z', 40000, 25000));
    expect(s).toMatchObject({ appliedPerSecond: 500, secondsLeft: 30, fallingBehind: false });
  });

  it('the_time_left_uses_how_fast_the_gap_closes_not_how_fast_the_warehouse_works', () => {
    // The warehouse took 5,000 while 3,000 more were saved: the gap closed by 2,000 in 10 s.
    const s = withRate(reading('2026-11-19T10:00:00Z', 40000, 20000), reading('2026-11-19T10:00:10Z', 43000, 25000));
    expect(s).toMatchObject({ appliedPerSecond: 500, secondsLeft: 90, fallingBehind: false });
  });

  it('a_growing_gap_is_falling_behind_with_no_time_left', () => {
    const s = withRate(reading('2026-11-19T10:00:00Z', 40000, 20000), reading('2026-11-19T10:00:10Z', 60000, 25000));
    expect(s).toMatchObject({ appliedPerSecond: 500, secondsLeft: null, fallingBehind: true });
  });

  it('an_up_to_date_warehouse_has_no_time_left_and_is_not_falling_behind', () => {
    const s = withRate(reading('2026-11-19T10:00:00Z', 40000, 39000), reading('2026-11-19T10:00:10Z', 40000, 40000));
    expect(s).toMatchObject({ behind: 0, secondsLeft: null, fallingBehind: false });
  });

  it('readings_too_close_or_too_far_apart_give_no_rate', () => {
    expect(withRate(reading('2026-11-19T10:00:00Z', 9, 1), reading('2026-11-19T10:00:01Z', 9, 5)).appliedPerSecond).toBeNull();
    expect(withRate(reading('2026-11-19T10:00:00Z', 9, 1), reading('2026-11-19T10:06:00Z', 9, 5)).appliedPerSecond).toBeNull();
  });
});

describe('warehouse status: the reader a server keeps', () => {
  it('the_second_call_has_a_rate_and_a_call_too_soon_keeps_it', async () => {
    const db = await makeMigratedDb();
    const start = (await readWarehouseReading(db as never)).head;
    await advanceCursor(db as never, 'projection', start);
    const store = createFhirStore(db as never);
    for (let i = 0; i < 6; i++) await store.save({ resourceType: 'Patient', id: `p${i}` } as never);
    let clock = Date.parse('2026-11-19T10:00:00Z');
    const reader = createWarehouseStatusReader(db as never, () => new Date(clock));
    expect((await reader.read()).appliedPerSecond).toBeNull();
    clock += 4000;
    await advanceCursor(db as never, 'projection', start + 4);
    const second = await reader.read();
    expect(second).toMatchObject({ behind: 2, appliedPerSecond: 1, secondsLeft: 2 });
    clock += 500;
    const soon = await reader.read();
    expect(soon).toMatchObject({ behind: 2, appliedPerSecond: 1, secondsLeft: 2 });
    await db.destroy();
  });
});
