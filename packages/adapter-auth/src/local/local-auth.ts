// AuthPort for AUTH_ADAPTER=local. Fills the same port Keycloak fills, from local accounts,
// so the Users routes and the auth plugin work unchanged. Nothing here logs, and no result or
// error carries a password or a hash.
import { jwtVerify } from 'jose';
import { probe } from '@openldr/core';
import {
  IdentityAdminNotConfiguredError,
  type AuthPort, type DirectoryUser, type LocalAuthStore, type SyncClientPort, type TokenClaims,
} from '@openldr/ports';
import { checkPasswordRules, createPasswordHasher, type PasswordHasher } from './password';
import { createLocalSignIn, type LocalSignIn, type SignInRoles, type SignInUser, type SignInUsers } from './sign-in';
import { LOCAL_ISSUER, loadOrCreateSigningKey } from './tokens';

export class PasswordResetEmailUnsupportedError extends Error {
  constructor() {
    super('password reset email is not supported under local sign-in');
    this.name = 'PasswordResetEmailUnsupportedError';
  }
}

export interface DirectoryUsers extends SignInUsers {
  list(opts?: { offset: number; limit: number; search?: string; enabled?: boolean }): Promise<SignInUser[]>;
  getByUsername(username: string): Promise<SignInUser | undefined>;
  update(id: string, input: { displayName?: string | null; email?: string | null }): Promise<void>;
  setStatus(id: string, status: 'active' | 'disabled'): Promise<void>;
}

export interface LocalAuthDeps {
  store: LocalAuthStore; users: DirectoryUsers; roles: SignInRoles;
  secretKey: Buffer; ping: () => Promise<void>; now?: () => Date; hasher?: PasswordHasher;
}

const DEFAULT_LIST_LIMIT = 100;

/** Joins the names with a space. Null when neither is set. */
function joinNames(firstName: string | null, lastName: string | null): string | null {
  const joined = [firstName, lastName].filter((n): n is string => !!n).join(' ');
  return joined === '' ? null : joined;
}

