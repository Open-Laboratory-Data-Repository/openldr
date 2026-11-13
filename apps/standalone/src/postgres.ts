// Starts, stops and recovers the Postgres 16 that ships with the standalone install.
//
// The binaries come from the `embedded-postgres` platform packages. This file runs them itself
// and does not use the package's EmbeddedPostgres class, because importing that class:
// - registers an exit hook (the `exit-hook` package) that installs its own SIGINT and SIGTERM
//   handlers and calls process.exit, which would fight the launcher's own shutdown order;
// - writes the superuser password to a file in the temp folder with the default file mode;
// - logs through console.log, and reports a failed start with no reason.
// So nothing here imports `embedded-postgres` itself. It is only resolved, to find the
// platform package next to it.

import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  fsyncSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type AddressInfo } from 'node:net';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export interface PostgresSettings {
  port: number;
  superPassword: string;
  appPassword: string;
}

export const APP_ROLE = 'openldr_app';
export const INTERNAL_DB = 'openldr';
export const TARGET_DB = 'openldr_target';

export interface RunningPostgres {
  pid: number;
  internalUrl: string; // postgres://openldr_app:<appPassword>@127.0.0.1:<port>/openldr
  targetUrl: string;
  /** Fast shutdown. Resolves when the process has gone. */
  stop(): Promise<void>;
  /** Tells Postgres to shut down without waiting. Safe in a process exit handler. */
  stopSync(): void;
  /** Settles when the Postgres process has gone, for any reason. Never rejects. */
  exited: Promise<void>;
}

const SUPERUSER = 'postgres';
const HOST = '127.0.0.1';
/** How long a start may take before it is given up. Crash recovery after a power cut counts. */
const START_TIMEOUT_MS = 120_000;
const IS_WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------------------------------------
// Binaries

interface Binaries {
  postgres: string;
  initdb: string;
  pg_ctl: string;
}

// One package per OS and CPU, as listed in embedded-postgres's optionalDependencies.
// Only linux-x64 is tested. Every other entry is unproven.
const PLATFORM_PACKAGES: Record<string, string> = {
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'linux-arm': '@embedded-postgres/linux-arm',
  'linux-arm64': '@embedded-postgres/linux-arm64',
  'linux-ia32': '@embedded-postgres/linux-ia32',
  'linux-ppc64': '@embedded-postgres/linux-ppc64',
  'linux-x64': '@embedded-postgres/linux-x64',
  'win32-x64': '@embedded-postgres/windows-x64',
};

let binaries: Promise<Binaries> | undefined;

function loadBinaries(): Promise<Binaries> {
  binaries ??= (async () => {
    const name = PLATFORM_PACKAGES[`${process.platform}-${process.arch}`];
    if (!name) throw new Error(`The bundled Postgres has no build for ${process.platform} ${process.arch}.`);
    // pnpm links the platform package next to embedded-postgres, not next to this app, so it is
    // resolved from embedded-postgres's own folder. resolve() finds a path and runs nothing.
    let entry: string;
    try {
      const fromPackage = createRequire(createRequire(import.meta.url).resolve('embedded-postgres'));
      entry = fromPackage.resolve(name);
    } catch {
      throw new Error(`The Postgres binaries for this computer (${name}) are not installed.`);
    }
    // The platform package's entry only exports three paths.
    const mod = (await import(pathToFileURL(entry).href)) as Binaries;
    return { postgres: mod.postgres, initdb: mod.initdb, pg_ctl: mod.pg_ctl };
  })().catch((err: unknown) => {
    binaries = undefined;
    throw err;
  });
  return binaries;
}

function childEnv(): NodeJS.ProcessEnv {
  // English messages, so a failure to bind can be recognised in the log.
  return { ...process.env, LC_ALL: 'C', LC_MESSAGES: 'C' };
}

// ---------------------------------------------------------------------------------------------
// Small helpers

