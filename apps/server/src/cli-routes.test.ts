// Layer under test: POST /api/cli/run and the interrupt route (cli-routes.ts), in a real Fastify
// listening on 127.0.0.1 port 0, with the same compress set-up as buildApp, and the real runner
// starting the fake CLI in __fixtures__ (never the real one). The signed-in account comes from a test
// header, not the real auth plugin, which answers its own 401 before this route runs. The audit
// store and logger are fakes that record what they are given. Linux only: Windows and macOS are
// unproven.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http, { type IncomingHttpHeaders } from 'node:http';
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
import { buildApp } from './app';
import type { RequestActor } from './auth-plugin';
import { ctxWith } from './test-helpers';
import { createCliRunner, KILL_AFTER_MS, SLOT_WAIT_MS } from './cli-runner';
import { createPathMasker, registerCliRoutes } from './cli-routes';

const FAKE = fileURLToPath(new URL('./__fixtures__/fake-cli.mjs', import.meta.url));
const VERSION = '7.7.7';

const USERS: Record<string, RequestActor> = {
  admin: { id: 'u-admin', username: 'admin', displayName: 'Admin', roles: [], capabilities: ['audit.view', 'data.export', 'connectors.manage', 'ingest.run'] },
  keyed: { id: 'u-bot', username: 'bot', displayName: null, roles: [], capabilities: ['audit.view'], accessKey: { id: 'k1', name: 'backup job' } },
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
afterEach(async () => {
  vi.useRealTimers();
  for (const h of open.splice(0)) {
    await h.app.close();
    rmSync(h.work, { recursive: true, force: true });
  }
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratchDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'cli-routes-x-'));
  scratch.push(d);
  return d;
}

