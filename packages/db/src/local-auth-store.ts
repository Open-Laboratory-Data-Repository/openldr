import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { LocalAuthStore, LocalCredential, LocalSession, StoredSigningKey } from '@openldr/ports';
import type { InternalSchema } from './schema/internal';

// Storage for AUTH_ADAPTER=local (migration 116). No hashing, token or policy logic lives here:
// callers pass hashes in and decide what a lock or an expiry means.

interface CredentialRow {
  user_id: string; password_hash: string; must_change: boolean; failed_count: number;
  locked_until: Date | null; password_changed_at: Date;
}
interface SessionRow {
  id: string; user_id: string; secret_hash: string; created_at: Date; last_used_at: Date; expires_at: Date;
}
interface SigningKeyRow { kid: string; sealed_private_jwk: string; public_jwk: unknown }

function toCredential(r: CredentialRow): LocalCredential {
  return {
    userId: r.user_id,
    passwordHash: r.password_hash,
    mustChange: r.must_change,
    failedCount: r.failed_count,
    lockedUntil: r.locked_until,
    passwordChangedAt: r.password_changed_at,
  };
}

function toSession(r: SessionRow): LocalSession {
  return {
    id: r.id,
    userId: r.user_id,
    secretHash: r.secret_hash,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
  };
}

function toSigningKey(r: SigningKeyRow): StoredSigningKey {
  const jwk = typeof r.public_jwk === 'string' ? JSON.parse(r.public_jwk) : r.public_jwk;
  return { kid: r.kid, sealedPrivateJwk: r.sealed_private_jwk, publicJwk: jwk as Record<string, unknown> };
}

const SESSION_COLS = ['id', 'user_id', 'secret_hash', 'created_at', 'last_used_at', 'expires_at'] as const;

export function createLocalAuthStore(db: Kysely<InternalSchema>): LocalAuthStore {
  async function getSigningKey(): Promise<StoredSigningKey | null> {
    const row = await db.selectFrom('auth_signing_keys')
      .select(['kid', 'sealed_private_jwk', 'public_jwk'])
      .where('id', '=', 1)
      .executeTakeFirst();
    return row ? toSigningKey(row) : null;
  }

  return {
    async createUser(input) {
      const id = randomUUID();
      await db.insertInto('users').values({
        id,
        subject: id,
        username: input.username,
        email: input.email ?? null,
        display_name: input.displayName ?? null,
        roles: JSON.stringify([]) as never,
        rbac_initialized: true,
      }).execute();
      return { id };
    },

    async findUserIdByIdentifier(identifier) {
      const exact = await db.selectFrom('users').select('id').where('username', '=', identifier).executeTakeFirst();
      if (exact) return exact.id;
      // Two rows are enough to know a match is ambiguous.
      const byName = await db.selectFrom('users').select('id')
        .where(sql`lower(username)`, '=', sql`lower(${identifier})`)
        .limit(2).execute();
      if (byName.length === 1) return byName[0]!.id;
      if (byName.length > 1) return null;
      const byEmail = await db.selectFrom('users').select('id')
        .where(sql`lower(email)`, '=', sql`lower(${identifier})`)
        .limit(2).execute();
      return byEmail.length === 1 ? byEmail[0]!.id : null;
    },

    async getCredential(userId) {
      const row = await db.selectFrom('local_credentials').selectAll().where('user_id', '=', userId).executeTakeFirst();
      return row ? toCredential(row) : null;
    },

    async setPassword(userId, passwordHash, mustChange) {
      await db.insertInto('local_credentials')
        .values({ user_id: userId, password_hash: passwordHash, must_change: mustChange })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({
          password_hash: passwordHash,
          must_change: mustChange,
          failed_count: 0,
          locked_until: null,
          password_changed_at: sql`now()`,
        }))
        .execute();
    },

    async setNames(userId, firstName, lastName) {
      await db.updateTable('users')
        .set({ first_name: firstName, last_name: lastName, updated_at: new Date() })
        .where('id', '=', userId)
        .execute();
    },

    async getNames(userId) {
      const row = await db.selectFrom('users').select(['first_name', 'last_name']).where('id', '=', userId).executeTakeFirst();
      return { firstName: row?.first_name ?? null, lastName: row?.last_name ?? null };
    },

    // One statement, so two wrong tries at once both count. Reaching the limit resets the count
    // to zero, so one typo after the lock ends does not lock the account again.
    async recordFailure(userId, now, maxFailures, lockMs) {
      const lockUntil = new Date(now.getTime() + lockMs);
      const row = await db.updateTable('local_credentials')
        .set({
          failed_count: sql`case when failed_count + 1 >= ${maxFailures} then 0 else failed_count + 1 end`,
          locked_until: sql`case when failed_count + 1 >= ${maxFailures} then ${lockUntil} else locked_until end`,
        })
        .where('user_id', '=', userId)
        .returning('locked_until')
        .executeTakeFirst();
      return { lockedUntil: row?.locked_until ?? null };
    },

    async clearFailures(userId) {
      await db.updateTable('local_credentials')
        .set({ failed_count: 0, locked_until: null })
        .where('user_id', '=', userId)
        .execute();
    },

    async anyCredentialExists() {
      const row = await db.selectFrom('local_credentials').select('user_id').limit(1).executeTakeFirst();
      return row !== undefined;
    },

    async createSession(input) {
      const row = await db.insertInto('auth_sessions').values({
        id: randomUUID(),
        user_id: input.userId,
        secret_hash: input.secretHash,
        expires_at: input.expiresAt,
        ip: input.ip,
        user_agent: input.userAgent,
      }).returning(SESSION_COLS).executeTakeFirstOrThrow();
      return toSession(row);
    },

    async getSession(id) {
      const row = await db.selectFrom('auth_sessions').select(SESSION_COLS).where('id', '=', id).executeTakeFirst();
      return row ? toSession(row) : null;
    },

    async touchSession(id, now) {
      await db.updateTable('auth_sessions').set({ last_used_at: now }).where('id', '=', id).execute();
    },

    async deleteSession(id) {
      await db.deleteFrom('auth_sessions').where('id', '=', id).execute();
    },

    async deleteSessionsForUser(userId, exceptSessionId) {
      let q = db.deleteFrom('auth_sessions').where('user_id', '=', userId);
      if (exceptSessionId !== undefined) q = q.where('id', '<>', exceptSessionId);
      const res = await q.executeTakeFirst();
      return Number(res.numDeletedRows);
    },

    getSigningKey,

    async insertSigningKeyIfNone(key) {
      // Two processes starting together both land here. The singleton id makes the second insert
      // a no-op, so both read back the same row.
      await db.insertInto('auth_signing_keys')
        .values({ id: 1, kid: key.kid, sealed_private_jwk: key.sealedPrivateJwk, public_jwk: JSON.stringify(key.publicJwk) })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
      const stored = await getSigningKey();
      if (!stored) throw new Error('auth_signing_keys is empty after insert');
      return stored;
    },

    async replaceSetupCode(codeHash, expiresAt) {
      await db.insertInto('auth_setup_code')
        .values({ id: 1, code_hash: codeHash, expires_at: expiresAt })
        .onConflict((oc) => oc.column('id').doUpdateSet({ code_hash: codeHash, expires_at: expiresAt }))
        .execute();
    },

    async consumeSetupCode(codeHash, now) {
      const res = await db.deleteFrom('auth_setup_code')
        .where('id', '=', 1)
        .where('code_hash', '=', codeHash)
        .where('expires_at', '>', now)
        .executeTakeFirst();
      return Number(res.numDeletedRows) > 0;
    },
  };
}