/** The two URLs the server and the CLI use, built from the settings alone. */
export function postgresUrls(settings: PostgresSettings): { internalUrl: string; targetUrl: string } {
  const auth = `${APP_ROLE}:${encodeURIComponent(settings.appPassword)}`;
  const base = `postgres://${auth}@${HOST}:${settings.port}`;
  return { internalUrl: `${base}/${INTERNAL_DB}`, targetUrl: `${base}/${TARGET_DB}` };
}

/** Removes both passwords, plain and URL-encoded, from a message before it is shown. */
function scrub(message: string, settings: PostgresSettings): string {
  let out = message;
  for (const secret of [settings.superPassword, settings.appPassword]) {
    if (!secret) continue;
    for (const form of new Set([secret, encodeURIComponent(secret)])) out = out.split(form).join('[hidden]');
  }
  return out;
}

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function samePath(a: string, b: string): boolean {
  try {
    const ra = realpathSync.native(a);
    const rb = realpathSync.native(b);
    // Windows paths are case-insensitive. Unproven.
    return IS_WINDOWS ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
  } catch {
    return false;
  }
}

/** `alive`, `gone` (ESRCH), or `foreign` (EPERM: the process belongs to another user). */
function liveness(pid: number): 'alive' | 'gone' | 'foreign' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (err) {
    const code = errorCode(err);
    if (code === 'ESRCH') return 'gone';
    if (code === 'EPERM') return 'foreign';
    throw err;
  }
}

async function waitForPidToGo(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (liveness(pid) !== 'alive') return true;
    if (Date.now() >= end) return false;
    await sleep(100);
  }
}

/** The code of the error a superuser login gets when the server did not ask for SCRAM-SHA-256. */
const UNPROVEN_SERVER = 'OPENLDR_UNPROVEN_SERVER';

function unprovenServer(port: number, asked: string): Error {
  return Object.assign(
    new Error(`The program on port ${port} asked for ${asked}, not SCRAM-SHA-256. It is not this install's database.`),
    { code: UNPROVEN_SERVER },
  );
}

/**
 * A superuser client, and the only way to connect it. The cluster this install made accepts only
 * SCRAM-SHA-256 (initdb `--auth=scram-sha-256`). Any other program on the port could ask for the
 * password in plain text, or as MD5, and the `pg` client would send it with no way to refuse. So
 * the connection is watched from before `connect()`:
 * - a request for a plain-text or MD5 password destroys the socket before the client's own
 *   handler runs, so that handler has nothing to write to;
 * - "authentication ok" before the server has proved it knows the password (the SCRAM final
 *   message) also counts: a server that lets the superuser in with no proof is not ours.
 * `connect` then rejects with the code UNPROVEN_SERVER. Every superuser login in this file goes
 * through here. This listens on `client.connection`, a property of `pg` 8.21.0, which this app
 * pins to that exact version.
 */
