import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { createEventBus } from './index';

/**
 * When Postgres restarts, every connection the bus holds dies and emits `error`. With no listener
 * that throws, and in the server it ended the process. The bus has two kinds of connection:
 * the pool's idle ones, and the one its worker keeps checked out to LISTEN on.
 */
const NOWHERE = 'postgres://u:p@127.0.0.1:5499/none';
const lost = () => new Error('terminating connection due to administrator command');

function listenSetup() {
  const makeClient = () => Object.assign(new EventEmitter(), {
    release: vi.fn(),
    query: vi.fn(async () => ({ rows: [] })),
  });
  // The worker's LISTEN connection is the first one taken. Later ones are the drain's own.
  const client = makeClient();
  let taken = 0;
  const pool = {
    connect: vi.fn(async () => (taken++ === 0 ? client : makeClient())),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    end: vi.fn(async () => {}),
  };
  return { client, pool };
}

describe('event bus and a lost connection', () => {
  it('a lost idle pool connection is reported and does not throw', async () => {
    const pool = new pg.Pool({ connectionString: NOWHERE });
    const told = vi.fn();
    const bus = createEventBus({ url: NOWHERE }, { pool, onConnectionError: told });
    const err = lost();
    expect(() => pool.emit('error', err)).not.toThrow();
    expect(told).toHaveBeenCalledWith(err);
    await bus.close();
  });

  it('a lost idle pool connection does not throw when nobody asked to be told', async () => {
    const pool = new pg.Pool({ connectionString: NOWHERE });
    const bus = createEventBus({ url: NOWHERE }, { pool });
    expect(() => pool.emit('error', lost())).not.toThrow();
    await bus.close();
  });

  it('a lost LISTEN connection is reported, given back to the pool as broken, and the worker keeps polling', async () => {
    vi.useFakeTimers();
    try {
      const { client, pool } = listenSetup();
      const told = vi.fn();
      const bus = createEventBus({ url: 'postgres://unused/test' }, { pool: pool as never, onConnectionError: told });
      const worker = bus.startWorker({ intervalMs: 20 });
      await vi.advanceTimersByTimeAsync(0);
      expect(client.query).toHaveBeenCalledWith('listen openldr_events');

      const err = lost();
      expect(() => client.emit('error', err)).not.toThrow();
      expect(told).toHaveBeenCalledWith(err);
      // `true` tells the pool to throw the connection away, not reuse it.
      expect(client.release).toHaveBeenCalledTimes(1);
      expect(client.release).toHaveBeenCalledWith(true);
      expect(client.listenerCount('notification')).toBe(0);

      // The interval is what keeps events moving from here on.
      const polls = pool.connect.mock.calls.length + pool.query.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60);
      expect(pool.connect.mock.calls.length + pool.query.mock.calls.length).toBeGreaterThan(polls);

      // Stopping must not use the dead connection again, or release it a second time.
      const queriesBeforeStop = client.query.mock.calls.length;
      await worker.stop();
      expect(client.query.mock.calls.length).toBe(queriesBeforeStop);
      expect(client.release).toHaveBeenCalledTimes(1);
      await bus.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
