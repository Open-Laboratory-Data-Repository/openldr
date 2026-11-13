// Sign-in with an access key. The sign-in hook in auth-plugin.ts calls this for a bearer value
// that has the key prefix, instead of verifyToken. The key is checked by resolveAccessKey; this
// file checks the account behind it, on every request, so a disable, a block or a role change
// takes effect on the next request. Nothing here is cached between requests.
//
// No key, hash or prefix is passed to the logger or put in an answer. Only the key's row ID and
// name leave this file.
import { resolveAccessKey, type AppContext } from '@openldr/bootstrap';

/** The same shape as RequestActor in auth-plugin.ts. Declared here so this file does not import
 *  auth-plugin.ts, which imports this file. */
export interface KeyActor {
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
  capabilities: string[];
  accessKey: { id: string; name: string };
}

export type KeySignIn =
  | { ok: true; user: KeyActor }
  // One answer for an unknown, revoked or expired key and for a key whose user row is gone, so a
  // caller cannot tell them apart.
  | { ok: false; status: 401; error: 'invalid access key' }
  | { ok: false; status: 403; error: 'account disabled' };

export const INVALID_ACCESS_KEY = { ok: false, status: 401, error: 'invalid access key' } as const;
const ACCOUNT_DISABLED = { ok: false, status: 403, error: 'account disabled' } as const;

type KeySignInContext = Pick<AppContext, 'accessKeys' | 'users' | 'roles' | 'audit' | 'logger' | 'cfg'>;

export async function signInWithAccessKey(ctx: KeySignInContext, key: string, now: Date = new Date()): Promise<KeySignIn> {
  const record = await resolveAccessKey(ctx, key, now);
  if (!record) return INVALID_ACCESS_KEY;
  const u = await ctx.users.get(record.userId);
  if (!u) return INVALID_ACCESS_KEY;

  // The subject is found as the token path finds it. A local account's subject is its ID.
  const subject = u.subject ?? u.id;
  if (u.status === 'disabled' || (await ctx.users.isSubjectBlocked(subject))) return ACCOUNT_DISABLED;

  const capabilities = await ctx.roles.resolveCapabilities(subject);
  // `roles` is what a token for the same account carries. A local sign-in token carries the
  // account's role slugs (packages/adapter-auth/src/local/sign-in.ts), and a Keycloak token
  // carries realm roles that were copied into user_roles on first sign-in. A generic OIDC token
  // carries none (auth-plugin.ts). The key has no token, so it reads the slugs from user_roles.
  const roles = ctx.cfg.AUTH_ADAPTER === 'oidc' ? [] : (await ctx.roles.rolesForUser(subject)).map((r) => r.slug);
  return {
    ok: true,
    user: {
      id: u.id, username: u.username, displayName: u.displayName, roles, capabilities,
      accessKey: { id: record.id, name: record.name },
    },
  };
}
