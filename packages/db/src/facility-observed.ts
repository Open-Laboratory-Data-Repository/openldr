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

/** `coding_systems.system_code`/`system_name` for `FACILITY_REGISTRY_SYSTEM`'s row — the ONE
 *  non-migration definition. `ensureRegistrySystemActive`
 *  (`packages/bootstrap/src/facility-reconcile.ts`) imports these rather than re-typing the
 *  literals, so the runtime upsert can never drift from itself.
 *
 *  Migration `075_facility_registry_coding_system.ts` inlines its OWN copy of these two values
 *  instead of importing them, DELIBERATELY: a migration is a frozen snapshot of what it wrote at
 *  the time it ran, and importing a "live" constant that later code could edit would let the
 *  migration's behaviour drift out from under it after the fact (same reasoning as the RBAC frozen
 *  capability list). If either value here ever changes, migration 075's inlined copy must be left
 *  exactly as it was — do not "fix" it to match. */
export const FACILITY_REGISTRY_SYSTEM_CODE = 'FACILITY-REGISTRY';
export const FACILITY_REGISTRY_SYSTEM_NAME = 'OpenLDR facility registry';

/** Bounded so the derived `facility_map.id` fits `keyType` (varchar(255)) on MySQL/MSSQL. */
const MAX_ID_LENGTH = 200;

/**
 * The ingest workflow's Persist Store `source` — the ONE feed identity that predates Task 9b and
 * whose 23 existing concepts + 2 mappings under `DEFAULT_OBSERVED_FACILITY_SYSTEM` must stay valid.
 *
 * Not a magic string: mirrors `INGEST_PERSIST_SOURCE` in `packages/workflows/src/sample-workflow.ts`
 * (the seeded workflow's Persist Store `source` parameter), duplicated rather than imported because
 * this module is zero-import by design (see the file banner) and reaching into `@openldr/workflows`
 * from here would defeat that.
 */
const DEFAULT_INGEST_FEED = 'webhook-ingest';

/** `urn:openldr:` namespace shared with `DEFAULT_OBSERVED_FACILITY_SYSTEM`/`FACILITY_REGISTRY_SYSTEM`
 *  above; `fac_` (not `default_fac`) so a feed literally named `default_fac` cannot collide with the
 *  default system's own url. */
const FEED_SYSTEM_PREFIX = 'urn:openldr:fac_';

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
  /** The wire-supplied display (`DiagnosticReport.performer[0].display`, e.g. "Aga Khan") to seed a
   *  NEW concept's display with, in preference to the bare code ("BAMAA"). Never overrides an
   *  operator-curated `existing.display` — that always wins. Falls back to `code` when absent
   *  (a sender with no display either) or blank. */
  defaultDisplay?: string | null;
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
 * have curated it) and `firstSeen` is carried forward — SCAN TO SCAN. Only `lastSeen` and
 * `reportCount` advance in that path.
 *
 * ⚠ This function cannot guarantee `firstSeen` survives an operator edit made through the
 * terminology admin store's `terms.update()`. That path's `packProps` (`terminology-admin-store.ts`
 * lines 185-193) keeps only `shortName`/`class`/`unit`/`replacedBy`/`metadata` and drops everything
 * else, and `update` (lines 520-528) then overwrites `properties` unconditionally with whatever
 * `packProps` returned — including `null`. So `input.existing.properties` handed to this function
 * after such an edit is `null`, `firstSeen` falls through to `input.seenAt`, and the value is reset.
 * This is a pre-existing bug in the shared terminology admin store, not something this function can
 * fix locally; it is out of scope here.
 */
export function observedFacilityConceptRow(input: ObservedFacilityInput): ConceptRowInput {
  const prior = (input.existing?.properties ?? null) as Partial<ObservedFacilityProperties> | null;
  const firstSeen = typeof prior?.firstSeen === 'string' ? prior.firstSeen : input.seenAt;
  const defaultDisplay = input.defaultDisplay && input.defaultDisplay.trim() !== '' ? input.defaultDisplay : null;
  return {
    system: input.system,
    code: input.code,
    display: input.existing?.display ?? defaultDisplay ?? input.code,
    status: 'ACTIVE',
    properties: { firstSeen, lastSeen: input.seenAt, reportCount: input.reportCount },
  };
}

