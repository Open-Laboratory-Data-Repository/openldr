import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations } from './migrations/internal/index';
import { createTerminologyAdminStore } from './terminology-admin-store';
import type { InternalSchema } from './schema/internal';

async function store() {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const m of Object.values(internalMigrations)) {
    await (m as { up: (db: Kysely<unknown>) => Promise<void> }).up(db as Kysely<unknown>);
  }
  return { db, s: createTerminologyAdminStore(db) };
}

describe('coding system source and description', () => {
  it('keeps the name, description, origin and ref an import passes', async () => {
    const { s } = await store();
    await s.codingSystems.upsertByUrl({
      url: 'urn:test:cs:sites', systemCode: 'TEST:CS:SITES', systemName: 'Test sites',
      description: 'Sites used by the test pack.', publisherId: null,
      origin: 'pack', originRef: 'test-pack', seeded: false,
    });
    const cs = await s.codingSystems.getByUrl('urn:test:cs:sites');
    expect(cs).toMatchObject({
      systemName: 'Test sites', description: 'Sites used by the test pack.',
      source: 'pack', sourceRef: 'test-pack', seeded: false,
    });
  });

  it('a later upsert without origin or description keeps the stored ones', async () => {
    const { s } = await store();
    await s.codingSystems.upsertByUrl({
      url: 'urn:test:cs:a', systemCode: 'A', systemName: 'A', description: 'kept',
      publisherId: null, origin: 'import', seeded: false,
    });
    await s.codingSystems.upsertByUrl({ url: 'urn:test:cs:a', systemCode: 'A', systemName: 'A2', publisherId: null });
    const cs = await s.codingSystems.getByUrl('urn:test:cs:a');
    expect(cs).toMatchObject({ systemName: 'A2', description: 'kept', source: 'import' });
  });

  it('falls back to core for a seeded row with no origin, user for an unseeded one', async () => {
    const { s } = await store();
    await s.codingSystems.upsertByUrl({ url: 'urn:test:cs:seed', systemCode: 'SEED', systemName: 'Seed', publisherId: null });
    expect((await s.codingSystems.getByUrl('urn:test:cs:seed'))?.source).toBe('core');
    const created = await s.codingSystems.create({ systemCode: 'MINE', systemName: 'Mine', url: 'urn:test:cs:mine', active: true });
    expect(created.source).toBe('user');
  });

  it('falls back to register for a facility register', async () => {
    const { db, s } = await store();
    await db.insertInto('coding_systems').values({
      id: 'cs-freg-x', system_code: 'REG', system_name: 'A register', url: 'urn:test:register',
      seeded: false, kind: 'facility-register',
    } as never).execute();
    expect((await s.codingSystems.getByUrl('urn:test:register'))?.source).toBe('register');
  });
});
