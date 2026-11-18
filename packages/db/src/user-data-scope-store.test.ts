import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import type { InternalSchema } from './schema/internal';
import { createUserDataScopeStore, type UserDataScopeStore } from './user-data-scope-store';

// Layer: the store's SQL against pg-mem, every internal migration applied (design
// 2026-11-18-roles-scope, part 3). Not covered: real Postgres locking, see the live test.
describe('user data scope store', () => {
  let db: Kysely<InternalSchema>;
  let store: UserDataScopeStore;
  beforeEach(async () => {
    db = await makeMigratedDb();
    store = createUserDataScopeStore(db);
  });

  it('answers Everything for a user with no row', async () => {
    expect(await store.get('sub-1')).toEqual({ limited: false });
  });

  it('keeps a limit with facilities, districts and regions, sorted and each once', async () => {
    const scope = {
      limited: true as const,
      facilities: ['f2', 'f1', 'f1'],
      districts: [{ region: 'R2', district: 'D' }, { region: 'R1', district: 'D' }],
      regions: ['R3'],
    };
    await store.set('sub-1', scope);
    expect(await store.get('sub-1')).toEqual({
      limited: true,
      facilities: ['f1', 'f2'],
      districts: [{ region: 'R1', district: 'D' }, { region: 'R2', district: 'D' }],
      regions: ['R3'],
    });
  });

  it('keeps Limited with nothing listed as Limited, not Everything', async () => {
    await store.set('sub-1', { limited: true, facilities: [], districts: [], regions: [] });
    expect(await store.get('sub-1')).toEqual({ limited: true, facilities: [], districts: [], regions: [] });
  });

  it('returns its own before and after, and Everything clears the items', async () => {
    const limited = { limited: true as const, facilities: ['f1'], districts: [], regions: [] };
    expect(await store.set('sub-1', limited)).toEqual({ before: { limited: false }, after: limited });
    expect(await store.set('sub-1', { limited: false })).toEqual({ before: limited, after: { limited: false } });
    expect(await store.get('sub-1')).toEqual({ limited: false });
    expect(await db.selectFrom('user_data_scope_items').selectAll().execute()).toEqual([]);
  });

  it('keeps one user\'s limit apart from another\'s', async () => {
    await store.set('sub-1', { limited: true, facilities: ['f1'], districts: [], regions: [] });
    expect(await store.get('sub-2')).toEqual({ limited: false });
  });
});
