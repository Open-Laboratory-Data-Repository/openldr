import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createEventBus } from './index';

const url = process.env.QUEUE_TEST_DATABASE_URL;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
describe.skipIf(!url)('queue ownership on isolated Postgres', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let schema: string;
  beforeEach(async () => {
    schema = `queue_ownership_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query(`create table outbox_events (
      id text primary key, type text not null, payload jsonb not null,
      status text not null default 'pending', attempts integer not null default 0,
      max_attempts integer not null default 5, last_error text, batch_id text,
      claim_token text, available_at timestamptz not null default now(),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
  });
  afterEach(async () => {
    await pool.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });
  it('renews a blocked handler and every row waiting behind it past the lease', async () => {
    const bus = createEventBus({ url: url!, leaseMs: 180 }, { pool });
    const competitor = createEventBus({ url: url!, leaseMs: 180 }, { pool });
    const started = gate(); const finish = gate();
    let calls = 0;
    await bus.subscribe('test', async () => { calls++; if (calls === 1) { started.release(); await finish.promise; } });
    await competitor.subscribe('test', async () => { calls++; });
    await bus.publish({ type: 'test', payload: {} });
    await bus.publish({ type: 'test', payload: {} });
    const running = bus.drain();
    await started.promise;
    let rival;
    try { await pause(600); rival = await competitor.drain(); }
    finally { finish.release(); await running; }
    expect(rival).toEqual({ processed: 0, failed: 0 });
    expect(calls).toBe(2);
  });
  it.each(['complete', 'retry', 'fail'] as const)('ignores stale %s after another worker claims the row', async (outcome) => {
    const bus = createEventBus({ url: url!, leaseMs: 60_000 }, { pool });
    const competitor = createEventBus({ url: url!, leaseMs: 60_000 }, { pool });
    const started = gate(); const finish = gate();
    await bus.subscribe('test', async () => { started.release(); await finish.promise; if (outcome !== 'complete') throw new Error('stale error'); });
    await bus.publish({ type: 'test', payload: {} });
    if (outcome === 'fail') await pool.query('update outbox_events set max_attempts=1');
    const running = bus.drain();
    await started.promise;
    await pool.query("update outbox_events set updated_at=now()-interval '1 hour'");
    await competitor.subscribe('test', async () => {});
    await competitor.drain();
    const before = (await pool.query('select status, attempts, last_error, claim_token from outbox_events')).rows;
    finish.release();
    expect(await running).toEqual({ processed: 0, failed: 0 });
    expect((await pool.query('select status, attempts, last_error, claim_token from outbox_events')).rows).toEqual(before);
  });
  it('skips waiting rows whose ownership changed before dispatch', async () => {
    const bus = createEventBus({ url: url!, leaseMs: 60_000 }, { pool });
    const competitor = createEventBus({ url: url!, leaseMs: 60_000 }, { pool });
    const started = gate(); const finish = gate();
    let calls = 0;
    await bus.subscribe('test', async () => { calls++; started.release(); await finish.promise; });
    await pool.query("insert into outbox_events(id,type,payload) values('a','test','{}'),('b','test','{}'),('c','missing','{}')");
    const running = bus.drain();
    await started.promise;
    await pool.query("update outbox_events set updated_at=now()-interval '1 hour'");
    await competitor.subscribe('test', async () => {});
    await competitor.subscribe('missing', async () => {});
    await competitor.drain();
    finish.release();
    expect(await running).toEqual({ processed: 0, failed: 0 });
    expect(calls).toBe(1);
    expect((await pool.query('select status from outbox_events')).rows).toEqual([{ status: 'done' }, { status: 'done' }, { status: 'done' }]);
  });
  it('reclaims a crashed owner and replaces its token', async () => {
    await pool.query("insert into outbox_events(id,type,payload,status,claim_token,updated_at) values('crash','test','{}','processing','dead',now()-interval '1 hour')");
    const bus = createEventBus({ url: url!, leaseMs: 180 }, { pool });
    await bus.subscribe('test', async () => {});
    expect(await bus.drain()).toEqual({ processed: 1, failed: 0 });
    expect((await pool.query('select status, attempts, claim_token from outbox_events')).rows).toEqual([{ status: 'done', attempts: 1, claim_token: null }]);
  });
});
