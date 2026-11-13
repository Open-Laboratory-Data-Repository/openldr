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

import { closeSync, fstatSync, lstatSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import type { Command } from 'commander';
import { COMMAND_META, type PathMark } from './command-meta';
import { commandPath } from './command-list';
import { SERVED_FD, SERVED_FD_ENV, type ServedHandoff } from './handoff';

export { SERVED_FD, SERVED_FD_ENV, type ServedHandoff } from './handoff';

/** The most the hand-off may hold. More is an error, not a longer read. */
export const MAX_HANDOFF_BYTES = 1024 * 1024;

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

/** Sets the hand-off the rest of the CLI sees, once. index.ts calls it with what readHandoff()
 *  gave. A second call throws, so no code the command runs can change who the caller is. */
export function setServedHandoff(handoff: ServedHandoff): void {
  if (current) throw new Error('The served hand-off is already set.');
  current = freeze(handoff);
}

/** For tests only: forget the hand-off, so the next test can set its own. */
export function resetServedHandoffForTests(): void {
  current = null;
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
  const text = readDescriptor();
  try { closeSync(SERVED_FD); } catch { /* already closed */ }
  return parseHandoff(text);
}

/** Reads descriptor 3 to its end, at most MAX_HANDOFF_BYTES. */
function readDescriptor(): string {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    // Only a pipe or a socket. Without one, descriptor 3 may be one Node opened for itself.
    const stat = fstatSync(SERVED_FD);
    if (!stat.isFIFO() && !stat.isSocket()) throw new Error('not a pipe');
    const buf = Buffer.alloc(64 * 1024);
    for (;;) {
      const n = readSync(SERVED_FD, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      if (total > MAX_HANDOFF_BYTES) break;
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
  } catch {
    throw new HandoffError(`The hand-off on descriptor ${SERVED_FD} could not be read.`);
  }
  if (total > MAX_HANDOFF_BYTES) throw new HandoffError('The hand-off is larger than 1 MiB.');
  return Buffer.concat(chunks).toString('utf8');
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

/**
 * Moves the process into the request's folder. The child does this itself rather than trusting the
 * working folder it was started in, because a command given an empty or missing path reads there.
 * Throws ServedRefusal when the folder cannot be entered or its real path is the root of the disk.
 */
export function enterRunDir(handoff: ServedHandoff): void {
  // The folder holds a caller's uploads, and loadConfig() walks up from here for a .env.
  process.env.OPENLDR_SKIP_ENV_FILE = 'true';
  const real = realOf(handoff.runDir);
  if (real === null) throw new ServedRefusal("This request's folder cannot be used.");
  if (dirname(real) === real) throw new ServedRefusal("This request's folder is the root of the disk.");
  try {
    process.chdir(real);
  } catch {
    throw new ServedRefusal("This request's folder cannot be used.");
  }
}

const HELP_TOKENS = new Set(['--help', '-h', '--version', '-V']);

/**
 * Refuses an argv that asks for help or a version instead of a command, before it is parsed: help
 * runs no preAction hook, so the guard would never see it. Then turns help off on every command of
 * the program, so no other spelling (`user help key`, `-hx`) reaches it either.
 */
export function refuseHelp(program: Command, argv: readonly string[]): void {
  if (argv[0] === 'help' || argv.some((t) => HELP_TOKENS.has(t))) {
    throw new ServedRefusal('Help is not run through the app. Run the command on its own for help.');
  }
  const walk = (c: Command): void => {
    c.helpCommand(false);
    c.helpOption(false);
    for (const sub of c.commands) walk(sub);
  };
  walk(program);
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
    for (const mark of meta.paths) checkMark(cmd, mark, roots);
  }
}

function checkMark(cmd: Command, mark: PathMark, roots: string[]): void {
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
  for (const value of Array.isArray(raw) ? raw : [raw]) {
    if (typeof value !== 'string') throw outside();
    if (value === '') {
      // Most commands read an empty path as their working folder. Only a mark the table flags
      // means "no path" by it (settings lab set --logo-file '').
      if (mark.allowEmpty) continue;
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

/**
 * The real location of an absolute path, worked out one part at a time. A part that is a link is
 * resolved, and a link that cannot be resolved (its target is missing, or it loops) gives null: a
 * write through it would land wherever it points. Only a part with no entry at all is "not made
 * yet", and then the rest of the path is added back as it is. Any other error gives null.
 */
function realOf(path: string): string | null {
  const full = resolve(path);
  let real = parse(full).root;
  const parts = full.slice(real.length).split(sep).filter((p) => p !== '');
  for (let i = 0; i < parts.length; i += 1) {
    const next = join(real, parts[i]!);
    let isLink: boolean;
    try {
      isLink = lstatSync(next).isSymbolicLink();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return join(next, ...parts.slice(i + 1));
      return null;
    }
    if (!isLink) { real = next; continue; }
    try { real = realpathSync(next); } catch { return null; }
  }
  return real;
}
