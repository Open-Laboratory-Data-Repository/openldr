import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from './index';

function setup() {
  const actions: string[] = [];
  let claimed = false;
  const client = Object.assign(new EventEmitter(), {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('select id')) {
        if (claimed) return { rows: [] };
        claimed = true;
        return { rows: [{ id: 'one', type: 'test', payload: {}, attempts: 0, max_attempts: 3, status: 'pending' }] };
      }
      return { rows: [] };
    }),
  });
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("status='done'")) actions.push('terminal write');
      return { rows: [], rowCount: 1 };
    }),
    end: vi.fn(async () => { actions.push('pool closed'); }),
  };
  const bus = createEventBus({ url: 'postgres://unused/test' }, { pool: pool as never });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const handler = vi.fn(async () => { entered(); await blocked; actions.push('handler finished'); });
  return { bus, pool, client, release, started, handler, actions };
}

describe('event bus shutdown', () => {
  it('close stops timer dispatch and drains a worker without a separate stop call', async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.bus.subscribe('test', s.handler);
    s.bus.startWorker({ intervalMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    await s.started;
    const closing = s.bus.close();
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(s.pool.end).not.toHaveBeenCalled();
      expect(s.handler).toHaveBeenCalledTimes(1);
    } finally {
      s.release();
      await closing;
      vi.useRealTimers();
    }
    expect(s.client.listenerCount('notification')).toBe(0);
    expect(s.actions).toEqual(['handler finished', 'terminal write', 'pool closed']);
  });

  it('concurrent stop calls release a connecting listener only once', async () => {
    let connected!: () => void;
    const pending = new Promise<void>((resolve) => { connected = resolve; });
    const client = { release: vi.fn(), query: vi.fn(), on: vi.fn() };
    const bus = createEventBus({ url: 'postgres://unused/test' }, {
      pool: { connect: async () => { await pending; return client; }, end: vi.fn() } as never,
    });
    const worker = bus.startWorker();
    const first = worker.stop();
    expect(worker.stop()).toBe(first);
    connected();
    await first;
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.query).not.toHaveBeenCalled();
    await bus.close();
  });

  it('stop waits for active work, removes notifications, and still permits manual drains', async () => {
    const s = setup();
    await s.bus.subscribe('test', s.handler);
    const worker = s.bus.startWorker({ intervalMs: 100_000 });
    await vi.waitFor(() => expect(s.client.listenerCount('notification')).toBe(1));
    s.client.emit('notification');
    await s.started;
    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(stopped).toBe(false);
    } finally {
      s.release();
      await stopping;
    }
    expect(s.client.listenerCount('notification')).toBe(0);
    const connects = s.pool.connect.mock.calls.length;
    s.client.emit('notification');
    expect(s.pool.connect).toHaveBeenCalledTimes(connects);
    await expect(s.bus.drain()).resolves.toEqual({ processed: 0, failed: 0 });
    await Promise.all([worker.stop(), worker.stop()]);
    await s.bus.close();
  });

  it('close waits for a manual drain and closes the pool exactly once', async () => {
    const s = setup();
    await s.bus.subscribe('test', s.handler);
    const draining = s.bus.drain();
    await s.started;
    const closing = s.bus.close();
    const again = s.bus.close();
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(s.pool.end).not.toHaveBeenCalled();
    } finally {
      s.release();
      await Promise.all([draining, closing, again]);
    }
    expect(s.actions).toEqual(['handler finished', 'terminal write', 'pool closed']);
    await expect(s.bus.drain()).rejects.toThrow('closing');
    expect(() => s.bus.startWorker()).toThrow('closing');
    expect(s.pool.end).toHaveBeenCalledTimes(1);
  });
});
