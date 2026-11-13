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
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { loadConfig, type Config } from '@openldr/config';
import { createLogger, makeCrashHandler, type Logger } from '@openldr/core';
import type { RunningServer } from '@openldr/server/start';
import { newControlToken, requestStop, startControl } from './control.js';
import { checkDataVersion, recordDataVersion } from './data-version.js';
import { buildEnvironment } from './environment.js';
import type { LauncherEvent } from './events.js';
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
  /** Writes one line to the terminal synchronously. Used on the way out of a crash. */
  printNow: (line: string) => void;
  now: () => Date;
  /** The built studio. `start` refuses to run without its index.html. */
  studioDist: string;
  appVersion: string;
  /** The bundle's plain CLI entry (cliEntryFile), given to the server as CLI_ENTRY. */
  cliEntry: string;
  /**
   * Set with `--events-fd`: a program runs this launcher and reads its events. The start then makes
   * no setup code: that program asks for one itself, and none is printed where it reads.
   */
  emit?: (e: LauncherEvent) => void;
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
/** Said on standard error when `cli` starts Postgres for a recovery command, and when it has stopped it. */
export const RECOVERY_NOTICE = 'OpenLDR is not running. Starting its database for this command.';
export const RECOVERY_DONE = 'The database is stopped again.';
const NEVER_RAN = 'This data folder holds no OpenLDR database yet. Start OpenLDR once first: openldr-standalone start';
const STARTED_MEANWHILE = 'OpenLDR was started while this command was beginning. Run the command again.';
/** What a recovery lock puts where a launcher's lock has the address to open. It must not be empty. */
const RECOVERY_ADDRESS = 'no address: a recovery command holds the data folder';
function recoveryBusy(pid: number): string {
  return `A recovery command is using the database (process ${pid}). Try again when it has finished.`;
}
/** The signals that end a terminal session. A handler stops Postgres before the process goes. */
const SESSION_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const STUDIO_MISSING = 'The studio is not built. Run: pnpm --filter @openldr/studio build';
export const RECOVERING = 'The database is recovering after an unclean stop. This can take a few minutes.';
export const WORKFLOW_ROOT_REFUSED =
  'WORKFLOW_FILE_ACCESS_ROOT must not be the OpenLDR data folder, hold it, or sit inside it.';

/** The line a crash handler writes to the terminal before the process exits. */
export function crashedMessage(serverLog: string): string {
  return `OpenLDR stopped after an error. See ${serverLog}.`;
}

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

/**
 * The bundle's second entry, the plain `openldr` CLI (tsup.config.ts). The server starts it for each
 * command sent through the app. From `src/` in a checkout it is missing until the bundle is built,
 * and the server then answers that the CLI entry cannot be found.
 */
