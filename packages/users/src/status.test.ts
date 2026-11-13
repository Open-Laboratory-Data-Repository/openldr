import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { type Kysely } from 'kysely';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createUserStore, SubjectLinkConflictError } from './store';

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
      expect(await users.syncFromClaims({ sub: 'provider-1', preferred_username: 'ada' })).toMatchObject({ status: 'disabled', subject: 'provider-1', lastLoginAt: expect.any(String) });
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

  // The key routes pass `neverEnable`: the write itself keeps a disabled row disabled, so a disable
  // that lands after the caller last read the row is not undone. The status route does not pass it.
  it('with neverEnable, links a disabled row without enabling it, and the default still enables', async () => {
    const { db, users } = await setup();
    try {
      const row = await users.create({ username: 'ada' });
      await users.setStatus(row.id, 'disabled');
      const linked = await users.setSubjectStatus({ subject: 'provider-1', username: 'ada' }, 'active', { neverEnable: true });
      expect(linked).toMatchObject({ id: row.id, subject: 'provider-1', status: 'disabled' });

      const other = await users.create({ username: 'bob' });
      expect(await users.setSubjectStatus({ subject: 'provider-2', username: 'bob' }, 'active', { neverEnable: true })).toMatchObject({ id: other.id, status: 'active' });
      await users.setStatus(other.id, 'active');
      const third = await users.create({ username: 'cy' });
      await users.setStatus(third.id, 'disabled');
      expect(await users.setSubjectStatus({ subject: 'provider-3', username: 'cy' }, 'active')).toMatchObject({ id: third.id, status: 'active' });
    } finally { await db.destroy(); }
  });

  it('with neverEnable, the upsert on an existing subject keeps a disabled row disabled', async () => {
    const { db, users } = await setup();
    try {
      await users.setSubjectStatus({ subject: 'provider-1', username: 'ada' }, 'disabled');
      expect(await users.setSubjectStatus({ subject: 'provider-1', username: 'ada' }, 'active', { neverEnable: true })).toMatchObject({ status: 'disabled' });
      expect(await users.setSubjectStatus({ subject: 'provider-1', username: 'ada' }, 'active')).toMatchObject({ status: 'active' });
      expect(await users.setSubjectStatus({ subject: 'provider-1', username: 'ada' }, 'disabled', { neverEnable: true })).toMatchObject({ status: 'disabled' });
    } finally { await db.destroy(); }
  });

  // Another writer links the row between the store's read by username and its link update. pg-mem
  // runs one statement at a time, so a query interceptor does that writer's update just before the
  // link update runs. One connection, not a real race.
  it('throws SubjectLinkConflictError when another identity links the row before the link update', async () => {
    const mem = newDb();
    const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
    await internalMigrations['006_users'].up(db);
    await internalMigrations['095_account_access_blocks'].up(db);
    await db.schema.alterTable('users').addColumn('rbac_initialized', 'boolean', c => c.notNull().defaultTo(false)).execute();
    const users = createUserStore(db);
    try {
      const row = await users.create({ username: 'ada' });
      let pending = true;
      const seen: string[] = [];
      mem.public.interceptQueries((query) => {
        if (pending && /^\s*update\s+"users"/i.test(query)) {
          pending = false;
          seen.push(query);
          mem.public.none(`update users set subject = 'provider-other' where id = '${row.id}'`);
        }
        return null;
      });
      const err = await users.setSubjectStatus({ subject: 'provider-1', username: 'ada' }, 'active').catch((e: unknown) => e);
      expect(seen).toHaveLength(1);
      expect(err).toBeInstanceOf(SubjectLinkConflictError);
      expect(err).toMatchObject({ name: 'SubjectLinkConflictError', message: 'username subject changed during status update' });
      expect(await users.get(row.id)).toMatchObject({ subject: 'provider-other', status: 'active' });
      expect(await users.getBySubject('provider-1')).toBeUndefined();
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
