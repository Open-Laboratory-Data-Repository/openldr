import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findFreePort,
  isBindFailure,
  postgresUrls,
  readPostmasterPid,
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

function idleChild(): ChildProcess {
  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
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
  });

  it('reports stale when the pid belongs to a process with a different data folder', async () => {
    const d = tempDir();
    const other = tempDir();
    const c = idleChild();
    writePid(d, c.pid!, other);
    const port = await unusedPort();
    expect(await stopLeftoverPostgres({ clusterDir: d, settings: settings(port) })).toBe('stale');
    expect(alive(c.pid!)).toBe(true);
  });

  it('reports stale and signals nothing when the pid names a live process that is not Postgres', async () => {
    const d = tempDir();
    const c = idleChild();
    writePid(d, c.pid!, d);
    const port = await unusedPort();
    expect(await stopLeftoverPostgres({ clusterDir: d, settings: settings(port), waitMs: 2000 })).toBe('stale');
    expect(alive(c.pid!)).toBe(true);
    expect(c.exitCode).toBeNull();
    expect(c.signalCode).toBeNull();
  });

  it('reports stale when the cluster folder in the pid file no longer exists', async () => {
    const d = tempDir();
    const c = idleChild();
    const gone = join(tempDir(), 'missing');
    writePid(d, c.pid!, gone);
    expect(await stopLeftoverPostgres({ clusterDir: d, settings: settings(await unusedPort()) })).toBe('stale');
    expect(alive(c.pid!)).toBe(true);
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
