import {
  createAppContext, recordAuditEvent, setAccountStatus, AccountNotFoundError, listUserDirectory,
  getUserPreferences, saveUserPreferences, userPreferencesPatchSchema, type UserPreferencesPatch,
  createLocalAccount, resetLocalPassword, endLocalSessions, LocalSignInNotEnabledError, UnknownUserError,
  UnknownRoleError,
} from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';

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
  if (err instanceof UnknownUserError) return `no user named ${username}. Usernames here match exactly, including case.`;
  return null;
}

export async function runUserCreate(opts: JsonOpt & { username: string; name?: string; email?: string; role?: string[] }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (ctx.localSignIn) {
      // The role store refuses a change that leaves nobody able to manage roles, so the first
      // admin has to come from studio's setup page.
      if (await ctx.localSignIn.setupRequired()) {
        process.stderr.write('no administrator exists yet. Run "openldr auth setup-code" and finish setup in studio first.\n');
        return 1;
      }
      let created: Awaited<ReturnType<typeof createLocalAccount>>;
      try {
        created = await createLocalAccount(ctx, cliActor(), {
          username: opts.username, name: opts.name, email: opts.email, roles: opts.role,
        });
      } catch (err) {
        if (!(err instanceof UnknownRoleError)) throw err;
        process.stderr.write(`no role named ${err.slug}\n`);
        return 1;
      }
      const { user, temporaryPassword } = created;
      emit(
        opts.json,
        { user, temporaryPassword },
        `created ${user.username} (${user.id})\ntemporary password: ${temporaryPassword}\n${user.username} must change it at first sign-in.`,
      );
      return 0;
    }
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
      await setAccountStatus(ctx, { localId: id }, status === 'active', { ...cliActor(), actorName: 'cli' });
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

