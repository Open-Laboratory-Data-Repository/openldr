// The launcher's commands: start, stop, status and cli.
//
// `start` runs Postgres and the server in this process and owns the order of shutdown. `stop`,
// `status` and `cli` find a running launcher through its lock and its control port, never by a
// process ID: a recorded ID can belong to another program after a reboot.
//
// Only Linux is tested. Windows and macOS behaviour is unproven.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
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
/** Hosts that reach only this computer. No plain-HTTP warning for these. */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
/** Hosts whose printed address says `localhost`: this computer, or every address it has. */
const SHOWN_AS_LOCALHOST = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::']);

const CRASH_KINDS = ['uncaughtException', 'unhandledRejection'] as const;
/** Logged at warn for an error that arrives during a forced stop. */
export const FORCED_STOP_ERROR =
  "An error came during a forced stop. Postgres was stopped under the server, so errors from the server's database connections are expected.";

export const STOPPED = 'Stopped.';
export const STOPPED_FORCED = 'Stopped, but the server did not finish in 60 seconds. Work in flight will be retried.';
const NOT_RUNNING = 'OpenLDR is not running.';
const START_FIRST = 'Start OpenLDR first: openldr-standalone start';
const STUDIO_MISSING = 'The studio is not built. Run: pnpm --filter @openldr/studio build';
export const RECOVERING = 'The database is recovering after an unclean stop. This can take a few minutes.';
export const WORKFLOW_ROOT_REFUSED =
  'WORKFLOW_FILE_ACCESS_ROOT must not be the OpenLDR data folder, hold it, or sit inside it.';

/** What `done` rejects with when Postgres stopped while no stop was asked for. */
export function databaseStoppedMessage(postgresLog: string): string {
  return `The database stopped by itself. OpenLDR has stopped. See ${postgresLog}.`;
}

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

/** The `version` field of a package.json, or undefined when it cannot be read. */
function manifestVersion(file: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The built studio and the release version. From `src/` in a checkout and from `dist/` in the
 * bundle, the app folder is one level up, and the studio build is next to it in `apps/`. The
 * release version is the checkout root's package.json, two levels above the app folder: a release
 * bumps that one. The app's own package.json is the fallback when the root one cannot be read.
 */
export function launcherFiles(
  appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
): { studioDist: string; appVersion: string } {
  const appVersion =
    manifestVersion(resolve(appDir, '..', '..', 'package.json')) ?? manifestVersion(join(appDir, 'package.json')) ?? '0.0.0';
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

/**
 * The address to open. A server on one specific address answers only there, so that address is
 * shown. The local machine and the all-addresses hosts are shown as `localhost`. An IPv6
 * address goes in square brackets.
 */
export function servedAddress(host: string, port: number): string {
  const name = SHOWN_AS_LOCALHOST.has(host) ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  return `http://${name}:${port}/studio/`;
}

/** A stop that ran every step, but at least one step failed. Something may be left behind. */
export class StopError extends Error {
  readonly result: StopResult;
  readonly problems: string[];
  constructor(result: StopResult, problems: string[]) {
    super(`The stop did not finish cleanly. ${problems.map((p) => (/[.!?]$/.test(p) ? p : `${p}.`)).join(' ')}`);
    this.name = 'StopError';
    this.result = result;
    this.problems = problems;
  }
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

/**
 * The real path of `p`. Parts that do not exist yet are kept as they are, after the real path of
 * the deepest part that does exist.
 */
function realPathAllowMissing(p: string): string {
  let existing = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(existing), ...tail);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return resolve(p);
      tail.unshift(basename(existing));
      existing = parent;
    }
  }
}

/** True when `inner` is `outer` or lies inside it. Windows compares without case; unproven. */
function sameOrInside(outer: string, inner: string): boolean {
  const o = process.platform === 'win32' ? outer.toLowerCase() : outer;
  const i = process.platform === 'win32' ? inner.toLowerCase() : inner;
  return i === o || i.startsWith(o.endsWith(sep) ? o : `${o}${sep}`);
}

/**
 * The workflow file feature reads and writes files under WORKFLOW_FILE_ACCESS_ROOT. That folder
 * must not reach the data folder, which holds the state file (the superuser password and the
 * secrets key) and the database's own files. The setting comes from the shell, so it is checked
 * here, as real paths, whether or not the feature is turned on.
 */
