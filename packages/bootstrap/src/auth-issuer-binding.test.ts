import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import * as migration from '../../db/src/migrations/internal/098_auth_issuer_binding';
import { bindAuthIssuer, readAuthIssuerBinding, rebindAuthIssuer } from './auth-issuer-binding';

async function migratedDb(): Promise<Kysely<InternalSchema>> {
  const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
  await migration.up(db as Kysely<unknown>);
  return db;
}

describe('authentication issuer binding', () => {
  it('allows the original issuer and refuses a different issuer without replacing the binding', async () => {
    const db = await migratedDb();
    try {
      await bindAuthIssuer(db, 'https://identity.example/tenant');
      await bindAuthIssuer(db, 'https://identity.example/tenant');
      await expect(bindAuthIssuer(db, 'https://other.example/tenant')).rejects.toThrow(/issuer.*bound/i);
      expect(await db.selectFrom('auth_issuer_binding').select(['id', 'issuer']).execute()).toEqual([
        { id: 1, issuer: 'https://identity.example/tenant' },
      ]);
    } finally { await db.destroy(); }
  });

  it('names the CLI command that moves the binding when it refuses', async () => {
    const db = await migratedDb();
    try {
      await bindAuthIssuer(db, 'https://old.example/realms/openldr');
      await expect(bindAuthIssuer(db, 'https://new.example/realms/openldr')).rejects.toThrow(/openldr auth rebind-issuer --force/);
    } finally { await db.destroy(); }
  });

  it('reads no binding before the first start', async () => {
    const db = await migratedDb();
    try {
      expect(await readAuthIssuerBinding(db)).toBeNull();
      await bindAuthIssuer(db, 'https://identity.example/tenant');
      expect(await readAuthIssuerBinding(db)).toBe('https://identity.example/tenant');
    } finally { await db.destroy(); }
  });

  it('rebinding replaces the stored issuer so the next start accepts it', async () => {
    const db = await migratedDb();
    try {
      await bindAuthIssuer(db, 'https://old.example/realms/openldr');
      expect(await rebindAuthIssuer(db, 'https://new.example/realms/openldr')).toEqual({ previous: 'https://old.example/realms/openldr' });
      await bindAuthIssuer(db, 'https://new.example/realms/openldr');
      await expect(bindAuthIssuer(db, 'https://old.example/realms/openldr')).rejects.toThrow(/issuer.*bound/i);
      expect(await db.selectFrom('auth_issuer_binding').select(['id', 'issuer']).execute()).toEqual([
        { id: 1, issuer: 'https://new.example/realms/openldr' },
      ]);
    } finally { await db.destroy(); }
  });

  it('rebinding an unbound database stores the issuer and reports no previous value', async () => {
    const db = await migratedDb();
    try {
      expect(await rebindAuthIssuer(db, 'https://identity.example/tenant')).toEqual({ previous: null });
      expect(await readAuthIssuerBinding(db)).toBe('https://identity.example/tenant');
    } finally { await db.destroy(); }
  });
});
