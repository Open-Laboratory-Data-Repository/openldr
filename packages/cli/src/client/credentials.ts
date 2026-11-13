// Where a command sent through the app goes, and what it signs in with (spec section 6.3).
//
// The key travels only in the Authorization header. Nothing in this file puts it in a URL, a log
// line or an error message. Messages name the setting or the file, never the value.

import { open } from 'node:fs/promises';

/** The server address when neither --server-url nor OPENLDR_URL is set. */
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:3000';

export interface Credential {
  kind: 'key' | 'session' | 'none';
  /** The whole Authorization header value, or null to send none. */
  authorization: string | null;
}

/** The address cannot be used. The message is safe to print: it never quotes the address. */
export class PlainHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlainHttpError';
  }
}

/** The credential the caller set cannot be read. The message names where it came from, never the key. */
export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

/** This machine. `[::1]` is how the URL parser writes the IPv6 loopback. */
const THIS_MACHINE = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** A key file larger than this is not a key. */
const MAX_KEY_FILE_BYTES = 4096;

/** --server-url, then OPENLDR_URL, then the default. An empty OPENLDR_URL counts as unset. */
export function serverUrl(opts: { url?: string; env: NodeJS.ProcessEnv }): string {
  if (opts.url !== undefined) return opts.url;
  const fromEnv = opts.env.OPENLDR_URL?.trim();
  return fromEnv ? fromEnv : DEFAULT_SERVER_URL;
}

/**
 * Throws PlainHttpError for an address that must not get a command. Arguments and uploaded files
 * are as sensitive as a key, so this applies whether or not a credential was found.
 */
export function assertSafeUrl(url: string, env: NodeJS.ProcessEnv): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PlainHttpError('The OpenLDR address is not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PlainHttpError('The OpenLDR address must start with http:// or https://.');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new PlainHttpError('The OpenLDR address must not hold a user name or password.');
  }
  const allowed = env.OPENLDR_ALLOW_PLAIN_HTTP === 'true' || env.OPENLDR_ALLOW_PLAIN_HTTP === '1';
  if (parsed.protocol === 'http:' && !THIS_MACHINE.has(parsed.hostname) && !allowed) {
    throw new PlainHttpError(
      `Refusing to send a credential over plain HTTP to ${parsed.hostname}. Use https, or set OPENLDR_ALLOW_PLAIN_HTTP=true.`,
    );
  }
}

/** A key as a header value. A key with a space or a control character cannot travel in a header. */
function keyCredential(key: string, from: string): Credential {
  if (!/^[\x21-\x7e]+$/.test(key)) throw new CredentialError(`The key in ${from} is not valid: it holds a space or a character a header cannot carry.`);
  return { kind: 'key', authorization: `Bearer ${key}` };
}

/** The file's text, at most MAX_KEY_FILE_BYTES. Reads through a handle, so a pipe works too. */
async function readKeyFile(file: string): Promise<string> {
  const unreadable = () => new CredentialError(`The key file named by OPENLDR_KEY_FILE cannot be read: ${file}`);
  let fh;
  try {
    fh = await open(file, 'r');
  } catch {
    throw unreadable();
  }
  try {
    const buf = Buffer.alloc(MAX_KEY_FILE_BYTES + 1);
    let total = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, total, buf.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_KEY_FILE_BYTES) throw new CredentialError(`The key file named by OPENLDR_KEY_FILE is too large to hold a key: ${file}`);
    }
    return buf.subarray(0, total).toString('utf8');
  } catch (err) {
    if (err instanceof CredentialError) throw err;
    throw unreadable();
  } finally {
    await fh.close().catch(() => {});
  }
}

/** The session file from `openldr login`. Login does not exist yet, so there is none. */
async function readSession(_env: NodeJS.ProcessEnv, _url: string): Promise<Credential | null> {
  return null;
}

/**
 * OPENLDR_KEY, then the file named by OPENLDR_KEY_FILE, then the session file, then none. An empty
 * OPENLDR_KEY counts as unset. A key file that is set but missing, unreadable or empty stops here
 * with CredentialError: falling through would run the command as someone else after a typo.
 */
export async function findCredential(env: NodeJS.ProcessEnv, url: string): Promise<Credential> {
  const key = env.OPENLDR_KEY?.trim();
  if (key) return keyCredential(key, 'OPENLDR_KEY');
  const file = env.OPENLDR_KEY_FILE;
  if (file !== undefined && file !== '') {
    const fromFile = (await readKeyFile(file)).trim();
    if (!fromFile) throw new CredentialError(`The key file named by OPENLDR_KEY_FILE is empty: ${file}`);
    return keyCredential(fromFile, `the file ${file}`);
  }
  const session = await readSession(env, url);
  if (session) return session;
  return { kind: 'none', authorization: null };
}
