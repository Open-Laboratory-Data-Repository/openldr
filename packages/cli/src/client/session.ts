// `openldr login`, `logout` and `whoami` (spec section 6.2).
//
// The password is asked for with no echo, on a terminal only, or read as one line from standard
// input with --password-stdin. It goes only into the body of POST /api/auth/login. It is never
// printed, logged or stored, and it is never put in a message: no message here quotes the server's
// answer to a sign-in, which could echo it.
//
// The typed username is never printed or stored either. People type passwords into the username
// field, so the name shown and kept is the account's own, from GET /api/me.

import { assertSafeUrl, CredentialError, findCredential, PlainHttpError } from './credentials';
import { clean, connectionMessage, errorCode, jsonOf, REDIRECT_MESSAGE, requestOnce, shown, SIGN_IN_FIRST, type Answer } from './request';
import {
  cookieHeader, isHeaderSafe, MUST_CHANGE_PASSWORD, readEntry, removeEntry, saveEntry, sessionCookieFrom, SessionError, sessionFileFor,
  UNREADABLE_ANSWER, type SessionCookie, type SessionPlace,
} from './session-file';

export { sessionFilePath } from './session-file';

export const NOT_LOCAL_SIGN_IN = 'This install signs in through another service. Use an access key: set OPENLDR_KEY.';
export const WRONG_SIGN_IN = 'The username or password is wrong, or the account is locked or disabled.';
export const TOO_MANY_ATTEMPTS = 'Too many attempts. Wait a while and try again.';
const CANCELLED = 'Sign-in cancelled.';
const UNREADABLE = 'OpenLDR sent an answer this client cannot read.';

/** Standard input as these commands use it. A terminal has isTTY and setRawMode. */
export interface PromptInput extends NodeJS.EventEmitter {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
}

export interface LoginIo {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** The home folder the session file is found from (homeOf in session-file.ts). */
  homedir: string;
  stdin: PromptInput;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
}

const placeOf = (io: LoginIo): SessionPlace => ({ platform: io.platform, homedir: io.homedir });
const failWith = (io: LoginIo) => (message: string): number => {
  io.err.write(`${message}\n`);
  return 1;
};

// ---------------------------------------------------------------------------------------------
// Reading from standard input
// ---------------------------------------------------------------------------------------------

/** A line longer than this is not a username or a password. */
const MAX_LINE_BYTES = 64 * 1024;

interface Line { bytes: Buffer; endedByNewline: boolean }

/** The bytes before the first newline, or all of them when the input ends first. 'too-long' past
 *  MAX_LINE_BYTES, null when the input fails. Reads nothing after the newline. */
function readLine(input: PromptInput): Promise<Line | 'too-long' | null> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let total = 0;
    const finish = (v: Line | 'too-long' | null) => {
      input.off('data', onData);
      input.off('end', onEnd);
      input.off('error', onError);
      input.pause();
      resolve(v);
    };
    const onData = (chunk: Buffer | string) => {
      const b = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      const nl = b.indexOf(0x0a);
      const part = nl >= 0 ? b.subarray(0, nl) : b;
      total += part.length;
      if (total > MAX_LINE_BYTES) { finish('too-long'); return; }
      parts.push(part);
      if (nl >= 0) finish({ bytes: Buffer.concat(parts), endedByNewline: true });
    };
    const onEnd = () => finish({ bytes: Buffer.concat(parts), endedByNewline: false });
    const onError = () => finish(null);
    input.on('data', onData);
    input.on('end', onEnd);
    input.on('error', onError);
    input.resume();
  });
}

/** The password from a line: the newline (LF or CRLF) is dropped and nothing else is trimmed. */
function passwordOf(line: Line): string {
  const b = line.endedByNewline && line.bytes.at(-1) === 0x0d ? line.bytes.subarray(0, -1) : line.bytes;
  return b.toString('utf8');
}

/**
 * Asks on a terminal with echo off. Raw mode turns the terminal's echo off, and nothing is echoed
 * here. Reads key by key: Enter ends, Backspace rubs out, Ctrl+U clears, Ctrl+C cancels, and Ctrl+D
 * cancels on an empty line. Null when cancelled or when the input ends. Raw mode is turned off again
 * whatever happens.
 */
