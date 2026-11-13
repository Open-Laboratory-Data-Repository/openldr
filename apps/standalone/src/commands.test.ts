import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@openldr/config';
import type { RunningServer } from '@openldr/server/start';
import {
  FORCED_STOP_ERROR,
  RECOVERY_DONE,
  RECOVERY_NOTICE,
  STOP_WAIT_MS,
  StopError,
  UsageError,
  cliEntryFile,
  handleSignals,
  launcherFiles,
  parseCommandLine,
  runCli,
  runStart,
  runStatus,
  runStop,
  servedAddress,
  type CliDeps,
  type Launcher,
  type LauncherDeps,
} from './commands.js';
import { newControlToken, requestStop, startControl, type ControlServer } from './control.js';
import { postgresUrls, type PostgresSettings } from './postgres.js';
import { acquireLock, isLockLive, pathsFor, readLock, type StandalonePaths } from './state.js';

// The CLI program is replaced, so a test can see what a CLI command would load without a database.
// commandKindOf is the real one: it reads the real command table, so `doctor` is a recovery command
// here and `layouts list` is not.
const cli = vi.hoisted(() => ({
  calls: [] as string[][],
  run: undefined as undefined | ((argv: string[]) => Promise<void>),
}));
vi.mock('@openldr/cli/program', async (importOriginal) => ({
  commandKindOf: (await importOriginal<typeof import('@openldr/cli/program')>()).commandKindOf,
  buildClientProgram: () => ({
    parseAsync: async (argv: string[]) => {
      cli.calls.push(argv);
      await cli.run?.(argv);
    },
  }),
}));

/**
 * The HTTP port the launcher under test checks. Nothing listens on it but the bind check. The
 * operating system picks it for each test, so a real run or another checkout's tests on this
 * computer cannot collide with it.
 */
let PORT: number;
/** A port a test holds, to see the launcher refuse it. Also picked for each test. */
let HELD: number;
const SETUP_CODE = 'TEST-SETUP-CODE-7Q2X';
const CLI_ENTRY = join('/', 'opt', 'openldr', 'standalone', 'dist', 'cli.js');
let ADDRESS: string;
const STARTED_AT = new Date('2026-11-13T08:00:00.000Z');

const WATCHED_EVENTS = ['exit', 'uncaughtException', 'unhandledRejection', 'SIGINT', 'SIGTERM'] as const;

let root: string;
let studio: string;
let cwd: string;
let paths: StandalonePaths;
let settings: PostgresSettings;
let state: { version: 1; secretsKey: string; pgPort: number; pgSuperPassword: string; pgAppPassword: string };

let envBefore: NodeJS.ProcessEnv;
let cwdBefore: string;
let exitCodeBefore: typeof process.exitCode;
let listenersBefore: Record<string, number>;
let tcpServersBefore: number;
const launchers: Launcher[] = [];
const held: Server[] = [];
const controls: ControlServer[] = [];

function listenerCounts(): Record<string, number> {
  return Object.fromEntries(WATCHED_EVENTS.map((e) => [e, process.listenerCount(e)]));
}

function tcpServers(): number {
  return process.getActiveResourcesInfo().filter((r) => r === 'TCPServerWrap').length;
}

beforeAll(async () => {
  // runStart loads @openldr/bootstrap for the setup code. Loading it adds an exit listener of
  // its own, once per process. Loaded here, so the listener counts below see only runStart's.
  await import('@openldr/bootstrap');
});

beforeEach(async () => {
  envBefore = { ...process.env };
  cwdBefore = process.cwd();
  exitCodeBefore = process.exitCode;
  listenersBefore = listenerCounts();
  tcpServersBefore = tcpServers();
  cli.calls = [];
  cli.run = undefined;
  [PORT, HELD] = await twoFreePorts();
  ADDRESS = `http://localhost:${PORT}/studio/`;

  root = await mkdtemp(join(tmpdir(), 'sa-commands-'));
  studio = await mkdtemp(join(tmpdir(), 'sa-studio-'));
  cwd = await mkdtemp(join(tmpdir(), 'sa-cwd-'));
  await writeFile(join(studio, 'index.html'), '<!doctype html>');
  // Every test runs from an empty folder under the temp folder. From the worktree, a .env search
  // that walks up would find the developer's own .env.
  process.chdir(cwd);
  paths = pathsFor(root);
  // A state file made ahead, so the launcher does not go looking for a free Postgres port.
  state = {
    version: 1,
    secretsKey: randomBytes(32).toString('base64'),
    pgPort: 55432,
    pgSuperPassword: `super${randomBytes(12).toString('hex')}`,
    pgAppPassword: `app${randomBytes(12).toString('hex')}`,
  };
  settings = { port: state.pgPort, superPassword: state.pgSuperPassword, appPassword: state.pgAppPassword };
  await writeFile(paths.stateFile, `${JSON.stringify(state)}\n`, { mode: 0o600 });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    launchers.splice(0).map(async (l) => {
      await l.stop(true).catch(() => {});
      await l.done.catch(() => {});
    }),
  );
  await Promise.all(controls.splice(0).map((c) => c.close()));
  await Promise.all(held.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  process.chdir(cwdBefore);
  for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
  Object.assign(process.env, envBefore);
  process.exitCode = exitCodeBefore;
  for (const dir of [root, studio, cwd]) await rm(dir, { recursive: true, force: true });
  expect(listenerCounts()).toEqual(listenersBefore);
  await vi.waitFor(() => expect(tcpServers()).toBe(tcpServersBefore), { timeout: 3000 });
});

interface Fakes {
  order: string[];
  printed: string[];
  /** Lines written with printNow, the crash path's terminal line. */
  printedNow: string[];
  /** The test runner's own crash listeners, taken before the launcher starts. */
  outside: Map<'uncaughtException' | 'unhandledRejection', Listener[]>;
  pg: {
    started: boolean;
    stopped: boolean;
    stopSyncCalls: number;
    startOpts?: unknown;
    leftoverOpts?: unknown;
    /** The Postgres process goes: `exited` settles. */
    die: () => void;
  };
  server: { started: boolean; closed: boolean; cfg?: Config };
  deps: LauncherDeps;
}

/**
 * What Postgres stopping under a running server does: the server's database connections fail,
 * and one without an error listener becomes an uncaught exception. Emitted on the process with
 * the test runner's own listeners taken off for that moment, so only the launcher's see it.
 */
type Listener = (...args: unknown[]) => void;
const CRASH_EVENTS = ['uncaughtException', 'unhandledRejection'] as const;

/** The crash listeners present now: the test runner's own, before a launcher adds any. */
function outsideCrashListeners(): Map<(typeof CRASH_EVENTS)[number], Listener[]> {
  return new Map(CRASH_EVENTS.map((k) => [k, process.listeners(k as 'uncaughtException') as Listener[]]));
}

function emitConnectionErrors(outside: Map<(typeof CRASH_EVENTS)[number], Listener[]>): void {
  for (const [k, ls] of outside) for (const l of ls) process.off(k, l);
  try {
    process.emit('uncaughtException', new Error('terminating connection due to administrator command'));
    process.emit('unhandledRejection', new Error('Connection terminated unexpectedly'), Promise.resolve());
  } finally {
    for (const [k, ls] of outside) for (const l of ls) process.on(k, l);
  }
}

function fakes(
  o: { setupRequired?: boolean; closeNever?: boolean; setupFails?: boolean; pgStopFails?: boolean; pgStopEmits?: boolean } = {},
): Fakes {
  const f: Fakes = {
    order: [],
    printed: [],
    printedNow: [],
    outside: undefined as unknown as Fakes['outside'],
    pg: { started: false, stopped: false, stopSyncCalls: 0, die: () => {} },
    server: { started: false, closed: false },
    deps: undefined as unknown as LauncherDeps,
  };
  const exited = new Promise<void>((resolve) => (f.pg.die = resolve));
  // Taken before the launcher starts, so these are the test runner's own.
  const outside = outsideCrashListeners();
  f.outside = outside;
  const context = {
    localSignIn: {
      setupRequired: async () => Boolean(o.setupRequired),
      createSetupCode: async () => {
        if (o.setupFails) throw new Error('setup code boom');
        return SETUP_CODE;
      },
    },
  };
  f.deps = {
    stopLeftoverPostgres: (async (opts: unknown) => {
      f.order.push('pg.leftover');
      f.pg.leftoverOpts = opts;
      return 'none' as const;
    }) as LauncherDeps['stopLeftoverPostgres'],
    startPostgres: (async (opts: { clusterDir: string; logFile: string; settings: PostgresSettings }) => {
      f.order.push('pg.start');
      f.pg.started = true;
      f.pg.startOpts = opts;
      return {
        pid: 999_999,
        ...postgresUrls(opts.settings),
        stop: async () => {
          f.order.push((await readLock(paths)) ? 'pg.stop' : 'pg.stop (lock already gone)');
          if (o.pgStopEmits) emitConnectionErrors(outside);
          if (o.pgStopFails) throw new Error(`postgres would not stop, password ${opts.settings.appPassword}`);
          f.pg.stopped = true;
          f.pg.die();
        },
        stopSync: () => {
          f.pg.stopSyncCalls += 1;
        },
        exited,
      };
    }) as LauncherDeps['startPostgres'],
    startServer: async (cfg, logger) => {
      f.order.push('server.start');
      f.server.started = true;
      f.server.cfg = cfg;
      logger.info('fake server started');
      return {
        address: `http://127.0.0.1:${cfg.PORT}`,
        context,
        close: () => {
          f.order.push(f.pg.stopped ? 'server.close (Postgres already stopped)' : 'server.close');
          if (o.closeNever) return new Promise<void>(() => {});
          f.server.closed = true;
          return Promise.resolve();
        },
      } as unknown as RunningServer;
    },
    print: (line) => f.printed.push(line),
    printNow: (line) => f.printedNow.push(line),
    now: () => STARTED_AT,
    studioDist: studio,
    appVersion: '0.1.11',
    cliEntry: CLI_ENTRY,
  };
  return f;
}

