// The launcher's commands: start, stop, status and cli.
//
// `start` runs Postgres and the server in this process and owns the order of shutdown. `stop`,
// `status` and `cli` find a running launcher through its lock and its control port, never by a
// process ID: a recorded ID can belong to another program after a reboot.
//
// Only Linux is tested. Windows and macOS behaviour is unproven.

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig, type Config } from '@openldr/config';
import { createLogger, makeCrashHandler, type Logger } from '@openldr/core';
import type { RunningServer } from '@openldr/server/start';
import { newControlToken, requestStop, startControl } from './control.js';
import { buildEnvironment } from './environment.js';
import {
  findFreePort,
  postgresUrls,
  type PostgresSettings,
  type RunningPostgres,
  type startPostgres,
  type stopLeftoverPostgres,
} from './postgres.js';
import {
  AlreadyRunningError,
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

export type StopResult = 'clean' | 'forced';

export interface LauncherDeps {
  startPostgres: typeof startPostgres;
  stopLeftoverPostgres: typeof stopLeftoverPostgres;
  startServer: (cfg: Config, logger: Logger) => Promise<RunningServer>;
  print: (line: string) => void;
  now: () => Date;
  /** The built studio. `start` refuses to run without its index.html. */
  studioDist: string;
  appVersion: string;
}

export interface Launcher {
  /** For example http://localhost:3000/studio/ */
  address: string;
  /**
   * Closes the server (waiting up to STOP_WAIT_MS, or not at all when forced), stops Postgres and
   * releases the lock. Runs once however often it is called. `stop(true)` during a stop that is
   * waiting ends the wait at once.
   */
  stop(force?: boolean): Promise<StopResult>;
  /**
   * Settles once a stop has finished and the control port is closed, however the stop began:
   * a signal, or a `stop` request on the control port.
   */
  done: Promise<StopResult>;
}

export const STOP_WAIT_MS = 60_000;
/** How long `stop` waits for a running launcher to answer its stop request. */
const STOP_REQUEST_MS = 90_000;
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
/** Where a new install's Postgres port search starts. */
const PREFERRED_PG_PORT = 54320;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export const STOPPED = 'Stopped.';
export const STOPPED_FORCED = 'Stopped, but the server did not finish in 60 seconds. Work in flight will be retried.';
const NOT_RUNNING = 'OpenLDR is not running.';
const START_FIRST = 'Start OpenLDR first: openldr-standalone start';
const STUDIO_MISSING = 'The studio is not built. Run: pnpm --filter @openldr/studio build';

/**
 * Keys for parts a standalone install does not have. They are removed from the environment before
 * the launcher's own keys go in, so a stray variable in the shell cannot break the start or
 * change what the server does. Windows keeps environment names without regard to case; this
 * match is by exact case. Unproven on Windows.
 */
const FOREIGN_PREFIXES = ['OIDC_', 'KEYCLOAK_', 'S3_', 'MSSQL_', 'MYSQL_'];
const FOREIGN_KEYS = new Set(['IDENTITY_ADMIN_ADAPTER', 'AUTH_DEV_USERNAME', 'AUTH_DEV_ROLES']);

// ---------------------------------------------------------------------------------------------
// Shared helpers

/**
 * The built studio and this app's version. From `src/` in a checkout and from `dist/` in the
 * bundle, the app folder is one level up, and the studio build is next to it in `apps/`.
 */
export function launcherFiles(): { studioDist: string; appVersion: string } {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let appVersion = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as { version?: string };
    if (pkg.version) appVersion = pkg.version;
  } catch {
    // Keep the fallback.
  }
  return { studioDist: resolve(appDir, '..', 'studio', 'dist'), appVersion };
}

function dataPaths(dataDir: string | undefined): StandalonePaths {
  return pathsFor(resolveDataDir({ flag: dataDir, env: process.env, platform: process.platform, homedir: homedir() }));
}

/**
 * Puts the launcher's environment into `process.env`. Keys for parts a standalone install does
 * not have go first, then every key from `env` is set over whatever the shell had. `start` and
 * `cli` both use this.
 */
export function applyEnvironment(env: Record<string, string>): void {
  for (const key of Object.keys(process.env)) {
    if (FOREIGN_KEYS.has(key) || FOREIGN_PREFIXES.some((p) => key.startsWith(p))) delete process.env[key];
  }
  Object.assign(process.env, env);
}

function postgresSettings(state: { pgPort: number; pgSuperPassword: string; pgAppPassword: string }): PostgresSettings {
  return { port: state.pgPort, superPassword: state.pgSuperPassword, appPassword: state.pgAppPassword };
}

