import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JWK } from 'jose';
import type { LocalAuthStore, StoredSigningKey } from '@openldr/ports';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  LOCAL_ISSUER,
  SigningKeyUnreadableError,
  loadOrCreateSigningKey,
  signAccessToken,
  type AccessClaims,
} from './tokens';

type KeyStore = Pick<LocalAuthStore, 'getSigningKey' | 'insertSigningKeyIfNone'>;

function memoryStore(): KeyStore {
  let row: StoredSigningKey | null = null;
  return {
    async getSigningKey() {
      return row;
    },
    async insertSigningKeyIfNone(key) {
      if (!row) row = key;
      return row;
    },
  };
}

const claims: AccessClaims = {
  sub: 'u1', username: 'ada', name: 'Ada L', email: null, sid: 's1', roles: ['lab_admin'], mustChangePassword: false,
};

describe('loadOrCreateSigningKey', () => {
  let store: KeyStore;
  const key1 = randomBytes(32);
  const key2 = randomBytes(32);

  beforeEach(() => {
    store = memoryStore();
  });

  it('creates one key and returns the same one next time', async () => {
    const a = await loadOrCreateSigningKey(store, key1);
    const b = await loadOrCreateSigningKey(store, key1);
    expect(b.kid).toBe(a.kid);
  });

  it('refuses a changed secrets key and does not create a second key', async () => {
    const a = await loadOrCreateSigningKey(store, key1);
    await expect(loadOrCreateSigningKey(store, key2)).rejects.toBeInstanceOf(SigningKeyUnreadableError);
    expect((await store.getSigningKey())!.kid).toBe(a.kid);
  });

  it('names the cause in the error and nothing from the key', async () => {
    await loadOrCreateSigningKey(store, key1);
    const err = await loadOrCreateSigningKey(store, key2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SigningKeyUnreadableError);
    expect((err as Error).message).toBe(
      'local sign-in key cannot be opened. SECRETS_ENCRYPTION_KEY differs from the one that sealed it.',
    );
    expect((err as Error).message).not.toContain((await store.getSigningKey())!.sealedPrivateJwk);
  });

  it('stores only the public half in the clear', async () => {
    await loadOrCreateSigningKey(store, key1);
    const row = (await store.getSigningKey())!;
    expect(row.publicJwk).not.toHaveProperty('d');
    expect(row.sealedPrivateJwk).not.toContain('"d"');
  });

  it('uses the key another process stored first', async () => {
    const otherStore = memoryStore();
    await loadOrCreateSigningKey(otherStore, key1);
    const otherRow = (await otherStore.getSigningKey())!;
    const racing: KeyStore = {
      async getSigningKey() {
        return null;
      },
      async insertSigningKeyIfNone() {
        return otherRow;
      },
    };

    const k = await loadOrCreateSigningKey(racing, key1);
    expect(k.kid).toBe(otherRow.kid);

    const now = new Date('2026-01-01T00:00:00Z');
    const tok = await signAccessToken(k, claims, now);
    const otherKeySet = createLocalJWKSet({ keys: [otherRow.publicJwk as unknown as JWK] });
    const { protectedHeader } = await jwtVerify(tok, otherKeySet, { issuer: LOCAL_ISSUER, currentDate: now });
    expect(protectedHeader.kid).toBe(otherRow.kid);
  });

  it('passes a store failure through unchanged', async () => {
    const dbDown = new Error('connection refused');
    const failingGet: KeyStore = {
      async getSigningKey() {
        throw dbDown;
      },
      async insertSigningKeyIfNone(key) {
        return key;
      },
    };
    await expect(loadOrCreateSigningKey(failingGet, key1)).rejects.toBe(dbDown);

    const failingInsert: KeyStore = {
      async getSigningKey() {
        return null;
      },
      async insertSigningKeyIfNone() {
        throw dbDown;
      },
    };
    await expect(loadOrCreateSigningKey(failingInsert, key1)).rejects.toBe(dbDown);
  });
});

describe('signAccessToken', () => {
  const key1 = randomBytes(32);

  it('signs a token that verifies with the key set and issuer', async () => {
    const k = await loadOrCreateSigningKey(memoryStore(), key1);
    const now = new Date('2026-01-01T00:00:00Z');
    const tok = await signAccessToken(k, claims, now);
    const { payload, protectedHeader } = await jwtVerify(tok, k.keySet, {
      issuer: LOCAL_ISSUER, algorithms: ['ES256'], currentDate: now,
    });
    expect(protectedHeader.alg).toBe('ES256');
    expect(protectedHeader.kid).toBe(k.kid);
    expect(payload).toMatchObject({
      sub: 'u1', preferred_username: 'ada', name: 'Ada L', sid: 's1', realm_access: { roles: ['lab_admin'] },
    });
    expect(payload.email).toBeUndefined();
    expect(payload.pwd_change).toBeUndefined();
    expect(payload.iat).toBe(Math.floor(now.getTime() / 1000));
    expect(payload.exp! - payload.iat!).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(600);
  });

  it('includes email and leaves out a null name', async () => {
    const k = await loadOrCreateSigningKey(memoryStore(), key1);
    const now = new Date('2026-01-01T00:00:00Z');
    const tok = await signAccessToken(k, { ...claims, name: null, email: 'ada@example.org' }, now);
    const { payload } = await jwtVerify(tok, k.keySet, { issuer: LOCAL_ISSUER, currentDate: now });
    expect(payload.email).toBe('ada@example.org');
    expect(payload).not.toHaveProperty('name');
  });

  it('marks a token that must change its password', async () => {
    const k = await loadOrCreateSigningKey(memoryStore(), key1);
    const now = new Date('2026-01-01T00:00:00Z');
    const tok = await signAccessToken(k, { ...claims, mustChangePassword: true }, now);
    const { payload } = await jwtVerify(tok, k.keySet, { issuer: LOCAL_ISSUER, currentDate: now });
    expect(payload.pwd_change).toBe(true);
  });

  it('is rejected once it expires', async () => {
    const k = await loadOrCreateSigningKey(memoryStore(), key1);
    const now = new Date('2026-01-01T00:00:00Z');
    const tok = await signAccessToken(k, claims, now);
    const later = new Date(now.getTime() + (ACCESS_TOKEN_TTL_SECONDS + 1) * 1000);
    await expect(jwtVerify(tok, k.keySet, { issuer: LOCAL_ISSUER, currentDate: later })).rejects.toThrow();
  });
});