async function start(deps: LauncherDeps, extra: { port?: number; host?: string } = {}): Promise<Launcher> {
  const l = await runStart({ dataDir: root, port: extra.port ?? PORT, host: extra.host ?? '127.0.0.1' }, deps);
  launchers.push(l);
  return l;
}

async function stopped(l: Launcher, force = false): Promise<'clean' | 'forced'> {
  const result = await l.stop(force);
  launchers.splice(launchers.indexOf(l), 1);
  await l.done;
  return result;
}

async function hold(port: number): Promise<void> {
  const s = createServer();
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject);
    s.listen({ port, host: '127.0.0.1' }, () => resolve());
  });
  held.push(s);
}

async function deadPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** Two different ports the operating system picked, both free again when this returns. */
async function twoFreePorts(): Promise<[number, number]> {
  const servers = [createServer(), createServer()];
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))));
  const ports = servers.map((s) => (s.address() as AddressInfo).port);
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  return [ports[0]!, ports[1]!];
}

/** What a failed start must leave: no lock, no Postgres, and (checked in afterEach) no listener. */
async function expectNothingLeft(f: Fakes): Promise<void> {
  expect(await readLock(paths)).toBeNull();
  if (f.pg.started) expect(f.pg.stopped).toBe(true);
  if (f.server.started) expect(f.server.closed).toBe(true);
}

describe('runStart', () => {
  it('starts Postgres, then the server, and prints the address and the log path', async () => {
    const f = fakes();
    const l = await start(f.deps);

    expect(f.order).toEqual(['pg.leftover', 'pg.start', 'server.start']);
    expect(f.pg.leftoverOpts).toEqual({ clusterDir: paths.cluster, settings });
    expect(f.pg.startOpts).toEqual({
      clusterDir: paths.cluster,
      logFile: paths.postgresLog,
      settings,
      onRecovering: expect.any(Function),
    });
    expect(f.printed).toEqual([`OpenLDR is running at ${ADDRESS}`, `Server log: ${paths.serverLog}`]);
    expect(f.server.cfg).toMatchObject({
      PORT,
      LISTEN_HOST: '127.0.0.1',
      AUTH_ADAPTER: 'local',
      BLOB_ADAPTER: 'fs',
      BLOB_DIR: paths.blobs,
      MIGRATE_ON_START: true,
      SEED_ON_START: false,
      INTERNAL_DATABASE_URL: postgresUrls(settings).internalUrl,
      TARGET_DATABASE_URL: postgresUrls(settings).targetUrl,
    });
    expect(await readLock(paths)).toMatchObject({ pid: process.pid, address: ADDRESS, startedAt: STARTED_AT.toISOString() });
    expect(l.address).toBe(ADDRESS);
  });

  it('prints a setup code when the install needs its first administrator, and none when it does not', async () => {
    const first = fakes({ setupRequired: true });
    await stopped(await start(first.deps));
    expect(first.printed).toEqual([
      `No administrator exists yet. Open the address and enter this setup code: ${SETUP_CODE}`,
      'The setup code is valid for 30 minutes. For a new one run: openldr-standalone cli -- auth setup-code',
      `OpenLDR is running at ${ADDRESS}`,
      `Server log: ${paths.serverLog}`,
    ]);

    const second = fakes({ setupRequired: false });
    await start(second.deps);
    expect(second.printed.join('\n')).not.toContain('setup code');
    expect(second.printed.join('\n')).not.toContain(SETUP_CODE);
  });

  it('never writes the setup code to the server log file', async () => {
    const f = fakes({ setupRequired: true });
    await start(f.deps);
    const log = await readFile(paths.serverLog, 'utf8');
    // The log is the file the server logged to, and it holds no setup code.
    expect(log).toContain('fake server started');
    expect(log).not.toContain(SETUP_CODE);
    expect(f.printed.join('\n')).toContain(SETUP_CODE);
  });

  it('prints one line when Postgres says it is recovering', async () => {
    const f = fakes();
    const startPostgres = f.deps.startPostgres;
    f.deps.startPostgres = async (opts) => {
      opts.onRecovering?.();
      return startPostgres(opts);
    };
    await start(f.deps);
    expect(f.printed).toEqual([
      'The database is recovering after an unclean stop. This can take a few minutes.',
      `OpenLDR is running at ${ADDRESS}`,
      `Server log: ${paths.serverLog}`,
    ]);
  });

  it('stops Postgres and releases the lock when the server fails to start', async () => {
    const f = fakes();
    f.deps.startServer = async () => {
      throw new Error('boom');
    };
    await expect(runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, f.deps)).rejects.toThrow('boom');
    expect(f.pg.stopped).toBe(true);
    expect(await readLock(paths)).toBeNull();
  });

  it('reports a taken HTTP port before starting Postgres', async () => {
    await hold(HELD);
    const f = fakes();
    await expect(runStart({ dataDir: root, port: HELD, host: '127.0.0.1' }, f.deps)).rejects.toThrowError(
      new RegExp(`^Port ${HELD} is already in use\\. Choose another with --port\\.$`),
    );
    expect(f.pg.started).toBe(false);
    expect(f.order).toEqual([]);
    await expectNothingLeft(f);
  });

  it('gives the same port message when the server itself finds the port taken', async () => {
    const f = fakes();
    f.deps.startServer = async () => {
      throw Object.assign(new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${PORT}`), { code: 'EADDRINUSE' });
    };
    await expect(runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, f.deps)).rejects.toThrowError(
      new RegExp(`^Port ${PORT} is already in use\\. Choose another with --port\\.$`),
    );
    await expectNothingLeft(f);
  });

  it('refuses a second start on the same folder and names the first', async () => {
    await start(fakes().deps);
    const lockBefore = await readLock(paths);

    const second = fakes();
    await expect(runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, second.deps)).rejects.toThrowError(
      new RegExp(`^OpenLDR is already running \\(process ${process.pid}\\) at http://localhost:${PORT}/studio/\\.$`),
    );
    expect(second.pg.started).toBe(false);
    // The first launcher's lock is untouched.
    expect(await readLock(paths)).toEqual(lockBefore);
  });

  it('fails before starting anything when the studio is not built', async () => {
    await rm(join(studio, 'index.html'));
    const f = fakes();
    await expect(runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, f.deps)).rejects.toThrowError(
      /^The studio is not built\. Run: pnpm --filter @openldr\/studio build$/,
    );
    expect(f.order).toEqual([]);
    await expectNothingLeft(f);
  });

  it('stops the server before Postgres', async () => {
    const f = fakes();
    const l = await start(f.deps);
    expect(await stopped(l)).toBe('clean');
    if (!(await readLock(paths))) f.order.push('lock.release');
    expect(f.order.slice(3)).toEqual(['server.close', 'pg.stop', 'lock.release']);
  });

  it('runs the stop once when it is called twice', async () => {
    const f = fakes();
    const l = await start(f.deps);
    const [a, b] = await Promise.all([l.stop(), l.stop()]);
    launchers.splice(launchers.indexOf(l), 1);
    expect([a, b]).toEqual(['clean', 'clean']);
    expect(await l.done).toBe('clean');
    expect(f.order.filter((s) => s.startsWith('server.close'))).toHaveLength(1);
    expect(f.order.filter((s) => s.startsWith('pg.stop'))).toHaveLength(1);
  });

  it('a stop request during the start waits for the start, then stops everything', async () => {
    const f = fakes();
    const startServer = f.deps.startServer;
    let asked: Promise<'clean' | 'forced'> | undefined;
    f.deps.startServer = async (cfg, logger) => {
      asked = requestStop((await readLock(paths))!, 10_000);
      await new Promise((r) => setTimeout(r, 200));
      return startServer(cfg, logger);
    };
    const l = await runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, f.deps);
    expect(await asked).toBe('clean');
    expect(await l.done).toBe('clean');
    expect(f.order).toEqual(['pg.leftover', 'pg.start', 'server.start', 'server.close', 'pg.stop']);
    expect(f.server.closed).toBe(true);
    expect(await readLock(paths)).toBeNull();
  });

  it('forces after 60 seconds when the server will not close', async () => {
    expect(STOP_WAIT_MS).toBe(60_000);
    const f = fakes({ closeNever: true });
    const l = await start(f.deps);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = l.stop();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS - 1);
    expect(f.pg.stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('forced');
    vi.useRealTimers();
    expect(f.pg.stopped).toBe(true);
    expect(await readLock(paths)).toBeNull();
    launchers.splice(launchers.indexOf(l), 1);
    expect(await l.done).toBe('forced');
  });

  it('skips the wait on a forced stop', async () => {
    const f = fakes({ closeNever: true });
    const l = await start(f.deps);
    const t0 = Date.now();
    expect(await stopped(l, true)).toBe('forced');
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(f.pg.stopped).toBe(true);
    expect(await readLock(paths)).toBeNull();
  });

  it('a forced stop cuts short a stop that is already waiting', async () => {
    const f = fakes({ closeNever: true });
    const l = await start(f.deps);
    const first = l.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(f.pg.stopped).toBe(false);
    const t0 = Date.now();
    const second = l.stop(true);
    expect(await second).toBe('forced');
    expect(await first).toBe('forced');
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(f.pg.stopped).toBe(true);
    launchers.splice(launchers.indexOf(l), 1);
    await l.done;
  });

  it('warns when the host is not the local machine', async () => {
    const wide = fakes();
    await stopped(await start(wide.deps, { host: '0.0.0.0' }));
    expect(wide.printed).toContain('Listening on 0.0.0.0. Sign-in travels over plain HTTP on this network.');
    expect(wide.server.cfg?.LISTEN_HOST).toBe('0.0.0.0');

    const local = fakes();
    await start(local.deps, { host: 'localhost' });
    expect(local.printed.join('\n')).not.toContain('plain HTTP');
  });

  it('registers an exit hook that tells Postgres to stop, and removes its listeners when it stops', async () => {
    const before = process.listeners('exit');
    const f = fakes();
    const l = await start(f.deps);
    expect(process.listenerCount('uncaughtException')).toBe(listenersBefore.uncaughtException! + 1);
    expect(process.listenerCount('unhandledRejection')).toBe(listenersBefore.unhandledRejection! + 1);
    const added = process.listeners('exit').filter((h) => !before.includes(h));
    expect(added).toHaveLength(1);
    (added[0] as () => void)();
    expect(f.pg.stopSyncCalls).toBe(1);
    await stopped(l);
    expect(listenerCounts()).toEqual(listenersBefore);
  });

  it('builds its config from a copy of the environment, not from a .env file', async () => {
    await writeFile(join(cwd, '.env'), 'AUTH_ADAPTER=keycloak\nTRUST_PROXY=1\nDASHBOARD_SQL_ENABLED=true\n');
    // loadConfig() reads a .env at most once per loaded module. Fresh modules, so an earlier test
    // cannot have used that up and hide a .env read here.
    vi.resetModules();
    const fresh = await import('./commands.js');
    const f = fakes();
    launchers.push(await fresh.runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, f.deps));
    expect(f.server.cfg?.AUTH_ADAPTER).toBe('local');
    expect(f.server.cfg?.TRUST_PROXY).toBeUndefined();
    expect(process.env.TRUST_PROXY).toBeUndefined();
    expect(process.env.DASHBOARD_SQL_ENABLED).toBeUndefined();
  });

  it('ignores settings for parts a standalone install does not have', async () => {
    process.env.OIDC_ISSUER_URL = 'https://idp.example.org/realms/x';
    process.env.S3_ENDPOINT = '';
    process.env.IDENTITY_ADMIN_ADAPTER = 'keycloak';
    process.env.KEYCLOAK_URL = 'http://127.0.0.1:1';
    process.env.MSSQL_PORT = 'not-a-port';
    const f = fakes();
    await start(f.deps);
    expect(f.server.cfg).toMatchObject({ AUTH_ADAPTER: 'local', BLOB_ADAPTER: 'fs', BLOB_DIR: paths.blobs });
    expect(f.server.cfg?.IDENTITY_ADMIN_ADAPTER).toBeUndefined();
    expect(f.server.cfg?.OIDC_ISSUER_URL).toBeUndefined();
    expect(process.env.OIDC_ISSUER_URL).toBeUndefined();
    expect(process.env.S3_ENDPOINT).toBeUndefined();
  });

  it("the launcher's own settings win over the shell's", async () => {
    process.env.AUTH_ADAPTER = 'keycloak';
    process.env.AUTH_DEV_BYPASS = 'true';
    const f = fakes();
    await start(f.deps);
    expect(f.server.cfg?.AUTH_ADAPTER).toBe('local');
    expect(f.server.cfg?.AUTH_DEV_BYPASS).toBe(false);
  });

  it('keeps passwords, the secrets key and the token out of the error it rejects with', async () => {
    const f = fakes();
    let token = '';
    f.deps.startServer = async (cfg) => {
      token = (await readLock(paths))!.token;
      throw new Error(`cannot reach ${cfg.INTERNAL_DATABASE_URL}, key ${cfg.SECRETS_ENCRYPTION_KEY}, token ${token}`);
    };
    const err = await runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, f.deps).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toContain('[hidden]');
    for (const secret of [state.pgAppPassword, state.secretsKey, encodeURIComponent(state.secretsKey), token]) {
      expect(err?.message).not.toContain(secret);
      expect(err?.stack ?? '').not.toContain(secret);
    }
    await expectNothingLeft(f);
  });
});

