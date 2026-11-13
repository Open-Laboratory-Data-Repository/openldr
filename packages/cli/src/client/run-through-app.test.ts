import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// No command may run in-process against a database here. loadConfig throws, so a command that is
// not sent through the app fails loudly instead of reading the dev .env.
vi.mock('@openldr/config', async (orig) => ({
  ...(await orig<typeof import('@openldr/config')>()),
  loadConfig: () => { throw new Error('loadConfig must not be called in this test'); },
}));
const spies = vi.hoisted(() => ({ layoutsList: vi.fn(async () => 0), artifactPublish: vi.fn(async () => 0) }));
vi.mock('../layouts', async (orig) => ({ ...(await orig<typeof import('../layouts')>()), runLayoutsList: spies.layoutsList }));
vi.mock('../artifact', async (orig) => ({ ...(await orig<typeof import('../artifact')>()), runArtifactPublish: spies.artifactPublish }));

import { buildClientProgram, buildProgram } from '../program';
import { commandPath } from '../command-list';
import type { CommandMeta } from '../command-meta';
import { runningVersion } from '../update';
import { decodeFrames, encodeFrame, type ClientFrame, type ServerFrame } from '../wire';
import { runThroughApp, uploadSeam } from './run-through-app';

// A key-shaped value for the tests. Not a real key.
const KEY = 'oldr_TESTKEYtestkeyTESTKEYtestkeyTESTKEYtes';
const PLACEHOLDER = /^@@[A-Za-z0-9_-]{12,64}$/;

