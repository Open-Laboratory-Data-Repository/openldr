// The session file that `openldr login` writes (spec section 6.2).
//
// One entry per server, keyed by the address's origin: scheme, host and port, lower case. An entry
// holds the session cookie pair the server set at sign-in, the account's username and when it was
// saved. It never holds a password or an access token: each command gets a fresh token from
// POST /api/auth/refresh.
//
// The folder is mode 0700 and the file 0600. A new file is made by hard-linking a fully written
// temporary file, and an existing one is replaced by renaming one, so the file is never empty or
// half written. Before the file is used its mode is checked, and a file other users can read or
// change is refused. Windows has no such bits, so there the check does nothing (unproven on Windows).
//
// Known limit: two logins at once can each read the file and each write it back, and one entry is
// lost. There is no lock.

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, mkdir, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, posix, win32 } from 'node:path';
import { connectionMessage, errorCode, jsonOf, REDIRECT_MESSAGE, requestOnce, type Answer } from './request';

const FILE_NAME = 'session.json';
const MAX_FILE_BYTES = 1024 * 1024;

export const MUST_CHANGE_PASSWORD = 'Change your password in Studio first, then sign in again.';
export const UNREADABLE_ANSWER = 'OpenLDR sent a sign-in answer this client cannot read.';

/** Where the session file is looked for. Tests pass their own; commands use homeOf(). */
export interface SessionPlace { platform: NodeJS.Platform; homedir: string }

/** The caller's home folder from the environment: HOME, or USERPROFILE on Windows. '' when unset. */
export function homeOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  return (platform === 'win32' ? env.USERPROFILE : env.HOME) ?? '';
}

/**
 * Linux and the other Unix systems: $XDG_CONFIG_HOME/openldr/session.json, else
 * ~/.config/openldr/session.json. A relative XDG_CONFIG_HOME is ignored, as the XDG rules say.
 * macOS: ~/Library/Application Support/OpenLDR/session.json (unproven on macOS).
 * Windows: %APPDATA%\OpenLDR\session.json (unproven on Windows).
 */
export function sessionFilePath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homedir: string): string {
  if (platform === 'win32') {
    const appData = env.APPDATA;
    const base = appData && win32.isAbsolute(appData) ? appData : win32.join(homedir, 'AppData', 'Roaming');
    return win32.join(base, 'OpenLDR', FILE_NAME);
  }
  if (platform === 'darwin') return posix.join(homedir, 'Library', 'Application Support', 'OpenLDR', FILE_NAME);
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && posix.isAbsolute(xdg) ? xdg : posix.join(homedir, '.config');
  return posix.join(base, 'openldr', FILE_NAME);
}

/** The session file for this environment, or null when no folder for it is known. */
export function sessionFileFor(env: NodeJS.ProcessEnv, place: SessionPlace): string | null {
  const path = sessionFilePath(env, place.platform, place.homedir);
  const absolute = place.platform === 'win32' ? win32.isAbsolute(path) : posix.isAbsolute(path);
  return absolute ? path : null;
}

/** The entry key for an address: its origin. A trailing slash or a path does not make a new entry. */
export const sessionKey = (url: string): string => new URL(url).origin;

export interface SessionCookie { name: string; value: string }
export interface SessionEntry { cookie: SessionCookie; username: string | null; savedAt: string }

/** A problem with the session file or the refresh. The message names the file, never a value in it. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

// A cookie name is an HTTP token and a value is RFC 6265 cookie-octets. Nothing else goes in a header.
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const COOKIE_VALUE = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/;
/** A value that can travel in an Authorization header. */
export const isHeaderSafe = (s: string): boolean => /^[\x21-\x7e]+$/.test(s);
export const cookieHeader = (c: SessionCookie): string => `${c.name}=${c.value}`;

interface SetCookie { name: string; value: string; attrs: string[] }

function parseSetCookie(header: string): SetCookie | null {
  const [pair = '', ...rest] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attrs: rest.map((a) => a.trim().toLowerCase()) };
}
const setCookies = (h: string | string[] | undefined): SetCookie[] =>
  (h === undefined ? [] : Array.isArray(h) ? h : [h]).map(parseSetCookie).filter((c): c is SetCookie => c !== null);
/** A cookie that sets a value, as opposed to one that clears it. */
const sets = (c: SetCookie): boolean => !c.attrs.includes('max-age=0') && COOKIE_NAME.test(c.name) && COOKIE_VALUE.test(c.value);

/**
 * The session cookie from a sign-in answer's Set-Cookie headers. The client does not name the
 * cookie (its name lives in apps/server/src/session-cookie.ts, which the CLI cannot import): it
 * takes the one cookie the answer sets. When more than one is set, as a proxy can add its own, it
 * takes the one scoped to /api/auth, where the server scopes its session cookie. Null when that does
 * not pick exactly one.
 */
