// The switch (Task 12): outside served mode, every `app` command goes through the app, whatever the
// environment holds. Only a recovery command, a local command, or an app command whose table entry
// says this call is local runs in this process.
//
// Every context builder and the database client throw here, and the spies record the call. The
// config loader is the real one behind a spy, so a recovery command reads its settings as it does
// today, and an app command can be shown never to reach it.

import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The real loader, set when @openldr/config is mocked. The spy calls through it, so restoring mocks
// between tests keeps it working.
const realConfig = vi.hoisted(() => ({ load: undefined as undefined | ((env?: NodeJS.ProcessEnv) => unknown) }));
const builders = vi.hoisted(() => {
  const thrower = (name: string) => () => { throw new Error(`${name} must not be called here`); };
  return {
    createAppContext: vi.fn(thrower('createAppContext')),
    createDbContext: vi.fn(thrower('createDbContext')),
    createIngestContext: vi.fn(thrower('createIngestContext')),
    createTerminologyContext: vi.fn(thrower('createTerminologyContext')),
    createInternalDb: vi.fn(thrower('createInternalDb')),
    loadConfig: vi.fn((env: NodeJS.ProcessEnv = process.env) => {
      // A read of a .env file from this worktree would find the operator's dev settings.
      if (env === process.env && process.env.OPENLDR_SKIP_ENV_FILE !== 'true') throw new Error('this test must not read a .env file');
      return realConfig.load!(env);
    }),
  };
});
const commands = vi.hoisted(() => ({ dbMigrate: vi.fn(async () => 0), artifactPublish: vi.fn(async () => 0) }));

vi.mock('@openldr/bootstrap', async (orig) => ({
  ...(await orig<typeof import('@openldr/bootstrap')>()),
  createAppContext: builders.createAppContext,
  createDbContext: builders.createDbContext,
  createIngestContext: builders.createIngestContext,
  createTerminologyContext: builders.createTerminologyContext,
}));
vi.mock('@openldr/config', async (orig) => {
  const real = await orig<typeof import('@openldr/config')>();
  realConfig.load = real.loadConfig;
  return { ...real, loadConfig: builders.loadConfig };
});
vi.mock('@openldr/db', async (orig) => ({
  ...(await orig<typeof import('@openldr/db')>()),
  createInternalDb: builders.createInternalDb,
}));
vi.mock('./db', async (orig) => ({ ...(await orig<typeof import('./db')>()), runDbMigrate: commands.dbMigrate }));
vi.mock('./artifact', async (orig) => ({ ...(await orig<typeof import('./artifact')>()), runArtifactPublish: commands.artifactPublish }));

import { buildClientProgram, buildProgram, commandKindOf, NEEDS_DATABASE } from './program';
import { COMMAND_META, type PathKind } from './command-meta';
import { commandPath, leafCommands } from './command-list';

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(SRC, '..', '..', '..');
const DB_KEYS = ['INTERNAL_DATABASE_URL', 'TARGET_DATABASE_URL', 'SECRETS_ENCRYPTION_KEY'] as const;

interface Run { code: number | undefined; out: string; err: string }

/** Runs the client program over these words, as index.ts does. parseAsync must resolve. */
async function client(words: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  let out = '';
  let err = '';
  const sink = (put: (s: string) => void) => new Writable({ write(c, _e, cb) { put(Buffer.from(c).toString('utf8')); cb(); } });
  const program = buildClientProgram({ out: sink((s) => { out += s; }), err: sink((s) => { err += s; }), signals: new EventEmitter(), env });
  process.exitCode = undefined;
  await program.parseAsync(['node', 'openldr', ...words]);
  const code = process.exitCode as number | undefined;
  process.exitCode = undefined;
  return { code, out, err };
}

/** A port on 127.0.0.1 that nothing listens on: bound by the system, then closed. */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((done) => s.listen(0, '127.0.0.1', done));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((done) => s.close(() => done()));
  return port;
}