type Start = Extract<ClientFrame, { t: 'start' }>;
interface Call { method: string; url: string; headers: IncomingHttpHeaders; frames: ClientFrame[] }
type Handler = (call: Call, req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

const servers: { close: () => Promise<void> }[] = [];

async function startServer(handler: Handler) {
  const calls: Call[] = [];
  const server = createServer((req, res) => {
    const call: Call = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, frames: [] };
    calls.push(call);
    void Promise.resolve(handler(call, req, res)).catch(() => res.destroy());
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  const handle = {
    url: `http://127.0.0.1:${port}`,
    port,
    calls,
    close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
  };
  servers.push(handle);
  return handle;
}

/** Reads the client's frames up to `go`, without ending the request (the iterator's return() is a no-op). */
async function readUntilGo(call: Call, req: IncomingMessage): Promise<void> {
  const it = req[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  const shared: AsyncIterable<Buffer> = {
    [Symbol.asyncIterator]: () => ({ next: () => it.next(), return: async () => ({ done: true as const, value: undefined }) }),
  };
  for await (const f of decodeFrames<ClientFrame>(shared)) {
    call.frames.push(f);
    if (f.t === 'go') return;
  }
}

function stream200(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
}
function send(res: ServerResponse, ...frames: ServerFrame[]): void {
  for (const f of frames) res.write(encodeFrame(f));
}
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
const start = (call: Call) => call.frames[0] as Start;

/** A handler that reads to `go` and answers with these frames. */
const answers = (...frames: ServerFrame[]): Handler => async (call, req, res) => {
  await readUntilGo(call, req);
  stream200(res);
  send(res, { t: 'run', id: 'run-1' }, ...frames);
  res.end();
};

function refuse(status: number, body: Record<string, unknown>): Handler {
  return async (call, req, res) => {
    await readUntilGo(call, req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

interface Result { code: number | undefined; out: string; err: string; log: [string, string][] }

/** Runs the client program over these words, as index.ts does, with OPENLDR_THROUGH_APP=1 unless env
 *  says otherwise. parseAsync must resolve: nothing is caught here. */
async function cli(
  words: string[], env: NodeJS.ProcessEnv, signals: EventEmitter = new EventEmitter(), log: [string, string][] = [],
  setup?: (program: Command) => void,
): Promise<Result> {
  const sink = (name: string) => new Writable({ write(c, _e, cb) { log.push([name, Buffer.from(c).toString('utf8')]); cb(); } });
  const program = buildClientProgram({ out: sink('out'), err: sink('err'), signals, env: { OPENLDR_THROUGH_APP: '1', ...env } });
  setup?.(program);
  process.exitCode = undefined;
  await program.parseAsync(['node', 'openldr', ...words]);
  const code = process.exitCode as number | undefined;
  process.exitCode = undefined;
  const text = (n: string) => log.filter(([k]) => k === n).map(([, t]) => t).join('');
  return { code, out: text('out'), err: text('err'), log };
}

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Rebuilds the uploaded files from the frames: ref -> rel -> bytes. */
function uploads(call: Call): Map<string, Map<string, Buffer>> {
  const out = new Map<string, Map<string, Buffer>>();
  let open: { ref: string; rel: string; parts: Buffer[] } | null = null;
  for (const f of call.frames) {
    if (f.t === 'file') open = { ref: f.ref, rel: f.rel, parts: [] };
    else if (f.t === 'data') open!.parts.push(Buffer.from(f.d, 'base64'));
    else if (f.t === 'end') {
      if (!out.has(open!.ref)) out.set(open!.ref, new Map());
      out.get(open!.ref)!.set(open!.rel, Buffer.concat(open!.parts));
      open = null;
    }
  }
  return out;
}

let dir: string;
const savedSkip = process.env.OPENLDR_SKIP_ENV_FILE;
beforeAll(() => { process.env.OPENLDR_SKIP_ENV_FILE = 'true'; });
afterAll(() => { if (savedSkip === undefined) delete process.env.OPENLDR_SKIP_ENV_FILE; else process.env.OPENLDR_SKIP_ENV_FILE = savedSkip; });
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'openldr-client-'));
  spies.layoutsList.mockClear();
  spies.artifactPublish.mockClear();
});
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the client program', () => {
  it('does not run through the app without OPENLDR_THROUGH_APP', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const r = await cli(['layouts', 'list'], { OPENLDR_THROUGH_APP: undefined, OPENLDR_URL: srv.url });
    expect(spies.layoutsList).toHaveBeenCalledTimes(1);
    expect(srv.calls).toHaveLength(0);
    expect(r.code).toBe(0);

    const r2 = await cli(['layouts', 'list'], { OPENLDR_THROUGH_APP: '0', OPENLDR_URL: srv.url });
    expect(spies.layoutsList).toHaveBeenCalledTimes(2);
    expect(srv.calls).toHaveLength(0);
    expect(r2.code).toBe(0);
  });

  it('resolves parseAsync normally after sending, and refuses a plain parse() with one line', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 5 }));
    const program = buildClientProgram({ out: new Writable({ write: (_c, _e, cb) => cb() }), env: { OPENLDR_THROUGH_APP: '1', OPENLDR_URL: srv.url } });
    process.exitCode = undefined;
    await expect(program.parseAsync(['node', 'openldr', 'layouts', 'list'])).resolves.toBe(program);
    expect(process.exitCode).toBe(5);
    process.exitCode = undefined;
    // A closed port: if the override were removed, this could never reach port 3000.
    const closedEnv = { OPENLDR_THROUGH_APP: '1', OPENLDR_URL: 'http://127.0.0.1:9' };
    expect(() => buildClientProgram({ env: closedEnv }).parse(['node', 'openldr', 'layouts', 'list'])).toThrow('The openldr client program must be run with parseAsync, not parse.');
  });

  it('refuses a command with no table entry when commands go through the app (fails closed)', async () => {
    const extra = vi.fn();
    const add = (p: Command) => { p.command('not-in-the-table').action(extra); };
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const r = await cli(['not-in-the-table'], { OPENLDR_URL: srv.url }, new EventEmitter(), [], add);
    expect(r.err).toBe('not-in-the-table has no entry in the command table, so it cannot run.\n');
    expect(r.code).toBe(1);
    expect(extra).not.toHaveBeenCalled();
    expect(srv.calls).toHaveLength(0);
    // Without OPENLDR_THROUGH_APP nothing changes yet (Task 12 removes the switch).
    await cli(['not-in-the-table'], { OPENLDR_THROUGH_APP: undefined, OPENLDR_URL: srv.url }, new EventEmitter(), [], add);
    expect(extra).toHaveBeenCalledTimes(1);
  });

  it('with OPENLDR_THROUGH_APP=1 sends an app command and does not run it here', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const r = await cli(['layouts', 'list', '--json'], { OPENLDR_URL: srv.url });
    expect(spies.layoutsList).not.toHaveBeenCalled();
    expect(srv.calls).toHaveLength(1);
    expect(srv.calls[0]!.method).toBe('POST');
    expect(srv.calls[0]!.url).toBe('/api/cli/run');
    expect(srv.calls[0]!.headers['content-type']).toBe('application/x-ndjson');
    expect(start(srv.calls[0]!)).toMatchObject({ t: 'start', path: 'layouts list', argv: ['layouts', 'list', '--json'], inputs: [], outputs: [] });
    expect(r.code).toBe(0);
  });

  it('takes --server-url anywhere on the line and never sends it', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    await cli(['--server-url', srv.url, 'layouts', 'list'], { OPENLDR_URL: 'http://127.0.0.1:9' });
    // A closed port as the fallback: if --server-url parsing broke, the run fails instead of
    // reaching the default address, which is the operator's dev server.
    await cli(['layouts', '--server-url=' + srv.url, 'list', '--json'], { OPENLDR_URL: 'http://127.0.0.1:9' });
    await cli(['layouts', 'list', '--json', '--server-url', srv.url], { OPENLDR_URL: 'http://127.0.0.1:9' });
    expect(srv.calls.map((c) => start(c).argv)).toEqual([['layouts', 'list'], ['layouts', 'list', '--json'], ['layouts', 'list', '--json']]);
  });

  it('runs a local form of an app command on this machine (artifact publish without --install)', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    await cli(['artifact', 'publish', join(dir, 'b'), '--to', join(dir, 'r')], { OPENLDR_URL: srv.url });
    expect(spies.artifactPublish).toHaveBeenCalledTimes(1);
    expect(srv.calls).toHaveLength(0);
  });

  it("refuses a call the table refuses, before any request", async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const r = await cli(['sync', 'export'], { OPENLDR_URL: srv.url });
    expect(r.err).toBe('Through the app, sync export needs --out <file>.\n');
    expect(r.code).toBe(1);
    expect(srv.calls).toHaveLength(0);
  });

  it('refuses --actor before any request', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const r = await cli(['--actor', 'bob', 'layouts', 'list'], { OPENLDR_URL: srv.url });
    expect(r.err).toBe('--actor cannot be used through the app. The signed-in account is recorded.\n');
    expect(r.code).toBe(1);
    expect(srv.calls).toHaveLength(0);
    expect(spies.layoutsList).not.toHaveBeenCalled();
  });

  it('refuses plain HTTP to another machine with no credential too', async () => {
    const r = await cli(['layouts', 'list'], { OPENLDR_URL: 'http://lab.example:3000' });
    expect(r.err).toBe('Refusing to send a credential over plain HTTP to lab.example. Use https, or set OPENLDR_ALLOW_PLAIN_HTTP=true.\n');
    expect(r.code).toBe(1);
  });

  it('stops on a missing key file and sends nothing', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const missing = join(dir, 'no-key');
    const r = await cli(['layouts', 'list'], { OPENLDR_URL: srv.url, OPENLDR_KEY_FILE: missing });
    expect(r.err).toContain(missing);
    expect(r.code).toBe(1);
    expect(srv.calls).toHaveLength(0);
  });

  it('has no --key option and no command option that a root option would take', () => {
    const program = buildClientProgram();
    const rootLongs = new Set(program.options.map((o) => o.long));
    expect([...rootLongs].sort()).toEqual(['--actor', '--server-url']);
    expect(rootLongs.has('--key')).toBe(false);
    const clashes: string[] = [];
    const walk = (c: Command): void => {
      for (const sub of c.commands) {
        for (const o of sub.options) if (o.long && rootLongs.has(o.long)) clashes.push(`${commandPath(sub)} ${o.long}`);
        walk(sub);
      }
    };
    walk(program);
    // An existing fault: the root --actor takes the value of `audit list --actor`. Allowed here, and
    // no other clash may be added.
    expect(clashes).toEqual(['audit list --actor']);
  });

  it('sends the version this CLI is, which is the root package.json version without APP_VERSION', async () => {
    const saved = process.env.APP_VERSION;
    delete process.env.APP_VERSION;
    try {
      const root = JSON.parse(await readFile(resolve(fileURLToPath(import.meta.url), '../../../../../package.json'), 'utf8')) as { version: string };
      expect(runningVersion()).toBe(root.version);
      const srv = await startServer(answers({ t: 'exit', code: 0 }));
      await cli(['layouts', 'list'], { OPENLDR_URL: srv.url });
      expect(start(srv.calls[0]!).version).toBe(root.version);
    } finally {
      if (saved !== undefined) process.env.APP_VERSION = saved;
    }
  });
});

