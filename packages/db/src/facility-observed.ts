/**
 * Observed-facility reconciliation: the constants and the pure row shaping.
 *
 * ⛔ DEPENDENCY-FREE ON PURPOSE. `apps/studio` imports this module (see the Observed tab), exactly
 * as it imports `./facility-answers`. A runtime import of `kysely`/`pg` here would pull the whole
 * database layer into the browser bundle.
 */

/**
 * The default coding system for facility strings observed in ingested data.
 *
 * Named after openldr-v2's `SYSTEMS.FACILITY = 'DEFAULT_FAC'`, in CE's established
 * `urn:openldr:default_<x>` form (see `@openldr/terminology`'s `SITE_ORGANISM_SYSTEM` and
 * `RESULT_PARAM_SYSTEM`).
 *
 * ⛔ SITE-SPECIFIC — never seeded into CE, for the reason the organism dictionary's loader already
 * states about itself: one deployment's vocabulary shipped as a product default makes every other
 * deployment silently wrong. A second feed gets its OWN system rather than colliding here.
 */
export const DEFAULT_OBSERVED_FACILITY_SYSTEM = 'urn:openldr:default_fac';

/** One concept per `facility_registry` row, so `TermMappingDialog`'s search mode has something to
 *  pick. The concept `code` is the registry row's `id` — neither `local_code` (NULL on every
 *  imported row) nor `national_code` (NULL on hand-created rows) is universally present; the
 *  table's only guarantee is the `facility_registry_has_a_code` CHECK that at least one exists. */
export const FACILITY_REGISTRY_SYSTEM = 'urn:openldr:cs:facility-registry';

/** Bounded so the derived `facility_map.id` fits `keyType` (varchar(255)) on MySQL/MSSQL. */
const MAX_ID_LENGTH = 200;

export interface ObservedFacilityProperties {
  firstSeen: string;
  lastSeen: string;
  reportCount: number;
}

export interface ObservedFacilityInput {
  system: string;
  /** The performer string EXACTLY as it arrived. Never normalised. */
  code: string;
  /** ISO timestamp of this observation. Passed in, never read from a clock, so the shaping is pure
   *  and testable. */
  seenAt: string;
  reportCount: number;
  /** The already-stored concept, when re-scanning. */
  existing?: { display: string | null; properties: Record<string, unknown> | null };
}

export interface ConceptRowInput {
  system: string;
  code: string;
  display: string | null;
  status: string;
  properties: Record<string, unknown> | null;
}

/**
 * Shape one observed facility string into a `terminology_concepts` row.
 *
 * ⛔ `code` is `input.code` verbatim — no trimming, no case folding. It is a match KEY against
 * `diagnostic_reports.performer`, not a name. openldr-v2 upper-cased its codes; that was safe only
 * because there the upper-cased value WAS the stored value.
 *
 * A re-scan must not destroy operator work: an existing `display` is preserved (the operator may
 * have curated it) and `firstSeen` is carried forward. Only `lastSeen` and `reportCount` advance.
 */
export function observedFacilityConceptRow(input: ObservedFacilityInput): ConceptRowInput {
  const prior = (input.existing?.properties ?? null) as Partial<ObservedFacilityProperties> | null;
  const firstSeen = typeof prior?.firstSeen === 'string' ? prior.firstSeen : input.seenAt;
  return {
    system: input.system,
    code: input.code,
    display: input.existing?.display ?? input.code,
    status: 'ACTIVE',
    properties: { firstSeen, lastSeen: input.seenAt, reportCount: input.reportCount },
  };
}

/**
 * Deterministic id for a `facility_map` row. Deterministic because a re-publish recomputes it —
 * a non-deterministic id would duplicate every row on rebuild instead of replacing it.
 *
 * Readable while it fits, hashed when it does not, mirroring `terminology_codes`' synthetic key.
 */
export function facilityMapId(sourceSystem: string, sourceCode: string): string {
  const readable = `${sourceSystem}|${sourceCode}`;
  if (readable.length <= MAX_ID_LENGTH) return readable;
  return `fm-${djb2Hex(readable)}`;
}

/** A tiny, dependency-free stable hash — `node:crypto` would break this module's browser-safety. */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${s.length.toString(16)}`;
}
