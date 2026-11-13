import { chmod, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// No command may reach a database here. loadConfig throws, so a slip fails loudly instead of
// reading the dev .env.
vi.mock('@openldr/config', async (orig) => ({
  ...(await orig<typeof import('@openldr/config')>()),
  loadConfig: () => { throw new Error('loadConfig must not be called in this test'); },
}));

import { buildClientProgram } from '../program';
import { CredentialError, findCredential } from './credentials';
import { runLogin, runLogout, runWhoami, sessionFilePath, type LoginIo } from './session';

// Made-up values. The spaces show that nothing is trimmed from a password.
const PASSWORD = ' pw-Test 1 ';
const COOKIE_A = 'sidA.cookieSecretAAAAAAAA';
const COOKIE_B = 'sidB.cookieSecretBBBBBBBB';
const COOKIE_NEW = 'sidA.cookieSecretRENEWED1';
const TOKEN_A = 'tokenAAAA.accessAAAA.sigAAAA';
const TOKEN_B = 'tokenBBBB.accessBBBB.sigBBBB';
const KEY = 'oldr_TESTKEYtestkeyTESTKEYtestkeyTESTKEYtes';
const NAME = 'openldr_session';

const NOT_LOCAL = 'This install signs in through another service. Use an access key: set OPENLDR_KEY.';
const MUST_CHANGE = 'Change your password in Studio first, then sign in again.';
const WRONG = 'The username or password is wrong, or the account is locked or disabled.';
const TOO_MANY = 'Too many attempts. Wait a while and try again.';

interface Call { method: string; path: string; headers: IncomingHttpHeaders; body: string }

/** What the fake app does. Tests change it between calls. */
interface Behaviour {
  mode: string;
  cookie: string;
  token: string;
  mustChange?: boolean;
  loginStatus?: number;
  dropLogin?: boolean;
  redirectLoginTo?: string;
  refreshStatus?: number;
  rotateTo?: string;
}

const apps: { close: () => Promise<void> }[] = [];

/** A small stand-in for the app's sign-in routes, on 127.0.0.1 port 0. */
async function startApp(initial: Partial<Behaviour> = {}) {
  const b: Behaviour = { mode: 'local', cookie: COOKIE_A, token: TOKEN_A, ...initial };
  const calls: Call[] = [];
  const live = new Set<string>();
  const tokens = new Set<string>();
  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const clear = `${NAME}=; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=0`;
  const cookieOf = (h: IncomingHttpHeaders) => /(?:^|;\s*)openldr_session=([^;]*)/.exec(h.cookie ?? '')?.[1] ?? null;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      const call: Call = { method: req.method ?? '', path: req.url ?? '', headers: req.headers, body: Buffer.concat(parts).toString('utf8') };
      calls.push(call);
      const route = `${call.method} ${call.path}`;
      if (route === 'GET /api/config') return json(res, 200, { auth: { mode: b.mode, setupRequired: false } });
      if (route === 'POST /api/auth/login') {
        if (b.dropLogin) { req.socket.destroy(); return; }
        if (b.redirectLoginTo) { res.writeHead(307, { location: `${b.redirectLoginTo}/api/auth/login` }); res.end(); return; }
        let body: { username?: string; password?: string } = {};
        try { body = JSON.parse(call.body) as typeof body; } catch { /* stays empty */ }
        // A careless server could echo the password in an error. The client must never print it.
        if (b.loginStatus) return json(res, b.loginStatus, { error: `failed for ${body.password ?? ''}` });
        if (body.username !== 'alice' || body.password !== PASSWORD) return json(res, 401, { error: 'invalid_credentials' });
        live.add(b.cookie);
        tokens.add(b.token);
        return json(res, 200, { accessToken: b.token, expiresIn: 900, mustChangePassword: b.mustChange === true }, {
          'set-cookie': `${NAME}=${b.cookie}; Path=/api/auth; HttpOnly; SameSite=Strict`,
        });
      }
      if (route === 'POST /api/auth/refresh') {
        if (b.refreshStatus) return json(res, b.refreshStatus, { error: 'boom' });
        const c = cookieOf(call.headers);
        if (!c || !live.has(c)) return json(res, 401, { error: 'session_ended' }, { 'set-cookie': clear });
        const headers: Record<string, string> = {};
        if (b.rotateTo) {
          live.delete(c);
          live.add(b.rotateTo);
          headers['set-cookie'] = `${NAME}=${b.rotateTo}; Path=/api/auth; HttpOnly; SameSite=Strict`;
        }
        return json(res, 200, { accessToken: b.token, expiresIn: 900, mustChangePassword: false }, headers);
      }
      if (route === 'POST /api/auth/logout') {
        const c = cookieOf(call.headers);
        if (c) live.delete(c);
        res.writeHead(204, { 'set-cookie': clear });
        res.end();
        return;
      }
      if (route === 'GET /api/me') {
        const auth = call.headers.authorization ?? '';
        if (auth === `Bearer ${KEY}`) {
          return json(res, 200, { id: 'u1', username: 'alice', displayName: 'Alice', roles: ['lab_admin'], capabilities: [], accessKey: { id: 'k1', name: 'ci-runner' } });
        }
        if (auth.startsWith('Bearer ') && tokens.has(auth.slice(7))) {
          return json(res, 200, { id: 'u1', username: 'alice', displayName: 'Alice', roles: ['lab_admin', 'viewer'], capabilities: [] });
        }
        return json(res, 401, { error: 'authentication required' });
      }
      return json(res, 404, { error: 'not found' });
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  const handle = {
    url: `http://127.0.0.1:${port}`,
    calls,
    b,
    live,
    paths: () => calls.map((c) => `${c.method} ${c.path}`),
    close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
  };
  apps.push(handle);
  return handle;
}

let home: string;
let cfg: string;
let file: string;
const env = (): NodeJS.ProcessEnv => ({ XDG_CONFIG_HOME: cfg });
const place = () => ({ platform: 'linux' as const, homedir: home });

/** Everything the commands printed in this test, for the never-printed checks. */
let printed = '';

function makeIo(over: { input?: string; tty?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  let out = '';
  let err = '';
  const sink = (add: (s: string) => void) => new Writable({ write(c, _e, cb) { const s = Buffer.from(c).toString('utf8'); add(s); printed += s; cb(); } });
  const stdin = new PassThrough();
  const raw = vi.fn();
  if (over.tty) Object.assign(stdin, { isTTY: true, setRawMode: raw });
  if (over.input !== undefined) stdin.end(over.input);
  const io: LoginIo = {
    env: over.env ?? env(), platform: 'linux', homedir: home, stdin,
    out: sink((s) => { out += s; }), err: sink((s) => { err += s; }),
  };
  return { io, stdin, raw, out: () => out, err: () => err };
}

async function login(url: string, input = `${PASSWORD}\n`, extra: { username?: string } = {}) {
  const t = makeIo({ input });
  const code = await runLogin({ url, username: extra.username ?? 'alice', passwordStdin: true }, t.io);
  return { code, out: t.out(), err: t.err() };
}

async function readSessionFile(): Promise<{ sessions: Record<string, { cookie: { name: string; value: string }; username: string | null; savedAt: string }> }> {
  return JSON.parse(await readFile(file, 'utf8')) as never;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'openldr-session-'));
  cfg = join(home, 'config');
  file = join(cfg, 'openldr', 'session.json');
  printed = '';
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  await rm(home, { recursive: true, force: true });
});