describe('sending a command', () => {
  it('never puts the key in the URL', async () => {
    let interrupted: Call | null = null;
    const srv = await startServer(async (call, req, res) => {
      if (call.url.includes('/interrupt')) {
        interrupted = call;
        res.writeHead(204);
        res.end();
        return;
      }
      await readUntilGo(call, req);
      stream200(res);
      send(res, { t: 'run', id: 'abc_DEF-123' }, { t: 'out', d: b64('ready\n') });
      await waitFor(() => interrupted !== null);
      send(res, { t: 'exit', code: 130 });
      res.end();
    });
    const signals = new EventEmitter();
    const log: [string, string][] = [];
    const running = cli(['layouts', 'list'], { OPENLDR_URL: srv.url, OPENLDR_KEY: KEY }, signals, log);
    await waitFor(() => log.some(([, t]) => t.includes('ready')));
    signals.emit('SIGINT');
    const r = await running;
    expect(r.code).toBe(130);
    expect(srv.calls).toHaveLength(2);
    for (const call of srv.calls) {
      expect(call.url).not.toContain(KEY);
      expect(call.url).not.toContain('oldr_');
      expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    }
    expect(JSON.stringify(srv.calls[0]!.frames)).not.toContain(KEY);
    expect(r.out + r.err).not.toContain(KEY);
  });

  it('sends no Authorization header when there is no credential', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    await cli(['layouts', 'list'], { OPENLDR_URL: srv.url });
    expect(srv.calls[0]!.headers.authorization).toBeUndefined();
  });

  it('sends the command and prints output in order, and returns the exit code', async () => {
    const srv = await startServer(answers(
      { t: 'out', d: b64('one\n') }, { t: 'err', d: b64('two\n') }, { t: 'out', d: b64('three\n') },
      { t: 'error', message: 'An output could not be sent.' },
      { t: 'exit', code: 7 },
    ));
    const r = await cli(['layouts', 'list'], { OPENLDR_URL: srv.url });
    // An error frame means an output did not arrive, so the client ends with 1 whatever the command said.
    expect(r.code).toBe(1);
    expect(r.log).toEqual([['out', 'one\n'], ['err', 'two\n'], ['out', 'three\n'], ['err', 'OpenLDR: An output could not be sent.\n']]);
    const frames = srv.calls[0]!.frames;
    expect(frames.map((f) => f.t)).toEqual(['start', 'go']);

    const plain = await startServer(answers({ t: 'out', d: b64('done\n') }, { t: 'exit', code: 7 }));
    const r2 = await cli(['layouts', 'list'], { OPENLDR_URL: plain.url });
    expect(r2.code).toBe(7);
    expect(r2.out).toBe('done\n');
  });

  it('ends the body right after go, with no empty line', async () => {
    let raw = '';
    const srv = await startServer(async (_call, req, res) => {
      for await (const c of req) raw += String(c);
      stream200(res);
      send(res, { t: 'run', id: 'r1' }, { t: 'exit', code: 0 });
      res.end();
    });
    const empty = join(dir, 'empty.json');
    await writeFile(empty, '');
    await cli(['ingest', empty], { OPENLDR_URL: srv.url });
    expect(raw.endsWith('{"t":"go"}\n')).toBe(true);
    expect(raw.split('\n').slice(0, -1).every((line) => line.length > 0)).toBe(true);
    expect(raw.startsWith('{"t":"start"')).toBe(true);
    expect(raw).not.toContain('"t":"data"');
  });

  it('works under a path prefix in the address', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    await cli(['layouts', 'list'], { OPENLDR_URL: `${srv.url}/openldr` });
    expect(srv.calls[0]!.url).toBe('/openldr/api/cli/run');
  });

  it('says the connection was lost when the answer ends with no exit frame', async () => {
    const srv = await startServer(answers({ t: 'out', d: b64('partial\n') }));
    const r = await cli(['layouts', 'list'], { OPENLDR_URL: srv.url });
    expect(r.out).toBe('partial\n');
    expect(r.err).toBe('The connection to OpenLDR was lost.\n');
    expect(r.code).toBe(1);
  });

  it('does not follow a redirect', async () => {
    const other = await startServer(answers({ t: 'exit', code: 0 }));
    const srv = await startServer((_call, _req, res) => {
      res.writeHead(307, { location: `${other.url}/api/cli/run` });
      res.end();
    });
    const r = await cli(['layouts', 'list'], { OPENLDR_URL: srv.url, OPENLDR_KEY: KEY });
    expect(r.code).toBe(1);
    expect(r.err).toBe('OpenLDR answered with a redirect, which this client does not follow. Check the address.\n');
    expect(other.calls).toHaveLength(0);
  });
});

describe('refusals', () => {
  it('prints the right message for 401, 403, busy and a refused connection', async () => {
    const cases: [Handler, string][] = [
      [refuse(401, { error: 'authentication required' }), 'Sign in first: openldr login, or set OPENLDR_KEY.\n'],
      [refuse(401, { error: 'invalid access key' }), 'Sign in first: openldr login, or set OPENLDR_KEY.\n'],
      [refuse(403, { error: 'insufficient capability', capability: 'settings.edit_general' }), 'This account lacks the capability settings.edit_general.\n'],
      [refuse(503, { error: 'busy' }), 'OpenLDR is running other commands. Try again shortly.\n'],
      [refuse(409, { error: 'This client is version 1 and OpenLDR is version 2. Use the same release on both.' }), 'This client is version 1 and OpenLDR is version 2. Use the same release on both.\n'],
      [refuse(400, { error: 'Unknown command.' }), 'Unknown command.\n'],
      [refuse(413, { error: 'The upload is larger than the limit of 10 bytes.' }), 'The upload is larger than the limit of 10 bytes.\n'],
      [refuse(503, { error: 'The CLI entry file cannot be found. Set CLI_ENTRY to its path.' }), 'The CLI entry file cannot be found. Set CLI_ENTRY to its path.\n'],
      [refuse(403, { error: 'account disabled' }), 'account disabled\n'],
      [refuse(500, {}), 'OpenLDR answered with status 500.\n'],
    ];
    for (const [handler, message] of cases) {
      const srv = await startServer(handler);
      const r = await cli(['layouts', 'list'], { OPENLDR_URL: srv.url });
      expect(r.err, message).toBe(message);
      expect(r.code).toBe(1);
    }

    const closed = await startServer(() => {});
    await closed.close();
    const r = await cli(['layouts', 'list'], { OPENLDR_URL: closed.url });
    expect(r.err).toBe(`Cannot reach OpenLDR at ${closed.url}. Is it running?\n`);
    expect(r.code).toBe(1);
  });

  it('says the connection was lost, not that OpenLDR cannot be reached, on a reset', async () => {
    // The connection is made, then dropped before any answer.
    const srv = await startServer((_call, req) => { req.socket.destroy(); });
    const r = await cli(['layouts', 'list'], { OPENLDR_URL: srv.url });
    expect(r.err).toBe('The connection to OpenLDR was lost.\n');
    expect(r.code).toBe(1);
  });

  it('prints the answer when the server refuses while the upload is still going', async () => {
    // 40 MiB, made here: well over the socket buffers and over the 16 MiB the server discards.
    const big = join(dir, 'big.bin');
    await writeFile(big, Buffer.alloc(40 * 1024 * 1024, 7));
    // Answers at once and never reads the body.
    const srv = await startServer((_call, _req, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'insufficient capability', capability: 'ingest.run' }));
    });
    const r = await cli(['ingest', big], { OPENLDR_URL: srv.url });
    expect(r.err).toBe('This account lacks the capability ingest.run.\n');
    expect(r.code).toBe(1);

    // Answers at once, then throws away 1 MiB of the body and closes the connection, as the real
    // server does after its limit.
    const closing = await startServer((_call, req, res) => {
      res.writeHead(403, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify({ error: 'insufficient capability', capability: 'ingest.run' }));
      let seen = 0;
      req.on('data', (c: Buffer) => { seen += c.length; if (seen > 1024 * 1024) req.socket.destroy(); });
    });
    const r2 = await cli(['ingest', big], { OPENLDR_URL: closing.url });
    expect(r2.err).toBe('This account lacks the capability ingest.run.\n');
    expect(r2.code).toBe(1);
  });
});

