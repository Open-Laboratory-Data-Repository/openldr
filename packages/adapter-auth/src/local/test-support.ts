// In-memory fakes for testing local sign-in. Not used by production code.
import { randomUUID } from 'node:crypto';
import type { LocalAuthStore, LocalCredential, LocalSession, StoredSigningKey } from '@openldr/ports';
import type { DirectoryUsers } from './local-auth';
import type { SignInRoles, SignInUser } from './sign-in';

interface FakeUserRow {
  id: string; username: string; email: string | null; displayName: string | null;
  firstName: string | null; lastName: string | null; status: 'active' | 'disabled'; blocked: boolean;
}

export interface FakeClock { now(): Date; advance(ms: number): void }
export type FakeStore = LocalAuthStore & { credentialCount(): number };
export type FakeUsers = DirectoryUsers & { disable(username: string): void; block(username: string): void };
export type FakeRoles = SignInRoles & { slugsFor(userId: string): string[] };

/** The preset roles the fakes know about. */
export const FAKE_ROLES = [
  { id: 'role-lab-admin', slug: 'lab_admin' },
  { id: 'role-lab-technician', slug: 'lab_technician' },
  { id: 'role-data-analyst', slug: 'data_analyst' },
];

export function makeFakes(start: Date = new Date('2026-01-01T00:00:00Z')): {
  store: FakeStore; users: FakeUsers; roles: FakeRoles; clock: FakeClock;
} {
  let current = start.getTime();
  const clock: FakeClock = {
    now: () => new Date(current),
    advance(ms) {
      current += ms;
    },
  };

  const userRows = new Map<string, FakeUserRow>();
  const credentials = new Map<string, LocalCredential>();
  const sessions = new Map<string, LocalSession>();
  const userRoles = new Map<string, string[]>();
  let signingKey: StoredSigningKey | null = null;
  let setupCode: { codeHash: string; expiresAt: Date } | null = null;

  const byUsername = (username: string) => [...userRows.values()].find((u) => u.username === username);
  const mustFind = (username: string) => {
    const row = byUsername(username);
    if (!row) throw new Error(`fake user ${username} does not exist`);
    return row;
  };

  const store: FakeStore = {
    async createUser(input) {
      if (byUsername(input.username)) throw new Error('username already taken');
      const id = randomUUID();
      userRows.set(id, {
        id, username: input.username, email: input.email ?? null, displayName: input.displayName ?? null,
        firstName: null, lastName: null, status: 'active', blocked: false,
      });
      return { id };
    },

    // Same order as the real store: exact username, then one case-insensitive username, then one email.
    async findUserIdByIdentifier(identifier) {
      const exact = byUsername(identifier);
      if (exact) return exact.id;
      const lower = identifier.toLowerCase();
      const byName = [...userRows.values()].filter((u) => u.username.toLowerCase() === lower);
      if (byName.length === 1) return byName[0]!.id;
      if (byName.length > 1) return null;
      const byEmail = [...userRows.values()].filter((u) => u.email !== null && u.email.toLowerCase() === lower);
      return byEmail.length === 1 ? byEmail[0]!.id : null;
    },

    async getCredential(userId) {
      const c = credentials.get(userId);
      return c ? { ...c } : null;
    },

    async setPassword(userId, passwordHash, mustChange) {
      credentials.set(userId, {
        userId, passwordHash, mustChange, failedCount: 0, lockedUntil: null, passwordChangedAt: clock.now(),
      });
    },

    // No await between the compare and the write, matching the real single UPDATE.
    async replacePassword(userId, expectedPasswordHash, passwordHash, mustChange) {
      const c = credentials.get(userId);
      if (!c || c.passwordHash !== expectedPasswordHash) return false;
      credentials.set(userId, {
        userId, passwordHash, mustChange, failedCount: 0, lockedUntil: null, passwordChangedAt: clock.now(),
      });
      return true;
    },

    async setNames(userId, firstName, lastName) {
      const row = userRows.get(userId);
      if (row) Object.assign(row, { firstName, lastName });
    },

    async getNames(userId) {
      const row = userRows.get(userId);
      return { firstName: row?.firstName ?? null, lastName: row?.lastName ?? null };
    },

    // Mirrors the real store: reaching the limit sets the lock and resets the count to zero.
    async recordFailure(userId, now, maxFailures, lockMs) {
      const c = credentials.get(userId);
      if (!c) return { lockedUntil: null };
      if (c.failedCount + 1 >= maxFailures) {
        c.failedCount = 0;
        c.lockedUntil = new Date(now.getTime() + lockMs);
      } else {
        c.failedCount += 1;
      }
      return { lockedUntil: c.lockedUntil };
    },

    async clearFailures(userId) {
      const c = credentials.get(userId);
      if (c) Object.assign(c, { failedCount: 0, lockedUntil: null });
    },

    async anyCredentialExists() {
      return credentials.size > 0;
    },

    async createSession(input) {
      const now = clock.now();
      const s: LocalSession = {
        id: randomUUID(), userId: input.userId, secretHash: input.secretHash,
        createdAt: now, lastUsedAt: now, expiresAt: input.expiresAt,
      };
      sessions.set(s.id, s);
      return { ...s };
    },

    async getSession(id) {
      const s = sessions.get(id);
      return s ? { ...s } : null;
    },

    async touchSession(id, now) {
      const s = sessions.get(id);
      if (s) s.lastUsedAt = now;
    },

    async deleteSession(id) {
      sessions.delete(id);
    },

    async deleteSessionsForUser(userId, exceptSessionId) {
      let n = 0;
      for (const s of [...sessions.values()]) {
        if (s.userId === userId && s.id !== exceptSessionId) {
          sessions.delete(s.id);
          n++;
        }
      }
      return n;
    },

    async deleteDeadSessionsForUser(userId, now, idleMs) {
      const idleSince = now.getTime() - idleMs;
      let n = 0;
      for (const s of [...sessions.values()]) {
        if (s.userId === userId && (s.expiresAt <= now || s.lastUsedAt.getTime() <= idleSince)) {
          sessions.delete(s.id);
          n++;
        }
      }
      return n;
    },

    async getSigningKey() {
      return signingKey;
    },

    async insertSigningKeyIfNone(key) {
      if (!signingKey) signingKey = key;
      return signingKey;
    },

    async replaceSetupCode(codeHash, expiresAt) {
      setupCode = { codeHash, expiresAt };
    },

    // No await between the check and the delete, so two callers cannot both succeed.
    async consumeSetupCode(codeHash, now) {
      if (!setupCode || setupCode.codeHash !== codeHash || setupCode.expiresAt <= now) return false;
      setupCode = null;
      return true;
    },

    credentialCount: () => credentials.size,
  };

  const toSignInUser = (row: FakeUserRow): SignInUser =>
    ({ id: row.id, username: row.username, displayName: row.displayName, email: row.email, status: row.status });

  const users: FakeUsers = {
    async get(id) {
      const row = userRows.get(id);
      return row ? toSignInUser(row) : undefined;
    },
    async getByUsername(username) {
      const row = byUsername(username);
      return row ? toSignInUser(row) : undefined;
    },
    // Same filters and order as the real user store: username, then ID.
    async list(opts) {
      let rows = [...userRows.values()].sort((a, b) => a.username.localeCompare(b.username) || a.id.localeCompare(b.id));
      if (opts) {
        if (opts.enabled !== undefined) rows = rows.filter((r) => r.status === (opts.enabled ? 'active' : 'disabled'));
        if (opts.search) {
          const needle = opts.search.toLowerCase();
          rows = rows.filter((r) => [r.username, r.email, r.displayName].some((v) => v?.toLowerCase().includes(needle)));
        }
        rows = rows.slice(opts.offset, opts.offset + opts.limit);
      }
      return rows.map(toSignInUser);
    },
    async update(id, input) {
      const row = userRows.get(id);
      if (!row) return;
      if ('displayName' in input) row.displayName = input.displayName ?? null;
      if ('email' in input) row.email = input.email ?? null;
    },
    async setStatus(id, status) {
      const row = userRows.get(id);
      if (row) row.status = status;
    },
    // A local user's subject is its ID.
    async isSubjectBlocked(subject) {
      return userRows.get(subject)?.blocked ?? false;
    },
    disable(username) {
      mustFind(username).status = 'disabled';
    },
    block(username) {
      mustFind(username).blocked = true;
    },
  };

  const roles: FakeRoles = {
    async rolesForUser(subject) {
      return (userRoles.get(subject) ?? []).map((id) => FAKE_ROLES.find((r) => r.id === id)!);
    },
    async getBySlug(slug) {
      return FAKE_ROLES.find((r) => r.slug === slug) ?? null;
    },
    async setUserRoles(subject, roleIds) {
      userRoles.set(subject, [...roleIds]);
    },
    slugsFor(userId) {
      return (userRoles.get(userId) ?? []).map((id) => FAKE_ROLES.find((r) => r.id === id)!.slug);
    },
  };

  return { store, users, roles, clock };
}
