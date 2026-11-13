// Starts the openldr CLI as a child process to run one command for one signed-in caller
// (cli-routes.ts does the checks first). The command, its arguments and the caller go down a pipe
// on descriptor 3 as one JSON message, never on the command line or in the environment, so no other
// user of the machine can read them in the process list.
//
// It also holds the limit on commands at once: a caller waits for a free slot, and gets "busy"
// after SLOT_WAIT_MS. The child holds the server's own database settings, so it is signalled only
// through the handle this file holds. A process ID is never looked up.
//
// Signals are tested on Linux only. On Windows, Node turns SIGINT into a hard kill, so a command
// there cannot stop at its next page (unproven).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { SERVED_FD, SERVED_FD_ENV, type ServedHandoff } from '@openldr/cli/wire';

/** How long a caller waits for a free slot before "busy". */
export const SLOT_WAIT_MS = 30_000;
/** How long an interrupted command has to stop before it is killed. */
export const KILL_AFTER_MS = 10_000;

/** No slot came free in time. */
export class BusyError extends Error {
  constructor() {
    super('busy');
    this.name = 'BusyError';
  }
}

/** The server is stopping: nothing new starts and waiting callers are refused. */
export class ClosingError extends Error {
  constructor() {
    super('The server is stopping.');
    this.name = 'ClosingError';
  }
}

/** The caller went away while waiting for a slot. */
export class LeftError extends Error {
  constructor() {
    super('The caller left.');
    this.name = 'LeftError';
  }
}

/**
 * The CLI entry file to start. A set CLI_ENTRY wins, resolved against the working folder. Unset, the
 * first that exists beside this module: `../cli/dist/index.js` (the image: /app/dist to
 * /app/cli/dist), then `../../../packages/cli/dev.mjs` (a checkout: apps/server/src to the repo
 * root). Null when none exists. This asks nothing about the tier.
 */
export function resolveCliEntry(
  setting: string | undefined,
  opts: { here?: string; cwd?: string; exists?: (path: string) => boolean } = {},
): string | null {
  const exists = opts.exists ?? existsSync;
  if (setting !== undefined && setting !== '') {
    const path = resolve(opts.cwd ?? process.cwd(), setting);
    return exists(path) ? path : null;
  }
  const here = opts.here ?? dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../cli/dist/index.js', '../../../packages/cli/dev.mjs']) {
    const path = resolve(here, rel);
    if (exists(path)) return path;
  }
  return null;
}

/**
 * The settings that name a file or folder. The child changes into the request folder before it
 * reads its config, so a relative value (or a relative default, such as PLUGIN_CRASH_LOG_DIR's)
 * would land inside a folder the server deletes. The child gets the server's own value instead,
 * made absolute against the server's working folder. WEB_DIST_DIR is read from the environment,
 * not the config schema. cli-runner.test.ts fails when the schema gains a setting named like a path
 * (ending in _DIR, _PATH, _ROOT or _FILE) that is on neither this list nor NOT_PATH_SETTINGS.
 */
export const PATH_SETTINGS = [
  'BLOB_DIR',
  'MARKETPLACE_LOCAL_REGISTRY_ROOT',
  'MARKETPLACE_REGISTRY_DIR',
  'PLUGIN_CRASH_LOG_DIR',
  'TERMINOLOGY_WORK_DIR',
  'TLS_CERT_PATH',
  'WEB_DIST_DIR',
  'WORKFLOW_FILE_ACCESS_ROOT',
] as const;

/** Settings named like a path that the child does not get as one, and why. */
export const NOT_PATH_SETTINGS: Readonly<Record<string, string>> = {
  LOG_FILE: 'removed, so the child logs to its standard error and not into the server log file',
};

/**
 * The child's environment: the server's own, with these changes and no others.
 * - LOG_FILE removed: the child's log lines go to its standard error, which goes back to the caller.
 * - Each PATH_SETTINGS entry with a value, absolute against the server's working folder. The value
 *   comes from the server's parsed config, defaults included; an empty value is left as it is,
 *   because some settings read '' as "off".
 * - The served flag, and OPENLDR_SKIP_ENV_FILE: the server already loaded its .env, and the child
 *   must not pick up a stray one above the request folder.
 * Nothing from the request goes in here.
 */
