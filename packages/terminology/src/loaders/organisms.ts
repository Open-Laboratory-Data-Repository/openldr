import { OpenLdrError } from '@openldr/core';
import type { ConceptRecord } from '@openldr/db';
import type { LoaderStore, LoadResult } from './generic';

/** The canonical system for a DISA-style site organism dictionary (`COMMDICT` CONTEXT=50). */
export const SITE_ORGANISM_SYSTEM = 'urn:openldr:default_org';

/** The classifications the upstream organism classifier emits. Anything else is REJECTED rather
 *  than silently imported: the AMR ValueSets partition this property, so an unrecognised value
 *  would land in neither set and quietly vanish from AMR reporting.
 *
 *  `parasite` is measured at 0 of 647 in today's dictionary but is a legitimate classifier output,
 *  so it is accepted here — the point of the guard is to reject the UNKNOWN, not the merely unused. */
export const ORGANISM_TYPES = ['bacteria', 'fungus', 'parasite', 'none'] as const;
export type OrganismType = (typeof ORGANISM_TYPES)[number];

/** One row of the classifier's golden snapshot (`commdict-context50-golden.json`). */
export interface OrganismRow { code: string; description?: string | null; category?: string | null }

export interface OrganismImportResult extends LoadResult {
  /** Count per organism_type, so an operator can eyeball the import against the classifier's own
   *  golden buckets (569 bacteria / 64 fungus / 14 none at time of writing). */
  byType: Record<string, number>;
  skipped: number;
}

/**
 * Import a site's organism dictionary as a CodeSystem whose concepts carry
 * `properties.organism_type`. This is CE learning what the site's codes MEAN, once, as data —
 * the classifier upstream is the source of truth and its golden snapshot is the check.
 *
 * Deliberately NOT seeded into CE: the dictionary is SITE-SPECIFIC. The 647 codes here are one
 * Tanzanian deployment's, and a code as ordinary as `GN` ("Gram Negative", 113 uses elsewhere in
 * the same country) is absent from it. Shipping one site's vocabulary as a product default would
 * make every other deployment silently wrong. The three AMR ValueSets ARE seeded, because those
 * are CE's own semantics rather than site data.
 */
export async function importOrganismDictionary(json: unknown, store: LoaderStore): Promise<OrganismImportResult> {
  if (!Array.isArray(json)) throw new OpenLdrError('organism dictionary must be a JSON array of { code, description, category }');
  const rows = json as OrganismRow[];

  const byType: Record<string, number> = {};
  const concepts: ConceptRecord[] = [];
  let skipped = 0;

  for (const r of rows) {
    // The snapshot carries one header-ish row with an empty code ("Microbiology Organisms"). A
    // concept with no code is not addressable and would collide on the (system, code) key.
    if (!r.code) { skipped += 1; continue; }
    const category = r.category ?? null;
    if (!category || !(ORGANISM_TYPES as readonly string[]).includes(category)) {
      // Fail LOUD. A silent skip here is the exact failure mode this slice exists to remove: the
      // code would be absent from both the pathogen and the non-pathogen ValueSet, so AMR reports
      // would drop it without a trace.
      throw new OpenLdrError(
        `organism code '${r.code}' has unrecognised category ${JSON.stringify(category)} — expected one of ${ORGANISM_TYPES.join(', ')}`,
      );
    }
    byType[category] = (byType[category] ?? 0) + 1;
    concepts.push({
      system: SITE_ORGANISM_SYSTEM,
      code: r.code,
      display: r.description ?? null,
      status: null,
      properties: { organism_type: category },
    });
  }

  if (concepts.length === 0) throw new OpenLdrError('organism dictionary contained no usable codes');

  await store.upsertConcepts(concepts);
  // One signal for the whole system, after every concept has landed (see LoaderStore's contract).
  await store.markSystemChanged(SITE_ORGANISM_SYSTEM);

  return { system: SITE_ORGANISM_SYSTEM, conceptsLoaded: concepts.length, resourceUrl: SITE_ORGANISM_SYSTEM, byType, skipped };
}