/** An error whose message and stack hold none of `secrets`, plain or URL-encoded. */
function hideSecrets(err: unknown, secrets: string[]): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  const forms = new Set<string>();
  for (const s of secrets) {
    if (!s) continue;
    forms.add(s);
    forms.add(encodeURIComponent(s));
  }
  const holds = (text: string | undefined) => text !== undefined && [...forms].some((f) => text.includes(f));
  if (!holds(e.message) && !holds(e.stack)) return e;
  let message = e.message;
  for (const f of forms) message = message.split(f).join('[hidden]');
  return new Error(message);
}

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function portTakenMessage(port: number): string {
  return `Port ${port} is already in use. Choose another with --port.`;
}

/** Binds the HTTP port for a moment, to fail with a clear message before Postgres starts. */
function checkPortFree(host: string, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(portTakenMessage(port))
          : new Error(`Cannot listen on ${host} port ${port}: ${err.message}`),
      );
    });
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolvePromise()));
  });
}

/** True when the lock names a launcher that answers on its control port. */
async function liveLock(paths: StandalonePaths): Promise<LockInfo | null> {
  const lock = await readLock(paths);
  return lock && (await isLockLive(lock)) ? lock : null;
}

// ---------------------------------------------------------------------------------------------
// start

export async function runStart(opts: { dataDir?: string; port: number; host: string }, deps: LauncherDeps): Promise<Launcher> {
  // 1. The folders. Nothing is started before the studio build is known to be there.
  const paths = dataPaths(opts.dataDir);
  if (!existsSync(join(deps.studioDist, 'index.html'))) throw new Error(STUDIO_MISSING);
  await ensureFolders(paths);

  const address = `http://localhost:${opts.port}/studio/`;
  const token = newControlToken();
  /** Values that must never reach an error message. */
  const secrets: string[] = [token];

  let server: RunningServer | undefined;
  let pg: RunningPostgres | undefined;
  let lockTaken = false;
  /** Removes each process listener this start added. */
  const removers: Array<() => void> = [];

  let markStarted!: () => void;
  const started = new Promise<void>((r) => (markStarted = r));
  let forceNow!: () => void;
  const forced = new Promise<'forced'>((r) => (forceNow = () => r('forced')));
  let stopping: Promise<StopResult> | undefined;
  let resolveDone!: (r: StopResult) => void;
  const done = new Promise<StopResult>((r) => (resolveDone = r));

  const report = (err: unknown) => deps.print(`While stopping: ${hideSecrets(err, secrets).message}`);

  /** Undoes what is running, newest first. Never rejects. */
  const teardown = async (): Promise<StopResult> => {
    // A stop asked for while the start is still running waits for it, so nothing starts after it.
    await started;
    let result: StopResult = 'clean';
    if (server) {
      const running = server;
      let timer: NodeJS.Timeout | undefined;
      const waited = new Promise<'forced'>((r) => (timer = setTimeout(() => r('forced'), STOP_WAIT_MS)));
      const closed = running.close().then(
        () => 'closed' as const,
        (err: unknown) => {
          report(err);
          return 'closed' as const;
        },
      );
      const outcome = await Promise.race([closed, waited, forced]);
      clearTimeout(timer);
      if (outcome !== 'closed') result = 'forced';
      server = undefined;
    }
    if (pg) {
      const running = pg;
      try {
        await running.stop();
      } catch (err) {
        report(err);
      }
      pg = undefined;
    }
    if (lockTaken) {
      try {
        await releaseLock(paths, token);
      } catch (err) {
        report(err);
      }
      lockTaken = false;
    }
    for (const remove of removers.splice(0)) remove();
    return result;
  };

  const stop = (force = false): Promise<StopResult> => {
    if (force) forceNow();
    if (!stopping) {
      stopping = teardown();
      // The control port closes last, after the answer to a `stop` request has been written.
      // Not inside onStop: close() waits for that answer, which waits for onStop.
      void stopping.then(async (result) => {
        await control.close();
        resolveDone(result);
      });
    }
    return stopping;
  };

  // 2. The control port, so `stop` and `status` can reach this launcher.
  const control = await startControl({ token, onStop: () => stop() });

  try {
    // 3. The lock. Held before anything touches the cluster.
    try {
      lockTaken = true;
      await acquireLock(paths, { pid: process.pid, address, startedAt: deps.now().toISOString(), controlPort: control.port, token });
    } catch (err) {
      if (err instanceof AlreadyRunningError) {
        // The message is built from two fields: the lock also holds the other launcher's token.
        throw new Error(`OpenLDR is already running (process ${err.info.pid}) at ${err.info.address}.`);
      }
      throw err;
    }

    // 4. The state file.
    const state = await loadOrCreateState(paths, () => findFreePort(PREFERRED_PG_PORT));
    secrets.push(state.secretsKey, state.pgSuperPassword, state.pgAppPassword);
    const settings = postgresSettings(state);

    // 5. The HTTP port, before Postgres. This leaves a gap; a taken port reported by the server
    //    itself gets the same message below.
    await checkPortFree(opts.host, opts.port);

    // 6 and 7. Postgres.
    await deps.stopLeftoverPostgres({ clusterDir: paths.cluster, settings });
    pg = await deps.startPostgres({ clusterDir: paths.cluster, logFile: paths.postgresLog, settings });
    // Postgres runs in its own session and outlives this process unless told to stop. This hook
    // covers an exit that skips the normal stop, such as a crash handler or a second Ctrl+C
    // during the start. It is added as soon as Postgres runs, not after the next steps, so no
    // exit leaves Postgres behind. It does nothing once Postgres has stopped.
    const exitHook = () => pg?.stopSync();
    process.on('exit', exitHook);
    removers.push(() => process.off('exit', exitHook));

    // 8. The environment and the config. The config comes from a copy of the environment, so
    //    loadConfig never reads a .env file.
    applyEnvironment(
      buildEnvironment({
        paths,
        state,
        internalUrl: pg.internalUrl,
        targetUrl: pg.targetUrl,
        port: opts.port,
        host: opts.host,
        studioDist: deps.studioDist,
        appVersion: deps.appVersion,
      }),
    );
    const cfg = loadConfig({ ...process.env });
    // Writes to the server log (LOG_FILE). Throws when that file cannot be opened.
    const logger = createLogger({ level: cfg.LOG_LEVEL });

    // 9. The crash handlers, pointed at the crash folder. No crash-loop guard: nothing restarts
    //    a launcher.
    for (const kind of ['uncaughtException', 'unhandledRejection'] as const) {
      const handler = makeCrashHandler({
        dir: paths.crash,
        kind,
        log: (m) => logger.fatal({ marker: m }, `${kind}, wrote crash marker, exiting`),
      });
      process.on(kind, handler);
      removers.push(() => process.off(kind, handler));
    }

    // 10. The server.
    try {
      server = await deps.startServer(cfg, logger);
    } catch (err) {
      if (errorCode(err) === 'EADDRINUSE') throw new Error(portTakenMessage(opts.port));
      throw err;
    }

    // 11. The setup code goes to the terminal only, never to a log.
    const context = server.context;
    if (await context.localSignIn?.setupRequired()) {
      const { createSetupCode } = await import('@openldr/bootstrap');
      const code = await createSetupCode(context);
      deps.print(`No administrator exists yet. Open the address and enter this setup code: ${code}`);
      deps.print('The setup code is valid for 30 minutes. For a new one run: openldr-standalone cli -- auth setup-code');
    }
    deps.print(`OpenLDR is running at ${address}`);
    deps.print(`Server log: ${paths.serverLog}`);
    if (!LOCAL_HOSTS.has(opts.host)) {
      deps.print(`Listening on ${opts.host}. Sign-in travels over plain HTTP on this network.`);
    }
    markStarted();
    return { address, stop, done };
  } catch (err) {
    // Server, Postgres, lock, listeners, then the control port.
    markStarted();
    await stop();
    await control.close();
    throw hideSecrets(err, secrets);
  }
}