describe('paths', () => {
  it('replaces path values by position for --flag value, --flag=value and positionals', async () => {
    const data = join(dir, 'data.json');
    const cmap = join(dir, 'map.json');
    await writeFile(data, '{}');
    await writeFile(cmap, '{"a":1}');
    const srv = await startServer(answers({ t: 'exit', code: 0 }));

    // The same string twice: only the positional is a path, --source is not.
    await cli(['ingest', data, '--source', data, `--config=${cmap}`], { OPENLDR_URL: srv.url });
    let s = start(srv.calls[0]!);
    expect(s.argv[0]).toBe('ingest');
    expect(s.argv[1]).toMatch(PLACEHOLDER);
    expect(s.argv.slice(2, 4)).toEqual(['--source', data]);
    expect(s.argv[4]).toMatch(/^--config=@@[A-Za-z0-9_-]{12,64}$/);
    expect(s.inputs).toEqual([
      { ref: s.argv[1]!.slice(2), kind: 'input-file', name: 'data.json', keep: false },
      { ref: s.argv[4]!.slice('--config=@@'.length), kind: 'input-file', name: 'map.json', keep: false },
    ]);
    const files = uploads(srv.calls[0]!);
    expect(files.get(s.inputs[0]!.ref)!.get('')!.toString()).toBe('{}');
    expect(files.get(s.inputs[1]!.ref)!.get('')!.toString()).toBe('{"a":1}');

    // After the -- terminator.
    await cli(['ingest', '--source', 's', '--', data], { OPENLDR_URL: srv.url });
    s = start(srv.calls[1]!);
    expect(s.argv.slice(0, 4)).toEqual(['ingest', '--source', 's', '--']);
    expect(s.argv[4]).toMatch(PLACEHOLDER);

    // A value that looks like a flag, on a path option and on a plain option.
    await cli(['patients', 'duplicates', 'export', '--out', '-dups.csv'], { OPENLDR_URL: srv.url });
    s = start(srv.calls[2]!);
    expect(s.argv.slice(0, 4)).toEqual(['patients', 'duplicates', 'export', '--out']);
    expect(s.argv[4]).toMatch(PLACEHOLDER);
    expect(s.outputs).toEqual([{ ref: s.argv[4]!.slice(2), kind: 'output-file' }]);
    await cli(['audit', 'list', '--sort', '-occurredAt', 'actor', '--json'], { OPENLDR_URL: srv.url });
    expect(start(srv.calls[3]!).argv).toEqual(['audit', 'list', '--sort', '-occurredAt', 'actor', '--json']);
  });

  it('decides the kind of a path from the other arguments (a path mark whose kind is a function)', async () => {
    const loinc = join(dir, 'loinc');
    await mkdir(loinc);
    await writeFile(join(loinc, 'Loinc.csv'), 'x');
    const amr = join(dir, 'amr.sqlite');
    await writeFile(amr, 'db');
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    await cli(['terminology', 'import', 'loinc', loinc], { OPENLDR_URL: srv.url });
    await cli(['terminology', 'import', 'amr', amr], { OPENLDR_URL: srv.url });
    expect(start(srv.calls[0]!).inputs).toMatchObject([{ kind: 'input-dir', name: 'loinc' }]);
    expect(start(srv.calls[0]!).argv.slice(0, 3)).toEqual(['terminology', 'import', 'loinc']);
    expect(start(srv.calls[1]!).inputs).toMatchObject([{ kind: 'input-file', name: 'amr.sqlite' }]);
  });

  it('sends a marked option that came from its default as an explicit option', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    await cli(['export', '--json'], { OPENLDR_URL: srv.url });
    const s = start(srv.calls[0]!);
    expect(s.argv.slice(0, 2)).toEqual(['export', '--json']);
    expect(s.argv[2]).toMatch(/^--out=@@[A-Za-z0-9_-]{12,64}$/);
    expect(s.outputs).toEqual([{ ref: s.argv[2]!.slice('--out=@@'.length), kind: 'output-dir' }]);
  });

  it('sends an empty value only where the table allows it, and refuses it elsewhere', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    await cli(['settings', 'lab', 'set', '--logo-file', ''], { OPENLDR_URL: srv.url });
    expect(start(srv.calls[0]!)).toMatchObject({ argv: ['settings', 'lab', 'set', '--logo-file', ''], inputs: [] });
    const r = await cli(['ingest', ''], { OPENLDR_URL: srv.url });
    expect(r.err).toBe('<file> needs a file or folder name.\n');
    expect(r.code).toBe(1);
    const r2 = await cli(['ingest', 'x', '--config', ''], { OPENLDR_URL: srv.url });
    expect(r2.err).toBe('--config needs a file or folder name.\n');
    expect(srv.calls).toHaveLength(1);
  });

  it('uploads the companions the table names, beside the file', async () => {
    const wasm = join(dir, 'plugin.wasm');
    await writeFile(wasm, Buffer.from([0, 97, 115, 109]));
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ui: { entry: 'page.html' } }));
    await writeFile(join(dir, 'page.html'), '<p>hi</p>');
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    await cli(['plugin', 'install', wasm], { OPENLDR_URL: srv.url });
    const s = start(srv.calls[0]!);
    const files = uploads(srv.calls[0]!).get(s.inputs[0]!.ref)!;
    expect([...files.keys()]).toEqual(['', 'manifest.json', 'page.html']);
    expect(files.get('page.html')!.toString()).toBe('<p>hi</p>');
  });

  it('uploads a file with spaces and non-ASCII letters in its name, an empty file, and a folder', async () => {
    const odd = join(dir, 'résultats du jour ü.json');
    await writeFile(odd, '{"ok":true}');
    const empty = join(dir, 'empty.json');
    await writeFile(empty, '');
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    await cli(['ingest', odd], { OPENLDR_URL: srv.url });
    await cli(['ingest', empty], { OPENLDR_URL: srv.url });
    let s = start(srv.calls[0]!);
    expect(s.inputs[0]!.name).toBe('résultats du jour ü.json');
    expect(uploads(srv.calls[0]!).get(s.inputs[0]!.ref)!.get('')!.toString()).toBe('{"ok":true}');
    s = start(srv.calls[1]!);
    expect(srv.calls[1]!.frames.map((f) => f.t)).toEqual(['start', 'file', 'end', 'go']);
    expect(uploads(srv.calls[1]!).get(s.inputs[0]!.ref)!.get('')!.length).toBe(0);

    // A folder: regular files, nested files and a link to a file inside (Ruling 68: the only link
    // followed). Each file goes under its own path. A FIFO is skipped. An empty folder is not sent.
    const bundle = join(dir, 'my bundle');
    await mkdir(join(bundle, 'sub', 'deeper'), { recursive: true });
    await mkdir(join(bundle, 'nothing-here'));
    await writeFile(join(bundle, 'manifest.json'), '{}');
    await writeFile(join(bundle, 'sub', 'ü ä.txt'), 'umlaut');
    await writeFile(join(bundle, 'sub', 'deeper', 'zero.bin'), '');
    await symlink(join(bundle, 'sub', 'ü ä.txt'), join(bundle, 'link-in.txt'));
    let fifo = false;
    try { execFileSync('mkfifo', [join(bundle, 'pipe')]); fifo = true; } catch { /* no mkfifo: skip that part */ }
    await cli(['market', 'install', bundle], { OPENLDR_URL: srv.url });
    s = start(srv.calls[2]!);
    expect(s.inputs).toEqual([{ ref: s.argv[2]!.slice(2), kind: 'input-dir', name: 'my bundle', keep: false }]);
    const tree = uploads(srv.calls[2]!).get(s.inputs[0]!.ref)!;
    expect([...tree.keys()].sort()).toEqual(['link-in.txt', 'manifest.json', 'sub/deeper/zero.bin', 'sub/ü ä.txt']);
    expect(tree.get('link-in.txt')!.toString()).toBe('umlaut');
    expect(tree.get('sub/ü ä.txt')!.toString()).toBe('umlaut');
    expect(tree.get('sub/deeper/zero.bin')!.length).toBe(0);
    if (fifo) expect(tree.has('pipe')).toBe(false);
  });

  it('refuses a link in an uploaded folder that points outside it or to nothing, before any request (Ruling 64)', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const outside = join(dir, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'not for upload');
    const cases: [string, (bundle: string) => Promise<void>, (bundle: string) => string][] = [
      ['a link to a file outside', (b) => symlink(join(outside, 'secret.txt'), join(b, 'file-out')),
        (b) => `${join(b, 'file-out')} is a link that points outside ${b}.`],
      ['a link to a folder outside', (b) => symlink(outside, join(b, 'sub', 'dir-out')),
        (b) => `${join(b, 'sub', 'dir-out')} is a link that points outside ${b}.`],
      ['a dangling link', (b) => symlink(join(b, 'gone'), join(b, 'dangling')),
        (b) => `${join(b, 'dangling')} is a link to something that does not exist.`],
    ];
    for (const [name, makeLink, message] of cases) {
      const bundle = await mkdtemp(join(dir, 'bundle-'));
      await mkdir(join(bundle, 'sub'));
      await writeFile(join(bundle, 'manifest.json'), '{}');
      await makeLink(bundle);
      const r = await cli(['market', 'install', bundle], { OPENLDR_URL: srv.url });
      expect(r.err, name).toBe(`${message(bundle)}\n`);
      expect(r.code, name).toBe(1);
    }
    expect(srv.calls).toHaveLength(0);
  });

  it('refuses a link to a folder inside, and a loop of links, before any request (Ruling 68)', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const bundle = join(dir, 'b1');
    await mkdir(join(bundle, 'sub'), { recursive: true });
    await writeFile(join(bundle, 'sub', 'z.txt'), 'z');
    await symlink(join(bundle, 'sub'), join(bundle, 'link-dir'));
    const r = await cli(['market', 'install', bundle], { OPENLDR_URL: srv.url });
    expect(r.err).toBe(`${join(bundle, 'link-dir')} is a link to a folder. A link to a folder is not sent.\n`);
    expect(r.code).toBe(1);

    const looped = join(dir, 'b2');
    await mkdir(looped);
    await symlink(join(looped, 'b'), join(looped, 'a'));
    await symlink(join(looped, 'a'), join(looped, 'b'));
    const r2 = await cli(['market', 'install', looped], { OPENLDR_URL: srv.url });
    expect(r2.err).toBe(`${join(looped, 'a')} is a link in a loop of links.\n`);
    expect(r2.code).toBe(1);
    expect(srv.calls).toHaveLength(0);
  });

  describe('a file changed between the walk and the read (Ruling 68)', () => {
    /** Reads what the client sends, whether or not it reaches go, and answers only after go. */
    const collect: Handler = async (call, req, res) => {
      try { await readUntilGo(call, req); } catch { return; }
      if (call.frames.at(-1)?.t !== 'go') return;
      stream200(res);
      send(res, { t: 'run', id: 'r1' }, { t: 'exit', code: 0 });
      res.end();
    };
    const SECRET = 'OUTSIDE SECRET';
    let bundle: string;
    let outside: string;
    beforeEach(async () => {
      bundle = join(dir, 'bundle');
      outside = join(dir, 'outside');
      await mkdir(join(bundle, 'sub'), { recursive: true });
      await mkdir(outside);
      await writeFile(join(bundle, 'a.txt'), 'inside a');
      await writeFile(join(bundle, 'data.txt'), 'inside data');
      await writeFile(join(bundle, 'sub', 'x.txt'), 'inside x');
      await writeFile(join(outside, 'data.txt'), SECRET);
      await writeFile(join(outside, 'x.txt'), SECRET);
    });
    afterEach(() => { delete uploadSeam.beforeOpen; });

    /** Sends the bundle, running `swap` once just before `target` is opened. */
    async function sendWithSwap(target: string, swap: () => Promise<void>) {
      const srv = await startServer(collect);
      uploadSeam.beforeOpen = async (typed) => { if (typed === target) await swap(); };
      const r = await cli(['market', 'install', bundle], { OPENLDR_URL: srv.url });
      const call = srv.calls[0]!;
      const sentBytes = call.frames.filter((f): f is Extract<ClientFrame, { t: 'data' }> => f.t === 'data')
        .map((f) => Buffer.from(f.d, 'base64').toString()).join('');
      return { r, call, sentBytes };
    }

    it('refuses a file swapped for a link to a file outside, and sends nothing of it', async () => {
      const target = join(bundle, 'data.txt');
      const { r, call, sentBytes } = await sendWithSwap(target, async () => {
        await rm(target);
        await symlink(join(outside, 'data.txt'), target);
      });
      expect(r.err).toBe(`${target} changed while it was being sent. Nothing more was sent.\n`);
      expect(r.code).toBe(1);
      expect(sentBytes).not.toContain(SECRET);
      expect(call.frames.some((f) => f.t === 'file' && f.rel === 'data.txt')).toBe(false);
      expect(call.frames.some((f) => f.t === 'go')).toBe(false);
    });

    it('refuses a file under a sub-folder swapped for a link to a folder outside', async () => {
      const target = join(bundle, 'sub', 'x.txt');
      const { r, sentBytes } = await sendWithSwap(target, async () => {
        await rename(join(bundle, 'sub'), join(bundle, 'sub-old'));
        await symlink(outside, join(bundle, 'sub'));
      });
      expect(r.err).toBe(`${target} changed while it was being sent. Nothing more was sent.\n`);
      expect(r.code).toBe(1);
      expect(sentBytes).not.toContain(SECRET);
    });

    it('is not blocked by a FIFO swapped in for a file', async () => {
      const target = join(bundle, 'data.txt');
      const { r } = await sendWithSwap(target, async () => {
        await rm(target);
        execFileSync('mkfifo', [target]);
      });
      expect(r.err).toBe(`${target} changed while it was being sent. Nothing more was sent.\n`);
      expect(r.code).toBe(1);
    });

    it('still sends every file when nothing changed', async () => {
      const { r, call } = await sendWithSwap('none', async () => {});
      expect(r.code).toBe(0);
      const s = start(call);
      expect([...uploads(call).get(s.inputs[0]!.ref)!.keys()].sort()).toEqual(['a.txt', 'data.txt', 'sub/x.txt']);
    });
  });

  it('sends a file the caller named that is a link, but not a companion that links outside', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const real = join(dir, 'elsewhere', 'payload.json');
    await mkdir(join(dir, 'elsewhere'));
    await writeFile(real, '{"named":true}');
    const named = join(dir, 'named.json');
    await symlink(real, named);
    await cli(['ingest', named], { OPENLDR_URL: srv.url });
    const s = start(srv.calls[0]!);
    expect(s.inputs[0]!.name).toBe('named.json');
    expect(uploads(srv.calls[0]!).get(s.inputs[0]!.ref)!.get('')!.toString()).toBe('{"named":true}');

    // plugin install reads manifest.json beside the wasm. Here it is a link out of that folder.
    const pdir = join(dir, 'plugin');
    await mkdir(pdir);
    await writeFile(join(pdir, 'p.wasm'), Buffer.from([0, 97, 115, 109]));
    await writeFile(join(dir, 'elsewhere', 'manifest.json'), '{}');
    await symlink(join(dir, 'elsewhere', 'manifest.json'), join(pdir, 'manifest.json'));
    const r = await cli(['plugin', 'install', join(pdir, 'p.wasm')], { OPENLDR_URL: srv.url });
    expect(r.err).toBe(`${join(pdir, 'manifest.json')} is a link that points outside ${pdir}.\n`);
    expect(r.code).toBe(1);
    expect(srv.calls).toHaveLength(1);
  });

  it('sends a large file in data frames of at most 64 KiB', async () => {
    const big = join(dir, 'big.bin');
    const bytes = Buffer.alloc(200 * 1024 + 5);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
    await writeFile(big, bytes);
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    await cli(['ingest', big], { OPENLDR_URL: srv.url });
    const data = srv.calls[0]!.frames.filter((f): f is Extract<ClientFrame, { t: 'data' }> => f.t === 'data');
    expect(data.length).toBeGreaterThanOrEqual(4);
    for (const f of data) expect(Buffer.from(f.d, 'base64').length).toBeLessThanOrEqual(64 * 1024);
    const s = start(srv.calls[0]!);
    expect(uploads(srv.calls[0]!).get(s.inputs[0]!.ref)!.get('')!.equals(bytes)).toBe(true);
  });

  it('fails before any request when an input file does not exist', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const missing = join(dir, 'missing.json');
    const r = await cli(['ingest', missing], { OPENLDR_URL: srv.url });
    expect(r.err).toBe(`Cannot find ${missing}.\n`);
    expect(r.code).toBe(1);
    const r2 = await cli(['market', 'install', join(dir, 'no-such-folder')], { OPENLDR_URL: srv.url });
    expect(r2.err).toContain('no-such-folder');
    const r3 = await cli(['ingest', dir], { OPENLDR_URL: srv.url });
    expect(r3.err).toBe(`${dir} is not a file.\n`);
    expect(srv.calls).toHaveLength(0);
  });

  it('refuses a file or folder name with a control character before any request, naming the path', async () => {
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const odd = join(dir, 'bad\u0007name.json');
    await writeFile(odd, '{}');
    const r = await cli(['ingest', odd], { OPENLDR_URL: srv.url });
    expect(r.err).toBe(`Cannot send ${odd}: its name holds a control character.\n`);
    expect(r.code).toBe(1);
    const bundle = join(dir, 'bundle');
    await mkdir(bundle);
    await writeFile(join(bundle, 'tab\there.txt'), 'x');
    const r2 = await cli(['market', 'install', bundle], { OPENLDR_URL: srv.url });
    expect(r2.err).toContain(join(bundle, 'tab\there.txt'));
    expect(r2.code).toBe(1);
    expect(srv.calls).toHaveLength(0);
  });
});

