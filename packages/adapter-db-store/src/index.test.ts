import { describe, it, expect, vi } from 'vitest';
import pg from 'pg';
import { createDbStore } from './index';

// A pool emits `error` when a connection it holds idle dies, as all of them do when Postgres
// restarts. With no listener that throws, and in the server it ended the process. These pools are
// never connected: making one opens no connection, and the URL points at nothing.
describe('createDbStore and a lost idle connection', () => {
  const NOWHERE = 'postgres://u:p@127.0.0.1:5499/none';
  const lost = () => new Error('terminating connection due to administrator command');

  it('tells onConnectionError and does not throw', async () => {
    const pool = new pg.Pool({ connectionString: NOWHERE });
    const told = vi.fn();
    const store = createDbStore({ url: NOWHERE }, { pool, onConnectionError: told });
    const err = lost();
    expect(() => pool.emit('error', err)).not.toThrow();
    expect(told).toHaveBeenCalledWith(err);
    await store.close();
  });

  it('does not throw when nobody asked to be told', async () => {
    const pool = new pg.Pool({ connectionString: NOWHERE });
    const store = createDbStore({ url: NOWHERE }, { pool });
    expect(() => pool.emit('error', lost())).not.toThrow();
    await store.close();
  });
});

function fakePool(impl: () => Promise<unknown>) {
  return { query: vi.fn(impl), end: vi.fn(async () => {}) };
}

describe('createDbStore', () => {
  it('reports up when SELECT 1 succeeds', async () => {
    const pool = fakePool(async () => ({ rows: [{ '?column?': 1 }] }));
    const store = createDbStore({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await store.healthCheck();
    expect(r.status).toBe('up');
    expect(pool.query).toHaveBeenCalledWith('select 1');
  });

  it('reports down when the query throws', async () => {
    const pool = fakePool(async () => { throw new Error('ECONNREFUSED'); });
    const store = createDbStore({ url: 'postgres://x/y' }, { pool: pool as never });
    const r = await store.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('ECONNREFUSED');
  });
});