async function harness(o: { entry?: string | null; maxUploadBytes?: number; maxRunning?: number; maxFiles?: number } = {}): Promise<Harness> {
  const work = mkdtempSync(join(tmpdir(), 'cli-routes-'));
  const logs: string[] = [];
  const logger = fakeLogger(logs);
  const app = Fastify({ loggerInstance: logger as unknown as FastifyBaseLogger });
  await app.register(compress, { globalCompression: true, globalDecompression: true, threshold: 1024, encodings: ['gzip'], requestEncodings: ['gzip'] });
  app.addHook('onRequest', async (req) => {
    const name = req.headers['x-test-user'];
    if (typeof name === 'string' && USERS[name]) req.user = USERS[name];
  });
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
function folders(h: Harness): string[] {
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

function post(h: Harness, o: { user?: string; body: string | Buffer; headers?: Record<string, string> }): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'content-type': 'application/x-ndjson', ...o.headers };
    if (o.user) headers['x-test-user'] = o.user;
    const req = http.request(`${h.url}/api/cli/run`, { method: 'POST', headers }, (res) => {
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

/** A request whose answer is read as it arrives. */
function stream(h: Harness, user: string, text: string) {
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
  req.end(text);
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

function pidOf(stderr: string): number {
  const m = /pid (\d+)/.exec(stderr);
  if (!m) throw new Error('no pid printed');
  return Number(m[1]);
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const cliRows = (h: Harness) => h.audit.filter((e) => e.action === 'cli.run');

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
    ];
    for (const [i, c] of cases.entries()) {
      const r = await post(h, { user: 'admin', ...c });
      expect(r.status, `case ${i}`).toBe(400);
      expect(typeof r.json().error).toBe('string');
    }
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
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
    // Far more than the socket buffers hold, so the client is part way through when the answer comes.
    const chunk = encodeFrame({ t: 'data', d: Buffer.alloc(48 * 1024, 1).toString('base64') });
    const total = 32 * 1024 * 1024;
    const result = await new Promise<{ status: number; text: string; errorBeforeAnswer: boolean }>((resolve) => {
      let answered = false;
      let errorBeforeAnswer = false;
      const req = http.request(`${h.url}/api/cli/run`, { method: 'POST', headers: { 'content-type': 'application/x-ndjson', 'x-test-user': 'viewer' } });
      req.on('error', () => { if (!answered) errorBeforeAnswer = true; });
      req.on('response', (res) => {
        answered = true;
        let text = '';
        res.on('data', (c: Buffer) => { text += c.toString(); });
        res.on('end', () => { req.destroy(); resolve({ status: res.statusCode ?? 0, text, errorBeforeAnswer }); });
      });
      req.write(body(start('audit list', ['echo']), { t: 'file', ref: 'f', rel: '' }));
      let sent = 0;
      const pump = () => {
        while (sent < total && !answered) {
          sent += chunk.length;
          if (!req.write(chunk)) return void req.once('drain', pump);
        }
        if (!answered) req.end();
      };
      pump();
    });
    expect(result.errorBeforeAnswer).toBe(false);
    expect(result.status).toBe(403);
    expect(JSON.parse(result.text)).toEqual({ error: 'insufficient capability', capability: 'audit.view' });
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
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

  it('hands the caller to the process and keeps the arguments off the command line and out of the environment', async () => {
    const h = await harness();
    const secret = 'oldr_SECRETargument0123456789';
    const name = 'patients-secret-name.csv';
    const r = await post(h, {
      user: 'keyed',
      body: body(start('audit list', ['self', secret, '@@f'], { inputs: [{ ref: 'f', kind: 'input-file', name, keep: false }] }), file('f', '', 'x'), GO),
    });
    expect(r.exit).toBe(0);
    const seen = JSON.parse(r.stdout) as { argv: string[]; env: Record<string, string>; handoff: { caller: unknown; argv: string[]; path: string } };
    expect(seen.handoff.caller).toEqual({ id: 'u-bot', username: 'bot', displayName: null, keyName: 'backup job' });
    expect(seen.handoff.path).toBe('audit list');
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
    const inputs: Start['inputs'] = [
      { ref: 'f', kind: 'input-file', name: 'data.csv', keep: false },
      { ref: 'd', kind: 'input-dir', name: 'bundle', keep: false },
    ];
    const r = await post(h, {
      user: 'admin',
      body: body(
        start('audit list', ['cat', '@@f', '--in=@@d'], { inputs }),
        file('f', '', 'a,b\n1,2\n'),
        file('f', 'manifest.json', '{"x":1}'),
        file('d', 'one.txt', 'one'),
        file('d', 'deep/two.txt', 'two'),
        GO,
      ),
    });
    expect(r.stderr).toBe('');
    expect(r.exit).toBe(0);
    // The real paths come back as their placeholders, in the `--flag=` form too.
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(['--in=@@d', '@@f']);
    expect(Buffer.from(out['@@f'] as string, 'base64').toString()).toBe('a,b\n1,2\n');
    const dir = out['--in=@@d'] as Record<string, string>;
    expect(Object.fromEntries(Object.entries(dir).map(([k, v]) => [k, Buffer.from(v, 'base64').toString()]))).toEqual({ 'deep/two.txt': 'two', 'one.txt': 'one' });
  });

  it('puts a companion file beside the main file, and passes an empty or unknown placeholder as it is', async () => {
    const h = await harness();
    const r = await post(h, {
      user: 'admin',
      body: body(
        start('audit list', ['self', '@@w', '', '@@nope', 'x@@w'], { inputs: [{ ref: 'w', kind: 'input-file', name: 'plugin.wasm', keep: false }] }),
        file('w', '', 'wasm'),
        file('w', 'manifest.json', '{}'),
        GO,
      ),
    });
    const seen = JSON.parse(r.stdout) as { handoff: { argv: string[]; runDir: string }; cwd: string };
    expect(seen.handoff.argv).toEqual(['self', '@@w', '', '@@nope', 'x@@w']);
    expect(seen.cwd).toBe(seen.handoff.runDir);

    const beside = await post(h, {
      user: 'admin',
      body: body(
        start('audit list', ['siblings', '@@w'], { inputs: [{ ref: 'w', kind: 'input-file', name: 'plugin.wasm', keep: false }] }),
        file('w', '', 'wasm'),
        file('w', 'manifest.json', '{"ok":true}'),
        file('w', 'ui.html', '<p>'),
        GO,
      ),
    });
    expect(beside.exit).toBe(0);
    expect(JSON.parse(beside.stdout)).toEqual({ 'manifest.json': '{"ok":true}', 'plugin.wasm': 'wasm', 'ui.html': '<p>' });
  });

  it('accepts names with spaces and non-ASCII letters, and an empty file', async () => {
    const h = await harness();
    const r = await post(h, {
      user: 'admin',
      body: body(
        start('audit list', ['cat', '@@f', '@@d'], {
          inputs: [
            { ref: 'f', kind: 'input-file', name: 'résultats du labo.csv', keep: false },
            { ref: 'd', kind: 'input-dir', name: 'pasta ção', keep: false },
          ],
        }),
        file('f', '', ''),
        file('d', 'sous dossier/fichier ü.txt', 'ü'),
        file('d', 'vazio.txt', ''),
        GO,
      ),
    });
    expect(r.exit).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out['@@f']).toBe('');
    expect(out['@@d']).toEqual({ 'sous dossier/fichier ü.txt': Buffer.from('ü').toString('base64'), 'vazio.txt': '' });
  });

  it('refuses an input name that leaves the folder', async () => {
    const h = await harness();
    const dirInput = (name: string): Start['inputs'] => [{ ref: 'd', kind: 'input-dir', name, keep: false }];
    const fileInput: Start['inputs'] = [{ ref: 'f', kind: 'input-file', name: 'a.csv', keep: false }];
    const cases: string[] = [
      // bad names
      ...['..', '.', '', '/etc', 'a/b', 'a\\b', 'a\0b'].map((name) => body(start('audit list', ['echo'], { inputs: dirInput(name) }), GO)),
      // bad rels inside a folder
      ...['../x', '/etc/passwd', 'a/../../x', 'a\\b', 'a\0b', '', 'a//b', 'a/./b', 'a/'].map((rel) =>
        body(start('audit list', ['echo'], { inputs: dirInput('d') }), file('d', rel, 'x'), GO)),
      // a companion that is not one plain file name, or is the main file again
      ...['sub/x', '..', 'a.csv', '../a'].map((rel) => body(start('audit list', ['echo'], { inputs: fileInput }), file('f', rel, 'x'), GO)),
      // the same file twice
      body(start('audit list', ['echo'], { inputs: dirInput('d') }), file('d', 'x', '1'), file('d', 'x', '2'), GO),
      body(start('audit list', ['echo'], { inputs: fileInput }), file('f', '', '1'), file('f', '', '2'), GO),
      // a file below a file
      body(start('audit list', ['echo'], { inputs: dirInput('d') }), file('d', 'x', '1'), file('d', 'x/y', '2'), GO),
      // a bad or unknown ref, and a ref used twice
      body(start('audit list', ['echo'], { inputs: [{ ref: '../x', kind: 'input-file', name: 'a', keep: false }] }), GO),
      body(start('audit list', ['echo'], { inputs: fileInput }), file('zz', '', 'x'), GO),
      body(start('audit list', ['echo'], { inputs: [...fileInput, ...fileInput] }), GO),
      body(start('audit list', ['echo'], { inputs: fileInput, outputs: [{ ref: 'f', kind: 'output-file' }] }), GO),
      // data that is not base64, or more than 64 KiB in one frame
      body(start('audit list', ['echo'], { inputs: fileInput }), { t: 'file', ref: 'f', rel: '' }, { t: 'data', d: 'not base64!' }, { t: 'end' }, GO),
      body(start('audit list', ['echo'], { inputs: fileInput }), { t: 'file', ref: 'f', rel: '' }, { t: 'data', d: Buffer.alloc(64 * 1024 + 1).toString('base64') }, { t: 'end' }, GO),
      // go with a file still open
      body(start('audit list', ['echo'], { inputs: fileInput }), { t: 'file', ref: 'f', rel: '' }, GO),
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
    const inputs: Start['inputs'] = [{ ref: 'd', kind: 'input-dir', name: 'd', keep: false }];
    const over = await post(h, { user: 'admin', body: body(start('audit list', ['echo'], { inputs }), file('d', 'a', '123456'), file('d', 'b', '12345'), GO) });
    expect(over.status).toBe(413);
    expect(String(over.json().error)).toContain('10 bytes');

    // Counted after decoding: a small gzip body that inflates past the limit.
    const zipped = gzipSync(Buffer.from(body(start('audit list', ['echo'], { inputs }), file('d', 'a', Buffer.alloc(5000)), GO)));
    expect(zipped.length).toBeLessThan(1000);
    const bomb = await post(h, { user: 'admin', body: zipped, headers: { 'content-encoding': 'gzip' } });
    expect(bomb.status).toBe(413);

    const many = await post(h, { user: 'admin', body: body(start('audit list', ['echo'], { inputs }), file('d', '1', ''), file('d', '2', ''), file('d', '3', ''), file('d', '4', ''), GO) });
    expect(many.status).toBe(413);
    expect(String(many.json().error)).toContain('3 files');

    // At the limit is fine, and a gzip body that stays under it works.
    const at = await post(h, { user: 'admin', body: gzipSync(Buffer.from(body(start('audit list', ['echo'], { inputs }), file('d', 'a', '1234567890'), GO))), headers: { 'content-encoding': 'gzip' } });
    expect(at.exit).toBe(0);
    expect(h.started()).toBe(1);
    expect(folders(h)).toEqual([]);
  });

  it('refuses a hand-off over 1 MiB before it starts anything', async () => {
    const h = await harness();
    const argv = ['echo', ...Array.from({ length: 12_000 }, () => '@@f')];
    const r = await post(h, { user: 'admin', body: body(start('audit list', argv, { inputs: [{ ref: 'f', kind: 'input-file', name: 'a', keep: false }] }), GO) });
    expect(r.status).toBe(400);
    expect(h.started()).toBe(0);
    expect(folders(h)).toEqual([]);
  });

  it('sends an output file and an output folder back', async () => {
    const h = await harness();
    const outside = join(scratchDir(), 'outside-secret.txt');
    writeFileSync(outside, 'must not leave');
    const outputs: Start['outputs'] = [
      { ref: 'o', kind: 'output-file' },
      { ref: 'od', kind: 'output-dir' },
      { ref: 'none', kind: 'output-file' },
    ];
    const one = await post(h, { user: 'admin', body: body(start('export', ['write', '@@o', 'hello'], { outputs }), GO) });
    expect(one.stdout).toBe('wrote @@o\n');
    expect(one.files).toEqual({ o: { '': 'hello' } });
    expect(one.frames.at(-1)).toEqual({ t: 'exit', code: 0 });

    const dir = await post(h, { user: 'admin', body: body(start('export', ['writedir', '@@od', outside], { outputs }), GO) });
    expect(dir.exit).toBe(0);
    // Regular files only. The link to a file and the link to a folder are not followed.
    expect(dir.files).toEqual({ od: { 'a.txt': 'alpha', 'empty.txt': '', 'sub/b.txt': 'beta' } });
    expect(dir.text.includes(Buffer.from('must not leave').toString('base64'))).toBe(false);

    // Outputs come back whatever the exit code.
    const failed = await post(h, { user: 'admin', body: body(start('export', ['write', '@@o', 'partial', '4'], { outputs }), GO) });
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
      body: body(start('audit list', ['self', '@@k'], { inputs: [{ ref: 'k', kind: 'input-dir', name: 'dist', keep: true }] }), file('k', 'a.txt', 'a'), GO),
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
    const inputs: Start['inputs'] = [{ ref: 'f', kind: 'input-file', name: 'a', keep: false }];
    expect((await post(h, { user: 'admin', body: body(start('audit list', ['echo', '@@f'], { inputs }), file('f', '', 'x'), GO) })).exit).toBe(0);
    expect(folders(h)).toEqual([]);
    expect((await post(h, { user: 'admin', body: body(start('audit list', ['fail', '2'], { inputs }), file('f', '', 'x'), GO) })).exit).toBe(2);
    expect(folders(h)).toEqual([]);
    // Refused part way through the upload, after the folder was made.
    expect((await post(h, { user: 'admin', body: body(start('audit list', ['echo'], { inputs }), file('f', '../x', 'x'), GO) })).status).toBe(400);
    expect(folders(h)).toEqual([]);
    // Refused with a kept input: nothing started, so the kept folder goes too.
    const keep: Start['inputs'] = [{ ref: 'k', kind: 'input-dir', name: 'dist', keep: true }];
    expect((await post(h, { user: 'admin', body: body(start('audit list', ['echo'], { inputs: keep }), file('k', '/x', 'x'), GO) })).status).toBe(400);
    expect(folders(h)).toEqual([]);
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
    // A second interrupt of a run that is stopping is still the owner's to ask.
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
    const total = 48 * 1024 * 1024;
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
      body: body(start('export', ['echo', secret, '@@f'], { inputs: [{ ref: 'f', kind: 'input-file', name, keep: false }] }), file('f', '', content), GO),
    });
    await post(h, {
      user: 'admin',
      body: body(start('export', ['echo', secret], { inputs: [{ ref: 'f', kind: 'input-dir', name, keep: false }] }), file('f', `../${name}`, content), GO),
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
    expect(line).toContain("command: 'export'");
    expect(line).toContain("accountId: 'u-admin'");
    expect(line).toContain('exitCode: 0');
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
