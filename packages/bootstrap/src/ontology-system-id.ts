import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';

/**
 * The coding system id an ontology index is stored under, given the system's id or its URL.
 *
 * Every reader of an index (the LOINC hints, the browse tree) looks it up by the coding system's
 * id. Before this, `openldr terminology ontology build http://loinc.org <dir>` stored the index
 * under the URL itself, so nothing ever found it (seen 2026-11-24). A system this install does not
 * have is refused, so an index is never stored under a key nothing reads.
 */
export async function ontologySystemId(db: Kysely<InternalSchema>, idOrUrl: string): Promise<string> {
  const given = idOrUrl.trim();
  const byId = await db.selectFrom('coding_systems').select('id').where('id', '=', given).executeTakeFirst();
  if (byId) return byId.id;
  const byUrl = await db.selectFrom('coding_systems').select('id').where('url', '=', given).executeTakeFirst();
  if (byUrl) return byUrl.id;
  throw new Error(`No coding system "${given}" is loaded here. Give its id or its URL, as openldr terminology system list shows them.`);
}