describe('sessionFilePath', () => {
  it('puts the session file in the right place on each platform', () => {
    expect(sessionFilePath({ XDG_CONFIG_HOME: '/x/cfg' }, 'linux', '/home/u')).toBe('/x/cfg/openldr/session.json');
    expect(sessionFilePath({}, 'linux', '/home/u')).toBe('/home/u/.config/openldr/session.json');
    expect(sessionFilePath({ XDG_CONFIG_HOME: '' }, 'linux', '/home/u')).toBe('/home/u/.config/openldr/session.json');
    // The XDG rules ignore a relative folder.
    expect(sessionFilePath({ XDG_CONFIG_HOME: 'rel/cfg' }, 'linux', '/home/u')).toBe('/home/u/.config/openldr/session.json');
    expect(sessionFilePath({ XDG_CONFIG_HOME: '/x/cfg' }, 'freebsd', '/home/u')).toBe('/x/cfg/openldr/session.json');
    expect(sessionFilePath({ XDG_CONFIG_HOME: '/x/cfg' }, 'darwin', '/Users/u')).toBe('/Users/u/Library/Application Support/OpenLDR/session.json');
    expect(sessionFilePath({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32', 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Roaming\\OpenLDR\\session.json');
    expect(sessionFilePath({}, 'win32', 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Roaming\\OpenLDR\\session.json');
  });
});

describe('login', () => {
  it('signs in, stores the session owner-only, and signs later requests', async () => {
    const app = await startApp();
    const r = await login(app.url);
    expect(r).toEqual({ code: 0, out: `Signed in to ${app.url} as alice.\n`, err: '' });
    expect(app.paths()).toEqual(['GET /api/config', 'POST /api/auth/login', 'GET /api/me']);
    expect(JSON.parse(app.calls[1]!.body)).toEqual({ username: 'alice', password: PASSWORD });

    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(cfg, 'openldr'))).mode & 0o777).toBe(0o700);
    // No temporary file is left beside it.
    expect(await readdir(join(cfg, 'openldr'))).toEqual(['session.json']);
    const saved = await readSessionFile();
    expect(Object.keys(saved.sessions)).toEqual([app.url]);
    expect(saved.sessions[app.url]).toMatchObject({ cookie: { name: NAME, value: COOKIE_A }, username: 'alice' });
    // The file holds no access token and no password.
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain(TOKEN_A);
    expect(text).not.toContain(PASSWORD);

    // A later command refreshes with the cookie and signs with the token it gets back.
    expect(await findCredential(env(), app.url, place())).toEqual({ kind: 'session', authorization: `Bearer ${TOKEN_A}` });
    const refresh = app.calls.at(-1)!;
    expect(`${refresh.method} ${refresh.path}`).toBe('POST /api/auth/refresh');
    expect(refresh.headers.cookie).toBe(`${NAME}=${COOKIE_A}`);

    const w = makeIo();
    expect(await runWhoami({ url: app.url, json: false }, w.io)).toBe(0);
    expect(w.out()).toBe('Username: alice\nRoles: lab_admin, viewer\nSigned in with: session\n');
    expect(app.calls.at(-1)!.headers.authorization).toBe(`Bearer ${TOKEN_A}`);
  });

  it('treats an address with or without a trailing slash as one server', async () => {
    const app = await startApp();
    expect((await login(`${app.url}/`)).code).toBe(0);
    expect(Object.keys((await readSessionFile()).sessions)).toEqual([app.url]);
    expect((await findCredential(env(), app.url, place())).kind).toBe('session');
  });

  it('reads the password from standard input and never from an argument', async () => {
    const app = await startApp();
    // One line: the trailing newline is dropped, the spaces are kept, and the rest is not read.
    expect((await login(app.url, `${PASSWORD}\nsecond line\n`)).code).toBe(0);
    expect(JSON.parse(app.calls[1]!.body).password).toBe(PASSWORD);

    // A CRLF line end counts as the newline.
    const app2 = await startApp();
    expect((await login(app2.url, `${PASSWORD}\r\n`)).code).toBe(0);
    expect(JSON.parse(app2.calls[1]!.body).password).toBe(PASSWORD);

    // The command has no --password option, and commander refuses one.
    const program = buildClientProgram({ env: {} });
    const cmd = program.commands.find((c) => c.name() === 'login')!;
    expect(cmd.options.map((o) => o.long).sort()).toEqual(['--password-stdin', '--username']);
    cmd.exitOverride();
    cmd.configureOutput({ writeOut: () => {}, writeErr: () => {}, outputError: () => {} });
    program.exitOverride();
    await expect(program.parseAsync(['login', '--password', 'x'], { from: 'user' })).rejects.toThrow(/unknown option/);
  });

  it('asks for the password with no echo on a terminal', async () => {
    const app = await startApp();
    const t = makeIo({ tty: true });
    const done = runLogin({ url: app.url, username: 'alice', passwordStdin: false }, t.io);
    await vi.waitFor(() => expect(t.err()).toContain('Password: '));
    expect(t.raw).toHaveBeenLastCalledWith(true);
    // Typed with a mistake, rubbed out, then Enter.
    t.stdin.write(`${PASSWORD}x\u007f\r`);
    expect(await done).toBe(0);
    expect(t.raw.mock.calls).toEqual([[true], [false]]);
    expect(JSON.parse(app.calls[1]!.body).password).toBe(PASSWORD);
    expect(t.out() + t.err()).not.toContain(PASSWORD.trim());
  });

  it('asks for the username on a terminal when --username is absent', async () => {
    const app = await startApp();
    const t = makeIo({ tty: true });
    const done = runLogin({ url: app.url, passwordStdin: false }, t.io);
    await vi.waitFor(() => expect(t.err()).toContain('Username: '));
    t.stdin.write('alice\n');
    await vi.waitFor(() => expect(t.err()).toContain('Password: '));
    t.stdin.write(`${PASSWORD}\r`);
    expect(await done).toBe(0);
    expect(JSON.parse(app.calls[1]!.body)).toEqual({ username: 'alice', password: PASSWORD });
  });

  it('refuses to ask for a password when standard input is not a terminal, naming --password-stdin', async () => {
    const app = await startApp();
    const t = makeIo({ input: `${PASSWORD}\n` });
    expect(await runLogin({ url: app.url, username: 'alice', passwordStdin: false }, t.io)).toBe(1);
    expect(t.err()).toContain('--password-stdin');
    expect(t.err().split('\n').filter(Boolean)).toHaveLength(1);
    expect(app.calls).toEqual([]);
  });

  it('refuses --password-stdin on a terminal, where the password would echo', async () => {
    const app = await startApp();
    const t = makeIo({ tty: true });
    expect(await runLogin({ url: app.url, username: 'alice', passwordStdin: true }, t.io)).toBe(1);
    expect(t.err()).toContain('--password-stdin');
    expect(t.raw).not.toHaveBeenCalled();
    expect(app.calls).toEqual([]);
  });

  it('refuses on an install without local sign-in, with the message', async () => {
    const app = await startApp({ mode: 'keycloak' });
    const t = makeIo({ input: `${PASSWORD}\n` });
    expect(await runLogin({ url: app.url, username: 'alice', passwordStdin: true }, t.io)).toBe(1);
    expect(t.err()).toBe(`${NOT_LOCAL}\n`);
    expect(app.paths()).toEqual(['GET /api/config']);
    // The password was never read.
    expect(t.stdin.readableLength).toBeGreaterThan(0);
    await expect(stat(file)).rejects.toThrow();
  });

  it('refuses when the password must be changed and stores nothing', async () => {
    const app = await startApp({ mustChange: true });
    const r = await login(app.url);
    expect(r).toEqual({ code: 1, out: '', err: `${MUST_CHANGE}\n` });
    await expect(stat(file)).rejects.toThrow();
    // The session the server just made is ended with its own cookie.
    expect(app.paths()).toEqual(['GET /api/config', 'POST /api/auth/login', 'POST /api/auth/logout']);
    expect(app.calls[2]!.headers.cookie).toBe(`${NAME}=${COOKIE_A}`);
    expect(app.live.size).toBe(0);
  });

  it('says what a wrong password, a lock and a rate limit mean', async () => {
    const app = await startApp();
    expect(await login(app.url, 'wrong\n')).toEqual({ code: 1, out: '', err: `${WRONG}\n` });
    app.b.loginStatus = 429;
    expect(await login(app.url)).toEqual({ code: 1, out: '', err: `${TOO_MANY}\n` });
    await expect(stat(file)).rejects.toThrow();
  });

  it('refuses a redirect and sends nothing to the other address', async () => {
    const other = await startApp();
    const app = await startApp({ redirectLoginTo: other.url });
    const r = await login(app.url);
    expect(r.code).toBe(1);
    expect(r.err).toContain('redirect');
    expect(other.calls).toEqual([]);
  });

  it('refuses plain HTTP to another machine before anything is sent', async () => {
    const t = makeIo({ input: `${PASSWORD}\n` });
    expect(await runLogin({ url: 'http://lab.example:3000', username: 'alice', passwordStdin: true }, t.io)).toBe(1);
    expect(t.err()).toContain('OPENLDR_ALLOW_PLAIN_HTTP');
  });

  it('ignores OPENLDR_KEY: it signs a person in', async () => {
    const app = await startApp();
    const t = makeIo({ input: `${PASSWORD}\n`, env: { ...env(), OPENLDR_KEY: KEY } });
    expect(await runLogin({ url: app.url, username: 'alice', passwordStdin: true }, t.io)).toBe(0);
    expect(app.calls.some((c) => c.headers.authorization === `Bearer ${KEY}`)).toBe(false);
  });
});

describe('the session in findCredential', () => {
  it('stores a new session value when refresh gives one', async () => {
    const app = await startApp();
    expect((await login(app.url)).code).toBe(0);
    app.b.rotateTo = COOKIE_NEW;
    expect((await findCredential(env(), app.url, place())).kind).toBe('session');
    expect((await readSessionFile()).sessions[app.url]!.cookie.value).toBe(COOKIE_NEW);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    // The next refresh sends the new value.
    app.b.rotateTo = undefined;
    expect((await findCredential(env(), app.url, place())).kind).toBe('session');
    expect(app.calls.at(-1)!.headers.cookie).toBe(`${NAME}=${COOKIE_NEW}`);
  });

  it('removes the entry when refresh is refused', async () => {
    const app = await startApp();
    expect((await login(app.url)).code).toBe(0);
    app.live.clear();
    expect(await findCredential(env(), app.url, place())).toEqual({ kind: 'none', authorization: null });
    await expect(stat(file)).rejects.toThrow();
  });

  it('keeps the entry and fails with the connection message when the server cannot be reached', async () => {
    const app = await startApp();
    expect((await login(app.url)).code).toBe(0);
    await app.close();
    const e = await findCredential(env(), app.url, place()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CredentialError);
    expect((e as Error).message).toBe(`Cannot reach OpenLDR at ${app.url}. Is it running?`);
    expect(Object.keys((await readSessionFile()).sessions)).toEqual([app.url]);
  });

  it('keeps the entry on a server error', async () => {
    const app = await startApp();
    expect((await login(app.url)).code).toBe(0);
    app.b.refreshStatus = 500;
    await expect(findCredential(env(), app.url, place())).rejects.toThrow('OpenLDR answered with status 500.');
    expect(Object.keys((await readSessionFile()).sessions)).toEqual([app.url]);
  });

  it('puts a key first, and never falls through to the session from an empty key variable', async () => {
    const app = await startApp();
    expect((await login(app.url)).code).toBe(0);
    const before = app.calls.length;
    expect(await findCredential({ ...env(), OPENLDR_KEY: KEY }, app.url, place())).toEqual({ kind: 'key', authorization: `Bearer ${KEY}` });
    await expect(findCredential({ ...env(), OPENLDR_KEY: '' }, app.url, place())).rejects.toThrow('OPENLDR_KEY is set but empty');
    await expect(findCredential({ ...env(), OPENLDR_KEY_FILE: '' }, app.url, place())).rejects.toThrow('OPENLDR_KEY_FILE is set but empty');
    // None of those refreshed the session.
    expect(app.calls.length).toBe(before);
  });

  it('refuses a session file that other users can read, naming the file', async () => {
    const app = await startApp();
    expect((await login(app.url)).code).toBe(0);
    await chmod(file, 0o644);
    const e = await findCredential(env(), app.url, place()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CredentialError);
    expect((e as Error).message).toContain(file);
    const before = app.calls.length;
    const w = makeIo();
    expect(await runWhoami({ url: app.url, json: false }, w.io)).toBe(1);
    expect(w.err()).toContain(file);
    const o = makeIo();
    expect(await runLogout({ url: app.url }, o.io)).toBe(1);
    expect(o.err()).toContain(file);
    // The cookie went nowhere.
    expect(app.calls.length).toBe(before);
  });

  it('keeps separate sessions for two server addresses', async () => {
    const a = await startApp();
    const b = await startApp({ cookie: COOKIE_B, token: TOKEN_B });
    expect((await login(a.url)).code).toBe(0);
    expect((await login(b.url)).code).toBe(0);
    const saved = await readSessionFile();
    expect(saved.sessions[a.url]!.cookie.value).toBe(COOKIE_A);
    expect(saved.sessions[b.url]!.cookie.value).toBe(COOKIE_B);
    expect(await findCredential(env(), a.url, place())).toEqual({ kind: 'session', authorization: `Bearer ${TOKEN_A}` });
    expect(await findCredential(env(), b.url, place())).toEqual({ kind: 'session', authorization: `Bearer ${TOKEN_B}` });
    expect(a.calls.at(-1)!.headers.cookie).toBe(`${NAME}=${COOKIE_A}`);
    expect(b.calls.at(-1)!.headers.cookie).toBe(`${NAME}=${COOKIE_B}`);

    const t = makeIo();
    expect(await runLogout({ url: a.url }, t.io)).toBe(0);
    expect(Object.keys((await readSessionFile()).sessions)).toEqual([b.url]);
    expect((await findCredential(env(), b.url, place())).kind).toBe('session');
  });
});

describe('logout', () => {
  it('ends the session on the server and removes the entry', async () => {
    const app = await startApp();
    expect((await login(app.url)).code).toBe(0);
    const t = makeIo();
    expect(await runLogout({ url: app.url }, t.io)).toBe(0);
    expect(t.out()).toBe(`Signed out of ${app.url}.\n`);
    expect(app.calls.at(-1)!.headers.cookie).toBe(`${NAME}=${COOKIE_A}`);
    expect(app.live.size).toBe(0);
    await expect(stat(file)).rejects.toThrow();
  });

  it('logs out and removes the entry even when the server is down', async () => {
    const app = await startApp();
    expect((await login(app.url)).code).toBe(0);
    await app.close();
    const t = makeIo();
    expect(await runLogout({ url: app.url }, t.io)).toBe(1);
    expect(t.err()).toContain(`Cannot reach OpenLDR at ${app.url}`);
    expect(t.err()).toContain('removed from this machine');
    await expect(stat(file)).rejects.toThrow();
  });

  it('says so and exits 0 when there is no session', async () => {
    const app = await startApp();
    const t = makeIo();
    expect(await runLogout({ url: app.url }, t.io)).toBe(0);
    expect(t.out()).toBe(`Not signed in to ${app.url}.\n`);
    expect(app.calls).toEqual([]);
  });
});

describe('whoami', () => {
  it('names a key and its name', async () => {
    const app = await startApp();
    const t = makeIo({ env: { ...env(), OPENLDR_KEY: KEY } });
    expect(await runWhoami({ url: app.url, json: false }, t.io)).toBe(0);
    expect(t.out()).toBe('Username: alice\nRoles: lab_admin\nSigned in with: key (ci-runner)\n');
    const j = makeIo({ env: { ...env(), OPENLDR_KEY: KEY } });
    expect(await runWhoami({ url: app.url, json: true }, j.io)).toBe(0);
    expect(JSON.parse(j.out())).toEqual({ username: 'alice', roles: ['lab_admin'], signedInWith: 'key', key: { name: 'ci-runner' } });
    expect(j.out().trim().split('\n')).toHaveLength(1);
  });

  it('prints the sign-in message on a 401', async () => {
    const app = await startApp();
    const t = makeIo();
    expect(await runWhoami({ url: app.url, json: false }, t.io)).toBe(1);
    expect(t.err()).toBe('Sign in first: openldr login, or set OPENLDR_KEY.\n');
    expect(app.calls[0]!.headers.authorization).toBeUndefined();
  });
});

describe('secrets', () => {
  it('never writes the password or the session value to standard output or standard error', async () => {
    const app = await startApp();
    // Success, then every command that uses the session.
    expect((await login(app.url)).code).toBe(0);
    await runWhoami({ url: app.url, json: false }, makeIo().io);
    await runWhoami({ url: app.url, json: true }, makeIo().io);
    // A refresh the server fails.
    app.b.refreshStatus = 500;
    expect(await runWhoami({ url: app.url, json: false }, makeIo().io)).toBe(1);
    app.b.refreshStatus = undefined;
    // A wrong password.
    expect((await login(app.url, `${PASSWORD}x\n`)).code).toBe(1);
    // A server error whose body echoes the password.
    app.b.loginStatus = 500;
    expect((await login(app.url)).code).toBe(1);
    app.b.loginStatus = undefined;
    // A dropped connection.
    app.b.dropLogin = true;
    expect((await login(app.url)).code).toBe(1);
    app.b.dropLogin = false;
    // A password that must be changed.
    app.b.mustChange = true;
    expect((await login(app.url)).code).toBe(1);
    app.b.mustChange = false;
    // Logout, then logout with the server gone.
    expect((await login(app.url)).code).toBe(0);
    expect(await runLogout({ url: app.url }, makeIo().io)).toBe(0);
    expect((await login(app.url)).code).toBe(0);
    await app.close();
    expect(await runWhoami({ url: app.url, json: false }, makeIo().io)).toBe(1);
    expect(await runLogout({ url: app.url }, makeIo().io)).toBe(1);

    expect(printed).not.toBe('');
    for (const secret of [PASSWORD, PASSWORD.trim(), COOKIE_A, TOKEN_A, 'cookieSecret', 'pw-Test']) {
      expect(printed, secret).not.toContain(secret);
    }
  });
});
