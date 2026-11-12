import {
  SignJWT,
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
  type JWTPayload,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose';
import { OpenLdrError, open, seal } from '@openldr/core';
import type { LocalAuthStore, StoredSigningKey } from '@openldr/ports';

export const LOCAL_ISSUER = 'urn:openldr:local-sign-in';
export const ACCESS_TOKEN_TTL_SECONDS = 600;

const ALG = 'ES256';

export interface SigningKey { kid: string; privateKey: KeyLike; keySet: JWTVerifyGetKey }

export class SigningKeyUnreadableError extends Error {
  constructor() {
    super('local sign-in key cannot be opened. SECRETS_ENCRYPTION_KEY differs from the one that sealed it.');
    this.name = 'SigningKeyUnreadableError';
  }
}

type KeyStore = Pick<LocalAuthStore, 'getSigningKey' | 'insertSigningKeyIfNone'>;

/** Loads the stored key, or creates one. A store failure passes through unchanged. */
export async function loadOrCreateSigningKey(store: KeyStore, secretKey: Buffer): Promise<SigningKey> {
  const existing = await store.getSigningKey();
  if (existing) return openStoredKey(existing, secretKey);

  const { publicKey, privateKey } = await generateKeyPair(ALG, { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  const privateJwk = await exportJWK(privateKey);
  // Another server may insert first. Use the row the store kept, not the pair made here.
  const stored = await store.insertSigningKeyIfNone({
    kid,
    sealedPrivateJwk: seal(JSON.stringify(privateJwk), secretKey),
    publicJwk: { ...publicJwk, kid, alg: ALG, use: 'sig' },
  });
  return openStoredKey(stored, secretKey);
}

async function openStoredKey(row: StoredSigningKey, secretKey: Buffer): Promise<SigningKey> {
  let json: string;
  try {
    json = open(row.sealedPrivateJwk, secretKey);
  } catch (err) {
    // `open` throws OpenLdrError for a wrong key or a damaged blob.
    if (err instanceof OpenLdrError) throw new SigningKeyUnreadableError();
    throw err;
  }

  let privateKey: KeyLike | Uint8Array;
  try {
    privateKey = await importJWK(JSON.parse(json) as JWK, ALG);
  } catch {
    // A parse error can quote its input. Drop it so no key text reaches a message.
    throw new Error('local sign-in key opened but is not a valid ES256 key');
  }
  if (privateKey instanceof Uint8Array) throw new Error('local sign-in key opened but is not a valid ES256 key');

  const publicJwk = { ...row.publicJwk, kid: row.kid } as JWK;
  return { kid: row.kid, privateKey, keySet: createLocalJWKSet({ keys: [publicJwk] }) };
}

export interface AccessClaims {
  sub: string; username: string; name: string | null; email: string | null;
  sid: string; roles: string[]; mustChangePassword: boolean;
}

export async function signAccessToken(key: SigningKey, claims: AccessClaims, now: Date = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: JWTPayload = {
    preferred_username: claims.username,
    sid: claims.sid,
    realm_access: { roles: [...claims.roles] },
  };
  if (claims.name !== null) payload.name = claims.name;
  if (claims.email !== null) payload.email = claims.email;
  if (claims.mustChangePassword) payload.pwd_change = true;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALG, kid: key.kid })
    .setIssuer(LOCAL_ISSUER)
    .setSubject(claims.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
    .sign(key.privateKey);
}
