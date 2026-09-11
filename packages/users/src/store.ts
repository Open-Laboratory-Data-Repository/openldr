import { randomUUID } from 'node:crypto';
import { type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { TokenClaims } from '@openldr/ports';

export interface User {
  id: string;
  subject: string | null;
  username: string;
  displayName: string | null;
  email: string | null;
  roles: string[];
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string | null;
  /** True once the one-time token-roles -> RBAC user_roles backfill has run for this user. */
  rbacInitialized: boolean;
}

export interface CreateUserInput {
  username: string;
  displayName?: string;
  email?: string;
  roles?: string[];
}

export interface UpdateUserInput {
  displayName?: string | null;
  email?: string | null;
}

export interface UserStore {
  withSubjectLock<T>(subject: string, work: (users: UserStore) => Promise<T>): Promise<T>;
  create(input: CreateUserInput): Promise<User>;
  get(id: string): Promise<User | undefined>;
  getBySubject(subject: string): Promise<User | undefined>;
  getByUsername(username: string): Promise<User | undefined>;
  list(opts?: { offset: number; limit: number; search?: string; enabled?: boolean }): Promise<User[]>;
  update(id: string, input: UpdateUserInput): Promise<void>;
  setRoles(id: string, roles: string[]): Promise<void>;
  setStatus(id: string, status: 'active' | 'disabled'): Promise<void>;
  blockSubject(subject: string): Promise<void>;
  unblockSubject(subject: string): Promise<void>;
  isSubjectBlocked(subject: string): Promise<boolean>;
  /** Persist the subject and status together, including accounts that have never signed in. */
  setSubjectStatus(input: { subject: string; username: string }, status: 'active' | 'disabled'): Promise<User>;
  /**
   * Just-in-time provision/link from verified token claims: resolve by subject,
   * else link an unclaimed username, else create. Reject an already-linked username. Does NOT change
   * `status` — a disabled user stays disabled. The caller (auth layer) MUST
   * reject the returned user when `status === 'disabled'`; this never reactivates.
   */
  syncFromClaims(claims: TokenClaims): Promise<User>;
  /** Marks the one-time token-roles -> RBAC user_roles backfill as done for this user. */
  markRbacInitialized(id: string): Promise<void>;
}

interface Row {
  id: string;
  subject: string | null;
  username: string;
  display_name: string | null;
  email: string | null;
  roles: unknown;
  status: string;
  last_login_at: Date | null;
  created_at: Date | null;
  rbac_initialized: unknown;
}

function toUser(r: Row): User {
  return {
    id: r.id,
    subject: r.subject,
    username: r.username,
    displayName: r.display_name,
    email: r.email,
    roles: Array.isArray(r.roles) ? (r.roles as string[]) : [],
    status: r.status === 'disabled' ? 'disabled' : 'active',
    lastLoginAt: r.last_login_at instanceof Date ? r.last_login_at.toISOString() : (r.last_login_at as string | null),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : (r.created_at as string | null),
    rbacInitialized: r.rbac_initialized === true,
  };
}

const COLS = ['id', 'subject', 'username', 'display_name', 'email', 'roles', 'status', 'last_login_at', 'created_at', 'rbac_initialized'] as const;

export function createUserStore(db: Kysely<InternalSchema>, deps: {
  withSubjectLock?: <T>(subject: string, work: (db: Kysely<InternalSchema>) => Promise<T>) => Promise<T>;
} = {}): UserStore {
  async function get(id: string): Promise<User | undefined> {
    const r = await db.selectFrom('users').select(COLS).where('id', '=', id).executeTakeFirst();
    return r ? toUser(r as unknown as Row) : undefined;
  }
  async function getBySubject(subject: string): Promise<User | undefined> {
    const r = await db.selectFrom('users').select(COLS).where('subject', '=', subject).executeTakeFirst();
    return r ? toUser(r as unknown as Row) : undefined;
  }
  async function getByUsername(username: string): Promise<User | undefined> {
    const r = await db.selectFrom('users').select(COLS).where('username', '=', username).executeTakeFirst();
    return r ? toUser(r as unknown as Row) : undefined;
  }
  async function create(input: CreateUserInput): Promise<User> {
    const id = randomUUID();
    await db
      .insertInto('users')
      .values({
        id,
        username: input.username,
        display_name: input.displayName ?? null,
        email: input.email ?? null,
        roles: JSON.stringify(input.roles ?? []) as never,
      })
      .execute();
    return (await get(id))!;
  }

  return {
    async withSubjectLock(subject, work) {
      if (!deps.withSubjectLock) throw new Error('account status lock is not configured');
      return deps.withSubjectLock(subject, pinned => work(createUserStore(pinned, deps)));
    },
    create,
    get,
    getBySubject,
    getByUsername,
    async list(opts) {
      let query = db.selectFrom('users').select(COLS).orderBy('username').orderBy('id');
      if (opts) {
        if (opts.enabled !== undefined) query = query.where('status', '=', opts.enabled ? 'active' : 'disabled');
        if (opts.search) {
          const pattern = `%${opts.search.replace(/[\\%_]/g, '\\$&')}%`;
          query = query.where((eb) => eb.or([eb('username', 'ilike', pattern), eb('email', 'ilike', pattern), eb('display_name', 'ilike', pattern)]));
        }
        query = query.offset(opts.offset).limit(opts.limit);
      }
      const rows = await query.execute();
      return rows.map((r) => toUser(r as unknown as Row));
    },
    async update(id, input) {
      const set: { display_name?: string | null; email?: string | null; updated_at: Date } = { updated_at: new Date() };
      if ('displayName' in input) set.display_name = input.displayName ?? null;
      if ('email' in input) set.email = input.email ?? null;
      await db.updateTable('users').set(set).where('id', '=', id).execute();
    },
    async setRoles(id, roles) {
      await db.updateTable('users').set({ roles: JSON.stringify(roles) as never, updated_at: new Date() }).where('id', '=', id).execute();
    },
    async setStatus(id, status) {
      await db.updateTable('users').set({ status, updated_at: new Date() }).where('id', '=', id).execute();
    },
    async blockSubject(subject) {
      if (!subject) throw new Error('missing provider subject');
      await db.insertInto('account_access_blocks').values({ subject })
        .onConflict(oc => oc.column('subject').doNothing()).execute();
    },
    async unblockSubject(subject) {
      await db.deleteFrom('account_access_blocks').where('subject', '=', subject).execute();
    },
    async isSubjectBlocked(subject) {
      return !!await db.selectFrom('account_access_blocks').select('subject').where('subject', '=', subject).executeTakeFirst();
    },
    async setSubjectStatus(input, status) {
      if (!input.subject) throw new Error('missing provider subject');
      const existing = await getBySubject(input.subject);
      const byName = existing ? undefined : await getByUsername(input.username);
      if (byName && byName.subject === null) {
        const linked = await db.updateTable('users').set({ subject: input.subject, status, updated_at: new Date() })
          .where('id', '=', byName.id).where('subject', 'is', null).returning(COLS).executeTakeFirst();
        if (!linked) throw new Error('username subject changed during status update');
        return toUser(linked as unknown as Row);
      }
      // A provider username must never replace another identity's subject.
      const username = existing?.username ?? (byName ? `provider:${randomUUID()}` : input.username);
      const row = await db.insertInto('users').values({
        id: randomUUID(), subject: input.subject, username, status, roles: JSON.stringify([]) as never,
      }).onConflict(oc => oc.column('subject').doUpdateSet({ status, updated_at: new Date() }))
        .returning(COLS).executeTakeFirstOrThrow();
      return toUser(row as unknown as Row);
    },
    async markRbacInitialized(id) {
      await db.updateTable('users').set({ rbac_initialized: true, updated_at: new Date() }).where('id', '=', id).execute();
    },
    async syncFromClaims(claims) {
      const sub = typeof claims.sub === 'string' ? claims.sub : '';
      if (!sub) throw new Error('syncFromClaims: missing sub claim');
      const username =
        (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
        (typeof claims.email === 'string' && claims.email) ||
        sub;
      const now = new Date();

      const existing = await getBySubject(sub);
      if (existing) {
        const row = await db.updateTable('users').set({ last_login_at: now, updated_at: now })
          .where('id', '=', existing.id).returning(COLS).executeTakeFirstOrThrow();
        return toUser(row as unknown as Row);
      }
      const byName = await getByUsername(username);
      if (byName) {
        if (byName.subject !== null) throw new Error('username already belongs to another subject');
        const row = await db.updateTable('users').set({ subject: sub, last_login_at: now, updated_at: now })
          .where('id', '=', byName.id).where('subject', 'is', null).returning(COLS).executeTakeFirst();
        if (!row) throw new Error('username subject changed during sign-in');
        return toUser(row as unknown as Row);
      }
      const row = await db.insertInto('users').values({
        id: randomUUID(), subject: sub, username, roles: JSON.stringify([]) as never,
        display_name: typeof claims.name === 'string' ? claims.name : null,
        email: typeof claims.email === 'string' ? claims.email : null,
        last_login_at: now,
      }).onConflict(oc => oc.column('subject').doUpdateSet({ last_login_at: now, updated_at: now }))
        .returning(COLS).executeTakeFirstOrThrow();
      return toUser(row as unknown as Row);
    },
  };
}
