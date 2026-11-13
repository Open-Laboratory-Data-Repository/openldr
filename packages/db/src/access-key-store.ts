import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

// Storage for access keys (migration 117). No key making, hashing or policy lives here: callers
// pass the hash in, and decide what a key may do. The hash never leaves this file.

export interface AccessKeyRecord {
  id: string; userId: string; name: string; prefix: string;
  createdBy: string | null; createdAt: string;
  expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null;
}

export interface AccessKeyStore {
  create(input: { userId: string; name: string; keyHash: string; prefix: string; createdBy: string | null; expiresAt: string | null }): Promise<AccessKeyRecord>;
  /** Newest first, then by id, so the order is stable. */
  listForUser(userId: string): Promise<AccessKeyRecord[]>;
  /** Null when no key has this hash, or it is revoked, or it has expired at `now`. */
  findUsableByHash(keyHash: string, now: Date): Promise<AccessKeyRecord | null>;
  /** False when no such key belongs to that user or it was already revoked. */
  revoke(id: string, userId: string, now: Date): Promise<boolean>;
  /** One conditional update: writes only when last_used_at is null or more than 60 seconds before `now`. */
  touchLastUsed(id: string, now: Date): Promise<void>;
}

const LAST_USED_EVERY_MS = 60_000;

const COLS = ['id', 'user_id', 'name', 'prefix', 'created_by', 'created_at', 'expires_at', 'revoked_at', 'last_used_at'] as const;

interface Row {
  id: string; user_id: string; name: string; prefix: string; created_by: string | null;
  created_at: Date; expires_at: Date | null; revoked_at: Date | null; last_used_at: Date | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toRecord(r: Row): AccessKeyRecord {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    prefix: r.prefix,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    expiresAt: iso(r.expires_at),
    revokedAt: iso(r.revoked_at),
    lastUsedAt: iso(r.last_used_at),
  };
}

export function createAccessKeyStore(db: Kysely<InternalSchema>): AccessKeyStore {
  return {
    async create(input) {
      const row = await db.insertInto('access_keys').values({
        id: randomUUID(),
        user_id: input.userId,
        name: input.name,
        key_hash: input.keyHash,
        prefix: input.prefix,
        created_by: input.createdBy,
        expires_at: input.expiresAt === null ? null : new Date(input.expiresAt),
      }).returning(COLS).executeTakeFirstOrThrow();
      return toRecord(row);
    },

    async listForUser(userId) {
      const rows = await db.selectFrom('access_keys').select(COLS)
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'asc')
        .execute();
      return rows.map(toRecord);
    },

    // The expiry is compared with `now`, never the database clock, so callers and tests set the time.
    async findUsableByHash(keyHash, now) {
      const row = await db.selectFrom('access_keys').select(COLS)
        .where('key_hash', '=', keyHash)
        .where('revoked_at', 'is', null)
        .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
        .executeTakeFirst();
      return row ? toRecord(row) : null;
    },

    // One UPDATE, so two callers revoking the same key at once cannot both get true.
    async revoke(id, userId, now) {
      const res = await db.updateTable('access_keys')
        .set({ revoked_at: now })
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) > 0;
    },

    // One UPDATE, so two requests with the same key at once write at most one value.
    async touchLastUsed(id, now) {
      const before = new Date(now.getTime() - LAST_USED_EVERY_MS);
      await db.updateTable('access_keys')
        .set({ last_used_at: now })
        .where('id', '=', id)
        .where((eb) => eb.or([eb('last_used_at', 'is', null), eb('last_used_at', '<', before)]))
        .execute();
    },
  };
}
