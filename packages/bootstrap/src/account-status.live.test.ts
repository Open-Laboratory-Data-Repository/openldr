import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { describe, it, expect } from 'vitest';
import { createInternalDb, internalMigrations } from '@openldr/db';
import { createUserStore } from '@openldr/users';
import { setAccountStatus } from './account-status';

const url = process.env.P08_TEST_DATABASE_URL;
const actor = { actorType: 'cli' as const, actorId: null, actorName: 'cli' };

async function fixture() {
  const schema = `p08_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: url });
  await admin.query(`create schema "${schema}"`);
  const make = () => createInternalDb(url!, { pool: new pg.Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 }) });
  const one = make(); const two = make();
  await internalMigrations['006_users'].up(one.db);
  await internalMigrations['095_account_access_blocks'].up(one.db);
  await one.db.schema.alterTable('users').addColumn('rbac_initialized', 'boolean', c => c.notNull().defaultTo(false)).execute();
  const provider = { id: 'provider-1', username: 'ada', enabled: true, email: null, firstName: null, lastName: null, roles: [], createdAt: null };
  let update: (enabled: boolean) => Promise<void> = async enabled => { provider.enabled = enabled; };
  const events: unknown[] = [];
  const context = (internal: typeof one) => ({
    users: createUserStore(internal.db, { withSubjectLock: internal.withAccountStatusLock }),
    auth: { directory: { get: async () => ({ ...provider }), update: async (_id: string, patch: { enabled?: boolean }) => update(patch.enabled!) } },
    audit: { record: async (event: unknown) => { await internal.db.selectFrom('account_access_blocks').selectAll().execute(); events.push(event); return event; } },
    logger: { error() {}, warn() {} },
  }) as any;
  return { one, two, provider, a: context(one), b: context(two), events, setUpdate: (next: typeof update) => { update = next; }, close: async () => {
    await one.close(); await two.close(); await admin.query(`drop schema "${schema}" cascade`); await admin.end();
  } };
}

describe.skipIf(!url)('account status PostgreSQL serialization', () => {
  it('rejects cross-replica overlap, then the retried disable remains authoritative', async () => {
    const f = await fixture();
    let release!: () => void;
    try {
      const local = await f.a.users.syncFromClaims({ sub: f.provider.id, preferred_username: 'ada' });
      await setAccountStatus(f.a, { localId: local.id }, false, actor);
      let entered!: () => void;
      const pending = new Promise<void>(resolve => { entered = resolve; });
      const barrier = new Promise<void>(resolve => { release = resolve; });
      f.setUpdate(async enabled => { f.provider.enabled = enabled; if (enabled) { entered(); await barrier; } });
      const enabling = setAccountStatus(f.a, { localId: local.id }, true, actor);
      await pending;
      expect(await f.b.users.isSubjectBlocked(f.provider.id)).toBe(true);
      await expect(setAccountStatus(f.b, { providerSubject: f.provider.id }, false, actor)).rejects.toMatchObject({ name: 'AccountStatusConflictError' });
      release(); await enabling;
      await setAccountStatus(f.b, { providerSubject: f.provider.id }, false, actor);
      expect(f.provider.enabled).toBe(false);
      expect(await f.a.users.getBySubject(f.provider.id)).toMatchObject({ status: 'disabled' });
      expect(await f.a.users.isSubjectBlocked(f.provider.id)).toBe(true);
    } finally { release?.(); await f.close(); }
  });
  it('commits an unseen subject block before provider work and retains it after failure', async () => {
    const f = await fixture();
    try {
      f.setUpdate(async () => {
        expect(await f.b.users.isSubjectBlocked(f.provider.id)).toBe(true);
        throw new Error('provider unavailable');
      });
      await expect(setAccountStatus(f.a, { providerSubject: f.provider.id }, false, actor)).rejects.toThrow(/local account is disabled/);
      expect(await f.b.users.isSubjectBlocked(f.provider.id)).toBe(true);
      expect(await f.b.users.getBySubject(f.provider.id)).toMatchObject({ status: 'disabled' });
    } finally { await f.close(); }
  });
  it('releases a lost lock session and allows another replica to acquire it', async () => {
    const f = await fixture();
    try {
      await expect(f.one.withAccountStatusLock('lost-session', async pinned => {
        const result = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(pinned);
        await sql`select pg_terminate_backend(${result.rows[0]!.pid})`.execute(f.two.db);
        await sql`select 1`.execute(pinned);
      })).rejects.toThrow();
      await expect(f.two.withAccountStatusLock('lost-session', async pinned => {
        return (await sql<{ value: number }>`select 1 as value`.execute(pinned)).rows[0]!.value;
      })).resolves.toBe(1);
    } finally { await f.close(); }
  });
  it('handles distinct subjects with a single connection without pool starvation', async () => {
    const f = await fixture();
    try {
      const results = await Promise.all(['first', 'second', 'third'].map(subject =>
        f.one.withAccountStatusLock(subject, async pinned => {
          await sql`select 1`.execute(pinned);
          return subject;
        }),
      ));
      expect(results).toEqual(['first', 'second', 'third']);
    } finally { await f.close(); }
  });

});
