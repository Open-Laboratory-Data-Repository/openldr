import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from './index';

function fakePool(impl: () => Promise<unknown>) {
  return { query: vi.fn(impl), end: vi.fn(async () => {}) };
}

describe('createEventBus', () => {
  it('shares a pending claim failure and allows a later drain to retry', async () => {
    let reject!: (error: Error) => void;
    const connecting = new Promise<never>((_resolve, rejectConnection) => { reject = rejectConnection; });
    const client = { query: async () => ({ rows: [] }), release() {} };
    const pool = {
      connect: vi.fn().mockReturnValueOnce(connecting).mockResolvedValue(client),
    };
    const bus = createEventBus({ url: 'postgres://x/y' }, { pool: pool as never });
    const first = bus.drain();
    const second = bus.drain();
    const results = Promise.allSettled([first, second]);
    const error = new Error('connection unavailable');
    reject(error);
    expect(await results).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ]);
    expect(await bus.drain()).toEqual({ processed: 0, failed: 0 });
  });

  it('reports up when pg_notify succeeds', async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const bus = createEventBus({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await bus.healthCheck();
    expect(r.status).toBe('up');
    expect(pool.query).toHaveBeenCalledWith("select pg_notify('openldr_health', 'ping')");
  });

  it('reports down when the connection fails', async () => {
    const pool = fakePool(async () => { throw new Error('ECONNREFUSED'); });
    const bus = createEventBus({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await bus.healthCheck();
    expect(r.status).toBe('down');
  });
});
