// Layer under test: POST /api/cli/run and the interrupt route (cli-routes.ts), in a real Fastify
// listening on 127.0.0.1 port 0, with the same compress set-up as buildApp, and the real runner
// starting the fake CLI in __fixtures__ (never the real one). Most tests take the signed-in account
// from a test header; the "behind the real auth plugin" tests use the real buildApp and its sign-in
// hook over pg-mem. The audit store and logger in the header tests are fakes that record what they
// are given. Linux only: Windows and macOS are unproven.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as realSleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { gzipSync } from 'node:zlib';
import compress from '@fastify/compress';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditEventInput, AuditStore } from '@openldr/audit';
import { encodeFrame, type ClientFrame, type ServerFrame } from '@openldr/cli/wire';
import { keyFixture } from './access-key.test-support';
import { buildApp } from './app';
import type { RequestActor } from './auth-plugin';
import { ctxWith } from './test-helpers';
import { createCliRunner, KILL_AFTER_MS, SLOT_WAIT_MS } from './cli-runner';
import { createPathMasker, PIPE_WAIT_MS, REFUSAL_DRAIN_MS, registerCliRoutes, STALL_MS } from './cli-routes';
import { readAppVersion } from './version';

const FAKE = fileURLToPath(new URL('./__fixtures__/fake-cli.mjs', import.meta.url));
const VERSION = '7.7.7';
const MiB = 1024 * 1024;

const USERS: Record<string, RequestActor> = {
  admin: {
    id: 'u-admin', username: 'admin', displayName: 'Admin', roles: [],
    capabilities: ['audit.view', 'data.export', 'connectors.manage', 'ingest.run', 'marketplace.manage', 'terminology.manage', 'query.run'],
  },
  keyed: { id: 'u-bot', username: 'bot', displayName: null, roles: [], capabilities: ['audit.view', 'connectors.manage'], accessKey: { id: 'k1', name: 'backup job' } },
  viewer: { id: 'u-viewer', username: 'viewer', displayName: null, roles: [], capabilities: [] },
  conn: { id: 'u-conn', username: 'conn', displayName: null, roles: [], capabilities: ['connectors.manage'] },
  ingest: { id: 'u-ingest', username: 'ingest', displayName: null, roles: [], capabilities: ['ingest.run'] },
  other: { id: 'u-other', username: 'other', displayName: null, roles: [], capabilities: ['audit.view'] },
};

/** Polls on real time, which the fake timers do not touch. */
async function until(check: () => boolean, what = 'condition'): Promise<void> {
  for (let i = 0; i < 1000 && !check(); i += 1) await realSleep(10);
  if (!check()) throw new Error(`timed out waiting for ${what}`);
}

function fakeLogger(lines: string[]) {
  const make = (bindings: unknown): Record<string, unknown> => {
    const at = (level: string) => (...args: unknown[]) => { lines.push(inspect({ level, bindings, args }, { depth: 6, breakLength: Infinity })); };
    return {
      level: 'info',
      info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal'),
      silent: () => {},
      child: (b: unknown) => make(b),
    };
  };
  return make({});
}

interface Harness {
  app: FastifyInstance;
  url: string;
  work: string;
  audit: AuditEventInput[];
  logs: string[];
  started(): number;
}

const open: Harness[] = [];
const scratch: string[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const h of open.splice(0)) {
    await h.app.close();
    rmSync(h.work, { recursive: true, force: true });
  }
  for (const c of closers.splice(0)) await c();
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratchDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'cli-routes-x-'));
  scratch.push(d);
  return d;
}

async function harness(o: { entry?: string | null; maxUploadBytes?: number; maxRunning?: number; maxFiles?: number; work?: string } = {}): Promise<Harness> {
  const work = o.work ?? mkdtempSync(join(tmpdir(), 'cli-routes-'));
  const logs: string[] = [];
  const logger = fakeLogger(logs);
  const app = Fastify({ loggerInstance: logger as unknown as FastifyBaseLogger });
  await app.register(compress, { globalCompression: true, globalDecompression: true, threshold: 1024, encodings: ['gzip'], requestEncodings: ['gzip'] });
  app.addHook('onRequest', async (req) => {
    const name = req.headers['x-test-user'];
    if (typeof name === 'string' && USERS[name]) req.user = USERS[name];
  });
  // Two ordinary routes, to show the run route's parser and compression stay with it.
  app.post('/api/echo', async (req) => ({ body: req.body }));
  app.get('/api/big', async () => ({ text: 'x'.repeat(10_000) }));
  const audit: AuditEventInput[] = [];
  const store = { record: async (e: AuditEventInput) => { audit.push(e); return { ...e, id: String(audit.length), occurredAt: '' }; } } as unknown as AuditStore;
  const runner = createCliRunner({ maxRunning: o.maxRunning ?? 2 });
  let started = 0;
  const realStart = runner.start;
  runner.start = (slot, input) => { started += 1; return realStart(slot, input); };
  registerCliRoutes(
    app,
    { cfg: { TERMINOLOGY_WORK_DIR: work, CLI_MAX_UPLOAD_BYTES: o.maxUploadBytes ?? 2_147_483_648, CLI_MAX_RUNNING: 2 }, audit: store, logger: logger as never },
    { runner, entry: () => (o.entry === undefined ? FAKE : o.entry), version: VERSION, maxFiles: o.maxFiles },
  );
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const h = { app, url, work, audit, logs, started: () => started };
  open.push(h);
  return h;
}

/** Every request folder and kept folder that exists now. */
function folders(h: { work: string }): string[] {
  return ['cli-runs', 'cli-kept'].flatMap((d) => (existsSync(join(h.work, d)) ? readdirSync(join(h.work, d)).map((n) => `${d}/${n}`) : []));
}

type Start = Extract<ClientFrame, { t: 'start' }>;
function start(path: string, argv: string[], extra: Partial<Start> = {}): Start {
  return { t: 'start', version: VERSION, path, argv, inputs: [], outputs: [], ...extra };
}
function file(ref: string, rel: string, content: string | Buffer): ClientFrame[] {
  const bytes = typeof content === 'string' ? Buffer.from(content) : content;
  const data: ClientFrame[] = [];
  for (let i = 0; i < bytes.length; i += 64 * 1024) data.push({ t: 'data', d: bytes.subarray(i, i + 64 * 1024).toString('base64') });
  return [{ t: 'file', ref, rel }, ...data, { t: 'end' }];
}
const body = (...frames: Array<ClientFrame | ClientFrame[]>): string => frames.flat().map(encodeFrame).join('');
const GO: ClientFrame = { t: 'go' };
const inFile = (ref: string, name: string, keep = false): Start['inputs'][number] => ({ ref, kind: 'input-file', name, keep });
const inDir = (ref: string, name: string, keep = false): Start['inputs'][number] => ({ ref, kind: 'input-dir', name, keep });

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  frames: ServerFrame[];
  stdout: string;
  stderr: string;
  /** ref -> rel -> content */
  files: Record<string, Record<string, string>>;
  exit: number | undefined;
  json(): Record<string, unknown>;
}

