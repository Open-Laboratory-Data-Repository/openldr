// HTTP routes for AUTH_ADAPTER=local: sign in, refresh, sign out, change password and first-admin
// setup. The sign-in rules live in ctx.localSignIn. This file maps its results to status codes,
// handles the session cookie, limits attempts per address and writes audit rows.
//
// No audit row or log line here holds a password, a setup code, a cookie value or the identifier
// typed at sign-in. People type passwords into the username field.
import { isIPv4, isIPv6 } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { safeRecord } from '@openldr/audit';
import type { AppContext } from '@openldr/bootstrap';
import { createAuthFailedThrottle, type AuthFailReason } from './auth-failed';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './session-cookie';

export const SIGN_IN_ATTEMPTS_PER_WINDOW = 30;
export const SIGN_IN_WINDOW_MS = 60_000;

/** The eight 16-bit groups of a valid IPv6 address, or null. A dotted IPv4 tail becomes two groups. */
function ipv6Groups(address: string): number[] | null {
  let s = address.split('%')[0] ?? '';
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return null;
    const [a, b, c, d] = tail.split('.').map(Number) as [number, number, number, number];
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * The limiter key for an address. IPv4 and IPv4-mapped IPv6 (`::ffff:1.2.3.4`) key by the IPv4
 * address. Other IPv6 keys by its /64, because one host usually owns a whole /64 and could
 * otherwise rotate addresses to skip the limit. Anything that does not parse keys as itself.
 */
export function networkKey(address: string): string {
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return address;
  const g = ipv6Groups(address);
  if (!g) return address;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`;
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

/**
 * A fixed-window counter per key. Returns true when the attempt is allowed. A full map never
 * refuses anyone: a new key evicts the oldest one. Refusing on a full map would let one attacker
 * who fills it block every new sign-in. The four-hash cap and the per-account lock already bound
 * CPU use and password guessing, so failing open here costs less than that.
 */
export function createAttemptLimiter(opts: { limit?: number; windowMs?: number; maxEntries?: number; now?: () => number } = {}) {
  const limit = opts.limit ?? SIGN_IN_ATTEMPTS_PER_WINDOW;
  const windowMs = opts.windowMs ?? SIGN_IN_WINDOW_MS;
  const maxEntries = opts.maxEntries ?? 10_000;
  const now = opts.now ?? Date.now;
  // A Map keeps insertion order, so its first key is the oldest window.
  const windows = new Map<string, { count: number; endsAt: number }>();
  return function allow(key: string): boolean {
    const t = now();
    const current = windows.get(key);
    if (current && current.endsAt > t) {
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    }
    // An ended window is deleted, so the new one goes to the end of the order.
    if (current) windows.delete(key);
    if (windows.size >= maxEntries) {
      const oldest = windows.keys().next().value;
      if (oldest !== undefined) windows.delete(oldest);
    }
    windows.set(key, { count: 1, endsAt: t + windowMs });
    return true;
  };
}

// A NUL byte in a text value makes Postgres throw, so these never reach the service.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const noControl = (s: string) => !CONTROL_CHARACTER.test(s);

// Caps run before any hash, so an oversized value costs nothing.
const MAX_PASSWORD = 1024;
const MAX_USERNAME = 320;

const loginBody = z.object({
  username: z.string().min(1).max(MAX_USERNAME).refine(noControl),
  password: z.string().min(1).max(MAX_PASSWORD),
});
const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD),
  // No minimum here: the service answers too_short, which the screen can show.
  newPassword: z.string().max(MAX_PASSWORD),
});
const setupBody = z.object({
  setupCode: z.string().min(1).max(64).refine(noControl),
  username: z.string().min(1).max(MAX_USERNAME).refine(noControl),
  displayName: z.string().max(200).refine(noControl).optional(),
  password: z.string().max(MAX_PASSWORD),
});

const FAILURE_ENTITY: Record<'invalid' | 'locked' | 'disabled', AuthFailReason> = {
  invalid: 'bad-credentials',
  locked: 'locked',
  disabled: 'account-disabled',
};

const SETUP_STATUS: Record<string, number> = { already_set_up: 409, bad_code: 401 };

function isHttps(req: FastifyRequest): boolean {
  // req.protocol reads X-Forwarded-Proto only when TRUST_PROXY is set.
  return req.protocol === 'https';
}

function userAgentOf(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}

function grantBody(g: { accessToken: string; expiresIn: number; mustChangePassword: boolean }) {
  return { accessToken: g.accessToken, expiresIn: g.expiresIn, mustChangePassword: g.mustChangePassword };
}

export function registerLocalAuthRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const signIn = ctx.localSignIn;
  if (!signIn) return;

  // One limiter for login and setup, so both share the same budget per network.
  const limiter = createAttemptLimiter();
  const allowAttempt = (ip: string) => limiter(networkKey(ip));
  const failedThrottle = createAuthFailedThrottle();

  /** The account's own username for the actor name. Never the typed identifier. */
  async function nameOf(userId: string): Promise<string> {
    try {
      return (await ctx.users.get(userId))?.username ?? userId;
    } catch {
      return userId;
    }
  }

  async function recordSignedIn(req: FastifyRequest, action: 'auth.login' | 'auth.setup' | 'auth.logout', userId: string): Promise<void> {
    await safeRecord(ctx.audit, ctx.logger, {
      actorType: 'user', actorId: userId, actorName: await nameOf(userId),
      action, entityType: 'user', entityId: userId,
      metadata: { ip: req.ip, userId },
    });
  }

  // A lock starts at most once per lock period, so this row needs no throttle.
  async function recordLockStarted(req: FastifyRequest, userId: string): Promise<void> {
    await safeRecord(ctx.audit, ctx.logger, {
      actorType: 'user', actorId: userId, actorName: userId,
      action: 'auth.locked', entityType: 'user', entityId: userId,
      metadata: { ip: req.ip, userId },
    });
  }

  async function recordLoginFailure(
    req: FastifyRequest, failure: { reason: 'invalid' | 'locked' | 'disabled'; userId?: string; lockStarted?: true },
  ): Promise<void> {
    const { userId } = failure;
    const actor = userId
      ? { actorType: 'user' as const, actorId: userId, actorName: userId }
      : { actorType: 'system' as const, actorId: null, actorName: req.ip };
    const entityId = FAILURE_ENTITY[failure.reason];
    // Keyed by address so a flood of wrong passwords cannot fill the audit table.
    if (failedThrottle(req.ip, entityId)) {
      await safeRecord(ctx.audit, ctx.logger, {
        ...actor, action: 'auth.failed', entityType: 'auth', entityId,
        metadata: { reason: entityId, ip: req.ip, ...(userId ? { userId } : {}) },
      });
    }
    if (failure.lockStarted && userId) await recordLockStarted(req, userId);
  }

  app.post('/api/auth/login', async (req, reply) => {
    if (!allowAttempt(req.ip)) return reply.code(429).send({ error: 'too_many_attempts' });
    const p = loginBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await signIn.login({
      identifier: p.data.username, password: p.data.password, ip: req.ip ?? null, userAgent: userAgentOf(req),
    });
    if (!result.ok) {
      await recordLoginFailure(req, result);
      // One answer for every reason, so a caller cannot tell a locked or disabled account apart.
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    setSessionCookie(reply, result.cookieValue, isHttps(req));
    await recordSignedIn(req, 'auth.login', result.userId);
    return reply.send(grantBody(result));
  });

  app.post('/api/auth/refresh', async (req, reply) => {
    const cookie = readSessionCookie(req.headers.cookie);
    const grant = cookie ? await signIn.refresh(cookie) : null;
    if (!grant) {
      clearSessionCookie(reply, isHttps(req));
      return reply.code(401).send({ error: 'session_ended' });
    }
    return reply.send(grantBody(grant));
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const cookie = readSessionCookie(req.headers.cookie);
    const ended = cookie ? await signIn.logout(cookie) : null;
    if (ended) await recordSignedIn(req, 'auth.logout', ended.userId);
    clearSessionCookie(reply, isHttps(req));
    return reply.code(204).send();
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    // The auth plugin has already verified the bearer token. Under the dev bypass there is no session.
    if (!req.user) return reply.code(401).send({ error: 'authentication required' });
    if (!req.sessionId) return reply.code(401).send({ error: 'session_ended' });
    const p = changePasswordBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await signIn.changePassword({
      userId: req.user.id, sessionId: req.sessionId,
      currentPassword: p.data.currentPassword, newPassword: p.data.newPassword,
    });
    if (result.outcome !== 'ok') {
      // A wrong current password counts toward the same lock as sign-in.
      if (result.lockStarted) await recordLockStarted(req, req.user.id);
      return reply.code(400).send({ error: result.outcome });
    }
    await safeRecord(ctx.audit, ctx.logger, {
      actorType: 'user', actorId: req.user.id, actorName: req.user.username,
      action: 'user.change_password', entityType: 'user', entityId: req.user.id,
      metadata: { ip: req.ip, userId: req.user.id },
    });
    return reply.code(204).send();
  });

  app.post('/api/auth/setup', async (req, reply) => {
    if (!allowAttempt(req.ip)) return reply.code(429).send({ error: 'too_many_attempts' });
    const p = setupBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await signIn.setup({
      setupCode: p.data.setupCode, username: p.data.username, displayName: p.data.displayName,
      password: p.data.password, ip: req.ip ?? null, userAgent: userAgentOf(req),
    });
    if (!result.ok) return reply.code(SETUP_STATUS[result.reason] ?? 400).send({ error: result.reason });
    setSessionCookie(reply, result.cookieValue, isHttps(req));
    await recordSignedIn(req, 'auth.setup', result.userId);
    return reply.code(201).send(grantBody(result));
  });
}
