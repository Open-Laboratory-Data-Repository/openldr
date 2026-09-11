import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { createUserStore } from './store';

describe('bounded local directory fallback', () => {
  it('filters before paging and keeps the no-options list complete', async () => {
    const mem = newDb();
    mem.public.none(`create table users (id text primary key, subject text, username text, display_name text, email text, roles jsonb, status text, last_login_at timestamp, created_at timestamp, rbac_initialized boolean)`);
    const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
    try {
      await db.insertInto('users').values(Array.from({ length: 125 }, (_, i) => ({ id: String(i), username: `user${String(i).padStart(3, '0')}`, email: `u${i}@lab`, display_name: 'Ada', status: i < 110 ? 'active' : 'disabled', roles: '[]' as never }))).execute();
      const store = createUserStore(db);
      expect(await store.list()).toHaveLength(125);
      const page = await store.list({ offset: 100, limit: 10, search: 'Ada', enabled: true });
      expect(page).toHaveLength(10);
      expect(page[0].username).toBe('user100');
      expect(await store.list({ offset: 10, limit: 10, enabled: false })).toHaveLength(5);
    } finally { await db.destroy(); }
  });
});
