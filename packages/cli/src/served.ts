// Served mode: the server starts the CLI as its own process to run one command for one signed-in
// caller. It writes one JSON message on file descriptor 3, saying which command, with which
// arguments, for which account (handoff.ts). This file reads that message and checks the command
// against it before any action runs. It is the last check before a command touches the database,
// so every doubt is a refusal.
//
// Be plain about the limit. Served mode is the server's own hand-off, not a feature, and it is not
// documented as a setting. Someone who already holds the database settings could start the CLI the
// way the server does and name any account. That person is outside what this design bounds
// (spec section 6.8). What served mode bounds is a caller who holds only a key or a session: the
// server checked their capability for one command, and this file makes sure only that command runs,
// only on files in that request's folders, and under that caller's name.

import { closeSync, fstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { Command } from 'commander';
import { COMMAND_META, type PathMark } from './command-meta';
import { commandPath } from './command-list';
import { SERVED_FD, SERVED_FD_ENV, type ServedHandoff } from './handoff';

export { SERVED_FD, SERVED_FD_ENV, type ServedHandoff } from './handoff';

/** The variable was set but the hand-off could not be read or has the wrong shape. */
export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandoffError';
  }
}

/** The guard refused the command. The message is safe to show the caller. */
export class ServedRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServedRefusal';
  }
}

let current: ServedHandoff | null = null;

/** The hand-off read at start, for the rest of the CLI. Null when the server did not start this process. */
export function servedHandoff(): ServedHandoff | null {
  return current;
}

/** Sets the hand-off the rest of the CLI sees. index.ts calls it once with what readHandoff()
 *  gave. Tests call it to reach the guard without a real descriptor. */
export function setServedHandoff(handoff: ServedHandoff | null): void {
  current = handoff ? freeze(handoff) : null;
}

function freeze(h: ServedHandoff): ServedHandoff {
  return Object.freeze({
    path: h.path,
    argv: Object.freeze([...h.argv]) as string[],
    caller: Object.freeze({ ...h.caller }),
    runDir: h.runDir,
    keptDirs: Object.freeze([...h.keptDirs]) as string[],
  });
}

/**
 * Null when this process was not started by the server, and nothing else. Descriptor 3 is read only
 * when OPENLDR_SERVED_FD is '3'. When the variable is set at all and the hand-off cannot be used,
 * this throws HandoffError: the caller must stop, never fall back to its own argv.
 */
