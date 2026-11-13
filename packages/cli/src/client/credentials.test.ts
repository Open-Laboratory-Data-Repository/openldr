import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertSafeUrl, CredentialError, DEFAULT_SERVER_URL, findCredential, PlainHttpError, serverUrl } from './credentials';

// A key-shaped value for the tests. Not a real key.
const KEY = 'oldr_AAAAtestkeyAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const URL_ = 'http://127.0.0.1:1';

describe('serverUrl', () => {
  it('picks the address from --url, then OPENLDR_URL, then the default', () => {
    expect(serverUrl({ url: 'https://lab.example', env: { OPENLDR_URL: 'https://other.example' } })).toBe('https://lab.example');
    expect(serverUrl({ env: { OPENLDR_URL: 'https://other.example' } })).toBe('https://other.example');
    expect(serverUrl({ env: {} })).toBe('http://127.0.0.1:3000');
    expect(DEFAULT_SERVER_URL).toBe('http://127.0.0.1:3000');
    // An empty variable counts as unset.
    expect(serverUrl({ env: { OPENLDR_URL: '' } })).toBe('http://127.0.0.1:3000');
  });
});

describe('assertSafeUrl', () => {
  const message = 'Refusing to send a credential over plain HTTP to lab.example. Use https, or set OPENLDR_ALLOW_PLAIN_HTTP=true.';

  it('refuses plain HTTP to another machine and allows it with the setting', () => {
    expect(() => assertSafeUrl('http://lab.example:3000', {})).toThrow(PlainHttpError);
    expect(() => assertSafeUrl('http://lab.example:3000', {})).toThrow(message);
    expect(() => assertSafeUrl('http://lab.example:3000', { OPENLDR_ALLOW_PLAIN_HTTP: 'yes' })).toThrow(message);
    expect(() => assertSafeUrl('http://lab.example:3000', { OPENLDR_ALLOW_PLAIN_HTTP: 'true' })).not.toThrow();
    expect(() => assertSafeUrl('http://lab.example:3000', { OPENLDR_ALLOW_PLAIN_HTTP: '1' })).not.toThrow();
  });

  it('allows plain HTTP to this machine and https to any machine', () => {
    for (const url of ['http://127.0.0.1:3000', 'http://localhost:3000', 'http://LOCALHOST', 'http://[::1]:3000', 'https://lab.example']) {
      expect(() => assertSafeUrl(url, {}), url).not.toThrow();
    }
  });

  it('refuses a user name or password in the address, another scheme, and text that is not an address', () => {
    expect(() => assertSafeUrl('https://user:secret@lab.example', {})).toThrow(PlainHttpError);
    expect(() => assertSafeUrl('http://user@127.0.0.1:3000', {})).toThrow(PlainHttpError);
    expect(() => assertSafeUrl('ftp://lab.example', {})).toThrow(PlainHttpError);
    expect(() => assertSafeUrl('not an address', {})).toThrow(PlainHttpError);
    // The message never quotes the address, which could hold a password.
    try { assertSafeUrl('https://user:secret@lab.example', {}); } catch (err) { expect(String((err as Error).message)).not.toContain('secret'); }
  });
});

describe('findCredential', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'openldr-cred-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('uses OPENLDR_KEY, then OPENLDR_KEY_FILE, then nothing', async () => {
    const file = join(dir, 'key.txt');
    await writeFile(file, `  ${KEY}x\n`);
    expect(await findCredential({ OPENLDR_KEY: ` ${KEY} `, OPENLDR_KEY_FILE: file }, URL_)).toEqual({ kind: 'key', authorization: `Bearer ${KEY}` });
    expect(await findCredential({ OPENLDR_KEY_FILE: file }, URL_)).toEqual({ kind: 'key', authorization: `Bearer ${KEY}x` });
    expect(await findCredential({}, URL_)).toEqual({ kind: 'none', authorization: null });
    expect(await findCredential({ OPENLDR_KEY: undefined, OPENLDR_KEY_FILE: undefined }, URL_)).toEqual({ kind: 'none', authorization: null });
  });

  it('stops on a variable that is set but empty, naming it (Ruling 65)', async () => {
    const file = join(dir, 'key.txt');
    await writeFile(file, KEY);
    for (const value of ['', '   ']) {
      await expect(findCredential({ OPENLDR_KEY: value, OPENLDR_KEY_FILE: file }, URL_)).rejects.toThrow('OPENLDR_KEY is set but empty. Set it, or unset it.');
      await expect(findCredential({ OPENLDR_KEY_FILE: value }, URL_)).rejects.toThrow('OPENLDR_KEY_FILE is set but empty. Set it, or unset it.');
    }
  });

  it('stops on a key file that is missing or empty, naming the file and never falling through', async () => {
    const missing = join(dir, 'nope.txt');
    await expect(findCredential({ OPENLDR_KEY_FILE: missing }, URL_)).rejects.toThrow(CredentialError);
    await expect(findCredential({ OPENLDR_KEY_FILE: missing }, URL_)).rejects.toThrow(missing);
    const empty = join(dir, 'empty.txt');
    await writeFile(empty, ' \n');
    await expect(findCredential({ OPENLDR_KEY_FILE: empty }, URL_)).rejects.toThrow(empty);
    await expect(findCredential({ OPENLDR_KEY_FILE: dir }, URL_)).rejects.toThrow(CredentialError);
  });

  it('refuses a key that cannot travel in a header, without quoting it', async () => {
    const err = await findCredential({ OPENLDR_KEY: 'oldr_a b' }, URL_).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CredentialError);
    expect((err as Error).message).toContain('OPENLDR_KEY');
    expect((err as Error).message).not.toContain('oldr_a b');
    const file = join(dir, 'k');
    await writeFile(file, 'oldr_a\u0001b');
    const err2 = await findCredential({ OPENLDR_KEY_FILE: file }, URL_).catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(CredentialError);
    expect((err2 as Error).message).not.toContain('oldr_a');
  });
});
