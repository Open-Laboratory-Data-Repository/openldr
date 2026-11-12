import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findFreePort,
  isBindFailure,
  postgresUrls,
  readPostmasterPid,
  startPostgres,
  stopLeftoverPostgres,
  type PostgresSettings,
} from './postgres.js';

const dirs: string[] = [];
const children: ChildProcess[] = [];
const servers: Server[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'openldr-sa-pure-'));
  dirs.push(d);
  return d;
}

function writePid(clusterDir: string, pid: number, dataDir: string): void {
  writeFileSync(join(clusterDir, 'postmaster.pid'), `${pid}\n${dataDir}\n1731400000\n5432\n\n127.0.0.1\n`);
}

const pidFile = (clusterDir: string) => join(clusterDir, 'postmaster.pid');

/**
 * A process that idles. `extra` goes after `--` on its command line; `argv0` replaces argv[0];
 * `cwd` is its working folder.
 */
function idleChild(extra: string[] = [], argv0?: string, cwd?: string): ChildProcess {
  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', ...extra], {
    stdio: 'ignore',
    ...(argv0 ? { argv0 } : {}),
    ...(cwd ? { cwd } : {}),
  });
  children.push(c);
  return c;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen({ port, host: '127.0.0.1' }, () => {
      servers.push(s);
      resolve(s);
    });
  });
}

function close(s: Server): Promise<void> {
  return new Promise((resolve) => s.close(() => resolve()));
}

async function unusedPort(): Promise<number> {
  const s = await listen(0);
  const port = (s.address() as { port: number }).port;
  await close(s);
  return port;
}

const settings = (port: number): PostgresSettings => ({ port, superPassword: 'su-x', appPassword: 'app-x' });

