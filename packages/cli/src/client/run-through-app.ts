// Sends one command to the running app and plays its answer back (spec section 6.5).
//
// This file decides what leaves the caller's machine and what the server may write on it:
// - Path values the caller typed are replaced by placeholders, by their position on the line. The
//   rewritten line is parsed again and compared with the first parse before anything is sent.
// - Only the files and folders the command's path marks name are uploaded.
// - The server is not trusted with paths: an output goes only to the place the caller named.
// - Each output file is written under a temporary name beside its target and renamed when complete.
//
// HTTP goes through node:http and node:https, not fetch. A refusal can arrive while the upload is
// still going, and the client must read it and stop sending. node:http hands over the answer as
// soon as it arrives, and never follows a redirect, so a key can never be carried to another host.

import { randomBytes } from 'node:crypto';
import { constants as fsConstants, readFileSync, statSync } from 'node:fs';
import { lstat, mkdir, open, readdir, readlink, realpath, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Command, Option } from 'commander';
import type { CommandMeta, PathKind, PathMark } from '../command-meta';
import { runningVersion } from '../update';
import { decodeFrames, encodeFrame, MAX_DATA_BYTES, PATH_PLACEHOLDER, type ClientFrame, type ServerFrame } from '../wire';
import type { Credential } from './credentials';
import { clean, connectionMessage, endpoint, REDIRECT_MESSAGE, sendRequest, signInRefused } from './request';

/** Printed when the line cannot be rewritten safely. Nothing has been sent. */
export const NOT_PREPARED = 'This command line could not be prepared for the app. Nothing was sent.';

/** A refusal before any request. The message is printed as one line, and the exit code is 1. */
class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refusal';
  }
}

// ---------------------------------------------------------------------------------------------
// The words after the command path
// ---------------------------------------------------------------------------------------------

const maybeOption = (arg: string): boolean => arg.length > 1 && arg[0] === '-';
/** commander's own Option.is(), which its typings leave out. */
const isFlag = (o: Option, arg: string): boolean => o.short === arg || o.long === arg;

/**
 * The caller's words after the command path, with the root options and their values taken out,
 * wherever they were typed. This follows commander's own reading of the root (parseOptions in
 * commander 12): a root option is taken anywhere before `--`. Null when the line does not start
 * with the command's words once root options are out, or when a root option has a short flag.
 */
export function wordsAfterPath(root: Command, path: string, userArgs: readonly string[]): string[] | null {
  if (root.options.some((o) => o.short)) return null;
  const rest: string[] = [];
  for (let i = 0; i < userArgs.length; i += 1) {
    const arg = userArgs[i]!;
    if (arg === '--') {
      rest.push(...userArgs.slice(i));
      break;
    }
    if (maybeOption(arg)) {
      const exact = root.options.find((o) => isFlag(o, arg));
      if (exact) {
        if (exact.required) i += 1;
        else if (exact.optional && i + 1 < userArgs.length && !maybeOption(userArgs[i + 1]!)) i += 1;
        continue;
      }
      if (/^--[^=]+=/.test(arg)) {
        const withValue = root.options.find((o) => isFlag(o, arg.slice(0, arg.indexOf('='))));
        if (withValue && (withValue.required || withValue.optional)) continue;
      }
    }
    rest.push(arg);
  }
  const words = path.split(' ');
  if (rest.length < words.length || words.some((w, i) => rest[i] !== w)) return null;
  return rest.slice(words.length);
}

// ---------------------------------------------------------------------------------------------
// Which word holds which value
// ---------------------------------------------------------------------------------------------

/** A word, or the part of a word from `at` on, that holds an option's value. */
interface ValueAt { option: Option; token: number; form: 'whole' | 'eq' | 'glued'; at: number }
interface Scan { positional: number[]; values: ValueAt[]; terminator: number | null }

/**
 * Reads the words as the leaf command's parseOptions does (commander 12), and says which word holds
 * each positional argument and each option value. Null on anything commander would have refused,
 * which cannot happen after a parse that reached the action, or on a form this does not follow.
 */
function scanLeaf(cmd: Command, tokens: readonly string[]): Scan | null {
  const find = (arg: string) => cmd.options.find((o) => isFlag(o, arg));
  const positional: number[] = [];
  const values: ValueAt[] = [];
  // `skip`: the item's text is '-' + tokens[token].slice(skip). A whole word has skip 1.
  const queue = tokens.map((text, token) => ({ text, token, skip: 1, whole: true }));
  let active: Option | null = null;
  while (queue.length > 0) {
    const item = queue.shift()!;
    const arg = item.text;
    if (item.whole && arg === '--') {
      for (const rest of queue) positional.push(rest.token);
      return { positional, values, terminator: item.token };
    }
    if (active && !maybeOption(arg)) {
      if (!item.whole) return null;
      values.push({ option: active, token: item.token, form: 'whole', at: 0 });
      continue;
    }
    active = null;
    if (maybeOption(arg)) {
      const option = find(arg);
      if (option) {
        const next = queue[0];
        if (option.required || (option.optional && next !== undefined && !maybeOption(next.text))) {
          const value = queue.shift();
          if (!value || !value.whole) return null;
          values.push({ option, token: value.token, form: 'whole', at: 0 });
        }
        active = option.variadic ? option : null;
        continue;
      }
    }
    if (arg.length > 2 && arg[0] === '-' && arg[1] !== '-') {
      const option = find(`-${arg[1]}`);
      if (option) {
        // commander's combineFlagAndOptionalValue is on by default and this program never turns it off.
        if (option.required || option.optional) {
          values.push({ option, token: item.token, form: 'glued', at: item.skip + 1 });
        } else {
          queue.unshift({ text: `-${arg.slice(2)}`, token: item.token, skip: item.skip + 1, whole: false });
        }
        continue;
      }
    }
    if (/^--[^=]+=/.test(arg)) {
      const eq = arg.indexOf('=');
      const option = find(arg.slice(0, eq));
      if (option && (option.required || option.optional)) {
        values.push({ option, token: item.token, form: 'eq', at: eq + item.skip });
        continue;
      }
    }
    // An unknown option would have stopped commander before the action.
    if (maybeOption(arg) || !item.whole) return null;
    positional.push(item.token);
  }
  return { positional, values, terminator: null };
}

