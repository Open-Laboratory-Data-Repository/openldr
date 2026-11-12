// The standalone data folder: where it is, what is in it, the state file that holds the
// install's secrets, and the lock that stops two launchers from running on one folder.
//
// Only Linux is tested. Every Windows and macOS path below is unproven.

import { randomBytes } from 'node:crypto';
import { chmod, link, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, posix, resolve, win32 } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pingControl } from './control.js';

export interface StandalonePaths {
  root: string;
  cluster: string;
  blobs: string;
  logs: string;
  crash: string;
  stateFile: string;
  lockFile: string;
  serverLog: string;
  postgresLog: string;
}

export interface StandaloneState {
  version: 1;
  secretsKey: string;
  pgPort: number;
  pgSuperPassword: string;
  pgAppPassword: string;
}

/**
 * What the lock file holds. `pid` is only for the message shown to a person. Nothing decides on
 * it and nothing signals it. A lock is live when its control port answers to its token.
 */
export interface LockInfo {
  pid: number;
  address: string;
  startedAt: string;
  controlPort: number;
  token: string;
}

export class StateFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateFileError';
  }
}

export class AlreadyRunningError extends Error {
  declare readonly info: LockInfo;
  constructor(info: LockInfo) {
    super(`OpenLDR is already running on this data folder, as process ${info.pid} at ${info.address}.`);
    this.name = 'AlreadyRunningError';
    // Not enumerable, so printing the error does not print the control token.
    Object.defineProperty(this, 'info', { value: info, enumerable: false });
  }
}

const IS_WINDOWS = process.platform === 'win32';
/** How many times acquireLock tries before it gives up. */
const LOCK_ROUNDS = 3;
/** Failed pings in a row before a lock counts as dead, and the pause between them. */
const LIVE_PINGS = 3;
const LIVE_PAUSE_MS = 250;

// ---------------------------------------------------------------------------------------------
// Where the data folder is

/** The flag, then OPENLDR_HOME, then the usual per-user folder for the OS. Always absolute. */
export function resolveDataDir(opts: {
  flag?: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homedir: string;
}): string {
  if (opts.flag) return resolve(opts.flag);
  if (opts.env.OPENLDR_HOME) return resolve(opts.env.OPENLDR_HOME);
  const { env, platform, homedir } = opts;
  if (platform === 'win32') {
    // Unproven on Windows.
    return win32.join(env.LOCALAPPDATA || win32.join(homedir, 'AppData', 'Local'), 'OpenLDR');
  }
  if (platform === 'darwin') {
    // Unproven on macOS.
    return posix.join(homedir, 'Library', 'Application Support', 'OpenLDR');
  }
  // The XDG spec says a relative XDG_DATA_HOME is invalid and is to be ignored.
  const xdg = env.XDG_DATA_HOME;
  return xdg && posix.isAbsolute(xdg) ? posix.join(xdg, 'openldr') : posix.join(homedir, '.local', 'share', 'openldr');
}

export function pathsFor(root: string): StandalonePaths {
  const logs = join(root, 'logs');
  return {
    root,
    cluster: join(root, 'postgres'),
    blobs: join(root, 'blobs'),
    logs,
    crash: join(root, 'crash'),
    stateFile: join(root, 'standalone.json'),
    lockFile: join(root, 'standalone.lock'),
    serverLog: join(logs, 'server.log'),
    postgresLog: join(logs, 'postgres.log'),
  };
}

/**
 * Creates the data folder and its subfolders, and makes the root owner-only. The cluster folder
 * is left to Postgres. `mkdir` with a mode is cut down by the umask and does nothing to a folder
 * that already exists, so the root gets a `chmod` on every start.
 */