export function sessionCookieFrom(h: string | string[] | undefined): SessionCookie | null {
  const found = setCookies(h).filter(sets);
  const pick = found.length === 1 ? found : found.filter((c) => c.attrs.includes('path=/api/auth'));
  return pick.length === 1 ? { name: pick[0]!.name, value: pick[0]!.value } : null;
}

const unreadable = (file: string) => new SessionError(`The session file ${file} cannot be read. Remove it and sign in again.`);

/** Every entry in a session file's text. Throws what `bad` makes when the text is not one. */
function parseSessions(text: string, bad: () => SessionError): Map<string, SessionEntry> {
  if (text.length > MAX_FILE_BYTES) throw bad();
  let sessions: unknown;
  try {
    sessions = (JSON.parse(text) as { sessions?: unknown } | null)?.sessions;
  } catch {
    throw bad();
  }
  if (typeof sessions !== 'object' || sessions === null || Array.isArray(sessions)) throw bad();
  const out = new Map<string, SessionEntry>();
  for (const [key, v] of Object.entries(sessions)) {
    const entry = entryOf(v);
    if (!entry) throw bad();
    out.set(key, entry);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The Docker wrapper's plumbing (install/install.sh)
//
// On a Docker install the CLI runs in the API container, which has no terminal and must keep
// nothing. So the wrapper signs in on the host with the hidden `login --session-out`, which prints
// the session as one line, in the session file's own form, and keeps no file. The wrapper keeps
// that line on the host and hands it back for each call in the hidden variable OPENLDR_SESSION.
// When OPENLDR_SESSION is set, no session file is read or written at all. Both are the wrapper's
// own plumbing: they appear in no help text and no user doc.
// ---------------------------------------------------------------------------------------------

/** The session for this server as the one line `login --session-out` prints. */
export function sessionLine(url: string, entry: SessionEntry): string {
  return JSON.stringify({ version: 1, sessions: { [sessionKey(url)]: entry } });
}

/** This server's entry in the text of OPENLDR_SESSION, or null. Empty text is no session. */
export function handedEntry(text: string, url: string): SessionEntry | null {
  if (text.trim() === '') return null;
  const bad = () => new SessionError('The session handed in by the openldr wrapper cannot be read. Sign in again.');
  return parseSessions(text, bad).get(sessionKey(url)) ?? null;
}

function entryOf(v: unknown): SessionEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const e = v as Record<string, unknown>;
  const c = e.cookie as Record<string, unknown> | null | undefined;
  if (typeof c !== 'object' || c === null) return null;
  if (typeof c.name !== 'string' || !COOKIE_NAME.test(c.name) || typeof c.value !== 'string' || !COOKIE_VALUE.test(c.value)) return null;
  if (e.username !== null && typeof e.username !== 'string') return null;
  if (typeof e.savedAt !== 'string') return null;
  return { cookie: { name: c.name, value: c.value }, username: e.username, savedAt: e.savedAt };
}

/**
 * Every entry in the file; an absent file has none. Opened without following a link, and checked
 * through the open handle, so the file checked is the file read. Refuses a link, anything but a
 * plain file, a file other users can read or change, and a file that does not parse.
 */
async function readAll(file: string): Promise<Map<string, SessionEntry>> {
  let fh: FileHandle;
  try {
    // O_NOFOLLOW is not defined on Windows.
    fh = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (e) {
    const code = errorCode(e);
    if (code === 'ENOENT') return new Map();
    if (code === 'ELOOP') throw new SessionError(`The session file ${file} is a link, so it is not used. Remove it and sign in again.`);
    throw unreadable(file);
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new SessionError(`The session file ${file} is not a plain file, so it is not used. Remove it and sign in again.`);
    if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
      throw new SessionError(`Other users can read or change the session file ${file}, so it is not used. Remove it and sign in again.`);
    }
    if (st.size > MAX_FILE_BYTES) throw unreadable(file);
    return parseSessions(await fh.readFile('utf8'), () => unreadable(file));
  } catch (e) {
    if (e instanceof SessionError) throw e;
    throw unreadable(file);
  } finally {
    await fh.close().catch(() => {});
  }
}

/** Error codes for which a hard link cannot be made; rename gives the same whole-file result. */
const NO_LINK = new Set(['EEXIST', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

async function writeAll(file: string, sessions: Map<string, SessionEntry>): Promise<void> {
  const cannot = () => new SessionError(`Cannot write the session file ${file}.`);
  const dir = dirname(file);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await chmod(dir, 0o700);
  } catch {
    throw cannot();
  }
  const text = `${JSON.stringify({ version: 1, sessions: Object.fromEntries(sessions) }, null, 2)}\n`;
  const temp = join(dir, `.${basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  let fh: FileHandle | null;
  try {
    fh = await open(temp, 'wx', 0o600);
  } catch {
    throw cannot();
  }
  try {
    // The exact mode, whatever the umask.
    if (process.platform !== 'win32') await fh.chmod(0o600);
    await fh.writeFile(text, 'utf8');
    await fh.sync();
    await fh.close();
    fh = null;
    try {
      // A new file appears only whole: the complete temporary file gets a second name.
      await link(temp, file);
      await unlink(temp).catch(() => {});
    } catch (e) {
      // An existing file is replaced whole by a rename. So is a new one where links are not allowed.
      if (!NO_LINK.has(errorCode(e) ?? '')) throw e;
      await rename(temp, file);
    }
  } catch {
    await fh?.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw cannot();
  }
}

/** This server's entry, or null. */
export async function readEntry(file: string, url: string): Promise<SessionEntry | null> {
  return (await readAll(file)).get(sessionKey(url)) ?? null;
}

/** Adds or replaces this server's entry. Other servers' entries are kept. */
export async function saveEntry(file: string, url: string, entry: SessionEntry): Promise<void> {
  const all = await readAll(file);
  all.set(sessionKey(url), entry);
  await writeAll(file, all);
}

/**
 * Removes this server's entry, and the file when no entry is left. With `onlyIf`, only while the
 * entry still holds that cookie value, so an entry a newer login wrote meanwhile is kept.
 */
export async function removeEntry(file: string, url: string, onlyIf?: string): Promise<void> {
  const all = await readAll(file);
  const key = sessionKey(url);
  const entry = all.get(key);
  if (!entry || (onlyIf !== undefined && entry.cookie.value !== onlyIf)) return;
  all.delete(key);
  if (all.size > 0) {
    await writeAll(file, all);
    return;
  }
  try {
    await unlink(file);
  } catch (e) {
    if (errorCode(e) !== 'ENOENT') throw new SessionError(`Cannot remove the session file ${file}.`);
  }
}

/**
 * The access token for this server from its saved session, or null when there is none. A refresh
 * the server refuses (401) removes the entry and gives null. Anything else that goes wrong throws
 * SessionError and keeps the entry: a server that is down has not ended the session. When the
 * answer sets a new cookie value, the entry is updated. The caller runs assertSafeUrl first,
 * because the cookie is sent.
 */
export async function refreshSession(url: string, file: string): Promise<string | null> {
  const entry = await readEntry(file, url);
  if (!entry) return null;
  const r = await refreshWith(url, entry);
  if (r === null) {
    await removeEntry(file, url, entry.cookie.value);
    return null;
  }
  if (r.renewed !== null) {
    await saveEntry(file, url, { ...entry, cookie: { name: entry.cookie.name, value: r.renewed }, savedAt: new Date().toISOString() });
  }
  return r.token;
}

/**
 * refreshSession for the session in OPENLDR_SESSION. Reads and writes no file. A refused refresh
 * gives null. A new cookie value from the server cannot be handed back to the wrapper, so it is
 * not kept; the server sets none today (apps/server/src/local-auth-routes.ts).
 */
export async function refreshHanded(url: string, text: string): Promise<string | null> {
  const entry = handedEntry(text, url);
  if (!entry) return null;
  const r = await refreshWith(url, entry);
  return r === null ? null : r.token;
}

/** One refresh with this entry's cookie: null when the server refused it (401), else the token and
 *  any new cookie value. Anything else that goes wrong throws SessionError. */
async function refreshWith(url: string, entry: SessionEntry): Promise<{ token: string; renewed: string | null } | null> {
  let answer: Answer;
  try {
    answer = await requestOnce(url, 'api/auth/refresh', { method: 'POST', headers: { cookie: cookieHeader(entry.cookie) } });
  } catch (e) {
    throw new SessionError(connectionMessage(url, errorCode(e)));
  }
  if (answer.status === 401) return null;
  if (answer.status >= 300 && answer.status < 400) throw new SessionError(REDIRECT_MESSAGE);
  if (answer.status !== 200) throw new SessionError(`OpenLDR answered with status ${answer.status}.`);
  const body = jsonOf(answer);
  const token = body?.accessToken;
  if (typeof token !== 'string' || !isHeaderSafe(token)) throw new SessionError(UNREADABLE_ANSWER);
  if (body?.mustChangePassword === true) throw new SessionError(MUST_CHANGE_PASSWORD);
  const renewed = setCookies(answer.headers['set-cookie']).filter((c) => c.name === entry.cookie.name && sets(c));
  const changed = renewed.length === 1 && renewed[0]!.value !== entry.cookie.value;
  return { token, renewed: changed ? renewed[0]!.value : null };
}
