import { describe, it, expect, vi } from 'vitest';
import pg from 'pg';
import { createInternalDb } from './internal-db';

/**
 * A `pg.Pool` emits `error` when a connection it holds idle dies, as every idle connection does when
 * Postgres restarts. An emitter with no `error` listener throws, and in the server that ended the
 * process. The pool already drops the dead connection and opens a new one for the next query, so
 * the right answer is to report it and carry on.
 *
 * The pool here is never connected: making one opens no connection, and the URL points at nothing.
 */
const NOWHERE = 'postgres://u:p@127.0.0.1:5499/none';
const lost = () => new Error('terminating connection due to administrator command');

describe('createInternalDb and a lost idle connection', () => {
  it('tells onConnectionError and does not throw', async () => {
    const pool = new pg.Pool({ connectionString: NOWHERE });
    const told = vi.fn();
    const internal = createInternalDb(NOWHERE, { pool, onConnectionError: told });
    const err = lost();
    expect(() => pool.emit('error', err)).not.toThrow();
    expect(told).toHaveBeenCalledTimes(1);
    expect(told).toHaveBeenCalledWith(err);
    await internal.close();
  });

  it('does not throw when nobody asked to be told', async () => {
    const pool = new pg.Pool({ connectionString: NOWHERE });
    const internal = createInternalDb(NOWHERE, { pool });
    expect(() => pool.emit('error', lost())).not.toThrow();
    await internal.close();
  });

  it('accepts a stand-in pool that has no events at all', () => {
    const standIn = { connect: vi.fn(), end: vi.fn(async () => {}) };
    expect(() => createInternalDb(NOWHERE, { pool: standIn as never })).not.toThrow();
  });
});