describe('output files', () => {
  it('writes an output file when it is complete, and turns placeholders back into what was typed', async () => {
    const target = join(dir, 'dups.csv');
    const srv = await startServer(async (call, req, res) => {
      await readUntilGo(call, req);
      const ref = start(call).outputs[0]!.ref;
      stream200(res);
      // The placeholder is cut across two frames.
      send(res, { t: 'run', id: 'r1' }, { t: 'out', d: b64(`wrote @@${ref.slice(0, 5)}`) }, { t: 'out', d: b64(`${ref.slice(5)} ok\n`) });
      send(res, { t: 'err', d: b64(`note @@${ref}\n`) });
      send(res, { t: 'file', ref, rel: '' }, { t: 'data', d: b64('a,b\n') }, { t: 'data', d: b64('1,2\n') }, { t: 'end' }, { t: 'exit', code: 0 });
      res.end();
    });
    const r = await cli(['patients', 'duplicates', 'export', '--out', target], { OPENLDR_URL: srv.url });
    expect(r.code).toBe(0);
    expect(r.out).toBe(`wrote ${target} ok\n`);
    expect(r.err).toBe(`note ${target}\n`);
    expect(await readFile(target, 'utf8')).toBe('a,b\n1,2\n');
    expect(await readdir(dir)).toEqual(['dups.csv']);
  });

  it('writes an output file only when it is complete', async () => {
    const target = join(dir, 'dups.csv');
    const srv = await startServer(async (call, req, res) => {
      await readUntilGo(call, req);
      const ref = start(call).outputs[0]!.ref;
      stream200(res);
      send(res, { t: 'run', id: 'r1' }, { t: 'file', ref, rel: '' }, { t: 'data', d: b64('half of it') });
      // Drops the connection half way through the file.
      setTimeout(() => res.destroy(), 50);
    });
    const r = await cli(['patients', 'duplicates', 'export', '--out', target], { OPENLDR_URL: srv.url });
    expect(r.code).toBe(1);
    expect(r.err).toBe('The connection to OpenLDR was lost.\n');
    await expect(stat(target)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  it('drops a file that fails part way on the server, leaves the target alone, and exits 1', async () => {
    const target = join(dir, 'dups.csv');
    await writeFile(target, 'the old file');
    const srv = await startServer(async (call, req, res) => {
      await readUntilGo(call, req);
      const ref = start(call).outputs[0]!.ref;
      stream200(res);
      send(res, { t: 'run', id: 'r1' }, { t: 'file', ref, rel: '' }, { t: 'data', d: b64('half') });
      send(res, { t: 'error', message: 'An output could not be sent.' }, { t: 'exit', code: 0 });
      res.end();
    });
    const r = await cli(['patients', 'duplicates', 'export', '--out', target], { OPENLDR_URL: srv.url });
    expect(r.err).toBe('OpenLDR: An output could not be sent.\n');
    expect(r.code).toBe(1);
    expect(await readFile(target, 'utf8')).toBe('the old file');
    expect(await readdir(dir)).toEqual(['dups.csv']);
  });

  it('writes an output folder, and refuses a name that would leave it or a ref it did not declare', async () => {
    const out = join(dir, 'exp');
    const srv = await startServer(async (call, req, res) => {
      await readUntilGo(call, req);
      const ref = start(call).outputs[0]!.ref;
      stream200(res);
      send(res, { t: 'run', id: 'r1' });
      send(res, { t: 'file', ref, rel: 'fhir/Patient.ndjson' }, { t: 'data', d: b64('{}\n') }, { t: 'end' });
      send(res, { t: 'file', ref, rel: 'manifest.json' }, { t: 'end' });
      send(res, { t: 'exit', code: 0 });
      res.end();
    });
    const r = await cli(['export', '--out', out], { OPENLDR_URL: srv.url });
    expect(r.code).toBe(0);
    expect(await readFile(join(out, 'fhir', 'Patient.ndjson'), 'utf8')).toBe('{}\n');
    expect(await readFile(join(out, 'manifest.json'), 'utf8')).toBe('');

    for (const rel of ['../evil.txt', '/etc/evil.txt', 'a/../../evil.txt', 'a\\evil.txt', 'a//b', './x', '', 'a/\0b']) {
      const bad = await startServer(async (call, req, res) => {
        await readUntilGo(call, req);
        const ref = start(call).outputs[0]!.ref;
        stream200(res);
        send(res, { t: 'run', id: 'r1' }, { t: 'file', ref, rel }, { t: 'data', d: b64('x') }, { t: 'end' }, { t: 'exit', code: 0 });
        res.end();
      });
      const r2 = await cli(['export', '--out', join(dir, 'exp2')], { OPENLDR_URL: bad.url });
      expect(r2.err, rel).toBe('OpenLDR sent a file name that is not allowed.\n');
      expect(r2.code).toBe(1);
    }
    expect((await readdir(dir)).sort()).toEqual(['exp']);

    const unknown = await startServer(answers({ t: 'file', ref: 'not-declared-ref', rel: '' }, { t: 'end' }, { t: 'exit', code: 0 }));
    const r3 = await cli(['export', '--out', join(dir, 'exp3')], { OPENLDR_URL: unknown.url });
    expect(r3.err).toBe('OpenLDR sent a file this command did not ask for.\n');
    expect(r3.code).toBe(1);
  });

  it('does not write through a link that leads out of the output folder', async () => {
    const out = join(dir, 'exp');
    const elsewhere = join(dir, 'elsewhere');
    await mkdir(out);
    await mkdir(elsewhere);
    await symlink(elsewhere, join(out, 'sub'));
    const srv = await startServer(async (call, req, res) => {
      await readUntilGo(call, req);
      const ref = start(call).outputs[0]!.ref;
      stream200(res);
      // `sub` is a link out of the folder; `deeper` does not exist yet, so a careless mkdir would
      // make it inside `elsewhere`.
      send(res, { t: 'run', id: 'r1' }, { t: 'file', ref, rel: 'sub/deeper/x.txt' }, { t: 'data', d: b64('x') }, { t: 'end' }, { t: 'exit', code: 0 });
      res.end();
    });
    const r = await cli(['export', '--out', out], { OPENLDR_URL: srv.url });
    expect(r.err).toBe('OpenLDR sent a file name that is not allowed.\n');
    expect(r.code).toBe(1);
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it('writes through a link that stays inside the output folder', async () => {
    const out = join(dir, 'exp');
    await mkdir(join(out, 'real'), { recursive: true });
    await symlink(join(out, 'real'), join(out, 'alias'));
    const srv = await startServer(async (call, req, res) => {
      await readUntilGo(call, req);
      const ref = start(call).outputs[0]!.ref;
      stream200(res);
      send(res, { t: 'run', id: 'r1' }, { t: 'file', ref, rel: 'alias/new/x.txt' }, { t: 'data', d: b64('x') }, { t: 'end' }, { t: 'exit', code: 0 });
      res.end();
    });
    const r = await cli(['export', '--out', out], { OPENLDR_URL: srv.url });
    expect(r.code).toBe(0);
    expect(await readFile(join(out, 'real', 'new', 'x.txt'), 'utf8')).toBe('x');
  });

  it('treats an exit frame with a file still open as a broken answer', async () => {
    const target = join(dir, 'dups.csv');
    const srv = await startServer(async (call, req, res) => {
      await readUntilGo(call, req);
      const ref = start(call).outputs[0]!.ref;
      stream200(res);
      send(res, { t: 'run', id: 'r1' }, { t: 'file', ref, rel: '' }, { t: 'data', d: b64('half') }, { t: 'exit', code: 0 });
      res.end();
    });
    const r = await cli(['patients', 'duplicates', 'export', '--out', target], { OPENLDR_URL: srv.url });
    expect(r.err).toBe('OpenLDR sent an answer this client cannot read.\n');
    expect(r.code).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('interrupts', () => {
  it('sends an interrupt on the first SIGINT and keeps reading to the exit frame', async () => {
    let interrupt: Call | null = null;
    const srv = await startServer(async (call, req, res) => {
      if (call.url !== '/api/cli/run') {
        interrupt = call;
        let body = '';
        for await (const c of req) body += String(c);
        (interrupt as Call & { body?: string }).body = body;
        res.writeHead(204);
        res.end();
        return;
      }
      await readUntilGo(call, req);
      stream200(res);
      send(res, { t: 'run', id: 'abc_DEF-123' }, { t: 'out', d: b64('ready\n') });
      await waitFor(() => interrupt !== null);
      send(res, { t: 'out', d: b64('stopped at the next page\n') }, { t: 'exit', code: 3 });
      res.end();
    });
    const signals = new EventEmitter();
    const log: [string, string][] = [];
    const running = cli(['layouts', 'list'], { OPENLDR_URL: srv.url }, signals, log);
    await waitFor(() => log.some(([, t]) => t.includes('ready')));
    expect(signals.listenerCount('SIGINT')).toBe(1);
    signals.emit('SIGINT');
    const r = await running;
    expect(r.code).toBe(3);
    expect(r.out).toBe('ready\nstopped at the next page\n');
    const i = interrupt as unknown as Call & { body: string };
    expect(i.method).toBe('POST');
    expect(i.url).toBe('/api/cli/runs/abc_DEF-123/interrupt');
    expect(i.headers['content-type']).toBeUndefined();
    expect(i.body).toBe('');
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('ends with code 130 on a second SIGINT', async () => {
    const srv = await startServer(async (call, req, res) => {
      if (call.url !== '/api/cli/run') { res.writeHead(204); res.end(); return; }
      await readUntilGo(call, req);
      stream200(res);
      send(res, { t: 'run', id: 'r1' }, { t: 'out', d: b64('ready\n') });
      // Never ends.
    });
    const signals = new EventEmitter();
    const log: [string, string][] = [];
    const running = cli(['layouts', 'list'], { OPENLDR_URL: srv.url }, signals, log);
    await waitFor(() => log.some(([, t]) => t.includes('ready')));
    signals.emit('SIGINT');
    await waitFor(() => srv.calls.length === 2);
    signals.emit('SIGINT');
    const r = await running;
    expect(r.code).toBe(130);
    expect(r.err).toBe('Stopped.\n');
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('ends the interrupt request with the run, even when it never gets an answer', async () => {
    let interruptClosed = false;
    let interruptSeen = false;
    const srv = await startServer(async (call, req, res) => {
      if (call.url !== '/api/cli/run') {
        // Never answers.
        interruptSeen = true;
        res.on('close', () => { interruptClosed = true; });
        return;
      }
      await readUntilGo(call, req);
      stream200(res);
      send(res, { t: 'run', id: 'r1' }, { t: 'out', d: b64('ready\n') });
      await waitFor(() => interruptSeen);
      send(res, { t: 'exit', code: 3 });
      res.end();
    });
    const signals = new EventEmitter();
    const log: [string, string][] = [];
    const running = cli(['layouts', 'list'], { OPENLDR_URL: srv.url }, signals, log);
    await waitFor(() => log.some(([, t]) => t.includes('ready')));
    signals.emit('SIGINT');
    const r = await running;
    expect(r.code).toBe(3);
    await waitFor(() => interruptClosed, 2000);
    // Ending it is not a failure to report.
    expect(r.err).toBe('');
  });

  it('ends with 130 on a forced stop while a file read hangs', async () => {
    const file = join(dir, 'hang.bin');
    await writeFile(file, 'never read');
    // The open of this file never finishes, to stand for a file read stuck in the kernel.
    uploadSeam.beforeOpen = (typed) => (typed === file ? new Promise<void>(() => {}) : Promise.resolve());
    try {
      let sawStart = false;
      const srv = await startServer(async (call, req) => {
        const it = req[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
        const shared: AsyncIterable<Buffer> = { [Symbol.asyncIterator]: () => ({ next: () => it.next(), return: async () => ({ done: true as const, value: undefined }) }) };
        try { for await (const f of decodeFrames<ClientFrame>(shared)) if (f.t === 'start') sawStart = true; } catch { /* the client left */ }
      });
      const signals = new EventEmitter();
      const running = cli(['ingest', file], { OPENLDR_URL: srv.url }, signals);
      await waitFor(() => sawStart);
      signals.emit('SIGINT');
      const r = await running;
      expect(r.code).toBe(130);
      expect(r.err).toBe('Stopped. Waiting for a file read to finish.\n');
      expect(srv.calls).toHaveLength(1);
    } finally {
      delete uploadSeam.beforeOpen;
    }
  });

  it('aborts the request and ends with 130 on a SIGINT before the run starts', async () => {
    let gotGo = false;
    let closed = false;
    const srv = await startServer(async (call, req, res) => {
      res.on('close', () => { closed = true; });
      await readUntilGo(call, req);
      gotGo = true;
      // Waits for a slot that never comes.
    });
    const signals = new EventEmitter();
    const running = cli(['layouts', 'list'], { OPENLDR_URL: srv.url }, signals);
    await waitFor(() => gotGo);
    signals.emit('SIGINT');
    const r = await running;
    expect(r.code).toBe(130);
    expect(r.err).toBe('Stopped.\n');
    await waitFor(() => closed);
    expect(srv.calls).toHaveLength(1);
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });
});

describe('the check before sending', () => {
  /** A leaf with a short flag, a glued value, a variadic positional and a variadic option. */
  function synthetic(): { root: Command; leaf: Command } {
    const root = new Command('openldr').exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} });
    root.option('--actor <name>');
    const leaf = root.command('pack <dir> [extras...]').exitOverride()
      .option('-o, --out <file>').option('-k, --key <file>').option('-v, --verbose').option('--tag <t...>')
      .action(() => {});
    return { root, leaf };
  }
  const meta: CommandMeta = {
    kind: 'app', capability: 'x.y',
    paths: [
      { target: 'dir', kind: 'input-dir' }, { target: 'extras', kind: 'input-file' },
      { target: '--out', kind: 'output-file' }, { target: '--key', kind: 'input-file' },
    ],
  };
  async function parseSynthetic(words: string[]): Promise<{ args: string[]; opts: Record<string, unknown> } | null> {
    const { root, leaf } = synthetic();
    try { await root.parseAsync(words, { from: 'user' }); } catch { return null; }
    return { args: [...leaf.args], opts: { ...leaf.opts() } };
  }
  async function sendSynthetic(words: string[], url: string, reparse = parseSynthetic) {
    const { root, leaf } = synthetic();
    await root.parseAsync(words, { from: 'user' });
    const log: [string, string][] = [];
    const sink = (name: string) => new Writable({ write(c, _e, cb) { log.push([name, Buffer.from(c).toString('utf8')]); cb(); } });
    const code = await runThroughApp({
      path: 'pack', tokens: words.slice(1), meta, command: leaf, parsedArgs: [...leaf.args], parsedOpts: { ...leaf.opts() },
      reparse, url, credential: { kind: 'none', authorization: null },
      out: sink('out'), err: sink('err'), signals: new EventEmitter(),
    });
    return { code, err: log.filter(([k]) => k === 'err').map(([, t]) => t).join('') };
  }

  it('handles a short flag, a glued value, combined flags and variadics', async () => {
    const d = join(dir, 'd');
    await mkdir(d);
    for (const f of ['e1', 'e2', 'k']) await writeFile(join(dir, f), f);
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const words = ['pack', d, join(dir, 'e1'), `-o${join(dir, 'out.txt')}`, '-vk', join(dir, 'k'), '--tag', 'a', 'b'];
    const r = await sendSynthetic(words, srv.url);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const s = start(srv.calls[0]!);
    const argv = s.argv;
    expect(argv[0]).toBe('pack');
    for (const i of [1, 2, 4, 6]) expect(argv[i], String(i)).toMatch(PLACEHOLDER);
    expect([argv[3], argv[5], ...argv.slice(7)]).toEqual(['-o', '-vk', '--tag', 'a', 'b']);
    expect(s.inputs.map((i) => [i.kind, i.name])).toEqual([['input-dir', 'd'], ['input-file', 'e1'], ['input-file', 'k']]);
    expect(s.outputs.map((o) => o.kind)).toEqual(['output-file']);
    expect(argv[4]).toBe(`@@${s.outputs[0]!.ref}`);
    // Every ref is unique.
    expect(new Set([...s.inputs, ...s.outputs].map((x) => x.ref)).size).toBe(4);

    // Two values for the variadic mark make more refs than the command has marks: the server takes
    // one ref per mark, so the client refuses before any request.
    const r2 = await sendSynthetic(['pack', d, join(dir, 'e1'), join(dir, 'e2'), '-o', join(dir, 'out.txt'), '-k', join(dir, 'k')], srv.url);
    expect(r2.err).toBe('This command names more files than the app takes in one call. Run it once for each file.\n');
    expect(r2.code).toBe(1);
    expect(srv.calls).toHaveLength(1);
  });

  it('sends nothing when the rewritten words parse differently', async () => {
    const d = join(dir, 'd');
    await mkdir(d);
    const srv = await startServer(answers({ t: 'exit', code: 0 }));
    const wrong = async (w: string[]) => {
      const got = await parseSynthetic(w);
      return got && { ...got, opts: { ...got.opts, verbose: true } };
    };
    // The same line with an honest check is sent: an absent variadic argument is no path.
    const ok = await sendSynthetic(['pack', d], srv.url);
    expect(ok.code).toBe(0);
    expect(srv.calls).toHaveLength(1);
    const r = await sendSynthetic(['pack', d], srv.url, wrong);
    expect(r.err).toBe('This command line could not be prepared for the app. Nothing was sent.\n');
    expect(r.code).toBe(1);
    const r2 = await sendSynthetic(['pack', d], srv.url, async () => null);
    expect(r2.code).toBe(1);
    expect(srv.calls).toHaveLength(1);
  });

  it('leaves buildProgram() as it was: no --server-url there', () => {
    // The served child and the check before sending both use buildProgram().
    expect(buildProgram().options.map((o) => o.long)).toEqual(['--actor']);
  });
});
