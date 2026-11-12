import { describe, it, expect } from 'vitest';
import { randomBytes, scryptSync } from 'node:crypto';
import { checkPasswordRules, createPasswordHasher, PASSWORD_MAX, PASSWORD_MIN, type ScryptFn } from './password';

function slowScrypt(track: { inFlight: number; peak: number }, failFirst = false): ScryptFn {
  let failed = !failFirst;
  return async () => {
    track.inFlight++;
    track.peak = Math.max(track.peak, track.inFlight);
    await new Promise((r) => setTimeout(r, 10));
    track.inFlight--;
    if (!failed) {
      failed = true;
      throw new Error('scrypt failed');
    }
    return Buffer.alloc(64);
  };
}

describe('checkPasswordRules', () => {
  it('applies the three rules', () => {
    expect(checkPasswordRules('short', 'ada')).toBe('too_short');
    expect(checkPasswordRules('x'.repeat(129), 'ada')).toBe('too_long');
    expect(checkPasswordRules('AdaLovelace1', 'adalovelace1')).toBe('same_as_username');
    expect(checkPasswordRules('correct horse', 'ada')).toBe('ok');
  });

  it('accepts the exact length limits', () => {
    expect(checkPasswordRules('x'.repeat(PASSWORD_MIN), 'ada')).toBe('ok');
    expect(checkPasswordRules('x'.repeat(PASSWORD_MIN - 1), 'ada')).toBe('too_short');
    expect(checkPasswordRules('x'.repeat(PASSWORD_MAX), 'ada')).toBe('ok');
  });

  it('gives the same answer for the composed and decomposed forms', () => {
    // 9 code points composed, 10 decomposed. Both must count as 9.
    expect(checkPasswordRules('abcdefghé', 'ada')).toBe('too_short');
    expect(checkPasswordRules('abcdefghé', 'ada')).toBe('too_short');
    // The username comparison normalizes both sides.
    expect(checkPasswordRules('renélovelace', 'renélovelace')).toBe('same_as_username');
    expect(checkPasswordRules('renélovelace', 'renélovelace')).toBe('same_as_username');
  });
});

describe('createPasswordHasher', () => {
  it('round-trips a password', async () => {
    const h = createPasswordHasher();
    const stored = await h.hash('correct horse');
    expect(stored.startsWith('scrypt$32768$8$3$')).toBe(true);
    expect(await h.verify('correct horse', stored)).toBe(true);
    expect(await h.verify('wrong horse!!', stored)).toBe(false);
  });

  it('verifies the composed form against the decomposed form, both ways', async () => {
    const h = createPasswordHasher();
    const composed = 'café au lait';
    const decomposed = 'café au lait';
    expect(await h.verify(composed, await h.hash(decomposed))).toBe(true);
    expect(await h.verify(decomposed, await h.hash(composed))).toBe(true);
  });

  it('verifies a full-width password against the plain form', async () => {
    const h = createPasswordHasher();
    const stored = await h.hash('ABCdefghij');
    expect(await h.verify('ＡＢＣdefghij', stored)).toBe(true);
  });

  it('uses a new salt each time', async () => {
    const h = createPasswordHasher();
    expect(await h.hash('correct horse')).not.toBe(await h.hash('correct horse'));
  });

  it('returns false for a stored value it cannot parse', async () => {
    const h = createPasswordHasher();
    for (const bad of ['', 'plain', 'scrypt$x$8$3$a$b', 'bcrypt$1$2$3$4$5']) {
      expect(await h.verify('pw', bad)).toBe(false);
    }
  });

  it('returns false when the stored parameters are ones Node refuses', async () => {
    const h = createPasswordHasher();
    const salt = randomBytes(16).toString('base64');
    const key = randomBytes(64).toString('base64');
    // N is not a power of two.
    expect(await h.verify('correct horse', `scrypt$30000$8$3$${salt}$${key}`)).toBe(false);
    // N=1048576, r=8 needs 1 GiB, far above the 64 MiB maxmem.
    expect(await h.verify('correct horse', `scrypt$1048576$8$3$${salt}$${key}`)).toBe(false);
  });

  it('verifies with the parameters in the stored value', async () => {
    const salt = randomBytes(16);
    const key = scryptSync('correct horse', salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const stored = `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
    const h = createPasswordHasher();
    expect(await h.verify('correct horse', stored)).toBe(true);
    expect(await h.verify('wrong horse!!', stored)).toBe(false);
  });

  it('runs at most four hashes at once', async () => {
    const track = { inFlight: 0, peak: 0 };
    const h = createPasswordHasher({ scrypt: slowScrypt(track) });
    await Promise.all(Array.from({ length: 10 }, () => h.hash('correct horse')));
    expect(track.peak).toBe(4);
  });

  it('frees the slot when a hash fails', async () => {
    const track = { inFlight: 0, peak: 0 };
    const h = createPasswordHasher({ scrypt: slowScrypt(track, true) });
    await expect(h.hash('correct horse')).rejects.toThrow('scrypt failed');
    track.peak = 0;
    const results = await Promise.all(Array.from({ length: 10 }, () => h.hash('correct horse')));
    expect(results).toHaveLength(10);
    expect(track.peak).toBe(4);
  });

  it('runs burn through the same limiter and parameters as verify', async () => {
    const track = { inFlight: 0, peak: 0 };
    const calls: { keylen: number; opts: { N: number; r: number; p: number; maxmem: number } }[] = [];
    const inner = slowScrypt(track);
    const scrypt: ScryptFn = (pw, salt, keylen, opts) => {
      calls.push({ keylen, opts });
      return inner(pw, salt, keylen, opts);
    };
    const h = createPasswordHasher({ scrypt });
    await Promise.all(Array.from({ length: 10 }, () => h.burn()));
    expect(track.peak).toBe(4);
    expect(calls).toHaveLength(10);
    for (const c of calls) {
      expect(c.keylen).toBe(64);
      expect(c.opts).toEqual({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
    }
  });
});
