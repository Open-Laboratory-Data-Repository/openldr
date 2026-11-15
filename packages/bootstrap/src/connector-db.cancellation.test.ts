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

it('queryReadOnly on mysql meets the deadline the way query does: KILL on a second connection, then the first is destroyed', async () => {
  vi.useFakeTimers();
  const sent: string[] = [];
  const killed: string[] = [];
  let originalOpen = true;
  const original = {
    threadId: 321,
    query: (sql: string) => { sent.push(sql); },
    release: vi.fn(),
    destroy: () => { originalOpen = false; },
  };
  const control = Object.assign(new EventEmitter(), {
    query: (sql: string, callback: (error: null) => void) => { killed.push(sql); callback(null); },
    destroy: () => {},
  });
  mocks.createPool.mockReturnValue({
    on: vi.fn(),
    getConnection: (callback: (error: null, connection: typeof original) => void) => callback(null, original),
    end: (callback: () => void) => callback(),
  });
  mocks.createConnection.mockReturnValue(control);
  const conn = createConnectorDb('mysql', {}, { queryTimeoutMs: 10 });
  let rejection: unknown;
  void conn.queryReadOnly('select sleep(5)').catch((error) => { rejection = error; });
  await vi.advanceTimersByTimeAsync(20);
  expect(sent).toEqual(['select sleep(5)']);
  expect(killed).toEqual(['KILL CONNECTION 321']);
  expect((rejection as Error).message).toBe('connector query deadline exceeded');
  expect(originalOpen).toBe(false);
  expect(original.release).not.toHaveBeenCalled();
  await conn.close();
});
