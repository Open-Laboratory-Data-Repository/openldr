import { describe, expect, it } from 'vitest';
import { type Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createStarterPackStore } from './starter-pack-store';
import { seededStarterPacks } from './samples/starter-packs';
import type { SeededStarterPack } from './starter-pack';

async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) await migration.up(db);
  return db;
}

const tiny = (id: string, labels: string[]): SeededStarterPack => ({
  id, resourceType: 'Location', name: id, version: '1',
  entries: labels.map((label, ord) => ({
    ord, fhirPath: null, label, apiProperty: null, fieldType: 'text', fhirValueField: null, required: false,
    locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false, rationale: 'r',
  })),
});

describe('starter pack store', () => {
  it('writes the seeded packs and reads them back, entries in order', async () => {
    const store = createStarterPackStore(await makeMigratedDb());
    await store.replaceSeeded(seededStarterPacks());
    expect((await store.listForResource('Location')).map((p) => [p.id, p.seeded])).toEqual([['pack-location', true]]);
    const pack = (await store.get('pack-location'))!;
    expect(pack.entries.map((e) => e.ord)).toEqual(pack.entries.map((_, i) => i));
    expect(pack.entries[1]).toMatchObject({ label: 'Facility code', discriminator: { system: 'urn:openldr:facility:national' }, locked: true });
    expect(typeof pack.createdAt).toBe('string');
  });

  it('answers an empty list for a type with no pack, and null for an unknown id', async () => {
    const store = createStarterPackStore(await makeMigratedDb());
    await store.replaceSeeded(seededStarterPacks());
    expect(await store.listForResource('Specimen')).toEqual([]);
    expect(await store.get('nope')).toBeNull();
  });

  it('replaces a pack when it runs again, and drops a seeded pack no longer listed', async () => {
    const store = createStarterPackStore(await makeMigratedDb());
    await store.replaceSeeded([tiny('a', ['One', 'Two']), tiny('b', ['Three'])]);
    await store.replaceSeeded([tiny('a', ['Only'])]);
    expect((await store.get('a'))!.entries.map((e) => e.label)).toEqual(['Only']);
    expect(await store.get('b')).toBeNull();
  });
});
