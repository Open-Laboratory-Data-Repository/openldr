import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { probe } from '@openldr/core';
import type { AuthPort, TokenClaims } from '@openldr/ports';
import type { AuthConfig, AuthDeps } from './index';

export function createTokenVerifier(cfg: AuthConfig, deps: AuthDeps): Pick<AuthPort, 'healthCheck' | 'verifyToken'> {
  const fetchFn = deps.fetchFn ?? fetch;
  const jwksFactory = deps.remoteJwksFactory ?? ((url: URL) => createRemoteJWKSet(url));
  const discoveryUrl = `${cfg.issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
  // Only Keycloak derives its signing-key path from an internal issuer.
  const effectiveJwksUrl = cfg.internalJwksUrl
    ?? (cfg.mode !== 'oidc' && cfg.internalIssuerUrl ? `${cfg.internalIssuerUrl}/protocol/openid-connect/certs` : undefined);
  let keySetPromise: Promise<JWTVerifyGetKey> | undefined = deps.keySet
    ? Promise.resolve(deps.keySet)
    : undefined;

  function getKeySet(): Promise<JWTVerifyGetKey> {
    if (!keySetPromise) {
      keySetPromise = (async () => {
        if (effectiveJwksUrl) {
          return jwksFactory(new URL(effectiveJwksUrl));
        }
        const res = await fetchFn(discoveryUrl);
        if (!res.ok) throw new Error(`OIDC discovery returned ${res.status}`);
        const doc = (await res.json()) as { issuer?: string; jwks_uri?: string };
        if (doc.issuer !== cfg.issuerUrl) throw new Error('OIDC discovery issuer does not match configured issuer');
        if (!doc.jwks_uri) throw new Error('OIDC discovery missing jwks_uri');
        return jwksFactory(new URL(doc.jwks_uri));
      })().catch((e) => {
        keySetPromise = undefined; // allow retry on next call after a failed discovery
        throw e;
      });
    }
    return keySetPromise;
  }

  return {
    async healthCheck() {
      return probe(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          // Probe the endpoint used for verification, including an explicit internal signing-key URL.
          const probeUrl = effectiveJwksUrl ?? discoveryUrl;
          const res = await fetchFn(probeUrl, { signal: controller.signal });
          if (!res.ok) throw new Error(`OIDC ${effectiveJwksUrl ? 'JWKS' : 'discovery'} returned ${res.status}`);
          return effectiveJwksUrl ? 'OIDC JWKS reachable (internal)' : 'OIDC issuer reachable';
        } finally {
          clearTimeout(timer);
        }
      });
    },
    async verifyToken(token: string): Promise<TokenClaims> {
      const jwks = await getKeySet();
      const { payload } = await jwtVerify(token, jwks, {
        issuer: cfg.issuerUrl,
        audience: cfg.audience,
        algorithms: ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('token missing sub claim');
      }
      return payload as TokenClaims;
    },
  };
}
