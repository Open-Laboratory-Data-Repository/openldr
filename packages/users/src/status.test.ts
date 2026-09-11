import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { type Kysely } from 'kysely';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createUserStore } from './store';

async function setup() {
  const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
  await internalMigrations['006_users'].up(db);
  await internalMigrations['095_account_access_blocks'].up(db);
  await db.schema.alterTable('users').addColumn('rbac_initialized', 'boolean', c => c.notNull().defaultTo(false)).execute();
  return { db, users: createUserStore(db) };
}

describe('subject status persistence', () => {
  it('creates a disabled subject atomically before its first token', async () => {
    const { db, users } = await setup();
    try {
      await users.setSubjectStatus({ subject: 'provider-1', username: 'ada' }, 'disabled');
      expect(await users.syncFromClaims({ sub: 'provider-1', preferred_username: 'ada' })).toMatchObject({ status: 'disabled', subject: 'provider-1' });
      await users.setSubjectStatus({ subject: 'provider-1', username: 'ada' }, 'active');
      expect(await users.syncFromClaims({ sub: 'provider-1' })).toMatchObject({ status: 'active' });
    } finally { await db.destroy(); }
  });

  it('cannot move a disabled subject to another identity with the same username', async () => {
    const { db, users } = await setup();
    try {
      const first = await users.syncFromClaims({ sub: 'provider-a', preferred_username: 'ada' });
      await users.setStatus(first.id, 'disabled');
      await expect(users.syncFromClaims({ sub: 'provider-b', preferred_username: 'ada' })).rejects.toThrow(/subject/);
      expect(await users.syncFromClaims({ sub: 'provider-a', preferred_username: 'changed' })).toMatchObject({ status: 'disabled' });
    } finally { await db.destroy(); }
  });

  it('status changes for a provider username collision leave the existing account untouched', async () => {
    const { db, users } = await setup();
    try {
      const first = await users.syncFromClaims({ sub: 'provider-a', preferred_username: 'ada' });
      await users.setSubjectStatus({ subject: 'provider-b', username: 'ada' }, 'disabled');
      expect(await users.get(first.id)).toMatchObject({ subject: 'provider-a', status: 'active' });
      expect(await users.syncFromClaims({ sub: 'provider-b', preferred_username: 'ada' })).toMatchObject({ status: 'disabled' });
    } finally { await db.destroy(); }
  });
});
