import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@openldr/config';

// Layers. The first describe: the driver loop alone, with fake services and fake timers. The
// second: `createAppContext` itself, with the copy and import factories wrapped so their calls can
// be counted. Its database URL is unreachable on purpose, as in sync-start-wiring.test.ts, so every
// read a turn makes fails; the loop is what is under test, not a copy. Not covered here: a real
// copy over real Postgres (import-copy.test.ts covers the copy on pg-mem) and a real server start.

const seen = vi.hoisted(() => ({
  ticks: 0,
  copyDeps: [] as Array<{ driverId: string }>,
  importDeps: [] as Array<{ origin?: string }>,
}));

vi.mock('./import-copy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./import-copy')>();
  return {
    ...actual,
    createImportCopyService: (deps: Parameters<typeof actual.createImportCopyService>[0]) => {
      seen.copyDeps.push(deps);
      const svc = actual.createImportCopyService(deps);
      return { ...svc, tick: () => { seen.ticks += 1; return svc.tick(); } };
    },
  };
});

vi.mock('./import-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./import-run')>();
  return {
    ...actual,
    createImportService: (deps: Parameters<typeof actual.createImportService>[0]) => {
      seen.importDeps.push(deps);
      return actual.createImportService(deps);
    },
  };
});

import { startImportDriver } from './import-driver';
import { createAppContext, type AppContext } from './index';

/** A promise and the function that settles it. */
function gate<T = void>() {
  let open!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { open = resolve; });
  return { promise, open };
}

/** Fake services that log each call, in order. */
function fakes() {
  const log: string[] = [];
  const copies = {
    tick: vi.fn(async () => { log.push('tick'); }),
    idle: vi.fn(async () => { log.push('idle'); }),
    release: vi.fn(async () => { log.push('release'); }),
  };
  const imports = { adopt: vi.fn(async (_opts?: { signal?: AbortSignal }) => { log.push('adopt'); return []; }) };
  return { log, copies, imports };
}

describe('the import driver loop', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('the driver calls adopt then tick, and never starts a turn while one runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fakes();
    const held = gate();
    // The second turn's tick is slow: it runs across many intervals.
    let tickCalls = 0;
    f.copies.tick.mockImplementation(async () => {
      tickCalls += 1;
      f.log.push('tick');
      if (tickCalls === 2) await held.promise;
    });
    const driver = startImportDriver({ copies: f.copies, imports: f.imports, intervalMs: 5_000 });

    // The first turn runs at once.
    await vi.advanceTimersByTimeAsync(0);
    expect(f.log).toEqual(['adopt', 'tick']);
    // The next one comes 5 seconds after the first ended, not before.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(f.log).toEqual(['adopt', 'tick']);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.log).toEqual(['adopt', 'tick', 'adopt', 'tick']);
    // That tick is held. A minute passes and no turn starts beside it.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.log).toEqual(['adopt', 'tick', 'adopt', 'tick']);
    held.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.log).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.log).toEqual(['adopt', 'tick', 'adopt', 'tick', 'adopt', 'tick']);
    await driver.stop();
  });

  it('an error in one turn does not end the loop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fakes();
    const errors: unknown[] = [];
    const adoptFault = new Error('own database down');
    const tickFault = new Error('own database down again');
    f.imports.adopt.mockRejectedValueOnce(adoptFault);
    f.copies.tick.mockImplementationOnce(async () => { f.log.push('tick'); }).mockRejectedValueOnce(tickFault);
    const driver = startImportDriver({ copies: f.copies, imports: f.imports, intervalMs: 5_000, onError: (err) => { errors.push(err); } });

    await vi.advanceTimersByTimeAsync(0);
    // adopt failed, and tick still ran in the same turn.
    expect(errors).toEqual([adoptFault]);
    expect(f.copies.tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(errors).toEqual([adoptFault, tickFault]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.imports.adopt).toHaveBeenCalledTimes(3);
    expect(f.copies.tick).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(2);
    await driver.stop();
  });

  it('an onError that throws does not end the loop either', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fakes();
    f.copies.tick.mockRejectedValue(new Error('down'));
    const driver = startImportDriver({ copies: f.copies, imports: f.imports, intervalMs: 5_000, onError: () => { throw new Error('logger broke'); } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.copies.tick).toHaveBeenCalledTimes(3);
    await driver.stop();
  });

  it('stop waits for the copy in hand to save', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fakes();
    // release resolves when this process's drives have saved. Here that save is held.
    const saved = gate();
    f.copies.release.mockImplementation(async () => { f.log.push('release'); await saved.promise; f.log.push('saved'); });
    const driver = startImportDriver({ copies: f.copies, imports: f.imports, intervalMs: 5_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.log).toEqual(['adopt', 'tick']);

    let stopped = false;
    const stopping = driver.stop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.log).toEqual(['adopt', 'tick', 'release']);
    expect(stopped).toBe(false);
    // No new turn starts while it stops.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.log).toEqual(['adopt', 'tick', 'release']);
    expect(stopped).toBe(false);

    saved.open();
    await stopping;
    expect(f.log).toEqual(['adopt', 'tick', 'release', 'saved', 'idle']);
    // Stop is safe to call twice, and the loop stays ended.
    await driver.stop();
    expect(f.copies.release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.imports.adopt).toHaveBeenCalledTimes(1);
  });

  it('stop during a turn releases at once, waits for the turn, and starts no tick after it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fakes();
    const held = gate<[]>();
    f.imports.adopt.mockImplementation(async () => { f.log.push('adopt'); return held.promise; });
    const driver = startImportDriver({ copies: f.copies, imports: f.imports, intervalMs: 5_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.log).toEqual(['adopt']);
    const stopping = driver.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.log).toEqual(['adopt', 'release']);
    held.open([]);
    await stopping;
    expect(f.log).toEqual(['adopt', 'release', 'idle']);
    expect(f.copies.tick).not.toHaveBeenCalled();
  });

  it('a turn ticks the checks after the copies, and stop lets the checks go too', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fakes();
    const checks = {
      tick: vi.fn(async () => { f.log.push('check tick'); }),
      idle: vi.fn(async () => { f.log.push('check idle'); }),
      release: vi.fn(async () => { f.log.push('check release'); }),
    };
    const errors: unknown[] = [];
    // A copy tick that fails does not keep the checks from their turn.
    f.copies.tick.mockImplementationOnce(async () => { f.log.push('tick'); throw new Error('down'); });
    const driver = startImportDriver({ copies: f.copies, imports: f.imports, checks, intervalMs: 5_000, onError: (e) => { errors.push(e); } });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.log).toEqual(['adopt', 'tick', 'check tick']);
    expect(errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.log).toEqual(['adopt', 'tick', 'check tick', 'adopt', 'tick', 'check tick']);
    await driver.stop();
    expect(f.log.slice(6)).toEqual(['release', 'check release', 'idle', 'check idle']);
  });

  it('stop tells an adopt in hand to resume nothing more', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fakes();
    const held = gate<[]>();
    const signals: Array<AbortSignal | undefined> = [];
    f.imports.adopt.mockImplementation(async (opts) => { signals.push(opts?.signal); return held.promise; });
    const driver = startImportDriver({ copies: f.copies, imports: f.imports, intervalMs: 5_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    const stopping = driver.stop();
    // Told at once, while that adopt is still going through the runs.
    expect(signals[0]?.aborted).toBe(true);
    held.open([]);
    await stopping;
  });
});

