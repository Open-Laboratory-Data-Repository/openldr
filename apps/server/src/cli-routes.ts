// POST /api/cli/run runs one openldr CLI command for a signed-in caller, in a process the server
// starts (cli-runner.ts). That process holds the server's database settings, so every check here
// runs before anything is made or started, and every doubt is a refusal.
//
// Order: read `start`; check the version, the command and the capability; make the request folder;
// write the uploads; put the real paths in argv; wait for a free slot; start the process; send
// `run`; stream its output; send the output files; send `exit`; remove the folder; record one audit
// row. A refusal before `run` is a plain HTTP answer with a JSON body. An `error` frame is only for
// a failure after `run`.
//
// Nothing the caller sent is logged or audited, except the command path. Arguments and files can
// hold secrets (`settings sync set clientSecret <value>`).

import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuditStore } from '@openldr/audit';
import { recordAuditEvent, type AuditActor } from '@openldr/bootstrap';
import type { Logger } from '@openldr/core';
import { COMMAND_META, type CommandMeta, type PathKind } from '@openldr/cli/meta';
import {
  decodeFrames, encodeFrame, FrameError, MAX_DATA_BYTES, PATH_PLACEHOLDER, REF_PATTERN,
  type ClientFrame, type ServedHandoff, type ServerFrame,
} from '@openldr/cli/wire';
import { actorFromRequest } from './audit-helper';
import type { RequestActor } from './auth-plugin';
import {
  BusyError, ClosingError, createCliRunner, KILL_AFTER_MS, resolveCliEntry, type CliRunner, type RunHandle, type Slot,
} from './cli-runner';
import { holdsCapability } from './rbac';
import { readAppVersion } from './version';

/** The most files and folders one request may upload. */
export const MAX_FILES = 100_000;
/** After a refusal, the most of the rest of the body that is read and thrown away, decoded, and
 *  for how long. Then the request is ended. A client that reads the answer as it comes stops first. */
export const REFUSAL_DRAIN_BYTES = 16 * 1024 * 1024;
export const REFUSAL_DRAIN_MS = 5_000;
/** A caller that reads nothing for this long, while output waits for it, is treated as gone. */
export const STALL_MS = 5 * 60_000;
/** After the process has gone, how long its output pipes may stay open (a grandchild can hold them). */
export const PIPE_WAIT_MS = 3_000;
/** The child refuses a larger hand-off, so the server does not send one. */
const MAX_HANDOFF_BYTES = 1024 * 1024;
/** The longest base64 text of one `data` frame. */
const MAX_DATA_TEXT = Math.ceil(MAX_DATA_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0; // undefined on Windows (unproven there)

export interface CliRouteContext {
  cfg: {
    TERMINOLOGY_WORK_DIR?: string;
    CLI_ENTRY?: string;
    CLI_MAX_RUNNING?: number;
    CLI_MAX_UPLOAD_BYTES?: number;
  };
  audit: AuditStore;
  logger: Logger;
}

export interface CliRouteOptions {
  runner?: CliRunner;
  /** The CLI entry file, looked up on each run. Null answers 503. */
  entry?: () => string | null;
  /** The release this server is. Defaults to readAppVersion(). */
  version?: string;
  maxFiles?: number;
}

/** A refusal before `run`. The message is safe to show the caller and holds nothing they sent,
 *  except where a ruling says so (the client's version). */
class Refusal extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'Refusal';
  }
}

type Start = Extract<ClientFrame, { t: 'start' }>;
type InputKind = Start['inputs'][number]['kind'];
type OutputKind = Start['outputs'][number]['kind'];