// ---------------------------------------------------------------------------------------------
// The plan: the rewritten line, and what goes up and comes down
// ---------------------------------------------------------------------------------------------

interface Upload { ref: string; kind: 'input-file' | 'input-dir'; typed: string; keep: boolean; mark: PathMark }
interface Download { ref: string; kind: 'output-file' | 'output-dir'; typed: string }
interface Plan {
  argv: string[];
  inputs: Upload[];
  outputs: Download[];
  expectedArgs: string[];
  expectedOpts: Record<string, unknown>;
}

/** 16 characters from the ref alphabet, so real output cannot hold a placeholder by chance. */
const newRef = (): string => randomBytes(12).toString('base64url');

/** A placeholder in place of the caller's path, or '' kept as it is where the mark allows it. */
function placeholderFor(value: string, mark: PathMark, kind: PathKind, label: string, plan: Plan): string | null {
  if (value === '') {
    if (mark.allowEmpty) return null;
    throw new Refusal(`${label} needs a file or folder name.`);
  }
  const ref = newRef();
  if (kind === 'input-file' || kind === 'input-dir') plan.inputs.push({ ref, kind, typed: value, keep: mark.keep === true, mark });
  else plan.outputs.push({ ref, kind, typed: value });
  return `${PATH_PLACEHOLDER}${ref}`;
}

function planCall(input: {
  path: string; tokens: readonly string[]; meta: CommandMeta; command: Command;
  parsedArgs: readonly string[]; parsedOpts: Record<string, unknown>;
}): Plan {
  const { command: cmd, tokens, meta, parsedArgs, parsedOpts } = input;
  const notPrepared = () => new Refusal(NOT_PREPARED);
  const scan = scanLeaf(cmd, tokens);
  if (!scan || !isDeepStrictEqual(scan.positional.map((i) => tokens[i]), [...parsedArgs])) throw notPrepared();

  const plan: Plan = { argv: [], inputs: [], outputs: [], expectedArgs: [...parsedArgs], expectedOpts: { ...parsedOpts } };
  /** Word index -> the words that replace it. */
  const replace = new Map<number, string[]>();
  const appended: string[] = [];
  const rewrite = (v: ValueAt, ph: string) => {
    const word = tokens[v.token]!;
    if (v.form === 'whole') replace.set(v.token, [ph]);
    else if (v.form === 'eq') replace.set(v.token, [word.slice(0, v.at) + ph]);
    // The server replaces only a whole word or `--flag=`, so a glued short value is split in two.
    else replace.set(v.token, [word.slice(0, v.at), ph]);
  };
  const strings = (raw: unknown): string[] => {
    const list = Array.isArray(raw) ? raw : [raw];
    if (!list.every((s): s is string => typeof s === 'string')) throw notPrepared();
    return list;
  };

  for (const mark of meta.paths ?? []) {
    const kind = typeof mark.kind === 'function' ? mark.kind([...parsedArgs], parsedOpts) : mark.kind;
    if (mark.target.startsWith('-')) {
      const option = cmd.options.find((o) => o.long === mark.target);
      if (!option) throw notPrepared();
      const key = option.attributeName();
      const raw = parsedOpts[key];
      if (raw === undefined) continue;
      const list = strings(raw);
      const found = scan.values.filter((v) => v.option === option);
      const valueOf = (v: ValueAt) => tokens[v.token]!.slice(v.at);
      if (cmd.getOptionValueSource(key) === 'cli') {
        if (option.variadic) {
          if (found.length !== list.length || found.some((v, n) => valueOf(v) !== list[n])) throw notPrepared();
          plan.expectedOpts[key] = list.map((value, n) => {
            const ph = placeholderFor(value, mark, kind, mark.target, plan);
            if (ph === null) return value;
            rewrite(found[n]!, ph);
            return ph;
          });
        } else {
          const last = found[found.length - 1];
          if (!last || list.length !== 1 || valueOf(last) !== list[0]) throw notPrepared();
          const ph = placeholderFor(list[0]!, mark, kind, mark.target, plan);
          if (ph === null) continue;
          // Every earlier occurrence gets the same placeholder: commander keeps the last, and the
          // caller's other path strings need not leave the machine.
          for (const v of found) rewrite(v, ph);
          plan.expectedOpts[key] = ph;
        }
      } else {
        // From a default or the environment: still a path the command uses. Sent explicitly.
        const phs = list.map((value) => {
          const ph = placeholderFor(value, mark, kind, mark.target, plan);
          appended.push(`${option.long}=${ph ?? value}`);
          return ph ?? value;
        });
        plan.expectedOpts[key] = option.variadic ? phs : phs[0];
      }
    } else {
      const index = cmd.registeredArguments.findIndex((a) => a.name() === mark.target);
      if (index < 0) throw notPrepared();
      const arg = cmd.registeredArguments[index]!;
      const raw: unknown = cmd.processedArgs[index];
      // An absent variadic argument is an empty list in commander, not undefined.
      if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) continue;
      const at = arg.variadic ? scan.positional.slice(index) : scan.positional.slice(index, index + 1);
      // A positional that came from its default has no word to replace.
      if (at.length === 0) throw notPrepared();
      at.forEach((token, n) => {
        const ph = placeholderFor(tokens[token]!, mark, kind, `<${mark.target}>`, plan);
        if (ph === null) return;
        replace.set(token, [ph]);
        plan.expectedArgs[index + n] = ph;
      });
    }
  }

  // The server takes at most one ref per path mark. A variadic path mark could give more.
  if (plan.inputs.length + plan.outputs.length > (meta.paths?.length ?? 0)) {
    throw new Refusal('This command names more files than the app takes in one call. Run it once for each file.');
  }

  const words: string[] = input.path.split(' ');
  tokens.forEach((word, i) => {
    if (i === scan.terminator) words.push(...appended);
    words.push(...(replace.get(i) ?? [word]));
  });
  if (scan.terminator === null) words.push(...appended);
  plan.argv = words;
  return plan;
}

