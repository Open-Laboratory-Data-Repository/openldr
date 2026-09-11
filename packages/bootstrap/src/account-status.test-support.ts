import { vi } from 'vitest';
import { newDb } from 'pg-mem';
import { type Kysely } from 'kysely';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createUserStore } from '@openldr/users';
export async function accountFixture() {
  const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
  await internalMigrations['006_users'].up(db);
  await internalMigrations['095_account_access_blocks'].up(db);
  await db.schema.alterTable('users').addColumn('rbac_initialized', 'boolean', c => c.notNull().defaultTo(false)).execute();
  const users = createUserStore(db, { withSubjectLock: async (_subject, work) => work(db) });
  users.withSubjectLock = async (_subject, work) => work(users);
  const provider = { id: 'provider-1', username: 'ada', enabled: true, email: null, firstName: null, lastName: null, roles: [], createdAt: null };
  const directory = {
    get: vi.fn(async (id: string) => id === provider.id ? { ...provider } : null),
    update: vi.fn(async (_id: string, patch: { enabled?: boolean }) => { provider.enabled = patch.enabled!; }),
  };
  const events: any[] = [];
  const ctx = { users, auth: { directory }, audit: { record: vi.fn(async (event: any) => { events.push(event); return event; }) }, logger: { warn: vi.fn(), error: vi.fn() } };
  return { db, ctx: ctx as any, provider, directory, users, events };
}
