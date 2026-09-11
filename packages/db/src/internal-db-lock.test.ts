import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';
import { createInternalDb } from './internal-db';

function fixture() {
  const client = Object.assign(new EventEmitter(), { query: vi.fn(), release: vi.fn() });
  const pool = { connect: vi.fn(async () => client), end: vi.fn(async () => {}) };
  const internal = createInternalDb('', { pool: pool as unknown as pg.Pool });
  return { client, internal };
}

describe('account status lock connection cleanup', () => {
  it('discards the connection when lock acquisition has an uncertain result', async () => {
    const f = fixture();
    f.client.query.mockRejectedValueOnce(new Error('connection interrupted'));
    await expect(f.internal.withAccountStatusLock('subject', async () => {})).rejects.toThrow('connection interrupted');
    expect(f.client.release).toHaveBeenCalledWith(true);
  });
  it('discards the connection when unlock fails', async () => {
    const f = fixture();
    f.client.query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockRejectedValueOnce(new Error('unlock interrupted'));
    await expect(f.internal.withAccountStatusLock('subject', async () => {})).rejects.toThrow('unlock interrupted');
    expect(f.client.release).toHaveBeenCalledWith(true);
  });
  it('unlocks after a callback failure and releases a healthy connection', async () => {
    const f = fixture();
    f.client.query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    await expect(f.internal.withAccountStatusLock('subject', async () => { throw new Error('provider failed'); })).rejects.toThrow('provider failed');
    expect(f.client.release).toHaveBeenCalledWith(false);
    expect(f.client.listenerCount('error')).toBe(0);
  });
  it('handles a checked-out connection error during provider work and discards it', async () => {
    const f = fixture();
    f.client.query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    await f.internal.withAccountStatusLock('subject', async () => { f.client.emit('error', new Error('socket closed')); });
    expect(f.client.release).toHaveBeenCalledWith(true);
    expect(f.client.listenerCount('error')).toBe(0);
  });
});
