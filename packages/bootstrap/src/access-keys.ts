// Access key actions that the HTTP routes, the sign-in step and the CLI share. A key is shown
// once, when it is made. Only its SHA-256 hash and its first 12 characters are stored. No key
// and no hash ever reaches a log line, an audit row or an error message.
import { createHash, randomBytes } from 'node:crypto';
import type { AuditStore } from '@openldr/audit';
import type { Logger } from '@openldr/core';
import type { AccessKeyRecord, AccessKeyStore } from '@openldr/db';
import type { UserStore } from '@openldr/users';
import { recordAuditEvent, type AuditActor } from './record-audit';

export const ACCESS_KEY_PREFIX = 'oldr_';
const KEY_BODY_BYTES = 32;
const STORED_PREFIX_LENGTH = 12;
const NAME_MAX_LENGTH = 80;

// The AppContext fields these actions use, typed here so this file does not import index.ts,
// which imports this file.
export interface KeyContext {
  accessKeys: AccessKeyStore; users: Pick<UserStore, 'get'>; audit: AuditStore; logger: Logger;
}

/** One error for no such key, another user's key and an already revoked key, so a caller
 *  cannot tell them apart. */
export class UnknownAccessKeyError extends Error {
  constructor() {
    super('no such access key');
    this.name = 'UnknownAccessKeyError';
  }
}

/** createAccessKey refused its input. The message says why and never holds a key. */
export class AccessKeyInputError extends Error {
  constructor(readonly reason: 'unknown_user' | 'empty_name' | 'name_too_long' | 'bad_expiry' | 'past_expiry', message: string) {
    super(message);
    this.name = 'AccessKeyInputError';
  }
}

/** `oldr_` plus 32 random bytes in base64url. */
export function generateAccessKey(): string {
  return ACCESS_KEY_PREFIX + randomBytes(KEY_BODY_BYTES).toString('base64url');
}

/** SHA-256 of the whole key, hex. Keys are random, so a fast hash is right. */
export function hashAccessKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function looksLikeAccessKey(value: string): boolean {
  return value.startsWith(ACCESS_KEY_PREFIX);
}

// A full ISO 8601 date-time with seconds and a zone: Z or an explicit offset. Date.parse alone
// takes "99999" as a year and reads a value with no zone in the server's own time zone.
const EXPIRY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** True when the written date and time exist, so "02-31" or "24:00" is not rolled over. */
function isRealDateTime(match: RegExpExecArray): boolean {
  const [y, mo, d, h, mi, s] = match.slice(1, 7).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
    && t.getUTCHours() === h && t.getUTCMinutes() === mi && t.getUTCSeconds() === s;
}

/** The ISO expiry to store, or null for none. Refuses a value that is not a full ISO date-time
 *  with a zone, or is not after now. */
function checkedExpiry(expiresAt: string | null | undefined, now: Date): string | null {
  if (expiresAt === undefined || expiresAt === null) return null;
  const match = EXPIRY_PATTERN.exec(expiresAt);
  const at = match && isRealDateTime(match) ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isNaN(at)) throw new AccessKeyInputError('bad_expiry', 'expiry is not a date');
  if (at <= now.getTime()) throw new AccessKeyInputError('past_expiry', 'expiry must be in the future');
  return new Date(at).toISOString();
}

/** The returned key is the only copy. It is never stored or logged. */
export async function createAccessKey(
  ctx: KeyContext,
  actor: AuditActor,
  input: { userId: string; name: string; expiresAt?: string | null },
): Promise<{ record: AccessKeyRecord; key: string }> {
  const name = input.name.trim();
  if (name === '') throw new AccessKeyInputError('empty_name', 'name is empty');
  if (name.length > NAME_MAX_LENGTH) throw new AccessKeyInputError('name_too_long', `name is over ${NAME_MAX_LENGTH} characters`);
  const expiresAt = checkedExpiry(input.expiresAt, new Date());
  if (!(await ctx.users.get(input.userId))) throw new AccessKeyInputError('unknown_user', 'no user has that id');

  const key = generateAccessKey();
  const record = await ctx.accessKeys.create({
    userId: input.userId,
    name,
    keyHash: hashAccessKey(key),
    prefix: key.slice(0, STORED_PREFIX_LENGTH),
    createdBy: actor.actorId ?? null,
    expiresAt,
  });
  await recordAuditEvent(ctx, actor, {
    action: 'access_key.create', entityType: 'access_key', entityId: record.id, before: null, after: record,
    metadata: { name: record.name, prefix: record.prefix, userId: record.userId },
  });
  return { record, key };
}

export async function listAccessKeys(ctx: KeyContext, userId: string): Promise<AccessKeyRecord[]> {
  return ctx.accessKeys.listForUser(userId);
}

/** Throws UnknownAccessKeyError when the store's conditional update changed nothing. */
export async function revokeAccessKey(
  ctx: KeyContext,
  actor: AuditActor,
  input: { userId: string; keyId: string },
): Promise<void> {
  // Read first only for the audit row's name and prefix. The update below decides the outcome,
  // because a read that says "not revoked" proves nothing by the time the update runs.
  const record = (await ctx.accessKeys.listForUser(input.userId)).find((k) => k.id === input.keyId);
  if (!(await ctx.accessKeys.revoke(input.keyId, input.userId, new Date()))) throw new UnknownAccessKeyError();
  await recordAuditEvent(ctx, actor, {
    action: 'access_key.revoke', entityType: 'access_key', entityId: input.keyId, before: null, after: null,
    metadata: { name: record?.name ?? null, prefix: record?.prefix ?? null, userId: input.userId },
  });
}

/** Null for anything that is not a usable key. Calls touchLastUsed on success.
 *
 *  This checks the key only: a known hash, not revoked, not expired at `now`. It does not check
 *  the account. A non-null answer is not "allowed": the sign-in step must still refuse a key
 *  whose account is disabled or blocked. */
export async function resolveAccessKey(ctx: KeyContext, key: string, now: Date): Promise<AccessKeyRecord | null> {
  if (!looksLikeAccessKey(key)) return null;
  const record = await ctx.accessKeys.findUsableByHash(hashAccessKey(key), now);
  if (!record) return null;
  try {
    await ctx.accessKeys.touchLastUsed(record.id, now);
  } catch (err) {
    // Best effort. The log names the key's row ID only, never the key, its hash or its prefix.
    ctx.logger.warn({ err, accessKeyId: record.id }, 'could not record when an access key was last used');
  }
  return record;
}