describe('runStart undoes what it started when a step fails', () => {
  const cases: Array<{ step: string; arrange: (f: Fakes) => Promise<void>; error: RegExp }> = [
    {
      step: 'the state file',
      arrange: async () => writeFile(paths.stateFile, 'not json'),
      error: /is not valid JSON/,
    },
    {
      step: 'the leftover Postgres check',
      arrange: async (f) => {
        f.deps.stopLeftoverPostgres = async () => {
          throw new Error('leftover boom');
        };
      },
      error: /^leftover boom$/,
    },
    {
      step: 'Postgres',
      arrange: async (f) => {
        f.deps.startPostgres = async () => {
          throw new Error('postgres boom');
        };
      },
      error: /^postgres boom$/,
    },
    {
      step: 'the config',
      arrange: async () => {
        process.env.CRASH_LOOP_THRESHOLD = 'many';
      },
      error: /CRASH_LOOP_THRESHOLD/,
    },
    {
      step: 'the server log',
      arrange: async () => {
        await mkdir(paths.serverLog, { recursive: true });
      },
      error: /cannot open LOG_FILE/,
    },
    {
      step: 'the setup code',
      arrange: async (f) => {
        const setup = fakes({ setupRequired: true, setupFails: true });
        f.deps.startServer = async (cfg, logger) => {
          const s = await setup.deps.startServer(cfg, logger);
          const close = s.close;
          f.server.started = true;
          return {
            ...s,
            close: async () => {
              await close();
              f.order.push('server.close');
              f.server.closed = true;
            },
          };
        };
      },
      error: /^setup code boom$/,
    },
  ];

  for (const c of cases) {
    it(`when ${c.step} fails`, async () => {
      const f = fakes();
      await c.arrange(f);
      await expect(runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, f.deps)).rejects.toThrowError(c.error);
      await expectNothingLeft(f);
    });
  }
});

describe('runStatus', () => {
  it('status reports not running with exit code 3, and running with the address', async () => {
    const printed: string[] = [];
    expect(await runStatus({ dataDir: root }, (l) => printed.push(l))).toBe(3);
    expect(printed).toEqual([`Data folder: ${root}`, 'OpenLDR is not running.']);

    await start(fakes().deps);
    printed.length = 0;
    expect(await runStatus({ dataDir: root }, (l) => printed.push(l))).toBe(0);
    expect(printed).toEqual([`Data folder: ${root}`, `OpenLDR is running at ${ADDRESS}`]);
  });

  it('a lock whose launcher does not answer counts as not running', async () => {
    await writeLock(await deadPort());
    const printed: string[] = [];
    expect(await runStatus({ dataDir: root }, (l) => printed.push(l))).toBe(3);
    expect(printed).toContain('OpenLDR is not running.');
  });
});

async function writeLock(controlPort: number, token = newControlToken()): Promise<void> {
  const info = { pid: process.pid, address: ADDRESS, startedAt: STARTED_AT.toISOString(), controlPort, token };
  await writeFile(paths.lockFile, `${JSON.stringify(info)}\n`);
}

