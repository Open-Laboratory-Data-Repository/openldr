import { OpenLdrError } from '@openldr/core';
import type { ConceptRecord } from '@openldr/db';
import type { LoaderStore, LoadResult } from './generic';

/** The canonical system for a DISA-style site RESULT/parameter dictionary (PARMDICT). */
export const RESULT_PARAM_SYSTEM = 'urn:openldr:default_result';

/** What a code IS, in CE's terms. Four roles rather than a boolean because the clinical template
 *  needs them separately: `result` fills the results table, `specimen` fills the Sample Information
 *  panel, `metadata`/`admin` appear nowhere. */
export const RESULT_ROLES = ['result', 'specimen', 'metadata', 'admin'] as const;
export type ResultRole = (typeof RESULT_ROLES)[number];

/** One row of a PARMDICT export. `context`/`units`/`reference` are DISA's; `result_role` is CE's. */
export interface ResultParamRow {
  code: string;
  description?: string | null;
  /** PARMDICT.CONTEXT. ⚠ Recorded as data ONLY — measured NOT to separate result from metadata
   *  (context -1 holds 638/1547 codes and contains both classes). Never classify on it. */
  context?: number | null;
  units?: string | null;
  /** PARMDICT.REFERENCE. ⚠ A CITATION ("Roche Reference Ranges for Adults and Children"), never a
   *  numeric range — verified against the live dictionary. Do not parse it as bounds. */
  reference?: string | null;
  result_role?: string | null;
}

export interface ResultParamImportResult extends LoadResult {
  byRole: Record<string, number>;
  skipped: number;
}

/**
 * Import a site's result-parameter dictionary as a CodeSystem whose concepts carry `result_role`.
 *
 * Deliberately NOT seeded into CE: PARMDICT is SITE-SPECIFIC (one Tanzanian deployment's 1,547
 * codes). Shipping one site's vocabulary as a product default would make every other deployment
 * silently wrong — the same reasoning as the organism dictionary.
 */
export async function importResultParameters(json: unknown, store: LoaderStore): Promise<ResultParamImportResult> {
  if (!Array.isArray(json)) {
    throw new OpenLdrError('result parameter dictionary must be a JSON array of { code, description, result_role }');
  }
  const rows = json as ResultParamRow[];
  const byRole: Record<string, number> = {};
  const concepts: ConceptRecord[] = [];
  let skipped = 0;

  for (const r of rows) {
    // A header-ish row with no code is not addressable and would collide on (system, code).
    if (!r.code) { skipped += 1; continue; }
    const role = r.result_role ?? null;
    if (!role || !(RESULT_ROLES as readonly string[]).includes(role)) {
      // Fail LOUD, exactly as the organism loader does. A silent skip would leave the code in
      // neither ValueSet — which fail-open would then render, but with no record that nobody had
      // ever classified it. An import is the one moment we can demand an answer.
      throw new OpenLdrError(
        `result code '${r.code}' has unrecognised result_role ${JSON.stringify(role)} — expected one of ${RESULT_ROLES.join(', ')}`,
      );
    }
    byRole[role] = (byRole[role] ?? 0) + 1;
    const properties: Record<string, unknown> = { result_role: role };
    if (r.context !== undefined && r.context !== null) properties.parm_context = r.context;
    if (r.units) properties.parm_units = r.units;
    if (r.reference) properties.reference_citation = r.reference;
    concepts.push({
      system: RESULT_PARAM_SYSTEM,
      code: r.code,
      display: r.description ?? null,
      status: null,
      properties,
    });
  }

  if (concepts.length === 0) throw new OpenLdrError('result parameter dictionary contained no usable codes');

  await store.upsertConcepts(concepts);
  // One signal for the whole system, after every concept has landed (LoaderStore's contract).
  await store.markSystemChanged(RESULT_PARAM_SYSTEM);

  return {
    system: RESULT_PARAM_SYSTEM,
    conceptsLoaded: concepts.length,
    resourceUrl: RESULT_PARAM_SYSTEM,
    byRole,
    skipped,
  };
}