function answer(status: number, headers: IncomingHttpHeaders, text: string): Answer {
  const ndjson = String(headers['content-type'] ?? '').includes('application/x-ndjson');
  const frames = ndjson ? text.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as ServerFrame) : [];
  let stdout = '';
  let stderr = '';
  const files: Record<string, Record<string, string>> = {};
  let current: { ref: string; rel: string } | null = null;
  let exit: number | undefined;
  for (const f of frames) {
    if (f.t === 'out') stdout += Buffer.from(f.d, 'base64').toString('utf8');
    if (f.t === 'err') stderr += Buffer.from(f.d, 'base64').toString('utf8');
    if (f.t === 'file') { current = { ref: f.ref, rel: f.rel }; (files[f.ref] ??= {})[f.rel] = ''; }
    if (f.t === 'data' && current) files[current.ref]![current.rel] += Buffer.from(f.d, 'base64').toString('utf8');
    if (f.t === 'end') current = null;
    if (f.t === 'exit') exit = f.code;
  }
  return { status, headers, text, frames, stdout, stderr, files, exit, json: () => JSON.parse(text) as Record<string, unknown> };
}

function post(h: { url: string }, o: { user?: string; body: string | Buffer; headers?: Record<string, string>; path?: string; method?: string }): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'content-type': 'application/x-ndjson', ...o.headers };
    if (o.user) headers['x-test-user'] = o.user;
    const req = http.request(`${h.url}${o.path ?? '/api/cli/run'}`, { method: o.method ?? 'POST', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(answer(res.statusCode ?? 0, res.headers, Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.end(o.body);
  });
}

function interrupt(h: Harness, user: string, id: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${h.url}/api/cli/runs/${encodeURIComponent(id)}/interrupt`, { method: 'POST', headers: { 'x-test-user': user } }, (res) => {
      let text = '';
      res.on('data', (c: Buffer) => { text += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** A request whose answer is read as it arrives. With `keepOpen`, the body is not ended. */
function stream(h: Harness, user: string, text: string, opts: { keepOpen?: boolean } = {}) {
  const state = { frames: [] as ServerFrame[], status: 0, ended: false, closed: false };
  let buf = '';
  const req = http.request(`${h.url}/api/cli/run`, { method: 'POST', headers: { 'content-type': 'application/x-ndjson', 'x-test-user': user } });
  req.on('error', () => {});
  req.on('close', () => { state.closed = true; });
  req.on('response', (res) => {
    state.status = res.statusCode ?? 0;
    res.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        state.frames.push(JSON.parse(buf.slice(0, i)) as ServerFrame);
        buf = buf.slice(i + 1);
      }
    });
    res.on('end', () => { state.ended = true; });
    res.on('error', () => {});
  });
  if (opts.keepOpen) req.write(text);
  else req.end(text);
  const out = () => answer(200, { 'content-type': 'application/x-ndjson' }, state.frames.map((f) => JSON.stringify(f)).join('\n'));
  return {
    req,
    state,
    out,
    runId: async () => {
      await until(() => state.frames.some((f) => f.t === 'run'), 'run frame');
      return (state.frames.find((f) => f.t === 'run') as { id: string }).id;
    },
    printed: (s: string) => until(() => out().stdout.includes(s), `output ${JSON.stringify(s)}`),
    done: () => until(() => state.ended || state.closed, 'end of answer'),
  };
}

function pidOf(stderr: string, word = 'pid'): number {
  const m = new RegExp(`${word} (\\d+)`).exec(stderr);
  if (!m) throw new Error(`no ${word} printed`);
  return Number(m[1]);
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const cliRows = (h: Harness) => h.audit.filter((e) => e.action === 'cli.run');

/** Writes `total` bytes of data frames after `head`, as fast as the server takes them. Resolves when
 *  the request closes, with what happened. With `stopOnAnswer`, it stops writing once answered. */
function upload(h: Harness, user: string, head: string, total: number, opts: { stopOnAnswer?: boolean } = {}) {
  const chunk = encodeFrame({ t: 'data', d: Buffer.alloc(48 * 1024, 1).toString('base64') });
  return new Promise<{ status: number; text: string; errorBeforeAnswer: boolean; sent: number; closedEarly: boolean }>((resolve) => {
    let answered = false;
    let errorBeforeAnswer = false;
    let status = 0;
    let text = '';
    let sent = 0;
    const req = http.request(`${h.url}/api/cli/run`, { method: 'POST', headers: { 'content-type': 'application/x-ndjson', 'x-test-user': user } });
    req.on('error', () => { if (!answered) errorBeforeAnswer = true; });
    req.on('response', (res) => {
      answered = true;
      status = res.statusCode ?? 0;
      res.on('data', (c: Buffer) => { text += c.toString(); });
      res.on('error', () => {});
      res.on('end', () => { if (opts.stopOnAnswer) req.destroy(); });
    });
    req.on('close', () => resolve({ status, text, errorBeforeAnswer, sent, closedEarly: sent < total }));
    req.write(head);
    const pump = () => {
      while (sent < total && !(opts.stopOnAnswer && answered) && !req.destroyed) {
        sent += chunk.length;
        if (!req.write(chunk)) return void req.once('drain', pump);
      }
      if (!req.destroyed && !(opts.stopOnAnswer && answered)) req.end();
    };
    pump();
  });
}

describe('POST /api/cli/run refusals', () => {
  it('answers 401 with no credential and starts nothing', async () => {
    const h = await harness();
    const r = await post(h, { body: body(start('audit list', ['echo']), GO) });
    expect(r.status).toBe(401);
    expect(r.json()).toEqual({ error: 'authentication required' });
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
    expect(h.audit).toEqual([]);
  });

  it('answers 403 with the capability name and starts nothing', async () => {
    const h = await harness();
    const r = await post(h, { user: 'viewer', body: body(start('audit list', ['echo']), GO) });
    expect(r.status).toBe(403);
    expect(r.json()).toEqual({ error: 'insufficient capability', capability: 'audit.view' });

    // A command with a second key: holding only one of them is not enough, either way round.
    const a = await post(h, { user: 'conn', body: body(start('import start', ['echo']), GO) });
    expect([a.status, a.json()]).toEqual([403, { error: 'insufficient capability', capability: 'ingest.run' }]);
    const b = await post(h, { user: 'ingest', body: body(start('import start', ['echo']), GO) });
    expect([b.status, b.json()]).toEqual([403, { error: 'insufficient capability', capability: 'connectors.manage' }]);
    const c = await post(h, { user: 'admin', body: body(start('import start', ['echo']), GO) });
    expect(c.status).toBe(200);

    expect(h.started()).toBe(1);
    expect(folders(h)).toEqual([]);
    expect(cliRows(h)).toHaveLength(1);
  });

  it('answers 400 for an unknown, recovery or local command', async () => {
    const h = await harness();
    for (const path of ['nope', 'db migrate', 'user reset-password', 'commands', 'artifact build', '__proto__', 'constructor', 'toString', '']) {
      const r = await post(h, { user: 'admin', body: body(start(path, ['echo']), GO) });
      expect(r.status, path).toBe(400);
      expect(typeof r.json().error).toBe('string');
    }
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
    expect(h.audit).toEqual([]);
  });

  it('refuses a client of another version with both versions in the message', async () => {
    const h = await harness();
    const r = await post(h, { user: 'admin', body: body(start('audit list', ['echo'], { version: '0.0.1' }), GO) });
    expect(r.status).toBe(409);
    const error = String(r.json().error);
    expect(error).toContain('0.0.1');
    expect(error).toContain(VERSION);
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
  });

  it('answers 400 for a body that is not the wire format, and for frames out of order', async () => {
    const h = await harness();
    const fileInput = [inFile('f', 'a.csv')];
    const cases: Array<{ body: string | Buffer; headers?: Record<string, string> }> = [
      { body: '{"a":1}', headers: { 'content-type': 'application/json' } },
      { body: 'not json\n' },
      { body: '' },
      { body: body({ t: 'go' }) },
      { body: `${JSON.stringify({ ...start('audit list', ['echo']), argv: 'echo' })}\n` },
      { body: `${JSON.stringify({ ...start('audit list', ['echo']), inputs: [{ ref: 'a', kind: 'output-file', name: 'x', keep: false }] })}\n` },
      { body: body(start('audit list', ['echo'])) }, // no go
      { body: body(start('audit list', ['echo']), start('audit list', ['echo']), GO) },
      { body: body(start('audit list', ['echo']), { t: 'data', d: 'AA==' }, GO) },
      { body: body(start('audit list', ['echo']), { t: 'end' }, GO) },
      { body: `${encodeFrame(start('audit list', ['echo']))}${'x'.repeat(1024 * 1024 + 1)}\n` },
      // An empty line, before or after start.
      { body: `\n${body(start('audit list', ['echo']), GO)}` },
      { body: `${encodeFrame(start('audit list', ['echo']))}\n${encodeFrame(GO)}` },
      // An empty data frame: an empty file is `file` then `end`.
      { body: body(start('connectors add', ['echo'], { inputs: fileInput }), { t: 'file', ref: 'f', rel: '' }, { t: 'data', d: '' }, { t: 'end' }, GO) },
    ];
    for (const [i, c] of cases.entries()) {
      const r = await post(h, { user: 'admin', ...c });
      expect(r.status, `case ${i}`).toBe(400);
      expect(typeof r.json().error).toBe('string');
    }
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
  });

  it('answers a flood of blank lines with a quick 400, before the capability check, and starts nothing', async () => {
    const h = await harness();
    const flood = gzipSync(Buffer.alloc(100 * MiB, 0x0a));
    expect(flood.length).toBeLessThan(200 * 1024);
    const t0 = Date.now();
    const r = await post(h, { user: 'viewer', body: flood, headers: { 'content-encoding': 'gzip' } });
    const took = Date.now() - t0;
    expect(r.status).toBe(400);
    expect(r.json()).toEqual({ error: 'A line is empty.' });
    expect(took).toBeLessThan(2000);
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
  });

  it('wants the start frame within the first 1 MiB of the decoded body', async () => {
    const h = await harness();
    // A gzip body that inflates past 1 MiB with no line end: refused when the 1 MiB is passed.
    const noEnd = gzipSync(Buffer.alloc(2 * MiB, 0x78));
    const a = await post(h, { user: 'admin', body: noEnd, headers: { 'content-encoding': 'gzip' } });
    expect(a.status).toBe(400);
    expect(String(a.json().error)).toContain('longer than');
    // Another frame first.
    const b = await post(h, { user: 'admin', body: gzipSync(Buffer.from(body(GO, start('audit list', ['echo']), GO))), headers: { 'content-encoding': 'gzip' } });
    expect(b.status).toBe(400);
    // A start frame just under 1 MiB is fine.
    const big = start('audit list', ['echo', 'x'.repeat(MiB - 2000)]);
    expect(Buffer.byteLength(JSON.stringify(big))).toBeLessThan(MiB);
    const c = await post(h, { user: 'admin', body: gzipSync(Buffer.from(body(big, GO))), headers: { 'content-encoding': 'gzip' } });
    expect(c.exit).toBe(0);
    expect(h.started()).toBe(1);
  });

  it('answers 400 for inputs and outputs the command has no path for, and starts nothing', async () => {
    const h = await harness();
    const refused: Array<[string, Partial<Start>, string]> = [
      ['audit list', { inputs: [inFile('f', 'a')] }, 'at most 0'],
      ['connectors add', { inputs: [inFile('f', 'a'), inFile('g', 'b')] }, 'at most 1'],
      ['connectors add', { inputs: [inDir('d', 'd')] }, 'no input-dir'],
      ['connectors add', { outputs: [{ ref: 'o', kind: 'output-file' }] }, 'no output-file'],
      ['export', { inputs: [inFile('f', 'a')] }, 'no input-file'],
      ['export', { outputs: [{ ref: 'o', kind: 'output-dir' }, { ref: 'p', kind: 'output-dir' }] }, 'at most 1'],
      // A kept upload only where the command keeps one.
      ['market install', { inputs: [inDir('d', 'bundle', true)] }, 'keeps no upload'],
      ['connectors add', { inputs: [inFile('f', 'a', true)] }, 'keeps no upload'],
    ];
    for (const [path, extra, message] of refused) {
      const r = await post(h, { user: 'admin', body: body(start(path, ['echo'], extra), GO) });
      expect(r.status, `${path} ${message}`).toBe(400);
      expect(String(r.json().error)).toContain(message);
    }
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);

    // A mark whose kind depends on the arguments takes a file or a folder.
    for (const input of [inFile('p', 'codes.json'), inDir('p', 'loinc')]) {
      const r = await post(h, { user: 'admin', body: body(start('terminology import', ['echo'], { inputs: [input] }), GO) });
      expect(r.exit, input.kind).toBe(0);
    }
  });

  it('refuses a run when the request folder is not the server\'s own, and names it', async () => {
    const owned = scratchDir();
    // A link where the folder should be.
    const linked = join(owned, 'linked');
    mkdirSync(linked);
    const other = join(owned, 'elsewhere');
    mkdirSync(other);
    symlinkSync(other, join(linked, 'cli-runs'));
    const h1 = await harness({ work: linked });
    const a = await post(h1, { user: 'admin', body: body(start('audit list', ['echo']), GO) });
    expect(a.status).toBe(503);
    expect(String(a.json().error)).toContain(join(linked, 'cli-runs'));
    expect(String(a.json().error)).toContain('not a real folder');
    expect(readdirSync(other)).toEqual([]);
    expect(h1.logs.some((l) => l.includes('cli work folder refused'))).toBe(true);

    // A folder others can write in.
    const open777 = join(owned, 'open');
    mkdirSync(join(open777, 'cli-runs'), { recursive: true });
    chmodSync(join(open777, 'cli-runs'), 0o777);
    const h2 = await harness({ work: open777 });
    const b = await post(h2, { user: 'admin', body: body(start('audit list', ['echo']), GO) });
    expect(b.status).toBe(503);
    expect(String(b.json().error)).toContain('written by other users');

    // The kept folder is checked when a command keeps an upload.
    const keptOpen = join(owned, 'kept');
    mkdirSync(join(keptOpen, 'cli-kept'), { recursive: true });
    chmodSync(join(keptOpen, 'cli-kept'), 0o777);
    const h3 = await harness({ work: keptOpen });
    const c = await post(h3, { user: 'admin', body: body(start('terminology ontology build', ['echo'], { inputs: [inDir('k', 'dist', true)] }), file('k', 'a', 'a'), GO) });
    expect(c.status).toBe(503);
    expect(String(c.json().error)).toContain(join(keptOpen, 'cli-kept'));
    // A command that keeps nothing still runs, and makes its own folder 0700.
    const d = await post(h3, { user: 'admin', body: body(start('audit list', ['echo']), GO) });
    expect(d.exit).toBe(0);
    expect(statSync(join(keptOpen, 'cli-runs')).mode & 0o777).toBe(0o700);
    expect(h1.started() + h2.started() + h3.started()).toBe(1);
  });

  it('answers 503 naming CLI_ENTRY when the CLI entry cannot be found, and makes no folder', async () => {
    const h = await harness({ entry: null });
    const r = await post(h, { user: 'admin', body: body(start('audit list', ['echo']), GO) });
    expect(r.status).toBe(503);
    expect(String(r.json().error)).toContain('CLI_ENTRY');
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
  });

  it('lets a refused caller that is still uploading read the answer', async () => {
    const h = await harness();
    // More than the socket buffers hold, and less than the 16 MiB the server reads after a refusal.
    const r = await upload(h, 'viewer', body(start('audit list', ['echo']), { t: 'file', ref: 'f', rel: '' }), 12 * MiB, { stopOnAnswer: true });
    expect(r.errorBeforeAnswer).toBe(false);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text)).toEqual({ error: 'insufficient capability', capability: 'audit.view' });
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
  });

  it('lets go of a refused caller that keeps sending past 16 MiB', async () => {
    const h = await harness();
    // A raw client: Node's own stops writing once its answer has ended, so it would never pass 16 MiB.
    const total = 256 * MiB;
    const head = body(start('audit list', ['echo']), { t: 'file', ref: 'f', rel: '' });
    const chunk = Buffer.from(encodeFrame({ t: 'data', d: Buffer.alloc(48 * 1024, 1).toString('base64') }));
    const url = new URL(h.url);
    const t0 = Date.now();
    const r = await new Promise<{ sent: number; got: string; ms: number }>((resolve) => {
      let sent = 0;
      let got = '';
      const s = net.connect(Number(url.port), '127.0.0.1');
      s.on('data', (c: Buffer) => { got += c.toString(); });
      s.on('error', () => {});
      s.on('close', () => resolve({ sent, got, ms: Date.now() - t0 }));
      s.write(`POST /api/cli/run HTTP/1.1\r\nHost: test\r\nContent-Type: application/x-ndjson\r\nx-test-user: viewer\r\nContent-Length: ${total + head.length}\r\n\r\n${head}`);
      const pump = () => {
        while (sent < total && !s.destroyed) {
          sent += chunk.length;
          if (!s.write(chunk)) return void s.once('drain', pump);
        }
      };
      pump();
    });
    expect(r.got.startsWith('HTTP/1.1 403')).toBe(true);
    expect(r.got).toContain('"capability":"audit.view"');
    // Let go on the byte budget, well before the 5-second one.
    expect(r.sent).toBeGreaterThan(16 * MiB);
    expect(r.sent).toBeLessThan(64 * MiB);
    expect(r.ms).toBeLessThan(REFUSAL_DRAIN_MS);
    expect(h.started()).toBe(0);
  });

  it('lets go of a refused caller that keeps its body open, after 5 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = await harness();
    const s = stream(h, 'viewer', body(start('audit list', ['echo'])), { keepOpen: true });
    await until(() => s.state.ended, 'the refusal');
    expect(s.state.status).toBe(403);
    await realSleep(50);
    expect(s.state.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(REFUSAL_DRAIN_MS);
    await until(() => s.state.closed, 'the server to let go');
    expect(h.started()).toBe(0);
  });

  it('removes the folder and starts nothing when the caller leaves in the middle of an upload', async () => {
    const h = await harness();
    const s = stream(h, 'admin', body(start('connectors add', ['echo', '@@f'], { inputs: [inFile('f', 'a.csv')] }), { t: 'file', ref: 'f', rel: '' }, { t: 'data', d: 'AAAA' }), { keepOpen: true });
    await until(() => folders(h).length === 1, 'request folder');
    s.req.destroy();
    await until(() => folders(h).length === 0, 'the folder to go');
    expect(h.started()).toBe(0);
    expect(h.audit).toEqual([]);
  });
});

describe('POST /api/cli/run', () => {
  it('streams output and the exit code of a command', async () => {
    const h = await harness();
    const r = await post(h, { user: 'admin', body: body(start('audit list', ['echo', 'a b', 'é']), GO) });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/x-ndjson');
    // Compression is off for this route, even when the client asks for it.
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.frames[0]).toMatchObject({ t: 'run' });
    expect((r.frames[0] as { id: string }).id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.stdout).toBe('["echo","a b","é"]\n');
    expect(r.stderr).toBe('admin\n');
    expect(r.frames.at(-1)).toEqual({ t: 'exit', code: 0 });

    const failed = await post(h, { user: 'admin', body: body(start('audit list', ['fail', '3']), GO), headers: { 'accept-encoding': 'gzip' } });
    expect(failed.headers['content-encoding']).toBeUndefined();
    expect(failed.stderr).toBe('failed\n');
    expect(failed.exit).toBe(3);
  });

  it('keeps its parser and its uncompressed answer to itself', async () => {
    const h = await harness();
    // Another route does not take application/x-ndjson.
    const ndjson = await post(h, { path: '/api/echo', body: body(GO) });
    expect(ndjson.status).toBe(415);
    // Its JSON limit is the default 1 MiB.
    const small = await post(h, { path: '/api/echo', body: JSON.stringify({ a: 'b' }), headers: { 'content-type': 'application/json' } });
    expect(small.json()).toEqual({ body: { a: 'b' } });
    const large = await post(h, { path: '/api/echo', body: JSON.stringify({ a: 'x'.repeat(2 * MiB) }), headers: { 'content-type': 'application/json' } });
    expect(large.status).toBe(413);
    // Compression stays on elsewhere.
    const big = await post(h, { path: '/api/big', method: 'GET', body: '', headers: { 'accept-encoding': 'gzip' } });
    expect(big.headers['content-encoding']).toBe('gzip');
  });

  it('hands the caller to the process and keeps the arguments off the command line and out of the environment', async () => {
    const h = await harness();
    const secret = 'oldr_SECRETargument0123456789';
    const name = 'patients-secret-name.csv';
    const r = await post(h, {
      user: 'keyed',
      body: body(start('connectors add', ['self', secret, '@@f'], { inputs: [inFile('f', name)] }), file('f', '', 'x'), GO),
    });
    expect(r.exit).toBe(0);
    const seen = JSON.parse(r.stdout) as { argv: string[]; env: Record<string, string>; handoff: { caller: unknown; argv: string[]; path: string } };
    expect(seen.handoff.caller).toEqual({ id: 'u-bot', username: 'bot', displayName: null, keyName: 'backup job' });
    expect(seen.handoff.path).toBe('connectors add');
    expect(seen.handoff.argv).toEqual(['self', secret, '@@f']);
    // The process's own command line is node and the entry file, and nothing else.
    expect(seen.argv).toHaveLength(2);
    expect(seen.argv[1]).toBe(FAKE);
    const envText = JSON.stringify(seen.env);
    expect(envText.includes(secret)).toBe(false);
    expect(envText.includes(name)).toBe(false);
    expect(seen.argv.join(' ').includes(secret)).toBe(false);
  });

  it('uploads an input file and an input folder, and replaces the placeholders with real paths', async () => {
    const h = await harness();
    const f = await post(h, { user: 'admin', body: body(start('connectors add', ['cat', '@@f'], { inputs: [inFile('f', 'data.csv')] }), file('f', '', 'a,b\n1,2\n'), GO) });
    expect(f.stderr).toBe('');
    expect(f.exit).toBe(0);
    expect(Buffer.from((JSON.parse(f.stdout) as Record<string, string>)['@@f']!, 'base64').toString()).toBe('a,b\n1,2\n');

    // The `--flag=` form too.
    const d = await post(h, {
      user: 'admin',
      body: body(start('market install', ['cat', '--in=@@d'], { inputs: [inDir('d', 'bundle')] }), file('d', 'one.txt', 'one'), file('d', 'deep/two.txt', 'two'), GO),
    });
    expect(d.exit).toBe(0);
    const dir = (JSON.parse(d.stdout) as Record<string, Record<string, string>>)['--in=@@d']!;
    expect(Object.fromEntries(Object.entries(dir).map(([k, v]) => [k, Buffer.from(v, 'base64').toString()]))).toEqual({ 'deep/two.txt': 'two', 'one.txt': 'one' });
  });

  it('puts a companion file beside the main file, and passes an empty or unknown placeholder as it is', async () => {
    const h = await harness();
    const w = [inFile('w', 'plugin.wasm')];
    const r = await post(h, {
      user: 'admin',
      body: body(start('connectors add', ['self', '@@w', '', '@@nope', 'x@@w'], { inputs: w }), file('w', '', 'wasm'), file('w', 'manifest.json', '{}'), GO),
    });
    const seen = JSON.parse(r.stdout) as { handoff: { argv: string[]; runDir: string }; cwd: string };
    expect(seen.handoff.argv).toEqual(['self', '@@w', '', '@@nope', 'x@@w']);
    expect(seen.cwd).toBe(seen.handoff.runDir);

    const beside = await post(h, {
      user: 'admin',
      body: body(start('connectors add', ['siblings', '@@w'], { inputs: w }), file('w', '', 'wasm'), file('w', 'manifest.json', '{"ok":true}'), file('w', 'ui.html', '<p>'), GO),
    });
    expect(beside.exit).toBe(0);
    expect(JSON.parse(beside.stdout)).toEqual({ 'manifest.json': '{"ok":true}', 'plugin.wasm': 'wasm', 'ui.html': '<p>' });
  });

  it("shows a companion's path as its bare file name", async () => {
    const h = await harness();
    const r = await post(h, {
      user: 'admin',
      body: body(start('connectors add', ['companion', '@@w', 'manifest.json'], { inputs: [inFile('w', 'plugin.wasm')] }), file('w', '', 'wasm'), file('w', 'manifest.json', '{}'), GO),
    });
    expect(r.stdout).toBe('read manifest.json\n');
    expect(r.text.includes(h.work)).toBe(false);
  });

  it('accepts names with spaces and non-ASCII letters, and an empty file', async () => {
    const h = await harness();
    const f = await post(h, { user: 'admin', body: body(start('connectors add', ['cat', '@@f'], { inputs: [inFile('f', 'résultats du labo.csv')] }), file('f', '', ''), GO) });
    expect(f.exit).toBe(0);
    expect(JSON.parse(f.stdout)).toEqual({ '@@f': '' });
    const d = await post(h, {
      user: 'admin',
      body: body(start('market install', ['cat', '@@d'], { inputs: [inDir('d', 'pasta ção')] }), file('d', 'sous dossier/fichier ü.txt', 'ü'), file('d', 'vazio.txt', ''), GO),
    });
    expect(d.exit).toBe(0);
    expect((JSON.parse(d.stdout) as Record<string, unknown>)['@@d']).toEqual({ 'sous dossier/fichier ü.txt': Buffer.from('ü').toString('base64'), 'vazio.txt': '' });
  });

  it('refuses an input name that leaves the folder', async () => {
    const h = await harness();
    const dirStart = (name: string) => start('market install', ['echo'], { inputs: [inDir('d', name)] });
    const fileStart = (extra: Partial<Start> = {}) => start('connectors add', ['echo'], { inputs: [inFile('f', 'a.csv')], ...extra });
    const cases: string[] = [
      // bad names, including control characters
      ...['..', '.', '', '/etc', 'a/b', 'a\\b', 'a\0b', 'a\nb', 'a\x1bb', 'a\x7fb'].map((name) => body(dirStart(name), GO)),
      // bad rels inside a folder
      ...['../x', '/etc/passwd', 'a/../../x', 'a\\b', 'a\0b', '', 'a//b', 'a/./b', 'a/', 'a/b\rc', 'tab\there'].map((rel) =>
        body(dirStart('d'), file('d', rel, 'x'), GO)),
      // a companion that is not one plain file name, or is the main file again
      ...['sub/x', '..', 'a.csv', '../a', 'x\n'].map((rel) => body(fileStart(), file('f', rel, 'x'), GO)),
      // the same file twice
      body(dirStart('d'), file('d', 'x', '1'), file('d', 'x', '2'), GO),
      body(fileStart(), file('f', '', '1'), file('f', '', '2'), GO),
      // a file below a file
      body(dirStart('d'), file('d', 'x', '1'), file('d', 'x/y', '2'), GO),
      // a bad or unknown ref, and a ref used twice
      body(start('connectors add', ['echo'], { inputs: [inFile('../x', 'a')] }), GO),
      body(fileStart(), file('zz', '', 'x'), GO),
      body(start('facilities import', ['echo'], { inputs: [inFile('f', 'a'), inFile('f', 'b')] }), GO),
      // data that is not base64, or more than 64 KiB in one frame
      body(fileStart(), { t: 'file', ref: 'f', rel: '' }, { t: 'data', d: 'not base64!' }, { t: 'end' }, GO),
      body(fileStart(), { t: 'file', ref: 'f', rel: '' }, { t: 'data', d: Buffer.alloc(64 * 1024 + 1).toString('base64') }, { t: 'end' }, GO),
      // go with a file still open
      body(fileStart(), { t: 'file', ref: 'f', rel: '' }, GO),
    ];
    for (const [i, text] of cases.entries()) {
      const r = await post(h, { user: 'admin', body: text });
      expect(r.status, `case ${i}`).toBe(400);
      expect(String(r.json().error)).not.toContain('passwd');
    }
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
  });

  it('refuses an upload over the limit, names the limit, and leaves no folder', async () => {
    const h = await harness({ maxUploadBytes: 10, maxFiles: 3 });
    const dirStart = start('market install', ['echo'], { inputs: [inDir('d', 'd')] });
    const over = await post(h, { user: 'admin', body: body(dirStart, file('d', 'a', '123456'), file('d', 'b', '12345'), GO) });
    expect(over.status).toBe(413);
    expect(String(over.json().error)).toContain('10 bytes');

    // Counted after decoding: a small gzip body that inflates past the limit.
    const zipped = gzipSync(Buffer.from(body(dirStart, file('d', 'a', Buffer.alloc(5000)), GO)));
    expect(zipped.length).toBeLessThan(1000);
    const bomb = await post(h, { user: 'admin', body: zipped, headers: { 'content-encoding': 'gzip' } });
    expect(bomb.status).toBe(413);

    const many = await post(h, { user: 'admin', body: body(dirStart, file('d', '1', ''), file('d', '2', ''), file('d', '3', ''), file('d', '4', ''), GO) });
    expect(many.status).toBe(413);
    expect(String(many.json().error)).toContain('3 files');
    // Folders made on the way to a file count too: x, x/y, x/y/1, x/2 is four.
    const deep = await post(h, { user: 'admin', body: body(dirStart, file('d', 'x/y/1', ''), file('d', 'x/2', ''), GO) });
    expect(deep.status).toBe(413);

    // At the limits is fine: x, x/1, x/2 is three, and 10 bytes is 10.
    const three = await post(h, { user: 'admin', body: body(dirStart, file('d', 'x/1', ''), file('d', 'x/2', ''), GO) });
    expect(three.exit).toBe(0);
    const at = await post(h, { user: 'admin', body: gzipSync(Buffer.from(body(dirStart, file('d', 'a', '1234567890'), GO))), headers: { 'content-encoding': 'gzip' } });
    expect(at.exit).toBe(0);
    expect(h.started()).toBe(2);
    expect(folders(h)).toEqual([]);
  });

  it('refuses a hand-off over 1 MiB before it starts anything', async () => {
    const h = await harness();
    const argv = ['echo', ...Array.from({ length: 12_000 }, () => '@@f')];
    const r = await post(h, { user: 'admin', body: body(start('connectors add', argv, { inputs: [inFile('f', 'a')] }), GO) });
    expect(r.status).toBe(400);
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
  });

  it('reads nothing of the body after go', async () => {
    const h = await harness();
    // The command runs for 600 ms. Were the rest of the body read, all 128 MiB would be sent by then.
    const total = 128 * MiB;
    const r = await new Promise<{ sent: number; exit: number | undefined }>((resolve) => {
      let sent = 0;
      let text = '';
      const req = http.request(`${h.url}/api/cli/run`, { method: 'POST', headers: { 'content-type': 'application/x-ndjson', 'x-test-user': 'admin' } }, (res) => {
        res.on('data', (c: Buffer) => { text += c.toString(); });
        res.on('end', () => {
          const done = sent;
          req.destroy();
          resolve({ sent: done, exit: answer(200, { 'content-type': 'application/x-ndjson' }, text).exit });
        });
      });
      req.on('error', () => {});
      req.write(body(start('audit list', ['sleep', '600']), GO));
      const junk = Buffer.alloc(64 * 1024, 0x0a);
      const pump = () => {
        while (sent < total && !req.destroyed) {
          sent += junk.length;
          if (!req.write(junk)) return void req.once('drain', pump);
        }
      };
      pump();
    });
    expect(r.exit).toBe(0);
    expect(r.sent).toBeLessThan(total);
  });

  it('sends an output file and an output folder back', async () => {
    const h = await harness();
    const outside = join(scratchDir(), 'outside-secret.txt');
    writeFileSync(outside, 'must not leave');
    const outFile = { outputs: [{ ref: 'o', kind: 'output-file' as const }] };
    const one = await post(h, { user: 'admin', body: body(start('query export', ['write', '@@o', 'hello'], outFile), GO) });
    expect(one.stdout).toBe('wrote @@o\n');
    expect(one.files).toEqual({ o: { '': 'hello' } });
    expect(one.frames.at(-1)).toEqual({ t: 'exit', code: 0 });

    // An output the command did not make sends nothing.
    const none = await post(h, { user: 'admin', body: body(start('query export', ['echo'], outFile), GO) });
    expect(none.files).toEqual({});
    expect(none.exit).toBe(0);

    const dir = await post(h, { user: 'admin', body: body(start('export', ['writedir', '@@od', outside], { outputs: [{ ref: 'od', kind: 'output-dir' }] }), GO) });
    expect(dir.exit).toBe(0);
    expect(dir.stderr).toBe('');
    // Regular files only. The link to a file, the link to a folder and the named pipe are skipped.
    expect(dir.files).toEqual({ od: { 'a.txt': 'alpha', 'empty.txt': '', 'sub/b.txt': 'beta' } });
    expect(dir.text.includes(Buffer.from('must not leave').toString('base64'))).toBe(false);

    // Outputs come back whatever the exit code.
    const failed = await post(h, { user: 'admin', body: body(start('query export', ['write', '@@o', 'partial', '4'], outFile), GO) });
    expect(failed.files).toEqual({ o: { '': 'partial' } });
    expect(failed.exit).toBe(4);
    expect(folders(h)).toEqual([]);
  });

  it('turns every real path back into its placeholder, also when split across two writes', async () => {
    const h = await harness();
    const outputs: Start['outputs'] = [{ ref: 'out1', kind: 'output-dir' }];
    const twice = await post(h, { user: 'admin', body: body(start('export', ['twice', '@@out1'], { outputs }), GO) });
    expect(twice.stdout).toBe('wrote @@out1 and @@out1/sub/file\n');
    expect(twice.stderr).toBe('in @@out1\n');
    expect(twice.text.includes(h.work)).toBe(false);

    for (const cut of ['1', '20', '40']) {
      const split = await post(h, { user: 'admin', body: body(start('export', ['split', '@@out1', cut], { outputs }), GO) });
      expect(split.stdout, cut).toBe('@@out1');
    }
  });

  it('keeps a kept upload after the run, outside the request folder, and names it in keptDirs', async () => {
    const h = await harness();
    const r = await post(h, {
      user: 'admin',
      body: body(start('terminology ontology build', ['self', '@@k'], { inputs: [inDir('k', 'dist', true)] }), file('k', 'a.txt', 'a'), GO),
    });
    const seen = JSON.parse(r.stdout) as { handoff: { keptDirs: string[]; runDir: string } };
    expect(seen.handoff.keptDirs).toHaveLength(1);
    expect(seen.handoff.keptDirs[0]!.startsWith(join(h.work, 'cli-kept'))).toBe(true);
    expect(seen.handoff.runDir.startsWith(join(h.work, 'cli-runs'))).toBe(true);
    const kept = folders(h);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.startsWith('cli-kept/')).toBe(true);
    expect(existsSync(join(h.work, kept[0]!, 'dist', 'a.txt'))).toBe(true);
  });

  it('removes the request folder after a clean run, a failed run and a refused run', async () => {
    const h = await harness();
    const inputs = [inFile('f', 'a')];
    expect((await post(h, { user: 'admin', body: body(start('connectors add', ['echo', '@@f'], { inputs }), file('f', '', 'x'), GO) })).exit).toBe(0);
    expect(folders(h)).toEqual([]);
    expect((await post(h, { user: 'admin', body: body(start('connectors add', ['fail', '2'], { inputs }), file('f', '', 'x'), GO) })).exit).toBe(2);
    expect(folders(h)).toEqual([]);
    // Refused part way through the upload, after the folder was made.
    expect((await post(h, { user: 'admin', body: body(start('connectors add', ['echo'], { inputs }), file('f', '../x', 'x'), GO) })).status).toBe(400);
    expect(folders(h)).toEqual([]);
    // Refused with a kept input: nothing started, so the kept folder goes too.
    const keep = [inDir('k', 'dist', true)];
    expect((await post(h, { user: 'admin', body: body(start('terminology ontology build', ['echo'], { inputs: keep }), file('k', '/x', 'x'), GO) })).status).toBe(400);
    expect(folders(h)).toEqual([]);
  });

  it('logs the code and the folder id when a request folder cannot be removed', async () => {
    const h = await harness();
    // Unlock it afterwards, pass or fail, so the clean-up can remove it.
    const walk = (dir: string): void => {
      chmodSync(dir, 0o700);
      for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) walk(join(dir, e.name));
    };
    try {
      const r = await post(h, { user: 'admin', body: body(start('export', ['lock', '@@od'], { outputs: [{ ref: 'od', kind: 'output-dir' }] }), GO) });
      expect(r.exit).toBe(0);
      const id = (r.frames[0] as { id: string }).id;
      const line = h.logs.find((l) => l.includes('cli folder could not be removed'));
      expect(line).toContain("code: 'EACCES'");
      expect(line).toContain(`folder: '${id}'`);
      expect(line).not.toContain('locked');
    } finally {
      walk(join(h.work, 'cli-runs'));
    }
  });

  it('runs two at once and makes the third wait, then answers busy after 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = await harness();
    const a = stream(h, 'admin', body(start('audit list', ['sleep', '600000']), GO));
    const b = stream(h, 'admin', body(start('audit list', ['sleep', '600000']), GO));
    await a.printed('sleeping');
    await b.printed('sleeping');
    let third: Answer | null = null;
    const waiting = post(h, { user: 'admin', body: body(start('audit list', ['echo']), GO) }).then((r) => { third = r; });
    await until(() => folders(h).length === 3, 'third request folder');
    await vi.advanceTimersByTimeAsync(SLOT_WAIT_MS - 1);
    expect(third).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(third!.status).toBe(503);
    expect(third!.json()).toEqual({ error: 'busy' });
    expect(h.started()).toBe(2);
    expect(folders(h)).toHaveLength(2);
    // The waiter wrote no audit row; the two running ones write theirs when they end.
    expect(cliRows(h)).toEqual([]);
    for (const s of [a, b]) {
      const status = await interrupt(h, 'admin', await s.runId());
      expect(status.status).toBe(204);
    }
    await a.done();
    await b.done();
    await until(() => cliRows(h).length === 2, 'two audit rows');
    expect(folders(h)).toEqual([]);
  });

  it('frees nothing it did not hold when a caller leaves while waiting, and leaves no folder', async () => {
    const h = await harness({ maxRunning: 1 });
    const a = stream(h, 'admin', body(start('audit list', ['sleep', '600000']), GO));
    await a.printed('sleeping');
    const leaver = stream(h, 'admin', body(start('audit list', ['echo']), GO));
    await until(() => folders(h).length === 2, 'waiting request folder');
    leaver.req.destroy();
    await until(() => folders(h).length === 1, 'the leaver to clean up');
    // The running command still holds the only slot: a new caller waits behind it.
    const c = stream(h, 'admin', body(start('audit list', ['echo', 'c']), GO));
    await until(() => folders(h).length === 2, 'third request folder');
    await realSleep(100);
    expect(c.state.frames).toEqual([]);
    await interrupt(h, 'admin', await a.runId());
    await c.done();
    expect(c.out().stdout).toBe('["echo","c"]\n');
    expect(h.started()).toBe(2);
    await until(() => folders(h).length === 0, 'all folders gone');
  });

  it('interrupts a run when asked by its owner, and answers 404 to anyone else', async () => {
    const h = await harness();
    const s = stream(h, 'admin', body(start('audit list', ['sleep', '600000']), GO));
    await s.printed('sleeping');
    const id = await s.runId();
    expect(await interrupt(h, 'other', id)).toEqual({ status: 404, text: JSON.stringify({ error: 'not found' }) });
    expect(await interrupt(h, 'admin', 'x'.repeat(43))).toEqual({ status: 404, text: JSON.stringify({ error: 'not found' }) });
    expect((await interrupt(h, 'admin', id)).status).toBe(204);
    await s.done();
    expect(s.out().stdout).toBe('sleeping\ninterrupted\n');
    expect(s.out().exit).toBe(0);
    await until(() => cliRows(h).length === 1, 'audit row');
    expect(cliRows(h)[0]!.metadata).toEqual({ exitCode: 0, interrupted: true });
    // Once it has gone, the id is unknown.
    expect((await interrupt(h, 'admin', id)).status).toBe(404);
    const anon = await new Promise<number>((resolve) => {
      http.request(`${h.url}/api/cli/runs/${id}/interrupt`, { method: 'POST' }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).end();
    });
    expect(anon).toBe(401);
  });

  it('interrupts a run when the connection closes, and kills it after 10 seconds if it ignores that', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = await harness();
    const marker = join(scratchDir(), 'sigint');
    const s = stream(h, 'admin', body(start('audit list', ['stubborn', marker]), GO));
    await s.printed('stubborn');
    s.req.destroy();
    await until(() => existsSync(marker), 'SIGINT to reach the command');
    await realSleep(100);
    expect(cliRows(h)).toEqual([]);
    await vi.advanceTimersByTimeAsync(KILL_AFTER_MS);
    await until(() => cliRows(h).length === 1, 'audit row');
    expect(cliRows(h)[0]!.metadata).toEqual({ exitCode: 137, interrupted: true });
    expect(folders(h)).toEqual([]);
  });

  it('treats a caller that reads nothing for 5 minutes as gone, and frees its slot', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = await harness();
    let closed = false;
    let response: IncomingMessage | null = null;
    const req = http.request(`${h.url}/api/cli/run`, { method: 'POST', headers: { 'content-type': 'application/x-ndjson', 'x-test-user': 'admin' } }, (res) => {
      response = res;
      res.pause(); // reads nothing
      res.on('error', () => {});
    });
    req.on('error', () => {});
    req.on('close', () => { closed = true; });
    req.end(body(start('audit list', ['flood', String(1024 * MiB)]), GO));
    // The server is waiting for the caller once its one stall timer is set and stays set: early
    // waits end while the socket buffers fill.
    let steady = 0;
    await until(() => { steady = vi.getTimerCount() === 1 ? steady + 1 : 0; return steady >= 40; }, 'the server to wait on the caller');
    await vi.advanceTimersByTimeAsync(STALL_MS - 1);
    expect(cliRows(h)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => cliRows(h).length === 1, 'audit row');
    // The flood has no SIGINT handler, so the interrupt ends it.
    expect(cliRows(h)[0]!.metadata).toEqual({ exitCode: 130, interrupted: true });
    // A client that reads nothing cannot see the close; once it reads, it does.
    (response as IncomingMessage | null)?.resume();
    await until(() => closed, 'the connection to close');
    expect(folders(h)).toEqual([]);
  });

  it('stops waiting for output pipes a grandchild holds open, a few seconds after the command has gone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = await harness();
    const s = stream(h, 'admin', body(start('audit list', ['orphan', '2500']), GO));
    await until(() => /grandchild \d+/.test(s.out().stderr), 'the grandchild');
    const grandchild = pidOf(s.out().stderr, 'grandchild');
    // The command has exited; the pipe wait is the one timer.
    await until(() => vi.getTimerCount() === 1, 'the pipe wait');
    expect(s.state.ended).toBe(false);
    await vi.advanceTimersByTimeAsync(PIPE_WAIT_MS);
    await s.done();
    expect(s.out().exit).toBe(0);
    // The run ended while the grandchild still held the pipes.
    expect(alive(grandchild)).toBe(true);
    await until(() => cliRows(h).length === 1, 'audit row');
    await until(() => !alive(grandchild), 'the grandchild to end by itself');
  });

  it('interrupts running commands on shutdown and leaves no process behind', async () => {
    const h = await harness({ maxRunning: 1 });
    const s = stream(h, 'admin', body(start('audit list', ['sleep', '600000']), GO));
    await s.printed('sleeping');
    const pid = pidOf(s.out().stderr);
    expect(alive(pid)).toBe(true);
    const waiter = post(h, { user: 'admin', body: body(start('audit list', ['echo']), GO) });
    await until(() => folders(h).length === 2, 'waiting request folder');

    await h.app.close();
    open.splice(open.indexOf(h), 1);
    // The row is written before close resolves, so before the context would close.
    expect(cliRows(h)).toHaveLength(1);
    expect(cliRows(h)[0]!.metadata).toEqual({ exitCode: 0, interrupted: true });
    expect(alive(pid)).toBe(false);
    const refused = await waiter;
    expect(refused.status).toBe(503);
    expect(String(refused.json().error)).toContain('stopping');
    await s.done();
    expect(s.out().stdout).toBe('sleeping\ninterrupted\n');
    expect(folders(h)).toEqual([]);
    expect(h.started()).toBe(1);
    rmSync(h.work, { recursive: true, force: true });
  });

  it('slows the command when the caller reads slowly, instead of holding its output', async () => {
    const h = await harness();
    const marker = join(scratchDir(), 'flood-done');
    const total = 48 * MiB;
    const result = await new Promise<{ markerWhilePaused: boolean; bytes: number; exit: number | undefined }>((resolve) => {
      const req = http.request(`${h.url}/api/cli/run`, { method: 'POST', headers: { 'content-type': 'application/x-ndjson', 'x-test-user': 'admin' } }, (res) => {
        res.pause();
        void realSleep(800).then(() => {
          const markerWhilePaused = existsSync(marker);
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => { text += c; });
          res.on('end', () => {
            const a = answer(200, { 'content-type': 'application/x-ndjson' }, text);
            resolve({ markerWhilePaused, bytes: Buffer.byteLength(a.stdout), exit: a.exit });
          });
          res.resume();
        });
      });
      req.end(body(start('audit list', ['flood', String(total), marker]), GO));
    });
    expect(result.markerWhilePaused).toBe(false);
    expect(result.bytes).toBe(total);
    expect(result.exit).toBe(0);
  });

  it('records one audit row per started command, under the account, with where it came from', async () => {
    const h = await harness();
    await post(h, { user: 'admin', body: body(start('audit list', ['echo']), GO) });
    await post(h, { user: 'keyed', body: body(start('audit list', ['fail', '5']), GO) });
    await post(h, { user: 'viewer', body: body(start('audit list', ['echo']), GO) });
    await until(() => cliRows(h).length === 2, 'two rows');
    expect(h.audit).toEqual([
      {
        actorType: 'user', actorId: 'u-admin', actorName: 'admin', origin: { via: 'cli' },
        action: 'cli.run', entityType: 'cli_command', entityId: 'audit list', metadata: { exitCode: 0, interrupted: false },
      },
      {
        actorType: 'user', actorId: 'u-bot', actorName: 'bot', origin: { via: 'cli', keyName: 'backup job' },
        action: 'cli.run', entityType: 'cli_command', entityId: 'audit list', metadata: { exitCode: 5, interrupted: false },
      },
    ]);
  });

  it('logs the command path and exit code and never an argument or a file name', async () => {
    const h = await harness();
    const secret = 'oldr_ANOTHERsecretVALUE987654321';
    const name = 'secret-file-name-4242.csv';
    const content = 'secret-file-content-777';
    await post(h, {
      user: 'admin',
      body: body(start('connectors add', ['echo', secret, '@@f'], { inputs: [inFile('f', name)] }), file('f', '', content), GO),
    });
    await post(h, {
      user: 'admin',
      body: body(start('market install', ['echo', secret], { inputs: [inDir('f', name)] }), file('f', `../${name}`, content), GO),
    });
    await until(() => cliRows(h).length === 1, 'audit row');
    const logText = h.logs.join('\n');
    const auditText = JSON.stringify(h.audit);
    for (const text of [logText, auditText]) {
      expect(text.includes(secret)).toBe(false);
      expect(text.includes(name)).toBe(false);
      expect(text.includes(content)).toBe(false);
      expect(text.includes(Buffer.from(content).toString('base64'))).toBe(false);
    }
    const line = h.logs.find((l) => l.includes('cli command finished'));
    expect(line).toBeDefined();
    expect(line).toContain("command: 'connectors add'");
    expect(line).toContain("accountId: 'u-admin'");
    expect(line).toContain('exitCode: 0');
  });
});

describe('behind the real auth plugin', () => {
  async function realApp(opts: { devBypass?: boolean } = {}) {
    const work = mkdtempSync(join(tmpdir(), 'cli-routes-real-'));
    scratch.push(work);
    const f = await keyFixture({ devBypass: opts.devBypass, cfg: { CLI_ENTRY: FAKE, TERMINOLOGY_WORK_DIR: work } });
    closers.push(() => f.close());
    const url = await f.app.listen({ host: '127.0.0.1', port: 0 });
    return { f, url };
  }
  const run = (path: string, argv: string[]) => body({ t: 'start', version: readAppVersion(), path, argv, inputs: [], outputs: [] }, GO);

  it('runs a request signed in with an access key as that account, with the key named', async () => {
    const { f, url } = await realApp();
    const { key } = await f.makeKey('bot-id', 'backup job');
    const r = await post({ url }, { body: run('user directory-list', ['self']), headers: { authorization: `Bearer ${key}` } });
    expect(r.exit).toBe(0);
    const seen = JSON.parse(r.stdout) as { handoff: { caller: Record<string, unknown> } };
    expect(seen.handoff.caller).toMatchObject({ id: 'bot-id', username: 'bot', keyName: 'backup job' });
    expect(r.text.includes(key)).toBe(false);
    const rows = (await f.allAuditRows()).filter((row) => (row as { action: string }).action === 'cli.run');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).toContain('backup job');
    expect(JSON.stringify(rows)).not.toContain(key);
  });

  it('answers 401 to a request with no credential', async () => {
    const { url } = await realApp();
    const r = await post({ url }, { body: run('user directory-list', ['echo']) });
    expect(r.status).toBe(401);
  });

  it('runs as the dev account when the dev bypass is on', async () => {
    const { url } = await realApp({ devBypass: true });
    const r = await post({ url }, { body: run('user directory-list', ['self']) });
    expect(r.exit).toBe(0);
    expect((JSON.parse(r.stdout) as { handoff: { caller: { username: string; keyName: unknown } } }).handoff.caller).toMatchObject({ username: 'dev-admin', keyName: null });
  });
});

describe('buildApp', () => {
  it('registers both routes', async () => {
    const app = await buildApp(ctxWith('up'));
    await app.ready();
    expect(app.hasRoute({ method: 'POST', url: '/api/cli/run' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/api/cli/runs/:id/interrupt' })).toBe(true);
    await app.close();
  });
});

describe('createPathMasker', () => {
  const run = (pairs: Array<[string, string]>, pieces: string[]): string => {
    const m = createPathMasker(pairs);
    return Buffer.concat([...pieces.map((p) => m.push(Buffer.from(p))), m.flush()]).toString('utf8');
  };

  it('replaces a path split across two chunks, a path twice, and a path followed by more', () => {
    const pairs: Array<[string, string]> = [['/w/run/a1/out', '@@o']];
    expect(run(pairs, ['wrote /w/run/a1/out and /w/run/a1/out/sub/file\n'])).toBe('wrote @@o and @@o/sub/file\n');
    const text = 'x /w/run/a1/out y /w/run/a1/out';
    for (let at = 0; at <= text.length; at += 1) {
      expect(run(pairs, [text.slice(0, at), text.slice(at)]), String(at)).toBe('x @@o y @@o');
    }
    expect(run(pairs, [...text])).toBe('x @@o y @@o');
  });

  it('takes the longest path first, and leaves text that only starts like a path', () => {
    const pairs: Array<[string, string]> = [['/w/a', '@@short'], ['/w/a/b', '@@long']];
    expect(run(pairs, ['/w/a/b/c /w/a/x'])).toBe('@@long/c @@short/x');
    expect(run(pairs, ['/w/a/', 'b'])).toBe('@@long');
    expect(run(pairs, ['/w/', 'z /w'])).toBe('/w/z /w');
    expect(run([], ['/w/run'])).toBe('/w/run');
  });

  it('keeps bytes whole, so a letter cut across chunks comes out whole', () => {
    const bytes = Buffer.from('é /w/a é');
    const m = createPathMasker([['/w/a', '@@x']]);
    const out = Buffer.concat([m.push(bytes.subarray(0, 1)), m.push(bytes.subarray(1, 5)), m.push(bytes.subarray(5)), m.flush()]);
    expect(out.toString('utf8')).toBe('é @@x é');
  });
});

describe('the runner on its own', () => {
  it('starts the command in its own process group', async () => {
    const h = await harness();
    const s = stream(h, 'admin', body(start('audit list', ['sleep', '600000']), GO));
    await s.printed('sleeping');
    const pid = pidOf(s.out().stderr);
    const pgid = (p: number) => Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(p)]).toString().trim());
    expect(pgid(pid)).toBe(pid);
    expect(pgid(pid)).not.toBe(pgid(process.pid));
    await interrupt(h, 'admin', await s.runId());
    await s.done();
  });
});