interface Placed {
  ref: string;
  kind: InputKind | OutputKind;
  /** The plain name the client sent, for an input. */
  name: string;
  /** The server-made folder that holds it. */
  base: string;
  /** The real path that replaces the placeholder. */
  path: string;
  /** The companion files written beside an input-file's main file. */
  companions: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRef = (v: unknown): v is string => typeof v === 'string' && REF_PATTERN.test(v);

/** One part of a name: not empty, not `.` or `..`, and no `/`, `\`, control character or DEL.
 *  `ingest` records the base name, so a newline in it would reach a stored row. */
function isPart(v: string): boolean {
  return v !== '' && v !== '.' && v !== '..' && !/[/\\\x00-\x1f\x7f]/.test(v);
}

/**
 * Checks the declared inputs and outputs against the command's path marks: no more of them than it
 * has marks, only kinds a mark can have, and a kept upload only where a mark keeps one. A mark
 * whose kind is a function (it depends on the other arguments) accepts a file or a folder, either
 * way: the server does not parse the arguments to know which.
 */
function checkPaths(start: Start, meta: CommandMeta): void {
  const marks = meta.paths ?? [];
  if (start.inputs.length + start.outputs.length > marks.length) {
    throw new Refusal(400, `This command takes at most ${marks.length} files or folders.`);
  }
  const kinds = new Set<PathKind>();
  for (const mark of marks) {
    if (typeof mark.kind === 'function') for (const k of ['input-file', 'input-dir', 'output-file', 'output-dir'] as const) kinds.add(k);
    else kinds.add(mark.kind);
  }
  for (const p of [...start.inputs, ...start.outputs]) {
    if (!kinds.has(p.kind)) throw new Refusal(400, `This command takes no ${p.kind}.`);
  }
  if (start.inputs.some((i) => i.keep) && !marks.some((m) => m.keep)) {
    throw new Refusal(400, 'This command keeps no upload.');
  }
}

/**
 * Makes sure a folder under the work folder is one this server alone controls: a real folder, not a
 * link, owned by this user, with no write bit for group or others. Made with mode 0700 when missing.
 * On a shared machine another user could make /tmp/cli-runs first. Returns why it cannot be used,
 * or null. The owner and mode checks are skipped on Windows, where they mean nothing (unproven).
 */
async function privateFolderProblem(path: string): Promise<string | null> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return `cannot be made (${(err as NodeJS.ErrnoException).code ?? 'error'})`;
  }
  const st = await lstat(path).catch(() => null);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return 'is not a real folder';
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return 'is owned by another user';
    if ((st.mode & 0o022) !== 0) return 'can be written by other users';
  }
  return null;
}

/** Checks `start` field by field. The messages name the field, never its value. */
function readStart(f: Record<string, unknown> | null): Start {
  const bad = (field: string): never => { throw new Refusal(400, `The start frame is not valid: ${field}.`); };
  if (!f || f.t !== 'start') throw new Refusal(400, 'The request must begin with a start frame.');
  if (typeof f.version !== 'string' || f.version === '' || f.version.length > 64 || !/^[\x21-\x7e]+$/.test(f.version)) bad('version');
  if (typeof f.path !== 'string') bad('path');
  if (!Array.isArray(f.argv) || !f.argv.every((a) => typeof a === 'string')) bad('argv');
  if (!Array.isArray(f.inputs) || !Array.isArray(f.outputs)) bad('inputs');
  const refs = new Set<string>();
  const inputs = (f.inputs as unknown[]).map((i) => {
    if (!isObject(i) || !isRef(i.ref)) return bad('inputs.ref');
    if (i.kind !== 'input-file' && i.kind !== 'input-dir') return bad('inputs.kind');
    if (typeof i.name !== 'string' || !isPart(i.name)) return bad('inputs.name');
    if (typeof i.keep !== 'boolean') return bad('inputs.keep');
    if (refs.has(i.ref)) return bad('inputs.ref');
    refs.add(i.ref);
    return { ref: i.ref, kind: i.kind, name: i.name, keep: i.keep } as Start['inputs'][number];
  });
  const outputs = (f.outputs as unknown[]).map((o) => {
    if (!isObject(o) || !isRef(o.ref)) return bad('outputs.ref');
    if (o.kind !== 'output-file' && o.kind !== 'output-dir') return bad('outputs.kind');
    if (refs.has(o.ref)) return bad('outputs.ref');
    refs.add(o.ref);
    return { ref: o.ref, kind: o.kind } as Start['outputs'][number];
  });
  return { t: 'start', version: f.version as string, path: f.path as string, argv: [...(f.argv as string[])], inputs, outputs };
}

