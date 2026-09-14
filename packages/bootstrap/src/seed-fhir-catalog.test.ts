import { describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import { createTerminologyAdminStore, internalMigrations, type InternalSchema } from '@openldr/db';
import { seedFhirValueSetCatalog } from './seed';

describe('seedFhirValueSetCatalog on the real migration chain', () => {
  it('imports on a freshly migrated database, where migration 072 has already added an HL7 set', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    for (const migration of Object.values(internalMigrations)) await migration.up(db as never);
    const valueSets = createTerminologyAdminStore(db).valueSets;

    // The precondition that defeated the old check: an HL7-published set exists, and none is a catalog set.
    const hl7 = (await valueSets.list('pub-hl7-fhir')).map((v) => v.url);
    expect(hl7).toContain('urn:openldr:valueset:location-status');
    expect(hl7.some((url) => url.startsWith('http://hl7.org/fhir/ValueSet/'))).toBe(false);

    const importFhirCatalog = vi.fn(async () => ({ imported: 672, skipped: 0, valueSet: null }));
    const imported = await seedFhirValueSetCatalog({
      terminology: { admin: { valueSets: { list: valueSets.list, importFhirCatalog } } },
    } as never);
    expect(importFhirCatalog).toHaveBeenCalledOnce();
    expect(imported).toBe(672);
  });
});
