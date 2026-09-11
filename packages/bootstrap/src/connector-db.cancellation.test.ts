import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const mocks = vi.hoisted(() => ({ createPool: vi.fn(), createConnection: vi.fn() }));
vi.mock('mysql2', () => mocks);
import { createConnectorDb } from './connector-db';

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it.each(['constructor throws', 'control stalls', 'server refuses'])(
  'rejects and closes sockets when MySQL cancellation fails: %s',
  async (failure) => {
    vi.useFakeTimers();
    let originalOpen = true;
    let controlOpen = false;
    const original = {
      threadId: 123,
      query: vi.fn(),
      release: vi.fn(),
      destroy: () => { originalOpen = false; },
    };
    const control = Object.assign(new EventEmitter(), {
      query: (_sql: string, callback: (error: Error) => void) => {
        if (failure === 'server refuses') callback(new Error('permission denied'));
      },
      destroy: () => { controlOpen = false; },
    });
    mocks.createPool.mockReturnValue({
      on: vi.fn(),
      getConnection: (callback: (error: null, connection: typeof original) => void) => callback(null, original),
      end: (callback: () => void) => callback(),
    });
    mocks.createConnection.mockImplementation(() => {
      if (failure === 'constructor throws') throw new Error('cannot create cancellation connection');
      controlOpen = true;
      return control;
    });
    const conn = createConnectorDb('mysql', {}, { queryTimeoutMs: 10 });
    let rejection: unknown;
    void conn.query('select sleep(5)').catch((error) => { rejection = error; });
    await vi.advanceTimersByTimeAsync(1010);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toMatch(/deadline.*server cancellation failed/);
    expect(originalOpen).toBe(false);
    expect(controlOpen).toBe(false);
    await conn.close();
  },
);