/** The real path for a placeholder token, alone or after `--flag=`. Anything else is passed as it is. */
function substitute(token: string, real: ReadonlyMap<string, string>): string {
  if (token.startsWith(PATH_PLACEHOLDER)) {
    const path = real.get(token.slice(PATH_PLACEHOLDER.length));
    if (path !== undefined) return path;
  }
  const m = /^(--[^=]+)=@@(.*)$/s.exec(token);
  if (m) {
    const path = real.get(m[2]!);
    if (path !== undefined) return `${m[1]}=${path}`;
  }
  return token;
}

/** Where a `file` frame's bytes go. Throws a 400 for any rel that could leave the input's folder. */
function targetOf(input: Placed, rel: string): string {
  const outside = () => new Refusal(400, 'A file name is not allowed.');
  if (input.kind === 'input-file') {
    if (rel === '') return input.path;
    // A companion: one plain file name beside the main file.
    if (!isPart(rel) || rel === input.name) throw outside();
    return join(input.base, rel);
  }
  const parts = rel.split('/');
  if (rel === '' || !parts.every(isPart)) throw outside();
  const target = join(input.path, ...parts);
  if (!target.startsWith(input.path + sep)) throw outside();
  return target;
}

/** A file-system error during the upload, as a refusal that names no path. */
function uploadFailed(err: unknown, logger: Logger): Refusal {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  logger.warn({ code }, 'cli upload could not be written');
  if (code === 'ENOSPC' || code === 'EDQUOT' || code === 'EIO') return new Refusal(500, 'An upload could not be written.');
  return new Refusal(400, 'A file could not be written. Check the names.');
}

/**
 * Turns real paths back into their placeholders in a byte stream, so the caller never sees a path on
 * the server. A path can be cut across two chunks, so the tail of a chunk that could start one is
 * held back for the next. Where two paths match at the same place, the longest wins.
 */
export function createPathMasker(pairs: ReadonlyArray<readonly [real: string, placeholder: string]>) {
  const list = pairs
    .map(([real, ph]) => ({ real: Buffer.from(real), ph: Buffer.from(ph) }))
    .filter((p) => p.real.length > 0)
    .sort((a, b) => b.real.length - a.real.length);
  const maxLen = list.reduce((m, p) => Math.max(m, p.real.length), 0);
  let held = Buffer.alloc(0);
  const startsPath = (tail: Buffer, longerThan: number) =>
    list.some((p) => p.real.length > longerThan && p.real.subarray(0, tail.length).equals(tail));

  const run = (buf: Buffer, final: boolean): Buffer => {
    const out: Buffer[] = [];
    let i = 0;
    for (;;) {
      let at = -1;
      let match: (typeof list)[number] | undefined;
      for (const p of list) {
        const found = buf.indexOf(p.real, i);
        if (found >= 0 && (at < 0 || found < at)) { at = found; match = p; }
      }
      if (!match) break;
      // A longer path may still match here once more bytes come.
      if (!final && at + maxLen > buf.length && startsPath(buf.subarray(at), match.real.length)) {
        out.push(buf.subarray(i, at));
        held = Buffer.from(buf.subarray(at));
        return Buffer.concat(out);
      }
      out.push(buf.subarray(i, at), match.ph);
      i = at + match.real.length;
    }
    let keep = buf.length;
    if (!final) {
      for (let q = Math.max(i, buf.length - maxLen + 1); q < buf.length; q += 1) {
        const tail = buf.subarray(q);
        if (startsPath(tail, tail.length)) { keep = q; break; }
      }
    }
    out.push(buf.subarray(i, keep));
    held = Buffer.from(buf.subarray(keep));
    return Buffer.concat(out);
  };

  return {
    push: (chunk: Buffer): Buffer => run(held.length > 0 ? Buffer.concat([held, chunk]) : chunk, false),
    flush: (): Buffer => {
      const rest = held;
      held = Buffer.alloc(0);
      return rest.length > 0 ? run(rest, true) : rest;
    },
  };
}