function checkWorkflowRoot(dataDir: string, root: string | undefined): void {
  if (!root) return;
  const r = realPathAllowMissing(root);
  const d = realPathAllowMissing(dataDir);
  if (sameOrInside(r, d) || sameOrInside(d, r)) throw new Error(WORKFLOW_ROOT_REFUSED);
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
  checkWorkflowRoot(paths.root, process.env.WORKFLOW_FILE_ACCESS_ROOT);
  await ensureFolders(paths);

  const address = servedAddress(opts.host, opts.port);
  const token = newControlToken();
  /** Values that must never reach an error message. */
  const secrets: string[] = [token];

  let server: RunningServer | undefined;
  let pg: RunningPostgres | undefined;
  let lockTaken = false;
  /** Removes each process listener this start added, apart from the two kinds of crash handler. */
  const removers: Array<() => void> = [];
  /** Removes the real crash handlers, which write a marker and exit. */
  const crashRemovers: Array<() => void> = [];
  /** Removes the handlers a forced stop puts in their place. They go last, when `done` settles. */
  const quietRemovers: Array<() => void> = [];
  /** The server log's logger, once there is one. */
  let logger: Logger | undefined;

  /**
   * A forced stop stops Postgres under a server that still holds its database connections, so
   * errors from those connections are expected from then on. They must not end the process
   * through a crash handler, write a crash marker, or cut the stop short. So the real crash
   * handlers come off, and handlers that only log at warn go on in their place. The clean path
   * keeps the real ones until the server has closed.
   */
  const quietCrashHandlers = (): void => {
    for (const remove of crashRemovers.splice(0)) remove();
    for (const kind of CRASH_KINDS) {
      const handler = (err: unknown): void => {
        try {
          logger?.warn({ err, kind }, FORCED_STOP_ERROR);
        } catch {
          // Logging must not end the stop.
        }
      };
      process.on(kind, handler);
      quietRemovers.push(() => process.off(kind, handler));
    }
  };

  let markStarted!: () => void;
  const started = new Promise<void>((r) => (markStarted = r));
  let forceNow!: () => void;
  const forced = new Promise<'forced'>((r) => (forceNow = () => r('forced')));
  let stopping: Promise<StopResult> | undefined;
  /** Set when Postgres went while no stop was asked for. `done` then rejects. */
  let databaseGone = false;
  let resolveDone!: (r: StopResult) => void;
  let rejectDone!: (err: unknown) => void;
  const done = new Promise<StopResult>((resolvePromise, reject) => {
    resolveDone = resolvePromise;
    rejectDone = reject;
  });
  // Marked as handled: a failed start rejects it with nobody reading it. index.ts reads it.
  done.catch(() => {});

  /**
   * Undoes what is running, newest first. Every step runs even when one before it failed. Rejects
   * with a StopError when a step failed, since something may be left behind.
   */
  const teardown = async (): Promise<StopResult> => {
    // A stop asked for while the start is still running waits for it, so nothing starts after it.
    await started;
    let result: StopResult = 'clean';
    const problems: string[] = [];
    const note = (what: string, err: unknown) => problems.push(`${what}: ${hideSecrets(err, secrets).message}`);
    if (server) {
      const running = server;
      let timer: NodeJS.Timeout | undefined;
      const waited = new Promise<'forced'>((r) => (timer = setTimeout(() => r('forced'), STOP_WAIT_MS)));
      const closed = running.close().then(
        () => 'closed' as const,
        (err: unknown) => {
          note('The server did not close cleanly', err);
          return 'closed' as const;
        },
      );
      const outcome = await Promise.race([closed, waited, forced]);
      clearTimeout(timer);
      if (outcome !== 'closed') {
        result = 'forced';
        // Before Postgres stops under the server that is still running.
        quietCrashHandlers();
      }
      server = undefined;
    }
    if (pg) {
      const running = pg;
      try {
        await running.stop();
      } catch (err) {
        note('Postgres did not stop', err);
      }
      pg = undefined;
    }
    if (lockTaken) {
      try {
        await releaseLock(paths, token);
      } catch (err) {
        note(`The lock ${paths.lockFile} was not removed`, err);
      }
      lockTaken = false;
    }
    for (const remove of removers.splice(0)) remove();
    for (const remove of crashRemovers.splice(0)) remove();
    if (problems.length > 0) throw new StopError(result, problems);
    return result;
  };

  /**
   * After a forced stop the server is still hung, and its errors keep coming until the process
   * ends. So the quiet handlers stay on until `done` settles, and index.ts then ends the process
   * in the same turn of the event loop, before any further error can arrive.
   */
  const settle = (fn: () => void): void => {
    for (const remove of quietRemovers.splice(0)) remove();
    fn();
  };

  const stop = (force = false): Promise<StopResult> => {
    if (force) forceNow();
    if (!stopping) {
      stopping = teardown();
      // The control port closes last, after the answer to a `stop` request has been written.
      // Not inside onStop: close() waits for that answer, which waits for onStop. A stop that
      // failed gives the asker no answer: the control port drops it, and `stop` reports that.
      // When Postgres went by itself, `done` rejects whatever the stop did, so the launcher exits 1.
      const gone = (): string => databaseStoppedMessage(paths.postgresLog);
      void stopping.then(
        async (result) => {
          await control.close();
          settle(() => (databaseGone ? rejectDone(new Error(gone())) : resolveDone(result)));
        },
        async (err: unknown) => {
          await control.close();
          settle(() => rejectDone(databaseGone ? new Error(`${gone()}\n${errorMessage(err)}`) : err));
        },
      );
    }
    return stopping;
  };

  // 2. The control port, so `stop` and `status` can reach this launcher.
  const control = await startControl({ token, onStop: () => stop() });

  try {
    // 3. The lock. Held before anything touches the cluster.
    try {
      lockTaken = true;
      await acquireLock(paths, {
        pid: process.pid,
        address,
        startedAt: deps.now().toISOString(),
        controlPort: control.port,
        token,
        httpPort: opts.port,
      });
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
    pg = await deps.startPostgres({
      clusterDir: paths.cluster,
      logFile: paths.postgresLog,
      settings,
      onRecovering: () => deps.print(RECOVERING),
    });
    // Postgres runs in its own session and outlives this process unless told to stop. This hook
    // tells it to stop when this process exits by process.exit or by running out of work, without
    // the normal stop: a crash handler, a second Ctrl+C during the start, a third signal. It is
    // added as soon as Postgres runs, not after the next steps. It does nothing once Postgres has
    // stopped. It cannot run when the process dies without exiting: SIGKILL, a signal with no
    // handler, or a power cut. Signals that end a session (SIGINT, SIGTERM, SIGHUP) have handlers
    // in index.ts for that reason. After a SIGKILL or a power cut, the next start stops the
    // leftover Postgres.
    const exitHook = () => pg?.stopSync();
    process.on('exit', exitHook);
    removers.push(() => process.off('exit', exitHook));
    // Postgres can go while the launcher runs: the out-of-memory killer, or a person. The server
    // would then keep reconnecting to a port that any local program could take, and send it the
    // ordinary role's password. So a Postgres that goes while no stop is in progress stops the
    // launcher, through the forced path: the server is cut off, the quiet crash handlers go on,
    // and the lock is released. `done` then rejects, and index.ts exits 1. A stop already in
    // progress stops Postgres itself, and this does nothing.
    void pg.exited.then(() => {
      if (stopping) return;
      databaseGone = true;
      void stop(true).catch(() => {});
    });

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
    const log = createLogger({ level: cfg.LOG_LEVEL });
    logger = log;

    // 9. The crash handlers, pointed at the crash folder. No crash-loop guard: nothing restarts
    //    a launcher. A forced stop swaps them for quiet ones (quietCrashHandlers).
    for (const kind of CRASH_KINDS) {
      const handler = makeCrashHandler({
        dir: paths.crash,
        kind,
        log: (m) => log.fatal({ marker: m }, `${kind}, wrote crash marker, exiting`),
      });
      process.on(kind, handler);
      crashRemovers.push(() => process.off(kind, handler));
    }

    // 10. The server.
    try {
      server = await deps.startServer(cfg, log);
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
    let undo: unknown;
    await stop().catch((e: unknown) => {
      undo = e;
    });
    await control.close();
    const failure = hideSecrets(err, secrets);
    // An undo that left something behind is said too, after the reason the start failed.
    if (undo instanceof StopError) throw new Error(`${failure.message}\n${undo.message}`);
    throw failure;
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
  // The lock carries the HTTP port. A lock from before that field gets the default; the CLI
  // serves nothing on it.
  const port = lock.httpPort ?? DEFAULT_PORT;
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

/** An empty or blank --host or --data-dir is refused before anything starts. */
function notBlank(command: string, flag: string, value: string | undefined): string | undefined {
  if (value !== undefined && value.trim() === '') throw new UsageError(`${command}: ${flag} cannot be empty.`);
  return value;
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
    notBlank(command, '--data-dir', dataDir);
    if (rest[i] === '--') i += 1;
    return { command, ...(dataDir !== undefined ? { dataDir } : {}), args: rest.slice(i) };
  }

  if (command === 'start') {
    const values = parseOptions(command, rest, true);
    const dataDir = notBlank(command, '--data-dir', values['data-dir']);
    return {
      command,
      port: values.port === undefined ? DEFAULT_PORT : parsePort(values.port),
      host: notBlank(command, '--host', values.host) ?? DEFAULT_HOST,
      ...(dataDir !== undefined ? { dataDir } : {}),
    };
  }

  if (command === 'stop' || command === 'status') {
    const values = parseOptions(command, rest, false);
    const dataDir = notBlank(command, '--data-dir', values['data-dir']);
    return { command, ...(dataDir !== undefined ? { dataDir } : {}) };
  }

  throw new UsageError(`Unknown command: ${command}`);
}

// ---------------------------------------------------------------------------------------------
// Signals

/** The signals that end a session: Ctrl+C, a service manager's stop, and a closed terminal. */
export const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
export const STOPPING_AFTER_START = 'Stopping once the start has finished.';

export interface SignalSource {
  on(event: (typeof STOP_SIGNALS)[number], listener: () => void): unknown;
}

/** Signals this close to the last one that counted are the same act by a person. */
export const SAME_SIGNAL_MS = 1500;

/**
 * Maps stop signals onto a launcher. One act by a person is one signal, however many times the
 * system delivers it: a terminal closed under an interactive shell sends SIGHUP twice in the same
 * millisecond, once from the kernel and once passed on by the shell. So:
 * - A signal within SAME_SIGNAL_MS of the last one that counted does nothing.
 * - SIGHUP counts only as the first stop signal. It never forces and never ends the process.
 * - While the start runs: the first signal prints a line and stops the launcher once it has
 *   started. The next SIGINT or SIGTERM exits at once with code 130; the exit hook then tells
 *   Postgres to stop.
 * - Once started: the first calls `stop()`. The next SIGINT or SIGTERM calls `stop(true)`, and
 *   the one after that exits with code 1. The exit hook then tells Postgres to shut down again.
 * The window is measured from the last signal that counted, not only the first, so a doubled
 * delivery of the forcing Ctrl+C does not end the process either.
 * The outcome of a stop is read from `launcher.done`. SIGHUP and SIGTERM on Windows are unproven.
 */
export function handleSignals(opts: {
  source: SignalSource;
  print: (line: string) => void;
  exit: (code: number) => void;
  now?: () => number;
}): { attach(launcher: Launcher): void } {
  const now = opts.now ?? Date.now;
  let launcher: Launcher | undefined;
  let count = 0;
  let lastAt = 0;
  const ask = (l: Launcher, force: boolean) => void l.stop(force).catch(() => {});
  const onSignal = (signal: (typeof STOP_SIGNALS)[number]) => {
    const at = now();
    if (count > 0 && (signal === 'SIGHUP' || at - lastAt < SAME_SIGNAL_MS)) return;
    count += 1;
    lastAt = at;
    if (!launcher) {
      if (count === 1) opts.print(STOPPING_AFTER_START);
      else opts.exit(130);
      return;
    }
    if (count === 1) ask(launcher, false);
    else if (count === 2) ask(launcher, true);
    else opts.exit(1);
  };
  for (const signal of STOP_SIGNALS) opts.source.on(signal, () => onSignal(signal));
  return {
    attach(l) {
      launcher = l;
      if (count > 0) ask(l, count > 1);
    },
  };
}