/**
 * Shape one `facility_registry` row into its `FACILITY_REGISTRY_SYSTEM` projection concept.
 *
 * The ONE definition of "what a registry row's concept looks like" — shared by
 * `publishRegistryConcepts` (bulk reprojection of every row, `packages/bootstrap/src/facility-
 * reconcile.ts`) and `projectRegistryRows` (the given-rows path run on facility create/update/import)
 * so the two can never independently drift on the shape.
 *
 * ⛔ `display` TRACKS `name` — the opposite convention from `observedFacilityConceptRow`, where a
 * curated display is preserved because the operator owns it. This concept is a projection FROM the
 * registry, and the registry is the source of truth for a facility's name.
 */
export function registryConceptRow(row: { id: string; name: string }): ConceptRowInput {
  return { system: FACILITY_REGISTRY_SYSTEM, code: row.id, display: row.name, status: 'ACTIVE', properties: null };
}

/**
 * Bind an ingest feed (`diagnostic_reports.source_system`) to ITS coding system — the piece the
 * design called "one coding system per feed" but never actually wired (Task 9b). Two feeds sending
 * the same observed code must never share a mapping, or a wrong-lab collision is silent (see the
 * task's design doc for the concrete NHL-01 example).
 *
 * - The default ingest feed (`DEFAULT_INGEST_FEED`, i.e. `webhook-ingest`) maps to
 *   `DEFAULT_OBSERVED_FACILITY_SYSTEM` — this is the one binding that predates Task 9b, and it must
 *   keep every already-mapped code under `urn:openldr:default_fac` resolving exactly as before.
 * - `null`/blank (including whitespace-only) also maps to the default system: before Task 9b every
 *   feed's rows — including any with a missing `source_system` — were reconciled as one undivided
 *   pool under the default system, so a row with NO feed identity at all is treated the same as the
 *   original single feed rather than invented into a new "unknown feed" system. This is a judgement
 *   call, not a discovered fact: a NULL row could equally belong to some OTHER feed whose identity
 *   was simply lost, but there is no signal in the row to tell that apart from "no feed recorded is
 *   the historical norm" and defaulting to a NEW system per NULL row would be non-deterministic
 *   (every scan would invent a fresh empty-string system) — the diagnosed alternative is worse.
 * - Any other feed gets its OWN system, deterministic (a re-scan recomputes the same url so a
 *   `facility_map`/`coding_systems` rebuild never drifts) and namespaced under `FEED_SYSTEM_PREFIX`
 *   so it can never collide with `DEFAULT_OBSERVED_FACILITY_SYSTEM` or `FACILITY_REGISTRY_SYSTEM`.
 *   The slug uses the SAME normalisation discipline as `facility-reconcile.ts`'s `systemCodeFor`
 *   (non-alphanumeric runs collapsed to one separator, trimmed edges) so the two stay conceptually
 *   aligned, lower-cased to match this file's existing `urn:openldr:*` naming convention. Two feed
 *   names that normalise to the same slug (e.g. `feed-a` and `feed_a`) WOULD still collide — the
 *   same accepted risk `systemCodeFor` already carries for `coding_systems.system_code`.
 */
export function observedSystemForFeed(sourceSystem: string | null): string {
  const trimmed = (sourceSystem ?? '').trim();
  if (trimmed === '' || trimmed === DEFAULT_INGEST_FEED) return DEFAULT_OBSERVED_FACILITY_SYSTEM;
  const slug = trimmed
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  // A url that slugifies to empty (e.g. `///`) must not collapse onto FEED_SYSTEM_PREFIX alone —
  // that would collide with every other punctuation-only feed name. Fall back to a deterministic
  // hash of the full string instead, mirroring `systemCodeFor`'s own `SYS_${djb2Hex(system)}` guard.
  return slug.length > 0 ? `${FEED_SYSTEM_PREFIX}${slug}` : `${FEED_SYSTEM_PREFIX}${djb2Hex(trimmed)}`;
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