describe('runStop', () => {
  it('asks a running launcher to stop and prints Stopped.', async () => {
    const kill = vi.spyOn(process, 'kill');
    const f = fakes();
    const l = await start(f.deps);
    launchers.splice(launchers.indexOf(l), 1);
    const printed: string[] = [];
    expect(await runStop({ dataDir: root }, (line) => printed.push(line))).toBe(0);
    expect(printed).toEqual(['Stopped.']);
    expect(await l.done).toBe('clean');
    expect(f.pg.stopped).toBe(true);
    expect(await readLock(paths)).toBeNull();
    expect(kill).not.toHaveBeenCalled();
  });

  it('prints the forced message when the launcher had to force its stop', async () => {
    const kill = vi.spyOn(process, 'kill');
    const token = newControlToken();
    const control = await startControl({ token, onStop: async () => 'forced' });
    controls.push(control);
    await acquireLock(paths, { pid: process.pid, address: ADDRESS, startedAt: STARTED_AT.toISOString(), controlPort: control.port, token });
    const printed: string[] = [];
    expect(await runStop({ dataDir: root }, (line) => printed.push(line))).toBe(0);
    expect(printed).toEqual(['Stopped, but the server did not finish in 60 seconds. Work in flight will be retried.']);
    expect(kill).not.toHaveBeenCalled();
  });

  it('says not running when the lock does not answer, and sends no signal', async () => {
    const kill = vi.spyOn(process, 'kill');
    await writeLock(await deadPort());
    const printed: string[] = [];
    expect(await runStop({ dataDir: root }, (line) => printed.push(line))).toBe(0);
    expect(printed).toEqual(['OpenLDR is not running.']);
    expect(kill).not.toHaveBeenCalled();
  });

  it('says not running when there is no lock', async () => {
    const printed: string[] = [];
    expect(await runStop({ dataDir: root }, (line) => printed.push(line))).toBe(0);
    expect(printed).toEqual(['OpenLDR is not running.']);
  });

  it('returns 1 when the launcher drops the stop request', async () => {
    const kill = vi.spyOn(process, 'kill');
    const token = newControlToken();
    // Answers a ping like a launcher, then hangs up on stop.
    const sockets: Socket[] = [];
    const s = createServer((sock) => {
      sockets.push(sock);
      sock.on('data', (d: Buffer) => {
        if (d.toString().startsWith('ping ')) sock.end('pong\n');
        else sock.destroy();
      });
    });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    held.push(s);
    await writeLock((s.address() as AddressInfo).port, token);
    const printed: string[] = [];
    expect(await runStop({ dataDir: root }, (line) => printed.push(line))).toBe(1);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatch(/^Could not confirm that OpenLDR stopped: /);
    expect(printed[0]).not.toContain(token);
    expect(kill).not.toHaveBeenCalled();
    for (const sock of sockets) sock.destroy();
  });
});

describe('runCli', () => {
  it('cli refuses when the launcher is not running', async () => {
    const printed: string[] = [];
    expect(await runCli({ dataDir: root, args: ['doctor'] }, (l) => printed.push(l))).toBe(1);
    expect(printed).toEqual(['Start OpenLDR first: openldr-standalone start']);
    expect(cli.calls).toEqual([]);
  });

  it('runs the CLI with the install settings and no .env, with logs on the terminal', async () => {
    await start(fakes().deps);
    // The CLI is a separate process in real use: it starts from the shell's environment.
    const launcherEnv = { ...process.env };
    for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
    Object.assign(process.env, envBefore);
    expect(launcherEnv.LOG_FILE).toBe(paths.serverLog);

    await writeFile(join(cwd, '.env'), 'AUTH_ADAPTER=keycloak\nTRUST_PROXY=1\nDASHBOARD_SQL_ENABLED=true\n');
    process.env.OIDC_ISSUER_URL = 'https://idp.example.org/realms/x';
    process.env.LOG_FILE = join(cwd, 'shell.log');

    // Fresh modules, as in the start test: a .env is read at most once per loaded module.
    vi.resetModules();
    const fresh = await import('./commands.js');
    const config = await import('@openldr/config');
    let cfg: Config | undefined;
    let env: NodeJS.ProcessEnv = {};
    cli.run = async () => {
      // What a CLI command does: loadConfig() with no argument.
      cfg = config.loadConfig();
      env = { ...process.env };
    };
    expect(await fresh.runCli({ dataDir: root, args: ['doctor'] }, () => {})).toBe(0);
    expect(cli.calls).toEqual([['node', 'openldr', 'doctor']]);
    expect(cfg?.AUTH_ADAPTER).toBe('local');
    expect(cfg?.TRUST_PROXY).toBeUndefined();
    expect(cfg?.OIDC_ISSUER_URL).toBeUndefined();
    expect(cfg?.INTERNAL_DATABASE_URL).toBe(postgresUrls(settings).internalUrl);
    expect(cfg?.TARGET_DATABASE_URL).toBe(postgresUrls(settings).targetUrl);
    expect(env.DASHBOARD_SQL_ENABLED).toBeUndefined();
    expect(env.TRUST_PROXY).toBeUndefined();
    expect(env.LOG_FILE).toBeUndefined();
  });

  it("returns the CLI command's exit code, and 1 when it throws", async () => {
    await start(fakes().deps);
    cli.run = async () => {
      process.exitCode = 4;
    };
    expect(await runCli({ dataDir: root, args: ['doctor'] }, () => {})).toBe(4);

    process.exitCode = undefined;
    cli.run = async () => {
      throw new Error('command boom');
    };
    const errors: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      errors.push(String(chunk));
      return true;
    });
    expect(await runCli({ dataDir: root, args: ['doctor'] }, () => {})).toBe(1);
    expect(errors.join('')).toContain('command boom');
  });

  /** The shell's environment again, as a separate CLI process starts with it. */
  function shellEnvironment(): void {
    for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
    Object.assign(process.env, envBefore);
    delete process.env.OPENLDR_URL;
    delete process.env.OPENLDR_ALLOW_PLAIN_HTTP;
  }

  /** A lock naming this address, with a control port that answers, so the launcher counts as running. */
  async function lockAt(address: string): Promise<void> {
    const token = newControlToken();
    const control = await startControl({ token, onStop: async () => 'clean' });
    controls.push(control);
    await acquireLock(paths, { pid: process.pid, address, startedAt: STARTED_AT.toISOString(), controlPort: control.port, token, httpPort: 3999 });
  }

  /** process.env as the client program sees it when it runs these words. */
  async function envSeenBy(args: string[]): Promise<NodeJS.ProcessEnv> {
    let env: NodeJS.ProcessEnv = {};
    cli.run = async () => {
      env = { ...process.env };
    };
    cli.calls = [];
    expect(await runCli({ dataDir: root, args }, () => {})).toBe(0);
    expect(cli.calls).toEqual([['node', 'openldr', ...args]]);
    return env;
  }

  it('gives a non-recovery command no database URL and no secrets key (standalone)', async () => {
    await start(fakes().deps);
    shellEnvironment();
    // The caller's own credential passes through. Database settings in the shell do not.
    const key = 'oldr_TESTKEYtestkeyTESTKEYtestkeyTESTKEYtes';
    const shellKey = randomBytes(32).toString('base64');
    Object.assign(process.env, {
      OPENLDR_KEY: key,
      OPENLDR_KEY_FILE: join(cwd, 'key'),
      OPENLDR_SESSION: 'handed-session-placeholder',
      INTERNAL_DATABASE_URL: 'postgres://shell:shell@127.0.0.1:1/shell',
      TARGET_DATABASE_URL: 'postgres://shell:shell@127.0.0.1:1/shell_target',
      SECRETS_ENCRYPTION_KEY: shellKey,
    });
    // The state file holds the passwords and the secrets key. A non-recovery command never reads it.
    await rm(paths.stateFile);

    const env = await envSeenBy(['layouts', 'list', '--json']);
    expect(env.OPENLDR_URL).toBe(`http://localhost:${PORT}`);
    expect(env.APP_VERSION).toBe(launcherFiles().appVersion);
    expect(env.OPENLDR_ALLOW_PLAIN_HTTP).toBeUndefined();
    expect(env.OPENLDR_KEY).toBe(key);
    expect(env.OPENLDR_KEY_FILE).toBe(join(cwd, 'key'));
    expect(env.OPENLDR_SESSION).toBe('handed-session-placeholder');
    expect(env.HOME).toBe(envBefore.HOME);
    expect(Object.keys(env).filter((k) => /DATABASE_URL$|^SECRETS_ENCRYPTION_KEY$/.test(k))).toEqual([]);
    const values = Object.values(env).join('\n');
    for (const secret of [state.secretsKey, state.pgSuperPassword, state.pgAppPassword, shellKey]) expect(values).not.toContain(secret);
    // None of the server's other settings either.
    for (const k of ['AUTH_ADAPTER', 'BLOB_DIR', 'CLI_ENTRY', 'LISTEN_HOST']) expect(env[k], k).toBeUndefined();
  });

  it('gives a recovery command the database settings (standalone)', async () => {
    await start(fakes().deps);
    shellEnvironment();
    for (const args of [['doctor'], ['--actor', 'ops-bob', 'db', 'migrate'], ['auth', 'setup-code', '--json']]) {
      shellEnvironment();
      const env = await envSeenBy(args);
      expect(env.INTERNAL_DATABASE_URL, args.join(' ')).toBe(postgresUrls(settings).internalUrl);
      expect(env.TARGET_DATABASE_URL).toBe(postgresUrls(settings).targetUrl);
      expect(env.SECRETS_ENCRYPTION_KEY).toBe(state.secretsKey);
    }
  });

  it('counts --help and an unknown command as not recovery', async () => {
    await start(fakes().deps);
    shellEnvironment();
    for (const args of [['--help'], ['db', '--help'], ['db', 'migrate', '--help'], ['not-a-command']]) {
      shellEnvironment();
      const env = await envSeenBy(args);
      expect(env.INTERNAL_DATABASE_URL, args.join(' ')).toBeUndefined();
      expect(env.SECRETS_ENCRYPTION_KEY).toBeUndefined();
      expect(env.OPENLDR_URL).toBe(`http://localhost:${PORT}`);
    }
  });

  it('returns the exit code the client program sets, 0 and 3', async () => {
    await start(fakes().deps);
    shellEnvironment();
    for (const code of [3, 0]) {
      process.exitCode = 9;
      cli.run = async () => {
        process.exitCode = code;
      };
      expect(await runCli({ dataDir: root, args: ['layouts', 'list'] }, () => {})).toBe(code);
    }
  });

  it('allows plain HTTP only for a launcher on a specific host of this machine', async () => {
    shellEnvironment();
    await lockAt('http://100.64.0.7:3999/studio/');
    let env = await envSeenBy(['layouts', 'list']);
    expect(env.OPENLDR_URL).toBe('http://100.64.0.7:3999');
    expect(env.OPENLDR_ALLOW_PLAIN_HTTP).toBe('true');
    await rm(paths.lockFile);

    // Each call is its own process in real use, so each starts from the shell's environment.
    shellEnvironment();
    await lockAt('http://[fd7a:115c:a1e0::1]:3999/studio/');
    env = await envSeenBy(['layouts', 'list']);
    expect(env.OPENLDR_URL).toBe('http://[fd7a:115c:a1e0::1]:3999');
    expect(env.OPENLDR_ALLOW_PLAIN_HTTP).toBe('true');
    await rm(paths.lockFile);

    shellEnvironment();
    await lockAt('http://localhost:3999/studio/');
    env = await envSeenBy(['layouts', 'list']);
    expect(env.OPENLDR_URL).toBe('http://localhost:3999');
    expect(env.OPENLDR_ALLOW_PLAIN_HTTP).toBeUndefined();
  });

  it("never allows plain HTTP for the caller's own --server-url, in either form", async () => {
    await lockAt('http://100.64.0.7:3999/studio/');
    for (const args of [
      ['--server-url', 'http://10.0.0.5:3000', 'layouts', 'list'],
      ['layouts', '--server-url=http://10.0.0.5:3000', 'list'],
      ['layouts', 'list', '--server-url', 'http://10.0.0.5:3000'],
    ]) {
      shellEnvironment();
      const env = await envSeenBy(args);
      expect(env.OPENLDR_ALLOW_PLAIN_HTTP, args.join(' ')).toBeUndefined();
      // The variable still names the launcher; a real --server-url wins over it in the client.
      expect(env.OPENLDR_URL, args.join(' ')).toBe('http://100.64.0.7:3999');
    }
    // The launcher's own address on the same lock still gets it.
    shellEnvironment();
    expect((await envSeenBy(['layouts', 'list'])).OPENLDR_ALLOW_PLAIN_HTTP).toBe('true');
  });

  it('keeps the launcher address when --server-url comes after --, where the client reads it as a word', async () => {
    await lockAt('http://100.64.0.7:3999/studio/');
    shellEnvironment();
    // After `--` commander treats these as plain arguments, so the client never sees an address in
    // them. Without OPENLDR_URL it would fall back to port 3000 with the caller's key.
    const env = await envSeenBy(['ingest', 'file.sqlite', '--', '--server-url', 'http://10.0.0.5:3000']);
    expect(env.OPENLDR_URL).toBe('http://100.64.0.7:3999');
    expect(env.OPENLDR_ALLOW_PLAIN_HTTP).toBeUndefined();
  });

  it("leaves the caller's own OPENLDR_URL and plain-HTTP setting alone", async () => {
    shellEnvironment();
    await lockAt('http://100.64.0.7:3999/studio/');
    process.env.OPENLDR_URL = 'https://lab.example.org';
    const env = await envSeenBy(['layouts', 'list']);
    expect(env.OPENLDR_URL).toBe('https://lab.example.org');
    expect(env.OPENLDR_ALLOW_PLAIN_HTTP).toBeUndefined();
  });
});