export function childEnv(
  base: NodeJS.ProcessEnv,
  settings: Readonly<Record<string, unknown>> = {},
  cwd: string = process.cwd(),
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.LOG_FILE;
  for (const name of PATH_SETTINGS) {
    const value = settings[name] ?? base[name];
    if (typeof value === 'string' && value !== '') env[name] = resolve(cwd, value);
  }
  env[SERVED_FD_ENV] = String(SERVED_FD);
  env.OPENLDR_SKIP_ENV_FILE = 'true';
  return env;
}

/** The exit code a shell would show: the code, or 128 plus the signal's number. */
function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  const n = signal ? osConstants.signals[signal] : undefined;
  return n ? 128 + n : 1;
}

/** A place in the limit on commands at once. Release it once on every path; a second call does nothing. */
export interface Slot {
  release(): void;
}

export interface RunHandle {
  readonly id: string;
  /** The account that started it. Only that account may interrupt it. */
  readonly ownerId: string;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** Resolves with the exit code once the process has gone. 1 when it could not start. */
  readonly exited: Promise<number>;
  readonly interrupted: boolean;
  /** SIGINT now, SIGKILL after KILL_AFTER_MS. A second call does not restart the wait. */
  interrupt(): void;
}

export interface CliRunner {
  /** Waits for a free slot. Throws BusyError after the wait, ClosingError on shutdown, LeftError
   *  when the signal aborts. With an `ownerId` and more than one slot, one account holds at most
   *  `maxRunning - 1` slots at once, so one account cannot shut every other account out. */
  acquire(signal?: AbortSignal, ownerId?: string): Promise<Slot>;
  /** Starts the child. Throws ClosingError when the server is stopping; the caller still holds the slot. */
  start(slot: Slot, input: { id: string; entry: string; ownerId: string; handoff: ServedHandoff }): RunHandle;
  /** The running command with this id, when this account started it. */
  find(id: string, ownerId: string): RunHandle | undefined;
  readonly closing: boolean;
  /** Aborts when close() is called. */
  readonly closingSignal: AbortSignal;
  /** Refuses waiting callers, interrupts every running command, and resolves when every slot has
   *  been released, so each caller's clean-up and audit row are done. Safe to call twice. */
  close(): Promise<void>;
}

export interface CliRunnerOptions {
  maxRunning: number;
  /** The server's environment. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** The server's parsed config, for the path settings the child gets made absolute. */
  settings?: Readonly<Record<string, unknown>>;
  /** The server's working folder, for those paths. Defaults to process.cwd(). */
  cwd?: string;
  waitMs?: number;
  killAfterMs?: number;
}

interface HeldSlot extends Slot {
  released: Promise<void>;
  ownerId: string | undefined;
}

interface Waiter {
  ownerId: string | undefined;
  resolve(slot: Slot): void;
  reject(err: Error): void;
  cleanup(): void;
}

