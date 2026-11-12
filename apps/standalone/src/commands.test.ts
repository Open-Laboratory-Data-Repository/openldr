import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@openldr/config';
import type { RunningServer } from '@openldr/server/start';
import {
  STOP_WAIT_MS,
  StopError,
  UsageError,
  handleSignals,
  parseCommandLine,
  runCli,
  runStart,
  runStatus,
  runStop,
  servedAddress,
  type Launcher,
  type LauncherDeps,
} from './commands.js';
import { newControlToken, requestStop, startControl, type ControlServer } from './control.js';
import { postgresUrls, type PostgresSettings } from './postgres.js';
import { acquireLock, pathsFor, readLock, type StandalonePaths } from './state.js';

// The CLI program is replaced, so a test can see what a CLI command would load without a database.
const cli = vi.hoisted(() => ({
  calls: [] as string[][],
  run: undefined as undefined | ((argv: string[]) => Promise<void>),
}));
vi.mock('@openldr/cli/program', () => ({
  buildProgram: () => ({
    parseAsync: async (argv: string[]) => {
      cli.calls.push(argv);
      await cli.run?.(argv);
    },
  }),
}));

/** The HTTP port the launcher under test checks. Nothing listens on it but the bind check. */
const PORT = 3991;
/** A port a test holds, to see the launcher refuse it. */
const HELD = 3990;
const SETUP_CODE = 'TEST-SETUP-CODE-7Q2X';
const ADDRESS = `http://localhost:${PORT}/studio/`;
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
  pg: { started: boolean; stopped: boolean; stopSyncCalls: number; startOpts?: unknown; leftoverOpts?: unknown };
  server: { started: boolean; closed: boolean; cfg?: Config };
  deps: LauncherDeps;
}

function fakes(o: { setupRequired?: boolean; closeNever?: boolean; setupFails?: boolean; pgStopFails?: boolean } = {}): Fakes {
  const f: Fakes = {
    order: [],
    printed: [],
    pg: { started: false, stopped: false, stopSyncCalls: 0 },
    server: { started: false, closed: false },
    deps: undefined as unknown as LauncherDeps,
  };
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
          if (o.pgStopFails) throw new Error(`postgres would not stop, password ${opts.settings.appPassword}`);
          f.pg.stopped = true;
        },
        stopSync: () => {
          f.pg.stopSyncCalls += 1;
        },
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
    now: () => STARTED_AT,
    studioDist: studio,
    appVersion: '0.1.11',
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
    expect(f.pg.startOpts).toEqual({ clusterDir: paths.cluster, logFile: paths.postgresLog, settings });
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
      /^Port 3990 is already in use\. Choose another with --port\.$/,
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
      /^Port 3991 is already in use\. Choose another with --port\.$/,
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
});

describe('the address really served', () => {
  it('prints and records a specific IPv4 host, and status and cli still find the launcher', async () => {
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

  it('shows localhost for 0.0.0.0, and for ::1 with no plain-HTTP warning', async () => {
    const wide = fakes();
    const l = await start(wide.deps, { host: '0.0.0.0' });
    expect(l.address).toBe(ADDRESS);
    expect(wide.printed).toContain(`OpenLDR is running at ${ADDRESS}`);
    await stopped(l);

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

  function wire() {
    const source = new EventEmitter();
    const printed: string[] = [];
    const exits: number[] = [];
    const signals = handleSignals({ source, print: (l) => printed.push(l), exit: (c) => exits.push(c) });
    return { source, printed, exits, signals };
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    it(`${signal}: the first stops, the second forces, the third exits with code 1`, () => {
      const { source, exits, signals } = wire();
      const { calls, launcher } = fakeLauncher();
      signals.attach(launcher);
      source.emit(signal);
      expect(calls).toEqual([false]);
      source.emit(signal);
      expect(calls).toEqual([false, true]);
      expect(exits).toEqual([]);
      source.emit(signal);
      expect(calls).toEqual([false, true]);
      expect(exits).toEqual([1]);
    });
  }

  it('mixed signals count together', () => {
    const { source, exits, signals } = wire();
    const { calls, launcher } = fakeLauncher();
    signals.attach(launcher);
    source.emit('SIGHUP');
    source.emit('SIGINT');
    source.emit('SIGTERM');
    expect(calls).toEqual([false, true]);
    expect(exits).toEqual([1]);
  });

  it('a signal during the start prints one line, then stops once the launcher is there', () => {
    const { source, printed, exits, signals } = wire();
    source.emit('SIGINT');
    expect(printed).toEqual(['Stopping once the start has finished.']);
    expect(exits).toEqual([]);
    const { calls, launcher } = fakeLauncher();
    signals.attach(launcher);
    expect(calls).toEqual([false]);
    source.emit('SIGINT');
    expect(calls).toEqual([false, true]);
  });

  it('a second signal during the start exits at once with code 130', () => {
    const { source, printed, exits } = wire();
    source.emit('SIGHUP');
    source.emit('SIGHUP');
    expect(printed).toEqual(['Stopping once the start has finished.']);
    expect(exits).toEqual([130]);
  });

  it('a stop that rejects does not become an unhandled rejection', async () => {
    const { source, signals } = wire();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      signals.attach({ address: ADDRESS, stop: () => Promise.reject(new Error('stop boom')), done: Promise.resolve('clean') });
      source.emit('SIGINT');
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
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
