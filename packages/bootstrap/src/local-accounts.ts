// Account actions for AUTH_ADAPTER=local that the CLI and the HTTP routes share. Each one refuses
// when local sign-in is off. Audit rows carry the username and never a password.
import { randomInt } from 'node:crypto';
import type { DirectoryUser } from '@openldr/ports';
import type { AppContext } from './index';
import { recordAuditEvent, type AuditActor } from './record-audit';

export class LocalSignInNotEnabledError extends Error {
  constructor() {
    super('local sign-in is not enabled; set AUTH_ADAPTER=local');
    this.name = 'LocalSignInNotEnabledError';
  }
}

export class SetupAlreadyDoneError extends Error {
  constructor() {
    super('setup is already done; an admin account exists');
    this.name = 'SetupAlreadyDoneError';
  }
}

export class UnknownUserError extends Error {
  constructor() {
    super('no user has that username');
    this.name = 'UnknownUserError';
  }
}

export class UnknownRoleError extends Error {
  constructor(readonly slug: string) {
    super(`no role named ${slug}`);
    this.name = 'UnknownRoleError';
  }
}

// No 0, 1, I, i, L, l, O or o, so a password read aloud or copied by hand comes out right.
const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const TEMPORARY_PASSWORD_LENGTH = 16;

type AccountContext = Pick<AppContext, 'localSignIn' | 'auth' | 'users' | 'roles' | 'audit' | 'logger'>;

export function generateTemporaryPassword(): string {
  let out = '';
  for (let i = 0; i < TEMPORARY_PASSWORD_LENGTH; i++) {
    out += TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)];
  }
  return out;
}

function requireLocalSignIn(ctx: Pick<AppContext, 'localSignIn'>) {
  if (!ctx.localSignIn) throw new LocalSignInNotEnabledError();
  return ctx.localSignIn;
}

/** The users row ID for an exact username. A local user's subject is its ID. */
async function userIdFor(ctx: AccountContext, username: string): Promise<string> {
  const user = await ctx.users.getByUsername(username);
  if (!user) throw new UnknownUserError();
  return user.id;
}

/** A new one-time code for creating the first admin. Replaces any earlier code. */
export async function createSetupCode(ctx: Pick<AppContext, 'localSignIn'>): Promise<string> {
  const signIn = requireLocalSignIn(ctx);
  if (!(await signIn.setupRequired())) throw new SetupAlreadyDoneError();
  return signIn.createSetupCode();
}

/** The account must change the returned password at first sign-in. Every role slug must exist,
 *  or nothing is created: the directory drops an unknown slug, which would leave a user with no role. */
export async function createLocalAccount(
  ctx: AccountContext,
  actor: AuditActor,
  input: { username: string; name?: string; email?: string; roles?: string[] },
): Promise<{ user: DirectoryUser; temporaryPassword: string }> {
  requireLocalSignIn(ctx);
  for (const slug of input.roles ?? []) {
    if (!(await ctx.roles.getBySlug(slug))) throw new UnknownRoleError(slug);
  }
  const temporaryPassword = generateTemporaryPassword();
  const user = await ctx.auth.directory.create({
    username: input.username,
    firstName: input.name,
    email: input.email,
    roles: input.roles,
    password: temporaryPassword,
    temporaryPassword: true,
  });
  await recordAuditEvent(ctx, actor, {
    action: 'user.create', entityType: 'user', entityId: user.id, before: null, after: user,
    metadata: { username: user.username },
  });
  return { user, temporaryPassword };
}

/** Sets a new temporary password and ends the user's sessions. */
export async function resetLocalPassword(
  ctx: AccountContext,
  actor: AuditActor,
  username: string,
): Promise<{ temporaryPassword: string }> {
  requireLocalSignIn(ctx);
  const userId = await userIdFor(ctx, username);
  const temporaryPassword = generateTemporaryPassword();
  await ctx.auth.resetPassword(userId, temporaryPassword, true);
  await recordAuditEvent(ctx, actor, {
    action: 'user.reset_password', entityType: 'user', entityId: userId, before: null, after: null,
    metadata: { username, temporary: true },
  });
  return { temporaryPassword };
}

/** Signs the user out everywhere. */
export async function endLocalSessions(ctx: AccountContext, actor: AuditActor, username: string): Promise<void> {
  requireLocalSignIn(ctx);
  const userId = await userIdFor(ctx, username);
  await ctx.auth.forceLogout(userId);
  await recordAuditEvent(ctx, actor, {
    action: 'user.force_logout', entityType: 'user', entityId: userId, before: null, after: null,
    metadata: { username },
  });
}