function superClient(settings: PostgresSettings): { client: pg.Client; connect: () => Promise<void> } {
  const client = new pg.Client({
    host: HOST,
    port: settings.port,
    user: SUPERUSER,
    password: settings.superPassword,
    database: 'postgres',
    ssl: false,
    connectionTimeoutMillis: 5000,
  });
  // A server that shuts down under an open client emits 'error'. Unhandled, it ends the process.
  client.on('error', () => {});

  const con = (client as unknown as { connection: NodeJS.EventEmitter & { stream: { destroy(err?: Error): void } } })
    .connection;
  let refused: Error | undefined;
  let serverProved = false;
  const refuse = (asked: string) => () => {
    refused ??= unprovenServer(settings.port, asked);
    con.stream.destroy(refused);
  };
  // Added before connect(), so each runs before the client's own handler for the same message.
  con.on('authenticationCleartextPassword', refuse('a plain-text password'));
  con.on('authenticationMD5Password', refuse('an MD5 password'));
  con.on('authenticationSASLFinal', () => {
    serverProved = true;
  });
  con.on('authenticationOk', () => {
    if (!serverProved) refuse('no password at all')();
  });

  const connect = async (): Promise<void> => {
    try {
      await client.connect();
    } catch (err) {
      throw refused ?? err;
    }
    // A server can send "ready" in the same packet as the refused request, and the client then
    // reports a connection. It is still refused.
    if (refused) throw refused;
  };
  return { client, connect };
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: HOST, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

function portTakenMessage(port: number): string {
  return (
    `Port ${port} on ${HOST} is in use by another program. ` +
    `This install's database always uses port ${port}. Free that port, then start again.`
  );
}

/** True when Postgres's own log says it could not bind its port. */
export function isBindFailure(logText: string): boolean {
  return /could not bind IPv[46] address|could not create any TCP\/IP sockets|Address already in use/.test(logText);
}

// ---------------------------------------------------------------------------------------------
// postmaster.pid and leftovers

export function readPostmasterPid(clusterDir: string): { pid: number; dataDir: string } | null {
  let text: string;
  try {
    text = readFileSync(join(clusterDir, 'postmaster.pid'), 'utf8');
  } catch (err) {
    const code = errorCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
  const lines = text.split(/\r?\n/);
  const pidText = (lines[0] ?? '').trim();
  const dataDir = lines[1] ?? '';
  if (!/^\d+$/.test(pidText) || dataDir.trim() === '') return null;
  const pid = Number(pidText);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  return { pid, dataDir };
}

/**
 * True only when a Postgres answers on 127.0.0.1:<port>, accepts this install's superuser
 * password, and reports `clusterDir` as its data folder. Retries while it is starting up.
 */
async function servesCluster(
  clusterDir: string,
  settings: PostgresSettings,
  deadline: number,
  stillAlive: () => boolean,
): Promise<boolean> {
  for (;;) {
    const { client, connect } = superClient(settings);
    try {
      await connect();
      const res = await client.query<{ data_directory: string }>('show data_directory');
      return samePath(res.rows[0]?.data_directory ?? '', clusterDir);
    } catch (err) {
      // 57P03: "the database system is starting up". Anything else means it is not ours, a
      // server that asked for anything but SCRAM-SHA-256 included (superClient).
      if (errorCode(err) !== '57P03' || Date.now() >= deadline || !stillAlive()) return false;
    } finally {
      await client.end().catch(() => {});
    }
    await sleep(200);
  }
}

function removePidFile(clusterDir: string): void {
  rmSync(join(clusterDir, 'postmaster.pid'), { force: true });
}

/**
 * Linux only: true when process `pid` looks like a postmaster for `clusterDir`.
 * argv[0]'s file name must be exactly `postgres`, and then either of these must hold:
 * - its working folder (`/proc/<pid>/cwd`) is this cluster, compared as real paths. A postmaster
 *   always works from inside its data folder, so this holds for a relative `-D` and for a
 *   cluster folder renamed while Postgres runs (the kernel follows the rename);
 * - an argument `-D <dir>` (or `-D<dir>`) names this cluster, compared as real paths.
 * A program whose arguments merely contain the folder name, or a postgres serving another
 * folder, does not match.
 */
function looksLikePostgresFor(pid: number, clusterDir: string): boolean {
  let argv: string[];
  try {
    argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
  } catch {
    return false;
  }
  if (argv.at(-1) === '') argv.pop();
  if (basename(argv[0] ?? '') !== 'postgres') return false;
  let cwd: string | undefined;
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    cwd = undefined;
  }
  if (cwd !== undefined && samePath(cwd, clusterDir)) return true;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    let dir = arg === '-D' ? argv[i + 1] : arg.startsWith('-D') && arg.length > 2 ? arg.slice(2) : undefined;
    if (dir === undefined) continue;
    if (!isAbsolute(dir)) {
      if (cwd === undefined) continue;
      dir = resolve(cwd, dir);
    }
    if (samePath(dir, clusterDir)) return true;
  }
  return false;
}