// ---------------------------------------------------------------------------------------------
// The files to upload, checked before any request
// ---------------------------------------------------------------------------------------------

/**
 * One file to upload. `open` is the real path recorded at walk time, and `dev` and `ino` say which
 * file it was. When its turn comes, the file is opened again with O_NOFOLLOW and must still be that
 * file (Ruling 68): a file or folder swapped for a link in between is refused, not followed.
 */
interface Send { ref: string; rel: string; open: string; typed: string; dev: bigint; ino: bigint }
type Pinned = Pick<Send, 'open' | 'dev' | 'ino'>;

/** One part of a name the server accepts: not empty, not `.` or `..`, no `/`, `\` or control character. */
const isPart = (v: string): boolean => v !== '' && v !== '.' && v !== '..' && !/[/\\\x00-\x1f\x7f]/.test(v);
const hasControl = (v: string): boolean => /[\x00-\x1f\x7f]/.test(v);

/** A regular file's text, or undefined. Never opens anything else, so a FIFO cannot block it. */
function readText(path: string): string | undefined {
  try {
    if (!statSync(path).isFile()) return undefined;
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function statOrRefuse(typed: string) {
  try {
    return await stat(typed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') throw new Refusal(`Cannot find ${typed}.`);
    throw new Refusal(`Cannot read ${typed}.`);
  }
}

/** True when `real` is `root` or under it, comparing whole parts. Both are real paths. */
const within = (real: string, root: string): boolean => real === root || real.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * Where a link found inside a folder really leads (Ruling 64). Throws Refusal, naming the link, when
 * it leads nowhere or outside `realRoot`: an upload sends all it can reach, so a link to the home
 * folder would send the home folder.
 */
async function linkInside(abs: string, shownAs: string, realRoot: string, folder: string): Promise<string> {
  let real: string;
  try {
    real = await realpath(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ELOOP') throw new Refusal(`${shownAs} is a link in a loop of links.`);
    throw new Refusal(`${shownAs} is a link to something that does not exist.`);
  }
  if (!within(real, realRoot)) throw new Refusal(`${shownAs} is a link that points outside ${folder}.`);
  return real;
}

const changedWhileRead = (shownAs: string) => new Refusal(`${shownAs} changed while it was being read.`);

/** For tests only: runs before each step of pinning a file, so a test can replay a swap at an exact
 *  step instead of racing a second process. `beforeOpen` runs just before each upload file is
 *  opened for sending. Never set outside tests. */
export const uploadSeam: {
  beforeFs?: (step: 'lstat' | 'realpath' | 'open', path: string) => Promise<void>;
  beforeOpen?: (typed: string) => Promise<void>;
} = {};

// Each is undefined on Windows (unproven there): the open then follows a last link, and the device
// and inode check still refuses a file that is not the one walked.
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_NOCTTY ?? 0);

/**
 * True where the kernel can say where an open file is (Linux). On macOS and Windows Node gives no
 * path from a handle, so there the device and inode check stands alone (unproven there).
 */
const HAS_PROC_FD = (() => {
  try {
    return statSync('/proc/self/fd').isDirectory();
  } catch {
    return false;
  }
})();

/** Where the kernel says the file behind this handle is, whatever path was used to reach it
 *  (Ruling 70). Null when it cannot be read. */
async function locationOf(fh: FileHandle): Promise<string | null> {
  try {
    return await readlink(`/proc/self/fd/${fh.fd}`);
  } catch {
    return null;
  }
}

/**
 * Opens the pinned path and records the file from the handle, not from a path (Ruling 70). The
 * handle must be a regular file with the device and inode the path gave, and, where the kernel can
 * say, it must really be at that real path and inside `realRoot`. A parent folder swapped for a link
 * between the path lookups and this open is caught here: the kernel reports where the file is.
 */
async function confirmByHandle(p: Pinned, shownAs: string, realRoot: string | null): Promise<Pinned> {
  await uploadSeam.beforeFs?.('open', p.open);
  let fh: FileHandle;
  try {
    fh = await open(p.open, OPEN_FLAGS);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'ENOENT' || code === 'ENOTDIR' || code === 'EMLINK') throw changedWhileRead(shownAs);
    throw new Refusal(`Cannot read ${shownAs}.`);
  }
  try {
    const st = await fh.stat({ bigint: true });
    if (!st.isFile() || st.dev !== p.dev || st.ino !== p.ino) throw changedWhileRead(shownAs);
    if (!HAS_PROC_FD) return p;
    const at = await locationOf(fh);
    if (at === null || at !== p.open || (realRoot !== null && !within(at, realRoot))) throw changedWhileRead(shownAs);
    return { open: at, dev: st.dev, ino: st.ino };
  } catch (err) {
    if (err instanceof Refusal) throw err;
    throw new Refusal(`Cannot read ${shownAs}.`);
  } finally {
    await fh.close().catch(() => {});
  }
}

/**
 * Pins a regular file at a real path: its device and inode from lstat, the real path checked again,
 * then the file opened and checked from its handle. Null for anything that is not a regular file.
 */
async function pinReal(real: string, shownAs: string, realRoot: string | null): Promise<Pinned | null> {
  await uploadSeam.beforeFs?.('lstat', real);
  const st = await lstat(real, { bigint: true }).catch(() => null);
  if (!st?.isFile()) return null;
  await uploadSeam.beforeFs?.('realpath', real);
  const again = await realpath(real).catch(() => null);
  if (again !== real || (realRoot !== null && !within(again, realRoot))) throw changedWhileRead(shownAs);
  return confirmByHandle({ open: real, dev: st.dev, ino: st.ino }, shownAs, realRoot);
}

/**
 * Pins a file found inside a folder the caller named (Rulings 68 and 70). A link is followed only to
 * a regular file whose real target is inside `realRoot`. A link to a folder is refused, wherever it
 * leads. `strict` (a folder walk, where readdir already listed it): an entry that has gone or is no
 * longer a file or a link changed while it was being read. Not strict (a companion): null for
 * anything that is missing or not a regular file.
 */
async function pinInside(abs: string, shownAs: string, realRoot: string, folder: string, strict: boolean): Promise<Pinned | null> {
  await uploadSeam.beforeFs?.('lstat', abs);
  const entry = await lstat(abs, { bigint: true }).catch(() => null);
  if (!entry || (!entry.isSymbolicLink() && !entry.isFile())) {
    if (strict) throw changedWhileRead(shownAs);
    return null;
  }
  if (entry.isSymbolicLink()) {
    const real = await linkInside(abs, shownAs, realRoot, folder);
    if ((await stat(real).catch(() => null))?.isDirectory()) {
      throw new Refusal(`${shownAs} is a link to a folder. A link to a folder is not sent.`);
    }
    return pinReal(real, shownAs, realRoot);
  }
  await uploadSeam.beforeFs?.('realpath', abs);
  const real = await realpath(abs).catch(() => null);
  if (real === null || !within(real, realRoot)) throw changedWhileRead(shownAs);
  const pinned = await pinReal(real, shownAs, realRoot);
  if (!pinned || pinned.dev !== entry.dev || pinned.ino !== entry.ino) throw changedWhileRead(shownAs);
  return pinned;
}

/**
 * Regular files under a folder, sorted by name, each pinned (Ruling 68). A link to a regular file
 * inside the folder is followed; a link to a folder, or to anything outside, is a Refusal. Anything
 * else that is not a file or a folder is skipped. An empty folder sends nothing. Every folder walked
 * must really be inside, and none is walked twice, so a folder swapped for a link mid-walk is
 * neither followed out nor walked in a loop.
 */
async function walkFolder(root: string, typed: string, ref: string): Promise<Send[]> {
  const files: Send[] = [];
  const seen = new Set<string>();
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    throw new Refusal(`Cannot read ${typed}.`);
  }
  const visit = async (abs: string, rel: string): Promise<void> => {
    const shownAs = rel === '' ? typed : join(typed, rel);
    let entries;
    if (rel !== '') {
      // readdir listed a folder here. Anything else now changed while it was being read.
      const entry = await lstat(abs).catch(() => null);
      if (!entry?.isDirectory()) throw changedWhileRead(shownAs);
    }
    try {
      const real = await realpath(abs);
      if (!within(real, realRoot)) throw changedWhileRead(shownAs);
      if (seen.has(real)) return;
      seen.add(real);
      entries = await readdir(abs, { withFileTypes: true });
    } catch (err) {
      if (err instanceof Refusal) throw err;
      throw new Refusal(`Cannot read ${shownAs}.`);
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const childAbs = join(abs, e.name);
      const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
      const childShown = join(typed, childRel);
      if (!e.isSymbolicLink() && !e.isFile() && !e.isDirectory()) continue;
      if (!isPart(e.name)) throw new Refusal(`Cannot send ${childShown}: its name holds a character the app does not accept.`);
      if (e.isDirectory()) {
        await visit(childAbs, childRel);
        continue;
      }
      const pinned = await pinInside(childAbs, childShown, realRoot, typed, true);
      if (pinned) files.push({ ref, rel: childRel, typed: childShown, ...pinned });
    }
  };
  await visit(root, '');
  return files;
}

/** Checks every input and lists the files to send. Throws Refusal naming the path. */
async function prepareUploads(plan: Plan, opts: Record<string, unknown>): Promise<{ sends: Send[]; names: Map<string, string> }> {
  const sends: Send[] = [];
  const names = new Map<string, string>();
  for (const input of plan.inputs) {
    const st = await statOrRefuse(input.typed);
    const name = basename(resolve(input.typed));
    if (!isPart(name)) {
      throw new Refusal(hasControl(name) ? `Cannot send ${input.typed}: its name holds a control character.` : `Cannot send ${input.typed}: it has no name the app accepts.`);
    }
    names.set(input.ref, name);
    if (input.kind === 'input-file') {
      if (!st.isFile()) throw new Refusal(`${input.typed} is not a file.`);
      // The caller named this file, so it may be a link, wherever it leads. It is pinned all the same.
      const real = await realpath(input.typed).catch(() => null);
      const pinned = real === null ? null : await pinReal(real, input.typed, null);
      if (!pinned) throw changedWhileRead(input.typed);
      sends.push({ ref: input.ref, rel: '', typed: input.typed, ...pinned });
      const beside = dirname(input.typed);
      const companions = input.mark.companions?.({
        opts,
        readSelf: () => readText(input.typed),
        readSibling: (n) => (isPart(n) ? readText(join(beside, n)) : undefined),
      }) ?? [];
      const done = new Set<string>([name]);
      let realBeside: string | null = null;
      for (const c of companions) {
        if (!isPart(c) || done.has(c)) continue;
        done.add(c);
        const abs = join(beside, c);
        // The caller named the main file, not its companions: a companion is pinned like a file
        // in a folder, inside the main file's folder (Rulings 64 and 68).
        realBeside ??= await realpath(beside).catch(() => null);
        if (realBeside === null) throw new Refusal(`Cannot read ${beside}.`);
        const pinned = await pinInside(abs, abs, realBeside, beside, false);
        // A companion that is missing is not sent, and the command then fails as it does today.
        if (!pinned) continue;
        sends.push({ ref: input.ref, rel: c, typed: abs, ...pinned });
      }
    } else {
      if (!st.isDirectory()) throw new Refusal(`${input.typed} is not a folder.`);
      sends.push(...(await walkFolder(input.typed, input.typed, input.ref)));
    }
  }
  return { sends, names };
}

// ---------------------------------------------------------------------------------------------
// Turning placeholders in the output back into what the caller typed
// ---------------------------------------------------------------------------------------------

/**
 * Replaces each placeholder with the caller's own text in a byte stream. A placeholder can be cut
 * across two frames, so the tail of a chunk that could start one is held back for the next.
 */
export function createUnmasker(pairs: ReadonlyArray<readonly [placeholder: string, typed: string]>) {
  const list = pairs.map(([ph, typed]) => ({ ph: Buffer.from(ph), typed: Buffer.from(typed) }));
  const maxLen = list.reduce((m, p) => Math.max(m, p.ph.length), 0);
  let held = Buffer.alloc(0);
  const startsOne = (tail: Buffer) => list.some((p) => p.ph.length > tail.length && p.ph.subarray(0, tail.length).equals(tail));
  return {
    push(chunk: Buffer): Buffer {
      const buf = held.length > 0 ? Buffer.concat([held, chunk]) : chunk;
      const out: Buffer[] = [];
      let i = 0;
      for (;;) {
        let at = -1;
        let match: (typeof list)[number] | undefined;
        for (const p of list) {
          const found = buf.indexOf(p.ph, i);
          if (found >= 0 && (at < 0 || found < at)) { at = found; match = p; }
        }
        if (!match) break;
        out.push(buf.subarray(i, at), match.typed);
        i = at + match.ph.length;
      }
      let keep = buf.length;
      for (let q = Math.max(i, buf.length - maxLen + 1); q < buf.length; q += 1) {
        if (startsOne(buf.subarray(q))) { keep = q; break; }
      }
      out.push(buf.subarray(i, keep));
      held = Buffer.from(buf.subarray(keep));
      return Buffer.concat(out);
    },
    flush(): Buffer {
      const rest = held;
      held = Buffer.alloc(0);
      return rest;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------

/** Writes and waits while the stream is full. Never waits on a stream that has gone. */
async function writeTo(stream: NodeJS.WritableStream, data: Buffer | string): Promise<void> {
  if (data.length === 0) return;
  if (stream.write(data)) return;
  await new Promise<void>((done) => {
    const finish = () => {
      stream.off('drain', finish);
      stream.off('close', finish);
      stream.off('error', finish);
      done();
    };
    stream.on('drain', finish);
    stream.on('close', finish);
    stream.on('error', finish);
  });
}

/** Strict base64 of at most MAX_DATA_BYTES, as the server sends it. */
const MAX_DATA_TEXT = Math.ceil(MAX_DATA_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;

class ProtocolError extends Error {}
class NotAllowedError extends Error {}
class NotAskedError extends Error {}
class LocalWriteError extends Error {}

/**
 * Makes the folders `parts` under the output folder `root` one level at a time. Each level that
 * already exists is checked to really be inside `root` before anything is made under it, so a link
 * already in the caller's folder cannot lead a new folder outside it. `root` itself is the caller's
 * own choice and is made with its parents.
 */
async function makeInside(root: string, parts: string[], shownPath: string): Promise<void> {
  try {
    await mkdir(root, { recursive: true });
  } catch {
    throw new LocalWriteError(shownPath);
  }
  const realRoot = await realpath(root).catch(() => null);
  if (!realRoot) throw new LocalWriteError(shownPath);
  let at = root;
  for (const part of parts) {
    at = join(at, part);
    if (!(await lstat(at).catch(() => null))) {
      try {
        await mkdir(at);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new LocalWriteError(shownPath);
      }
    }
    const real = await realpath(at).catch(() => null);
    if (!real || !within(real, realRoot)) throw new NotAllowedError();
    if (!(await stat(real).catch(() => null))?.isDirectory()) throw new LocalWriteError(shownPath);
  }
}

function bytesOf(d: unknown): Buffer {
  if (typeof d !== 'string' || d.length > MAX_DATA_TEXT || d.length % 4 !== 0 || !BASE64.test(d)) throw new ProtocolError();
  const buf = Buffer.from(d, 'base64');
  if (buf.length > MAX_DATA_BYTES) throw new ProtocolError();
  return buf;
}

/** The first 64 KiB of a refusal's body as JSON, or null. */
async function readRefusal(res: IncomingMessage): Promise<Record<string, unknown> | null> {
  const parts: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of res) {
      total += (chunk as Buffer).length;
      if (total > 64 * 1024) break;
      parts.push(chunk as Buffer);
    }
    const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function refusalMessage(status: number, body: Record<string, unknown> | null, sent: Credential['kind'], env: NodeJS.ProcessEnv): string {
  if (status >= 300 && status < 400) return REDIRECT_MESSAGE;
  if (status === 401) return signInRefused(sent, env);
  if (status === 403 && typeof body?.capability === 'string') return `This account lacks the capability ${clean(body.capability)}.`;
  if (status === 503 && body?.error === 'busy') return 'OpenLDR is running other commands. Try again shortly.';
  if (typeof body?.error === 'string' && body.error.trim() !== '') return clean(body.error);
  return `OpenLDR answered with status ${status}.`;
}

/** How long the interrupt request may take before it is given up. */
const INTERRUPT_TIMEOUT_MS = 5000;
/** After the exit frame, how long the client waits for the server to end the answer. */
export const AFTER_EXIT_WAIT_MS = 10_000;

/** An output file being written under its temporary name. */
interface Opened { handle: FileHandle; temp: string; target: string; shown: string }

export interface ThroughAppInput {
  /** The command's path, such as 'user key create'. */
  path: string;
  /** The caller's words after the command path, root options taken out. */
  tokens: string[];
  meta: CommandMeta;
  /** The leaf command that was parsed: its options and arguments say which word is which. */
  command: Command;
  parsedArgs: string[];
  parsedOpts: Record<string, unknown>;
  /** Parses a whole line (command path first) without running anything. Null when it does not parse. */
  reparse: (argv: string[]) => Promise<{ args: string[]; opts: Record<string, unknown> } | null>;
  url: string;
  credential: Credential;
  /** The environment the credential was found in, to name where a refused key came from. */
  env?: NodeJS.ProcessEnv;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
  signals: NodeJS.EventEmitter;
}

/** Sends the command, plays the answer back, and returns the exit code. */
export async function runThroughApp(input: ThroughAppInput): Promise<number> {
  const fail = async (message: string): Promise<number> => {
    await writeTo(input.err, `${message.split('\n')[0]}\n`);
    return 1;
  };

  let plan: Plan;
  let prepared: { sends: Send[]; names: Map<string, string> };
  try {
    plan = planCall(input);
    // Check the work before sending: the rewritten line must parse the same, path values aside.
    const again = await input.reparse(plan.argv).catch(() => null);
    if (!again || !isDeepStrictEqual(again.args, plan.expectedArgs) || !isDeepStrictEqual(again.opts, plan.expectedOpts)) {
      return await fail(NOT_PREPARED);
    }
    prepared = await prepareUploads(plan, input.parsedOpts);
  } catch (err) {
    if (err instanceof Refusal) return fail(err.message);
    throw err;
  }

  const start: ClientFrame = {
    t: 'start',
    version: runningVersion(),
    path: input.path,
    argv: plan.argv,
    inputs: plan.inputs.map((i) => ({ ref: i.ref, kind: i.kind, name: prepared.names.get(i.ref)!, keep: i.keep })),
    outputs: plan.outputs.map((o) => ({ ref: o.ref, kind: o.kind })),
  };
  return exchange(input, plan, start, prepared.sends, fail);
}

/** The upload stops: the message is printed and the exit code is 1. */
class ReadFailure extends Error {}

/**
 * Opens a pinned file again and checks it is the file the walk saw, where the walk saw it (Rulings
 * 68 and 70). O_NOFOLLOW refuses a last part swapped for a link, the inode check refuses another
 * file swapped in, the kernel's location refuses the same file reached through a folder swapped for
 * a link, and O_NONBLOCK keeps a FIFO swapped in from blocking the open.
 */
async function openPinned(s: Send): Promise<FileHandle> {
  const changed = () => new ReadFailure(`${s.typed} changed while it was being sent. Nothing more was sent.`);
  let fh: FileHandle;
  try {
    fh = await open(s.open, OPEN_FLAGS);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'ENOENT' || code === 'ENOTDIR' || code === 'EMLINK') throw changed();
    throw new ReadFailure(`Cannot read ${s.typed}.`);
  }
  try {
    const st = await fh.stat({ bigint: true });
    if (!st.isFile() || st.dev !== s.dev || st.ino !== s.ino) throw changed();
    // Where the kernel can say, the file must be where the walk found it (unproven without /proc).
    if (HAS_PROC_FD && (await locationOf(fh)) !== s.open) throw changed();
    return fh;
  } catch (err) {
    await fh.close().catch(() => {});
    throw err instanceof ReadFailure ? err : new ReadFailure(`Cannot read ${s.typed}.`);
  }
}

/**
 * The body: start, each file, go. Never an empty line, never an empty data frame. `reading.now` is
 * true while a file is being opened or read, so a forced stop can say it is waiting on one.
 */
async function* bodyOf(start: ClientFrame, sends: Send[], reading: { now: boolean }): AsyncGenerator<string> {
  yield encodeFrame(start);
  for (const s of sends) {
    reading.now = true;
    let fh: FileHandle;
    try {
      await uploadSeam.beforeOpen?.(s.typed);
      fh = await openPinned(s);
    } finally {
      // Cleared when the open fails too, so a later forced stop does not say a read is pending.
      reading.now = false;
    }
    try {
      yield encodeFrame({ t: 'file', ref: s.ref, rel: s.rel });
      const buf = Buffer.alloc(MAX_DATA_BYTES);
      for (;;) {
        reading.now = true;
        let bytesRead: number;
        try {
          ({ bytesRead } = await fh.read(buf, 0, buf.length, null));
        } catch {
          throw new ReadFailure(`Cannot read ${s.typed}.`);
        }
        reading.now = false;
        if (bytesRead === 0) break;
        yield encodeFrame({ t: 'data', d: buf.subarray(0, bytesRead).toString('base64') });
      }
      yield encodeFrame({ t: 'end' });
    } finally {
      reading.now = false;
      await fh.close().catch(() => {});
    }
  }
  yield encodeFrame({ t: 'go' });
}

async function exchange(
  input: ThroughAppInput, plan: Plan, start: ClientFrame, sends: Send[], fail: (m: string) => Promise<number>,
): Promise<number> {
  const { url, credential, out, err, signals } = input;
  const auth: Record<string, string> = credential.authorization ? { authorization: credential.authorization } : {};
  const req = sendRequest(endpoint(url, 'api/cli/run'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson', accept: 'application/x-ndjson', ...auth },
  });
  req.on('error', () => {}); // every error is read from the promises below
  const stopUpload = new AbortController();
  let res: IncomingMessage | null = null;
  let runId: string | null = null;
  let interrupts = 0;
  let forced: number | null = null;
  /** The interrupt request, held so it can be ended with the run. */
  let interruptReq: ClientRequest | null = null;
  let finished = false;

  const interrupt = (id: string) => {
    const couldNot = () => { if (!finished) void writeTo(err, 'The interrupt could not be sent to OpenLDR.\n'); };
    const r = sendRequest(endpoint(url, `api/cli/runs/${encodeURIComponent(id)}/interrupt`), { method: 'POST', headers: { ...auth } });
    interruptReq = r;
    r.setTimeout(INTERRUPT_TIMEOUT_MS, () => r.destroy(new Error('timed out')));
    r.on('response', (answer) => {
      answer.resume();
      if (answer.statusCode !== 204 && answer.statusCode !== 200) couldNot();
    });
    r.on('error', couldNot);
    r.end();
  };
  const onSigint = () => {
    interrupts += 1;
    // Before `run`, a closed connection is the interrupt. A second Ctrl+C ends the client.
    if (runId === null || interrupts > 1) {
      forced = 130;
      stopUpload.abort();
      req.destroy();
      res?.destroy();
      return;
    }
    interrupt(runId);
  };
  signals.on('SIGINT', onSigint);

  const answered = new Promise<IncomingMessage>((resolveAnswer, rejectAnswer) => {
    req.once('response', resolveAnswer);
    req.once('error', rejectAnswer);
    req.once('close', () => rejectAnswer(new Error('closed')));
  });
  answered.catch(() => {});

  const waitDrain = () => new Promise<void>((done) => {
    if (req.destroyed || stopUpload.signal.aborted) { done(); return; }
    const finish = () => {
      req.off('drain', finish);
      req.off('close', finish);
      stopUpload.signal.removeEventListener('abort', finish);
      done();
    };
    req.on('drain', finish);
    req.on('close', finish);
    stopUpload.signal.addEventListener('abort', finish);
  });
  const reading = { now: false };
  /** One line on a forced stop. A file read stuck in the kernel can hold the process, so say so. */
  const stopped = async (): Promise<number> => {
    await writeTo(err, reading.now ? 'Stopped. Waiting for a file read to finish.\n' : 'Stopped.\n');
    return 130;
  };
  /** Resolves with the message for a file that could not be sent, or null. */
  const upload = (async (): Promise<string | null> => {
    try {
      for await (const piece of bodyOf(start, sends, reading)) {
        if (stopUpload.signal.aborted || req.destroyed) return null;
        if (!req.write(piece)) await waitDrain();
      }
      // The server reads nothing after go.
      if (!stopUpload.signal.aborted && !req.destroyed) req.end();
      return null;
    } catch (e) {
      if (e instanceof ReadFailure) {
        // Nothing more is sent: the request ends here.
        req.destroy();
        return e.message;
      }
      return null;
    }
  })();

  try {
    try {
      res = await answered;
    } catch (e) {
      stopUpload.abort();
      // A forced end does not wait for the upload: a file read that hangs must not hold it.
      if (forced !== null) return await stopped();
      const unsent = await upload;
      if (forced !== null) return await stopped();
      if (unsent !== null) return await fail(unsent);
      return await fail(connectionMessage(url, (e as NodeJS.ErrnoException).code));
    }

    if (res.statusCode !== 200) {
      // A refusal can come while the upload is still going. Stop sending and read it.
      stopUpload.abort();
      const status = res.statusCode ?? 0;
      const body = status >= 300 && status < 400 ? null : await readRefusal(res);
      if (forced !== null) return await stopped();
      return await fail(refusalMessage(status, body, credential.kind, input.env ?? process.env));
    }
    return await readAnswer(res);
  } finally {
    finished = true;
    signals.off('SIGINT', onSigint);
    stopUpload.abort();
    req.destroy();
    res?.destroy();
    // A hanging interrupt request must not keep the process alive after the run.
    (interruptReq as ClientRequest | null)?.destroy();
  }

  async function readAnswer(answer: IncomingMessage): Promise<number> {
    const declared = new Map(plan.outputs.map((o) => [o.ref, o] as const));
    const pairs = [...plan.inputs, ...plan.outputs].map((p) => [`${PATH_PLACEHOLDER}${p.ref}`, p.typed] as const);
    const outMask = createUnmasker(pairs);
    const errMask = createUnmasker(pairs);
    const written = new Set<string>();
    let opened: Opened | null = null;
    let exit: number | null = null;
    /** OpenLDR stopped and interrupted the command, as opposed to the caller's own interrupt. */
    let serverStopped = false;
    let afterExit: NodeJS.Timeout | undefined;
    let sawError = false;
    let problem: string | null = null;

    const discard = async () => {
      const o = opened;
      opened = null;
      if (!o) return;
      await o.handle.close().catch(() => {});
      await unlink(o.temp).catch(() => {});
    };

    const openOutput = async (ref: unknown, rel: unknown): Promise<Opened> => {
      const target = typeof ref === 'string' ? declared.get(ref) : undefined;
      if (!target) throw new NotAskedError();
      if (typeof rel !== 'string') throw new ProtocolError();
      let path: string;
      let root: string | null = null;
      if (target.kind === 'output-file') {
        if (rel !== '') throw new NotAllowedError();
        path = resolve(target.typed);
      } else {
        const parts = rel.split('/');
        if (rel === '' || !parts.every(isPart)) throw new NotAllowedError();
        root = resolve(target.typed);
        path = join(root, ...parts);
        if (!path.startsWith(root + sep)) throw new NotAllowedError();
      }
      const key = `${target.ref}\0${rel}`;
      if (written.has(key)) throw new NotAllowedError();
      written.add(key);
      const shownPath = target.kind === 'output-file' ? target.typed : join(target.typed, rel);
      if (root === null) {
        // The caller named this file, and so its folder.
        try {
          await mkdir(dirname(path), { recursive: true });
        } catch {
          throw new LocalWriteError(shownPath);
        }
      } else {
        await makeInside(root, rel.split('/').slice(0, -1), shownPath);
        // A link inside the caller's folder must not lead the write somewhere else.
        const realRoot = await realpath(root).catch(() => null);
        const realParent = await realpath(dirname(path)).catch(() => null);
        if (!realRoot || !realParent || !within(realParent, realRoot)) throw new NotAllowedError();
      }
      const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.part`);
      try {
        return { handle: await open(temp, 'wx'), temp, target: path, shown: shownPath };
      } catch {
        throw new LocalWriteError(shownPath);
      }
    };

    try {
      let first = true;
      for await (const f of decodeFrames<ServerFrame>(answer)) {
        // Nothing comes after exit. A frame that does is not read, and the answer is closed.
        if (exit !== null) break;
        if (first) {
          if (f.t !== 'run' || typeof f.id !== 'string' || !RUN_ID.test(f.id)) throw new ProtocolError();
          runId = f.id;
          first = false;
          continue;
        }
        if (f.t === 'out') await writeTo(out, outMask.push(bytesOf(f.d)));
        else if (f.t === 'err') await writeTo(err, errMask.push(bytesOf(f.d)));
        else if (f.t === 'error') {
          // A failure on the server, perhaps part way through an output file: that file is dropped.
          sawError = true;
          await discard();
          await writeTo(err, errMask.flush());
          await writeTo(err, `OpenLDR: ${clean(typeof f.message === 'string' ? f.message : 'the command failed on the server.')}\n`);
        } else if (f.t === 'file') {
          if (opened) throw new ProtocolError();
          opened = await openOutput(f.ref, f.rel);
        } else if (f.t === 'data') {
          const o = opened as Opened | null;
          if (!o) throw new ProtocolError();
          const buf = bytesOf(f.d);
          try {
            for (let at = 0; at < buf.length;) at += (await o.handle.write(buf, at, buf.length - at)).bytesWritten;
          } catch {
            throw new LocalWriteError(o.shown);
          }
        } else if (f.t === 'end') {
          const o = opened as Opened | null;
          if (!o) throw new ProtocolError();
          try {
            await o.handle.close();
            await rename(o.temp, o.target);
          } catch {
            throw new LocalWriteError(o.shown);
          }
          opened = null;
        } else if (f.t === 'exit') {
          // An exit with a file still open: the file never ended, so the answer is not whole.
          if (opened) throw new ProtocolError();
          exit = Number.isInteger(f.code) && f.code >= 0 && f.code <= 255 ? f.code : 1;
          serverStopped = f.stopped === true;
          // Read on to the end of the answer rather than closing here. The server ends it once
          // its clean-up and audit row are done; closing first made every run end in the server
          // log as "stream closed prematurely". At most AFTER_EXIT_WAIT_MS, then it is closed.
          afterExit = setTimeout(() => answer.destroy(), AFTER_EXIT_WAIT_MS);
        } else {
          throw new ProtocolError();
        }
      }
    } catch (e) {
      if (e instanceof NotAllowedError) problem = 'OpenLDR sent a file name that is not allowed.';
      else if (e instanceof NotAskedError) problem = 'OpenLDR sent a file this command did not ask for.';
      else if (e instanceof LocalWriteError) problem = `Cannot write ${e.message}.`;
      else if (e instanceof ProtocolError || (e as Error | null)?.name === 'FrameError') problem = 'OpenLDR sent an answer this client cannot read.';
      // Anything else is the connection going; the checks below say so.
    } finally {
      clearTimeout(afterExit);
      await discard();
    }

    await writeTo(out, outMask.flush());
    await writeTo(err, errMask.flush());
    if (forced !== null) return stopped();
    if (problem !== null) return fail(problem);
    if (exit === null) {
      if (sawError) return 1;
      return fail('The connection to OpenLDR was lost.');
    }
    if (serverStopped) await writeTo(err, 'OpenLDR stopped while this command was running.\n');
    // An output that failed on the server leaves the caller without a file it asked for.
    return sawError ? 1 : exit;
  }
}