/** A server on 127.0.0.1 port 0 that records each request and answers 500. Nothing here should reach it. */
async function recorder() {
  const calls: string[] = [];
  const server = createServer((req: IncomingMessage, res) => { calls.push(`${req.method} ${req.url}`); res.statusCode = 500; res.end(); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
  };
}

function expectNoBuilderCalled(): void {
  for (const [name, fn] of Object.entries(builders)) expect(fn, name).not.toHaveBeenCalled();
}

let dir: string;
let closed: string;
/** Database settings shaped so they would connect if used: real URLs and a real 32-byte key. They
 *  name a closed port and a scratch database name, so a mistake here cannot reach a real database. */
let dbEnv: Record<(typeof DB_KEYS)[number], string>;
const saved = new Map<string, string | undefined>();

beforeAll(async () => {
  for (const k of ['OPENLDR_SKIP_ENV_FILE', ...DB_KEYS]) saved.set(k, process.env[k]);
  process.env.OPENLDR_SKIP_ENV_FILE = 'true';
  const dbPort = await closedPort();
  closed = `http://127.0.0.1:${await closedPort()}`;
  dbEnv = {
    INTERNAL_DATABASE_URL: `postgres://openldr:test@127.0.0.1:${dbPort}/sa_scratch_switch_never`,
    TARGET_DATABASE_URL: `postgres://openldr:test@127.0.0.1:${dbPort}/sa_scratch_switch_never_target`,
    SECRETS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
});
afterAll(() => {
  for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'openldr-switch-'));
  for (const fn of [...Object.values(builders), ...Object.values(commands)]) fn.mockClear();
  for (const k of DB_KEYS) delete process.env[k];
});
afterEach(async () => {
  for (const k of DB_KEYS) delete process.env[k];
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

interface Arg { name(): string; required: boolean; argChoices?: string[] }
interface Opt { long?: string; mandatory: boolean; argChoices?: string[] }

/**
 * The shortest line that parses for this command: each required argument and each required option,
 * with the first allowed value where the values are fixed, '1' otherwise, and a real file or folder
 * where the table marks an input path. `extra` adds words a command's refuse rule asks for.
 */
function lineFor(cmd: Command, path: string, files: { file: string; dir: string; out: string }, extra: string[] = []): string[] {
  const marks = new Map((COMMAND_META[path]!.paths ?? []).map((m) => [m.target, m]));
  const args = (cmd as unknown as { registeredArguments: readonly Arg[] }).registeredArguments.filter((a) => a.required);
  const plain = args.map((a) => a.argChoices?.[0] ?? '1');
  const valueFor = (target: string, value: string): string => {
    const mark = marks.get(target);
    if (!mark) return value;
    const kind: PathKind = typeof mark.kind === 'function' ? mark.kind(plain, {}) : mark.kind;
    if (kind === 'input-file') return files.file;
    if (kind === 'input-dir') return files.dir;
    return join(files.out, target.replace(/^-+/, ''));
  };
  const words = [...path.split(' '), ...args.map((a, i) => valueFor(a.name(), plain[i]!))];
  for (const o of cmd.options as unknown as readonly Opt[]) {
    if (o.mandatory && o.long) words.push(o.long, valueFor(o.long, o.argChoices?.[0] ?? '1'));
  }
  return [...words, ...extra];
}

describe('the switch', () => {
  it('sends an app command through the app even when the database settings are present', async () => {
    const files = { file: join(dir, 'in.txt'), dir: join(dir, 'in-dir'), out: join(dir, 'out') };
    await writeFile(files.file, 'x');
    await mkdir(files.dir);
    await writeFile(join(files.dir, 'a.txt'), 'a');
    // The settings are in both places a command could read them: the environment the client program
    // was given, and process.env, which every command's own loadConfig() reads.
    Object.assign(process.env, dbEnv);
    const env = { OPENLDR_SKIP_ENV_FILE: 'true', OPENLDR_URL: closed, ...dbEnv };
    const expected = `Cannot reach OpenLDR at ${closed}. Is it running?\n`;
    // Words a command's refuse rule needs before it may be sent at all.
    const extra: Record<string, string[]> = { 'sync export': ['--out', join(files.out, 'site.bundle')] };

    const covered: string[] = [];
    const wrong: string[] = [];
    for (const cmd of leafCommands(buildProgram())) {
      const path = commandPath(cmd);
      const meta = COMMAND_META[path]!;
      // artifact publish is the one app command with a local form; it has its own test below.
      if (meta.kind !== 'app' || meta.localWhen) continue;
      const r = await client(lineFor(cmd, path, files, extra[path]), env);
      if (r.err === expected && r.code === 1 && r.out === '') covered.push(path);
      else wrong.push(`${path}: code ${r.code}, ${JSON.stringify(r.err)}`);
    }
    expect(wrong).toEqual([]);
    const appPaths = Object.entries(COMMAND_META).filter(([, m]) => m.kind === 'app' && !m.localWhen).map(([p]) => p).sort();
    expect(covered.sort()).toEqual(appPaths);
    // One from each of several groups, named, so a loop that silently skipped a group would show.
    for (const p of ['plugin install', 'ingest', 'roles list', 'user key create', 'settings flags set', 'terminology import', 'sync export', 'report run']) {
      expect(covered, p).toContain(p);
    }
    expectNoBuilderCalled();
    expect(commands.dbMigrate).not.toHaveBeenCalled();
  });

  it('runs artifact publish on this machine without --install, and through the app with it', async () => {
    const env = { OPENLDR_SKIP_ENV_FILE: 'true', OPENLDR_URL: closed, ...dbEnv };
    Object.assign(process.env, dbEnv);
    const bundle = join(dir, 'bundle');
    await mkdir(bundle);
    await writeFile(join(bundle, 'manifest.json'), '{}');

    const local = await client(['artifact', 'publish', bundle, '--to', join(dir, 'registry')], env);
    expect(commands.artifactPublish).toHaveBeenCalledTimes(1);
    expect(local.err).toBe('');

    const sent = await client(['artifact', 'publish', bundle, '--to', join(dir, 'registry'), '--install'], env);
    expect(sent.err).toBe(`Cannot reach OpenLDR at ${closed}. Is it running?\n`);
    expect(sent.code).toBe(1);
    expect(commands.artifactPublish).toHaveBeenCalledTimes(1);
    expectNoBuilderCalled();
  });

  it('runs a recovery command in-process, and explains itself without database settings', async () => {
    const srv = await recorder();
    try {
      const base = { OPENLDR_SKIP_ENV_FILE: 'true', OPENLDR_URL: srv.url };
      // With the settings: run here, as today, --actor included. Nothing is sent.
      const r = await client(['db', 'migrate'], { ...base, ...dbEnv });
      expect(commands.dbMigrate).toHaveBeenCalledTimes(1);
      expect(r).toEqual({ code: 0, out: '', err: '' });
      const withActor = await client(['--actor', 'ops-bob', 'db', 'migrate'], { ...base, ...dbEnv });
      expect(commands.dbMigrate).toHaveBeenCalledTimes(2);
      expect(withActor.err).toBe('');

      // Without them: one line, exit 1, and the command never starts.
      for (const words of [['db', 'migrate'], ['doctor'], ['user', 'reset-password', 'someone'], ['auth', 'setup-code']]) {
        const none = await client(words, base);
        expect(none, words.join(' ')).toEqual({ code: 1, out: '', err: `${NEEDS_DATABASE}\n` });
      }
      expect(NEEDS_DATABASE).toBe('This command works on the database itself. Run it on the machine that runs OpenLDR.');
      expect(await client(['db', 'migrate'], { ...base, INTERNAL_DATABASE_URL: '  ' })).toMatchObject({ code: 1, err: `${NEEDS_DATABASE}\n` });
      expect(commands.dbMigrate).toHaveBeenCalledTimes(2);
      expect(srv.calls).toEqual([]);
    } finally {
      await srv.close();
    }
  });

  it('keeps today\'s message for any other configuration mistake in a recovery command', async () => {
    // The command reads process.env itself, so the settings go there, as they would in real use.
    // The database settings are present; another setting is wrong.
    const before = process.env.TARGET_STORE_ADAPTER;
    Object.assign(process.env, dbEnv, { TARGET_STORE_ADAPTER: 'not-a-store' });
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => { stderr += String(chunk); return true; });
    try {
      const r = await client(['health'], process.env);
      expect(r.code).toBe(1);
      expect(r.err).toBe('');
    } finally {
      if (before === undefined) delete process.env.TARGET_STORE_ADAPTER; else process.env.TARGET_STORE_ADAPTER = before;
    }
    expect(stderr).toContain('health failed: Invalid configuration');
    expect(stderr).toContain('TARGET_STORE_ADAPTER');
    expect(stderr).not.toContain(NEEDS_DATABASE);
    expect(builders.createAppContext).not.toHaveBeenCalled();
  });

  // The brief names this test after the variable; the name is spelt out in parts here, so this file
  // does not count as a reference itself.
  it('has no reference to the temporary switch variable left in the source', async () => {
    const name = ['OPENLDR', 'THROUGH', 'APP'].join('_');
    const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'artifacts', 'target', 'coverage', '.git']);
    // The plan is the record of what each task was told to do, Task 10's temporary switch included.
    const RECORD = join('docs', 'superpowers', 'plans', '2026-11-13-cli-through-the-app.md');
    const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|sh|ps1|ya?ml)$/;
    const found: string[] = [];
    let read = 0;
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const full = join(folder, entry.name);
        if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) await walk(full); continue; }
        if (!entry.isFile() || !TEXT.test(entry.name) || relative(REPO, full) === RECORD) continue;
        read += 1;
        if ((await readFile(full, 'utf8')).includes(name)) found.push(relative(REPO, full).split(sep).join('/'));
      }
    };
    for (const top of ['packages', 'apps', 'docs', 'install', 'scripts', 'e2e']) await walk(join(REPO, top));
    for (const file of ['package.json', 'README.md']) {
      read += 1;
      if ((await readFile(join(REPO, file), 'utf8')).includes(name)) found.push(file);
    }
    expect(found).toEqual([]);
    // The walk must have read the CLI's own source, or it proved nothing.
    expect(read).toBeGreaterThan(500);
  });
});

describe('commandKindOf', () => {
  it('names the kind of the command the words name, and null for help or an unknown command', async () => {
    expect(await commandKindOf(['db', 'migrate'])).toBe('recovery');
    expect(await commandKindOf(['--actor', 'ops-bob', 'user', 'reset-password', 'someone'])).toBe('recovery');
    expect(await commandKindOf(['--server-url', closed, 'doctor', '--json'])).toBe('recovery');
    expect(await commandKindOf(['layouts', 'list', '--json'])).toBe('app');
    expect(await commandKindOf(['artifact', 'keygen', '--out', dir])).toBe('local');
    for (const words of [[], ['--help'], ['db', '--help'], ['db', 'migrate', '--help'], ['help', 'db'], ['not-a-command'], ['db', 'migrate', '--no-such-option']]) {
      expect(await commandKindOf(words), words.join(' ')).toBeNull();
    }
    expect(commands.dbMigrate).not.toHaveBeenCalled();
    expectNoBuilderCalled();
  });
});
