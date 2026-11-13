import {
  createAppContext, recordAuditEvent, setAccountStatus, AccountNotFoundError, listUserDirectory,
  getUserPreferences, saveUserPreferences, userPreferencesPatchSchema, type UserPreferencesPatch,
  createLocalAccount, resetLocalPassword, endLocalSessions, LocalSignInNotEnabledError, UnknownUserError,
  UnknownRoleError, createAccessKey, listAccessKeys, revokeAccessKey, looksLikeAccessKey, AccessKeyInputError,
  UnknownAccessKeyError,
} from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor, cliNamedActor } from './cli-actor';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runUserList(opts: JsonOpt): Promise<number> {
  return runUsersList(opts);
}

export async function runUsersList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const users = await ctx.users.list();
    emit(
      opts.json,
      users,
      users.map((u) => `${u.id}\t${u.username}\t${u.displayName ?? ''}\t${u.email ?? ''}\t${u.status}\t${u.roles.join(',')}\t${u.subject ?? ''}`).join('\n') || '(no users)',
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserShow(id: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const u = await ctx.users.get(id);
    if (!u) {
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    emit(opts.json, u, `${u.username} (${u.id}) status=${u.status} roles=[${u.roles.join(', ')}] sub=${u.subject ?? '-'}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

/** One line for each error a local-account action throws on purpose. Anything else is the caller's to redact. */
function localAccountRefusal(err: unknown, username: string): string | null {
  if (err instanceof LocalSignInNotEnabledError) return 'local sign-in is not enabled';
  if (err instanceof UnknownUserError) return unknownUsername(username);
  return null;
}

function unknownUsername(username: string): string {
  // A key pasted in the username's place must not be printed back.
  if (username.includes(ACCESS_KEY_MARK)) return 'no user has that name. Usernames here match exactly, including case.';
  return `no user named ${username}. Usernames here match exactly, including case.`;
}

/** Every access key starts with this. A username or key ID that holds it is a key in the wrong place. */
const ACCESS_KEY_MARK = 'oldr_';
/** A key ID: the UUID the key store gives each key. */
const KEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refuses a username that holds a key, without printing either. Null when it is fine. */
function keyAsUsernameRefusal(command: string, username: string): string | null {
  return username.includes(ACCESS_KEY_MARK) ? `${command} refused: that looks like a key, not a username. Give the account's username.` : null;
}

/** `opts.password` is false for `--no-password`. Commander sets it to true otherwise. */
export async function runUserCreate(
  opts: JsonOpt & { username: string; name?: string; email?: string; role?: string[]; password?: boolean },
): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (ctx.localSignIn) {
      // The role store refuses a change that leaves nobody able to manage roles, so the first
      // admin has to come from studio's setup page.
      if (await ctx.localSignIn.setupRequired()) {
        process.stderr.write('no administrator exists yet. Run "openldr auth setup-code" and finish setup in studio first.\n');
        return 1;
      }
      const input = { username: opts.username, name: opts.name, email: opts.email, roles: opts.role };
      try {
        if (opts.password === false) {
          const { user } = await createLocalAccount(ctx, cliActor(), { ...input, password: 'none' });
          emit(opts.json, { user }, `created ${user.username} (${user.id})\n${user.username} has no password and cannot sign in to Studio.`);
          return 0;
        }
        const { user, temporaryPassword } = await createLocalAccount(ctx, cliActor(), input);
        emit(
          opts.json,
          { user, temporaryPassword },
          `created ${user.username} (${user.id})\ntemporary password: ${temporaryPassword}\n${user.username} must change it at first sign-in.`,
        );
        return 0;
      } catch (err) {
        if (!(err instanceof UnknownRoleError)) throw err;
        process.stderr.write(`no role named ${err.slug}\n`);
        return 1;
      }
    }
    // Without local sign-in the identity provider holds every password, so --no-password changes nothing here.
    const u = await ctx.users.create({ username: opts.username, displayName: opts.name, email: opts.email, roles: opts.role });
    await recordAuditEvent(ctx, cliActor(), {
      action: 'user.create',
      entityType: 'user',
      entityId: u.id,
      metadata: { username: opts.username, roles: opts.role, backend: 'local' },
    });
    emit(opts.json, u, `created ${u.username} (${u.id})`);
    return 0;
  } finally {
    await ctx.close();
  }
}

/** Sets a new temporary password and ends the user's sessions. Refuses without --force before opening the database. */
export async function runUserResetPassword(username: string, opts: JsonOpt & { force: boolean }): Promise<number> {
  if (!opts.force) {
    process.stderr.write(
      `user reset-password refused: this sets a new temporary password for ${username} and ends all of their sessions.\n`
      + 'Re-run with --force to go ahead.\n',
    );
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    let temporaryPassword: string;
    try {
      ({ temporaryPassword } = await resetLocalPassword(ctx, cliActor(), username));
    } catch (err) {
      const refusal = localAccountRefusal(err, username);
      if (refusal === null) throw err;
      process.stderr.write(refusal + '\n');
      return 1;
    }
    emit(
      opts.json,
      { username, temporaryPassword },
      `temporary password for ${username}: ${temporaryPassword}\n${username} must change it at the next sign-in. Their sessions have ended.`,
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

/** Signs the user out everywhere. */
export async function runUserEndSessions(username: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    try {
      await endLocalSessions(ctx, cliActor(), username);
    } catch (err) {
      const refusal = localAccountRefusal(err, username);
      if (refusal === null) throw err;
      process.stderr.write(refusal + '\n');
      return 1;
    }
    emit(opts.json, { username, sessionsEnded: true }, `ended sessions for ${username}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

/** The users row ID for an exact username. Prints the message the other user commands give and
 *  returns null when there is none. Keys work on every sign-in adapter, so this needs no local sign-in. */
async function userIdOrRefuse(ctx: Awaited<ReturnType<typeof createAppContext>>, username: string): Promise<string | null> {
  const user = await ctx.users.getByUsername(username);
  if (user) return user.id;
  process.stderr.write(unknownUsername(username) + '\n');
  return null;
}

/** Text and JSON hold the stored record only. No key or hash exists to print. */
export async function runUserKeyList(username: string, opts: JsonOpt): Promise<number> {
  const asKey = keyAsUsernameRefusal('user key list', username);
  if (asKey) { process.stderr.write(`${asKey}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const userId = await userIdOrRefuse(ctx, username);
    if (userId === null) return 1;
    const keys = await listAccessKeys(ctx, userId);
    emit(
      opts.json,
      keys,
      keys.map((k) => [k.id, k.name, k.prefix, k.createdAt, k.expiresAt ?? '-', k.lastUsedAt ?? '-', k.revokedAt ?? '-'].join('\t')).join('\n')
        || '(no keys)',
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A bare YYYY-MM-DD means the end of that day in UTC. createAccessKey checks everything else. */
function expiryFromOption(value: string): string {
  return BARE_DATE.test(value) ? `${value}T23:59:59.999Z` : value;
}

function keyInputRefusal(err: AccessKeyInputError): string {
  if (err.reason === 'bad_expiry') {
    return '--expires must be a date (YYYY-MM-DD) or an ISO date-time ending in Z or an offset, such as 2030-01-31T12:00:00Z';
  }
  if (err.reason === 'past_expiry') return '--expires must be in the future';
  return `user key create refused: ${err.message}`;
}

/** The key goes to standard output alone, so `KEY=$(openldr user key create ...)` captures it.
 *  The notice goes to standard error. The key is never logged or audited. */
export async function runUserKeyCreate(username: string, opts: JsonOpt & { name: string; expires?: string }): Promise<number> {
  const asKey = keyAsUsernameRefusal('user key create', username);
  if (asKey) { process.stderr.write(`${asKey}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const userId = await userIdOrRefuse(ctx, username);
    if (userId === null) return 1;
    let created: Awaited<ReturnType<typeof createAccessKey>>;
    try {
      created = await createAccessKey(ctx, cliActor(), {
        userId, name: opts.name, expiresAt: opts.expires === undefined ? null : expiryFromOption(opts.expires),
      });
    } catch (err) {
      if (!(err instanceof AccessKeyInputError)) throw err;
      process.stderr.write(keyInputRefusal(err) + '\n');
      return 1;
    }
    const { key, record } = created;
    process.stdout.write(opts.json ? JSON.stringify({ key, record }, null, 2) + '\n' : key + '\n');
    process.stderr.write(`made key ${record.id} (${record.name}) for ${username}. It cannot be shown again, so store it now.\n`);
    return 0;
  } finally {
    await ctx.close();
  }
}

/** Refuses without --force before opening the database. One message for an unknown key, another
 *  user's key and an already revoked key. */
export async function runUserKeyRevoke(username: string, keyId: string, opts: { force: boolean }): Promise<number> {
  // Someone who pastes the key itself in place of its ID must not see it echoed back.
  if (looksLikeAccessKey(keyId)) {
    process.stderr.write('user key revoke refused: that is a key, not a key ID. Find the ID with "openldr user key list".\n');
    return 1;
  }
  // Anything else that is not a key ID could be a key with its start cut off: not echoed either.
  if (!KEY_ID.test(keyId)) {
    process.stderr.write('user key revoke refused: that is not a key ID. Find the ID with "openldr user key list".\n');
    return 1;
  }
  const asKey = keyAsUsernameRefusal('user key revoke', username);
  if (asKey) { process.stderr.write(`${asKey}\n`); return 1; }
  if (!opts.force) {
    process.stderr.write(
      `user key revoke refused: this revokes key ${keyId} of ${username}, and any program using it loses access at once.\n`
      + 'Re-run with --force to go ahead.\n',
    );
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const userId = await userIdOrRefuse(ctx, username);
    if (userId === null) return 1;
    try {
      await revokeAccessKey(ctx, cliActor(), { userId, keyId });
    } catch (err) {
      if (!(err instanceof UnknownAccessKeyError)) throw err;
      process.stderr.write(`${username} has no unrevoked key ${keyId}\n`);
      return 1;
    }
    process.stdout.write(`revoked key ${keyId} for ${username}\n`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserSetRole(id: string, roles: string[], opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (!(await ctx.users.get(id))) {
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    await ctx.users.setRoles(id, roles);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      metadata: { roles, backend: 'local' },
    });
    emit(opts.json, { id, roles }, `set roles for ${id}: [${roles.join(', ')}]`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserSetStatus(id: string, status: 'active' | 'disabled', opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    try {
      await setAccountStatus(ctx, { localId: id }, status === 'active', cliNamedActor());
    } catch (error) {
      if (!(error instanceof AccountNotFoundError)) throw error;
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    emit(opts.json, { id, status }, `${id} is now ${status}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserDirectoryList(opts: JsonOpt & { offset?: string; limit?: string; search?: string; enabled?: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const page = await listUserDirectory(ctx, { offset: opts.offset, limit: opts.limit, search: opts.search, enabled: opts.enabled });
    const lines = page.rows.map((u) => `${u.id}\t${u.username}\t${u.email ?? ''}\t${u.enabled ? 'active' : 'disabled'}`);
    lines.push(`offset=${page.offset} limit=${page.limit} hasMore=${page.hasMore}`);
    emit(opts.json, page, lines.join('\n'));
    return 0;
  } finally { await ctx.close(); }
}

const PREFERENCE_KEYS = ['theme', 'sidebarCollapsed', 'startPage', 'language', 'layout'];

/** Turn `<key> <value>` from the command line into a patch. `none` clears the key. */
export function parsePreferenceArg(key: string, value: string): UserPreferencesPatch {
  if (!PREFERENCE_KEYS.includes(key)) throw new Error(`unknown preference "${key}" (use ${PREFERENCE_KEYS.join(', ')})`);
  let parsed: unknown = value;
  if (value === 'none') parsed = null;
  else if (key === 'sidebarCollapsed' && (value === 'true' || value === 'false')) parsed = value === 'true';
  const result = userPreferencesPatchSchema.safeParse({ [key]: parsed });
  if (!result.success) throw new Error(`invalid value for ${key}: ${value}`);
  return result.data;
}

export async function runUserPreferencesShow(id: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (!(await ctx.users.get(id))) {
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    const prefs = await getUserPreferences(ctx.internalDb, id);
    const human = Object.entries(prefs).map(([k, v]) => `${k}=${String(v)}`).join('\n') || '(no preferences saved)';
    emit(opts.json, prefs, human);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserPreferencesSet(id: string, key: string, value: string, opts: JsonOpt): Promise<number> {
  // Parse before connecting, so a typo fails without opening the database.
  const patch = parsePreferenceArg(key, value);
  const ctx = await createAppContext(loadConfig());
  try {
    if (!(await ctx.users.get(id))) {
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    const prefs = await saveUserPreferences(ctx.internalDb, id, patch);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'user.preferences.update',
      entityType: 'user',
      entityId: id,
      metadata: { keys: Object.keys(patch) },
    });
    emit(opts.json, prefs, `set ${key} for ${id}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

