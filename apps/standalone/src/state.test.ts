import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSecretKey } from '@openldr/core';
import { newControlToken, startControl, type ControlServer } from './control.js';
import {
  AlreadyRunningError,
  StateFileError,
  acquireLock,
  ensureFolders,
  isLockLive,
  loadOrCreateState,
  pathsFor,
  readLock,
  releaseLock,
  resolveDataDir,
  type LockInfo,
  type StandalonePaths,
} from './state.js';

const dirs: string[] = [];
const controls: ControlServer[] = [];
const others: Server[] = [];
/** Folders a test made read-only. Made writable again before the temp folders are removed. */
const readOnlyDirs: string[] = [];
let paths: StandalonePaths;
let pickCalls = 0;
const pick = async () => {
  pickCalls += 1;
  return 54329;
};

async function tempRoot(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'openldr-sa-state-'));
  dirs.push(d);
  return d;
}

beforeEach(async () => {
  pickCalls = 0;
  paths = pathsFor(join(await tempRoot(), 'data'));
  await ensureFolders(paths);
});

afterEach(async () => {
  for (const d of readOnlyDirs.splice(0)) await chmod(d, 0o700).catch(() => {});
  await Promise.all(controls.splice(0).map((c) => c.close()));
  await Promise.all(others.splice(0).map((s) => new Promise<void>((r) => (s.listening ? s.close(() => r()) : r()))));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A lock held by a launcher whose control server is running. */
async function liveLock(pid: number): Promise<LockInfo> {
  const token = newControlToken();
  const c = await startControl({ token, onStop: async () => 'clean' });
  controls.push(c);
  return { pid, address: `http://127.0.0.1:${3990 + (pid % 8)}`, startedAt: new Date().toISOString(), controlPort: c.port, token };
}

/** A port that nothing listens on. */
async function deadPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function deadLock(): Promise<LockInfo> {
  return { pid: 999999, address: 'http://127.0.0.1:3990', startedAt: '2026-11-01T00:00:00.000Z', controlPort: await deadPort(), token: newControlToken() };
}

const mode = async (p: string) => (await stat(p)).mode & 0o777;
/** Windows has no Unix file modes. The mode tests do not run there, and the behaviour is unproven. */
const WINDOWS = process.platform === 'win32';
const leftovers = async () => (await readdir(paths.root)).filter((n) => n !== 'standalone.lock' && !['blobs', 'logs', 'crash', 'work'].includes(n));

describe('resolveDataDir', () => {
  it('prefers the flag, then OPENLDR_HOME, then the OS default', () => {
    expect(resolveDataDir({ flag: '/a', env: { OPENLDR_HOME: '/b' }, platform: 'linux', homedir: '/h' })).toBe('/a');
    expect(resolveDataDir({ env: { OPENLDR_HOME: '/b' }, platform: 'linux', homedir: '/h' })).toBe('/b');
    expect(resolveDataDir({ env: {}, platform: 'linux', homedir: '/h' })).toBe('/h/.local/share/openldr');
    expect(resolveDataDir({ env: { XDG_DATA_HOME: '/x' }, platform: 'linux', homedir: '/h' })).toBe('/x/openldr');
    expect(resolveDataDir({ env: {}, platform: 'darwin', homedir: '/h' })).toBe('/h/Library/Application Support/OpenLDR');
  });

  it('builds the Windows default from LOCALAPPDATA, else from the home folder (strings only, unproven on Windows)', () => {
    expect(resolveDataDir({ env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, platform: 'win32', homedir: 'C:\\Users\\u' })).toBe(
      'C:\\Users\\u\\AppData\\Local\\OpenLDR',
    );
    expect(resolveDataDir({ env: {}, platform: 'win32', homedir: 'C:\\Users\\u' })).toBe('C:\\Users\\u\\AppData\\Local\\OpenLDR');
  });

  it('makes a relative flag absolute', () => {
    expect(resolveDataDir({ flag: 'rel/data', env: {}, platform: 'linux', homedir: '/h' })).toBe(resolve(process.cwd(), 'rel/data'));
    expect(resolveDataDir({ env: { OPENLDR_HOME: 'rel/home' }, platform: 'linux', homedir: '/h' })).toBe(resolve(process.cwd(), 'rel/home'));
  });

  it('treats an empty flag or OPENLDR_HOME as unset, and ignores a relative XDG_DATA_HOME', () => {
    expect(resolveDataDir({ flag: '', env: { OPENLDR_HOME: '' }, platform: 'linux', homedir: '/h' })).toBe('/h/.local/share/openldr');
    expect(resolveDataDir({ env: { XDG_DATA_HOME: 'x' }, platform: 'linux', homedir: '/h' })).toBe('/h/.local/share/openldr');
  });
});

describe('folders and state file', () => {
  it('lays out the data folder', () => {
    const p = pathsFor('/d');
    expect(p).toEqual({
      root: '/d',
      cluster: '/d/postgres',
      blobs: '/d/blobs',
      logs: '/d/logs',
      crash: '/d/crash',
      work: '/d/work',
      stateFile: '/d/standalone.json',
      lockFile: '/d/standalone.lock',
      versionFile: '/d/last-version.json',
      serverLog: '/d/logs/server.log',
      postgresLog: '/d/logs/postgres.log',
    });
  });

  it.skipIf(WINDOWS)('creates the root owner-only and the state file owner-only', async () => {
    expect(await mode(paths.root)).toBe(0o700);
    for (const d of [paths.blobs, paths.logs, paths.crash, paths.work]) expect((await stat(d)).isDirectory()).toBe(true);
    await loadOrCreateState(paths, pick);
    expect(await mode(paths.stateFile)).toBe(0o600);
    expect(await leftovers()).toEqual(['standalone.json']);
  });

  it.skipIf(WINDOWS)('makes an existing data folder owner-only', async () => {
    const root = join(await tempRoot(), 'open');
    await mkdir(root, { mode: 0o755 });
    await chmod(root, 0o755);
    expect(await mode(root)).toBe(0o755);
    await ensureFolders(pathsFor(root));
    expect(await mode(root)).toBe(0o700);
  });

  it('creates a state with a key parseSecretKey accepts, and returns the same one next time', async () => {
    const first = await loadOrCreateState(paths, pick);
    expect(parseSecretKey(first.secretsKey)).toHaveLength(32);
    for (const pw of [first.pgSuperPassword, first.pgAppPassword]) {
      expect(pw).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(Buffer.from(pw, 'base64url')).toHaveLength(24);
    }
    expect(first.pgSuperPassword).not.toBe(first.pgAppPassword);
    expect(first).toMatchObject({ version: 1, pgPort: 54329 });
    const second = await loadOrCreateState(paths, pick);
    expect(second).toEqual(first);
    expect(pickCalls).toBe(1);
  });

  it('refuses a damaged state file and leaves it untouched', async () => {
    await writeFile(paths.stateFile, '{ not json');
    const err = await loadOrCreateState(paths, pick).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StateFileError);
    expect((err as Error).message).toContain(paths.stateFile);
    expect(await readFile(paths.stateFile, 'utf8')).toBe('{ not json');
  });

  it('refuses a state file with a missing field', async () => {
    const good = await loadOrCreateState(paths, pick);
    const { pgAppPassword: _gone, ...missing } = good;
    const bad: Record<string, unknown>[] = [
      missing,
      { ...good, version: 2 },
      { ...good, pgPort: 0 },
      { ...good, pgPort: 65536 },
      { ...good, pgPort: 5432.5 },
      { ...good, pgPort: '5432' },
      { ...good, secretsKey: '' },
      { ...good, pgSuperPassword: 7 },
    ];
    for (const shape of bad) {
      const text = JSON.stringify(shape);
      await writeFile(paths.stateFile, text);
      const err = await loadOrCreateState(paths, pick).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StateFileError);
      const message = (err as Error).message;
      expect(message).toContain(paths.stateFile);
      for (const secret of [good.secretsKey, good.pgSuperPassword, good.pgAppPassword]) expect(message).not.toContain(secret);
      expect(await readFile(paths.stateFile, 'utf8')).toBe(text);
    }
    await writeFile(paths.stateFile, '[]');
    await expect(loadOrCreateState(paths, pick)).rejects.toBeInstanceOf(StateFileError);
  });

  it('gives two callers at once the same state, the one on disk', async () => {
    const [a, b] = await Promise.all([loadOrCreateState(paths, pick), loadOrCreateState(paths, pick)]);
    expect(a).toEqual(b);
    expect(JSON.parse(await readFile(paths.stateFile, 'utf8'))).toEqual(a);
    expect(await leftovers()).toEqual(['standalone.json']);
  });

  it('refuses to make new secrets over an existing database', async () => {
    await mkdir(paths.cluster);
    await writeFile(join(paths.cluster, 'PG_VERSION'), '16\n');
    const err = await loadOrCreateState(paths, pick).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StateFileError);
    expect((err as Error).message).toContain(paths.stateFile);
    expect((err as Error).message).toContain(paths.cluster);
    expect(pickCalls).toBe(0);
    await expect(stat(paths.stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('lock', () => {
  it('reads null for a missing lock and for one that is not a lock', async () => {
    expect(await readLock(paths)).toBeNull();
    await writeFile(paths.lockFile, '{ not json');
    expect(await readLock(paths)).toBeNull();
    await writeFile(paths.lockFile, JSON.stringify({ pid: 1, address: 'a', startedAt: 's', controlPort: 0, token: 't' }));
    expect(await readLock(paths)).toBeNull();
  });

  it('reads the HTTP port when the lock has one, and still reads a lock written without it', async () => {
    const base = { pid: 1, address: 'http://localhost:80/studio/', startedAt: 's', controlPort: 40000, token: 't' };
    await writeFile(paths.lockFile, JSON.stringify({ ...base, httpPort: 80 }));
    expect(await readLock(paths)).toEqual({ ...base, httpPort: 80 });
    await writeFile(paths.lockFile, JSON.stringify(base));
    const old = await readLock(paths);
    expect(old).toEqual(base);
    expect(old).not.toHaveProperty('httpPort');
    await writeFile(paths.lockFile, JSON.stringify({ ...base, httpPort: 0 }));
    expect(await readLock(paths)).toBeNull();
  });

  it.skipIf(WINDOWS)('writes the lock owner-only and reads it back', async () => {
    const info = await liveLock(101);
    await acquireLock(paths, info);
    expect(await mode(paths.lockFile)).toBe(0o600);
    expect(await readLock(paths)).toEqual(info);
    expect(await leftovers()).toEqual([]);
  });

  it('refuses a second lock while the first control server runs, and names the process and address only', async () => {
    const first = await liveLock(101);
    await acquireLock(paths, first);
    const second = await liveLock(102);
    const err = await acquireLock(paths, second).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AlreadyRunningError);
    expect((err as AlreadyRunningError).info).toEqual(first);
    const message = (err as Error).message;
    expect(message).toContain('101');
    expect(message).toContain(first.address);
    for (const shown of [message, inspect(err), String(err)]) {
      expect(shown).not.toContain(first.token);
      expect(shown).not.toContain(second.token);
    }
    expect(await readLock(paths)).toEqual(first);
    expect(await leftovers()).toEqual([]);
  });

  it('replaces a lock whose control port has nothing listening', async () => {
    await writeFile(paths.lockFile, JSON.stringify(await deadLock()));
    const mine = await liveLock(103);
    await acquireLock(paths, mine);
    expect(await readLock(paths)).toEqual(mine);
    expect(await leftovers()).toEqual([]);
  });

  it('replaces a lock whose port is held by a server that does not know the token', async () => {
    const other = await liveLock(104);
    const impostor = { ...other, token: newControlToken() };
    await writeFile(paths.lockFile, JSON.stringify(impostor));
    // destroy, not end: a server that never reads never sees the client hang up.
    const stranger = createServer((s) => s.destroy());
    others.push(stranger);
    await new Promise<void>((r) => stranger.listen(0, '127.0.0.1', () => r()));
    const second = { ...impostor, controlPort: (stranger.address() as AddressInfo).port };
    const mine = await liveLock(105);
    await acquireLock(paths, mine);
    expect(await readLock(paths)).toEqual(mine);
    await writeFile(paths.lockFile, JSON.stringify(second));
    const mine2 = await liveLock(106);
    await acquireLock(paths, mine2);
    expect(await readLock(paths)).toEqual(mine2);
  });

  it('counts a lock as live when only the third ping is answered', async () => {
    let connections = 0;
    // Stands in for a launcher whose event loop is stalled: the first two pings get nothing.
    const stalled = createServer((s) => {
      connections += 1;
      if (connections <= 2) return void s.destroy();
      s.resume();
      s.end('pong\n');
    });
    others.push(stalled);
    await new Promise<void>((r) => stalled.listen(0, '127.0.0.1', () => r()));
    const held = { ...(await deadLock()), controlPort: (stalled.address() as AddressInfo).port };
    expect(await isLockLive(held)).toBe(true);
    expect(connections).toBe(3);

    connections = 0;
    await writeFile(paths.lockFile, JSON.stringify(held));
    const err = await acquireLock(paths, await liveLock(108)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AlreadyRunningError);
    expect(await readLock(paths)).toEqual(held);
  });

  it('counts a lock as dead only after three failed pings', async () => {
    let connections = 0;
    const deaf = createServer((s) => {
      connections += 1;
      s.destroy();
    });
    others.push(deaf);
    await new Promise<void>((r) => deaf.listen(0, '127.0.0.1', () => r()));
    const lock = { ...(await deadLock()), controlPort: (deaf.address() as AddressInfo).port };
    expect(await isLockLive(lock)).toBe(false);
    expect(connections).toBe(3);
    expect(await isLockLive(await deadLock())).toBe(false);
  });

  it('never makes fewer than one ping, a ping shorter than 100 ms, or a negative pause', async () => {
    const live = await liveLock(109);
    expect(await isLockLive(live, { attempts: 0 })).toBe(true);
    expect(await isLockLive(live, { attempts: -3, pingTimeoutMs: 0, pauseMs: -5 })).toBe(true);
    expect(await isLockLive(live, { attempts: Number.NaN, pingTimeoutMs: Number.NaN, pauseMs: Number.NaN })).toBe(true);
  });

  // A read-only folder needs Unix modes, so this does not run on Windows. Unproven there.
  it.skipIf(process.getuid?.() === 0 || WINDOWS)(
    'keeps the moved lock when putting a live one back fails, and names where it is',
    async () => {
      // The lock goes in a subfolder so that folder alone can be made read-only: the link back
      // then fails with EACCES while the moved copy, in the root, could still be deleted.
      const lockDir = join(paths.root, 'lockdir');
      await mkdir(lockDir);
      readOnlyDirs.push(lockDir);
      const p = { ...paths, lockFile: join(lockDir, 'standalone.lock') };

      const fresh = { ...(await deadLock()), pid: 2, token: newControlToken() };
      const freshServer = createServer((s) => {
        s.resume();
        void chmod(lockDir, 0o500).then(() => s.end('pong\n'));
      });
      others.push(freshServer);
      await new Promise<void>((r) => freshServer.listen(0, '127.0.0.1', () => r()));
      fresh.controlPort = (freshServer.address() as AddressInfo).port;

      // The dead lock's port: on the first ping, another launcher's fresh lock replaces it.
      let swapped = false;
      const deadServer = createServer((s) => {
        if (swapped) return void s.destroy();
        swapped = true;
        void writeFile(p.lockFile, JSON.stringify(fresh)).then(() => s.destroy());
      });
      others.push(deadServer);
      await new Promise<void>((r) => deadServer.listen(0, '127.0.0.1', () => r()));
      const dead = { ...(await deadLock()), controlPort: (deadServer.address() as AddressInfo).port };
      await writeFile(p.lockFile, JSON.stringify(dead));

      const err = await acquireLock(p, await liveLock(110), { pingTimeoutMs: 500, pauseMs: 5 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(AlreadyRunningError);
      const kept = (await readdir(paths.root)).filter((n) => n.startsWith('.standalone.lock.'));
      expect(kept).toHaveLength(1);
      const keptPath = join(paths.root, kept[0]!);
      expect(JSON.parse(await readFile(keptPath, 'utf8'))).toEqual(fresh);
      expect((err as Error).message).toContain(keptPath);
      expect((err as Error).message).not.toContain(fresh.token);
    },
  );

  it('replaces a lock file that is not a lock', async () => {
    await writeFile(paths.lockFile, 'garbage');
    const mine = await liveLock(107);
    await acquireLock(paths, mine);
    expect(await readLock(paths)).toEqual(mine);
  });

  it('lets only one of two acquires at once win on an empty folder', async () => {
    const a = await liveLock(201);
    const b = await liveLock(202);
    const results = await Promise.allSettled([acquireLock(paths, a), acquireLock(paths, b)]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]!.reason).toBeInstanceOf(AlreadyRunningError);
    const winner = results[0]!.status === 'fulfilled' ? a : b;
    expect(await readLock(paths)).toEqual(winner);
    expect(await leftovers()).toEqual([]);
  });

  it('lets only one of two acquires at once win over the same dead lock, 50 times', { timeout: 10000 }, async () => {
    // The dead lock's port is held by a server that drops each connection after 20 ms, so each
    // check of the dead lock takes about 70 ms (three pings, two 5 ms pauses). With a head start
    // of 0 to 27 ms, one acquire reads the dead lock while the other is already replacing it:
    // the window where unlink-then-create lets both win. Short timing keeps 50 rounds to a few
    // seconds; the production defaults are covered by the third-ping test.
    const fast = { pingTimeoutMs: 500, pauseMs: 5 };
    const slow = createServer((s) => void setTimeout(() => s.destroy(), 20));
    others.push(slow);
    await new Promise<void>((r) => slow.listen(0, '127.0.0.1', () => r()));
    const slowPort = (slow.address() as AddressInfo).port;
    for (let round = 0; round < 50; round += 1) {
      const dead = await deadLock();
      if (round % 2 === 0) dead.controlPort = slowPort;
      await writeFile(paths.lockFile, JSON.stringify(dead));
      const a = await liveLock(300 + round * 2);
      const b = await liveLock(301 + round * 2);
      const later = new Promise<void>((r) => setTimeout(r, (round % 10) * 3)).then(() => acquireLock(paths, b, fast));
      const results = await Promise.allSettled([acquireLock(paths, a, fast), later]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(won, `round ${round}`).toHaveLength(1);
      expect(lost[0]!.reason, `round ${round}`).toBeInstanceOf(AlreadyRunningError);
      const winner = results[0]!.status === 'fulfilled' ? a : b;
      expect(await readLock(paths), `round ${round}`).toEqual(winner);
      expect(await leftovers(), `round ${round}`).toEqual([]);
      await releaseLock(paths, winner.token);
      await Promise.all(controls.splice(0).map((c) => c.close()));
    }
  });

  it('releases only a lock that holds the given token', async () => {
    const info = await liveLock(401);
    await acquireLock(paths, info);
    await releaseLock(paths, newControlToken());
    expect(await readLock(paths)).toEqual(info);
    await releaseLock(paths, info.token);
    expect(await readLock(paths)).toBeNull();
    await releaseLock(paths, info.token); // nothing to release is not an error
  });
});