export function readHandoff(): ServedHandoff | null {
  const flag = process.env[SERVED_FD_ENV];
  if (flag === undefined) return null;
  // A program the command starts must not inherit the variable.
  delete process.env[SERVED_FD_ENV];
  if (flag !== String(SERVED_FD)) throw new HandoffError(`${SERVED_FD_ENV} must be ${SERVED_FD}.`);
  let text: string;
  try {
    // Only a pipe or a socket. Without one, descriptor 3 may be one Node opened for itself.
    const stat = fstatSync(SERVED_FD);
    if (!stat.isFIFO() && !stat.isSocket()) throw new Error('not a pipe');
    text = readFileSync(SERVED_FD, 'utf8');
  } catch {
    throw new HandoffError(`The hand-off on descriptor ${SERVED_FD} could not be read.`);
  }
  try { closeSync(SERVED_FD); } catch { /* already closed */ }
  return parseHandoff(text);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isTextOrNull = (v: unknown): v is string | null => v === null || isText(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
/** An absolute folder that is not the root of the disk. */
const isFolder = (v: unknown): v is string =>
  isText(v) && isAbsolute(v) && !v.includes('\0') && dirname(resolve(v)) !== resolve(v);

/** Checks the message strictly and keeps only the known fields. Throws HandoffError naming the bad
 *  field, never its value. */
export function parseHandoff(text: string): ServedHandoff {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new HandoffError('The hand-off is not JSON.'); }
  const bad = (field: string): never => { throw new HandoffError(`The hand-off is not valid: ${field}.`); };
  if (!isObject(raw)) return bad('message');
  const { path, argv, caller, runDir, keptDirs } = raw;
  if (!isText(path)) bad('path');
  if (!isStrings(argv)) bad('argv');
  if (!isObject(caller)) return bad('caller');
  if (!isText(caller.id)) bad('caller.id');
  if (!isText(caller.username)) bad('caller.username');
  if (!isTextOrNull(caller.displayName)) bad('caller.displayName');
  if (!isTextOrNull(caller.keyName)) bad('caller.keyName');
  if (!isFolder(runDir)) bad('runDir');
  if (!Array.isArray(keptDirs) || !keptDirs.every(isFolder)) bad('keptDirs');
  return {
    path: path as string,
    argv: [...(argv as string[])],
    caller: {
      id: caller.id as string,
      username: caller.username as string,
      displayName: caller.displayName as string | null,
      keyName: caller.keyName as string | null,
    },
    runDir: runDir as string,
    keptDirs: [...(keptDirs as string[])],
  };
}

const NAME_OPTIONS = ['--approved-by'] as const;

function nameRefusal(flag: string): ServedRefusal {
  return new ServedRefusal(`${flag} cannot be used through the app. The signed-in account is recorded.`);
}

/**
 * The preAction check in served mode. Does nothing when there is no hand-off. Throws ServedRefusal
 * before the action when the command is not the one the server checked, does not run through the
 * app, names someone else, or names a file outside this request's folders.
 */
export function guardServed(program: Command, cmd: Command): void {
  const h = current;
  if (!h) return;
  const path = commandPath(cmd);
  if (path !== h.path) throw new ServedRefusal('The command does not match the one the server checked.');
  const meta = COMMAND_META[path];
  if (!meta || meta.kind !== 'app') throw new ServedRefusal(`${path} does not run through the app.`);

  const args = [...cmd.args];
  const opts = cmd.opts();
  if (meta.localWhen?.(args, opts)) throw new ServedRefusal('This form of the command runs on your own machine.');
  const why = meta.refuse?.(args, opts) ?? null;
  if (why) throw new ServedRefusal(why);

  // Root options are parsed anywhere on the line, so the root --actor holds any --actor typed.
  if (program.opts().actor !== undefined) throw nameRefusal('--actor');
  for (const flag of NAME_OPTIONS) {
    const option = cmd.options.find((o) => o.long === flag);
    if (option && cmd.getOptionValue(option.attributeName()) !== undefined) throw nameRefusal(flag);
  }

  if (meta.paths?.length) {
    const roots = [h.runDir, ...h.keptDirs].map(realOf).filter((r): r is string => r !== null);
    for (const mark of meta.paths) checkMark(cmd, mark, args, opts, roots);
  }
}

function checkMark(cmd: Command, mark: PathMark, args: string[], opts: Record<string, unknown>, roots: string[]): void {
  const outside = () => new ServedRefusal(`${mark.target} is outside this request's folder.`);
  let raw: unknown;
  if (mark.target.startsWith('-')) {
    const option = cmd.options.find((o) => o.long === mark.target);
    if (!option) throw outside();
    raw = cmd.getOptionValue(option.attributeName());
  } else {
    const index = cmd.registeredArguments.findIndex((a) => a.name() === mark.target);
    if (index < 0) throw outside();
    raw = cmd.processedArgs[index];
  }
  if (raw === undefined) return;
  const kind = typeof mark.kind === 'function' ? mark.kind(args, opts) : mark.kind;
  for (const value of Array.isArray(raw) ? raw : [raw]) {
    if (typeof value !== 'string') throw outside();
    if (value === '') {
      // An empty input means "no path" (settings lab set --logo-file ''). An empty output would
      // write into the working folder.
      if (kind === 'input-file' || kind === 'input-dir') continue;
      throw new ServedRefusal(`${mark.target} needs a file or folder name.`);
    }
    if (!isInside(value, roots)) throw outside();
  }
}

/** True when the value is an absolute, already normal path whose real location is one of the roots
 *  or below one. Whole segments are compared: /tmp/run1 does not hold /tmp/run10/x. */
function isInside(value: string, roots: string[]): boolean {
  if (value.includes('\0') || !isAbsolute(value) || resolve(value) !== value) return false;
  const real = realOf(value);
  if (real === null) return false;
  return roots.some((root) => real === root || real.startsWith(root.endsWith(sep) ? root : root + sep));
}

/** The real location of an absolute path: symbolic links resolved on the nearest part that exists,
 *  and the rest, which does not exist yet, added back. Null when it cannot be worked out. */
function realOf(path: string): string | null {
  let head = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      const up = dirname(head);
      if (up === head) return null;
      tail.unshift(basename(head));
      head = up;
    }
  }
}