export function cliEntryFile(appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')): string {
  return join(appDir, 'dist', 'cli.js');
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
   * keeps the real ones until the server has closed. Runs once, however often it is called.
   */
  let quiet = false;
  const quietCrashHandlers = (): void => {
    if (quiet) return;
    quiet = true;
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
  /**
   * OpenLDR can stop by itself two ways: a crash handler, or Postgres going (the `exited`
   * watcher). Each prints one line. Whichever starts first takes this, and the other prints
   * nothing.
   */
  let stoppedByItself = false;
  const claimStoppedByItself = (): boolean => {
    if (stoppedByItself) return false;
    stoppedByItself = true;
    return true;
  };
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
      deps.emit?.({ event: 'stopping' });
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
        host: opts.host,
      });
    } catch (err) {
      if (err instanceof AlreadyRunningError) {
        // A recovery command has Postgres up on this cluster. A second Postgres must not start.
        if (err.info.holder === 'recovery') throw new Error(recoveryBusy(err.info.pid));
        // The message is built from two fields: the lock also holds the other launcher's token.
        throw new Error(`OpenLDR is already running (process ${err.info.pid}) at ${err.info.address}.`);
      }
      throw err;
    }

    // A folder a newer version used is refused before anything of it is read. Under the lock, so
    // two launchers cannot race on the version file.
    await checkDataVersion(paths, deps.appVersion);

    // 4. The state file.
    const state = await loadOrCreateState(paths, () => findFreePort(PREFERRED_PG_PORT));
    secrets.push(state.secretsKey, state.pgSuperPassword, state.pgAppPassword);
    const settings = postgresSettings(state);

    // 5. The HTTP port, before Postgres. This leaves a gap; a taken port reported by the server
    //    itself gets the same message below.
    await checkPortFree(opts.host, opts.port);

    // 6 and 7. Postgres.
    await deps.stopLeftoverPostgres({ clusterDir: paths.cluster, settings });
    deps.emit?.({ event: 'starting', step: 'postgres' });
    pg = await deps.startPostgres({
      clusterDir: paths.cluster,
      logFile: paths.postgresLog,
      settings,
      onRecovering: () => {
        deps.print(RECOVERING);
        deps.emit?.({ event: 'recovering' });
      },
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
    // In practice the server's dead connections usually throw first, and a crash handler ends
    // the process with its own line (step 9). This is the net for a death that throws nothing.
    // The quiet handlers go on at once, so an error that comes after this cannot print a second
    // line through a real crash handler.
    void pg.exited.then(() => {
      if (stopping || !claimStoppedByItself()) return;
      databaseGone = true;
      quietCrashHandlers();
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
        cliEntry: deps.cliEntry,
      }),
    );
    const cfg = loadConfig({ ...process.env });
    // Writes to the server log (LOG_FILE). Throws when that file cannot be opened.
    const log = createLogger({ level: cfg.LOG_LEVEL });
    logger = log;

    // 9. The crash handlers, pointed at the crash folder. No crash-loop guard: nothing restarts
    //    a launcher. A forced stop swaps them for quiet ones (quietCrashHandlers). If Postgres has
    //    already gone, the quiet ones are on and these are not added.
    //    After the marker is written and before the exit, one line goes to the terminal. It is
    //    written synchronously, and a failed write cannot stop the exit.
    const crashedLine = crashedMessage(paths.serverLog);
    for (const kind of quiet ? [] : CRASH_KINDS) {
      const handler = makeCrashHandler({
        dir: paths.crash,
        kind,
        log: (m) => log.fatal({ marker: m }, `${kind}, wrote crash marker, exiting`),
        exit: (code) => {
          if (claimStoppedByItself()) {
            try {
              deps.printNow(crashedLine);
            } catch {
              // The terminal is gone. The exit still happens.
            }
          }
          process.exit(code);
        },
      });
      process.on(kind, handler);
      crashRemovers.push(() => process.off(kind, handler));
    }

    // 10. The server. A start that reaches the server may migrate the database, even when the
    //     server then fails to start. So the folder is marked with this version first. A record
    //     without a migration refuses an older launcher safely; a migration without a record lets
    //     it through to a migration error that tells the person nothing.
    await recordDataVersion(paths, deps.appVersion);
    deps.emit?.({ event: 'starting', step: 'server' });
    try {
      server = await deps.startServer(cfg, log);
    } catch (err) {
      if (errorCode(err) === 'EADDRINUSE') throw new Error(portTakenMessage(opts.port));
      throw err;
    }

    // 11. The setup code goes to the terminal only, never to a log. With events on, a program runs
    //     this launcher and asks for a code itself, so none is made here.
    const context = server.context;
    if (!deps.emit && (await context.localSignIn?.setupRequired())) {
      const { createSetupCode } = await import('@openldr/bootstrap');
      const code = await createSetupCode(context);
      deps.print(`No administrator exists yet. Open the address and enter this setup code: ${code}`);
      deps.print('The setup code is valid for 30 minutes. For a new one run: openldr-standalone cli -- auth setup-code');
    }
    deps.print(`OpenLDR is running at ${address}`);
    deps.emit?.({ event: 'ready', address });
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

/**
 * 0 when a launcher answers on this data folder, 3 when none does. With `json`, prints one JSON
 * line and nothing else: `{dataDir, running: true, address, host?}`, `{dataDir, running: false}`,
 * or `{dataDir, running: false, busy}` while a recovery command holds the folder.
 */
export async function runStatus(opts: { dataDir?: string; json?: boolean }, print: (line: string) => void): Promise<number> {
  const paths = dataPaths(opts.dataDir);
  const dataDir = paths.root;
  if (!opts.json) print(`Data folder: ${dataDir}`);
  const lock = await liveLock(paths);
  if (!lock) {
    print(opts.json ? JSON.stringify({ dataDir, running: false }) : NOT_RUNNING);
    return 3;
  }
  if (lock.holder === 'recovery') {
    const busy = `${NOT_RUNNING} ${recoveryBusy(lock.pid)}`;
    print(opts.json ? JSON.stringify({ dataDir, running: false, busy }) : busy);
    return 3;
  }
  print(
    opts.json
      ? JSON.stringify({ dataDir, running: true, address: lock.address, ...(lock.host !== undefined ? { host: lock.host } : {}) })
      : `OpenLDR is running at ${lock.address}`,
  );
  return 0;
}

/** URL host names that reach only this computer. The URL parser writes the IPv6 loopback in brackets. */
const LOCAL_URL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The environment for a command that is not a recovery command: the running launcher's address and
 * the release version, and no database setting. The caller's own OPENLDR_KEY, OPENLDR_KEY_FILE and
 * session are left as they are. Database URLs and a secrets key from the shell are removed: this
 * process never needs them, and the client must hold none (spec section 3).
 */
function useLauncherAddress(lock: LockInfo, appVersion: string, args: readonly string[]): void {
  for (const key of Object.keys(process.env)) {
    if (key.endsWith('_DATABASE_URL') || key === 'SECRETS_ENCRYPTION_KEY') delete process.env[key];
  }
  // The client sends its version and the server refuses another one. The server runs with this one.
  process.env.APP_VERSION = appVersion;
  // A caller who set OPENLDR_URL keeps it, with their own plain-HTTP choice.
  if (process.env.OPENLDR_URL?.trim()) return;
  // Otherwise the launcher's own address. A real --server-url still wins: the client reads the
  // option before the variable. After a `--` the same words are plain arguments, and the client
  // then uses this address, not the default port 3000.
  const address = new URL(lock.address);
  process.env.OPENLDR_URL = address.origin;
  // The client refuses plain HTTP to a host that is not this computer's loopback. A launcher started
  // with --host on one address (a Tailscale address, say) is still this computer, and the lock is
  // where that address came from, so plain HTTP to it is allowed for this one call. It is not allowed
  // when the caller's words carry --server-url in any form: that address is the caller's, and may be
  // another machine. A word that only looks like the option counts too; the cost is plain HTTP off.
  if (args.some((a) => a === '--server-url' || a.startsWith('--server-url='))) return;
  if (!LOCAL_URL_HOSTS.has(address.hostname)) process.env.OPENLDR_ALLOW_PLAIN_HTTP = 'true';
}

/** The part of the CLI that runCli uses. Loaded on first use; tests stub it. */
type CliProgram = Pick<typeof import('@openldr/cli/program'), 'buildClientProgram' | 'commandKindOf'>;

/**
 * What `cli` needs to run a recovery command when no launcher is running: it then starts the
 * bundled Postgres itself, for that one command.
 */
export interface CliDeps {
  startPostgres: typeof startPostgres;
  stopLeftoverPostgres: typeof stopLeftoverPostgres;
  now: () => Date;
  /** One line for the person, on standard error. Standard output belongs to the command. */
  notice: (line: string) => void;
  /** Where SIGINT, SIGTERM and SIGHUP arrive: the process. */
  signals: Pick<NodeJS.Process, 'on' | 'off'>;
  exit: (code: number) => void;
}

/** A Postgres that `cli` started for one recovery command, and the lock that goes with it. */
interface OwnDatabase {
  lock: LockInfo;
  /** Stops Postgres and frees the data folder. */
  stop(): Promise<void>;
}

/**
 * Starts the bundled Postgres with no server, for a recovery command on an install whose launcher
 * is not running. That is when recovery is needed most: an install that will not start cannot be
 * repaired through a launcher.
 *
 * It takes the same lock a launcher takes, with a control port behind it, so the lock counts as
 * live. A `start` meanwhile is then refused, and cannot bring up a second Postgres on this cluster.
 * A `stop` request is answered when the command has ended; the command is not cut short.
 */
async function startDatabaseAlone(paths: StandalonePaths, deps: CliDeps, secrets: string[]): Promise<OwnDatabase> {
  // A folder that never ran has nothing to recover, and this must never make a state file or a cluster.
  if (!existsSync(paths.stateFile) || !existsSync(join(paths.cluster, 'PG_VERSION'))) throw new Error(NEVER_RAN);

  const token = newControlToken();
  let finish!: () => void;
  const finished = new Promise<void>((r) => (finish = r));
  const control = await startControl({ token, onStop: () => finished.then(() => 'clean' as const) });
  /** Frees the data folder. The control port closes last: close() waits for a `stop` request's answer. */
  const letGo = async (): Promise<void> => {
    await releaseLock(paths, token).catch(() => {});
    finish();
    await control.close();
  };

  const lock: LockInfo = {
    pid: process.pid,
    address: RECOVERY_ADDRESS,
    startedAt: deps.now().toISOString(),
    controlPort: control.port,
    token,
    httpPort: DEFAULT_PORT,
    holder: 'recovery',
  };
  try {
    await acquireLock(paths, lock);
  } catch (err) {
    finish();
    await control.close();
    // A launcher took the lock between the check and here. Its Postgres is the one to use.
    if (err instanceof AlreadyRunningError) throw new Error(STARTED_MEANWHILE);
    throw err;
  }

  // Postgres runs in its own session and outlives this process unless told to stop (see runStart).
  // A signal with no handler ends the process with no exit hook at all, so Ctrl+C, a closed
  // terminal and a plain kill get a handler here. It goes on before Postgres can start: a signal
  // that arrives while Postgres is starting cannot stop it yet (there is no handle to it), so it is
  // remembered and honoured as soon as the start returns.
  let running: RunningPostgres | undefined;
  let interrupted = false;
  const onSignal = (): void => {
    interrupted = true;
    if (!running) return;
    running.stopSync();
    deps.exit(130);
  };
  for (const signal of SESSION_SIGNALS) deps.signals.on(signal, onSignal);
  const signalsOff = (): void => {
    for (const signal of SESSION_SIGNALS) deps.signals.off(signal, onSignal);
  };

  let pg: RunningPostgres;
  try {
    const state = await loadOrCreateState(paths, () =>
      Promise.reject(new Error(`The state file ${paths.stateFile} is missing.`)),
    );
    secrets.push(state.secretsKey, state.pgSuperPassword, state.pgAppPassword);
    const settings = postgresSettings(state);
    deps.notice(RECOVERY_NOTICE);
    // As `start` does: a Postgres left by a power cut or a killed launcher is stopped first.
    await deps.stopLeftoverPostgres({ clusterDir: paths.cluster, settings });
    pg = await deps.startPostgres({
      clusterDir: paths.cluster,
      logFile: paths.postgresLog,
      settings,
      onRecovering: () => deps.notice(RECOVERING),
    });
  } catch (err) {
    signalsOff();
    await letGo();
    throw err;
  }

  // The exit hook covers a crash and process.exit, as in runStart.
  const started = pg;
  const exitHook = (): void => started.stopSync();
  process.on('exit', exitHook);
  const stop = async (): Promise<void> => {
    signalsOff();
    try {
      await started.stop();
    } finally {
      process.off('exit', exitHook);
      await letGo();
    }
  };

  if (interrupted) {
    await stop();
    deps.exit(130);
    throw new InterruptedError();
  }
  running = started;
  return { lock, stop };
}

/** The person pressed Ctrl+C before the command began. Nothing is said: they know. */
class InterruptedError extends Error {
  constructor() {
    super('Interrupted.');
    this.name = 'InterruptedError';
  }
}

/**
 * Runs the `openldr` CLI against this install.
 *
 * A recovery command (spec section 6.7) works on the database itself, so it gets the server's
 * environment without LOG_FILE, and its log lines go to standard error as they do in Docker. Any
 * other command, an unknown one and `--help` included, gets only the launcher's address and the
 * release version: an app command then goes through the running app as a signed-in caller, and no
 * database URL or secrets key is in this process. The kind is found before any environment is built.
 *
 * With no launcher running, an app command is refused: there is no app to go through. A recovery
 * command starts the bundled Postgres for itself and stops it again (startDatabaseAlone), when the
 * caller gave `deps`. Returns the CLI's exit code.
 */
export async function runCli(
  opts: { dataDir?: string; args: string[] },
  print: (line: string) => void = defaultPrint,
  deps?: CliDeps,
): Promise<number> {
  const paths = dataPaths(opts.dataDir);
  let lock = await liveLock(paths);
  // The database is up for someone else's recovery command and will stop under this one.
  if (lock?.holder === 'recovery') {
    print(recoveryBusy(lock.pid));
    return 1;
  }
  const cli: CliProgram = await import('@openldr/cli/program');
  const recovery = (await cli.commandKindOf(opts.args)) === 'recovery';
  const secrets: string[] = [];
  let own: OwnDatabase | undefined;
  if (!lock) {
    if (!recovery || !deps) {
      print(START_FIRST);
      return 1;
    }
    try {
      own = await startDatabaseAlone(paths, deps, secrets);
    } catch (err) {
      if (err instanceof InterruptedError) return 130;
      print(hideSecrets(err, secrets).message);
      return 1;
    }
    lock = own.lock;
  }
  const held = lock;

  const run = async (): Promise<number> => {
    if (recovery) {
      // A launcher, or startDatabaseAlone, has read the state file. Never make a new one here.
      const state = await loadOrCreateState(paths, () =>
        Promise.reject(new Error(`The state file ${paths.stateFile} is missing.`)),
      );
      const settings = postgresSettings(state);
      secrets.push(state.secretsKey, state.pgSuperPassword, state.pgAppPassword);
      // The lock carries the HTTP port. A lock from before that field gets the default; the CLI
      // serves nothing on it.
      const port = held.httpPort ?? DEFAULT_PORT;
      const { LOG_FILE: _serverLog, ...env } = buildEnvironment({
        paths,
        state,
        ...postgresUrls(settings),
        port,
        host: DEFAULT_HOST,
        ...launcherFiles(),
        cliEntry: cliEntryFile(),
      });
      applyEnvironment(env);
      delete process.env.LOG_FILE;
    } else {
      useLauncherAddress(held, launcherFiles().appVersion, opts.args);
    }

    // Run as the openldr entry runs it (packages/cli/src/index.ts): parseAsync, with the 'node' argv form.
    process.exitCode = undefined;
    await cli.buildClientProgram().parseAsync(['node', 'openldr', ...opts.args]);
    // The CLI's commands report failure through process.exitCode.
    const code = process.exitCode as number | string | null | undefined;
    const n = typeof code === 'number' ? code : typeof code === 'string' && code !== '' ? Number(code) : 0;
    return Number.isInteger(n) ? n : 1;
  };

  let code: number;
  try {
    code = await run();
  } catch (err) {
    process.stderr.write(`${hideSecrets(err, secrets).message}\n`);
    code = 1;
  }
  if (own && deps) {
    try {
      await own.stop();
      deps.notice(RECOVERY_DONE);
    } catch (err) {
      // Something may be left behind, so this is a failure whatever the command said.
      process.stderr.write(`${hideSecrets(err, secrets).message}\n`);
      if (code === 0) code = 1;
    }
  }
  return code;
}

// ---------------------------------------------------------------------------------------------
// The command line

export type CommandLine =
  | { command: 'start'; dataDir?: string; port: number; host: string; eventsFd?: number }
  | { command: 'stop'; dataDir?: string }
  | { command: 'status'; dataDir?: string; json?: boolean }
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
  '           --events-fd <n>  Write one JSON line per event to descriptor n (3 or higher).',
  '                            No setup code is made or printed.',
  '  stop     Stop the launcher running on the data folder.  --data-dir <folder>',
  '  status   Say whether it is running, and where.  --data-dir <folder>',
  '           --json  Print one JSON line instead.',
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

/** A descriptor for events. 0, 1 and 2 are standard input, output and error. */
function parseEventsFd(text: string): number {
  const fd = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(fd) || fd < 3) throw new UsageError('--events-fd must be a whole number, 3 or higher.');
  return fd;
}

