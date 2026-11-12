// Sign-in rules for AUTH_ADAPTER=local: login, refresh, logout, change password, first-admin
// setup, lockout and session limits. Storage, users and roles come in through interfaces.
// Nothing here logs. No result carries a password, hash or session secret, apart from the
// cookie value from login and setup and the code from createSetupCode.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { LocalAuthStore, LocalSession } from '@openldr/ports';
import { checkPasswordRules, type PasswordHasher, type PasswordRuleFailure } from './password';
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken, type SigningKey } from './tokens';

export interface SignInUser { id: string; username: string; displayName: string | null; email: string | null; status: 'active' | 'disabled' }
export interface SignInUsers {
  get(id: string): Promise<SignInUser | undefined>;
  isSubjectBlocked(subject: string): Promise<boolean>;
}
export interface SignInRoles {
  rolesForUser(subject: string): Promise<Array<{ id: string; slug: string }>>;
  getBySlug(slug: string): Promise<{ id: string; slug: string } | null>;
  setUserRoles(subject: string, roleIds: string[]): Promise<void>;
}
export interface LocalSignInDeps {
  store: LocalAuthStore; users: SignInUsers; roles: SignInRoles;
  hasher: PasswordHasher; key: SigningKey; now?: () => Date;
}
export interface SessionGrant { accessToken: string; expiresIn: number; mustChangePassword: boolean }
export interface NewSession extends SessionGrant { cookieValue: string; cookieExpiresAt: Date; userId: string }
export type LoginResult = ({ ok: true } & NewSession) | { ok: false; reason: 'invalid' | 'locked' | 'disabled' };
export type SetupResult = ({ ok: true } & NewSession)
  | { ok: false; reason: 'already_set_up' | 'bad_code' | 'bad_username' | PasswordRuleFailure };
export interface LocalSignIn {
  setupRequired(): Promise<boolean>;
  login(input: { identifier: string; password: string; ip: string | null; userAgent: string | null }): Promise<LoginResult>;
  refresh(cookieValue: string): Promise<SessionGrant | null>;
  logout(cookieValue: string): Promise<{ userId: string } | null>;
  changePassword(input: { userId: string; sessionId: string; currentPassword: string; newPassword: string }): Promise<'ok' | 'wrong_current' | PasswordRuleFailure>;
  createSetupCode(): Promise<string>;
  setup(input: { setupCode: string; username: string; displayName?: string; password: string; ip: string | null; userAgent: string | null }): Promise<SetupResult>;
  sessionIsLive(sessionId: string): Promise<boolean>;
}

export const MAX_FAILURES = 5;
export const LOCK_MS = 5 * 60_000;
export const SESSION_IDLE_MS = 12 * 3_600_000;
export const SESSION_TOTAL_MS = 7 * 86_400_000;
export const SETUP_CODE_TTL_MS = 30 * 60_000;

/** A session's last-used time is written at most once a minute. */
const TOUCH_AFTER_MS = 60_000;
const SECRET_BYTES = 32;
const SETUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SETUP_CODE_LENGTH = 12;
const USERNAME = /^[A-Za-z0-9._-]{3,64}$/;
const FIRST_ADMIN_ROLE = 'lab_admin';
// Session IDs are UUIDs and secrets are base64url. Anything else never reaches the store,
// so a stray byte such as \0, which Postgres refuses in text, cannot make a lookup throw.
const COOKIE_PART = /^[A-Za-z0-9_-]+$/;

const INVALID = { ok: false, reason: 'invalid' } as const;
const LOCKED = { ok: false, reason: 'locked' } as const;
const DISABLED = { ok: false, reason: 'disabled' } as const;

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** `<sessionId>.<secret>`, exactly one dot, both halves non-empty. Null for anything else. */
function parseCookie(value: string): { sessionId: string; secret: string } | null {
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [sessionId, secret] = parts as [string, string];
  if (!COOKIE_PART.test(sessionId) || !COOKIE_PART.test(secret)) return null;
  return { sessionId, secret };
}

