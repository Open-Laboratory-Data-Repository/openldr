import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { looksLikeAccessKey, type AppContext } from '@openldr/bootstrap';
import { safeRecord } from '@openldr/audit';
import { CAPABILITY_KEYS } from '@openldr/rbac';
import { reasonFromError, createAuthFailedThrottle, subFromUnverifiedToken, type AuthFailReason } from './auth-failed';
import { INVALID_ACCESS_KEY, signInWithAccessKey } from './access-key-auth';

export interface RequestActor {
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
  capabilities: string[];
  /** Set when the request signed in with an access key. The key's row ID and name, never the key. */
  accessKey?: { id: string; name: string };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestActor;
    /** The verified token's `sid` claim, when it is a string. Local sign-in uses it as the session ID. */
    sessionId?: string;
  }
}

// Local sign-in routes that work without a bearer token. Exact paths only.
const LOCAL_SIGN_IN_PUBLIC_PATHS = new Set(['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/auth/setup']);
// The one route a token marked `pwd_change` may reach. Exact path, so no other route shares it.
const CHANGE_PASSWORD_PATH = '/api/auth/change-password';

function headerBearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) { const t = h.slice('Bearer '.length).trim(); if (t) return t; }
  return null;
}

/** The `access_token` query parameter on any path, trimmed, or null. */
function queryAccessToken(req: FastifyRequest): string | null {
  const url = req.raw.url ?? '';
  if (!url.includes('?')) return null;
  const tok = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('access_token');
  return tok && tok.trim() ? tok.trim() : null;
}

export function bearer(req: FastifyRequest): string | null {
  const fromHeader = headerBearer(req);
  if (fromHeader) return fromHeader;
  const path = (req.raw.url ?? '').split('?')[0];
  // Server-Sent Events streams (ontology build/rebuild) cannot set an Authorization header,
  // so accept the access token from the query string for THOSE routes only. It is verified
  // identically to a header token — no weakening of auth.
  if (/^\/api\/terminology\/ontology\/[^/]+\/(build|rebuild)$/.test(path)) return queryAccessToken(req);
  return null;
}

const PROVIDER_DEFAULT_ROLE = (n: string): boolean =>
  n.startsWith('default-roles') || n === 'offline_access' || n === 'uma_authorization';

/**
 * RBAC roles come from the verified token's `realm_access.roles` (Keycloak owns roles in
 * the decoupled model), with provider-default roles filtered out. The local user record is
 * only the audit-actor identity + the disable switch — never the authorization source.
 */
function realmRolesFromClaims(claims: Record<string, unknown>): string[] {
  const ra = claims['realm_access'];
  const roles = ra && typeof ra === 'object' ? (ra as { roles?: unknown }).roles : undefined;
  if (!Array.isArray(roles)) return [];
  return roles.filter((r): r is string => typeof r === 'string' && !PROVIDER_DEFAULT_ROLE(r));
}

async function devActor(ctx: AppContext): Promise<RequestActor> {
  const username = ctx.cfg.AUTH_DEV_USERNAME ?? 'dev-admin';
  const roles = (ctx.cfg.AUTH_DEV_ROLES ?? 'lab_admin')
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  try {
    const existing = await ctx.users.getByUsername(username);
    const u = existing ?? (await ctx.users.create({ username, displayName: 'Dev Admin', roles }));
    return { id: u.id, username: u.username, displayName: u.displayName, roles: u.roles.length > 0 ? u.roles : roles, capabilities: [...CAPABILITY_KEYS] };
  } catch (e) {
    ctx.logger.warn({ error: e instanceof Error ? e.message : String(e) }, 'dev-bypass actor fell back to synthetic (user store unavailable)');
    return { id: `dev:${username}`, username, displayName: 'Dev Admin', roles, capabilities: [...CAPABILITY_KEYS] };
  }
}

