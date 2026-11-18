import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import type { InternalSchema } from './schema/internal';
import { createFormAccessStore, type FormAccessStore } from './form-access-store';
import { createRoleStore } from './role-store';

// Layer: the store's SQL against pg-mem, every internal migration applied
// (design 2026-11-18-roles-scope, part 1). Not covered: real Postgres.
describe('form access store', () => {
  let db: Kysely<InternalSchema>;
  let store: FormAccessStore;
  beforeEach(async () => {
    db = await makeMigratedDb();
    store = createFormAccessStore(db);
  });

  it('answers empty lists for a form nobody limited', async () => {
    expect(await store.get('f1')).toEqual({ open: [], submit: [] });
  });

  it('sets both lists, and a second set replaces them', async () => {
    await store.set('f1', { open: ['r2', 'r1'], submit: ['r1'] });
    expect(await store.get('f1')).toEqual({ open: ['r1', 'r2'], submit: ['r1'] });
    await store.set('f1', { open: [], submit: ['r3'] });
    expect(await store.get('f1')).toEqual({ open: [], submit: ['r3'] });
  });

  it('reads many forms at once, leaving out forms with no list', async () => {
    await store.set('f1', { open: ['r1'], submit: [] });
    await store.set('f2', { open: [], submit: ['r2'] });
    const got = await store.forForms(['f1', 'f2', 'f3']);
    expect([...got.keys()].sort()).toEqual(['f1', 'f2']);
    expect(got.get('f2')).toEqual({ open: [], submit: ['r2'] });
  });

  it('removes a role from every form', async () => {
    await store.set('f1', { open: ['r1', 'r2'], submit: ['r1'] });
    await store.set('f2', { open: ['r1'], submit: [] });
    await store.removeRole('r1');
    expect(await store.get('f1')).toEqual({ open: ['r2'], submit: [] });
    expect(await store.get('f2')).toEqual({ open: [], submit: [] });
  });

  it('a deleted role leaves every form it was on', async () => {
    const roles = createRoleStore(db);
    const clerk = await roles.create({ name: 'Sample clerk', capabilities: ['forms.view', 'forms.submit'] });
    await store.set('f1', { open: [clerk.id, 'other'], submit: [clerk.id] });
    await roles.remove(clerk.id);
    expect(await store.get('f1')).toEqual({ open: ['other'], submit: [] });
  });
});