export async function createLocalAuth(deps: LocalAuthDeps): Promise<{ auth: AuthPort; signIn: LocalSignIn }> {
  const { store, users, roles } = deps;
  const clock = deps.now ?? (() => new Date());
  const hasher = deps.hasher ?? createPasswordHasher();
  const key = await loadOrCreateSigningKey(store, deps.secretKey);
  const signIn = createLocalSignIn({ store, users, roles, hasher, key, now: clock });

  async function mustGetUser(id: string): Promise<SignInUser> {
    const user = await users.get(id);
    if (!user) throw new Error('user not found');
    return user;
  }

  /** Throws `password <failure>` when the password breaks a rule. */
  function assertPasswordRules(password: string, username: string): void {
    const rule = checkPasswordRules(password, username);
    if (rule !== 'ok') throw new Error(`password ${rule}`);
  }

  /** Role slugs to IDs. Unknown slugs are dropped. */
  async function roleIds(slugs: string[]): Promise<string[]> {
    const ids = new Set<string>();
    for (const slug of slugs) {
      const role = await roles.getBySlug(slug);
      if (role) ids.add(role.id);
    }
    return [...ids];
  }

  async function toDirectoryUser(user: SignInUser): Promise<DirectoryUser> {
    const [names, userRoles] = await Promise.all([store.getNames(user.id), roles.rolesForUser(user.id)]);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: names.firstName,
      lastName: names.lastName,
      enabled: user.status === 'active',
      roles: userRoles.map((r) => r.slug),
      createdAt: null,
    };
  }

  const unavailable = async (): Promise<never> => {
    throw new IdentityAdminNotConfiguredError();
  };
  const clients: SyncClientPort = {
    findUuidByClientId: unavailable, createConfidentialClient: unavailable, addSiteIdMapper: unavailable,
    addAudienceMapper: unavailable, getClientSecret: unavailable, regenerateClientSecret: unavailable, deleteClient: unavailable,
  };

  const auth: AuthPort = {
    async healthCheck() {
      return probe(async () => {
        await deps.ping();
        return 'local sign-in ready';
      });
    },

    // A disabled or blocked user is refused per request by the auth plugin, not here.
    async verifyToken(token: string): Promise<TokenClaims> {
      const { payload } = await jwtVerify(token, key.keySet, {
        issuer: LOCAL_ISSUER,
        algorithms: ['ES256'],
        currentDate: clock(),
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('token missing sub claim');
      if (typeof payload.sid !== 'string' || payload.sid.length === 0) throw new Error('token missing sid claim');
      // The session must belong to the subject, a second check besides the signature.
      if (!(await signIn.sessionIsLive(payload.sid, payload.sub))) throw new Error('session ended');
      return payload as TokenClaims;
    },

    async resetPassword(userId, password, temporary) {
      const user = await mustGetUser(userId);
      assertPasswordRules(password, user.username);
      // setPassword also clears the failure count and any lock.
      await store.setPassword(userId, await hasher.hash(password), temporary);
      await store.deleteSessionsForUser(userId);
    },

    async sendPasswordResetEmail() {
      throw new PasswordResetEmailUnsupportedError();
    },

    async forceLogout(userId) {
      await mustGetUser(userId);
      await store.deleteSessionsForUser(userId);
    },

    directory: {
      async list(opts = {}) {
        const rows = await users.list({
          offset: opts.first ?? 0,
          limit: opts.max ?? DEFAULT_LIST_LIMIT,
          search: opts.search,
          enabled: opts.enabled,
        });
        return Promise.all(rows.map(toDirectoryUser));
      },

      async get(id) {
        const user = await users.get(id);
        return user ? toDirectoryUser(user) : null;
      },

      async create(input) {
        // Every check runs before the first write, so a refusal leaves nothing behind.
        if (input.password !== undefined) assertPasswordRules(input.password, input.username);
        if (await store.findUserIdByIdentifier(input.username)) throw new Error('username already exists');
        const passwordHash = input.password !== undefined ? await hasher.hash(input.password) : null;
        const firstName = input.firstName ?? null;
        const lastName = input.lastName ?? null;

        const { id } = await store.createUser({
          username: input.username, email: input.email ?? null, displayName: joinNames(firstName, lastName),
        });
        await store.setNames(id, firstName, lastName);
        await roles.setUserRoles(id, await roleIds(input.roles ?? []));
        if (input.enabled === false) await users.setStatus(id, 'disabled');
        // Last write. The account cannot sign in until the password exists, so a failure
        // before this point leaves no usable account. With no password the row is never made.
        if (passwordHash !== null) await store.setPassword(id, passwordHash, input.temporaryPassword ?? true);

        const created = await users.get(id);
        if (!created) throw new Error('the user was created but cannot be read back');
        return toDirectoryUser(created);
      },

      // A field left undefined keeps its value. Null clears it.
      async update(id, patch) {
        await mustGetUser(id);
        const nameGiven = patch.firstName !== undefined || patch.lastName !== undefined;
        const patchUser: { displayName?: string | null; email?: string | null } = {};
        if (patch.email !== undefined) patchUser.email = patch.email;
        if (nameGiven) {
          const current = await store.getNames(id);
          const firstName = patch.firstName !== undefined ? patch.firstName : current.firstName;
          const lastName = patch.lastName !== undefined ? patch.lastName : current.lastName;
          await store.setNames(id, firstName, lastName);
          patchUser.displayName = joinNames(firstName, lastName);
        }
        if (Object.keys(patchUser).length > 0) await users.update(id, patchUser);
        if (patch.enabled !== undefined) await users.setStatus(id, patch.enabled ? 'active' : 'disabled');
      },

      async setRoles(id, slugs) {
        await mustGetUser(id);
        await roles.setUserRoles(id, await roleIds(slugs));
      },
    },

    clients,
  };

  return { auth, signIn };
}