function secretMatches(secret: string, storedHash: string): boolean {
  const presented = Buffer.from(sha256Hex(secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return stored.length === presented.length && timingSafeEqual(presented, stored);
}

function isLive(session: LocalSession, now: Date): boolean {
  return now < session.expiresAt && now.getTime() - session.lastUsedAt.getTime() < SESSION_IDLE_MS;
}

/** Upper case with dashes removed, so `abcd-efgh-jkmn` and `ABCDEFGHJKMN` are the same code. */
function setupCodeHash(code: string): string {
  return sha256Hex(code.toUpperCase().replace(/-/g, ''));
}

export function createLocalSignIn(deps: LocalSignInDeps): LocalSignIn {
  const { store, users, roles, hasher, key } = deps;
  const clock = deps.now ?? (() => new Date());

  async function isAllowed(user: SignInUser): Promise<boolean> {
    // A local user's subject is its user ID.
    return user.status === 'active' && !(await users.isSubjectBlocked(user.id));
  }

  async function touchIfStale(session: LocalSession, now: Date): Promise<void> {
    if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_AFTER_MS) await store.touchSession(session.id, now);
  }

  async function grant(user: SignInUser, sessionId: string, mustChangePassword: boolean, now: Date): Promise<SessionGrant> {
    const userRoles = await roles.rolesForUser(user.id);
    const accessToken = await signAccessToken(key, {
      sub: user.id,
      username: user.username,
      name: user.displayName,
      email: user.email,
      sid: sessionId,
      roles: userRoles.map((r) => r.slug),
      mustChangePassword,
    }, now);
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, mustChangePassword };
  }

  async function openSession(
    user: SignInUser, mustChangePassword: boolean, ip: string | null, userAgent: string | null, now: Date,
  ): Promise<NewSession> {
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const session = await store.createSession({
      userId: user.id,
      secretHash: sha256Hex(secret),
      expiresAt: new Date(now.getTime() + SESSION_TOTAL_MS),
      ip,
      userAgent,
    });
    const g = await grant(user, session.id, mustChangePassword, now);
    return { ...g, cookieValue: `${session.id}.${secret}`, cookieExpiresAt: session.expiresAt, userId: user.id };
  }

  /** The session the cookie names, when the secret matches. Liveness is not checked here. */
  async function sessionForCookie(cookieValue: string): Promise<LocalSession | null> {
    const parsed = parseCookie(cookieValue);
    if (!parsed) return null;
    const session = await store.getSession(parsed.sessionId);
    if (!session || !secretMatches(parsed.secret, session.secretHash)) return null;
    return session;
  }

  return {
    async setupRequired() {
      return !(await store.anyCredentialExists());
    },

    async login(input) {
      const now = clock();
      const userId = await store.findUserIdByIdentifier(input.identifier);
      if (!userId) {
        await hasher.burn();
        return INVALID;
      }
      const credential = await store.getCredential(userId);
      if (!credential) {
        await hasher.burn();
        return INVALID;
      }
      // A lock time in the past is an old lock that has ended.
      if (credential.lockedUntil !== null && credential.lockedUntil > now) {
        await hasher.burn();
        return LOCKED;
      }
      if (!(await hasher.verify(input.password, credential.passwordHash))) {
        await store.recordFailure(userId, now, MAX_FAILURES, LOCK_MS);
        return INVALID;
      }
      const user = await users.get(userId);
      if (!user) return INVALID;
      if (!(await isAllowed(user))) return DISABLED;
      await store.clearFailures(userId);
      return { ok: true, ...(await openSession(user, credential.mustChange, input.ip, input.userAgent, now)) };
    },

    async refresh(cookieValue) {
      const now = clock();
      const session = await sessionForCookie(cookieValue);
      if (!session || !isLive(session, now)) return null;
      const user = await users.get(session.userId);
      const credential = user ? await store.getCredential(user.id) : null;
      if (!user || !credential || !(await isAllowed(user))) {
        await store.deleteSession(session.id);
        return null;
      }
      await touchIfStale(session, now);
      return grant(user, session.id, credential.mustChange, now);
    },

    async logout(cookieValue) {
      const session = await sessionForCookie(cookieValue);
      if (!session) return null;
      await store.deleteSession(session.id);
      return { userId: session.userId };
    },

    async changePassword(input) {
      const credential = await store.getCredential(input.userId);
      const user = await users.get(input.userId);
      if (!credential || !user) return 'wrong_current';
      if (!(await hasher.verify(input.currentPassword, credential.passwordHash))) return 'wrong_current';
      const rule = checkPasswordRules(input.newPassword, user.username);
      if (rule !== 'ok') return rule;
      await store.setPassword(input.userId, await hasher.hash(input.newPassword), false);
      await store.deleteSessionsForUser(input.userId, input.sessionId);
      return 'ok';
    },

    async createSetupCode() {
      let raw = '';
      for (let i = 0; i < SETUP_CODE_LENGTH; i++) raw += SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)];
      await store.replaceSetupCode(setupCodeHash(raw), new Date(clock().getTime() + SETUP_CODE_TTL_MS));
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
    },

    async setup(input) {
      if (await store.anyCredentialExists()) return { ok: false, reason: 'already_set_up' };
      if (!USERNAME.test(input.username)) return { ok: false, reason: 'bad_username' };
      const rule = checkPasswordRules(input.password, input.username);
      if (rule !== 'ok') return { ok: false, reason: rule };
      // Look the role up before the code is spent, so a missing role writes nothing.
      const adminRole = await roles.getBySlug(FIRST_ADMIN_ROLE);
      if (!adminRole) throw new Error(`the ${FIRST_ADMIN_ROLE} role does not exist`);

      const now = clock();
      // Spending the code first is what lets only one of two racing requests through.
      if (!(await store.consumeSetupCode(setupCodeHash(input.setupCode), now))) return { ok: false, reason: 'bad_code' };

      const passwordHash = await hasher.hash(input.password);
      const { id } = await store.createUser({ username: input.username, displayName: input.displayName ?? null });
      await store.setPassword(id, passwordHash, false);
      await roles.setUserRoles(id, [adminRole.id]);
      const user = await users.get(id);
      if (!user) throw new Error('the first admin was created but cannot be read back');
      return { ok: true, ...(await openSession(user, false, input.ip, input.userAgent, now)) };
    },

    async sessionIsLive(sessionId) {
      if (!COOKIE_PART.test(sessionId)) return false;
      const now = clock();
      const session = await store.getSession(sessionId);
      if (!session || !isLive(session, now)) return false;
      await touchIfStale(session, now);
      return true;
    },
  };
}
