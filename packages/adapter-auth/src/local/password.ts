import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export type PasswordRuleFailure = 'too_short' | 'too_long' | 'same_as_username';

/** One typed password can arrive as different code points. NFKC makes them one string. */
function normalize(text: string): string {
  return text.normalize('NFKC');
}

/** Length counts characters (code points) of the NFKC form, not UTF-16 units. */
export function checkPasswordRules(password: string, username: string): 'ok' | PasswordRuleFailure {
  const normalized = normalize(password);
  const length = Array.from(normalized).length;
  if (length < PASSWORD_MIN) return 'too_short';
  if (length > PASSWORD_MAX) return 'too_long';
  if (normalized.toLowerCase() === normalize(username).toLowerCase()) return 'same_as_username';
  return 'ok';
}

/** Passwords are NFKC-normalized inside `hash` and `verify`. Callers pass the raw input. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False for a wrong password and for a stored value it cannot parse. Never throws. */
  verify(password: string, stored: string): Promise<boolean>;
  /** Spends one hash. Called for unknown usernames so the reply takes the same time. */
  burn(): Promise<void>;
}

export type ScryptFn = (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 32768;
const R = 8;
const P = 3;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
// N=32768, r=8 needs 32 MiB plus overhead, just over Node's 32 MiB default.
const MAXMEM = 64 * 1024 * 1024;
const MAX_CONCURRENT = 4;

const POSITIVE_INT = /^[1-9][0-9]*$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Node checks scrypt parameters synchronously and throws. Wrapping the call in the
// promise executor turns that throw into a rejection.
const defaultScrypt: ScryptFn = (password, salt, keylen, opts) =>
  new Promise((resolve, reject) => {
    nodeScrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** Lets at most `max` tasks run at once. A task that fails still frees its slot. */
function createLimiter(max: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseStored(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6) return null;
  const [scheme, n, r, p, salt, key] = parts as [string, string, string, string, string, string];
  if (scheme !== 'scrypt') return null;
  if (!POSITIVE_INT.test(n) || !POSITIVE_INT.test(r) || !POSITIVE_INT.test(p)) return null;
  if (!BASE64.test(salt) || !BASE64.test(key)) return null;
  const keyBuf = Buffer.from(key, 'base64');
  if (keyBuf.length === 0) return null;
  return { N: Number(n), r: Number(r), p: Number(p), salt: Buffer.from(salt, 'base64'), key: keyBuf };
}

export function createPasswordHasher(opts: { maxConcurrent?: number; scrypt?: ScryptFn } = {}): PasswordHasher {
  const scrypt = opts.scrypt ?? defaultScrypt;
  const limit = createLimiter(opts.maxConcurrent ?? MAX_CONCURRENT);
  const params = { N, r: R, p: P, maxmem: MAXMEM };

  return {
    async hash(password) {
      const salt = randomBytes(SALT_BYTES);
      const key = await limit(() => scrypt(normalize(password), salt, KEY_BYTES, params));
      return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
    },

    async verify(password, stored) {
      try {
        const parsed = parseStored(stored);
        if (!parsed) return false;
        const { N: n, r, p, salt, key } = parsed;
        const derived = await limit(() => scrypt(normalize(password), salt, key.length, { N: n, r, p, maxmem: MAXMEM }));
        return derived.length === key.length && timingSafeEqual(derived, key);
      } catch {
        return false;
      }
    },

    async burn() {
      try {
        await limit(() => scrypt('', randomBytes(SALT_BYTES), KEY_BYTES, params));
      } catch {
        // Matches verify, which turns a failed hash into a quiet false.
      }
    },
  };
}