describe('runCli with no launcher running', () => {
  // An install that has run before: the state file (made in beforeEach) and a database folder.
  async function installed(): Promise<void> {
    await mkdir(paths.cluster, { recursive: true });
    await writeFile(join(paths.cluster, 'PG_VERSION'), '16\n');
  }

  function cliDeps(f: Fakes, o: { startFails?: boolean; signalWhileStarting?: boolean } = {}) {
    const notices: string[] = [];
    const exits: number[] = [];
    const signals = new EventEmitter();
    const deps: CliDeps = {
      stopLeftoverPostgres: f.deps.stopLeftoverPostgres,
      startPostgres: o.startFails
        ? ((async (opts: { settings: PostgresSettings }) => {
            f.order.push('pg.start');
            throw new Error(`postgres would not start, password ${opts.settings.superPassword}`);
          }) as CliDeps['startPostgres'])
        : o.signalWhileStarting
          ? ((async (opts: Parameters<CliDeps['startPostgres']>[0]) => {
              // Postgres is spawned but not yet answering: the caller holds no handle to it yet.
              signals.emit('SIGINT');
              return f.deps.startPostgres(opts);
            }) as CliDeps['startPostgres'])
          : f.deps.startPostgres,
      now: () => STARTED_AT,
      notice: (line) => notices.push(line),
      signals: signals as unknown as CliDeps['signals'],
      exit: (code) => exits.push(code),
    };
    return { deps, notices, exits, signals };
  }

  it('an app command is still refused, and nothing is started', async () => {
    await installed();
    const f = fakes();
    const { deps } = cliDeps(f);
    const printed: string[] = [];
    expect(await runCli({ dataDir: root, args: ['layouts', 'list'] }, (l) => printed.push(l), deps)).toBe(1);
    expect(printed).toEqual(['Start OpenLDR first: openldr-standalone start']);
    expect(f.order).toEqual([]);
    expect(cli.calls).toEqual([]);
    expect(await readLock(paths)).toBeNull();
  });

  it('a recovery command starts the database, runs with the install settings, and stops the database again', async () => {
    await installed();
    const f = fakes();
    const { deps, notices } = cliDeps(f);
    let env: NodeJS.ProcessEnv = {};
    let lockDuring: Awaited<ReturnType<typeof readLock>> = null;
    let liveDuring = false;
    cli.run = async () => {
      env = { ...process.env };
      lockDuring = await readLock(paths);
      liveDuring = lockDuring ? await isLockLive(lockDuring) : false;
      f.order.push('command');
      process.exitCode = 7;
    };

    expect(await runCli({ dataDir: root, args: ['doctor'] }, () => {}, deps)).toBe(7);

    expect(f.order).toEqual(['pg.leftover', 'pg.start', 'command', 'pg.stop']);
    expect(cli.calls).toEqual([['node', 'openldr', 'doctor']]);
    expect(env.INTERNAL_DATABASE_URL).toBe(postgresUrls(settings).internalUrl);
    expect(env.TARGET_DATABASE_URL).toBe(postgresUrls(settings).targetUrl);
    expect(env.LOG_FILE).toBeUndefined();
    // While the command runs the data folder is held, so a `start` cannot bring up a second Postgres.
    expect(lockDuring).toMatchObject({ pid: process.pid, holder: 'recovery' });
    expect(liveDuring).toBe(true);
    // Afterwards nothing is left: no lock, Postgres stopped.
    expect(f.pg.stopped).toBe(true);
    expect(await readLock(paths)).toBeNull();
    expect(notices).toEqual([RECOVERY_NOTICE, RECOVERY_DONE]);
  });

  it('a command that throws still stops the database and frees the data folder', async () => {
    await installed();
    const f = fakes();
    const { deps } = cliDeps(f);
    cli.run = async () => {
      throw new Error('command boom');
    };
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await runCli({ dataDir: root, args: ['doctor'] }, () => {}, deps)).toBe(1);
    expect(f.pg.stopped).toBe(true);
    expect(await readLock(paths)).toBeNull();
  });

  it('a database that will not start is reported without a secret, and nothing is left', async () => {
    await installed();
    const f = fakes();
    const { deps } = cliDeps(f, { startFails: true });
    const printed: string[] = [];
    expect(await runCli({ dataDir: root, args: ['doctor'] }, (l) => printed.push(l), deps)).toBe(1);
    expect(printed.join('\n')).toContain('postgres would not start');
    expect(printed.join('\n')).not.toContain(state.pgSuperPassword);
    expect(cli.calls).toEqual([]);
    expect(await readLock(paths)).toBeNull();
  });

  it('a folder that never ran is refused, and nothing is started', async () => {
    const f = fakes();
    const { deps } = cliDeps(f);
    const printed: string[] = [];
    expect(await runCli({ dataDir: root, args: ['doctor'] }, (l) => printed.push(l), deps)).toBe(1);
    expect(printed).toEqual(['This data folder holds no OpenLDR database yet. Start OpenLDR once first: openldr-standalone start']);
    expect(f.order).toEqual([]);
    expect(await readLock(paths)).toBeNull();
  });

  it('while a recovery command holds the data folder, other commands, status and start say so', async () => {
    await installed();
    const f = fakes();
    const { deps } = cliDeps(f);
    const seen: Record<string, string[]> = { second: [], app: [], status: [] };
    let statusCode = -1;
    let startError = '';
    cli.run = async () => {
      // Only the first command gets here. The others are refused before any command runs.
      expect(await runCli({ dataDir: root, args: ['doctor'] }, (l) => seen.second!.push(l), cliDeps(fakes()).deps)).toBe(1);
      expect(await runCli({ dataDir: root, args: ['layouts', 'list'] }, (l) => seen.app!.push(l))).toBe(1);
      statusCode = await runStatus({ dataDir: root }, (l) => seen.status!.push(l));
      startError = await runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, fakes().deps).then(
        () => 'started',
        (err: Error) => err.message,
      );
    };
    expect(await runCli({ dataDir: root, args: ['doctor'] }, () => {}, deps)).toBe(0);

    const busy = `A recovery command is using the database (process ${process.pid}). Try again when it has finished.`;
    expect(seen.second).toEqual([busy]);
    expect(seen.app).toEqual([busy]);
    expect(statusCode).toBe(3);
    expect(seen.status).toEqual([`Data folder: ${root}`, `OpenLDR is not running. ${busy}`]);
    expect(startError).toBe(busy);
    expect(cli.calls).toHaveLength(1);
    // One Postgres only: the first command's.
    expect(f.order).toEqual(['pg.leftover', 'pg.start', 'pg.stop']);
  });

  it('Ctrl+C during the command stops the database before the process goes', async () => {
    await installed();
    const f = fakes();
    const { deps, exits, signals } = cliDeps(f);
    cli.run = async () => {
      signals.emit('SIGINT');
    };
    await runCli({ dataDir: root, args: ['doctor'] }, () => {}, deps);
    expect(f.pg.stopSyncCalls).toBe(1);
    expect(exits).toEqual([130]);
    // Its handlers are gone once the command has ended.
    expect(signals.listenerCount('SIGINT') + signals.listenerCount('SIGTERM') + signals.listenerCount('SIGHUP')).toBe(0);
  });

  it('Ctrl+C while the database is still starting stops it once it is up, and the command never runs', async () => {
    await installed();
    const f = fakes();
    const { deps, exits, signals } = cliDeps(f, { signalWhileStarting: true });
    expect(await runCli({ dataDir: root, args: ['doctor'] }, () => {}, deps)).toBe(130);
    expect(f.order).toEqual(['pg.leftover', 'pg.start', 'pg.stop']);
    expect(f.pg.stopped).toBe(true);
    expect(cli.calls).toEqual([]);
    expect(exits).toEqual([130]);
    expect(await readLock(paths)).toBeNull();
    expect(signals.listenerCount('SIGINT') + signals.listenerCount('SIGTERM') + signals.listenerCount('SIGHUP')).toBe(0);
  });
});