// ---------------------------------------------------------------------------------------------
// stop, status, cli

const defaultPrint = (line: string) => void process.stdout.write(`${line}\n`);

/** Asks the launcher on this data folder to stop and waits for its answer. Sends no signal. */
export async function runStop(opts: { dataDir?: string }, print: (line: string) => void = defaultPrint): Promise<number> {
  const lock = await liveLock(dataPaths(opts.dataDir));
  if (!lock) {
    print(NOT_RUNNING);
    return 0;
  }
  try {
    const result = await requestStop(lock, STOP_REQUEST_MS);
    print(result === 'clean' ? STOPPED : STOPPED_FORCED);
    return 0;
  } catch (err) {
    // The control port's errors never name the token.
    print(`Could not confirm that OpenLDR stopped: ${errorMessage(err)}`);
    return 1;
  }
}

/** 0 when a launcher answers on this data folder, 3 when none does. */
export async function runStatus(opts: { dataDir?: string }, print: (line: string) => void): Promise<number> {
  const paths = dataPaths(opts.dataDir);
  print(`Data folder: ${paths.root}`);
  const lock = await liveLock(paths);
  if (!lock) {
    print(NOT_RUNNING);
    return 3;
  }
  print(`OpenLDR is running at ${lock.address}`);
  return 0;
}

/**
 * Runs the `openldr` CLI against this install. It needs a running launcher, because the CLI
 * connects to the bundled Postgres. The CLI gets the server's environment without LOG_FILE, so
 * its log lines go to standard error as they do in Docker. Returns the CLI's exit code.
 */
