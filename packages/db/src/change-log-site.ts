import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

// A lab's records written before it was linked to a central carry no site id: fhir-store stamps one
// only once sync.site_id is set (resolveSiteId). The push skips a record with no site id for good,
// so a lab that ran on its own first never sent its earlier records, while its sync screen said
// nothing was pending (found 2026-11-26: 235 of 235 skipped on a standalone linked after use).

/** Terminology is the central's (distributed-sync design §2, center-owned). A lab never claims it,
 *  so its earlier terminology records keep no site id and are never pushed. */
export const NOT_LAB_OWNED_RESOURCE_TYPES: readonly string[] = ['ValueSet', 'CodeSystem', 'ConceptMap', 'NamingSystem'];

/** Give this lab's site id to its earlier records that have none, terminology aside. Only rows
 *  without a site id change, so it is safe to run on every save of the sync settings. Answers how
 *  many rows it stamped. */
export async function stampEarlierRecords(db: Kysely<InternalSchema>, siteId: string): Promise<number> {
  if (!siteId) return 0;
  const result = await db
    .updateTable('fhir.change_log')
    .set({ site_id: siteId })
    .where((eb) => eb.or([eb('site_id', 'is', null), eb('site_id', '=', '')]))
    .where('resource_type', 'not in', [...NOT_LAB_OWNED_RESOURCE_TYPES])
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0);
}