describe('the CLI entry', () => {
  it('is dist/cli.js in the app folder', () => {
    expect(cliEntryFile(join('/', 'opt', 'openldr', 'standalone'))).toBe(join('/', 'opt', 'openldr', 'standalone', 'dist', 'cli.js'));
  });

  it("is given to the server as CLI_ENTRY", async () => {
    const f = fakes();
    await start(f.deps);
    expect(f.server.cfg?.CLI_ENTRY).toBe(CLI_ENTRY);
  });
});

/** True when this computer lets a server listen on `host`. Some have no IPv6 loopback. */
function canListenOn(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen({ port: 0, host }, () => s.close(() => resolve(true)));
  });
}
const HAS_IPV6_LOOPBACK = await canListenOn('::1');

describe('the address really served', () => {
  // Linux answers on all of 127.0.0.0/8. macOS has only 127.0.0.1 unless told otherwise, so this
  // test is unproven there and does not run.
  it.runIf(process.platform === 'linux')('prints and records a specific IPv4 host, and status and cli still find the launcher', async () => {
    const f = fakes();
    const l = await start(f.deps, { host: '127.0.0.2' });
    const served = `http://127.0.0.2:${PORT}/studio/`;
    expect(l.address).toBe(served);
    expect(f.printed).toContain(`OpenLDR is running at ${served}`);
    expect(await readLock(paths)).toMatchObject({ address: served, httpPort: PORT });

    const printed: string[] = [];
    expect(await runStatus({ dataDir: root }, (line) => printed.push(line))).toBe(0);
    expect(printed).toContain(`OpenLDR is running at ${served}`);

    let port: string | undefined;
    cli.run = async () => {
      port = process.env.PORT;
    };
    expect(await runCli({ dataDir: root, args: ['doctor'] }, () => {})).toBe(0);
    expect(port).toBe(String(PORT));
  });

  it('shows localhost for 0.0.0.0', async () => {
    const wide = fakes();
    const l = await start(wide.deps, { host: '0.0.0.0' });
    expect(l.address).toBe(ADDRESS);
    expect(wide.printed).toContain(`OpenLDR is running at ${ADDRESS}`);
  });

  // Runs only where ::1 can be bound.
  it.runIf(HAS_IPV6_LOOPBACK)('shows localhost for ::1, with no plain-HTTP warning', async () => {
    const loop6 = fakes();
    const l6 = await start(loop6.deps, { host: '::1' });
    expect(l6.address).toBe(ADDRESS);
    expect(await readLock(paths)).toMatchObject({ address: ADDRESS });
    expect(loop6.printed.join('\n')).not.toContain('plain HTTP');
    expect(loop6.server.cfg?.LISTEN_HOST).toBe('::1');
  });

  it('puts an IPv6 address in square brackets', () => {
    expect(servedAddress('fd7a:115c:a1e0::1', 3000)).toBe('http://[fd7a:115c:a1e0::1]:3000/studio/');
    expect(servedAddress('::', 3000)).toBe('http://localhost:3000/studio/');
    expect(servedAddress('100.64.0.7', 80)).toBe('http://100.64.0.7:80/studio/');
  });

  it('gives the CLI the HTTP port from the lock, port 80 included', async () => {
    const token = newControlToken();
    const control = await startControl({ token, onStop: async () => 'clean' });
    controls.push(control);
    await acquireLock(paths, {
      pid: process.pid,
      address: 'http://localhost:80/studio/',
      startedAt: STARTED_AT.toISOString(),
      controlPort: control.port,
      token,
      httpPort: 80,
    });
    let port: string | undefined;
    cli.run = async () => {
      port = process.env.PORT;
    };
    expect(await runCli({ dataDir: root, args: ['doctor'] }, () => {})).toBe(0);
    expect(port).toBe('80');
  });
});

describe('a stop that leaves something behind', () => {
  it('rejects with what failed, and done rejects with the same error', async () => {
    const f = fakes({ pgStopFails: true });
    const l = await start(f.deps);
    launchers.splice(launchers.indexOf(l), 1);
    const err = await l.stop().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StopError);
    const message = (err as Error).message;
    expect(message).toMatch(/^The stop did not finish cleanly\. Postgres did not stop: postgres would not stop/);
    expect(message).not.toContain(state.pgAppPassword);
    await expect(l.done).rejects.toBe(err);
    // The steps after the failed one still ran.
    expect(await readLock(paths)).toBeNull();
  });

  it('stop returns 1 with one line, and sends no signal', async () => {
    const kill = vi.spyOn(process, 'kill');
    const f = fakes({ pgStopFails: true });
    const l = await start(f.deps);
    launchers.splice(launchers.indexOf(l), 1);
    const printed: string[] = [];
    expect(await runStop({ dataDir: root }, (line) => printed.push(line))).toBe(1);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatch(/^Could not confirm that OpenLDR stopped: /);
    expect(printed[0]).not.toMatch(/^Stopped/);
    await expect(l.done).rejects.toBeInstanceOf(StopError);
    expect(kill).not.toHaveBeenCalled();
  });

  it('a failed start whose undo also failed says both', async () => {
    const f = fakes({ pgStopFails: true });
    f.deps.startServer = async () => {
      throw new Error('boom');
    };
    await expect(runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, f.deps)).rejects.toThrowError(
      /^boom\nThe stop did not finish cleanly\. Postgres did not stop: /,
    );
    expect(await readLock(paths)).toBeNull();
  });
});