export function createCliRunner(opts: CliRunnerOptions): CliRunner {
  const max = opts.maxRunning;
  const waitMs = opts.waitMs ?? SLOT_WAIT_MS;
  const killAfterMs = opts.killAfterMs ?? KILL_AFTER_MS;
  const held = new Set<HeldSlot>();
  const waiters: Waiter[] = [];
  const runs = new Map<string, RunHandle>();
  let closing = false;
  let closed: Promise<void> | null = null;
  const closingCtl = new AbortController();
  // One account's share. With one slot there is nothing to share, and nothing changes.
  const share = max > 1 ? max - 1 : max;

  const heldBy = (ownerId: string): number => {
    let n = 0;
    for (const s of held) if (s.ownerId === ownerId) n += 1;
    return n;
  };
  /** A free slot, and the account (when named) is under its share. */
  const canStart = (ownerId: string | undefined): boolean =>
    held.size < max && (ownerId === undefined || heldBy(ownerId) < share);

  const newSlot = (ownerId: string | undefined): HeldSlot => {
    let done!: () => void;
    const released = new Promise<void>((r) => { done = r; });
    let open = true;
    const slot: HeldSlot = {
      released,
      ownerId,
      release() {
        if (!open) return;
        open = false;
        held.delete(slot);
        done();
        handOn();
      },
    };
    held.add(slot);
    return slot;
  };

  /** Starts waiters in arrival order. A waiter held back by its own account's share is passed
   *  over, so it never blocks a waiter from another account behind it. */
  const handOn = (): void => {
    for (let i = 0; !closing && held.size < max && i < waiters.length;) {
      const w = waiters[i]!;
      if (!canStart(w.ownerId)) { i += 1; continue; }
      waiters.splice(i, 1);
      w.cleanup();
      w.resolve(newSlot(w.ownerId));
    }
  };

  return {
    get closing() { return closing; },
    closingSignal: closingCtl.signal,

    acquire(signal, ownerId) {
      if (closing) return Promise.reject(new ClosingError());
      if (signal?.aborted) return Promise.reject(new LeftError());
      // Start now when this caller may, and no waiter ahead of it may. A waiter held back only by
      // its own share does not make this caller wait.
      if (canStart(ownerId) && !waiters.some((w) => canStart(w.ownerId))) return Promise.resolve(newSlot(ownerId));
      return new Promise<Slot>((resolve, reject) => {
        const leave = (err: Error) => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          waiter.cleanup();
          reject(err);
        };
        const timer = setTimeout(() => leave(new BusyError()), waitMs);
        const onAbort = () => leave(new LeftError());
        const waiter: Waiter = {
          ownerId,
          resolve,
          reject,
          cleanup: () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
          },
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        waiters.push(waiter);
      });
    },

    start(_slot, input) {
      if (closing) throw new ClosingError();
      const child = spawn(process.execPath, [input.entry], {
        cwd: input.handoff.runDir,
        env: childEnv(opts.env ?? process.env, opts.settings, opts.cwd),
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // Its own process group, so a Ctrl+C on a server in a terminal does not reach the child as
        // well as the runner's own SIGINT. A second SIGINT stops `import start` mid-page. Windows
        // gives it its own console instead (unproven).
        detached: true,
      });
      let finished = false;
      let interrupted = false;
      let killTimer: NodeJS.Timeout | undefined;

      const exited = new Promise<number>((resolveExit) => {
        const settle = (code: number) => {
          if (finished) return;
          finished = true;
          clearTimeout(killTimer);
          runs.delete(input.id);
          resolveExit(code);
        };
        child.once('exit', (code, signal) => settle(exitCodeOf(code, signal)));
        // Only a failed start settles here. A later error (a signal that could not be sent) leaves
        // the exit event to settle it.
        child.on('error', () => { if (child.pid === undefined) settle(1); });
      });

      // The hand-off, then the pipe is closed. The child may close its end first; that is its error.
      const pipe = child.stdio[SERVED_FD] as Writable | null;
      if (pipe) {
        pipe.on('error', () => {});
        pipe.end(JSON.stringify(input.handoff));
      }

      const handle: RunHandle = {
        id: input.id,
        ownerId: input.ownerId,
        stdout: child.stdout!,
        stderr: child.stderr!,
        exited,
        get interrupted() { return interrupted; },
        interrupt() {
          if (finished || interrupted) return;
          interrupted = true;
          child.kill('SIGINT');
          killTimer = setTimeout(() => { if (!finished) child.kill('SIGKILL'); }, killAfterMs);
        },
      };
      runs.set(input.id, handle);
      return handle;
    },

    find(id, ownerId) {
      const run = runs.get(id);
      return run && run.ownerId === ownerId ? run : undefined;
    },

    close() {
      if (closed) return closed;
      closing = true;
      closingCtl.abort();
      for (const w of waiters.splice(0)) {
        w.cleanup();
        w.reject(new ClosingError());
      }
      for (const run of runs.values()) run.interrupt();
      closed = Promise.all([...held].map((s) => s.released)).then(() => undefined);
      return closed;
    },
  };
}