export async function ensureFolders(paths: StandalonePaths): Promise<void> {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  if (!IS_WINDOWS) await chmod(paths.root, 0o700);
  for (const dir of [paths.blobs, paths.logs, paths.crash]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
}

// ---------------------------------------------------------------------------------------------
// The state file

/**
 * Reads the state file, or creates it when it is missing. A state file that is there but damaged
 * is never replaced. New secrets are never made over an existing database: the stored secrets
 * would become unreadable and the server would be locked out of it.
 */
export async function loadOrCreateState(
  paths: StandalonePaths,
  pickPort: () => Promise<number>,
): Promise<StandaloneState> {
  const text = await readIfThere(paths.stateFile);
  if (text !== null) return parseState(text, paths.stateFile);

  if (await isThere(join(paths.cluster, 'PG_VERSION'))) {
    throw new StateFileError(
      `The state file ${paths.stateFile} is missing, but a database already exists in ${paths.cluster}. ` +
        'Restore the state file from a backup. New secrets over this database would lock the server out of it.',
    );
  }

  const state: StandaloneState = {
    version: 1,
    secretsKey: randomBytes(32).toString('base64'),
    pgPort: await pickPort(),
    pgSuperPassword: randomBytes(24).toString('base64url'),
    pgAppPassword: randomBytes(24).toString('base64url'),
  };
  // Hard-linked into place like the lock, so a state file that is already there is never
  // replaced, even when two callers create one at the same moment. The loser reads the winner's.
  const tmp = tempPath(paths, 'standalone.json');
  try {
    await writeOwnerOnly(tmp, `${JSON.stringify(state, null, 2)}\n`);
    await link(tmp, paths.stateFile);
  } catch (e) {
    if (errorCode(e) !== 'EEXIST') throw e;
    return parseState(await readFile(paths.stateFile, 'utf8'), paths.stateFile);
  } finally {
    await rm(tmp, { force: true });
  }
  // Make the new name survive a power cut. Without the state file, a database made from it can
  // no longer be opened.
  await syncFolder(paths.root);
  return state;
}

function parseState(text: string, file: string): StandaloneState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new StateFileError(`The state file ${file} is not valid JSON. It was left as it is. Restore it from a backup.`);
  }
  const bad = (field: string) =>
    new StateFileError(`The state file ${file} has a missing or invalid "${field}". It was left as it is. Restore it from a backup.`);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw bad('version');
  const d = data as Record<string, unknown>;
  if (d.version !== 1) throw bad('version');
  if (!isNonEmptyString(d.secretsKey)) throw bad('secretsKey');
  if (!isPort(d.pgPort)) throw bad('pgPort');
  if (!isNonEmptyString(d.pgSuperPassword)) throw bad('pgSuperPassword');
  if (!isNonEmptyString(d.pgAppPassword)) throw bad('pgAppPassword');
  return {
    version: 1,
    secretsKey: d.secretsKey,
    pgPort: d.pgPort,
    pgSuperPassword: d.pgSuperPassword,
    pgAppPassword: d.pgAppPassword,
  };
}

// ---------------------------------------------------------------------------------------------
// The lock

/** The lock, or null when it is missing or does not read as a lock. */
export async function readLock(paths: StandalonePaths): Promise<LockInfo | null> {
  const text = await readIfThere(paths.lockFile);
  return text === null ? null : parseLock(text);
}

/**
 * Takes the lock, or throws AlreadyRunningError when a live launcher holds it. A lock is created
 * whole and in one step, by hard-linking a finished file to the lock path, so it never exists
 * empty and two launchers cannot both create it. A dead lock is moved aside, not deleted, and is
 * only removed when what was moved is the lock that was judged dead. Hard links on Windows are
 * unproven.
 */