describe('a forced stop ends cleanly while the server is still hung', () => {
  /** Stubs process.exit, so a real crash handler cannot end the test run. */
  function guardExit(): number[] {
    const exits: number[] = [];
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exits.push(code ?? 0);
    }) as never);
    return exits;
  }

  async function serverLogLines(): Promise<Array<{ level: number; msg: string }>> {
    const text = await readFile(paths.serverLog, 'utf8');
    return text
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l) as { level: number; msg: string });
  }

  async function expectNoCrash(exits: number[]): Promise<void> {
    expect(exits).toEqual([]);
    expect(await readdir(paths.crash)).toEqual([]);
    const lines = await serverLogLines();
    expect(lines.filter((l) => l.msg === FORCED_STOP_ERROR && l.level === 40)).toHaveLength(2);
    expect(lines.filter((l) => l.level >= 60)).toEqual([]);
  }

  it('after the 60-second wait: resolves forced, releases the lock, writes no crash marker, and takes its handlers off', async () => {
    const exits = guardExit();
    const f = fakes({ closeNever: true, pgStopEmits: true });
    const l = await start(f.deps);
    launchers.splice(launchers.indexOf(l), 1);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = l.stop();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS);
    vi.useRealTimers();
    expect(await result).toBe('forced');
    expect(await l.done).toBe('forced');
    expect(f.pg.stopped).toBe(true);
    expect(await readLock(paths)).toBeNull();
    await expectNoCrash(exits);
    expect(listenerCounts()).toEqual(listenersBefore);
  });

  it('through the control port, forced by a second signal: the asker gets forced', async () => {
    const exits = guardExit();
    const f = fakes({ closeNever: true, pgStopEmits: true });
    const l = await start(f.deps);
    launchers.splice(launchers.indexOf(l), 1);
    const asked = requestStop((await readLock(paths))!, 10_000);
    await vi.waitFor(() => expect(f.order).toContain('server.close'), { timeout: 3000 });
    void l.stop(true);
    expect(await asked).toBe('forced');
    expect(await l.done).toBe('forced');
    expect(await readLock(paths)).toBeNull();
    await expectNoCrash(exits);
    expect(listenerCounts()).toEqual(listenersBefore);
  });

  it('the clean path keeps the real crash handlers on until the server has closed', async () => {
    const f = fakes();
    let duringClose: Function[] = [];
    const startServer = f.deps.startServer;
    f.deps.startServer = async (cfg, logger) => {
      const s = await startServer(cfg, logger);
      return {
        ...s,
        close: async () => {
          duringClose = process.listeners('uncaughtException');
          await s.close();
        },
      };
    };
    const l = await start(f.deps);
    const atStart = process.listeners('uncaughtException');
    expect(await stopped(l)).toBe('clean');
    expect(duringClose).toEqual(atStart);
    expect(duringClose.length).toBe(listenersBefore.uncaughtException! + 1);
  });

  it('a forced stop that leaves something behind still says what failed', async () => {
    guardExit();
    const f = fakes({ closeNever: true, pgStopFails: true });
    const l = await start(f.deps);
    launchers.splice(launchers.indexOf(l), 1);
    const err = await l.stop(true).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StopError);
    expect((err as StopError).result).toBe('forced');
    expect((err as Error).message).toMatch(/^The stop did not finish cleanly\. Postgres did not stop: /);
    await expect(l.done).rejects.toBe(err);
    expect(listenerCounts()).toEqual(listenersBefore);
  });

  describe('a Postgres that stops by itself', () => {
    const gone = () => `The database stopped by itself. OpenLDR has stopped. See ${paths.postgresLog}.`;

    it('stops the launcher by the forced path: the hung server is cut off, the lock is released, and done rejects with the message', async () => {
      const exits = guardExit();
      const f = fakes({ closeNever: true, pgStopEmits: true });
      const l = await start(f.deps);
      launchers.splice(launchers.indexOf(l), 1);
      f.pg.die();
      const err = await l.done.then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err?.message).toBe(gone());
      expect(f.order.slice(3)).toEqual(['server.close', 'pg.stop']);
      expect(f.server.closed).toBe(false);
      expect(await readLock(paths)).toBeNull();
      // The errors that come while the server's connections fail are logged, not a crash.
      await expectNoCrash(exits);
      expect(listenerCounts()).toEqual(listenersBefore);
    });

    it('says what else failed when that stop also left something behind', async () => {
      guardExit();
      const f = fakes({ pgStopFails: true });
      const l = await start(f.deps);
      launchers.splice(launchers.indexOf(l), 1);
      f.pg.die();
      const err = await l.done.then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err?.message.startsWith(`${gone()}\nThe stop did not finish cleanly. Postgres did not stop: `)).toBe(true);
      expect(err?.message).not.toContain(state.pgAppPassword);
      expect(await readLock(paths)).toBeNull();
    });

    it('changes nothing when Postgres goes during a stop that is already running', async () => {
      const f = fakes();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let closing = false;
      const startServer = f.deps.startServer;
      f.deps.startServer = async (cfg, logger) => {
        const s = await startServer(cfg, logger);
        return {
          ...s,
          close: async () => {
            closing = true;
            await gate;
            await s.close();
          },
        };
      };
      const l = await start(f.deps);
      launchers.splice(launchers.indexOf(l), 1);
      const result = l.stop();
      await vi.waitFor(() => expect(closing).toBe(true), { timeout: 3000 });
      // Postgres goes while the server is still closing, before the stop has reached it.
      f.pg.die();
      await new Promise((r) => setTimeout(r, 20));
      release();
      expect(await result).toBe('clean');
      expect(await l.done).toBe('clean');
      expect(f.order.slice(3)).toEqual(['server.close', 'pg.stop']);
      expect(await readLock(paths)).toBeNull();
    });
  });

  describe('the line on the terminal when OpenLDR stops by itself', () => {
    const crashed = () => `OpenLDR stopped after an error. See ${paths.serverLog}.`;
    const tick = () => new Promise((r) => setImmediate(r));

    it('a crash writes the marker, prints the line once, and still exits 1', async () => {
      const exits = guardExit();
      const f = fakes();
      await start(f.deps);
      // Both kinds at once, as a dead database connection gives.
      emitConnectionErrors(f.outside);
      expect(f.printedNow).toEqual([crashed()]);
      expect(exits).toEqual([1, 1]);
      expect((await readFile(join(paths.crash, 'crash.log'), 'utf8')).trim().split('\n')).toHaveLength(2);
      // The ordinary terminal output got nothing from the crash.
      expect(f.printed.join('\n')).not.toContain('stopped after an error');
    });

    it('when the database watcher started first, a later crash prints no second line', async () => {
      const exits = guardExit();
      const f = fakes({ closeNever: true });
      const l = await start(f.deps);
      launchers.splice(launchers.indexOf(l), 1);
      f.pg.die();
      await tick();
      emitConnectionErrors(f.outside);
      const err = await l.done.then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err?.message).toBe(`The database stopped by itself. OpenLDR has stopped. See ${paths.postgresLog}.`);
      expect(f.printedNow).toEqual([]);
      // The errors were logged at warn, not a crash.
      await expectNoCrash(exits);
    });

    it('when Postgres goes during the start, an error before the start ends prints no crash line', async () => {
      // The stop waits for the start to finish, so only the watcher's own swap to the quiet
      // handlers stands between these errors and a real crash handler.
      const exits = guardExit();
      const f = fakes();
      const startServer = f.deps.startServer;
      f.deps.startServer = async (cfg, logger) => {
        f.pg.die();
        await tick();
        emitConnectionErrors(f.outside);
        return startServer(cfg, logger);
      };
      const l = await runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, f.deps);
      const err = await l.done.then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err?.message).toBe(`The database stopped by itself. OpenLDR has stopped. See ${paths.postgresLog}.`);
      expect(f.printedNow).toEqual([]);
      expect(exits).toEqual([]);
      expect(await readdir(paths.crash)).toEqual([]);
      expect(await readLock(paths)).toBeNull();
    });

    it('when a crash started first, the database watcher does nothing', async () => {
      const exits = guardExit();
      const f = fakes();
      const l = await start(f.deps);
      emitConnectionErrors(f.outside);
      f.pg.die();
      await tick();
      await tick();
      expect(f.printedNow).toEqual([crashed()]);
      expect(exits).toEqual([1, 1]);
      // No stop began: the server was not closed and Postgres was not stopped by the watcher.
      expect(f.order).toEqual(['pg.leftover', 'pg.start', 'server.start']);
      const settled = await Promise.race([l.done.then(() => 'settled', () => 'settled'), tick().then(() => 'pending')]);
      expect(settled).toBe('pending');
    });
  });
});

