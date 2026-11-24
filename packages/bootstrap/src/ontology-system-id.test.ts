import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import type { InternalSchema } from '@openldr/db';
import { ontologySystemId } from './ontology-system-id';

describe('ontologySystemId', () => {
  it('answers the id for a coding system given by its id or by its URL', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    expect(await ontologySystemId(db, 'cs-openldr-local')).toBe('cs-openldr-local');
    expect(await ontologySystemId(db, 'urn:openldr:cs:local')).toBe('cs-openldr-local');
    expect(await ontologySystemId(db, '  urn:openldr:cs:local ')).toBe('cs-openldr-local');
  });

  it('refuses a system this install does not have, so no index is stored under a key nothing reads', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    await expect(ontologySystemId(db, 'http://example.org/not-loaded')).rejects.toThrow(/No coding system "http:\/\/example.org\/not-loaded"/);
  });
});