export async function runCli(opts: { dataDir?: string; args: string[] }, print: (line: string) => void = defaultPrint): Promise<number> {
  const paths = dataPaths(opts.dataDir);
  const lock = await liveLock(paths);
  if (!lock) {
    print(START_FIRST);
    return 1;
  }
  // A running launcher made the state file. Never make a new one here.
  const state = await loadOrCreateState(paths, () =>
    Promise.reject(new Error(`The state file ${paths.stateFile} is missing.`)),
  );
  const settings = postgresSettings(state);
  const secrets = [state.secretsKey, state.pgSuperPassword, state.pgAppPassword];
  const port = Number(new URL(lock.address).port) || DEFAULT_PORT;
  const { LOG_FILE: _serverLog, ...env } = buildEnvironment({
    paths,
    state,
    ...postgresUrls(settings),
    port,
    host: DEFAULT_HOST,
    ...launcherFiles(),
  });
  applyEnvironment(env);
  delete process.env.LOG_FILE;

  // Loaded after the environment is set, as the server is.
  const { buildProgram } = await import('@openldr/cli/program');
  process.exitCode = undefined;
  try {
    await buildProgram().parseAsync(['node', 'openldr', ...opts.args]);
  } catch (err) {
    process.stderr.write(`${hideSecrets(err, secrets).message}\n`);
    return 1;
  }
  // The CLI's commands report failure through process.exitCode.
  const code = process.exitCode as number | string | null | undefined;
  const n = typeof code === 'number' ? code : typeof code === 'string' && code !== '' ? Number(code) : 0;
  return Number.isInteger(n) ? n : 1;
}

// ---------------------------------------------------------------------------------------------
// The command line

export type CommandLine =
  | { command: 'start'; dataDir?: string; port: number; host: string }
  | { command: 'stop' | 'status'; dataDir?: string }
  | { command: 'cli'; dataDir?: string; args: string[] }
  | { command: 'help' };

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const USAGE = [
  'Usage: openldr-standalone <command> [options]',
  '',
  'Commands:',
  '  start    Start Postgres and the server. Ctrl+C stops both.',
  '           --data-dir <folder>  --port <port> (default 3000)  --host <address> (default 127.0.0.1)',
  '  stop     Stop the launcher running on the data folder.  --data-dir <folder>',
  '  status   Say whether it is running, and where.  --data-dir <folder>',
  '  cli      Run the openldr CLI against this install, for example: cli -- doctor',
  '           --data-dir <folder> goes before the --.',
].join('\n');

function parsePort(text: string): number {
  const port = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError('--port must be a whole number from 1 to 65535.');
  }
  return port;
}

function parseOptions(command: string, args: string[], withListen: boolean) {
  try {
    return parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: withListen
        ? { 'data-dir': { type: 'string' }, port: { type: 'string' }, host: { type: 'string' } }
        : { 'data-dir': { type: 'string' } },
    }).values as { 'data-dir'?: string; port?: string; host?: string };
  } catch (err) {
    throw new UsageError(`${command}: ${errorMessage(err)}`);
  }
}

/**
 * Reads the launcher's arguments, without the node and script paths. For `cli`, a `--data-dir`
 * right after `cli` is the launcher's, an optional `--` follows, and the rest goes to the CLI.
 * So `cli -- doctor` and `cli doctor` run the same thing.
 */
export function parseCommandLine(argv: string[]): CommandLine {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') return { command: 'help' };

  if (command === 'cli') {
    let i = 0;
    let dataDir: string | undefined;
    if (rest[i] === '--data-dir') {
      if (rest[i + 1] === undefined) throw new UsageError('cli: --data-dir needs a folder.');
      dataDir = rest[i + 1];
      i += 2;
    } else if (rest[i]?.startsWith('--data-dir=')) {
      dataDir = rest[i]!.slice('--data-dir='.length);
      i += 1;
    }
    if (rest[i] === '--') i += 1;
    return { command, ...(dataDir !== undefined ? { dataDir } : {}), args: rest.slice(i) };
  }

  if (command === 'start') {
    const values = parseOptions(command, rest, true);
    return {
      command,
      port: values.port === undefined ? DEFAULT_PORT : parsePort(values.port),
      host: values.host ?? DEFAULT_HOST,
      ...(values['data-dir'] !== undefined ? { dataDir: values['data-dir'] } : {}),
    };
  }

  if (command === 'stop' || command === 'status') {
    const values = parseOptions(command, rest, false);
    return { command, ...(values['data-dir'] !== undefined ? { dataDir: values['data-dir'] } : {}) };
  }

  throw new UsageError(`Unknown command: ${command}`);
}