export function registerCliRoutes(app: FastifyInstance<any, any, any, any>, ctx: CliRouteContext, opts: CliRouteOptions = {}): CliRunner {
  const cfg = ctx.cfg;
  const runner = opts.runner ?? createCliRunner({ maxRunning: cfg.CLI_MAX_RUNNING ?? 2, settings: cfg as Readonly<Record<string, unknown>> });
  const entryOf = opts.entry ?? (() => resolveCliEntry(cfg.CLI_ENTRY));
  const version = opts.version ?? readAppVersion();
  const maxUpload = cfg.CLI_MAX_UPLOAD_BYTES ?? 2_147_483_648;
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const workDir = resolve(cfg.TERMINOLOGY_WORK_DIR || tmpdir());
  const runsRoot = join(workDir, 'cli-runs');
  const keptRoot = join(workDir, 'cli-kept');

  /** Removes a request or kept folder. A failure is logged with its code and the folder's own
   *  name (a random id), never what was in it. */
  const removeFolder = async (dir: string): Promise<void> => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      ctx.logger.warn({ code: (err as NodeJS.ErrnoException | null)?.code, folder: basename(dir) }, 'cli folder could not be removed');
    }
  };

  // Stop running commands before the server stops taking requests, so each caller gets its exit
  // frame and each audit row is written before the context closes (start.ts closes the app first).
  app.addHook('preClose', async () => { await runner.close(); });

  const run = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user;
    if (!user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    const payload = req.body;
    if (!(payload instanceof Readable)) {
      reply.code(400);
      return reply.send({ error: 'Send the command as application/x-ndjson.' });
    }

    // One reader of the body for the whole request. Its return() does not end the body, so after a
    // refusal the rest can still be read and thrown away, and the caller can read the answer.
    const chunks = payload[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    const shared: AsyncIterable<Buffer> = {
      [Symbol.asyncIterator]: () => ({ next: () => chunks.next(), return: async () => ({ done: true as const, value: undefined }) }),
    };
    const frames = decodeFrames<Record<string, unknown>>(shared)[Symbol.asyncIterator]();
    /**
     * After a refusal: reads what is left of the body and throws it away, so a caller part way
     * through its upload can read the answer. At most REFUSAL_DRAIN_BYTES decoded, for at most
     * REFUSAL_DRAIN_MS. Then the request is ended, once the answer has been written.
     */
    const drain = async (): Promise<void> => {
      let seen = 0;
      let ended = false;
      const letGo = () => {
        if (ended) return;
        ended = true;
        const destroy = () => { payload.destroy(); req.raw.destroy(); };
        if (reply.raw.writableFinished || reply.raw.destroyed) destroy();
        else { reply.raw.once('finish', destroy); reply.raw.once('close', destroy); }
      };
      const timer = setTimeout(letGo, REFUSAL_DRAIN_MS);
      try {
        while (!ended) {
          const r = await chunks.next();
          if (r.done) return;
          seen += r.value.length;
          if (seen > REFUSAL_DRAIN_BYTES) letGo();
        }
      } catch { /* the caller left */ } finally {
        clearTimeout(timer);
      }
    };
    const nextFrame = async (): Promise<Record<string, unknown> | null> => {
      try {
        const r = await frames.next();
        return r.done ? null : r.value;
      } catch (err) {
        if (err instanceof FrameError) throw new Refusal(400, err.message);
        throw new Refusal(400, 'The request could not be read.');
      }
    };

    // The caller's connection. Closing it before the end interrupts the command.
    const left = new AbortController();
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) left.abort(); });

    let runDir: string | null = null;
    const keptMade: string[] = [];
    let openFile: FileHandle | null = null;
    let handedOver = false;
    let slot: Slot | null = null;
    /** Removes what this request made. Safe to call twice. */
    const cleanUp = async () => {
      const file = openFile;
      const dirs = [runDir, ...keptMade];
      openFile = null;
      runDir = null;
      keptMade.length = 0;
      if (file) await file.close().catch(() => {});
      for (const dir of dirs) if (dir) await removeFolder(dir);
    };

    try {
      const start = readStart(await nextFrame());
      if (start.version !== version) {
        throw new Refusal(409, `This client is version ${start.version} and OpenLDR is version ${version}. Use the same release on both.`);
      }
      const meta = Object.hasOwn(COMMAND_META, start.path) ? COMMAND_META[start.path] : undefined;
      if (!meta) throw new Refusal(400, 'Unknown command.');
      if (meta.kind !== 'app' || !meta.capability) throw new Refusal(400, `${start.path} does not run through the app.`);
      const missing = [meta.capability, ...(meta.alsoRequires ?? [])].find((key) => !holdsCapability(user, key));
      if (missing) throw new Refusal(403, 'insufficient capability', { capability: missing });
      checkPaths(start, meta);
      const entry = entryOf();
      if (!entry) throw new Refusal(503, 'The CLI entry file cannot be found. Set CLI_ENTRY to its path.');
      if (runner.closing) throw new Refusal(503, 'The server is stopping.');

      // The folders this request uses must be the server's own, before anything goes in them.
      try {
        await mkdir(workDir, { recursive: true, mode: 0o700 });
      } catch (err) {
        throw uploadFailed(err, ctx.logger);
      }
      for (const root of start.inputs.some((i) => i.keep) ? [runsRoot, keptRoot] : [runsRoot]) {
        const problem = await privateFolderProblem(root);
        if (problem) {
          ctx.logger.error({ folder: root, problem }, 'cli work folder refused');
          throw new Refusal(503, `The folder ${root} ${problem}, so no command can run. Remove it or fix it.`);
        }
      }

      // The request folder and one server-made folder for each input and output.
      const id = randomBytes(32).toString('base64url');
      const placed = new Map<string, Placed>();
      try {
        runDir = join(runsRoot, id);
        await mkdir(runDir, { mode: 0o700 });
        for (const input of start.inputs) {
          const base = join(input.keep ? keptRoot : runDir, randomBytes(12).toString('hex'));
          await mkdir(base, { mode: 0o700 });
          if (input.keep) keptMade.push(base);
          const path = join(base, input.name);
          if (input.kind === 'input-dir') await mkdir(path, { mode: 0o700 });
          placed.set(input.ref, { ref: input.ref, kind: input.kind, name: input.name, base, path, companions: [] });
        }
        for (const output of start.outputs) {
          const base = join(runDir, randomBytes(12).toString('hex'));
          await mkdir(base, { mode: 0o700 });
          placed.set(output.ref, { ref: output.ref, kind: output.kind, name: '', base, path: join(base, 'output'), companions: [] });
        }
      } catch (err) {
        throw uploadFailed(err, ctx.logger);
      }

      // The uploads, until `go`. Files and the folders made on the way to them both count.
      let bytes = 0;
      let entries = 0;
      const countEntry = () => {
        entries += 1;
        if (entries > maxFiles) throw new Refusal(413, `The upload has more than the limit of ${maxFiles} files.`);
      };
      const madeDirs = new Set<string>();
      const sent = new Set<string>();
      for (;;) {
        const f = await nextFrame();
        if (!f) throw new Refusal(400, 'The request ended before go.');
        if (f.t === 'file') {
          if (openFile) throw new Refusal(400, 'A file is already open.');
          const input = typeof f.ref === 'string' ? placed.get(f.ref) : undefined;
          if (!input || input.kind.startsWith('output')) throw new Refusal(400, 'A file names an unknown input.');
          if (typeof f.rel !== 'string') throw new Refusal(400, 'A file name is not allowed.');
          const target = targetOf(input, f.rel);
          const key = `${input.ref}\0${f.rel}`;
          if (sent.has(key)) throw new Refusal(400, 'The same file was sent twice.');
          sent.add(key);
          if (input.kind === 'input-dir') {
            const parts = f.rel.split('/');
            for (let n = 1; n < parts.length; n += 1) {
              const dir = parts.slice(0, n).join('/');
              if (!madeDirs.has(dir)) { madeDirs.add(dir); countEntry(); }
            }
          }
          countEntry();
          try {
            if (input.kind === 'input-dir') await mkdir(dirname(target), { recursive: true, mode: 0o700 });
            openFile = await open(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | O_NOFOLLOW, 0o600);
          } catch (err) {
            throw uploadFailed(err, ctx.logger);
          }
          if (input.kind === 'input-file' && f.rel !== '') input.companions.push(f.rel);
        } else if (f.t === 'data') {
          if (!openFile) throw new Refusal(400, 'Data came with no open file.');
          const d = f.d;
          // An empty file is `file` then `end`. An empty data frame would let a caller send frames
          // for ever without counting a byte.
          if (typeof d !== 'string' || d === '' || d.length > MAX_DATA_TEXT || d.length % 4 !== 0 || !BASE64.test(d)) {
            throw new Refusal(400, 'A data frame is not valid base64 of at most 64 KiB.');
          }
          const buf = Buffer.from(d, 'base64');
          if (buf.length > MAX_DATA_BYTES) throw new Refusal(400, 'A data frame is not valid base64 of at most 64 KiB.');
          bytes += buf.length;
          if (bytes > maxUpload) throw new Refusal(413, `The upload is larger than the limit of ${maxUpload} bytes.`);
          try {
            for (let at = 0; at < buf.length;) at += (await openFile.write(buf, at, buf.length - at)).bytesWritten;
          } catch (err) {
            throw uploadFailed(err, ctx.logger);
          }
        } else if (f.t === 'end') {
          if (!openFile) throw new Refusal(400, 'An end came with no open file.');
          const done = openFile;
          openFile = null;
          await done.close();
        } else if (f.t === 'go') {
          if (openFile) throw new Refusal(400, 'Go came with a file still open.');
          break;
        } else {
          throw new Refusal(400, 'A frame came out of order.');
        }
      }

      const real = new Map([...placed.values()].map((p) => [p.ref, p.path] as const));
      const handoff: ServedHandoff = {
        path: start.path,
        argv: start.argv.map((token) => substitute(token, real)),
        caller: { id: user.id, username: user.username, displayName: user.displayName || null, keyName: user.accessKey?.name || null },
        runDir,
        keptDirs: [...keptMade],
      };
      if (Buffer.byteLength(JSON.stringify(handoff)) > MAX_HANDOFF_BYTES) {
        throw new Refusal(400, 'The command is too long to hand over.');
      }

      try {
        slot = await runner.acquire(left.signal);
      } catch (err) {
        if (err instanceof BusyError) throw new Refusal(503, 'busy');
        if (err instanceof ClosingError) throw new Refusal(503, 'The server is stopping.');
        throw new Refusal(503, 'The caller left.');
      }
      if (left.signal.aborted) throw new Refusal(503, 'The caller left.');
      let handle: RunHandle;
      try {
        handle = runner.start(slot, { id, entry, ownerId: user.id, handoff });
      } catch (err) {
        if (err instanceof ClosingError) throw new Refusal(503, 'The server is stopping.');
        ctx.logger.error({ code: (err as NodeJS.ErrnoException | null)?.code }, 'cli command could not be started');
        throw new Refusal(500, 'The command could not be started.');
      }

      // From here the answer is a stream, and streamRun owns the folder and the slot. Nothing more
      // is read from the body: what follows `go` stays unread.
      handedOver = true;
      const out = new PassThrough({ highWaterMark: 64 * 1024 });
      void streamRun({ req, reply, user, start, placed, runDir, slot, handle, out, left: left.signal, drain });
      reply.header('content-type', 'application/x-ndjson; charset=utf-8');
      reply.header('cache-control', 'no-store');
      return reply.send(out);
    } catch (err) {
      // Only the error's name: its message could quote a path, and so a file name.
      if (!(err instanceof Refusal)) ctx.logger.error({ name: (err as Error | null)?.name }, 'cli run could not be prepared');
      const r = err instanceof Refusal ? err : new Refusal(500, 'The command could not be prepared.');
      slot?.release();
      slot = null;
      await cleanUp();
      // Let a caller that is still uploading read the answer, within the drain's bounds.
      void drain();
      if (runner.closing) reply.header('connection', 'close');
      reply.code(r.status);
      return reply.send({ error: r.message, ...r.extra });
    } finally {
      if (!handedOver) {
        slot?.release();
        await cleanUp();
      }
    }
  };

  /** Streams one started command to its caller, then cleans up and records it. */
  async function streamRun(s: {
    req: FastifyRequest; reply: FastifyReply; user: RequestActor; start: Start; placed: Map<string, Placed>;
    runDir: string; slot: Slot; handle: RunHandle; out: PassThrough; left: AbortSignal;
    /** The bounded discard of what is left of the body, then the end of the request. */
    drain: () => Promise<void>;
  }): Promise<void> {
    const { out, handle } = s;
    out.on('error', () => {});
    const stop = new AbortController();
    let exitCode = 1;
    let abandonTimer: NodeJS.Timeout | undefined;

    const callerLeft = () => { handle.interrupt(); stop.abort(); };
    if (s.left.aborted) callerLeft();
    else s.left.addEventListener('abort', callerLeft, { once: true });
    // On shutdown the command is interrupted by the runner. A caller that stops reading must not
    // hold the shutdown: after twice the kill wait, stop writing to it.
    const onClosing = () => {
      abandonTimer = setTimeout(() => { stop.abort(); out.destroy(); s.reply.raw.destroy(); }, 2 * KILL_AFTER_MS);
    };
    if (runner.closingSignal.aborted) onClosing();
    else runner.closingSignal.addEventListener('abort', onClosing, { once: true });

    /** The caller read nothing for STALL_MS: it is treated as gone, and the interrupt, then the
     *  kill, frees its slot. */
    const stalled = () => { callerLeft(); out.destroy(); s.reply.raw.destroy(); };

    /** Writes one frame, waiting while the caller is slow. Does nothing once the caller has gone. */
    const send = async (f: ServerFrame): Promise<void> => {
      if (stop.signal.aborted || out.destroyed || out.writableEnded) return;
      if (out.write(encodeFrame(f))) return;
      await new Promise<void>((resolveWait) => {
        const done = () => {
          clearTimeout(stallTimer);
          out.off('drain', done);
          out.off('close', done);
          stop.signal.removeEventListener('abort', done);
          resolveWait();
        };
        const stallTimer = setTimeout(() => { stalled(); done(); }, STALL_MS);
        out.on('drain', done);
        out.on('close', done);
        stop.signal.addEventListener('abort', done);
      });
    };
    const sendBytes = async (t: 'out' | 'err' | 'data', buf: Buffer): Promise<void> => {
      for (let i = 0; i < buf.length; i += MAX_DATA_BYTES) await send({ t, d: buf.subarray(i, i + MAX_DATA_BYTES).toString('base64') });
    };
    // Each real path becomes its placeholder. A companion's folder is named by no placeholder, so
    // its full path becomes its bare file name.
    const pairs = [...s.placed.values()].flatMap((p) => [
      [p.path, `${PATH_PLACEHOLDER}${p.ref}`] as const,
      ...p.companions.map((c) => [join(p.base, c), c] as const),
    ]);
    const pump = async (stream: NodeJS.ReadableStream, t: 'out' | 'err'): Promise<void> => {
      const masker = createPathMasker(pairs);
      try {
        for await (const chunk of stream) await sendBytes(t, masker.push(chunk as Buffer));
      } catch { /* the pipe broke; the exit code says the rest */ }
      await sendBytes(t, masker.flush());
    };

    const sendFile = async (ref: string, rel: string, path: string): Promise<void> => {
      let fh: FileHandle;
      try {
        fh = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
      } catch {
        return;
      }
      try {
        if (!(await fh.stat()).isFile()) return;
        await send({ t: 'file', ref, rel });
        const buf = Buffer.alloc(MAX_DATA_BYTES);
        for (;;) {
          const { bytesRead } = await fh.read(buf, 0, buf.length, null);
          if (bytesRead === 0) break;
          await send({ t: 'data', d: buf.subarray(0, bytesRead).toString('base64') });
        }
        await send({ t: 'end' });
      } finally {
        await fh.close().catch(() => {});
      }
    };
    /** Regular files only, found with lstat. A link is never followed: it could point outside. */
    const sendDir = async (ref: string, dir: string, prefix: string): Promise<void> => {
      const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
        if (e.isFile()) await sendFile(ref, rel, join(dir, e.name));
        else if (e.isDirectory()) await sendDir(ref, join(dir, e.name), rel);
      }
    };
    const sendOutputs = async (): Promise<void> => {
      for (const p of s.placed.values()) {
        if (p.kind !== 'output-file' && p.kind !== 'output-dir') continue;
        // The server-made folder must still be a real folder, not a link the command left.
        const base = await lstat(p.base).catch(() => null);
        if (!base?.isDirectory()) continue;
        const st = await lstat(p.path).catch(() => null);
        if (!st) continue; // the command did not make it: not an error
        if (p.kind === 'output-file' && st.isFile()) await sendFile(p.ref, '', p.path);
        if (p.kind === 'output-dir' && st.isDirectory()) await sendDir(p.ref, p.path, '');
      }
    };

    try {
      await send({ t: 'run', id: handle.id });
      const pumps = Promise.all([pump(handle.stdout, 'out'), pump(handle.stderr, 'err')]);
      exitCode = await handle.exited;
      // A grandchild can hold the pipes open after the process has gone. Wait a little, then stop
      // reading them.
      let pipeTimer: NodeJS.Timeout | undefined;
      const late = await Promise.race([
        pumps.then(() => false),
        new Promise<boolean>((done) => { pipeTimer = setTimeout(() => done(true), PIPE_WAIT_MS); }),
      ]);
      clearTimeout(pipeTimer);
      if (late) {
        handle.stdout.destroy();
        handle.stderr.destroy();
      }
      await pumps;
      try {
        await sendOutputs();
      } catch (err) {
        ctx.logger.warn({ code: (err as NodeJS.ErrnoException | null)?.code }, 'cli output could not be sent');
        await send({ t: 'error', message: 'An output could not be sent.' });
      }
      await send({ t: 'exit', code: exitCode });
    } catch (err) {
      // The command may still be running: stop it before waiting for it below.
      handle.interrupt();
      ctx.logger.error({ name: (err as Error | null)?.name }, 'cli run failed while streaming');
      await send({ t: 'error', message: 'The command failed on the server.' }).catch(() => {});
    } finally {
      // The folder goes only after the process has gone, and before the answer ends, so a caller
      // that has the whole answer finds nothing left behind.
      exitCode = await handle.exited;
      s.left.removeEventListener('abort', callerLeft);
      await removeFolder(s.runDir);
      ctx.logger.info({ command: s.start.path, accountId: s.user.id, exitCode, interrupted: handle.interrupted }, 'cli command finished');
      const base = actorFromRequest(s.req);
      const actor: AuditActor = {
        actorType: base.actorType,
        actorId: base.actorId,
        actorName: base.actorName,
        origin: s.user.accessKey ? { via: 'cli', keyName: s.user.accessKey.name } : { via: 'cli' },
      };
      await recordAuditEvent(ctx, actor, {
        action: 'cli.run', entityType: 'cli_command', entityId: s.start.path,
        metadata: { exitCode, interrupted: handle.interrupted },
      });
      if (!out.destroyed) out.end();
      // The slot is held until the answer is written, so shutdown waits for it. The abandon timer
      // still runs, so a caller that stopped reading cannot hold it for ever.
      const res = s.reply.raw;
      if (!res.writableFinished && !res.destroyed) {
        await new Promise<void>((done) => { res.once('finish', done); res.once('close', done); });
      }
      clearTimeout(abandonTimer);
      runner.closingSignal.removeEventListener('abort', onClosing);
      // A connection kept open after the answer would hold the server's close until the caller
      // drops it.
      if (runner.closing) s.req.raw.socket?.end();
      // Bytes sent after `go` were never read, so the socket is paused and would never see the
      // caller close it. Now that the answer is written, the same bounded discard as a refusal.
      if (!s.req.raw.complete) void s.drain();
      s.slot.release();
    }
  }

  void app.register(async (scope) => {
    // The body reaches the route as the raw stream. Only this scope has the parser, so every other
    // route keeps its own parsers and limits.
    scope.addContentTypeParser('application/x-ndjson', (_req, payload, done) => { done(null, payload); });
    scope.post('/api/cli/run', { compress: false }, run);
    scope.post('/api/cli/runs/:id/interrupt', async (req, reply) => {
      if (!req.user) {
        reply.code(401);
        return reply.send({ error: 'authentication required' });
      }
      const { id } = req.params as { id: string };
      const found = runner.find(id, req.user.id);
      if (!found) {
        reply.code(404);
        return reply.send({ error: 'not found' });
      }
      found.interrupt();
      reply.code(204);
      return reply.send();
    });
  });

  return runner;
}