async function askHidden(input: PromptInput, setRawMode: (mode: boolean) => unknown, err: NodeJS.WritableStream, prompt: string): Promise<string | null> {
  err.write(prompt);
  setRawMode(true);
  try {
    return await new Promise<string | null>((resolve) => {
      const decoder = new TextDecoder();
      let text = '';
      const finish = (v: string | null) => {
        input.off('data', onData);
        input.off('end', onEnd);
        input.off('error', onEnd);
        resolve(v);
      };
      const onEnd = () => finish(null);
      const onData = (chunk: Buffer | string) => {
        const s = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        for (const ch of s) {
          if (ch === '\r' || ch === '\n') { finish(text); return; }
          if (ch === '\u0003') { finish(null); return; }
          if (ch === '\u0004') {
            if (text === '') { finish(null); return; }
            continue;
          }
          if (ch === '\u007f' || ch === '\b') { text = Array.from(text).slice(0, -1).join(''); continue; }
          if (ch === '\u0015') { text = ''; continue; }
          if (ch < ' ') continue;
          text += ch;
        }
      };
      input.on('data', onData);
      input.on('end', onEnd);
      input.on('error', onEnd);
      input.resume();
    });
  } finally {
    setRawMode(false);
    input.pause();
    err.write('\n');
  }
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

function answerProblem(status: number): string {
  if (status >= 300 && status < 400) return REDIRECT_MESSAGE;
  return `OpenLDR answered with status ${status}.`;
}

/** Ends the session that holds this cookie. Null when the server said so, else what went wrong. */
async function endSession(url: string, cookie: SessionCookie): Promise<string | null> {
  try {
    const answer = await requestOnce(url, 'api/auth/logout', { method: 'POST', headers: { cookie: cookieHeader(cookie) } });
    return answer.status >= 200 && answer.status < 300 ? null : answerProblem(answer.status);
  } catch (e) {
    return connectionMessage(url, errorCode(e));
  }
}

/** The account's own username, from GET /api/me with this token. Null when it cannot be had. */
async function accountName(url: string, token: string): Promise<string | null> {
  try {
    const answer = await requestOnce(url, 'api/me', { method: 'GET', headers: { authorization: `Bearer ${token}` } });
    const name = answer.status === 200 ? jsonOf(answer)?.username : undefined;
    return typeof name === 'string' && name !== '' ? clean(name) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------------------------

/**
 * Signs a person in and keeps the session for this server. Ignores OPENLDR_KEY: it signs a person
 * in. Nothing is asked for until the address is checked and the server says it signs people in
 * itself.
 */
export async function runLogin(opts: { url: string; username?: string; passwordStdin: boolean }, io: LoginIo): Promise<number> {
  const fail = failWith(io);
  const { url } = opts;
  try {
    assertSafeUrl(url, io.env);
  } catch (e) {
    if (e instanceof PlainHttpError) return fail(e.message);
    throw e;
  }
  const setRawMode = io.stdin.isTTY === true && typeof io.stdin.setRawMode === 'function' ? io.stdin.setRawMode.bind(io.stdin) : null;
  if (opts.passwordStdin) {
    if (io.stdin.isTTY === true) {
      return fail('--password-stdin reads a pipe or a file, not a terminal. In a terminal, leave it off: the password is then asked for with no echo.');
    }
    if (opts.username === undefined) return fail('--password-stdin needs --username, because standard input holds the password.');
  } else if (setRawMode === null) {
    return fail('Standard input is not a terminal, so the password cannot be asked for. Use --password-stdin with --username.');
  }
  const file = sessionFileFor(io.env, placeOf(io));
  if (file === null) return fail('Cannot find your home folder, so there is nowhere to keep the session. Set HOME.');
  try {
    // A session file that cannot be used stops here, before anything is asked for.
    await readEntry(file, url);
  } catch (e) {
    if (e instanceof SessionError) return fail(e.message);
    throw e;
  }

  let config: Answer;
  try {
    config = await requestOnce(url, 'api/config', { method: 'GET' });
  } catch (e) {
    return fail(connectionMessage(url, errorCode(e)));
  }
  if (config.status !== 200) return fail(answerProblem(config.status));
  const settings = jsonOf(config);
  if (!settings) return fail(UNREADABLE);
  const auth = settings.auth as { mode?: unknown } | null | undefined;
  if (typeof auth !== 'object' || auth === null || auth.mode !== 'local') return fail(NOT_LOCAL_SIGN_IN);

  let username = opts.username;
  if (username === undefined) {
    io.err.write('Username: ');
    const line = await readLine(io.stdin);
    if (line === null || line === 'too-long') return fail(CANCELLED);
    username = line.bytes.toString('utf8');
  }
  username = username.trim();
  if (username === '') return fail('The username is empty.');

  let password: string | null;
  if (opts.passwordStdin) {
    const line = await readLine(io.stdin);
    if (line === 'too-long') return fail('The password on standard input is too long.');
    if (line === null) return fail('Standard input could not be read.');
    password = passwordOf(line);
  } else {
    password = await askHidden(io.stdin, setRawMode!, io.err, 'Password: ');
  }
  if (password === null) return fail(CANCELLED);
  if (password === '') return fail('The password is empty.');

  let answer: Answer;
  try {
    answer = await requestOnce(url, 'api/auth/login', { method: 'POST', json: { username, password } });
  } catch (e) {
    return fail(connectionMessage(url, errorCode(e)));
  }
  if (answer.status === 401) return fail(WRONG_SIGN_IN);
  if (answer.status === 429) return fail(TOO_MANY_ATTEMPTS);
  if (answer.status !== 200) return fail(answerProblem(answer.status));

  const grant = jsonOf(answer);
  const cookie = sessionCookieFrom(answer.headers['set-cookie']);
  if (grant?.mustChangePassword === true) {
    // Leave no live session behind that nobody holds.
    if (cookie) await endSession(url, cookie);
    return fail(MUST_CHANGE_PASSWORD);
  }
  const token = grant?.accessToken;
  if (typeof token !== 'string' || !isHeaderSafe(token) || cookie === null) {
    if (cookie) await endSession(url, cookie);
    return fail(UNREADABLE_ANSWER);
  }
  const name = await accountName(url, token);
  try {
    await saveEntry(file, url, { cookie, username: name, savedAt: new Date().toISOString() });
  } catch (e) {
    await endSession(url, cookie);
    if (e instanceof SessionError) return fail(e.message);
    throw e;
  }
  io.out.write(name === null ? `Signed in to ${shown(url)}.\n` : `Signed in to ${shown(url)} as ${name}.\n`);
  return 0;
}

/** Ends this server's session and removes it from the file, whether or not the server could be told. */
export async function runLogout(opts: { url: string }, io: LoginIo): Promise<number> {
  const fail = failWith(io);
  const { url } = opts;
  try {
    assertSafeUrl(url, io.env);
  } catch (e) {
    if (e instanceof PlainHttpError) return fail(e.message);
    throw e;
  }
  const file = sessionFileFor(io.env, placeOf(io));
  let entry;
  try {
    entry = file === null ? null : await readEntry(file, url);
  } catch (e) {
    if (e instanceof SessionError) return fail(e.message);
    throw e;
  }
  if (file === null || entry === null) {
    io.out.write(`Not signed in to ${shown(url)}.\n`);
    return 0;
  }
  const problem = await endSession(url, entry.cookie);
  try {
    // Only the session just ended: an entry a newer login wrote meanwhile is kept.
    await removeEntry(file, url, entry.cookie.value);
  } catch (e) {
    if (e instanceof SessionError) return fail(e.message);
    throw e;
  }
  if (problem !== null) {
    return fail(`${problem} The session was removed from this machine. On the server it ends by itself after 12 idle hours.`);
  }
  io.out.write(`Signed out of ${shown(url)}.\n`);
  return 0;
}

/** Says who the server takes the caller to be, and how the caller signed in. */
export async function runWhoami(opts: { url: string; json: boolean }, io: LoginIo): Promise<number> {
  const fail = failWith(io);
  const { url } = opts;
  let credential;
  try {
    assertSafeUrl(url, io.env);
    credential = await findCredential(io.env, url, placeOf(io));
  } catch (e) {
    if (e instanceof PlainHttpError || e instanceof CredentialError) return fail(e.message);
    throw e;
  }
  let answer: Answer;
  try {
    answer = await requestOnce(url, 'api/me', {
      method: 'GET', headers: credential.authorization ? { authorization: credential.authorization } : {},
    });
  } catch (e) {
    return fail(connectionMessage(url, errorCode(e)));
  }
  if (answer.status === 401) return fail(SIGN_IN_FIRST);
  if (answer.status !== 200) return fail(answerProblem(answer.status));
  const me = jsonOf(answer);
  if (!me || typeof me.username !== 'string') return fail(UNREADABLE);
  const roles = Array.isArray(me.roles) ? me.roles.filter((r): r is string => typeof r === 'string') : [];
  const keyField = (me.accessKey as { name?: unknown } | null | undefined)?.name;
  const keyName = credential.kind === 'key' && typeof keyField === 'string' ? keyField : null;
  if (opts.json) {
    const row = { username: me.username, roles, signedInWith: credential.kind, ...(keyName === null ? {} : { key: { name: keyName } }) };
    io.out.write(`${JSON.stringify(row)}\n`);
    return 0;
  }
  const how = keyName === null ? credential.kind : `key (${clean(keyName)})`;
  io.out.write(`Username: ${clean(me.username)}\nRoles: ${roles.length > 0 ? roles.map(clean).join(', ') : 'none'}\nSigned in with: ${how}\n`);
  return 0;
}