const cfg: Config = Object.freeze({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  AUTH_ADAPTER: 'keycloak',
  AUTH_DEV_BYPASS: true,
  BLOB_ADAPTER: 'minio',
  EVENTING_ADAPTER: 'pg',
  TARGET_STORE_ADAPTER: 'pg',
  INTERNAL_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  TARGET_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  S3_ENDPOINT: 'http://127.0.0.1:9499',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'x',
  S3_SECRET_ACCESS_KEY: 'xxxxxxxx',
  S3_BUCKET: 'none',
  S3_FORCE_PATH_STYLE: true,
  OIDC_ISSUER_URL: 'http://127.0.0.1:8499/realms/master',
}) as Config;

describe('createAppContext and the import driver', () => {
  let ctx: AppContext | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
    seen.ticks = 0;
    seen.copyDeps.length = 0;
    seen.importDeps.length = 0;
  });

  it('a context built without runImportDriver never calls tick', async () => {
    // The CLI shape: every `openldr` command builds a context like this one.
    ctx = await createAppContext(cfg);
    expect(ctx.importCopies).toBeDefined();
    // A driver's first turn runs at once. Give it far longer than that.
    await new Promise((r) => setTimeout(r, 500));
    expect(seen.ticks).toBe(0);
    await ctx.close();
    expect(seen.ticks).toBe(0);
    expect(seen.importDeps.map((d) => d.origin)).toEqual(['cli']);
  }, 20_000);

  it('a context built with runImportDriver ticks, builds its services as the server, and stops ticking at close', async () => {
    // The server shape, so the test above is not true of a context that never ticks at all.
    ctx = await createAppContext(cfg, { runImportDriver: true });
    await vi.waitFor(() => expect(seen.ticks).toBeGreaterThan(0), { timeout: 5_000 });
    expect(seen.importDeps.map((d) => d.origin)).toEqual(['server']);
    expect(seen.copyDeps).toHaveLength(1);
    expect(seen.copyDeps[0].driverId).toMatch(/^[0-9a-f-]{36}$/);
    await ctx.close();
    const after = seen.ticks;
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.ticks).toBe(after);
  }, 20_000);

  it('each context gets its own driver id', async () => {
    const a = await createAppContext(cfg);
    const b = await createAppContext(cfg);
    try {
      expect(seen.copyDeps).toHaveLength(2);
      expect(seen.copyDeps[0].driverId).not.toBe(seen.copyDeps[1].driverId);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  }, 20_000);
});