export async function acquireLock(paths: StandalonePaths, info: LockInfo): Promise<void> {
  const text = `${JSON.stringify(info)}\n`;
  for (let round = 0; round < LOCK_ROUNDS; round += 1) {
    if (await createLock(paths, text)) return;

    const seen = await readIfThere(paths.lockFile);
    if (seen === null) continue;
    const current = parseLock(seen);
    if (current && (await isLockLive(current))) throw new AlreadyRunningError(current);

    // Dead. Move it aside rather than unlink it: two launchers that both judged the same lock
    // dead must not both delete and both win.
    const aside = tempPath(paths, 'standalone.lock');
    try {
      await rename(paths.lockFile, aside);
    } catch (e) {
      if (errorCode(e) === 'ENOENT') continue;
      throw e;
    }
    let keepAside = false;
    try {
      const moved = await readIfThere(aside);
      if (moved !== null && moved !== seen) {
        // Another launcher's fresh lock was moved. Put it back if that launcher is alive.
        const fresh = parseLock(moved);
        if (fresh && (await isLockLive(fresh))) {
          try {
            await link(aside, paths.lockFile);
          } catch (e) {
            if (errorCode(e) !== 'EEXIST') {
              // The only copy of a running launcher's lock. Keep it so a person can put it back.
              keepAside = true;
              throw new Error(
                `Could not put back the lock of a running launcher (${errorCode(e) ?? 'unknown error'}). ` +
                  `It is kept in ${aside}. Rename that file to ${paths.lockFile}.`,
              );
            }
          }
          throw new AlreadyRunningError(fresh);
        }
      }
    } finally {
      if (!keepAside) await rm(aside, { force: true });
    }
  }
  throw new Error(
    `Could not take the lock ${paths.lockFile} after ${LOCK_ROUNDS} tries. ` +
      'Another launcher may be starting on this data folder. Try again.',
  );
}

/**
 * True when the launcher named in the lock answers on its control port. One missed ping is not
 * enough to call it dead: an event loop stalled for two seconds would lose its lock, and the
 * next launcher would stop its Postgres. So it takes three failed pings in a row, with a short
 * pause between them. `status` uses this too.
 */
export async function isLockLive(info: LockInfo): Promise<boolean> {
  for (let attempt = 0; attempt < LIVE_PINGS; attempt += 1) {
    if (attempt > 0) await sleep(LIVE_PAUSE_MS);
    if (await pingControl(info)) return true;
  }
  return false;
}

/** Removes the lock only when it holds this token. */
export async function releaseLock(paths: StandalonePaths, token: string): Promise<void> {
  const current = await readLock(paths);
  if (current?.token !== token) return;
  await rm(paths.lockFile, { force: true });
}

/** True when this process created the lock, false when a lock was already there. */
async function createLock(paths: StandalonePaths, text: string): Promise<boolean> {
  const tmp = tempPath(paths, 'standalone.lock');
  try {
    await writeOwnerOnly(tmp, text);
    await link(tmp, paths.lockFile);
    return true;
  } catch (e) {
    if (errorCode(e) === 'EEXIST') return false;
    throw e;
  } finally {
    await rm(tmp, { force: true });
  }
}

function parseLock(text: string): LockInfo | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!Number.isInteger(d.pid) || (d.pid as number) < 1) return null;
  if (!isNonEmptyString(d.address) || !isNonEmptyString(d.startedAt) || !isNonEmptyString(d.token)) return null;
  if (!isPort(d.controlPort)) return null;
  return { pid: d.pid as number, address: d.address, startedAt: d.startedAt, controlPort: d.controlPort, token: d.token };
}

// ---------------------------------------------------------------------------------------------
// Small file helpers

/** A unique file name in the data folder, next to `name`. */
function tempPath(paths: StandalonePaths, name: string): string {
  return join(paths.root, `.${name}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
}

/** Writes a new file with mode 0600 and flushes it to disk. Fails if the file exists. */
async function writeOwnerOnly(file: string, text: string): Promise<void> {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Flushes a folder's entries to disk. Skipped on Windows, which cannot open a folder this way. */
async function syncFolder(dir: string): Promise<void> {
  if (IS_WINDOWS) return;
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readIfThere(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return null;
    throw e;
  }
}

async function isThere(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return false;
    throw e;
  }
}

function errorCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isPort(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65535;
}
