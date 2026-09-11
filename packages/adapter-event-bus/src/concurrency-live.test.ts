import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, type EventBus, type DrainResult } from './index';

const url = process.env.INTERNAL_DATABASE_URL;

describe.skipIf(!url)('event-bus concurrency, live PostgreSQL', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let bus: EventBus;
  let schema: string;

  beforeEach(async () => {
    schema = `concurrency_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    await admin.query(`create table ${schema}.outbox_events (like public.outbox_events including all)`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    bus = createEventBus({ url: url! }, { pool });
    await pool.query(`insert into outbox_events (id, type, payload)
      select 'event-' || n, 'concurrency.test', '{}'::jsonb from generate_series(1, 45) n`);
  });

  afterEach(async () => {
    await bus.close();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });

  it.each(['manual calls', 'notifications and timer ticks'])(
    'keeps one handler active during overlapping %s and resumes afterward',
    async (source) => {
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      let active = 0;
      let peak = 0;
      let handled = 0;
      await bus.subscribe('concurrency.test', async () => {
        active++;
        peak = Math.max(peak, active);
        await blocked;
        active--;
        handled++;
      });

      const drains: Promise<DrainResult>[] = [bus.drain({ limit: 1 })];
      let worker: ReturnType<EventBus['startWorker']> | undefined;
      try {
        await vi.waitFor(() => expect(active).toBe(1));
        if (source === 'manual calls') {
          for (let i = 0; i < 30; i++) drains.push(bus.drain({ limit: 20 }));
        } else {
          worker = bus.startWorker({ intervalMs: 10 });
          for (let i = 0; i < 30; i++) {
            await admin.query(`select pg_notify('openldr_events', $1)`, [String(i)]);
          }
        }
        // Keep the handler blocked across multiple timer periods and database round trips.
        await delay(100);
        expect(peak).toBe(1);
        expect(await bus.stats()).toEqual({ pending: 44, processing: 1 });
        const stopping = worker?.stop();
        release();
        await stopping;
        const results = await Promise.all(drains);
        expect(results.every((result) => result.processed === 1 && result.failed === 0)).toBe(true);
        expect(handled).toBe(1);
        expect(await bus.drain({ limit: 2 })).toEqual({ processed: 2, failed: 0 });
        expect(await bus.stats()).toEqual({ pending: 42, done: 3 });
      } finally {
        const stopping = worker?.stop();
        release();
        await stopping;
        await Promise.allSettled(drains);
        await vi.waitFor(() => expect(active).toBe(0));
      }
    },
  );
});