describe('the workflow file folder', () => {
  /** A start with WORKFLOW_FILE_ACCESS_ROOT set to `root`. */
  async function startWith(root: string): Promise<{ f: Fakes; err: Error | null }> {
    process.env.WORKFLOW_FILE_ACCESS_ROOT = root;
    const f = fakes();
    const err = await start(f.deps).then(
      () => null,
      (e: unknown) => e as Error,
    );
    return { f, err };
  }

  const refused = 'WORKFLOW_FILE_ACCESS_ROOT must not be the OpenLDR data folder, hold it, or sit inside it.';

  const cases: Array<[string, () => string]> = [
    ['is the data folder', () => root],
    ['holds the data folder', () => join(root, '..')],
    ['sits inside the data folder', () => join(root, 'blobs', 'not-made-yet')],
  ];
  for (const [name, folder] of cases) {
    it(`refuses to start before Postgres when the folder ${name}`, async () => {
      const { f, err } = await startWith(folder());
      expect(err?.message).toBe(refused);
      expect(f.order).toEqual([]);
      await expectNothingLeft(f);
    });
  }

  it('compares real paths, so a link to the data folder is refused too', async () => {
    const link = join(cwd, 'link-to-data');
    await symlink(root, link);
    const { f, err } = await startWith(link);
    expect(err?.message).toBe(refused);
    expect(f.order).toEqual([]);
  });

  it('starts when the folder is a sibling of the data folder', async () => {
    const sibling = await mkdtemp(join(tmpdir(), 'sa-workflow-'));
    try {
      const { f, err } = await startWith(sibling);
      expect(err).toBeNull();
      expect(f.order).toEqual(['pg.leftover', 'pg.start', 'server.start']);
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });
});

describe('handleSignals', () => {
  function fakeLauncher() {
    const calls: boolean[] = [];
    const launcher: Launcher = {
      address: ADDRESS,
      stop: async (force?: boolean) => {
        calls.push(Boolean(force));
        return 'clean';
      },
      done: Promise.resolve('clean'),
    };
    return { calls, launcher };
  }

  /** A fake emitter and a fake clock. `at(ms, signal)` sends a signal at that time. */
  function wire() {
    const source = new EventEmitter();
    const printed: string[] = [];
    const exits: number[] = [];
    let clock = 100_000;
    const signals = handleSignals({
      source,
      print: (l) => printed.push(l),
      exit: (c) => exits.push(c),
      now: () => clock,
    });
    const at = (ms: number, signal: 'SIGINT' | 'SIGTERM' | 'SIGHUP') => {
      clock = 100_000 + ms;
      source.emit(signal);
    };
    return { at, printed, exits, signals };
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    it(`${signal}: the first stops, one after the window forces, the next after that exits with code 1`, () => {
      const { at, exits, signals } = wire();
      const { calls, launcher } = fakeLauncher();
      signals.attach(launcher);
      at(0, signal);
      expect(calls).toEqual([false]);
      at(2000, signal);
      expect(calls).toEqual([false, true]);
      expect(exits).toEqual([]);
      at(4000, signal);
      expect(calls).toEqual([false, true]);
      expect(exits).toEqual([1]);
    });
  }

  it('two SIGHUP in the same tick give one stop and no force', () => {
    const { at, exits, signals } = wire();
    const { calls, launcher } = fakeLauncher();
    signals.attach(launcher);
    at(0, 'SIGHUP');
    at(0, 'SIGHUP');
    expect(calls).toEqual([false]);
    expect(exits).toEqual([]);
  });

  it('a hangup after the first stop signal never forces, however late', () => {
    const { at, exits, signals } = wire();
    const { calls, launcher } = fakeLauncher();
    signals.attach(launcher);
    at(0, 'SIGTERM');
    at(0, 'SIGHUP');
    at(5000, 'SIGHUP');
    at(60_000, 'SIGHUP');
    expect(calls).toEqual([false]);
    expect(exits).toEqual([]);
  });

  it('a second SIGINT 200 ms later is the same act and does not force', () => {
    const { at, exits, signals } = wire();
    const { calls, launcher } = fakeLauncher();
    signals.attach(launcher);
    at(0, 'SIGINT');
    at(200, 'SIGINT');
    at(1499, 'SIGINT');
    expect(calls).toEqual([false]);
    expect(exits).toEqual([]);
  });

  it('a doubled forcing Ctrl+C does not end the process', () => {
    const { at, exits, signals } = wire();
    const { calls, launcher } = fakeLauncher();
    signals.attach(launcher);
    at(0, 'SIGINT');
    at(2000, 'SIGINT');
    at(2001, 'SIGINT');
    expect(calls).toEqual([false, true]);
    expect(exits).toEqual([]);
  });

  it('a SIGINT after a hangup and after the window forces', () => {
    const { at, signals } = wire();
    const { calls, launcher } = fakeLauncher();
    signals.attach(launcher);
    at(0, 'SIGHUP');
    at(2000, 'SIGINT');
    expect(calls).toEqual([false, true]);
  });

  it('a signal during the start prints one line once, then stops once the launcher is there', () => {
    const { at, printed, exits, signals } = wire();
    at(0, 'SIGHUP');
    at(0, 'SIGHUP');
    at(300, 'SIGINT');
    expect(printed).toEqual(['Stopping once the start has finished.']);
    expect(exits).toEqual([]);
    const { calls, launcher } = fakeLauncher();
    signals.attach(launcher);
    expect(calls).toEqual([false]);
    at(2000, 'SIGINT');
    expect(calls).toEqual([false, true]);
  });

  it('a SIGINT after the window during the start exits at once with code 130', () => {
    const { at, printed, exits } = wire();
    at(0, 'SIGINT');
    at(2000, 'SIGINT');
    expect(printed).toEqual(['Stopping once the start has finished.']);
    expect(exits).toEqual([130]);
  });

  it('a stop that rejects does not become an unhandled rejection', async () => {
    const { at, signals } = wire();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      signals.attach({ address: ADDRESS, stop: () => Promise.reject(new Error('stop boom')), done: Promise.resolve('clean') });
      at(0, 'SIGINT');
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('launcherFiles', () => {
  it('reports the release version from the root package.json, and the app version only when that cannot be read', async () => {
    const top = await mkdtemp(join(tmpdir(), 'sa-version-'));
    try {
      const app = join(top, 'apps', 'standalone');
      await mkdir(app, { recursive: true });
      await writeFile(join(top, 'package.json'), JSON.stringify({ name: 'openldr', version: '9.8.7' }));
      await writeFile(join(app, 'package.json'), JSON.stringify({ name: '@openldr/standalone', version: '0.0.1' }));
      expect(launcherFiles(app)).toEqual({ appVersion: '9.8.7', studioDist: join(top, 'apps', 'studio', 'dist') });

      await writeFile(join(top, 'package.json'), '{ not json');
      expect(launcherFiles(app).appVersion).toBe('0.0.1');
      await rm(join(top, 'package.json'));
      expect(launcherFiles(app).appVersion).toBe('0.0.1');
    } finally {
      await rm(top, { recursive: true, force: true });
    }
  });
});

describe('parseCommandLine', () => {
  it('refuses an empty --host and an empty --data-dir', () => {
    expect(() => parseCommandLine(['start', '--host', ''])).toThrow(UsageError);
    expect(() => parseCommandLine(['start', '--host', ''])).toThrow('start: --host cannot be empty.');
    expect(() => parseCommandLine(['start', '--data-dir', ''])).toThrow('start: --data-dir cannot be empty.');
    expect(() => parseCommandLine(['stop', '--data-dir', ' '])).toThrow('stop: --data-dir cannot be empty.');
    expect(() => parseCommandLine(['status', '--data-dir='])).toThrow('status: --data-dir cannot be empty.');
    expect(() => parseCommandLine(['cli', '--data-dir=', '--', 'doctor'])).toThrow('cli: --data-dir cannot be empty.');
    expect(() => parseCommandLine(['cli', '--data-dir', '', 'doctor'])).toThrow('cli: --data-dir cannot be empty.');
  });

  it('takes the CLI arguments with and without the -- separator', () => {
    expect(parseCommandLine(['cli', '--', 'doctor'])).toEqual({ command: 'cli', args: ['doctor'] });
    expect(parseCommandLine(['cli', 'doctor'])).toEqual({ command: 'cli', args: ['doctor'] });
    expect(parseCommandLine(['cli', '--data-dir', '/d', '--', 'auth', 'setup-code'])).toEqual({
      command: 'cli',
      dataDir: '/d',
      args: ['auth', 'setup-code'],
    });
    expect(parseCommandLine(['cli', '--data-dir=/d', 'auth', 'setup-code', '--json'])).toEqual({
      command: 'cli',
      dataDir: '/d',
      args: ['auth', 'setup-code', '--json'],
    });
  });

  it('reads the start options and their defaults', () => {
    expect(parseCommandLine(['start'])).toEqual({ command: 'start', port: 3000, host: '127.0.0.1' });
    expect(parseCommandLine(['start', '--port', '3995', '--host', '0.0.0.0', '--data-dir', '/d'])).toEqual({
      command: 'start',
      port: 3995,
      host: '0.0.0.0',
      dataDir: '/d',
    });
    expect(parseCommandLine(['stop', '--data-dir', '/d'])).toEqual({ command: 'stop', dataDir: '/d' });
    expect(parseCommandLine(['status'])).toEqual({ command: 'status' });
  });

  it('refuses a bad port, an unknown option and an unknown command', () => {
    expect(() => parseCommandLine(['start', '--port', '70000'])).toThrow('--port must be a whole number from 1 to 65535.');
    expect(() => parseCommandLine(['start', '--port', '3.5'])).toThrow('--port must be a whole number from 1 to 65535.');
    expect(() => parseCommandLine(['stop', '--port', '3000'])).toThrow();
    expect(() => parseCommandLine(['launch'])).toThrow('Unknown command: launch');
  });
});
