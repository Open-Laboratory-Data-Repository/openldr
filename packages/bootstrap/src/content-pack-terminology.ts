import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';

/**
 * Give a pack's terminology resource the id already registered for its URL.
 *
 * A pack resource usually has no `id`. The FHIR store gives such a resource a new random id, and the
 * projection keys `terminology_codes` on that id. So a second install would add a second resource and
 * a second set of codes under the same URL. `terminology_systems` holds one row per URL (CodeSystem
 * and ValueSet alike) with the id of the resource saved for it. Reusing that id makes a reinstall
 * replace the resource in place.
 *
 * A resource that names its own id, or a URL registered under another resource type, is left as is.
 */
export async function withRegisteredResourceId(db: Kysely<InternalSchema>, json: unknown): Promise<unknown> {
  if (!json || typeof json !== 'object') return json;
  const res = json as { id?: unknown; url?: unknown; resourceType?: unknown };
  if (res.id !== undefined || typeof res.url !== 'string' || typeof res.resourceType !== 'string') return json;
  const row = await db
    .selectFrom('terminology_systems')
    .select(['kind', 'resource_id'])
    .where('url', '=', res.url)
    .executeTakeFirst();
  if (!row || row.kind !== res.resourceType || !row.resource_id) return json;
  return { ...res, id: row.resource_id };
}