function parseOptions(command: 'start' | 'stop' | 'status', args: string[]) {
  const options: ParseArgsConfig['options'] =
    command === 'start'
      ? { 'data-dir': { type: 'string' }, port: { type: 'string' }, host: { type: 'string' }, 'events-fd': { type: 'string' } }
      : command === 'status'
        ? { 'data-dir': { type: 'string' }, json: { type: 'boolean' } }
        : { 'data-dir': { type: 'string' } };
  try {
    return parseArgs({ args, strict: true, allowPositionals: false, options }).values as {
      'data-dir'?: string;
      port?: string;
      host?: string;
      'events-fd'?: string;
      json?: boolean;
    };
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
    const values = parseOptions(command, rest);
    const dataDir = notBlank(command, '--data-dir', values['data-dir']);
    const eventsFd = values['events-fd'] === undefined ? undefined : parseEventsFd(values['events-fd']);
    return {
      command,
      port: values.port === undefined ? DEFAULT_PORT : parsePort(values.port),
      host: notBlank(command, '--host', values.host) ?? DEFAULT_HOST,
      ...(dataDir !== undefined ? { dataDir } : {}),
      ...(eventsFd !== undefined ? { eventsFd } : {}),
    };
  }

  if (command === 'stop') {
    const values = parseOptions(command, rest);
    const dataDir = notBlank(command, '--data-dir', values['data-dir']);
    return { command, ...(dataDir !== undefined ? { dataDir } : {}) };
  }

  if (command === 'status') {
    const values = parseOptions(command, rest);
    const dataDir = notBlank(command, '--data-dir', values['data-dir']);
    return { command, ...(dataDir !== undefined ? { dataDir } : {}), ...(values.json ? { json: true } : {}) };
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