/**
 * Removes a pid file whose live process was not proven to be this cluster's Postgres.
 * Guard first, on Linux: if that process has the command line of a Postgres for this folder, it
 * is one that refuses our login, and its lock file must stay. Reject instead.
 * macOS and Windows have no /proc, so there is no such guard there. Postgres's own shared-memory
 * check on start is the remaining net. Unproven: only Linux is tested.
 */
function removeUnprovenPidFile(clusterDir: string, pid: number): void {
  if (process.platform === 'linux' && looksLikePostgresFor(pid, clusterDir)) {
    throw new Error(
      `A Postgres for ${clusterDir} is running as process ${pid} but does not accept this install's login. ` +
        'Stop that process, then start again.',
    );
  }
  removePidFile(clusterDir);
}

function sendLeftoverFastShutdown(pid: number, clusterDir: string, pgCtl: string | undefined): void {
  if (IS_WINDOWS) {
    // Windows has no SIGINT for a console-less process. pg_ctl sends Postgres's own fast
    // shutdown request. Unproven: only Linux is tested.
    spawn(pgCtl ?? 'pg_ctl', ['stop', '-m', 'fast', '-W', '-D', clusterDir], {
      stdio: 'ignore',
      windowsHide: true,
      env: childEnv(),
    }).on('error', () => {});
    return;
  }
  // SIGINT is Postgres's fast shutdown. Linux tested; macOS unproven.
  try {
    process.kill(pid, 'SIGINT');
  } catch (err) {
    // It exited between the proof and the signal: that is the outcome we wanted.
    if (errorCode(err) !== 'ESRCH') throw err;
  }
}

function requireAbsolute(clusterDir: string): void {
  if (!isAbsolute(clusterDir)) {
    throw new Error(`The database folder must be an absolute path, not ${clusterDir}.`);
  }
}

/**
 * Clears the way for a start after a crash, a hard kill or a power cut.
 * - No pid file, or a malformed one: `none`.
 * - The pid file names another data folder (line 2), or its process lives but is not proven
 *   over SQL to be this cluster's Postgres (no login, another folder, or another user's
 *   process): remove the pid file, `stale`. Postgres would otherwise refuse to start while the
 *   file names any live process. On Linux a guard runs first: a process that looks like a
 *   Postgres for this folder keeps its file and the call rejects.
 * - The pid file names this folder and its process is gone: leave the file (Postgres
 *   overwrites it), `stale`.
 * - Proven: read the pid file again; if it still names the same process, fast shutdown, wait up
 *   to `waitMs`, `stopped`. Reject if it is still there.
 * Only the proven path sends a signal.
 */
export async function stopLeftoverPostgres(opts: {
  clusterDir: string;
  settings: PostgresSettings;
  waitMs?: number;
}): Promise<'none' | 'stale' | 'stopped'> {
  const { clusterDir, settings } = opts;
  const waitMs = opts.waitMs ?? 30_000;
  requireAbsolute(clusterDir);

  // The decision runs at most twice: once, and once more if the pid file changed under the proof.
  for (let attempt = 1; ; attempt++) {
    const info = readPostmasterPid(clusterDir);
    if (!info) return 'none';
    // The file does not describe this folder by its current name. Remove it so Postgres can write
    // its own, after the guard: a cluster renamed while Postgres ran also lands here.
    if (!samePath(info.dataDir, clusterDir)) {
      removeUnprovenPidFile(clusterDir, info.pid);
      return 'stale';
    }
    const state = liveness(info.pid);
    // Gone: a pid file left by a crash. Postgres sees the process is gone and overwrites the file
    // itself, so it stays.
    if (state === 'gone') return 'stale';

    // A process ID alone proves nothing: after a reboot it can belong to any program. Prove over
    // SQL that this install's Postgres is the one running before sending any signal. `foreign`
    // (EPERM, another user's process) is never ours.
    const ours =
      state === 'alive' &&
      (await servesCluster(clusterDir, settings, Date.now() + waitMs, () => liveness(info.pid) === 'alive'));
    if (!ours) {
      // Not proven ours, and nothing is signalled. Postgres refuses to start while the pid file
      // names any live process, whatever that process is, and after a power cut it is usually a
      // stranger that reused the number. So the file goes, after one guard (see
      // removeUnprovenPidFile). Postgres still checks its shared memory block on start, so a
      // second server on a cluster that is truly in use is refused by Postgres itself.
      removeUnprovenPidFile(clusterDir, info.pid);
      return 'stale';
    }

    // The proof shows some Postgres serves this cluster on this port, not that it is the process
    // the file named. The file is this cluster's lock, so the same pid in it now ties the two.
    const now = readPostmasterPid(clusterDir);
    if (!now || now.pid !== info.pid) {
      if (attempt === 1) continue;
      throw new Error(`The Postgres lock file in ${clusterDir} changed twice while it was being checked. Start again.`);
    }

    const pgCtl = IS_WINDOWS ? (await loadBinaries()).pg_ctl : undefined;
    sendLeftoverFastShutdown(info.pid, clusterDir, pgCtl);
    if (await waitForPidToGo(info.pid, waitMs)) return 'stopped';
    throw new Error(`The leftover Postgres in ${clusterDir} did not stop within ${Math.round(waitMs / 1000)} seconds.`);
  }
}

