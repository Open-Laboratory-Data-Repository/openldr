// Live tests: these start real Postgres 16 servers from the bundled binaries.
// Run with STANDALONE_LIVE=1. Each test uses its own folder under the system temp folder and a
// port from 3990 to 3997, and everything it starts is stopped in afterEach.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  postgresUrls,
  startPostgres,
  stopLeftoverPostgres,
  type PostgresSettings,
  type RunningPostgres,
} from './postgres.js';

const LIVE = Boolean(process.env.STANDALONE_LIVE);
const PREFIX = 'openldr-sa-live-';
const PORTS = [3990, 3991, 3992, 3993, 3994, 3995, 3996, 3997];
const here = dirname(fileURLToPath(import.meta.url));

interface Case {
  root: string;
  clusterDir: string;
  logFile: string;
  settings: PostgresSettings;
}

const running: RunningPostgres[] = [];
const cases: Case[] = [];
const children: ChildProcess[] = [];
const servers: Server[] = [];

function secret(): string {
  // Characters that need encoding in a URL, so the URL builders are exercised for real.
  return `S${randomBytes(9).toString('hex')}:@/#?% x`;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen({ port, host: '127.0.0.1', exclusive: true }, () => s.close(() => resolve(true)));
  });
}

async function testPort(): Promise<number> {
  for (const p of PORTS) if (await portFree(p)) return p;
  throw new Error('no free port from 3990 to 3997');
}

async function newCase(sub?: string): Promise<Case> {
  const root = mkdtempSync(join(tmpdir(), PREFIX));
  const base = sub ? join(root, sub) : root;
  mkdirSync(base, { recursive: true });
  const c: Case = {
    root,
    clusterDir: join(base, 'postgres'),
    logFile: join(base, 'logs', 'postgres.log'),
    settings: { port: await testPort(), superPassword: secret(), appPassword: secret() },
  };
  cases.push(c);
  return c;
}

async function start(c: Case): Promise<RunningPostgres> {
  const r = await startPostgres({ clusterDir: c.clusterDir, logFile: c.logFile, settings: c.settings });
  running.push(r);
  return r;
}

async function query<T = Record<string, unknown>>(url: string, sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  client.on('error', () => {});
  await client.connect();
  try {
    return (await client.query(sql)).rows as T[];
  } finally {
    await client.end();
  }
}

async function one(url: string, sql: string): Promise<unknown> {
  const rows = await query(url, sql);
  return Object.values(rows[0] ?? {})[0];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitGone(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
}

/** This process and its parents. A shell that ran the tests can hold the folder prefix in its text. */
function selfAndParents(): Set<number> {
  const out = new Set<number>();
  let pid = process.pid;
  while (pid > 1 && !out.has(pid)) {
    out.add(pid);
    try {
      // Field 4 of /proc/<pid>/stat is the parent. The name in field 2 sits in parentheses.
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    } catch {
      break;
    }
  }
  return out;
}

/** Process IDs whose command line holds `needle`. Linux only, read from /proc. */
function procsWith(needle: string): number[] {
  const out: number[] = [];
  const skip = selfAndParents();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name) || skip.has(Number(name))) continue;
    try {
      const cmd = readFileSync(`/proc/${name}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (cmd.includes(needle)) out.push(Number(name));
    } catch {
      // the process went away while we looked
    }
  }
  return out;
}

afterEach(async () => {
  for (const r of running.splice(0)) await r.stop().catch(() => {});
  for (const ch of children.splice(0)) if (ch.exitCode === null && ch.signalCode === null) ch.kill('SIGKILL');
  for (const s of servers.splice(0)) if (s.listening) await new Promise((r) => s.close(r));
  for (const c of cases.splice(0)) {
    if (existsSync(c.clusterDir)) {
      await stopLeftoverPostgres({ clusterDir: c.clusterDir, settings: c.settings, waitMs: 30_000 }).catch(() => {});
    }
    // Last resort for a test that failed half way: anything still running from this test's own
    // temp folder was started by this test. Interrupt it, then kill it.
    for (const pid of procsWith(c.root)) process.kill(pid, 'SIGINT');
    for (const pid of procsWith(c.root)) if (!(await waitGone(pid, 10_000))) process.kill(pid, 'SIGKILL');
    rmSync(c.root, { recursive: true, force: true });
  }
}, 120_000);

afterAll(async () => {
  if (!LIVE) return;
  const end = Date.now() + 5000;
  while (procsWith(PREFIX).length > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  const left = procsWith(PREFIX).map((pid) => {
    try {
      return `${pid} ${readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')}`;
    } catch {
      return `${pid} (gone)`;
    }
  });
  expect(left).toEqual([]);
}, 10_000);

