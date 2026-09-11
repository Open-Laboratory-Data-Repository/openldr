import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from './index';

const url = process.env.QUEUE_SHUTDOWN_TEST_DATABASE_URL;

describe.skipIf(!url)('queue shutdown with PostgreSQL', () => {
  it('finishes the claimed batch before closing and leaves unclaimed rows pending', async () => {
    const schema = `shutdown_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    const bus = createEventBus({ url: url! }, { pool });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let entered = false;
    try {
      await pool.query(`create table outbox_events (
        id text primary key, type text not null, payload jsonb not null, batch_id text,
        status text not null default 'pending', attempts int not null default 0,
        max_attempts int not null default 3, available_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), last_error text, claim_token text
      )`);
      await bus.subscribe('test', async () => { entered = true; await blocked; });
      for (let n = 0; n < 21; n++) await bus.publish({ type: 'test', payload: { n } });
      bus.startWorker({ intervalMs: 10 });
      await vi.waitFor(() => expect(entered).toBe(true));
      let closed = false;
      const closing = bus.close().then(() => { closed = true; });
      try {
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(closed).toBe(false);
      } finally {
        release();
        await closing;
      }
      const rows = await admin.query(`select status, count(*)::int as count from ${schema}.outbox_events group by status order by status`);
      expect(rows.rows).toEqual([{ status: 'done', count: 20 }, { status: 'pending', count: 1 }]);
    } finally {
      release();
      await bus.close();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  });
});