export function registerAuth(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const throttle = createAuthFailedThrottle();
  const recordAuthFailed = (req: FastifyRequest, reason: AuthFailReason, sub: string | null) => {
    const key = req.ip; // throttle per connection IP; `sub` is attacker-controlled (unverified) and must NOT key the throttle
    if (!throttle(key, reason)) return;
    void safeRecord(ctx.audit, ctx.logger, {
      actorType: sub ? 'user' : 'system',
      actorId: sub,
      actorName: sub ?? req.ip,
      action: 'auth.failed', entityType: 'auth', entityId: reason,
      metadata: { reason, ip: req.ip },
    });
  };

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = (req.raw.url ?? '').split('?')[0];
    // Only /api/* is protected. /health and the static SPA stay public.
    if (path === '/api/config') return; // public: the SPA reads OIDC settings before it has a token
    // Local sign-in: these routes check a password, a cookie or a setup code themselves. Only
    // when local sign-in is on, so Keycloak and OIDC installs keep answering 401 here.
    if (ctx.localSignIn && LOCAL_SIGN_IN_PUBLIC_PATHS.has(path)) return;
    // Webhook trigger endpoints authenticate via their per-path X-Webhook-Token secret (a
    // constant-time compare in the route), not a Keycloak session — external callers have no
    // bearer token. Let them through to the route's own secret check. The trailing slash keeps
    // this scoped to the hooks subtree, so workflow management routes (/api/workflows) stay gated.
    if (path.startsWith('/api/workflows/hooks/')) return;
    // Distributed-sync push endpoints authenticate via their OWN client-credentials check in the
    // route (a machine client has no local user record, so users.syncFromClaims must not run for
    // it). The trailing slash scopes this to the sync subtree. Analogous to the hooks bypass above.
    if (path.startsWith('/api/sync/')) return;
    if (path !== '/api' && !path.startsWith('/api/')) return;

    // An access key is accepted in the Authorization header only. A key in the URL is refused
    // unread, on every path and whatever the header holds, so it is never resolved or marked used.
    // A key never reaches verifyToken. It is checked before the dev bypass: only a request with no
    // credential at all gets the dev actor. A failure is audited with a reason and the address only.
    const urlToken = queryAccessToken(req);
    if (urlToken && looksLikeAccessKey(urlToken)) {
      recordAuthFailed(req, 'invalid-access-key', null);
      reply.code(INVALID_ACCESS_KEY.status);
      return reply.send({ error: INVALID_ACCESS_KEY.error });
    }
    const headerToken = headerBearer(req);
    if (headerToken && looksLikeAccessKey(headerToken)) {
      let result: Awaited<ReturnType<typeof signInWithAccessKey>>;
      try {
        result = await signInWithAccessKey(ctx, headerToken);
      } catch (e) {
        // Not the error itself: its text or detail could quote a query parameter. A database
        // error code (such as 57P01) is safe and enough to start looking.
        const code = (e as { code?: unknown } | null)?.code;
        ctx.logger.error({ code: typeof code === 'string' ? code : undefined }, 'access key sign-in failed');
        recordAuthFailed(req, 'access-key-lookup-failed', null);
        reply.code(401);
        return reply.send({ error: 'authentication failed' });
      }
      if (!result.ok) {
        recordAuthFailed(req, result.status === 403 ? 'account-disabled' : 'invalid-access-key', null);
        reply.code(result.status);
        return reply.send({ error: result.error });
      }
      req.user = result.user;
      return;
    }

    const token = bearer(req);
    if (!token) {
      if (ctx.cfg.AUTH_DEV_BYPASS) {
        req.user = await devActor(ctx);
        return;
      }
      recordAuthFailed(req, 'missing', null);
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }

    let claims: Awaited<ReturnType<typeof ctx.auth.verifyToken>>;
    try {
      claims = await ctx.auth.verifyToken(token);
    } catch (e) {
      ctx.logger.warn({ error: e instanceof Error ? e.message : String(e) }, 'token verification failed');
      recordAuthFailed(req, reasonFromError(e), subFromUnverifiedToken(token));
      reply.code(401);
      return reply.send({ error: 'invalid token' });
    }

    // Only local sign-in issues `pwd_change`. Such a token works on change-password alone. Other
    // modes have no change-password route, so a claim of that name from them is ignored.
    if (ctx.localSignIn && (claims as { pwd_change?: unknown }).pwd_change === true && path !== CHANGE_PASSWORD_PATH) {
      reply.code(403);
      return reply.send({ error: 'password_change_required' });
    }
    const sid = (claims as { sid?: unknown }).sid;
    if (typeof sid === 'string') req.sessionId = sid;

    try {
      if (await ctx.users.isSubjectBlocked(claims.sub)) {
        recordAuthFailed(req, 'account-disabled', claims.sub);
        reply.code(403);
        return reply.send({ error: 'account disabled' });
      }
      const u = await ctx.users.syncFromClaims(claims);
      if (u.status === 'disabled') {
        recordAuthFailed(req, 'account-disabled', (claims as { sub?: string }).sub ?? null);
        reply.code(403);
        return reply.send({ error: 'account disabled' });
      }
      // One-time migration: map the token's realm roles to system roles the first
      // time we see this user. After that, user_roles (DB) is authoritative.
      const legacyRoles = ctx.cfg.AUTH_ADAPTER === 'oidc' ? [] : realmRolesFromClaims(claims);
      if (!u.rbacInitialized) {
        await ctx.roles.backfillUserFromRoleNames(u.subject ?? (claims as { sub?: string }).sub ?? u.id, legacyRoles);
        await ctx.users.markRbacInitialized(u.id);
      }
      const subject = u.subject ?? (claims as { sub?: string }).sub ?? u.id;
      const capabilities = await ctx.roles.resolveCapabilities(subject);
      req.user = { id: u.id, username: u.username, displayName: u.displayName, roles: legacyRoles, capabilities };
    } catch (e) {
      ctx.logger.error({ error: e instanceof Error ? e.message : String(e) }, 'user sync failed');
      recordAuthFailed(req, 'sync-failed', (claims as { sub?: string }).sub ?? null);
      reply.code(401);
      return reply.send({ error: 'authentication failed' });
    }
  });
}