describe.skipIf(!LIVE)('bundled Postgres, live', { timeout: 120_000 }, () => {
  it('starts on an empty folder, creates both databases, and answers as the ordinary role', async () => {
    const c = await newCase();
    const pgr = await start(c);
    expect(pgr.pid).toBeGreaterThan(0);

    const url = pgr.internalUrl;
    expect(await one(url, 'select current_user')).toBe('openldr_app');
    expect(await one(url, 'select rolsuper from pg_roles where rolname = current_user')).toBe(false);
    expect(await one(url, 'select current_database()')).toBe('openldr');
    expect(await one(url, 'show server_encoding')).toBe('UTF8');
    // Postgres 16 removed the lc_collate setting, so the collation is read from pg_database.
    expect(
      await query(url, "select datname, datcollate, datctype from pg_database where datname like 'openldr%' order by datname"),
    ).toEqual([
      { datname: 'openldr', datcollate: 'C', datctype: 'C' },
      { datname: 'openldr_target', datcollate: 'C', datctype: 'C' },
    ]);
    expect(await one(url, 'show timezone')).toBe('UTC');
    expect(await one(url, 'show log_timezone')).toBe('UTC');
    expect(await one(url, 'show listen_addresses')).toBe('127.0.0.1');
    // The ordinary role may not read this setting, so the superuser reads it.
    const su = `postgres://postgres:${encodeURIComponent(c.settings.superPassword)}@127.0.0.1:${c.settings.port}/postgres`;
    expect(await one(su, 'show unix_socket_directories')).toBe('');
    expect(await one(url, 'show port')).toBe(String(c.settings.port));
    expect(
      await query(url, "select datname, pg_get_userbyid(datdba) as owner from pg_database where datname like 'openldr%' order by datname"),
    ).toEqual([
      { datname: 'openldr', owner: 'openldr_app' },
      { datname: 'openldr_target', owner: 'openldr_app' },
    ]);
    expect(
      await one(url, "select has_database_privilege('public', 'openldr', 'connect') or has_database_privilege('public', 'openldr_target', 'connect')"),
    ).toBe(false);
    expect(
      await query(
        url,
        "select rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin from pg_roles where rolname = 'openldr_app'",
      ),
    ).toEqual([
      { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true },
    ]);
    expect(await one(pgr.targetUrl, 'select current_database()')).toBe('openldr_target');
    expect(await one(pgr.targetUrl, 'select current_user')).toBe('openldr_app');
  });

  it('starts again on the same folder without running initdb, and keeps the data', async () => {
    const c = await newCase();
    const first = await start(c);
    await query(first.internalUrl, 'create table kept (v text)');
    await query(first.internalUrl, "insert into kept values ('still here')");
    await first.stop();
    expect(alive(first.pid)).toBe(false);
    running.splice(running.indexOf(first), 1);

    const second = await start(c);
    expect(second.pid).not.toBe(first.pid);
    expect(await one(second.internalUrl, 'select v from kept')).toBe('still here');
    const log = readFileSync(c.logFile, 'utf8');
    expect(log.match(/The files belonging to this database system will be owned by user/g)).toHaveLength(1);
  });

  it('works in a folder whose path has spaces and non-ASCII letters', async () => {
    const c = await newCase('Lab São José ñ');
    expect(c.clusterDir).toContain('Lab São José ñ');
    const pgr = await start(c);
    expect(await one(pgr.internalUrl, 'select 1 as one')).toBe(1);
    expect(await one(pgr.internalUrl, 'select current_user')).toBe('openldr_app');
    expect(existsSync(join(c.clusterDir, 'PG_VERSION'))).toBe(true);
  });

  it('refuses a taken port with a message that names it, and leaves nothing running', async () => {
    const c = await newCase();
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen({ port: c.settings.port, host: '127.0.0.1' }, resolve));
    servers.push(holder);

    const err = await start(c).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain(String(c.settings.port));
    expect(procsWith(c.root)).toEqual([]);
    expect(existsSync(join(c.clusterDir, 'postmaster.pid'))).toBe(false);
  });

  it('stops a leftover Postgres whose parent was killed, then starts clean', async () => {
    const c = await newCase();
    const code = [
      'const { startPostgres } = await import(process.env.SA_MODULE);',
      'const r = await startPostgres({ clusterDir: process.env.SA_CLUSTER, logFile: process.env.SA_LOG, settings: JSON.parse(process.env.SA_SETTINGS) });',
      "process.stdout.write(JSON.stringify({ pid: r.pid }) + '\\n');",
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
      cwd: join(here, '..'),
      // The settings go through the environment, never the command line, which `ps` shows.
      env: {
        ...process.env,
        SA_MODULE: new URL('./postgres.ts', import.meta.url).href,
        SA_CLUSTER: c.clusterDir,
        SA_LOG: c.logFile,
        SA_SETTINGS: JSON.stringify(c.settings),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let stderr = '';
    child.stderr!.on('data', (b: Buffer) => (stderr += b.toString()));
    const pid = await new Promise<number>((resolve, reject) => {
      let out = '';
      child.stdout!.on('data', (b: Buffer) => {
        out += b.toString();
        const line = out.split('\n').find((l) => l.startsWith('{'));
        if (line) resolve((JSON.parse(line) as { pid: number }).pid);
      });
      child.once('exit', (code) => reject(new Error(`child exited early (${code}): ${stderr}`)));
    });

    const { internalUrl } = postgresUrls(c.settings);
    await query(internalUrl, 'create table before_kill (v int)');
    await query(internalUrl, 'insert into before_kill values (7)');

    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
    expect(alive(pid)).toBe(true);

    expect(await stopLeftoverPostgres({ clusterDir: c.clusterDir, settings: c.settings })).toBe('stopped');
    expect(alive(pid)).toBe(false);
    expect(await stopLeftoverPostgres({ clusterDir: c.clusterDir, settings: c.settings })).toBe('none');

    const again = await start(c);
    expect(await one(again.internalUrl, 'select v from before_kill')).toBe(7);
  });

  it('stopSync makes Postgres exit without waiting', async () => {
    const c = await newCase();
    const pgr = await start(c);
    const t0 = performance.now();
    pgr.stopSync();
    const took = performance.now() - t0;
    expect(took).toBeLessThan(100);
    expect(await waitGone(pgr.pid, 15_000)).toBe(true);
    expect(existsSync(join(c.clusterDir, 'postmaster.pid'))).toBe(false);
  });

  it('the ordinary role cannot run a host command or read a host file', async () => {
    const c = await newCase();
    const pgr = await start(c);
    const q = (sql: string) => query(pgr.internalUrl, sql);
    await expect(q("copy (select 1) to program 'id'")).rejects.toThrow();
    await expect(q("select pg_read_file('/etc/hostname')")).rejects.toThrow();
    await expect(q("copy (select 1) to '/tmp/openldr-sa-should-not-exist'")).rejects.toThrow();
    await expect(q('create extension if not exists adminpack')).rejects.toThrow();
  });

  it('refuses a wrong password for both roles, and pg_hba.conf has no trust line', async () => {
    const c = await newCase();
    const pgr = await start(c);
    const base = { host: '127.0.0.1', port: c.settings.port };
    const login = (user: string, database: string, password: string) =>
      query(`postgres://${user}:${encodeURIComponent(password)}@${base.host}:${base.port}/${database}`, 'select 1');
    await expect(login('postgres', 'postgres', 'wrong')).rejects.toMatchObject({ code: '28P01' });
    await expect(login('openldr_app', 'openldr', 'wrong')).rejects.toMatchObject({ code: '28P01' });
    // The right passwords do work, so the refusals above are about the password.
    expect(await one(pgr.internalUrl, 'select 1 as ok')).toBe(1);
    expect(await login('postgres', 'postgres', c.settings.superPassword)).toEqual([{ '?column?': 1 }]);

    const hba = readFileSync(join(c.clusterDir, 'pg_hba.conf'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(hba.length).toBeGreaterThan(0);
    expect(hba.filter((l) => /\btrust\b/.test(l))).toEqual([]);
    for (const l of hba) expect(l).toMatch(/scram-sha-256$/);
  });

  it('never writes a password to the log file', async () => {
    const c = await newCase();
    const first = await start(c);
    await query(`postgres://openldr_app:wrong@127.0.0.1:${c.settings.port}/openldr`, 'select 1').catch(() => {});
    await first.stop();
    running.splice(running.indexOf(first), 1);
    const second = await start(c);
    await second.stop();
    running.splice(running.indexOf(second), 1);

    const log = readFileSync(c.logFile, 'utf8');
    expect(log.length).toBeGreaterThan(0);
    for (const s of [c.settings.superPassword, c.settings.appPassword]) {
      expect(log.includes(s)).toBe(false);
      expect(log.includes(encodeURIComponent(s))).toBe(false);
      expect(log.includes(s.slice(0, 19))).toBe(false);
    }
    expect(log).toMatch(/password authentication failed for user "openldr_app"/);
  });
});
