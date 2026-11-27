import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { ExclusiveBusy, runExclusive } from './exclusive';

// runExclusive takes a PostgreSQL advisory lock. pg-mem has none, so it is proved here on real
// PostgreSQL. Two Kysely instances with their own pools stand for two processes: the server and a
// CLI command. FHIR_SAVE_TEST_DATABASE_URL points at a server's maintenance database, as for
// relational-writer.live.test.ts. Nothing is created in it.
const url = process.env.FHIR_SAVE_TEST_DATABASE_URL;

describe.skipIf(!url)('runExclusive, on real PostgreSQL', () => {
  let a: Kysely<any>;
  let b: Kysely<any>;
  const make = (): Kysely<any> => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const name = (): string => `test:exclusive:${Math.random()}`;

  beforeAll(() => {
    a = make();
    b = make();
  });
  afterAll(async () => {
    await a?.destroy();
    await b?.destroy();
  });

  it('returns what the work returns', async () => {
    expect(await runExclusive(a, name(), 1000, async () => 7)).toBe(7);
  });

  it('runs two works of the same name one after the other, across two connections', async () => {
    const n = name();
    let inside = 0;
    let most = 0;
    const work = async (): Promise<void> => {
      inside++;
      most = Math.max(most, inside);
      await sleep(80);
      inside--;
    };
    await Promise.all([runExclusive(a, n, 5000, work), runExclusive(b, n, 5000, work), runExclusive(a, n, 5000, work)]);
    expect(most).toBe(1);
  });

  it('lets two different names run at the same time', async () => {
    let inside = 0;
    let most = 0;
    const work = async (): Promise<void> => {
      inside++;
      most = Math.max(most, inside);
      await sleep(80);
      inside--;
    };
    await Promise.all([runExclusive(a, name(), 5000, work), runExclusive(b, name(), 5000, work)]);
    expect(most).toBe(2);
  });

  it('gives up with ExclusiveBusy after the wait, never runs the second work, and leaves the holder alone', async () => {
    const n = name();
    let second = false;
    const holder = runExclusive(a, n, 5000, async () => {
      await sleep(600);
      return 'held';
    });
    await sleep(100);
    const started = Date.now();
    await expect(runExclusive(b, n, 150, async () => { second = true; })).rejects.toBeInstanceOf(ExclusiveBusy);
    expect(Date.now() - started).toBeLessThan(500);
    expect(second).toBe(false);
    expect(await holder).toBe('held');
  });

  it('frees the name when the work throws', async () => {
    const n = name();
    await expect(runExclusive(a, n, 1000, async () => { throw new Error('no'); })).rejects.toThrow('no');
    expect(await runExclusive(b, n, 300, async () => 'next')).toBe('next');
  });

  it('frees the name when the holder dies, with nothing to clean up', async () => {
    // A stopped process loses its database connection. PostgreSQL then drops the lock by itself.
    const n = name();
    // Its own pool: the killed connection raises an error on its client, which this test expects.
    // pg gives that error to nobody while a client is checked out and idle, so the test takes it.
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    pool.on('error', () => {});
    pool.on('connect', (client) => client.on('error', () => {}));
    const doomed = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    let release = (): void => {};
    const holder = runExclusive(doomed, n, 5000, () => new Promise<void>((done) => { release = done; })).then(
      () => 'finished',
      () => 'holder gone',
    );
    await sleep(100);
    await expect(runExclusive(b, n, 100, async () => 'too early')).rejects.toBeInstanceOf(ExclusiveBusy);
    const rows = await sql<{ pid: number }>`select pid from pg_locks where locktype = 'advisory' and granted and pid <> pg_backend_pid()`.execute(b);
    expect(rows.rows).toHaveLength(1);
    await sql`select pg_terminate_backend(${rows.rows[0]!.pid})`.execute(b);
    expect(await runExclusive(b, n, 1000, async () => 'next')).toBe('next');
    release();
    expect(await holder).toBe('holder gone');
    await doomed.destroy().catch(() => {});
  });

  it('does not leave the wait limit set on the connection', async () => {
    const one = new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1 }) }) });
    try {
      await runExclusive(one, name(), 1234, async () => undefined);
      const r = await sql<{ v: string }>`select current_setting('lock_timeout') as v`.execute(one);
      expect(r.rows[0]!.v).toBe('0');
    } finally {
      await one.destroy();
    }
  });
});