afterEach(async () => {
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  for (const s of servers.splice(0)) if (s.listening) await close(s);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('readPostmasterPid', () => {
  it('reads the pid and data folder from postmaster.pid', () => {
    const d = tempDir();
    writePid(d, 4242, '/some/where/postgres');
    expect(readPostmasterPid(d)).toEqual({ pid: 4242, dataDir: '/some/where/postgres' });
  });

  it('returns null for a missing or malformed postmaster.pid', () => {
    const d = tempDir();
    expect(readPostmasterPid(d)).toBeNull();
    writeFileSync(join(d, 'postmaster.pid'), 'not-a-pid\n/x\n');
    expect(readPostmasterPid(d)).toBeNull();
    writeFileSync(join(d, 'postmaster.pid'), '123\n');
    expect(readPostmasterPid(d)).toBeNull();
    writeFileSync(join(d, 'postmaster.pid'), '');
    expect(readPostmasterPid(d)).toBeNull();
    writeFileSync(join(d, 'postmaster.pid'), '0\n/x\n');
    expect(readPostmasterPid(d)).toBeNull();
  });
});

describe('stopLeftoverPostgres', () => {
  it('reports none when there is no pid file, and stale when the process is gone', async () => {
    const d = tempDir();
    const port = await unusedPort();
    expect(await stopLeftoverPostgres({ clusterDir: d, settings: settings(port) })).toBe('none');

    const c = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
    const pid = c.pid!;
    await new Promise((r) => c.once('exit', r));
    writePid(d, pid, d);
    expect(await stopLeftoverPostgres({ clusterDir: d, settings: settings(port) })).toBe('stale');
    // Postgres itself overwrites a pid file whose process is gone, so the file stays.
    expect(existsSync(pidFile(d))).toBe(true);
  });

  it('reports stale and removes the pid file when it names a different data folder', async () => {
    const d = tempDir();
    const other = tempDir();
    const c = idleChild();
    writePid(d, c.pid!, other);
    const port = await unusedPort();
    expect(await stopLeftoverPostgres({ clusterDir: d, settings: settings(port) })).toBe('stale');
    expect(alive(c.pid!)).toBe(true);
    expect(existsSync(pidFile(d))).toBe(false);
  });

  it('reports stale, signals nothing and removes the pid file when the pid names a live process that is not Postgres', async () => {
    const d = tempDir();
    // A stranger whose arguments hold `-D <this cluster>` but whose program is not postgres.
    const c = idleChild(['-D', d]);
    writePid(d, c.pid!, d);
    const port = await unusedPort();
    expect(await stopLeftoverPostgres({ clusterDir: d, settings: settings(port), waitMs: 2000 })).toBe('stale');
    expect(alive(c.pid!)).toBe(true);
    expect(c.exitCode).toBeNull();
    expect(c.signalCode).toBeNull();
    expect(existsSync(pidFile(d))).toBe(false);
  });

  it('removes the pid file when a process named postgres serves a different folder', async () => {
    const d = tempDir();
    const c = idleChild(['-D', tempDir()], '/opt/pg/bin/postgres');
    writePid(d, c.pid!, d);
    expect(await stopLeftoverPostgres({ clusterDir: d, settings: settings(await unusedPort()), waitMs: 2000 })).toBe('stale');
    expect(alive(c.pid!)).toBe(true);
    expect(existsSync(pidFile(d))).toBe(false);
  });

  it.runIf(process.platform === 'linux')(
    'keeps the pid file and rejects when the live process looks like a Postgres for this cluster',
    async () => {
      const d = tempDir();
      // argv[0] is a path ending in `postgres` and the arguments hold `-D <this cluster>`: the
      // command line a real postmaster for this folder shows in /proc.
      const c = idleChild(['-D', d], '/opt/pg/bin/postgres');
      writePid(d, c.pid!, d);
      const err = await stopLeftoverPostgres({ clusterDir: d, settings: settings(await unusedPort()), waitMs: 2000 }).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain(d);
      expect(err!.message).toContain(String(c.pid));
      expect(err!.message).not.toContain('su-x');
      expect(existsSync(pidFile(d))).toBe(true);
      expect(alive(c.pid!)).toBe(true);
    },
  );

  it.runIf(process.platform === 'linux')(
    'keeps the pid file and rejects when a postgres-named process works from this cluster with a relative -D',
    async () => {
      const d = tempDir();
      // A real postmaster works from inside its data folder, so a relative -D resolves to
      // <cluster>/<rel>. Only the working-folder test can see it is this cluster's Postgres.
      const c = idleChild(['-D', 'relative-data'], '/opt/pg/bin/postgres', d);
      writePid(d, c.pid!, d);
      const err = await stopLeftoverPostgres({ clusterDir: d, settings: settings(await unusedPort()), waitMs: 2000 }).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain(String(c.pid));
      expect(existsSync(pidFile(d))).toBe(true);
      expect(alive(c.pid!)).toBe(true);
    },
  );

  it.runIf(process.platform === 'linux')(
    'guards the line-2 mismatch path too: a Postgres working from this cluster under an old folder name keeps its file',
    async () => {
      const d = tempDir();
      const c = idleChild(['-D', 'relative-data'], '/opt/pg/bin/postgres', d);
      // Line 2 holds the path the cluster had before it was renamed.
      writePid(d, c.pid!, join(tempDir(), 'old-name'));
      const err = await stopLeftoverPostgres({ clusterDir: d, settings: settings(await unusedPort()), waitMs: 2000 }).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain(d);
      expect(existsSync(pidFile(d))).toBe(true);
      expect(alive(c.pid!)).toBe(true);
    },
  );

  it('reports stale and removes the pid file when the cluster folder it names no longer exists', async () => {
    const d = tempDir();
    const c = idleChild();
    const gone = join(tempDir(), 'missing');
    writePid(d, c.pid!, gone);
    expect(await stopLeftoverPostgres({ clusterDir: d, settings: settings(await unusedPort()) })).toBe('stale');
    expect(alive(c.pid!)).toBe(true);
    expect(existsSync(pidFile(d))).toBe(false);
  });
});

describe('cluster folder checks', () => {
  // Both tests hold their port open, so even code that skipped the folder checks would stop at
  // the port check and never start a Postgres from this test set.
  async function heldPort(): Promise<number> {
    const s = await listen(0);
    return (s.address() as { port: number }).port;
  }

  it('refuses a relative cluster folder in both startPostgres and stopLeftoverPostgres', async () => {
    const s = settings(await heldPort());
    await expect(startPostgres({ clusterDir: 'data/postgres', logFile: join(tempDir(), 'pg.log'), settings: s })).rejects.toThrow(
      /data\/postgres/,
    );
    await expect(stopLeftoverPostgres({ clusterDir: 'data/postgres', settings: s })).rejects.toThrow(/data\/postgres/);
    expect(existsSync(join(process.cwd(), 'data'))).toBe(false);
  });

  it('refuses a cluster folder that holds files but no PG_VERSION, and leaves it untouched', async () => {
    const root = tempDir();
    const clusterDir = join(root, 'postgres');
    mkdirSync(clusterDir);
    writeFileSync(join(clusterDir, 'stray.txt'), 'keep me');
    const logFile = join(root, 'logs', 'pg.log');
    await expect(startPostgres({ clusterDir, logFile, settings: settings(await heldPort()) })).rejects.toThrow(
      `${clusterDir} holds files`,
    );
    expect(readdirSync(clusterDir)).toEqual(['stray.txt']);
    expect(readFileSync(join(clusterDir, 'stray.txt'), 'utf8')).toBe('keep me');
  });
});

describe('findFreePort', () => {
  it('finds the preferred port when it is free and another when it is not', async () => {
    const free = await unusedPort();
    expect(await findFreePort(free)).toBe(free);

    const held = await listen(0);
    const heldPort = (held.address() as { port: number }).port;
    const got = await findFreePort(heldPort);
    expect(got).not.toBe(heldPort);
    expect(got).toBeGreaterThan(0);
  });
});

describe('postgresUrls', () => {
  it('encodes a password with special characters in both URLs', () => {
    const appPassword = 'a@b:c/d?e#f%g h';
    const urls = postgresUrls({ port: 54320, superPassword: 'unused', appPassword });
    for (const [url, db] of [
      [urls.internalUrl, 'openldr'],
      [urls.targetUrl, 'openldr_target'],
    ] as const) {
      const u = new URL(url);
      expect(u.protocol).toBe('postgres:');
      expect(u.username).toBe('openldr_app');
      expect(decodeURIComponent(u.password)).toBe(appPassword);
      expect(u.hostname).toBe('127.0.0.1');
      expect(u.port).toBe('54320');
      expect(u.pathname).toBe(`/${db}`);
      expect(url).toContain(encodeURIComponent(appPassword));
    }
  });
});

describe('isBindFailure', () => {
  it('spots the log lines Postgres writes when it cannot bind its port', () => {
    expect(isBindFailure('LOG:  could not bind IPv4 address "127.0.0.1": Address already in use\n')).toBe(true);
    expect(isBindFailure('FATAL:  could not create any TCP/IP sockets\n')).toBe(true);
    expect(isBindFailure('FATAL:  data directory "/x" has invalid permissions\n')).toBe(false);
  });
});