// ---------------------------------------------------------------------------------------------
// Ports

export async function findFreePort(preferred: number): Promise<number> {
  if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535) {
    throw new Error(`Not a port number: ${preferred}`);
  }
  if (await portIsFree(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ port: 0, host: HOST }, () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Start

function runToExit(cmd: string, args: string[], logFd: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', logFd, logFd], env: childEnv(), windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
}

async function runInitdb(bins: Binaries, clusterDir: string, logFile: string, logFd: number, superPassword: string): Promise<void> {
  // The password goes to initdb through a file, never the command line, where other users of
  // this computer can read it with `ps`. The file sits beside the work folder, inside the
  // owner-only data folder, never in the system temp folder. Its name starts with the work
  // folder's, `<cluster>.init-<random>.pw`, so when a kill skips the `finally` below, the next
  // start's sweep of `<cluster>.init-*` (checkClusterFolder) removes it.
  const pwFile = `${clusterDir}.pw`;
  try {
    // Created owner-only, and never over an existing file.
    writeFileSync(pwFile, `${superPassword}\n`, { mode: 0o600, flag: 'wx' });
    const code = await runToExit(
      bins.initdb,
      [
        `--pgdata=${clusterDir}`,
        '--encoding=UTF8',
        '--locale=C',
        // Password logins for every connection type. initdb's default is `trust`.
        '--auth=scram-sha-256',
        `--username=${SUPERUSER}`,
        `--pwfile=${pwFile}`,
      ],
      logFd,
    );
    if (code !== 0) throw new Error(`initdb failed with exit code ${code}. See ${logFile}.`);
  } finally {
    rmSync(pwFile, { force: true });
  }
}

/**
 * Cleans up after a cut-off first start and checks the cluster folder. Returns true when the
 * cluster still needs initdb.
 *
 * initdb writes PG_VERSION before it finishes, so it never runs in `clusterDir` itself. It runs in
 * a sibling `<clusterDir>.init-<random>` that is renamed to `clusterDir` only after it succeeded
 * (initCluster). So a PG_VERSION in `clusterDir` means a finished cluster, and any `.init-`
 * sibling found here is from a start that was cut off. It is removed.
 */
function checkClusterFolder(clusterDir: string): boolean {
  const parent = dirname(clusterDir);
  const prefix = `${basename(clusterDir)}.init-`;
  if (existsSync(parent)) {
    for (const name of readdirSync(parent)) {
      if (name.startsWith(prefix)) rmSync(join(parent, name), { recursive: true, force: true });
    }
  }
  if (existsSync(join(clusterDir, 'PG_VERSION'))) return false;
  // A folder that holds files but no cluster is not ours to judge. Leave it as it is.
  if (existsSync(clusterDir) && readdirSync(clusterDir).length > 0) {
    throw new Error(
      `The database folder ${clusterDir} holds files but no database (it has no PG_VERSION). ` +
        'Nothing in it was changed. Move it away or empty it, then start again.',
    );
  }
  return true;
}

/** Flushes a folder's entries, so a rename in it survives a power cut. Linux and macOS only. */
function syncFolder(dir: string): void {
  // Windows cannot open a folder for flushing. Unproven there; macOS unproven too.
  if (IS_WINDOWS) return;
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Runs initdb in a fresh sibling folder and renames it to `clusterDir` once it succeeded. */
async function initCluster(bins: Binaries, clusterDir: string, logFile: string, logFd: number, superPassword: string): Promise<void> {
  const parent = dirname(clusterDir);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const work = mkdtempSync(`${clusterDir}.init-`);
  try {
    await runInitdb(bins, work, logFile, logFd, superPassword);
    // checkClusterFolder allowed only an empty `clusterDir`, and rmdir refuses anything else.
    if (existsSync(clusterDir)) rmdirSync(clusterDir);
    renameSync(work, clusterDir);
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    throw err;
  }
  syncFolder(parent);
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Creates the ordinary role and both databases when they are missing. Safe to repeat. */
async function prepareDatabases(settings: PostgresSettings): Promise<void> {
  const { client, connect } = superClient(settings);
  try {
    await connect();
    // Postgres logs the text of a failed statement by default. The role statement carries the
    // password, so this session logs no statement text at all.
    await client.query('set log_min_error_statement = panic');
    await client.query("set log_statement = 'none'");
    await client.query('set log_min_duration_statement = -1');

    const role = await client.query('select 1 from pg_roles where rolname = $1', [APP_ROLE]);
    if (role.rowCount === 0) {
      await client.query(
        `create role ${ident(APP_ROLE)} with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls ` +
          `password ${client.escapeLiteral(settings.appPassword)}`,
      );
    }
    for (const db of [INTERNAL_DB, TARGET_DB]) {
      const found = await client.query('select 1 from pg_database where datname = $1', [db]);
      if (found.rowCount === 0) await client.query(`create database ${ident(db)} owner ${ident(APP_ROLE)}`);
      await client.query(`revoke connect on database ${ident(db)} from public`);
    }
    // The two maintenance databases keep CONNECT for PUBLIC after initdb. The ordinary role has no
    // business there. The superuser keeps its own access to `postgres`.
    await client.query('revoke connect on database postgres, template1 from public');
  } finally {
    await client.end().catch(() => {});
  }
}

/** The log text Postgres wrote since `fromByte`. */
function logSince(logFile: string, fromByte: number): string {
  try {
    return readFileSync(logFile).subarray(fromByte).toString('utf8');
  } catch {
    return '';
  }
}

function summarise(logText: string): string {
  const lines = logText.split(/\r?\n/).filter((l) => /\b(FATAL|PANIC|ERROR):/.test(l));
  return lines.slice(-3).join(' | ');
}

export async function startPostgres(opts: {
  clusterDir: string;
  logFile: string;
  settings: PostgresSettings;
}): Promise<RunningPostgres> {
  const { clusterDir, logFile, settings } = opts;
  const { port } = settings;
  requireAbsolute(clusterDir);
  const needsInit = checkClusterFolder(clusterDir);

  // This check leaves a gap before Postgres binds. Postgres's own failure to bind is turned
  // into the same message below.
  if (!(await portIsFree(port))) throw new Error(portTakenMessage(port));

  const bins = await loadBinaries();
  mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
  const logFd = openSync(logFile, 'a', 0o600);
  let child: ChildProcess;
  let logStart: number;
  let exited = false;
  let exitCode: number | null = null;
  let exit!: Promise<void>;
  try {
    if (needsInit) await initCluster(bins, clusterDir, logFile, logFd, settings.superPassword);
    logStart = fstatSync(logFd).size;
    child = spawn(
      bins.postgres,
      [
        '-D',
        clusterDir,
        '-p',
        String(port),
        '-c',
        `listen_addresses=${HOST}`,
        // No Unix socket: the only way in is 127.0.0.1 on the chosen port.
        '-c',
        'unix_socket_directories=',
        '-c',
        'timezone=UTC',
        '-c',
        'log_timezone=UTC',
      ],
      {
        stdio: ['ignore', logFd, logFd],
        env: childEnv(),
        // Its own session on Linux and macOS, so Ctrl+C in the terminal reaches the launcher
        // only. The launcher then stops the server first and Postgres last. macOS unproven.
        detached: !IS_WINDOWS,
        windowsHide: true,
      },
    );
    const started = child;
    exit = new Promise<void>((resolve) => {
      started.once('exit', (code) => {
        exited = true;
        exitCode = code;
        resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      started.once('spawn', resolve);
      started.once('error', reject);
    });
    started.on('error', () => {});
  } catch (err) {
    throw new Error(scrub(`Postgres could not start: ${errorMessage(err)}`, settings));
  } finally {
    closeSync(logFd);
  }

  const pid = child.pid!;

  const sendFastShutdown = () => {
    if (exited) return;
    if (IS_WINDOWS) {
      // pg_ctl kill sends Postgres's own interrupt to the process ID from this child's handle.
      // Unproven: only Linux is tested.
      spawn(bins.pg_ctl, ['kill', 'INT', String(pid)], { stdio: 'ignore', windowsHide: true, env: childEnv() }).on(
        'error',
        () => {},
      );
      return;
    }
    // SIGINT is Postgres's fast shutdown. Linux tested; macOS unproven.
    child.kill('SIGINT');
  };
  const stop = async () => {
    sendFastShutdown();
    await exit;
  };
  const stopSync = () => sendFastShutdown();

  try {
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      if (exited) {
        const log = logSince(logFile, logStart);
        if (isBindFailure(log)) throw new Error(portTakenMessage(port));
        const why = summarise(log);
        throw new Error(`Postgres stopped during start with exit code ${exitCode}.${why ? ` ${why}.` : ''} See ${logFile}.`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`Postgres did not accept connections within ${START_TIMEOUT_MS / 1000} seconds. See ${logFile}.`);
      }
      const { client, connect } = superClient(settings);
      let failure: unknown;
      try {
        await connect();
        const res = await client.query<{ data_directory: string }>('show data_directory');
        if (!samePath(res.rows[0]?.data_directory ?? '', clusterDir)) {
          throw new Error(`A different Postgres answered on port ${port}.`);
        }
        // The server that answered must be the child this call started, or the handle returned
        // would stop the wrong process. The lock file names the server that owns the cluster.
        const owner = readPostmasterPid(clusterDir)?.pid;
        if (owner !== pid) {
          throw new Error(`Another Postgres (process ${owner ?? 'unknown'}) answered for ${clusterDir} on port ${port}.`);
        }
        break;
      } catch (err) {
        failure = err;
      } finally {
        await client.end().catch(() => {});
      }
      const code = errorCode(failure);
      const retry = code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === '57P03';
      if (!retry) {
        // Give a Postgres that failed to bind a moment to exit, so the port message wins.
        await Promise.race([exit, sleep(1000)]);
        if (exited) continue;
        if (code === UNPROVEN_SERVER) {
          throw new Error(
            `Another program answered on port ${port} on ${HOST}. It is not this install's database, and no ` +
              'password was sent to it. Stop that program, then start again.',
          );
        }
        throw failure;
      }
      await sleep(100);
    }
    await prepareDatabases(settings);
  } catch (err) {
    await stop().catch(() => {});
    throw new Error(scrub(errorMessage(err), settings));
  }

  return { pid, ...postgresUrls(settings), stop, stopSync, exited: exit };
}
